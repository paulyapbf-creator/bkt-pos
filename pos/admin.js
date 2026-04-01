'use strict';

let adminKey = sessionStorage.getItem('saas_admin_key') || '';
let currentDetailSlug = null;

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'x-admin-key': adminKey };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

document.getElementById('auth-btn').addEventListener('click', async () => {
  const input = document.getElementById('admin-key-input');
  adminKey = input.value.trim();
  if (!adminKey) return;

  try {
    const res = await fetch('/api/admin/tenants', { headers: apiHeaders() });
    if (res.ok) {
      sessionStorage.setItem('saas_admin_key', adminKey);
      document.getElementById('auth-gate').classList.add('hidden');
      document.getElementById('main').classList.remove('hidden');
      loadTenants();
      loadDemoMenuInfo();
    } else {
      document.getElementById('auth-err').classList.remove('hidden');
    }
  } catch {
    document.getElementById('auth-err').classList.remove('hidden');
  }
});

// Auto-login if key in session
(async function init() {
  if (adminKey) {
    try {
      const res = await fetch('/api/admin/tenants', { headers: apiHeaders() });
      if (res.ok) {
        document.getElementById('auth-gate').classList.add('hidden');
        document.getElementById('main').classList.remove('hidden');
        loadTenants();
        loadDemoMenuInfo();
        return;
      }
    } catch {}
  }
})();

// ─── Load tenants ────────────────────────────────────────────────────────────

