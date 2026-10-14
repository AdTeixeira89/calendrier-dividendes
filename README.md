# Suivi de portefeuille et de dividendes

Application web (installable sur téléphone) de **suivi complet d'un portefeuille d'actions et d'ETF** : valeur et performance dans le temps, diversification par secteur et par pays, et suivi détaillé des dividendes (prochains versements, prévisions, historique, statistiques). Hébergée sur GitHub Pages, sans serveur à maintenir.

## Navigation (5 rubriques)

| Rubrique | Contenu |
|---|---|
| **Accueil** | Bandeau compact des prochains versements en défilement continu, œil pour **masquer les chiffres**. **Courbe de la valeur du portefeuille** (1 an / 3 ans / 5 ans, repère « Investi (PRU) »), **dividendes de l'année** (perçus, à vérifier, à venir, prochain versement, revenus mensuels), 4 indicateurs (plus-value latente, dividendes annuels estimés, rendement sur coût, nombre d'actifs), répartition par **secteur** et par **pays**, meilleures et moins bonnes performances. |
| **Mon portefeuille** | Résumé (valeur, investi, plus / moins-value, rendement total) puis tableau des actifs : quantité, PRU, cours, valeur, **poids**, **+/- value (€ et %)**, dividende estimé, prochain versement… Colonnes à afficher, tri, recherche, filtres, **suppression multiple** avec annulation. |
| **Répartition** | Diagrammes par **secteur**, **pays**, devise, type d'actif et compte, pondérables par **valeur**, **montant investi** ou **dividendes** ; principales positions ; la queue des petites lignes est regroupée en « Autres » pour rester lisible avec de nombreux actifs. |
| **Dividendes** | Trois onglets : **Calendrier** (mois / année / logos, filtres, « Enregistrer comme reçu »), **Historique** (versements et opérations, import CSV, saisie manuelle, pré-remplissage « à vérifier ») et **Statistiques** (indicateurs de revenus, prévision 12 mois, par année, contributeurs). |
| **Paramètres** | Apparence, devise d'affichage, brut/net, portefeuilles, données de marché, sauvegarde, code de verrouillage, rappels. |

Les anciens liens (`#/historique`, `#/calendrier`, `#/statistiques`…) ouvrent l'onglet correspondant de « Dividendes ».

## Suivi de la performance

- **PRU** : votre prix de revient unitaire (saisi, importé ou calculé depuis vos transactions) sert de base à la plus / moins-value de chaque actif et du portefeuille. Un actif sans PRU ou sans cours est exclu du calcul et signalé, jamais deviné.
- **Évolution de la valeur** : reconstituée à partir de l'historique mensuel des cours (5 ans, Yahoo) × vos quantités actuelles (ou celles reconstituées par vos transactions s'il y en a), converties au taux de change de l'époque (BCE / Frankfurter). **C'est donc une valeur « rétrospective » de la position actuelle, pas l'historique exact de vos achats** tant que vous n'avez pas importé vos transactions. Les actifs sans historique sont signalés et exclus plutôt qu'inventés.
- **Secteur et pays** : le secteur vient de la recherche Yahoo (actions uniquement), le pays de l'ISIN ou du suffixe de la place de cotation ; les ETF sont classés « ETF multi-pays ». Les deux sont **modifiables à la main** dans la fiche de l'actif (ils ne sont alors plus écrasés par les actualisations). Appuyez sur « Actualiser » une fois pour récupérer historique, secteur et pays de vos actifs existants.

## Apparence

Mode automatique / clair / sombre et **thèmes de fond** (Aurore, Émeraude, Saphir, Or, Sobre) avec surfaces vitrées et reflets, dans Paramètres → Apparence. Le choix est enregistré avec vos paramètres (donc synchronisé avec le compte) et appliqué dès le chargement.

## Fiabilité des données

Chaque versement a un statut explicite, jamais maquillé :

