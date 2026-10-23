/* llama-manager.js — runs llama.cpp's llama-server for the Oasis app (main process only).
 *
 * What it does
 *   - finds llama-server(.exe) and your .gguf model files (several places, see findBinary / modelsDirs)
 *   - starts it on 127.0.0.1 with the model you picked, waits until /health says it is ready
 *   - exposes an OpenAI-compatible API at  http://127.0.0.1:<port>/v1  — the same kind of address LM Studio uses,
 *     so the chat code does not need to know the difference
 *   - stops it (whole process tree) when you press Stop or quit the app
 *
 * Plain Node, no Electron imports, so it can be tested anywhere:  node --test tests/llama-manager.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const os = require("os");
const { spawn, execFile } = require("child_process");
const { createProxy } = require("./cors-proxy.js");
const mem = require("./llama-memory.js");

const DEFAULTS = { modelsDir: "", binPath: "", runtime: "auto", runtimesDir: "", model: "", ctx: 8192, ngl: 99, port: 8080, extraArgs: "", autoStart: false,
  host: "127.0.0.1", cors: "all", corsOrigins: "", apiKey: "", opts: {} };

/* Every extra llama-server setting shown in Settings > Local model. The Settings screen is drawn from this list, and
 * the same list turns the choices into command-line flags, so adding one more setting = adding one line here.
 *   type "num"    a number (float:true allows decimals)           -> [flag, value]
 *   type "select" one of the listed choices                        -> [flag, value]
 *   type "text"   free text                                        -> [flag, value]
 *   type "toggle" Default / On / Off; `on` and `off` are the flags passed (a missing one means "pass nothing")
 * An empty value always means "Default": nothing is passed and llama-server uses its own default. */
const OPTION_DEFS = [
  // ---- Server ----
  { key: "parallel", group: "server", label: "Parallel requests (slots)", type: "num", flag: "-np", min: 1, max: 256, hint: "How many chats the server can answer at once. The context size is shared between them." },
  { key: "timeout", group: "server", label: "Request timeout (seconds)", type: "num", flag: "--timeout", min: 1, max: 86400, hint: "llama-server default: 600." },
  { key: "threadsHttp", group: "server", label: "HTTP threads", type: "num", flag: "--threads-http", min: 1, max: 512 },
  { key: "webui", group: "server", label: "llama.cpp's own web page", type: "toggle", on: ["--webui"], off: ["--no-webui"], hint: "The built-in chat page at the server address, for other devices on your network." },
  { key: "metrics", group: "server", label: "Metrics page (/metrics)", type: "toggle", on: ["--metrics"] },
  { key: "slots", group: "server", label: "Slots page (/slots)", type: "toggle", on: ["--slots"], off: ["--no-slots"] },
  { key: "embeddings", group: "server", label: "Embeddings endpoint", type: "toggle", on: ["--embeddings"], hint: "Lets other programs use this model for embeddings (only if the model supports it)." },
  { key: "jinja", group: "server", label: "Model chat template (Jinja)", type: "toggle", on: ["--jinja"], off: ["--no-jinja"], defaults: ["--jinja"], hint: "Default: On. Needed for tool calling. Turn off only for models that fail to load with it." },
  { key: "chatTemplate", group: "server", label: "Chat template override", type: "text", flag: "--chat-template", placeholder: "e.g. chatml, llama3, gemma", hint: "Leave empty to use the template stored in the model." },
  { key: "reasoningFormat", group: "server", label: "Reasoning (<think>) format", type: "select", flag: "--reasoning-format", choices: [["none", "none (keep in the reply)"], ["deepseek", "deepseek (separate field)"], ["auto", "auto"]] },
  { key: "thinking", group: "server", label: "Thinking models", type: "toggle", on: ["--reasoning-budget", "-1"], off: ["--reasoning-budget", "0"], hint: "Off = skip the thinking step (faster). Default = the model decides." },
  // ---- Performance & memory ----
  { key: "batch", group: "perf", label: "Batch size", type: "num", flag: "-b", min: 1, max: 65536, hint: "Default 2048." },
  { key: "ubatch", group: "perf", label: "Micro-batch size", type: "num", flag: "-ub", min: 1, max: 65536, hint: "Default 512. Lower it if you run out of GPU memory." },
  { key: "threads", group: "perf", label: "CPU threads", type: "num", flag: "-t", min: 1, max: 512, hint: "Default: automatic." },
  { key: "threadsBatch", group: "perf", label: "CPU threads (prompt processing)", type: "num", flag: "-tb", min: 1, max: 512 },
  { key: "flashAttn", group: "perf", label: "Flash attention", type: "select", flag: "-fa", choices: [["auto", "auto"], ["on", "on"], ["off", "off"]], hint: "Faster and uses less memory on most GPUs. Needed for a quantized V cache." },
  { key: "cacheTypeK", group: "perf", label: "KV cache type (keys)", type: "select", flag: "-ctk", choices: [["f16", "f16 (default)"], ["bf16", "bf16"], ["q8_0", "q8_0 (half the memory)"], ["q5_1", "q5_1"], ["q5_0", "q5_0"], ["q4_1", "q4_1"], ["q4_0", "q4_0 (smallest)"]] },
  { key: "cacheTypeV", group: "perf", label: "KV cache type (values)", type: "select", flag: "-ctv", choices: [["f16", "f16 (default)"], ["bf16", "bf16"], ["q8_0", "q8_0 (half the memory)"], ["q5_1", "q5_1"], ["q5_0", "q5_0"], ["q4_1", "q4_1"], ["q4_0", "q4_0 (smallest)"]], hint: "Anything but f16 needs Flash attention on." },
  { key: "kvOffload", group: "perf", label: "Keep KV cache on the GPU", type: "toggle", on: ["--kv-offload"], off: ["--no-kv-offload"] },
  { key: "mlock", group: "perf", label: "Lock model in RAM (mlock)", type: "toggle", on: ["--mlock"] },
  { key: "mmap", group: "perf", label: "Memory-map the model file", type: "toggle", on: ["--mmap"], off: ["--no-mmap"] },
  { key: "warmup", group: "perf", label: "Warm-up run at start", type: "toggle", on: ["--warmup"], off: ["--no-warmup"] },
  { key: "contextShift", group: "perf", label: "Context shift (keep chatting when full)", type: "toggle", on: ["--context-shift"], off: ["--no-context-shift"], hint: "Lets a long chat go past the context size by dropping the oldest part." },
  { key: "keep", group: "perf", label: "Tokens to always keep", type: "num", flag: "--keep", min: -1, max: 2000000, hint: "With context shift: how much of the start of the chat is never dropped. -1 = all." },
  { key: "ropeScaling", group: "perf", label: "RoPE scaling (longer context)", type: "select", flag: "--rope-scaling", choices: [["none", "none"], ["linear", "linear"], ["yarn", "yarn"]] },
  { key: "ropeScale", group: "perf", label: "RoPE scale factor", type: "num", float: true, flag: "--rope-scale", min: 0.01, max: 1000, hint: "e.g. 2 to stretch the model to about double its trained context." },
  { key: "splitMode", group: "perf", label: "Multi-GPU split", type: "select", flag: "-sm", choices: [["none", "none (one GPU)"], ["layer", "layer"], ["row", "row"]] },
  { key: "mainGpu", group: "perf", label: "Main GPU number", type: "num", flag: "-mg", min: 0, max: 64 },
  { key: "tensorSplit", group: "perf", label: "GPU split ratio", type: "text", flag: "-ts", placeholder: "e.g. 3,1", pattern: /^[0-9.,]+$/ },
  // ---- Sampling defaults ----
  { key: "temp", group: "sampling", label: "Temperature", type: "num", float: true, flag: "--temp", min: 0, max: 5, hint: "The chat page sends its own temperature, which wins for IcyWhite chats. These apply to other programs that connect." },
  { key: "topK", group: "sampling", label: "Top-K", type: "num", flag: "--top-k", min: 0, max: 100000 },
  { key: "topP", group: "sampling", label: "Top-P", type: "num", float: true, flag: "--top-p", min: 0, max: 1 },
  { key: "minP", group: "sampling", label: "Min-P", type: "num", float: true, flag: "--min-p", min: 0, max: 1 },
  { key: "repeatPenalty", group: "sampling", label: "Repeat penalty", type: "num", float: true, flag: "--repeat-penalty", min: 0, max: 10 },
  { key: "nPredict", group: "sampling", label: "Max tokens per reply", type: "num", flag: "-n", min: -2, max: 2000000, hint: "-1 = no limit (default)." },
  { key: "seed", group: "sampling", label: "Random seed", type: "num", flag: "-s", min: -1, max: 4294967295, hint: "-1 = random each time." },
  // ---- Vision (handled in start(): no flag of its own) ----
  { key: "mmproj", group: "server", label: "Image understanding (vision file)", type: "toggle", internal: true, hint: "Default: on when a *mmproj*.gguf file sits next to the model." }
];
const OPTION_BY_KEY = Object.fromEntries(OPTION_DEFS.map((d) => [d.key, d]));
const OPTION_VALUES_OK = (d, v) => {
  if (v === "" || v == null) return false;
  if (d.type === "toggle") return v === "on" || v === "off";
  if (d.type === "select") return d.choices.some((c) => c[0] === v);
  if (d.type === "num") { const n = Number(v); return Number.isFinite(n) && n >= d.min && n <= d.max; }
  if (d.type === "text") return /^[^\r\n"]{1,200}$/.test(v) && (!d.pattern || d.pattern.test(v));
  return false;
};
// {key: value} -> ["flag","value",...]  (invalid or empty values are skipped = "Default")
function optionArgs(opts) {
  const out = [];
  for (const d of OPTION_DEFS) {
    const v = opts && opts[d.key];
    if (d.internal) continue;
    if (!OPTION_VALUES_OK(d, v)) { if (d.defaults) out.push.apply(out, d.defaults); continue; }
    if (d.type === "toggle") out.push.apply(out, (v === "on" ? d.on : d.off) || (v === "on" ? d.defaults : []) || []);
    else out.push(d.flag, String(v));
  }
  return out;
}
const HOST_OK = (h) => /^(localhost|[0-9]{1,3}(\.[0-9]{1,3}){3}|::1?|[A-Za-z0-9][A-Za-z0-9.\-]{0,252})$/.test(h);
const isLoopHost = (h) => h === "127.0.0.1" || h === "localhost" || h === "::1";
const isAnyHost = (h) => h === "0.0.0.0" || h === "::";
function lanAddresses() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) for (const a of ifs[name] || []) if ((a.family === "IPv4" || a.family === 4) && !a.internal) out.push({ name, address: a.address });
  } catch (e) {}
  return out;
}
const LOG_LINES = 400;
const READY_TIMEOUT_MS = 15 * 60 * 1000;   // very large models can take minutes to load

