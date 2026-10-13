// Starting balances: where every account stands "as on" a date.
import { api } from "../api.js";
import { invalidateMasters, masters } from "../state.js";
import { $, $$, dateLabel, esc, store, toast, todayISO } from "../util.js";

const GROUPS = [
  { kind: "bank", title: "Bank accounts", label: "Balance", hint: "Balance as shown in your bank app or passbook.", add: "e.g. ICICI" },
  { kind: "cash", title: "Cash", label: "Cash in hand", hint: "Cash you are holding right now.", add: "e.g. Home cash box" },
  { kind: "credit_card", title: "Credit cards", label: "Outstanding", hint: "Total amount you currently owe on the card: billed but unpaid + unbilled spends.", add: "e.g. Amazon Pay ICICI Card" },
];

let rows = {};      // id -> {amount, date}
let common;

export async function render() {
  const M = await masters(true);
  const accounts = M.accounts.filter((a) => a.active);
  const anySet = accounts.some((a) => a.opening_date);
  common = rows.__common || todayISO();
  accounts.forEach((a) => {
    if (!rows[a.id]) {
      rows[a.id] = a.opening_date
        ? { amount: String(a.opening_balance), date: a.opening_date }
        : { amount: "", date: common };
    }
  });

  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Starting balances</h1>
        <div class="sub muted small">Enter where each account stands on a date. Every transaction from that date onward updates these balances.</div>
      </div>
    </div>

    <section class="panel panel-pad" style="max-width:860px">
      <div class="field" style="max-width:340px">
        <label for="common-date">As on date</label>
        <input type="date" id="common-date" value="${common}">
        <div class="hint">Use the date you start recording transactions. You can change it per account below.</div>
      </div>
      <div class="callout small" style="margin-top:14px">
        Example: SBI shows ₹400 and you have ₹500 cash today. Enter those with today's date, then record today's
        and later spending as transactions. Transactions dated <b>before</b> this date still appear in reports but don't change the balance.
      </div>
    </section>

    <form id="setup-form" novalidate style="max-width:860px">
      ${GROUPS.map((g) => group(g, accounts.filter((a) => a.kind === g.kind))).join("")}
      <div class="callout small" style="margin-bottom:16px"><strong>Investments and loans</strong> are added on their own pages,
        with the amount already invested or owed: <a href="#/investments">Investments →</a> · <a href="#/loans">Loans &amp; EMIs →</a></div>
      <div class="form-actions" style="margin-top:4px">
        <button type="submit" class="btn btn-primary">Save starting balances</button>
        <span class="spacer"></span>
        ${anySet ? `<a class="btn btn-ghost" href="#/dashboard">Cancel</a>` : `<button type="button" class="btn btn-ghost" id="skip">Skip for now</button>`}
      </div>
    </form>`;

  bind(accounts);
}

function group(g, accs) {
  return `
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>${g.title}</h2></div>
      <p class="small muted" style="margin:6px 20px 0">${g.hint}</p>
      <div class="table-wrap"><table class="master-table setup-table">
        ${accs.length ? `<thead><tr><th>Account</th><th class="num">${g.label} (₹)</th><th>As on</th></tr></thead>` : ""}
        <tbody>${accs.map((a) => `
          <tr data-id="${a.id}">
            <td class="cell-main">${esc(a.name)}${a.opening_date ? `<div class="cell-sub">saved: as on ${dateLabel(a.opening_date)}</div>` : ""}</td>
            <td class="num"><input type="text" inputmode="decimal" class="right" name="amount" value="${esc(rows[a.id].amount)}" placeholder="0" style="max-width:170px"></td>
            <td><input type="date" name="date" value="${esc(rows[a.id].date)}"></td>
          </tr>`).join("") || `<tr><td class="small faint" style="border:0">None yet.</td></tr>`}</tbody>
      </table></div>
      <div class="add-row" data-kind="${g.kind}">
        <input type="text" placeholder="Add ${g.kind === "cash" ? "a cash" : g.kind === "investment" ? "an investment" : g.kind === "bank" ? "a bank" : "a credit card"} account: ${esc(g.add)}" maxlength="80">
        <button type="button" class="btn">Add</button>
      </div>
    </section>`;
}

function readRows() {
  $$("#setup-form tr[data-id]").forEach((tr) => {
    rows[tr.dataset.id] = { amount: $("[name=amount]", tr).value.trim(), date: $("[name=date]", tr).value };
  });
}

function bind(accounts) {
  $("#common-date").addEventListener("change", (e) => {
    const prev = common;
    common = e.target.value || todayISO();
    rows.__common = common;
    $$("#setup-form tr[data-id] [name=date]").forEach((inp) => { if (!inp.value || inp.value === prev) inp.value = common; });
  });

  $$(".add-row[data-kind]").forEach((box) => {
    const input = $("input", box);
    const add = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      readRows();
      try {
        const a = await api.createMaster("accounts", { name, kind: box.dataset.kind });
        rows[a.id] = { amount: "", date: common };
        invalidateMasters();
        toast(`Added ${a.name}`);
        await render();
        $(`tr[data-id="${a.id}"] [name=amount]`)?.focus();
      } catch (err) { toast(err.message, true); }
    };
    $("button", box).addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  });

  $("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    readRows();
    const items = accounts.map((a) => ({
      id: a.id,
      opening_balance: rows[a.id].amount === "" ? "0" : rows[a.id].amount,
      opening_date: rows[a.id].date || common,
    }));
    try {
      await api.setOpening(items);
      invalidateMasters();
      rows = {};
      store.set("setupSkipped", false);
      toast("Starting balances saved");
      location.hash = "#/dashboard";
    } catch (err) {
      toast(err.message, true);
    }
  });

  $("#skip")?.addEventListener("click", () => {
    store.set("setupSkipped", true);
    location.hash = "#/dashboard";
  });
}
