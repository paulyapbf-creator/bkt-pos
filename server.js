'use strict';

const BUILD_VERSION = '1.1.0-build.20260414';

require('dotenv').config();

// Use Google DNS so MongoDB SRV lookups work on restrictive networks
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const path      = require('path');

const PORT = process.env.PORT || 3000;
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Build version — registered first, no middleware can block this
app.get('/api/version', (req, res) => res.json({ version: BUILD_VERSION, ts: Date.now() }));

// ─── Admin routes (served independently, before tenant blocking) ─────────────
app.get('/admin', (req, res) => res.sendFile(path.join(posPath, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(posPath, 'admin.html')));
app.get('/admin.js', (req, res) => res.sendFile(path.join(posPath, 'admin.js')));

// ─── SaaS: Block disabled/missing tenants from accessing POS pages ───────────
const BLOCKED_PAGE = (title, msg) => `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="text-align:center;"><h1>${title}</h1><p style="color:#aaa;">${msg}</p></div></body></html>`;

app.use(async (req, res, next) => {
  if (!isSaasMode) return next();
  // Allow API calls through (tenant middleware handles those separately)
  if (req.path.startsWith('/api/')) return next();

  // Only gate HTML pages — let static assets (.js, .css, images, fonts) through
  const ext = req.path.split('.').pop().toLowerCase();
  const isPage = req.path === '/' || ['html', 'htm'].includes(ext);
  if (!isPage) return next();

  // URL param takes priority over cookie (cookie may be stale from a disabled tenant)
  const qs = new URLSearchParams(req.url.split('?')[1] || '');
  const slug = qs.get('store') || qs.get('tenant') || parseCookie(req.headers.cookie, 'bkt_tenant');

  if (!slug) {
    return res.status(403).send(BLOCKED_PAGE('Store Not Found', 'Please use the link provided by your administrator to access the POS.'));
  }

  const tenant = await saasDb?.collection('tenants').findOne({ slug });
  if (!tenant) {
    return res.status(404).send(BLOCKED_PAGE('Store Not Found', 'This store does not exist. Please check your link.'));
  }
  if (tenant.status === 'disabled') {
    return res.status(403).send(BLOCKED_PAGE('Access Disabled', 'This store has been disabled. Please contact the administrator.'));
  }

  // Set/refresh tenant cookie so subsequent page navigations work without ?store=
  const currentCookie = parseCookie(req.headers.cookie, 'bkt_tenant');
  if (currentCookie !== slug) {
    res.setHeader('Set-Cookie', `bkt_tenant=${slug}; Path=/; SameSite=Strict; Max-Age=86400`);
  }

  // Detect Android app via user agent and serve HTML with native-app class injected
  const ua = req.headers['user-agent'] || '';
  const appMode = ua.includes('BKT-POS-App') || qs.get('app') === '1';
  console.log(`[app-detect] appMode=${appMode} path=${req.path} ua=${ua.substring(0,30)}`);
  if (appMode) {
    const htmlFile = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const htmlPath = path.join(posPath, htmlFile);
    try {
      let html = require('fs').readFileSync(htmlPath, 'utf8');
      html = html.replace('<html lang="en">', '<html lang="en" class="native-app">');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(html);
    } catch (e) { console.error('[app-detect] Error:', e.message); }
  }

  next();
});

// No-cache headers for HTML pages so browser always gets latest version
app.use((req, res, next) => {
  const ext = req.path.split('.').pop().toLowerCase();
  if (req.path === '/' || ['html', 'htm'].includes(ext)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Disable caching for ALL static files so app always gets latest JS/CSS
const staticOpts = { maxAge: 0, etag: false, lastModified: false, setHeaders: (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}};
app.use('/kds', express.static(path.join(__dirname, 'public'), staticOpts));
// Serve POS files — supports both local dev layout (../pos) and single-repo layout (./pos)
const { existsSync, readFileSync } = require('fs');
const posPath = existsSync(path.join(__dirname, 'pos'))
  ? path.join(__dirname, 'pos')
  : path.join(__dirname, '..', 'pos');

app.use(express.static(posPath, staticOpts));
app.get('/api/version', (req, res) => res.json({ version: BUILD_VERSION }));
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));

// ─── SaaS multi-tenant ───────────────────────────────────────────────────────
const isSaasMode = process.env.SAAS_MODE === 'true';
let saasClient = null;  // shared MongoClient for all tenants
let saasDb = null;      // the 'saas' registry database
const tenantStores = new Map(); // slug -> store object

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').find(c => c.trim().startsWith(name + '='));
  return match ? match.split('=')[1].trim() : null;
}

// ─── Storage layer ────────────────────────────────────────────────────────────
// File-based when no MONGODB_URI (local / Android).
// MongoDB when MONGODB_URI is set (cloud / Railway).

function createFileStore() {
  const fs        = require('fs');
  const DATA_FILE = path.join(__dirname, 'data.json');

  function load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return { activeBills: {}, orderHistory: [], kdsHistory: [], menuItems: [], settings: {} }; }
  }
  function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

  return {
    async getBill(table)       { return load().activeBills[table] || null; },
    async getAllBills()         { return load().activeBills; },
    async saveBill(t, bill)    { const d = load(); d.activeBills[t] = bill; save(d); },
    async deleteBill(t)        { const d = load(); delete d.activeBills[t]; save(d); },
    async getSettings()        { return load().settings || {}; },
    async saveSettings(s)      { const d = load(); d.settings = s; save(d); },
    async deleteSettings()     { const d = load(); d.settings = {}; save(d); },
    async getMenuItems()       { return load().menuItems || []; },
    async saveMenuItems(items) { const d = load(); d.menuItems = items; save(d); },
    async addOrderHistory(o)   {
      const d = load();
      d.orderHistory.unshift(o);
      if (d.orderHistory.length > 3000) d.orderHistory.length = 3000;
      save(d);
    },
    async getOrderHistory(from, to) {
      let hist = load().orderHistory || [];
      if (from) hist = hist.filter(o => o.timestamp >= from);
      if (to)   hist = hist.filter(o => o.timestamp <= to);
      return hist;
    },
    async deleteOrderHistory() { const d = load(); d.orderHistory = []; save(d); },
    async addKdsHistory(e)     {
      const d = load();
      if (!d.kdsHistory) d.kdsHistory = [];
      d.kdsHistory.unshift(e);
      if (d.kdsHistory.length > 200) d.kdsHistory.length = 200;
      save(d);
    },
    async getKdsHistory()      { return load().kdsHistory || []; },
    async deleteKdsHistory()   { const d = load(); d.kdsHistory = []; save(d); },
    async getUsers()           { return load().users || []; },
    async saveUsers(users)     { const d = load(); d.users = users; save(d); },
    async connect()            { console.log('Using file-based storage (data.json)'); },
    close() {},
  };
}

