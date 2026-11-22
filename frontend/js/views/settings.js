// Settings: a list of sections for the lists (categories, payment modes, loan & investment types) and app sections (security, backups, about).
import { api } from "../api.js";
import { invalidateMasters, masters } from "../state.js";
import { $, $$, backButton, confirmDialog, dateLabel, esc, modal, toast, todayISO } from "../util.js";
import { info } from "../help.js";
import { setMinutes as setIdleMinutes } from "../idle.js";

// "2026-11-18 16:14:26" -> "18 Nov 2026, 4:14 PM"
const stamp = (s) => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(s || "");
  if (!m) return s || "";
  const h = +m[2];
  return `${dateLabel(m[1])}, ${h % 12 || 12}:${m[3]} ${h < 12 ? "AM" : "PM"}`;
};

// ---------------------------------------------------------------- page: a list of sections; each opens on its own page

const ICON = (d) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SECTIONS = {
  categories: { label: "Categories", group: "Lists", color: "var(--expense)", sub: "How you group spending and income",
    icon: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>' },
  payment_modes: { label: "Payment modes", group: "Lists", color: "var(--transfer)", sub: "UPI, card, cash…",
    icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>' },
  loan_types: { label: "Loan types", group: "Lists", color: "var(--income)", sub: "Built-in and your own",
    icon: '<path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z"/>' },
  investment_types: { label: "Investment types", group: "Lists", color: "var(--invest)", sub: "Stocks, FD, gold, your own…",
    icon: '<path d="M4 17l5-5 4 4 7-7"/><path d="M15 9h5v5"/>' },
  security: { label: "Security", group: "App", color: "var(--link)", sub: "Password, authenticator, auto-logout",
    icon: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>' },
  data: { label: "Backups", group: "App", color: "var(--redeem)", sub: "Automatic backups, back up to a folder, restore",
    icon: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>' },
  about: { label: "About", group: "App", color: "var(--ink-3)", sub: "Version and where your data lives",
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>' },
};
const GROUPS = { Lists: "Your choices in forms", App: "App" };

export async function render(params) {
  if (params.s === "accounts") { location.hash = "#/accounts"; return; }
  if (!SECTIONS[params.s]) return home();
  // one section on its own page, with a way back to the list
  const sec = params.s, x = SECTIONS[sec];
  const lists = x.group === "Lists";
  $("#view").innerHTML = `
    <div class="page-head"><div class="title-row">${backButton("#/settings", "Settings")}
      <h1 class="h1-info">${x.label}${lists ? ` ${info("settings_active")}` : ""}</h1></div></div>
    <div id="set-body"></div>`;
  const body = $("#set-body");
  const M = lists ? await masters(true) : null;
  if (sec === "categories") categories(body, M.categories);
  if (sec === "payment_modes") paymentModes(body, M.payment_modes);
  if (sec === "loan_types") await loanTypes(body);
  if (sec === "investment_types") await investmentTypes(body);
  if (sec === "security") await security(body);
  if (sec === "data") await data(body);
  if (sec === "about") await about(body);
}

/** The Settings home: every section as a row with a quick figure; a click opens it. */
async function home() {
  const [M, sys, backups, lt, it] = await Promise.all([masters(true), api.info(), api.backups(), api.loanTypes(), api.investmentTypes()]);
  const figure = {
    categories: M.categories.length,
    payment_modes: M.payment_modes.length,
    loan_types: 3 + lt.length,
    investment_types: it.length,
    security: "MFA on",
    data: backups[0] ? stamp(backups[0].created).split(" ").slice(0, 2).join(" ") : "No backup yet",
    about: `v${esc(sys.app_version)}`,
  };
  const row = ([k, x]) => `<a class="set-row" href="#/settings?s=${k}">
      <span class="set-ico" style="--c:${x.color}">${ICON(x.icon)}</span>
      <span class="set-txt"><b>${x.label}</b><small>${x.sub}</small></span>
      <span class="set-fig">${figure[k]}</span><span class="set-chev" aria-hidden="true">›</span></a>`;
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    ${Object.entries(GROUPS).map(([g, title]) => `<div class="set-gh">${title}</div>
      <div class="panel set-list">${Object.entries(SECTIONS).filter(([, x]) => x.group === g).map(row).join("")}</div>`).join("")}`;
}

const reload = () => { invalidateMasters(); render(Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""))); };

// ---------------------------------------------------------------- one list card (same rows for every list)
// item: { id, name, used, active, locked (built in / automatic), note, sub }
// opts: { title, cls, items, unit, addLabel, addExtra (html), rename, toggle, remove, add }
const BIN = ICON('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>');

// long lists show their first rows; "Show all" opens the rest (remembered while you edit)
const SHOW = 8;
const opened = new Set();

function listCard(o) {
  const useFull = (it) => it.used ? `Used by ${it.used} ${it.used === 1 ? o.unit : o.unit + "s"}` : "Not used yet";
  const useText = (it) => it.used ? `${it.used} used` : "unused";
  const trim = o.items.length > SHOW + 2;
  const row = (it, i) => `<div class="ls-row ${it.active === false ? "off" : ""} ${trim && i >= SHOW ? "ls-extra" : ""}" data-id="${it.id}">
      <div class="ls-main">${it.locked || !o.rename
        ? `<span class="ls-name">${esc(it.name)}</span>`
        : `<input class="ls-name ls-edit" value="${esc(it.name)}" maxlength="${o.max || 80}" aria-label="Rename ${esc(it.name)}" title="Click to rename">`}
        ${o.describe && !it.locked
          ? `<input class="ls-sub ls-subedit" value="${esc(it.description || "")}" maxlength="80" placeholder="Add a description" aria-label="Description of ${esc(it.name)}">`
          : it.sub ? `<div class="ls-sub">${esc(it.sub)}</div>` : ""}</div>
      <span class="ls-use" title="${it.used ? useFull(it) : ""}">${it.used === undefined || (it.locked && !it.used) ? "" : useText(it)}</span>
      ${it.note ? `<span class="ls-tagcell"><span class="ls-tag">${esc(it.note)}</span></span>` : o.toggle && !it.lockToggle ? `<button type="button" class="sw ${it.active === false ? "" : "on"}" role="switch" aria-checked="${it.active !== false}"
          title="${it.active === false ? "Hidden from the form: click to show it" : "Shown in the form: click to hide it"}" aria-label="Show ${esc(it.name)} in the form"><i></i></button>` : "<span></span>"}
      ${it.note ? "" : `<span class="ls-del">`}${o.remove && !it.locked && !it.used ? `<button type="button" class="bx-ico del" title="Delete" aria-label="Delete ${esc(it.name)}">${BIN}</button>` : ""}${it.note ? "" : "</span>"}
    </div>`;
  const html = `<section class="panel ls-card" data-card="${o.key}">
      <div class="panel-head"><h2 class="${o.cls || ""}">${o.title}<span class="ls-count">${o.items.length}</span>${o.help ? info(o.help) : ""}</h2></div>
      <div class="ls-body ${trim && !opened.has(o.key) ? "trimmed" : ""}">${o.items.map(row).join("") || `<div class="ls-empty small faint">None yet</div>`}</div>
      ${trim ? `<button type="button" class="ls-more" aria-expanded="${opened.has(o.key)}">
        <span class="when-closed">Show all ${o.items.length} ▾</span><span class="when-open">Show fewer ▴</span></button>` : ""}
      <div class="ls-addwrap"><button type="button" class="linkish ls-add">+ ${o.addLabel}</button>
        <form class="ls-addform hidden" novalidate><input name="name" maxlength="${o.max || 80}" placeholder="Name" required>${o.addExtra || ""}
          <button class="btn btn-primary btn-sm">Add</button><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></form></div>
    </section>`;
  return { html, bind: (root) => bindCard($(`[data-card="${o.key}"]`, root), o) };
}

function bindCard(card, o) {
  $(".ls-more", card)?.addEventListener("click", (e) => {
    const open = $(".ls-body", card).classList.toggle("trimmed") === false;
    e.currentTarget.setAttribute("aria-expanded", open);
    if (open) opened.add(o.key); else opened.delete(o.key);
  });
  const item = (el) => o.items.find((x) => String(x.id) === el.closest("[data-id]").dataset.id);
  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); reload(); } catch (e) { toast(e.message, true); reload(); } };
  // rename: saves when you leave the box (or press Enter); Esc puts the old name back
  $$(".ls-edit", card).forEach((inp) => {
    const it = item(inp);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      if (e.key === "Escape") { inp.value = it.name; inp.blur(); }
    });
    inp.addEventListener("blur", () => {
      const v = inp.value.trim();
      if (!v) { inp.value = it.name; return; }
      if (v !== it.name) run(() => o.rename(it, v), "Renamed");
    });
  });
  $$(".ls-subedit", card).forEach((inp) => {
    const it = item(inp), was = it.description || "";
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      if (e.key === "Escape") { inp.value = was; inp.blur(); }
    });
    inp.addEventListener("blur", () => { if (inp.value.trim() !== was) run(() => o.describe(it, inp.value.trim()), "Description saved"); });
  });
  $$(".sw", card).forEach((b) => b.addEventListener("click", () => {
    const it = item(b);
    run(() => o.toggle(it, it.active === false), it.active === false ? `${it.name} is shown again` : `${it.name} is hidden from the form`);
  }));
  $$(".ls-del button", card).forEach((b) => b.addEventListener("click", async () => {
    const it = item(b);
    if (await confirmDialog(`Delete “${it.name}”?`, "It's unused, so nothing else changes. This can't be undone.")) run(() => o.remove(it), "Deleted");
  }));
  const form = $(".ls-addform", card), open = $(".ls-add", card);
  open.addEventListener("click", () => { open.classList.add("hidden"); form.classList.remove("hidden"); $("[name=name]", form).focus(); });
  $("[data-cancel]", form).addEventListener("click", () => { form.classList.add("hidden"); open.classList.remove("hidden"); form.reset(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form).entries());
    if (!v.name.trim()) return $("[name=name]", form).focus();
    opened.add(o.key);                         // show the whole list, so the new one is visible
    run(() => o.add(v), `Added ${v.name.trim()}`);
  });
}

function show(body, cards, wide = false) {
  body.innerHTML = `<div class="${wide ? "ls-grid" : "ls-one"}">${cards.map((c) => c.html).join("")}</div>`;
  cards.forEach((c) => c.bind(body));
}

// ---------------------------------------------------------------- the four lists

function categories(body, list) {
  const card = (kind) => listCard({
    key: kind, title: kind === "expense" ? "Expense" : "Income", cls: kind === "expense" ? "c-expense" : "c-income", unit: "transaction",
    items: list.filter((c) => c.kind === kind).map((c) => ({ ...c, locked: c.is_system, lockToggle: c.is_system, note: c.is_system ? "automatic" : "", sub: c.description || "" })),
    addLabel: `Add ${kind} category`,
    rename: (it, name) => api.updateMaster("categories", it.id, { name }),
    describe: (it, description) => api.updateMaster("categories", it.id, { description }),
    toggle: (it, on) => api.updateMaster("categories", it.id, { active: on }),
    remove: (it) => api.deleteMaster("categories", it.id),
    add: (v) => api.createMaster("categories", { name: v.name.trim(), kind }),
  });
  show(body, [card("expense"), card("income")], true);
}

function paymentModes(body, list) {
  show(body, [listCard({
    key: "modes", title: "Payment modes", unit: "transaction", items: list, addLabel: "Add payment mode",
    rename: (it, name) => api.updateMaster("payment_modes", it.id, { name }),
    toggle: (it, on) => api.updateMaster("payment_modes", it.id, { active: on }),
    remove: (it) => api.deleteMaster("payment_modes", it.id),
    add: (v) => api.createMaster("payment_modes", { name: v.name.trim() }),
  })]);
}

const LOAN_LIKE = { personal: "Works like a loan", cc_emi: "Works like a card EMI" };
async function loanTypes(body) {
  const own = await api.loanTypes();
  const built = [["Credit card EMI", "cc_emi"], ["Personal loan", "personal"], ["Other loan", "personal"]]
    .map(([name, w], i) => ({ id: `b${i}`, name, locked: true, note: "built in", sub: LOAN_LIKE[w] }));
  show(body, [listCard({
    key: "loans", title: "Loan types", help: "loan_works_like", unit: "loan", max: 40,
    items: [...built, ...own.map((t) => ({ ...t, sub: LOAN_LIKE[t.works_like] }))],
    addLabel: "Add loan type",
    addExtra: `<select name="works_like" aria-label="Works like"><option value="personal">Works like a loan</option><option value="cc_emi">Works like a card EMI</option></select>`,
    rename: (it, name) => api.renameLoanType(it.id, { name }),
    remove: (it) => api.deleteLoanType(it.id),
    add: (v) => api.addLoanType({ name: v.name.trim(), works_like: v.works_like }),
  })]);
}

async function investmentTypes(body) {
  const list = await api.investmentTypes();
  const LIKE = { share: "Stocks", fd: "Fixed deposit", rd: "Recurring deposit", ppf: "PPF", gold: "Gold", silver: "Silver", chitty: "Chit fund", other: "Simple holding" };
  show(body, [listCard({
    key: "inv", title: "Investment types", help: "inv_works_like", unit: "investment", max: 40,
    items: list.map((t) => ({ ...t, locked: t.fixed, sub: t.fixed ? "" : `Works like ${LIKE[t.works_like]}` })),
    addLabel: "Add investment type",
    addExtra: `<select name="works_like" aria-label="Works like">${Object.entries(LIKE).map(([k, v]) => `<option value="${k}">Works like ${v}</option>`).join("")}</select>`,
    rename: (it, name) => api.updateInvestmentType(it.id, { name }),
    toggle: (it, on) => api.updateInvestmentType(it.id, { active: on }),
    remove: (it) => api.deleteInvestmentType(it.id),
    add: (v) => api.addInvestmentType({ name: v.name.trim(), works_like: v.works_like }),
  })]);
}

// ---------------------------------------------------------------- about

async function about(body) {
  const i = await api.info();
  const range = i.entries ? `${dateLabel(i.first_entry)} – ${dateLabel(i.last_entry)}` : "No transactions yet";
  const I = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const point = (icon, title, text) => `<div class="ab-point"><span class="ab-pi">${I(icon)}</span><div><b>${title}</b><p>${text}</p></div></div>`;
  const path = (label, value) => `<div class="ab-path"><span>${label}</span><code>${esc(value)}</code>
      <button type="button" class="btn btn-sm" data-copy="${esc(value)}">Copy</button></div>`;
  body.innerHTML = `
    <section class="ab-hero">
      <span class="ab-mark">₹</span>
      <div><h2>Kanakku Pusthakam <small>Personal account book</small></h2>
        <p>Your personal money book: spending, income, investments, loans and budgets, in one place.</p>
        <span class="ab-ver">Version ${esc(i.app_version)}</span></div>
    </section>

    <section class="ab-local">
      <div class="ab-local-head">${I('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4"/>')}
        <div><h2>Your data stays on this computer</h2><p>Nothing is sent anywhere. No cloud, no account with any company, no tracking.</p></div></div>
      <div class="ab-points">
        ${point('<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M3 3l18 18"/>', "Works without internet", "Every screen, chart and export runs right here.")}
        ${point('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', "One file, yours", "Everything is saved in a single file on this computer.")}
        ${point('<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>', "Backups you control", "Copied automatically every week, and to a pen drive whenever you choose.")}
        ${point('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', "Locked with two steps", "Your password plus a code from your phone.")}
      </div>
    </section>

    <div class="grid grid-3 ab-stats">
      <div class="panel kpi"><div class="kpi-label">Transactions recorded</div><div class="kpi-value">${i.entries.toLocaleString("en-IN")}</div></div>
      <div class="panel kpi"><div class="kpi-label">Dates covered</div><div class="kpi-value ab-small">${esc(range)}</div></div>
      <div class="panel kpi"><div class="kpi-label">Database version</div><div class="kpi-value">${i.schema_version}</div></div>
    </div>

    <section class="panel ab-paths">
      <div class="panel-head"><h2>Where it's kept</h2></div>
      ${path("Your data", i.db_path)}
      ${path("Automatic backups", i.backup_dir)}
    </section>`;
  $$("[data-copy]", body).forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch { toast("Select the text to copy it", true); }
  }));
}

// ---------------------------------------------------------------- backups

const BK_ICON = (d, size = 17) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const BK_KIND = {
  daily: ["Automatic", "var(--income)", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  weekly: ["Automatic", "var(--income)", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],      // the same daily backup, kept longer
  "pre-migration": ["Before an update", "var(--invest)", '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'],
  "pre-restore": ["Before a restore", "var(--expense)", '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'],
  manual: ["Made by you", "var(--ink-2)", '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>'],
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Today, 1:04 PM" / "Yesterday, 9:12 AM" / "Fri 20 Nov, 8:40 PM" */
function whenLabel(created) {
  const [d, t] = created.split(" ");
  const time = stamp(created).split(", ")[1] || t;
  const today = todayISO(), y = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  if (d === today) return `Today, ${time}`;
  if (d === y) return `Yesterday, ${time}`;
  return `${DAYS[new Date(d + "T12:00").getDay()].slice(0, 3)} ${dateLabel(d).replace(/ \d{4}$/, "")}, ${time}`;
}

async function data(body) {
  const [sys, backups] = await Promise.all([api.info(), api.backups()]);
  const today = todayISO(), weekAgo = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10);
  const count = (k) => backups.filter((b) => b.kind === k).length;
  const total = backups.reduce((a, b) => a + b.size_kb, 0);
  const last = backups[0];
  const row = (b) => {
    const [label, color, icon] = BK_KIND[b.kind] || BK_KIND.manual;
    const d = b.created.split(" ")[0];
    return `<div class="bk-row"><span class="bk-dot" style="--c:${color}">${BK_ICON(icon)}</span>
      <span class="bk-when"><b>${esc(whenLabel(b.created))}</b><small>${d >= weekAgo ? DAYS[new Date(d + "T12:00").getDay()] : esc(dateLabel(d))}</small></span>
      <span class="bk-kind" style="--c:${color}">${label}</span>
      <span class="bk-size">${b.size_kb >= 1024 ? (b.size_kb / 1024).toFixed(1) + " MB" : Math.round(b.size_kb) + " KB"}</span>
      <button class="btn btn-sm" data-restore="${esc(b.file)}">Restore</button></div>`;
  };
  const recent = backups.filter((b) => b.created.slice(0, 10) >= weekAgo), older = backups.filter((b) => b.created.slice(0, 10) < weekAgo);
  const auto = count("daily") + count("weekly");
  const chips = [[auto, "automatic"], [count("pre-migration"), "before updates"], [count("pre-restore"), "before restores"], [count("manual"), "made by you"]]
    .filter(([n]) => n).map(([n, t]) => `<span class="bk-chip">${n} ${t}</span>`).join("");
  body.innerHTML = `
    <section class="bk-hero ${last ? "" : "none"}">${BK_ICON('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', 26)}
      <div><h2>${last ? "Your data is backed up" : "No backups yet"}</h2>
        <p>${last ? `Last backup <b>${esc(whenLabel(last.created))}</b>. ` : ""}A new one is made at your first login each day, if anything changed.</p>
        ${chips ? `<div class="bk-chips">${chips}<span class="bk-chip">${total >= 1024 ? (total / 1024).toFixed(1) + " MB" : Math.round(total) + " KB"} in all</span></div>` : ""}</div>
      <button type="button" class="btn btn-primary" id="bk-now">Back up now</button></section>

    <div class="bk-grid">
      <div class="bk-side">
        <section class="panel panel-pad">
          <h2 class="h2-info">Back up to a folder ${info("backup_folder")}</h2>
          <form id="bk-form" novalidate>
            <div class="bk-step"><div class="field" data-field="path"><label class="req">Folder (full path)</label>
              <input name="path" id="bk-path" value="${esc(sys.backup_folder || "")}" placeholder="e.g. /home/you/Backups or a pen drive" autocomplete="off" spellcheck="false">
              <div class="err hidden"></div></div>
              <button class="btn btn-primary">Back up</button></div>
          </form>
          <p class="bk-note">${sys.backup_folder_at ? `Last backed up here <b>${esc(stamp(sys.backup_folder_at))}</b>.` : "A pen drive or another disk is safest: the copy survives even if this computer fails."}</p>
        </section>

        <section class="panel panel-pad bk-danger">
          <h2 class="h2-info">Restore from a file ${info("restore_file")}</h2>
          <p class="bk-note" style="margin:0 0 12px">Replaces <b>all</b> your data with the file you choose. Your current data is saved first.</p>
          <form id="rs-form" class="stack" style="gap:10px" novalidate>
            <div class="field" data-field="file"><label class="req">Backup file (.db)</label>
              <input type="file" name="file" accept=".db,application/x-sqlite3,application/vnd.sqlite3"><div class="err hidden"></div></div>
            <div class="bk-step"><div class="field" data-field="password"><label class="req">Your password</label>
              <input type="password" name="password" autocomplete="current-password"><div class="err hidden"></div></div>
              <button class="btn btn-danger">Restore</button></div>
          </form>
        </section>
      </div>

      <section class="panel bk-list">
        <div class="panel-head"><h2 class="h2-info">Saved backups ${info("auto_backups")}</h2></div>
        ${recent.length ? `<div class="bk-gh">This week</div>${recent.map(row).join("")}` : ""}
        ${older.length ? `<div class="bk-gh">Earlier</div>${older.map(row).join("")}` : ""}
        ${backups.length ? "" : `<div class="ls-empty small faint">No backups yet</div>`}
      </section>
    </div>`;

  const clearErr = (form) => $$(".field", form).forEach((f) => { f.classList.remove("has-error"); $(".err", f)?.classList.add("hidden"); });
  const showErr = (form, e) => {
    clearErr(form);
    const f = e.field && $(`[data-field="${e.field}"]`, form);
    if (f) { f.classList.add("has-error"); const el = $(".err", f); el.textContent = e.message; el.classList.remove("hidden"); }
    else toast(e.message, true);
  };

  $("#bk-now").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try { await api.backupNow(); toast("Backed up"); data(body); } catch (err) { toast(err.message, true); e.currentTarget.disabled = false; }
  });

  $("#bk-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("button", ev.target); btn.disabled = true;
    try {
      const r = await api.backupTo($("#bk-path").value);
      clearErr(ev.target);
      toast(`Backed up to ${r.file}`);
      data(body);
    } catch (e) { showErr(ev.target, e); btn.disabled = false; }
  });

  const afterRestore = (r) => {
    toast(`Restored. Your previous data was saved as ${r.saved_current_as}. Please log in again.`);
    setTimeout(() => { location.hash = "#/dashboard"; location.reload(); }, 1800);
  };

  $("#rs-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target, fd = new FormData(form);
    if (!form.file.files.length) return showErr(form, { field: "file", message: "Choose the backup file" });
    if (!fd.get("password")) return showErr(form, { field: "password", message: "Enter your password" });
    if (!(await confirmDialog("Restore this backup?", `All current data will be replaced with ${form.file.files[0].name}. Your current data is saved first.`, "Restore"))) return;
    const btn = $(".btn-danger", form); btn.disabled = true;
    try { afterRestore(await api.restoreUpload(fd)); } catch (e) { showErr(form, e); btn.disabled = false; }
  });

  $$("[data-restore]", body).forEach((b) => b.addEventListener("click", async () => {
    const name = b.dataset.restore;
    const item = backups.find((x) => x.file === name);
    const pw = await modal({
      title: "Restore this backup?",
      body: `<p class="small muted" style="margin:0">All current data will be replaced with the backup from <b>${esc(item ? whenLabel(item.created) : name)}</b>.
        Your current data is saved first, so you can undo this.</p>
        <div class="field"><label class="req">Your password</label><input type="password" name="password" autocomplete="current-password"></div>`,
      submitLabel: "Restore",
      onSubmit: async (v) => {
        if (!v.password) throw new Error("Enter your password");
        return api.restoreBackup(name, v.password);
      },
    });
    if (pw) afterRestore(pw);
  }));
}

// ---------------------------------------------------------------- security

const PRESETS = {
  gmail: { label: "Gmail", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_security: "starttls" },
  outlook: { label: "Outlook / Hotmail", smtp_host: "smtp-mail.outlook.com", smtp_port: 587, smtp_security: "starttls" },
  zoho: { label: "Zoho Mail", smtp_host: "smtp.zoho.in", smtp_port: 465, smtp_security: "ssl" },
};

function secField(name, label, value = "", type = "text", extra = "") {
  const req = ["smtp_host", "smtp_port", "smtp_user"].includes(name);
  return `<div class="field" data-field="${name}"><label class="${req ? "req" : ""}">${label}</label>
    <input name="${name}" type="${type}" value="${esc(value)}" ${extra}><div class="err hidden"></div></div>`;
}

function bindForm(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.querySelectorAll(".field").forEach((f) => { f.classList.remove("has-error"); $(".err", f)?.classList.add("hidden"); });
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form).entries()));
    } catch (err) {
      const f = err.field && form.querySelector(`[data-field="${err.field}"]`);
      if (f) { f.classList.add("has-error"); const el = $(".err", f); el.textContent = err.message; el.classList.remove("hidden"); }
      else toast(err.message, true);
    } finally { btn.disabled = false; }
  });
}

const SEC_ICON = (d, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const EYE = '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
const IDLE_CHOICES = [[5, "5 min"], [15, "15 min"], [30, "30 min"], [60, "1 hour"]];

/** A password box with a show / hide eye. */
function pwField(name, label, auto) {
  return `<div class="field" data-field="${name}"><label>${label}</label><div class="sc-pw">
    <input name="${name}" type="password" autocomplete="${auto}"><button type="button" class="sc-eye" aria-label="Show password" title="Show">${SEC_ICON(EYE, 17)}</button></div>
    <div class="err hidden"></div></div>`;
}

/** How strong a new password looks, by the same rules the app checks (plus length and variety for the meter). */
function strength(pw) {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const rules = { long: pw.length >= 10, mix: !!pw && !/^\d+$/.test(pw) && !/^[a-z]+$/.test(pw) };
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (kinds >= 2) score++;
  if (kinds >= 3 || pw.length >= 16) score++;
  if (!rules.long || !rules.mix) score = Math.min(score, 1);
  return { score, rules, label: ["Too weak", "Weak", "Fair", "Good", "Strong"][score] };
}

async function security(body) {
  const s = await api.security();
  const m = s.mail;
  const card = (color, icon, title, sub, help, inner) => `<section class="panel sc-card">
      <h2><span class="sc-ic" style="--c:${color}">${SEC_ICON(icon)}</span>${title}${info(help)}</h2>
      <p class="sc-sub">${sub}</p>${inner}</section>`;
  const idleCustom = !IDLE_CHOICES.some(([v]) => v === s.idle_minutes);
  body.innerHTML = `
    <section class="sc-hero">${SEC_ICON('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', 26)}
      <div><h2>Your app is protected</h2>
        <p>Logged in as <b>${esc(s.email)}</b>${s.last_login_at ? ` | last login ${esc(stamp(s.last_login_at))}` : ""}</p>
        <div class="sc-checks"><span class="sc-ok on">✓ Password set</span><span class="sc-ok on">✓ Authenticator on</span>
          <span class="sc-ok on">✓ Auto-logout ${s.idle_minutes >= 60 && s.idle_minutes % 60 === 0 ? `${s.idle_minutes / 60} hour${s.idle_minutes > 60 ? "s" : ""}` : `${s.idle_minutes} min`}</span>
          <span class="sc-ok ${m.configured ? "on" : "off"}">${m.configured ? "✓ Reset email set up" : "! Reset email not set up"}</span></div></div>
    </section>

    <div class="sc-grid">
      <div class="stack">
        ${card("var(--link)", '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', "Password",
          "Changing it signs out other open logins.", "sec_password", `
          <form id="pw-form" novalidate>
            ${pwField("current", "Current password", "current-password")}
            ${pwField("new", "New password", "new-password")}
            <div class="sc-meter" id="pw-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <div class="sc-strength" id="pw-label">&nbsp;</div>
            <ul class="sc-rules" id="pw-rules"><li data-r="long">10 or more characters</li><li data-r="mix">Not only numbers or only small letters</li></ul>
            ${pwField("confirm", "Repeat new password", "new-password")}
            <button type="submit" class="btn btn-primary">Change password</button>
          </form>`)}
        ${card("var(--transfer)", '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', "Login email",
          "The address you log in with, and where reset links go.", "sec_email", `
          <div class="sc-row first"><div><b>${esc(s.email)}</b><small>Changing it needs your password</small></div>
            <button type="button" class="btn btn-sm" data-open="email-form">Change</button></div>
          <form id="email-form" class="sc-fold hidden" novalidate>
            ${secField("email", "New email", s.email, "email")}
            ${pwField("password", "Confirm with your password", "current-password")}
            <div class="toolbar"><button type="submit" class="btn btn-primary">Change email</button><button type="button" class="btn btn-ghost" data-close="email-form">Cancel</button></div>
          </form>`)}
      </div>
      <div class="stack">
        ${card("var(--income)", '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', "Authenticator app",
          "Every login needs a 6-digit code from your phone.", "sec_mfa", `
          <div class="sc-row first"><div><b><span class="status-pill on">On</span> Paired with your phone</b><small>New phone? Pair it here; the old one stops working.</small></div>
            <a class="btn btn-sm" href="#/new-authenticator">Set up new phone</a></div>`)}
        ${card("var(--invest)", '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>', "Auto-logout",
          "After this long with no mouse, keyboard or scrolling.", "sec_idle", `
          <div class="sc-seg" id="idle-seg">${IDLE_CHOICES.map(([v, l]) => `<button type="button" data-min="${v}" class="${v === s.idle_minutes ? "on" : ""}">${l}</button>`).join("")}
            <button type="button" data-min="custom" class="${idleCustom ? "on" : ""}">${idleCustom ? `${s.idle_minutes} min` : "Custom…"}</button></div>
          <form id="idle-form" class="sc-fold hidden" novalidate>
            <div class="bk-step">${secField("minutes", "Minutes (5 to 1440)", s.idle_minutes, "number", 'min="5" max="1440"')}
              <button type="submit" class="btn btn-primary">Save</button></div>
          </form>`)}
        ${card("var(--redeem)", '<path d="M4 4h16v16H4z"/><path d="M4 8l8 5 8-5"/>', "Email for password reset",
          `<span class="status-pill ${m.configured ? "on" : "off"}">${m.configured ? "Set up" : "Not set up"}</span> Optional: lets <b>Forgot password</b> email you a link.`, "sec_mail", `
          <div class="sc-row first"><div>${m.configured
              ? `<b>Sends from ${esc(m.smtp_user || m.smtp_from || "")}</b><small>${esc(m.smtp_host)}:${esc(m.smtp_port)}</small>`
              : `<b>Gmail, Outlook or your own mail server</b><small>Takes about 2 minutes with an app password.</small>`}</div>
            <span class="toolbar">${m.configured ? `<button type="button" class="btn btn-sm" id="mail-test">Send test email</button>` : ""}
              <button type="button" class="btn btn-sm ${m.configured ? "" : "btn-primary"}" data-open="mail-form">${m.configured ? "Edit" : "Set up"}</button></span></div>
          <form id="mail-form" class="sc-fold hidden" novalidate>
            <div class="field"><label>Provider</label>
              <select id="preset"><option value="">Choose to fill in…</option>
                ${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join("")}</select></div>
            <div class="row2">
              ${secField("smtp_host", "SMTP server", m.smtp_host, "text", 'placeholder="smtp.gmail.com"')}
              ${secField("smtp_port", "Port", m.smtp_port, "number")}
            </div>
            <div class="field" data-field="smtp_security"><label>Security</label>
              <select name="smtp_security">${["starttls", "ssl", "none"].map((v) => `<option value="${v}" ${m.smtp_security === v ? "selected" : ""}>${v === "starttls" ? "STARTTLS (587)" : v === "ssl" ? "SSL/TLS (465)" : "None"}</option>`).join("")}</select>
              <div class="err hidden"></div></div>
            ${secField("smtp_user", "Email account (login)", m.smtp_user, "email", 'placeholder="you@gmail.com" autocomplete="off"')}
            ${secField("smtp_password", "App password", "", "password", `autocomplete="new-password" placeholder="${m.password_set ? "Saved. Leave blank to keep it" : "16-character app password"}"`)}
            ${secField("smtp_from", "Send as", m.smtp_from, "text", 'placeholder="Kanakku Pusthakam <you@gmail.com>"')}
            <details class="small muted"><summary>How to get a Gmail app password</summary>
              <ol style="padding-left:18px;margin:8px 0">
                <li>Turn on 2-Step Verification in your Google Account.</li>
                <li>Go to <b>Google Account → Security → App passwords</b>.</li>
                <li>Create one named "Kanakku Pusthakam" and paste the 16-character password here.</li>
              </ol>Your normal Gmail password won't work here. The app password is stored only in your local database.</details>
            <div class="toolbar"><button type="submit" class="btn btn-primary">Save email settings</button><button type="button" class="btn btn-ghost" data-close="mail-form">Cancel</button></div>
          </form>`)}
      </div>
    </div>`;

  // fold-away forms: Change / Edit / Set up open them, Cancel closes them
  $$("[data-open]", body).forEach((b) => b.addEventListener("click", () => {
    const f = $(`#${b.dataset.open}`); f.classList.remove("hidden"); b.classList.add("hidden");
    $("input, select", f)?.focus();
  }));
  $$("[data-close]", body).forEach((b) => b.addEventListener("click", () => {
    $(`#${b.dataset.close}`).classList.add("hidden"); $(`[data-open="${b.dataset.close}"]`, body)?.classList.remove("hidden");
  }));
  // show / hide a password
  $$(".sc-eye", body).forEach((b) => b.addEventListener("click", () => {
    const inp = b.previousElementSibling, show = inp.type === "password";
    inp.type = show ? "text" : "password";
    b.innerHTML = SEC_ICON(show ? EYE_OFF : EYE, 17);
    b.setAttribute("aria-label", show ? "Hide password" : "Show password"); b.title = show ? "Hide" : "Show";
  }));
  // strength meter for the new password
  const paint = () => {
    const pw = $("#pw-form [name=new]").value, st = strength(pw);
    $$("#pw-meter i").forEach((i, n) => { i.className = pw && n < Math.max(st.score, 1) ? `s${Math.max(st.score, 1)}` : ""; });
    $("#pw-label").textContent = pw ? st.label : " ";
    $("#pw-label").className = `sc-strength s${Math.max(st.score, 1)}`;
    $$("#pw-rules li").forEach((li) => li.classList.toggle("y", st.rules[li.dataset.r]));
  };
  $("#pw-form [name=new]").addEventListener("input", paint);

  bindForm($("#pw-form"), async (d) => {
    await api.changePassword(d);
    toast("Password changed");
    $("#pw-form").reset(); paint();
  });
  const saveIdle = async (minutes) => {
    const r = await api.setIdle(minutes);
    setIdleMinutes(r.idle_minutes);
    toast(`Auto-logout after ${r.idle_minutes} minutes of inactivity`);
    reload();
  };
  $$("#idle-seg button", body).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.min === "custom") { $("#idle-form").classList.remove("hidden"); $("#idle-form input").focus(); return; }
    saveIdle(+b.dataset.min).catch((e) => toast(e.message, true));
  }));
  bindForm($("#idle-form"), (d) => saveIdle(d.minutes));
  bindForm($("#email-form"), async (d) => {
    await api.changeEmail(d);
    toast("Login email changed");
    reload();
  });
  $("#preset").addEventListener("change", (e) => {
    const p = PRESETS[e.target.value];
    if (!p) return;
    const f = $("#mail-form");
    f.smtp_host.value = p.smtp_host; f.smtp_port.value = p.smtp_port; f.smtp_security.value = p.smtp_security;
    if (!f.smtp_user.value) f.smtp_user.value = s.email;
  });
  bindForm($("#mail-form"), async (d) => {
    const r = await api.saveMail(d);
    toast(r.configured ? "Email settings saved. Send a test email to check." : "Saved, but still incomplete");
    reload();
  });
  $("#mail-test")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Sending…";
    try { const r = await api.testMail(); toast(r.message); }
    catch (err) { toast(err.message, true); }
    finally { b.disabled = false; b.textContent = "Send test email"; }
  });
}

