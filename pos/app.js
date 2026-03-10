'use strict';
// CATEGORIES, MENU_ITEMS and STORAGE_KEY come from menuDefaults.js

const HISTORY_KEY      = 'bkt_order_history';
const SETTINGS_KEY     = 'bkt_settings';
const ACTIVE_BILLS_KEY = 'bkt_active_bills';

// ─── API + WebSocket CONFIG ──────────────────────────────────────────────────

const API_BASE = '';
let posWS = null;
let billsCache = {};  // local cache updated by API responses + WebSocket messages

// Seed billsCache from localStorage so it works offline / file:// mode
try {
  const r = localStorage.getItem(ACTIVE_BILLS_KEY);
  if (r) billsCache = JSON.parse(r);
} catch (e) {}

// BroadcastChannel: real-time sync between POS, Orders and KDS tabs
const bktChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('bkt_pos') : null;

function broadcast(msg) { if (bktChannel) bktChannel.postMessage(msg); }

function syncBillsToStorage() {
  localStorage.setItem(ACTIVE_BILLS_KEY, JSON.stringify(billsCache));
}

// Always reload billsCache from localStorage before mutating it, so status
// changes made by orders.js are never overwritten by a stale in-memory cache.
function refreshBillsCache() {
  try { billsCache = JSON.parse(localStorage.getItem(ACTIVE_BILLS_KEY) || '{}'); } catch (_) {}
}

function connectWS() {
  if (!location.host) return;  // skip when opened as file://
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    posWS = new WebSocket(`${proto}://${location.host}`);
  } catch (e) { setTimeout(connectWS, 5000); return; }

  posWS.onopen = () => {
    posWS.send(JSON.stringify({ type: 'register', role: 'pos' }));
  };

  posWS.onclose = () => {
    setTimeout(connectWS, 3000);
  };

  posWS.onerror = () => posWS.close();

  posWS.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleWSMessage(msg);
  };
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'item:statusChanged':
      // Update cache
      if (billsCache[msg.table]) {
        const item = billsCache[msg.table].items.find(i => i.id === msg.itemId);
        if (item) {
          item.status = msg.status;
          if (msg.item && msg.item.readyAt) item.readyAt = msg.item.readyAt;
        }
      }
      syncBillsToStorage(); // keep localStorage in sync so orders.html/kds.html can read it
      if (msg.status === 'ready') {
        showToast(`🍳 ${msg.item.nameZh || msg.item.name} ready · ${msg.table}`);
      }
      break;

    case 'table:allReady':
      showToast(`✅ All items ready for ${msg.table}!`);
      break;

    case 'order:new':
    case 'order:updated':
      if (msg.bill) billsCache[msg.table] = msg.bill;
      syncBillsToStorage();
      break;

    case 'bill:cleared':
      delete billsCache[msg.table];
      syncBillsToStorage();
      break;
  }
}

// ─── STATE ────────────────────────────────────────────────────────────────────

let menuItems = [];

