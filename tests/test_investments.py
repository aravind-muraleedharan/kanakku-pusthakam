"""Investments: share journal, FD, RD, PPF, gold/silver.   python3 -m unittest discover tests -v"""
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
from backend.services.investments import add_months, fd_value_at  # noqa: E402
from tests.test_api import login  # noqa: E402

TODAY = date.today()


class InvestmentsTest(unittest.TestCase):
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
        r = self.c.post("/api/masters/accounts", json={"name": "Test Bank", "kind": "bank"})
        self.bank = r.get_json()["id"]

    def tearDown(self):
        self.tmp.cleanup()

    def new(self, **kw):
        r = self.c.post("/api/investments", json=kw)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()

    def act(self, inv_id, path, status=201, **kw):
        r = self.c.post(f"/api/investments/{inv_id}/{path}", json=kw)
        self.assertEqual(r.status_code, status, r.get_json())
        return r.get_json()

    def month_income(self):
        m = TODAY.isoformat()[:7]
        return self.c.get(f"/api/reports/dashboard?month={m}").get_json()["summary"]["income"]

    def bank_balance(self):
        bal = self.c.get(f"/api/reports/dashboard?month={TODAY.isoformat()[:7]}").get_json()["balances"]
        return next(b["balance"] for b in bal if b["id"] == self.bank)

    # ------------------------------------------------------------------ shares
    def test_share_journal_math_and_never_income(self):
        t = TODAY.isoformat()
        s = self.new(name="Zerodha", inv_type="share", goal_pct=50)
        sid = s["account"]["id"]
        self.act(sid, "funds", amount="10000", date=t, from_account_id=self.bank)
        self.act(sid, "actions", date=t, stocks="TCS", action="cnc_buy", charges="15")
        self.act(sid, "actions", date=t, stocks="TCS", action="cnc_sell", profit="500", charges="20")
        self.act(sid, "actions", date=t, stocks="INFY", action="intraday", profit="-100", charges="10")
        self.act(sid, "actions", date=t, stocks="SBIN", action="mtf_buy", charges="5")
        self.act(sid, "actions", date=t, stocks="SBIN", action="mtf_sell", profit="60", charges="5")
        self.act(sid, "actions", status=400, date=t, stocks="X", action="other", profit="10")   # needs a name
        self.act(sid, "actions", date=t, stocks="NIFTY", action="other", action_other="F&O", profit="-10", charges="5")
        g = self.act(sid, "dividends", date=t, stock="ITC", amount="50")
        sm = g["summary"]
        # total profit = CNC + MTF + intraday + others - charges (profit entered before charges);
        # dividends go to the bank, so they are listed but not part of profit or value
        self.assertEqual(sm["total_profit"], 500 + 60 - 100 - 10 - 60)
        self.assertEqual(sm["mtf_profit"], 60)
        self.assertEqual(sm["dividends"], 50)
        self.assertEqual(sm["value"], 10000 + 390)
        self.assertAlmostEqual(sm["gain_pct"], 3.9)
        self.assertEqual(sm["goal"]["target_profit"], 5000)
        self.assertAlmostEqual(sm["goal"]["progress_pct"], 7.8)
        other = next(a for a in g["actions"] if a["action"] == "other")
        self.assertEqual(other["action_other"], "F&O")

        # withdrawal is a transfer: bank gets the money back, nothing counted as income
        g = self.act(sid, "withdraw", amount="2000", date=t, to_account_id=self.bank)
        self.assertEqual(g["summary"]["net_invested"], 8000)
        self.assertEqual(g["summary"]["value"], 8390)
        self.assertEqual(self.month_income(), 0)
        self.assertEqual(self.bank_balance(), -8000)

        # a buy has no profit; share accounts can't be redeemed
        self.act(sid, "actions", status=400, date=t, stocks="X", action="mtf_buy", profit="5")
        r = self.c.post("/api/entries", json={"type": "redeem", "date": t, "amount": "100", "principal_amount": "100",
                                              "from_account_id": sid, "to_account_id": self.bank})
        self.assertEqual(r.status_code, 400)
        self.act(sid, "redeem", status=400, amount="100", to_account_id=self.bank, date=t)

    def test_transfer_out_only_from_share_accounts(self):
        fd = self.new(name="SBI FD", inv_type="fd", amount="1000", rate="7", start_date="2025-01-01", term_months=12)
        r = self.c.post("/api/entries", json={"type": "transfer", "date": TODAY.isoformat(), "amount": "10",
                                              "from_account_id": fd["account"]["id"], "to_account_id": self.bank})
        self.assertEqual(r.status_code, 400)

    # ------------------------------------------------------------------ FD
    def test_fd_cumulative(self):
        fd = self.new(name="SBI FD", inv_type="fd", amount="100000", rate="7", start_date="2024-01-01",
                      term_months=12, paid_from_account_id=self.bank)
        self.assertEqual(fd["details"]["maturity_date"], "2025-01-01")
        sm = fd["summary"]
        self.assertAlmostEqual(sm["maturity_amount"], round(100000 * 1.0175 ** 4), delta=1)
        self.assertEqual(sm["value"], sm["maturity_amount"])         # matured: value stops at maturity
        self.assertEqual(self.bank_balance(), -100000)               # paid from the bank
        # close it: gain counts as income
        g = self.act(fd["account"]["id"], "redeem", amount=str(sm["maturity_amount"]), date=TODAY.isoformat(),
                     to_account_id=self.bank)
        self.assertTrue(g["summary"]["closed"])
        self.assertAlmostEqual(self.month_income(), sm["maturity_amount"] - 100000, delta=0.01)

    def test_fd_formula_part_quarter(self):
        v = fd_value_at(100000, 8, date(2025, 1, 1), date(2025, 5, 1))      # 1 quarter + 30 days
        self.assertAlmostEqual(v, 100000 * 1.02 * (1 + 0.08 * 30 / 365), places=4)

    def test_fd_quarterly_payout(self):
        start = add_months(TODAY, -7).isoformat()
        fd = self.new(name="HDFC FD", inv_type="fd", amount="100000", rate="8", start_date=start,
                      term_months=12, payout="quarterly")
        sm = fd["summary"]
        self.assertEqual([p["amount"] for p in sm["payouts"]], [2000, 2000, 2000])      # month 12 = maturity
        self.assertEqual(sum(p["due"] for p in sm["payouts"]), 2)
        self.assertEqual(sm["maturity_amount"], 102000)
        g = self.act(fd["account"]["id"], "payout", amount="2000", date=TODAY.isoformat(), to_account_id=self.bank)
        self.assertEqual(sum(p["recorded"] for p in g["summary"]["payouts"]), 1)
        self.assertEqual(self.month_income(), 2000)
        ov = self.c.get("/api/investments").get_json()
        self.assertTrue(any(u["kind"] == "payout_due" for u in ov["upcoming"]))

    # ------------------------------------------------------------------ RD
    def test_rd_missed_instalments(self):
        start = add_months(TODAY, -3)
        rd = self.new(name="Post Office RD", inv_type="rd", amount="1000", rate="6.7", start_date=start.isoformat(),
                      term_months=60)
        rid = rd["account"]["id"]
        self.act(rid, "funds", amount="1000", date=start.isoformat(), from_account_id=self.bank)
        g = self.act(rid, "funds", amount="1000", date=add_months(start, 1).isoformat(), from_account_id=self.bank)
        sm = g["summary"]
        self.assertEqual(sm["expected_instalments"], 4)
        self.assertEqual(sm["paid_instalments"], 2)
        self.assertEqual(sm["missed_instalments"], 2)
        self.assertGreater(sm["value"], 2000)
        self.assertEqual(self.month_income(), 0)

    # ------------------------------------------------------------------ PPF
    def test_ppf_year_limit(self):
        p = self.new(name="SBI PPF", inv_type="ppf", start_date="2020-04-01")
        self.assertEqual(p["details"]["rate"], 7.1)
        self.assertEqual(p["details"]["maturity_date"], "2036-04-01")
        g = self.act(p["account"]["id"], "funds", amount="160000", date=TODAY.isoformat(), from_account_id=self.bank)
        self.assertTrue(g["summary"]["over_limit"])
        self.assertEqual(g["summary"]["this_fy_deposits"], 160000)

    # ------------------------------------------------------------------ gold
    def test_gold_at_cost_and_sale(self):
        gacc = self.new(name="Gold", inv_type="gold")
        gid = gacc["account"]["id"]
        g = self.act(gid, "items", description="10 g coin", grams="10", purity="99.9", total_paid="60000",
                     making_charges="1500", rate="5850", date="2025-01-10", paid_from_account_id=self.bank)
        self.assertEqual(g["summary"]["value"], 60000)                 # shown at what you paid
        self.assertEqual(g["summary"]["gain"], 0)
        self.assertEqual(g["summary"]["items"][0]["rate"], 5850)
        self.assertEqual(g["summary"]["pure_grams"], 9.99)
        self.assertEqual(self.c.get("/api/investments/rates").status_code, 404)   # no separate rate any more
        item = g["summary"]["items"][0]["id"]
        g = self.act(gid, f"items/{item}/sell", amount="70000", date=TODAY.isoformat(), to_account_id=self.bank)
        self.assertEqual(g["summary"]["realised_gain"], 10000)
        self.assertEqual(self.month_income(), 10000)

    # ------------------------------------------------------------------ overview
    def test_overview_and_net_worth(self):
        t = TODAY.isoformat()
        s = self.new(name="Groww", inv_type="share")
        self.act(s["account"]["id"], "funds", amount="5000", date=t, from_account_id=self.bank)
        self.new(name="Old FD", inv_type="fd", amount="20000", rate="7", start_date=t, term_months=24,
                 opening_balance="20000", opening_date=t)
        ov = self.c.get("/api/investments").get_json()
        types = {x["label"]: x for x in ov["by_type"]}
        self.assertEqual(types["Stocks"]["value"], 5000)
        self.assertEqual(types["Fixed Deposit"]["invested"], 20000)
        self.assertEqual(ov["totals"]["value"], 25000)
        dash = self.c.get(f"/api/reports/dashboard?month={t[:7]}").get_json()["totals"]
        self.assertEqual(dash["investments_value"], 25000)
        self.assertEqual(dash["net_worth"], -5000 + 25000)

    def test_edit_keeps_terms(self):
        fd = self.new(name="SBI FD", inv_type="fd", amount="50000", rate="7", start_date="2025-01-01", term_months=12)
        fid = fd["account"]["id"]
        r = self.c.put(f"/api/investments/{fid}", json={"rate": "7.25", "term_months": "24", "name": "SBI FD 2y"})
        self.assertEqual(r.status_code, 200, r.get_json())
        g = r.get_json()
        self.assertEqual(g["details"]["amount"], 50000)
        self.assertEqual(g["details"]["maturity_date"], "2027-01-01")
        self.assertEqual(g["account"]["name"], "SBI FD 2y")
        self.assertEqual(g["opening_balance"], 50000)             # already-held FD: deposit counted as invested

    def test_plain_investment_account_gets_details(self):
        r = self.c.post("/api/masters/accounts", json={"name": "KSFE Chitty", "kind": "investment", "inv_type": "chitty"})
        self.assertEqual(r.status_code, 201)
        g = self.c.get(f"/api/investments/{r.get_json()['id']}").get_json()
        self.assertEqual(g["details"]["inv_type"], "chitty")


if __name__ == "__main__":
    unittest.main()
