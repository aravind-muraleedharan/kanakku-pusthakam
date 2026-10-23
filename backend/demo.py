"""Sample data for trying the app (`python3 run.py --demo`).

Fills a separate demo database with ~13 months of realistic entries. Never touches your real data.
"""
import random
from datetime import date

from .db import get_db, one, rows
from .services import entries, investments, loans, masters


def _month_start(d, back):
    y, m = d.year, d.month - back
    while m < 1:
        y, m = y - 1, m + 12
    return y, m


def seed_demo(app):
    with app.app_context():
        if one("SELECT COUNT(*) AS n FROM entries")["n"]:
            return False                                    # already has data
        rnd = random.Random(42)
        acc = {a["kind"]: a["id"] for a in rows("SELECT id, kind FROM accounts ORDER BY sort_order DESC")}
        bank, card, cash = acc.get("bank"), acc.get("credit_card"), acc.get("cash")
        cat = {c["name"]: c["id"] for c in rows("SELECT id, name FROM categories")}
        mode = {m["name"]: m["id"] for m in rows("SELECT id, name FROM payment_modes")}
        rd = masters.create("accounts", {"name": "Post Office RD", "kind": "investment", "inv_type": "rd"})["id"]

        today = date.today()
        y0, m0 = _month_start(today, 12)
        get_db().execute("UPDATE accounts SET opening_balance = ?, opening_date = ? WHERE id = ?",
                         (2500000, f"{y0:04d}-{m0:02d}-01", bank))
        get_db().execute("UPDATE accounts SET opening_date = ? WHERE opening_date IS NULL", (f"{y0:04d}-{m0:02d}-01",))
        get_db().execute("UPDATE accounts SET institution = 'HDFC Bank', subtype = 'savings' WHERE id = ?", (bank,))
        if card:
            get_db().execute("UPDATE accounts SET institution = 'SBI Card', credit_limit = 15000000, bill_day = 20, "
                             "due_day = 10 WHERE id = ?", (card,))
        get_db().commit()

        spend = [("Food & Groceries", 600, 3500), ("Dining Out / Food Delivery", 250, 1400), ("Vehicle", 400, 2800),
                 ("Utilities", 900, 2600), ("Mobile & Internet", 300, 900), ("Health & Medical", 200, 2400),
                 ("Entertainment & Subscriptions", 149, 650), ("Clothing & Accessories", 700, 3800),
                 ("Local Commute", 60, 450), ("Personal Care", 150, 900)]
        notes = ["", "", "", "Weekly groceries", "Petrol", "Swiggy", "Electricity", "Pharmacy", "Movie"]
        for back in range(12, -1, -1):
            y, m = _month_start(today, back)
            last_day = 28 if back else min(today.day, 28)
            ym = f"{y:04d}-{m:02d}"
            entries.create({"type": "income", "date": f"{ym}-01", "amount": "85000",
                            "category_id": cat["Salary"], "to_account_id": bank, "note": "Monthly salary"})
            entries.create({"type": "expense", "date": f"{ym}-03", "amount": "16000", "category_id": cat["Rent / Housing"],
                            "from_account_id": bank, "payment_mode_id": mode["Net Banking"], "note": "Rent"})
            entries.create({"type": "invest", "date": f"{ym}-05", "amount": "5000", "from_account_id": bank,
                            "to_account_id": rd, "note": "RD instalment"})
            on_card = 0
            for _ in range(rnd.randint(9, 14)):
                name, lo, hi = rnd.choice(spend)
                amount = rnd.randint(lo, hi)
                use_card = card and rnd.random() < 0.45
                use_cash = not use_card and cash and rnd.random() < 0.15
                src = card if use_card else cash if use_cash else bank
                pm = "Credit Card" if use_card else "Cash" if use_cash else "UPI"
                entries.create({"type": "expense", "date": f"{ym}-{rnd.randint(1, last_day):02d}", "amount": str(amount),
                                "category_id": cat[name], "from_account_id": src, "payment_mode_id": mode[pm],
                                "note": rnd.choice(notes)})
                on_card += amount if use_card else 0
            if cash and back % 2 == 0:
                entries.create({"type": "transfer", "date": f"{ym}-02", "amount": "3000", "from_account_id": bank,
                                "to_account_id": cash, "note": "ATM withdrawal"})
            if back > 0 and on_card:
                entries.create({"type": "transfer", "date": f"{ym}-25", "amount": str(on_card), "from_account_id": bank,
                                "to_account_id": card, "payment_mode_id": mode["Net Banking"], "note": "Card bill"})
        _demo_investments(today, y0, m0, rd, bank, rnd)
        _demo_loans(today, bank, card, cat)
        _demo_budget(today)
        return True


def _demo_budget(today):
    """A budget for next month (the month after is left for you to try "Copy")."""
    from .services import budget
    from .services.reports import shift_month
    plan = [("income", "Salary", 85000), ("income", "Rent received", 6000),
            ("expense", "House rent", 16000), ("expense", "Groceries", 4500), ("expense", "Milk", 900),
            ("expense", "Electricity", 2200), ("expense", "Phone & internet", 800), ("expense", "Petrol", 2500),
            ("expense", "Phone EMI", 8000), ("expense", "Home loan EMI", 10030), ("expense", "RD instalment", 5000),
            ("expense", "Eating out", 1500)]
    nxt = shift_month(today.strftime("%Y-%m"), 1)
    ids = {}
    for kind, name, _ in plan:
        ids[name] = budget.add_item({"kind": kind, "name": name})["id"]
    budget.save(nxt, [{"item_id": ids[n], "amount": str(v)} for _, n, v in plan], today=today)
    budget.save(nxt, [{"item_id": ids["Groceries"], "note": "Festival week"}], today=today)