const state = {
  tableNumber:        null,
  items:              [],
  selectedCategory:   'all',
  searchQuery:        '',
  modalItem:          null,
  modalSelections:    {},
  modalNotes:         '',
  editingOrderItemId: null,
  editingActiveBill:  null,   // table name when editing an existing kitchen order
  payStep:            'list',
  payingTable:        null,
  payMethod:          null,
  _counter:           0,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function totalItems() { return state.items.reduce((s, i) => s + i.quantity, 0); }
function totalPrice()  { return state.items.reduce((s, i) => s + i.subtotal, 0); }

function cartCountForMenuItem(menuItemId) {
  return state.items.filter(i => i.menuItem.id === menuItemId)
                    .reduce((s, i) => s + i.quantity, 0);
}

function getFilteredItems() {
  const q = state.searchQuery.trim().toLowerCase();
  return menuItems.filter(item => {
    if (!item.isAvailable) return false;
    if (state.selectedCategory !== 'all' && item.category !== state.selectedCategory) return false;
    if (q) return item.name.toLowerCase().includes(q) || item.nameZh.includes(q) ||
                   (item.description && item.description.toLowerCase().includes(q));
    return true;
  });
}

function calcUnitPrice(basePrice, modifiers) {
  return basePrice + modifiers.reduce((s, m) => s + m.priceAdjustment, 0);
}

// ─── PERSISTENCE (API-backed with cache) ─────────────────────────────────────

function loadSettings() {
  try { const r = localStorage.getItem(SETTINGS_KEY); return r ? JSON.parse(r) : {}; }
  catch (e) { return {}; }
}

function loadActiveBills() {
  return billsCache;
}

async function fetchBillsFromAPI() {
  try {
    const res = await fetch(`${API_BASE}/api/bills`);
    if (res.ok) billsCache = await res.json();
  } catch (e) {
    console.warn('Failed to fetch bills, using cache');
  }
  return billsCache;
}

function billRow(oi, existingStatus) {
  return {
    id: oi.id, menuItemId: oi.menuItem.id,
    nameZh: oi.menuItem.nameZh, name: oi.menuItem.name,
    quantity: oi.quantity, unitPrice: oi.unitPrice, subtotal: oi.subtotal,
    selectedModifiers: oi.selectedModifiers, notes: oi.notes,
    status: existingStatus || 'pending',
  };
}

async function addToActiveBill(table, cartItems) {
  refreshBillsCache(); // ensure we have the latest statuses before mutating
  const items = cartItems.map(oi => billRow(oi));
  try {
    const res = await fetch(`${API_BASE}/api/bills/${table}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (res.ok) billsCache[table] = await res.json();
  } catch (e) {
    if (!billsCache[table]) billsCache[table] = { startedAt: Date.now(), items: [] };
    items.forEach(i => billsCache[table].items.push(i));
  }
  syncBillsToStorage();
  broadcast({ type: 'order:new', table });
}

async function setActiveBill(table, cartItems) {
  refreshBillsCache(); // ensure we have the latest statuses before mutating
  // Preserve status from existing items when editing
  const prev = billsCache[table];
  const items = cartItems.map(oi => {
    const existing = prev?.items.find(i => i.id === oi.id);
    return billRow(oi, existing?.status);
  });
  try {
    const res = await fetch(`${API_BASE}/api/bills/${table}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (res.ok) billsCache[table] = await res.json();
  } catch (e) {
    if (billsCache[table]) billsCache[table].items = items;
    else billsCache[table] = { startedAt: Date.now(), items };
  }
  syncBillsToStorage();
  broadcast({ type: 'order:updated', table });
}

async function loadTableOrderToCart(table) {
  try {
    const res = await fetch(`${API_BASE}/api/bills/${table}`);
    if (res.ok) billsCache[table] = await res.json();
  } catch (e) {}

  const bill = billsCache[table];
  if (!bill) return;
  state.items = bill.items.reduce((acc, bi) => {
    const mi = menuItems.find(m => m.id === bi.menuItemId);
    if (!mi) return acc;
    acc.push({
      id: bi.id, menuItem: mi, quantity: bi.quantity,
      selectedModifiers: bi.selectedModifiers || [],
      notes: bi.notes || '', unitPrice: bi.unitPrice, subtotal: bi.subtotal,
    });
    return acc;
  }, []);
  state.tableNumber       = table;
  state.editingActiveBill = table;
  updateTableBtn();
  renderCartPanel();
  renderMenuList();
}

async function clearActiveBill(table) {
  try {
    await fetch(`${API_BASE}/api/bills/${table}`, { method: 'DELETE' });
  } catch (e) {}
  refreshBillsCache(); // re-read so we don't lose other tables' status changes
  delete billsCache[table];
  syncBillsToStorage();
  broadcast({ type: 'bill:cleared', table });
}

function getActiveBillTotal(items) {
  return items.reduce((s, i) => s + i.subtotal, 0);
}

async function saveOrderToHistory(table, items, total, method) {
  const order = { id: `ord_${Date.now()}`, table, timestamp: Date.now(),
                  paymentMethod: method, total, items };
  try {
    await fetch(`${API_BASE}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
  } catch (e) {
    // Fallback: save locally
    let history = [];
    try { const r = localStorage.getItem(HISTORY_KEY); history = r ? JSON.parse(r) : []; } catch (ex) {}
    history.unshift(order);
    if (history.length > 300) history.length = 300;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

function addItem(menuItem, modifiers, notes) {
  const unitPrice = calcUnitPrice(menuItem.price, modifiers);
  state.items.push({
    id: `item-${++state._counter}-${Date.now()}`,
    menuItem, quantity: 1, selectedModifiers: modifiers,
    notes, unitPrice, subtotal: unitPrice,
  });
}

function amendItem(orderItemId, modifiers, notes) {
  const oi = state.items.find(i => i.id === orderItemId);
  if (!oi) return;
  oi.selectedModifiers = modifiers;
  oi.notes  = notes;
  oi.unitPrice = calcUnitPrice(oi.menuItem.price, modifiers);
  oi.subtotal  = oi.unitPrice * oi.quantity;
}

function updateQuantity(id, qty) {
  if (qty <= 0) { state.items = state.items.filter(i => i.id !== id); }
  else {
    const item = state.items.find(i => i.id === id);
    if (item) { item.quantity = qty; item.subtotal = item.unitPrice * qty; }
  }
}

function clearOrder() { state.items = []; }

// ─── TABLE PICKER ─────────────────────────────────────────────────────────────

function openTablePicker(required = false) {
  renderTablePickerBody();
  const modal   = document.getElementById('table-picker-modal');
  const closeBtn = document.getElementById('table-picker-close');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  closeBtn.style.display = required ? 'none' : '';
}

function closeTablePicker() {
  document.getElementById('table-picker-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderTablePickerBody() {
  // Always read fresh from localStorage so maintenance changes are reflected immediately
  try { billsCache = JSON.parse(localStorage.getItem(ACTIVE_BILLS_KEY) || '{}'); } catch (_) {}
  const bills = loadActiveBills();
  let html = '<div class="table-picker-grid">';
  for (let i = 1; i <= 20; i++) {
    const t        = `T${i}`;
    const occupied = !!bills[t];
    const selected = state.tableNumber === t;
    html += `
      <button class="table-cell${occupied ? ' occupied' : ''}${selected ? ' selected' : ''}" data-table="${t}">
        <span class="table-num">${t}</span>
        ${occupied ? '<span class="table-occ-dot"></span>' : ''}
      </button>`;
  }
  html += `</div>
  <div class="table-picker-legend">
    <span class="legend-item"><span class="legend-swatch occ-swatch"></span>Has active order</span>
    <span class="legend-item"><span class="legend-swatch sel-swatch"></span>Current table</span>
  </div>`;
  document.getElementById('table-picker-body').innerHTML = html;
  document.querySelectorAll('.table-cell').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tableNumber = btn.dataset.table;
      updateTableBtn();
      updateCartPanelHeader();
      closeTablePicker();
    });
  });
}

function updateTableBtn() {
  const btn    = document.getElementById('table-select-btn');
  const bills  = loadActiveBills();
  const hasAct = state.tableNumber && !!bills[state.tableNumber];
  if (state.tableNumber) {
    btn.innerHTML = `${state.tableNumber}${hasAct ? ' <span class="tbl-dot">●</span>' : ''} <span class="tbl-arrow">▾</span>`;
  } else {
    btn.innerHTML = `Select Table <span class="tbl-arrow">▾</span>`;
  }
  btn.classList.toggle('tbl-btn-no-table',    !state.tableNumber);
  btn.classList.toggle('tbl-btn-active-bill',  !!hasAct);
}

// ─── RENDER: Cart panel (left) ────────────────────────────────────────────────

function updateCartPanelHeader() {
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.textContent = state.editingActiveBill ? 'Update Kitchen Order' : 'Send to Kitchen';
}

function renderCartPanel() {
  updateCartPanelHeader();

  const total    = totalPrice();
  const hasItems = state.items.length > 0;

  document.getElementById('cp-total').textContent = `RM ${total.toFixed(2)}`;
  document.getElementById('cp-item-count').textContent =
    hasItems ? `${totalItems()} item${totalItems() !== 1 ? 's' : ''}` : '';

  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = !hasItems;

  const body = document.getElementById('cp-body');

  if (!hasItems) {
    body.innerHTML = `
      <div class="cp-empty">
        <span class="cp-empty-icon">🛒</span>
        <span class="cp-empty-msg">No items yet</span>
        <span class="cp-empty-hint">Tap a dish to add</span>
      </div>`;
    return;
  }

  // Group items by category for visual dividers
  let lastCat = null;
  body.innerHTML = state.items.map(oi => {
    const cat     = oi.menuItem.category;
    const catName = CATEGORIES.find(c => c.id === cat)?.name || cat;
    let divider   = '';
    if (cat !== lastCat) { divider = `<div class="cp-cat-divider">${catName}</div>`; lastCat = cat; }
    return `${divider}
      <div class="cp-item">
        <div class="cp-item-top">
          <span class="cp-item-zh">${oi.menuItem.nameZh}</span>
          <button class="cp-amend-btn" data-id="${oi.id}" title="Edit options">✎</button>
        </div>
        <span class="cp-item-en">${oi.menuItem.name}</span>
        ${oi.selectedModifiers.length > 0
          ? `<span class="cp-item-mods">${oi.selectedModifiers.map(m => m.optionLabel).join(' · ')}</span>`
          : ''}
        ${oi.notes ? `<span class="cp-item-notes">${oi.notes}</span>` : ''}
        <div class="cp-item-foot">
          <div class="cp-qty-ctrl">
            <button class="cp-qty-btn" data-action="dec" data-id="${oi.id}">−</button>
            <span class="cp-qty">${oi.quantity}</span>
            <button class="cp-qty-btn" data-action="inc" data-id="${oi.id}">+</button>
          </div>
          <span class="cp-item-price">RM ${oi.subtotal.toFixed(2)}</span>
        </div>
      </div>`;
  }).join('');

  body.querySelectorAll('.cp-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const oi = state.items.find(i => i.id === btn.dataset.id);
      if (!oi) return;
      updateQuantity(btn.dataset.id, oi.quantity + (btn.dataset.action === 'inc' ? 1 : -1));
      renderCartPanel();
      renderMenuList();
    });
  });

  body.querySelectorAll('.cp-amend-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const oi = state.items.find(i => i.id === btn.dataset.id);
      if (!oi) return;
      const prefill = {};
      oi.selectedModifiers.forEach(m => { prefill[m.groupId] = m.optionId; });
      state.editingOrderItemId = oi.id;
      openModifierModal(oi.menuItem, prefill, oi.notes || '');
    });
  });
}

// ─── RENDER: Category bar ─────────────────────────────────────────────────────

function renderCategoryBar() {
  const bar = document.getElementById('category-bar');
  bar.innerHTML = CATEGORIES.map(cat => `
    <button class="cat-btn${cat.id === state.selectedCategory ? ' active' : ''}" data-cat="${cat.id}">
      ${cat.name}
    </button>
  `).join('');
  bar.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedCategory = btn.dataset.cat;
      renderCategoryBar();
      renderMenuList();
    });
  });
}

// ─── RENDER: Menu list (right panel) ─────────────────────────────────────────

function renderMenuList() {
  const list  = document.getElementById('menu-list');
  const items = getFilteredItems();

  if (items.length === 0) {
    list.innerHTML = '<div class="mli-empty">No items found</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const count   = cartCountForMenuItem(item.id);
    const hasMods = item.modifierGroups && item.modifierGroups.length > 0;
    return `
      <div class="mli${count > 0 ? ' mli--in-cart' : ''}" data-id="${item.id}">
        <div class="mli-info">
          <span class="mli-zh">${item.nameZh}${item.isPopular ? ' <span class="mli-star">★</span>' : ''}</span>
          <span class="mli-en">${item.name}${hasMods ? ' <span class="mli-opts">Options</span>' : ''}</span>
        </div>
        <div class="mli-right">
          <span class="mli-price">RM ${item.price.toFixed(2)}</span>
          ${count > 0 ? `<span class="mli-badge">${count}</span>` : '<span class="mli-add-icon">+</span>'}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.mli').forEach(row => {
    row.addEventListener('click', () => {
      if (!state.tableNumber) { openTablePicker(true); return; }
      const item = menuItems.find(i => i.id === row.dataset.id);
      if (!item) return;
      if (item.modifierGroups && item.modifierGroups.length > 0) {
        openModifierModal(item);
      } else {
        addItem(item, [], '');
        renderCartPanel();
        renderMenuList();
      }
    });
  });
}

// ─── MODIFIER MODAL ───────────────────────────────────────────────────────────

function openModifierModal(item, prefillSelections = {}, prefillNotes = '') {
  state.modalItem       = item;
  state.modalSelections = { ...prefillSelections };
  state.modalNotes      = prefillNotes;

  const groups = item.modifierGroups || [];
  document.getElementById('modal-name-zh').textContent = item.nameZh;
  document.getElementById('modal-name-en').textContent = item.name;
  document.getElementById('modal-add-btn').textContent =
    state.editingOrderItemId ? 'Update Order' : 'Add to Order';

  let html = '';
  if (item.descriptionZh) html += `<p class="modal-desc-zh">${item.descriptionZh}</p>`;
  if (item.description)   html += `<p class="modal-desc">${item.description}</p>`;

  groups.forEach(group => {
    html += `
      <div class="modifier-group">
        <div class="group-header">
          <span class="group-name-zh">${group.nameZh}</span>
          <span class="group-name-en">${group.name}</span>
          ${group.required ? '<span class="required-badge">Required</span>' : ''}
        </div>
        ${group.options.map(opt => `
          <div class="modifier-option" data-group-id="${group.id}" data-option-id="${opt.id}">
            <div class="radio-circle"></div>
            <div class="option-labels">
              <div class="option-label-zh">${opt.labelZh}</div>
              <div class="option-label-en">${opt.label}</div>
            </div>
            ${opt.priceAdjustment !== 0
              ? `<span class="option-price">${opt.priceAdjustment > 0 ? '+' : ''}RM ${opt.priceAdjustment.toFixed(2)}</span>`
              : ''}
          </div>`).join('')}
      </div>`;
  });

  html += `
    <div class="modifier-group">
      <div class="group-header"><span class="group-name-zh">备注 / Notes</span></div>
      <textarea id="modal-notes-input" placeholder="Special requests, allergies…" rows="2"></textarea>
    </div>`;

  const body = document.getElementById('modal-body');
  body.innerHTML = html;
  if (prefillNotes) document.getElementById('modal-notes-input').value = prefillNotes;

  body.querySelectorAll('.modifier-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.modalSelections[opt.dataset.groupId] = opt.dataset.optionId;
      syncModalSelectionUI(); syncModalPrice(); syncAddButton();
    });
  });
  document.getElementById('modal-notes-input').addEventListener('input', e => {
    state.modalNotes = e.target.value;
  });

  syncModalSelectionUI(); syncModalPrice(); syncAddButton();
  document.getElementById('modifier-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function syncModalSelectionUI() {
  document.querySelectorAll('#modal-body .modifier-option').forEach(opt => {
    opt.classList.toggle('selected',
      state.modalSelections[opt.dataset.groupId] === opt.dataset.optionId);
  });
}

