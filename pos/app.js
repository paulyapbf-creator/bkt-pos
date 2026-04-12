'use strict';
// CATEGORIES, MENU_ITEMS and STORAGE_KEY come from menuDefaults.js

const HISTORY_KEY      = 'bkt_order_history';
const SETTINGS_KEY     = 'bkt_settings';

const LANG_NAME_FIELDS = { en: 'name', zh: 'nameZh', th: 'nameTh', vi: 'nameVi', ms: 'nameMs', km: 'nameKm', id: 'nameId' };
function localName(item) {
  if (typeof getLang === 'function') {
    const field = LANG_NAME_FIELDS[getLang()];
    if (field && item[field]) return item[field];
  }
  return item.nameZh || item.name || '';
}
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
    const _t = typeof getTenantSession === 'function' ? getTenantSession() : null;
    posWS.send(JSON.stringify({ type: 'register', role: 'pos', tenantSlug: _t ? _t.slug : '_default' }));
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
        showToast(`🍳 ${localName(msg.item)} ${t('item_ready')} · ${msg.table}`);
      }
      break;

    case 'table:allReady':
      showToast(t('all_items_ready', { table: msg.table }));
      break;

    case 'order:new':
    case 'order:updated':
      if (msg.bill) billsCache[msg.table] = msg.bill;
      syncBillsToStorage();
      break;

    case 'bill:allServed':
      // Kitchen served all items. Bill stays active — update statuses so the
      // POS reflects the served state and can still collect payment.
      if (billsCache[msg.table]) {
        billsCache[msg.table].items.forEach(i => { i.status = 'served'; });
        syncBillsToStorage();
        updateTableBtn();
      }
      showToast(t('all_items_served', { table: msg.table }));
      break;

    case 'bill:cleared':
      delete billsCache[msg.table];
      syncBillsToStorage();
      break;

    case 'admin:refresh':
      showToast(t('admin_reloading'));
      setTimeout(() => location.reload(), 1500);
      break;
  }
}

// ─── STATE ────────────────────────────────────────────────────────────────────

let menuItems = [];