def _demo_investments(today, y0, m0, rd, bank, rnd):
    start = f"{y0:04d}-{m0:02d}-05"
    investments.update(rd, {"inv_type": "rd", "institution": "India Post", "amount": "5000", "rate": "6.7",
                            "start_date": start, "term_months": "60"})
    # share account: funds added, a year of market actions, dividends, one withdrawal
    sh = investments.create({"name": "Zerodha - Trading", "inv_type": "share", "institution": "Zerodha",
                             "goal_pct": "20", "goal_date": f"{today.year + 1}-03-31"})["account"]["id"]
    entries.create({"type": "invest", "date": start, "amount": "150000", "from_account_id": bank,
                    "to_account_id": sh, "note": "Funds added"})
    stocks = ["TCS", "INFY", "HDFCBANK", "ITC", "TATAMOTORS", "SBIN", "RELIANCE", "BEL"]
    for back in range(12, -1, -1):
        y, m = _month_start(today, back)
        last = 28 if back else min(today.day, 28)
        for _ in range(rnd.randint(1, 4)):
            kind = rnd.choice(["cnc_buy", "cnc_sell", "cnc_sell", "mtf_buy", "mtf_sell", "intraday"])
            profit = (0 if kind.endswith("buy") else rnd.randint(-1500, 4000) if kind.endswith("sell")
                      else rnd.randint(-900, 1200))
            investments.add_action(sh, {"date": f"{y:04d}-{m:02d}-{rnd.randint(1, last):02d}", "action": kind,
                                        "stocks": rnd.choice(stocks), "profit": str(profit),
                                        "charges": str(rnd.randint(15, 90))})
        if m in (6, 8):
            investments.add_dividend(sh, {"date": f"{y:04d}-{m:02d}-20", "stock": "ITC", "amount": str(rnd.randint(300, 900))})
    y, m = _month_start(today, 2)
    investments.withdraw(sh, {"date": f"{y:04d}-{m:02d}-10", "amount": "20000", "to_account_id": bank})
    # FDs: one cumulative already held, one with quarterly interest opened this year
    investments.create({"name": "SBI FD 2025", "inv_type": "fd", "institution": "SBI", "amount": "200000", "rate": "7.1",
                        "start_date": f"{y0 - 1:04d}-{m0:02d}-15", "term_months": "36"})
    y, m = _month_start(today, 7)
    fd = investments.create({"name": "Federal Bank FD", "inv_type": "fd", "institution": "Federal Bank", "amount": "100000",
                             "rate": "7.4", "start_date": f"{y:04d}-{m:02d}-10", "term_months": "24", "payout": "quarterly",
                             "paid_from_account_id": bank})
    first = fd["summary"]["payouts"][0]
    investments.record_payout(fd["account"]["id"], {"date": first["date"], "amount": str(first["amount"]), "to_account_id": bank})
    # PPF with a balance and yearly deposits
    ppf = investments.create({"name": "SBI PPF", "inv_type": "ppf", "institution": "SBI", "start_date": "2019-04-10",
                              "opening_balance": "420000", "opening_date": f"{y0:04d}-{m0:02d}-01"})["account"]["id"]
    for back in (11, 5):
        y, m = _month_start(today, back)
        entries.create({"type": "invest", "date": f"{y:04d}-{m:02d}-04", "amount": "50000", "from_account_id": bank,
                        "to_account_id": ppf, "note": "PPF deposit"})
    # gold and silver
    g = investments.create({"name": "Gold coins", "inv_type": "gold"})["account"]["id"]
    investments.add_item(g, {"description": "8 g coin", "grams": "8", "purity": "99.5", "total_paid": "46800",
                             "making_charges": "2100", "rate": "5500", "date": "2022-11-02"})
    investments.add_item(g, {"description": "10 g coin", "grams": "10", "purity": "99.9", "total_paid": "61500", "rate": "6050",
                             "date": "2023-10-20"})
    sv = investments.create({"name": "Silver bars", "inv_type": "silver"})["account"]["id"]
    investments.add_item(sv, {"description": "500 g bar", "grams": "500", "purity": "99.9", "total_paid": "38500", "rate": "75",
                              "date": "2021-08-12"})


def _demo_loans(today, bank, card, cat):
    from .services.investments import add_months
    # phone on a 9-month no-cost card EMI, bought 3 months ago
    if card:
        start = add_months(today, -3)
        ph = loans.create({"name": "Phone EMI", "loan_type": "cc_emi", "lender": "SBI Card", "account_id": card,
                           "category_id": cat["Electronics & Gadgets"], "principal": "72000", "emi": "8000",
                           "tenure_months": 9, "charges": "236", "first_emi_date": add_months(start, 1).isoformat(),
                           "start_date": start.isoformat()})
        for _ in range(2):
            loans.pay_emi(ph["id"], {})
    # personal loan taken 6 months ago, one part-prepayment
    start = add_months(today, -6)
    pl = loans.create({"name": "HDFC Personal Loan", "loan_type": "personal", "lender": "HDFC Bank",
                       "bank_account_id": bank, "principal": "300000", "emi": "10030", "tenure_months": 36,
                       "charges": "5900", "first_emi_date": add_months(start, 1).isoformat(),
                       "start_date": start.isoformat()})
    for _ in range(5):
        loans.pay_emi(pl["id"], {})
    loans.prepay(pl["id"], {"amount": "25000", "mode": "tenure", "date": add_months(today, -1).isoformat()})
