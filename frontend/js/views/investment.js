// One investment: share journal, FD payouts, RD instalments, PPF, gold/silver items, simple holdings, your extra fields.
import { api } from "../api.js";
import { masters, active, invalidateMasters } from "../state.js";
import { $, $$, confirmDialog, dateLabel, esc, modal, money, options, toast, todayISO, TYPE_LABEL as ENTRY_LABEL } from "../util.js";
import { gainCls, investmentForm, pct, typeChip } from "./investments.js";

let inv, M, id;

export async function render(params, accId) {
  id = accId;
  [inv, M] = await Promise.all([api.investment(id), masters()]);
  draw();
}

const banks = (withCards = false) =>
  active(M.accounts).filter((a) => ["bank", "cash", ...(withCards ? ["credit_card"] : [])].includes(a.kind));

async function act(promise, message) {
  const r = await promise;
  if (r && r.account) inv = r; else inv = await api.investment(id);
  toast(message);
  draw();
  return r;
}

function draw() {
  const d = inv.details, s = inv.summary, a = inv.account, t = d.inv_type;
  const since = d.start_date || a.opening_date;
  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <a class="small" href="#/investments">← Investments</a>
        <h1 style="margin-top:6px">${esc(a.name)}</h1>
        <div class="sub muted small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${typeChip(inv.type.name, inv.type.color)}
          ${d.held_at || d.institution ? `<span>${esc(d.held_at || d.institution)}</span>` : ""}
          ${since ? `<span>· since ${esc(dateLabel(since))}</span>` : ""}
          ${s.closed || !a.active ? `<span class="status-pill off">Closed</span>` : ""}</div>
      </div>
      <div class="toolbar">${a.active ? buttons(t, s) : ""}<button class="btn" data-do="edit">Edit</button>
        ${a.active ? (s.closed ? "" : `<button class="btn" data-do="close">Close</button>`)
          : `<button class="btn" data-do="reopen">${d.closed_on ? "Undo closing" : "Reopen"}</button>`}
        <button class="btn btn-ghost btn-danger" data-do="delete">Delete</button></div>
    </div>
    ${closedNote(d, a)}
    <div class="grid grid-4">${kpis(t, s, d)}</div>
    ${(SECTIONS[t] || SECTIONS.other)(s, d)}
    ${extras(d)}
    ${flows(s)}
    ${d.notes ? `<p class="small muted" style="margin:14px 2px 0">${esc(d.notes)}</p>` : ""}`;
  wire();
}

function kpi(label, value, foot = "", color = "var(--net)") {
  return `<div class="panel kpi"><div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}</div>
    <div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}
