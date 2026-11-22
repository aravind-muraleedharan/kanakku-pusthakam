// Transactions list with filters, totals, CSV export.
import { api } from "../api.js";
import { masters } from "../state.js";
import { $, bindMonthPicker, dateLabel, dayLabel, esc, KIND_LABEL, money, monthLabel, monthPicker, options, shiftMonth, thisMonth, TYPE_LABEL } from "../util.js";
import { presets } from "./reports.js";
import { ICON } from "../icons.js";
import { donutChart } from "../charts.js";

const PAGE = 50;   // rows per page

export async function render(params) {
  const M = await masters();
  // default view: this month, unless another filter (e.g. account) was given
  const f = { ...params };
  if (!("month" in f) && !f.from && !f.to && !f.account_id && !f.q) f.month = thisMonth();

  // Period: one month (‹ November 2026 ›), or a Range (from - to, with quick picks; both empty = all time)
  const rangeMode = !f.month;
  const quick = Object.entries(presets()).filter(([k]) => !["this-month", "last-month", "all"].includes(k));
  const periodLabel = f.month ? monthLabel(f.month)
    : f.from || f.to ? `${f.from ? dateLabel(f.from) : "the start"} – ${f.to ? dateLabel(f.to) : "today"}` : "all time";
  const period = `<div class="period">
        <div class="seg period-mode" role="tablist" aria-label="One month or a date range">
          <button type="button" data-mode="month" class="${rangeMode ? "" : "on"}">Month</button><button type="button" data-mode="range" class="${rangeMode ? "on" : ""}">Range</button></div>
        ${rangeMode ? `<div class="range-ctl">
          <input type="date" id="flt-from" value="${esc(f.from || "")}" aria-label="From date" title="From">
          <span class="faint">to</span>
          <input type="date" id="flt-to" value="${esc(f.to || "")}" aria-label="To date" title="To">
          <select id="flt-quick" aria-label="Quick pick"><option value="">Quick pick…</option>${quick.map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("")}</select>
        </div>` : `<div class="month-nav">
          <button class="btn btn-icon" data-shift="-1" aria-label="Previous month">‹</button>
          ${monthPicker("flt-month", f.month)}
          <button class="btn btn-icon" data-shift="1" aria-label="Next month">›</button>
        </div>`}</div>`;
  // the Earned | Spent panel shows unless the list is narrowed to one category or another type;
  // when it shows, the period sits in its heading, otherwise beside the page title
  const catsPanel = !f.category_id && (!f.type || f.type === "expense" || f.type === "income");
  const view = $("#view");
  view.innerHTML = `
    <div class="page-head">
      <div><div class="h1-row"><h1>Transactions</h1>
        ${catsPanel ? "" : period}</div><div class="sub small muted" id="ent-sub"></div></div>
      <div class="toolbar">
        <a class="btn btn-primary" href="#/add">+ Transaction</a>
        <a class="btn" id="ent-export" href="#">Export CSV</a>
      </div>
    </div>
    <section class="panel" id="ent-cats-panel" style="margin-bottom:16px" ${catsPanel ? "" : "hidden"}>
      <div class="panel-head"><div class="cats-title">${f.type
          ? `<h2 class="c-${f.type}">${f.type === "income" ? "Earned" : "Spent"}</h2>`
          : `<div class="seg types" id="ent-cats-kind" role="tablist" aria-label="Spent or earned">
          <button type="button" data-v="income" role="tab">Earned</button><button type="button" data-v="expense" role="tab">Spent</button></div>`}
        ${catsPanel ? period : ""}</div>
        <a class="small" id="ent-cats-all" href="#">Reports →</a></div>
      <div class="panel-body" id="ent-cats"></div>
    </section>
    <section class="panel">
      <div class="filters">
        <span class="flt-ico" title="Filter the list" aria-hidden="true">${ICON.filter}</span>
        <select id="flt-type"><option value="">All types</option>${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${catSelect(M.categories, f)}
        <select id="flt-acc">${accountOptions(M.accounts, f.account_id)}</select>
        <input type="search" id="flt-q" placeholder="Search" title="Searches notes and category names" aria-label="Search notes and categories" value="${esc(f.q || "")}">
        ${filtered(f) ? `<button class="btn btn-ghost btn-sm flt-clear" id="flt-clear" title="Clear filters">✕ Clear</button>` : ""}
        <nav class="pg-mini" id="ent-pg-top" aria-label="Pages" hidden></nav>
      </div>
      <div class="totals-strip" id="ent-totals"></div>
      <div class="table-wrap" id="ent-table"><div class="loading">Loading…</div></div>
    </section>`;

  const go = (patch) => {
    const next = { ...f, ...patch };
    if (!("page" in patch)) delete next.page;   // any filter change starts again at page 1
    Object.keys(next).forEach((k) => { if (next[k] === "" || next[k] == null) delete next[k]; });
    if (!next.month) next.month = "";   // explicit "all time"
    location.hash = "#/entries?" + new URLSearchParams(next).toString();
  };
  if ($("#flt-month")) {
    bindMonthPicker($("#flt-month"));
    $("#flt-month").addEventListener("change", (e) => go({ month: e.target.value }));
    view.querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () =>
      go({ month: shiftMonth(f.month || thisMonth(), +b.dataset.shift) })));
  }
  // Month <-> Range: a range starts as the last 3 months; going back to Month shows this month
  view.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    if ((b.dataset.mode === "range") === rangeMode) return;
    if (b.dataset.mode === "range") { const p = presets()["last-3"]; go({ month: "", from: p.from, to: p.to }); }
    else go({ month: thisMonth(), from: "", to: "" });
  }));
  const setRange = () => {
    let a = $("#flt-from").value, z = $("#flt-to").value;
    if (a && z && a > z) [a, z] = [z, a];          // picked the wrong way round: swap
    go({ month: "", from: a, to: z });
  };
  $("#flt-from")?.addEventListener("change", setRange);
  $("#flt-to")?.addEventListener("change", setRange);
  $("#flt-quick")?.addEventListener("change", (e) => {
    const p = presets()[e.target.value];
    if (p) go({ month: "", from: p.from, to: p.to });
  });
  $("#flt-type").addEventListener("change", (e) => {
    // a category that doesn't belong to the new type would only give an empty list, so drop it
    const t = e.target.value, cat = M.categories.find((c) => String(c.id) === String(f.category_id));
    go({ type: t, ...(cat && t && cat.kind !== t ? { category_id: "" } : {}) });
  });
  $("#flt-cat")?.addEventListener("change", (e) => go({ category_id: e.target.value }));
  $("#flt-acc").addEventListener("change", (e) => go({ account_id: e.target.value }));
  let qTimer;
  $("#flt-q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => go({ q: e.target.value }), 400); });
  $("#flt-clear")?.addEventListener("click", () => { location.hash = "#/entries"; });

  // Spending (or income) by category for the month shown; a Spent | Earned switch picks which.
  // Shown only when one month is picked and the list isn't narrowed to one category or another type.
  if (catsPanel) {
    const span = f.month ? { month: f.month } : { from: f.from || "", to: f.to || "" };   // what the chart covers
    const PIE = ["var(--t-share)", "var(--t-fd)", "var(--t-gold)", "var(--t-ppf)", "var(--t-chitty)", "var(--t-x1)"];
    const drawCats = (kind) => {
      $("#ent-cats-kind")?.querySelectorAll("button").forEach((b) => {
        const on = b.dataset.v === kind; b.classList.toggle("on", on); b.setAttribute("aria-selected", on);
      });
      $("#ent-cats-all").href = `#/reports?tab=categories&${new URLSearchParams(span)}${kind === "income" ? "&kind=income" : ""}`;
      return api.categories({ ...span, kind }).then((c) => {
        const items = c.items || [];
        if (!items.length) {
          $("#ent-cats").innerHTML = `<div class="empty-state small muted">No ${kind === "income" ? "income" : "spending"} ${f.month ? "in" : "for"} ${esc(periodLabel)}.</div>`;
          return items;
        }
        const top = items.length > 7 ? [...items.slice(0, 6), { id: null, name: `${items.length - 6} more categories`,
          amount: items.slice(6).reduce((a, i) => a + i.amount, 0), count: items.slice(6).reduce((a, i) => a + i.count, 0) }] : items;
        donutChart($("#ent-cats"), top.map((x, i) => ({
          id: x.id, label: x.name, value: x.amount, color: x.id === null ? "var(--t-silver)" : PIE[i % PIE.length],
          sub: `${x.count} transaction${x.count === 1 ? "" : "s"}`,
        })), {
          centerLabel: kind === "income" ? "Earned" : "Spent", label: kind === "income" ? "Income by category" : "Spending by category",
          onClick: (x) => { if (x.id === null) location.hash = $("#ent-cats-all").getAttribute("href"); else go({ type: kind, category_id: x.id }); },
        });
        // only a few slices: smaller ring and a single list, so there's no big empty band
        $("#ent-cats").classList.toggle("few", top.length <= 3);
        return items;
      });
    };
    // a type filter decides it; otherwise the last tab picked (kept while moving between months)
    const kind = f.type || (sessionStorage.getItem("ent-cats-kind") === "income" ? "income" : "expense");
    drawCats(kind).catch(() => {});
    $("#ent-cats-kind")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]"); if (!b) return;
      sessionStorage.setItem("ent-cats-kind", b.dataset.v);
      drawCats(b.dataset.v).catch(() => {});
    });
  }

  const query = { ...f };
  if (!query.month) delete query.month;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  delete query.page;
  $("#ent-export").href = api.exportUrl(query);
  $("#ent-sub").textContent = describe(f, M);

  // another page: land at the top of the list (its filter bar), not the top of the page
  await load(query, page, (n) => { sessionStorage.setItem("ent-to-list", "1"); go({ page: n > 1 ? String(n) : "" }); });
  if (sessionStorage.getItem("ent-to-list")) {
    sessionStorage.removeItem("ent-to-list");
    const bar = $(".filters"), top = bar.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, top) });
    $("#view").dataset.keepScroll = "1";
  }
}

