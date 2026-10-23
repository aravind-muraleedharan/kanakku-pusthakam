// Loans & EMIs: overview (#/loans) and one loan with its schedule (#/loan/3).
import { api } from "../api.js";
import { info } from "../help.js";
import { masters, active, invalidateMasters } from "../state.js";
import { $, $$, confirmDialog, dateLabel, esc, modal, money, options, toast, todayISO } from "../util.js";

const TYPE_LABEL = { cc_emi: "Credit card EMI", personal: "Personal loan", other: "Other loan" };
const TYPE_COLOR = { cc_emi: "var(--t-share)", personal: "var(--t-chitty)", other: "var(--t-other)" };
const chip = (t) => `<span class="type-chip"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</span>`;

function kpi(label, value, foot = "", color = "var(--net)", help = "") {
  return `<div class="panel kpi"><div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}${help ? info(help) : ""}</div>
    <div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}
const bar = (pct) => `<div class="progress" style="height:7px"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;

// ------------------------------------------------------------------ overview

export async function render() {
  const d = await api.loans();
  const t = d.totals;
  const running = d.items.filter((i) => i.status === "active");
  const closed = d.items.filter((i) => i.status !== "active");
  const firstUnpaid = {};
  d.this_month.forEach((s) => { if (s.status !== "paid" && s.status !== "before" && !(s.loan_id in firstUnpaid)) firstUnpaid[s.loan_id] = s.no; });

  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Loans &amp; EMIs</h1><div class="sub muted small">${t.active} running</div></div>
      <div class="toolbar"><button class="btn btn-primary" id="new-loan">+ Loan or EMI</button></div>
    </div>
    <div class="grid grid-4">
      ${kpi("Outstanding", money(t.outstanding), "principal left to repay", "var(--expense)")}
      ${kpi("EMIs this month", money(t.emi_month), t.due_count ? `<span style="color:var(--warn)">${t.due_count} due to record</span>` : "all recorded", "var(--warn)")}
      ${kpi("Interest left to pay", money(t.interest_left), "if paid as scheduled", "var(--invest)", "interest_only")}
      ${kpi("Running", String(t.active), closed.length ? `${closed.length} closed` : "", "var(--transfer)")}
    </div>
    <div class="grid grid-main" style="margin-top:16px">
      <section class="panel">
        <div class="panel-head"><h2>All loans</h2></div>
        <div class="panel-body" style="padding:14px 0 6px">${loanTable(running)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>This month</h2></div>
        <div class="panel-body">${d.this_month.length ? `<div class="up-list">${d.this_month.map((s) => `
          <div class="up-row">
            <span class="up-date ${s.status === "due" ? "due" : ""}">${esc(dateLabel(s.date))}</span>
            <span><a class="cell-main" href="#/loan/${s.loan_id}" style="color:inherit">${esc(s.name)}</a>
              <div class="cell-sub">EMI ${s.no} · ${TYPE_LABEL[s.loan_type]}</div></span>
            <span class="right"><span class="amt num">${money(s.amount)}</span><div style="margin-top:3px">${
              s.status === "paid" || s.status === "before" ? `<span class="status-pill on">Paid</span>`
              : firstUnpaid[s.loan_id] === s.no ? `<button class="btn btn-sm ${s.status === "due" ? "btn-primary" : ""}" data-pay="${s.loan_id}">Pay</button>`
              : `<span class="faint small">Upcoming</span>`}</div></span>
          </div>`).join("")}</div>` : `<div class="empty small" style="padding:24px 0">No EMIs this month</div>`}
          <p class="small faint" style="margin:12px 0 0">Card EMIs are counted as that month's expense. For a personal loan only the interest is an expense: the principal repays money you already spent.</p>
        </div>
      </section>
    </div>
    ${closed.length ? `<details class="panel" style="margin-top:16px"><summary class="panel-pad" style="cursor:pointer"><b>Closed</b>
      <span class="faint small">· ${closed.length}</span></summary><div style="padding-bottom:6px">${loanTable(closed)}</div></details>` : ""}`;

  $$("tr[data-id]").forEach((r) => r.addEventListener("click", () => { location.hash = `#/loan/${r.dataset.id}`; }));
  $("#new-loan").addEventListener("click", async () => { const r = await loanForm(); if (r) location.hash = `#/loan/${r.id}`; });
  $$("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
    const ln = await api.loan(b.dataset.pay);
    if (await payModal(ln)) render();
  }));
}

