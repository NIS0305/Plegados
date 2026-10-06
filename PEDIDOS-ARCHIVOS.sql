-- ============================================================================
--  PEDIDOS-ARCHIVOS.sql · hasta 5 fotos/PDF por pedido
--  Rama: movil-montador · ejecutar ANTES de desplegar el cliente nuevo
--  (ejecútalo PRIMERO; el segundo es CHAT-TALLER.sql)
--
--  Qué hace:
--    · Añade pedidos.archivos jsonb NOT NULL DEFAULT '[]'
--      con la forma [{ "path": "...", "name": "...", "type": "..." }, ...] en orden.
--    · Limita a un array de 0..5 elementos.
--
--  Compatibilidad (no se toca nada de lo que ya existe):
--    · file_path / file_name / file_type siguen guardando el ARCHIVO 1, así que
--      n8n, Telegram, la etiqueta, el dashboard y los CSV siguen igual.
--    · Pedidos antiguos quedan con archivos = '[]' y el cliente usa file_path
--      como único plano.
--    · Storage: el bucket "dibujos" y su política de INSERT para usuarios
--      autenticados ("dibujos_insert_autenticado", bucket_id = 'dibujos', sin
--      restricción de ruta) ya cubren las rutas nuevas <pedidoId>_<n>.<ext>.
--      El cliente sube con upsert:false (solo necesita INSERT). El PASO 0 lo
--      comprueba.
-- ============================================================================


-- ── PASO 0 · INSPECCIONAR (solo lectura) ────────────────────────────────────
-- a) Tipo de pedidos.id (se espera bigint) y que archivos aún no existe.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'pedidos'
  and column_name in ('id', 'file_path', 'archivos');

-- b) Políticas de Storage del bucket dibujos. Debe haber un INSERT para
--    authenticated con with_check (bucket_id = 'dibujos') SIN condición de ruta.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%dibujos%';


-- ── PASO 1 · APLICAR ─────────────────────────────────────────────────────────
begin;

alter table public.pedidos
  add column if not exists archivos jsonb not null default '[]'::jsonb;

alter table public.pedidos
  drop constraint if exists pedidos_archivos_max5;
alter table public.pedidos
  add constraint pedidos_archivos_max5
  check (jsonb_typeof(archivos) = 'array' and jsonb_array_length(archivos) <= 5);

comment on column public.pedidos.archivos is
  'Planos del pedido en orden: [{path,name,type}], máx. 5, bucket dibujos. '
  'file_path/file_name/file_type repiten el archivo 1 por compatibilidad (n8n, etiqueta, CSV).';

commit;


-- ── PASO 2 · VERIFICAR ───────────────────────────────────────────────────────
-- Debe devolver: archivos | jsonb | '[]'::jsonb | NO
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'pedidos' and column_name = 'archivos';

-- Tras crear un pedido de prueba con varias fotos desde el móvil:
-- select id, file_path, jsonb_array_length(archivos) as n, archivos
-- from public.pedidos order by id desc limit 5;


-- ── VUELTA ATRÁS ─────────────────────────────────────────────────────────────
-- (el cliente nuevo reintenta sin "archivos" si la columna no existe, así que
--  quitarla no rompe el alta de pedidos; solo se pierden los planos 2..5)
-- alter table public.pedidos drop constraint if exists pedidos_archivos_max5;
-- alter table public.pedidos drop column if exists archivos;
