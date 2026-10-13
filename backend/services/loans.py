"""Loans and EMIs.

Two kinds, counted differently (see docs/DESIGN.md):
  * cc_emi    a card purchase converted to EMIs. Each month's EMI is an expense on the card, in the
              purchase's category. The purchase itself is not recorded as an expense.
  * personal  (and 'other') money borrowed into your bank. It has its own 'loan' account (balance = what you owe).
              Receiving the loan is a transfer (not income); each EMI is a transfer of the principal part
              (not an expense: you count the spending when you spend it) + an expense for the interest part.
Interest rate is worked out from loan amount, EMI and tenure. Prepayments reduce the tenure or the EMI.
"""
import math
from datetime import date, timedelta

from ..db import get_db, one, rows
from ..errors import ApiError
from ..money import to_paise, to_rupees
from . import entries as entries_svc
from .investments import add_months

TYPES = {"cc_emi": "Credit card EMI", "personal": "Personal loan", "other": "Other loan"}
INTEREST_CATEGORY = "Loan Interest & Charges"


# ---------------------------------------------------------------- maths

def emi_for(principal, monthly_rate, months):
    if months <= 0:
        return principal
    if not monthly_rate:
        return principal / months
    f = (1 + monthly_rate) ** months
    return principal * monthly_rate * f / (f - 1)


def solve_rate(principal, emi, months):
    """Annual interest rate (%) that makes `emi` repay `principal` in `months`. 0 for a no-cost EMI."""
    if emi * months <= principal + months:          # within rounding of EMI x months == amount
        return 0.0
    lo, hi = 0.0, 0.2                               # monthly rate: 0% .. 20% a month
    for _ in range(200):
        mid = (lo + hi) / 2
        if emi_for(principal, mid, months) > emi:
            hi = mid
        else:
            lo = mid
    return round(lo * 1200, 2)


def months_to_repay(balance, monthly_rate, emi):
    if balance <= 0:
        return 0
    if not monthly_rate:
        return math.ceil(balance / emi)
    if emi <= balance * monthly_rate:
        raise ApiError("That EMI doesn't even cover the interest")
    return math.ceil(-math.log(1 - monthly_rate * balance / emi) / math.log(1 + monthly_rate) - 1e-9)


# ---------------------------------------------------------------- helpers

def _d(s):
    return date.fromisoformat(s) if s else None


def _paise(v, field, required=True):
    try:
        p = to_paise(v)
    except ValueError as e:
        raise ApiError(str(e), field=field)
    if p is None:
        if required:
            raise ApiError("Enter an amount", field=field)
        return 0
    if p < 0:
        raise ApiError("Amount can't be negative", field=field)
    return p


def _date(v, field, default=None):
    if not v:
        if default is not None:
            return default
        raise ApiError("Choose a date", field=field)
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise ApiError("Date must be YYYY-MM-DD", field=field)


def _int(v, field, lo, hi, default=None):
    if v in (None, "") and default is not None:
        return default
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ApiError("Enter a whole number", field=field)
    if not lo <= n <= hi:
        raise ApiError(f"Must be {lo}–{hi}", field=field)
    return n


def _acc(account_id, kinds, field, label):
    a = one("SELECT * FROM accounts WHERE id = ?", (account_id,)) if account_id not in (None, "") else None
    if not a or a["kind"] not in kinds:
        raise ApiError(f"Choose {label}", field=field)
    return a


def _interest_cat():
    r = one("SELECT id FROM categories WHERE name = ? AND kind = 'expense'", (INTEREST_CATEGORY,))
    if not r:
        r = one("SELECT id FROM categories WHERE kind = 'expense' AND is_system = 0 ORDER BY sort_order LIMIT 1")
    return r["id"]


def _loan(loan_id):
    ln = one("SELECT * FROM loans WHERE id = ?", (loan_id,))
    if not ln:
        raise ApiError("Loan not found", status=404)
    return ln


