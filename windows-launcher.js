/* Oasis native Windows launcher (main process).
 *
 * This is deliberately SEPARATE from the "project-run" bridge (which runs arbitrary command text the user
 * approves on a card). Here the caller can only send an id from js/windows-apps.js (plus, for File Explorer,
 * one validated folder). The id is looked up in the registry and turned into a fixed command. Nothing the AI
 * writes is ever executed as shell text.
 *
 * Every launch goes through ONE fixed PowerShell script that reads its inputs from environment variables, so
 * there is no string-building / quoting of untrusted text. Start-Process uses ShellExecute, which is also what
 * lets Windows show its normal UAC prompt for tools that need administrator rights.
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const REG = require("./js/windows-apps.js");

const psEncode = (script) => Buffer.from(script, "utf16le").toString("base64");

/* ---- the one launch script (static text) ---------------------------------------------------------------- */
const LAUNCH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  $f = $env:OASIS_FILE",
  "  if ($env:OASIS_CHECKFILE) {",
  "    if (-not (Test-Path -LiteralPath (Join-Path $env:SystemRoot ('System32\\' + $env:OASIS_CHECKFILE)))) { [Console]::Out.Write('MISSING_EDITION'); exit 4 }",
  "  }",
  "  if ($env:OASIS_FINDCMD) {",
  "    if (-not (Get-Command $env:OASIS_FINDCMD -ErrorAction SilentlyContinue)) { [Console]::Out.Write('MISSING_APP'); exit 5 }",
  "  }",
  "  $p = @{ FilePath = $f }",
  "  if ($env:OASIS_ARGS) { $p['ArgumentList'] = $env:OASIS_ARGS }",
  "  if ($env:OASIS_CWD) { $p['WorkingDirectory'] = $env:OASIS_CWD }",
  "  if ($env:OASIS_ELEVATE -eq '1') { $p['Verb'] = 'RunAs' }",
  "  Start-Process @p",
  "  exit 0",
  "} catch {",
  "  [Console]::Out.Write('ERR: ' + $_.Exception.Message)",
  "  exit 3",
  "}"
].join("\n");

