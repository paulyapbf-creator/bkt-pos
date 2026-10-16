'use strict';

// ─── Language helper ─────────────────────────────────────────────────────────
const _LANG_FIELDS = { en: 'name', zh: 'nameZh', th: 'nameTh', vi: 'nameVi', ms: 'nameMs', km: 'nameKm', id: 'nameId' };
function localName(it) {
  const lang = (typeof getLang === 'function' ? getLang() : null) || localStorage.getItem('bkt_lang') || 'en';
  const field = _LANG_FIELDS[lang];
  if (field && it[field]) return it[field];
  return it.name || it.nameZh || '';
}

// ─── Config ──────────────────────────────────────────────────────────────────
function getApiBase() {
  const saved = localStorage.getItem('bkt_api_base');
  if (saved) return saved;
  try {
    const s = JSON.parse(localStorage.getItem('bkt_settings') || '{}');
    if (s.serverUrl) return s.serverUrl;
  } catch(e) {}
  const loc = location;
  // In Capacitor WebView, hostname is 'localhost' — fall back to production server
  return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'
    ? 'https://rgtech.ai'
    : `${loc.protocol}//${loc.host}`;
}
let API_BASE = getApiBase();

// ─── State ───────────────────────────────────────────────────────────────────
let orders = [];
let currentPreset = 'today';
let catMap = {};  // category id → name, loaded at startup