def _events(loan_id):
    return rows("SELECT * FROM loan_events WHERE loan_id = ? ORDER BY date, id", (loan_id,))


# ---------------------------------------------------------------- schedule

def schedule(ln, events=None, today=None):
    """Month-by-month plan with what's been paid, applying prepayments where they happened."""
    today = (today or date.today()).isoformat()
    events = _events(ln["id"]) if events is None else events
    r = (ln["rate"] or 0) / 1200
    emis = {e["installment_no"]: e for e in events if e["kind"] == "emi"}
    prepays = [e for e in events if e["kind"] in ("prepay", "foreclose")]
    first = _d(ln["first_emi_date"])
    bal, emi, left = ln["principal"], ln["emi"], ln["tenure_months"]
    out, i = [], 0
    while bal > 0 and i < 600:
        for p in [p for p in prepays if p["installment_no"] == i]:
            bal -= p["principal"]
            out.append({"kind": p["kind"], "date": p["date"], "principal": p["principal"], "charges": p["charges"],
                        "mode": p["mode"], "balance": max(bal, 0), "event_id": p["id"]})
            if bal <= 0 or p["kind"] == "foreclose":
                bal = 0
                break
            if p["mode"] == "emi":
                emi = math.ceil(emi_for(bal, r, left) / 100) * 100      # whole rupees
            else:
                left = months_to_repay(bal, r, emi)
        if bal <= 0:
            break
        due = add_months(first, i).isoformat()
        rec = emis.get(i)
        interest = round(bal * r / 100) * 100            # banks round interest to the rupee
        if rec:
            principal, interest, amount = rec["principal"], rec["interest"], rec["amount"]
        else:
            principal = bal if left <= 1 else min(emi - interest, bal)
            amount = principal + interest
        status = "before" if i < ln["paid_before"] else "paid" if rec else "due" if due <= today else "upcoming"
        bal -= principal
        out.append({"kind": "emi", "no": i + 1, "date": due, "amount": amount, "principal": principal,
                    "interest": interest, "balance": max(bal, 0), "status": status,
                    "event_id": rec["id"] if rec else None})
        left -= 1
        i += 1
    return out, emi


def summary(ln, today=None):
    events = _events(ln["id"])
    sched, current_emi = schedule(ln, events, today)
    inst = [s for s in sched if s["kind"] == "emi"]
    done = [s for s in inst if s["status"] in ("before", "paid")]
    pending = [s for s in inst if s["status"] in ("due", "upcoming")]
    prepaid = sum(s["principal"] for s in sched if s["kind"] in ("prepay", "foreclose"))
    outstanding = 0 if ln["status"] == "closed" else max(0, ln["principal"] - sum(s["principal"] for s in done) - prepaid)
    nxt = pending[0] if pending and ln["status"] == "active" else None
    eff = solve_rate(ln["principal"] - ln["charges"], ln["emi"], ln["tenure_months"]) if ln["charges"] else ln["rate"]
    disb = next((e for e in events if e["kind"] == "disbursal"), None)
    return {
        "outstanding": to_rupees(outstanding),
        "emi": to_rupees(current_emi),
        "paid_count": len(done), "total_count": len(inst), "due_count": sum(s["status"] == "due" for s in inst),
        "next": {**_money_row(nxt)} if nxt else None,
        "end_date": inst[-1]["date"] if inst else None,
        "interest_paid": to_rupees(sum(s["interest"] for s in done)),
        "interest_left": to_rupees(sum(s["interest"] for s in pending) if ln["status"] == "active" else 0),
        "total_interest": to_rupees(sum(s["interest"] for s in inst)),
        "prepaid": to_rupees(prepaid),
        "effective_rate": eff,
        "progress_pct": round((ln["principal"] - outstanding) * 100 / ln["principal"], 1),
        "disbursed": bool(disb),
        "schedule": [_money_row(s) for s in sched],
    }


def _money_row(s):
    out = dict(s)
    for k in ("amount", "principal", "interest", "balance", "charges"):
        if k in out and out[k] is not None:
            out[k] = to_rupees(out[k])
    return out


