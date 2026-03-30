'use strict';

let adminKey = sessionStorage.getItem('saas_admin_key') || '';

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
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--red)">Failed to load</td></tr>'; return; }
    const tenants = await res.json();

    if (tenants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No tenants yet</td></tr>';
      return;
    }

    tbody.innerHTML = tenants.map(t => `
      <tr>
        <td>${t.name}</td>
        <td><code>${t.slug}</code></td>
        <td><code>${t.dbName}</code></td>
        <td class="status-${t.status}">${t.status}</td>
        <td>
          ${t.status === 'active'
            ? `<button class="btn btn-sm btn-dim" onclick="toggleTenant('${t.slug}', 'disabled')">Disable</button>`
            : `<button class="btn btn-sm btn-green" onclick="toggleTenant('${t.slug}', 'active')">Enable</button>`
          }
        </td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--red)">Error loading tenants</td></tr>';
  }
}

// ─── Create tenant ───────────────────────────────────────────────────────────

document.getElementById('create-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-name').value.trim();
  const slug = document.getElementById('new-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const msg = document.getElementById('create-msg');

  if (!name || !slug) { msg.textContent = 'Name and slug required'; msg.className = 'msg msg-err'; msg.classList.remove('hidden'); return; }

  try {
    const res = await fetch('/api/admin/tenants', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ slug, name }),
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = `Created: ${data.name} (${data.dbName})`;
      msg.className = 'msg msg-ok';
      document.getElementById('new-name').value = '';
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
