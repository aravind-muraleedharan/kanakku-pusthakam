// Login, account creation, authenticator setup, forgot / reset password.
import { api } from "../api.js";
import { qrSvg } from "../vendor/qrcode.js";
import { $, esc, toast } from "../util.js";

const view = () => $("#view");

function shell(title, sub, body) {
  view().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-brand">
        <span class="brand-mark">₹</span>
        <span class="brand-name">Kanakku Pusthakam<small>Personal account book</small></span>
      </div>
      <div class="panel auth-card">
        <h1>${title}</h1>
        ${sub ? `<p class="muted small auth-sub">${sub}</p>` : ""}
        ${body}
      </div>
      <p class="faint small auth-foot">Runs only on this computer · your data never leaves it</p>
    </div>`;
}

function field(name, label, type = "text", extra = "") {
  return `<div class="field" data-field="${name}">
    <label for="a-${name}">${label}</label>
    <input id="a-${name}" name="${name}" type="${type}" ${extra}>
    <div class="err hidden"></div></div>`;
}

function codeField() {
  return field("code", "6-digit code", "text",
    'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" class="code-input" placeholder="000 000" required');
}

function showErr(form, err) {
  form.querySelectorAll(".field").forEach((f) => { f.classList.remove("has-error"); $(".err", f)?.classList.add("hidden"); });
  const f = err.field && form.querySelector(`[data-field="${err.field}"]`);
  if (f) {
    f.classList.add("has-error");
    const e = $(".err", f);
    e.textContent = err.message;
    e.classList.remove("hidden");
    $("input", f).focus();
  } else {
    const box = $(".form-err", form);
    box.textContent = err.message;
    box.classList.remove("hidden");
  }
}

function onSubmit(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    $(".form-err", form)?.classList.add("hidden");
    try {
      await handler(Object.fromEntries(new FormData(form).entries()));
    } catch (err) {
      showErr(form, err);
    } finally {
      btn.disabled = false;
    }
  });
}

const errBox = `<p class="form-err callout loss small hidden" role="alert"></p>`;
const pwHint = `<div class="hint">At least 10 characters, with letters and numbers or symbols.</div>`;

// ---------------------------------------------------------------- first run

export function renderRegister(done) {
  shell("Create your login", "Protect your account book with a password and your phone's authenticator app.", `
    <form id="f" class="stack" novalidate>
      ${field("email", "Email", "email", 'autocomplete="email" required')}
      <div class="hint" style="margin-top:-8px">Used to send you a password reset link.</div>
      ${field("password", "Password", "password", 'autocomplete="new-password" required')}
      ${pwHint}
      ${field("confirm", "Repeat password", "password", 'autocomplete="new-password" required')}
      ${errBox}
      <button type="submit" class="btn btn-primary btn-block">Continue</button>
    </form>`);
  $("#a-email").focus();
  onSubmit($("#f"), async (d) => { await api.register(d); done(); });
}

// ---------------------------------------------------------------- authenticator setup

export async function renderMfaSetup(done, { fromSettings = false } = {}) {
  const { secret, uri } = await api.mfaBegin();
  const pretty = secret.replace(/(.{4})/g, "$1 ").trim();
  const body = `
    <ol class="mfa-steps small">
      <li>Open <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or <b>Authy</b> on your phone and tap <b>+</b>.</li>
      <li>Scan this QR code.</li>
    </ol>
    <div class="qr-box">${qrSvg(uri, { size: 208 })}</div>
    <details class="small muted manual-key">
      <summary>Can't scan? Enter this key instead</summary>
      <code class="secret">${esc(pretty)}</code>
      <div class="faint">Account: Kanakku Pusthakam · Time based · 6 digits</div>
    </details>
    <form id="f" class="stack" novalidate style="margin-top:14px">
      ${codeField()}
      <div class="hint" style="margin-top:-8px">3. Type the 6-digit code the app now shows for Kanakku Pusthakam.</div>
      ${errBox}
      <button type="submit" class="btn btn-primary btn-block">Turn on and continue</button>
      ${fromSettings ? `<a class="btn btn-ghost btn-block" href="#/settings?s=security">Cancel</a>` : ""}
    </form>`;
  if (fromSettings) {
    view().innerHTML = `<div class="page-head"><div><h1>Set up authenticator on a new phone</h1>
      <div class="sub small muted">Your old phone's code stops working once you confirm.</div></div></div>
      <div class="panel auth-card" style="margin:0">${body}</div>`;
  } else {
    shell("Set up your authenticator", "Every login will ask for a 6-digit code from your phone.", body);
  }
  $("#a-code").focus();
  onSubmit($("#f"), async (d) => { await api.mfaConfirm(d.code); done(); });
}

// ---------------------------------------------------------------- login

export function renderLogin(done, { message } = {}) {
  shell("Log in", "", `
    ${message ? `<p class="callout gain small">${esc(message)}</p>` : ""}
    <form id="f" class="stack" novalidate>
      ${field("email", "Email", "email", 'autocomplete="username" required')}
      ${field("password", "Password", "password", 'autocomplete="current-password" required')}
      ${errBox}
      <button type="submit" class="btn btn-primary btn-block">Continue</button>
      <a class="small center-link" href="#/forgot">Forgot password?</a>
    </form>`);
  $("#a-email").focus();
  onSubmit($("#f"), async (d) => {
    const s = await api.login(d);
    if (s.state === "mfa") renderCode(done);
    else done();
  });
}

export function renderCode(done) {
  shell("Enter your code", "Open your authenticator app and type the 6-digit code for Kanakku Pusthakam.", `
    <form id="f" class="stack" novalidate>
      ${codeField()}
      ${errBox}
      <button type="submit" class="btn btn-primary btn-block">Log in</button>
      <a class="small center-link" href="#/login" id="back">← Use a different account</a>
    </form>
    <details class="small muted" style="margin-top:14px">
      <summary>Lost your phone?</summary>
      <p>On this computer, stop the app and run <code>python3 run.py --reset-mfa</code> in the app's folder.
      You'll log in with your password and scan a new QR code.</p>
    </details>`);
  const input = $("#a-code");
  input.focus();
  input.addEventListener("input", () => {
    if (input.value.replace(/\D/g, "").length === 6) $("#f").requestSubmit();
  });
  $("#back").addEventListener("click", async (e) => { e.preventDefault(); await api.logout().catch(() => {}); renderLogin(done); });
  onSubmit($("#f"), async (d) => { await api.loginCode(d.code); done(); });
}

// ---------------------------------------------------------------- forgot / reset

export async function renderForgot() {
  const st = await api.authStatus().catch(() => ({}));
  shell("Forgot password", "We'll email you a link to set a new password. You'll still need your authenticator code to log in.", `
    ${st.email_configured === false ? `<p class="callout small"><strong>Email isn't set up in this app yet.</strong>
      Reset from the terminal instead: stop the app, then in the app's folder run
      <code>python3 run.py --reset-password</code></p>` : ""}
    <form id="f" class="stack" novalidate>
      ${field("email", "Your email", "email", 'autocomplete="email" required')}
      ${errBox}
      <button type="submit" class="btn btn-primary btn-block">Send reset link</button>
      <a class="small center-link" href="#/login">← Back to log in</a>
    </form>
    <div id="sent" class="hidden"></div>`);
  $("#a-email").focus();
  onSubmit($("#f"), async (d) => {
    const r = await api.forgot(d.email);
    $("#f").classList.add("hidden");
    const sent = $("#sent");
    sent.classList.remove("hidden");
    sent.innerHTML = `<p class="callout gain small">${esc(r.message)}</p>
      <p class="small muted">Open the link on this computer. Didn't get it? Check spam, or wait a minute and try again.</p>
      <a class="btn btn-block" href="#/login">Back to log in</a>`;
  });
}

export async function renderReset(token, done) {
  try {
    await api.resetCheck(token);
  } catch (err) {
    shell("Link expired", "", `<p class="callout loss small">${esc(err.message)}</p>
      <a class="btn btn-primary btn-block" href="#/forgot">Send a new link</a>`);
    return;
  }
  shell("Set a new password", "", `
    <form id="f" class="stack" novalidate>
      ${field("password", "New password", "password", 'autocomplete="new-password" required')}
      ${pwHint}
      ${field("confirm", "Repeat new password", "password", 'autocomplete="new-password" required')}
      ${errBox}
      <button type="submit" class="btn btn-primary btn-block">Save new password</button>
    </form>`);
  $("#a-password").focus();
  onSubmit($("#f"), async (d) => {
    const r = await api.reset({ token, ...d });
    history.replaceState(null, "", "/#/login");          // drop the token from the address bar
    toast("Password changed");
    done(r.message);
  });
}
