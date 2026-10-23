/* Run with:   node --test tests/windows-launcher.test.js        (from the app folder; Node 18+)
 *
 * Works on any OS. The launcher is tested with an injected "spawn" so nothing real is started.
 * Optional: set PWSH=/path/to/pwsh (PowerShell 7) to also run the embedded PowerShell for real
 * (error paths and the success path of the launch script, using harmless stand-in programs).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { spawn: realSpawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const W = require("../js/windows-apps.js");
const L = require("../windows-launcher.js");

/* ------------------------------------------------------------------ fake spawn */
function fakeSpawn(log, result) {
  return function (cmd, args, opts) {
    const c = new EventEmitter();
    c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.stdout.setEncoding = c.stderr.setEncoding = () => {};
    c.pid = 4242; c.kill = () => {};
    log.push({ cmd, args, env: opts && opts.env });
    setImmediate(() => {
      if (result && result.stdout) c.stdout.emit("data", result.stdout);
      c.emit("close", result && result.exitCode != null ? result.exitCode : 0);
    });
    return c;
  };
}
const decodePs = (args) => Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");

/* ------------------------------------------------------------------ registry */
test("registry: unique ids, every entry well formed", () => {
  const seen = new Set();
  for (const e of W.ENTRIES) {
    assert.ok(!seen.has(e.id), "duplicate id " + e.id); seen.add(e.id);
    assert.ok(e.label && e.group && e.kind, "incomplete entry " + e.id);
    if (e.kind === "exe" || e.kind === "msc" || e.kind === "cpl" || e.kind === "control" || e.kind === "shell") assert.match(e.file, /^[A-Za-z0-9_.-]+$/, e.id);
    if (e.kind === "uri") assert.match(e.uri, /^ms-settings:[a-z0-9-]*$/, e.id);
    if (e.kind === "window") assert.ok(e.command && e.confirm && e.confirmText, e.id);
    (e.args || []).forEach((a) => assert.match(a, /^[\w\/.-]+$/, e.id + " arg"));
  }
});

test("registry: everything the brief lists is present with the right command", () => {
  const cmd = (id) => { const e = W.BY_ID[id]; assert.ok(e, "missing " + id); return [e.file, ...(e.args || [])].join(" "); };
  const want = {
    "task-manager": "taskmgr.exe", "resource-monitor": "resmon.exe", "performance-monitor": "perfmon.exe",
    "reliability-monitor": "perfmon.exe /rel", "system-diagnostics": "perfmon.exe /report",
    "performance-monitor-system": "perfmon.exe /sys", "performance-monitor-resources": "perfmon.exe /res",
    "system-information": "msinfo32.exe", "directx-diagnostic": "dxdiag.exe", "windows-version": "winver.exe",
    "computer-management": "compmgmt.msc", "device-manager": "devmgmt.msc", "disk-management": "diskmgmt.msc",
    "event-viewer": "eventvwr.msc", "services": "services.msc", "task-scheduler": "taskschd.msc",
    "shared-folders": "fsmgmt.msc", "local-users-groups": "lusrmgr.msc", "local-security-policy": "secpol.msc",
    "group-policy-editor": "gpedit.msc", "certificate-manager": "certmgr.msc", "wmi-control": "wmimgmt.msc",
    "disk-cleanup": "cleanmgr.exe", "optimize-drives": "dfrgui.exe", "windows-firewall": "wf.msc",
    "printers": "control.exe printers", "user-accounts": "netplwiz.exe", "color-management": "colorcpl.exe",
    "control-panel": "control.exe", "registry-editor": "regedit.exe", "system-configuration": "msconfig.exe",
    "command-prompt": "cmd.exe", "powershell": "powershell.exe", "powershell-7": "pwsh.exe", "windows-terminal": "wt.exe"
  };
  for (const [id, c] of Object.entries(want)) assert.equal(cmd(id), c, id);
  const cpl = { "network-connections": "ncpa.cpl", "internet-properties": "inetcpl.cpl", "sound-control-panel": "mmsys.cpl",
    "game-controllers": "joy.cpl", "display-properties": "desk.cpl", "mouse": "main.cpl", "system-properties": "sysdm.cpl",
    "programs-features": "appwiz.cpl", "date-time": "timedate.cpl", "region": "intl.cpl", "power-options": "powercfg.cpl" };
  for (const [id, f] of Object.entries(cpl)) { assert.equal(W.BY_ID[id].kind, "cpl", id); assert.equal(W.BY_ID[id].file, f, id); }
  const uris = ["", "display", "sound", "network", "bluetooth", "camera", "devices", "usb", "accounts", "yourinfo", "signinoptions", "emailandaccounts",
    "otherusers", "appsfeatures", "defaultapps", "startupapps", "optionalfeatures", "windowsupdate", "storagesense", "personalization", "themes",
    "fonts", "colors", "windowsdefender", "nightlight"];
  const have = new Set(W.ENTRIES.filter((e) => e.kind === "uri").map((e) => e.uri));
  uris.forEach((u) => assert.ok(have.has("ms-settings:" + u), "missing ms-settings:" + u));
});

