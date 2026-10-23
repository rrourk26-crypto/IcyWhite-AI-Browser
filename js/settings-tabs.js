/* Settings tabs: shows one section of the Settings dialog at a time so nothing needs scrolling.
 * Purely visual; every field keeps its id and works exactly as before. The last tab you used is remembered. */
(function () {
  "use strict";
  const bar = document.getElementById("setTabs"), dlg = document.getElementById("settings");
  if (!bar || !dlg) return;
  const KEY = "oasis.settingsTab";
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const put = (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  function show(name) {
    let btn = bar.querySelector('[data-go="' + name + '"]');
    if (!btn || btn.hidden) { name = "general"; btn = bar.querySelector('[data-go="general"]'); }
    bar.querySelectorAll("[data-go]").forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
    dlg.querySelectorAll("[data-tab]").forEach((el) => el.classList.toggle("on", el.getAttribute("data-tab") === name));
    put(name);
  }
  bar.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) show(b.getAttribute("data-go")); });
  document.addEventListener("lmchat:settingsOpen", () => show(get() || "general"));
  // Test connection result lives under the Connection tab's fields; bring the user there.
  const t = document.getElementById("testBtn"); if (t) t.addEventListener("click", () => show("connection"));
  show(get() || "general");
})();
