"""Sample data for trying the app (`python3 run.py --demo`).

Fills a separate demo database with ~13 months of realistic entries. Never touches your real data.
"""
import random
from datetime import date

from .db import get_db, one, rows
from .services import entries, masters


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
        rd = masters.create("accounts", {"name": "Recurring Deposit", "kind": "investment"})["id"]

        today = date.today()
        y0, m0 = _month_start(today, 12)
        get_db().execute("UPDATE accounts SET opening_balance = ?, opening_date = ? WHERE id = ?",
                         (2500000, f"{y0:04d}-{m0:02d}-01", bank))
        get_db().execute("UPDATE accounts SET opening_date = ? WHERE opening_date IS NULL", (f"{y0:04d}-{m0:02d}-01",))
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
        return True
