-- ============================================================================
--  EMPRESAS.sql · empresa cliente de cada montador y de cada pedido
--  Rama: empresas · ejecutar ANTES de desplegar el cliente nuevo.
--  Idempotente: se puede volver a pegar entero. Sin precios.
--
--  Reglas (las impone la BASE DE DATOS):
--    · empresas: la ven los usuarios con sesión; solo el taller (admin/almacén)
--      las crea o cambia; no se borran, se desactivan (activa = false).
--    · La pantalla de registro (sin sesión) solo ve id + nombre de las ACTIVAS,
--      vía la RPC empresas_registro().
--    · Alta de cuenta: handle_new_user guarda la empresa elegida SOLO si existe
--      y está activa.
--    · profiles: nadie la modifica por API (UPDATE revocado → error de
--      permisos). El taller cambia la empresa con la RPC asignar_empresa_usuario().
--    · pedidos.empresa_id: un disparador la rellena con la del perfil. Si inserta
--      un montador, SIEMPRE la de su perfil (ignora lo que mande el cliente).
--      El taller puede cambiarla luego (UPDATE de pedidos ya es del taller).
--      El histórico conserva la empresa aunque el montador cambie de empresa.
--    · n8n (service_role, sin auth.uid()) sigue insertando igual: la columna
--      admite null y el disparador no falla sin user_uid o sin perfil.
-- ============================================================================


-- ── PASO 0 · INSPECCIONAR (solo lectura) ────────────────────────────────────
-- a) Definición ACTUAL de handle_new_user. El PASO 1 la reemplaza por una que
--    hace lo mismo (nombre + rol montador) y además guarda empresa_id. Si la
--    actual hace algo más, avísame antes de ejecutar el PASO 1.
select pg_get_functiondef('public.handle_new_user'::regproc);

-- b) Políticas y privilegios de UPDATE sobre profiles (se espera: ninguna
--    política de UPDATE). El PASO 1 revoca el UPDATE a anon/authenticated.
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'profiles' order by cmd, policyname;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- c) ¿Existen ya las piezas? (current_user_role debe existir; es_taller viene
--    de CHAT-TALLER.sql y aquí se redefine igual por si acaso).
select proname from pg_proc where proname in ('current_user_role', 'es_taller', 'handle_new_user');
select column_name, table_name from information_schema.columns
where table_schema = 'public' and column_name = 'empresa_id';


-- ── PASO 1 · APLICAR ─────────────────────────────────────────────────────────
begin;

-- 1.1 Tabla empresas ------------------------------------------------------------
create table if not exists public.empresas (
  id         bigint generated always as identity primary key,
  nombre     text not null unique check (btrim(nombre) <> ''),
  activa     boolean not null default true,
  creado_el  timestamptz not null default now()
);
-- Único sin distinguir mayúsculas ni espacios de los extremos.
create unique index if not exists empresas_nombre_norm_uidx on public.empresas (lower(btrim(nombre)));

-- 1.2 Columnas empresa_id ---------------------------------------------------------
alter table public.profiles add column if not exists empresa_id bigint references public.empresas(id);
alter table public.pedidos  add column if not exists empresa_id bigint references public.empresas(id);
create index if not exists idx_pedidos_empresa  on public.pedidos(empresa_id);
create index if not exists idx_profiles_empresa on public.profiles(empresa_id);

-- 1.3 es_taller (misma definición que CHAT-TALLER.sql) --------------------------
create or replace function public.es_taller()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('admin', 'almacen'), false);
$$;
revoke all on function public.es_taller() from public, anon;
grant execute on function public.es_taller() to authenticated;

-- 1.4 RLS de empresas ---------------------------------------------------------------
alter table public.empresas enable row level security;
drop policy if exists "empresas_select"        on public.empresas;
drop policy if exists "empresas_insert_taller" on public.empresas;
drop policy if exists "empresas_update_taller" on public.empresas;
create policy "empresas_select" on public.empresas
  for select to authenticated using (true);
create policy "empresas_insert_taller" on public.empresas
  for insert to authenticated with check (public.es_taller());
create policy "empresas_update_taller" on public.empresas
  for update to authenticated using (public.es_taller()) with check (public.es_taller());
-- Sin DELETE: se desactivan. anon no ve la tabla (usa empresas_registro()).
revoke all on public.empresas from anon;
revoke delete, truncate on public.empresas from authenticated;
grant select, insert, update on public.empresas to authenticated;

