/* Settings: search box + one-section-at-a-time advanced sections.
 *  - Type in "Search settings" to find a setting in any tab (matches its name, hint and choices). Clearing it brings back the tab you were on.
 *  - Inside Local model, opening one advanced section (Server & network, Performance, Sampling, Command line, Server log) closes the others,
 *    so the tab stays short.
 * Purely visual: every field keeps its id and keeps working. */
(function () {
  "use strict";
  const dlg = document.getElementById("settings"), form = document.getElementById("settingsForm"), tabs = document.getElementById("setTabs"), box = document.getElementById("setSearch");
  if (!dlg || !form || !tabs || !box) return;
  const empty = document.getElementById("setSearchEmpty");
  let searching = false;

  const textOf = (el) => {
    let t = el.textContent || "";
    el.querySelectorAll("input,select,textarea,button").forEach((c) => { t += " " + (c.placeholder || "") + " " + (c.title || "") + " " + (c.getAttribute("aria-label") || ""); });
    return t.toLowerCase().replace(/\s+/g, " ");
  };
  const rowsSel = "label, #providerChips, .model-settings, .tc-row, .vblock > small, .vblock > .tc-head, #llamaMulti, #llamaAddr, #llamaStatusText";
  const containersSel = ".vblock, details.lset, details, .two-col, .tc-grid, .settings-cols > div";
  const inMulti = (el) => { const m = el.closest("#llamaMulti"); return m && m !== el; };

  function clear() {
    searching = false; dlg.classList.remove("searching");
    form.querySelectorAll(".s-hide").forEach((e) => e.classList.remove("s-hide"));
    if (empty) empty.hidden = true;
    const cur = tabs.querySelector('[aria-selected="true"]'); if (cur) cur.click();   // back to the tab you were on
  }
  function run() {
    const q = box.value.trim().toLowerCase();
    if (!q) { if (searching) clear(); return; }
    const tokens = q.split(/\s+/);
    if (!searching) { searching = true; dlg.classList.add("searching"); }
    const cur = tabs.querySelector('[aria-selected="true"]'); if (cur) dlg.dataset.prevTab = cur.getAttribute("data-go");
    form.querySelectorAll("[data-tab]").forEach((e) => { if (!e.hidden) e.classList.add("on"); });   // show every tab's content
    tabs.querySelectorAll("[data-go]").forEach((b) => b.setAttribute("aria-selected", "false"));
    form.querySelectorAll(".s-hide").forEach((e) => e.classList.remove("s-hide"));
    const match = (el) => { const t = textOf(el); return tokens.every((k) => t.includes(k)); };
    let shown = 0;
    form.querySelectorAll(rowsSel).forEach((r) => {
      if (inMulti(r)) return;
      const ok = match(r); r.classList.toggle("s-hide", !ok); if (ok && !r.hidden) shown++;
    });
    const conts = [...form.querySelectorAll(containersSel)].reverse();   // innermost first
    conts.forEach((c) => {
      if (c.matches("details") && c.closest("#lsCmd") && false) return;
      const head = c.querySelector(":scope > h3, :scope > summary, :scope > .tc-head");
      const headMatch = head && match(head);
      if (headMatch) { c.querySelectorAll(".s-hide").forEach((e) => e.classList.remove("s-hide")); c.classList.remove("s-hide"); if (c.matches("details")) c.open = true; shown++; return; }
      const vis = c.querySelector(rowsSel) ? [...c.querySelectorAll(rowsSel)].some((r) => !r.classList.contains("s-hide") && !inMulti(r) && !r.closest(".s-hide")) : true;
      const hasRows = !!c.querySelector(rowsSel);
      c.classList.toggle("s-hide", hasRows && !vis);
      if (c.matches("details") && hasRows && vis) c.open = true;
    });
    if (empty) empty.hidden = shown > 0;
  }
  box.addEventListener("input", run);
  box.addEventListener("search", run);
  box.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.value) { e.preventDefault(); e.stopPropagation(); box.value = ""; run(); } if (e.key === "Enter") e.preventDefault(); });
  document.addEventListener("lmchat:settingsOpen", () => { box.value = ""; if (searching) clear(); });
  dlg.addEventListener("close", () => { box.value = ""; if (searching) clear(); });
  // clicking a tab while a search is showing leaves the search
  tabs.addEventListener("click", () => { if (searching) { box.value = ""; searching = false; dlg.classList.remove("searching"); form.querySelectorAll(".s-hide").forEach((e) => e.classList.remove("s-hide")); if (empty) empty.hidden = true; } }, true);

  // one advanced section open at a time in Local model (not while searching)
  document.querySelectorAll("#llamaBlock details").forEach((d) => {
    d.addEventListener("toggle", () => {
      if (!d.open || searching) return;
      document.querySelectorAll("#llamaBlock details").forEach((o) => { if (o !== d) o.open = false; });
    });
  });
})();