test("registry: things that change the system always require confirmation", () => {
  ["registry-editor", "system-configuration", "sfc-scannow", "dism-restorehealth", "chkdsk", "ipconfig-flushdns", "ipconfig-release",
    "ipconfig-renew", "powercfg-batteryreport", "powercfg-energy"].forEach((id) => assert.equal(W.BY_ID[id].confirm, true, id));
  W.ENTRIES.filter((e) => e.kind === "window").forEach((e) => assert.equal(e.confirm, true, e.id));
  // read-only diagnostics need no confirmation
  ["task-manager", "resource-monitor", "event-viewer", "system-information", "device-manager"].forEach((id) => assert.ok(!W.BY_ID[id].confirm, id));
  W.ENTRIES.filter((e) => e.kind === "query").forEach((e) => assert.ok(!e.confirm, e.id));
});

/* ------------------------------------------------------------------ natural language */
test("aliases: the phrases from the brief resolve to the right tool", () => {
  const r = (t) => W.resolve(t, { strict: true });
  const id = (t) => (r(t) || {}).id;
  for (const t of ["open task manager", "show task manager", "bring up task manager", "show me what's running", "Open Task Manager please"]) assert.equal(id(t), "task-manager", t);
  assert.equal(id("resource monitor"), "resource-monitor");
  // "system resources" questions get the numbers in the chat AND open Resource Monitor alongside
  for (const t of ["system resources", "show system resources", "show me resource usage", "how much ram am i using"]) assert.equal(id(t), "q-resources", t);
  assert.equal(W.BY_ID["q-resources"].alsoOpen, "resource-monitor");
  assert.ok(L.QUERY_SCRIPTS["q-resources"]);
  for (const k of ["q-processes", "q-processes-cpu", "q-processes-ram"]) assert.equal(W.BY_ID[k].alsoOpen, "task-manager", k);
  for (const t of ["system information", "show my computer specs", "show my hardware", "computer information"]) assert.equal(id(t), "system-information", t);
  assert.equal(id("open reliability monitor"), "reliability-monitor");
  assert.equal(id("open directx diagnostic"), "directx-diagnostic");
  assert.equal(id("open device manager"), "device-manager");
  assert.equal(id("open windows firewall"), "windows-firewall");
  assert.equal(id("open power options"), "power-options");
  assert.equal(id("open windows update"), "settings-windows-update");
  assert.equal(id("open the control panel"), "control-panel");
  assert.equal(id("open file explorer"), "file-explorer");
  assert.equal(id("open calculator"), "calculator");
  assert.equal(id("open notepad"), "notepad");
  assert.equal(id("open event viewer"), "event-viewer");           // contains the letters "tv": must not become Live TV
  assert.equal(id("run sfc /scannow"), "sfc-scannow");
  assert.equal(id("ms-settings:display"), "settings-display");
});

test("aliases: drives and folders", () => {
  const r = (t) => W.resolve(t, { strict: true });
  assert.deepEqual(r("Open my D drive"), { id: "file-explorer", arg: "D:" });
  assert.deepEqual(r("open my c drive"), { id: "file-explorer", arg: "C:" });
  assert.deepEqual(r("open e:"), { id: "file-explorer", arg: "E:" });
  assert.deepEqual(r("open file explorer to F drive"), { id: "file-explorer", arg: "F:" });
  assert.deepEqual(r("open downloads"), { id: "file-explorer", arg: "@downloads" });
  assert.deepEqual(r("open my desktop"), { id: "file-explorer", arg: "@desktop" });
  assert.deepEqual(r("open C:\\Users\\Me\\My Projects"), { id: "file-explorer", arg: "C:\\Users\\Me\\My Projects" });
});

