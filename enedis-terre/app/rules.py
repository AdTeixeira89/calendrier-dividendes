"""Règles métier de seuil (section 3.3 du cahier des charges).

RM  : terre des masses, intervention si RM  > 30 Ω (strictement).
RNG : terre du neutre,  intervention si RNG > 15 Ω (strictement).
Une valeur égale au seuil ne déclenche rien ; une valeur absente ou illisible
n'est jamais remplacée par zéro.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .numbers import parse_decimal

RM = "RM"
RNG = "RNG"
EARTH_TYPES = (RM, RNG)
THRESHOLDS: dict[str, Decimal] = {RM: Decimal("30"), RNG: Decimal("15")}

# Statuts d'une mesure
TRIGGERED = "triggered"
BELOW = "below"       # <= seuil : aucune intervention
MISSING = "missing"   # valeur absente
INVALID = "invalid"   # valeur illisible / négative


@dataclass(frozen=True)
class MeasurementResult:
    earth_type: str
    status: str
    value: Decimal | None
    raw: str | None
    threshold: Decimal
    message: str | None = None

    @property
    def triggered(self) -> bool:
        return self.status == TRIGGERED


def evaluate(earth_type: str, raw: Any) -> MeasurementResult:
    if earth_type not in THRESHOLDS:
        raise ValueError(f"type de terre inconnu : {earth_type}")
    threshold = THRESHOLDS[earth_type]
    raw_text = None if raw is None else str(raw).strip()
    value, error = parse_decimal(raw)
    if error:
        return MeasurementResult(earth_type, INVALID, None, raw_text, threshold, error)
    if value is None:
        return MeasurementResult(earth_type, MISSING, None, raw_text, threshold)
    if value < 0:
        return MeasurementResult(
            earth_type, INVALID, None, raw_text, threshold,
            f"résistance négative impossible : {value}",
        )
    status = TRIGGERED if value > threshold else BELOW
    return MeasurementResult(earth_type, status, value, raw_text, threshold)
