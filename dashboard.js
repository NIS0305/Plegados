// ─── Auth + Nav ──────────────────────────────────────────────────────────────
// isAdminVerified evita que renderAll() corra si el usuario no es admin
let isAdminVerified = false;

(function () {
  const u = requireAdmin();   // redirige si no es admin
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

// Chart.js se configura dentro de initCharts() para no bloquear el resto si falla

const COLORS = {
  'Pendiente':            '#f59e0b',
  'En proceso':           '#3b82f6',
  'Completado':           '#10b981',
  'En taller':            '#6366f1',
  'Entregado a montador': '#0d9488',
  'Entregado a reparto':  '#059669',
  multi: ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#f97316','#06b6d4','#84cc16','#ec4899','#14b8a6'],
};

const ESTADOS = ['Pendiente', 'Completado', 'En taller', 'Entregado a montador', 'Entregado a reparto'];

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  montador: '', estado: '', material: '',
  desde: '', hasta: '',
  chartFilter: { type: '', value: '' },
  sort: { col: 'id', dir: 'desc' },
  search: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseFecha(str) {
  if (!str) return new Date(0);
  // format: "19/04/2026, 14:35"
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
  let list = getPedidos();
  if (state.montador) list = list.filter(p => p.montador === state.montador);
  if (state.estado)   list = list.filter(p => p.estado   === state.estado);
  if (state.material) list = list.filter(p => p.material === state.material);
  if (state.desde)    list = list.filter(p => parseFecha(p.fecha) >= new Date(state.desde));
  if (state.hasta)    list = list.filter(p => parseFecha(p.fecha) <= new Date(state.hasta + 'T23:59:59'));
  if (state.chartFilter.value) {
    const { type, value } = state.chartFilter;
    if (type === 'estado')   list = list.filter(p => p.estado   === value);
    if (type === 'montador') list = list.filter(p => p.montador === value);
    if (type === 'material') list = list.filter(p => p.material === value);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(p =>
      (p.montador   || '').toLowerCase().includes(q) ||
      (p.referencia || '').toLowerCase().includes(q) ||
      (p.ral        || '').toLowerCase().includes(q) ||
      (p.material   || '').toLowerCase().includes(q) ||
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
  const enTaller   = list.filter(p => p.estado === 'En taller').length;
  const entMontador= list.filter(p => p.estado === 'Entregado a montador').length;
  const entCliente = list.filter(p => p.estado === 'Entregado a reparto').length;

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
    const v = p[key] || '—';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

function initCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.color = '#64748b';
  Chart.defaults.plugins.legend.display = false;

  // Donut - Estado
  charts.estado = new Chart(document.getElementById('chartEstado'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { padding: 16, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} pedidos` } },
      },
      onClick: (e, els) => {
        if (!els.length) { state.chartFilter = { type: '', value: '' }; renderAll(); return; }
        const label = charts.estado.data.labels[els[0].index];
        if (state.chartFilter.type === 'estado' && state.chartFilter.value === label) {
          state.chartFilter = { type: '', value: '' };
        } else {
          state.chartFilter = { type: 'estado', value: label };
        }
        renderAll();
      },
    },
  });

  // Horizontal bar - Montador
  charts.montador = new Chart(document.getElementById('chartMontador'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: COLORS.multi[0] + 'cc', borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} pedidos` } } },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f1f5f9' } },
        y: { grid: { display: false } },
      },
      onClick: (e, els) => {
        if (!els.length) { state.chartFilter = { type: '', value: '' }; renderAll(); return; }
        const label = charts.montador.data.labels[els[0].index];
        if (state.chartFilter.type === 'montador' && state.chartFilter.value === label) {
          state.chartFilter = { type: '', value: '' };
        } else {
          state.chartFilter = { type: 'montador', value: label };
        }
        renderAll();
      },
    },
  });

  // Bar - Material
  charts.material = new Chart(document.getElementById('chartMaterial'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} pedidos` } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f1f5f9' } },
      },
      onClick: (e, els) => {
        if (!els.length) { state.chartFilter = { type: '', value: '' }; renderAll(); return; }
        const label = charts.material.data.labels[els[0].index];
        if (state.chartFilter.type === 'material' && state.chartFilter.value === label) {
          state.chartFilter = { type: '', value: '' };
        } else {
          state.chartFilter = { type: 'material', value: label };
        }
        renderAll();
      },
    },
  });

  // Line - Timeline (last 30 days)
  charts.timeline = new Chart(document.getElementById('chartTimeline'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [], borderColor: '#3b82f6', backgroundColor: '#3b82f618',
        borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#3b82f6',
        fill: true, tension: 0.3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} pedidos` } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f1f5f9' } },
      },
    },
  });
}

