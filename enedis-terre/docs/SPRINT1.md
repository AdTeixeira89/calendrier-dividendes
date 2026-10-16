# Compte rendu — Sprint 1 (audit et import)

## Audit de l'existant
Le dépôt `calendrier-dividendes` contient une PWA JavaScript (suivi de portefeuille / dividendes, Firebase, relais Cloudflare). Aucun code, modèle de données ni écran réutilisable pour Enedis. **Décision** : nouvelle application dans `enedis-terre/`, sans toucher à l'existant (vérifié : `git status` ne montre que ce dossier).

Pile retenue : Python 3.13, FastAPI, SQLite (stdlib), openpyxl, pdfplumber, pytest ; interface HTML/JS sans dépendance. PostgreSQL/PostGIS, React et Leaflet sont reportés : rien ne les justifie avant le Sprint 2 (cartes/cadastre).

## Fonctionnalités terminées
- Import `.xlsx` (feuille et ligne d'en-tête détectées, modifiables), `.csv` (séparateur et encodage détectés), PDF texte (tableaux, sinon découpage du texte avec avertissement).
- Détection des colonnes + écran de correspondance modifiable avant validation. Formats « une colonne par type » (RM, RNG) ou « valeur + type de mesure ».
- Seuils RM > 30 Ω / RNG > 15 Ω (comparaison décimale exacte), valeurs absentes/illisibles jamais remplacées par 0.
- Coordonnées : colonnes séparées ou colonne unique, virgule décimale ; absentes/invalides → statut **incomplète**.
- Doublons : par référence + type (ignorés, jamais écrasés, écart de valeur signalé) ; sans référence : signature (type, valeur, GPS ou commune/adresse) → **confirmation explicite** requise.
- Import transactionnel (tout ou rien), journal `audit_logs`, empreinte SHA-256 du fichier, ligne d'origine conservée.
- Correction manuelle des coordonnées (revalidée, tracée, conservée en cas de ré-import).
- Tableau filtrable (type, statut, commune, recherche) + fiche avec ligne d'origine et historique.

## Tests : `python -m pytest -q` → 69 passés
Couvre : RM 30 / 30,1 ; RNG 15 / 15,1 ; GPS absent/invalide/Lambert/DMS ; valeur RNG absente ; fichier invalide/corrompu/.xls ; doublons (base, fichier, sans référence, confirmés) ; erreur de base (annulation complète) ; API (aperçu sans écriture, import, filtres, correction) ; PDF texte et PDF sans texte ; RM sans aucune cartographie (le module n'en dépend pas).
Smoke test réel via uvicorn + curl sur un CSV : OK.

## Hors périmètre du sprint (non testé, non simulé)
Parcelles voisines (Sprint 2), carte, export PDF, affichage mobile vérifié visuellement (mise en page responsive prévue mais non contrôlée sur appareil), service cadastral/image indisponible, cartographie Enedis.

## Limites connues
- **OCR absent** : un PDF scanné est refusé avec un message explicite.
- Pas d'authentification ni de rôles (à ajouter avant tout accès non local).
- `.xls` (ancien Excel) refusé : réenregistrer en `.xlsx`.
- Colonnes et vocabulaire des vrais listings Enedis supposés d'après le cahier des charges : **non validés sur un fichier réel**.
- Une ligne dont un seul champ « type » est illisible est signalée mais pas importée.

## Informations manquantes (utiles, non bloquantes)
1. Un ou deux **listings réels (anonymisés si besoin)** pour valider les synonymes de colonnes et le format GPS.
2. Le système de coordonnées réel (WGS84 degrés décimaux supposé).
3. Le **Sprint 2 nécessite** de confirmer l'accès à l'API cadastrale IGN (clé / conditions) — à préciser avant de démarrer.

## Étape suivante recommandée
Valider le Sprint 1 sur un vrai listing, puis Sprint 2 (module RM : carte, cadastre, parcelles voisines près des limites).
