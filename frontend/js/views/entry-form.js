// Add / edit an entry. Fields change with the entry type.
import { investmentForm } from "./investments.js";
import { api } from "../api.js";
import { info } from "../help.js";
import { active, invalidateMasters, masters } from "../state.js";
import {
  $, $$, addDays, backButton, confirmDialog, goBack, esc, modal, money, options, store, toast, todayISO, KIND_LABEL, TYPE_LABEL,
} from "../util.js";

const TYPE_HELP = {
  expense: "Money spent. Card swipes are recorded here, on the day you pay.",
  income: "Money received: salary, bonus, interest, reimbursements.",
  transfer: "Moving your own money: paying a credit card bill, ATM withdrawal, bank to bank. Not counted as income or expense.",
  invest: "Putting money into stocks, FD, RD, PPF, chit fund, gold… Not counted as expense.",
  redeem: "Money coming back from an investment. Only the gain (or loss) counts as income.",
};

// which account kinds each side accepts, per type (must match backend/services/entries.py)
const SIDES = {
  expense: { from: ["bank", "credit_card", "cash", "wallet"], to: null },
  income: { from: null, to: ["bank", "cash", "wallet", "credit_card"] },
  transfer: { from: ["bank", "credit_card", "cash", "wallet", "investment", "loan"], to: ["bank", "credit_card", "cash", "wallet", "loan"] },
  invest: { from: ["bank", "credit_card", "cash"], to: ["investment"] },
  redeem: { from: ["investment"], to: ["bank", "cash"] },
};
const SIDE_LABEL = {
  expense: { from: "Paid from" },
  income: { to: "Received in" },
  transfer: { from: "From", to: "To" },
  invest: { from: "Paid from", to: "Invested in" },
  redeem: { from: "Investment", to: "Received in" },
};

let M;          // masters
let v;          // current form values
let editing;    // entry being edited (or null)
let balances = [];

let metal = null;                                    // gold / silver investment chosen under Invest: { id, kind, own, scheme, name }
let gramsTyped = false;                              // weight typed by hand (stop filling it from amount ÷ rate)

const accById = (id) => M.accounts.find((a) => String(a.id) === String(id));
const isMetalAcc = (a) => !!a && a.kind === "investment" && ["gold", "silver"].includes(a.inv_type);
/** Investments whose full maturity is a closing (their page uses Close). Chit funds pay a prize mid-scheme. */
const closesOnFull = (a) => !!a && a.kind === "investment" && !["share", "gold", "silver", "chitty"].includes(a.inv_type);

export async function render(params) {
  [M, balances] = await Promise.all([masters(true), api.balances()]);
  editing = null;
  metal = null; gramsTyped = false;
  if (params.id) {
    editing = await api.entry(params.id);
    v = {
      type: editing.type, date: editing.date, amount: editing.amount ?? "",
      category_id: editing.category_id ?? "", from_account_id: editing.from_account_id ?? "",
      to_account_id: editing.to_account_id ?? "", payment_mode_id: editing.payment_mode_id ?? "",
      payment_mode_other: editing.payment_mode_other ?? "", principal_amount: editing.principal_amount ?? "", note: editing.note ?? "",
    };
  } else {
    const type = TYPE_LABEL[params.type] ? params.type : store.get("lastType", "expense");
    v = { type, date: addDays(todayISO(), -1), amount: "",          // new entries start on yesterday
          category_id: "", from_account_id: "", to_account_id: "",
          payment_mode_id: "", payment_mode_other: "", principal_amount: "", note: "",
          metal_rate: "", metal_grams: "", metal_purity: "91.6" };
    applyRemembered();
  }
  draw();
  refreshMetal();
}

