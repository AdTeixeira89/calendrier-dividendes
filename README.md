# Calendrier Dividendes

Application web (100% statique, sans serveur) pour suivre les dates de versement de dividendes et les dates de résultats trimestriels/semestriels/annuels de votre portefeuille d'actions, sous forme de calendrier annuel ou mensuel.

## Fonctionnalités

- **Plusieurs comptes / portefeuilles** (ex : CTO et PEA Trade Republic) : chaque action est rattachée à un compte. Des onglets en haut de page permettent de consulter chaque compte séparément ou "Tous les comptes" à la fois (calendrier, graphiques et récapitulatif s'adaptent automatiquement, avec un sous-total par compte dans la vue combinée). Gestion des comptes (ajout, renommage, suppression) via le bouton 👛 en haut à droite.
- Ajout d'actions (ticker + quantité), US et Europe, une par une **ou en une fois** via import CSV/Excel.
- **Import d'un relevé de courtier** (Degiro ou autre) au format CSV ou Excel : vous choisissez quelle colonne contient le ticker et laquelle contient la quantité (aperçu des données avant import), puis toutes les lignes sont ajoutées d'un coup. Les PDF ne sont volontairement pas analysés automatiquement (formats trop variables d'un courtier à l'autre) — exportez plutôt en CSV depuis la page "Portefeuille" de Degiro.
- **Auto-compléter les lignes** : après un import, un bouton lance la récupération automatique (nom, logo, dividendes, résultats) pour toutes les lignes qui n'ont pas encore de données, l'une après l'autre.
- Récupération automatique optionnelle du nom, logo, historique de dividendes et calendrier de résultats via l'API gratuite [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs). Si l'auto-récupération échoue ou si vous n'avez pas de clé, tout est saisissable à la main.
- Projection automatique des échéances futures à partir de la dernière date connue + fréquence (mensuelle, trimestrielle, semestrielle, annuelle), clairement marquées "estimé".
- Vue calendrier **Année** (12 mini-mois) ou **Mois** (détaillée).
- Filtre **Ex-dividende / Mise en paiement** pour choisir quelle date afficher.
- Filtre pour afficher/masquer les dates de résultats.
- Bandeau défilant ("ticker tape") des prochaines échéances.
- **Graphiques** : montant total de dividendes par mois pour l'année affichée, et évolution du total annuel sur plusieurs années (connu + projeté), par devise.
- Logos des sociétés, panneau récapitulatif du portefeuille, export/import JSON pour sauvegarder vos données.
- Toutes les données restent dans le navigateur (`localStorage`) — rien n'est envoyé à un serveur, à part les appels directs à l'API financière si vous l'utilisez.

## Déploiement sur GitHub Pages

1. Créez un nouveau dépôt GitHub (par ex. `calendrier-dividendes`).
2. Ajoutez les fichiers `index.html` et `app.js` à la racine du dépôt.
3. Poussez sur la branche `main` :
   ```bash
   git init
   git add index.html app.js README.md
   git commit -m "Calendrier dividendes"
   git branch -M main
   git remote add origin https://github.com/<votre-utilisateur>/calendrier-dividendes.git
   git push -u origin main
   ```
4. Dans le dépôt GitHub : **Settings → Pages → Source**, choisissez la branche `main` et le dossier `/ (root)`.
5. L'app sera disponible quelques minutes plus tard à l'adresse :
   `https://<votre-utilisateur>.github.io/calendrier-dividendes/`

## Clé API (optionnelle)

Pour la récupération automatique des dividendes et résultats :

1. Créez un compte gratuit sur [financialmodelingprep.com](https://site.financialmodelingprep.com/developer/docs).
2. Copiez votre clé API.
3. Dans l'app, cliquez sur l'icône ⚙ **Paramètres** et collez la clé.
4. Lors de l'ajout d'une action, cliquez sur **"Récupérer automatiquement"**.

Le plan gratuit a un quota de requêtes journalier et certains endpoints peuvent être limités selon les évolutions de l'API — si la récupération échoue, complétez simplement les champs à la main (montant, dernière ex-date, dernière date de paiement, fréquence).

## Format des tickers

- Actions américaines : symbole seul, ex. `AAPL`, `MSFT`.
- Euronext Paris : ajoutez `.PA`, ex. `AI.PA` (Air Liquide).
- Autres places européennes : `.AS` (Amsterdam), `.DE` (Allemagne), `.L` (Londres), `.MI` (Milan), etc.

## Sauvegarde de vos données

Les données sont stockées dans le navigateur. Pensez à utiliser **Exporter (JSON)** régulièrement pour garder une copie de secours, notamment avant de vider le cache du navigateur ou de changer d'appareil. **Importer** permet de recharger un fichier exporté précédemment.
