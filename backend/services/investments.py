"""Investments: share trading accounts (journal), FD, RD, PPF, physical gold/silver, chitty, and your own types.

Every investment is an account of kind 'investment' plus a row in investment_details. Its type (type_id) is a
built-in type or one you added; investment_details.inv_type holds the calculation that type works like.
Money moving in and out uses normal entries:
  * invest   bank -> investment                (funds added, FD/RD/PPF deposits, buying gold)
  * redeem   investment -> bank                (FD/RD/PPF maturity, selling gold; gain counts as income)
  * transfer share account -> bank             (share withdrawals: never income)
Share profits, charges and dividends live only inside the share account (never income).
"""
import calendar
import json
from datetime import date, timedelta

from ..db import get_db, one, rows
from ..errors import ApiError
from ..money import to_paise, to_rupees
from . import entries as entries_svc
from . import investment_types as types_svc

HELD_AT = ("fd", "rd", "ppf")             # held at one of your bank accounts
OWN_VALUE = ("other", "chitty")           # you can type in the current value
PAYOUTS = {"monthly": 1, "quarterly": 3, "yearly": 12, "maturity": None}


# ---------------------------------------------------------------- small helpers

def _d(s):
    return date.fromisoformat(s) if s else None


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def months_between(a, b):
    """Whole months from a to b (b >= a)."""
    n = (b.year - a.year) * 12 + (b.month - a.month)
    return n - 1 if b.day < a.day else n


def _rate(v, field="rate"):
    if v in (None, ""):
        return None
    try:
        r = float(v)
    except (TypeError, ValueError):
        raise ApiError("Rate must be a number like 7.25", field=field)
    if not 0 <= r <= 50:
        raise ApiError("Rate looks wrong (0–50%)", field=field)
    return r


def _date_or_none(v, field):
    if not v:
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise ApiError("Date must be YYYY-MM-DD", field=field)


def _paise(v, field, required=False, allow_negative=False):
    try:
        p = to_paise(v)
    except ValueError as e:
        raise ApiError(str(e), field=field)
    if p is None:
        if required:
            raise ApiError("Enter an amount", field=field)
        return None
    if p < 0 and not allow_negative:
        raise ApiError("Amount can't be negative", field=field)
    return p


def _account(account_id):
    acc = one("""SELECT a.*, COALESCE(d.inv_type, 'other') AS inv_type
                 FROM accounts a LEFT JOIN investment_details d ON d.account_id = a.id
                 WHERE a.id = ? AND a.kind = 'investment'""", (account_id,))
    if not acc:
        raise ApiError("Investment not found", status=404)
    return acc


def details(account_id):
    d = one("SELECT * FROM investment_details WHERE account_id = ?", (account_id,))
    if not d:
        get_db().execute("INSERT INTO investment_details (account_id, inv_type, type_id) VALUES (?, 'other', ?)",
                         (account_id, types_svc.builtin_id("other")))
        get_db().commit()
        d = one("SELECT * FROM investment_details WHERE account_id = ?", (account_id,))
    return d


def _flows(account_id, opening_date):
    """Entries that moved money in/out of this investment (on/after its opening date)."""
    return rows(
        """SELECT e.id, e.date, e.type, e.amount, e.principal_amount, e.note,
                  e.from_account_id, e.to_account_id, fa.name AS from_account, ta.name AS to_account
           FROM entries e
           LEFT JOIN accounts fa ON fa.id = e.from_account_id
           LEFT JOIN accounts ta ON ta.id = e.to_account_id
           WHERE (e.to_account_id = :a OR e.from_account_id = :a)
             AND (:od IS NULL OR e.date >= :od)
           ORDER BY e.date, e.id""",
        {"a": account_id, "od": opening_date},
    )


def _money_in_out(acc, flows):
    added = acc["opening_balance"] + sum(f["amount"] for f in flows if f["type"] == "invest" and f["to_account_id"] == acc["id"])
    principal_out = sum((f["principal_amount"] or 0) for f in flows if f["type"] == "redeem" and f["from_account_id"] == acc["id"])
    withdrawn = sum(f["amount"] for f in flows if f["type"] == "transfer" and f["from_account_id"] == acc["id"])
    received = sum(f["amount"] for f in flows if f["type"] == "redeem" and f["from_account_id"] == acc["id"])
    return added, principal_out, withdrawn, received


# ---------------------------------------------------------------- valuation per type

def fd_value_at(principal, rate, start, when):
    """Cumulative FD: quarterly compounding, simple interest for the part-quarter (as Indian banks do)."""
    if when <= start or not rate:
        return principal
    months = months_between(start, when)
    quarters = months // 3
    after_q = add_months(start, quarters * 3)
    days = (when - after_q).days
    v = principal * (1 + rate / 400) ** quarters
    return v * (1 + rate / 100 * days / 365)


def fd_payout_schedule(d):
    step = PAYOUTS.get(d["payout"] or "maturity")
    start, maturity = _d(d["start_date"]), _d(d["maturity_date"])
    if not step or not start or not maturity or not d["amount"] or not d["rate"]:
        return []
    per = round(d["amount"] * d["rate"] / 100 * step / 12)
    out, k = [], 1
    while True:
        due = add_months(start, step * k)
        if due >= maturity:
            break
        out.append({"date": due.isoformat(), "amount": to_rupees(per)})
        k += 1
    return out


def rd_maturity(instalment, rate, months):
    if not rate:
        return instalment * months
    return sum(instalment * (1 + rate / 400) ** ((months - k) / 3) for k in range(months))


def _summary_share(acc, d, flows):
    added, _, withdrawn, _ = _money_in_out(acc, flows)
    agg = one("""SELECT COALESCE(SUM(CASE WHEN action = 'cnc_sell' THEN profit END), 0) AS cnc,
                        COALESCE(SUM(CASE WHEN action = 'mtf_sell' THEN profit END), 0) AS mtf,
                        COALESCE(SUM(CASE WHEN action = 'intraday' THEN profit END), 0) AS intraday,
                        COALESCE(SUM(CASE WHEN action = 'other' THEN profit END), 0) AS other,
                        COALESCE(SUM(charges), 0) AS charges, COUNT(*) AS n
                 FROM share_actions WHERE account_id = ?""", (acc["id"],))
    # dividends are paid into the bank, not the trading account: shown for reference, never part of the
    # account's value or profit (moving that money into the account is an ordinary "Add funds")
    div = one("SELECT COALESCE(SUM(amount), 0) AS s FROM share_dividends WHERE account_id = ?", (acc["id"],))["s"]
    total_profit = agg["cnc"] + agg["mtf"] + agg["intraday"] + agg["other"] - agg["charges"]
    net_invested = added - withdrawn
    value = net_invested + total_profit
    s = {
        "funds_added": to_rupees(added), "withdrawn": to_rupees(withdrawn), "net_invested": to_rupees(net_invested),
        "cnc_profit": to_rupees(agg["cnc"]), "mtf_profit": to_rupees(agg["mtf"]),
        "intraday_profit": to_rupees(agg["intraday"]), "other_profit": to_rupees(agg["other"]),
        "charges": to_rupees(agg["charges"]), "dividends": to_rupees(div),
        "total_profit": to_rupees(total_profit), "gain_pct": round(total_profit * 100 / added, 2) if added else None,
        "actions": agg["n"], "invested": to_rupees(net_invested), "value": to_rupees(value), "gain": to_rupees(total_profit),
    }
    if d["goal_pct"] or d["goal_profit"]:
        target = round(added * d["goal_pct"] / 100) if d["goal_pct"] else d["goal_profit"]
        s["goal"] = {
            "pct": d["goal_pct"], "target_profit": to_rupees(target),
            "forecast_profit": to_rupees(d["goal_profit"]) if d["goal_profit"] else None,
            "date": d["goal_date"],
            "progress_pct": round(total_profit * 100 / target, 1) if target else None,
        }
    return s


