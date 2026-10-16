from decimal import Decimal

import pytest

from app.numbers import parse_decimal
from app.rules import BELOW, INVALID, MISSING, TRIGGERED, evaluate


# --- RM ---
def test_rm_egal_au_seuil_ne_declenche_pas():
    assert evaluate("RM", "30").status == BELOW
    assert evaluate("RM", 30).status == BELOW
    assert evaluate("RM", 30.0).status == BELOW


def test_rm_juste_au_dessus_declenche():
    assert evaluate("RM", "30,1").status == TRIGGERED
    assert evaluate("RM", 30.1).status == TRIGGERED


def test_rm_sous_seuil():
    assert evaluate("RM", "12,5").status == BELOW


# --- RNG ---
def test_rng_egal_au_seuil_ne_declenche_pas():
    assert evaluate("RNG", "15").status == BELOW


def test_rng_juste_au_dessus_declenche():
    assert evaluate("RNG", "15,1").status == TRIGGERED


@pytest.mark.parametrize("raw", [None, "", "  ", "-", "N/A", float("nan")])
def test_valeur_absente_jamais_zero(raw):
    r = evaluate("RNG", raw)
    assert r.status == MISSING and r.value is None


def test_valeur_illisible_est_invalide_et_pas_zero():
    for raw in ["abc", "<5", "12 ou 13", "1,2,3"]:
        r = evaluate("RM", raw)
        assert r.status == INVALID and r.value is None, raw


def test_valeur_negative_invalide():
    assert evaluate("RM", "-3").status == INVALID


def test_zero_reel_est_une_valeur_valide_sous_seuil():
    r = evaluate("RM", 0)
    assert r.status == BELOW and r.value == Decimal(0)


@pytest.mark.parametrize("raw,expected", [
    ("30,1 Ω", "30.1"), ("45 ohms", "45"), ("1 234,5", "1234.5"), ("1.234,5", "1234.5"),
    ("1,234.5", "1234.5"), (" 42,0", "42.0"),
])
def test_formats_numeriques(raw, expected):
    assert parse_decimal(raw) == (Decimal(expected), None)
