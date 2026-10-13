"""Loans and EMIs.   python3 -m unittest discover tests -v"""
import os
import sys
import tempfile
import unittest
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
try:
    import flask  # noqa: F401
except ImportError:
    sys.path.insert(1, os.path.join(ROOT, "vendor", "flask-bundle.zip"))

from backend import create_app  # noqa: E402
from backend.services.investments import add_months  # noqa: E402
from backend.services.loans import emi_for, solve_rate  # noqa: E402
from tests.test_api import login  # noqa: E402

TODAY = date.today()
T = TODAY.isoformat()


class LoansTest(unittest.TestCase):
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
        mk = lambda n, k: self.c.post("/api/masters/accounts", json={"name": n, "kind": k}).get_json()["id"]
        self.bank, self.card = mk("Test Bank", "bank"), mk("Test Card", "credit_card")
        cats = {c["name"]: c["id"] for c in self.c.get("/api/masters").get_json()["categories"]}
        self.gadgets, self.interest = cats["Electronics & Gadgets"], cats["Loan Interest & Charges"]

    def tearDown(self):
        self.tmp.cleanup()

    def new(self, **kw):
        r = self.c.post("/api/loans", json=kw)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()

    def post(self, lid, path, status=201, **kw):
        r = self.c.post(f"/api/loans/{lid}/{path}", json=kw)
        self.assertEqual(r.status_code, status, r.get_json())
        return r.get_json()

    def month(self):
        return self.c.get(f"/api/reports/dashboard?month={T[:7]}").get_json()

    def bal(self, acc_id):
        return next(b for b in self.month()["balances"] if b["id"] == acc_id)

    # ------------------------------------------------------------------ maths
    def test_rate_from_emi(self):
        e = emi_for(100000, 0.01, 12)
        self.assertAlmostEqual(e, 8884.88, places=2)
        self.assertAlmostEqual(solve_rate(100000, round(e), 12), 12.0, delta=0.02)
        self.assertEqual(solve_rate(60000, 10000, 6), 0.0)                        # no-cost EMI

    # ------------------------------------------------------------------ credit card EMI
    def test_cc_emi_each_month_is_an_expense(self):
        ln = self.new(name="Phone EMI", loan_type="cc_emi", account_id=self.card, category_id=self.gadgets,
                      principal="30000", emi="10000", tenure_months=3, charges="199", first_emi_date=T, start_date=T)
        lid = ln["id"]
        self.assertEqual(ln["rate"], 0.0)
        self.assertEqual(ln["summary"]["outstanding"], 30000)
        self.assertEqual(self.month()["summary"]["expense"], 199)                 # processing fee only, not the phone
        g = self.post(lid, "emi")
        self.assertEqual(g["summary"]["outstanding"], 20000)
        d = self.month()
        self.assertEqual(d["summary"]["expense"], 10199)
        self.assertEqual(self.bal(self.card)["outstanding"], 10199)
        self.assertEqual(d["totals"]["loans_outstanding"], 20000)

        # prepay 5,000 keeping the EMI: 15,000 left = 2 more EMIs (10,000 + 5,000)
        g = self.post(lid, "prepay", amount="5000", mode="tenure", date=T)
        self.assertEqual(g["summary"]["outstanding"], 15000)
        left = [s for s in g["summary"]["schedule"] if s["kind"] == "emi" and s["status"] in ("due", "upcoming")]
        self.assertEqual([s["amount"] for s in left], [10000, 5000])
        g = self.c.post(f"/api/loans/{lid}/undo").get_json()
        self.assertEqual(g["summary"]["outstanding"], 20000)
        self.assertEqual(self.month()["summary"]["expense"], 10199)               # undo removed the entry

        g = self.post(lid, "close", date=T)
        self.assertEqual(g["status"], "closed")
        self.assertEqual(g["summary"]["outstanding"], 0)
        self.assertEqual(self.month()["summary"]["expense"], 30199)

    # ------------------------------------------------------------------ personal loan
    def test_personal_loan_principal_is_not_expense(self):
        ln = self.new(name="HDFC Personal Loan", loan_type="personal", bank_account_id=self.bank, lender="HDFC",
                      principal="100000", emi="8885", tenure_months=12, charges="2000",
                      first_emi_date=add_months(TODAY, 1).isoformat(), start_date=T)
        lid, acc = ln["id"], ln["account_id"]
        self.assertAlmostEqual(ln["rate"], 12.0, delta=0.05)
        self.assertGreater(ln["summary"]["effective_rate"], ln["rate"])          # charges make it costlier
        self.assertEqual(self.bal(self.bank)["balance"], 98000)                  # received minus charges
        self.assertEqual(self.bal(acc)["outstanding"], 100000)
        d = self.month()
        self.assertEqual(d["summary"]["income"], 0)
        self.assertEqual(d["summary"]["expense"], 2000)

        g = self.post(lid, "emi", date=T)
        self.assertAlmostEqual(g["summary"]["outstanding"], 100000 - (8885 - 1000), delta=1)
        self.assertEqual(self.month()["summary"]["expense"], 2000 + 1000)         # only the interest
        self.assertAlmostEqual(self.bal(acc)["outstanding"], g["summary"]["outstanding"], delta=0.01)

        # prepay 20,000 and lower the EMI, same end date
        before_end = g["summary"]["end_date"]
        g = self.post(lid, "prepay", amount="20000", mode="emi", charges="500", date=T)
        self.assertLess(g["summary"]["emi"], 8885)
        self.assertEqual(g["summary"]["end_date"], before_end)
        self.assertAlmostEqual(self.bal(acc)["outstanding"], g["summary"]["outstanding"], delta=0.01)
        self.assertLess(self.month()["totals"]["net_worth"], 98000)

    def test_running_loan_opening_balance(self):
        start = add_months(TODAY, -4)
        ln = self.new(name="Old loan", loan_type="personal", bank_account_id=self.bank, principal="120000",
                      emi="10662", tenure_months=12, first_emi_date=start.isoformat(), paid_before=4)
        s = ln["summary"]
        self.assertEqual(s["paid_count"], 4)
        self.assertFalse(s["disbursed"])
        self.assertAlmostEqual(self.bal(ln["account_id"])["outstanding"], s["outstanding"], delta=0.01)
        self.assertEqual(self.bal(self.bank)["balance"], 0)                      # nothing received now
        self.assertEqual(s["due_count"], 1)                                       # this month's EMI is due

    def test_validation_and_delete(self):
        r = self.c.post("/api/loans", json={"name": "x", "loan_type": "personal", "bank_account_id": self.bank,
                                            "principal": "100000", "emi": "1000", "tenure_months": 12, "first_emi_date": T})
        self.assertEqual(r.status_code, 400)                                     # EMI x months < amount
        ln = self.new(name="TV EMI", loan_type="cc_emi", account_id=self.card, category_id=self.gadgets,
                      principal="12000", emi="2000", tenure_months=6, first_emi_date=T)
        self.post(ln["id"], "emi")
        self.assertEqual(self.c.delete(f"/api/loans/{ln['id']}").status_code, 200)
        self.assertEqual(self.month()["summary"]["expense"], 0)                    # its entries went with it
        self.assertEqual(self.c.get("/api/loans").get_json()["items"], [])


if __name__ == "__main__":
    unittest.main()
