// Shared utilities

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function getPedidos() {
  try { return JSON.parse(localStorage.getItem('pedidos') || '[]'); }
  catch(e) { console.error('getPedidos error:', e); return []; }
}

function savePedidos(list) {
  try {
    localStorage.setItem('pedidos', JSON.stringify(list));
  } catch(e) {
    console.error('savePedidos error:', e);
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      // Reintentar sin imágenes para liberar espacio
      try {
        const sinImagenes = list.map(p => ({ ...p, fileData: null, fileName: null, fileType: null }));
        localStorage.setItem('pedidos', JSON.stringify(sinImagenes));
        showToast('⚠️ Guardado sin imagen (almacenamiento lleno)');
      } catch(e2) {
        showToast('❌ Almacenamiento lleno. Borra pedidos antiguos desde el dashboard.');
        throw e2;
      }
    } else {
      showToast('❌ Error al guardar: ' + e.message);
      throw e;
    }
  }
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const WORKFLOW_STEPS = [
  { key: 'Pendiente',              icon: '📋', label: 'Pendiente' },
  { key: 'En proceso',             icon: '🔧', label: 'En proceso' },
  { key: 'Completado',             icon: '✅', label: 'Completado' },
  { key: 'En taller',              icon: '🏭', label: 'En taller' },
  { key: 'Entregado a montador',   icon: '👷', label: 'Entregado a ti' },
  { key: 'Entregado a reparto',    icon: '🎉', label: 'Entregado' },
];

function badgeClass(estado) {
  if (estado === 'Pendiente')            return 'badge-yellow';
  if (estado === 'En proceso')           return 'badge-blue';
  if (estado === 'Completado')           return 'badge-green';
  if (estado === 'En taller')            return 'badge-indigo';
  if (estado === 'Entregado a montador') return 'badge-teal';
  if (estado === 'Entregado a reparto')  return 'badge-emerald';
  return 'badge-gray';
}

function renderStepper(estado) {
  const currentIdx = WORKFLOW_STEPS.findIndex(s => s.key === estado);
  return `<div class="stepper">
    ${WORKFLOW_STEPS.map((s, i) => {
      const done    = i < currentIdx;
      const active  = i === currentIdx;
      const cls     = done ? 'step-done' : active ? 'step-active' : 'step-pending';
      return `
        <div class="step ${cls}">
          <div class="step-circle">${done ? '✓' : s.icon}</div>
          <span class="step-label">${s.label}</span>
        </div>
        ${i < WORKFLOW_STEPS.length - 1 ? `<div class="step-line ${done ? 'line-done' : ''}"></div>` : ''}
      `;
    }).join('')}
  </div>`;
}

const MONTADOR_STEPS = [
  { key: 'Pendiente',  icon: '📋', label: 'Pendiente' },
  { key: 'Completado', icon: '✅', label: 'Completado' },
];

function renderMontadorStepper(estado) {
  const isCompletado = ['Completado','En taller','Entregado a montador','Entregado a reparto'].includes(estado);
  return `<div class="stepper">
    ${MONTADOR_STEPS.map((s, i) => {
      const done   = i === 1 && isCompletado;
      const active = i === 0 ? !isCompletado : isCompletado;
      const cls    = done ? 'step-done' : active ? 'step-active' : 'step-pending';
      return `
        <div class="step ${cls}">
          <div class="step-circle">${done ? '✓' : s.icon}</div>
          <span class="step-label">${s.label}</span>
        </div>
        ${i < MONTADOR_STEPS.length - 1 ? `<div class="step-line ${done ? 'line-done' : ''}"></div>` : ''}
      `;
    }).join('')}
  </div>`;
}

