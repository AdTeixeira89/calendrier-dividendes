import json

import pytest

from app.columns import suggest_mapping
from app.importer import ImportError_, build_plan, commit_plan
from app.readers import read_listing
from conftest import HEADERS, make_csv, make_xlsx


def run(conn, rows, name="l.xlsx", mapping=None, confirm=None, commit=True, maker=make_xlsx):
    data = maker(rows)
    table = read_listing(name, data)
    mp = mapping or suggest_mapping(table.headers).mapping
    plan = build_plan(conn, table, mp, confirm)
    iid = commit_plan(conn, plan, filename=name, data=data, table=table, mapping=mp) if commit else None
    return plan, iid


def ivs(conn, **where):
    return [dict(r) for r in conn.execute("SELECT * FROM interventions ORDER BY id")]


def test_une_ligne_peut_declencher_rm_rng_les_deux_ou_aucun(conn):
    rows = [HEADERS,
            ["R1", "P1", 31, 10, 48.1, 2.1, "A"],   # RM seul
            ["R2", "P2", 10, 16, 48.2, 2.2, "B"],   # RNG seul
            ["R3", "P3", 45, 20, 48.3, 2.3, "C"],   # les deux
            ["R4", "P4", 30, 15, 48.4, 2.4, "D"]]   # égaux aux seuils : aucun
    plan, _ = run(conn, rows)
    got = sorted((i["reference"], i["earth_type"]) for i in ivs(conn))
    assert got == [("R1", "RM"), ("R2", "RNG"), ("R3", "RM"), ("R3", "RNG")]
    s = plan.summary()
    assert s["rm_triggered"] == 2 and s["rng_triggered"] == 2 and s["below_threshold"] == 4


def test_rm_et_rng_restent_distincts_avec_leur_seuil(conn):
    run(conn, [HEADERS, ["R3", "P3", 45, 20, 48.3, 2.3, "C"]])
    by = {i["earth_type"]: i for i in ivs(conn)}
    assert by["RM"]["threshold"] == 30 and by["RM"]["value"] == 45
    assert by["RNG"]["threshold"] == 15 and by["RNG"]["value"] == 20


def test_gps_absent_signale_incomplete_sans_geolocalisation_inventee(conn):
    run(conn, [HEADERS, ["R1", "P1", 31, None, None, None, "A"], ["R2", "P2", 31, None, "x", "y", "B"]])
    rows = ivs(conn)
    assert [r["status"] for r in rows] == ["incomplete", "incomplete"]
    assert all(r["latitude"] is None and r["longitude"] is None for r in rows)
    codes = [{i["code"] for i in json.loads(r["issues_json"])} for r in rows]
    assert "gps_absent" in codes[0] and "gps_invalide" in codes[1]


def test_gps_valide_donne_a_preparer(conn):
    run(conn, [HEADERS, ["R1", "P1", 31, None, 48.1, 2.1, "A"]])
    assert ivs(conn)[0]["status"] == "to_prepare"


def test_rng_absent_aucune_valeur_fictive(conn):
    plan, _ = run(conn, [HEADERS, ["R1", "P1", 5, None, 48.1, 2.1, "A"]])
    assert ivs(conn) == []
    assert conn.execute("SELECT COUNT(*) FROM measurements WHERE earth_type='RNG'").fetchone()[0] == 0
    assert plan.summary()["to_import_interventions"] == 0


def test_valeur_illisible_signalee_et_conservee_comme_invalide(conn):
    plan, _ = run(conn, [HEADERS, ["R1", "P1", "abc", 20, 48.1, 2.1, "A"]])
    assert [i["earth_type"] for i in ivs(conn)] == ["RNG"]
    m = conn.execute("SELECT status, value, value_raw FROM measurements WHERE earth_type='RM'").fetchone()
    assert (m["status"], m["value"], m["value_raw"]) == ("invalid", None, "abc")
    assert plan.row_issues and plan.summary()["invalid_values"] == 1


def test_colonne_valeur_et_type(conn):
    rows = [["Réf", "Type de mesure", "Valeur", "Latitude", "Longitude"],
            ["R1", "Terre des masses", "31,0", 48.1, 2.1],
            ["R2", "RNG", "15", 48.2, 2.2],
            ["R3", "RNG", "16", 48.3, 2.3],
            ["R4", "Inconnu", "99", 48.4, 2.4]]
    plan, _ = run(conn, rows)
    assert sorted((i["reference"], i["earth_type"]) for i in ivs(conn)) == [("R1", "RM"), ("R3", "RNG")]
    assert any(i["code"] == "type_non_reconnu" for r in plan.row_issues for i in r["issues"])


