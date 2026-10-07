const SUPABASE_URL  = 'https://bgigpjufjtclahbknuyx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnaWdwanVmanRjbGFoYmtudXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDk3ODksImV4cCI6MjA5MzgyNTc4OX0.7F1vNTMkuUl_McLn1WJ-4T5Rfn25lMpibOTJaYI4ipM';

// Webhook de n8n que genera la etiqueta del pedido (misma que Telegram).
// Rellena con la URL real del nodo Webhook de n8n. Ver INTEGRACION-N8N.md.
const N8N_ETIQUETA_WEBHOOK = 'https://n8n.tmisystem.com/webhook/generar-etiqueta';

// ── Sesión persistente ────────────────────────────────────────────────────────
// La sesión vive en localStorage con una clave propia y se renueva sola. Quien
// entra no vuelve a ver el login salvo que pulse "Salir" (ver auth.js).
const SUPABASE_STORAGE_KEY = 'tmi-plegados-auth';
// Clave por defecto de supabase-js hasta ahora: sb-<ref>-auth-token.
const SUPABASE_STORAGE_KEY_ANTIGUA = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

// Migración silenciosa: quien tenía sesión con la clave antigua la conserva con
// la nueva (no tiene que volver a poner la contraseña). La antigua se borra
// para que un "Salir" posterior no deje una copia vieja que se re-migre.
(function migrarClaveSesion() {
  try {
    const antigua = localStorage.getItem(SUPABASE_STORAGE_KEY_ANTIGUA);
    if (antigua && !localStorage.getItem(SUPABASE_STORAGE_KEY)) {
      localStorage.setItem(SUPABASE_STORAGE_KEY, antigua);
    }
    if (antigua) localStorage.removeItem(SUPABASE_STORAGE_KEY_ANTIGUA);
  } catch (e) { /* almacenamiento bloqueado: se sigue sin migrar */ }
})();

const _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: false,
    storageKey:         SUPABASE_STORAGE_KEY,
  },
});

// ── Estados del pedido: definición ÚNICA para toda la app ─────────────────────
// Valores EXACTOS de la BD (n8n/Telegram escriben 'Completado'); no renombrar.
//   Pendiente → En taller → Completado → Entregado a montador | Entregado a reparto
// Por hacer / En curso      = Pendiente, En taller (y cualquier valor no oficial).
// Finalizados / Terminados  = Completado y los dos Entregado.
// app.js (montador) y dashboard.js (taller) usan SOLO esto. Ver ESTADOS-REVISION.sql.
const ESTADOS = ['Pendiente', 'En taller', 'Completado', 'Entregado a montador', 'Entregado a reparto'];
const ESTADOS_FINALIZADOS = ['Completado', 'Entregado a montador', 'Entregado a reparto'];

function esFinalizado(estado) {
  return ESTADOS_FINALIZADOS.includes(estado);
}

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
    empresaId:   r.empresa_id ?? null,   // EMPRESAS.sql; la fija un disparador al crear
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
    empresaId: r.empresa_id ?? null,
    creadoEl: r.creado_el ? new Date(r.creado_el).toLocaleDateString('es-ES') : '',
  }));
}

// ── Empresas (EMPRESAS.sql) ───────────────────────────────────────────────────
// Empresa cliente de cada montador y de cada pedido. Sin precios: la
// facturación se hace fuera de la app. Las reglas las impone la BD.

// Pantalla de registro (sin sesión): solo id + nombre de las activas.
async function getEmpresasRegistro() {
  const { data, error } = await _db.rpc('empresas_registro');
  if (error) throw error;
  return data || [];
}

// Taller: todas (activas e inactivas). [] si la tabla aún no existe.
async function getEmpresas() {
  const { data, error } = await _db.from('empresas').select('id, nombre, activa, creado_el').order('nombre');
  if (error) { console.error('getEmpresas:', error); return []; }
  return data || [];
}

function traducirErrorEmpresa(error) {
  if (error && error.code === '23505') return new Error('Ya existe una empresa con ese nombre.');
  if (error && error.code === '23514') return new Error('El nombre no puede estar vacío.');
  return error;
}

async function crearEmpresa(nombre) {
  const { data, error } = await _db.from('empresas').insert({ nombre: nombre.trim() }).select().single();
  if (error) throw traducirErrorEmpresa(error);
  return data;
}

// Renombrar / activar / desactivar. RLS deniega en silencio (0 filas): se comprueba.
async function actualizarEmpresa(id, campos) {
  const db = {};
  if (campos.nombre !== undefined) db.nombre = campos.nombre.trim();
  if (campos.activa !== undefined) db.activa = campos.activa;
  const { data, error } = await _db.from('empresas').update(db).eq('id', id).select('id');
  if (error) throw traducirErrorEmpresa(error);
  if (!data || !data.length) throw new Error('No tienes permiso para cambiar esta empresa.');
}

// Taller: empresa de un usuario (RPC; profiles no admite UPDATE por API).
// No toca sus pedidos anteriores: cada pedido guarda la suya.
async function asignarEmpresaUsuario(userId, empresaId) {
  const { error } = await _db.rpc('asignar_empresa_usuario', { p_user: userId, p_empresa_id: empresaId });
  if (error) throw error;
}

// Taller: empresa de un pedido (p. ej. correo o almacén sin empresa).
async function actualizarEmpresaPedido(pedidoId, empresaId) {
  const { data, error } = await _db.from('pedidos').update({ empresa_id: empresaId }).eq('id', pedidoId).select('id');
  if (error) throw error;
  if (!data || !data.length) throw new Error('No se pudo cambiar la empresa del pedido.');
}

// Montador: nombre de su empresa. null = no tiene; undefined = no se pudo leer
// (sin red, o la columna aún no existe): quien llama conserva lo que tenía.
async function getMiEmpresa(userId) {
  try {
    const { data, error } = await _db.from('profiles').select('empresa_id, empresas(nombre)').eq('id', userId).maybeSingle();
    if (error) return undefined;
    if (!data) return null;
    return data.empresas ? data.empresas.nombre : null;
  } catch (e) { return undefined; }
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
    abiertoPor:      c.abierto_por || 'montador',   // CHAT-TALLER-ABRE.sql
    montadorHaEscrito: msgs.some(m => m.autor_rol === 'montador'),
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

// Abre (o recupera) el chat de un pedido con la RPC abrir_chat_pedido
// (CHAT-TALLER-ABRE.sql). La BD decide: el montador solo en SUS pedidos; el
// taller en cualquier pedido de un montador con cuenta. montador_uid y
// abierto_por los fija la BD. Si ya existe (lo abriera quien lo abriera, o dos
// a la vez), devuelve el mismo chat.
async function abrirChatPedido(pedidoId) {
  const { data, error } = await _db.rpc('abrir_chat_pedido', { p_pedido_id: pedidoId });
  if (!error) return rowToChat(Array.isArray(data) ? data[0] : data, []);
  // RPC aún no creada en la BD (cliente desplegado antes que el SQL): alta
  // directa como antes (solo vale para el montador sobre su pedido).
  if (error.code === 'PGRST202' || /abrir_chat_pedido/.test(error.message || '') && /not find|does not exist/i.test(error.message || '')) {
    return crearChatDirecto(pedidoId);
  }
  if (error.code === 'P0001') throw new Error(error.message);   // "Este pedido no tiene montador con cuenta"
  throw error;
}

async function crearChatDirecto(pedidoId) {
  const { data: { session } } = await _db.auth.getSession();
  const { data, error } = await _db.from('chats')
    .insert({ pedido_id: pedidoId, montador_uid: session && session.user.id }).select().single();
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
