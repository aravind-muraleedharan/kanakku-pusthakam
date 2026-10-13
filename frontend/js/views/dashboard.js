// Dashboard: this month at a glance, net worth, investments, what's coming up, top categories, accounts.
import { api } from "../api.js";
import { barList, donutChart, incomeExpenseChart } from "../charts.js";
import { typeColor } from "./investments.js";
import { $, dateLabel, esc, money, monthLabel, shiftMonth, store, thisMonth } from "../util.js";

export async function render(params) {
  const month = /^\d{4}-\d{2}$/.test(params.month || "") ? params.month : thisMonth();
  const [d, inv] = await Promise.all([api.dashboard(month), api.investments().catch(() => null)]);
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
        <div class="sub muted small">${s.entries} transaction${s.entries === 1 ? "" : "s"} this month</div>
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
      ${kpi("Net savings", `<span class="${s.net < 0 ? "neg" : ""}">${money(s.net)}</span>`, "var(--net)",
            s.savings_rate === null ? "—" : `${s.savings_rate}% of income saved`)}
      ${kpi("Invested", money(s.invested), "var(--invest)",
            s.redeemed_principal ? `${money(s.redeemed_principal)} principal redeemed` : "not counted as expense")}
    </div>

    <div class="grid grid-main" style="margin-top:16px">
      <section class="panel">
        <div class="panel-head"><h2>Last 12 months</h2><a class="small" href="#/reports?tab=monthly">Monthly report →</a></div>
        <div class="panel-body" id="dash-chart"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Net worth</h2><a class="small" href="#/money">Money Manager →</a></div>
        <div class="panel-body">${netWorth(d.totals)}</div>
      </section>
    </div>

    <div class="grid grid-main" style="margin-top:16px">
      <section class="panel">
        <div class="panel-head"><h2>Investments</h2><a class="small" href="#/investments">All investments →</a></div>
        <div class="panel-body" id="dash-inv"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Coming up</h2><span class="small faint">next 3 months</span></div>
        <div class="panel-body">${comingUp(inv, d.loans)}</div>
      </section>
    </div>

    <div class="grid grid-main" style="margin-top:16px">
      <section class="panel">
        <div class="panel-head"><h2>Where the money went</h2><a class="small" href="#/reports?tab=categories&month=${month}">All categories →</a></div>
        <div class="panel-body" id="dash-cats"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Accounts</h2><a class="small" href="#/money">All accounts →</a></div>
        <div class="panel-body">${accounts(d)}</div>
      </section>
    </div>`;

  $("#dash-month").addEventListener("change", (e) => { if (e.target.value) location.hash = `#/dashboard?month=${e.target.value}`; });
  incomeExpenseChart($("#dash-chart"), d.last_12_months, { onClick: (m) => { location.hash = `#/dashboard?month=${m}`; } });
  if (inv && inv.by_type.length) {
    donutChart($("#dash-inv"), inv.by_type.map((x) => ({
      label: x.label, value: x.value, color: typeColor(x.color), sub: `${x.count} · invested ${money(x.invested)}`,
    })), { centerLabel: "Total value", onClick: () => { location.hash = "#/investments"; } });
  } else {
    $("#dash-inv").innerHTML = `<div class="empty small" style="padding:24px 0">No investments yet. <a href="#/investments">Add one</a></div>`;
  }
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

/** Net worth: what you have vs what you owe, as two bars on one scale. */
function netWorth(t) {
  const have = [
    { label: "Bank & cash", value: Math.max(0, t.bank_and_cash), color: "var(--net)", href: "#/money" },
    { label: "Investments", value: Math.max(0, t.investments_value ?? t.invested_principal), color: "var(--income)", href: "#/investments" },
  ];
  const owe = [
    { label: "Credit cards", value: Math.max(0, t.card_outstanding), color: "var(--expense)", href: "#/money" },
    { label: "Loans & EMIs", value: Math.max(0, t.loans_outstanding || 0), color: "var(--t-chitty)", href: "#/loans" },
  ];
  const sum = (l) => l.reduce((a, x) => a + x.value, 0);
  const H = sum(have), O = sum(owe), top = Math.max(H, O, 1);
  const bar = (list, total) => `<div class="nw-bar" style="width:${Math.max(2, (total / top) * 100)}%">${list.filter((x) => x.value > 0)
    .map((x) => `<i style="flex:${x.value};background:${x.color}" title="${esc(x.label)}: ${money(x.value)}"></i>`).join("")}</div>`;
  const legend = (list) => list.map((x) => `<a class="nw-leg" href="${x.href}"><span><i style="background:${x.color}"></i>${esc(x.label)}</span>
    <b>${money(x.value)}</b></a>`).join("");
  return `<div class="nw-hero ${t.net_worth < 0 ? "neg" : ""}">${money(t.net_worth)}</div>
    <div class="small faint" style="margin:-2px 0 14px">what you have − what you owe</div>
    <div class="nw-line"><span>You have</span><b>${money(H)}</b></div>${bar(have, H)}<div class="nw-legs">${legend(have)}</div>
    <div class="nw-line" style="margin-top:14px"><span>You owe</span><b>${money(O)}</b></div>${bar(owe, O)}<div class="nw-legs">${legend(owe)}</div>`;
}

/** Investment maturities, payouts and instalments due, plus the next EMI of each loan. */
function comingUp(inv, loans) {
  const what = { maturity: "Matures", payout_due: "Interest due · record it", payout: "Interest payout",
    rd_due: "Instalment due", rd_missed: "Instalments not recorded" };
  const list = [
    ...(inv ? inv.upcoming : []).map((u) => ({ date: u.date, name: u.name, label: u.kind === "rd_missed" ? `${u.count} ${what.rd_missed.toLowerCase()}` : what[u.kind],
      amount: u.amount, href: `#/investment/${u.id}`, due: ["payout_due", "rd_missed"].includes(u.kind), now: u.kind === "rd_missed" })),
    ...(loans || []).filter((l) => l.next).map((l) => ({ date: l.next.date, name: l.name, label: "EMI", amount: l.next.amount, href: `#/loan/${l.id}` })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 7);
  if (!list.length) return `<div class="empty small" style="padding:24px 0">Nothing due in the next 3 months</div>`;
  return `<div class="up-list">${list.map((u) => `<a class="up-row" href="${u.href}">
      <span class="up-date ${u.due ? "due" : ""}">${u.now ? "Now" : esc(dateLabel(u.date))}</span>
      <span><span class="cell-main">${esc(u.name)}</span><div class="cell-sub">${esc(u.label)}</div></span>
      <span class="amt num">${money(u.amount)}</span></a>`).join("")}</div>`;
}

/** Bank & cash with money in them, and cards you owe on. Empty accounts stay in Money Manager. */
function accounts(d) {
  const banks = d.balances.filter((b) => ["bank", "cash"].includes(b.kind) && b.balance).sort((a, b) => b.balance - a.balance);
  const cards = d.balances.filter((b) => b.kind === "credit_card" && b.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  const MAX = 5;
  const row = (b, amt, cls = "") => `<a class="acc-row" href="#/entries?account_id=${b.id}"><span>${esc(b.name)}</span><b class="${cls}">${amt}</b></a>`;
  const more = (n) => (n > 0 ? `<a class="small" href="#/money">+ ${n} more</a>` : "");
  return `<div class="acc-grp"><div class="acc-h"><span>Bank &amp; cash</span><b>${money(d.totals.bank_and_cash)}</b></div>
      ${banks.length ? banks.slice(0, MAX).map((b) => row(b, money(b.balance), b.balance < 0 ? "neg" : "")).join("") + more(banks.length - MAX)
        : `<p class="small faint" style="margin:4px 0">No money in any account yet.</p>`}</div>
    <div class="acc-grp"><div class="acc-h"><span>Credit cards owed</span><b class="${d.totals.card_outstanding > 0 ? "neg" : ""}">${money(d.totals.card_outstanding)}</b></div>
      ${cards.length ? cards.slice(0, MAX).map((b) => row(b, money(b.outstanding), "neg")).join("") + more(cards.length - MAX)
        : `<p class="small faint" style="margin:4px 0">Nothing owed on your cards.</p>`}</div>
    <p class="small faint" style="margin:10px 0 0">Accounts with ₹0 are left out here; see them all in Money Manager.</p>`;
}
