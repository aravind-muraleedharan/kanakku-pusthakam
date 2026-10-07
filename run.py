#!/usr/bin/env python3
"""Start the Kanakku Pusthakam.

    python3 run.py            start on http://127.0.0.1:5000
    python3 run.py --open     start and open the browser
    python3 run.py --port 5050
    python3 run.py --reset-password   forgot your password and email isn't working
    python3 run.py --reset-mfa        lost your phone: set up the authenticator again at next login

Flask is bundled in vendor/flask-bundle.zip, so no pip install or internet is needed.
"""
import argparse
import getpass
import os
import sys
import threading
import webbrowser

if sys.version_info < (3, 10):
    sys.exit(f"Kanakku Pusthakam needs Python 3.10 or newer; this is Python {sys.version.split()[0]}. "
             "Install a newer Python from https://www.python.org/downloads/")

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

try:
    import flask  # noqa: F401  (use an installed Flask if there is one)
except ImportError:
    sys.path.insert(1, os.path.join(ROOT, "vendor", "flask-bundle.zip"))

from backend import config, create_app  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Kanakku Pusthakam")
    parser.add_argument("--host", default=config.HOST)
    parser.add_argument("--port", type=int, default=config.PORT)
    parser.add_argument("--open", action="store_true", help="open the app in the browser")
    parser.add_argument("--reset-password", action="store_true", help="set a new login password (no email needed)")
    parser.add_argument("--reset-mfa", action="store_true", help="remove the authenticator; set it up again at next login")
    parser.add_argument("--demo", action="store_true",
                        help="try the app with sample data (separate demo-data/ folder, your real data is untouched)")
    args = parser.parse_args()

    if args.demo:
        demo_dir = os.path.join(ROOT, "demo-data")
        config.DB_PATH = os.path.join(demo_dir, "expenses.db")
        config.BACKUP_DIR = os.path.join(demo_dir, "backups")

    if args.reset_password or args.reset_mfa:
        return reset_from_terminal(args)

    app = create_app({"DB_PATH": config.DB_PATH, "BACKUP_DIR": config.BACKUP_DIR})
    if args.demo:
        from backend.demo import seed_demo
        if seed_demo(app):
            print("  Demo: sample data created. Create any login on first open (it stays in demo-data/).")
    url = f"http://{args.host}:{args.port}"
    print(f"\n  Kanakku Pusthakam running at {url}{'  [DEMO]' if args.demo else ''}")
    print(f"  Data: {config.DB_PATH}")
    print("  Press Ctrl+C to stop.\n")
    if args.open:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    serve(app, args.host, args.port)


def serve(app, host, port):
    """Use the Waitress production server if it is installed; otherwise Werkzeug's threaded server, quietly.

    Either is fine here: the app listens on 127.0.0.1 only and has a single user.
    """
    try:
        from waitress import serve as waitress_serve
    except ImportError:
        waitress_serve = None
    if waitress_serve:
        print("  Server: Waitress")
        waitress_serve(app, host=host, port=port, threads=8, ident="Kanakku Pusthakam")
        return
    import logging
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.WARNING)   # no line per request
    server = make_server(host, port, app, threaded=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
    finally:
        server.server_close()


def reset_from_terminal(args):
    """Recovery that needs access to this computer instead of email."""
    from backend import db
    from backend.errors import ApiError
    from backend.services import auth

    create_app({"DB_PATH": config.DB_PATH, "BACKUP_DIR": config.BACKUP_DIR})   # makes sure the database is up to date
    conn = db.connect(config.DB_PATH)
    try:
        if not conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
            print("No account yet. Start the app and create one.")
            return 1
        if args.reset_password:
            while True:
                pw = getpass.getpass("New password: ")
                if pw != getpass.getpass("Repeat new password: "):
                    print("  The passwords don't match. Try again.")
                    continue
                try:
                    auth.cli_reset_password(conn, pw)
                    break
                except ApiError as e:
                    print(f"  {e.message}")
            print("Password changed. Existing logins were signed out.")
        if args.reset_mfa:
            auth.cli_reset_mfa(conn)
            print("Authenticator removed. At your next login you'll scan a new QR code.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
