/* ===========================================================
   LM Studio Chat — personas add-on
   Lets you save the "System prompt" box as a named persona (give it an
   emoji and it becomes a character),
   pick a saved one from a dropdown, or delete one. Runs on its
   own and only touches the settings dialog, so removing this
   file just removes the persona picker — the rest of the app
   (and the system prompt field itself) keeps working.
   =========================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "lmchat.personas";

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // Professional presets, seeded once. Characters are yours to make: write a prompt, name it,
  // add an emoji if you want a character, and save. Delete any preset and it stays gone.
  const PRO_PERSONAS = [
    { id: "pro-general",  name: "General Assistant",   prompt: "You are a helpful, concise assistant. Answer directly, be accurate, and keep replies short unless the user asks for more detail." },
    { id: "pro-coder",    name: "Coding Assistant",    prompt: "You are an expert software engineer. Write clean, correct, well-structured code, explain your reasoning briefly, point out bugs and edge cases, and ask for missing details only when they truly block the answer." },
    { id: "pro-reviewer", name: "Code Reviewer",       prompt: "You are a meticulous senior engineer reviewing code. Identify bugs, security issues, edge cases and style problems, rank them by importance, and suggest concrete fixes constructively." },
    { id: "pro-writer",   name: "Writing Assistant",   prompt: "You are a professional writing assistant. Help draft, rewrite and structure text with a clear, natural voice. Match the requested tone and audience, and keep the user's meaning intact." },
    { id: "pro-editor",   name: "Editor & Proofreader", prompt: "You are a careful editor. Correct grammar, spelling, punctuation and clarity while preserving the author's voice, and briefly explain significant changes." },
    { id: "pro-research", name: "Research Assistant",  prompt: "You are a thorough research assistant. Give well-organized, balanced summaries, separate facts from opinion, say when you are unsure, and suggest sources or next steps to verify." },
    { id: "pro-analyst",  name: "Data Analyst",        prompt: "You are a data analyst. Reason step by step with numbers, state your assumptions, suggest appropriate methods and visualizations, and present findings clearly with the key takeaway first." },
    { id: "pro-business", name: "Business Advisor",    prompt: "You are a pragmatic business advisor. Give structured, actionable advice on strategy, planning, operations and communication, weigh trade-offs, and keep recommendations realistic." },
    { id: "pro-tutor",    name: "Tutor",               prompt: "You are a patient tutor. Explain concepts step by step with simple examples, check understanding with a short question now and then, and adapt to the learner's level." },
    { id: "pro-support",  name: "Technical Support",   prompt: "You are a technical support specialist. Diagnose problems methodically, give clear numbered steps, start with the most likely fix, and ask for error messages or system details when needed." }
  ];

  let personas = store.get(STORAGE_KEY, null);
  if (personas === null) personas = [];
  function save() { store.set(STORAGE_KEY, personas); }
  // One-time switch: drop the old built-in characters and starter presets, add the professional set.
  // Anything you saved yourself is kept.
  if (!store.get("lmchat.proPersonasV1", false)) {
    const OLD = ["p-concise", "p-creative", "p-code"];
    personas = personas.filter((p) => !/^c-/.test(p.id) && OLD.indexOf(p.id) === -1);
    PRO_PERSONAS.forEach((c) => { if (!personas.some((p) => p.id === c.id)) personas.push(Object.assign({}, c)); });
    store.set("lmchat.proPersonasV1", true); store.set("lmchat.charactersSeeded", true); save();
  }

  const sel = $("personaSelect");
  const saveBtn = $("savePersonaBtn");
  const delBtn = $("deletePersonaBtn");
  const systemEl = $("setSystem");
  if (!sel || !saveBtn || !delBtn || !systemEl || !$("personaNamer")) return;   // settings markup missing: do nothing

  function matchPersonaId(text) {
    const t = (text || "").trim();
    if (!t) return "";
    const hit = personas.find((p) => p.prompt.trim() === t);
    return hit ? hit.id : "";
  }

  function updateDeleteState() {
    delBtn.disabled = !sel.value;
  }

  function render(selectId) {
    sel.innerHTML = "";
    const custom = document.createElement("option");
    custom.value = ""; custom.textContent = "Custom prompt";
    sel.appendChild(custom);
    personas.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = (p.emoji ? p.emoji + " " : "") + p.name;
      sel.appendChild(o);
    });
    sel.value = personas.some((p) => p.id === selectId) ? selectId : "";
    updateDeleteState();
  }

  sel.onchange = () => {
    const p = personas.find((x) => x.id === sel.value);
    if (p) systemEl.value = p.prompt;
    updateDeleteState();
  };

  // Typing a custom prompt drops the picker back to "Custom prompt",
  // unless what you typed happens to match a saved persona exactly.
  systemEl.addEventListener("input", () => {
    const id = matchPersonaId(systemEl.value);
    if (sel.value !== id) sel.value = id;
    updateDeleteState();
  });

  const namer = $("personaNamer"), nameIn = $("personaNameInput"), emojiIn = $("personaEmojiInput");
  function closeNamer() { if (namer) namer.hidden = true; }
  function commitPersona() {
    const text = systemEl.value.trim();
    const name = (nameIn.value || "").trim();
    if (!text) { window.alert("Write a system prompt first, then save it."); return; }
    if (!name) { nameIn.focus(); return; }
    const emoji = (emojiIn.value || "").trim().slice(0, 8);
    const existing = personas.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { existing.prompt = text; existing.emoji = emoji; save(); render(existing.id); }
    else {
      const id = "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      personas.push({ id, name, emoji, prompt: text }); save(); render(id);
    }
    closeNamer(); refreshPill();
  }
  saveBtn.onclick = () => {
    if (!systemEl.value.trim()) { window.alert("Write a system prompt first, then save it."); return; }
    const current = personas.find((p) => p.id === sel.value);
    nameIn.value = current ? current.name : ""; emojiIn.value = current && current.emoji || "";
    namer.hidden = false; nameIn.focus(); nameIn.select();
  };
  $("personaNameOk").onclick = commitPersona;
  $("personaNameCancel").onclick = closeNamer;
  [nameIn, emojiIn].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitPersona(); } else if (e.key === "Escape") { e.stopPropagation(); closeNamer(); } }));
  document.addEventListener("lmchat:settingsOpen", closeNamer);

  delBtn.onclick = () => {
    const p = personas.find((x) => x.id === sel.value);
    if (!p) return;
    if (!window.confirm('Delete the "' + p.name + '" persona? This can\'t be undone.')) return;
    personas = personas.filter((x) => x.id !== p.id);
    save(); render("");
  };

  /* ---------- Active character: top-bar name tag + tag on replies ---------- */
  function activeCharacter() {   // the persona whose prompt is the saved system prompt, if it has an emoji
    const cur = ((store.get("lmchat.settings", {}) || {}).system || "").trim();
    return cur ? personas.find((p) => p.emoji && p.prompt.trim() === cur) || null : null;
  }
  const bar = document.querySelector(".topbar");
  const pill = document.createElement("button");
  pill.type = "button"; pill.id = "personaPill"; pill.className = "pill-btn"; pill.title = "Current character (click to change)";
  if (bar) bar.insertBefore(pill, bar.firstChild);
  pill.onclick = () => { const b = $("openSettings"); if (b) b.click(); };
  function refreshPill() {
    const c = activeCharacter();
    pill.classList.toggle("show", !!c);
    pill.textContent = c ? c.emoji + " " + c.name : "";
  }
  window.lmchatActiveCharacter = () => { const c = activeCharacter(); return c ? { name: c.name, emoji: c.emoji } : null; };
  const form = $("settingsForm");
  if (form) form.addEventListener("submit", refreshPill);   // runs after app.js has saved the settings
  refreshPill();

  // app.js dispatches this each time the settings dialog opens, so the
  // picker always reflects whatever system prompt is currently loaded.
  document.addEventListener("lmchat:settingsOpen", () => render(matchPersonaId(systemEl.value)));

  render(matchPersonaId(systemEl.value));
})();
