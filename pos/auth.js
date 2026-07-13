'use strict';
// ─── Shared Auth Module ──────────────────────────────────────────────────────
// Shared between index.html and items.html for PIN-based user authentication.
// Supports SaaS multi-tenant: tenant selection before user login.

// ─── Global fetch override: always send x-tenant header ─────────────────────
const _origFetch = window.fetch;
window.fetch = function(url, opts = {}) {
  const tenant = localStorage.getItem('bkt_tenant_session');
  if (tenant) {
    try {
      const t = JSON.parse(tenant);
      if (t && t.slug) {
        opts.headers = opts.headers || {};
        if (opts.headers instanceof Headers) {
          if (!opts.headers.has('x-tenant')) opts.headers.set('x-tenant', t.slug);
        } else {
          if (!opts.headers['x-tenant']) opts.headers['x-tenant'] = t.slug;
        }
      }
    } catch {}
  }
  return _origFetch.call(this, url, opts);
};

const AUTH_SESSION_KEY = 'bkt_auth_session';
const TENANT_SESSION_KEY = 'bkt_tenant_session';

// ─── Tenant session helpers ─────────────────────────────────────────────────

function getTenantSession() {
  try {
    const raw = localStorage.getItem(TENANT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setTenantSession(tenant) {
  localStorage.setItem(TENANT_SESSION_KEY, JSON.stringify(tenant));
  document.cookie = `bkt_tenant=${tenant.slug}; path=/; max-age=86400; SameSite=Strict`;
}

function clearTenantSession() {
  localStorage.removeItem(TENANT_SESSION_KEY);
  document.cookie = 'bkt_tenant=; path=/; max-age=0';
}

// ─── Session helpers ─────────────────────────────────────────────────────────

function getSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(user) {
  const tenant = getTenantSession();
  const session = {
    userId: user.id,
    name: user.name,
    role: user.role,
    loginTime: Date.now(),
    tenantSlug: tenant ? tenant.slug : null,
    tenantName: tenant ? tenant.name : null,
  };
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  // Tenant session is intentionally NOT cleared on logout — the store/tenant
  // selection persists across user logins on the same device.
  // Only a super-user switching stores (showTenantSelectScreen) clears it.
}

function isSuper() {
  const s = getSession();
  return s && s.role === 'super';
}

// ─── Server base URL ─────────────────────────────────────────────────────────

function getServerBase() {
  try {
    const s = JSON.parse(localStorage.getItem('bkt_settings') || '{}');
    return (s.serverUrl || 'https://rgtech.ai').replace(/\/$/, '');
  } catch { return 'https://rgtech.ai'; }
}

// ─── Fetch users from server ─────────────────────────────────────────────────

const DEFAULT_USERS = [{ id: 'user_default', name: 'Admin', pin: '1234', role: 'super' }];

async function loadLoginUsers(base) {
  const b = base || getServerBase();
  try {
    const res = await fetch(`${b}/api/users`);
    if (res.ok) {
      const users = await res.json();
      if (users && users.length > 0) return users;
    }
  } catch {}
  return DEFAULT_USERS;
}

// ─── Login UI ────────────────────────────────────────────────────────────────

let _loginUsers = [];
let _selectedUser = null;
let _pinDigits = [];
let _onLoginSuccess = null;

async function showLoginOverlay(onSuccess) {
  _onLoginSuccess = onSuccess;
  const overlay = document.getElementById('login-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const base = getServerBase();

  // SaaS mode: resolve tenant from URL ?store= param
  const urlParams = new URLSearchParams(location.search);
  const storeParam = urlParams.get('store');
  if (urlParams.get('fresh')) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(TENANT_SESSION_KEY);
  }
  if (storeParam) {
    try {
      const res = await fetch(`${base}/api/tenants/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: storeParam }),
      });
      if (res.ok) {
        const tenant = await res.json();
        setTenantSession(tenant);
        _loginUsers = await loadLoginUsers(base);
        renderLoginUserList();
        return;
      }
    } catch {}
  }

  // Check if tenant already set in session (returning user)
  const existingTenant = getTenantSession();
  if (existingTenant && existingTenant.slug) {
    try {
      await fetch(`${base}/api/tenants/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: existingTenant.slug }),
      });
    } catch {}
    _loginUsers = await loadLoginUsers(base);
    renderLoginUserList();
    return;
  }

  // Single-tenant mode: go straight to user list
  _loginUsers = await loadLoginUsers(base);
  renderLoginUserList();
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── User list ───────────────────────────────────────────────────────────────

function renderLoginUserList() {
  const container = document.getElementById('login-content');
  if (!container) return;

  _selectedUser = null;
  _pinDigits = [];

  const userButtons = _loginUsers.length > 0
    ? _loginUsers.map(u => `
        <button class="login-user-btn" data-user-id="${u.id}">
          <span class="login-user-icon">${u.name.charAt(0).toUpperCase()}</span>
          <span class="login-user-name">${u.name}</span>
          <span class="login-role-badge role-${u.role}">${u.role === 'super' ? 'Admin' : 'Cashier'}</span>
        </button>
      `).join('')
    : '<p style="text-align:center;color:#aaa;font-size:14px;">No users found. Check server connection.</p>';

  const tenant = getTenantSession();
  container.innerHTML = `
    <div class="login-title">${tenant && tenant.name ? tenant.name + ' — ' : ''}Who's working today?</div>
    <div class="login-user-list">
      ${userButtons}
    </div>
    <div style="text-align:center;margin-top:20px;">
      <button id="super-user-btn" style="background:none;border:none;color:#666;font-size:12px;cursor:pointer;padding:4px 8px;">🔑 Super User</button>
    </div>
  `;

  container.querySelectorAll('.login-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = _loginUsers.find(u => u.id === btn.dataset.userId);
      if (user) showPinEntry(user);
    });
  });

  document.getElementById('super-user-btn').addEventListener('click', showSuperUserLogin);
}

