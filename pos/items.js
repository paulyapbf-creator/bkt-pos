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

const LANG_NAME_FIELDS = { en: 'name', zh: 'nameZh', th: 'nameTh', vi: 'nameVi', ms: 'nameMs', km: 'nameKm', id: 'nameId' };

function localName(item) {
  if (typeof getLang === 'function') {
    const lang = getLang();
    const field = LANG_NAME_FIELDS[lang];
    if (field && item[field]) return item[field];
  }
  // Fallback: nameZh → name
  return item.nameZh || item.name || '';
}

function catName(id) {
  if (typeof t === 'function') return t('cat_' + id);
  return CATEGORIES.find(c => c.id === id)?.name || id;
}

function renderTable() {
  const q = searchQ.toLowerCase();
  const filtered = q
    ? items.filter(i => i.name.toLowerCase().includes(q) || (i.nameZh || '').includes(q) ||
                        localName(i).toLowerCase().includes(q) || catName(i.category).toLowerCase().includes(q))
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
        <div class="td-name-zh">${localName(item)}</div>
        <div class="td-name-en">${item.name}</div>
      </td>
      <td class="td-price">${getCurrency()} ${item.price.toFixed(2)}</td>
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
  if (!confirm(`Delete "${localName(item)} / ${item.name}"?\nThis cannot be undone.`)) return;
  items = items.filter(i => i.id !== id);
  persist();
  renderTable();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  // ── Auth gate ──
  const session = getSession();
  if (!session) {
    showLoginOverlay(function() { location.reload(); });
    return;
  }
  applySessionToItemsUI(session);

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
    users:       document.getElementById('panel-users'),
    settings:    document.getElementById('panel-settings'),
    maintenance: document.getElementById('panel-maintenance'),
  };

  function switchTab(tabName) {
    // Block restricted tabs for cashiers
    const sess = getSession();
    if (sess && sess.role !== 'super' && (tabName === 'users' || tabName === 'settings' || tabName === 'maintenance')) return;

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

  // ── User Management (super only) ────────────────────────────────────────
  if (session.role === 'super') {
    initUserManagement();
  }
}

