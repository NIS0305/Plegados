-- ============================================================================
--  ESTADOS-REVISION.sql · revisar los valores de pedidos.estado
--  Rama: estados-tablero
--
--  Lista OFICIAL (valores exactos; n8n/Telegram ya escriben 'Completado'):
--    Pendiente → En taller → Completado → Entregado a montador | Entregado a reparto
--  Por hacer   = Pendiente, En taller
--  Finalizados = Completado, Entregado a montador, Entregado a reparto
--
--  La app ya no ofrece 'En proceso'. Si queda algún pedido con un valor fuera de
--  la lista, el dashboard lo muestra como "<valor> (no oficial)" en el selector
--  y lo cuenta en "Por hacer" hasta que se corrija. Nada se cambia solo:
--  el PASO 1 va comentado y lo decides tú tras ver el PASO 0.
-- ============================================================================


-- ── PASO 0 · VER (solo lectura) ─────────────────────────────────────────────
-- a) Recuento por estado.
select estado, count(*) from pedidos group by estado order by 2 desc;

-- b) Solo los valores que NO están en la lista oficial (incluye NULL y
--    variantes con espacios o mayúsculas distintas).
select estado, count(*) as pedidos, min(id) as primer_id, max(id) as ultimo_id
from pedidos
where estado is null
   or estado not in ('Pendiente', 'En taller', 'Completado', 'Entregado a montador', 'Entregado a reparto')
group by estado
order by 2 desc;

-- c) Detalle de esos pedidos, para decidir uno a uno si hace falta.
select id, fecha, montador, referencia, estado, origen
from pedidos
where estado is null
   or estado not in ('Pendiente', 'En taller', 'Completado', 'Entregado a montador', 'Entregado a reparto')
order by id;


-- ── PASO 1 · CORREGIR (COMENTADO: descomenta solo lo que decidas) ───────────
-- 'En proceso' era el antiguo "se está fabricando" → hoy es 'En taller'.
-- begin;
-- update pedidos set estado = 'En taller' where estado = 'En proceso';
-- commit;

-- Variantes de escritura de un valor oficial (espacios, mayúsculas). Revisa
-- antes con el PASO 0 c); esta sentencia solo toca filas cuyo valor, sin
-- espacios y en minúsculas, coincide EXACTAMENTE con uno oficial.
-- begin;
-- update pedidos p set estado = o.oficial
-- from (values ('Pendiente'), ('En taller'), ('Completado'),
--              ('Entregado a montador'), ('Entregado a reparto')) as o(oficial)
-- where lower(btrim(p.estado)) = lower(o.oficial) and p.estado <> o.oficial;
-- commit;

-- Cualquier otro valor raro que salga en el PASO 0 b): decide a cuál pasa y
-- añade aquí su update, p. ej.:
-- update pedidos set estado = '<oficial>' where estado = '<valor raro>';


-- ── PASO 2 · BLINDAR (OPCIONAL, después del PASO 1) ─────────────────────────
-- Impide que se vuelvan a escribir valores fuera de la lista (app, n8n o
-- consola). Antes de activarlo, confirma que el PASO 0 b) ya no devuelve filas
-- y que n8n solo escribe valores oficiales; si no, ese insert/update fallará.
-- alter table pedidos add constraint pedidos_estado_oficial
--   check (estado in ('Pendiente', 'En taller', 'Completado', 'Entregado a montador', 'Entregado a reparto'));
-- Vuelta atrás: alter table pedidos drop constraint pedidos_estado_oficial;
