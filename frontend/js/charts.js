// Dependency-free SVG charts.
import { $, esc, money, moneyShort, monthShort } from "./util.js";

function niceMax(v) {
  if (v <= 0) return 1000;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function bindTips(root) {
  const tip = $("#chart-tip");
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      tip.innerHTML = el.dataset.tip;
      tip.style.display = "block";
      const w = tip.offsetWidth;
      tip.style.left = Math.min(e.clientX + 12, window.innerWidth - w - 8) + "px";
      tip.style.top = e.clientY - 36 + "px";
    });
    el.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
}

/**
 * Monthly income vs expense grouped bars, with the net savings as a dot per month.
 * rows: [{month, income, expense, net}]
 */
export function incomeExpenseChart(el, rows, { onClick } = {}) {
  if (!rows.length || rows.every((r) => !r.income && !r.expense && !r.net)) {
    el.innerHTML = `<div class="empty small">No income or expenses in these months yet.<br>Add transactions and the chart fills in.</div>`;
    return;
  }
  const W = 720, H = 250, L = 52, R = 12, T = 14, B = 30;
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.income, r.expense)), 0));
  const minNet = Math.min(0, ...rows.map((r) => r.net));
  const min = minNet < 0 ? -niceMax(-minNet) : 0;
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const slot = (W - L - R) / rows.length;
  const bw = Math.max(3, Math.min(18, slot * 0.32));
  const ticks = 4;
  let s = "";
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    s += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${moneyShort(v)}</text>`;
  }
  if (min < 0) s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
  const every = rows.length > 14 ? Math.ceil(rows.length / 12) : 1;
  rows.forEach((r, i) => {
    const cx = L + slot * i + slot / 2;
    const tipHtml = `<b>${esc(monthShort(r.month))}</b><br>Income ${money(r.income)}<br>Expense ${money(r.expense)}<br>Net ${money(r.net)}`;
    s += `<g class="col" data-month="${r.month}" data-tip="${esc(tipHtml)}" style="cursor:${onClick ? "pointer" : "default"}">`;
    s += `<rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>`;
    s += `<rect x="${cx - bw - 1}" y="${y(r.income)}" width="${bw}" height="${Math.max(0, y(0) - y(r.income))}" rx="2" fill="var(--income)"/>`;
    s += `<rect x="${cx + 1}" y="${y(r.expense)}" width="${bw}" height="${Math.max(0, y(0) - y(r.expense))}" rx="2" fill="var(--expense)"/>`;
    s += `<circle cx="${cx}" cy="${y(r.net)}" r="3.5" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.5"/>`;
    s += `</g>`;
    if (i % every === 0) s += `<text x="${cx}" y="${H - 10}" text-anchor="middle">${monthShort(r.month)}</text>`;
  });
  el.innerHTML = `
    <div class="legend" style="margin-bottom:8px">
      <span><i style="background:var(--income)"></i>Income</span>
      <span><i style="background:var(--expense)"></i>Expense</span>
      <span><i style="background:var(--panel);border:1.5px solid var(--ink);border-radius:50%"></i>Net savings</span>
    </div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly income and expense">${s}</svg></div>`;
  bindTips(el);
  if (onClick) el.querySelectorAll("g.col").forEach((g) => g.addEventListener("click", () => onClick(g.dataset.month)));
}

/** Horizontal bar list. items: [{name, amount, share, count?, id?}] */
export function barList(el, items, { kind = "expense", onClick, empty = "Nothing here yet", showShare = true } = {}) {
  if (!items.length) {
    el.innerHTML = `<div class="empty small">${esc(empty)}</div>`;
    return;
  }
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  const cls = kind === "income" ? "income" : kind === "neutral" ? "neutral" : "";
  el.innerHTML = `<div class="bars">${items.map((i, idx) => `
    <div class="bar-row ${onClick ? "click" : ""}" data-idx="${idx}">
      <span class="name" title="${esc(i.name)}">${esc(i.name)}</span>
      <span class="val">${money(i.amount)}${showShare && i.share !== undefined ? `<small>${i.share}%</small>` : ""}</span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.max(1, (Math.abs(i.amount) / max) * 100)}%;${i.amount < 0 ? "background:var(--expense)" : ""}"></div></div>
    </div>`).join("")}</div>`;
  if (onClick) el.querySelectorAll(".bar-row").forEach((r) => r.addEventListener("click", () => onClick(items[+r.dataset.idx])));
}

/**
 * Donut chart with a legend. items: [{label, value, color, sub?}]. Slices under ~1% still show a sliver.
 */
export function donutChart(el, items, { centerLabel = "Total", centerValue, onClick, empty = "Nothing invested yet", label = "Investments by type" } = {}) {
  const list = items.filter((i) => i.value > 0);
  const total = list.reduce((a, i) => a + i.value, 0);
  if (!total) {
    el.innerHTML = `<div class="empty small">${esc(empty)}</div>`;
    return;
  }
  const R = 80, r = 52, C = 100;
  const pt = (a, rad) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  let a0 = 0, s = "";
  list.forEach((i, idx) => {
    const frac = i.value / total;
    const a1 = a0 + Math.max(frac, 0.004) * Math.PI * 2;
    const tip = `<b>${esc(i.label)}</b><br>${money(i.value)} · ${(frac * 100).toFixed(1)}%`;
    if (list.length === 1) {
      s += `<g data-idx="${idx}" data-tip="${esc(tip)}"><circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${i.color}" stroke-width="${R - r}"/></g>`;
    } else {
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
      s += `<path data-idx="${idx}" data-tip="${esc(tip)}" fill="${i.color}" stroke="var(--panel)" stroke-width="1.5"
        d="M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z"/>`;
    }
    a0 = a1;
  });
  s += `<text x="${C}" y="${C - 4}" text-anchor="middle" class="donut-label">${esc(centerLabel)}</text>
        <text x="${C}" y="${C + 16}" text-anchor="middle" class="donut-value">${esc(centerValue ?? moneyShort(total))}</text>`;
  el.innerHTML = `<div class="donut-wrap">
    <div class="chart donut"><svg viewBox="0 0 200 200" role="img" aria-label="${esc(label)}">${s}</svg></div>
    <div class="donut-legend">${list.map((i, idx) => `
      <div class="dl-row ${onClick ? "click" : ""}" data-idx="${idx}">
        <i style="background:${i.color}"></i>
        <span class="dl-name">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>
        <span class="dl-val">${money(i.value)}<small>${((i.value / total) * 100).toFixed(1)}%</small></span>
      </div>`).join("")}</div>
  </div>`;
  bindTips(el);
  if (onClick) el.querySelectorAll("[data-idx]").forEach((n) => n.addEventListener("click", () => onClick(list[+n.dataset.idx])));
}
