// Lanterne — outils partagés de l'interface

// ---------- HTML sûr ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// Gabarit : les valeurs sont échappées, sauf celles marquées raw()
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Requested-With': 'lanterne', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) {
    const err = new Error(data?.error || (res.status === 0 || !navigator.onLine ? 'Pas de connexion.' : 'Une erreur est survenue.'));
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- notifications ----------
let toastTimer;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

// ---------- dates (toujours à l'heure de Saint-Étienne) ----------
export const TZ = 'Europe/Paris';
const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHM = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const dayKey = (d) => fmtKey.format(new Date(d));          // 'YYYY-MM-DD'
export const timeHM = (d) => fmtHM.format(new Date(d)).replace(':', 'h');
export const timeInput = (d) => fmtHM.format(new Date(d));         // 'HH:MM'
export const todayKey = () => dayKey(new Date());

export function fmt(d, opts) { return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, ...opts }).format(new Date(d)); }
export const longDate = (d) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const shortDate = (d) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });

// Décalage de Paris (en minutes) à un instant donné
function tzOffset(ms) {
  const p = Object.fromEntries(fmtParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUtc - ms) / 60000;
}
// 'YYYY-MM-DD' + 'HH:MM' (heure de Paris) → Date
export function parisDate(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - tzOffset(guess) * 60000;
  ms = guess - tzOffset(ms) * 60000;
  return new Date(ms);
}
// Arithmétique sur les clés de jour
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
export function addMonths(monthKey, n) { // 'YYYY-MM'
  const [y, m] = monthKey.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  return x.toISOString().slice(0, 7);
}
export const weekday = (key) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
export function monthLabel(monthKey) {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey}-15T12:00:00Z`));
}
export function keyLabel(key, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('fr-FR', { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}
// Jours couverts par un événement (pour les festivals sur plusieurs jours)
export function eventDays(e) {
  const start = dayKey(e.starts_at);
  if (!e.ends_at) return [start];
  // une fin avant 6h du matin compte pour la veille (soirées)
  const endD = new Date(new Date(e.ends_at).getTime() - 6 * 3600e3);
  let end = dayKey(endD);
  if (end < start) end = start;
  const days = [start];
  let k = start;
  while (k < end && days.length < 31) { k = addDays(k, 1); days.push(k); }
  return days;
}

// ---------- libellés ----------
export const STATUS = {
  option: { label: 'Option', icon: 'option' },
  en_cours: { label: 'En cours', icon: 'half' },
  valide: { label: 'Validé', icon: 'check' },
  annule: { label: 'Annulé', icon: 'cross' },
};
export const TYPES = {
  public: { label: 'Événement public', short: 'Public' },
  internal: { label: 'Réunion interne', short: 'Interne' },
  inter: { label: 'Réunion inter-assos', short: 'Inter-assos' },
  ag: { label: 'Assemblée générale', short: 'AG' },
};
export const VIS = {
  public: { label: 'Public', help: 'Visible par tous, y compris sur la version publique.', icon: 'globe' },
  associations: { label: 'Associations', help: 'Visible en entier par toutes les associations inscrites, pas par le public.', icon: 'users' },
  private: { label: 'Privé', help: 'Visible seulement par votre association.', icon: 'lock' },
};

// ---------- icônes (traits fins) ----------
const P = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14c2.4.2 4 1.7 4.5 4.5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  chevL: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevR: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8-9-9Z"/><circle cx="8" cy="9" r="1.3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  euro: '<path d="M17 6.5A6.5 6.5 0 1 0 17 17.5"/><path d="M4.5 10.5h8M4.5 13.5h8"/>',
  share: '<path d="M12 3.5v12M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>',
  calAdd: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  cancel: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>',
  move: '<path d="M4 12h14M14 7l5 5-5 5"/><path d="M4 5v14"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.5l3 1.8"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.7 3.5 5.5 3.5 8.5s-1 5.8-3.5 8.5c-2.5-2.7-3.5-5.5-3.5-8.5s1-5.8 3.5-8.5Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  check: '<path d="M5 12.5 10 17 19 7.5"/>',
  cross: '<path d="M7 7l10 10M17 7 7 17"/>',
  half: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/>',
  option: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.6"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z"/>',
  star: '<path d="m12 4 2.4 5 5.3.6-4 3.6 1.1 5.3L12 15.8 7.2 18.5l1.1-5.3-4-3.6 5.3-.6L12 4Z"/>',
  go: '<path d="M5 12.5 10 17 19 7.5"/>',
  logout: '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-2.5Z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/>',
  rss: '<path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  comment: '<path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5v-10Z"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
export const logo = (cls = 'logo-mark') => raw(`<svg class="${cls}" viewBox="0 0 64 80" aria-hidden="true"><use href="#lanterne-logo"/></svg>`);
export const lantern = (color, status = '') => raw(`<svg class="lantern ${esc(status)}" style="--c:${esc(color)}" viewBox="0 0 12 16" aria-hidden="true"><use href="#lantern-mini"/></svg>`);

export const statusBadge = (s) => html`<span class="status ${s}">${icon(STATUS[s]?.icon || 'option')}${STATUS[s]?.label || s}</span>`;

export function assoLogo(a, cls = 'asso-logo') {
  const c = a.color || a.asso_color || '#3998EB';
  if (a.logo_id) return html`<img class="${cls}" style="--c:${c}" src="/img/${a.logo_id}" alt="" loading="lazy">`;
  const initials = String(a.name || '?').replace(/^(les?|la|l'|association)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return html`<span class="${cls}" style="--c:${c}" aria-hidden="true">${initials}</span>`;
}
export const assoChip = (a) => html`<a class="chip-asso" style="--c:${a.color}" href="/associations/${a.slug}"><span class="dot"></span>${a.name}</a>`;

// ---------- images : redimensionnées dans le navigateur avant envoi ----------
export function readImage(file, { max = 1600, type = 'image/jpeg', quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!/^image\/(png|jpeg|webp|gif|heic|heif|svg\+xml)$/.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) return reject(new Error('Choisissez une image (JPEG, PNG, WebP).'));
    if (file.type === 'image/svg+xml') {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Image illisible.'));
      return r.readAsDataURL(file);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}

// ---------- divers ----------
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
export const storage = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigation privée */ } },
};
