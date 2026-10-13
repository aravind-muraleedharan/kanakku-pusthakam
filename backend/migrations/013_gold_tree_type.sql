-- 013_gold_tree_type.sql
-- Gold Tree (a jeweller's gold savings scheme): works like Gold Coin, each payment is a purchase with its weight.
-- Added only if a type with that name doesn't exist yet. Listed right after Gold Coin.
INSERT INTO investment_types (name, works_like, fields, sort_order)
    SELECT 'Gold Tree', 'gold', '[]', 5
    WHERE NOT EXISTS (SELECT 1 FROM investment_types WHERE name = 'gold tree' COLLATE NOCASE);
