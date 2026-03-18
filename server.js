'use strict';

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

    close() { return client.close(); },
  };
}

// ─── WebSocket hub ────────────────────────────────────────────────────────────

const clients = { pos: new Set(), kds: new Set() };

// ─── Per-table mutation queue ─────────────────────────────────────────────────
// All bill reads/writes for the same table are serialised through this queue.
// Without it, concurrent status changes each read the same stale bill and
// overwrite each other — so archiveIfAllServed never sees all items as served.
const tableQueues = new Map();

function queueTableUpdate(table, fn) {
  const prev = tableQueues.get(table) || Promise.resolve();
  const next = prev.then(fn).catch(e => console.error(`[queue:${table}]`, e.message));
  tableQueues.set(table, next);
  next.finally(() => { if (tableQueues.get(table) === next) tableQueues.delete(table); });
  return next;
}

function broadcast(targets, message) {
  const payload = JSON.stringify(message);
  targets.forEach(role =>
    clients[role].forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    })
  );
}

// saveKdsHistory: record kitchen service without deleting the bill.
// The bill stays alive so the POS can still collect payment.
async function saveKdsHistory(table, bill) {
  const servedAt = Date.now();
  await store.addKdsHistory({
    table,
    servedAt,
    startedAt: bill.startedAt,
    items: bill.items.map(({ id, name, nameZh, quantity, sentAt, readyAt }) => ({
      id, name, nameZh, quantity, sentAt, readyAt: readyAt || servedAt,
    })),
  });
  broadcast(['pos', 'kds'], { type: 'bill:allServed', table });
}

// archiveBill: full close — save kds-history + DELETE bill + broadcast cleared.
// Only used when starting a new ordering round for a table that still has
// unserved items (so the old partial order isn't left dangling).
async function archiveBill(table, bill) {
  await saveKdsHistory(table, bill);
  await store.deleteBill(table);
  broadcast(['pos', 'kds'], { type: 'bill:cleared', table });
}

