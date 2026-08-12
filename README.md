Calendrier Dividendes
Application web (100% statique, sans serveur) pour suivre les dates de versement de dividendes et les dates de résultats trimestriels/semestriels/annuels de votre portefeuille d'actions, sous forme de calendrier annuel ou mensuel.
Fonctionnalités
Ajout d'actions (ticker + quantité), US et Europe.
Récupération automatique optionnelle du nom, logo, historique de dividendes et calendrier de résultats via l'API gratuite Financial Modeling Prep. Si l'auto-récupération échoue ou si vous n'avez pas de clé, tout est saisissable à la main.
Projection automatique des échéances futures à partir de la dernière date connue + fréquence (mensuelle, trimestrielle, semestrielle, annuelle), clairement marquées "estimé".
Vue calendrier Année (12 mini-mois) ou Mois (détaillée).
Filtre Ex-dividende / Mise en paiement pour choisir quelle date afficher.
Filtre pour afficher/masquer les dates de résultats.
Bandeau défilant ("ticker tape") des prochaines échéances.
Logos des sociétés, panneau récapitulatif du portefeuille, export/import JSON pour sauvegarder vos données.
Toutes les données restent dans le navigateur (localStorage) — rien n'est envoyé à un serveur, à part les appels directs à l'API financière si vous l'utilisez.
Déploiement sur GitHub Pages
Créez un nouveau dépôt GitHub (par ex. calendrier-dividendes).
Ajoutez les fichiers index.html et app.js à la racine du dépôt.
Poussez sur la branche main :
bash
   git init
   git add index.html app.js README.md
   git commit -m "Calendrier dividendes"
   git branch -M main
   git remote add origin https://github.com/<votre-utilisateur>/calendrier-dividendes.git
   git push -u origin main
Dans le dépôt GitHub : Settings → Pages → Source, choisissez la branche main et le dossier / (root).
L'app sera disponible quelques minutes plus tard à l'adresse : https://<votre-utilisateur>.github.io/calendrier-dividendes/
Clé API (optionnelle)
Pour la récupération automatique des dividendes et résultats :
Créez un compte gratuit sur financialmodelingprep.com.
Copiez votre clé API.
Dans l'app, cliquez sur l'icône ⚙ Paramètres et collez la clé.
Lors de l'ajout d'une action, cliquez sur "Récupérer automatiquement".
Le plan gratuit a un quota de requêtes journalier et certains endpoints peuvent être limités selon les évolutions de l'API — si la récupération échoue, complétez simplement les champs à la main (montant, dernière ex-date, dernière date de paiement, fréquence).
Format des tickers
Actions américaines : symbole seul, ex. AAPL, MSFT.
Euronext Paris : ajoutez .PA, ex. AI.PA (Air Liquide).
Autres places européennes : .AS (Amsterdam), .DE (Allemagne), .L (Londres), .MI (Milan), etc.
Sauvegarde de vos données
Les données sont stockées dans le navigateur. Pensez à utiliser Exporter (JSON) régulièrement pour garder une copie de secours, notamment avant de vider le cache du navigateur ou de changer d'appareil. Importer permet de recharger un fichier exporté précédemment.
