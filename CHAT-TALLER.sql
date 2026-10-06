-- ============================================================================
--  CHAT-TALLER.sql · un chat por pedido entre el montador y el taller
--  Rama: movil-montador · ejecutar DESPUÉS de PEDIDOS-ARCHIVOS.sql y ANTES
--  de desplegar el cliente nuevo. Idempotente: se puede volver a pegar entero.
--
--  Reglas (las impone la BASE DE DATOS, no la interfaz):
--    · Un chat por pedido (unique pedido_id). Solo lo abre el dueño del pedido.
--    · El montador solo ve y escribe en los chats de SUS pedidos.
--    · "Taller" = rol admin o almacen (public.current_user_role()).
--    · Nadie puede editar ni borrar mensajes (privilegios revocados).
--    · Nadie borra chats directamente (DELETE revocado). El taller los cierra
--      con la RPC eliminar_chat(); los mensajes caen en cascada. Las imágenes
--      de Storage las borra antes el cliente del taller (la política de DELETE
--      del bucket solo deja al taller).
--    · autor_uid / autor_rol los fija un disparador: el cliente no puede
--      hacerse pasar por el taller.
--    · Imágenes en bucket PRIVADO chat-imagenes, ruta <chat_id>/<uuid>.jpg,
--      servidas con URLs firmadas.
-- ============================================================================


-- ── PASO 0 · INSPECCIONAR (solo lectura) ────────────────────────────────────
-- pedidos.id debe ser bigint (los ids son Date.now()). current_user_role() debe existir.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'pedidos' and column_name in ('id', 'user_uid');
select proname from pg_proc where proname = 'current_user_role';


-- ── PASO 1 · APLICAR ─────────────────────────────────────────────────────────
begin;

-- 1.1 Tablas ------------------------------------------------------------------
create table if not exists public.chats (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          bigint not null unique references public.pedidos(id) on delete cascade,
  montador_uid       uuid not null,
  creado_el          timestamptz not null default now(),
  ultimo_mensaje_el  timestamptz not null default now(),
  leido_montador_el  timestamptz,
  leido_taller_el    timestamptz
);
create index if not exists idx_chats_montador on public.chats(montador_uid);

create table if not exists public.chat_mensajes (
  id           bigint generated always as identity primary key,
  chat_id      uuid not null references public.chats(id) on delete cascade,
  autor_uid    uuid not null default auth.uid(),
  autor_rol    text not null check (autor_rol in ('montador', 'taller')),
  texto        text check (texto is null or char_length(texto) <= 4000),
  imagen_path  text,
  creado_el    timestamptz not null default now(),
  constraint chat_mensajes_con_contenido check (texto is not null or imagen_path is not null)
);
create index if not exists idx_chat_mensajes_chat on public.chat_mensajes(chat_id, creado_el);

-- 1.2 Funciones auxiliares (SECURITY DEFINER: leen chats sin pasar por RLS y
--     así las políticas no se llaman a sí mismas) ------------------------------
create or replace function public.es_taller()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('admin', 'almacen'), false);
$$;

create or replace function public.chat_accesible(p_chat_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chats c
    where c.id = p_chat_id
      and (c.montador_uid = auth.uid() or public.es_taller())
  );
$$;

-- Variante para Storage: recibe el primer segmento de la ruta como texto (si
-- no es un uuid válido simplemente no coincide, en vez de fallar el cast).
create or replace function public.chat_accesible_txt(p_chat_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chats c
    where c.id::text = p_chat_id
      and (c.montador_uid = auth.uid() or public.es_taller())
  );
$$;

-- 1.3 Disparadores ------------------------------------------------------------
-- chats: el cliente no elige fechas ni marcas de leído al crear.
create or replace function public.chats_antes_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.creado_el         := now();
  new.ultimo_mensaje_el := now();
  new.leido_montador_el := null;
  new.leido_taller_el   := null;
  return new;
end;
$$;
drop trigger if exists trg_chats_antes_insert on public.chats;
create trigger trg_chats_antes_insert
  before insert on public.chats
  for each row execute function public.chats_antes_insert();

-- chat_mensajes: autor y rol los fija la base de datos, nunca el cliente.
create or replace function public.chat_mensajes_antes_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida para escribir en el chat' using errcode = '42501';
  end if;
  new.autor_uid := auth.uid();
  new.autor_rol := case when public.es_taller() then 'taller' else 'montador' end;
  new.creado_el := now();
  new.texto     := nullif(btrim(new.texto), '');
  return new;