function applyRemembered() {
  const mem = store.get("last:" + v.type, {});
  const ok = (id, side) => accountsFor(side).some((a) => String(a.id) === String(id));
  if (mem.from && ok(mem.from, "from")) v.from_account_id = mem.from;
  if (mem.to && ok(mem.to, "to")) v.to_account_id = mem.to;
  if (mem.mode) v.payment_mode_id = mem.mode;
  if (!v.from_account_id && SIDES[v.type].from) v.from_account_id = accountsFor("from")[0]?.id ?? "";
  if (!v.to_account_id && SIDES[v.type].to) v.to_account_id = accountsFor("to").find((a) => String(a.id) !== String(v.from_account_id))?.id ?? "";
  if (!v.payment_mode_id) defaultMode();
  if (v.type === "redeem" && v.principal_amount === "") {
    const info = investmentInfo();
    if (info && info.open > 0) v.principal_amount = info.open;
  }
}

const isShare = (id) => M.accounts.some((a) => String(a.id) === String(id) && a.inv_type === "share");

function accountsFor(side) {
  const kinds = SIDES[v.type][side] || [];
  const ok = (a) => {
    if (v.type === "transfer" && side === "from" && a.kind === "investment") return a.inv_type === "share";  // share withdrawal
    if (v.type === "transfer" && side === "to" && v.from_account_id && isShare(v.from_account_id)) return ["bank", "cash"].includes(a.kind);
    if (v.type === "redeem" && a.kind === "investment") return !["share", "gold", "silver"].includes(a.inv_type);  // sold on their page
    if (v.type === "invest" && a.kind === "investment" && a.inv_type === "fd") return false;   // an FD gets its deposit when added
    return kinds.includes(a.kind);
  };
  return active(M.accounts).filter((a) => ok(a) || String(a.id) === String(v[side + "_account_id"]));
}

function defaultMode() {
  const acc = M.accounts.find((a) => String(a.id) === String(v.from_account_id));
  if (!acc || !showMode()) return;
  const want = { credit_card: "Credit Card", cash: "Cash", wallet: "Wallet / gift card" }[acc.kind];
  let mode = want ? M.payment_modes.find((m) => m.name === want) : null;
  if (!mode && acc.kind === "bank") {
    const cur = M.payment_modes.find((m) => String(m.id) === String(v.payment_mode_id));
    if (cur && !["Credit Card", "Cash", "Wallet / gift card"].includes(cur.name)) return;
    mode = M.payment_modes.find((m) => m.name === "UPI");
  }
  if (mode) v.payment_mode_id = mode.id;
}

const isOtherMode = () => M.payment_modes.find((m) => String(m.id) === String(v.payment_mode_id))?.name.trim().toLowerCase() === "other";
const syncOtherMode = () => {
  const box = $("#pm-other");
  if (!box) return;
  box.classList.toggle("hidden", !isOtherMode());
  if (!isOtherMode()) v.payment_mode_other = "";
};

const showMode = () => ["expense", "transfer", "invest"].includes(v.type);

function accountOptions(side) {
  const list = accountsFor(side);
  const groups = {};
  list.forEach((a) => (groups[a.kind] ||= []).push(a));
  const sel = v[side + "_account_id"];
  return `<option value="">Choose…</option>` + Object.entries(groups).map(([kind, accs]) =>
    `<optgroup label="${esc(KIND_LABEL[kind])}">${options(accs, sel)}</optgroup>`).join("");
}

function categoryList() {
  const kind = v.type === "income" ? "income" : "expense";
  return M.categories.filter((c) => c.kind === kind && !c.is_system && (c.active || String(c.id) === String(v.category_id)));
}

function investmentInfo() {
  const b = balances.find((x) => String(x.id) === String(v.from_account_id));
  if (!b) return null;
  let open = b.open_principal;
  if (editing && editing.type === "redeem" && String(editing.from_account_id) === String(v.from_account_id)) {
    open += editing.principal_amount || 0;   // principal of the entry being edited is available again
  }
  return { open };
}

const REQUIRED = ["amount", "date", "category_id", "from_account_id", "to_account_id", "principal_amount", "payment_mode_other",
  "metal_rate", "metal_grams"];

