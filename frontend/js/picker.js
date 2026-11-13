// The app's own list for dropdowns, used for mouse clicks in place of the browser's list.
// Chrome on Linux draws its own list cut short the first time it opens and can pick an item when the mouse button
// is released. Here the <select> stays as it is (it still holds the value, shows it, and works with the keyboard and
// on touch screens); only the list that opens on a mouse click is the app's: every option, grouped like the select,
// scrollable, with a search box when the list is long.
import { esc } from "./util.js";

let pop = null;          // the open list
let owner = null;        // the select it belongs to
let lastPointer = "mouse";

function close(refocus = false) {
  if (!pop) return;
  pop.remove();
  const sel = owner;
  pop = owner = null;
  window.removeEventListener("resize", onMove);
  document.removeEventListener("scroll", onMove, true);
  if (refocus && sel) sel.focus({ preventScroll: true });
}

function onMove(e) {
  if (e && e.type === "scroll" && pop && pop.contains(e.target)) return;   // scrolling inside the list
  close();
}

function pick(sel, value) {
  close();
  if (sel.value !== value) {
    sel.value = value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  sel.blur();            // let go of the keyboard so typing in the next field can't change this one
}

function itemsHtml(sel) {
  let html = "";
  const opt = (o) => `<div class="sp-item${o.disabled ? " off" : ""}${o.selected ? " on" : ""}" data-v="${esc(o.value)}"
      role="option" aria-selected="${o.selected}">${esc(o.text)}</div>`;
  for (const n of sel.children) {
    if (n.tagName === "OPTGROUP") {
      const kids = [...n.children].filter((o) => !o.hidden);
      if (kids.length) html += `<div class="sp-group" role="group"><div class="sp-head">${esc(n.label)}</div>${kids.map(opt).join("")}</div>`;
    } else if (n.tagName === "OPTION" && !n.hidden) {
      html += opt(n);
    }
  }
  return html;
}

function place(sel) {
  const r = sel.getBoundingClientRect();
  const vh = window.innerHeight, vw = window.innerWidth;
  const below = vh - r.bottom - 8, above = r.top - 8;
  const downward = below >= 220 || below >= above;
  const room = Math.max(120, downward ? below : above);
  const list = pop.querySelector(".sp-list");
  list.style.maxHeight = "340px";
  const extra = pop.offsetHeight - list.offsetHeight;           // search box, padding and border around the list
  list.style.maxHeight = Math.max(80, Math.min(340, room - extra)) + "px";
  const w = Math.max(r.width, 200);
  pop.style.width = w + "px";
  pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
  if (downward) { pop.style.top = r.bottom + 4 + "px"; pop.style.bottom = ""; }
  else { pop.style.bottom = vh - r.top + 4 + "px"; pop.style.top = ""; }
}

function visibleItems() {
  return [...pop.querySelectorAll(".sp-item:not(.off)")].filter((i) => !i.hidden);
}

function setActive(item) {
  pop.querySelectorAll(".sp-item.act").forEach((i) => i.classList.remove("act"));
  if (item) { item.classList.add("act"); item.scrollIntoView({ block: "nearest" }); }
}

function filter(q) {
  q = q.trim().toLowerCase();
  pop.querySelectorAll(".sp-item").forEach((i) => { i.hidden = !!q && !i.textContent.toLowerCase().includes(q); });
  pop.querySelectorAll(".sp-group").forEach((g) => { g.hidden = ![...g.querySelectorAll(".sp-item")].some((i) => !i.hidden); });
  const none = pop.querySelector(".sp-none");
  none.hidden = visibleItems().length > 0;
  setActive(visibleItems()[0]);
}

function open(sel) {
  close();
  owner = sel;
  const long = sel.options.length > 8;
  pop = document.createElement("div");
  pop.className = "sel-pop";
  pop.innerHTML = `${long ? `<input class="sp-search" type="text" placeholder="Search…" aria-label="Search the list" autocomplete="off">` : ""}
    <div class="sp-list" role="listbox">${itemsHtml(sel)}<div class="sp-none" hidden>No match</div></div>`;
  document.body.appendChild(pop);
  place(sel);
  const cur = pop.querySelector(".sp-item.on");
  setActive(cur);
  if (cur) cur.scrollIntoView({ block: "center" });
  const search = pop.querySelector(".sp-search");
  if (search) {
    search.focus({ preventScroll: true });
    search.addEventListener("input", () => filter(search.value));
  } else {
    pop.tabIndex = -1;
    pop.focus({ preventScroll: true });
  }
  pop.addEventListener("mousedown", (e) => { if (!e.target.closest(".sp-search")) e.preventDefault(); });
  pop.addEventListener("click", (e) => {
    const it = e.target.closest(".sp-item");
    if (it && !it.classList.contains("off")) pick(sel, it.dataset.v);
  });
  pop.addEventListener("mousemove", (e) => {
    const it = e.target.closest(".sp-item");
    if (it && !it.classList.contains("off") && !it.classList.contains("act")) setActive(it);
  });
  pop.addEventListener("keydown", (e) => {
    const items = visibleItems();
    const at = items.indexOf(pop.querySelector(".sp-item.act"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
      setActive(items[next]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[at]) pick(sel, items[at].dataset.v);
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(true);
    }
  });
  window.addEventListener("resize", onMove);
  document.addEventListener("scroll", onMove, true);
}

export function initPicker() {
  document.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; }, true);
  document.addEventListener("mousedown", (e) => {
    if (pop && !pop.contains(e.target)) {
      const again = e.target.closest?.("select") === owner;
      close();
      if (again) { e.preventDefault(); return; }       // a second click on the box closes the list
    }
    const sel = e.target.closest?.("select");
    if (!sel || e.button !== 0 || sel.disabled || sel.multiple || sel.size > 1 || lastPointer !== "mouse") return;
    e.preventDefault();                                // no browser list
    sel.focus({ preventScroll: true });
    open(sel);
  }, true);
  window.addEventListener("hashchange", () => close());
  // The wheel over a focused dropdown would change its value: stop that.
  document.addEventListener("wheel", (e) => {
    const sel = e.target.closest?.("select");
    if (sel && document.activeElement === sel) e.preventDefault();
  }, { capture: true, passive: false });
}
