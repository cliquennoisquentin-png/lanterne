// Lanterne — annuaire des entités, profils, inscription, connexion, compte, administration, mentions légales
import { html, raw, esc, $, $$, icon, api, toast, fmt, logo, assoLogo, readImage, copyText, statusBadge, longDate, fold } from './lib.js';
import {
  state, isMember, isAdmin, navigate, params, loadAssos, loadVenues, loadEvents, refreshMe, invalidate, eventCard, emptyState,
  openModal, confirmBox, openSubscribe, kindInfo, kindBadge,
} from './core.js';
import { bindAddressField } from './views-form.js';

const main = () => document.getElementById('main');

const SOCIALS = { facebook: 'Facebook', instagram: 'Instagram', mastodon: 'Mastodon', bluesky: 'Bluesky', tiktok: 'TikTok', youtube: 'YouTube', helloasso: 'HelloAsso' };

// Les mots qui changent selon ce qu'est l'entité (le reste du site dit simplement « entité »)
const KIND_WORDS = {
  association: { name: 'Nom de l’association', section: 'L’association', title: 'Inscrire mon association' },
  collectif: { name: 'Nom du collectif ou du festival', section: 'Le collectif', title: 'Inscrire mon collectif' },
  lieu: { name: 'Nom du lieu', section: 'Le lieu', title: 'Inscrire mon lieu' },
  bar: { name: 'Nom du bar, café ou restaurant', section: 'L’établissement', title: 'Inscrire mon établissement' },
  entreprise: { name: 'Nom de l’entreprise ou du commerce', section: 'L’entreprise', title: 'Inscrire mon entreprise' },
  institution: { name: 'Nom de la structure', section: 'La structure', title: 'Inscrire ma structure' },
  autre: { name: 'Nom', section: 'Votre entité', title: 'Inscrire mon entité' },
};
const words = (kind) => KIND_WORDS[kind] || KIND_WORDS.autre;

function swatches(selected) {
  return html`<div class="swatches" role="radiogroup" aria-label="Couleur de l’entité">${state.palette.map((p) => html`<button type="button" class="swatch" role="radio" aria-checked="${p.hex === selected ? 'true' : 'false'}" style="--c:${p.hex}" data-color="${p.hex}" title="${p.name}" aria-label="${p.name}">${icon('check')}</button>`)}</div>`;
}
function bindSwatches(root, onPick) {
  $$('.swatch', root).forEach((s) => s.addEventListener('click', () => {
    $$('.swatch', root).forEach((x) => x.setAttribute('aria-checked', 'false'));
    s.setAttribute('aria-checked', 'true');
    onPick(s.dataset.color);
  }));
}

// =====================================================================
// ANNUAIRE DES ENTITÉS
// =====================================================================
export async function directoryView() {
  main().innerHTML = '<div class="spinner"></div>';
  const assos = await loadAssos(true);
  const kindOfA = (a) => a.kind || 'association';
  const counts = new Map();
  for (const a of assos) counts.set(kindOfA(a), (counts.get(kindOfA(a)) || 0) + 1);
  let kind = counts.has(params().get('type')) ? params().get('type') : '';
  let query = '';
  main().innerHTML = String(html`<div class="page-head"><h1>Les entités</h1><span class="spacer"></span>
      ${!state.user?.association ? html`<a class="btn primary" href="/inscription">${icon('plus')}Inscrire mon entité</a>` : ''}</div>
    <p class="muted small directory-intro">Associations, collectifs, lieux, bars, commerces, institutions : tous ceux qui posent leurs dates sur Lanterne.
      <a href="/mode-d-emploi">Comment ça marche ?</a></p>
    ${assos.length ? html`
      <label class="search-field" style="max-width:420px;margin-bottom:12px">${icon('search')}<input class="input" type="search" data-q placeholder="Chercher une entité, une commune…" aria-label="Chercher une entité"></label>
      ${counts.size > 1 ? html`<div class="kind-chips" role="group" aria-label="Type d’entité">
        <button type="button" data-kind="">Toutes <span class="n">${assos.length}</span></button>
        ${state.kinds.filter((k) => counts.has(k.id)).map((k) => html`<button type="button" data-kind="${k.id}">${icon(k.icon)}${k.label} <span class="n">${counts.get(k.id)}</span></button>`)}
      </div>` : ''}
      <div class="assos">${assos.map((a) => html`<a class="asso-card" style="--c:${a.color}" href="/entites/${a.slug}" data-kind="${kindOfA(a)}"
        data-name="${fold(`${a.name} ${a.commune} ${kindInfo(kindOfA(a)).label}`)}">
        ${assoLogo(a)}<div style="min-width:0"><div class="asso-name">${a.name}</div>
        <div class="small faint">${a.commune || 'Saint-Étienne Métropole'}${a.upcoming_public ? ` · ${a.upcoming_public} date${a.upcoming_public > 1 ? 's' : ''} à venir` : ''}</div>
        ${kindBadge(kindOfA(a))}</div></a>`)}</div>
      <div data-none hidden>${emptyState('Aucune entité ne correspond.')}</div>`
    : emptyState('Aucune entité pour l’instant. Soyez la première à allumer sa lanterne !', html`<a class="btn primary" href="/inscription">Inscrire mon entité</a>`)}`);
  const apply = () => {
    let shown = 0;
    $$('.asso-card').forEach((c) => {
      c.hidden = (kind && c.dataset.kind !== kind) || (query && !query.split(/\s+/).every((w) => c.dataset.name.includes(w)));
      if (!c.hidden) shown++;
    });
    $$('[data-kind]', $('.kind-chips') || document.createElement('div')).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    const none = $('[data-none]'); if (none) none.hidden = shown > 0;
    history.replaceState({}, '', `/entites${kind ? `?type=${kind}` : ''}`);
  };
  $('[data-q]')?.addEventListener('input', (ev) => { query = fold(ev.target.value.trim()); apply(); });
  $$('.kind-chips [data-kind]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; apply(); }));
  if (assos.length) apply();
}

// =====================================================================
// PAGE D'UNE ENTITÉ
// =====================================================================
export async function profileView(slug) {
  main().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await api(`/api/associations/${encodeURIComponent(slug)}`); } catch (e) { main().innerHTML = String(emptyState(e.message)); return; }
  const a = data.association;
  const socials = typeof a.socials === 'string' ? JSON.parse(a.socials) : (a.socials || {});
  const now = new Date();
  let events = [];
  if (a.status === 'approved') {
    events = await loadEvents(new Date(now.getTime() - 3 * 365 * 864e5), new Date(now.getTime() + 400 * 864e5), `asso=${a.id}`);
  }
  const upcoming = events.filter((e) => new Date(e.ends_at || e.starts_at) >= now);
  const past = events.filter((e) => new Date(e.ends_at || e.starts_at) < now).reverse();
  const mine = state.user?.association?.id === a.id;

  main().innerHTML = String(html`<div class="narrow">
    <p><a href="/entites" class="small">${icon('chevL', '')} Toutes les entités</a></p>
    <div class="profile-head">${assoLogo(a, 'asso-logo big')}<div style="flex:1;min-width:0">
      <h1>${a.name}</h1>
      <div class="row small muted">${kindBadge(a.kind)}<span><span class="dot" style="--c:${a.color}"></span> ${a.commune || 'Saint-Étienne Métropole'}</span>
        ${a.status !== 'approved' ? html`<span class="status option">${a.status === 'pending' ? 'En attente de validation' : 'Refusée'}</span>` : ''}</div></div>
      ${data.can_edit ? html`<button class="btn" data-edit>${icon('edit')}Modifier le profil</button>` : ''}
    </div>
    ${a.description ? html`<div class="card desc">${a.description}</div>` : ''}
    <div class="card"><h2>Contacts</h2><div class="stack small">
      ${a.contact_email ? html`<div class="row">${icon('mail', '')}<a href="mailto:${a.contact_email}">${a.contact_email}</a></div>` : ''}
      ${a.phone ? html`<div class="row">${icon('phone', '')}<a href="tel:${a.phone.replace(/\s/g, '')}">${a.phone}</a></div>` : ''}
      ${a.website ? html`<div class="row">${icon('globe', '')}<a href="${a.website}" target="_blank" rel="noopener">${a.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div>` : ''}
      ${Object.keys(socials).length ? html`<div class="links">${Object.entries(socials).map(([k, u]) => html`<a class="btn small" href="${u}" target="_blank" rel="noopener">${SOCIALS[k] || k}</a>`)}</div>` : ''}
    </div></div>
    ${a.status === 'approved' ? html`
      <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0;flex:1">Prochaines dates</h2>
        <button class="btn small ghost" data-sub>${icon('rss')}S’abonner</button></div>
        ${upcoming.length ? html`<div class="list-events">${upcoming.map((e) => eventCard(e, { showDate: true }))}</div>` : html`<p class="small faint">Aucune date à venir.</p>`}</div>
      ${past.length ? html`<details class="card more"><summary>Archives (${past.length})</summary><div class="list-events" style="margin-top:12px">${past.slice(0, 200).map((e) => eventCard(e, { showDate: true }))}</div></details>` : ''}` : ''}
    ${data.members ? html`<div class="card"><h2>Membres</h2>
      <p class="small muted">Tous les membres ont les mêmes droits et publient librement.</p>
      <table class="table"><tbody>${data.members.map((m) => html`<tr><td>${m.name || '—'}</td><td class="faint">${m.email}</td>
        <td style="text-align:right">${isAdmin() && m.id !== state.user.id ? html`<button class="btn small ghost danger" data-rm-member="${m.id}">Retirer</button>` : ''}</td></tr>`)}</tbody></table>
      ${data.invitations?.length ? html`<p class="label" style="margin-top:16px">Invitations en attente</p>
        <table class="table"><tbody>${data.invitations.map((i) => html`<tr><td>${i.email}</td><td class="faint mono tiny">${fmt(i.created_at, { day: 'numeric', month: 'short' })}</td>
        <td style="text-align:right"><button class="btn small ghost" data-rm-inv="${i.id}">Retirer</button></td></tr>`)}</tbody></table>` : ''}
      ${mine && a.status === 'approved' ? html`<form data-invite class="stack" style="margin-top:16px">
        <label class="field"><span>Inviter des membres</span><textarea class="input" name="emails" rows="2" style="min-height:70px" placeholder="une ou plusieurs adresses mail, séparées par des virgules"></textarea>
          <span class="hint">Chacun reçoit un lien par mail. Vous verrez aussi ce lien, pour l’envoyer vous-même (SMS, WhatsApp…) si le mail n’arrive pas.</span></label>
        <div><button class="btn primary small">${icon('mail')}Inviter</button></div></form>` : ''}
      ${mine && a.status !== 'approved' ? html`<p class="small faint">Vous pourrez inviter vos membres dès que l’entité sera validée.</p>` : ''}
    </div>` : ''}
  </div>`);

  $('[data-sub]')?.addEventListener('click', () => openSubscribe({ scope: 'asso', asso: a.slug }));
  $('[data-edit]')?.addEventListener('click', () => editAssoModal(a, socials, () => profileView(slug)));
  $('[data-invite]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await api(`/api/associations/${a.id}/invitations`, { method: 'POST', body: { emails: ev.target.emails.value } });
      if (r.links?.length) inviteLinksModal(r, () => profileView(slug));
      else { toast(r.skipped.map((s) => `${s.email} : ${s.reason}`).join(' · ') || 'Rien à envoyer.', 'error'); profileView(slug); }
    } catch (err) { toast(err.message, 'error'); }
  });
  $$('[data-rm-inv]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/invitations/${b.dataset.rmInv}`, { method: 'DELETE' }); profileView(slug); } catch (err) { toast(err.message, 'error'); }
  }));
  $$('[data-rm-member]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Retirer ce membre ?', 'La personne ne pourra plus publier pour cette entité.', 'Retirer', true))) return;
    try { await api(`/api/admin/members/${b.dataset.rmMember}`, { method: 'DELETE' }); profileView(slug); } catch (err) { toast(err.message, 'error'); }
  }));
}

