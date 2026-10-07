-- 004_auth.sql
-- Login with password + authenticator app (TOTP), and password reset by email.

CREATE TABLE users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash     TEXT    NOT NULL,                 -- scrypt, salted (werkzeug.security)
    password_version  INTEGER NOT NULL DEFAULT 1,       -- bumped on password change/reset: logs out old sessions
    totp_secret       TEXT,                             -- base32; NULL until the authenticator is set up
    totp_last_step    INTEGER NOT NULL DEFAULT 0,       -- last accepted 30-second step (blocks code re-use)
    failed_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until      TEXT,                             -- ISO timestamp (UTC)
    last_login_at     TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE password_resets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    token_hash  TEXT    NOT NULL UNIQUE,                -- sha256 of the token in the emailed link
    expires_at  TEXT    NOT NULL,                       -- ISO timestamp (UTC)
    used_at     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- simple key/value settings (email server, auto-logout minutes, ...)
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

INSERT INTO settings (key, value) VALUES ('idle_minutes', '30');