const state = {
  tableNumber:        null,
  pax:                1,
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
    if (q) return item.name.toLowerCase().includes(q) || (item.nameZh || '').includes(q) ||
                   localName(item).toLowerCase().includes(q) || (item.description && item.description.toLowerCase().includes(q));
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
    nameZh: oi.menuItem.nameZh, nameTh: oi.menuItem.nameTh, nameVi: oi.menuItem.nameVi,
    nameMs: oi.menuItem.nameMs, nameKm: oi.menuItem.nameKm, nameId: oi.menuItem.nameId,
    name: oi.menuItem.name,
    quantity: oi.quantity, unitPrice: oi.unitPrice, subtotal: oi.subtotal,
    selectedModifiers: oi.selectedModifiers, notes: oi.notes,
    status: existingStatus || 'cooking',
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

function calcBillBreakdown(subtotal, settings) {
  const sst = settings.sstEnabled ? +(subtotal * (parseFloat(settings.sstRate) || 6) / 100).toFixed(2) : 0;
  const svc = settings.svcEnabled ? +(subtotal * (parseFloat(settings.svcRate) || 10) / 100).toFixed(2) : 0;
  return { subtotal, sst, svc, sstRate: parseFloat(settings.sstRate) || 6, svcRate: parseFloat(settings.svcRate) || 10, total: +(subtotal + sst + svc).toFixed(2) };
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
  const btns = [document.getElementById('table-select-btn'), document.getElementById('mobile-table-btn')].filter(Boolean);
  const bills  = loadActiveBills();
  const hasAct = state.tableNumber && !!bills[state.tableNumber];
  btns.forEach(btn => {
    if (state.tableNumber) {
      btn.innerHTML = `${state.tableNumber}${hasAct ? ' <span class="tbl-dot">●</span>' : ''} <span class="tbl-arrow">▾</span>`;
    } else {
      btn.innerHTML = `${t('select_table')} <span class="tbl-arrow">▾</span>`;
    }
    btn.classList.toggle('tbl-btn-no-table',    !state.tableNumber);
    btn.classList.toggle('tbl-btn-active-bill',  !!hasAct);
  });
  // Sync mobile pax display
  const mp = document.getElementById('mobile-pax-display');
  if (mp) mp.textContent = state.pax;
}

// ─── RENDER: Cart panel (left) ────────────────────────────────────────────────

function updateCartPanelHeader() {
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.textContent = state.editingActiveBill ? t('update_kitchen_order') : t('send_to_kitchen');
}

function renderCartPanel() {
  updateCartPanelHeader();

  const total    = totalPrice();
  const hasItems = state.items.length > 0;

  document.getElementById('cp-total').textContent = `${getCurrency()} ${total.toFixed(2)}`;
  document.getElementById('cp-item-count').textContent =
    hasItems ? `${totalItems()} item${totalItems() !== 1 ? 's' : ''}` : '';

  // Mobile basket bar — always visible, positioned at search bar level
  const mb = document.getElementById('mobile-basket-bar');
  if (mb) {
    mb.classList.remove('hidden');
    document.getElementById('mobile-basket-count').textContent = totalItems();
    document.getElementById('mobile-basket-total').textContent = `${getCurrency()} ${total.toFixed(2)}`;
    mb.classList.toggle('mobile-basket-empty', !hasItems);
    // Position at search bar level
    const sw = document.getElementById('search-wrap');
    if (sw && window.innerWidth <= 640) {
      const rect = sw.getBoundingClientRect();
      mb.style.top = rect.top + 'px';
      mb.style.height = rect.height + 'px';
      mb.style.display = 'inline-flex';
      mb.style.alignItems = 'center';
    }
  }

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
    const catName = typeof t === 'function' ? t('cat_' + cat) : (CATEGORIES.find(c => c.id === cat)?.name || cat);
    let divider   = '';
    if (cat !== lastCat) { divider = `<div class="cp-cat-divider">${catName}</div>`; lastCat = cat; }
    return `${divider}
      <div class="cp-item">
        <div class="cp-item-top">
          <span class="cp-item-zh">${localName(oi.menuItem)}</span>
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
          <span class="cp-item-price">${getCurrency()} ${oi.subtotal.toFixed(2)}</span>
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
      ${typeof t === 'function' ? t('cat_' + cat.id) : cat.name}
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
    list.innerHTML = `<div class="mli-empty">${t('no_items_found')}</div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const count   = cartCountForMenuItem(item.id);
    const hasMods = item.modifierGroups && item.modifierGroups.length > 0;
    return `
      <button class="mli${count > 0 ? ' mli--in-cart' : ''}" data-id="${item.id}">
        ${count > 0 ? `<span class="mli-badge">${count}</span>` : ''}
        <span class="mli-zh">${localName(item)}${item.isPopular ? ' <span class="mli-star">★</span>' : ''}</span>
        <span class="mli-price">${getCurrency()} ${item.price.toFixed(2)}</span>
        <span class="mli-en">${item.name}${hasMods ? ' <span class="mli-opts">+Options</span>' : ''}</span>
      </button>`;
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
  document.getElementById('modal-name-zh').textContent = localName(item);
  document.getElementById('modal-name-en').textContent = item.name;
  document.getElementById('modal-add-btn').textContent =
    state.editingOrderItemId ? t('update_order') : t('add_to_order');

  let html = '';
  if (item.descriptionZh) html += `<p class="modal-desc-zh">${item.descriptionZh}</p>`;
  if (item.description)   html += `<p class="modal-desc">${item.description}</p>`;

  groups.forEach(group => {
    html += `
      <div class="modifier-group">
        <div class="group-header">
          <span class="group-name-zh">${localName(group)}</span>
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
              ? `<span class="option-price">${opt.priceAdjustment > 0 ? '+' : ''}${getCurrency()} ${opt.priceAdjustment.toFixed(2)}</span>`
              : ''}
          </div>`).join('')}
      </div>`;
  });

  html += `
    <div class="modifier-group">
      <div class="group-header"><span class="group-name-zh">备注 / Notes</span></div>
      <textarea id="modal-notes-input" placeholder="${t('special_requests')}" rows="2"></textarea>
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
  document.getElementById('modal-price').textContent = `${getCurrency()} ${(item.price + adj).toFixed(2)}`;
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
  document.getElementById('modal-add-btn').textContent = t('add_to_order');
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
  destroyAirwallexElement();
  if (_duitnowPollController) { try { _duitnowPollController.abort(); } catch {} _duitnowPollController = null; }
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
    titleEl.textContent = t('unpaid_bills'); subEl.textContent = '';
    const bills = loadActiveBills(); const tables = Object.keys(bills);
    if (tables.length === 0) { bodyEl.innerHTML = `<div class="empty-state">${t('no_unpaid_bills')}</div>`; return; }
    const billSettings = loadSettings();
    bodyEl.innerHTML = tables.map(table => {
      const bill = bills[table]; const subtotal = getActiveBillTotal(bill.items);
      const bd = calcBillBreakdown(subtotal, billSettings);
      const itemQty = bill.items.reduce((s, i) => s + i.quantity, 0);
      const timeStr = new Date(bill.startedAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
      return `<div class="bill-card">
        <div class="bill-card-left">
          <span class="hist-table-badge">${table}</span>
          <div class="bill-meta"><span class="bill-items">${itemQty} item${itemQty > 1 ? 's' : ''}</span><span class="bill-since">Since ${timeStr}</span></div>
        </div>
        <div class="bill-card-right">
          <span class="bill-total">${getCurrency()} ${bd.total.toFixed(2)}</span>
          <button class="pay-table-btn" data-table="${table}">Pay ▶</button>
        </div></div>`;
    }).join('');
    bodyEl.querySelectorAll('.pay-table-btn').forEach(btn => {
      btn.addEventListener('click', () => { state.payingTable = btn.dataset.table; state.payStep = 'bill'; renderBillingStep(); });
    });

  } else if (state.payStep === 'bill') {
    const table = state.payingTable; const bills = loadActiveBills(); const bill = bills[table];
    if (!bill) { state.payStep = 'list'; renderBillingStep(); return; }
    const subtotal = getActiveBillTotal(bill.items); const billSettings = loadSettings();
    const bd = calcBillBreakdown(subtotal, billSettings);
    const itemQty = bill.items.reduce((s, i) => s + i.quantity, 0);
    titleEl.textContent = `${t('bill')} — ${table}`; subEl.textContent = `${itemQty} ${t('item_s')}`;
    let breakdownRows = `<tr class="bill-total-row"><td colspan="2" class="bill-total-label">${t('subtotal')}</td><td class="bill-total-amt">${getCurrency()} ${bd.subtotal.toFixed(2)}</td></tr>`;
    if (bd.sst) breakdownRows += `<tr class="bill-total-row"><td colspan="2" class="bill-total-label">${t('sst')} (${bd.sstRate}%)</td><td class="bill-total-amt">${getCurrency()} ${bd.sst.toFixed(2)}</td></tr>`;
    if (bd.svc) breakdownRows += `<tr class="bill-total-row"><td colspan="2" class="bill-total-label">${t('service')} (${bd.svcRate}%)</td><td class="bill-total-amt">${getCurrency()} ${bd.svc.toFixed(2)}</td></tr>`;
    breakdownRows += `<tr class="bill-total-row" style="font-size:1.1em;"><td colspan="2" class="bill-total-label" style="font-weight:bold;">${t('total')}</td><td class="bill-total-amt" style="font-weight:bold;">${getCurrency()} ${bd.total.toFixed(2)}</td></tr>`;
    bodyEl.innerHTML = `<table class="hist-items-table bill-table">
      ${bill.items.map(bi => `<tr>
        <td class="hi-name">${localName(bi)} <span class="hi-en">${bi.name}</span>
          ${bi.selectedModifiers && bi.selectedModifiers.length ? `<span class="hi-mods">${bi.selectedModifiers.map(m => m.optionLabel).join(', ')}</span>` : ''}
        </td>
        <td class="hi-qty">×${bi.quantity}</td><td class="hi-price">${getCurrency()} ${bi.subtotal.toFixed(2)}</td></tr>`).join('')}
      ${breakdownRows}
    </table>`;
    confirmBtn.textContent = t('proceed_to_payment'); confirmBtn.classList.remove('hidden');

  } else if (state.payStep === 'method') {
    const bills = loadActiveBills(); const subtotal = bills[state.payingTable] ? getActiveBillTotal(bills[state.payingTable].items) : 0;
    const settings = loadSettings();
    const bd = calcBillBreakdown(subtotal, settings);
    titleEl.textContent = t('select_payment'); subEl.textContent = `${state.payingTable} · ${getCurrency()} ${bd.total.toFixed(2)}`;
    const cardConfigured = settings.airwallexEnabled && settings.airwallexClientId && settings.airwallexApiKey;
    const tngEnabled = settings.tngEnabled !== false; // default on
    const duitnowEnabled = !!settings.duitnowEnabled;
    bodyEl.innerHTML = `<div class="pay-methods">
      ${tngEnabled ? `<button class="pay-method-btn" data-method="tng"><span class="pay-icon">💳</span><span class="pay-name">${t('tng_ewallet')}</span></button>` : ''}
      ${duitnowEnabled ? `<button class="pay-method-btn" data-method="duitnow"><span class="pay-icon">🏦</span><span class="pay-name">${t('duitnow')}</span></button>` : ''}
      ${cardConfigured ? `<button class="pay-method-btn" data-method="card"><span class="pay-icon">💳</span><span class="pay-name">${t('credit_card')}</span></button>` : ''}
      <button class="pay-method-btn" data-method="cash"><span class="pay-icon">💵</span><span class="pay-name">${t('cash')}</span></button>
    </div>`;
    bodyEl.querySelectorAll('.pay-method-btn').forEach(btn => {
      btn.addEventListener('click', () => { state.payMethod = btn.dataset.method; state.payStep = 'qr'; renderBillingStep(); });
    });

  } else if (state.payStep === 'qr') {
    const bills = loadActiveBills(); const subtotal = bills[state.payingTable] ? getActiveBillTotal(bills[state.payingTable].items) : 0;
    const method = state.payMethod; const settings = loadSettings();
    const bd = calcBillBreakdown(subtotal, settings);
    const titles = { tng: t('tng_ewallet'), duitnow: t('duitnow'), cash: t('cash'), card: t('credit_card') };
    titleEl.textContent = titles[method] || method; subEl.textContent = `${state.payingTable} · ${getCurrency()} ${bd.total.toFixed(2)}`;
    let body = '';
    const payLink = method === 'tng' ? (settings.tngPayLink || '') : '';
    if (method === 'tng') {
      const qrImgUrl = settings.tngQrUrl || '';
      if (payLink) {
        body = `<div class="qr-container"><div id="pay-qr-el" style="display:inline-block;"></div></div>`;
      } else if (qrImgUrl) {
        body = `<div class="qr-container"><img src="${qrImgUrl}" class="qr-img" alt="QR"></div>`;
      } else {
        body = `<div class="qr-placeholder">${t('no_qr_configured')}<br>${t('go_to_settings')}</div>`;
      }
      if (payLink) {
        body += `<div class="pay-link-row" style="text-align:center;margin:10px 0;">
          <a href="${payLink}" target="_blank" style="color:#3498db;font-size:14px;text-decoration:underline;">Open Payment Link ↗</a>
        </div>`;
      }
      body += `<div class="pay-amount-row"><span class="pay-amount-label">Amount to Pay</span><span class="pay-amount">${getCurrency()} ${bd.total.toFixed(2)}</span></div>`;
      body += `<div style="text-align:center;margin:8px 0 4px;padding:8px 12px;background:#fff3cd;border-radius:8px;font-size:13px;color:#856404;">⚠️ Verify <b>${getCurrency()} ${bd.total.toFixed(2)}</b> received in TNG app before confirming</div>`;
    } else if (method === 'duitnow') {
      // Dynamic DuitNow QR via wallet gateway
      body = `<div class="qr-container"><div id="pay-qr-el" style="display:inline-block;"><div class="card-spinner"></div><div style="color:var(--muted);font-size:13px;margin-top:8px;">Creating DuitNow transaction...</div></div></div>`;
      body += `<div class="pay-amount-row"><span class="pay-amount-label">Amount to Pay</span><span class="pay-amount">${getCurrency()} ${bd.total.toFixed(2)}</span></div>`;
      body += `<div id="duitnow-status" style="text-align:center;margin:8px 0 4px;padding:8px 12px;background:#fff3cd;border-radius:8px;font-size:13px;color:#856404;">Waiting for customer to scan QR…</div>`;
    } else if (method === 'card') {
      body = `<div class="card-pay-container">
        <div class="card-pay-loading" id="card-loading"><div class="card-spinner"></div><div>Setting up card payment...</div></div>
        <div id="airwallex-dropin"></div>
        <div class="card-pay-error hidden" id="card-error"><span id="card-error-msg"></span><button class="retry-btn" id="card-retry-btn">Retry</button></div>
      </div>`;
    } else {
      body = `<div class="cash-pay-display"><div class="cash-pay-label">Amount to Collect</div><div class="cash-pay-amount">${getCurrency()} ${bd.total.toFixed(2)}</div></div>`;
    }
    bodyEl.innerHTML = body;
    // Render QR code from payment link
    const qrEl = document.getElementById('pay-qr-el');
    if (method === 'tng' && qrEl && payLink && typeof qrcode === 'function') {
      try {
        const qr = qrcode(0, 'M'); qr.addData(payLink); qr.make();
        qrEl.innerHTML = qr.createSvgTag(6, 0);
        qrEl.querySelector('svg').style.cssText = 'width:220px;height:220px;border-radius:12px;';
      } catch (e) { console.error('QR render error:', e); }
    }
    // Initialize Airwallex card payment
    if (method === 'card') {
      confirmBtn.classList.add('hidden');
      initAirwallexPayment(bd.total, state.payingTable, settings, bd);
    } else if (method === 'duitnow') {
      confirmBtn.textContent = t('payment_received');
      confirmBtn.classList.remove('hidden');
      initDuitNowPayment(bd.total, state.payingTable, settings);
    } else {
      confirmBtn.textContent = method === 'cash' ? t('confirm_cash') : t('payment_received');
      confirmBtn.classList.remove('hidden');
    }

  } else if (state.payStep === 'verify') {
    const bills = loadActiveBills(); const subtotal = bills[state.payingTable] ? getActiveBillTotal(bills[state.payingTable].items) : 0;
    const settings = loadSettings(); const bd = calcBillBreakdown(subtotal, settings);
    titleEl.textContent = t('verify_receipt'); subEl.textContent = `${state.payingTable} · ${getCurrency()} ${bd.total.toFixed(2)}`;

    bodyEl.innerHTML = `
      <div class="verify-container">
        <div class="verify-expected">Expected: <strong>${getCurrency()} ${bd.total.toFixed(2)}</strong></div>
        <div class="verify-capture-area">
          <label class="verify-capture-btn">
            📷 Take Photo of Receipt
            <input type="file" id="verify-camera-input" accept="image/*" capture="environment" style="display:none;">
          </label>
          <label class="verify-upload-btn">
            📁 Upload Image
            <input type="file" id="verify-file-input" accept="image/*" style="display:none;">
          </label>
        </div>
        <div id="verify-preview-wrap" class="verify-preview-wrap hidden">
          <img id="verify-preview-img" class="verify-preview-img" alt="Receipt">
        </div>
        <div id="verify-progress" class="verify-progress hidden">
          <div class="verify-spinner"></div>
          <span id="verify-progress-text">Processing OCR...</span>
        </div>
        <div id="verify-result" class="verify-result hidden"></div>
        <button id="verify-skip-btn" class="verify-skip-btn">Skip Verification →</button>
      </div>`;

    confirmBtn.textContent = t('confirm_payment');
    confirmBtn.classList.add('hidden');

    const expectedTotal = bd.total;
    const cameraInput = document.getElementById('verify-camera-input');
    const fileInput = document.getElementById('verify-file-input');
    const skipBtn = document.getElementById('verify-skip-btn');

    function handleReceiptFile(e) {
      const file = e.target.files[0];
      if (file) processReceiptImage(file, expectedTotal, confirmBtn);
    }
    cameraInput.addEventListener('change', handleReceiptFile);
    fileInput.addEventListener('change', handleReceiptFile);
    skipBtn.addEventListener('click', () => confirmTablePayment());
  }
}

async function processReceiptImage(file, expectedTotal, confirmBtn) {
  const previewWrap = document.getElementById('verify-preview-wrap');
  const previewImg = document.getElementById('verify-preview-img');
  const progressEl = document.getElementById('verify-progress');
  const progressText = document.getElementById('verify-progress-text');
  const resultEl = document.getElementById('verify-result');

  // Show preview
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewWrap.classList.remove('hidden');

  // Show progress
  progressEl.classList.remove('hidden');
  resultEl.classList.add('hidden');
  progressText.textContent = t('processing_ocr');

  try {
    const { data } = await Tesseract.recognize(file, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          progressText.textContent = `OCR: ${Math.round((m.progress || 0) * 100)}%`;
        }
      }
    });

    progressEl.classList.add('hidden');
    const text = data.text;

    // Extract RM amounts
    const amountRegex = /RM\s*([\d,]+\.?\d{0,2})/gi;
    const amounts = [];
    let match;
    while ((match = amountRegex.exec(text)) !== null) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) amounts.push(val);
    }

    resultEl.classList.remove('hidden');

    if (amounts.length === 0) {
      // No amounts found
      resultEl.className = 'verify-result verify-result--warn';
      resultEl.innerHTML = `<div class="verify-result-icon">⚠️</div>
        <div class="verify-result-text">No RM amounts detected in receipt.</div>
        <div class="verify-result-hint">You can still confirm payment.</div>`;
      confirmBtn.textContent = t('confirm_payment');
      confirmBtn.classList.remove('hidden');
    } else {
      // Find closest amount to expected
      let closest = amounts[0];
      let minDiff = Math.abs(amounts[0] - expectedTotal);
      for (const amt of amounts) {
        const diff = Math.abs(amt - expectedTotal);
        if (diff < minDiff) { minDiff = diff; closest = amt; }
      }

      if (minDiff <= 0.01) {
        // Match
        resultEl.className = 'verify-result verify-result--match';
        resultEl.innerHTML = `<div class="verify-result-icon">✅</div>
          <div class="verify-result-text">Amount matches: <strong>${getCurrency()} ${closest.toFixed(2)}</strong></div>`;
        confirmBtn.textContent = t('confirm_payment');
        confirmBtn.classList.remove('hidden');
      } else {
        // Mismatch
        resultEl.className = 'verify-result verify-result--mismatch';
        resultEl.innerHTML = `<div class="verify-result-icon">❌</div>
          <div class="verify-result-text">Amount mismatch: receipt shows <strong>${getCurrency()} ${closest.toFixed(2)}</strong>, expected <strong>${getCurrency()} ${expectedTotal.toFixed(2)}</strong></div>
          <div class="verify-result-hint">Difference: ${getCurrency()} ${Math.abs(closest - expectedTotal).toFixed(2)}</div>`;
        confirmBtn.textContent = t('confirm_anyway');
        confirmBtn.classList.remove('hidden');
      }
    }
  } catch (err) {
    progressEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    resultEl.className = 'verify-result verify-result--warn';
    resultEl.innerHTML = `<div class="verify-result-icon">⚠️</div>
      <div class="verify-result-text">OCR failed: ${err.message}</div>
      <div class="verify-result-hint">You can still confirm payment.</div>`;
    confirmBtn.textContent = t('confirm_payment');
    confirmBtn.classList.remove('hidden');
  }
}

