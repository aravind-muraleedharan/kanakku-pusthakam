// The ⓘ buttons: a short explanation of a term, opened by click, tap or keyboard (Enter / Space), closed by
// clicking anywhere else or Escape. All texts live here so they are easy to review and reword.
const HELP = {
  types: {
    title: "Transaction types",
    html: `<dl class="help-dl">
      <dt>Income</dt><dd>Money you receive, e.g. salary, interest, refund.</dd>
      <dt>Expense</dt><dd>Money you spend. Card purchases count on the day you swipe.</dd>
      <dt>Transfer</dt><dd>Moving money between your own accounts, e.g. card bill payment, ATM withdrawal.</dd>
      <dt>Invest</dt><dd>Money put into an investment.</dd>
      <dt>Maturity</dt><dd>Money coming back from an investment, such as an FD or RD maturing.</dd>
    </dl>`,
  },
  principal: {
    title: "Principal being closed",
    html: "The part of the money received that is your own investment coming back. It's filled in for you; change it only for a partial withdrawal.",
  },
  paid_from: {
    title: "Paid from / Payment mode",
    html: "<b>Paid from</b> is the account the money left. <b>Payment mode</b> is how you paid (UPI, card, cash etc.).",
  },
  done: { title: "Done", html: "Tick a payment once you've paid it. <b>Paid</b> and <b>Still to pay</b> update straight away." },
  sufficient: {
    title: "Sufficient or short",
    html: "The month's income minus its expenses. <b>Sufficient</b>: the money is enough, with that much spare. <b>Short</b>: you need that much more.",
  },
  close_delete: {
    title: "Close or Delete?",
    html: "<b>Close</b>: it ended, and the history is kept. <b>Delete</b>: erased completely; for mistakes only.",
  },
  current_value: {
    title: "Current value",
    html: "FD, RD, PPF with interest to date. Gold and silver at what you paid. Others: the value you enter.",
  },
  market_action: {
    title: "CNC / MTF / Intraday",
    html: "<b>CNC</b>: bought and held. <b>MTF</b>: bought on broker margin. <b>Intraday</b>: bought and sold the same day.",
  },
  prepay_mode: {
    title: "Reduce tenure or EMI",
    html: "<b>Keep the EMI</b>: same EMI, finishes sooner. <b>Keep the end date</b>: same end date, smaller EMI.",
  },
  interest_only: {
    title: "Only interest is an expense",
    html: "Repaying principal clears a debt; interest is the cost. Card EMIs count in full.",
  },
  card_dues: { title: "Card dues and limit", html: "<b>Dues</b>: what you owe now. <b>Available</b>: limit − dues." },
};

/** The ⓘ button for one help text, to put right after a label. */
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

