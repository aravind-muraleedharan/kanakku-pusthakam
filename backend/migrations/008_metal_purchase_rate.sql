-- 008_metal_purchase_rate.sql
-- Gold coins / silver bars: the rate is recorded per purchase (rate per gram on the day you bought).
-- There is no separate "current rate" any more: coins and bars are shown at what you paid until sold.
ALTER TABLE metal_items ADD COLUMN rate INTEGER;     -- paise per gram on the purchase day (optional)
DROP TABLE metal_rates;
