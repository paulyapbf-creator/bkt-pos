'use strict';

// ─── Config ──────────────────────────────────────────────────────────────────
function getApiBase() {
  const saved = localStorage.getItem('bkt_api_base');
  if (saved) return saved;
  const loc = location;
  return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'
    ? `${loc.protocol}//${loc.hostname}:3000`
    : `${loc.protocol}//${loc.host}`;
}
let API_BASE = getApiBase();

// ─── State ───────────────────────────────────────────────────────────────────
let orders = [];
let currentPreset = 'today';

// ─── Date helpers ────────────────────────────────────────────────────────────
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function getDateRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'week': {
      const mon = new Date(now);
      mon.setDate(mon.getDate() - mon.getDay() + (mon.getDay() === 0 ? -6 : 1));
      return { from: startOfDay(mon), to: endOfDay(now) };
    }
    case 'month':
      return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(now) };
    default:
      return { from: startOfDay(now), to: endOfDay(now) };
  }
}

// ─── Fetch data ──────────────────────────────────────────────────────────────
async function fetchOrders(from, to) {
  const params = new URLSearchParams();
  params.set('from', from.getTime());
  params.set('to', to.getTime());
  try {
    const res = await fetch(`${API_BASE}/api/history?${params}`);
    if (res.ok) return await res.json();
  } catch (e) { console.error('Failed to fetch history:', e); }
  return [];
}

// ─── Format helpers ──────────────────────────────────────────────────────────
const fmtRM   = n => `RM ${n.toFixed(2)}`;
const fmtPct  = n => `${n.toFixed(1)}%`;
const fmtDate = ts => new Date(ts).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = ts => new Date(ts).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtDateTime = ts => `${fmtDate(ts)} ${fmtTime(ts)}`;

