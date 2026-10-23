# Changelog

## 1.2.0 (2026-10-23)

### New
- **Monthly Budget:** plan your income and expenses for up to three months at a time
  - your own budget items, kept separate from your categories and transactions
  - an amount and an optional note per item and month
  - tick payments as done to see **Paid** and **Still to pay**
  - **Sufficient** or **Short by** shows whether the month's income covers its expenses
  - **Copy** the previous month, **Clear** a month, **Delete** a month, **Add month**
- **ⓘ help buttons:** short explanations next to terms such as transaction types, principal, payment mode,
  close vs delete, current value, CNC / MTF / intraday, prepayment and card dues
- **Dashboard:** "Where the money went" shows the top 6 categories, with the rest added up as "Others"

### Changed
- **Money Manager is now called Accounts.** The sidebar order is Dashboard, Transactions, Accounts, Investments,
  Loans & EMIs, Monthly Budget, Reports, Settings
- **Redeem is now called Maturity** (money coming back from an investment). The transaction types are in the order
  Income, Expense, Transfer, Invest, Maturity, and fit on one row on phones
- Categories are listed alphabetically

### Upgrading
`git pull`, then start the app as usual. Database changes are applied automatically, after a backup.

## 1.1.0 (2026-10-13)

### New
- **Money Manager:** banks (savings / current / salary), credit cards (issuer, limit, bill day, due day), cash,
  investments and loans on one page, with net worth
- **Investments** with a type per investment and its own calculation:
  - Fixed Deposit (interest payouts or cumulative, tenure in years + months + days, the bank it's held at)
  - Recurring Deposit (due day, instalments already paid, missed instalments)
  - PPF (yearly deposits, monthly lowest-balance interest)
  - Stocks: trading journal with CNC buy / sell, MTF buy / sell, intraday and others (named by you), charges,
    dividends (kept out of the account's value, since they're paid to your bank), and a profit goal
  - Gold coins and silver bars: purchases with date, amount, rate, weight, bill name, payment account, document
  - Gold savings scheme ("Gold Tree"): monthly amount, months paid and missed, grams so far
  - Chit fund: monthly instalment, due day, instalments already paid, prize
  - Other holdings with a current value you type in
- **Close** an investment (matured, broken early, sold out): the closing amount and transaction are recorded;
  **Undo closing**; **Delete** removes an investment with all its records (a backup is saved first)
- **Loans & EMIs:** credit card EMIs and personal loans, schedule, prepayments (reduce tenure or EMI), loans that
  were already running, undo last action; only interest counts as an expense
- **Dashboard:** net worth (have vs owe), investments by type, coming up (EMIs, instalments, interest payouts)
- **Backup to a folder** (pen drive, other disk) and **restore** from a backup
- Payment modes **Reward Points** and **Other** (Other asks what it was)

### Changed
- Automatic backup once a week (and before upgrades and restores); the newest 10 are kept
- Dropdowns no longer change when the mouse wheel scrolls over them after a pick
- Werkzeug updated to 3.1.9 in the bundled libraries

### Security
- The app refuses requests that aren't addressed to this computer (127.0.0.1 / localhost), which blocks
  "DNS rebinding" from web pages; this also protects the password-reset link
- Database, key and backup files are readable only by you (folders 700, files 600)
- The browser no longer remembers what you type in the app's fields (form history is off; login fields unchanged)
- Account names are always shown as plain text in the transactions list

### Upgrading
`git pull`, then start the app as usual. Database changes are applied automatically, after a backup.

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