// Après une invitation : les liens, à copier pour les envoyer soi-même si le mail n'arrive pas
function inviteLinksModal(r, done) {
  openModal({
    title: `${r.links.length} invitation${r.links.length > 1 ? 's' : ''} prête${r.links.length > 1 ? 's' : ''}`,
    body: html`<p class="small muted">Un mail est parti${r.links.length > 1 ? ' à chacun' : ''}. S’il n’arrive pas, copiez le lien et envoyez-le vous-même (SMS, WhatsApp…).
      Il est personnel et valable 30 jours.</p>
      <div class="stack">${r.links.map((l, i) => html`<div><span class="field-label">${l.email}</span>
        <div class="copy-field"><input class="input" readonly value="${l.url}"><button class="btn" type="button" data-copy-link="${i}">${icon('copy')}Copier</button></div></div>`)}</div>
      ${r.skipped.length ? html`<p class="small faint" style="margin-top:12px">Non invités : ${r.skipped.map((s) => `${s.email} (${s.reason})`).join(', ')}.</p>` : ''}`,
    foot: html`<button class="btn primary" data-close>C’est noté</button>`,
    onMount(d) {
      $$('[data-copy-link]', d).forEach((b) => b.addEventListener('click', async () => {
        if (await copyText(r.links[Number(b.dataset.copyLink)].url)) toast('Lien d’invitation copié.');
      }));
      d.addEventListener('close', done);
    },
  });
}

function kindPicker(selected) {
  return html`<div class="field"><span class="field-label">Vous êtes…</span><div class="choice-row" role="radiogroup">
    ${state.kinds.map((k) => html`<label class="choice"><input type="radio" name="kind" value="${k.id}" ${k.id === selected ? 'checked' : ''}>${icon(k.icon)}${k.label}</label>`)}
  </div></div>`;
}

