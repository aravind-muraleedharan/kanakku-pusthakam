"""/api/system - backups, CSV export, app info."""
import csv
import io
from datetime import datetime

import os
import tempfile

from flask import Blueprint, Response, current_app, jsonify, request, session

from .. import db
from ..errors import ApiError
from ..services import backup as backup_svc
from ..services import entries as entries_svc

bp = Blueprint("system", __name__)

APP_VERSION = "1.0.0"


@bp.get("/system/info")
def info():
    version = db.one("SELECT MAX(version) AS v FROM schema_version")["v"]
    count = db.one("SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM entries")
    return jsonify({
        "app_version": APP_VERSION,
        "schema_version": version,
        "db_path": current_app.config["DB_PATH"],
        "backup_dir": current_app.config["BACKUP_DIR"],
        "entries": count["n"],
        "first_entry": count["first"],
        "last_entry": count["last"],
        "backup_folder": backup_svc.last_folder(),
    })


@bp.get("/system/backups")
def backups():
    return jsonify(db.list_backups(current_app.config["BACKUP_DIR"]))


@bp.post("/system/backups")
def make_backup():
    path = db.backup(db.get_db(), current_app.config["BACKUP_DIR"], label="manual")
    return jsonify({"file": path.rsplit("/", 1)[-1]}), 201


@bp.post("/system/backup-to")
def backup_to():
    data = request.get_json(silent=True) or {}
    return jsonify(backup_svc.backup_to(data.get("path"))), 201


@bp.post("/system/restore")
def restore_upload():
    """Restore from a database file chosen in the browser (multipart: file, password)."""
    up = request.files.get("file")
    if not up or not up.filename:
        raise ApiError("Choose the backup file", field="file")
    os.makedirs(current_app.config["BACKUP_DIR"], exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".restore", dir=current_app.config["BACKUP_DIR"])
    os.close(fd)
    try:
        up.save(tmp)
        result = backup_svc.restore_from(tmp, request.form.get("password"))
    finally:
        os.remove(tmp)
    session.clear()                          # log in again (the restored data has its own login)
    return jsonify(result)


@bp.post("/system/restore-backup")
def restore_listed():
    data = request.get_json(silent=True) or {}
    result = backup_svc.restore_named_backup(data.get("file"), data.get("password"))
    session.clear()
    return jsonify(result)


def _cell(text):
    """Text cells that start like a formula (=, +, -, @, tab, CR) get a leading apostrophe, so Excel/LibreOffice
    show them as text instead of running them."""
    text = text or ""
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@bp.get("/system/export.csv")
def export_csv():
    """All entries (or the filtered set) as CSV, ready for Excel."""
    args = dict(request.args)
    args["limit"] = 1_000_000
    where, params = entries_svc.build_filters(args)
    data = db.rows(entries_svc.SELECT + where + " ORDER BY e.date, e.id", params)
    buf = io.StringIO()
    buf.write("﻿")   # BOM so Excel reads ₹ and Malayalam/Unicode notes correctly
    w = csv.writer(buf)
    w.writerow(["Date", "Type", "Amount", "Category", "From account", "To account",
                "Payment mode", "Principal (redeem)", "Gain (redeem)", "Note"])
    for r in data:
        gain = ""
        if r["type"] == "redeem" and r["principal_amount"] is not None:
            gain = f"{(r['amount'] - r['principal_amount']) / 100:.2f}"
        w.writerow([
            r["date"], r["type"].title(), f"{r['amount'] / 100:.2f}", _cell(r["category"]),
            _cell(r["from_account"]), _cell(r["to_account"]), _cell(r["payment_mode"]),
            f"{r['principal_amount'] / 100:.2f}" if r["principal_amount"] is not None else "", gain,
            _cell(r["note"]),
        ])
    name = f"expenses_{datetime.now().strftime('%Y-%m-%d')}.csv"
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={name}"})