def test_lignes_vides_ignorees(conn):
    plan, _ = run(conn, [HEADERS, [None] * 7, ["R1", "P", 31, None, 48.1, 2.1, "A"]])
    assert plan.empty_rows == 1 and len(ivs(conn)) == 1


def test_doublon_par_reference_dans_la_base_non_ecrase(conn):
    rows = [HEADERS, ["R1", "P1", 31, None, 48.1, 2.1, "A"]]
    run(conn, rows)
    plan, _ = run(conn, [HEADERS, ["R1", "P1", 99, None, 48.1, 2.1, "A"]])
    assert plan.summary()["duplicates_skipped"] == 1
    assert [i["value"] for i in ivs(conn)] == [31]
    assert "valeur différente" in plan.items[0].detail


def test_doublon_par_reference_dans_le_fichier(conn):
    plan, _ = run(conn, [HEADERS, ["R1", "P", 31, None, 48.1, 2.1, "A"], ["R1", "P", 31, None, 48.1, 2.1, "A"]])
    assert len(ivs(conn)) == 1 and plan.summary()["duplicates_skipped"] == 1


def test_meme_reference_autre_type_n_est_pas_un_doublon(conn):
    run(conn, [HEADERS, ["R1", "P", 31, None, 48.1, 2.1, "A"]])
    run(conn, [HEADERS, ["R1", "P", 5, 20, 48.1, 2.1, "A"]])
    assert sorted(i["earth_type"] for i in ivs(conn)) == ["RM", "RNG"]


def test_doublon_sans_reference_demande_confirmation(conn):
    row = [None, "P", 31, None, 48.1, 2.1, "A"]
    run(conn, [HEADERS, row])
    plan, _ = run(conn, [HEADERS, row])
    assert plan.summary()["possible_duplicates"] == 1 and len(ivs(conn)) == 1
    # confirmé explicitement => importé
    plan, _ = run(conn, [HEADERS, row], confirm={(2, "RM")})
    assert len(ivs(conn)) == 2
    assert any(i["code"] == "doublon_confirme" for i in json.loads(ivs(conn)[1]["issues_json"]))


def test_sans_reference_ni_lieu_jamais_doublon(conn):
    row = [None, None, 31, None, None, None, None]
    run(conn, [HEADERS, row, row])
    assert len(ivs(conn)) == 2


def test_mapping_invalide_bloque_sans_ecrire(conn):
    data = make_xlsx([HEADERS, ["R1", "P", 31, None, 48.1, 2.1, "A"]])
    table = read_listing("l.xlsx", data)
    plan = build_plan(conn, table, {"reference": 0})
    assert plan.errors
    with pytest.raises(ImportError_):
        commit_plan(conn, plan, filename="l.xlsx", data=data, table=table, mapping={})
    assert conn.execute("SELECT COUNT(*) FROM imports").fetchone()[0] == 0


def test_erreur_base_annule_tout(conn):
    rows = [HEADERS, ["R1", "P", 31, None, 48.1, 2.1, "A"]]
    data = make_xlsx(rows)
    table = read_listing("l.xlsx", data)
    mp = suggest_mapping(table.headers).mapping
    plan = build_plan(conn, table, mp)
    conn.execute("DROP TABLE audit_logs")  # panne simulée en cours de transaction
    with pytest.raises(ImportError_, match="annulé"):
        commit_plan(conn, plan, filename="l.xlsx", data=data, table=table, mapping=mp)
    assert conn.execute("SELECT COUNT(*) FROM imports").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM interventions").fetchone()[0] == 0


def test_journal_et_trace_import(conn):
    _, iid = run(conn, [HEADERS, ["R1", "P", 31, None, 48.1, 2.1, "A"]])
    log = conn.execute("SELECT action, entity_id FROM audit_logs").fetchone()
    assert (log["action"], log["entity_id"]) == ("import", iid)
    imp = conn.execute("SELECT sha256, mapping_json FROM imports").fetchone()
    assert len(imp["sha256"]) == 64 and json.loads(imp["mapping_json"])["rm"] == 2


def test_csv_decimales_francaises(conn):
    rows = [HEADERS, ["R1", "P", "30,1", "15,0", "48,85", "2,35", "A"]]
    run(conn, rows, name="l.csv", maker=make_csv)
    assert [(i["earth_type"], i["value"]) for i in ivs(conn)] == [("RM", 30.1)]