/** Under Invest, a gold / silver investment asks for the rate and grams (recorded like its page's + Instalment). */
async function refreshMetal() {
  const a = v.type === "invest" ? accById(v.to_account_id) : null;
  if (!isMetalAcc(a)) { if (metal) { metal = null; readForm(); draw(); } return; }
  if (metal && metal.id === a.id) return;
  let inv;
  try { inv = await api.investment(a.id); } catch { return; }
  if (String(v.to_account_id) !== String(a.id)) return;           // changed again meanwhile
  readForm();
  const item = editing ? (inv.summary.items || []).find((i) => String(i.entry_id) === String(editing.id)) : null;
  metal = { id: a.id, kind: a.inv_type, own: !inv.type.builtin, scheme: !!inv.summary.scheme, name: a.name, item };
  if (item) {                                       // this payment's weight, to see and correct
    v.metal_grams = String(item.grams); v.metal_rate = item.rate ? String(item.rate) : ""; v.metal_purity = String(item.purity);
  }
  if (!editing && !v.amount && metal.scheme && inv.summary.instalment) v.amount = String(inv.summary.instalment);
  if (!metal.own) v.metal_purity = item ? String(item.purity) : "";
  else if (!v.metal_purity) v.metal_purity = metal.kind === "gold" ? "91.6" : "99.9";
  gramsTyped = !!item;                              // a recorded weight is kept until you change it
  draw();
}

function metalFields() {
  if (!metal) return "";
  const word = metal.kind === "gold" ? "Gold" : "Silver";
  const presets = metal.kind === "gold" ? [["24K · 999", "99.9"], ["24K · 995", "99.5"], ["22K · 916", "91.6"], ["18K · 750", "75"]]
    : [["999", "99.9"], ["Sterling · 925", "92.5"]];
  const what = metal.scheme ? "instalment" : "purchase";
  const note = !editing ? `Recorded on <b>${esc(metal.name)}</b> as ${metal.scheme ? "an instalment" : "a purchase"}, with its weight.`
    : metal.item ? `The weight of this ${what} on <b>${esc(metal.name)}</b>. Changes here are saved there too.`
    : `No weight was recorded for this payment yet. Enter it here and it's added to <b>${esc(metal.name)}</b> as this ${what}.`;
  return `<div class="full callout">${note}</div>`
    + field("metal_rate", "Buy rate (₹/g)", `<input id="f-metal_rate" name="metal_rate" inputmode="decimal" value="${esc(v.metal_rate)}" placeholder="0">`,
      { hint: `${word} rate per gram that day` })
    + field("metal_grams", "Weight (grams)", `<input id="f-metal_grams" name="metal_grams" inputmode="decimal" value="${esc(v.metal_grams)}" placeholder="0.000">`,
      { hint: "Worked out from amount ÷ rate; change it to what the bill says" })
    + (metal.own ? field("metal_purity", "Purity", `<select id="f-metal_purity" name="metal_purity">${presets.map(([l, val]) =>
      `<option value="${val}" ${val === String(v.metal_purity) ? "selected" : ""}>${l}</option>`).join("")}</select>`) : "");
}

function fillGrams() {
  if (!metal || gramsTyped) return;
  const paid = parseFloat(String(v.amount).replace(/,/g, "")), rate = parseFloat(String(v.metal_rate).replace(/,/g, ""));
  const g = $("#f-metal_grams");
  if (g && paid > 0 && rate > 0) { v.metal_grams = (paid / rate).toFixed(3); g.value = v.metal_grams; }
}

function field(name, label, control, { full = false, hint = "" } = {}) {
  return `<div class="field ${full ? "full" : ""}" data-field="${name}">
    <label for="f-${name}" class="${REQUIRED.includes(name) ? "req" : ""}">${label}</label>${control}
    ${hint ? `<div class="hint">${hint}</div>` : ""}<div class="err hidden"></div></div>`;
}

