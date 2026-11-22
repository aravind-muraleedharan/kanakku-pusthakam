// The ⓘ buttons: a short explanation of a term, opened by click, tap or keyboard (Enter / Space), closed by
// clicking anywhere else or Escape. All texts live here so they are easy to review and reword.
const HELP = {
  net_savings: { title: "Net savings", html: `<ul class="help-ul">
      <li><b>Income − Expense</b> for the month picked</li>
      <li><b>Money you invest isn't an expense:</b> putting money into an FD, RD, gold and so on doesn't reduce your savings</li>
      <li><b>What investments earn is income:</b> interest, profits and dividends are counted under Income</li>
      <li><b>The %</b> is savings as a share of income; in red when spending went past income</li>
    </ul>` },
  // How each kind of investment is valued (the ⓘ beside an open type on the Investments page)
  val_fd: { title: "Fixed deposit", html: `<ul class="help-ul"><li>Valued at the deposit plus the interest earned to date, at the rate you entered.</li><li>Interest paid out to your bank counts as income.</li></ul>` },
  val_rd: { title: "Recurring deposit", html: `<ul class="help-ul"><li>Valued at the instalments paid plus the interest earned to date.</li><li>An instalment is due on the start date's day each month.</li></ul>` },
  val_ppf: { title: "PPF", html: `<ul class="help-ul"><li>Valued at your deposits plus interest at the PPF rate.</li><li>Interest is added once a year.</li></ul>` },
  val_gold: { title: "Gold", html: `<ul class="help-ul"><li>Shown at what you paid.</li><li>The gain counts only when you sell.</li></ul>` },
  val_silver: { title: "Silver", html: `<ul class="help-ul"><li>Shown at what you paid.</li><li>The gain counts only when you sell.</li></ul>` },
  val_share: { title: "Stocks", html: `<ul class="help-ul"><li>Money added plus profit booked in the trading journal.</li><li>Not market prices.</li></ul>` },
  val_chitty: { title: "Chit fund", html: `<ul class="help-ul"><li>What you have paid in so far.</li><li>The gain or loss counts when the chit closes.</li></ul>` },
  val_other: { title: "Other investments", html: `<ul class="help-ul"><li>What you put in.</li><li>Update it by entering its current value on its page.</li></ul>` },
  types: {
    title: "Transaction types",
    html: `<dl class="help-dl">
      <dt class="c-income">Income</dt><dd>Money you receive, e.g. salary, interest, refund.</dd>
      <dt class="c-expense">Expense</dt><dd>Money you spend. Card purchases count on the day you swipe.</dd>
      <dt class="c-transfer">Transfer</dt><dd>Moving money between your own accounts, e.g. card bill payment, ATM withdrawal.</dd>
      <dt class="c-invest">Invest</dt><dd>Money put into an investment.</dd>
      <dt class="c-redeem">Maturity</dt><dd>Money coming back from an investment, such as an FD or RD maturing.</dd>
    </dl>`,
  },
  principal: {
    title: "Principal being closed",
    html: `<ul class="help-ul">
      <li>Your own money coming back, out of the amount received.</li>
      <li>Filled in for you.</li>
      <li>Change it only for a partial withdrawal.</li></ul>`,
  },
  paid_from: {
    title: "Paid from / Payment mode",
    html: `<ul class="help-ul">
      <li><b>Paid from:</b> the account the money left.</li>
      <li><b>Payment mode:</b> how you paid (UPI, card, cash…).</li></ul>`,
  },
  budget_how: { title: "How the budget works", html: `<ul class="help-ul">
    <li>Plan income and expenses for up to 3 months ahead.</li>
    <li>Tick <b>✓</b> when a payment is made.</li>
    <li><svg class="help-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="Note"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4"/><path d="M8.5 11.5h7M8.5 15h7M8.5 18.5h4"/></svg> adds a note for that month.</li>
    <li>Point at an item to rename or delete it.</li>
    <li>Amounts save as you leave each box.</li></ul>` },
  loan_expense: { title: "What counts as expense", html: `<ul class="help-ul">
    <li><b>Card EMI:</b> the whole EMI is that month's expense.</li>
    <li><b>Personal loan:</b> only the interest is an expense. The principal repays money you already spent.</li></ul>` },
  settings_active: { title: "Editing your lists", html: `<ul class="help-ul">
    <li><b>Rename:</b> click a name, type, then click away. It saves by itself.</li>
    <li><b>Description:</b> click a category's name; a description box opens below it.</li>
    <li><b>Switch off:</b> hides it from the add/edit form. Past records keep it, so totals don't change.</li>
    <li><b>Delete:</b> only items marked <b>unused</b> can be deleted. The bin shows on those.</li>
    <li><b>Built in</b> and <b>automatic</b> items can't be renamed or deleted.</li></ul>` },
  inv_works_like: { title: "Works like", html: `<ul class="help-ul">
    <li>Your own type uses the maths of the built-in type you pick.</li>
    <li>e.g. <b>Mutual funds</b> works like <b>Stocks</b>; <b>Post office MIS</b> works like a <b>Fixed deposit</b>.</li></ul>` },
  backup_folder: { title: "Back up to a folder", html: `<ul class="help-ul">
    <li>Saves a copy of your data in any folder you choose, named with today's date and time.</li>
    <li>A folder on this computer works. A pen drive or another disk is safest: the copy survives even if this computer fails.</li></ul>` },
  restore_file: { title: "Restore from a file", html: `<ul class="help-ul">
    <li>Replaces <b>all</b> your current data with the backup you choose.</li>
    <li>Your current data is saved to the backups list first, so you can undo it.</li></ul>` },
  auto_backups: { title: "Automatic backups", html: `<ul class="help-ul">
    <li><b>Automatic:</b> one a day, at your first login, only if something changed.</li>
    <li>The last 7 days are kept, and one a week is kept for about 2 months.</li>
    <li><b>Before an update / a restore:</b> made just before those, so they can be undone (the last 3 of each).</li>
    <li><b>Made by you:</b> from <b>Back up now</b>.</li>
    <li>Where they are: see <b>About</b>.</li></ul>` },
  fd_payouts: { title: "Interest payouts", html: `<ul class="help-ul">
    <li>Press <b>Record</b> when a payout reaches your bank.</li>
    <li>The last one comes with the deposit at maturity: use <b>Close</b> then.</li></ul>` },
    rp_grid: { title: "Month by month", html: `<ul class="help-ul">
    <li>Each category, month by month. A darker cell means more money.</li>
    <li>Click a cell to see its transactions.</li></ul>` },
    sec_mfa: { title: "Authenticator app", html: `<ul class="help-ul">
    <li>Every login needs a 6-digit code from your phone.</li>
    <li><b>New phone:</b> pair it here; the old one stops working.</li>
    <li><b>Lost phone:</b> on this computer run <code>python3 run.py --reset-mfa</code>.</li></ul>` },
  sec_password: { title: "Password", html: `<ul class="help-ul">
    <li>At least 10 characters, and not only numbers or only small letters.</li>
    <li>Longer is stronger: a short sentence you'll remember works well.</li>
    <li>Changing it signs out any other open logins.</li></ul>` },
    sec_idle: { title: "Auto-logout", html: `<ul class="help-ul">
    <li>Moving the mouse, typing or scrolling counts as using the app, so reading a report won't log you out.</li>
    <li>After this many minutes with none of that, the app logs you out and shows the login screen.</li>
    <li>Between 5 and 1440 minutes. Stepping away? Lock your computer too.</li></ul>` },
  sec_mail: { title: "Email for password reset", html: `<ul class="help-ul">
    <li><b>Forgot password</b> emails a reset link using this mail account.</li>
    <li>Optional: without it, the app still works fully offline.</li></ul>` },
  sec_email: { title: "Login email", html: `<ul class="help-ul">
    <li>The address you log in with, and where reset links go.</li>
    <li>Your data file is a normal file on this computer: keep your computer account password-protected too.</li></ul>` },
  done: { title: "Done", html: `<ul class="help-ul"><li>Tick a payment once you've paid it.</li><li><b>Paid</b> and <b>Still to pay</b> update straight away.</li></ul>` },
  sufficient: {
    title: "Spare or short",
    html: `<ul class="help-ul"><li>The month's income minus its expenses.</li><li><b>✓ Spare:</b> the money is enough, with that much left over.</li><li><b>⚠ Short:</b> you need that much more.</li></ul>`,
  },
  close_delete: {
    title: "Close or Delete?",
    html: `<ul class="help-ul">
      <li><b>Close:</b> it has ended. Its history is kept.</li>
      <li><b>Delete:</b> erased completely. Only for mistakes.</li></ul>`,
  },
  gain_pct: { title: "Gain", html: `<ul class="help-ul">
    <li>What your investments earned: <b>Current value − Invested</b>.</li>
    <li>The <b>%</b> is the gain on what's invested: ▲ green for a gain, ▼ red for a loss.</li></ul>` },
  chitty_instalments: { title: "Chitty instalments", html: `<ul class="help-ul">
    <li>Record each month's instalment as you pay it.</li>
    <li>When the chit pays a <b>dividend</b>, the instalment is lower: enter what you actually paid.</li></ul>` },
  rd_instalments: { title: "RD instalments", html: `<ul class="help-ul">
    <li>Record each month's instalment as you pay it.</li>
    <li>A missed month shows up as due on the Investments page.</li></ul>` },
  ppf_interest: { title: "How PPF interest works", html: `<ul class="help-ul">
    <li>Interest is worked out on the <b>lowest balance between the 5th and the end of each month</b>.</li>
    <li>Deposit by the <b>5th</b> to earn that month's interest.</li>
    <li>It's credited once a year, on <b>31 March</b>.</li></ul>` },
  loan_works_like: { title: "Works like", html: `<ul class="help-ul">
    <li><b>Loan:</b> money borrowed into your bank, like a home, car or gold loan. Only the interest is an expense.</li>
    <li><b>Card EMI:</b> a purchase paid off on a credit card. The whole EMI is an expense.</li></ul>` },
  left_to_repay: { title: "Left to repay", html: `<ul class="help-ul">
    <li>The loan amount you still owe, across all active loans and EMIs.</li>
    <li>Future interest isn't included: that's <b>Interest left to pay</b>.</li></ul>` },
  interest_left: { title: "Interest left to pay", html: `<ul class="help-ul">
    <li>The interest still to come, if every EMI is paid as scheduled.</li>
    <li>Prepaying a loan lowers it.</li></ul>` },
  emis_paid_before: { title: "EMIs already paid", html: `<ul class="help-ul">
    <li>For a loan that was already running when you started using the app.</li>
    <li>Enter how many EMIs you'd paid before that.</li>
    <li>Leave it at 0 for a new loan.</li></ul>` },
  current_value: {
    title: "Current value",
    html: `<p style="margin:0 0 6px">An estimate, as on today:</p><ul class="help-ul">
      <li><b>FD, RD, PPF:</b> with interest to date</li>
      <li><b>Gold and silver:</b> at what you paid; the gain counts when you sell</li>
      <li><b>Stocks:</b> money added plus profit booked, not market prices</li>
      <li><b>Others:</b> what you put in, until you enter their current value</li>
    </ul>`,
  },
  market_action: {
    title: "CNC / MTF / Intraday",
    html: `<ul class="help-ul">
      <li><b>CNC:</b> bought and held.</li>
      <li><b>MTF:</b> bought on broker margin.</li>
      <li><b>Intraday:</b> bought and sold the same day.</li></ul>`,
  },
  prepay_mode: {
    title: "Reduce tenure or EMI",
    html: `<ul class="help-ul">
      <li><b>Keep the EMI:</b> same EMI, finishes sooner.</li>
      <li><b>Keep the end date:</b> same end date, smaller EMI.</li></ul>`,
  },
};