const signed = (v) => `<span class="${gainCls(v)}">${money(v, { sign: true })}</span>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** 13 months + 4 days -> "1 year 1 month 4 days" */
export function tenureLabel(months, days) {
  const y = Math.floor((months || 0) / 12), m = (months || 0) % 12;
  const parts = [y && plural(y, "year"), m && plural(m, "month"), days && plural(days, "day")].filter(Boolean);
  return parts.join(" ") || "—";
}
const isMetal = (t) => t === "gold" || t === "silver";
/** Names for gold/silver items: built-in types say coin / bar, your own types say item. */
function metalWords() {
  const t = inv.details.inv_type;
  if (inv.summary.scheme) return { one: "instalment", many: "Instalments", add: "+ Instalment", title: "Pay instalment", eg: "" };
  if (!inv.type.builtin) return { one: "item", many: "Items", add: "+ Item", title: `Add to ${inv.type.name}`, eg: "e.g. 25 g gold tree" };
  return t === "gold" ? { one: "gold coin", many: "Coins", add: "+ Gold coin", title: "Add gold coin", eg: "e.g. 10 g coin (SBI)" }
    : { one: "silver bar", many: "Bars", add: "+ Silver bar", title: "Add silver bar", eg: "e.g. 1 kg bar (MMTC-PAMP)" };
}

function kpis(t, s, d) {
  if (t === "share") {
    return kpi("Net invested", money(s.net_invested), `added ${money(s.funds_added)} · withdrawn ${money(s.withdrawn)}`, "var(--invest)")
      + kpi("Total profit", signed(s.total_profit), s.gain_pct === null ? "—" : `${pct(s.gain_pct)} of funds added`, "var(--income)")
      + kpi("Current value", money(s.value), "net invested + profit")
      + kpi("Dividends", money(s.dividends), "paid to your bank · not in value", "var(--redeem)");
  }
  if (t === "fd") {
    return kpi("Deposit", money(s.principal), d.rate ? `${d.rate}%${d.term_months || d.term_days ? ` · ${tenureLabel(d.term_months, d.term_days)}` : ""}` : "", "var(--invest)")
      + kpi(s.closed ? "Value" : "Value today", money(s.value), s.payout === "maturity" ? "interest added quarterly" : "interest paid out")
      + kpi("At maturity", money(s.maturity_amount), d.maturity_date ? dateLabel(d.maturity_date) : "", "var(--income)")
      + kpi("Interest received", money(s.interest_received), s.payout === "maturity" ? "on closing" : `${s.payouts_recorded.length} payout(s) recorded`, "var(--redeem)");
  }
  if (t === "rd") {
    const missed = s.missed_instalments;
    return kpi("Instalment", money(s.instalment), d.rate ? `${d.rate}% · ${tenureLabel(d.term_months)}` : "", "var(--invest)")
      + kpi("Paid", `${s.paid_instalments ?? 0}<span class="faint" style="font-size:16px"> / ${s.term_months ?? 0}</span>`,
            missed ? `<span style="color:var(--warn)">${missed} due and not recorded</span>`
              : s.next_due ? `next due <b>${esc(dateLabel(s.next_due))}</b>` : "all instalments paid", missed ? "var(--warn)" : "var(--income)")
      + kpi("Value today", money(s.value), `paid in ${money(s.invested)}`)
      + kpi("At maturity", money(s.maturity_amount), d.maturity_date ? dateLabel(d.maturity_date) : "", "var(--income)");
  }
  if (t === "ppf") {
    const used = Math.min(100, (s.this_fy_deposits / s.fy_limit) * 100);
    return kpi("Balance", money(s.value), "incl. interest accrued this year")
      + kpi("Deposited", money(s.invested), "net of withdrawals", "var(--invest)")
      + kpi("Interest", money(s.interest_credited + s.interest_accrued), `${money(s.interest_accrued)} accrued, credited each March`, "var(--income)")
      + kpi(s.fy_label, money(s.this_fy_deposits), `<div class="progress ${s.over_limit ? "warn" : ""}" style="margin-top:6px"><div style="width:${used}%"></div></div>
          <div style="margin-top:4px">${s.over_limit ? "over the ₹1.5 lakh yearly limit" : `${money(s.fy_limit - s.this_fy_deposits)} left of ₹1.5 lakh`}</div>`, "var(--redeem)");
  }
  if (isMetal(t) && s.scheme) {
    const missed = s.missed_instalments;
    return kpi("Instalments", `${s.paid_instalments}<span class="faint" style="font-size:16px"> / ${s.term_months}</span>`,
        missed ? `<span style="color:var(--warn)">${missed} due and not paid</span>`
          : s.next_due ? `next due <b>${esc(dateLabel(s.next_due))}</b>` : "all paid", missed ? "var(--warn)" : "var(--income)")
      + kpi("Gold collected", `${s.grams} g`, s.paid_before && !s.grams_before ? "add the grams paid before: Edit" : `${s.pure_grams} g pure`, "var(--invest)")
      + kpi("Paid", money(s.invested), s.paid_before ? `incl. ${money(s.paid_before)} paid before` : `${money(s.instalment)} a month`)
      + kpi("Matures", d.maturity_date ? esc(dateLabel(d.maturity_date)) : "—", "get the jewellery", "var(--redeem)");
  }
  if (isMetal(t)) {
    return kpi("Weight", `${s.grams} g`, `${s.pure_grams} g pure`, "var(--invest)")
      + kpi("Paid", money(s.invested), s.making_charges ? `incl. ${money(s.making_charges)} premium & GST` : "total paid")
      + kpi("Holding", String(s.items.filter((i) => !i.sold_date).length), `${metalWords().many.toLowerCase()}, shown at cost`, "var(--income)")
      + kpi("Gain on sales", signed(s.realised_gain), "counted when you sell", "var(--redeem)");
  }
  if (t === "chitty" && s.scheme) {
    const missed = s.missed_instalments;
    return kpi("Instalments", `${s.paid_instalments}<span class="faint" style="font-size:16px"> / ${s.term_months}</span>`,
        missed ? `<span style="color:var(--warn)">${missed} due and not recorded</span>`
          : s.next_due ? `next due <b>${esc(dateLabel(s.next_due))}</b>` : "all paid", missed ? "var(--warn)" : "var(--income)")
      + kpi("Paid in", money(s.invested), `${money(s.instalment)} a month`, "var(--invest)")
      + kpi("Prize / gain", signed(s.realised_gain), "counted when you receive the prize", "var(--income)")
      + kpi("Ends", d.maturity_date ? esc(dateLabel(d.maturity_date)) : "—", "last instalment", "var(--redeem)");
  }
  return kpi("Invested", money(s.invested), "principal amount", "var(--invest)")
    + kpi("Value", money(s.value), s.value_as_on ? `you entered it as on ${esc(dateLabel(s.value_as_on))}` : "shown at what you put in")
    + kpi("Gain", signed(s.gain), s.value_as_on ? `${money(s.unrealised_gain, { sign: true })} on paper · ${money(s.realised_gain, { sign: true })} realised` : "from redeemed amounts", "var(--income)")
    + kpi("Transactions", String(s.flows.length), "money in and out", "var(--transfer)");
}

function buttons(t, s) {
  const b = (what, label, primary = false) => `<button class="btn ${primary ? "btn-primary" : ""}" data-do="${what}">${label}</button>`;
  if (t === "share") return b("funds", "Add funds") + b("withdraw", "Withdraw") + b("dividend", "+ Dividend") + b("action", "+ Market action", true);
  if (s.closed) return "";
  if (t === "fd") return "";
  if (t === "rd") return b("funds", "Pay instalment", true);
  if (t === "ppf") return b("redeem", "Withdraw") + b("funds", "Deposit", true);
  if (isMetal(t)) return b("item", metalWords().add, true);
  if (t === "chitty" && s.scheme) return b("redeem", "Prize received") + b("funds", "Pay instalment", true);
  return b("value", "Update value") + b("redeem", "Redeem") + b("funds", "Add money", true);
}

/** "Closed on 10 Oct 2026 · received ₹1,03,000 · closed early" */
function closedNote(d, a) {
  if (a.active || !d.closed_on) return "";
  const early = d.maturity_date && d.closed_on < d.maturity_date;
  return `<section class="panel panel-pad closed-note"><b>Closed on ${esc(dateLabel(d.closed_on))}</b>
    <span class="muted"> · received ${money(d.closed_amount || 0)}${early ? ` · closed early (matures ${esc(dateLabel(d.maturity_date))})` : ""}</span>
    ${d.close_note ? `<div class="small faint" style="margin-top:4px">${esc(d.close_note)}</div>` : ""}</section>`;
}

// ------------------------------------------------------------------ type sections

const SECTIONS = {
  share(s, d) {
    let goal = "";
    if (s.goal) {
      const g = s.goal, p = Math.max(0, Math.min(100, g.progress_pct || 0));
      goal = `<section class="panel panel-pad"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
          <h2>Goal${g.pct ? `: ${g.pct}% gain` : ""}${g.date ? ` by ${esc(dateLabel(g.date))}` : ""}</h2>
          <span class="small muted">${money(s.total_profit)} of ${money(g.target_profit)} · <b>${g.progress_pct ?? 0}%</b></span></div>
        <div class="progress"><div style="width:${p}%"></div></div>
        ${g.forecast_profit ? `<p class="small faint" style="margin:8px 0 0">Forecast profit: ${money(g.forecast_profit)}</p>` : ""}</section>`;
    }
    const acts = inv.actions || [], divs = inv.dividends || [];
    const tot = (k) => acts.reduce((a, r) => a + r[k], 0);
    return `
    <div class="grid grid-main" style="margin-top:16px">
      <div class="stack">
        ${goal}
        <section class="panel">
          <div class="panel-head"><h2>Market actions</h2><span class="small faint">${acts.length} logged · profit is before charges</span></div>
          <div class="panel-body" style="padding:14px 0 6px">${acts.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Stock(s)</th><th>Action</th><th class="num">Profit</th><th class="num">Charges</th><th class="num">Net</th><th></th></tr></thead>
            <tbody>${acts.map((r) => `<tr>
              <td class="small">${esc(dateLabel(r.date))}</td>
              <td><div class="cell-main">${esc(r.stocks)}</div>${r.note ? `<div class="cell-sub">${esc(r.note)}</div>` : ""}</td>
              <td><span class="chip act-${r.action}">${esc(actLabel(r))}</span></td>
              <td class="num ${gainCls(r.profit)}">${isBuy(r.action) ? "—" : money(r.profit)}</td>
              <td class="num">${money(r.charges)}</td>
              <td class="num ${gainCls(r.net)}"><b>${money(r.net)}</b></td>
              <td class="right" style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-edit-action="${r.id}" aria-label="Edit">✎</button><button class="btn btn-ghost btn-sm btn-danger" data-del-action="${r.id}" aria-label="Delete">✕</button></td>
            </tr>`).join("")}</tbody>
            <tfoot><tr><td colspan="3">Total</td><td class="num">${money(tot("profit"))}</td><td class="num">${money(tot("charges"))}</td><td class="num">${money(tot("net"))}</td><td></td></tr></tfoot>
          </table></div>` : `<div class="empty small">No market actions yet. Log a CNC, MTF or intraday trade.</div>`}</div>
        </section>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Profit</h2></div>
          <div class="panel-body"><dl class="kv">
            <dt>Delivery (CNC) profit</dt><dd class="${gainCls(s.cnc_profit)}">${money(s.cnc_profit)}</dd>
            <dt>MTF profit</dt><dd class="${gainCls(s.mtf_profit)}">${money(s.mtf_profit)}</dd>
            <dt>Intraday profit</dt><dd class="${gainCls(s.intraday_profit)}">${money(s.intraday_profit)}</dd>
            ${s.other_profit ? `<dt>Others</dt><dd class="${gainCls(s.other_profit)}">${money(s.other_profit)}</dd>` : ""}
            <dt>Charges</dt><dd class="neg">−${money(s.charges)}</dd>
            <dt><b>Total profit</b></dt><dd class="${gainCls(s.total_profit)}">${money(s.total_profit)}</dd>
          </dl><p class="small faint" style="margin:12px 0 0">Profit stays inside the stocks account: it's never counted as income.</p></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Dividends</h2>${divs.length ? `<span class="small faint">${money(s.dividends)} in total</span>` : ""}</div>
          <div class="panel-body">${divs.length ? divs.map((r) => `<div class="bal-row">
            <span><span class="cell-main">${esc(r.stock || "Dividend")}</span><div class="cell-sub">${esc(dateLabel(r.date))}${r.note ? ` · ${esc(r.note)}` : ""}</div></span>
            <span class="amt">${money(r.amount)} <button class="btn btn-ghost btn-sm btn-danger" data-del-div="${r.id}" aria-label="Delete">✕</button></span></div>`).join("")
            : `<p class="small faint" style="margin:0">None yet.</p>`}
            <p class="small faint" style="margin:12px 0 0">Dividends go to your bank, so they're kept out of this account's value and profit. When you move the money in, add it with Add funds.</p></div>
        </section>
      </div>
    </div>`;
  },

  fd(s, d) {
    const payout = { maturity: "At maturity (cumulative)", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" }[s.payout];
    const sched = s.payouts.length ? `<section class="panel">
        <div class="panel-head"><h2>Interest payouts</h2><span class="small faint">${money(s.payouts[0].amount)} each</span></div>
        <div class="panel-body" style="padding:14px 0 6px"><div class="table-wrap"><table>
          <thead><tr><th>Date</th><th class="num">Amount</th><th>Status</th></tr></thead>
          <tbody>${s.payouts.map((p, i) => `<tr><td>${esc(dateLabel(p.date))}</td><td class="num">${money(p.amount)}</td>
            <td>${p.recorded ? `<span class="status-pill on">Recorded</span>`
              : !inv.account.active ? `<span class="faint small">—</span>`
              : p.due ? `<button class="btn btn-sm btn-primary" data-payout="${i}">Record</button>` : `<span class="faint small">Upcoming</span>`}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="small faint" style="margin:10px 20px 0">The last interest comes with the deposit at maturity: use “Close” then.</p></div>
      </section>` : "";
    return `<div class="grid grid-main" style="margin-top:16px">
      <div class="stack">${sched || `<section class="panel panel-pad"><h2>Cumulative FD</h2>
        <p class="small muted" style="margin:8px 0 0">Interest is added every quarter and paid with the deposit at maturity. When it matures,
        use <b>Close</b> and enter the amount credited: the interest then counts as income.</p></section>`}</div>
      <section class="panel"><div class="panel-head"><h2>Details</h2></div><div class="panel-body"><dl class="kv">
        <dt>Rate</dt><dd>${d.rate ?? "—"}%</dd>
        <dt>Tenure</dt><dd>${tenureLabel(d.term_months, d.term_days)}</dd>
        <dt>Started</dt><dd>${d.start_date ? esc(dateLabel(d.start_date)) : "—"}</dd>
        <dt>Matures</dt><dd>${d.maturity_date ? esc(dateLabel(d.maturity_date)) : "—"}</dd>
        <dt>Interest</dt><dd>${esc(payout)}</dd>
      </dl></div></section></div>`;
  },

  rd(s) {
    return deposits(s, "Instalments");
  },
  ppf(s) {
    return deposits(s, "Deposits", `PPF interest (${inv.details.rate}%) is worked out on the lowest balance between the 5th and the end of
      each month, and credited every 31 March. Deposit by the 5th to earn that month's interest.`);
  },

  gold: (s) => metal(s),
  silver: (s) => metal(s),
  other: () => "",
  chitty: (s) => (s.scheme ? deposits(s, "Instalments", "Instalments can be lower when the chit pays a dividend: enter what you actually paid.") : ""),
};

