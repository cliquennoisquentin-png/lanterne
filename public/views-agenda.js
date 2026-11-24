// Lanterne — vues de l'agenda : mois, liste, carte, fiche
import {
  html, raw, esc, $, $$, icon, lantern, statusBadge, api, toast, timeHM, dayKey, todayKey, addDays, addMonths, weekday,
  monthLabel, keyLabel, eventDays, parisDate, longDate, TYPES, VIS, STATUS, assoLogo, assoChip, fmt, timeInput,
  searchEvents, eventsCsv, downloadText, debounce,
} from './lib.js';
import {
  state, isMember, isAdmin, navigate, params, loadEvents, applyFilters, filtersActive, eventCard, emptyState,
  openModal, confirmBox, openSubscribe, shareEvent, invalidate, normEvent, requireLoginToast,
} from './core.js';

const main = () => document.getElementById('main');

function viewSwitch(current) {
  const q = location.search.includes('mois=') ? `?mois=${params().get('mois')}` : '';
  return html`<nav class="segmented" aria-label="Vue">
    <a href="/${q}" ${current === 'month' ? raw('aria-current="page"') : ''}>${icon('calendar')}<span>Mois</span></a>
    <a href="/liste" ${current === 'list' ? raw('aria-current="page"') : ''}>${icon('list')}<span>Liste</span></a>
    <a href="/carte" ${current === 'map' ? raw('aria-current="page"') : ''}>${icon('map')}<span>Carte</span></a>
  </nav>`;
}
const searchBtn = () => html`<a class="btn" href="/liste?q=" aria-label="Chercher une date" title="Chercher une date">${icon('search')}</a>`;
const filterBtn = () => html`<button class="btn ${filtersActive() ? 'on' : ''}" data-filters aria-label="Filtres">${icon('filter')}<span class="hide-sm">Filtres</span>${filtersActive() ? html`<span class="pill-count">${filtersActive()}</span>` : ''}</button>`;
function bindCommon(root) {
  $('[data-filters]', root)?.addEventListener('click', () => window.lanterne.openFilters());
  $('[data-subscribe]', root)?.addEventListener('click', () => openSubscribe());
}
function pendingBanner() {
  const a = state.user?.association;
  if (a && a.status === 'pending') return html`<div class="notice info" style="margin-bottom:16px">${icon('clock')} <b>${a.name}</b> attend la validation d’un administrateur. Vous pourrez poser vos dates dès qu’elle sera validée.</div>`;
  if (a && a.status === 'rejected') return html`<div class="notice warn" style="margin-bottom:16px">L’inscription de <b>${a.name}</b> n’a pas été validée. Écrivez aux administrateurs si c’est une erreur.</div>`;
  return '';
}

