# Monelya — Finances familiales

PWA de gestion financière pour le foyer : revenus, dépenses, épargne, dettes, patrimoine, partagés entre
les membres du foyer. React + TypeScript + Firebase. Architecture détaillée : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> État : **phases 1 à 6 livrées** — comptes/foyers, dépenses/revenus/budget, épargne/dettes/abonnements,
> scanner de tickets (OCR) et import de documents, IA Finance (export CSV/texte + Q&A, clé API à configurer),
> patrimoine (actifs, patrimoine net, évolution), alertes (accueil + notifications push) et rythme des dépenses.
> Reste en phase 7 : export PDF, accessibilité, tests E2E intégrés.

## Démarrer en local (sans projet Firebase)

Prérequis : Node 20+ et Java 11+ (pour les émulateurs Firebase).

```bash
cd finances
npm install
cd functions && npm install && npm run build && cd ..
npm run dev:emulators                    # terminal 1 : Auth, Firestore, Storage, Functions + UI sur :4000
VITE_USE_EMULATORS=true npm run dev      # terminal 2 : http://localhost:5173
```

## Brancher un vrai projet Firebase

1. Créez un projet sur <https://console.firebase.google.com>.
2. Activez **Authentication → E-mail/Mot de passe**, **Firestore** (mode production) et **Storage**.
3. Ajoutez une application Web, puis copiez sa configuration :
   ```bash
   cp .env.example .env.local   # et renseignez les VITE_FIREBASE_*
   cp .firebaserc.example .firebaserc   # et indiquez l'identifiant du projet
   ```
4. Déployez les règles et index, puis l'application :
   ```bash
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes,storage
   npm run build && npx firebase deploy --only hosting
   ```

## Activer l'IA Finance (phase 5)

L'architecture (Cloud Function `askFinance`, bilan mensuel planifié) est en place, mais aucune clé IA
n'est configurée : tant qu'elle ne l'est pas, la page **IA Finance** affiche clairement « IA
indisponible » (jamais de crash, jamais de chiffre inventé). Pour l'activer :

1. Créez une clé sur <https://console.anthropic.com>.
2. Nécessite le plan Firebase **Blaze** (facturation à l'usage, requis pour les Cloud Functions).
3. Enregistrez la clé dans Secret Manager :
   ```bash
   npx firebase functions:secrets:set ANTHROPIC_API_KEY --project <votre-projet>
   ```
4. Déployez les fonctions :
   ```bash
   cd functions && npm run build && cd ..
   npx firebase deploy --only functions --project <votre-projet>
   ```

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification TypeScript + build de production (PWA) |
| `npm run lint` | ESLint |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:rules` | Tests des Security Rules Firestore/Storage contre les émulateurs |
| `npm run icons` | Régénère les icônes PWA depuis `public/favicon.svg` |

## Partager avec son/sa conjoint(e)

1. Créez votre compte puis **Créer notre foyer**.
2. **Foyer & membres → Générer une invitation** : partagez le lien ou le code (usage unique, 7 jours).
3. L'autre personne ouvre le lien, crée son compte et rejoint le foyer : vous voyez les mêmes finances.
