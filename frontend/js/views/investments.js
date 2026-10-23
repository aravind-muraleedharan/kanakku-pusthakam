// Investments overview: value by type (donut), what's coming up, every investment grouped by type.
import { api } from "../api.js";
import { info } from "../help.js";
import { donutChart } from "../charts.js";
import { masters, active, invalidateMasters } from "../state.js";
import { $, $$, dateLabel, esc, modal, money, options, toast, todayISO } from "../util.js";

// Types (built-in and your own) come from the server; `color` is a key into the --t-* colours.
export const typeColor = (c) => `var(--t-${c || "other"})`;
export const typeChip = (label, color) => `<span class="type-chip"><i style="background:${typeColor(color)}"></i>${esc(label)}</span>`;
export const gainCls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
export const pct = (v) => (v === null || v === undefined ? "" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);

export async function render() {
  const d = await api.investments();
  const view = $("#view");
  const t = d.totals;
  const gainPct = t.invested ? (t.gain * 100) / t.invested : null;
  const open = d.items.filter((i) => !i.closed);
  const closed = d.items.filter((i) => i.closed);

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Investments</h1>
        <div class="sub muted small">${open.length} running · value as on ${dateLabel(todayISO())}</div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" id="new-inv">+ Investment</button>
      </div>
    </div>

    <div class="grid grid-4">
      ${kpi("Current value", money(t.value), "var(--net)", "estimated, as on today", "current_value")}
      ${kpi("Invested", money(t.invested), "var(--invest)", "principal amount")}
      ${kpi("Gain", `<span class="${gainCls(t.gain)}">${money(t.gain, { sign: true })}</span>`, "var(--income)",
            gainPct === null ? "—" : `${pct(gainPct)} on what's invested`)}
      ${kpi("Coming up", String(d.upcoming.length), "var(--warn)", "in the next 3 months")}
    </div>

    <div class="grid grid-main" style="margin-top:16px">
      <section class="panel">
        <div class="panel-head"><h2>By type</h2><span class="small faint">current value</span></div>
        <div class="panel-body" id="inv-donut"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Coming up</h2></div>
        <div class="panel-body">${upcoming(d.upcoming)}</div>
      </section>
    </div>

    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>All investments</h2></div>
      <div class="panel-body" style="padding:10px 0 4px">${table(open, d.by_type)}</div>
    </section>
    ${closed.length ? `<details class="panel" style="margin-top:16px">
      <summary class="panel-pad" style="cursor:pointer"><b>Closed</b> <span class="faint small">· ${closed.length}</span></summary>
      <div style="padding-bottom:6px">${table(closed)}</div></details>` : ""}
    <p class="small faint" style="margin:14px 2px 0">Gold coins and silver bars are shown at what you paid; the gain is counted
      when you sell. Stocks accounts show funds + profit from your journal, not market prices. Other investments are shown
      at what you put in until you type in their current value.</p>`;

  donutChart($("#inv-donut"), d.by_type.map((x) => ({
    label: x.label, value: x.value, color: typeColor(x.color),
    sub: `${x.count} · invested ${money(x.invested)}`, type: x.type,
  })), { centerLabel: "Total value", onClick: (x) => $(`#grp-${x.type}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) });

  $$(".inv-grp-head").forEach((h) => h.addEventListener("click", () => {
    const open = h.getAttribute("aria-expanded") !== "false";
    h.setAttribute("aria-expanded", String(!open));
    h.parentElement.classList.toggle("collapsed", open);
  }));
  $("#new-inv").addEventListener("click", async () => {
    const created = await investmentForm();
    if (created) location.hash = `#/investment/${created.account.id}`;
  });
}

function kpi(label, value, color, foot, help) {
  return `<div class="panel kpi">
    <div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}${help ? info(help) : ""}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${foot}</div>
  </div>`;
}

function upcoming(list) {
  if (!list.length) return `<div class="empty small" style="padding:24px 0">Nothing due in the next 3 months</div>`;
  const what = (u) => ({
    maturity: "Matures",
    payout_due: "Interest due · record it",
    payout: "Interest payout",
    rd_missed: `${u.count} instalment${u.count === 1 ? "" : "s"} not recorded`,
    rd_due: "Instalment due",
  }[u.kind]);
  return `<div class="up-list">${list.slice(0, 8).map((u) => `
    <a class="up-row" href="#/investment/${u.id}">
      <span class="up-date ${["payout_due", "rd_missed"].includes(u.kind) ? "due" : ""}">${u.kind === "rd_missed" ? "Now" : esc(dateLabel(u.date))}</span>
      <span><span class="cell-main">${esc(u.name)}</span><div class="cell-sub">${esc(what(u))}</div></span>
      <span class="amt num">${money(u.amount)}</span>
    </a>`).join("")}</div>`;
}

