'use strict';

// ─── Config ──────────────────────────────────────────────────────────────────
function getApiBase() {
  const loc = location;
  return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'
    ? `${loc.protocol}//${loc.hostname}:3000`
    : `${loc.protocol}//${loc.host}`;
}
const API_BASE = getApiBase();

// ─── State ───────────────────────────────────────────────────────────────────
let orders = [];
let currentPreset = 'today';
let revenueChart = null;
let paymentChart = null;
let itemsChart = null;

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

function isSingleDay(from, to) {
  return from.toDateString() === to.toDateString();
}

// ─── Fetch ───────────────────────────────────────────────────────────────────
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

async function fetchShopName() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (res.ok) {
      const settings = await res.json();
      const name = settings.shopName || 'BKT House';
      document.getElementById('shop-name').textContent = name;
      document.title = `Sales Dashboard — ${name}`;
    }
  } catch (e) { /* keep default */ }
}

// ─── Format helpers ──────────────────────────────────────────────────────────
const fmtRM   = n => `${typeof getCurrency === 'function' ? getCurrency() : 'RM'} ${n.toFixed(2)}`;
const fmtDate = ts => new Date(ts).toLocaleDateString('en-MY', { day: '2-digit', month: 'short' });
const fmtDateFull = ts => new Date(ts).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtHour = h => {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}${ampm}`;
};

// ─── Analytics ───────────────────────────────────────────────────────────────
const LANG_NAME_FIELDS = { en: 'name', zh: 'nameZh', th: 'nameTh', vi: 'nameVi', ms: 'nameMs', km: 'nameKm', id: 'nameId' };
function localName(item) {
  if (typeof getLang === 'function') {
    const field = LANG_NAME_FIELDS[getLang()];
    if (field && item[field]) return item[field];
  }
  return item.nameZh || item.name || '';
}

function calcKPIs(orders) {
  const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const orderCount = orders.length;
  const avgOrder = orderCount > 0 ? totalRevenue / orderCount : 0;

  // Top item by quantity
  const byItem = {};
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = localName(it);
      byItem[key] = (byItem[key] || 0) + (it.quantity || 1);
    });
  });
  const topItem = Object.entries(byItem).sort((a, b) => b[1] - a[1])[0];

  return { totalRevenue, orderCount, avgOrder, topItem: topItem ? topItem[0] : '—', topItemQty: topItem ? topItem[1] : 0 };
}

function calcDailyBreakdown(orders) {
  const byDay = {};
  orders.forEach(o => {
    const key = new Date(o.timestamp).toDateString();
    if (!byDay[key]) byDay[key] = { date: key, timestamp: o.timestamp, revenue: 0, count: 0 };
    byDay[key].revenue += o.total || 0;
    byDay[key].count++;
  });
  return Object.values(byDay).sort((a, b) => a.timestamp - b.timestamp);
}

function calcHourlyBreakdown(orders) {
  const byHour = {};
  for (let h = 0; h < 24; h++) byHour[h] = { hour: h, revenue: 0, count: 0 };
  orders.forEach(o => {
    const h = new Date(o.timestamp).getHours();
    byHour[h].revenue += o.total || 0;
    byHour[h].count++;
  });
  // Only return hours with data + surrounding context
  const hours = Object.values(byHour);
  const hasData = hours.filter(h => h.count > 0);
  if (hasData.length === 0) return hours.slice(8, 23); // default 8am-10pm
  const minH = Math.max(0, hasData[0].hour - 1);
  const maxH = Math.min(23, hasData[hasData.length - 1].hour + 1);
  return hours.slice(minH, maxH + 1);
}

function calcPaymentMix(orders) {
  const labels = { cash: _t('cash'), tng: 'TNG', duitnow: 'DuitNow', card: _t('credit_card') };
  const byMethod = {};
  let grandTotal = 0;
  orders.forEach(o => {
    const raw = (o.paymentMethod || 'cash').toLowerCase();
    const m = labels[raw] || raw;
    if (!byMethod[m]) byMethod[m] = { method: m, key: raw, total: 0, count: 0 };
    byMethod[m].total += o.total || 0;
    byMethod[m].count++;
    grandTotal += o.total || 0;
  });

  const methodOrder = ['Cash', 'TNG', 'DuitNow', 'Card'];
  const all = [...new Set([...methodOrder.filter(m => byMethod[m]), ...Object.keys(byMethod)])];
  return { methods: all.map(m => ({ ...byMethod[m], pct: grandTotal > 0 ? (byMethod[m].total / grandTotal) * 100 : 0 })), grandTotal };
}

function calcItemRankings(orders) {
  const byItem = {};
  let totalRev = 0;
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = localName(it);
      if (!byItem[key]) byItem[key] = { name: key, qty: 0, revenue: 0 };
      const qty = it.quantity || 1;
      const rev = it.subtotal || (it.unitPrice || 0) * qty;
      byItem[key].qty += qty;
      byItem[key].revenue += rev;
      totalRev += rev;
    });
  });
  const sorted = Object.values(byItem).sort((a, b) => b.qty - a.qty);
  return { items: sorted.slice(0, 10), totalRev };
}

// ─── Chart colors ────────────────────────────────────────────────────────────
const COLORS = {
  red: '#C0392B',
  green: '#27ae60',
  blue: '#3498db',
  purple: '#9b59b6',
  orange: '#e67e22',
  yellow: '#f1c40f',
  teal: '#1abc9c',
};

const PAYMENT_COLORS = {
  cash: COLORS.green,
  tng: COLORS.blue,
  duitnow: COLORS.purple,
  card: COLORS.orange,
};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#aaa', font: { size: 12 } } },
  },
};

// ─── Render KPIs ─────────────────────────────────────────────────────────────
function _t(key) { return typeof t === 'function' ? t(key) : key; }

function renderKPIs(kpis) {
  return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">${_t('revenue')}</div>
        <div class="kpi-value green">${fmtRM(kpis.totalRevenue)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${_t('orders')}</div>
        <div class="kpi-value">${kpis.orderCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${_t('avg_order')}</div>
        <div class="kpi-value">${fmtRM(kpis.avgOrder)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${_t('popular')}</div>
        <div class="kpi-value" style="font-size:16px;">${kpis.topItem} <span style="color:var(--muted);font-size:13px;">(${kpis.topItemQty})</span></div>
      </div>
    </div>`;
}

