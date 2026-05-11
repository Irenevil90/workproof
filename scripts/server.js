#!/usr/bin/env node
/**
 * WorkProof local dev server
 * Zero npm dependencies — pure Node.js http + fs
 * Serves src/ at http://localhost:3000
 * Live reload via Server-Sent Events on file changes
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT    = 3000;
const SRC_DIR = path.join(__dirname, '..', 'src');

// ── MIME TYPES ──────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// ── LIVE RELOAD CLIENTS ─────────────────────────────
const clients = new Set();

function notifyClients() {
  for (const res of clients) {
    try { res.write('data: reload\n\n'); } catch {}
  }
}

// Watch src/ recursively
fs.watch(SRC_DIR, { recursive: true }, (event, filename) => {
  if (filename) {
    console.log(`  ↻  ${filename} changed — reloading…`);
    notifyClients();
  }
});

// ── LIVE RELOAD SNIPPET injected into HTML ──────────
const RELOAD_SNIPPET = `
<script>
(function() {
  const es = new EventSource('/__reload');
  es.onmessage = () => location.reload();
  es.onerror   = () => setTimeout(() => location.reload(), 1000);
})();
</script>
</body>`;

// ── SERVER ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname    = parsedUrl.pathname;

  // Live reload SSE endpoint
  if (pathname === '/__reload') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Serve index.html for root
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(SRC_DIR, pathname);

  // Security: prevent path traversal outside SRC_DIR
  if (!filePath.startsWith(SRC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Fallback to index.html for SPA routing
        fs.readFile(path.join(SRC_DIR, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          const html = injectReload(d2.toString());
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        });
      } else {
        res.writeHead(500); res.end('Server error');
      }
      return;
    }

    const ext      = path.extname(filePath).toLowerCase();
    const mimeType = MIME[ext] || 'application/octet-stream';

    if (ext === '.html') {
      const html = injectReload(data.toString());
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(data);
    }
  });
});

function injectReload(html) {
  return html.includes('</body>')
    ? html.replace('</body>', RELOAD_SNIPPET)
    : html + RELOAD_SNIPPET;
}

server.listen(PORT, () => {
  const line = '─'.repeat(42);
  console.log(`\n  ┌${line}┐`);
  console.log(`  │  WorkProof dev server                   │`);
  console.log(`  │  http://localhost:${PORT}                    │`);
  console.log(`  │  Live reload active — edit src/          │`);
  console.log(`  └${line}┘\n`);
});
