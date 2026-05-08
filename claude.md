# Plegados — Contexto del proyecto

## Qué es esto
App web para gestionar pedidos de **plegado de chapa metálica** de la empresa **TMI Plegadores** (el logo muestra "Lumon"). Los trabajadores (montadores) crean pedidos desde el móvil/web, y el admin del taller gestiona el estado de cada pedido desde un dashboard.

## Stack técnico
- **Frontend:** HTML + CSS + JavaScript vanilla. Sin build step, sin bundler.
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL + Storage + Realtime)
  - Proyecto: `bgigpjufjtclahbknuyx.supabase.co`
  - Tablas: `pedidos`, `users`
  - Storage bucket: `dibujos` (para archivos adjuntos)
  - Realtime: suscripción a cambios en `pedidos`
- **Deploy:** Vercel (`vercel.json` redirige `/` → `login.html`)
- **Charts:** Chart.js bundled localmente como `chart.umd.min.js`

## Estructura de archivos
```
login.html      — Entrada principal para montadores
admin.html      — Entrada para administradores (con código secreto)
index.html      — Formulario de nuevo pedido (vista montador)
dashboard.html  — Dashboard admin (KPIs, gráficas, tabla completa)
supabase.js     — Capa de datos: CRUD pedidos/users, storage, realtime
auth.js         — Login, registro, sesión (sessionStorage), guards de rol
app.js          — Utilidades compartidas + lógica de index.html (form + historial propio)
dashboard.js    — Lógica completa del dashboard admin
style.css       — Todos los estilos
seed.html       — Página para sembrar datos de prueba
```

## Modelo de datos

### Pedido
```js
{
  id:          Date.now(),          // timestamp como PK
  userId:      number,
  fecha:       string,              // formato es-ES: "08/05/2026, 17:30"
  montador:    string,              // nombre del usuario
  cantidad:    number,              // piezas a plegar
  cristalFijo: number,
  referencia:  string | null,
  ral:         string | null,       // código de color RAL
  notas:       string | null,
  fileName:    string | null,       // archivo adjunto (dibujo/plano)
  fileType:    string | null,
  filePath:    string | null,       // path en Supabase Storage
  estado:      string,
  notaAdmin:   string | null,       // nota interna del taller
}
```

### Usuario
```js
{
  id:           Date.now(),
  nombre:       string,
  email:        string,
  passwordHash: string,  // SHA-256 con salt '_plegado_chapa_v1'
  role:         'admin' | 'montador',
  creadoEl:     string,
}
```

## Workflow de estados
```
Pendiente → En proceso → Completado → En taller → Entregado a montador → Entregado a reparto
```
Los montadores solo ven dos estados en su stepper: **Pendiente** / **Completado**.

## Autenticación
- **Custom auth** — NO usa Supabase Auth. Contraseñas hasheadas con SHA-256 + salt fijo `_plegado_chapa_v1`.
- Sesión en `sessionStorage` (se borra al cerrar la pestaña).
- Roles: `montador` (acceso a index.html) y `admin` (acceso a dashboard.html).
- Código secreto para crear cuentas admin: `PLEGADO_ADMIN` (hardcodeado en `auth.js`).
- Registro de admin en `admin.html`; registro de montadores en `login.html` (sin código especial).

## Convenciones clave
- Las IDs se generan con `Date.now()` — son timestamps, no auto-increment.
- `supabase.js` expone funciones globales (`getPedidos`, `savePedido`, `updatePedidoField`, `deletePedido`, `uploadDibujo`, `getPublicUrl`, `subscribePedidos`, `getDbUsers`, etc.). No hay módulos ES.
- Los scripts se cargan en orden: `supabase.js` → `auth.js` → `app.js` → `dashboard.js` (en dashboard).
- `_db` es la instancia global del cliente Supabase.
- `rowToPedido()` convierte snake_case de la DB a camelCase del JS.
- Archivos adjuntos: imágenes (JPG, PNG, SVG, WebP) y PDF, máximo 10 MB.

## Branches y colaboradores
- `main` — rama principal
- `tavo-dev` — rama de Tavo (rama actual)
- `miquel-dev` — rama de Miquel (otro desarrollador del equipo)

## Patrones de UI
- Toasts con `showToast(msg)` para feedback
- `escHtml(str)` para sanitizar output
- Badges de colores por estado (`badgeClass(estado)`)
- Stepper visual del workflow (`renderStepper` para admin, `renderMontadorStepper` para montadores)
- Modales para detalle de pedido y edición de notas
- Realtime: el dashboard y el historial del montador se actualizan automáticamente via `subscribePedidos()`
