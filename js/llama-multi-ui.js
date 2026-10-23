/* "Models running": run more than one local model at once (extra llama-servers, see llama-multi.js in the main process).
 * The main model and its buttons are untouched. Extra models are listed here; each can be used in the chat, tuned, stopped,
 * restarted or removed. Running extras also get a quick-set button next to LM Studio / Ollama / Local model.
 */
(function () {
  "use strict";
  const api = window.oasisProject, $ = (id) => document.getElementById(id);
  if (!api || typeof api.llamaMultiList !== "function" || !$("llamaMulti")) return;
  const block = $("llamaBlock"), dlg = $("settings"), listEl = $("lmList");
  let data = { max: 3, running: 0, slots: [] }, models = [], expanded = new Set(), lastKey = "", timer = null, working = false;
  const CTX = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
  const gb = (n) => n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1048576)) + " MB";
  const kfmt = (v) => v >= 1024 ? Math.round(v / 1024) + "K" : String(v);
  const stem = (m) => String(m || "").split("/").pop().replace(/\.gguf$/i, "");
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const msg = (t, bad) => { const m = $("lmMsg"); m.textContent = t || ""; m.style.color = bad ? "var(--bad)" : ""; };
  const llamaInfo = () => (window.oasisLlama && window.oasisLlama.info()) || {};
  const nearestCtx = (v) => { let b = 0, d = 1e9; CTX.forEach((x, i) => { const dd = Math.abs(Math.log(x) - Math.log(Math.max(1, v))); if (dd < d) { d = dd; b = i; } }); return b; };

  function fillModelSelect() {
    const sel = $("lmModel"), want = sel.value, info = llamaInfo();
    models = info.models || [];
    const key = models.map((m) => m.id).join("|");
    if (sel.dataset.key === key) return;
    sel.dataset.key = key; sel.innerHTML = "";
    if (!models.length) { sel.appendChild(new Option("(no .gguf files found)", "")); return; }
    models.forEach((m) => sel.appendChild(new Option(m.id + "  ·  " + gb(m.size) + (m.mmproj ? "  ·  vision" : ""), m.id)));
    sel.value = models.some((m) => m.id === want) ? want : models[0].id;
  }
  const sizeOf = (id) => { const m = models.find((x) => x.id === id); return m ? m.size : 0; };

  function stateText(s) {
    if (s.state === "ready") return "Running";
    if (s.state === "starting") return "Loading…";
    if (s.state === "error") return "Problem";
    return "Stopped";
  }
  function slider(label, min, max, step, val, fmt, onChange) {
    const wrap = el("label", "lm-sl"); wrap.appendChild(el("span", "", label));
    const r = document.createElement("input"); r.type = "range"; r.className = "mrange"; r.min = min; r.max = max; r.step = step; r.value = val;
    const out = el("b", "lm-val", fmt(val));
    const paint = () => { r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"); out.textContent = fmt(Number(r.value)); };
    r.addEventListener("input", () => { paint(); onChange(Number(r.value)); }); paint();
    wrap.append(r, out); return wrap;
  }

  function rowFor(s) {
    const row = el("div", "lm-row " + s.state); row.dataset.id = s.id;
    const top = el("div", "lm-top");
    top.appendChild(el("span", "lm-dot"));
    const nm = el("div", "lm-name"); nm.appendChild(el("b", "", stem(s.model)));
    nm.appendChild(el("small", "", "port " + s.port + " · " + kfmt(s.ctx) + " context · " + (s.ngl >= 99 ? "all layers on GPU" : s.ngl === 0 ? "CPU" : s.ngl + " GPU layers") + (s.vision ? " · vision" : "") + " · " + stateText(s)));
    top.appendChild(nm);
    const act = el("div", "lm-act");
    const mk = (t, fn, cls, dis) => { const b = el("button", cls || "", t); b.type = "button"; b.disabled = !!dis; b.onclick = fn; act.appendChild(b); return b; };
    mk("Use in chat", () => { if (window.oasisLlamaUse) window.oasisLlamaUse(s.apiBase); paintChips(); msg("Chat is now using " + stem(s.model) + "."); }, "primary", s.state !== "ready");
    mk("Settings", () => { expanded.has(s.id) ? expanded.delete(s.id) : expanded.add(s.id); lastKey = ""; paint(); });
    if (s.state === "ready" || s.state === "starting") mk("Stop", () => run(() => api.llamaMultiStop(s.id)));
    else mk("Start", async () => { if (await askFit(s.model, s.ctx, s.ngl, false)) run(() => api.llamaMultiReload(s.id)); });
    mk("Remove", () => run(() => api.llamaMultiRemove(s.id)), "lm-rm");
    top.appendChild(act); row.appendChild(top);
    if (s.note && s.state !== "ready") row.appendChild(el("small", "lm-err", s.note));
    if (s.state === "error") row.appendChild(el("small", "lm-err", s.error + (s.hint ? "\n" + s.hint : "")));
    if (s.state === "ready" && s.addresses && s.addresses[0]) {
      const a = el("div", "lm-addr"); a.appendChild(el("code", "", s.addresses[0].url));
      const c = el("button", "", "Copy"); c.type = "button"; c.onclick = () => { try { navigator.clipboard.writeText(s.addresses[0].url); c.textContent = "Copied"; setTimeout(() => { c.textContent = "Copy"; }, 1200); } catch (e) {} };
      a.appendChild(c); row.appendChild(a);
    }
    if (expanded.has(s.id)) {
      const ed = el("div", "lm-edit"); let ctx = s.ctx, ngl = s.ngl;
      ed.appendChild(slider("Context size (tokens)", 0, CTX.length - 1, 1, nearestCtx(s.ctx), (i) => kfmt(CTX[i]) , (i) => { ctx = CTX[i]; }));
      ed.appendChild(slider("GPU layers (0 = CPU, 99 = all)", 0, 99, 1, Math.min(99, s.ngl), (v) => String(v), (v) => { ngl = v; }));
      const ap = el("button", "primary", s.state === "ready" || s.state === "starting" ? "Apply changes" : "Apply & start"); ap.type = "button";
      ap.onclick = async () => { const run1 = s.state === "ready" || s.state === "starting"; if (await askFit(s.model, ctx, ngl, run1)) run(() => api.llamaMultiReload(s.id, { ctx, ngl })); };
      ed.appendChild(ap); row.appendChild(ed);
    }
    return row;
  }
  function mainRow() {
    const info = llamaInfo(), st = info.status; if (!st) return null;
    const row = el("div", "lm-row main " + st.state), top = el("div", "lm-top");
    top.appendChild(el("span", "lm-dot"));
    const nm = el("div", "lm-name"), b = el("b", "", st.model ? stem(st.model) : "Main model"); nm.appendChild(b); nm.appendChild(el("span", "lm-badge", "Main"));
    nm.appendChild(el("small", "", st.state === "stopped" ? "Stopped. Use Start & use above." : "port " + st.port + " · " + kfmt(st.ctx || 0) + " context · " + stateText(st) + (st.vision ? " · vision" : "")));
    top.appendChild(nm);
    const act = el("div", "lm-act"), u = el("button", "primary", "Use in chat"); u.type = "button"; u.disabled = st.state !== "ready";
    u.onclick = () => { if (window.oasisUseLocal) window.oasisUseLocal(); paintChips(); msg("Chat is now using " + stem(st.model) + "."); };
    act.appendChild(u); top.appendChild(act); row.appendChild(top); return row;
  }

  function paint() {
    fillModelSelect();
    const st = llamaInfo().status || {};
    const key = JSON.stringify([data.slots.map((s) => [s.id, s.state, s.port, s.ctx, s.ngl, s.error, s.vision]), [...expanded], st.state, st.model, st.port, st.ctx, models.length]);
    const total = (st.state === "ready" || st.state === "starting" ? sizeOf(st.model) : 0) + data.slots.filter((s) => s.state === "ready" || s.state === "starting").reduce((a, s) => a + sizeOf(s.model), 0);
    $("lmTotal").textContent = data.running ? "· " + data.running + " loaded" + (total ? " · about " + gb(total) + " of model files" : "") : "";
    if (document.activeElement && listEl.contains(document.activeElement) && document.activeElement.type === "range") return;   // do not redraw while dragging a slider
    if (key !== lastKey) {
      lastKey = key; listEl.textContent = "";
      const m = mainRow(); if (m) listEl.appendChild(m);
      data.slots.forEach((s) => listEl.appendChild(rowFor(s)));
      if (!data.slots.length) listEl.appendChild(el("small", "lm-empty", "Only the main model is loaded. Pick another model below and press Add model to run it at the same time."));
    }
    $("lmStopAll").disabled = !data.slots.some((s) => s.state === "ready" || s.state === "starting");
    $("lmAdd").disabled = working || !models.length;
    if (document.activeElement !== $("lmMax")) { if (Number($("lmMax").value) !== data.max) { $("lmMax").value = data.max; $("lmMax").dispatchEvent(new Event("input")); } }
    window.oasisLlamaExtraCtx = (u) => { const m = data.slots.find((s) => s.apiBase && s.apiBase === String(u || "").trim()); return m ? m.ctx : 0; };
    window.oasisLlamaExtraUrls = data.slots.filter((s) => s.apiBase).map((s) => s.apiBase);
    paintChips();
  }

  /* quick-set buttons for the running extra models, next to LM Studio / Ollama / Local model */
  function paintChips() {
    const box = $("providerChips"); if (!box) return;
    const ready = data.slots.filter((s) => s.state === "ready" && s.apiBase);
    const key = ready.map((s) => s.apiBase + s.model).join("|");
    if (box.dataset.lmKey !== key) {
      box.querySelectorAll("[data-llama-extra]").forEach((b) => b.remove());
      ready.forEach((s) => {
        const b = document.createElement("button"); b.type = "button"; b.dataset.llamaExtra = s.apiBase;
        b.title = s.model + " at " + s.apiBase; b.append(stem(s.model).slice(0, 22) + " ");
        const sm = document.createElement("small"); sm.textContent = ":" + s.port; b.appendChild(sm);
        b.onclick = () => { if (window.oasisLlamaUse) window.oasisLlamaUse(s.apiBase); paintChips(); };
        box.appendChild(b);
      });
      box.dataset.lmKey = key;
    }
    const cur = ($("setUrl") && $("setUrl").value || "").trim();
    box.querySelectorAll("[data-llama-extra]").forEach((b) => b.classList.toggle("active", b.dataset.llamaExtra === cur));
  }
  if ($("setUrl")) $("setUrl").addEventListener("input", paintChips);

  async function pull() {
    try { const r = await api.llamaMultiList(); if (r && !r.error) data = r; } catch (e) {}
    paint(); schedule();
  }
  function schedule() {
    clearTimeout(timer);
    const need = (dlg && dlg.open) || data.slots.some((s) => s.state === "starting");
    if (need) timer = setTimeout(pull, 1500);
  }
  async function run(fn) {
    working = true; msg("");
    try { const r = await fn(); if (r && r.error) msg(r.error, true); else if (r && r.slots) data = r; } catch (e) { msg(String((e && e.message) || e), true); }
    working = false; lastKey = ""; await pull();
  }

  // true = go ahead (asks only when the model clearly will not fit; a reload of a running model is not asked)
  const askFit = (model, ctx, ngl, reloading) => (window.oasisLlamaConfirmFit ? window.oasisLlamaConfirmFit(model, { ctx, ngl }, reloading) : Promise.resolve(true));
  $("lmAdd").onclick = async () => {
    const model = $("lmModel").value; if (!model) return;
    const ctx = parseInt($("llamaCtx").value, 10) || undefined, ngl = parseInt($("llamaNgl").value, 10);
    if (!(await askFit(model, ctx || 8192, Number.isFinite(ngl) ? ngl : 99, false))) return;
    run(() => api.llamaMultiAdd({ model, ctx, ngl: Number.isFinite(ngl) ? ngl : undefined }));
  };
  $("lmStopAll").onclick = () => run(() => api.llamaMultiStopAll());
  $("lmMax").addEventListener("change", () => run(() => api.llamaMultiMax($("lmMax").value)));
  document.addEventListener("lmchat:settingsOpen", () => { lastKey = ""; pull(); });
  document.addEventListener("oasis:provider-switched", paintChips);
  (async () => { await pull(); setInterval(() => { if (dlg && dlg.open) paint(); }, 1500); })();
})();
