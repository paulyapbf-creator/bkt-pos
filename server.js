'use strict';

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
app.use('/kds', express.static(path.join(__dirname, 'public')));
// Serve POS files — supports both local dev layout (../pos) and single-repo layout (./pos)
const { existsSync } = require('fs');
const posPath = existsSync(path.join(__dirname, 'pos'))
  ? path.join(__dirname, 'pos')
  : path.join(__dirname, '..', 'pos');
app.use(express.static(posPath));

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
      if (d.orderHistory.length > 300) d.orderHistory.length = 300;
      save(d);
    },
    async getOrderHistory()    { return load().orderHistory || []; },
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
    async getOrderHistory() {
      return (await col('orderHistory').find({}).sort({ timestamp: -1 }).limit(300).toArray()).map(strip);
    },
    async deleteOrderHistory()  { await col('orderHistory').deleteMany({}); },

    async addKdsHistory(e)      { await col('kdsHistory').insertOne({ ...e }); },
    async getKdsHistory() {
      return (await col('kdsHistory').find({}).sort({ servedAt: -1 }).limit(200).toArray()).map(strip);
    },
    async deleteKdsHistory()    { await col('kdsHistory').deleteMany({}); },

    close() { return client.close(); },
  };
}

// ─── WebSocket hub ────────────────────────────────────────────────────────────

const clients = { pos: new Set(), kds: new Set() };

function broadcast(targets, message) {
  const payload = JSON.stringify(message);
  targets.forEach(role =>
    clients[role].forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    })
  );
}

wss.on('connection', (ws) => {
  ws.role = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      ws.role = msg.role === 'kds' ? 'kds' : 'pos';
      clients[ws.role].add(ws);
      return;
    }

    if (msg.type === 'item:statusChange') {
      const bill = await store.getBill(msg.table);
      if (!bill) return;
      const item = bill.items.find(i => i.id === msg.itemId);
      if (!item) return;

      item.status = msg.status;
      if (msg.status === 'ready') item.readyAt = Date.now();
      await store.saveBill(msg.table, bill);

      broadcast(['pos', 'kds'], {
        type: 'item:statusChanged', table: msg.table,
        itemId: msg.itemId, status: msg.status, item,
      });

      const allReady = bill.items.every(i => i.status === 'ready' || i.status === 'served');
      if (allReady) broadcast(['pos'], { type: 'table:allReady', table: msg.table });
    }
  });

  ws.on('close', () => { if (ws.role) clients[ws.role].delete(ws); });
});

// ─── REST API: Bills ──────────────────────────────────────────────────────────

app.get('/api/bills', async (req, res) => {
  res.json(await store.getAllBills());
});

app.get('/api/bills/:table', async (req, res) => {
  const bill = await store.getBill(req.params.table);
  if (!bill) return res.status(404).json({ error: 'No bill for this table' });
  res.json(bill);
});

app.post('/api/bills/:table/items', async (req, res) => {
  const table = req.params.table;
  let bill = await store.getBill(table);
  if (!bill) bill = { startedAt: Date.now(), items: [] };

  const enhanced = (req.body.items || []).map(item => ({
    ...item, status: 'pending', sentAt: Date.now(), readyAt: null,
  }));
  bill.items.push(...enhanced);
  await store.saveBill(table, bill);

  broadcast(['kds'], { type: 'order:new', table, bill });
  res.json(bill);
});

app.put('/api/bills/:table', async (req, res) => {
  const table    = req.params.table;
  const existing = await store.getBill(table);
  const existingMap = {};
  if (existing) existing.items.forEach(i => { existingMap[i.id] = i; });

  const items = (req.body.items || []).map(item => {
    const prev = existingMap[item.id];
    return prev
      ? { ...item, status: prev.status, sentAt: prev.sentAt, readyAt: prev.readyAt }
      : { ...item, status: 'pending', sentAt: Date.now(), readyAt: null };
  });

  const bill = { startedAt: existing?.startedAt || Date.now(), items };
  await store.saveBill(table, bill);

  broadcast(['kds'], { type: 'order:updated', table, bill });
  res.json(bill);
});

app.delete('/api/bills/:table', async (req, res) => {
  await store.deleteBill(req.params.table);
  broadcast(['kds'], { type: 'bill:cleared', table: req.params.table });
  res.json({ ok: true });
});

app.patch('/api/bills/:table/items/:itemId/status', async (req, res) => {
  const { table, itemId } = req.params;
  const { status } = req.body;
  const bill = await store.getBill(table);
  if (!bill) return res.status(404).json({ error: 'No bill for this table' });
  const item = bill.items.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  item.status = status;
  if (status === 'ready') item.readyAt = Date.now();
  await store.saveBill(table, bill);

  broadcast(['pos', 'kds'], { type: 'item:statusChanged', table, itemId, status, item });

  const allReady = bill.items.every(i => i.status === 'ready' || i.status === 'served');
  if (allReady) broadcast(['pos'], { type: 'table:allReady', table });

  res.json(item);
});

// ─── REST API: KDS History ────────────────────────────────────────────────────

app.get('/api/kds-history',    async (req, res) => res.json(await store.getKdsHistory()));
app.post('/api/kds-history',   async (req, res) => { await store.addKdsHistory(req.body); res.json({ ok: true }); });
app.delete('/api/kds-history', async (req, res) => { await store.deleteKdsHistory(); res.json({ ok: true }); });

// ─── REST API: Order History ──────────────────────────────────────────────────

app.get('/api/history',    async (req, res) => res.json(await store.getOrderHistory()));
app.post('/api/history',   async (req, res) => { await store.addOrderHistory(req.body); res.json({ ok: true }); });
app.delete('/api/history', async (req, res) => { await store.deleteOrderHistory(); res.json({ ok: true }); });

// ─── REST API: Menu ───────────────────────────────────────────────────────────

app.get('/api/menu', async (req, res) => res.json(await store.getMenuItems()));
app.put('/api/menu', async (req, res) => { await store.saveMenuItems(req.body); res.json({ ok: true }); });

// ─── REST API: Settings ───────────────────────────────────────────────────────

app.get('/api/settings',    async (req, res) => res.json(await store.getSettings()));
app.put('/api/settings',    async (req, res) => { await store.saveSettings(req.body); res.json({ ok: true }); });
app.delete('/api/settings', async (req, res) => { await store.deleteSettings(); res.json({ ok: true }); });

// ─── Start ────────────────────────────────────────────────────────────────────

let store; // assigned in start()

async function start() {
  store = process.env.MONGODB_URI ? createMongoStore() : createFileStore();
  await store.connect();

  server.listen(PORT, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    let localIP = 'localhost';
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
      }
    }
    const mode = process.env.MONGODB_URI ? 'MongoDB (cloud)' : 'File (local)';
    console.log(`\nPOS Server running  [${mode}]`);
    console.log(`  This device  →  http://localhost:${PORT}`);
    console.log(`  KDS device   →  http://${localIP}:${PORT}/kds.html`);
    console.log(`  Old KDS      →  http://${localIP}:${PORT}/kds/\n`);
  });
}

process.on('SIGTERM', () => { server.close(() => { store.close(); process.exit(0); }); });
process.on('SIGINT',  () => { server.close(() => { store.close(); process.exit(0); }); });

start().catch(e => { console.error('Failed to start server:', e); process.exit(1); });