function table(items, byType) {
  if (!items.length) {
    return `<div class="empty"><div class="big">◔</div><p>No investments yet.</p>
      <p class="small faint">Add your stocks account, FD, RD, PPF, gold coins or silver bars to see them here.</p></div>`;
  }
  const order = byType ? byType.map((t) => t.type) : [];
  const groups = {};
  items.forEach((i) => (groups[i.type] ||= []).push(i));
  const types = [...order, ...items.map((i) => i.type)].filter((t, i, a) => groups[t] && a.indexOf(t) === i);
  const gain = (v, p) => (v === null || v === undefined ? `<span class="faint">—</span>`
    : `<span class="${gainCls(v)}">${money(v, { sign: true })}</span>${p !== undefined && p !== null ? `<small>${pct(p)}</small>` : ""}`);
  const sub = (i) => [
    i.institution && esc(i.institution),
    i.instalment && `${money(i.instalment)}/month`,
    i.next_due && `next due ${esc(dateLabel(i.next_due))}`,
    i.rate && `${i.rate}%`,
  ].filter(Boolean).join(" · ");
  const row = (i) => `<a class="inv-row" href="#/investment/${i.id}">
      <span class="inv-name"><span class="cell-main">${esc(i.name)}</span>${sub(i) ? `<span class="cell-sub">${sub(i)}</span>` : ""}</span>
      <span class="num hide-sm">${money(i.invested)}</span>
      <span class="num inv-val"><b>${money(i.value)}</b><small class="show-sm ${gainCls(i.gain)}">${i.gain ? money(i.gain, { sign: true }) : ""}</small></span>
      <span class="num hide-sm">${gain(i.gain, i.gain_pct)}</span>
      <span class="hide-sm small muted">${i.maturity_date ? esc(dateLabel(i.maturity_date)) : ""}</span>
    </a>`;
  const groupHtml = (t) => {
    const list = groups[t], first = list[0];
    const sum = (k) => list.reduce((a, i) => a + (i[k] || 0), 0);
    return `<section class="inv-grp" ${byType ? `id="grp-${t}"` : ""}>
      <button type="button" class="inv-grp-head" aria-expanded="true">
        <span class="inv-name"><span class="inv-grp-title"><i style="background:${typeColor(first.color)}"></i>${esc(first.type_label)}
          <span class="faint">${list.length}</span><span class="chev" aria-hidden="true">⌄</span></span></span>
        <span class="num hide-sm"><span class="lbl">Invested</span>${money(sum("invested"))}</span>
        <span class="num inv-val"><span class="lbl">Value</span>${money(sum("value"))}</span>
        <span class="num hide-sm">${gain(sum("gain"))}</span>
        <span class="hide-sm"></span>
      </button>
      <div class="inv-rows">${list.map(row).join("")}</div>
    </section>`;
  };
  return `<div class="inv-list">${types.map(groupHtml).join("")}</div>`;
}

// ------------------------------------------------------------------ new / edit investment form

// Each field lists the calculations ("works like" codes) it appears for.
export const BROKERS = ["Zerodha", "Upstox", "Interactive Brokers"];
const HELD_AT = ["fd", "rd", "ppf"];

