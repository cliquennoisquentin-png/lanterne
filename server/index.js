// Lanterne — serveur
import './env.js'; // en premier : les autres fichiers lisent la configuration dès leur chargement
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, one, all, tx, closeDb } from './db.js';
import { loginMail, inviteMail, adminNewAssoMail, approvedMail, sendMail, describeMailSetup, backupMail } from './mail.js';
import { buildBackup, getMeta, setMeta } from './backup.js';
import { buildCalendar } from './ics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const SESSION_DAYS = 90;
const COOKIE = 'lt_sid';
// Numéro de version : change à chaque déploiement (sert au bouton « Mise à jour disponible »)
const VERSION = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 12) || `dev-${Date.now().toString(36)}`;

export const PALETTE = [
  { name: 'Ciel', hex: '#2B8FD9' }, { name: 'Cyan', hex: '#0095B0' }, { name: 'Turquoise', hex: '#00967F' },
  { name: 'Vert', hex: '#2F9533' }, { name: 'Citron', hex: '#7E8900' }, { name: 'Ambre', hex: '#B57600' },
  { name: 'Orange', hex: '#E0661C' }, { name: 'Corail', hex: '#F0506E' }, { name: 'Rose', hex: '#E040A0' },
  { name: 'Magenta', hex: '#C04BE0' }, { name: 'Violet', hex: '#8A63F0' }, { name: 'Indigo', hex: '#5B7BF5' },
];
const PALETTE_HEX = new Set(PALETTE.map((p) => p.hex));

// ---------- utilitaires ----------
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'asso';
const safeUrl = (u) => { const s = str(u, 500); if (!s) return ''; const v = /^https?:\/\//i.test(s) ? s : `https://${s}`; try { const x = new URL(v); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : ''; } catch { return ''; } };

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `${req.protocol}://${req.get('host')}`;
}

// Limiteur simple en mémoire (demandes de lien de connexion, inscriptions, invitations…)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
// Ménage régulier pour que le limiteur ne grossisse pas indéfiniment
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) if (!arr.length || now - arr[arr.length - 1] > 2 * 3600e3) hits.delete(k);
}, 30 * 60e3).unref();

// Garde-fou général : un plafond d'appels par minute et par adresse, pour qu'un robot ou une boucle
// folle ne mette pas la base à genoux. Très large : une personne normale n'en approche jamais.
const API_RATE_LIMIT = Math.max(60, Number(process.env.API_RATE_LIMIT) || 600);
const minuteWindows = new Map();
function throttle(req, res, next) {
  const now = Date.now();
  let w = minuteWindows.get(req.ip);
  if (!w || now - w.start >= 60e3) { w = { start: now, n: 0 }; minuteWindows.set(req.ip, w); }
  if (++w.n > API_RATE_LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((w.start + 60e3 - now) / 1000)));
    return res.status(429).json({ error: 'Trop de requêtes d’un coup. Réessayez dans une minute.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of minuteWindows) if (now - w.start >= 60e3) minuteWindows.delete(ip);
}, 5 * 60e3).unref();

// Valeurs de requête sûres
const dateParam = (v) => { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const intParam = (v, min, max, dflt) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= min ? Math.min(n, max) : dflt; };

// ---------- application ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression()); // fichiers compressés : chargements plus rapides sur mobile
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// En-têtes de sécurité. La politique de contenu (CSP) n'autorise que nos propres fichiers,
// le fond de carte OpenFreeMap et la recherche d'adresse de l'IGN.
const inlineScriptHashes = [...fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${inlineScriptHashes}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://tiles.openfreemap.org https://data.geopf.fr",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (!req.path.startsWith('/img/')) res.setHeader('Content-Security-Policy', CSP);
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// Numéros dans les adresses (/api/events/12…) : on refuse proprement ce qui n'est pas un nombre
app.param('id', (req, res, next, id) => (/^\d{1,10}$/.test(id) ? next() : res.status(404).json({ error: 'Introuvable.' })));

app.use(['/api', '/ics'], throttle);

// Protection CSRF : toute écriture sur l'API doit porter l'en-tête maison
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'lanterne') {
    return res.status(403).json({ error: 'Requête refusée.' });
  }
  next();
});

// Session
app.use(wrap(async (req, res, next) => {
  req.user = null;
  const sid = req.cookies[COOKIE];
  if (sid) {
    req.user = await one(
      `SELECT u.*, a.status AS asso_status, a.name AS asso_name, a.slug AS asso_slug, a.color AS asso_color
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN associations a ON a.id = u.association_id
       WHERE s.id = $1 AND s.expires_at > now()`, [sha(sid)]);
  }
  next();
}));

const requireUser = (req) => { if (!req.user) fail(401, 'Connectez-vous pour continuer.'); return req.user; };
const requireAdmin = (req) => { const u = requireUser(req); if (!u.is_admin) fail(403, 'Réservé aux administrateurs.'); return u; };
const memberAssoId = (u) => (u && u.association_id && u.asso_status === 'approved' ? u.association_id : null);
const requireMember = (req) => {
  const u = requireUser(req);
  if (!memberAssoId(u)) fail(403, u.association_id ? 'Votre association attend encore sa validation.' : 'Vous devez être rattaché à une association.');
  return u;
};

async function createSession(res, userId) {
  const sid = token();
  await q(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(sid), userId]);
  res.cookie(COOKIE, sid, { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5, path: '/' });
}

async function ensureUser(email, extra = {}) {
  let u = await one('SELECT * FROM users WHERE email = $1', [email]);
  if (!u) {
    u = await one('INSERT INTO users (email, name, association_id, is_admin, ics_token) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [email, extra.name || '', extra.association_id || null, ADMIN_EMAILS.includes(email), token(18)]);
  } else if (ADMIN_EMAILS.includes(email) && !u.is_admin) {
    u = await one('UPDATE users SET is_admin = true WHERE id = $1 RETURNING *', [u.id]);
  }
  return u;
}

// ---------- mots de passe ----------
// Connexion par mot de passe, en plus du lien reçu par mail. PASSWORD_LOGIN=off la coupe d'un seul réglage.
const PASSWORD_LOGIN = String(process.env.PASSWORD_LOGIN || '').toLowerCase() !== 'off';
const PASSWORD_MIN = 8;
// Une adresse d'administrateur ne peut créer son compte par mot de passe qu'avec ce code secret (réglé sur
// Railway). Sans code réglé, un administrateur passe forcément par le lien reçu par mail.
const ADMIN_SETUP_CODE = String(process.env.ADMIN_SETUP_CODE || '').trim();
if (ADMIN_SETUP_CODE && ADMIN_SETUP_CODE.length < 12) console.error('[lanterne] ADMIN_SETUP_CODE est trop court (12 caractères minimum) : il est ignoré.');
const adminCodeOk = (v) => {
  if (ADMIN_SETUP_CODE.length < 12) return false;
  const a = crypto.createHash('sha256').update(String(v ?? '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_SETUP_CODE).digest();
  return crypto.timingSafeEqual(a, b);
};

// On ne garde jamais le mot de passe : seulement une empreinte « scrypt », lente à calculer exprès
// (un voleur de la base ne peut pas retrouver les mots de passe en les essayant par millions).
const SCRYPT = { N: 32768, r: 8, p: 1 };
const scrypt = (pw, salt, { N, r, p }) => new Promise((resolve, reject) => {
  crypto.scrypt(pw.normalize('NFKC'), salt, 64, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key)));
});
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
async function checkPassword(pw, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(pw, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) }).catch(() => null);
  return !!key && key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
// Empreinte factice : pour une adresse inconnue, on fait le même calcul que pour une vraie (même temps de réponse)
const DUMMY_HASH = await hashPassword(token());

