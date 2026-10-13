-- 017_payment_mode_other.sql
-- Payment modes: Reward Points and Other. With Other you type what it was (e.g. Amazon Pay, gift card);
-- that text is kept on the transaction.
INSERT OR IGNORE INTO payment_modes (name, sort_order) VALUES ('Reward Points', 6), ('Other', 99);
ALTER TABLE entries ADD COLUMN payment_mode_other TEXT;