function assoFields(a = {}, socials = {}, kind = a.kind || 'association') {
  return html`<div class="stack">
    ${a.id ? kindPicker(kind) : ''}
    <label class="field"><span><span data-name-label>${words(kind).name}</span> <span class="req">*</span></span><input class="input" name="name" value="${a.name || ''}" maxlength="120" required></label>
    <div class="field"><span class="field-label">Logo</span><div class="row" data-logo-row>
      ${a.logo_id ? html`<img src="/img/${a.logo_id}" alt="" class="asso-logo">` : ''}
      <label class="btn small">${icon('image')}${a.logo_id ? 'Changer' : 'Choisir une image'}<input type="file" accept="image/*" name="logo" hidden></label></div></div>
    <div class="field"><span class="field-label">Couleur (vos lanternes sur le calendrier)</span>${swatches(a.color || state.palette[0]?.hex)}</div>
    <label class="field"><span>Présentation</span><textarea class="input" name="description" maxlength="2000" placeholder="Ce que vous faites, en quelques lignes">${a.description || ''}</textarea></label>
    <div class="grid-2">
      <label class="field"><span>Mail de contact <span class="req">*</span></span><input class="input" type="email" name="contact_email" value="${a.contact_email || ''}"></label>
      <label class="field"><span>Téléphone</span><input class="input" type="tel" name="phone" value="${a.phone || ''}"></label>
      <label class="field"><span>Site web</span><input class="input" name="website" value="${a.website || ''}" placeholder="https://"></label>
      <label class="field"><span>Commune</span><input class="input" name="commune" value="${a.commune || ''}" placeholder="Saint-Étienne, Firminy, Rive-de-Gier…"></label>
    </div>
    ${a.id ? html`<details class="more"><summary>Réseaux sociaux</summary><div class="grid-2" style="margin-top:12px">${Object.entries(SOCIALS).map(([k, label]) => html`<label class="field"><span>${label}</span><input class="input" name="s_${k}" value="${socials[k] || ''}" placeholder="https://"></label>`)}</div></details>` : ''}
  </div>`;
}
function bindAssoFields(root, a, holder) {
  holder.color = a.color || state.palette[0]?.hex;
  bindSwatches(root, (c) => { holder.color = c; });
  // Le libellé du nom suit le type choisi (« Nom du bar… », « Nom du lieu »…)
  root.addEventListener('change', (ev) => { if (ev.target.name === 'kind') $('[data-name-label]', root).textContent = words(ev.target.value).name; });
  $('[name=logo]', root).addEventListener('change', async (ev) => {
    try {
      holder.logo = await readImage(ev.target.files[0], { max: 512, type: 'image/png' });
      const row = $('[data-logo-row]', root);
      row.querySelector('img, .asso-logo')?.remove();
      row.insertAdjacentHTML('afterbegin', `<img src="${holder.logo}" alt="" class="asso-logo">`);
    } catch (err) { toast(err.message, 'error'); }
  });
}

function editAssoModal(a, socials, done) {
  const holder = {};
  openModal({
    title: 'Modifier le profil', wide: true, body: html`<form data-asso-form>${assoFields(a, socials)}<p class="error-text" data-err></p></form>`,
    foot: html`<button class="btn ghost" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button>`,
    onMount(d, close) {
      bindAssoFields(d, a, holder);
      d.querySelector('[data-save]').addEventListener('click', async () => {
        const f = new FormData(d.querySelector('form'));
        const body = { name: f.get('name'), kind: f.get('kind'), color: holder.color, description: f.get('description'), contact_email: f.get('contact_email'), phone: f.get('phone'), website: f.get('website'), commune: f.get('commune'), socials: {} };
        for (const k of Object.keys(SOCIALS)) body.socials[k] = f.get(`s_${k}`) || '';
        if (holder.logo) body.logo = holder.logo;
        try {
          const r = await api(`/api/associations/${a.id}`, { method: 'PUT', body });
          invalidate(); await Promise.all([refreshMe(), loadAssos(true)]); close(); toast('Profil enregistré.');
          if (r.association.slug !== a.slug) navigate(`/entites/${r.association.slug}`, { replace: true }); else done();
        } catch (err) { d.querySelector('[data-err]').textContent = err.message; }
      });
    },
  });
}

// =====================================================================
// INSCRIPTION D'UNE ENTITÉ : 1. « Qui êtes-vous ? »  2. le formulaire
// =====================================================================
export function registerView() {
  if (state.user?.association) { navigate(`/entites/${state.user.association.slug}`, { replace: true }); return; }
  const kind = state.kinds.some((k) => k.id === params().get('type')) ? params().get('type') : null;
  if (!kind) {
    main().innerHTML = String(html`<div class="narrow">
      <div class="page-head"><h1>Inscrire mon entité</h1></div>
      <p class="muted">Pour poser vos dates sur Lanterne. Un administrateur vérifie que votre entité existe vraiment, puis vous publiez et invitez vos membres.</p>
      <div class="notice info row">${icon('globe')}<span style="flex:1;min-width:0">Vous venez simplement voir ce qui se passe ? <b>Pas besoin de vous inscrire</b> : l’agenda est ouvert à tous.</span>
        <a class="btn small" href="/">Voir l’agenda</a></div>
      <h2 style="margin-top:22px">Qui êtes-vous ?</h2>
      <div class="kind-grid">${state.kinds.map((k) => html`<a class="kind-card" href="/inscription?type=${k.id}">${icon(k.icon)}<span><b>${k.label}</b>${k.hint}</span></a>`)}</div>
      <p class="small faint">Votre entité est déjà sur Lanterne ? Ne la réinscrivez pas : <a href="/entites">trouvez-la</a> et demandez à un de ses membres de vous inviter.
        <a href="/mode-d-emploi">Comment ça marche ?</a></p>
    </div>`);
    return;
  }
  const k = kindInfo(kind);
  const holder = {};
  main().innerHTML = String(html`<div class="narrow">
    <div class="page-head"><h1>${words(kind).title}</h1></div>
    <div class="kind-picked">${kindBadge(kind)}<a class="small" href="/inscription">Changer</a></div>
    <form class="card stack" data-reg novalidate>
      <h2>${words(kind).section}</h2>
      ${assoFields({}, {}, kind)}
      <hr class="divider">
      <h2>Vous</h2>
      <div class="grid-2">
        <label class="field"><span>Votre nom <span class="req">*</span></span><input class="input" name="person_name" value="${state.user?.name || ''}" autocomplete="name" required></label>
        <label class="field"><span>Votre mail <span class="req">*</span></span><input class="input" type="email" name="person_email" value="${state.user?.email || ''}" ${state.user ? 'readonly' : ''} autocomplete="${state.user ? 'email' : 'username'}" required></label>
      </div>
      ${!state.user && state.passwordLogin ? html`${passwordField('person_password', 'Choisissez un mot de passe', 'new-password', html`<span class="hint">8 caractères au moins. Vous serez connecté tout de suite, sans attendre de mail. Laissez vide pour recevoir plutôt un lien de connexion par mail.</span>`)}
        <p class="small faint" style="margin:0">Déjà un compte ? <a href="/connexion">Connectez-vous d’abord</a>, puis revenez ici.</p>` : ''}
      <p class="hint">Nous ne gardons que votre nom, votre mail et votre entité. <a href="/mentions-legales">Confidentialité</a>.</p>
      <p class="error-text" data-err role="alert"></p>
      <div><button class="btn primary">Envoyer l’inscription</button></div>
    </form></div>`);
  const form = $('[data-reg]');
  form.querySelector('[name=name]').focus();
  bindAssoFields(form, {}, holder);
  bindPasswordFields(form);
  const pwInput = form.querySelector('[name=person_password]');
  if (pwInput) pwInput.required = false; // facultatif ici : sans mot de passe, on reçoit un lien par mail
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const password = f.get('person_password') || '';
    if (password && password.length < 8) { $('[data-err]').textContent = 'Le mot de passe doit faire au moins 8 caractères (ou laissez-le vide).'; return; }
    const body = {
      association: { kind: k.id, name: f.get('name'), color: holder.color, logo: holder.logo || null, description: f.get('description'), contact_email: f.get('contact_email') || f.get('person_email'), phone: f.get('phone'), website: f.get('website'), commune: f.get('commune') },
      person: { name: f.get('person_name'), email: f.get('person_email'), ...(password ? { password } : {}) },
    };
    const btn = form.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('/api/register', { method: 'POST', body });
      if (r.logged_in) {
        await afterAuth('/');
        toast('Inscription envoyée, vous êtes connecté. Vous pourrez poser vos dates dès la validation.');
        return;
      }
      if (state.user) { await refreshMe(); toast('Inscription envoyée.'); navigate('/'); return; }
      main().innerHTML = String(html`<div class="narrow hero-login">${logo('logo-mark pulse')}<h1>Inscription envoyée</h1>
        <p class="muted">Nous vous avons envoyé un lien de connexion à <b>${body.person.email}</b>.<br>Un administrateur va vérifier votre entité : vous recevrez un mail dès qu’elle sera validée.</p></div>`);
    } catch (err) { $('[data-err]').textContent = err.message; btn.disabled = false; }
  });
}