def _summary_fd(acc, d, flows, today):
    added, principal_out, _, received = _money_in_out(acc, flows)
    principal = d["amount"] or added
    start, maturity = _d(d["start_date"]), _d(d["maturity_date"])
    closed = added > 0 and added - principal_out <= 0
    cumulative = (d["payout"] or "maturity") == "maturity"
    s = {"principal": to_rupees(principal), "invested": to_rupees(0 if closed else added - principal_out),
         "closed": closed, "payout": d["payout"] or "maturity"}
    if start and d["rate"]:
        if cumulative:
            end = min(today, maturity) if maturity else today
            value = principal if closed else fd_value_at(principal, d["rate"], start, end)
            mat = fd_value_at(principal, d["rate"], start, maturity) if maturity else None
        else:
            value = principal
            last = round(principal * d["rate"] / 100 * PAYOUTS[d["payout"]] / 12)
            mat = principal + last
        s["maturity_amount"] = to_rupees(round(mat)) if mat else None
        s["value"] = 0 if closed else to_rupees(round(value))
    else:
        s["value"] = 0 if closed else to_rupees(principal)
    paid = rows("""SELECT e.id, e.date, e.amount, ta.name AS to_account FROM entries e
                   LEFT JOIN accounts ta ON ta.id = e.to_account_id
                   WHERE e.related_account_id = ? AND e.type = 'income' ORDER BY e.date""", (acc["id"],))
    schedule = fd_payout_schedule(d)
    for i, row in enumerate(schedule):
        row["recorded"] = i < len(paid)
        row["due"] = not row["recorded"] and row["date"] <= today.isoformat()
    s["payouts"] = schedule
    s["payouts_recorded"] = [{**p, "amount": to_rupees(p["amount"])} for p in paid]
    s["interest_received"] = to_rupees(sum(p["amount"] for p in paid) + max(0, received - principal_out))
    s["gain"] = round((s["value"] or 0) - (s["invested"] or 0) + s["interest_received"], 2) if not closed else s["interest_received"]
    return s


def _summary_rd(acc, d, flows, today):
    added, principal_out, _, received = _money_in_out(acc, flows)
    inst = d["amount"]
    start = _d(d["start_date"])
    closed = added > 0 and added - principal_out <= 0
    deposits = [f for f in flows if f["type"] == "invest" and f["to_account_id"] == acc["id"]]
    s = {"instalment": to_rupees(inst), "invested": to_rupees(0 if closed else added - principal_out), "closed": closed}
    if inst and start:
        months = d["term_months"] or 0
        expected = min(months, months_between(start, today) + 1) if today >= start else 0
        paid_count = len(deposits) + (round(acc["opening_balance"] / inst) if inst else 0)
        s.update(expected_instalments=expected, paid_instalments=paid_count,
                 missed_instalments=max(0, expected - paid_count), term_months=months)
        due_day = d["due_day"] or start.day
        s["due_day"] = due_day
        if not closed and paid_count < months:          # the next instalment not yet paid
            m = add_months(date(start.year, start.month, 1), paid_count)
            s["next_due"] = date(m.year, m.month, min(due_day, calendar.monthrange(m.year, m.month)[1])).isoformat()
        if d["rate"] and months:
            s["maturity_amount"] = to_rupees(round(rd_maturity(inst, d["rate"], months)))
    value = 0
    if not closed:
        r = d["rate"] or 0
        if acc["opening_balance"] and start:
            value += acc["opening_balance"] * (1 + r / 400) ** (max(0, months_between(start, today)) / 3)
        for f in deposits:
            value += f["amount"] * (1 + r / 400) ** (max(0, months_between(_d(f["date"]), today)) / 3)
    s["value"] = to_rupees(round(value))
    s["gain"] = round(s["value"] - s["invested"], 2) if not closed else to_rupees(received - principal_out)
    s["deposits"] = [{"id": f["id"], "date": f["date"], "amount": to_rupees(f["amount"]), "from_account": f["from_account"]}
                     for f in reversed(deposits)]
    return s


def _fy_start(d):
    return d.year if d.month >= 4 else d.year - 1


def _summary_ppf(acc, d, flows, today):
    rate = d["rate"] or 0
    start = _d(acc["opening_date"]) if acc["opening_balance"] and acc["opening_date"] else _d(d["start_date"])
    deposits = [f for f in flows if f["type"] == "invest" and f["to_account_id"] == acc["id"]]
    withdrawals = [f for f in flows if f["type"] == "redeem" and f["from_account_id"] == acc["id"]]
    bal, accrued, credited = acc["opening_balance"], 0.0, 0
    if start:
        m = date(start.year, start.month, 1)
        current = date(today.year, today.month, 1)
        while m < current:                                   # completed months only
            early = sum(f["amount"] for f in deposits if f["date"][:7] == m.isoformat()[:7] and int(f["date"][8:]) <= 5)
            late = sum(f["amount"] for f in deposits if f["date"][:7] == m.isoformat()[:7] and int(f["date"][8:]) > 5)
            out = sum(f["amount"] for f in withdrawals if f["date"][:7] == m.isoformat()[:7])
            bal += early
            accrued += max(0, bal - out) * rate / 1200            # interest on the lowest balance (after the 5th)
            bal += late - out
            if m.month == 3:                                       # credited at the end of the financial year
                bal += round(accrued)
                credited += round(accrued)
                accrued = 0.0
            m = add_months(m, 1)
        bal += sum(f["amount"] for f in deposits if f["date"][:7] == current.isoformat()[:7])
        bal -= sum(f["amount"] for f in withdrawals if f["date"][:7] == current.isoformat()[:7])
    fy = _fy_start(today)
    fy_from, fy_to = f"{fy}-04-01", f"{fy + 1}-03-31"
    this_fy = sum(f["amount"] for f in deposits if fy_from <= f["date"] <= fy_to)
    total_deposits = acc["opening_balance"] + sum(f["amount"] for f in deposits) - sum(f["amount"] for f in withdrawals)
    value = bal + accrued
    return {
        "invested": to_rupees(total_deposits), "value": to_rupees(round(value)), "gain": to_rupees(round(value) - total_deposits),
        "interest_credited": to_rupees(credited), "interest_accrued": to_rupees(round(accrued)),
        "this_fy_deposits": to_rupees(this_fy), "fy_limit": 150000, "fy_label": f"FY {fy}-{str(fy + 1)[2:]}",
        "over_limit": this_fy > 15000000, "closed": False,
        "deposits": [{"id": f["id"], "date": f["date"], "amount": to_rupees(f["amount"]), "from_account": f["from_account"]}
                     for f in reversed(deposits)],
    }


