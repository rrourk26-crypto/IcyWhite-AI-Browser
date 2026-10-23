/* Theme: Light (IcyWhite, default), Dark, or follow the system.
 * Loaded by the Home page (it has the Appearance menu) and by the browser shell (tab bar), so both change together.
 * The page picks its stylesheet before it paints (small script in <head>); this file keeps it in sync afterwards.
 * The choice is remembered in the page's own storage and in the app's shared preferences (main process), because the
 * shell and the Home page keep separate browser storage. */
(function () {
  "use strict";
  const KEY = "icywhite.theme";
  const api = window.oasisProject || window.oasisElectron || null;   // Home page / shell
  const root = document.documentElement;
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  };
  const valid = (t) => t === "light" || t === "dark" || t === "system";
  const isDark = (t) => t === "dark" || (t === "system" && !!(mq && mq.matches));
  let current = valid(store.get()) ? store.get() : "light";

  function apply(t) {
    current = t;
    const d = isDark(t), link = document.getElementById("themeCss");
    root.setAttribute("data-theme", d ? "dark" : "light");
    if (link) {
      const href = link.getAttribute("href"), shell = /shell-/.test(href);
      const want = shell ? "css/shell-" + (d ? "dark" : "light") + ".css" : "css/style" + (d ? "-dark" : "") + ".css";
      if (href !== want) link.setAttribute("href", want);
    }
    const sel = document.getElementById("setTheme"); if (sel && sel.value !== t) sel.value = t;
    document.dispatchEvent(new CustomEvent("icywhite:theme", { detail: t }));
  }
  function set(t) {
    if (!valid(t)) return;
    store.set(t); apply(t);
    try { if (api && api.setPref) api.setPref("theme", t); } catch (e) {}
  }
  window.icyTheme = { get: () => current, set, isDark: () => isDark(current) };

  if (mq) (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(() => { if (current === "system") apply("system"); });
  try {
    if (api && api.getPref) {
      api.getPref("theme").then((v) => {
        if (valid(v) && v !== current) { store.set(v); apply(v); }
        else if (!valid(v) && current !== "light") api.setPref("theme", current);   // upgrade path: publish what this page already uses
      }).catch(() => {});
      if (api.onPref) api.onPref((k, v) => { if (k === "theme" && valid(v) && v !== current) { store.set(v); apply(v); } });
    }
  } catch (e) {}

  document.addEventListener("DOMContentLoaded", () => {
    apply(current);
    const sel = document.getElementById("setTheme");
    if (sel) { sel.value = current; sel.addEventListener("change", () => set(sel.value)); }
    // top-bar button: flips between light and dark (what you see now -> the other one)
    const btn = document.getElementById("themeBtn");
    if (btn) btn.addEventListener("click", () => set(isDark(current) ? "light" : "dark"));
  });
})();
