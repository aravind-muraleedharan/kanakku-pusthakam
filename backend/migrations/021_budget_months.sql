-- 021_budget_months.sql
-- Monthly Budget: you choose the months in the plan (up to three). Deleting a month removes its column; "Add month"
-- brings one in. Starts with the months that already have budget entries, or else the next two months.
CREATE TABLE budget_months (
    month    TEXT PRIMARY KEY,                                  -- YYYY-MM
    added_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO budget_months (month)
    SELECT DISTINCT month FROM budget_entries WHERE month >= strftime('%Y-%m', 'now', 'localtime') ORDER BY month LIMIT 3;
INSERT INTO budget_months (month)
    SELECT strftime('%Y-%m', 'now', 'localtime', 'start of month', '+1 month')
    WHERE NOT EXISTS (SELECT 1 FROM budget_months)
    UNION ALL
    SELECT strftime('%Y-%m', 'now', 'localtime', 'start of month', '+2 months')
    WHERE NOT EXISTS (SELECT 1 FROM budget_months);
