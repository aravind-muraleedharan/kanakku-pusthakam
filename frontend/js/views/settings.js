// Settings: categories, payment modes, security (login, authenticator, email), backups and export.
import { api } from "../api.js";
import { invalidateMasters, masters } from "../state.js";
import { $, $$, confirmDialog, dateLabel, esc, KIND_LABEL, modal, toast } from "../util.js";

const SECTIONS = {
  categories: "Categories",
  payment_modes: "Payment modes",
  security: "Security",
  data: "Backup & export",
};

export async function render(params) {
  if (params.s === "accounts") { location.hash = "#/money"; return; }
  const sec = SECTIONS[params.s] ? params.s : "categories";
  const M = await masters(true);
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub small muted">Add, rename or deactivate items. Deactivated items are hidden from the form but past transactions keep them.</div></div></div>
    <div class="tabs">${Object.entries(SECTIONS).map(([k, l]) => `<button data-s="${k}" class="${k === sec ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="set-body"></div>`;
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => { location.hash = `#/settings?s=${b.dataset.s}`; }));
  const body = $("#set-body");
  if (sec === "categories") categories(body, M.categories);
  if (sec === "payment_modes") simple(body, "payment_modes", M.payment_modes, "Payment mode");
  if (sec === "security") await security(body);
  if (sec === "data") await data(body);
}

const reload = () => { invalidateMasters(); render(Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""))); };

async function saveRow(table, id, payload) {
  try {
    await api.updateMaster(table, id, payload);
    toast("Saved");
    reload();
  } catch (e) { toast(e.message, true); }
}

async function deleteRow(table, item) {
  const ok = await confirmDialog(`Delete “${item.name}”?`, "This can't be undone.");
  if (!ok) return;
  try {
    await api.deleteMaster(table, item.id);
    toast("Deleted");
    reload();
  } catch (e) { toast(e.message, true); }
}

async function addRow(table, payload) {
  try {
    const created = await api.createMaster(table, payload);
    toast(`Added ${created.name}`);
    reload();
  } catch (e) { toast(e.message, true); }
}

function rowActions(item) {
  return `<td style="white-space:nowrap" class="right">
    <button class="btn btn-sm" data-save="${item.id}">Save</button>
    ${item.used ? "" : `<button class="btn btn-sm btn-ghost btn-danger" data-del="${item.id}" title="Delete">✕</button>`}
  </td>`;
}

function categories(body, list) {
  const block = (kind) => {
    const items = list.filter((c) => c.kind === kind);
    return `<section class="panel" style="margin-bottom:16px">
      <div class="panel-head" style="padding-bottom:12px"><h2>${kind === "expense" ? "Expense" : "Income"} categories</h2><span class="small faint">${items.length}</span></div>
      <div class="table-wrap"><table class="master-table">
        <thead><tr><th>Name</th><th class="hide-sm">Description</th><th>Active</th><th class="num">Transactions</th><th></th></tr></thead>
        <tbody>${items.map((c) => c.is_system ? `
          <tr><td><b>${esc(c.name)}</b></td><td class="hide-sm small muted">${esc(c.description || "")}</td><td>✓</td><td class="num muted">${c.used}</td><td class="small faint right">automatic</td></tr>` : `
          <tr data-id="${c.id}" class="${c.active ? "" : "inactive"}">
            <td><input type="text" name="name" value="${esc(c.name)}" maxlength="80"></td>
            <td class="hide-sm"><input type="text" name="description" value="${esc(c.description || "")}" placeholder="What goes here"></td>
            <td><input type="checkbox" name="active" ${c.active ? "checked" : ""}></td>
            <td class="num muted">${c.used}</td>
            ${rowActions(c)}
          </tr>`).join("")}</tbody>
      </table></div>
      <form class="add-row" data-kind="${kind}">
        <input type="text" name="name" placeholder="New ${kind} category" required maxlength="80">
        <input type="text" name="description" placeholder="Description" class="hide-sm">
        <button class="btn btn-primary">Add</button>
      </form>
    </section>`;
  };
  body.innerHTML = block("expense") + block("income");
  bindTable(body, "categories", list, (tr) => ({
    name: $("[name=name]", tr).value, description: $("[name=description]", tr).value, active: $("[name=active]", tr).checked,
  }));
  $$("form[data-kind]", body).forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    addRow("categories", { ...Object.fromEntries(new FormData(f).entries()), kind: f.dataset.kind });
  }));
}