function createMongoStore() {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  let db;

  const col = name => db.collection(name);
  function strip(doc) { if (!doc) return null; const { _id, ...rest } = doc; return rest; }

  return {
    async connect() {
      await client.connect();
      db = client.db('pos');
      await col('orderHistory').createIndex({ timestamp: -1 });
      await col('kdsHistory').createIndex({ servedAt: -1 });
      console.log('MongoDB connected');
    },

    async getBill(table) {
      return strip(await col('bills').findOne({ _id: table }));
    },
    async getAllBills() {
      const docs = await col('bills').find({}).toArray();
      return Object.fromEntries(docs.map(d => [d._id, strip(d)]));
    },
    async saveBill(table, bill) {
      await col('bills').replaceOne({ _id: table }, { _id: table, ...bill }, { upsert: true });
    },
    async deleteBill(table)     { await col('bills').deleteOne({ _id: table }); },

    async getSettings() {
      return strip(await col('settings').findOne({ _id: 'main' })) || {};
    },
    async saveSettings(s) {
      await col('settings').replaceOne({ _id: 'main' }, { _id: 'main', ...s }, { upsert: true });
    },
    async deleteSettings() { await col('settings').deleteOne({ _id: 'main' }); },

    async getMenuItems() {
      const doc = await col('settings').findOne({ _id: 'menu' });
      return doc ? doc.items : [];
    },
    async saveMenuItems(items) {
      await col('settings').replaceOne({ _id: 'menu' }, { _id: 'menu', items }, { upsert: true });
    },

    async addOrderHistory(o)    { await col('orderHistory').insertOne({ ...o }); },
    async getOrderHistory(from, to) {
      const query = {};
      if (from || to) {
        query.timestamp = {};
        if (from) query.timestamp.$gte = from;
        if (to)   query.timestamp.$lte = to;
      }
      return (await col('orderHistory').find(query).sort({ timestamp: -1 }).limit(3000).toArray()).map(strip);
    },
    async deleteOrderHistory()  { await col('orderHistory').deleteMany({}); },

    async addKdsHistory(e)      { await col('kdsHistory').insertOne({ ...e }); },
    async getKdsHistory() {
      return (await col('kdsHistory').find({}).sort({ servedAt: -1 }).limit(200).toArray()).map(strip);
    },
    async deleteKdsHistory()    { await col('kdsHistory').deleteMany({}); },

    async getUsers() {
      return (await col('users').find({}).toArray()).map(strip);
    },
    async saveUsers(users) {
      await col('users').deleteMany({});
      if (users.length > 0) await col('users').insertMany(users.map(u => ({ ...u })));
    },

    close() { return client.close(); },
  };
}

// ─── SaaS: Tenant store factory (reuses shared MongoClient) ──────────────────

function createTenantStore(dbName) {
  const db = saasClient.db(dbName);
  const col = name => db.collection(name);
  function strip(doc) { if (!doc) return null; const { _id, ...rest } = doc; return rest; }

  const s = {
    dbName,
    async connect() {
      await col('orderHistory').createIndex({ timestamp: -1 });
      await col('kdsHistory').createIndex({ servedAt: -1 });
    },
    async getBill(table)       { return strip(await col('bills').findOne({ _id: table })); },
    async getAllBills()         { const docs = await col('bills').find({}).toArray(); return Object.fromEntries(docs.map(d => [d._id, strip(d)])); },
    async saveBill(table, bill){ await col('bills').replaceOne({ _id: table }, { _id: table, ...bill }, { upsert: true }); },
    async deleteBill(table)    { await col('bills').deleteOne({ _id: table }); },
    async getSettings()        { return strip(await col('settings').findOne({ _id: 'main' })) || {}; },
    async saveSettings(s)      { await col('settings').replaceOne({ _id: 'main' }, { _id: 'main', ...s }, { upsert: true }); },
    async deleteSettings()     { await col('settings').deleteOne({ _id: 'main' }); },
    async getMenuItems()       { const doc = await col('settings').findOne({ _id: 'menu' }); return doc ? doc.items : []; },
    async saveMenuItems(items) { await col('settings').replaceOne({ _id: 'menu' }, { _id: 'menu', items }, { upsert: true }); },
    async addOrderHistory(o)   { await col('orderHistory').insertOne({ ...o }); },
    async getOrderHistory(from, to) {
      const query = {};
      if (from || to) { query.timestamp = {}; if (from) query.timestamp.$gte = from; if (to) query.timestamp.$lte = to; }
      return (await col('orderHistory').find(query).sort({ timestamp: -1 }).limit(3000).toArray()).map(strip);
    },
    async deleteOrderHistory() { await col('orderHistory').deleteMany({}); },
    async addKdsHistory(e)     { await col('kdsHistory').insertOne({ ...e }); },
    async getKdsHistory()      { return (await col('kdsHistory').find({}).sort({ servedAt: -1 }).limit(200).toArray()).map(strip); },
    async deleteKdsHistory()   { await col('kdsHistory').deleteMany({}); },
    async getUsers()           { return (await col('users').find({}).toArray()).map(strip); },
    async saveUsers(users)     { await col('users').deleteMany({}); if (users.length > 0) await col('users').insertMany(users.map(u => ({ ...u }))); },
    close() {},
  };
  return s;
}

function getTenantStore(slug, dbName) {
  if (tenantStores.has(slug)) return tenantStores.get(slug);
  const s = createTenantStore(dbName);
  tenantStores.set(slug, s);
  return s;
}

// ─── SaaS: Tenant registry ──────────────────────────────────────────────────

async function getTenantBySlug(slug) {
  return await saasDb.collection('tenants').findOne({ slug, status: 'active' });
}

async function getAllActiveTenants() {
  return await saasDb.collection('tenants').find({ status: 'active' }).project({ slug: 1, name: 1, _id: 0 }).toArray();
}

async function initTenantDb(tenantStore) {
  await tenantStore.connect();
  const users = await tenantStore.getUsers();
  if (!users || users.length === 0) {
    await tenantStore.saveUsers([{ id: 'user_default', name: 'Admin', pin: '1234', role: 'super' }]);
  }
}

// ─── WebSocket hub ────────────────────────────────────────────────────────────

const clients = {}; // { [tenantSlug]: { pos: Set, kds: Set } }

function getClients(tenantSlug) {
  const key = tenantSlug || '_default';
  if (!clients[key]) clients[key] = { pos: new Set(), kds: new Set() };
  return clients[key];
}

// Backward compat: ensure old single-tenant clients structure works
if (!isSaasMode) clients['_default'] = { pos: new Set(), kds: new Set() };

// ─── Per-table mutation queue ─────────────────────────────────────────────────
// All bill reads/writes for the same table are serialised through this queue.
// Without it, concurrent status changes each read the same stale bill and
// overwrite each other — so archiveIfAllServed never sees all items as served.
const tableQueues = new Map();

function queueTableUpdate(tenantSlug, table, fn) {
  const key = `${tenantSlug || '_default'}:${table}`;
  const prev = tableQueues.get(key) || Promise.resolve();
  const next = prev.then(fn).catch(e => console.error(`[queue:${key}]`, e.message));
  tableQueues.set(key, next);
  next.finally(() => { if (tableQueues.get(key) === next) tableQueues.delete(key); });
  return next;
}

function broadcast(tenantSlug, targets, message) {
  const payload = JSON.stringify(message);
  const tc = getClients(tenantSlug);
  targets.forEach(role => {
    if (tc[role]) tc[role].forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    });
  });
}

// saveKdsHistory: record kitchen service without deleting the bill.
async function saveKdsHistory(reqStore, tenantSlug, table, bill) {
  const servedAt = Date.now();
  await reqStore.addKdsHistory({
    table,
    servedAt,
    startedAt: bill.startedAt,
    items: bill.items.map(({ id, name, nameZh, nameTh, nameVi, nameMs, nameKm, nameId, quantity, sentAt, readyAt }) => ({
      id, name, nameZh, nameTh, nameVi, nameMs, nameKm, nameId, quantity, sentAt, readyAt: readyAt || servedAt,
    })),
  });
  broadcast(tenantSlug, ['pos', 'kds'], { type: 'bill:allServed', table });
}

// archiveBill: full close — save kds-history + DELETE bill + broadcast cleared.
async function archiveBill(reqStore, tenantSlug, table, bill) {
  await saveKdsHistory(reqStore, tenantSlug, table, bill);
  await reqStore.deleteBill(table);
  broadcast(tenantSlug, ['pos', 'kds'], { type: 'bill:cleared', table });
}

