"""/api/budget - the Monthly Budget: your own income and expense items, amounts per month, payments ticked as done."""
from flask import Blueprint, Response, jsonify, request

from ..errors import ApiError
from ..services import budget as svc
from ..services import budget_xlsx

bp = Blueprint("budget", __name__)


def _body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the form as JSON")
    return data


def _sheet(status=200):
    return jsonify(svc.sheet()), status


@bp.get("/budget")
def sheet():
    return _sheet()


@bp.get("/budget/export.xlsx")
def export_xlsx():
    """The budget as a styled Excel file: every month that has entries, in one sheet."""
    data, name = budget_xlsx.build()
    if data is None:
        raise ApiError("Nothing to export yet: add amounts to a month first", 404)
    return Response(data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@bp.post("/budget/items")
def add_item():
    svc.add_item(_body())
    return _sheet(201)


@bp.put("/budget/items/<int:item_id>")
def rename_item(item_id):
    svc.rename_item(item_id, _body())
    return _sheet()


@bp.delete("/budget/items/<int:item_id>")
def delete_item(item_id):
    svc.delete_item(item_id)
    return _sheet()


@bp.put("/budget/<month>")
def save(month):
    svc.save(month, _body().get("items"))
    return _sheet()


@bp.post("/budget/<month>/copy")
def copy(month):
    svc.copy(month, _body().get("from"))
    return _sheet()


@bp.post("/budget/months")
def add_month():
    svc.add_month(_body().get("month"))
    return _sheet(201)


@bp.post("/budget/<month>/clear")
def clear(month):
    svc.clear(month)
    return _sheet()


@bp.delete("/budget/<month>")
def delete_month(month):
    svc.delete_month(month)
    return _sheet()
