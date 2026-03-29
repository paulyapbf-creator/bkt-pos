'use strict';
// ─── Shared Auth Module ──────────────────────────────────────────────────────
// Shared between index.html and items.html for PIN-based user authentication.

const AUTH_SESSION_KEY = 'bkt_auth_session';

// ─── Session helpers ─────────────────────────────────────────────────────────

function getSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(user) {
  const session = {
    userId: user.id,
    name: user.name,
    role: user.role,
    loginTime: Date.now(),
  };
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
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

function showLoginOverlay(onSuccess) {
  _onLoginSuccess = onSuccess;
  const overlay = document.getElementById('login-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  loadLoginUsers().then(users => {
    _loginUsers = users;
    renderLoginUserList();
  });
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

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

  container.innerHTML = `
    <div class="login-title">Who's working today?</div>
    <div class="login-user-list">
      ${userButtons}
    </div>
  `;

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