// Category filter, matched to the type: expense or income categories only, both under headings for
// "All types", and none at all for transfers / investments / maturities (they have no category).
function catSelect(cats, f) {
  if (f.type && !["expense", "income"].includes(f.type)) return "";
  const sel = f.category_id;
  const pick = (k) => options(cats.filter((c) => c.kind === k), sel);
  const body = f.type ? pick(f.type)
    : `<optgroup label="Expense">${pick("expense")}</optgroup><optgroup label="Income">${pick("income")}</optgroup>`;
  return `<select id="flt-cat"><option value="">All categories</option>${body}</select>`;
}

// anything beyond the default "this month" view (the page number doesn't count)
const filtered = (f) => !!(f.type || f.category_id || f.account_id || f.q || f.from || f.to || (f.month !== undefined && f.month !== thisMonth()));

function accountOptions(accounts, sel) {
  const groups = {};
  accounts.forEach((a) => (groups[a.kind] ||= []).push(a));
  return `<option value="">All accounts</option>` + ["bank", "credit_card", "cash", "wallet", "investment", "loan"].filter((k) => groups[k])
    .map((k) => `<optgroup label="${esc(KIND_LABEL[k])}">${options(groups[k], sel)}</optgroup>`).join("");
}

function describe(f, M) {
  // the month is already in the picker beside the title, so only say what it can't show
  // the period is already in the picker (month or from/to), so only say what it can't show
  const bits = [f.month || f.from || f.to ? "" : "All time"];
  if (f.account_id) bits.push(M.accounts.find((a) => String(a.id) === f.account_id)?.name);
  return bits.filter(Boolean).join(" | ");
}