function loanTable(items) {
  if (!items.length) {
    return `<div class="empty"><div class="big">▥</div><p>No loans or EMIs.</p>
      <p class="small faint">Add a credit card EMI or a personal loan to track its EMIs and what's left.</p></div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Loan</th><th class="num">EMI</th><th class="num">Outstanding</th><th class="hide-sm" style="width:28%">Repaid</th></tr></thead>
    <tbody>${items.map((i) => {
      const s = i.summary;
      return `<tr class="click" data-id="${i.id}">
        <td><div class="cell-main">${esc(i.name)}</div><div class="cell-sub">${esc(TYPE_LABEL[i.loan_type])}${i.lender ? ` · ${esc(i.lender)}` : ""}${i.account && i.loan_type === "cc_emi" ? ` · ${esc(i.account)}` : ""}</div></td>
        <td class="num">${i.status === "active" ? money(s.emi) : "—"}${s.next ? `<div class="cell-sub">next ${esc(dateLabel(s.next.date))}</div>` : ""}</td>
        <td class="num"><b>${money(s.outstanding)}</b>${s.end_date && i.status === "active" ? `<div class="cell-sub">ends ${esc(dateLabel(s.end_date))}</div>` : ""}</td>
        <td class="hide-sm">${bar(s.progress_pct)}<div class="cell-sub" style="margin-top:4px">${s.paid_count} of ${s.total_count} EMIs · ${s.progress_pct}%</div></td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

// ------------------------------------------------------------------ one loan

let ln;

export async function renderLoan(params, id) {
  ln = await api.loan(id);
  drawLoan();
}

function drawLoan() {
  const s = ln.summary, open = ln.status === "active";
  const b = (what, label, primary = false) => `<button class="btn ${primary ? "btn-primary" : ""}" data-do="${what}">${label}</button>`;
  const rows = s.schedule;
  const hasEvents = rows.some((r) => r.event_id) ;
  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <a class="small" href="#/loans">← Loans &amp; EMIs</a>
        <h1 style="margin-top:6px">${esc(ln.name)}</h1>
        <div class="sub muted small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${chip(ln.loan_type)}
          ${ln.lender ? `<span>${esc(ln.lender)}</span>` : ""}
          <span>· ${esc(ln.loan_type === "cc_emi" ? `on ${ln.account}, ${ln.category}` : `paid from ${ln.bank_account}`)}</span>
          ${open ? "" : `<span class="status-pill on">Closed ${ln.closed_date ? esc(dateLabel(ln.closed_date)) : ""}</span>`}</div>
      </div>
      <div class="toolbar">${hasEvents ? b("undo", "Undo last") : ""}${open ? b("prepay", "Prepay") + b("close", "Close loan") : ""}
        ${b("edit", "Edit")}${open && s.next ? b("pay", "Pay EMI", true) : ""}</div>
    </div>
    <div class="grid grid-4">
      ${kpi("Outstanding", money(s.outstanding), `${bar(s.progress_pct)}<div style="margin-top:5px">${s.progress_pct}% of ${money(ln.principal)} repaid</div>`, "var(--expense)")}
      ${kpi("EMI", money(s.emi), s.next ? `next ${s.next.status === "due" ? `<b style="color:var(--warn)">due</b>` : ""} ${esc(dateLabel(s.next.date))}` : "no EMIs left", "var(--warn)")}
      ${kpi("Interest rate", ln.rate ? `${ln.rate}%` : "0%", ln.rate ? (ln.charges ? `${s.effective_rate}% a year incl. charges` : "a year, worked out from the EMI") : "no-cost EMI", "var(--invest)")}
      ${kpi("Ends", s.end_date ? esc(dateLabel(s.end_date)) : "—", `${s.paid_count} of ${s.total_count} EMIs paid`, "var(--transfer)")}
    </div>
    <div class="grid grid-main" style="margin-top:16px">
      <section class="panel">
        <div class="panel-head"><h2>EMI schedule</h2><span class="small faint">prepayments shown where they happened</span></div>
        <div class="panel-body" style="padding:14px 0 6px"><div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Date</th><th class="num">EMI</th><th class="num hide-sm">Principal</th><th class="num hide-sm">Interest</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>${rows.map((r) => r.kind === "emi" ? `<tr>
            <td class="small faint">${r.no}</td><td class="small">${esc(dateLabel(r.date))}</td>
            <td class="num">${money(r.amount)}</td><td class="num hide-sm">${money(r.principal)}</td><td class="num hide-sm">${money(r.interest)}</td>
            <td class="num">${money(r.balance)}</td>
            <td>${r.status === "paid" ? `<span class="status-pill on">Paid</span>` : r.status === "before" ? `<span class="faint small">Paid earlier</span>`
              : !open ? "" : s.next && r.no === s.next.no ? `<button class="btn btn-sm ${r.status === "due" ? "btn-primary" : ""}" data-do="pay">Pay</button>`
              : r.status === "due" ? `<span class="small" style="color:var(--warn)">Due</span>` : `<span class="faint small">Upcoming</span>`}</td>
          </tr>` : `<tr style="background:var(--income-soft)">
            <td></td><td class="small">${esc(dateLabel(r.date))}</td>
            <td colspan="2" class="small"><b>${r.kind === "foreclose" ? "Closed" : "Prepaid"} ${money(r.principal)}</b>${r.charges ? ` + ${money(r.charges)} charges` : ""}
              ${r.mode ? `<div class="cell-sub">${r.mode === "emi" ? "EMI reduced" : "tenure reduced"}</div>` : ""}</td>
            <td class="hide-sm"></td><td class="num">${money(r.balance)}</td><td></td></tr>`).join("")}</tbody>
        </table></div></div>
      </section>
      <div class="stack">
        <section class="panel"><div class="panel-head"><h2>Cost</h2></div><div class="panel-body"><dl class="kv">
          <dt>Loan amount</dt><dd>${money(ln.principal)}</dd>
          <dt>Tenure</dt><dd>${ln.tenure_months} months</dd>
          <dt>Total interest</dt><dd>${money(s.total_interest)}</dd>
          <dt>…paid so far</dt><dd>${money(s.interest_paid)}</dd>
          <dt>…left to pay</dt><dd>${money(s.interest_left)}</dd>
          <dt>Processing charges</dt><dd>${money(ln.charges)}</dd>
          ${s.prepaid ? `<dt>Prepaid</dt><dd>${money(s.prepaid)}</dd>` : ""}
        </dl></div></section>
        <section class="panel panel-pad small muted">${ln.loan_type === "cc_emi"
          ? "Each EMI is recorded as an expense on the card, under the purchase's category. The purchase itself isn't counted again."
          : "The loan amount reached your bank as a transfer (not income). Each EMI's principal is a transfer back to the loan; only the interest and charges are expenses."}
          ${ln.notes ? `<p style="margin:10px 0 0">${esc(ln.notes)}</p>` : ""}
          <p style="margin:12px 0 0"><button class="btn btn-sm btn-danger" data-do="delete">Delete this loan</button></p></section>
      </div>
    </div>`;
  wireLoan();
}

async function refresh(promise, msg) {
  ln = await promise;
  toast(msg);
  drawLoan();
  return ln;
}

const fld = (label, html, hint = "") => `<div class="field"><label${label.startsWith("*") ? ' class="req"' : ""}>${label.replace(/^\*/, "")}</label>${html}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;

async function sourceField(l) {
  if (l.loan_type === "cc_emi") return "";
  const M = await masters();
  const banks = active(M.accounts).filter((a) => ["bank", "cash"].includes(a.kind));
  return fld("*Paid From", `<select name="from_account_id">${options(banks, l.bank_account_id)}</select>`);
}

/** Pay the next EMI of a loan. Resolves to the updated loan, or null. */
export async function payModal(l) {
  const n = l.summary.next;
  return modal({
    title: `Pay EMI ${n.no} · ${l.name}`,
    body: fld("*Date", `<input type="date" name="date" value="${esc(n.date <= todayISO() ? n.date : todayISO())}">`)
      + fld("*Amount (₹)", `<input name="amount" inputmode="decimal" value="${n.amount}">`,
        l.loan_type === "cc_emi" ? `Expense on ${esc(l.account)}` : `Principal ${money(n.principal)} (transfer) + interest ${money(n.interest)} (expense)`)
      + await sourceField(l),
    submitLabel: "Record EMI",
    onSubmit: async (v) => { const r = await api.loanPost(l.id, "emi", v); toast("EMI recorded"); return r; },
  });
}

function wireLoan() {
  const on = (what, fn) => $$(`[data-do=${what}]`).forEach((b) => b.addEventListener("click", fn));
  on("pay", async () => { const r = await payModal(ln); if (r) { ln = r; drawLoan(); } });
  on("prepay", async () => {
    modal({
      title: "Prepay",
      body: fld("*Date", `<input type="date" name="date" value="${todayISO()}">`)
        + fld("*Amount Prepaid (₹)", `<input name="amount" inputmode="decimal" required>`, `Outstanding now: ${money(ln.summary.outstanding)}`)
        + fld("Prepayment Charges (₹)", `<input name="charges" inputmode="decimal">`)
        + fld(`*After Prepaying${info("prepay_mode")}`, `<select name="mode"><option value="tenure">Keep the EMI, finish sooner</option><option value="emi">Keep the end date, lower the EMI</option></select>`)
        + await sourceField(ln),
      onSubmit: (v) => refresh(api.loanPost(ln.id, "prepay", v), "Prepayment recorded"),
    });
  });
  on("close", async () => {
    modal({
      title: `Close ${ln.name}`,
      body: `<p class="small muted" style="margin:0">Pays off the outstanding ${money(ln.summary.outstanding)} and marks the loan closed.</p>`
        + fld("*Date", `<input type="date" name="date" value="${todayISO()}">`)
        + fld("Foreclosure Charges / Interest (₹)", `<input name="charges" inputmode="decimal">`, "Anything charged on top of the outstanding principal")
        + await sourceField(ln),
      submitLabel: "Close loan",
      onSubmit: (v) => refresh(api.loanPost(ln.id, "close", v), "Loan closed"),
    });
  });
  on("undo", async () => {
    if (await confirmDialog("Undo the last payment?", "The latest EMI, prepayment or closure and its transactions will be removed.", "Undo")) {
      refresh(api.loanPost(ln.id, "undo"), "Undone");
    }
  });
  on("edit", async () => { const r = await loanForm(ln); if (r) { ln = r; drawLoan(); } });
  on("delete", async () => {
    if (await confirmDialog(`Delete ${ln.name}?`, "The loan and every transaction this app recorded for it (EMIs, charges, loan received) will be deleted.")) {
      await api.deleteLoan(ln.id);
      invalidateMasters();
      toast("Loan deleted");
      location.hash = "#/loans";
    }
  });
}

// ------------------------------------------------------------------ new / edit form

function solveRate(p, emi, n) {
  if (!(p > 0 && emi > 0 && n > 0)) return null;
  if (emi * n <= p + n) return emi * n < p - n ? NaN : 0;
  const pay = (r) => { const f = (1 + r) ** n; return (p * r * f) / (f - 1); };
  let lo = 0, hi = 0.2;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (pay(mid) > emi) hi = mid; else lo = mid; }
  return lo * 1200;
}

/** Create (no `l`) or edit a loan. Resolves to the saved loan, or null. */
export async function loanForm(l, preset = {}) {
  const M = await masters();
  const cards = active(M.accounts).filter((a) => a.kind === "credit_card");
  const banks = active(M.accounts).filter((a) => ["bank", "cash"].includes(a.kind));
  const cats = M.categories.filter((c) => c.kind === "expense" && !c.is_system && c.active);
  const v = l ? { ...l, principal: l.principal, emi: l.emi_original } : { loan_type: "cc_emi", first_emi_date: todayISO(), paid_before: 0, name: preset.name || "" };
  const val = (k) => esc(v[k] ?? "");
  const gadgets = cats.find((c) => /electronic/i.test(c.name))?.id;
  const body = `<div class="form-grid">
      <div class="field full"><label class="req">Kind</label><select name="loan_type" id="ln-type" ${l ? "disabled" : ""}>${options(
        Object.entries(TYPE_LABEL).map(([id, name]) => ({ id, name })), v.loan_type)}</select></div>
      <div class="field"><label class="req">Name</label><input name="name" required maxlength="80" id="ln-name" value="${val("name")}"></div>
      <div class="field"><label>Bank / Lender</label><input name="lender" maxlength="80" value="${val("lender")}"></div>
      <div class="field" data-for="cc_emi"><label class="req">Credit Card</label><select name="account_id">${options(cards, v.account_id)}</select></div>
      <div class="field" data-for="cc_emi"><label class="req">What You Bought</label><select name="category_id">${options(cats, v.category_id ?? gadgets)}</select></div>
      <div class="field full" data-for="personal other"><label class="req">Loan Credited To &amp; EMIs Paid From</label><select name="bank_account_id">${options(banks, v.bank_account_id)}</select></div>
      <div class="field"><label class="req">Total Loan Amount (₹)</label><input name="principal" inputmode="decimal" required value="${val("principal")}" data-calc></div>
      <div class="field"><label class="req">EMI (₹)</label><input name="emi" inputmode="decimal" required value="${val("emi")}" data-calc></div>
      <div class="field"><label class="req">Tenure (months)</label><input name="tenure_months" inputmode="numeric" required value="${val("tenure_months")}" data-calc></div>
      <div class="field"><label>Loan Charges (₹)</label><input name="charges" inputmode="decimal" value="${val("charges")}" placeholder="processing fee + GST"></div>
      <div class="field"><label class="req">First EMI Date</label><input type="date" name="first_emi_date" required value="${val("first_emi_date")}"></div>
      <div class="field"><label>EMIs Already Paid</label><input name="paid_before" inputmode="numeric" value="${val("paid_before")}">
        <div class="hint">For a loan that's already running: EMIs paid before you started tracking it here</div></div>
      ${l ? "" : `<div class="field full" id="ln-start"><label>Loan Taken On</label><input type="date" name="start_date" value="${todayISO()}">
        <div class="hint" data-hint></div></div>`}
      <div class="field full"><label>Notes</label><input name="notes" maxlength="300" value="${val("notes")}"></div>
      <div class="callout full" id="ln-calc" style="margin:0"></div>
    </div>`;
  const p = modal({
    title: l ? `Edit ${l.name}` : "New loan or EMI", body, wide: true, submitLabel: l ? "Save" : "Add",
    onSubmit: async (vals) => {
      const r = l ? await api.updateLoan(l.id, vals) : await api.createLoan(vals);
      invalidateMasters();
      toast(l ? "Saved" : "Loan added");
      return r;
    },
  });
  const root = $("#modal-root");
  const num = (n) => parseFloat(String($(`[name=${n}]`, root).value).replace(/,/g, "")) || 0;
  const sync = () => {
    const t = $("#ln-type").value;
    $$("[data-for]", root).forEach((el) => {
      const on = el.dataset.for.split(" ").includes(t);
      el.classList.toggle("hidden", !on);
      $$("select, input", el).forEach((i) => { i.disabled = !on; });
    });
    $("#ln-name").placeholder = t === "cc_emi" ? "e.g. iPhone EMI" : "e.g. HDFC personal loan";
    const hint = $("[data-hint]", root);
    if (hint) {
      const running = num("paid_before") > 0;
      $("#ln-start").classList.toggle("hidden", running);
      $("#ln-start input").disabled = running;
      hint.textContent = t === "cc_emi" ? "The loan charges are recorded as an expense on the card on this date."
        : "Records the loan reaching your bank (minus charges) on this date: a transfer, not income.";
    }
    const P = num("principal"), E = num("emi"), N = num("tenure_months");
    const r = solveRate(P, E, N);
    const calc = $("#ln-calc");
    if (r === null) { calc.innerHTML = "Enter the amount, EMI and tenure to see the interest rate."; calc.className = "callout full"; }
    else if (Number.isNaN(r)) { calc.innerHTML = "EMI × months is less than the loan amount: check the figures."; calc.className = "callout full loss"; }
    else {
      calc.className = "callout full";
      calc.innerHTML = r === 0 ? `<strong>No-cost EMI</strong>: ${money(E * N)} in total, no interest.`
        : `Interest rate ≈ <strong>${r.toFixed(2)}% a year</strong> · total interest ${money(Math.max(0, E * N - P))} over ${N} months`;
    }
  };
  $("#ln-type").addEventListener("change", sync);
  $$("input", root).forEach((i) => i.addEventListener("input", sync));
  sync();
  return p;
}