async function loadTenants() {
  const tbody = document.getElementById('tenant-list');
  try {
    const res = await fetch('/api/admin/tenants', { headers: apiHeaders() });
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="4" style="color:var(--red)">Failed to load</td></tr>'; return; }
    const tenants = await res.json();

    if (tenants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">No tenants yet</td></tr>';
      return;
    }

    const baseUrl = location.origin;
    tbody.innerHTML = tenants.map(t => {
      const posLink = `${baseUrl}/?store=${t.slug}`;
      const kdsLink = `${baseUrl}/kds/?tenant=${t.slug}`;
      return `
      <tr>
        <td>
          <strong>${t.name}</strong><br>
          <code style="font-size:11px;color:var(--muted)">${t.slug}</code>
        </td>
        <td style="font-size:12px;line-height:1.8;">
          <a href="#" onclick="openTenantPOS('${t.slug}')" style="color:var(--green);text-decoration:none;cursor:pointer;">POS Link</a><br>
          <a href="${kdsLink}" target="_blank" style="color:var(--green);text-decoration:none;">KDS Link</a>
        </td>
        <td class="status-${t.status}">${t.status}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm btn-green" onclick="viewTenant('${t.slug}')">View</button>
          ${t.status === 'active'
            ? `<button class="btn btn-sm btn-dim" onclick="toggleTenant('${t.slug}', 'disabled')">Disable</button>`
            : `<button class="btn btn-sm btn-green" onclick="toggleTenant('${t.slug}', 'active')">Enable</button>`
          }
        </td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--red)">Error loading tenants</td></tr>';
  }
}

// ─── Create tenant ───────────────────────────────────────────────────────────

document.getElementById('create-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-name').value.trim();
  const slug = document.getElementById('new-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const msg = document.getElementById('create-msg');

  const address = document.getElementById('new-address').value.trim();
  if (!name || !slug) { msg.textContent = 'Name and slug required'; msg.className = 'msg msg-err'; msg.classList.remove('hidden'); return; }

  try {
    const res = await fetch('/api/admin/tenants', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ slug, name, address }),
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = `Created: ${data.name} (${data.dbName})`;
      msg.className = 'msg msg-ok';
      document.getElementById('new-name').value = '';
      document.getElementById('new-address').value = '';
      document.getElementById('new-slug').value = '';
      loadTenants();
    } else {
      msg.textContent = data.error || 'Failed';
      msg.className = 'msg msg-err';
    }
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    msg.className = 'msg msg-err';
  }
  msg.classList.remove('hidden');
});

// ─── Toggle tenant status ────────────────────────────────────────────────────

async function toggleTenant(slug, status) {
  await fetch(`/api/admin/tenants/${slug}`, {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ status }),
  });
  loadTenants();
}

// ─── View tenant detail ──────────────────────────────────────────────────────

const fmtRM = n => `RM ${n.toFixed(2)}`;

function getDateRange(period) {
  const now = new Date();
  const startOfDay = d => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; };
  const endOfDay = d => { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; };

  switch (period) {
    case 'today': return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() };
    case 'week': {
      const mon = new Date(now);
      mon.setDate(mon.getDate() - mon.getDay() + (mon.getDay() === 0 ? -6 : 1));
      return { from: startOfDay(mon).getTime(), to: endOfDay(now).getTime() };
    }
    case 'month': return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)).getTime(), to: endOfDay(now).getTime() };
    case 'all': return {};
    default: return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() };
  }
}

async function viewTenant(slug) {
  currentDetailSlug = slug;
  document.getElementById('detail-panel').classList.remove('hidden');
  // Set first period button active
  document.querySelectorAll('.detail-period').forEach(b => b.classList.remove('active'));
  document.querySelector('.detail-period[data-period="today"]').classList.add('active');
  await loadTenantSales(slug, 'today');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  currentDetailSlug = null;
}

async function loadTenantSales(slug, period) {
  const range = getDateRange(period);
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);

  const kpis = document.getElementById('detail-kpis');
  const methods = document.getElementById('detail-methods');
  const items = document.getElementById('detail-items');

  kpis.innerHTML = '<div style="color:var(--muted);font-size:13px;">Loading...</div>';

  try {
    const res = await fetch(`/api/admin/tenants/${slug}/sales?${params}`, { headers: apiHeaders() });
    if (!res.ok) { kpis.innerHTML = '<div style="color:var(--red)">Failed to load</div>'; return; }
    const data = await res.json();

    document.getElementById('detail-title').textContent = data.tenantName;
    document.getElementById('detail-name').value = data.tenantName || '';
    document.getElementById('detail-address').value = data.tenantAddress || '';
    document.getElementById('detail-demo').checked = !!data.demoMenu;

    // KPIs
    kpis.innerHTML = `
      <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value green">${fmtRM(data.totalRevenue)}</div></div>
      <div class="kpi"><div class="kpi-label">Orders</div><div class="kpi-value">${data.orderCount}</div></div>
      <div class="kpi"><div class="kpi-label">Avg Order</div><div class="kpi-value">${fmtRM(data.avgOrder)}</div></div>
    `;

    // Payment methods
    const methodLabels = { cash: 'Cash', tng: 'TNG', duitnow: 'DuitNow', card: 'Card' };
    const methodEntries = Object.entries(data.byMethod);
    if (methodEntries.length === 0) {
      methods.innerHTML = '<div style="color:var(--muted);font-size:13px;">No data</div>';
    } else {
      methods.innerHTML = methodEntries.map(([m, d]) =>
        `<div class="method-row"><span>${methodLabels[m] || m} <span style="color:var(--muted)">(${d.count})</span></span><span style="font-weight:600">${fmtRM(d.total)}</span></div>`
      ).join('');
    }

    // Top items
    if (data.topItems.length === 0) {
      items.innerHTML = '<div style="color:var(--muted);font-size:13px;">No data</div>';
    } else {
      items.innerHTML = data.topItems.map(it =>
        `<div class="item-row"><span>${it.name} <span style="color:var(--muted)">x${it.qty}</span></span><span style="font-weight:600">${fmtRM(it.revenue)}</span></div>`
      ).join('');
    }
  } catch (e) {
    kpis.innerHTML = `<div style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

// Save store info button
document.getElementById('save-info-btn').addEventListener('click', async () => {
  if (!currentDetailSlug) return;
  const name = document.getElementById('detail-name').value.trim();
  const address = document.getElementById('detail-address').value.trim();
  const msg = document.getElementById('save-info-msg');

  const res = await fetch(`/api/admin/tenants/${currentDetailSlug}`, {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ name, address }),
  });
  if (res.ok) {
    msg.textContent = 'Saved';
    msg.className = 'msg msg-ok';
    document.getElementById('detail-title').textContent = name;
    loadTenants(); // refresh table
  } else {
    msg.textContent = 'Failed to save';
    msg.className = 'msg msg-err';
  }
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
});

// Demo mode toggle
document.getElementById('detail-demo').addEventListener('change', async (e) => {
  if (!currentDetailSlug) return;
  await fetch(`/api/admin/tenants/${currentDetailSlug}/demo`, {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ enabled: e.target.checked }),
  });
});