function showSuperUserLogin() {
  const container = document.getElementById('login-content');
  if (!container) return;

  container.innerHTML = `
    <button class="login-back-btn" id="su-back-btn">&larr; Back</button>
    <div class="login-title">Super User Login</div>
    <div style="margin:24px 0 0;display:flex;flex-direction:column;gap:12px;">
      <input type="password" id="su-pw-input" placeholder="Enter super user password"
        style="background:var(--header,#1a1a2e);color:var(--text,#fff);border:1px solid #444;border-radius:8px;padding:13px 14px;font-size:15px;width:100%;box-sizing:border-box;outline:none;">
      <button id="su-login-btn"
        style="background:#C0392B;color:#fff;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;">
        Login
      </button>
      <div id="su-error" style="color:#e74c3c;font-size:13px;text-align:center;display:none;"></div>
    </div>
  `;

  document.getElementById('su-back-btn').addEventListener('click', renderLoginUserList);

  async function doSuperLogin() {
    const pw = document.getElementById('su-pw-input').value;
    const errEl = document.getElementById('su-error');
    errEl.style.display = 'none';
    if (!pw) return;
    // Resolve server base URL: prefer stored setting, fallback to page origin
    const base = getServerBase();
    const isLocalhost = base.startsWith('http://localhost');
    try {
      const res = await fetch(`${base}/api/super-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        const data = await res.json();
        showTenantSelectScreen(data.tenants || [], base);
      } else {
        errEl.textContent = 'Incorrect password. Try again.';
        errEl.style.display = 'block';
        document.getElementById('su-pw-input').value = '';
        document.getElementById('su-pw-input').focus();
      }
    } catch {
      if (isLocalhost) {
        errEl.textContent = 'Server not reachable. Set Server URL in Setup \u2192 System Settings first.';
      } else {
        errEl.textContent = 'Cannot reach server. Check your connection.';
      }
      errEl.style.display = 'block';
    }
  }

  document.getElementById('su-login-btn').addEventListener('click', doSuperLogin);
  document.getElementById('su-pw-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSuperLogin();
  });
  setTimeout(() => document.getElementById('su-pw-input')?.focus(), 100);
}

function showTenantSelectScreen(tenants, base) {
  const container = document.getElementById('login-content');
  if (!container) return;

  const tenantBtns = tenants.length > 0
    ? tenants.map(t => `
        <button class="login-user-btn" data-slug="${t.slug}">
          <span class="login-user-icon">${(t.name || t.slug).charAt(0).toUpperCase()}</span>
          <span class="login-user-name">${t.name || t.slug}</span>
          ${t.address ? `<span class="login-role-badge role-super" style="font-size:10px;max-width:90px;overflow:hidden;text-overflow:ellipsis;">${t.address}</span>` : ''}
        </button>`)
      .join('')
    : '<p style="text-align:center;color:#aaa;font-size:14px;padding:20px 0;">No active tenants found.</p>';

  container.innerHTML = `
    <button class="login-back-btn" id="su-tenant-back">&larr; Back</button>
    <div class="login-title">Select Store</div>
    <div class="login-user-list">${tenantBtns}</div>
  `;

  document.getElementById('su-tenant-back').addEventListener('click', renderLoginUserList);

  container.querySelectorAll('.login-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const slug = btn.dataset.slug;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      try {
        const res = await fetch(`${base}/api/tenants/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
        if (res.ok) {
          const tenant = await res.json();
          setTenantSession(tenant);
          // Clear cached menu/settings so the new tenant's data loads fresh after login
          localStorage.removeItem('bkt_menu_items');
          localStorage.removeItem('bkt_settings');
          localStorage.removeItem('bkt_free_addon_counts');
          localStorage.removeItem('bkt_active_bills');
          localStorage.removeItem('bkt_order_history');
          // Load users for this tenant using absolute URL so it works in native app
          try {
            const ur = await fetch(`${base}/api/users`);
            _loginUsers = ur.ok ? (await ur.json()) : [];
          } catch { _loginUsers = []; }
          if (!_loginUsers.length) _loginUsers = DEFAULT_USERS;
          renderLoginUserList();
        }
      } catch (e) {
        btn.disabled = false;
        btn.style.opacity = '';
        console.warn('Tenant select failed:', e);
      }
    });
  });
}

