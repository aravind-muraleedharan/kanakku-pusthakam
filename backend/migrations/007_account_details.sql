-- 007_account_details.sql
-- Details for the Money Manager page: which bank / card issuer, bank account type, and credit card
-- limit and billing cycle (all optional).
ALTER TABLE accounts ADD COLUMN institution  TEXT;      -- bank name / card issuer
ALTER TABLE accounts ADD COLUMN subtype      TEXT;      -- bank: savings / current / salary / other
ALTER TABLE accounts ADD COLUMN credit_limit INTEGER;   -- credit card limit (paise)
ALTER TABLE accounts ADD COLUMN bill_day     INTEGER;   -- credit card: statement generated on this day of the month
ALTER TABLE accounts ADD COLUMN due_day      INTEGER;   -- credit card: payment due on this day of the month