-- 1.5 RPC pública para la pantalla de registro (solo id + nombre de activas) ------
create or replace function public.empresas_registro()
returns table (id bigint, nombre text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre from public.empresas e where e.activa order by lower(e.nombre);
$$;
revoke all on function public.empresas_registro() from public;
grant execute on function public.empresas_registro() to anon, authenticated;

-- 1.6 Alta de cuenta: handle_new_user + empresa ------------------------------------
-- Igual que antes (perfil con nombre y rol 'montador') + empresa_id si la
-- empresa enviada en raw_user_meta_data existe y está activa (si no, null).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp bigint;
begin
  begin
    v_emp := nullif(btrim(new.raw_user_meta_data->>'empresa_id'), '')::bigint;
  exception when others then
    v_emp := null;   -- valor no numérico: se ignora, nunca bloquea el alta
  end;
  if v_emp is not null and not exists (select 1 from public.empresas where id = v_emp and activa) then
    v_emp := null;
  end if;
  insert into public.profiles (id, nombre, role, empresa_id)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'montador', v_emp);
  return new;
end;
$$;
-- (el disparador on_auth_user_created ya apunta a esta función; no se recrea)

-- 1.7 profiles: nadie la cambia por API; el taller usa esta RPC ------------------
revoke update on public.profiles from anon, authenticated;

create or replace function public.asignar_empresa_usuario(p_user uuid, p_empresa_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_taller() then
    raise exception 'Solo el taller puede cambiar la empresa de un usuario' using errcode = '42501';
  end if;
  if p_empresa_id is not null and not exists (select 1 from public.empresas where id = p_empresa_id) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  update public.profiles set empresa_id = p_empresa_id where id = p_user;
  if not found then
    raise exception 'Usuario no encontrado' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.asignar_empresa_usuario(uuid, bigint) from public, anon;
grant execute on function public.asignar_empresa_usuario(uuid, bigint) to authenticated;

-- 1.8 Pedidos: empresa del perfil al insertar --------------------------------------
create or replace function public.pedidos_empresa_antes_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp bigint;
begin
  if new.user_uid is not null then
    select empresa_id into v_emp from public.profiles where id = new.user_uid;   -- null si no hay perfil
  end if;
  if auth.uid() is not null and not public.es_taller() then
    -- Montador (o cualquier cuenta que no sea del taller): SIEMPRE la de su perfil.
    new.empresa_id := v_emp;
  elsif new.empresa_id is null then
    -- Taller o service_role (n8n): respeta la que venga; si no viene, la del perfil.
    new.empresa_id := v_emp;
  end if;
  return new;
end;
$$;
revoke all on function public.pedidos_empresa_antes_insert() from public, anon, authenticated;
drop trigger if exists trg_pedidos_empresa_antes_insert on public.pedidos;
create trigger trg_pedidos_empresa_antes_insert
  before insert on public.pedidos
  for each row execute function public.pedidos_empresa_antes_insert();

commit;

-- 1.9 DATOS INICIALES (COMENTADO: revísalo y ejecútalo tú) ---------------------
-- Sustituye NOMBRE_DEL_CLIENTE por el nombre real (las tres veces).
-- begin;
-- insert into empresas(nombre) values ('NOMBRE_DEL_CLIENTE') on conflict do nothing;
-- update profiles set empresa_id = (select id from empresas where nombre = 'NOMBRE_DEL_CLIENTE')
--   where role = 'montador' and empresa_id is null;
-- update pedidos set empresa_id = (select id from empresas where nombre = 'NOMBRE_DEL_CLIENTE')
--   where empresa_id is null and user_uid in (select id from profiles where role = 'montador');
-- commit;
--
-- Pedidos que quedan SIN empresa (correo / almacén / sin perfil), para asignarlos
-- a mano desde el detalle del pedido en el dashboard:
-- select p.id, p.fecha, p.referencia, p.montador, p.origen, pr.role
-- from pedidos p left join profiles pr on pr.id = p.user_uid
-- where p.empresa_id is null
-- order by p.id desc;


-- ── PASO 2 · VERIFICAR ───────────────────────────────────────────────────────
-- a) Estructura.
select table_name, column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public' and (table_name = 'empresas' or column_name = 'empresa_id')
order by table_name, column_name;

-- b) Políticas de empresas (3) y que profiles ya no concede UPDATE.
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'empresas';
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles' and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated');   -- debe salir VACÍO

-- c) Lo que ve la pantalla de registro.
select * from public.empresas_registro();

