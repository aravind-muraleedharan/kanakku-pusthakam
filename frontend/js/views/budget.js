// Monthly Budget (#/budget): your own income and expense items (budget only, not the app's categories), up to three
// months side by side (you add and delete months), amounts and notes per month, payments ticked as done, and whether the money is enough.
import { api } from "../api.js";
import { info } from "../help.js";
import { $, $$, confirmDialog, esc, modal, money, monthLabel, toast } from "../util.js";

let g = null;
let phoneMonth = 0;                 // on phones one month is shown at a time

const monthName = (m) => monthLabel(m).split(" ")[0];
const BIN = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;
const TICK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

export async function render() {
  g = await api.budget();
  if (!g.months) throw new Error("The app was updated. Restart it (Ctrl+C in its terminal, then start it again) and reload this page.");
  paint();
}

function when(c) {
  if (c.running) return `this month · ${c.days} day${c.days === 1 ? "" : "s"} left`;
  return c.days <= 31 ? `starts in ${c.days} day${c.days === 1 ? "" : "s"}` : "plan ahead";
}

function card(c, i) {
  const pct = c.expense ? Math.round((c.paid * 100) / c.expense) : 0;
  return `<section class="panel bx-card bx-m${i}">
    <div class="bx-top"><div><h2>${esc(monthLabel(c.month))}</h2><div class="bx-state">${when(c)}</div></div></div>
    <div class="bx-grid">
      <div><div class="bx-k">Income</div><div class="bx-v c-income">${money(c.income)}</div></div>
      <div><div class="bx-k">Expenses</div><div class="bx-v c-expense">${money(c.expense)}</div></div>
      <div><div class="bx-k">Paid</div><div class="bx-v">${money(c.paid)}<small>${c.done} of ${c.items}</small></div></div>
      <div><div class="bx-k">Still to pay</div><div class="bx-v" style="color:var(--warn)">${money(c.still_to_pay)}</div></div>
    </div>
    <div class="progress bx-bar"><div style="width:${pct}%"></div></div>
    ${!c.income && !c.expense ? `<div class="bx-res none"><span>Nothing planned yet</span></div>`
      : c.balance >= 0 ? `<div class="bx-res ok"><span>✓ Sufficient: ${money(c.balance)} spare${info("sufficient")}</span><span>income − expenses</span></div>`
      : `<div class="bx-res short"><span>⚠ Short by ${money(-c.balance)}${info("sufficient")}</span><span>income − expenses</span></div>`}
    <div class="bx-acts">
      ${c.copy_from ? `<button class="btn btn-sm" data-copy="${c.month}" data-from="${c.copy_from}">Copy ${esc(monthName(c.copy_from))}</button>` : ""}
      ${c.has_data ? `<button class="btn btn-sm btn-ghost" data-clear="${c.month}">Clear</button>` : ""}
      <button class="btn btn-sm btn-ghost btn-danger bx-del" data-delmonth="${c.month}">${BIN} Delete</button>
    </div>
  </section>`;
}