// =====================================================================
// CONNEXION PAR LIEN MAGIQUE
// =====================================================================
// Champ mot de passe avec un bouton « Afficher » (plus simple sur téléphone qu'une double saisie)
const passwordField = (name, label, autocomplete, extra = '') => html`<label class="field"><span>${label}</span>
  <span class="pw-field"><input class="input" type="password" name="${name}" autocomplete="${autocomplete}" required minlength="8" maxlength="200">
  <button type="button" class="btn small ghost" data-show-pw aria-pressed="false">Afficher</button></span>${extra}</label>`;
function bindPasswordFields(root) {
  $$('[data-show-pw]', root).forEach((b) => b.addEventListener('click', () => {
    const input = b.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? 'Masquer' : 'Afficher';
    b.setAttribute('aria-pressed', String(show));
  }));
}
const afterAuth = async (to) => { await refreshMe(); invalidate(); window.lanterne.renderShell(); navigate(to || '/', { replace: true }); window.scrollTo({ top: 0 }); };

export function loginView() {
  if (state.user) { navigate('/compte', { replace: true }); return; }
  const errors = { lien: 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.', invitation: 'Cette invitation a expiré ou a déjà servi. Demandez une nouvelle invitation à votre entité.', 'deja-membre': 'Cette adresse est déjà rattachée à une autre entité.' };
  const e = errors[params().get('erreur')];
  const withPassword = state.passwordLogin && params().get('par') !== 'mail';
  main().innerHTML = String(html`<div class="narrow" style="max-width:460px">
    <div class="hero-login">${logo('logo-mark pulse')}<h1>Connexion</h1>
      <p class="muted">${withPassword ? 'Avec votre mail et votre mot de passe.' : 'Saisissez votre mail, cliquez sur le lien reçu.'}</p></div>
    ${e ? html`<p class="notice warn">${e}</p>` : ''}
    ${state.passwordLogin ? html`<div class="segmented login-switch" role="group" aria-label="Façon de se connecter">
      <a href="/connexion" ${withPassword ? raw('aria-current="page"') : ''}>Mot de passe</a>
      <a href="/connexion?par=mail" ${!withPassword ? raw('aria-current="page"') : ''}>${icon('mail')}Lien par mail</a></div>` : ''}
    <form class="card stack" data-login>
      <label class="field"><span>Votre adresse mail</span><input class="input" type="email" name="email" autocomplete="${withPassword ? 'username' : 'email'}" required autofocus placeholder="vous@association.fr"></label>
      ${withPassword ? passwordField('password', 'Mot de passe', 'current-password') : ''}
      <p class="error-text" data-err role="alert"></p>
      <button class="btn primary">${withPassword ? 'Se connecter' : 'Recevoir mon lien de connexion'}</button>
      ${withPassword ? html`<p class="small faint" style="margin:0">Mot de passe oublié, ou jamais choisi ? <a href="/connexion?par=mail">Recevez un lien par mail</a>, puis choisissez-en un dans « Mon compte ».</p>` : ''}
    </form>
    <p class="small muted" style="text-align:center;margin-top:18px">
      ${state.passwordLogin ? html`Pas encore de compte ? <a href="/creer-un-compte">Créez-le</a>, c’est immédiat.<br>` : ''}
      Vous organisez des événements (association, lieu, bar…) ? <a href="/inscription">Inscrivez votre entité</a>.<br>Elle y est déjà ? Demandez à un membre de vous inviter.<br>
      Vous venez juste voir ? Pas besoin de compte : <a href="/">l’agenda est ouvert à tous</a>. <a href="/mode-d-emploi">Comment ça marche ?</a></p>
  </div>`);
  bindPasswordFields(main());
  $('[data-login]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = ev.target.email.value.trim();
    const btn = ev.target.querySelector('button.primary'); btn.disabled = true;
    try {
      if (withPassword) {
        const r = await api('/api/auth/login', { method: 'POST', body: { email, password: ev.target.password.value } });
        await afterAuth(r.redirect);
        toast('Vous êtes connecté.');
        return;
      }
      await api('/api/auth/request', { method: 'POST', body: { email } });
      main().innerHTML = String(html`<div class="narrow hero-login" style="max-width:460px">${logo('logo-mark pulse')}<h1>Regardez vos mails</h1>
        <p class="muted">Si un compte existe pour <b>${email}</b>, un lien de connexion vient d’y être envoyé. Il est valable 30 minutes.</p>
        <p class="small faint">Rien reçu ? Vérifiez les indésirables, ou <a href="/connexion?par=mail">recommencez</a>.</p></div>`);
    } catch (err) { $('[data-err]').textContent = err.message; btn.disabled = false; }
  });
}

// =====================================================================
// CRÉER UN COMPTE (mot de passe choisi soi-même, sans attendre de mail)
// =====================================================================
export function signupView() {
  if (state.user) { navigate('/compte', { replace: true }); return; }
  if (!state.passwordLogin) { navigate('/connexion', { replace: true }); return; }
  main().innerHTML = String(html`<div class="narrow" style="max-width:460px">
    <div class="hero-login">${logo('logo-mark pulse')}<h1>Créer un compte</h1>
      <p class="muted">Choisissez votre mot de passe : vous êtes connecté tout de suite.</p></div>
    <form class="card stack" data-signup novalidate>
      <label class="field"><span>Votre nom <span class="req">*</span></span><input class="input" name="name" autocomplete="name" maxlength="80" required autofocus></label>
      <label class="field"><span>Votre adresse mail <span class="req">*</span></span><input class="input" type="email" name="email" autocomplete="username" required placeholder="vous@association.fr"></label>
      ${passwordField('password', html`Mot de passe <span class="req">*</span>`, 'new-password', html`<span class="hint">8 caractères au moins. Une petite phrase est plus sûre et plus facile à retenir.</span>`)}
      <label class="field" data-admin-code hidden><span>Code administrateur</span><input class="input" name="admin_code" autocomplete="off">
        <span class="hint">Cette adresse est celle d’un administrateur : le code vous a été donné avec l’accès à Lanterne.</span></label>
      <p class="hint">Nous ne gardons que votre nom, votre mail et votre entité. <a href="/mentions-legales">Confidentialité</a>.</p>
      <p class="error-text" data-err role="alert"></p>
      <button class="btn primary">Créer mon compte</button>
    </form>
    <p class="small muted" style="text-align:center;margin-top:18px">Déjà un compte ? <a href="/connexion">Connectez-vous</a>.</p>
  </div>`);
  const form = $('[data-signup]');
  bindPasswordFields(form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const err = $('[data-err]');
    if (!String(f.get('name')).trim()) { err.textContent = 'Indiquez votre nom.'; return; }
    if (String(f.get('password')).length < 8) { err.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
    const btn = form.querySelector('button.primary'); btn.disabled = true; err.textContent = '';
    try {
      await api('/api/auth/signup', { method: 'POST', body: { name: f.get('name'), email: f.get('email'), password: f.get('password'), admin_code: f.get('admin_code') || undefined } });
      await afterAuth('/compte?nouveau=1');
      toast('Compte créé : vous êtes connecté.');
    } catch (e2) {
      if (e2.code === 'admin_code') { const box = $('[data-admin-code]'); box.hidden = false; box.querySelector('input').focus(); }
      err.textContent = e2.message; btn.disabled = false;
    }
  });
}

