// Lanterne — événements du territoire : ceux de l'Office de tourisme de Saint-Étienne et des offices voisins,
// publiés en open data par DATAtourisme. On les consulte pour ne pas poser une date le même soir qu'un grand événement.
import { html, $, $$, icon, todayKey, addDays, keyLabel, fmt, fold, debounce } from './lib.js';
import { params, loadTourism, occursOn, emptyState } from './core.js';

const main = () => document.getElementById('main');
const shortDay = (k) => keyLabel(k, { day: 'numeric', month: 'short' });

// « Le 27 nov. », « Du 26 au 28 nov. », « Jusqu'au 31 déc. »
function whenText(p, today) {
  if (p.start === p.end) return `Le ${keyLabel(p.start, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  if (p.start <= today) return `Jusqu’au ${shortDay(p.end)}`;
  return `Du ${shortDay(p.start)} au ${shortDay(p.end)}`;
}

function card(e, today, day) {
  const p = (day && e.periods.find((x) => x.start <= day && day <= x.end)) || e.next;
  const others = e.periods.length - 1;
  const place = [e.address, [e.postcode, e.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return html`<article class="tcard">
    <div class="tcard-when mono">${whenText(p, today)}${others > 0 ? html`<span class="faint"> · +${others} autre${others > 1 ? 's' : ''} date${others > 1 ? 's' : ''}</span>` : ''}</div>
    <h3 class="tcard-title">${e.title}</h3>
    <div class="ev-meta">
      ${place ? html`<span>${icon('pin')}${place}</span>` : ''}
      ${e.kinds.map((k) => html`<span class="tag">${k}</span>`)}
    </div>
    ${e.description ? html`<p class="tcard-desc">${e.description}</p>` : ''}
    <div class="tcard-foot">
      <span class="small faint">${e.publisher ? `Publié par ${e.publisher}` : ''}</span>
      <span class="spacer"></span>
      ${e.website ? html`<a class="btn small ghost" href="${e.website}" target="_blank" rel="noopener nofollow">${icon('link')}Site</a>` : ''}
      ${e.lat != null ? html`<a class="btn small ghost" href="https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=16/${e.lat}/${e.lng}" target="_blank" rel="noopener">${icon('map')}Plan</a>` : ''}
    </div>
  </article>`;
}

export async function territoryView() {
  const p = params();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.get('jour') || '') ? p.get('jour') : null;
  const today = todayKey();
  let query = (p.get('q') || '').trim().slice(0, 100);
  let range = ['semaine', 'mois', 'tout'].includes(p.get('periode')) ? p.get('periode') : 'mois';
  let city = p.get('commune') || '';
  let showOngoing = p.get('continu') === '1';

  main().innerHTML = String(html`<div class="page-head"><h1>Événements du territoire</h1><span class="spacer"></span>
      <a class="btn ghost" href="${day ? `/?mois=${day.slice(0, 7)}&jour=${day}` : '/'}">${icon('calendar')}Retour à l’agenda</a></div>
    <p class="muted small territory-intro">Les fêtes, concerts, spectacles, marchés… publiés par l’Office de tourisme de Saint-Étienne et les offices de tourisme alentour.
      Pratique pour ne pas poser une date le même soir qu’un grand événement.</p>
    <div data-territory><div class="spinner"></div></div>`);

  let data;
  try { data = await loadTourism(); } catch (err) {
    $('[data-territory]').innerHTML = String(emptyState(`Les événements du territoire n’ont pas pu être chargés (${err.message}). Réessayez dans un moment.`));
    return;
  }
  const box = $('[data-territory]');
  if (!box) return;
  const all = data.events || [];
  const cities = [...all.reduce((m, e) => (e.city ? m.set(e.city, (m.get(e.city) || 0) + 1) : m), new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));

  box.innerHTML = String(html`
    ${day ? html`<div class="notice info territory-day">${icon('calendar')}<span>Ce qui se passe le <b>${keyLabel(day)}</b>.</span>
      <a class="btn small ghost" href="/territoire" data-all-days>Voir toutes les dates</a></div>` : ''}
    <div class="row list-tools">
      ${day ? '' : html`<div class="segmented" role="group" aria-label="Période">
        <button type="button" data-range="semaine">7 jours</button><button type="button" data-range="mois">30 jours</button><button type="button" data-range="tout">Tout</button></div>`}
      <label class="search-field">${icon('search')}<input class="input" type="search" data-q value="${query}" maxlength="100" enterkeyhint="search"
        placeholder="Chercher un événement, un lieu…" aria-label="Chercher dans les événements du territoire"></label>
      <select class="input territory-city" data-city aria-label="Commune">
        <option value="">Toutes les communes</option>
        ${cities.map(([c, n]) => html`<option value="${c}" ${c === city ? 'selected' : ''}>${c} (${n})</option>`)}
      </select>
      <label class="choice"><input type="checkbox" data-ongoing ${showOngoing ? 'checked' : ''}>Marchés et événements en continu</label>
    </div>
    <p class="small faint list-count" data-count aria-live="polite"></p>
    <div class="narrow" data-tlist></div>
    <p class="small faint territory-source">Source : <a href="${data.source?.url || '#'}" target="_blank" rel="noopener">${data.source?.name || 'DATAtourisme'}</a>
      (${data.source?.license || 'Licence Ouverte'}), données publiées par les offices de tourisme.
      ${data.updated_at ? `Mise à jour : ${fmt(data.updated_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.` : ''}
      ${data.stale ? 'La source ne répond pas en ce moment : voici la dernière liste connue.' : ''}</p>`);

  const draw = () => {
    const list = $('[data-tlist]');
    if (!list) return;
    $$('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    const limit = range === 'semaine' ? addDays(today, 7) : range === 'mois' ? addDays(today, 31) : '9999-12-31';
    const words = fold(query).split(/\s+/).filter(Boolean);
    const match = (e) => {
      if (city && e.city !== city) return false;
      if (day ? !occursOn(e, day) : e.next.start > limit) return false;
      if (!words.length) return true;
      const h = fold(`${e.title} ${e.city} ${e.address} ${e.kinds.join(' ')} ${e.description} ${e.publisher}`);
      return words.every((w) => h.includes(w));
    };
    const found = all.filter(match);
    const punctual = found.filter((e) => !e.ongoing);
    const ongoing = found.filter((e) => e.ongoing);
    $('[data-count]').textContent = `${punctual.length} événement${punctual.length > 1 ? 's' : ''}${ongoing.length ? ` · ${ongoing.length} marché${ongoing.length > 1 ? 's' : ''} ou événement${ongoing.length > 1 ? 's' : ''} en continu${showOngoing ? '' : ' (masqués)'}` : ''}`;

    // Regroupés par jour : la prochaine date (ou aujourd'hui pour ce qui a déjà commencé)
    const groups = new Map();
    for (const e of punctual) {
      const k = day || (e.next.start < today ? today : e.next.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const keys = [...groups.keys()].sort();
    list.innerHTML = String(html`
      ${keys.length ? keys.map((k) => html`<section class="list-day">
        <div class="list-date ${k === today ? 'today' : ''}"><div class="w">${keyLabel(k, { weekday: 'short' })}</div><div class="d">${Number(k.slice(8))}</div><div class="m">${keyLabel(k, { month: 'short' })}</div></div>
        <div class="list-events">${groups.get(k).map((e) => card(e, today, day))}</div></section>`)
      : emptyState(day ? 'Aucun événement publié par les offices de tourisme ce jour-là.' : 'Aucun événement avec ces critères.')}
      ${showOngoing && ongoing.length ? html`<h2 class="territory-ongoing-title">En continu</h2>
        <p class="small faint">Marchés hebdomadaires, expositions et événements qui durent plusieurs semaines.</p>
        <div class="list-events">${ongoing.map((e) => card(e, today, day))}</div>` : ''}`);

    const u = new URLSearchParams();
    if (day) u.set('jour', day);
    if (!day && range !== 'mois') u.set('periode', range);
    if (query) u.set('q', query);
    if (city) u.set('commune', city);
    if (showOngoing) u.set('continu', '1');
    const s = u.toString();
    history.replaceState({}, '', `/territoire${s ? `?${s}` : ''}`);
  };
  draw();
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; draw(); }));
  $('[data-q]').addEventListener('input', debounce((ev) => { query = ev.target.value.trim(); draw(); }, 120));
  $('[data-city]').addEventListener('change', (ev) => { city = ev.target.value; draw(); });
  $('[data-ongoing]').addEventListener('change', (ev) => { showOngoing = ev.target.checked; draw(); });
}

// Petit compteur pour le bouton du calendrier : événements ponctuels du territoire un jour donné
export async function territoryCount(day) {
  const data = await loadTourism();
  return (data.events || []).filter((e) => !e.ongoing && occursOn(e, day)).length;
}

