"""Consolidated figures: summaries, monthly totals, category totals, balances."""
from datetime import date

from ..db import one, rows
from ..money import to_rupees

# Income includes the gain (or loss) part of Redeem entries; principal coming back is not income.
INCOME_SQL = ("CASE WHEN e.type = 'income' THEN e.amount "
              "WHEN e.type = 'redeem' THEN e.amount - COALESCE(e.principal_amount, 0) ELSE 0 END")
EXPENSE_SQL = "CASE WHEN e.type = 'expense' THEN e.amount ELSE 0 END"
INVEST_SQL = "CASE WHEN e.type = 'invest' THEN e.amount ELSE 0 END"
REDEEM_PRINCIPAL_SQL = "CASE WHEN e.type = 'redeem' THEN COALESCE(e.principal_amount, 0) ELSE 0 END"


def _range_where(dfrom, dto, extra=None, params=None):
    where, p = [], dict(params or {})
    if dfrom:
        where.append("e.date >= :dfrom")
        p["dfrom"] = dfrom
    if dto:
        where.append("e.date <= :dto")
        p["dto"] = dto
    if extra:
        where.extend(extra)
    return (" WHERE " + " AND ".join(where)) if where else "", p


def month_bounds(month):
    """'2026-10' -> ('2026-10-01', '2026-10-31')"""
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    end = date(y + (m == 12), (m % 12) + 1, 1)
    return start.isoformat(), date.fromordinal(end.toordinal() - 1).isoformat()


def shift_month(month, delta):
    y, m = int(month[:4]), int(month[5:7]) + delta
    while m < 1:
        y, m = y - 1, m + 12
    while m > 12:
        y, m = y + 1, m - 12
    return f"{y:04d}-{m:02d}"


def summary(dfrom=None, dto=None):
    where, p = _range_where(dfrom, dto)
    r = one(
        f"""SELECT COALESCE(SUM({INCOME_SQL}), 0) AS income,
                   COALESCE(SUM({EXPENSE_SQL}), 0) AS expense,
                   COALESCE(SUM({INVEST_SQL}), 0) AS invested,
                   COALESCE(SUM({REDEEM_PRINCIPAL_SQL}), 0) AS redeemed_principal,
                   COUNT(*) AS entries
            FROM entries e {where}""",
        p,
    )
    out = {k: to_rupees(r[k]) for k in ("income", "expense", "invested", "redeemed_principal")}
    out["net"] = to_rupees(r["income"] - r["expense"])
    out["savings_rate"] = round((r["income"] - r["expense"]) * 100 / r["income"], 1) if r["income"] > 0 else None
    out["entries"] = r["entries"]
    return out


def monthly(dfrom=None, dto=None):
    """One row per month in the range (months with no entries included as zeros)."""
    where, p = _range_where(dfrom, dto)
    data = {
        r["month"]: r for r in rows(
            f"""SELECT substr(e.date, 1, 7) AS month,
                       SUM({INCOME_SQL}) AS income, SUM({EXPENSE_SQL}) AS expense,
                       SUM({INVEST_SQL}) AS invested, SUM({REDEEM_PRINCIPAL_SQL}) AS redeemed_principal,
                       COUNT(*) AS entries
                FROM entries e {where} GROUP BY month ORDER BY month""",
            p,
        )
    }
    if not data and not (dfrom and dto):
        return []
    first = (dfrom or min(data))[:7]
    last = (dto or max(data))[:7]
    out, running, m = [], 0, first
    while m <= last:
        r = data.get(m, {"income": 0, "expense": 0, "invested": 0, "redeemed_principal": 0, "entries": 0})
        net = r["income"] - r["expense"]
        running += net
        out.append({
            "month": m,
            "income": to_rupees(r["income"]), "expense": to_rupees(r["expense"]),
            "net": to_rupees(net), "invested": to_rupees(r["invested"]),
            "redeemed_principal": to_rupees(r["redeemed_principal"]),
            "cumulative_net": to_rupees(running), "entries": r["entries"],
        })
        m = shift_month(m, 1)
    return out