// =====================================================================
// ARRIVÉE DEPUIS UN MAIL : un bouton à toucher (le lien n'est consommé qu'à ce moment-là)
// =====================================================================
async function finishAuth(btn, url, token) {
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  try {
    const r = await api(url, { method: 'POST', body: { token } });
    await refreshMe();
    invalidate();
    window.lanterne.renderShell();
    history.replaceState({}, '', '/');
    navigate(r.redirect || '/', { replace: true });
  } catch (err) {
    main().innerHTML = String(html`<div class="narrow hero-login" style="max-width:460px">${logo('logo-mark')}<h1>Lien plus valable</h1>
      <p class="muted">${err.message}</p><a class="btn primary" href="/connexion">Recevoir un nouveau lien</a></div>`);
  }
}

export function authVerifyView() {
  const token = params().get('token') || '';
  main().innerHTML = String(html`<div class="narrow hero-login" style="max-width:460px">${logo('logo-mark pulse')}
    <h1>Bienvenue sur Lanterne</h1>
    <p class="muted">Touchez le bouton pour vous connecter.</p>
    <button class="btn primary" data-go style="min-width:240px;min-height:52px;font-size:1.05rem">Me connecter</button></div>`);
  const btn = $('[data-go]');
  btn.focus();
  btn.addEventListener('click', () => finishAuth(btn, '/api/auth/verify', token));
}

export async function authInviteView() {
  const token = params().get('token') || '';
  main().innerHTML = '<div class="spinner"></div>';
  let info;
  try { info = await api(`/api/auth/invite-info?token=${encodeURIComponent(token)}`); } catch (err) {
    main().innerHTML = String(html`<div class="narrow hero-login" style="max-width:460px">${logo('logo-mark')}<h1>Invitation plus valable</h1>
      <p class="muted">${err.message}</p></div>`);
    return;
  }
  const a = info.association;
  main().innerHTML = String(html`<div class="narrow hero-login" style="max-width:460px">${logo('logo-mark pulse')}
    <h1>Rejoindre ${a.name}</h1>
    <p class="muted">Vous êtes invité·e à rejoindre <b style="color:${a.color}">${a.name}</b> sur Lanterne, l’agenda commun des associations stéphanoises.</p>
    <button class="btn primary" data-go style="min-width:240px;min-height:52px;font-size:1.05rem">Rejoindre ${a.name}</button></div>`);
  const btn = $('[data-go]');
  btn.focus();
  btn.addEventListener('click', () => finishAuth(btn, '/api/auth/invite', token));
}

// =====================================================================
// MON COMPTE
// =====================================================================
export function accountView() {
  const u = state.user;
  if (!u) { navigate('/connexion', { replace: true }); return; }
  const welcome = params().get('bienvenue') === '1';
  const fresh = params().get('nouveau') === '1';
  const pwCleared = params().get('motdepasse') === 'efface';
  main().innerHTML = String(html`<div class="narrow">
    <div class="page-head"><h1>${welcome || fresh ? 'Bienvenue sur Lanterne' : 'Mon compte'}</h1></div>
    ${fresh && !u.association ? html`<div class="notice info" style="margin-bottom:14px"><b>Votre compte est créé.</b> Prochaine étape :
      <a href="/inscription">inscrire votre entité</a> (association, lieu, bar…), ou, si elle est déjà sur Lanterne, demander à un de ses membres de vous inviter
      (avec l’adresse ${u.email}).</div>` : ''}
    ${pwCleared ? html`<div class="notice warn" style="margin-bottom:14px">${icon('lock')} Par sécurité, l’ancien mot de passe de ce compte a été effacé :
      il avait été choisi avant que l’adresse soit confirmée. Choisissez-en un nouveau ci-dessous.</div>` : ''}
    <form class="card stack" data-name>
      <h2>${welcome ? 'Comment vous appelez-vous ?' : 'Mon nom'}</h2>
      <label class="field"><span>Nom affiché à côté de vos commentaires</span><input class="input" name="name" value="${u.name}" maxlength="80" required autocomplete="name" ${welcome ? 'autofocus' : ''}></label>
      <p class="small faint">Connecté avec ${u.email}</p>
      <div><button class="btn primary">Enregistrer</button></div>
    </form>
    ${state.passwordLogin ? html`<form class="card stack" data-password>
      <h2>Mot de passe</h2>
      <p class="small muted" style="margin:0">${u.has_password ? 'Vous pouvez vous connecter avec votre mail et votre mot de passe. Le changer déconnecte vos autres appareils.' : 'Choisissez un mot de passe pour vous connecter sans attendre de mail.'}</p>
      <input type="email" name="username" value="${u.email}" autocomplete="username" hidden>
      ${passwordField('password', u.has_password ? 'Nouveau mot de passe' : 'Mot de passe', 'new-password', html`<span class="hint">8 caractères au moins.</span>`)}
      <div><button class="btn primary">${u.has_password ? 'Changer le mot de passe' : 'Enregistrer le mot de passe'}</button></div>
    </form>` : ''}
    <div class="card"><h2>Mon entité</h2>
      ${u.association ? html`<div class="row"><a class="chip-asso" style="--c:${u.association.color}" href="/entites/${u.association.slug}"><span class="dot"></span>${u.association.name}</a>
        ${u.association.status !== 'approved' ? html`<span class="status option">${u.association.status === 'pending' ? 'En attente de validation' : 'Refusée'}</span>` : ''}
        <span class="spacer" style="flex:1"></span><button class="btn small ghost" data-leave>Quitter l’entité</button></div>`
      : html`<p class="small muted">Vous n’êtes rattaché à aucune entité. Pour simplement consulter l’agenda, rien d’autre à faire.</p><a class="btn" href="/inscription">Inscrire mon entité</a>`}
    </div>
    <div class="card"><h2>Synchroniser avec mon agenda</h2>
      <p class="small muted">Un lien à copier dans Google Agenda, l’iPhone ou Outlook : les dates s’y mettent à jour toutes seules. Vous pouvez le filtrer (une entité, une catégorie, vos événements).</p>
      <div class="row"><button class="btn primary" data-sub>${icon('rss')}Obtenir mon lien d’abonnement</button>
      <button class="btn ghost small" data-regen>Créer un nouveau lien (l’ancien ne marchera plus)</button></div>
    </div>
    <div class="card"><h2>Affichage</h2>
      <div class="segmented" role="group" aria-label="Thème">
        <button data-theme-set="dark" aria-pressed="${document.documentElement.dataset.theme !== 'light' ? 'true' : 'false'}">${icon('moon')}Sombre</button>
        <button data-theme-set="light" aria-pressed="${document.documentElement.dataset.theme === 'light' ? 'true' : 'false'}">${icon('sun')}Clair</button>
      </div></div>
    <div class="card"><h2>Mes données</h2>
      <p class="small muted">Lanterne ne garde que votre nom, votre mail et votre entité. <a href="/mentions-legales">En savoir plus</a>.</p>
      <div class="row"><button class="btn" data-logout>${icon('logout')}Se déconnecter</button><button class="btn ghost danger" data-delete>${icon('trash')}Supprimer mon compte</button></div>
    </div>
  </div>`);
  $('[data-name]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('/api/me', { method: 'PUT', body: { name: ev.target.name.value } }); await refreshMe(); window.lanterne.renderShell(); toast('C’est enregistré.'); if (welcome) navigate('/'); } catch (err) { toast(err.message, 'error'); }
  });
  const pwForm = $('[data-password]');
  if (pwForm) {
    bindPasswordFields(pwForm);
    if (pwCleared) pwForm.password.focus();
    pwForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const password = pwForm.password.value;
      if (password.length < 8) { toast('Le mot de passe doit faire au moins 8 caractères.', 'error'); return; }
      const btn = pwForm.querySelector('button.primary'); btn.disabled = true;
      try {
        await api('/api/me/password', { method: 'PUT', body: { password } });
        await refreshMe(); toast('Mot de passe enregistré.');
        history.replaceState({}, '', '/compte'); accountView();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }
  $('[data-sub]').addEventListener('click', () => openSubscribe());
  $('[data-regen]').addEventListener('click', async () => {
    if (!(await confirmBox('Créer un nouveau lien ?', 'Les agendas abonnés avec l’ancien lien ne recevront plus les mises à jour. Utile si vous l’avez partagé par erreur.', 'Créer un nouveau lien'))) return;
    const r = await api('/api/me/ics-token', { method: 'POST', body: {} }); state.user.ics_token = r.ics_token; toast('Nouveau lien créé.');
  });
  $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => { window.lanterne.setTheme(b.dataset.themeSet); accountView(); }));
  $('[data-leave]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Quitter l’entité ?', 'Vous ne pourrez plus publier pour elle. Un membre pourra vous réinviter.', 'Quitter', true))) return;
    await api('/api/me/leave', { method: 'POST', body: {} }); await refreshMe(); invalidate(); window.lanterne.renderShell(); accountView();
  });
  $('[data-logout]').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); state.user = null; invalidate(); window.lanterne.renderShell(); navigate('/'); });
  $('[data-delete]').addEventListener('click', async () => {
    if (!(await confirmBox('Supprimer votre compte ?', 'Votre nom et votre mail seront effacés définitivement. Les dates de votre entité restent en place. Cette action est irréversible.', 'Supprimer définitivement', true))) return;
    try { await api('/api/me', { method: 'DELETE' }); state.user = null; invalidate(); window.lanterne.renderShell(); toast('Compte supprimé.'); navigate('/'); } catch (err) { toast(err.message, 'error'); }
  });
}