/* ---- read-only information scripts (static text, keyed by registry id) ----------------------------------- */
const FT = "| Format-Table -AutoSize | Out-String -Width 200";
const FL = "| Format-List | Out-String -Width 200";
const GB = (expr) => "[math]::Round(" + expr + "/1GB,1)";
const QUERY_SCRIPTS = {
  "q-hostname": "hostname",
  "q-whoami": "whoami",
  "q-systeminfo": "systeminfo",
  "q-computerinfo": "Get-ComputerInfo | Select-Object CsName,CsManufacturer,CsModel,WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture,@{n='RAM (GB)';e={" + GB("$_.CsTotalPhysicalMemory") + "}},BiosSMBIOSBIOSVersion,TimeZone " + FL,
  "q-os": "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,InstallDate,LastBootUpTime " + FL,
  "q-cpu": "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,@{n='MaxClockMHz';e={$_.MaxClockSpeed}} " + FL,
  "q-ram": [
    "$m = @(Get-CimInstance Win32_PhysicalMemory)",
    "$os = Get-CimInstance Win32_OperatingSystem",
    "'Total installed: ' + " + GB("($m | Measure-Object Capacity -Sum).Sum") + " + ' GB'",
    "'Available now:   ' + [math]::Round($os.FreePhysicalMemory/1MB,1) + ' GB'",
    "$m | Select-Object BankLabel,@{n='GB';e={" + GB("$_.Capacity") + "}},Speed,Manufacturer,PartNumber " + FT
  ].join("\n"),
  "q-gpu": [
    // Win32_VideoController.AdapterRAM is a 32-bit number (stops at 4 GB), so read the real size from the driver key first.
    "$vr = @{}",
    "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11cd-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object {",
    "  $q = $_.'HardwareInformation.qwMemorySize'",
    "  if ($q -is [byte[]]) { $q = [BitConverter]::ToInt64($q, 0) }",
    "  if ($_.DriverDesc -and $q) { $vr[$_.DriverDesc] = [int64]$q }",
    "}",
    "Get-CimInstance Win32_VideoController | ForEach-Object {",
    "  $b = $vr[$_.Name]; if (-not $b) { $b = [int64]$_.AdapterRAM }",
    "  [pscustomobject]@{ Name = $_.Name; 'VRAM (GB)' = " + GB("$b") + "; Driver = $_.DriverVersion; Resolution = ('' + $_.CurrentHorizontalResolution + 'x' + $_.CurrentVerticalResolution) }",
    "} " + FL
  ].join("\n"),
  "q-drives": [
    "Get-CimInstance Win32_DiskDrive | Select-Object Model,@{n='Size (GB)';e={[math]::Round($_.Size/1GB)}},InterfaceType,MediaType " + FT,
    "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3,4 } | Select-Object DeviceID,VolumeName,FileSystem,@{n='Size (GB)';e={[math]::Round($_.Size/1GB)}},@{n='Free (GB)';e={[math]::Round($_.FreeSpace/1GB)}} " + FT
  ].join("\n"),
  // live snapshot: CPU load, memory in use, disks, busiest processes
  "q-resources": [
    "$os = Get-CimInstance Win32_OperatingSystem",
    "$cpu = Get-CimInstance Win32_Processor",
    "$load = [math]::Round(($cpu | Measure-Object LoadPercentage -Average).Average)",
    "$tot = $os.TotalVisibleMemorySize/1MB; $free = $os.FreePhysicalMemory/1MB; $used = $tot - $free",
    "'CPU:    ' + ($cpu | Select-Object -First 1).Name + '  -  ' + $load + '% busy now'",
    "'Memory: ' + [math]::Round($used,1) + ' GB used of ' + [math]::Round($tot,1) + ' GB (' + [math]::Round(100*$used/$tot) + '%), ' + [math]::Round($free,1) + ' GB free'",
    "'Uptime: ' + [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalHours) + ' hours'",
    "''",
    "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | Select-Object DeviceID,@{n='Size (GB)';e={[math]::Round($_.Size/1GB)}},@{n='Free (GB)';e={[math]::Round($_.FreeSpace/1GB)}},@{n='Used %';e={[math]::Round(100*($_.Size-$_.FreeSpace)/$_.Size)}} " + FT,
    "'Busiest programs by memory:'",
    "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 6 ProcessName,@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}} " + FT
  ].join("\n"),
  "q-network-adapters": "Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter } | Select-Object Name,NetConnectionID,MACAddress,NetEnabled " + FT,
  "q-processes": [
    "$p = @(Get-Process)",
    "'Running processes: ' + $p.Count",
    "$p | Sort-Object ProcessName | Select-Object -First 100 ProcessName,Id,@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}} " + FT
  ].join("\n"),
  // current CPU %, from the performance counters (Get-Process only has total CPU time since the process started)
  "q-processes-cpu": [
    "$n = [Environment]::ProcessorCount",
    "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } | Sort-Object PercentProcessorTime -Descending | Select-Object -First 15 Name,IDProcess,@{n='CPU %';e={[math]::Round($_.PercentProcessorTime/$n,1)}},@{n='MemMB';e={[math]::Round($_.WorkingSetPrivate/1MB)}} " + FT
  ].join("\n"),
  "q-processes-cpu-time": "Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 ProcessName,Id,@{n='CPU seconds (total)';e={[math]::Round($_.CPU,1)}},@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}} " + FT,
  "q-processes-ram": "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 15 ProcessName,Id,@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}} " + FT,
  "q-tasklist": "tasklist",
  "q-tasklist-v": "tasklist /v",
  "q-powercfg-list": "powercfg /list",
  "q-powercfg-active": "powercfg /getactivescheme",
  "q-ipconfig": "ipconfig",
  "q-ipconfig-all": "ipconfig /all",
  "q-netstat": "netstat",
  "q-netstat-ano": "netstat -ano"
};

const QUERY_TIMEOUT_MS = 60000, QUERY_MAX_CHARS = 14000, LAUNCH_TIMEOUT_MS = 120000;

/* ---- friendly messages --------------------------------------------------------------------------------- */
const MSG = {
  noApp: "Windows could not find that application.",
  noEdition: "That Windows management tool is not available on this edition of Windows.",
  notWindows: "Launching Windows tools only works on Windows.",
  unknown: "I don't have a Windows tool with that name.",
  uacCancel: "The Windows permission prompt was cancelled, so nothing was started."
};

