// Test de bout en bout de l'API, sur un serveur local lancé SANS service d'envoi de mails
// (les liens de connexion sont alors lus dans le journal du serveur).
// Usage : BASE=http://localhost:3311 LOG=chemin/du/journal node scripts/smoke-test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3311';
const LOG = process.env.LOG;
const H = { 'X-Requested-With': 'lanterne', 'Content-Type': 'application/json' };
let passed = 0;
const ok = (msg) => { passed++; console.log('  ✓', msg); };

class Client {
  constructor() { this.cookie = ''; }
  async req(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(BASE + path, { method, headers: { ...H, Cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    if (raw) return res;
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
}
const lastLink = (email, kind) => {
  const log = fs.readFileSync(LOG, 'utf8');
  const blocks = log.split('[mail]').filter((b) => b.includes(`À : ${email}`));
  const m = blocks.length && blocks[blocks.length - 1].match(new RegExp(`${BASE.replace(/[/:.]/g, '\\$&')}/auth/${kind}\\?token=[\\w-]+`));
  assert.ok(m, `lien ${kind} pour ${email}`);
  return m[0].replace(BASE, '');
};
async function login(email) {
  const c = new Client();
  const r = await c.req('/api/auth/request', { method: 'POST', body: { email } });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 100));
  const link = lastLink(email, 'verify');
  // Ouvrir le lien (comme un antivirus de messagerie) ne doit pas le consommer
  assert.equal((await fetch(BASE + link)).status, 200);
  const r2 = await c.req('/api/auth/verify', { method: 'POST', body: { token: new URL(BASE + link).searchParams.get('token') } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  return c;
}

console.log('Lanterne — test de bout en bout');
const anon = new Client();

// CSRF
assert.equal((await fetch(BASE + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"x@y.fr"}' })).status, 403);
ok('écriture sans en-tête maison refusée (CSRF)');

// Config et catégories de départ
const cfg = (await anon.req('/api/config')).data;
assert.equal(cfg.categories.length, 11); assert.equal(cfg.palette.length, 12);
ok('11 catégories de départ et palette de 12 couleurs');

// Inscription de deux associations
const regA = new Client();
let r = await regA.req('/api/register', { method: 'POST', body: { association: { name: 'Les Amis du Fil', color: '#E040A0', contact_email: 'contact@amis.test', commune: 'Saint-Étienne' }, person: { name: 'Alice Martin', email: 'alice@amis.test' } } });
assert.equal(r.status, 200, JSON.stringify(r.data));
r = await new Client().req('/api/register', { method: 'POST', body: { association: { name: 'Quartier Libre', color: '#00967F' }, person: { name: 'Bruno', email: 'bruno@ql.test' } } });
assert.equal(r.status, 200);
r = await new Client().req('/api/register', { method: 'POST', body: { association: { name: 'les amis du fil' }, person: { name: 'X', email: 'x@x.test' } } });
assert.equal(r.status, 409);
ok('inscription de 2 associations, doublon refusé');

// Avant validation : pas de publication
const alice = await login('alice@amis.test');
let me = (await alice.req('/api/me')).data.user;
assert.equal(me.association.status, 'pending');
r = await alice.req('/api/events', { method: 'POST', body: { title: 'x' } });
assert.equal(r.status, 403);
ok('connexion par lien magique ; association en attente ne publie pas');

// Lien déjà utilisé
const used = new URL(BASE + lastLink('alice@amis.test', 'verify')).searchParams.get('token');
assert.equal((await anon.req('/api/auth/verify', { method: 'POST', body: { token: used } })).status, 410);
ok('un lien de connexion ne sert qu’une fois');

// Validation par l'administrateur
const admin = await login('admin@lanterne.test');
const ov = (await admin.req('/api/admin/overview')).data;
assert.equal(ov.pending.length, 2);
for (const a of ov.pending) assert.equal((await admin.req(`/api/admin/associations/${a.id}/approve`, { method: 'POST', body: {} })).status, 200);
assert.equal((await alice.req('/api/admin/overview')).status, 403);
ok('l’administrateur valide ; un membre n’accède pas à l’administration');

const bruno = await login('bruno@ql.test');
const assos = (await anon.req('/api/associations')).data.associations;
const A = assos.find((a) => a.name === 'Les Amis du Fil'); const B = assos.find((a) => a.name === 'Quartier Libre');

// Lieu partagé
r = await alice.req('/api/venues', { method: 'POST', body: { name: 'Le Fil', address: '20 Boulevard Thiers 42000 Saint-Étienne', city: 'Saint-Étienne', citycode: '42218', district: 'Châteaucreux', lat: 45.4446, lng: 4.4007 } });
const venue = r.data.venue; assert.ok(venue.id);
r = await bruno.req('/api/venues', { method: 'POST', body: { name: 'le fil', city: 'Saint-Étienne' } });
assert.equal(r.data.venue.id, venue.id);
ok('lieu partagé créé, pas de doublon');

const cat = cfg.categories.find((c) => c.name === 'Concert');
const ag = cfg.categories.find((c) => c.name === 'Assemblée générale');
const d = (days, h = 20) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const mk = (c, body) => c.req('/api/events', { method: 'POST', body: { venue_id: venue.id, category_id: cat.id, ...body } });

// Champs obligatoires
assert.equal((await mk(alice, { title: '', starts_at: d(5) })).status, 400);
assert.equal((await alice.req('/api/events', { method: 'POST', body: { title: 'Sans lieu', starts_at: d(5), category_id: cat.id } })).status, 400);
ok('titre, date, lieu et catégorie obligatoires');

const pubValide = (await mk(alice, { title: 'Concert public validé', starts_at: d(10), status: 'valide', visibility: 'public', coorgs: [B.id] })).data.id;
const pubOption = (await mk(alice, { title: 'Concert en option', starts_at: d(10, 21), status: 'option', visibility: 'public' })).data.id;
const assoOnly = (await mk(alice, { title: 'Réunion inter-assos', starts_at: d(11), type: 'inter', status: 'en_cours', visibility: 'associations' })).data.id;
const priv = (await mk(alice, { title: 'Réunion interne privée', starts_at: d(12), type: 'internal', status: 'valide', visibility: 'private' })).data.id;
const internalPub = (await mk(alice, { title: 'Interne marquée publique', starts_at: d(13), type: 'internal', status: 'valide', visibility: 'public' })).data.id;
const agB = (await mk(bruno, { title: 'AG Quartier Libre', starts_at: d(14, 18), type: 'ag', category_id: ag.id, status: 'valide', visibility: 'public' })).data.id;
ok('6 dates créées (statuts, types, visibilités variés)');

// Visibilité
const ids = async (c) => (await c.req(`/api/events?from=${encodeURIComponent(d(-1))}`)).data.events.map((e) => e.id);
const vAnon = await ids(anon); const vAlice = await ids(alice); const vBruno = await ids(bruno);
assert.deepEqual(vAnon.sort(), [pubValide, agB].sort());
assert.ok(vAlice.includes(priv) && vAlice.includes(assoOnly) && vAlice.includes(pubOption) && vAlice.includes(internalPub));
assert.ok(!vBruno.includes(priv) && vBruno.includes(assoOnly) && vBruno.includes(internalPub));
assert.equal((await anon.req(`/api/events/${pubOption}`)).status, 404);
assert.equal((await bruno.req(`/api/events/${priv}`)).status, 404);
ok('public : seulement « Public » hors option et hors interne ; « Associations » pour les inscrits ; « Privé » pour la seule asso');

// Co-organisation : Bruno peut modifier le concert, pas la réunion privée
let ev = (await bruno.req(`/api/events/${pubValide}`)).data;
assert.equal(ev.can_edit, true);
r = await bruno.req(`/api/events/${pubValide}`, { method: 'PUT', body: { ...ev.event, title: 'Concert public (modifié par co-orga)', coorgs: [B.id] } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal((await bruno.req(`/api/events/${assoOnly}`, { method: 'PUT', body: { title: 'pirate' } })).status, 403);
ok('co-organisation : l’autre asso modifie la date commune, pas les autres');

// On y va, commentaires
assert.equal((await bruno.req(`/api/events/${assoOnly}/attendance`, { method: 'POST', body: { kind: 'going' } })).status, 200);
assert.equal((await bruno.req(`/api/events/${assoOnly}/comments`, { method: 'POST', body: { body: 'On peut décaler d’une semaine ?' } })).status, 200);
ev = (await alice.req(`/api/events/${assoOnly}`)).data;
assert.equal(ev.event.attendances.length, 1); assert.equal(ev.comments.length, 1);
assert.equal((await anon.req(`/api/events/${pubValide}/comments`, { method: 'POST', body: { body: 'spam' } })).status, 401);
ok('« on y va » et commentaires entre associations ; refusés aux visiteurs');

// Annulation, report, historique, retour en arrière
assert.equal((await alice.req(`/api/events/${pubValide}/cancel`, { method: 'POST', body: {} })).status, 200);
ev = (await anon.req(`/api/events/${pubValide}`)).data.event;
assert.equal(ev.status, 'annule');
ok('date annulée : reste visible, statut annulé');
r = await alice.req(`/api/events/${agB}/reschedule`, { method: 'POST', body: { starts_at: d(20, 18) } });
assert.equal(r.status, 403);
r = await bruno.req(`/api/events/${agB}/reschedule`, { method: 'POST', body: { starts_at: d(20, 18) } });
const newAg = r.data.id;
ev = (await anon.req(`/api/events/${newAg}`)).data.event;
assert.equal(ev.rescheduled_from, agB); assert.ok(ev.rescheduled_from_date);
assert.equal((await anon.req(`/api/events/${agB}`)).data.event.status, 'annule');
ok('report : ancienne date annulée, nouvelle date « reporté du … »');
const hist = (await alice.req(`/api/events/${pubValide}`)).data.history;
const cancelEntry = hist.find((h) => h.action === 'annulation');
assert.equal((await alice.req(`/api/history/${cancelEntry.id}/revert`, { method: 'POST', body: {} })).status, 200);
assert.equal((await anon.req(`/api/events/${pubValide}`)).data.event.status, 'valide');
ok('historique : retour en arrière sur l’annulation');

// Suppression puis restauration par un admin
assert.equal((await alice.req(`/api/events/${assoOnly}`, { method: 'DELETE' })).status, 200);
assert.equal((await alice.req(`/api/events/${assoOnly}`)).status, 404);
const h2 = (await admin.req('/api/admin/overview')).data.history.find((h) => h.entity === 'event' && h.entity_id === assoOnly && h.action === 'suppression');
assert.equal((await admin.req(`/api/history/${h2.id}/revert`, { method: 'POST', body: {} })).status, 200);
assert.equal((await alice.req(`/api/events/${assoOnly}`)).status, 200);
ok('suppression réversible par un administrateur');

// Agendas .ics
let ics = await (await fetch(`${BASE}/ics/public.ics`)).text();
assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /Concert public/); assert.doesNotMatch(ics, /option|privée|inter-assos/i);
me = (await alice.req('/api/me')).data.user;
ics = await (await fetch(`${BASE}/ics/u/${me.ics_token}.ics`)).text();
assert.match(ics, /Réunion interne privée/);
ics = await (await fetch(`${BASE}/ics/u/${me.ics_token}.ics?asso=quartier-libre`)).text();
assert.match(ics, /AG Quartier Libre/); assert.doesNotMatch(ics, /Réunion interne privée/);
ics = await (await fetch(`${BASE}/ics/public.ics?cat=${ag.id}`)).text();
assert.match(ics, /AG Quartier Libre/); assert.doesNotMatch(ics, /Concert/);
assert.equal((await fetch(`${BASE}/ics/u/inconnu.ics`)).status, 404);
ok('liens d’abonnement : public, personnel, filtrés par association et par catégorie');

// Invitation d'un membre
r = await alice.req(`/api/associations/${A.id}/invitations`, { method: 'POST', body: { emails: 'carla@amis.test, bruno@ql.test, pasunmail' } });
assert.deepEqual(r.data.sent, ['carla@amis.test']); assert.equal(r.data.skipped.length, 2);
const carla = new Client();
const invToken = new URL(BASE + lastLink('carla@amis.test', 'invite')).searchParams.get('token');
assert.equal((await anon.req(`/api/auth/invite-info?token=${invToken}`)).data.association.name, 'Les Amis du Fil');
const res = await carla.req('/api/auth/invite', { method: 'POST', body: { token: invToken } });
assert.match(res.data.redirect, /bienvenue/);
me = (await carla.req('/api/me')).data.user;
assert.equal(me.association.id, A.id);
ok('invitation par mail : la personne rejoint l’association');

// Partage : balises de prévisualisation
const page = await (await fetch(`${BASE}/evenement/${pubValide}`)).text();
assert.match(page, /og:title" content="Concert public/);
const page2 = await (await fetch(`${BASE}/evenement/${priv}`)).text();
assert.doesNotMatch(page2, /og:title/);
ok('lien de partage avec aperçu pour les dates publiques seulement');

// Suppression du compte
assert.equal((await carla.req('/api/me', { method: 'DELETE' })).status, 200);
assert.equal((await carla.req('/api/me')).data.user, null);
ok('suppression du compte par l’utilisateur');

// Robustesse et sécurité
assert.equal((await anon.req('/api/events?limit=-5')).status, 200);
assert.equal((await anon.req('/api/events?from=nimporte')).status, 400);
assert.equal((await anon.req('/api/events/abc')).status, 404);
const before = fs.readFileSync(LOG, 'utf8').length;
assert.equal((await anon.req('/api/auth/request', { method: 'POST', body: { email: 'inconnu@nulle-part.test' } })).status, 200);
await new Promise((r) => setTimeout(r, 100));
assert.doesNotMatch(fs.readFileSync(LOG, 'utf8').slice(before), /inconnu@nulle-part/);
const h = (await fetch(BASE + '/')).headers;
assert.match(h.get('content-security-policy') || '', /default-src 'self'/);
ok('paramètres invalides refusés proprement, aucun mail aux adresses inconnues, politique de sécurité active');

// Fichiers statiques
for (const p of ['/', '/styles.css', '/app.js', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/vendor/maplibre/maplibre-gl.mjs', '/vendor/fonts/orbitron/orbitron-latin-500-normal.woff2', '/liste', '/mentions-legales']) {
  assert.equal((await fetch(BASE + p)).status, 200, p);
}
ok('pages, styles, polices, carte et icônes servis');

// ---------- Comptes avec mot de passe (sans passer par un mail) ----------
const mailsBefore = fs.readFileSync(LOG, 'utf8').split('[mail]').length;
const dan = new Client();
assert.equal((await dan.req('/api/auth/signup', { method: 'POST', body: { name: 'Dan', email: 'dan@pw.test', password: 'court' } })).status, 400);
assert.equal((await dan.req('/api/auth/signup', { method: 'POST', body: { name: 'Dan', email: 'dan@pw.test', password: 'dan@pw.test' } })).status, 400);
r = await dan.req('/api/auth/signup', { method: 'POST', body: { name: 'Dan', email: 'Dan@PW.test', password: 'une phrase de passe' } });
assert.equal(r.status, 200, JSON.stringify(r.data));
me = (await dan.req('/api/me')).data.user;
assert.equal(me.email, 'dan@pw.test'); assert.equal(me.has_password, true); assert.equal(me.association, null); assert.equal(me.is_admin, false);
assert.equal((await new Client().req('/api/auth/signup', { method: 'POST', body: { name: 'X', email: 'dan@pw.test', password: 'autre phrase longue' } })).status, 409);
assert.equal((await new Client().req('/api/auth/signup', { method: 'POST', body: { name: 'X', email: 'alice@amis.test', password: 'je vole un compte' } })).status, 409);
assert.equal(fs.readFileSync(LOG, 'utf8').split('[mail]').length, mailsBefore);
ok('création de compte avec mot de passe : connecté tout de suite, sans mail ; adresse déjà prise refusée');

const bad = await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'dan@pw.test', password: 'mauvaise phrase' } });
const unknown = await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'personne@pw.test', password: 'une phrase de passe' } });
const noPw = await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'alice@amis.test', password: 'une phrase de passe' } });
assert.equal(bad.status, 401); assert.equal(unknown.status, 401); assert.equal(noPw.status, 401);
assert.equal(bad.data.error, unknown.data.error); assert.equal(bad.data.error, noPw.data.error);
const dan2 = new Client();
assert.equal((await dan2.req('/api/auth/login', { method: 'POST', body: { email: 'DAN@pw.test ', password: 'une phrase de passe' } })).status, 200);
assert.equal((await dan2.req('/api/me')).data.user.email, 'dan@pw.test');
ok('connexion par mot de passe ; même réponse pour un mauvais mot de passe, une adresse inconnue ou un compte sans mot de passe');