function fieldDefs(d, banks, bankAccounts, isNew, payAccounts) {
  const val = (k) => esc(d[k] ?? "");
  const inst = d.institution || "";
  const custom = inst && !BROKERS.includes(inst);
  const years = d.term_months ? Math.floor(d.term_months / 12) : "";
  const months = d.term_months ? d.term_months % 12 : "";
  const heldList = bankAccounts.filter((b) => b.active || b.id === d.held_at_account_id);
  return [
    { name: "broker", types: "share", label: "Broker", full: true,
      html: `<select name="institution" id="inv-broker">${["", ...BROKERS].map((b) =>
        `<option value="${esc(b)}" ${b === inst ? "selected" : ""}>${b ? esc(b) : "Choose…"}</option>`).join("")}
        <option value="__other" ${custom ? "selected" : ""}>Other…</option></select>
        <input name="institution_other" id="inv-broker-other" maxlength="80" placeholder="Broker name" value="${custom ? esc(inst) : ""}"
          class="${custom ? "" : "hidden"}" style="margin-top:6px">` },
    { name: "held_at", types: HELD_AT.join(" "), label: { ppf: "PPF Account With", _: "Bank Account" },
      hint: heldList.length ? (!d.held_at_account_id && inst ? `Earlier you typed “${inst}”: choose the account it's with.` : "")
        : "Add your bank account in Accounts first, then choose it here.",
      html: `<select name="held_at_account_id">${options(heldList, d.held_at_account_id, { placeholder: heldList.length ? "Choose…" : "No bank accounts yet" })}</select>` },
    { name: "institution", types: "chitty other", full: true,
      label: { gold: "Where It's Kept", silver: "Where It's Kept", chitty: "Company / Organiser", _: "Institution / Platform" },
      html: `<input name="institution" maxlength="80" value="${BROKERS.includes(inst) ? "" : esc(inst)}">` },
    { name: "amount", types: "fd rd goldtree chitty", req: "fd rd goldtree chitty",
      label: { fd: "Deposit Amount (₹)", rd: "Monthly Instalment (₹)", chitty: "Monthly Instalment (₹)", goldtree: "Monthly Amount (₹)" },
      html: `<input name="amount" inputmode="decimal" value="${val("amount")}">` },
    { name: "rate", types: "fd rd ppf", req: "fd rd", label: "Interest Rate (% a year)", html: `<input name="rate" inputmode="decimal" value="${val("rate")}" placeholder="e.g. 7.1">` },
    { name: "start_date", types: "fd rd ppf goldtree chitty", req: "fd rd ppf goldtree chitty", label: { ppf: "Account Opened On", _: "Start Date" },
      html: `<input type="date" name="start_date" value="${val("start_date")}" data-recalc>` },
    { name: "tenure", types: "fd rd goldtree chitty", req: "fd rd goldtree chitty", label: "Tenure",
      hint: { rd: "An RD runs for whole months", goldtree: "Usually 11 or 12 months", chitty: "Number of instalments, e.g. 3 years 4 months = 40", _: "Any mix, e.g. 1 year 1 month 4 days, or just 400 days" },
      html: `<div class="tenure" id="inv-tenure">
        <label><input name="term_years" inputmode="numeric" value="${years}" placeholder="0" aria-label="Years" data-recalc><span class="u">years</span></label>
        <label><input name="term_months" inputmode="numeric" value="${months}" placeholder="0" aria-label="Months" data-recalc><span class="u">months</span></label>
        <label data-days><input name="term_days" inputmode="numeric" value="${val("term_days")}" placeholder="0" aria-label="Days" data-recalc><span class="u">days</span></label></div>` },
    { name: "due_day", types: "rd goldtree chitty", label: "Instalment Due Day", hint: "Day of the month each instalment is due (empty = the start date's day)",
      html: `<input name="due_day" inputmode="numeric" maxlength="2" value="${val("due_day")}" placeholder="e.g. 5">` },
    { name: "prepaid", types: "rd goldtree chitty", label: "Instalments Already Paid",
      hint: isNew ? "If you started it earlier. Leave empty for a new one." : "Paid before you started using the app",
      html: `<input name="prepaid_instalments" inputmode="numeric" maxlength="3" value="${val("prepaid_instalments")}" placeholder="0">` },
    { name: "opening_paid", types: "goldtree chitty", label: "Paid So Far (₹)",
      hint: { chitty: "Empty = instalments × monthly instalment. If dividends lowered some instalments, enter the real total.",
        _: "Empty = instalments × monthly amount" },
      html: `<input name="opening_paid" inputmode="decimal" value="${val("opening_paid")}">` },
    { name: "opening_grams", types: "goldtree", label: "Gold Collected So Far (grams)", hint: "From your scheme card (22K). You can add it later.",
      html: `<input name="opening_grams" inputmode="decimal" value="${val("opening_grams")}">` },
    { name: "maturity_date", types: isNew ? "" : "fd rd ppf goldtree chitty", label: { chitty: "Last Instalment / Ends On", _: "Maturity Date" }, hint: "Worked out from the tenure; change it if your receipt says otherwise",
      html: `<input type="date" name="maturity_date" value="${val("maturity_date")}" id="inv-maturity">` },
    { name: "payout", types: "fd", req: "fd", label: "Interest Payout",
      html: `<select name="payout">${options([
        { id: "maturity", name: "At maturity (cumulative)" }, { id: "monthly", name: "Monthly" },
        { id: "quarterly", name: "Quarterly" }, { id: "yearly", name: "Yearly" }], d.payout || "maturity")}</select>` },
    { name: "paid_from_account_id", types: isNew ? "fd" : "", label: "Paid From", full: true,
      hint: "Choose the bank only for a new deposit you're opening now. For one you already have, leave it.",
      html: `<select name="paid_from_account_id"><option value="">I already have this (don't record a payment)</option>${options(banks.filter((b) => b.active))}</select>` },
    { name: "goal_pct", types: "share", label: "Goal: Gain %", hint: "e.g. 50 = 50% of funds added",
      html: `<input name="goal_pct" inputmode="decimal" value="${val("goal_pct")}">` },
    { name: "goal_profit", types: "share", label: "Forecast Profit (₹)", html: `<input name="goal_profit" inputmode="decimal" value="${val("goal_profit")}">` },
    { name: "goal_date", types: "share", label: "Goal By", html: `<input type="date" name="goal_date" value="${val("goal_date")}">` },
    { name: "opening_balance", types: isNew ? "share ppf other" : "",
      label: { share: "Funds Available (₹)", ppf: "Current Balance (₹)", _: "Invested So Far (₹)" },
      hint: "Leave empty if you'll record every deposit from the start",
      html: `<input name="opening_balance" inputmode="decimal">` },
    { name: "opening_date", types: isNew ? "share ppf other" : "", label: "As On Date",
      html: `<input type="date" name="opening_date" value="${todayISO()}">` },
    // gold / silver: the first purchase, asked straight away (more are added from the investment's page)
    ...buyFields(isNew ? "gold silver" : "", payAccounts),
    { name: "notes", types: isNew ? "share fd rd ppf chitty other goldtree" : "all", label: "Notes", full: true,
      html: `<input name="notes" maxlength="300" value="${val("notes")}">` },
  ];
}