function paint() {
  const focused = document.activeElement?.dataset?.key;
  const empty = !g.income.length && !g.expense.length;
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Monthly Budget</h1>
        <div class="sub muted small">Plan your income and expenses for the months ahead, track payments as you make them, and see if your income covers your expenses.</div></div>
    </div>
    <div class="bx-sum">${g.months.map(card).join("")}${addCard()}</div>
    ${empty || !g.months.length ? "" : `<p class="small faint bx-hint">Tick ✓ when a payment is made. ✎ adds a note for that month. Point at an item to rename or delete it. Amounts save as you leave each box.</p>`}
    ${!g.months.length ? "" : empty ? `<section class="panel bx-empty"><h3>Your budget is empty</h3>
        <p class="muted small">Add the money you expect to receive and the payments you need to make.<br>
        These items belong to the budget only; they don't change your categories or transactions.</p>
        <button class="btn btn-primary" data-add="income">+ Add income item</button> <button class="btn" data-add="expense">+ Add expense item</button></section>`
      : table()}`;
  bind();
  if (focused) { const el = $(`[data-key="${focused}"]`); if (el) { el.focus(); el.select?.(); } }
}

function addCard() {
  if (!g.can_add.length) return "";
  const first = !g.months.length;
  return `<section class="panel bx-card bx-addcard"><div>
      <h2>${first ? "No months in the plan" : "Add a month"}</h2>
      <div class="bx-state">${first ? "Add a month to start planning." : `Up to ${g.max_months} months at a time.`}</div></div>
    <button class="btn ${first ? "btn-primary" : ""}" data-addmonth>+ Add month</button></section>`;
}

function table() {
  const M = g.months;
  if (phoneMonth >= M.length) phoneMonth = 0;
  const tabs = `<div class="bx-tabs seg" style="grid-template-columns:repeat(${M.length},1fr)">${M.map((c, i) => `<button type="button" data-pm="${i}" class="${i === phoneMonth ? "on" : ""}">${esc(monthName(c.month))}</button>`).join("")}</div>`;
  const head = `<thead><tr><th class="bx-name" rowspan="2">Item</th>${M.map((c, i) => `<th class="m bx-m${i}" colspan="3">${esc(monthLabel(c.month))}</th>`).join("")}</tr>
    <tr class="sub">${M.map((c, i) => `<th class="l bx-m${i} num">Amount</th><th class="bx-m${i} ctr">Done${i === 0 ? info("done") : ""}</th><th class="bx-m${i} ctr">Note</th>`).join("")}</tr></thead>`;
  const sec = (kind, title) => `
    <tr class="bx-sec"><th class="bx-name">${title}</th>${M.map((c, i) => `<th class="num l bx-m${i} c-${kind}" colspan="3">${money(c[kind])}</th>`).join("")}</tr>
    ${g[kind].map((r) => row(kind, r)).join("") || `<tr><td class="bx-name faint small">No ${kind} items yet</td>${M.map((c, i) => `<td class="l bx-m${i}" colspan="3"></td>`).join("")}</tr>`}
    <tr class="bx-addrow"><td class="bx-name"><button class="linkish" data-add="${kind}">+ Add ${kind} item</button></td>${M.map((c, i) => `<td class="l bx-m${i}" colspan="3"></td>`).join("")}</tr>`;
  const tot = (label, f, cls = "") => `<tr class="bx-tot ${cls}"><th class="bx-name">${label}</th>${M.map((c, i) => `<td class="num l bx-m${i}" colspan="3">${f(c)}</td>`).join("")}</tr>`;
  return `${tabs}<section class="panel bx-panel"><div class="table-wrap"><table class="bx-table" data-pm="${phoneMonth}">${head}<tbody>
    ${sec("income", "Income")}
    ${sec("expense", "Expenses")}
    <tr class="bx-sec"><th class="bx-name">Totals</th>${M.map((c, i) => `<th class="l bx-m${i}" colspan="3"></th>`).join("")}</tr>
    ${tot("Total income", (c) => `<b class="c-income">${money(c.income)}</b>`)}
    ${tot("Total expenses", (c) => `<b class="c-expense">${money(c.expense)}</b>`)}
    ${tot("Still to pay", (c) => `<b>${money(c.still_to_pay)}</b>`)}
    ${tot("Income − expenses", (c) => `<b class="${c.balance < 0 ? "neg" : "c-income"}">${money(c.balance)}</b>`, "bx-left")}
  </tbody></table></div></section>`;
}

function row(kind, r) {
  const cells = g.months.map((c, i) => {
    const x = r.cells[c.month], key = `${r.id}:${c.month}`;
    const done = x.done;
    return `<td class="l bx-amt bx-m${i} ${done ? "is-done" : ""}"><div class="amount-wrap"><input type="text" inputmode="decimal" data-key="${key}"
        data-item="${r.id}" data-m="${c.month}" value="${x.amount === null ? "" : esc(money(x.amount).replace("₹", ""))}" aria-label="${esc(r.name)}, ${esc(monthLabel(c.month))}"></div>
        ${x.note ? `<span class="note-txt">${esc(x.note)}</span>` : ""}</td>
      <td class="bx-done bx-m${i} ${done ? "is-done" : ""}">${kind === "expense"
        ? `<button type="button" class="tick ${done ? "on" : ""}" data-tick="${key}" data-key="t:${key}" aria-pressed="${done}" aria-label="${done ? "Paid" : "Mark as paid"}: ${esc(r.name)}, ${esc(monthName(c.month))}">${TICK}</button>` : ""}</td>
      <td class="bx-note bx-m${i} ${done ? "is-done" : ""}"><button type="button" class="pen ${x.note ? "on" : ""}" data-note="${key}" data-key="n:${key}" title="${esc(x.note || "Add a note")}" aria-label="Note">✎</button></td>`;
  }).join("");
  return `<tr class="bx-row"><td class="bx-name"><div class="row-in"><span class="cell-main">${esc(r.name)}</span>
      <span class="bx-rowacts"><button type="button" class="bx-ico" data-rename="${r.id}" data-kind="${kind}" title="Rename" aria-label="Rename ${esc(r.name)}">✎</button>
      <button type="button" class="bx-ico del" data-delitem="${r.id}" data-name="${esc(r.name)}" title="Delete item" aria-label="Delete ${esc(r.name)}">${BIN}</button></span></div></td>${cells}</tr>`;
}

const findItem = (id) => [...g.income, ...g.expense].find((x) => String(x.id) === String(id));

async function save(month, item) {
  try { g = await api.budgetSave(month, [item]); paint(); } catch (err) { toast(err.message, true); throw err; }
}

function bind() {
  $$("[data-pm]").forEach((b) => b.addEventListener("click", () => { phoneMonth = +b.dataset.pm; paint(); }));
  $$(".bx-table input[data-key]").forEach((inp) => {
    inp.dataset.was = inp.value;
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    inp.addEventListener("change", () => {
      if (inp.value.trim() === inp.dataset.was) return;
      save(inp.dataset.m, { item_id: +inp.dataset.item, amount: inp.value.trim() }).catch(() => { inp.value = inp.dataset.was; });
    });
  });
  $$("[data-tick]").forEach((b) => b.addEventListener("click", () => {
    const [id, m] = b.dataset.tick.split(":");
    save(m, { item_id: +id, done: !findItem(id).cells[m].done }).catch(() => {});
  }));
  $$("[data-note]").forEach((b) => b.addEventListener("click", () => {
    const [id, m] = b.dataset.note.split(":");
    const r = findItem(id);
    modal({
      title: `Note · ${r.name} · ${monthLabel(m)}`, submitLabel: "Save note",
      body: `<div class="field"><textarea name="note" rows="3" maxlength="200" placeholder="e.g. due on the 5th, paid by UPI">${esc(r.cells[m].note || "")}</textarea>
        <div class="hint">Leave it empty to remove the note.</div></div>`,
      onSubmit: async (v) => { await save(m, { item_id: +id, note: v.note }); return true; },
    });
  }));
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const kind = b.dataset.add;
    modal({
      title: `New ${kind} item`, submitLabel: "Add",
      body: `<div class="field"><label class="req">Name</label><input name="name" required maxlength="60" placeholder="${kind === "income" ? "e.g. Salary, Rent received" : "e.g. House rent, Milk, School fees"}">
        <div class="hint">For the budget only: it isn't added to your categories.</div></div>`,
      onSubmit: async (v) => {
        g = await api.budgetAddItem({ kind, name: v.name });
        paint();
        const it = g[kind].find((x) => x.name.toLowerCase() === v.name.trim().replace(/\s+/g, " ").toLowerCase());
        if (it) $(`input[data-item="${it.id}"]`)?.focus();
        return true;
      },
    });
  }));
  $$("[data-rename]").forEach((b) => b.addEventListener("click", () => {
    const r = findItem(b.dataset.rename);
    modal({
      title: "Rename item", submitLabel: "Save",
      body: `<div class="field"><label class="req">Name</label><input name="name" required maxlength="60" value="${esc(r.name)}"></div>`,
      onSubmit: async (v) => { g = await api.budgetRenameItem(r.id, { name: v.name }); paint(); return true; },
    });
  }));
  $$("[data-delitem]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmDialog(`Delete “${b.dataset.name}”?`, "This item will be removed from every month, along with its amounts, notes and ticks. Are you sure?"))) return;
    try { g = await api.budgetDeleteItem(b.dataset.delitem); paint(); toast("Item deleted"); } catch (err) { toast(err.message, true); }
  }));
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.copy, src = b.dataset.from;
    const col = g.months.find((c) => c.month === m);
    if (col.has_data && !(await confirmDialog(`Replace ${monthLabel(m)}?`, `The amounts and notes in ${monthLabel(m)} will be replaced with those from ${monthLabel(src)}. Ticks will start empty. Are you sure?`, "Replace"))) return;
    try { g = await api.budgetCopy(m, src); paint(); toast(`Copied ${monthLabel(src)}`); } catch (err) { toast(err.message, true); }
  }));
  $$("[data-clear]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.clear;
    if (!(await confirmDialog(`Clear ${monthLabel(m)}?`, `All amounts, notes and ticks for ${monthLabel(m)} will be cleared. The month stays in your plan. Are you sure?`, "Clear"))) return;
    try { g = await api.budgetClear(m); paint(); toast(`${monthLabel(m)} cleared`); } catch (err) { toast(err.message, true); }
  }));
  $$("[data-delmonth]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.delmonth;
    if (!(await confirmDialog(`Delete ${monthLabel(m)}?`, `${monthLabel(m)} will be removed from your plan, along with all its amounts, notes and ticks. Your items stay. Are you sure?`))) return;
    try { g = await api.budgetDeleteMonth(m); phoneMonth = 0; paint(); toast(`${monthLabel(m)} deleted`); } catch (err) { toast(err.message, true); }
  }));
  $$("[data-addmonth]").forEach((b) => b.addEventListener("click", () => {
    const last = g.months.at(-1)?.month;                       // default: the month after the last one shown
    const pick = g.can_add.find((m) => !last || m > last) || g.can_add[0];
    modal({
      title: "Add a month", submitLabel: "Add",
      body: `<div class="field"><label class="req">Month</label><select name="month">${g.can_add.map((m) => `<option value="${m}" ${m === pick ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("")}</select>
        <div class="hint">The plan holds up to ${g.max_months} months. The new month starts empty; use “Copy” to fill it from the month before.</div></div>`,
      onSubmit: async (v) => { g = await api.budgetAddMonth(v.month); paint(); toast(`${monthLabel(v.month)} added`); return true; },
    });
  }));
}
