"""Analyse pure d'un listing (aucun accès base) : applique la correspondance de colonnes et les seuils."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import coords as C
from .columns import normalize
from .numbers import is_blank
from .readers import Table
from .rules import RM, RNG, MeasurementResult, evaluate


@dataclass
class Issue:
    code: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass
class RowAnalysis:
    source_row: int
    raw: dict[str, Any]
    reference: str | None = None
    transformer_ref: str | None = None
    commune: str | None = None
    address: str | None = None
    notes: str | None = None
    coord: C.CoordResult = field(default_factory=lambda: C.CoordResult(C.MISSING))
    measurements: list[MeasurementResult] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    empty: bool = False

    @property
    def triggered(self) -> list[MeasurementResult]:
        return [m for m in self.measurements if m.triggered]


def classify_measure_type(text: Any) -> str | None:
    """Reconnaît RM / RNG dans un libellé de type ; None si non reconnu (jamais deviné)."""
    n = normalize(text)
    if not n:
        return None
    tokens = set(n.split())
    is_rng = "rng" in tokens or "neutre" in tokens or ("globale" in tokens and "neutre" in n)
    is_rm = "rm" in tokens or "masse" in tokens or "masses" in tokens
    if is_rng and not is_rm:
        return RNG
    if is_rm and not is_rng:
        return RM
    return None


def _text(raw: Any) -> str | None:
    if is_blank(raw):
        return None
    if isinstance(raw, float) and raw.is_integer():
        raw = int(raw)  # une référence 12345 lue en 12345.0 par Excel
    return re.sub(r"\s+", " ", str(raw)).strip() or None


def analyze_table(table: Table, mapping: dict[str, int]) -> list[RowAnalysis]:
    def get(row: list[Any], key: str) -> Any:
        idx = mapping.get(key)
        return row[idx] if idx is not None and idx < len(row) else None

    out: list[RowAnalysis] = []
    for row, src in zip(table.rows, table.source_rows):
        raw = {h: (None if v is None else str(v)) for h, v in zip(table.headers, row)}
        ra = RowAnalysis(source_row=src, raw=raw)
        if not any(not is_blank(v) for v in row):
            ra.empty = True
            out.append(ra)
            continue
        ra.reference = _text(get(row, "reference"))
        ra.transformer_ref = _text(get(row, "transformer_ref"))
        ra.commune = _text(get(row, "commune"))
        ra.address = _text(get(row, "address"))
        ra.notes = _text(get(row, "notes"))
        ra.coord = C.parse_coordinates(get(row, "latitude"), get(row, "longitude"), get(row, "gps"))

        if "rm" in mapping:
            ra.measurements.append(evaluate(RM, get(row, "rm")))
        if "rng" in mapping:
            ra.measurements.append(evaluate(RNG, get(row, "rng")))
        if "value" in mapping and "measure_type" in mapping:
            raw_value = get(row, "value")
            type_text = get(row, "measure_type")
            etype = classify_measure_type(type_text)
            if etype is None:
                if not is_blank(raw_value):
                    ra.issues.append(Issue("type_non_reconnu",
                        f"type de mesure non reconnu « {type_text} » : valeur {raw_value} non exploitée (ni RM ni RNG supposé)"))
            elif any(m.earth_type == etype for m in ra.measurements) and not is_blank(raw_value):
                ra.issues.append(Issue("mesure_en_double",
                    f"{etype} déjà fourni par une autre colonne : colonne « valeur » ignorée pour cette ligne"))
            else:
                ra.measurements.append(evaluate(etype, raw_value))

        for m in ra.measurements:
            if m.status == "invalid":
                ra.issues.append(Issue(f"{m.earth_type.lower()}_invalide", f"{m.earth_type} : {m.message}"))
        if not any(m.status in ("triggered", "below", "invalid") for m in ra.measurements) and not ra.issues:
            ra.issues.append(Issue("aucune_mesure", "aucune valeur RM/RNG sur cette ligne"))
        out.append(ra)
    return out


def intervention_issues(ra: RowAnalysis) -> list[Issue]:
    """Erreurs / données manquantes propres à une intervention déclenchée."""
    issues: list[Issue] = []
    if ra.coord.status == C.MISSING:
        issues.append(Issue("gps_absent", "coordonnées GPS absentes : intervention non géolocalisable"))
    elif ra.coord.status == C.INVALID:
        issues.append(Issue("gps_invalide", f"coordonnées GPS invalides : {ra.coord.message}"))
    else:
        for w in ra.coord.warnings:
            issues.append(Issue("gps_a_verifier", w))
    if not ra.reference:
        issues.append(Issue("reference_absente", "référence d'intervention absente : détection de doublons moins fiable"))
    return issues
