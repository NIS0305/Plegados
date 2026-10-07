// auth.js — Autenticación sobre Supabase Auth (reemplaza el auth propio SHA-256).
//
// El rol vive en public.profiles (id = auth.users.id). getSessionUser() resuelve
// sesión + perfil y devuelve { id, email, nombre, role, empresa, offline }. Todas
// las guardas son ASÍNCRONAS: quien las use debe await-earlas (app.js, dashboard.js).
//
// SESIÓN PERSISTENTE: quien entra no vuelve a ver el login salvo que pulse
// "Salir". Solo se manda a login.html cuando:
//   · no hay sesión guardada en el almacenamiento, o
//   · el servidor responde que la sesión no es válida (refresh token revocado).
// Un fallo de RED (sin cobertura, timeout, AuthRetryableFetchError) con sesión
// guardada NO echa al login: se muestra la app con el perfil cacheado y el aviso
// "Sin conexión · reintentando…", y se reintenta sola (evento 'online', vuelta a
// primer plano y cada 12 s) hasta conectar.

const PERFIL_CACHE_KEY = 'tmi-plegados-perfil';   // { id, email, nombre, role, empresa }
const T_SESION_MS = 3000;    // límite para leer/renovar la sesión
const T_PERFIL_MS = 2500;    // límite para leer el perfil (por debajo del auth-gate de 6 s)
const REINTENTO_MS = 12000;

// ── Perfil cacheado (para pintar la cabecera sin red) ─────────────────────────
function leerPerfilCache() {
  try { return JSON.parse(localStorage.getItem(PERFIL_CACHE_KEY) || 'null'); } catch (e) { return null; }
}
function guardarPerfilCache(u) {
  try {
    const prev = leerPerfilCache();
    const empresa = u.empresa !== undefined ? u.empresa : (prev && prev.id === u.id ? prev.empresa : null);
    localStorage.setItem(PERFIL_CACHE_KEY, JSON.stringify({ id: u.id, email: u.email, nombre: u.nombre, role: u.role, empresa }));
  } catch (e) { /* sin almacenamiento: se sigue sin caché */ }
}
function borrarPerfilCache() {
  try { localStorage.removeItem(PERFIL_CACHE_KEY); } catch (e) {}
}

function haySesionGuardada() {
  try { return !!localStorage.getItem(SUPABASE_STORAGE_KEY); } catch (e) { return false; }
}

// ¿Es un fallo de red (y no "la sesión no vale")?
function esErrorDeRed(err) {
  if (!err) return false;
  if (err.name === 'AuthRetryableFetchError' || err.name === 'TimeoutRed') return true;
  if (err.status === 0 || (err.status >= 500 && err.status < 600)) return true;
  const m = String(err.message || err).toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|err_internet|err_network/.test(m)
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

function conLimite(promesa, ms) {
  let t;
  const limite = new Promise((_, ko) => { t = setTimeout(() => { const e = new Error('timeout de red'); e.name = 'TimeoutRed'; ko(e); }, ms); });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(t));
}

// Pide al navegador que no borre los datos de la app (sin avisos ni bloqueo).
function pedirAlmacenamientoPersistente() {
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {}
}

