'use strict';
// ─── Shared Auth Module ──────────────────────────────────────────────────────
// Shared between index.html and items.html for PIN-based user authentication.
// Supports SaaS multi-tenant: tenant selection before user login.

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
  clearTenantSession();
}

function isSuper() {
  const s = getSession();
  return s && s.role === 'super';
}

// ─── Fetch users from server ─────────────────────────────────────────────────

const DEFAULT_USERS = [{ id: 'user_default', name: 'Admin', pin: '1234', role: 'super' }];

async function loadLoginUsers() {
  try {
    const res = await fetch('/api/users');
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

  // Check if SaaS mode: fetch tenants first
  try {
    const res = await fetch('/api/tenants');
    if (res.ok) {
      const tenants = await res.json();
      if (tenants.length > 0) {
        renderTenantSelector(tenants);
        return;
      }
    }
  } catch {}

  // Single-tenant mode: go straight to user list
  _loginUsers = await loadLoginUsers();
  renderLoginUserList();
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── Tenant selector (SaaS mode) ────────────────────────────────────────────

function renderTenantSelector(tenants) {
  const container = document.getElementById('login-content');
  if (!container) return;

  const buttons = tenants.map(t => `
    <button class="login-user-btn" data-tenant-slug="${t.slug}">
      <span class="login-user-icon">🏪</span>
      <span class="login-user-name">${t.name}</span>
    </button>
  `).join('');

  container.innerHTML = `
    <div class="login-title">Select Store</div>
    <div class="login-user-list">${buttons}</div>
  `;

  container.querySelectorAll('.login-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const slug = btn.dataset.tenantSlug;
      const tenant = tenants.find(t => t.slug === slug);
      // Set cookie server-side
      await fetch('/api/tenants/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      setTenantSession(tenant);
      // Now load users for this tenant
      _loginUsers = await loadLoginUsers();
      renderLoginUserList();
    });
  });
}

// ─── User list ───────────────────────────────────────────────────────────────

function renderLoginUserList() {
  const container = document.getElementById('login-content');
  if (!container) return;

  _selectedUser = null;
  _pinDigits = [];

  const tenant = getTenantSession();
  const hasTenant = tenant && tenant.slug;

  const userButtons = _loginUsers.length > 0
    ? _loginUsers.map(u => `
        <button class="login-user-btn" data-user-id="${u.id}">
          <span class="login-user-icon">${u.name.charAt(0).toUpperCase()}</span>
          <span class="login-user-name">${u.name}</span>
          <span class="login-role-badge role-${u.role}">${u.role === 'super' ? 'Admin' : 'Cashier'}</span>
        </button>
      `).join('')
    : '<p style="text-align:center;color:#aaa;font-size:14px;">No users found. Check server connection.</p>';

  container.innerHTML = `
    ${hasTenant ? `<button class="login-back-btn" id="tenant-back-btn">&larr; Change Store</button>` : ''}
    <div class="login-title">${hasTenant ? tenant.name + ' — ' : ''}Who's working today?</div>
    <div class="login-user-list">
      ${userButtons}
    </div>
  `;

  if (hasTenant) {
    document.getElementById('tenant-back-btn').addEventListener('click', async () => {
      clearTenantSession();
      try {
        const res = await fetch('/api/tenants');
        if (res.ok) {
          const tenants = await res.json();
          if (tenants.length > 0) { renderTenantSelector(tenants); return; }
        }
      } catch {}
      renderLoginUserList();
    });
  }

  container.querySelectorAll('.login-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = _loginUsers.find(u => u.id === btn.dataset.userId);
      if (user) showPinEntry(user);
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
