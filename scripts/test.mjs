// Lance le test de bout en bout tout seul : un serveur jetable (base PGlite vide, aucun mail envoyé),
// le scénario de scripts/smoke-test.mjs, puis le ménage. Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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

// Faux services extérieurs (recherche d'adresse IGN, API data.gouv.fr) : les tests ne dépendent pas d'internet
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const TOURISM_ROWS = [
  { __id: 1, Nom_du_POI: 'Fête du Livre', Categories_de_POI: 'https://www.datatourisme.fr/ontology/core#CulturalEvent|https://www.datatourisme.fr/ontology/core#Festival',
    Latitude: '45.4397', Longitude: '4.3872', Adresse_postale: 'Place Jean Jaurès', Code_postal_et_commune: '42000#Saint-Étienne',
    Periodes_regroupees: `${day(2)}<->${day(4)}`, Createur_de_la_donnee: 'Saint-Etienne Tourisme et Congrès', Date_de_mise_a_jour: day(-3),
    Contacts_du_POI: 'contact@fete.test#https://fete-du-livre.test/', Description: 'Rencontres et dédicaces.', URI_ID_du_POI: 'https://data.datatourisme.fr/13/aaa-111' },
  { __id: 2, Nom_du_POI: 'Marché de Carnot', Categories_de_POI: 'https://www.datatourisme.fr/ontology/core#SaleEvent|https://www.datatourisme.fr/ontology/core#Market',
    Latitude: '45.449', Longitude: '4.385', Adresse_postale: 'Place Carnot', Code_postal_et_commune: '42000#Saint-Étienne',
    Periodes_regroupees: `${day(-30)}<->${day(60)}`, Createur_de_la_donnee: 'Saint-Etienne Tourisme et Congrès', Contacts_du_POI: '#', Description: 'None',
    URI_ID_du_POI: 'https://data.datatourisme.fr/13/bbb-222' },
  { __id: 3, Nom_du_POI: 'Concert passé', Categories_de_POI: 'https://www.datatourisme.fr/ontology/core#Concert', Latitude: '45.44', Longitude: '4.39',
    Code_postal_et_commune: '42000#Saint-Étienne', Periodes_regroupees: `${day(-10)}<->${day(-10)}`, URI_ID_du_POI: 'https://data.datatourisme.fr/13/ccc-333' },
];
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (u.pathname === '/geocode/search') {
    const q = u.searchParams.get('q') || '';
    const features = /introuvable/i.test(q) ? [] : [{ geometry: { coordinates: [4.3901, 45.4402] }, properties: { label: q, city: 'Saint-Étienne', citycode: '42218', score: 0.93 } }];
    return res.end(JSON.stringify({ features }));
  }
  if (u.pathname === '/tabular/test-fma/data/') {
    return res.end(JSON.stringify({ data: TOURISM_ROWS, meta: { page: 1, page_size: 200, total: TOURISM_ROWS.length } }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;

// Environnement propre : jamais la vraie base, jamais de vrai mail
const RATE = 500; // plafond d'appels par minute, abaissé pour pouvoir le vérifier
const env = {
  ...process.env, PORT: String(port), ADMIN_EMAILS: 'admin@lanterne.test,fondateur@lanterne.test', PGLITE_DIR: path.join(tmp, 'base'),
  NODE_ENV: 'test', API_RATE_LIMIT: String(RATE), ADMIN_SETUP_CODE: `code-de-test-${Date.now()}`,
  GEOCODER_URL: `${fakeBase}/geocode/search`, TOURISME_API: `${fakeBase}/tabular`, TOURISME_RESOURCE: 'test-fma', FAKE_SERVICES: '1',
};
for (const k of ['DATABASE_URL', 'BREVO_API_KEY', 'RESEND_API_KEY', 'PUBLIC_URL', 'RAILWAY_PUBLIC_DOMAIN', 'BACKUP_EMAILS', 'PASSWORD_LOGIN', 'TOURISME']) delete env[k];

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
fake.close();
fs.closeSync(log);
if (code !== 0) {
  console.error('\n--- fin du journal du serveur ---');
  console.error(fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n'));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(code);
