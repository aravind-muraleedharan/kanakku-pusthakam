-- 012_gold_tree_simple.sql
-- Gold tree: no extra fields any more (each purchase already records date, amount, rate, weight, bill name...).
-- Values typed into the old fields stay in the database but are no longer shown.
UPDATE investment_types SET fields = '[]' WHERE builtin IS NULL AND name = 'gold tree' COLLATE NOCASE;
