"""Planification et validation d'un import : détection des doublons, création des interventions, traçabilité."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from . import coords as C
from .analysis import Issue, RowAnalysis, analyze_table, intervention_issues
from .columns import validate_mapping
from .normalize_keys import fuzzy_signature
from .readers import Table
from .rules import BELOW, INVALID, TRIGGERED, MeasurementResult


class ImportError_(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Décisions par mesure
NEW = "new"
DUP_REF = "duplicate_reference"          # même référence + type déjà connu : ignoré, jamais écrasé
DUP_FUZZY = "possible_duplicate"          # sans référence fiable : confirmation requise
NOT_STORED = "not_stored"                 # mesure absente


@dataclass
class PlannedItem:
    row: RowAnalysis
    measurement: MeasurementResult
    decision: str
    detail: str | None = None
    confirmed: bool = False

    def as_dict(self) -> dict[str, Any]:
        r, m = self.row, self.measurement
        return {
            "source_row": r.source_row, "reference": r.reference, "earth_type": m.earth_type,
            "value": None if m.value is None else float(m.value), "measure_status": m.status,
            "decision": self.decision, "detail": self.detail,
            "lat": r.coord.lat, "lon": r.coord.lon, "commune": r.commune,
            "issues": [i.as_dict() for i in intervention_issues(r)] if m.triggered else [],
        }


@dataclass
class Plan:
    items: list[PlannedItem] = field(default_factory=list)
    row_issues: list[dict[str, Any]] = field(default_factory=list)
    empty_rows: int = 0
    rows_read: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        def n(pred) -> int:
            return sum(1 for i in self.items if pred(i))
        will = lambda i: i.decision == NEW or (i.decision == DUP_FUZZY and i.confirmed)
        return {
            "rows_read": self.rows_read,
            "empty_rows": self.empty_rows,
            "rm_triggered": n(lambda i: i.measurement.earth_type == "RM" and i.measurement.triggered),
            "rng_triggered": n(lambda i: i.measurement.earth_type == "RNG" and i.measurement.triggered),
            "to_import_interventions": n(lambda i: will(i) and i.measurement.triggered),
            "incomplete": n(lambda i: will(i) and i.measurement.triggered and i.row.coord.status != C.OK),
            "below_threshold": n(lambda i: i.measurement.status == BELOW),
            "invalid_values": n(lambda i: i.measurement.status == INVALID),
            "duplicates_skipped": n(lambda i: i.decision == DUP_REF),
            "possible_duplicates": n(lambda i: i.decision == DUP_FUZZY),
            "rows_with_issues": len(self.row_issues),
        }


def build_plan(conn: sqlite3.Connection, table: Table, mapping: dict[str, int],
               confirm_rows: set[tuple[int, str]] | None = None) -> Plan:
    """confirm_rows : couples (ligne source, type) de doublons potentiels que l'utilisateur confirme vouloir importer."""
    confirm_rows = confirm_rows or set()
    plan = Plan()
    errors, warnings = validate_mapping(mapping, len(table.headers))
    plan.errors, plan.warnings = errors, warnings + list(table.warnings)
    if errors:
        return plan

    seen_ref: set[tuple[str, str]] = set()
    seen_sig: set[tuple] = set()
    for ra in analyze_table(table, mapping):
        if ra.empty:
            plan.empty_rows += 1
            continue
        plan.rows_read += 1
        if ra.issues:
            plan.row_issues.append({"source_row": ra.source_row, "reference": ra.reference,
                                    "issues": [i.as_dict() for i in ra.issues]})
        for m in ra.measurements:
            if m.status in ("missing",):
                continue
            decision, detail = NEW, None
            if ra.reference:
                key = (ra.reference, m.earth_type)
                db_row = conn.execute(
                    "SELECT id, value FROM measurements WHERE reference=? AND earth_type=?", key).fetchone()
                if db_row is not None or key in seen_ref:
                    decision = DUP_REF
                    where = f"déjà importée (mesure #{db_row['id']})" if db_row is not None else "présente plusieurs fois dans le fichier"
                    detail = f"référence {ra.reference} / {m.earth_type} {where} ; l'existant n'est pas écrasé"
                    if db_row is not None and m.value is not None and db_row["value"] is not None \
                            and float(m.value) != db_row["value"]:
                        detail += f" (valeur différente : {db_row['value']} → {m.value})"
                else:
                    seen_ref.add(key)
            else:
                sig = fuzzy_signature(m.earth_type, ra, m)
                if sig is not None:
                    in_db = _sig_in_db(conn, sig, m, ra)
                    if in_db or sig in seen_sig:
                        decision = DUP_FUZZY
                        detail = ("lignes sans référence aux champs identiques "
                                  + ("à une mesure déjà importée" if in_db else "à une autre ligne du fichier")
                                  + " : confirmation requise avant import")
                    seen_sig.add(sig)
            item = PlannedItem(ra, m, decision, detail,
                               confirmed=(ra.source_row, m.earth_type) in confirm_rows)
            plan.items.append(item)
    return plan


