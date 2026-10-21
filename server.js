// Local-only dev server for the Motion Rig prototype.
// - Serves ./public, the MediaPipe library from node_modules, and ./models
// - Live reload: any change under ./public refreshes open pages
// - Optional HTTPS (needed for the camera on an iPad over Wi-Fi): run `npm run cert` once
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HTTPS_PORT = PORT + 1;

const MOUNTS = [
  ['/vendor/tasks-vision/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/')],
  ['/vendor/imagetracer/', path.join(ROOT, 'node_modules/imagetracerjs/')],
  ['/vendor/ag-psd/', path.join(ROOT, 'node_modules/ag-psd/dist/')],
  ['/models/', path.join(ROOT, 'models/')],
  ['/', path.join(ROOT, 'public/')],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.task': 'application/octet-stream',
  '.map': 'application/json',
};

const reloadClients = new Set();

function resolveFile(urlPath) {
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return null; // no path traversal
    return file;
  }
  return null;
}

function handler(req, res) {
  const urlPath = new URL(req.url, 'http://x').pathname;

  if (urlPath === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  let file = resolveFile(urlPath);
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file || !fs.existsSync(file)) {
    console.log(`  404: ${urlPath}`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

let reloadTimer;
fs.watch(path.join(ROOT, 'public'), { recursive: true }, (_event, name) => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`  changed: ${name} -> reloading ${reloadClients.size} page(s)`);
    for (const client of reloadClients) client.write('data: reload\n\n');
  }, 120);
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log('\nMotion Rig prototype is running (local only, nothing goes to the cloud)\n');
  console.log(`  This PC:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Wi-Fi:     http://${ip}:${PORT}  (camera blocked here, use HTTPS below)`);
});

const keyFile = path.join(ROOT, 'certs/key.pem');
const certFile = path.join(ROOT, 'certs/cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https
    .createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      for (const ip of lanAddresses()) console.log(`  iPad:      https://${ip}:${HTTPS_PORT}  (accept the certificate warning once)`);
      console.log('');
    });
} else {
  console.log(`\n  For the iPad camera, run "npm run cert" once and restart.\n`);
}