function draw() {
  const t = v.type;
  const side = SIDES[t];
  const labels = SIDE_LABEL[t];
  const cats = categoryList();
  let html = `
    <div class="page-head">
      <div class="title-row">${backButton("#/entries", "Transactions")}
        <div><h1>${editing ? "Edit transaction" : "Add transaction"}</h1>
        ${editing ? `<div class="sub small faint">Created ${esc(editing.created_at)}${editing.updated_at !== editing.created_at ? ` · edited ${esc(editing.updated_at)}` : ""}</div>` : ""}</div></div>
    </div>
    <form class="panel panel-pad form-card" id="entry-form" novalidate autocomplete="off">
      <div class="types-row"><div class="seg types" role="tablist" aria-label="Transaction type">
        ${Object.entries(TYPE_LABEL).map(([k, l]) => `<button type="button" data-v="${k}" class="${k === t ? "on" : ""}" role="tab" aria-selected="${k === t}">${l}</button>`).join("")}
      </div>${info("types")}</div>
      <p class="small muted" style="margin:10px 0 18px">${TYPE_HELP[t]}</p>
      <div class="form-grid">
        ${field("amount", t === "redeem" ? "Amount received" : "Amount",
          `<div class="amount-wrap"><input id="f-amount" name="amount" class="amount-input" inputmode="decimal" placeholder="0" value="${esc(v.amount)}" required></div>`)}
        ${field("date", "Date",
          `<div class="date-row"><input id="f-date" type="date" name="date" value="${esc(v.date)}" required>
           <button type="button" class="btn btn-sm" data-date="0">Today</button>
           <button type="button" class="btn btn-sm" data-date="-1">Yesterday</button></div>`)}`;

  if (t === "expense" || t === "income") {
    html += field("category_id", "Category",
      `<div class="field-row"><select id="f-category_id" name="category_id">${options(cats, v.category_id, { placeholder: "Choose…" })}</select>
       <button type="button" class="btn btn-icon" data-new-cat title="New category">+</button></div>`);
  }
  if (side.from) {
    html += field("from_account_id", labels.from,
      `<div class="field-row"><select id="f-from_account_id" name="from_account_id">${accountOptions("from")}</select>
       <button type="button" class="btn btn-icon" data-new-acc="from" title="New account">+</button></div>`,
      { hint: t === "redeem" ? redeemHint() : "" });
  }
  if (side.to) {
    html += field("to_account_id", labels.to,
      `<div class="field-row"><select id="f-to_account_id" name="to_account_id">${accountOptions("to")}</select>
       <button type="button" class="btn btn-icon" data-new-acc="to" title="New account">+</button></div>`,
      { hint: t === "transfer" ? "Paying a card bill? From = your bank, To = the card."
          : t === "invest" && !metal ? "An FD gets its deposit when you add it on Investments." : "" });
  }
  if (t === "invest") html += metalFields();
  if (t === "redeem") {
    html += field("principal_amount", `Principal being closed${info("principal")}`,
      `<div class="amount-wrap"><input id="f-principal_amount" name="principal_amount" inputmode="decimal" value="${esc(v.principal_amount)}" placeholder="0"></div>`,
      { hint: "How much of what you invested is coming back. Full maturity = all of it." });
    html += `<div class="full" id="gain-box"></div>`;
  }
  if (showMode()) {
    html += field("payment_mode_id", `Payment mode${info("paid_from")}`,
      `<select id="f-payment_mode_id" name="payment_mode_id">${options(active(M.payment_modes).concat(M.payment_modes.filter((m) => !m.active && String(m.id) === String(v.payment_mode_id))), v.payment_mode_id, { placeholder: "—" })}</select>`);
    html += `<div id="pm-other" class="${isOtherMode() ? "" : "hidden"}">` + field("payment_mode_other", "Which payment mode?",
      `<input id="f-payment_mode_other" name="payment_mode_other" maxlength="60" value="${esc(v.payment_mode_other)}" placeholder="e.g. Amazon Pay, gift card">`) + `</div>`;
  }
  html += field("note", "Note",
    `<textarea id="f-note" name="note" rows="2" maxlength="500" placeholder="${t === "expense" ? "e.g. Swiggy dinner, electricity for September" : ""}">${esc(v.note)}</textarea>`, { full: true });
  html += `</div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? "Save changes" : "Save"}</button>
        ${editing ? "" : `<button type="button" class="btn" data-save-another>Save &amp; add another</button>`}
        <span class="spacer"></span>
        ${editing ? `<button type="button" class="btn btn-danger" data-delete>Delete</button>` : ""}
        <a class="btn btn-ghost" href="#/entries" data-back>Cancel</a>
      </div>
    </form>`;
  $("#view").innerHTML = html;
  bind();
  updateGain();
  const amt = $("#f-amount");
  if (amt && !editing) amt.focus();
}

