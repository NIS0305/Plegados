// ─── Nav + arranque ───────────────────────────────────────────────────────────
// La autenticación (requireStaff: admin o almacén) es ASÍNCRONA. El arranque real —render de la
// barra superior, carga de datos e init de gráficas— vive en la IIFE async del
// final del fichero. Aquí arriba solo quedan definiciones y listeners, que se
// pueden enganchar antes de resolver la sesión sin efecto hasta que el usuario
// interactúe (para entonces ya se resolvió el acceso o se redirigió).

// ─── Borrado desde el panel ──────────────────────────────────────────────────
// DESHABILITADO. Las políticas de seguridad a nivel de fila de la Parte 1.5
// (MIGRACION-SEGURIDAD.md) deniegan DELETE sobre `pedidos` y `users`. Con el
// borrado denegado en la base de datos, los botones del panel no deben mostrarse:
// PostgREST NO devuelve error cuando una política bloquea un DELETE (responde 204
// con cero filas), así que `if (error) throw` no saltaría y el panel diría
// "eliminado" mientras el dato sigue ahí. El flag en false retira los botones y
// evita esa promesa falsa.
//
// Secuencia de despliegue: primero este cambio (flag=false) en producción, y
// solo entonces aplicar el bloque SQL en la consola. Dar de baja un pedido o un
// usuario pasa a ser una operación manual en la base de datos (ver README.md).
//
// Para reactivar el borrado en el panel harían falta LAS DOS COSAS: poner este
// flag a true Y restaurar las políticas DELETE. Solo lo primero reproduce el
// fallo silencioso descrito arriba.
const BORRADO_HABILITADO = false;

const COLORS = {
  'Pendiente':            '#6E6E6D',
  'En proceso':           '#A3E635',
  'Completado':           '#2D7C02',
  'En taller':            '#5A9E1A',
  'Entregado a montador': '#B7B7B6',
  'Entregado a reparto':  '#3F5B2A',
};

const ESTADOS = ['Pendiente', 'Completado', 'En taller', 'Entregado a montador', 'Entregado a reparto'];

// Estado "finalizado": Completado o posterior. Es el mismo conjunto que usa el
// resto de la app (stepper de app.js) para dar un pedido por terminado.
function esFinalizado(estado) {
  return ['Completado', 'En taller', 'Entregado a montador', 'Entregado a reparto'].includes(estado);
}

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  montador: '', estado: '',
  desde: '', hasta: '',
  chartFilter: { type: '', value: '' },
  sort: { col: 'id', dir: 'desc' },
  search: '',
};

let allPedidos = [];
let allUsers   = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseFecha(str) {
  if (!str) return new Date(0);
  const [date, time = '00:00'] = str.split(', ');
  const [d, m, y] = date.split('/');
  return new Date(`${y}-${m}-${d}T${time}`);
}

