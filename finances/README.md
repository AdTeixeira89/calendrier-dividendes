# Foyer — Finances familiales

PWA de gestion financière pour le foyer : revenus, dépenses, épargne, dettes, patrimoine, partagés entre
les membres du foyer. React + TypeScript + Firebase. Architecture détaillée : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> État : **phase 1 (socle)** — comptes, foyers, invitation du conjoint, navigation, design system,
> PWA, règles de sécurité. Les modules financiers arrivent à partir de la phase 2.

## Démarrer en local (sans projet Firebase)

Prérequis : Node 20+ et Java 11+ (pour les émulateurs Firebase).

```bash
cd finances
npm install
npm run dev:emulators                    # terminal 1 : Auth, Firestore, Storage + UI sur :4000
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