async function archiveIfAllServed(reqStore, tenantSlug, table, bill) {
  if (!bill.items.every(i => i.status === 'served')) return;
  const current = await reqStore.getBill(table);
  if (!current || !current.items.every(i => i.status === 'served')) return;
  await saveKdsHistory(reqStore, tenantSlug, table, current);
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.tenantSlug = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      ws.role = msg.role === 'kds' ? 'kds' : 'pos';
      ws.tenantSlug = msg.tenantSlug || '_default';
      getClients(ws.tenantSlug)[ws.role].add(ws);
      return;
    }

    if (msg.type === 'item:statusChange') {
      const tSlug = ws.tenantSlug || '_default';
      const wsStore = isSaasMode ? tenantStores.get(tSlug) : store;
      if (!wsStore) return;
      queueTableUpdate(tSlug, msg.table, async () => {
        const bill = await wsStore.getBill(msg.table);
        if (!bill) return;
        const item = bill.items.find(i => i.id === msg.itemId);
        if (!item) return;

        item.status = msg.status;
        if (msg.status === 'ready') item.readyAt = Date.now();
        await wsStore.saveBill(msg.table, bill);

        broadcast(tSlug, ['pos', 'kds'], {
          type: 'item:statusChanged', table: msg.table,
          itemId: msg.itemId, status: msg.status, item,
        });

        const allReady = bill.items.every(i => i.status === 'ready' || i.status === 'served');
        if (allReady) broadcast(tSlug, ['pos'], { type: 'table:allReady', table: msg.table });

        await archiveIfAllServed(wsStore, tSlug, msg.table, bill);
      });
    }
  });

  ws.on('close', () => {
    if (ws.role && ws.tenantSlug) {
      const tc = clients[ws.tenantSlug];
      if (tc && tc[ws.role]) tc[ws.role].delete(ws);
    }
  });
});

// ─── SaaS: Tenant middleware ──────────────────────────────────────────────────

app.use('/api', async (req, res, next) => {
  // Skip tenant resolution for tenant-list and admin endpoints
  if (req.path === '/tenants' || req.path.startsWith('/tenants/') || req.path.startsWith('/admin')) return next();

  if (!isSaasMode) {
    req.store = store;
    req.tenantSlug = '_default';
    return next();
  }

  const slug = req.headers['x-tenant'] ||
    parseCookie(req.headers.cookie, 'bkt_tenant') ||
    req.query.tenant;

  if (!slug) return res.status(400).json({ error: 'Tenant not specified' });

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  req.tenant = tenant;
  req.tenantSlug = tenant.slug;
  req.store = getTenantStore(tenant.slug, tenant.dbName);
  next();
});

// ─── REST API: Tenant endpoints (SaaS) ──────────────────────────────────────

app.get('/api/tenants', async (req, res) => {
  if (!isSaasMode) return res.json([]);
  try {
    const tenants = await getAllActiveTenants();
    res.json(tenants);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/tenants/select', async (req, res) => {
  if (!isSaasMode) return res.json({ slug: '_default', name: 'Default' });
  const { slug } = req.body;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.setHeader('Set-Cookie', `bkt_tenant=${slug}; Path=/; SameSite=Strict; Max-Age=86400`);
  res.json({ slug: tenant.slug, name: tenant.name });
});

// ─── REST API: Admin tenant management (protected) ───────────────────────────

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!process.env.SAAS_ADMIN_KEY || key !== process.env.SAAS_ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/tenants', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const tenants = await saasDb.collection('tenants').find({}).toArray();
  res.json(tenants);
});

app.post('/api/admin/tenants', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const { slug, name, address } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'slug and name required' });
  const dbName = 'pos_' + slug.replace(/[^a-z0-9]/g, '_');
  const tenant = { slug, name, address: address || '', dbName, status: 'active', createdAt: new Date(), updatedAt: new Date() };
  try {
    await saasDb.collection('tenants').insertOne(tenant);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Tenant slug already exists' });
    throw e;
  }
  const tenantStore = getTenantStore(slug, dbName);
  await initTenantDb(tenantStore);
  // Sync shop name/address to tenant settings
  await tenantStore.saveSettings({ shopName: name, shopAddress: address || '' });
  res.json(tenant);
});

app.put('/api/admin/tenants/:slug', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const updates = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.address !== undefined) updates.address = req.body.address;
  if (req.body.status) updates.status = req.body.status;
  updates.updatedAt = new Date();
  const result = await saasDb.collection('tenants').findOneAndUpdate(
    { slug: req.params.slug }, { $set: updates }, { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Tenant not found' });
  if (updates.status === 'disabled') tenantStores.delete(req.params.slug);
  // Sync shop name/address to tenant settings if changed
  if (updates.name !== undefined || updates.address !== undefined) {
    const ts = getTenantStore(result.slug, result.dbName);
    const settings = await ts.getSettings();
    if (updates.name !== undefined) settings.shopName = updates.name;
    if (updates.address !== undefined) settings.shopAddress = updates.address;
    await ts.saveSettings(settings);
    broadcast(req.params.slug, ['pos', 'kds'], { type: 'admin:refresh', reason: 'settings:updated' });
  }
  res.json(result);
});

app.delete('/api/admin/tenants/:slug', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const tenant = await saasDb.collection('tenants').findOne({ slug: req.params.slug });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  try {
    // Drop the tenant's database to free cloud storage
    if (tenant.dbName) {
      const tenantDb = saasClient.db(tenant.dbName);
      await tenantDb.dropDatabase();
    }
    // Remove tenant record
    await saasDb.collection('tenants').deleteOne({ slug: req.params.slug });
    // Remove from in-memory cache
    tenantStores.delete(req.params.slug);
    res.json({ ok: true, deleted: tenant.name, dbDropped: tenant.dbName });
  } catch (e) {
    res.status(500).json({ error: `Failed to delete tenant: ${e.message}` });
  }
});

// ─── Admin: Tenant sales summary ─────────────────────────────────────────────

app.get('/api/admin/tenants/:slug/sales', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const tenant = await saasDb.collection('tenants').findOne({ slug: req.params.slug });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const ts = getTenantStore(tenant.slug, tenant.dbName);
  const from = req.query.from ? Number(req.query.from) : undefined;
  const to   = req.query.to   ? Number(req.query.to)   : undefined;
  const orders = await ts.getOrderHistory(from, to);

  const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const orderCount = orders.length;
  const avgOrder = orderCount > 0 ? totalRevenue / orderCount : 0;

  // Payment method breakdown
  const byMethod = {};
  orders.forEach(o => {
    const m = (o.paymentMethod || 'cash').toLowerCase();
    if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 };
    byMethod[m].total += o.total || 0;
    byMethod[m].count++;
  });

  // Top items
  const byItem = {};
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = it.nameZh || it.name || 'Unknown';
      if (!byItem[key]) byItem[key] = { name: key, qty: 0, revenue: 0 };
      byItem[key].qty += it.quantity || 1;
      byItem[key].revenue += it.subtotal || 0;
    });
  });
  const topItems = Object.values(byItem).sort((a, b) => b.qty - a.qty).slice(0, 5);

  res.json({ totalRevenue, orderCount, avgOrder, byMethod, topItems, tenantName: tenant.name, tenantAddress: tenant.address || '', demoMenu: !!tenant.demoMenu });
});

// ─── Admin: Reset tenant data ────────────────────────────────────────────────

