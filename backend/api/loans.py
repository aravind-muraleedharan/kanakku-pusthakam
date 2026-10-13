"""/api/loans - personal loans and credit card EMIs."""
from flask import Blueprint, jsonify, request

from ..errors import ApiError
from ..services import loans as svc

bp = Blueprint("loans", __name__)


def _body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the details as JSON")
    return data


@bp.get("/loans")
def overview():
    return jsonify(svc.overview())


@bp.post("/loans")
def create():
    return jsonify(svc.create(_body())), 201


@bp.get("/loans/<int:loan_id>")
def get(loan_id):
    return jsonify(svc.get(loan_id))


@bp.put("/loans/<int:loan_id>")
def update(loan_id):
    return jsonify(svc.update(loan_id, _body()))


@bp.delete("/loans/<int:loan_id>")
def delete(loan_id):
    svc.delete(loan_id)
    return jsonify({"deleted": loan_id})


@bp.post("/loans/<int:loan_id>/emi")
def pay_emi(loan_id):
    return jsonify(svc.pay_emi(loan_id, _body())), 201


@bp.post("/loans/<int:loan_id>/prepay")
def prepay(loan_id):
    return jsonify(svc.prepay(loan_id, _body())), 201


@bp.post("/loans/<int:loan_id>/close")
def close(loan_id):
    return jsonify(svc.prepay(loan_id, _body(), foreclose=True)), 201


@bp.post("/loans/<int:loan_id>/undo")
def undo(loan_id):
    return jsonify(svc.undo_last(loan_id))
