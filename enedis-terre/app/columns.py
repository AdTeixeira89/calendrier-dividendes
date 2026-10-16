"""Détection des colonnes utiles d'un listing et validation de la correspondance.

La détection est une *suggestion* : l'utilisateur peut la corriger avant import.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

FIELDS = (
    "reference", "transformer_ref", "measure_type", "value", "rm", "rng",
    "latitude", "longitude", "gps", "commune", "address", "notes",
)

FIELD_LABELS = {
    "reference": "Référence de l'intervention",
    "transformer_ref": "Transformateur / poste",
    "measure_type": "Type de mesure / de terre",
    "value": "Valeur (si une seule colonne + type)",
    "rm": "Valeur RM (terre des masses)",
    "rng": "Valeur RNG (terre du neutre)",
    "latitude": "Latitude",
    "longitude": "Longitude",
    "gps": "Coordonnées GPS (colonne unique)",
    "commune": "Commune",
    "address": "Adresse",
    "notes": "Informations complémentaires",
}

# synonymes normalisés (sans accents, minuscules, mots séparés par un espace)
_SYNONYMS: dict[str, list[str]] = {
    "reference": ["reference", "ref", "ref intervention", "reference intervention", "n intervention",
                  "numero intervention", "id intervention", "intervention", "numero", "n"],
    "transformer_ref": ["poste", "transformateur", "code poste", "n poste", "numero poste", "id poste",
                        "ps", "nom poste", "dpt", "ouvrage"],
    "measure_type": ["type mesure", "type de mesure", "type de terre", "type terre", "nature mesure",
                     "nature", "mesure type"],
    "value": ["valeur", "valeur mesuree", "resistance", "mesure", "ohm", "valeur ohm"],
    "rm": ["rm", "r m", "terre des masses", "resistance terre des masses", "resistance de terre des masses",
           "resistance masses", "masses", "rm ohm"],
    "rng": ["rng", "r n g", "terre du neutre", "terre neutre", "resistance globale neutre",
            "resistance globale du neutre", "globale neutre", "neutre", "rng ohm"],
    "latitude": ["latitude", "lat", "y", "lat gps", "latitude gps"],
    "longitude": ["longitude", "lon", "long", "lng", "x", "lon gps", "longitude gps"],
    "gps": ["gps", "coordonnees", "coordonnees gps", "coord gps", "position", "position gps", "localisation gps"],
    "commune": ["commune", "ville", "localite", "nom commune", "libelle commune"],
    "address": ["adresse", "rue", "voie", "adresse poste", "localisation"],
    "notes": ["commentaire", "commentaires", "observation", "observations", "remarque", "remarques",
              "information", "informations", "infos", "complement", "notes"],
}


def normalize(text: object) -> str:
    s = unicodedata.normalize("NFKD", str(text if text is not None else ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def _score(field_name: str, header: str) -> int:
    h = normalize(header)
    if not h:
        return 0
    tokens = set(h.split())
    best = 0
    for syn in _SYNONYMS[field_name]:
        if h == syn:
            best = max(best, 100 + len(syn))
        else:
            stoks = syn.split()
            if len(stoks) > 1 and set(stoks) <= tokens:
                best = max(best, 50 + len(stoks))
            elif len(stoks) == 1 and len(syn) >= 3 and syn in tokens:
                best = max(best, 20)
    return best


@dataclass
class MappingSuggestion:
    mapping: dict[str, int] = field(default_factory=dict)  # champ -> index de colonne
    warnings: list[str] = field(default_factory=list)

    @property
    def detected(self) -> int:
        return len(self.mapping)


def suggest_mapping(headers: list[str]) -> MappingSuggestion:
    candidates = []
    for f in FIELDS:
        for idx, h in enumerate(headers):
            s = _score(f, h)
            if s > 0:
                candidates.append((s, f, idx))
    candidates.sort(key=lambda t: (-t[0], t[2]))
    sug = MappingSuggestion()
    used_cols: set[int] = set()
    for s, f, idx in candidates:
        if f in sug.mapping or idx in used_cols:
            continue
        sug.mapping[f] = idx
        used_cols.add(idx)
    # ambiguïté : plusieurs colonnes de même score pour un champ
    for f, idx in sug.mapping.items():
        top = _score(f, headers[idx])
        rivals = [i for i, h in enumerate(headers) if i != idx and _score(f, h) == top and i not in used_cols]
        if rivals:
            sug.warnings.append(
                f"{FIELD_LABELS[f]} : plusieurs colonnes possibles ({', '.join(repr(headers[i]) for i in [idx, *rivals])}), "
                f"« {headers[idx]} » retenue — à confirmer."
            )
    # un GPS en colonne unique est inutile si lat+lon trouvées
    if "gps" in sug.mapping and {"latitude", "longitude"} <= set(sug.mapping):
        del sug.mapping["gps"]
    return sug


def validate_mapping(mapping: dict[str, int], ncols: int) -> tuple[list[str], list[str]]:
    """Retourne (erreurs bloquantes, avertissements)."""
    errors: list[str] = []
    warnings: list[str] = []
    for f, idx in mapping.items():
        if f not in FIELDS:
            errors.append(f"champ inconnu : {f}")
        elif not isinstance(idx, int) or not (0 <= idx < ncols):
            errors.append(f"colonne invalide pour « {f} » : {idx!r}")
    cols = [i for i in mapping.values() if isinstance(i, int)]
    if len(cols) != len(set(cols)):
        errors.append("une même colonne est associée à plusieurs champs")
    has_values = "rm" in mapping or "rng" in mapping or ("value" in mapping and "measure_type" in mapping)
    if not has_values:
        errors.append("aucune colonne de mesure : associer RM et/ou RNG (ou « valeur » + « type de mesure »)")
    if "value" in mapping and "measure_type" not in mapping and "rm" not in mapping and "rng" not in mapping:
        errors.append("une colonne « valeur » seule ne permet pas de distinguer RM et RNG : associer aussi le type de mesure")
    if "gps" not in mapping and not ({"latitude", "longitude"} <= set(mapping)):
        warnings.append("aucune colonne de coordonnées GPS : toutes les interventions seront signalées incomplètes")
    return errors, warnings