// ─── Render revenue chart ────────────────────────────────────────────────────
function renderRevenueChart(from, to) {
  const canvas = document.getElementById('revenue-chart');
  if (!canvas) return;
  if (revenueChart) { revenueChart.destroy(); revenueChart = null; }

  const singleDay = isSingleDay(from, to);
  let labels, data, countData;

  if (singleDay) {
    const hourly = calcHourlyBreakdown(orders);
    labels = hourly.map(h => fmtHour(h.hour));
    data = hourly.map(h => h.revenue);
    countData = hourly.map(h => h.count);
  } else {
    const daily = calcDailyBreakdown(orders);
    labels = daily.map(d => fmtDate(d.timestamp));
    data = daily.map(d => d.revenue);
    countData = daily.map(d => d.count);
  }

  revenueChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: _t('revenue'),
        data,
        backgroundColor: COLORS.red + 'cc',
        borderColor: COLORS.red,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => `Orders: ${countData[ctx.dataIndex]}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#aaa', font: { size: 11 } }, grid: { color: '#3a3a5533' } },
        y: { ticks: { color: '#aaa', callback: v => `${typeof getCurrency === 'function' ? getCurrency() : 'RM'} ${v}` }, grid: { color: '#3a3a5533' }, beginAtZero: true },
      },
    },
  });
}

// ─── Render payment chart ────────────────────────────────────────────────────
function renderPaymentChart() {
  const canvas = document.getElementById('payment-chart');
  if (!canvas) return;
  if (paymentChart) { paymentChart.destroy(); paymentChart = null; }

  const { methods, grandTotal } = calcPaymentMix(orders);
  if (methods.length === 0) return;

  paymentChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: methods.map(m => m.method),
      datasets: [{
        data: methods.map(m => m.total),
        backgroundColor: methods.map(m => PAYMENT_COLORS[m.key] || COLORS.orange),
        borderColor: '#2d2d44',
        borderWidth: 2,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '60%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { position: 'bottom', labels: { color: '#aaa', padding: 16, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const m = methods[ctx.dataIndex];
              return ` ${m.method}: ${fmtRM(m.total)} (${m.pct.toFixed(1)}%) · ${m.count} orders`;
            },
          },
        },
      },
    },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx, width, height } = chart;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmtRM(grandTotal), width / 2, height / 2 - 8);
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = '#aaaaaa';
        ctx.fillText(_t('total'), width / 2, height / 2 + 14);
        ctx.restore();
      },
    }],
  });
}

// ─── Render items chart ──────────────────────────────────────────────────────
function renderItemsChart() {
  const canvas = document.getElementById('items-chart');
  if (!canvas) return;
  if (itemsChart) { itemsChart.destroy(); itemsChart = null; }

  const { items } = calcItemRankings(orders);
  if (items.length === 0) return;

  itemsChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: items.map(it => it.name),
      datasets: [{
        label: 'Qty Sold',
        data: items.map(it => it.qty),
        backgroundColor: COLORS.orange + 'cc',
        borderColor: COLORS.orange,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => `Revenue: ${fmtRM(items[ctx.dataIndex].revenue)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#aaa' }, grid: { color: '#3a3a5533' }, beginAtZero: true },
        y: { ticks: { color: '#ddd', font: { size: 12 } }, grid: { display: false } },
      },
    },
  });
}