function openModal(pedido) {
  const body = document.getElementById('modalBody');
  if (!body) return;
  document.getElementById('modalTitle').textContent = `Pedido #${pedido.id}`;

  let imgHtml = '';
  if (pedido.fileData && pedido.fileType && pedido.fileType.startsWith('image/')) {
    imgHtml = `<div class="detail-row">
      <div class="detail-label">Dibujo adjunto</div>
      <img src="${pedido.fileData}" class="modal-img" alt="Dibujo" />
    </div>`;
  } else if (pedido.fileData) {
    imgHtml = `<div class="detail-row">
      <div class="detail-label">Archivo adjunto</div>
      <p class="detail-value">📄 ${escHtml(pedido.fileName)}</p>
    </div>`;
  }

  body.innerHTML = `
    <div class="detail-row">
      <div class="detail-label">Montador</div>
      <div class="detail-value">${escHtml(pedido.montador)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Fecha</div>
      <div class="detail-value">${pedido.fecha}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Estado</div>
      <div class="detail-value"><span class="badge ${badgeClass(pedido.estado)}">${pedido.estado}</span></div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Medidas de Plegado</div>
      <div class="detail-value">
        Largo: <strong>${escHtml(pedido.largo)} mm</strong> &nbsp;·&nbsp;
        Ancho: <strong>${escHtml(pedido.ancho)} mm</strong> &nbsp;·&nbsp;
        Espesor: <strong>${escHtml(pedido.espesor)} mm</strong>
        ${pedido.angulo ? ` &nbsp;·&nbsp; Ángulo: <strong>${escHtml(pedido.angulo)}°</strong>` : ''}
      </div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Cantidad</div>
      <div class="detail-value">${escHtml(pedido.cantidad)} piezas</div>
    </div>
    ${pedido.material ? `<div class="detail-row">
      <div class="detail-label">Material</div>
      <div class="detail-value">${escHtml(pedido.material)}</div>
    </div>` : ''}
    ${pedido.referencia ? `<div class="detail-row">
      <div class="detail-label">Número de Referencia</div>
      <div class="detail-value">${escHtml(pedido.referencia)}</div>
    </div>` : ''}
    ${pedido.ral ? `<div class="detail-row">
      <div class="detail-label">Color RAL</div>
      <div class="detail-value">${escHtml(pedido.ral)}</div>
    </div>` : ''}
    ${pedido.notas ? `<div class="detail-row">
      <div class="detail-label">Notas</div>
      <div class="detail-value">${escHtml(pedido.notas)}</div>
    </div>` : ''}
    ${imgHtml}
  `;
  document.getElementById('modalOverlay').style.display = 'flex';
}

