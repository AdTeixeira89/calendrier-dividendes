# Foyer — Architecture

Application de gestion financière familiale : PWA React + TypeScript + Firebase.
Principe UX absolu : **comprendre sa situation financière en moins de 30 secondes.**

---

## 1. Architecture globale

```
┌──────────────────────── Client (PWA, mobile first) ────────────────────────┐
│  pages/        écrans (routes)                                             │
│  components/   design system (ui/) + navigation (layout/) + charts/        │
│  hooks/        accès aux contextes (auth, foyer, thème, réseau)            │
│  services/     SEULE couche qui parle à Firebase (+ journal d'audit)       │
│  domain calc   utils/ : calculs purs et testés (montants, %, projections)  │
│  ai/  ocr/     adaptateurs interchangeables (phases 4-5)                   │
└──────────────┬─────────────────────────────────────────────┬───────────────┘
               │ SDK Firebase (cache IndexedDB, hors-ligne)  │ HTTPS (callable)
      ┌────────▼────────┐  ┌───────────────┐        ┌────────▼──────────────┐
      │ Firestore       │  │ Storage       │        │ Cloud Functions        │
      │ données foyer   │  │ tickets, PDF  │        │ IA, OCR, bilans,       │
      │ + Security Rules│  │ + Rules       │        │ suppression de foyer   │
      └─────────────────┘  └───────────────┘        └───────────────────────┘
```

Règles de conception :

- **Les pages n'appellent jamais Firestore directement** : elles passent par `services/`. Changer de backend
  (ou ajouter une synchro bancaire plus tard) ne touche pas l'interface.
- **Tous les montants sont des entiers en centimes** (`amountCents`) : aucune erreur d'arrondi.
- **Les calculs financiers sont des fonctions pures** (`utils/`) testées unitairement ; l'IA les réutilise
  au lieu de calculer elle-même.