function redeemHint() {
  const info = investmentInfo();
  const gold = "Gold and silver are sold on their own page, so their weight stays right.";
  return info ? `Amount invested here: <b>${money(info.open)}</b>. ${gold}` : gold;
}

/** A maturity that brings back everything invested closes the investment (like its page's Close). */
function closesNow() {
  const a = accById(v.from_account_id), info = investmentInfo();
  const pr = parseFloat(String(v.principal_amount).replace(/,/g, ""));
  return !editing && v.type === "redeem" && closesOnFull(a) && info && info.open > 0 && Math.abs(pr - info.open) < 0.005;
}

function updateGain() {
  const box = $("#gain-box");
  if (!box) return;
  const amt = parseFloat(String(v.amount).replace(/,/g, ""));
  const pr = parseFloat(String(v.principal_amount).replace(/,/g, ""));
  if (isNaN(amt) || isNaN(pr)) { box.innerHTML = ""; return; }
  const gain = Math.round((amt - pr) * 100) / 100;
  box.innerHTML = gain >= 0
    ? `<div class="callout gain"><strong style="color:inherit">${money(gain)} gain</strong> will be counted as income (Investment Returns). ${money(pr)} principal is your own money coming back.</div>`
    : `<div class="callout loss"><strong style="color:inherit">${money(gain)} loss</strong> will be recorded under Investment Returns (e.g. chit fund discount, FD break penalty).</div>`;
  if (closesNow()) box.innerHTML += `<div class="callout" style="margin-top:8px">This brings back everything invested in
    <b>${esc(accById(v.from_account_id).name)}</b>, so it will be marked as <b>closed</b>. “Undo closing” on its page reverses that.</div>`;
}

function readForm() {
  $$("#entry-form [name]").forEach((el) => { v[el.name] = el.value; });
}

