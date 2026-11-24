// Lanterne — point d'entrée : structure de la page, routeur, filtres, thème
import { html, raw, $, $$, icon, logo, api, toast, STATUS, TYPES, storage } from './lib.js';
import { state, isMember, isAdmin, navigate, setRenderer, loadAssos, loadEvents, saveFilters, filtersActive, invalidate, requireLoginToast, placeKey } from './core.js';
import { monthView, listView, mapView, eventView, mapStyle } from './views-agenda.js';
import { eventForm } from './views-form.js';
import { directoryView, profileView, registerView, loginView, accountView, adminView, legalView } from './views-other.js';

window.lanterne = { contact: '' };

// ---------- thème ----------
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  storage.set('lanterne-theme-json', t);
  try { localStorage.setItem('lanterne-theme', t); } catch { /* */ }
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#f4f6fb' : '#07080d';
  const m = window.lanterne.currentMap;
  if (m && document.getElementById('map')) m.setStyle(mapStyle());
  renderShell();
}
window.lanterne.setTheme = setTheme;

// ---------- structure ----------
const NAV = [
  { href: '/', label: 'Agenda', icon: 'calendar', match: (p) => p === '/' || p.startsWith('/liste') || p.startsWith('/carte') || p.startsWith('/evenement') || p.startsWith('/nouveau') },
  { href: '/associations', label: 'Associations', icon: 'users', match: (p) => p.startsWith('/associations') || p.startsWith('/inscription') },
];

function renderShell() {
  const path = location.pathname;
  const u = state.user;
  const pendingAdmin = isAdmin() ? '' : '';
  const accountLink = u ? { href: '/compte', label: u.name ? u.name.split(' ')[0] : 'Compte', icon: 'user' } : { href: '/connexion', label: 'Connexion', icon: 'user' };
  const dark = document.documentElement.dataset.theme !== 'light';
  const shell = document.getElementById('shell') || (() => {
    const s = document.createElement('div'); s.id = 'shell'; document.getElementById('app').append(s); return s;
  })();
  shell.innerHTML = String(html`
    <header class="topbar">
      <a class="brand" href="/" aria-label="Lanterne, accueil">${logo('logo-mark')}<span class="brand-name">LANTERNE</span></a>
      <nav class="topnav" aria-label="Navigation principale">
        ${NAV.map((n) => html`<a href="${n.href}" ${n.match(path) ? raw('aria-current="page"') : ''}>${n.label}</a>`)}
        ${isAdmin() ? html`<a href="/admin" ${path.startsWith('/admin') ? raw('aria-current="page"') : ''}>Administration</a>` : ''}
      </nav>
      <span class="spacer"></span>
      <button class="icon-btn" data-theme-toggle aria-label="${dark ? 'Passer en mode clair' : 'Passer en mode sombre'}" title="${dark ? 'Mode clair' : 'Mode sombre'}">${icon(dark ? 'sun' : 'moon')}</button>
      ${isAdmin() ? html`<a class="icon-btn" href="/admin" aria-label="Administration" style="display:none" data-admin-mobile>${icon('shield')}</a>` : ''}
      ${u ? html`<a class="btn small ghost" href="/compte" ${path.startsWith('/compte') ? raw('aria-current="page"') : ''}>${icon('user')}<span>${accountLink.label}</span></a>`
        : html`<a class="btn small" href="/connexion">Connexion</a>`}
    </header>
    <nav class="bottomnav" aria-label="Navigation">
      ${NAV.map((n) => html`<a href="${n.href}" ${n.match(path) ? raw('aria-current="page"') : ''}>${icon(n.icon)}${n.label}</a>`)}
      ${isAdmin() ? html`<a href="/admin" ${path.startsWith('/admin') ? raw('aria-current="page"') : ''}>${icon('shield')}Admin</a>` : html`<a href="/liste" ${path.startsWith('/liste') ? raw('aria-current="page"') : ''}>${icon('list')}Liste</a>`}
      <a href="${accountLink.href}" ${path.startsWith('/compte') || path.startsWith('/connexion') ? raw('aria-current="page"') : ''}>${icon('user')}${u ? 'Compte' : 'Connexion'}</a>
    </nav>
    ${isMember() && !path.startsWith('/nouveau') && !path.endsWith('/modifier') ? html`<button class="fab" data-fab aria-label="Poser une nouvelle date" title="Nouvelle date">${icon('plus')}</button>` : ''}
    ${pendingAdmin}`);
  $('[data-theme-toggle]', shell).addEventListener('click', () => setTheme(dark ? 'light' : 'dark'));
  $('[data-fab]', shell)?.addEventListener('click', () => navigate('/nouveau'));
}
window.lanterne.renderShell = renderShell;