function passwordInput(v, email = '') {
  if (!PASSWORD_LOGIN) fail(403, 'La connexion par mot de passe est désactivée : demandez un lien de connexion par mail.');
  const pw = typeof v === 'string' ? v : '';
  if (pw.length < PASSWORD_MIN) fail(400, `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);
  if (pw.length > 200) fail(400, 'Mot de passe trop long (200 caractères maximum).');
  if (email && pw.toLowerCase() === email) fail(400, 'Choisissez un mot de passe différent de votre adresse mail.');
  return pw;
}

// Un lien reçu par mail prouve que l'adresse appartient bien à la personne. Si un mot de passe avait été
// posé avant cette preuve (peut-être par quelqu'un d'autre, avec une adresse qui n'est pas la sienne),
// on l'efface et on ferme toutes les sessions ouvertes : le vrai propriétaire en choisira un nouveau.
// Exception : la personne ouvre le lien en étant déjà connectée à ce même compte. Elle a donc à la fois
// le mot de passe et la boîte mail : c'est bien elle, on garde son mot de passe.
async function confirmEmail(u, req) {
  if (u.email_verified) return false;
  if (req.user?.id === u.id) { await q('UPDATE users SET email_verified = true WHERE id = $1', [u.id]); return false; }
  await q('UPDATE users SET email_verified = true, password_hash = NULL WHERE id = $1', [u.id]);
  if (u.password_hash) await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  return !!u.password_hash;
}
const afterLogin = (u, passwordCleared) => (passwordCleared ? '/compte?motdepasse=efface' : (u.name ? '/' : '/compte?bienvenue=1'));

async function logHistory(db, { entity, entityId, action, user, before = null, after = null }) {
  await db.query(
    'INSERT INTO history (entity, entity_id, action, user_id, user_name, association_name, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [entity, entityId, action, user?.id || null, user?.name || user?.email || '', user?.asso_name || '',
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, is_admin: u.is_admin, ics_token: u.ics_token, has_password: !!u.password_hash,
    association: u.association_id ? { id: u.association_id, name: u.asso_name, slug: u.asso_slug, color: u.asso_color, status: u.asso_status } : null,
  };
}

// ---------- version et état de santé ----------
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ version: VERSION }); });

// Railway interroge cette adresse avant de basculer sur une nouvelle version : si la base
// ne répond pas, l'ancienne version reste en ligne au lieu d'afficher une page d'erreur.
app.get('/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await q('SELECT 1');
    res.json({ ok: true, version: VERSION, uptime: Math.round(process.uptime()) });
  } catch (err) {
    console.error('[santé] base injoignable :', err.code || err.message);
    res.status(503).json({ ok: false });
  }
});

// ---------- configuration ----------
app.get('/api/config', wrap(async (req, res) => {
  const categories = await all('SELECT id, name, position, active FROM categories ORDER BY position, name');
  res.json({ palette: PALETTE, categories, user: publicUser(req.user), contact: process.env.CONTACT_EMAIL || '', version: VERSION, password_login: PASSWORD_LOGIN });
}));

// ---------- authentification ----------
app.post('/api/auth/request', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  if (!isEmail(email)) fail(400, 'Adresse mail invalide.');
  if (limited(`ip:${req.ip}`, 20, 15 * 60e3) || limited(`mail:${email}`, 5, 15 * 60e3)) fail(429, 'Trop de demandes. Réessayez dans quelques minutes.');
  const user = await one('SELECT id FROM users WHERE email = $1', [email]);
  const base = baseUrl(req);
  if (user || ADMIN_EMAILS.includes(email)) {
    const t = token();
    await q(`INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [sha(t), email]);
    const sent = await loginMail(email, `${base}/auth/verify?token=${t}`);
    if (!sent.ok) fail(502, 'Le mail de connexion n’a pas pu partir. Réessayez dans un instant ; si ça continue, prévenez un administrateur.');
  }
  // Adresse inconnue : aucun mail (sinon n'importe qui pourrait épuiser le quota d'envoi).
  // Même réponse dans tous les cas : on ne révèle pas qui a un compte.
  res.json({ ok: true });
}));

// Les liens des mails (/auth/verify, /auth/invite) ouvrent une page avec un bouton : seul ce clic
// consomme le lien. Ainsi, les antivirus de messagerie qui « visitent » les liens ne les grillent pas.
const tokenParam = (v) => (typeof v === 'string' && /^[\w-]{20,100}$/.test(v) ? v : '');

app.post('/api/auth/verify', wrap(async (req, res) => {
  const t = tokenParam(req.body.token);
  const row = t && await one(`UPDATE login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email`, [sha(t)]);
  if (!row) fail(410, 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.');
  const u = await ensureUser(row.email);
  const cleared = await confirmEmail(u, req);
  await createSession(res, u.id);
  res.json({ redirect: afterLogin(u, cleared) });
}));

// Créer son compte soi-même, avec un mot de passe : aucun mail nécessaire.
// Contrepartie : rien ne prouve que l'adresse appartient à la personne (voir confirmEmail). C'est pourquoi
// une adresse d'administrateur exige un code secret, et qu'un compte créé ainsi ne rejoint aucune association.
app.post('/api/auth/signup', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const name = str(req.body.name, 80);
  if (!isEmail(email)) fail(400, 'Adresse mail invalide.');
  if (!name) fail(400, 'Indiquez votre nom.');
  const pw = passwordInput(req.body.password, email);
  if (limited(`su:${req.ip}`, 10, 60 * 60e3)) fail(429, 'Trop de créations de compte. Réessayez plus tard.');
  if (await one('SELECT 1 FROM users WHERE email = $1', [email])) fail(409, 'Un compte existe déjà avec cette adresse. Connectez-vous, ou demandez un lien de connexion par mail.');
  const admin = ADMIN_EMAILS.includes(email);
  if (admin && ADMIN_SETUP_CODE.length < 12) fail(403, 'Cette adresse est celle d’un administrateur : connectez-vous avec le lien reçu par mail.');
  if (admin && !adminCodeOk(req.body.admin_code)) fail(403, req.body.admin_code ? 'Code administrateur incorrect.' : 'Cette adresse est celle d’un administrateur : saisissez le code administrateur.', 'admin_code');
  const u = await one('INSERT INTO users (email, name, is_admin, ics_token, password_hash, email_verified) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING RETURNING id',
    [email, name, admin, token(18), await hashPassword(pw), admin]);
  if (!u) fail(409, 'Un compte existe déjà avec cette adresse. Connectez-vous.');
  await createSession(res, u.id);
  res.json({ ok: true });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  if (!PASSWORD_LOGIN) fail(403, 'La connexion par mot de passe est désactivée : demandez un lien de connexion par mail.');
  const email = normEmail(req.body.email);
  const pw = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  if (limited(`li:${req.ip}`, 30, 15 * 60e3) || limited(`lm:${email}`, 10, 15 * 60e3)) fail(429, 'Trop d’essais. Réessayez dans un quart d’heure, ou demandez un lien de connexion par mail.');
  const u = isEmail(email) ? await one('SELECT id, password_hash FROM users WHERE email = $1', [email]) : null;
  const ok = await checkPassword(pw, u?.password_hash || DUMMY_HASH);
  // Même réponse pour une adresse inconnue, un compte sans mot de passe ou un mauvais mot de passe
  if (!u?.password_hash || !ok) fail(401, 'Adresse ou mot de passe incorrect.');
  await createSession(res, u.id);
  res.json({ redirect: '/' });
}));

const findInvite = (t) => one(`SELECT i.*, a.status, a.name AS asso_name, a.color AS asso_color FROM invitations i JOIN associations a ON a.id = i.association_id
  WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.created_at > now() - interval '30 days'`, [sha(t)]);

app.get('/api/auth/invite-info', wrap(async (req, res) => {
  const t = tokenParam(req.query.token);
  const inv = t && await findInvite(t);
  if (!inv) fail(410, 'Cette invitation a expiré ou a déjà servi. Demandez une nouvelle invitation à votre association.');
  res.json({ association: { name: inv.asso_name, color: inv.asso_color } });
}));

