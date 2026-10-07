// Dashboard: this month at a glance, balances, top categories, last 12 months.
import { api } from "../api.js";
import { barList, incomeExpenseChart } from "../charts.js";
import { $, dateLabel, esc, money, monthLabel, shiftMonth, store, thisMonth } from "../util.js";

export async function render(params) {
  const month = /^\d{4}-\d{2}$/.test(params.month || "") ? params.month : thisMonth();
  const d = await api.dashboard(month);
  if (d.setup_needed && !store.get("setupSkipped", false) && !params.month) {
    location.hash = "#/setup";   // first run: ask for starting balances
    return;
  }
  const s = d.summary, p = d.previous;
  const view = $("#view");

  const expDelta = p.expense ? ((s.expense - p.expense) / p.expense) * 100 : null;
  const deltaHtml = expDelta === null ? "No spending last month"
    : `<span class="${expDelta > 0 ? "up" : "down"}">${expDelta > 0 ? "▲" : "▼"} ${Math.abs(expDelta).toFixed(0)}%</span> vs ${money(p.expense)} last month`;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(monthLabel(month))}</h1>
        <div class="sub muted small">${s.entries} entr${s.entries === 1 ? "y" : "ies"} this month</div>
      </div>
      <div class="toolbar">
        <div class="month-nav">
          <a class="btn btn-icon" href="#/dashboard?month=${shiftMonth(month, -1)}" aria-label="Previous month">‹</a>
          <input type="month" id="dash-month" value="${month}">
          <a class="btn btn-icon" href="#/dashboard?month=${shiftMonth(month, 1)}" aria-label="Next month">›</a>
        </div>
        ${month !== thisMonth() ? `<a class="btn" href="#/dashboard">This month</a>` : ""}
      </div>
    </div>

    ${d.setup_needed ? `<div class="callout setup-banner" style="margin-bottom:16px">
      <strong>Set your starting balances</strong> — enter what each bank account, cash, credit card and investment stands at today,
      so the balances below are right. <a href="#/setup">Set them now →</a></div>` : ""}
    <div class="grid grid-4">
      ${kpi("Income", money(s.income), "var(--income)", s.income ? "incl. investment gains" : "—")}
      ${kpi("Expense", money(s.expense), "var(--expense)", deltaHtml)}
      ${kpi("Net savings", `<span class="${s.net < 0 ? "neg" : ""}">${money(s.net)}</span>`, "var(--brand)",
            s.savings_rate === null ? "—" : `${s.savings_rate}% of income saved`)}
      ${kpi("Invested", money(s.invested), "var(--invest)",
            s.redeemed_principal ? `${money(s.redeemed_principal)} principal redeemed` : "not counted as expense")}
    </div>

    <div class="grid grid-main" style="margin-top:16px">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Last 12 months</h2><a class="small" href="#/reports?tab=monthly">Monthly report →</a></div>
          <div class="panel-body" id="dash-chart"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Where the money went</h2><a class="small" href="#/reports?tab=categories&month=${month}">All categories →</a></div>
          <div class="panel-body" id="dash-cats"></div>
        </section>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Balances</h2><a class="small" href="#/settings">Accounts →</a></div>
          <div class="panel-body">${balances(d)}</div>
        </section>
      </div>
    </div>`;

  $("#dash-month").addEventListener("change", (e) => { if (e.target.value) location.hash = `#/dashboard?month=${e.target.value}`; });
  incomeExpenseChart($("#dash-chart"), d.last_12_months, { onClick: (m) => { location.hash = `#/dashboard?month=${m}`; } });
  barList($("#dash-cats"), d.top_categories, {
    empty: "No expenses recorded this month",
    onClick: (c) => { location.hash = `#/entries?month=${month}&type=expense&category_id=${c.id}`; },
  });
}

function kpi(label, value, color, foot) {
  return `<div class="panel kpi">
    <div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${foot}</div>
  </div>`;
}

function balances(d) {
  const groups = { bank: [], cash: [], credit_card: [], investment: [] };
  d.balances.filter((b) => b.active || b.balance).forEach((b) => groups[b.kind].push(b));
  const link = (b, inner) => `<a href="#/entries?account_id=${b.id}" style="color:inherit">${inner}</a>`;
  const row = (b, amt, cls = "") =>
    `<div class="bal-row">${link(b, esc(b.name))}<span class="amt ${cls}">${amt}</span></div>`;
  let html = "";
  const cash = [...groups.bank, ...groups.cash];
  if (cash.length) {
    html += `<div class="bal-group"><h3>Bank &amp; cash · ${money(d.totals.bank_and_cash)}</h3>
      ${cash.map((b) => row(b, money(b.balance), b.balance < 0 ? "neg" : "")).join("")}</div>`;
  }
  if (groups.credit_card.length) {
    html += `<div class="bal-group"><h3>Credit card outstanding · ${money(d.totals.card_outstanding)}</h3>
      ${groups.credit_card.map((b) => row(b, money(b.outstanding), b.outstanding > 0 ? "neg" : "")).join("")}</div>`;
  }
  html += `<div class="bal-group"><h3>Investments (principal) · ${money(d.totals.invested_principal)}</h3>
    ${groups.investment.length
      ? groups.investment.map((b) => row(b, money(b.open_principal))).join("")
      : `<p class="small faint" style="margin:4px 0">No investment accounts yet. <a href="#/settings">Add one</a> (Chitty, RD, FD, MF…)</p>`}</div>`;
  const dates = [...new Set(d.balances.filter((b) => b.opening_date).map((b) => b.opening_date))];
  html += `<p class="small faint" style="margin:14px 0 0">${dates.length === 1
    ? `From starting balances as on ${dateLabel(dates[0])}.`
    : dates.length ? "From each account's starting balance." : "No starting balances yet."} <a href="#/setup">Update</a></p>`;
  return html;
}

