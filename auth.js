// Auth utilities — SHA-256 via Web Crypto API

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + '_plegado_chapa_v1');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem('users') || '[]'); }
  catch { return []; }
}
function saveUsers(u) { localStorage.setItem('users', JSON.stringify(u)); }

function getCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem('currentUser') || 'null'); }
  catch { return null; }
}
function setCurrentUser(u) { sessionStorage.setItem('currentUser', JSON.stringify(u)); }

function logout() {
  sessionStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

// Change this code to give admin access during registration
const ADMIN_CODE = 'PLEGADO_ADMIN';

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
  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    throw new Error('Ya existe una cuenta con ese email.');
  const role = adminCode.trim() === ADMIN_CODE ? 'admin' : 'montador';
  const user = {
    id: Date.now(),
    nombre: nombre.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: await hashPassword(password),
    role,
    creadoEl: new Date().toLocaleDateString('es-ES'),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

async function loginUser(email, password) {
  const users = getUsers();
  const user  = users.find(u => u.email === email.trim().toLowerCase());
  if (!user) throw new Error('No existe una cuenta con ese email.');
  if (await hashPassword(password) !== user.passwordHash)
    throw new Error('Contraseña incorrecta.');
  return user;
}