// =====================================================================
// MOIS — l'écran d'accueil
// =====================================================================
export async function monthView() {
  const p = params();
  const today = todayKey();
  const month = /^\d{4}-\d{2}$/.test(p.get('mois') || '') ? p.get('mois') : today.slice(0, 7);
  const first = `${month}-01`;
  const gridStart = addDays(first, -weekday(first));
  const nextFirst = `${addMonths(month, 1)}-01`;
  const lastDay = addDays(nextFirst, -1);
  const gridEnd = addDays(lastDay, 6 - weekday(lastDay));
  const days = [];
  for (let k = gridStart; k <= gridEnd; k = addDays(k, 1)) days.push(k);

  main().innerHTML = String(html`${pendingBanner()}
    <div class="cal-toolbar">
      <button class="icon-btn" data-nav="-1" aria-label="Mois précédent">${icon('chevL')}</button>
      <h1 class="cal-month" aria-live="polite">${monthLabel(month)}</h1>
      <button class="icon-btn" data-nav="1" aria-label="Mois suivant">${icon('chevR')}</button>
      ${month !== today.slice(0, 7) ? html`<a class="btn small" href="/">Aujourd’hui</a>` : ''}
      <a class="btn small ghost" href="/?mois=${addMonths(month, -12)}" title="Voir le même mois l’an dernier" aria-label="Le même mois l’an dernier">${icon('history')}<span class="hide-sm">L’an dernier</span></a>
      <span class="spacer"></span>
      ${viewSwitch('month')}
      ${searchBtn()}${filterBtn()}
    </div>
    <div class="cal-wrap"><div><div class="cal" role="grid" aria-label="Calendrier ${monthLabel(month)}"><div class="spinner" style="grid-column:1/-1"></div></div>
      <div class="legend">
        <span>${lantern('var(--accent)')} une date (couleur de l’association)</span>
        <span>${lantern('var(--accent)', 'option')} en option</span>
        <span>${lantern('var(--accent)', 'annule')} annulée</span>
        <span>Plus un jour brille, plus il est chargé
          <span class="glow-scale" aria-hidden="true">${[0, 1, 2, 3, 4].map((g) => html`<i class="day" style="--g:${g};min-height:0;padding:0"></i>`)}</span></span>
        ${isMember() ? html`<span class="kbd-hint">Touchez un jour pour y créer une date</span>` : ''}
      </div></div>
      <aside class="day-panel card" aria-live="polite"></aside>
    </div>`);
  bindCommon(main());
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(`/?mois=${addMonths(month, Number(b.dataset.nav))}`, { replace: true })));

  let events;
  try {
    events = await loadEvents(parisDate(gridStart), parisDate(addDays(gridEnd, 1)));
  } catch (e) { $('.cal').innerHTML = String(emptyState(e.message)); return; }
  events = applyFilters(events);
  const byDay = new Map();
  for (const e of events) for (const k of eventDays(e)) { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }

  const dows = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const cells = days.map((k, i) => {
    const list = (byDay.get(k) || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const active = list.filter((e) => e.status !== 'annule').length;
    const g = Math.min(active, 4) + (active >= 6 ? 1 : 0);
    const shown = list.slice(0, 8);
    const cls = ['day', k.slice(0, 7) !== month && 'out', k === today && 'today', k < today && 'past'].filter(Boolean).join(' ');
    const label = `${keyLabel(k)} : ${active ? `${active} date${active > 1 ? 's' : ''}` : 'aucune date'}`;
    return html`<button class="${cls}" style="--g:${g};--i:${i}" data-day="${k}" role="gridcell" aria-label="${label}">
      <span class="num"><b>${Number(k.slice(8))}</b>${active ? html`<span class="count">${active}</span>` : ''}</span>
      <span class="lanterns">${shown.map((e) => lantern(e.asso_color, e.status === 'option' || e.status === 'annule' ? e.status : ''))}${list.length > 8 ? html`<span class="lantern-more">+${list.length - 8}</span>` : ''}</span>
      <span class="peek">${list.slice(0, 3).map((e) => html`<span class="${e.status === 'annule' ? 'annule' : ''}" style="--c:${e.asso_color}">${e.title}</span>`)}</span>
    </button>`;
  });
  $('.cal').innerHTML = String(html`${dows.map((d) => html`<div class="cal-dow" aria-hidden="true">${d}</div>`)}${cells}`);
  // Les jours s'allument un à un (après l'ouverture si elle est en cours)
  const lightUp = () => { const c = $('.cal'); if (c) { c.classList.remove('cal-enter'); void c.offsetWidth; c.classList.add('cal-enter'); } };
  if (document.documentElement.classList.contains('splashing')) document.addEventListener('lanterne:reveal', lightUp, { once: true });
  else lightUp();

  const panel = $('.day-panel');
  const showDay = (k) => {
    $$('.day.selected').forEach((d) => d.classList.remove('selected'));
    $(`.day[data-day="${k}"]`)?.classList.add('selected');
    const list = (byDay.get(k) || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    panel.innerHTML = String(html`<h2>${keyLabel(k)}</h2>
      ${list.length ? html`<div class="list-events">${list.map((e) => eventCard(e))}</div>` : html`<p class="muted small">Aucune date ce jour-là${filtersActive() ? ' (avec les filtres actuels)' : ''} : la place est libre.</p>`}
      ${isMember() ? html`<button class="btn small" style="margin-top:12px" data-add="${k}">${icon('plus')}Ajouter une date ce jour</button>` : ''}`);
    $('[data-add]', panel)?.addEventListener('click', () => navigate(`/nouveau?date=${k}`));
    history.replaceState({}, '', `/?mois=${month}&jour=${k}`);
  };
  const sel = p.get('jour') && days.includes(p.get('jour')) ? p.get('jour') : (today.slice(0, 7) === month ? today : first);
  showDay(sel);

  // Un toucher sur un jour : une fenêtre propose de créer un événement ce jour-là
  const askCreate = (k) => {
    const list = (byDay.get(k) || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const active = list.filter((e) => e.status !== 'annule').length;
    const title = keyLabel(k);
    openModal({
      title: title.charAt(0).toUpperCase() + title.slice(1),
      body: html`<div class="ask-create">
        ${list.length ? html`
          <p class="ask-busy ${active >= 2 ? 'hot' : ''}">${icon('calendar')}${active ? `Déjà ${active} date${active > 1 ? 's' : ''} ce jour-là` : 'Une date annulée ce jour-là'}</p>
          <div class="list-events ask-list">${list.slice(0, 3).map((e) => eventCard(e))}</div>
          ${list.length > 3 ? html`<p class="small faint">et ${list.length - 3} autre${list.length > 4 ? 's' : ''}…</p>` : ''}`
        : html`<p class="ask-free">${lantern('var(--accent)')}La place est libre ce jour-là.</p>`}
        <p class="ask-question">Veux-tu créer un événement <span class="nowrap">ce jour-là&nbsp;?</span></p>
      </div>`,
      foot: html`<button class="btn ghost" data-close>Annuler</button><button class="btn primary" data-ok>${icon('plus')}OK, créer</button>`,
      onMount(d, close) {
        const ok = d.querySelector('[data-ok]');
        ok.focus();
        ok.addEventListener('click', () => { close(); navigate(`/nouveau?date=${k}`); });
      },
    });
  };
  $$('.day').forEach((el) => {
    el.addEventListener('click', () => {
      const k = el.dataset.day;
      if (isMember()) {
        if (k.slice(0, 7) === month) showDay(k);
        askCreate(k);
        return;
      }
      if (k.slice(0, 7) !== month) { navigate(`/?mois=${k.slice(0, 7)}&jour=${k}`, { replace: true }); return; }
      showDay(k);
      if (window.matchMedia('(max-width: 1020px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// =====================================================================
// LISTE — les prochaines dates en fil (et les archives)
// =====================================================================
export async function listView() {
  const past = params().get('archives') === '1';
  const asked = params().has('q'); // on arrive par le bouton « Chercher » : le champ prend le focus
  let query = (params().get('q') || '').trim().slice(0, 100);
  main().innerHTML = String(html`${pendingBanner()}
    <div class="page-head">
      <h1>${past ? 'Archives' : 'Prochaines dates'}</h1><span class="spacer"></span>
      ${viewSwitch('list')}${filterBtn()}
    </div>
    <div class="row list-tools">
      <div class="segmented" role="group" aria-label="Période">
        <a href="/liste" data-period="" ${!past ? raw('aria-current="page"') : ''}>À venir</a>
        <a href="/liste?archives=1" data-period="1" ${past ? raw('aria-current="page"') : ''}>${icon('archive')}Archives</a>
      </div>
      <label class="search-field">${icon('search')}<input class="input" type="search" data-search value="${query}" maxlength="100" enterkeyhint="search"
        placeholder="Chercher une date, une association, un lieu…" aria-label="Chercher dans les dates"></label>
      <button class="btn small ghost" data-export title="Télécharger ces dates dans un fichier pour Excel ou LibreOffice">${icon('download')}Exporter</button>
      <button class="btn small ghost" data-subscribe>${icon('rss')}S’abonner</button>
    </div>
    <p class="small faint list-count" data-count aria-live="polite"></p>
    <div class="narrow" data-list><div class="spinner"></div></div>`);
  bindCommon(main());
  const input = $('[data-search]');
  if (asked) input.focus();
  const now = new Date();
  let all;
  try {
    all = past
      ? await loadEvents(new Date(now.getTime() - 3 * 365 * 864e5), now, 'order=desc&limit=1500')
      : await loadEvents(now, new Date(now.getTime() + 400 * 864e5));
  } catch (e) { $('[data-list]').innerHTML = String(emptyState(e.message)); return; }
  all = applyFilters(all);
  if (past) all = all.filter((e) => new Date(e.starts_at) < now);
  const today = todayKey();
  const lastYear = `/?mois=${addMonths(today.slice(0, 7), -12)}`;
  let shown = all;

  const draw = () => {
    const box = $('[data-list]');
    if (!box || !input.isConnected) return; // on a changé de page entre-temps
    shown = searchEvents(all, query);
    // La recherche suit quand on passe de « À venir » aux archives, et reste dans l'adresse (lien partageable)
    const qs = (archives) => { const u = new URLSearchParams(); if (archives) u.set('archives', '1'); if (query) u.set('q', query); const t = u.toString(); return t ? `?${t}` : ''; };
    $$('[data-period]').forEach((a) => { a.href = `/liste${qs(a.dataset.period === '1')}`; });
    history.replaceState({}, '', `/liste${qs(past)}`);
    $('[data-count]').textContent = query ? `${shown.length} date${shown.length > 1 ? 's' : ''} pour « ${query} »${filtersActive() ? ' (avec les filtres actuels)' : ''}` : '';
    $('[data-export]').disabled = !shown.length;
    const groups = new Map();
    for (const e of shown) { const k = dayKey(e.starts_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const none = query
      ? emptyState(`Aucune date ${past ? 'passée' : 'à venir'} ne correspond à « ${query} ».`, html`<a class="btn" href="/liste${qs(!past)}">${past ? 'Chercher dans les dates à venir' : 'Chercher dans les archives'}</a>`)
      : emptyState(past ? 'Pas encore d’archives.' : (filtersActive() ? 'Aucune date avec ces filtres.' : 'Aucune date à venir pour l’instant.'),
        isMember() && !past ? html`<a class="btn primary" href="/nouveau">${icon('plus')}Poser une date</a>` : '');
    box.innerHTML = String(groups.size ? html`
      ${past && !query ? html`<p class="muted small">Les dates passées restent consultables. <a href="${lastYear}">Voir l’an dernier à la même période</a>.</p>` : ''}
      ${[...groups].map(([k, list]) => html`<section class="list-day">
        <div class="list-date ${k === today ? 'today' : ''}"><div class="w">${keyLabel(k, { weekday: 'short' })}</div><div class="d">${Number(k.slice(8))}</div><div class="m">${keyLabel(k, { month: 'short' })}${k.slice(0, 4) !== today.slice(0, 4) ? ` ${k.slice(2, 4)}` : ''}</div></div>
        <div class="list-events">${list.map((e) => eventCard(e))}</div>
      </section>`)}` : none);
  };
  draw();
  input.addEventListener('input', debounce(() => { query = input.value.trim(); draw(); }, 120));
  // Export : exactement ce qui est affiché (période, filtres et recherche compris)
  $('[data-export]').addEventListener('click', () => {
    const rows = past ? shown : [...shown].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    downloadText(`lanterne-${past ? 'archives' : 'dates-a-venir'}-${today}.csv`, eventsCsv(rows, location.origin));
    toast(`${rows.length} date${rows.length > 1 ? 's' : ''} exportée${rows.length > 1 ? 's' : ''}.`);
  });
}

// =====================================================================
// CARTE — fond sombre assorti à l'identité
// =====================================================================
let mapInstance = null;
let maplibre = null;
// Fond de carte OpenFreeMap (OpenStreetMap, gratuit et sans clé) : sombre ou clair selon le thème
export const mapStyle = () => (document.documentElement.dataset.theme === 'light'
  ? 'https://tiles.openfreemap.org/styles/positron'
  : 'https://tiles.openfreemap.org/styles/dark');
async function loadMaplibre() {
  if (maplibre) return maplibre;
  if (!document.querySelector('link[data-maplibre]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/maplibre/maplibre-gl.css'; css.dataset.maplibre = '1';
    document.head.append(css);
  }
  const mod = await import('/vendor/maplibre/maplibre-gl.mjs');
  maplibre = mod.default || mod;
  return maplibre;
}

export async function mapView() {
  const range = params().get('periode') || '3m';
  main().innerHTML = String(html`${pendingBanner()}
    <div class="page-head"><h1>Carte</h1><span class="spacer"></span>${viewSwitch('map')}${filterBtn()}</div>
    <div class="row" style="margin-bottom:14px">
      <div class="segmented" role="group" aria-label="Période">
        <a href="/carte?periode=1m" ${range === '1m' ? raw('aria-current="page"') : ''}>30 jours</a>
        <a href="/carte?periode=3m" ${range === '3m' ? raw('aria-current="page"') : ''}>3 mois</a>
        <a href="/carte?periode=all" ${range === 'all' ? raw('aria-current="page"') : ''}>Tout à venir</a>
      </div>
      <span class="small faint" data-count></span>
    </div>
    <div class="map" id="map" role="region" aria-label="Carte des événements"></div>`);
  bindCommon(main());
  let ml;
  try { ml = await loadMaplibre(); } catch { $('#map').innerHTML = String(emptyState('La carte n’a pas pu se charger.')); return; }
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const map = new ml.Map({
    container: 'map', style: mapStyle(), center: [4.3872, 45.4397], zoom: 10.6,
    attributionControl: { compact: true }, cooperativeGestures: false,
  });
  map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-left');
  mapInstance = map;
  window.lanterne.currentMap = map;
  // La carte se redessine dès qu'elle est prête et à chaque changement de taille du cadre
  const refresh = () => { if (mapInstance === map) { map.resize(); map.triggerRepaint(); } };
  map.once('load', refresh);
  map.once('idle', refresh);
  requestAnimationFrame(refresh);
  new ResizeObserver(refresh).observe(document.getElementById('map'));
  const now = new Date();
  const days = range === '1m' ? 31 : range === 'all' ? 400 : 92;
  const events = applyFilters(await loadEvents(now, new Date(now.getTime() + days * 864e5)));
  const located = events.filter((e) => e.lat != null && e.lng != null);
  $('[data-count]').textContent = `${located.length} date${located.length > 1 ? 's' : ''} sur la carte${events.length - located.length ? ` · ${events.length - located.length} sans adresse` : ''}`;
  const byVenue = new Map();
  for (const e of located) { const k = `${e.lat},${e.lng}`; if (!byVenue.has(k)) byVenue.set(k, []); byVenue.get(k).push(e); }
  const bounds = new ml.LngLatBounds();
  for (const [, list] of byVenue) {
    const e0 = list[0];
    const multi = list.length > 1;
    const st = list.every((e) => e.status === 'annule') ? 'annule' : list.every((e) => e.status === 'option') ? 'option' : '';
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `map-pin ${multi ? 'multi' : ''} ${st}`;
    el.style.setProperty('--c', e0.asso_color);
    el.setAttribute('aria-label', `${e0.venue_name} : ${list.length} date${multi ? 's' : ''}`);
    el.textContent = multi ? String(list.length) : '';
    const popup = `<b>${esc(e0.venue_name)}</b>${e0.venue_city ? `<br><span style="opacity:.7">${esc(e0.venue_city)}</span>` : ''}<div style="margin-top:8px;display:grid;gap:6px">${list.slice(0, 12).map((e) => `<a href="/evenement/${e.id}"><span style="font-family:var(--font-mono);font-size:.8rem">${esc(fmt(e.starts_at, { day: 'numeric', month: 'short' }))} ${esc(timeHM(e.starts_at))}</span> · ${e.status === 'annule' ? `<s>${esc(e.title)}</s>` : esc(e.title)}</a>`).join('')}${list.length > 12 ? `<span>+ ${list.length - 12} autres</span>` : ''}</div>`;
    new ml.Marker({ element: el }).setLngLat([e0.lng, e0.lat]).setPopup(new ml.Popup({ offset: 14, maxWidth: '300px' }).setHTML(popup)).addTo(map);
    bounds.extend([e0.lng, e0.lat]);
  }
  if (byVenue.size > 1) map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 0 });
  else if (byVenue.size === 1) map.jumpTo({ center: bounds.getCenter(), zoom: 14 });
}

// =====================================================================
// FICHE ÉVÉNEMENT
// =====================================================================
export async function eventView(id) {
  main().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await api(`/api/events/${id}`); } catch (e) {
    main().innerHTML = String(emptyState(e.status === 404 ? 'Cet événement n’existe pas ou n’est pas visible pour vous.' : e.message,
      !state.user ? html`<a class="btn" href="/connexion">Se connecter</a>` : ''));
    return;
  }
  const e = normEvent(data.event);
  const c = e.asso_color;
  const myAsso = state.user?.association?.id;
  const mine = e.attendances.find((a) => a.id === myAsso);
  const going = e.attendances.filter((a) => a.kind === 'going');
  const interested = e.attendances.filter((a) => a.kind === 'interested');
  const sameDay = !e.ends_at || dayKey(e.ends_at) === dayKey(e.starts_at) || new Date(e.ends_at) - new Date(e.starts_at) < 18 * 3600e3;
  const when = sameDay
    ? html`<span class="mono">${longDate(e.starts_at)}</span><br><span class="mono">${timeHM(e.starts_at)}${e.ends_at ? ` → ${timeHM(e.ends_at)}` : ''}</span>`
    : html`<span class="mono">du ${longDate(e.starts_at)} à ${timeHM(e.starts_at)}</span><br><span class="mono">au ${longDate(e.ends_at)} à ${timeHM(e.ends_at)}</span>`;
  document.title = `${e.title} · Lanterne`;

  main().innerHTML = String(html`<div class="narrow">
    <p><a href="/?mois=${dayKey(e.starts_at).slice(0, 7)}&jour=${dayKey(e.starts_at)}" class="small">${icon('chevL', '')} Retour au calendrier</a></p>
    ${e.image_id ? html`<div class="event-hero"><img src="/img/${e.image_id}" alt=""></div>` : ''}
    <div class="event-head" style="--c:${c}"><span class="bar"></span><div style="min-width:0;flex:1">
      <div class="row">${statusBadge(e.status)}${e.category_name ? html`<span class="tag">${e.category_name}</span>` : ''}<span class="tag">${TYPES[e.type].label}</span>
        <span class="tag">${icon(VIS[e.visibility].icon)}${VIS[e.visibility].label}</span></div>
      <h1 class="event-title ${e.status === 'annule' ? 'cancelled-title' : ''}">${e.title}</h1>
      <div class="links">${e.orgs.map((o) => assoChip(o))}</div>
    </div></div>

    ${e.status === 'annule' ? html`<div class="notice warn" style="margin-top:16px">${icon('cancel')} Cette date est annulée : elle se libère.${data.rescheduled_to ? html` Reportée au <a href="/evenement/${data.rescheduled_to.id}">${longDate(data.rescheduled_to.starts_at)}</a>.` : ''}</div>` : ''}
    ${e.rescheduled_from ? html`<div class="notice info" style="margin-top:16px">Reporté du <a href="/evenement/${e.rescheduled_from}">${e.rescheduled_from_date ? longDate(e.rescheduled_from_date) : 'précédent'}</a>.</div>` : ''}
    ${e.status === 'option' ? html`<div class="notice" style="margin-top:16px">${icon('option')} Date en option : envisagée, pas encore confirmée.</div>` : ''}

    <div class="facts">
      <div class="fact">${icon('clock')}<div>${when}</div></div>
      ${e.venue_name ? html`<div class="fact">${icon('pin')}<div><b style="font-weight:500">${e.venue_name}</b>${e.venue_address ? html`<br><span class="muted small">${e.venue_address}</span>` : ''}
        ${e.lat != null ? html`<br><a class="small" href="https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=17/${e.lat}/${e.lng}" target="_blank" rel="noopener">Voir sur la carte</a>` : ''}</div></div>` : ''}
      ${e.price ? html`<div class="fact">${icon('euro')}<div>${e.price}</div></div>` : ''}
      ${e.link ? html`<div class="fact">${icon('link')}<div><a href="${e.link}" target="_blank" rel="noopener nofollow">${e.link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 60)}</a></div></div>` : ''}
    </div>
    ${e.description ? html`<div class="card desc">${e.description}</div>` : ''}

    <div class="actions" style="margin:18px 0">
      <button class="btn" data-share>${icon('share')}Partager</button>
      <a class="btn" href="/ics/event/${e.id}.ics" download>${icon('calAdd')}Ajouter à mon agenda</a>
      ${data.can_edit ? html`
        <a class="btn" href="/evenement/${e.id}/modifier">${icon('edit')}Modifier</a>
        <a class="btn" href="/nouveau?copie=${e.id}">${icon('copy')}Dupliquer</a>
        ${e.status !== 'annule' ? html`<button class="btn" data-cancel>${icon('cancel')}Annuler</button>` : ''}
        <button class="btn" data-reschedule>${icon('move')}Reporter</button>
        <button class="btn ghost danger" data-delete>${icon('trash')}Supprimer</button>` : ''}
    </div>

    ${data.can_interact ? html`<div class="card">
      <h2>Les associations présentes</h2>
      <div class="actions" style="margin-bottom:12px">
        <button class="btn ${mine?.kind === 'going' ? 'on' : ''}" data-att="going" aria-pressed="${String(mine?.kind === 'going')}">${icon('go')}On y va</button>
        <button class="btn ${mine?.kind === 'interested' ? 'on' : ''}" data-att="interested" aria-pressed="${String(mine?.kind === 'interested')}">${icon('star')}Intéressé</button>
      </div>
      ${going.length ? html`<p class="small muted" style="margin-bottom:6px">On y va :</p><div class="links" style="margin-bottom:10px">${going.map((a) => assoChip(a))}</div>` : ''}
      ${interested.length ? html`<p class="small muted" style="margin-bottom:6px">Intéressées :</p><div class="links">${interested.map((a) => assoChip(a))}</div>` : ''}
      ${!going.length && !interested.length ? html`<p class="small faint">Aucune association ne s’est encore manifestée.</p>` : ''}
    </div>
    <div class="card">
      <h2>Commentaires</h2>
      <div>${data.comments.length ? data.comments.map((cm) => html`<div class="comment">
        <div class="who">${cm.asso_color ? html`<span class="dot" style="--c:${cm.asso_color}"></span>` : ''}<b style="font-weight:500;color:var(--text)">${cm.author_name}</b>${cm.asso_name ? ` · ${cm.asso_name}` : ''} · <span class="mono tiny">${fmt(cm.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          ${cm.user_id === state.user?.id || isAdmin() ? html`<button class="btn small ghost" style="margin-left:auto" data-del-comment="${cm.id}" aria-label="Supprimer ce commentaire">${icon('trash')}</button>` : ''}</div>
        <div class="body">${cm.body}</div></div>`) : html`<p class="small faint">Pas encore de commentaire. Un souci de date ? Proposez un décalage ici.</p>`}</div>
      <form data-comment style="margin-top:12px" class="stack">
        <textarea class="input" name="body" rows="2" style="min-height:70px" placeholder="« On peut décaler d’une semaine ? »" required maxlength="2000"></textarea>
        <div><button class="btn primary small">Publier</button></div>
      </form>
    </div>` : html`<div class="card"><p class="small muted" style="margin:0">Vous êtes une association ? <a href="/connexion">Connectez-vous</a> pour dire « on y va » et échanger avec les organisateurs.</p></div>`}

    ${data.can_edit && data.history.length ? html`<details class="card more"><summary>Historique des modifications</summary>
      <div style="margin-top:10px">${data.history.map((h) => html`<div class="history-item">
        <span class="when">${fmt(h.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <span><b style="font-weight:500">${h.action}</b> par ${h.user_name || 'inconnu'}${h.association_name ? ` (${h.association_name})` : ''}</span>
        ${h.revertible ? html`<button class="btn small ghost" style="margin-left:auto" data-revert="${h.id}">${icon('history')}Revenir avant</button>` : ''}
      </div>`)}</div></details>` : ''}
  </div>`);

  const m = main();
  $('[data-share]', m).addEventListener('click', () => shareEvent(e));
  $$('[data-att]', m).forEach((b) => b.addEventListener('click', async () => {
    const kind = mine?.kind === b.dataset.att ? null : b.dataset.att;
    try { await api(`/api/events/${e.id}/attendance`, { method: 'POST', body: { kind } }); invalidate(); eventView(id); } catch (err) { toast(err.message, 'error'); }
  }));
  $('[data-comment]', m)?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = ev.target.body.value.trim();
    if (!body) return;
    try { await api(`/api/events/${e.id}/comments`, { method: 'POST', body: { body } }); invalidate(); eventView(id); } catch (err) { toast(err.message, 'error'); }
  });
  $$('[data-del-comment]', m).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Supprimer le commentaire ?', 'Il disparaîtra de la fiche.', 'Supprimer', true))) return;
    try { await api(`/api/comments/${b.dataset.delComment}`, { method: 'DELETE' }); eventView(id); } catch (err) { toast(err.message, 'error'); }
  }));
  $('[data-cancel]', m)?.addEventListener('click', async () => {
    if (!(await confirmBox('Annuler cette date ?', 'Elle restera affichée, barrée, pour que tout le monde voie qu’elle se libère. Vous pourrez revenir en arrière depuis l’historique.', 'Annuler la date', true))) return;
    try { await api(`/api/events/${e.id}/cancel`, { method: 'POST', body: {} }); invalidate(); toast('Date annulée.'); eventView(id); } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-delete]', m)?.addEventListener('click', async () => {
    if (!(await confirmBox('Supprimer cette date ?', 'Elle disparaîtra de l’agenda. Pour signaler qu’elle se libère, préférez « Annuler ». Un administrateur peut la restaurer depuis l’historique.', 'Supprimer', true))) return;
    try { await api(`/api/events/${e.id}`, { method: 'DELETE' }); invalidate(); toast('Date supprimée.'); navigate('/'); } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-reschedule]', m)?.addEventListener('click', () => rescheduleModal(e));
  $$('[data-revert]', m).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Revenir en arrière ?', 'La fiche reprendra l’état qu’elle avait juste avant cette modification.', 'Revenir en arrière'))) return;
    try { await api(`/api/history/${b.dataset.revert}/revert`, { method: 'POST', body: {} }); invalidate(); toast('Version restaurée.'); eventView(id); } catch (err) { toast(err.message, 'error'); }
  }));
}