/** The ⓘ button for one help text, to put right after a label. */
/** A help text worked out on the page (e.g. this loan's figures): register it, then use info(id) as usual. */
export function setHelp(id, title, items) {
  HELP[id] = { title, html: `<ul class="help-ul">${items.filter(Boolean).map((t) => `<li>${t}</li>`).join("")}</ul>` };
}

export function info(id) {
  const h = HELP[id];
  if (!h) return "";
  return `<button type="button" class="info-btn" data-info="${id}" aria-label="What is this? ${h.title}" aria-expanded="false">i</button>`;
}

let open = null;

function close() {
  if (!open) return;
  open.btn.setAttribute("aria-expanded", "false");
  open.pop.remove();
  open = null;
}

function show(btn) {
  const h = HELP[btn.dataset.info];
  const pop = document.createElement("div");
  pop.className = "help-pop";
  pop.setAttribute("role", "dialog");
  pop.innerHTML = `<b class="help-title">${h.title}</b><div class="help-body">${h.html}</div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(window.scrollX + r.left + r.width / 2 - w / 2, window.scrollX + document.documentElement.clientWidth - w - 8));
  let top = window.scrollY + r.bottom + 8;
  if (r.bottom + pop.offsetHeight + 16 > window.innerHeight && r.top > pop.offsetHeight + 16) top = window.scrollY + r.top - pop.offsetHeight - 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  btn.setAttribute("aria-expanded", "true");
  open = { btn, pop };
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest?.("[data-info]");
  if (btn) {
    e.preventDefault();
    e.stopPropagation();          // inside a clickable row or label: only open the help
    const same = open && open.btn === btn;
    close();
    if (!same) show(btn);
    return;
  }
  if (open && !e.target.closest(".help-pop")) close();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
window.addEventListener("hashchange", close);
window.addEventListener("resize", close);

