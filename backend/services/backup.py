"""Backups you start yourself: save a copy to a folder you choose, and restore from a database file.

Restoring always saves the current data to the backups folder first ("pre-restore"), so it can be undone.
"""
import os
import sqlite3
from datetime import datetime

from flask import current_app
from werkzeug.security import check_password_hash

from .. import db
from ..errors import ApiError
from . import auth as auth_svc
from . import settings as settings_svc

SQLITE_HEADER = b"SQLite format 3\x00"
REQUIRED_TABLES = {"accounts", "categories", "entries", "schema_version"}


def last_folder():
    return settings_svc.get("backup_folder") or ""


def backup_to(path):
    """Copy the live database into a folder (dated file name) or to a new .db file path."""
    raw = (path or "").strip()
    if not raw:
        raise ApiError("Enter the folder to save the backup in", field="path")
    path = os.path.expanduser(raw)
    if not os.path.isabs(path):
        raise ApiError("Use the full path, starting with /  (e.g. /home/you/Backups)", field="path")
    path = os.path.realpath(path)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    if os.path.isdir(path):
        folder, target = path, os.path.join(path, f"kanakku_backup_{stamp}.db")
    elif path.lower().endswith(".db") and os.path.isdir(os.path.dirname(path)):
        folder, target = os.path.dirname(path), path
    else:
        raise ApiError("That folder doesn't exist. Check the path (and that the drive is plugged in).", field="path")
    if os.path.exists(target):
        raise ApiError("A file with that name is already there. Choose another name.", field="path")
    if not os.access(folder, os.W_OK):
        raise ApiError("Can't write to that folder (no permission).", field="path")
    dest = sqlite3.connect(target)
    try:
        db.get_db().backup(dest)
    finally:
        dest.close()
    try:
        os.chmod(target, 0o600)               # only you can read it
    except OSError:
        pass                                  # e.g. FAT-formatted pen drives have no permissions
    settings_svc.set_many({"backup_folder": folder})
    return {"file": target, "size_kb": round(os.path.getsize(target) / 1024, 1)}


def _check_password(password):
    user = auth_svc.get_user()
    if not user or not check_password_hash(user["password_hash"], password or ""):
        raise ApiError("Password is incorrect", field="password")


def validate_file(path):
    """Make sure a file is an undamaged database from this app, not newer than this version. Returns its schema version."""
    with open(path, "rb") as fh:
        if fh.read(16) != SQLITE_HEADER:
            raise ApiError("That file isn't a database backup from this app.", field="file")
    try:
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ApiError("That backup file is damaged.", field="file")
            tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not REQUIRED_TABLES <= tables:
                raise ApiError("That file isn't a database backup from this app.", field="file")
            version = src.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] or 0
        finally:
            src.close()
    except sqlite3.DatabaseError:
        raise ApiError("That file isn't a database backup from this app.", field="file")
    current = db.one("SELECT MAX(version) AS v FROM schema_version")["v"] or 0
    if version > current:
        raise ApiError("That backup was made by a newer version of the app. Update the app first.", field="file")
    return version


def restore_from(path, password):
    """Replace the live data with a backup file. The current data is saved first."""
    _check_password(password)
    validate_file(path)
    cfg = current_app.config
    live = db.get_db()
    safety = db.backup(live, cfg["BACKUP_DIR"], label="pre-restore")
    src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        src.backup(live)                      # page-by-page copy into the open database (atomic for readers)
    finally:
        src.close()
    db.close_db()
    db.migrate(cfg["DB_PATH"], cfg["BACKUP_DIR"])   # bring an older backup up to this version's schema
    return {"saved_current_as": os.path.basename(safety)}


def restore_named_backup(name, password):
    """Restore one of the files listed in the backups folder (by exact name only)."""
    names = {b["file"] for b in db.list_backups(current_app.config["BACKUP_DIR"])}
    if name not in names:
        raise ApiError("Backup not found", status=404)
    return restore_from(os.path.join(current_app.config["BACKUP_DIR"], name), password)