// Order of the fields for each calculation: where it's held → money → dates & terms → already invested.
// (Type and Account Name always come first; your extra fields and then Notes always come last.)
const FIELD_ORDER = {
  fd: ["held_at", "amount", "rate", "payout", "start_date", "tenure", "maturity_date", "paid_from_account_id"],
  rd: ["held_at", "amount", "rate", "due_day", "start_date", "tenure", "maturity_date", "prepaid"],
  ppf: ["held_at", "start_date", "rate", "maturity_date", "opening_balance", "opening_date"],
  share: ["broker", "opening_balance", "opening_date", "goal_pct", "goal_profit", "goal_date"],
  gold: ["buy_date", "buy_total", "buy_rate", "buy_grams", "buy_purity", "buy_bill", "buy_from", "buy_doc", "buy_note"],
  silver: ["buy_date", "buy_total", "buy_rate", "buy_grams", "buy_purity", "buy_bill", "buy_from", "buy_doc", "buy_note"],
  chitty: ["institution", "amount", "due_day", "start_date", "tenure", "maturity_date", "prepaid", "opening_paid"], other: ["institution", "opening_balance", "opening_date"],
  goldtree: ["amount", "due_day", "start_date", "tenure", "maturity_date", "prepaid", "opening_paid", "opening_grams"],
};