async function load(query, page, toPage) {
  let res = await api.entries({ ...query, limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(res.count / PAGE));
  if (page > pages) { page = pages; res = await api.entries({ ...query, limit: PAGE, offset: (page - 1) * PAGE }); }   // e.g. after deletes
  const items = res.items;
  const t = res.totals;
  $("#ent-totals").classList.toggle("hidden", !res.count);
  const net = t.income - t.expense;
  // a type's total is a button: it shows just that type for the same period (click again to show all)
  const stat = (label, value, cls, type = "") => {
    const on = type && query.type === type;
    const inner = `<span class="ts-k">${label}</span><b class="ts-v ${cls}">${value}</b>`;
    return type ? `<button type="button" class="ts-item ts-click ${on ? "on" : ""}" data-type="${type}" aria-pressed="${on}"
        title="${on ? "Show all types" : `Show only ${label.toLowerCase()}`}">${inner}</button>` : `<div class="ts-item">${inner}</div>`;
  };
  $("#ent-totals").innerHTML = stat("Income", money(t.income), "c-income", "income")
    + stat("Expense", money(t.expense), "c-expense", "expense")
    + stat("Net", money(net, { sign: true }), net < 0 ? "c-expense" : "c-income")
    + (t.invested ? stat("Invested", money(t.invested), "c-invest", "invest") : "")
    + (t.transferred ? stat("Transfers", money(t.transferred), "c-transfer", "transfer") : "")
    + stat(res.count === 1 ? "Transaction" : "Transactions", res.count, "ts-n");
  $("#ent-totals").onclick = (e) => {
    const b = e.target.closest("[data-type]"); if (!b) return;
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    if (p.get("type") === b.dataset.type) p.delete("type"); else p.set("type", b.dataset.type);
    p.delete("category_id"); p.delete("page");
    if (!p.has("month") && !p.get("from") && !p.get("to")) p.set("month", query.month || "");
    location.hash = `#/entries?${p}`;
  };

  if (!items.length) {
    const f = Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));
    const period = query.month ? `in ${monthLabel(query.month)}` : query.from || query.to ? "in this date range" : "yet";
    const other = filtered({ ...f, month: undefined, from: undefined, to: undefined });   // filters beyond the period
    $("#ent-table").innerHTML = `<div class="empty-state">
      <div class="empty-ico">${ICON.transactions}</div>
      <h3>${other ? "Nothing matches these filters" : `No transactions ${esc(period)}`}</h3>
      ${other ? `<p class="muted small">Try another period, or clear the filters.</p>` : ""}
    </div>`;
    return;
  }
  $("#ent-table").innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="hide-sm">Account</th><th class="hide-sm">Mode</th><th class="num">Amount</th></tr></thead>
      <tbody>${items.map(row).join("")}</tbody>
    </table>
    ${pages > 1 ? pager(page, pages, res.count) : ""}`;
  // the same pages, small, at the top: ‹ 3 of 6 ›
  const top = $("#ent-pg-top");
  top.hidden = pages <= 1;
  top.innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>
    <span><b>${page}</b> of ${pages}</span>
    <button type="button" data-page="${page + 1}" ${page === pages ? "disabled" : ""} aria-label="Next page">›</button>` : "";
  $("#ent-table tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = `#/edit/${tr.dataset.id}`;
  });
  const onPage = (e) => {
    const b = e.target.closest("button[data-page]");
    if (b && !b.disabled) toPage(+b.dataset.page);
  };
  $("#ent-table .pager")?.addEventListener("click", onPage);
  top.onclick = onPage;
}

