'use strict';

const http = require('http');
const net  = require('net');

const PORT = process.env.RELAY_PORT || 9101;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/print') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { printerIp, printerPort, data } = JSON.parse(body);
        if (!printerIp || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'printerIp and data required' }));
          return;
        }

        const buf  = Buffer.from(data, 'base64');
        const port = parseInt(printerPort, 10) || 9100;
        const sock = net.createConnection(port, printerIp, () => {
          sock.end(buf, () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          });
        });
        sock.setTimeout(5000);
        sock.on('timeout', () => {
          sock.destroy();
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'timeout' }));
        });
        sock.on('error', (e) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Print relay listening on http://localhost:${PORT}`);
  console.log('POST /print  { printerIp, printerPort, data (base64) }');
});
