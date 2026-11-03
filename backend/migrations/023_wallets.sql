-- migrate: foreign_keys off
-- 023_wallets.sql
-- Wallets & gift cards (Amazon Pay balance, gift cards, vouchers, reward points with a rupee value): a new account
-- kind 'wallet'. SQLite can't change a CHECK, so the accounts table is rebuilt (ids and every column unchanged).
CREATE TABLE accounts_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    kind            TEXT    NOT NULL CHECK (kind IN ('bank', 'credit_card', 'cash', 'wallet', 'investment', 'loan')),
    -- bank/cash/wallet: opening balance; credit_card and loan: amount owed (stored as a negative balance);
    -- investment: principal already invested before tracking started
    opening_balance INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    opening_date    TEXT,
    institution     TEXT,
    subtype         TEXT,
    credit_limit    INTEGER,
    bill_day        INTEGER,
    due_day         INTEGER
);
INSERT INTO accounts_new (id, name, kind, opening_balance, active, sort_order, created_at, opening_date,
                          institution, subtype, credit_limit, bill_day, due_day)
    SELECT id, name, kind, opening_balance, active, sort_order, created_at, opening_date,
           institution, subtype, credit_limit, bill_day, due_day FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- how a payment from a wallet is made
INSERT OR IGNORE INTO payment_modes (name, sort_order) VALUES ('Wallet / gift card', 7);
