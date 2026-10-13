"""Investment types added in code, their extra fields, tenure in years/months/days, bank it's held at, typed-in value.
   python3 -m unittest discover tests -v"""
import json
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
try:
    import flask  # noqa: F401
except ImportError:
    sys.path.insert(1, os.path.join(ROOT, "vendor", "flask-bundle.zip"))

from backend import create_app  # noqa: E402
from backend.db import get_db  # noqa: E402
from backend.services import investment_types as types_svc  # noqa: E402
from tests.test_api import login  # noqa: E402

TODAY = date.today().isoformat()


class InvestmentTypesTest(unittest.TestCase):
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
        self.bank = self.c.post("/api/masters/accounts", json={"name": "SBI Savings", "kind": "bank"}).get_json()["id"]
        self.card = self.c.post("/api/masters/accounts", json={"name": "HDFC Card", "kind": "credit_card"}).get_json()["id"]

    def tearDown(self):
        self.tmp.cleanup()

    def add_type(self, name, works_like, fields=()):
        """New types are added in code (a migration); this does the same directly."""
        stored = []
        for i, f in enumerate(fields, 1):
            g = {"key": f"f{i}", "label": f["label"], "kind": f.get("kind", "text"), "required": bool(f.get("required"))}
            if g["kind"] == "choice":
                g["options"] = [o.strip() for o in f["options"].split(",")]
            stored.append(g)
        with self.app.app_context():
            cur = get_db().execute("INSERT INTO investment_types (name, works_like, fields, sort_order) VALUES (?, ?, ?, 50)",
                                   (name, works_like, json.dumps(stored)))
            get_db().commit()
            return types_svc.get(cur.lastrowid)

    def new(self, status=201, **kw):
        r = self.c.post("/api/investments", json=kw)
        self.assertEqual(r.status_code, status, r.get_json())
        return r.get_json()

    def types(self):
        return {t["name"]: t for t in self.c.get("/api/investment-types").get_json()}

    def test_types_are_read_only(self):
        t = self.types()
        self.assertEqual(len(t), 9)
        self.assertEqual(t["Gold Tree"]["works_like"], "gold")                # added by migration 013
        fd = t["Fixed Deposit"]
        self.assertTrue(fd["builtin"])
        # types can't be added, changed or removed from the app
        self.assertEqual(self.c.post("/api/investment-types", json={"name": "X", "works_like": "other"}).status_code, 405)
        self.assertIn(self.c.put(f"/api/investment-types/{fd['id']}", json={"active": False}).status_code, (404, 405))
        self.assertIn(self.c.delete(f"/api/investment-types/{fd['id']}").status_code, (404, 405))
        self.assertEqual(len(self.types()), 9)
        # a hidden type can't be used for a new investment
        with self.app.app_context():
            get_db().execute("UPDATE investment_types SET active = 0 WHERE id = ?", (fd["id"],))
            get_db().commit()
        self.new(status=400, name="X", type_id=fd["id"], amount="1000", rate="7", start_date=TODAY, term_months=12)

    def test_type_with_extra_fields(self):
        mf = self.add_type(name="Mutual Fund", works_like="other", fields=[
            {"label": "Folio number", "required": True},
            {"label": "SIP day", "kind": "number"},
            {"label": "Plan", "kind": "choice", "options": "Direct, Regular"},
            {"label": "Started", "kind": "date"}])
        keys = [f["key"] for f in mf["fields"]]
        self.assertEqual(len(set(keys)), 4)
        self.assertEqual(mf["fields"][2]["options"], ["Direct", "Regular"])
        self.assertFalse(mf["builtin"])
        self.assertEqual(mf["works_like_label"], "Simple holding")
        f = {x["label"]: x["key"] for x in mf["fields"]}

        # required, number, choice and date are checked
        base = {"name": "PPFAS Flexi", "type_id": mf["id"]}
        self.new(status=400, **base, extra={})
        self.new(status=400, **base, extra={f["Folio number"]: "123", f["SIP day"]: "five"})
        self.new(status=400, **base, extra={f["Folio number"]: "123", f["Plan"]: "Gold"})
        self.new(status=400, **base, extra={f["Folio number"]: "123", f["Started"]: "31-02-2025"})
        inv = self.new(**base, extra={f["Folio number"]: " 1234/56 ", f["SIP day"]: "5", f["Plan"]: "Direct",
                                      "unknown": "dropped"})
        self.assertEqual(inv["details"]["extra"], {f["Folio number"]: "1234/56", f["SIP day"]: "5", f["Plan"]: "Direct"})
        self.assertEqual(inv["type"]["name"], "Mutual Fund")
        self.assertEqual(inv["details"]["inv_type"], "other")

        # editing keeps the values
        r = self.c.put(f"/api/investments/{inv['account']['id']}", json={"notes": "SIP"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["details"]["extra"][f["Folio number"]], "1234/56")
        self.assertEqual(self.types()["Mutual Fund"]["used"], 1)

        # grouped under its own name in the overview
        ov = self.c.get("/api/investments").get_json()
        self.assertEqual(ov["items"][0]["type_label"], "Mutual Fund")
        self.assertTrue(ov["items"][0]["color"].startswith("x"))

    def test_own_type_uses_its_calculation(self):
        nsc = self.add_type(name="NSC", works_like="fd", fields=[{"label": "Certificate no."}])
        inv = self.new(name="NSC 2026", type_id=nsc["id"], amount="10000", rate="7.7", start_date="2024-01-01",
                       term_years=5, term_months=0)
        self.assertEqual(inv["details"]["maturity_date"], "2029-01-01")
        self.assertGreater(inv["summary"]["maturity_amount"], 10000)
        self.assertIn("payouts", inv["summary"])                         # FD maths
        tree = self.types()["Gold Tree"]
        g = self.new(name="Kalpavriksha", type_id=tree["id"])
        g = self.c.post(f"/api/investments/{g['account']['id']}/items", json={
            "description": "Gold tree", "grams": "25", "purity": "91.6", "total_paid": "180000", "date": TODAY}).get_json()
        self.assertEqual(g["summary"]["pure_grams"], 22.9)

    def test_tenure_years_months_days(self):
        fd = self.new(name="SBI 400 days", inv_type="fd", amount="100000", rate="7.1", start_date="2025-01-01",
                      term_years=1, term_months=1, term_days=4)
        d = fd["details"]
        self.assertEqual((d["term_months"], d["term_days"]), (13, 4))
        self.assertEqual(d["maturity_date"], "2026-02-05")
        days_only = self.new(name="45 day FD", inv_type="fd", amount="5000", rate="5", start_date="2025-01-01",
                             term_days=45)
        self.assertEqual(days_only["details"]["maturity_date"], "2025-02-15")
        self.new(status=400, name="Bad", inv_type="fd", amount="5000", rate="5", start_date="2025-01-01")
        self.new(status=400, name="Bad", inv_type="fd", amount="5000", rate="5", start_date="2025-01-01", term_days="x")
        self.new(status=400, name="Bad", inv_type="fd", amount="5000", rate="5", start_date="2025-01-01", term_years=51)
        # RD runs in whole months
        self.new(status=400, name="RD", inv_type="rd", amount="1000", rate="6.7", start_date="2025-01-01", term_days=10)
        rd = self.new(name="RD", inv_type="rd", amount="1000", rate="6.7", start_date="2025-01-01",
                      term_years=5, term_months=0)
        self.assertEqual(rd["details"]["term_months"], 60)
        # editing the tenure recomputes the maturity
        fid = fd["account"]["id"]
        r = self.c.put(f"/api/investments/{fid}", json={"term_years": "2", "term_months": "0", "term_days": ""})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["details"]["maturity_date"], "2027-01-01")
        self.assertIsNone(r.get_json()["details"]["term_days"])

    def test_held_at_one_of_your_bank_accounts(self):
        base = dict(inv_type="fd", amount="1000", rate="7", start_date="2025-01-01", term_months=12)
        self.new(status=400, name="FD1", held_at_account_id=self.card, **base)       # a card isn't a bank
        self.new(status=400, name="FD1", held_at_account_id=99999, **base)
        fd = self.new(name="FD1", held_at_account_id=self.bank, institution="typed", **base)
        self.assertEqual(fd["details"]["held_at"], "SBI Savings")
        self.assertIsNone(fd["details"]["institution"])
        ov = self.c.get("/api/investments").get_json()
        self.assertEqual(ov["items"][0]["institution"], "SBI Savings")
        # renaming the bank shows the new name
        self.c.put(f"/api/masters/accounts/{self.bank}", json={"name": "SBI Salary"})
        self.assertEqual(self.c.get(f"/api/investments/{fd['account']['id']}").get_json()["details"]["held_at"],
                         "SBI Salary")

    def test_typed_in_current_value(self):
        inv = self.new(name="NPS", inv_type="other", opening_balance="100000", opening_date="2025-01-01")
        iid = inv["account"]["id"]
        self.assertEqual(inv["summary"]["value"], 100000)
        r = self.c.post(f"/api/investments/{iid}/value", json={"value": "112500", "date": "2025-06-30"})
        self.assertEqual(r.status_code, 200, r.get_json())
        s = r.get_json()["summary"]
        self.assertEqual((s["value"], s["unrealised_gain"], s["value_as_on"]), (112500, 12500, "2025-06-30"))
        # money added after that date is added to the value
        self.c.post(f"/api/investments/{iid}/funds", json={"amount": "5000", "date": TODAY, "from_account_id": self.bank})
        s = self.c.get(f"/api/investments/{iid}").get_json()["summary"]
        self.assertEqual((s["value"], s["invested"]), (117500, 105000))
        self.assertEqual(self.c.get("/api/investments").get_json()["totals"]["value"], 117500)
        # future date refused; empty value goes back to 'at cost'
        self.assertEqual(self.c.post(f"/api/investments/{iid}/value", json={"value": "1", "date": "2999-01-01"}).status_code, 400)
        s = self.c.post(f"/api/investments/{iid}/value", json={"value": ""}).get_json()["summary"]
        self.assertEqual(s["value"], 105000)
        # FDs work their value out themselves
        fd = self.new(name="FD", inv_type="fd", amount="1000", rate="7", start_date="2025-01-01", term_months=12)
        self.assertEqual(self.c.post(f"/api/investments/{fd['account']['id']}/value", json={"value": "5"}).status_code, 400)

    def test_type_change_guarded(self):
        s = self.new(name="Zerodha", inv_type="share")
        sid = s["account"]["id"]
        self.c.post(f"/api/investments/{sid}/actions", json={"date": TODAY, "stocks": "TCS", "action": "cnc_sell", "profit": "10"})
        fd_id = self.types()["Fixed Deposit"]["id"]
        r = self.c.put(f"/api/investments/{sid}", json={"type_id": fd_id, "amount": "1", "rate": "7",
                                                        "start_date": TODAY, "term_months": 12})
        self.assertEqual(r.status_code, 400)
        # an empty investment can move to another type
        o = self.new(name="Misc", inv_type="other")
        nps = self.add_type(name="NPS", works_like="other")
        r = self.c.put(f"/api/investments/{o['account']['id']}", json={"type_id": nps["id"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["type_label"], "NPS")


    # ------------------------------------------------------------------ delete / close
    def bank_balance(self):
        return next(b["balance"] for b in self.c.get("/api/reports/balances").get_json() if b["id"] == self.bank)

    def close(self, inv_id, status=201, **kw):
        r = self.c.post(f"/api/investments/{inv_id}/close", json=kw)
        self.assertEqual(r.status_code, status, r.get_json())
        return r.get_json()

    def test_delete_removes_everything(self):
        o = self.new(name="NPS", inv_type="other")
        oid = o["account"]["id"]
        self.c.post(f"/api/investments/{oid}/funds", json={"amount": "5000", "date": TODAY, "from_account_id": self.bank})
        self.c.post(f"/api/investments/{oid}/redeem", json={"amount": "1200", "principal_amount": "1000", "date": TODAY,
                                                           "to_account_id": self.bank})
        self.assertEqual(self.bank_balance(), -3800)
        self.assertEqual(self.c.get(f"/api/investments/{oid}").get_json()["transactions"], 2)
        g = self.new(name="Gold", inv_type="gold")
        self.c.post(f"/api/investments/{g['account']['id']}/items", json={
            "description": "coin", "grams": "1", "purity": "99.9", "total_paid": "7000", "date": TODAY,
            "paid_from_account_id": self.bank})
        self.assertEqual(self.c.delete(f"/api/investments/{oid}").status_code, 200)
        self.assertEqual(self.c.delete(f"/api/investments/{g['account']['id']}").status_code, 200)
        self.assertEqual(self.c.get(f"/api/investments/{oid}").status_code, 404)
        self.assertEqual(self.c.get("/api/entries?month=").get_json()["items"], [])     # its transactions are gone
        self.assertEqual(self.bank_balance(), 0)                                           # as if it never happened
        self.assertEqual(self.c.get("/api/investments").get_json()["items"], [])
        backups = os.listdir(self.app.config["BACKUP_DIR"])
        self.assertTrue(any("before-delete" in f for f in backups))                       # saved first

    def test_close_fd_early_and_undo(self):
        start = (date.today() - timedelta(days=300)).isoformat()
        fd = self.new(name="SBI FD", inv_type="fd", amount="100000", rate="7", start_date=start,
                      term_years=2, paid_from_account_id=self.bank)
        fid = fd["account"]["id"]
        self.close(fid, status=400, date=TODAY, amount="103000")                      # where did the money go?
        self.close(fid, status=400, date="2999-01-01", amount="1", to_account_id=self.bank)
        g = self.close(fid, date=TODAY, amount="103000", to_account_id=self.bank)
        d = g["details"]
        self.assertEqual((d["closed_on"], d["closed_amount"]), (TODAY, 103000))
        self.assertIn("closed early", d["close_note"])
        self.assertFalse(g["account"]["active"])
        self.assertEqual(self.bank_balance(), 3000)
        e = self.c.get("/api/entries?month=").get_json()["items"]
        closing = next(x for x in e if x["type"] == "redeem")
        self.assertEqual((closing["gain"], closing["note"]), (3000, d["close_note"]))   # the gain counts as income
        ov = self.c.get("/api/investments").get_json()
        self.assertTrue(ov["items"][0]["closed"])
        self.assertEqual(ov["totals"]["value"], 0)
        self.close(fid, status=400, date=TODAY, amount="1", to_account_id=self.bank)      # already closed
        # undo closing: the closing transaction goes, the FD is running again
        g = self.c.post(f"/api/investments/{fid}/reopen").get_json()
        self.assertTrue(g["account"]["active"])
        self.assertIsNone(g["details"]["closed_on"])
        self.assertEqual(self.bank_balance(), -100000)

    def test_close_stocks_gold_and_nothing_back(self):
        s = self.new(name="Zerodha", inv_type="share")
        sid = s["account"]["id"]
        self.c.post(f"/api/investments/{sid}/funds", json={"amount": "10000", "date": TODAY, "from_account_id": self.bank})
        self.c.post(f"/api/investments/{sid}/actions", json={"date": TODAY, "stocks": "TCS", "action": "cnc_sell", "profit": "500"})
        self.close(sid, date=TODAY, amount="10500", to_account_id=self.bank)
        self.assertEqual(self.bank_balance(), 500)
        e = self.c.get("/api/entries?month=").get_json()["items"]
        self.assertFalse(any(x["type"] == "redeem" for x in e))                          # stocks money is never income

        g = self.new(name="Gold", inv_type="gold")
        gid = g["account"]["id"]
        for paid in ("60000", "40000"):
            self.c.post(f"/api/investments/{gid}/items", json={"description": "coin", "grams": "8", "purity": "99.9",
                                                               "total_paid": paid, "date": TODAY,
                                                               "paid_from_account_id": self.bank})
        g = self.close(gid, date=TODAY, amount="110000", to_account_id=self.bank)
        self.assertEqual(sorted(i["sold_amount"] for i in g["summary"]["items"]), [44000, 66000])
        self.assertEqual(g["summary"]["realised_gain"], 10000)
        g = self.c.post(f"/api/investments/{gid}/reopen").get_json()
        self.assertTrue(all(i["sold_date"] is None for i in g["summary"]["items"]))
        self.assertEqual(g["transactions"], 2)

        o = self.new(name="Chit", inv_type="chitty", opening_balance="5000", opening_date=TODAY)
        g = self.close(o["account"]["id"], date=TODAY, amount="0")                       # nothing came back
        self.assertIsNone(g["details"]["close_entry_id"])
        self.assertFalse(g["account"]["active"])

    def test_rd_due_day_and_next_due(self):
        start = date.today().replace(day=1) - timedelta(days=40)          # some day ~2 months back
        start = start.replace(day=3)
        rd = self.new(name="RD", inv_type="rd", amount="1000", rate="6.7", start_date=start.isoformat(),
                      term_years=1, term_months=0, due_day=10)
        rid = rd["account"]["id"]
        self.assertEqual(rd["details"]["due_day"], 10)
        self.assertEqual(rd["summary"]["next_due"], start.replace(day=10).isoformat())   # first instalment
        for k in range(3):                                                     # pay three
            self.c.post(f"/api/investments/{rid}/funds", json={"amount": "1000", "date": TODAY, "from_account_id": self.bank})
        s = self.c.get(f"/api/investments/{rid}").get_json()["summary"]
        m = start.month + 3
        y = start.year + (m - 1) // 12
        self.assertEqual(s["next_due"], date(y, (m - 1) % 12 + 1, 10).isoformat())
        ov = self.c.get("/api/investments").get_json()
        self.assertEqual(ov["items"][0]["next_due"], s["next_due"])
        self.assertTrue(any(u["kind"] == "rd_due" for u in ov["upcoming"]))
        self.new(status=400, name="RD2", inv_type="rd", amount="1000", rate="6.7", start_date=TODAY,
                 term_months=12, due_day=32)
        d = self.new(name="RD3", inv_type="rd", amount="1000", rate="6.7", start_date="2026-01-31", term_months=12)
        self.assertEqual(d["details"]["due_day"], 31)                         # default: the start date's day
        self.assertEqual(d["summary"]["next_due"], "2026-01-31")

    def test_gold_purchase_fields(self):
        g = self.new(name="Gold coins", inv_type="gold")
        gid = g["account"]["id"]
        r = self.c.post(f"/api/investments/{gid}/items", json={
            "date": TODAY, "total_paid": "73500", "rate": "7350", "grams": "10", "bill_name": "Anjali",
            "paid_from_account_id": self.bank, "doc": "INV-2291 / UPI 4471", "note": "Diwali"})
        self.assertEqual(r.status_code, 201, r.get_json())
        it = r.get_json()["summary"]["items"][0]
        self.assertEqual((it["bill_name"], it["doc"], it["note"], it["purity"], it["description"]),
                         ("Anjali", "INV-2291 / UPI 4471", "Diwali", 99.9, "10 g"))
        self.assertEqual(it["rate"], 7350)
        self.assertEqual(self.bank_balance(), -73500)
        e = self.c.get("/api/entries?month=").get_json()["items"][0]
        self.assertIn("Anjali", e["note"])


    def test_gold_created_with_first_purchase(self):
        g = self.new(name="Gold coins", inv_type="gold", first_item={
            "date": TODAY, "total_paid": "73500", "rate": "7350", "grams": "10", "bill_name": "Anjali",
            "paid_from_account_id": self.bank, "doc": "INV-1", "note": ""})
        self.assertEqual(len(g["summary"]["items"]), 1)
        self.assertEqual(g["summary"]["grams"], 10)
        self.assertEqual(self.bank_balance(), -73500)
        # a bad purchase leaves nothing behind
        self.new(status=400, name="Silver", inv_type="silver", first_item={"date": TODAY, "total_paid": "500", "grams": "x"})
        names = [i["name"] for i in self.c.get("/api/investments").get_json()["items"]]
        self.assertEqual(names, ["Gold coins"])


    def test_gold_tree_scheme(self):
        tree = self.types()["Gold Tree"]
        self.assertTrue(tree["scheme"])
        self.assertFalse(self.types()["Gold Coin"]["scheme"])
        start = date.today().replace(day=1) - timedelta(days=45)          # started ~2 months ago
        start = start.replace(day=5)
        self.new(status=400, name="GT", type_id=tree["id"], scheme=1, start_date=start.isoformat(), term_months=12)
        g = self.new(name="GT - Bhima", type_id=tree["id"], scheme=1, amount="4000", start_date=start.isoformat(),
                     term_years=1, term_months=0)
        gid = g["account"]["id"]
        d, s = g["details"], g["summary"]
        self.assertEqual((d["term_months"], d["due_day"], d["amount"]), (12, 5, 4000))
        self.assertEqual(d["maturity_date"], date(start.year + 1, start.month, 5).isoformat())
        self.assertEqual((s["paid_instalments"], s["next_due"]), (0, start.isoformat()))
        self.assertGreaterEqual(s["missed_instalments"], 2)
        # pay the first two months (old ones: already paid), then this month from the bank
        for k, dt in enumerate([start, start.replace(day=20) + timedelta(days=20)]):
            self.c.post(f"/api/investments/{gid}/items", json={"date": dt.isoformat(), "total_paid": "4000", "rate": "7000",
                                                             "grams": "0.571", "purity": "91.6"})
        self.c.post(f"/api/investments/{gid}/items", json={"date": TODAY, "total_paid": "4000", "rate": "7350",
                                                         "grams": "0.544", "purity": "91.6", "paid_from_account_id": self.bank})
        s = self.c.get(f"/api/investments/{gid}").get_json()["summary"]
        self.assertEqual(s["paid_instalments"], 3)
        self.assertEqual(s["missed_instalments"], 0)
        self.assertEqual(s["grams"], round(0.571 * 2 + 0.544, 3))
        ov = self.c.get("/api/investments").get_json()
        item = next(i for i in ov["items"] if i["id"] == gid)
        self.assertEqual((item["instalment"], item["next_due"]), (4000, s["next_due"]))
        # a plain Gold Coin is not a scheme
        c = self.new(name="Coins", inv_type="gold")
        self.assertNotIn("scheme", c["summary"])
        self.assertIsNone(c["details"]["term_months"])


    def test_gold_tree_started_earlier(self):
        tree = self.types()["Gold Tree"]
        start = (date.today().replace(day=1) - timedelta(days=100)).replace(day=1)       # ~4 months ago
        base = dict(type_id=tree["id"], scheme=1, amount="4000", start_date=start.isoformat(), term_months=11)
        self.new(status=400, name="X", prepaid_instalments=12, **base)                    # more than 11
        g = self.new(name="GT-Anjali", prepaid_instalments=3, opening_grams="1.62", **base)
        s = g["summary"]
        self.assertEqual(g["details"]["prepaid_instalments"], 3)
        self.assertEqual(s["paid_instalments"], 3)
        self.assertEqual(s["invested"], 12000)                                    # 3 x 4000 when not given
        self.assertEqual(s["grams"], 1.62)
        self.assertEqual(self.bank_balance(), 0)                                  # paid before: no bank payment
        self.assertEqual(s["next_due"], (date(start.year + (start.month + 2) // 12, (start.month + 2) % 12 + 1, 1)).isoformat())
        # editing the count later
        r = self.c.put(f"/api/investments/{g['account']['id']}", json={"prepaid_instalments": "4"})
        self.assertEqual(r.get_json()["summary"]["paid_instalments"], 4)


    def test_rd_instalments_already_paid(self):
        start = (date.today().replace(day=1) - timedelta(days=200)).replace(day=8)     # ~7 months back
        rd = self.new(name="SBI Life", inv_type="rd", amount="500", rate="6.25", start_date=start.isoformat(),
                      term_years=1, term_months=0, due_day=8, opening_balance="8", opening_date=TODAY)   # old form's ₹8
        rid = rd["account"]["id"]
        self.assertEqual(rd["opening_balance"], 0)                 # RDs no longer take a rupee amount here
        r = self.c.put(f"/api/investments/{rid}", json={"prepaid_instalments": "7"})
        self.assertEqual(r.status_code, 200, r.get_json())
        g = r.get_json()
        self.assertEqual((g["details"]["prepaid_instalments"], g["opening_balance"]), (7, 3500))
        s = g["summary"]
        self.assertEqual((s["paid_instalments"], s["invested"]), (7, 3500))
        self.assertGreater(s["value"], 3500)
        self.assertEqual(self.bank_balance(), 0)                   # paid before: not from the bank
        self.new(status=400, name="RD2", inv_type="rd", amount="500", rate="6", start_date=TODAY, term_months=12,
                 prepaid_instalments=13)
        n = self.new(name="RD3", inv_type="rd", amount="1000", rate="6", start_date=start.isoformat(), term_months=12,
                     prepaid_instalments=2)
        self.assertEqual((n["opening_balance"], n["summary"]["paid_instalments"]), (2000, 2))


    def test_chit_fund_like_rd(self):
        start = (date.today().replace(day=1) - timedelta(days=100)).replace(day=10)     # ~4 months back
        base = dict(inv_type="chitty", scheme=1, institution="KSFE", amount="5000", start_date=start.isoformat(),
                    term_years=3, term_months=4, due_day=10)
        self.new(status=400, name="Chit", **{**base, "amount": ""})
        c = self.new(name="KSFE Chit", prepaid_instalments=3, opening_paid="13800", **base)   # dividends lowered some
        cid = c["account"]["id"]
        d, s = c["details"], c["summary"]
        self.assertEqual((d["term_months"], d["prepaid_instalments"], d["rate"]), (40, 3, None))
        self.assertEqual((c["opening_balance"], s["invested"], s["paid_instalments"]), (13800, 13800, 3))
        self.assertEqual(self.bank_balance(), 0)
        self.c.post(f"/api/investments/{cid}/funds", json={"amount": "4600", "date": TODAY, "from_account_id": self.bank})
        s = self.c.get(f"/api/investments/{cid}").get_json()["summary"]
        self.assertEqual((s["paid_instalments"], s["invested"]), (4, 18400))
        self.assertEqual(len(s["deposits"]), 1)
        self.assertIn("next_due", s)
        # editing without changing the count keeps the real amount paid
        r = self.c.put(f"/api/investments/{cid}", json={"notes": "Thrissur branch"}).get_json()
        self.assertEqual(r["opening_balance"], 13800)
        # a simple chit fund (older way) still works
        simple = self.new(name="Old chit", inv_type="chitty", opening_balance="10000", opening_date=TODAY)
        self.assertNotIn("scheme", simple["summary"])


    def test_gold_tree_count_only_then_grams(self):
        tree = self.types()["Gold Tree"]
        start = (date.today().replace(day=1) - timedelta(days=60)).replace(day=27)
        g = self.new(name="GT-Anjali", type_id=tree["id"], scheme=1, amount="4000", start_date=start.isoformat(),
                     term_months=11, prepaid_instalments=3)
        gid = g["account"]["id"]
        s = g["summary"]
        self.assertEqual((s["paid_instalments"], s["invested"], s["grams"], s["paid_before"]), (3, 12000, 0, 12000))
        r = self.c.put(f"/api/investments/{gid}", json={"opening_grams": "1.62", "opening_paid": "12100"}).get_json()
        s = r["summary"]
        self.assertEqual((s["grams"], s["invested"], r["opening_balance"]), (1.62, 12100, 12100))
        self.assertEqual(self.bank_balance(), 0)
        # closing gives back everything put in, including what was paid before
        self.c.post(f"/api/investments/{gid}/items", json={"date": TODAY, "total_paid": "4000", "rate": "7350",
                                                         "grams": "0.544", "purity": "91.6", "paid_from_account_id": self.bank})
        c = self.c.post(f"/api/investments/{gid}/close", json={"date": TODAY, "amount": "17000", "to_account_id": self.bank}).get_json()
        e = next(x for x in self.c.get("/api/entries?month=").get_json()["items"] if x["type"] == "redeem")
        self.assertEqual(e["gain"], 17000 - 16100)


if __name__ == "__main__":
    unittest.main()
