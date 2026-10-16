"""Validation des coordonnées GPS (WGS84, degrés décimaux).

Jamais de géolocalisation « au hasard » : coordonnées absentes ou invalides =>
statut explicite et aucune valeur de remplacement.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from .numbers import is_blank, parse_decimal

OK, MISSING, INVALID = "ok", "missing", "invalid"

# Emprise indicative de la France métropolitaine (avertissement seulement).
_METRO = (Decimal("41.0"), Decimal("51.6"), Decimal("-5.6"), Decimal("10.0"))


@dataclass(frozen=True)
class CoordResult:
    status: str
    lat: float | None = None
    lon: float | None = None
    message: str | None = None
    warnings: list[str] = field(default_factory=list)


def _split_combined(text: str) -> list[str] | None:
    text = text.strip().strip("()[]")
    if ";" in text:
        parts = text.split(";")
    elif re.search(r",\s+", text):
        parts = re.split(r",\s+", text)
    elif len(text.split()) == 2:
        parts = text.split()
    else:
        return None
    parts = [p.strip() for p in parts]
    return parts if len(parts) == 2 else None


def _clean(part: Any) -> Any:
    if isinstance(part, str):
        return part.replace("°", "").strip()
    return part


def parse_coordinates(lat_raw: Any = None, lon_raw: Any = None, combined_raw: Any = None) -> CoordResult:
    if is_blank(lat_raw) and is_blank(lon_raw) and not is_blank(combined_raw):
        parts = _split_combined(str(combined_raw))
        if parts is None:
            return CoordResult(INVALID, message=f"coordonnées illisibles : « {combined_raw} » (format attendu : latitude; longitude)")
        lat_raw, lon_raw = parts
    if is_blank(lat_raw) and is_blank(lon_raw):
        return CoordResult(MISSING, message="coordonnées GPS absentes")
    if is_blank(lat_raw) or is_blank(lon_raw):
        return CoordResult(INVALID, message="latitude ou longitude manquante")

    for label, raw in (("latitude", lat_raw), ("longitude", lon_raw)):
        if isinstance(raw, str) and re.search(r"['′\"″]|[NSEWO]\s*$", raw.strip(), re.IGNORECASE) and re.search(r"\d\s*°?\s*\d+\s*['′]", raw):
            return CoordResult(INVALID, message=f"{label} en degrés/minutes/secondes non prise en charge (« {raw} ») : convertir en degrés décimaux WGS84")

    lat, err = parse_decimal(_clean(lat_raw))
    if err:
        return CoordResult(INVALID, message=f"latitude : {err}")
    lon, err = parse_decimal(_clean(lon_raw))
    if err:
        return CoordResult(INVALID, message=f"longitude : {err}")
    assert lat is not None and lon is not None

    if abs(lat) > 180 or abs(lon) > 180:
        return CoordResult(INVALID, message="valeurs hors degrés : coordonnées projetées (ex. Lambert 93) non prises en charge, fournir du WGS84")
    if abs(lat) > 90:
        return CoordResult(INVALID, message=f"latitude hors limites (±90) : {lat} — latitude et longitude inversées ?")
    if abs(lon) > 180:  # pragma: no cover - couvert plus haut
        return CoordResult(INVALID, message=f"longitude hors limites (±180) : {lon}")
    if lat == 0 and lon == 0:
        return CoordResult(INVALID, message="coordonnées 0, 0 : valeur par défaut probable, non retenue")

    warnings: list[str] = []
    lo_lat, hi_lat, lo_lon, hi_lon = _METRO
    if not (lo_lat <= lat <= hi_lat and lo_lon <= lon <= hi_lon):
        warnings.append("hors France métropolitaine : vérifier l'ordre latitude/longitude et le système de coordonnées")
    return CoordResult(OK, float(lat), float(lon), None, warnings)
