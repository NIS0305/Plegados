# Plan de migración de seguridad

> ## ✅ LISTO PARA APLICAR — con la secuencia de despliegue por delante
>
> Ya hay acceso a la consola de Supabase y el bloqueo anterior queda levantado.
> El interruptor `BORRADO_HABILITADO` de `dashboard.js` se ha puesto en
> **`false`**. Aun así, el orden importa y no se salta:
>
> 1. `BORRADO_HABILITADO = false` en `dashboard.js` — **hecho en el repo**.
> 2. **Desplegar** ese cambio en producción.
> 3. Verificar en el panel que ya no aparece ningún botón de borrado
>    (papelera de pedido, papelera de usuario, "Borrar todos").
> 4. **Solo entonces**, aplicar el bloque SQL de la Parte 1.5.
>
> Motivo del orden: PostgREST NO devuelve error cuando una política deniega un
> `DELETE` (responde 204 con cero filas, no un error). Si el SQL se aplicara con
> los botones aún visibles, el panel diría "eliminado" mientras el dato sigue
> ahí. Con el flag ya en `false`, basta con desplegar y confirmar el paso 3
> antes de tocar la consola.

Estado del documento: **plan, no ejecutado**. Ninguna sentencia SQL de este
fichero se ha aplicado. Las de la Parte 1.5 están pensadas para ejecutarse a
mano en la consola del proveedor, con su vuelta atrás al lado.

En todo el documento, `<PROYECTO>` y `<CLAVE_ANON>` son marcadores: sustitúyelos
por los valores reales al ejecutar. No se escriben aquí.

---

## 0. Punto de partida

La aplicación autentica por su cuenta, en el navegador:

- Contraseña + cadena fija global → SHA-256 → hexadecimal. Sin salt por usuario,
  sin derivación lenta.
- El hash se calcula en el cliente y se compara en el cliente contra la fila
  leída de la tabla `users`.
- La sesión es un objeto JSON en `sessionStorage`. El rol viaja dentro.
- Las políticas de seguridad a nivel de fila (RLS) están **desactivadas**.

Consecuencia: cualquiera con la clave pública del cliente —que se sirve a todo
visitante— puede operar contra la API REST sin autenticarse. Puede leer todos
los pedidos, leer la tabla de usuarios con sus hashes, insertar filas, y borrar.

### Qué se ha cerrado ya (contención, rama `seguridad-contencion`)

- Eliminada la página de datos de prueba, que exponía credenciales de
  demostración y una segunda copia de la cadena de refuerzo.
- Eliminado el código de administrador del JavaScript del cliente. El registro
  de administrador ya no existe en la interfaz; `registerUser()` crea siempre un
  `montador`. La promoción es manual (ver `README.md`).

Esto reduce la superficie, pero **no cierra la escalada de privilegios**: con RLS
desactivado, cualquiera puede insertar directamente una fila en `users` con
`role: 'admin'` contra la API REST. Eso es lo que ataca la Parte 1.5.

---

## Parte 1.5 — Contención en base de datos (sin migrar la autenticación)

> ### ⚠️ Condición previa, obligatoria
>
> **`BORRADO_HABILITADO = false` en `dashboard.js` tiene que estar desplegado
> en producción antes de ejecutar una sola línea de este SQL.**
>
> Ese flag —hoy en `true`, ver el bloqueo del principio del documento— controla
> los tres botones de borrado del panel: pedido individual, borrado masivo y
> eliminar usuario. Con el flag en `false` y desplegado, los botones desaparecen.
> Si el SQL se aplica mientras siguen visibles, dejan de funcionar **en
> silencio** —ver el apartado siguiente— y el panel prometerá algo que ya no
> cumple.
>
> Comprobación de que la condición se cumple: entrar al panel como
> administrador y verificar que **no aparece ningún icono de papelera** ni el
> botón "Borrar todos".

Objetivo acotado: **cerrar la escalada a administrador y los borrados**, que son
los daños irreversibles. Se asume explícitamente que la lectura de todos los
pedidos y de la tabla de usuarios **sigue expuesta** hasta la migración
completa; eso lo resuelve la Parte 2.