// ---------- filtres (un seul panneau) ----------
async function openFilters() {
  const assos = await loadAssos();
  // Communes et quartiers : ceux des lieux des dates déjà chargées
  const all = (await Promise.all([...state.cache.values()].map((p) => p.catch(() => [])))).flat();
  const places = new Map();
  for (const e of all) {
    if (!e.venue_city) continue;
    places.set(e.venue_city, e.venue_city);
    if (e.venue_district) places.set(placeKey(e), `${e.venue_city} · ${e.venue_district}`);
  }
  for (const p of state.filters.places) if (!places.has(p)) places.set(p, p.replace('|', ' · '));
  const f = state.filters;
  const chk = (group, value, label, extra = '') => html`<label class="choice"><input type="checkbox" data-g="${group}" value="${value}" ${f[group].includes(value) ? 'checked' : ''}>${extra}${label}</label>`;

  let back = $('.drawer-back'); let dr = $('.drawer');
  if (!dr) {
    back = document.createElement('div'); back.className = 'drawer-back';
    dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('aria-label', 'Filtres'); dr.setAttribute('role', 'dialog');
    document.body.append(back, dr);
    back.addEventListener('click', closeFilters);
  }
  dr.innerHTML = String(html`<div class="drawer-head"><h2>Filtres</h2><button class="icon-btn" data-x aria-label="Fermer">${icon('close')}</button></div>
    <div class="drawer-body">
      <fieldset><legend class="label">Statut</legend><div class="choice-row">${Object.entries(STATUS).map(([k, s]) => chk('statuses', k, s.label, icon(s.icon)))}</div></fieldset>
      <fieldset><legend class="label">Type</legend><div class="choice-row">${Object.entries(TYPES).map(([k, t]) => chk('types', k, t.short))}</div></fieldset>
      <fieldset><legend class="label">Catégorie</legend><div class="choice-row">${state.categories.map((c) => chk('cats', c.id, c.name))}</div></fieldset>
      <fieldset><legend class="label">Commune ou quartier</legend>${places.size ? html`<div class="choice-row">${[...places].sort((a, b) => a[1].localeCompare(b[1])).map(([k, l]) => chk('places', k, l))}</div>` : html`<p class="small faint">Aucun lieu pour l’instant.</p>`}</fieldset>
      <fieldset><legend class="label">Association</legend>
        ${assos.length > 8 ? html`<input class="input" data-aq placeholder="Filtrer…" style="margin-bottom:8px">` : ''}
        <div class="choice-row">${assos.map((a) => html`<label class="choice" data-n="${a.name.toLowerCase()}"><input type="checkbox" data-g="assos" value="${a.id}" ${f.assos.includes(a.id) ? 'checked' : ''}><span class="dot" style="--c:${a.color}"></span>${a.name}</label>`)}</div></fieldset>
    </div>
    <div class="drawer-foot"><button class="btn" data-reset>Tout effacer</button><button class="btn primary" data-done>Voir les dates</button></div>`);
  requestAnimationFrame(() => { back.classList.add('open'); dr.classList.add('open'); });
  $('[data-x]', dr).addEventListener('click', closeFilters);
  $('[data-done]', dr).addEventListener('click', closeFilters);
  $('[data-aq]', dr)?.addEventListener('input', (ev) => { const q = ev.target.value.toLowerCase(); $$('[data-n]', dr).forEach((c) => { c.hidden = q && !c.dataset.n.includes(q); }); });
  $('[data-reset]', dr).addEventListener('click', () => {
    state.filters = { assos: [], cats: [], places: [], statuses: [], types: [] }; saveFilters();
    $$('input[type=checkbox]', dr).forEach((c) => { c.checked = false; }); render();
  });
  dr.addEventListener('change', (ev) => {
    const g = ev.target.dataset.g; if (!g) return;
    const val = ['assos', 'cats'].includes(g) ? Number(ev.target.value) : ev.target.value;
    state.filters[g] = ev.target.checked ? [...new Set([...state.filters[g], val])] : state.filters[g].filter((x) => x !== val);
    saveFilters(); render();
  });
  document.addEventListener('keydown', escClose);
  $('[data-done]', dr).focus();
}
function escClose(ev) { if (ev.key === 'Escape') closeFilters(); }
function closeFilters() {
  $('.drawer')?.classList.remove('open'); $('.drawer-back')?.classList.remove('open');
  document.removeEventListener('keydown', escClose);
}
window.lanterne.openFilters = openFilters;