// "--flag value --other 'two words'"  ->  ["--flag","value","--other","two words"]
function splitArgs(s) {
  const out = []; let cur = "", q = null, has = false;
  for (const ch of String(s || "")) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

const isMmproj = (name) => /mmproj/i.test(name);
const isSplitPart = (name) => { const m = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(name); return m && m[1] !== "00001"; };

/* ---------- runtimes: several llama.cpp builds (NVIDIA CUDA, Vulkan, CPU ...) and picking the right one ----------
 * A "runtime" is one folder that holds llama-server(.exe) plus its .dll files, for example
 *   runtimes/llama.cpp-GPU-NVIDIA CUDA/llama-server.exe      (has ggml-cuda.dll, cudart64_12.dll ...)
 *   runtimes/llama-cpu/llama-server.exe                      (has only ggml-cpu-*.dll)
 * The app looks at which files a folder contains to tell what kind of build it is, looks at which graphics card
 * this PC has, and uses the build that fits. You can still choose one by hand in Settings > Local model. */
const BACKEND_FILES = [   // first match wins when one folder holds several backends
  ["cuda", /^(lib)?ggml-cuda\.(dll|so)$/i], ["hip", /^(lib)?ggml-hip\.(dll|so)$/i], ["sycl", /^(lib)?ggml-sycl\.(dll|so)$/i],
  ["vulkan", /^(lib)?ggml-vulkan\.(dll|so)$/i], ["metal", /^(lib)?ggml-metal\.(dll|so|dylib)$/i], ["opencl", /^(lib)?ggml-opencl\.(dll|so)$/i]
];
const KIND_LABEL = { cuda: "NVIDIA CUDA", hip: "AMD ROCm (HIP)", sycl: "Intel (SYCL)", vulkan: "Vulkan (AMD / Intel / NVIDIA)", metal: "Apple Metal", opencl: "OpenCL", cpu: "CPU only" };

function classifyRuntime(names, folderName) {
  names = names || [];
  let kind = "", cudaMajor = 0;
  for (const [k, re] of BACKEND_FILES) if (names.some((n) => re.test(n))) { kind = k; break; }
  const m = names.map((n) => /^(?:cudart|cublas)64_(\d+)\.dll$/i.exec(n)).find(Boolean);
  if (m) { cudaMajor = parseInt(m[1], 10) || 0; if (!kind) kind = "cuda"; }
  if (!kind) {   // no backend file to go by (a static build): fall back to the folder name
    const f = String(folderName || "");
    kind = /cuda|nvidia/i.test(f) ? "cuda" : /vulkan/i.test(f) ? "vulkan" : /rocm|hip|radeon/i.test(f) ? "hip" : /sycl|intel/i.test(f) ? "sycl" : /metal/i.test(f) ? "metal" : "cpu";
  }
  const cpuVariants = names.filter((n) => /^(lib)?ggml-cpu-.+\.(dll|so)$/i.test(n)).length;
  return { kind, kindLabel: KIND_LABEL[kind] || kind, cudaMajor, cpuVariants };
}

// Looks for runtime folders under each root ({dir, depth}). A folder with llama-server in it is a runtime; its own
// sub-folders (models, ...) are not searched.
function findRuntimes(roots, exeName) {
  const out = [], seen = new Set(), exeLower = String(exeName).toLowerCase();
  let visited = 0;
  const walk = (dir, depth, maxDepth) => {
    if (visited++ > 800 || out.length >= 40) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    const names = ents.filter((e) => e.isFile()).map((e) => e.name);
    const exe = names.find((n) => n.toLowerCase() === exeLower);
    if (exe) {
      const abs = path.resolve(dir), key = abs.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(Object.assign({ id: abs, dir: abs, exe: path.join(abs, exe), name: path.basename(abs) || abs }, classifyRuntime(names, path.basename(abs)))); }
      return;
    }
    if (depth >= maxDepth) return;
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith(".") && !/^(models?|node_modules|\$recycle\.bin)$/i.test(e.name)) walk(path.join(dir, e.name), depth + 1, maxDepth);
  };
  (roots || []).forEach((r) => { if (r && r.dir) walk(r.dir, 0, r.depth == null ? 0 : r.depth); });
  return out;
}