function fmt(date) {
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

function pct(n, total) {
  return total ? Math.round((n / total) * 100) + '%' : '0%';
}

function getFiltered() {
  let list = allPedidos;
  if (state.montador) list = list.filter(p => p.montador === state.montador);
  if (state.estado)   list = list.filter(p => p.estado   === state.estado);
  if (state.desde)    list = list.filter(p => parseFecha(p.fecha) >= new Date(state.desde));
  if (state.hasta)    list = list.filter(p => parseFecha(p.fecha) <= new Date(state.hasta + 'T23:59:59'));
  if (state.chartFilter.value) {
    const { type, value } = state.chartFilter;
    if (type === 'estado')   list = list.filter(p => p.estado   === value);
    if (type === 'montador') list = list.filter(p => p.montador === value);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(p =>
      (p.montador   || '').toLowerCase().includes(q) ||
      (p.referencia || '').toLowerCase().includes(q) ||
      (p.ral        || '').toLowerCase().includes(q) ||
      String(p.id).includes(q)
    );
  }
  return list;
}

// ─── KPIs ────────────────────────────────────────────────────────────────────
function renderKPIs(list) {
  const total      = list.length;
  const pendiente  = list.filter(p => p.estado === 'Pendiente').length;
  const completado = list.filter(p => p.estado === 'Completado').length;

  document.getElementById('kpiTotalNum').textContent      = total;
  document.getElementById('kpiPendienteNum').textContent  = pendiente;
  document.getElementById('kpiCompletadoNum').textContent = completado;
  document.getElementById('kpiPendientePct').textContent  = pct(pendiente,  total);
  document.getElementById('kpiCompletadoPct').textContent = pct(completado, total);
}

// ─── Charts ──────────────────────────────────────────────────────────────────
let charts = {};

function countBy(list, key) {
  return list.reduce((acc, p) => {
    const v = p[key] || '—'; acc[v] = (acc[v] || 0) + 1; return acc;
  }, {});
}

function initCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = 'Inter, Barlow, system-ui, sans-serif';
  Chart.defaults.color = '#8f8f88';
  Chart.defaults.plugins.legend.display = false;

  charts.estado = new Chart(document.getElementById('chartEstado'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: '#1A1A18', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { padding: 16, boxWidth: 12, color: '#8f8f88' } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} pedidos` } },
      },
      onClick: (e, els) => {
        if (!els.length) { state.chartFilter = { type: '', value: '' }; renderAll(); return; }
        const label = charts.estado.data.labels[els[0].index];
        state.chartFilter = (state.chartFilter.type === 'estado' && state.chartFilter.value === label)
          ? { type: '', value: '' }
          : { type: 'estado', value: label };
        renderAll();
      },
    },
  });

  charts.timeline = new Chart(document.getElementById('chartTimeline'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [], borderColor: '#A3E635', backgroundColor: 'rgba(163,230,53,.10)',
        borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#A3E635',
        fill: true, tension: 0.4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} pedidos` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8f8f88' } },
        y: { beginAtZero: true, ticks: { stepSize: 1, color: '#8f8f88' }, grid: { color: 'rgba(255,255,255,.06)' } },
      },
    },
  });
}

function updateCharts(list) {
  if (!charts.estado) return;
  const byEstado     = countBy(list, 'estado');
  const estadoLabels = ESTADOS.filter(k => byEstado[k]);
  charts.estado.data.labels                        = estadoLabels;
  charts.estado.data.datasets[0].data              = estadoLabels.map(k => byEstado[k] || 0);
  charts.estado.data.datasets[0].backgroundColor   = estadoLabels.map(k => COLORS[k]);
  charts.estado.update();

  const today = new Date(); today.setHours(23, 59, 59, 999);
  const d30   = new Date(today); d30.setDate(d30.getDate() - 29); d30.setHours(0, 0, 0, 0);
  const days  = [];
  for (let d = new Date(d30); d <= today; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const byDay = {};
  days.forEach(d => { byDay[fmt(d)] = 0; });
  list.forEach(p => {
    const dt = parseFecha(p.fecha);
    if (dt >= d30 && dt <= today) { const k = fmt(dt); if (k in byDay) byDay[k]++; }
  });
  charts.timeline.data.labels              = days.map(fmt);
  charts.timeline.data.datasets[0].data   = days.map(d => byDay[fmt(d)]);
  charts.timeline.update();
}

// ─── Chips ───────────────────────────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('activeChips');
  const chips = [];
  if (state.montador)          chips.push({ label: `Montador: ${state.montador}`, clear: () => { state.montador = ''; document.getElementById('fMontador').value = ''; } });
  if (state.estado)            chips.push({ label: `Estado: ${state.estado}`,     clear: () => { state.estado   = ''; document.getElementById('fEstado').value   = ''; } });
  if (state.desde)             chips.push({ label: `Desde: ${state.desde}`,       clear: () => { state.desde    = ''; document.getElementById('fDesde').value    = ''; } });
  if (state.hasta)             chips.push({ label: `Hasta: ${state.hasta}`,       clear: () => { state.hasta    = ''; document.getElementById('fHasta').value    = ''; } });
  if (state.chartFilter.value) chips.push({ label: `Gráfica: ${state.chartFilter.value}`, clear: () => { state.chartFilter = { type: '', value: '' }; } });

  if (!chips.length) { container.innerHTML = ''; return; }
  container.innerHTML = chips.map((c, i) =>
    `<span class="filter-chip">${escHtml(c.label)} <button class="chip-x" data-i="${i}">×</button></span>`
  ).join('');
  container.querySelectorAll('.chip-x').forEach(btn => {
    btn.addEventListener('click', () => { chips[Number(btn.dataset.i)].clear(); renderAll(); });
  });
}

