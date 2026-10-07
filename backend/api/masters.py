"""/api/masters - accounts, categories, payment modes."""
from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..services import masters as svc

bp = Blueprint("masters", __name__)


def _body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the item as JSON")
    return data


@bp.get("/masters")
def all_masters():
    return jsonify(svc.all_masters())


@bp.put("/masters/accounts/opening")
def set_opening_balances():
    data = request.get_json(silent=True)
    return jsonify(svc.set_opening_balances(data.get("items") if isinstance(data, dict) else None))


@bp.get("/masters/<table>")
def list_items(table):
    return jsonify(svc.list_items(table))


@bp.post("/masters/<table>")
def create_item(table):
    return jsonify(svc.create(table, _body())), 201


@bp.put("/masters/<table>/<int:item_id>")
def update_item(table, item_id):
    return jsonify(svc.update(table, item_id, _body()))


@bp.delete("/masters/<table>/<int:item_id>")
def delete_item(table, item_id):
    svc.delete(table, item_id)
    return jsonify({"deleted": item_id})
