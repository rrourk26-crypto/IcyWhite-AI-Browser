/* First-run welcome: checks the local engine (llama-server) and the models folder, lets you start a model, or use
 * LM Studio / Ollama if they are running, and pick a theme. Shows once for a brand-new install (nothing saved yet);
 * "Setup guide…" in Settings > Local model opens it again. Outside the desktop app only the theme and the
 * "other apps" rows are shown. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id), dlg = $("welcomeDlg");
  if (!dlg) return;
  const DONE = "icywhite.welcomeDone";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const api = window.oasisProject || null;
  const desktop = !!(api && api.llamaStatus);
  let timer = null, probing = false, started = false;

  const mark = (id, state, glyph) => { const el = $(id); el.className = "wl-ic" + (state ? " " + state : ""); el.textContent = glyph; };
  const gb = (n) => n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1048576)) + " MB";
  const lm = () => window.oasisLlama || null;

  function paintTheme() {
    const t = window.icyTheme ? window.icyTheme.get() : "light";
    $("wlTheme").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-t") === t));
  }
  function paintLocal() {
    const L = lm(); if (!desktop || !L) return;
    const { status: st, models, bar } = L.info();
    if (!st) return;
    // engine
    if (st.binary) { mark("wlEngineIc", "ok", "✓"); $("wlEngineTxt").textContent = st.runtime ? "Using " + st.runtime.name + " (" + st.runtime.kindLabel + ")" + (st.runtimeReason ? " — " + st.runtimeReason : "") : "Found: " + st.binary; }
    else { mark("wlEngineIc", "bad", "✕"); $("wlEngineTxt").textContent = "Not found. Put each llama.cpp build (llama-server.exe and its .dll files) in its own folder inside a folder named \"runtimes\" next to IcyWhite, then press Check again."; }
    // models
    if (models.length) { mark("wlModelsIc", "ok", "✓"); $("wlModelsTxt").textContent = models.length + (models.length === 1 ? " model" : " models") + " in " + st.modelsDir; }
    else { mark("wlModelsIc", "bad", "✕"); $("wlModelsTxt").textContent = "No .gguf files yet in " + st.modelsDir + ". Copy some there, or choose the folder where you keep them."; }
    const sel = $("wlModel");
    if (sel.options.length !== models.length || (models[0] && sel.options[0] && sel.options[0].value !== models[0].id)) {
      const keep = sel.value; sel.innerHTML = "";
      models.forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.id + "  ·  " + gb(m.size); sel.appendChild(o); });
      if (keep && models.some((m) => m.id === keep)) sel.value = keep;
    }
    // start / progress
    const row = $("wlBarRow"), s = st.state;
    $("wlStart").disabled = !st.binary || !models.length || s === "starting";
    sel.disabled = s === "starting";
    row.hidden = !bar.show; row.classList.toggle("ready", s === "ready"); row.classList.toggle("error", s === "error");
    $("wlBarFill").style.width = bar.pct + "%";
    $("wlBarPct").textContent = s === "ready" ? "Ready" : s === "error" ? "Failed" : bar.pct + "%";
    if (s === "ready") { mark("wlStartIc", "ok", "✓"); $("wlStartTxt").textContent = "Running: " + st.model + ". The chat is using it now. You're all set!"; if (started) lsSet(DONE, "1"); }
    else if (s === "starting") { mark("wlStartIc", "", "…"); $("wlStartTxt").textContent = "Loading " + st.model + "… big models take a minute or two."; }
    else if (s === "error") { mark("wlStartIc", "bad", "✕"); $("wlStartTxt").textContent = st.error + (st.hint ? " " + st.hint : ""); }
    else { mark("wlStartIc", "", "▶"); $("wlStartTxt").textContent = "Pick a model, then press Start."; }
  }
  async function probe() {
    if (probing) return; probing = true;
    $("wlOthersTxt").textContent = "Checking for LM Studio and Ollama…";
    let r = null;
    try { r = api && api.probeServers ? await api.probeServers() : null; } catch (e) {}
    probing = false;
    if (!r) { $("wlOthersTxt").textContent = "Use the Connection tab in Settings to point IcyWhite at LM Studio or Ollama."; $("wlLm").disabled = $("wlOllama").disabled = false; return; }
    $("wlLm").disabled = !r.lmstudio; $("wlOllama").disabled = !r.ollama;
    const found = [r.lmstudio && "LM Studio", r.ollama && "Ollama"].filter(Boolean);
    $("wlOthersTxt").textContent = found.length ? found.join(" and ") + (found.length > 1 ? " are" : " is") + " running on this computer. Press its button to use it."
      : "Neither is running right now. Start LM Studio's server or Ollama, then press Check again above.";
  }
  async function refreshAll() { const L = lm(); if (desktop && L) await L.refresh(); paintLocal(); probe(); }

  function open() {
    dlg.querySelectorAll('[data-wl="local"]').forEach((el) => { el.hidden = !(desktop && lm()); });
    paintTheme(); started = false;
    if (!dlg.open) dlg.showModal();
    refreshAll();
    clearInterval(timer); timer = setInterval(paintLocal, 400);
  }
  function close() { if (dlg.open) dlg.close(); }
  dlg.addEventListener("close", () => { clearInterval(timer); lsSet(DONE, "1"); });

  $("wlTheme").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b && window.icyTheme) { window.icyTheme.set(b.getAttribute("data-t")); paintTheme(); } });
  document.addEventListener("icywhite:theme", paintTheme);
  $("wlRecheck").onclick = refreshAll;
  $("wlPick").onclick = async () => { if (api && api.llamaPickModelsDir) { await api.llamaPickModelsDir(); refreshAll(); } };
  $("wlOpen").onclick = async () => { if (api && api.llamaOpenModelsDir) await api.llamaOpenModelsDir(); };
  $("wlStart").onclick = async () => { const L = lm(); if (!L) return; started = true; await L.start($("wlModel").value); paintLocal(); };
  $("wlLm").onclick = () => { if (window.oasisSwitchProvider) window.oasisSwitchProvider("http://127.0.0.1:1234/v1"); close(); };
  $("wlOllama").onclick = () => { if (window.oasisSwitchProvider) window.oasisSwitchProvider("http://127.0.0.1:11434/v1"); close(); };
  $("wlSkip").onclick = close; $("wlDone").onclick = close;
  const again = $("openWelcome");
  if (again) again.onclick = () => { const s = $("settings"); if (s && s.open) s.close(); open(); };

  window.oasisWelcome = { open };
  // Brand-new install only: nothing saved yet and the welcome has not been shown. Existing users are not interrupted.
  document.addEventListener("DOMContentLoaded", () => {
    let fresh = false;
    try { fresh = !lsGet(DONE) && !lsGet("lmchat.settings"); } catch (e) {}
    if (fresh) setTimeout(open, 600);
  });
})();
