"""Key/value app settings stored in the `settings` table."""
from ..db import get_db, rows


def get_many(keys):
    marks = ",".join("?" for _ in keys)
    return {r["key"]: r["value"] for r in rows(f"SELECT key, value FROM settings WHERE key IN ({marks})", tuple(keys))}


def get(key, default=None):
    return get_many([key]).get(key, default)


def set_many(values):
    conn = get_db()
    conn.executemany(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        list(values.items()),
    )
    conn.commit()
