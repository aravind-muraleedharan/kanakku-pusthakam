"""Accounts: where your everyday money is - bank accounts, credit cards and cash.

Investments and loans have their own pages; their totals are still returned for net worth (shown on the Dashboard).
Each card lists the EMIs running on it, which live under Loans & EMIs.
"""
import calendar
from datetime import date

from . import investments as inv_svc
from . import loans as loan_svc
from . import masters
from .reports import balances

GROUPS = ("bank", "credit_card", "cash")


def next_day_of_month(day, today):
    """Next date (today or later) that falls on `day` of a month (short months use their last day)."""
    y, m = today.year, today.month
    for _ in range(2):
        d = date(y, m, min(day, calendar.monthrange(y, m)[1]))
        if d >= today:
            return d
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return d


def overview(today=None):
    today = today or date.today()
    bal = {b["id"]: b for b in balances()}
    out = {k: [] for k in GROUPS}
    for a in masters.list_items("accounts"):
        if a["kind"] not in GROUPS:
            continue
        b = bal.get(a["id"], {})
        item = {k: a[k] for k in ("id", "name", "kind", "active", "used", "institution", "subtype", "credit_limit",
                                  "bill_day", "due_day", "opening_balance", "opening_date")}
        item["balance"] = b.get("balance", 0)
        if a["kind"] == "credit_card":
            owed = b.get("outstanding", 0)
            item["outstanding"] = owed
            if a["credit_limit"]:
                item["limit_used_pct"] = round(max(owed, 0) * 100 / a["credit_limit"], 1)
                item["available"] = round(a["credit_limit"] - max(owed, 0), 2)
            if a["bill_day"]:
                item["next_bill"] = next_day_of_month(a["bill_day"], today).isoformat()
            if a["due_day"]:
                due = next_day_of_month(a["due_day"], today)
                item["next_due"] = due.isoformat()
                item["due_in_days"] = (due - today).days
        out[a["kind"]].append(item)

    inv = inv_svc.overview(today)
    lo = loan_svc.overview(today)
    for card in out["credit_card"]:
        card["emis"] = [{"id": i["id"], "name": i["name"], "emi": i["summary"]["emi"]} for i in lo["items"]
                        if i["status"] == "active" and i["loan_type"] == "cc_emi" and i["account_id"] == card["id"]]
    active = lambda lst: [x for x in lst if x["active"]]
    totals = {
        "bank": round(sum(x["balance"] for x in out["bank"]), 2),
        "cash": round(sum(x["balance"] for x in out["cash"]), 2),
        "card_owed": round(sum(x["outstanding"] for x in out["credit_card"]), 2),
        "card_limit": round(sum(x["credit_limit"] or 0 for x in active(out["credit_card"])), 2),
        "investments": inv["totals"]["value"],
        "loans": lo["totals"]["outstanding"],
    }
    totals["net_worth"] = round(totals["bank"] + totals["cash"] + totals["investments"]
                                - totals["card_owed"] - totals["loans"], 2)
    return {
        "banks": out["bank"], "cards": out["credit_card"], "cash": out["cash"],
        "totals": totals,
    }
