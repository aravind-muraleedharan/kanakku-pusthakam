// Accounts (#/accounts): where your everyday money is - bank accounts, credit cards, cash, wallets & gift cards.
// Investments and Loans & EMIs have their own pages; net worth is on the Dashboard.
import { api } from "../api.js";
import { info } from "../help.js";
import { invalidateMasters } from "../state.js";
import { $, $$, confirmDialog, dateLabel, esc, modal, money, toast, todayISO } from "../util.js";
import { ICON } from "../icons.js";

const SUBTYPE = { savings: "Savings", current: "Current", salary: "Salary", other: "Other" };
const KIND = {
  bank: { title: "Bank Accounts", one: "bank account", icon: ICON.bank },
  credit_card: { title: "Credit Cards", one: "credit card", icon: ICON.card },
  cash: { title: "Cash", one: "cash", icon: ICON.cash },
  wallet: { title: "Wallets & Gift Cards", one: "wallet", icon: ICON.gift },
};
const SIMPLE = ["cash", "wallet"];                   // just a name and a balance
const shortDate = (iso) => { const l = dateLabel(iso); return iso.slice(0, 4) === todayISO().slice(0, 4) ? l.replace(/ \d{4}$/, "") : l; };
const ordinal = (n) => n + ([11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));

let data;

export async function render() {
  data = await api.money();
  const t = data.totals;
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Cash &amp; Credit</h1></div></div>

    ${tiles("bank", data.banks, have(t.bank))}
    <div class="grid grid-2">
      ${tiles("cash", data.cash, have(t.cash))}
      ${tiles("wallet", data.wallets || [], have(t.wallets || 0), "Amazon Pay, gift cards, vouchers, reward points")}
    </div>
    ${tiles("credit_card", data.cards, `<span class="neg">${money(t.card_owed)}</span> <span class="acc-owed">owed</span>`)}`;
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => accountForm(b.dataset.add)));
  $$("[data-edit]").forEach((r) => r.addEventListener("click", () => {
    const all = [...data.banks, ...data.cards, ...data.cash, ...(data.wallets || [])];
    accountForm(null, all.find((a) => String(a.id) === r.dataset.edit));
  }));
  $$("[data-edit] a").forEach((l) => l.addEventListener("click", (e) => e.stopPropagation()));
}

function kpi(label, value, foot, color, help) {
  return `<div class="panel kpi"><div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}${help ? info(help) : ""}</div>
    <div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

// A section's total: green for money you have (red if the accounts are overdrawn)
const have = (v) => `<span class="${v < 0 ? "neg" : "pos"}">${money(v)}</span>`;

// Each kind of account in its own envelope, every account a tile you can click to edit
const TITLE = { bank: "Bank Accounts", cash: "Cash Wallet", wallet: "Reward Points", credit_card: "Credit Cards" };
const ADD = { bank: "Bank account", credit_card: "Credit card", cash: "Cash", wallet: "Wallet" };
function tiles(kind, list, total, about = "") {
  const on = list.filter((a) => a.active), off = list.filter((a) => !a.active);
  const grid = (l) => `<div class="acc-grid ${kind === "credit_card" ? "cards" : ""}">${l.map((a) => tile(kind, a)).join("")}</div>`;
  return `<section class="dash-env acc-sec">
    <div class="dash-section"><h2 class="dash-h"><span class="mm-ico">${KIND[kind].icon}</span>${TITLE[kind]}<span class="acc-total">${total}</span></h2>
      <button class="btn btn-sm" data-add="${kind}">+ ${ADD[kind]}</button></div>
    ${on.length ? grid(on) : `<p class="small faint" style="margin:4px 2px">${about ? esc(about) : "None yet."}</p>`}
    ${off.length ? `<details class="mm-off"><summary class="small muted">Inactive | ${off.length}</summary>${grid(off)}</details>` : ""}
  </section>`;
}
function tile(kind, a) {
  const sub = kind === "bank" ? [a.institution, a.subtype && SUBTYPE[a.subtype]].filter(Boolean).join(" | ")
    : kind === "credit_card" ? (a.institution || "") : "";
  if (kind !== "credit_card") {
    return `<div class="acc-tile ${!a.balance ? "zero" : ""}" data-edit="${a.id}" role="button" tabindex="0">
      <div class="acc-top"><span class="acc-name">${esc(a.name)}</span><span class="mm-edit" aria-hidden="true">✎</span></div>
      ${sub ? `<div class="acc-sub">${esc(sub)}</div>` : ""}
      <div class="acc-amt ${a.balance < 0 ? "neg" : ""}">${money(a.balance)}</div></div>`;
  }
  const p = Math.min(100, a.limit_used_pct || 0);
  const soon = a.next_due && a.due_in_days <= 5 && a.outstanding > 0;
  return `<div class="acc-tile card" data-edit="${a.id}" role="button" tabindex="0">
    <div class="acc-top"><span class="acc-name">${esc(a.name)}</span><span class="mm-edit" aria-hidden="true">✎</span></div>
    ${sub ? `<div class="acc-sub">${esc(sub)}</div>` : ""}
    <div class="acc-amt ${a.outstanding > 0 ? "neg" : ""}">${money(a.outstanding)} <small>owed</small></div>
    ${a.credit_limit ? `<div class="progress ${p >= 75 ? "warn" : ""}" style="height:6px;margin:10px 0 6px"><div style="width:${p}%"></div></div>
      <div class="acct-line"><span><b class="v-ok">${money(a.available)}</b> available</span><span>Limit <b>${money(a.credit_limit)}</b></span></div>` : ""}
    <div class="acct-line">${a.bill_day ? `<span>Bill on <b class="v-info">${ordinal(a.bill_day)}</b></span>` : "<span></span>"}
      ${a.next_due ? `<span>Due <b class="${soon ? "v-bad" : "v-warn"}">${esc(shortDate(a.next_due))}${soon ? (a.due_in_days === 0 ? " | today" : ` | in ${a.due_in_days} day${a.due_in_days === 1 ? "" : "s"}`) : ""}</b></span>` : ""}</div>
    ${a.emis && a.emis.length ? `<div class="acc-emi">EMIs on this card: ${a.emis.map((e) => `<a href="#/loan/${e.id}">${esc(e.name)}</a> ${money(e.emi)}/month`).join(" | ")}</div>` : ""}
  </div>`;
}

