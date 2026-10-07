-- ============================================================================
--  CHAT-TALLER-ABRE.sql · el taller también puede abrir el chat de un pedido
--  Rama: chat-desde-taller. Requiere CHAT-TALLER.sql. Idempotente.
--
--  Se mantiene todo lo de CHAT-TALLER.sql: un chat por pedido (unique
--  pedido_id), imágenes en los dos sentidos, solo el taller cierra y elimina.
--  Novedades:
--    · chats.abierto_por ('montador' | 'taller'): lo fija la BD, no el cliente.
--    · RPC abrir_chat_pedido(pedido): única puerta para abrir un chat.
--        - Si el chat ya existe → lo devuelve (si quien llama tiene acceso).
--        - Taller → solo en pedidos de un montador con cuenta; montador_uid =
--          pedidos.user_uid. Correo / almacén / sin usuario → error
--          "Este pedido no tiene montador con cuenta".
--        - Montador → solo en SUS pedidos (como hasta ahora).
--        - Llamadas casi simultáneas no duplican: ON CONFLICT (pedido_id).
--    · montador_uid lo fija SIEMPRE la BD a partir del pedido.
--
--  ORDEN DE DESPLIEGUE
--    1. PASO 1 (aditivo: no rompe el cliente actual, que aún hace INSERT directo).
--    2. Desplegar el cliente nuevo (usa la RPC; si no la encuentra, cae al INSERT).
--    3. PASO 3: revocar el INSERT directo en chats. Con la RPC sobra: es la
--       única puerta que comprueba el pedido y fija montador_uid y abierto_por
--       en la BD. Revocarlo ANTES del paso 2 dejaría a los montadores con el
--       cliente viejo sin poder abrir chats.
-- ============================================================================


-- ── PASO 0 · INSPECCIONAR (solo lectura) ────────────────────────────────────
select proname from pg_proc
where proname in ('es_taller', 'chat_accesible', 'chats_antes_insert', 'chat_mensajes_despues_insert', 'abrir_chat_pedido');
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'chats' order by ordinal_position;
select policyname, cmd, roles, with_check from pg_policies
where schemaname = 'public' and tablename = 'chats' order by cmd, policyname;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'chats' and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;


-- ── PASO 1 · APLICAR ─────────────────────────────────────────────────────────
begin;

-- 1.1 Quién abrió el chat. Los existentes quedan como 'montador' (es lo que eran).
alter table public.chats add column if not exists abierto_por text not null default 'montador';
alter table public.chats drop constraint if exists chats_abierto_por_check;
alter table public.chats add constraint chats_abierto_por_check check (abierto_por in ('montador', 'taller'));

-- 1.2 El disparador de alta fija abierto_por según quien abre (además de lo que
--     ya hacía: fechas y marcas de leído las pone la BD, no el cliente).
create or replace function public.chats_antes_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.creado_el         := now();
  new.ultimo_mensaje_el := now();
  new.leido_montador_el := null;
  new.leido_taller_el   := null;
  new.abierto_por       := case when public.es_taller() then 'taller' else 'montador' end;
  return new;
end;
$$;

-- 1.3 RPC: abrir (o recuperar) el chat de un pedido.
create or replace function public.abrir_chat_pedido(p_pedido_id bigint)
returns public.chats
language plpgsql security definer set search_path = public as $$
declare
  v_chat   public.chats;
  v_user   uuid;
  v_role   text;
  v_taller boolean := public.es_taller();
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;

  -- ¿Ya existe? Se devuelve si quien llama tiene acceso (lo abra quien lo abra).
  select * into v_chat from public.chats where pedido_id = p_pedido_id;
  if found then
    if v_taller or v_chat.montador_uid = auth.uid() then
      return v_chat;
    end if;
    raise exception 'Solo puedes abrir el chat de tus pedidos' using errcode = '42501';
  end if;

  select p.user_uid into v_user from public.pedidos p where p.id = p_pedido_id;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;

  if v_taller then
    select role into v_role from public.profiles where id = v_user;
    if v_user is null or v_role is distinct from 'montador' then
      raise exception 'Este pedido no tiene montador con cuenta' using errcode = 'P0001';
    end if;
  elsif v_user is distinct from auth.uid() then
    raise exception 'Solo puedes abrir el chat de tus pedidos' using errcode = '42501';
  end if;

  -- montador_uid SIEMPRE el del pedido; abierto_por lo pone el disparador.
  -- ON CONFLICT: si montador y taller lo abren a la vez, gana uno y el otro
  -- recibe el mismo chat.
  insert into public.chats (pedido_id, montador_uid)
  values (p_pedido_id, v_user)
  on conflict (pedido_id) do nothing
  returning * into v_chat;
  if v_chat.id is null then
    select * into v_chat from public.chats where pedido_id = p_pedido_id;
  end if;
  return v_chat;
end;
$$;
revoke all on function public.abrir_chat_pedido(bigint) from public, anon;
grant execute on function public.abrir_chat_pedido(bigint) to authenticated;

-- 1.4 No leídos: sin cambios. chat_mensajes_despues_insert marca leído SOLO a
--     quien escribe; si el taller abre el chat y escribe, leido_montador_el
--     sigue null y su mensaje cuenta como NO leído para el montador (PASO 2).

commit;


-- ── PASO 2 · VERIFICAR (prueba sin rastro: todo en ROLLBACK) ────────────────
select column_name, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'chats' and column_name = 'abierto_por';