// Changer son mot de passe déconnecte les autres appareils
assert.equal((await dan.req('/api/me/password', { method: 'PUT', body: { password: 'nouvelle phrase de passe' } })).status, 200);
assert.equal((await dan.req('/api/me')).data.user.email, 'dan@pw.test');
assert.equal((await dan2.req('/api/me')).data.user, null);
assert.equal((await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'dan@pw.test', password: 'une phrase de passe' } })).status, 401);
assert.equal((await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'dan@pw.test', password: 'nouvelle phrase de passe' } })).status, 200);
ok('changer son mot de passe : l’ancien ne marche plus, les autres appareils sont déconnectés');

// Un compte « lien par mail » peut ajouter un mot de passe
assert.equal((await alice.req('/api/me/password', { method: 'PUT', body: { password: 'alice a une phrase' } })).status, 200);
assert.equal((await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'alice@amis.test', password: 'alice a une phrase' } })).status, 200);
ok('un membre existant ajoute un mot de passe depuis « Mon compte »');

// Une adresse d'administrateur ne se crée jamais par mot de passe sans le code secret
// (« npm test » déclare fondateur@lanterne.test comme administrateur et règle ADMIN_SETUP_CODE)
if (process.env.ADMIN_SETUP_CODE) {
  const founder = (body) => new Client().req('/api/auth/signup', { method: 'POST', body: { name: 'Fondateur', email: 'fondateur@lanterne.test', password: 'je deviens admin', ...body } });
  r = await founder({});
  assert.equal(r.status, 403); assert.equal(r.data.code, 'admin_code');
  assert.equal((await founder({ admin_code: 'au hasard pour voir' })).status, 403);
  const f = new Client();
  r = await f.req('/api/auth/signup', { method: 'POST', body: { name: 'Fondateur', email: 'fondateur@lanterne.test', password: 'je deviens admin', admin_code: process.env.ADMIN_SETUP_CODE } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await f.req('/api/me')).data.user.is_admin, true);
  assert.equal((await f.req('/api/admin/overview')).status, 200);
  ok('une adresse d’administrateur ne se crée par mot de passe qu’avec le code secret');
}

