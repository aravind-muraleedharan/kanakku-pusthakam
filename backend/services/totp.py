"""Time-based one-time passwords (RFC 6238), compatible with Google / Microsoft Authenticator, Authy etc.

Standard library only: 30-second steps, 6 digits, HMAC-SHA1.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6


def new_secret():
    """160-bit random secret, base32 (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key(secret):
    s = secret.upper().replace(" ", "")
    return base64.b32decode(s + "=" * (-len(s) % 8))


def code_at(secret, step):
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** DIGITS)).zfill(DIGITS)


def current_step(now=None):
    return int((now if now is not None else time.time()) // STEP)


def verify(secret, code, last_step=0, window=1, now=None):
    """Return the matching step if `code` is valid (allowing ±window steps of clock drift), else None.

    Steps at or before `last_step` are rejected so a code can't be used twice.
    """
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != DIGITS or not secret:
        return None
    step = current_step(now)
    for s in range(step - window, step + window + 1):
        if s > last_step and hmac.compare_digest(code_at(secret, s), code):
            return s
    return None


def otpauth_uri(secret, account, issuer="Kanakku Pusthakam"):
    label = quote(f"{issuer}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP}"