function handleBillingBack() {
  if (state.payStep === 'bill')        { state.payStep = 'list';   state.payingTable = null; }
  else if (state.payStep === 'method')   state.payStep = 'bill';
  else if (state.payStep === 'qr')     { destroyAirwallexElement(); state.payStep = 'method'; state.payMethod = null; }
  else if (state.payStep === 'verify') { state.payStep = 'qr'; }
  renderBillingStep();
}

function handleBillingConfirm() {
  if (state.payStep === 'bill') { state.payStep = 'method'; renderBillingStep(); }
  else if (state.payStep === 'qr') confirmTablePayment();
}

// ─── AIRWALLEX CARD PAYMENT ───────────────────────────────────────────────────

let airwallexElement = null;

// ─── DUITNOW PAYMENT (via wallet gateway) ──────────────────────────────────

let _duitnowPollController = null;
let _duitnowRefNo = null;

async function initDuitNowPayment(amount, table, settings) {
  const qrEl = document.getElementById('pay-qr-el');
  const statusEl = document.getElementById('duitnow-status');
  if (!qrEl) return;

  const profile = settings.duitnowProfile || '';
  const terminalCode = settings.duitnowTerminal || '';

  if (!settings.walletUrl) {
    qrEl.innerHTML = `<div style="color:var(--red);padding:40px;">Wallet URL not configured.<br>Go to Items → System Settings.</div>`;
    return;
  }
  if (!profile) {
    qrEl.innerHTML = `<div style="color:var(--red);padding:40px;">No payment profile selected.<br>Go to Items → System Settings.</div>`;
    return;
  }

  // Cancel any previous polling
  if (_duitnowPollController) { try { _duitnowPollController.abort(); } catch {} _duitnowPollController = null; }

  const referenceNo = `${table}-${Date.now()}`;
  _duitnowRefNo = referenceNo;

  try {
    const body = { tenantId: profile, amount: parseFloat(amount.toFixed(2)), referenceNo };
    if (terminalCode) body.terminalCode = terminalCode;

    const res = await fetch(`${API_BASE}/api/wallet/duitnow/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      qrEl.innerHTML = `<div style="color:var(--red);padding:40px;">Failed: ${data.message || data.error || 'Unknown error'}</div>`;
      if (statusEl) statusEl.style.display = 'none';
      return;
    }

    // Render QR from returned EMV data
    if (data.qrData && typeof qrcode === 'function') {
      try {
        const qr = qrcode(0, 'M'); qr.addData(data.qrData); qr.make();
        qrEl.innerHTML = qr.createSvgTag(6, 0);
        const svg = qrEl.querySelector('svg');
        if (svg) svg.style.cssText = 'width:260px;height:260px;border-radius:12px;background:#fff;padding:8px;';
      } catch (e) {
        // Fallback to image endpoint via proxy
        qrEl.innerHTML = `<img src="${API_BASE}/api/wallet/qr?data=${encodeURIComponent(data.qrData)}" style="width:260px;height:260px;border-radius:12px;background:#fff;padding:8px;">`;
      }
    } else {
      qrEl.innerHTML = `<img src="${API_BASE}/api/wallet/qr?data=${encodeURIComponent(data.qrData || '')}" style="width:260px;height:260px;border-radius:12px;background:#fff;padding:8px;">`;
    }

    // Start polling for status
    _duitnowPollController = new AbortController();
    pollDuitNowStatus(profile, referenceNo, _duitnowPollController.signal);
  } catch (e) {
    qrEl.innerHTML = `<div style="color:var(--red);padding:40px;">Error: ${e.message}</div>`;
    if (statusEl) statusEl.style.display = 'none';
  }
}

async function pollDuitNowStatus(tenantId, referenceNo, signal) {
  const statusEl = document.getElementById('duitnow-status');
  try {
    const res = await fetch(`${API_BASE}/api/wallet/duitnow/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, referenceNo, intervalMs: 3000, maxAttempts: 120 }),
      signal,
    });
    const data = await res.json();
    if (data.success && (data.status === 'success' || data.paymentStatus === 'success')) {
      if (statusEl) {
        statusEl.textContent = '✅ Payment received! Confirming…';
        statusEl.style.background = '#d4edda';
        statusEl.style.color = '#155724';
      }
      // Auto-confirm the payment
      setTimeout(() => { if (state.payStep === 'qr' && state.payMethod === 'duitnow') confirmTablePayment(); }, 800);
    } else {
      if (statusEl) {
        statusEl.textContent = `⚠️ ${data.message || 'Payment not completed'}`;
        statusEl.style.background = '#f8d7da';
        statusEl.style.color = '#721c24';
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (statusEl) statusEl.textContent = `Polling error: ${e.message}`;
  }
}

