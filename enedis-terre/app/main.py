"""API FastAPI. À exposer uniquement en local / derrière une authentification (voir docs/SPRINT1.md)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import coords as C
from . import db as database
from .columns import FIELD_LABELS, suggest_mapping
from .importer import ImportError_, build_plan, commit_plan, now
from .readers import ReaderError, Table, read_listing

STATIC = Path(__file__).resolve().parent.parent / "static"


def get_conn() -> sqlite3.Connection:  # surchargé dans les tests
    global _CONN
    if _CONN is None:
        _CONN = database.connect()
    return _CONN


_CONN: sqlite3.Connection | None = None
app = FastAPI(title="Préparation mises à la terre Enedis", version="0.1.0")


def _read(file: UploadFile, data: bytes, sheet: str | None, header_row: int | None) -> Table:
    try:
        return read_listing(file.filename or "", data, sheet or None, header_row)
    except ReaderError as exc:
        raise HTTPException(422, str(exc)) from exc


def _parse_mapping(raw: str | None, table: Table) -> tuple[dict[str, int], list[str]]:
    if raw:
        try:
            m = json.loads(raw)
            return {k: int(v) for k, v in m.items() if v is not None and v != ""}, []
        except (ValueError, TypeError, AttributeError) as exc:
            raise HTTPException(422, f"Correspondance de colonnes invalide : {exc}") from exc
    sug = suggest_mapping(table.headers)
    return sug.mapping, sug.warnings


def _int_or_none(v: str | None) -> int | None:
    return int(v) if v not in (None, "") else None


@app.post("/api/imports/preview")
async def preview(file: UploadFile = File(...), sheet: str | None = Form(None), header_row: str | None = Form(None),
                  mapping: str | None = Form(None), conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    data = await file.read()
    table = _read(file, data, sheet, _int_or_none(header_row))
    mp, map_warnings = _parse_mapping(mapping, table)
    plan = build_plan(conn, table, mp)
    return {
        "kind": table.kind, "sheets": table.sheets, "sheet": table.sheet, "header_row": table.header_row,
        "headers": table.headers, "sample_rows": [[None if c is None else str(c) for c in r] for r in table.rows[:8]],
        "mapping": mp, "field_labels": FIELD_LABELS,
        "errors": plan.errors, "warnings": plan.warnings + map_warnings,
        "summary": None if plan.errors else plan.summary(),
        "items": [] if plan.errors else [i.as_dict() for i in plan.items],
        "row_issues": plan.row_issues,
    }


@app.post("/api/imports")
async def create_import(file: UploadFile = File(...), mapping: str = Form(...), sheet: str | None = Form(None),
                        header_row: str | None = Form(None), confirm_duplicates: str | None = Form(None),
                        conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    data = await file.read()
    table = _read(file, data, sheet, _int_or_none(header_row))
    mp, _ = _parse_mapping(mapping, table)
    try:
        confirm = {(int(r["source_row"]), str(r["earth_type"])) for r in json.loads(confirm_duplicates or "[]")}
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422, f"confirm_duplicates invalide : {exc}") from exc
    plan = build_plan(conn, table, mp, confirm)
    if plan.errors:
        raise HTTPException(422, "; ".join(plan.errors))
    try:
        import_id = commit_plan(conn, plan, filename=file.filename or "listing", data=data, table=table, mapping=mp)
    except ImportError_ as exc:
        raise HTTPException(500, str(exc)) from exc
    return {"import_id": import_id, **json.loads(conn.execute("SELECT report_json FROM imports WHERE id=?", (import_id,)).fetchone()[0])}


@app.get("/api/imports")
def list_imports(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT id, filename, kind, sheet, created_at FROM imports ORDER BY id DESC")]


@app.get("/api/imports/{import_id}")
def get_import(import_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Import introuvable")
    d = dict(row)
    d["report"] = json.loads(d.pop("report_json"))
    d["mapping"] = json.loads(d.pop("mapping_json"))
    return d


def _iv(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["issues"] = json.loads(d.pop("issues_json"))
    return d


@app.get("/api/interventions")
def list_interventions(earth_type: str | None = None, status: str | None = None, commune: str | None = None,
                       q: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    where, args = [], []
    if earth_type:
        if earth_type not in ("RM", "RNG"):
            raise HTTPException(422, "earth_type doit valoir RM ou RNG")
        where.append("earth_type = ?"); args.append(earth_type)
    if status:
        where.append("status = ?"); args.append(status)
    if commune:
        where.append("commune LIKE ? ESCAPE '\\'"); args.append("%" + _like(commune) + "%")
    if q:
        where.append("(reference LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR transformer_ref LIKE ? ESCAPE '\\')")
        args += ["%" + _like(q) + "%"] * 3
    sql = "SELECT * FROM interventions" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id"
    return [_iv(r) for r in conn.execute(sql, args)]


def _like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@app.get("/api/interventions/{iid}")
def get_intervention(iid: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM interventions WHERE id=?", (iid,)).fetchone()
    if row is None:
        raise HTTPException(404, "Intervention introuvable")
    d = _iv(row)
    meas = conn.execute("SELECT source_row, value_raw, raw_json, import_id FROM measurements WHERE id=?",
                        (row["measurement_id"],)).fetchone()
    d["source"] = {"import_id": meas["import_id"], "source_row": meas["source_row"], "value_raw": meas["value_raw"],
                   "raw": json.loads(meas["raw_json"])}
    d["history"] = [dict(r) | {"details": json.loads(r["details"])} for r in conn.execute(
        "SELECT ts, action, details FROM audit_logs WHERE entity='interventions' AND entity_id=? ORDER BY id", (iid,))]
    return d


@app.patch("/api/interventions/{iid}/location")
def correct_location(iid: int, body: dict[str, Any] = Body(...),
                     conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Correction manuelle des coordonnées : revalidée, tracée dans audit_logs."""
    row = conn.execute("SELECT * FROM interventions WHERE id=?", (iid,)).fetchone()
    if row is None:
        raise HTTPException(404, "Intervention introuvable")
    res = C.parse_coordinates(body.get("latitude"), body.get("longitude"))
    if res.status != C.OK:
        raise HTTPException(422, res.message or "coordonnées invalides")
    issues = [i for i in json.loads(row["issues_json"]) if not i["code"].startswith("gps_")]
    issues += [{"code": "gps_a_verifier", "message": w} for w in res.warnings]
    issues.append({"code": "gps_corrige", "message": "coordonnées corrigées manuellement"})
    ts = now()
    with conn:
        conn.execute("UPDATE interventions SET latitude=?, longitude=?, status='to_prepare', issues_json=?, updated_at=? WHERE id=?",
                     (res.lat, res.lon, json.dumps(issues, ensure_ascii=False), ts, iid))
        conn.execute("INSERT INTO audit_logs(ts, action, entity, entity_id, details) VALUES (?,?,?,?,?)",
                     (ts, "correct_location", "interventions", iid, json.dumps(
                         {"old": [row["latitude"], row["longitude"]], "new": [res.lat, res.lon]})))
    return get_intervention(iid, conn)


@app.get("/api/stats")
def stats(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, int]:
    def count(sql: str) -> int:
        return conn.execute(sql).fetchone()[0]
    return {
        "imports": count("SELECT COUNT(*) FROM imports"),
        "interventions_rm": count("SELECT COUNT(*) FROM interventions WHERE earth_type='RM'"),
        "interventions_rng": count("SELECT COUNT(*) FROM interventions WHERE earth_type='RNG'"),
        "incomplete": count("SELECT COUNT(*) FROM interventions WHERE status='incomplete'"),
        "invalid_measurements": count("SELECT COUNT(*) FROM measurements WHERE status='invalid'"),
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")