-- d) Pruebas de permisos simulando usuarios, sin rastro (ROLLBACK). Crea una
--    empresa A y B, un montador de A, y comprueba: pedido forzado a A aunque
--    pida B; no puede cambiar su empresa; el taller sí; los pedidos antiguos
--    conservan su empresa; un insert tipo n8n (sin sesión) no falla.
begin;
insert into public.empresas (nombre) values ('ZZ Prueba A'), ('ZZ Prueba B');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'prueba-emp@empresas.local',
   jsonb_build_object('nombre', 'Prueba Empresa', 'empresa_id', (select id from public.empresas where nombre = 'ZZ Prueba A')::text), now(), now()),
  ('00000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'prueba-tal@empresas.local',
   '{"nombre":"Prueba Taller"}', now(), now());
update public.profiles set role = 'almacen' where id = '00000000-0000-4000-8000-0000000000e2';
-- Insert tipo n8n (sin sesión, sin user_uid): no debe fallar.
insert into public.pedidos (id, fecha, montador, cantidad, estado, origen)
values (9900000000101, '01/01/2026, 10:00', 'correo@prueba', 1, 'Pendiente', 'email');
do $$ begin
  if (select empresa_id from public.profiles where id = '00000000-0000-4000-8000-0000000000e1')
     is distinct from (select id from public.empresas where nombre = 'ZZ Prueba A') then
    raise exception 'FALLO: el alta no guardó la empresa elegida';
  end if;
  if (select empresa_id from public.pedidos where id = 9900000000101) is not null then
    raise exception 'FALLO: el pedido de correo debería quedar sin empresa';
  end if;
  raise notice 'OK: alta con empresa; pedido de correo sin empresa y sin error';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
do $$
declare ok boolean := false; v bigint;
begin
  insert into public.pedidos (id, user_uid, fecha, montador, cantidad, estado, empresa_id)
  values (9900000000102, '00000000-0000-4000-8000-0000000000e1', '01/01/2026, 10:00', 'Prueba Empresa', 1, 'Pendiente',
          (select id from public.empresas where nombre = 'ZZ Prueba B'))
  returning empresa_id into v;
  if v is distinct from (select id from public.empresas where nombre = 'ZZ Prueba A') then
    raise exception 'FALLO: el montador eligió la empresa del pedido';
  end if;
  raise notice 'OK: el pedido del montador lleva SIEMPRE la empresa de su perfil';
  begin update public.profiles set empresa_id = null where id = auth.uid(); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: el montador pudo cambiar su empresa'; end if;
  ok := false;
  begin perform public.asignar_empresa_usuario(auth.uid(), null); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: el montador usó la RPC del taller'; end if;
  ok := false;
  begin insert into public.empresas (nombre) values ('ZZ Intrusa'); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: el montador creó una empresa'; end if;
  raise notice 'OK: el montador no cambia su empresa ni crea empresas (error de permisos)';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
do $$ begin
  perform public.asignar_empresa_usuario('00000000-0000-4000-8000-0000000000e1', (select id from public.empresas where nombre = 'ZZ Prueba B'));
  if (select empresa_id from public.pedidos where id = 9900000000102) is distinct from (select id from public.empresas where nombre = 'ZZ Prueba A') then
    raise exception 'FALLO: cambiar la empresa del montador cambió sus pedidos antiguos';
  end if;
  update public.empresas set activa = false where nombre = 'ZZ Prueba A';
  if exists (select 1 from public.empresas_registro() where nombre = 'ZZ Prueba A') then
    raise exception 'FALLO: una empresa desactivada sale en el registro';
  end if;
  raise notice 'OK: el taller reasigna; los pedidos antiguos conservan su empresa; desactivar la oculta del registro';
end $$;
reset role;
rollback;   -- no queda nada de la prueba


-- ── VUELTA ATRÁS (comentada) ─────────────────────────────────────────────────
-- Recupera el handle_new_user anterior (sin empresa) y quita todo lo demás.
-- begin;
-- drop trigger if exists trg_pedidos_empresa_antes_insert on public.pedidos;
-- drop function if exists public.pedidos_empresa_antes_insert();
-- drop function if exists public.asignar_empresa_usuario(uuid, bigint);
-- drop function if exists public.empresas_registro();
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   insert into public.profiles (id, nombre, role)
--   values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'montador');
--   return new;
-- end;
-- $$;
-- alter table public.pedidos  drop column if exists empresa_id;
-- alter table public.profiles drop column if exists empresa_id;
-- drop table if exists public.empresas;
-- (el UPDATE de profiles no se re-concede: la app nunca lo usó)
-- commit;
