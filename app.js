// Shared utilities

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const WORKFLOW_STEPS = [
  { key: 'Pendiente',            icon: '📋', label: 'Pendiente' },
  { key: 'En proceso',           icon: '🔧', label: 'En proceso' },
  { key: 'Completado',           icon: '✅', label: 'Completado' },
  { key: 'En taller',            icon: '🏭', label: 'En taller' },
  { key: 'Entregado a montador', icon: '👷', label: 'Entregado a ti' },
  { key: 'Entregado a reparto',  icon: '🎉', label: 'Entregado' },
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
      const done   = i < currentIdx;
      const active = i === currentIdx;
      const cls    = done ? 'step-done' : active ? 'step-active' : 'step-pending';
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
  const imgUrl  = pedido.filePath ? getPublicUrl(pedido.filePath) : (pedido.fileData || null);
  const isImage = pedido.fileType?.startsWith('image/') ||
                  /\.(jpg|jpeg|png|svg|webp)$/i.test(pedido.filePath || '');

  if (imgUrl && isImage) {
    imgHtml = `<div class="detail-row">
      <div class="detail-label">Dibujo adjunto</div>
      <img src="${imgUrl}" class="modal-img" alt="Dibujo" />
    </div>`;
  } else if (imgUrl) {
    imgHtml = `<div class="detail-row">
      <div class="detail-label">Archivo adjunto</div>
      <p class="detail-value"><a href="${imgUrl}" target="_blank" style="color:var(--blue)">📄 ${escHtml(pedido.fileName)}</a></p>
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
      <div class="detail-label">Cantidad</div>
      <div class="detail-value">${escHtml(pedido.cantidad)} piezas</div>
    </div>
    ${pedido.cristalFijo != null ? `<div class="detail-row">
      <div class="detail-label">Cristal fijo</div>
      <div class="detail-value">${escHtml(pedido.cristalFijo)}</div>
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
    ${pedido.notaAdmin ? `<div class="detail-row">
      <div class="detail-label" style="color:#4f8ef7">Nota del taller</div>
      <div class="detail-value" style="padding:8px 12px;background:rgba(79,142,247,.08);border-left:3px solid #4f8ef7;border-radius:0 6px 6px 0">${escHtml(pedido.notaAdmin)}</div>
    </div>` : ''}
    ${imgHtml}
  `;
  document.getElementById('modalOverlay').style.display = 'flex';
}

// ===== FORM PAGE =====
const form = document.getElementById('pedidoForm');
if (form) {
  const currentUser = requireAuth();
  if (!currentUser) throw new Error('Not authenticated');

  document.getElementById('navUsername').textContent = currentUser.nombre;
  document.getElementById('navAvatar').textContent   = currentUser.nombre.charAt(0).toUpperCase();
  document.getElementById('logoutBtn').addEventListener('click', logout);
  if (currentUser.role !== 'admin') {
    const dashLink = document.querySelector('a[href="dashboard.html"]');
    if (dashLink) dashLink.style.display = 'none';
  }

  document.getElementById('montador').textContent = currentUser.nombre;

  const uploadArea    = document.getElementById('uploadArea');
  const fileInput     = document.getElementById('dibujo');
  const browseBtn     = document.getElementById('browseBtn');
  const filePreview   = document.getElementById('filePreview');
  const uploadContent = document.getElementById('uploadContent');
  const previewImg    = document.getElementById('previewImg');
  const fileNameEl    = document.getElementById('fileName');
  const removeFile    = document.getElementById('removeFile');
  let fileData = null, fileName = null, fileType = null, fileObj = null;

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
    fileData = null; fileName = null; fileType = null; fileObj = null; fileInput.value = '';
    filePreview.style.display = 'none'; uploadContent.style.display = '';
  });

  function loadFile(file) {
    const valid = ['image/jpeg','image/png','image/svg+xml','image/webp','application/pdf'];
    if (!valid.includes(file.type)) { showToast('Tipo de archivo no soportado.'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('El archivo supera los 10 MB.'); return; }
    fileObj = file;
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
      { id: 'cantidad',    errId: 'err-cantidad',    msg: 'Ingresa la cantidad',                 min: 1 },
      { id: 'cristalFijo', errId: 'err-cristalFijo', msg: 'Ingresa la cantidad de cristal fijo', min: 0 },
    ].forEach(f => {
      const el = document.getElementById(f.id);
      if (el.value.trim() === '' || Number(el.value) < f.min) {
        el.classList.add('invalid'); document.getElementById(f.errId).textContent = f.msg; ok = false;
      } else {
        el.classList.remove('invalid'); document.getElementById(f.errId).textContent = '';
      }
    });
    return ok;
  }

  ['cantidad','cristalFijo'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      document.getElementById(id).classList.remove('invalid');
      document.getElementById('err-' + id).textContent = '';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true; submitBtn.textContent = 'Enviando...';

    try {
      const pedidoId = Date.now();
      let filePath = null;

      if (fileObj) {
        try {
          filePath = await uploadDibujo(fileObj, pedidoId);
        } catch (err) {
          console.warn('Upload failed:', err);
          showToast('⚠️ No se pudo subir el archivo, el pedido se guardará sin imagen.');
        }
      }

      const pedido = {
        id:          pedidoId,
        userId:      currentUser.id,
        fecha:       new Date().toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
        montador:    currentUser.nombre,
        cantidad:    document.getElementById('cantidad').value,
        cristalFijo: document.getElementById('cristalFijo').value,
        notas:       document.getElementById('notas').value.trim(),
        referencia:  document.getElementById('referencia').value.trim(),
        ral:         document.getElementById('ral').value.trim(),
        filePath, fileName, fileType,
        estado:      'Pendiente',
      };

      await savePedido(pedido);
      showToast('✅ Pedido enviado correctamente');

      form.reset();
      document.getElementById('montador').textContent = currentUser.nombre;
      fileData = null; fileName = null; fileType = null; fileObj = null;
      filePreview.style.display = 'none'; uploadContent.style.display = '';
      previewImg.src = '';
      await renderMyOrders();
    } catch (err) {
      console.error('Submit error:', err);
      showToast('❌ Error al enviar: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Enviar Pedido';
    }
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    fileData = null; fileName = null; fileType = null; fileObj = null;
    filePreview.style.display = 'none'; uploadContent.style.display = '';
    previewImg.src = '';
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
    document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
    document.getElementById('montador').textContent = currentUser.nombre;
  });

  document.getElementById('modalClose').addEventListener('click', () =>
    document.getElementById('modalOverlay').style.display = 'none');
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay'))
      document.getElementById('modalOverlay').style.display = 'none';
  });

  document.getElementById('myFilterEstado').addEventListener('change', renderMyOrders);

  document.getElementById('misPedidosList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'ver') {
      const list = await getPedidos({ userId: currentUser.id });
      const p = list.find(p => p.id === id);
      if (p) openModal(p);
    }
  });

  async function renderMyOrders() {
    const listEl  = document.getElementById('misPedidosList');
    const estado  = document.getElementById('myFilterEstado').value;
    let pedidos   = await getPedidos({ userId: currentUser.id });

    document.getElementById('myCount').textContent = pedidos.length;
    if (estado) pedidos = pedidos.filter(p => p.estado === estado);

    if (pedidos.length === 0) {
      listEl.innerHTML = `<div class="empty-state" style="padding:32px 0">
        <span class="empty-icon" style="font-size:36px">📋</span>
        <p>${estado ? 'No hay pedidos con ese estado.' : 'Aún no has enviado pedidos.'}</p>
      </div>`;
      return;
    }

    listEl.innerHTML = pedidos.map(p => {
      let fileHtml = '';
      const imgUrl = p.filePath ? getPublicUrl(p.filePath) : null;
      if (imgUrl && p.fileType?.startsWith('image/'))
        fileHtml = `<img src="${imgUrl}" class="thumb-preview" alt="Dibujo" data-id="${p.id}" />`;
      else if (imgUrl)
        fileHtml = `<span class="has-file-icon" style="font-size:28px" data-id="${p.id}" title="${escHtml(p.fileName)}">📄</span>`;

      return `
      <div class="pedido-card estado-${escHtml(p.estado.replace(/ /g,'-'))}">
        <div class="pedido-info">
          <div class="pedido-top">
            <span class="pedido-id">#${p.id}</span>
            <span class="pedido-fecha">${p.fecha}</span>
          </div>
          <div class="medidas-row">
            <div class="medida-item"><span>Cant.: </span>${escHtml(p.cantidad)} pz</div>
            ${p.cristalFijo != null ? `<div class="medida-item"><span>Cristal fijo: </span>${escHtml(p.cristalFijo)}</div>` : ''}
          </div>
          <div class="pedido-meta">
            <span class="badge ${badgeClass(p.estado)}">${p.estado}</span>
            ${p.referencia ? `<span class="badge badge-gray">📎 ${escHtml(p.referencia)}</span>` : ''}
            ${p.ral ? `<span class="badge badge-gray">🎨 ${escHtml(p.ral)}</span>` : ''}
            ${fileHtml}
          </div>
          ${p.notas ? `<p style="margin-top:8px;font-size:13px;color:var(--text-dim)">📝 ${escHtml(p.notas)}</p>` : ''}
          ${p.notaAdmin ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(79,142,247,.08);border-left:3px solid #4f8ef7;border-radius:0 6px 6px 0;font-size:13px;color:#c5d0e8"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#4f8ef7;display:block;margin-bottom:2px">Nota del taller</span>${escHtml(p.notaAdmin)}</div>` : ''}
          ${renderMontadorStepper(p.estado)}
        </div>
        <div class="pedido-actions">
          <button class="icon-btn" data-action="ver" data-id="${p.id}" title="Ver detalle">🔍</button>
        </div>
      </div>`;
    }).join('');
  }

  // Realtime: actualiza el historial cuando el admin cambia estado o agrega nota
  subscribePedidos(() => renderMyOrders());

  renderMyOrders();
}
