'use strict';

const API_BASE = '';
const NEXT_BTN = { pending: '🍳 Cook', cooking: '✓ Ready', ready: '🍽 Served' };
let ws = null;
let bills = {};
let kdsHistory = [];
let historyVisible = false;
let elapsedInterval = null;

// ─── WebSocket ───────────────────────────────────────────────────────────────

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', role: 'kds' }));
    setConnStatus(true);
  };

  ws.onclose = () => {
    setConnStatus(false);
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleWSMessage(msg);
  };
}

function setConnStatus(online) {
  const el = document.getElementById('kds-conn');
  el.className = 'kds-conn ' + (online ? 'online' : 'offline');
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'order:new':
      bills[msg.table] = msg.bill;
      renderGrid();
      flashCard(msg.table);
      playBeep();
      showToast(`New order: ${msg.table}`);
      break;

    case 'order:updated':
      bills[msg.table] = msg.bill;
      renderGrid();
      flashCard(msg.table);
      showToast(`Order updated: ${msg.table}`);
      break;

    case 'item:statusChanged':
      if (bills[msg.table]) {
        const item = bills[msg.table].items.find(i => i.id === msg.itemId);
        if (item) {
          item.status = msg.status;
          if (msg.item.readyAt) item.readyAt = msg.item.readyAt;
        }
        renderGrid();
      }
      break;

    case 'bill:cleared':
      delete bills[msg.table];
      renderGrid();
      showToast(`${msg.table} cleared`);
      break;
  }
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadBills() {
  try {
    const res = await fetch(`${API_BASE}/api/bills`);
    bills = await res.json();
  } catch (e) {
    console.error('Failed to load bills:', e);
  }
}

// ─── Elapsed helper ─────────────────────────────────────────────────────────

function elapsed(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return { text: 'Just now', level: 'fresh' };
  if (mins < 15) return { text: `${mins}m`,  level: 'fresh' };
  if (mins < 30) return { text: `${mins}m`,  level: 'warn'  };
  if (mins < 60) return { text: `${mins}m`,  level: 'late'  };
  const h = Math.floor(mins / 60), m = mins % 60;
  return { text: `${h}h ${m}m`, level: 'late' };
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderGrid() {
  if (historyVisible) return;

  const grid = document.getElementById('kds-grid');
  const empty = document.getElementById('kds-empty');
  const tables = Object.keys(bills).sort();

  // Update active table count badge
  const activeTables = tables.filter(t =>
    bills[t].items.some(i => (i.status || 'pending') !== 'served'));
  const countBadge = document.getElementById('kds-count');
  if (activeTables.length > 0) {
    countBadge.textContent = activeTables.length;
    countBadge.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
  }

  // Update last-updated timestamp
  document.getElementById('kds-last-updated').textContent =
    `Last updated: ${new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  if (tables.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    updatePendingCount();
    return;
  }

  empty.classList.add('hidden');

  grid.innerHTML = tables.map(table => {
    const bill = bills[table];
    const { text: elapsedText, level } = elapsed(bill.startedAt);
    const timeStr = new Date(bill.startedAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });

    // Status counts
    const cnt = { pending: 0, cooking: 0, ready: 0, served: 0 };
    bill.items.forEach(i => { const st = i.status || 'pending'; cnt[st === 'preparing' ? 'cooking' : st] = (cnt[st === 'preparing' ? 'cooking' : st] || 0) + 1; });
    const allReady = bill.items.every(i => i.status === 'ready' || i.status === 'served');
    const hasPending = cnt.pending > 0;
    const hasActive = cnt.pending + cnt.cooking > 0;
    const allDone = cnt.served === bill.items.length;

    return `
      <div class="kds-card kds-card--${level}${allDone ? ' kds-card--done' : ''}" data-table="${table}">

        <div class="kds-card-head">
          <div class="kds-head-left">
            <span class="kds-table-badge">${table}</span>
            <div class="kds-head-meta">
              <span class="elapsed-badge elapsed--${level}" data-started="${bill.startedAt}">${elapsedText}</span>
              <span class="kds-time">${timeStr}</span>
            </div>
          </div>
          <div class="kds-head-right">
            <div class="kds-status-counts">
              ${cnt.pending > 0   ? `<span class="kds-cnt kds-cnt--pending">${cnt.pending} pending</span>` : ''}
              ${cnt.cooking > 0 ? `<span class="kds-cnt kds-cnt--cooking">${cnt.cooking} cooking</span>` : ''}
              ${cnt.ready > 0     ? `<span class="kds-cnt kds-cnt--ready">${cnt.ready} ready</span>` : ''}
              ${allDone           ? `<span class="kds-cnt kds-cnt--served">All served</span>` : ''}
            </div>
            <div class="kds-bulk-btns">
              ${hasPending
                ? `<button class="kds-bulk-btn kds-bulk--cook" data-action="cook" data-table="${table}">All Cook</button>` : ''}
              ${!hasPending && hasActive
                ? `<button class="kds-bulk-btn kds-bulk--ready" data-action="ready" data-table="${table}">All Ready</button>` : ''}
              ${allReady
                ? `<button class="kds-bulk-btn kds-bulk--serve" data-action="serve" data-table="${table}">Serve All</button>` : ''}
            </div>
          </div>
        </div>

        <div class="kds-items-list">
          ${bill.items.map(item => {
            const st = item.status || 'pending';
            const next = NEXT_BTN[st];
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
                  ${next
                    ? `<button class="kds-action-btn kds-btn--${st}" data-table="${table}" data-id="${item.id}">${next}</button>`
                    : `<span class="kds-served-label">✓ Served</span>`}
                </div>
              </div>`;
          }).join('')}
        </div>

      </div>`;
  }).join('');

  // Bind item action buttons
  grid.querySelectorAll('.kds-action-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      cycleItemStatus(btn.dataset.table, btn.dataset.id);
    });
  });

  // Bind bulk buttons
  grid.querySelectorAll('.kds-bulk-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.action === 'cook')  bulkSetStatus(btn.dataset.table, 'pending', 'cooking');
      if (btn.dataset.action === 'ready') bulkSetStatus(btn.dataset.table, 'cooking', 'ready');
      if (btn.dataset.action === 'serve') markAllServed(btn.dataset.table);
    });
  });

  updatePendingCount();
}

