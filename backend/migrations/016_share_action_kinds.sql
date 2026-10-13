-- 016_share_action_kinds.sql
-- Market actions: CNC buy / CNC sell / MTF buy / MTF sell / Intraday / Others (Others carries its own name).
-- Old Buy -> CNC buy, old Sell -> CNC sell.
-- migrate: foreign_keys off
CREATE TABLE share_actions_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL REFERENCES accounts (id),
    date         TEXT    NOT NULL,
    stocks       TEXT    NOT NULL,
    action       TEXT    NOT NULL CHECK (action IN ('cnc_buy', 'cnc_sell', 'mtf_buy', 'mtf_sell', 'intraday', 'other')),
    action_other TEXT,                           -- the name typed in when action = 'other'
    profit       INTEGER NOT NULL DEFAULT 0,     -- paise; may be negative (loss); buys = 0
    charges      INTEGER NOT NULL DEFAULT 0,     -- paise
    note         TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO share_actions_new (id, account_id, date, stocks, action, profit, charges, note, created_at)
    SELECT id, account_id, date, stocks,
           CASE action WHEN 'buy' THEN 'cnc_buy' WHEN 'sell' THEN 'cnc_sell' ELSE action END,
           profit, charges, note, created_at
    FROM share_actions;
DROP TABLE share_actions;
ALTER TABLE share_actions_new RENAME TO share_actions;
CREATE INDEX idx_share_actions_acc ON share_actions (account_id, date);
