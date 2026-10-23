/* IcyWhite password manager - the browser shell's side (loaded by browser.html after its own script).
 *  - the Passwords window (create / unlock / list / view / add / edit / settings)
 *  - the "Save this password?" bar under the toolbar
 *  - the relay between web pages and the vault (pages never talk to the vault; this file asks it, using the tab's real address)
 * Uses only DOM calls that take text (textContent), never HTML strings, so saved names and notes can't inject markup. */
(function () {
  "use strict";
  const PW = window.oasisElectron && window.oasisElectron.pw;
  if (!PW) return;

  // ---------- tiny helpers ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  async function call(fn, ...args) {
    const r = await fn(...args);
    if (r && r.error) { const e = new Error(r.error); e.code = r.code; throw e; }
    return r && r.ok;
  }
  const $id = (id) => document.getElementById(id);
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch (e) { return ""; } };
  const isWeb = (u) => /^https?:\/\//i.test(String(u || ""));
  const tabItem = () => (typeof tabs !== "undefined" ? tabs.find((t) => t.id === activeId) : null);
  const tabUrl = (item) => { try { return item && item.view ? item.view.getURL() : ""; } catch (e) { return ""; } };
  const hue = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 360; return n; };
  function avatar(name) {
    const a = h("span", { class: "pwAv", text: (String(name || "?").trim()[0] || "?").toUpperCase() });
    a.style.background = "hsl(" + hue(String(name || "")) + ",45%,42%)";
    return a;
  }

  // ---------- vault state, kept in sync with the main process ----------
  let st = { exists: false, unlocked: false, settings: { autoLockMin: 15, autofillOnLoad: false } };
  const neverThisSession = new Set();
  async function refreshStatus() {
    try { st = await call(PW.status); } catch (e) {}
    updateButton();
    return st;
  }
  PW.onState((s) => {
    if (s && typeof s === "object") st = Object.assign({}, st, s);
    updateButton();
    if (modal && M.view !== "settings") { if (!st.unlocked && ["list", "detail", "edit"].includes(M.view)) { M.view = st.exists ? "unlock" : "setup"; render(); } }
    requeryAllTabs();
  });
  function requeryAllTabs() {
    if (typeof tabs === "undefined") return;
    tabs.forEach((t) => { try { t.pwAuto = false; t.view.send("pw-requery"); } catch (e) {} });
  }

  // ---------- toolbar button ----------
  function updateButton() {
    const b = $id("pwBtn"); if (!b) return;
    const item = tabItem();
    const has = !!(item && item.pwLogin && st.exists && st.unlocked && item.pwCount > 0);
    const locked = !!(item && (item.pwLogin || item.pwSignup) && st.exists && !st.unlocked);
    b.classList.toggle("has", has);
    b.classList.toggle("locked", locked);
    b.title = has ? "Passwords - a saved login is available for this site (Ctrl+Shift+K)" : locked ? "Passwords - locked (Ctrl+Shift+K)" : "Passwords (Ctrl+Shift+K)";
  }
  setInterval(updateButton, 700);

  // ---------- page <-> vault relay ----------
  async function matchesFor(v) {
    if (!st.exists) return { state: "off", items: [] };
    if (!st.unlocked) return { state: "locked", items: [] };
    let url = ""; try { url = v.getURL(); } catch (e) {}
    if (!isWeb(url)) return { state: "ready", items: [] };
    try { return { state: "ready", items: await call(PW.find, url) }; }
    catch (e) { if (e.code === "locked") { await refreshStatus(); return { state: "locked", items: [] }; } return { state: "ready", items: [] }; }
  }
  async function fillTab(v, id) {
    let url = ""; try { url = v.getURL(); } catch (e) {}
    const d = await call(PW.fillData, String(id), url);          // main re-checks that this login belongs to this address
    try { v.send("pw-fill-data", d); } catch (e) {}
  }
  window.pwHandleGuest = async function (item, v, channel, arg) {
    try {
      arg = arg && typeof arg === "object" ? arg : {};
      const active = typeof activeId !== "undefined" && activeId === item.id;
      if (channel === "pw-forms") { item.pwLogin = !!arg.login; item.pwSignup = !!arg.signup; if (!item.pwLogin) item.pwCount = 0; updateButton(); }
      else if (channel === "pw-query") {
        if (!st.exists && !st.unlocked) await refreshStatus();
        const m = await matchesFor(v);
        item.pwCount = m.items.length;
        try { v.send("pw-matches", m); } catch (e) {}
        updateButton();
        if (st.settings && st.settings.autofillOnLoad && m.state === "ready" && m.items.length === 1 && item.pwLogin && !item.pwAuto && active) { item.pwAuto = true; await fillTab(v, m.items[0].id); }
      }
      else if (channel === "pw-fill") { if (active && typeof arg.id === "string") await fillTab(v, arg.id); }
      else if (channel === "pw-open-ui") { if (active) openModal(arg.mode === "unlock" ? "unlock" : null); }
      else if (channel === "pw-submit") onSubmit(item, v, arg);
    } catch (e) { /* a page can't break the browser */ }
  };
  window.pwOnNavigate = function (item) {
    item.pwLogin = false; item.pwSignup = false; item.pwCount = 0; item.pwAuto = false;
    if (item.pwPending) { clearTimeout(item.pwTimer); item.pwTimer = setTimeout(() => maybePrompt(item), 1300); }
    updateButton();
  };

  // ---------- "Save password?" bar ----------
  let pending = null;
  async function onSubmit(item, v, s) {
    if (IS_PRIVATE) return;                                       // nothing is offered to be saved in InPrivate windows
    if (typeof s.password !== "string" || !s.password || typeof s.username !== "string") return;
    const url = tabUrl(item);
    if (!isWeb(url) || neverThisSession.has(hostOf(url))) return;
    if (st.exists && !st.unlocked) await refreshStatus();
    let kind = "new", id = null;
    try {
      if (await call(PW.isNever, url)) return;
      if (st.unlocked) {
        const c = await call(PW.check, url, s.username, s.password);
        if (c.status === "same" || c.status === "never" || c.status === "ignore") return;
        if (c.status === "update") { kind = "update"; id = c.id; }
      }
    } catch (e) { if (e.code === "locked") await refreshStatus(); }
    item.pwPending = { url, username: s.username, password: s.password, kind, id };
    clearTimeout(item.pwTimer);
    item.pwTimer = setTimeout(() => maybePrompt(item), 1800);
  }
  function maybePrompt(item) {
    const p = item.pwPending; item.pwPending = null;
    if (!p || item.pwLogin || item.pwSignup) return;               // the form is still showing: the login failed (or it was only a "show password" click)
    if (typeof activeId === "undefined" || activeId !== item.id) return;
    showBar(p);
  }
  function hideBar() { const b = $id("pwBar"); if (b) { b.classList.remove("open"); b.textContent = ""; } pending = null; }
  function showBar(p) {
    const b = $id("pwBar"); if (!b) return;
    pending = p;
    b.textContent = "";
    const host = hostOf(p.url);
    const user = h("input", { class: "pwBarUser", type: "text", value: p.username, placeholder: "user name", spellcheck: "false", autocomplete: "off" });
    const msg = h("span", { class: "pwBarMsg" }, p.kind === "update" ? "Update the saved password for " : "Save the password for ", h("b", { text: host }), "?");
    const doSave = async () => {
      const entry = { url: p.url, username: user.value.trim(), password: p.password };
      const run = async () => { try { await call(PW.add, entry); b.textContent = ""; b.append(h("span", { class: "pwBarMsg", text: "Saved to IcyWhite Passwords." })); setTimeout(hideBar, 1600); } catch (e) { hideBar(); } };
      await refreshStatus();
      if (!st.exists) { openModal("setup", { then: run }); }
      else if (!st.unlocked) { openModal("unlock", { then: run }); }
      else run();
    };
    const dismiss = () => hideBar();
    const never = async () => { const hst = hostOf(p.url); try { if (st.exists) await call(PW.setNever, p.url); else neverThisSession.add(hst); } catch (e) { neverThisSession.add(hst); } hideBar(); };
    b.append(
      h("span", { class: "pwBarIcon" }, "🔑"), msg, user,
      h("button", { class: "pwBarBtn primary", onclick: doSave, text: p.kind === "update" ? "Update" : "Save" }),
      h("button", { class: "pwBarBtn", onclick: dismiss, text: "Not now" }),
      p.kind === "new" ? h("button", { class: "pwBarBtn", onclick: never, text: "Never for this site" }) : null,
      h("button", { class: "pwBarX", title: "Close", onclick: dismiss, text: "×" })
    );
    b.classList.add("open");
  }

  // ---------- the Passwords window ----------
  let modal = null;
  const M = { view: "list", id: null, then: null, search: "", draft: null, notice: "" };
  function closeModal() {
    if (modal) { modal.remove(); modal = null; }
    M.then = null; M.draft = null; M.notice = "";
    window.removeEventListener("keydown", onModalKey, true);
  }
  function onModalKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeModal(); } }
  async function openModal(view, opts) {
    opts = opts || {};
    try { closeDropdowns(); } catch (e) {}
    await refreshStatus();
    M.then = opts.then || null; M.id = null; M.search = ""; M.draft = null; M.notice = "";
    M.view = !st.exists ? "setup" : !st.unlocked ? "unlock" : (view && view !== "unlock" && view !== "setup" ? view : "list");
    if (!modal) {
      const card = h("div", { class: "pwCard", role: "dialog", "aria-modal": "true", "aria-label": "Passwords" });
      modal = h("div", { id: "pwModal", onmousedown: (e) => { if (e.target === modal) closeModal(); } }, card);
      document.body.appendChild(modal);
      window.addEventListener("keydown", onModalKey, true);
    }
    render();
  }
  window.pwOpenModal = openModal;

  function field(label, input, hint) {
    return h("label", { class: "pwField" }, h("span", { class: "pwLabel", text: label }), input, hint ? h("span", { class: "pwHint", text: hint }) : null);
  }
  const btn = (text, onclick, cls) => h("button", { class: "pwBtn " + (cls || ""), type: "button", onclick, text });
  function header(title, back) {
    return h("div", { class: "pwHead" },
      back ? h("button", { class: "pwBack", type: "button", title: "Back", onclick: back, text: "‹" }) : null,
      h("h2", { text: title }),
      h("button", { class: "pwClose", type: "button", title: "Close", onclick: closeModal, text: "×" }));
  }
  function errBox() { return h("div", { class: "pwErr", role: "alert" }); }
  const showErr = (box, e) => { box.textContent = (e && e.message) || String(e); };
  function busy(button, fn) {
    return async (ev) => {
      if (ev && ev.preventDefault) ev.preventDefault();
      const label = button.textContent; button.disabled = true;
      try { await fn(); } finally { if (button.isConnected) { button.disabled = false; button.textContent = label; } }
    };
  }

  function render() {
    if (!modal) return;
    const card = modal.firstChild; card.textContent = "";
    const v = M.view;
    if (v === "setup") viewSetup(card);
    else if (v === "unlock") viewUnlock(card);
    else if (v === "reset") viewReset(card);
    else if (v === "list") viewList(card);
    else if (v === "detail") viewDetail(card);
    else if (v === "edit") viewEdit(card);
    else if (v === "settings") viewSettings(card);
    const first = card.querySelector("input:not([type=checkbox]),select"); if (first) setTimeout(() => { try { first.focus(); } catch (e) {} }, 30);
  }
  async function afterAuth() {
    const cb = M.then; M.then = null;
    if (cb) { closeModal(); try { await cb(); } catch (e) {} return; }
    M.view = "list"; render();
  }

  function viewSetup(card) {
    const p1 = h("input", { type: "password", autocomplete: "new-password", placeholder: "At least 8 characters" });
    const p2 = h("input", { type: "password", autocomplete: "new-password", placeholder: "Type it again" });
    const err = errBox();
    const go = btn("Create password vault", null, "primary");
    const submit = busy(go, async () => {
      err.textContent = "";
      if (p1.value.length < 8) return showErr(err, "Use at least 8 characters.");
      if (p1.value !== p2.value) return showErr(err, "The two passwords are not the same.");
      try { await call(PW.setup, p1.value); await refreshStatus(); p1.value = p2.value = ""; await afterAuth(); } catch (e) { showErr(err, e); }
    });
    go.type = "submit";
    card.append(header("Create your master password"),
      h("p", { class: "pwText", text: "One master password protects all your saved logins. They are encrypted on this computer (AES-256) and never leave it." }),
      h("p", { class: "pwWarn", text: "If you forget this password, your saved logins can't be recovered. Write it down somewhere safe." }),
      h("form", { class: "pwForm", onsubmit: submit }, field("Master password", p1), field("Repeat master password", p2), err, h("div", { class: "pwRow end" }, go)));
  }

  function viewUnlock(card) {
    const p = h("input", { type: "password", autocomplete: "current-password", placeholder: "Master password" });
    const err = errBox();
    const go = btn("Unlock", null, "primary");
    const submit = busy(go, async () => {
      err.textContent = "";
      try { await call(PW.unlock, p.value); p.value = ""; await refreshStatus(); await afterAuth(); } catch (e) { showErr(err, e); p.select(); }
    });
    go.type = "submit";
    card.append(header("Unlock passwords"),
      h("form", { class: "pwForm", onsubmit: submit }, field("Master password", p), err, h("div", { class: "pwRow between" }, h("button", { class: "pwLink", type: "button", onclick: () => { M.view = "reset"; render(); }, text: "Forgot it?" }), go)));
  }

  function viewReset(card) {
    const t = h("input", { type: "text", placeholder: "Type RESET", spellcheck: "false", autocomplete: "off" });
    const err = errBox();
    const go = btn("Delete all saved passwords", null, "danger");
    const submit = busy(go, async () => {
      err.textContent = "";
      if (t.value.trim() !== "RESET") return showErr(err, "Type RESET (in capitals) to confirm.");
      try { await call(PW.reset, ""); await refreshStatus(); M.view = "setup"; render(); } catch (e) { showErr(err, e); }
    });
    go.type = "submit";
    card.append(header("Forgot your master password?", () => { M.view = "unlock"; render(); }),
      h("p", { class: "pwText", text: "There is no way to recover it - that is what keeps your logins safe. You can start over with a new, empty vault. The old encrypted file is kept in the app's data folder, renamed icywhite-vault.reset-<number>.json, in case you remember the password later." }),
      h("form", { class: "pwForm", onsubmit: submit }, field("Confirm", t), err, h("div", { class: "pwRow end" }, go)));
  }

  async function viewList(card) {
    const search = h("input", { type: "search", class: "pwSearch", placeholder: "Search passwords", value: M.search, spellcheck: "false", autocomplete: "off" });
    const body = h("div", { class: "pwList" });
    const draw = (all, mine) => {
      body.textContent = "";
      const q = search.value.trim().toLowerCase();
      const shown = all.filter((e) => !q || (e.name + " " + e.host + " " + e.username).toLowerCase().includes(q));
      if (mine.length && !q) {
        body.append(h("div", { class: "pwSection", text: "For this site" }));
        mine.forEach((m) => { const e = all.find((x) => x.id === m.id); if (e) body.append(entryRow(e, true)); });
        body.append(h("div", { class: "pwSection", text: "All logins" }));
      }
      if (!shown.length) body.append(h("div", { class: "pwEmpty", text: all.length ? "No match." : "Nothing saved yet. Sign in to a website and IcyWhite will offer to save it, or use Add / Import." }));
      shown.forEach((e) => body.append(entryRow(e, false)));
    };
    card.append(
      header("Passwords"),
      h("div", { class: "pwBar2" }, search, btn("+ Add", () => { M.draft = null; M.id = null; M.view = "edit"; render(); }, "primary")),
      M.notice ? h("div", { class: "pwNote", text: M.notice }) : document.createComment(""),
      body,
      h("div", { class: "pwFoot" }, btn("Lock now", async () => { try { await call(PW.lock); } catch (e) {} await refreshStatus(); closeModal(); }), btn("Settings", () => { M.view = "settings"; render(); })));
    M.notice = "";
    let all = [], mine = [];
    try {
      all = await call(PW.list);
      const url = tabUrl(tabItem()); if (isWeb(url)) mine = await call(PW.find, url);
    } catch (e) { if (e.code === "locked") { await refreshStatus(); M.view = "unlock"; render(); return; } }
    if (!modal || M.view !== "list") return;
    draw(all, mine);
    search.addEventListener("input", () => { M.search = search.value; draw(all, mine); });
  }
  function entryRow(e, withFill) {
    const row = h("div", { class: "pwRowItem", tabindex: "0", role: "button", onclick: () => { M.id = e.id; M.view = "detail"; render(); }, onkeydown: (ev) => { if (ev.key === "Enter") ev.currentTarget.click(); } },
      avatar(e.name || e.host), h("span", { class: "pwRowText" }, h("span", { class: "pwRowName", text: e.name || e.host }), h("span", { class: "pwRowSub", text: (e.username || "(no user name)") + " · " + e.host })));
    if (withFill) {
      const it = tabItem();
      row.append(h("button", { class: "pwBtn small primary", type: "button", text: "Fill", onclick: async (ev) => { ev.stopPropagation(); try { await fillTab(it.view, e.id); closeModal(); } catch (x) { M.notice = x.message; render(); } } }));
    }
    return row;
  }

  async function viewDetail(card) {
    let e;
    try { e = await call(PW.reveal, M.id); } catch (x) { if (x.code === "locked") { await refreshStatus(); M.view = "unlock"; return render(); } M.view = "list"; M.notice = x.message; return render(); }
    if (!modal || M.view !== "detail") return;
    const copy = async (text, label, b) => { try { await call(PW.copy, text); const o = b.textContent; b.textContent = "Copied"; setTimeout(() => { b.textContent = o; }, 1100); } catch (x) {} void label; };
    const pwSpan = h("span", { class: "pwVal mono", text: "••••••••••••" });
    let shown = false;
    const showB = btn("Show", () => { shown = !shown; pwSpan.textContent = shown ? e.password : "••••••••••••"; showB.textContent = shown ? "Hide" : "Show"; }, "small");
    const cpU = btn("Copy", () => copy(e.username, "user", cpU), "small");
    const cpP = btn("Copy", () => copy(e.password, "password", cpP), "small");
    const url = tabUrl(tabItem());
    let canFill = false; try { canFill = isWeb(url) && hostOf(url) === hostOf(e.url) && (new URL(url).protocol === "https:" || new URL(e.url).protocol === "http:"); } catch (x) {}
    const del = btn("Delete", async () => {
      if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "Really delete?"; setTimeout(() => { if (del.isConnected) { delete del.dataset.sure; del.textContent = "Delete"; } }, 3500); return; }
      try { await call(PW.remove, e.id); M.view = "list"; render(); } catch (x) {}
    }, "danger");
    card.append(header(e.name || e.host, () => { M.view = "list"; render(); }),
      h("div", { class: "pwDetail" },
        h("div", { class: "pwKV" }, h("span", { class: "pwLabel", text: "Website" }), h("span", { class: "pwVal", text: e.url }), btn("Open", () => { try { makeTab(e.url); closeModal(); } catch (x) {} }, "small")),
        h("div", { class: "pwKV" }, h("span", { class: "pwLabel", text: "User name" }), h("span", { class: "pwVal", text: e.username || "(none)" }), cpU),
        h("div", { class: "pwKV" }, h("span", { class: "pwLabel", text: "Password" }), pwSpan, h("span", { class: "pwBtns" }, showB, cpP)),
        e.notes ? h("div", { class: "pwKV col" }, h("span", { class: "pwLabel", text: "Notes" }), h("span", { class: "pwVal pre", text: e.notes })) : null),
      h("div", { class: "pwFoot" }, canFill ? btn("Fill in this tab", async () => { try { await fillTab(tabItem().view, e.id); closeModal(); } catch (x) {} }, "primary") : null,
        btn("Edit", () => { M.draft = e; M.view = "edit"; render(); }), del));
  }

  async function viewEdit(card) {
    let e = M.draft;
    if (!e && M.id) { try { e = await call(PW.reveal, M.id); } catch (x) { M.view = "list"; return render(); } }
    if (!modal || M.view !== "edit") return;
    const isNew = !e;
    const cur = tabUrl(tabItem());
    const name = h("input", { type: "text", value: e ? e.name : "", placeholder: "Name (optional)", autocomplete: "off" });
    const url = h("input", { type: "text", value: e ? e.url : (isWeb(cur) ? new URL(cur).origin : ""), placeholder: "https://example.com", autocomplete: "off", spellcheck: "false" });
    const user = h("input", { type: "text", value: e ? e.username : "", autocomplete: "off", spellcheck: "false" });
    const pass = h("input", { type: "password", value: e ? e.password : "", autocomplete: "new-password", spellcheck: "false" });
    const notes = h("textarea", { rows: "3" }); notes.value = e ? e.notes || "" : "";
    const gen = btn("Generate", async () => { try { pass.value = await call(PW.generate, { length: 20 }); pass.type = "text"; showB.textContent = "Hide"; } catch (x) {} }, "small");
    const showB = btn("Show", () => { const on = pass.type === "password"; pass.type = on ? "text" : "password"; showB.textContent = on ? "Hide" : "Show"; }, "small");
    const err = errBox();
    const save = btn("Save", null, "primary");
    const submit = busy(save, async () => {
      err.textContent = "";
      try {
        const data = { name: name.value, url: url.value, username: user.value, password: pass.value, notes: notes.value };
        if (isNew) await call(PW.add, data); else await call(PW.update, e.id, data);
        M.draft = null; M.view = "list"; render();
      } catch (x) { showErr(err, x); }
    });
    save.type = "submit";
    card.append(header(isNew ? "Add a login" : "Edit login", () => { M.view = isNew ? "list" : "detail"; render(); }),
      h("form", { class: "pwForm", onsubmit: submit },
        field("Website", url), field("Name", name), field("User name", user),
        h("div", { class: "pwField" }, h("span", { class: "pwLabel", text: "Password" }), h("div", { class: "pwRow" }, pass, showB, gen)),
        field("Notes", notes), err, h("div", { class: "pwRow end" }, btn("Cancel", () => { M.view = isNew ? "list" : "detail"; render(); }), save)));
  }

  function viewSettings(card) {
    const s = st.settings || {};
    const lockSel = h("select", {}, [[0, "Never"], [1, "1 minute"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"]].map(([v, t]) => h("option", { value: v, text: t, selected: Number(s.autoLockMin) === v })));
    lockSel.addEventListener("change", async () => { try { await call(PW.settings, { autoLockMin: Number(lockSel.value) }); await refreshStatus(); } catch (x) {} });
    const auto = h("input", { type: "checkbox", checked: !!s.autofillOnLoad });
    auto.addEventListener("change", async () => { try { await call(PW.settings, { autofillOnLoad: auto.checked }); await refreshStatus(); } catch (x) {} });
    const status = h("div", { class: "pwNote", style: "display:none" });
    const say = (t, bad) => { status.style.display = ""; status.className = bad ? "pwErr" : "pwNote"; status.textContent = t; };

    // change master password
    const o = h("input", { type: "password", autocomplete: "current-password", placeholder: "Current master password" });
    const n1 = h("input", { type: "password", autocomplete: "new-password", placeholder: "New master password" });
    const n2 = h("input", { type: "password", autocomplete: "new-password", placeholder: "New master password again" });
    const chg = btn("Change master password", null);
    chg.addEventListener("click", busy(chg, async () => {
      if (n1.value !== n2.value) return say("The two new passwords are not the same.", true);
      try { await call(PW.changeMaster, o.value, n1.value); o.value = n1.value = n2.value = ""; say("Master password changed."); } catch (x) { say(x.message, true); }
    }));

    // export (asks for the master password again)
    const ex = h("input", { type: "password", autocomplete: "current-password", placeholder: "Master password to confirm" });
    const exB = btn("Export to CSV…", null);
    exB.addEventListener("click", busy(exB, async () => {
      try { const r = await call(PW.exportCsv, ex.value); ex.value = ""; say(r && r.canceled ? "Export cancelled." : "Saved to " + r.path + " - this file is NOT encrypted. Delete it when you're done."); } catch (x) { say(x.message, true); }
    }));
    const imB = btn("Import from CSV…", null);
    imB.addEventListener("click", busy(imB, async () => {
      try { const r = await call(PW.importCsv); if (r && r.canceled) return; say("Imported: " + r.added + " added, " + r.updated + " updated, " + r.same + " already saved, " + r.skipped + " skipped."); } catch (x) { say(x.message, true); }
    }));
    const nv = btn("Forget \"never save\" choices", async () => { try { await call(PW.clearNever); say("Done. IcyWhite will offer to save on every site again."); neverThisSession.clear(); } catch (x) { say(x.message, true); } });

    card.append(header("Password settings", () => { M.view = "list"; render(); }),
      h("div", { class: "pwSettings" },
        h("div", { class: "pwSet" }, h("span", { text: "Lock automatically after" }), lockSel),
        h("label", { class: "pwSet check" }, auto, h("span", { text: "Fill a login as soon as a page loads (only if exactly one login matches). Off by default: filling then needs one click on the field's menu." })),
        h("div", { class: "pwSection", text: "Change master password" }), o, n1, n2, chg,
        h("div", { class: "pwSection", text: "Import and export" }),
        h("p", { class: "pwText small", text: "Import works with files exported from Chrome, Edge, Firefox, Bitwarden and 1Password (CSV). Passwords in an export are readable by anyone who finds the file." }),
        h("div", { class: "pwRow" }, imB), ex, h("div", { class: "pwRow" }, exB),
        h("div", { class: "pwSection", text: "Other" }), h("div", { class: "pwRow" }, nv),
        status));
  }

  // ---------- hooks into the browser window ----------
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("#pwBtn"); if (b) openModal(); });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); modal ? closeModal() : openModal(); }
  });
  refreshStatus();
})();
