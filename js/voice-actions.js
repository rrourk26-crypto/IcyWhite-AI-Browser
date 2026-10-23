/* Carries out the hands-free "app" commands (see js/voice-app-commands.js for what is understood).
 * Everything works by pressing the same buttons and setting the same fields you would use with the mouse, so the app behaves exactly as if
 * you had done it yourself. exec() answers { say } (a short sentence to speak), { confirm: { ask, run } } (ask yes / no first) or { pass: true }
 * (not really a command: let the AI answer). Also builds the "Voice commands" help window. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = window.LMChatAppCmds;
  if (!A) return;
  const msgs = $("messages"), input = $("input"), sendBtn = $("send");
  const click = (el) => { if (!el) return false; el.click(); return true; };
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const streaming = () => !!sendBtn && sendBtn.classList.contains("stop");
  const lastOf = (sel) => { const l = msgs ? msgs.querySelectorAll(sel) : []; return l.length ? l[l.length - 1] : null; };
  const actionBtn = (wrap, re) => wrap ? [...wrap.querySelectorAll(".actions button")].find((b) => re.test((b.textContent || "") + " " + (b.title || ""))) : null;
  const short = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > (n || 50) ? s.slice(0, n || 50) + "…" : s; };

  // Which of `names` does the spoken `q` mean? Exact, then contained, then by the share of its words found. Returns an index or -1.
  function best(names, q) {
    const k = key(q), qw = words(q); if (!k) return -1;
    let i = names.findIndex((n) => key(n) === k); if (i >= 0) return i;
    i = names.findIndex((n) => key(n).includes(k)); if (i >= 0) return i;
    let bi = -1, bs = 0;
    names.forEach((n, j) => { const nw = words(n); if (!qw.length) return; const s = qw.filter((w) => nw.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length / qw.length; if (s > bs) { bs = s; bi = j; } });
    return bs >= 0.6 ? bi : -1;
  }

  /* ---- Settings: some switches only take effect on Save, so open Settings, change it, save, and let the window close again ---- */
  async function withSettings(fn) {
    const dlg = $("settings"); if (!dlg) return false;
    const wasOpen = dlg.open;
    if (!wasOpen) { click($("openSettings")); await sleep(180); }
    fn();
    if (!wasOpen) { await sleep(80); const save = dlg.querySelector('button[type="submit"]'); try { $("settingsForm").requestSubmit(save); } catch (e) { click(save); } if (dlg.open) { try { dlg.close(); } catch (e) {} } }
    return wasOpen;
  }
  const keepNote = (wasOpen) => (wasOpen ? " Say save settings to keep it." : "");

  /* ---- Chat list (history panel) ---- */
  async function historyItems() {
    const h = $("history"), was = h.classList.contains("open");
    let items = [...$("histList").querySelectorAll(".hist-item")];
    if (!items.length) { h.classList.add("open"); await sleep(150); items = [...$("histList").querySelectorAll(".hist-item")]; if (!was) h.classList.remove("open"); }
    return items;
  }
  const titleOf = (row) => (row.querySelector(".t") || row).textContent.replace(/^📌\s*/, "").trim();
  async function activeRow() { const items = await historyItems(); return items.find((r) => r.classList.contains("active")) || null; }
  async function viaMenu(label) {   // press "⋯" on the current chat, then the menu entry whose text matches `label`
    const row = await activeRow(); if (!row) return { err: "There's no open chat." };
    const h = $("history"), was = h.classList.contains("open"); h.classList.add("open");
    click(row.querySelector(".more")); await sleep(80);
    const menu = $("histList").querySelector(".hist-menu"), b = menu && [...menu.querySelectorAll("button")].find((x) => label.test(x.textContent));
    if (!b) { if (!was) h.classList.remove("open"); return { err: "I couldn't find that option." }; }
    return { b, restore: () => { if (!was) h.classList.remove("open"); } };
  }

  /* ---- Approval cards ---- */
  function scan() {
    const scope = msgs || document;
    const tools = [...scope.querySelectorAll(".tool-act")].filter((a) => !a.closest(".tool-card") || true);
    const toolBtns = (re) => tools.map((a) => [...a.querySelectorAll("button")].find((b) => re.test(b.textContent) && !b.disabled)).filter(Boolean);
    const runs = [...scope.querySelectorAll(".run-card")].map((c) => ({ card: c, run: [...c.querySelectorAll("button")].find((b) => /^(Run|Open)$/.test(b.textContent.trim()) && !b.disabled), skip: [...c.querySelectorAll("button")].find((b) => /^Skip$/.test(b.textContent.trim())), stop: [...c.querySelectorAll("button")].find((b) => /^Stop$/.test(b.textContent.trim())), cmd: (c.querySelector(".run-cmd") || {}).textContent || "" }));
    const diffCards = [...scope.querySelectorAll(".diff-card:not(.run-card)")];
    return {
      allow: toolBtns(/^Allow$/)[0], always: toolBtns(/^Always/)[0], deny: toolBtns(/^Deny$/)[0],
      runs: runs.filter((r) => r.run), running: runs.filter((r) => r.stop),
      applyAll: [...scope.querySelectorAll(".diff-bar button")].find((b) => /^Apply all/.test(b.textContent) && !b.disabled),
      rejectAll: [...scope.querySelectorAll(".diff-bar button")].find((b) => /^Reject all/.test(b.textContent) && !b.disabled),
      applies: diffCards.map((c) => c.querySelector(".diff-apply")).filter((b) => b && !b.disabled),
      rejects: diffCards.map((c) => [...c.querySelectorAll(".diff-head button")].find((b) => /^Reject$/.test(b.textContent))).filter(Boolean)
    };
  }
  async function applyAllChanges(s) {
    if (s.applyAll) { const n = s.applies.length; click(s.applyAll); await sleep(500); return "Applied " + n + " change" + (n === 1 ? "" : "s") + "."; }
    let n = 0; for (let i = 0; i < 30; i++) { const b = scan().applies[0]; if (!b) break; click(b); n++; await sleep(500); }
    return n ? "Applied " + n + " change" + (n === 1 ? "" : "s") + "." : "There's nothing to apply.";
  }
  async function approve(c) {
    const s = scan(), sc = c.scope || "any";
    if ((sc === "tool" || sc === "any") && s.allow) { click(c.always ? s.always || s.allow : s.allow); return { say: c.always ? "Always allowed." : "Allowed." }; }
    if ((sc === "apply" || sc === "any") && s.applies.length) return { say: await applyAllChanges(s) };
    if ((sc === "run" || sc === "any") && s.runs.length) {
      const r = s.runs[s.runs.length - 1], cmd = short(r.cmd, 140);
      return { confirm: { ask: cmd ? "Run this command? " + cmd + "." : "Open that window?", run: async () => { const x = scan().runs.pop(); if (!x) return "That's no longer waiting."; click(x.run); return "Running."; } } };
    }
    if (sc === "run") return { say: "There's no command waiting. If one is shown, open the project folder first." };
    return { say: "There's nothing waiting for approval." };
  }
  async function decline() {
    const s = scan();
    if (s.deny) { click(s.deny); return { say: "Denied." }; }
    if (s.runs.length) { const r = s.runs[s.runs.length - 1]; click(r.skip); return { say: "Skipped." }; }
    if (s.rejectAll) { click(s.rejectAll); return { say: "Rejected the changes." }; }
    if (s.rejects.length) { s.rejects.forEach(click); return { say: "Rejected the changes." }; }
    return { say: "There's nothing waiting to decline." };
  }

  /* ---- Voices ---- */
  function cycle(sel, d) {
    const opts = [...sel.options].filter((o) => !o.disabled); if (opts.length < 2) return null;
    let i = opts.findIndex((o) => o.value === sel.value); i = ((i < 0 ? 0 : i) + d + opts.length) % opts.length;
    sel.value = opts[i].value; fire(sel, "change"); return opts[i].textContent.replace(/\s*\(.*$/, "").trim() || "default";
  }

  /* ---- The command list window ---- */
  const GROUP_ALIASES = { settings: "Windows and panels", panels: "Windows and panels", windows: "Windows and panels", tabs: "Browser tabs and web pages", browser: "Browser tabs and web pages", browsing: "Browser tabs and web pages", web: "Browser tabs and web pages", chats: "Chats and history", chat: "Chats and history", history: "Chats and history", volume: "Volume and speed of the voice", speed: "Volume and speed of the voice", voice: "Volume and speed of the voice", replies: "Replies", reply: "Replies", models: "Models and connection", model: "Models and connection", connection: "Models and connection", switches: "Switches (say turn on / turn off / enable / disable)", toggles: "Switches (say turn on / turn off / enable / disable)", options: "Switches (say turn on / turn off / enable / disable)", camera: "Attach, camera and screen", screen: "Attach, camera and screen", attach: "Attach, camera and screen", files: "Attach, camera and screen", approvals: "Approvals (the cards the AI asks you to confirm)", approval: "Approvals (the cards the AI asks you to confirm)", live: "Live chat basics", basics: "Live chat basics" };
  function groupByName(q) {
    const k = key(q), want = GROUP_ALIASES[String(q).toLowerCase().trim()] || null;
    return A.CATALOG.find((g) => g.group === want) || A.CATALOG.find((g) => key(g.group).includes(k)) || null;
  }
  function spokenFor(g) { return g.group.replace(/\s*\(.*\)/, "") + ". Say: " + g.items.slice(0, 6).map((it) => it.say[0]).join("; ") + "."; }
  const OVERVIEW = "Here are the voice commands. You can control chats, volume, tabs, settings, switches, the camera and approvals just by talking. Try: new chat, volume up, open settings, dark mode, turn on web search, or allow. Say help, followed by settings, chats or tabs, to hear one group.";
  function buildHelp() {
    let d = $("voiceHelp"); if (d) return d;
    d = document.createElement("dialog"); d.id = "voiceHelp"; d.setAttribute("aria-label", "Voice commands");
    const head = document.createElement("div"); head.className = "vh-head";
    const h = document.createElement("h2"); h.textContent = "Voice commands";
    const x = document.createElement("button"); x.type = "button"; x.className = "round"; x.textContent = "✕"; x.setAttribute("aria-label", "Close"); x.onclick = () => d.close();
    head.append(h, x);
    const p = document.createElement("p"); p.className = "vh-note";
    p.textContent = "Say the wake word first if live chat is waiting for it (default: “computer”). Say each command as a short sentence on its own; you can add “please”. The other ways listed all do the same thing.";
    const f = document.createElement("input"); f.type = "search"; f.placeholder = "Filter (for example: volume, tab, camera)"; f.className = "vh-filter"; f.setAttribute("aria-label", "Filter voice commands");
    const body = document.createElement("div"); body.className = "vh-body";
    A.CATALOG.forEach((g) => {
      const sec = document.createElement("section"); sec.className = "vh-group";
      const t = document.createElement("h3"); t.textContent = g.group; sec.appendChild(t);
      g.items.forEach((it) => {
        const row = document.createElement("div"); row.className = "vh-row";
        const say = document.createElement("div"); say.className = "vh-say"; it.say.forEach((s) => { const c = document.createElement("code"); c.textContent = "“" + s + "”"; say.appendChild(c); });
        const does = document.createElement("div"); does.className = "vh-does"; does.textContent = it.does;
        row.append(say, does); row.dataset.text = (g.group + " " + it.say.join(" ") + " " + it.does).toLowerCase(); sec.appendChild(row);
      });
      body.appendChild(sec);
    });
    f.oninput = () => {
      const q = f.value.toLowerCase().trim();
      body.querySelectorAll(".vh-row").forEach((r) => { r.hidden = !!q && !r.dataset.text.includes(q); });
      body.querySelectorAll(".vh-group").forEach((s) => { s.hidden = ![...s.querySelectorAll(".vh-row")].some((r) => !r.hidden); });
    };
    d.append(head, p, f, body); document.body.appendChild(d); return d;
  }
  function showHelp() { const d = buildHelp(); if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } } }
  window.lmchatVoiceHelp = showHelp;

  /* ---- The commands ---- */
  async function exec(c) {
    const feedOpen = () => { const f = $("visionFeed"); return !!f && !f.hidden; };
    switch (c.id) {
      case "stop": if (streaming()) { click(sendBtn); return { say: "Stopped." }; } return { say: "Nothing is being written." };
      case "continue": { const b = actionBtn(lastOf(".msg.assistant"), /^Continue/); if (!b) return { say: "There's nothing to continue." }; click(b); return { say: "" }; }
      case "copy": { const b = actionBtn(lastOf(c.which === "user" ? ".msg.user" : ".msg.assistant"), /^Copy/); if (!b) return { say: "There's nothing to copy." }; click(b); return { say: "Copied." }; }
      case "editlast": { const b = actionBtn(lastOf(".msg.user"), /Edit/); if (!b) return { say: "There's no message to edit." }; click(b); return { say: "Editing your last message." }; }
      case "deletelast": {
        const w = lastOf(c.which === "user" ? ".msg.user" : ".msg.assistant"), b = actionBtn(w, /Delete/); if (!b) return { say: "There's nothing to delete." };
        return { confirm: { ask: "Delete " + (c.which === "user" ? "your last message and its reply" : "that reply") + "?", run: async () => { click(b); return "Deleted."; } } };
      }
      case "version": { const w = lastOf(".msg.assistant"), b = actionBtn(w, c.d < 0 ? /Previous version/ : /Next version/); if (!b || b.disabled) return { say: c.d < 0 ? "That's the first version." : "That's the latest version." }; click(b); return { say: "Version " + ((w.querySelector(".ver") || {}).textContent || "") + "." }; }
      case "send": if (!input.value.trim()) return { say: "The message box is empty." }; click(sendBtn); return { say: "" };
      case "clearinput": input.value = ""; fire(input, "input"); return { say: "Cleared." };
      case "chatscroll": {
        const main = $("main"), els = [msgs, main, document.scrollingElement].filter(Boolean), el = els.find((e) => e.scrollHeight > e.clientHeight + 4) || els[0];
        if (c.dir === "bottom") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        else if (c.dir === "top") el.scrollTo({ top: 0, behavior: "smooth" });
        else el.scrollBy({ top: (c.dir === "down" ? 1 : -1) * Math.round(el.clientHeight * 0.8), behavior: "smooth" });
        return { say: "" };
      }
      case "historyclose": $("history").classList.remove("open"); return { say: "Closed." };
      case "openchat": {
        const items = await historyItems(); if (!items.length) return { say: "There are no saved chats." };
        let row = null;
        if (c.name) { const i = best(items.map(titleOf), c.name); row = i >= 0 ? items[i] : null; if (!row) return { say: "I couldn't find a chat called " + c.name + "." }; }
        else if (c.n) { row = items[c.n - 1]; if (!row) return { say: "There are only " + items.length + " chats." }; }
        else if (c.which === "newest") row = items[0];
        else if (c.which === "oldest") row = items[items.length - 1];
        else row = items.find((r) => !r.classList.contains("active")) || items[0];
        const t = row.querySelector(".t"); click(t); return { say: "Opening " + short(titleOf(row), 40) + "." };
      }
      case "deletechat": {
        const row = await activeRow(); if (!row) return { say: "There's no open chat." };
        const name = short(titleOf(row), 40);
        return { confirm: { ask: "Delete the chat " + name + "?", run: async () => { const r = await activeRow(); if (!r) return "It's already gone."; click(r.querySelector(".x")); return "Deleted."; } } };
      }
      case "renamechat": {
        const v = await viaMenu(/^Rename/); if (v.err) return { say: v.err };
        click(v.b); await sleep(80); const inp = $("histList").querySelector("input.hist-edit"); if (!inp) { v.restore(); return { say: "I couldn't rename it." }; }
        inp.value = c.title.slice(0, 80); inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); v.restore(); return { say: "Renamed to " + short(c.title, 40) + "." };
      }
      case "pinchat": {
        const v = await viaMenu(/^(?:Pin|Unpin)/); if (v.err) return { say: v.err };
        const isPin = /^Pin/.test(v.b.textContent);
        if (isPin !== c.pin) { v.restore(); const menuBtn = $("histList").querySelector(".hist-menu"); if (menuBtn) { const row = await activeRow(); if (row) click(row.querySelector(".more")); } return { say: c.pin ? "It's already pinned." : "It isn't pinned." }; }
        click(v.b); v.restore(); return { say: c.pin ? "Pinned." : "Unpinned." };
      }
      case "exportchat": { const v = await viaMenu(c.fmt === "json" ? /JSON/ : /Markdown/); if (v.err) return { say: v.err }; click(v.b); v.restore(); return { say: "Exporting the chat." }; }
      case "rail": { const r = $("rail"), open = r.classList.contains("open"); if (c.want === "toggle" || (c.want === "open") !== open) click($("toggleRail")); return { say: "" }; }
      case "toolbar": click($("logoBtn")); return { say: "" };
      case "codelab": {   // the rail button opens Code Lab in its own window / tab; the in-page panel (if shown) has a close button
        const cl = $("codeLab"), shown = !cl.hidden;
        if (c.open) { click($("openCodeLab")); return { say: "Opening Code Lab in its own window." }; }
        if (shown) { click($("clClose")); return { say: "Closed Code Lab." }; }
        return { say: "Code Lab is in its own window. Say close this tab to close it." };
      }
      case "runcode": if ($("codeLab").hidden) return { say: "Code Lab is in its own window, so run the code there." }; click($("clRun")); return { say: "Running the code." };
      case "element": click($("openOasisElement")); return { say: "Opening Element chat." };
      case "editlinks": click($("editLinks")); return { say: "Edit links." };
      case "welcome": click($("openWelcome")); return { say: "Welcome guide." };
      case "fact": { const t = ($("factText") || {}).textContent; return { say: t ? t.trim() : "There's no fact to read right now." }; }
      case "factmore": click($("factMore")); return { say: "" };
      case "openlink": { const a = [...document.querySelectorAll("#links a")].find((x) => key(x.title || x.textContent) === key(c.name)); if (!a) return { pass: true }; click(a); return { say: "Opening " + c.name + "." }; }
      case "theme": {
        const T = window.icyTheme; if (!T) return { say: "I can't change the theme here." };
        const mode = c.mode === "toggle" ? (T.isDark() ? "light" : "dark") : c.mode; T.set(mode);
        return { say: mode === "system" ? "Following the system theme." : (mode === "dark" ? "Dark mode." : "Light mode.") };
      }
      case "dialog": {
        const dlg = $("settings");
        if (c.op === "cancelsettings") { if (!dlg.open) return { say: "Settings aren't open." }; click($("cancelSettings")); if (dlg.open) dlg.close(); return { say: "Closed settings." }; }
        if (c.op === "savesettings") { if (!dlg.open) return { say: "Settings aren't open." }; try { $("settingsForm").requestSubmit(dlg.querySelector('button[type="submit"]')); } catch (e) { click(dlg.querySelector('button[type="submit"]')); } return { say: "Saved." }; }
        if (c.op === "savelinks") { if (!$("linksDlg").open) return { say: "The links window isn't open." }; click($("lkSave")); return { say: "Saved." }; }
        const open = [...document.querySelectorAll("dialog[open]")].pop(); if (!open) return { say: "There's no window open." };
        const closer = { settings: "cancelSettings", linksDlg: "lkCancel", camDlg: "camCancel", hfDlg: "hfClose", wallDlg: "wallClose" }[open.id];
        if (closer && $(closer)) click($(closer)); if (open.open) { try { open.close(); } catch (e) {} } return { say: "Closed." };
      }
      case "settingstab": {
        const dlg = $("settings"); if (!dlg.open) { click($("openSettings")); await sleep(180); }
        const b = dlg.querySelector('#setTabs [data-go="' + c.tab + '"]'); if (!b || b.hidden) return { say: "That settings page isn't available." };
        click(b); return { say: ({ general: "General", connection: "Connection", local: "Local model", behavior: "Behavior", images: "Images and search", voice: "Voice", tools: "Tools" })[c.tab] + " settings." };
      }
      case "searchsettings": { const dlg = $("settings"); if (!dlg.open) { click($("openSettings")); await sleep(180); } const s = $("setSearch"); s.value = c.q; fire(s, "input"); return { say: "Searching settings for " + c.q + "." }; }
      case "status": { click($("refreshModels")); await sleep(1100); const t = (($("statusText") || {}).textContent || "").trim(); return { say: t ? t + "." : "I can't tell right now." }; }
      case "refreshmodels": click($("refreshModels")); return { say: "Refreshing the model list." };
      case "whichmodel": { const sel = $("setModel"), o = sel && sel.options[sel.selectedIndex]; const n = o && o.value ? o.textContent.trim() : ""; return { say: n ? "You're using " + n + "." : "No model is selected." }; }
      case "model": {
        const sel = $("setModel"), opts = [...sel.options].filter((o) => o.value); if (!opts.length) return { say: "There are no models to choose from." };
        let i = -1;
        if (c.rel) { const cur = opts.findIndex((o) => o.value === sel.value); i = ((cur < 0 ? 0 : cur) + c.rel + opts.length) % opts.length; }
        else { i = best(opts.map((o) => o.textContent), c.name); if (i < 0) return c.soft ? { pass: true } : { say: "I couldn't find a model called " + c.name + "." }; }
        sel.value = opts[i].value; fire(sel, "change"); return { say: "Using " + short(opts[i].textContent, 40) + "." };
      }
      case "persona": {
        const sel = $("personaSelect"); if (!sel) return { say: "Personas aren't available." };
        const opts = [...sel.options].filter((o) => o.value); if (!opts.length) return { say: "There are no personas saved." };
        let i; if (c.rel) { const cur = opts.findIndex((o) => o.value === sel.value); i = ((cur < 0 ? -1 : cur) + c.rel + opts.length) % opts.length; } else { i = best(opts.map((o) => o.textContent.replace(/^[^\p{L}\p{N}]+/u, "")), c.name); if (i < 0) return { say: "I couldn't find a persona called " + c.name + "." }; }
        const was = await withSettings(() => { sel.value = opts[i].value; fire(sel, "change"); });
        return { say: "Persona: " + short(opts[i].textContent.replace(/^[^\p{L}\p{N}]+/u, ""), 40) + "." + keepNote(was) };
      }
      case "temperature": { const v = Math.min(2, Math.max(0, c.v)); const was = await withSettings(() => { $("setTemp").value = v; fire($("setTemp"), "input"); }); return { say: "Temperature " + v + "." + keepNote(was) }; }
      case "localmodel": {
        const b = $(c.on ? "llamaStart" : "llamaStop"); if (!b || b.disabled) return { say: c.on ? "The built-in model can't be started right now." : "The built-in model isn't running." };
        click(b); return { say: c.on ? "Starting the local model. It can take a minute." : "Stopping the local model." };
      }
      case "hf": {
        if (c.op === "close") { click($("hfClose")); return { say: "Closed." }; }
        click($("hfOpen")); if (c.op === "open") return { say: "Model store." };
        await sleep(250); const q = $("hfQuery"); q.value = c.q; fire(q, "input"); try { $("hfForm").requestSubmit(); } catch (e) { click($("hfGo")); } return { say: "Searching for " + c.q + "." };
      }
      case "attach": click($("attachBtn")); return { say: "Choose the file in the window that opened." };
      case "project": click($("projectBtn")); return { say: "Choose the folder in the window that opened." };
      case "clearattach": { const bs = [...($("attached") || document.createElement("div")).querySelectorAll("button")]; if (!bs.length) return { say: "Nothing is attached." }; bs.forEach(click); return { say: "Removed the attachments." }; }
      case "cam": if (c.op === "open") { if (feedOpen()) return { say: "The camera or screen is already showing." }; click($("camBtn")); return { say: "Opening the camera." }; }
        if (!feedOpen()) return { say: "The camera isn't on." }; click($("visionFeedClose")); return { say: "Camera off." };
      case "screen": if (c.op === "open") { if (feedOpen()) return { say: "Already sharing." }; click($("screenBtn")); return { say: "Choose what to share." }; }
        if (!feedOpen()) return { say: "Nothing is being shared." }; click($("visionFeedClose")); return { say: "Stopped sharing." };
      case "snap": case "screenshot": if (!feedOpen()) return { say: c.id === "snap" ? "Turn on the camera first." : "Share your screen first." }; click($("visionCapture")); return { say: "Captured. It will go with your next message." };
      case "feedmin": if (!feedOpen()) return { say: "There's no video to minimize." }; click($("visionFeedMin")); return { say: "" };
      case "approve": return approve(c);
      case "decline": return decline();
      case "stopcmd": { const s = scan(); if (!s.running.length) return { say: "No command is running." }; click(s.running[s.running.length - 1].stop); return { say: "Stopping it." }; }
      case "voice": {
        const eng = window.LMChatTTS && window.LMChatTTS.active && window.LMChatTTS.active();
        const n = cycle(eng ? $("ttsVoice") : $("setVoice"), c.d); return { say: n ? "Voice: " + n + "." : "There's no other voice." };
      }
      case "voicetest": click($("voiceTest")); return { say: "" };
      case "wakeword": { const w = $("setWakeWord"); if (!w) return { say: "I can't change the wake word here." }; w.value = c.word.slice(0, 40); fire(w, "input"); fire(w, "change"); return { say: "The wake word is now " + c.word + "." }; }
      case "bargesens": { const s = $("setBargeSens"); if (!s) return { say: "" }; s.value = c.v; fire(s, "change"); return { say: "Interrupt sensitivity " + c.v + "." }; }
      case "toggle": {
        const tg = A.TOGGLES.find((x) => x.key === c.key), el = tg && $(tg.el); if (!tg || !el) return { say: "I can't change that here." };
        const label = tg.say.charAt(0).toUpperCase() + tg.say.slice(1);
        if (tg.button) { const now = el.getAttribute("aria-pressed") === "true" || el.classList.contains("on"); if (now === c.on) return { say: label + " is already " + (c.on ? "on" : "off") + "." }; click(el); return { say: label + (c.on ? " on." : " off.") }; }
        if (tg.kind === "live") { if (el.checked === c.on) return { say: label + " is already " + (c.on ? "on" : "off") + "." }; el.checked = c.on; fire(el, "change"); return { say: label + (c.on ? " on." : " off.") }; }
        let same = false; const was = await withSettings(() => { if (el.checked === c.on) same = true; else { el.checked = c.on; fire(el, "change"); } });
        return { say: same ? label + " is already " + (c.on ? "on" : "off") + "." : label + (c.on ? " on." : " off.") + keepNote(was) };
      }
      case "help": {
        if (c.group) { const g = groupByName(c.group); if (g) { showHelp(); return { say: spokenFor(g) }; } }
        showHelp(); return { say: OVERVIEW };
      }
      case "helpclose": { const d = $("voiceHelp"); if (d && d.open) d.close(); return { say: "Closed." }; }
    }
    return { pass: true };
  }

  /* A bare "yes" / "no" while the AI is asking to use a tool answers that question. Returns null when it doesn't apply. */
  function bareAnswer(text) {
    const Cmd = window.LMChatCmds; if (!Cmd) return null;
    const yes = Cmd.isYes(text), no = Cmd.isNo(text); if (!yes && !no) return null;
    const s = scan(); if (!s.allow && !s.deny) return null;
    return Promise.resolve(yes ? approve({ scope: "tool" }) : decline()).then((r) => r.say || "");
  }

  A.setLinks(() => [...document.querySelectorAll("#links a")].map((a) => a.title || a.textContent));
  // A button in Settings > Voice to see the whole list with the mouse too.
  (function addButton() {
    const t = $("voiceTest"); if (!t || $("voiceHelpBtn")) return;
    const b = document.createElement("button"); b.type = "button"; b.id = "voiceHelpBtn"; b.textContent = "Voice commands…"; b.title = "Everything you can say in live chat";
    b.onclick = () => showHelp(); t.insertAdjacentElement("afterend", b);
  })();
  window.LMChatApp = { exec, bareAnswer, showHelp, OVERVIEW };
})();