// Quelqu'un crée un compte avec l'adresse d'un autre : quand le vrai propriétaire ouvre un lien reçu par mail,
// le mot de passe de l'usurpateur est effacé et ses sessions fermées
const thief = new Client();
assert.equal((await thief.req('/api/auth/signup', { method: 'POST', body: { name: 'Usurpateur', email: 'eve@vrai.test', password: 'pas mon adresse' } })).status, 200);
const eve = await login('eve@vrai.test');
assert.equal((await thief.req('/api/me')).data.user, null);
assert.equal((await new Client().req('/api/auth/login', { method: 'POST', body: { email: 'eve@vrai.test', password: 'pas mon adresse' } })).status, 401);
me = (await eve.req('/api/me')).data.user;
assert.equal(me.has_password, false);
ok('adresse confirmée par mail : le mot de passe posé avant par quelqu’un d’autre est effacé, ses sessions fermées');

// Inscription d'une association avec mot de passe : connecté tout de suite, aucun lien de connexion envoyé
const fred = new Client();
const mailsBefore2 = fs.readFileSync(LOG, 'utf8').split('[mail]').filter((b) => b.includes('À : fred@asso.test')).length;
r = await fred.req('/api/register', { method: 'POST', body: { association: { name: 'Les Jardins Partagés', color: '#2F9533' }, person: { name: 'Fred', email: 'fred@asso.test', password: 'des tomates partout' } } });
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.logged_in, true);
me = (await fred.req('/api/me')).data.user;
assert.equal(me.association.status, 'pending'); assert.equal(me.has_password, true);
await new Promise((res) => setTimeout(res, 100));
assert.equal(fs.readFileSync(LOG, 'utf8').split('[mail]').filter((b) => b.includes('À : fred@asso.test')).length, mailsBefore2);
r = await new Client().req('/api/register', { method: 'POST', body: { association: { name: 'Autre asso' }, person: { name: 'X', email: 'dan@pw.test', password: 'je prends le compte' } } });
assert.equal(r.status, 409);
ok('inscription d’une association avec mot de passe : connecté tout de suite, en attente de validation ; compte existant protégé');

