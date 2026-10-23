/* Theme colors: lets you change the text, left toolbar, browser bar and accent colors, separately for Light and Dark.
 * Loaded by the Home page (which has the picker in Settings > General) and by the browser shell, so both follow along.
 * Nothing is changed until you pick a color; "Reset" puts the original colors back.
 * Saved in the page's storage and in the app's shared preferences (like the theme), so the shell and Home stay in sync. */
(function () {
  "use strict";
  const KEY = "icywhite.colors";
  const api = window.oasisProject || window.oasisElectron || null;
  const root = document.documentElement;
  const FIELDS = ["text", "rail", "browser", "accent"];
  const DEFAULTS = {
    light: { text: "#14202e", rail: "#0b0f16", browser: "#eef2f7", accent: "#2b7fd6" },
    dark:  { text: "#eef3fa", rail: "#0b0f16", browser: "#131a26", accent: "#78b8ff" }
  };
  const PRESETS = [
    { name: "Default", light: {}, dark: {} },
    { name: "Ocean",    light: { text: "#0b2540", rail: "#0c2d4d", browser: "#e3f0fb", accent: "#0a84d6" }, dark: { text: "#e6f3ff", rail: "#06182a", browser: "#0f2338", accent: "#5ec2ff" } },
    { name: "Forest",   light: { text: "#12301f", rail: "#12301f", browser: "#e6f2e8", accent: "#2e8b57" }, dark: { text: "#e6f5ea", rail: "#0a1a10", browser: "#12261a", accent: "#5fd18a" } },
    { name: "Rose",     light: { text: "#3a1224", rail: "#3d1428", browser: "#fbe9f0", accent: "#d6336c" }, dark: { text: "#fde8f1", rail: "#1d0a14", browser: "#2a1420", accent: "#ff7aa8" } },
    { name: "Sunset",   light: { text: "#3a1f0e", rail: "#4a2410", browser: "#fdeede", accent: "#e8731a" }, dark: { text: "#ffeedd", rail: "#1f0f06", browser: "#2a1a10", accent: "#ffa24d" } },
    { name: "Violet",   light: { text: "#241442", rail: "#241442", browser: "#efe9fb", accent: "#6d4ae0" }, dark: { text: "#f0eaff", rail: "#120a24", browser: "#1c1430", accent: "#a98bff" } },
    { name: "Graphite", light: { text: "#1c1f24", rail: "#1c1f24", browser: "#e9ebee", accent: "#4a5568" }, dark: { text: "#eceef1", rail: "#0e1012", browser: "#1a1d21", accent: "#9aa5b5" } }
  ];
  const HEX = /^#[0-9a-f]{6}$/i;

  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  };
  function parse(raw) {
    const out = { light: {}, dark: {} };
    try {
      const o = JSON.parse(raw || "{}");
      ["light", "dark"].forEach((m) => FIELDS.forEach((f) => { const v = o && o[m] && o[m][f]; if (typeof v === "string" && HEX.test(v)) out[m][f] = v.toLowerCase(); }));
    } catch (e) {}
    return out;
  }
  let colors = parse(store.get());

  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function lum(h) { const c = rgb(h).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  const readableOn = (bg) => (lum(bg) > .45 ? "#10161f" : "#f2f6fb");
  const isDark = () => root.getAttribute("data-theme") === "dark";

  let styleEl = null;
  function css() {
    const mode = isDark() ? "dark" : "light", d = DEFAULTS[mode], c = colors[mode];
    if (!FIELDS.some((f) => c[f])) return "";
    const rules = [];
    const browser = c.browser || d.browser;
    if (c.text) {
      const t = c.text;
      rules.push(":root{--text:" + t + "!important;--muted:color-mix(in srgb," + t + " 76%,transparent)!important;--faint:color-mix(in srgb," + t + " 58%,transparent)!important}");
      rules.push("body,.card h3,.status-line,.recent b,.chip,#foot,.msg .body{color:" + t + "}");
      const ct = contrast(t, browser) >= 3 ? t : readableOn(browser);
      rules.push(".tab,.tab.active,.navbtn,#newtab,.ddItem,.ddTitle,.ddPanelTitle,.ddZoomBtn,.ddZoomPct,.ddCheck,.ddFooterBtn,#address,.ddInput,#aiHead,.tool,#aiInput,#findInput,#findBar button,.ddBack,.topbar,.pill-btn,#btAddr{color:" + ct + "!important}");
    }
    if (c.rail) {
      const r = c.rail, fg = readableOn(r), hov = lum(r) > .45 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.09)";
      rules.push(":root{--rail:" + r + "!important}");
      rules.push("body:not(.rail-hidden) #rail{background:" + r + "!important}");
      rules.push("body.rail-hidden .logo{background:" + r + "!important}");
      rules.push("#rail .rail-item,#rail .avatar{color:" + fg + "!important}#rail .rail-item:hover{background:" + hov + "!important}");
    }
    if (c.browser) {
      const b = c.browser, dk = mode === "dark";
      const tabIn = "color-mix(in srgb," + b + " 90%," + (dk ? "white" : "black") + ")";
      const tabOn = "color-mix(in srgb," + b + " 70%," + (dk ? "white" : "white") + ")";
      const addr = "color-mix(in srgb," + b + " 55%," + (dk ? "black" : "white") + ")";
      rules.push("#chrome{background:" + b + "!important}");
      rules.push(".tab{background:" + tabIn + "!important}.tab.active{background:" + tabOn + "!important;border-bottom-color:" + tabOn + "!important}");
      rules.push("#address,.ddInput,#findInput{background:" + addr + "!important}#address:focus{background:" + addr + "!important}");
      rules.push(".dropdown,#findBar{background:color-mix(in srgb," + b + " 85%," + (dk ? "black" : "white") + ")!important}");
      rules.push(".topbar{background:color-mix(in srgb," + b + " 82%,transparent)!important}");
    }
    if (c.accent) {
      const a = c.accent, on = readableOn(a);
      rules.push(":root{--accent:" + a + "!important}");
      rules.push(".dlg-actions button.primary,#setTabs button[aria-selected=\"true\"],#providerChips button.active,#send,.wl-box button.primary,.wl-seg button.on,.ddFooterBtn.ddPrimary,#aiSend{background:" + a + "!important;color:" + on + "!important}");
      rules.push(".tab.dropBefore{box-shadow:inset 4px 0 0 " + a + "!important}.tab.dropAfter{box-shadow:inset -4px 0 0 " + a + "!important}");
    }
    return rules.join("\n");
  }
  function paint() {
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "icyColors"; document.head.appendChild(styleEl); }
    styleEl.textContent = css();
    renderUi();
  }
  function save() {
    const raw = JSON.stringify(colors);
    store.set(raw);
    try { if (api && api.setPref) api.setPref("colors", raw); } catch (e) {}
    paint();
  }

  /* ---- Settings UI (Home page only: it has #themeColors) ---- */
  const mode = () => (isDark() ? "dark" : "light");
  function renderUi() {
    const box = document.getElementById("themeColors"); if (!box) return;
    const m = mode(), d = DEFAULTS[m];
    const lbl = box.querySelector("#tcMode"); if (lbl) lbl.textContent = m === "dark" ? "Dark" : "Light";
    FIELDS.forEach((f) => {
      const inp = box.querySelector('[data-tc="' + f + '"]'); if (!inp) return;
      const v = colors[m][f] || d[f];
      if (inp.value.toLowerCase() !== v) inp.value = v;
      const row = inp.closest(".tc-row"); if (row) row.classList.toggle("custom", !!colors[m][f]);
    });
  }
  function buildUi() {
    const box = document.getElementById("themeColors"); if (!box) return;
    const pre = box.querySelector("#tcPresets");
    if (pre && !pre.children.length) {
      PRESETS.forEach((p, i) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = p.name; b.dataset.preset = String(i);
        const sw = p.light.accent || DEFAULTS.light.accent;
        b.style.setProperty("--sw", sw);
        pre.appendChild(b);
      });
      pre.addEventListener("click", (e) => {
        const b = e.target.closest("[data-preset]"); if (!b) return;
        const p = PRESETS[+b.dataset.preset];
        colors = { light: Object.assign({}, p.light), dark: Object.assign({}, p.dark) };
        save();
      });
    }
    box.addEventListener("input", (e) => {
      const f = e.target && e.target.getAttribute && e.target.getAttribute("data-tc"); if (!f) return;
      if (HEX.test(e.target.value)) { colors[mode()][f] = e.target.value.toLowerCase(); paint(); }
    });
    box.addEventListener("change", (e) => { if (e.target && e.target.getAttribute && e.target.getAttribute("data-tc")) save(); });
    box.addEventListener("click", (e) => {
      const r = e.target.closest("[data-tc-reset]"); if (!r) return;
      const f = r.getAttribute("data-tc-reset");
      if (f === "all") colors = { light: {}, dark: {} }; else delete colors[mode()][f];
      save();
    });
    renderUi();
  }

  document.addEventListener("icywhite:theme", paint);
  try {
    if (api && api.getPref) {
      api.getPref("colors").then((v) => {
        if (typeof v === "string" && v !== JSON.stringify(colors)) { colors = parse(v); store.set(JSON.stringify(colors)); paint(); }
        else if (typeof v !== "string" && FIELDS.some((f) => colors.light[f] || colors.dark[f])) api.setPref("colors", JSON.stringify(colors));
      }).catch(() => {});
      if (api.onPref) api.onPref((k, v) => { if (k === "colors" && typeof v === "string") { colors = parse(v); store.set(JSON.stringify(colors)); paint(); } });
    }
  } catch (e) {}
  const start = () => { paint(); buildUi(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
