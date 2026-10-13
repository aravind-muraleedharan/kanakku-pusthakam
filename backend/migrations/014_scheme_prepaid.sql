-- 014_scheme_prepaid.sql
-- Gold Tree started before using the app: how many instalments were already paid.
ALTER TABLE investment_details ADD COLUMN prepaid_instalments INTEGER;
