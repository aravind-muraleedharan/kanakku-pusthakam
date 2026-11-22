// Dashboard: this month at a glance, net worth, investments, what's coming up, top categories, accounts.
import { api } from "../api.js";
import { donutChart } from "../charts.js";
import { typeColor } from "./investments.js";
import { info } from "../help.js";
import { $, bindMonthPicker, dateLabel, esc, money, monthLabel, monthPicker, shiftMonth, store, thisMonth } from "../util.js";

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
  // Spending against the month before: a coloured pill (less = green, more = red), e.g. "▼ 20% less than October"
  const prevName = `<span class="kpi-month">${monthLabel(shiftMonth(month, -1)).split(" ")[0]}</span>`;   // e.g. "October", in its own colour
  const pct = expDelta === null ? 0 : Math.round(Math.abs(expDelta));
  const deltaHtml = expDelta === null ? `Nothing spent in ${prevName}`
    : pct === 0 ? `Same as ${prevName}`
    : `<span class="delta-pill ${expDelta > 0 ? "up" : "down"}">${expDelta > 0 ? "▲" : "▼"} ${pct}% ${expDelta > 0 ? "more" : "less"}</span> than ${prevName}`;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
      </div>
    </div>

    ${d.setup_needed ? `<div class="callout setup-banner" style="margin-bottom:16px">
      <strong>Set your starting balances</strong> — enter what each bank account, cash, credit card and investment stands at today,
      so the balances below are right. <a href="#/setup">Set them now →</a></div>` : ""}
    ${moneyInHand(d)}
    <section class="dash-env">
    <div class="dash-section dash-month-row">
      <h2 class="dash-h">Monthly summary</h2>
      <div class="toolbar">
        <div class="month-nav">
          <a class="btn btn-icon" href="#/dashboard?month=${shiftMonth(month, -1)}" aria-label="Previous month">‹</a>
          ${monthPicker("dash-month", month)}
          <a class="btn btn-icon" href="#/dashboard?month=${shiftMonth(month, 1)}" aria-label="Next month">›</a>
        </div>
        ${month !== thisMonth() ? `<a class="btn" href="#/dashboard">This month</a>` : ""}
        <a class="small dash-link" href="#/entries?month=${month}">Transactions →</a>
      </div>
    </div>
    <div class="grid grid-4">
      ${kpi("Income", money(s.income), "var(--income)", s.income ? "With Investment Gains" : "—")}
      ${kpi("Expense", money(s.expense), "var(--expense)", deltaHtml)}
      ${kpi("Net savings", `<span class="${s.net < 0 ? "neg" : ""}">${money(s.net)}</span>`, "var(--net)", savingsFoot(s), "", "net_savings")}
      ${investedKpi(s)}
    </div>
    </section>

    <section class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h2>Net worth</h2></div>
      <div class="panel-body">${netWorth(d.totals)}</div>
    </section>

    <div class="grid grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Investments</h2><a class="small" href="#/investments">All investments →</a></div>
        <div class="panel-body" id="dash-inv"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>What you owe</h2><a class="small" href="#/loans">Loans &amp; EMIs →</a></div>
        <div class="panel-body" id="dash-owe"></div>
      </section>
    </div>`;

  bindMonthPicker($("#dash-month"));
  $("#dash-month").addEventListener("change", (e) => { if (e.target.value) location.hash = `#/dashboard?month=${e.target.value}`; });
  if (inv && inv.by_type.length) {
    donutChart($("#dash-inv"), inv.by_type.map((x) => ({
      label: x.label, value: x.value, color: typeColor(x.color), sub: `${x.count} investment${x.count === 1 ? "" : "s"}`,
    })), { centerLabel: "Total value", compact: true, onClick: () => { location.hash = "#/investments"; } });
  } else {
    $("#dash-inv").innerHTML = `<div class="empty small" style="padding:24px 0">No investments yet. <a href="#/investments">Add one</a></div>`;
  }
  owePie(d);
}

/** Money in hand today (bank + cash + wallets) and what's left after the card dues: same cards as the month's row. */
function moneyInHand(d) {
  const of = (kind) => d.balances.filter((b) => b.kind === kind && (b.active || b.balance || b.outstanding));
  const sum = (kind) => of(kind).reduce((a, b) => a + (b.balance || 0), 0);
  const n = (kind, one, many) => { const c = of(kind).length; return `${c} ${c === 1 ? one : many}`; };
  const bank = sum("bank"), cash = sum("cash"), wallets = sum("wallet"), dues = d.totals.card_outstanding || 0;
  const neg = (v) => `<span class="${v < 0 ? "neg" : ""}">${money(v)}</span>`;
  return `<section class="dash-env"><div class="dash-section"><h2 class="dash-h">Available Funds</h2><a class="small" href="#/accounts">Cash &amp; Credit →</a></div>
    <div class="grid grid-4">
      ${kpi("Bank Accounts", neg(bank), "var(--income)", n("bank", "Account", "Accounts"))}
      ${kpi("Cash Wallet", neg(cash), "var(--t-rd)", "Cash In Hand")}
      ${kpi("Reward Points", neg(wallets), "var(--redeem)", n("wallet", "Rewards Wallet", "Rewards Wallets"))}
      ${kpi("Credit Card Outstanding", `<span class="${dues ? "neg" : ""}">${money(dues)}</span>`, "var(--expense)", n("credit_card", "Card", "Cards"))}
    </div></section>`;
}

