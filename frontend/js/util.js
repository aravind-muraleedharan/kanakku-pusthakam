// Formatting, DOM and small UI helpers shared by all views.

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** ₹1,23,456 (Indian grouping). Shows paise only when present. */
export function money(v, { sign = false, decimals = false } = {}) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const n = Number(v);
  const fmt = decimals || !Number.isInteger(Math.round(n * 100) / 100) ? inr2 : inr;
  const s = `₹${fmt.format(Math.abs(n))}`;
  if (n < 0) return `−${s}`;
  return sign && n > 0 ? `+${s}` : s;
}

/** Compact for chart axes: ₹1.2L, ₹45K, ₹1.1Cr */
export function moneyShort(v) {
  const n = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (n >= 1e7) return `${sign}₹${trim(n / 1e7)}Cr`;
  if (n >= 1e5) return `${sign}₹${trim(n / 1e5)}L`;
  if (n >= 1e3) return `${sign}₹${trim(n / 1e3)}K`;
  return `${sign}₹${Math.round(n)}`;
}
const trim = (x) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ""));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A month chooser that reads "November 2026"; clicking it opens the browser's month calendar. */
export function monthPicker(id, value, emptyLabel = "All months") {
  return `<label class="mp" title="Choose a month">`
    + `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`
    + `<span class="mp-text">${esc(value ? monthLabel(value) : emptyLabel)}</span>`
    + `<input type="month" id="${id}" value="${esc(value || "")}" aria-label="Month"></label>`;
}

/** Make a monthPicker open its calendar on click / Enter. Browsers without a month calendar show the plain field. */
export function bindMonthPicker(input) {
  if (!input) return;
  if (input.type !== "month" || typeof input.showPicker !== "function") {
    input.closest(".mp")?.classList.add("mp-native");
    return;
  }
  const open = () => { try { input.showPicker(); } catch { input.focus(); } };
  input.addEventListener("click", (e) => { e.preventDefault(); open(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
}

let appSteps = 0;                                   // pages opened inside the app since it loaded
export const notePageChange = () => { appSteps++; };

/** Go back to the page you came from (keeping its month and filters); `fallback` if this page was opened directly. */
export function goBack(fallback) {
  if (appSteps > 0) history.back();
  else location.hash = fallback;
}

/** The round ← button shown left of a page title. `to` is the page it goes back to. */
export function backButton(href, to) {
  return `<a class="back-btn" href="${href}" data-back title="Back to ${esc(to)}" aria-label="Back to ${esc(to)}">`
    + `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg></a>`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const thisMonth = () => todayISO().slice(0, 7);
export const pad = (n) => String(n).padStart(2, "0");

export function shiftMonth(month, delta) {
  let y = +month.slice(0, 4), m = +month.slice(5, 7) + delta;
  while (m < 1) { y--; m += 12; }
  while (m > 12) { y++; m -= 12; }
  return `${y}-${pad(m)}`;
}
export function monthBounds(month) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const monthLabel = (m) => `${MONTHS_LONG[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
export function dateLabel(iso) {
  const [y, m, d] = iso.split("-");
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}
export function dayLabel(iso) {
  const t = todayISO();
  if (iso === t) return "Today";
  if (iso === addDays(t, -1)) return "Yesterday";
  const [y, m, d] = iso.split("-");
  return `${+d} ${MONTHS[+m - 1]}${y === t.slice(0, 4) ? "" : " " + y}`;
}

export const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer", invest: "Invest", redeem: "Maturity" };   // stored as "redeem": money back from an investment
export const KIND_LABEL = { bank: "Bank", credit_card: "Credit card", cash: "Cash", wallet: "Wallets & gift cards", investment: "Investment", loan: "Loan" };

/** Escape text for safe use inside HTML templates. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 4500 : 2400);
}

export function options(list, selected, { placeholder, valueKey = "id", labelKey = "name" } = {}) {
  const head = placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : "";
  return head + list.map((o) =>
    `<option value="${esc(o[valueKey])}" ${String(o[valueKey]) === String(selected ?? "") ? "selected" : ""}>${esc(o[labelKey])}</option>`
  ).join("");
}

/** Small modal dialog. Returns a promise of the form values (or null if cancelled). */
export function modal({ title, body, submitLabel = "Save", onSubmit, wide = false }) {
  return new Promise((resolve) => {
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-back">
        <form class="modal panel ${wide ? "wide" : ""}" novalidate>
          <h2>${esc(title)}</h2>
          <div class="stack">${body}</div>
          <p class="err small c-expense hidden" data-err></p>
          <div class="form-actions">
            <button type="button" class="btn" data-cancel>Cancel</button>
            <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
          </div>
        </form>
      </div>`;
    const form = $("form", root);
    const close = (val) => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    $("[data-cancel]", root).onclick = () => close(null);
    $(".modal-back", root).addEventListener("mousedown", (e) => { if (e.target.classList.contains("modal-back")) close(null); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        const result = onSubmit ? await onSubmit(values) : values;
        close(result);
      } catch (err) {
        const p = $("[data-err]", root);
        p.textContent = err.message;
        p.classList.remove("hidden");
      }
    };
    const first = $("input, select", form);
    if (first) first.focus();
  });
}

export function confirmDialog(title, message, label = "Delete") {
  return modal({ title, body: `<p class="muted" style="margin:0">${esc(message)}</p>`, submitLabel: label, onSubmit: () => true });
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem("aet:" + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("aet:" + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

/** Indian financial year (Apr–Mar) containing the given ISO date. */
export function financialYear(iso = todayISO()) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
}
