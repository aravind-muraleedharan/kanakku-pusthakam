-- 025_loan_types.sql
-- Your own loan types (Home loan, Car loan, Gold loan ...). Each one works like a built-in kind:
--   cc_emi    the whole EMI is an expense on a credit card
--   personal  money borrowed into your bank: only the interest is an expense
-- A loan of your own type keeps loan_type = that kind (so the maths is unchanged) and points at its type here.

CREATE TABLE loan_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    works_like  TEXT    NOT NULL CHECK (works_like IN ('cc_emi', 'personal')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

ALTER TABLE loans ADD COLUMN type_id INTEGER REFERENCES loan_types (id);