def _out(ln, today=None):
    names = {a["id"]: a["name"] for a in rows("SELECT id, name FROM accounts")}
    cat = one("SELECT name FROM categories WHERE id = ?", (ln["category_id"],)) if ln["category_id"] else None
    o = {k: ln[k] for k in ("id", "name", "loan_type", "lender", "account_id", "bank_account_id", "category_id",
                            "tenure_months", "rate", "first_emi_date", "paid_before", "status", "closed_date", "notes")}
    o.update(principal=to_rupees(ln["principal"]), emi_original=to_rupees(ln["emi"]), charges=to_rupees(ln["charges"]),
             type_label=TYPES[ln["loan_type"]], account=names.get(ln["account_id"]),
             bank_account=names.get(ln["bank_account_id"]), category=cat["name"] if cat else None)
    o["summary"] = summary(ln, today)
    return o


def get(loan_id):
    return _out(_loan(loan_id))


def overview(today=None):
    today = today or date.today()
    month = today.isoformat()[:7]
    items = [_out(ln, today) for ln in rows("SELECT * FROM loans ORDER BY status, first_emi_date DESC, id DESC")]
    active = [i for i in items if i["status"] == "active"]
    this_month = []
    for i in active:
        for s in i["summary"]["schedule"]:
            if s["kind"] == "emi" and (s["date"][:7] == month or s["status"] == "due"):
                this_month.append({"loan_id": i["id"], "name": i["name"], "loan_type": i["loan_type"], **s})
    this_month.sort(key=lambda s: s["date"])
    return {
        "items": items,
        "this_month": this_month,
        "totals": {
            "outstanding": round(sum(i["summary"]["outstanding"] for i in active), 2),
            "emi_month": round(sum(s["amount"] for s in this_month if s["date"][:7] == month), 2),
            "due_count": sum(1 for s in this_month if s["status"] == "due"),
            "interest_left": round(sum(i["summary"]["interest_left"] for i in active), 2),
            "active": len(active),
        },
        "types": TYPES,
    }


def total_outstanding(today=None):
    return sum(_out(ln, today)["summary"]["outstanding"] for ln in rows("SELECT * FROM loans WHERE status = 'active'"))


# ---------------------------------------------------------------- create / edit

def _clean_terms(p, existing=None):
    ex = existing or {}
    t = p.get("loan_type", ex.get("loan_type"))
    if t not in TYPES:
        raise ApiError("Choose the kind of loan", field="loan_type")
    name = (p.get("name") or ex.get("name") or "").strip()
    if not name:
        raise ApiError("Give it a name, e.g. 'iPhone EMI' or 'HDFC personal loan'", field="name")
    c = {
        "name": name[:80], "loan_type": t,
        "lender": (p.get("lender") or "").strip()[:80] or None,
        "principal": _paise(p.get("principal"), "principal"),
        "emi": _paise(p.get("emi"), "emi"),
        "tenure_months": _int(p.get("tenure_months"), "tenure_months", 1, 600),
        "charges": _paise(p.get("charges"), "charges", required=False),
        "first_emi_date": _date(p.get("first_emi_date"), "first_emi_date"),
        "paid_before": _int(p.get("paid_before"), "paid_before", 0, 600, default=0),
        "notes": (p.get("notes") or "").strip()[:300] or None,
    }
    if not c["principal"]:
        raise ApiError("Enter the loan amount", field="principal")
    if not c["emi"]:
        raise ApiError("Enter the EMI", field="emi")
    if c["emi"] * c["tenure_months"] < c["principal"] - c["tenure_months"]:
        raise ApiError("EMI × months is less than the loan amount: check the figures", field="emi")
    if c["paid_before"] >= c["tenure_months"]:
        raise ApiError("All EMIs are already paid", field="paid_before")
    if c["charges"] >= c["principal"]:
        raise ApiError("Charges look too high", field="charges")
    c["rate"] = solve_rate(c["principal"], c["emi"], c["tenure_months"])
    if t == "cc_emi":
        c["account_id"] = _acc(p.get("account_id", ex.get("account_id")), ("credit_card",), "account_id", "the credit card")["id"]
        cat = one("SELECT * FROM categories WHERE id = ?", (p.get("category_id", ex.get("category_id")),))
        if not cat or cat["kind"] != "expense" or cat["is_system"]:
            raise ApiError("Choose what you bought (expense category)", field="category_id")
        c["category_id"] = cat["id"]
        c["bank_account_id"] = None
    else:
        c["bank_account_id"] = _acc(p.get("bank_account_id", ex.get("bank_account_id")), ("bank", "cash"),
                                    "bank_account_id", "the bank account EMIs are paid from")["id"]
        c["category_id"] = None
    return c