*Nota histórica: una versión anterior de este documento partía la aplicación en
dos fases, con una política temporal de `DELETE` sobre `users`, para poder
adelantar parte del cierre sin desplegar código. Al decidirse desplegar primero,
ese apaño deja de tener sentido y se ha eliminado: se va directo al estado
final.*

---

### Lo que hay que saber antes de ejecutar

Tres comportamientos que explican por qué el SQL está escrito como está.

**1. Activar RLS deniega todo lo que no tenga política.** No es un filtro que se
añade encima de los permisos actuales: es un cambio a lista blanca. Todo lo que
la aplicación necesite seguir haciendo tiene que tener su política explícita.

**2. Sin política de `SELECT` sobre `users`, nadie puede iniciar sesión.** El
inicio de sesión lee la fila del usuario para comparar el hash en el cliente. Si
la lectura devuelve vacío, el mensaje que verá todo el mundo es "No existe una
cuenta con ese email". Por eso el bloque de abajo activa RLS y crea las
políticas permisivas necesarias **en la misma transacción**; no ejecutes el
`ALTER TABLE` suelto.

**3. Las denegaciones son silenciosas, no ruidosas.** PostgREST no devuelve
error cuando una política impide un `DELETE` o un `UPDATE`: responde 204 con
cero filas afectadas. En el código, `if (error) throw error` no salta. Esa es la
razón de la condición previa: sin el despliegue, la interfaz mostraría su
mensaje de éxito y el dato seguiría ahí.

---

### Qué se cierra y qué se pierde

Repaso de cada operación que la aplicación realiza hoy, comprobada en el código.

#### Tabla `users`

| Operación | Dónde | ¿Sobrevive? |
|---|---|---|
| `SELECT *` por email (inicio de sesión) | `auth.js` | Sí |
| `SELECT id` por email (duplicados en el alta) | `auth.js` | Sí |
| `SELECT *` ordenado (lista de usuarios del panel) | `supabase.js` | Sí |
| `INSERT` (alta de montador) | `supabase.js` | Sí — cumple el CHECK |
| `UPDATE` | **no existe en el código** | No aplica |
| `DELETE` (botón del panel) | `supabase.js` ← `dashboard.js` | **No.** Botón ya retirado |

El `INSERT` con `WITH CHECK (role = 'montador')` es **la pieza más importante de
toda la Parte 1.5**: cierra la escalada a administrador, que es el único fallo
que concede control total de la aplicación. Funciona porque el alta desde la
interfaz ya crea siempre un montador, así que la comprobación se cumple sola.

No hay ninguna actualización de usuarios en el código, de modo que denegar
`UPDATE` no rompe nada y además bloquea la vía de "me doy de alta como montador
y luego me asciendo".

A partir de aquí, dar de baja a alguien es una operación de consola:

```sql
DELETE FROM public.users WHERE email = 'direccion@ejemplo.com';
```

#### Tabla `pedidos`

| Operación | Dónde | ¿Sobrevive? |
|---|---|---|
| `SELECT` con filtro por usuario | `supabase.js` | Sí |
| `upsert` (alta de pedido) | `supabase.js` ← `app.js` | Sí — necesita INSERT **y** UPDATE |
| `UPDATE` de estado y nota interna | `supabase.js` ← `dashboard.js` | Sí |
| Suscripción en tiempo real | `supabase.js` | Sí — depende de la política de `SELECT` |
| `DELETE` individual | `dashboard.js` | **No.** Botón ya retirado |
| `DELETE` masivo | `dashboard.js` | **No.** Botón ya retirado |

Dos trampas:

- **El alta usa `upsert`, no `insert`.** Un upsert es `INSERT ... ON CONFLICT DO
  UPDATE`, y PostgREST exige que existan **las dos** políticas. Si solo creas la
  de `INSERT`, el alta de pedidos falla. La de `UPDATE` no es opcional aquí.
- **El tiempo real depende de la política de `SELECT`.** La suscripción evalúa
  RLS por suscriptor. Con `USING (true)` sigue funcionando, pero es lo más sutil
  del bloque: si el panel deja de actualizarse solo, es aquí. Está en la lista
  de comprobación por eso.

Borrado puntual desde consola, cuando haga falta de verdad:

```sql
DELETE FROM public.pedidos WHERE id = <id_del_pedido>;
```

#### Bucket de dibujos

Menos arriesgado de lo que parece, por tres razones comprobadas en el código:

- La subida ocurre **una sola vez**, al crear el pedido, con la ruta
  `<id_del_pedido>.<extensión>`. El identificador se genera en ese momento y es
  nuevo, así que la ruta nunca existe previamente.
- **No hay ningún flujo de resubida** en toda la aplicación: ni edición de
  adjunto, ni reemplazo desde el panel. La opción de sobrescritura que usa la
  subida nunca llega a sobrescribir nada.
- El fallo de subida **ya está contemplado**: se captura, se avisa al usuario y
  el pedido se guarda igualmente sin imagen. Aunque la política quedara mal, el
  alta de pedidos no se rompe; se degradaría a pedidos sin dibujo.

La lectura seguirá funcionando porque el bucket es público y las descargas
públicas no evalúan políticas. **No conviertas el bucket en privado en este
paso:** rompería todas las imágenes, porque la aplicación construye URLs
públicas. Ese cambio va en la Parte 2, junto con el paso a URLs firmadas.

---

### Paso previo: inventariar las políticas del bucket

Esto no se puede hacer a ciegas, porque hay que retirar por su nombre las
políticas amplias que existan hoy sobre el almacenamiento. Ejecuta primero:

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'dibujos';

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';
```

**Guarda el resultado completo antes de continuar.** Es la única parte de la
Parte 1.5 cuya vuelta atrás no es una línea fija: para restaurarla hay que
volver a crear las políticas que retires, y para eso hace falta su definición.

---

### SQL — bloque único

Orden: bucket → `users` → `pedidos`. Copiable de una vez.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
--  CONTENCIÓN — Parte 1.5
--  REQUIERE: rama `seguridad-contencion` desplegada en producción.
--  Verificar antes: el panel de administración no muestra ningún botón de
--  borrado (papelera de pedido, papelera de usuario, "Borrar todos").
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) BUCKET DE DIBUJOS
--    Solo subida. Sin UPDATE ni DELETE: cierra sobrescritura y borrado.
--    La lectura no pasa por aquí (bucket público).
-- ───────────────────────────────────────────────────────────────────────────

CREATE POLICY "p15_dibujos_insert_anon"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'dibujos');

-- Retirar las políticas amplias existentes sobre el bucket. Sustituye los
-- nombres por los que haya devuelto la consulta del paso previo. Si no había
-- ninguna, borra estas líneas.
-- DROP POLICY "<nombre_politica_amplia_1>" ON storage.objects;
-- DROP POLICY "<nombre_politica_amplia_2>" ON storage.objects;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) TABLA users
--    Lectura abierta (necesaria para el inicio de sesión).
--    Alta restringida a montadores  -> cierra la escalada a administrador.
--    Sin UPDATE ni DELETE.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Abierta A PROPÓSITO: el inicio de sesión compara el hash en el cliente y
-- necesita leer la fila. No empeora la exposición actual; la deja igual.
-- Se cierra en la Parte 2.
CREATE POLICY "p15_users_select_anon"
  ON public.users FOR SELECT TO anon
  USING (true);

-- ★ La pieza clave de toda la Parte 1.5.
CREATE POLICY "p15_users_insert_montador_anon"
  ON public.users FOR INSERT TO anon
  WITH CHECK (role = 'montador');

-- Sin política de UPDATE -> denegado. No rompe nada: no existe ninguna
--   actualización de usuarios en el código. Bloquea el ascenso de una cuenta.
-- Sin política de DELETE -> denegado. Las bajas pasan a consola.

-- ───────────────────────────────────────────────────────────────────────────
-- 3) TABLA pedidos
--    Lectura, alta y actualización se mantienen. Sin DELETE.
--    OJO: la política de UPDATE es imprescindible para que el `upsert` del
--    alta funcione, no solo para el cambio de estado.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

-- Abierta A PROPÓSITO. Además, el tiempo real depende de esta política.
CREATE POLICY "p15_pedidos_select_anon"
  ON public.pedidos FOR SELECT TO anon
  USING (true);

CREATE POLICY "p15_pedidos_insert_anon"
  ON public.pedidos FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "p15_pedidos_update_anon"
  ON public.pedidos FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

-- Sin política de DELETE -> denegado.

COMMIT;
```