test("aliases: information questions", () => {
  const id = (t) => (W.resolve(t, { strict: true }) || {}).id;
  assert.equal(id("What CPU do I have?"), "q-cpu");
  assert.equal(id("How much RAM do I have?"), "q-ram");
  assert.equal(id("What GPU do I have?"), "q-gpu");
  assert.equal(id("How much VRAM do I have?"), "q-gpu");
  assert.equal(id("What version of Windows am I running?"), "q-os");
  assert.equal(id("What drives do I have?"), "q-drives");
  assert.equal(id("What's my computer name?"), "q-hostname");
  assert.equal(id("Show running processes"), "q-processes");
  assert.equal(id("What's using the most CPU?"), "q-processes-cpu");
  assert.equal(id("What's using the most RAM?"), "q-processes-ram");
  assert.equal(id("What programs are running?"), "q-processes");
});

test("ambiguity: umbrella words ask instead of guessing", () => {
  const r = W.resolve("open performance", { strict: true });
  assert.deepEqual(r.ambiguous, ["task-manager", "resource-monitor", "performance-monitor"]);
  assert.equal(W.joinOr(r.ambiguous.map(W.labelOf)), "Task Manager, Resource Monitor, or Performance Monitor");
  assert.ok(W.resolve("open network", { strict: true }).ambiguous.length >= 2);
});

test("aliases: ordinary chat and Oasis apps are NOT mistaken for Windows tools", () => {
  for (const t of ["hello there", "what is the weather", "open chess", "play maze madness", "tell me a joke", "I like the services industry", "mystic realm settings"])
    assert.equal(W.resolve(t, { strict: true }), null, t);
  assert.equal(W.resolve("x".repeat(200)), null);
});

/* ------------------------------------------------------------------ launcher (injected spawn) */
const ctxFor = (log, extra) => Object.assign({ platform: "win32", spawn: fakeSpawn(log, { exitCode: 0 }), cwd: "C:\\Users\\Me", app: { getPath: (n) => "C:\\Users\\Me\\" + n } }, extra || {});

test("launcher: not Windows -> clear message, nothing spawned", async () => {
  const log = [];
  const r = await L.handleRequest({ id: "task-manager" }, ctxFor(log, { platform: "linux" }));
  assert.equal(r.error, L.MSG.notWindows); assert.equal(log.length, 0);
});

test("launcher: unknown / hostile ids are refused and never reach a shell", async () => {
  for (const id of ["", "nope", "__proto__", "constructor", "toString", "powershell.exe -Command calc", "task-manager; calc", "../../x"]) {
    const log = [];
    const r = await L.handleRequest({ id }, ctxFor(log));
    assert.ok(r.error, id); assert.equal(log.length, 0, id);
  }
});

test("launcher: every launchable entry builds a fixed command (no AI text anywhere)", async () => {
  for (const e of W.ENTRIES.filter((x) => x.kind !== "query" && x.kind !== "explorer")) {
    const log = [];
    const r = await L.handleRequest({ id: e.id, arg: "calc.exe & evil" }, ctxFor(log, { confirm: async () => true }));
    assert.ok(r.ok, e.id + " -> " + JSON.stringify(r));
    assert.equal(log.length, 1, e.id);
    const { cmd, args, env } = log[0];
    assert.equal(cmd, "powershell.exe");
    assert.deepEqual(args.slice(0, 3), ["-NoLogo", "-NoProfile", "-NonInteractive"]);
    assert.ok(!JSON.stringify(env.OASIS_ARGS || "").includes("evil"), e.id + " leaked arg");
    assert.ok(!decodePs(args).includes("evil"), e.id);
    assert.equal(decodePs(args).split("\n").slice(2).join("\n"), L.LAUNCH_SCRIPT, e.id + ": the script must be the one fixed script");
  }
});

