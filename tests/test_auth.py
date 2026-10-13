"""Login, authenticator (MFA), lockout, password reset and session tests."""
import os
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
try:
    import flask  # noqa: F401
except ImportError:
    sys.path.insert(1, os.path.join(ROOT, "vendor", "flask-bundle.zip"))

from backend import create_app  # noqa: E402
from backend.services import mailer, totp  # noqa: E402

EMAIL, PASSWORD = "me@example.com", "Correct-horse-42"


def code(secret, offset=0):
    return totp.code_at(secret, totp.current_step() + offset)


class AuthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({
            "TESTING": True,
            "DB_PATH": os.path.join(self.tmp.name, "t.db"),
            "BACKUP_DIR": os.path.join(self.tmp.name, "b"),
            "SECRET_KEY": b"test-secret-key-test-secret-key!",
        })
        self.c = self.new_client()
        self.sent = []
        self._orig_send, self._orig_conf = mailer.send, mailer.is_configured
        mailer.send = lambda to, subject, text: self.sent.append((to, subject, text))

    def tearDown(self):
        mailer.send, mailer.is_configured = self._orig_send, self._orig_conf
        self.tmp.cleanup()

    def new_client(self):
        c = self.app.test_client()
        c.environ_base["HTTP_X_REQUESTED_WITH"] = "KanakkuPusthakam"
        return c

    def state(self, c=None):
        return (c or self.c).get("/api/auth/status").get_json()["state"]

    def register(self):
        r = self.c.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "confirm": PASSWORD})
        self.assertEqual(r.status_code, 201, r.get_json())
        secret = self.c.post("/api/auth/mfa/begin").get_json()["secret"]
        self.assertEqual(self.c.post("/api/auth/mfa/confirm", json={"code": code(secret)}).status_code, 200)
        return secret

    def login(self, c, password=PASSWORD, secret=None, offset=0):
        r = c.post("/api/auth/login", json={"email": EMAIL, "password": password})
        if r.status_code != 200 or secret is None:
            return r
        return c.post("/api/auth/login/code", json={"code": code(secret, offset)})

    # ------------------------------------------------------------------
    def test_first_run_and_data_protected(self):
        self.assertEqual(self.state(), "no_account")
        self.assertEqual(self.c.get("/api/entries").status_code, 401)
        # weak password / mismatch rejected
        self.assertEqual(self.c.post("/api/auth/register", json={"email": EMAIL, "password": "short", "confirm": "short"}).status_code, 400)
        self.assertEqual(self.c.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "confirm": "x"}).status_code, 400)
        r = self.c.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "confirm": PASSWORD})
        self.assertEqual(r.get_json()["state"], "mfa_setup")
        # password alone is not enough to see data
        self.assertEqual(self.c.get("/api/entries").status_code, 401)
        begin = self.c.post("/api/auth/mfa/begin").get_json()
        self.assertTrue(begin["uri"].startswith("otpauth://totp/Kanakku"))
        self.assertEqual(self.c.post("/api/auth/mfa/confirm", json={"code": "000000"}).status_code, 400)
        self.assertEqual(self.c.post("/api/auth/mfa/confirm", json={"code": code(begin["secret"])}).get_json()["state"], "ok")
        self.assertEqual(self.c.get("/api/entries").status_code, 200)
        # only one account
        self.assertEqual(self.c.post("/api/auth/register", json={"email": "x@y.com", "password": PASSWORD, "confirm": PASSWORD}).status_code, 409)

    def test_login_needs_password_and_code(self):
        secret = self.register()
        c = self.new_client()
        self.assertEqual(self.login(c, password="wrong-password-1").status_code, 401)
        r = c.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        self.assertEqual(r.get_json()["state"], "mfa")
        self.assertEqual(c.get("/api/entries").status_code, 401)
        self.assertEqual(c.post("/api/auth/login/code", json={"code": "123456"}).status_code, 401)
        good = code(secret, 1)       # next step (clock drift allowed)
        self.assertEqual(c.post("/api/auth/login/code", json={"code": good}).get_json()["state"], "ok")
        self.assertEqual(c.get("/api/entries").status_code, 200)
        # the same code can't be replayed on another login
        c2 = self.new_client()
        c2.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        self.assertEqual(c2.post("/api/auth/login/code", json={"code": good}).status_code, 401)

    def test_lockout_after_five_failures(self):
        secret = self.register()
        c = self.new_client()
        for _ in range(4):
            self.assertEqual(self.login(c, password="wrong-password-1").status_code, 401)
        self.assertEqual(self.login(c, password="wrong-password-1").status_code, 429)
        # even the right password is refused while locked
        self.assertEqual(self.login(c, secret=secret).status_code, 429)

    def test_logout(self):
        self.register()
        self.assertEqual(self.c.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.c.get("/api/entries").status_code, 401)
        self.assertEqual(self.state(), "logged_out")

    def test_csrf_header_required(self):
        self.register()
        raw = self.app.test_client()
        with self.c.session_transaction() as s:
            cookie_session = dict(s)
        with raw.session_transaction() as s:
            s.update(cookie_session)
        self.assertEqual(raw.post("/api/system/backups").status_code, 400)

    def test_only_answers_on_this_computer(self):
        # DNS rebinding: a web page's own name pointed at 127.0.0.1 must not reach the app
        for host in ("evil.example", "evil.example:5000", "127.0.0.1.evil.example"):
            r = self.c.get("/api/auth/status", headers={"Host": host})
            self.assertEqual(r.status_code, 403, host)
            self.assertEqual(self.c.get("/", headers={"Host": host}).status_code, 403, host)
        for host in ("127.0.0.1:5000", "localhost:9999", "[::1]:5000", "localhost"):
            self.assertEqual(self.c.get("/api/auth/status", headers={"Host": host}).status_code, 200, host)

    def test_data_files_private(self):
        mode = lambda p: os.stat(p).st_mode & 0o777
        self.assertEqual(mode(self.tmp.name + "/t.db"), 0o600)
        self.assertEqual(mode(self.tmp.name + "/b"), 0o700)

    def test_idle_timeout(self):
        self.register()
        with self.c.session_transaction() as s:
            s["last"] = int(time.time()) - 31 * 60
        self.assertEqual(self.c.get("/api/entries").status_code, 401)

    def test_forgot_password_by_email(self):
        secret = self.register()
        anon = self.new_client()
        # email not configured -> clear message pointing to the terminal reset
        r = anon.post("/api/auth/forgot", json={"email": EMAIL})
        self.assertEqual(r.status_code, 400)
        self.assertIn("--reset-password", r.get_json()["error"])
        mailer.is_configured = lambda: True
        # unknown email: same generic answer, nothing sent
        r = anon.post("/api/auth/forgot", json={"email": "someone@else.com"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sent, [])
        r = anon.post("/api/auth/forgot", json={"email": EMAIL.upper()})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(self.sent), 1)
        text = self.sent[0][2]
        token = text.split("#/reset?token=")[1].split()[0]
        self.assertEqual(anon.post("/api/auth/reset/check", json={"token": token}).status_code, 200)
        self.assertEqual(anon.post("/api/auth/reset/check", json={"token": "bogus"}).status_code, 400)
        new = "Brand-new-pass-77"
        self.assertEqual(anon.post("/api/auth/reset", json={"token": token, "password": new, "confirm": new}).status_code, 200)
        # link works once
        self.assertEqual(anon.post("/api/auth/reset", json={"token": token, "password": new, "confirm": new}).status_code, 400)
        # the old logged-in session is signed out; old password no longer works
        self.assertEqual(self.c.get("/api/entries").status_code, 401)
        self.assertEqual(self.login(self.new_client(), secret=secret).status_code, 401)
        # new password + authenticator code works
        self.assertEqual(self.login(self.new_client(), password=new, secret=secret, offset=1).status_code, 200)

    def test_change_password_keeps_this_session(self):
        secret = self.register()
        other = self.new_client()
        self.login(other, secret=secret, offset=1)
        new = "Another-pass-99"
        r = self.c.post("/api/auth/password", json={"current": "nope", "new": new, "confirm": new})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/auth/password", json={"current": PASSWORD, "new": new, "confirm": new})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get("/api/entries").status_code, 200)
        self.assertEqual(other.get("/api/entries").status_code, 401)

    def test_mail_settings_hide_password(self):
        self.register()
        r = self.c.put("/api/auth/mail-settings", json={"smtp_host": "mail.example.invalid", "smtp_port": 587,
                                                         "smtp_user": EMAIL, "smtp_password": "FAKE-test-value"})
        body = r.get_json()
        self.assertTrue(body["configured"])
        self.assertTrue(body["password_set"])
        self.assertNotIn("smtp_password", body)
        self.assertNotIn("FAKE-test", str(self.c.get("/api/auth/security").get_json()))

    def test_terminal_reset_mfa(self):
        from backend import db
        from backend.services import auth
        self.register()
        conn = db.connect(self.app.config["DB_PATH"])
        auth.cli_reset_mfa(conn)
        conn.close()
        self.assertEqual(self.c.get("/api/entries").status_code, 401)
        r = self.new_client().post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        self.assertEqual(r.get_json()["state"], "mfa_setup")

    def test_totp_known_vector(self):
        # RFC 6238 test secret "12345678901234567890" at T=59s -> 287082 (6-digit SHA1)
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        self.assertEqual(totp.code_at(secret, 59 // 30), "287082")


if __name__ == "__main__":
    unittest.main()