---

### Comprobación posterior

Recórrela entera. El orden importa: los fallos de los puntos 4 y 5 son los que
más tardan en notarse en producción.

**En la aplicación**

1. **Inicio de sesión de montador.** Entra con una cuenta de montador.
   *Si falla aquí, falta la política de `SELECT` sobre `users`: vuelta atrás.*
2. **Inicio de sesión de administrador.** Entra al panel.
3. **Registro.** Crea un montador nuevo desde la pantalla de registro.
4. **Alta de pedido con adjunto.** Da de alta un pedido **con imagen** desde la
   vista de montador. Debe guardarse y la imagen debe verse.
   *Si el pedido se guarda pero avisa de que no pudo subir el archivo, el
   problema está en las políticas del bucket, no en las de tabla.*
5. **Tiempo real.** Con el panel de administración abierto **en otra pestaña**,
   repite el punto 4. El pedido nuevo debe aparecer en el panel **sin recargar**.
   *Esta es la prueba más importante y la más fácil de olvidar. Si falla, la
   causa está en la política de `SELECT` de `pedidos`.*
6. **Cambio de estado.** Cambia el estado del pedido desde el panel y recarga
   para confirmar que persistió.
7. **Nota interna.** Escribe una nota de administración sobre un pedido.
8. **Historial del montador.** Comprueba que el montador ve su pedido con el
   estado actualizado.
9. **Lista de usuarios.** Despliega el panel de usuarios y comprueba que se
   sigue poblando.
10. **Ausencia de botones de borrado.** Confirma que no hay ninguna papelera ni
    botón "Borrar todos".

**Contra la API, con la clave pública**

```bash
# 11) Debe FALLAR con violación de política.
#     Es LA prueba de que la escalada a administrador está cerrada.
curl -s -X POST "https://<PROYECTO>.supabase.co/rest/v1/users" \
  -H "apikey: <CLAVE_ANON>" -H "Content-Type: application/json" \
  -d '{"id":9999999999999,"nombre":"prueba","email":"prueba-rls@ejemplo.com",
       "password_hash":"x","role":"admin","creado_el":"01/01/2026"}'

# 12) Debe funcionar: el alta legítima de montador sigue permitida.
curl -s -X POST "https://<PROYECTO>.supabase.co/rest/v1/users" \
  -H "apikey: <CLAVE_ANON>" -H "Content-Type: application/json" \
  -d '{"id":9999999999998,"nombre":"prueba","email":"prueba-ok@ejemplo.com",
       "password_hash":"x","role":"montador","creado_el":"01/01/2026"}'

# 13) Debe devolver 0 filas afectadas (no borra).
curl -s -X DELETE "https://<PROYECTO>.supabase.co/rest/v1/users?id=eq.9999999999998" \
  -H "apikey: <CLAVE_ANON>" -i | head -1

# 14) Debe devolver 0 filas afectadas (no borra).
curl -s -X DELETE "https://<PROYECTO>.supabase.co/rest/v1/pedidos?id=eq.<ID_REAL>" \
  -H "apikey: <CLAVE_ANON>" -i | head -1
```

Limpia después la fila de prueba que sí se creó en el punto 12, desde la
consola:

```sql
DELETE FROM public.users WHERE email IN ('prueba-ok@ejemplo.com', 'prueba-rls@ejemplo.com');
```

---

### Vuelta atrás completa

Un solo bloque. Devuelve el sistema exactamente al estado previo y tarda
segundos.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
--  VUELTA ATRÁS — Parte 1.5
--  Deja el sistema como estaba antes de aplicar la contención.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Desactivar RLS. Con esto solo, el comportamiento vuelve al de antes de
--    forma inmediata, aunque las políticas sigan creadas (quedan inertes).
ALTER TABLE public.pedidos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users   DISABLE ROW LEVEL SECURITY;