test("launcher: exe / msc / cpl / uri / control map to the right Start-Process inputs", async () => {
  const run = async (id) => { const log = []; await L.handleRequest({ id }, ctxFor(log)); return log[0].env; };
  let e = await run("task-manager"); assert.equal(e.OASIS_FILE, "taskmgr.exe"); assert.equal(e.OASIS_ARGS, "");
  e = await run("reliability-monitor"); assert.equal(e.OASIS_FILE, "perfmon.exe"); assert.equal(e.OASIS_ARGS, "/rel");
  e = await run("device-manager"); assert.equal(e.OASIS_FILE, "devmgmt.msc"); assert.equal(e.OASIS_CHECKFILE, "devmgmt.msc");
  e = await run("power-options"); assert.equal(e.OASIS_FILE, "control.exe"); assert.equal(e.OASIS_ARGS, "powercfg.cpl"); assert.equal(e.OASIS_CHECKFILE, "powercfg.cpl");
  e = await run("printers"); assert.equal(e.OASIS_FILE, "control.exe"); assert.equal(e.OASIS_ARGS, "printers");
  e = await run("settings-display"); assert.equal(e.OASIS_FILE, "ms-settings:display");
  e = await run("windows-terminal"); assert.equal(e.OASIS_FILE, "wt.exe"); assert.equal(e.OASIS_FINDCMD, "wt.exe"); assert.equal(e.OASIS_CWD, "C:\\Users\\Me");
  assert.equal((await run("task-manager")).OASIS_ELEVATE, "");
});

test("launcher: tools that change things ask first, and Cancel runs nothing", async () => {
  for (const id of ["registry-editor", "system-configuration", "sfc-scannow", "dism-restorehealth", "chkdsk", "ipconfig-flushdns", "ipconfig-release", "ipconfig-renew", "powercfg-energy", "powercfg-batteryreport"]) {
    let asked = null;
    let log = [];
    let r = await L.handleRequest({ id, confirmed: true }, ctxFor(log, { confirm: async (text, label) => { asked = { text, label }; return false; } }));
    assert.equal(r.cancelled, true, id); assert.equal(log.length, 0, id + " must not run after Cancel");
    assert.ok(asked && asked.text.length > 20, id + " asked");
    log = [];
    r = await L.handleRequest({ id }, ctxFor(log));      // no confirm function at all -> treated as "no"
    assert.equal(r.cancelled, true, id + " without a confirm hook"); assert.equal(log.length, 0);
    log = [];
    r = await L.handleRequest({ id }, ctxFor(log, { confirm: async () => true }));
    assert.equal(r.ok, true, id); assert.equal(log.length, 1);
  }
  // a renderer that merely CLAIMS it was confirmed must not skip the dialog
  const log = [];
  const r = await L.handleRequest({ id: "sfc-scannow", confirmed: true, confirm: true }, ctxFor(log, { confirm: async () => false }));
  assert.equal(r.cancelled, true); assert.equal(log.length, 0);
});

test("launcher: maintenance commands run the fixed registry command in a visible window (elevated when needed)", async () => {
  const log = [];
  await L.handleRequest({ id: "sfc-scannow" }, ctxFor(log, { confirm: async () => true }));
  const env = log[0].env;
  assert.equal(env.OASIS_FILE, "powershell.exe"); assert.equal(env.OASIS_ELEVATE, "1");
  assert.match(env.OASIS_ARGS, /^-NoLogo -NoExit -EncodedCommand [A-Za-z0-9+/=]+$/);
  const inner = Buffer.from(env.OASIS_ARGS.split(" ").pop(), "base64").toString("utf16le");
  assert.match(inner, /^sfc \/scannow\n/);
  const log2 = [];
  await L.handleRequest({ id: "dism-restorehealth" }, ctxFor(log2, { confirm: async () => true }));
  assert.match(Buffer.from(log2[0].env.OASIS_ARGS.split(" ").pop(), "base64").toString("utf16le"), /^DISM \/Online \/Cleanup-Image \/RestoreHealth/);
  const log3 = [];
  await L.handleRequest({ id: "powercfg-batteryreport" }, ctxFor(log3, { confirm: async () => true }));
  assert.equal(log3[0].env.OASIS_ELEVATE, "");
});

