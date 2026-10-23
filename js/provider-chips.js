/* Quick-set buttons under the server address: LM Studio (:1234), Ollama (:11434) and the built-in local model (:8080).
 * Clicking one fills the address box AND applies it right away. The box stays editable for any other address, and the
 * highlighted button follows whatever address is in the box. Local model's button works only while it is running. */
(function () {
  "use strict";
  const chat = window.lmchat, box = document.getElementById("providerChips"), url = document.getElementById("setUrl");
  if (!chat || !box || !url) return;
  const LM = "http://127.0.0.1:1234/v1", OLLAMA = "http://127.0.0.1:11434/v1";
  const dlg = document.getElementById("settings");
  // The AI panel in the browser bar lives in another page with its own storage, so tell it through the shared preference.
  const setShell = (u) => {
    try { localStorage.setItem("oasis_lm_url", u); } catch (e) {}
    try { if (window.oasisProject && window.oasisProject.setPref) window.oasisProject.setPref("lm_url", u); } catch (e) {}
  };
  window.oasisSetShellUrl = setShell;

  // Used by the buttons here and by "Use LM Studio" / Stop in llama-local.js.
  window.oasisSwitchProvider = function (u) {
    chat.setLocal(false);
    setShell(u);
    if (dlg.open) url.value = u;
    mark();
    document.dispatchEvent(new CustomEvent("oasis:provider-switched", { detail: u }));
    return chat.applyConnection({ baseUrl: u, model: "" });
  };

  function kind(u) {
    u = String(u || "").trim();
    if (/^https?:\/\/(127\.0\.0\.1|localhost):1234\//i.test(u)) return "lmstudio";
    if (/^https?:\/\/(127\.0\.0\.1|localhost):11434\//i.test(u)) return "ollama";
    if (/^https?:\/\/127\.0\.0\.1:\d+\/v1\/?$/i.test(u)) return "local";
    return "";
  }
  function mark() {
    const k = kind(url.value);
    box.querySelectorAll("[data-provider]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-provider") === k));
  }
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-provider]"); if (!b) return;
    const p = b.getAttribute("data-provider");
    if (p === "lmstudio") window.oasisSwitchProvider(LM);
    else if (p === "ollama") window.oasisSwitchProvider(OLLAMA);
    else if (typeof window.oasisUseLocal === "function") window.oasisUseLocal();
  });
  url.addEventListener("input", mark);
  document.addEventListener("lmchat:settingsOpen", mark);
  mark();
})();
