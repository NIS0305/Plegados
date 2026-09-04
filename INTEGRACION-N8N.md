# Integración n8n → dashboard (pedidos por email)

El lado app está hecho y desplegado. La cuenta de taller
(`tmipedidos@tmisystem.com`, uuid `1fa2e000-3c18-4932-8561-c746c6623070`, rol
`almacen`) recibe los pedidos de email y aparecen en "Pedidos de almacén" del
dashboard, con botones de Plano (PDF) y Etiqueta.

Falta añadir al workflow **"Pedidos Email a PDF"** dos nodos que suban el PDF a
Supabase y creen la fila del pedido.

## Credencial (YA CREADA y probada)
n8n → Credentials → **Supabase API** "Supabase account":
- Host: `https://bgigpjufjtclahbknuyx.supabase.co`
- Service Role Secret: la **service_role legacy** (JWT `eyJ...`), NO la `sb_secret_`.

## Datos confirmados del workflow
El nodo **"Extraer pedido + preparar HTML"** devuelve, entre otros:
- `orderNumber` → nº de pedido (8 díg.) o `null`
- `fileName`    → `"<orderNumber>.pdf"` (o `SIN_PEDIDO_<ts>.pdf`)
- `fecha` (dd/mm/aaaa), `hora` (HH:mm), `fromEmail`, `tipoPedido` (Chapa/Cristal/Mixto/Revisar)

El PDF binario sale del nodo **"HTML a PDF (Gotenberg)"** en la propiedad **`data`**
(confirmar de un vistazo al montar).

## Dónde enganchar (SIN romper el guardado en Drive)
Colgar el nodo nuevo **en paralelo** desde la salida de **"HTML a PDF (Gotenberg)"**:

```
HTML a PDF (Gotenberg) ─┬─> Guardar PDF en Drive        (lo que ya existe)
                        └─> Subir PDF a Supabase ─> Insertar pedido en Supabase   (NUEVO)
```

## Nodo 1 — "Subir PDF a Supabase" (HTTP Request)
- **Method**: POST
- **URL**:
  `https://bgigpjufjtclahbknuyx.supabase.co/storage/v1/object/dibujos/email/{{ $('Extraer pedido + preparar HTML').item.json.fileName }}`
- **Authentication**: Predefined Credential Type → **Supabase API** → "Supabase account"
- **Send Headers**: ON
  - `Content-Type` = `application/pdf`
  - `x-upsert` = `true`
- **Send Body**: ON → **Body Content Type: n8n Binary File**
  - **Input Data Field Name**: `data`

## Nodo 2 — "Insertar pedido en Supabase" (HTTP Request)
- **Method**: POST
- **URL**: `https://bgigpjufjtclahbknuyx.supabase.co/rest/v1/pedidos`
- **Authentication**: Predefined Credential Type → **Supabase API** → "Supabase account"
- **Send Headers**: ON
  - `Content-Type` = `application/json`
  - `Prefer` = `return=minimal`
- **Send Body**: ON → **Body Content Type: JSON** → Expresión:
```
{
  "id": {{ Date.now() }},
  "user_uid": "1fa2e000-3c18-4932-8561-c746c6623070",
  "fecha": "{{ $('Extraer pedido + preparar HTML').item.json.fecha }}, {{ $('Extraer pedido + preparar HTML').item.json.hora }}",
  "montador": "{{ $('Extraer pedido + preparar HTML').item.json.fromEmail }}",
  "cantidad": 1,
  "estado": "Pendiente",
  "referencia": "{{ $('Extraer pedido + preparar HTML').item.json.orderNumber }}",
  "notas": "{{ $('Extraer pedido + preparar HTML').item.json.tipoPedido }}",
  "origen": "email",
  "pdf_path": "email/{{ $('Extraer pedido + preparar HTML').item.json.fileName }}"
}
```

## Probar
Con un email de prueba (o reprocesando uno), debe aparecer en el dashboard →
"Pedidos de almacén", con su Plano (PDF) abrible desde el botón.
El `referencia` = nº de pedido; `montador` (columna Solicitante) = quién lo envió;
`notas` = tipo (Chapa/Cristal/Mixto).

## Nota de alcance
El bucket `dibujos` es público de lectura (el PDF se abre por URL pública).
Privado + URLs firmadas queda como endurecimiento posterior.