function syncModalPrice() {
  const item = state.modalItem;
  if (!item) return;
  const adj = (item.modifierGroups || [])
    .filter(g => state.modalSelections[g.id])
    .reduce((sum, g) => {
      const opt = g.options.find(o => o.id === state.modalSelections[g.id]);
      return sum + (opt ? opt.priceAdjustment : 0);
    }, 0);
  document.getElementById('modal-price').textContent = `RM ${(item.price + adj).toFixed(2)}`;
}

function syncAddButton() {
  const item = state.modalItem;
  if (!item) return;
  const missing = (item.modifierGroups || []).some(g => g.required && !state.modalSelections[g.id]);
  document.getElementById('modal-add-btn').disabled = missing;
}

function closeModifierModal() {
  document.getElementById('modifier-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('modal-add-btn').textContent = 'Add to Order';
  state.modalItem = null; state.modalSelections = {}; state.modalNotes = '';
  state.editingOrderItemId = null;
}

// ─── BILLING MODAL ────────────────────────────────────────────────────────────

async function openBillingModal() {
  state.payStep = 'list'; state.payingTable = null; state.payMethod = null;
  await fetchBillsFromAPI();
  renderBillingStep();
  document.getElementById('payment-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeBillingModal() {
  document.getElementById('payment-modal').classList.add('hidden');
  document.body.style.overflow = '';
  state.payStep = 'list'; state.payingTable = null; state.payMethod = null;
}

function renderBillingStep() {
  const titleEl   = document.getElementById('pay-modal-title');
  const subEl     = document.getElementById('pay-subtitle');
  const bodyEl    = document.getElementById('pay-body');
  const backBtn   = document.getElementById('pay-back-btn');
  const confirmBtn = document.getElementById('pay-confirm-btn');

  backBtn.classList.toggle('hidden', state.payStep === 'list');
  confirmBtn.classList.add('hidden');

  if (state.payStep === 'list') {
    titleEl.textContent = 'Unpaid Bills'; subEl.textContent = '';
    const bills = loadActiveBills(); const tables = Object.keys(bills);
    if (tables.length === 0) { bodyEl.innerHTML = '<div class="empty-state">No unpaid bills</div>'; return; }
    bodyEl.innerHTML = tables.map(table => {
      const bill = bills[table]; const total = getActiveBillTotal(bill.items);
      const itemQty = bill.items.reduce((s, i) => s + i.quantity, 0);
      const timeStr = new Date(bill.startedAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
      return `<div class="bill-card">
        <div class="bill-card-left">
          <span class="hist-table-badge">${table}</span>
          <div class="bill-meta"><span class="bill-items">${itemQty} item${itemQty > 1 ? 's' : ''}</span><span class="bill-since">Since ${timeStr}</span></div>
        </div>
        <div class="bill-card-right">
          <span class="bill-total">RM ${total.toFixed(2)}</span>
          <button class="pay-table-btn" data-table="${table}">Pay ▶</button>
        </div></div>`;
    }).join('');
    bodyEl.querySelectorAll('.pay-table-btn').forEach(btn => {
      btn.addEventListener('click', () => { state.payingTable = btn.dataset.table; state.payStep = 'bill'; renderBillingStep(); });
    });

  } else if (state.payStep === 'bill') {
    const table = state.payingTable; const bills = loadActiveBills(); const bill = bills[table];
    if (!bill) { state.payStep = 'list'; renderBillingStep(); return; }
    const total = getActiveBillTotal(bill.items); const itemQty = bill.items.reduce((s, i) => s + i.quantity, 0);
    titleEl.textContent = `Bill — ${table}`; subEl.textContent = `${itemQty} item(s)`;
    bodyEl.innerHTML = `<table class="hist-items-table bill-table">
      ${bill.items.map(bi => `<tr>
        <td class="hi-name">${bi.nameZh} <span class="hi-en">${bi.name}</span>
          ${bi.selectedModifiers && bi.selectedModifiers.length ? `<span class="hi-mods">${bi.selectedModifiers.map(m => m.optionLabel).join(', ')}</span>` : ''}
        </td>
        <td class="hi-qty">×${bi.quantity}</td><td class="hi-price">RM ${bi.subtotal.toFixed(2)}</td></tr>`).join('')}
      <tr class="bill-total-row"><td colspan="2" class="bill-total-label">Total</td><td class="bill-total-amt">RM ${total.toFixed(2)}</td></tr>
    </table>`;
    confirmBtn.textContent = 'Proceed to Payment →'; confirmBtn.classList.remove('hidden');

  } else if (state.payStep === 'method') {
    const bills = loadActiveBills(); const total = bills[state.payingTable] ? getActiveBillTotal(bills[state.payingTable].items) : 0;
    titleEl.textContent = 'Select Payment'; subEl.textContent = `${state.payingTable} · RM ${total.toFixed(2)}`;
    bodyEl.innerHTML = `<div class="pay-methods">
      <button class="pay-method-btn" data-method="tng"><span class="pay-icon">💳</span><span class="pay-name">Touch &amp; Go eWallet</span></button>
      <button class="pay-method-btn" data-method="duitnow"><span class="pay-icon">🏦</span><span class="pay-name">DuitNow QR</span></button>
      <button class="pay-method-btn" data-method="cash"><span class="pay-icon">💵</span><span class="pay-name">Cash</span></button>
    </div>`;
    bodyEl.querySelectorAll('.pay-method-btn').forEach(btn => {
      btn.addEventListener('click', () => { state.payMethod = btn.dataset.method; state.payStep = 'qr'; renderBillingStep(); });
    });

  } else if (state.payStep === 'qr') {
    const bills = loadActiveBills(); const total = bills[state.payingTable] ? getActiveBillTotal(bills[state.payingTable].items) : 0;
    const method = state.payMethod; const settings = loadSettings();
    const titles = { tng: 'Touch & Go eWallet', duitnow: 'DuitNow QR', cash: 'Cash Payment' };
    titleEl.textContent = titles[method] || method; subEl.textContent = `${state.payingTable} · RM ${total.toFixed(2)}`;
    let body = '';
    if (method === 'tng' || method === 'duitnow') {
      const url = settings[method === 'tng' ? 'tngQrUrl' : 'duitnowQrUrl'] || '';
      body = url ? `<div class="qr-container"><img src="${url}" class="qr-img" alt="QR"></div>`
                 : `<div class="qr-placeholder">No QR image configured.<br>Go to <b>Items → Payment Settings</b>.</div>`;
      body += `<div class="pay-amount-row"><span class="pay-amount-label">Amount to Pay</span><span class="pay-amount">RM ${total.toFixed(2)}</span></div>`;
    } else {
      body = `<div class="cash-pay-display"><div class="cash-pay-label">Amount to Collect</div><div class="cash-pay-amount">RM ${total.toFixed(2)}</div></div>`;
    }
    bodyEl.innerHTML = body;
    confirmBtn.textContent = method === 'cash' ? 'Confirm Cash' : 'Payment Received';
    confirmBtn.classList.remove('hidden');
  }
}

function handleBillingBack() {
  if (state.payStep === 'bill')        { state.payStep = 'list';   state.payingTable = null; }
  else if (state.payStep === 'method')   state.payStep = 'bill';
  else if (state.payStep === 'qr')     { state.payStep = 'method'; state.payMethod = null; }
  renderBillingStep();
}

function handleBillingConfirm() {
  if (state.payStep === 'bill') { state.payStep = 'method'; renderBillingStep(); }
  else if (state.payStep === 'qr') confirmTablePayment();
}

async function confirmTablePayment() {
  const table = state.payingTable; const method = state.payMethod;
  const bills = loadActiveBills(); const bill = bills[table];
  if (!bill) return;
  const total   = getActiveBillTotal(bill.items);
  const orderId = `RCP-${Date.now()}`;
  await saveOrderToHistory(table, bill.items, total, method);
  await clearActiveBill(table);
  closeBillingModal();
  updateTableBtn();
  const labels = { tng: 'Touch & Go', duitnow: 'DuitNow QR', cash: 'Cash' };
  showToast(`✓ Payment confirmed · ${table} · ${labels[method] || method}`);
  printPaymentReceipt(table, bill.items, total, method, orderId);
}

// ─── HISTORY MODAL ────────────────────────────────────────────────────────────

async function openHistoryModal() {
  const sel = document.getElementById('hist-table-filter');
  sel.innerHTML = '<option value="all">All Tables</option>';
  for (let i = 1; i <= 20; i++) {
    const o = document.createElement('option'); o.value = `T${i}`; o.textContent = `T${i}`;
    sel.appendChild(o);
  }
  sel.value = 'all';
  await renderHistoryList('all');
  document.getElementById('history-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function renderHistoryList(tableFilter) {
  let history = [];
  try {
    const res = await fetch(`${API_BASE}/api/history`);
    if (res.ok) history = await res.json();
  } catch (e) {
    // Fallback to localStorage
    try { const r = localStorage.getItem(HISTORY_KEY); history = r ? JSON.parse(r) : []; } catch (ex) {}
  }

  const list = tableFilter === 'all' ? history : history.filter(o => o.table === tableFilter);
  const body = document.getElementById('history-body');
  if (list.length === 0) { body.innerHTML = '<div class="empty-state">No orders found</div>'; return; }
  const payLabel = { tng: '💳 T&G', duitnow: '🏦 DuitNow', cash: '💵 Cash' };
  body.innerHTML = list.map(ord => {
    const d = new Date(ord.timestamp);
    const dateStr = d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
    return `<div class="hist-card">
      <div class="hist-card-head">
        <div class="hist-left">
          <span class="hist-table-badge">${ord.table}</span>
          <div class="hist-meta"><span class="hist-date">${dateStr}, ${timeStr}</span><span class="hist-pay">${payLabel[ord.paymentMethod] || ord.paymentMethod}</span></div>
        </div>
        <div class="hist-right">
          <span class="hist-total">RM ${ord.total.toFixed(2)}</span>
          <button class="hist-toggle-btn" data-id="${ord.id}">Details ▾</button>
        </div>
      </div>
      <div class="hist-detail hidden" id="hd-${ord.id}">
        <table class="hist-items-table">
          ${ord.items.map(oi => `<tr>
            <td class="hi-name">${oi.nameZh} <span class="hi-en">${oi.name}</span></td>
            <td class="hi-qty">×${oi.quantity}</td>
            <td class="hi-price">RM ${oi.subtotal.toFixed(2)}</td></tr>`).join('')}
        </table>
        <button class="reorder-btn" data-id="${ord.id}">↺ Re-order</button>
      </div></div>`;
  }).join('');

  body.querySelectorAll('.hist-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const detail = document.getElementById(`hd-${btn.dataset.id}`);
      const open = detail.classList.toggle('hidden') === false;
      btn.textContent = open ? 'Details ▴' : 'Details ▾';
    });
  });

  body.querySelectorAll('.reorder-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ord = history.find(o => o.id === btn.dataset.id);
      if (!ord) return;
      if (!state.tableNumber) { openTablePicker(true); return; }
      ord.items.forEach(hi => {
        const mi = menuItems.find(m => m.id === hi.menuItemId);
        if (mi && mi.isAvailable) addItem(mi, hi.selectedModifiers || [], hi.notes || '');
      });
      closeHistoryModal(); renderMenuList(); renderCartPanel();
      showToast('↺ Items added to order');
    });
  });
}

