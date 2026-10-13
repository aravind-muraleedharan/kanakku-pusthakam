-- 005_investments.sql
-- Investment types (share accounts, FD, RD, PPF, gold, silver, chitty) on top of the existing
-- investment accounts. Money in/out still uses the normal entries (invest / redeem / transfer).

-- One row per investment account: what kind of investment it is and its terms.
CREATE TABLE investment_details (
    account_id    INTEGER PRIMARY KEY REFERENCES accounts (id),
    inv_type      TEXT    NOT NULL CHECK (inv_type IN ('share', 'fd', 'rd', 'ppf', 'gold', 'silver', 'chitty', 'other')),
    institution   TEXT,                 -- bank / broker / post office
    amount        INTEGER,              -- FD: deposit amount; RD: monthly instalment (paise)
    rate          REAL,                 -- annual interest rate, percent (FD, RD, PPF)
    start_date    TEXT,                 -- YYYY-MM-DD
    term_months   INTEGER,              -- FD / RD tenure
    maturity_date TEXT,                 -- YYYY-MM-DD (computed for FD/RD/PPF, editable)
    payout        TEXT CHECK (payout IN ('monthly', 'quarterly', 'yearly', 'maturity')),   -- FD interest payout
    goal_pct      REAL,                 -- share account goal: target gain %
    goal_profit   INTEGER,              -- share account goal: forecast profit (paise)
    goal_date     TEXT,                 -- share account goal: target date
    notes         TEXT
);

-- Share trading journal: market actions per share account (profit entered before charges).
CREATE TABLE share_actions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    date       TEXT    NOT NULL,
    stocks     TEXT    NOT NULL,
    action     TEXT    NOT NULL CHECK (action IN ('buy', 'sell', 'intraday')),
    profit     INTEGER NOT NULL DEFAULT 0,   -- paise; may be negative (loss); buy = 0
    charges    INTEGER NOT NULL DEFAULT 0,   -- paise
    note       TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_share_actions_acc ON share_actions (account_id, date);

-- Dividends: credited to the bank and added back, so recorded inside the share account (never income).
CREATE TABLE share_dividends (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    date       TEXT    NOT NULL,
    stock      TEXT,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    note       TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_share_dividends_acc ON share_dividends (account_id, date);

-- Physical gold / silver items held in a gold or silver investment account.
CREATE TABLE metal_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER NOT NULL REFERENCES accounts (id),
    date           TEXT    NOT NULL,         -- bought on
    description    TEXT    NOT NULL,
    grams          REAL    NOT NULL CHECK (grams > 0),
    purity         REAL    NOT NULL,         -- percent pure: 99.9 (24K), 91.6 (22K), 75 (18K), 92.5 (sterling)
    total_paid     INTEGER NOT NULL,         -- paise, everything paid incl. making & GST
    making_charges INTEGER NOT NULL DEFAULT 0,
    entry_id       INTEGER REFERENCES entries (id),     -- the invest entry that paid for it (if any)
    sold_date      TEXT,
    sold_amount    INTEGER,
    sold_entry_id  INTEGER REFERENCES entries (id),
    note           TEXT
);
CREATE INDEX idx_metal_items_acc ON metal_items (account_id);

-- Gold / silver rates you enter now and then (rate for pure metal, per gram).
CREATE TABLE metal_rates (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    metal  TEXT    NOT NULL CHECK (metal IN ('gold', 'silver')),
    date   TEXT    NOT NULL,
    rate   INTEGER NOT NULL CHECK (rate > 0),    -- paise per gram of pure metal (24K / 999)
    UNIQUE (metal, date)
);

-- Links an income entry (e.g. FD interest payout) to the investment it came from.
ALTER TABLE entries ADD COLUMN related_account_id INTEGER REFERENCES accounts (id);

INSERT INTO categories (name, kind, description, sort_order) VALUES
    ('Interest - FD', 'income', 'FD interest paid out to your bank', 6);

-- Existing investment accounts get a type; you can change it on the Investments page.
INSERT INTO investment_details (account_id, inv_type)
    SELECT id, CASE
        WHEN lower(name) LIKE '%chit%' THEN 'chitty'
        WHEN lower(name) LIKE '%ppf%'  THEN 'ppf'
        WHEN lower(name) LIKE '% rd%' OR lower(name) LIKE 'rd%' OR lower(name) LIKE '%recurring%' THEN 'rd'
        WHEN lower(name) LIKE '% fd%' OR lower(name) LIKE 'fd%' OR lower(name) LIKE '%fixed%' THEN 'fd'
        WHEN lower(name) LIKE '%gold%' THEN 'gold'
        WHEN lower(name) LIKE '%silver%' THEN 'silver'
        ELSE 'other' END
    FROM accounts WHERE kind = 'investment';
