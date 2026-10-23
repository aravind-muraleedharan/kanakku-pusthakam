// Thin wrapper around the backend JSON API.

async function request(method, url, body) {
  const opts = { method, headers: { "X-Requested-With": "KanakkuPusthakam" }, credentials: "same-origin" };
  if (body instanceof FormData) {
    opts.body = body;                       // file upload: the browser sets the multipart Content-Type
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw Object.assign(new Error("Can't reach the app server. Is it still running?"), { network: true });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth) {
    // session ended (logged out, idle timeout, password changed): go to the login screen
    window.dispatchEvent(new CustomEvent("kp:logged-out"));
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { field: data.field, status: res.status });
  }
  return data;
}

const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // entries
  entries: (params) => request("GET", `/api/entries${qs(params)}`),
  entry: (id) => request("GET", `/api/entries/${id}`),
  createEntry: (data) => request("POST", "/api/entries", data),
  updateEntry: (id, data) => request("PUT", `/api/entries/${id}`, data),
  deleteEntry: (id) => request("DELETE", `/api/entries/${id}`),

  // masters
  masters: () => request("GET", "/api/masters"),
  createMaster: (table, data) => request("POST", `/api/masters/${table}`, data),
  updateMaster: (table, id, data) => request("PUT", `/api/masters/${table}/${id}`, data),
  deleteMaster: (table, id) => request("DELETE", `/api/masters/${table}/${id}`),
  setOpening: (items) => request("PUT", "/api/masters/accounts/opening", { items }),

  // reports
  dashboard: (month) => request("GET", `/api/reports/dashboard${qs({ month })}`),
  summary: (range) => request("GET", `/api/reports/summary${qs(range)}`),
  monthly: (range) => request("GET", `/api/reports/monthly${qs(range)}`),
  categories: (params) => request("GET", `/api/reports/categories${qs(params)}`),
  grid: (params) => request("GET", `/api/reports/grid${qs(params)}`),
  paymentModes: (range) => request("GET", `/api/reports/payment-modes${qs(range)}`),
  balances: () => request("GET", "/api/reports/balances"),
  money: () => request("GET", "/api/reports/money"),

  // investments
  investments: () => request("GET", "/api/investments"),
  investment: (id) => request("GET", `/api/investments/${id}`),
  createInvestment: (data) => request("POST", "/api/investments", data),
  updateInvestment: (id, data) => request("PUT", `/api/investments/${id}`, data),
  deleteInvestment: (id) => request("DELETE", `/api/investments/${id}`),
  invPost: (id, path, data) => request("POST", `/api/investments/${id}/${path}`, data || {}),
  invPut: (id, path, data) => request("PUT", `/api/investments/${id}/${path}`, data),
  invDelete: (id, path) => request("DELETE", `/api/investments/${id}/${path}`),
  investmentTypes: () => request("GET", "/api/investment-types"),

  // loans
  loans: () => request("GET", "/api/loans"),
  loan: (id) => request("GET", `/api/loans/${id}`),
  createLoan: (data) => request("POST", "/api/loans", data),
  updateLoan: (id, data) => request("PUT", `/api/loans/${id}`, data),
  deleteLoan: (id) => request("DELETE", `/api/loans/${id}`),
  loanPost: (id, path, data) => request("POST", `/api/loans/${id}/${path}`, data || {}),

  // monthly budget: own items, up to three months
  budget: () => request("GET", "/api/budget"),
  budgetAddItem: (data) => request("POST", "/api/budget/items", data),
  budgetRenameItem: (id, data) => request("PUT", `/api/budget/items/${id}`, data),
  budgetDeleteItem: (id) => request("DELETE", `/api/budget/items/${id}`),
  budgetSave: (month, items) => request("PUT", `/api/budget/${month}`, { items }),
  budgetCopy: (month, from) => request("POST", `/api/budget/${month}/copy`, { from }),
  budgetClear: (month) => request("POST", `/api/budget/${month}/clear`),
  budgetAddMonth: (month) => request("POST", "/api/budget/months", { month }),
  budgetDeleteMonth: (month) => request("DELETE", `/api/budget/${month}`),

  // auth
  authStatus: () => request("GET", "/api/auth/status"),
  register: (d) => request("POST", "/api/auth/register", d),
  login: (d) => request("POST", "/api/auth/login", d),
  loginCode: (code) => request("POST", "/api/auth/login/code", { code }),
  mfaBegin: () => request("POST", "/api/auth/mfa/begin"),
  mfaConfirm: (code) => request("POST", "/api/auth/mfa/confirm", { code }),
  logout: () => request("POST", "/api/auth/logout"),
  forgot: (email) => request("POST", "/api/auth/forgot", { email }),
  resetCheck: (token) => request("POST", "/api/auth/reset/check", { token }),
  reset: (d) => request("POST", "/api/auth/reset", d),
  security: () => request("GET", "/api/auth/security"),
  changePassword: (d) => request("POST", "/api/auth/password", d),
  changeEmail: (d) => request("PUT", "/api/auth/email", d),
  saveMail: (d) => request("PUT", "/api/auth/mail-settings", d),
  testMail: () => request("POST", "/api/auth/mail-settings/test"),
  setIdle: (minutes) => request("PUT", "/api/auth/idle", { minutes }),

  // system
  info: () => request("GET", "/api/system/info"),
  backups: () => request("GET", "/api/system/backups"),
  backupTo: (path) => request("POST", "/api/system/backup-to", { path }),
  restoreUpload: (formData) => request("POST", "/api/system/restore", formData),
  restoreBackup: (file, password) => request("POST", "/api/system/restore-backup", { file, password }),
  exportUrl: (params) => `/api/system/export.csv${qs(params)}`,
};

export { qs };
