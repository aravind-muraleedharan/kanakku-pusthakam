-- 020_budget_items.sql
-- The Monthly Budget becomes its own small sheet: your own income and expense items (not the app's categories),
-- an amount and note per month, and a "done" tick for payments made. The earlier category-based plan is removed.
DROP TABLE IF EXISTS plans;

CREATE TABLE budget_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT    NOT NULL CHECK (kind IN ('income', 'expense')),
    name       TEXT    NOT NULL COLLATE NOCASE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (kind, name)
);

CREATE TABLE budget_entries (
    item_id    INTEGER NOT NULL REFERENCES budget_items (id) ON DELETE CASCADE,
    month      TEXT    NOT NULL,                               -- YYYY-MM
    amount     INTEGER CHECK (amount IS NULL OR amount >= 0),  -- paise
    note       TEXT,
    done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (item_id, month)
);
CREATE INDEX idx_budget_entries_month ON budget_entries (month);
