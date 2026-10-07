// Shared utilities

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), duration);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Pasos del stepper del modal (dashboard), según ESTADOS (supabase.js). Los dos
// "Entregado" son alternativos: comparten el último paso.
const WORKFLOW_STEPS = [
  { keys: ['Pendiente'],                                   icon: '📋', label: 'Pendiente' },
  { keys: ['En taller'],                                   icon: '🏭', label: 'En taller' },
  { keys: ['Completado'],                                  icon: '✅', label: 'Completado' },
  { keys: ['Entregado a montador', 'Entregado a reparto'], icon: '🚚', label: 'Entregado' },
];

function badgeClass(estado) {
  if (estado === 'Pendiente')  return 'badge-yellow';
  if (estado === 'En taller')  return 'badge-taller';
  if (esFinalizado(estado))    return 'badge-green';
  return 'badge-gray';
}

function renderStepper(estado) {
  const currentIdx = WORKFLOW_STEPS.findIndex(s => s.keys.includes(estado));
  return `<div class="stepper">
    ${WORKFLOW_STEPS.map((s, i) => {
      const done   = i < currentIdx;
      const active = i === currentIdx;
      const cls    = done ? 'step-done' : active ? 'step-active' : 'step-pending';
      const label  = active && s.keys.length > 1 ? escHtml(estado) : s.label;
      return `
        <div class="step ${cls}">
          <div class="step-circle">${done ? '✓' : s.icon}</div>
          <span class="step-label">${label}</span>
        </div>
        ${i < WORKFLOW_STEPS.length - 1 ? `<div class="step-line ${done ? 'line-done' : ''}"></div>` : ''}
      `;
    }).join('')}
  </div>`;
}

// Hoja del plano en el modal: imagen, o enlace si es PDF u otro tipo.
function htmlHojaPlano(a) {
  if (!a) return `<span class="no-plano">Sin plano adjunto</span>`;
  const url = getPublicUrl(a.path);
  return esImagenPlano(a)
    ? `<a href="${escHtml(url)}" target="_blank" rel="noopener" title="Abrir a tamaño completo"><img src="${escHtml(url)}" class="modal-img" alt="Plano" /></a>`
    : `<a href="${escHtml(url)}" target="_blank" rel="noopener" class="obtn">📄 ${escHtml(a.name || 'Abrir archivo')}</a>`;
}

let _modalPlanos = [];

