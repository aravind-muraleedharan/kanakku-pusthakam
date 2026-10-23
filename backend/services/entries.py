"""Entry rules, validation and queries.

Entry types (see docs/DESIGN.md):
  expense   my account -> outside        counts as expense
  income    outside -> my account        counts as income
  transfer  my account -> my account     counts as neither (e.g. credit card bill payment)
  invest    my account -> investment     shown as "invested", not expense
  redeem    investment -> my account     only the gain/loss (amount - principal) counts as income
"""
import re
from datetime import date as _date

from ..db import get_db, one, rows
from ..errors import ApiError
from ..money import to_paise, to_rupees

TYPES = ("expense", "income", "transfer", "invest", "redeem")
CASH_LIKE = ("bank", "credit_card", "cash")

# For each type: which account kinds are allowed on each side (None = side must be empty)
RULES = {
    "expense":  {"from": CASH_LIKE + ("loan",),  "to": None,             "category": "expense"},   # loan: charges at disbursal
    "income":   {"from": None,                  "to": CASH_LIKE,        "category": "income"},
    "transfer": {"from": CASH_LIKE + ("investment", "loan"), "to": CASH_LIKE + ("loan",), "category": None},
    # transfer from investment: share accounts only; from a loan (disbursal): to bank/cash; to a loan: repayment
    "invest":   {"from": CASH_LIKE,             "to": ("investment",),  "category": None},
    "redeem":   {"from": ("investment",),       "to": ("bank", "cash"), "category": "system"},
}

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NOTE_MAX = 500


def _int_or_none(value, field):
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(f"Invalid {field}", field=field)


def _account(account_id, field):
    acc = one("SELECT * FROM accounts WHERE id = ?", (account_id,))
    if not acc:
        raise ApiError("Account not found", field=field)
    return acc


def investment_returns_category_id():
    row = one("SELECT id FROM categories WHERE is_system = 1 AND name = 'Investment Returns'")
    return row["id"] if row else None


def inv_type(account_id):
    r = one("SELECT inv_type FROM investment_details WHERE account_id = ?", (account_id,))
    return r["inv_type"] if r else "other"


def open_principal(account_id, exclude_entry_id=None):
    """Principal still invested in an investment account (paise). Share withdrawals (transfers out) reduce it."""
    acc = one("SELECT opening_balance, opening_date FROM accounts WHERE id = ?", (account_id,))
    r = one(
        """SELECT
             COALESCE(SUM(CASE WHEN type = 'invest' AND to_account_id = :a THEN amount END), 0) AS put_in,
             COALESCE(SUM(CASE WHEN type = 'redeem' AND from_account_id = :a THEN principal_amount
                               WHEN type = 'transfer' AND from_account_id = :a THEN amount END), 0) AS taken_out
           FROM entries WHERE id != :x AND (:od IS NULL OR date >= :od)""",
        {"a": account_id, "x": exclude_entry_id or -1, "od": acc["opening_date"] if acc else None},
    )
    return (acc["opening_balance"] if acc else 0) + r["put_in"] - r["taken_out"]