- **Toute écriture financière est journalisée** dans le même batch atomique (`auditLog`).
- **Hors-ligne** : cache Firestore persistant (IndexedDB, multi-onglets) + service worker (coquille de l'app).

## 2. Stack technique

| Besoin | Choix | Pourquoi |
| --- | --- | --- |
| UI | React 19 + TypeScript strict | Écosystème, typage fort (`strict`, `noUncheckedIndexedAccess`) |
| Build | Vite | Rapide, PWA via `vite-plugin-pwa` (Workbox) |
| Routage | React Router | Routes protégées, `basename` configurable |
| Style | CSS Modules + tokens CSS | Zéro runtime, thèmes sombre/clair par variables |
| Icônes | lucide-react | Modernes, tree-shakées |
| Police | Inter Variable (auto-hébergée) | Lisible, chiffres tabulaires, fonctionne hors-ligne |
| Backend | Firebase Auth, Firestore, Storage, Functions | Temps réel multi-appareils, règles de sécurité déclaratives |
| Graphiques (phase 2) | Recharts | Déclaratif, responsive, léger |
| OCR (phase 4) | Tesseract.js (local) + extraction IA (Function) | Voir §7 |
| IA (phase 5) | Adaptateur fournisseur (Claude par défaut) via Cloud Function | Voir §6 |
| Tests | Vitest, Testing Library, `@firebase/rules-unit-testing` + émulateurs | Règles de sécurité testées |
| Hébergement | Firebase Hosting (recommandé) ou GitHub Pages | Rewrites SPA + en-têtes de sécurité |

## 3. Architecture Firebase

- **Authentication** : e-mail / mot de passe (création, connexion, déconnexion, mot de passe oublié,
  session persistante IndexedDB). Fournisseurs Google/Apple ajoutables sans changer le modèle.
- **Firestore** : toutes les données d'un foyer sous `households/{householdId}/…`.
- **Storage** : `households/{householdId}/{receipts|documents}/{fichier}` — images et PDF < 15 Mo.
- **Cloud Functions** (à partir de la phase 4) : appels OCR/IA (clés API jamais dans le client),
  bilan mensuel planifié, suppression récursive d'un foyer, export PDF.
- **Émulateurs** : tout le développement et les tests de règles tournent en local (`demo-finances`).

## 4. Structure Firestore détaillée

```
users/{uid}
  displayName, email, activeHouseholdId, createdAt, updatedAt

invites/{code}                          ← code aléatoire, usage unique, 7 jours max
  householdId, householdName, createdBy, createdAt, expiresAt, usedBy, usedAt

households/{householdId}
  name, currency ("EUR"), ownerId,
  memberIds: [uid…]                     ← appartenance (requêtes array-contains)
  roles: { uid: "owner"|"member"|"viewer" }
  createdAt, createdBy, updatedAt, updatedBy
  │
  ├── members/{uid}        uid, displayName, email, role, joinedAt, inviteCode?
  ├── auditLog/{id}        entityType, entityId, action, before, after, changedFields, by, at
  │
  │   ── Données financières (champs communs : householdId, createdBy, createdAt, updatedBy, updatedAt)
  ├── categories/{id}      name, parentId|null, kind (expense|income), icon, color, order, archived
  ├── budgets/{YYYY-MM}    lines: { categoryId: amountCents }
  ├── expenses/{id}        amountCents, date, categoryId, subcategoryId, merchant, paymentMethod,
  │                        memberId, scope (personal|shared), kind (one_off|recurring|exceptional),
  │                        recurrenceId?, note, attachmentIds[], source (manual|ocr|import|bank)
  ├── incomes/{id}         amountCents, date, type (salary|bonus|allowance|rental|…), memberId,
  │                        scope, frequency (monthly|yearly|one_off), recurrenceId?, note
  ├── debts/{id}           type (mortgage|works|consumer|car|personal|other), lender, contractNumber?,
  │                        principalCents, outstandingCents, annualRate, termMonths, startDate,
  │                        monthlyPaymentCents, insuranceCents, feesCents
  ├── savingsGoals/{id}    name, targetCents, currentCents, targetDate?, plannedMonthlyCents
  ├── goals/{id}           type, label, targetCents, linkedEntity?, targetDate?
  ├── subscriptions/{id}   name, amountCents, period (monthly|yearly), nextDate, usage?, categoryId
  ├── assets/{id}          type (account|savings|investment|real_estate|vehicle|other), valueCents,
  │                        valuedAt, history[]
  ├── documents/{id}       storagePath, mimeType, kind (receipt|invoice|statement|contract…),
  │                        status (uploaded|extracted|validated|rejected), extraction {…}, linkedIds[]
  ├── receipts/{id}        documentId, merchant, date, totalCents, vatCents?, lines[{label,qty,unitCents}]
  ├── alerts/{id}          rule, threshold, enabled, lastTriggeredAt
  ├── reports/{YYYY-MM}    bilan mensuel figé (chiffres + texte IA + sources)
  └── settings/{id}        préférences du foyer (alertes, budget par défaut…)
```

Choix clés :

- **Sous-collections par foyer** : l'isolation est structurelle et les règles restent simples.
- `householdId` est dupliqué dans chaque document (exports, `collectionGroup` futurs, contrôles).
- `source` sur les transactions prépare l'import bancaire futur sans changer le schéma.
- Les agrégats mensuels (phase 2) seront calculés côté client depuis le cache ; un document
  `reports/{YYYY-MM}` fige chaque bilan pour l'historique et l'IA.
- Index composites déclarés dans `firestore.indexes.json` (dépenses par catégorie / membre / portée + date).

## 5. Utilisateurs, foyers et sécurité

```
USER ──(memberIds / roles)──▶ HOUSEHOLD ──▶ DONNÉES FINANCIÈRES
```

- Un utilisateur crée un foyer → il en est `owner`.
- Il génère une **invitation** (code de 10 caractères, ~49 bits d'entropie, usage unique, 7 jours).
- Son/sa conjoint(e) crée son compte, saisit le code (ou ouvre le lien) → rejoint comme `member`.
- Rôles prévus : `owner`, `member`, `viewer` (lecture seule : enfant, conseiller).
- Chaque donnée garde `createdBy` (« Ajouté par ») et peut porter `memberId` + `scope` (personnel / commun).

**Security Rules** (`firestore.rules`, `storage.rules`) — refus par défaut :

| Ressource | Lecture | Écriture |
| --- | --- | --- |
| `users/{uid}` | soi uniquement | soi uniquement ; `activeHouseholdId` doit pointer vers un foyer dont on est membre |
| `invites/{code}` | lecture unitaire si connecté, **jamais de liste** | création par un membre (≤ 7 j) ; consommation atomique à l'adhésion |
| `households/{hid}` | membres | membre : nom/devise ; owner : membres et rôles ; adhésion uniquement via invitation valide ; départ volontaire |
| `members/{uid}` | membres | création contrôlée (fondateur ou invitation), nom modifiable par soi |
| données financières | membres | `owner`/`member` ; métadonnées (`createdBy`, dates serveur, `householdId`) vérifiées et immuables ; montants entiers |
| `auditLog` | membres | ajout seul, jamais modifié ni supprimé |
| Storage | membres | images/PDF < 15 Mo dans `receipts/` ou `documents/` |

Ces règles sont couvertes par 26 tests exécutés contre les émulateurs (`npm run test:rules`).

## 6. Architecture IA (phase 5)

```
Question ──▶ ai/context.ts ──▶ faits calculés (fonctions pures, sources citées)
                                  │
                                  ▼
                   Cloud Function `askFinance` ──▶ AIProvider (interface)
                                  │                 ├─ ClaudeProvider (défaut)
                                  │                 └─ autre fournisseur…
                                  ▼
                   Réponse structurée : DONNÉES / CALCULS / ESTIMATION / SUGGESTION
```

- **L'IA ne calcule pas, elle explique** : les chiffres (totaux, taux d'épargne, capital restant, projections)
  sont produits par du code déterministe et testé, puis transmis au modèle comme faits sourcés.
- Réponse au format JSON imposé (`data[]`, `calculations[]`, `estimates[]`, `suggestions[]`), chaque chiffre
  référençant sa source ; un validateur rejette toute valeur absente du contexte → **aucune donnée inventée**.
- Interface `AIProvider { complete(request): Promise<StructuredAnswer> }` : changer de fournisseur = un adaptateur.
- La clé API reste dans la Cloud Function (Secret Manager) ; le client n'envoie que les agrégats nécessaires.
- Bilan mensuel : Function planifiée le 1er du mois → `reports/{YYYY-MM}`.

## 6 bis. Alertes et notifications push (phase 7)

```
functions/src/shared/alerts.ts   règles pures (budget, dépenses > revenus, prélèvement, taux d'épargne)
        │                         partagées par les deux côtés (alias @shared côté app)
        ├─▶ app : carte « Alertes » de l'accueil, recalculée en direct
        └─▶ Cloud Function dailyAlerts (9 h, Europe/Paris) ─▶ Web Push (VAPID) ─▶ public/push-sw.js
```

- Réglages communs au foyer : `settings/alerts` ; alertes déjà notifiées : `alerts/notified` (une alerte n'est envoyée qu'une fois).
- Appareils abonnés : `users/{uid}/pushSubscriptions/{empreinte}` (lecture/écriture par leur seul propriétaire).
- Web Push standard, sans Firebase Messaging : clé publique VAPID dans `shared/push.ts`, clé privée dans Secret Manager (`VAPID_PRIVATE_KEY`).
- Sur iPhone, les notifications exigent l'app installée sur l'écran d'accueil (iOS 16.4+).

## 6 ter. Dépenses automatiques (abonnements et charges fixes)

Un abonnement ou une charge fixe (`subscriptions`) crée **une vraie dépense par mois** (`expenses`), à l'ouverture
de l'app (`useRecurringExpenses`, monté dans la coque). Liste, budgets, graphiques, alertes et exports fonctionnent
donc sans cas particulier.

- Identifiant fixe `{abonnement}_{AAAA-MM}` : une occurrence n'existe qu'une fois, même si deux appareils s'ouvrent ensemble.
- `startMonth` : premier mois généré ; les mois manqués (app non ouverte) sont rattrapés jusqu'au mois en cours.
- Mensuel : chaque mois. Annuel : mois anniversaire seulement, montant entier. Jour = jour du prélèvement, borné à la fin du mois.
- Supprimer une dépense automatique mémorise le mois (`skippedMonths`) : elle ne revient pas.
- Modifier l'abonnement met à jour le mois en cours ; les mois passés restent tels quels.
- Formulaire de dépense : « Même montant chaque mois » crée la charge fixe, qui prend le relais dès le mois suivant.
- Les mensualités de prêts restent, elles, un total calculé (non matérialisé en dépenses).

## 7. Architecture OCR (phase 4)

```
Photo / PDF ─▶ compression client ─▶ Storage (households/{hid}/receipts)
            ─▶ documents/{id} status=uploaded
            ─▶ extraction : Tesseract.js (local, gratuit) ou Function IA-vision (tickets complexes)
            ─▶ documents/{id}.extraction = { merchant, date, totalCents, lines[], vat, confidence }
            ─▶ ÉCRAN DE VALIDATION (champs pré-remplis, modifiables, catégorie suggérée)
            ─▶ l'utilisateur valide ─▶ expense + receipt créés, status=validated
```

**Aucune donnée OCR n'est enregistrée comme dépense sans validation humaine** : l'extraction reste un
brouillon (`status = extracted`) jusqu'au clic « Valider ».

## 8. Arborescence

```
finances/
├── docs/ARCHITECTURE.md
├── public/                     icônes PWA (générées depuis favicon.svg)
├── src/
│   ├── components/
│   │   ├── ui/                 design system : Button, Card, TextField, StatCard, ProgressBar, Sheet…
│   │   ├── layout/             AppShell, BottomNav, SideNav, TopBar, QuickAddSheet, StatusBanners
│   │   └── charts/             (phase 2)
│   ├── contexts/               AuthContext, HouseholdContext, ThemeContext
│   ├── firebase/               config, client (init + émulateurs), chemins typés
│   ├── hooks/                  useAuth, useHousehold, useTheme, useOnlineStatus
│   ├── pages/                  auth/, onboarding/, Home, Household, Settings, More…
│   ├── routes/                 garde-fous (PublicOnly, RequireAuth, RequireHousehold)
│   ├── services/               authService, userService, householdService, repository (audit)
│   ├── types/                  modèles TypeScript
│   ├── utils/                  money, dates, diff, inviteCode, firebaseErrors
│   ├── ai/  ocr/               (phases 4-5)
│   └── styles/                 tokens.css, global.css
├── tests/rules/                tests des Security Rules (émulateurs)
├── firestore.rules  storage.rules  firestore.indexes.json  firebase.json
└── vite.config.ts  pwa-assets.config.ts  tsconfig*.json  eslint.config.js
```

## 9. Design system « Cockpit »

- **Thème sombre futuriste par défaut** (fond nuit `#070a12`, halos indigo/menthe), thème clair complet,
  choix « Système ». Tous les composants consomment des **tokens CSS** (`styles/tokens.css`).
- **Couleurs sémantiques fixes** : revenus = menthe, dépenses = corail, épargne = indigo, dette = ambre.
  L'accent dégradé indigo → menthe est réservé aux actions principales.
- **Typographie** : Inter Variable, chiffres tabulaires (`.num`) pour aligner les montants.
- **Surfaces** : cartes en verre dépoli, rayon 20 px, bordure fine, ombre douce ; espacement sur une grille de 4 px.
- **Mouvement** : micro-animations courtes (140–240 ms, `ease-out`), barres de progression animées,
  respect de `prefers-reduced-motion`.
- **Mobile first** : barre de navigation basse (Accueil, Dépenses, [+], Épargne, Dette, Analyse), cibles
  tactiles ≥ 44 px, zones sûres iOS, champs à 16 px (pas de zoom iOS), feuilles modales glissant du bas.
  Desktop ≥ 1024 px : rail latéral avec navigation principale + secondaire.
- **Accessibilité** : rôles ARIA (progressbar, radiogroup, dialog), focus visible, contrastes AA.

## 10. Plan de développement

| Phase | Contenu | État |
| --- | --- | --- |
| **1 — Socle** | Projet, React/TS strict, PWA, Firebase (Auth, Firestore, Storage), Security Rules testées, utilisateurs, foyers, invitations, navigation, design system, journal d'audit (architecture) | ✅ |
| 2 — Finances de base | Catégories (par défaut + personnalisables), dépenses, revenus, budget prévu/réel/écart, dashboard réel, vue mensuelle, graphiques, recherche | ✅ |
| 3 — Épargne & dettes | Objectifs d'épargne, prêts (amortissement, % remboursé, date de fin), page « Ma dette », charges fixes, abonnements, échéances | ✅ |
| 4 — Documents | Scanner de tickets, OCR, import PDF, stockage, écran de validation | ✅ |
| 5 — IA | Bilan mensuel, questions/réponses, mode conseiller, projections 3/6/12 mois | ✅ (clé IA à configurer) |
| 6 — Patrimoine | Actifs, passifs, patrimoine net et évolution | ✅ |
| 7 — Finitions | Alertes/notifications, exports CSV/PDF, offline étendu, accessibilité, tests E2E | 🟡 alertes + push, rythme des dépenses, export CSV/texte |

## Risques techniques identifiés

| Risque | Mitigation |
| --- | --- |
| Coût/latence des règles (`get()` du foyer à chaque accès) | 1 lecture mise en cache par requête ; rôles et membres dans le même document |
| OCR peu fiable sur tickets froissés | Validation humaine obligatoire, extraction IA en secours, correction manuelle |
| IA qui « invente » | Calculs déterministes, sortie JSON validée contre le contexte, sources citées |
| Hors-ligne et conflits entre deux appareils | Écritures Firestore en file d'attente, dernier écrit gagne par champ, journal d'audit |
| Safari iOS (PWA) : stockage purgé après inactivité, pas de push avant installation | Données toujours côté Firebase ; notifications prévues via Web Push sur PWA installée (iOS ≥ 16.4) |
| Taille du SDK Firebase (~190 ko gzip) | Chunk séparé mis en cache par le service worker |
| Suppression d'un foyer (sous-collections) | Interdite côté client ; Cloud Function dédiée |
| Clés IA/OCR exposées | Appels uniquement via Cloud Functions + Secret Manager |
