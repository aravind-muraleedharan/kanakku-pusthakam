"""Accounts, categories and payment modes (editable from Settings)."""
import sqlite3
from datetime import date as _date

from ..db import get_db, one, rows
from ..errors import ApiError
from ..money import to_paise, to_rupees

ACCOUNT_KINDS = ("bank", "credit_card", "cash", "investment", "loan")
BANK_SUBTYPES = ("savings", "current", "salary", "other")
OWED = ("credit_card", "loan")          # opening amount entered as "owed", stored as a negative balance
INV_TYPES = ("share", "fd", "rd", "ppf", "gold", "silver", "chitty", "other")
CATEGORY_KINDS = ("expense", "income")

# table -> (columns the API may set, usage check SQL)
TABLES = {
    "accounts": {
        "fields": ("name", "kind", "opening_balance", "opening_date", "active", "sort_order",
                   "institution", "subtype", "credit_limit", "bill_day", "due_day"),
        "usage": "SELECT COUNT(*) AS n FROM entries WHERE from_account_id = :id OR to_account_id = :id",
    },
    "categories": {
        "fields": ("name", "kind", "description", "active", "sort_order"),
        "usage": "SELECT COUNT(*) AS n FROM entries WHERE category_id = :id",
    },
    "payment_modes": {
        "fields": ("name", "active", "sort_order"),
        "usage": "SELECT COUNT(*) AS n FROM entries WHERE payment_mode_id = :id",
    },
}


def _check_table(table):
    if table not in TABLES:
        raise ApiError("Unknown list", status=404)


def _usage(table, item_id):
    return one(TABLES[table]["usage"], {"id": item_id})["n"]


def _account_out(r):
    r = dict(r)
    # credit card opening is stored as a negative balance; show it as a positive outstanding
    r["opening_balance"] = to_rupees(-r["opening_balance"] if r["kind"] in OWED else r["opening_balance"])
    if "credit_limit" in r:
        r["credit_limit"] = to_rupees(r["credit_limit"])
    return r


def list_items(table, include_inactive=True):
    _check_table(table)
    cond = "" if include_inactive else " WHERE active = 1"
    order = "kind, name COLLATE NOCASE" if table == "categories" else "sort_order, name"   # categories: A to Z
    data = rows(f"SELECT * FROM {table}{cond} ORDER BY {order}")
    for r in data:
        r["active"] = bool(r["active"])
        r["used"] = _usage(table, r["id"])
    if table == "accounts":
        types = {r["account_id"]: r["inv_type"] for r in rows("SELECT account_id, inv_type FROM investment_details")}
        data = [_account_out(r) for r in data]
        for r in data:
            if r["kind"] == "investment":
                r["inv_type"] = types.get(r["id"], "other")
    return data


def all_masters():
    return {t: list_items(t) for t in TABLES}


def _clean(table, payload, existing=None):
    fields = TABLES[table]["fields"]
    clean = {}
    for f in fields:
        if f not in payload:
            continue
        v = payload[f]
        if f == "name":
            v = (v or "").strip()
            if not v:
                raise ApiError("Name is required", field="name")
            if len(v) > 80:
                raise ApiError("Name is too long (max 80)", field="name")
        elif f == "kind":
            allowed = ACCOUNT_KINDS if table == "accounts" else CATEGORY_KINDS
            if v not in allowed:
                raise ApiError(f"Type must be one of: {', '.join(allowed)}", field="kind")
        elif f == "active":
            v = 1 if v in (True, 1, "1", "true", "on") else 0
        elif f == "sort_order":
            try:
                v = int(v or 0)
            except (TypeError, ValueError):
                raise ApiError("Order must be a number", field="sort_order")
        elif f == "opening_balance":
            try:
                v = to_paise(v) or 0
            except ValueError as e:
                raise ApiError(str(e), field="opening_balance")
        elif f == "opening_date":
            v = (v or "").strip() or None
            if v:
                try:
                    _date.fromisoformat(v)
                except ValueError:
                    raise ApiError("Date must be YYYY-MM-DD", field="opening_date")
        elif f in ("description", "institution"):
            v = (v or "").strip()[:80] or None
        elif f == "subtype":
            v = v or None
            if v and v not in BANK_SUBTYPES:
                raise ApiError("Choose savings, current, salary or other", field="subtype")
        elif f == "credit_limit":
            try:
                v = to_paise(v)
            except ValueError as e:
                raise ApiError(str(e), field="credit_limit")
            if v is not None and v < 0:
                raise ApiError("Limit can't be negative", field="credit_limit")
        elif f in ("bill_day", "due_day"):
            if v in (None, ""):
                v = None
            else:
                try:
                    v = int(v)
                    assert 1 <= v <= 31
                except (TypeError, ValueError, AssertionError):
                    raise ApiError("Enter a day of the month, 1–31", field=f)
        clean[f] = v

    if table == "accounts" and "opening_balance" in clean:
        kind = clean.get("kind") or (existing or {}).get("kind")
        if kind in OWED:
            clean["opening_balance"] = -clean["opening_balance"]
    return clean


