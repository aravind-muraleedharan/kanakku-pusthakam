-- 006_loans.sql
-- migrate: foreign_keys off
-- Loans and EMIs: personal loans (a 'loan' account that you owe) and credit card EMIs (billed on the card).
-- Adds the account kind 'loan': SQLite can't change a CHECK, so the accounts table is rebuilt (ids unchanged).

CREATE TABLE accounts_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    kind            TEXT    NOT NULL CHECK (kind IN ('bank', 'credit_card', 'cash', 'investment', 'loan')),
    -- bank/cash: opening balance; credit_card and loan: amount owed (stored as a negative balance);
    -- investment: principal already invested before tracking started
    opening_balance INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    opening_date    TEXT
);
INSERT INTO accounts_new (id, name, kind, opening_balance, active, sort_order, created_at, opening_date)
    SELECT id, name, kind, opening_balance, active, sort_order, created_at, opening_date FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE TABLE loans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    loan_type       TEXT    NOT NULL CHECK (loan_type IN ('cc_emi', 'personal', 'other')),
    lender          TEXT,
    account_id      INTEGER REFERENCES accounts (id),   -- cc_emi: the credit card; personal/other: the loan account
    bank_account_id INTEGER REFERENCES accounts (id),   -- personal/other: EMIs paid from (and loan credited to)
    category_id     INTEGER REFERENCES categories (id), -- cc_emi: what was bought (each EMI is an expense here)
    principal       INTEGER NOT NULL CHECK (principal > 0),   -- total loan amount (paise)
    emi             INTEGER NOT NULL CHECK (emi > 0),
    tenure_months   INTEGER NOT NULL CHECK (tenure_months > 0),
    charges         INTEGER NOT NULL DEFAULT 0,               -- processing fee + GST etc.
    rate            REAL,                                     -- annual %, worked out from amount, EMI, tenure
    first_emi_date  TEXT    NOT NULL,
    paid_before     INTEGER NOT NULL DEFAULT 0,               -- EMIs paid before tracking started (no entries)
    status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    closed_date     TEXT,
    notes           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Everything that happened to a loan; each row points to the entries it created.
CREATE TABLE loan_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id        INTEGER NOT NULL REFERENCES loans (id),
    date           TEXT    NOT NULL,
    kind           TEXT    NOT NULL CHECK (kind IN ('disbursal', 'emi', 'prepay', 'foreclose')),
    amount         INTEGER NOT NULL DEFAULT 0,     -- total paid (or received for a disbursal)
    principal      INTEGER NOT NULL DEFAULT 0,
    interest       INTEGER NOT NULL DEFAULT 0,
    charges        INTEGER NOT NULL DEFAULT 0,
    mode           TEXT CHECK (mode IN ('tenure', 'emi')),   -- prepayment: reduce tenure or reduce EMI
    installment_no INTEGER,
    entry_ids      TEXT,                           -- comma-separated entries.id
    note           TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_loan_events_loan ON loan_events (loan_id, date);

INSERT INTO categories (name, kind, description, sort_order)
    SELECT 'Loan Interest & Charges', 'expense', 'Interest part of loan EMIs, processing fees, foreclosure charges', 17
    WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Loan Interest & Charges');
