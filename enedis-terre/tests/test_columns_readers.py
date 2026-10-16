import pytest

from app.columns import suggest_mapping, validate_mapping
from app.readers import ReaderError, read_listing
from conftest import HEADERS, make_csv, make_xlsx


def test_detection_colonnes_standard():
    m = suggest_mapping(HEADERS).mapping
    assert m == {"reference": 0, "transformer_ref": 1, "rm": 2, "rng": 3, "latitude": 4, "longitude": 5, "commune": 6}


def test_detection_libelles_longs_et_accents():
    h = ["N° intervention", "Résistance terre des masses (Ω)", "Résistance globale neutre", "Coordonnées GPS", "Ville"]
    m = suggest_mapping(h).mapping
    assert m["reference"] == 0 and m["rm"] == 1 and m["rng"] == 2 and m["gps"] == 3 and m["commune"] == 4


def test_gps_unique_ecarte_si_lat_lon():
    m = suggest_mapping(["Latitude", "Longitude", "GPS", "RM"]).mapping
    assert "gps" not in m


def test_validation_exige_une_mesure():
    errs, warns = validate_mapping({"reference": 0}, 3)
    assert errs and warns


def test_validation_valeur_sans_type_refusee():
    errs, _ = validate_mapping({"value": 0, "latitude": 1, "longitude": 2}, 3)
    assert any("distinguer" in e for e in errs)


def test_validation_colonne_dupliquee_et_hors_limites():
    errs, _ = validate_mapping({"rm": 0, "rng": 0}, 2)
    assert any("plusieurs" in e for e in errs)
    errs, _ = validate_mapping({"rm": 9}, 2)
    assert any("invalide" in e for e in errs)


def test_xlsx_entete_non_en_premiere_ligne():
    data = make_xlsx([["Listing Enedis 2026"], [None], HEADERS, ["A1", "P1", 31, 10, 48.1, 2.1, "Paris"]])
    t = read_listing("x.xlsx", data)
    assert t.headers == HEADERS and t.header_row == 2 and t.source_rows == [4]


def test_xlsx_plusieurs_feuilles_avertit():
    from openpyxl import Workbook
    import io
    wb = Workbook(); wb.active.title = "Vide"; ws = wb.create_sheet("Données"); ws.append(HEADERS); ws.append(["A", "P", 1, 1, 1, 1, "x"])
    buf = io.BytesIO(); wb.save(buf)
    t = read_listing("x.xlsx", buf.getvalue())
    assert t.sheet == "Données" and any("feuilles" in w for w in t.warnings)


def test_csv_point_virgule_et_cp1252():
    headers = [h.replace(" (Ω)", "") for h in HEADERS]  # Ω n'existe pas en cp1252
    data = make_csv([headers, ["A", "P", "31,5", "10", "48,1", "2,1", "Béziers"]], encoding="cp1252")
    t = read_listing("x.csv", data)
    assert t.headers == headers and t.rows[0][6] == "Béziers" and any("1252" in w for w in t.warnings)


def test_fichier_vide_ou_inconnu_ou_corrompu():
    for name, data in [("x.csv", b""), ("x.docx", b"hello"), ("x.xlsx", b"PK\x03\x04garbage"), ("x.xls", b"abc")]:
        with pytest.raises(ReaderError):
            read_listing(name, data)


def test_pdf_tableau_et_pdf_scanne():
    reportlab = pytest.importorskip("reportlab")
    import io
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
    buf = io.BytesIO()
    pdf_headers = [h.replace(" (Ω)", "") for h in HEADERS]  # police PDF de base sans Ω
    tbl = Table([pdf_headers, ["A1", "P1", "31,5", "10", "48,1", "2,1", "Lyon"]])
    tbl.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))
    SimpleDocTemplate(buf, pagesize=landscape(A4)).build([tbl])
    t = read_listing("l.pdf", buf.getvalue())
    assert t.headers[:3] == ["Référence", "Poste", "RM"] and t.rows[0][0] == "A1"
    assert any("PDF" in w for w in t.warnings)

    from reportlab.pdfgen import canvas
    buf2 = io.BytesIO(); c = canvas.Canvas(buf2); c.showPage(); c.save()  # page sans texte = scan simulé
    with pytest.raises(ReaderError, match="scan"):
        read_listing("scan.pdf", buf2.getvalue())