function head(icon, title, total, button) {
  return `<div class="mm-head"><h2><span class="mm-ico">${icon}</span>${title}</h2><span class="mm-total">${total}</span>${button}</div>`;
}

function section(kind, list, total, about = "") {
  const k = KIND[kind];
  const on = list.filter((a) => a.active), off = list.filter((a) => !a.active);
  const rows = (l) => l.map((a) => row(kind, a)).join("");
  return `<section class="panel mm-sec">
    ${head(k.icon, k.title, total, `<button class="btn btn-sm" data-add="${kind}">+ ${{ bank: "Bank account", credit_card: "Credit card", cash: "Cash", wallet: "Wallet" }[kind]}</button>`)}
    <div class="mm-list">${on.length ? rows(on) : `<p class="small faint mm-empty">${about ? esc(about) : "None yet."}</p>`}</div>
    ${off.length ? `<details class="mm-off"><summary class="small muted">Inactive | ${off.length}</summary><div class="mm-list">${rows(off)}</div></details>` : ""}
  </section>`;
}

function row(kind, a) {
  let sub = [], extra = "", amount;
  if (kind === "bank") {
    sub = [a.institution, a.subtype && SUBTYPE[a.subtype]].filter(Boolean);
    amount = `<span class="${a.balance < 0 ? "neg" : ""}">${money(a.balance)}</span>`;
  } else if (SIMPLE.includes(kind)) {
    amount = `<span class="${a.balance < 0 ? "neg" : ""}">${money(a.balance)}</span>`;
  } else {
    sub = [a.institution].filter(Boolean);
    amount = `<span class="${a.outstanding > 0 ? "neg" : ""}">${money(a.outstanding)}</span><small>owed</small>`;
    const bits = [];
    if (a.credit_limit) bits.push(`limit ${money(a.credit_limit)} | ${money(a.available)} available`);
    if (a.bill_day) bits.push(`bill on ${ordinal(a.bill_day)}`);
    if (a.next_due) {
      const soon = a.due_in_days <= 5 && a.outstanding > 0;
      bits.push(`<span class="${soon ? "mm-due" : ""}">due ${esc(shortDate(a.next_due))}${a.due_in_days === 0 ? " (today)" : a.due_in_days <= 5 ? ` (in ${a.due_in_days} day${a.due_in_days === 1 ? "" : "s"})` : ""}</span>`);
    }
    if (a.credit_limit) {
      const p = Math.min(100, a.limit_used_pct || 0);
      extra = `<div class="progress ${p >= 75 ? "warn" : ""}" style="height:6px;margin-top:6px"><div style="width:${p}%"></div></div>`;
    }
    if (bits.length) extra += `<div class="cell-sub" style="margin-top:4px">${bits.join(" | ")}</div>`;
    if (a.emis && a.emis.length) {
      extra += `<div class="cell-sub" style="margin-top:4px">EMIs on this card: ${a.emis.map((e) =>
        `<a href="#/loan/${e.id}">${esc(e.name)}</a> ${money(e.emi)}/month`).join(" | ")}</div>`;
    }
  }
  return `<div class="mm-row" data-edit="${a.id}" role="button" tabindex="0">
    <div class="mm-main"><div class="cell-main">${esc(a.name)}</div>${sub.length ? `<div class="cell-sub">${esc(sub.join(" | "))}</div>` : ""}${extra}</div>
    <div class="mm-amt">${amount}</div><span class="mm-edit" aria-hidden="true">✎</span>
  </div>`;
}