function updatePendingCount() {
  let pending = 0;
  Object.values(bills).forEach(bill => {
    bill.items.forEach(item => {
      if (item.status === 'pending' || !item.status) pending += item.quantity;
    });
  });
  const el = document.getElementById('kds-pending-count');
  el.textContent = `${pending} pending`;
  el.classList.toggle('zero', pending === 0);
}

function updateElapsed() {
  document.querySelectorAll('.elapsed-badge[data-started]').forEach(el => {
    const started = parseInt(el.dataset.started);
    const { text, level } = elapsed(started);
    el.textContent = text;
    el.className = `elapsed-badge elapsed--${level}`;

    // Update card urgency too
    const card = el.closest('.kds-card');
    if (card) {
      card.classList.remove('kds-card--fresh', 'kds-card--warn', 'kds-card--late');
      card.classList.add('kds-card--' + level);
    }
  });
}

function flashCard(table) {
  const card = document.querySelector(`.kds-card[data-table="${table}"]`);
  if (!card) return;
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}

// ─── Item interactions ───────────────────────────────────────────────────────

function cycleItemStatus(table, itemId) {
  const bill = bills[table];
  if (!bill) return;
  const item = bill.items.find(i => i.id === itemId);
  if (!item) return;

  const cycle = { pending: 'cooking', cooking: 'ready', ready: 'served' };
  const next = cycle[item.status || 'pending'];
  if (!next) return;

  // Send via WebSocket for real-time broadcast
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'item:statusChange',
      table,
      itemId,
      status: next,
    }));
  }

  // Optimistic update
  item.status = next;
  if (next === 'ready') item.readyAt = Date.now();
  renderGrid();

  // Auto-serve single-item orders once ready
  if (next === 'ready' && bill.items.length === 1) {
    markAllServed(table);
  }
}

function bulkSetStatus(table, fromStatus, toStatus) {
  const bill = bills[table];
  if (!bill) return;

  bill.items.forEach(item => {
    if (item.status === fromStatus || (!item.status && fromStatus === 'pending')) {
      item.status = toStatus;
      if (toStatus === 'ready') item.readyAt = Date.now();

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'item:statusChange',
          table,
          itemId: item.id,
          status: toStatus,
        }));
      }
    }
  });

  renderGrid();
}

async function markAllServed(table) {
  const bill = bills[table];
  if (!bill) return;

  const servedAt = Date.now();

  // Persist served status via REST API (saves to server + broadcasts to all clients)
  // Also send via WS for instant real-time propagation
  await Promise.all(bill.items.map(async item => {
    item.status = 'served'; // optimistic local update
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'item:statusChange', table, itemId: item.id, status: 'served' }));
    }
    try {
      await fetch(`/api/bills/${encodeURIComponent(table)}/items/${encodeURIComponent(item.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'served' }),
      });
    } catch (e) {}
  }));

  const historyEntry = {
    table,
    servedAt,
    startedAt: bill.startedAt,
    items: bill.items.map(item => ({
      id: item.id,
      name: item.name,
      nameZh: item.nameZh,
      quantity: item.quantity,
      sentAt: item.sentAt,
      readyAt: item.readyAt,
    })),
  };

  try {
    await fetch(`${API_BASE}/api/kds-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(historyEntry),
    });
  } catch (e) {
    console.error('Failed to save KDS history:', e);
  }

  delete bills[table];
  renderGrid();
  showToast(`${table} served!`);
}