app.post('/api/admin/tenants/:slug/reset', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const tenant = await saasDb.collection('tenants').findOne({ slug: req.params.slug });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const ts = getTenantStore(tenant.slug, tenant.dbName);
  const what = req.body.what || 'all'; // 'all', 'orders', 'bills', 'menu', 'settings'

  if (what === 'all' || what === 'orders') await ts.deleteOrderHistory();
  if (what === 'all' || what === 'bills') {
    const bills = await ts.getAllBills();
    await Promise.all(Object.keys(bills).map(t => ts.deleteBill(t)));
  }
  if (what === 'all' || what === 'kds') await ts.deleteKdsHistory();
  if (what === 'all' || what === 'menu') await ts.saveMenuItems([]);
  if (what === 'all' || what === 'settings') await ts.deleteSettings();
  if (what === 'all') {
    await ts.saveUsers([{ id: 'user_default', name: 'Admin', pin: '1234', role: 'super' }]);
  }

  // Force-refresh all connected POS/KDS clients for this tenant
  broadcast(req.params.slug, ['pos', 'kds'], { type: 'admin:refresh', reason: `reset:${what}` });
  res.json({ ok: true, reset: what });
});

// ─── Admin: Demo menu management ─────────────────────────────────────────────

app.get('/api/admin/demo/menu', adminAuth, async (req, res) => {
  if (!isSaasMode || !demoStore) return res.json([]);
  res.json(await demoStore.getMenuItems());
});

app.put('/api/admin/demo/menu', adminAuth, async (req, res) => {
  if (!isSaasMode || !demoStore) return res.status(400).json({ error: 'SaaS mode not enabled' });
  await demoStore.saveMenuItems(req.body);
  res.json({ ok: true });
});

// Copy a tenant's menu to the demo database
app.post('/api/admin/demo/copy-from/:slug', adminAuth, async (req, res) => {
  if (!isSaasMode || !demoStore) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const tenant = await saasDb.collection('tenants').findOne({ slug: req.params.slug });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const ts = getTenantStore(tenant.slug, tenant.dbName);
  const menu = await ts.getMenuItems();
  await demoStore.saveMenuItems(menu);
  res.json({ ok: true, items: menu.length });
});

// Toggle demo mode for a tenant
app.put('/api/admin/tenants/:slug/demo', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const enabled = !!req.body.enabled;
  const result = await saasDb.collection('tenants').findOneAndUpdate(
    { slug: req.params.slug },
    { $set: { demoMenu: enabled, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Tenant not found' });
  broadcast(req.params.slug, ['pos', 'kds'], { type: 'admin:refresh', reason: 'demo:toggled' });
  res.json(result);
});

// ─── Admin: AI Menu Import (Claude API) ──────────────────────────────────────

app.post('/api/admin/menu-import/extract', adminAuth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured in .env' });

  try {
    // Support both single file and multiple images
    const { fileBase64, images, contentType: ct, fileName, langs: requestedLangs } = req.body;
    if (!fileBase64 && (!images || !images.length)) return res.status(400).json({ error: 'No file data received' });
    const contentType = ct || 'image/png';

    // Build Claude API request
    const isImage = contentType.startsWith('image/');
    const isPdf = contentType === 'application/pdf';

    const userContent = [];

    if (images && images.length > 0) {
      // Multiple camera captures — send all as separate images
      images.forEach((imgBase64, i) => {
        if (images.length > 1) userContent.push({ type: 'text', text: `--- Menu page ${i + 1} of ${images.length} ---` });
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imgBase64 },
        });
      });
    } else if (isImage) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: contentType, data: fileBase64 },
      });
    } else if (isPdf) {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
      });
    } else {
      // For text/CSV/Excel — send as text content
      const textContent = req.body.toString('utf8');
      userContent.push({ type: 'text', text: `File content (${fileName}):\n\n${textContent}` });
    }

    const multiPage = images && images.length > 1;
    const langDefs = {
      zh: { field: 'nameZh', desc: 'Chinese (Simplified) name' },
      th: { field: 'nameTh', desc: 'Thai name' },
      vi: { field: 'nameVi', desc: 'Vietnamese name' },
      ms: { field: 'nameMs', desc: 'Malay name' },
      km: { field: 'nameKm', desc: 'Khmer (Cambodian) name' },
      id: { field: 'nameId', desc: 'Indonesian name' },
    };
    const langs = (requestedLangs && requestedLangs.length > 0) ? requestedLangs.filter(l => langDefs[l]) : ['zh'];
    const langFields = langs.map(l => `- ${langDefs[l].field}: ${langDefs[l].desc}`).join('\n');
    const exampleObj = { name: 'Bak Kut Teh', price: 22.00, category: 'Main Course' };
    langs.forEach(l => { exampleObj[langDefs[l].field] = l === 'zh' ? '肉骨茶' : 'Bak Kut Teh'; });

    userContent.push({
      type: 'text',
      text: `Extract ALL menu items from ${multiPage ? 'all pages of ' : ''}this ${multiPage ? 'multi-page menu' : 'document'}. For each item, extract:
- name: English name
${langFields}
- price: numeric price (number, not string)
- category: category/section it belongs to (e.g. "Main Course", "Drinks", "Appetizer", etc.)

If the source document has a name in a specific language, use it directly. For languages not in the document, translate the item name accurately. Use empty string "" only if translation is truly not possible.

Return ONLY a valid JSON array of objects. Example format:
[${JSON.stringify(exampleObj)}]

Important:
- Extract EVERY item from ${multiPage ? 'ALL pages' : 'the document'}, don't skip any
${multiPage ? '- Combine items from all pages into ONE array — do NOT duplicate items that appear on multiple pages\n' : ''}- If price has variants (S/M/L), use the base/smallest price
- Use these category names: "Main Course", "Add-ons", "Vegetables", "Noodles", "Soup", "Dessert", "Beverages", or "General"
- Return ONLY the JSON array, no other text`
    });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(500).json({ error: `Claude API error: ${err}` });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0]?.text || '';

    // Extract JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.status(400).json({ error: 'Could not extract menu items from document', raw: responseText });

    const items = JSON.parse(jsonMatch[0]);

    // Map AI category names to POS category IDs
    const categoryMap = {
      'main course': 'mains', 'main dishes': 'mains', 'main': 'mains', 'mains': 'mains',
      'rice': 'mains', 'meat': 'mains', 'seafood': 'mains', 'chicken': 'mains', 'pork': 'mains',
      'add-on': 'addons', 'add-ons': 'addons', 'addon': 'addons', 'addons': 'addons', 'side': 'addons', 'sides': 'addons', 'extras': 'addons',
      'vegetable': 'vegetables', 'vegetables': 'vegetables', 'veg': 'vegetables', 'greens': 'vegetables', 'salad': 'vegetables', 'salads': 'vegetables',
      'noodle': 'noodles', 'noodles': 'noodles', 'pasta': 'noodles', 'mee': 'noodles',
      'soup': 'soup', 'soups': 'soup', 'broth': 'soup',
      'dessert': 'dessert', 'desserts': 'dessert', 'sweets': 'dessert', 'sweet': 'dessert', 'cake': 'dessert', 'pastry': 'dessert',
      'beverage': 'beverages', 'beverages': 'beverages', 'drink': 'beverages', 'drinks': 'beverages',
    };

    // Normalize items to match our menu format
    const normalized = items.map((item, idx) => {
      const rawCat = (item.category || 'General').toLowerCase().trim();
      const category = categoryMap[rawCat] || 'mains';
      const entry = {
        id: `mn${String(idx + 1).padStart(3, '0')}`,
        name: item.name || '',
        price: parseFloat(item.price) || 0,
        category,
        isPopular: false,
        isAvailable: true,
        modifierGroups: [],
      };
      // Only include requested language fields
      langs.forEach(l => { entry[langDefs[l].field] = item[langDefs[l].field] || ''; });
      return entry;
    });

    res.json({ items: normalized, rawCount: items.length });
  } catch (e) {
    res.status(500).json({ error: `Extraction failed: ${e.message}` });
  }
});

