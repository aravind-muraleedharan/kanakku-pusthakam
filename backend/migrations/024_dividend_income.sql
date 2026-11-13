-- 024_dividend_income.sql
-- A dividend added on a stocks account now also records the Income into the bank it was paid into, and remembers
-- that entry (editing or deleting either keeps both in step). Existing dividends stay as they are (no entry).
ALTER TABLE share_dividends ADD COLUMN entry_id INTEGER REFERENCES entries (id);
INSERT OR IGNORE INTO categories (name, kind, description, sort_order) VALUES ('Dividends', 'income', 'Paid by shares you hold', 6);
