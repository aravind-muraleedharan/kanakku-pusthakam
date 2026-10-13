-- 009_investment_types.sql
-- Investment types you can add yourself. Each type "works like" one of the built-in calculations
-- (investment_details.inv_type keeps that calculation code) and can carry extra fields of your own.
-- Also: tenure in years + months + days, the bank account an FD/RD/PPF is held at, and a current value
-- you can type in for investments that are otherwise shown at what you put in.

CREATE TABLE investment_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    works_like  TEXT    NOT NULL CHECK (works_like IN ('share', 'fd', 'rd', 'ppf', 'gold', 'silver', 'chitty', 'other')),
    builtin     TEXT    UNIQUE,              -- the built-in code for the 8 built-in types, NULL for your own
    fields      TEXT    NOT NULL DEFAULT '[]',   -- JSON: [{"key", "label", "kind", "required", "options"}]
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO investment_types (name, works_like, builtin, sort_order) VALUES
    ('Stocks', 'share', 'share', 1),
    ('Fixed Deposit', 'fd', 'fd', 2),
    ('Recurring Deposit', 'rd', 'rd', 3),
    ('Public Provident Fund (PPF)', 'ppf', 'ppf', 4),
    ('Gold Coin', 'gold', 'gold', 5),
    ('Silver Bar', 'silver', 'silver', 6),
    ('Chit Fund', 'chitty', 'chitty', 7),
    ('Other', 'other', 'other', 99);

ALTER TABLE investment_details ADD COLUMN type_id INTEGER REFERENCES investment_types (id);
ALTER TABLE investment_details ADD COLUMN extra TEXT;                 -- JSON: values of your extra fields
ALTER TABLE investment_details ADD COLUMN term_days INTEGER;          -- tenure = term_months + term_days
ALTER TABLE investment_details ADD COLUMN held_at_account_id INTEGER REFERENCES accounts (id);
ALTER TABLE investment_details ADD COLUMN current_value INTEGER;      -- paise, typed in by you (simple holdings)
ALTER TABLE investment_details ADD COLUMN current_value_date TEXT;

UPDATE investment_details SET type_id = (SELECT id FROM investment_types WHERE builtin = investment_details.inv_type);