/* ---- helpers ------------------------------------------------------------------------------------------- */
function runPowerShell(script, env, opts, spawnFn) {
  opts = opts || {};
  return new Promise((resolve) => {
    let child, out = "", err = "", done = false, timedOut = false;
    const t0 = Date.now();
    const finish = (extra) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve(Object.assign({ stdout: out, stderr: err, ms: Date.now() - t0, timedOut }, extra));
    };
    try {
      child = (spawnFn || spawn)("powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", psEncode("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n$ProgressPreference='SilentlyContinue'\n" + script)],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, env || {}) });
    } catch (e) { return resolve({ spawnError: e.message, stdout: "", stderr: "", ms: 0 }); }
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else child.kill("SIGKILL"); } catch (e) {}
      setTimeout(() => finish({ exitCode: null }), 1500);
    }, opts.timeoutMs || LAUNCH_TIMEOUT_MS);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { if (out.length < 400000) out += d; });
    child.stderr.on("data", (d) => { if (err.length < 40000) err += d; });
    child.on("error", (e) => finish({ spawnError: e.message, exitCode: null }));
    child.on("close", (code) => finish({ exitCode: code }));
  });
}

/* Work out what to hand to explorer.exe. Only a drive letter, a known folder, or an existing local folder. */
function explorerTarget(arg, electronApp, fsApi) {
  fsApi = fsApi || fs;
  const a = String(arg == null ? "" : arg).trim();
  if (!a) return { ok: true, args: "", desc: "File Explorer" };

  const drive = a.match(/^([A-Za-z]):\\?$/);
  if (drive) {
    const root = drive[1].toUpperCase() + ":\\";
    let exists = false; try { exists = fsApi.existsSync(root); } catch (e) {}
    if (!exists) return { error: "Drive " + drive[1].toUpperCase() + ": isn't available on this computer (or isn't ready)." };
    return { ok: true, args: root, desc: "drive " + drive[1].toUpperCase() + ":" };
  }

  if (a.charAt(0) === "@") {
    const key = a.slice(1);
    const known = { downloads: "downloads", desktop: "desktop", documents: "documents", pictures: "pictures", music: "music", videos: "videos", home: "home" };
    if (!known[key]) return { error: "I don't know that folder." };
    let dir = "";
    try { dir = electronApp.getPath(known[key]); } catch (e) {}
    if (!dir) return { error: "Windows could not find that folder." };
    return { ok: true, args: quoteIfNeeded(dir), desc: key + " folder" };
  }

  // an absolute local path typed by the user / AI: must be a drive path, free of characters Windows forbids, and an existing DIRECTORY
  if (!/^[A-Za-z]:\\[^<>"|?*\r\n\0]*$/.test(a)) return { error: "That is not a folder path I can open." };
  let dir = path.win32.normalize(a);
  if (!/^[A-Za-z]:\\?$/.test(dir)) dir = dir.replace(/\\+$/, "");
  let isDir = false; try { isDir = fsApi.statSync(dir).isDirectory(); } catch (e) {}
  if (!isDir) return { error: "That folder doesn't exist: " + dir };
  return { ok: true, args: quoteIfNeeded(dir), desc: dir };
}
function quoteIfNeeded(p) { return /\s/.test(p) ? '"' + p + '"' : p; }

/* Turn a registry entry into the environment for LAUNCH_SCRIPT. Returns { env, desc } or { error }. */
function buildLaunch(entry, arg, ctx) {
  const env = { OASIS_FILE: "", OASIS_ARGS: "", OASIS_CHECKFILE: "", OASIS_FINDCMD: "", OASIS_CWD: "", OASIS_ELEVATE: "" };
  switch (entry.kind) {
    case "exe":
      env.OASIS_FILE = entry.file; env.OASIS_ARGS = (entry.args || []).join(" ");
      break;
    case "msc":
      env.OASIS_FILE = entry.file; env.OASIS_CHECKFILE = entry.file;
      break;
    case "cpl":
      env.OASIS_FILE = "control.exe"; env.OASIS_ARGS = entry.file; env.OASIS_CHECKFILE = entry.file;
      break;
    case "control":
      env.OASIS_FILE = "control.exe"; env.OASIS_ARGS = (entry.args || []).join(" ");
      break;
    case "uri":
      if (!/^ms-settings:[a-z0-9-]*$/.test(entry.uri)) return { error: MSG.unknown };
      env.OASIS_FILE = entry.uri;
      break;
    case "shell":
      env.OASIS_FILE = entry.file; env.OASIS_FINDCMD = entry.findCmd || "";
      env.OASIS_CWD = ctx.cwd || os.homedir();
      break;
    case "explorer": {
      const t = explorerTarget(arg, ctx.app, ctx.fs);
      if (t.error) return { error: t.error };
      env.OASIS_FILE = "explorer.exe"; env.OASIS_ARGS = t.args;
      return { env, desc: t.desc };
    }
    case "window": {
      // a visible PowerShell window that runs one FIXED command from the registry and stays open
      const script = entry.command + "\nWrite-Host ''\nWrite-Host 'Finished. You can close this window.'";
      env.OASIS_FILE = "powershell.exe";
      env.OASIS_ARGS = "-NoLogo -NoExit -EncodedCommand " + psEncode(script);
      env.OASIS_ELEVATE = entry.elevate ? "1" : "";
      break;
    }
    default:
      return { error: MSG.unknown };
  }
  return { env, desc: entry.label };
}

function classifyFailure(res, entry) {
  if (res.spawnError) return "PowerShell could not be started: " + res.spawnError;
  if (res.timedOut) return "Windows took too long to respond, so I stopped waiting.";
  const o = String(res.stdout || "").trim();
  if (res.exitCode === 4 || /MISSING_EDITION/.test(o)) return MSG.noEdition;
  if (res.exitCode === 5 || /MISSING_APP/.test(o)) return MSG.noApp;
  if (/canceled by the user|cancelled by the user|operation was canceled/i.test(o)) return MSG.uacCancel;
  if (/cannot find|can't find|not found|could not find|does not exist|cannot be found|system cannot find/i.test(o)) {
    return (entry.kind === "msc" || entry.kind === "cpl") ? MSG.noEdition : MSG.noApp;
  }
  return "Windows could not start " + entry.label + (o ? ": " + o.replace(/^ERR:\s*/, "").slice(0, 300) : ".");
}

/* ---- public API ---------------------------------------------------------------------------------------- */
/* ctx: { app, confirm(text,label)->Promise<boolean>, cwd, platform, spawn, fs }   (everything optional; tests inject fakes) */
async function handleRequest(req, ctx) {
  ctx = ctx || {};
  const platform = ctx.platform || process.platform;
  if (platform !== "win32") return { error: MSG.notWindows };
  const id = String((req && req.id) || "");
  const entry = Object.prototype.hasOwnProperty.call(REG.BY_ID, id) ? REG.BY_ID[id] : null;
  if (!entry) return { error: MSG.unknown };

  if (entry.kind === "query") return runQuery(entry, ctx);

  const built = buildLaunch(entry, req && req.arg, ctx);
  if (built.error) return { error: built.error, id };

  if (entry.confirm) {
    let yes = false;
    try { yes = ctx.confirm ? await ctx.confirm(entry.confirmText || ("Run " + entry.label + "?"), entry.label) : false; } catch (e) { yes = false; }
    if (!yes) return { cancelled: true, id, label: entry.label };
  }

  const res = await runPowerShell(LAUNCH_SCRIPT, built.env, { timeoutMs: LAUNCH_TIMEOUT_MS }, ctx.spawn);
  if (res.exitCode === 0 && !res.timedOut && !res.spawnError) return { ok: true, id, label: entry.label, desc: built.desc };
  return { error: classifyFailure(res, entry), id, label: entry.label };
}

async function runQuery(entry, ctx) {
  const script = QUERY_SCRIPTS[entry.id];
  if (!script) return { error: MSG.unknown };
  const res = await runPowerShell(script, {}, { timeoutMs: QUERY_TIMEOUT_MS }, ctx.spawn);
  if (res.spawnError) return { error: "PowerShell could not be started: " + res.spawnError };
  if (res.timedOut) return { error: "That took longer than a minute, so I stopped it." };
  let out = String(res.stdout || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const errText = String(res.stderr || "").trim();
  let truncated = false;
  if (out.length > QUERY_MAX_CHARS) { out = out.slice(0, QUERY_MAX_CHARS) + "\n…[cut off]"; truncated = true; }
  if (!out && errText) return { error: "Windows reported: " + errText.slice(0, 300) };
  return { ok: true, query: true, id: entry.id, label: entry.label, output: out || "(no output)", truncated, ms: res.ms };
}

module.exports = { handleRequest, buildLaunch, explorerTarget, runPowerShell, LAUNCH_SCRIPT, QUERY_SCRIPTS, MSG, psEncode, classifyFailure };
