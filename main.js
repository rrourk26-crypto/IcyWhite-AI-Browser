const { app, BrowserWindow, ipcMain, session, desktopCapturer, Menu, clipboard, shell, dialog, screen, nativeTheme, webContents, safeStorage, Notification } = require("electron");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const { spawn, execFile } = require("child_process");
const { fileURLToPath } = require("url");
const winLauncher = require("./windows-launcher.js");
const { createLlamaManager } = require("./llama-manager.js");
const { createMultiLlama } = require("./llama-multi.js");
const { createWebResearch } = require("./web-research.js");
const { createHfManager } = require("./hf-manager.js");
const { createMcpManager } = require("./mcp-manager.js");
const { createPasswordManager } = require("./password-manager.js");

// Keep your chats, settings and logins after the rename: Electron stores them in a folder named after the app, so if the
// folder used by the old "Oasis Browser" build exists, keep using it (a new install simply gets a fresh IcyWhite folder).
try {
  const legacyNames = app.isPackaged ? ["Oasis Browser", "oasis-browser"] : ["oasis-browser", "Oasis Browser"];
  const legacy = legacyNames.map((n) => path.join(app.getPath("appData"), n)).find((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
  if (legacy) app.setPath("userData", legacy);
} catch (e) {}

// ---- Shared preferences (theme, AI server address). The shell and the Home page keep separate browser storage, so the
// main process holds these few values and tells every window when one changes.
const PREF_KEYS = { theme: (v) => ["light", "dark", "system"].includes(v), lm_url: (v) => typeof v === "string" && v.length < 300, colors: (v) => typeof v === "string" && v.length < 2000 };
let prefs = {}, prefsFile = "";
function loadPrefs() { try { prefsFile = path.join(app.getPath("userData"), "icywhite-prefs.json"); prefs = JSON.parse(fs.readFileSync(prefsFile, "utf8")) || {}; } catch (e) { prefs = {}; } }
function savePrefs() { try { fs.mkdirSync(path.dirname(prefsFile), { recursive: true }); fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2)); } catch (e) {} }
function darkNow() { return prefs.theme === "dark" || (prefs.theme === "system" && nativeTheme.shouldUseDarkColors); }
function winBg(isPrivate) { return darkNow() ? (isPrivate ? "#120a1c" : "#090c12") : (isPrivate ? "#efe9f7" : "#f5f9fd"); }
function applyThemePref() {
  try { nativeTheme.themeSource = prefs.theme === "dark" ? "dark" : prefs.theme === "system" ? "system" : "light"; } catch (e) {}
  for (const w of BrowserWindow.getAllWindows()) { try { w.setBackgroundColor(winBg(false)); } catch (e) {} }
}