// ─── KDS History ─────────────────────────────────────────────────────────────

async function loadKdsHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/kds-history`);
    kdsHistory = await res.json();
  } catch (e) {
    console.error('Failed to load KDS history:', e);
    kdsHistory = [];
  }
}

function toggleHistoryView() {
  historyVisible = !historyVisible;
  const grid = document.getElementById('kds-grid');
  const empty = document.getElementById('kds-empty');
  const panel = document.getElementById('kds-history-panel');
  const btn = document.getElementById('kds-history-btn');
  const clearBtn = document.getElementById('kds-clear-history-btn');

  if (historyVisible) {
    grid.classList.add('hidden');
    empty.classList.add('hidden');
    panel.classList.remove('hidden');
    btn.classList.add('active');
    clearBtn.classList.remove('hidden');
    loadKdsHistory().then(() => renderHistoryPanel());
  } else {
    panel.classList.add('hidden');
    grid.classList.remove('hidden');
    btn.classList.remove('active');
    clearBtn.classList.add('hidden');
    renderGrid();
  }
}

async function clearKdsHistory() {
  if (!confirm('Clear all KDS history? This cannot be undone.')) return;

  try {
    await fetch(`${API_BASE}/api/kds-history`, { method: 'DELETE' });
    kdsHistory = [];
    renderHistoryPanel();
    showToast('History cleared');
  } catch (e) {
    console.error('Failed to clear KDS history:', e);
  }
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '--';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function prepTimeClass(ms) {
  if (!ms || ms < 0) return '';
  const mins = ms / 60000;
  if (mins >= 20) return 'time-red';
  if (mins >= 10) return 'time-amber';
  return 'time-green';
}

function renderHistoryPanel() {
  const panel = document.getElementById('kds-history-panel');

  if (kdsHistory.length === 0) {
    panel.innerHTML = `
      <div class="kds-history-empty">
        <div class="kds-empty-icon">📋</div>
        <div>No served orders yet</div>
      </div>`;
    return;
  }

  panel.innerHTML = kdsHistory.map(order => {
    const servedTime = new Date(order.servedAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
    const servedDate = new Date(order.servedAt).toLocaleDateString('en-MY', { day: '2-digit', month: 'short' });
    const totalElapsed = order.servedAt - order.startedAt;

    const prepTimes = order.items
      .filter(i => i.readyAt && i.sentAt)
      .map(i => i.readyAt - i.sentAt);
    const avgPrep = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length
      : null;

    return `
      <div class="kds-history-card">
        <div class="kds-history-head">
          <div class="kds-head-left">
            <span class="kds-table-badge">${order.table}</span>
            <div class="kds-head-meta">
              <span class="kds-history-date">${servedDate} ${servedTime}</span>
              <span class="kds-history-total">Total: <strong>${formatDuration(totalElapsed)}</strong></span>
            </div>
          </div>
          <div class="kds-head-right">
            ${avgPrep !== null ? `<span class="kds-cnt ${prepTimeClass(avgPrep)}">Avg prep: ${formatDuration(avgPrep)}</span>` : ''}
          </div>
        </div>
        <div class="kds-items-list">
          ${order.items.map(item => {
            const prep = (item.readyAt && item.sentAt) ? item.readyAt - item.sentAt : null;
            const total = (order.servedAt && item.sentAt) ? order.servedAt - item.sentAt : null;
            return `
              <div class="kds-item kds-item--served">
                <div class="kds-item-info">
                  <span class="kds-item-zh">${item.nameZh}</span>
                  <span class="kds-item-en">${item.name}</span>
                </div>
                <div class="kds-item-right">
                  <span class="kds-item-qty">×${item.quantity}</span>
                  <span class="kds-time-badge ${prepTimeClass(prep)}">Prep: ${formatDuration(prep)}</span>
                  <span class="kds-time-badge">Total: ${formatDuration(total)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

// ─── Audio ───────────────────────────────────────────────────────────────────

let audioCtx = null;

function playBeep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {}
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('kds-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.getBoundingClientRect();
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2000);
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  await loadBills();
  renderGrid();
  connectWS();
  elapsedInterval = setInterval(updateElapsed, 30000);

  document.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });
}

document.addEventListener('DOMContentLoaded', init);