-- 2) Eliminar las políticas creadas.
DROP POLICY IF EXISTS "p15_pedidos_select_anon"          ON public.pedidos;
DROP POLICY IF EXISTS "p15_pedidos_insert_anon"          ON public.pedidos;
DROP POLICY IF EXISTS "p15_pedidos_update_anon"          ON public.pedidos;

DROP POLICY IF EXISTS "p15_users_select_anon"            ON public.users;
DROP POLICY IF EXISTS "p15_users_insert_montador_anon"   ON public.users;

DROP POLICY IF EXISTS "p15_dibujos_insert_anon"          ON storage.objects;

COMMIT;

-- 3) Restaurar las políticas amplias del bucket que se retiraron al aplicar,
--    usando la definición guardada en el paso previo. Ejemplo de la forma que
--    suelen tener; sustituye por las tuyas:
--
-- CREATE POLICY "<nombre_original>" ON storage.objects
--   FOR ALL TO anon
--   USING (bucket_id = 'dibujos') WITH CHECK (bucket_id = 'dibujos');
```

Si solo quieres revertir una parte, el paso 1 admite ejecutarse por tabla: basta
con desactivar RLS de la tabla afectada y dejar la otra como está.

**Vuelta atrás del código**, si además hiciera falta recuperar los botones de
borrado del panel: poner `BORRADO_HABILITADO = true` en `dashboard.js` **y**
haber revertido antes las políticas de `DELETE`. Solo lo primero reproduce
exactamente el fallo silencioso que el interruptor evita.

---

### Qué sigue expuesto después de esto

Consciente y asumido hasta la Parte 2:

- **Lectura de todos los pedidos** por cualquiera con la clave pública.
- **Lectura de la tabla de usuarios**, hashes de contraseña incluidos.
- **Alta de montadores no solicitada** contra la API. Molesto, reversible, y sin
  acceso a nada que no estuviera ya expuesto.
- **Subida de ficheros arbitrarios** al bucket. Restringirlo requiere saber
  quién sube, y eso no existe hasta la migración.

Lo que **ya no** es posible: ascender a administrador, modificar usuarios,
borrar usuarios, borrar pedidos, y sobrescribir o borrar dibujos.

## Parte 2 — Migración a la autenticación del proveedor

### 2.1 Por qué no hay migración silenciosa de contraseñas

Los hashes actuales son SHA-256 con una cadena fija, en hexadecimal. El sistema
de autenticación del proveedor almacena bcrypt y no acepta que le inyectes
hashes de otro algoritmo. No existe forma de importar las contraseñas actuales
tal cual.

Hay dos caminos.

**Camino A — Restablecimiento dirigido (recomendado).** El número de usuarios en
producción es muy pequeño; el coste de coordinación es de una tarde.

1. Exportar la lista de usuarios actuales:
   ```sql
   SELECT id, nombre, email, role, creado_el FROM public.users ORDER BY creado_el;
   ```
2. Crear cada cuenta con la API de administración del proveedor, con el correo ya
   confirmado y una contraseña aleatoria larga que nadie va a usar.
3. Rellenar la tabla de perfiles con el rol correspondiente (2.2).
4. Generar un enlace de recuperación por usuario y enviárselo por el canal
   habitual del taller.
5. Ventana de corte anunciada: "el lunes a las 8:00 hay que poner contraseña
   nueva". Con pocos usuarios, esto se gestiona con un mensaje.

**Camino B — Migración perezosa en el primer inicio de sesión.** Sin fricción
para el usuario, pero alarga la exposición.

En el formulario de acceso, si el correo aún no existe en el sistema nuevo, se
valida contra el hash antiguo con el código actual; si cuadra, se crea la cuenta
nueva **con la contraseña en claro que el usuario acaba de escribir** y se marca
la fila antigua como migrada.

Funciona porque en ese instante tienes la contraseña en claro. El precio es que
la tabla `users` antigua y su lectura abierta tienen que seguir vivas durante
toda la ventana de migración, que es justo lo que queremos cerrar. Y hay que
mantener dos caminos de acceso a la vez, con el riesgo de fallo que eso trae.

**Recomendación: camino A.** El B solo compensa si no puedes contactar con los
usuarios, y aquí sí puedes.

### 2.2 Dónde vive el rol

Dos opciones:

- **Tabla de perfiles** ligada a la tabla de usuarios de autenticación. Se
  consulta desde las políticas. Cambiar un rol tiene efecto inmediato.
- **Reclamación dentro del token.** Más rápido (no hay consulta por fila), pero
  el rol viaja en el token y no se actualiza hasta que el usuario vuelve a
  entrar.

**Recomendada: tabla de perfiles**, por la revocación inmediata y porque el
volumen no justifica optimizar.

```sql
CREATE TABLE public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  role       text NOT NULL DEFAULT 'montador'
             CHECK (role IN ('montador','admin')),
  creado_el  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
