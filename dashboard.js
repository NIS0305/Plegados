// ─── Auth + Nav ──────────────────────────────────────────────────────────────
let isAdminVerified = false;

(function () {
  const u = requireAdmin();
  if (!u) return;
  isAdminVerified = true;
  const area = document.getElementById('navUserArea');
  area.innerHTML = `
    <span class="nav-avatar">${u.nombre.charAt(0).toUpperCase()}</span>
    <span class="nav-username">${escHtml(u.nombre)}</span>
    <span class="badge badge-blue" style="font-size:11px">Admin</span>
    <button class="btn btn-secondary btn-sm" id="logoutBtn">Salir</button>`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
})();

const COLORS = {
  'Pendiente':            '#f59e0b',
  'En proceso':           '#3b82f6',
  'Completado':           '#10b981',
  'En taller':            '#6366f1',
  'Entregado a montador': '#0d9488',
  'Entregado a reparto':  '#059669',
};

const ESTADOS = ['Pendiente', 'Completado', 'En taller', 'Entregado a montador', 'Entregado a reparto'];

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  montador: '', estado: '',
  desde: '', hasta: '',
  chartFilter: { type: '', value: '' },
  sort: { col: 'id', dir: 'desc' },
  search: '',
};

let allPedidos = [];

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
  const total       = list.length;
  const pendiente   = list.filter(p => p.estado === 'Pendiente').length;
  const completado  = list.filter(p => p.estado === 'Completado').length;
  const enTaller    = list.filter(p => p.estado === 'En taller').length;
  const entMontador = list.filter(p => p.estado === 'Entregado a montador').length;
  const entCliente  = list.filter(p => p.estado === 'Entregado a reparto').length;

  document.getElementById('kpiTotalNum').textContent       = total;
  document.getElementById('kpiPendienteNum').textContent   = pendiente;
  document.getElementById('kpiCompletadoNum').textContent  = completado;
  document.getElementById('kpiTallerNum').textContent      = enTaller;
  document.getElementById('kpiEntMontadorNum').textContent = entMontador;
  document.getElementById('kpiEntClienteNum').textContent  = entCliente;
  document.getElementById('kpiPendientePct').textContent   = pct(pendiente,   total);
  document.getElementById('kpiCompletadoPct').textContent  = pct(completado,  total);
  document.getElementById('kpiTallerPct').textContent      = pct(enTaller,    total);
  document.getElementById('kpiEntMontadorPct').textContent = pct(entMontador, total);
  document.getElementById('kpiEntClientePct').textContent  = pct(entCliente,  total);
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
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.color = '#7a90b8';
  Chart.defaults.plugins.legend.display = false;

  charts.estado = new Chart(document.getElementById('chartEstado'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: '#111827', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { padding: 16, boxWidth: 12, color: '#7a90b8' } },
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
        data: [], borderColor: '#4f8ef7', backgroundColor: 'rgba(79,142,247,.1)',
        borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#4f8ef7',
        fill: true, tension: 0.4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} pedidos` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#7a90b8' } },
        y: { beginAtZero: true, ticks: { stepSize: 1, color: '#7a90b8' }, grid: { color: 'rgba(255,255,255,.05)' } },
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
  const sorted = sortList(list);
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
      <td><strong>${escHtml(p.montador)}</strong></td>
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
          <button class="icon-btn${p.notaAdmin ? ' nota-activa' : ''}" data-action="nota" data-id="${p.id}" title="${p.notaAdmin ? 'Editar nota' : 'Agregar nota'}" style="${p.notaAdmin ? 'color:#4f8ef7;border-color:#4f8ef7' : ''}">✏️</button>
          <button class="icon-btn del" data-action="del" data-id="${p.id}" title="Eliminar">🗑️</button>
        </div>
        ${p.notaAdmin ? `<div style="margin-top:5px;font-size:11px;color:#7a90b8;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.notaAdmin)}">📝 ${escHtml(p.notaAdmin)}</div>` : ''}
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
  allPedidos = await getPedidos();
  populateDropdowns();
  renderAll();
}

function renderAll() {
  const list = getFiltered();
  try { renderKPIs(list); }    catch(e) { console.error('renderKPIs:', e); }
  try { updateCharts(list); }  catch(e) { console.error('updateCharts:', e); }
  try { renderTable(list); }   catch(e) { console.error('renderTable:', e); }
  try { renderChips(); }       catch(e) { console.error('renderChips:', e); }
  try { updateSortHeaders(); } catch(e) { console.error('updateSortHeaders:', e); }
}

// ─── Events ──────────────────────────────────────────────────────────────────
if (!isAdminVerified) throw new Error('stop');

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

document.getElementById('clearAllBtn').addEventListener('click', async () => {
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
      : `<span class="badge badge-gray">Montador</span>`;
    return `<tr>
      <td><strong>${escHtml(u.nombre)}</strong></td>
      <td>${escHtml(u.email)}</td>
      <td>${rolBadge}</td>
      <td class="td-sm">${escHtml(u.creadoEl || '—')}</td>
      <td style="text-align:center">${count}</td>
      <td><button class="icon-btn del" data-action="del-user" data-id="${u.id}" title="Eliminar usuario">🗑️</button></td>
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

document.getElementById('usersTable').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="del-user"]');
  if (!btn) return;
  const id    = Number(btn.dataset.id);
  const users = await getDbUsers();
  const user  = users.find(u => u.id === id);
  if (!user || !confirm(`¿Eliminar al usuario "${user.nombre}"? Sus pedidos no se borrarán.`)) return;
  await deleteDbUser(id);
  showToast(`Usuario "${user.nombre}" eliminado`);
  renderUsers();
});

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

// ─── Init + Realtime ──────────────────────────────────────────────────────────
if (isAdminVerified) {
  initCharts();
  loadAndRender().then(() => renderUsers());

  subscribePedidos(async () => {
    allPedidos = await getPedidos();
    populateDropdowns();
    renderAll();
  });
}