async function archiveIfAllServed(table, bill) {
  if (!bill.items.every(i => i.status === 'served')) return;
  // Re-read from store to guard against race with concurrent requests
  const current = await store.getBill(table);
  if (!current || !current.items.every(i => i.status === 'served')) return;
  // Record to kds-history but keep bill active for payment collection
  await saveKdsHistory(table, current);
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
      queueTableUpdate(msg.table, async () => {
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

        await archiveIfAllServed(msg.table, bill);
      });
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

  // POST = new ordering round — close out any existing bill before starting fresh.
  // If all items are already served the bill is already in kds-history; just
  // delete it.  If it has unserved items, archive it (saves to kds-history first).
  if (bill && bill.items.length > 0) {
    if (bill.items.every(i => i.status === 'served')) {
      await store.deleteBill(table);
      broadcast(['pos', 'kds'], { type: 'bill:cleared', table });
    } else {
      await archiveBill(table, bill);
    }
    bill = null;
  }

  if (!bill) bill = { startedAt: Date.now(), items: [] };

  const enhanced = (req.body.items || []).map(item => ({
    ...item, status: 'cooking', sentAt: Date.now(), readyAt: null,
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
      : { ...item, status: 'cooking', sentAt: Date.now(), readyAt: null };
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

app.delete('/api/bills', async (req, res) => {
  const bills = await store.getAllBills();
  await Promise.all(Object.keys(bills).map(t => store.deleteBill(t)));
  broadcast(['pos', 'kds'], { type: 'bill:cleared', table: '*' });
  res.json({ ok: true });
});

app.patch('/api/bills/:table/items/:itemId/status', (req, res) => {
  const { table, itemId } = req.params;
  const { status } = req.body;
  queueTableUpdate(table, async () => {
    const bill = await store.getBill(table);
    if (!bill) { res.status(404).json({ error: 'No bill for this table' }); return; }
    const item = bill.items.find(i => i.id === itemId);
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

    item.status = status;
    if (status === 'ready') item.readyAt = Date.now();
    await store.saveBill(table, bill);

    broadcast(['pos', 'kds'], { type: 'item:statusChanged', table, itemId, status, item });

    const allReady = bill.items.every(i => i.status === 'ready' || i.status === 'served');
    if (allReady) broadcast(['pos'], { type: 'table:allReady', table });

    res.json(item);

    await archiveIfAllServed(table, bill);
  });
});

// Atomic serve-all: marks every item served and archives in one DB operation.
// Avoids the concurrent-PATCH race condition where Promise.all overwrites cause
// archiveIfAllServed to never see all items as served.
app.post('/api/bills/:table/serve', (req, res) => {
  const table = req.params.table;
  queueTableUpdate(table, async () => {
    const bill = await store.getBill(table);
    if (!bill) { res.status(404).json({ error: 'No bill' }); return; }

    const now = Date.now();
    bill.items.forEach(item => {
      item.status = 'served';
      if (!item.readyAt) item.readyAt = now;
    });

    // Save served statuses to DB, record to kds-history, but keep bill alive
    // so the POS can still collect payment.
    await store.saveBill(table, bill);
    await saveKdsHistory(table, bill); // records kds-history + broadcasts bill:allServed
    res.json({ ok: true });
  });
});

// ─── REST API: KDS History ────────────────────────────────────────────────────

app.get('/api/kds-history',    async (req, res) => res.json(await store.getKdsHistory()));
app.post('/api/kds-history',   async (req, res) => { await store.addKdsHistory(req.body); res.json({ ok: true }); });
app.delete('/api/kds-history', async (req, res) => { await store.deleteKdsHistory(); res.json({ ok: true }); });

// ─── REST API: Order History ──────────────────────────────────────────────────

app.get('/api/history', async (req, res) => {
  const from = req.query.from ? Number(req.query.from) : undefined;
  const to   = req.query.to   ? Number(req.query.to)   : undefined;
  res.json(await store.getOrderHistory(from, to));
});
app.post('/api/history', async (req, res) => {
  await store.addOrderHistory(req.body);
  if (cloudSync) await cloudSync.syncOrder(req.body);
  res.json({ ok: true });
});
app.delete('/api/history', async (req, res) => { await store.deleteOrderHistory(); res.json({ ok: true }); });

// ─── REST API: Menu ───────────────────────────────────────────────────────────

app.get('/api/menu', async (req, res) => res.json(await store.getMenuItems()));
app.put('/api/menu', async (req, res) => {
  await store.saveMenuItems(req.body);
  if (cloudSync) await cloudSync.syncMenu(req.body);
  res.json({ ok: true });
});

// ─── REST API: Settings ───────────────────────────────────────────────────────

app.get('/api/settings',    async (req, res) => res.json(await store.getSettings()));
app.put('/api/settings', async (req, res) => {
  await store.saveSettings(req.body);
  if (cloudSync) await cloudSync.syncSettings(req.body);
  res.json({ ok: true });
});
app.delete('/api/settings', async (req, res) => { await store.deleteSettings(); res.json({ ok: true }); });

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
    const history = await store.getOrderHistory();
    for (const order of history) cloudSync.syncOrder(order);
    // Sync settings + menu
    cloudSync.syncSettings(await store.getSettings());
    cloudSync.syncMenu(await store.getMenuItems());
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
  ctx.fillText(left, 0, yPos);
  const rm = ctx.measureText(right);
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

  const S  = 24;  // normal text size
  const SM = 20;  // small text (English sub-lines, mods)
  const LG = 40;  // shop name / title

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
    printLR(parts, d.dateTime || '', `T${d.table}`, { fontSize: LG, bold: true });
    printLine(parts, d.isUpdate ? 'ORDER UPDATE' : 'NEW ORDER', { fontSize: S, bold: true, align: 'left' });
    printDash(parts);
    (d.items || []).forEach((item, idx) => {
      // Qty + English name + Chinese name (bold)
      const label = `${item.qty}  ${item.nameEn || ''}${item.nameZh ? ' ' + item.nameZh : ''}`;
      printLine(parts, label, { fontSize: S, bold: true });
      // Modifiers with - prefix
      const mods = Array.isArray(item.mods) ? item.mods : (item.mods ? [item.mods] : []);
      mods.forEach(m => {
        if (m) printLine(parts, `   -${m}`, { fontSize: SM });
      });
      // Notes with * prefix
      if (item.notes) printLine(parts, `   *${item.notes}`, { fontSize: SM });
      // Separator between items
      if (idx < d.items.length - 1) printDash(parts);
    });
    printDash(parts);
    feed(3); cut();

  } else if (job.type === 'receipt') {
    const d = job.data;
    printLine(parts, d.shopName || 'BKT House', { fontSize: LG, bold: true, align: 'center' });
    if (d.shopAddress) printLine(parts, d.shopAddress, { fontSize: SM, align: 'center' });
    printLine(parts, 'Official Receipt', { fontSize: S, align: 'center' });
    printLine(parts, 'RECEIPT', { fontSize: S, bold: true, align: 'center' });
    printDash(parts);
    printLR(parts, 'Receipt No', d.receiptNo, { fontSize: S });
    printLR(parts, 'Table', d.table, { fontSize: S });
    printLR(parts, 'Date', d.dateStr, { fontSize: S });
    printLR(parts, 'Time', d.timeStr, { fontSize: S });
    printDash(parts);
    (d.items || []).forEach(item => {
      printLR(parts, `${item.qty}x ${item.nameZh || ''}`, `RM${item.price}`, { fontSize: S, bold: true });
      if (item.nameEn) printLine(parts, `   ${item.nameEn}`, { fontSize: SM });
      if (item.mods)   printLine(parts, `   [${item.mods}]`, { fontSize: SM });
      if (item.notes)  printLine(parts, `   * ${item.notes}`, { fontSize: SM });
    });
    printDash(parts);
    printLR(parts, 'Subtotal', `RM${d.subtotal || d.total}`, { fontSize: S });
    if (d.sst) printLR(parts, `SST (${d.sstRate || 6}%)`, `RM${d.sst}`, { fontSize: S });
    if (d.svc) printLR(parts, `Service (${d.svcRate || 10}%)`, `RM${d.svc}`, { fontSize: S });
    printLR(parts, 'TOTAL', `RM${d.total}`, { fontSize: 28, bold: true });
    printDash(parts);
    printLR(parts, 'Payment', d.payLabel, { fontSize: S });
    push(LF_BYTE);
    printLine(parts, 'Thank you for dining with us!', { fontSize: S, align: 'center' });
    printLine(parts, 'Please come again :)', { fontSize: S, align: 'center' });
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
    const settings    = await store.getSettings();
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

async function cleanupStaleBills() {
  try {
    const bills = await store.getAllBills();
    for (const [table, bill] of Object.entries(bills)) {
      if (!bill.items || bill.items.length === 0) {
        await store.deleteBill(table);
      }
      // Served bills are kept — they await payment collection in the POS.
    }
    console.log('Stale bill cleanup complete');
  } catch (e) {
    console.error('Stale bill cleanup error:', e.message);
  }
}

async function start() {
  store = process.env.MONGODB_URI ? createMongoStore() : createFileStore();
  await store.connect();
  await cleanupStaleBills();

  // Cloud sync: when running locally (file store), sync to cloud MongoDB
  const syncUri = process.env.SYNC_MONGODB_URI;
  if (!process.env.MONGODB_URI && syncUri) {
    cloudSync = createCloudSync(syncUri);
    console.log('Cloud sync enabled (background backup to MongoDB)');
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