end;
$$;
drop trigger if exists trg_chat_mensajes_antes_insert on public.chat_mensajes;
create trigger trg_chat_mensajes_antes_insert
  before insert on public.chat_mensajes
  for each row execute function public.chat_mensajes_antes_insert();

-- Tras cada mensaje: actualiza ultimo_mensaje_el y da por leído el chat a
-- quien escribe (su propio mensaje no cuenta como "no leído").
create or replace function public.chat_mensajes_despues_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chats
     set ultimo_mensaje_el = new.creado_el,
         leido_montador_el = case when new.autor_rol = 'montador' then new.creado_el else leido_montador_el end,
         leido_taller_el   = case when new.autor_rol = 'taller'   then new.creado_el else leido_taller_el   end
   where id = new.chat_id;
  return null;
end;
$$;
drop trigger if exists trg_chat_mensajes_despues_insert on public.chat_mensajes;
create trigger trg_chat_mensajes_despues_insert
  after insert on public.chat_mensajes
  for each row execute function public.chat_mensajes_despues_insert();

-- 1.4 RPCs ---------------------------------------------------------------------
-- Marca leído para el lado de quien llama. No leídos = mensajes del OTRO lado
-- con creado_el > mi leido_*_el.
create or replace function public.marcar_chat_leido(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_montador uuid;
begin
  select montador_uid into v_montador from public.chats where id = p_chat_id;
  if not found then
    raise exception 'Chat no encontrado' using errcode = 'P0002';
  end if;
  if public.es_taller() then
    update public.chats set leido_taller_el = now() where id = p_chat_id;
  elsif v_montador = auth.uid() then
    update public.chats set leido_montador_el = now() where id = p_chat_id;
  else
    raise exception 'Sin acceso a este chat' using errcode = '42501';
  end if;
end;
$$;

-- Cierre del chat: SOLO taller. Borra el chat y, en cascada, sus mensajes.
-- Las imágenes de Storage las borra el cliente del taller ANTES de llamar aquí.
create or replace function public.eliminar_chat(p_chat_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.es_taller() then
    raise exception 'Solo el taller puede cerrar un chat' using errcode = '42501';
  end if;
  delete from public.chats where id = p_chat_id;
  return found;
end;
$$;

-- 1.5 Privilegios ---------------------------------------------------------------
-- Sin UPDATE/DELETE para nadie desde la API: un intento devuelve
-- "permission denied" (error explícito, no el 204 silencioso de RLS).
revoke all on public.chats, public.chat_mensajes from anon;
revoke update, delete, truncate on public.chats, public.chat_mensajes from authenticated;
grant select, insert on public.chats, public.chat_mensajes to authenticated;

revoke all on function public.es_taller()                    from public, anon;
revoke all on function public.chat_accesible(uuid)           from public, anon;
revoke all on function public.chat_accesible_txt(text)       from public, anon;
revoke all on function public.marcar_chat_leido(uuid)        from public, anon;
revoke all on function public.eliminar_chat(uuid)            from public, anon;
revoke all on function public.chats_antes_insert()           from public, anon, authenticated;
revoke all on function public.chat_mensajes_antes_insert()   from public, anon, authenticated;
revoke all on function public.chat_mensajes_despues_insert() from public, anon, authenticated;
grant execute on function public.es_taller()              to authenticated;
grant execute on function public.chat_accesible(uuid)     to authenticated;
grant execute on function public.chat_accesible_txt(text) to authenticated;
grant execute on function public.marcar_chat_leido(uuid)  to authenticated;
grant execute on function public.eliminar_chat(uuid)      to authenticated;

-- 1.6 RLS -----------------------------------------------------------------------
alter table public.chats         enable row level security;
alter table public.chat_mensajes enable row level security;

drop policy if exists "chats_select"        on public.chats;
drop policy if exists "chats_insert_propio" on public.chats;
drop policy if exists "chats_delete_taller" on public.chats;

create policy "chats_select" on public.chats
  for select to authenticated
  using (montador_uid = auth.uid() or public.es_taller());

create policy "chats_insert_propio" on public.chats
  for insert to authenticated
  with check (
    montador_uid = auth.uid()
    and exists (select 1 from public.pedidos p
                where p.id = pedido_id and p.user_uid = auth.uid())
  );

-- Defensa en profundidad: aunque DELETE está revocado (el cierre va por la RPC
-- eliminar_chat), si algún día se re-concede, solo el taller podría borrar.
create policy "chats_delete_taller" on public.chats
  for delete to authenticated
  using (public.es_taller());
-- Sin política de UPDATE: leídos y fechas solo vía disparador / RPC.

drop policy if exists "chat_mensajes_select" on public.chat_mensajes;
drop policy if exists "chat_mensajes_insert" on public.chat_mensajes;

create policy "chat_mensajes_select" on public.chat_mensajes
  for select to authenticated
  using (public.chat_accesible(chat_id));

create policy "chat_mensajes_insert" on public.chat_mensajes
  for insert to authenticated
  with check (
    public.chat_accesible(chat_id)
    and autor_uid = auth.uid()
    and (imagen_path is null or imagen_path like chat_id::text || '/%')
  );
-- Sin UPDATE/DELETE: los mensajes solo desaparecen en cascada al cerrar el chat.

-- 1.7 Realtime -------------------------------------------------------------------
do $$
declare v_all boolean;
begin
  select puballtables into v_all from pg_publication where pubname = 'supabase_realtime';
  if v_all is null then
    create publication supabase_realtime;
    v_all := false;
  end if;
  if not v_all then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chats') then
      alter publication supabase_realtime add table public.chats;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensajes') then
      alter publication supabase_realtime add table public.chat_mensajes;
    end if;
  end if;
end $$;

-- 1.8 Storage: bucket PRIVADO chat-imagenes ------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-imagenes', 'chat-imagenes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat_img_insert" on storage.objects;
drop policy if exists "chat_img_select" on storage.objects;
drop policy if exists "chat_img_delete" on storage.objects;

-- Subir: solo dentro de la carpeta de un chat accesible (<chat_id>/...).
create policy "chat_img_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-imagenes'
              and public.chat_accesible_txt((storage.foldername(name))[1]));

-- Leer / firmar URL / listar: chat accesible. El taller además puede listar
-- carpetas de chats ya borrados (barrido de restos tras cerrar un chat).
create policy "chat_img_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-imagenes'
         and (public.es_taller()
              or public.chat_accesible_txt((storage.foldername(name))[1])));

