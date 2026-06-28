// Auth utilities — SHA-256 via Web Crypto API

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + '_plegado_chapa_v1');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem('currentUser') || 'null'); }
  catch { return null; }
}
function setCurrentUser(u) { sessionStorage.setItem('currentUser', JSON.stringify(u)); }

function logout() {
  sessionStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

const ADMIN_CODE   = 'PLEGADO_ADMIN';
const ALMACEN_CODE = 'PLEGADO_ALMACEN';

function requireAuth() {
  const u = getCurrentUser();
  if (!u) { window.location.href = 'login.html'; return null; }
  return u;
}

function requireAdmin() {
  const u = requireAuth();
  if (!u) return null;
  if (u.role !== 'admin') { window.location.href = 'index.html'; return null; }
  return u;
}

async function registerUser(nombre, email, password, adminCode = '') {
  const { data: existing } = await _db.from('users')
    .select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (existing) throw new Error('Ya existe una cuenta con ese email.');

  const code = (adminCode || '').trim();
  const role = code === ADMIN_CODE ? 'admin' : code === ALMACEN_CODE ? 'almacen' : 'montador';
  const user = {
    id:           Date.now(),
    nombre:       nombre.trim(),
    email:        email.trim().toLowerCase(),
    passwordHash: await hashPassword(password),
    role,
    creadoEl:     new Date().toLocaleDateString('es-ES'),
  };
  await insertDbUser(user);
  return user;
}

async function loginUser(email, password) {
  const { data: row } = await _db.from('users')
    .select('*').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (!row) throw new Error('No existe una cuenta con ese email.');
  if (await hashPassword(password) !== row.password_hash) throw new Error('Contraseña incorrecta.');
  return {
    id:       row.id,
    nombre:   row.nombre,
    email:    row.email,
    role:     row.role,
    creadoEl: row.creado_el,
  };
}
