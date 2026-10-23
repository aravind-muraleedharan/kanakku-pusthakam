// Reports: monthly summary, category totals, month x category grid, payment modes.
import { api } from "../api.js";
import { barList, incomeExpenseChart } from "../charts.js";
import {
  $, $$, esc, financialYear, money, monthBounds, monthLabel, monthShort, shiftMonth, thisMonth, todayISO,
} from "../util.js";

const TABS = { monthly: "Monthly summary", categories: "Category totals", grid: "Month × category", modes: "Payment modes" };

function presets() {
  const m = thisMonth(), t = todayISO(), fy = financialYear(t), pfy = financialYear(`${+fy.from.slice(0, 4) - 1}-06-01`);
  return {
    "this-month": { label: "This month", ...monthBounds(m) },
    "last-month": { label: "Last month", ...monthBounds(shiftMonth(m, -1)) },
    "last-3": { label: "Last 3 months", from: monthBounds(shiftMonth(m, -2)).from, to: monthBounds(m).to },
    "last-12": { label: "Last 12 months", from: monthBounds(shiftMonth(m, -11)).from, to: monthBounds(m).to },
    "this-fy": { label: `This FY (${fy.label.slice(3)})`, from: fy.from, to: fy.to },
    "last-fy": { label: `Last FY (${pfy.label.slice(3)})`, from: pfy.from, to: pfy.to },
    "this-year": { label: `Calendar ${t.slice(0, 4)}`, from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` },
    all: { label: "All time", from: "", to: "" },
  };
}

export async function render(params) {
  const tab = TABS[params.tab] ? params.tab : "monthly";
  const P = presets();
  let range;
  if (params.month) range = { key: "custom", ...monthBounds(params.month), label: monthLabel(params.month) };
  else if (params.from || params.to) range = { key: "custom", from: params.from || "", to: params.to || "", label: "Custom" };
  else {
    const key = P[params.range] ? params.range : tab === "monthly" || tab === "grid" ? "last-12" : "this-month";
    range = { key, ...P[key] };
  }
  const kind = params.kind === "income" ? "income" : "expense";

  const nav = (patch) => {
    const next = { tab, range: range.key !== "custom" ? range.key : "", from: range.key === "custom" ? range.from : "",
                   to: range.key === "custom" ? range.to : "", kind: params.kind || "", ...patch };
    Object.keys(next).forEach((k) => { if (!next[k]) delete next[k]; });
    location.hash = "#/reports?" + new URLSearchParams(next).toString();
  };

  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Reports</h1><div class="sub small muted">${esc(rangeText(range))}</div></div>
      <div class="toolbar">
        <select id="rp-range">
          ${Object.entries(P).map(([k, p]) => `<option value="${k}" ${k === range.key ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
          <option value="custom" ${range.key === "custom" ? "selected" : ""}>Custom…</option>
        </select>
        <span id="rp-custom" class="toolbar ${range.key === "custom" ? "" : "hidden"}">
          <input type="date" id="rp-from" value="${esc(range.from)}"> <span class="faint">to</span>
          <input type="date" id="rp-to" value="${esc(range.to)}">
          <button class="btn btn-sm" id="rp-apply">Apply</button>
        </span>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${Object.entries(TABS).map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}" role="tab">${l}</button>`).join("")}
    </div>
    <div id="rp-body"><div class="loading">Loading…</div></div>`;

  $$(".tabs button").forEach((b) => b.addEventListener("click", () => nav({ tab: b.dataset.tab })));
  $("#rp-range").addEventListener("change", (e) => {
    if (e.target.value === "custom") $("#rp-custom").classList.remove("hidden");
    else nav({ range: e.target.value, from: "", to: "" });
  });
  $("#rp-apply")?.addEventListener("click", () => nav({ range: "", from: $("#rp-from").value, to: $("#rp-to").value }));

  const q = { from: range.from || undefined, to: range.to || undefined };
  const body = $("#rp-body");
  if (tab === "monthly") await monthly(body, q, range);
  if (tab === "categories") await categories(body, q, kind, nav);
  if (tab === "grid") await grid(body, q, kind, nav);
  if (tab === "modes") await modes(body, q);
}

function rangeText(r) {
  if (!r.from && !r.to) return "All time";
  return `${r.label !== "Custom" ? r.label + " · " : ""}${r.from || "start"} to ${r.to || "today"}`;
}

const entriesLink = (q, extra = "") =>
  `#/entries?month=&${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))).toString()}${extra}`;

async function monthly(body, q, range) {
  let rows = await api.monthly(q);
  // don't show empty future months of an open range
  const cur = thisMonth();
  rows = rows.filter((r) => r.month <= cur || r.entries);
  const sum = await api.summary(q);
  if (!rows.length) { body.innerHTML = `<div class="panel empty">No transactions in this period.</div>`; return; }
  const n = rows.length;
  body.innerHTML = `
    <div class="grid grid-4">
      ${tile("Income", money(sum.income), `avg ${money(Math.round(sum.income / n))}/month`)}
      ${tile("Expense", money(sum.expense), `avg ${money(Math.round(sum.expense / n))}/month`)}
      ${tile("Net savings", money(sum.net), sum.savings_rate === null ? "—" : `${sum.savings_rate}% saved`)}
      ${tile("Invested", money(sum.invested), sum.redeemed_principal ? `${money(sum.redeemed_principal)} returned` : "principal put in")}
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-body" id="rp-chart"></div></section>
    <section class="panel" style="margin-top:16px">
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Net</th><th class="num">Saved %</th><th class="num">Invested</th><th class="num hide-sm">Running net</th></tr></thead>
        <tbody>${[...rows].reverse().map((r) => `
          <tr class="click" data-month="${r.month}">
            <td>${monthLabel(r.month)}</td>
            <td class="num c-income">${money(r.income)}</td>
            <td class="num c-expense">${money(r.expense)}</td>
            <td class="num ${r.net < 0 ? "neg" : ""}" style="font-weight:650">${money(r.net)}</td>
            <td class="num muted">${r.income > 0 ? Math.round((r.net / r.income) * 100) + "%" : "—"}</td>
            <td class="num c-invest">${money(r.invested)}</td>
            <td class="num hide-sm muted">${money(r.cumulative_net)}</td>
          </tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${money(sum.income)}</td><td class="num">${money(sum.expense)}</td>
          <td class="num">${money(sum.net)}</td><td class="num">${sum.savings_rate ?? "—"}${sum.savings_rate !== null ? "%" : ""}</td>
          <td class="num">${money(sum.invested)}</td><td class="hide-sm"></td></tr></tfoot>
      </table></div>
    </section>`;
  incomeExpenseChart($("#rp-chart"), rows, { onClick: (m) => { location.hash = `#/dashboard?month=${m}`; } });
  $$("tr[data-month]", body).forEach((tr) => tr.addEventListener("click", () => { location.hash = `#/dashboard?month=${tr.dataset.month}`; }));
}

function tile(label, value, foot) {
  return `<div class="panel kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

function kindToggle(kind) {
  return `<div class="seg" id="rp-kind">
    <button data-v="expense" class="${kind === "expense" ? "on" : ""}">Expense</button>
    <button data-v="income" class="${kind === "income" ? "on" : ""}">Income</button></div>`;
}

async function categories(body, q, kind, nav) {
  const data = await api.categories({ ...q, kind });
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head">${kindToggle(kind)}<div class="kpi-value" style="font-size:20px;margin:0">${money(data.total)}</div></div>
      <div class="panel-body" id="rp-bars"></div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="table-wrap"><table>
        <thead><tr><th>Category</th><th class="num">Transactions</th><th class="num">Amount</th><th class="num">Share</th></tr></thead>
        <tbody>${data.items.map((c) => `<tr class="click" data-cat="${c.id}"><td>${esc(c.name)}</td><td class="num muted">${c.count}</td><td class="num" style="font-weight:600">${money(c.amount)}</td><td class="num muted">${c.share}%</td></tr>`).join("")
          || `<tr><td colspan="4" class="empty">No ${kind} in this period.</td></tr>`}</tbody>
        ${data.items.length ? `<tfoot><tr><td>Total</td><td class="num">${data.items.reduce((a, c) => a + c.count, 0)}</td><td class="num">${money(data.total)}</td><td class="num">100%</td></tr></tfoot>` : ""}
      </table></div>
    </section>`;
  $$("#rp-kind button").forEach((b) => b.addEventListener("click", () => nav({ kind: b.dataset.v })));
  barList($("#rp-bars"), data.items, { kind, empty: `No ${kind} in this period`,
    onClick: (c) => { location.hash = entriesLink(q, `&category_id=${c.id}`); } });
  $$("tr[data-cat]", body).forEach((tr) => tr.addEventListener("click", () => { location.hash = entriesLink(q, `&category_id=${tr.dataset.cat}`); }));
}

async function grid(body, q, kind, nav) {
  const g = await api.grid({ ...q, kind });
  if (!g.rows.length) {
    body.innerHTML = `<section class="panel"><div class="panel-head">${kindToggle(kind)}</div><div class="empty">No ${kind} in this period.</div></section>`;
    $$("#rp-kind button").forEach((b) => b.addEventListener("click", () => nav({ kind: b.dataset.v })));
    return;
  }
  const max = Math.max(...g.rows.flatMap((r) => r.values), 1);
  const color = kind === "income" ? "var(--income)" : "var(--expense)";
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head">${kindToggle(kind)}<span class="small muted">Darker cell = more spent. Click a cell to see its transactions.</span></div>
      <div class="panel-body" style="padding:14px 0 0">
        <div class="table-wrap"><table class="heat">
          <thead><tr><th>Month</th>${g.categories.map((c) => `<th class="num" title="${esc(c.name)}">${esc(c.name.length > 16 ? c.name.slice(0, 15) + "…" : c.name)}</th>`).join("")}<th class="num">Total</th></tr></thead>
          <tbody>${g.rows.map((r) => `<tr><td style="white-space:nowrap">${monthShort(r.month)}</td>${r.values.map((v, i) => v
              ? `<td class="num click" data-m="${r.month}" data-c="${g.categories[i].id}" style="cursor:pointer"><i style="background:${color};opacity:${(0.06 + 0.5 * (v / max)).toFixed(2)}"></i><span>${money(v)}</span></td>`
              : `<td class="num zero">–</td>`).join("")}<td class="num" style="font-weight:650">${money(r.total)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td>Total</td>${g.categories.map((c) => `<td class="num">${money(c.total)}</td>`).join("")}<td class="num">${money(g.grand_total)}</td></tr></tfoot>
        </table></div>
      </div>
    </section>`;
  $$("#rp-kind button").forEach((b) => b.addEventListener("click", () => nav({ kind: b.dataset.v })));
  $$("td[data-m]", body).forEach((td) => td.addEventListener("click", () => {
    location.hash = `#/entries?month=${td.dataset.m}&category_id=${td.dataset.c}`;
  }));
}

async function modes(body, q) {
  const data = await api.paymentModes(q);
  const total = data.reduce((a, r) => a + r.amount, 0);
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Expenses by payment mode</h2><div class="kpi-value" style="font-size:20px;margin:0">${money(total)}</div></div>
      <div class="panel-body" id="rp-modes"></div>
    </section>`;
  barList($("#rp-modes"), data, { kind: "neutral", empty: "No expenses in this period" });
}