// Import extracted items into a tenant's menu
app.post('/api/admin/tenants/:slug/menu-import', adminAuth, async (req, res) => {
  if (!isSaasMode) return res.status(400).json({ error: 'SaaS mode not enabled' });
  const tenant = await saasDb.collection('tenants').findOne({ slug: req.params.slug });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const { items, mode } = req.body; // mode: 'replace' or 'append'
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  const ts = getTenantStore(tenant.slug, tenant.dbName);

  if (mode === 'append') {
    const existing = await ts.getMenuItems();
    // Re-number new items to avoid ID conflicts
    const maxNum = existing.reduce((max, it) => {
      const n = parseInt(it.id?.replace('mn', ''), 10);
      return n > max ? n : max;
    }, 0);
    const renumbered = items.map((item, idx) => ({
      ...item,
      id: `mn${String(maxNum + idx + 1).padStart(3, '0')}`,
    }));
    await ts.saveMenuItems([...existing, ...renumbered]);
  } else {
    await ts.saveMenuItems(items);
  }

  broadcast(req.params.slug, ['pos', 'kds'], { type: 'admin:refresh', reason: 'menu:imported' });
  res.json({ ok: true, count: items.length });
});

// ─── REST API: Bills ──────────────────────────────────────────────────────────

app.get('/api/bills', async (req, res) => {
  res.json(await req.store.getAllBills());
});

app.get('/api/bills/:table', async (req, res) => {
  const bill = await req.store.getBill(req.params.table);
  if (!bill) return res.status(404).json({ error: 'No bill for this table' });
  res.json(bill);
});

app.post('/api/bills/:table/items', async (req, res) => {
  const table = req.params.table;
  const ts = req.tenantSlug;
  let bill = await req.store.getBill(table);

  if (bill && bill.items.length > 0) {
    if (bill.items.every(i => i.status === 'served')) {
      await req.store.deleteBill(table);
      broadcast(ts, ['pos', 'kds'], { type: 'bill:cleared', table });
    } else {
      await archiveBill(req.store, ts, table, bill);
    }
    bill = null;
  }

  if (!bill) bill = { startedAt: Date.now(), items: [] };

  const enhanced = (req.body.items || []).map(item => ({
    ...item, status: 'cooking', sentAt: Date.now(), readyAt: null,
  }));
  bill.items.push(...enhanced);
  await req.store.saveBill(table, bill);

  broadcast(ts, ['kds'], { type: 'order:new', table, bill });
  res.json(bill);
});

app.put('/api/bills/:table', async (req, res) => {
  const table    = req.params.table;
  const ts = req.tenantSlug;
  const existing = await req.store.getBill(table);
  const existingMap = {};
  if (existing) existing.items.forEach(i => { existingMap[i.id] = i; });

  const items = (req.body.items || []).map(item => {
    const prev = existingMap[item.id];
    return prev
      ? { ...item, status: prev.status, sentAt: prev.sentAt, readyAt: prev.readyAt }
      : { ...item, status: 'cooking', sentAt: Date.now(), readyAt: null };
  });

  const bill = { startedAt: existing?.startedAt || Date.now(), items };
  await req.store.saveBill(table, bill);

  broadcast(ts, ['kds'], { type: 'order:updated', table, bill });
  res.json(bill);
});

app.delete('/api/bills/:table', async (req, res) => {
  await req.store.deleteBill(req.params.table);
  broadcast(req.tenantSlug, ['kds'], { type: 'bill:cleared', table: req.params.table });
  res.json({ ok: true });
});

app.delete('/api/bills', async (req, res) => {
  const bills = await req.store.getAllBills();
  await Promise.all(Object.keys(bills).map(t => req.store.deleteBill(t)));
  broadcast(req.tenantSlug, ['pos', 'kds'], { type: 'bill:cleared', table: '*' });
  res.json({ ok: true });
});

app.patch('/api/bills/:table/items/:itemId/status', (req, res) => {
  const { table, itemId } = req.params;
  const { status } = req.body;
  const ts = req.tenantSlug;
  const rs = req.store;
  queueTableUpdate(ts, table, async () => {
    const bill = await rs.getBill(table);
    if (!bill) { res.status(404).json({ error: 'No bill for this table' }); return; }
    const item = bill.items.find(i => i.id === itemId);
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

    item.status = status;
    if (status === 'ready') item.readyAt = Date.now();
    await rs.saveBill(table, bill);

    broadcast(ts, ['pos', 'kds'], { type: 'item:statusChanged', table, itemId, status, item });

    const allReady = bill.items.every(i => i.status === 'ready' || i.status === 'served');
    if (allReady) broadcast(ts, ['pos'], { type: 'table:allReady', table });

    res.json(item);

    await archiveIfAllServed(rs, ts, table, bill);
  });
});

app.post('/api/bills/:table/serve', (req, res) => {
  const table = req.params.table;
  const ts = req.tenantSlug;
  const rs = req.store;
  queueTableUpdate(ts, table, async () => {
    const bill = await rs.getBill(table);
    if (!bill) { res.status(404).json({ error: 'No bill' }); return; }

    const now = Date.now();
    bill.items.forEach(item => {
      item.status = 'served';
      if (!item.readyAt) item.readyAt = now;
    });

    await rs.saveBill(table, bill);
    await saveKdsHistory(rs, ts, table, bill);
    res.json({ ok: true });
  });
});

// ─── REST API: KDS History ────────────────────────────────────────────────────

app.get('/api/kds-history',    async (req, res) => res.json(await req.store.getKdsHistory()));
app.post('/api/kds-history',   async (req, res) => { await req.store.addKdsHistory(req.body); res.json({ ok: true }); });
app.delete('/api/kds-history', async (req, res) => { await req.store.deleteKdsHistory(); res.json({ ok: true }); });

// ─── REST API: Order History ──────────────────────────────────────────────────

app.get('/api/history', async (req, res) => {
  const from = req.query.from ? Number(req.query.from) : undefined;
  const to   = req.query.to   ? Number(req.query.to)   : undefined;
  res.json(await req.store.getOrderHistory(from, to));
});
app.post('/api/history', async (req, res) => {
  await req.store.addOrderHistory(req.body);
  if (cloudSync) await cloudSync.syncOrder(req.body);
  res.json({ ok: true });
});
app.delete('/api/history', async (req, res) => { await req.store.deleteOrderHistory(); res.json({ ok: true }); });

// ─── REST API: Menu (with demo mode support) ─────────────────────────────────

let demoStore = null; // initialized in start() if SaaS mode

app.get('/api/menu', async (req, res) => {
  // In SaaS mode, check if tenant has demo mode enabled
  if (isSaasMode && req.tenant && req.tenant.demoMenu) {
    if (demoStore) return res.json(await demoStore.getMenuItems());
  }
  res.json(await req.store.getMenuItems());
});
app.put('/api/menu', async (req, res) => {
  // Block menu edits in demo mode
  if (isSaasMode && req.tenant && req.tenant.demoMenu) {
    return res.status(403).json({ error: 'Menu is read-only in demo mode' });
  }
  await req.store.saveMenuItems(req.body);
  if (cloudSync) await cloudSync.syncMenu(req.body);
  res.json({ ok: true });
});

// ─── REST API: Settings ───────────────────────────────────────────────────────

app.get('/api/settings',    async (req, res) => res.json(await req.store.getSettings()));
app.put('/api/settings', async (req, res) => {
  await req.store.saveSettings(req.body);
  if (cloudSync) await cloudSync.syncSettings(req.body);
  res.json({ ok: true });
});
app.delete('/api/settings', async (req, res) => { await req.store.deleteSettings(); res.json({ ok: true }); });