// Copy tenant menu to demo DB
async function copyMenuToDemo() {
  if (!currentDetailSlug) return;
  if (!confirm('Copy this tenant\'s menu to the shared demo database? This will replace the existing demo menu.')) return;
  const msg = document.getElementById('copy-demo-msg');
  try {
    const res = await fetch(`/api/admin/demo/copy-from/${currentDetailSlug}`, {
      method: 'POST',
      headers: apiHeaders(),
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = `Copied ${data.items} items to demo DB`;
      msg.className = 'msg msg-ok';
      loadDemoMenuInfo();
    } else {
      msg.textContent = data.error || 'Failed';
      msg.className = 'msg msg-err';
    }
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    msg.className = 'msg msg-err';
  }
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 3000);
}

// Load demo menu info
async function loadDemoMenuInfo() {
  const el = document.getElementById('demo-menu-info');
  try {
    const res = await fetch('/api/admin/demo/menu', { headers: apiHeaders() });
    if (res.ok) {
      const items = await res.json();
      el.textContent = items.length > 0 ? `${items.length} menu items in demo database` : 'Demo database is empty. Copy a tenant\'s menu to populate it.';
    }
  } catch { el.textContent = 'Could not load demo info'; }
}

// ─── Open tenant POS (clears old session first) ─────────────────────────────

function openTenantPOS(slug) {
  window.open(`${location.origin}/?store=${slug}&fresh=1`, '_blank');
}

// ─── AI Menu Import ──────────────────────────────────────────────────────────

let extractedItems = [];

document.getElementById('import-file').addEventListener('change', (e) => {
  document.getElementById('import-extract-btn').disabled = !e.target.files.length;
  document.getElementById('import-preview').classList.add('hidden');
  extractedItems = [];
});