function bind() {
  const form = $("#entry-form");
  $$(".seg.types button").forEach((b) => b.addEventListener("click", () => {
    readForm();
    if (b.dataset.v === v.type) return;
    v.type = b.dataset.v;
    v.category_id = "";
    // keep accounts only if still valid for the new type
    ["from", "to"].forEach((s) => {
      if (!SIDES[v.type][s] || !accountsFor(s).some((a) => String(a.id) === String(v[s + "_account_id"]))) v[s + "_account_id"] = "";
    });
    if (!editing) applyRemembered();
    draw();
    refreshMetal();
  }));
  $$("[data-date]").forEach((b) => b.addEventListener("click", () => {
    $("#f-date").value = addDays(todayISO(), +b.dataset.date);
  }));
  form.addEventListener("input", (e) => {
    if (e.target.name) v[e.target.name] = e.target.value;
    if (["amount", "principal_amount"].includes(e.target.name)) updateGain();
    if (e.target.name === "metal_grams") gramsTyped = true;
    if (["amount", "metal_rate"].includes(e.target.name)) fillGrams();
    clearError(e.target.name);
  });
  form.addEventListener("change", (e) => {
    if (!e.target.name) return;
    v[e.target.name] = e.target.value;
    if (e.target.name === "payment_mode_id") { syncOtherMode(); if (isOtherMode()) $("#f-payment_mode_other")?.focus(); }
    if (e.target.name === "to_account_id") refreshMetal();
    if (e.target.name === "from_account_id") {
      if (showMode()) { defaultMode(); const pm = $("#f-payment_mode_id"); if (pm) pm.value = v.payment_mode_id; syncOtherMode(); }
      if (v.type === "transfer") {          // a share withdrawal can only go to a bank or cash account
        const list = accountsFor("to");
        if (!list.some((a) => String(a.id) === String(v.to_account_id))) v.to_account_id = list.find((a) => String(a.id) !== String(v.from_account_id))?.id ?? "";
        const to = $("#f-to_account_id");
        if (to) { to.innerHTML = accountOptions("to"); to.value = v.to_account_id; }
      }
      if (v.type === "redeem") {
        const info = investmentInfo();
        if (info && !editing) v.principal_amount = info.open > 0 ? info.open : "";
        readFormExcept("principal_amount");
        draw();
      }
    }
  });
  $("[data-new-cat]")?.addEventListener("click", newCategory);
  $$("[data-new-acc]").forEach((b) => b.addEventListener("click", () => newAccount(b.dataset.newAcc)));
  form.addEventListener("submit", (e) => { e.preventDefault(); save(false); });
  $("[data-save-another]")?.addEventListener("click", () => save(true));
  $("[data-delete]")?.addEventListener("click", remove);
}

function readFormExcept(name) {
  $$("#entry-form [name]").forEach((el) => { if (el.name !== name) v[el.name] = el.value; });
}

function clearError(name) {
  const f = $(`[data-field="${name}"]`);
  if (f) { f.classList.remove("has-error"); $(".err", f).classList.add("hidden"); }
}

const ERR_FIELD = { grams: "metal_grams", rate: "metal_rate", purity: "metal_purity", total_paid: "amount", paid_from_account_id: "from_account_id" };

function showError(err) {
  const name = ERR_FIELD[err.field] || err.field;
  const f = name && $(`[data-field="${name}"]`);
  if (f) {
    f.classList.add("has-error");
    const e = $(".err", f);
    e.textContent = err.message;
    e.classList.remove("hidden");
    $("input, select", f)?.focus();
  } else {
    toast(err.message, true);
  }
}