app.post('/api/auth/invite', wrap(async (req, res) => {
  const t = tokenParam(req.body.token);
  const inv = t && await findInvite(t);
  if (!inv) fail(410, 'Cette invitation a expiré ou a déjà servi. Demandez une nouvelle invitation à votre association.');
  let u = await one('SELECT * FROM users WHERE email = $1', [inv.email]);
  if (u && u.association_id && u.association_id !== inv.association_id) fail(409, 'Cette adresse est déjà rattachée à une autre association.');
  if (!u) u = await ensureUser(inv.email, { association_id: inv.association_id });
  else await q('UPDATE users SET association_id = $1 WHERE id = $2', [inv.association_id, u.id]);
  await q('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
  const cleared = await confirmEmail(u, req);
  await createSession(res, u.id);
  res.json({ redirect: afterLogin(u, cleared) });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  const sid = req.cookies[COOKIE];
  if (sid) await q('DELETE FROM sessions WHERE id = $1', [sha(sid)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

// ---------- compte ----------
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

app.put('/api/me', wrap(async (req, res) => {
  const u = requireUser(req);
  const name = str(req.body.name, 80);
  if (!name) fail(400, 'Indiquez votre nom.');
  await q('UPDATE users SET name = $1 WHERE id = $2', [name, u.id]);
  res.json({ ok: true });
}));

// Choisir ou changer son mot de passe. Les autres appareils connectés sont déconnectés.
app.put('/api/me/password', wrap(async (req, res) => {
  const u = requireUser(req);
  const pw = passwordInput(req.body.password, u.email);
  if (limited(`pw:${u.id}`, 10, 60 * 60e3)) fail(429, 'Trop de changements d’un coup. Réessayez plus tard.');
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(pw), u.id]);
  await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [u.id, sha(req.cookies[COOKIE])]);
  res.json({ ok: true });
}));

app.post('/api/me/ics-token', wrap(async (req, res) => {
  const u = requireUser(req);
  const t = token(18);
  await q('UPDATE users SET ics_token = $1 WHERE id = $2', [t, u.id]);
  res.json({ ics_token: t });
}));

app.post('/api/me/leave', wrap(async (req, res) => {
  const u = requireUser(req);
  await q('UPDATE users SET association_id = NULL WHERE id = $1', [u.id]);
  res.json({ ok: true });
}));

// Suppression du compte : on efface la personne et on anonymise ses traces
app.delete('/api/me', wrap(async (req, res) => {
  const u = requireUser(req);
  await tx(async (db) => {
    await db.query(`UPDATE history SET user_name = 'Compte supprimé' WHERE user_id = $1`, [u.id]);
    await db.query(`UPDATE comments SET author_name = 'Compte supprimé' WHERE user_id = $1`, [u.id]);
    await db.query('DELETE FROM login_tokens WHERE email = $1', [u.email]);
    await db.query('DELETE FROM invitations WHERE email = $1', [u.email]);
    await db.query('DELETE FROM users WHERE id = $1', [u.id]);
  });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

// ---------- images ----------
const IMG_RE = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;
async function saveImage(dataUrl) {
  const m = IMG_RE.exec(String(dataUrl || ''));
  if (!m) fail(400, 'Image invalide (PNG, JPEG, WebP ou SVG).');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2.5 * 1024 * 1024) fail(400, 'Image trop lourde (2,5 Mo maximum).');
  if (m[1] === 'image/svg+xml' && /<script|on\w+=|javascript:/i.test(buf.toString('utf8'))) fail(400, 'Image SVG refusée.');
  const id = token(12);
  await q('INSERT INTO images (id, mime, data) VALUES ($1, $2, $3)', [id, m[1], buf]);
  return id;
}

app.post('/api/images', wrap(async (req, res) => {
  requireUser(req);
  res.json({ id: await saveImage(req.body.data) });
}));

app.get('/img/:imageId', wrap(async (req, res) => {
  const img = await one('SELECT mime, data FROM images WHERE id = $1', [String(req.params.imageId).slice(0, 40)]);
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (img.mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(Buffer.from(img.data));
}));

// ---------- inscription d'une association ----------
async function uniqueSlug(name, exceptId = null) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await one('SELECT id FROM associations WHERE slug = $1', [slug]);
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
}

app.post('/api/register', wrap(async (req, res) => {
  if (limited(`reg:${req.ip}`, 5, 60 * 60e3)) fail(429, 'Trop de demandes. Réessayez plus tard.');
  const a = req.body.association || {};
  const p = req.body.person || {};
  const email = req.user ? req.user.email : normEmail(p.email);
  const personName = req.user ? (req.user.name || str(p.name, 80)) : str(p.name, 80);
  const name = str(a.name, 120);
  const contact = normEmail(a.contact_email || email);
  if (!name) fail(400, 'Indiquez le nom de l’association.');
  if (!isEmail(email)) fail(400, 'Indiquez votre adresse mail.');
  if (!personName) fail(400, 'Indiquez votre nom.');
  if (!isEmail(contact)) fail(400, 'Adresse de contact invalide.');
  const color = PALETTE_HEX.has(a.color) ? a.color : PALETTE[0].hex;
  // Sans être connecté, on peut choisir un mot de passe tout de suite : pas besoin d'attendre un mail
  const pw = !req.user && p.password ? passwordInput(p.password, email) : null;

  const existing = await one('SELECT * FROM users WHERE email = $1', [email]);
  if (existing && existing.association_id) fail(409, 'Cette adresse est déjà rattachée à une association.');
  if (pw && existing) fail(409, 'Un compte existe déjà avec cette adresse : connectez-vous d’abord, puis inscrivez votre association.');
  if (pw && ADMIN_EMAILS.includes(email)) fail(403, 'Cette adresse est celle d’un administrateur : créez d’abord votre compte, puis inscrivez votre association.');
  const dup = await one('SELECT id FROM associations WHERE lower(name) = lower($1)', [name]);
  if (dup) fail(409, 'Une association porte déjà ce nom. Demandez à ses membres de vous inviter.');

  const logoId = a.logo ? await saveImage(a.logo) : null;
  const slug = await uniqueSlug(name);
  const asso = await one(
    `INSERT INTO associations (name, slug, color, logo_id, description, contact_email, phone, website, commune, socials)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name, slug, color, logoId, str(a.description, 2000), contact, str(a.phone, 40), safeUrl(a.website), str(a.commune, 80), JSON.stringify({})]);

  let u = existing;
  if (u) u = await one('UPDATE users SET association_id = $1, name = COALESCE(NULLIF(name, \'\'), $2) WHERE id = $3 RETURNING *', [asso.id, personName, u.id]);
  else u = await ensureUser(email, { name: personName, association_id: asso.id });
  if (pw) u = await one('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *', [await hashPassword(pw), u.id]);
  await logHistory({ query: q }, { entity: 'association', entityId: asso.id, action: 'inscription', user: { ...u, asso_name: name }, after: asso });

  const base = baseUrl(req);
  const admins = await all('SELECT email FROM users WHERE is_admin');
  const adminList = new Set([...admins.map((x) => x.email), ...ADMIN_EMAILS]);
  for (const to of adminList) await adminNewAssoMail(to, name, `${base}/admin`);

  if (pw) await createSession(res, u.id); // connecté tout de suite
  else if (!req.user) {
    const t = token();
    await q(`INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [sha(t), email]);
    await loginMail(email, `${base}/auth/verify?token=${t}`);
  }
  res.json({ ok: true, slug, logged_in: !!pw });
}));

// ---------- associations ----------
const ASSO_FIELDS = 'a.id, a.name, a.slug, a.color, a.logo_id, a.description, a.contact_email, a.phone, a.website, a.socials, a.commune, a.status, a.created_at';

app.get('/api/associations', wrap(async (req, res) => {
  const rows = await all(`SELECT ${ASSO_FIELDS},
      (SELECT count(*)::int FROM event_orgs eo JOIN events e ON e.id = eo.event_id WHERE eo.association_id = a.id AND e.deleted_at IS NULL AND e.starts_at >= now() AND e.visibility = 'public' AND e.status <> 'option' AND e.type <> 'internal') AS upcoming_public
    FROM associations a WHERE a.status = 'approved' ORDER BY lower(a.name)`);
  res.json({ associations: rows });
}));

app.get('/api/associations/:slug', wrap(async (req, res) => {
  const a = await one(`SELECT ${ASSO_FIELDS} FROM associations a WHERE a.slug = $1`, [req.params.slug]);
  const mine = req.user && req.user.association_id === a?.id;
  if (!a || (a.status !== 'approved' && !mine && !req.user?.is_admin)) fail(404, 'Association introuvable.');
  let members = null; let invitations = null;
  if (mine || req.user?.is_admin) {
    members = await all('SELECT id, name, email FROM users WHERE association_id = $1 ORDER BY lower(name)', [a.id]);
    invitations = await all('SELECT id, email, created_at FROM invitations WHERE association_id = $1 AND accepted_at IS NULL ORDER BY created_at DESC', [a.id]);
  }
  res.json({ association: a, members, invitations, can_edit: !!(mine || req.user?.is_admin) });
}));

app.put('/api/associations/:id', wrap(async (req, res) => {
  const u = requireUser(req);
  const id = Number(req.params.id);
  if (u.association_id !== id && !u.is_admin) fail(403, 'Vous ne pouvez modifier que votre association.');
  const before = await one('SELECT * FROM associations WHERE id = $1', [id]);
  if (!before) fail(404, 'Association introuvable.');
  const b = req.body;
  const name = str(b.name, 120) || before.name;
  let logoId = before.logo_id;
  if (b.logo === null) logoId = null;
  else if (typeof b.logo === 'string' && b.logo.startsWith('data:')) logoId = await saveImage(b.logo);
  const socials = {};
  for (const k of ['facebook', 'instagram', 'mastodon', 'bluesky', 'tiktok', 'youtube', 'helloasso']) {
    const v = safeUrl(b.socials?.[k]);
    if (v) socials[k] = v;
  }
  const slug = name !== before.name ? await uniqueSlug(name, id) : before.slug;
  const after = await one(
    `UPDATE associations SET name=$1, slug=$2, color=$3, logo_id=$4, description=$5, contact_email=$6, phone=$7, website=$8, commune=$9, socials=$10 WHERE id=$11 RETURNING *`,
    [name, slug, PALETTE_HEX.has(b.color) ? b.color : before.color, logoId, str(b.description, 2000),
      isEmail(normEmail(b.contact_email)) ? normEmail(b.contact_email) : before.contact_email,
      str(b.phone, 40), safeUrl(b.website), str(b.commune, 80), JSON.stringify(socials), id]);
  await logHistory({ query: q }, { entity: 'association', entityId: id, action: 'modification', user: u, before, after });
  res.json({ association: after });
}));

app.post('/api/associations/:id/invitations', wrap(async (req, res) => {
  const u = requireMember(req);
  const id = Number(req.params.id);
  if (u.association_id !== id) fail(403, 'Vous ne pouvez inviter que dans votre association.');
  const emails = String(req.body.emails || '').split(/[\s,;]+/).map(normEmail).filter(Boolean);
  if (!emails.length) fail(400, 'Indiquez au moins une adresse.');
  if (emails.length > 30) fail(400, '30 invitations maximum à la fois.');
  if (limited(`inv:${u.id}`, 40, 60 * 60e3)) fail(429, 'Trop d’invitations d’un coup. Réessayez dans une heure.');
  const base = baseUrl(req);
  const result = { sent: [], skipped: [] };
  for (const email of emails) {
    if (!isEmail(email)) { result.skipped.push({ email, reason: 'adresse invalide' }); continue; }
    const other = await one('SELECT association_id FROM users WHERE email = $1', [email]);
    if (other?.association_id === id) { result.skipped.push({ email, reason: 'déjà membre' }); continue; }
    if (other?.association_id) { result.skipped.push({ email, reason: 'déjà dans une autre association' }); continue; }
    const t = token();
    await q('INSERT INTO invitations (association_id, email, invited_by, token_hash) VALUES ($1,$2,$3,$4)', [id, email, u.id, sha(t)]);
    await inviteMail(email, u.asso_name, u.name, `${base}/auth/invite?token=${t}`);
    result.sent.push(email);
  }
  res.json(result);
}));

app.delete('/api/invitations/:id', wrap(async (req, res) => {
  const u = requireUser(req);
  const inv = await one('SELECT * FROM invitations WHERE id = $1', [Number(req.params.id)]);
  if (!inv) fail(404, 'Invitation introuvable.');
  if (inv.association_id !== u.association_id && !u.is_admin) fail(403, 'Action non autorisée.');
  await q('DELETE FROM invitations WHERE id = $1', [inv.id]);
  res.json({ ok: true });
}));

// ---------- catégories ----------
app.post('/api/categories', wrap(async (req, res) => {
  requireAdmin(req);
  const name = str(req.body.name, 60);
  if (!name) fail(400, 'Nom manquant.');
  const pos = await one('SELECT COALESCE(max(position), 0) + 1 AS p FROM categories');
  const c = await one('INSERT INTO categories (name, position) VALUES ($1, $2) RETURNING *', [name, pos.p]).catch(() => fail(409, 'Cette catégorie existe déjà.'));
  res.json({ category: c });
}));

app.put('/api/categories/:id', wrap(async (req, res) => {
  requireAdmin(req);
  const c = await one('UPDATE categories SET name = COALESCE(NULLIF($1, \'\'), name), active = COALESCE($2, active), position = COALESCE($3, position) WHERE id = $4 RETURNING *',
    [str(req.body.name, 60), typeof req.body.active === 'boolean' ? req.body.active : null, Number.isInteger(req.body.position) ? req.body.position : null, Number(req.params.id)]);
  if (!c) fail(404, 'Catégorie introuvable.');
  res.json({ category: c });
}));

// ---------- lieux ----------
app.get('/api/venues', wrap(async (req, res) => {
  requireUser(req);
  res.json({ venues: await all('SELECT id, name, address, city, citycode, district, lat, lng, archived FROM venues ORDER BY lower(name)') });
}));

function venueInput(b) {
  const lat = b.lat === null || b.lat === '' || b.lat === undefined ? null : Number(b.lat);
  const lng = b.lng === null || b.lng === '' || b.lng === undefined ? null : Number(b.lng);
  return {
    name: str(b.name, 120), address: str(b.address, 200), city: str(b.city, 80), citycode: str(b.citycode, 10), district: str(b.district, 80),
    lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
  };
}

app.post('/api/venues', wrap(async (req, res) => {
  const u = requireMember(req);
  const v = venueInput(req.body);
  if (!v.name) fail(400, 'Indiquez le nom du lieu.');
  const dup = await one('SELECT * FROM venues WHERE lower(name) = lower($1) AND lower(city) = lower($2) AND NOT archived', [v.name, v.city]);
  if (dup) return res.json({ venue: dup });
  const venue = await one('INSERT INTO venues (name, address, city, citycode, district, lat, lng, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [v.name, v.address, v.city, v.citycode, v.district, v.lat, v.lng, u.id]);
  await logHistory({ query: q }, { entity: 'venue', entityId: venue.id, action: 'création', user: u, after: venue });
  res.json({ venue });
}));

app.put('/api/venues/:id', wrap(async (req, res) => {
  const u = requireAdmin(req);
  const before = await one('SELECT * FROM venues WHERE id = $1', [Number(req.params.id)]);
  if (!before) fail(404, 'Lieu introuvable.');
  const v = venueInput({ ...before, ...req.body });
  const archived = typeof req.body.archived === 'boolean' ? req.body.archived : before.archived;
  const after = await one('UPDATE venues SET name=$1, address=$2, city=$3, citycode=$4, district=$5, lat=$6, lng=$7, archived=$8 WHERE id=$9 RETURNING *',
    [v.name || before.name, v.address, v.city, v.citycode, v.district, v.lat, v.lng, archived, before.id]);
  await logHistory({ query: q }, { entity: 'venue', entityId: before.id, action: 'modification', user: u, before, after });
  res.json({ venue: after });
}));

// ---------- événements ----------
const EVENT_SELECT = `
  SELECT e.*, a.name AS asso_name, a.slug AS asso_slug, a.color AS asso_color,
         v.name AS venue_name, v.address AS venue_address, v.city AS venue_city, v.district AS venue_district, v.lat, v.lng,
         c.name AS category_name,
         r.starts_at AS rescheduled_from_date,
         COALESCE((SELECT json_agg(json_build_object('id', oa.id, 'name', oa.name, 'slug', oa.slug, 'color', oa.color) ORDER BY oa.id = e.association_id DESC, oa.name)
                   FROM event_orgs eo JOIN associations oa ON oa.id = eo.association_id WHERE eo.event_id = e.id), '[]') AS orgs,
         COALESCE((SELECT json_agg(json_build_object('id', ta.id, 'name', ta.name, 'slug', ta.slug, 'color', ta.color, 'kind', t.kind) ORDER BY t.created_at)
                   FROM attendances t JOIN associations ta ON ta.id = t.association_id WHERE t.event_id = e.id), '[]') AS attendances,
         (SELECT count(*)::int FROM comments cm WHERE cm.event_id = e.id AND cm.deleted_at IS NULL) AS comment_count
  FROM events e
  JOIN associations a ON a.id = e.association_id
  LEFT JOIN venues v ON v.id = e.venue_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN events r ON r.id = e.rescheduled_from`;

// Ce que chacun a le droit de voir (cahier des charges §3 et §6)
function visibility(user, params) {
  const PUBLIC = `(e.visibility = 'public' AND e.status <> 'option' AND e.type <> 'internal')`;
  const assoId = memberAssoId(user);
  if (!assoId) {
    if (user?.is_admin) return `(e.visibility IN ('public','associations'))`;
    return PUBLIC;
  }
  params.push(assoId);
  const p = `$${params.length}`;
  return `(e.visibility IN ('public','associations') OR EXISTS (SELECT 1 FROM event_orgs x WHERE x.event_id = e.id AND x.association_id = ${p}))`;
}

async function canEdit(user, eventId) {
  if (!user) return false;
  if (user.is_admin) return true;
  const assoId = memberAssoId(user);
  if (!assoId) return false;
  return !!(await one('SELECT 1 FROM event_orgs WHERE event_id = $1 AND association_id = $2', [eventId, assoId]));
}

app.get('/api/events', wrap(async (req, res) => {
  const params = [];
  const where = ['e.deleted_at IS NULL', 'a.status = \'approved\'', visibility(req.user, params)];
  const from = req.query.from ? dateParam(req.query.from) : null;
  const to = req.query.to ? dateParam(req.query.to) : null;
  if ((req.query.from && !from) || (req.query.to && !to)) fail(400, 'Date invalide.');
  if (from) { params.push(from); where.push(`COALESCE(e.ends_at, e.starts_at) >= $${params.length}`); }
  if (to) { params.push(to); where.push(`e.starts_at < $${params.length}`); }
  if (req.query.asso) { params.push(intParam(req.query.asso, 1, 2e9, 0)); where.push(`EXISTS (SELECT 1 FROM event_orgs y WHERE y.event_id = e.id AND y.association_id = $${params.length})`); }
  const order = req.query.order === 'desc' ? 'DESC' : 'ASC';
  const limit = intParam(req.query.limit, 1, 2000, 2000);
  const rows = await all(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.starts_at ${order} LIMIT ${limit}`, params);
  res.json({ events: rows.map(slimEvent) });
}));

function slimEvent(e) {
  const { created_by, ...rest } = e;
  return rest;
}

async function loadEvent(id, user) {
  const params = [Number(id)];
  const e = await one(`${EVENT_SELECT} WHERE e.id = $1 AND e.deleted_at IS NULL AND ${visibility(user, params)}`, params);
  return e;
}

app.get('/api/events/:id', wrap(async (req, res) => {
  const e = await loadEvent(req.params.id, req.user);
  if (!e) fail(404, 'Événement introuvable ou non visible.');
  const member = !!memberAssoId(req.user) || req.user?.is_admin;
  const comments = member ? await all(`SELECT cm.id, cm.body, cm.created_at, cm.user_id, cm.author_name, a.name AS asso_name, a.color AS asso_color, a.slug AS asso_slug
      FROM comments cm LEFT JOIN associations a ON a.id = cm.association_id WHERE cm.event_id = $1 AND cm.deleted_at IS NULL ORDER BY cm.created_at`, [e.id]) : [];
  const editable = await canEdit(req.user, e.id);
  const history = editable ? await all(`SELECT id, action, user_name, association_name, created_at, (before IS NOT NULL) AS revertible FROM history WHERE entity = 'event' AND entity_id = $1 ORDER BY created_at DESC LIMIT 50`, [e.id]) : [];
  const rescheduledTo = await one(`SELECT id, starts_at FROM events WHERE rescheduled_from = $1 AND deleted_at IS NULL`, [e.id]);
  res.json({ event: slimEvent(e), comments, history, can_edit: editable, can_interact: member, rescheduled_to: rescheduledTo });
}));

async function eventInput(b, user, existing = null) {
  const title = str(b.title, 160);
  const starts = new Date(b.starts_at);
  const ends = b.ends_at ? new Date(b.ends_at) : null;
  if (!title) fail(400, 'Le titre est obligatoire.');
  if (Number.isNaN(starts.getTime())) fail(400, 'La date et l’heure sont obligatoires.');
  if (ends && (Number.isNaN(ends.getTime()) || ends < starts)) fail(400, 'L’heure de fin doit venir après le début.');
  const venueId = Number(b.venue_id);
  if (!venueId || !(await one('SELECT 1 FROM venues WHERE id = $1', [venueId]))) fail(400, 'Le lieu est obligatoire.');
  const catId = Number(b.category_id);
  if (!catId || !(await one('SELECT 1 FROM categories WHERE id = $1', [catId]))) fail(400, 'La catégorie est obligatoire.');
  const type = ['public', 'internal', 'inter', 'ag'].includes(b.type) ? b.type : 'public';
  const status = ['option', 'en_cours', 'valide', 'annule'].includes(b.status) ? b.status : 'option';
  let vis = ['public', 'associations', 'private'].includes(b.visibility) ? b.visibility : 'associations';
  if (type === 'internal' && vis === 'public') vis = 'associations';
  let imageId = existing ? existing.image_id : null;
  if (b.image === null) imageId = null;
  else if (typeof b.image === 'string' && b.image.startsWith('data:')) imageId = await saveImage(b.image);
  else if (!existing && typeof b.image_id_copy === 'string' && await one('SELECT 1 FROM images WHERE id = $1', [b.image_id_copy])) imageId = b.image_id_copy;
  const coorgs = Array.isArray(b.coorgs) ? [...new Set(b.coorgs.map(Number).filter(Boolean))].slice(0, 20) : null;
  return {
    title, starts_at: starts, ends_at: ends, venue_id: venueId, category_id: catId, type, status, visibility: vis,
    description: str(b.description, 5000), image_id: imageId, link: safeUrl(b.link), price: str(b.price, 120), coorgs,
  };
}

async function snapshot(db, id) {
  const e = (await db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
  if (!e) return null;
  const orgs = (await db.query('SELECT association_id FROM event_orgs WHERE event_id = $1 ORDER BY association_id', [id])).rows.map((r) => r.association_id);
  return { ...e, orgs };
}

async function setOrgs(db, eventId, ownerId, coorgs) {
  const ids = new Set([ownerId, ...(coorgs || [])]);
  const valid = (await db.query(`SELECT id FROM associations WHERE status = 'approved' AND id = ANY($1::int[])`, [[...ids]])).rows.map((r) => r.id);
  await db.query('DELETE FROM event_orgs WHERE event_id = $1', [eventId]);
  for (const aid of new Set([ownerId, ...valid])) await db.query('INSERT INTO event_orgs (event_id, association_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventId, aid]);
}

app.post('/api/events', wrap(async (req, res) => {
  const u = requireMember(req);
  const v = await eventInput(req.body, u);
  const id = await tx(async (db) => {
    const e = (await db.query(
      `INSERT INTO events (association_id, title, starts_at, ends_at, venue_id, category_id, type, status, visibility, description, image_id, link, price, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [u.association_id, v.title, v.starts_at, v.ends_at, v.venue_id, v.category_id, v.type, v.status, v.visibility, v.description, v.image_id, v.link, v.price, u.id])).rows[0];
    await setOrgs(db, e.id, u.association_id, v.coorgs);
    await logHistory(db, { entity: 'event', entityId: e.id, action: 'création', user: u, after: await snapshot(db, e.id) });
    return e.id;
  });
  res.json({ id });
}));

app.put('/api/events/:id', wrap(async (req, res) => {
  const u = requireUser(req);
  const id = Number(req.params.id);
  if (!(await canEdit(u, id))) fail(403, 'Seules les associations organisatrices peuvent modifier cette date.');
  const existing = await one('SELECT * FROM events WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!existing) fail(404, 'Événement introuvable.');
  const v = await eventInput(req.body, u, existing);
  await tx(async (db) => {
    const before = await snapshot(db, id);
    await db.query(
      `UPDATE events SET title=$1, starts_at=$2, ends_at=$3, venue_id=$4, category_id=$5, type=$6, status=$7, visibility=$8, description=$9, image_id=$10, link=$11, price=$12, updated_at=now() WHERE id=$13`,
      [v.title, v.starts_at, v.ends_at, v.venue_id, v.category_id, v.type, v.status, v.visibility, v.description, v.image_id, v.link, v.price, id]);
    if (v.coorgs) await setOrgs(db, id, existing.association_id, v.coorgs);
    await logHistory(db, { entity: 'event', entityId: id, action: 'modification', user: u, before, after: await snapshot(db, id) });
  });
  res.json({ id });
}));

app.post('/api/events/:id/cancel', wrap(async (req, res) => {
  const u = requireUser(req);
  const id = Number(req.params.id);
  if (!(await canEdit(u, id))) fail(403, 'Action non autorisée.');
  await tx(async (db) => {
    const before = await snapshot(db, id);
    if (!before || before.deleted_at) fail(404, 'Événement introuvable.');
    await db.query(`UPDATE events SET status = 'annule', updated_at = now() WHERE id = $1`, [id]);
    await logHistory(db, { entity: 'event', entityId: id, action: 'annulation', user: u, before, after: await snapshot(db, id) });
  });
  res.json({ ok: true });
}));

// Report : la date d'origine est annulée, une nouvelle date « reportée du … » est créée
app.post('/api/events/:id/reschedule', wrap(async (req, res) => {
  const u = requireUser(req);
  const id = Number(req.params.id);
  if (!(await canEdit(u, id))) fail(403, 'Action non autorisée.');
  const starts = new Date(req.body.starts_at);
  const ends = req.body.ends_at ? new Date(req.body.ends_at) : null;
  if (Number.isNaN(starts.getTime())) fail(400, 'Indiquez la nouvelle date.');
  if (ends && (Number.isNaN(ends.getTime()) || ends < starts)) fail(400, 'L’heure de fin doit venir après le début.');
  const newId = await tx(async (db) => {
    const before = await snapshot(db, id);
    if (!before || before.deleted_at) fail(404, 'Événement introuvable.');
    const status = before.status === 'annule' ? 'en_cours' : before.status;
    const n = (await db.query(
      `INSERT INTO events (association_id, title, starts_at, ends_at, venue_id, category_id, type, status, visibility, description, image_id, link, price, rescheduled_from, created_by)
       SELECT association_id, title, $2, $3, venue_id, category_id, type, $4, visibility, description, image_id, link, price, id, $5 FROM events WHERE id = $1 RETURNING id`,
      [id, starts, ends, status, u.id])).rows[0];
    await db.query('INSERT INTO event_orgs (event_id, association_id) SELECT $2, association_id FROM event_orgs WHERE event_id = $1', [id, n.id]);
    await db.query(`UPDATE events SET status = 'annule', updated_at = now() WHERE id = $1`, [id]);
    await logHistory(db, { entity: 'event', entityId: id, action: 'report', user: u, before, after: await snapshot(db, id) });
    await logHistory(db, { entity: 'event', entityId: n.id, action: 'création (report)', user: u, after: await snapshot(db, n.id) });
    return n.id;
  });
  res.json({ id: newId });
}));

app.delete('/api/events/:id', wrap(async (req, res) => {
  const u = requireUser(req);
  const id = Number(req.params.id);
  if (!(await canEdit(u, id))) fail(403, 'Action non autorisée.');
  await tx(async (db) => {
    const before = await snapshot(db, id);
    if (!before || before.deleted_at) fail(404, 'Événement introuvable.');
    await db.query('UPDATE events SET deleted_at = now(), updated_at = now() WHERE id = $1', [id]);
    await logHistory(db, { entity: 'event', entityId: id, action: 'suppression', user: u, before, after: await snapshot(db, id) });
  });
  res.json({ ok: true });
}));

app.post('/api/events/:id/attendance', wrap(async (req, res) => {
  const u = requireMember(req);
  const e = await loadEvent(req.params.id, u);
  if (!e) fail(404, 'Événement introuvable.');
  const kind = req.body.kind;
  if (kind === 'going' || kind === 'interested') {
    await q(`INSERT INTO attendances (event_id, association_id, kind) VALUES ($1,$2,$3) ON CONFLICT (event_id, association_id) DO UPDATE SET kind = EXCLUDED.kind`, [e.id, u.association_id, kind]);
  } else {
    await q('DELETE FROM attendances WHERE event_id = $1 AND association_id = $2', [e.id, u.association_id]);
  }
  res.json({ ok: true });
}));

app.post('/api/events/:id/comments', wrap(async (req, res) => {
  const u = requireMember(req);
  const e = await loadEvent(req.params.id, u);
  if (!e) fail(404, 'Événement introuvable.');
  const body = str(req.body.body, 2000);
  if (!body) fail(400, 'Le commentaire est vide.');
  if (limited(`cm:${u.id}`, 60, 60 * 60e3)) fail(429, 'Trop de commentaires d’un coup.');
  const c = await one('INSERT INTO comments (event_id, user_id, author_name, association_id, body) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [e.id, u.id, u.name || u.email.split('@')[0], u.association_id, body]);
  res.json({ id: c.id });
}));

app.delete('/api/comments/:id', wrap(async (req, res) => {
  const u = requireUser(req);
  const c = await one('SELECT * FROM comments WHERE id = $1', [Number(req.params.id)]);
  if (!c) fail(404, 'Commentaire introuvable.');
  if (c.user_id !== u.id && !u.is_admin) fail(403, 'Vous ne pouvez supprimer que vos commentaires.');
  await q('UPDATE comments SET deleted_at = now() WHERE id = $1', [c.id]);
  res.json({ ok: true });
}));

// Revenir à une version précédente (historique)
app.post('/api/history/:id/revert', wrap(async (req, res) => {
  const u = requireUser(req);
  const h = await one('SELECT * FROM history WHERE id = $1', [Number(req.params.id)]);
  if (!h || !h.before) fail(404, 'Rien à restaurer pour cette entrée.');
  const b = typeof h.before === 'string' ? JSON.parse(h.before) : h.before;
  if (h.entity === 'event') {
    if (!(await canEdit(u, h.entity_id))) fail(403, 'Action non autorisée.');
    await tx(async (db) => {
      const cur = await snapshot(db, h.entity_id);
      await db.query(
        `UPDATE events SET title=$1, starts_at=$2, ends_at=$3, venue_id=$4, category_id=$5, type=$6, status=$7, visibility=$8, description=$9, image_id=$10, link=$11, price=$12, deleted_at=$13, updated_at=now() WHERE id=$14`,
        [b.title, b.starts_at, b.ends_at, b.venue_id, b.category_id, b.type, b.status, b.visibility, b.description, b.image_id, b.link, b.price, b.deleted_at, h.entity_id]);
      if (Array.isArray(b.orgs)) {
        await db.query('DELETE FROM event_orgs WHERE event_id = $1', [h.entity_id]);
        for (const aid of b.orgs) await db.query('INSERT INTO event_orgs (event_id, association_id) SELECT $1, id FROM associations WHERE id = $2 ON CONFLICT DO NOTHING', [h.entity_id, aid]);
      }
      await logHistory(db, { entity: 'event', entityId: h.entity_id, action: 'retour en arrière', user: u, before: cur, after: await snapshot(db, h.entity_id) });
    });
  } else if (h.entity === 'association') {
    if (u.association_id !== h.entity_id && !u.is_admin) fail(403, 'Action non autorisée.');
    const cur = await one('SELECT * FROM associations WHERE id = $1', [h.entity_id]);
    await q('UPDATE associations SET name=$1, slug=$2, color=$3, logo_id=$4, description=$5, contact_email=$6, phone=$7, website=$8, commune=$9, socials=$10 WHERE id=$11',
      [b.name, b.slug, b.color, b.logo_id, b.description, b.contact_email, b.phone, b.website, b.commune, JSON.stringify(b.socials || {}), h.entity_id]);
    await logHistory({ query: q }, { entity: 'association', entityId: h.entity_id, action: 'retour en arrière', user: u, before: cur, after: await one('SELECT * FROM associations WHERE id = $1', [h.entity_id]) });
  } else if (h.entity === 'venue') {
    requireAdmin(req);
    await q('UPDATE venues SET name=$1, address=$2, city=$3, citycode=$4, district=$5, lat=$6, lng=$7, archived=$8 WHERE id=$9',
      [b.name, b.address, b.city, b.citycode, b.district || '', b.lat, b.lng, b.archived, h.entity_id]);
  } else fail(400, 'Type non pris en charge.');
  res.json({ ok: true });
}));

// ---------- administration ----------
app.get('/api/admin/overview', wrap(async (req, res) => {
  requireAdmin(req);
  const pending = await all(`SELECT ${ASSO_FIELDS}, (SELECT json_agg(json_build_object('name', u.name, 'email', u.email)) FROM users u WHERE u.association_id = a.id) AS people
    FROM associations a WHERE a.status = 'pending' ORDER BY a.created_at`);
  const associations = await all(`SELECT ${ASSO_FIELDS}, (SELECT count(*)::int FROM users u WHERE u.association_id = a.id) AS member_count FROM associations a ORDER BY lower(a.name)`);
  const admins = await all('SELECT u.id, u.name, u.email, a.name AS asso_name FROM users u LEFT JOIN associations a ON a.id = u.association_id WHERE u.is_admin ORDER BY u.id');
  const history = await all(`SELECT h.id, h.entity, h.entity_id, h.action, h.user_name, h.association_name, h.created_at, (h.before IS NOT NULL) AS revertible,
      COALESCE(h.after->>'title', h.before->>'title', h.after->>'name', h.before->>'name') AS label
    FROM history h ORDER BY h.created_at DESC LIMIT 150`);
  res.json({ pending, associations, admins, history, env_admins: ADMIN_EMAILS });
}));

app.post('/api/admin/associations/:id/:decision', wrap(async (req, res) => {
  const u = requireAdmin(req);
  const id = Number(req.params.id);
  const decision = req.params.decision;
  if (!['approve', 'reject', 'pending'].includes(decision)) fail(400, 'Décision inconnue.');
  const status = { approve: 'approved', reject: 'rejected', pending: 'pending' }[decision];
  const before = await one('SELECT * FROM associations WHERE id = $1', [id]);
  if (!before) fail(404, 'Association introuvable.');
  const after = await one(`UPDATE associations SET status = $1, approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END WHERE id = $2 RETURNING *`, [status, id]);
  await logHistory({ query: q }, { entity: 'association', entityId: id, action: { approved: 'validation', rejected: 'refus', pending: 'remise en attente' }[status], user: u, before, after });
  if (status === 'approved' && before.status !== 'approved') {
    const people = await all('SELECT email FROM users WHERE association_id = $1', [id]);
    for (const p of people) await approvedMail(p.email, after.name, baseUrl(req));
  }
  res.json({ association: after });
}));

app.post('/api/admin/admins', wrap(async (req, res) => {
  requireAdmin(req);
  const email = normEmail(req.body.email);
  if (!isEmail(email)) fail(400, 'Adresse invalide.');
  const target = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (!target) fail(404, 'Cette personne doit d’abord avoir un compte Lanterne.');
  await q('UPDATE users SET is_admin = true WHERE id = $1', [target.id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/admins/:id', wrap(async (req, res) => {
  const u = requireAdmin(req);
  const id = Number(req.params.id);
  const target = await one('SELECT email FROM users WHERE id = $1', [id]);
  if (!target) fail(404, 'Compte introuvable.');
  if (ADMIN_EMAILS.includes(target.email)) fail(400, 'Cet administrateur est défini dans la configuration du serveur.');
  const count = await one('SELECT count(*)::int AS n FROM users WHERE is_admin');
  if (count.n <= 1) fail(400, 'Il faut garder au moins un administrateur.');
  await q('UPDATE users SET is_admin = false WHERE id = $1', [id]);
  if (id === u.id) { /* l'admin s'est retiré lui-même */ }
  res.json({ ok: true });
}));

app.delete('/api/admin/members/:id', wrap(async (req, res) => {
  requireAdmin(req);
  await q('UPDATE users SET association_id = NULL WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- sauvegardes ----------
const BACKUP_EMAILS = (process.env.BACKUP_EMAILS || process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const MAX_ATTACHMENT = 9 * 1024 * 1024; // marge sous la limite des pièces jointes

async function mailBackup(recipients, base) {
  let b = await buildBackup({ withImages: true });
  let withImages = true;
  if (b.zip.length > MAX_ATTACHMENT) { b = await buildBackup({ withImages: false }); withImages = false; }
  let ok = true;
  for (const to of recipients) ok = (await backupMail(to, { ...b, withImages }, `${base}/admin?onglet=sauvegardes`)).ok && ok;
  return { ok, size: b.zip.length, counts: b.counts, withImages };
}

app.get('/api/admin/backup', wrap(async (req, res) => {
  requireAdmin(req);
  const b = await buildBackup({ withImages: true });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${b.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(b.zip);
}));

app.get('/api/admin/backup/status', wrap(async (req, res) => {
  requireAdmin(req);
  res.json({ last: await getMeta('backup_last'), recipients: BACKUP_EMAILS.map((e) => e.replace(/(.).*@/, '$1…@')) });
}));

app.post('/api/admin/backup/mail', wrap(async (req, res) => {
  const u = requireAdmin(req);
  if (limited(`bk:${u.id}`, 3, 60 * 60e3)) fail(429, 'Trois sauvegardes par heure maximum.');
  const r = await mailBackup([u.email], baseUrl(req));
  if (!r.ok) fail(502, 'Le mail de sauvegarde n’a pas pu partir. Téléchargez-la plutôt.');
  res.json({ ok: true, email: u.email });
}));

// Chaque nuit vers 3 h (heure de Paris), une sauvegarde part par mail
const parisNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
async function nightlyBackup() {
  if (!BACKUP_EMAILS.length) return;
  const { day, hour } = parisNow();
  if (hour < 3) return;
  const last = JSON.parse((await getMeta('backup_last')) || '{}');
  if (last.day === day) return;
  const base = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`);
  try {
    const r = await mailBackup(BACKUP_EMAILS, base);
    await setMeta('backup_last', JSON.stringify({ day, at: new Date().toISOString(), ok: r.ok, size: r.size, counts: r.counts, withImages: r.withImages }));
    console.log(`[sauvegarde] ${r.ok ? 'envoyée' : 'ÉCHEC d’envoi'} (${Math.round(r.size / 1024)} Ko)`);
  } catch (err) {
    await setMeta('backup_last', JSON.stringify({ day, at: new Date().toISOString(), ok: false, error: err.message }));
    console.error('[sauvegarde] échec', err);
  }
}
setInterval(() => nightlyBackup().catch((e) => console.error('[sauvegarde]', e)), 10 * 60e3).unref();
setTimeout(() => nightlyBackup().catch((e) => console.error('[sauvegarde]', e)), 60e3).unref();

// ---------- agendas .ics ----------
async function feedEvents(user, query) {
  const params = [];
  const where = ['e.deleted_at IS NULL', `a.status = 'approved'`, visibility(user, params), `e.starts_at > now() - interval '90 days'`];
  if (query.asso) { params.push(String(query.asso)); where.push(`EXISTS (SELECT 1 FROM event_orgs y JOIN associations ya ON ya.id = y.association_id WHERE y.event_id = e.id AND ya.slug = $${params.length})`); }
  if (query.cat) { params.push(Number(query.cat)); where.push(`e.category_id = $${params.length}`); }
  if (query.mine === '1' && memberAssoId(user)) {
    params.push(memberAssoId(user));
    where.push(`(EXISTS (SELECT 1 FROM event_orgs z WHERE z.event_id = e.id AND z.association_id = $${params.length}) OR EXISTS (SELECT 1 FROM attendances t WHERE t.event_id = e.id AND t.association_id = $${params.length}))`);
  }
  const rows = await all(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT 3000`, params);
  return rows.map((e) => ({ ...e, orgs: (typeof e.orgs === 'string' ? JSON.parse(e.orgs) : e.orgs).map((o) => o.name).join(', ') }));
}

function sendIcs(res, body, filename) {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(body);
}

app.get('/ics/public.ics', wrap(async (req, res) => {
  const events = await feedEvents(null, req.query);
  sendIcs(res, buildCalendar(events, { name: 'Lanterne · Sainté', baseUrl: baseUrl(req) }), 'lanterne.ics');
}));

app.get('/ics/u/:token.ics', wrap(async (req, res) => {
  const u = await one(`SELECT u.*, a.status AS asso_status, a.name AS asso_name FROM users u LEFT JOIN associations a ON a.id = u.association_id WHERE u.ics_token = $1`, [req.params.token]);
  if (!u) return res.status(404).send('Lien d’abonnement inconnu.');
  const events = await feedEvents(u, req.query);
  sendIcs(res, buildCalendar(events, { name: req.query.mine === '1' && u.asso_name ? `Lanterne · ${u.asso_name}` : 'Lanterne', baseUrl: baseUrl(req) }), 'lanterne.ics');
}));

app.get('/ics/event/:id.ics', wrap(async (req, res) => {
  const e = await loadEvent(req.params.id, req.user);
  if (!e) return res.status(404).send('Événement introuvable.');
  const orgs = (typeof e.orgs === 'string' ? JSON.parse(e.orgs) : e.orgs).map((o) => o.name).join(', ');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lanterne-${e.id}.ics"`);
  res.send(buildCalendar([{ ...e, orgs }], { name: e.title, baseUrl: baseUrl(req) }));
}));

// ---------- fichiers statiques ----------
const nm = (p) => path.join(root, 'node_modules', p);
app.use('/vendor/maplibre', express.static(nm('maplibre-gl/dist'), { maxAge: '30d' }));
app.use('/vendor/fonts/orbitron', express.static(nm('@fontsource/orbitron/files'), { maxAge: '365d' }));
app.use('/vendor/fonts/work-sans', express.static(nm('@fontsource/work-sans/files'), { maxAge: '365d' }));
app.use('/vendor/fonts/plex-mono', express.static(nm('@fontsource/ibm-plex-mono/files'), { maxAge: '365d' }));
// Le service worker porte le numéro de version : chaque déploiement vide les anciens caches
const swSource = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8').replace("'lanterne-v3'", `'lanterne-${VERSION}'`);
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(swSource);
});
app.use(express.static(path.join(root, 'public'), {
  index: false,
  setHeaders(res, p) {
    // Code et styles toujours revalidés : les mises à jour arrivent tout de suite
    if (/\.(js|css|html|webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));

// Application monopage, avec balises de partage pour les événements publics
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

app.get('*', wrap(async (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Introuvable.' });
  let html = indexHtml;
  const m = /^\/evenement\/(\d+)/.exec(req.path);
  if (m) {
    const e = await loadEvent(m[1], null);
    if (e) {
      const when = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(e.starts_at));
      const desc = `${when} · ${e.venue_name || ''}${e.venue_city ? `, ${e.venue_city}` : ''} — ${e.asso_name}`;
      const base = baseUrl(req);
      const meta = [
        `<meta property="og:title" content="${escAttr(e.title)}">`,
        `<meta property="og:description" content="${escAttr(desc)}">`,
        `<meta property="og:url" content="${escAttr(`${base}/evenement/${e.id}`)}">`,
        `<meta property="og:image" content="${escAttr(e.image_id ? `${base}/img/${e.image_id}` : `${base}/icons/og.png`)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
      ].join('\n');
      html = html.replace('<!--og-->', meta).replace(/<title>[^<]*<\/title>/, `<title>${escAttr(e.title)} · Lanterne</title>`);
    }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(html);
}));

// ---------- erreurs ----------
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  const message = status === 413 ? 'Fichier trop lourd.' : status >= 500 ? 'Erreur du serveur. Réessayez.' : err.message;
  res.status(status).json({ error: message, ...(err.code && status < 500 ? { code: err.code } : {}) });
});

// Nettoyage périodique des jetons expirés
setInterval(() => {
  q(`DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'`).catch(() => {});
  q(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {});
}, 6 * 3600e3).unref();

// Une promesse oubliée ne doit pas faire tomber le serveur : on la note dans le journal
process.on('unhandledRejection', (err) => console.error('[lanterne] erreur non gérée :', err));

await initDb();
const server = app.listen(PORT, () => {
  console.log(`[lanterne] prêt sur http://localhost:${PORT} · version ${VERSION}`);
  console.log(`[mail] ${describeMailSetup()}`);
  console.log(`[lanterne] adresse publique des liens : ${process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'adresse de la requête')}`);
});

// Arrêt propre (redéploiement Railway, Ctrl-C) : on termine les requêtes puis on ferme la base
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    console.log(`[lanterne] arrêt (${sig})`);
    let done = false;
    const finish = async () => { if (done) return; done = true; try { await closeDb(); } finally { process.exit(0); } };
    server.close(finish);
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); finish(); }, 3000).unref();
  });
}
