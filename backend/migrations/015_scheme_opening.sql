-- 015_scheme_opening.sql
-- Gold Tree started earlier: the gold collected so far is kept with the scheme (grams), and the money paid so far
-- is the amount already invested (like an RD). Schemes saved with only a count get count x monthly amount.
ALTER TABLE investment_details ADD COLUMN opening_grams REAL;

UPDATE accounts
   SET opening_balance = (SELECT d.prepaid_instalments * d.amount FROM investment_details d WHERE d.account_id = accounts.id),
       opening_date    = (SELECT d.start_date FROM investment_details d WHERE d.account_id = accounts.id)
 WHERE opening_balance = 0
   AND id IN (SELECT account_id FROM investment_details
               WHERE inv_type = 'gold' AND term_months IS NOT NULL AND amount IS NOT NULL AND prepaid_instalments > 0)
   AND id NOT IN (SELECT account_id FROM metal_items WHERE description LIKE 'Paid before (%');
