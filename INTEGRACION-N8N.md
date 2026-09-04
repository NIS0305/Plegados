# Integración n8n → dashboard (pedidos por email)

Estado: el lado app está hecho y desplegado. La cuenta de taller
(`tmipedidos@tmisystem.com`, uuid `1fa2e000-3c18-4932-8561-c746c6623070`, rol
`almacen`) recibe los pedidos de email y aparecen en "Pedidos de almacén" del
dashboard, con botones de Plano (PDF) y Etiqueta.

Falta un solo paso: que el workflow **"Pedidos Email a PDF"** de n8n, tras
generar el PDF, lo suba a Supabase y cree la fila del pedido.

## Credencial (YA CREADA)
- n8n → Credentials → **Supabase API** llamada "Supabase account".
- Host: `https://bgigpjufjtclahbknuyx.supabase.co`
- Service Role Secret: la clave **service_role legacy** (JWT `eyJ...`), no la
  `sb_secret_` (esa hace fallar el test de conexión de n8n).
- Estado: "Connection tested successfully".

## Dónde enganchar
Después del nodo que genera el PDF (**"HTML a PDF (Gotenberg)"** / antes o
después de "Guardar PDF en Drive"), añadir DOS nodos HTTP Request en cadena:

Gotenberg → [Subir PDF a Supabase] → [Insertar pedido en Supabase]

## Nodo 1 — "Subir PDF a Supabase" (HTTP Request)
- **Method**: POST
- **URL** (expresión):
  `https://bgigpjufjtclahbknuyx.supabase.co/storage/v1/object/dibujos/email/{{ $json.NUMERO }}.pdf`
- **Authentication**: Predefined Credential Type → **Supabase API** → "Supabase account"
- **Send Headers**: ON
  - `Content-Type` = `application/pdf`
  - `x-upsert` = `true`
- **Send Body**: ON → **Body Content Type: n8n Binary File**
  - **Input Data Field Name**: el nombre de la propiedad binaria del PDF que sale
    de Gotenberg (normalmente `data`).

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
  "fecha": "{{ $now.format('dd/MM/yyyy, HH:mm') }}",
  "montador": "Pedido Email",
  "cantidad": 1,
  "estado": "Pendiente",
  "referencia": "{{ $json.NUMERO }}",
  "origen": "email",
  "pdf_path": "email/{{ $json.NUMERO }}.pdf"
}
```

## Los DOS únicos huecos a confirmar (mirando tu workflow)
1. **`{{ $json.NUMERO }}`** → cómo se llama el campo del nº de pedido que saca el
   nodo "Extraer pedido + preparar HTML" (clica su salida para verlo).
2. **Input Data Field Name** del nodo 1 → la propiedad binaria del PDF de Gotenberg.

## Probar
- Ejecutar el workflow con un email de prueba (o Execute workflow).
- Debe aparecer en el dashboard, en "Pedidos de almacén", con su Plano (PDF)
  abrible desde el botón.

## Nota de alcance
El bucket `dibujos` es público de lectura, así que el PDF se abre por URL
pública. Si se quiere privado + URLs firmadas, es un endurecimiento posterior.
