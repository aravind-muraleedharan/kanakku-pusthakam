// Reports: Summary (totals, month by month, how you paid) and Categories (totals, month by month), with an Excel export.
import { api } from "../api.js";
import { barList, incomeExpenseChart } from "../charts.js";
import { info } from "../help.js";
import {
  $, $$, dateLabel, esc, financialYear, money, monthBounds, monthLabel, monthShort, shiftMonth, thisMonth, toast, todayISO, downloadFile,
} from "../util.js";

const TABS = { summary: "Summary", categories: "Categories" };
const OLD_TABS = { monthly: "summary", modes: "summary", grid: "categories" };   // links saved before the tabs were merged

/** Date ranges offered on Reports and on Transactions (Range). */
export function presets() {
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
  const tab = TABS[params.tab] ? params.tab : OLD_TABS[params.tab] || "summary";
  const P = presets();
  let range;
  if (params.month) range = { key: "custom", ...monthBounds(params.month), label: monthLabel(params.month) };
  else if (params.from || params.to) range = { key: "custom", from: params.from || "", to: params.to || "", label: "Custom" };
  else {
    const key = P[params.range] ? params.range : "last-12";
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
      <div><h1>Reports</h1></div>
      <div class="toolbar">
        <div class="rp-pick">
          <button type="button" class="rp-btn" id="rp-btn" aria-haspopup="true" aria-expanded="false">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
            <b>${esc(range.key === "custom" ? range.label : P[range.key].label)}</b>${range.from || range.to ? `<small>${esc(datesText(range))}</small>` : ""}<i aria-hidden="true">▾</i></button>
          <div class="rp-pop hidden" id="rp-pop" role="dialog" aria-label="Choose the period">
            <ul>${Object.entries(P).map(([k, p]) => `<li><button type="button" data-range="${k}" class="${k === range.key ? "on" : ""}">${esc(p.label)}</button></li>`).join("")}</ul>
            <form class="rp-custom" id="rp-custom" novalidate>
              <b>Custom dates</b>
              <label for="rp-from">From</label><input type="date" id="rp-from" value="${esc(range.from)}">
              <label for="rp-to">To</label><input type="date" id="rp-to" value="${esc(range.to)}">
              <div><button class="btn btn-primary btn-sm">Apply</button></div>
            </form>
          </div>
        </div>
        <button type="button" class="btn" id="rp-export" title="Every report for this period in one Excel file">Export to Excel</button>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${Object.entries(TABS).map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}" role="tab">${l}</button>`).join("")}
    </div>
    <div id="rp-body"><div class="loading">Loading…</div></div>`;

  $$(".tabs button").forEach((b) => b.addEventListener("click", () => nav({ tab: b.dataset.tab })));
  // period: a button showing the period and its dates; it opens quick picks + custom dates
  const pop = $("#rp-pop"), btn = $("#rp-btn");
  const show = (open) => { pop.classList.toggle("hidden", !open); btn.setAttribute("aria-expanded", open); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); show(pop.classList.contains("hidden")); });
  pop.addEventListener("click", (e) => e.stopPropagation());
  const close = () => { if (!document.body.contains(pop)) return document.removeEventListener("click", close); show(false); };
  document.addEventListener("click", close);
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { show(false); btn.focus(); } });
  $$("[data-range]", pop).forEach((b) => b.addEventListener("click", () => nav({ range: b.dataset.range, from: "", to: "" })));
  $("#rp-custom").addEventListener("submit", (e) => {
    e.preventDefault();
    const from = $("#rp-from").value, to = $("#rp-to").value;
    if (from && to && from > to) return toast("The From date is after the To date", true);
    nav({ range: "", from, to });
  });

  const q = { from: range.from || undefined, to: range.to || undefined };
  const body = $("#rp-body");
  $("#rp-export").addEventListener("click", (e) => downloadFile(
    api.reportsXlsxUrl({ ...q, label: range.key === "custom" ? "" : P[range.key].label }), "reports.xlsx", e.currentTarget));
  body.innerHTML = `<div id="rp-a"></div><div id="rp-b"></div>`;
  if (tab === "summary") {
    if (await monthly($("#rp-a"), q, range)) await modes($("#rp-b"), q);
  }
  if (tab === "categories") {
    await categories($("#rp-a"), q, kind, nav);
    await grid($("#rp-b"), q, kind);
  }
}

function datesText(r) {
  return `${r.from ? dateLabel(r.from) : "the start"} – ${r.to ? dateLabel(r.to) : "today"}`;
}

const entriesLink = (q, extra = "") =>
  `#/entries?month=&${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))).toString()}${extra}`;

async function monthly(body, q, range) {
  let rows = await api.monthly(q);
  // don't show empty future months of an open range
  const cur = thisMonth();
  rows = rows.filter((r) => r.month <= cur || r.entries);
  // compare only when your records cover the whole period before (otherwise it would show a false jump)
  let prev = previousPeriod(q);
  const [sum, sys] = await Promise.all([api.summary(q), prev ? api.info() : null]);
  if (prev && !(sys?.first_entry && sys.first_entry <= prev.q.from)) prev = null;
  const before = prev ? await api.summary(prev.q) : null;
  if (!rows.length) { body.innerHTML = `<div class="panel empty">No transactions in this period.</div>`; return false; }
  // averages leave out a month that isn't over yet (unless it's the only one)
  const done = rows.length > 1 ? rows.filter((r) => r.month < cur) : rows;
  const n = Math.max(done.length, 1);
  const avg = (k) => Math.round(done.reduce((a, r) => a + r[k], 0) / n);
  const avgTip = done.length < rows.length ? ` title="${esc(monthLabel(cur))} isn't over yet, so it's left out of the average"` : "";
  const single = rows.length === 1;
  const vs = prev ? `vs ${prev.label}` : "";
  // the money line under each amount: one month = the comparison; several = the average | the comparison
  const foot = (k) => single ? (vs || "&nbsp;") : `<span${avgTip}>avg ${money(avg(k))} a month</span>${vs ? ` | ${vs}` : ""}`;
  const net = Math.round((sum.invested - sum.redeemed_principal) * 100) / 100;
  body.innerHTML = `
    <div class="grid grid-4">
      ${tile("Income", `<span class="c-income">${money(sum.income)}</span>${change(sum.income, before?.income, true)}`, foot("income"), "var(--income)")}
      ${tile("Expense", `<span class="c-expense">${money(sum.expense)}</span>${change(sum.expense, before?.expense, false)}`, foot("expense"), "var(--expense)")}
      ${tile("Net savings", `<span class="${sum.net < 0 ? "c-expense" : ""}">${money(sum.net)}</span>${change(sum.net, before?.net, true)}`,
          sum.income <= 0 ? "No income in this period"
          : sum.net < 0 ? `Spent ${money(-sum.net)} more than earned`
          : `${sum.savings_rate}% of income saved`, "var(--net)")}
      ${tile(net >= 0 ? "Net invested" : "Net withdrawn", `<span class="c-invest">${money(Math.abs(net))}</span>`,
          `<span class="flow-in">▲ ${money(sum.invested)} in</span><span class="flow-out">▼ ${money(sum.redeemed_principal)} back</span>`, "var(--invest)")}
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
  return true;
}

/** The same-length period just before this one, to compare with. None for All time. */
function previousPeriod(q) {
  if (!q.from || !q.to) return null;
  const today = todayISO();
  const to = q.to > today ? today : q.to;                  // a period still running: compare the same stretch
  const [fy, fm, fd] = q.from.split("-").map(Number);
  const [ty, tm] = q.to.split("-").map(Number);
  if (fd === 1 && q.to === monthBounds(q.to.slice(0, 7)).to) {
    // whole months: shift both ends back by the number of months
    const n = (ty - fy) * 12 + (tm - fm) + 1;
    const from = monthBounds(shiftMonth(q.from.slice(0, 7), -n)).from;
    const m = shiftMonth(to.slice(0, 7), -n), end = monthBounds(m).to;
    const day = Math.min(+to.slice(8), +end.slice(8));
    const label = n === 1 ? monthLabel(m).split(" ")[0] + (to < q.to ? ` (1–${day})` : "") : `previous ${n} months`;
    return { q: { from, to: `${m}-${String(day).padStart(2, "0")}` }, label };
  }
  // any other dates: the same number of days just before
  const DAY = 86400000, a = Date.parse(q.from), days = Math.round((Date.parse(to) - a) / DAY) + 1;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  return { q: { from: iso(a - days * DAY), to: iso(a - DAY) }, label: `previous ${days} days` };
}

/** ▲/▼ change against the period before, as a pill; green when it's good news. */
function change(now, before, upIsGood) {
  if (before === undefined || before === null || !before || Math.sign(now) !== Math.sign(before)) return "";
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(pct) < 0.5) return `<span class="delta-pill flat">same</span>`;
  const good = pct > 0 === upIsGood;
  const text = Math.abs(pct) >= 300 ? `${(now / before).toFixed(1)}×` : `${Math.round(Math.abs(pct))}%`;
  return `<span class="delta-pill ${good ? "down" : "up"}">${pct > 0 ? "▲" : "▼"} ${text}</span>`;
}

function tile(label, value, foot, color = "var(--ink-3)") {
  return `<div class="panel kpi"><div class="kpi-label"><span class="dot" style="background:${color}"></span>${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

function kindToggle(kind) {
  // same look as Transactions: the picked side is filled in its colour
  return `<div class="seg types" id="rp-kind">
    <button data-v="income" class="${kind === "income" ? "on" : ""}">Income</button>
    <button data-v="expense" class="${kind === "expense" ? "on" : ""}">Expense</button></div>`;
}

async function categories(body, q, kind, nav) {
  const data = await api.categories({ ...q, kind });
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head">${kindToggle(kind)}<div class="kpi-value" style="font-size:20px;margin:0">${money(data.total)}</div></div>
      <div class="panel-body">${data.items.length ? shareStrip(data.items) : `<div class="empty small">No ${kind} in this period</div>`}</div>
    </section>`;
  $$("#rp-kind button").forEach((b) => b.addEventListener("click", () => nav({ kind: b.dataset.v })));
  // a piece of the strip or a line of the list opens that category's transactions for the same period
  $$("[data-cat]", body).forEach((el) => el.addEventListener("click", () => { location.hash = entriesLink(q, `&category_id=${el.dataset.cat}`); }));
}

const SHARE_COLORS = ["var(--t-share)", "var(--t-fd)", "var(--t-gold)", "var(--t-ppf)", "var(--t-chitty)", "var(--t-x1)", "var(--t-x2)",
  "var(--t-x3)", "var(--t-x4)", "var(--t-x5)", "var(--t-x6)", "var(--t-rd)", "var(--t-silver)"];

/** One bar cut into pieces by share, with every category listed under it (amount and %). */
function shareStrip(items) {
  const color = (i) => SHARE_COLORS[i % SHARE_COLORS.length];
  const tip = (c) => `${c.name}: ${money(c.amount)} | ${c.share}% | ${c.count} transaction${c.count === 1 ? "" : "s"}`;
  return `<div class="sh-strip" role="img" aria-label="Share of each category">${items.map((c, i) =>
      `<i data-cat="${c.id}" style="flex:${c.amount} 0 0;background:${color(i)}" title="${esc(tip(c))}"></i>`).join("")}</div>
    <div class="sh-list">${items.map((c, i) => `<button type="button" data-cat="${c.id}" title="${esc(tip(c))}">
      <s style="background:${color(i)}"></s><span>${esc(c.name)}</span><b>${money(c.amount)}</b><em>${c.share}%</em></button>`).join("")}</div>`;
}

async function grid(body, q, kind) {
  const g = await api.grid({ ...q, kind });
  if (g.rows.length < 2) { body.innerHTML = ""; return; }
  const max = Math.max(...g.rows.flatMap((r) => r.values), 1);
  const color = kind === "income" ? "var(--income)" : "var(--expense)";
  body.innerHTML = `
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2 class="h2-info">Month by month ${info("rp_grid")}</h2></div>
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
  $$("td[data-m]", body).forEach((td) => td.addEventListener("click", () => {
    location.hash = `#/entries?month=${td.dataset.m}&category_id=${td.dataset.c}`;
  }));
}

async function modes(body, q) {
  const data = await api.paymentModes(q);
  const total = data.reduce((a, r) => a + r.amount, 0);
  body.innerHTML = `
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>How you paid your expenses</h2><div class="kpi-value" style="font-size:20px;margin:0">${money(total)}</div></div>
      <div class="panel-body" id="rp-modes"></div>
    </section>`;
  barList($("#rp-modes"), data, { kind: "neutral", empty: "No expenses in this period" });
}
