# Foyer — application mobile de finances familiales

Finalité : une vraie application grand public, publiée à terme sur le Google Play Store et l'App Store.
Ce n'est ni un prototype ni une application web provisoire. Priorité absolue : résoudre de vrais problèmes
d'utilisateurs, pas empiler des fonctionnalités.

## Filtre à passer pour toute fonctionnalité (avant de la coder)

1. Est-ce réellement utile ? Quel problème concret du foyer cela résout-il ?
2. Est-ce compréhensible par quelqu'un qui n'est pas expert en finances ?
3. Est-ce adapté à un usage quotidien ou mensuel sur smartphone (une main, quelques secondes) ?
4. Est-ce assez robuste pour une application publique (erreurs, hors-ligne, données sensibles) ?
5. Est-ce compatible avec Android et iOS (pas de dépendance à un navigateur précis) ?
6. Apporte-t-elle quelque chose que les concurrents (Bankin', Finary, YNAB…) ne font pas mieux ?

Si la réponse est non à la 1 ou à la 2, on ne la fait pas. Le dire à l'utilisateur plutôt que de l'implémenter.

## Règles de conception

- Mobile d'abord : cibles tactiles ≥ 44 px, champs à 16 px, zones sûres, tailles d'écran variées (petit iPhone à tablette).
- Les chiffres ne sont jamais inventés : calculs déterministes testés (`utils/`), pas de valeur estimée présentée comme un fait.
- Données financières = données sensibles : règles de sécurité Firestore testées, secrets hors du code et hors des journaux.
- Toute écriture financière est journalisée (`services/repository.ts`) ; les pages ne parlent jamais à Firestore directement.
- Une fonctionnalité qui vit côté web ne doit pas dépendre d'API réservées au navigateur sans solution native équivalente.
- Mises à jour : privilégier ce qui se déploie sans repasser par les stores (web, règles, Cloud Functions).

## Exigences des stores (état au 04/10/2026) — à traiter avant toute soumission

| Exigence | État |
| --- | --- |
| Coque native Android + iOS (Capacitor) | À faire |
| Suppression de compte depuis l'app, avec effacement des données (Apple 5.1.1(v), Google) | À faire |
| Politique de confidentialité + conditions d'utilisation (pages publiques, liens dans l'app et les fiches) | À faire (informations de l'éditeur requises) |
| Déclarations Google « Sécurité des données » / Apple « Confidentialité » | À faire |
| App Check (Play Integrity / App Attest) | À faire |
| Vérification de l'e-mail à l'inscription | À faire |
| Verrouillage de l'app (Face ID / empreinte) — attendu pour une app financière | À faire |
| Notifications natives (APNs / FCM) à la place du Web Push | À faire |
| Suivi des plantages (Crashlytics ou Sentry) | À faire |
| Tests de bout en bout intégrés à une CI | À faire |
| Audit d'accessibilité (VoiceOver, TalkBack, contrastes) | À faire |
| Visuels des fiches (icône, captures, descriptions FR) | À faire |
| Export des données personnelles (RGPD) | Partiel (CSV des transactions) |

Risque App Store à connaître : la règle 4.2 (« fonctionnalités minimales ») rejette les simples sites web empaquetés.
La parade est d'embarquer l'app localement et d'apporter de vrais usages natifs (notifications, Face ID, caméra pour
scanner les tickets, hors-ligne).

## Commandes

Voir `README.md` (émulateurs, tests, déploiement) et `docs/ARCHITECTURE.md` (architecture, schéma Firestore).
Avant tout commit : `npx tsc -b`, `npx eslint .`, `npx vitest run`, `npm run test:rules`, `cd functions && npx vitest run`.
