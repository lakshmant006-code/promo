// Serves this folder only: node prototype/server.mjs  ->  http://localhost:5174
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(5174, () => console.log('Prototype screen: http://localhost:5174'));
