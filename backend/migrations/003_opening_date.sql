-- 003_opening_date.sql
-- Opening balances are "as on" a date. Balances = opening balance + entries dated on or after this date.
-- NULL = opening balance counts from the very first entry.
ALTER TABLE accounts ADD COLUMN opening_date TEXT;