document.getElementById('import-extract-btn').addEventListener('click', async () => {
  const file = document.getElementById('import-file').files[0];
  if (!file || !currentDetailSlug) return;

  const status = document.getElementById('import-status');
  status.textContent = 'Extracting menu items with AI... please wait';
  status.className = 'msg msg-ok';
  status.classList.remove('hidden');
  document.getElementById('import-extract-btn').disabled = true;

  try {
    // Convert file to base64
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const fileBase64 = btoa(binary);

    const res = await fetch('/api/admin/menu-import/extract', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        fileBase64,
        contentType: file.type || 'application/octet-stream',
        fileName: file.name,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Extraction failed';
      status.className = 'msg msg-err';
      document.getElementById('import-extract-btn').disabled = false;
      return;
    }

    extractedItems = data.items;
    status.textContent = `Extracted ${data.rawCount} items. Review below and click Import.`;
    status.className = 'msg msg-ok';

    // Render preview table
    const tbody = document.getElementById('import-items');
    tbody.innerHTML = extractedItems.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.name}</td>
        <td>${it.nameZh || ''}</td>
        <td>RM ${it.price.toFixed(2)}</td>
        <td>${it.category}</td>
      </tr>
    `).join('');
    document.getElementById('import-count').textContent = `${extractedItems.length} items extracted`;
    document.getElementById('import-preview').classList.remove('hidden');
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.className = 'msg msg-err';
  }
  document.getElementById('import-extract-btn').disabled = false;
});

document.getElementById('import-confirm-btn').addEventListener('click', async () => {
  if (!extractedItems.length || !currentDetailSlug) return;
  const mode = document.getElementById('import-mode').value;

  if (!confirm(`${mode === 'replace' ? 'Replace' : 'Append to'} menu with ${extractedItems.length} items?`)) return;

  const status = document.getElementById('import-status');
  try {
    const res = await fetch(`/api/admin/tenants/${currentDetailSlug}/menu-import`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ items: extractedItems, mode }),
    });
    const data = await res.json();
    if (res.ok) {
      status.textContent = `Imported ${data.count} items successfully!`;
      status.className = 'msg msg-ok';
      document.getElementById('import-preview').classList.add('hidden');
      document.getElementById('import-file').value = '';
      extractedItems = [];
    } else {
      status.textContent = data.error || 'Import failed';
      status.className = 'msg msg-err';
    }
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.className = 'msg msg-err';
  }
});

// ─── Camera Capture ─────────────────────────────────────────────────────────

let cameraStream = null;

document.getElementById('camera-btn').addEventListener('click', async () => {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');
  const msg = document.getElementById('camera-msg');

  modal.classList.remove('hidden');
  showCameraLive();
  msg.classList.add('hidden');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = cameraStream;
  } catch (e) {
    msg.textContent = 'Camera access denied or not available. Make sure you are using HTTPS.';
    msg.className = 'msg msg-err';
    msg.classList.remove('hidden');
  }
});

function showCameraLive() {
  document.getElementById('camera-video').style.display = 'block';
  document.getElementById('camera-preview').style.display = 'none';
  document.getElementById('camera-controls').style.display = 'flex';
  document.getElementById('camera-review').style.display = 'none';
}

function showCameraReview() {
  document.getElementById('camera-video').style.display = 'none';
  document.getElementById('camera-preview').style.display = 'block';
  document.getElementById('camera-controls').style.display = 'none';
  document.getElementById('camera-review').style.display = 'flex';
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('camera-video');
  video.srcObject = null;
}

document.getElementById('camera-snap-btn').addEventListener('click', () => {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  const preview = document.getElementById('camera-preview');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  preview.src = dataUrl;
  showCameraReview();
});

document.getElementById('camera-retake-btn').addEventListener('click', () => {
  showCameraLive();
});

document.getElementById('camera-close-btn').addEventListener('click', () => {
  stopCamera();
  document.getElementById('camera-modal').classList.add('hidden');
});

document.getElementById('camera-use-btn').addEventListener('click', async () => {
  if (!currentDetailSlug) return;

  const canvas = document.getElementById('camera-canvas');
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const fileBase64 = dataUrl.split(',')[1];

  stopCamera();
  document.getElementById('camera-modal').classList.add('hidden');

  const status = document.getElementById('import-status');
  status.textContent = 'Extracting menu items from captured photo... please wait';
  status.className = 'msg msg-ok';
  status.classList.remove('hidden');

  try {
    const res = await fetch('/api/admin/menu-import/extract', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        fileBase64,
        contentType: 'image/jpeg',
        fileName: 'camera-capture.jpg',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Extraction failed';
      status.className = 'msg msg-err';
      return;
    }

    extractedItems = data.items;
    status.textContent = `Extracted ${data.rawCount} items from photo. Review below and click Import.`;
    status.className = 'msg msg-ok';

    const tbody = document.getElementById('import-items');
    tbody.innerHTML = extractedItems.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.name}</td>
        <td>${it.nameZh || ''}</td>
        <td>RM ${it.price.toFixed(2)}</td>
        <td>${it.category}</td>
      </tr>
    `).join('');
    document.getElementById('import-count').textContent = `${extractedItems.length} items extracted`;
    document.getElementById('import-preview').classList.remove('hidden');
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.className = 'msg msg-err';
  }
});

// Period filter buttons
document.querySelectorAll('.detail-period').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentDetailSlug) return;
    document.querySelectorAll('.detail-period').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadTenantSales(currentDetailSlug, btn.dataset.period);
  });
});

// ─── Reset tenant data ───────────────────────────────────────────────────────

async function resetTenant(what) {
  if (!currentDetailSlug) return;
  const labels = { orders: 'order history', bills: 'active bills', kds: 'KDS history', menu: 'menu/product master', all: 'ALL data (including users & menu)' };
  if (!confirm(`Reset ${labels[what] || what} for this tenant? This cannot be undone.`)) return;

  const msg = document.getElementById('reset-msg');
  try {
    const res = await fetch(`/api/admin/tenants/${currentDetailSlug}/reset`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ what }),
    });
    if (res.ok) {
      msg.textContent = `Reset ${what} complete`;
      msg.className = 'msg msg-ok';
      // Reload sales to reflect cleared data
      const activeBtn = document.querySelector('.detail-period.active');
      loadTenantSales(currentDetailSlug, activeBtn ? activeBtn.dataset.period : 'today');
    } else {
      const data = await res.json();
      msg.textContent = data.error || 'Failed';
      msg.className = 'msg msg-err';
    }
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    msg.className = 'msg msg-err';
  }
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 3000);
}
