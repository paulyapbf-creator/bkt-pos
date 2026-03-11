'use strict';

const ACTIVE_BILLS_KEY = 'bkt_active_bills';

const STATUS_LABEL = { pending: 'Pending', cooking: 'Cooking', preparing: 'Cooking', ready: 'Ready', served: 'Served' };

// Normalise legacy 'preparing' → 'cooking'
function normSt(st) { return (st === 'preparing' || st === 'pending') ? 'cooking' : (st || 'cooking'); }

let activeTab = 'kitchen'; // 'kitchen' | 'served'
let kdsWS     = null;
let localBills = null; // local cache updated directly from WS messages

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

// ─── WebSocket (server mode only) ────────────────────────────────────────────

function connectKdsWS() {
  if (!location.host) return;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    kdsWS = new WebSocket(`${proto}://${location.host}`);
    kdsWS.onopen = () => kdsWS.send(JSON.stringify({ type: 'register', role: 'kds' }));
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
            renderKDS();
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

// ─── Render ───────────────────────────────────────────────────────────────────

async function renderKDS() {
  if (!localBills) localBills = await fetchBills();
  const bills = localBills;
  const tables = Object.keys(bills).sort((a, b) => bills[a].startedAt - bills[b].startedAt);

  const kitchenTables = tables.filter(t =>
    bills[t].items.some(i => (i.status || 'cooking') !== 'served'));

  const servedTables = tables.filter(t =>
    bills[t].items.length > 0 &&
    bills[t].items.every(i => (i.status || 'cooking') === 'served'));

  const badge = document.getElementById('kds-count');
  if (kitchenTables.length > 0) {
    badge.textContent = kitchenTables.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const ktCount  = document.getElementById('tab-kitchen-count');
  const srvCount = document.getElementById('tab-served-count');
  if (kitchenTables.length > 0) {
    ktCount.textContent = kitchenTables.length;
    ktCount.classList.remove('hidden');
  } else {
    ktCount.classList.add('hidden');
  }
  if (servedTables.length > 0) {
    srvCount.textContent = servedTables.length;
    srvCount.classList.remove('hidden');
  } else {
    srvCount.classList.add('hidden');
  }

  document.getElementById('last-updated').textContent =
    `Updated ${new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  const wrap = document.getElementById('kds-wrap');
  const displayTables = activeTab === 'kitchen' ? kitchenTables : servedTables;

  if (displayTables.length === 0) {
    const msg = activeTab === 'kitchen'
      ? { icon: '👨‍🍳', title: 'No Active Orders',       sub: 'Orders sent from POS will appear here.' }
      : { icon: '✓',   title: 'No Fully Served Orders', sub: 'Tables where every item is served will appear here.' };
    wrap.innerHTML = `
      <div class="orders-empty">
        <div class="orders-empty-icon">${msg.icon}</div>
        <div class="orders-empty-title">${msg.title}</div>
        <div class="orders-empty-sub">${msg.sub}</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="kds-section-grid">
      ${displayTables.map(t => renderCard(bills[t], t)).join('')}
    </div>`;
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.kds-tab').forEach(btn => {
    btn.classList.toggle('kds-tab--active', btn.dataset.tab === tab);
  });
  renderKDS();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  renderKDS();

  document.querySelectorAll('.kds-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    localBills = await fetchBills();
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

  // Poll every 5s: refresh local cache from server and re-render
  setInterval(async () => { localBills = await fetchBills(); renderKDS(); }, 5000);
}

document.addEventListener('DOMContentLoaded', init);