// =====================================================================
// ADMINISTRATION
// =====================================================================
export async function adminView() {
  if (!isAdmin()) { main().innerHTML = String(emptyState('Réservé aux administrateurs.')); return; }
  const tab = params().get('onglet') || 'inscriptions';
  main().innerHTML = '<div class="spinner"></div>';
  const [data] = await Promise.all([api('/api/admin/overview'), loadVenues(true)]);
  const tabs = { inscriptions: `Inscriptions${data.pending.length ? ` (${data.pending.length})` : ''}`, associations: 'Entités', categories: 'Catégories', lieux: 'Lieux', admins: 'Administrateurs', historique: 'Historique', sauvegardes: 'Sauvegardes' };
  let body = '';
  if (tab === 'inscriptions') {
    body = data.pending.length ? html`${data.pending.map((a) => html`<div class="card"><div class="row">${assoLogo(a)}<div style="flex:1;min-width:0"><h2 style="margin:0">${a.name}</h2><div style="margin:4px 0">${kindBadge(a.kind)}</div>
        <div class="small faint">Inscrite le ${fmt(a.created_at, { day: 'numeric', month: 'long', year: 'numeric' })}${a.commune ? ` · ${a.commune}` : ''}</div></div></div>
        ${a.description ? html`<p class="desc small" style="margin-top:12px">${a.description}</p>` : ''}
        <div class="small stack" style="margin-top:10px">
          <div>Contact : <a href="mailto:${a.contact_email}">${a.contact_email}</a>${a.phone ? ` · ${a.phone}` : ''}</div>
          ${a.website ? html`<div>Site : <a href="${a.website}" target="_blank" rel="noopener">${a.website}</a></div>` : ''}
          ${a.people ? html`<div>Inscrite par : ${a.people.map((p) => `${p.name} (${p.email})`).join(', ')}</div>` : ''}
        </div>
        <p class="small muted" style="margin-top:10px">Vérifiez qu’elle existe vraiment (site, réseaux, ${(a.kind || 'association') === 'association' ? html`<a href="https://www.journal-officiel.gouv.fr/pages/associations-recherche/?q=${encodeURIComponent(a.name)}" target="_blank" rel="noopener">Journal officiel</a>` : html`<a href="https://annuaire-entreprises.data.gouv.fr/rechercher?terme=${encodeURIComponent(a.name)}" target="_blank" rel="noopener">Annuaire des entreprises</a>`}) avant de valider.</p>
        <div class="row"><button class="btn primary" data-decide="${a.id}:approve">${icon('check')}Valider</button><button class="btn ghost danger" data-decide="${a.id}:reject">Refuser</button></div></div>`)}`
      : emptyState('Aucune inscription en attente.');
  } else if (tab === 'associations') {
    body = html`<div class="card table-wrap"><table class="table"><thead><tr><th>Entité</th><th>Type</th><th>Statut</th><th>Membres</th><th></th></tr></thead><tbody>
      ${data.associations.map((a) => html`<tr><td><a href="/entites/${a.slug}" class="row" style="gap:8px"><span class="dot" style="--c:${a.color}"></span>${a.name}</a></td><td>${kindBadge(a.kind)}</td>
        <td>${{ approved: 'Validée', pending: 'En attente', rejected: 'Refusée' }[a.status]}</td><td class="mono">${a.member_count}</td>
        <td style="text-align:right">${a.status === 'approved' ? html`<button class="btn small ghost" data-decide="${a.id}:pending">Suspendre</button>` : html`<button class="btn small" data-decide="${a.id}:approve">Valider</button>`}</td></tr>`)}
    </tbody></table></div>`;
  } else if (tab === 'categories') {
    body = html`<div class="card"><p class="small muted">Liste fixe proposée à la saisie. Une catégorie masquée n’est plus proposée mais reste sur les dates existantes.</p>
      <p class="small muted">La couleur sert quand on choisit « Couleurs : par catégorie » sur l’agenda.</p>
      <table class="table"><tbody>${state.categories.map((c, i) => html`<tr><td><input class="input" value="${c.name}" data-cat-name="${c.id}" style="min-height:36px"></td>
        <td><label class="cat-color"><span class="dot" style="--c:${c.color || 'transparent'}"></span><select class="input" data-cat-color="${c.id}" aria-label="Couleur de ${c.name}">
          ${state.palette.map((p) => html`<option value="${p.hex}" ${p.hex === c.color ? 'selected' : ''}>${p.name}</option>`)}</select></label></td>
        <td style="white-space:nowrap;text-align:right">
          <button class="icon-btn" data-cat-move="${c.id}:-1" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="icon-btn" data-cat-move="${c.id}:1" aria-label="Descendre" ${i === state.categories.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="btn small ${c.active ? 'ghost' : ''}" data-cat-toggle="${c.id}">${c.active ? 'Masquer' : 'Réactiver'}</button></td></tr>`)}</tbody></table>
      <form class="row" data-cat-add style="margin-top:12px"><input class="input" name="name" placeholder="Nouvelle catégorie" style="flex:1" required><button class="btn primary">Ajouter</button></form></div>`;
  } else if (tab === 'lieux') {
    const unplaced = state.venues.filter((v) => !v.archived && v.lat == null);
    body = html`<div class="card"><p class="small muted">La liste partagée des lieux, enrichie par les entités. Corrigez un nom ou une adresse, ou archivez un doublon.</p>
      ${unplaced.length ? html`<div class="notice warn row" style="margin-bottom:12px"><span style="flex:1;min-width:0">${unplaced.length} lieu${unplaced.length > 1 ? 'x' : ''} pas encore sur la carte.
        Ceux qui ont une adresse peuvent être placés automatiquement ; pour les autres, ajoutez l’adresse avec « Modifier ».</span>
        <button class="btn small" data-venues-place>${icon('map')}Placer les lieux sur la carte</button></div>` : ''}
      <input class="input" type="search" placeholder="Chercher un lieu…" data-venue-q style="margin-bottom:10px">
      <div class="table-wrap"><table class="table"><thead><tr><th>Lieu</th><th>Adresse</th><th>Carte</th><th></th></tr></thead><tbody>
      ${state.venues.map((v) => html`<tr data-venue-row="${(v.name + ' ' + v.city + ' ' + v.address).toLowerCase()}" style="${v.archived ? 'opacity:.5' : ''}"><td>${v.name}${v.district ? html`<div class="tiny faint">${v.district}</div>` : ''}</td><td class="small muted">${v.address || '—'}</td>
        <td>${v.lat != null ? '✓' : html`<span class="faint">non placé</span>`}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn small" data-venue-edit="${v.id}">Modifier</button>
        <button class="btn small ghost" data-venue-arch="${v.id}">${v.archived ? 'Réactiver' : 'Archiver'}</button></td></tr>`)}
      </tbody></table></div></div>`;
  } else if (tab === 'admins') {
    body = html`<div class="card"><p class="small muted">Le collège des administrateurs : 5 référents issus de 5 entités différentes. Ils valident les nouvelles entités, gèrent les catégories et les lieux, et interviennent en cas de problème.</p>
      <table class="table"><tbody>${data.admins.map((a) => html`<tr><td>${a.name || '—'}</td><td class="faint">${a.email}</td><td class="small">${a.asso_name || ''}</td>
        <td style="text-align:right">${data.env_admins.includes(a.email) ? html`<span class="tiny faint">fondateur</span>` : html`<button class="btn small ghost" data-admin-rm="${a.id}">Retirer</button>`}</td></tr>`)}</tbody></table>
      <form class="row" data-admin-add style="margin-top:12px"><input class="input" type="email" name="email" placeholder="Mail d’un membre (il doit déjà avoir un compte)" style="flex:1" required><button class="btn primary">Nommer administrateur</button></form></div>`;
  } else if (tab === 'sauvegardes') {
    const st = await api('/api/admin/backup/status');
    const last = st.last ? JSON.parse(st.last) : null;
    body = html`<div class="card"><h2>Sauvegarde automatique</h2>
      <p class="small muted">Chaque nuit vers 3 h, une copie complète de Lanterne (entités, membres, dates, lieux, commentaires, historique, images) part par mail ${st.recipients.length ? html`à <b>${st.recipients.join(', ')}</b>` : '(aucun destinataire configuré)'}. Gardez ces fichiers en lieu sûr : ils contiennent des données personnelles.</p>
      ${last ? html`<p class="notice ${last.ok ? 'info' : 'warn'}">${icon(last.ok ? 'check' : 'cancel')} Dernière sauvegarde : <b>${fmt(last.at, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</b>
        — ${last.ok ? `envoyée (${Math.max(1, Math.round((last.size || 0) / 1024))} Ko${last.withImages === false ? ', sans les images, trop lourdes pour un mail' : ''})` : 'échec de l’envoi'}</p>`
      : html`<p class="notice">Aucune sauvegarde automatique pour l’instant : la première partira cette nuit.</p>`}
    </div>
    <div class="card"><h2>Sauvegarde à la demande</h2>
      <p class="small muted">Utile avant une grosse modification, ou pour garder une copie sur votre ordinateur.</p>
      <div class="actions"><a class="btn primary" href="/api/admin/backup" download>${icon('archive')}Télécharger une sauvegarde</a>
        <button class="btn" data-backup-mail>${icon('mail')}Me l’envoyer par mail</button></div>
      <p class="hint">Pour restaurer une sauvegarde, voir le fichier README du projet (commande « npm run restore »).</p>
    </div>`;
  } else {
    body = html`<div class="card"><p class="small muted">Qui a modifié quoi. « Revenir avant » restaure l’état précédant la modification.</p>
      ${data.history.map((h) => html`<div class="history-item"><span class="when">${fmt(h.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        <span><b style="font-weight:500">${h.action}</b> · ${h.entity === 'event' ? html`<a href="/evenement/${h.entity_id}">${h.label || 'date'}</a>` : h.label || h.entity} · ${h.user_name || '—'}${h.association_name ? ` (${h.association_name})` : ''}</span>
        ${h.revertible ? html`<button class="btn small ghost" style="margin-left:auto" data-revert="${h.id}">Revenir avant</button>` : ''}</div>`)}</div>`;
  }
  main().innerHTML = String(html`<div class="page-head"><h1>Administration</h1></div>
    <nav class="segmented" style="margin-bottom:18px;flex-wrap:wrap">${Object.entries(tabs).map(([k, l]) => html`<a href="/admin?onglet=${k}" ${k === tab ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>
    <div class="narrow" style="max-width:900px">${body}</div>`);

  const reload = async () => { const cfg = await api('/api/config'); state.categories = cfg.categories; adminView(); };
  $('[data-backup-mail]')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await api('/api/admin/backup/mail', { method: 'POST', body: {} }); toast(`Sauvegarde envoyée à ${r.email}.`); } catch (err) { toast(err.message, 'error'); }
    b.disabled = false;
  });
  $$('[data-decide]').forEach((b) => b.addEventListener('click', async () => {
    const [id, d] = b.dataset.decide.split(':');
    try { await api(`/api/admin/associations/${id}/${d}`, { method: 'POST', body: {} }); await loadAssos(true); invalidate(); toast(d === 'approve' ? 'Association validée : ses membres ont reçu un mail.' : 'C’est fait.'); adminView(); } catch (err) { toast(err.message, 'error'); }
  }));
  $$('[data-cat-name]').forEach((i) => i.addEventListener('change', async () => { await api(`/api/categories/${i.dataset.catName}`, { method: 'PUT', body: { name: i.value } }); toast('Catégorie renommée.'); reload(); }));
  $$('[data-cat-color]').forEach((sel) => sel.addEventListener('change', async () => {
    await api(`/api/categories/${sel.dataset.catColor}`, { method: 'PUT', body: { color: sel.value } }); invalidate(); toast('Couleur enregistrée'); reload();
  }));
  $$('[data-cat-toggle]').forEach((b) => b.addEventListener('click', async () => { const c = state.categories.find((x) => x.id === Number(b.dataset.catToggle)); await api(`/api/categories/${c.id}`, { method: 'PUT', body: { active: !c.active } }); reload(); }));
  $$('[data-cat-move]').forEach((b) => b.addEventListener('click', async () => {
    const [id, dir] = b.dataset.catMove.split(':').map(Number);
    const list = [...state.categories]; const i = list.findIndex((c) => c.id === id); const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (const [k, c] of list.entries()) if (c.position !== k) await api(`/api/categories/${c.id}`, { method: 'PUT', body: { position: k } });
    reload();
  }));
  $('[data-cat-add]')?.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('/api/categories', { method: 'POST', body: { name: ev.target.name.value } }); reload(); } catch (err) { toast(err.message, 'error'); } });
  $('[data-venue-q]')?.addEventListener('input', (ev) => { const q = ev.target.value.toLowerCase(); $$('[data-venue-row]').forEach((r) => { r.hidden = q && !r.dataset.venueRow.includes(q); }); });
  $$('[data-venue-arch]').forEach((b) => b.addEventListener('click', async () => { const v = state.venues.find((x) => x.id === Number(b.dataset.venueArch)); await api(`/api/venues/${v.id}`, { method: 'PUT', body: { archived: !v.archived } }); adminView(); }));
  $('[data-venues-place]')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Recherche des adresses…';
    try {
      const r = await api('/api/admin/venues/place', { method: 'POST', body: {} });
      invalidate();
      toast(`${r.placed.length} lieu${r.placed.length > 1 ? 'x' : ''} placé${r.placed.length > 1 ? 's' : ''} sur la carte${r.failed.length ? ` · adresse introuvable pour : ${r.failed.join(', ')}` : ''}.`, r.failed.length ? 'error' : '');
      await loadVenues(true); adminView();
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  $$('[data-venue-edit]').forEach((b) => b.addEventListener('click', () => editVenueModal(state.venues.find((x) => x.id === Number(b.dataset.venueEdit)))));
  $('[data-admin-add]')?.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('/api/admin/admins', { method: 'POST', body: { email: ev.target.email.value } }); toast('Administrateur ajouté.'); adminView(); } catch (err) { toast(err.message, 'error'); } });
  $$('[data-admin-rm]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/admin/admins/${b.dataset.adminRm}`, { method: 'DELETE' }); await refreshMe(); adminView(); } catch (err) { toast(err.message, 'error'); } }));
  $$('[data-revert]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Revenir en arrière ?', 'L’élément reprendra l’état qu’il avait juste avant cette modification.', 'Revenir en arrière'))) return;
    try { await api(`/api/history/${b.dataset.revert}/revert`, { method: 'POST', body: {} }); invalidate(); toast('Version restaurée.'); adminView(); } catch (err) { toast(err.message, 'error'); }
  }));
}

