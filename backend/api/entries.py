"""/api/entries - add, edit, delete and list entries."""
from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..services import entries as svc

bp = Blueprint("entries", __name__)


def _body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the entry as JSON")
    return data


@bp.get("/entries")
def list_entries():
    return jsonify(svc.list_entries(request.args))


@bp.post("/entries")
def create_entry():
    return jsonify(svc.create(_body())), 201


@bp.get("/entries/<int:entry_id>")
def get_entry(entry_id):
    return jsonify(svc.get(entry_id))


@bp.put("/entries/<int:entry_id>")
def update_entry(entry_id):
    return jsonify(svc.update(entry_id, _body()))


@bp.delete("/entries/<int:entry_id>")
def delete_entry(entry_id):
    svc.delete(entry_id)
    return jsonify({"deleted": entry_id})
