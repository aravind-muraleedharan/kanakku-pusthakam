"""Backup to a folder and restore from a file.   python3 -m unittest discover tests -v"""
import io
import os
import sqlite3
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
from tests.test_api import PASSWORD, login  # noqa: E402


def _read(path):
    with open(path, "rb") as fh:
        return fh.read()


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = os.path.join(self.tmp.name, "pendrive")
        os.makedirs(self.out)
        self.app = create_app({
            "TESTING": True,
            "DB_PATH": os.path.join(self.tmp.name, "data", "test.db"),
            "BACKUP_DIR": os.path.join(self.tmp.name, "backups"),
            "SECRET_KEY": b"test-secret-key-test-secret-key!",
        })
        self.c = self.app.test_client()
        self.c.environ_base["HTTP_X_REQUESTED_WITH"] = "KanakkuPusthakam"
        login(self.c)
        self.bank = self.c.post("/api/masters/accounts", json={"name": "Test Bank", "kind": "bank"}).get_json()["id"]
        self.cat = next(c["id"] for c in self.c.get("/api/masters").get_json()["categories"]
                        if c["kind"] == "expense" and not c["is_system"])

    def tearDown(self):
        self.tmp.cleanup()

    def spend(self, note):
        r = self.c.post("/api/entries", json={"type": "expense", "date": "2026-10-09", "amount": "10",
                                              "category_id": self.cat, "from_account_id": self.bank, "note": note})
        self.assertEqual(r.status_code, 201)

    def notes(self, client=None):
        return sorted(e["note"] for e in (client or self.c).get("/api/entries?month=").get_json()["items"])

    def test_backup_to_folder(self):
        for bad in ("", "relative/folder", os.path.join(self.tmp.name, "missing")):
            self.assertEqual(self.c.post("/api/system/backup-to", json={"path": bad}).status_code, 400, bad)
        r = self.c.post("/api/system/backup-to", json={"path": self.out})
        self.assertEqual(r.status_code, 201, r.get_json())
        f = r.get_json()["file"]
        self.assertTrue(f.startswith(self.out) and os.path.isfile(f))
        con = sqlite3.connect(f)
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        con.close()
        self.assertEqual(self.c.get("/api/system/info").get_json()["backup_folder"], self.out)   # remembered
        named = os.path.join(self.out, "mine.db")
        self.assertEqual(self.c.post("/api/system/backup-to", json={"path": named}).status_code, 201)
        self.assertEqual(self.c.post("/api/system/backup-to", json={"path": named}).status_code, 400)  # never overwrites

    def test_restore_from_uploaded_file(self):
        self.spend("before backup")
        f = self.c.post("/api/system/backup-to", json={"path": self.out}).get_json()["file"]
        self.spend("after backup")
        with open(f, "rb") as fh:
            data = fh.read()
        up = lambda pw: self.c.post("/api/system/restore", content_type="multipart/form-data",
                                    data={"file": (io.BytesIO(data), "backup.db"), "password": pw})
        r = up("wrong-password-1")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.notes(), ["after backup", "before backup"])    # nothing changed
        r = up(PASSWORD)
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertIn("pre-restore", r.get_json()["saved_current_as"])
        self.assertEqual(self.c.get("/api/entries").status_code, 401)        # must log in again
        c2 = self.app.test_client()
        c2.environ_base["HTTP_X_REQUESTED_WITH"] = "KanakkuPusthakam"
        from tests.test_auth import code
        from backend.services import auth as auth_svc
        with self.app.app_context():
            secret = auth_svc.get_user()["totp_secret"]
        c2.post("/api/auth/login", json={"email": "me@example.com", "password": PASSWORD})
        c2.post("/api/auth/login/code", json={"code": code(secret, 1)})
        self.assertEqual(self.notes(c2), ["before backup"])                  # restored

        # the pre-restore copy is listed and can bring the later data back
        names = [b["file"] for b in c2.get("/api/system/backups").get_json()]
        pre = next(n for n in names if "pre-restore" in n)
        r = c2.post("/api/system/restore-backup", json={"file": pre, "password": PASSWORD})
        self.assertEqual(r.status_code, 200, r.get_json())

    def test_restore_rejects_bad_files(self):
        def up(blob):
            return self.c.post("/api/system/restore", content_type="multipart/form-data",
                               data={"file": (io.BytesIO(blob), "x.db"), "password": PASSWORD})
        self.assertEqual(up(b"not a database at all").status_code, 400)
        other = os.path.join(self.tmp.name, "other.db")
        con = sqlite3.connect(other)
        con.execute("CREATE TABLE t (x)")
        con.commit()
        con.close()
        self.assertEqual(up(_read(other)).status_code, 400)          # some other app's database
        newer = self.c.post("/api/system/backup-to", json={"path": self.out}).get_json()["file"]
        con = sqlite3.connect(newer)
        con.execute("INSERT INTO schema_version (version, name) VALUES (999, 'future.sql')")
        con.commit(); con.close()
        self.assertEqual(up(_read(newer)).status_code, 400)          # from a newer app version
        for name in ("../data/test.db", "/etc/passwd", "expenses_x.db"):
            r = self.c.post("/api/system/restore-backup", json={"file": name, "password": PASSWORD})
            self.assertEqual(r.status_code, 404, name)
        self.assertEqual(self.c.get("/api/entries").status_code, 200)            # still logged in, data intact


    def test_weekly_auto_backup_and_keep_10(self):
        from backend import db
        bdir = os.path.join(self.tmp.name, "wk")
        dbp = self.app.config["DB_PATH"]
        first = db.weekly_backup(dbp, bdir)
        self.assertTrue(first and first.endswith("_auto.db"))
        self.assertIsNone(db.weekly_backup(dbp, bdir))                 # not again within the week
        old = os.path.getmtime(first) - 8 * 86400
        os.utime(first, (old, old))
        self.assertIsNotNone(db.weekly_backup(dbp, bdir))              # a week later: yes
        # many manual backups: only the newest 10 files stay
        for i in range(14):
            name = os.path.join(bdir, f"expenses_2020-01-{i + 1:02d}_000000_manual.db")
            open(name, "wb").close()
        with self.app.app_context():
            newest = db.backup(db.get_db(), bdir, label="manual")
        files = sorted(os.listdir(bdir))
        self.assertEqual(len(files), 10)
        self.assertIn(os.path.basename(newest), files)
        self.assertNotIn("expenses_2020-01-01_000000_manual.db", files)  # oldest went first

if __name__ == "__main__":
    unittest.main()