def _sig_in_db(conn: sqlite3.Connection, sig: tuple, m: MeasurementResult, ra: RowAnalysis) -> bool:
    rows = conn.execute(
        """SELECT me.value, i.latitude, i.longitude, i.commune, i.address
           FROM measurements me LEFT JOIN interventions i ON i.measurement_id = me.id
           WHERE me.reference IS NULL AND me.earth_type = ?""", (m.earth_type,)).fetchall()
    from .normalize_keys import signature_from_db
    return any(signature_from_db(m.earth_type, r) == sig for r in rows)


def commit_plan(conn: sqlite3.Connection, plan: Plan, *, filename: str, data: bytes, table: Table,
                mapping: dict[str, int]) -> int:
    """Écrit le plan en une seule transaction. Retourne l'id de l'import."""
    if plan.errors:
        raise ImportError_("; ".join(plan.errors))
    ts = now()
    summary_before = plan.summary()
    try:
        with conn:  # transaction : tout ou rien
            cur = conn.execute(
                "INSERT INTO imports(filename, sha256, kind, sheet, mapping_json, report_json, created_at) VALUES (?,?,?,?,?,?,?)",
                (filename, hashlib.sha256(data).hexdigest(), table.kind, table.sheet,
                 json.dumps(mapping), "{}", ts))
            import_id = cur.lastrowid
            created = 0
            for it in plan.items:
                if not (it.decision == NEW or (it.decision == DUP_FUZZY and it.confirmed)):
                    continue
                r, m = it.row, it.measurement
                mcur = conn.execute(
                    """INSERT INTO measurements(import_id, source_row, reference, earth_type, status, value,
                       value_raw, threshold, message, raw_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (import_id, r.source_row, r.reference, m.earth_type, m.status,
                     None if m.value is None else float(m.value), m.raw, float(m.threshold), m.message,
                     json.dumps(r.raw, ensure_ascii=False), ts))
                if m.status == TRIGGERED:
                    issues = intervention_issues(r)
                    if it.decision == DUP_FUZZY:
                        issues.insert(0, Issue("doublon_confirme", "doublon potentiel confirmé manuellement"))
                    status = "to_prepare" if r.coord.status == C.OK else "incomplete"
                    conn.execute(
                        """INSERT INTO interventions(measurement_id, import_id, reference, earth_type, value, threshold,
                           latitude, longitude, transformer_ref, commune, address, notes, status, issues_json,
                           created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (mcur.lastrowid, import_id, r.reference, m.earth_type, float(m.value), float(m.threshold),
                         r.coord.lat if r.coord.status == C.OK else None,
                         r.coord.lon if r.coord.status == C.OK else None,
                         r.transformer_ref, r.commune, r.address, r.notes, status,
                         json.dumps([i.as_dict() for i in issues], ensure_ascii=False), ts, ts))
                    created += 1
            report = {
                "summary": plan.summary(), "created_interventions": created,
                "row_issues": plan.row_issues, "warnings": plan.warnings,
                "skipped": [i.as_dict() for i in plan.items if i.decision == DUP_REF
                            or (i.decision == DUP_FUZZY and not i.confirmed)],
            }
            conn.execute("UPDATE imports SET report_json=? WHERE id=?", (json.dumps(report, ensure_ascii=False), import_id))
            conn.execute(
                "INSERT INTO audit_logs(ts, action, entity, entity_id, details) VALUES (?,?,?,?,?)",
                (ts, "import", "imports", import_id, json.dumps(
                    {"filename": filename, "created_interventions": created, "summary": summary_before},
                    ensure_ascii=False)))
    except sqlite3.Error as exc:
        raise ImportError_(f"Erreur de base de données, import annulé : {exc}") from exc
    return import_id
