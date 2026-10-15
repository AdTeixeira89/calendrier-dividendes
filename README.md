# Suivi de portefeuille et de dividendes

Application web (installable sur téléphone) de **suivi complet d'un portefeuille d'actions et d'ETF** : valeur et performance dans le temps, diversification par secteur et par pays, et suivi détaillé des dividendes (prochains versements, prévisions, historique, statistiques). Hébergée sur GitHub Pages, sans serveur à maintenir.

## Navigation (5 rubriques)

| Rubrique | Contenu |
|---|---|
| **Accueil** | Trois blocs seulement, dans cet ordre. **1. Valeur du portefeuille** : valeur actuelle des positions détenues, **plus-value totale** (sur les positions ayant un PRU et un cours), **plus-value journalière** (mouvement de marché de la dernière séance sur les quantités détenues à la clôture précédente : un achat du jour, un dépôt ou un retrait n'y comptent pas ; « — » si la clôture précédente est inconnue), courbe de la valeur (1 M → Tout) et, discret dans un coin de la courbe, le **rendement annuel moyen** (TRI / XIRR, voir plus bas). **2. Dividendes de l'année**, à côté de la valeur sur ordinateur (empilés sur téléphone). **3. PERFORMANCES** : liste des **5 positions les plus rentables** et des **5 plus négatives** (plus-value latente / montant investi, positions avec PRU et cours). Œil pour masquer les chiffres. |
| **Mon portefeuille** | Résumé, puis trois sections : **ETF**, **Actions** et, si besoin, **À classer** (actifs dont la catégorie n'est pas identifiée : jamais classés « action » par défaut). La catégorie vient des données de marché (Yahoo : ETF / action), à défaut du nom (iShares, UCITS, ETF…), ou de **votre choix**, modifiable dans la colonne « Catégorie » ou la fiche de l'actif : il est enregistré (`typeLocked`) et jamais écrasé par un import ou une actualisation. Onglets **Opérations** et **Clôturées**. Tableaux avec colonnes à afficher, tri, recherche, filtres, suppression multiple avec annulation. |
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
ledger.js   import d'historique (DEGIRO…) : lecture, grand livre / PRU, plan d'import idempotent (module pur, testé sous Node)
engine.js   fonctions pures : statuts, prévisions, valeur / performance / répartition / historique du portefeuille (testé sous Node)
market.js   données de marché (relais Yahoo), conversion ISIN, détection de fréquence
cloud.js    Firebase Auth + Firestore (comptes, synchronisation transactionnelle)
vault.js    stockage durable local (localStorage + IndexedDB) et code de verrouillage
payouts.js  calcul mensuel, rappels, export agenda (partagé avec le service worker)
ui.js       composants : formats, fenêtres, tableau configurable, graphiques SVG
pages.js    Portefeuille, Calendrier, Historique, Statistiques
dashboard.js Accueil, Répartition, rubrique Dividendes (onglets)
history.js  import DEGIRO (aperçu, référence, confirmation, retour arrière), opérations par actif, positions clôturées
check.js    contrôle de l'historique : diagnostic et corrections annulables (split, fusion d'ISIN, sortie, archivage)
forms.js    actif, versement, suppressions, comptes, imports CSV
settings.js Paramètres
app.js      état, migration, synchronisation, navigation, démarrage
sw.js       service worker (hors-ligne, rappels)
relay/      relais Cloudflare vers Yahoo Finance
tests/      tests unitaires (Node) et de bout en bout (Playwright)
```

## Tests

```bash
node tests/engine.test.js && node tests/market.test.js && node tests/ledger.test.js   # calculs, données de marché, import d'historique
NODE_PATH=$(npm root -g) LIBDIR=<dossier papaparse+xlsx> node tests/e2e.js   # parcours complets (faux Firebase, faux relais)
```

## Import intelligent de l'historique DEGIRO (fiabilisé)

**Paramètres → Sauvegarde → « Importer l'historique DEGIRO »**, ou onglet **Opérations** de « Mon portefeuille ». Téléchargez dans DEGIRO l'export CSV de vos *Transactions* (ou le *Relevé de compte*), puis choisissez-le : l'application affiche un récapitulatif **avant toute modification**.

- **Lecture** : colonnes reconnues d'après leur *sens* (français, anglais, néerlandais, allemand, espagnol…), y compris les colonnes de devise sans titre de DEGIRO ; séparateurs, encodage (UTF-8 puis Windows-1252), nombres à l'européenne (`1 234,56`) ou à l'anglaise (`1,234.56`), dates `jj-mm-aaaa`. Les colonnes restent modifiables à la main. Les lignes illisibles ou ambiguës sont listées (avec leur numéro) sans bloquer les autres.
- **Aucun doublon, rien d'écrasé** : chaque opération a un identifiant stable (empreinte du contenu : ISIN, date, heure, sens, quantité, prix, montant, n° d'ordre + rang d'occurrence). Deux opérations légitimes le même jour restent deux opérations ; une opération déjà saisie autrement (même date, sens, quantité, prix) est reconnue. **Réimporter le même fichier ne change rien** (même trié à l'envers).
- **Positions** : détenue et absente → créée avec quantité et **PRU calculé** (coût moyen pondéré, frais d'achat inclus, montants en EUR au taux réel de l'exécution) ; vendue en partie → conservée ; **vendue en totalité → non ajoutée au portefeuille actuel** (archivée, opérations et résultat réalisé conservés) ; déjà présente → **conservée telle quelle** (PRU, quantité, nom, logo…). Seules les informations *manquantes* (PRU vide, ISIN absent) sont complétées, et c'est décochable. Les divergences de quantité sont signalées ; « Aligner sur l'historique » (quantité et PRU) n'a lieu que si vous cochez la case de l'actif. Un historique incohérent (vente supérieure aux achats connus, position absente de vos positions réelles) n'est **jamais** ajouté au portefeuille actuel : ses transactions sont conservées « à vérifier » dans le Contrôle de l'historique.
- **Retour arrière** : une copie des données est conservée juste avant l'import (chiffrée avec le reste si un code est défini) ; bouton « Annuler l'import » juste après, ou dans Paramètres.
- **Opérations** (Mon portefeuille → Opérations) : par actif, date et type ; quantité, coût cumulé et PRU **après chaque opération**, résultat réalisé de chaque vente ; onglet **Clôturées** pour les positions entièrement vendues.
- **Courbe de l'accueil** : valeur reconstituée = quantités issues des opérations (ramenées à la base actuelle des fractionnements) × cours historiques × taux de change du mois, périodes 1 M / 3 M / 6 M / 1 an / 5 ans / Tout, infobulle détaillée (date, valeur, capital investi, principales positions), synthèse « valeur de départ → actuelle = apports nets + gain des marchés » et courbe de **performance pondérée dans le temps** (achats = apports, ventes = retraits : ils ne créent pas de performance). Aucun cours n'est inventé : un actif sans cours à une date rend le point *partiel* (pointillés + message).

Limites à connaître : l'export *Transactions* de DEGIRO ne contient ni dépôts/retraits d'espèces ni dividendes ni opérations sur titres (le relevé de compte contient des achats/ventes dans sa description, sans frais séparés ; dividendes, dépôts et frais y sont comptés mais non importés) ; la performance « hors apports » considère donc les achats et ventes de titres comme flux. Un **fractionnement** n'apparaît pas dans l'export : il est repéré (données de marché, description d'un relevé de compte, ligne à montant nul) mais **appliqué seulement après votre validation** dans le Contrôle de l'historique (voir « Fiabilité »). Cours quotidiens : 10 ans (nécessite la mise à jour du relais, voir `relay/LISEZMOI.md`) ; sans elle, 5 ans de cours mensuels.

### Fiabilité : ce qui a été corrigé et comment ça marche

**Causes identifiées** (reproduites par des tests) des positions « achetées en 2019 » et des quantités fausses : (1) l'export *Transactions* de DEGIRO ne contient **ni les splits / regroupements, ni les changements d'ISIN, fusions, radiations ou échanges de titres** ; (2) un achat réalisé sous un **ancien ISIN** dont la vente apparaît sous le nouvel ISIN laissait une position fantôme ; (3) un regroupement (100 → 10 titres) puis une vente de 10 laissait « 90 titres achetés en 2019 » ; (4) un split 2 pour 1 puis une vente partielle donnait une quantité fausse ; (5) une vente supérieure aux achats connus entraînait le **rejet silencieux** de ses transactions ; (6) les lignes à **montant nul** (titres livrés gratuitement lors d'un split) n'étaient pas distinguées.

**Règles appliquées maintenant**
- Une position calculée n'entre dans « Mon portefeuille » que si le grand livre est cohérent **et** (quand une référence existe) si elle figure dans vos **positions réelles**. Référence = le **relevé de portefeuille DEGIRO** que vous chargez (recommandé), sinon vos positions saisies ou importées directement. Sinon (solde négatif, absente de la réalité, quantité ≠ position réelle) elle est **archivée « à vérifier »** : ses transactions sont toutes conservées, rien n'est ajouté au portefeuille actuel, rien n'est perdu.
- **Opérations sur titres explicites** (`state.corp`) : split / regroupement (ratio) et sortie hors transaction. Elles ne sont **jamais déduites d'une anomalie de quantité** : un split n'est appliqué qu'après **votre validation**, qu'il vienne des données de marché (Yahoo, proposé uniquement s'il rend la quantité cohérente avec la position réelle), du CSV (ratio lu dans la description d'un relevé de compte) ou de votre saisie. Un split multiplie la quantité et **conserve le coût total** (le PRU est divisé par le ratio) : ce n'est jamais un achat. Une ligne à montant nul n'est jamais importée comme achat gratuit.
- **Changement d'ISIN / fusion** : fusion validée par vous (les transactions sont réunies, rien n'est supprimé) ; les prochains imports rattachent l'ancien ISIN au nouveau.
- Positions « calculées » (issues de l'import) : **recalculées** depuis les transactions à chaque import ; une position saisie ou dont vous avez modifié la quantité / le PRU (`manual`) n'est **jamais** touchée.
- **Sources conservées** : le CSV d'origine (3 derniers fichiers) et son rapport (lues, reconnues, ignorées…), séparés des données calculées (PRU, plus-values, performances sont recalculés, jamais « importés »). L'historique de cours (valorisation) est conservé à part des transactions.
- Données de marché : cours quotidiens 10 ans + fractionnements (relais à jour) ; valeur reconstituée = quantités réellement détenues × cours (ramenés à la base actuelle des splits du marché, seuls cours ajustés).

**Contrôle de l'historique** (Paramètres, ou « Contrôle de l'historique » dans Mon portefeuille → Opérations ; un bandeau d'alerte apparaît dans Mon portefeuille s'il y a des anomalies) : transactions lues / reconnues / ignorées (et pourquoi), quantités négatives, positions à quantité nulle encore au portefeuille, écarts de quantité et de PRU, comparaison application / calcul / **positions réelles**, transactions sans date / montant / ISIN, splits et changements d'ISIN possibles. Chaque anomalie indique l'actif, les transactions concernées, la **cause probable** et l'**action recommandée** avec des boutons (rechercher / valider un split, saisir un split, fusionner deux ISIN, marquer une sortie, archiver, ajouter au portefeuille, recalculer). Chaque correction est annulable (copie avant action) et **ne supprime aucune transaction**.

**Méthode de calcul du PRU (coût moyen pondéré)**
- *Achat* : quantité +, coût + montant payé **frais d'achat inclus** (montants en EUR au taux réel de l'exécution, tels que DEGIRO les a débités). PRU = coût / quantité.
- *Vente* : quantité −, coût − (PRU moyen × quantité vendue) : **le PRU ne change pas** à la vente. Résultat réalisé = produit de la vente **net des frais de vente** − coût sorti ; les frais de vente ne sont donc comptés qu'une fois, dans le résultat, jamais retirés du PRU.
- *Vente partielle* : la position reste, avec le même PRU. *Vente totale* : quantité et coût à zéro ; un **rachat ultérieur ouvre un nouveau cycle** (nouvelle position économique, PRU recalculé sans mélanger l'ancien).
- *Split / regroupement* : quantité × ratio, coût inchangé. *Sortie hors transaction* : quantité et coût à zéro, sans résultat réalisé inventé.
- Dividendes, dépôts, retraits, frais de connexion et conversions de devises ne sont jamais traités comme des achats ou des ventes.

**Rendement annuel moyen (accueil)** : TRI / XIRR sur les flux datés (chaque achat en sortie, chaque vente en entrée, en devise de base au taux du mois) + valeur actuelle, **dividendes exclus**. « Données insuffisantes » si l'historique couvre moins d'un an, si une position n'a pas d'historique d'opérations cohérent, ou si des cours manquent. La courbe PERFORMANCES, elle, est pondérée dans le temps (Dietz modifié par intervalle).

## Export CSV (tableur)

Paramètres → « Exporter en CSV », ou le bouton **Exporter** de « Mon portefeuille » (respecte le portefeuille sélectionné). Quatre fichiers : **positions** (quantité, PRU, cours, valeur, plus-value, performance, poids, secteur, pays, dividende annuel et rendements), **dividendes reçus** (brut, retenue, frais, net, statut), **transactions** et **valeur mensuelle** du portefeuille (5 ans max, rétrospective sur les positions actuelles tant qu'aucune transaction n'est importée). Format Excel / Numbers / Google Sheets : séparateur « ; », décimales « , », UTF-8 avec BOM, nombres sans symbole monétaire, valeurs inconnues laissées vides (jamais 0), cellules commençant par `=`, `+`, `-` ou `@` neutralisées. Le fichier « positions » peut être ré-importé tel quel par « Importer un relevé » (les actifs existants restent intacts).

## Sauvegarde

Export / restauration d'un fichier JSON depuis Paramètres (feuille de partage sur iPhone). Sur iPhone, l'app installée sur l'écran d'accueil a un stockage **séparé** de Safari : avec un compte, il suffit de s'y connecter ; sans compte, exportez puis restaurez.