// ---- Debug log: notes and errors from every window, shown in a small pop-up (Favorites > Debug Log, or Settings).
// Only this app's own pages are logged; websites you browse are never recorded.
const DEBUG_MAX = 3000;
const debugLines = [];
let debugWin = null;
const pad2 = (n) => String(n).padStart(2, "0");
function debugFormat(l) { const d = new Date(l.t); return "[" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + "] " + l.level.toUpperCase().padEnd(5) + " " + l.source + ": " + l.msg; }
function dlog(level, source, msg, multi) {
  level = level === "error" || level === "warn" ? level : "info";
  // multi = keep the line breaks (used for request bodies and server answers, which read better as a block)
  const text = String(msg == null ? "" : msg);
  const l = { t: Date.now(), level, source: String(source || "app").slice(0, 40), msg: multi ? text.replace(/\r/g, "").slice(0, 8000) : text.replace(/\s+/g, " ").slice(0, 1200) };
  debugLines.push(l);
  if (debugLines.length > DEBUG_MAX) debugLines.splice(0, debugLines.length - DEBUG_MAX);
  try { if (debugWin && !debugWin.isDestroyed()) debugWin.webContents.send("debug-log-line", { level, text: debugFormat(l) }); } catch (e) {}
}
function debugText() {
  return ["IcyWhite debug log", "App " + app.getVersion() + " · Electron " + process.versions.electron + " · " + process.platform + " " + process.arch, "Copied " + new Date().toLocaleString(), ""]
    .concat(debugLines.map(debugFormat)).join("\n");
}
function openDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) { if (debugWin.isMinimized()) debugWin.restore(); debugWin.show(); debugWin.focus(); return; }
  debugWin = new BrowserWindow({
    width: 780, height: 520, minWidth: 420, minHeight: 280, autoHideMenuBar: true, alwaysOnTop: true,
    backgroundColor: winBg(false), title: "IcyWhite - Debug log",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  debugWin.setMenu(null);
  debugWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  debugWin.on("closed", () => { debugWin = null; });
  debugWin.loadFile(path.join(__dirname, "debuglog.html"));
}
app.on("web-contents-created", (_e, wc) => {
  try {
    wc.on("console-message", (a, b, c, d, e2) => {
      let level, message, source;
      if (a && typeof a === "object" && typeof a.message === "string") { level = a.level; message = a.message; source = a.sourceId; }
      else { level = b; message = c; source = e2; }
      const lv = typeof level === "number" ? ["info", "info", "warn", "error"][level] : (level === "error" ? "error" : level === "warning" ? "warn" : "info");
      if (lv === "info" || /Electron Security Warning/i.test(String(message))) return;
      const url = String(wc.getURL() || "");
      if (!url.startsWith("file:") || wc === (debugWin && !debugWin.isDestroyed() ? debugWin.webContents : null)) return;
      const src = String(source || url).split(/[?#]/)[0].split("/").slice(-2).join("/") || "page";
      dlog(lv, src, message);
    });
    wc.on("did-fail-load", (_ev, code, desc, url) => {
      if (code === -3 || !String(url || "").startsWith("file:")) return;
      dlog("error", "load", "Could not open " + decodeURIComponent(String(url).split(/[?#]/)[0].split("/").slice(-3).join("/")) + " (" + desc + ")");
    });
    wc.on("render-process-gone", (_ev, d) => dlog("error", "app", "A page crashed (" + (d && d.reason) + ")"));
  } catch (e) {}
});
process.on("unhandledRejection", (r) => { dlog("error", "main", "Unhandled rejection: " + ((r && r.message) || r)); });

// ---- Local models: llama.cpp's llama-server, started/stopped from Settings (see llama-manager.js) ----
let llama = null;   // created once the app is ready (needs app.getPath)
let web = null;   // web search + page reading for the chat (web-research.js)
let llamaMulti = null;   // extra models running at the same time (llama-multi.js)
let hf = null;      // Hugging Face model hub (search + downloads), created with it
let mcp = null;     // MCP client: tool servers the AI can use (mcp-manager.js)

// Electron ships with NO default right-click menu at all (in the main window
// chrome or inside <webview> guest pages), so we build a normal one by hand.
// pageContext=true means "contents" is an actual page (a webview guest, or
// the shell itself navigating) so page-level items (back/forward/reload,
// open link/image in a new tab) make sense; pageContext=false is used for
// the app's own chrome (address bar, AI panel, tab strip) where only text
// editing items make sense — the tab strip's own right-click menu is built
// entirely in the renderer (browser.html) instead.
function showContextMenu(ownerWin, contents, params, pageContext) {
  const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length);
  const isLink = Boolean(params.linkURL);
  const isImage = params.mediaType === "image";
  const flags = params.editFlags || {};
  const template = [];

  if (params.isEditable && params.misspelledWord) {
    const sugg = (params.dictionarySuggestions || []).slice(0, 6);
    sugg.forEach((w) => template.push({ label: w, click: () => { try { contents.replaceMisspelling(w); } catch (e) {} } }));
    if (!sugg.length) template.push({ label: "No spelling suggestions", enabled: false });
    template.push(
      { label: "Add \"" + params.misspelledWord + "\" to dictionary", click: () => { try { contents.session.addWordToSpellCheckerDictionary(params.misspelledWord); } catch (e) {} } },
      { type: "separator" }
    );
  }
  if (params.isEditable) {
    template.push(
      { label: "Undo", role: "undo", enabled: !!flags.canUndo },
      { label: "Redo", role: "redo", enabled: !!flags.canRedo },
      { type: "separator" },
      { label: "Cut", role: "cut", enabled: !!flags.canCut },
      { label: "Copy", role: "copy", enabled: !!flags.canCopy },
      { label: "Paste", role: "paste", enabled: !!flags.canPaste },
      { label: "Select All", role: "selectAll", enabled: !!flags.canSelectAll }
    );
  } else if (hasSelection) {
    template.push(
      { label: "Copy", click: () => clipboard.writeText(params.selectionText) },
      { label: "Select All", click: () => contents.selectAll() }
    );
  }

  if (pageContext && isLink) {
    if (template.length) template.push({ type: "separator" });
    template.push(
      { label: "Open Link in New Tab", click: () => ownerWin && !ownerWin.isDestroyed() && ownerWin.webContents.send("oasis-open-in-tab", params.linkURL) },
      { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) }
    );
  }

  if (pageContext && isImage) {
    if (template.length) template.push({ type: "separator" });
    template.push(
      { label: "Open Image in New Tab", click: () => ownerWin && !ownerWin.isDestroyed() && ownerWin.webContents.send("oasis-open-in-tab", params.srcURL) },
      { label: "Copy Image", click: () => { try { contents.copyImageAt(params.x, params.y); } catch (e) {} } },
      { label: "Copy Image Address", click: () => clipboard.writeText(params.srcURL) },
      { label: "Save Image As…", click: () => { try { contents.downloadURL(params.srcURL); } catch (e) {} } }
    );
  }

  if (pageContext && !template.length) {
    template.push(
      { label: "Back", click: () => ownerWin && !ownerWin.isDestroyed() && ownerWin.webContents.send("oasis-context-nav", "back") },
      { label: "Forward", click: () => ownerWin && !ownerWin.isDestroyed() && ownerWin.webContents.send("oasis-context-nav", "forward") },
      { label: "Reload", click: () => ownerWin && !ownerWin.isDestroyed() && ownerWin.webContents.send("oasis-context-nav", "reload") },
      { type: "separator" },
      { label: "Copy Page URL", click: () => clipboard.writeText(contents.getURL ? contents.getURL() : "") }
    );
  }

  if (!template.length) return;

  template.push({ type: "separator" }, { label: "Inspect", click: () => { try { contents.inspectElement(params.x, params.y); } catch (e) {} } });

  Menu.buildFromTemplate(template).popup({ window: ownerWin || undefined });
}

// Every session partition we hand out (the shared persistent one, plus one
// fresh in-memory partition per InPrivate window) gets its own download
// listener so the Downloads panel in whichever window owns that partition
// hears about it.
const trackedPartitions = new Set();
function wireDownloadsForPartition(partitionName, ownerWin) {
  if (trackedPartitions.has(partitionName)) return;
  trackedPartitions.add(partitionName);
  const ses = session.fromPartition(partitionName);
  ses.on("will-download", (_event, item) => {
    const id = crypto.randomUUID();
    const send = (payload) => {
      if (ownerWin && !ownerWin.isDestroyed()) ownerWin.webContents.send("oasis-download-update", { id, ...payload });
    };
    try { item.setSaveDialogOptions({ defaultPath: item.getFilename() }); } catch (e) {}
    send({ filename: item.getFilename(), url: item.getURL(), state: "progressing", receivedBytes: 0, totalBytes: item.getTotalBytes() });
    item.on("updated", (_e, state) => {
      send({ filename: item.getFilename(), url: item.getURL(), state, receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() });
    });
    item.once("done", (_e, state) => {
      send({ filename: item.getFilename(), url: item.getURL(), state, path: item.getSavePath(), receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() });
    });
  });
}

// ---- Pop-out windows: a tab dragged off the tab strip becomes its own window ----
// Same session partition as the browser, so chats, settings and logins carry over.
function allowedPopupUrl(url) {
  if (/^https?:\/\//i.test(url)) return true;
  try {
    if (!/^file:/i.test(url)) return false;
    const u = new URL(url); u.search = ""; u.hash = "";
    const p = path.resolve(fileURLToPath(u));
    return p.toLowerCase().startsWith(path.resolve(__dirname).toLowerCase() + path.sep);
  } catch (e) { return false; }
}
function allowedPartition(p) { return p === "persist:oasis" || /^oasis-private-[0-9a-f]+$/.test(p); }
function openPopupWindow(url, partition, pos) {
  if (!allowedPopupUrl(url) || !allowedPartition(partition)) return null;
  const opts = {
    width: 1100, height: 760, minWidth: 420, minHeight: 320, autoHideMenuBar: true,
    backgroundColor: winBg(false), title: (pos && pos.title) || "IcyWhite",
    webPreferences: { partition, preload: path.join(__dirname, "project-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  };
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    try {
      const d = screen.getDisplayNearestPoint({ x: Math.round(pos.x), y: Math.round(pos.y) }).workArea;
      opts.x = Math.max(d.x, Math.min(Math.round(pos.x) - 120, d.x + d.width - 300));
      opts.y = Math.max(d.y, Math.min(Math.round(pos.y) - 20, d.y + d.height - 200));
    } catch (e) {}
  }
  const win = new BrowserWindow(opts);
  win.__oasisPopupPartition = partition;
  win.setMenu(null);
  win.webContents.setWindowOpenHandler((d) => { openPopupWindow(d.url, partition, null); return { action: "deny" }; });
  win.webContents.on("context-menu", (_e, params) => showContextMenu(win, win.webContents, params, false));
  win.loadURL(url);
  return win;
}
function setupSpellcheck(partition) {
  try {
    const ses = session.fromPartition(partition);
    ses.setSpellCheckerEnabled(true);
    const avail = ses.availableSpellCheckerLanguages || [];
    const loc = app.getLocale();
    const pick = avail.includes(loc) ? loc : (avail.includes("en-US") ? "en-US" : null);
    if (pick) ses.setSpellCheckerLanguages([pick]);
  } catch (e) {}
}

// ---- Screen sharing. Electron has no built-in "choose a screen" dialog, so without this handler every
// getDisplayMedia() call (the screen button, or a website asking to share) fails with "Not supported".
// The person always picks what to share in our own small dialog; nothing is ever captured silently.
let capturePickerOpen = null;
// "Follow my tab": while a tab is being shared, the browser shell asks (share-follow-set) for the next share request from that
// chat page to be answered with the tab I just switched to, with no dialog. Valid for a few seconds, for that one page only.
let followNext = null;
// A page that is not changing sends the capture no picture at all, so a just-shared tab can stay blank. Ask it to repaint a few times.
function nudgeRepaint(wc) {
  [150, 500, 1200, 2500].forEach((ms) => setTimeout(() => { try { if (wc && !wc.isDestroyed()) wc.invalidate(); } catch (e) {} }, ms));
}
const shareTargets = new Map();   // chat page webContents id -> the tab it is looking at
function notifyShare(request, payload) {
  try {
    const req = webContents.fromFrame(request.frame); if (!req || req.isDestroyed()) return;
    if (payload.kind === "tab" && payload.target) shareTargets.set(req.id, payload.target); else shareTargets.delete(req.id);
    req.send("oasis-share-info", payload);
    const host = req.hostWebContents;
    if (host && !host.isDestroyed()) host.send("oasis-share-started", Object.assign({ requester: req.id }, payload));
  } catch (e) {}
}
// Builds the list the person chooses from: the tabs open in IcyWhite (shared live, even when other windows cover them),
// every screen, and every window Windows will hand over (other browsers, YouTube windows, games, apps...).
// If the full desktop list is slow or fails, it falls back to just the screens so the person is never left with nothing.
async function listCaptureSources(ses, request) {
  const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  const get = (types) => desktopCapturer.getSources({ types, thumbnailSize: { width: 400, height: 250 }, fetchWindowIcons: false });
  const jpg = (img) => (img && !img.isEmpty() ? "data:image/jpeg;base64," + img.resize({ width: 400 }).toJPEG(70).toString("base64") : "");
  const [desk, tabs] = await Promise.all([
    (async () => { let l = await within(get(["screen", "window"]), 10000); if (!l || !l.length) l = await within(get(["screen"]), 5000); return l || []; })(),
    (async () => {
      const mine = webContents.getAllWebContents().filter((w) => {
        try { return !w.isDestroyed() && w.getType() === "webview" && w.session === ses && !(request && request.frame && w.mainFrame && w.mainFrame.frameTreeNodeId === request.frame.frameTreeNodeId); } catch (e) { return false; }
      });
      return Promise.all(mine.map(async (w) => {
        const img = await within(w.capturePage(), 1500);
        let name = ""; try { name = w.getTitle() || w.getURL(); } catch (e) {}
        return { id: "tab:" + w.id, name: name || "(tab)", kind: "tab", thumb: jpg(img), wc: w };
      }));
    })()
  ]);
  const screens = desk.filter((x) => x && x.id).map((x) => ({ id: x.id, name: x.name, kind: /^screen:/.test(x.id) ? "screen" : "window", thumb: jpg(x.thumbnail), raw: x }));
  return tabs.filter((t) => t.wc && !t.wc.isDestroyed()).concat(screens);
}
const countKinds = (list) => list.filter((x) => x.kind === "tab").length + " tabs, " + list.filter((x) => x.kind === "screen").length + " screens, " + list.filter((x) => x.kind === "window").length + " windows";
function pickCaptureSource(parent, firstSources, refetch) {
  return new Promise((resolve) => {
    // Already choosing? Bring that dialog forward instead of stacking a second one.
    if (capturePickerOpen && !capturePickerOpen.isDestroyed()) { try { capturePickerOpen.focus(); } catch (e) {} return resolve(null); }
    let sources = firstSources;
    const dlg = new BrowserWindow({
      width: 780, height: 580, minWidth: 520, minHeight: 380, parent: parent || undefined, modal: Boolean(parent),
      autoHideMenuBar: true, backgroundColor: "#0b101c", title: "Share your screen", minimizable: false, maximizable: false,
      webPreferences: { preload: path.join(__dirname, "picker-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    dlg.setMenu(null);
    capturePickerOpen = dlg;
    let settled = false;
    const finish = (value) => {
      if (settled) return; settled = true;
      if (capturePickerOpen === dlg) capturePickerOpen = null;
      ipcMain.removeListener("picker-choose", onChoose); ipcMain.removeListener("picker-cancel", onCancel); ipcMain.removeListener("picker-refresh", onRefresh);
      try { if (!dlg.isDestroyed()) dlg.destroy(); } catch (e) {}
      resolve(value);
    };
    const mine = (e) => !dlg.isDestroyed() && e.sender === dlg.webContents;
    const sendList = () => {
      if (dlg.isDestroyed()) return;
      dlg.webContents.send("picker-sources", sources.map((s) => ({ id: s.id, name: s.name, screen: s.kind === "screen", tab: s.kind === "tab", thumb: s.thumb })));
    };
    const onChoose = (e, id) => { if (mine(e)) finish(sources.find((s) => s.id === id) || null); };
    const onCancel = (e) => { if (mine(e)) finish(null); };
    const onRefresh = async (e) => {
      if (!mine(e)) return;
      const fresh = await refetch();
      if (settled || dlg.isDestroyed()) return;
      sources = fresh; dlog("info", "screen-share", "Source list refreshed: " + countKinds(fresh) + "."); sendList();
    };
    ipcMain.on("picker-choose", onChoose); ipcMain.on("picker-cancel", onCancel); ipcMain.on("picker-refresh", onRefresh);
    dlg.on("closed", () => finish(null));
    dlg.webContents.on("did-finish-load", sendList);
    dlg.loadFile(path.join(__dirname, "picker.html")).catch(() => finish(null));
  });
}
function setupDisplayCapture(partition) {
  try {
    const ses = session.fromPartition(partition);
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const f = followNext; followNext = null;
        if (f && Date.now() < f.until) {
          let req = null; try { req = webContents.fromFrame(request.frame); } catch (e) {}
          const wc = webContents.fromId(f.target);
          if (req && req.id === f.requester && wc && !wc.isDestroyed() && wc.mainFrame) {
            dlog("info", "screen-share", "Following you to tab: " + (wc.getTitle() || wc.getURL()));
            notifyShare(request, { kind: "tab", target: wc.id });
            callback({ video: wc.mainFrame }); nudgeRepaint(wc); return;
          }
        }
        const sources = await listCaptureSources(ses, request);
        dlog("info", "screen-share", "Share requested; found " + countKinds(sources) + ".");
        if (!sources.length) dlog("warn", "screen-share", "No tabs, screens or windows were found (on a Mac, allow Screen Recording for this app).");
        let parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
        if (parent && parent.__isCapturePicker) parent = null;
        const choice = await pickCaptureSource(parent, sources, () => listCaptureSources(ses, request));
        if (!choice) { dlog("info", "screen-share", "Share cancelled."); return callback({}); }   // the page sees a normal "cancelled" error
        if (choice.kind === "tab") {
          // A tab is shared as its own live picture (the page itself), so it keeps working while other windows are on top.
          if (!choice.wc || choice.wc.isDestroyed() || !choice.wc.mainFrame) { dlog("warn", "screen-share", "That tab was closed before sharing started."); return callback({}); }
          dlog("info", "screen-share", "Sharing tab: " + choice.name);
          notifyShare(request, { kind: "tab", target: choice.wc.id });
          callback({ video: choice.wc.mainFrame }); nudgeRepaint(choice.wc); return;
        }
        dlog("info", "screen-share", "Sharing " + choice.kind + ": " + (choice.name || choice.id));
        notifyShare(request, { kind: choice.kind });
        callback({ video: choice.raw });
      } catch (e) { dlog("error", "screen-share", "Share failed: " + ((e && e.message) || e)); try { callback({}); } catch (x) {} }
    });
  } catch (e) {}
}

// The pages are file:// pages, so the browser applies CORS to calls to the local llama-server. Make sure its answers
// (and the preflight) are allowed -- only for our own server's port, never for other sites.
const corsPartitions = new Set();
function allowLocalLlama(partition) {
  if (corsPartitions.has(partition)) return;
  corsPartitions.add(partition);
  try {
    session.fromPartition(partition).webRequest.onHeadersReceived({ urls: ["http://127.0.0.1/*"] }, (details, callback) => {
      try {
        const ports = [llama && llama.getStatus().port].concat(llamaMulti ? llamaMulti.list().ports : []).filter(Boolean).map(String);
        if (!ports.length || !ports.includes(new URL(details.url).port)) return callback({});
        const headers = {};
        for (const k of Object.keys(details.responseHeaders || {})) if (!/^access-control-/i.test(k)) headers[k] = details.responseHeaders[k];
        headers["Access-Control-Allow-Origin"] = ["*"];
        headers["Access-Control-Allow-Headers"] = ["*"];
        headers["Access-Control-Allow-Methods"] = ["GET, POST, OPTIONS"];
        callback({ responseHeaders: headers });
      } catch (e) { callback({}); }
    });
  } catch (e) {}
}

function createWindow(opts = {}) {
  const isPrivate = Boolean(opts.isPrivate);
  const partition = isPrivate ? "oasis-private-" + crypto.randomBytes(4).toString("hex") : "persist:oasis";

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: winBg(isPrivate),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  wireDownloadsForPartition(partition, win);
  setupSpellcheck(partition);
  setupDisplayCapture(partition);
  allowLocalLlama(partition);

  win.loadFile(path.join(__dirname, "browser.html"), { query: { partition, private: isPrivate ? "1" : "0" } });

  win.webContents.on("context-menu", (_event, params) => showContextMenu(win, win.webContents, params, false));

  // Electron no longer supports the <webview> "new-window" DOM event, so any
  // link/window.open inside a webview (YouTube, search results, etc.) falls
  // back to Electron's own default: a brand new OS-level window. Intercept it
  // at the webContents level for every webview that attaches to this window,
  // deny the popup, and tell the renderer to open it as a tab instead.
  win.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.preload = path.join(__dirname, "project-preload.js");
    webPreferences.spellcheck = true;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });
  win.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler((details) => {
      if (win && !win.isDestroyed()) win.webContents.send("oasis-open-in-tab", details.url);
      return { action: "deny" };
    });

    // Right-click menu (Copy/Paste, Copy Link, Save Image, Back/Forward…)
    // for the actual page content loaded inside every tab.
    contents.on("context-menu", (_e, params) => showContextMenu(win, contents, params, true));
  });

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  loadPrefs(); applyThemePref();
  dlog("info", "app", "IcyWhite started (" + app.getVersion() + ")");
  llama = createLlamaManager({
    // Everything llama-server prints (model loading, "prompt processing progress", tokens per second...) goes to the Debug log too.
    onLog: (line) => {
      if (/request: GET \/health\b/.test(line)) return;   // the app's own start-up check, not interesting
      const lv = /\b(error|failed|fatal|abort)\b/i.test(line) ? "error" : /\bwarn(ing)?\b|^W\s/i.test(line) ? "warn" : "info";
      dlog(lv, "llama-server", line);
    },
    userDataDir: app.getPath("userData"),
    logDir: path.join(app.getPath("userData"), "logs"),                          // llama-server.log (rotated) survives a restart
    appDir: app.isPackaged ? null : __dirname,                                   // dev: llama-server.exe sits next to main.js (or in ./llama)
    resourcesDir: app.isPackaged ? process.resourcesPath : null,                 // installed: <install>/resources/llama
    exeDir: app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : null   // beside the .exe: ./llama and ./models
  });
  // Extra models at the same time: each one is its own llama-server on its own port, using the same settings as the main one.
  llamaMulti = createMultiLlama({
    primary: llama,
    userDataDir: app.getPath("userData"),
    logDir: path.join(app.getPath("userData"), "logs"),
    makeManager: (cfgName) => createLlamaManager({
      cfgName, logDir: path.join(app.getPath("userData"), "logs"), logName: cfgName.replace(/\.json$/, ".log"),
      onLog: (line) => { if (/request: GET \/health\b/.test(line)) return; dlog(/\b(error|failed|fatal|abort)\b/i.test(line) ? "error" : "info", "llama-server+", line); },
      userDataDir: app.getPath("userData"),
      appDir: app.isPackaged ? null : __dirname,
      resourcesDir: app.isPackaged ? process.resourcesPath : null,
      exeDir: app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : null,
      hardwareFn: async () => (await llama.listRuntimes()).hardware
    })
  });
  // Web browsing for the chat: its own in-memory network session, so no cookies or sign-ins are ever sent or kept.
  const webSession = session.fromPartition("icywhite-web-research");
  web = createWebResearch({ fetchFn: (url, init) => webSession.fetch(url, init) });
  // Hugging Face hub: search, model pages and the download manager (hf-manager.js). Uses its own in-memory network session so a
  // proxy set in Hub settings applies only to the hub, and 20 GB downloads are never cached by Chromium.
  const hfSession = session.fromPartition("icywhite-hf");
  hf = createHfManager({
    userDataDir: app.getPath("userData"),
    modelsDir: () => llama.modelsDir(),
    fetchFn: (url, init) => hfSession.fetch(url, init),
    applyProxy: (p) => { try { hfSession.setProxy(p ? { proxyRules: p } : { mode: "system" }); } catch (e) {} },
    safeStorage,
    hardwareFn: async () => (await llama.listRuntimes()).hardware,
    notify: (n) => { try { if (Notification.isSupported()) new Notification({ title: n.title, body: n.body }).show(); } catch (e) {} },
    userAgent: "IcyWhite/" + app.getVersion(),
    platform: process.platform
  });
  mcp = createMcpManager({ userDataDir: app.getPath("userData"), version: app.getVersion(), onLog: (name, line) => dlog("info", "mcp:" + name, line) });
  allowLocalLlama("persist:oasis");

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["media", "geolocation", "notifications", "fullscreen", "clipboard-read", "clipboard-sanitized-write"];
    callback(allowed.includes(permission));
  });

  ipcMain.handle("share-follow-set", (e, req) => {   // only the browser shell (browser.html) has this in its preload
    if (!req || !Number.isInteger(req.requester) || !Number.isInteger(req.target)) return false;
    followNext = { requester: req.requester, target: req.target, until: Date.now() + 8000 };
    return true;
  });

  // A still picture of the tab a chat page is sharing, for when the live capture has sent nothing yet (the page isn't changing).
  ipcMain.handle("share-snapshot", async (e) => {
    try {
      if (!e.sender.getURL().startsWith("file:")) return null;
      const id = shareTargets.get(e.sender.id), wc = id && webContents.fromId(id);
      if (!wc || wc.isDestroyed()) return null;
      const img = await Promise.race([wc.capturePage(), new Promise((r) => setTimeout(() => r(null), 2500))]);
      if (!img || img.isEmpty()) return null;
      const s = img.getSize(), small = s.width > 1280 ? img.resize({ width: 1280 }) : img;
      return "data:image/jpeg;base64," + small.toJPEG(72).toString("base64");
    } catch (err) { return null; }
  });

  // The AI clicking links in the tab the person is sharing. Only the Home page can ask, and only while a TAB is being shared
  // (shareTargets is filled by the share picker). It only ever clicks real links (<a href> / role="link").
  const tabLinkScript = require("./tab-click.js");
  function sharedTabFor(e) {
    if (!e.sender.getURL().startsWith("file:")) return null;
    const id = shareTargets.get(e.sender.id), wc = id && webContents.fromId(id);
    return wc && !wc.isDestroyed() ? wc : null;
  }
  ipcMain.handle("share-links", async (e) => {
    try {
      const wc = sharedTabFor(e); if (!wc) return null;
      const links = await Promise.race([wc.executeJavaScript("(" + tabLinkScript.toString() + ")(\"list\", \"\")", true), new Promise((r) => setTimeout(() => r(null), 2500))]);
      let url = "", title = ""; try { url = wc.getURL(); title = wc.getTitle(); } catch (err) {}
      return { url, title, links: Array.isArray(links) ? links : [] };
    } catch (err) { return null; }
  });
  ipcMain.handle("share-click", async (e, query) => {
    try {
      const wc = sharedTabFor(e);
      if (!wc) return { ok: false, error: "no tab is being shared" };
      const res = await Promise.race([wc.executeJavaScript("(" + tabLinkScript.toString() + ")(\"click\", " + JSON.stringify(String(query || "").slice(0, 200)) + ", 0)", true), new Promise((r) => setTimeout(() => r({ ok: false, error: "the page did not answer" }), 4000))]);
      return res || { ok: false, error: "no answer from the page" };
    } catch (err) { return { ok: false, error: (err && err.message) || "could not click" }; }
  });

  ipcMain.handle("capture-browser", async (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return null;
    const image = await w.webContents.capturePage();
    return image.toDataURL();
  });

  ipcMain.handle("capture-webview", async (_event, webContentsId) => {
    try {
      const wc = require("electron").webContents.fromId(Number(webContentsId));
      if (!wc) return null;
      const image = await wc.capturePage();
      return image.toDataURL();
    } catch (e) { return null; }
  });

  ipcMain.handle("capture-source", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
    const source = sources.find(s => s.name === "IcyWhite" || s.name === "Oasis AI Workspace") || sources[0];
    return source ? { id: source.id, name: source.name } : null;
  });


  // ---- Password manager (password-manager.js). The encrypted vault lives only in this process. Only the browser shell
  // (browser.html, never a website and never the Home page) may talk to it; the shell relays what a page needs.
  const shellUrl = require("url").pathToFileURL(path.join(__dirname, "browser.html")).href.toLowerCase();
  const isShell = (e) => {
    try {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || e.sender.getType() !== "window") return false;
      return String(e.senderFrame ? e.senderFrame.url : e.sender.getURL()).toLowerCase().split(/[?#]/)[0] === shellUrl;
    } catch (err) { return false; }
  };
  const broadcastPw = (state) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try { if (!w.isDestroyed() && w.webContents.getURL().toLowerCase().split(/[?#]/)[0] === shellUrl) w.webContents.send("pw-state", state); } catch (err) {}
    }
  };
  const pm = createPasswordManager({ userDataDir: app.getPath("userData"), onState: (s) => broadcastPw(Object.assign(s, { settings: pm.getSettings() })) });
  const pwHandle = (name, fn) => ipcMain.handle(name, async (e, ...a) => {
    if (!isShell(e)) return { error: "not allowed" };
    try { return { ok: await fn(e, ...a) }; } catch (err) { return { error: String((err && err.message) || err), code: err && err.code }; }
  });
  let clipTimer = null;
  pwHandle("pw-status", () => pm.status());
  pwHandle("pw-setup", (e, m) => pm.setup(m));
  pwHandle("pw-unlock", (e, m) => pm.unlock(m));
  pwHandle("pw-lock", () => pm.lock());
  pwHandle("pw-change-master", (e, o, n) => pm.changeMaster(o, n));
  pwHandle("pw-list", () => pm.list());
  pwHandle("pw-reveal", (e, id) => pm.reveal(String(id)));
  pwHandle("pw-add", (e, entry) => pm.add(entry));
  pwHandle("pw-update", (e, id, patch) => pm.update(String(id), patch));
  pwHandle("pw-remove", (e, id) => pm.remove(String(id)));
  pwHandle("pw-find", (e, url) => pm.find(String(url)));
  pwHandle("pw-fill-data", (e, id, url) => pm.getForFill(String(id), String(url)));
  pwHandle("pw-check", (e, url, u, p) => pm.check(String(url), String(u), String(p)));
  pwHandle("pw-is-never", (e, url) => pm.isNever(String(url)));
  pwHandle("pw-set-never", (e, url) => pm.setNever(String(url)));
  pwHandle("pw-clear-never", () => pm.clearNever());
  pwHandle("pw-settings", (e, patch) => { const s = patch ? pm.setSettings(patch) : pm.getSettings(); broadcastPw(Object.assign(pm.status(), { settings: s })); return s; });
  pwHandle("pw-generate", (e, o) => pm.generate(o || {}));
  pwHandle("pw-reset", (e, m) => pm.reset(m));
  // Copy a secret, and clear the clipboard again after 30 s if it still holds that same text.
  pwHandle("pw-copy", (e, text) => {
    text = String(text == null ? "" : text); clipboard.writeText(text);
    clearTimeout(clipTimer);
    clipTimer = setTimeout(() => { try { if (clipboard.readText() === text) clipboard.clear(); } catch (err) {} }, 30000);
    if (clipTimer.unref) clipTimer.unref();
    return true;
  });
  pwHandle("pw-import", async (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(w, { title: "Import passwords (CSV)", properties: ["openFile"], filters: [{ name: "CSV", extensions: ["csv"] }, { name: "All files", extensions: ["*"] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 20 * 1024 * 1024) throw new Error("That file is too big to be a password export.");
    return pm.importCsv(fs.readFileSync(r.filePaths[0], "utf8"));
  });
  pwHandle("pw-export", async (e, master) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const csv = await pm.exportCsv(master);
    const r = await dialog.showSaveDialog(w, { title: "Export passwords (plain text CSV!)", defaultPath: path.join(app.getPath("documents"), "icywhite-passwords.csv"), filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, csv, { mode: 0o600 });
    return { path: r.filePath };
  });
  app.on("before-quit", () => { try { pm.lock(); } catch (err) {} });

  ipcMain.handle("toggle-fullscreen", (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return false;
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });

  ipcMain.handle("open-downloads-folder", () => shell.openPath(app.getPath("downloads")));
  ipcMain.handle("open-path", (_event, targetPath) => shell.openPath(targetPath));

  // ---- Project folder access. Everything is confined to the one folder you pick. ----
  let projectRoot = null;
  // Only the app's own local pages (file://) may use the project bridge, never a website.
  const handleProject = (name, fn) => ipcMain.handle(name, (e, ...a) => {
    if (!String(e.sender.getURL()).startsWith("file:")) throw new Error("not allowed");
    return fn(e, ...a);
  });
  const SKIP_DIRS = new Set(["node_modules", ".git", ".oasis-backup", "dist", "build", "out", ".next", "__pycache__", ".venv", "venv", ".idea", ".vscode"]);
  function scanProject(root) {
    const files = [];
    (function walk(dir, depth) {
      if (depth > 12 || files.length >= 20000) return;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (files.length >= 20000) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1); }
        else if (e.isFile()) { let size = 0; try { size = fs.statSync(full).size; } catch (x) {} files.push({ path: path.relative(root, full).split(path.sep).join("/"), size }); }
      }
    })(root, 0);
    return files;
  }
  function inRoot(rel) {
    if (!projectRoot) throw new Error("No project folder is open");
    const abs = path.resolve(projectRoot, String(rel || ""));
    if (abs !== projectRoot && !abs.startsWith(projectRoot + path.sep)) throw new Error("Path is outside the project folder");
    return abs;
  }
  function isProtected(rel) { return /(^|[\\/])(\.git|\.oasis-backup)([\\/]|$)/.test(String(rel)); }
  function backupFile(abs) {   // every overwrite/delete first copies the old file into .oasis-backup/<time>/
    if (!fs.existsSync(abs)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(projectRoot, ".oasis-backup", stamp, path.relative(projectRoot, abs));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  const projectInfo = () => ({ root: projectRoot, name: path.basename(projectRoot), files: scanProject(projectRoot) });
  handleProject("project-pick", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Choose your project folder" });
    if (r.canceled || !r.filePaths[0]) return null;
    projectRoot = path.resolve(r.filePaths[0]);
    return projectInfo();
  });
  handleProject("project-open", (_e, root) => {
    try { if (!root || !fs.statSync(root).isDirectory()) return null; } catch (e) { return null; }
    projectRoot = path.resolve(root);
    return projectInfo();
  });
  handleProject("project-read", (_e, rel) => {
    try {
      const abs = inRoot(rel);
      if (!fs.existsSync(abs)) return { missing: true };
      if (fs.statSync(abs).size > 5 * 1024 * 1024) return { error: "file is larger than 5 MB" };
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) return { error: "binary file, can't show" };
      return { text: buf.toString("utf8") };
    } catch (e) { return { error: e.message }; }
  });
  // Binary files (images, PDF, Word, Excel, ...) are sent to the app as raw bytes; the app turns them into text or a picture.
  handleProject("project-read-bin", (_e, rel) => {
    try {
      const abs = inRoot(rel);
      if (!fs.existsSync(abs)) return { missing: true };
      const size = fs.statSync(abs).size;
      if (size > 60 * 1024 * 1024) return { error: "file is larger than 60 MB" };
      return { data: new Uint8Array(fs.readFileSync(abs)), size };
    } catch (e) { return { error: e.message }; }
  });
  handleProject("project-write", (_e, rel, content) => {
    try {
      if (isProtected(rel)) return { error: "that folder is protected" };
      const abs = inRoot(rel); backupFile(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, String(content), "utf8");
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });
  handleProject("project-delete", (_e, rel) => {
    try {
      if (isProtected(rel)) return { error: "that folder is protected" };
      const abs = inRoot(rel); if (!fs.existsSync(abs)) return { ok: true };
      backupFile(abs); fs.rmSync(abs); return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  // ---- Running commands. This is the riskiest bridge, so it is much tighter than the file bridge: ----
  //  * only the Home page itself (index.html) may call it, never another local page or a website;
  //  * commands always run inside the open project folder;
  //  * the Home page only calls it after you click Run on a card that shows the exact command.
  const homePage = path.resolve(__dirname, "index.html");
  function isHomePage(e) {
    try {
      const u = new URL(e.sender.getURL());
      if (u.protocol !== "file:") return false;
      u.search = ""; u.hash = "";
      const p = path.resolve(fileURLToPath(u));
      return process.platform === "win32" ? p.toLowerCase() === homePage.toLowerCase() : p === homePage;
    } catch (err) { return false; }
  }
  const isWin = process.platform === "win32";
  const MAX_CMD = 4000, RUN_TIMEOUT_MS = 120000;
  const stripAnsi = (t) => t.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/\r(?!\n)/g, "\n");
  const psEncode = (script) => Buffer.from(script, "utf16le").toString("base64");
  const running = new Map();   // id -> { child, cancelled }
  function killTree(child) {
    if (!child || !child.pid) return;
    try {
      if (isWin) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
      else process.kill(-child.pid, "SIGKILL");
    } catch (e) { try { child.kill("SIGKILL"); } catch (x) {} }
  }
  function projectDirOrNull() { try { return projectRoot && fs.statSync(projectRoot).isDirectory() ? projectRoot : null; } catch (e) { return null; } }

  ipcMain.handle("project-run", (e, req) => new Promise((resolve) => {
    if (!isHomePage(e)) return resolve({ error: "not allowed" });
    const id = String((req && req.id) || ""), command = String((req && req.command) || "").replace(/\r\n/g, "\n").trim();
    const cwd = projectDirOrNull();
    if (!id || !command) return resolve({ error: "empty command" });
    if (command.length > MAX_CMD) return resolve({ error: "command is too long" });
    if (!cwd) return resolve({ error: "No project folder is open" });
    if (running.has(id)) return resolve({ error: "already running" });
    const shell = isWin ? (req.shell === "powershell" ? "powershell" : "cmd") : "sh";
    const opts = {
      cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],   // no keyboard input: a prompt gets end-of-input instead of hanging
      env: Object.assign({}, process.env, { NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb", PYTHONIOENCODING: "utf-8" })
    };
    let child;
    try {
      if (isWin && shell === "powershell") {
        child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
          psEncode("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n" + command)], opts);
      } else if (isWin) {
        const oneLine = command.split("\n").map((l) => l.trim()).filter(Boolean).join(" && ");   // cmd /c only runs the first line
        child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", '"chcp 65001>nul & ' + oneLine + '"'], Object.assign({ windowsVerbatimArguments: true }, opts));
      } else {
        child = spawn("/bin/sh", ["-c", command], Object.assign({ detached: true }, opts));
      }
    } catch (err) { return resolve({ error: err.message }); }

    const rec = { child, cancelled: false, timedOut: false };
    running.set(id, rec);
    const HEAD = 20000, TAIL = 60000;   // keep the start and the end of very long output
    let head = "", tail = "", omitted = 0;
    const push = (t) => {
      t = stripAnsi(t);
      if (head.length < HEAD) { const room = HEAD - head.length; head += t.slice(0, room); t = t.slice(room); }
      if (t) { tail += t; if (tail.length > TAIL) { omitted += tail.length - TAIL; tail = tail.slice(-TAIL); } }
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", push); child.stderr.on("data", push);
    const t0 = Date.now();
    let done = false;
    const finish = (extra) => {
      if (done) return; done = true;
      clearTimeout(timer); running.delete(id);
      resolve(Object.assign({ output: head + (omitted ? "\n…[" + omitted + " characters omitted]…\n" : "") + tail,
        ms: Date.now() - t0, cancelled: rec.cancelled, timedOut: rec.timedOut, shell }, extra));
    };
    const timer = setTimeout(() => { rec.timedOut = true; killTree(child); setTimeout(() => finish({ exitCode: null }), 3000); }, RUN_TIMEOUT_MS);
    child.on("error", (err) => finish({ error: err.message }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal: signal || null }));
  }));
  ipcMain.handle("project-run-cancel", (e, id) => {
    if (!isHomePage(e)) return false;
    const r = running.get(String(id));
    if (r) { r.cancelled = true; killTree(r.child); setTimeout(() => { const x = running.get(String(id)); if (x === r) { try { r.child.emit("close", null, "SIGKILL"); } catch (err) {} } }, 3000); }
    return !!r;
  });
  app.on("before-quit", () => { for (const r of running.values()) killTree(r.child); });

  // Opens a real PowerShell / Command Prompt window (Windows) in the project folder, with the command typed in.
  // What happens in that window is not sent back to the AI.
  ipcMain.handle("terminal-open", (e, req) => {
    if (!isHomePage(e)) return { error: "not allowed" };
    if (!isWin) return { error: "Terminal windows are only set up for Windows." };
    const shell = req && req.shell === "cmd" ? "cmd" : "powershell";
    const command = String((req && req.command) || "").replace(/\r\n/g, "\n").trim();
    if (command.length > MAX_CMD) return { error: "command is too long" };
    const cwd = projectDirOrNull() || os.homedir();
    try {
      let exe, args;
      if (shell === "powershell") {
        const script = "Set-Location -LiteralPath '" + cwd.replace(/'/g, "''") + "'" + (command ? "\n" + command : "");
        exe = "powershell.exe"; args = ["-NoLogo", "-NoExit", "-EncodedCommand", psEncode(script)];
      } else {
        // A small script file avoids every quoting problem with cmd; it only holds what the card showed you.
        const file = path.join(os.tmpdir(), "oasis-terminal-" + crypto.randomBytes(4).toString("hex") + ".cmd");
        fs.writeFileSync(file, "@echo off\r\ntitle IcyWhite\r\ncd /d \"" + cwd + "\"\r\n@echo on\r\n" + command.split("\n").join("\r\n") + "\r\n", "utf8");
        exe = "cmd.exe"; args = ["/k", file];
      }
      const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", "/D", cwd, exe].concat(args), { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", () => {});
      child.unref();
      return { ok: true, cwd };
    } catch (err) { return { error: err.message }; }
  });

  // ---- Native Windows apps & utilities (Task Manager, Device Manager, Settings pages, File Explorer, ...). ----
  // Separate from "project-run" above: the page can only send an id from js/windows-apps.js (and, for File Explorer,
  // one drive / known folder / existing folder). The id is turned into a fixed command in windows-launcher.js.
  // Tools that change things (regedit, msconfig, sfc, DISM, chkdsk, ipconfig /release ...) always show a native
  // Yes/Cancel dialog from here, so a page cannot skip the question.
  ipcMain.handle("win-launch", async (e, req) => {
    if (!isHomePage(e)) return { error: "not allowed" };
    if (!req || typeof req !== "object") return { error: "bad request" };
    const host = e.sender.hostWebContents || e.sender;
    const parent = BrowserWindow.fromWebContents(host) || BrowserWindow.getFocusedWindow() || undefined;
    return winLauncher.handleRequest({ id: String(req.id || ""), arg: req.arg == null ? "" : String(req.arg) }, {
      app, cwd: projectDirOrNull() || os.homedir(),
      confirm: async (text, label) => {
        const r = await dialog.showMessageBox(parent, {
          type: "warning", buttons: ["Yes, run it", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
          title: "IcyWhite - " + label, message: String(label), detail: String(text) + "\n\nThe AI asked for this. Nothing happens unless you choose Yes."
        });
        return r.response === 0;
      }
    });
  });

  // ---- Shared preferences + detecting LM Studio / Ollama. Only this app's own file:// pages may use them. ----
  handleProject("prefs-get", (_e, key) => (PREF_KEYS[key] ? (prefs[key] == null ? null : prefs[key]) : null));
  handleProject("prefs-set", (e, key, value) => {
    if (!PREF_KEYS[key] || !PREF_KEYS[key](value)) return { error: "bad value" };
    prefs[key] = value; savePrefs();
    if (key === "theme") applyThemePref();
    for (const wc of webContents.getAllWebContents()) { if (wc !== e.sender && !wc.isDestroyed()) { try { wc.send("oasis-pref", key, value); } catch (err) {} } }
    return { ok: true };
  });
  // ---- Debug log bridge ----
  ipcMain.on("debug-log-add", (e, level, msg, multi) => {
    try {
      const u = String(e.sender.getURL()); if (!u.startsWith("file:")) return;
      const src = decodeURIComponent(u.split(/[?#]/)[0].split("/").slice(-1)[0] || "page").replace(/\.html$/, "");
      dlog(level, src === "index" ? "home" : src, msg, !!multi);
    } catch (err) {}
  });
  handleProject("debug-log-get", () => ({ lines: debugLines.map((l) => ({ level: l.level, text: debugFormat(l) })) }));
  handleProject("debug-log-clear", () => { debugLines.length = 0; dlog("info", "app", "Log cleared."); return true; });
  handleProject("debug-log-copy", () => { try { clipboard.writeText(debugText()); return { ok: true, count: debugLines.length }; } catch (err) { return { error: err.message }; } });
  handleProject("debug-log-open", () => { openDebugWindow(); return true; });
  handleProject("debug-log-pin", (_e, on) => { if (debugWin && !debugWin.isDestroyed()) debugWin.setAlwaysOnTop(Boolean(on)); return true; });
  handleProject("probe-servers", () => {
    const http = require("http");
    const probe = (port) => new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/v1/models", timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
      req.on("timeout", () => { req.destroy(); resolve(false); }); req.on("error", () => resolve(false));
    });
    return Promise.all([probe(1234), probe(11434)]).then(([lmstudio, ollama]) => ({ lmstudio, ollama }));
  });

  // ---- Local models (llama.cpp). Only the Home page (Settings dialog) may use these. ----
  const llamaHandle = (name, fn) => ipcMain.handle(name, async (e, ...a) => { if (!isHomePage(e)) return { error: "not allowed" }; try { return await fn(e, ...a); } catch (err) { return { error: err.message }; } });
  // Web research for the chat (Home page only): search the web and read pages so the AI can answer with sources.
  ipcMain.handle("web-research", async (e, query, opt) => {
    if (!isHomePage(e)) return { error: "not allowed" };
    try { return await web.research(String(query || ""), { results: 6, open: Math.max(1, Math.min(5, (opt && opt.open) | 0 || 3)), chars: Math.max(1000, Math.min(8000, (opt && opt.chars) | 0 || 3500)) }); }
    catch (err) { return { error: String((err && err.message) || err) }; }
  });
  ipcMain.handle("web-read", async (e, url) => {
    if (!isHomePage(e)) return { error: "not allowed" };
    try { return await web.readPage(String(url || ""), 6000); } catch (err) { return { error: String((err && err.message) || err) }; }
  });
  llamaHandle("llama-status", () => llama.getStatus());
  llamaHandle("llama-models", () => llama.listModels());
  llamaHandle("llama-config", (_e, patch) => llama.setConfig(patch));
  llamaHandle("llama-preview", (_e, model) => ({ command: llama.preview(model) }));
  llamaHandle("llama-start", (_e, req) => llama.start(req));
  llamaHandle("llama-stop", () => llama.stop());
  // Extra models running at the same time
  llamaHandle("llama-estimate", (_e, req) => llama.estimate(req && req.model, req && req.config));
  llamaHandle("llama-open-logs-dir", async () => {
    const d = path.join(app.getPath("userData"), "logs"); try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
    llama.flushLog(); const r = await shell.openPath(d); return r ? { error: r } : { ok: true, dir: d };
  });
  llamaHandle("llama-multi-list", () => llamaMulti.list());
  llamaHandle("llama-multi-add", (_e, req) => llamaMulti.add(req));
  llamaHandle("llama-multi-update", (_e, id, patch) => llamaMulti.update(id, patch));
  llamaHandle("llama-multi-reload", (_e, id, patch) => llamaMulti.reload(id, patch));
  llamaHandle("llama-multi-stop", (_e, id) => llamaMulti.stop(id));
  llamaHandle("llama-multi-remove", (_e, id) => llamaMulti.remove(id));
  llamaHandle("llama-multi-stop-all", () => llamaMulti.stopAll());
  llamaHandle("llama-multi-max", (_e, n) => llamaMulti.setMax(n));
  llamaHandle("llama-pick-models-dir", async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender.hostWebContents || e.sender) || undefined;
    const r = await dialog.showOpenDialog(parent, { properties: ["openDirectory"], title: "Choose the folder with your .gguf models", defaultPath: llama.modelsDir() });
    if (r.canceled || !r.filePaths[0]) return null;
    llama.setConfig({ modelsDir: path.resolve(r.filePaths[0]) });
    return llama.listModels();
  });
  llamaHandle("llama-open-models-dir", async () => {
    const d = llama.modelsDir();
    try { fs.mkdirSync(d, { recursive: true }); } catch (err) {}
    const msg = await shell.openPath(d);
    return msg ? { error: msg } : { ok: true, dir: d };
  });
  // Runtimes = the different llama.cpp builds (NVIDIA CUDA, Vulkan, CPU...). The right one is picked from this PC's hardware.
  llamaHandle("llama-runtimes", (_e, opt) => llama.listRuntimes(opt));
  llamaHandle("llama-pick-runtimes-dir", async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender.hostWebContents || e.sender) || undefined;
    const r = await dialog.showOpenDialog(parent, { properties: ["openDirectory"], title: "Choose the folder that holds your llama.cpp runtime folders (each one has llama-server.exe in it)", defaultPath: llama.runtimesDir() });
    if (r.canceled || !r.filePaths[0]) return null;
    llama.setConfig({ runtimesDir: path.resolve(r.filePaths[0]), runtime: "auto" });
    return llama.listRuntimes({ rescan: true });
  });
  llamaHandle("llama-open-runtimes-dir", async () => {
    const d = llama.runtimesDir();
    try { fs.mkdirSync(d, { recursive: true }); } catch (err) {}
    const msg = await shell.openPath(d);
    return msg ? { error: msg } : { ok: true, dir: d };
  });
  // ---- Hugging Face hub. Only the Home page (Settings > Local model > "Get models from Hugging Face") may use these. ----
  const hfHandle = (name, fn) => ipcMain.handle(name, async (e, ...a) => { if (!isHomePage(e)) return { error: "not allowed" }; try { return await fn(e, ...a); } catch (err) { return { error: err.message, code: err.code || "error" }; } });
  hfHandle("hf-config-get", () => hf.getConfig());
  hfHandle("hf-config-set", (_e, patch) => hf.setConfig(patch));
  hfHandle("hf-token-set", (_e, token) => hf.setToken(token));
  hfHandle("hf-token-test", () => hf.whoami());
  hfHandle("hf-hardware", () => hf.hardware());
  hfHandle("hf-search", (_e, q) => hf.search(q));
  hfHandle("hf-model", (_e, repo, rev) => hf.model(repo, rev));
  hfHandle("hf-readme", (_e, repo, rev) => hf.readme(repo, rev));
  hfHandle("hf-resolve", (_e, text) => hf.resolve(text));
  hfHandle("hf-starters", () => hf.starters());
  hfHandle("hf-dl-add", (_e, req) => hf.add(req));
  hfHandle("hf-dl-list", () => hf.list());
  hfHandle("hf-dl-pause", (_e, id) => hf.pause(id));
  hfHandle("hf-dl-resume", (_e, id) => hf.resume(id));
  hfHandle("hf-dl-retry", (_e, id) => hf.retry(id));
  hfHandle("hf-dl-cancel", (_e, id) => hf.cancel(id));
  hfHandle("hf-dl-remove", (_e, id) => hf.remove(id));
  hfHandle("hf-dl-clear", () => hf.clearFinished());
  hfHandle("hf-dl-open", async (_e, id) => {
    const j = hf.list().jobs.find((x) => x.id === id); if (!j) return { error: "not found" };
    try { fs.mkdirSync(j.dir, { recursive: true }); } catch (err) {}
    const msg = await shell.openPath(j.dir);
    return msg ? { error: msg } : { ok: true };
  });
  // ---- MCP tools. Only the Home page may use these; the chat asks you before a tool runs. ----
  const mcpHandle = (name, fn) => ipcMain.handle(name, async (e, ...a) => { if (!isHomePage(e)) return { error: "not allowed" }; try { return await fn(e, ...a); } catch (err) { return { error: err.message }; } });
  mcpHandle("mcp-get", () => mcp.view());
  mcpHandle("mcp-set-global", (_e, p) => mcp.setGlobal(p));
  mcpHandle("mcp-save-server", (_e, s) => mcp.saveServer(s));
  mcpHandle("mcp-import", (_e, text) => mcp.importServers(text));
  mcpHandle("mcp-remove-server", (_e, id) => mcp.removeServer(String(id)));
  mcpHandle("mcp-start", async (_e, id) => { try { await mcp.start(String(id)); } catch (err) {} return mcp.view(); });
  mcpHandle("mcp-stop", (_e, id) => mcp.stop(String(id)));
  mcpHandle("mcp-tools", () => mcp.tools());
  mcpHandle("mcp-call", (_e, name, args) => mcp.call(String(name), args));
  mcpHandle("mcp-always", (_e, serverId, tool, on) => mcp.setAlways(String(serverId), String(tool), !!on));
  mcpHandle("mcp-pick-dir", async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender.hostWebContents || e.sender) || undefined;
    const r = await dialog.showOpenDialog(parent, { properties: ["openDirectory"], title: "Choose a folder" });
    return r.canceled || !r.filePaths[0] ? null : path.resolve(r.filePaths[0]);
  });
  if (mcp.view().enabled) mcp.startEnabled().catch(() => {});
  app.on("before-quit", () => { if (mcp) mcp.shutdownSync(); if (hf) hf.shutdownSync(); if (llama) llama.shutdownSync(); if (llamaMulti) llamaMulti.shutdownSync(); });

  ipcMain.handle("show-item-in-folder", (_event, targetPath) => { try { shell.showItemInFolder(targetPath); return true; } catch (e) { return false; } });

  // Tab dragged off the tab strip -> its own window. Only the browser shell itself may ask for this.
  ipcMain.handle("popout-tab", (e, req) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    if (!owner || e.sender !== owner.webContents || !req) return { error: "not allowed" };
    const w = openPopupWindow(String(req.url || ""), String(req.partition || ""), { x: req.x, y: req.y, title: String(req.title || "").slice(0, 120) });
    return w ? { ok: true } : { error: "that page can't be opened in its own window" };
  });
  // A popped-out window has no tab strip, so links the AI opens from it open as more pop-outs.
  ipcMain.on("oasis-open-tab-fallback", (e, url) => {
    if (e.sender.hostWebContents) return;   // inside a tab: the browser shell handles it
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w.__oasisPopupPartition) openPopupWindow(String(url || ""), w.__oasisPopupPartition, null);
  });
  ipcMain.handle("new-window", () => { createWindow({ isPrivate: false }); return true; });
  ipcMain.handle("new-private-window", () => { createWindow({ isPrivate: true }); return true; });
  ipcMain.handle("close-window", (event) => { const w = BrowserWindow.fromWebContents(event.sender); if (w) w.close(); return true; });

  ipcMain.handle("clear-browsing-data", async (_event, partitionName, opts = {}) => {
    try {
      const ses = session.fromPartition(partitionName || "persist:oasis");
      if (opts.cache !== false) await ses.clearCache();
      const dataTypes = [];
      if (opts.cookies !== false) dataTypes.push("cookies", "localstorage", "serviceworkers", "cachestorage", "indexdb", "websql", "shadercache");
      if (dataTypes.length) await ses.clearStorageData({ storages: dataTypes });
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle("show-about", (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return;
    dialog.showMessageBox(w, {
      type: "info",
      title: "About IcyWhite",
      message: "IcyWhite",
      detail:
        "Created by Merlin.\n\n" +
        "A free, local-first AI workspace — your chats, tabs, and data stay on this device.\n\n" +
        "Free to use. Free to modify.\n\n" +
        "Questions, comments, or feedback? Visit Oasis, the community and support hub, from the Tools menu.\n\n" +
        `Version ${app.getVersion()}`
    });
  });

  createWindow();
  llama.autoStart().then(() => llamaMulti.autoStart()).catch(() => {});   // starts the last model again if "Start automatically" is ticked

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
