// Loaded into browser tabs. Exposes the project-folder bridge ONLY to this app's own local pages
// (file://), never to websites you browse in other tabs.
const { contextBridge, ipcRenderer, webFrame } = require("electron");
if (location.protocol === "file:") {
  // Tab control + "follow my tab" for the Home page: the browser shell does the work, these just carry the messages.
  let shareKind = "";
  const tabWait = new Map(); let tabSeq = 0;
  ipcRenderer.on("oasis-tabs-result", (_e, id, result) => { const f = tabWait.get(id); if (f) { tabWait.delete(id); f(result); } });
  ipcRenderer.on("oasis-share-info", (_e, info) => { shareKind = info && info.kind || ""; });
  // The shell switched tabs while a tab is shared: let the page re-share the new one (run as if clicked, so the browser allows it).
  ipcRenderer.on("oasis-share-refollow", () => { try { webFrame.executeJavaScript("window.lmchatRefollow && window.lmchatRefollow()", true); } catch (e) {} });
  contextBridge.exposeInMainWorld("oasisTabs", {
    command: (req) => new Promise((resolve) => {
      const id = ++tabSeq; tabWait.set(id, resolve);
      try { ipcRenderer.sendToHost("oasis-tabs", id, req); } catch (e) { tabWait.delete(id); resolve({ error: "no browser" }); }
      setTimeout(() => { if (tabWait.delete(id)) resolve({ error: "timeout" }); }, 4000);
    }),
    following: () => shareKind === "tab",
    snapshot: () => ipcRenderer.invoke("share-snapshot"),
    links: () => ipcRenderer.invoke("share-links"),
    click: (q) => ipcRenderer.invoke("share-click", q),
    shareStopped: () => { shareKind = ""; try { ipcRenderer.sendToHost("oasis-share-stopped"); } catch (e) {} }
  });
  contextBridge.exposeInMainWorld("oasisProject", {
    projectPick: () => ipcRenderer.invoke("project-pick"),
    projectOpen: (root) => ipcRenderer.invoke("project-open", root),
    projectRead: (rel) => ipcRenderer.invoke("project-read", rel),
    projectReadBin: (rel) => ipcRenderer.invoke("project-read-bin", rel),
    projectWrite: (rel, content) => ipcRenderer.invoke("project-write", rel, content),
    projectDelete: (rel) => ipcRenderer.invoke("project-delete", rel),
    // Ask the browser shell to open a link as a new tab. Works even when the
    // request comes from the AI after a reply finishes (no fresh click).
    openTab: (url) => {
      try { ipcRenderer.sendToHost("oasis-open-tab", String(url)); } catch (e) {}      // inside a browser tab
      try { ipcRenderer.send("oasis-open-tab-fallback", String(url)); } catch (e) {}   // inside a popped-out window
    },
    // Running commands: only the Home page itself is allowed to use these (main.js checks again).
    platform: process.platform,
    projectRun: (req) => ipcRenderer.invoke("project-run", req),
    projectRunCancel: (id) => ipcRenderer.invoke("project-run-cancel", id),
    terminalOpen: (req) => ipcRenderer.invoke("terminal-open", req),
    // Native Windows apps/utilities by registry id (see js/windows-apps.js). Home page only (main.js checks again).
    winLaunch: (req) => ipcRenderer.invoke("win-launch", req),
    // Shared preferences (theme, AI server address) and detection of other local AI servers. File pages only.
    getPref: (key) => ipcRenderer.invoke("prefs-get", key),
    setPref: (key, value) => ipcRenderer.invoke("prefs-set", key, value),
    onPref: (callback) => ipcRenderer.on("oasis-pref", (_event, key, value) => callback(key, value)),
    // Debug log (shared by every window; shown in a pop-up).
    debugAdd: (level, msg, multi) => ipcRenderer.send("debug-log-add", level, msg, !!multi),
    debugOpen: () => ipcRenderer.invoke("debug-log-open"),
    debugCopy: () => ipcRenderer.invoke("debug-log-copy"),
    probeServers: () => ipcRenderer.invoke("probe-servers"),
    // Web research (search + read pages, with sources). Home page only (main.js checks again).
    webResearch: (query, opt) => ipcRenderer.invoke("web-research", query, opt),
    webRead: (url) => ipcRenderer.invoke("web-read", url),
    // Local models (llama.cpp llama-server). Home page only (main.js checks again).
    llamaStatus: () => ipcRenderer.invoke("llama-status"),
    llamaModels: () => ipcRenderer.invoke("llama-models"),
    llamaConfig: (patch) => ipcRenderer.invoke("llama-config", patch),
    llamaPreview: (model) => ipcRenderer.invoke("llama-preview", model),
    llamaStart: (req) => ipcRenderer.invoke("llama-start", req),
    llamaStop: () => ipcRenderer.invoke("llama-stop"),
    llamaEstimate: (req) => ipcRenderer.invoke("llama-estimate", req),
    llamaOpenLogsDir: () => ipcRenderer.invoke("llama-open-logs-dir"),
    llamaMultiList: () => ipcRenderer.invoke("llama-multi-list"),
    llamaMultiAdd: (req) => ipcRenderer.invoke("llama-multi-add", req),
    llamaMultiUpdate: (id, patch) => ipcRenderer.invoke("llama-multi-update", id, patch),
    llamaMultiReload: (id, patch) => ipcRenderer.invoke("llama-multi-reload", id, patch),
    llamaMultiStop: (id) => ipcRenderer.invoke("llama-multi-stop", id),
    llamaMultiRemove: (id) => ipcRenderer.invoke("llama-multi-remove", id),
    llamaMultiStopAll: () => ipcRenderer.invoke("llama-multi-stop-all"),
    llamaMultiMax: (n) => ipcRenderer.invoke("llama-multi-max", n),
    llamaPickModelsDir: () => ipcRenderer.invoke("llama-pick-models-dir"),
    llamaOpenModelsDir: () => ipcRenderer.invoke("llama-open-models-dir"),
    llamaRuntimes: (opt) => ipcRenderer.invoke("llama-runtimes", opt),
    llamaPickRuntimesDir: () => ipcRenderer.invoke("llama-pick-runtimes-dir"),
    llamaOpenRuntimesDir: () => ipcRenderer.invoke("llama-open-runtimes-dir"),
    // Hugging Face model hub: search, model pages, downloads. Home page only (main.js checks again).
    hfConfigGet: () => ipcRenderer.invoke("hf-config-get"),
    hfConfigSet: (patch) => ipcRenderer.invoke("hf-config-set", patch),
    hfTokenSet: (token) => ipcRenderer.invoke("hf-token-set", token),
    hfTokenTest: () => ipcRenderer.invoke("hf-token-test"),
    hfHardware: () => ipcRenderer.invoke("hf-hardware"),
    hfSearch: (q) => ipcRenderer.invoke("hf-search", q),
    hfModel: (repo, rev) => ipcRenderer.invoke("hf-model", repo, rev),
    hfReadme: (repo, rev) => ipcRenderer.invoke("hf-readme", repo, rev),
    hfResolve: (text) => ipcRenderer.invoke("hf-resolve", text),
    hfStarters: () => ipcRenderer.invoke("hf-starters"),
    hfDlAdd: (req) => ipcRenderer.invoke("hf-dl-add", req),
    hfDlList: () => ipcRenderer.invoke("hf-dl-list"),
    hfDlPause: (id) => ipcRenderer.invoke("hf-dl-pause", id),
    hfDlResume: (id) => ipcRenderer.invoke("hf-dl-resume", id),
    hfDlRetry: (id) => ipcRenderer.invoke("hf-dl-retry", id),
    hfDlCancel: (id) => ipcRenderer.invoke("hf-dl-cancel", id),
    hfDlRemove: (id) => ipcRenderer.invoke("hf-dl-remove", id),
    hfDlClear: () => ipcRenderer.invoke("hf-dl-clear"),
    hfDlOpen: (id) => ipcRenderer.invoke("hf-dl-open", id),
    // MCP tools (servers the AI can use). Home page only (main.js checks again).
    mcpGet: () => ipcRenderer.invoke("mcp-get"),
    mcpSetGlobal: (p) => ipcRenderer.invoke("mcp-set-global", p),
    mcpSaveServer: (s) => ipcRenderer.invoke("mcp-save-server", s),
    mcpImport: (text) => ipcRenderer.invoke("mcp-import", text),
    mcpRemoveServer: (id) => ipcRenderer.invoke("mcp-remove-server", id),
    mcpStart: (id) => ipcRenderer.invoke("mcp-start", id),
    mcpStop: (id) => ipcRenderer.invoke("mcp-stop", id),
    mcpTools: () => ipcRenderer.invoke("mcp-tools"),
    mcpCall: (name, args) => ipcRenderer.invoke("mcp-call", name, args),
    mcpAlways: (serverId, tool, on) => ipcRenderer.invoke("mcp-always", serverId, tool, on),
    mcpPickDir: () => ipcRenderer.invoke("mcp-pick-dir")
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Password manager, page side. Runs in ordinary web pages only (http/https). It never sees the vault: it finds login
// forms, shows a small "fill" menu under the field, remembers what was typed when a form is submitted, and fills a form
// when the browser shell hands it a login that the person clicked. All decisions about WHICH site a login belongs to are
// made by the shell (it uses the tab's real address, never anything this script or the page claims).
// Wrapped in try/catch everywhere: a problem here must never stop a page from loading or working.
// ---------------------------------------------------------------------------------------------------------------------
if (location.protocol === "http:" || location.protocol === "https:") {
  try {
    (function pwGuest() {
      const send = (ch, p) => { try { ipcRenderer.sendToHost(ch, p); } catch (e) {} };
      let matches = { state: "off", items: [] };     // answer from the shell: off (no vault) | locked | ready
      let lastReport = "", lastSubmit = { sig: "", t: 0 }, scanTimer = 0;
      let host = null, shadow = null, anchor = null, kind = "";

      const visible = (el) => {
        try {
          if (!el || !el.isConnected) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return false;
          const cs = getComputedStyle(el);
          return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
        } catch (e) { return false; }
      };
      const pwFields = () => Array.prototype.filter.call(document.querySelectorAll("input[type=password]"), (i) => !i.disabled && !i.readOnly && visible(i));
      const textLike = (i) => { const t = (i.getAttribute("type") || "text").toLowerCase(); return t === "text" || t === "email" || t === "tel" || t === "url"; };
      const isNewPw = (pw) => {
        if (/new-password/.test(pw.getAttribute("autocomplete") || "")) return true;
        const scope = pw.form || document;
        return Array.prototype.filter.call(scope.querySelectorAll("input[type=password]"), visible).length >= 2;
      };
      const precedes = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);   // a comes before b
      function usernameField(pw) {
        const scope = pw.form || document;
        const inputs = Array.prototype.filter.call(scope.querySelectorAll("input"), (i) => textLike(i) && !i.disabled && visible(i) && precedes(i, pw));
        const marked = inputs.filter((i) => /\b(username|email)\b/.test(i.getAttribute("autocomplete") || ""));
        if (marked.length) return marked[marked.length - 1];
        return inputs.length ? inputs[inputs.length - 1] : null;    // the closest field above the password
      }

      // ---- fill ----
      function setValue(el, v) {
        try {
          const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
          d.set.call(el, v);               // the native setter, so frameworks (React, Vue...) notice the change
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e) { try { el.value = v; } catch (x) {} }
      }
      function fillLogin(d) {
        if (!d || typeof d.password !== "string") return;
        const fields = pwFields().filter((f) => !isNewPw(f));
        const pw = (anchor && fields.includes(anchor)) ? anchor : fields[0];
        if (!pw) return;
        const u = usernameField(pw);
        if (u && d.username) setValue(u, String(d.username));
        setValue(pw, d.password);
      }
      function randomPassword() {
        const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"];
        const all = sets.join(""), buf = new Uint32Array(40);
        crypto.getRandomValues(buf);
        const out = sets.map((s, i) => s[buf[i] % s.length]);
        for (let i = out.length; i < 20; i++) out.push(all[buf[i + 4] % all.length]);
        for (let i = out.length - 1; i > 0; i--) { const j = buf[i + 20] % (i + 1); const t = out[i]; out[i] = out[j]; out[j] = t; }
        return out.join("");
      }
      function fillNew(pwEl) {
        const scope = pwEl.form || document, p = randomPassword();
        const all = Array.prototype.filter.call(scope.querySelectorAll("input[type=password]"), (i) => !i.disabled && !i.readOnly && visible(i));
        all.forEach((f) => { setValue(f, p); try { f.type = "text"; setTimeout(() => { try { f.type = "password"; } catch (e) {} }, 3000); } catch (e) {} });   // shown for 3 seconds so it can be read
      }

      // ---- what is on the page ----
      function scan() {
        scanTimer = 0;
        const f = pwFields();
        const rep = JSON.stringify({ login: f.some((x) => !isNewPw(x)), signup: f.some(isNewPw) });
        if (rep !== lastReport) { lastReport = rep; send("pw-forms", JSON.parse(rep)); if (f.length) send("pw-query", {}); }
        if (anchor && !anchor.isConnected) hidePopup();
      }
      const scheduleScan = () => { if (!scanTimer) scanTimer = setTimeout(scan, 350); };

      // ---- the small menu under a field ----
      function hidePopup() { if (host) { host.style.display = "none"; } anchor = null; }
      function ensureHost() {
        if (host && host.isConnected) return;
        host = document.createElement("div");
        host.style.cssText = "all:initial;position:fixed;z-index:2147483647;display:none;";
        shadow = host.attachShadow({ mode: "closed" });
        (document.documentElement || document.body).appendChild(host);
      }
      function row(label, sub, onClick, extra) {
        const b = document.createElement("div");
        b.className = "r" + (extra ? " " + extra : "");
        const t = document.createElement("span"); t.className = "t"; t.textContent = label; b.appendChild(t);
        if (sub) { const s = document.createElement("span"); s.className = "s"; s.textContent = sub; b.appendChild(s); }
        b.addEventListener("mousedown", (e) => e.preventDefault());      // keep the focus in the page's field
        b.addEventListener("click", (e) => { if (e.isTrusted) onClick(); });   // only a real click, never a script's fake one
        return b;
      }
      function showPopup(el, k) {
        ensureHost();
        const rows = [];
        if (k === "login") {
          if (matches.state === "locked") rows.push(row("Unlock IcyWhite passwords", "", () => { send("pw-open-ui", { mode: "unlock" }); hidePopup(); }, "lock"));
          else if (matches.state === "ready") {
            matches.items.slice(0, 8).forEach((it) => rows.push(row(it.username || "(no user name)", "Fill with IcyWhite", () => { const a = anchor; send("pw-fill", { id: it.id }); anchor = a; hidePopup(); })));
          }
          if (!rows.length) { hidePopup(); return; }
          if (matches.state === "ready") rows.push(row("Manage passwords…", "", () => { send("pw-open-ui", {}); hidePopup(); }, "foot"));
        } else {
          rows.push(row("Suggest a strong password", "IcyWhite", () => { fillNew(el); hidePopup(); }));
        }
        shadow.textContent = "";
        const st = document.createElement("style");
        st.textContent = ".w{font:13px/1.3 system-ui,'Segoe UI',sans-serif;background:#fff;color:#14202e;border:1px solid #b9c4d3;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:4px;min-width:220px;max-width:340px}" +
          ".r{display:flex;flex-direction:column;gap:1px;padding:7px 10px;border-radius:6px;cursor:pointer}.r:hover{background:#e3edf9}" +
          ".t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.s{font-size:11px;color:#5a6a7e}.foot .t{font-weight:400;color:#2b7fd6}.lock .t{font-weight:600}" +
          "@media (prefers-color-scheme:dark){.w{background:#1a2230;color:#eef3fa;border-color:#334156}.r:hover{background:#26344a}.s{color:#9aa8bb}.foot .t{color:#78b8ff}}";
        const w = document.createElement("div"); w.className = "w"; rows.forEach((r) => w.appendChild(r));
        shadow.appendChild(st); shadow.appendChild(w);
        anchor = el; kind = k;
        place();
        host.style.display = "block";
      }
      function place() {
        if (!anchor || !host) return;
        const r = anchor.getBoundingClientRect();
        host.style.left = Math.max(4, Math.min(r.left, innerWidth - 240)) + "px";
        host.style.top = Math.min(r.bottom + 2, Math.max(0, innerHeight - 60)) + "px";
        host.style.minWidth = Math.min(Math.max(r.width, 220), 340) + "px";
      }
      function onFocus(e) {
        try {
          const el = e.target;
          if (!el || el.tagName !== "INPUT") return;
          const fields = pwFields();
          if (el.type === "password" && fields.includes(el)) { showPopup(el, isNewPw(el) ? "new" : "login"); return; }
          const pw = fields.find((f) => !isNewPw(f) && usernameField(f) === el);
          if (pw) showPopup(el, "login");
        } catch (err) {}
      }

      // ---- remember what was submitted (the shell decides whether to offer saving it) ----
      function snapshot(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const f = Array.prototype.filter.call(scope.querySelectorAll("input[type=password]"), (i) => i.value);
        if (!f.length) return null;
        let pw = f.find((x) => /new-password/.test(x.getAttribute("autocomplete") || ""));
        if (!pw) pw = f.length === 3 ? f[1] : (f.length === 2 && f[0].value !== f[1].value ? f[1] : f[0]);
        const u = usernameField(pw);
        return { username: u ? String(u.value || "").slice(0, 500) : "", password: String(pw.value).slice(0, 2000) };
      }
      function submitted(root) {
        try {
          const s = snapshot(root); if (!s) return;
          const sig = s.username + "\u0000" + s.password, t = Date.now();
          if (sig === lastSubmit.sig && t - lastSubmit.t < 1500) return;
          lastSubmit = { sig, t };
          send("pw-submit", s);
        } catch (e) {}
      }

      ipcRenderer.on("pw-matches", (_e, m) => {
        if (m && typeof m === "object") matches = { state: String(m.state || "off"), items: Array.isArray(m.items) ? m.items.slice(0, 20).map((x) => ({ id: String(x.id), username: String(x.username || "") })) : [] };
        if (anchor && kind === "login") showPopup(anchor, "login");
      });
      ipcRenderer.on("pw-fill-data", (_e, d) => { try { fillLogin(d); } catch (e) {} });
      ipcRenderer.on("pw-requery", () => { lastReport = ""; scan(); });

      function init() {
        scan();
        new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden"] });
        document.addEventListener("focusin", onFocus, true);
        document.addEventListener("mousedown", (e) => { try { if (host && e.target !== host && !(anchor && e.target === anchor)) hidePopup(); } catch (x) {} }, true);
        document.addEventListener("keydown", (e) => {
          if (!e.isTrusted) return;
          if (e.key === "Escape") hidePopup();
          else if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") submitted(e.target.form || document);
        }, true);
        document.addEventListener("submit", (e) => { if (e.isTrusted) submitted(e.target); }, true);
        document.addEventListener("click", (e) => {
          if (!e.isTrusted || !e.target || !e.target.closest) return;
          const b = e.target.closest("button,input[type=submit],input[type=button],[role=button]");
          if (b) submitted(b.form || b.closest("form") || document);
        }, true);
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
    })();
  } catch (e) {}
}
