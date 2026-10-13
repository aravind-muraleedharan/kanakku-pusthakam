"""Database access: connections, migrations and backups."""
import glob
import os
import re
import sqlite3
from datetime import datetime

from flask import current_app, g

from . import config


# ---------------------------------------------------------------- connections

def connect(db_path):
    conn = sqlite3.connect(db_path, detect_types=0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # default rollback journal: safe on any disk, incl. synced/network folders (WAL is not)
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db():
    """One connection per request, closed automatically at the end of it."""
    if "db" not in g:
        g.db = connect(current_app.config["DB_PATH"])
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def rows(sql, params=()):
    return [dict(r) for r in get_db().execute(sql, params).fetchall()]


def one(sql, params=()):
    r = get_db().execute(sql, params).fetchone()
    return dict(r) if r else None


# ---------------------------------------------------------------- migrations

MIGRATION_RE = re.compile(r"^(\d+)_.*\.sql$")


def _migration_files():
    found = []
    for path in glob.glob(os.path.join(config.MIGRATIONS_DIR, "*.sql")):
        m = MIGRATION_RE.match(os.path.basename(path))
        if m:
            found.append((int(m.group(1)), path))
    return sorted(found)


def migrate(db_path, backup_dir):
    """Apply any migrations not yet recorded in schema_version. Backs up first if data exists."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    existed = os.path.exists(db_path)
    conn = connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            " version INTEGER PRIMARY KEY, name TEXT NOT NULL,"
            " applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))"
        )
        done = {r[0] for r in conn.execute("SELECT version FROM schema_version")}
        pending = [(v, p) for v, p in _migration_files() if v not in done]
        if pending and existed and done:
            backup(conn, backup_dir, label="pre-migration")
        for version, path in pending:
            with open(path, encoding="utf-8") as fh:
                sql = fh.read()
            # a migration that rebuilds a table says so; foreign keys can only be switched off outside a transaction
            fk_off = "-- migrate: foreign_keys off" in sql
            if fk_off:
                conn.execute("PRAGMA foreign_keys = OFF")
            try:
                conn.executescript("BEGIN;\n" + sql + "\nCOMMIT;")
            except Exception:
                conn.rollback()
                raise
            finally:
                bad = conn.execute("PRAGMA foreign_key_check").fetchall() if fk_off else []
                if fk_off:
                    conn.execute("PRAGMA foreign_keys = ON")
            if bad:
                raise RuntimeError(f"{os.path.basename(path)} left broken references: {bad[:5]}")
            conn.execute(
                "INSERT INTO schema_version (version, name) VALUES (?, ?)",
                (version, os.path.basename(path)),
            )
            conn.commit()
        return [os.path.basename(p) for _, p in pending]
    finally:
        conn.close()


# ---------------------------------------------------------------- backups

KEEP_BACKUPS = 10          # newest backup files kept in the backups folder (all kinds)
AUTO_EVERY_DAYS = 7        # automatic backup: once a week


def backup(conn, backup_dir, label="manual", keep=None):
    """Copy the live database to backups/expenses_<timestamp>_<label>.db using SQLite's backup API,
    then keep only the newest `keep` backups in that folder."""
    os.makedirs(backup_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    path = os.path.join(backup_dir, f"expenses_{stamp}_{label}.db")
    dest = sqlite3.connect(path)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    prune_backups(backup_dir, KEEP_BACKUPS if keep is None else keep)
    return path


def prune_backups(backup_dir, keep):
    """Delete all but the newest `keep` backup files (names start with the date, so they sort by age)."""
    files = sorted(glob.glob(os.path.join(backup_dir, "expenses_*.db")))
    for old in files[:-keep] if keep > 0 else []:
        try:
            os.remove(old)
        except OSError:
            pass


def weekly_backup(db_path, backup_dir, every_days=AUTO_EVERY_DAYS, keep=None):
    """Make an automatic backup if the last one is a week old (or there is none)."""
    if not os.path.exists(db_path):
        return None
    autos = sorted(glob.glob(os.path.join(backup_dir, "expenses_*_auto.db")))
    if autos:
        age_days = (datetime.now().timestamp() - os.path.getmtime(autos[-1])) / 86400
        if age_days < every_days:
            return None
    conn = connect(db_path)
    try:
        return backup(conn, backup_dir, label="auto", keep=keep)
    finally:
        conn.close()


def list_backups(backup_dir):
    out = []
    for path in sorted(glob.glob(os.path.join(backup_dir, "expenses_*.db")), reverse=True):
        st = os.stat(path)
        out.append({
            "file": os.path.basename(path),
            "size_kb": round(st.st_size / 1024, 1),
            "created": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
        })
    return out
