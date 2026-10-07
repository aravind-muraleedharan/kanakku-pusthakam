// Hash router: #/dashboard, #/entries, #/add, #/edit/12, #/reports, #/settings
// Every screen except forgot/reset password requires a full login (password + authenticator code).
import { api } from "./api.js";
import { $, $$, esc, toast } from "./util.js";
import * as auth from "./views/auth.js";
import * as dashboard from "./views/dashboard.js";
import * as entries from "./views/entries.js";
import * as entryForm from "./views/entry-form.js";
import * as reports from "./views/reports.js";
import * as settings from "./views/settings.js";
import * as setup from "./views/setup.js";
import { initTheme } from "./theme.js";

const routes = {
  dashboard: (p) => dashboard.render(p),
  entries: (p) => entries.render(p),
  add: (p) => entryForm.render({ ...p }),
  edit: (p, id) => entryForm.render({ ...p, id }),
  reports: (p) => reports.render(p),
  settings: (p) => settings.render(p),
  setup: (p) => setup.render(p),
  "new-authenticator": () => auth.renderMfaSetup(() => { toast("Authenticator updated"); location.hash = "#/settings?s=security"; }, { fromSettings: true }),
};
const AUTH_ROUTES = ["login", "forgot", "reset"];

function parse() {
  const raw = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [path, query = ""] = raw.split("?");
  const [name, arg] = path.split("/");
  const known = routes[name] || AUTH_ROUTES.includes(name);
  return { name: known ? name : "dashboard", arg, params: Object.fromEntries(new URLSearchParams(query)) };
}

function authMode(on) {
  document.body.classList.toggle("auth-mode", on);
}

// after a successful login step: continue to where the user was going
function proceed(message) {
  const { name } = parse();
  if (AUTH_ROUTES.includes(name)) {
    if (message) { history.replaceState(null, "", "/#/login"); navigate({ message }); return; }
    location.hash = "#/dashboard";
  } else {
    navigate();
  }
}

/** Shows the right login step if needed. Returns true when the user is fully logged in. */
async function ensureLoggedIn(name, params, extra = {}) {
  if (name === "forgot") { authMode(true); await auth.renderForgot(); return false; }
  if (name === "reset") { authMode(true); await auth.renderReset(params.token || "", proceed); return false; }
  const st = await api.authStatus();
  if (st.state === "ok") { authMode(false); return true; }
  authMode(true);
  if (st.state === "no_account") auth.renderRegister(proceed);
  else if (st.state === "mfa_setup") await auth.renderMfaSetup(proceed);
  else if (st.state === "mfa") auth.renderCode(proceed);
  else auth.renderLogin(proceed, extra);
  return false;
}

async function navigate(extra = {}) {
  let { name, arg, params } = parse();
  try {
    if (!(await ensureLoggedIn(name, params, extra))) return;
  } catch (err) {
    $("#view").innerHTML = `<div class="panel empty"><div class="big">⚠</div><p>${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  if (AUTH_ROUTES.includes(name)) { location.hash = "#/dashboard"; return; }
  const nav = name === "add" || name === "edit" ? "entries" : ["setup", "new-authenticator"].includes(name) ? "settings" : name;
  document.body.classList.toggle("on-form", name === "add" || name === "edit");
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === nav));
  const view = $("#view");
  view.innerHTML = `<div class="loading">Loading…</div>`;
  $("#chart-tip").style.display = "none";
  try {
    await routes[name](params, arg);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="panel empty"><div class="big">⚠</div><p>${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">Retry</button></div>`;
  }
  window.scrollTo(0, 0);
}

initTheme();
window.addEventListener("hashchange", () => navigate());
window.addEventListener("kp:logged-out", () => {
  if (!document.body.classList.contains("auth-mode")) { toast("You were logged out"); navigate(); }
});
$("#logout-btn").addEventListener("click", async () => {
  await api.logout().catch(() => {});
  location.hash = "#/dashboard";
  navigate();
});
navigate();
