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

Payment mode (UPI, Credit Card, Debit Card, Cash, Net Banking, Reward Points, Other — Other asks what it was and keeps
that text in `entries.payment_mode_other`, shown in place of "Other") is recorded separately from the account and is
pre-filled from the account (card → Credit Card, cash → Cash, bank → UPI).

### Starting balances
Each account has a starting balance **as on a date** (Settings → Starting balances, shown on first run):
bank/cash = balance, credit card = amount owed, investment = principal invested so far.
Only entries dated on or after that date move the account's balance; earlier entries still count in income/expense reports.

### Money Manager
One page (sidebar) for everything you have and owe: Bank Accounts (bank, savings/current/salary), Credit Cards
(issuer, optional limit, bill day and due day → limit used, next due date), Cash, plus summaries of Investments and
Loans & EMIs with links to their pages. Net worth = bank + cash + investments − card outstanding − loans.
Settings keeps only categories, payment modes, security and backup.

### Credit cards
A swipe is an expense from the card account. The bill payment is a transfer bank → card, so spending is counted once.
Card outstanding = opening outstanding + debits − payments.

### Investments
Open principal per investment account = opening principal + invested − principal redeemed − share withdrawals.
A redeem cannot close more principal than is open. An invest entry that has been redeemed against can't be deleted.

Every investment account has a type (`investment_details.type_id` → `investment_types`, migration 009). There are 8
built-in types; new types are added in code, as a migration that inserts a row into `investment_types` (the app has
no screen for creating types). A type "works like" one of the built-in calculations; `investment_details.inv_type` holds that calculation code, so every rule below applies to your own types
too (e.g. NSC works like FD, Mutual Fund works like Simple holding, a gold tree works like Gold Coin). A type can also
have up to 12 extra fields of your own (text, number, date, dropdown; optional or required). Their values are stored
as JSON in `investment_details.extra` and are never used in a calculation. Field keys (`f1`, `f2`…) never change, so
renaming a field keeps its values.