def _summary_metal(acc, metal):
    """Gold coins / silver bars are shown at what you paid; a gain is only counted when an item is sold."""
    items = rows("SELECT * FROM metal_items WHERE account_id = ? ORDER BY date DESC, id DESC", (acc["id"],))
    held = [i for i in items if not i["sold_date"]]
    cost = sum(i["total_paid"] for i in held)
    pure = sum(i["grams"] * i["purity"] / 100 for i in held)
    realised = sum((i["sold_amount"] or 0) - i["total_paid"] for i in items if i["sold_date"])
    out_items = [{**i, "total_paid": to_rupees(i["total_paid"]), "making_charges": to_rupees(i["making_charges"]),
                  "sold_amount": to_rupees(i["sold_amount"]), "rate": to_rupees(i["rate"]),
                  "pure_grams": round(i["grams"] * i["purity"] / 100, 3)} for i in items]
    return {
        "invested": to_rupees(cost), "value": to_rupees(cost), "gain": 0,
        "grams": round(sum(i["grams"] for i in held), 3), "pure_grams": round(pure, 3),
        "making_charges": to_rupees(sum(i["making_charges"] for i in held)), "realised_gain": to_rupees(realised),
        "items": out_items, "closed": False,
    }


def _scheme_progress(d, items, today, closed=False):
    """Gold savings scheme: one payment a month (extra purchases in a month count once)."""
    start, months = _d(d["start_date"]), d["term_months"]
    first = date(start.year, start.month, 1)
    index = lambda iso: months_between(first, date(int(iso[:4]), int(iso[5:7]), 1))
    paid_months = {index(i["date"]) for i in items if i["date"] >= first.isoformat()}
    paid_months = {m for m in paid_months if 0 <= m < months} | set(range(min(d["prepaid_instalments"] or 0, months)))
    expected = min(months, months_between(first, date(today.year, today.month, 1)) + 1) if today >= start else 0
    due_day = d["due_day"] or start.day
    out = {"scheme": True, "term_months": months, "instalment": to_rupees(d["amount"]),
           "paid_instalments": len(paid_months), "expected_instalments": expected,
           "missed_instalments": len([m for m in range(expected) if m not in paid_months]), "due_day": due_day}
    unpaid = [m for m in range(months) if m not in paid_months]
    if unpaid and not closed:
        m = add_months(first, unpaid[0])
        out["next_due"] = date(m.year, m.month, min(due_day, calendar.monthrange(m.year, m.month)[1])).isoformat()
    return out


def _summary_basic(acc, d, flows):
    """Shown at what you put in, unless you typed in its current value (then later money in / out is added to it)."""
    added, principal_out, _, received = _money_in_out(acc, flows)
    open_p = added - principal_out
    closed = added > 0 and open_p <= 0
    value, as_on = open_p, None
    if d["current_value"] is not None and not closed:
        as_on = d["current_value_date"]
        later_in = sum(f["amount"] for f in flows if f["type"] == "invest" and f["to_account_id"] == acc["id"]
                       and f["date"] > as_on)
        later_out = sum((f["principal_amount"] or 0) for f in flows if f["type"] == "redeem"
                        and f["from_account_id"] == acc["id"] and f["date"] > as_on)
        value = d["current_value"] + later_in - later_out
    realised = received - principal_out
    return {"invested": to_rupees(open_p), "value": to_rupees(value), "closed": closed,
            "realised_gain": to_rupees(realised), "unrealised_gain": to_rupees(value - open_p),
            "gain": to_rupees(realised + value - open_p), "value_as_on": as_on}


def summary(acc, d=None, today=None):
    today = today or date.today()
    d = d or details(acc["id"])
    flows = _flows(acc["id"], acc["opening_date"])
    t = d["inv_type"]
    if t == "share":
        s = _summary_share(acc, d, flows)
    elif t == "fd":
        s = _summary_fd(acc, d, flows, today)
    elif t == "rd":
        s = _summary_rd(acc, d, flows, today)
    elif t == "ppf":
        s = _summary_ppf(acc, d, flows, today)
    elif t in ("gold", "silver"):
        s = _summary_metal(acc, t)
        if d["term_months"] and d["amount"] and d["start_date"]:
            s.update(_scheme_progress(d, s["items"], today, closed=not acc["active"]))
            if acc["active"] and (acc["opening_balance"] or d["opening_grams"]):      # paid before using the app
                g = d["opening_grams"] or 0
                s["paid_before"], s["grams_before"] = to_rupees(acc["opening_balance"]), g
                s["invested"] = s["value"] = to_rupees(to_paise(str(s["invested"])) + acc["opening_balance"])
                s["grams"] = round(s["grams"] + g, 3)
                s["pure_grams"] = round(s["pure_grams"] + g * 0.916, 3)
    else:
        s = _summary_basic(acc, d, flows)
        if t == "chitty" and d["term_months"] and d["amount"] and d["start_date"]:
            deposits = [f for f in flows if f["type"] == "invest" and f["to_account_id"] == acc["id"]]
            s.update(_scheme_progress(d, deposits, today, closed=not acc["active"] or s["closed"]))
            s["deposits"] = [{"id": f["id"], "date": f["date"], "amount": to_rupees(f["amount"]),
                              "from_account": f["from_account"]} for f in reversed(deposits)]
    if t not in ("share", "other", "chitty"):          # estimates: whole rupees
        for k in ("value", "gain", "maturity_amount"):
            if isinstance(s.get(k), (int, float)):
                s[k] = round(s[k])
    s["flows"] = [{**f, "amount": to_rupees(f["amount"]), "principal_amount": to_rupees(f["principal_amount"])}
                  for f in reversed(flows)]
    return s


