'use strict';
// STORAGE_KEY, CATEGORIES, MENU_ITEMS come from menuDefaults.js

const API_BASE = '';
const SETTINGS_KEY = 'bkt_settings';

function loadSettings() {
  try { const r = localStorage.getItem(SETTINGS_KEY); return r ? JSON.parse(r) : {}; }
  catch (e) { return {}; }
}

function saveSettings(data) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

// ─── State ────────────────────────────────────────────────────────────────────

let items       = [];   // live list
let formGroups  = [];   // modifier groups being edited in modal
let editingId   = null; // null = new item, string = item.id being edited
let searchQ     = '';

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    items = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(MENU_ITEMS));
    if (!raw) persist();
  } catch (e) {
    items = JSON.parse(JSON.stringify(MENU_ITEMS));
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  fetch(`${API_BASE}/api/menu`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  }).catch(() => {});
}

// ─── Table ────────────────────────────────────────────────────────────────────

function catName(id) {
  return CATEGORIES.find(c => c.id === id)?.name || id;
}

function renderTable() {
  const q = searchQ.toLowerCase();
  const filtered = q
    ? items.filter(i => i.name.toLowerCase().includes(q) || i.nameZh.includes(q) ||
                        catName(i.category).toLowerCase().includes(q))
    : items;

  document.getElementById('im-count').textContent =
    `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('im-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No items found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(item => `
    <tr class="${item.isAvailable ? '' : 'row-dim'}">
      <td><span class="cat-chip">${catName(item.category)}</span></td>
      <td class="td-name">
        <div class="td-name-zh">${item.nameZh}</div>
        <div class="td-name-en">${item.name}</div>
      </td>
      <td class="td-price">RM ${item.price.toFixed(2)}</td>
      <td class="td-center">
        <span class="status-dot ${item.isAvailable ? 'dot-on' : 'dot-off'}">
          ${item.isAvailable ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td class="td-center">${item.isPopular ? '⭐' : '—'}</td>
      <td class="td-center">${(item.modifierGroups || []).length > 0
        ? `<span class="mod-count">${item.modifierGroups.length} group${item.modifierGroups.length > 1 ? 's' : ''}</span>`
        : '<span class="td-dim">—</span>'}</td>
      <td class="td-actions">
        <button class="row-btn btn-edit" data-id="${item.id}">Edit</button>
        <button class="row-btn btn-del"  data-id="${item.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => openModal(items.find(i => i.id === b.dataset.id))));
  tbody.querySelectorAll('.btn-del').forEach(b =>
    b.addEventListener('click', () => deleteItem(b.dataset.id)));
}

// ─── Modal open / close ───────────────────────────────────────────────────────

function openModal(item = null) {
  editingId  = item ? item.id : null;
  formGroups = item ? JSON.parse(JSON.stringify(item.modifierGroups || [])) : [];

  document.getElementById('im-modal-title').textContent = item ? 'Edit Item' : 'Add Item';
  document.getElementById('f-name').value      = item?.name        || '';
  document.getElementById('f-namezh').value    = item?.nameZh      || '';
  document.getElementById('f-category').value  = item?.category    || 'mains';
  document.getElementById('f-price').value     = item?.price       ?? '';
  document.getElementById('f-desc').value      = item?.description || '';
  document.getElementById('f-desczh').value    = item?.descriptionZh || '';
  document.getElementById('f-popular').checked  = item?.isPopular  || false;
  document.getElementById('f-available').checked = item?.isAvailable ?? true;

  renderFormGroups();
  document.getElementById('im-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('f-name').focus();
}

function closeModal() {
  document.getElementById('im-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── Modifier group form ──────────────────────────────────────────────────────

function renderFormGroups() {
  const wrap = document.getElementById('mod-groups-wrap');
  if (formGroups.length === 0) {
    wrap.innerHTML = '<p class="mod-hint">No modifier groups yet. Use "+ Add Group" to add options like size, type, etc.</p>';
    return;
  }

  wrap.innerHTML = formGroups.map((grp, gi) => `
    <div class="mod-grp-card">
      <div class="mod-grp-head">
        <strong>Group ${gi + 1}</strong>
        <button type="button" class="text-btn danger" data-a="del-grp" data-gi="${gi}">Remove</button>
      </div>
      <div class="mod-grp-row">
        <input class="mi" data-f="name"   data-gi="${gi}" placeholder="Group name (EN)" value="${grp.name}">
        <input class="mi" data-f="nameZh" data-gi="${gi}" placeholder="组名 (ZH)" value="${grp.nameZh}">
        <label class="inline-chk">
          <input type="checkbox" data-f="required" data-gi="${gi}" ${grp.required ? 'checked' : ''}> Required
        </label>
      </div>
      <div class="mod-opts-list">
        ${grp.options.map((opt, oi) => `
          <div class="mod-opt-row">
            <input class="mi opt-mi" data-f="label"           data-gi="${gi}" data-oi="${oi}" placeholder="Label (EN)" value="${opt.label}">
            <input class="mi opt-mi" data-f="labelZh"         data-gi="${gi}" data-oi="${oi}" placeholder="标签 (ZH)"  value="${opt.labelZh}">
            <input class="mi opt-price" type="number" data-f="priceAdjustment" data-gi="${gi}" data-oi="${oi}" placeholder="±RM" value="${opt.priceAdjustment}" step="0.5">
            <button type="button" class="icon-del" data-a="del-opt" data-gi="${gi}" data-oi="${oi}">×</button>
          </div>
        `).join('')}
      </div>
      <button type="button" class="text-btn" data-a="add-opt" data-gi="${gi}">+ Add Option</button>
    </div>
  `).join('');

  // Sync inputs to formGroups on change
  wrap.querySelectorAll('.mi').forEach(inp => {
    inp.addEventListener('input', () => syncField(inp));
    inp.addEventListener('change', () => syncField(inp));
  });
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb =>
    cb.addEventListener('change', () => syncField(cb)));

  // Action buttons
  wrap.querySelectorAll('[data-a]').forEach(btn => {
    btn.addEventListener('click', () => {
      const gi = +btn.dataset.gi, oi = +btn.dataset.oi;
      switch (btn.dataset.a) {
        case 'del-grp': formGroups.splice(gi, 1); break;
        case 'del-opt': formGroups[gi].options.splice(oi, 1); break;
        case 'add-opt':
          formGroups[gi].options.push({ id: `opt_${Date.now()}`, label: '', labelZh: '', priceAdjustment: 0 });
          break;
      }
      renderFormGroups();
    });
  });
}

function syncField(el) {
  const gi = +el.dataset.gi;
  const oi = el.dataset.oi !== undefined ? +el.dataset.oi : NaN;
  const f  = el.dataset.f;
  const v  = el.type === 'checkbox' ? el.checked
           : el.type === 'number'   ? (parseFloat(el.value) || 0)
           : el.value;
  if (!isNaN(oi)) formGroups[gi].options[oi][f] = v;
  else            formGroups[gi][f] = v;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function saveItem() {
  const name    = document.getElementById('f-name').value.trim();
  const nameZh  = document.getElementById('f-namezh').value.trim();
  const price   = parseFloat(document.getElementById('f-price').value);
  const category = document.getElementById('f-category').value;

  if (!name || !nameZh || isNaN(price) || price < 0) {
    alert('Please fill in Name (EN), Name (ZH), and a valid Price (≥ 0).');
    return;
  }

  // Filter out empty modifier groups / options
  const cleanGroups = formGroups
    .filter(g => g.name.trim() || g.nameZh.trim())
    .map(g => ({
      ...g,
      options: g.options.filter(o => o.label.trim() || o.labelZh.trim()),
    }));

  const record = {
    id:            editingId || `item_${Date.now()}`,
    name, nameZh, category, price,
    description:   document.getElementById('f-desc').value.trim(),
    descriptionZh: document.getElementById('f-desczh').value.trim(),
    isPopular:     document.getElementById('f-popular').checked,
    isAvailable:   document.getElementById('f-available').checked,
    modifierGroups: cleanGroups,
  };

  if (editingId) {
    const idx = items.findIndex(i => i.id === editingId);
    if (idx !== -1) items[idx] = record; else items.push(record);
  } else {
    items.push(record);
  }

  persist();
  closeModal();
  renderTable();
}

function deleteItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.nameZh} / ${item.name}"?\nThis cannot be undone.`)) return;
  items = items.filter(i => i.id !== id);
  persist();
  renderTable();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  loadItems();
  renderTable();

  document.getElementById('im-search').addEventListener('input', e => {
    searchQ = e.target.value;
    renderTable();
  });

  document.getElementById('add-item-btn').addEventListener('click', () => openModal());
  document.getElementById('im-modal-close').addEventListener('click', closeModal);
  document.getElementById('im-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('im-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('add-grp-btn').addEventListener('click', () => {
    formGroups.push({ id: `grp_${Date.now()}`, name: '', nameZh: '', required: false, multiSelect: false, options: [] });
    renderFormGroups();
  });

  document.getElementById('im-save-btn').addEventListener('click', saveItem);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('im-modal').classList.contains('hidden'))
      closeModal();
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const panels = {
    items:       document.getElementById('panel-items'),
    settings:    document.getElementById('panel-settings'),
    maintenance: document.getElementById('panel-maintenance'),
  };

  function switchTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    Object.entries(panels).forEach(([name, el]) => el.classList.toggle('hidden', name !== tabName));
    document.getElementById('add-item-btn').style.display = tabName === 'items' ? '' : 'none';
  }

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Auto-select tab from URL param: items.html?tab=maintenance
  const tabParam = new URLSearchParams(location.search).get('tab');
  if (tabParam && panels[tabParam]) switchTab(tabParam);

  // ── Payment Settings ──────────────────────────────────────────────────────
  initSettings();

  // ── Maintenance ───────────────────────────────────────────────────────────
  initMaintenance();
}

function initSettings() {
  const settings = loadSettings();
  const shopNameInput  = document.getElementById('s-shop-name');
  const tngInput       = document.getElementById('s-tng-url');
  const duitnowInput   = document.getElementById('s-duitnow-url');
  const tngPreview     = document.getElementById('s-tng-preview');
  const duitnowPreview = document.getElementById('s-duitnow-preview');

  shopNameInput.value  = settings.shopName    || '';
  tngInput.value       = settings.tngQrUrl    || '';
  duitnowInput.value   = settings.duitnowQrUrl || '';

  function updatePreview(input, preview) {
    const url = input.value.trim();
    if (url) { preview.src = url; preview.classList.remove('hidden'); }
    else { preview.src = ''; preview.classList.add('hidden'); }
  }

  updatePreview(tngInput, tngPreview);
  updatePreview(duitnowInput, duitnowPreview);

  tngInput.addEventListener('input',     () => updatePreview(tngInput, tngPreview));
  duitnowInput.addEventListener('input', () => updatePreview(duitnowInput, duitnowPreview));

  document.getElementById('s-save-btn').addEventListener('click', () => {
    saveSettings({
      shopName:     shopNameInput.value.trim(),
      tngQrUrl:     tngInput.value.trim(),
      duitnowQrUrl: duitnowInput.value.trim(),
    });
    const msg = document.getElementById('s-saved-msg');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2000);
  });
}

