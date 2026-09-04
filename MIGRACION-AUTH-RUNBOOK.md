# Migración a Supabase Auth — Runbook

Cierra la última pieza de seguridad: la **lectura anónima** de la tabla de
usuarios (con sus hashes) que sigue abierta tras la Parte 1.5. Mueve la
autenticación del hash SHA-256 propio a **Supabase Auth**, y con eso el rol
`anon` deja de tener acceso a los datos.

Todo el **código del cliente** ya está hecho en la rama `migracion-auth` (sin
desplegar). Este runbook es lo que **tú** ejecutas: ajustes del panel de
Supabase, SQL en la consola, y el despliegue. Cada paso es reversible.

> Contexto real de esta instalación: solo hay **2 cuentas reales** (los admin
> `miquel@gmail.com` y `tavo.recio@gmail.com`). El resto de usuarios y los 4
> pedidos son de prueba y se pueden tirar. Por eso NO hay trasvase de datos: se
> crean las 2 cuentas nuevas y se descarta lo demás.

---

## 0. Antes de empezar

- Rama de código: `migracion-auth` (ya contiene el cliente reescrito).
- Proyecto Supabase: `bgigpjufjtclahbknuyx` ("Sistema Operativo TMI").
- Ten a mano el editor SQL de Supabase y la sección **Authentication**.
- Haz esto en una **URL de vista previa** primero (o en local), no directo a
  producción. El paso 6 es el único con corte real si algo falla.

---

## 1. Ajuste del panel: confirmación de email

`Authentication → Sign In / Providers → Email`:

- **Email** habilitado.
- **Confirm email: OFF.**  Con esto, cuando un montador se registra tiene sesión
  al instante (sin correo de confirmación). Los montadores del taller no siempre
  tienen un email que consulten, así que confirmar por correo los bloquearía.

  *Contrapartida:* cualquiera puede registrarse con cualquier email sin
  verificarlo. Es aceptable aquí: un montador solo ve y crea SUS pedidos. Si más
  adelante quieres cerrar el auto-registro, desactiva "Allow new users to sign
  up" y crea tú los montadores desde la consola.

---

## 2. SQL — Andamiaje (aditivo, no rompe la app actual)

Pega y ejecuta en el editor SQL. Crea la tabla de perfiles, la función de rol y
el disparador de alta. **No activa RLS todavía**; la app vieja sigue funcionando.

```sql
-- Perfiles: el rol vive aquí (incluye 'almacen', que el plan original omitía).
CREATE TABLE public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  role       text NOT NULL DEFAULT 'montador'
             CHECK (role IN ('montador','admin','almacen')),
  creado_el  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_role ON public.profiles(role);

-- Rol del usuario actual. SECURITY DEFINER para evitar recursión infinita
-- cuando una política sobre profiles necesite consultar profiles.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Alta automática de perfil (rol montador) al crear una cuenta.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nombre', NEW.email), 'montador');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Nueva clave de pedido: uuid del autor (las cuentas nuevas usan uuid).
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS user_uid uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_pedidos_user_uid ON public.pedidos(user_uid);
```

*Vuelta atrás:* `DROP TRIGGER on_auth_user_created ON auth.users; DROP FUNCTION public.handle_new_user; DROP FUNCTION public.current_user_role; DROP TABLE public.profiles; ALTER TABLE public.pedidos DROP COLUMN user_uid;`

---

## 3. Crear las 2 cuentas admin + limpiar lo de prueba

`Authentication → Users → Add user` (dos veces):

- `miquel@gmail.com`  — marca **Auto Confirm User**, pon una contraseña.
- `tavo.recio@gmail.com` — igual.

El disparador les crea el perfil como `montador`. Promuévelos a admin:

```sql
UPDATE public.profiles p SET role = 'admin'
FROM auth.users a
WHERE p.id = a.id
  AND lower(a.email) IN ('miquel@gmail.com','tavo.recio@gmail.com');
```

Tira los datos de prueba (usuarios y pedidos inventados). Se hacen invisibles
igualmente bajo el RLS del paso 6 (user_uid queda NULL), pero mejor limpiarlos:

```sql
DELETE FROM public.pedidos;   -- los 4 pedidos de prueba (mongolo/juan)
-- La tabla public.users antigua se retira en el paso 8, tras verificar todo.
```

---

## 4. Desplegar el cliente nuevo (rama migracion-auth) en vista previa

- Coolify: crea un despliegue de vista previa apuntando a la rama
  `migracion-auth`, o prueba en local sirviendo la carpeta.
- La misma base de datos. NO toca producción todavía.

## 5. Probar de punta a punta en la vista previa

Con las 2 cuentas admin ya creadas:

1. Login admin (`admin.html`) → entra al dashboard, se ven los datos.
2. Registro de montador nuevo (`login.html`, pestaña registro) → entra directo.
3. Alta de pedido con imagen desde la vista de montador → se guarda y se ve.
4. El pedido nuevo aparece en el dashboard admin (tiempo real).
5. Cambiar estado y escribir una nota desde el panel → persisten.
6. Cerrar sesión y volver a entrar.

*Aún estás con RLS de la Parte B (anon abierto). El siguiente paso lo cierra.*

---

## 6. Promover a producción y activar el RLS definitivo

Primero **despliega la rama a producción** (merge de `migracion-auth` a `main` +
redeploy en Coolify) y confirma que el login funciona. **Solo entonces** ejecuta
el SQL de políticas — así, si algo falla, es con el cliente nuevo ya estable.

```sql
BEGIN;

-- PEDIDOS: reemplazar las políticas anon de la Parte B por las definitivas.
DROP POLICY IF EXISTS "p15_pedidos_select_anon" ON public.pedidos;
DROP POLICY IF EXISTS "p15_pedidos_insert_anon" ON public.pedidos;
DROP POLICY IF EXISTS "p15_pedidos_update_anon" ON public.pedidos;

CREATE POLICY "pedidos_select_propio" ON public.pedidos
  FOR SELECT TO authenticated USING (user_uid = auth.uid());
CREATE POLICY "pedidos_select_admin"  ON public.pedidos
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');
CREATE POLICY "pedidos_insert_propio" ON public.pedidos
  FOR INSERT TO authenticated WITH CHECK (user_uid = auth.uid());
CREATE POLICY "pedidos_update_admin"  ON public.pedidos
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "pedidos_delete_admin"  ON public.pedidos
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

-- PROFILES: cada uno ve el suyo; el admin ve todos.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_propio" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_select_admin"  ON public.profiles
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');
-- Sin INSERT/UPDATE/DELETE: el alta la hace el disparador; los cambios, la consola.

-- USERS (tabla antigua): quitar las políticas anon -> anon sin acceso.
DROP POLICY IF EXISTS "p15_users_select_anon"          ON public.users;
DROP POLICY IF EXISTS "p15_users_insert_montador_anon" ON public.users;

-- BUCKET dibujos: la subida pasa a requerir sesión. La lectura sigue pública
-- (decisión de alcance: los dibujos no son sensibles; endurecer a URLs firmadas
-- es un paso opcional posterior).
DROP POLICY IF EXISTS "allow_public_upload" ON storage.objects;
CREATE POLICY "dibujos_insert_autenticado" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'dibujos');

COMMIT;
```

*Vuelta atrás:* `DROP` de las políticas nuevas + `ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;` + recrear las políticas anon de la Parte B (están en MIGRACION-SEGURIDAD.md) y `CREATE POLICY "allow_public_upload" ... FOR INSERT TO anon WITH CHECK (bucket_id='dibujos');`.

---

## 7. Verificar que el acceso anónimo quedó cerrado

Con la clave pública (anon), estas tres deben devolver **colección vacía**:

```bash
curl -s "https://bgigpjufjtclahbknuyx.supabase.co/rest/v1/pedidos?select=id&limit=5"  -H "apikey: <CLAVE_ANON>"
curl -s "https://bgigpjufjtclahbknuyx.supabase.co/rest/v1/users?select=id&limit=5"    -H "apikey: <CLAVE_ANON>"
curl -s "https://bgigpjufjtclahbknuyx.supabase.co/rest/v1/profiles?select=id&limit=5" -H "apikey: <CLAVE_ANON>"
```

Y en el navegador: pon a mano `role: admin` en el almacenamiento y comprueba que
la base **sigue negando** los datos que no te tocan. Ese es el resultado que hoy
no se cumple y que da sentido a toda la migración.

---

## 8. Cierre

- **Rotar la clave pública** (`Settings → API → Rotate anon key`), actualizar
  `SUPABASE_ANON` en `supabase.js` y redesplegar. Cierra la puerta a quien copió
  la clave vieja del código.
- Tras verificar todo, retirar la tabla antigua:
  ```sql
  DROP TABLE public.users;   -- haz una copia antes si quieres conservar histórico
  ```

---

## Notas de alcance (decisiones tomadas en el cliente)

- **Bucket público para lectura:** se mantuvo a propósito para no reescribir en
  asíncrono los 3 puntos de render de imágenes (riesgo de "página en blanco").
  Endurecer a bucket privado + URLs firmadas queda como mejora posterior.
- **Lista de usuarios del panel sin email:** el email vive en `auth.users`, no
  accesible desde el cliente. El panel muestra nombre, rol y nº de pedidos.
- **`savePedido` usa `insert`, no `upsert`:** la política de INSERT por usuario no
  concede UPDATE al montador; un upsert fallaría.