// ── Resolver sesión + perfil ──────────────────────────────────────────────────
// estado: 'ok' (con red) · 'offline' (sesión guardada, sin red) · 'sin-sesion'.
async function resolverSesion() {
  let session = null, error = null;
  try {
    ({ data: { session }, error } = await conLimite(_db.auth.getSession(), T_SESION_MS));
  } catch (e) { error = e; }

  if (!session) {
    // Sesión guardada pero no se pudo renovar por RED → seguir dentro, sin red.
    if (error && esErrorDeRed(error) && haySesionGuardada()) return { estado: 'offline', user: usuarioOffline(null) };
    // Sin sesión guardada, o el servidor la rechazó (supabase-js ya la borró).
    return { estado: 'sin-sesion', user: null };
  }

  const cache = leerPerfilCache();
  const mismaCuenta = cache && cache.id === session.user.id;
  try {
    const { data: profile, error: ep } = await conLimite(
      _db.from('profiles').select('nombre, role').eq('id', session.user.id).maybeSingle(), T_PERFIL_MS);
    if (ep) throw ep;
    const user = {
      id:      session.user.id,
      email:   session.user.email,
      nombre:  profile?.nombre || (mismaCuenta && cache.nombre) || session.user.email,
      // Sin perfil legible NO se asume 'montador' para alguien del taller: rol cacheado.
      role:    profile?.role || (mismaCuenta && cache.role) || 'montador',
      empresa: mismaCuenta ? cache.empresa : null,
      offline: false,
    };
    guardarPerfilCache(user);
    return { estado: 'ok', user };
  } catch (e) {
    if (esErrorDeRed(e)) return { estado: 'offline', user: usuarioOffline(session) };
    // Error de la API (no de red): mejor el perfil cacheado que un rol inventado.
    console.warn('perfil:', e);
    return { estado: 'ok', user: { ...usuarioOffline(session), offline: false } };
  }
}

function usuarioOffline(session) {
  const cache = leerPerfilCache();
  const id = session ? session.user.id : (cache && cache.id);
  const mismaCuenta = cache && cache.id === id;
  return {
    id,
    email:   session ? session.user.email : (cache && cache.email) || '',
    nombre:  (mismaCuenta && cache.nombre) || (session && session.user.email) || '',
    role:    mismaCuenta ? cache.role : null,   // null = desconocido (nunca 'montador' por defecto)
    empresa: mismaCuenta ? cache.empresa : null,
    offline: true,
  };
}

async function getSessionUser() {
  const r = await resolverSesion();
  return r.user;
}

// ── Modo sin conexión: aviso + reintentos ─────────────────────────────────────
let _paginaProtegida = false;   // true en páginas con guarda (index, dashboard)
let _sinConexion = false;
let _tReintento = null;
let _comprobando = null;
let _ultimaComprobacion = 0;
const _alVolver = [];

// Las páginas registran aquí cómo recargar sus datos (pedidos, chats…) al volver
// la conexión o al volver a primer plano, sin recargar la página.
function alVolverALaApp(cb) { _alVolver.push(cb); }

function mostrarAvisoSinConexion() {
  _sinConexion = true;
  let el = document.getElementById('avisoRed');
  if (!el) {
    el = document.createElement('div');
    el.id = 'avisoRed';
    el.className = 'aviso-red';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="aviso-red-dot"></span>Sin conexión · reintentando…';
    document.body.appendChild(el);
  }
  el.hidden = false;
  if (!_tReintento) _tReintento = setInterval(() => comprobarConexion(true), REINTENTO_MS);
}

function ocultarAvisoSinConexion() {
  _sinConexion = false;
  const el = document.getElementById('avisoRed');
  if (el) el.hidden = true;
  if (_tReintento) { clearInterval(_tReintento); _tReintento = null; }
}

// Comprueba la sesión y, si hay red, avisa a la página para que recargue datos.
async function comprobarConexion(forzar) {
  if (!_paginaProtegida) return;
  if (_comprobando) return _comprobando;
  if (!forzar && !_sinConexion && Date.now() - _ultimaComprobacion < 3000) return;
  _comprobando = (async () => {
    const r = await resolverSesion();
    _ultimaComprobacion = Date.now();
    if (r.estado === 'sin-sesion') { irALogin(); return; }
    if (r.estado === 'offline') { mostrarAvisoSinConexion(); return; }
    const veniaSinConexion = _sinConexion;
    ocultarAvisoSinConexion();
    for (const cb of _alVolver) {
      try { await cb(r.user, { reconectado: veniaSinConexion }); } catch (e) { console.error('alVolverALaApp:', e); }
    }
  })().finally(() => { _comprobando = null; });
  return _comprobando;
}

function irALogin() {
  borrarPerfilCache();
  window.location.href = 'login.html';
}

