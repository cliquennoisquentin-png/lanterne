// Lanterne — formulaire de saisie (fiche rapide), lieux partagés, autocomplétion d'adresse
import { html, raw, esc, $, $$, icon, lantern, api, toast, parisDate, dayKey, timeInput, timeHM, addDays, eventDays, keyLabel, TYPES, VIS, STATUS, readImage, debounce, fold } from './lib.js';
import { state, isMember, navigate, params, loadVenues, loadAssos, loadEvents, invalidate, emptyState } from './core.js';

const main = () => document.getElementById('main');

// Recherche d'adresse : Géoplateforme (IGN), centrée sur Saint-Étienne
export async function searchAddress(q) {
  if (q.trim().length < 3) return [];
  const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&lat=45.4397&lon=4.3872`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.features || []).map((f) => ({
      label: f.properties.label, name: f.properties.name, city: f.properties.city, citycode: f.properties.citycode,
      postcode: f.properties.postcode, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    }));
  } catch { return []; }
}

// Champ d'adresse avec suggestions ; onPick reçoit l'adresse choisie
export function bindAddressField(input, listEl, onPick) {
  let items = [];
  let hl = -1;
  const close = () => { listEl.hidden = true; hl = -1; };
  const render = () => {
    listEl.innerHTML = String(html`${items.map((it, i) => html`<button type="button" data-i="${i}" class="${i === hl ? 'hl' : ''}">${it.name}<span class="sub">${it.postcode} ${it.city}</span></button>`)}`);
    listEl.hidden = !items.length;
  };
  const run = debounce(async () => { items = await searchAddress(input.value); hl = -1; render(); }, 280);
  input.addEventListener('input', () => { onPick(null); run(); });
  input.addEventListener('keydown', (ev) => {
    if (listEl.hidden) return;
    if (ev.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); render(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { hl = Math.max(0, hl - 1); render(); ev.preventDefault(); }
    if (ev.key === 'Enter' && hl >= 0) { ev.preventDefault(); pick(items[hl]); }
    if (ev.key === 'Escape') close();
  });
  const pick = (it) => { input.value = it.label; onPick(it); close(); };
  listEl.addEventListener('mousedown', (ev) => ev.preventDefault());
  listEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-i]'); if (b) pick(items[Number(b.dataset.i)]); });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

// Petite fenêtre « ajouter un lieu »
export function venueCreator(container, initialName, onCreated) {
  container.innerHTML = String(html`<div class="card" style="background:var(--surface-2);margin-top:10px">
    <h3>Nouveau lieu</h3>
    <div class="stack">
      <label class="field"><span>Nom du lieu <span class="req">*</span></span><input class="input" name="v_name" value="${initialName}" maxlength="120" placeholder="Le Fil, MJC de Beaubrun, bar Le…"></label>
      <div class="field combo"><span class="field-label">Adresse</span>
        <input class="input" name="v_addr" autocomplete="off" placeholder="Commencez à taper l’adresse…">
        <div class="combo-list" data-addr-list hidden></div>
        <p class="hint">Choisissez dans la liste si possible. Sinon, tapez l’adresse complète : nous la placerons sur la carte.</p></div>
      <label class="field"><span>Quartier (facultatif)</span><input class="input" name="v_district" maxlength="80" placeholder="Jacquard, Crêt de Roch, Bellevue…"></label>
      <p class="error-text" data-v-err></p>
      <div class="row"><button type="button" class="btn primary small" data-v-save>Ajouter ce lieu</button><button type="button" class="btn ghost small" data-v-cancel>Annuler</button></div>
    </div></div>`);
  let picked = null;
  bindAddressField($('[name=v_addr]', container), $('[data-addr-list]', container), (it) => { picked = it; });
  $('[data-v-cancel]', container).addEventListener('click', () => { container.innerHTML = ''; });
  $('[data-v-save]', container).addEventListener('click', async () => {
    const name = $('[name=v_name]', container).value.trim();
    if (!name) { $('[data-v-err]', container).textContent = 'Indiquez le nom du lieu.'; return; }
    const addrText = $('[name=v_addr]', container).value.trim();
    const body = {
      name, district: $('[name=v_district]', container).value.trim(),
      address: picked ? picked.label : addrText, city: picked?.city || '', citycode: picked?.citycode || '',
      lat: picked?.lat ?? null, lng: picked?.lng ?? null,
    };
    try {
      const { venue } = await api('/api/venues', { method: 'POST', body });
      await loadVenues(true);
      container.innerHTML = '';
      onCreated(venue);
      if (venue.lat == null) {
        toast(addrText ? 'Lieu ajouté, mais l’adresse n’a pas été trouvée : il ne sera pas sur la carte. Un administrateur pourra la corriger.'
          : 'Lieu ajouté sans adresse : il ne sera pas sur la carte.', 'error');
      }
    } catch (err) { $('[data-v-err]', container).textContent = err.message; }
  });
  $('[name=v_name]', container).focus();
}

export async function eventForm(id = null) {
  if (!isMember()) {
    main().innerHTML = String(emptyState(state.user ? 'Votre entité doit être validée avant de poser des dates.' : 'Connectez-vous avec votre entité (association, lieu, bar…) pour poser une date.',
      !state.user ? html`<a class="btn primary" href="/connexion">Se connecter</a>` : ''));
    return;
  }
  main().innerHTML = '<div class="spinner"></div>';
  const p = params();
  const copyId = p.get('copie');
  let src = null;
  try {
    await Promise.all([loadVenues(), loadAssos()]);
    if (id || copyId) src = (await api(`/api/events/${id || copyId}`)).event;
  } catch (e) { main().innerHTML = String(emptyState(e.message)); return; }
  const editing = !!id;
  const orgs = src ? (typeof src.orgs === 'string' ? JSON.parse(src.orgs) : src.orgs) : [];
  const ownerId = editing ? src.association_id : state.user.association.id;
  const v = {
    title: src?.title || '',
    date: editing ? dayKey(src.starts_at) : (copyId ? '' : (p.get('date') || '')),
    time: src ? timeInput(src.starts_at) : '20:00',
    end: src?.ends_at ? timeInput(src.ends_at) : '',
    endDate: src?.ends_at && editing && dayKey(src.ends_at) !== dayKey(src.starts_at) && (new Date(src.ends_at) - new Date(src.starts_at)) > 18 * 3600e3 ? dayKey(src.ends_at) : '',
    venue_id: src?.venue_id || null,
    category_id: src?.category_id || '',
    type: src?.type || 'public',
    status: editing ? src.status : 'option',
    visibility: src?.visibility || 'public',
    description: src?.description || '',
    link: src?.link || '',
    price: src?.price || '',
    image_id: src?.image_id || null,
    coorgs: orgs.map((o) => o.id).filter((x) => x !== ownerId),
  };
  if (v.status === 'annule' && !editing) v.status = 'option';
  const venue = state.venues.find((x) => x.id === v.venue_id);
  const others = state.assos.filter((a) => a.id !== ownerId);
  const radio = (name, value, label, extra = '') => html`<label class="choice"><input type="radio" name="${name}" value="${value}" ${v[name] === value ? 'checked' : ''}>${extra}${label}</label>`;

  main().innerHTML = String(html`<div class="narrow">
    <div class="page-head"><h1>${editing ? 'Modifier la date' : copyId ? 'Dupliquer la date' : 'Nouvelle date'}</h1></div>
    ${copyId ? html`<p class="notice info small">Copie de « ${src.title} ». Choisissez la nouvelle date.</p>` : ''}
    <form class="card stack" data-form novalidate>
      <label class="field"><span>Titre <span class="req">*</span></span><input class="input" name="title" value="${v.title}" maxlength="160" required placeholder="Concert de rentrée, AG annuelle…"></label>
      <div class="grid-2">
        <label class="field"><span>Date <span class="req">*</span></span><input class="input mono" type="date" name="date" value="${v.date}" required></label>
        <div class="grid-2" style="gap:10px">
          <label class="field"><span>Heure <span class="req">*</span></span><input class="input mono" type="time" name="time" value="${v.time}" required></label>
          <label class="field"><span>Fin</span><input class="input mono" type="time" name="end" value="${v.end}"></label>
        </div>
      </div>
      <div data-day-busy aria-live="polite"></div>
      <div class="field combo"><span class="field-label">Lieu <span class="req" style="color:var(--accent-text)">*</span></span>
        <input class="input" name="venue_q" autocomplete="off" value="${venue ? `${venue.name}${venue.city ? ` · ${venue.city}` : ''}` : ''}" placeholder="Chercher une salle, un bar, une MJC…" role="combobox" aria-expanded="false" aria-autocomplete="list">
        <div class="combo-list" data-venue-list hidden role="listbox"></div>
        <div data-venue-new></div>
      </div>
      <label class="field"><span>Catégorie <span class="req">*</span></span>
        <select class="input" name="category_id" required><option value="">Choisir…</option>
          ${state.categories.filter((c) => c.active || c.id === v.category_id).map((c) => html`<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${c.name}</option>`)}</select></label>
      <fieldset class="fs"><legend class="field-label">Type</legend>
        <div class="choice-row">${Object.entries(TYPES).map(([k, t]) => radio('type', k, t.label))}</div></fieldset>
      <fieldset class="fs"><legend class="field-label">Statut</legend>
        <div class="choice-row">${Object.entries(STATUS).filter(([k]) => k !== 'annule' || editing).map(([k, s]) => radio('status', k, s.label, icon(s.icon)))}</div>
        <p class="hint">Option : envisagée, elle prévient les autres très tôt · En cours : quasi sûre · Validé : confirmée.</p></fieldset>
      <fieldset class="fs"><legend class="field-label">Qui peut la voir ?</legend>
        <div class="choice-row">${Object.entries(VIS).map(([k, s]) => radio('visibility', k, s.label, icon(s.icon)))}</div>
        <p class="hint" data-vis-help>${VIS[v.visibility].help}</p></fieldset>

      <details class="more" ${v.description || v.link || v.price || v.image_id || v.coorgs.length || v.endDate ? 'open' : ''}>
        <summary>Plus de détails (facultatif)</summary>
        <div class="stack" style="margin-top:14px">
          <label class="field"><span>Se termine un autre jour (festival, week-end…)</span><input class="input mono" type="date" name="endDate" value="${v.endDate}"></label>
          <label class="field"><span>Description</span><textarea class="input" name="description" maxlength="5000">${v.description}</textarea></label>
          <div class="field"><span class="field-label">Visuel</span>
            <div class="row" data-image-row>${v.image_id ? html`<img src="/img/${v.image_id}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:10px">` : ''}
              <label class="btn small">${icon('image')}${v.image_id ? 'Changer' : 'Choisir une image'}<input type="file" accept="image/*" name="image" hidden></label>
              ${v.image_id ? html`<button type="button" class="btn small ghost" data-rm-image>Retirer</button>` : ''}</div></div>
          <div class="grid-2">
            <label class="field"><span>Lien (billetterie, Facebook…)</span><input class="input" name="link" value="${v.link}" inputmode="url" placeholder="https://"></label>
            <label class="field"><span>Tarif</span><input class="input" name="price" value="${v.price}" maxlength="120" placeholder="Gratuit, 5 €, prix libre…"></label>
          </div>
          <div class="field"><span class="field-label">Entités co-organisatrices</span>
            ${others.length ? html`<input class="input" data-coorg-q placeholder="Filtrer les entités…" style="margin-bottom:8px">
            <div class="choice-row" data-coorgs style="max-height:220px;overflow:auto">${others.map((a) => html`<label class="choice" data-name="${a.name.toLowerCase()}"><input type="checkbox" name="coorgs" value="${a.id}" ${v.coorgs.includes(a.id) ? 'checked' : ''}><span class="dot" style="--c:${a.color}"></span>${a.name}</label>`)}</div>
            <p class="hint">La date apparaîtra dans leur agenda et leurs membres pourront la modifier.</p>` : html`<p class="hint">Aucune autre entité inscrite pour l’instant.</p>`}
          </div>
        </div>
      </details>
      <p class="error-text" data-err role="alert"></p>
      <div class="row"><button class="btn primary" type="submit">${editing ? 'Enregistrer' : 'Poser la date'}</button><a class="btn ghost" href="${editing ? `/evenement/${id}` : '/'}">Annuler</a></div>
    </form></div>`);

  const form = $('[data-form]');
  let venueId = v.venue_id;
  let image; // undefined = inchangé, null = retiré, dataURL = nouveau
  form.querySelector('[name=title]').focus();
  if (!v.date) form.querySelector('[name=date]').focus();

  // Visibilité : aide contextuelle ; une réunion interne n'est jamais publique
  const syncVis = () => {
    const type = form.querySelector('[name=type]:checked').value;
    const pub = form.querySelector('[name=visibility][value=public]');
    pub.disabled = type === 'internal';
    pub.closest('.choice').style.opacity = type === 'internal' ? '.4' : '';
    if (type === 'internal' && pub.checked) form.querySelector('[name=visibility][value=associations]').checked = true;
    if (form.querySelector('[name=status]:checked').value === 'option' && form.querySelector('[name=visibility]:checked').value === 'public') {
      $('[data-vis-help]').textContent = `${VIS.public.help} Tant qu’elle est en option, elle n’apparaît pas sur la version publique.`;
    } else $('[data-vis-help]').textContent = VIS[form.querySelector('[name=visibility]:checked').value].help;
  };
  form.addEventListener('change', (ev) => { if (['type', 'visibility', 'status'].includes(ev.target.name)) syncVis(); });
  syncVis();

  // Ce qui est déjà posé ce jour-là : on le voit avant de valider (c'est tout l'intérêt de Lanterne)
  const busyBox = $('[data-day-busy]');
  let busyList = null; let busySeq = 0;
  const renderBusy = () => {
    if (!busyBox.isConnected) return;
    const date = form.querySelector('[name=date]').value;
    if (!busyList) { busyBox.innerHTML = ''; return; }
    if (!busyList.length) { busyBox.innerHTML = String(html`<p class="day-free">${lantern('var(--accent)')}La place est libre le ${keyLabel(date)}.</p>`); return; }
    const same = busyList.filter((e) => venueId && e.venue_id === venueId);
    busyBox.innerHTML = String(html`<div class="notice ${same.length ? 'warn' : 'info'} day-busy">
      <p><b>Déjà ${busyList.length} date${busyList.length > 1 ? 's' : ''} le ${keyLabel(date)}</b>${same.length ? html` — dont ${same.length} au même lieu` : ''}</p>
      <ul>${busyList.slice(0, 6).map((e) => html`<li class="${venueId && e.venue_id === venueId ? 'same' : ''}"><span class="dot" style="--c:${e.asso_color}"></span><span class="mono">${timeHM(e.starts_at)}</span>
        <span><a href="/evenement/${e.id}" target="_blank" rel="noopener">${e.title}</a> · ${e.asso_name}${e.venue_name ? ` · ${e.venue_name}` : ''}${e.status === 'option' ? ' · en option' : ''}</span></li>`)}</ul>
      ${busyList.length > 6 ? html`<p class="small faint">et ${busyList.length - 6} autre${busyList.length > 7 ? 's' : ''}…</p>` : ''}
    </div>`);
  };
  const loadBusy = async () => {
    const date = form.querySelector('[name=date]').value;
    const seq = ++busySeq;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { busyList = null; renderBusy(); return; }
    try {
      const events = await loadEvents(parisDate(date), parisDate(addDays(date, 1)));
      if (seq !== busySeq) return; // la date a changé entre-temps
      busyList = events.filter((e) => e.id !== id && e.status !== 'annule' && eventDays(e).includes(date))
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    } catch { if (seq === busySeq) busyList = null; } // hors ligne : pas d'avertissement, la saisie reste possible
    renderBusy();
  };
  form.querySelector('[name=date]').addEventListener('change', loadBusy);
  loadBusy();

  // Lieux : autocomplétion sur la liste partagée
  const vq = form.querySelector('[name=venue_q]');
  const vl = $('[data-venue-list]');
  let hl = -1; let items = [];
  const norm = fold;
  const renderVenues = () => {
    const q = norm(vq.value.trim());
    items = state.venues.filter((x) => !x.archived && (!q || norm(`${x.name} ${x.city} ${x.district} ${x.address}`).includes(q))).slice(0, 8);
    vl.innerHTML = String(html`${items.map((x, i) => html`<button type="button" role="option" data-v="${x.id}" class="${i === hl ? 'hl' : ''}">${x.name}<span class="sub">${[x.district, x.address || x.city].filter(Boolean).join(' · ')}</span></button>`)}
      ${vq.value.trim() ? html`<button type="button" data-new>${icon('plus')} Ajouter « ${vq.value.trim()} » comme nouveau lieu</button>` : html`<button type="button" data-new>${icon('plus')} Ajouter un nouveau lieu</button>`}`);
    vl.hidden = false; vq.setAttribute('aria-expanded', 'true');
  };
  const closeVenues = () => { vl.hidden = true; vq.setAttribute('aria-expanded', 'false'); hl = -1; };
  const pickVenue = (x) => { venueId = x.id; vq.value = `${x.name}${x.city ? ` · ${x.city}` : ''}`; closeVenues(); renderBusy(); };
  const openNew = () => { closeVenues(); venueCreator($('[data-venue-new]'), vq.value.trim(), (venue) => pickVenue(venue)); };
  vq.addEventListener('focus', renderVenues);
  vq.addEventListener('input', () => { venueId = null; hl = -1; renderVenues(); renderBusy(); });
  vq.addEventListener('keydown', (ev) => {
    if (vl.hidden) return;
    if (ev.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); renderVenues(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { hl = Math.max(0, hl - 1); renderVenues(); ev.preventDefault(); }
    if (ev.key === 'Enter') { ev.preventDefault(); if (hl >= 0) pickVenue(items[hl]); else if (items.length === 1) pickVenue(items[0]); else openNew(); }
    if (ev.key === 'Escape') closeVenues();
  });
  vq.addEventListener('blur', () => setTimeout(closeVenues, 160));
  vl.addEventListener('mousedown', (ev) => ev.preventDefault());
  vl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.new !== undefined) openNew(); else pickVenue(state.venues.find((x) => x.id === Number(b.dataset.v)));
  });

  // Visuel
  form.querySelector('[name=image]').addEventListener('change', async (ev) => {
    try {
      image = await readImage(ev.target.files[0], { max: 1600 });
      const row = $('[data-image-row]');
      row.querySelector('img')?.remove();
      row.insertAdjacentHTML('afterbegin', `<img src="${image}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:10px">`);
    } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-rm-image]')?.addEventListener('click', (ev) => { image = null; $('[data-image-row] img')?.remove(); ev.target.remove(); });
  $('[data-coorg-q]')?.addEventListener('input', (ev) => {
    const q = ev.target.value.toLowerCase();
    $$('[data-coorgs] .choice').forEach((c) => { c.hidden = q && !c.dataset.name.includes(q); });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const err = $('[data-err]');
    const date = f.get('date'); const time = f.get('time');
    if (!f.get('title').trim()) return (err.textContent = 'Le titre est obligatoire.');
    if (!date || !time) return (err.textContent = 'La date et l’heure sont obligatoires.');
    if (!venueId) return (err.textContent = 'Choisissez un lieu dans la liste (ou ajoutez-en un).');
    if (!f.get('category_id')) return (err.textContent = 'La catégorie est obligatoire.');
    const starts = parisDate(date, time);
    let ends = null;
    const end = f.get('end'); const endDate = f.get('endDate');
    if (endDate || end) {
      ends = parisDate(endDate || date, end || (endDate ? '23:59' : time));
      if (!endDate && ends < starts) ends = parisDate(addDays(date, 1), end); // soirée qui finit après minuit
      if (ends < starts) return (err.textContent = 'La fin doit venir après le début.');
    }
    const body = {
      title: f.get('title'), starts_at: starts.toISOString(), ends_at: ends?.toISOString() || null, venue_id: venueId,
      category_id: Number(f.get('category_id')), type: f.get('type'), status: f.get('status'), visibility: f.get('visibility'),
      description: f.get('description') || '', link: f.get('link') || '', price: f.get('price') || '',
      coorgs: f.getAll('coorgs').map(Number),
    };
    if (image !== undefined) body.image = image;
    else if (copyId && v.image_id) body.image_id_copy = v.image_id;
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; err.textContent = '';
    try {
      const r = await api(editing ? `/api/events/${id}` : '/api/events', { method: editing ? 'PUT' : 'POST', body });
      invalidate();
      toast(editing ? 'Modifications enregistrées.' : 'Date posée. Votre lanterne est allumée !');
      navigate(`/evenement/${r.id}`);
    } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
  });
}
