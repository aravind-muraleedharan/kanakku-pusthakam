"""/api/system - backups, CSV export, app info."""
import csv
import io
from datetime import datetime

from flask import Blueprint, Response, current_app, jsonify, request

from .. import db
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
    })


@bp.get("/system/backups")
def backups():
    return jsonify(db.list_backups(current_app.config["BACKUP_DIR"]))


@bp.post("/system/backups")
def make_backup():
    path = db.backup(db.get_db(), current_app.config["BACKUP_DIR"], label="manual")
    return jsonify({"file": path.rsplit("/", 1)[-1]}), 201


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
            r["date"], r["type"].title(), f"{r['amount'] / 100:.2f}", r["category"] or "",
            r["from_account"] or "", r["to_account"] or "", r["payment_mode"] or "",
            f"{r['principal_amount'] / 100:.2f}" if r["principal_amount"] is not None else "", gain,
            r["note"] or "",
        ])
    name = f"expenses_{datetime.now().strftime('%Y-%m-%d')}.csv"
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={name}"})
