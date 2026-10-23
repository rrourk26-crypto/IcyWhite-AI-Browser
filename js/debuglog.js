/* Debug log helper for the Home page. The real log lives in the main process (so every window shares it)
   and is shown in a small pop-up window. This file only sends notes to it and opens/copies it.
   Without the desktop bridge (plain browser) it falls back to a local copy of this page's notes. */
(function () {
  "use strict";
  const local = [];
  const pad = (n) => String(n).padStart(2, "0");
  const bridge = () => window.oasisProject || window.oasisElectron || null;
  const stamp = (t) => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
  const localText = () => "IcyWhite debug log (this page only)\n\n" + (local.map((l) => "[" + stamp(l.t) + "] " + l.level.toUpperCase().padEnd(5) + " " + l.msg).join("\n") || "(nothing logged yet)");
  const api = {
    log(level, msg, multi) {
      level = level === "error" || level === "warn" ? level : "info";
      msg = String(msg == null ? "" : msg).slice(0, multi ? 8000 : 1200);
      local.push({ t: Date.now(), level, msg }); if (local.length > 500) local.shift();
      try { const b = bridge(); if (b && b.debugAdd) b.debugAdd(level, msg, !!multi); } catch (e) {}
    },
    async open() {
      try { const b = bridge(); if (b && b.debugOpen) { await b.debugOpen(); return true; } } catch (e) {}
      try {
        const w = window.open("", "_blank", "width=720,height=480");
        if (!w) return false;
        w.document.title = "IcyWhite - Debug log";
        const pre = w.document.createElement("pre"); pre.style.cssText = "white-space:pre-wrap;font:12px/1.5 Consolas,monospace;padding:10px";
        pre.textContent = localText(); w.document.body.appendChild(pre); return true;
      } catch (e) { return false; }
    },
    async copy() {
      try { const b = bridge(); if (b && b.debugCopy) { const r = await b.debugCopy(); if (r && r.ok) return true; } } catch (e) {}
      try { await navigator.clipboard.writeText(localText()); return true; } catch (e) { return false; }
    }
  };
  window.OasisDebug = api;
})();
