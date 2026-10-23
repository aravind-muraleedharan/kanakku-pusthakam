// Hash router: #/dashboard, #/accounts, #/entries, #/budget, #/investments, #/investment/3, #/add, #/edit/12, #/reports, #/settings
// Every screen except forgot/reset password requires a full login (password + authenticator code).
import { api } from "./api.js";
import { $, $$, esc, toast } from "./util.js";
import * as auth from "./views/auth.js";
import * as dashboard from "./views/dashboard.js";
import * as entries from "./views/entries.js";
import * as entryForm from "./views/entry-form.js";
import * as investment from "./views/investment.js";
import * as investments from "./views/investments.js";
import * as loans from "./views/loans.js";
import * as moneyView from "./views/money.js";
import * as budget from "./views/budget.js";
import * as reports from "./views/reports.js";
import * as settings from "./views/settings.js";
import * as setup from "./views/setup.js";
import { initTheme } from "./theme.js";

const routes = {
  dashboard: (p) => dashboard.render(p),
  accounts: (p) => moneyView.render(p),
  money: (p) => moneyView.render(p),        // old address of Accounts
  entries: (p) => entries.render(p),
  add: (p) => entryForm.render({ ...p }),
  edit: (p, id) => entryForm.render({ ...p, id }),
  investments: (p) => investments.render(p),
  investment: (p, id) => investment.render(p, id),
  loans: (p) => loans.render(p),
  loan: (p, id) => loans.renderLoan(p, id),
  budget: (p) => budget.render(p),
  planner: (p) => budget.render(p),        // old address of the Monthly Budget
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
  const dialog = $("#modal-root");
  if (dialog) dialog.innerHTML = "";          // a dialog left open never follows you to another page
  try {
    if (!(await ensureLoggedIn(name, params, extra))) return;
  } catch (err) {
    $("#view").innerHTML = `<div class="panel empty"><div class="big">⚠</div><p>${esc(err.message)}</p>
      <button class="btn" data-retry>Retry</button></div>`;
    return;
  }
  if (AUTH_ROUTES.includes(name)) { location.hash = "#/dashboard"; return; }
  const nav = name === "add" || name === "edit" ? "entries" : name === "investment" ? "investments" : name === "loan" ? "loans" : name === "planner" ? "budget" : name === "money" ? "accounts" : ["setup", "new-authenticator"].includes(name) ? "settings" : name;
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
      <button class="btn" data-retry>Retry</button></div>`;
  }
  window.scrollTo(0, 0);
}

initTheme();

// Dropdowns keep the choice you made with the mouse. Once picked, the dropdown lets go of the keyboard, so typing
// into the next field can't jump it to another option (browsers select options by first letter), and scrolling
// the page over an open-and-closed dropdown never changes it.
document.addEventListener("pointerdown", (e) => {
  const sel = e.target.closest?.("select");
  if (sel) sel.dataset.picked = "1";
}, true);
document.addEventListener("change", (e) => {
  const sel = e.target;
  if (sel.tagName === "SELECT" && sel.dataset.picked) { delete sel.dataset.picked; sel.blur(); }
}, true);
document.addEventListener("focusout", (e) => { if (e.target.tagName === "SELECT") delete e.target.dataset.picked; }, true);
document.addEventListener("wheel", (e) => {
  const sel = e.target.closest?.("select");
  if (sel && document.activeElement === sel) e.preventDefault();
}, { capture: true, passive: false });

// The browser must not remember what you type (amounts, notes, stock names...) and offer it again later.
// Fields that say what they are (email, passwords, the login code) keep their own autocomplete setting.
const noHistory = (root) => {
  if (!root.querySelectorAll) return;
  const els = [root, ...root.querySelectorAll("form, input, textarea")];
  for (const el of els) {
    if (!["FORM", "INPUT", "TEXTAREA"].includes(el.tagName) || el.hasAttribute("autocomplete")) continue;
    if (el.tagName === "FORM" && el.querySelector("[autocomplete]:not([autocomplete=off])")) continue;   // login forms
    el.setAttribute("autocomplete", "off");
  }
};
noHistory(document.body);
new MutationObserver((list) => {
  for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) noHistory(n);
}).observe(document.body, { childList: true, subtree: true });

window.addEventListener("hashchange", () => navigate());
document.addEventListener("click", (e) => { if (e.target.closest("[data-retry]")) location.reload(); });
window.addEventListener("kp:logged-out", () => {
  if (!document.body.classList.contains("auth-mode")) { toast("You were logged out"); navigate(); }
});
$("#logout-btn").addEventListener("click", async () => {
  await api.logout().catch(() => {});
  location.hash = "#/dashboard";
  navigate();
});
navigate();
