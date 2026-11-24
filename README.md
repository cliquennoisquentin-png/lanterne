# Lanterne

**L'agenda commun des associations stéphanoises.** Chaque association allume sa lanterne sur le calendrier, avec sa couleur. Plus il y a de lanternes un soir, plus ce jour brille : on voit tout de suite où il y a de la place.

Version 1, conforme au cahier des charges du 24 novembre 2026.

## Ce que fait la version 1

| Cahier des charges | Où c'est |
|---|---|
| Comptes par lien magique, sans mot de passe | `/connexion`, `server/index.js` (`/api/auth/*`) |
| Inscription d'une association, validation par un administrateur, invitations par mail | `/inscription`, `/admin`, profil d'association |
| Rôles visiteur / membre / administrateur (collège de 5) | `visibility()` et `canEdit()` dans `server/index.js` |
| Fiche rapide (titre, date et heure, lieu, catégorie) + champs facultatifs | `/nouveau`, `public/views-form.js` |
| Statuts option / en cours / validé / annulé (barré), report « reporté du … » | fiche événement |
| Visibilité public / associations / privé | formulaire + contrôle côté serveur |
| Lieux partagés avec autocomplétion d'adresse (IGN), quartier facultatif | formulaire, onglet Lieux de l'admin |
| Catégories fixes gérées par les administrateurs | onglet Catégories de l'admin |
| Duplication (pas de récurrence automatique) | bouton « Dupliquer » |
| Archives, « l'an dernier à la même période » | Liste → Archives, bouton « L'an dernier » |
| Accueil = calendrier du mois, vues Mois / Liste / Carte | `public/views-agenda.js` |
| Filtres dans un seul panneau (association, catégorie, commune/quartier, statut, type) | bouton « Filtres » |
| Saisie rapide : un toucher sur un jour l'affiche dans la carte du jour (ses dates, puis un bouton « Créer un événement ce jour-là ») ; bouton « + » toujours visible | calendrier |
| « On y va » / intéressé, commentaires, co-organisation | fiche événement |
| Profils d'association et annuaire | `/associations` |
| Historique de qui a modifié quoi, retour en arrière | fiche événement, onglet Historique de l'admin |
| Version publique sans compte, partage par lien, ajout à son agenda | toutes les pages, sans connexion |
| Lien d'abonnement filtrable (Google Agenda, iPhone, Outlook) | « S'abonner », `/ics/…` |
| Identité : nuit, néon bleu #3998EB, Orbitron / Work Sans / IBM Plex Mono, thème sombre par défaut + clair | `public/styles.css` |
| 12 couleurs d'association testées (contraste ≥ 3:1 sur fond noir et clair) | `PALETTE` dans `server/index.js` |
| Statuts jamais signalés par la couleur seule | icône + texte partout |
| Appli installable (PWA), mises à jour instantanées | `manifest.webmanifest`, `sw.js` |
| Carte à fond sombre | OpenFreeMap (gratuit, sans clé), MapLibre |
| Données minimales, mentions légales, suppression du compte | `/mentions-legales`, Mon compte |

Ajouts depuis la version 1 :

| Nouveauté | Où c'est |
|---|---|
| Recherche dans les dates (titre, association, lieu, catégorie, description), sans accents ni majuscules | Liste, bouton loupe du calendrier, `searchEvents()` dans `public/lib.js` |
| Export des dates affichées vers Excel ou LibreOffice (CSV) | Liste → « Exporter », `eventsCsv()` dans `public/lib.js` |
| En posant une date, on voit ce qui est déjà prévu ce jour-là, et si c'est au même lieu | formulaire, `public/views-form.js` |
| Adresse de santé pour des mises à jour sans coupure | `/health`, `railway.json` |
| Plafond général d'appels par minute | `throttle()` dans `server/index.js` |
| Une action qui échoue affiche toujours un message | `public/app.js` |
| Créer son compte avec un mot de passe et se connecter sans mail (le lien par mail reste possible) | `/creer-un-compte`, `/connexion`, Mon compte, `/api/auth/signup` et `/api/auth/login` |
| Choisir un mot de passe dès l'inscription de son association | `/inscription` |
| Carte : une pastille par date (jamais regroupées ; au même lieu, elles s'écartent en cercle) ; une adresse tapée à la main est placée automatiquement (et les lieux existants au démarrage) ; les dates hors carte sont listées sous la carte | `server/geocode.js`, Administration → Lieux |
| Événements du territoire : ceux de l'Office de tourisme de Saint-Étienne et des offices voisins (DATAtourisme), avec un bouton sous le jour choisi du calendrier | `/territoire`, `server/tourisme.js` |

La version 2 (suivre des associations, bourse matériel et bénévoles, affiche du mois, bilan annuel, modération, nom de domaine) n'est pas incluse, comme prévu.

## Technique

- Node.js (≥ 20) + Express, PostgreSQL. Aucune étape de compilation : le site est servi tel quel.
- En local, sans `DATABASE_URL`, une base PostgreSQL embarquée (PGlite) est créée dans `.data/`.

```bash
npm install
cp .env.example .env   # puis mettez votre adresse dans ADMIN_EMAILS
npm run dev
```

Sans service d'envoi configuré, les mails (liens de connexion, invitations) s'affichent dans le terminal.

Tests (syntaxe, outils de l'interface, puis scénario de bout en bout sur un serveur jetable : base vide, aucun mail envoyé) :

```bash
npm test
```

Les règles du projet et les décisions prises sont dans `CLAUDE.md`.

## Variables d'environnement (Railway)

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Base PostgreSQL (fournie par le service Postgres de Railway) |
| `NODE_ENV` | `production` |
| `ADMIN_EMAILS` | Adresse(s) du ou des administrateurs fondateurs, séparées par des virgules |
| `BREVO_API_KEY` | Envoi des mails via Brevo (une adresse d'expéditeur vérifiée suffit, pas besoin de domaine) |
| `RESEND_API_KEY` | Alternative : envoi via Resend (demande un domaine vérifié) |
| `MAIL_FROM` | Expéditeur, ex. `Lanterne <adresse@exemple.fr>` (doit être vérifié chez le service d'envoi) |
| `CONTACT_EMAIL` | Adresse affichée dans les mentions légales |
| `PUBLIC_URL` | Facultatif : adresse publique si elle diffère de celle de Railway |
| `BACKUP_EMAILS` | Facultatif : destinataires de la sauvegarde de nuit (par défaut `ADMIN_EMAILS`) |
| `API_RATE_LIMIT` | Facultatif : plafond d'appels par minute et par adresse (600 par défaut) |
| `PASSWORD_LOGIN` | Facultatif : `off` coupe la connexion par mot de passe (seul le lien par mail reste) |
| `TOURISME` | Facultatif : `off` masque la page « Événements du territoire » |
| `ADMIN_SETUP_CODE` | Facultatif : code secret (12 caractères au moins) pour créer par mot de passe le compte d'une adresse de `ADMIN_EMAILS` |

La liste complète, commentée, est dans `.env.example`. Railway interroge `/health` (réglé dans `railway.json`) avant de basculer sur une nouvelle version.

## Sauvegardes

- Chaque nuit vers 3 h (heure de Paris), une copie complète part par mail (.zip) aux adresses de `BACKUP_EMAILS` (par défaut `ADMIN_EMAILS`).
- Administration → Sauvegardes : télécharger ou recevoir une sauvegarde à la demande.
- Restaurer (remplace toute la base) :

```bash
DATABASE_URL=postgres://... npm run restore -- lanterne-sauvegarde-....zip --confirmer
```