function initSettings() {
  const settings = loadSettings();
  const shopNameInput    = document.getElementById('s-shop-name');
  const shopAddressInput = document.getElementById('s-shop-address');
  const tngEnabledInput = document.getElementById('s-tng-enabled');
  const tngLinkInput   = document.getElementById('s-tng-link');
  const tngInput       = document.getElementById('s-tng-url');
  const tngPreview     = document.getElementById('s-tng-preview');
  const duitnowEnabledInput = document.getElementById('s-duitnow-enabled');
  const walletUrlInput      = document.getElementById('s-wallet-url');
  const duitnowProfileInput = document.getElementById('s-duitnow-profile');
  const duitnowTerminalInput = document.getElementById('s-duitnow-terminal');
  const walletReloadBtn     = document.getElementById('s-wallet-reload-btn');
  const duitnowProfileHint  = document.getElementById('s-duitnow-profile-hint');
  const printOrderSlipInput = document.getElementById('s-print-order-slip');
  const printReceiptInput   = document.getElementById('s-print-receipt');
  const printerIpInput   = document.getElementById('s-printer-ip');
  const printerPortInput = document.getElementById('s-printer-port');
  const relayUrlInput    = document.getElementById('s-relay-url');
  const sstEnabledInput  = document.getElementById('s-sst-enabled');
  const sstRateInput     = document.getElementById('s-sst-rate');
  const svcEnabledInput  = document.getElementById('s-svc-enabled');
  const svcRateInput     = document.getElementById('s-svc-rate');
  const awEnabledInput   = document.getElementById('s-aw-enabled');
  const awClientIdInput  = document.getElementById('s-aw-client-id');
  const awApiKeyInput    = document.getElementById('s-aw-api-key');
  const awEnvInput       = document.getElementById('s-aw-env');

  shopNameInput.value    = settings.shopName      || '';
  shopAddressInput.value = settings.shopAddress   || '';
  tngEnabledInput.checked = settings.tngEnabled !== false; // default on
  tngLinkInput.value     = settings.tngPayLink    || '';
  tngInput.value         = settings.tngQrUrl      || '';
  duitnowEnabledInput.checked = !!settings.duitnowEnabled;
  walletUrlInput.value        = settings.walletUrl       || 'http://localhost:4568';
  duitnowTerminalInput.value  = settings.duitnowTerminal || '';
  // Profile options are loaded asynchronously; remember selection
  const _savedProfile         = settings.duitnowProfile || '';
  printOrderSlipInput.checked = settings.printOrderSlip !== false;
  printReceiptInput.checked   = settings.printReceipt !== false;
  printerIpInput.value   = settings.printerIp     || '';
  printerPortInput.value = settings.printerPort   || '9100';
  relayUrlInput.value    = settings.relayUrl       || '';
  sstEnabledInput.checked = !!settings.sstEnabled;
  sstRateInput.value      = settings.sstRate ?? 6;
  svcEnabledInput.checked = !!settings.svcEnabled;
  svcRateInput.value      = settings.svcRate ?? 10;
  awEnabledInput.checked = !!settings.airwallexEnabled;
  awClientIdInput.value  = settings.airwallexClientId || '';
  awApiKeyInput.value    = settings.airwallexApiKey   || '';
  awEnvInput.value       = settings.airwallexEnv      || 'demo';

  function updatePreview(input, preview) {
    const url = input.value.trim();
    if (url) { preview.src = url; preview.classList.remove('hidden'); }
    else { preview.src = ''; preview.classList.add('hidden'); }
  }

  updatePreview(tngInput, tngPreview);

  tngInput.addEventListener('input', () => updatePreview(tngInput, tngPreview));

  async function loadWalletProfiles() {
    const walletUrl = (walletUrlInput.value || '').trim();
    if (!walletUrl) {
      duitnowProfileHint.textContent = 'Set wallet URL first, then click Reload';
      duitnowProfileHint.style.color = '';
      return;
    }
    duitnowProfileHint.textContent = 'Loading profiles...';
    duitnowProfileHint.style.color = '';
    try {
      // Use server proxy to avoid CORS (the server fetches the wallet on behalf of browser)
      const res = await fetch(`${API_BASE}/api/wallet-test/tenants?url=${encodeURIComponent(walletUrl)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const tenants = data.tenants || [];
      const currentVal = duitnowProfileInput.value || _savedProfile;
      duitnowProfileInput.innerHTML = '<option value="">-- Select profile --</option>' +
        tenants.map(t => `<option value="${t.name}">${t.name} (${t.activeGateway})</option>`).join('');
      if (currentVal && tenants.some(t => t.name === currentVal)) {
        duitnowProfileInput.value = currentVal;
      }
      duitnowProfileHint.textContent = `Loaded ${tenants.length} profile(s)`;
      duitnowProfileHint.style.color = 'var(--green,#27ae60)';
    } catch (e) {
      duitnowProfileHint.textContent = `Failed: ${e.message}. Check wallet URL and that the wallet service is running.`;
      duitnowProfileHint.style.color = 'var(--red,#C0392B)';
    }
  }

  walletReloadBtn.addEventListener('click', loadWalletProfiles);
  walletUrlInput.addEventListener('change', loadWalletProfiles);
  loadWalletProfiles();

  function gatherSettings() {
    return {
      shopName:     shopNameInput.value.trim(),
      shopAddress:  shopAddressInput.value.trim(),
      tngEnabled:   tngEnabledInput.checked,
      tngPayLink:   tngLinkInput.value.trim(),
      tngQrUrl:     tngInput.value.trim(),
      duitnowEnabled: duitnowEnabledInput.checked,
      walletUrl:       walletUrlInput.value.trim(),
      duitnowProfile:  duitnowProfileInput.value.trim(),
      duitnowTerminal: duitnowTerminalInput.value.trim(),
      printOrderSlip: printOrderSlipInput.checked,
      printReceipt:   printReceiptInput.checked,
      printerIp:    printerIpInput.value.trim(),
      printerPort:  printerPortInput.value.trim() || '9100',
      relayUrl:     relayUrlInput.value.trim(),
      sstEnabled:   sstEnabledInput.checked,
      sstRate:      parseFloat(sstRateInput.value) || 6,
      svcEnabled:   svcEnabledInput.checked,
      svcRate:      parseFloat(svcRateInput.value) || 10,
      airwallexEnabled:  awEnabledInput.checked,
      airwallexClientId: awClientIdInput.value.trim(),
      airwallexApiKey:   awApiKeyInput.value.trim(),
      airwallexEnv:      awEnvInput.value,
    };
  }

  document.getElementById('s-save-btn').addEventListener('click', () => {
    saveSettings(gatherSettings());
    const msg = document.getElementById('s-saved-msg');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2000);
  });

  // Test print button
  document.getElementById('s-test-print-btn').addEventListener('click', async () => {
    const testMsg = document.getElementById('s-test-msg');
    const ip = printerIpInput.value.trim();
    if (!ip) { testMsg.textContent = 'Enter printer IP first'; return; }

    // Save current settings first so the server can read them
    saveSettings(gatherSettings());

    testMsg.textContent = 'Sending...';

    // Send JSON test job to server (server builds ESC/POS with GBK)
    let ok = false;
    let escposB64 = null;
    try {
      const res = await fetch(`${API_BASE}/api/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'test',
          printerIp: ip,
          printerPort: parseInt(printerPortInput.value, 10) || 9100,
        }),
      });
      const result = await res.json();
      if (result.escpos) escposB64 = result.escpos;
      if (res.ok) ok = true;
    } catch (_) {}

    // Try Capacitor native PrintBridge (Android app)
    if (!ok && escposB64 && (window.Capacitor?.isNativePlatform() || navigator.userAgent.includes('BKT-POS-App'))) {
      try {
        const { PrintBridge } = (window.Capacitor?.Plugins || {});
        await PrintBridge.printRaw({
          data: escposB64,
          ip:   ip,
          port: parseInt(printerPortInput.value, 10) || 9100,
        });
        ok = true;
      } catch (_) {}
    }

    // Try relay with server-built bytes
    if (!ok && escposB64) {
      const relay = relayUrlInput.value.trim() || 'http://localhost:9101';
      try {
        const res = await fetch(`${relay}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ printerIp: ip, printerPort: parseInt(printerPortInput.value, 10) || 9100, data: escposB64 }),
        });
        if (res.ok) ok = true;
      } catch (_) {}
    }

    testMsg.textContent = ok ? '✓ Print sent!' : '✗ Failed — check IP/port and server';
    setTimeout(() => { testMsg.textContent = ''; }, 4000);
  });
}

function initBuildInfo() {
  const el = document.getElementById('maint-build-info');
  if (!el) return;
  fetch(`${API_BASE}/api/version`).then(r => r.json()).then(d => {
    el.textContent = `Server: ${d.version}`;
  }).catch(() => {
    el.textContent = 'Server: unavailable';
  });
}

function initMaintenance() {
  initBuildInfo();
  const modal     = document.getElementById('maint-confirm-modal');
  const msgEl     = document.getElementById('maint-confirm-msg');
  const okBtn     = document.getElementById('maint-confirm-ok');
  const cancelBtn = document.getElementById('maint-confirm-cancel');
  const closeBtn  = document.getElementById('maint-confirm-close');

  function closeConfirm() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  cancelBtn.addEventListener('click', closeConfirm);
  closeBtn.addEventListener('click',  closeConfirm);
  modal.addEventListener('click', e => { if (e.target === modal) closeConfirm(); });

  // ── Network Info ──────────────────────────────────────────────────────────
  {
    const el = document.getElementById('network-urls');
    if (el) {
      const base = location.origin;
      el.innerHTML = `<div>
        <strong>POS:</strong> <span style="user-select:all">${base}</span><br>
        <strong>KDS:</strong> <span style="user-select:all">${base}/kds/</span><br>
        <strong>Report:</strong> <span style="user-select:all">${base}/report.html</span>
      </div>`;
    }
  }

  // ── Sync to Cloud ─────────────────────────────────────────────────────────
  document.getElementById('maint-sync-btn').addEventListener('click', async () => {
    const msg = document.getElementById('maint-sync-msg');
    msg.textContent = 'Syncing...';
    try {
      const res = await fetch(`${API_BASE}/api/sync`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        msg.textContent = `✓ Synced ${data.orders} orders to cloud`;
      } else {
        msg.textContent = `✗ ${data.error || 'Sync failed'}`;
      }
    } catch (e) {
      msg.textContent = '✗ Could not reach server';
    }
    setTimeout(() => { msg.textContent = ''; }, 5000);
  });

  // ── Reset & Go Live ───────────────────────────────────────────────────────
  document.getElementById('maint-reset-live-btn').addEventListener('click', () => {
    document.getElementById('maint-confirm-title').textContent = '🚀 Reset & Go Live';
    msgEl.textContent = 'This will clear all active orders, kitchen data, sales history and KDS history. Menu items and payment settings will be kept.';
    document.getElementById('maint-table-picker').classList.add('hidden');
    okBtn.textContent = 'Yes, Reset & Go Live';

    okBtn.onclick = async () => {
      closeConfirm();
      try {
        await Promise.all([
          fetch(`${API_BASE}/api/bills`,       { method: 'DELETE' }),
          fetch(`${API_BASE}/api/history`,     { method: 'DELETE' }),
          fetch(`${API_BASE}/api/kds-history`, { method: 'DELETE' }),
        ]);
      } catch (_) {}
      localStorage.removeItem('bkt_active_bills');
      localStorage.removeItem('bkt_order_history');
      const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bkt_pos') : null;
      if (ch) { ch.postMessage({ type: 'bill:cleared', table: '*' }); ch.close(); }
      showMaintToast('✓ System reset — ready to go live!');
    };

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
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

// ─── Auth UI for Items page ──────────────────────────────────────────────────

function applySessionToItemsUI(session) {
  const userBtnName = document.getElementById('user-btn-name');
  if (userBtnName) userBtnName.textContent = session.name;

  const userBtn = document.getElementById('user-btn');
  if (userBtn) {
    userBtn.addEventListener('click', () => {
      if (confirm(`Logout ${session.name}?`)) {
        clearSession();
        location.reload();
      }
    });
  }

  // Hide Users, Settings & Maintenance tabs for cashiers
  if (session.role !== 'super') {
    document.querySelectorAll('.admin-tab').forEach(tab => {
      if (tab.dataset.tab === 'users' || tab.dataset.tab === 'settings' || tab.dataset.tab === 'maintenance') {
        tab.style.display = 'none';
      }
    });
  }
}

// ─── User CRUD ───────────────────────────────────────────────────────────────

let _users = [];
let _editingUserId = null;

async function loadUsers() {
  try {
    const res = await fetch(`${API_BASE}/api/users`);
    if (res.ok) {
      const users = await res.json();
      if (users && users.length > 0) _users = users;
    }
  } catch {}
  renderUsersList();
}

function renderUsersList() {
  const wrap = document.getElementById('users-list');
  if (!wrap) return;

  if (_users.length === 0) {
    wrap.innerHTML = '<p style="color:var(--muted);font-size:13px;">No users found.</p>';
    return;
  }

  wrap.innerHTML = _users.map(u => `
    <div class="user-card">
      <div class="user-card-icon">${u.name.charAt(0).toUpperCase()}</div>
      <div class="user-card-info">
        <div class="user-card-name">${u.name}</div>
        <span class="login-role-badge role-${u.role}">${u.role === 'super' ? 'Admin' : 'Cashier'}</span>
      </div>
      <div class="user-card-actions">
        <button class="row-btn btn-edit" data-uid="${u.id}">Edit</button>
        <button class="row-btn btn-del" data-uid="${u.id}">Delete</button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openUserModal(_users.find(u => u.id === btn.dataset.uid)));
  });
  wrap.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.uid));
  });
}

