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
  document.getElementById('modalTitle').textContent = pedido.referencia ? `Pedido ${pedido.referencia}` : `Pedido #${pedido.id}`;

  const imgUrl  = pedido.filePath ? getPublicUrl(pedido.filePath) : (pedido.fileData || null);
  const isImage = pedido.fileType?.startsWith('image/') ||
                  /\.(jpg|jpeg|png|svg|webp)$/i.test(pedido.filePath || '');

  // Plano adjunto: imagen en la "hoja"; si es otro tipo, un enlace al archivo.
  const planoHtml = imgUrl && isImage
    ? `<img src="${imgUrl}" class="modal-img" alt="Dibujo" />`
    : imgUrl
      ? `<a href="${imgUrl}" target="_blank" rel="noopener" class="obtn">📄 ${escHtml(pedido.fileName || 'Abrir archivo')}</a>`
      : `<span class="no-plano">Sin plano adjunto</span>`;

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

  const origen = pedido.origen === 'email' ? '<span class="tag email">Email</span>' : '';
  const row = (k, v, long) => v == null || v === '' ? '' : `<div class="row${long ? ' long' : ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  body.innerHTML = `
    <div class="mgrid">
      <div class="plano">
        <div class="lab">Plano adjunto</div>
        <div class="sheet">${planoHtml}</div>
      </div>
      <div class="detail">
        ${row('Solicitante', `${escHtml(pedido.montador)} ${origen}`)}
        ${row('Fecha', escHtml(pedido.fecha))}
        ${row('Estado', `<span class="badge ${badgeClass(pedido.estado)}">${escHtml(pedido.estado)}</span>`)}
        ${row('Cantidad', `${escHtml(pedido.cantidad)} ${Number(pedido.cantidad) === 1 ? 'pieza' : 'piezas'}`)}
        ${pedido.cristalFijo != null ? row('Cristal fijo', escHtml(pedido.cristalFijo)) : ''}
        ${row('Referencia', escHtml(pedido.referencia))}
        ${row('Color RAL', escHtml(pedido.ral))}
        ${row('Notas', escHtml(pedido.notas), true)}
        ${pedido.notaAdmin ? `<div class="note"><div class="nl">Nota del taller</div><div class="nt">${escHtml(pedido.notaAdmin)}</div></div>` : ''}
        <div class="docs">
          ${pdfHtml}
          ${etiquetaHtml}
        </div>
      </div>
    </div>
    ${renderStepper(pedido.estado)}
  `;
  document.getElementById('modalOverlay').style.display = 'flex';
}

// ===== FORM PAGE =====
const form = document.getElementById('pedidoForm');
if (form) (async () => {
  const currentUser = await requireAuth();
  if (!currentUser) return;   // requireAuth ya redirige a login.html

  document.getElementById('navUsername').textContent = currentUser.nombre;
  document.getElementById('navAvatar').textContent   = currentUser.nombre.charAt(0).toUpperCase();
  document.getElementById('logoutBtn').addEventListener('click', logout);
  if (!['admin','almacen'].includes(currentUser.role)) {
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

    // Mismo conjunto de "finalizado" que usa el stepper del montador.
    const FIN = ['Completado', 'En taller', 'Entregado a montador', 'Entregado a reparto'];
    const mini = p => {
      const fin = FIN.includes(p.estado);
      const imgUrl = p.filePath ? getPublicUrl(p.filePath) : null;
      const fileHtml = imgUrl && p.fileType?.startsWith('image/')
        ? `<img src="${imgUrl}" class="thumb-preview" alt="Dibujo" data-action="ver" data-id="${p.id}" />`
        : imgUrl ? `<span class="has-file-icon" data-action="ver" data-id="${p.id}" title="${escHtml(p.fileName)}">📄</span>` : '';
      const meta = [`${escHtml(p.cantidad)} ${Number(p.cantidad) === 1 ? 'pza' : 'pzas'}`, p.ral ? escHtml(p.ral) : '', p.cristalFijo != null && Number(p.cristalFijo) > 0 ? `Cristal fijo ${escHtml(p.cristalFijo)}` : ''].filter(Boolean).join(' · ');
      const pill = fin ? 'done' : (p.estado === 'En proceso' ? 'proc' : 'pend');
      return `
      <div class="mini estado-${escHtml(p.estado.replace(/ /g,'-'))}">
        <div class="ml">
          <div class="mref cond${fin ? ' dim' : ''}">${p.referencia ? escHtml(p.referencia) : '#' + p.id}</div>
          <div class="mmeta">${fin ? '<span class="tick">✓</span> ' : ''}${meta}${fin ? ' · ' + escHtml(p.fecha) : ''}</div>
          ${p.notas ? `<div class="mini-note">${escHtml(p.notas)}</div>` : ''}
          ${p.notaAdmin ? `<div class="mini-note"><b>Nota taller</b> ${escHtml(p.notaAdmin)}</div>` : ''}
          ${fin ? '' : renderMontadorStepper(p.estado)}
        </div>
        <div class="mr pedido-actions">
          ${fileHtml}
          <span class="pill ${pill}">${escHtml(p.estado)}</span>
          <button class="ico" data-action="ver" data-id="${p.id}" title="Ver detalle">🔍</button>
        </div>
      </div>`;
    };
    const porHacer   = pedidos.filter(p => !FIN.includes(p.estado));
    const finalizados = pedidos.filter(p =>  FIN.includes(p.estado));
    listEl.innerHTML = `
      <div class="sub-head"><span class="t cond">Por hacer</span><span class="c">${porHacer.length}</span></div>
      ${porHacer.length ? porHacer.map(mini).join('') : '<div class="empty-state" style="padding:14px 0"><p>Nada pendiente.</p></div>'}
      <div class="divider"></div>
      <div class="sub-head"><span class="t cond dim">Finalizados</span><span class="c">${finalizados.length}</span></div>
      ${finalizados.length ? finalizados.map(mini).join('') : '<div class="empty-state" style="padding:14px 0"><p>Aún no hay pedidos finalizados.</p></div>'}
    `;
  }

  // Realtime: actualiza el historial cuando el admin cambia estado o agrega nota
  subscribePedidos(() => renderMyOrders());

  renderMyOrders();
})();


// ===== Generar etiqueta desde la app (llama al workflow de n8n) =====
// Disponible en cualquier pagina que abra el modal (formulario y dashboard).
// El webhook genera la MISMA etiqueta que Telegram, la guarda en Drive y en
// Supabase Storage, y rellena pedidos.etiqueta_path. Ver INTEGRACION-N8N.md.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#genEtiquetaBtn');
  if (!btn || btn.disabled) return;
  const id  = Number(btn.dataset.id);
  const ref = btn.dataset.ref || '';
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Generando…';
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
    showToast('✅ Etiqueta generada.');
  } catch (err) {
    console.error('generar etiqueta:', err);
    btn.disabled = false;
    btn.innerHTML = original;
    showToast(err.message === 'webhook-no-configurado'
      ? 'Falta configurar el webhook de n8n (N8N_ETIQUETA_WEBHOOK).'
      : 'No se pudo generar la etiqueta. Intentalo de nuevo.');
  }
});
