-- 010_investment_closing.sql
-- Closing an investment (maturity, breaking a deposit early, selling out) is recorded: when, what you received
-- and the transaction that brought the money back. Undo closing removes that transaction again.
ALTER TABLE investment_details ADD COLUMN closed_on TEXT;            -- YYYY-MM-DD
ALTER TABLE investment_details ADD COLUMN closed_amount INTEGER;     -- paise received on closing
ALTER TABLE investment_details ADD COLUMN close_entry_id INTEGER;    -- the closing transaction (if money came back)
ALTER TABLE investment_details ADD COLUMN close_note TEXT;
ALTER TABLE metal_items ADD COLUMN sold_on_close INTEGER NOT NULL DEFAULT 0;   -- marked sold by closing