def create(p):
    c = _clean_terms(p)
    conn = get_db()
    fresh = c["paid_before"] == 0 and p.get("record_start") not in (False, "false", "0")
    today = date.today().isoformat()
    if c["loan_type"] != "cc_emi":
        acc_name = c["name"] if not one("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE", (c["name"],)) \
            else f"{c['name']} (loan)"
        if one("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE", (acc_name,)):
            raise ApiError(f"An account named '{acc_name}' already exists", field="name")
        if fresh:
            opening, od = 0, None
        else:
            # a running loan: you owe what's left after the EMIs already paid, as on the day after the last one
            tmp = {**c, "id": -1, "status": "active"}
            sched, _ = schedule(tmp, events=[])
            left = sum(s["principal"] for s in sched if s["kind"] == "emi" and s["no"] > c["paid_before"])
            last_paid = add_months(_d(c["first_emi_date"]), c["paid_before"] - 1)
            opening, od = -left, (last_paid + timedelta(days=1)).isoformat()
        cur = conn.execute("INSERT INTO accounts (name, kind, opening_balance, opening_date, sort_order) VALUES "
                           "(?, 'loan', ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM accounts))",
                           (acc_name, opening, od))
        c["account_id"] = cur.lastrowid
    cols = list(c)
    cur = conn.execute(f"INSERT INTO loans ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                       [c[k] for k in cols])
    loan_id = cur.lastrowid
    conn.commit()
    if fresh:
        start = _date(p.get("start_date"), "start_date", default=min(today, c["first_emi_date"]))
        try:
            _record_start(_loan(loan_id), start)
        except ApiError:
            _purge(loan_id)
            raise
    return get(loan_id)


def _record_start(ln, start):
    """New loan: money received (personal) and the processing charges."""
    ids, received = [], 0
    if ln["loan_type"] == "cc_emi":
        if ln["charges"]:
            ids.append(entries_svc.create({"type": "expense", "date": start, "amount": str(to_rupees(ln["charges"])),
                                           "category_id": _interest_cat(), "from_account_id": ln["account_id"],
                                           "note": f"EMI processing charges · {ln['name']}"})["id"])
    else:
        received = ln["principal"] - ln["charges"]
        ids.append(entries_svc.create({"type": "transfer", "date": start, "amount": str(to_rupees(received)),
                                       "from_account_id": ln["account_id"], "to_account_id": ln["bank_account_id"],
                                       "note": f"Loan received · {ln['name']}"})["id"])
        if ln["charges"]:
            ids.append(entries_svc.create({"type": "expense", "date": start, "amount": str(to_rupees(ln["charges"])),
                                           "category_id": _interest_cat(), "from_account_id": ln["account_id"],
                                           "note": f"Processing charges (deducted from loan) · {ln['name']}"})["id"])
    if ids:
        get_db().execute("INSERT INTO loan_events (loan_id, date, kind, amount, charges, entry_ids) VALUES (?, ?, 'disbursal', ?, ?, ?)",
                         (ln["id"], start, received, ln["charges"], ",".join(map(str, ids))))
        get_db().commit()


def update(loan_id, p):
    ln = _loan(loan_id)
    merged = {**{k: ln[k] for k in ("loan_type", "account_id", "bank_account_id", "category_id", "tenure_months",
                                    "first_emi_date", "paid_before", "name", "lender", "notes")},
              "principal": to_rupees(ln["principal"]), "emi": to_rupees(ln["emi"]), "charges": to_rupees(ln["charges"]),
              **{k: v for k, v in p.items() if k != "loan_type"}}
    merged["loan_type"] = ln["loan_type"]               # the kind can't change once entries exist
    c = _clean_terms(merged, ln)
    if ln["loan_type"] != "cc_emi":
        c["account_id"] = ln["account_id"]
    conn = get_db()
    conn.execute(f"UPDATE loans SET {', '.join(k + ' = ?' for k in c)} WHERE id = ?", [*c.values(), loan_id])
    if ln["loan_type"] != "cc_emi" and c["name"] != ln["name"] and \
            not one("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE AND id != ?", (c["name"], ln["account_id"])):
        conn.execute("UPDATE accounts SET name = ? WHERE id = ?", (c["name"], ln["account_id"]))
    conn.commit()
    return get(loan_id)


# ---------------------------------------------------------------- payments

def _active(loan_id):
    ln = _loan(loan_id)
    if ln["status"] != "active":
        raise ApiError("This loan is closed")
    return ln


def _paid_count(ln):
    sched, _ = schedule(ln)
    return sum(1 for s in sched if s["kind"] == "emi" and s["status"] in ("before", "paid"))


def pay_emi(loan_id, p):
    """Record the next unpaid EMI (or the one given by `no`)."""
    ln = _active(loan_id)
    sched, _ = schedule(ln)
    pending = [s for s in sched if s["kind"] == "emi" and s["status"] in ("due", "upcoming")]
    if not pending:
        raise ApiError("No EMIs left to pay")
    row = pending[0]
    if p.get("no") not in (None, ""):
        row = next((s for s in pending if s["no"] == int(p["no"])), None)
        if not row or row is not pending[0]:
            raise ApiError("Pay the EMIs in order: the earliest unpaid one first")
    amount = _paise(p.get("amount"), "amount", required=False) or row["amount"]
    interest = min(row["interest"], amount)
    principal = amount - interest
    d = _date(p.get("date"), "date", default=row["date"])
    label = f"EMI {row['no']}/{row['no'] + len(pending) - 1} · {ln['name']}"
    ids = []
    if ln["loan_type"] == "cc_emi":
        ids.append(entries_svc.create({"type": "expense", "date": d, "amount": str(to_rupees(amount)),
                                       "category_id": ln["category_id"], "from_account_id": ln["account_id"],
                                       "note": label})["id"])
    else:
        src = p.get("from_account_id") or ln["bank_account_id"]
        if principal:
            ids.append(entries_svc.create({"type": "transfer", "date": d, "amount": str(to_rupees(principal)),
                                           "from_account_id": src, "to_account_id": ln["account_id"],
                                           "note": f"{label} (principal)"})["id"])
        if interest:
            ids.append(entries_svc.create({"type": "expense", "date": d, "amount": str(to_rupees(interest)),
                                           "category_id": _interest_cat(), "from_account_id": src,
                                           "note": f"{label} (interest)"})["id"])
    get_db().execute("INSERT INTO loan_events (loan_id, date, kind, amount, principal, interest, installment_no, entry_ids) "
                     "VALUES (?, ?, 'emi', ?, ?, ?, ?, ?)",
                     (ln["id"], d, amount, principal, interest, row["no"] - 1, ",".join(map(str, ids))))
    get_db().commit()
    return get(loan_id)


def prepay(loan_id, p, foreclose=False):
    """Part-prepayment (reduce tenure or EMI) or foreclosure (pay off everything)."""
    ln = _active(loan_id)
    s = summary(ln)
    outstanding = to_paise(s["outstanding"])
    if foreclose:
        principal = outstanding
    else:
        principal = _paise(p.get("amount"), "amount")
        if principal <= 0:
            raise ApiError("Enter the amount prepaid", field="amount")
        if principal >= outstanding:
            raise ApiError("That's the whole loan: use Close loan instead", field="amount")
    charges = _paise(p.get("charges"), "charges", required=False)
    mode = None if foreclose else (p.get("mode") if p.get("mode") in ("tenure", "emi") else "tenure")
    d = _date(p.get("date"), "date", default=date.today().isoformat())
    word = "Loan closed" if foreclose else "Prepayment"
    ids = []
    if ln["loan_type"] == "cc_emi":
        if principal:
            ids.append(entries_svc.create({"type": "expense", "date": d, "amount": str(to_rupees(principal)),
                                           "category_id": ln["category_id"], "from_account_id": ln["account_id"],
                                           "note": f"{word} · {ln['name']}"})["id"])
        src_charges = ln["account_id"]
    else:
        src = p.get("from_account_id") or ln["bank_account_id"]
        if principal:
            ids.append(entries_svc.create({"type": "transfer", "date": d, "amount": str(to_rupees(principal)),
                                           "from_account_id": src, "to_account_id": ln["account_id"],
                                           "note": f"{word} · {ln['name']}"})["id"])
        src_charges = src
    if charges:
        ids.append(entries_svc.create({"type": "expense", "date": d, "amount": str(to_rupees(charges)),
                                       "category_id": _interest_cat(), "from_account_id": src_charges,
                                       "note": f"{'Foreclosure' if foreclose else 'Prepayment'} charges · {ln['name']}"})["id"])
    conn = get_db()
    conn.execute("INSERT INTO loan_events (loan_id, date, kind, amount, principal, charges, mode, installment_no, entry_ids) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                 (ln["id"], d, "foreclose" if foreclose else "prepay", principal + charges, principal, charges, mode,
                  _paid_count(ln), ",".join(map(str, ids))))
    if foreclose:
        conn.execute("UPDATE loans SET status = 'closed', closed_date = ? WHERE id = ?", (d, ln["id"]))
    conn.commit()
    return get(loan_id)