// ─── Render daily table ──────────────────────────────────────────────────────
function renderDailyTable() {
  const daily = calcDailyBreakdown(orders);
  if (daily.length === 0) return '';

  const rows = daily.map(d =>
    `<tr><td>${fmtDateFull(d.timestamp)}</td><td class="num">${d.count}</td><td class="num">${fmtRM(d.revenue)}</td><td class="num">${fmtRM(d.revenue / d.count)}</td></tr>`
  ).join('');

  const kpis = calcKPIs(orders);
  return `
    <table class="report-table">
      <thead><tr><th>${_t('date')}</th><th class="num">${_t('orders')}</th><th class="num">${_t('revenue')}</th><th class="num">${_t('avg_order')}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><strong>${_t('total')}</strong></td><td class="num"><strong>${kpis.orderCount}</strong></td><td class="num"><strong>${fmtRM(kpis.totalRevenue)}</strong></td><td class="num"><strong>${fmtRM(kpis.avgOrder)}</strong></td></tr></tfoot>
    </table>`;
}

// ─── Render full dashboard ───────────────────────────────────────────────────
function renderDashboard(from, to) {
  const container = document.getElementById('dashboard');
  const kpis = calcKPIs(orders);

  if (orders.length === 0) {
    container.innerHTML = `<div class="empty-state">${_t('no_orders_found')}</div>`;
    return;
  }

  const singleDay = isSingleDay(from, to);
  const chartTitle = singleDay ? `${_t('revenue')} / ${_t('time')}` : `${_t('revenue')} / ${_t('date')}`;

  container.innerHTML = `
    ${renderKPIs(kpis)}
    <div class="dash-grid-2">
      <div class="chart-card">
        <h3>${chartTitle}</h3>
        <div class="chart-wrap"><canvas id="revenue-chart"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>${_t('payment')}</h3>
        <div class="chart-wrap"><canvas id="payment-chart"></canvas></div>
      </div>
    </div>
    <div class="dash-grid-2">
      <div class="chart-card">
        <h3>${_t('item_sales')}</h3>
        <div class="chart-wrap-sm"><canvas id="items-chart"></canvas></div>
      </div>
      <div class="table-card">
        <h3>${_t('sales_detail')}</h3>
        ${renderDailyTable()}
      </div>
    </div>
  `;

  renderRevenueChart(from, to);
  renderPaymentChart();
  renderItemsChart();
}

// ─── Load data ───────────────────────────────────────────────────────────────
let currentFrom, currentTo;

async function loadData(from, to) {
  currentFrom = from;
  currentTo = to;
  document.getElementById('dashboard').innerHTML = '<div class="loading">Loading...</div>';
  orders = await fetchOrders(from, to);
  renderDashboard(from, to);
}

// ─── Date filter wiring ──────────────────────────────────────────────────────
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPreset = btn.dataset.preset;

    const customPanel = document.getElementById('custom-dates');
    if (currentPreset === 'custom') {
      customPanel.classList.remove('hidden');
      return;
    }
    customPanel.classList.add('hidden');
    const { from, to } = getDateRange(currentPreset);
    loadData(from, to);
  });
});

document.getElementById('apply-custom-btn').addEventListener('click', () => {
  const fromVal = document.getElementById('date-from').value;
  const toVal   = document.getElementById('date-to').value;
  if (!fromVal || !toVal) return;
  loadData(startOfDay(new Date(fromVal)), endOfDay(new Date(toVal)));
});

// ─── Logout ──────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
  clearSession();
  location.reload();
});

// ─── Auth gate & init ────────────────────────────────────────────────────────
(function init() {
  // Handle ?store= parameter to set tenant
  const urlStore = new URLSearchParams(location.search).get('store');
  if (urlStore) {
    const current = getTenantSession();
    if (!current || current.slug !== urlStore) {
      setTenantSession({ slug: urlStore, name: urlStore });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date-from').value = today;
  document.getElementById('date-to').value = today;

  const session = getSession();
  if (session && session.role === 'super') {
    document.getElementById('login-overlay').classList.add('hidden');
    fetchShopName();
    const { from, to } = getDateRange('today');
    loadData(from, to);
  } else {
    showLoginOverlay((session) => {
      if (session.role !== 'super') {
        alert('Dashboard access requires Admin role.');
        clearSession();
        location.reload();
        return;
      }
      fetchShopName();
      const { from, to } = getDateRange('today');
      loadData(from, to);
    });
  }
})();