def category_totals(kind="expense", dfrom=None, dto=None):
    if kind == "income":
        types, value = "('income', 'redeem')", INCOME_SQL
    else:
        kind, types, value = "expense", "('expense')", EXPENSE_SQL
    extra = [f"e.type IN {types}"]
    where, p = _range_where(dfrom, dto, extra)
    data = rows(
        f"""SELECT c.id, c.name, SUM({value}) AS amount, COUNT(*) AS count
            FROM entries e JOIN categories c ON c.id = e.category_id
            {where} GROUP BY c.id ORDER BY amount DESC""",
        p,
    )
    total = sum(r["amount"] for r in data)
    return {
        "kind": kind,
        "total": to_rupees(total),
        "items": [{
            "id": r["id"], "name": r["name"], "amount": to_rupees(r["amount"]), "count": r["count"],
            "share": round(r["amount"] * 100 / total, 1) if total > 0 else 0,
        } for r in data],
    }


def month_category_grid(dfrom=None, dto=None, kind="expense"):
    """Months as rows, categories as columns."""
    value = INCOME_SQL if kind == "income" else EXPENSE_SQL
    types = "('income', 'redeem')" if kind == "income" else "('expense')"
    where, p = _range_where(dfrom, dto, [f"e.type IN {types}"])
    data = rows(
        f"""SELECT substr(e.date, 1, 7) AS month, c.id AS cid, c.name AS category, SUM({value}) AS amount
            FROM entries e JOIN categories c ON c.id = e.category_id
            {where} GROUP BY month, c.id""",
        p,
    )
    cat_totals, months, cells = {}, set(), {}
    names = {}
    for r in data:
        months.add(r["month"])
        names[r["cid"]] = r["category"]
        cat_totals[r["cid"]] = cat_totals.get(r["cid"], 0) + r["amount"]
        cells.setdefault(r["month"], {})[r["cid"]] = r["amount"]
    cats = sorted(cat_totals, key=lambda c: -cat_totals[c])
    month_list = sorted(months, reverse=True)
    return {
        "categories": [{"id": c, "name": names[c], "total": to_rupees(cat_totals[c])} for c in cats],
        "rows": [{
            "month": m,
            "values": [to_rupees(cells[m].get(c, 0)) for c in cats],
            "total": to_rupees(sum(cells[m].values())),
        } for m in month_list],
        "grand_total": to_rupees(sum(cat_totals.values())),
    }


def group_totals(column, table, dfrom=None, dto=None):
    """Expense totals grouped by payment mode."""
    where, p = _range_where(dfrom, dto, ["e.type = 'expense'"])
    data = rows(
        f"""SELECT COALESCE(t.name, 'Not set') AS name, SUM(e.amount) AS amount, COUNT(*) AS count
            FROM entries e LEFT JOIN {table} t ON t.id = e.{column}
            {where} GROUP BY t.id ORDER BY amount DESC""",
        p,
    )
    total = sum(r["amount"] for r in data)
    return [{"name": r["name"], "amount": to_rupees(r["amount"]), "count": r["count"],
             "share": round(r["amount"] * 100 / total, 1) if total else 0} for r in data]