```

Función auxiliar para consultarlo desde las políticas. **Tiene que ser
`SECURITY DEFINER`**: si una política sobre `profiles` consultara `profiles`
directamente, Postgres entraría en recursión infinita. Este es el error clásico
de este montaje.

```sql
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
```

Alta automática de perfil al crear una cuenta:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nombre', NEW.email), 'montador');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

El rol por defecto es siempre `montador`. Promocionar sigue siendo manual:

```sql
UPDATE public.profiles SET role = 'admin' WHERE id = '<uuid>';
```

### 2.3 Cambio de clave en `pedidos`

Hoy `pedidos.user_id` es un entero (marca de tiempo). Las cuentas nuevas usan
UUID. Hace falta una columna nueva y un relleno:

```sql
ALTER TABLE public.pedidos ADD COLUMN user_uid uuid REFERENCES auth.users(id);

-- Relleno: cruzar por correo entre la tabla antigua y la nueva.
UPDATE public.pedidos p
SET user_uid = a.id
FROM public.users u
JOIN auth.users a ON lower(a.email) = lower(u.email)
WHERE p.user_id = u.id;

-- Verificar que no queda ninguno huérfano ANTES de seguir.
SELECT count(*) AS sin_asignar FROM public.pedidos WHERE user_uid IS NULL;

CREATE INDEX idx_pedidos_user_uid ON public.pedidos(user_uid);
```

Si el recuento no da cero, hay pedidos de usuarios que ya no existen. Decidir
entonces: asignarlos a una cuenta de sistema o dejarlos visibles solo para
administración. **No sigas con la columna a `NOT NULL` hasta que dé cero.**

### 2.4 Políticas definitivas

```sql
-- ─── profiles ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_propio"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

-- Nadie cambia roles desde la aplicación: sin INSERT, UPDATE ni DELETE.
-- El alta la hace el disparador (SECURITY DEFINER) y los cambios, la consola.

-- ─── pedidos ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pedidos_select_propio"
  ON public.pedidos FOR SELECT TO authenticated
  USING (user_uid = auth.uid());

CREATE POLICY "pedidos_select_admin"
  ON public.pedidos FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

-- El montador solo puede crear pedidos a su propio nombre.
CREATE POLICY "pedidos_insert_propio"
  ON public.pedidos FOR INSERT TO authenticated
  WITH CHECK (user_uid = auth.uid());

-- Estados y notas internas: solo administración.
CREATE POLICY "pedidos_update_admin"
  ON public.pedidos FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "pedidos_delete_admin"
  ON public.pedidos FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- El rol anónimo no recibe ninguna política: queda sin acceso a nada.
```

Detalle a no pasar por alto: al pasar a políticas de INSERT por usuario, **el
alta ya no puede usar `upsert`**. Un upsert necesita también política de UPDATE,
y el montador no la tiene. Hay que cambiar `savePedido()` a un `insert` normal.
Es un cambio de una línea, pero si se olvida, el alta falla en producción.

Bucket de dibujos, ya con usuarios reales:

```sql
CREATE POLICY "dibujos_insert_autenticado"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dibujos');

