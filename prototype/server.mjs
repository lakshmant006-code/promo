// Serves the prototype folder: node prototype/server.mjs  ->  http://localhost:5174
// The face screen also needs the MediaPipe library and the face model, which already live in this repo.
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
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
const handler = (req, res) => {
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
};
const PORT = Number(process.env.PORT) || 5174;
http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`Prototype screens: http://localhost:${PORT}  and  http://localhost:${PORT}/face/`);
});
// The camera only works on localhost or https. For an iPad on the same Wi-Fi, run `npm run cert` once, then open the https address.
const key = path.join(REPO, 'certs/key.pem'), cert = path.join(REPO, 'certs/cert.pem');
if (fs.existsSync(key) && fs.existsSync(cert)) {
  https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, handler).listen(PORT + 1, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`iPad (camera works here): https://${ip}:${PORT + 1}/face/   (accept the certificate warning once)`);
  });
} else console.log('For the iPad camera, run "npm run cert" once and restart this server.');