def validate(payload, entry_id=None):
    """Check a submitted entry against the rules and return a clean dict ready to save."""
    t = (payload.get("type") or "").strip().lower()
    if t not in TYPES:
        raise ApiError("Choose a transaction type", field="type")
    rule = RULES[t]

    d = (payload.get("date") or "").strip()
    if not DATE_RE.match(d):
        raise ApiError("Date must be YYYY-MM-DD", field="date")
    try:
        _date.fromisoformat(d)
    except ValueError:
        raise ApiError("Not a real date", field="date")

    try:
        amount = to_paise(payload.get("amount"))
    except ValueError as e:
        raise ApiError(str(e), field="amount")
    if not amount or amount <= 0:
        raise ApiError("Amount must be more than zero", field="amount")

    clean = {
        "date": d, "type": t, "amount": amount,
        "category_id": None, "from_account_id": None, "to_account_id": None,
        "payment_mode_id": _int_or_none(payload.get("payment_mode_id"), "payment_mode_id"),
        "payment_mode_other": None,
        "principal_amount": None,
        "note": (payload.get("note") or "").strip()[:NOTE_MAX] or None,
    }

    # accounts
    for side in ("from", "to"):
        field = f"{side}_account_id"
        acc_id = _int_or_none(payload.get(field), field)
        allowed = rule[side]
        if allowed is None:
            continue                      # ignore anything sent for a side this type doesn't use
        if acc_id is None:
            label = "Paid from" if side == "from" else "Received in"
            raise ApiError(f"Choose the '{label}' account", field=field)
        acc = _account(acc_id, field)
        if acc["kind"] not in allowed:
            kinds = ", ".join(k.replace("_", " ") for k in allowed)
            raise ApiError(f"For {t}, this account must be: {kinds}", field=field)
        clean[field] = acc_id
    from_acc = _account(clean["from_account_id"], "from_account_id") if clean["from_account_id"] else None
    if t == "transfer" and from_acc["kind"] == "investment":
        if inv_type(from_acc["id"]) != "share":
            raise ApiError("Only stocks accounts can transfer out. Use Maturity for other investments.",
                           field="from_account_id")
        if _account(clean["to_account_id"], "to_account_id")["kind"] not in ("bank", "cash"):
            raise ApiError("Share withdrawals go to a bank or cash account", field="to_account_id")
    if t == "transfer" and from_acc["kind"] == "loan" and _account(clean["to_account_id"], "to_account_id")["kind"] not in ("bank", "cash"):
        raise ApiError("A loan can only be credited to a bank or cash account", field="to_account_id")
    if t == "redeem" and inv_type(from_acc["id"]) == "share":
        raise ApiError("Stocks accounts don't use Maturity: use a Transfer (withdrawal), so it isn't counted as income",
                       field="from_account_id")
    if clean["from_account_id"] and clean["from_account_id"] == clean["to_account_id"]:
        raise ApiError("From and To accounts must be different", field="to_account_id")

    # category
    if rule["category"] in ("expense", "income"):
        cat_id = _int_or_none(payload.get("category_id"), "category_id")
        if cat_id is None:
            raise ApiError("Choose a category", field="category_id")
        cat = one("SELECT * FROM categories WHERE id = ?", (cat_id,))
        if not cat or cat["kind"] != rule["category"] or cat["is_system"]:
            raise ApiError(f"Choose a valid {rule['category']} category", field="category_id")
        clean["category_id"] = cat_id
    elif rule["category"] == "system":
        clean["category_id"] = investment_returns_category_id()

    # redeem: principal closed
    if t == "redeem":
        try:
            principal = to_paise(payload.get("principal_amount"))
        except ValueError as e:
            raise ApiError(str(e), field="principal_amount")
        if principal is None or principal < 0:
            raise ApiError("Enter the principal being closed (0 if none)", field="principal_amount")
        available = open_principal(clean["from_account_id"], exclude_entry_id=entry_id)
        if principal > available:
            raise ApiError(
                f"Principal is more than what is invested in this account (₹{to_rupees(available):,.2f})",
                field="principal_amount",
            )
        clean["principal_amount"] = principal

    # optional references
    if clean["payment_mode_id"]:
        pm = one("SELECT name FROM payment_modes WHERE id = ?", (clean["payment_mode_id"],))
        if not pm:
            raise ApiError("Payment mode not found", field="payment_mode_id")
        if pm["name"].strip().lower() == "other":         # Other: say what it was
            other = (payload.get("payment_mode_other") or "").strip()[:60]
            if not other:
                raise ApiError("Enter the payment mode", field="payment_mode_other")
            clean["payment_mode_other"] = other
    return clean


COLUMNS = ("date", "type", "amount", "category_id", "from_account_id", "to_account_id",
           "payment_mode_id", "payment_mode_other", "principal_amount", "note")


def create(payload):
    clean = validate(payload)
    conn = get_db()
    cur = conn.execute(
        f"INSERT INTO entries ({', '.join(COLUMNS)}) VALUES ({', '.join('?' for _ in COLUMNS)})",
        [clean[c] for c in COLUMNS],
    )
    conn.commit()
    return get(cur.lastrowid)


def update(entry_id, payload):
    if not one("SELECT id FROM entries WHERE id = ?", (entry_id,)):
        raise ApiError("Transaction not found", status=404)
    clean = validate(payload, entry_id=entry_id)
    conn = get_db()
    conn.execute(
        f"UPDATE entries SET {', '.join(c + ' = ?' for c in COLUMNS)}, "
        "updated_at = datetime('now','localtime') WHERE id = ?",
        [clean[c] for c in COLUMNS] + [entry_id],
    )
    conn.commit()
    return get(entry_id)


