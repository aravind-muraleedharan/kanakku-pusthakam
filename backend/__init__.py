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
        SESSION_COOKIE_SAMESITE="Strict",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    )

    os.makedirs(app.config["BACKUP_DIR"], exist_ok=True)
    db.migrate(app.config["DB_PATH"], app.config["BACKUP_DIR"])
    if not app.config.get("TESTING"):
        db.daily_backup(app.config["DB_PATH"], app.config["BACKUP_DIR"], config.KEEP_DAILY_BACKUPS)

    app.teardown_appcontext(db.close_db)
    register_blueprints(app)
    app.before_request(auth_guard)

    @app.after_request
    def _security_headers(resp):
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
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
