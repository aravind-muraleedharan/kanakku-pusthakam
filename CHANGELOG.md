# Changelog

## 1.0.0 (2026-10-07)

First public release.

- Record expenses, income, transfers, investments and redemptions; date defaults to today
- Credit card spending counted once: swipes are expenses, bill payments are transfers; card outstanding shown
- Investments tracked as principal; only the gain or loss on redemption counts as income
- Starting balances "as on" a date for every account
- Dashboard, monthly summary, category totals, month × category grid, payment-mode report, Indian financial year
- Editable accounts, categories and payment modes
- Login with password and authenticator app (MFA), password reset by email, terminal recovery commands
- Light, dark and auto theme
- Automatic daily backups, CSV export, `--demo` mode with sample data
- Runs offline on Linux with only Python 3.10+ (Flask bundled)