function updateCharts(list) {
  if (!charts.estado) return;
  // Estado donut
  const byEstado = countBy(list, 'estado');
  const estadoLabels = ESTADOS.filter(k => byEstado[k] !== undefined);
  charts.estado.data.labels = estadoLabels;
  charts.estado.data.datasets[0].data = estadoLabels.map(k => byEstado[k] || 0);
  charts.estado.data.datasets[0].backgroundColor = estadoLabels.map(k => COLORS[k]);
  charts.estado.update();

  // Montador bar
  const byMontador = countBy(list, 'montador');
  const montadorEntries = Object.entries(byMontador).sort((a, b) => b[1] - a[1]).slice(0, 10);
  charts.montador.data.labels = montadorEntries.map(e => e[0]);
  charts.montador.data.datasets[0].data = montadorEntries.map(e => e[1]);
  charts.montador.data.datasets[0].backgroundColor = montadorEntries.map((_, i) => COLORS.multi[i % COLORS.multi.length] + 'cc');
  charts.montador.update();

  // Material bar
  const byMaterial = countBy(list, 'material');
  const matEntries = Object.entries(byMaterial).sort((a, b) => b[1] - a[1]);
  charts.material.data.labels = matEntries.map(e => e[0]);
  charts.material.data.datasets[0].data = matEntries.map(e => e[1]);
  charts.material.data.datasets[0].backgroundColor = matEntries.map((_, i) => COLORS.multi[i % COLORS.multi.length] + 'cc');
  charts.material.update();

  // Timeline - last 30 days
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const d30   = new Date(today); d30.setDate(d30.getDate() - 29); d30.setHours(0, 0, 0, 0);
  const days = [];
  for (let d = new Date(d30); d <= today; d.setDate(d.getDate() + 1))
    days.push(new Date(d));

  const byDay = {};
  days.forEach(d => { byDay[fmt(d)] = 0; });
  list.forEach(p => {
    const dt = parseFecha(p.fecha);
    if (dt >= d30 && dt <= today) {
      const key = fmt(dt);
      if (key in byDay) byDay[key]++;
    }
  });
  charts.timeline.data.labels = days.map(fmt);
  charts.timeline.data.datasets[0].data = days.map(d => byDay[fmt(d)]);
  charts.timeline.update();
}

// ─── Active filter chips ──────────────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('activeChips');
  const chips = [];
  if (state.montador)             chips.push({ label: `Montador: ${state.montador}`,   clear: () => { state.montador = ''; document.getElementById('fMontador').value = ''; } });
  if (state.estado)               chips.push({ label: `Estado: ${state.estado}`,       clear: () => { state.estado   = ''; document.getElementById('fEstado').value   = ''; } });
  if (state.material)             chips.push({ label: `Material: ${state.material}`,   clear: () => { state.material = ''; document.getElementById('fMaterial').value = ''; } });
  if (state.desde)                chips.push({ label: `Desde: ${state.desde}`,         clear: () => { state.desde    = ''; document.getElementById('fDesde').value    = ''; } });
  if (state.hasta)                chips.push({ label: `Hasta: ${state.hasta}`,         clear: () => { state.hasta    = ''; document.getElementById('fHasta').value    = ''; } });
  if (state.chartFilter.value)    chips.push({ label: `Gráfica: ${state.chartFilter.value}`, clear: () => { state.chartFilter = { type: '', value: '' }; } });

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
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted)">No hay pedidos con los filtros seleccionados</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(p => {
    let dibujoHtml = '—';
    if (p.fileData && p.fileType?.startsWith('image/'))
      dibujoHtml = `<img src="${p.fileData}" class="table-thumb" data-action="ver" data-id="${p.id}" title="Ver dibujo" />`;
    else if (p.fileData)
      dibujoHtml = `<span style="cursor:pointer;font-size:20px" data-action="ver" data-id="${p.id}" title="${escHtml(p.fileName)}">📄</span>`;

    return `<tr>
      <td class="td-id">#${p.id}</td>
      <td><strong>${escHtml(p.montador)}</strong></td>
      <td class="td-sm">${escHtml(p.fecha)}</td>
      <td class="td-medidas">
        <span class="mini-badge">${escHtml(p.largo)}×${escHtml(p.ancho)}×${escHtml(p.espesor)} mm</span>
        ${p.angulo ? `<span class="mini-badge">${escHtml(p.angulo)}°</span>` : ''}
      </td>
      <td>${escHtml(p.material) || '—'}</td>
      <td class="td-sm">${escHtml(p.referencia) || '—'}</td>
      <td class="td-sm">${escHtml(p.ral) || '—'}</td>
      <td style="text-align:center">${escHtml(p.cantidad)}</td>
      <td>
        <select class="estado-select-table" data-id="${p.id}">
          ${ESTADOS.map(s =>
            `<option value="${s}"${s === p.estado ? ' selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </td>
      <td style="text-align:center">${dibujoHtml}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" data-action="ver" data-id="${p.id}" title="Detalle">🔍</button>
          <button class="icon-btn del" data-action="del" data-id="${p.id}" title="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─── Dropdown population ─────────────────────────────────────────────────────
function populateDropdowns() {
  const all = getPedidos();
  const montadores = [...new Set(all.map(p => p.montador).filter(Boolean))].sort();
  const materiales = [...new Set(all.map(p => p.material).filter(Boolean))].sort();

  const fM = document.getElementById('fMontador');
  const cur = fM.value;
  fM.innerHTML = '<option value="">Todos</option>' + montadores.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  fM.value = cur;

  const fMat = document.getElementById('fMaterial');
  const curMat = fMat.value;
  fMat.innerHTML = '<option value="">Todos</option>' + materiales.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  fMat.value = curMat;
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
function renderAll() {
  const list = getFiltered();
  try { renderKPIs(list); } catch(e) { console.error('renderKPIs:', e); }
  try { updateCharts(list); } catch(e) { console.error('updateCharts:', e); }
  try { renderTable(list); } catch(e) { console.error('renderTable:', e); }
  try { renderChips(); } catch(e) { console.error('renderChips:', e); }
  try { updateSortHeaders(); } catch(e) { console.error('updateSortHeaders:', e); }
}

// ─── Event listeners (solo si es admin) ──────────────────────────────────────
if (!isAdminVerified) throw new Error('stop');
document.getElementById('fMontador').addEventListener('change', e => { state.montador = e.target.value; renderAll(); });
document.getElementById('fEstado').addEventListener('change',   e => { state.estado   = e.target.value; renderAll(); });
document.getElementById('fMaterial').addEventListener('change', e => { state.material = e.target.value; renderAll(); });
document.getElementById('fDesde').addEventListener('change',    e => { state.desde    = e.target.value; renderAll(); });
document.getElementById('fHasta').addEventListener('change',    e => { state.hasta    = e.target.value; renderAll(); });
document.getElementById('tableSearch').addEventListener('input', e => { state.search  = e.target.value; renderAll(); });

document.getElementById('refreshBtn').addEventListener('click', () => {
  populateDropdowns();
  renderAll();
  showToast('Dashboard actualizado');
});

document.getElementById('fReset').addEventListener('click', () => {
  state.montador = ''; state.estado = ''; state.material = '';
  state.desde = ''; state.hasta = ''; state.chartFilter = { type: '', value: '' }; state.search = '';
  ['fMontador','fEstado','fMaterial','fDesde','fHasta'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tableSearch').value = '';
  renderAll();
});

// Table events (delegation)
document.getElementById('ordersTable').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'ver') {
    const p = getPedidos().find(p => p.id === id);
    if (p) openModal(p);
  }
  if (btn.dataset.action === 'del') {
    if (!confirm('¿Eliminar este pedido?')) return;
    savePedidos(getPedidos().filter(p => p.id !== id));
    populateDropdowns();
    showToast('Pedido eliminado');
    renderAll();
  }
});