CREATE POLICY "dibujos_select_autenticado"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dibujos');
```

Y pasar el bucket a privado, sustituyendo las URLs públicas por URLs firmadas de
duración corta. Esto **obliga a tocar el cliente** en los tres puntos donde hoy
se construye la URL pública de un dibujo.

### 2.5 Cambios en el cliente

**Se elimina** de `auth.js`: el cálculo de hash y su cadena fija, el registro
propio, el inicio de sesión propio, y la sesión en `sessionStorage`.

**Se sustituye** por las llamadas de autenticación del proveedor: registro,
inicio de sesión con correo y contraseña, obtención de sesión, escucha de
cambios de sesión y cierre de sesión.

El punto que más ramifica:

```js
// Antes — síncrono
function requireAuth() {
  const u = getCurrentUser();
  if (!u) { window.location.href = 'login.html'; return null; }
  return u;
}

// Después — asíncrono: hay que consultar sesión y perfil
async function requireAuth() { /* ... */ }
```

`requireAuth()` y `requireAdmin()` pasan a ser asíncronas. Hoy se llaman de
forma síncrona al principio de `app.js` y `dashboard.js`, así que **todo el
arranque de esas dos páginas tiene que envolverse en una función asíncrona**. Es
el cambio con más superficie de toda la migración y donde es más fácil dejar una
página en blanco sin darse cuenta.

Otros ajustes: `savePedido()` deja de usar upsert; hay que escribir `user_uid` en
vez de `user_id`; y las URLs de dibujo pasan a firmadas.

Se retira además, ya en desuso: la tabla `users` antigua (después de verificar
la migración) y las funciones `insertDbUser`, `deleteDbUser` y `getDbUsers`, que
pasan a leer de `profiles`.

### 2.6 Orden de despliegue y vuelta atrás

Cada paso es reversible por sí solo. **No encadenes dos sin probar el primero.**

| # | Paso | Vuelta atrás |
|---|---|---|
| 1 | Crear `profiles`, la función auxiliar y el disparador. Sin activar RLS todavía | `DROP` de tabla, función y disparador. La aplicación ni se entera |
| 2 | Añadir `pedidos.user_uid` y rellenarla. Verificar que no quedan huérfanos | `ALTER TABLE ... DROP COLUMN user_uid` |
| 3 | Crear las cuentas nuevas y sus perfiles. Sin tocar la aplicación | Borrar las cuentas creadas |
| 4 | Desplegar el cliente nuevo **en una URL de vista previa**, apuntando a la misma base | Ninguna: producción sigue con el cliente viejo |
| 5 | Probar en la vista previa los dos roles de punta a punta | — |
| 6 | Ventana de corte: enviar los enlaces de restablecimiento | — |
| 7 | Promocionar la vista previa a producción | Volver a desplegar el commit anterior. Es lo más rápido que hay |
| 8 | Activar RLS y crear las políticas definitivas | `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` en las dos tablas |
| 9 | Verificar que el acceso anónimo devuelve vacío (2.7) | — |
| 10 | **Rotar la clave pública** del proyecto y desplegar el cliente con la nueva | Volver a la clave anterior mientras se corrige |
| 11 | Bucket a privado y URLs firmadas | Volver a marcar el bucket como público |
| 12 | Retirar la tabla `users` antigua, tras una copia de seguridad | Restaurar desde la copia |

El paso 8 es el único con corte de servicio real si algo va mal. Hazlo con el
cliente nuevo ya en producción y estable, no a la vez.

El paso 10 es el que de verdad cierra la puerta: mientras la clave antigua siga
siendo válida, cualquiera que la copiara del código sigue teniéndola. Una clave
pública no es un secreto, pero sí es un identificador que conviene renovar
cuando el modelo de acceso cambia.

### 2.7 Verificación final

La prueba de que el problema está resuelto es que **una petición anónima con la
clave pública deje de devolver filas**:

```bash
# Antes de la migración: devuelve filas.
# Después: debe devolver [] o un error de permisos.
curl -s "https://<PROYECTO>.supabase.co/rest/v1/pedidos?select=id&limit=5" \
  -H "apikey: <CLAVE_ANON>"

curl -s "https://<PROYECTO>.supabase.co/rest/v1/users?select=id&limit=5" \
  -H "apikey: <CLAVE_ANON>"

curl -s "https://<PROYECTO>.supabase.co/rest/v1/profiles?select=id&limit=5" \
  -H "apikey: <CLAVE_ANON>"
