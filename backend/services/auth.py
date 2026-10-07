"""Login, authenticator (MFA), lockout and password reset.

Session stages (stored in Flask's signed session cookie):
  mfa_setup  password ok, authenticator not set up yet  -> must scan QR + confirm a code
  mfa        password ok, waiting for the 6-digit code
  ok         fully logged in
"""
import hashlib
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from ..db import get_db, one
from ..errors import ApiError
from . import mailer, settings, totp

MIN_PASSWORD = 10
MAX_FAILURES = 5
LOCK_MINUTES = 5
RESET_MINUTES = 30
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# a real hash to compare against when the email is unknown, so timing doesn't reveal it
_DUMMY_HASH = generate_password_hash("not-a-real-password", method="scrypt")


def _utcnow():
    return datetime.now(timezone.utc).replace(microsecond=0)


def _iso(dt):
    return dt.isoformat()


def hash_password(pw):
    return generate_password_hash(pw, method="scrypt")


def check_password_rules(pw):
    if not isinstance(pw, str) or len(pw) < MIN_PASSWORD:
        raise ApiError(f"Password must be at least {MIN_PASSWORD} characters", field="password")
    if len(pw) > 200:
        raise ApiError("Password is too long", field="password")
    if pw.isdigit() or pw.lower() == pw and pw.isalpha():
        raise ApiError("Use a mix of letters and numbers or symbols", field="password")


def get_user():
    return one("SELECT * FROM users ORDER BY id LIMIT 1")


def user_by_id(uid):
    return one("SELECT * FROM users WHERE id = ?", (uid,))


def has_user():
    return get_user() is not None


# ---------------------------------------------------------------- lockout

def _check_lock(user):
    if user["locked_until"]:
        until = datetime.fromisoformat(user["locked_until"])
        if until > _utcnow():
            mins = max(1, int((until - _utcnow()).total_seconds() // 60) + 1)
            raise ApiError(f"Too many wrong attempts. Try again in {mins} minute{'s' if mins > 1 else ''}.", status=429)


def _fail(user):
    n = user["failed_attempts"] + 1
    locked = _iso(_utcnow() + timedelta(minutes=LOCK_MINUTES)) if n >= MAX_FAILURES else None
    get_db().execute("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
                     (0 if locked else n, locked, user["id"]))
    get_db().commit()
    if locked:
        raise ApiError(f"Too many wrong attempts. Locked for {LOCK_MINUTES} minutes.", status=429)


def _succeed(user, step=None):
    sql = "UPDATE users SET failed_attempts = 0, locked_until = NULL"
    params = []
    if step is not None:
        sql += ", totp_last_step = ?, last_login_at = datetime('now','localtime')"
        params.append(step)
    get_db().execute(sql + " WHERE id = ?", params + [user["id"]])
    get_db().commit()


# ---------------------------------------------------------------- account

def register(email, password):
    if has_user():
        raise ApiError("An account already exists. Please log in.", status=409)
    email = (email or "").strip()
    if not EMAIL_RE.match(email):
        raise ApiError("Enter a valid email address", field="email")
    check_password_rules(password)
    conn = get_db()
    cur = conn.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, hash_password(password)))
    conn.commit()
    return user_by_id(cur.lastrowid)


def check_login(email, password):
    user = get_user()
    if not user or (email or "").strip().lower() != user["email"].lower():
        check_password_hash(_DUMMY_HASH, password or "")
        raise ApiError("Email or password is incorrect", status=401)
    _check_lock(user)
    if not check_password_hash(user["password_hash"], password or ""):
        _fail(user)
        raise ApiError("Email or password is incorrect", status=401)
    _succeed(user)
    return user_by_id(user["id"])


def check_code(user, code):
    _check_lock(user)
    step = totp.verify(user["totp_secret"], code, user["totp_last_step"])
    if step is None:
        _fail(user)
        raise ApiError("That code isn't right. Use the current 6-digit code from your authenticator app.", status=401,
                       field="code")
    _succeed(user, step)


