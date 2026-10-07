"""API tests. Run from the project folder:  python3 -m unittest discover tests -v

Uses a throwaway database in a temp folder; your real data is never touched.
"""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
try:
    import flask  # noqa: F401
except ImportError:
    sys.path.insert(1, os.path.join(ROOT, "vendor", "flask-bundle.zip"))

from backend import create_app  # noqa: E402
from backend.services import totp  # noqa: E402

EMAIL, PASSWORD = "me@example.com", "Correct-horse-42"


def login(client):
    """Create the account and finish authenticator setup, leaving the client fully logged in."""
    r = client.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "confirm": PASSWORD})
    assert r.status_code == 201, r.get_json()
    secret = client.post("/api/auth/mfa/begin").get_json()["secret"]
    r = client.post("/api/auth/mfa/confirm", json={"code": totp.code_at(secret, totp.current_step())})
    assert r.get_json()["state"] == "ok", r.get_json()
    return secret


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({
            "TESTING": True,
            "DB_PATH": os.path.join(self.tmp.name, "test.db"),
            "BACKUP_DIR": os.path.join(self.tmp.name, "backups"),
            "SECRET_KEY": b"test-secret-key-test-secret-key!",
        })
        self.c = self.app.test_client()
        self.c.environ_base["HTTP_X_REQUESTED_WITH"] = "KanakkuPusthakam"
        login(self.c)
        # the tests use their own accounts, so they don't depend on the starting (seed) accounts
        for name, kind in (("SBI", "bank"), ("HDFC", "bank"), ("Federal Bank", "bank"),
                           ("SBI BPCL Credit Card", "credit_card"), ("Cash Wallet", "cash")):
            r = self.c.post("/api/masters/accounts", json={"name": name, "kind": kind})
            assert r.status_code in (201, 400), r.get_json()          # 400 = already in the seed data
        m = self.c.get("/api/masters").get_json()
        self.acc = {a["name"]: a["id"] for a in m["accounts"]}
        self.cat = {c["name"]: c["id"] for c in m["categories"]}
        self.mode = {p["name"]: p["id"] for p in m["payment_modes"]}

    def tearDown(self):
        self.tmp.cleanup()

    def post(self, **kw):
        return self.c.post("/api/entries", json=kw)

    def ok(self, **kw):
        r = self.post(**kw)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()

    def new_account(self, name, kind, opening=0):
        r = self.c.post("/api/masters/accounts", json={"name": name, "kind": kind, "opening_balance": opening})
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()["id"]

    # ------------------------------------------------------------------ seed
    def test_seed_data(self):
        kinds = {a["kind"] for a in self.c.get("/api/masters/accounts").get_json()}
        self.assertTrue({"bank", "credit_card", "cash"} <= kinds)
        self.assertIn("Vehicle", self.cat)
        self.assertIn("Investment Returns", self.cat)
        self.assertEqual(len(self.mode), 5)

    # ------------------------------------------------------- credit card logic
    def test_card_spend_counted_once(self):
        self.ok(type="income", date="2026-09-01", amount="100000", category_id=self.cat["Salary"], to_account_id=self.acc["SBI"])
        self.ok(type="expense", date="2026-09-05", amount="2,500.50", category_id=self.cat["Dining Out / Food Delivery"],
                from_account_id=self.acc["SBI BPCL Credit Card"], payment_mode_id=self.mode["Credit Card"])
        self.ok(type="expense", date="2026-09-06", amount="1000", category_id=self.cat["Vehicle"],
                from_account_id=self.acc["SBI BPCL Credit Card"], payment_mode_id=self.mode["Credit Card"])
        # bill payment = transfer
        self.ok(type="transfer", date="2026-09-20", amount="3500.50", from_account_id=self.acc["SBI"],
                to_account_id=self.acc["SBI BPCL Credit Card"], payment_mode_id=self.mode["Net Banking"])
        s = self.c.get("/api/reports/summary?month=2026-09").get_json()
        self.assertEqual(s["expense"], 3500.50)        # not 7001
        self.assertEqual(s["income"], 100000)
        bal = {b["name"]: b for b in self.c.get("/api/reports/balances").get_json()}
        self.assertEqual(bal["SBI BPCL Credit Card"]["outstanding"], 0)
        self.assertEqual(bal["SBI"]["balance"], 100000 - 3500.50)

    def test_card_outstanding_before_payment(self):
        self.ok(type="expense", date="2026-09-05", amount="999", category_id=self.cat["Clothing & Accessories"],
                from_account_id=self.acc["SBI BPCL Credit Card"])
        bal = {b["name"]: b for b in self.c.get("/api/reports/balances").get_json()}
        self.assertEqual(bal["SBI BPCL Credit Card"]["outstanding"], 999)

    # --------------------------------------------------------- investments
    def test_rd_maturity_gain_is_income(self):
        rd = self.new_account("Federal RD", "investment")
        for m in range(1, 13):
            self.ok(type="invest", date=f"2025-{m:02d}-10", amount="5000", from_account_id=self.acc["Federal Bank"], to_account_id=rd)
        y = self.c.get("/api/reports/summary?from=2025-01-01&to=2025-12-31").get_json()
        self.assertEqual(y["expense"], 0)
        self.assertEqual(y["invested"], 60000)
        self.ok(type="redeem", date="2026-01-10", amount="63200", principal_amount="60000",
                from_account_id=rd, to_account_id=self.acc["Federal Bank"])
        jan = self.c.get("/api/reports/summary?month=2026-01").get_json()
        self.assertEqual(jan["income"], 3200)
        self.assertEqual(jan["redeemed_principal"], 60000)
        cats = self.c.get("/api/reports/categories?kind=income&month=2026-01").get_json()
        self.assertEqual(cats["items"][0]["name"], "Investment Returns")
        self.assertEqual(cats["items"][0]["amount"], 3200)
        bal = {b["name"]: b for b in self.c.get("/api/reports/balances").get_json()}
        self.assertEqual(bal["Federal RD"]["open_principal"], 0)
        self.assertEqual(bal["Federal RD"]["realised_gain"], 3200)
        self.assertEqual(bal["Federal Bank"]["balance"], -60000 + 63200)

    def test_chitty_loss(self):
        ch = self.new_account("KSFE Chitty", "investment", opening="60000")
        self.ok(type="redeem", date="2026-03-01", amount="55500", principal_amount="60000",
                from_account_id=ch, to_account_id=self.acc["SBI"])
        s = self.c.get("/api/reports/summary?month=2026-03").get_json()
        self.assertEqual(s["income"], -4500)

    def test_redeem_more_principal_than_invested_rejected(self):
        fd = self.new_account("SBI FD", "investment")
        self.ok(type="invest", date="2026-01-01", amount="10000", from_account_id=self.acc["SBI"], to_account_id=fd)
        r = self.post(type="redeem", date="2026-06-01", amount="12000", principal_amount="15000",
                      from_account_id=fd, to_account_id=self.acc["SBI"])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "principal_amount")

    def test_cannot_delete_invest_already_redeemed(self):
        fd = self.new_account("SBI FD", "investment")
        inv = self.ok(type="invest", date="2026-01-01", amount="10000", from_account_id=self.acc["SBI"], to_account_id=fd)
        self.ok(type="redeem", date="2026-06-01", amount="10500", principal_amount="10000", from_account_id=fd, to_account_id=self.acc["SBI"])
        r = self.c.delete(f"/api/entries/{inv['id']}")
        self.assertEqual(r.status_code, 400)

    # ---------------------------------------------------------- validation
    def test_validation(self):
        bad = [
            dict(type="expense", date="2026-09-01", amount="0", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"]),
            dict(type="expense", date="2026-13-01", amount="10", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"]),
            dict(type="expense", date="2026-09-01", amount="10", from_account_id=self.acc["SBI"]),
            dict(type="expense", date="2026-09-01", amount="10", category_id=self.cat["Salary"], from_account_id=self.acc["SBI"]),
            dict(type="income", date="2026-09-01", amount="10", category_id=self.cat["Investment Returns"], to_account_id=self.acc["SBI"]),
            dict(type="transfer", date="2026-09-01", amount="10", from_account_id=self.acc["SBI"], to_account_id=self.acc["SBI"]),
            dict(type="invest", date="2026-09-01", amount="10", from_account_id=self.acc["SBI"], to_account_id=self.acc["HDFC"]),
            dict(type="nonsense", date="2026-09-01", amount="10"),
            dict(type="expense", date="2026-09-01", amount="abc", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"]),
        ]
        for b in bad:
            r = self.post(**b)
            self.assertEqual(r.status_code, 400, (b, r.get_json()))

    # ------------------------------------------------- edit, delete, list
    def test_edit_delete_and_list(self):
        e = self.ok(type="expense", date="2026-09-01", amount="100", category_id=self.cat["Vehicle"],
                    from_account_id=self.acc["SBI"], note="petrol")
        r = self.c.put(f"/api/entries/{e['id']}", json={**e, "amount": "150", "note": "Petrol full tank"})
        self.assertEqual(r.get_json()["amount"], 150)
        lst = self.c.get("/api/entries?month=2026-09&q=tank").get_json()
        self.assertEqual(lst["count"], 1)
        self.assertEqual(lst["totals"]["expense"], 150)
        self.assertEqual(self.c.delete(f"/api/entries/{e['id']}").status_code, 200)
        self.assertEqual(self.c.get("/api/entries?month=2026-09").get_json()["count"], 0)

    # ------------------------------------------------------------- reports
    def test_monthly_and_grid(self):
        self.ok(type="expense", date="2026-07-03", amount="200", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"])
        self.ok(type="expense", date="2026-09-03", amount="300", category_id=self.cat["Food & Groceries"], from_account_id=self.acc["SBI"])
        rows = self.c.get("/api/reports/monthly?from=2026-07-01&to=2026-09-30").get_json()
        self.assertEqual([r["month"] for r in rows], ["2026-07", "2026-08", "2026-09"])
        self.assertEqual(rows[1]["expense"], 0)
        self.assertEqual(rows[2]["cumulative_net"], -500)
        g = self.c.get("/api/reports/grid?from=2026-07-01&to=2026-09-30").get_json()
        self.assertEqual(g["grand_total"], 500)
        self.assertEqual(len(g["categories"]), 2)
        d = self.c.get("/api/reports/dashboard?month=2026-09").get_json()
        self.assertEqual(d["summary"]["expense"], 300)
        self.assertEqual(len(d["last_12_months"]), 12)

    # ------------------------------------------------------------- masters
    def test_masters_crud(self):
        r = self.c.post("/api/masters/accounts", json={"name": "Amazon ICICI Card", "kind": "credit_card", "opening_balance": "1200"})
        acc = r.get_json()
        self.assertEqual(acc["opening_balance"], 1200)
        bal = {b["name"]: b for b in self.c.get("/api/reports/balances").get_json()}
        self.assertEqual(bal["Amazon ICICI Card"]["outstanding"], 1200)
        self.assertEqual(self.c.post("/api/masters/accounts", json={"name": "sbi", "kind": "bank"}).status_code, 400)
        # used items can't be deleted, only deactivated
        self.ok(type="expense", date="2026-09-01", amount="10", category_id=self.cat["Vehicle"], from_account_id=acc["id"])
        self.assertEqual(self.c.delete(f"/api/masters/accounts/{acc['id']}").status_code, 400)
        r = self.c.put(f"/api/masters/accounts/{acc['id']}", json={"active": False})
        self.assertFalse(r.get_json()["active"])
        # system category is protected
        self.assertEqual(self.c.put(f"/api/masters/categories/{self.cat['Investment Returns']}", json={"name": "x"}).status_code, 400)

    # ---------------------------------------------------- opening balances
    def test_opening_balances_as_on_date(self):
        d = self.c.get("/api/reports/dashboard?month=2026-10").get_json()
        self.assertTrue(d["setup_needed"])
        # an older entry, before tracking started: must not move the balance
        self.ok(type="expense", date="2026-10-01", amount="100", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"])
        fd = self.new_account("SBI FD", "investment")
        r = self.c.put("/api/masters/accounts/opening", json={"items": [
            {"id": self.acc["SBI"], "opening_balance": "400", "opening_date": "2026-10-07"},
            {"id": self.acc["Cash Wallet"], "opening_balance": "500", "opening_date": "2026-10-07"},
            {"id": self.acc["SBI BPCL Credit Card"], "opening_balance": "12,345", "opening_date": "2026-10-07"},
            {"id": fd, "opening_balance": "50000", "opening_date": "2026-10-07"},
        ]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.ok(type="expense", date="2026-10-07", amount="50", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"])
        self.ok(type="expense", date="2026-10-08", amount="1000", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI BPCL Credit Card"])
        self.ok(type="transfer", date="2026-10-09", amount="200", from_account_id=self.acc["SBI"], to_account_id=self.acc["Cash Wallet"])
        bal = {b["name"]: b for b in self.c.get("/api/reports/balances").get_json()}
        self.assertEqual(bal["SBI"]["balance"], 400 - 50 - 200)
        self.assertEqual(bal["Cash Wallet"]["balance"], 700)
        self.assertEqual(bal["SBI BPCL Credit Card"]["outstanding"], 13345)
        self.assertEqual(bal["SBI FD"]["open_principal"], 50000)
        self.assertFalse(self.c.get("/api/reports/dashboard?month=2026-10").get_json()["setup_needed"])
        # the old expense still counts in October's spending report
        self.assertEqual(self.c.get("/api/reports/summary?month=2026-10").get_json()["expense"], 1150)
        # opening shown back as entered (card = outstanding, positive)
        accs = {a["name"]: a for a in self.c.get("/api/masters/accounts").get_json()}
        self.assertEqual(accs["SBI BPCL Credit Card"]["opening_balance"], 12345)
        self.assertEqual(accs["SBI"]["opening_date"], "2026-10-07")
        # date is required
        r = self.c.put("/api/masters/accounts/opening", json={"items": [{"id": self.acc["HDFC"], "opening_balance": "1"}]})
        self.assertEqual(r.status_code, 400)

    def test_export_and_backup(self):
        self.ok(type="expense", date="2026-09-01", amount="10", category_id=self.cat["Vehicle"], from_account_id=self.acc["SBI"], note="ഇന്ധനം")
        csv = self.c.get("/api/system/export.csv").get_data(as_text=True)
        self.assertIn("Vehicle", csv)
        self.assertIn("ഇന്ധനം", csv)
        self.assertEqual(self.c.post("/api/system/backups").status_code, 201)
        self.assertEqual(len(self.c.get("/api/system/backups").get_json()), 1)

    def test_frontend_served(self):
        self.assertIn("Kanakku Pusthakam", self.c.get("/").get_data(as_text=True))
        self.assertEqual(self.c.get("/js/main.js").status_code, 200)


if __name__ == "__main__":
    unittest.main()
