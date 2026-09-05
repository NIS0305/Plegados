-- ============================================================================
--  RLS: el rol 'almacen' ve y opera el dashboard como un 'admin'
--  Fecha: 2026-09-05
--
--  Contexto: el almacén (role = 'almacen' en public.profiles) entra al MISMO
--  dashboard que un admin y ve todo (pedidos de montadores y de almacén,
--  gráficas, usuarios) y puede cambiar el estado de los pedidos.
--
--  Para eso necesita, como admin:
--    pedidos  : SELECT de TODAS las filas  (hoy solo las propias)
--               UPDATE                     (hoy solo admin)
--    profiles : SELECT de todas            (sección "usuarios" del dashboard)
--
--  NO se tocan: las políticas de INSERT del montador (pedidos_insert_propio),
--  las de lectura "propia" (…_select_propio) ni la de DELETE (pedidos_delete_admin
--  sigue siendo SOLO admin; la UI de borrado ya está desactivada).
--
--  Cómo aplicarlo: pegar en el editor SQL de Supabase, EN ESTE ORDEN.
-- ============================================================================


-- ── PASO 0 · INSPECCIONAR ANTES DE TOCAR ────────────────────────────────────
-- Los nombres de abajo son los del runbook aplicado (MIGRACION-AUTH-RUNBOOK.md).
-- Confirma que existen tal cual y que sus expresiones dicen
--   public.current_user_role() = 'admin'
-- Si algún nombre difiere, ajusta los ALTER POLICY del paso 1 a los nombres reales.

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('pedidos', 'profiles')
order by tablename, cmd, policyname;

-- Se espera ver, entre otras:
--   pedidos  | pedidos_select_admin  | SELECT | (current_user_role() = 'admin')
--   pedidos  | pedidos_update_admin  | UPDATE | (current_user_role() = 'admin')  + with_check igual
--   pedidos  | pedidos_delete_admin  | DELETE | (current_user_role() = 'admin')  ← NO se toca
--   profiles | profiles_select_admin | SELECT | (current_user_role() = 'admin')


-- ── PASO 1 · APLICAR (una sola transacción) ─────────────────────────────────
-- Se AMPLÍAN las políticas de admin para aceptar también 'almacen'. Se
-- mantienen los nombres para no romper referencias en la documentación.

begin;

alter policy "pedidos_select_admin" on public.pedidos
  using (public.current_user_role() in ('admin', 'almacen'));

alter policy "pedidos_update_admin" on public.pedidos
  using      (public.current_user_role() in ('admin', 'almacen'))
  with check (public.current_user_role() in ('admin', 'almacen'));

alter policy "profiles_select_admin" on public.profiles
  using (public.current_user_role() in ('admin', 'almacen'));

commit;


-- ── PASO 2 · VERIFICAR ───────────────────────────────────────────────────────
-- Deben salir exactamente 3 filas con 'almacen' en la expresión, y
-- pedidos_delete_admin NO debe aparecer (sigue siendo solo admin).

select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('pedidos', 'profiles')
  and (qual like '%almacen%' or with_check like '%almacen%')
order by tablename, policyname;

-- Prueba funcional (con la app): entrar como la cuenta de almacén, ir al
-- dashboard, ver pedidos de montadores + almacén + usuarios, cambiar el estado
-- de un pedido y recargar: debe persistir. Un montador sigue viendo solo lo suyo.


-- ── VUELTA ATRÁS (segundos) ──────────────────────────────────────────────────
-- Devuelve las tres políticas a solo-admin.

-- begin;
-- alter policy "pedidos_select_admin" on public.pedidos
--   using (public.current_user_role() = 'admin');
-- alter policy "pedidos_update_admin" on public.pedidos
--   using (public.current_user_role() = 'admin')
--   with check (public.current_user_role() = 'admin');
-- alter policy "profiles_select_admin" on public.profiles
--   using (public.current_user_role() = 'admin');
-- commit;