// ===== FORM PAGE =====
const form = document.getElementById('pedidoForm');
if (form) {
  // Auth check
  const currentUser = requireAuth();
  if (!currentUser) throw new Error('Not authenticated');

  // Fill navbar
  document.getElementById('navUsername').textContent = currentUser.nombre;
  document.getElementById('navAvatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
  document.getElementById('logoutBtn').addEventListener('click', logout);
  // Montadores cannot see dashboard link
  if (currentUser.role !== 'admin') {
    const dashLink = document.querySelector('a[href="dashboard.html"]');
    if (dashLink) dashLink.style.display = 'none';
  }

  // Fill montador field
  document.getElementById('montador').value = currentUser.nombre;

  // Upload logic
  const uploadArea    = document.getElementById('uploadArea');
  const fileInput     = document.getElementById('dibujo');
  const browseBtn     = document.getElementById('browseBtn');
  const filePreview   = document.getElementById('filePreview');
  const uploadContent = document.getElementById('uploadContent');
  const previewImg    = document.getElementById('previewImg');
  const fileNameEl    = document.getElementById('fileName');
  const removeFile    = document.getElementById('removeFile');
  let fileData = null, fileName = null, fileType = null;

  browseBtn.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('click', (e) => {
    if (e.target === uploadArea || (e.target.closest('.upload-content') && e.target !== browseBtn))
      fileInput.click();
  });
  uploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', ()  => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault(); uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
  removeFile.addEventListener('click', () => {
    fileData = null; fileName = null; fileType = null; fileInput.value = '';
    filePreview.style.display = 'none'; uploadContent.style.display = '';
  });

  function loadFile(file) {
    const valid = ['image/jpeg','image/png','image/svg+xml','image/webp','application/pdf'];
    if (!valid.includes(file.type)) { showToast('Tipo de archivo no soportado.'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('El archivo supera los 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      fileData = e.target.result; fileName = file.name; fileType = file.type;
      if (file.type.startsWith('image/')) { previewImg.src = fileData; previewImg.style.display = ''; }
      else previewImg.style.display = 'none';
      fileNameEl.textContent = file.name;
      uploadContent.style.display = 'none'; filePreview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }

  function validate() {
    let ok = true;
    [
      { id: 'largo',    errId: 'err-largo',    msg: 'Ingresa el largo' },
      { id: 'ancho',    errId: 'err-ancho',    msg: 'Ingresa el ancho' },
      { id: 'espesor',  errId: 'err-espesor',  msg: 'Ingresa el espesor' },
      { id: 'cantidad', errId: 'err-cantidad', msg: 'Ingresa la cantidad' },
    ].forEach(f => {
      const el = document.getElementById(f.id);
      if (!el.value.trim() || Number(el.value) <= 0) {
        el.classList.add('invalid'); document.getElementById(f.errId).textContent = f.msg; ok = false;
      } else {
        el.classList.remove('invalid'); document.getElementById(f.errId).textContent = '';
      }
    });
    return ok;
  }

  ['largo','ancho','espesor','cantidad'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      document.getElementById(id).classList.remove('invalid');
      document.getElementById('err-' + id).textContent = '';
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validate()) return;
    const pedido = {
      id: Date.now(),
      userId: currentUser.id,
      fecha: new Date().toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
      montador: currentUser.nombre,
      largo:    document.getElementById('largo').value,
      ancho:    document.getElementById('ancho').value,
      espesor:  document.getElementById('espesor').value,
      angulo:   document.getElementById('angulo').value || '',
      material: document.getElementById('material').value,
      cantidad: document.getElementById('cantidad').value,
      notas:      document.getElementById('notas').value.trim(),
      referencia: document.getElementById('referencia').value.trim(),
      ral:        document.getElementById('ral').value.trim(),
      fileData, fileName, fileType,
      estado: 'Pendiente',
    };
    const pedidos = getPedidos();
    pedidos.unshift(pedido);
    console.log('Guardando pedido:', pedido.id, '| Total antes:', pedidos.length);
    savePedidos(pedidos);
    const verificacion = getPedidos();
    if (verificacion.length === 0 || verificacion[0].id !== pedido.id) {
      showToast('❌ El pedido no se pudo guardar. Comprueba la consola.');
      console.error('savePedidos verification failed', { saved: verificacion.length, expectedId: pedido.id });
      return;
    }
    showToast('✅ Pedido enviado correctamente');
    form.reset();
    document.getElementById('montador').value = currentUser.nombre;
    document.getElementById('referencia').value = '';
    document.getElementById('ral').value = '';
    fileData = null; fileName = null; fileType = null;
    filePreview.style.display = 'none'; uploadContent.style.display = '';
    previewImg.src = '';
    renderMyOrders();
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    fileData = null; fileName = null; fileType = null;
    filePreview.style.display = 'none'; uploadContent.style.display = '';
    previewImg.src = '';
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
    document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
    document.getElementById('montador').value = currentUser.nombre;
  });

  // Modal
  document.getElementById('modalClose').addEventListener('click', () =>
    document.getElementById('modalOverlay').style.display = 'none');
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay'))
      document.getElementById('modalOverlay').style.display = 'none';
  });

  // My orders list
  document.getElementById('myFilterEstado').addEventListener('change', renderMyOrders);

  document.getElementById('misPedidosList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'ver') {
      const p = getPedidos().find(p => p.id === id);
      if (p) openModal(p);
    }
  });

  function renderMyOrders() {
    const list   = document.getElementById('misPedidosList');
    const estado = document.getElementById('myFilterEstado').value;
    let pedidos  = getPedidos().filter(p => p.userId === currentUser.id);
    if (estado) pedidos = pedidos.filter(p => p.estado === estado);

    document.getElementById('myCount').textContent = getPedidos().filter(p => p.userId === currentUser.id).length;

    if (pedidos.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:32px 0">
        <span class="empty-icon" style="font-size:36px">📋</span>
        <p>${estado ? 'No hay pedidos con ese estado.' : 'Aún no has enviado pedidos.'}</p>
      </div>`;
      return;
    }

    list.innerHTML = pedidos.map(p => {
      let fileHtml = '';
      if (p.fileData && p.fileType && p.fileType.startsWith('image/'))
        fileHtml = `<img src="${p.fileData}" class="thumb-preview" alt="Dibujo" data-id="${p.id}" />`;
      else if (p.fileData)
        fileHtml = `<span class="has-file-icon" style="font-size:28px" data-id="${p.id}" title="${escHtml(p.fileName)}">📄</span>`;

      return `
      <div class="pedido-card estado-${escHtml(p.estado.replace(' ','-'))}">
        <div class="pedido-info">
          <div class="pedido-top">
            <span class="pedido-id">#${p.id}</span>
            <span class="pedido-fecha">${p.fecha}</span>
          </div>
          <div class="medidas-row">
            <div class="medida-item"><span>Largo: </span>${escHtml(p.largo)} mm</div>
            <div class="medida-item"><span>Ancho: </span>${escHtml(p.ancho)} mm</div>
            <div class="medida-item"><span>Espesor: </span>${escHtml(p.espesor)} mm</div>
            ${p.angulo ? `<div class="medida-item"><span>Ángulo: </span>${escHtml(p.angulo)}°</div>` : ''}
            <div class="medida-item"><span>Cant.: </span>${escHtml(p.cantidad)} pz</div>
          </div>
          <div class="pedido-meta">
            <span class="badge ${badgeClass(p.estado)}">${p.estado}</span>
            ${p.material ? `<span class="badge badge-gray">${escHtml(p.material)}</span>` : ''}
            ${p.referencia ? `<span class="badge badge-gray">📎 ${escHtml(p.referencia)}</span>` : ''}
            ${p.ral ? `<span class="badge badge-gray">🎨 ${escHtml(p.ral)}</span>` : ''}
            ${fileHtml}
          </div>
          ${p.notas ? `<p style="margin-top:8px;font-size:13px;color:var(--text-dim)">📝 ${escHtml(p.notas)}</p>` : ''}
          ${renderMontadorStepper(p.estado)}
        </div>
        <div class="pedido-actions">
          <button class="icon-btn" data-action="ver" data-id="${p.id}" title="Ver detalle">🔍</button>
        </div>
      </div>`;
    }).join('');
  }

  renderMyOrders();
}
