-- 011_rd_due_metal_bill.sql
-- RD: the day of the month each instalment is due (default: the start date's day).
-- Gold coin / silver bar purchases: whose name the bill is in, and the bill / transaction document reference.
ALTER TABLE investment_details ADD COLUMN due_day INTEGER;   -- 1-31
ALTER TABLE metal_items ADD COLUMN bill_name TEXT;
ALTER TABLE metal_items ADD COLUMN doc TEXT;
