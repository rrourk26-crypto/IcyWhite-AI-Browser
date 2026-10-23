/* Oasis Windows launcher registry  (single source of truth)
 *
 * Loaded in TWO places:
 *   - the Home page (index.html, <script src="js/windows-apps.js">) -> window.OasisWin, used to turn what the
 *     user/AI said into a known id, to build the AI prompt, and to show friendly results;
 *   - the main process (windows-launcher.js, require) -> the ONLY place that turns an id into a real command.
 *
 * The AI never supplies a command. It supplies a name or id; the main process looks that id up here.
 * Nothing in this file is executed as shell text: each entry names an executable / file / URI / fixed script.
 *
 * Entry kinds:
 *   exe      Start-Process <file> [args]            (taskmgr.exe, resmon.exe, perfmon.exe /rel, ...)
 *   msc      MMC console in System32                (devmgmt.msc ...) -> "not on this edition" if the file is missing
 *   cpl      Control Panel applet via control.exe   (ncpa.cpl ...)    -> same edition check
 *   control  control.exe <name>                     (control printers)
 *   uri      ms-settings: URI via the shell         (never loaded into a browser tab)
 *   explorer File Explorer, optionally on a drive / known folder / existing folder
 *   shell    cmd / PowerShell / Terminal window
 *   window   fixed command typed into a visible PowerShell window; always asks first (confirm: true)
 *   query    read-only information, fixed PowerShell script, output is shown in the chat
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OasisWin = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const A = []; // all entries, in display order

  /* helper to declare entries compactly */
  function add(group, id, label, kind, spec, aliases, extra) {
    A.push(Object.assign({ id, label, group, kind, aliases: aliases || [] }, spec, extra || {}));
  }

  /* ------------------------------------------------------------------ System & diagnostics */
  add("System & diagnostics", "task-manager", "Task Manager", "exe", { file: "taskmgr.exe" },
    ["taskmgr", "task mgr", "show task manager", "bring up task manager", "show me what's running", "whats running", "what is running", "running programs", "end task", "ctrl shift esc"]);
  add("System & diagnostics", "resource-monitor", "Resource Monitor", "exe", { file: "resmon.exe" },
    ["resmon", "resources monitor", "memory usage monitor", "disk usage monitor"]);
  add("System & diagnostics", "performance-monitor", "Performance Monitor", "exe", { file: "perfmon.exe" },
    ["perfmon", "perf monitor", "performance counters"]);
  add("System & diagnostics", "reliability-monitor", "Reliability Monitor", "exe", { file: "perfmon.exe", args: ["/rel"] },
    ["reliability history", "perfmon rel", "perfmon /rel", "stability monitor", "reliability"]);
  add("System & diagnostics", "system-diagnostics", "System Diagnostics report", "exe", { file: "perfmon.exe", args: ["/report"] },
    ["perfmon report", "perfmon /report", "system diagnostics report", "diagnostics report", "run system diagnostics", "system diagnostics"]);
  add("System & diagnostics", "performance-monitor-system", "Performance Monitor (system view)", "exe", { file: "perfmon.exe", args: ["/sys"] },
    ["perfmon sys", "perfmon /sys", "performance monitor system", "performance system view"]);
  add("System & diagnostics", "performance-monitor-resources", "Performance Monitor (resource view)", "exe", { file: "perfmon.exe", args: ["/res"] },
    ["perfmon res", "perfmon /res", "performance monitor resource view", "performance resource view"]);
  add("System & diagnostics", "system-information", "System Information", "exe", { file: "msinfo32.exe" },
    ["msinfo32", "msinfo", "system info", "computer information", "computer info", "show my computer specs", "my computer specs", "computer specs", "show my hardware", "my hardware", "pc specs", "show my specs", "hardware info"]);
  add("System & diagnostics", "directx-diagnostic", "DirectX Diagnostic Tool", "exe", { file: "dxdiag.exe" },
    ["dxdiag", "directx diagnostic", "directx diagnostics", "directx", "direct x", "directx diag"]);
  add("System & diagnostics", "windows-version", "Windows Version", "exe", { file: "winver.exe" },
    ["winver", "about windows", "which windows", "windows build"]);

  /* ------------------------------------------------------------------ Windows management (MMC) */
  add("Windows management", "computer-management", "Computer Management", "msc", { file: "compmgmt.msc" },
    ["compmgmt", "computer manager", "computer mgmt"]);
  add("Windows management", "device-manager", "Device Manager", "msc", { file: "devmgmt.msc" },
    ["devmgmt", "devices manager", "hardware manager", "hardware devices", "driver manager", "drivers manager"]);
  add("Windows management", "disk-management", "Disk Management", "msc", { file: "diskmgmt.msc" },
    ["diskmgmt", "disk manager", "partition manager", "manage disks", "manage drives", "partitions", "disk partitions"]);
  add("Windows management", "event-viewer", "Event Viewer", "msc", { file: "eventvwr.msc" },
    ["eventvwr", "event logs", "windows logs", "system logs", "event log", "view event logs"]);
  add("Windows management", "services", "Services", "msc", { file: "services.msc" },
    ["windows services", "services console", "service manager", "services manager"]);
  add("Windows management", "task-scheduler", "Task Scheduler", "msc", { file: "taskschd.msc" },
    ["taskschd", "scheduled tasks", "schedule tasks", "task schedule"]);
  add("Windows management", "shared-folders", "Shared Folders", "msc", { file: "fsmgmt.msc" },
    ["fsmgmt", "shares", "network shares", "file shares", "shared folder"]);
  add("Windows management", "local-users-groups", "Local Users and Groups", "msc", { file: "lusrmgr.msc" },
    ["lusrmgr", "local users", "local groups", "users and groups", "local user manager"]);
  add("Windows management", "local-security-policy", "Local Security Policy", "msc", { file: "secpol.msc" },
    ["secpol", "security policy"]);
  add("Windows management", "group-policy-editor", "Local Group Policy Editor", "msc", { file: "gpedit.msc" },
    ["gpedit", "group policy", "group policy editor", "local group policy"]);
  add("Windows management", "certificate-manager", "Certificate Manager", "msc", { file: "certmgr.msc" },
    ["certmgr", "certificates", "certificate manager", "certs", "my certificates"]);
  add("Windows management", "wmi-control", "WMI Control", "msc", { file: "wmimgmt.msc" },
    ["wmimgmt", "wmi", "wmi management"]);

  /* ------------------------------------------------------------------ Storage */
  add("Storage", "disk-cleanup", "Disk Cleanup", "exe", { file: "cleanmgr.exe" },
    ["cleanmgr", "clean up disk", "clean disk", "free up space", "free disk space", "clean up my drive"]);
  add("Storage", "optimize-drives", "Optimize Drives (defrag)", "exe", { file: "dfrgui.exe" },
    ["dfrgui", "defrag", "defragment", "defragmenter", "disk defragmenter", "optimize drives", "optimise drives", "defrag drives", "trim drives"]);

  /* ------------------------------------------------------------------ Network & internet */
  add("Network", "network-connections", "Network Connections", "cpl", { file: "ncpa.cpl" },
    ["ncpa", "network adapters", "adapter settings", "network adapter settings", "change adapter options"]);
  add("Network", "windows-firewall", "Windows Firewall (advanced)", "msc", { file: "wf.msc" },
    ["wf", "firewall", "firewall advanced", "advanced firewall", "windows defender firewall", "defender firewall"]);
  add("Network", "internet-properties", "Internet Properties", "cpl", { file: "inetcpl.cpl" },
    ["inetcpl", "internet options", "internet settings classic", "proxy settings classic"]);

  /* ------------------------------------------------------------------ Hardware & devices */
  add("Hardware", "sound-control-panel", "Sound (classic panel)", "cpl", { file: "mmsys.cpl" },
    ["mmsys", "sound control panel", "classic sound", "sound panel", "sound devices", "playback devices", "recording devices", "audio devices"]);
  add("Hardware", "game-controllers", "Game Controllers", "cpl", { file: "joy.cpl" },
    ["joystick", "gamepad", "game controller", "controllers", "joystick settings"]);
  add("Hardware", "printers", "Printers", "control", { file: "control.exe", args: ["printers"] },
    ["printer", "devices and printers", "printers and devices", "control printers"]);
  add("Hardware", "display-properties", "Display (classic panel)", "cpl", { file: "desk.cpl" },
    ["display control panel", "classic display", "display properties", "screen resolution classic"]);
  add("Hardware", "mouse", "Mouse", "cpl", { file: "main.cpl" },
    ["mouse settings classic", "mouse properties", "mouse control panel", "mouse pointer settings"]);

  /* ------------------------------------------------------------------ Accounts */
  add("Accounts", "user-accounts", "User Accounts (netplwiz)", "exe", { file: "netplwiz.exe" },
    ["netplwiz", "user accounts classic", "autologin", "auto login", "user accounts advanced", "control userpasswords2", "userpasswords2"]);

  /* ------------------------------------------------------------------ Display / personalization */
  add("Display & system", "color-management", "Color Management", "exe", { file: "colorcpl.exe" },
    ["colorcpl", "colour management", "icc profiles", "color profiles", "colour profiles"]);
  add("Display & system", "system-properties", "System Properties", "cpl", { file: "sysdm.cpl" },
    ["sysdm", "advanced system settings", "system settings advanced", "computer properties", "environment variables", "performance options", "remote settings", "system protection"]);

  /* ------------------------------------------------------------------ Classic Control Panel */
  add("Control Panel", "control-panel", "Control Panel", "exe", { file: "control.exe" },
    ["control", "control.exe", "classic control panel", "open control panel"]);
  add("Control Panel", "programs-features", "Programs and Features", "cpl", { file: "appwiz.cpl" },
    ["appwiz", "uninstall programs", "uninstall a program", "add remove programs", "add or remove programs", "installed programs", "programs and features"]);
  add("Control Panel", "date-time", "Date and Time", "cpl", { file: "timedate.cpl" },
    ["timedate", "date and time", "date & time", "clock settings", "time and date", "change the time", "change the date"]);
  add("Control Panel", "region", "Region", "cpl", { file: "intl.cpl" },
    ["regional settings", "region settings", "regional options", "region and language classic"]);
  add("Control Panel", "power-options", "Power Options", "cpl", { file: "powercfg.cpl" },
    ["powercfg", "power plan", "power plans", "power settings", "power and sleep classic", "battery plan", "sleep settings classic"]);

  /* ------------------------------------------------------------------ Everyday apps */
  add("Apps", "calculator", "Calculator", "exe", { file: "calc.exe" }, ["calc", "windows calculator"]);
  add("Apps", "notepad", "Notepad", "exe", { file: "notepad.exe" }, ["note pad", "text editor", "windows notepad"]);
  add("Apps", "paint", "Paint", "exe", { file: "mspaint.exe" }, ["mspaint", "ms paint", "microsoft paint"]);

  /* ------------------------------------------------------------------ Command-line tools (open a window) */
  add("Command-line tools", "command-prompt", "Command Prompt", "shell", { file: "cmd.exe", findCmd: "cmd.exe" },
    ["cmd", "cmd.exe", "command prompt", "dos prompt", "command line"]);
  add("Command-line tools", "powershell", "Windows PowerShell", "shell", { file: "powershell.exe", findCmd: "powershell.exe" },
    ["powershell", "powershell.exe", "power shell", "windows powershell"]);
  add("Command-line tools", "powershell-7", "PowerShell 7 (pwsh)", "shell", { file: "pwsh.exe", findCmd: "pwsh.exe" },
    ["pwsh", "pwsh.exe", "powershell 7", "powershell core", "ps7"]);
  add("Command-line tools", "windows-terminal", "Windows Terminal", "shell", { file: "wt.exe", findCmd: "wt.exe" },
    ["wt", "wt.exe", "terminal", "windows terminal", "new terminal"]);
  add("Command-line tools", "registry-editor", "Registry Editor", "exe", { file: "regedit.exe" },
    ["regedit", "regedit.exe", "registry", "edit the registry", "windows registry"], { confirm: true,
      confirmText: "Registry Editor lets you change settings that Windows and your programs depend on. Open it?" });
  add("Command-line tools", "system-configuration", "System Configuration (msconfig)", "exe", { file: "msconfig.exe" },
    ["msconfig", "msconfig.exe", "system config", "boot options", "startup configuration", "boot config"], { confirm: true,
      confirmText: "System Configuration can change how Windows starts. Open it?" });

  /* ------------------------------------------------------------------ Windows Settings (ms-settings: URIs) */
  const S = (id, label, uri, aliases) => add("Windows Settings", id, label, "uri", { uri }, aliases);
  S("settings", "Windows Settings", "ms-settings:", ["settings app", "windows settings", "pc settings", "open settings", "system settings"]);
  S("settings-display", "Display settings", "ms-settings:display", ["display", "display settings", "screen settings", "monitor settings", "screen resolution", "resolution", "refresh rate", "scaling", "multiple displays"]);
  S("settings-sound", "Sound settings", "ms-settings:sound", ["sound", "sound settings", "volume settings", "audio settings", "audio"]);
  S("settings-network", "Network & Internet settings", "ms-settings:network", ["network settings", "network and internet", "internet settings", "wifi settings", "wi-fi settings", "network status", "wifi"]);
  S("settings-bluetooth", "Bluetooth & devices", "ms-settings:bluetooth", ["bluetooth", "bluetooth settings", "bluetooth and devices", "pair a device", "add bluetooth device"]);
  S("settings-camera", "Camera settings", "ms-settings:camera", ["camera", "camera settings", "webcam settings", "webcam"]);
  S("settings-devices", "Devices settings", "ms-settings:devices", ["devices", "devices settings", "device settings"]);
  S("settings-usb", "USB settings", "ms-settings:usb", ["usb", "usb settings"]);
  S("settings-accounts", "Accounts settings", "ms-settings:accounts", ["accounts", "account settings", "accounts settings"]);
  S("settings-your-info", "Your info", "ms-settings:yourinfo", ["your info", "my account info", "account info", "yourinfo"]);
  S("settings-sign-in", "Sign-in options", "ms-settings:signinoptions", ["sign in options", "signin options", "sign-in options", "password settings", "windows hello", "pin settings", "change my password", "change password"]);
  S("settings-email-accounts", "Email & accounts", "ms-settings:emailandaccounts", ["email and accounts", "email accounts", "email & accounts"]);
  S("settings-other-users", "Other users", "ms-settings:otherusers", ["other users", "family and other users", "add a user", "add user", "add another user"]);
  S("settings-apps", "Installed apps", "ms-settings:appsfeatures", ["apps and features", "apps & features", "installed apps", "apps settings", "uninstall apps", "uninstall an app", "manage apps"]);
  S("settings-default-apps", "Default apps", "ms-settings:defaultapps", ["default apps", "default programs", "default browser", "change default apps"]);
  S("settings-startup-apps", "Startup apps", "ms-settings:startupapps", ["startup apps", "startup programs", "startup items", "apps that start with windows", "programs that run at startup", "startup"]);
  S("settings-optional-features", "Optional features", "ms-settings:optionalfeatures", ["optional features", "windows features", "turn windows features on or off", "optional windows features"]);
  S("settings-windows-update", "Windows Update", "ms-settings:windowsupdate", ["windows update", "updates", "check for updates", "windows updates", "update windows", "system updates"]);
  S("settings-storage", "Storage settings (Storage Sense)", "ms-settings:storagesense", ["storage settings", "storage sense", "storage", "disk space settings", "how much storage"]);
  S("settings-personalization", "Personalization", "ms-settings:personalization", ["personalization", "personalisation", "personalize", "personalize windows", "customize windows"]);
  S("settings-themes", "Themes", "ms-settings:themes", ["themes", "windows themes", "change theme", "change my theme"]);
  S("settings-fonts", "Fonts", "ms-settings:fonts", ["fonts", "font settings", "install fonts", "manage fonts"]);
  S("settings-colors", "Colors", "ms-settings:colors", ["colors", "colours", "color settings", "accent color", "dark mode", "light mode", "colour settings"]);
  S("settings-night-light", "Night light", "ms-settings:nightlight", ["night light", "nightlight", "blue light filter", "night mode"]);
  S("settings-windows-security", "Windows Security", "ms-settings:windowsdefender", ["windows security", "windows defender", "defender", "antivirus", "virus protection", "security settings", "virus and threat protection"]);

  /* ------------------------------------------------------------------ File Explorer (special: optional target) */
  A.push({ id: "file-explorer", label: "File Explorer", group: "File Explorer", kind: "explorer",
    aliases: ["explorer", "explorer.exe", "files", "my files", "file manager", "windows explorer", "this pc", "my computer", "file browser"] });

  /* ------------------------------------------------------------------ Read-only information (shown in the chat) */
  const Q = (id, label, aliases, extra) => add("Information", id, label, "query", {}, aliases, extra);
  Q("q-hostname", "Computer name", ["hostname", "computer name", "pc name", "whats my computer name", "what's my computer name", "what is my computer name", "machine name", "device name"]);
  Q("q-whoami", "Current user (whoami)", ["whoami", "who am i", "current user", "my username", "what user am i", "which user am i"]);
  Q("q-systeminfo", "systeminfo", ["systeminfo", "full system info", "system info report", "detailed system information"], { slow: true });
  Q("q-computerinfo", "Computer summary", ["get-computerinfo", "computerinfo", "computer summary", "pc summary", "about my computer", "about my pc", "summarize my pc", "tell me about my computer"]);
  Q("q-os", "Windows version & build", ["os version", "windows version info", "what version of windows", "what version of windows am i running", "which version of windows", "what windows version", "what windows do i have", "windows edition", "my windows version", "operating system"]);
  Q("q-cpu", "CPU", ["cpu", "processor", "what cpu do i have", "what processor do i have", "my cpu", "my processor", "cpu info", "processor info", "cpu model"]);
  Q("q-ram", "RAM", ["ram", "memory", "how much ram do i have", "how much memory do i have", "my ram", "ram info", "memory info", "installed ram", "physical memory", "how much ram"]);
  Q("q-gpu", "GPU & video memory", ["gpu", "graphics card", "video card", "what gpu do i have", "what graphics card do i have", "my gpu", "vram", "how much vram do i have", "how much vram", "video memory", "graphics info", "gpu info"]);
  Q("q-drives", "Drives & disks", ["drives", "disks", "what drives do i have", "my drives", "disk drives", "storage devices", "hard drives", "how much disk space do i have", "disk space", "free disk space info", "list drives", "list my drives"]);
  Q("q-network-adapters", "Network adapters", ["network adapter info", "list network adapters", "network cards", "nic info", "my network adapters"]);
  Q("q-processes", "Running processes", ["processes", "show running processes", "running processes", "what programs are running", "what programs are running right now", "list processes", "list running processes", "get-process", "show processes", "what processes are running", "what apps are running"], { alsoOpen: "task-manager" });
  Q("q-resources", "System resources (CPU, memory, disk)", ["system resources", "show system resources", "my system resources", "check system resources", "resources", "resource usage", "show resource usage", "show me resource usage", "system usage", "system performance", "how is my pc doing", "how is my computer doing", "how is my cpu doing", "cpu usage", "cpu and ram usage", "ram usage", "memory usage", "how much ram am i using", "how much memory am i using", "how much cpu am i using", "how much cpu is being used", "how much ram is being used", "pc performance", "computer performance", "system load"], { alsoOpen: "resource-monitor" });
  Q("q-processes-cpu", "Top processes by CPU (right now)", ["whats using the most cpu", "what's using the most cpu", "what is using the most cpu", "top cpu", "top cpu processes", "cpu hogs", "what is using my cpu", "whats using my cpu", "highest cpu", "most cpu"], { alsoOpen: "task-manager" });
  Q("q-processes-cpu-time", "Top processes by total CPU time", ["processes by cpu time", "total cpu time", "cpu time by process", "sort processes by cpu"]);
  Q("q-processes-ram", "Top processes by RAM", ["whats using the most ram", "what's using the most ram", "what is using the most ram", "whats using the most memory", "what's using the most memory", "top ram", "top ram processes", "memory hogs", "what is using my ram", "whats using my ram", "highest memory", "most ram", "most memory"], { alsoOpen: "task-manager" });
  Q("q-tasklist", "tasklist", ["tasklist", "task list"]);
  Q("q-tasklist-v", "tasklist /v (verbose)", ["tasklist /v", "tasklist verbose", "verbose task list", "verbose tasklist"]);
  Q("q-powercfg-list", "Power plans (powercfg /list)", ["powercfg /list", "powercfg list", "list power plans", "list power schemes", "power schemes"]);
  Q("q-powercfg-active", "Active power plan", ["powercfg /getactivescheme", "powercfg getactivescheme", "active power plan", "current power plan", "what power plan am i on", "which power plan"]);
  Q("q-ipconfig", "IP configuration (ipconfig)", ["ipconfig", "ip config", "my ip", "my ip address", "what is my ip", "whats my ip", "what's my ip", "what is my ip address", "local ip", "ip address"]);
  Q("q-ipconfig-all", "IP configuration, full (ipconfig /all)", ["ipconfig /all", "ipconfig all", "full ip config", "detailed ip config", "mac address", "my mac address", "dns servers", "what dns am i using"]);
  Q("q-netstat", "Network connections (netstat)", ["netstat", "network connections list", "active connections", "list connections"]);
  Q("q-netstat-ano", "Network connections with PIDs (netstat -ano)", ["netstat -ano", "netstat ano", "connections with pids", "which program is using the network", "listening ports", "open ports", "what ports are open"]);

  /* ------------------------------------------------------------------ Maintenance / changes (always ask first) */
  const W = (id, label, aliases, spec, confirmText) => add("Maintenance", id, label, "window", spec, aliases, { confirm: true, confirmText });
  W("sfc-scannow", "System File Checker (sfc /scannow)", ["sfc", "sfc /scannow", "sfc scannow", "run sfc", "system file checker", "scan system files", "check system files", "repair system files"],
    { command: "sfc /scannow", elevate: true },
    "This will run Windows System File Checker (sfc /scannow) and may take several minutes. It needs administrator permission.");
  W("dism-restorehealth", "DISM RestoreHealth", ["dism", "dism /online /cleanup-image /restorehealth", "dism restorehealth", "run dism", "repair windows image", "restore health", "repair windows"],
    { command: "DISM /Online /Cleanup-Image /RestoreHealth", elevate: true },
    "This will run DISM /Online /Cleanup-Image /RestoreHealth to repair the Windows component store. It can take a long time and needs administrator permission.");
  W("chkdsk", "Check Disk (chkdsk, read-only scan)", ["chkdsk", "check disk", "run chkdsk", "check my disk", "check my drive for errors", "disk check", "scan disk for errors"],
    { command: "chkdsk", elevate: true },
    "This will run chkdsk on the current drive in read-only mode (it reports problems but does not fix them). It needs administrator permission.");
  W("ipconfig-flushdns", "Flush DNS cache (ipconfig /flushdns)", ["ipconfig /flushdns", "flush dns", "flushdns", "clear dns cache", "flush the dns cache", "reset dns cache"],
    { command: "ipconfig /flushdns", elevate: true },
    "This will clear the Windows DNS resolver cache (ipconfig /flushdns). It needs administrator permission.");
  W("ipconfig-release", "Release IP address (ipconfig /release)", ["ipconfig /release", "release ip", "release my ip", "release ip address"],
    { command: "ipconfig /release", elevate: true },
    "This will release your IP address (ipconfig /release). You will lose your network connection until it is renewed.");
  W("ipconfig-renew", "Renew IP address (ipconfig /renew)", ["ipconfig /renew", "renew ip", "renew my ip", "renew ip address"],
    { command: "ipconfig /renew", elevate: true },
    "This will renew your IP address (ipconfig /renew). Your network may drop for a moment.");
  W("powercfg-batteryreport", "Battery report (powercfg /batteryreport)", ["powercfg /batteryreport", "battery report", "batteryreport", "battery health report", "battery health"],
    { command: "powercfg /batteryreport /output \"$env:USERPROFILE\\Documents\\battery-report.html\"; Write-Host ''; Write-Host 'Saved to your Documents folder as battery-report.html'", elevate: false },
    "This will create battery-report.html in your Documents folder (powercfg /batteryreport).");
  W("powercfg-energy", "Energy report (powercfg /energy)", ["powercfg /energy", "energy report", "power efficiency report", "power efficiency diagnostics", "run powercfg energy"],
    { command: "powercfg /energy /output \"$env:USERPROFILE\\Documents\\energy-report.html\"; Write-Host ''; Write-Host 'Saved to your Documents folder as energy-report.html'", elevate: true },
    "This will run powercfg /energy, which watches your system for about 60 seconds and writes energy-report.html to your Documents folder. It needs administrator permission.");

  /* ------------------------------------------------------------------ Known folders + web targets used by explorer/links */
  const KNOWN_FOLDERS = {
    downloads: "downloads", download: "downloads", "downloads folder": "downloads",
    desktop: "desktop", "my desktop": "desktop",
    documents: "documents", "my documents": "documents", docs: "documents",
    pictures: "pictures", photos: "pictures", "my pictures": "pictures",
    music: "music", "my music": "music",
    videos: "videos", "my videos": "videos",
    "home folder": "home", "my home folder": "home", "user folder": "home"
  };

  /* Ambiguous names: ask instead of guessing. Each value is a list of ids. */
  const AMBIGUOUS = {
    "performance": ["task-manager", "resource-monitor", "performance-monitor"],
    "monitor": ["task-manager", "resource-monitor", "performance-monitor"],
    "system monitor": ["task-manager", "resource-monitor", "performance-monitor"],
    "monitoring": ["task-manager", "resource-monitor", "performance-monitor"],
    "system tools": ["task-manager", "resource-monitor", "device-manager", "event-viewer"],
    "system utilities": ["task-manager", "resource-monitor", "device-manager", "event-viewer"],
    "diagnostics": ["system-diagnostics", "directx-diagnostic", "system-information"],
    "network tools": ["network-connections", "windows-firewall", "settings-network"],
    "network": ["network-connections", "settings-network", "windows-firewall"],
    "internet": ["internet-properties", "settings-network"],
    "management": ["computer-management", "device-manager", "disk-management", "services"],
    "manager": ["task-manager", "device-manager", "disk-management", "computer-management"],
    "users": ["local-users-groups", "user-accounts", "settings-other-users"],
    "security": ["settings-windows-security", "windows-firewall", "local-security-policy"],
    "firewall settings": ["windows-firewall", "settings-windows-security"],
    "system": ["system-properties", "system-information", "settings"],
    "policy": ["local-security-policy", "group-policy-editor"],
    "disk": ["disk-management", "disk-cleanup", "optimize-drives"],
    "disk tools": ["disk-management", "disk-cleanup", "optimize-drives"]
  };

  /* ---------------------------------------------------------------- indexes */
  const BY_ID = Object.create(null);
  A.forEach((e) => { BY_ID[e.id] = e; });

  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = (t) => String(t || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9:'\/\-. ]+/g, " ").replace(/\s+/g, " ").trim();

  // Exact-name index: normalized id / label / alias -> entry. Ids and labels are registered first so an
  // alias on one entry can never steal another entry's own name; among aliases the first declaration wins
  // (so "display" stays the modern Settings page; "classic display" reaches desk.cpl).
  const NAME = Object.create(null);
  const putName = (key, e) => { const k = norm(key); if (k && !NAME[k]) NAME[k] = e; };
  A.forEach((e) => { putName(e.id, e); putName(e.label, e); });
  A.forEach((e) => {
    (e.aliases || []).forEach((a) => putName(a, e));
    if (e.file && !e.args && e.kind !== "shell") putName(e.file, e);    // "ncpa.cpl", "devmgmt.msc", "taskmgr.exe"
  });

  /* Words that don't change what's meant. */
  const FILLER_PREFIX = /^(?:(?:hey|hi|ok|okay|so|please|pls|can you|could you|would you|will you|can we|could we|let's|lets|let us|i want to|i wanna|i'd like to|id like to|i would like to|i need to|i need|take me to|show me|bring up|pull up|fire up|go to|launch|open up|open|start|run|show|display|load|view|check|see|look at)\s+)+/i;
  const FILLER_SUFFIX = /(?:\s+(?:app|application|tool|utility|console|window|please|pls|for me|now|again|real quick|thanks|thank you|program|panel|page))+$/i;
  const FILLER_ARTICLE = /^(?:the|a|an|my|windows|microsoft|native)\s+/i;

  /* Strip politeness + the verb. Returns { keep, bare }: `keep` still has leading articles ("my hardware"),
     `bare` has them removed ("hardware"). Both are tried against the name index. */
  function cleanBoth(text) {
    let t = words(text).replace(/[.!?]+$/g, "").trim();
    t = t.replace(FILLER_PREFIX, "").replace(FILLER_SUFFIX, "").trim();
    const keep = t.replace(/^(?:the|a|an)\s+/i, "").trim();
    const bare = keep.replace(FILLER_ARTICLE, "").replace(FILLER_ARTICLE, "").trim();
    return { keep, bare };
  }
  function clean(text) { return cleanBoth(text).bare; }

  /* "D drive", "d:", "my D: drive", "drive d" -> "D:" */
  function driveFrom(t) {
    let m = t.match(/^(?:the\s+|my\s+)?([a-z])\s*:?\s*(?:drive|disk|volume|partition)$/i) ||
            t.match(/^(?:drive|disk|volume)\s+([a-z])\s*:?$/i) ||
            t.match(/^([a-z]):\\?$/i);
    return m ? m[1].toUpperCase() + ":" : null;
  }

  /* Resolve what someone said into: { ok:true, id, arg? } | { ambiguous:[ids] } | null.
     `strict` (used for text the user typed with no AI tag) only accepts exact names, so ordinary chat is
     never mistaken for a launch request. Tags written by the AI also allow a few extra loose matches. */
  function resolve(text, opts) {
    opts = opts || {};
    const raw = String(text || "").trim();
    if (!raw || raw.length > 120) return null;
    const both = cleanBoth(raw), t = both.bare;
    if (!t) return null;

    // File Explorer targets
    const d = driveFrom(t) || driveFrom(both.keep);
    if (d) return { id: "file-explorer", arg: d };
    const ex = both.bare.match(/^(?:file explorer|explorer|files|file manager)\s*(?:to|at|in|on)?\s+(.+)$/i);
    if (ex) {
      const inner = clean(ex[1]);
      const dd = driveFrom(inner);
      if (dd) return { id: "file-explorer", arg: dd };
      if (KNOWN_FOLDERS[inner]) return { id: "file-explorer", arg: "@" + KNOWN_FOLDERS[inner] };
      if (/^[a-z]:\\/i.test(ex[1].trim())) return { id: "file-explorer", arg: ex[1].trim() };
    }
    const kf = t.replace(/\s+folder$/, "");
    if (KNOWN_FOLDERS[t] || KNOWN_FOLDERS[kf]) return { id: "file-explorer", arg: "@" + (KNOWN_FOLDERS[t] || KNOWN_FOLDERS[kf]) };
    const pathTry = raw.replace(FILLER_PREFIX, "").replace(/^["']|["']$/g, "").trim();
    if (/^[a-z]:\\[^<>"|?*]*$/i.test(pathTry)) return { id: "file-explorer", arg: pathTry };

    // a literal ms-settings: URI that is in the registry
    if (/^ms-settings:[a-z0-9-]*$/i.test(raw.replace(FILLER_PREFIX, "").trim())) {
      const u = raw.replace(FILLER_PREFIX, "").trim().toLowerCase();
      const e = A.find((x) => x.kind === "uri" && x.uri === u);
      return e ? { id: e.id } : null;
    }

    // exact names / aliases (with and without the leading "my"/"the"/"windows")
    const hit = NAME[norm(both.keep)] || NAME[norm(t)] || NAME[norm(words(raw).replace(/[.!?]+$/g, ""))];
    if (hit) return { id: hit.id };

    // umbrella words that could mean several tools: ask instead of guessing
    if (AMBIGUOUS[t]) return { ambiguous: AMBIGUOUS[t].slice() };
    if (AMBIGUOUS[both.keep]) return { ambiguous: AMBIGUOUS[both.keep].slice() };

    if (opts.strict) return null;

    // loose (AI-written tags only): longest alias contained in the phrase, but never a very short one
    const n = norm(t);
    let best = null, bestLen = 0;
    for (const e of A) {
      const keys = [e.id, e.label].concat(e.aliases || []);
      for (const k of keys) { const kk = norm(k); if (kk.length >= 6 && n.includes(kk) && kk.length > bestLen) { best = e; bestLen = kk.length; } }
    }
    return best ? { id: best.id } : null;
  }

  /* Short, friendly list for the AI prompt (names only; ids are accepted too). */
  function promptList() {
    const groups = [];
    const seen = Object.create(null);
    A.forEach((e) => {
      if (e.kind === "query" || e.kind === "window" || e.kind === "explorer") return;
      if (!seen[e.group]) { seen[e.group] = []; groups.push(e.group); }
      seen[e.group].push(e.id);
    });
    return groups.map((g) => g + ": " + seen[g].join(", ")).join("\n");
  }
  const ids = (kind) => A.filter((e) => e.kind === kind).map((e) => e.id);

  function labelOf(id) { return BY_ID[id] ? BY_ID[id].label : id; }
  function joinOr(list) { return list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + (list.length > 2 ? "," : "") + " or " + list[list.length - 1]; }

  return {
    ENTRIES: A, BY_ID, KNOWN_FOLDERS, AMBIGUOUS,
    resolve, clean, cleanBoth, driveFrom, promptList, ids, labelOf, joinOr, norm
  };
});