function editVenueModal(v) {
  let picked;
  openModal({
    title: 'Modifier le lieu',
    body: html`<div class="stack">
      <label class="field"><span>Nom</span><input class="input" name="name" value="${v.name}"></label>
      <div class="field combo"><span class="field-label">Adresse</span><input class="input" name="addr" value="${v.address}" autocomplete="off"><div class="combo-list" data-addr-list hidden></div></div>
      <label class="field"><span>Quartier</span><input class="input" name="district" value="${v.district || ''}"></label>
      <p class="error-text" data-err></p></div>`,
    foot: html`<button class="btn ghost" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button>`,
    onMount(d, close) {
      bindAddressField(d.querySelector('[name=addr]'), d.querySelector('[data-addr-list]'), (it) => { picked = it; });
      d.querySelector('[data-save]').addEventListener('click', async () => {
        const body = { name: d.querySelector('[name=name]').value, district: d.querySelector('[name=district]').value };
        const typed = d.querySelector('[name=addr]').value.trim();
        if (picked) Object.assign(body, { address: picked.label, city: picked.city, citycode: picked.citycode, lat: picked.lat, lng: picked.lng });
        else if (typed !== v.address) body.address = typed; // adresse tapée à la main : le serveur cherche sa position
        try {
          const r = await api(`/api/venues/${v.id}`, { method: 'PUT', body }); invalidate(); close();
          toast(r.venue.lat == null && r.venue.address ? 'Lieu enregistré, mais l’adresse n’a pas été trouvée sur la carte.' : 'Lieu enregistré.', r.venue.lat == null && r.venue.address ? 'error' : '');
          adminView();
        } catch (err) { d.querySelector('[data-err]').textContent = err.message; }
      });
    },
  });
}

