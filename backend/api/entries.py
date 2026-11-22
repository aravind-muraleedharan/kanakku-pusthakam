"""/api/entries - add, edit, delete and list entries."""
from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..services import entries as svc
from ..services import loans as loans_svc

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
    e = svc.get(entry_id)
    ev = loans_svc.event_for_entry(entry_id)       # part of a loan payment: deleting it removes the whole payment
    if ev:
        e["loan_payment"] = {"loan_id": ev["loan_id"], "loan": ev["loan_name"], "kind": ev["kind"],
                             "entries": len([x for x in (ev["entry_ids"] or "").split(",") if x])}
    return jsonify(e)


@bp.put("/entries/<int:entry_id>")
def update_entry(entry_id):
    return jsonify(svc.update(entry_id, _body()))


@bp.delete("/entries/<int:entry_id>")
def delete_entry(entry_id):
    if not loans_svc.remove_event_of_entry(entry_id):
        svc.delete(entry_id)
    return jsonify({"deleted": entry_id})
