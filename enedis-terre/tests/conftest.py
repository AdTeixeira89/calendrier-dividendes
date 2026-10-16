import io
import sys
from pathlib import Path

import pytest
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


def make_xlsx(rows, sheet="Listing"):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def make_csv(rows, delim=";", encoding="utf-8"):
    return "\n".join(delim.join("" if c is None else str(c) for c in r) for r in rows).encode(encoding)


HEADERS = ["Référence", "Poste", "RM (Ω)", "RNG (Ω)", "Latitude", "Longitude", "Commune"]
