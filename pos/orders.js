'use strict';

const ACTIVE_BILLS_KEY = 'bkt_active_bills';

const STATUS_LABELS   = { pending: 'Pending', cooking: 'Cooking', ready: 'Ready', served: 'Served' };
const STATUS_SEQUENCE = ['pending', 'cooking', 'ready', 'served'];

function loadActiveBills() {
  try { const r = localStorage.getItem(ACTIVE_BILLS_KEY); return r ? JSON.parse(r) : {}; }
  catch (e) { return {}; }
}

function saveBills(bills) {
  localStorage.setItem(ACTIVE_BILLS_KEY, JSON.stringify(bills));
}

// Sync from server and update localStorage so status changes from old KDS are reflected
async function syncFromServer() {
  if (!location.host) return;
  try {
    const res = await fetch('/api/bills');
    if (res.ok) {
      const bills = await res.json();
      saveBills(bills);
    }
  } catch (e) {}
}

function getBillTotal(items) {
  return items.reduce((s, i) => s + i.subtotal, 0);
}

function elapsed(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return { text: 'Just now',        level: 'fresh' };
  if (mins < 15) return { text: `${mins} min ago`,  level: 'fresh' };
  if (mins < 30) return { text: `${mins} min ago`,  level: 'warn'  };
  if (mins < 60) return { text: `${mins} min ago`,  level: 'late'  };
  const h = Math.floor(mins / 60), m = mins % 60;
  return { text: `${h}h ${m}m ago`, level: 'late' };
}

async function updateItemStatus(table, itemId) {
  const bills = loadActiveBills();
  if (!bills[table]) return;
  const item = bills[table].items.find(i => i.id === itemId);
  if (!item) return;
  const idx = STATUS_SEQUENCE.indexOf(item.status || 'pending');
  if (idx >= STATUS_SEQUENCE.length - 1) return;
  const newStatus = STATUS_SEQUENCE[idx + 1];

  // Optimistic update: write to localStorage immediately for instant re-render
  item.status = newStatus;
  saveBills(bills);
  renderOrders();

  // Persist to server (server will broadcast item:statusChanged to KDS via WebSocket)
  if (location.host) {
    try {
      await fetch(`/api/bills/${encodeURIComponent(table)}/items/${encodeURIComponent(itemId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {}
  }
}

function renderOrders() {
  const bills  = loadActiveBills();
  const tables = Object.keys(bills);
  const wrap   = document.getElementById('orders-wrap');

  const badge = document.getElementById('active-count');
  if (tables.length > 0) {
    badge.textContent = tables.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  document.getElementById('last-updated').textContent =
    `Last updated: ${new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  if (tables.length === 0) {
    wrap.innerHTML = `
      <div class="orders-empty">
        <div class="orders-empty-icon">🍽️</div>
        <div class="orders-empty-title">No Active Orders</div>
        <div class="orders-empty-sub">Orders sent to the kitchen will appear here.</div>
      </div>`;
    return;
  }

  tables.sort((a, b) => bills[a].startedAt - bills[b].startedAt);

  wrap.innerHTML = tables.map(table => {
    const bill    = bills[table];
    const total   = getBillTotal(bill.items);
    const itemQty = bill.items.reduce((s, i) => s + i.quantity, 0);
    const { text: elapsedText, level } = elapsed(bill.startedAt);
    const d       = new Date(bill.startedAt);
    const timeStr = d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="order-card order-card--${level}">

        <div class="order-card-head">
          <div class="order-head-left">
            <span class="order-table-badge">${table}</span>
            <div class="order-head-meta">
              <span class="order-time">Ordered at ${timeStr}</span>
              <span class="order-item-count">${itemQty} item${itemQty !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="order-head-right">
            <span class="elapsed-badge elapsed--${level}">${elapsedText}</span>
            <span class="order-head-total">RM ${total.toFixed(2)}</span>
          </div>
        </div>

        <div class="order-items-list">
          ${bill.items.map(item => {
            const st = item.status || 'pending';
            const canAdvance = st !== 'served';
            return `
              <div class="oi-row">
                <div class="oi-info">
                  <span class="oi-zh">${item.nameZh}</span>
                  <span class="oi-en">${item.name}</span>
                  ${item.selectedModifiers && item.selectedModifiers.length
                    ? `<span class="oi-mods">${item.selectedModifiers.map(m => m.optionLabel).join(' · ')}</span>`
                    : ''}
                  ${item.notes ? `<span class="oi-notes">📝 ${item.notes}</span>` : ''}
                </div>
                <div class="oi-right">
                  <span class="status-pill status-pill--${st}${canAdvance ? ' status-pill--tap' : ''}"
                    data-table="${table}" data-id="${item.id}"
                    title="${canAdvance ? 'Tap to advance status' : 'Served'}"
                  >${STATUS_LABELS[st]}</span>
                  <span class="oi-qty">×${item.quantity}</span>
                  <span class="oi-price">RM ${item.subtotal.toFixed(2)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>

        <div class="order-card-foot">
          <div>
            <span class="order-foot-label">Total</span>
            <span class="order-foot-total">RM ${total.toFixed(2)}</span>
          </div>
          <button class="edit-order-btn" data-table="${table}">Edit Order →</button>
        </div>

      </div>`;
  }).join('');

  wrap.querySelectorAll('.edit-order-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `index.html?table=${btn.dataset.table}`;
    });
  });

  wrap.querySelectorAll('.status-pill--tap').forEach(pill => {
    pill.addEventListener('click', () => {
      updateItemStatus(pill.dataset.table, pill.dataset.id);
    });
  });
}

function init() {
  syncFromServer().then(renderOrders);

  document.getElementById('refresh-btn').addEventListener('click', () => {
    syncFromServer().then(() => {
      renderOrders();
      const btn = document.getElementById('refresh-btn');
      btn.textContent = '✓ Done';
      btn.classList.add('refreshed');
      setTimeout(() => { btn.textContent = '↺ Refresh'; btn.classList.remove('refreshed'); }, 1500);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.location.href = 'index.html';
  });

  window.addEventListener('storage', e => {
    if (e.key === ACTIVE_BILLS_KEY) renderOrders();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncFromServer().then(renderOrders);
  });

  // Poll every 3 s: sync from server then re-render
  setInterval(() => syncFromServer().then(renderOrders), 3000);
}

document.addEventListener('DOMContentLoaded', init);