def _detail_out(d):
    out = dict(d)
    out["amount"] = to_rupees(d["amount"])
    out["goal_profit"] = to_rupees(d["goal_profit"])
    out["current_value"] = to_rupees(d["current_value"])
    out["closed_amount"] = to_rupees(d["closed_amount"])
    out["extra"] = json.loads(d["extra"]) if d["extra"] else {}
    held = one("SELECT name FROM accounts WHERE id = ?", (d["held_at_account_id"],)) if d["held_at_account_id"] else None
    out["held_at"] = held["name"] if held else None
    return out


def _where(d):
    """Bank account it's held at, else the institution typed in."""
    if d["held_at_account_id"]:
        a = one("SELECT name FROM accounts WHERE id = ?", (d["held_at_account_id"],))
        if a:
            return a["name"]
    return d["institution"]


# ---------------------------------------------------------------- overview

def overview(today=None):
    today = today or date.today()
    accs = rows("""SELECT a.*, COALESCE(d.inv_type, 'other') AS inv_type FROM accounts a
                   LEFT JOIN investment_details d ON d.account_id = a.id
                   WHERE a.kind = 'investment' ORDER BY a.sort_order, a.name""")
    types = {t["id"]: t for t in types_svc.list_types()}
    items, by_type, upcoming = [], {}, []
    soon = add_months(today, 3).isoformat()
    for a in accs:
        d = details(a["id"])
        s = summary(a, d, today)
        ty = types.get(d["type_id"]) or types_svc.resolve({"inv_type": d["inv_type"]})
        item = {"id": a["id"], "name": a["name"], "type": ty["id"], "type_label": ty["name"], "color": ty["color"],
                "works_like": d["inv_type"], "institution": _where(d), "invested": s["invested"], "value": s["value"],
                "gain": s.get("gain"), "closed": s.get("closed", False) or not a["active"],
                "maturity_date": d["maturity_date"], "active": bool(a["active"]),
                "rate": d["rate"] if d["inv_type"] in ("fd", "rd", "ppf") else None,
                "instalment": s.get("instalment") if d["inv_type"] in ("rd", "gold", "chitty") else None,
                "next_due": s.get("next_due") if d["inv_type"] in ("rd", "gold", "chitty") and a["active"]
                and not s.get("closed") else None}
        if d["inv_type"] == "share":
            item["gain_pct"] = s.get("gain_pct")
        items.append(item)
        if not item["closed"]:
            t = by_type.setdefault(ty["id"], {"type": ty["id"], "label": ty["name"], "color": ty["color"],
                                              "invested": 0.0, "value": 0.0, "count": 0})
            t["invested"] += s["invested"] or 0
            t["value"] += s["value"] or 0
            t["count"] += 1
        if d["maturity_date"] and not item["closed"] and today.isoformat() <= d["maturity_date"] <= soon:
            upcoming.append({"date": d["maturity_date"], "kind": "maturity", "id": a["id"], "name": a["name"],
                             "amount": s.get("maturity_amount") or s["value"]})
        if d["inv_type"] == "fd" and not item["closed"]:
            for p in s.get("payouts", []):
                if not p["recorded"] and p["date"] <= soon:
                    upcoming.append({"date": p["date"], "kind": "payout_due" if p["due"] else "payout",
                                     "id": a["id"], "name": a["name"], "amount": p["amount"]})
        if d["inv_type"] in ("rd", "gold", "chitty") and not item["closed"] and s.get("next_due") and not s.get("missed_instalments") \
                and s["next_due"] <= soon:
            upcoming.append({"date": s["next_due"], "kind": "rd_due", "id": a["id"], "name": a["name"],
                             "amount": s["instalment"]})
        if d["inv_type"] in ("rd", "gold", "chitty") and not item["closed"] and s.get("missed_instalments"):
            upcoming.append({"date": today.isoformat(), "kind": "rd_missed", "id": a["id"], "name": a["name"],
                             "amount": s["instalment"], "count": s["missed_instalments"]})
    groups = sorted(by_type.values(), key=lambda t: -t["value"])
    for t in groups:
        t["invested"], t["value"] = round(t["invested"], 2), round(t["value"], 2)
    total_inv = round(sum(t["invested"] for t in groups), 2)
    total_val = round(sum(t["value"] for t in groups), 2)
    return {
        "totals": {"invested": total_inv, "value": total_val, "gain": round(total_val - total_inv, 2)},
        "by_type": groups, "items": items, "upcoming": sorted(upcoming, key=lambda u: u["date"]),
    }


def _int(v, field, lo, hi, what):
    if v in (None, ""):
        return 0
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        raise ApiError(f"{what} must be a whole number", field=field)
    if not lo <= n <= hi:
        raise ApiError(f"{what} must be {lo}–{hi}", field=field)
    return n


def _tenure(p):
    """(total months, days). Years + months + days, or (older callers) term_months alone as total months."""
    if not any(p.get(k) not in (None, "") for k in ("term_years", "term_months", "term_days")):
        return None, None
    years = _int(p.get("term_years"), "term_years", 0, 50, "Years")
    months = _int(p.get("term_months"), "term_months", 0, 600, "Months")
    days = _int(p.get("term_days"), "term_days", 0, 3650, "Days")
    total = years * 12 + months
    if total > 600:
        raise ApiError("Tenure can be up to 50 years", field="term_years")
    if not total and not days:
        return None, None
    return total or None, days or None


def tenure_end(start, months, days):
    end = add_months(start, months or 0)
    return end + timedelta(days=days or 0)


def _held_at(v):
    if v in (None, ""):
        return None
    a = one("SELECT id, kind FROM accounts WHERE id = ?", (v,)) if str(v).isdigit() else None
    if not a or a["kind"] != "bank":
        raise ApiError("Choose one of your bank accounts", field="held_at_account_id")
    return a["id"]


