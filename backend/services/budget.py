"""Monthly Budget: a small sheet of your own, separate from the app's categories and transactions.

You add income and expense items (they exist only here), give each an amount and an optional note per month, and
tick expenses as done when paid. Each month shows income, expenses, paid, still to pay, and whether the money is
sufficient (income - expenses >= 0) or short.

Months: you choose them (at most three, from this month up to six months ahead) with "Add month" and "Delete".
A month stays until it ends, so payments can still be ticked. "Clear" empties a month but keeps it.
"""
import calendar
import re
from datetime import date

from ..db import get_db, one, rows
from ..errors import ApiError
from ..money import to_paise, to_rupees
from .reports import shift_month

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
KINDS = ("income", "expense")
NAME_MAX, NOTE_MAX = 60, 200
MAX_MONTHS, AHEAD = 3, 6


def _cur(today):
    return today.strftime("%Y-%m")


def months(today=None):
    """The months in the plan, oldest first. A month stays until it ends; past ones drop off."""
    cur = _cur(today or date.today())
    return [r["month"] for r in rows("SELECT month FROM budget_months WHERE month >= ? ORDER BY month", (cur,))]


def choices(today=None):
    """Months that can be added: this month and the next six, not already in the plan (none once three are shown)."""
    cur = _cur(today or date.today())
    shown = months(today)
    if len(shown) >= MAX_MONTHS:
        return []
    return [m for m in (shift_month(cur, i) for i in range(AHEAD + 1)) if m not in shown]


def add_month(month, today=None):
    if not isinstance(month, str) or not MONTH_RE.match(month):
        raise ApiError("Choose a month", field="month")
    if len(months(today)) >= MAX_MONTHS:
        raise ApiError(f"The plan holds at most {MAX_MONTHS} months. Delete one first.")
    if month not in choices(today):
        raise ApiError("Choose this month or one of the next six", field="month")
    conn = get_db()
    conn.execute("DELETE FROM budget_months WHERE month < ?", (_cur(today or date.today()),))
    conn.execute("INSERT INTO budget_months (month) VALUES (?)", (month,))
    conn.commit()


def _month(month, today=None):
    if not isinstance(month, str) or not MONTH_RE.match(month):
        raise ApiError("Month must be YYYY-MM", field="month")
    if month not in months(today):
        raise ApiError("That month isn't in the plan", status=400)
    return month


# ---------------------------------------------------------------- items (budget only)

def _name(v):
    if not isinstance(v, str):
        raise ApiError("Give the item a name", field="name")
    name = " ".join(v.split())[:NAME_MAX]
    if not name:
        raise ApiError("Give the item a name", field="name")
    return name


def _item(item_id):
    it = one("SELECT * FROM budget_items WHERE id = ?", (item_id,))
    if not it:
        raise ApiError("Item not found", status=404)
    return it


def add_item(p):
    kind = (p or {}).get("kind")
    if kind not in KINDS:
        raise ApiError("Choose income or expense", field="kind")
    name = _name(p.get("name"))
    if one("SELECT 1 FROM budget_items WHERE kind = ? AND name = ?", (kind, name)):
        raise ApiError(f"'{name}' is already in the budget", field="name")
    cur = get_db().execute("INSERT INTO budget_items (kind, name) VALUES (?, ?)", (kind, name))
    get_db().commit()
    return _item(cur.lastrowid)


def rename_item(item_id, p):
    it = _item(item_id)
    name = _name((p or {}).get("name"))
    if one("SELECT 1 FROM budget_items WHERE kind = ? AND name = ? AND id != ?", (it["kind"], name, item_id)):
        raise ApiError(f"'{name}' is already in the budget", field="name")
    get_db().execute("UPDATE budget_items SET name = ? WHERE id = ?", (name, item_id))
    get_db().commit()


def delete_item(item_id):
    _item(item_id)
    get_db().execute("DELETE FROM budget_entries WHERE item_id = ?", (item_id,))
    get_db().execute("DELETE FROM budget_items WHERE id = ?", (item_id,))
    get_db().commit()


# ---------------------------------------------------------------- amounts, notes, ticks