def undo_last(loan_id):
    """Remove the latest EMI / prepayment / closure and the entries it made."""
    ln = _loan(loan_id)
    ev = one("SELECT * FROM loan_events WHERE loan_id = ? AND kind != 'disbursal' ORDER BY id DESC LIMIT 1", (loan_id,))
    if not ev:
        raise ApiError("Nothing to undo")
    _delete_event_entries(ev)
    conn = get_db()
    conn.execute("DELETE FROM loan_events WHERE id = ?", (ev["id"],))
    if ev["kind"] == "foreclose":
        conn.execute("UPDATE loans SET status = 'active', closed_date = NULL WHERE id = ?", (ln["id"],))
    conn.commit()
    return get(loan_id)


def _delete_event_entries(ev):
    for eid in filter(None, (ev["entry_ids"] or "").split(",")):
        if one("SELECT id FROM entries WHERE id = ?", (int(eid),)):
            entries_svc.delete(int(eid))


def _purge(loan_id):
    ln = _loan(loan_id)
    for ev in _events(loan_id):
        _delete_event_entries(ev)
    conn = get_db()
    conn.execute("DELETE FROM loan_events WHERE loan_id = ?", (loan_id,))
    conn.execute("DELETE FROM loans WHERE id = ?", (loan_id,))
    if ln["loan_type"] != "cc_emi" and ln["account_id"]:
        used = one("SELECT COUNT(*) AS n FROM entries WHERE from_account_id = ? OR to_account_id = ?",
                   (ln["account_id"], ln["account_id"]))["n"]
        if used:
            conn.execute("UPDATE accounts SET active = 0 WHERE id = ?", (ln["account_id"],))
        else:
            conn.execute("DELETE FROM accounts WHERE id = ?", (ln["account_id"],))
    conn.commit()


def delete(loan_id):
    """Delete a loan with everything this app recorded for it (EMIs, disbursal, charges)."""
    _purge(loan_id)
