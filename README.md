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

### App móvil del montador, planos múltiples y chat con taller

`index.html` es una sola página con vistas por hash (`#inicio`, `#nuevo`,
`#enviado`, `#pedidos`, `#pedido/<id>`, `#chats`, `#chat/<pedidoId>`); maqueta
en `rediseno-mockups/maqueta-movil-montador.html`. Antes de desplegarla hay que
ejecutar en el SQL Editor, en este orden:

1. `PEDIDOS-ARCHIVOS.sql`: columna `pedidos.archivos` (hasta 5 planos).
   `file_path`/`file_name`/`file_type` siguen guardando el plano 1 para n8n,
   la etiqueta y los CSV.
2. `CHAT-TALLER.sql`: tablas `chats` y `chat_mensajes`, RLS, RPCs, Realtime
   y bucket privado `chat-imagenes`.
3. (Opcional) `VERIFICAR-CHAT.sql`: pruebas de permisos simulando usuarios,
   dentro de una transacción con ROLLBACK.

Solo el taller (roles `admin` y `almacen`) puede cerrar un chat, desde la
sección «Chats» del dashboard; al cerrarlo se borran sus mensajes e imágenes.

### El taller también abre chats

`CHAT-TALLER-ABRE.sql`: los chats se abren con la RPC `abrir_chat_pedido` (el
montador en sus pedidos; el taller en cualquier pedido de un montador con
cuenta). Ejecutar PASO 1, desplegar, y después PASO 3 (revoca el INSERT directo
en `chats`). Desde el detalle del pedido: «Escribir al montador»; el chat se
crea al enviar el primer mensaje.

### Empresas cliente

Cada montador pertenece a una empresa (la elige al registrarse) y cada pedido
guarda la suya; la facturación se hace fuera de la app (no hay precios).
Ejecutar `EMPRESAS.sql` antes de desplegar. El taller gestiona las empresas
(alta, renombrar, activar/desactivar) y la empresa de cada montador desde el
dashboard. El historial filtra por empresa y exporta el CSV con esa columna.

### Sesión persistente

Quien entra no vuelve a ver el login salvo que pulse «Salir». La sesión vive en
localStorage (clave `tmi-plegados-auth`; la antigua `sb-<ref>-auth-token` se
migra sola) y se renueva sola. Sin red, con sesión guardada, la app se abre con
el perfil cacheado (`tmi-plegados-perfil`) y el aviso «Sin conexión ·
reintentando…»; al volver la red (evento online, vuelta a primer plano o cada
12 s) recarga los datos sin recargar la página. Solo se manda al login si no hay
sesión guardada o el servidor la rechaza (refresh token revocado). Ver auth.js.

### Datos de prueba

La antigua página `seed.html` se eliminó: contenía credenciales de demostración
en claro y una copia de la cadena de refuerzo de contraseñas. Para probar con
datos, crear usuarios desde la propia interfaz de registro.
