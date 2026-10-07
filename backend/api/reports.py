"""/api/reports - dashboard and consolidated figures."""
import re
from datetime import date

from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..services import reports as svc

bp = Blueprint("reports", __name__)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _month(arg="month"):
    m = request.args.get(arg) or date.today().strftime("%Y-%m")
    if not MONTH_RE.match(m):
        raise ApiError("Month must be YYYY-MM", field=arg)
    return m


def _range():
    """Accepts ?month=YYYY-MM, or ?from=YYYY-MM-DD&to=YYYY-MM-DD, or nothing (all time)."""
    if request.args.get("month"):
        return svc.month_bounds(_month())
    dfrom, dto = request.args.get("from") or None, request.args.get("to") or None
    for v, f in ((dfrom, "from"), (dto, "to")):
        if v and not DATE_RE.match(v):
            raise ApiError("Dates must be YYYY-MM-DD", field=f)
    return dfrom, dto


@bp.get("/reports/dashboard")
def dashboard():
    return jsonify(svc.dashboard(_month()))


@bp.get("/reports/summary")
def summary():
    return jsonify(svc.summary(*_range()))


@bp.get("/reports/monthly")
def monthly():
    return jsonify(svc.monthly(*_range()))


@bp.get("/reports/categories")
def categories():
    dfrom, dto = _range()
    return jsonify(svc.category_totals(request.args.get("kind", "expense"), dfrom, dto))


@bp.get("/reports/grid")
def grid():
    dfrom, dto = _range()
    return jsonify(svc.month_category_grid(dfrom, dto, request.args.get("kind", "expense")))


@bp.get("/reports/payment-modes")
def payment_modes():
    return jsonify(svc.group_totals("payment_mode_id", "payment_modes", *_range()))



@bp.get("/reports/balances")
def balances():
    return jsonify(svc.balances(request.args.get("as_of") or None))
