// Creates a self-signed certificate in ./certs so the iPad can open the app over HTTPS
// (Safari only allows the camera on HTTPS or localhost). Requires openssl on PATH.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'certs');
fs.mkdirSync(dir, { recursive: true });

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4')
  .map((i) => i.address);
const san = ['DNS:localhost', ...ips.map((ip) => `IP:${ip}`)].join(',');

execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
  '-keyout', path.join(dir, 'key.pem'),
  '-out', path.join(dir, 'cert.pem'),
  '-subj', '/CN=motion-rig-local',
  '-addext', `subjectAltName=${san}`,
], { stdio: 'inherit' });

console.log(`Certificate written to ${dir} for: ${san}`);