function openUserModal(user) {
  _editingUserId = user ? user.id : null;
  document.getElementById('user-modal-title').textContent = user ? 'Edit User' : 'Add User';
  document.getElementById('uf-name').value = user ? user.name : '';
  document.getElementById('uf-pin').value = user ? user.pin : '';
  document.getElementById('uf-role').value = user ? user.role : 'cashier';
  document.getElementById('user-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('uf-name').focus();
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function saveUser() {
  const name = document.getElementById('uf-name').value.trim();
  const pin  = document.getElementById('uf-pin').value.trim();
  const role = document.getElementById('uf-role').value;

  if (!name || !pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    alert('Please enter a name and a 4-digit PIN.');
    return;
  }

  try {
    if (_editingUserId) {
      await fetch(`${API_BASE}/api/users/${_editingUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin, role }),
      });
    } else {
      await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin, role }),
      });
    }
  } catch {}

  closeUserModal();
  await loadUsers();
}

async function deleteUser(id) {
  const user = _users.find(u => u.id === id);
  if (!user) return;
  if (!confirm(`Delete user "${user.name}"?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Cannot delete user');
      return;
    }
  } catch {}

  await loadUsers();
}

function initUserManagement() {
  const addBtn = document.getElementById('add-user-btn');
  if (addBtn) addBtn.addEventListener('click', () => openUserModal());

  const closeBtn = document.getElementById('user-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeUserModal);

  const cancelBtn = document.getElementById('user-modal-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeUserModal);

  const saveBtn = document.getElementById('user-modal-save');
  if (saveBtn) saveBtn.addEventListener('click', saveUser);

  const modal = document.getElementById('user-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeUserModal(); });

  loadUsers();
}

document.addEventListener('DOMContentLoaded', init);