function openModal(pedido) {
  const body = document.getElementById('modalBody');
  if (!body) return;
  document.getElementById('modalTitle').textContent = pedido.referencia ? `Pedido ${pedido.referencia}` : `Pedido #${pedido.id}`;

  // Todos los planos del pedido (hasta 5). Pedidos antiguos: file_path.
  _modalPlanos = planosDe(pedido);
  const miniaturas = _modalPlanos.length > 1
    ? `<div class="plano-thumbs">${_modalPlanos.map((a, i) => esImagenPlano(a)
        ? `<button type="button" class="plano-thumb${i === 0 ? ' on' : ''}" data-modal-plano="${i}" title="Plano ${i + 1}"><img src="${escHtml(getPublicUrl(a.path))}" alt="Plano ${i + 1}" /><span>${i + 1}</span></button>`
        : `<button type="button" class="plano-thumb pdf${i === 0 ? ' on' : ''}" data-modal-plano="${i}" title="${escHtml(a.name || 'PDF')}">PDF<span>${i + 1}</span></button>`
      ).join('')}</div>`
    : '';

  // Documentos del pedido (PDF del plano y etiqueta), p.ej. los que genera n8n.
  const pdfUrl = pedido.pdfPath      ? getPublicUrl(pedido.pdfPath)      : null;
  const etqUrl = pedido.etiquetaPath ? getPublicUrl(pedido.etiquetaPath) : null;
  const pdfHtml = pdfUrl ? `<div class="doc">
      <div class="dl"><div class="di">🖨️</div><div><div class="dt cond">Plano (PDF)</div><div class="ds">${escHtml(pedido.fileName || 'plano.pdf')}</div></div></div>
      <a href="${pdfUrl}" target="_blank" rel="noopener" class="obtn">Abrir / Imprimir</a>
    </div>` : '';
  const etiquetaHtml = etqUrl
    ? `<div class="doc">
      <div class="dl"><div class="di key">🏷️</div><div><div class="dt cond">Etiqueta</div><div class="ds">Generada</div></div></div>
      <a href="${etqUrl}" target="_blank" rel="noopener" class="obtn">Abrir / Imprimir</a>
    </div>`
    : `<div class="doc">
      <div class="dl"><div class="di key">🏷️</div><div><div class="dt cond">Etiqueta</div><div class="ds">Aún no generada</div></div></div>
      <button type="button" id="genEtiquetaBtn" class="gbtn cond" data-id="${pedido.id}" data-ref="${escHtml(pedido.referencia || '')}">＋ Generar etiqueta</button>
    </div>`;

  // Chat con el montador (dashboard): "Abrir chat", "Escribir al montador" o
  // "sin montador con cuenta". Lo resuelve dashboard.js (htmlChatModal).
  const chatHtml = typeof window.htmlChatModal === 'function' ? window.htmlChatModal(pedido) : '';

  const origen = pedido.origen === 'email' ? '<span class="tag email">Email</span>' : '';
  const row = (k, v, long) => v == null || v === '' ? '' : `<div class="row${long ? ' long' : ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  body.innerHTML = `
    <div class="mgrid">
      <div class="plano">
        <div class="lab">${_modalPlanos.length > 1 ? `Planos · ${_modalPlanos.length}` : 'Plano adjunto'}</div>
        <div class="sheet" id="modalSheet">${htmlHojaPlano(_modalPlanos[0])}</div>
        ${miniaturas}
      </div>
      <div class="detail">
        ${row('Solicitante', `${escHtml(pedido.montador)} ${origen}`)}
        ${typeof window.htmlEmpresaModal === 'function' ? window.htmlEmpresaModal(pedido) : ''}
        ${row('Fecha', escHtml(pedido.fecha))}
        ${row('Estado', `<span class="badge ${badgeClass(pedido.estado)}">${escHtml(pedido.estado)}</span>`)}
        ${row('Cantidad', `${escHtml(pedido.cantidad)} ${Number(pedido.cantidad) === 1 ? 'pieza' : 'piezas'}`)}
        ${pedido.cristalFijo != null ? row('Cristal fijo', escHtml(pedido.cristalFijo)) : ''}
        ${row('Referencia', escHtml(pedido.referencia))}
        ${row('Color RAL', escHtml(pedido.ral))}
        ${row('Notas', escHtml(pedido.notas), true)}
        ${pedido.notaAdmin ? `<div class="note"><div class="nl">Nota del taller</div><div class="nt">${escHtml(pedido.notaAdmin)}</div></div>` : ''}
        <div class="docs">
          ${chatHtml}
          ${pdfHtml}
          ${etiquetaHtml}
        </div>
      </div>
    </div>
    ${renderStepper(pedido.estado)}
  `;
  document.getElementById('modalOverlay').style.display = 'flex';
}

// Galería del modal: cambiar el plano que se ve en la hoja.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-modal-plano]');
  if (!t) return;
  const i = Number(t.dataset.modalPlano);
  const sheet = document.getElementById('modalSheet');
  if (!sheet || !_modalPlanos[i]) return;
  sheet.innerHTML = htmlHojaPlano(_modalPlanos[i]);
  document.querySelectorAll('[data-modal-plano]').forEach(b => b.classList.toggle('on', b === t));
});

// Comprime una foto en el cliente antes de subirla (lado largo máx. ~2000 px,
// JPEG ~0.8) para que vaya rápido con datos móviles. PDF, SVG y GIF van tal
// cual. Si el navegador no puede decodificarla, devuelve el original.
async function comprimirImagen(file, maxLado = 2000, calidad = 0.8) {
  if (!file || !/^image\//.test(file.type) || /svg|gif/.test(file.type)) return file;
  try {
    let fuente, w, h;
    if (window.createImageBitmap) {
      fuente = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w = fuente.width; h = fuente.height;
    } else {
      fuente = await new Promise((ok, ko) => {
        const img = new Image();
        img.onload = () => ok(img); img.onerror = ko;
        img.src = URL.createObjectURL(file);
      });
      w = fuente.naturalWidth; h = fuente.naturalHeight;
    }
    const k = Math.min(1, maxLado / Math.max(w, h));
    const cw = Math.round(w * k), ch = Math.round(h * k);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);   // PNG con transparencia → fondo blanco
    ctx.drawImage(fuente, 0, 0, cw, ch);
    if (fuente.close) fuente.close();
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', calidad));
    if (!blob) return file;
    if (k === 1 && file.type === 'image/jpeg' && blob.size >= file.size) return file;
    const nombre = (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (err) {
    console.warn('comprimirImagen: se sube el original', err);
    return file;
  }
}

// ===== APP DEL MONTADOR (index.html) =====
// Una sola página con vistas por hash. Maqueta aprobada:
// rediseno-mockups/maqueta-movil-montador.html
const mApp = document.getElementById('mApp');
if (mApp) (async () => {
  const currentUser = await requireAuth();
  if (!currentUser) return;   // requireAuth ya redirige a login.html
  document.body.style.visibility = 'visible';   // autenticado: mostrar (evita el flash)

  const $ = id => document.getElementById(id);
  // Finalizado = Completado o Entregado: definición única en supabase.js.
  const esFin = esFinalizado;
  const MAX_PLANOS = 5;
  const MAX_BYTES  = 10 * 1024 * 1024;

  const M = {
    pedidos: [], chats: [], cargado: false,
    ultimoEnviado: null,
    planos: [],          // [{ file, url }] del formulario de nuevo pedido
    chat: null,          // vista de chat abierta: { pedidoId, chatId, mensajes, urls }
    imagenChat: null,    // { file, url } pendiente de enviar en el chat
    enviando: false,
  };

  // ── Iconos (SVG en línea, sin emojis) ──────────────────────────────────────
  const ICO = {
    back:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F0EFE8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    plus:  (c = '#111110') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    chat:  (c, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z"/></svg>`,
    check: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#A3E635" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    check16: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A3E635" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    doc:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F0EFE8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
    pdf:   '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#B7B7B6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
    info:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A3E635" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="m-flexnone"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    lock:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B7B7B6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="m-flexnone"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    galeria: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F0EFE8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
    camara:  (c = '#F0EFE8', s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg>`,
    enviar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111110" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    x:     (c = '#111110', s = 12) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    chev:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E8E86" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  };

  // ── Cabecera de Inicio ──────────────────────────────────────────────────────
  const partes = String(currentUser.nombre || '').trim().split(/\s+/).filter(Boolean);
  $('mNombre').textContent   = currentUser.nombre;
  $('mIniciales').textContent = ((partes[0] || '?')[0] + (partes[1] ? partes[1][0] : '')).toUpperCase();
  $('mRol').textContent = currentUser.role === 'admin' ? 'ADMIN' : currentUser.role === 'almacen' ? 'ALMACÉN' : 'MONTADOR';
  // Empresa del perfil, solo lectura ("MONTADOR · <EMPRESA>"). Sin empresa no
  // se bloquea nada: sus pedidos quedan sin empresa y el taller los asigna.
  const rolBase = $('mRol').textContent;
  function pintarEmpresa(nombre) {
    $('mRol').textContent = nombre ? `${rolBase} · ${nombre.toUpperCase()}` : rolBase;
    $('mRol').title = nombre || '';
  }
  // Sin red: la empresa cacheada de la última vez. Con red: se refresca y se cachea.
  pintarEmpresa(currentUser.empresa);
  function refrescarEmpresa() {
    getMiEmpresa(currentUser.id).then(nombre => {
      if (nombre === undefined) return;   // no se pudo leer: se queda la cacheada
      currentUser.empresa = nombre;
      guardarPerfilCache(currentUser);
      pintarEmpresa(nombre);
    });
  }
  if (!currentUser.offline) refrescarEmpresa();
  $('mMontadorChip').textContent = String(currentUser.nombre || '').toUpperCase();
  $('logoutBtn').addEventListener('click', logout);
  if (['admin', 'almacen'].includes(currentUser.role)) $('mDashLink').hidden = false;

  // ── Utilidades de formato ───────────────────────────────────────────────────
  // fecha de pedido: "dd/mm/aaaa, HH:MM" (toLocaleString es-ES)
  function fechaDePedido(str) {
    if (!str) return null;
    const [f, hm = '00:00'] = String(str).split(', ');
    const [d, m, y] = f.split('/');
    const dt = new Date(`${y}-${m}-${d}T${hm}`);
    return isNaN(dt) ? null : dt;
  }
  const dosDig = n => String(n).padStart(2, '0');
  const horaDe = dt => `${dosDig(dt.getHours())}:${dosDig(dt.getMinutes())}`;
  function mismoDia(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function cuando(dt, conHora = true) {
    if (!dt) return '';
    const hoy = new Date(); const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    if (mismoDia(dt, hoy))  return conHora ? `Hoy ${horaDe(dt)}` : horaDe(dt);
    if (mismoDia(dt, ayer)) return conHora ? `Ayer ${horaDe(dt)}` : 'Ayer';
    return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  const refDe   = p => p ? (p.referencia ? p.referencia : `#${p.id}`) : '';
  const plural  = (n, uno, varios) => `${n} ${Number(n) === 1 ? uno : varios}`;
  const pedidoDe = id => M.pedidos.find(p => p.id === Number(id));
  const chatDe   = pedidoId => M.chats.find(c => c.pedidoId === Number(pedidoId));
  const noLeidosTotal = () => M.chats.reduce((s, c) => s + (c.noLeidosMontador || 0), 0);

  function chipEstado(estado) {
    const cls = esFin(estado) ? 'fin' : estado === 'En taller' ? 'taller' : 'pend';
    return `<span class="m-chip ${cls}"><span class="m-dot"></span>${escHtml(String(estado || '').toUpperCase())}</span>`;
  }
  function metaPedido(p, conCristal) {
    const n = planosDe(p).length;
    return [
      plural(escHtml(p.cantidad), 'pieza', 'piezas'),
      conCristal && p.cristalFijo != null ? `Cristal ${escHtml(p.cristalFijo)}` : '',
      p.ral ? escHtml(p.ral) : '',
      n ? plural(n, 'plano', 'planos') : '',
    ].filter(Boolean).join(' · ');
  }
  const cabecera = (titulo, up, extraIzq = '', extraDer = '') => `
    <header class="m-bar">
      <button type="button" class="m-back" data-up="${escHtml(up)}" aria-label="Volver">${ICO.back}</button>
      ${extraIzq || `<h1 class="m-bar-t">${titulo}</h1>`}
      ${extraDer}
    </header>`;

  // ── Router por hash (#vista/arg). El "atrás" del móvil funciona solo:
  //    cada vista es una entrada del historial y se escucha hashchange. ──────
  const VISTAS = ['inicio', 'nuevo', 'enviado', 'pedidos', 'pedido', 'chats', 'chat'];
  const pila = [];
  let reemplazando = false;
  let ruta = { vista: 'inicio', arg: '' };

  function leerHash() {
    const h = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    const [v, ...resto] = h.split('/');
    return { vista: VISTAS.includes(v) ? v : 'inicio', arg: resto.join('/') };
  }
  const claveRuta = r => r.arg ? `${r.vista}/${r.arg}` : r.vista;

  function onHash() {
    const r = leerHash(); const k = claveRuta(r);
    if (reemplazando)                                   pila[Math.max(0, pila.length - 1)] = k;
    else if (pila.length > 1 && pila[pila.length - 2] === k) pila.pop();
    else if (pila[pila.length - 1] !== k)               pila.push(k);
    reemplazando = false;
    if (ruta.vista === 'chat' && r.vista !== 'chat') salirDelChat();
    ruta = r;
    mostrar();
  }
  function reemplazar(hash) {
    if (location.hash === hash) { onHash(); return; }
    reemplazando = true;
    location.replace(hash);
  }
  // "Subir" a la vista padre: si venimos de ella, es un atrás real.
  function subir(padre) {
    const prev = pila.length > 1 ? pila[pila.length - 2] : null;
    const esPadre = prev && (prev === padre || (!padre.includes('/') && prev.split('/')[0] === padre));
    if (esPadre) history.back();
    else reemplazar('#' + padre);
  }
  mApp.addEventListener('click', (e) => {
    const b = e.target.closest('[data-up]');
    if (b) { e.preventDefault(); subir(b.dataset.up); }
  });

  function mostrar() {
    document.querySelectorAll('.mv').forEach(s => { s.hidden = s.id !== `v-${ruta.vista}`; });
    const titulos = { inicio: 'Plegados', nuevo: 'Nuevo pedido', enviado: 'Pedido enviado', pedidos: 'Mis pedidos', pedido: 'Pedido', chats: 'Chats con taller', chat: 'Chat con taller' };
    document.title = `${titulos[ruta.vista]} — TMI Plegados`;
    pintar();
    if (ruta.vista !== 'chat') window.scrollTo(0, 0);
  }

  // Repinta la vista actual. "nuevo" y "chat" tienen estado propio (formulario,
  // composer) y no se repintan enteras desde aquí.
  function pintar() {
    switch (ruta.vista) {
      case 'inicio':  return pintarInicio();
      case 'nuevo':   return pintarSlots();
      case 'enviado': return pintarEnviado();
      case 'pedidos': return pintarPedidos();
      case 'pedido':  return pintarPedido();
      case 'chats':   return pintarChats();
      case 'chat':    return abrirChat();
    }
  }
  function repintarSiProcede() {
    if (['inicio', 'pedidos', 'pedido', 'chats'].includes(ruta.vista)) pintar();
  }

  // ── Datos ───────────────────────────────────────────────────────────────────
  async function cargarPedidos() { M.pedidos = await getPedidos({ userId: currentUser.id }); }
  async function cargarChats() {
    // La RLS ya filtra; si quien usa esta vista es del taller, solo sus pedidos.
    M.chats = (await getChatsResumen()).filter(c => c.montadorUid === currentUser.id);
  }

  // ── 1 · Inicio ──────────────────────────────────────────────────────────────
  function pintarInicio() {
    const h = new Date().getHours();
    const saludo = h < 14 ? 'BUENOS DÍAS' : h < 21 ? 'BUENAS TARDES' : 'BUENAS NOCHES';
    $('mSaludo').textContent = `${saludo}, ${(partes[0] || '').toUpperCase()}`;
    const f = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    $('mFecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
    if (!M.cargado) return;
    $('mCntCurso').textContent = M.pedidos.filter(p => !esFin(p.estado)).length;
    $('mCntTerm').textContent  = M.pedidos.filter(p =>  esFin(p.estado)).length;
    const nuevos = noLeidosTotal();
    $('mChatsSub').textContent = M.chats.length
      ? `${plural(M.chats.length, 'abierto', 'abiertos')} · ${nuevos ? plural(nuevos, 'mensaje nuevo', 'mensajes nuevos') : 'sin mensajes nuevos'}`
      : 'Sin chats abiertos';
    $('mChatsBadge').hidden = !nuevos;
    $('mChatsBadge').textContent = nuevos;

    // Aviso: el taller ha escrito (p. ej. abrió él el chat). Lleva al chat más reciente con nuevos.
    const conNuevos = M.chats.filter(c => c.noLeidosMontador > 0)
      .sort((a, b) => new Date(b.ultimoMensajeEl) - new Date(a.ultimoMensajeEl));
    const aviso = $('mAvisoTaller');
    if (conNuevos.length) {
      const c = conNuevos[0];
      const p = pedidoDe(c.pedidoId);
      aviso.href = `#chat/${c.pedidoId}`;
      $('mAvisoTallerTxt').textContent = `El taller te ha escrito sobre REF ${p ? refDe(p) : c.pedidoId}`;
      $('mAvisoTallerSub').textContent = conNuevos.length > 1 ? `Y ${conNuevos.length - 1} chat${conNuevos.length > 2 ? 's' : ''} más con mensajes nuevos` : 'Toca para abrir el chat';
      aviso.hidden = false;
    } else aviso.hidden = true;
  }

  // ── 2 · Nuevo pedido ────────────────────────────────────────────────────────
  const form = $('pedidoForm');

  function pintarSlots() {
    const n = M.planos.length;
    $('mPlanosCount').textContent = `${n} / ${MAX_PLANOS}`;
    let html = M.planos.map((pl, i) => `
      <div class="m-slot${pl.url ? '' : ' pdf'}">
        ${pl.url ? `<img src="${pl.url}" alt="Plano ${i + 1}" />` : `${ICO.pdf}<span class="m-slot-pdf">PDF</span>`}
        <span class="m-slot-n">${i + 1}</span>
        <button type="button" class="m-slot-x" data-quitar="${i}" aria-label="Quitar archivo ${i + 1}">${ICO.x()}</button>
      </div>`).join('');
    if (n < MAX_PLANOS) html += `
      <button type="button" class="m-slot-add" id="mSlotAdd" aria-label="Añadir foto o PDF">
        ${ICO.camara('#A3E635', 22)}<span>AÑADIR</span>
      </button>`;
    for (let i = n + 1; i < MAX_PLANOS; i++) html += '<div class="m-slot-empty"></div>';
    $('mSlots').innerHTML = html;
  }

  async function anadirArchivos(lista) {
    const files = [...(lista || [])];
    if (!files.length) return;
    const hueco = MAX_PLANOS - M.planos.length;
    if (files.length > hueco) showToast(`Máximo ${MAX_PLANOS} archivos por pedido. Se añaden ${hueco}.`, 3200);
    for (const f0 of files.slice(0, Math.max(0, hueco))) {
      const esPdf = f0.type === 'application/pdf' || /\.pdf$/i.test(f0.name);
      const esImg = /^image\//.test(f0.type) || /\.(heic|heif)$/i.test(f0.name);
      if (!esPdf && !esImg) { showToast(`Tipo de archivo no soportado: ${f0.name}`); continue; }
      const f = esImg ? await comprimirImagen(f0) : f0;
      if (f.size > MAX_BYTES) { showToast(`${f0.name} supera los 10 MB.`); continue; }
      M.planos.push({ file: f, url: esImg ? URL.createObjectURL(f) : null });
      pintarSlots();
    }
  }

  function vaciarPlanos() {
    M.planos.forEach(pl => pl.url && URL.revokeObjectURL(pl.url));
    M.planos = [];
  }

  $('mSlots').addEventListener('click', (e) => {
    const x = e.target.closest('[data-quitar]');
    if (x) {
      const [pl] = M.planos.splice(Number(x.dataset.quitar), 1);
      if (pl && pl.url) URL.revokeObjectURL(pl.url);
      pintarSlots();
      return;
    }
    if (e.target.closest('#mSlotAdd')) $('mAddSheet').hidden = false;
  });
  const cerrarSheet = () => { $('mAddSheet').hidden = true; };
  $('mAddCancel').addEventListener('click', cerrarSheet);
  $('mAddSheet').addEventListener('click', (e) => { if (e.target === $('mAddSheet')) cerrarSheet(); });
  $('mAddCam').addEventListener('click',   () => { cerrarSheet(); $('mFileCam').click(); });
  $('mAddFiles').addEventListener('click', () => { cerrarSheet(); $('mFileMulti').click(); });
  ['mFileCam', 'mFileMulti'].forEach(id => $(id).addEventListener('change', async (e) => {
    await anadirArchivos(e.target.files);
    e.target.value = '';
  }));

  // Steppers − / + (piezas mín. 1, cristal mín. 0). El número también se teclea.
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const el = $(b.dataset.step);
    const min = Number(el.min);
    el.value = Math.max(min, (parseInt(el.value, 10) || 0) + Number(b.dataset.d));
    el.classList.remove('invalid');
  });
  ['cantidad', 'cristalFijo'].forEach(id => $(id).addEventListener('input', () => $(id).classList.remove('invalid')));

  function validar() {
    let ok = true;
    [['cantidad', 1, 'Indica cuántas piezas (mínimo 1).'], ['cristalFijo', 0, 'Indica el cristal fijo (0 si no lleva).']].forEach(([id, min, msg]) => {
      const el = $(id); const v = el.value.trim();
      if (v === '' || !Number.isInteger(Number(v)) || Number(v) < min) {
        el.classList.add('invalid');
        if (ok) showToast(msg);
        ok = false;
      }
    });
    return ok;
  }

  function limpiarFormulario() {
    form.reset();
    $('cantidad').value = 1; $('cristalFijo').value = 0;
    document.querySelectorAll('#pedidoForm .invalid').forEach(el => el.classList.remove('invalid'));
    vaciarPlanos();
    pintarSlots();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (M.enviando || !validar()) return;
    M.enviando = true;
    const btn = $('mEnviar');
    btn.disabled = true; $('mEnviarTxt').textContent = 'ENVIANDO…';

    try {
      const pedidoId = Date.now();
      // Sube los planos (en paralelo). Si alguno falla, el pedido se guarda con el resto.
      const subidas = await Promise.allSettled(M.planos.map((pl, i) => uploadArchivoPedido(pl.file, pedidoId, i + 1)));
      const archivos = [];
      subidas.forEach((r, i) => {
        if (r.status === 'fulfilled') archivos.push({ path: r.value, name: M.planos[i].file.name, type: M.planos[i].file.type || null });
        else console.warn('Upload failed:', r.reason);
      });
      const fallos = subidas.length - archivos.length;
      if (fallos) showToast(`No se ${fallos === 1 ? 'pudo subir 1 archivo' : `pudieron subir ${fallos} archivos`}; el pedido se guarda con el resto.`, 4000);

      const primero = archivos[0] || null;   // file_* = archivo 1 (n8n, etiqueta, CSV)
      const pedido = {
        id:          pedidoId,
        userId:      currentUser.id,
        fecha:       new Date().toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
        montador:    currentUser.nombre,
        cantidad:    String(parseInt($('cantidad').value, 10)),
        cristalFijo: String(parseInt($('cristalFijo').value, 10)),
        notas:       $('notas').value.trim(),
        referencia:  $('referencia').value.trim(),
        ral:         $('ral').value.trim(),
        filePath:    primero ? primero.path : null,
        fileName:    primero ? primero.name : null,
        fileType:    primero ? primero.type : null,
        archivos,
        estado:      'Pendiente',
      };

      await savePedido(pedido);
      M.ultimoEnviado = { id: pedidoId, referencia: pedido.referencia, cantidad: pedido.cantidad, cristalFijo: pedido.cristalFijo, ral: pedido.ral, nPlanos: archivos.length };
      limpiarFormulario();
      await cargarPedidos();
      reemplazar('#enviado');   // "atrás" desde Enviado vuelve al inicio, no al formulario
    } catch (err) {
      console.error('Submit error:', err);
      showToast('Error al enviar: ' + (err.message || err), 4000);
    } finally {
      M.enviando = false;
      btn.disabled = false; $('mEnviarTxt').textContent = 'ENVIAR PEDIDO';
    }
  });

  // ── 3 · Pedido enviado ──────────────────────────────────────────────────────
  function pintarEnviado() {
    const u = M.ultimoEnviado;
    if (!u) { reemplazar('#inicio'); return; }
    const fila = (k, v) => `<div class="m-sum-row"><span>${k}</span><span>${v}</span></div>`;
    $('v-enviado').innerHTML = `
      <main class="m-main m-enviado">
        <div class="m-ok">
          <span class="m-ok-ico">${ICO.check}</span>
          <span class="m-ok-txt">
            <h1 class="m-h1 c">PEDIDO ENVIADO</h1>
            <span class="m-sub">El taller ya lo tiene en su lista.</span>
          </span>
          <div class="m-sum">
            <div class="m-sum-head"><span class="m-label">REFERENCIA</span><span class="m-sum-ref">${escHtml(u.referencia || '#' + u.id)}</span></div>
            ${fila('Piezas', escHtml(u.cantidad))}
            ${fila('Cristal fijo', escHtml(u.cristalFijo))}
            ${fila('Color', escHtml(u.ral || '—'))}
            ${fila('Planos adjuntos', u.nPlanos ? plural(u.nPlanos, 'archivo', 'archivos') : 'Ninguno')}
          </div>
        </div>
        <div class="m-actions">
          <a href="#pedidos/curso" class="m-btn-main">VER MIS PEDIDOS</a>
          <a href="#nuevo" class="m-btn-sec">${ICO.plus('#F0EFE8')} HACER OTRO PEDIDO</a>
          <a href="#inicio" class="m-btn-link">VOLVER AL INICIO</a>
        </div>
      </main>`;
  }

  // ── 4 · Mis pedidos ─────────────────────────────────────────────────────────
  function pintarPedidos() {
    const tab = ruta.arg === 'terminados' ? 'terminados' : 'curso';
    const enCurso = M.pedidos.filter(p => !esFin(p.estado));
    const term    = M.pedidos.filter(p =>  esFin(p.estado));
    const lista   = tab === 'curso' ? enCurso : term;
    const tarjeta = p => {
      const c = chatDe(p.id);
      const tagChat = c ? `<span class="m-tagchat">${ICO.chat('#A3E635', 14)}CHAT${c.noLeidosMontador ? ` <span class="m-badge sm">${c.noLeidosMontador}</span>` : ''}</span>` : '';
      return `
      <a href="#pedido/${p.id}" class="m-card">
        <span class="m-card-top">
          <span class="m-card-ref"><span class="m-label sm">REFERENCIA</span><span class="m-ref">${escHtml(refDe(p))}</span></span>
          ${chipEstado(p.estado)}
        </span>
        <span class="m-card-bot">
          <span class="m-card-meta">${metaPedido(p)}</span>
          <span class="m-card-r">${tagChat}<span class="m-when">${escHtml(cuando(fechaDePedido(p.fecha)))}</span></span>
        </span>
      </a>`;
    };
    const vacio = !M.cargado ? 'Cargando…' : tab === 'curso' ? 'No tienes pedidos en curso.' : 'Aún no hay pedidos terminados.';
    $('v-pedidos').innerHTML = `
      ${cabecera('MIS PEDIDOS', 'inicio')}
      <main class="m-main">
        <div class="m-tabs" role="tablist">
          <button type="button" role="tab" class="m-tab${tab === 'curso' ? ' on' : ''}" data-tab="curso" aria-selected="${tab === 'curso'}">En curso <span class="m-tab-n">${enCurso.length}</span></button>
          <button type="button" role="tab" class="m-tab${tab === 'terminados' ? ' on' : ''}" data-tab="terminados" aria-selected="${tab === 'terminados'}">Terminados <span class="m-tab-n">${term.length}</span></button>
        </div>
        <div class="m-list">${lista.length ? lista.map(tarjeta).join('') : `<div class="m-empty">${vacio}</div>`}</div>
      </main>
      <footer class="m-fixfoot">
        <a href="#nuevo" class="m-btn-main">${ICO.plus()} NUEVO PEDIDO</a>
      </footer>`;
  }
  $('v-pedidos').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) reemplazar(`#pedidos/${t.dataset.tab}`);
  });

  // ── 5 · Detalle del pedido ──────────────────────────────────────────────────
  function pintarPedido() {
    const p = pedidoDe(ruta.arg);
    if (!p) {
      $('v-pedido').innerHTML = `${cabecera('PEDIDO', 'pedidos')}<main class="m-main"><div class="m-empty">${M.cargado ? 'No se encuentra este pedido.' : 'Cargando…'}</div></main>`;
      return;
    }
    const fin = esFin(p.estado);
    const paso = fin ? 3 : p.estado === 'En taller' ? 2 : 1;
    const dt = fechaDePedido(p.fecha);
    const planos = planosDe(p);
    const c = chatDe(p.id);
    const celda = (k, v, cls = '') => `<div class="m-cell ${cls}"><span class="m-label sm">${k}</span><span class="m-cell-v">${v}</span></div>`;
    // Entregado: a quién (debajo de la barra).
    const entregado = p.estado === "Entregado a montador" ? "Entregado a ti"
                    : p.estado === "Entregado a reparto"  ? "En reparto" : "";

    $('v-pedido').innerHTML = `
      ${cabecera('', 'pedidos',
        `<span class="m-bar-titles"><span class="m-label sm">PEDIDO</span><h1 class="m-bar-t">REF ${escHtml(refDe(p))}</h1></span>`,
        chipEstado(p.estado))}
      <main class="m-main">
        <div class="m-box m-progress">
          <div class="m-prog-bars">${[1, 2, 3].map(i => `<span class="${i <= paso ? 'on' : ''}"></span>`).join('')}</div>
          <div class="m-prog-labels">
            <span class="on">ENVIADO${dt ? ' · ' + horaDe(dt) : ''}</span>
            <span class="${paso >= 2 ? 'on' : ''}">EN TALLER</span>
            <span class="${paso >= 3 ? 'on' : ''}">TERMINADO</span>
          </div>
          ${entregado ? `<div class="m-prog-entrega">${ICO.check16}${entregado}</div>` : ''}
        </div>

        <section class="m-sec">
          <span class="m-label">PLANOS · ${planos.length}</span>
          ${planos.length ? `<div class="m-gallery">${planos.map((a, i) => {
            const url = getPublicUrl(a.path);
            return esImagenPlano(a)
              ? `<button type="button" class="m-gal" data-ver-img="${escHtml(url)}" aria-label="Ver plano ${i + 1}"><img src="${escHtml(url)}" alt="Plano ${i + 1}" loading="lazy" /><span class="m-slot-n">${i + 1}</span></button>`
              : `<a class="m-gal pdf" href="${escHtml(url)}" target="_blank" rel="noopener" aria-label="Abrir PDF ${i + 1}">${ICO.pdf}<span class="m-gal-name">${escHtml(a.name || 'PDF')}</span><span class="m-slot-n">${i + 1}</span></a>`;
          }).join('')}</div>` : '<div class="m-box m-muted">Sin planos adjuntos.</div>'}
        </section>

        <div class="m-cells">
          ${celda('PIEZAS', escHtml(p.cantidad))}
          ${celda('CRISTAL FIJO', escHtml(p.cristalFijo ?? '—'))}
          ${celda('COLOR', escHtml(p.ral || '—'))}
          ${celda('FECHA', escHtml(dt ? dt.toLocaleDateString('es-ES') : (p.fecha || '—')))}
        </div>

        <div class="m-box m-note">
          <span class="m-label sm">MIS NOTAS</span>
          <span class="${p.notas ? '' : 'm-muted'}">${p.notas ? escHtml(p.notas) : 'Sin notas.'}</span>
        </div>
        <div class="m-box m-note${p.notaAdmin ? ' taller' : ''}">
          <span class="m-label sm">NOTA DEL TALLER</span>
          <span class="${p.notaAdmin ? '' : 'm-muted'}">${p.notaAdmin ? escHtml(p.notaAdmin) : 'Sin nota todavía.'}</span>
        </div>

      </main>
      <footer class="m-fixfoot">
        <a href="#chat/${p.id}" class="m-btn-chat">
          ${ICO.chat('#111110', 24)}
          <span class="m-btn-chat-txt">
            <span class="m-btn-chat-t">CHAT CON TALLER</span>
            <span class="m-btn-chat-s">Dudas o correcciones de este pedido</span>
          </span>
          ${c && c.noLeidosMontador ? `<span class="m-new">${c.noLeidosMontador} NUEVO${c.noLeidosMontador > 1 ? 'S' : ''}</span>` : ''}
        </a>
      </footer>`;
  }

  // ── 6 · Chats con taller ────────────────────────────────────────────────────
  function pintarChats() {
    const fila = c => {
      const p = pedidoDe(c.pedidoId);
      const u = c.ultimo;
      const prev = u ? `${u.autor_rol === 'taller' ? 'Taller' : 'Tú'}: ${u.texto ? u.texto : 'Foto'}` : 'Chat abierto, sin mensajes';
      const nuevo = c.noLeidosMontador > 0;
      return `
      <a href="#chat/${c.pedidoId}" class="m-chatrow${nuevo ? ' nuevo' : ''}">
        <span class="m-chatrow-ico">${ICO.chat(nuevo ? '#A3E635' : '#B7B7B6', 20)}</span>
        <span class="m-chatrow-main">
          <span class="m-chatrow-top">
            <span class="m-ref sm">REF ${escHtml(p ? refDe(p) : c.pedidoId)}</span>
            <span class="m-when${nuevo ? ' on' : ''}">${escHtml(cuando(new Date(u ? u.creado_el : c.ultimoMensajeEl), false))}</span>
          </span>
          <span class="m-chatrow-bot">
            <span class="m-chatrow-prev">${escHtml(prev)}</span>
            ${nuevo ? `<span class="m-badge sm">${c.noLeidosMontador}</span>` : ''}
          </span>
        </span>
      </a>`;
    };
    $('v-chats').innerHTML = `
      ${cabecera('CHATS CON TALLER', 'inicio')}
      <main class="m-main">
        <div class="m-box m-aviso">${ICO.info}<span>Hay un chat por pedido. <b>El taller lo cierra y lo elimina</b> cuando la duda está resuelta.</span></div>
        <span class="m-label">ABIERTOS · ${M.chats.length}</span>
        ${M.chats.length ? M.chats.map(fila).join('') : `<div class="m-empty">${M.cargado ? 'No tienes chats abiertos.' : 'Cargando…'}</div>`}
        <div class="m-hintbox">
          <span class="m-hintbox-t">¿Otra duda?</span>
          <span>Para otra duda, abre el pedido en «Mis pedidos» y pulsa «Chat con taller».</span>
        </div>
      </main>`;
  }

  // ── 7 · Chat del pedido ─────────────────────────────────────────────────────
  async function abrirChat() {
    const pedidoId = Number(ruta.arg);
    const p = pedidoDe(pedidoId);
    if (!p) {
      $('v-chat').innerHTML = `${cabecera('CHAT', 'inicio')}<main class="m-main"><div class="m-empty">${M.cargado ? 'No se encuentra este pedido.' : 'Cargando…'}</div></main>`;
      return;
    }
    const yaAbierto = M.chat && M.chat.pedidoId === pedidoId;
    const c = chatDe(pedidoId);
    if (!yaAbierto) {
      M.chat = { pedidoId, chatId: c ? c.id : null, mensajes: [], urls: {} };
      quitarImagenChat();
    } else if (!M.chat.chatId && c) {
      M.chat.chatId = c.id;
    }
    // El esqueleto (cabecera, franja, composer) solo se pinta al entrar.
    if (!yaAbierto || !$('mMsgs')) {
      $('v-chat').innerHTML = `
        <header class="m-bar">
          <button type="button" class="m-back" data-up="pedido/${p.id}" aria-label="Volver al pedido">${ICO.back}</button>
          <span class="m-bar-titles"><span class="m-label sm lime">CHAT CON TALLER</span><h1 class="m-bar-t">REF ${escHtml(refDe(p))}</h1></span>
          <button type="button" class="m-iconbtn bordered" data-up="pedido/${p.id}" aria-label="Ver el pedido">${ICO.doc}</button>
        </header>
        <div class="m-strip"><span>${metaPedido(p, true)}</span>${chipEstado(p.estado)}</div>
        <div class="m-msgs" id="mMsgs"></div>
        <div class="m-lock">${ICO.lock}<span>Solo el taller puede cerrar este chat. Cuando lo dé por resuelto, se eliminará con sus fotos.</span></div>
        <div class="m-preview" id="mChatPreview" hidden></div>
        <footer class="m-composer">
          <button type="button" class="m-iconbtn bordered" id="mChatGal" aria-label="Adjuntar imagen">${ICO.galeria}</button>
          <button type="button" class="m-iconbtn bordered" id="mChatCam" aria-label="Hacer foto">${ICO.camara()}</button>
          <label for="mChatTxt" class="m-sr">Mensaje</label>
          <input type="text" id="mChatTxt" class="m-input" placeholder="Escribe un mensaje…" autocomplete="off" enterkeyhint="send" maxlength="4000" />
          <button type="button" class="m-send" id="mChatSend" aria-label="Enviar">${ICO.enviar}</button>
          <input type="file" id="mChatFileGal" accept="image/*" hidden />
          <input type="file" id="mChatFileCam" accept="image/*" capture="environment" hidden />
        </footer>`;
      pintarMensajes();
    }
    if (M.chat.chatId) {
      try {
        const chatId = M.chat.chatId;
        const msgs = await getMensajesChat(chatId);
        if (!M.chat || M.chat.chatId !== chatId) return;
        M.chat.mensajes = msgs;
        await pintarMensajes();
        await marcarLeidoLocal(chatId);
      } catch (err) {
        console.error('abrirChat:', err);
        showToast('No se pudo cargar el chat.');
      }
    }
  }

  async function pintarMensajes() {
    const box = $('mMsgs');
    if (!box || !M.chat) return;
    const c = M.chat.chatId ? M.chats.find(x => x.id === M.chat.chatId) : null;
    const paths = M.chat.mensajes.filter(m => m.imagen_path).map(m => m.imagen_path);
    if (paths.length) Object.assign(M.chat.urls, await urlsFirmadasChat(paths));
    if (!M.chat || box !== $('mMsgs')) return;
    const sep = c || M.chat.chatId
      ? (() => { const d = new Date((c && c.creadoEl) || (M.chat.mensajes[0] && M.chat.mensajes[0].creado_el) || Date.now());
          const quien = c && c.abiertoPor === 'taller' ? 'EL TALLER ABRIÓ ESTE CHAT' : 'CHAT ABIERTO';
          return `<span class="m-sep">${quien} · ${dosDig(d.getDate())}/${dosDig(d.getMonth() + 1)} · ${horaDe(d)}</span>`; })()
      : `<div class="m-empty">Escribe tu duda o envía una foto de la corrección. El taller la verá en su panel.</div>`;
    box.innerHTML = sep + M.chat.mensajes.map(m => htmlMensaje(m, M.chat.urls)).join('');
    pegarAbajo(box);
  }

  // Baja al último mensaje, también cuando las imágenes terminan de cargar.
  function pegarAbajo(box) {
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, { once: true });
    });
  }

  function htmlMensaje(m, urls) {
    const mio = m.autor_rol === 'montador';
    const d = new Date(m.creado_el);
    const hora = mismoDia(d, new Date()) ? horaDe(d) : `${dosDig(d.getDate())}/${dosDig(d.getMonth() + 1)} ${horaDe(d)}`;
    const url = m.imagen_path ? urls[m.imagen_path] : null;
    const img = m.imagen_path
      ? (url ? `<button type="button" class="m-msg-img" data-ver-img="${escHtml(url)}" aria-label="Ver imagen"><img src="${escHtml(url)}" alt="Imagen del chat" /></button>`
             : `<span class="m-msg-noimg">Imagen no disponible</span>`)
      : '';
    const txt = m.texto ? `<span class="m-msg-txt">${escHtml(m.texto)}</span>` : '';
    if (mio) return `
      <div class="m-msg mio"><div class="m-bubble mio${img ? (txt ? ' con-img' : ' solo-img') : ''}">${img}${txt}</div><span class="m-msg-h">${hora}</span></div>`;
    return `
      <div class="m-msg suyo">
        <span class="m-msg-av">T</span>
        <span class="m-msg-col">
          <span class="m-label sm">TALLER TMI</span>
          <div class="m-bubble suyo${img ? (txt ? ' con-img' : ' solo-img') : ''}">${img}${txt}</div>
          <span class="m-msg-h">${hora}</span>
        </span>
      </div>`;
  }

  async function marcarLeidoLocal(chatId) {
    const c = M.chats.find(x => x.id === chatId);
    if (document.visibilityState !== 'visible') return;
    if (c && !c.noLeidosMontador) return;
    await marcarChatLeido(chatId);
    if (c) c.noLeidosMontador = 0;
  }

  function salirDelChat() {
    M.chat = null;
    quitarImagenChat();
  }

  function quitarImagenChat() {
    if (M.imagenChat && M.imagenChat.url) URL.revokeObjectURL(M.imagenChat.url);
    M.imagenChat = null;
    const pv = $('mChatPreview');
    if (pv) { pv.hidden = true; pv.innerHTML = ''; }
  }

  async function elegirImagenChat(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { showToast('Solo se pueden enviar imágenes.'); return; }
    const f = await comprimirImagen(file);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { showToast('Formato de imagen no soportado. Prueba con una foto JPG.'); return; }
    if (f.size > MAX_BYTES) { showToast('La imagen supera los 10 MB.'); return; }
    quitarImagenChat();
    M.imagenChat = { file: f, url: URL.createObjectURL(f) };
    const pv = $('mChatPreview');
    pv.innerHTML = `
      <img src="${M.imagenChat.url}" alt="Imagen lista para enviar" />
      <span>1 imagen lista para enviar</span>
      <button type="button" class="m-iconbtn" id="mChatPreviewX" aria-label="Quitar imagen">${ICO.x('#B7B7B6', 16)}</button>`;
    pv.hidden = false;
  }

  async function enviarChat() {
    if (!M.chat || M.enviando) return;
    const input = $('mChatTxt');
    const texto = input.value.trim();
    const imagen = M.imagenChat ? M.imagenChat.file : null;
    if (!texto && !imagen) return;
    M.enviando = true;
    const btn = $('mChatSend'); btn.disabled = true;
    try {
      if (!M.chat.chatId) {
        // Primer mensaje: se abre el chat del pedido (lo valida la RLS).
        const nuevo = await abrirChatPedido(M.chat.pedidoId);
        M.chat.chatId = nuevo.id;
        if (!M.chats.find(x => x.id === nuevo.id)) M.chats.unshift(nuevo);
      }
      const m = await enviarMensajeChat(M.chat.chatId, { texto, imagen });
      input.value = '';
      quitarImagenChat();
      if (M.chat && !M.chat.mensajes.find(x => x.id === m.id)) M.chat.mensajes.push(m);
      await pintarMensajes();
      refrescarChats();
    } catch (err) {
      console.error('enviarChat:', err);
      showToast('No se pudo enviar el mensaje. ' + (err.message || ''), 4000);
    } finally {
      M.enviando = false; btn.disabled = false;
    }
  }

  $('v-chat').addEventListener('click', (e) => {
    if (e.target.closest('#mChatSend'))     return enviarChat();
    if (e.target.closest('#mChatGal'))      return $('mChatFileGal').click();
    if (e.target.closest('#mChatCam'))      return $('mChatFileCam').click();
    if (e.target.closest('#mChatPreviewX')) return quitarImagenChat();
  });
  $('v-chat').addEventListener('change', async (e) => {
    if (e.target.id === 'mChatFileGal' || e.target.id === 'mChatFileCam') {
      await elegirImagenChat(e.target.files[0]);
      e.target.value = '';
    }
  });
  $('v-chat').addEventListener('keydown', (e) => {
    if (e.target.id === 'mChatTxt' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); enviarChat(); }
  });

  // ── Visor a pantalla completa ───────────────────────────────────────────────
  function abrirVisor(url) {
    $('mViewerImg').src = url;
    $('mViewer').hidden = false;
  }
  function cerrarVisor() { $('mViewer').hidden = true; $('mViewerImg').removeAttribute('src'); }
  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-ver-img]');
    if (v && v.dataset.verImg) { e.preventDefault(); abrirVisor(v.dataset.verImg); }
  });
  $('mViewer').addEventListener('click', cerrarVisor);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('mViewer').hidden) cerrarVisor(); });

  // ── Realtime ────────────────────────────────────────────────────────────────
  let _tChats = null;
  function refrescarChats() {
    clearTimeout(_tChats);
    _tChats = setTimeout(async () => {
      await cargarChats();
      if (M.chat && !M.chat.chatId) { const c = chatDe(M.chat.pedidoId); if (c) M.chat.chatId = c.id; }
      repintarSiProcede();
    }, 250);
  }

  // Pedidos: el taller cambia estado o nota.
  subscribePedidos(async () => {
    await cargarPedidos();
    repintarSiProcede();
  });

  subscribeChats({
    onMensaje: async (m) => {
      if (M.chat && M.chat.chatId === m.chat_id) {
        if (!M.chat.mensajes.find(x => x.id === m.id)) {
          M.chat.mensajes.push(m);
          await pintarMensajes();
        }
        if (m.autor_rol === 'taller') {
          const c = M.chats.find(x => x.id === m.chat_id);
          if (c) c.noLeidosMontador = 1;   // fuerza el marcado
          await marcarLeidoLocal(m.chat_id);
        }
      }
      refrescarChats();
    },
    onChat: (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old && payload.old.id;
        if (M.chat && id && M.chat.chatId === id) {
          const pedidoId = M.chat.pedidoId;
          showToast('Este chat se ha cerrado: el taller lo ha dado por resuelto.', 4000);
          M.chats = M.chats.filter(c => c.id !== id);
          reemplazar(`#pedido/${pedidoId}`);
        }
      }
      refrescarChats();
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refrescarChats();
    if (M.chat && M.chat.chatId) marcarLeidoLocal(M.chat.chatId);
  });

  // ── Arranque ────────────────────────────────────────────────────────────────
  pintarSlots();
  ruta = leerHash();
  pila.push(claveRuta(ruta));
  window.addEventListener('hashchange', onHash);
  mostrar();

  // Al volver la conexión o al volver a primer plano: recargar pedidos y chats
  // sin recargar la página (auth.js ya ha comprobado la sesión).
  alVolverALaApp(async (u) => {
    if (u && u.nombre) currentUser.nombre = u.nombre;
    currentUser.offline = false;
    refrescarEmpresa();
    await Promise.all([cargarPedidos(), cargarChats()]);
    M.cargado = true;
    if (ruta.vista === 'chat') {
      if (M.chat && M.chat.chatId) {
        try { M.chat.mensajes = await getMensajesChat(M.chat.chatId); await pintarMensajes(); } catch (e) { console.warn('recargar chat:', e); }
      } else abrirChat();
    } else pintar();
  });

  // Sin red al abrir: se muestra la app con el aviso; los datos llegan al reconectar
  // (las listas dicen "Cargando…" en vez de "no tienes pedidos").
  if (currentUser.offline) return;
  await Promise.all([cargarPedidos(), cargarChats()]);
  M.cargado = true;
  if (ruta.vista === 'chat') abrirChat(); else pintar();
})();


