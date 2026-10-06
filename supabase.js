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
    archivos:    Array.isArray(r.archivos) ? r.archivos : [],
  };
}

// Planos del pedido en orden: [{path,name,type}]. Pedidos antiguos (archivos
// vacío) usan file_path como único plano.
function planosDe(p) {
  if (p.archivos && p.archivos.length) return p.archivos.filter(a => a && a.path);
  return p.filePath ? [{ path: p.filePath, name: p.fileName, type: p.fileType }] : [];
}

function esImagenPlano(a) {
  return (a.type || '').startsWith('image/') || /\.(jpg|jpeg|png|svg|webp|gif)$/i.test(a.path || '');
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
  const row = {
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
  };
  // archivos: todos los planos (PEDIDOS-ARCHIVOS.sql). file_* repiten el
  // archivo 1 para que n8n, la etiqueta, el dashboard y los CSV sigan igual.
  if (pedido.archivos && pedido.archivos.length) row.archivos = pedido.archivos;
  let { error } = await _db.from('pedidos').insert(row);
  if (error && row.archivos && /archivos/.test(error.message || '')) {
    // Columna aún no creada en la BD: se guarda como antes, con el archivo 1.
    console.warn('savePedido: sin columna archivos, se guarda solo el plano 1', error);
    delete row.archivos;
    ({ error } = await _db.from('pedidos').insert(row));
  }
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

// Plano n (1..5) de un pedido: <pedidoId>_<n>.<ext>. upsert:false, así solo
// hace falta la política de INSERT del bucket (las rutas son siempre nuevas).
async function uploadArchivoPedido(file, pedidoId, n) {
  const ext  = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${pedidoId}_${n}.${ext}`;
  const { error } = await _db.storage.from('dibujos')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
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

// ── Chat con taller (CHAT-TALLER.sql) ─────────────────────────────────────────
// Un chat por pedido. Las reglas de acceso las impone la BD (RLS + RPCs): aquí
// solo se leen/escriben datos. Imágenes en el bucket PRIVADO chat-imagenes,
// ruta <chat_id>/<uuid>.<ext>, servidas con URLs firmadas.
const CHAT_BUCKET = 'chat-imagenes';

function nuevoUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// No leídos = mensajes del OTRO lado posteriores a mi marca de leído.
function rowToChat(c, msgs) {
  const leidoM = c.leido_montador_el ? new Date(c.leido_montador_el) : null;
  const leidoT = c.leido_taller_el   ? new Date(c.leido_taller_el)   : null;
  return {
    id:              c.id,
    pedidoId:        Number(c.pedido_id),
    montadorUid:     c.montador_uid,
    creadoEl:        c.creado_el,
    ultimoMensajeEl: c.ultimo_mensaje_el,
    ultimo:          msgs.length ? msgs[msgs.length - 1] : null,
    numMensajes:     msgs.length,
    noLeidosMontador: msgs.filter(m => m.autor_rol === 'taller'   && (!leidoM || new Date(m.creado_el) > leidoM)).length,
    noLeidosTaller:   msgs.filter(m => m.autor_rol === 'montador' && (!leidoT || new Date(m.creado_el) > leidoT)).length,
  };
}

// Chats visibles para quien llama (RLS: los suyos, o todos si es taller), con
// último mensaje y no leídos. Volumen pequeño: los chats se borran al resolverse.
async function getChatsResumen() {
  const { data: chats, error } = await _db.from('chats').select('*')
    .order('ultimo_mensaje_el', { ascending: false });
  if (error) { console.error('getChatsResumen:', error); return []; }
  if (!chats || !chats.length) return [];
  const { data: msgs, error: e2 } = await _db.from('chat_mensajes')
    .select('id, chat_id, autor_rol, texto, imagen_path, creado_el')
    .in('chat_id', chats.map(c => c.id))
    .order('creado_el', { ascending: true });
  if (e2) console.error('getChatsResumen (mensajes):', e2);
  const porChat = {};
  (msgs || []).forEach(m => { (porChat[m.chat_id] = porChat[m.chat_id] || []).push(m); });
  return chats.map(c => rowToChat(c, porChat[c.id] || []));
}

async function getMensajesChat(chatId) {
  const { data, error } = await _db.from('chat_mensajes').select('*')
    .eq('chat_id', chatId).order('creado_el', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Abre el chat de un pedido (solo el dueño del pedido; lo comprueba la RLS).
// Si ya existe (unique pedido_id, p.ej. dos pestañas), devuelve el existente.
async function crearChat(pedidoId, montadorUid) {
  const { data, error } = await _db.from('chats')
    .insert({ pedido_id: pedidoId, montador_uid: montadorUid }).select().single();
  if (!error) return rowToChat(data, []);
  if (error.code === '23505') {
    const { data: ex, error: e2 } = await _db.from('chats').select('*').eq('pedido_id', pedidoId).maybeSingle();
    if (e2) throw e2;
    if (ex) return rowToChat(ex, []);
  }
  throw error;
}

// Texto y/o imagen (ya comprimida). autor_uid y autor_rol los pone la BD.
async function enviarMensajeChat(chatId, { texto, imagen }) {
  let imagenPath = null;
  if (imagen) {
    const ext = imagen.type === 'image/png' ? 'png' : imagen.type === 'image/webp' ? 'webp'
              : imagen.type === 'image/gif' ? 'gif' : 'jpg';
    imagenPath = `${chatId}/${nuevoUuid()}.${ext}`;
    const { error: eUp } = await _db.storage.from(CHAT_BUCKET)
      .upload(imagenPath, imagen, { upsert: false, contentType: imagen.type || 'image/jpeg' });
    if (eUp) throw eUp;
  }
  const { data, error } = await _db.from('chat_mensajes')
    .insert({ chat_id: chatId, texto: texto || null, imagen_path: imagenPath })
    .select().single();
  if (error) throw error;
  return data;
}

async function marcarChatLeido(chatId) {
  const { error } = await _db.rpc('marcar_chat_leido', { p_chat_id: chatId });
  if (error) console.warn('marcarChatLeido:', error);
}

async function listarImagenesChat(chatId) {
  const { data, error } = await _db.storage.from(CHAT_BUCKET).list(chatId, { limit: 1000 });
  if (error) throw error;
  return (data || []).filter(o => o.id).map(o => `${chatId}/${o.name}`);
}

// Cierre del chat (solo taller): 1) borra las imágenes de Storage; si falla,
// NO se borra el chat. 2) RPC eliminar_chat (mensajes en cascada). 3) Barrido
// de restos (una imagen subida justo durante el cierre).
async function eliminarChatTaller(chatId) {
  const paths = await listarImagenesChat(chatId);
  if (paths.length) {
    const { data, error } = await _db.storage.from(CHAT_BUCKET).remove(paths);
    if (error) throw error;
    // Storage no da error si la política deniega el borrado: devuelve menos objetos.
    if ((data || []).length < paths.length) throw new Error('No se pudieron borrar todas las imágenes del chat.');
  }
  const { data: ok, error: e2 } = await _db.rpc('eliminar_chat', { p_chat_id: chatId });
  if (e2) throw e2;
  if (!ok) throw new Error('El chat ya no existe.');
  try {
    const restos = await listarImagenesChat(chatId);
    if (restos.length) await _db.storage.from(CHAT_BUCKET).remove(restos);
  } catch (e) { console.warn('barrido de imágenes del chat:', e); }
}

// URLs firmadas (1 h) con caché, para no re-firmar en cada render.
const _urlFirmadaCache = {};
async function urlsFirmadasChat(paths) {
  const ahora = Date.now();
  const faltan = [...new Set(paths)].filter(p => !_urlFirmadaCache[p] || _urlFirmadaCache[p].exp < ahora);
  if (faltan.length) {
    const { data, error } = await _db.storage.from(CHAT_BUCKET).createSignedUrls(faltan, 3600);
    if (error) console.error('urlsFirmadasChat:', error);
    (data || []).forEach(d => {
      if (d.signedUrl) _urlFirmadaCache[d.path] = { url: d.signedUrl, exp: ahora + 50 * 60 * 1000 };
    });
  }
  const out = {};
  paths.forEach(p => { if (_urlFirmadaCache[p]) out[p] = _urlFirmadaCache[p].url; });
  return out;
}

// Realtime: INSERT de mensajes (la RLS filtra qué llega a cada uno) y cambios
// en chats (alta, leídos, y DELETE cuando el taller lo cierra).
function subscribeChats({ onMensaje, onChat }) {
  return _db.channel('chats-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensajes' }, p => onMensaje && onMensaje(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, p => onChat && onChat(p))
    .subscribe();
}
