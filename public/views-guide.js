// Lanterne — mode d'emploi : qui fait quoi, en une page courte.
// Trois profils : le public (regarde), une entité qui s'inscrit (pose ses dates), un membre d'une entité déjà inscrite.
import { html, icon, statusBadge, STATUS, logo } from './lib.js';
import { state, openSubscribe } from './core.js';

const main = () => document.getElementById('main');

export function guideView() {
  const u = state.user;
  main().innerHTML = String(html`<div class="narrow guide">
    <div class="hero-login">${logo('logo-mark pulse')}<h1>Comment ça marche ?</h1>
      <p class="muted">Lanterne, c’est l’agenda commun de celles et ceux qui font vivre Saint-Étienne et ses environs.
      Chacun y pose ses dates : on voit tout de suite les soirs chargés et ceux où il y a de la place.</p></div>

    <h2 class="guide-question">Qui êtes-vous ?</h2>
    <div class="guide-profiles">
      <a class="guide-jump" href="#public">${icon('globe')}<span><b>Je viens voir</b><span>ce qui se passe</span></span></a>
      <a class="guide-jump" href="#organiser">${icon('calAdd')}<span><b>J’organise</b><span>des événements</span></span></a>
      <a class="guide-jump" href="#membre">${icon('users')}<span><b>Je fais partie</b><span>d’une entité déjà inscrite</span></span></a>
    </div>

    <section class="card guide-card" id="public">
      <p class="guide-tag">${icon('globe')}Public</p>
      <h2>Vous voulez savoir ce qui se passe</h2>
      <p><b>Pas besoin de compte.</b> Tout ce qui est public est visible sans s’inscrire.</p>
      <ul class="guide-list">
        <li>${icon('calendar')}<span><b>L’agenda</b> : par mois, en liste ou sur la carte. Touchez un jour pour voir ses dates.</span></li>
        <li>${icon('filter')}<span><b>Les filtres</b> : un type d’entité, une catégorie, une commune…</span></li>
        <li>${icon('rss')}<span><b>S’abonner</b> : les dates arrivent toutes seules dans votre agenda (téléphone, Google, Outlook).</span></li>
        <li>${icon('compass')}<span><b>Les événements du territoire</b> : ceux de l’Office de tourisme et des communes voisines.</span></li>
      </ul>
      <div class="actions"><a class="btn primary" href="/">${icon('calendar')}Voir l’agenda</a><button class="btn" data-sub>${icon('rss')}S’abonner</button></div>
    </section>

    <section class="card guide-card" id="organiser">
      <p class="guide-tag">${icon('calAdd')}Organisateurs</p>
      <h2>Vous organisez des événements</h2>
      <p>Association, collectif, lieu, bar, commerce, mairie… on parle d’<b>entité</b>. Inscrivez la vôtre une fois, puis posez vos dates.</p>
      <ol class="guide-steps">
        <li><b>Inscrivez votre entité</b> et dites ce que vous êtes. Vous choisissez un mot de passe : vous êtes connecté tout de suite.</li>
        <li><b>Un administrateur vérifie</b> qu’elle existe vraiment, et la valide.</li>
        <li><b>Posez vos dates</b>, même en option : les autres voient tout de suite que le soir est pris. Invitez vos membres.</li>
      </ol>
      <div class="actions">${u?.association ? html`<a class="btn primary" href="/entites/${u.association.slug}">Voir mon entité</a>`
        : html`<a class="btn primary" href="/inscription">${icon('plus')}Inscrire mon entité</a>`}</div>
    </section>

    <section class="card guide-card" id="membre">
      <p class="guide-tag">${icon('users')}Membres</p>
      <h2>Votre entité est déjà sur Lanterne</h2>
      <p><b>Ne la réinscrivez pas.</b> Demandez à un de ses membres de vous inviter : il le fait depuis la page de l’entité, avec votre adresse mail.
        Vous recevez un lien, vous rejoignez l’entité, et vous pouvez publier.</p>
      <p class="small muted">Le mail n’arrive pas ? Le membre qui vous invite voit aussi le lien d’invitation : il peut vous l’envoyer par SMS ou par message.</p>
      <div class="actions"><a class="btn" href="/entites">${icon('users')}Trouver mon entité</a>${u ? '' : html`<a class="btn ghost" href="/creer-un-compte">Créer un compte</a>`}</div>
    </section>

    <section class="card guide-card" id="legende">
      <h2>Qui est qui</h2>
      <p class="small muted">Chaque entité a sa couleur sur le calendrier, et un type, affiché sur sa page et dans l’annuaire.</p>
      <ul class="guide-kinds">${state.kinds.map((k) => html`<li><span class="kind-badge" data-kind="${k.id}">${icon(k.icon)}${k.label}</span><span class="small muted">${k.hint}</span></li>`)}</ul>
      <h3>Où en est une date</h3>
      <ul class="guide-kinds">${Object.keys(STATUS).map((s) => html`<li>${statusBadge(s)}<span class="small muted">${{
        option: 'Envisagée, pas encore sûre : elle prévient les autres très tôt. Invisible du public.',
        en_cours: 'Presque sûre, en préparation.',
        valide: 'Confirmée.',
        annule: 'Annulée : elle reste affichée, barrée, pour montrer que le soir se libère.',
      }[s]}</span></li>`)}</ul>
    </section>
  </div>`);
  main().querySelector('[data-sub]').addEventListener('click', () => openSubscribe());
  // Liens d'ancrage internes (le routeur ignore les « # » de la même page)
  main().querySelectorAll('.guide-jump').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
