"""Kanakku Pusthakam - Flask application factory.

The backend serves a JSON API under /api and the static frontend from ../frontend.
"""
import os
import secrets
from datetime import timedelta

from flask import Flask, jsonify, request, send_from_directory

from . import config, db

from .api import register_blueprints
from .api.auth import guard as auth_guard
from .errors import ApiError


def request_is_api():
    return request.path.startswith("/api/")


def _load_secret(path):
    """Random 32-byte key in data/secret.key, created on first start (readable only by you)."""
    if os.path.exists(path):
        with open(path, "rb") as fh:
            key = fh.read()
        if len(key) >= 32:
            return key
    os.makedirs(os.path.dirname(path), exist_ok=True)
    key = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(key)
    return key


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _host_name(host_header):
    """'localhost:5000' -> 'localhost', '[::1]:5000' -> '::1'."""
    h = (host_header or "").strip().lower()
    if h.startswith("["):
        return h[1:h.find("]")] if "]" in h else h
    return h.rsplit(":", 1)[0] if h.count(":") == 1 else h


def _private_files(app):
    """Data, backups and every file the app creates later are readable by you only (other accounts on this
    computer can't open them)."""
    os.umask(0o077)
    for d in (os.path.dirname(app.config["DB_PATH"]), app.config["BACKUP_DIR"]):
        try:
            os.chmod(d, 0o700)
            for f in os.listdir(d):
                if f.endswith((".db", ".key", "-journal", "-wal", "-shm")):
                    os.chmod(os.path.join(d, f), 0o600)
        except OSError:
            pass                                  # e.g. a folder on a drive without Unix permissions


def create_app(overrides=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DB_PATH=config.DB_PATH,
        BACKUP_DIR=config.BACKUP_DIR,
        EXPORT_DIR=config.EXPORT_DIR,
        FRONTEND_DIR=config.FRONTEND_DIR,
        JSON_SORT_KEYS=False,
    )
    if overrides:
        app.config.update(overrides)
    app.json.sort_keys = False

    # signed session cookie: secret kept next to the data, never in the code/repo
    if not app.config.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = _load_secret(os.path.join(os.path.dirname(app.config["DB_PATH"]), "secret.key"))
    app.config.update(
        SESSION_COOKIE_NAME="kp_session",
        SESSION_COOKIE_HTTPONLY=True,
        MAX_CONTENT_LENGTH=64 * 1024 * 1024,        # requests above 64 MB are refused (413)
        SESSION_COOKIE_SAMESITE="Strict",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    )

    os.makedirs(app.config["BACKUP_DIR"], exist_ok=True)
    os.makedirs(os.path.dirname(app.config["DB_PATH"]), exist_ok=True)
    _private_files(app)
    db.migrate(app.config["DB_PATH"], app.config["BACKUP_DIR"])
    if not app.config.get("TESTING"):
        db.weekly_backup(app.config["DB_PATH"], app.config["BACKUP_DIR"])

    app.teardown_appcontext(db.close_db)
    register_blueprints(app)

    allowed = LOCAL_HOSTS | {h.lower() for h in app.config.get("ALLOWED_HOSTS", ())}

    @app.before_request
    def _only_this_computer():
        # A web page you visit can point its own name at 127.0.0.1 ("DNS rebinding") and then talk to this app.
        # Such requests carry that site's name in the Host header, so anything not addressed to this computer is refused.
        if _host_name(request.host) not in allowed:
            return jsonify({"error": "This app only answers on this computer (127.0.0.1 / localhost)."}), 403
        return None

    app.before_request(auth_guard)

    @app.after_request
    def _security_headers(resp):
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        # Works fully offline: the page may load and send data only to this app on your computer.
        resp.headers.setdefault("Content-Security-Policy",
                                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                "img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; "
                                "base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        if request_is_api():
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(ApiError)
    def _api_error(err):
        body = {"error": err.message}
        if err.field:
            body["field"] = err.field
        return jsonify(body), err.status

    @app.errorhandler(404)
    def _not_found(_e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(OverflowError)
    def _too_big(_e):                       # e.g. an id far beyond anything stored
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(500)
    def _server_error(_e):                  # never show internals; details stay in the terminal
        return jsonify({"error": "Something went wrong. Try again; if it keeps happening, restart the app."}), 500

    # ------------------------------------------------------------ frontend
    frontend = app.config["FRONTEND_DIR"]

    @app.get("/")
    def index():
        return send_from_directory(frontend, "index.html")

    @app.get("/<path:path>")
    def static_files(path):
        if path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        full = os.path.join(frontend, path)
        if os.path.isfile(full):
            resp = send_from_directory(frontend, path)
            resp.headers["Cache-Control"] = "no-cache"
            return resp
        return send_from_directory(frontend, "index.html")

    return app
