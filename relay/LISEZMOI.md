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
