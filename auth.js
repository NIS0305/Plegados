// auth.js — Autenticación sobre Supabase Auth (reemplaza el auth propio SHA-256).
//
// El rol vive en public.profiles (id = auth.users.id). getSessionUser() resuelve
// sesión + perfil y devuelve { id, email, nombre, role }. Todas las guardas son
// ASÍNCRONAS: quien las use debe await-earlas (ver app.js y dashboard.js).

async function getSessionUser() {
  const { data: { session } } = await _db.auth.getSession();
  if (!session) return null;
  const { data: profile } = await _db
    .from('profiles')
    .select('nombre, role')
    .eq('id', session.user.id)
    .maybeSingle();
  return {
    id:     session.user.id,
    email:  session.user.email,
    nombre: profile?.nombre || session.user.email,
    role:   profile?.role   || 'montador',
  };
}

async function requireAuth() {
  const u = await getSessionUser();
  if (!u) { window.location.href = 'login.html'; return null; }
  return u;
}

async function requireAdmin() {
  const u = await requireAuth();
  if (!u) return null;
  if (u.role !== 'admin') { window.location.href = 'index.html'; return null; }
  return u;
}

// Personal del panel: admin y almacén entran al mismo dashboard y ven todo.
// El almacén se trata como admin PARA EL DASHBOARD. No sustituye a
// requireAdmin(), que sigue siendo solo-admin para las páginas que la usan.
async function requireStaff() {
  const u = await requireAuth();
  if (!u) return null;
  if (!['admin', 'almacen'].includes(u.role)) { window.location.href = 'index.html'; return null; }
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
  return u;
}

// El alta desde la interfaz crea SIEMPRE un montador (el disparador
// handle_new_user en la base de datos asigna el rol 'montador'). Promocionar a
// 'admin' o 'almacen' es una operación manual en la consola (ver README.md).
async function registerUser(nombre, email, password) {
  const { error } = await _db.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { nombre: nombre.trim() } },
  });
  if (error) throw new Error(traducirAuthError(error.message));
  const u = await getSessionUser();
  if (u) return u;                       // confirmación por email desactivada → sesión inmediata
  throw new Error('Cuenta creada. Revisa tu correo para confirmarla antes de entrar.');
}

async function logout() {
  await _db.auth.signOut();
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
  return msg || 'Error de autenticación.';
}