// ─── REST API: Users ──────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => res.json(await req.store.getUsers()));

app.post('/api/users', async (req, res) => {
  const users = await req.store.getUsers();
  const user = {
    id: `user_${Date.now()}`,
    name: req.body.name,
    pin: req.body.pin,
    role: req.body.role || 'cashier',
  };
  users.push(user);
  await req.store.saveUsers(users);
  res.json(user);
});

app.put('/api/users/:id', async (req, res) => {
  const users = await req.store.getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx] = { ...users[idx], ...req.body, id: req.params.id };
  await req.store.saveUsers(users);
  res.json(users[idx]);
});

app.delete('/api/users/:id', async (req, res) => {
  const users = await req.store.getUsers();
  const superCount = users.filter(u => u.role === 'super').length;
  const target = users.find(u => u.id === req.params.id);
  if (target && target.role === 'super' && superCount <= 1) {
    return res.status(400).json({ error: 'Cannot delete last super user' });
  }
  const filtered = users.filter(u => u.id !== req.params.id);
  await req.store.saveUsers(filtered);
  res.json({ ok: true });
});

// ─── REST API: Airwallex Card Payments ───────────────────────────────────────

function airwallexBaseUrl(env) {
  return env === 'production' ? 'https://api.airwallex.com' : 'https://api-demo.airwallex.com';
}

app.post('/api/airwallex/create-intent', async (req, res) => {
  try {
    const settings = await req.store.getSettings();
    const clientId = settings.airwallexClientId;
    const apiKey   = settings.airwallexApiKey;
    const env      = settings.airwallexEnv || 'demo';
    if (!clientId || !apiKey) return res.status(400).json({ error: 'Airwallex credentials not configured' });

    const baseUrl = airwallexBaseUrl(env);

    // Step 1: Authenticate
    const authRes = await fetch(`${baseUrl}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': clientId, 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!authRes.ok) {
      const err = await authRes.text();
      return res.status(401).json({ error: `Airwallex auth failed: ${err}` });
    }
    const { token } = await authRes.json();

    // Step 2: Create PaymentIntent
    const { amount, table } = req.body;
    const intentRes = await fetch(`${baseUrl}/api/v1/pa/payment_intents/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        amount: parseFloat(amount),
        currency: 'MYR',
        merchant_order_id: `${table}_${Date.now()}`,
      }),
    });
    if (!intentRes.ok) {
      const err = await intentRes.text();
      return res.status(500).json({ error: `PaymentIntent creation failed: ${err}` });
    }
    const intent = await intentRes.json();
    res.json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (e) {
    res.status(500).json({ error: `Airwallex error: ${e.message}` });
  }
});

