"""Investment types: the 8 built-in ones plus any added later (in code, as a migration).

A type has a name, the calculation it "works like" (one of the built-in ones: that code is what the
investment's inv_type holds, so every calculation keeps working unchanged) and optional extra fields
(folio number, PRAN, design...). Extra fields are stored and shown, never calculated with.
Field format in investment_types.fields (JSON):
    [{"key": "f1", "label": "Folio number", "kind": "text|number|date|choice", "required": true, "options": [...]}]
"""
import json
import re
from datetime import date

from ..db import one, rows
from ..errors import ApiError

# calculation code -> what it does
WORKS_LIKE = {
    "share": "Trading account",
    "fd": "Lump sum + interest",
    "rd": "Monthly instalment + interest",
    "ppf": "Yearly deposits, compounding",
    "gold": "Grams × rate",
    "silver": "Grams × rate",
    "other": "Simple holding",
    "chitty": "Simple holding",
}
CUSTOM_COLORS = 6


def _color(t):
    return t["builtin"] or f"x{t['id'] % CUSTOM_COLORS + 1}"


def _out(t, used=None):
    return {
        "id": t["id"], "name": t["name"], "works_like": t["works_like"],
        "works_like_label": WORKS_LIKE[t["works_like"]], "builtin": bool(t["builtin"]),
        "fields": json.loads(t["fields"] or "[]"), "active": bool(t["active"]), "sort_order": t["sort_order"],
        "color": _color(t),
        # Gold Tree: a monthly gold savings scheme (asks for monthly amount, months, due day like an RD)
        "scheme": t["works_like"] == "gold" and t["name"].strip().lower() == "gold tree",
        "fixed": _fixed(t),
        "used": used if used is not None else
        one("SELECT COUNT(*) AS n FROM investment_details WHERE type_id = ?", (t["id"],))["n"],
    }


def list_types():
    counts = {r["type_id"]: r["n"] for r in rows("SELECT type_id, COUNT(*) AS n FROM investment_details GROUP BY type_id")}
    return [_out(t, counts.get(t["id"], 0))
            for t in rows("SELECT * FROM investment_types ORDER BY sort_order, name COLLATE NOCASE")]


def get(type_id):
    t = one("SELECT * FROM investment_types WHERE id = ?", (type_id,))
    if not t:
        raise ApiError("Investment type not found", status=404)
    return _out(t)


def builtin_id(code):
    t = one("SELECT id FROM investment_types WHERE builtin = ?", (code,))
    return t["id"] if t else None


def resolve(p, fallback_id=None):
    """The type an investment payload asks for: type_id, or a built-in code in inv_type (older callers)."""
    tid = p.get("type_id")
    if tid in (None, "") and p.get("inv_type"):
        tid = builtin_id(p["inv_type"])
        if tid is None:
            raise ApiError("Choose an investment type", field="type_id")
    if tid in (None, ""):
        tid = fallback_id
    try:
        tid = int(tid)
    except (TypeError, ValueError):
        raise ApiError("Choose an investment type", field="type_id")
    t = one("SELECT * FROM investment_types WHERE id = ?", (tid,))
    if not t:
        raise ApiError("Choose an investment type", field="type_id")
    return _out(t)


# ---------------------------------------------------------------- extra fields

def clean_extra(fields, values):
    """Check the values typed into a type's extra fields. Returns JSON text (or None)."""
    values = values if isinstance(values, dict) else {}
    out = {}
    for f in fields:
        v = values.get(f["key"])
        v = "" if v is None else str(v).strip()
        if not v:
            if f["required"]:
                raise ApiError(f"Enter {f['label']}", field="x_" + f["key"])
            continue
        if f["kind"] == "number":
            if not re.fullmatch(r"-?[\d,]*\.?\d+", v) or len(v) > 30:
                raise ApiError(f"{f['label']} must be a number", field="x_" + f["key"])
            v = v.replace(",", "")
        elif f["kind"] == "date":
            try:
                v = date.fromisoformat(v).isoformat()
            except ValueError:
                raise ApiError(f"{f['label']} must be a date", field="x_" + f["key"])
        elif f["kind"] == "choice":
            if v not in f.get("options", []):
                raise ApiError(f"Choose {f['label']} from the list", field="x_" + f["key"])
        else:
            v = v[:200]
        out[f["key"]] = v
    return json.dumps(out, ensure_ascii=False) if out else None


# ---------------------------------------------------------------- managed from Settings

def _fixed(t):
    """Built-in types (and Gold Tree, which the scheme maths recognises by its name) keep their name."""
    return bool(t["builtin"]) or (t["works_like"] == "gold" and t["name"].strip().lower() == "gold tree")


def _clean_name(name, current_id=None):
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        raise ApiError("Give the investment type a name, e.g. 'Mutual funds'", field="name")
    if len(name) > 40:
        raise ApiError("Keep the name under 40 characters", field="name")
    if one("SELECT id FROM investment_types WHERE name = ? COLLATE NOCASE AND id != ?", (name, current_id or 0)):
        raise ApiError(f"There's already an investment type called {name}", field="name")
    return name


def add_type(p):
    from ..db import get_db
    name = _clean_name(p.get("name"))
    w = p.get("works_like")
    if w not in WORKS_LIKE:
        raise ApiError("Choose how it works", field="works_like")
    conn = get_db()
    order = one("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM investment_types")["n"]
    cur = conn.execute("INSERT INTO investment_types (name, works_like, sort_order) VALUES (?, ?, ?)", (name, w, order))
    conn.commit()
    return get(cur.lastrowid)


def update_type(type_id, p):
    """Rename (your own types only) and switch on / off (any type: off = not offered for new investments)."""
    from ..db import get_db
    t = one("SELECT * FROM investment_types WHERE id = ?", (type_id,))
    if not t:
        raise ApiError("Investment type not found", status=404)
    conn = get_db()
    if "name" in p and p["name"] != t["name"]:
        if _fixed(t):
            raise ApiError(f"{t['name']} is built in, so its name can't change", field="name")
        conn.execute("UPDATE investment_types SET name = ? WHERE id = ?", (_clean_name(p["name"], type_id), type_id))
    if "active" in p:
        conn.execute("UPDATE investment_types SET active = ? WHERE id = ?", (1 if p["active"] else 0, type_id))
    conn.commit()
    return get(type_id)


def delete_type(type_id):
    from ..db import get_db
    t = one("SELECT * FROM investment_types WHERE id = ?", (type_id,))
    if not t:
        raise ApiError("Investment type not found", status=404)
    if _fixed(t):
        raise ApiError(f"{t['name']} is built in, so it can't be deleted. Switch it off instead.")
    used = one("SELECT COUNT(*) AS n FROM investment_details WHERE type_id = ?", (type_id,))["n"]
    if used:
        raise ApiError(f"{t['name']} is used by {used} investment{'s' if used > 1 else ''}, so it can't be deleted")
    conn = get_db()
    conn.execute("DELETE FROM investment_types WHERE id = ?", (type_id,))
    conn.commit()