// ─── Table ────────────────────────────────────────────────────────────────────
function sortList(list) {
  const { col, dir } = state.sort;
  return [...list].sort((a, b) => {
    let va = a[col] ?? '', vb = b[col] ?? '';
    if (col === 'id' || col === 'cantidad') { va = Number(va); vb = Number(vb); }
    if (col === 'fecha') { va = parseFecha(va).getTime(); vb = parseFecha(vb).getTime(); }
    if (typeof va === 'string') va = va.toLowerCase(), vb = vb.toLowerCase();
    const r = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'asc' ? r : -r;
  });
}

function renderTable(list) {
  // Los pedidos de cuentas de almacén (p.ej. los de email) van a su propia
  // sección "Pedidos de almacén", no a la tabla de montadores.
  const almacenIds = new Set(allUsers.filter(u => u.role === 'almacen').map(u => u.id));
  const sorted = sortList(list.filter(p => !almacenIds.has(p.userId)));
  document.getElementById('tableCount').textContent = `${sorted.length} pedido${sorted.length !== 1 ? 's' : ''}`;
  const tbody = document.getElementById('tableBody');

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">No hay pedidos con los filtros seleccionados</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(p => {
    let dibujoHtml = '—';
    const imgUrl  = p.filePath ? getPublicUrl(p.filePath) : null;
    const isImage = p.fileType?.startsWith('image/') || /\.(jpg|jpeg|png|svg|webp)$/i.test(p.filePath || '');
    if (imgUrl && isImage)
      dibujoHtml = `<img src="${imgUrl}" class="table-thumb" data-action="ver" data-id="${p.id}" title="Ver dibujo" />`;
    else if (imgUrl)
      dibujoHtml = `<span style="cursor:pointer;font-size:20px" data-action="ver" data-id="${p.id}" title="${escHtml(p.fileName)}">📄</span>`;

    return `<tr>
      <td class="td-id">#${p.id}</td>
      <td><strong>${escHtml(p.montador)}</strong>${p.origen === 'email' ? ' <span class="badge badge-gray" style="font-size:10px" title="Pedido recibido por email">\u2709 Email</span>' : ''}</td>
      <td class="td-sm">${escHtml(p.fecha)}</td>
      <td class="td-sm">${escHtml(p.referencia) || '—'}</td>
      <td class="td-sm">${escHtml(p.ral) || '—'}</td>
      <td style="text-align:center">${escHtml(p.cantidad)}</td>
      <td>
        <select class="estado-select-table" data-id="${p.id}">
          ${ESTADOS.map(s => `<option value="${s}"${s === p.estado ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td style="text-align:center">${dibujoHtml}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" data-action="ver" data-id="${p.id}" title="Detalle">🔍</button>
          <button class="icon-btn${p.notaAdmin ? ' nota-activa' : ''}" data-action="nota" data-id="${p.id}" title="${p.notaAdmin ? 'Editar nota' : 'Agregar nota'}" style="${p.notaAdmin ? 'color:var(--lime);border-color:var(--lime)' : ''}">✏️</button>
          ${BORRADO_HABILITADO ? `<button class="icon-btn del" data-action="del" data-id="${p.id}" title="Eliminar">🗑️</button>` : ''}
        </div>
        ${p.notaAdmin ? `<div style="margin-top:5px;font-size:11px;color:var(--ash);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.notaAdmin)}">📝 ${escHtml(p.notaAdmin)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// ─── Dropdowns ───────────────────────────────────────────────────────────────
function populateDropdowns() {
  const montadores = [...new Set(allPedidos.map(p => p.montador).filter(Boolean))].sort();
  const fM  = document.getElementById('fMontador');
  const cur = fM.value;
  fM.innerHTML = '<option value="">Todos</option>' + montadores.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  fM.value = cur;
}

// ─── Sort headers ─────────────────────────────────────────────────────────────
function updateSortHeaders() {
  document.querySelectorAll('#ordersTable .sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === state.sort.col)
      th.classList.add(state.sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

// ─── Main render ─────────────────────────────────────────────────────────────
async function loadAndRender() {
  [allPedidos, allUsers] = await Promise.all([getPedidos(), getDbUsers()]);
  populateDropdowns();
  renderAll();
}

function renderAll() {
  const list = getFiltered();
  try { renderKPIs(list); }           catch(e) { console.error('renderKPIs:', e); }
  try { updateCharts(list); }         catch(e) { console.error('updateCharts:', e); }
  try { renderTable(list); }          catch(e) { console.error('renderTable:', e); }
  try { renderChips(); }              catch(e) { console.error('renderChips:', e); }
  try { updateSortHeaders(); }        catch(e) { console.error('updateSortHeaders:', e); }
  try { renderAlmacenSection(); }     catch(e) { console.error('renderAlmacenSection:', e); }
  try { renderAlmacenHistorial(); }   catch(e) { console.error('renderAlmacenHistorial:', e); }
  try { renderHistorial(); }          catch(e) { console.error('renderHistorial:', e); }
}

// ─── Events ──────────────────────────────────────────────────────────────────
document.getElementById('fMontador').addEventListener('change', e => { state.montador = e.target.value; renderAll(); });
document.getElementById('fEstado').addEventListener('change',   e => { state.estado   = e.target.value; renderAll(); });
document.getElementById('fDesde').addEventListener('change',    e => { state.desde    = e.target.value; renderAll(); });
document.getElementById('fHasta').addEventListener('change',    e => { state.hasta    = e.target.value; renderAll(); });
document.getElementById('tableSearch').addEventListener('input', e => { state.search  = e.target.value; renderAll(); });

document.getElementById('refreshBtn').addEventListener('click', async () => {
  await loadAndRender();
  showToast('Dashboard actualizado');
});

document.getElementById('fReset').addEventListener('click', () => {
  state.montador = ''; state.estado = ''; state.desde = ''; state.hasta = '';
  state.chartFilter = { type: '', value: '' }; state.search = '';
  ['fMontador','fEstado','fDesde','fHasta'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tableSearch').value = '';
  renderAll();
});

document.getElementById('ordersTable').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.dataset.action === 'nota') return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'ver') {
    const p = allPedidos.find(p => p.id === id);
    if (p) openModal(p);
  }
  if (btn.dataset.action === 'del') {
    if (!BORRADO_HABILITADO) return;   // ver BORRADO_HABILITADO al inicio del fichero
    if (!confirm('¿Eliminar este pedido?')) return;
    await deletePedido(id);
    allPedidos = allPedidos.filter(p => p.id !== id);
    populateDropdowns();
    showToast('Pedido eliminado');
    renderAll();
  }
});

document.getElementById('ordersTable').addEventListener('change', async e => {
  const sel = e.target.closest('.estado-select-table');
  if (!sel) return;
  const id = Number(sel.dataset.id);
  const p  = allPedidos.find(p => p.id === id);
  if (!p) return;
  p.estado = sel.value;
  await updatePedidoField(id, { estado: p.estado });
  showToast(`Estado: ${p.estado}`);
  renderAll();
});

document.querySelectorAll('#ordersTable .sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sort.col === col) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else { state.sort.col = col; state.sort.dir = 'desc'; }
    renderAll();
  });
});

document.getElementById('modalClose').addEventListener('click', () =>
  document.getElementById('modalOverlay').style.display = 'none');
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay'))
    document.getElementById('modalOverlay').style.display = 'none';
});

// El botón está oculto en el HTML (atributo `hidden`); solo se muestra si el
// borrado está habilitado. Ver BORRADO_HABILITADO al inicio del fichero.
if (BORRADO_HABILITADO) document.getElementById('clearAllBtn').hidden = false;

document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (!BORRADO_HABILITADO) return;
  if (!confirm('¿Borrar TODOS los pedidos? Esta acción no se puede deshacer.')) return;
  await deleteAllPedidos();
  allPedidos = [];
  populateDropdowns();
  showToast('Todos los pedidos eliminados');
  renderAll();
});

document.getElementById('exportCsv').addEventListener('click', () => {
  const list    = sortList(getFiltered());
  const headers = ['ID','Montador','Fecha','Cantidad','Cristal Fijo','Referencia','RAL','Estado','Notas','Nota Taller'];
  const rows    = list.map(p => [
    p.id, p.montador, p.fecha, p.cantidad, p.cristalFijo ?? '',
    p.referencia || '', p.ral || '', p.estado, p.notas || '', p.notaAdmin || '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `pedidos_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

// CSV de almacén: TODOS los pedidos de almacén (activos + historial). Mismo
// escapado de comillas y mismo BOM (\ufeff) que el de montadores, para que
// Excel respete los acentos.
document.getElementById('exportCsvAlmacen').addEventListener('click', (e) => {
  e.stopPropagation(); // el botón vive en la cabecera plegable: no abrir/cerrar la sección
  const list    = getAlmacenPedidos();
  const headers = ['ID','Solicitante','Fecha','Referencia','RAL','Cantidad','Estado','Origen','Notas','Nota Taller'];
  const rows    = list.map(p => [
    p.id, p.montador, p.fecha, p.referencia || '', p.ral || '', p.cantidad,
    p.estado, p.origen || '', p.notas || '', p.notaAdmin || '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `almacen_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

// ─── Almacén section ──────────────────────────────────────────────────────────
function getAlmacenPedidos() {
  const almacenIds = new Set(allUsers.filter(u => u.role === 'almacen').map(u => u.id));
  return allPedidos.filter(p => almacenIds.has(p.userId));
}

// Fila compartida por la tabla activa y por el historial: MISMO maquetado y
// MISMAS acciones (select de estado, ver, nota...), para que un pedido marcado
// por error como finalizado se pueda reabrir desde el historial cambiando el estado.
function filaAlmacen(p) {
  // Tarjeta del tablero POR HACER / FINALIZADOS. Mismo contrato que la fila
  // anterior: <select class="estado-select-table" data-id>, data-action="ver"
  // y data-action="nota" con data-id. Sin botón de borrado (RLS lo deniega).
  const fin      = esFinalizado(p.estado);
  const proc     = p.estado === 'En proceso';
  const accent   = fin ? 'done' : (proc ? '' : 'pend');
  const imgUrl   = p.filePath ? getPublicUrl(p.filePath) : null;
  const isImage  = p.fileType?.startsWith('image/') || /\.(jpg|jpeg|png|svg|webp)$/i.test(p.filePath || '');
  const plano    = imgUrl
    ? (isImage
        ? `<img src="${imgUrl}" class="table-thumb" data-action="ver" data-id="${p.id}" title="Ver plano" />`
        : `<button class="ico" data-action="ver" data-id="${p.id}" title="${escHtml(p.fileName)}">📄</button>`)
    : '';
  const origen   = p.origen === 'email'
    ? '<span class="tag email" title="Pedido recibido por email">Email</span>'
    : '<span class="tag mont">Almacén</span>';
  const ref      = p.referencia ? escHtml(p.referencia) : `#${p.id}`;
  const meta     = [escHtml(p.montador), p.ral ? escHtml(p.ral) : '', p.cantidad != null ? `${escHtml(p.cantidad)} ${Number(p.cantidad) === 1 ? 'pza' : 'pzas'}` : ''].filter(Boolean).join(' · ');
  return `<div class="card${fin ? ' done' : ''}" data-id="${p.id}">
    <div class="accentbar ${accent}"></div>
    <div class="body">
      <div class="c-l">
        <div class="c-ref cond">${ref}</div>
        <div class="c-meta">${origen} <span>${meta}</span></div>
        ${fin ? `<div class="done-when"><span class="tick">✓</span> ${escHtml(p.estado)} · ${escHtml(p.fecha)}</div>` : `<div class="c-meta"><span>${escHtml(p.fecha)}</span></div>`}
        ${p.notaAdmin ? `<div class="c-note"><b>Nota taller</b> ${escHtml(p.notaAdmin)}</div>` : ''}
      </div>
      <div class="c-r">
        <select class="estado-select-table" data-id="${p.id}" title="Cambiar estado">
          ${ESTADOS.map(s => `<option value="${s}"${s === p.estado ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <div class="acts">
          ${plano}
          <button class="ico" data-action="ver" data-id="${p.id}" title="Detalle">🔍</button>
          <button class="ico${p.notaAdmin ? ' key' : ''}" data-action="nota" data-id="${p.id}" title="${p.notaAdmin ? 'Editar nota' : 'Agregar nota'}">✏️</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderAlmacenTabla(bodyId, countId, pedidos, textoVacio) {
  const countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = `${pedidos.length} pedido${pedidos.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById(bodyId);
  if (!tbody) return;

  if (!pedidos.length) {
    tbody.innerHTML = `<div class="empty-state"><span class="empty-icon">—</span><p>${textoVacio}</p></div>`;
    return;
  }
  tbody.innerHTML = pedidos.map(filaAlmacen).join('');
}

// Lista ACTIVA de almacén: solo los NO finalizados. Al pasar a 'Completado' (o
// posterior) el pedido sale de aquí y entra en el historial.
function renderAlmacenSection() {
  renderAlmacenTabla('almacenBody', 'almacenCount',
    getAlmacenPedidos().filter(p => !esFinalizado(p.estado)),
    'No hay pedidos de almacén activos');
}

// HISTORIAL de almacén: los finalizados (Completado o posterior).
function renderAlmacenHistorial() {
  renderAlmacenTabla('almacenHistBody', 'almacenHistCount',
    getAlmacenPedidos().filter(p => esFinalizado(p.estado)),
    'Sin pedidos de almacén finalizados');
}

document.getElementById('almacenToggle').addEventListener('click', () => {
  const panel   = document.getElementById('almacenCollapsible');
  const chevron = document.getElementById('almacenChevron');
  const open    = panel.style.display === 'none';
  panel.style.display     = open ? '' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : '';
});

document.getElementById('almacenHistToggle').addEventListener('click', () => {
  const panel   = document.getElementById('almacenHistCollapsible');
  const chevron = document.getElementById('almacenHistChevron');
  const open    = panel.style.display === 'none';
  panel.style.display     = open ? '' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : '';
});

// Handlers compartidos por la tabla activa y el historial de almacén.
async function onAlmacenClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'ver') {
    const p = allPedidos.find(p => p.id === id);
    if (p) openModal(p);
  }
  if (btn.dataset.action === 'nota') openNoteModal(id);
  if (btn.dataset.action === 'del') {
    if (!confirm('¿Eliminar este pedido?')) return;
    await deletePedido(id);
    allPedidos = allPedidos.filter(p => p.id !== id);
    populateDropdowns();
    showToast('Pedido eliminado');
    renderAll();
  }
}

async function onAlmacenChange(e) {
  const sel = e.target.closest('.estado-select-table');
  if (!sel) return;
  const id = Number(sel.dataset.id);
  const p  = allPedidos.find(p => p.id === id);
  if (!p) return;
  p.estado = sel.value;
  await updatePedidoField(id, { estado: p.estado });
  showToast(`Estado: ${p.estado}`);
  renderAll();   // re-renderiza las DOS tablas de almacén (activa e historial)
}

['almacenTable', 'almacenHistTable'].forEach(id => {
  const t = document.getElementById(id);
  if (!t) return;
  t.addEventListener('click',  onAlmacenClick);
  t.addEventListener('change', onAlmacenChange);
});

// ─── Users ────────────────────────────────────────────────────────────────────
async function renderUsers() {
  const users = await getDbUsers();
  const tbody = document.getElementById('usersBody');
  document.getElementById('usersCount').textContent = `${users.length} usuario${users.length !== 1 ? 's' : ''}`;

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted)">No hay usuarios registrados</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => {
    const count    = allPedidos.filter(p => p.userId === u.id).length;
    const rolBadge = u.role === 'admin'
      ? `<span class="badge badge-blue">Admin</span>`
      : u.role === 'almacen'
      ? `<span class="badge badge-teal">Almacén</span>`
      : `<span class="badge badge-gray">Montador</span>`;
    return `<tr>
      <td><strong>${escHtml(u.nombre)}</strong></td>
      <td>${escHtml(u.email)}</td>
      <td>${rolBadge}</td>
      <td class="td-sm">${escHtml(u.creadoEl || '—')}</td>
      <td style="text-align:center">${count}</td>
      <td>${BORRADO_HABILITADO ? `<button class="icon-btn del" data-action="del-user" data-id="${u.id}" title="Eliminar usuario">🗑️</button>` : '<span class="td-sm" style="color:var(--text-muted)" title="Baja de usuarios: operación manual en base de datos (ver README.md)">—</span>'}</td>
    </tr>`;
  }).join('');
}

document.getElementById('usersToggle').addEventListener('click', () => {
  const panel   = document.getElementById('usersCollapsible');
  const chevron = document.getElementById('usersChevron');
  const open    = panel.style.display === 'none';
  panel.style.display     = open ? '' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : '';
});

// Baja de usuarios: se gestiona en Supabase Auth (consola / API de administración),
// no desde el panel. El botón de borrado de usuario no se renderiza
// (BORRADO_HABILITADO = false); esta baja dejó de existir en la app.

// ─── Note modal ───────────────────────────────────────────────────────────────
let noteTargetId = null;

function openNoteModal(id) {
  const p = allPedidos.find(p => p.id === id);
  if (!p) return;
  noteTargetId = id;
  document.getElementById('noteModalTitle').textContent = `Nota — Pedido #${id}`;
  document.getElementById('noteTextarea').value = p.notaAdmin || '';
  document.getElementById('noteModalOverlay').style.display = 'flex';
  document.getElementById('noteTextarea').focus();
}

function closeNoteModal() {
  document.getElementById('noteModalOverlay').style.display = 'none';
  noteTargetId = null;
}

document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
document.getElementById('noteModalCancel').addEventListener('click', closeNoteModal);
document.getElementById('noteModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('noteModalOverlay')) closeNoteModal();
});

document.getElementById('noteModalSave').addEventListener('click', async () => {
  if (!noteTargetId) return;
  const nota = document.getElementById('noteTextarea').value.trim();
  await updatePedidoField(noteTargetId, { notaAdmin: nota });
  const p = allPedidos.find(p => p.id === noteTargetId);
  if (p) p.notaAdmin = nota;
  closeNoteModal();
  renderAll();
  showToast('Nota guardada');
});

document.getElementById('noteTextarea').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('noteModalSave').click();
});

document.getElementById('ordersTable').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="nota"]');
  if (btn) openNoteModal(Number(btn.dataset.id));
}, true);

// ─── Arranque (auth async) + Realtime ─────────────────────────────────────────
(async () => {
  const u = await requireStaff();
  if (!u) return;   // requireStaff ya redirige si no hay sesión o no es admin/almacén

  const area = document.getElementById('navUserArea');
  area.innerHTML = `
    <span class="nav-username">${escHtml(u.nombre)}</span>
    <span class="nav-avatar cond">${u.nombre.charAt(0).toUpperCase()}</span>
    <span class="badge-role staff">${u.role === 'almacen' ? 'Almacén' : 'Admin'}</span>
    <button class="btn btn-secondary btn-sm" id="logoutBtn">Salir</button>`;
  document.getElementById('logoutBtn').addEventListener('click', logout);

  initCharts();
  await loadAndRender();
  renderUsers();

  subscribePedidos(async () => {
    allPedidos = await getPedidos();
    populateDropdowns();
    renderAll();
  });
})();

// ─── HISTORIAL (registro completo, filtrable y exportable) ───────────────────
// Registro de TODOS los pedidos (montadores + almacén) para sacar listados por
// periodo y facturar aparte. SIN precios. Filtros combinados (AND): rango de
// fechas (con atajos), montador, cliente/referencia y estado. Reutiliza
// parseFecha(), la semántica desde/hasta de getFiltered() y la técnica de CSV
// de #exportCsv / #exportCsvAlmacen. Se re-renderiza desde renderAll(), así que
// se mantiene al día con los filtros y con Realtime (subscribePedidos).
const histState = { desde: '', hasta: '', montador: '', cliente: '', estado: '' };

function histAlmacenIds() {
  return new Set(allUsers.filter(u => u.role === 'almacen').map(u => u.id));
}

function getHistorialFiltrado() {
  let list = allPedidos; // montadores + almacén, todo
  if (histState.montador) list = list.filter(p => p.montador === histState.montador);
  if (histState.estado)   list = list.filter(p => p.estado   === histState.estado);
  if (histState.desde)    list = list.filter(p => parseFecha(p.fecha) >= new Date(histState.desde));
  if (histState.hasta)    list = list.filter(p => parseFecha(p.fecha) <= new Date(histState.hasta + 'T23:59:59'));
  if (histState.cliente) {
    const q = histState.cliente.toLowerCase();
    // "Cliente" = solicitante/montador + referencia (el modelo no tiene campo cliente propio).
    list = list.filter(p =>
      (p.montador   || '').toLowerCase().includes(q) ||
      (p.referencia || '').toLowerCase().includes(q)
    );
  }
  // Más reciente primero.
  return list.slice().sort((a, b) => parseFecha(b.fecha) - parseFecha(a.fecha));
}

// Filas normalizadas para la tabla y el CSV (misma fuente, mismas columnas).
function histFila(p, almacenIds) {
  const esAlmacen = almacenIds.has(p.userId);
  const origen = p.origen === 'email' ? 'Email' : (esAlmacen ? 'Almacén' : 'Montador');
  return {
    id:         p.id,
    fecha:      p.fecha || '',
    referencia: p.referencia || '',
    cliente:    p.montador || '',                   // solicitante
    montador:   esAlmacen ? '' : (p.montador || ''),
    cantidad:   p.cantidad ?? '',
    estado:     p.estado || '',
    origen,
  };
}

// Desplegable de montadores: misma técnica que populateDropdowns(), sin tocarla.
function populateHistMontadores() {
  const sel = document.getElementById('histMontador');
  if (!sel) return;
  const montadores = [...new Set(allPedidos.map(p => p.montador).filter(Boolean))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + montadores.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  sel.value = cur;
}

function renderHistorial() {
  const tbody = document.getElementById('histBody');
  if (!tbody) return;
  populateHistMontadores();
  const almacenIds = histAlmacenIds();
  const list = getHistorialFiltrado();
  const countEl = document.getElementById('histCount');
  if (countEl) countEl.textContent = `${list.length} resultado${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">No hay pedidos con esos filtros</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(p => {
    const r = histFila(p, almacenIds);
    return `<tr>
      <td class="td-id">#${r.id}</td>
      <td class="td-sm">${escHtml(r.fecha)}</td>
      <td>${escHtml(r.referencia) || '—'}</td>
      <td><strong>${escHtml(r.cliente) || '—'}</strong></td>
      <td class="td-sm">${escHtml(r.montador) || '—'}</td>
      <td style="text-align:center">${escHtml(r.cantidad)}</td>
      <td><span class="badge ${badgeClass(r.estado)}">${escHtml(r.estado)}</span></td>
      <td class="td-sm">${escHtml(r.origen)}</td>
    </tr>`;
  }).join('');
}

// Fecha local en formato YYYY-MM-DD (lo que esperan los <input type="date">).
function histYmd(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function histSetRango(desde, hasta) {
  histState.desde = desde; histState.hasta = hasta;
  document.getElementById('histDesde').value = desde;
  document.getElementById('histHasta').value = hasta;
  renderHistorial();
}
const HIST_PRESETS = {
  histPresetHoy:       () => { const d = new Date(); histSetRango(histYmd(d), histYmd(d)); },
  histPreset7:         () => { const h = new Date(); const d = new Date(); d.setDate(h.getDate() - 6); histSetRango(histYmd(d), histYmd(h)); },
  histPresetMes:       () => { const h = new Date(); histSetRango(histYmd(new Date(h.getFullYear(), h.getMonth(), 1)), histYmd(h)); },
  histPresetMesPasado: () => { const h = new Date(); histSetRango(histYmd(new Date(h.getFullYear(), h.getMonth() - 1, 1)), histYmd(new Date(h.getFullYear(), h.getMonth(), 0))); },
  histPresetTodo:      () => {
    histState.montador = ''; histState.cliente = ''; histState.estado = '';
    document.getElementById('histMontador').value = '';
    document.getElementById('histCliente').value  = '';
    document.getElementById('histEstado').value   = '';
    histSetRango('', '');
  },
};
Object.entries(HIST_PRESETS).forEach(([id, fn]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', fn);
});
document.getElementById('histDesde').addEventListener('change',    e => { histState.desde    = e.target.value; renderHistorial(); });
document.getElementById('histHasta').addEventListener('change',    e => { histState.hasta    = e.target.value; renderHistorial(); });
document.getElementById('histMontador').addEventListener('change', e => { histState.montador = e.target.value; renderHistorial(); });
document.getElementById('histCliente').addEventListener('input',   e => { histState.cliente  = e.target.value.trim(); renderHistorial(); });
document.getElementById('histEstado').addEventListener('change',   e => { histState.estado   = e.target.value; renderHistorial(); });

// CSV del historial: EXACTAMENTE el conjunto filtrado, misma técnica (BOM +
// comillas dobladas + coma). Nombre con el rango si lo hay.
document.getElementById('exportCsvHistorial').addEventListener('click', () => {
  const almacenIds = histAlmacenIds();
  const list    = getHistorialFiltrado().map(p => histFila(p, almacenIds));
  const headers = ['ID','Fecha','Referencia','Cliente/Solicitante','Montador','Cantidad','Estado','Origen'];
  const rows    = list.map(r => [
    r.id, r.fecha, r.referencia, r.cliente, r.montador, r.cantidad, r.estado, r.origen,
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const rango = (histState.desde || histState.hasta)
    ? `${histState.desde || 'inicio'}_${histState.hasta || 'hoy'}`
    : new Date().toISOString().slice(0, 10);
  a.download = `historial_${rango}.csv`;
  a.click();
});