begin;
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'abre-a@chat.local', '{"nombre":"Montador A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'abre-b@chat.local', '{"nombre":"Montador B"}', now(), now()),
  ('00000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'abre-t@chat.local', '{"nombre":"Taller"}', now(), now());
update public.profiles set role = 'almacen' where id = '00000000-0000-4000-8000-0000000000c3';
insert into public.pedidos (id, user_uid, fecha, montador, cantidad, estado, origen) values
  (9900000000201, '00000000-0000-4000-8000-0000000000a1', '01/01/2026, 10:00', 'Montador A', 1, 'Pendiente', null),
  (9900000000202, '00000000-0000-4000-8000-0000000000b2', '01/01/2026, 10:00', 'Montador B', 1, 'Pendiente', null),
  (9900000000203, null,                                   '01/01/2026, 10:00', 'correo@x',   1, 'Pendiente', 'email'),
  (9900000000204, '00000000-0000-4000-8000-0000000000c3', '01/01/2026, 10:00', 'Almacén',    1, 'Pendiente', null);
set local role authenticated;

-- Taller
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
do $$
declare c public.chats; c2 public.chats; ok boolean;
begin
  c := public.abrir_chat_pedido(9900000000201);
  if c.montador_uid <> '00000000-0000-4000-8000-0000000000a1' or c.abierto_por <> 'taller' then
    raise exception 'FALLO: chat abierto por el taller mal formado (%, %)', c.montador_uid, c.abierto_por;
  end if;
  c2 := public.abrir_chat_pedido(9900000000201);
  if c2.id <> c.id then raise exception 'FALLO: se duplicó el chat'; end if;
  insert into public.chat_mensajes (chat_id, texto) values (c.id, 'Hola, una duda sobre tu pedido');
  raise notice 'OK: el taller abre el chat del pedido de A (abierto_por = taller) y no se duplica';
  ok := false;
  begin perform public.abrir_chat_pedido(9900000000203); exception when others then ok := sqlerrm like '%no tiene montador con cuenta%'; end;
  if not ok then raise exception 'FALLO: chat en pedido de correo'; end if;
  ok := false;
  begin perform public.abrir_chat_pedido(9900000000204); exception when others then ok := sqlerrm like '%no tiene montador con cuenta%'; end;
  if not ok then raise exception 'FALLO: chat en pedido de almacén'; end if;
  raise notice 'OK: correo y almacén → "Este pedido no tiene montador con cuenta"';
end $$;

-- Montador A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
declare c public.chats; n int; ok boolean := false;
begin
  select * into c from public.chats where pedido_id = 9900000000201;
  if c.id is null then raise exception 'FALLO: A no ve el chat que abrió el taller'; end if;
  select count(*) into n from public.chat_mensajes
   where chat_id = c.id and autor_rol = 'taller'
     and (c.leido_montador_el is null or creado_el > c.leido_montador_el);
  if n <> 1 then raise exception 'FALLO: el primer mensaje del taller debería contar como NO leído para A (%)', n; end if;
  if (public.abrir_chat_pedido(9900000000201)).id <> c.id then
    raise exception 'FALLO: A abriendo el mismo pedido no recibe el mismo chat';
  end if;
  insert into public.chat_mensajes (chat_id, texto, imagen_path) values (c.id, 'Respondo con foto', c.id::text || '/foto.jpg');
  raise notice 'OK: A ve el chat, el mensaje del taller cuenta como no leído, y responde (texto + imagen)';
  begin perform public.abrir_chat_pedido(9900000000202); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A abrió chat en el pedido de B'; end if;
  raise notice 'OK: A no puede abrir chat en el pedido de B';
end $$;

-- Montador B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$
declare n int; ok boolean := false;
begin
  select count(*) into n from public.chats where pedido_id = 9900000000201;
  if n <> 0 then raise exception 'FALLO: B ve el chat de A'; end if;
  select count(*) into n from public.chat_mensajes;
  if n <> 0 then raise exception 'FALLO: B ve mensajes de A'; end if;
  begin perform public.abrir_chat_pedido(9900000000201); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: B obtuvo el chat de A con la RPC'; end if;
  raise notice 'OK: B no ve ni obtiene nada del chat de A';
end $$;

reset role;
rollback;   -- no queda nada de la prueba


-- ── PASO 3 · DESPUÉS DE DESPLEGAR EL CLIENTE NUEVO ──────────────────────────
-- Con la RPC, el INSERT directo en chats sobra: se revoca para que la ÚNICA
-- forma de abrir un chat sea abrir_chat_pedido() (que valida el pedido y fija
-- montador_uid y abierto_por). Un INSERT directo pasará a dar "permission denied".
-- begin;
-- revoke insert on public.chats from authenticated;
-- drop policy if exists "chats_insert_propio" on public.chats;
-- commit;


-- ── VUELTA ATRÁS (comentada) ─────────────────────────────────────────────────
-- begin;
-- grant insert on public.chats to authenticated;
-- create policy "chats_insert_propio" on public.chats for insert to authenticated
--   with check (montador_uid = auth.uid()
--               and exists (select 1 from public.pedidos p where p.id = pedido_id and p.user_uid = auth.uid()));
-- drop function if exists public.abrir_chat_pedido(bigint);
-- create or replace function public.chats_antes_insert()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   new.creado_el := now(); new.ultimo_mensaje_el := now();
--   new.leido_montador_el := null; new.leido_taller_el := null;
--   return new;
-- end;
-- $$;
-- alter table public.chats drop constraint if exists chats_abierto_por_check;
-- alter table public.chats drop column if exists abierto_por;
-- commit;