// =====================================================================
// MENTIONS LÉGALES ET CONFIDENTIALITÉ
// =====================================================================
export function legalView() {
  main().innerHTML = String(html`<div class="narrow prose">
    <h1>Mentions légales et confidentialité</h1>
    <h2>Éditeur</h2>
    <p>Lanterne est un agenda commun aux associations de Saint-Étienne Métropole. Son lancement est porté par le collectif T2O ; sa gouvernance est partagée entre plusieurs associations (collège de 5 référents).</p>
    <p>Contact : ${window.lanterne.contact ? html`<a href="mailto:${window.lanterne.contact}">${window.lanterne.contact}</a>` : 'écrivez aux administrateurs via votre entité.'}</p>
    <h2>Hébergement</h2>
    <p>Railway Corporation (railway.com), San Francisco, États-Unis. Les données sont hébergées dans la région choisie pour le service.</p>
    <h2>Données personnelles</h2>
    <p>Pour chaque membre, Lanterne ne conserve que <b>son nom, son adresse mail et son entité</b> (association, lieu, bar…), et, si la personne en a choisi un, une empreinte de son mot de passe : un code illisible dont on ne peut pas retrouver le mot de passe. Le mot de passe lui-même n’est jamais enregistré. Ces données servent uniquement à vous connecter, à afficher l’auteur des commentaires et des modifications, et à vous envoyer les mails nécessaires (lien de connexion, invitation, validation de votre association). Elles ne sont ni vendues, ni partagées, ni utilisées pour de la publicité.</p>
    <p>Base légale : l’intérêt légitime des entités (associations, lieux, collectifs…) à coordonner leurs dates, et votre demande d’inscription.</p>
    <p>Un historique des modifications (qui a modifié quoi) est conservé pour pouvoir revenir en arrière en cas d’erreur.</p>
    <p><b>Suppression :</b> vous pouvez supprimer votre compte à tout moment depuis « Mon compte ». Votre nom et votre mail sont alors effacés ; vos commentaires et modifications passées apparaissent comme « Compte supprimé ».</p>
    <p>Vous disposez d’un droit d’accès, de rectification et d’effacement de vos données. Écrivez à l’adresse de contact ci-dessus. Vous pouvez aussi saisir la CNIL (cnil.fr).</p>
    <h2>Cookies</h2>
    <p>Lanterne n’utilise qu’un seul cookie, indispensable pour rester connecté. Aucun cookie publicitaire ni outil de mesure d’audience. Votre choix de thème et de filtres est gardé dans votre navigateur.</p>
    <h2>Services utilisés</h2>
    <ul>
      <li>Envoi des mails : un service d’envoi transactionnel (Brevo ou Resend), qui ne reçoit que l’adresse du destinataire et le contenu du mail.</li>
      <li>Fond de carte : OpenFreeMap, © OpenMapTiles, © OpenStreetMap et ses contributeurs.</li>
      <li>Recherche d’adresse et placement des lieux sur la carte : Géoplateforme de l’IGN (service public). Elle ne reçoit que l’adresse du lieu.</li>
      <li>Événements du territoire : DATAtourisme, plateforme nationale des données touristiques (data.gouv.fr, Licence Ouverte). Les données sont publiées par les offices de tourisme ; Lanterne ne fait que les afficher.</li>
    </ul>
    <h2>Contenus</h2>
    <p>Les entités publient librement leurs dates et en sont responsables. Les administrateurs peuvent intervenir en cas de problème.</p>
  </div>`);
}
