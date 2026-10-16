import json

import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.main import app, get_conn  # noqa: E402
from conftest import HEADERS, make_xlsx  # noqa: E402


@pytest.fixture
def client():
    conn = db.connect(":memory:")
    app.dependency_overrides[get_conn] = lambda: conn
    yield TestClient(app)
    app.dependency_overrides.clear()


def upload(client, rows, url="/api/imports/preview", **data):
    return client.post(url, files={"file": ("l.xlsx", make_xlsx(rows))}, data=data)


ROWS = [HEADERS, ["R1", "P1", 31, 10, 48.1, 2.1, "Lyon"], ["R2", "P2", 5, 20, None, None, "Nice"]]


def test_preview_puis_import_puis_liste(client):
    r = upload(client, ROWS)
    assert r.status_code == 200
    body = r.json()
    assert body["mapping"]["rm"] == 2 and body["summary"]["rm_triggered"] == 1 and body["summary"]["incomplete"] == 1
    assert client.get("/api/interventions").json() == []  # l'aperçu n'écrit rien
    r = upload(client, ROWS, "/api/imports", mapping=json.dumps(body["mapping"]))
    assert r.status_code == 200 and r.json()["created_interventions"] == 2
    assert len(client.get("/api/interventions").json()) == 2
    assert [i["reference"] for i in client.get("/api/interventions?earth_type=RM").json()] == ["R1"]
    assert [i["reference"] for i in client.get("/api/interventions?status=incomplete").json()] == ["R2"]
    assert [i["reference"] for i in client.get("/api/interventions?commune=nic").json()] == ["R2"]
    assert client.get("/api/interventions?earth_type=XX").status_code == 422
    stats = client.get("/api/stats").json()
    assert stats["interventions_rm"] == 1 and stats["interventions_rng"] == 1 and stats["incomplete"] == 1


def test_filtre_like_echappe(client):
    upload(client, ROWS, "/api/imports", mapping=json.dumps({"reference": 0, "rm": 2, "rng": 3, "latitude": 4, "longitude": 5, "commune": 6}))
    assert client.get("/api/interventions", params={"q": "%"}).json() == []


def test_fichier_invalide_donne_message_clair(client):
    r = client.post("/api/imports/preview", files={"file": ("x.docx", b"hello")})
    assert r.status_code == 422 and "non pris en charge" in r.json()["detail"]


def test_import_refuse_si_mapping_sans_mesure(client):
    r = upload(client, ROWS, "/api/imports", mapping=json.dumps({"reference": 0}))
    assert r.status_code == 422


def test_correction_gps_tracee(client):
    upload(client, ROWS, "/api/imports", mapping=json.dumps({"reference": 0, "rm": 2, "rng": 3, "latitude": 4, "longitude": 5}))
    inc = client.get("/api/interventions?status=incomplete").json()[0]
    assert client.patch(f"/api/interventions/{inc['id']}/location", json={"latitude": "abc", "longitude": "2"}).status_code == 422
    r = client.patch(f"/api/interventions/{inc['id']}/location", json={"latitude": "43,7", "longitude": "7,26"})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "to_prepare" and d["latitude"] == 43.7
    assert d["history"][0]["action"] == "correct_location" and d["history"][0]["details"]["old"] == [None, None]
    assert not any(i["code"] == "gps_absent" for i in d["issues"])


def test_correction_conservee_apres_nouvel_import_du_meme_fichier(client):
    m = json.dumps({"reference": 0, "rm": 2, "rng": 3, "latitude": 4, "longitude": 5})
    upload(client, ROWS, "/api/imports", mapping=m)
    iid = client.get("/api/interventions?status=incomplete").json()[0]["id"]
    client.patch(f"/api/interventions/{iid}/location", json={"latitude": 43.7, "longitude": 7.26})
    upload(client, ROWS, "/api/imports", mapping=m)  # ré-import : doublons ignorés, rien d'écrasé
    d = client.get(f"/api/interventions/{iid}").json()
    assert d["latitude"] == 43.7 and len(client.get("/api/interventions").json()) == 2


def test_introuvable(client):
    assert client.get("/api/interventions/999").status_code == 404
    assert client.get("/api/imports/999").status_code == 404


def test_page_statique(client):
    r = client.get("/")
    assert r.status_code == 200 and "Préparation" in r.text
