// Événements du territoire : ceux que publient l'Office de tourisme de Saint-Étienne et les autres offices
// de tourisme des environs, via DATAtourisme (plateforme nationale, en open data sur data.gouv.fr).
//
// Source : le fichier « datatourisme-fma.csv » (fêtes et manifestations), mis à jour chaque jour,
// interrogé avec l'API tabulaire de data.gouv.fr : on ne demande que le carré autour de Saint-Étienne,
// sans télécharger tout le fichier. Licence Ouverte : on cite la source.
//
// Le résultat est gardé en mémoire 6 heures, et une copie est rangée dans la base : si data.gouv.fr
// ne répond pas, on montre la dernière liste connue plutôt qu'une page vide.

import { getMeta, setMeta } from './backup.js';

const API = (process.env.TOURISME_API || 'https://tabular-api.data.gouv.fr/api/resources').replace(/\/$/, '');
const RESOURCE = process.env.TOURISME_RESOURCE || '2c6023f2-ffce-4c1a-9728-bdc020e463b5';
export const TOURISME_ENABLED = String(process.env.TOURISME || '').toLowerCase() !== 'off';
const TTL = 6 * 3600e3;
const CACHE_KEY = 'tourisme_cache';
// Saint-Étienne Métropole et ses voisins (Forez, Pilat, Ondaine, Gier, Monts du Lyonnais, Haute-Loire proche)
const BOX = { latMin: 45.25, latMax: 45.65, lngMin: 4.05, lngMax: 4.75 };
const PAGE_SIZE = 200;
const MAX_PAGES = 15;

export const SOURCE = {
  name: 'DATAtourisme',
  url: 'https://www.data.gouv.fr/datasets/datatourisme-la-plateforme-nationale-des-donnees-touristiques',
  license: 'Licence Ouverte',
};

// Types d'événement DATAtourisme → libellés affichés (du plus précis au plus général)
const KINDS = [
  ['Concert', 'Concert'], ['Festival', 'Festival'], ['TheaterEvent', 'Théâtre'], ['ShowEvent', 'Spectacle'],
  ['ScreeningEvent', 'Projection'], ['Exhibition', 'Exposition'], ['Conference', 'Conférence'],
  ['Carnival', 'Carnaval'], ['Parade', 'Défilé'], ['TraditionalCelebration', 'Fête traditionnelle'],
  ['BricABrac', 'Brocante'], ['GarageSale', 'Vide-grenier'], ['FairOrShow', 'Foire, salon'], ['Market', 'Marché'],
  ['SportsCompetition', 'Compétition'], ['SportsEvent', 'Sport'], ['Visit', 'Visite'], ['Game', 'Jeu'],
  ['WorkshopEvent', 'Atelier'], ['Workshop', 'Atelier'], ['SaleEvent', 'Vente'], ['SocialEvent', 'Animation'],
  ['CulturalEvent', 'Culture'],
];
const KIND_MAP = new Map(KINDS);