-- Borrar: SOLO taller. Sin política de UPDATE (no se sobrescribe nada).
create policy "chat_img_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-imagenes' and public.es_taller());

commit;


-- ── PASO 2 · VERIFICAR ───────────────────────────────────────────────────────
-- a) Políticas creadas (5 en public + 3 en storage).
select schemaname, tablename, policyname, cmd
from pg_policies
where (schemaname = 'public' and tablename in ('chats', 'chat_mensajes'))
   or (schemaname = 'storage' and policyname like 'chat_img_%')
order by schemaname, tablename, policyname;

-- b) Tablas en la publicación de Realtime (o puballtables = true).
select pubname, puballtables from pg_publication where pubname = 'supabase_realtime';
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename in ('chats', 'chat_mensajes');

-- c) Bucket privado.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'chat-imagenes';

-- d) Pruebas de permisos simulando usuarios: ver VERIFICAR-CHAT.sql (no deja
--    rastro: todo va en una transacción con ROLLBACK).


-- ── VUELTA ATRÁS ─────────────────────────────────────────────────────────────
-- Borra TODOS los chats y mensajes. Vacía antes el bucket desde el panel de
-- Storage (Supabase no permite borrar un bucket con objetos).
-- begin;
-- drop policy if exists "chat_img_insert" on storage.objects;
-- drop policy if exists "chat_img_select" on storage.objects;
-- drop policy if exists "chat_img_delete" on storage.objects;
-- delete from storage.buckets where id = 'chat-imagenes';
-- alter publication supabase_realtime drop table public.chat_mensajes, public.chats;
-- drop table if exists public.chat_mensajes;
-- drop table if exists public.chats;
-- drop function if exists public.eliminar_chat(uuid), public.marcar_chat_leido(uuid),
--   public.chat_mensajes_despues_insert(), public.chat_mensajes_antes_insert(),
--   public.chats_antes_insert(), public.chat_accesible_txt(text),
--   public.chat_accesible(uuid), public.es_taller();
-- commit;