function activarModoSesionPersistente(user) {
  if (_paginaProtegida) return;
  _paginaProtegida = true;
  pedirAlmacenamientoPersistente();
  if (user.offline) mostrarAvisoSinConexion();
  window.addEventListener('online',  () => comprobarConexion(true));
  window.addEventListener('offline', () => mostrarAvisoSinConexion());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') comprobarConexion(false);
  });
  // El servidor invalidó la sesión en segundo plano (p. ej. revocada) → login.
  _db.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' && _paginaProtegida && !_saliendo) irALogin();
  });
}

// ── Guardas ───────────────────────────────────────────────────────────────────
async function requireAuth() {
  const r = await resolverSesion();
  if (r.estado === 'sin-sesion') { irALogin(); return null; }
  activarModoSesionPersistente(r.user);
  return r.user;
}

async function requireAdmin() {
  const u = await requireAuth();
  if (!u) return null;
  // Sin red y sin rol cacheado: no se echa (la RLS protege los datos).
  if (u.role !== 'admin' && !(u.offline && !u.role)) { window.location.href = 'index.html'; return null; }
  return u;
}

// Personal del panel: admin y almacén entran al mismo dashboard y ven todo.
// El almacén se trata como admin PARA EL DASHBOARD. No sustituye a
// requireAdmin(), que sigue siendo solo-admin para las páginas que la usan.
async function requireStaff() {
  const u = await requireAuth();
  if (!u) return null;
  if (!['admin', 'almacen'].includes(u.role) && !(u.offline && !u.role)) { window.location.href = 'index.html'; return null; }
  return u;
}

async function loginUser(email, password) {
  const { error } = await _db.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(traducirAuthError(error.message));
  const u = await getSessionUser();
  if (!u) throw new Error('No se pudo iniciar sesión.');
  pedirAlmacenamientoPersistente();
  return u;
}

// El alta desde la interfaz crea SIEMPRE un montador (el disparador
// handle_new_user en la base de datos asigna el rol 'montador'). Promocionar a
// 'admin' o 'almacen' es una operación manual en la consola (ver README.md).
// empresaId: empresa cliente elegida en el registro. handle_new_user la guarda
// en profiles.empresa_id solo si existe y está activa (EMPRESAS.sql).
async function registerUser(nombre, email, password, empresaId) {
  const { error } = await _db.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { nombre: nombre.trim(), empresa_id: empresaId != null ? String(empresaId) : null } },
  });
  if (error) throw new Error(traducirAuthError(error.message));
  const u = await getSessionUser();
  if (u) { pedirAlmacenamientoPersistente(); return u; }   // confirmación por email desactivada → sesión inmediata
  throw new Error('Cuenta creada. Revisa tu correo para confirmarla antes de entrar.');
}

// "Salir" cierra la sesión DE VERDAD, también sin red: si el servidor no
// responde, se cierra en local. Se borran la sesión guardada y el perfil cacheado.
let _saliendo = false;
async function logout() {
  _saliendo = true;
  try {
    const { error } = await conLimite(_db.auth.signOut(), T_SESION_MS);
    if (error) throw error;
  } catch (e) {
    try { await _db.auth.signOut({ scope: 'local' }); } catch (e2) {}
  }
  try {
    localStorage.removeItem(SUPABASE_STORAGE_KEY);
    localStorage.removeItem(SUPABASE_STORAGE_KEY_ANTIGUA);
  } catch (e) {}
  borrarPerfilCache();
  window.location.href = 'login.html';
}

function traducirAuthError(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid credentials'))
    return 'Email o contraseña incorrectos.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'Ya existe una cuenta con ese email.';
  if (m.includes('email not confirmed'))
    return 'Tu correo aún no está confirmado.';
  if (m.includes('password'))
    return 'La contraseña no cumple los requisitos (mínimo 6 caracteres).';
  if (m.includes('failed to fetch') || m.includes('network'))
    return 'Sin conexión. Comprueba la cobertura e inténtalo de nuevo.';
  return msg || 'Error de autenticación.';
}
