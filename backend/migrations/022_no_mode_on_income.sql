-- 022_no_mode_on_income.sql
-- Income and maturity entries have no payment mode, but the form could save one left over from an earlier entry
-- (e.g. "Credit Card" on an income). Clear those; the mode isn't shown or used for these types.
UPDATE entries SET payment_mode_id = NULL, payment_mode_other = NULL
 WHERE type IN ('income', 'redeem') AND (payment_mode_id IS NOT NULL OR payment_mode_other IS NOT NULL);
