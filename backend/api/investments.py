"""/api/investments - share accounts, FD, RD, PPF, gold, silver, chitty, your own types.
/api/investment-types - the investment types with their extra fields (read only; new types are added in code)."""
from flask import Blueprint, current_app, jsonify, request

from ..errors import ApiError
from ..services import investment_types as types_svc
from ..services import investments as svc

bp = Blueprint("investments", __name__)


def _body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the details as JSON")
    return data


@bp.get("/investments")
def overview():
    return jsonify(svc.overview())


@bp.post("/investments")
def create():
    return jsonify(svc.create(_body())), 201


@bp.get("/investments/<int:acc_id>")
def get(acc_id):
    return jsonify(svc.get(acc_id))


@bp.put("/investments/<int:acc_id>")
def update(acc_id):
    return jsonify(svc.update(acc_id, _body()))


# money in / out (normal entries)
@bp.post("/investments/<int:acc_id>/funds")
def add_funds(acc_id):
    svc.add_funds(acc_id, _body())
    return jsonify(svc.get(acc_id)), 201


@bp.post("/investments/<int:acc_id>/withdraw")
def withdraw(acc_id):
    svc.withdraw(acc_id, _body())
    return jsonify(svc.get(acc_id)), 201


@bp.post("/investments/<int:acc_id>/redeem")
def redeem(acc_id):
    svc.redeem(acc_id, _body())
    return jsonify(svc.get(acc_id)), 201


@bp.delete("/investments/<int:acc_id>")
def delete(acc_id):
    svc.delete(acc_id, current_app.config["BACKUP_DIR"])
    return jsonify({"deleted": acc_id})


@bp.post("/investments/<int:acc_id>/close")
def close(acc_id):
    return jsonify(svc.close(acc_id, _body())), 201


@bp.post("/investments/<int:acc_id>/reopen")
def reopen(acc_id):
    return jsonify(svc.undo_close(acc_id))


@bp.post("/investments/<int:acc_id>/value")
def set_value(acc_id):
    return jsonify(svc.set_value(acc_id, _body()))


@bp.post("/investments/<int:acc_id>/payout")
def payout(acc_id):
    svc.record_payout(acc_id, _body())
    return jsonify(svc.get(acc_id)), 201


# share journal
@bp.post("/investments/<int:acc_id>/actions")
def add_action(acc_id):
    return jsonify(svc.add_action(acc_id, _body())), 201


@bp.put("/investments/<int:acc_id>/actions/<int:aid>")
def update_action(acc_id, aid):
    return jsonify(svc.update_action(acc_id, aid, _body()))


@bp.delete("/investments/<int:acc_id>/actions/<int:aid>")
def delete_action(acc_id, aid):
    return jsonify(svc.delete_action(acc_id, aid))


@bp.post("/investments/<int:acc_id>/dividends")
def add_dividend(acc_id):
    return jsonify(svc.add_dividend(acc_id, _body())), 201


@bp.delete("/investments/<int:acc_id>/dividends/<int:did>")
def delete_dividend(acc_id, did):
    return jsonify(svc.delete_dividend(acc_id, did))


# gold / silver items
@bp.post("/investments/<int:acc_id>/items")
def add_item(acc_id):
    return jsonify(svc.add_item(acc_id, _body())), 201


@bp.post("/investments/<int:acc_id>/items/<int:iid>/sell")
def sell_item(acc_id, iid):
    return jsonify(svc.sell_item(acc_id, iid, _body())), 201


@bp.delete("/investments/<int:acc_id>/items/<int:iid>")
def delete_item(acc_id, iid):
    return jsonify(svc.delete_item(acc_id, iid))


# investment types
@bp.get("/investment-types")
def list_types():
    return jsonify(types_svc.list_types())
