"""/api/auth - account creation, login with authenticator code, logout, password reset, security settings.

Every other /api route requires a fully logged-in session (see `guard`).
"""
import time

from flask import Blueprint, jsonify, request, session

from ..errors import ApiError
from ..services import auth as svc
from ..services import mailer, settings, totp

bp = Blueprint("auth", __name__)

PUBLIC = {
    "/api/auth/status", "/api/auth/register", "/api/auth/login", "/api/auth/login/code",
    "/api/auth/mfa/begin", "/api/auth/mfa/confirm", "/api/auth/logout",
    "/api/auth/forgot", "/api/auth/reset", "/api/auth/reset/check",
}


def _body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the form as JSON")
    return data


def _start(user, stage):
    session.clear()
    session.permanent = True
    session.update(uid=user["id"], pv=user["password_version"], stage=stage, last=int(time.time()))


def current_user(required_stage="ok"):
    """The logged-in user for this request, or None. Ends the session if it is stale."""
    uid = session.get("uid")
    if not uid:
        return None
    user = svc.user_by_id(uid)
    if not user or user["password_version"] != session.get("pv"):
        session.clear()               # password changed/reset elsewhere: log out
        return None
    if session.get("stage") == "ok" and time.time() - session.get("last", 0) > svc.idle_minutes() * 60:
        session.clear()               # idle too long
        return None
    if required_stage and session.get("stage") != required_stage:
        return None
    return user


def guard():
    """Runs before every request (registered in create_app)."""
    path = request.path
    if not path.startswith("/api/"):
        return None
    # CSRF protection: browsers can't add this header to cross-site form posts
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("X-Requested-With") != "KanakkuPusthakam":
        return jsonify({"error": "Missing request header"}), 400
    if path in PUBLIC:
        return None
    user = current_user("ok")
    if not user:
        return jsonify({"error": "Please log in", "auth": True}), 401
    session["last"] = int(time.time())
    return None


def _status_payload():
    user = svc.get_user()
    if not user:
        state = "no_account"
    else:
        current_user(required_stage=None)       # clears a stale session
        stage = session.get("stage") if session.get("uid") else None
        state = {"ok": "ok", "mfa": "mfa", "mfa_setup": "mfa_setup"}.get(stage, "logged_out")
    return {
        "state": state,
        "email": user["email"] if user and state == "ok" else None,
        "email_configured": mailer.is_configured() if user else False,
        "idle_minutes": svc.idle_minutes() if user else None,
    }


@bp.get("/auth/status")
def status():
    return jsonify(_status_payload())


@bp.post("/auth/register")
def register():
    d = _body()
    if d.get("password") != d.get("confirm"):
        raise ApiError("The two passwords don't match", field="confirm")
    user = svc.register(d.get("email"), d.get("password"))
    _start(user, "mfa_setup")
    return jsonify(_status_payload()), 201


@bp.post("/auth/login")
def login():
    d = _body()
    user = svc.check_login(d.get("email"), d.get("password"))
    _start(user, "mfa" if user["totp_secret"] else "mfa_setup")
    return jsonify(_status_payload())


@bp.post("/auth/login/code")
def login_code():
    user = current_user("mfa")
    if not user:
        raise ApiError("Your login expired. Enter your password again.", status=401)
    svc.check_code(user, _body().get("code"))
    session["stage"] = "ok"
    session["last"] = int(time.time())
    return jsonify(_status_payload())


@bp.post("/auth/mfa/begin")
def mfa_begin():
    """New authenticator secret: during first setup, or from Settings when logged in (re-pairing a new phone)."""
    user = current_user("mfa_setup") or current_user("ok")
    if not user:
        raise ApiError("Please log in", status=401)
    secret = totp.new_secret()
    session["pending_secret"] = secret
    return jsonify({"secret": secret, "uri": totp.otpauth_uri(secret, user["email"])})


@bp.post("/auth/mfa/confirm")
def mfa_confirm():
    user = current_user("mfa_setup") or current_user("ok")
    secret = session.get("pending_secret")
    if not user or not secret:
        raise ApiError("Start the authenticator setup again", status=400)
    svc.enable_totp(user, secret, _body().get("code"))
    session.pop("pending_secret", None)
    session["stage"] = "ok"
    session["last"] = int(time.time())
    return jsonify(_status_payload())


@bp.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"state": "logged_out"})


@bp.post("/auth/forgot")
def forgot():
    msg = svc.request_reset(_body().get("email"), request.host_url)
    return jsonify({"message": msg})


@bp.post("/auth/reset/check")
def reset_check():
    svc.check_reset_token(_body().get("token"))
    return jsonify({"valid": True})


@bp.post("/auth/reset")
def reset():
    d = _body()
    if d.get("password") != d.get("confirm"):
        raise ApiError("The two passwords don't match", field="confirm")
    svc.reset_password(d.get("token"), d.get("password"))
    session.clear()
    return jsonify({"message": "Password changed. Log in with your new password and your authenticator code."})


# ---------------------------------------------------------------- logged-in security settings

@bp.get("/auth/security")
def security():
    user = current_user("ok")
    return jsonify({
        "email": user["email"],
        "last_login_at": user["last_login_at"],
        "idle_minutes": svc.idle_minutes(),
        "mail": mailer.public_config(),
    })


@bp.post("/auth/password")
def change_password():
    d = _body()
    if d.get("new") != d.get("confirm"):
        raise ApiError("The two new passwords don't match", field="confirm")
    user = current_user("ok")
    svc.change_password(user, d.get("current"), d.get("new"))
    fresh = svc.user_by_id(user["id"])
    session["pv"] = fresh["password_version"]       # keep this session, log out others
    return jsonify({"message": "Password changed"})


@bp.put("/auth/email")
def change_email():
    d = _body()
    user = current_user("ok")
    from werkzeug.security import check_password_hash
    if not check_password_hash(user["password_hash"], d.get("password") or ""):
        raise ApiError("Password is incorrect", field="password")
    email = (d.get("email") or "").strip()
    if not svc.EMAIL_RE.match(email):
        raise ApiError("Enter a valid email address", field="email")
    from ..db import get_db
    get_db().execute("UPDATE users SET email = ? WHERE id = ?", (email, user["id"]))
    get_db().commit()
    return jsonify({"email": email})


@bp.put("/auth/mail-settings")
def mail_settings():
    return jsonify(mailer.save_config(_body()))


@bp.post("/auth/mail-settings/test")
def mail_test():
    user = current_user("ok")
    mailer.send(user["email"], "Kanakku Pusthakam: test email",
                "Email is working. Password reset links for Kanakku Pusthakam will arrive like this.\n")
    return jsonify({"message": f"Test email sent to {user['email']}"})


@bp.put("/auth/idle")
def idle():
    try:
        mins = int(_body().get("minutes"))
    except (TypeError, ValueError):
        raise ApiError("Enter minutes as a number", field="minutes")
    if not 5 <= mins <= 1440:
        raise ApiError("Choose between 5 and 1440 minutes", field="minutes")
    settings.set_many({"idle_minutes": str(mins)})
    return jsonify({"idle_minutes": mins})
