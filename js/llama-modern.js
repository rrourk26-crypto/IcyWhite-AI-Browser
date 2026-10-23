/* Local model settings, modern controls: switches instead of On/Off drop-downs, segmented pickers instead of short
 * drop-downs, sliders next to number boxes, and an "Apply changes" bar that reloads the model.
 *
 * This file only dresses up the existing controls in #llamaBlock. Every original <select>/<input> stays in the page
 * (hidden or beside the new control) and keeps its id, so llama-local.js saves, loads and starts exactly as before.
 * New controls write their value into the original and fire its "change" event.
 */
(function () {
  "use strict";
  const block = document.getElementById("llamaBlock");
  if (!block) return;
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const SEG_SHORT = { llamaHostSel: { "127.0.0.1": "This computer", "0.0.0.0": "Local network", custom: "Specific address" }, llamaCors: { all: "All websites", origins: "Listed only", off: "Nobody" } };

  const syncers = [];

  /* ---------- switch (replaces On/Off selects and the auto-start checkbox) ---------- */
  function mkSwitch(label) {
    const b = document.createElement("button"); b.type = "button"; b.className = "msw"; b.setAttribute("role", "switch");
    b.setAttribute("aria-label", label || "toggle"); b.innerHTML = "<i></i>"; return b;
  }
  function enhanceToggleSelect(sel, lab) {
    const sw = mkSwitch(lab.firstChild && lab.firstChild.textContent.trim());
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "mreset"; reset.textContent = "Default"; reset.title = "Go back to the default";
    sel.classList.add("m-hide"); lab.classList.add("m-sw");
    const side = document.createElement("span"); side.className = "m-side"; side.append(reset, sw);
    lab.insertBefore(side, sel);
    sw.onclick = (e) => { e.preventDefault(); sel.value = sel.value === "on" ? "off" : "on"; fire(sel, "change"); sync(); };
    reset.onclick = (e) => { e.preventDefault(); sel.value = ""; fire(sel, "change"); sync(); };
    function sync() {
      const v = sel.value;
      sw.dataset.state = v === "on" ? "on" : v === "off" ? "off" : "default";
      sw.setAttribute("aria-checked", v === "on" ? "true" : v === "off" ? "false" : "mixed");
      reset.hidden = v === "";
      sw.title = v === "" ? "Using the default: click to turn on or off" : (v === "on" ? "On" : "Off");
    }
    syncers.push(sync); sync();
  }
  function enhanceCheckbox(chk) { chk.closest("label").classList.add("m-sw", "m-chk"); }

  /* ---------- segmented picker (replaces drop-downs with up to 4 short choices) ---------- */
  function enhanceSegSelect(sel) {
    const seg = document.createElement("div"); seg.className = "mseg"; seg.setAttribute("role", "radiogroup");
    const map = SEG_SHORT[sel.id] || {};
    [...sel.options].forEach((o) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.v = o.value; b.setAttribute("role", "radio");
      b.textContent = map[o.value] || o.textContent.replace(/\s*\(.*\)\s*$/, ""); b.title = o.textContent;
      b.onclick = (e) => { e.preventDefault(); sel.value = o.value; fire(sel, "change"); sync(); };
      seg.appendChild(b);
    });
    sel.classList.add("m-hide"); sel.after(seg);
    function sync() { seg.querySelectorAll("button").forEach((b) => { const on = b.dataset.v === sel.value; b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false"); }); }
    syncers.push(sync); sync();
  }

  /* ---------- slider beside the number box ---------- */
  const SLIDERS = {
    llamaCtx: { list: [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144], fmt: (v) => v >= 1024 ? Math.round(v / 1024) + "K" : v },
    llamaNgl: { min: 0, max: 99, step: 1, ends: ["CPU", "All"] }, lmMax: { min: 1, max: 9, step: 1 },
    lo_parallel: { min: 1, max: 16, step: 1 }, lo_threads: { min: 1, max: 64, step: 1 }, lo_threadsBatch: { min: 1, max: 64, step: 1 },
    lo_batch: { list: [128, 256, 512, 1024, 2048, 4096, 8192] }, lo_ubatch: { list: [32, 64, 128, 256, 512, 1024, 2048] },
    lo_mainGpu: { min: 0, max: 7, step: 1 }, lo_ropeScale: { min: 0.25, max: 8, step: 0.25 },
    lo_temp: { min: 0, max: 2, step: 0.05 }, lo_topK: { min: 0, max: 200, step: 1 },
    lo_topP: { min: 0, max: 1, step: 0.01 }, lo_minP: { min: 0, max: 1, step: 0.01 }, lo_repeatPenalty: { min: 0.5, max: 2, step: 0.01 }
  };
  function enhanceSlider(num, spec) {
    const wrap = document.createElement("div"); wrap.className = "mslider";
    const r = document.createElement("input"); r.type = "range"; r.className = "mrange";
    if (spec.list) { r.min = 0; r.max = spec.list.length - 1; r.step = 1; } else { r.min = spec.min; r.max = spec.max; r.step = spec.step; }
    r.setAttribute("aria-label", (num.closest("label").firstChild.textContent || "").trim());
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "mreset"; reset.textContent = "Default"; reset.title = "Go back to the default";
    num.classList.add("mnum");
    num.before(wrap); wrap.append(r, num);
    if (num.dataset.opt) wrap.appendChild(reset);
    let ticks = null;
    if (spec.list) { ticks = document.createElement("div"); ticks.className = "mticks"; spec.list.forEach((v) => { const s = document.createElement("span"); s.textContent = spec.fmt ? spec.fmt(v) : v; ticks.appendChild(s); }); wrap.after(ticks); }
    else if (spec.ends) { ticks = document.createElement("div"); ticks.className = "mticks ends"; spec.ends.forEach((t) => { const s = document.createElement("span"); s.textContent = t; ticks.appendChild(s); }); wrap.after(ticks); }
    const toIdx = (v) => { let best = 0, d = Infinity; spec.list.forEach((x, i) => { const dd = Math.abs(Math.log(x) - Math.log(Math.max(1, v))); if (dd < d) { d = dd; best = i; } }); return best; };
    r.addEventListener("input", () => { num.value = spec.list ? spec.list[+r.value] : r.value; wrap.classList.remove("is-default"); });
    r.addEventListener("change", () => { num.value = spec.list ? spec.list[+r.value] : r.value; fire(num, "change"); sync(); });
    reset.onclick = (e) => { e.preventDefault(); num.value = ""; fire(num, "change"); sync(); };
    num.addEventListener("change", sync); num.addEventListener("input", sync);
    function sync() {
      const has = num.value !== "" && Number.isFinite(Number(num.value));
      wrap.classList.toggle("is-default", !has); reset.hidden = !has;
      if (has) r.value = spec.list ? toIdx(Number(num.value)) : Number(num.value); else r.value = spec.list ? 0 : spec.min;
      const pct = ((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100;
      r.style.setProperty("--p", (has ? pct : 0) + "%");
      if (ticks && spec.list) [...ticks.children].forEach((s, i) => s.classList.toggle("on", has && i === +r.value));
    }
    syncers.push(sync); sync();
  }

  /* ---------- go through the panel (idempotent; the schema sections appear a moment after opening) ---------- */
  function enhance() {
    block.querySelectorAll("select").forEach((sel) => {
      if (sel.dataset.enh) return;
      if (["llamaModel", "llamaRuntime", "lmModel"].includes(sel.id)) { sel.dataset.enh = "1"; return; }
      const lab = sel.closest("label.lfield, label");
      const opts = [...sel.options].map((o) => o.value);
      if (opts.length === 3 && opts.includes("on") && opts.includes("off") && opts.includes("") && lab) { sel.dataset.enh = "1"; enhanceToggleSelect(sel, lab); }
      else if (opts.length >= 2 && opts.length <= 4 && sel.id !== "") { sel.dataset.enh = "1"; enhanceSegSelect(sel); }
    });
    block.querySelectorAll("input[type=number]").forEach((n) => { if (!n.dataset.enh && SLIDERS[n.id]) { n.dataset.enh = "1"; enhanceSlider(n, SLIDERS[n.id]); } });
    const auto = $("llamaAuto"); if (auto && !auto.dataset.enh) { auto.dataset.enh = "1"; enhanceCheckbox(auto); }
  }
  new MutationObserver(enhance).observe(block, { childList: true, subtree: true });
  enhance();

  /* ---------- keep the new controls in step when the form is refilled or reset ---------- */
  setInterval(() => { if (block.offsetParent !== null) syncers.forEach((f) => f()); }, 400);

  /* ---------- Apply changes bar ---------- */
  const bar = $("llamaApplyBar"), btn = $("llamaApply"), msg = $("llamaApplyMsg"), pend = $("llamaPending");
  function paintApply() {
    const info = window.oasisLlama && window.oasisLlama.info(), st = info && info.status && info.status.state;
    const dirty = pend && !pend.hidden;
    bar.dataset.state = st === "starting" ? "loading" : dirty ? "dirty" : "clean";
    if (st === "starting") { msg.textContent = "Reloading the model…"; btn.textContent = "Reloading…"; btn.disabled = true; }
    else if (dirty) { msg.textContent = "You changed settings. Reload the model to use them."; btn.textContent = "Apply changes"; btn.disabled = false; }
    else if (st === "ready") { msg.textContent = "All changes are applied."; btn.textContent = "Apply changes"; btn.disabled = true; }
    else { msg.textContent = "Model is stopped. Settings are saved and used when you press Start & use."; btn.textContent = "Apply changes"; btn.disabled = true; }
  }
  btn.onclick = () => { $("llamaStart").click(); setTimeout(paintApply, 50); };
  if (pend) new MutationObserver(paintApply).observe(pend, { attributes: true, attributeFilter: ["hidden"] });
  setInterval(() => { if (block.offsetParent !== null) paintApply(); }, 500);
  paintApply();
})();