function buyFields(types, payAccounts) {
  const pay = [...payAccounts, { id: "", name: "Already paid earlier (don't record a payment)" }];
  return [
    { name: "buy_date", types, req: types, label: "Date", html: `<input type="date" name="buy_date" value="${todayISO()}">` },
    { name: "buy_total", types, req: types, label: "Amount Paid (₹)", hint: "Everything paid, incl. GST",
      html: `<input name="buy_total" id="buy-total" inputmode="decimal">` },
    { name: "buy_rate", types, req: types, label: "Buy Rate (₹/g)", hint: "Rate per gram that day",
      html: `<input name="buy_rate" id="buy-rate" inputmode="decimal">` },
    { name: "buy_grams", types, req: types, label: "Weight (grams)", hint: "As on the bill",
      html: `<input name="buy_grams" id="buy-grams" inputmode="decimal">` },
    { name: "buy_purity", types, req: types, label: "Purity", ownOnly: true,
      html: `<select name="buy_purity">${[["24K · 999", 99.9], ["24K · 995", 99.5], ["22K · 916", 91.6], ["18K · 750", 75], ["Silver · 999", 99.9], ["Sterling · 925", 92.5]]
        .map(([l, v]) => `<option value="${v}" ${v === 91.6 ? "selected" : ""}>${l}</option>`).join("")}</select>` },
    { name: "buy_bill", types, label: "Bill Name", html: `<input name="buy_bill" maxlength="80" placeholder="Name on the bill">` },
    { name: "buy_from", types, req: types, label: "Payment Method", hint: "The account it was paid from",
      html: `<select name="buy_from">${options(pay, payAccounts[0]?.id)}</select>` },
    { name: "buy_doc", types, label: "Transaction Document", full: true,
      html: `<input name="buy_doc" maxlength="200" placeholder="e.g. bill / invoice no., UPI ref, or where the receipt is kept">` },
    { name: "buy_note", types, label: "Note", full: true, html: `<input name="buy_note" maxlength="300">` },
  ];
}

/** Inputs for a type's own extra fields (named x_<key>). */
export function extraInputs(type, values = {}) {
  if (!type || !type.fields.length) return "";
  const inp = (f) => {
    const v = esc(values[f.key] ?? "");
    if (f.kind === "choice") return `<select name="x_${f.key}">${options(f.options.map((o) => ({ id: o, name: o })), values[f.key], { placeholder: "Choose…" })}</select>`;
    if (f.kind === "date") return `<input type="date" name="x_${f.key}" value="${v}">`;
    return `<input name="x_${f.key}" maxlength="200" value="${v}" ${f.kind === "number" ? 'inputmode="decimal"' : ""}>`;
  };
  return `<div class="form-sec sub-head" style="order:80">${esc(type.name)} details</div>`
    + type.fields.map((f) => `<div class="field" style="order:81"><label class="${f.required ? "req" : ""}">${esc(f.label)}</label>${inp(f)}</div>`).join("");
}

