"""App settings. Override any of these with environment variables if needed."""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HOST = os.environ.get("AET_HOST", "127.0.0.1")          # localhost only: not reachable from other devices
PORT = int(os.environ.get("AET_PORT", "5000"))

DATA_DIR = os.environ.get("AET_DATA_DIR", os.path.join(BASE_DIR, "data"))
DB_PATH = os.environ.get("AET_DB_PATH", os.path.join(DATA_DIR, "expenses.db"))
BACKUP_DIR = os.environ.get("AET_BACKUP_DIR", os.path.join(BASE_DIR, "backups"))
EXPORT_DIR = os.path.join(BASE_DIR, "exports")

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
MIGRATIONS_DIR = os.path.join(BASE_DIR, "backend", "migrations")

KEEP_DAILY_BACKUPS = int(os.environ.get("AET_KEEP_BACKUPS", "60"))   # automatic backups to keep
