# Plegados — gestión de pedidos de plegado de chapa

Aplicación web para el alta y seguimiento de pedidos de plegado. Los montadores
dan de alta pedidos desde móvil o web; la administración gestiona los estados
desde un panel.

Sitio estático (HTML + CSS + JS sin build) sobre un backend gestionado
(PostgreSQL + almacenamiento de objetos + tiempo real). Despliegue continuo
desde la rama `main`.

Para la arquitectura interna, convenciones y modelo de datos, ver
[CLAUDE.md](CLAUDE.md).

---

## Roles y acceso

Hay dos roles: `montador` y `admin`.

- **Montador** — se registra por sí mismo en `login.html`. Da de alta pedidos y
  consulta su propio historial.
- **Admin** — accede por `admin.html`. Gestiona todos los pedidos, los estados,
  las notas internas y los usuarios.

## Promoción de un usuario a administrador

**No existe registro de administrador en la interfaz.** El formulario de alta
crea siempre un `montador`. Esto es deliberado: el antiguo formulario validaba
un código de administrador en el propio JavaScript del navegador, es decir, el
código viajaba a cualquier visitante que abriera el código fuente.

Para promocionar a alguien, el procedimiento es manual y en dos pasos:

1. La persona se registra con normalidad en `login.html`. Queda creada como
   `montador`.
2. Un responsable con acceso a la consola del proveedor de base de datos ejecuta:

   ```sql
   UPDATE users
   SET role = 'admin'
   WHERE email = 'direccion@ejemplo.com';
   ```

3. Comprobar que ha afectado exactamente a una fila:

   ```sql
   SELECT id, nombre, email, role FROM users WHERE email = 'direccion@ejemplo.com';
   ```

4. La persona debe **cerrar sesión y volver a entrar**. El rol se lee al iniciar
   sesión y se guarda en la sesión del navegador; sin volver a entrar seguirá
   viendo la interfaz de montador.

Para revocar el rol, la misma sentencia con `role = 'montador'`.

### Listar los administradores actuales

```sql
SELECT id, nombre, email, creado_el FROM users WHERE role = 'admin' ORDER BY creado_el;
```

Conviene revisar esta lista periódicamente y retirar el rol a quien ya no lo
necesite.

---

## Estado de seguridad conocido

Esta aplicación tiene limitaciones de seguridad conocidas y documentadas. La más
importante:

> La autenticación es propia y se resuelve en el navegador. Las políticas de
> seguridad a nivel de fila (RLS) de la base de datos están desactivadas, por lo
> que cualquiera con la clave pública del cliente puede leer datos directamente
> contra la API REST.

El plan de corrección, con las políticas SQL concretas, el orden de despliegue y
la vuelta atrás de cada paso, está en
[MIGRACION-SEGURIDAD.md](MIGRACION-SEGURIDAD.md).

**No añadir funcionalidad que dependa de que el rol comprobado en el cliente sea
de fiar** hasta que esa migración esté hecha.

---

## Desarrollo

No hay build, ni linter, ni tests. Abrir los ficheros HTML directamente en el
navegador, o desplegar el directorio tal cual.

El orden de carga de los `<script>` es una dependencia real y hay que
respetarlo en cada página:

```
supabase.js  →  auth.js  →  app.js  →  dashboard.js   (solo el dashboard)
```

### Datos de prueba

La antigua página `seed.html` se eliminó: contenía credenciales de demostración
en claro y una copia de la cadena de refuerzo de contraseñas. Para probar con
datos, crear usuarios desde la propia interfaz de registro.