test("launcher: friendly errors (missing exe, missing edition, UAC cancelled, timeout, spawn failure)", async () => {
  const mk = (stdout, exitCode) => ({ platform: "win32", spawn: fakeSpawn([], { stdout, exitCode }), app: { getPath: () => "C:\\x" } });
  assert.equal((await L.handleRequest({ id: "powershell-7" }, mk("MISSING_APP", 5))).error, L.MSG.noApp);
  assert.equal((await L.handleRequest({ id: "group-policy-editor" }, mk("MISSING_EDITION", 4))).error, L.MSG.noEdition);
  assert.equal((await L.handleRequest({ id: "task-manager" }, mk("ERR: The system cannot find the file specified", 3))).error, L.MSG.noApp);
  assert.equal((await L.handleRequest({ id: "local-security-policy" }, mk("ERR: The system cannot find the file specified", 3))).error, L.MSG.noEdition);
  assert.equal((await L.handleRequest({ id: "task-manager" }, mk("ERR: The operation was canceled by the user.", 3))).error, L.MSG.uacCancel);
  const r = await L.handleRequest({ id: "task-manager" }, { platform: "win32", spawn: () => { throw new Error("EPERM"); }, app: {} });
  assert.match(r.error, /PowerShell could not be started: EPERM/);
});