**Close** (migration 010) records how an investment ended (matured, broken early, sold out): closing date, amount
received and the bank it came into. Stocks → a transfer of what came back (never income); gold / silver → every item
held is marked sold, the amount shared by cost, plus a redeem; everything else → a redeem of all the open principal
(received − principal counts as income or loss). It's stored in `investment_details.closed_on / closed_amount /
close_entry_id / close_note`, and the account becomes inactive (Closed, left out of totals and net worth).
"Closed early" = closing date before the maturity date. **Undo closing** deletes the closing transaction and un-sells items.

**Delete** removes an investment with everything on it, including its money transactions (bank balances go back as if
they never happened). A backup (`…_before-delete.db`) is saved first when it had transactions.

RD instalments are due on `investment_details.due_day` (migration 011; default the start date's day). The next due date
is the month of the next unpaid instalment; it shows on the RD, in the list and under Coming up.
Gold coin / silver bar purchases record date, amount paid, buy rate (₹/g), weight, bill name, the account paid from and a
transaction document reference (`metal_items.bill_name`, `doc`); built-in coins / bars are 999 purity, other gold-like
types choose 24K / 22K / 18K.

**Chit Fund** is set up like an RD without interest: monthly instalment, due day, start, months, instalments already paid
and (optionally) the real amount paid so far (dividends lower some instalments). Each payment is an invest entry; the
prize is recorded with "Prize received" (a redeem: prize − principal closed counts as income), or with Close at the end.
A chit created the older way (just an amount invested so far) keeps working as before.

**Gold Tree** (migration 013) is a jeweller's gold savings scheme. It works like Gold Coin (each payment is a purchase
with its weight and purity) and is set up like an RD: monthly amount (`amount`), start date, months (`term_months`), due
day; maturity = start + months. Payments are counted per month (an extra purchase in the same month counts once), giving
instalments paid / missed and the next due date. A scheme started earlier records `prepaid_instalments` (migration 014;
those first months count as paid); the money paid so far is the account's opening amount (count × monthly amount
unless entered) and the grams so far are `opening_grams` (migration 015), both editable later. A type is a scheme when it works like gold and is named "Gold Tree".

FD tenure is years + months + days (stored as `term_months` + `term_days`; maturity = start + months + days). RD tenure is
whole months. FD / RD / PPF are held at one of your bank accounts (`held_at_account_id`). Simple holdings can be given a
typed-in current value (`current_value` as on `current_value_date`); money added or principal redeemed after that date
is added / taken off.

Valued per calculation:

| Type | Money in / out | Value today | Counts as income |
| --- | --- | --- | --- |
| Stocks | invest (funds added); **transfer** to bank (withdrawal) | net funds + total profit | never (profit, dividends, withdrawals stay inside) |
| FD | invest (or "already held": deposit = opening, as on start date); redeem on closing | quarterly compounding + simple interest for the part quarter; payout FDs stay at principal | payouts (Interest - FD) and gain on closing |
| RD | invest per instalment; redeem on closing | each instalment compounded quarterly | gain on closing |
| PPF | invest deposits; redeem withdrawals | monthly lowest-balance interest (deposit by the 5th), credited each March | gain on withdrawal |
| Gold coins / silver bars | items (weight, purity, rate on purchase day, total paid, premium); optional invest/redeem | what you paid (no market rate) | sale gain |
| Chit Fund / Simple holding | invest / redeem | open principal, or the value you typed in (± later money in / out) | gain on redeem |

Share journal (`share_actions`): date, stocks, action, profit **before** charges, charges per action.
Actions: CNC Buy, CNC Sell, MTF Buy, MTF Sell, Intraday, Others (Others stores its own name in `action_other`,
e.g. F&O). Buys carry no profit. Migration 016 turned old Buy/Sell into CNC Buy/CNC Sell.
Total profit = CNC sell + MTF sell + intraday + others − charges; gain % = total profit ÷ funds added.
Dividends are paid into the bank, so they are listed on the account but never added to its profit or value;
moving that money into the trading account is an ordinary Add funds.
Goal: % of funds added (or a forecast profit) by a date.
Stocks accounts can't be redeemed, and only stocks accounts may be the "from" side of a transfer out of an investment.

### Loans & EMIs
Loan amount, EMI and tenure are entered; the interest rate is worked out from them (0% = no-cost EMI), and an
"effective" rate including the charges is shown too. The schedule is computed month by month (interest rounded to the
rupee) and replays prepayments where they happened: *reduce tenure* keeps the EMI, *reduce EMI* keeps the end date.

| Kind | Start | Each EMI | Prepay / close |
| --- | --- | --- | --- |
| Credit card EMI | charges = expense on the card (the purchase itself is not recorded) | expense on the card, purchase's category | expense on the card |
| Personal / other loan | own `loan` account; transfer loan → bank (amount − charges) + charges as expense | transfer bank → loan (principal) + expense (interest, "Loan Interest & Charges") | transfer bank → loan + charges expense |

A loan that's already running (EMIs paid before tracking) starts its loan account at the outstanding amount, as on the
day after the last of those EMIs. Every action is a `loan_events` row listing the entries it made, so "Undo last" and
"Delete loan" remove exactly those entries. Net worth = bank & cash + investments − card outstanding − loans outstanding.

## Tables

| Table | Key fields |
| --- | --- |
| accounts | name, kind, opening_balance (card: stored negative), opening_date, active, sort_order |
| categories | name, kind (expense/income), description, is_system, active, sort_order |
| payment_modes | name, active, sort_order |
| entries | date, type, amount, category_id, from_account_id, to_account_id, payment_mode_id, principal_amount, note, created_at, updated_at |
| investment_details | account_id, type_id, inv_type (calculation), institution, held_at_account_id, amount, rate, start_date, term_months, term_days, maturity_date, payout, goal_pct, goal_profit, goal_date, current_value, current_value_date, extra (JSON), notes |
| investment_types (009) | name, works_like, builtin (code of the 8 built-in types), fields (JSON), active, sort_order |
| share_actions / share_dividends | trading journal and dividends per share account |
| metal_items | gold coins / silver bars, each with its purchase-day rate (migration 008; metal_rates dropped) |
| loans / loan_events | loan terms (rate worked out) and every EMI, prepayment, closure with its entry ids (migration 006 also adds account kind `loan`) |
| accounts (007) | + institution, subtype, credit_limit, bill_day, due_day |
| schema_version | version, name, applied_at |

Master data is never hard-deleted once used; it is deactivated so history stays intact.

## API

| Method & path | Purpose |
| --- | --- |
| `GET/POST /api/entries`, `GET/PUT/DELETE /api/entries/<id>` | entries; list filters: month, from, to, type, category_id, account_id, payment_mode_id, q, limit, offset |
| `GET /api/masters`, `POST /api/masters/<table>`, `PUT/DELETE /api/masters/<table>/<id>` | accounts, categories, payment_modes |
| `PUT /api/masters/accounts/opening` | save starting balances of many accounts at once |
| `GET /api/reports/dashboard?month=` | month summary, previous month, top categories, 12-month series, balances |
| `GET /api/reports/money` | Money Manager: banks, cards (limit, due), cash, investment and loan summaries, net worth |
| `GET /api/reports/summary · monthly · categories · grid · payment-modes · balances` | consolidated figures for `?month=` or `?from=&to=` |
| `GET/POST /api/investments`, `GET/PUT /api/investments/<id>` | overview (by type, upcoming) / create; one investment with its summary |
| `POST /api/investments/<id>/funds · withdraw · redeem · payout` | money in / out (normal entries underneath) |
| `POST /api/investments/<id>/value` | type in a simple holding's current value (empty = back to at cost) |
| `GET /api/investment-types` | investment types and their extra fields (read only) |
| `DELETE /api/investments/<id>` | delete with all its records and transactions (backup first) |
| `POST /api/investments/<id>/close · reopen` | close (date, amount, to_account_id, note) / undo closing |
| `POST/PUT/DELETE /api/investments/<id>/actions[/<aid>]`, `POST/DELETE …/dividends[/<did>]` | share journal |
| `POST /api/investments/<id>/items`, `POST …/items/<iid>/sell`, `DELETE …/items/<iid>` | gold / silver items |
| `GET/POST /api/loans`, `GET/PUT/DELETE /api/loans/<id>` | loans overview (this month's EMIs) / one loan with its schedule |
| `POST /api/loans/<id>/emi · prepay · close · undo` | pay the next EMI, prepay (mode tenure/emi), foreclose, undo the latest |
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

- **Backup to a folder** (Settings → Backup & export): a full path you type (pen drive, other disk); a dated copy is
  written with SQLite's backup API, never overwriting an existing file; the folder is remembered.
- **Restore** from an uploaded .db file or from the automatic backups list: needs your password; the file must be an
  undamaged database from this app and not from a newer version; current data is saved first (`pre-restore`),
  then the backup is copied in, older schemas are upgraded, and you log in again.
- Hardening: amounts must be plain numbers (no 1e5/NaN/Infinity, max ₹1 lakh crore); oversized ids → 404; requests
  over 64 MB refused; CSV export prefixes formula-like cells with ' ; run.py refuses a non-local --host unless
  --allow-network is given; generic error message on 500 (details only in the terminal).

- Works fully offline. The page's Content-Security-Policy lets it load and send data only to this app on 127.0.0.1;
  no CDNs, fonts or analytics. The one optional outside connection is the forgot-password email (SMTP), used only
  if mail settings are filled in.

- Migrations (`backend/migrations/NNN_*.sql`) run automatically on start; a backup is taken first.
- Automatic backup once a week (and before upgrades and restores); the backups folder keeps only the newest 10 files.
- Server binds to 127.0.0.1 only, and refuses any request whose Host header isn't 127.0.0.1 / localhost / ::1
  (blocks "DNS rebinding", where a web page points its own name at 127.0.0.1 to talk to the app). With
  --allow-network the --host name is allowed too.
- Files are private to you: the app runs with umask 077 and sets data/ and backups/ to 700 and their .db / key
  files to 600 on every start.
- Browsers aren't allowed to remember what you type: every field without its own autocomplete setting gets
  autocomplete="off" (login fields keep theirs, for password managers).

## Roadmap

| Phase | Feature |
| --- | --- |
| 2 | ✓ Investments (shares journal, FD, RD, PPF, gold, silver), net worth. ✓ Loans & EMIs. Next: share-tracker import |
| 3 | Category budgets; recurring entries (rent, SIP, EMI) |
| 4 | Bank / card statement CSV import with duplicate detection |
