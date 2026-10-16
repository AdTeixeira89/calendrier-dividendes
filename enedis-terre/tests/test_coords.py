import pytest

from app.coords import INVALID, MISSING, OK, parse_coordinates


def test_absentes():
    assert parse_coordinates(None, None).status == MISSING
    assert parse_coordinates("", " ", "").status == MISSING


def test_valides_virgule_francaise():
    r = parse_coordinates("48,8566", "2,3522")
    assert r.status == OK and (r.lat, r.lon) == (48.8566, 2.3522) and not r.warnings


@pytest.mark.parametrize("combined", ["48.8566, 2.3522", "48,8566;2,3522", "48.8566 2.3522", "(48.8566, 2.3522)"])
def test_colonne_unique(combined):
    r = parse_coordinates(combined_raw=combined)
    assert r.status == OK and (r.lat, r.lon) == (48.8566, 2.3522)


def test_colonne_unique_ambigue_refusee():
    assert parse_coordinates(combined_raw="48,8566,2,3522").status == INVALID


def test_une_seule_composante_invalide():
    assert parse_coordinates("48.8", None).status == INVALID


def test_lambert_non_pris_en_charge():
    r = parse_coordinates("6862000", "652000")
    assert r.status == INVALID and "Lambert" in r.message


def test_latitude_hors_limites():
    assert parse_coordinates("95", "2").status == INVALID


def test_zero_zero_refuse():
    assert parse_coordinates("0", "0").status == INVALID


def test_dms_refuse():
    assert parse_coordinates("48°51'23\"N", "2°21'8\"E").status == INVALID


def test_hors_metropole_avertissement_mais_valide():
    r = parse_coordinates("-21.1", "55.5")
    assert r.status == OK and r.warnings