/** Invested this month, net of the principal that came back from maturities. */
/** Savings as a share of income: green "▲ 61%" of income saved, or red "▼ 407%" over income when spending went past it. */
function savingsFoot(s) {
  if (!s.income) return s.expense ? `<span class="delta-pill up">▼ No income</span> this month` : "Nothing yet this month";
  const pct = Math.round(Math.abs((s.net * 100) / s.income));
  return s.net >= 0 ? `<span class="delta-pill down">▲ ${pct}%</span> of income saved`
    : `<span class="delta-pill up">▼ ${pct}%</span> over income`;
}

function investedKpi(s) {
  const back = s.redeemed_principal || 0;
  if (!back) return kpi("Invested", money(s.invested), "var(--invest)", "not counted as expense");
  const net = Math.round((s.invested - back) * 100) / 100;
  const tip = `Invested this month: ${money(s.invested)}\nPrincipal back from maturities: ${money(back)}\n(interest and gains are under Income)`;
  return kpi(net >= 0 ? "Net invested" : "Net withdrawn", money(Math.abs(net)), "var(--invest)",
    `<span class="flow-in">▲ ${money(Math.round(s.invested))} in</span><span class="flow-out">▼ ${money(Math.round(back))} back</span>`, tip);
}

function kpi(label, value, color, foot, tip = "", help = "") {
  return `<div class="panel kpi"${tip ? ` title="${esc(tip)}"` : ""}>
    <div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}${help ? info(help) : ""}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${foot}</div>
  </div>`;
}

/** Net worth: what you have vs what you owe, as two bars on one scale. */
function netWorth(t) {
  const H = Math.max(0, t.bank_and_cash) + Math.max(0, t.wallets || 0) + Math.max(0, t.investments_value ?? t.invested_principal);
  const O = Math.max(0, t.card_outstanding) + Math.max(0, t.loans_outstanding || 0), N = H - O;
  // the bar is everything you have: the part that's yours (green) and the part that pays off what you owe (red)
  const ownPct = H > 0 ? Math.max(0, Math.min(100, Math.round((N / H) * 100))) : 0;
  const tile = (label, v, sub, cls = "") => `<div class="nw-tile ${cls}"><small>${label}</small><b>${money(v)}</b><span>${sub}</span></div>`;
  return `<div class="nw-eq">
      ${tile("You have", H, "bank, cash, wallets &amp; investments")}<span class="nw-op">−</span>
      ${tile("You owe", O, "credit cards &amp; loans", "owe")}<span class="nw-op">=</span>
      ${tile("Net worth", N, "what's truly yours", N < 0 ? "net neg" : "net")}
    </div>
    <div class="nw-gauge" title="${ownPct}% of what you have is yours after paying what you owe">
      <i class="own" style="width:${ownPct}%"></i><i class="debt" style="width:${100 - ownPct}%"></i></div>
    <div class="nw-gauge-l"><span><b>${ownPct}%</b> yours</span><span><b>${100 - ownPct}%</b> owed</span></div>`;
}

/** What you owe as a pie, like Investments: all credit cards as one slice, then each running loan. */
function owePie(d) {
  const cards = d.balances.filter((b) => b.kind === "credit_card" && (b.outstanding || 0) > 0);
  const cardTotal = cards.reduce((a, c) => a + c.outstanding, 0);
  const LOAN = ["#ef9a5a", "#d977a8", "#b86bd1", "#e3b25c", "#c9605f", "#8f86e0"];   // warm tones, so debts never look like investments
  const items = [
    ...(cardTotal ? [{ label: "Credit card outstanding", value: cardTotal, color: "var(--expense)", href: "#/accounts",
      sub: `${cards.length} card${cards.length === 1 ? "" : "s"}` }] : []),
    ...(d.loans || []).filter((l) => l.outstanding > 0).map((l, i) => ({ label: l.name, value: l.outstanding, color: LOAN[i % LOAN.length],
      href: `#/loan/${l.id}`, sub: l.next ? `Next EMI ${money(l.next.amount)} on ${dateLabel(l.next.date)}` : "" })),
  ];
  donutChart($("#dash-owe"), items, {
    centerLabel: "Total owed", compact: true, empty: "Nothing owed: no card dues and no running loans", label: "What you owe",
    onClick: (x) => { location.hash = x.href; },
  });
}