async function initAirwallexPayment(amount, table, settings, bd) {
  const loadingEl = document.getElementById('card-loading');
  const errorEl   = document.getElementById('card-error');
  const errorMsg  = document.getElementById('card-error-msg');
  const retryBtn  = document.getElementById('card-retry-btn');

  function showError(msg) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) { errorEl.classList.remove('hidden'); errorMsg.textContent = msg; }
  }

  if (retryBtn) retryBtn.addEventListener('click', () => {
    if (errorEl) errorEl.classList.add('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    initAirwallexPayment(amount, table, settings, bd);
  });

  try {
    // Create PaymentIntent on server
    const res = await fetch(`${API_BASE}/api/airwallex/create-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, table }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error' }));
      showError(err.error || 'Failed to create payment intent');
      return;
    }
    const { clientSecret, intentId } = await res.json();

    // Initialize Airwallex SDK
    const env = settings.airwallexEnv || 'demo';
    Airwallex.init({ env, origin: window.location.origin });

    // Create and mount Drop-in element
    const dropIn = Airwallex.createElement('dropIn', {
      intent_id: intentId,
      client_secret: clientSecret,
      currency: 'MYR',
      mode: 'payment',
      autoCapture: true,
    });

    dropIn.mount('airwallex-dropin');
    airwallexElement = dropIn;

    if (loadingEl) loadingEl.classList.add('hidden');

    // Listen for events
    window.addEventListener('onSuccess', function onAwSuccess(e) {
      window.removeEventListener('onSuccess', onAwSuccess);
      confirmTablePayment();
    });

    window.addEventListener('onError', function onAwError(e) {
      window.removeEventListener('onError', onAwError);
      console.error('Airwallex payment error:', e.detail);
      showError('Payment failed. Please try again.');
    });

  } catch (e) {
    console.error('Airwallex init error:', e);
    showError('Failed to initialize card payment');
  }
}

function destroyAirwallexElement() {
  if (airwallexElement) {
    try { airwallexElement.destroy(); } catch (_) {}
    airwallexElement = null;
  }
}

async function confirmTablePayment() {
  const table = state.payingTable; const method = state.payMethod;
  const bills = loadActiveBills(); const bill = bills[table];
  if (!bill) return;
  const subtotal = getActiveBillTotal(bill.items);
  const settings = loadSettings();
  const bd = calcBillBreakdown(subtotal, settings);
  const orderId = `RCP-${Date.now()}`;
  await saveOrderToHistory(table, bill.items, bd.total, method);
  await clearActiveBill(table);
  closeBillingModal();
  updateTableBtn();
  const labels = { tng: t('tng'), duitnow: t('duitnow'), cash: t('cash'), card: t('credit_card') };
  showToast(`${t('payment_confirmed')} · ${table} · ${labels[method] || method}`);
  if (settings.printReceipt !== false) printPaymentReceipt(table, bill.items, bd, method, orderId);
}

// ─── HISTORY MODAL ────────────────────────────────────────────────────────────

async function openHistoryModal() {
  const sel = document.getElementById('hist-table-filter');
  sel.innerHTML = `<option value="all">${t('all_tables')}</option>`;
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
  if (list.length === 0) { body.innerHTML = `<div class="empty-state">${t('no_orders_found')}</div>`; return; }
  const payLabel = { tng: '💳 T&G', duitnow: '🏦 DuitNow', cash: '💵 Cash', card: '💳 Card' };
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
          <span class="hist-total">${getCurrency()} ${ord.total.toFixed(2)}</span>
          <button class="hist-toggle-btn" data-id="${ord.id}">Details ▾</button>
        </div>
      </div>
      <div class="hist-detail hidden" id="hd-${ord.id}">
        <table class="hist-items-table">
          ${ord.items.map(oi => `<tr>
            <td class="hi-name">${localName(oi)} <span class="hi-en">${oi.name}</span></td>
            <td class="hi-qty">×${oi.quantity}</td>
            <td class="hi-price">${getCurrency()} ${oi.subtotal.toFixed(2)}</td></tr>`).join('')}
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
      showToast(t('items_added_to_order'));
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

// ─── THERMAL PRINTER (server-side ESC/POS with GBK encoding) ─────────────────

function buildPrintJob(type, data) {
  return { type, data };
}

function buildOrderSlipJob(table, items, isUpdate) {
  const now      = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const sess = getSession();
  return buildPrintJob('orderSlip', {
    table,
    lang: typeof getLang === 'function' ? getLang() : 'en',
    currency: typeof getCurrency === 'function' ? getCurrency() : 'RM',
    dateTime: `${dd}/${mm} ${hh}:${mi}`,
    cashier: sess ? sess.name : '',
    pax: state.pax || 0,
    isUpdate,
    items: items.map(item => ({
      qty:    item.quantity,
      nameZh: localName(item.menuItem || item),
      nameEn: (item.menuItem || item).name || '',
      mods:   (item.selectedModifiers || []).map(m => m.optionLabel),
      notes:  item.notes ? item.notes.trim() : '',
    })),
  });
}

function buildReceiptJob(table, items, bd, method, orderId) {
  const now      = new Date();
  const settings = loadSettings();
  const sess     = getSession();
  const methodLabel = { tng: 'Touch & Go', duitnow: 'DuitNow QR', cash: 'Cash', card: 'Credit Card' };
  const cur = typeof getCurrency === 'function' ? getCurrency() : 'RM';
  return buildPrintJob('receipt', {
    lang: typeof getLang === 'function' ? getLang() : 'en',
    currency: cur,
    labels: {
      officialReceipt: t('official_receipt'), receipt: t('receipt'),
      receiptNo: t('receipt_no'), table: t('table'), date: t('date'), time: t('time'),
      servedBy: t('served_by'), subtotal: t('subtotal'), sst: t('sst'),
      service: t('service'), total: t('total'), payment: t('payment'),
      thankYou: t('thank_you'), comeAgain: t('come_again'),
      newOrder: t('new_order'), orderUpdate: t('order_update'), cashier: t('cashier'),
    },
    shopName:   settings.shopName || 'BKT House',
    shopAddress: settings.shopAddress || '',
    cashier:    sess ? sess.name : '',
    table,
    dateStr:    now.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }),
    timeStr:    now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    receiptNo:  orderId || `RCP-${Date.now()}`,
    subtotal:   bd.subtotal.toFixed(2),
    sst:        bd.sst ? bd.sst.toFixed(2) : null,
    sstRate:    bd.sstRate,
    svc:        bd.svc ? bd.svc.toFixed(2) : null,
    svcRate:    bd.svcRate,
    total:      bd.total.toFixed(2),
    payLabel:   methodLabel[method] || method,
    items: items.map(item => ({
      qty:    item.quantity,
      nameZh: localName(item),
      nameEn: item.name || '',
      price:  item.subtotal.toFixed(2),
      mods:   (item.selectedModifiers || []).map(m => m.optionLabel).join(', '),
      notes:  item.notes ? item.notes.trim() : '',
    })),
  });
}

async function sendToPrinter(job) {
  const settings = loadSettings();
  if (!settings.printerIp) return false;

  // Try 1: server-side build + TCP print
  let escposB64 = null;
  try {
    const res = await fetch(`${API_BASE}/api/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    const result = await res.json();
    if (result.escpos) escposB64 = result.escpos;
    if (res.ok) return true;
  } catch (_) {}

  // Try 2: Capacitor native bridge (Android app)
  if (escposB64 && window.Capacitor?.isNativePlatform()) {
    try {
      const { PrintBridge } = window.Capacitor.Plugins;
      await PrintBridge.printRaw({
        data: escposB64,
        ip:   settings.printerIp,
        port: parseInt(settings.printerPort, 10) || 9100,
      });
      return true;
    } catch (e) {
      console.warn('[print] Native bridge failed:', e);
    }
  }

  // Try 3: local relay with server-built ESC/POS bytes
  if (escposB64) {
    const relayUrl = settings.relayUrl || 'http://localhost:9101';
    try {
      const res = await fetch(`${relayUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerIp:   settings.printerIp,
          printerPort: parseInt(settings.printerPort, 10) || 9100,
          data:        escposB64,
        }),
      });
      if (res.ok) return true;
    } catch (_) {}
  }

  return false;
}

// ─── PRINT ORDER SLIP ─────────────────────────────────────────────────────────

function printOrderSlip(table, items, isUpdate) {
  const settings = loadSettings();

  // Try direct thermal print if printer configured
  if (settings.printerIp) {
    const job = buildOrderSlipJob(table, items, isUpdate);
    sendToPrinter(job).then(ok => {
      if (!ok) {
        showToast(t('print_failed'));
        printOrderSlipHTML(table, items, isUpdate);
      }
    });
    return;
  }

  // Fallback: browser print
  printOrderSlipHTML(table, items, isUpdate);
}

function printOrderSlipHTML(table, items, isUpdate) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const dateTime = `${dd}/${mm} ${hh}:${mi}`;
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  const settings = loadSettings();
  const shopName = settings.shopName || 'BKT House';

  const itemRows = items.map((item, idx) => {
    const itemObj = item.menuItem || item;
    const nameLocal = localName(itemObj);
    const nameEn = itemObj.name || '';
    const mods   = (item.selectedModifiers || []).map(m => m.optionLabel);
    const notes  = item.notes ? item.notes.trim() : '';
    return `
      <div class="item-block${idx > 0 ? ' item-border' : ''}">
        <div class="item-row">
          <span class="item-qty">${item.quantity}</span>
          <span class="item-name">${nameLocal}</span>
          <span class="item-chk">☐</span>
        </div>
        ${nameEn !== nameLocal ? `<div class="item-sub">${nameEn}</div>` : ''}
        ${mods.map(m => `<div class="item-sub">-${m}</div>`).join('')}
        ${notes ? `<div class="item-sub">*${notes}</div>` : ''}
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Order Slip</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px;
         width: 80mm; margin: 0 auto; padding: 4px 6px 12px; color: #000; }
  .shop-name { text-align:center; font-size:14px; font-weight:bold; margin-bottom:4px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px; }
  .header-left { font-size:11px; line-height:1.5; }
  .header-right { text-align:right; }
  .table-no { font-size:28px; font-weight:bold; line-height:1; }
  .pax { font-size:11px; }
  .order-type { text-align:center; font-size:12px; font-weight:bold;
                border:1px solid #000; padding:1px 8px; margin:2px auto 0;
                display:inline-block; }
  .order-type-wrap { text-align:center; margin-bottom:2px; }
  .divider { border:none; border-top:1px solid #000; margin:4px 0; }
  .item-block { padding:4px 0; }
  .item-border { border-top:1px solid #000; }
  .item-row { display:flex; align-items:flex-start; font-size:13px; font-weight:bold; }
  .item-qty { width:18px; flex-shrink:0; }
  .item-name { flex:1; }
  .item-chk { width:16px; height:16px; flex-shrink:0; text-align:center; font-size:14px; margin-left:4px; margin-top:1px; }
  .item-sub { font-size:12px; font-weight:normal; padding-left:18px; }
  .footer-line { border-top:1px solid #000; margin-top:4px; }
  @media print {
    body { width:80mm; padding:0 4px 8px; }
    @page { size:80mm auto; margin:0; }
  }
</style></head><body>
  <div class="shop-name">${shopName}</div>
  <div class="header">
    <div class="header-left">
      ${dateTime}<br>
      ${isUpdate ? t('order_update') : t('new_order')}
    </div>
    <div class="header-right">
      <div class="table-no">${table}</div>
      <div class="pax">${itemCount} Item${itemCount > 1 ? 's' : ''}</div>
    </div>
  </div>
  <hr class="divider">
  ${itemRows}
  <div class="footer-line"></div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=420,height=600,menubar=no,toolbar=no,location=no');
  if (!w) { showToast(t('allow_popups')); return; }
  w.document.write(html);
  w.document.close();
}

// ─── PAYMENT RECEIPT ──────────────────────────────────────────────────────────

function printPaymentReceipt(table, items, bd, method, orderId) {
  const settings = loadSettings();

  // Try direct thermal print if printer configured
  if (settings.printerIp) {
    const job = buildReceiptJob(table, items, bd, method, orderId);
    sendToPrinter(job).then(ok => {
      if (!ok) {
        showToast(t('print_failed'));
        printPaymentReceiptHTML(table, items, bd, method, orderId);
      }
    });
    return;
  }

  // Fallback: browser print
  printPaymentReceiptHTML(table, items, bd, method, orderId);
}

function printPaymentReceiptHTML(table, items, bd, method, orderId) {
  const now        = new Date();
  const dateStr    = now.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr    = now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const settings   = loadSettings();
  const sess       = getSession();
  const cashierName = sess ? sess.name : '';
  const shopName    = settings.shopName || 'BKT House';
  const shopAddress = settings.shopAddress || '';
  const receiptNo   = orderId || `RCP-${Date.now()}`;
  const methodLabel = { tng: 'Touch & Go eWallet', duitnow: 'DuitNow QR', cash: t('cash'), card: t('credit_card') };
  const payLabel   = methodLabel[method] || method;
  const cur = getCurrency();

  const itemRows = items.map(item => {
    const mods  = (item.selectedModifiers || []).map(m => m.optionLabel).join(', ');
    const notes = item.notes ? item.notes.trim() : '';
    return `
      <tr>
        <td class="td-qty">${item.quantity}</td>
        <td class="td-name">
          <div class="item-zh">${localName(item)}</div>
          <div class="item-en">${item.name || ''}</div>
          ${mods  ? `<div class="item-mod">${mods}</div>`      : ''}
          ${notes ? `<div class="item-note">📝 ${notes}</div>` : ''}
        </td>
        <td class="td-price">${cur}&nbsp;${item.subtotal.toFixed(2)}</td>
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
  ${shopAddress ? `<div class="shop-sub">${shopAddress}</div>` : ''}
  <div class="shop-sub">${t('official_receipt')}</div>
  <div class="receipt-lbl">${t('receipt')}</div>
  <hr class="divider">
  <div class="meta-row"><span class="lbl">${t('receipt_no')}</span><span>${receiptNo}</span></div>
  <div class="meta-row"><span class="lbl">${t('table')}</span><span>${table}</span></div>
  <div class="meta-row"><span class="lbl">${t('date')}</span><span>${dateStr}</span></div>
  <div class="meta-row"><span class="lbl">${t('time')}</span><span>${timeStr}</span></div>
  ${cashierName ? `<div class="meta-row"><span class="lbl">${t('served_by')}</span><span>${cashierName}</span></div>` : ''}
  <hr class="divider">
  <table><tbody>${itemRows}</tbody></table>
  <hr class="divider">
  <div class="summary">
    <div class="sum-row"><span>${t('subtotal')}</span><span>${cur}&nbsp;${bd.subtotal.toFixed(2)}</span></div>
    ${bd.sst ? `<div class="sum-row"><span>${t('sst')} (${bd.sstRate}%)</span><span>${cur}&nbsp;${bd.sst.toFixed(2)}</span></div>` : ''}
    ${bd.svc ? `<div class="sum-row"><span>${t('service')} (${bd.svcRate}%)</span><span>${cur}&nbsp;${bd.svc.toFixed(2)}</span></div>` : ''}
    <div class="sum-row total"><span>${t('total')}</span><span>${cur}&nbsp;${bd.total.toFixed(2)}</span></div>
  </div>
  <hr class="divider">
  <div class="pay-row"><span class="lbl">${t('payment')}</span><span>${payLabel}</span></div>
  <div class="footer">
    ${t('thank_you')}<br>
    ${t('come_again')}
  </div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=420,height=650,menubar=no,toolbar=no,location=no');
  if (!w) { showToast('⚠ Allow pop-ups to print receipt'); return; }
  w.document.write(html);
  w.document.close();
}

// ─── AUTH UI ──────────────────────────────────────────────────────────────────

function applySessionToUI(session) {
  // Set user name in header chip
  const userBtn = document.getElementById('user-btn');
  const userBtnName = document.getElementById('user-btn-name');
  if (userBtnName) userBtnName.textContent = session.name;
  if (userBtn) {
    userBtn.addEventListener('click', () => {
      if (confirm(`Logout ${session.name}?`)) {
        clearSession();
        location.reload();
      }
    });
  }

  // Hide Maintenance link for cashiers
  if (session.role !== 'super') {
    const maintLink = document.querySelector('a[href="items.html?tab=maintenance"]');
    if (maintLink) maintLink.style.display = 'none';
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  // ── Handle tenant switch from admin links ──
  const urlParams = new URLSearchParams(location.search);
  const storeParam = urlParams.get('store');
  const isFresh = urlParams.get('fresh');
  if (storeParam && isFresh) {
    // Admin link — clear ALL cached data and force re-login for this tenant
    localStorage.removeItem('bkt_auth_session');
    localStorage.removeItem('bkt_tenant_session');
    localStorage.removeItem('bkt_menu_items');
    localStorage.removeItem('bkt_settings');
    localStorage.removeItem('bkt_active_bills');
    localStorage.removeItem('bkt_order_history');
    // Remove fresh param so the next reload after login doesn't clear again
    urlParams.delete('fresh');
    history.replaceState(null, '', `${location.pathname}?${urlParams.toString()}`);
  } else if (storeParam) {
    // Normal ?store= link — check if we need to switch tenant
    const currentSession = getSession();
    if (currentSession && currentSession.tenantSlug && currentSession.tenantSlug !== storeParam) {
      // Different tenant — clear everything and force re-login
      localStorage.removeItem('bkt_auth_session');
      localStorage.removeItem('bkt_tenant_session');
      localStorage.removeItem('bkt_menu_items');
      localStorage.removeItem('bkt_settings');
      localStorage.removeItem('bkt_active_bills');
      localStorage.removeItem('bkt_order_history');
    }
  }

  // ── Auth gate: require login before loading POS ──
  const session = getSession();
  if (!session) {
    showLoginOverlay(function() { location.reload(); });
    return;
  }
  applySessionToUI(session);

  // ── Step 1: Load menu — from API if tenant link, else localStorage cache ──
  const isTenantLink = !!urlParams.get('store');
  if (isTenantLink) {
    // Tenant link: always load fresh from API, don't trust localStorage
    menuItems = [...MENU_ITEMS]; // fallback until API responds
  } else {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      menuItems = saved ? JSON.parse(saved) : [...MENU_ITEMS];
      if (!saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(menuItems));
    } catch (e) { menuItems = [...MENU_ITEMS]; }
  }

  // Shop name from settings (skip cache if tenant link — will load from API)
  if (!isTenantLink) {
    const _s = loadSettings();
    const headerName = document.getElementById('header-shop-name');
    if (headerName && _s.shopName) headerName.textContent = _s.shopName;
  }

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderMenuList();
  });

  // Table picker (desktop + mobile)
  document.getElementById('table-select-btn').addEventListener('click', () => openTablePicker(false));
  const mobileTableBtn = document.getElementById('mobile-table-btn');
  if (mobileTableBtn) mobileTableBtn.addEventListener('click', () => openTablePicker(false));
  document.getElementById('table-picker-close').addEventListener('click', closeTablePicker);
  document.getElementById('table-picker-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget && state.tableNumber) closeTablePicker();
  });

  // Pax controls
  function updatePaxDisplay() {
    document.getElementById('pax-display').textContent = state.pax;
    const mp = document.getElementById('mobile-pax-display');
    if (mp) mp.textContent = state.pax;
  }
  document.getElementById('pax-minus').addEventListener('click', () => {
    if (state.pax > 1) state.pax--;
    updatePaxDisplay();
  });
  document.getElementById('pax-plus').addEventListener('click', () => {
    state.pax++;
    updatePaxDisplay();
  });
  // Mobile pax controls
  const mPaxMinus = document.getElementById('mobile-pax-minus');
  const mPaxPlus  = document.getElementById('mobile-pax-plus');
  if (mPaxMinus) mPaxMinus.addEventListener('click', () => { if (state.pax > 1) state.pax--; updatePaxDisplay(); });
  if (mPaxPlus)  mPaxPlus.addEventListener('click',  () => { state.pax++; updatePaxDisplay(); });

  // Mobile basket bar — draggable + opens cart sheet on tap
  const mbar = document.getElementById('mobile-basket-bar');
  if (mbar) {
    let dragState = null;
    const DRAG_THRESHOLD = 8;

    mbar.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      const currentTop = parseInt(mbar.style.top, 10) || mbar.getBoundingClientRect().top;
      dragState = { startY: touch.clientY, startTop: currentTop, moved: false };
    }, { passive: true });

    mbar.addEventListener('touchmove', (e) => {
      if (!dragState) return;
      const touch = e.touches[0];
      const deltaY = touch.clientY - dragState.startY;
      if (Math.abs(deltaY) > DRAG_THRESHOLD) dragState.moved = true;
      if (!dragState.moved) return;
      e.preventDefault();
      const headerH = document.getElementById('header')?.offsetHeight || 56;
      const barH = mbar.offsetHeight;
      const minTop = headerH;
      const maxTop = window.innerHeight - barH - 10;
      const newTop = Math.max(minTop, Math.min(maxTop, dragState.startTop + deltaY));
      mbar.style.top = newTop + 'px';
      mbar.style.transition = 'none';
    }, { passive: false });

    mbar.addEventListener('touchend', () => {
      if (!dragState) return;
      const wasDrag = dragState.moved;
      dragState = null;
      mbar.style.transition = '';
      if (!wasDrag) {
        document.getElementById('cart-panel').classList.add('mobile-cart-open');
      }
    });
  }
  // Inject mobile back button into cart head (close the sheet)
  const cpHead = document.getElementById('cp-head');
  if (cpHead && !document.getElementById('mobile-cart-back-btn')) {
    const backBtn = document.createElement('button');
    backBtn.id = 'mobile-cart-back-btn';
    backBtn.type = 'button';
    backBtn.className = 'mobile-cart-back-btn';
    backBtn.innerHTML = '← Back';
    backBtn.addEventListener('click', () => {
      document.getElementById('cart-panel').classList.remove('mobile-cart-open');
    });
    cpHead.insertBefore(backBtn, cpHead.firstChild);
  }

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
      state.pax               = 1;
      document.getElementById('pax-display').textContent = state.pax;
      state.editingActiveBill = null;
      renderCartPanel();
      renderMenuList();
      updateTableBtn();
      // Mobile: close cart drawer and return to menu
      document.getElementById('cart-panel').classList.remove('mobile-cart-open');
      showToast(wasEditing ? t('order_updated', { table: sentTable }) : t('order_sent', { table: sentTable }));
      const _ps = loadSettings();
      if (_ps.printOrderSlip !== false) printOrderSlip(sentTable, slipItems, wasEditing);
    } catch (e) {
      showToast(t('order_send_error'));
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
  const mobilePayBtn = document.getElementById('mobile-pay-btn');
  if (mobilePayBtn) mobilePayBtn.addEventListener('click', openBillingModal);
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

  // i18n: add language switcher to header and translate static elements
  const headerRight = document.getElementById('header-right');
  if (headerRight && typeof createLangSwitcher === 'function') {
    headerRight.insertBefore(createLangSwitcher(), headerRight.firstChild);
    onLangChange(() => {
      translatePage();
      renderCategoryBar();
      renderMenuList();
      renderCartPanel();
      updateTableBtn();
    });
  }
  translatePage();

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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(menuItems));
        renderCategoryBar();
        renderMenuList();
      } else if (apiMenu !== null && !isTenantLink) {
        // API has no menu yet — seed it (only in non-tenant mode to avoid cross-tenant contamination)
        fetch(`${API_BASE}/api/menu`, { method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(menuItems) }).catch(() => {});
      }
    }).catch(() => {});

    // Refresh bills from API
    fetchBillsFromAPI().then(() => updateTableBtn()).catch(() => {});

    // Sync settings from API
    fetch(`${API_BASE}/api/settings`).then(r => r.ok ? r.json() : null).then(s => {
      if (s && Object.keys(s).length > 0) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
        const headerName = document.getElementById('header-shop-name');
        if (headerName && s.shopName) headerName.textContent = s.shopName;
      }
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
