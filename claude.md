# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Web app for managing metal sheet folding orders at **TMI Plegadores**. Montadores (workers) submit orders from mobile/web; admins manage status through a full workflow via a dashboard.

## Stack

- **Frontend:** Vanilla HTML + CSS + JS — no build step, no bundler, no package.json.
- **Backend:** Supabase (`bgigpjufjtclahbknuyx.supabase.co`) — PostgreSQL + Storage + Realtime.
- **Deploy:** Coolify (self-hosted en VPS). Un push a `main` habilita el redeploy, que se dispara manualmente desde el panel de Coolify. `vercel.json` es residual de cuando se desplegaba en Vercel.
- **Charts:** Chart.js bundled locally as `chart.umd.min.js`.

There are no build, lint, or test commands. Open the HTML files directly in a browser; production deploys go through Coolify.

## Architecture

All scripts expose globals — there are no ES modules. **Script load order is critical** and must be preserved in every HTML file that uses them:

```
supabase.js  →  auth.js  →  app.js  →  dashboard.js  (dashboard only)
```

- `_db` — global Supabase client instance (created in `supabase.js`)
- `supabase.js` — entire data layer: `getPedidos`, `savePedido`, `updatePedidoField`, `deletePedido`, `uploadDibujo`, `getPublicUrl`, `subscribePedidos`, `getDbUsers`
- `auth.js` — custom auth (NOT Supabase Auth): SHA-256 + salt `_plegado_chapa_v1`, sessionStorage sessions, `requireAuth()` / `requireAdmin()` route guards. Roles: `montador`, `admin`, `almacen`. El alta desde la interfaz crea SIEMPRE un `montador`; `admin` y `almacen` se asignan a mano en la base de datos (ver README.md)
- `app.js` — shared utilities + all logic for `index.html` (new-order form + montador's own order history)
- `dashboard.js` — all admin dashboard logic: KPIs, Chart.js charts, filters, inline status updates, notes modal

Pages:
- `login.html` — montador login/register entry point
- `admin.html` — admin **login only**. There is no admin self-registration: `registerUser()`
  always creates a `montador`. Promotion to `admin` is a manual DB operation — see README.md.
- `almacen-login.html` — warehouse **login only** (no self-registration).
- `index.html` — montador view: submit order, see own history
- `dashboard.html` — admin view: full table, KPIs, charts, manage all orders

## Data models

### Pedido (camelCase in JS, snake_case in DB — mapped by `rowToPedido()`)
```js
{
  id: Date.now(),       // timestamp PK — NOT auto-increment
  userId: number,
  fecha: string,        // es-ES format: "08/05/2026, 17:30"
  montador: string,
  cantidad: number,
  cristalFijo: number,
  referencia: string | null,
  ral: string | null,
  notas: string | null,
  fileName: string | null,
  fileType: string | null,
  filePath: string | null,   // Supabase Storage path
  estado: string,
  notaAdmin: string | null,
}
```

### Usuario
```js
{
  id: Date.now(),
  nombre: string,
  email: string,
  passwordHash: string,  // SHA-256 + salt '_plegado_chapa_v1'
  role: 'admin' | 'montador' | 'almacen',
  creadoEl: string,
}
```

## Order workflow

```
Pendiente → En proceso → Completado → En taller → Entregado a montador → Entregado a reparto
```

Montadores only see a 2-step stepper: **Pendiente** / **Completado**.

## UI conventions

- `showToast(msg)` — user feedback toasts
- `escHtml(str)` — XSS prevention; use on all dynamic HTML output
- `badgeClass(estado)` — maps status string to CSS badge color class
- `renderStepper(estado)` — 6-step admin stepper
- `renderMontadorStepper(estado)` — 2-step worker stepper
- File attachments: JPG, PNG, SVG, WebP, PDF — max 10 MB, stored in `dibujos` bucket
- Realtime: `subscribePedidos(callback)` auto-updates dashboard and montador history on any DB change

## Branches

- `main` — production
- `tavo-dev` — Tavo's branch
- `miquel-dev` — Miquel's branch