def create(table, payload):
    _check_table(table)
    if table in ("accounts", "categories") and not payload.get("kind"):
        raise ApiError("Type is required", field="kind")
    clean = _clean(table, payload)
    if "name" not in clean:
        raise ApiError("Name is required", field="name")
    if "sort_order" not in clean:
        clean["sort_order"] = (one(f"SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM {table}") or {"n": 1})["n"]
    cols = list(clean)
    conn = get_db()
    try:
        cur = conn.execute(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)})", clean
        )
        if table == "accounts" and clean.get("kind") == "investment":
            code = payload.get("inv_type") if payload.get("inv_type") in INV_TYPES else "other"
            conn.execute("INSERT OR IGNORE INTO investment_details (account_id, inv_type, type_id) "
                         "VALUES (?, ?, (SELECT id FROM investment_types WHERE builtin = ?))", (cur.lastrowid, code, code))
        conn.commit()
    except sqlite3.IntegrityError:
        raise ApiError(f"'{clean['name']}' already exists", field="name")
    return get(table, cur.lastrowid)


def get(table, item_id):
    _check_table(table)
    r = one(f"SELECT * FROM {table} WHERE id = ?", (item_id,))
    if not r:
        raise ApiError("Not found", status=404)
    r["active"] = bool(r["active"])
    r["used"] = _usage(table, item_id)
    return _account_out(r) if table == "accounts" else r


def update(table, item_id, payload):
    _check_table(table)
    existing = one(f"SELECT * FROM {table} WHERE id = ?", (item_id,))
    if not existing:
        raise ApiError("Not found", status=404)
    if table == "categories" and existing["is_system"]:
        raise ApiError("This category is managed by the app and can't be changed")
    clean = _clean(table, payload, existing)
    if "kind" in clean and clean["kind"] != existing["kind"] and _usage(table, item_id):
        raise ApiError("Type can't be changed once transactions use it. Add a new one instead.", field="kind")
    if not clean:
        return get(table, item_id)
    conn = get_db()
    try:
        conn.execute(
            f"UPDATE {table} SET {', '.join(c + ' = :' + c for c in clean)} WHERE id = :id",
            {**clean, "id": item_id},
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise ApiError(f"'{clean.get('name')}' already exists", field="name")
    return get(table, item_id)


def delete(table, item_id):
    _check_table(table)
    existing = one(f"SELECT * FROM {table} WHERE id = ?", (item_id,))
    if not existing:
        raise ApiError("Not found", status=404)
    if table == "categories" and existing["is_system"]:
        raise ApiError("This category is managed by the app and can't be deleted")
    n = _usage(table, item_id)
    if n:
        raise ApiError(f"Used by {n} transaction{'' if n == 1 else 's'}. Deactivate it instead, so past transactions stay intact.")
    conn = get_db()
    conn.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
    conn.commit()


def set_opening_balances(items):
    """Save the starting position of several accounts at once.

    items: [{"id": 3, "opening_balance": "400", "opening_date": "2026-10-07"}, ...]
    Credit card amounts are the outstanding (owed) amount; investment amounts are principal invested.
    """
    if not isinstance(items, list) or not items:
        raise ApiError("Nothing to save")
    conn = get_db()
    for it in items:
        acc = one("SELECT * FROM accounts WHERE id = ?", (it.get("id"),))
        if not acc:
            raise ApiError("Account not found")
        clean = _clean("accounts", {"opening_balance": it.get("opening_balance"),
                                    "opening_date": it.get("opening_date")}, acc)
        if not clean.get("opening_date"):
            raise ApiError(f"Choose the 'as on' date for {acc['name']}", field="opening_date")
        conn.execute("UPDATE accounts SET opening_balance = ?, opening_date = ? WHERE id = ?",
                     (clean["opening_balance"], clean["opening_date"], acc["id"]))
    conn.commit()
    return list_items("accounts")