/** "Showing 51–100 of 584"   ‹ Prev  1 … 4 5 6 … 12  Next › */
function pager(page, pages, count) {
  // first, last, and the pages around this one (a few more near either end, so it never shows just "1 2 … 6")
  const near = page <= 3 ? [2, 3, 4] : page >= pages - 2 ? [pages - 3, pages - 2, pages - 1] : [page - 1, page, page + 1];
  const nums = [...new Set([1, page, ...near, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  let last = 0, btns = "";
  for (const n of nums) {
    if (n - last > 1) btns += `<span class="pg-gap">…</span>`;
    btns += `<button type="button" class="pg-n ${n === page ? "on" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""}>${n}</button>`;
    last = n;
  }
  const from = (page - 1) * PAGE + 1, to = Math.min(page * PAGE, count);
  return `<nav class="pager" aria-label="Pages">
    <span class="pg-info">Showing <b>${from}–${to}</b> of <b>${count}</b></span>
    <div class="pg-btns">
      <button type="button" class="pg-step" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>‹ Prev</button>
      ${btns}
      <button type="button" class="pg-step" data-page="${page + 1}" ${page === pages ? "disabled" : ""}>Next ›</button>
    </div></nav>`;
}

// say what kind of move a transfer was, from the two account kinds
function transferTitle(e) {
  const f = e.from_kind, t = e.to_kind;
  if (t === "credit_card") return "Card bill payment";
  if (t === "loan") return "Loan payment";
  if (f === "loan") return "Loan received";
  if (f === "investment") return "From investment";
  if (t === "cash" && f !== "cash") return "Cash withdrawal";
  if (f === "cash" && t !== "cash") return "Cash deposit";
  if (t === "wallet") return "Wallet top-up";
  if (f === "wallet") return "From wallet";
  if (f === "bank" && t === "bank") return "Between bank accounts";
  return "Transfer";
}

function row(e) {
  const title = {
    expense: e.category, income: e.category,
    transfer: transferTitle(e),
    invest: `Invested in ${e.to_account}`, redeem: `Maturity / withdrawal: ${e.from_account}`,
  }[e.type];
  let sub = e.note ? esc(e.note) : "";
  if (e.type === "redeem") {
    const g = e.gain;
    sub = `${sub ? sub + " | " : ""}<span class="${g < 0 ? "c-expense" : "c-income"}">${g < 0 ? "loss" : "gain"} ${money(Math.abs(g))}</span>`;
  }
  const one = { expense: e.from_account, income: e.to_account }[e.type];
  const acct = one ? esc(one) : `<span class="acct-flow">${esc(e.from_account)}<b aria-label="to">→</b>${esc(e.to_account)}</span>`;
  const sign = e.type === "expense" ? "−" : e.type === "income" ? "+" : "";
  return `<tr class="click" data-id="${e.id}">
    <td style="white-space:nowrap">${dayLabel(e.date)}</td>
    <td><span class="chip t-${e.type}">${TYPE_LABEL[e.type]}</span></td>
    <td><div class="cell-main">${esc(title)}</div>${sub ? `<div class="cell-sub">${sub}</div>` : ""}</td>
    <td class="hide-sm small">${acct}</td>
    <td class="hide-sm small muted">${esc(e.payment_mode || "")}</td>
    <td class="num c-${e.type}" style="font-weight:650">${sign}${money(e.amount)}</td>
  </tr>`;
}