def enable_totp(user, secret, code):
    step = totp.verify(secret, code, 0)
    if step is None:
        raise ApiError("That code doesn't match. Check the time on your phone and try the newest code.", field="code")
    get_db().execute("UPDATE users SET totp_secret = ?, totp_last_step = ?, last_login_at = datetime('now','localtime') "
                     "WHERE id = ?", (secret, step, user["id"]))
    get_db().commit()


def change_password(user, current, new):
    if not check_password_hash(user["password_hash"], current or ""):
        raise ApiError("Current password is incorrect", field="current")
    check_password_rules(new)
    _set_password(user["id"], new)


def _set_password(uid, new):
    get_db().execute(
        "UPDATE users SET password_hash = ?, password_version = password_version + 1, failed_attempts = 0, "
        "locked_until = NULL WHERE id = ?", (hash_password(new), uid))
    get_db().commit()


# ---------------------------------------------------------------- password reset by email

def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


_last_forgot = {"t": 0.0}


def request_reset(email, base_url):
    """Email a one-time reset link. Returns a message safe to show either way."""
    generic = "If that email matches your account, a reset link is on its way. It works for 30 minutes."
    user = get_user()
    if not user or (email or "").strip().lower() != user["email"].lower():
        return generic
    if not mailer.is_configured():
        raise ApiError("Email isn't set up in this app, so a reset link can't be sent. "
                       "Reset from the terminal instead: python3 run.py --reset-password", status=400)
    if time.time() - _last_forgot["t"] < 60:
        raise ApiError("A reset email was just sent. Please wait a minute before asking again.", status=429)
    token = secrets.token_urlsafe(32)
    conn = get_db()
    conn.execute("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL",
                 (user["id"],))
    conn.execute("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                 (user["id"], _token_hash(token), _iso(_utcnow() + timedelta(minutes=RESET_MINUTES))))
    conn.commit()
    link = f"{base_url.rstrip('/')}/#/reset?token={token}"
    mailer.send(
        user["email"],
        "Kanakku Pusthakam: reset your password",
        f"Someone (hopefully you) asked to reset the password for Kanakku Pusthakam.\n\n"
        f"Open this link on the computer where Kanakku Pusthakam runs, within {RESET_MINUTES} minutes:\n\n{link}\n\n"
        f"You will still need your authenticator code to log in afterwards.\n"
        f"If you didn't ask for this, ignore this email; your password stays the same.\n",
    )
    _last_forgot["t"] = time.time()
    return generic


def _valid_reset(token):
    r = one("SELECT * FROM password_resets WHERE token_hash = ?", (_token_hash(token or ""),))
    if not r or r["used_at"] or datetime.fromisoformat(r["expires_at"]) < _utcnow():
        raise ApiError("This reset link is invalid or has expired. Ask for a new one.", status=400)
    return r


def check_reset_token(token):
    _valid_reset(token)
    return True


def reset_password(token, new):
    r = _valid_reset(token)
    check_password_rules(new)
    _set_password(r["user_id"], new)
    get_db().execute("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?", (r["id"],))
    get_db().commit()


# ---------------------------------------------------------------- terminal helpers (run.py --reset-*)

def cli_reset_password(conn, new):
    check_password_rules(new)
    n = conn.execute("UPDATE users SET password_hash = ?, password_version = password_version + 1, "
                     "failed_attempts = 0, locked_until = NULL", (hash_password(new),)).rowcount
    conn.commit()
    return n


def cli_reset_mfa(conn):
    n = conn.execute("UPDATE users SET totp_secret = NULL, totp_last_step = 0, password_version = password_version + 1, "
                     "failed_attempts = 0, locked_until = NULL").rowcount
    conn.commit()
    return n


def idle_minutes():
    try:
        return max(5, int(settings.get("idle_minutes", "30")))
    except ValueError:
        return 30