function simple(body, table, list, label) {
  body.innerHTML = `
    <section class="panel" style="max-width:640px">
      <div class="table-wrap"><table class="master-table">
        <thead><tr><th>Name</th><th>Active</th><th class="num">Transactions</th><th></th></tr></thead>
        <tbody>${list.map((m) => `
          <tr data-id="${m.id}" class="${m.active ? "" : "inactive"}">
            <td><input type="text" name="name" value="${esc(m.name)}" maxlength="80"></td>
            <td><input type="checkbox" name="active" ${m.active ? "checked" : ""}></td>
            <td class="num muted">${m.used}</td>
            ${rowActions(m)}
          </tr>`).join("")}</tbody>
      </table></div>
      <form class="add-row" id="add-form">
        <input type="text" name="name" placeholder="New ${label.toLowerCase()}" required maxlength="80">
        <button class="btn btn-primary">Add</button>
      </form>
    </section>`;
  bindTable(body, table, list, (tr) => ({ name: $("[name=name]", tr).value, active: $("[name=active]", tr).checked }));
  $("#add-form").addEventListener("submit", (e) => { e.preventDefault(); addRow(table, Object.fromEntries(new FormData(e.target).entries())); });
}

function bindTable(body, table, list, read) {
  $$("[data-save]", body).forEach((b) => b.addEventListener("click", () => {
    const tr = b.closest("tr");
    saveRow(table, +b.dataset.save, read(tr));
  }));
  $$("[data-del]", body).forEach((b) => b.addEventListener("click", () => {
    deleteRow(table, list.find((x) => x.id === +b.dataset.del));
  }));
  // Enter in a row's input saves that row
  $$("tbody input[type=text], tbody input[type=number]", body).forEach((inp) => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("[data-save]", inp.closest("tr"))?.click(); }
  }));
}