// ---------- Entités : chacun dit ce qu'il est (association, bar, lieu…) ----------
const kinds = cfg.kinds.map((k) => k.id);
assert.deepEqual(kinds, ['association', 'collectif', 'lieu', 'bar', 'entreprise', 'institution', 'autre']);
const gus = new Client();
r = await gus.req('/api/register', { method: 'POST', body: { association: { kind: 'bar', name: 'Le Bar du Coin', color: '#B57600' }, person: { name: 'Gus', email: 'gus@bar.test', password: 'une bière svp merci' } } });
assert.equal(r.status, 200, JSON.stringify(r.data));
r = await new Client().req('/api/register', { method: 'POST', body: { association: { kind: 'n’importe quoi', name: 'Type inconnu' }, person: { name: 'H', email: 'h@inconnu.test', password: 'type inconnu ok' } } });
assert.equal(r.status, 200);
let ov2 = (await admin.req('/api/admin/overview')).data;
const bar = ov2.pending.find((a) => a.name === 'Le Bar du Coin');
assert.equal(bar.kind, 'bar');
assert.equal(ov2.pending.find((a) => a.name === 'Type inconnu').kind, 'association');
assert.equal((await admin.req(`/api/admin/associations/${bar.id}/approve`, { method: 'POST', body: {} })).status, 200);
assert.equal((await anon.req('/api/associations')).data.associations.find((a) => a.id === bar.id).kind, 'bar');
// Le type se change depuis le profil
r = await gus.req(`/api/associations/${bar.id}`, { method: 'PUT', body: { name: 'Le Bar du Coin', kind: 'lieu', contact_email: 'gus@bar.test' } });
assert.equal(r.data.association.kind, 'lieu');
r = await gus.req(`/api/associations/${bar.id}`, { method: 'PUT', body: { name: 'Le Bar du Coin', kind: 'pirate', contact_email: 'gus@bar.test' } });
assert.equal(r.data.association.kind, 'lieu');
assert.equal((await gus.req('/api/me')).data.user.association.kind, 'lieu');
// Le type suit les dates (pour le filtre « Type d'entité »)
const barEvent = (await gus.req('/api/events', { method: 'POST', body: { title: 'Blind test', starts_at: d(15, 21), venue_id: venue.id, category_id: cat.id, visibility: 'public', status: 'valide' } })).data.id;
ev = (await anon.req(`/api/events/${barEvent}`)).data.event;
assert.equal(ev.asso_kind, 'lieu'); assert.equal(ev.orgs[0].kind, 'lieu');
// L'invitation rend aussi le lien, à envoyer soi-même si le mail n'arrive pas
r = await gus.req(`/api/associations/${bar.id}/invitations`, { method: 'POST', body: { emails: 'serveur@bar.test' } });
assert.equal(r.data.links.length, 1);
assert.match(r.data.links[0].url, /\/auth\/invite\?token=[\w-]{20,}$/);
assert.equal((await anon.req(`/api/auth/invite-info?token=${new URL(r.data.links[0].url).searchParams.get('token')}`)).data.association.name, 'Le Bar du Coin');
for (const p of ['/entites', '/entites/le-bar-du-coin', '/associations', '/inscription?type=bar', '/mode-d-emploi']) assert.equal((await fetch(BASE + p)).status, 200, p);
ok('entités : type choisi à l’inscription (bar, lieu…), modifiable, visible partout ; lien d’invitation à copier');