def _clean_details(t, p, existing=None):
    """t = the calculation the type works like."""
    if t not in types_svc.WORKS_LIKE:
        raise ApiError("Choose an investment type", field="type_id")
    months, days = _tenure(p)
    c = {
        "inv_type": t,
        "institution": (p.get("institution") or "").strip()[:80] or None,
        "held_at_account_id": _held_at(p.get("held_at_account_id")) if t in HELD_AT else None,
        "amount": _paise(p.get("amount"), "amount"),
        "rate": _rate(p.get("rate")),
        "start_date": _date_or_none(p.get("start_date"), "start_date"),
        "term_months": months,
        "term_days": days,
        "maturity_date": _date_or_none(p.get("maturity_date"), "maturity_date"),
        "payout": p.get("payout") or None,
        "goal_pct": _rate(p.get("goal_pct"), "goal_pct") if p.get("goal_pct") not in (None, "") else None,
        "goal_profit": _paise(p.get("goal_profit"), "goal_profit"),
        "goal_date": _date_or_none(p.get("goal_date"), "goal_date"),
        "notes": (p.get("notes") or "").strip() or None,
        "due_day": _int(p.get("due_day"), "due_day", 1, 31, "Due day") or None if t in ("rd", "gold", "chitty") else None,
    }
    if t in HELD_AT and c["held_at_account_id"]:
        c["institution"] = None                     # the bank account says where it is
    if t in ("fd", "rd") and c["rate"] is None:
        raise ApiError("Enter the interest rate", field="rate")
    if t == "fd":
        if not c["amount"]:
            raise ApiError("Enter the deposit amount", field="amount")
        if not c["start_date"]:
            raise ApiError("Enter the start date", field="start_date")
        if c["payout"] not in PAYOUTS:
            c["payout"] = "maturity"
        if (c["term_months"] or c["term_days"]) and not p.get("maturity_date"):
            c["maturity_date"] = tenure_end(_d(c["start_date"]), c["term_months"], c["term_days"]).isoformat()
        if not c["maturity_date"]:
            raise ApiError("Enter the tenure or maturity date", field="term_years")
        if c["maturity_date"] <= c["start_date"]:
            raise ApiError("Maturity must be after the start date", field="maturity_date")
    elif t == "rd":
        if not c["amount"]:
            raise ApiError("Enter the monthly instalment", field="amount")
        if not c["start_date"]:
            raise ApiError("Enter the start date", field="start_date")
        if c["term_days"]:
            raise ApiError("An RD runs for whole months: enter years and months only", field="term_days")
        if not c["term_months"]:
            raise ApiError("Enter the tenure (years and months)", field="term_years")
        c["maturity_date"] = c["maturity_date"] or add_months(_d(c["start_date"]), c["term_months"]).isoformat()
        c["due_day"] = c["due_day"] or _d(c["start_date"]).day
        c["prepaid_instalments"] = _int(p.get("prepaid_instalments"), "prepaid_instalments", 0, 600,
                                        "Instalments already paid") or None
        if (c["prepaid_instalments"] or 0) > c["term_months"]:
            raise ApiError("More instalments than the RD has", field="prepaid_instalments")
    elif t in ("gold", "chitty") and is_scheme(p):
        # monthly schemes: Gold Tree (each payment buys gold) and chit funds (no interest; prize money once)
        if not c["amount"]:
            raise ApiError("Enter the monthly amount", field="amount")
        if not c["start_date"]:
            raise ApiError("Enter the start date", field="start_date")
        if c["term_days"]:
            raise ApiError("The scheme runs for whole months", field="term_days")
        if not c["term_months"]:
            raise ApiError("Enter the number of months", field="term_months")
        c["maturity_date"] = c["maturity_date"] or add_months(_d(c["start_date"]), c["term_months"]).isoformat()
        c["due_day"] = c["due_day"] or _d(c["start_date"]).day
        c["prepaid_instalments"] = _int(p.get("prepaid_instalments"), "prepaid_instalments", 0, 600,
                                        "Instalments already paid") or None
        if (c["prepaid_instalments"] or 0) > c["term_months"]:
            raise ApiError("More instalments than the scheme has", field="prepaid_instalments")
        if t == "chitty":
            c["rate"] = None
        else:
            g = p.get("opening_grams")
            try:
                c["opening_grams"] = round(float(g), 3) if g not in (None, "") else None
                assert c["opening_grams"] is None or 0 <= c["opening_grams"] < 1e6
            except (TypeError, ValueError, AssertionError):
                raise ApiError("Enter the grams, e.g. 1.62", field="opening_grams")
    elif t == "ppf":
        if not c["start_date"]:
            raise ApiError("Enter the date the PPF account was opened", field="start_date")
        if c["rate"] is None:
            c["rate"] = 7.1
        if not p.get("maturity_date"):
            c["maturity_date"] = date(_fy_start(_d(c["start_date"])) + 16, 4, 1).isoformat()
    if t != "fd":
        c["payout"] = None
    scheme = t in ("gold", "chitty") and is_scheme(p)
    if not (t == "rd" or scheme):
        c["prepaid_instalments"] = None
    if not (t == "gold" and scheme):
        c["opening_grams"] = None
    if t not in ("fd", "rd") and not scheme:
        c["term_months"] = c["term_days"] = None
        if t in ("gold", "silver", "chitty"):
            c["amount"] = c["start_date"] = c["maturity_date"] = c["due_day"] = None
    return c


def is_scheme(p):
    """A monthly scheme (Gold Tree, chit fund) has a monthly amount and a number of months."""
    return bool(p.get("scheme")) or any(p.get(k) not in (None, "", 0) for k in ("term_months", "term_years"))


def create(p):
    name = (p.get("name") or "").strip()
    if not name:
        raise ApiError("Give it a name, e.g. SBI FD 2026 or Zerodha", field="name")
    ty = types_svc.resolve(p)
    if not ty["active"]:
        raise ApiError(f"'{ty['name']}' is no longer offered for new investments", field="type_id")
    t = ty["works_like"]
    c = _clean_details(t, p)
    c["type_id"] = ty["id"]
    c["extra"] = types_svc.clean_extra(ty["fields"], p.get("extra"))
    conn = get_db()
    if one("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE", (name,)):
        raise ApiError(f"'{name}' already exists", field="name")
    opening = _paise(p.get("opening_balance"), "opening_balance") or 0
    opening_date = _date_or_none(p.get("opening_date"), "opening_date")
    if opening and not opening_date:
        raise ApiError("Choose the 'as on' date for the amount already invested", field="opening_date")
    paid_from = p.get("paid_from_account_id") or None
    if t == "fd" and not paid_from and not opening:
        # an FD you already hold: its deposit is the amount already invested, as on the start date
        opening, opening_date = c["amount"], c["start_date"]
    if t == "rd" or (t in ("chitty", "gold") and c["term_months"]):
        # paid before using the app: instalments already paid x instalment (chit / gold tree can say what was paid)
        opening = (c["prepaid_instalments"] or 0) * c["amount"]
        if t != "rd" and c["prepaid_instalments"] and p.get("opening_paid") not in (None, ""):
            opening = _paise(p.get("opening_paid"), "opening_paid") or 0
        opening_date = c["start_date"] if opening else None
    cur = conn.execute(
        "INSERT INTO accounts (name, kind, opening_balance, opening_date, sort_order) VALUES (?, 'investment', ?, ?, "
        "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM accounts))",
        (name, opening, opening_date or (c["start_date"] if opening else None)),
    )
    acc_id = cur.lastrowid
    conn.execute(
        f"INSERT INTO investment_details (account_id, {', '.join(c)}) VALUES (?, {', '.join('?' for _ in c)})",
        [acc_id] + list(c.values()),
    )
    conn.commit()
    # gold / silver: the first purchase, entered with the investment
    if t in ("gold", "silver") and isinstance(p.get("first_item"), dict):
        try:
            add_item(acc_id, p["first_item"])
        except ApiError:
            delete(acc_id)                       # nothing half-saved
            raise
    # FD bought now: record the payment from the bank
    if t == "fd" and paid_from and not opening:
        entries_svc.create({"type": "invest", "date": c["start_date"], "amount": str(to_rupees(c["amount"])),
                            "from_account_id": paid_from, "to_account_id": acc_id, "note": f"New FD {name}"})
    return get(acc_id)