function initMaintenance() {
  const modal       = document.getElementById('maint-confirm-modal');
  const titleEl     = document.getElementById('maint-confirm-title');
  const msgEl       = document.getElementById('maint-confirm-msg');
  const pickerEl    = document.getElementById('maint-table-picker');
  const okBtn       = document.getElementById('maint-confirm-ok');
  const cancelBtn   = document.getElementById('maint-confirm-cancel');
  const closeBtn    = document.getElementById('maint-confirm-close');
  let pendingAction = null;

  function openConfirm(title, msg, action) {
    titleEl.textContent = title;
    msgEl.textContent   = msg;
    pickerEl.innerHTML  = '';
    pickerEl.classList.add('hidden');
    pendingAction = action;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function openSeatingPicker(title, msg) {
    const bills  = JSON.parse(localStorage.getItem('bkt_active_bills') || '{}');
    const tables = Object.keys(bills).sort();

    titleEl.textContent = title;
    msgEl.textContent   = tables.length ? msg : 'No tables are currently occupied.';
    pickerEl.classList.remove('hidden');

    if (tables.length === 0) {
      pickerEl.innerHTML = '';
      okBtn.classList.add('hidden');
    } else {
      pickerEl.innerHTML = tables.map(t =>
        `<button class="maint-tbl-btn" data-table="${t}">${t}</button>`
      ).join('');
      pickerEl.querySelectorAll('.maint-tbl-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('maint-tbl-btn--selected'));
      });
      okBtn.classList.remove('hidden');
    }

    pendingAction = () => {
      const selected = [...pickerEl.querySelectorAll('.maint-tbl-btn--selected')]
        .map(b => b.dataset.table);
      if (selected.length === 0) return;
      const bills = JSON.parse(localStorage.getItem('bkt_active_bills') || '{}');
      selected.forEach(t => delete bills[t]);
      localStorage.setItem('bkt_active_bills', JSON.stringify(bills));
      const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bkt_pos') : null;
      if (ch) { ch.postMessage({ type: 'bill:cleared', table: '*' }); ch.close(); }
      showMaintToast(`✓ Released: ${selected.join(', ')}`);
    };

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeConfirm() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    pickerEl.innerHTML = '';
    pickerEl.classList.add('hidden');
    okBtn.classList.remove('hidden');
    pendingAction = null;
  }

  okBtn.addEventListener('click', () => {
    if (pendingAction) pendingAction();
    closeConfirm();
  });

  cancelBtn.addEventListener('click', closeConfirm);
  closeBtn.addEventListener('click',  closeConfirm);
  modal.addEventListener('click', e => { if (e.target === modal) closeConfirm(); });

  // ── Clear Sales History ───────────────────────────────────────────────────
  document.getElementById('maint-clear-history-btn').addEventListener('click', () => {
    openConfirm(
      'Clear Sales History',
      'This will permanently delete all completed order records. Active kitchen orders will not be affected.',
      () => {
        localStorage.removeItem('bkt_order_history');
        try { fetch(`${API_BASE}/api/history`, { method: 'DELETE' }); } catch (_) {}
        showMaintToast('✓ Sales history cleared');
      }
    );
  });

  // ── Clear KDS Data (reset item statuses to pending) ──────────────────────
  document.getElementById('maint-clear-kds-btn').addEventListener('click', () => {
    openConfirm(
      'Clear KDS Data',
      'All kitchen item statuses will be reset to Pending. Table assignments and order items are preserved.',
      () => {
        try {
          const bills = JSON.parse(localStorage.getItem('bkt_active_bills') || '{}');
          Object.values(bills).forEach(bill => {
            bill.items.forEach(item => { item.status = 'pending'; });
          });
          localStorage.setItem('bkt_active_bills', JSON.stringify(bills));
        } catch (_) {}
        const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bkt_pos') : null;
        if (ch) { ch.postMessage({ type: 'order:updated', table: '*' }); ch.close(); }
        showMaintToast('✓ KDS statuses reset to Pending');
      }
    );
  });

  // ── Clear Order Table (active orders screen) ─────────────────────────────
  document.getElementById('maint-clear-orders-btn').addEventListener('click', () => {
    openConfirm(
      'Clear Order Table',
      'All records on the Active Orders screen will be removed. This cannot be undone.',
      () => {
        localStorage.removeItem('bkt_active_bills');
        try { fetch(`${API_BASE}/api/bills`, { method: 'DELETE' }); } catch (_) {}
        const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bkt_pos') : null;
        if (ch) { ch.postMessage({ type: 'bill:cleared', table: '*' }); ch.close(); }
        showMaintToast('✓ Order table cleared');
      }
    );
  });

  // ── Clear Table Data (remove all active table assignments) ────────────────
  document.getElementById('maint-clear-tables-btn').addEventListener('click', () => {
    openConfirm(
      'Clear Table Data',
      'All active table assignments and their orders will be permanently removed. Tables will appear as free and empty.',
      () => {
        localStorage.removeItem('bkt_active_bills');
        try { fetch(`${API_BASE}/api/bills`, { method: 'DELETE' }); } catch (_) {}
        const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bkt_pos') : null;
        if (ch) { ch.postMessage({ type: 'bill:cleared', table: '*' }); ch.close(); }
        showMaintToast('✓ All table data cleared');
      }
    );
  });

  // ── Clear Payment Data ────────────────────────────────────────────────────
  document.getElementById('maint-clear-payment-btn').addEventListener('click', () => {
    openConfirm(
      'Clear Payment Data',
      'Saved QR payment settings (Touch & Go and DuitNow URLs) will be permanently removed.',
      () => {
        localStorage.removeItem('bkt_settings');
        try { fetch(`${API_BASE}/api/settings`, { method: 'DELETE' }); } catch (_) {}
        showMaintToast('✓ Payment data cleared');
      }
    );
  });

  // ── Release Table Seating ─────────────────────────────────────────────────
  document.getElementById('maint-release-seating-btn').addEventListener('click', () => {
    openSeatingPicker(
      'Release Table Seating',
      'Tap the tables you want to release, then confirm.'
    );
  });
}

function showMaintToast(msg) {
  // Reuse or create a simple toast
  let toast = document.getElementById('maint-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'maint-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.getBoundingClientRect();
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2200);
}

document.addEventListener('DOMContentLoaded', init);