// ---------- Carte et événements du territoire (« npm test » fournit de faux services d'adresse et data.gouv) ----------
if (process.env.FAKE_SERVICES) {
  // Une adresse tapée sans choisir de suggestion est placée sur la carte par le serveur
  r = await alice.req('/api/venues', { method: 'POST', body: { name: 'Salle des fêtes de Montreynaud', address: '3 rue Pierre Loti 42000 Saint-Étienne' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.venue.lat > 45 && r.data.venue.lng > 4, 'lieu placé automatiquement');
  assert.equal(r.data.venue.citycode, '42218');
  const lost = (await alice.req('/api/venues', { method: 'POST', body: { name: 'Hangar perdu', address: 'adresse introuvable 99' } })).data.venue;
  assert.equal(lost.lat, null);
  // Un administrateur corrige l'adresse à la main : la nouvelle position est retrouvée
  r = await admin.req(`/api/venues/${lost.id}`, { method: 'PUT', body: { address: '12 rue de la Paix 42000 Saint-Étienne' } });
  assert.ok(r.data.venue.lat > 45, 'nouvelle adresse placée');
  r = await admin.req('/api/admin/venues/place', { method: 'POST', body: {} });
  assert.equal(r.status, 200); assert.ok(Array.isArray(r.data.placed));
  assert.equal((await alice.req('/api/admin/venues/place', { method: 'POST', body: {} })).status, 403);
  // La carte lit ses images par des adresses « blob: » : la politique de sécurité doit l'autoriser
  assert.match((await fetch(`${BASE}/carte`)).headers.get('content-security-policy'), /connect-src 'self' blob:/);
  ok('carte : une adresse tapée à la main est placée automatiquement, et une adresse corrigée aussi');

  const t = await anon.req('/api/tourisme');
  assert.equal(t.status, 200);
  assert.equal(t.data.source.name, 'DATAtourisme');
  assert.deepEqual(t.data.events.map((e) => e.title).sort(), ['Fête du Livre', 'Marché de Carnot']);
  const fete = t.data.events.find((e) => e.title === 'Fête du Livre');
  assert.equal(fete.ongoing, false); assert.equal(fete.city, 'Saint-Étienne'); assert.equal(fete.website, 'https://fete-du-livre.test/');
  assert.deepEqual(fete.kinds, ['Festival']);
  assert.equal(t.data.events.find((e) => e.title === 'Marché de Carnot').ongoing, true);
  assert.equal((await fetch(`${BASE}/territoire?jour=2026-12-01`)).status, 200);
  ok('événements du territoire : les dates passées sont écartées, les marchés mis à part, la source citée');
}

// État de santé (interrogé par Railway avant de basculer sur une nouvelle version)
const health = await fetch(`${BASE}/health`);
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);
assert.equal(health.headers.get('cache-control'), 'no-store');
ok('adresse de santé : le serveur et la base répondent');

// Plafond d'appels par minute — seulement quand « npm test » l'a abaissé (variable RATE), en dernier
// car l'adresse de test reste ensuite bloquée jusqu'à la fin de la minute.
if (process.env.RATE) {
  const max = Number(process.env.RATE);
  let blocked = null;
  for (let i = 0; i <= max && !blocked; i++) {
    const res = await fetch(`${BASE}/api/version`);
    if (res.status === 429) blocked = res; else await res.arrayBuffer();
  }
  assert.ok(blocked, `aucun refus après ${max} appels`);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.match((await blocked.json()).error, /Trop de requêtes/);
  assert.equal((await fetch(`${BASE}/ics/public.ics`)).status, 429);
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
  assert.equal((await fetch(`${BASE}/liste`)).status, 200);
  ok('plafond d’appels par minute : l’API et les agendas refusent poliment, les pages restent servies');
}

console.log(`\n${passed} vérifications réussies.`);