// ------------------------------------------------------------------ add / edit a bank account, card or cash

const fld = (label, html, hint = "", req = false) =>
  `<div class="field"><label class="${req ? "req" : ""}">${label}</label>${html}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
const dayOptions = (sel) => `<option value="">—</option>` +
  Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${String(sel) === String(i + 1) ? "selected" : ""}>${ordinal(i + 1)}</option>`).join("");

async function accountForm(kind, a) {
  kind = a ? a.kind : kind;
  const v = a || {};
  const val = (k) => esc(v[k] ?? "");
  const simple = SIMPLE.includes(kind);
  const name = { bank: "Account Name", credit_card: "Card Name", cash: "Name", wallet: "Name" }[kind];
  const ph = { bank: "e.g. HDFC Savings", credit_card: "e.g. SBI BPCL Card", cash: "e.g. Home cash box",
    wallet: "e.g. Amazon Pay, Flipkart gift card" }[kind];
  let body = `<div class="form-grid">
    <div class="field ${simple ? "full" : ""}"><label class="req">${name}</label><input name="name" required maxlength="80" value="${val("name")}" placeholder="${ph}"></div>`;
  if (kind === "bank") {
    body += fld("Bank", `<input name="institution" required maxlength="80" value="${val("institution")}" placeholder="e.g. HDFC Bank">`, "", true)
      + fld("Account Type", `<select name="subtype" required><option value="">Choose…</option>${Object.entries(SUBTYPE).map(([k, l]) =>
        `<option value="${k}" ${v.subtype === k ? "selected" : ""}>${l}</option>`).join("")}</select>`, "", true);
  }
  if (kind === "credit_card") {
    body += fld("Issuer", `<input name="institution" required maxlength="80" value="${val("institution")}" placeholder="e.g. SBI Card">`, "", true)
      + fld("Credit Limit (₹)", `<input name="credit_limit" inputmode="decimal" value="${val("credit_limit")}">`)
      + fld("Bill Date", `<select name="bill_day">${dayOptions(v.bill_day)}</select>`, "Day the statement is generated")
      + fld("Due Date", `<select name="due_day">${dayOptions(v.due_day)}</select>`, "Day the payment is due");
  }
  const opening = { bank: "Starting Balance (₹)", credit_card: "Amount Owed (₹)", cash: "Cash in Hand (₹)", wallet: "Balance (₹)" }[kind];
  body += fld(opening, `<input name="opening_balance" inputmode="decimal" value="${a ? val("opening_balance") : ""}">`,
    kind === "credit_card" ? "Billed but unpaid + unbilled spends, as on the date. Enter 0 if none." : "As on the date. Enter 0 if empty.", true)
    + fld("As On Date", `<input type="date" name="opening_date" required value="${esc(v.opening_date || todayISO())}">`, "", true);
  if (a) {
    body += `<div class="field full"><label class="mm-check"><input type="checkbox" name="active" ${a.active ? "checked" : ""}> Active
      <span class="faint small">(inactive ones are hidden from the transaction form)</span></label></div>`;
    if (!a.used) body += `<div class="full"><button type="button" class="btn btn-sm btn-danger" id="acc-del">Delete this ${kind === "cash" ? "cash account" : KIND[kind].one}</button></div>`;
    else body += `<p class="full small faint" style="margin:0">Used by ${a.used} transaction${a.used === 1 ? "" : "s"}: make it inactive instead of deleting.</p>`;
  }
  body += `</div>`;
  const p = modal({
    title: a ? `Edit ${a.name}` : `Add ${KIND[kind].one}`, body, wide: !simple,
    submitLabel: a ? "Save" : "Add",
    onSubmit: async (vals) => {
      if (!simple && !(vals.institution || "").trim()) {
        throw new Error(kind === "bank" ? "Enter the bank's name" : "Enter the card issuer");
      }
      if (kind === "bank" && !vals.subtype) throw new Error("Choose the account type");
      if (String(vals.opening_balance ?? "").trim() === "") throw new Error(`Enter the ${opening.replace(" (₹)", "").toLowerCase()} (0 if none)`);
      if (!vals.opening_date) throw new Error("Choose the 'as on' date");
      const payload = { ...vals, kind };
      if (a) payload.active = !!vals.active;
      if (kind === "credit_card") { payload.bill_day ??= ""; payload.due_day ??= ""; }
      const r = a ? await api.updateMaster("accounts", a.id, payload) : await api.createMaster("accounts", payload);
      invalidateMasters();
      toast(a ? "Saved" : `Added ${r.name}`);
      return r;
    },
  });
  $("#acc-del")?.addEventListener("click", async () => {
    $("#modal-root [data-cancel]").click();
    if (await confirmDialog(`Delete ${a.name}?`, "It has no transactions, so nothing else changes.")) {
      try { await api.deleteMaster("accounts", a.id); invalidateMasters(); toast("Deleted"); render(); } catch (e) { toast(e.message, true); }
    }
  });
  if (await p) render();
}
