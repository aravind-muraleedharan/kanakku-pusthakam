"""Monthly Budget.   python3 -m unittest discover tests -v"""
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
from backend.services import budget  # noqa: E402
from backend.services.investments import add_months  # noqa: E402
from backend.services.reports import shift_month  # noqa: E402
from tests.test_api import login  # noqa: E402

TODAY = date.today()
CUR = TODAY.strftime("%Y-%m")
NEXT, NEXT2 = shift_month(CUR, 1), shift_month(CUR, 2)


class BudgetTest(unittest.TestCase):
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

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, kind, name, status=201):
        r = self.c.post("/api/budget/items", json={"kind": kind, "name": name})
        self.assertEqual(r.status_code, status, r.get_json())
        g = r.get_json()
        return next(i["id"] for i in g[kind] if i["name"] == name) if status == 201 else None

    def put(self, month, items, status=200):
        r = self.c.put(f"/api/budget/{month}", json={"items": items})
        self.assertEqual(r.status_code, status, r.get_json())
        return r.get_json()

    def col(self, g, month):
        return next(c for c in g["months"] if c["month"] == month)

    def test_starts_empty_with_the_next_two_months(self):
        g = self.c.get("/api/budget").get_json()
        self.assertEqual((g["income"], g["expense"]), ([], []))
        self.assertEqual([c["month"] for c in g["months"]], [NEXT, NEXT2])
        self.assertFalse(self.col(g, NEXT)["running"])
        # budget items are separate from the app's categories
        cats = [c["name"] for c in self.c.get("/api/masters").get_json()["categories"]]
        self.add("expense", "Amma")
        self.assertNotIn("Amma", [c["name"] for c in self.c.get("/api/masters").get_json()["categories"]])
        self.assertEqual(len(cats), len(self.c.get("/api/masters").get_json()["categories"]))
        # validation
        self.add("expense", "amma", status=400)                        # same name (any case)
        self.add("expense", "   ", status=400)
        self.add("other", "X", status=400)
        self.assertEqual(self.c.post("/api/budget/items", json={"kind": "income", "name": {"x": 1}}).status_code, 400)
        self.put(CUR, [], status=400)                                  # this month isn't in the plan
        self.put(shift_month(CUR, 3), [], status=400)
        self.put("2026-13", [], status=400)

    def test_amounts_done_sufficient_or_short(self):
        sal, rent, milk = self.add("income", "Salary"), self.add("expense", "House rent"), self.add("expense", "Milk")
        g = self.put(NEXT, [{"item_id": sal, "amount": "50,000"}, {"item_id": rent, "amount": "16000"},
                            {"item_id": milk, "amount": "1000", "note": "daily"}])
        c = self.col(g, NEXT)
        self.assertEqual((c["income"], c["expense"], c["paid"], c["still_to_pay"], c["balance"]), (50000, 17000, 0, 17000, 33000))
        g = self.put(NEXT, [{"item_id": rent, "done": True}])
        c = self.col(g, NEXT)
        self.assertEqual((c["paid"], c["still_to_pay"], c["done"], c["items"]), (16000, 1000, 1, 2))
        rent_cell = next(i for i in g["expense"] if i["id"] == rent)["cells"][NEXT]
        self.assertEqual((rent_cell["amount"], rent_cell["done"]), (16000, True))     # ticking keeps the amount
        self.assertEqual(next(i for i in g["expense"] if i["id"] == milk)["cells"][NEXT]["note"], "daily")
        self.put(NEXT, [{"item_id": sal, "done": True}], status=400)                   # only payments are ticked
        g = self.put(NEXT, [{"item_id": rent, "amount": "60000"}])                     # now short
        self.assertEqual(self.col(g, NEXT)["balance"], -11000)
        self.put(NEXT, [{"item_id": rent, "amount": "-1"}], status=400)
        self.put(NEXT, [{"item_id": rent, "amount": "1e5"}], status=400)
        self.put(NEXT, [{"item_id": 9999, "amount": "1"}], status=404)

    def test_copy_clear_rename_delete_item(self):
        sal, rent = self.add("income", "Salary"), self.add("expense", "House rent")
        self.put(NEXT, [{"item_id": sal, "amount": "50000"}, {"item_id": rent, "amount": "16000", "note": "Nov", "done": 1}])
        g = self.c.post(f"/api/budget/{NEXT2}/copy", json={"from": NEXT}).get_json()
        cell = next(i for i in g["expense"] if i["id"] == rent)["cells"][NEXT2]
        self.assertEqual((cell["amount"], cell["note"], cell["done"]), (16000, "Nov", False))     # ticks start empty
        self.assertEqual(self.col(g, NEXT2)["copy_from"], NEXT)
        g = self.c.post(f"/api/budget/{NEXT}/clear").get_json()                                  # clear: emptied, stays
        self.assertEqual((self.col(g, NEXT)["income"], self.col(g, NEXT)["has_data"]), (0, False))
        self.assertEqual(self.col(g, NEXT2)["income"], 50000)                                      # the other stays
        self.assertEqual(self.c.post(f"/api/budget/{NEXT2}/copy", json={"from": NEXT}).status_code, 400)  # nothing to copy
        r = self.c.put(f"/api/budget/items/{rent}", json={"name": "Rent"})
        self.assertEqual(next(i for i in r.get_json()["expense"] if i["id"] == rent)["name"], "Rent")
        g = self.c.delete(f"/api/budget/items/{rent}").get_json()
        self.assertEqual(g["expense"], [])
        self.assertEqual(self.col(g, NEXT2)["expense"], 0)

    def test_add_and_delete_months(self):
        sal = self.add("income", "Salary")
        self.put(NEXT2, [{"item_id": sal, "amount": "50000"}])
        g = self.c.delete(f"/api/budget/{NEXT2}").get_json()                       # delete: the column goes
        self.assertEqual([c["month"] for c in g["months"]], [NEXT])
        self.assertIn(NEXT2, g["can_add"])
        g = self.c.post("/api/budget/months", json={"month": NEXT2}).get_json()     # back, and empty
        self.assertEqual(self.col(g, NEXT2)["income"], 0)
        third = shift_month(CUR, 3)
        g = self.c.post("/api/budget/months", json={"month": third}).get_json()
        self.assertEqual([c["month"] for c in g["months"]], [NEXT, NEXT2, third])
        self.assertEqual(g["can_add"], [])                                          # three is the most
        self.assertEqual(self.c.post("/api/budget/months", json={"month": CUR}).status_code, 400)
        self.c.delete(f"/api/budget/{third}")
        for bad in (NEXT, shift_month(CUR, -1), shift_month(CUR, 7), "2026-13", None):  # shown, past, too far, junk
            self.assertEqual(self.c.post("/api/budget/months", json={"month": bad}).status_code, 400, bad)
        self.assertEqual(self.c.post("/api/budget/months", json={"month": CUR}).status_code, 201)  # this month is fine
        self.assertEqual(self.c.delete(f"/api/budget/{shift_month(CUR, 5)}").status_code, 400)       # not in the plan

    def test_running_month_stays_until_it_ends(self):
        sal = self.add("income", "Salary")
        self.put(NEXT, [{"item_id": sal, "amount": "50000"}])
        with self.app.app_context():
            later = add_months(TODAY.replace(day=1), 1).replace(day=10)          # next month has begun
            self.assertEqual(budget.months(later), [NEXT, NEXT2])
            g = budget.sheet(later)
            self.assertTrue(g["months"][0]["running"])
            self.assertEqual(g["months"][0]["days"], (add_months(later.replace(day=1), 1) - later).days - 1)
            budget.delete_month(NEXT, later)
            self.assertEqual(budget.months(later), [NEXT2])


if __name__ == "__main__":
    unittest.main()