app.get('/api/airwallex/intent-status/:id', async (req, res) => {
  try {
    const settings = await req.store.getSettings();
    const clientId = settings.airwallexClientId;
    const apiKey   = settings.airwallexApiKey;
    const env      = settings.airwallexEnv || 'demo';
    if (!clientId || !apiKey) return res.status(400).json({ error: 'Airwallex credentials not configured' });

    const baseUrl = airwallexBaseUrl(env);
    const authRes = await fetch(`${baseUrl}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': clientId, 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!authRes.ok) return res.status(401).json({ error: 'Airwallex auth failed' });
    const { token } = await authRes.json();

    const intentRes = await fetch(`${baseUrl}/api/v1/pa/payment_intents/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!intentRes.ok) return res.status(500).json({ error: 'Failed to fetch intent status' });
    const intent = await intentRes.json();
    res.json({ status: intent.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REST API: Wallet payment gateway proxy ──────────────────────────────────
// Forwards requests to the wallet service (multi-tenant DuitNow/AmpersandPay/ECPI).
// The wallet URL is stored per-tenant in the POS settings (walletUrl field).

async function getWalletUrl(req) {
  try {
    if (!req.store) return '';
    const settings = await req.store.getSettings();
    return (settings && settings.walletUrl) ? settings.walletUrl.replace(/\/+$/, '') : '';
  } catch { return ''; }
}

app.get('/api/wallet/tenants', async (req, res) => {
  const walletUrl = await getWalletUrl(req);
  if (!walletUrl) return res.status(400).json({ error: 'Wallet URL not configured' });
  try {
    const r = await fetch(`${walletUrl}/api/payment/tenants`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Wallet unreachable: ${e.message}` });
  }
});

app.post('/api/wallet/duitnow/create', async (req, res) => {
  const walletUrl = await getWalletUrl(req);
  if (!walletUrl) return res.status(400).json({ error: 'Wallet URL not configured' });
  try {
    const r = await fetch(`${walletUrl}/api/payment/duitnow/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Wallet unreachable: ${e.message}` });
  }
});

app.post('/api/wallet/duitnow/poll', async (req, res) => {
  const walletUrl = await getWalletUrl(req);
  if (!walletUrl) return res.status(400).json({ error: 'Wallet URL not configured' });
  try {
    const r = await fetch(`${walletUrl}/api/payment/duitnow/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Wallet unreachable: ${e.message}` });
  }
});

app.post('/api/wallet/duitnow/cancel', async (req, res) => {
  const walletUrl = await getWalletUrl(req);
  if (!walletUrl) return res.status(400).json({ error: 'Wallet URL not configured' });
  try {
    const r = await fetch(`${walletUrl}/api/payment/duitnow/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Wallet unreachable: ${e.message}` });
  }
});

app.get('/api/wallet/qr', async (req, res) => {
  const walletUrl = await getWalletUrl(req);
  if (!walletUrl) return res.status(400).end();
  try {
    const r = await fetch(`${walletUrl}/api/qr?data=${encodeURIComponent(req.query.data || '')}`);
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', r.headers.get('content-type') || 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(502).end();
  }
});

// Special endpoint to list tenants given a URL (for settings page "Reload" button
// before settings are saved)
app.get('/api/wallet-test/tenants', async (req, res) => {
  const walletUrl = (req.query.url || '').toString().replace(/\/+$/, '');
  if (!walletUrl) return res.status(400).json({ error: 'url query parameter required' });
  try {
    const r = await fetch(`${walletUrl}/api/payment/tenants`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Wallet unreachable: ${e.message}` });
  }
});

// ─── REST API: Network Info ───────────────────────────────────────────────────

app.get('/api/network', (req, res) => {
  const { networkInterfaces } = require('os');
  const ips = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  const port = PORT;
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const urls = ips.map(ip => `http://${ip}:${port}`);
  if (railwayDomain) urls.unshift(`https://${railwayDomain}`);
  res.json({ ips, port, urls });
});

// ─── REST API: Manual Cloud Sync ──────────────────────────────────────────────

app.post('/api/sync', async (req, res) => {
  if (!cloudSync) return res.status(400).json({ error: 'Cloud sync not configured' });
  try {
    // Sync all order history
    const history = await req.store.getOrderHistory();
    for (const order of history) cloudSync.syncOrder(order);
    // Sync settings + menu
    cloudSync.syncSettings(await req.store.getSettings());
    cloudSync.syncMenu(await req.store.getMenuItems());
    res.json({ ok: true, orders: history.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REST API: Print (thermal printer via TCP) ───────────────────────────────

const net = require('net');
const { createCanvas } = require('canvas');

const PRINTER_WIDTH = 480; // 80mm thermal printer effective print width
const ESC_BYTE = 0x1B, GS_BYTE = 0x1D, LF_BYTE = 0x0A;

// Render a line of text to a 1-bit raster bitmap for GS v 0
function textToRaster(text, opts = {}) {
  const fontSize = opts.fontSize || 22;
  const bold     = opts.bold || false;
  const align    = opts.align || 'left'; // left, center, right
  const width    = opts.width || PRINTER_WIDTH;
  const height   = Math.ceil(fontSize * 1.4);

  const canvas = createCanvas(width, height);
  const ctx    = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  // Draw text
  ctx.fillStyle = '#000';
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px "SimSun","Microsoft YaHei","SimHei","Arial"`;
  ctx.textBaseline = 'top';

  const measured = ctx.measureText(text);
  let x = 0;
  if (align === 'center')     x = (width - measured.width) / 2;
  else if (align === 'right') x = width - measured.width;

  ctx.fillText(text, x, Math.floor(fontSize * 0.15));

  // Convert to 1-bit raster: GS v 0 format
  // Each byte = 8 horizontal pixels, MSB = leftmost
  const imgData    = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const raster      = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = imgData[idx] * 0.299 + imgData[idx+1] * 0.587 + imgData[idx+2] * 0.114;
      if (gray < 128) { // dark pixel
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        raster[byteIdx] |= (0x80 >> (x % 8));
      }
    }
  }

  return { raster, bytesPerRow, height };
}

// Print a raster image via GS v 0
function rasterCmd(raster, bytesPerRow, height) {
  // GS v 0 m xL xH yL yH d1...dk
  const header = Buffer.from([
    GS_BYTE, 0x76, 0x30, 0x00, // GS v 0, mode 0 (normal)
    bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF,
  ]);
  return Buffer.concat([header, raster]);
}

function printLine(parts, text, opts) {
  const { raster, bytesPerRow, height } = textToRaster(text, opts);
  parts.push(rasterCmd(raster, bytesPerRow, height));
}

function printDash(parts) {
  printLine(parts, '-'.repeat(48), { fontSize: 20 });
}

function printLR(parts, left, right, opts = {}) {
  printLine(parts, left, { ...opts, align: 'left' });
  // Overlay: render both on one line
  const fontSize = opts.fontSize || 22;
  const bold = opts.bold || false;
  const height = Math.ceil(fontSize * 1.4);
  const width = PRINTER_WIDTH;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px "SimSun","Microsoft YaHei","SimHei","Arial"`;
  ctx.textBaseline = 'top';
  const yPos = Math.floor(fontSize * 0.15);
  const rm = ctx.measureText(right);
  const gap = fontSize; // minimum gap between left and right text
  const maxLeftWidth = width - rm.width - gap;
  // Truncate left text if too long
  let truncLeft = left;
  if (ctx.measureText(truncLeft).width > maxLeftWidth) {
    while (truncLeft.length > 1 && ctx.measureText(truncLeft + '..').width > maxLeftWidth) {
      truncLeft = truncLeft.slice(0, -1);
    }
    truncLeft += '..';
  }
  ctx.fillText(truncLeft, 0, yPos);
  ctx.fillText(right, width - rm.width, yPos);

  const imgData = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const raster = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = imgData[idx] * 0.299 + imgData[idx+1] * 0.587 + imgData[idx+2] * 0.114;
      if (gray < 128) {
        raster[y * bytesPerRow + Math.floor(x / 8)] |= (0x80 >> (x % 8));
      }
    }
  }
  // Replace last printLine with this combined one
  parts.pop();
  parts.push(rasterCmd(raster, bytesPerRow, height));
}

function buildEscPos(job) {
  const parts = [];
  const push = (...b) => parts.push(Buffer.from(b));
  const feed = (n) => push(ESC_BYTE, 0x64, n);
  const cut  = () => push(GS_BYTE, 0x56, 1);

  // ESC @ — init printer
  push(ESC_BYTE, 0x40);

  const S  = 34;  // normal text size
  const SM = 28;  // small text (English sub-lines, mods)
  const LG = 48;  // shop name / title

  if (job.type === 'test') {
    printLine(parts, 'TEST PRINT', { fontSize: LG, bold: true, align: 'center' });
    printLine(parts, '打印测试 OK', { fontSize: S, align: 'center' });
    printLine(parts, 'Printer is working!', { fontSize: S, align: 'center' });
    printLine(parts, `IP: ${job.printerIp || '?'}`, { fontSize: S, align: 'center' });
    printLine(parts, `Port: ${job.printerPort || 9100}`, { fontSize: S, align: 'center' });
    printLine(parts, new Date().toLocaleString(), { fontSize: S, align: 'center' });
    feed(3); cut();

  } else if (job.type === 'orderSlip') {
    const d = job.data;
    // Date/time left, table number large right
    printLR(parts, d.dateTime || '', d.table, { fontSize: LG, bold: true });
    const ol = d.labels || {};
    printLine(parts, d.isUpdate ? (ol.orderUpdate || 'ORDER UPDATE') : (ol.newOrder || 'NEW ORDER'), { fontSize: S, bold: true, align: 'left' });
    if (d.cashier) printLine(parts, `${ol.cashier || 'Cashier'}: ${d.cashier}`, { fontSize: SM });
    if (d.pax > 0) printLine(parts, `Pax: ${d.pax}`, { fontSize: SM });
    printDash(parts);
    (d.items || []).forEach((item, idx) => {
      // Qty + Chinese name (large, bold) on first line
      const zhLabel = `${item.qty}x  ${item.nameZh || item.nameEn || ''}`;
      printLine(parts, zhLabel, { fontSize: S, bold: true });
      // English name on second line (smaller)
      if (item.nameEn && item.nameZh) printLine(parts, `    ${item.nameEn}`, { fontSize: SM });
      // Modifiers with - prefix
      const mods = Array.isArray(item.mods) ? item.mods : (item.mods ? [item.mods] : []);
      mods.forEach(m => {
        if (m) printLine(parts, `    -${m}`, { fontSize: SM });
      });
      // Notes with * prefix
      if (item.notes) printLine(parts, `    *${item.notes}`, { fontSize: SM });
      // Separator between items
      if (idx < d.items.length - 1) printDash(parts);
    });
    printDash(parts);
    feed(3); cut();

  } else if (job.type === 'receipt') {
    const d = job.data;
    printLine(parts, d.shopName || 'BKT House', { fontSize: LG, bold: true, align: 'center' });
    if (d.shopAddress) printLine(parts, d.shopAddress, { fontSize: SM, align: 'center' });
    const rl = d.labels || {};
    const cur = d.currency || 'RM';
    printLine(parts, rl.officialReceipt || 'Official Receipt', { fontSize: S, align: 'center' });
    printLine(parts, rl.receipt || 'RECEIPT', { fontSize: S, bold: true, align: 'center' });
    printDash(parts);
    printLR(parts, rl.receiptNo || 'Receipt No', d.receiptNo, { fontSize: S });
    printLR(parts, rl.table || 'Table', d.table, { fontSize: S });
    printLR(parts, rl.date || 'Date', d.dateStr, { fontSize: S });
    printLR(parts, rl.time || 'Time', d.timeStr, { fontSize: S });
    if (d.cashier) printLR(parts, rl.servedBy || 'Served by', d.cashier, { fontSize: S });
    printDash(parts);
    (d.items || []).forEach(item => {
      printLR(parts, `${item.qty}x ${item.nameZh || ''}`, `${cur}${item.price}`, { fontSize: S, bold: true });
      if (item.nameEn) printLine(parts, `   ${item.nameEn}`, { fontSize: SM });
      if (item.mods)   printLine(parts, `   [${item.mods}]`, { fontSize: SM });
      if (item.notes)  printLine(parts, `   * ${item.notes}`, { fontSize: SM });
    });
    printDash(parts);
    printLR(parts, rl.subtotal || 'Subtotal', `${cur}${d.subtotal || d.total}`, { fontSize: S });
    if (d.sst) printLR(parts, `${rl.sst || 'SST'} (${d.sstRate || 6}%)`, `${cur}${d.sst}`, { fontSize: S });
    if (d.svc) printLR(parts, `${rl.service || 'Service'} (${d.svcRate || 10}%)`, `${cur}${d.svc}`, { fontSize: S });
    printLR(parts, rl.total || 'TOTAL', `${cur}${d.total}`, { fontSize: 40, bold: true });
    printDash(parts);
    printLR(parts, rl.payment || 'Payment', d.payLabel, { fontSize: S });
    push(LF_BYTE);
    printLine(parts, d.lang === 'zh' ? '感谢您的光临！' : 'Thank you for dining with us!', { fontSize: S, align: 'center' });
    printLine(parts, d.lang === 'zh' ? '欢迎再来 :)' : 'Please come again :)', { fontSize: S, align: 'center' });
    feed(3); cut();
  }

  return Buffer.concat(parts);
}

function sendTcpData(ip, port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(port, ip, () => {
      sock.end(data, resolve);
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('error', reject);
  });
}

app.post('/api/print', async (req, res) => {
  try {
    const settings    = await req.store.getSettings();
    const printerIp   = settings.printerIp;
    const printerPort = parseInt(settings.printerPort, 10) || 9100;

    if (!printerIp) return res.status(400).json({ error: 'No printer IP configured' });

    const job = req.body;
    job.printerIp   = job.printerIp || printerIp;
    job.printerPort = job.printerPort || printerPort;

    const escpos = buildEscPos(job);
    console.log(`[print] type=${job.type} size=${escpos.length}B → ${printerIp}:${printerPort}`);

    // Try sending to printer
    let sent = false;
    try {
      await sendTcpData(printerIp, printerPort, escpos);
      sent = true;
    } catch (_) {}

    // Return built ESC/POS so frontend can use relay fallback
    const escposB64 = escpos.toString('base64');

    if (sent) {
      res.json({ ok: true, escpos: escposB64 });
    } else {
      res.status(502).json({ error: 'TCP send failed', escpos: escposB64 });
    }
  } catch (e) {
    res.status(500).json({ error: `Print failed: ${e.message}` });
  }
});

// ─── Cloud Sync (background backup to MongoDB) ──────────────────────────────
// When running locally (file store), sync order history + settings to cloud
// MongoDB after each payment. Queues failed syncs and retries.

let cloudSync = null; // assigned in start() if SYNC_MONGODB_URI is set

function createCloudSync(uri) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  let db = null;
  let connected = false;
  const queue = []; // pending sync items
  let flushing = false;

  async function ensureConnected() {
    if (connected) return true;
    try {
      await client.connect();
      db = client.db('pos');
      await db.collection('orderHistory').createIndex({ timestamp: -1 });
      connected = true;
      console.log('[sync] Cloud MongoDB connected');
      return true;
    } catch (e) {
      console.error('[sync] Cloud MongoDB connect failed:', e.message);
      return false;
    }
  }

  async function flush() {
    if (flushing || queue.length === 0) return;
    flushing = true;
    try {
      if (!await ensureConnected()) { flushing = false; return; }
      while (queue.length > 0) {
        const item = queue[0];
        try {
          if (item.type === 'orderHistory') {
            // Upsert by order id to avoid duplicates
            await db.collection('orderHistory').replaceOne(
              { id: item.data.id }, item.data, { upsert: true }
            );
          } else if (item.type === 'settings') {
            await db.collection('settings').replaceOne(
              { _id: 'main' }, { _id: 'main', ...item.data }, { upsert: true }
            );
          } else if (item.type === 'menu') {
            await db.collection('settings').replaceOne(
              { _id: 'menu' }, { _id: 'menu', items: item.data }, { upsert: true }
            );
          }
          queue.shift(); // success — remove from queue
        } catch (e) {
          console.error('[sync] Failed to sync item:', e.message);
          connected = false;
          break; // retry later
        }
      }
    } finally {
      flushing = false;
    }
  }

  // Retry queued items every 60 seconds
  setInterval(() => { if (queue.length > 0) flush(); }, 60000);

  return {
    syncOrder(order)      { queue.push({ type: 'orderHistory', data: order }); return flush(); },
    syncSettings(s)       { queue.push({ type: 'settings', data: s }); return flush(); },
    syncMenu(items)       { queue.push({ type: 'menu', data: items }); return flush(); },
    queueLength()         { return queue.length; },
    async close()         { if (connected) await client.close(); },
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────

let store; // assigned in start()

async function cleanupStaleBills(s) {
  try {
    const bills = await s.getAllBills();
    for (const [table, bill] of Object.entries(bills)) {
      if (!bill.items || bill.items.length === 0) {
        await s.deleteBill(table);
      }
    }
    console.log('Stale bill cleanup complete');
  } catch (e) {
    console.error('Stale bill cleanup error:', e.message);
  }
}

async function start() {
  if (isSaasMode) {
    // ── SaaS multi-tenant mode ──
    const { MongoClient } = require('mongodb');
    saasClient = new MongoClient(process.env.MONGODB_URI);
    await saasClient.connect();
    saasDb = saasClient.db('saas');
    await saasDb.collection('tenants').createIndex({ slug: 1 }, { unique: true });
    console.log('SaaS mode: connected to MongoDB, multi-tenant active');

    // Pre-warm stores for all active tenants and sync shop names
    const tenants = await saasDb.collection('tenants').find({ status: 'active' }).toArray();
    for (const t of tenants) {
      const ts = getTenantStore(t.slug, t.dbName);
      await ts.connect();
      // Ensure shop name/address is synced to tenant settings
      const settings = await ts.getSettings();
      if (!settings.shopName || settings.shopName !== t.name) {
        settings.shopName = t.name;
        settings.shopAddress = t.address || settings.shopAddress || '';
        await ts.saveSettings(settings);
      }
    }
    console.log(`Pre-warmed ${tenants.length} tenant store(s)`);

    // Initialize demo database
    demoStore = createTenantStore('pos_demo');
    await demoStore.connect();
    console.log('Demo database ready (pos_demo)');
  } else {
    // ── Single-tenant mode (original behavior) ──
    store = process.env.MONGODB_URI ? createMongoStore() : createFileStore();
    await store.connect();
    await cleanupStaleBills(store);

    const existingUsers = await store.getUsers();
    if (!existingUsers || existingUsers.length === 0) {
      await store.saveUsers([{
        id: 'user_default',
        name: 'Admin',
        pin: '1234',
        role: 'super',
      }]);
      console.log('Seeded default super user (Admin / PIN 1234)');
    }

    // Cloud sync: when running locally (file store), sync to cloud MongoDB
    const syncUri = process.env.SYNC_MONGODB_URI;
    if (!process.env.MONGODB_URI && syncUri) {
      cloudSync = createCloudSync(syncUri);
      console.log('Cloud sync enabled (background backup to MongoDB)');
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    let localIP = 'localhost';
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
      }
    }
    const mode = process.env.MONGODB_URI ? 'MongoDB (cloud)' : 'File (local)';
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const baseUrl = railwayDomain ? `https://${railwayDomain}` : `http://${localIP}:${PORT}`;
    console.log(`\nPOS Server running  [${mode}]`);
    console.log(`  POS            →  ${baseUrl}`);
    console.log(`  Kitchen Status →  ${baseUrl}/kds.html`);
    console.log(`  Kitchen Display→  ${baseUrl}/kds/\n`);
  });
}

process.on('SIGTERM', () => { server.close(async () => { if (cloudSync) await cloudSync.close(); store.close(); process.exit(0); }); });
process.on('SIGINT',  () => { server.close(async () => { if (cloudSync) await cloudSync.close(); store.close(); process.exit(0); }); });

start().catch(e => { console.error('Failed to start server:', e); process.exit(1); });
