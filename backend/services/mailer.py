"""Sending email (password reset links) through an SMTP server such as Gmail.

Gmail: host smtp.gmail.com, port 587, security STARTTLS, user = your Gmail address,
password = an *App password* (Google Account -> Security -> 2-Step Verification -> App passwords).
"""
import smtplib
import ssl
from email.message import EmailMessage

from ..errors import ApiError
from . import settings as st

FIELDS = ("smtp_host", "smtp_port", "smtp_security", "smtp_user", "smtp_password", "smtp_from")


def config():
    c = st.get_many(FIELDS)
    c["smtp_port"] = int(c.get("smtp_port") or 587)
    c["smtp_security"] = c.get("smtp_security") or "starttls"
    return c


def is_configured():
    c = config()
    return bool(c.get("smtp_host") and c.get("smtp_user") and c.get("smtp_password"))


def public_config():
    """Settings for the UI - the password is never sent back, only whether it is set."""
    c = config()
    return {
        "smtp_host": c.get("smtp_host") or "",
        "smtp_port": c["smtp_port"],
        "smtp_security": c["smtp_security"],
        "smtp_user": c.get("smtp_user") or "",
        "smtp_from": c.get("smtp_from") or "",
        "password_set": bool(c.get("smtp_password")),
        "configured": is_configured(),
    }


def save_config(data):
    host = (data.get("smtp_host") or "").strip()
    try:
        port = int(data.get("smtp_port") or 587)
    except (TypeError, ValueError):
        raise ApiError("Port must be a number", field="smtp_port")
    security = data.get("smtp_security") or "starttls"
    if security not in ("starttls", "ssl", "none"):
        raise ApiError("Security must be starttls, ssl or none", field="smtp_security")
    values = {
        "smtp_host": host,
        "smtp_port": str(port),
        "smtp_security": security,
        "smtp_user": (data.get("smtp_user") or "").strip(),
        "smtp_from": (data.get("smtp_from") or "").strip(),
    }
    if data.get("smtp_password"):          # blank = keep the saved password
        values["smtp_password"] = data["smtp_password"].replace(" ", "")
    st.set_many(values)
    return public_config()


def send(to, subject, text):
    c = config()
    if not is_configured():
        raise ApiError("Email isn't set up yet (Settings → Security → Email).", status=400)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = c.get("smtp_from") or c["smtp_user"]
    msg["To"] = to
    msg.set_content(text)
    try:
        if c["smtp_security"] == "ssl":
            with smtplib.SMTP_SSL(c["smtp_host"], c["smtp_port"], context=ssl.create_default_context(), timeout=20) as s:
                s.login(c["smtp_user"], c["smtp_password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(c["smtp_host"], c["smtp_port"], timeout=20) as s:
                if c["smtp_security"] == "starttls":
                    s.starttls(context=ssl.create_default_context())
                s.login(c["smtp_user"], c["smtp_password"])
                s.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise ApiError("The email server rejected the username or password. For Gmail, use an App password.", status=502)
    except (OSError, smtplib.SMTPException) as e:
        raise ApiError(f"Couldn't send email: {e}. Check your internet connection and email settings.", status=502)