// ===== Generar etiqueta desde la app (llama al workflow de n8n) =====
// SOLO en el dashboard (admin/almacén), desde el modal de detalle. El montador
// no gestiona documentos: en su app (index.html, #mApp) no se registra.
// El webhook genera la MISMA etiqueta que Telegram, la guarda en Drive y en
// Supabase Storage, y rellena pedidos.etiqueta_path. Ver INTEGRACION-N8N.md.
if (!document.getElementById('mApp')) document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#genEtiquetaBtn');
  if (!btn || btn.disabled) return;
  const id  = Number(btn.dataset.id);
  const ref = btn.dataset.ref || '';
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Generando…';
  try {
    if (!N8N_ETIQUETA_WEBHOOK || /TU-N8N/.test(N8N_ETIQUETA_WEBHOOK)) {
      throw new Error('webhook-no-configurado');
    }
    const res = await fetch(N8N_ETIQUETA_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: id, referencia: ref }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let etiquetaPath = null;
    try { const j = await res.json(); etiquetaPath = j.etiqueta_path || j.etiquetaPath || null; } catch (_) {}
    const p = await getPedidoById(id);
    if (p) {
      if (etiquetaPath && !p.etiquetaPath) p.etiquetaPath = etiquetaPath;
      openModal(p);
    }
    showToast('Etiqueta generada.');
  } catch (err) {
    console.error('generar etiqueta:', err);
    btn.disabled = false;
    btn.innerHTML = original;
    showToast(err.message === 'webhook-no-configurado'
      ? 'Falta configurar el webhook de n8n (N8N_ETIQUETA_WEBHOOK).'
      : 'No se pudo generar la etiqueta. Intentalo de nuevo.');
  }
});