/** Your own extra fields for this type, with what you entered. */
function extras(d) {
  const fields = inv.type.fields || [];
  if (!fields.length) return "";
  const show = (f, v) => (v === undefined || v === "" ? `<span class="faint">—</span>`
    : f.kind === "date" ? esc(dateLabel(v)) : esc(v));
  return `<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>${esc(inv.type.name)} details</h2>
    <button class="btn btn-sm" data-do="edit">Edit</button></div>
    <div class="panel-body"><dl class="kv">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${show(f, d.extra[f.key])}</dd>`).join("")}</dl></div></section>`;
}

function deposits(s, title, note = "") {
  const list = s.deposits || [];
  return `<section class="panel" style="margin-top:16px">
    <div class="panel-head"><h2>${title}</h2><span class="small faint">${list.length} recorded</span></div>
    <div class="panel-body">${list.length ? list.slice(0, 24).map((r) => `<div class="bal-row">
        <span><span class="cell-main">${esc(dateLabel(r.date))}</span>${r.from_account ? `<div class="cell-sub">from ${esc(r.from_account)}</div>` : ""}</span>
        <span class="amt">${money(r.amount)}</span></div>`).join("") : `<p class="small faint" style="margin:0">None recorded yet.</p>`}
      ${note ? `<p class="small faint" style="margin:12px 0 0">${note}</p>` : ""}</div></section>`;
}

function metal(s) {
  const items = s.items || [];
  const own = !inv.type.builtin;               // gold tree etc. can have other purities
  return `<section class="panel" style="margin-top:16px">
    <div class="panel-head"><h2>${metalWords().many}</h2><span class="small faint">${items.length} ${inv.summary.scheme ? "payment" : "purchase"}${items.length === 1 ? "" : "s"}</span></div>
    <div class="panel-body" style="padding:14px 0 6px">${items.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="num">Weight</th>${own ? `<th class="num hide-sm">Purity</th>` : ""}<th class="num hide-sm">Buy Rate</th>
        <th class="num">Amount Paid</th><th class="hide-sm">Bill Name</th><th class="hide-sm">Document</th><th class="num">Status</th><th></th></tr></thead>
      <tbody>${items.map((i) => `<tr style="${i.sold_date ? "opacity:.6" : ""}">
        <td><div class="cell-main">${esc(dateLabel(i.date))}</div>${i.note ? `<div class="cell-sub">${esc(i.note)}</div>` : ""}</td>
        <td class="num">${i.grams} g${own ? `<div class="cell-sub">${i.pure_grams} g pure</div>` : ""}</td>
        ${own ? `<td class="num hide-sm">${i.purity}%</td>` : ""}
        <td class="num hide-sm">${i.rate ? `${money(i.rate)}/g` : "—"}</td>
        <td class="num">${money(i.total_paid)}${i.making_charges ? `<div class="cell-sub">premium ${money(i.making_charges)}</div>` : ""}</td>
        <td class="hide-sm">${esc(i.bill_name || "—")}</td>
        <td class="hide-sm small">${esc(i.doc || "—")}</td>
        <td class="num">${i.sold_date ? `Sold ${money(i.sold_amount)}<div class="cell-sub">${esc(dateLabel(i.sold_date))}</div>` : `<span class="faint">Holding</span>`}</td>
        <td class="right" style="white-space:nowrap">${i.sold_date || !inv.account.active ? "" : `<button class="btn btn-sm" data-sell="${i.id}">Sell</button>`}
          ${i.entry_id || i.sold_entry_id ? "" : `<button class="btn btn-ghost btn-sm btn-danger" data-del-item="${i.id}" aria-label="Delete">✕</button>`}</td>
      </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty small">Nothing added yet. Add each purchase with its weight.</div>`}</div></section>`;
}

function flows(s) {
  const list = s.flows || [];
  if (!list.length) return "";
  return `<section class="panel" style="margin-top:16px">
    <div class="panel-head"><h2>Money in &amp; out</h2><a class="small" href="#/entries?account_id=${inv.account.id}">In Transactions →</a></div>
    <div class="panel-body" style="padding:14px 0 6px"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Type</th><th>Account</th><th class="num">Amount</th></tr></thead>
      <tbody>${list.slice(0, 50).map((f) => {
        const out = f.from_account_id === inv.account.id;
        const label = f.type === "transfer" ? "Withdrawn" : ENTRY_LABEL[f.type];
        return `<tr class="click" data-entry="${f.id}"><td class="small">${esc(dateLabel(f.date))}</td>
          <td><span class="chip t-${f.type}">${esc(label)}</span></td>
          <td>${esc(out ? `to ${f.to_account || ""}` : `from ${f.from_account || ""}`)}${f.note ? `<div class="cell-sub">${esc(f.note)}</div>` : ""}</td>
          <td class="num">${out ? "−" : "+"}${money(f.amount)}</td></tr>`;
      }).join("")}</tbody></table></div></div></section>`;
}

// ------------------------------------------------------------------ actions

const fld = (label, html, hint = "") => `<div class="field"><label${label.startsWith("*") ? ' class="req"' : ""}>${label.replace(/^\*/, "")}</label>${html}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
const dateFld = (v = todayISO()) => fld("*Date", `<input type="date" name="date" value="${esc(v)}" required>`);
const amtFld = (label = "Amount (₹)", v = "") => fld("*" + label, `<input name="amount" inputmode="decimal" required value="${esc(v)}">`);
const noteFld = (v = "") => fld("Note", `<input name="note" maxlength="300" value="${esc(v)}">`);
const accFld = (name, label, list, sel) => fld("*" + label, `<select name="${name}" required>${options(list, sel, { placeholder: "Choose…" })}</select>`);

function wire() {
  const a = inv.account, s = inv.summary, d = inv.details;
  const on = (sel, fn) => $$(sel).forEach((b) => b.addEventListener("click", () => fn(b)));
  const firstBank = banks()[0]?.id;

  on("[data-do=edit]", async () => { const r = await investmentForm(inv); if (r) { inv = r; draw(); } });

  on("[data-do=close]", () => closeModal());

  on("[data-do=reopen]", async () => {
    const ok = !d.closed_on || await confirmDialog(`Undo closing “${a.name}”?`,
      "The closing transaction is removed and it's running again. Use this if the closing was entered by mistake.", "Undo closing");
    if (!ok) return;
    invalidateMasters();
    act(api.invPost(a.id, "reopen"), "Running again").catch((e) => toast(e.message, true));
  });

  on("[data-do=delete]", async () => {
    const n = inv.transactions;
    const ok = await confirmDialog(`Delete “${a.name}”?`, n
      ? `Everything recorded on it goes too, including its ${n} transaction${n === 1 ? "" : "s"}: your bank balances will change `
        + "back as if they never happened. A backup of your data is saved first. To keep its history, use Close instead."
      : "Everything recorded on it goes too. This can't be undone.");
    if (!ok) return;
    try {
      await api.deleteInvestment(a.id);
      invalidateMasters();
      toast("Deleted");
      location.hash = "#/investments";
    } catch (e) { toast(e.message, true); }
  });

  on("[data-do=funds]", () => {
    const rd = d.inv_type === "rd" || (d.inv_type === "chitty" && s.scheme);
    modal({
      title: rd ? "Pay instalment" : { share: "Add funds", ppf: "PPF deposit" }[d.inv_type] || "Add money",
      body: dateFld() + amtFld("Amount (₹)", rd ? d.amount : "") + accFld("from_account_id", "Paid From", banks(true), firstBank) + noteFld(),
      onSubmit: (v) => act(api.invPost(a.id, "funds", v), "Recorded"),
    });
  });

  on("[data-do=value]", () => modal({
    title: "Update value",
    body: fld("*Value Now (₹)", `<input name="value" inputmode="decimal" value="${esc(s.value_as_on ? s.value : "")}" placeholder="from your statement">`,
      "What it's worth today, from your statement or app. Leave empty to show it at what you put in again.")
      + fld("*As On", `<input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required>`)
      + `<p class="small faint" style="margin:0">Money you add or redeem after this date is added to or taken off this value.</p>`,
    onSubmit: (v) => act(api.invPost(a.id, "value", v), v.value ? "Value updated" : "Shown at what you put in"),
  }));

  on("[data-do=withdraw]", () => modal({
    title: "Withdraw to bank",
    body: dateFld() + amtFld() + accFld("to_account_id", "Credited To", banks(), firstBank) + noteFld()
      + `<p class="small faint" style="margin:0">Recorded as a transfer: it's your own money coming back, never income.</p>`,
    onSubmit: (v) => act(api.invPost(a.id, "withdraw", v), "Withdrawal recorded"),
  }));

  on("[data-do=redeem]", () => modal({
    title: d.inv_type === "ppf" ? "Withdraw from PPF" : d.inv_type === "chitty" ? "Prize money received" : `Redeem from ${a.name}`,
    body: dateFld() + amtFld("Amount Received (₹)")
      + fld("Principal Closed (₹)", `<input name="principal_amount" inputmode="decimal" value="${esc(s.invested ?? "")}">`,
        "What you had put in. Amount received minus this counts as income (Investment Returns).")
      + accFld("to_account_id", "Received In", banks(), firstBank) + noteFld(),
    onSubmit: (v) => act(api.invPost(a.id, "redeem", v), "Recorded"),
  }));

  on("[data-payout]", (b) => {
    const p = s.payouts[+b.dataset.payout];
    modal({
      title: "Record interest payout",
      body: dateFld(p.date) + amtFld("Amount (₹)", p.amount) + accFld("to_account_id", "Credited To", banks(), firstBank) + noteFld(),
      onSubmit: (v) => act(api.invPost(a.id, "payout", v), "Interest recorded as income"),
    });
  });

  // share journal
  on("[data-do=action]", () => actionModal());
  on("[data-edit-action]", (b) => actionModal(inv.actions.find((r) => String(r.id) === b.dataset.editAction)));
  on("[data-del-action]", async (b) => {
    if (await confirmDialog("Delete this action?", "It will be removed from the journal.")) {
      act(api.invDelete(a.id, `actions/${b.dataset.delAction}`), "Deleted");
    }
  });
  on("[data-do=dividend]", () => modal({
    title: "Dividend",
    body: dateFld() + fld("Stock", `<input name="stock" maxlength="100">`) + amtFld() + noteFld()
      + `<p class="small faint" style="margin:0">Counted in this account's profit, not as income.</p>`,
    onSubmit: (v) => act(api.invPost(a.id, "dividends", v), "Dividend added"),
  }));
  on("[data-del-div]", async (b) => {
    if (await confirmDialog("Delete this dividend?", "It will be removed.")) act(api.invDelete(a.id, `dividends/${b.dataset.delDiv}`), "Deleted");
  });

  // gold / silver
  on("[data-do=item]", () => itemModal());
  on("[data-sell]", (b) => {
    const it = s.items.find((i) => String(i.id) === b.dataset.sell);
    modal({
      title: `Sell ${it.description}`,
      body: dateFld() + amtFld("Amount Received (₹)", it.value ?? "")
        + fld("Received In", `<select name="to_account_id"><option value="">Don't record money (exchanged / gifted)</option>${options(banks(), firstBank)}</select>`,
          `Gain over what you paid (${money(it.total_paid)}) counts as income.`),
      onSubmit: (v) => act(api.invPost(a.id, `items/${it.id}/sell`, v), "Marked as sold"),
    });
  });
  on("[data-del-item]", async (b) => {
    if (await confirmDialog("Delete this item?", "It will be removed from the list.")) act(api.invDelete(a.id, `items/${b.dataset.delItem}`), "Deleted");
  });

  $$("tr[data-entry]").forEach((r) => r.addEventListener("click", () => { location.hash = `#/edit/${r.dataset.entry}`; }));
}

/** Close: matured, broken early, sold out. Records the money that came back and moves it to Closed. */
function closeModal() {
  const a = inv.account, s = inv.summary, d = inv.details, t = d.inv_type;
  const matured = d.maturity_date && d.maturity_date <= todayISO();
  const amount = matured && s.maturity_amount ? s.maturity_amount : (s.value ?? "");
  const what = { share: "Close account", gold: "Close (sell all)", silver: "Close (sell all)" }[t] || "Close";
  const p = modal({
    title: `${what}: ${a.name}`,
    wide: true,
    submitLabel: "Close it",
    body: `<div class="form-grid">
      ${fld("*Closing Date", `<input type="date" name="date" id="cl-date" value="${esc(matured ? d.maturity_date : todayISO())}" max="${todayISO()}" required>`)}
      ${fld("*Amount Received (₹)", `<input name="amount" inputmode="decimal" required value="${esc(amount)}">`,
        t === "share" ? "What came back to your bank. It's your own money: never counted as income."
          : "What was actually credited. More than you put in counts as income, less as a loss.")}
      <div class="full">${fld("Received In", `<select name="to_account_id"><option value="">Nothing came back (₹0)</option>${options(banks(), banks()[0]?.id)}</select>`)}</div>
      <div class="full hint small" id="cl-early" style="color:var(--warn)"></div>
      <div class="full">${noteFld()}</div></div>
      <p class="small faint" style="margin:0">It moves to Closed with this closing recorded. “Undo closing” brings it back if entered by mistake.</p>`,
    onSubmit: (v) => { invalidateMasters(); return act(api.invPost(a.id, "close", v), "Closed"); },
  });
  const early = () => {
    const dt = $("#cl-date").value;
    $("#cl-early").textContent = d.maturity_date && dt && dt < d.maturity_date
      ? `Closing early: it matures on ${dateLabel(d.maturity_date)}. Banks usually pay a lower rate when broken early, so enter what was actually credited.` : "";
  };
  $("#cl-date").addEventListener("input", early);
  early();
  return p;
}

const ACT_NAMES = { cnc_buy: "CNC Buy", cnc_sell: "CNC Sell", mtf_buy: "MTF Buy", mtf_sell: "MTF Sell", intraday: "Intraday", other: "Others" };
const isBuy = (k) => k === "cnc_buy" || k === "mtf_buy";
const actLabel = (r) => (r.action === "other" ? r.action_other || "Others" : ACT_NAMES[r.action] || r.action);

function actionModal(r) {
  const a = inv.account;
  const p = modal({
    title: r ? "Edit market action" : "Market action",
    wide: true,
    body: `<div class="form-grid">
      ${dateFld(r?.date)}
      ${fld("*Action", `<select name="action" id="act-kind">${options(Object.entries(ACT_NAMES).map(([id, name]) => ({ id, name })), r?.action || "cnc_sell")}</select>`)}
      <div id="act-other">${fld("*Action Name", `<input name="action_other" maxlength="60" value="${esc(r?.action_other ?? "")}" placeholder="e.g. F&O, IPO, Buyback">`)}</div>
      <div class="full">${fld("*Stock(s)", `<input name="stocks" required maxlength="200" value="${esc(r?.stocks ?? "")}" placeholder="e.g. TCS, INFY">`)}</div>
      <div id="act-profit">${fld("Profit (₹, Before Charges)", `<input name="profit" inputmode="decimal" value="${esc(r?.profit ?? "")}">`, "Use a minus sign for a loss, e.g. -250")}</div>
      ${fld("Charges (₹)", `<input name="charges" inputmode="decimal" value="${esc(r?.charges ?? "")}">`, "Brokerage, STT, DP, GST…")}
      <div class="full">${noteFld(r?.note ?? "")}</div></div>`,
    onSubmit: (v) => act(r ? api.invPut(a.id, `actions/${r.id}`, v) : api.invPost(a.id, "actions", v), r ? "Saved" : "Action logged"),
  });
  const sync = () => {
    const kind = $("#act-kind").value, buy = isBuy(kind), other = kind === "other";
    $("#act-profit").classList.toggle("hidden", buy);
    $("#act-profit input").disabled = buy;
    $("#act-other").classList.toggle("hidden", !other);
    $("#act-other input").disabled = !other;
    $("#act-other input").required = other;
  };
  $("#act-kind").addEventListener("change", sync);
  sync();
  return p;
}

function itemModal() {
  const a = inv.account, metal = inv.details.inv_type, w = metalWords();
  const own = !inv.type.builtin;
  const presets = metal === "gold" ? [["24K · 999", 99.9], ["24K · 995", 99.5], ["22K · 916", 91.6], ["18K · 750", 75]]
    : [["999", 99.9], ["Sterling · 925", 92.5]];
  const payFrom = [...banks(true).map((b) => ({ id: b.id, name: b.name })), { id: "", name: "Already paid earlier (don't record a payment)" }];
  const p = modal({
    title: w.title,
    wide: true,
    submitLabel: "Add",
    body: `<div class="form-grid">
      ${dateFld()}
      ${fld("*Amount Paid (₹)", `<input name="total_paid" id="it-paid" inputmode="decimal" required value="${esc(inv.summary.scheme ? inv.summary.instalment ?? "" : "")}">`, "Everything paid, incl. GST")}
      ${fld("*Buy Rate (₹/g)", `<input name="rate" id="it-rate" inputmode="decimal" required>`, `${metal === "gold" ? "Gold" : "Silver"} rate per gram that day`)}
      ${fld("*Weight (grams)", `<input name="grams" id="it-grams" inputmode="decimal" required>`, "As on the bill")}
      ${own ? fld("*Purity", `<select name="purity">${presets.map(([l, v], i) => `<option value="${v}" ${i === (metal === "gold" ? 2 : 0) ? "selected" : ""}>${l}</option>`).join("")}</select>`) : ""}
      ${fld("Bill Name", `<input name="bill_name" maxlength="80" placeholder="Name on the bill">`)}
      <div class="${own ? "" : "full"}">${fld("*Payment Method", `<select name="paid_from_account_id">${options(payFrom, banks()[0]?.id)}</select>`,
        "The account it was paid from")}</div>
      <div class="full">${fld("Transaction Document", `<input name="doc" maxlength="200" placeholder="e.g. bill / invoice no., UPI ref, or where the receipt is kept">`)}</div>
      <div class="full">${noteFld()}</div></div>`,
    onSubmit: (v) => act(api.invPost(a.id, "items", v), inv.summary.scheme ? "Instalment recorded" : "Purchase added"),
  });
  // weight = amount ÷ rate, filled in until you type your own
  let typed = false;
  $("#it-grams").addEventListener("input", () => { typed = true; });
  const fill = () => {
    const paid = parseFloat($("#it-paid").value.replace(/,/g, "")), rate = parseFloat($("#it-rate").value.replace(/,/g, ""));
    if (!typed && paid > 0 && rate > 0) $("#it-grams").value = (paid / rate).toFixed(3);
  };
  $("#it-paid").addEventListener("input", fill);
  $("#it-rate").addEventListener("input", fill);
  return p;
}