def delete(entry_id):
    entry = one("SELECT * FROM entries WHERE id = ?", (entry_id,))
    if not entry:
        raise ApiError("Transaction not found", status=404)
    if entry["type"] == "invest" and inv_type(entry["to_account_id"]) != "share":
        # deleting an invest must not leave redeemed principal larger than what was put in
        if open_principal(entry["to_account_id"], exclude_entry_id=entry_id) < 0:
            raise ApiError("Money has already come back from this investment. Edit or delete that Maturity transaction first.")
    conn = get_db()
    conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    conn.commit()


SELECT = """
SELECT e.id, e.date, e.type, e.amount, e.principal_amount, e.note,
       e.category_id, c.name AS category,
       e.from_account_id, fa.name AS from_account, fa.kind AS from_kind,
       e.to_account_id, ta.name AS to_account, ta.kind AS to_kind,
       e.payment_mode_id, COALESCE(e.payment_mode_other, pm.name) AS payment_mode, e.payment_mode_other,
       e.created_at, e.updated_at
FROM entries e
LEFT JOIN categories c     ON c.id = e.category_id
LEFT JOIN accounts fa      ON fa.id = e.from_account_id
LEFT JOIN accounts ta      ON ta.id = e.to_account_id
LEFT JOIN payment_modes pm ON pm.id = e.payment_mode_id
"""


def _out(r):
    r = dict(r)
    if r["type"] == "redeem" and r["principal_amount"] is not None:
        r["gain"] = to_rupees(r["amount"] - r["principal_amount"])
    r["amount"] = to_rupees(r["amount"])
    r["principal_amount"] = to_rupees(r["principal_amount"])
    return r


def get(entry_id):
    r = one(SELECT + " WHERE e.id = ?", (entry_id,))
    if not r:
        raise ApiError("Transaction not found", status=404)
    return _out(r)


def build_filters(args):
    """Turn query-string filters into a WHERE clause. Shared by the list and CSV export."""
    where, params = [], {}
    month = args.get("month")
    if month:
        if not re.match(r"^\d{4}-\d{2}$", month):
            raise ApiError("Month must be YYYY-MM", field="month")
        where.append("substr(e.date, 1, 7) = :month")
        params["month"] = month
    if args.get("from"):
        where.append("e.date >= :dfrom")
        params["dfrom"] = args["from"]
    if args.get("to"):
        where.append("e.date <= :dto")
        params["dto"] = args["to"]
    if args.get("type"):
        where.append("e.type = :type")
        params["type"] = args["type"]
    for key, col in (("category_id", "e.category_id"), ("payment_mode_id", "e.payment_mode_id")):
        if args.get(key):
            where.append(f"{col} = :{key}")
            params[key] = _int_or_none(args[key], key)
    if args.get("account_id"):
        where.append("(e.from_account_id = :acc OR e.to_account_id = :acc)")
        params["acc"] = _int_or_none(args["account_id"], "account_id")
    if args.get("q"):
        where.append("(e.note LIKE :q OR c.name LIKE :q)")
        params["q"] = f"%{args['q'].strip()}%"
    return (" WHERE " + " AND ".join(where)) if where else "", params


def list_entries(args):
    where, params = build_filters(args)
    limit = min(max(_int_or_none(args.get("limit"), "limit") or 200, 1), 5000)
    offset = max(_int_or_none(args.get("offset"), "offset") or 0, 0)
    base_from = SELECT.split("FROM entries e", 1)[1]
    totals = one(
        f"""SELECT COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN e.type = 'expense' THEN e.amount END), 0) AS expense,
                COALESCE(SUM(CASE WHEN e.type = 'income' THEN e.amount
                                  WHEN e.type = 'redeem' THEN e.amount - e.principal_amount END), 0) AS income,
                COALESCE(SUM(CASE WHEN e.type = 'invest' THEN e.amount END), 0) AS invested,
                COALESCE(SUM(CASE WHEN e.type = 'transfer' THEN e.amount END), 0) AS transferred
            FROM entries e {base_from} {where}""",
        params,
    )
    items = rows(SELECT + where + " ORDER BY e.date DESC, e.id DESC LIMIT :limit OFFSET :offset",
                 {**params, "limit": limit, "offset": offset})
    return {
        "items": [_out(r) for r in items],
        "count": totals["count"],
        "totals": {k: to_rupees(totals[k]) for k in ("expense", "income", "invested", "transferred")},
        "limit": limit,
        "offset": offset,
    }