document.getElementById('ordersTable').addEventListener('change', e => {
  const sel = e.target.closest('.estado-select-table');
  if (!sel) return;
  const id = Number(sel.dataset.id);
  const list = getPedidos();
  const p = list.find(p => p.id === id);
  if (p) { p.estado = sel.value; savePedidos(list); showToast(`Estado: ${p.estado}`); renderAll(); }
});

// Sort headers
document.querySelectorAll('#ordersTable .sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sort.col === col) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.col = col; state.sort.dir = 'desc';
    }
    renderAll();
  });
});

// Modal
document.getElementById('modalClose').addEventListener('click', () =>
  document.getElementById('modalOverlay').style.display = 'none');
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay'))
    document.getElementById('modalOverlay').style.display = 'none';
});

// Clear all
document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('¿Borrar TODOS los pedidos? Esta acción no se puede deshacer.')) return;
  savePedidos([]);
  populateDropdowns();
  showToast('Todos los pedidos eliminados');
  renderAll();
});

// Export CSV
document.getElementById('exportCsv').addEventListener('click', () => {
  const list = sortList(getFiltered());
  const headers = ['ID','Montador','Fecha','Largo','Ancho','Espesor','Ángulo','Material','Cantidad','Referencia','RAL','Estado','Notas'];
  const rows = list.map(p => [
    p.id, p.montador, p.fecha, p.largo, p.ancho, p.espesor, p.angulo || '',
    p.material || '', p.cantidad, p.referencia || '', p.ral || '', p.estado, p.notas || '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `pedidos_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
if (isAdminVerified) {
  const u = getCurrentUser();
  const allPedidos = getPedidos();
  const diagBar = document.getElementById('diagBar');
  document.getElementById('diagCount').textContent = allPedidos.length;
  document.getElementById('diagUser').textContent  = u ? u.nombre : '(sin sesión)';
  document.getElementById('diagRole').textContent  = u ? u.role   : '—';
  if (allPedidos.length === 0) diagBar.style.display = 'block';

  populateDropdowns();
  initCharts();
  renderAll();

  // Auto-refresh cuando otra pestaña guarda pedidos
  window.addEventListener('storage', e => {
    if (e.key === 'pedidos') {
      populateDropdowns();
      renderAll();
    }
  });
}
