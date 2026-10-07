-- 001_initial.sql
-- Core tables for Phase 1. Amounts are stored as INTEGER paise (₹1 = 100).

CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    kind            TEXT    NOT NULL CHECK (kind IN ('bank', 'credit_card', 'cash', 'investment')),
    -- bank/cash: opening balance; credit_card: opening outstanding (stored as a negative balance);
    -- investment: principal already invested before tracking started
    opening_balance INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL COLLATE NOCASE,
    kind        TEXT    NOT NULL CHECK (kind IN ('expense', 'income')),
    description TEXT,
    is_system   INTEGER NOT NULL DEFAULT 0,   -- 1 = managed by the app (Investment Returns)
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (name, kind)
);

CREATE TABLE payment_modes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date             TEXT    NOT NULL,                       -- YYYY-MM-DD
    type             TEXT    NOT NULL CHECK (type IN ('expense', 'income', 'transfer', 'invest', 'redeem')),
    amount           INTEGER NOT NULL CHECK (amount > 0),    -- paise
    category_id      INTEGER REFERENCES categories (id),
    from_account_id  INTEGER REFERENCES accounts (id),
    to_account_id    INTEGER REFERENCES accounts (id),
    payment_mode_id  INTEGER REFERENCES payment_modes (id),
    principal_amount INTEGER,                                -- redeem only: principal closed (paise)
    note             TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_entries_date     ON entries (date);
CREATE INDEX idx_entries_type     ON entries (type);
CREATE INDEX idx_entries_category ON entries (category_id);
CREATE INDEX idx_entries_from     ON entries (from_account_id);
CREATE INDEX idx_entries_to       ON entries (to_account_id);