function rescheduleModal(e) {
  openModal({
    title: 'Reporter la date',
    body: html`<p class="small muted">La date actuelle sera annulée (barrée) et une nouvelle date sera créée avec la mention « reporté du ${longDate(e.starts_at)} ».</p>
      <div class="grid-2">
        <label class="field"><span>Nouvelle date <span class="req">*</span></span><input class="input" type="date" name="date" required></label>
        <label class="field"><span>Heure <span class="req">*</span></span><input class="input" type="time" name="time" value="${timeInput(e.starts_at)}" required></label>
      </div>
      <label class="field" style="margin-top:12px"><span>Heure de fin</span><input class="input" type="time" name="end" value="${e.ends_at ? timeInput(e.ends_at) : ''}"></label>
      <p class="error-text" data-err></p>`,
    foot: html`<button class="btn ghost" data-close>Retour</button><button class="btn primary" data-ok>Reporter</button>`,
    onMount(d, close) {
      d.querySelector('[data-ok]').addEventListener('click', async () => {
        const date = d.querySelector('[name=date]').value; const time = d.querySelector('[name=time]').value; const end = d.querySelector('[name=end]').value;
        if (!date || !time) { d.querySelector('[data-err]').textContent = 'Indiquez la nouvelle date et l’heure.'; return; }
        const starts = parisDate(date, time);
        let ends = null;
        if (end) { ends = parisDate(date, end); if (ends < starts) ends = parisDate(addDays(date, 1), end); }
        try {
          const r = await api(`/api/events/${e.id}/reschedule`, { method: 'POST', body: { starts_at: starts.toISOString(), ends_at: ends?.toISOString() || null } });
          invalidate(); close(); toast('Date reportée.'); navigate(`/evenement/${r.id}`);
        } catch (err) { d.querySelector('[data-err]').textContent = err.message; }
      });
    },
  });
}
