# Design — Kanakku Pusthakam (Phase 1)

A locally hosted web app for recording income and expenses by hand and seeing monthly and
category-wise totals. Built so investments and other modules can be added later without re-entering data.

## Architecture

| Layer | Choice |
| --- | --- |
| Frontend | `frontend/`: HTML, CSS, vanilla JavaScript modules, hand-written SVG charts (no CDN, works offline); light / dark / auto theme |
| Backend | `backend/`: Python Flask JSON API under `/api`, also serves the frontend |
| Database | SQLite file `data/expenses.db`, amounts in integer paise |
| Hosting | `http://127.0.0.1:5000`, localhost only |

Scale: ~15 entries/day for 20 years ≈ 110,000 rows ≈ 10–20 MB. Indexes on date, type, category and accounts keep reports instant.

## Core model

Every entry moves money from and/or to an **account** (kinds: bank, credit_card, cash, investment).

| Type | From → To | Counts in totals |
| --- | --- | --- |
| expense | bank / card / cash → outside | expense |
| income | outside → bank / cash / card | income |
| transfer | bank / card / cash → bank / card / cash | nothing (card bill payment, ATM withdrawal) |
| invest | bank / card / cash → investment | "invested", shown separately |
| redeem | investment → bank / cash | gain = amount − principal counts as income (Investment Returns); can be negative |

Payment mode (UPI, Credit Card, Debit Card, Cash, Net Banking) is recorded separately from the account and is
pre-filled from the account (card → Credit Card, cash → Cash, bank → UPI).

### Starting balances
Each account has a starting balance **as on a date** (Settings → Starting balances, shown on first run):
bank/cash = balance, credit card = amount owed, investment = principal invested so far.
Only entries dated on or after that date move the account's balance; earlier entries still count in income/expense reports.

### Credit cards
A swipe is an expense from the card account. The bill payment is a transfer bank → card, so spending is counted once.
Card outstanding = opening outstanding + debits − payments.

### Investments
Open principal per investment account = opening principal + invested − principal redeemed.
A redeem cannot close more principal than is open. An invest entry that has been redeemed against can't be deleted.

## Tables

| Table | Key fields |
| --- | --- |
| accounts | name, kind, opening_balance (card: stored negative), opening_date, active, sort_order |
| categories | name, kind (expense/income), description, is_system, active, sort_order |
| payment_modes | name, active, sort_order |
| entries | date, type, amount, category_id, from_account_id, to_account_id, payment_mode_id, principal_amount, note, created_at, updated_at |
| schema_version | version, name, applied_at |

Master data is never hard-deleted once used; it is deactivated so history stays intact.

## API

| Method & path | Purpose |
| --- | --- |
| `GET/POST /api/entries`, `GET/PUT/DELETE /api/entries/<id>` | entries; list filters: month, from, to, type, category_id, account_id, payment_mode_id, q, limit, offset |
| `GET /api/masters`, `POST /api/masters/<table>`, `PUT/DELETE /api/masters/<table>/<id>` | accounts, categories, payment_modes |
| `PUT /api/masters/accounts/opening` | save starting balances of many accounts at once |
| `GET /api/reports/dashboard?month=` | month summary, previous month, top categories, 12-month series, balances |
| `GET /api/reports/summary · monthly · categories · grid · payment-modes · balances` | consolidated figures for `?month=` or `?from=&to=` |
| `GET /api/system/info · backups`, `POST /api/system/backups`, `GET /api/system/export.csv` | info, backups, CSV export |

## Security

| Item | Design |
| --- | --- |
| Account | Single user. Email + password (min 10 chars), stored as salted scrypt hash |
| MFA | Authenticator app (TOTP, RFC 6238: 30 s, 6 digits, SHA-1), ±1 step drift, a code can't be reused |
| Session | Flask signed cookie (HttpOnly, SameSite=Strict), key in `data/secret.key`; stages `mfa_setup → mfa → ok` |
| Expiry | 30 min idle (configurable), 12 h max; password change/reset signs out other sessions (password_version) |
| Lockout | 5 failed passwords/codes → 5 min lock |
| Forgot password | Email with one-time link (token stored as SHA-256, 30 min, single use); MFA still required after reset |
| Email | SMTP (Gmail app password etc.), set in Settings → Security; stored in local `settings` table |
| Recovery without email | `python3 run.py --reset-password` / `--reset-mfa` (needs access to this computer) |
| CSRF | All non-GET API calls need header `X-Requested-With: KanakkuPusthakam` + SameSite=Strict cookie |
| Tables | users, password_resets, settings (migration 004) |

## Safety

- Migrations (`backend/migrations/NNN_*.sql`) run automatically on start; a backup is taken first.
- One automatic backup per day (60 kept) plus manual "Back up now".
- Server binds to 127.0.0.1 only.

## Roadmap

| Phase | Feature |
| --- | --- |
| 2 | Investment module: holdings, units/NAV, current value, net worth |
| 3 | Category budgets; recurring entries (rent, SIP, EMI) |
| 4 | Bank / card statement CSV import with duplicate detection |
