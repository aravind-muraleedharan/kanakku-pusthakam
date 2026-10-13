// Apply the saved theme before the page paints (avoids a white flash in dark mode). Loaded before the CSS.
try {
  const t = JSON.parse(localStorage.getItem("aet:theme"));
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) { /* storage blocked: use the system theme */ }