def save(month, items, today=None):
    """items: [{item_id, amount?, note?, done?}] - only the keys sent change; an empty row is removed."""
    month = _month(month, today)
    if not isinstance(items, list):
        raise ApiError("Send the budget as a list")
    conn = get_db()
    for it in items:
        if not isinstance(it, dict):
            raise ApiError("Send the budget as a list")
        try:
            iid = int(it.get("item_id"))
        except (TypeError, ValueError):
            raise ApiError("Item not found", status=404)
        item = _item(iid)
        old = one("SELECT amount, note, done FROM budget_entries WHERE item_id = ? AND month = ?", (iid, month)) or \
            {"amount": None, "note": None, "done": 0}
        amount, note, done = old["amount"], old["note"], old["done"]
        if "amount" in it:
            raw = it["amount"]
            if raw in (None, ""):
                amount = None
            else:
                try:
                    amount = to_paise(raw)
                except ValueError as e:
                    raise ApiError(str(e), field=f"amount_{iid}")
                if amount is None or amount < 0:
                    raise ApiError("Amounts can't be negative", field=f"amount_{iid}")
        if "note" in it:
            if it["note"] is not None and not isinstance(it["note"], str):
                raise ApiError("A note must be text", field=f"note_{iid}")
            note = (it["note"] or "").strip()[:NOTE_MAX] or None
        if "done" in it:
            if item["kind"] != "expense":
                raise ApiError("Only payments (expenses) can be ticked as done")
            done = 1 if it["done"] in (True, 1, "1", "true") else 0
        if amount is None and note is None and not done:
            conn.execute("DELETE FROM budget_entries WHERE item_id = ? AND month = ?", (iid, month))
        else:
            conn.execute("""INSERT INTO budget_entries (item_id, month, amount, note, done) VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT (item_id, month) DO UPDATE SET amount = excluded.amount, note = excluded.note,
                            done = excluded.done, updated_at = datetime('now', 'localtime')""",
                         (iid, month, amount, note, done))
    conn.commit()


def copy(month, src, today=None):
    """Fill a month with another month's amounts and notes (ticks start empty). Replaces what was there."""
    month = _month(month, today)
    if not isinstance(src, str) or not MONTH_RE.match(src) or src == month:
        raise ApiError("Choose the month to copy from", field="from")
    data = rows("SELECT item_id, amount, note FROM budget_entries WHERE month = ? AND (amount IS NOT NULL OR note IS NOT NULL)",
                (src,))
    if not data:
        raise ApiError("That month has nothing to copy")
    conn = get_db()
    conn.execute("DELETE FROM budget_entries WHERE month = ?", (month,))
    conn.executemany("INSERT INTO budget_entries (item_id, month, amount, note) VALUES (?, ?, ?, ?)",
                     [(r["item_id"], month, r["amount"], r["note"]) for r in data])
    conn.commit()


def clear(month, today=None):
    """Empty a month: every amount, note and tick in it goes; the month stays in the plan."""
    month = _month(month, today)
    get_db().execute("DELETE FROM budget_entries WHERE month = ?", (month,))
    get_db().commit()


def delete_month(month, today=None):
    """Remove a month from the plan, with every amount, note and tick in it (the items stay for other months)."""
    month = _month(month, today)
    conn = get_db()
    conn.execute("DELETE FROM budget_entries WHERE month = ?", (month,))
    conn.execute("DELETE FROM budget_months WHERE month = ?", (month,))
    conn.commit()


# ---------------------------------------------------------------- the sheet

def sheet(today=None):
    today = today or date.today()
    cur = _cur(today)
    ms = months(today)
    ms_q = ms or ["0000-00"]                               # no months: keep the query valid
    items = rows("SELECT id, kind, name FROM budget_items ORDER BY kind, name COLLATE NOCASE")
    ent = {}
    for r in rows(f"SELECT * FROM budget_entries WHERE month IN ({','.join('?' * len(ms_q))})", tuple(ms_q)):
        ent[(r["item_id"], r["month"])] = r
    out = {"income": [], "expense": []}
    tot = {m: {"income": 0, "expense": 0, "paid": 0, "items": 0, "done": 0} for m in ms}
    for it in items:
        cells = {}
        for m in ms:
            e = ent.get((it["id"], m))
            amt = e["amount"] if e else None
            done = bool(e and e["done"]) if it["kind"] == "expense" else False
            cells[m] = {"amount": to_rupees(amt), "note": e["note"] if e else None, "done": done}
            tot[m][it["kind"]] += amt or 0
            if it["kind"] == "expense" and amt:
                tot[m]["items"] += 1
                if done:
                    tot[m]["paid"] += amt
                    tot[m]["done"] += 1
        out[it["kind"]].append({"id": it["id"], "name": it["name"], "cells": cells})
    has = {m: any(ent.get((it["id"], m)) for it in items) for m in ms}
    columns = []
    for i, m in enumerate(ms):
        T = tot[m]
        y, mo = int(m[:4]), int(m[5:7])
        days = calendar.monthrange(y, mo)[1] - today.day if m == cur else (date(y, mo, 1) - today).days
        columns.append({
            "month": m, "running": m == cur, "days": days,          # days: left (running) or until it starts
            "has_data": has[m],
            "copy_from": ms[i - 1] if i > 0 and has[ms[i - 1]] else None,      # only from a month with something in it
            "income": to_rupees(T["income"]), "expense": to_rupees(T["expense"]), "paid": to_rupees(T["paid"]),
            "still_to_pay": to_rupees(T["expense"] - T["paid"]), "balance": to_rupees(T["income"] - T["expense"]),
            "items": T["items"], "done": T["done"],
        })
    return {"months": columns, "can_add": choices(today), "max_months": MAX_MONTHS, "income": out["income"], "expense": out["expense"]}