```

Las tres deben devolver colección vacía. Comprobar además:

```bash
# Con sesión de montador: solo sus pedidos, no los de otros.
curl -s "https://<PROYECTO>.supabase.co/rest/v1/pedidos?select=id,user_uid" \
  -H "apikey: <CLAVE_ANON>" -H "Authorization: Bearer <TOKEN_MONTADOR>"

# Debe FALLAR: un montador intentando ascenderse.
curl -s -X PATCH "https://<PROYECTO>.supabase.co/rest/v1/profiles?id=eq.<SU_UUID>" \
  -H "apikey: <CLAVE_ANON>" -H "Authorization: Bearer <TOKEN_MONTADOR>" \
  -H "Content-Type: application/json" -d '{"role":"admin"}'
```

Y en el navegador: manipular a mano el almacenamiento de sesión para ponerse
`role: admin` y comprobar que **la base de datos sigue negando** los datos que no
corresponden. Ese es el resultado que hoy no se cumple y que da sentido a toda la
migración.

### 2.8 Esfuerzo estimado

| Paso | Horas |
|---|---:|
| Parte 1.5 completa: aplicar, probar y documentar | 2 |
| Tabla de perfiles, función auxiliar y disparador | 1,5 |
| Columna `user_uid`, relleno y verificación de huérfanos | 2 |
| Alta de las cuentas nuevas y sus perfiles | 1,5 |
| Reescritura de `auth.js` sobre la autenticación del proveedor | 3 |
| Conversión a asíncrono de las guardas y del arranque de las dos páginas | 4 |
| Ajustes en la capa de datos (upsert → insert, `user_uid`, perfiles) | 2 |
| Redacción y pruebas de las políticas definitivas | 3 |
| Pruebas de punta a punta en vista previa, con los dos roles | 3 |
| Ventana de corte y acompañamiento a los usuarios | 2 |
| Rotación de clave y despliegue | 1 |
| Bucket privado y URLs firmadas | 2,5 |
| Retirada de la tabla antigua y limpieza | 1 |
| **Total** | **27,5 h** |

Reparto realista: la Parte 1.5 en una sesión corta, y la Parte 2 en tres o
cuatro sesiones, con la ventana de corte en horario de baja actividad del
taller.

---

## Riesgos aceptados

Decisiones tomadas a conciencia, no olvidos.

**1. El historial de git conserva la cadena de refuerzo y las credenciales de
demostración.** No se reescribe. La cadena ya se sirve hoy a cualquier visitante
dentro de `auth.js`, así que su presencia en el historial no añade exposición
nueva; y reescribir el historial de un repositorio compartido, con despliegue
continuo y bajo la cuenta de otra persona, tiene un coste de coordinación y un
riesgo de rotura que no compensan. Se revisará si el repositorio se hace público.

**2. La cadena de refuerzo no se cambia en la contención.** Cambiarla invalidaría
todos los hashes existentes y dejaría fuera a todos los usuarios de golpe. Deja
de ser relevante en cuanto la autenticación pase al proveedor, momento en el que
desaparece del código.

**3. El borrado desde el panel se retira en vez de arreglarse.** Un diálogo de
confirmación en el cliente no aportaba seguridad ninguna: con RLS desactivado
cualquiera podía llamar a la API REST directamente y saltárselo. Lo que sí lo
cierra es la denegación de `DELETE` de la Parte 1.5. La rama
`seguridad-contencion` retira los tres botones (`BORRADO_HABILITADO` en
`dashboard.js`) para que la interfaz no prometa algo que la base de datos ya no
permite. El coste asumido es que borrar un pedido o dar de baja a un usuario
pasa a ser una operación de consola hasta la Parte 2, donde el borrado vuelve al
panel restringido al rol de administración y comprobado en el servidor.

**4. Tras la Parte 1.5, la lectura sigue abierta.** Cualquiera con la clave
pública puede leer todos los pedidos y la tabla de usuarios con sus hashes. Es
consciente: la Parte 1.5 ataca solo lo irreversible. Lo cierra la Parte 2.

**5. Tras la Parte 1.5, el alta de montadores sigue abierta.** Se pueden crear
cuentas de montador no solicitadas contra la API. Molesto, reversible, y sin
acceso a nada que no estuviera ya expuesto.
