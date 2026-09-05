const SUPABASE_URL  = 'https://bgigpjufjtclahbknuyx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnaWdwanVmanRjbGFoYmtudXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDk3ODksImV4cCI6MjA5MzgyNTc4OX0.7F1vNTMkuUl_McLn1WJ-4T5Rfn25lMpibOTJaYI4ipM';

// Webhook de n8n que genera la etiqueta del pedido (misma que Telegram).
// Rellena con la URL real del nodo Webhook de n8n. Ver INTEGRACION-N8N.md.
const N8N_ETIQUETA_WEBHOOK = 'https://n8n.tmisystem.com/webhook/generar-etiqueta';

const _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Row mappers ───────────────────────────────────────────────────────────────
function rowToPedido(r) {
  return {
    id:          r.id,
    userId:      r.user_uid,
    fecha:       r.fecha,
    montador:    r.montador,
    cantidad:    r.cantidad,
    cristalFijo: r.cristal_fijo,
    notas:       r.notas,
    referencia:  r.referencia,
    ral:         r.ral,
    fileName:    r.file_name,
    fileType:    r.file_type,
    filePath:    r.file_path,
    estado:      r.estado,
    notaAdmin:   r.nota_admin,
    pdfPath:     r.pdf_path,
    etiquetaPath:r.etiqueta_path,
    origen:      r.origen,
  };
}

// ── Pedidos ───────────────────────────────────────────────────────────────────
async function getPedidos(filter = {}) {
  let q = _db.from('pedidos').select('*').order('id', { ascending: false });
  if (filter.userId) q = q.eq('user_uid', filter.userId);
  const { data, error } = await q;
  if (error) { console.error('getPedidos:', error); return []; }
  return (data || []).map(rowToPedido);
}

async function getPedidoById(id) {
  const { data, error } = await _db.from('pedidos').select('*').eq('id', id).maybeSingle();
  if (error) { console.error('getPedidoById:', error); return null; }
  return data ? rowToPedido(data) : null;
}

async function savePedido(pedido) {
  // insert (no upsert): la política RLS de INSERT por usuario no concede
  // UPDATE al montador, así que un upsert fallaría. Ver MIGRACION-AUTH-RUNBOOK.md.
  const { error } = await _db.from('pedidos').insert({
    id:           pedido.id,
    user_uid:     pedido.userId,
    fecha:        pedido.fecha,
    montador:     pedido.montador,
    cantidad:     pedido.cantidad,
    cristal_fijo: pedido.cristalFijo ?? null,
    notas:        pedido.notas       || null,
    referencia:   pedido.referencia  || null,
    ral:          pedido.ral         || null,
    file_name:    pedido.fileName    || null,
    file_type:    pedido.fileType    || null,
    file_path:    pedido.filePath    || null,
    estado:       pedido.estado,
    nota_admin:   pedido.notaAdmin   || null,
  });
  if (error) throw error;
}

async function updatePedidoField(id, fields) {
  const db = {};
  if (fields.estado    !== undefined) db.estado     = fields.estado;
  if (fields.notaAdmin !== undefined) db.nota_admin = fields.notaAdmin;
  const { error } = await _db.from('pedidos').update(db).eq('id', id);
  if (error) throw error;
}

async function deletePedido(id) {
  const { error } = await _db.from('pedidos').delete().eq('id', id);
  if (error) throw error;
}

async function deleteAllPedidos() {
  const { error } = await _db.from('pedidos').delete().gte('id', 1);
  if (error) throw error;
}

// ── Usuarios (perfiles de Supabase Auth) ──────────────────────────────────────
// Lee public.profiles. El email vive en auth.users y no es accesible desde el
// cliente, así que la lista de usuarios del panel ya no muestra correo.
// El alta y la baja de cuentas las gestiona Supabase Auth, no la aplicación.
async function getDbUsers() {
  const { data, error } = await _db.from('profiles').select('*').order('creado_el');
  if (error) { console.error('getDbUsers:', error); return []; }
  return (data || []).map(r => ({
    id:       r.id,
    nombre:   r.nombre,
    email:    '',
    role:     r.role,
    creadoEl: r.creado_el ? new Date(r.creado_el).toLocaleDateString('es-ES') : '',
  }));
}

// ── Storage ───────────────────────────────────────────────────────────────────
async function uploadDibujo(file, pedidoId) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${pedidoId}.${ext}`;
  const { error } = await _db.storage.from('dibujos').upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

function getPublicUrl(path) {
  if (!path) return null;
  const { data } = _db.storage.from('dibujos').getPublicUrl(path);
  return data.publicUrl;
}

// ── Realtime ──────────────────────────────────────────────────────────────────
function subscribePedidos(onchange) {
  return _db.channel('pedidos-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, onchange)
    .subscribe();
}
