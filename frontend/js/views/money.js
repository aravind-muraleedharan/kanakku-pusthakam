// Accounts (#/accounts): where your everyday money is - bank accounts, credit cards and cash.
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
};
const shortDate = (iso) => { const l = dateLabel(iso); return iso.slice(0, 4) === todayISO().slice(0, 4) ? l.replace(/ \d{4}$/, "") : l; };
const ordinal = (n) => n + ([11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));

let data;

export async function render() {
  data = await api.money();
  const t = data.totals;
  const due = data.cards.filter((c) => c.active && c.next_due && c.outstanding > 0).sort((a, b) => a.next_due.localeCompare(b.next_due))[0];
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Accounts</h1><div class="sub muted small">Where your everyday money is: bank accounts, credit cards and cash, as on ${esc(dateLabel(todayISO()))}.
        Investments and loans have their own pages.</div></div>
    </div>
    <div class="grid grid-4">
      ${kpi("In the bank", `<span class="${t.bank < 0 ? "neg" : ""}">${money(t.bank)}</span>`, `${data.banks.filter((a) => a.active).length} account${data.banks.filter((a) => a.active).length === 1 ? "" : "s"}`, "var(--income)")}
      ${kpi("Cash", money(t.cash), "in hand", "var(--transfer)")}
      ${kpi("Card dues", money(t.card_owed), t.card_limit ? `of ${money(t.card_limit)} limit` : "on all cards", "var(--expense)", "card_dues")}
      ${kpi("Next card bill", due ? money(due.outstanding) : "—", due ? `${esc(due.name)} · due ${esc(shortDate(due.next_due))}` : "nothing due", "var(--warn)")}
    </div>
    <div class="mm-grid">
      <div class="stack">
        ${section("bank", data.banks, money(t.bank))}
        ${section("cash", data.cash, money(t.cash))}
      </div>
      <div class="stack">
        ${section("credit_card", data.cards, `owed ${money(t.card_owed)}${t.card_limit ? ` of ${money(t.card_limit)} limit` : ""}`)}
        <p class="small faint" style="margin:0 4px">Looking for investments, loans or your net worth? See
          <a href="#/investments">Investments</a>, <a href="#/loans">Loans &amp; EMIs</a> and the <a href="#/dashboard">Dashboard</a>.</p>
      </div>
    </div>`;
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => accountForm(b.dataset.add)));
  $$("[data-edit]").forEach((r) => r.addEventListener("click", () => {
    const all = [...data.banks, ...data.cards, ...data.cash];
    accountForm(null, all.find((a) => String(a.id) === r.dataset.edit));
  }));
  $$("[data-edit] a").forEach((l) => l.addEventListener("click", (e) => e.stopPropagation()));
}

function kpi(label, value, foot, color, help) {
  return `<div class="panel kpi"><div class="kpi-label"><span class="dot" style="background:${color}"></span>${esc(label)}${help ? info(help) : ""}</div>
    <div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

function head(icon, title, total, button) {
  return `<div class="mm-head"><h2><span class="mm-ico">${icon}</span>${title}</h2><span class="mm-total">${total}</span>${button}</div>`;
}

function section(kind, list, total) {
  const k = KIND[kind];
  const on = list.filter((a) => a.active), off = list.filter((a) => !a.active);
  const rows = (l) => l.map((a) => row(kind, a)).join("");
  return `<section class="panel mm-sec">
    ${head(k.icon, k.title, total, `<button class="btn btn-sm" data-add="${kind}">+ ${{ bank: "Bank account", credit_card: "Credit card", cash: "Cash" }[kind]}</button>`)}
    <div class="mm-list">${on.length ? rows(on) : `<p class="small faint mm-empty">None yet.</p>`}</div>
    ${off.length ? `<details class="mm-off"><summary class="small muted">Inactive · ${off.length}</summary><div class="mm-list">${rows(off)}</div></details>` : ""}
  </section>`;
}

function row(kind, a) {
  let sub = [], extra = "", amount;
  if (kind === "bank") {
    sub = [a.institution, a.subtype && SUBTYPE[a.subtype]].filter(Boolean);
    amount = `<span class="${a.balance < 0 ? "neg" : ""}">${money(a.balance)}</span>`;
  } else if (kind === "cash") {
    amount = money(a.balance);
  } else {
    sub = [a.institution].filter(Boolean);
    amount = `<span class="${a.outstanding > 0 ? "neg" : ""}">${money(a.outstanding)}</span><small>owed</small>`;
    const bits = [];
    if (a.credit_limit) bits.push(`limit ${money(a.credit_limit)} · ${money(a.available)} available`);
    if (a.bill_day) bits.push(`bill on ${ordinal(a.bill_day)}`);
    if (a.next_due) {
      const soon = a.due_in_days <= 5 && a.outstanding > 0;
      bits.push(`<span class="${soon ? "mm-due" : ""}">due ${esc(shortDate(a.next_due))}${a.due_in_days === 0 ? " (today)" : a.due_in_days <= 5 ? ` (in ${a.due_in_days} day${a.due_in_days === 1 ? "" : "s"})` : ""}</span>`);
    }
    if (a.credit_limit) {
      const p = Math.min(100, a.limit_used_pct || 0);
      extra = `<div class="progress ${p >= 75 ? "warn" : ""}" style="height:6px;margin-top:6px"><div style="width:${p}%"></div></div>`;
    }
    if (bits.length) extra += `<div class="cell-sub" style="margin-top:4px">${bits.join(" · ")}</div>`;
    if (a.emis && a.emis.length) {
      extra += `<div class="cell-sub" style="margin-top:4px">EMIs on this card: ${a.emis.map((e) =>
        `<a href="#/loan/${e.id}">${esc(e.name)}</a> ${money(e.emi)}/month`).join(" · ")}</div>`;
    }
  }
  return `<div class="mm-row" data-edit="${a.id}" role="button" tabindex="0">
    <div class="mm-main"><div class="cell-main">${esc(a.name)}</div>${sub.length ? `<div class="cell-sub">${esc(sub.join(" · "))}</div>` : ""}${extra}</div>
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
  const name = { bank: "Account Name", credit_card: "Card Name", cash: "Name" }[kind];
  const ph = { bank: "e.g. HDFC Savings", credit_card: "e.g. SBI BPCL Card", cash: "e.g. Wallet, Home cash box" }[kind];
  let body = `<div class="form-grid">
    <div class="field ${kind === "cash" ? "full" : ""}"><label class="req">${name}</label><input name="name" required maxlength="80" value="${val("name")}" placeholder="${ph}"></div>`;
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
  const opening = { bank: "Starting Balance (₹)", credit_card: "Amount Owed (₹)", cash: "Cash in Hand (₹)" }[kind];
  body += fld(opening, `<input name="opening_balance" inputmode="decimal" value="${a ? val("opening_balance") : ""}">`,
    kind === "credit_card" ? "Billed but unpaid + unbilled spends, as on the date. Enter 0 if none." : "As on the date. Enter 0 if empty.", true)
    + fld("As On Date", `<input type="date" name="opening_date" required value="${esc(v.opening_date || todayISO())}">`, "", true);
  if (a) {
    body += `<div class="field full"><label class="mm-check"><input type="checkbox" name="active" ${a.active ? "checked" : ""}> Active
      <span class="faint small">(inactive ones are hidden from the transaction form)</span></label></div>`;
    if (!a.used) body += `<div class="full"><button type="button" class="btn btn-sm btn-danger" id="acc-del">Delete this ${KIND[kind].one === "cash" ? "cash account" : KIND[kind].one}</button></div>`;
    else body += `<p class="full small faint" style="margin:0">Used by ${a.used} transaction${a.used === 1 ? "" : "s"}: make it inactive instead of deleting.</p>`;
  }
  body += `</div>`;
  const p = modal({
    title: a ? `Edit ${a.name}` : `Add ${KIND[kind].one === "cash" ? "cash" : KIND[kind].one}`, body, wide: kind !== "cash",
    submitLabel: a ? "Save" : "Add",
    onSubmit: async (vals) => {
      if (kind !== "cash" && !(vals.institution || "").trim()) {
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
