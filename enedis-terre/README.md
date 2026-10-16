# Préparation des mises à la terre Enedis

Application indépendante de la PWA de suivi de dividendes présente à la racine du dépôt (aucun fichier de celle-ci n'est modifié).
Statut : **Sprint 1 terminé** (audit, import du listing, RM/RNG, seuils). Voir [docs/SPRINT1.md](docs/SPRINT1.md).

## Installation et lancement

```bash
cd enedis-terre
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q                       # tests
python -m uvicorn app.main:app --port 8000   # http://localhost:8000
```

Base SQLite : `data/enedis.sqlite3` (variable `ENEDIS_DB` pour la changer). **Pas d'authentification dans le Sprint 1** : ne pas exposer le service hors machine locale / réseau de confiance.

## Règles métier implémentées

| Type | Seuil | Déclenche si |
|---|---|---|
| RM — terre des masses | 30 Ω | RM **>** 30 |
| RNG — terre du neutre | 15 Ω | RNG **>** 15 |

Une valeur égale au seuil ne déclenche rien. Une valeur absente reste absente (jamais 0) ; une valeur illisible est marquée *invalide* et conservée telle quelle. Une ligne peut déclencher RM, RNG, les deux ou aucune ; les deux familles ont des interventions distinctes.

## Architecture

```
app/numbers.py    lecture stricte des nombres (virgule FR, Ω, milliers)
app/rules.py      seuils RM / RNG
app/coords.py     validation GPS WGS84 (Lambert/DMS refusés, jamais deviné)
app/columns.py    détection + validation de la correspondance des colonnes
app/readers.py    xlsx / csv / pdf texte (OCR non disponible : refus explicite)
app/analysis.py   application du mapping et des seuils (pur, sans base)
app/importer.py   doublons, transaction, traçabilité
app/db.py         schéma SQLite (PRAGMA user_version)
app/main.py       API FastAPI ; static/index.html : interface
```
