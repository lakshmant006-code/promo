// Serves the prototype folder: node prototype/server.mjs  ->  http://localhost:5174
// The face screen also needs the MediaPipe library and the face model, which already live in this repo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(ROOT, '..');
const MOUNTS = [
  ['/vendor/tasks-vision/', path.join(REPO, 'node_modules/@mediapipe/tasks-vision/')],
  ['/models/', path.join(REPO, 'models/')],
  ['/', ROOT + path.sep],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of MOUNTS) {
    if (!p.startsWith(prefix)) continue;
    let file = path.normalize(path.join(dir, p.slice(prefix.length) || 'index.html'));
    if (!file.startsWith(dir)) break;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) continue;
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
}).listen(5174, () => console.log('Prototype screens: http://localhost:5174  and  http://localhost:5174/face/'));