async function save(another) {
  readForm();
  const payload = { ...v };
  if (!showMode()) { payload.payment_mode_id = ""; payload.payment_mode_other = ""; }   // income and maturity have no mode
  try {
    if (editing) {
      const weigh = metal && v.type === "invest";
      if (weigh && !(parseFloat(String(v.metal_grams).replace(/,/g, "")) > 0) && metal.item) {
        showError({ field: "metal_grams", message: "Enter the weight in grams" }); return;
      }
      await api.updateEntry(editing.id, payload);
      if (weigh && parseFloat(String(v.metal_grams).replace(/,/g, "")) > 0) {
        await api.invPut(metal.id, `payments/${editing.id}/weight`,
          { grams: v.metal_grams, rate: v.metal_rate, purity: metal.own ? v.metal_purity : "" });
      }
      toast("Transaction updated");
      goBack("#/entries");                              // back to the list you came from (same month)
      return;
    }
    if (metal && v.type === "invest") {
      // gold / silver: the same as "+ Instalment" / "+ Gold coin" on the investment's page (payment + weight)
      for (const [k, msg] of [["metal_rate", "Enter the buy rate per gram"], ["metal_grams", "Enter the weight in grams"]]) {
        if (!(parseFloat(String(v[k]).replace(/,/g, "")) > 0)) { showError({ field: k, message: msg }); return; }
      }
      if (!v.from_account_id) { showError({ field: "from_account_id", message: "Choose the account it was paid from" }); return; }
      await api.invPost(metal.id, "items", {
        date: v.date, total_paid: v.amount, rate: v.metal_rate, grams: v.metal_grams,
        purity: metal.own ? v.metal_purity : "", paid_from_account_id: v.from_account_id,
        payment_mode_id: v.payment_mode_id, note: v.note,
      });
      toast(`Saved: ${metal.scheme ? "instalment" : "purchase"} of ${v.metal_grams} g · ${metal.name}`);
    } else if (closesNow()) {
      // everything invested is coming back: close it, as its page's Close does
      const a = accById(v.from_account_id);
      await api.invPost(a.id, "close", { date: v.date, amount: v.amount, to_account_id: v.to_account_id, note: v.note });
      toast(`Saved: maturity ${money(parseFloat(String(v.amount).replace(/,/g, "")))} · ${a.name} closed`);
    } else {
      const saved = await api.createEntry(payload);
      toast(`Saved: ${TYPE_LABEL[saved.type]} ${money(saved.amount)}${saved.category ? " · " + saved.category : ""}`);
    }
    store.set("lastType", v.type);
    store.set("last:" + v.type, { from: v.from_account_id, to: v.to_account_id, mode: v.payment_mode_id });
    if (another) {
      balances = await api.balances();
      v.amount = ""; v.note = ""; v.principal_amount = ""; v.category_id = ""; v.metal_grams = ""; gramsTyped = false;
      draw();
    } else {
      location.hash = "#/entries";
    }
  } catch (err) {
    showError(err);
  }
}

async function remove() {
  const ok = await confirmDialog("Delete this transaction?", `${TYPE_LABEL[editing.type]} of ${money(editing.amount)} on ${editing.date}. This can't be undone.`);
  if (!ok) return;
  try {
    await api.deleteEntry(editing.id);
    toast("Transaction deleted");
    goBack("#/entries");
  } catch (err) {
    toast(err.message, true);
  }
}

async function newCategory() {
  readForm();
  const kind = v.type === "income" ? "income" : "expense";
  const created = await modal({
    title: `New ${kind} category`,
    body: `<div class="field"><label>Name</label><input name="name" required maxlength="80"></div>`,
    onSubmit: (vals) => api.createMaster("categories", { name: vals.name, kind }),
  });
  if (!created) return;
  invalidateMasters();
  M = await masters(true);
  v.category_id = created.id;
  draw();
  toast(`Added category ${created.name}`);
}

async function newAccount(side) {
  readForm();
  const kinds = SIDES[v.type][side].filter((k) => !(v.type === "transfer" && ["investment", "loan"].includes(k)));
  if (kinds.length === 1 && kinds[0] === "investment") {       // invest / redeem: ask what kind of investment
    const inv = await investmentForm(null);
    if (!inv) return;
    invalidateMasters();
    [M, balances] = await Promise.all([masters(true), api.balances()]);
    v[side + "_account_id"] = inv.account.id;
    draw();
    return;
  }
  const created = await modal({
    title: "New account",
    body: `
      <div class="field"><label class="req">Name</label><input name="name" required maxlength="80" placeholder="${kinds.includes("investment") ? "e.g. KSFE Chit Fund, Federal RD" : "e.g. ICICI, Amazon Pay ICICI Card"}"></div>
      <div class="field"><label class="req">Type</label><select name="kind">${kinds.map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join("")}</select></div>
      <div class="field"><label>Opening balance</label><input name="opening_balance" inputmode="decimal" placeholder="0">
        <div class="hint">Bank/cash: current balance. Credit card: amount currently owed. Investment: principal already invested.</div></div>`,
    onSubmit: (vals) => api.createMaster("accounts", vals),
  });
  if (!created) return;
  invalidateMasters();
  [M, balances] = await Promise.all([masters(true), api.balances()]);
  v[side + "_account_id"] = created.id;
  if (side === "from") defaultMode();
  draw();
  toast(`Added account ${created.name}`);
}