const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const clean = (s, max) => {
  const v = String(s ?? '').trim();
  return v === 'None' ? '' : v.slice(0, max);
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePeriods(text) {
  return String(text || '').split('|').map((p) => p.split('<->').map((x) => x.trim()))
    .filter(([a, b]) => DAY_RE.test(a) && DAY_RE.test(b || a))
    .map(([a, b = a]) => (a <= b ? { start: a, end: b } : { start: b, end: a }))
    .sort((x, y) => x.start.localeCompare(y.start));
}

function parseContacts(text) {
  const out = { website: '', email: '', phone: '' };
  for (const part of String(text || '').split(/[#|]/).map((x) => x.trim()).filter(Boolean)) {
    if (!out.website && /^https?:\/\/[^\s]+$/i.test(part)) {
      try { const u = new URL(part); if (['http:', 'https:'].includes(u.protocol)) out.website = u.toString(); } catch { /* ignoré */ }
    } else if (!out.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) out.email = part.slice(0, 200);
    else if (!out.phone && /^[+\d][\d .-]{6,}$/.test(part)) out.phone = part.slice(0, 40);
  }
  return out;
}

// Une ligne du fichier → un événement prêt à afficher (ou null s'il est passé ou illisible)
export function normalizeRow(r, today = dayKey()) {
  const title = clean(r.Nom_du_POI, 200);
  const periods = parsePeriods(r.Periodes_regroupees).filter((p) => p.end >= today);
  if (!title || !periods.length) return null;
  const types = String(r.Categories_de_POI || '').split('|').map((c) => c.split('#').pop());
  let kinds = [...new Set(KINDS.map(([k]) => k).filter((k) => types.includes(k)).map((k) => KIND_MAP.get(k)))];
  if (kinds.length > 1) kinds = kinds.filter((k) => k !== 'Vente' && k !== 'Culture'); // trop vagues à côté d'un type précis
  const [postcode, city] = String(r.Code_postal_et_commune || '').split('#');
  const lat = Number(r.Latitude); const lng = Number(r.Longitude);
  const next = periods[0];
  const spanDays = (Date.parse(next.end) - Date.parse(next.start)) / 864e5;
  const id = String(r.URI_ID_du_POI || '').split('/').pop() || String(r.__id);
  return {
    id: id.replace(/[^\w-]/g, '').slice(0, 60),
    title,
    kinds: kinds.slice(0, 3),
    periods: periods.slice(0, 30),
    next,
    // Marchés et événements qui durent des semaines : affichés à part, pour ne pas noyer le reste
    ongoing: kinds.includes('Marché') || spanDays > 31,
    address: clean(r.Adresse_postale, 200),
    postcode: clean(postcode, 10),
    city: clean(city, 80),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    description: clean(r.Description, 600),
    publisher: clean(r.Createur_de_la_donnee, 120),
    updated: DAY_RE.test(r.Date_de_mise_a_jour) ? r.Date_de_mise_a_jour : '',
    ...parseContacts(r.Contacts_du_POI),
  };
}

async function fetchAll() {
  const qs = new URLSearchParams({
    Latitude__greater: String(BOX.latMin), Latitude__less: String(BOX.latMax),
    Longitude__greater: String(BOX.lngMin), Longitude__less: String(BOX.lngMax),
    page_size: String(PAGE_SIZE),
  });
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    qs.set('page', String(page));
    const res = await fetch(`${API}/${RESOURCE}/data/?${qs}`, { signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`data.gouv.fr a répondu ${res.status}`);
    const j = await res.json();
    const data = Array.isArray(j.data) ? j.data : [];
    rows.push(...data);
    if (data.length < PAGE_SIZE || rows.length >= (j.meta?.total ?? Infinity)) break;
  }
  const today = dayKey();
  const seen = new Set();
  const events = [];
  for (const r of rows) {
    const e = normalizeRow(r, today);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    events.push(e);
  }
  events.sort((a, b) => a.next.start.localeCompare(b.next.start) || a.title.localeCompare(b.title, 'fr'));
  return events;
}

let cache = null;      // { at, events } : la dernière liste obtenue
let failedAt = 0;      // dernier échec : on attend 10 minutes avant de réessayer
let pending = null;

async function refresh() {
  try {
    const events = await fetchAll();
    cache = { at: Date.now(), events };
    failedAt = 0;
    await setMeta(CACHE_KEY, JSON.stringify(cache)).catch(() => {});
    console.log(`[territoire] ${events.length} événements à venir chargés depuis DATAtourisme`);
  } catch (err) {
    failedAt = Date.now();
    console.error('[territoire] DATAtourisme injoignable :', err.message);
    if (!cache) {
      const saved = await getMeta(CACHE_KEY).catch(() => null);
      try { if (saved) cache = JSON.parse(saved); } catch { /* copie illisible : ignorée */ }
    }
  }
}

// Liste à jour (au plus 6 heures), sinon la dernière connue. Ne lève jamais d'erreur.
export async function getTourismEvents() {
  if (!TOURISME_ENABLED) return { events: [], updated_at: null, stale: false, disabled: true };
  const fresh = cache && Date.now() - cache.at < TTL;
  const waiting = failedAt && Date.now() - failedAt < 10 * 60e3;
  if (!fresh && !waiting) {
    pending ||= refresh().finally(() => { pending = null; });
    await pending;
  }
  if (!cache) return { events: [], updated_at: null, stale: true };
  // Une copie ancienne ne doit pas montrer de dates déjà passées
  const today = dayKey();
  const events = cache.events
    .map((e) => { const periods = e.periods.filter((p) => p.end >= today); return periods.length ? { ...e, periods, next: periods[0] } : null; })
    .filter(Boolean);
  return { events, updated_at: new Date(cache.at).toISOString(), stale: Date.now() - cache.at >= TTL };
}
