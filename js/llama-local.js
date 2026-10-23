/* Local model (llama.cpp) — the "Local model" block in Settings.
 *
 * Talks to llama-manager.js in the main process through window.oasisProject.llama* (only exists inside the Oasis app,
 * so in a normal browser this file does nothing and the block stays hidden). When a model is running it points the
 * chat at http://127.0.0.1:<port>/v1 — the same kind of address LM Studio uses — through the window.lmchat hook in
 * app.js. "Use LM Studio" puts the old address back. Nothing else in the app is changed.
 */
(function () {
  "use strict";
  const api = window.oasisProject;
  const chat = window.lmchat;
  const $ = (id) => document.getElementById(id);
  if (!api || typeof api.llamaStatus !== "function" || !chat || !$("llamaBlock")) return;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const USE_KEY = "oasis.useLocalLlama", PREV_KEY = "oasis.lmStudioUrl", PREV_SHELL_KEY = "oasis.lmStudioShellUrl";
  const isLocalUrl = (u) => /^https?:\/\/127\.0\.0\.1:\d+\/v1\/?$/i.test(String(u || "").trim()) || !!(status && status.apiBase && String(u || "").trim() === status.apiBase);
  const dlg = $("settings");
  // Extra models running next to the main one (js/llama-multi-ui.js keeps this list). The chat may be pointed at one of them.
  const isExtraUrl = (u) => (window.oasisLlamaExtraUrls || []).includes(String(u || "").trim());

  let status = null, models = [], timer = null, busy = false, formFilled = false;
  let useLocal = ls.get(USE_KEY) === "1";

  const gb = (n) => n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1048576)) + " MB";
  const setText = (id, t) => { $(id).textContent = t; };

  function setUrlField(v) { if (dlg.open) { $("setUrl").value = v; $("setUrl").dispatchEvent(new Event("input")); } }

  // Point the chat at the local server (remembering the LM Studio address so "Use LM Studio" can restore it).
  function pointAtLocal(apiBase) {
    const cur = chat.getSettings().baseUrl;
    if (!isLocalUrl(cur)) { ls.set(PREV_KEY, cur || chat.defaultUrl); const shell = ls.get("oasis_lm_url"); if (shell && !isLocalUrl(shell)) ls.set(PREV_SHELL_KEY, shell); }
    chat.setLocal(true);
    if (window.oasisSetShellUrl) window.oasisSetShellUrl(apiBase); else ls.set("oasis_lm_url", apiBase);   // the AI panel in the browser bar uses this one
    setUrlField(apiBase);
    if (cur !== apiBase) return chat.applyConnection({ baseUrl: apiBase, apiKey: "", model: "" });
    return chat.applyConnection({});
  }
  // Back to the provider used before (LM Studio :1234 or Ollama :11434; anything else falls back to LM Studio).
  const LM_URL = "http://127.0.0.1:1234/v1";
  function switchBack(preferPrev) {
    const prev = ls.get(PREV_KEY);
    const target = preferPrev && prev && !isLocalUrl(prev) ? prev : LM_URL;
    return window.oasisSwitchProvider ? window.oasisSwitchProvider(target) : chat.applyConnection({ baseUrl: target, model: "" });
  }
  const pointAtLmStudio = () => switchBack(false);
  // A provider button / "Use LM Studio" was used: the chat is no longer on the local model.
  document.addEventListener("oasis:provider-switched", (e) => { if (!isLocalUrl(e.detail)) { useLocal = false; ls.del(USE_KEY); chat.setLocal(false); if (status) render(); } });
  // The "Local model" quick-set button: use the running server, or take you to the tab to start one.
  window.oasisUseLocal = function () {
    if (status && status.state === "ready") { useLocal = true; ls.set(USE_KEY, "1"); pointAtLocal(status.apiBase); render(); }
    else { const t = document.querySelector('#setTabs [data-go="local"]'); if (t) t.click(); }
  };

  // "Use in chat" on one of the extra models.
  window.oasisLlamaUse = function (apiBase) { useLocal = true; ls.set(USE_KEY, "1"); const r = pointAtLocal(apiBase); render(); return r; };

  function fillModels() {
    const sel = $("llamaModel"), want = (status && (status.model || (status.config && status.config.model))) || sel.value;
    sel.innerHTML = "";
    if (!models.length) { const o = document.createElement("option"); o.value = ""; o.textContent = "(no .gguf files found)"; sel.appendChild(o); return; }
    models.forEach((m) => {
      const o = document.createElement("option"); o.value = m.id;
      o.textContent = m.id + "  ·  " + gb(m.size) + (m.mmproj ? "  ·  vision" : "");
      sel.appendChild(o);
    });
    sel.value = models.some((m) => m.id === want) ? want : models[0].id;
  }
  /* ---- Runtime: which llama.cpp build runs the model (Auto = the one that fits this PC's graphics card) ---- */
  let rtInfo = null;
  async function loadRuntimes(opt) {
    if (typeof api.llamaRuntimes !== "function") return;
    try { const r = await api.llamaRuntimes(opt); if (r && !r.error) { rtInfo = r; fillRuntimes(); } } catch (e) {}
  }
  function fillRuntimes() {
    const sel = $("llamaRuntime"); if (!sel || !rtInfo) return;
    const mode = rtInfo.mode || "auto", cur = rtInfo.current;
    sel.innerHTML = "";
    sel.appendChild(new Option("Auto (recommended)" + (rtInfo.auto && cur ? " — " + cur.name + " · " + cur.kindLabel : ""), "auto"));
    (rtInfo.runtimes || []).forEach((r) => sel.appendChild(new Option(r.name + " · " + r.kindLabel + (r.usable ? "" : " (not for this PC)"), r.id)));
    sel.value = [...sel.options].some((o) => o.value === mode) ? mode : "auto";
    const hw = rtInfo.hardware || {};
    let t = "This PC: " + (hw.ready ? hw.summary : "checking the graphics card…");
    if (hw.cpu) t += "\nProcessor: " + hw.cpu + (hw.threads ? " (" + hw.threads + " threads)" : "") + (hw.ramGB ? ", " + hw.ramGB + " GB memory" : "");
    if (cur) t += "\nUsing: " + cur.name + " (" + cur.kindLabel + ") — " + rtInfo.reason + ".";
    else t += "\nNo runtime found. Put each llama.cpp build in its own folder (llama-server.exe and its .dll files) inside:\n" + rtInfo.dir + "\nor press Runtimes folder… to choose where yours are.";
    if (rtInfo.note) t += "\n" + rtInfo.note;
    if (rtInfo.hasBinPath) t += "\nA llama-server path set by hand overrides the runtime.";
    $("llamaRuntimeInfo").textContent = t;
  }
  function fillForm() {
    if (formFilled || !status) return;
    const c = status.config || {};
    $("llamaCtx").value = c.ctx || 8192; $("llamaNgl").value = c.ngl != null ? c.ngl : 99;
    $("llamaExtra").value = c.extraArgs || ""; $("llamaAuto").checked = !!c.autoStart;
    buildSections(status.schema || []);
    const h = c.host || "127.0.0.1";
    $("llamaHostSel").value = (h === "127.0.0.1" || h === "0.0.0.0") ? h : "custom";
    $("llamaHostCustom").value = (h === "127.0.0.1" || h === "0.0.0.0") ? "" : h;
    $("llamaPort").value = c.port || 8080; $("llamaKey").value = c.apiKey || "";
    $("llamaCors").value = c.cors || "all"; $("llamaOrigins").value = c.corsOrigins || "";
    document.querySelectorAll("#llamaBlock [data-opt]").forEach((el) => { el.value = (c.opts && c.opts[el.dataset.opt]) || ""; });
    syncVisibility(); showPreview();
    formFilled = true;
  }

  /* ---- the server / performance / sampling sections are drawn from the list llama-manager.js sends ---- */
  let sectionsBuilt = false;
  function buildSections(schema) {
    if (sectionsBuilt || !schema.length) return;
    sectionsBuilt = true;
    schema.forEach((d) => {
      const host = document.querySelector('#llamaBlock [data-lgroup="' + d.group + '"]'); if (!host) return;
      const lab = document.createElement("label"); lab.className = "lfield";
      lab.appendChild(document.createTextNode(d.label));
      let el;
      if (d.type === "select" || d.type === "toggle") {
        el = document.createElement("select");
        const opts = d.type === "toggle" ? [["on", "On"], ["off", "Off"]] : d.choices;
        el.appendChild(new Option("Default", ""));
        opts.forEach((c) => el.appendChild(new Option(c[1], c[0])));
      } else {
        el = document.createElement("input");
        el.type = d.type === "num" ? "number" : "text"; el.autocomplete = "off"; el.spellcheck = false;
        el.placeholder = d.placeholder || "Default";
        if (d.type === "num") { if (d.min != null) el.min = d.min; if (d.max != null) el.max = d.max; el.step = d.float ? "any" : "1"; }
      }
      el.dataset.opt = d.key; el.id = "lo_" + d.key;
      lab.appendChild(el);
      if (d.hint) { const s = document.createElement("small"); s.textContent = d.hint; lab.appendChild(s); }
      host.appendChild(lab);
    });
    document.querySelectorAll("#llamaBlock [data-opt]").forEach((el) => { el.addEventListener("change", onSettingChanged); });
  }
  function syncVisibility() {
    $("llamaHostCustomRow").hidden = $("llamaHostSel").value !== "custom";
    $("llamaOriginsRow").hidden = $("llamaCors").value !== "origins";
  }
  function showNetInfo() {
    const lan = (status && status.lan) || [], sel = $("llamaHostSel").value, port = $("llamaPort").value || 8080;
    let t = "Addresses of this computer: " + (lan.length ? lan.map((a) => a.address + " (" + a.name + ")").join(", ") : "none found (not on a network)") + ".";
    if (sel === "0.0.0.0" && lan.length) t += " Other devices would use " + lan.map((a) => "http://" + a.address + ":" + port + "/v1").join(" or ") + ".";
    $("llamaNetInfo").textContent = t;
  }
  /* "Will it fit?": compares the model + context size with the free graphics memory and RAM (llama-memory.js) */
  let fitTimer = null, fitSeq = 0;
  const fitCfg = () => { const c = formConfig(); return { ctx: c.ctx, ngl: c.ngl, opts: c.opts }; };
  function updateFit() {
    const el = $("llamaFit"); if (!el || typeof api.llamaEstimate !== "function") return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(async () => {
      const model = $("llamaModel").value, my = ++fitSeq;
      if (!model) { el.hidden = true; return; }
      let r; try { r = await api.llamaEstimate({ model, config: fitCfg() }); } catch (e) { return; }
      if (my !== fitSeq || !r || r.error) return;
      const running = status && (status.state === "ready" || status.state === "starting");
      el.hidden = false; el.dataset.level = r.level;
      el.textContent = (r.level === "too_big" ? "Warning: " : r.level === "tight" ? "Tight fit: " : "") + r.message + (running && r.level !== "ok" ? " (The model that is running now already uses part of this memory.)" : "");
    }, 350);
  }
  // Asked before a load: true = go ahead. Only a clear "will not fit" asks; a reload of the model that is running is not asked (its memory is about to be freed).
  async function confirmFit(model, cfg, reloading) {
    if (typeof api.llamaEstimate !== "function" || reloading) return true;
    let r; try { r = await api.llamaEstimate({ model, config: cfg }); } catch (e) { return true; }
    if (!r || r.level !== "too_big") return true;
    return window.confirm(r.message + "\n\nLoad it anyway? It may fail with an out-of-memory error or slow the whole PC down.");
  }
  window.oasisLlamaConfirmFit = confirmFit;

  let prevTimer = null;
  function showPreview() {
    showNetInfo(); updateFit();
    clearTimeout(prevTimer);
    prevTimer = setTimeout(async () => {
      const r = await api.llamaPreview($("llamaModel").value);
      if (r && r.command) $("llamaCmd").textContent = r.command;
    }, 150);
  }
  function onSettingChanged() {
    syncVisibility();
    api.llamaConfig(formConfig()).then(showPreview);
    if (status && (status.state === "ready" || status.state === "starting")) { $("llamaPending").hidden = false; }
  }

  // Loading bar. llama-server does not report percentages, so while it loads the bar fills on an estimate (bigger files
  // take longer) and jumps forward when the log shows real milestones. It turns green and full the moment the server
  // says it is ready, and red if loading fails.
  let barTick = null;
  function loadFraction() {
    const st = status, log = (st.log || []).join("\n");
    const m = models.find((x) => x.id === st.model);
    const gbs = m ? m.size / 1073741824 : 4;
    const tau = Math.max(4, gbs * 3) * 1000;                       // roughly 3 s per GB, at least 4 s
    let f = 0.93 * (1 - Math.exp(-Math.max(0, Date.now() - st.startedAt) / tau));
    if (/load_tensors|loading model tensors|offloaded \d+\/\d+ layers/i.test(log)) f = Math.max(f, 0.35);
    if (/offloaded \d+\/\d+ layers/i.test(log)) f = Math.max(f, 0.7);
    if (/n_ctx_seq|llama_context|kv_size|KV buffer/i.test(log)) f = Math.max(f, 0.85);
    if (/listening|server is listening|main: model loaded/i.test(log)) f = Math.max(f, 0.95);
    return Math.min(f, 0.97);
  }
  // state of the loading bar, also used by the first-run welcome screen
  function barState() {
    if (!status || status.state === "stopped") return { show: false, state: "stopped", pct: 0 };
    const st = status.state;
    return { show: true, state: st, pct: st === "ready" ? 100 : Math.round(loadFraction() * 100) };
  }
  function paintBar() {
    const row = $("llamaBarRow"), b = barState();
    if (!b.show) { row.hidden = true; return; }
    row.hidden = false;
    const st = b.state, pct = b.pct;
    row.classList.toggle("ready", st === "ready"); row.classList.toggle("error", st === "error");
    $("llamaBarFill").style.width = pct + "%";
    $("llamaBar").setAttribute("aria-valuenow", String(pct));
    $("llamaBarPct").textContent = st === "ready" ? "Ready" : (st === "error" ? "Failed" : pct + "%");
  }
  function syncBarTimer() {
    const on = status && status.state === "starting";
    if (on && !barTick) barTick = setInterval(paintBar, 250);
    if (!on && barTick) { clearInterval(barTick); barTick = null; }
  }

  function render() {
    if (!status) return;
    const st = status.state, running = st === "starting" || st === "ready";
    let t;
    if (st === "ready") t = "Running: " + status.model + " at " + status.apiBase + (status.vision ? " (can see images)" : "") + (status.runtime ? " on " + status.runtime.name + " (" + status.runtime.kindLabel + ")" : "") + (useLocal ? "" : ". Not used by the chat right now: press Start & use.") + (status.notice ? "\n" + status.notice : "");
    else if (st === "starting") t = "Loading " + status.model + (status.runtime ? " on " + status.runtime.name + " (" + status.runtime.kindLabel + ")" : "") + "… big models can take a minute or two." + (status.notice ? "\n" + status.notice : "");
    else if (st === "error") t = "Problem: " + status.error + (status.hint ? "\n" + status.hint : "");
    else if (!status.binary) t = "No runtime (llama-server) was found. Put each llama.cpp build in its own folder, with llama-server.exe and all its .dll files, inside a folder named \"runtimes\" next to the app, or press Runtimes folder… to choose where yours are. Looked in:\n" + (status.binaryCandidates || []).join("\n");
    else t = "Stopped. " + (models.length ? models.length + " model(s) in " + status.modelsDir : "No .gguf models in " + status.modelsDir + ". Put some there, or press Models folder…");
    setText("llamaStatusText", t);
    $("llamaStatusText").style.whiteSpace = "pre-wrap";
    $("llamaStatusText").style.color = st === "error" ? "var(--bad)" : (st === "ready" ? "var(--ok)" : "");
    $("llamaLog").textContent = (status.log || []).join("\n");
    $("llamaStart").disabled = busy || !models.length || !status.binary;
    $("llamaStop").disabled = busy || !running;
    if ($("llamaBackToLm")) $("llamaBackToLm").disabled = !useLocal && !isLocalUrl(chat.getSettings().baseUrl);
    $("llamaModel").disabled = busy;
    paintAddresses(running);
    paintBar(); syncBarTimer();
  }

  // "IP display": where the server can be reached, with Copy buttons.
  function copyText(t, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = o; }, 1200); };
    try { navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done)); } catch (e) { fallbackCopy(t, done); }
  }
  function fallbackCopy(t, done) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
  function paintAddresses(running) {
    const box = $("llamaAddr"), list = (status && status.addresses) || [];
    if (!running || !list.length) { box.hidden = true; box.textContent = ""; return; }
    const key = JSON.stringify(list) + status.keyed + status.cors;
    box.hidden = false;
    if (box.dataset.key === key) return;
    box.dataset.key = key; box.textContent = "";
    list.forEach((a) => {
      const row = document.createElement("div"); row.className = "arow";
      const b = document.createElement("b"); b.textContent = a.label + ":";
      const c = document.createElement("code"); c.textContent = a.url;
      const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Copy"; btn.onclick = () => copyText(a.url, btn);
      row.append(b, c, btn); box.appendChild(row);
    });
    const note = document.createElement("small");
    note.textContent = "CORS: " + ({ all: "all websites", origins: "listed websites only", off: "off" }[status.cors] || status.cors) + ".  API key: " + (status.keyed ? "required from other computers." : "none.") + (list.length > 1 && !status.keyed ? "  Anyone on your network can use this model." : "");
    box.appendChild(note);
  }

  async function refresh() {
    const s = await api.llamaStatus();
    if (!s || s.error) { if (s && s.error === "not allowed") $("llamaBlock").hidden = true; return; }
    status = s;
    $("llamaBlock").hidden = false;
    const tab = $("localTab"); if (tab) tab.hidden = false;
    const chip = $("chipLocal"); if (chip) chip.hidden = false;
    if (useLocal && s.state === "ready" && !isExtraUrl(chat.getSettings().baseUrl) && chat.getSettings().baseUrl !== s.apiBase) pointAtLocal(s.apiBase);
    else if (useLocal && s.state === "ready") chat.setLocal(true);
    fillForm(); render();
    schedule();
  }
  async function loadModels() {
    const r = await api.llamaModels();
    if (r && !r.error) { models = r.models || []; fillModels(); }
    render();
  }
  function schedule() {
    clearTimeout(timer);
    const need = dlg.open || (status && status.state === "starting");
    if (need) timer = setTimeout(refresh, 1500);
  }

  function formConfig() {
    const opts = {};
    document.querySelectorAll("#llamaBlock [data-opt]").forEach((el) => { if (el.value !== "") opts[el.dataset.opt] = el.value; });
    const sel = $("llamaHostSel").value;
    return { ctx: parseInt($("llamaCtx").value, 10) || 8192, ngl: Math.max(0, parseInt($("llamaNgl").value, 10) || 0),
      extraArgs: $("llamaExtra").value.trim(), autoStart: $("llamaAuto").checked,
      host: sel === "custom" ? ($("llamaHostCustom").value.trim() || "127.0.0.1") : sel,
      port: parseInt($("llamaPort").value, 10) || 8080, apiKey: $("llamaKey").value.trim(),
      cors: $("llamaCors").value, corsOrigins: $("llamaOrigins").value.trim(), opts };
  }

  $("llamaStart").onclick = async () => {
    const model = $("llamaModel").value; if (!model) return;
    if (!(await confirmFit(model, fitCfg(), !!(status && (status.state === "ready" || status.state === "starting"))))) return;
    busy = true; render(); $("llamaPending").hidden = true;
    useLocal = true; ls.set(USE_KEY, "1");
    const s = await api.llamaStart({ model, config: formConfig() });
    busy = false;
    if (s && !s.error) status = s;
    render(); schedule();
  };
  $("llamaStop").onclick = async () => {
    busy = true; render();
    const s = await api.llamaStop();
    busy = false;
    if (s && !s.error) status = s;
    // Stopping the local server: put the chat back on the provider it was using before.
    if (useLocal || isLocalUrl(chat.getSettings().baseUrl)) await switchBack(true); else chat.applyConnection({});
    render();
  };
  $("llamaRefresh").onclick = async () => { await loadModels(); refresh(); };
  $("llamaPickDir").onclick = async () => {
    const r = await api.llamaPickModelsDir();
    if (r && !r.error) { models = r.models || []; fillModels(); }
    refresh();
  };
  $("llamaOpenDir").onclick = async () => { await api.llamaOpenModelsDir(); };
  if ($("llamaOpenLogs")) $("llamaOpenLogs").onclick = async () => { if (typeof api.llamaOpenLogsDir === "function") await api.llamaOpenLogsDir(); };
  $("llamaRuntime").addEventListener("change", async () => {
    await api.llamaConfig({ runtime: $("llamaRuntime").value });
    await loadRuntimes({ rescan: true }); await refresh(); showPreview();
    if (status && (status.state === "ready" || status.state === "starting")) $("llamaPending").hidden = false;
  });
  $("llamaRuntimeRefresh").onclick = async () => { $("llamaRuntimeInfo").textContent = "Looking for runtimes and checking this PC…"; await loadRuntimes({ rescan: true, redetect: true }); await refresh(); };
  const pickRuntimes = async () => {
    const r = await api.llamaPickRuntimesDir();
    if (r && !r.error) { rtInfo = r; fillRuntimes(); }
    await refresh();
  };
  $("llamaOpenRuntimes").onclick = async () => { await api.llamaOpenRuntimesDir(); };
  $("llamaOpenRuntimes").addEventListener("contextmenu", (e) => { e.preventDefault(); pickRuntimes(); });
  ["llamaCtx", "llamaNgl", "llamaExtra", "llamaAuto", "llamaHostSel", "llamaHostCustom", "llamaPort", "llamaKey", "llamaCors", "llamaOrigins"].forEach((id) => $(id).addEventListener("change", onSettingChanged));
  $("llamaModel").addEventListener("change", () => { api.llamaConfig({ model: $("llamaModel").value }).then(showPreview); });
  $("llamaKeyGen").onclick = () => {
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    $("llamaKey").value = "sk-" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    $("llamaKey").type = "text"; $("llamaKeyShow").textContent = "Hide"; onSettingChanged();
  };
  $("llamaKeyShow").onclick = () => { const on = $("llamaKey").type === "password"; $("llamaKey").type = on ? "text" : "password"; $("llamaKeyShow").textContent = on ? "Hide" : "Show"; };
  $("llamaReset").onclick = async () => {
    await api.llamaConfig({ reset: true });
    const s = await api.llamaStatus(); if (s && !s.error) status = s;
    formFilled = false; fillForm(); showPreview();
    if (status && (status.state === "ready" || status.state === "starting")) $("llamaPending").hidden = false;
  };

  // Saving the Settings form with a different server address means "use that one" (e.g. LM Studio again).
  $("settingsForm").addEventListener("submit", () => {
    const v = $("setUrl").value.trim();
    if (status && status.apiBase && v === status.apiBase) { useLocal = true; ls.set(USE_KEY, "1"); chat.setLocal(true); }
    else if (useLocal && v !== (status && status.apiBase) && !isExtraUrl(v)) { useLocal = false; ls.del(USE_KEY); chat.setLocal(false); }
  });
  document.addEventListener("lmchat:settingsOpen", () => { formFilled = false; loadModels().then(refresh); loadRuntimes(); });
  dlg.addEventListener("close", () => clearTimeout(timer));

  // Small API for the first-run welcome screen (js/welcome.js).
  window.oasisLlama = {
    info: () => ({ status, models, bar: barState(), useLocal }),
    refresh: async () => { await loadModels(); await refresh(); },
    start: async (id) => { if (id) $("llamaModel").value = id; await $("llamaStart").onclick(); }
  };

  // On startup: if the chat was using the local model, wait for it (it may still be loading) and connect.
  (async () => { await loadModels(); await refresh(); loadRuntimes(); })();
})();
