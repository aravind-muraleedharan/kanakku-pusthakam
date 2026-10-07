// Entries list with filters, totals, CSV export.
import { api } from "../api.js";
import { masters } from "../state.js";
import { $, dayLabel, esc, money, monthLabel, options, shiftMonth, thisMonth, TYPE_LABEL } from "../util.js";

const PAGE = 200;

export async function render(params) {
  const M = await masters();
  // default view: this month, unless another filter (e.g. account) was given
  const f = { ...params };
  if (!("month" in f) && !f.from && !f.to && !f.account_id && !f.q) f.month = thisMonth();

  const view = $("#view");
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Entries</h1><div class="sub small muted" id="ent-sub"></div></div>
      <div class="toolbar">
        <a class="btn" id="ent-export" href="#">Export CSV</a>
        <a class="btn btn-primary" href="#/add">+ Add entry</a>
      </div>
    </div>
    <section class="panel">
      <div class="filters">
        <div class="month-nav">
          <button class="btn btn-icon" data-shift="-1" aria-label="Previous month">‹</button>
          <input type="month" id="flt-month" value="${esc(f.month || "")}" title="Month">
          <button class="btn btn-icon" data-shift="1" aria-label="Next month">›</button>
        </div>
        <select id="flt-type"><option value="">All types</option>${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="flt-cat">${options(M.categories.map((c) => ({ ...c, name: c.name + (c.kind === "income" ? " (income)" : "") })), f.category_id, { placeholder: "All categories" })}</select>
        <select id="flt-acc">${options(M.accounts, f.account_id, { placeholder: "All accounts" })}</select>
        <input type="search" id="flt-q" placeholder="Search notes…" value="${esc(f.q || "")}">
        <button class="btn btn-ghost btn-sm" id="flt-clear">Clear</button>
      </div>
      <div class="totals-strip" id="ent-totals"></div>
      <div class="table-wrap" id="ent-table"><div class="loading">Loading…</div></div>
    </section>`;

  const go = (patch) => {
    const next = { ...f, ...patch };
    Object.keys(next).forEach((k) => { if (next[k] === "" || next[k] == null) delete next[k]; });
    if (!next.month) next.month = "";   // explicit "all time"
    location.hash = "#/entries?" + new URLSearchParams(next).toString();
  };
  $("#flt-month").addEventListener("change", (e) => go({ month: e.target.value }));
  view.querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () =>
    go({ month: shiftMonth(f.month || thisMonth(), +b.dataset.shift) })));
  $("#flt-type").addEventListener("change", (e) => go({ type: e.target.value }));
  $("#flt-cat").addEventListener("change", (e) => go({ category_id: e.target.value }));
  $("#flt-acc").addEventListener("change", (e) => go({ account_id: e.target.value }));
  let qTimer;
  $("#flt-q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => go({ q: e.target.value }), 400); });
  $("#flt-clear").addEventListener("click", () => { location.hash = "#/entries"; });

  const query = { ...f };
  if (!query.month) delete query.month;
  $("#ent-export").href = api.exportUrl(query);
  $("#ent-sub").textContent = describe(f, M);

  await load(query, 0, []);
}

function describe(f, M) {
  const bits = [f.month ? monthLabel(f.month) : f.from || f.to ? `${f.from || "…"} to ${f.to || "…"}` : "All time"];
  if (f.account_id) bits.push(M.accounts.find((a) => String(a.id) === f.account_id)?.name);
  return bits.filter(Boolean).join(" · ");
}

async function load(query, offset, previous) {
  const res = await api.entries({ ...query, limit: PAGE, offset });
  const items = previous.concat(res.items);
  const t = res.totals;
  $("#ent-totals").innerHTML = `
    <span>${res.count} entr${res.count === 1 ? "y" : "ies"}</span>
    <span>Income <b class="c-income">${money(t.income)}</b></span>
    <span>Expense <b class="c-expense">${money(t.expense)}</b></span>
    <span>Net <b>${money(t.income - t.expense)}</b></span>
    ${t.invested ? `<span>Invested <b class="c-invest">${money(t.invested)}</b></span>` : ""}
    ${t.transferred ? `<span>Transfers <b class="c-transfer">${money(t.transferred)}</b></span>` : ""}`;

  if (!items.length) {
    $("#ent-table").innerHTML = `<div class="empty"><div class="big">🧾</div><p>No entries here yet.</p><a class="btn btn-primary" href="#/add">Add your first entry</a></div>`;
    return;
  }
  $("#ent-table").innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="hide-sm">Account</th><th class="hide-sm">Mode</th><th class="num">Amount</th></tr></thead>
      <tbody>${items.map(row).join("")}</tbody>
    </table>
    ${items.length < res.count ? `<div style="padding:14px;text-align:center"><button class="btn" id="ent-more">Show more (${res.count - items.length} left)</button></div>` : ""}`;
  $("#ent-table tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = `#/edit/${tr.dataset.id}`;
  });
  $("#ent-more")?.addEventListener("click", () => load(query, offset + PAGE, items));
}

function row(e) {
  const title = {
    expense: e.category, income: e.category,
    transfer: e.to_kind === "credit_card" ? "Card bill payment" : "Transfer",
    invest: `Invested in ${e.to_account}`, redeem: `Redeemed from ${e.from_account}`,
  }[e.type];
  let sub = e.note ? esc(e.note) : "";
  if (e.type === "redeem") {
    const g = e.gain;
    sub = `${sub ? sub + " · " : ""}<span class="${g < 0 ? "c-expense" : "c-income"}">${g < 0 ? "loss" : "gain"} ${money(Math.abs(g))}</span>`;
  }
  const acct = { expense: e.from_account, income: e.to_account }[e.type] || `${esc(e.from_account)} → ${esc(e.to_account)}`;
  const sign = e.type === "expense" ? "−" : e.type === "income" ? "+" : "";
  return `<tr class="click" data-id="${e.id}">
    <td style="white-space:nowrap">${dayLabel(e.date)}</td>
    <td><span class="chip t-${e.type}">${TYPE_LABEL[e.type]}</span></td>
    <td><div class="cell-main">${esc(title)}</div>${sub ? `<div class="cell-sub">${sub}</div>` : ""}</td>
    <td class="hide-sm small">${typeof acct === "string" && !acct.includes("→") ? esc(acct) : acct}</td>
    <td class="hide-sm small muted">${esc(e.payment_mode || "")}</td>
    <td class="num c-${e.type}" style="font-weight:650">${sign}${money(e.amount)}</td>
  </tr>`;
}