// ─── TOAST ────────────────────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.remove('hidden');
  toast.getBoundingClientRect(); toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.classList.add('hidden'), 280); }, 2200);
}

// ─── PRINT ORDER SLIP ─────────────────────────────────────────────────────────

function printOrderSlip(table, items, isUpdate) {
  const total    = items.reduce((s, i) => s + i.subtotal, 0);
  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr  = now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const settings = loadSettings();
  const shopName = settings.shopName || 'BKT House';

  const itemRows = items.map(item => {
    // state.items nest names under menuItem; billRow items have them at top level
    const nameZh = item.menuItem?.nameZh || item.nameZh || '';
    const nameEn = item.menuItem?.name   || item.name   || '';
    const mods   = (item.selectedModifiers || []).map(m => m.optionLabel).join(', ');
    const notes  = item.notes ? item.notes.trim() : '';
    return `
      <tr>
        <td class="td-qty">${item.quantity}</td>
        <td class="td-name">
          <div class="item-zh">${nameZh}</div>
          <div class="item-en">${nameEn}</div>
          ${mods  ? `<div class="item-mod">${mods}</div>`      : ''}
          ${notes ? `<div class="item-note">📝 ${notes}</div>` : ''}
        </td>
        <td class="td-price">RM ${item.subtotal.toFixed(2)}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Order Slip</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px;
         width: 80mm; margin: 0 auto; padding: 6px 8px 16px; color: #000; }
  .shop-name  { text-align:center; font-size:16px; font-weight:bold; margin-bottom:2px; }
  .shop-sub   { text-align:center; font-size:11px; color:#555; margin-bottom:6px; }
  .divider    { border:none; border-top:1px dashed #000; margin:6px 0; }
  .meta-row   { display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; }
  .label      { font-weight:bold; }
  .order-type { text-align:center; font-size:11px; font-weight:bold;
                border:1px solid #000; padding:2px 6px; margin:4px auto 6px;
                display:inline-block; }
  .order-type-wrap { text-align:center; }
  table       { width:100%; border-collapse:collapse; margin-top:4px; }
  .td-qty     { width:20px; vertical-align:top; padding:3px 2px; }
  .td-name    { vertical-align:top; padding:3px 4px; }
  .td-price   { width:70px; text-align:right; vertical-align:top; padding:3px 2px; }
  .item-zh    { font-size:13px; font-weight:bold; }
  .item-en    { font-size:11px; color:#333; }
  .item-mod   { font-size:10px; color:#555; font-style:italic; }
  .item-note  { font-size:10px; color:#555; }
  .total-row  { display:flex; justify-content:space-between;
                font-size:14px; font-weight:bold; margin-top:4px; }
  .footer     { text-align:center; font-size:10px; color:#777; margin-top:8px; }
  @media print {
    body { width:80mm; padding:0 4px 12px; }
    @page { size:80mm auto; margin:0; }
  }
</style></head><body>
  <div class="shop-name">${shopName}</div>
  <div class="shop-sub">Order Slip</div>
  <hr class="divider">
  <div class="meta-row"><span class="label">Table</span><span>${table}</span></div>
  <div class="meta-row"><span class="label">Date</span><span>${dateStr}</span></div>
  <div class="meta-row"><span class="label">Time</span><span>${timeStr}</span></div>
  <div class="order-type-wrap">
    <span class="order-type">${isUpdate ? 'ORDER UPDATE' : 'NEW ORDER'}</span>
  </div>
  <hr class="divider">
  <table><tbody>${itemRows}</tbody></table>
  <hr class="divider">
  <div class="total-row"><span>TOTAL</span><span>RM ${total.toFixed(2)}</span></div>
  <div class="footer">— Thank you —</div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=420,height=600,menubar=no,toolbar=no,location=no');
  if (!w) { showToast('⚠ Allow pop-ups to print order slip'); return; }
  w.document.write(html);
  w.document.close();
}

// ─── PAYMENT RECEIPT ──────────────────────────────────────────────────────────

function printPaymentReceipt(table, items, total, method, orderId) {
  const now        = new Date();
  const dateStr    = now.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr    = now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const settings   = loadSettings();
  const shopName   = settings.shopName || 'BKT House';
  const receiptNo  = orderId || `RCP-${Date.now()}`;
  const methodLabel = { tng: 'Touch & Go eWallet', duitnow: 'DuitNow QR', cash: 'Cash' };
  const payLabel   = methodLabel[method] || method;

  const itemRows = items.map(item => {
    const mods  = (item.selectedModifiers || []).map(m => m.optionLabel).join(', ');
    const notes = item.notes ? item.notes.trim() : '';
    return `
      <tr>
        <td class="td-qty">${item.quantity}</td>
        <td class="td-name">
          <div class="item-zh">${item.nameZh || ''}</div>
          <div class="item-en">${item.name || ''}</div>
          ${mods  ? `<div class="item-mod">${mods}</div>`      : ''}
          ${notes ? `<div class="item-note">📝 ${notes}</div>` : ''}
        </td>
        <td class="td-price">RM&nbsp;${item.subtotal.toFixed(2)}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Receipt</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New', monospace; font-size:12px;
         width:80mm; margin:0 auto; padding:6px 8px 20px; color:#000; }
  .shop-name  { text-align:center; font-size:16px; font-weight:bold; margin-bottom:2px; }
  .shop-sub   { text-align:center; font-size:10px; color:#555; margin-bottom:2px; }
  .receipt-lbl{ text-align:center; font-size:13px; font-weight:bold;
                letter-spacing:3px; margin:4px 0; }
  .divider    { border:none; border-top:1px dashed #000; margin:5px 0; }
  .meta-row   { display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; }
  .meta-row .lbl { font-weight:bold; }
  table       { width:100%; border-collapse:collapse; margin:2px 0; }
  .td-qty     { width:20px; vertical-align:top; padding:3px 2px; }
  .td-name    { vertical-align:top; padding:3px 4px; }
  .td-price   { width:72px; text-align:right; vertical-align:top; padding:3px 2px;
                white-space:nowrap; }
  .item-zh    { font-size:13px; font-weight:bold; }
  .item-en    { font-size:11px; color:#333; }
  .item-mod   { font-size:10px; color:#555; font-style:italic; }
  .item-note  { font-size:10px; color:#555; }
  .summary    { margin-top:2px; }
  .sum-row    { display:flex; justify-content:space-between; font-size:11px; padding:1px 0; }
  .sum-row.total { font-size:15px; font-weight:bold; padding-top:4px; border-top:1px solid #000; margin-top:3px; }
  .pay-row    { display:flex; justify-content:space-between; font-size:11px; margin-top:4px; }
  .pay-row .lbl { font-weight:bold; }
  .footer     { text-align:center; font-size:10px; color:#777; margin-top:10px; line-height:1.6; }
  @media print {
    body { width:80mm; padding:0 4px 16px; }
    @page { size:80mm auto; margin:0; }
  }
</style></head><body>
  <div class="shop-name">${shopName}</div>
  <div class="shop-sub">Official Receipt</div>
  <div class="receipt-lbl">RECEIPT</div>
  <hr class="divider">
  <div class="meta-row"><span class="lbl">Receipt No</span><span>${receiptNo}</span></div>
  <div class="meta-row"><span class="lbl">Table</span><span>${table}</span></div>
  <div class="meta-row"><span class="lbl">Date</span><span>${dateStr}</span></div>
  <div class="meta-row"><span class="lbl">Time</span><span>${timeStr}</span></div>
  <hr class="divider">
  <table><tbody>${itemRows}</tbody></table>
  <hr class="divider">
  <div class="summary">
    <div class="sum-row"><span>Subtotal</span><span>RM&nbsp;${total.toFixed(2)}</span></div>
    <div class="sum-row total"><span>TOTAL</span><span>RM&nbsp;${total.toFixed(2)}</span></div>
  </div>
  <hr class="divider">
  <div class="pay-row"><span class="lbl">Payment</span><span>${payLabel}</span></div>
  <div class="footer">
    Thank you for dining with us!<br>
    Please come again ☺
  </div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=420,height=650,menubar=no,toolbar=no,location=no');
  if (!w) { showToast('⚠ Allow pop-ups to print receipt'); return; }
  w.document.write(html);
  w.document.close();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  // ── Step 1: Load from localStorage immediately so UI renders right away ──
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    menuItems = saved ? JSON.parse(saved) : [...MENU_ITEMS];
    if (!saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(menuItems));
  } catch (e) { menuItems = [...MENU_ITEMS]; }

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderMenuList();
  });

  // Table picker
  document.getElementById('table-select-btn').addEventListener('click', () => openTablePicker(false));
  document.getElementById('table-picker-close').addEventListener('click', closeTablePicker);
  document.getElementById('table-picker-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget && state.tableNumber) closeTablePicker();
  });

  // Cart panel: clear + send
  document.getElementById('cp-clear-btn').addEventListener('click', () => {
    if (state.items.length === 0) return;
    if (!confirm('Clear all items?')) return;
    clearOrder(); renderCartPanel(); renderMenuList();
  });

  document.getElementById('send-btn').addEventListener('click', async () => {
    if (state.items.length === 0) return;
    if (!state.tableNumber) { openTablePicker(true); return; }
    const sentTable   = state.tableNumber;
    const wasEditing  = state.editingActiveBill === sentTable;
    const slipItems   = state.items.map(i => ({ ...i })); // snapshot before clear
    try {
      if (wasEditing) {
        await setActiveBill(sentTable, state.items);
      } else {
        await addToActiveBill(sentTable, state.items);
      }
      clearOrder();
      state.tableNumber       = null;
      state.editingActiveBill = null;
      renderCartPanel();
      renderMenuList();
      updateTableBtn();
      showToast(wasEditing ? `✓ Order updated · ${sentTable}` : `✓ Order sent to kitchen · ${sentTable}`);
      printOrderSlip(sentTable, slipItems, wasEditing);
    } catch (e) {
      showToast('Error sending order — please try again');
    }
  });

  // Modifier modal
  document.getElementById('modal-close-btn').addEventListener('click', closeModifierModal);
  document.getElementById('modifier-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModifierModal();
  });

  document.getElementById('modal-add-btn').addEventListener('click', () => {
    const item = state.modalItem; if (!item) return;
    const groups = item.modifierGroups || [];
    if (groups.some(g => g.required && !state.modalSelections[g.id])) return;
    const modifiers = groups
      .filter(g => state.modalSelections[g.id])
      .map(g => {
        const opt = g.options.find(o => o.id === state.modalSelections[g.id]);
        return { groupId: g.id, groupName: g.name, optionId: opt.id,
                 optionLabel: opt.label, priceAdjustment: opt.priceAdjustment };
      });
    if (state.editingOrderItemId) {
      amendItem(state.editingOrderItemId, modifiers, state.modalNotes);
    } else {
      addItem(item, modifiers, state.modalNotes);
    }
    closeModifierModal(); renderCartPanel(); renderMenuList();
  });

  // Pay bills
  document.getElementById('pay-bills-btn').addEventListener('click', openBillingModal);
  document.getElementById('pay-close-btn').addEventListener('click', closeBillingModal);
  document.getElementById('payment-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeBillingModal();
  });
  document.getElementById('pay-back-btn').addEventListener('click', handleBillingBack);
  document.getElementById('pay-confirm-btn').addEventListener('click', handleBillingConfirm);

  // History
  document.getElementById('history-btn').addEventListener('click', openHistoryModal);
  document.getElementById('hist-close-btn').addEventListener('click', closeHistoryModal);
  document.getElementById('history-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHistoryModal();
  });
  document.getElementById('hist-table-filter').addEventListener('change', e => {
    renderHistoryList(e.target.value);
  });

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('modifier-modal').classList.contains('hidden')) closeModifierModal();
    else if (!document.getElementById('payment-modal').classList.contains('hidden')) closeBillingModal();
    else if (!document.getElementById('history-modal').classList.contains('hidden')) closeHistoryModal();
    else if (!document.getElementById('table-picker-modal').classList.contains('hidden') && state.tableNumber)
      closeTablePicker();
  });

  renderCategoryBar();
  renderMenuList();
  renderCartPanel();
  updateTableBtn();

  // If navigated from orders page with ?table=T3, load that bill for editing
  const editParam = new URLSearchParams(location.search).get('table');
  if (editParam) {
    history.replaceState({}, '', location.pathname);
    await loadTableOrderToCart(editParam);
  }

  // ── Step 2: Background sync from API (non-blocking, updates cache if server available) ──
  if (location.host) {
    // Refresh menu from API
    fetch(`${API_BASE}/api/menu`).then(r => r.ok ? r.json() : null).then(apiMenu => {
      if (apiMenu && apiMenu.length > 0) {
        menuItems = apiMenu;
        renderCategoryBar();
        renderMenuList();
      } else if (apiMenu !== null) {
        // API has no menu yet — seed it
        fetch(`${API_BASE}/api/menu`, { method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(menuItems) }).catch(() => {});
      }
    }).catch(() => {});

    // Refresh bills from API
    fetchBillsFromAPI().then(() => updateTableBtn()).catch(() => {});

    // Sync settings from API
    fetch(`${API_BASE}/api/settings`).then(r => r.ok ? r.json() : null).then(s => {
      if (s && Object.keys(s).length > 0) localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }).catch(() => {});

    // Connect WebSocket
    connectWS();
  }

  // Listen for status updates from KDS and other tabs
  if (bktChannel) {
    bktChannel.onmessage = e => {
      const { type } = e.data;
      if (['status:updated', 'order:new', 'order:updated', 'bill:cleared'].includes(type)) {
        syncBillsFromStorage();
      }
    };
  }

  // storage event: fires when another tab (e.g. maintenance) writes to localStorage
  window.addEventListener('storage', e => {
    if (e.key === ACTIVE_BILLS_KEY) syncBillsFromStorage();
  });

  // visibilitychange: re-sync when user navigates back to this tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncBillsFromStorage();
  });
}

function syncBillsFromStorage() {
  refreshBillsCache();
  updateTableBtn();
  updateCartPanelHeader();
}

document.addEventListener('DOMContentLoaded', init);