async function data(body) {
  const [info, backups] = await Promise.all([api.info(), api.backups()]);
  const range = info.entries ? `${esc(dateLabel(info.first_entry))} – ${esc(dateLabel(info.last_entry))}` : "No transactions yet";
  body.innerHTML = `
    <div class="grid grid-2">
      <div class="stack">
        <section class="panel panel-pad">
          <h2>Your database</h2>
          <table style="margin-top:10px"><tbody>
            <tr><td class="muted">Transactions recorded</td><td class="num">${info.entries.toLocaleString("en-IN")}</td></tr>
            <tr><td class="muted">Dates covered</td><td class="num">${range}</td></tr>
            <tr><td class="muted">Stored at</td><td class="small" style="word-break:break-all">${esc(info.db_path)}</td></tr>
            <tr><td class="muted">Version</td><td class="small">App ${esc(info.app_version)} · database ${info.schema_version}</td></tr>
          </tbody></table>
          <div class="form-actions"><a class="btn" href="${api.exportUrl({})}">Export all transactions (CSV)</a></div>
        </section>

        <section class="panel panel-pad">
          <h2>Back up to a folder</h2>
          <p class="small muted" style="margin:6px 0 12px">Saves a copy of your database there, named with today's date and time.
            A pen drive or another disk keeps a copy safe even if this computer fails.</p>
          <form id="bk-form" class="stack" style="gap:10px" novalidate>
            <div class="field" data-field="path"><label class="req">Folder (full path)</label>
              <input name="path" id="bk-path" value="${esc(info.backup_folder || "")}" placeholder="e.g. /media/you/PENDRIVE/Backups" autocomplete="off" spellcheck="false">
              <div class="err hidden"></div></div>
            <div><button class="btn btn-primary">Back up now</button></div>
          </form>
        </section>

        <section class="panel panel-pad">
          <h2>Restore from a file</h2>
          <p class="small muted" style="margin:6px 0 12px">Replaces <b>all</b> your current data with the backup file you choose.
            Your current data is saved to the backups list first, so you can undo it.</p>
          <form id="rs-form" class="stack" style="gap:10px" novalidate>
            <div class="field" data-field="file"><label class="req">Backup file (.db)</label>
              <input type="file" name="file" accept=".db,application/x-sqlite3,application/vnd.sqlite3"><div class="err hidden"></div></div>
            <div class="field" data-field="password"><label class="req">Your password</label>
              <input type="password" name="password" autocomplete="current-password"><div class="err hidden"></div></div>
            <div><button class="btn btn-danger">Restore</button></div>
          </form>
        </section>
      </div>

      <section class="panel panel-pad">
        <h2>Automatic backups <span class="faint small">· newest 10</span></h2>
        <p class="small muted" style="margin:6px 0 0">Made once a week (on the first start after 7 days), before any database upgrade, and before a restore.
          Only the newest 10 are kept; older ones are deleted automatically. They're in <code>${esc(info.backup_dir)}</code>.</p>
        <div class="table-wrap" style="margin-top:14px;max-height:520px;overflow:auto">
          <table><thead><tr><th>Backup</th><th class="num">Size</th><th></th></tr></thead>
          <tbody>${backups.map((b) => `<tr><td><div class="small">${esc(b.created)}</div><div class="cell-sub">${esc(kindOf(b.file))}</div></td>
            <td class="num small muted">${b.size_kb} KB</td>
            <td class="right"><button class="btn btn-sm" data-restore="${esc(b.file)}">Restore</button></td></tr>`).join("")
            || `<tr><td colspan="3" class="small faint">No backups yet</td></tr>`}</tbody></table>
        </div>
      </section>
    </div>`;

  const clearErr = (form) => $$(".field", form).forEach((f) => { f.classList.remove("has-error"); $(".err", f)?.classList.add("hidden"); });
  const showErr = (form, e) => {
    clearErr(form);
    const f = e.field && $(`[data-field="${e.field}"]`, form);
    if (f) { f.classList.add("has-error"); const el = $(".err", f); el.textContent = e.message; el.classList.remove("hidden"); }
    else toast(e.message, true);
  };

  $("#bk-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("button", ev.target); btn.disabled = true;
    try {
      const r = await api.backupTo($("#bk-path").value);
      clearErr(ev.target);
      toast(`Backed up to ${r.file}`);
    } catch (e) { showErr(ev.target, e); }
    btn.disabled = false;
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
    const btn = $("button", form); btn.disabled = true;
    try { afterRestore(await api.restoreUpload(fd)); } catch (e) { showErr(form, e); btn.disabled = false; }
  });

  $$("[data-restore]").forEach((b) => b.addEventListener("click", async () => {
    const name = b.dataset.restore;
    const pw = await modal({
      title: "Restore this backup?",
      body: `<p class="small muted" style="margin:0">All current data will be replaced with the backup from <b>${esc(backups.find((x) => x.file === name)?.created || name)}</b>.
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

function kindOf(file) {
  if (file.includes("_pre-restore")) return "Before a restore";
  if (file.includes("_pre-migration")) return "Before an app update";
  if (file.includes("_manual")) return "Made by you";
  if (file.includes("_auto")) return "Weekly automatic";
  return file;
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

async function security(body) {
  const s = await api.security();
  const m = s.mail;
  body.innerHTML = `
    <div class="sec-grid">
      <section class="panel panel-pad">
        <h2>Password</h2>
        <p class="small muted" style="margin:0">Logged in as <b>${esc(s.email)}</b>${s.last_login_at ? ` · last login ${esc(s.last_login_at)}` : ""}</p>
        <form id="pw-form" novalidate>
          ${secField("current", "Current password", "", "password", 'autocomplete="current-password"')}
          ${secField("new", "New password", "", "password", 'autocomplete="new-password"')}
          ${secField("confirm", "Repeat new password", "", "password", 'autocomplete="new-password"')}
          <div class="hint small faint">At least 10 characters. Other open logins are signed out.</div>
          <div><button type="submit" class="btn btn-primary">Change password</button></div>
        </form>
      </section>

      <section class="panel panel-pad">
        <h2>Authenticator app (MFA) <span class="status-pill on">On</span></h2>
        <p class="small muted">Every login needs a 6-digit code from your phone. Got a new phone? Pair it here; the old one stops working.</p>
        <a class="btn" href="#/new-authenticator">Set up on a new phone</a>
        <p class="small faint" style="margin:14px 0 0">Lost your phone? On this computer run <code>python3 run.py --reset-mfa</code>.</p>

        <h2 style="margin-top:22px">Auto-logout</h2>
        <form id="idle-form" novalidate style="flex-direction:row;align-items:flex-end;gap:10px">
          ${secField("minutes", "Log out after this many idle minutes", s.idle_minutes, "number", 'min="5" max="1440" style="max-width:120px"')}
          <button type="submit" class="btn">Save</button>
        </form>
      </section>

      <section class="panel panel-pad">
        <h2>Email for password reset <span class="status-pill ${m.configured ? "on" : "off"}">${m.configured ? "Set up" : "Not set up"}</span></h2>
        <p class="small muted" style="margin:0">"Forgot password" emails a reset link to <b>${esc(s.email)}</b> using this mail account.</p>
        <form id="mail-form" novalidate>
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
          <div class="toolbar"><button type="submit" class="btn btn-primary">Save email settings</button>
            <button type="button" class="btn" id="mail-test" ${m.configured ? "" : "disabled"}>Send test email</button></div>
        </form>
      </section>

      <section class="panel panel-pad">
        <h2>Login email</h2>
        <p class="small muted" style="margin:0">The address you log in with and where reset links go.</p>
        <form id="email-form" novalidate>
          ${secField("email", "Email", s.email, "email")}
          ${secField("password", "Confirm with your password", "", "password", 'autocomplete="current-password"')}
          <div><button type="submit" class="btn">Change email</button></div>
        </form>
        <div class="callout small" style="margin-top:16px">
          <strong>Good to know:</strong> the login protects the app. Your data file (<code>data/expenses.db</code>)
          is a normal file on this computer, so also keep your computer account password-protected.
        </div>
      </section>
    </div>`;

  bindForm($("#pw-form"), async (d) => {
    await api.changePassword(d);
    toast("Password changed");
    $("#pw-form").reset();
  });
  bindForm($("#idle-form"), async (d) => {
    const r = await api.setIdle(d.minutes);
    toast(`Auto-logout after ${r.idle_minutes} idle minutes`);
  });
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
  $("#mail-test").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Sending…";
    try { const r = await api.testMail(); toast(r.message); }
    catch (err) { toast(err.message, true); }
    finally { b.disabled = false; b.textContent = "Send test email"; }
  });
}
