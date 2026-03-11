'use strict';

const ACTIVE_BILLS_KEY = 'bkt_active_bills';

const STATUS_LABEL = { pending: 'Pending', cooking: 'Cooking', preparing: 'Cooking', ready: 'Ready', served: 'Served' };

// Normalise legacy 'preparing' → 'cooking'
function normSt(st) { return (st === 'preparing' || st === 'pending') ? 'cooking' : (st || 'cooking'); }

let activeTab  = 'kitchen'; // 'kitchen' | 'served'
let kdsWS      = null;
let localBills = null; // local cache updated directly from WS messages
let kdsHistory = [];   // served orders — mirrors /api/kds-history

// ─── Data source ─────────────────────────────────────────────────────────────

async function fetchBills() {
  if (location.host) {
    try {
      const res = await fetch('/api/bills', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {}
  }
  try { return JSON.parse(localStorage.getItem(ACTIVE_BILLS_KEY) || '{}'); }
  catch (e) { return {}; }
}

async function fetchHistory() {
  if (!location.host) return [];
  try {
    const res = await fetch('/api/kds-history', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch (e) {}
  return [];
}

// ─── WebSocket (server mode only) ────────────────────────────────────────────

function connectKdsWS() {
  if (!location.host) return;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    kdsWS = new WebSocket(`${proto}://${location.host}`);
    kdsWS.onopen = async () => {
      kdsWS.send(JSON.stringify({ type: 'register', role: 'kds' }));
      // Full refresh on every (re)connect to catch any missed messages
      localBills = null;
      kdsHistory = await fetchHistory();
      renderKDS();
    };
    kdsWS.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (!localBills) { renderKDS(); return; }

        switch (msg.type) {
          case 'item:statusChanged':
            if (localBills[msg.table]) {
              const item = localBills[msg.table].items.find(i => i.id === msg.itemId);
              if (item) {
                item.status = msg.status;
                if (msg.item && msg.item.readyAt) item.readyAt = msg.item.readyAt;
              }
            }
            renderKDS();
            break;
          case 'order:new':
          case 'order:updated':
            if (msg.bill) localBills[msg.table] = msg.bill;
            renderKDS();
            break;
          case 'bill:cleared':
            if (msg.table === '*') localBills = {};
            else delete localBills[msg.table];
            renderKDS(); // Update kitchen tab immediately
            // Refresh history to show the new entry
            fetchHistory().then(h => {
              if (h.length > 0 || msg.table === '*') kdsHistory = h;
              renderKDS();
            });
            break;
        }
      } catch { renderKDS(); }
    };
    kdsWS.onclose = () => { kdsWS = null; setTimeout(connectKdsWS, 3000); };
    kdsWS.onerror = () => kdsWS && kdsWS.close();
  } catch (e) { setTimeout(connectKdsWS, 5000); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function elapsed(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return { text: 'Just now', level: 'fresh' };
  if (mins < 15) return { text: `${mins}m`,  level: 'fresh' };
  if (mins < 30) return { text: `${mins}m`,  level: 'warn'  };
  if (mins < 60) return { text: `${mins}m`,  level: 'late'  };
  const h = Math.floor(mins / 60), m = mins % 60;
  return { text: `${h}h ${m}m`, level: 'late' };
}

function renderCard(bill, table) {
  const items = bill.items;
  const { text: elapsedText, level } = elapsed(bill.startedAt);
  const timeStr = new Date(bill.startedAt)
    .toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });

  const cnt = { cooking: 0, ready: 0, served: 0 };
  items.forEach(i => { const st = normSt(i.status); cnt[st] = (cnt[st] || 0) + 1; });
  const allServed = cnt.served === items.length;

  return `
    <div class="kds-card kds-card--${level}${allServed ? ' kds-card--done' : ''}">
      <div class="kds-card-head">
        <div class="kds-head-left">
          <span class="kds-table-badge">${table}</span>
          <div class="kds-head-meta">
            <span class="elapsed-badge elapsed--${level}">${elapsedText}</span>
            <span class="kds-time">${timeStr}</span>
          </div>
        </div>
        <div class="kds-head-right">
          <div class="kds-status-counts">
            ${cnt.cooking > 0 ? `<span class="kds-cnt kds-cnt--cooking">${cnt.cooking} cooking</span>` : ''}
            ${cnt.ready   > 0 ? `<span class="kds-cnt kds-cnt--ready">${cnt.ready} ready</span>`   : ''}
            ${allServed        ? `<span class="kds-cnt kds-cnt--served">All served</span>`          : ''}
          </div>
        </div>
      </div>
      <div class="kds-items-list">
        ${items.map(item => {
          const st = normSt(item.status);
          return `
            <div class="kds-item kds-item--${st}">
              <div class="kds-item-info">
                <span class="kds-item-zh">${item.nameZh}</span>
                <span class="kds-item-en">${item.name}</span>
                ${item.selectedModifiers && item.selectedModifiers.length
                  ? `<span class="kds-item-mods">${item.selectedModifiers.map(m => m.optionLabel).join(' · ')}</span>` : ''}
                ${item.notes ? `<span class="kds-item-notes">📝 ${item.notes}</span>` : ''}
              </div>
              <div class="kds-item-right">
                <span class="kds-item-qty">×${item.quantity}</span>
                <span class="kds-status-label kds-status--${st}">${STATUS_LABEL[st]}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderHistoryCard(order) {
  const servedTime = new Date(order.servedAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
  const servedDate = new Date(order.servedAt).toLocaleDateString('en-MY', { day: '2-digit', month: 'short' });
  const totalMs    = order.servedAt - order.startedAt;
  const totalMins  = Math.floor(totalMs / 60000);
  const totalStr   = totalMins > 0 ? `${totalMins}m` : '<1m';

  return `
    <div class="kds-card kds-card--done">
      <div class="kds-card-head">
        <div class="kds-head-left">
          <span class="kds-table-badge">${order.table}</span>
          <div class="kds-head-meta">
            <span class="elapsed-badge elapsed--fresh">${servedDate} ${servedTime}</span>
            <span class="kds-time">Total: ${totalStr}</span>
          </div>
        </div>
        <div class="kds-head-right">
          <span class="kds-cnt kds-cnt--served">All served</span>
        </div>
      </div>
      <div class="kds-items-list">
        ${(order.items || []).map(item => `
          <div class="kds-item kds-item--served">
            <div class="kds-item-info">
              <span class="kds-item-zh">${item.nameZh || ''}</span>
              <span class="kds-item-en">${item.name || ''}</span>
            </div>
            <div class="kds-item-right">
              <span class="kds-item-qty">×${item.quantity || 1}</span>
              <span class="kds-status-label kds-status--served">Served</span>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function renderKDS() {
  if (!localBills) localBills = await fetchBills();

  const bills = localBills;
  const tables = Object.keys(bills).sort((a, b) => bills[a].startedAt - bills[b].startedAt);
  const kitchenTables = tables.filter(t =>
    bills[t].items.some(i => (i.status || 'cooking') !== 'served'));

  // Active order count badge
  const badge = document.getElementById('kds-count');
  badge.textContent = kitchenTables.length;
  badge.classList.toggle('hidden', kitchenTables.length === 0);

  // Tab count badges
  const ktCount  = document.getElementById('tab-kitchen-count');
  const srvCount = document.getElementById('tab-served-count');
  ktCount.textContent  = kitchenTables.length;
  ktCount.classList.toggle('hidden', kitchenTables.length === 0);
  srvCount.textContent = kdsHistory.length;
  srvCount.classList.toggle('hidden', kdsHistory.length === 0);

  document.getElementById('last-updated').textContent =
    `Updated ${new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  const wrap = document.getElementById('kds-wrap');

  if (activeTab === 'kitchen') {
    if (kitchenTables.length === 0) {
      wrap.innerHTML = `
        <div class="orders-empty">
          <div class="orders-empty-icon">👨‍🍳</div>
          <div class="orders-empty-title">No Active Orders</div>
          <div class="orders-empty-sub">Orders sent from POS will appear here.</div>
        </div>`;
    } else {
      wrap.innerHTML = `<div class="kds-section-grid">${kitchenTables.map(t => renderCard(bills[t], t)).join('')}</div>`;
    }
  } else {
    if (kdsHistory.length === 0) {
      wrap.innerHTML = `
        <div class="orders-empty">
          <div class="orders-empty-icon">✓</div>
          <div class="orders-empty-title">No Served Orders</div>
          <div class="orders-empty-sub">Completed orders will appear here.</div>
        </div>`;
    } else {
      const cards = kdsHistory.map(o => { try { return renderHistoryCard(o); } catch { return ''; } });
      wrap.innerHTML = `<div class="kds-section-grid">${cards.join('')}</div>`;
    }
  }
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.kds-tab').forEach(btn => {
    btn.classList.toggle('kds-tab--active', btn.dataset.tab === tab);
  });
  renderKDS();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  kdsHistory = await fetchHistory();
  renderKDS();

  document.querySelectorAll('.kds-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    [localBills, kdsHistory] = await Promise.all([fetchBills(), fetchHistory()]);
    await renderKDS();
    const btn = document.getElementById('refresh-btn');
    btn.textContent = '✓ Done';
    btn.classList.add('refreshed');
    setTimeout(() => { btn.textContent = '↺ Refresh'; btn.classList.remove('refreshed'); }, 1500);
  });

  // WebSocket: instant updates from server
  connectKdsWS();

  // Fallback for file:// mode
  const bktChannel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('bkt_pos') : null;
  if (bktChannel) bktChannel.onmessage = () => { localBills = null; renderKDS(); };
  window.addEventListener('storage', e => { if (e.key === ACTIVE_BILLS_KEY) renderKDS(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderKDS(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.location.href = 'index.html';
  });

  // Poll every 5s ONLY when WebSocket is disconnected (fallback)
  // When WS is live, it handles all updates — polling would race with WS and overwrite updates
  setInterval(async () => {
    if (!kdsWS || kdsWS.readyState !== WebSocket.OPEN) {
      [localBills, kdsHistory] = await Promise.all([fetchBills(), fetchHistory()]);
      renderKDS();
    }
  }, 5000);
}

document.addEventListener('DOMContentLoaded', init);
