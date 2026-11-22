// Auto-logout that counts what you actually do: moving the mouse, typing, scrolling, tapping.
// While you're active the page tells the server now and then (so reading a long report doesn't log you out);
// after the chosen minutes with no activity at all, the page logs you out on its own and shows the login screen.
import { api } from "./api.js";

const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"];
const PING_EVERY = 60 * 1000;          // tell the server at most once a minute while you're active
const CHECK_EVERY = 10 * 1000;

let minutes = 0, lastActive = 0, lastPing = 0, timer = null, onTimeout = null;

const mark = () => { lastActive = Date.now(); };

async function check() {
  const now = Date.now();
  if (now - lastActive >= minutes * 60 * 1000) {
    stop();
    await api.logout().catch(() => {});
    onTimeout?.(minutes);
    return;
  }
  // active since the last ping: keep the server session going
  if (lastActive > lastPing && now - lastPing >= PING_EVERY) {
    lastPing = now;
    api.ping().catch(() => {});
  }
}

/** Start (or restart) watching. `logout(minutes)` runs when the time is up. */
export function start(idleMinutes, logout) {
  minutes = Math.max(5, +idleMinutes || 30);
  onTimeout = logout;
  if (timer) return;
  lastActive = lastPing = Date.now();
  EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", check);      // back from sleep or another tab: check straight away
  timer = setInterval(check, CHECK_EVERY);
}

export function setMinutes(m) { minutes = Math.max(5, +m || minutes); }

export function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  EVENTS.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
  document.removeEventListener("visibilitychange", check);
}
