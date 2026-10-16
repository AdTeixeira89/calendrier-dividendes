"""Signatures de comparaison pour les doublons potentiels (lignes sans référence)."""
from __future__ import annotations

from typing import Any

from .columns import normalize
from . import coords as C


def _sig(earth_type: str, value: float | None, lat: float | None, lon: float | None,
         commune: str | None, address: str | None) -> tuple | None:
    if value is None:
        return None
    if lat is not None and lon is not None:
        return (earth_type, round(float(value), 4), round(lat, 5), round(lon, 5))
    place = (normalize(commune), normalize(address))
    if any(place):
        return (earth_type, round(float(value), 4), place)
    return None  # rien de discriminant : jamais considéré comme doublon


def fuzzy_signature(earth_type: str, ra: Any, m: Any) -> tuple | None:
    ok = ra.coord.status == C.OK
    return _sig(earth_type, None if m.value is None else float(m.value),
                ra.coord.lat if ok else None, ra.coord.lon if ok else None, ra.commune, ra.address)


def signature_from_db(earth_type: str, row: Any) -> tuple | None:
    return _sig(earth_type, row["value"], row["latitude"], row["longitude"], row["commune"], row["address"])