function showPinEntry(user) {
  _selectedUser = user;
  _pinDigits = [];

  const container = document.getElementById('login-content');
  if (!container) return;

  container.innerHTML = `
    <button class="login-back-btn" id="pin-back-btn">&larr; Back</button>
    <div class="login-title">Enter PIN for ${user.name}</div>
    <div class="pin-dots" id="pin-dots">
      <span class="pin-dot"></span>
      <span class="pin-dot"></span>
      <span class="pin-dot"></span>
      <span class="pin-dot"></span>
    </div>
    <div class="pin-error hidden" id="pin-error">Incorrect PIN</div>
    <div class="pin-pad">
      ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => {
        if (k === '') return '<button class="pin-key pin-key-empty" disabled></button>';
        if (k === '⌫') return '<button class="pin-key pin-key-del" data-key="del">⌫</button>';
        return `<button class="pin-key" data-key="${k}">${k}</button>`;
      }).join('')}
    </div>
  `;

  document.getElementById('pin-back-btn').addEventListener('click', renderLoginUserList);

  container.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === 'del') {
        _pinDigits.pop();
      } else if (_pinDigits.length < 4) {
        _pinDigits.push(key);
      }
      updatePinDots();
      if (_pinDigits.length === 4) {
        verifyPin();
      }
    });
  });
}

function updatePinDots() {
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < _pinDigits.length);
  });
  const err = document.getElementById('pin-error');
  if (err) err.classList.add('hidden');
}

function verifyPin() {
  const entered = _pinDigits.join('');
  if (entered === _selectedUser.pin) {
    const session = setSession(_selectedUser);
    hideLoginOverlay();
    if (_onLoginSuccess) _onLoginSuccess(session);
  } else {
    const err = document.getElementById('pin-error');
    if (err) err.classList.remove('hidden');
    _pinDigits = [];
    updatePinDots();
  }
}