def balances(as_of=None):
    """Current balance of every account.

    bank / cash   : opening + money in - money out
    credit_card   : outstanding = card spends + other debits - bill payments (shown as a positive amount owed)
    investment    : open principal = opening + invested - principal redeemed; plus total gain realised
    """
    # only entries on/after the account's opening date move its balance (earlier ones are inside the opening figure)
    cond = "AND (a.opening_date IS NULL OR e.date >= a.opening_date)" + (" AND e.date <= :asof" if as_of else "")
    data = rows(
        f"""SELECT a.id, a.name, a.kind, a.active, a.opening_balance, a.opening_date,
              COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.to_account_id = a.id {cond}), 0) AS money_in,
              COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.from_account_id = a.id {cond}), 0) AS money_out,
              COALESCE((SELECT SUM(e.amount) FROM entries e
                        WHERE e.type = 'invest' AND e.to_account_id = a.id {cond}), 0) AS invested,
              COALESCE((SELECT SUM(CASE WHEN e.type = 'redeem' THEN e.principal_amount ELSE e.amount END) FROM entries e
                        WHERE e.type IN ('redeem', 'transfer') AND e.from_account_id = a.id {cond}), 0) AS principal_out,
              COALESCE((SELECT SUM(e.amount - e.principal_amount) FROM entries e
                        WHERE e.type = 'redeem' AND e.from_account_id = a.id {cond}), 0) AS gain
            FROM accounts a ORDER BY a.sort_order, a.name""",
        {"asof": as_of} if as_of else {},
    )
    out = []
    for r in data:
        item = {"id": r["id"], "name": r["name"], "kind": r["kind"], "active": bool(r["active"]),
                "opening_date": r["opening_date"]}
        if r["kind"] == "investment":
            item["open_principal"] = to_rupees(r["opening_balance"] + r["invested"] - r["principal_out"])
            item["total_invested"] = to_rupees(r["opening_balance"] + r["invested"])
            item["realised_gain"] = to_rupees(r["gain"])
            item["balance"] = item["open_principal"]
        else:
            bal = r["opening_balance"] + r["money_in"] - r["money_out"]
            item["balance"] = to_rupees(bal)
            if r["kind"] in ("credit_card", "loan"):
                item["outstanding"] = to_rupees(-bal)
        out.append(item)
    return out


def dashboard(month):
    start, end = month_bounds(month)
    prev = shift_month(month, -1)
    pstart, pend = month_bounds(prev)
    year_start, _ = month_bounds(shift_month(month, -11))
    bal = balances()
    cash_like = [b for b in bal if b["kind"] in ("bank", "cash")]
    cards = [b for b in bal if b["kind"] == "credit_card"]
    invest = [b for b in bal if b["kind"] == "investment"]
    from . import investments as inv_svc      # late import: investments imports entries
    try:
        ov = inv_svc.overview()
        inv_value = ov["totals"]["value"]
        values = {i["id"]: i for i in ov["items"]}
        for b in invest:
            if b["id"] in values:
                b["value"] = values[b["id"]]["value"]
                b["inv_type"] = values[b["id"]]["works_like"]
    except Exception:                          # never let a valuation problem break the dashboard
        inv_value = round(sum(b["open_principal"] for b in invest), 2)
    from . import loans as loan_svc
    try:
        loans_ov = loan_svc.overview()
        loans_out = loans_ov["totals"]["outstanding"]
        loan_items = [{"id": i["id"], "name": i["name"], "loan_type": i["loan_type"],
                       "outstanding": i["summary"]["outstanding"], "next": i["summary"]["next"]}
                      for i in loans_ov["items"] if i["status"] == "active"]
    except Exception:
        loans_out = round(sum(b["outstanding"] for b in bal if b["kind"] == "loan"), 2)
        loan_items = []
    bank_cash = round(sum(b["balance"] for b in cash_like), 2)
    owed = round(sum(b["outstanding"] for b in cards), 2)
    return {
        "month": month,
        "setup_needed": all(b["opening_date"] is None for b in bal),
        "summary": summary(start, end),
        "previous": summary(pstart, pend),
        "top_categories": category_totals("expense", start, end)["items"][:6],
        "last_12_months": monthly(year_start, end),
        "balances": bal,
        "loans": loan_items,
        "totals": {
            "bank_and_cash": bank_cash,
            "card_outstanding": owed,
            "invested_principal": round(sum(b["open_principal"] for b in invest), 2),
            "investments_value": inv_value,
            "loans_outstanding": loans_out,
            "net_worth": round(bank_cash + inv_value - owed - loans_out, 2),
        },
    }
