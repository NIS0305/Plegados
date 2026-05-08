const SUPABASE_URL  = 'https://bgigpjufjtclahbknuyx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnaWdwanVmanRjbGFoYmtudXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDk3ODksImV4cCI6MjA5MzgyNTc4OX0.7F1vNTMkuUl_McLn1WJ-4T5Rfn25lMpibOTJaYI4ipM';

const _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Row mappers ───────────────────────────────────────────────────────────────
function rowToPedido(r) {
  return {
    id:          r.id,
    userId:      r.user_id,
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
  };
}

// ── Pedidos ───────────────────────────────────────────────────────────────────
async function getPedidos(filter = {}) {
  let q = _db.from('pedidos').select('*').order('id', { ascending: false });
  if (filter.userId) q = q.eq('user_id', filter.userId);
  const { data, error } = await q;
  if (error) { console.error('getPedidos:', error); return []; }
  return (data || []).map(rowToPedido);
}

async function savePedido(pedido) {
  const { error } = await _db.from('pedidos').upsert({
    id:           pedido.id,
    user_id:      pedido.userId,
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

// ── Users ─────────────────────────────────────────────────────────────────────
async function getDbUsers() {
  const { data, error } = await _db.from('users').select('*').order('created_at');
  if (error) { console.error('getDbUsers:', error); return []; }
  return (data || []).map(r => ({
    id:           r.id,
    nombre:       r.nombre,
    email:        r.email,
    passwordHash: r.password_hash,
    role:         r.role,
    creadoEl:     r.creado_el,
  }));
}

async function insertDbUser(user) {
  const { error } = await _db.from('users').insert({
    id:            user.id,
    nombre:        user.nombre,
    email:         user.email,
    password_hash: user.passwordHash,
    role:          user.role,
    creado_el:     user.creadoEl,
  });
  if (error) throw error;
}

async function deleteDbUser(id) {
  const { error } = await _db.from('users').delete().eq('id', id);
  if (error) throw error;
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
