"""Lecture stricte des nombres issus de listings (décimale française, unités tolérées).

Règle : une valeur absente reste absente (None), jamais 0. Une valeur illisible
est signalée comme invalide, jamais « corrigée » au hasard.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

_UNIT_RE = re.compile(r"\s*(?:ω|Ω|ohms?)\s*$", re.IGNORECASE)
_PLAIN = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")
_FR_THOUSANDS = re.compile(r"^[+-]?\d{1,3}(?:\.\d{3})+,\d+$")  # 1.234,5
_EN_THOUSANDS = re.compile(r"^[+-]?\d{1,3}(?:,\d{3})+\.\d+$")  # 1,234.5

BLANK_MARKERS = {"", "-", "–", "—", "n/a", "na", "nc", "n.c.", "null", "none", "nan"}


def is_blank(raw: Any) -> bool:
    if raw is None:
        return True
    if isinstance(raw, float) and raw != raw:  # NaN
        return True
    return isinstance(raw, str) and raw.strip().lower() in BLANK_MARKERS


def parse_decimal(raw: Any) -> tuple[Decimal | None, str | None]:
    """Retourne (valeur, erreur). (None, None) = valeur absente ; (None, msg) = illisible."""
    if is_blank(raw):
        return None, None
    if isinstance(raw, bool):
        return None, f"valeur booléenne inattendue : {raw!r}"
    if isinstance(raw, (int, float, Decimal)):
        try:
            return Decimal(str(raw)), None
        except InvalidOperation:
            return None, f"nombre illisible : {raw!r}"
    text = str(raw).replace(" ", " ").replace(" ", " ").strip()
    text = _UNIT_RE.sub("", text).strip()
    text = re.sub(r"(?<=\d)\s+(?=\d{3}\b)", "", text)  # séparateur de milliers espace
    if _FR_THOUSANDS.match(text):
        text = text.replace(".", "").replace(",", ".")
    elif _EN_THOUSANDS.match(text):
        text = text.replace(",", "")
    elif _PLAIN.match(text):
        text = text.replace(",", ".")
    else:
        return None, f"valeur non numérique : « {str(raw).strip()} »"
    try:
        return Decimal(text), None
    except InvalidOperation:  # pragma: no cover - garde-fou
        return None, f"nombre illisible : « {str(raw).strip()} »"
