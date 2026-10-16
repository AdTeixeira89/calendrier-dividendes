"""Stockage SQLite. Les entités des sprints suivants (parcelles, candidats, autorisations…) viendront en migrations."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE imports (
    id            INTEGER PRIMARY KEY,
    filename      TEXT NOT NULL,
    sha256        TEXT NOT NULL,
    kind          TEXT NOT NULL,
    sheet         TEXT,
    mapping_json  TEXT NOT NULL,
    report_json   TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE measurements (
    id           INTEGER PRIMARY KEY,
    import_id    INTEGER NOT NULL REFERENCES imports(id),
    source_row   INTEGER NOT NULL,
    reference    TEXT,
    earth_type   TEXT NOT NULL CHECK (earth_type IN ('RM','RNG')),
    status       TEXT NOT NULL CHECK (status IN ('triggered','below','invalid')),
    value        REAL,
    value_raw    TEXT,
    threshold    REAL NOT NULL,
    message      TEXT,
    raw_json     TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_measurements_ref ON measurements(reference, earth_type)
    WHERE reference IS NOT NULL;

CREATE TABLE interventions (
    id              INTEGER PRIMARY KEY,
    measurement_id  INTEGER NOT NULL UNIQUE REFERENCES measurements(id),
    import_id       INTEGER NOT NULL REFERENCES imports(id),
    reference       TEXT,
    earth_type      TEXT NOT NULL CHECK (earth_type IN ('RM','RNG')),
    value           REAL NOT NULL,
    threshold       REAL NOT NULL,
    latitude        REAL,
    longitude       REAL,
    transformer_ref TEXT,
    commune         TEXT,
    address         TEXT,
    notes           TEXT,
    status          TEXT NOT NULL CHECK (status IN ('incomplete','to_prepare')),
    issues_json     TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX ix_interventions_type ON interventions(earth_type, status);

CREATE TABLE audit_logs (
    id         INTEGER PRIMARY KEY,
    ts         TEXT NOT NULL,
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  INTEGER,
    details    TEXT NOT NULL
);
"""


def default_path() -> str:
    return os.environ.get("ENEDIS_DB", str(Path(__file__).resolve().parent.parent / "data" / "enedis.sqlite3"))


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or default_path()
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == 0:
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    elif version > SCHEMA_VERSION:
        raise RuntimeError(f"Base plus récente ({version}) que l'application ({SCHEMA_VERSION}).")
    return conn
