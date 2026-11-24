# Lanterne — mémoire du projet

Ce fichier est la mémoire partagée entre les sessions de travail. **Toute modification non triviale du projet
met ce fichier à jour dans le même commit** (nouvelle règle, nouveau piège, décision prise).

Lanterne est l'agenda commun des associations stéphanoises : chaque association pose ses dates avec sa couleur,
et on voit tout de suite les soirs chargés. Les personnes qui l'utilisent et qui décident ne sont pas des
techniciens : **on écrit simple, en français**, dans l'interface, les messages d'erreur, les commentaires du
code, les commits et la documentation.

## En deux minutes

- **Serveur** : Node.js ≥ 20.15, Express 4, modules ES. Un seul gros fichier de routes : `server/index.js`.
- **Base** : PostgreSQL en production (`DATABASE_URL`), PGlite (Postgres embarqué) en local dans `.data/`.
  Le schéma `server/schema.sql` est **idempotent et rejoué à chaque démarrage** : on n'y ajoute que des
  `CREATE … IF NOT EXISTS` et des `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, dans la section « Évolutions ».
- **Interface** : JavaScript sans aucune étape de compilation, servi tel quel depuis `public/`.
  `app.js` (routeur, structure) → `core.js` (état, composants communs) → `views-*.js` (écrans) → `lib.js` (outils).
- **Hébergement** : Railway. `railway.json` déclare l'adresse de santé `/health`.
- **Mails** : Brevo ou Resend ; sans clé, ils s'écrivent dans le terminal (c'est ce que lisent les tests).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | Serveur local avec rechargement. Lit `.env` s'il existe (modèle : `.env.example`). |
| `npm test` | Vérifie la syntaxe, teste les outils (`scripts/unit-test.mjs`), puis lance un serveur jetable et le scénario de bout en bout (`scripts/smoke-test.mjs`). Aucun vrai mail, jamais la vraie base. |
| `npm run check` | Vérifie seulement la syntaxe de tous les fichiers. |
| `npm run restore -- fichier.zip --confirmer` | Remplace **toute** la base par une sauvegarde. |

## Règles à ne jamais casser

1. **`npm test` passe avant chaque envoi.** Une nouvelle règle métier ou un bug corrigé arrive avec sa
   vérification dans `scripts/smoke-test.mjs` (serveur) ou `scripts/unit-test.mjs` (outils de l'interface).
2. **Qui voit quoi se décide côté serveur**, dans `visibility()` et `canEdit()` (`server/index.js`). L'interface
   ne fait que masquer des boutons. Un visiteur ne voit que les dates « Public », hors « option » et hors
   « réunion interne » ; les associations validées voient aussi « Associations » ; « Privé » reste à
   l'association organisatrice. Les liens d'abonnement `.ics` et l'aperçu de partage suivent la même règle.
3. **Tout texte affiché passe par le gabarit `html`** de `public/lib.js`, qui échappe les valeurs. `raw()` est
   réservé au HTML que nous écrivons nous-mêmes, jamais à une donnée saisie.
4. **Toute écriture sur l'API porte l'en-tête `X-Requested-With: lanterne`** (protection CSRF). La fonction
   `api()` de `lib.js` l'ajoute ; ne pas appeler `fetch` à la main pour écrire.
5. **Pas de script en ligne, pas de domaine externe en plus** sans mettre à jour la politique de sécurité (CSP)
   dans `server/index.js`. Tout nouveau fichier de `public/` chargé au démarrage s'ajoute à `SHELL` dans `sw.js`.
6. **Un statut ne se signale jamais par la couleur seule** : toujours une icône et un texte. Les 12 couleurs
   d'association (`PALETTE`) sont testées en contraste ; on n'en ajoute pas au hasard.
7. **Les dates se calculent à l'heure de Paris**, avec les fonctions de `lib.js` (`parisDate`, `dayKey`,
   `eventDays`…). Jamais `new Date().getHours()` ni de fuseau du navigateur.
8. **Aucun secret dans le dépôt.** Les clés vivent dans `.env` (ignoré par git) ou dans Railway.
9. **On ne révèle pas qui a un compte** : `/api/auth/request` répond pareil pour une adresse connue ou non,
   et n'envoie aucun mail à une adresse inconnue ; `/api/auth/login` donne le même message (et met le même
   temps) pour un mauvais mot de passe, une adresse inconnue ou un compte sans mot de passe.
10. **On supprime rarement pour de bon** : une date supprimée est masquée (`deleted_at`), une date annulée
    reste affichée barrée, et chaque modification laisse une trace dans `history` pour revenir en arrière.
11. **Mots de passe** : jamais gardés en clair, seulement une empreinte `scrypt` (`hashPassword` dans
    `server/index.js`). Un compte créé par mot de passe n'a **pas d'adresse prouvée** (`email_verified = false`) :
    - le premier lien reçu par mail pour cette adresse efface ce mot de passe et ferme ses sessions (`confirmEmail`),
      sauf si la personne était déjà connectée à ce même compte en ouvrant le lien ;
    - une adresse de `ADMIN_EMAILS` ne se crée par mot de passe qu'avec `ADMIN_SETUP_CODE` ;
    - un compte ainsi créé ne rejoint une association que par l'inscription (validée par un administrateur)
      ou par une invitation reçue par mail. Nommer administrateur un compte non confirmé reste possible :
      c'est une décision humaine, prise dans l'onglet Administrateurs.

## Décisions prises (et pourquoi)

- **Toucher un jour ouvre « Créer un événement ce jour-là ? »** au lieu de l'appui long : demande de Quentin.
- **Les liens des mails ouvrent une page avec un bouton**, et seul le clic consomme le lien : les antivirus de
  messagerie « visitent » les liens et les grillaient.
- **Pas de récurrence automatique** : on duplique une date. Prévu ainsi au cahier des charges.
- **Le formulaire montre ce qui est déjà posé le jour choisi** (et signale le même lieu) : c'est la raison
  d'être de Lanterne, on le voit avant de valider et pas après.
- **La recherche et l'export de la Liste se font dans le navigateur**, sur les dates déjà chargées : ils
  respectent donc d'office la visibilité, les filtres, et marchent hors ligne. L'export CSV met un point-virgule
  et un marqueur d'accents pour Excel, et neutralise les cellules qui commencent par `=`, `+`, `-` ou `@`.
- **Plafond général de 600 appels par minute et par adresse** sur `/api` et `/ics` (`API_RATE_LIMIT`), en plus
  des limites fines sur la connexion, l'inscription, les invitations et les commentaires.
- **`/health` vérifie aussi la base** : Railway garde l'ancienne version en ligne tant que la nouvelle ne
  répond pas.
- **Connexion par mot de passe en plus du lien par mail** (novembre 2026) : demandée pour pouvoir créer un
  compte tout de suite, sans dépendre de l'envoi des mails. On peut la couper avec `PASSWORD_LOGIN=off`.
  Les sauvegardes contiennent les empreintes des mots de passe (pas les mots de passe).
- **Un élément `hidden` reste toujours caché** (`[hidden] { display: none !important; }` en tête de
  `styles.css`) : sans cette règle, `.field` ou les cartes l'emportaient et l'affichaient quand même.
- **Les tests ne lisent pas `.env`** (`NODE_ENV=test`) : impossible de toucher la vraie base par accident.

## Pas dans cette version

Suivre des associations, bourse au matériel et aux bénévoles, affiche du mois, bilan annuel, modération,
nom de domaine : prévu pour la version 2 (voir `README.md`).
