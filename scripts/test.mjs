// Lance le test de bout en bout tout seul : un serveur jetable (base PGlite vide, aucun mail envoyé),
// le scénario de scripts/smoke-test.mjs, puis le ménage. Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lanterne-test-'));
const logFile = path.join(tmp, 'serveur.log');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const port = await freePort();
const base = `http://localhost:${port}`;

// Environnement propre : jamais la vraie base, jamais de vrai mail
const RATE = 500; // plafond d'appels par minute, abaissé pour pouvoir le vérifier
const env = { ...process.env, PORT: String(port), ADMIN_EMAILS: 'admin@lanterne.test', PGLITE_DIR: path.join(tmp, 'base'), NODE_ENV: 'test', API_RATE_LIMIT: String(RATE) };
for (const k of ['DATABASE_URL', 'BREVO_API_KEY', 'RESEND_API_KEY', 'PUBLIC_URL', 'RAILWAY_PUBLIC_DOMAIN', 'BACKUP_EMAILS']) delete env[k];

const log = fs.openSync(logFile, 'w');
const server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', log, log] });
let serverExit = null;
server.once('exit', (code) => { serverExit = code ?? 1; });

const stop = () => new Promise((resolve) => {
  if (serverExit !== null) return resolve();
  server.once('exit', resolve);
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 5000).unref();
});

let code = 1;
try {
  for (let i = 0; ; i++) {
    if (serverExit !== null) throw new Error('le serveur s’est arrêté au démarrage');
    try { if ((await fetch(`${base}/api/version`)).ok) break; } catch { /* pas encore prêt */ }
    if (i > 120) throw new Error('le serveur ne répond pas');
    await new Promise((r) => setTimeout(r, 250));
  }
  code = await new Promise((resolve) => {
    const t = spawn(process.execPath, ['scripts/smoke-test.mjs'], { cwd: root, env: { ...env, BASE: base, LOG: logFile, RATE: String(RATE) }, stdio: 'inherit' });
    t.once('exit', (c) => resolve(c ?? 1));
  });
} catch (err) {
  console.error(`\nTest interrompu : ${err.message}`);
}
await stop();
fs.closeSync(log);
if (code !== 0) {
  console.error('\n--- fin du journal du serveur ---');
  console.error(fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n'));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(code);