TERM_KEYS = ("term_years", "term_months", "term_days")


def update(account_id, p):
    acc = _account(account_id)
    old = details(account_id)
    ty = types_svc.resolve(p, fallback_id=old["type_id"]) if (p.get("type_id") or p.get("inv_type")) \
        else types_svc.resolve({"type_id": old["type_id"]} if old["type_id"] else {"inv_type": old["inv_type"]})
    t = ty["works_like"]
    if t != old["inv_type"]:
        kept = one("SELECT (SELECT COUNT(*) FROM share_actions WHERE account_id = :a)"
                   " + (SELECT COUNT(*) FROM share_dividends WHERE account_id = :a)"
                   " + (SELECT COUNT(*) FROM metal_items WHERE account_id = :a) AS n", {"a": account_id})["n"]
        if kept:
            raise ApiError("This investment has its own records (journal or items), so its type can't change "
                           "to one that works differently", field="type_id")
    base = _detail_out(old)
    if any(k in p for k in TERM_KEYS):
        for k in TERM_KEYS:
            base.pop(k, None)
    merged = {**base, **p}
    if "maturity_date" not in p and (any(k in p for k in TERM_KEYS) or "start_date" in p):
        merged["maturity_date"] = None          # recompute from the new tenure
    c = _clean_details(t, merged, old)
    c["type_id"] = ty["id"]
    c["extra"] = types_svc.clean_extra(ty["fields"], p["extra"] if "extra" in p else base["extra"])
    if t not in OWN_VALUE:
        c["current_value"] = c["current_value_date"] = None
    conn = get_db()
    if p.get("name") and p["name"].strip() != acc["name"]:
        if one("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE AND id != ?", (p["name"].strip(), account_id)):
            raise ApiError("That name is already used", field="name")
        conn.execute("UPDATE accounts SET name = ? WHERE id = ?", (p["name"].strip(), account_id))
    opening = None                              # amount paid before using the app, if it changes
    if t == "rd" and ("prepaid_instalments" in p or "amount" in p or "start_date" in p):
        opening = (c["prepaid_instalments"] or 0) * c["amount"]
    elif t in ("chitty", "gold") and c["term_months"]:
        n = c["prepaid_instalments"] or 0
        if p.get("opening_paid") not in (None, "") and n:
            opening = _paise(p.get("opening_paid"), "opening_paid") or 0
        elif n != (old["prepaid_instalments"] or 0) or (n and not acc["opening_balance"]) or not n:
            opening = n * c["amount"]
    if opening is not None and opening != acc["opening_balance"]:
        if opening < acc["opening_balance"] and \
                entries_svc.open_principal(account_id) - (acc["opening_balance"] - opening) < 0:
            raise ApiError("Part of this has already come back to you; that can't be undone by changing the amount paid before",
                           field="prepaid_instalments")
        conn.execute("UPDATE accounts SET opening_balance = ?, opening_date = ? WHERE id = ?",
                     (opening, c["start_date"] if opening else None, account_id))
    conn.execute(f"UPDATE investment_details SET {', '.join(k + ' = ?' for k in c)} WHERE account_id = ?",
                 list(c.values()) + [account_id])
    conn.commit()
    return get(account_id)


def set_value(account_id, p):
    """Type in what a simple holding (mutual fund, NPS...) is worth now. An empty value goes back to 'at cost'."""
    _account(account_id)
    d = details(account_id)
    if d["inv_type"] not in OWN_VALUE:
        raise ApiError("This investment's value is worked out for you")
    value = _paise(p.get("value"), "value")
    when = _date_or_none(p.get("date"), "date") or date.today().isoformat()
    if when > date.today().isoformat():
        raise ApiError("The date can't be in the future", field="date")
    get_db().execute("UPDATE investment_details SET current_value = ?, current_value_date = ? WHERE account_id = ?",
                     (value, when if value is not None else None, account_id))
    get_db().commit()
    return get(account_id)


def _entry_count(account_id):
    return one("SELECT COUNT(*) AS n FROM entries WHERE from_account_id = :a OR to_account_id = :a"
               " OR related_account_id = :a", {"a": account_id})["n"]


def close(account_id, p):
    """Close an investment (matured, broken early, sold out, withdrawn). Records what came back:
    stocks -> a transfer of what's left; gold / silver -> all items held marked sold (+ a redeem if money came back);
    everything else -> a redeem of all the open principal (the difference counts as income / loss)."""
    acc = _account(account_id)
    if not acc["active"]:
        raise ApiError("It's already closed")
    d = details(account_id)
    t = d["inv_type"]
    when = _date_or_none(p.get("date"), "date") or date.today().isoformat()
    if when > date.today().isoformat():
        raise ApiError("The closing date can't be in the future", field="date")
    amount = _paise(p.get("amount"), "amount", required=True)
    to_acc = p.get("to_account_id") or None
    if amount and not to_acc:
        raise ApiError("Choose the account the money came into", field="to_account_id")
    if to_acc:
        _bank(to_acc, "to_account_id")
    premature = bool(d["maturity_date"] and when < d["maturity_date"])
    note = (p.get("note") or "").strip()[:300] or f"Closing {acc['name']}{' (closed early)' if premature else ''}"
    entry_id = None
    if t == "share":
        if amount:
            entry_id = entries_svc.create({"type": "transfer", "date": when, "amount": str(to_rupees(amount)),
                                           "from_account_id": acc["id"], "to_account_id": to_acc, "note": note})["id"]
    elif t in ("gold", "silver"):
        held = rows("SELECT * FROM metal_items WHERE account_id = ? AND sold_date IS NULL", (account_id,))
        cost = sum(i["total_paid"] for i in held)
        if amount and to_acc:
            principal = max(0, entries_svc.open_principal(acc["id"]))            # everything still in it
            entry_id = entries_svc.create({"type": "redeem", "date": when, "amount": str(to_rupees(amount)),
                                           "principal_amount": str(to_rupees(principal)), "from_account_id": acc["id"],
                                           "to_account_id": to_acc, "note": note})["id"]
        left = amount
        for k, i in enumerate(held):              # share what came back by what each item cost
            part = left if k == len(held) - 1 else (round(amount * i["total_paid"] / cost) if cost else 0)
            left -= part
            get_db().execute("UPDATE metal_items SET sold_date = ?, sold_amount = ?, sold_entry_id = ?, sold_on_close = 1 "
                             "WHERE id = ?", (when, part, entry_id, i["id"]))
    elif amount:
        principal = max(0, entries_svc.open_principal(acc["id"]))
        entry_id = entries_svc.create({"type": "redeem", "date": when, "amount": str(to_rupees(amount)),
                                       "principal_amount": str(to_rupees(principal)), "from_account_id": acc["id"],
                                       "to_account_id": to_acc, "note": note})["id"]
    conn = get_db()
    conn.execute("UPDATE investment_details SET closed_on = ?, closed_amount = ?, close_entry_id = ?, close_note = ? "
                 "WHERE account_id = ?", (when, amount, entry_id, note, account_id))
    conn.execute("UPDATE accounts SET active = 0 WHERE id = ?", (account_id,))
    conn.commit()
    return get(account_id)