// ---------- routeur ----------
const routes = [
  [/^\/$/, () => monthView()],
  [/^\/liste\/?$/, () => listView()],
  [/^\/carte\/?$/, () => mapView()],
  [/^\/evenement\/(\d+)\/modifier\/?$/, (m) => eventForm(Number(m[1]))],
  [/^\/evenement\/(\d+)\/?$/, (m) => eventView(Number(m[1]))],
  [/^\/nouveau\/?$/, () => eventForm()],
  [/^\/associations\/?$/, () => directoryView()],
  [/^\/associations\/([^/]+)\/?$/, (m) => profileView(decodeURIComponent(m[1]))],
  [/^\/inscription\/?$/, () => registerView()],
  [/^\/connexion\/?$/, () => loginView()],
  [/^\/compte\/?$/, () => accountView()],
  [/^\/admin\/?$/, () => adminView()],
  [/^\/mentions-legales\/?$/, () => legalView()],
];
let mainEl;
async function render() {
  renderShell();
  if (!mainEl) {
    mainEl = document.createElement('main'); mainEl.id = 'main'; mainEl.tabIndex = -1;
    const foot = document.createElement('footer'); foot.className = 'footer';
    foot.innerHTML = String(html`<span>Lanterne · l’agenda commun des associations stéphanoises</span><a href="/associations">Annuaire</a><a href="/mentions-legales">Mentions légales et confidentialité</a><a href="#" data-sub-foot>S’abonner à l’agenda</a>`);
    document.getElementById('app').append(mainEl, foot);
    foot.querySelector('[data-sub-foot]').addEventListener('click', async (ev) => { ev.preventDefault(); (await import('./core.js')).openSubscribe(); });
  }
  if (!location.pathname.startsWith('/evenement')) document.title = 'Lanterne · l’agenda commun des associations stéphanoises';
  for (const [re, fn] of routes) {
    const m = re.exec(location.pathname);
    if (m) {
      try { await fn(m); } catch (err) { console.error(err); mainEl.innerHTML = String(html`<div class="empty"><p>${err.message || 'Une erreur est survenue.'}</p><a class="btn" href="/">Retour à l’agenda</a></div>`); }
      return;
    }
  }
  mainEl.innerHTML = String(html`<div class="empty"><p>Cette page n’existe pas.</p><a class="btn" href="/">Retour à l’agenda</a></div>`);
}
setRenderer(render);

// Liens internes sans rechargement
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href]');
  if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || a.target || a.hasAttribute('download')) return;
  if (/^\/(auth|ics|img|api|vendor)\//.test(url.pathname)) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  ev.preventDefault();
  closeFilters();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', render);

// ---------- démarrage ----------
(async function boot() {
  const t0 = performance.now();
  try {
    const cfg = await api('/api/config');
    state.user = cfg.user; state.palette = cfg.palette; state.categories = cfg.categories;
    window.lanterne.contact = cfg.contact || '';
  } catch (err) {
    toast('Connexion au serveur impossible. Réessayez dans un instant.', 'error');
  }
  await render();
  // La flamme pulse doucement à l'ouverture, puis l'appli apparaît
  const wait = Math.max(0, 900 - (performance.now() - t0));
  setTimeout(() => { document.getElementById('splash')?.classList.add('gone'); setTimeout(() => document.getElementById('splash')?.remove(), 600); }, wait);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
