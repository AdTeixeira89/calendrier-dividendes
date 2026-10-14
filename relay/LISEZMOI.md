# Relais Yahoo Finance (Cloudflare Workers)

Permet à l'app de récupérer les dividendes des actions **européennes** (gratuit, sans clé).

## Déploiement (≈ 10 min, depuis un navigateur)

1. Créez un compte gratuit sur https://dash.cloudflare.com/sign-up (pas de carte bancaire).
2. Menu **Workers & Pages** → **Create** → **Create Worker** → nommez-le (ex. `dividendes-relais`) → **Deploy**.
3. Cliquez **Edit code**, supprimez le code d'exemple, collez le contenu de `worker.js`, puis **Deploy**.
4. Copiez l'adresse du worker (du type `https://dividendes-relais.<votre-nom>.workers.dev`).
5. Dans l'app : ⚙ **Paramètres** → champ **Adresse du relais Yahoo** → collez l'adresse → **Enregistrer**.

Si votre site GitHub Pages change d'adresse, modifiez `ALLOWED_ORIGINS` en haut de `worker.js`.
Le plan gratuit Cloudflare autorise 100 000 requêtes par jour.

## Mise à jour du relais (historique de cours quotidien, fractionnements)

La version actuelle de `worker.js` accepte en plus deux paramètres facultatifs (`range`, `interval`) et renvoie aussi les **fractionnements d'actions**. L'application demande alors **10 ans de cours quotidiens**, ce qui permet les périodes 1 M / 3 M / 6 M de la courbe du portefeuille et la reconstitution depuis votre première opération.

Pour en profiter : Cloudflare → votre worker → **Edit code** → remplacez le code par le nouveau `worker.js` → **Deploy**. Aucune autre action : sans cette mise à jour l'application continue de fonctionner (5 ans de cours mensuels), et le signale sous la courbe.