- **Reçu** — enregistré (saisi, importé, ou « À vérifier » s'il a été généré d'après l'historique de marché).
- **Confirmé** — annoncé par la société.
- **Estimé** — prévision calculée (dernier dividende × fréquence) ; la date affichée est précisée : *détachement estimé* ou *paiement estimé*.
- **Non enregistré** — date passée sans versement enregistré (à vérifier).

Règles : un versement reçu **remplace** la prévision du même actif dans le même mois (pas de double compte) ; aucun dividende n'est inventé (ETF capitalisants et actifs sans dividende récent exclus des prévisions) ; la quantité utilisée pour un versement passé tient compte de vos opérations quand elles reconstituent exactement votre position ; les devises étrangères sont converties (taux BCE) et, si un taux manque, le montant est signalé et exclu des totaux plutôt que deviné ; le net n'est utilisé que s'il est connu (sinon le brut est repris et signalé).

## Données de marché (Yahoo Finance via un relais gratuit)

L'ancienne API Financial Modeling Prep a été **supprimée**. Les historiques de dividendes (date de détachement + montant par titre), le **dernier cours** (valeur, plus-value), noms, devises et la conversion ISIN → ticker viennent de Yahoo Finance, interrogé par un petit relais Cloudflare Workers ([`relay/`](relay/LISEZMOI.md)) dont l'adresse est dans `config.js` / Paramètres.

Limites à connaître : Yahoo ne fournit **ni la date de mise en paiement ni la retenue fiscale** ; elles se saisissent à la main ou viennent de l'import de transactions. **Cours et PRU** : le cours vient de la même requête Yahoo que les dividendes (aucun coût supplémentaire, rafraîchi avec « Actualiser » ou chaque jour à l'ouverture). Le PRU est saisi par vous (ou calculé depuis vos transactions) et peut être dans une autre devise que l'actif ; la plus-value n'est calculée que pour les actifs ayant à la fois un cours et un PRU.

**Logos** : sans API ni clé, l'app essaie dans l'ordre le logo déjà enregistré, le service public Parqet (par ISIN puis par symbole), les images publiques FMP, puis les initiales. Rien n'est stocké (URL calculées à l'affichage). Désactivable dans Paramètres : seuls le ticker ou l'ISIN sont alors jamais transmis à ces services.

## Comptes utilisateurs et synchronisation (Firebase) — désactivés pour le moment

> Le code est conservé mais **désactivé** (`accountsEnabled: false` dans `config.js`) : l'app fonctionne avec les données sur l'appareil, protégées par le **code PIN** (Paramètres → Sécurité), avec export / import d'un fichier de sauvegarde. Pour réactiver les comptes : passer `accountsEnabled` à `true` et renseigner `firebase` (voir ci-dessous).

Connexion / création de compte par e-mail + mot de passe, déconnexion, récupération par e-mail, suppression du compte. Les données de chaque utilisateur sont stockées dans **Firestore** (`users/{uid}`), lisibles et modifiables **uniquement par leur propriétaire** (`firestore.rules`), et synchronisées entre appareils : écriture transactionnelle avec contrôle de version, détection des conflits (fusion sans perte), reprise après coupure, copie locale pour fonctionner hors-ligne. Les données locales existantes sont migrées vers le compte à la première connexion (fusion sans doublon). Deux comptes ne sont jamais mélangés sur un même appareil.

### Mise en route (≈ 10 min, une seule fois)

1. <https://console.firebase.google.com> → **Ajouter un projet** (Google Analytics non nécessaire).
2. **Build → Authentication → Commencer → Sign-in method → E-mail/Mot de passe → Activer.**
3. **Build → Firestore Database → Créer une base de données** (mode production, région Europe).
4. Onglet **Règles** : collez le contenu de [`firestore.rules`](firestore.rules) puis **Publier**.
5. **Paramètres du projet → Vos applications → Web (`</>`)** → enregistrez l'application → copiez l'objet `firebaseConfig`.
6. **Authentication → Paramètres → Domaines autorisés** : ajoutez `adteixeira89.github.io`.
7. Collez `firebaseConfig` dans [`config.js`](config.js) (clé `firebase`). Ces identifiants sont publics par conception : la sécurité repose sur les règles de l'étape 4.