// ─── Render: Sales Summary ──────────────────────────────────────────────────
function renderSummary() {
  const panel = document.getElementById('panel-summary');
  if (orders.length === 0) {
    panel.innerHTML = '<div class="empty-state">No orders in this period</div>';
    return;
  }

  const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const orderCount = orders.length;
  const avgOrder = totalRevenue / orderCount;

  // Daily breakdown
  const byDay = {};
  orders.forEach(o => {
    const key = fmtDate(o.timestamp);
    if (!byDay[key]) byDay[key] = { revenue: 0, count: 0 };
    byDay[key].revenue += o.total || 0;
    byDay[key].count++;
  });

  const dailyRows = Object.entries(byDay)
    .map(([date, d]) => `<tr><td>${date}</td><td class="num">${d.count}</td><td class="num">${fmtRM(d.revenue)}</td><td class="num">${fmtRM(d.revenue / d.count)}</td></tr>`)
    .join('');

  panel.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${fmtRM(totalRevenue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Orders</div><div class="kpi-value">${orderCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Order</div><div class="kpi-value">${fmtRM(avgOrder)}</div></div>
    </div>
    <table class="report-table">
      <thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">Avg</th></tr></thead>
      <tbody>${dailyRows}</tbody>
      <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${orderCount}</strong></td><td class="num"><strong>${fmtRM(totalRevenue)}</strong></td><td class="num"><strong>${fmtRM(avgOrder)}</strong></td></tr></tfoot>
    </table>
  `;
}

// ─── Render: Sales Detail ───────────────────────────────────────────────────
function renderDetail() {
  const panel = document.getElementById('panel-detail');
  if (orders.length === 0) {
    panel.innerHTML = '<div class="empty-state">No orders in this period</div>';
    return;
  }

  const sorted = [...orders].sort((a, b) => b.timestamp - a.timestamp);
  const cards = sorted.map(o => {
    const itemRows = (o.items || []).map(it => {
      const mods = it.modifiers && it.modifiers.length
        ? `<span class="detail-mods">(${it.modifiers.map(m => m.name || m).join(', ')})</span>` : '';
      return `<div class="detail-item-row">
        <span>${it.nameZh || it.name} ${mods}</span>
        <span class="num">×${it.quantity} &nbsp; ${fmtRM(it.subtotal || (it.unitPrice || it.price || 0) * (it.quantity || 1))}</span>
      </div>`;
    }).join('');

    return `<div class="detail-card">
      <div class="detail-header">
        <span class="detail-table">${o.table || '—'}</span>
        <span class="detail-time">${fmtDateTime(o.timestamp)}</span>
        <span class="detail-method badge-${(o.paymentMethod || 'cash').toLowerCase()}">${({cash:'Cash',tng:'TNG',duitnow:'DuitNow'})[( o.paymentMethod||'cash').toLowerCase()] || o.paymentMethod}</span>
        <span class="detail-total">${fmtRM(o.total || 0)}</span>
      </div>
      <div class="detail-items">${itemRows}</div>
    </div>`;
  }).join('');

  panel.innerHTML = cards;
}

// ─── Render: Collection Report ──────────────────────────────────────────────
function renderCollection() {
  const panel = document.getElementById('panel-collection');
  if (orders.length === 0) {
    panel.innerHTML = '<div class="empty-state">No orders in this period</div>';
    return;
  }

  const methodLabels = { cash: 'Cash', tng: 'TNG', duitnow: 'DuitNow' };
  const byMethod = {};
  let grandTotal = 0;
  orders.forEach(o => {
    const raw = (o.paymentMethod || 'cash').toLowerCase();
    const m = methodLabels[raw] || raw;
    if (!byMethod[m]) byMethod[m] = { total: 0, count: 0, key: raw };
    byMethod[m].total += o.total || 0;
    byMethod[m].count++;
    grandTotal += o.total || 0;
  });

  const methodOrder = ['Cash', 'TNG', 'DuitNow'];
  const allMethods = [...new Set([...methodOrder.filter(m => byMethod[m]), ...Object.keys(byMethod)])];

  const bars = allMethods.map(m => {
    const d = byMethod[m];
    const pct = grandTotal > 0 ? (d.total / grandTotal) * 100 : 0;
    return `<div class="collection-row">
      <div class="collection-label">
        <span class="badge-${d.key}">${m}</span>
        <span class="collection-count">${d.count} orders</span>
      </div>
      <div class="collection-bar-wrap">
        <div class="collection-bar" style="width:${pct}%"></div>
      </div>
      <div class="collection-values">
        <span class="collection-amount">${fmtRM(d.total)}</span>
        <span class="collection-pct">${fmtPct(pct)}</span>
      </div>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Collected</div><div class="kpi-value">${fmtRM(grandTotal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Orders</div><div class="kpi-value">${orders.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Payment Methods</div><div class="kpi-value">${allMethods.length}</div></div>
    </div>
    <div class="collection-list">${bars}</div>
  `;
}

// ─── Render: Item Sales ─────────────────────────────────────────────────────
function renderItems() {
  const panel = document.getElementById('panel-items');
  if (orders.length === 0) {
    panel.innerHTML = '<div class="empty-state">No orders in this period</div>';
    return;
  }

  const byItem = {};
  let totalQty = 0;
  let totalRev = 0;
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = it.name || it.nameZh || 'Unknown';
      if (!byItem[key]) byItem[key] = { name: key, nameZh: it.nameZh || '', qty: 0, revenue: 0 };
      const qty = it.quantity || 1;
      const rev = it.subtotal || (it.unitPrice || it.price || 0) * qty;
      byItem[key].qty += qty;
      byItem[key].revenue += rev;
      totalQty += qty;
      totalRev += rev;
    });
  });

  const sorted = Object.values(byItem).sort((a, b) => b.qty - a.qty);

  const rows = sorted.map((it, i) => {
    const pct = totalRev > 0 ? (it.revenue / totalRev) * 100 : 0;
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td>${it.nameZh || it.name}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${fmtRM(it.revenue)}</td>
      <td class="num">${fmtPct(pct)}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Unique Items</div><div class="kpi-value">${sorted.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Qty Sold</div><div class="kpi-value">${totalQty}</div></div>
      <div class="kpi-card"><div class="kpi-label">Item Revenue</div><div class="kpi-value">${fmtRM(totalRev)}</div></div>
    </div>
    <table class="report-table">
      <thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Share</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Tab & filter wiring ────────────────────────────────────────────────────
const renderers = { summary: renderSummary, detail: renderDetail, collection: renderCollection, items: renderItems };
let activeTab = 'summary';

function renderActiveTab() {
  renderers[activeTab]();
}

async function loadData(from, to) {
  orders = await fetchOrders(from, to);
  renderActiveTab();
}

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPreset = btn.dataset.preset;

    const customPanel = document.getElementById('custom-dates');
    if (currentPreset === 'custom') {
      customPanel.classList.remove('hidden');
      return; // wait for Apply
    }
    customPanel.classList.add('hidden');
    const { from, to } = getDateRange(currentPreset);
    loadData(from, to);
  });
});

// Custom date apply
document.getElementById('apply-custom-btn').addEventListener('click', () => {
  const fromVal = document.getElementById('date-from').value;
  const toVal   = document.getElementById('date-to').value;
  if (!fromVal || !toVal) return;
  loadData(startOfDay(new Date(fromVal)), endOfDay(new Date(toVal)));
});

// Tab buttons
document.querySelectorAll('.report-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.report-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    document.getElementById(`panel-${activeTab}`).classList.add('active');
    renderActiveTab();
  });
});

// ─── API config UI ───────────────────────────────────────────────────────────
const settingsBtn   = document.getElementById('settings-btn');
const apiConfigBar  = document.getElementById('api-config-bar');
const apiUrlInput   = document.getElementById('api-url-input');
const apiSaveBtn    = document.getElementById('api-save-btn');
const apiClearBtn   = document.getElementById('api-clear-btn');
const apiStatus     = document.getElementById('api-status');

// Show current saved URL
apiUrlInput.value = localStorage.getItem('bkt_api_base') || '';

settingsBtn.addEventListener('click', () => {
  const open = apiConfigBar.classList.toggle('hidden');
  settingsBtn.classList.toggle('active', !apiConfigBar.classList.contains('hidden'));
});

apiSaveBtn.addEventListener('click', () => {
  const url = apiUrlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  localStorage.setItem('bkt_api_base', url);
  API_BASE = url;
  apiStatus.textContent = '✓ Saved';
  setTimeout(() => { apiStatus.textContent = ''; }, 2000);
  // Reload data & shop name with new API
  fetchShopName();
  const { from, to } = getDateRange(currentPreset);
  loadData(from, to);
});

apiClearBtn.addEventListener('click', () => {
  localStorage.removeItem('bkt_api_base');
  apiUrlInput.value = '';
  API_BASE = getApiBase();
  apiStatus.textContent = '✓ Cleared';
  setTimeout(() => { apiStatus.textContent = ''; }, 2000);
  fetchShopName();
  const { from, to } = getDateRange(currentPreset);
  loadData(from, to);
});

// ─── Dynamic shop name ───────────────────────────────────────────────────────
async function fetchShopName() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (res.ok) {
      const settings = await res.json();
      const name = settings.shopName || 'BKT House';
      document.getElementById('shop-name').textContent = name;
      document.title = `Reports — ${name}`;
    }
  } catch (e) { /* keep default */ }
}

// ─── Init ────────────────────────────────────────────────────────────────────
(function init() {
  // Set default custom date inputs to today
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date-from').value = today;
  document.getElementById('date-to').value = today;

  fetchShopName();
  const { from, to } = getDateRange('today');
  loadData(from, to);
})();