def undo_close(account_id):
    """Open a closed investment again: the closing transaction is removed and items sold on closing are held again."""
    acc = _account(account_id)
    d = details(account_id)
    conn = get_db()
    if d["close_entry_id"]:
        conn.execute("UPDATE metal_items SET sold_entry_id = NULL WHERE sold_entry_id = ?", (d["close_entry_id"],))
        if one("SELECT id FROM entries WHERE id = ?", (d["close_entry_id"],)):
            entries_svc.delete(d["close_entry_id"])
    conn.execute("UPDATE metal_items SET sold_date = NULL, sold_amount = NULL, sold_on_close = 0 "
                 "WHERE account_id = ? AND sold_on_close = 1", (account_id,))
    conn.execute("UPDATE investment_details SET closed_on = NULL, closed_amount = NULL, close_entry_id = NULL, "
                 "close_note = NULL WHERE account_id = ?", (account_id,))
    conn.execute("UPDATE accounts SET active = 1 WHERE id = ?", (acc["id"],))
    conn.commit()
    return get(account_id)


def delete(account_id, backup_dir=None):
    """Delete an investment with everything recorded on it: its money transactions (so bank balances go back
    as if they never happened), journal, dividends and items. A backup of the database is saved first."""
    _account(account_id)
    conn = get_db()
    if backup_dir and _entry_count(account_id):
        from ..db import backup
        backup(conn, backup_dir, label="before-delete")
    for table in ("metal_items", "share_actions", "share_dividends", "investment_details"):
        conn.execute(f"DELETE FROM {table} WHERE account_id = ?", (account_id,))
    conn.execute("DELETE FROM entries WHERE from_account_id = :a OR to_account_id = :a OR related_account_id = :a",
                 {"a": account_id})
    conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    conn.commit()


def get(account_id):
    acc = _account(account_id)
    d = details(account_id)
    ty = types_svc.resolve({"type_id": d["type_id"]} if d["type_id"] else {"inv_type": d["inv_type"]})
    out = {"account": {**{k: acc[k] for k in ("id", "name", "opening_date")}, "active": bool(acc["active"])},
           "transactions": _entry_count(account_id),
           "opening_balance": to_rupees(acc["opening_balance"]),
           "details": _detail_out(d), "type": ty, "type_label": ty["name"], "summary": summary(acc, d)}
    if d["inv_type"] == "share":
        out["actions"] = [{**r, "profit": to_rupees(r["profit"]), "charges": to_rupees(r["charges"]),
                           "net": to_rupees(r["profit"] - r["charges"])}
                          for r in rows("SELECT * FROM share_actions WHERE account_id = ? ORDER BY date DESC, id DESC",
                                        (account_id,))]
        out["dividends"] = [{**r, "amount": to_rupees(r["amount"])}
                            for r in rows("SELECT * FROM share_dividends WHERE account_id = ? ORDER BY date DESC, id DESC",
                                          (account_id,))]
    return out


# ---------------------------------------------------------------- money movements

def _bank(account_id, field):
    a = one("SELECT * FROM accounts WHERE id = ?", (account_id,))
    if not a or a["kind"] not in ("bank", "cash", "credit_card"):
        raise ApiError("Choose a bank, cash or card account", field=field)
    return a


def add_funds(account_id, p):
    """Funds added / FD-RD-PPF deposit / chitty instalment: invest entry bank -> investment."""
    acc = _account(account_id)
    _bank(p.get("from_account_id"), "from_account_id")
    return entries_svc.create({"type": "invest", "date": p.get("date"), "amount": p.get("amount"),
                               "from_account_id": p.get("from_account_id"), "to_account_id": acc["id"],
                               "payment_mode_id": p.get("payment_mode_id"), "note": p.get("note")})


def withdraw(account_id, p):
    """Share account -> bank. Never income: a plain transfer."""
    acc = _account(account_id)
    if acc["inv_type"] != "share":
        raise ApiError("Use Close for this investment")
    _bank(p.get("to_account_id"), "to_account_id")
    return entries_svc.create({"type": "transfer", "date": p.get("date"), "amount": p.get("amount"),
                               "from_account_id": acc["id"], "to_account_id": p.get("to_account_id"),
                               "note": p.get("note") or "Withdrawn from stocks account"})


def redeem(account_id, p):
    """FD/RD/PPF maturity or premature closure, chitty payout: gain or loss counts as Investment Returns."""
    acc = _account(account_id)
    if acc["inv_type"] == "share":
        raise ApiError("Stocks accounts use 'Withdraw' (never counted as income)")
    principal = p.get("principal_amount")
    if principal in (None, ""):
        principal = to_rupees(entries_svc.open_principal(acc["id"]))
    return entries_svc.create({"type": "redeem", "date": p.get("date"), "amount": p.get("amount"),
                               "principal_amount": str(principal), "from_account_id": acc["id"],
                               "to_account_id": p.get("to_account_id"), "note": p.get("note")})


def record_payout(account_id, p):
    """FD interest paid out to the bank: income, linked to the FD."""
    acc = _account(account_id)
    if acc["inv_type"] != "fd":
        raise ApiError("Interest payouts are for FDs")
    cat = one("SELECT id FROM categories WHERE name = 'Interest - FD' AND kind = 'income'")
    e = entries_svc.create({"type": "income", "date": p.get("date"), "amount": p.get("amount"),
                            "category_id": cat["id"] if cat else None, "to_account_id": p.get("to_account_id"),
                            "note": p.get("note") or f"Interest from {acc['name']}"})
    get_db().execute("UPDATE entries SET related_account_id = ? WHERE id = ?", (acc["id"], e["id"]))
    get_db().commit()
    return e


# ---------------------------------------------------------------- share journal

def _share_acc(account_id):
    acc = _account(account_id)
    if acc["inv_type"] != "share":
        raise ApiError("This is not a stocks account")
    return acc


ACTIONS = ("cnc_buy", "cnc_sell", "mtf_buy", "mtf_sell", "intraday", "other")