async function loadCatMap() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (res.ok) {
      const s = await res.json();
      (s.categories || []).forEach(c => { catMap[c.id] = c.name; });
      return;
    }
  } catch (e) {}
  // Fallback: localStorage cache
  try {
    const s = JSON.parse(localStorage.getItem('bkt_settings') || '{}');
    (s.categories || []).forEach(c => { catMap[c.id] = c.name; });
  } catch (e) {}
}
loadCatMap();

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
const fmtRM   = n => `${typeof getCurrency === 'function' ? getCurrency() : 'RM'} ${n.toFixed(2)}`;
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

  const cur = typeof getCurrency === 'function' ? getCurrency() : 'RM';
  const activeOrders    = orders.filter(o => !o.cancelled);
  const cancelledOrders = orders.filter(o => o.cancelled);
  const totalRevenue = activeOrders.reduce((s, o) => s + (o.total || 0), 0);
  const orderCount = activeOrders.length;
  const avgOrder = orderCount > 0 ? totalRevenue / orderCount : 0;
  const cancelledTotal = cancelledOrders.reduce((s, o) => s + (o.total || 0), 0);

  // Daily breakdown (active only)
  const byDay = {};
  activeOrders.forEach(o => {
    const key = fmtDate(o.timestamp);
    if (!byDay[key]) byDay[key] = { revenue: 0, count: 0 };
    byDay[key].revenue += o.total || 0;
    byDay[key].count++;
  });

  const dailyRows = Object.entries(byDay)
    .map(([date, d]) => `<tr><td>${date}</td><td class="num">${d.count}</td><td class="num">${d.revenue.toFixed(2)}</td><td class="num">${(d.revenue / d.count).toFixed(2)}</td></tr>`)
    .join('');

  // Items sold summary (active only)
  const byItem = {};
  let totalItemQty = 0;
  activeOrders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = (it.name || it.nameZh || 'Unknown') + '|' + (it.category || '');
      if (!byItem[key]) byItem[key] = { name: it.name || it.nameZh || 'Unknown', nameZh: it.nameZh || '', category: catMap[it.category] || it.category || '—', qty: 0, revenue: 0 };
      const qty = it.quantity || 1;
      const rev = it.subtotal || (it.unitPrice || it.price || 0) * qty;
      byItem[key].qty += qty;
      byItem[key].revenue += rev;
      totalItemQty += qty;
    });
  });

  const itemsSorted = Object.values(byItem).sort((a, b) => b.qty - a.qty);
  const itemRows = itemsSorted.map((it, i) => {
    const pct = totalRevenue > 0 ? (it.revenue / totalRevenue) * 100 : 0;
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td>${localName(it)}</td>
      <td style="color:var(--muted);font-size:12px;">${it.category}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${it.revenue.toFixed(2)}</td>
      <td class="num" style="color:var(--muted);font-size:12px;">${pct.toFixed(1)}%</td>
    </tr>`;
  }).join('');

  // Cancelled bills section
  const cancelledSection = cancelledOrders.length === 0 ? '' : `
    <div class="report-section-label cancelled-label">Cancelled Bills (${cancelledOrders.length})</div>
    <table class="report-table" style="margin-bottom:24px;">
      <thead><tr><th>Date &amp; Time</th><th>Table</th><th class="num">Amount (${cur})</th></tr></thead>
      <tbody>${cancelledOrders.map(o => `<tr class="cancelled-row">
        <td>${fmtDateTime(o.timestamp)}</td>
        <td>${o.table || '—'}</td>
        <td class="num" style="text-decoration:line-through;">${(o.total||0).toFixed(2)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2"><strong>Total Voided</strong></td><td class="num"><strong>${cancelledTotal.toFixed(2)}</strong></td></tr></tfoot>
    </table>`;

  panel.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${fmtRM(totalRevenue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Orders</div><div class="kpi-value">${orderCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Order</div><div class="kpi-value">${fmtRM(avgOrder)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Items Sold</div><div class="kpi-value">${totalItemQty}</div></div>
      ${cancelledOrders.length > 0 ? `<div class="kpi-card kpi-cancelled"><div class="kpi-label">Cancelled</div><div class="kpi-value">${cancelledOrders.length} (${fmtRM(cancelledTotal)})</div></div>` : ''}
    </div>

    <div class="report-section-label">Daily Breakdown</div>
    <table class="report-table" style="margin-bottom:24px;">
      <thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Revenue (${cur})</th><th class="num">Avg (${cur})</th></tr></thead>
      <tbody>${dailyRows}</tbody>
      <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${orderCount}</strong></td><td class="num"><strong>${totalRevenue.toFixed(2)}</strong></td><td class="num"><strong>${orderCount > 0 ? avgOrder.toFixed(2) : '0.00'}</strong></td></tr></tfoot>
    </table>

    <div class="report-section-label">Items Sold Summary</div>
    <div style="overflow-x:auto;">
      <table class="report-table" style="margin-bottom:24px;">
        <thead><tr><th>#</th><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Revenue (${cur})</th><th class="num">Share</th></tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr>
          <td colspan="3"><strong>Total</strong></td>
          <td class="num"><strong>${totalItemQty}</strong></td>
          <td class="num"><strong>${totalRevenue.toFixed(2)}</strong></td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
    ${cancelledSection}
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
    const isCancelled = !!o.cancelled;
    const itemRows = (o.items || []).map(it => {
      const mods = it.modifiers && it.modifiers.length
        ? `<span class="detail-mods">(${it.modifiers.map(m => m.name || m).join(', ')})</span>` : '';
      return `<div class="detail-item-row">
        <span>${localName(it)} ${mods}</span>
        <span class="num">×${it.quantity} &nbsp; ${fmtRM(it.subtotal || (it.unitPrice || it.price || 0) * (it.quantity || 1))}</span>
      </div>`;
    }).join('');

    return `<div class="detail-card${isCancelled ? ' detail-card-cancelled' : ''}">
      <div class="detail-header">
        <span class="detail-table">${o.table || '—'}</span>
        <span class="detail-time">${fmtDateTime(o.timestamp)}</span>
        ${isCancelled
          ? `<span class="badge-cancelled">CANCELLED</span>`
          : `<span class="detail-method badge-${(o.paymentMethod || 'cash').toLowerCase()}">${({cash:'Cash',tng:'TNG',duitnow:'DuitNow'})[(o.paymentMethod||'cash').toLowerCase()] || o.paymentMethod}</span>`}
        <span class="detail-total" style="${isCancelled ? 'text-decoration:line-through;color:var(--muted);' : ''}">${fmtRM(o.total || 0)}</span>
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

  const activeOrders    = orders.filter(o => !o.cancelled);
  const cancelledOrders = orders.filter(o => o.cancelled);
  const cancelledTotal  = cancelledOrders.reduce((s, o) => s + (o.total || 0), 0);
  const methodLabels = { cash: 'Cash', tng: 'TNG', duitnow: 'DuitNow' };
  const byMethod = {};
  let grandTotal = 0;
  activeOrders.forEach(o => {
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
      <div class="kpi-card"><div class="kpi-label">Total Orders</div><div class="kpi-value">${activeOrders.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Payment Methods</div><div class="kpi-value">${allMethods.length}</div></div>
      ${cancelledOrders.length > 0 ? `<div class="kpi-card kpi-cancelled"><div class="kpi-label">Cancelled</div><div class="kpi-value">${cancelledOrders.length} (${fmtRM(cancelledTotal)})</div></div>` : ''}
    </div>
    <div class="collection-list">${bars}</div>
  `;
}

// ─── Render: Item Master ─────────────────────────────────────────────────────
async function renderItemMaster() {
  const panel = document.getElementById('panel-itemmaster');
  panel.innerHTML = '<div class="empty-state">Loading…</div>';

  let items = [], catMap = {};
  try {
    const [menuRes, settingsRes] = await Promise.all([
      fetch(`${API_BASE}/api/menu`),
      fetch(`${API_BASE}/api/settings`)
    ]);
    if (menuRes.ok) items = await menuRes.json();
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      (s.categories || []).forEach(c => { catMap[c.id] = c.name; });
    }
  } catch (e) { /* ignore */ }

  // Fallback: read from localStorage cache
  if (!Object.keys(catMap).length) {
    try {
      const s = JSON.parse(localStorage.getItem('bkt_settings') || '{}');
      (s.categories || []).forEach(c => { catMap[c.id] = c.name; });
    } catch (e) {}
  }

  if (!items.length) {
    panel.innerHTML = '<div class="empty-state">No menu items found</div>';
    return;
  }

  const catName = id => catMap[id] || id || '—';
  const cur = typeof getCurrency === 'function' ? getCurrency() : 'RM';
  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];

  const rows = items.map((it, i) => `<tr>
    <td class="rank">${i + 1}</td>
    <td>${it.name || ''}</td>
    <td>${it.nameZh || ''}</td>
    <td>${catName(it.category)}</td>
    <td class="num">${(it.price || 0).toFixed(2)}</td>
    <td class="num">${it.deliveryPrice != null ? it.deliveryPrice.toFixed(2) : '—'}</td>
    <td class="num">${it.promoPrice != null ? it.promoPrice.toFixed(2) : '—'}</td>
    <td class="num">${it.promoEnabled ? '✓' : '—'}</td>
    <td class="num">${it.isAvailable !== false ? '✓' : '—'}</td>
    <td class="num">${it.isPopular ? '✓' : '—'}</td>
    <td class="num">${it.freeAddonCount || 0}</td>
  </tr>`).join('');

  panel.innerHTML = `
    <div style="display:flex;align-items:stretch;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="kpi-card" style="flex:1;min-width:120px;"><div class="kpi-label">Total Items</div><div class="kpi-value">${items.length}</div></div>
      <div class="kpi-card" style="flex:1;min-width:120px;"><div class="kpi-label">Available</div><div class="kpi-value">${items.filter(i => i.isAvailable !== false).length}</div></div>
      <div class="kpi-card" style="flex:1;min-width:120px;"><div class="kpi-label">Categories</div><div class="kpi-value">${categories.length}</div></div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button id="export-itemmaster-btn" class="export-btn">⬇ Export Excel</button>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table class="report-table">
        <thead><tr>
          <th>#</th><th>Name (EN)</th><th>Name (ZH)</th><th>Category</th>
          <th class="num">Price (${cur})</th><th class="num">Del. Price (${cur})</th><th class="num">Promo Price (${cur})</th>
          <th class="num">Promo</th><th class="num">Available</th><th class="num">Popular</th><th class="num">Free Addons</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  document.getElementById('export-itemmaster-btn').addEventListener('click', () => exportItemMasterCsv(items));
}

function exportItemMasterCsv(items) {
  const cur = typeof getCurrency === 'function' ? getCurrency() : 'RM';
  const headers = [
    '#', 'Name (EN)', 'Name (ZH)', 'Category',
    `Price (${cur})`, `Delivery Price (${cur})`, `Promo Price (${cur})`,
    'Promo Enabled', 'Available', 'Popular', 'Free Addons',
    'Description', 'Description (ZH)',
  ];
  const dataRows = items.map((it, i) => [
    i + 1,
    it.name || '',
    it.nameZh || '',
    it.category || '',
    (it.price || 0).toFixed(2),
    it.deliveryPrice != null ? it.deliveryPrice.toFixed(2) : '',
    it.promoPrice != null ? it.promoPrice.toFixed(2) : '',
    it.promoEnabled ? 'Yes' : 'No',
    it.isAvailable !== false ? 'Yes' : 'No',
    it.isPopular ? 'Yes' : 'No',
    it.freeAddonCount || 0,
    it.description || '',
    it.descriptionZh || '',
  ]);

  const csv = [headers, ...dataRows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const bom = '\uFEFF'; // UTF-8 BOM so Excel reads Chinese correctly
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `item-master-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Render: Table Report ────────────────────────────────────────────────────
function renderTableReport() {
  const panel = document.getElementById('panel-table');
  if (orders.length === 0) {
    panel.innerHTML = '<div class="empty-state">No orders in this period</div>';
    return;
  }

  const cur = typeof getCurrency === 'function' ? getCurrency() : 'RM';
  const activeOrders    = orders.filter(o => !o.cancelled);
  const cancelledOrders = orders.filter(o => o.cancelled);
  const cancelledTotal  = cancelledOrders.reduce((s, o) => s + (o.total || 0), 0);
  const byTable = {};
  let grandTotal = 0;
  activeOrders.forEach(o => {
    const t = o.table || '—';
    if (!byTable[t]) byTable[t] = { orders: 0, revenue: 0, items: 0 };
    byTable[t].orders++;
    byTable[t].revenue += o.total || 0;
    byTable[t].items += (o.items || []).reduce((s, it) => s + (it.quantity || 1), 0);
    grandTotal += o.total || 0;
  });

  // Natural-sort tables: T1, T2 … T10 before T11, then alphabetical for rest
  const sorted = Object.entries(byTable).sort(([a], [b]) => {
    const na = parseInt(a.replace(/\D/g, ''), 10), nb = parseInt(b.replace(/\D/g, ''), 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  // Build per-table cancelled map
  const cancelledByTable = {};
  cancelledOrders.forEach(o => {
    const t = o.table || '—';
    if (!cancelledByTable[t]) cancelledByTable[t] = { count: 0, total: 0 };
    cancelledByTable[t].count++;
    cancelledByTable[t].total += o.total || 0;
  });

  // Merge all tables (active + cancelled-only tables)
  const allTables = new Set([...Object.keys(byTable), ...Object.keys(cancelledByTable)]);
  const allSorted = [...allTables].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10), nb = parseInt(b.replace(/\D/g, ''), 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const hasCancelled = cancelledOrders.length > 0;
  const rows = allSorted.map(table => {
    const d  = byTable[table]  || { orders: 0, revenue: 0, items: 0 };
    const cd = cancelledByTable[table] || null;
    const avg  = d.orders > 0 ? d.revenue / d.orders : 0;
    const pct  = grandTotal > 0 ? (d.revenue / grandTotal) * 100 : 0;
    const barW = Math.max(2, pct);
    return `<tr>
      <td><span class="detail-table">${table}</span></td>
      <td class="num">${d.orders || '—'}</td>
      <td class="num">${d.items || '—'}</td>
      <td class="num">${d.orders > 0 ? d.revenue.toFixed(2) : '—'}</td>
      <td class="num">${d.orders > 0 ? avg.toFixed(2) : '—'}</td>
      <td>
        ${d.orders > 0 ? `<div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;background:var(--header);border-radius:3px;height:12px;overflow:hidden;">
            <div style="width:${barW}%;height:100%;background:var(--red);border-radius:3px;min-width:2px;transition:width 0.3s;"></div>
          </div>
          <span style="width:42px;text-align:right;font-size:12px;color:var(--muted);">${pct.toFixed(1)}%</span>
        </div>` : ''}
      </td>
      ${hasCancelled ? `<td class="num" style="color:#e57373;">${cd ? `${cd.count} (<span style="text-decoration:line-through">${cd.total.toFixed(2)}</span>)` : '—'}</td>` : ''}
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${fmtRM(grandTotal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Orders</div><div class="kpi-value">${activeOrders.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tables Active</div><div class="kpi-value">${sorted.length}</div></div>
      ${cancelledOrders.length > 0 ? `<div class="kpi-card kpi-cancelled"><div class="kpi-label">Cancelled</div><div class="kpi-value">${cancelledOrders.length} (${fmtRM(cancelledTotal)})</div></div>` : ''}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
      <button id="export-table-btn" class="export-btn">⬇ Export CSV</button>
    </div>
    <div style="overflow-x:auto;">
      <table class="report-table">
        <thead><tr>
          <th>Table</th>
          <th class="num">Orders</th>
          <th class="num">Items Sold</th>
          <th class="num">Revenue (${cur})</th>
          <th class="num">Avg Order (${cur})</th>
          <th>Share</th>
          ${hasCancelled ? `<th class="num" style="color:#e57373;">Cancelled (Voided ${cur})</th>` : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td><strong>Total</strong></td>
          <td class="num"><strong>${activeOrders.length}</strong></td>
          <td class="num"><strong>${Object.values(byTable).reduce((s,d)=>s+d.items,0)}</strong></td>
          <td class="num"><strong>${grandTotal.toFixed(2)}</strong></td>
          <td class="num"><strong>${activeOrders.length > 0 ? (grandTotal / activeOrders.length).toFixed(2) : '0.00'}</strong></td>
          <td></td>
          ${hasCancelled ? `<td class="num" style="color:#e57373;"><strong>${cancelledOrders.length} (<span style="text-decoration:line-through">${cancelledTotal.toFixed(2)}</span>)</strong></td>` : ''}
        </tr></tfoot>
      </table>
    </div>
  `;

  document.getElementById('export-table-btn').addEventListener('click', () => {
    const headers = ['Table', 'Orders', 'Items Sold', 'Revenue', 'Avg Order', 'Share %'];
    const dataRows = sorted.map(([table, d]) => [
      table,
      d.orders,
      d.items,
      d.revenue.toFixed(2),
      (d.revenue / d.orders).toFixed(2),
      grandTotal > 0 ? ((d.revenue / grandTotal) * 100).toFixed(1) : '0.0',
    ]);
    const csv = [headers, ...dataRows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// ─── Tab & filter wiring ────────────────────────────────────────────────────
const renderers = { summary: renderSummary, detail: renderDetail, collection: renderCollection, table: renderTableReport, itemmaster: renderItemMaster };
let activeTab = 'summary';

function renderActiveTab() {
  renderers[activeTab]();
}

async function loadData(from, to) {
  if (!Object.keys(catMap).length) await loadCatMap();
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
    // Hide date filter for tabs that don't use date ranges
    const filterBar = document.getElementById('report-filter-bar');
    if (filterBar) filterBar.style.display = activeTab === 'itemmaster' ? 'none' : '';
    renderActiveTab();
  });
});

// Print button
document.getElementById('print-btn').addEventListener('click', () => {
  if (window.AndroidPrint?.printPage) {
    window.AndroidPrint.printPage('Sales Report');
  } else {
    window.print();
  }
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
function applyShopName(name) {
  if (!name) return;
  const el = document.getElementById('shop-name');
  if (el) el.textContent = name;
  const printEl = document.getElementById('print-shop-name');
  if (printEl) printEl.textContent = name;
  const hdrEl = document.getElementById('report-shop-header');
  if (hdrEl) hdrEl.textContent = name;
  document.title = `Reports — ${name}`;
}

// Set print date on load
(function() {
  const el = document.getElementById('print-date');
  if (el) el.textContent = 'Printed: ' + new Date().toLocaleString();
})();

async function fetchShopName() {
  // Show cached name immediately so offline still shows the right store
  try {
    const cached = JSON.parse(localStorage.getItem('bkt_settings') || '{}');
    if (cached.shopName) applyShopName(cached.shopName);
  } catch (e) {}

  // Then try server for latest value
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (res.ok) {
      const settings = await res.json();
      applyShopName(settings.shopName || 'BKT House');
    }
  } catch (e) { /* keep cached value */ }
}

// ─── Init ────────────────────────────────────────────────────────────────────
// Called by report.html after login is confirmed (or immediately if already logged in)
function initReport() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date-from').value = today;
  document.getElementById('date-to').value = today;

  fetchShopName();
  const { from, to } = getDateRange('today');
  loadData(from, to);
}