Tant que `accountsEnabled` est `false` ou `firebase` vide, l'application fonctionne en **mode local** (données sur l'appareil).

Les données du cloud ne sont pas chiffrées de bout en bout (elles sont protégées par l'authentification et les règles Firestore). Le **code de verrouillage** de l'appareil (Paramètres) chiffre en plus la copie locale.

## Imports

- **Relevé de portefeuille** (DEGIRO, Trade Republic, autre ; CSV ou Excel) : choix des colonnes ticker / ISIN, quantité, nom, prix de revient, devise. Les ISIN sont convertis en tickers et les dividendes récupérés automatiquement. **Les actifs déjà présents (même ISIN, ticker ou nom) ne sont jamais modifiés** (quantité, PRU, secteur, logo, dividendes… restent tels quels) : seuls les nouveaux actifs sont ajoutés, un récapitulatif l'indique avant validation.
- **Transactions** (CSV) : achats, ventes, dividendes. Format Trade Republic reconnu par ses en-têtes (`datetime, type, symbol, shares, price, amount, fee, tax…`) ; colonnes modifiables et aperçu avant import. Un dividende y est interprété comme *net reçu* (modifiable en *brut*), la colonne `tax` donne la retenue. Les doublons (identifiant de transaction ou actif + date + montant) sont ignorés. Quantité et prix de revient moyen pondéré sont calculés pour les actifs créés.

> Le format exact des exports varie selon le courtier et sa version : vérifiez l'aperçu avant d'importer.

## Organisation du code

```
index.html  styles.css  config.js          page, style, configuration publique
engine.js   fonctions pures : statuts, prévisions, valeur / performance / répartition (testé sous Node)
market.js   données de marché (relais Yahoo), conversion ISIN, détection de fréquence
cloud.js    Firebase Auth + Firestore (comptes, synchronisation transactionnelle)
vault.js    stockage durable local (localStorage + IndexedDB) et code de verrouillage
payouts.js  calcul mensuel, rappels, export agenda (partagé avec le service worker)
ui.js       composants : formats, fenêtres, tableau configurable, graphiques SVG
pages.js    Portefeuille, Calendrier, Historique, Statistiques
dashboard.js Accueil, Répartition, rubrique Dividendes (onglets)
forms.js    actif, versement, suppressions, comptes, imports CSV
settings.js Paramètres
app.js      état, migration, synchronisation, navigation, démarrage
sw.js       service worker (hors-ligne, rappels)
relay/      relais Cloudflare vers Yahoo Finance
tests/      tests unitaires (Node) et de bout en bout (Playwright)
```

## Tests

```bash
node tests/engine.test.js && node tests/market.test.js        # calculs et données de marché
NODE_PATH=$(npm root -g) LIBDIR=<dossier papaparse+xlsx> node tests/e2e.js   # parcours complets (faux Firebase, faux relais)
```

## Export CSV (tableur)

Paramètres → « Exporter en CSV », ou le bouton **Exporter** de « Mon portefeuille » (respecte le portefeuille sélectionné). Quatre fichiers : **positions** (quantité, PRU, cours, valeur, plus-value, performance, poids, secteur, pays, dividende annuel et rendements), **dividendes reçus** (brut, retenue, frais, net, statut), **transactions** et **valeur mensuelle** du portefeuille (5 ans max, rétrospective sur les positions actuelles tant qu'aucune transaction n'est importée). Format Excel / Numbers / Google Sheets : séparateur « ; », décimales « , », UTF-8 avec BOM, nombres sans symbole monétaire, valeurs inconnues laissées vides (jamais 0), cellules commençant par `=`, `+`, `-` ou `@` neutralisées. Le fichier « positions » peut être ré-importé tel quel par « Importer un relevé » (les actifs existants restent intacts).

## Sauvegarde

Export / restauration d'un fichier JSON depuis Paramètres (feuille de partage sur iPhone). Sur iPhone, l'app installée sur l'écran d'accueil a un stockage **séparé** de Safari : avec un compte, il suffit de s'y connecter ; sans compte, exportez puis restaurez.