const VIRTUAL_GPU_RE = /microsoft basic|remote|virtual|parsec|vmware|hyper-v|citrix|displaylink|indirect|meta |oculus/i;
function vendorOf(text) {
  const t = String(text || "");
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b|tesla|titan/i.test(t)) return "nvidia";
  if (/\bamd\b|advanced micro|radeon|\bati\b/i.test(t)) return "amd";
  if (/intel|\barc\b|iris|\buhd\b/i.test(t)) return "intel";
  if (/apple/i.test(t)) return "apple";
  return "other";
}
// nvidia-smi: csv = "name, memory MiB, driver" per card; plain = the normal table (its header says the newest CUDA the driver supports).
function parseNvidiaSmi(csv, plain) {
  const cards = String(csv || "").split(/\r?\n/).map((l) => l.split(",").map((x) => x.trim())).filter((r) => r.length >= 3 && r[0])
    .map((r) => ({ name: r[0], vramMB: parseInt(r[1], 10) || 0, driver: r[2] }));
  if (!cards.length) return null;
  cards.sort((a, b) => b.vramMB - a.vramMB);
  const m = /CUDA Version:\s*(\d+)(?:\.(\d+))?/i.exec(String(plain || ""));
  return Object.assign({}, cards[0], { count: cards.length, cudaMax: m ? parseInt(m[1], 10) : 0 });
}
function runCmd(file, args, timeout) {
  return new Promise((resolve) => {
    try { execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? "" : String(out))); }
    catch (e) { resolve(""); }
  });
}
async function detectHardware(platform) {
  const hw = { gpus: [], nvidia: null, hasNvidia: false, hasAmd: false, hasIntel: false, intelDiscrete: false, apple: platform === "darwin", cpu: "", threads: 0, ramGB: 0 };
  try { const c = os.cpus() || []; hw.cpu = c[0] ? String(c[0].model).replace(/\s+/g, " ").trim() : ""; hw.threads = c.length; hw.ramGB = Math.round(os.totalmem() / 1073741824 * 10) / 10; } catch (e) {}
  const add = (name, vendorHint) => { if (name && !VIRTUAL_GPU_RE.test(name)) hw.gpus.push({ name: String(name).trim(), vendor: vendorOf(name + " " + (vendorHint || "")) }); };
  if (platform === "win32") {
    const script = "$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ n=$_.Name; v=$_.AdapterCompatibility } }) | ConvertTo-Json -Compress";
    const out = await runCmd("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], 8000);
    try { let j = JSON.parse(out.trim() || "[]"); if (!Array.isArray(j)) j = [j]; j.forEach((g) => g && add(g.n, g.v)); } catch (e) {}
  } else if (platform === "linux") {
    String(await runCmd("lspci", ["-mm"], 4000)).split(/\r?\n/).filter((l) => /VGA|3D|Display/i.test(l)).forEach((l) => add(l.replace(/"/g, " ").replace(/\s+/g, " ")));
  }
  const smis = platform === "win32"
    ? ["nvidia-smi", path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe"), path.join(process.env.ProgramFiles || "C:\\Program Files", "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")]
    : ["nvidia-smi"];
  for (const smi of smis) {
    const csv = await runCmd(smi, ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], 6000);
    if (!csv.trim()) continue;
    hw.nvidia = parseNvidiaSmi(csv, await runCmd(smi, [], 6000));
    if (hw.nvidia) break;
  }
  return finishHardware(hw);
}
function finishHardware(hw) {
  hw.gpus = hw.gpus || [];
  if (hw.nvidia && !hw.gpus.some((g) => g.vendor === "nvidia")) hw.gpus.push({ name: hw.nvidia.name, vendor: "nvidia" });
  hw.hasNvidia = hw.gpus.some((g) => g.vendor === "nvidia") || !!hw.nvidia;
  hw.hasAmd = hw.gpus.some((g) => g.vendor === "amd");
  hw.hasIntel = hw.gpus.some((g) => g.vendor === "intel");
  hw.intelDiscrete = hw.gpus.some((g) => g.vendor === "intel" && /\barc\b/i.test(g.name));
  const parts = hw.gpus.map((g) => g.name + (hw.nvidia && g.vendor === "nvidia" && hw.nvidia.vramMB ? " (" + Math.round(hw.nvidia.vramMB / 1024) + " GB" + (hw.nvidia.driver ? ", driver " + hw.nvidia.driver : "") + ")" : ""));
  hw.summary = parts.length ? parts.join("; ") : (hw.apple ? "Apple graphics" : "No graphics card found (CPU only)");
  return hw;
}

// Which runtime kinds suit this PC, best first. Intel integrated graphics is usually slower than the CPU for language
// models, so CPU comes first there; a discrete Intel Arc card gets SYCL / Vulkan.
function kindOrder(hw) {
  hw = hw || {};
  if (hw.hasNvidia) return ["cuda", "vulkan", "cpu"];
  if (hw.hasAmd) return ["hip", "vulkan", "cpu"];
  if (hw.hasIntel) return hw.intelDiscrete ? ["sycl", "vulkan", "cpu"] : ["cpu", "vulkan"];
  if (hw.apple) return ["metal", "cpu"];
  return ["cpu"];
}
// Can this runtime run here? (a CUDA build needs an NVIDIA card and a driver new enough for its CUDA version)
function runtimeFit(rt, hw) {
  hw = hw || {};
  if (rt.kind === "cuda") {
    if (!hw.hasNvidia) return { ok: false, why: "needs an NVIDIA graphics card, and none was found" };
    if (hw.nvidia && hw.nvidia.cudaMax && rt.cudaMajor && rt.cudaMajor > hw.nvidia.cudaMax) return { ok: false, why: "needs a newer NVIDIA driver (the driver supports CUDA " + hw.nvidia.cudaMax + ", this build needs " + rt.cudaMajor + ")" };
  }
  if (rt.kind === "hip" && !hw.hasAmd) return { ok: false, why: "needs an AMD graphics card, and none was found" };
  if (rt.kind === "sycl" && !hw.hasIntel) return { ok: false, why: "needs an Intel graphics card, and none was found" };
  if (rt.kind === "vulkan" && !(hw.gpus && hw.gpus.length) && !hw.apple) return { ok: false, why: "needs a graphics card, and none was found" };
  if (rt.kind === "metal" && !hw.apple) return { ok: false, why: "is for Apple computers" };
  return { ok: true, why: "" };
}
function bestOfKind(list, kind, hw) {
  const c = list.filter((r) => r.kind === kind && runtimeFit(r, hw).ok);
  if (!c.length) return null;
  c.sort((a, b) => (kind === "cuda" ? b.cudaMajor - a.cudaMajor : 0) || b.cpuVariants - a.cpuVariants || a.name.localeCompare(b.name));   // newest CUDA; a CPU build that adapts to more CPUs
  return c[0];
}
function pickRuntime(list, hw) {
  list = list || [];
  if (!list.length) return { runtime: null, reason: "" };
  const order = kindOrder(hw), card = hw && hw.gpus && hw.gpus[0] ? hw.gpus.find((g) => g.vendor === "nvidia") || hw.gpus[0] : null;
  for (const k of order) {
    const r = bestOfKind(list, k, hw);
    if (!r) continue;
    const why = k === "cpu"
      ? (order[0] === "cpu" ? (hw && hw.gpus && hw.gpus.length ? "this PC's graphics are not strong enough to help, so the CPU runtime is used" : "no graphics card was found, so the CPU runtime is used")
        : "no matching " + KIND_LABEL[order[0]] + " runtime was found, so the CPU runtime is used")
      : (card ? card.name + " found" : "graphics card found") + ", so the " + KIND_LABEL[k] + " runtime is used";
    return { runtime: r, reason: why };
  }
  const rest = ["cpu", "vulkan", "opencl", "cuda", "hip", "sycl", "metal"];
  const r = list.slice().sort((a, b) => rest.indexOf(a.kind) - rest.indexOf(b.kind) || a.name.localeCompare(b.name))[0];
  const fit = runtimeFit(r, hw);
  return { runtime: r, reason: "the only runtime found is " + r.name + (fit.ok ? "" : " (it " + fit.why + ", so it may not start)") };
}
// After a failed start of an automatically chosen GPU runtime: was it the GPU build itself that could not start?
// (Running out of memory is NOT such a case: the user should lower the settings, not silently switch to the slow CPU.)
function gpuStartFailure(code, text) {
  text = String(text || "");
  if (/out of memory|cudaMalloc failed|failed to allocate|unable to allocate|OutOfDeviceMemory|hipMalloc failed/i.test(text)) return false;
  if (code === 3221225781 || /0xC0000135/i.test(text)) return true;   // a DLL could not be loaded
  return /(cuda|cublas|cudart|nvcuda|vulkan|\bhip\b|rocm|sycl|level.?zero).{0,80}(error|failed|fail\b|not found|no .{0,20}device|unable|could not|cannot|missing)/i.test(text);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
function randomFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function httpStatus(port, urlPath, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, timeout: timeoutMs || 2000 }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("timeout", () => { req.destroy(); resolve(0); });
    req.on("error", () => resolve(0));
  });
}

function createLlamaManager(opts) {
  const o = Object.assign({ platform: process.platform, spawnFn: spawn, readyTimeoutMs: READY_TIMEOUT_MS, pollMs: 500 }, opts);
  if (!o.userDataDir) throw new Error("userDataDir is required");
  const isWin = o.platform === "win32";
  const exeName = isWin ? "llama-server.exe" : "llama-server";
  const cfgFile = path.join(o.userDataDir, o.cfgName || "llama-config.json");   // extra model slots (llama-multi.js) use their own file

  let cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, "utf8"))); } catch (e) {}

  if (!cfg.opts || typeof cfg.opts !== "object") cfg.opts = {};
  const st = { state: "stopped", model: "", port: 0, pid: 0, error: "", hint: "", startedAt: 0, ctx: 0, ngl: 0, vision: false, host: "127.0.0.1", innerPort: 0, proxied: false, cors: "all", keyed: false, notice: "", runtime: null };
  let child = null, runId = 0, logBuf = [], settleWaiters = [], proxy = null;

  const saveCfg = () => { try { fs.mkdirSync(o.userDataDir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); } catch (e) {} };
  // Everything llama-server prints is also kept in a log file that survives a restart: <logDir>/<logName>, rotated at
  // about 2 MB, keeping the 3 newest files (.log, .log.1, .log.2). Only when the app passes a logDir.
  const logPath = o.logDir ? path.join(o.logDir, o.logName || "llama-server.log") : "";
  let logPending = "", logTimer = null;
  const LOG_MAX = o.logMaxBytes || 2 * 1024 * 1024;
  function flushLog() {
    clearTimeout(logTimer); logTimer = null;
    if (!logPath || !logPending) return;
    const text = logPending; logPending = "";
    try {
      fs.mkdirSync(o.logDir, { recursive: true });
      let size = 0; try { size = fs.statSync(logPath).size; } catch (e) {}
      if (size > LOG_MAX) {
        try { fs.unlinkSync(logPath + ".2"); } catch (e) {}
        try { fs.renameSync(logPath + ".1", logPath + ".2"); } catch (e) {}
        try { fs.renameSync(logPath, logPath + ".1"); } catch (e) {}
      }
      fs.appendFileSync(logPath, text);
    } catch (e) {}
  }
  const fileLog = (line) => {
    if (!logPath) return;
    logPending += new Date().toISOString().replace("T", " ").slice(0, 19) + "  " + line + "\n";
    if (logPending.length > 200000) flushLog();
    else if (!logTimer) { logTimer = setTimeout(flushLog, 700); if (logTimer.unref) logTimer.unref(); }
  };
  const pushLog = (chunk) => {
    String(chunk).replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).forEach((l) => { if (l.trim()) { fileLog(l.slice(0, 600)); logBuf.push(l.slice(0, 600)); if (typeof o.onLog === "function") { try { o.onLog(l.slice(0, 600)); } catch (e) {} } } });
    if (logBuf.length > LOG_LINES) logBuf = logBuf.slice(-LOG_LINES);
  };
  const settle = () => { const w = settleWaiters; settleWaiters = []; w.forEach((f) => f()); };

  /* ---------- where things are ---------- */
  const uniq = (a) => a.filter((x, i) => x && a.indexOf(x) === i);
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });   // never keeps the app (or a test) waiting

  // Graphics card / CPU facts, found once in the background at start-up (start() waits for it if it is not done yet).
  let hw = null;
  const detect = o.hardwareFn || (() => detectHardware(o.platform));
  let hwReady = Promise.resolve().then(detect).then((h) => { hw = finishHardware(h || {}); rtCache = null; return hw; }, () => { hw = finishHardware({}); rtCache = null; return hw; });
  const redetect = () => { hwReady = Promise.resolve().then(detect).then((h) => { hw = finishHardware(h || {}); rtCache = null; return hw; }, () => hw); return hwReady; };

  // Folders searched for runtimes. The old single-folder layouts (./llama, the app folder) still work.
  function runtimeRoots() {
    const r = [], add = (dir, depth) => { if (dir) r.push({ dir, depth }); };
    [cfg.runtimesDir, o.resourcesDir && path.join(o.resourcesDir, "runtimes"), o.exeDir && path.join(o.exeDir, "runtimes"),
      o.appDir && path.join(o.appDir, "runtimes"), path.join(o.userDataDir, "runtimes")].forEach((d) => add(d, 3));
    [o.resourcesDir && path.join(o.resourcesDir, "llama"), o.exeDir && path.join(o.exeDir, "llama"), o.exeDir,
      o.appDir && path.join(o.appDir, "llama"), o.appDir].forEach((d) => add(d, 0));
    add(o.appDir && path.join(o.appDir, "llama.cpp-GPU-NVIDIA CUDA"), 2);
    return r.filter((x, i) => r.findIndex((y) => y.dir === x.dir) === i);
  }
  let rtCache = null, rtAt = 0;
  function runtimes() {
    if (!rtCache || Date.now() - rtAt > 4000) { rtCache = findRuntimes(runtimeRoots(), exeName); rtAt = Date.now(); }
    return rtCache;
  }
  const emptyHw = () => finishHardware({});
  // The runtime in use: the one you picked, or the best match for this PC.
  function chosenRuntime() {
    const list = runtimes();
    if (cfg.runtime && cfg.runtime !== "auto") {
      const r = list.find((x) => x.id.toLowerCase() === String(cfg.runtime).toLowerCase());
      if (r) return { runtime: r, reason: "chosen by you", auto: false, note: "" };
    }
    const p = pickRuntime(list, hw || emptyHw());
    return { runtime: p.runtime, reason: p.reason, auto: true, note: cfg.runtime && cfg.runtime !== "auto" ? "The runtime you chose was not found, so one was picked automatically." : "" };
  }
  const rtView = (r) => r && ({ id: r.id, name: r.name, dir: r.dir, kind: r.kind, kindLabel: r.kindLabel, cudaMajor: r.cudaMajor });
  function binaryCandidates() { return uniq(runtimeRoots().map((r) => r.dir)); }
  function findBinary() {
    if (cfg.binPath) { try { if (fs.statSync(cfg.binPath).isFile()) return cfg.binPath; } catch (e) {} }
    const c = chosenRuntime();
    return c.runtime ? c.runtime.exe : "";
  }
  // Where a new runtime folder should be put: your chosen folder, or "runtimes" next to the app.
  function runtimesDir() {
    return cfg.runtimesDir || (o.exeDir && path.join(o.exeDir, "runtimes")) || (o.appDir && path.join(o.appDir, "runtimes")) || path.join(o.userDataDir, "runtimes");
  }
  async function listRuntimes(opt) {
    opt = opt || {};
    if (opt.redetect) await redetect(); else if (!hw) await Promise.race([hwReady, sleep(15000)]);
    if (opt.rescan || opt.redetect) rtCache = null;
    const c = chosenRuntime(), h = hw || emptyHw();
    return {
      runtimes: runtimes().map((r) => Object.assign(rtView(r), { usable: runtimeFit(r, h).ok, note: runtimeFit(r, h).why, cpuVariants: r.cpuVariants })),
      current: rtView(c.runtime), reason: c.reason, auto: c.auto, note: c.note, mode: cfg.runtime || "auto",
      hardware: { summary: h.summary, gpus: h.gpus, nvidia: h.nvidia, cpu: h.cpu, threads: h.threads, ramGB: h.ramGB, ready: !!hw },
      roots: binaryCandidates(), dir: runtimesDir(), hasBinPath: !!cfg.binPath
    };
  }
  function modelsDirCandidates() {
    const beside = [];   // a "models" folder inside a runtime folder (the chosen runtime's first)
    try { const cur = chosenRuntime().runtime; runtimes().slice().sort((a, b) => (b === cur) - (a === cur)).forEach((r) => beside.push(path.join(r.dir, "models"))); } catch (e) {}
    return uniq([o.exeDir && path.join(o.exeDir, "models"), o.resourcesDir && path.join(o.resourcesDir, "models"),
      o.appDir && path.join(o.appDir, "models")].concat(beside, [path.join(o.userDataDir, "models")]));
  }
  function scan(dir, depth, acc, root) {
    if (depth > 4 || acc.length >= 2000) return acc;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
    const ggufs = ents.filter((e) => e.isFile() && /\.gguf$/i.test(e.name));
    const projs = ggufs.filter((e) => isMmproj(e.name));
    for (const e of ggufs) {
      if (isMmproj(e.name) || isSplitPart(e.name)) continue;
      const full = path.join(dir, e.name);
      let size = 0; try { size = fs.statSync(full).size; } catch (x) {}
      if (/-00001-of-(\d{5})\.gguf$/i.test(e.name)) {   // a split model: count every part
        const base = e.name.replace(/-00001-of-\d{5}\.gguf$/i, "");
        ents.forEach((p) => { if (p.isFile() && p.name !== e.name && p.name.startsWith(base) && /-\d{5}-of-\d{5}\.gguf$/i.test(p.name)) { try { size += fs.statSync(path.join(dir, p.name)).size; } catch (x) {} } });
      }
      // vision projector: prefer one sharing the model's name, otherwise the only/first one in the same folder
      const stem = e.name.replace(/(-\d{5}-of-\d{5})?\.gguf$/i, "").toLowerCase();
      const proj = projs.find((p) => p.name.toLowerCase().includes(stem.slice(0, 12))) || projs[0] || null;
      acc.push({
        id: path.relative(root, full).split(path.sep).join("/"), name: e.name.replace(/\.gguf$/i, ""), size,
        mmproj: proj ? path.relative(root, path.join(dir, proj.name)).split(path.sep).join("/") : ""
      });
    }
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith(".")) scan(path.join(dir, e.name), depth + 1, acc, root);
    return acc;
  }
  function modelsDir() {
    if (cfg.modelsDir) return cfg.modelsDir;
    const c = modelsDirCandidates();
    const withModels = c.find((d) => scan(d, 0, [], d).length);
    return withModels || c.find((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } }) || c[c.length - 1];
  }
  function listModels() {
    const dir = modelsDir();
    const list = scan(dir, 0, [], dir).sort((a, b) => a.id.localeCompare(b.id));
    return { dir, models: list };
  }

  /* ---------- status ---------- */
  // Address this app itself uses: this computer, unless the server is bound to one specific network address.
  const selfHost = (h) => (isLoopHost(h) || isAnyHost(h)) ? "127.0.0.1" : h;
  function addresses() {
    if (!st.port) return [];
    const h = st.host, list = [];
    if (isLoopHost(h) || isAnyHost(h)) list.push({ label: "This computer", url: "http://127.0.0.1:" + st.port + "/v1" });
    if (isAnyHost(h)) lanAddresses().forEach((a) => list.push({ label: "Network (" + a.name + ")", url: "http://" + a.address + ":" + st.port + "/v1" }));
    else if (!isLoopHost(h)) list.push({ label: "Network address", url: "http://" + h + ":" + st.port + "/v1" });
    return list;
  }
  function getStatus() {
    const base = st.port ? "http://" + selfHost(st.host) + ":" + st.port : "";
    return {
      state: st.state, url: base, apiBase: base ? base + "/v1" : "", addresses: addresses(), host: st.host, proxied: st.proxied, cors: st.cors, keyed: st.keyed,
      schema: OPTION_DEFS.map((d) => ({ key: d.key, group: d.group, label: d.label, type: d.type, choices: d.choices, hint: d.hint, placeholder: d.placeholder, min: d.min, max: d.max, float: !!d.float, internal: !!d.internal })),
      lan: lanAddresses(),
      port: st.port, model: st.model, pid: st.pid, error: st.error, hint: st.hint, vision: st.vision, ctx: st.ctx, ngl: st.ngl,
      startedAt: st.startedAt, binary: findBinary(), binaryCandidates: binaryCandidates(), modelsDir: modelsDir(),
      notice: st.notice, runtime: st.runtime || rtView(chosenRuntime().runtime), runtimeReason: chosenRuntime().reason, runtimeMode: cfg.runtime || "auto",
      config: Object.assign({}, cfg), log: logBuf.slice(-60)
    };
  }
  function getConfig() { return Object.assign({}, cfg); }
  function setConfig(patch) {
    const p = patch || {};
    if ("modelsDir" in p) cfg.modelsDir = String(p.modelsDir || "").trim();
    if ("binPath" in p) cfg.binPath = String(p.binPath || "").trim();
    if ("runtime" in p) { cfg.runtime = String(p.runtime || "auto").trim().slice(0, 600) || "auto"; rtCache = null; }
    if ("runtimesDir" in p) { cfg.runtimesDir = String(p.runtimesDir || "").trim(); rtCache = null; }
    if ("model" in p) cfg.model = String(p.model || "");
    if ("ctx" in p) cfg.ctx = Math.max(512, Math.min(2000000, parseInt(p.ctx, 10) || DEFAULTS.ctx));
    if ("ngl" in p) cfg.ngl = Math.max(0, Math.min(999, parseInt(p.ngl, 10) || 0));
    if ("port" in p) cfg.port = Math.max(1024, Math.min(65535, parseInt(p.port, 10) || DEFAULTS.port));
    if ("extraArgs" in p) cfg.extraArgs = String(p.extraArgs || "").slice(0, 1000);
    if ("autoStart" in p) cfg.autoStart = !!p.autoStart;
    if ("host" in p) { const h = String(p.host || "").trim(); cfg.host = HOST_OK(h) ? h : DEFAULTS.host; }
    if ("cors" in p) cfg.cors = ["all", "origins", "off"].includes(p.cors) ? p.cors : "all";
    if ("corsOrigins" in p) cfg.corsOrigins = String(p.corsOrigins || "").slice(0, 2000);
    if ("apiKey" in p) cfg.apiKey = String(p.apiKey || "").replace(/[\r\n]/g, "").trim().slice(0, 300);
    if (p.opts && typeof p.opts === "object") {
      cfg.opts = {};
      for (const d of OPTION_DEFS) { const v = p.opts[d.key]; if (OPTION_VALUES_OK(d, v == null ? "" : String(v))) cfg.opts[d.key] = String(v); }
    }
    if (p.reset) {   // back to the factory settings (keeps the chosen model, models folder and llama-server path)
      const keep = { modelsDir: cfg.modelsDir, binPath: cfg.binPath, runtime: cfg.runtime, runtimesDir: cfg.runtimesDir, model: cfg.model };
      cfg = Object.assign({}, DEFAULTS, { opts: {} }, keep);
    }
    saveCfg();
    return getConfig();
  }

  /* ---------- run / stop ---------- */
  function killTree(c) {
    if (!c || !c.pid) return;
    try {
      if (isWin) execFile("taskkill", ["/pid", String(c.pid), "/T", "/F"], () => {});
      else process.kill(-c.pid, "SIGKILL");
    } catch (e) { try { c.kill("SIGKILL"); } catch (x) {} }
  }
  function hintFor(code, text) {
    if (code === 3221225781 || /0xC0000135/i.test(text)) return "Windows could not load a DLL that llama-server needs. Keep every .dll from the llama.cpp download in the same folder as llama-server.exe (including the CUDA ones). If this is the GPU runtime, choose the CPU runtime in Settings > Local model.";
    if (code === 3221225477 || code === 3221226505) return "llama-server crashed while loading. Try a smaller model, a smaller context, or fewer GPU layers.";
    if (/out of memory|cudaMalloc failed|failed to allocate|unable to allocate/i.test(text)) return "Not enough GPU memory. Lower \"GPU layers\", lower the context size, or pick a smaller model.";
    if (/unknown model architecture|unsupported|failed to load model/i.test(text)) return "This model could not be loaded. It may need a newer llama.cpp build, or the .gguf file may be incomplete.";
    if (/address already in use|couldn't bind|EADDRINUSE|bind/i.test(text)) return "The port is already in use. Choose another port.";
    if (/invalid argument|unknown argument|unrecognized (option|argument)|error while handling argument/i.test(text)) return "llama-server did not accept one of the settings. Look at the first line of the Server log to see the command, then set that option back to Default (or use Reset to defaults). Newer options need a newer llama.cpp build.";
    return "";
  }

  // The exact llama-server command line for the current settings.
  function buildArgs(abs, mmprojAbs, listenHost, listenPort) {
    const a = ["-m", abs, "--host", listenHost, "--port", String(listenPort), "-c", String(cfg.ctx), "-ngl", String(cfg.ngl),
      "--alias", path.basename(abs).replace(/\.gguf$/i, "")];
    a.push.apply(a, optionArgs(cfg.opts));
    if (mmprojAbs) a.push("--mmproj", mmprojAbs);
    a.push.apply(a, splitArgs(cfg.extraArgs));
    return a;
  }
  function preview(model) {
    const m = String(model || cfg.model || "model.gguf"), useProxy = cfg.cors !== "all" || !!cfg.apiKey;
    const args = buildArgs(path.join(modelsDir(), m), "", useProxy ? "127.0.0.1" : (cfg.host || "127.0.0.1"), useProxy ? "<private port>" : cfg.port);
    return (isWin ? "llama-server.exe " : "llama-server ") + args.map((x) => (/\s/.test(x) ? '"' + x + '"' : x)).join(" ");
  }

  async function stop() {
    runId++;   // invalidates any readiness polling in flight
    const c = child;
    if (c) {
      child = null;
      await new Promise((resolve) => {
        let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
        c.once("exit", fin); c.once("close", fin);
        killTree(c);
        setTimeout(fin, 5000);
      });
    }
    await closeProxy();
    st.state = "stopped"; st.pid = 0; st.error = ""; st.hint = ""; st.notice = ""; st.runtime = null; st.port = 0; st.vision = false; st.proxied = false; st.innerPort = 0;
    settle();
    return getStatus();
  }
  async function closeProxy() { const p = proxy; proxy = null; if (p) { try { await p.close(); } catch (e) {} } }

  async function start(req) {
    req = req || {};
    if (req.config) setConfig(req.config);
    const model = String(req.model || cfg.model || "");
    if (child) await stop();
    st.error = ""; st.hint = ""; st.notice = req.notice || "";

    const fail = (msg, hint) => { st.state = "error"; st.error = msg; st.hint = hint || ""; st.pid = 0; st.port = 0; settle(); return getStatus(); };

    if (!hw) await Promise.race([hwReady, sleep(15000)]);   // the graphics card check normally finished long ago
    const pick = chosenRuntime();
    let usedRt = pick.runtime, autoPicked = pick.auto, bin = findBinary();   // findBinary() honors a llama-server path set by hand
    if (cfg.binPath && bin === cfg.binPath) { usedRt = null; autoPicked = false; }
    if (req.forceRuntime) { const f = runtimes().find((x) => x.id === req.forceRuntime); if (f) { usedRt = f; bin = f.exe; autoPicked = false; } }
    st.runtime = usedRt ? rtView(usedRt) : (bin ? { id: bin, name: path.basename(path.dirname(bin)), kind: "custom", kindLabel: "llama-server path set by hand" } : null);
    if (!bin) return fail("llama-server was not found.", "Put a runtime folder (llama-server.exe and all its .dll files) inside a folder named \"runtimes\" next to the app, or press \"Runtimes folder...\" in Settings > Local model. Looked in: " + binaryCandidates().join("  |  "));
    if (!model) return fail("No model chosen.", "Pick a .gguf model from the list first.");
    const dir = modelsDir();
    const abs = path.resolve(dir, model);
    if (abs !== dir && !abs.startsWith(path.resolve(dir) + path.sep)) return fail("That model path is outside the models folder.");
    if (!/\.gguf$/i.test(abs) || !fs.existsSync(abs)) return fail("Model file not found: " + model, "Models folder: " + dir);

    cfg.model = model; saveCfg();
    const found = scan(dir, 0, [], dir).find((m) => m.id === model.split(path.sep).join("/"));
    const mmprojAbs = found && found.mmproj && cfg.opts.mmproj !== "off" ? path.join(dir, found.mmproj) : "";

    // Public address = what you set in Settings. With an API key or a CORS rule, llama-server hides on a private
    // loopback port and cors-proxy.js answers on the public one (see cors-proxy.js).
    const host = cfg.host || "127.0.0.1";
    const useProxy = cfg.cors !== "all" || !!cfg.apiKey;
    let port = cfg.port;
    if (!(await isPortFree(port))) { try { port = await randomFreePort(); } catch (e) { return fail("No free network port available."); } }
    let innerPort = port;
    if (useProxy) { try { innerPort = await randomFreePort(); } catch (e) { return fail("No free network port available."); } }

    const args = buildArgs(abs, mmprojAbs, useProxy ? "127.0.0.1" : host, innerPort);

    if (!req.keepLog) logBuf = [];
    if (usedRt) pushLog("[IcyWhite] runtime: " + usedRt.name + " (" + usedRt.kindLabel + ")" + (req.forceRuntime ? " - fallback" : " - " + (autoPicked ? pick.reason : "chosen by you")) + (hw ? "  |  this PC: " + hw.summary : ""));
    pushLog("> " + path.basename(bin) + " " + args.map((a) => (/\s/.test(a) ? '"' + a + '"' : a)).join(" "));
    const my = ++runId;
    let c;
    try {
      c = o.spawnFn(bin, args, { cwd: path.dirname(bin), windowsHide: true, detached: !isWin, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { return fail("Could not start llama-server: " + e.message); }
    child = c;
    st.host = host; st.innerPort = innerPort; st.proxied = useProxy; st.cors = cfg.cors; st.keyed = !!cfg.apiKey;
    st.state = "starting"; st.model = model; st.port = port; st.pid = c.pid || 0; st.startedAt = Date.now(); st.ctx = cfg.ctx; st.ngl = cfg.ngl; st.vision = !!mmprojAbs;
    if (useProxy) {
      proxy = createProxy({ host, port, targetPort: innerPort, cors: cfg.cors, origins: cfg.corsOrigins, apiKey: cfg.apiKey });
      try { await proxy.listen(); pushLog("[IcyWhite] front door on " + host + ":" + port + " (CORS: " + cfg.cors + (cfg.apiKey ? ", API key required" : "") + ") -> llama-server on 127.0.0.1:" + innerPort); }
      catch (e) { proxy = null; killTree(c); child = null; return fail("Could not open " + host + ":" + port + " (" + e.message + ").", e.code === "EADDRINUSE" ? "The port is already in use. Choose another port." : "Check the \"Serve on\" address in Settings > Local model."); }
    }
    c.stdout && c.stdout.on("data", pushLog); c.stderr && c.stderr.on("data", pushLog);
    c.on("error", (e) => { if (my !== runId) return; child = null; fail("Could not start llama-server: " + e.message, e.code === "ENOENT" ? "The file is missing or blocked: " + bin : ""); });
    c.on("exit", (code, signal) => {
      if (my !== runId) return;
      child = null; closeProxy();
      const tail = logBuf.slice(-12).join("\n");
      // An automatically chosen GPU runtime that cannot start (missing DLL, no usable device...) falls back to the CPU runtime once.
      const cpuRt = st.state === "starting" && autoPicked && usedRt && usedRt.kind !== "cpu" && !req.noFallback && gpuStartFailure(code, tail) ? bestOfKind(runtimes(), "cpu", hw || emptyHw()) : null;
      if (cpuRt) {
        pushLog("[IcyWhite] The " + usedRt.kindLabel + " runtime could not start, so the CPU runtime (" + cpuRt.name + ") is being used instead.");
        start({ model, noFallback: true, keepLog: true, forceRuntime: cpuRt.id,
          notice: "The " + usedRt.kindLabel + " runtime (" + usedRt.name + ") could not start on this PC, so IcyWhite switched to the CPU runtime (" + cpuRt.name + "). It is slower. You can pick a runtime by hand in Settings > Local model." }).catch(() => {});
        return;
      }
      if (st.state === "starting") fail("llama-server stopped while loading the model (exit code " + code + ").", hintFor(code, tail));
      else if (st.state === "ready") { st.state = "error"; st.error = "llama-server stopped unexpectedly (exit code " + (code == null ? signal : code) + ")."; st.hint = hintFor(code, tail); st.pid = 0; settle(); }
    });

    // poll /health: 503 = still loading, 200 = ready
    (async () => {
      const t0 = Date.now();
      while (my === runId && st.state === "starting") {
        if (await httpStatus(innerPort, "/health") === 200) { if (my === runId && st.state === "starting") { st.state = "ready"; settle(); } return; }
        if (Date.now() - t0 > o.readyTimeoutMs) { if (my === runId) { killTree(c); fail("Timed out waiting for the model to load."); } return; }
        await new Promise((r) => setTimeout(r, o.pollMs));
      }
    })();
    return getStatus();
  }

  /* "Will it fit?" for a model with the current settings (or settings in `patch`, which are not saved). */
  async function estimate(model, patch) {
    patch = patch || {};
    const c = Object.assign({}, cfg, patch), opts = Object.assign({}, cfg.opts, patch.opts || {});
    model = String(model || c.model || "");
    if (!model) return { level: "unknown", message: "Pick a model first." };
    const dir = modelsDir(), abs = path.resolve(dir, model);
    if (abs !== dir && !abs.startsWith(path.resolve(dir) + path.sep)) return { level: "unknown", message: "That model path is outside the models folder." };
    if (!fs.existsSync(abs)) return { level: "unknown", message: "Model file not found." };
    const found = scan(dir, 0, [], dir).find((m) => m.id === model.split(path.sep).join("/"));
    let weights = found ? found.size : fs.statSync(abs).size;
    if (found && found.mmproj && opts.mmproj !== "off") { try { weights += fs.statSync(path.join(dir, found.mmproj)).size; } catch (e) {} }
    if (!hw) await Promise.race([hwReady, sleep(15000)]);
    const h = hw || emptyHw(), rt = chosenRuntime().runtime;
    const cpuOnly = !rt || rt.kind === "cpu" || h.apple || !(h.gpus && h.gpus.length);
    const ngl = cpuOnly ? 0 : (parseInt(c.ngl, 10) || 0);
    const est = mem.estimateBytes({ weightsBytes: weights, meta: mem.readGgufMeta(abs), ctx: parseInt(c.ctx, 10) || 8192, ngl, cacheK: opts.cacheTypeK, cacheV: opts.cacheTypeV, kvOffload: opts.kvOffload !== "off" });
    const gpu = !cpuOnly && h.hasNvidia ? await mem.gpuMemory() : null;
    const r = mem.judge(est, Object.assign({ gpu }, mem.freeRam()));
    r.model = model; r.cpuOnly = cpuOnly; r.layers = est.layers;
    return r;
  }

  // Resolves once the current start attempt is ready / failed / stopped (used by tests and by autostart).
  function whenSettled() { return st.state === "starting" ? new Promise((r) => settleWaiters.push(() => r(getStatus()))) : Promise.resolve(getStatus()); }
  function autoStart() { if (!cfg.autoStart || !cfg.model) return Promise.resolve(getStatus()); return Promise.race([hwReady, sleep(15000)]).then(() => (findBinary() ? start({}) : getStatus())); }
  function shutdownSync() { runId++; const c = child; child = null; if (c) killTree(c); closeProxy(); flushLog(); }

  return { getStatus, getConfig, setConfig, preview, listModels, listRuntimes, runtimesDir, findBinary, modelsDir, start, stop, whenSettled, autoStart, shutdownSync, splitArgs, estimate, logPath: () => logPath, flushLog };
}

module.exports = { createLlamaManager, splitArgs, OPTION_DEFS, optionArgs, classifyRuntime, findRuntimes, pickRuntime, runtimeFit, parseNvidiaSmi, finishHardware, gpuStartFailure, vendorOf };
