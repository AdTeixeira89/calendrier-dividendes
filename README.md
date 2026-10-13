# Suivi des dividendes

Application web (installable sur téléphone) entièrement dédiée au **suivi des dividendes et des revenus** d'un portefeuille d'actions et d'ETF : prochains versements, prévisions, historique des dividendes reçus, statistiques. Hébergée sur GitHub Pages, sans serveur à maintenir.

## Pages

| Page | Contenu |
|---|---|
| **Accueil** | Bandeau défilant des prochains versements (logo, montant par titre, total selon vos quantités, date et type de date, statut), 7 indicateurs (dividendes annuels estimés, reçus depuis le 1er janvier, estimés du mois, prochain dividende, rendement sur coût, nombre d'actifs, évolution vs année précédente), revenus mensuels et répartition par actif. Bascule **bruts / nets**. Section **Valeur du portefeuille** : valeur de marché, plus / moins-value latente et rendement sur cours. |
| **Mon portefeuille** | Actifs, quantités, prix de revient (PRU, dans la devise de votre choix), investi, cours, valeur, +/- value, dividende annuel estimé, prochain versement, rendement sur coût et sur cours… Tableau avec **« Colonnes à afficher »**, tri, recherche, filtres (type, verse un dividende / sans dividende / données manquantes), **suppression multiple** (cases, « Tout sélectionner », compteur, « Annuler la sélection », confirmation, annulation possible). |
| **Calendrier des dividendes** | Vues mois / année / logos, filtres actif et statut, versement attendu → « Enregistrer comme reçu ». |
| **Historique** | Dividendes reçus (brut, retenue, frais, net, devise, source) et opérations (achats / ventes). Filtres année, mois, actif, statut. Import CSV (Trade Republic…), saisie manuelle, pré-remplissage « à vérifier ». |
| **Statistiques** | Revenus mensuels, répartition, prévision des 12 mois, dividendes reçus par année, par compte / devise / zone / type, principaux contributeurs, ETF capitalisants. |
| **Paramètres** | Compte et synchronisation, devise d'affichage, brut/net par défaut, portefeuilles, données de marché, sauvegarde, code de verrouillage de l'appareil, rappels. |

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

## Comptes utilisateurs et synchronisation (Firebase)

Connexion / création de compte par e-mail + mot de passe, déconnexion, récupération par e-mail, suppression du compte. Les données de chaque utilisateur sont stockées dans **Firestore** (`users/{uid}`), lisibles et modifiables **uniquement par leur propriétaire** (`firestore.rules`), et synchronisées entre appareils : écriture transactionnelle avec contrôle de version, détection des conflits (fusion sans perte), reprise après coupure, copie locale pour fonctionner hors-ligne. Les données locales existantes sont migrées vers le compte à la première connexion (fusion sans doublon). Deux comptes ne sont jamais mélangés sur un même appareil.

### Mise en route (≈ 10 min, une seule fois)

1. <https://console.firebase.google.com> → **Ajouter un projet** (Google Analytics non nécessaire).
2. **Build → Authentication → Commencer → Sign-in method → E-mail/Mot de passe → Activer.**
3. **Build → Firestore Database → Créer une base de données** (mode production, région Europe).
4. Onglet **Règles** : collez le contenu de [`firestore.rules`](firestore.rules) puis **Publier**.
5. **Paramètres du projet → Vos applications → Web (`</>`)** → enregistrez l'application → copiez l'objet `firebaseConfig`.
6. **Authentication → Paramètres → Domaines autorisés** : ajoutez `adteixeira89.github.io`.
7. Collez `firebaseConfig` dans [`config.js`](config.js) (clé `firebase`). Ces identifiants sont publics par conception : la sécurité repose sur les règles de l'étape 4.

Tant que `config.js` n'est pas renseigné, l'application fonctionne en **mode local** (données sur l'appareil, comme avant).

Les données du cloud ne sont pas chiffrées de bout en bout (elles sont protégées par l'authentification et les règles Firestore). Le **code de verrouillage** de l'appareil (Paramètres) chiffre en plus la copie locale.

## Imports

- **Relevé de portefeuille** (DEGIRO, Trade Republic, autre ; CSV ou Excel) : choix des colonnes ticker / ISIN, quantité, nom, prix de revient, devise. Les ISIN sont convertis en tickers et les dividendes récupérés automatiquement.
- **Transactions** (CSV) : achats, ventes, dividendes. Format Trade Republic reconnu par ses en-têtes (`datetime, type, symbol, shares, price, amount, fee, tax…`) ; colonnes modifiables et aperçu avant import. Un dividende y est interprété comme *net reçu* (modifiable en *brut*), la colonne `tax` donne la retenue. Les doublons (identifiant de transaction ou actif + date + montant) sont ignorés. Quantité et prix de revient moyen pondéré sont calculés pour les actifs créés.

> Le format exact des exports varie selon le courtier et sa version : vérifiez l'aperçu avant d'importer.

## Organisation du code

```
index.html  styles.css  config.js          page, style, configuration publique
engine.js   fonctions pures : statuts, prévisions, indicateurs (testé sous Node)
market.js   données de marché (relais Yahoo), conversion ISIN, détection de fréquence
cloud.js    Firebase Auth + Firestore (comptes, synchronisation transactionnelle)
vault.js    stockage durable local (localStorage + IndexedDB) et code de verrouillage
payouts.js  calcul mensuel, rappels, export agenda (partagé avec le service worker)
ui.js       composants : formats, fenêtres, tableau configurable, graphiques SVG
pages.js    Accueil, Portefeuille, Calendrier, Historique, Statistiques
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

## Sauvegarde

Export / restauration d'un fichier JSON depuis Paramètres (feuille de partage sur iPhone). Sur iPhone, l'app installée sur l'écran d'accueil a un stockage **séparé** de Safari : avec un compte, il suffit de s'y connecter ; sans compte, exportez puis restaurez.