test("launcher: File Explorer only opens a drive, a known folder or an existing folder", async () => {
  const fakeFs = { existsSync: (p) => /^[CD]:\\$/.test(p), statSync: (p) => { if (/^C:\\Users\\Me\\(My Projects|Docs)$/.test(p)) return { isDirectory: () => true }; if (p === "C:\\Windows\\notepad.exe") return { isDirectory: () => false }; throw new Error("ENOENT"); } };
  const run = async (arg) => { const log = []; const r = await L.handleRequest({ id: "file-explorer", arg }, ctxFor(log, { fs: fakeFs })); return { r, env: log[0] && log[0].env }; };
  let x = await run(""); assert.ok(x.r.ok); assert.equal(x.env.OASIS_FILE, "explorer.exe"); assert.equal(x.env.OASIS_ARGS, "");
  x = await run("D:"); assert.ok(x.r.ok); assert.equal(x.env.OASIS_ARGS, "D:\\");
  x = await run("d"); assert.ok(x.r.error, "bare letter is not a drive request");
  x = await run("Z:"); assert.match(x.r.error, /Drive Z: isn't available/); assert.equal(x.env, undefined);
  x = await run("@downloads"); assert.ok(x.r.ok); assert.equal(x.env.OASIS_ARGS, "C:\\Users\\Me\\downloads");
  x = await run("@nonsense"); assert.ok(x.r.error);
  x = await run("C:\\Users\\Me\\My Projects"); assert.ok(x.r.ok); assert.equal(x.env.OASIS_ARGS, '"C:\\Users\\Me\\My Projects"');       // spaces are quoted
  x = await run("C:\\Users\\Me\\My Projects\\"); assert.ok(x.r.ok); assert.equal(x.env.OASIS_ARGS, '"C:\\Users\\Me\\My Projects"');   // trailing slash trimmed
  // things that must be refused: files (would run them), switches, quotes, pipes, UNC/relative paths, missing folders
  for (const bad of ["C:\\Windows\\notepad.exe", "/select,C:\\x", "/e,C:\\", "C:\\Users\\Me\\Docs\" /e", "C:\\Users\\Me\\Docs|calc", "\\\\server\\share", "..\\..", "notepad.exe", "C:\\nope", "C:\\a<b"]) {
    x = await run(bad); assert.ok(x.r.error, "should refuse: " + bad); assert.equal(x.env, undefined, bad);
  }
});

test("launcher: information queries are read-only, fixed scripts, output is trimmed and reported", async () => {
  const log = [];
  const r = await L.handleRequest({ id: "q-cpu", arg: "ignored; calc" }, ctxFor(log, { spawn: fakeSpawn(log, { stdout: "Name : Test CPU\r\n\r\n\r\n\r\nCores : 8\r\n", exitCode: 0 }) }));
  assert.ok(r.ok && r.query); assert.equal(r.output, "Name : Test CPU\n\nCores : 8");
  assert.ok(decodePs(log[0].args).includes(L.QUERY_SCRIPTS["q-cpu"]));
  assert.ok(!decodePs(log[0].args).includes("calc"));
  const big = await L.handleRequest({ id: "q-netstat-ano" }, ctxFor([], { spawn: fakeSpawn([], { stdout: "x".repeat(50000), exitCode: 0 }) }));
  assert.equal(big.truncated, true); assert.ok(big.output.length < 15000);
  // scripts for queries never launch, kill, write or change anything
  for (const [id, s] of Object.entries(L.QUERY_SCRIPTS)) assert.ok(!/Start-Process|Stop-Process|taskkill|Remove-|Set-|New-Item|Out-File|reg add|netsh|\/release|\/renew|\/flushdns|Invoke-Expression|iex /i.test(s), id + " is not read-only");
});

/* ------------------------------------------------------------------ optional: run the real PowerShell */
const PWSH = process.env.PWSH;
const realPs = (env) => L.runPowerShell(L.LAUNCH_SCRIPT, env, { timeoutMs: 30000 }, (cmd, args, opts) => realSpawn(PWSH, args, opts));
test("powershell (real): launch script error paths and success path", { skip: !PWSH }, async () => {
  const base = { OASIS_FILE: "", OASIS_ARGS: "", OASIS_CHECKFILE: "", OASIS_FINDCMD: "", OASIS_CWD: "", OASIS_ELEVATE: "" };
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oasis-root-"));
  fs.mkdirSync(path.join(fakeRoot, "System32"));
  // 1. management console missing on this "edition"
  let r = await realPs({ ...base, OASIS_FILE: "gpedit.msc", OASIS_CHECKFILE: "gpedit.msc", SystemRoot: fakeRoot });
  assert.equal(r.exitCode, 4); assert.equal(r.stdout.trim(), "MISSING_EDITION");
  assert.equal(L.classifyFailure(r, W.BY_ID["group-policy-editor"]), L.MSG.noEdition);
  // 2. a program that isn't installed
  r = await realPs({ ...base, OASIS_FILE: "pwsh.exe", OASIS_FINDCMD: "definitely-not-installed.exe" });
  assert.equal(r.exitCode, 5);
  assert.equal(L.classifyFailure(r, W.BY_ID["powershell-7"]), L.MSG.noApp);
  // 3. Start-Process itself failing (file does not exist) is reported, not thrown.
  //    Only Windows PowerShell throws for a missing file (on Linux it hands the path to xdg-open), so assert this on Windows only.
  if (process.platform === "win32") {
    r = await realPs({ ...base, OASIS_FILE: path.join(fakeRoot, "nothing-here.exe") });
    assert.equal(r.exitCode, 3); assert.match(r.stdout, /^ERR:/);
    assert.equal(L.classifyFailure(r, W.BY_ID["task-manager"]), L.MSG.noApp);
  }
  // 4. success: starts a real (harmless) program with an argument that contains spaces
  const marker = path.join(fakeRoot, "touched with spaces.txt");
  const helper = path.join(fakeRoot, "touch.sh"); fs.writeFileSync(helper, "#!/bin/sh\ntouch \"$1\"\n"); fs.chmodSync(helper, 0o755);
  r = await realPs({ ...base, OASIS_FILE: helper, OASIS_ARGS: '"' + marker + '"', OASIS_CHECKFILE: "", SystemRoot: fakeRoot });
  assert.equal(r.exitCode, 0, r.stdout + r.stderr);
  await new Promise((res) => setTimeout(res, 800));
  assert.ok(fs.existsSync(marker), "launched program received its quoted argument");
  // 5. shell metacharacters in an argument are NOT interpreted (no shell is involved)
  const marker2 = path.join(fakeRoot, "injected.txt");
  r = await realPs({ ...base, OASIS_FILE: helper, OASIS_ARGS: '"' + path.join(fakeRoot, "x; touch " + marker2) + '"' });
  assert.equal(r.exitCode, 0);
  await new Promise((res) => setTimeout(res, 800));
  assert.ok(!fs.existsSync(marker2), "no injection");
});
