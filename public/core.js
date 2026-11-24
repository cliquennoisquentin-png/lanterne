// Lanterne — état partagé, navigation, filtres, composants communs
import { api, html, raw, esc, $, $$, icon, lantern, statusBadge, timeHM, dayKey, TYPES, toast, copyText, storage } from './lib.js';

export const state = {
  user: null,
  palette: [],
  categories: [],
  passwordLogin: true, // connexion par mot de passe proposée (réglage PASSWORD_LOGIN du serveur)
  tourisme: true,      // page « Événements du territoire » proposée (réglage TOURISME du serveur)
  assos: [],
  venues: null,
  filters: storage.get('lanterne-filters', { assos: [], cats: [], places: [], statuses: [], types: [] }),
  cache: new Map(),
};

export const isMember = () => !!(state.user?.association && state.user.association.status === 'approved');
export const isAdmin = () => !!state.user?.is_admin;

// ---------- navigation ----------
let renderFn = () => {};
export function setRenderer(fn) { renderFn = fn; }
export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  renderFn();
  if (!replace) window.scrollTo({ top: 0 });
}
export const params = () => new URLSearchParams(location.search);

// ---------- données ----------
export async function refreshMe() {
  const { user } = await api('/api/me');
  state.user = user;
  return user;
}
export async function loadAssos(force = false) {
  if (!state.assos.length || force) state.assos = (await api('/api/associations')).associations;
  return state.assos;
}
export async function loadVenues(force = false) {
  if (!state.venues || force) state.venues = (await api('/api/venues')).venues;
  return state.venues;
}
export async function loadEvents(from, to, extra = '') {
  const key = `${from?.toISOString?.() || ''}|${to?.toISOString?.() || ''}|${extra}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const qs = new URLSearchParams();
  if (from) qs.set('from', from.toISOString());
  if (to) qs.set('to', to.toISOString());
  if (extra) for (const [k, v] of new URLSearchParams(extra)) qs.set(k, v);
  const p = api(`/api/events?${qs}`).then((r) => r.events.map(normEvent));
  state.cache.set(key, p);
  p.catch(() => state.cache.delete(key));
  return p;
}
export const invalidate = () => state.cache.clear();

// Événements du territoire (DATAtourisme) : chargés une fois par visite, le serveur les garde 6 heures
let tourismPromise = null;
export function loadTourism() {
  if (!state.tourisme) return Promise.resolve({ events: [] });
  if (!tourismPromise) {
    tourismPromise = api('/api/tourisme');
    tourismPromise.catch(() => { tourismPromise = null; });
  }
  return tourismPromise;
}
export const occursOn = (e, day) => e.periods.some((p) => p.start <= day && day <= p.end);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v || []);
export function normEvent(e) { return { ...e, orgs: parse(e.orgs), attendances: parse(e.attendances) }; }

// ---------- filtres ----------
export const placeKey = (e) => (e.venue_city ? (e.venue_district ? `${e.venue_city}|${e.venue_district}` : e.venue_city) : '');
export function filtersActive() {
  const f = state.filters;
  return f.assos.length + f.cats.length + f.places.length + f.statuses.length + f.types.length;
}
export function applyFilters(events) {
  const f = state.filters;
  return events.filter((e) => {
    if (f.assos.length && !e.orgs.some((o) => f.assos.includes(o.id))) return false;
    if (f.cats.length && !f.cats.includes(e.category_id)) return false;
    if (f.places.length) {
      const pk = placeKey(e);
      if (!f.places.includes(e.venue_city) && !f.places.includes(pk)) return false;
    }
    if (f.statuses.length && !f.statuses.includes(e.status)) return false;
    if (f.types.length && !f.types.includes(e.type)) return false;
    return true;
  });
}
export function saveFilters() { storage.set('lanterne-filters', state.filters); }

// ---------- composants ----------
export function eventCard(e, { showDate = false } = {}) {
  const c = e.asso_color;
  const co = e.orgs.length > 1 ? ` + ${e.orgs.length - 1}` : '';
  return html`<a class="ev ${e.status}" style="--c:${c}" href="/evenement/${e.id}">
    <div class="ev-time">${showDate ? raw(`${esc(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' }).format(new Date(e.starts_at)))}<br>`) : ''}${timeHM(e.starts_at)}</div>
    <div class="ev-body">
      <div class="ev-title ${e.status === 'annule' ? 'cancelled-title' : ''}">${e.title}</div>
      <div class="ev-meta">
        <span><span class="dot" style="--c:${c}"></span>${e.asso_name}${co}</span>
        ${e.venue_name ? html`<span>${icon('pin')}${e.venue_name}${e.venue_city ? ` · ${e.venue_city}` : ''}</span>` : ''}
      </div>
      <div class="ev-badges">
        ${statusBadge(e.status)}
        ${e.category_name ? html`<span class="tag">${e.category_name}</span>` : ''}
        ${e.type !== 'public' ? html`<span class="tag">${TYPES[e.type].short}</span>` : ''}
        ${e.visibility !== 'public' ? html`<span class="tag">${icon(e.visibility === 'private' ? 'lock' : 'users')}${e.visibility === 'private' ? 'Privé' : 'Assos'}</span>` : ''}
        ${e.rescheduled_from ? html`<span class="tag">Reporté</span>` : ''}
        ${e.attendances.length ? html`<span class="tag">${icon('go')}${e.attendances.length} asso${e.attendances.length > 1 ? 's' : ''}</span>` : ''}
        ${e.comment_count ? html`<span class="tag">${icon('comment')}${e.comment_count}</span>` : ''}
      </div>
    </div>
    ${e.image_id ? html`<img class="ev-thumb" src="/img/${e.image_id}" alt="" loading="lazy">` : ''}
  </a>`;
}

export function emptyState(text, action = '') {
  return html`<div class="empty"><svg viewBox="0 0 64 80"><use href="#lanterne-logo"/></svg><p>${text}</p>${action}</div>`;
}

// ---------- fenêtres modales ----------
export function openModal({ title, body, foot = '', onMount, wide = false }) {
  const d = document.createElement('dialog');
  d.className = 'modal';
  if (wide) d.style.width = 'min(720px, calc(100vw - 24px))';
  d.innerHTML = String(html`<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button></div>
    <div class="modal-body">${body}</div>${foot ? html`<div class="modal-foot">${foot}</div>` : ''}`);
  document.body.append(d);
  // Fermeture en douceur (la fenêtre redescend sur mobile, s'estompe sur ordinateur)
  const close = () => {
    if (d.classList.contains('closing') || !d.open) return;
    d.classList.add('closing');
    setTimeout(() => d.close(), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 190);
  };
  d.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (ev) => { if (ev.target === d || ev.target.closest('[data-close]')) close(); });
  d.showModal();
  onMount?.(d, close);
  return { el: d, close };
}

export function confirmBox(title, text, okLabel = 'Confirmer', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, body: html`<p>${text}</p>`,
      foot: html`<button class="btn ghost" data-close>Retour</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${okLabel}</button>`,
      onMount(d, close) {
        d.querySelector('[data-ok]').addEventListener('click', () => { done = true; resolve(true); close(); });
        d.addEventListener('close', () => { if (!done) resolve(false); });
      },
    });
    return m;
  });
}

// ---------- abonnement (Google Agenda, iPhone, Outlook) ----------
export async function openSubscribe(preset = {}) {
  await loadAssos();
  const member = isMember();
  const base = location.origin;
  const build = (scope, asso, cat) => {
    const qs = new URLSearchParams();
    if (scope === 'mine') qs.set('mine', '1');
    if (scope === 'asso' && asso) qs.set('asso', asso);
    if (scope === 'cat' && cat) qs.set('cat', cat);
    const path = state.user ? `/ics/u/${state.user.ics_token}.ics` : '/ics/public.ics';
    return `${base}${path}${qs.toString() ? `?${qs}` : ''}`;
  };
  const body = html`
    <p class="muted small">Copiez ce lien dans votre agenda : les dates s’y mettront à jour toutes seules.
    ${state.user ? 'Ce lien est personnel : il montre aussi les dates réservées aux associations. Ne le partagez pas.' : 'Ce lien ne contient que les dates publiques.'}</p>
    <div class="stack">
      <fieldset class="fs">
        <legend class="field-label">Quelles dates ?</legend>
        <div class="choice-row">
          <label class="choice"><input type="radio" name="scope" value="all" ${preset.scope ? '' : 'checked'}>Toutes</label>
          ${member ? html`<label class="choice"><input type="radio" name="scope" value="mine" ${preset.scope === 'mine' ? 'checked' : ''}>Mes événements</label>` : ''}
          <label class="choice"><input type="radio" name="scope" value="asso" ${preset.scope === 'asso' ? 'checked' : ''}>Une association</label>
          <label class="choice"><input type="radio" name="scope" value="cat" ${preset.scope === 'cat' ? 'checked' : ''}>Une catégorie</label>
        </div>
        ${member ? html`<p class="hint">« Mes événements » : les dates de votre association et celles où elle a dit « on y va ».</p>` : ''}
      </fieldset>
      <label class="field" data-show="asso" hidden><span>Association</span>
        <select class="input" name="asso">${state.assos.map((a) => html`<option value="${a.slug}" ${preset.asso === a.slug ? 'selected' : ''}>${a.name}</option>`)}</select></label>
      <label class="field" data-show="cat" hidden><span>Catégorie</span>
        <select class="input" name="cat">${state.categories.filter((c) => c.active).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
      <div><span class="field-label">Lien d’abonnement</span>
        <div class="copy-field"><input class="input" name="url" readonly><button class="btn" data-copy>${icon('copy')}Copier</button></div></div>
      <div class="actions">
        <a class="btn" data-google target="_blank" rel="noopener">Ajouter à Google Agenda</a>
        <a class="btn" data-webcal>iPhone, Mac, Outlook</a>
      </div>
      <details class="more"><summary>Comment faire ?</summary>
        <div class="small muted" style="margin-top:10px">
          <p><b>Google Agenda</b> : bouton ci-dessus, ou sur ordinateur « Autres agendas » → « + » → « À partir de l’URL », puis collez le lien.</p>
          <p><b>iPhone</b> : bouton ci-dessus, ou Réglages → Calendrier → Comptes → Ajouter un compte → Autre → « Ajouter un calendrier avec abonnement ».</p>
          <p><b>Outlook</b> : Agenda → « Ajouter un calendrier » → « S’abonner à partir du web », puis collez le lien.</p>
        </div></details>
    </div>`;
  openModal({
    title: 'S’abonner à l’agenda', body,
    onMount(d) {
      const upd = () => {
        const scope = d.querySelector('[name=scope]:checked').value;
        $$('[data-show]', d).forEach((el) => { el.hidden = el.dataset.show !== scope; });
        const url = build(scope, d.querySelector('[name=asso]').value, d.querySelector('[name=cat]').value);
        d.querySelector('[name=url]').value = url;
        const webcal = url.replace(/^https?:/, 'webcal:');
        d.querySelector('[data-google]').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
        d.querySelector('[data-webcal]').href = webcal;
      };
      d.addEventListener('change', upd);
      d.querySelector('[data-copy]').addEventListener('click', async () => { if (await copyText(d.querySelector('[name=url]').value)) toast('Lien copié.'); });
      upd();
    },
  });
}

export async function shareEvent(e) {
  const url = `${location.origin}/evenement/${e.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: e.title, text: `${e.title} — ${e.asso_name}`, url }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  if (await copyText(url)) toast('Lien de l’événement copié.');
}

export function requireLoginToast() {
  toast('Connectez-vous avec votre association pour ajouter une date.');
}

export { dayKey };