def _clean_action(p):
    action = (p.get("action") or "").lower()
    if action not in ACTIONS:
        raise ApiError("Choose the action", field="action")
    other = (p.get("action_other") or "").strip()[:60] or None
    if action == "other" and not other:
        raise ApiError("Enter what the action is", field="action_other")
    if action != "other":
        other = None
    stocks = (p.get("stocks") or "").strip()
    if not stocks:
        raise ApiError("Enter the stock(s)", field="stocks")
    profit = _paise(p.get("profit"), "profit", allow_negative=True) or 0
    if action in ("cnc_buy", "mtf_buy") and profit:
        raise ApiError("A buy has no profit; enter it on the sell", field="profit")
    return {"date": _date_or_none(p.get("date"), "date") or date.today().isoformat(), "stocks": stocks[:200],
            "action": action, "action_other": other, "profit": profit, "charges": _paise(p.get("charges"), "charges") or 0,
            "note": (p.get("note") or "").strip()[:300] or None}


def add_action(account_id, p):
    _share_acc(account_id)
    c = _clean_action(p)
    get_db().execute("INSERT INTO share_actions (account_id, date, stocks, action, action_other, profit, charges, note) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (account_id, c["date"], c["stocks"], c["action"], c["action_other"],
                                                         c["profit"], c["charges"], c["note"]))
    get_db().commit()
    return get(account_id)


def update_action(account_id, action_id, p):
    _share_acc(account_id)
    if not one("SELECT id FROM share_actions WHERE id = ? AND account_id = ?", (action_id, account_id)):
        raise ApiError("Action not found", status=404)
    c = _clean_action(p)
    get_db().execute("UPDATE share_actions SET date=?, stocks=?, action=?, action_other=?, profit=?, charges=?, note=? "
                     "WHERE id = ?", (c["date"], c["stocks"], c["action"], c["action_other"], c["profit"], c["charges"],
                                      c["note"], action_id))
    get_db().commit()
    return get(account_id)


def delete_action(account_id, action_id):
    get_db().execute("DELETE FROM share_actions WHERE id = ? AND account_id = ?", (action_id, account_id))
    get_db().commit()
    return get(account_id)


def add_dividend(account_id, p):
    _share_acc(account_id)
    amount = _paise(p.get("amount"), "amount", required=True)
    if amount <= 0:
        raise ApiError("Amount must be more than zero", field="amount")
    get_db().execute("INSERT INTO share_dividends (account_id, date, stock, amount, note) VALUES (?, ?, ?, ?, ?)",
                     (account_id, _date_or_none(p.get("date"), "date") or date.today().isoformat(),
                      (p.get("stock") or "").strip()[:100] or None, amount, (p.get("note") or "").strip() or None))
    get_db().commit()
    return get(account_id)


def delete_dividend(account_id, div_id):
    get_db().execute("DELETE FROM share_dividends WHERE id = ? AND account_id = ?", (div_id, account_id))
    get_db().commit()
    return get(account_id)


# ---------------------------------------------------------------- gold / silver

def _metal_acc(account_id):
    acc = _account(account_id)
    if acc["inv_type"] not in ("gold", "silver"):
        raise ApiError("This is not a gold or silver account")
    return acc


def add_item(account_id, p):
    """One purchase: date, amount paid, buy rate, weight; bill name, payment method, document, note.
    Purity: built-in gold coins / silver bars are 999 (99.9%); other gold types can say 22K etc."""
    acc = _metal_acc(account_id)
    try:
        grams = float(p.get("grams"))
        assert 0 < grams < 1e7
    except (TypeError, ValueError, AssertionError):
        raise ApiError("Enter the weight in grams", field="grams")
    try:
        purity = float(p.get("purity") or 99.9)
        assert 1 <= purity <= 100
    except (TypeError, ValueError, AssertionError):
        raise ApiError("Purity must be a percent, e.g. 99.9", field="purity")
    total = _paise(p.get("total_paid"), "total_paid", required=True)
    making = _paise(p.get("making_charges"), "making_charges") or 0
    if making > total:
        raise ApiError("Premium can't be more than the total paid", field="making_charges")
    d = _date_or_none(p.get("date"), "date") or date.today().isoformat()
    rate = _paise(p.get("rate"), "rate")
    text = lambda k, n: (str(p.get(k) or "").strip()[:n] or None)
    desc = text("description", 100) or f"{grams:g} g"
    entry_id = None
    if p.get("paid_from_account_id"):
        e = entries_svc.create({"type": "invest", "date": d, "amount": str(to_rupees(total)),
                                "from_account_id": p["paid_from_account_id"], "to_account_id": acc["id"],
                                "payment_mode_id": p.get("payment_mode_id"),
                                "note": f"Bought {grams:g} g" + (f" ({text('bill_name', 80)})" if p.get("bill_name") else "")})
        entry_id = e["id"]
    get_db().execute("""INSERT INTO metal_items (account_id, date, description, grams, purity, total_paid, making_charges,
                        rate, entry_id, note, bill_name, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                     (acc["id"], d, desc, grams, purity, total, making, rate, entry_id, text("note", 300),
                      text("bill_name", 80), text("doc", 200)))
    get_db().commit()
    return get(account_id)


def sell_item(account_id, item_id, p):
    acc = _metal_acc(account_id)
    item = one("SELECT * FROM metal_items WHERE id = ? AND account_id = ?", (item_id, account_id))
    if not item:
        raise ApiError("Item not found", status=404)
    if item["sold_date"]:
        raise ApiError("Already marked as sold")
    amount = _paise(p.get("amount"), "amount", required=True)
    d = _date_or_none(p.get("date"), "date") or date.today().isoformat()
    entry_id = None
    if p.get("to_account_id"):
        # principal closed = what this item cost, but never more than what was paid in through entries
        principal = min(item["total_paid"], max(0, entries_svc.open_principal(acc["id"])))
        e = entries_svc.create({"type": "redeem", "date": d, "amount": str(to_rupees(amount)),
                                "principal_amount": str(to_rupees(principal)), "from_account_id": acc["id"],
                                "to_account_id": p["to_account_id"], "note": f"Sold {item['description']}"})
        entry_id = e["id"]
    get_db().execute("UPDATE metal_items SET sold_date = ?, sold_amount = ?, sold_entry_id = ? WHERE id = ?",
                     (d, amount, entry_id, item_id))
    get_db().commit()
    return get(account_id)


def delete_item(account_id, item_id):
    item = one("SELECT * FROM metal_items WHERE id = ? AND account_id = ?", (item_id, account_id))
    if not item:
        raise ApiError("Item not found", status=404)
    if item["entry_id"] or item["sold_entry_id"]:
        raise ApiError("This item has payment transactions. Delete those from Transactions first, or mark it sold.")
    get_db().execute("DELETE FROM metal_items WHERE id = ?", (item_id,))
    get_db().commit()
    return get(account_id)
