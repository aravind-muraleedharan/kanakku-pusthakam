// Light / Dark / Auto (follow the system) theme, remembered in this browser.
import { $, store } from "./util.js";

const MODES = ["auto", "light", "dark"];
const LABEL = { auto: "Auto", light: "Light", dark: "Dark" };
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  auto: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  dark: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
};

function apply(mode) {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  const btn = $("#theme-btn");
  if (btn) {
    btn.innerHTML = `<span class="ico">${ICON[mode]}</span><span class="theme-label">Theme: ${LABEL[mode]}</span>`;
    btn.title = `Theme: ${LABEL[mode]} (click to change)`;
  }
}

export function initTheme() {
  let mode = store.get("theme", "auto");
  if (!MODES.includes(mode)) mode = "auto";
  apply(mode);
  $("#theme-btn")?.addEventListener("click", () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    store.set("theme", mode);
    apply(mode);
  });
}
