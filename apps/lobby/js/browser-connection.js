/* The Lobby does not have its own AI connection any more. It uses whatever the IcyWhite browser is using:
   the same server (LM Studio, Ollama, the built-in local model, or any other), the same key and the same model.
   The browser publishes that choice; this file reads it, keeps the hidden fields the Lobby code uses in step with
   it, and reloads the model list when the browser's choice changes. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const bridge = () => window.oasisProject || null;
  let cur = { url: "", key: "", model: "" }, timer = null;

  function fromStorage() {   // same-storage fallback (the browser's chat settings), e.g. if the bridge is missing
    try { const s = JSON.parse(localStorage.getItem("lmchat.settings") || "null"); if (s && s.baseUrl) return { url: s.baseUrl, key: s.apiKey || "", model: s.model || "" }; } catch (e) {}
    return null;
  }
  async function read() {
    let o = {}, b = bridge();
    if (b && b.getPref) {
      try {
        const v = await Promise.all(["conn_url", "conn_key", "conn_model"].map((k) => b.getPref(k)));
        o = { url: v[0], key: v[1], model: v[2] };
      } catch (e) {}
    }
    if (!o.url) o = fromStorage() || o;
    return { url: String(o.url || "").trim(), key: String(o.key || "").trim(), model: String(o.model || "").trim() };
  }
  function putModel(model) {
    ["model", "plainModel"].forEach((id) => {
      const sel = $(id); if (!sel) return;
      if (model && ![...sel.options].some((o) => o.value === model)) {
        const op = document.createElement("option"); op.value = model; op.textContent = model; sel.insertBefore(op, sel.firstChild);
      }
      if (model) sel.value = model;
      sel.dataset.prev = sel.value;
    });
  }
  async function apply(reload) {
    const c = await read();
    const changed = c.url !== cur.url || c.key !== cur.key || c.model !== cur.model;
    cur = c;
    if ($("apiBase") && c.url) $("apiBase").value = c.url;
    if ($("apiKey")) $("apiKey").value = c.key;
    putModel(c.model);
    if (reload && changed && typeof window.loadModels === "function") window.loadModels();
    return c;
  }
  function soon() { clearTimeout(timer); timer = setTimeout(() => apply(true), 300); }

  window.LobbyConnection = { apply, current: () => cur, ready: apply(false) };

  const b = bridge();
  if (b && b.onPref) b.onPref((k) => { if (/^conn_/.test(String(k))) soon(); });
  window.addEventListener("storage", (e) => { if (e.key === "lmchat.settings") soon(); });
  window.addEventListener("focus", soon);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) soon(); });
})();
