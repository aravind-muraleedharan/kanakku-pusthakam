# Security

## What this app is designed for

Kanakku Pusthakam is a **single-user app that runs on your own computer**. The server listens on
`127.0.0.1` only, so other devices on your network or the internet can't reach it.

## What protects your data

- Login with a password (stored as a salted scrypt hash) **and** a 6-digit code from an authenticator app
- 5 wrong passwords or codes lock logins for 5 minutes; idle sessions end after 30 minutes
- Password reset links are single-use and expire after 30 minutes; the authenticator is still required afterwards
- Session cookies are HttpOnly and SameSite=Strict; state-changing API calls require a custom header (CSRF protection)

## What it does not protect against

- **The database file is not encrypted.** `data/expenses.db` is a normal file. Anyone who can log in to your
  computer account can copy it. Use a password on your computer account and disk encryption if possible.
- Someone with access to your computer can run `python3 run.py --reset-password` / `--reset-mfa`.
  This is deliberate, so you can't lock yourself out of your own data.
- Exposing the app beyond localhost (`--host 0.0.0.0`, port forwarding, a reverse proxy) is **not supported**.

## Reporting a problem

Please open a GitHub issue **without** sensitive details, or contact the maintainer privately through GitHub,
and describe the steps to reproduce.