/** Create (no `inv`) or edit an investment. Resolves to the saved investment, or null. */
export async function investmentForm(inv, preset = {}) {
  const [M, allTypes] = await Promise.all([masters(), api.investmentTypes()]);
  const banks = M.accounts.filter((a) => ["bank", "cash"].includes(a.kind));
  const bankOnly = banks.filter((a) => a.kind === "bank");
  const types = allTypes.filter((t) => t.active || t.id === inv?.type?.id);
  const byId = Object.fromEntries(allTypes.map((t) => [String(t.id), t]));
  const firstId = (preset.inv_type && allTypes.find((t) => t.builtin && t.works_like === preset.inv_type)?.id) || types[0]?.id;
  const d = inv ? { ...inv.details, name: inv.account.name, type_id: inv.type.id }
    : { type_id: preset.type_id || firstId, payout: "maturity", name: preset.name || "" };
  // an RD saved before the count existed: work the count out from the amount already paid in
  if (inv && d.inv_type === "rd" && d.prepaid_instalments == null && inv.opening_balance && d.amount) {
    const n = Math.round(inv.opening_balance / d.amount);
    if (n > 0) d.prepaid_instalments = n;
  }
  // a scheme started earlier: the amount paid before using the app
  if (inv && d.prepaid_instalments && ["gold", "chitty"].includes(d.inv_type) && inv.opening_balance) d.opening_paid = inv.opening_balance;
  const payAccounts = active(M.accounts).filter((a) => ["bank", "cash", "credit_card"].includes(a.kind));
  const defs = fieldDefs(d, banks, bankOnly, !inv, payAccounts);
  const body = `
    <div class="form-grid">
      <div class="field"><label class="req">Investment Type</label><select name="type_id" id="inv-type">${types.map((t) =>
        `<option value="${t.id}" ${String(t.id) === String(d.type_id) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      <div class="field"><label class="req">Account Name</label><input name="name" required maxlength="80" value="${esc(d.name ?? "")}" id="inv-name"></div>
      ${defs.map((f) => `<div class="field ${f.full ? "full" : ""}" data-types="${f.types}" data-name="${f.name}">
        <label></label>${f.html}<div class="hint"></div></div>`).join("")}
      <div id="inv-extra" style="display:contents"></div>
    </div>`;
  const placeholders = { share: "e.g. Zerodha - Trading", fd: "e.g. SBI FD 2026", rd: "e.g. Post Office RD", ppf: "e.g. SBI PPF",
    gold: "e.g. Gold coins", silver: "e.g. Silver bars", chitty: "e.g. KSFE Chit Fund", other: "e.g. NPS" };
  const p = modal({
    title: inv ? `Edit ${inv.account.name}` : "New investment", body, wide: true, submitLabel: inv ? "Save" : "Create",
    onSubmit: async (v) => {
      if (v.institution === "__other") v.institution = v.institution_other || "";
      delete v.institution_other;
      v.extra = {};
      for (const k of Object.keys(v)) if (k.startsWith("x_")) { v.extra[k.slice(2)] = v[k]; delete v[k]; }
      if (byId[v.type_id]?.scheme || byId[v.type_id]?.works_like === "chitty") v.scheme = 1;
      if ("buy_total" in v) {                       // gold / silver: the first purchase
        v.first_item = { date: v.buy_date, total_paid: v.buy_total, rate: v.buy_rate, grams: v.buy_grams, purity: v.buy_purity,
          bill_name: v.buy_bill, paid_from_account_id: v.buy_from, doc: v.buy_doc, note: v.buy_note };
        for (const k of Object.keys(v)) if (k.startsWith("buy_")) delete v[k];
      }
      const r = inv ? await api.updateInvestment(inv.account.id, v) : await api.createInvestment(v);
      invalidateMasters();
      toast(inv ? "Saved" : "Investment added");
      return r;
    },
  });
  const pick = (x, t) => (typeof x === "string" || x === undefined ? x : (x[t] ?? x._));
  const sync = () => {
    const type = byId[$("#inv-type").value];
    const t = type.scheme ? "goldtree" : type.works_like;      // Gold Tree: set up like an RD
    $("#inv-name").placeholder = type.builtin ? placeholders[t] : `e.g. My ${type.name}`;
    $$("#modal-root [data-types]").forEach((el) => {
      const def0 = defs.find((f) => f.name === el.dataset.name);
      const on = (el.dataset.types === "all" || el.dataset.types.split(" ").includes(t)) && !(def0.ownOnly && type.builtin);
      el.classList.toggle("hidden", !on);
      const pos = (FIELD_ORDER[t] || []).indexOf(el.dataset.name);
      el.style.order = el.dataset.name === "notes" ? 90 : pos >= 0 ? pos + 1 : 50;
      $$("input, select", el).forEach((i) => { i.disabled = !on; });
      const def = defs.find((f) => f.name === el.dataset.name);
      $("label", el).textContent = pick(def.label, t);
      $("label", el).classList.toggle("req", (def.req || "").split(" ").includes(t));
      $(":scope > .hint", el).textContent = pick(def.hint, t) || "";
    });
    const days = $("#inv-tenure [data-days]");
    days.classList.toggle("hidden", t !== "fd");
    $("input", days).disabled = t !== "fd";
    $("#inv-tenure").classList.toggle("two", ["rd", "goldtree", "chitty"].includes(t));
    const keep = inv && String(type.id) === String(inv.type.id) ? inv.details.extra : {};
    $("#inv-extra").innerHTML = extraInputs(type, keep);
  };
  $("#inv-type").addEventListener("change", sync);
  $("#inv-broker").addEventListener("change", (e) => {
    const other = $("#inv-broker-other");
    other.classList.toggle("hidden", e.target.value !== "__other");
    if (e.target.value === "__other") other.focus();
  });
  // first purchase: weight = amount ÷ rate, filled in until you type your own
  if (!inv) {
    let typed = false;
    $("#buy-grams").addEventListener("input", () => { typed = true; });
    const fill = () => {
      const paid = parseFloat($("#buy-total").value.replace(/,/g, "")), rate = parseFloat($("#buy-rate").value.replace(/,/g, ""));
      if (!typed && paid > 0 && rate > 0) $("#buy-grams").value = (paid / rate).toFixed(3);
    };
    $("#buy-total").addEventListener("input", fill);
    $("#buy-rate").addEventListener("input", fill);
  }
  // a new tenure or start date works out the maturity date again
  const mat = $("#inv-maturity");
  if (mat) $$("#modal-root [data-recalc]").forEach((i) => i.addEventListener("input", () => { mat.value = ""; }));
  sync();
  return p;
}
