"""Database access: connections, migrations and backups."""
import glob
import hashlib
import os
import re
import sqlite3
from datetime import date, datetime

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

# How many of each kind stay in the backups folder. The kind is the last part of the file name.
KEEP = {"daily": 7, "weekly": 8, "pre-migration": 3, "pre-restore": 3, "manual": 3}
NOT_DATA = {"users", "password_resets"}       # login details change at every login: not "your data changing"
FINGERPRINT_FILE = ".last_backup_fingerprint"


def _kind(path):
    k = os.path.basename(path)[:-3].split("_", 3)[-1]          # expenses_<date>_<time>_<kind>.db
    return "weekly" if k == "auto" else k                      # older weekly backups were called "auto"


def backup(conn, backup_dir, label="manual", keep=None, when=None):
    """Copy the live database to backups/expenses_<timestamp>_<label>.db using SQLite's backup API,
    then tidy the folder (see KEEP). `keep` is no longer used: each kind has its own limit."""
    os.makedirs(backup_dir, exist_ok=True)
    stamp = (when or datetime.now()).strftime("%Y-%m-%d_%H%M%S")
    path = os.path.join(backup_dir, f"expenses_{stamp}_{label}.db")
    dest = sqlite3.connect(path)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    prune_backups(backup_dir)
    return path


def prune_backups(backup_dir, keep=None):
    """Keep only the newest few of each kind (names start with the date, so they sort by age)."""
    groups = {}
    for f in sorted(glob.glob(os.path.join(backup_dir, "expenses_*.db"))):
        groups.setdefault(_kind(f), []).append(f)
    for kind, files in groups.items():
        n = KEEP.get(kind, 3)
        for old in files[:-n]:
            try:
                os.remove(old)
            except OSError:
                pass


def fingerprint(conn):
    """A short code that changes whenever your data changes (login details left out)."""
    h = hashlib.sha256()
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    for t in tables:
        if t in NOT_DATA:
            continue
        h.update(t.encode())
        for row in conn.execute(f'SELECT * FROM "{t}" ORDER BY rowid'):
            h.update(repr(tuple(row)).encode())
    return h.hexdigest()


def daily_backup(db_path, backup_dir, today=None):
    """The automatic backup: once a day (at the first login, or when the app starts), only if your data changed
    since the last one. Every 7 days it is kept as a weekly backup, so older history stays too."""
    if not os.path.exists(db_path):
        return None
    today = today or date.today()
    autos = [f for f in sorted(glob.glob(os.path.join(backup_dir, "expenses_*.db"))) if _kind(f) in ("daily", "weekly")]
    if any(os.path.basename(f)[9:19] == today.isoformat() for f in autos):
        return None                                            # already one today
    conn = connect(db_path)
    try:
        fp = fingerprint(conn)
        fp_file = os.path.join(backup_dir, FINGERPRINT_FILE)
        try:
            with open(fp_file) as fh:
                if fh.read().strip() == fp:
                    return None                                # nothing changed since the last backup
        except OSError:
            pass
        weeklies = [f for f in autos if _kind(f) == "weekly"]
        last_week = date.fromisoformat(os.path.basename(weeklies[-1])[9:19]) if weeklies else None
        label = "weekly" if not last_week or (today - last_week).days >= 7 else "daily"
        path = backup(conn, backup_dir, label=label, when=datetime.combine(today, datetime.now().time()))
        with open(fp_file, "w") as fh:
            fh.write(fp)
        return path
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
            "kind": _kind(path),
        })
    return out
