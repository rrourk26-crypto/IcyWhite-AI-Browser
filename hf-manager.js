/* Hugging Face model hub for IcyWhite (runs in the main process; no Electron imports so it can be tested with plain Node).
 *
 *   SEARCH     hf.search()      public models API, GGUF only, sort by downloads / likes / newest / trending / updated
 *   MODEL PAGE hf.model()       details + every .gguf file grouped by quantization (split parts together, vision files apart),
 *                               each with a "will it fit?" badge. hf.readme() fetches the model card text.
 *   JUMP TO    hf.resolve()     understands a link ("https://huggingface.co/user/repo/..."), "hf.co/user/repo:Q4_K_M" or "user/repo"
 *   STARTERS   hf.starters()    a short curated list (fast / balanced / smart) with a fit hint for this PC
 *   DOWNLOADS  hf.download*()   queue, progress, speed, ETA, pause / resume / cancel / retry. Written to "<name>.part" and renamed
 *                               only when complete and verified. Survives closing the app (HTTP Range). Checks free disk space,
 *                               downloads every part of a split model plus the optional vision file, verifies SHA-256.
 *   SETTINGS   hf.setConfig()   mirror address, proxy, speed limit, parallel downloads, token (Electron safeStorage, never plain text)
 *
 * Everything that touches Electron or the network stack is injected (fetchFn, safeStorage, notify, statfs ...), see createHfManager. */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const GB = 1073741824, MB = 1048576;
const DEFAULT_ENDPOINT = "https://huggingface.co";
const SORTS = { downloads: "downloads", likes: "likes", newest: "createdAt", trending: "trendingScore", updated: "lastModified" };

class HfError extends Error { constructor(message, code, status) { super(message); this.name = "HfError"; this.code = code || "error"; this.status = status || 0; } }

/* ------------------------------------------------------------------ pure helpers ------------------------------------------------------------------ */

// "https://huggingface.co/user/repo/blob/main/x.gguf", "hf.co/user/repo:Q4_K_M", "user/repo" -> { repo, revision, file, quant }
function parseRepoInput(text, extraHosts) {
  let s = String(text || "").trim().replace(/^[<"'`]+|[>"'`]+$/g, "");
  if (!s) return null;
  const hosts = ["huggingface.co", "www.huggingface.co", "hf.co"].concat(extraHosts || []).map((h) => String(h).toLowerCase());
  const m = /^(?:(https?):\/\/)?([^\/\s?#]+)\/(.+)$/i.exec(s);
  let rest = s;
  if (m && hosts.includes(m[2].toLowerCase())) rest = m[3];
  else if (/^https?:\/\//i.test(s)) return null;   // some other website
  rest = rest.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
  const seg = rest.split("/").map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  if (seg.length < 2 || /^(datasets|spaces|docs|blog|papers|collections|organizations|settings|api)$/i.test(seg[0])) return null;
  let quant = "", name = seg[1];
  const q = /^(.+?):([A-Za-z0-9_.\-]+)$/.exec(name);
  if (q) { name = q[1]; quant = q[2].toUpperCase(); }
  const repo = seg[0] + "/" + name;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,95}\/[A-Za-z0-9_.\-]{1,96}$/.test(repo)) return null;
  let revision = "main", file = "";
  if (/^(tree|blob|resolve|raw)$/i.test(seg[2] || "") && seg[3]) { revision = seg[3]; if (!/^tree$/i.test(seg[2])) file = seg.slice(4).join("/"); }
  return { repo, revision, file, quant };
}

const QUANT_RE = /(?:^|[^A-Za-z0-9])((?:UD-)?(?:IQ[1-4]_[A-Z0-9]+|TQ[12]_0|Q[1-8]_(?:K_[A-Z]+|K|[01]|[A-Z0-9]+)|Q[1-8]|BF16|F16|F32|MXFP4(?:_MOE)?))(?![A-Za-z0-9])/i;
function parseQuant(p) {
  const parts = String(p || "").split("/"), name = parts.pop().replace(/\.gguf$/i, "").replace(/-\d{5}-of-\d{5}$/i, "");
  for (const t of [name].concat(parts.reverse())) { const m = QUANT_RE.exec(t); if (m) return m[1].toUpperCase(); }
  return "";
}
const BITS = { 1: 1.7, 2: 2.9, 3: 3.9, 4: 4.8, 5: 5.7, 6: 6.6, 7: 7.5, 8: 8.5 };
function quantInfo(q) {
  q = String(q || "").toUpperCase().replace(/^UD-/, "");
  if (!q) return { bits: 0, note: "" };
  if (q === "F32") return { bits: 32, note: "Uncompressed. Huge, only for experts." };
  if (q === "F16" || q === "BF16") return { bits: 16, note: "Original precision. Very large." };
  if (/^MXFP4/.test(q)) return { bits: 4.3, note: "Native 4-bit format, good quality for its size." };
  const n = parseInt((/^(?:IQ|TQ|Q)(\d)/.exec(q) || [])[1], 10) || 0, bits = BITS[n] || 0;
  let note = "";
  if (n <= 2) note = "Smallest. Noticeably lower quality.";
  else if (n === 3) note = "Small. Some quality loss.";
  else if (/^Q4_K_(M|XL|L)$/.test(q)) note = "Recommended. Best balance of size and quality.";
  else if (n === 4) note = "Small and fast. Slightly below Q4_K_M quality.";
  else if (n === 5) note = "Higher quality, a bit larger.";
  else if (n === 6) note = "Very high quality.";
  else if (n === 8) note = "Near original quality. Large.";
  return { bits, note };
}

const SPLIT_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
const isMmprojPath = (p) => /mmproj/i.test(String(p).split("/").pop());
// Tree entries -> one row per model file (split parts joined into one row) + the vision (mmproj) files.
function buildFileGroups(entries) {
  const ggufs = (entries || []).filter((e) => e && e.type !== "directory" && /\.gguf$/i.test(e.path || ""))
    .map((e) => ({ path: e.path, size: Number(e.size || (e.lfs && e.lfs.size) || 0), sha256: (e.lfs && e.lfs.oid) || "" }));
  const mmproj = ggufs.filter((f) => isMmprojPath(f.path)).map((f) => Object.assign({ quant: parseQuant(f.path) || "" }, f))
    .sort((a, b) => a.size - b.size);
  const map = new Map();
  for (const f of ggufs.filter((x) => !isMmprojPath(x.path))) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    const name = f.path.slice(dir.length), sp = SPLIT_RE.exec(name);
    const key = sp ? dir + sp[1] : f.path;
    let g = map.get(key);
    if (!g) { g = { id: key, quant: parseQuant(f.path), files: [], total: sp ? parseInt(sp[3], 10) : 1 }; map.set(key, g); }
    g.files.push(Object.assign({ part: sp ? parseInt(sp[2], 10) : 1 }, f));
  }
  const groups = [...map.values()].map((g) => {
    g.files.sort((a, b) => a.part - b.part);
    g.size = g.files.reduce((s, f) => s + f.size, 0);
    g.parts = g.files.length;
    g.incomplete = g.files.length !== g.total;
    g.name = g.files[0].path.split("/").pop().replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, "");
    const qi = quantInfo(g.quant); g.bits = qi.bits; g.note = qi.note;
    return g;
  }).filter((g) => !g.incomplete);
  groups.sort((a, b) => a.size - b.size || a.id.localeCompare(b.id));
  return { groups, mmproj };
}

/* "Will it fit?" Weights plus a little for the context (KV cache) and compute buffers at a normal context size.
 * hw = { vramBytes, ramBytes, vramKnown, unified }.
 *   gpu      all of it fits in graphics memory
 *   partial  some layers go to the GPU, the rest stays in RAM (slower)
 *   cpu      runs from system RAM only
 *   toobig   does not fit even with RAM */
function estimateFit(bytes, hw) {
  bytes = Number(bytes) || 0; hw = hw || {};
  const need = bytes + 0.8 * GB + bytes * 0.03;
  const vram = Math.max(0, Number(hw.vramBytes) || 0), ram = Math.max(0, Number(hw.ramBytes) || 0);
  const gpuUsable = vram > 0 ? Math.max(0, vram - 0.4 * GB) : 0, ramUsable = ram * 0.8;
  if (gpuUsable > 0 && need <= gpuUsable) return { fit: "gpu", need };
  if (!hw.unified && gpuUsable >= 1 * GB && need <= gpuUsable + ramUsable) return { fit: "partial", need };
  if (need <= ramUsable) return { fit: "cpu", need };
  return { fit: "toobig", need };
}
// The quant to suggest: the best quality that fits fully on the GPU (up to Q8), otherwise something near Q4/Q5 that still fits.
function pickRecommended(groups, fits) {
  const ok = groups.filter((g) => g.bits > 0 && fits.get(g.id) !== "toobig");
  const gpu = ok.filter((g) => fits.get(g.id) === "gpu" && g.bits <= 8.5).sort((a, b) => b.bits - a.bits || b.size - a.size)[0];
  if (gpu) return gpu.id;
  const mid = ok.filter((g) => g.bits <= 5.7).sort((a, b) => b.bits - a.bits)[0];
  return mid ? mid.id : (ok[0] ? ok[0].id : "");
}

// Parses the HTTP Link header for the next page of a list
function nextLink(res) {
  try { const h = res.headers.get("link") || ""; const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(h); return m ? m[1] : ""; } catch (e) { return ""; }
}
const safeSeg = (s) => String(s).replace(/[<>:"|?*\x00-\x1f\\]/g, "_").replace(/^\.+/, "_").slice(0, 120);
const safeRel = (p) => String(p).split("/").filter((x) => x && x !== "." && x !== "..").map(safeSeg).join(path.sep);
const sleepMs = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
const normEndpoint = (u) => { try { const x = new URL(String(u || "").trim() || DEFAULT_ENDPOINT); if (!/^https?:$/.test(x.protocol)) return DEFAULT_ENDPOINT; return (x.origin + x.pathname).replace(/\/+$/, ""); } catch (e) { return DEFAULT_ENDPOINT; } };

/* Curated first-run picks. approxGB = size of the usual 4-bit file (Q4_K_M), only used for the "fits on this PC" hint. */
const STARTERS = [
  { tier: "fast", label: "Fast", repo: "unsloth/Llama-3.2-1B-Instruct-GGUF", title: "Llama 3.2 1B", blurb: "Tiny and very quick. Fine for simple chat and light tasks, even on a weak PC.", approxGB: 0.8 },
  { tier: "fast", label: "Fast", repo: "bartowski/Llama-3.2-3B-Instruct-GGUF", title: "Llama 3.2 3B", blurb: "Quick and surprisingly capable for its size.", approxGB: 2.0 },
  { tier: "fast", label: "Fast · sees images", repo: "unsloth/gemma-3-4b-it-GGUF", title: "Gemma 3 4B", blurb: "Small model that can also look at pictures (vision).", approxGB: 2.5, vision: true },
  { tier: "balanced", label: "Balanced", repo: "unsloth/Qwen3-8B-GGUF", title: "Qwen3 8B", blurb: "A good all-rounder: answers, writing and reasoning.", approxGB: 5.0 },
  { tier: "balanced", label: "Balanced · coding", repo: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF", title: "Qwen2.5 Coder 7B", blurb: "Tuned for writing and fixing code.", approxGB: 4.7 },
  { tier: "balanced", label: "Balanced · sees images", repo: "unsloth/gemma-3-12b-it-GGUF", title: "Gemma 3 12B", blurb: "Strong all-rounder that understands images too.", approxGB: 7.3, vision: true },
  { tier: "smart", label: "Smart", repo: "unsloth/gpt-oss-20b-GGUF", title: "gpt-oss 20B", blurb: "A big, smart model that runs faster than its size suggests.", approxGB: 11.5 },
  { tier: "smart", label: "Smart", repo: "unsloth/Qwen3-30B-A3B-GGUF", title: "Qwen3 30B-A3B", blurb: "Very capable and quick for its size (only part of it works at a time). Needs a lot of memory.", approxGB: 18.6 },
  { tier: "smart", label: "Smart · sees images", repo: "unsloth/gemma-3-27b-it-GGUF", title: "Gemma 3 27B", blurb: "The best Gemma 3 model, with image understanding.", approxGB: 16.5, vision: true },
  { tier: "smart", label: "Smart · huge", repo: "bartowski/Llama-3.3-70B-Instruct-GGUF", title: "Llama 3.3 70B", blurb: "Top quality, but needs a workstation-class PC.", approxGB: 42.5 }
];

/* ------------------------------------------------------------------ manager ------------------------------------------------------------------ */
const CONFIG_DEFAULTS = { endpoint: DEFAULT_ENDPOINT, proxy: "", speedLimitMBps: 0, maxConcurrent: 1, verify: true, notify: true, vramOverrideGB: 0 };
const ACTIVE = new Set(["downloading", "verifying"]);

function createHfManager(opts) {
  const o = Object.assign({ retryBaseMs: 1000, maxRetries: 5, stallMs: 30000, apiTimeoutMs: 20000, userAgent: "IcyWhite", platform: process.platform }, opts);
  if (!o.userDataDir) throw new Error("userDataDir is required");
  if (typeof o.modelsDir !== "function") throw new Error("modelsDir() is required");
  const fetchFn = o.fetchFn || ((u, i) => fetch(u, i));
  const cfgFile = path.join(o.userDataDir, "hf-config.json"), jobsFile = path.join(o.userDataDir, "hf-downloads.json");

  /* ---------- settings ---------- */
  let cfg = Object.assign({}, CONFIG_DEFAULTS, { tokenEnc: "" });
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, "utf8"))); } catch (e) {}
  cfg.endpoint = normEndpoint(cfg.endpoint);
  let tokenCache = null;
  const saveCfg = () => { try { fs.mkdirSync(o.userDataDir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); } catch (e) {} };
  const canEncrypt = () => { try { return !!(o.safeStorage && o.safeStorage.isEncryptionAvailable()); } catch (e) { return false; } };
  function getToken() {
    if (tokenCache !== null) return tokenCache;
    tokenCache = "";
    if (cfg.tokenEnc && canEncrypt()) { try { tokenCache = o.safeStorage.decryptString(Buffer.from(cfg.tokenEnc, "base64")); } catch (e) { tokenCache = ""; } }
    return tokenCache;
  }
  function setToken(t) {
    t = String(t || "").trim();
    if (!t) { cfg.tokenEnc = ""; tokenCache = ""; saveCfg(); return getConfig(); }
    if (!/^[A-Za-z0-9_\-.]{8,300}$/.test(t)) throw new HfError("That does not look like a Hugging Face token (they start with hf_).", "badtoken");
    if (!canEncrypt()) throw new HfError("Secure storage is not available on this computer, so the token was NOT saved (it is never stored as plain text).", "nosafe");
    cfg.tokenEnc = o.safeStorage.encryptString(t).toString("base64"); tokenCache = t; saveCfg();
    return getConfig();
  }
  function getConfig() {
    return { endpoint: cfg.endpoint, proxy: cfg.proxy, speedLimitMBps: cfg.speedLimitMBps, maxConcurrent: cfg.maxConcurrent, verify: !!cfg.verify, notify: !!cfg.notify,
      vramOverrideGB: cfg.vramOverrideGB, hasToken: !!cfg.tokenEnc, canEncrypt: canEncrypt(), defaultEndpoint: DEFAULT_ENDPOINT };
  }
  function setConfig(p) {
    p = p || {};
    if ("endpoint" in p) cfg.endpoint = normEndpoint(p.endpoint);
    if ("proxy" in p) { cfg.proxy = String(p.proxy || "").trim().slice(0, 300); try { if (o.applyProxy) o.applyProxy(cfg.proxy); } catch (e) {} }
    if ("speedLimitMBps" in p) cfg.speedLimitMBps = Math.max(0, Math.min(100000, Number(p.speedLimitMBps) || 0));
    if ("maxConcurrent" in p) { cfg.maxConcurrent = Math.max(1, Math.min(2, parseInt(p.maxConcurrent, 10) || 1)); pump(); }
    if ("verify" in p) cfg.verify = !!p.verify;
    if ("notify" in p) cfg.notify = !!p.notify;
    if ("vramOverrideGB" in p) { cfg.vramOverrideGB = Math.max(0, Math.min(2048, Number(p.vramOverrideGB) || 0)); hwCache = null; }
    saveCfg();
    return getConfig();
  }
  try { if (o.applyProxy && cfg.proxy) o.applyProxy(cfg.proxy); } catch (e) {}

  /* ---------- talking to Hugging Face ---------- */
  const epOrigin = () => { try { return new URL(cfg.endpoint).origin; } catch (e) { return DEFAULT_ENDPOINT; } };
  function headersFor(url, extra) {
    const h = Object.assign({ "User-Agent": o.userAgent }, extra || {});
    const t = getToken();
    try { if (t && new URL(url).origin === epOrigin()) h.Authorization = "Bearer " + t; } catch (e) {}   // the token only ever goes to the hub address
    return h;
  }
  function explain(status, what) {
    if (status === 401) return new HfError("Hugging Face wants a token for this. Add one in Hub settings, and accept the model's licence on huggingface.co first.", "auth", 401);
    if (status === 403) return new HfError("Hugging Face refused access. Open the model page on huggingface.co, accept its licence, and make sure your token is allowed to read it.", "forbidden", 403);
    if (status === 404) return new HfError(what + " was not found on Hugging Face.", "notfound", 404);
    if (status === 429) return new HfError("Hugging Face is rate-limiting requests. Wait a minute and try again (a token raises the limit).", "rate", 429);
    return new HfError("Hugging Face answered with an error (" + status + ").", "http", status);
  }
  async function getRes(url, init, what, timeoutMs) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs || o.apiTimeoutMs);
    try {
      const res = await fetchFn(url, Object.assign({ headers: headersFor(url), signal: ctl.signal, redirect: "follow" }, init || {}));
      return res;
    } catch (e) {
      throw new HfError(ctl.signal.aborted ? "Hugging Face did not answer in time." : "Could not reach Hugging Face. Check your internet connection, proxy or mirror address.", "offline");
    } finally { clearTimeout(timer); }
  }
  async function getJson(url, what) {
    const res = await getRes(url, null, what);
    if (!res.ok) throw explain(res.status, what);
    try { return { json: await res.json(), next: nextLink(res) }; } catch (e) { throw new HfError("Hugging Face sent an answer that could not be read.", "badjson"); }
  }
  const apiUrl = (p) => cfg.endpoint + "/api" + p;
  const encRepo = (repo) => repo.split("/").map(encodeURIComponent).join("/");
  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
  const licenseOf = (tags, card) => (card && card.license ? String(Array.isArray(card.license) ? card.license[0] : card.license) : (((tags || []).find((t) => /^license:/.test(t)) || "").slice(8)));

  function normItem(m) {
    const id = m.id || m.modelId || "", tags = m.tags || [], gg = m.gguf || {};
    const pipe = m.pipeline_tag || "";
    return {
      id, author: m.author || id.split("/")[0], name: id.split("/").slice(1).join("/") || id,
      downloads: m.downloads || 0, likes: m.likes || 0, lastModified: m.lastModified || m.createdAt || "", createdAt: m.createdAt || "",
      gated: m.gated || false, isPrivate: !!m.private, license: licenseOf(tags, m.cardData), tags, pipeline: pipe,
      params: gg.total || 0, arch: gg.architecture || "", contextLength: gg.context_length || 0,
      vision: pipe === "image-text-to-text" || tags.includes("image-text-to-text") || /vision|[-_]vl[-_]|llava|smolvlm|pixtral|paligemma|minicpm-v/i.test(id)
    };
  }
  const EXPAND = ["downloads", "likes", "gated", "lastModified", "createdAt", "tags", "gguf", "pipeline_tag", "author", "private"];

  /* ---------- search ---------- */
  // q = { query, sort: downloads|likes|newest|trending|updated, size: small|medium|large|"", vision, coding, tools, language, cursor }
  async function search(q) {
    q = q || {};
    let first = !q.cursor, url = "";
    if (q.cursor) {
      if (!String(q.cursor).startsWith(cfg.endpoint + "/api/")) throw new HfError("That page link is not valid.", "badcursor");
      url = q.cursor;
    } else {
      const p = new URLSearchParams();
      let text = String(q.query || "").trim();
      if (!text && q.coding) text = "coder";
      if (!text && q.tools) text = "tool";
      if (text) p.set("search", text);
      p.append("filter", "gguf");
      if (q.language && /^[a-z]{2,3}(-[A-Za-z]+)?$/.test(q.language)) p.append("filter", q.language);
      if (q.vision) p.set("pipeline_tag", "image-text-to-text");
      p.set("sort", SORTS[q.sort] || "downloads"); p.set("direction", "-1"); p.set("limit", "30");
      url = apiUrl("/models") + "?" + p.toString() + EXPAND.map((e) => "&expand[]=" + e).join("");
    }
    let r;
    try { r = await getJson(url, "That search"); }
    catch (e) { if (e.status === 400 && first) { r = await getJson(url.replace(/&expand\[\]=[a-zA-Z_]+/g, ""), "That search"); } else throw e; }
    let items = (Array.isArray(r.json) ? r.json : []).map(normItem).filter((x) => x.id);
    // filters the API cannot do itself (best effort, from names and tags)
    if (q.coding) items = items.filter((x) => /cod(e|er|ing)|starcoder|devstral|codestral/i.test(x.id + " " + x.tags.join(" ")));
    if (q.tools) items = items.filter((x) => /tool|function[-_ ]?call|hermes|xlam|toolace|gorilla/i.test(x.id + " " + x.tags.join(" ")));
    if (q.size) items = items.filter((x) => { const b = x.params / 1e9; return !b || (q.size === "small" ? b < 4 : q.size === "medium" ? b >= 4 && b <= 14 : b > 14); });
    return { items, next: r.next && r.next.startsWith(cfg.endpoint + "/api/") ? r.next : "" };
  }

  /* ---------- model page ---------- */
  async function listTree(repo, rev) {
    let url = apiUrl("/models/" + encRepo(repo) + "/tree/" + encodeURIComponent(rev || "main")) + "?recursive=true", out = [];
    for (let i = 0; i < 10 && url; i++) {
      const r = await getJson(url, "That model");
      out = out.concat(Array.isArray(r.json) ? r.json : []);
      url = r.next && r.next.startsWith(cfg.endpoint + "/api/") ? r.next : "";
    }
    return out;
  }
  let hwCache = null, hwAt = 0;
  async function winVramBytes() {
    const script = "$ErrorActionPreference='SilentlyContinue';$k='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*';" +
      "@(Get-ItemProperty $k | ForEach-Object { $v=$_.'HardwareInformation.qwMemorySize'; if($v -is [byte[]]){$v=[BitConverter]::ToInt64($v,0)}; if($v){ [pscustomobject]@{d=$_.DriverDesc;b=[int64]$v} } }) | ConvertTo-Json -Compress";
    return new Promise((resolve) => {
      try {
        execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 8000, windowsHide: true }, (err, out) => {
          if (err) return resolve(0);
          try { let j = JSON.parse(String(out).trim() || "[]"); if (!Array.isArray(j)) j = [j]; resolve(Math.max(0, ...j.filter((g) => g && !/microsoft basic|remote|virtual/i.test(g.d || "")).map((g) => Number(g.b) || 0))); } catch (e) { resolve(0); }
        });
      } catch (e) { resolve(0); }
    });
  }
  function linuxAmdVramBytes() {
    try { let best = 0; for (const d of fs.readdirSync("/sys/class/drm")) { if (!/^card\d+$/.test(d)) continue; try { best = Math.max(best, parseInt(fs.readFileSync("/sys/class/drm/" + d + "/device/mem_info_vram_total", "utf8"), 10) || 0); } catch (e) {} } return best; } catch (e) { return 0; }
  }
  // What this PC has: graphics memory (VRAM) and RAM. Also used for the "will it fit?" badges.
  async function hardware() {
    if (hwCache && Date.now() - hwAt < 60000) return hwCache;
    let h = {}; try { h = (o.hardwareFn ? await o.hardwareFn() : {}) || {}; } catch (e) {}
    const ramBytes = (Number(h.ramGB) || os.totalmem() / GB) * GB;
    const gpus = h.gpus || [];
    let vramBytes = 0, source = "", unified = false, gpuName = (gpus[0] && gpus[0].name) || "";
    if (cfg.vramOverrideGB > 0) { vramBytes = cfg.vramOverrideGB * GB; source = "set by you"; }
    else if (h.nvidia && h.nvidia.vramMB) { vramBytes = h.nvidia.vramMB * MB; source = "nvidia-smi"; gpuName = h.nvidia.name || gpuName; }
    else if (h.apple || o.platform === "darwin") { vramBytes = ramBytes * 0.7; unified = true; source = "shared memory (Apple)"; }
    else if (gpus.length) {
      const b = o.platform === "win32" ? await winVramBytes() : o.platform === "linux" ? linuxAmdVramBytes() : 0;
      if (b > 0) { vramBytes = b; source = "graphics driver"; }
    }
    hwCache = { vramBytes, ramBytes, unified, vramKnown: vramBytes > 0, hasGpu: !!(gpus.length || h.nvidia || h.apple || o.platform === "darwin"), gpuName, source, cpu: h.cpu || "", summary: h.summary || "" };
    hwAt = Date.now();
    return hwCache;
  }
  const hwView = (h) => ({ vramGB: Math.round(h.vramBytes / GB * 10) / 10, ramGB: Math.round(h.ramBytes / GB * 10) / 10, vramKnown: h.vramKnown, hasGpu: h.hasGpu, gpuName: h.gpuName, source: h.source, unified: h.unified, cpu: h.cpu });

  async function model(repo, revision) {
    const rev = revision || "main";
    if (!parseRepoInput(repo)) throw new HfError("That is not a Hugging Face model name (use user/repo).", "badrepo");
    const [info, tree, hw] = await Promise.all([getJson(apiUrl("/models/" + encRepo(repo) + "?blobs=true"), "That model"), listTree(repo, rev).catch((e) => { if (e.code === "notfound") return null; throw e; }), hardware()]);
    const m = info.json || {};
    const entries = tree || (m.siblings || []).map((s) => ({ type: "file", path: s.rfilename, size: s.size, lfs: s.lfs }));
    const { groups, mmproj } = buildFileGroups(entries);
    const fits = new Map();
    const files = groups.map((g) => { const f = estimateFit(g.size, hw); fits.set(g.id, f.fit); return { id: g.id, name: g.name, quant: g.quant, note: g.note, bits: g.bits, size: g.size, parts: g.parts, fit: f.fit, paths: g.files.map((x) => x.path), verified: g.files.every((x) => !!x.sha256) }; });
    const rec = pickRecommended(groups, fits);
    files.forEach((f) => { f.recommended = f.id === rec; });
    const item = normItem(Object.assign({}, m, { id: m.id || repo }));
    return Object.assign(item, {
      revision: rev, commit: m.sha || "", cardLicenseName: (m.cardData && m.cardData.license_name) || "", baseModel: (m.cardData && m.cardData.base_model) || "",
      files, mmproj: mmproj.map((x) => ({ path: x.path, name: x.path.split("/").pop(), quant: x.quant, size: x.size })),
      hasVision: item.vision || mmproj.length > 0, hardware: hwView(hw), url: cfg.endpoint + "/" + repo, tokenSet: !!cfg.tokenEnc
    });
  }
  async function readme(repo, revision) {
    if (!parseRepoInput(repo)) throw new HfError("That is not a Hugging Face model name.", "badrepo");
    const res = await getRes(cfg.endpoint + "/" + encRepo(repo) + "/raw/" + encodeURIComponent(revision || "main") + "/README.md", null, "The model card");
    if (res.status === 404) return { text: "" };
    if (!res.ok) throw explain(res.status, "The model card");
    let text = String(await res.text()).slice(0, 400000);
    let license = ""; const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (fm) { const l = /^license:\s*(.+)$/m.exec(fm[1]); if (l) license = l[1].trim(); text = text.slice(fm[0].length); }
    return { text, license };
  }
  function resolve(input) {
    let host = ""; try { host = new URL(cfg.endpoint).host; } catch (e) {}
    return parseRepoInput(input, host ? [host] : []);
  }
  async function whoami() {
    if (!getToken()) throw new HfError("No token is saved.", "notoken");
    const r = await getJson(apiUrl("/whoami-v2"), "Your account");
    const j = r.json || {};
    return { name: j.name || "", fullname: j.fullname || "", canRead: true };
  }
  async function starters() {
    const hw = await hardware();
    return { hardware: hwView(hw), items: STARTERS.map((s) => Object.assign({}, s, { fit: estimateFit(s.approxGB * GB, hw).fit })) };
  }

  /* ---------- downloads ---------- */
  let jobs = [];
  const rt = new Map();          // job id -> { ctl, stop: "pause"|"cancel"|"" , samples: [] }
  try { const j = JSON.parse(fs.readFileSync(jobsFile, "utf8")); if (Array.isArray(j.jobs)) jobs = j.jobs; } catch (e) {}
  const partOf = (job, f) => path.join(job.dir, f.rel) + ".part";
  const destOf = (job, f) => path.join(job.dir, f.rel);
  const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return -1; } };
  for (const j of jobs) {   // after a restart nothing is running: unfinished jobs wait for "Resume"
    if (ACTIVE.has(j.status) || j.status === "queued") { j.status = "paused"; j.note = "Interrupted when IcyWhite closed. Press Resume to continue."; }
    for (const f of j.files || []) { if (f.done) f.got = f.size; else { const s = sizeOf(partOf(j, f)); f.got = s > 0 ? s : 0; } }
  }
  let saveTimer = null;
  function saveJobs() {
    try { fs.mkdirSync(o.userDataDir, { recursive: true }); fs.writeFileSync(jobsFile + ".tmp", JSON.stringify({ jobs: jobs.map((j) => Object.assign({}, j)) })); fs.renameSync(jobsFile + ".tmp", jobsFile); } catch (e) {}
  }
  const saveSoon = () => { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; saveJobs(); }, 1500); if (saveTimer.unref) saveTimer.unref(); };
  const find = (id) => jobs.find((j) => j.id === id);

  function view(j) {
    const total = j.files.reduce((s, f) => s + f.size, 0), got = j.files.reduce((s, f) => s + (f.done ? f.size : Math.min(f.got || 0, f.size)), 0);
    const r = rt.get(j.id), last = r && r.samples.length ? r.samples[r.samples.length - 1][0] : 0;
    const speed = (r && j.status === "downloading" && Date.now() - last < 3000) ? (r.speed || 0) : 0;
    const cur = j.files.find((f) => !f.done);
    return { id: j.id, repo: j.repo, revision: j.revision, label: j.label, status: j.status, error: j.error || "", note: j.note || "", dir: j.dir, vision: !!j.vision,
      files: j.files.map((f) => ({ name: f.rel.split("/").pop(), size: f.size, got: f.done ? f.size : f.got || 0, done: !!f.done, kind: f.kind, verified: !!f.verified, hasSha: !!f.sha256 })),
      bytesTotal: total, bytesDone: got, pct: total ? Math.min(100, Math.floor(got / total * 1000) / 10) : 0, speed,
      etaSec: speed > 0 ? Math.round((total - got) / speed) : 0, current: cur ? cur.rel.split("/").pop() : "",
      verifyPct: j.status === "verifying" && r && r.verifyTotal ? Math.floor(r.verifyDone / r.verifyTotal * 100) : 0,
      createdAt: j.createdAt, finishedAt: j.finishedAt || 0, retries: (r && r.retries) || 0 };
  }
  const list = () => ({ jobs: jobs.map(view), active: jobs.filter((j) => ACTIVE.has(j.status)).length, queued: jobs.filter((j) => j.status === "queued").length });

  async function freeBytes(dir) {
    let d = dir; for (let i = 0; i < 40 && d; i++) { try { fs.statSync(d); break; } catch (e) { const p = path.dirname(d); if (p === d) break; d = p; } }
    const statfs = o.statfs || (fs.promises && fs.promises.statfs);
    if (!statfs) return Infinity;
    try { const s = await statfs(d); return Number(s.bavail) * Number(s.bsize); } catch (e) { return Infinity; }
  }
  const human = (n) => n >= GB ? (n / GB).toFixed(1) + " GB" : Math.max(1, Math.round(n / MB)) + " MB";
  async function checkDisk(job) {
    const remaining = job.files.reduce((s, f) => s + (f.done ? 0 : Math.max(0, f.size - Math.max(0, f.got || 0))), 0);
    if (!remaining) return;
    const free = await freeBytes(job.dir), need = remaining + 256 * MB;
    if (free < need) throw new HfError("Not enough free disk space in " + job.dir + ": about " + human(need) + " is needed and " + human(free) + " is free. Free some space or choose another models folder, then try again.", "disk");
  }

  // Create a download: files = repo paths picked on the model page; the tree is read again here so sizes and checksums are the real ones.
  async function add(req) {
    req = req || {};
    const parsed = parseRepoInput(req.repo); if (!parsed) throw new HfError("That is not a Hugging Face model name.", "badrepo");
    const repo = parsed.repo, rev = req.revision || "main", want = new Set((req.files || []).map(String));
    if (!want.size) throw new HfError("Pick a file to download first.", "nofiles");
    const tree = (await listTree(repo, rev)).filter((e) => e.type !== "directory" && /\.gguf$/i.test(e.path || ""));
    const byPath = new Map(tree.map((e) => [e.path, e]));
    const chosen = new Set();
    for (const p of want) {
      const e = byPath.get(p); if (!e) throw new HfError("The file " + p + " is not in that model.", "notfound");
      const sp = SPLIT_RE.exec(p);
      if (sp && !isMmprojPath(p)) tree.forEach((x) => { const s2 = SPLIT_RE.exec(x.path); if (s2 && s2[1] === sp[1] && s2[3] === sp[3] && x.path.slice(0, x.path.lastIndexOf("/") + 1) === p.slice(0, p.lastIndexOf("/") + 1)) chosen.add(x.path); });   // every part of a split model
      else chosen.add(p);
    }
    const modelFiles = [...chosen].filter((p) => !isMmprojPath(p)).sort(), projFiles = [...chosen].filter((p) => isMmprojPath(p));
    if (!modelFiles.length && !projFiles.length) throw new HfError("Pick a file to download first.", "nofiles");
    const author = safeSeg(repo.split("/")[0]), name = safeSeg(repo.split("/")[1]);
    const dir = path.join(o.modelsDir(), author, name);
    const modelDirRel = modelFiles.length ? path.dirname(safeRel(modelFiles[0])) : ".";
    const mk = (p, kind) => {
      const e = byPath.get(p), rel = kind === "mmproj" ? path.join(modelDirRel, safeSeg(p.split("/").pop())) : safeRel(p);
      return { path: p, rel: rel.split(path.sep).join("/"), size: Number(e.size || (e.lfs && e.lfs.size) || 0), sha256: (e.lfs && e.lfs.oid) || "", kind, done: false, got: 0, verified: false };
    };
    const files = modelFiles.map((p) => mk(p, "model")).concat(projFiles.map((p) => mk(p, "mmproj")));
    const dup = jobs.find((j) => j.repo === repo && j.revision === rev && !["done", "canceled"].includes(j.status) && j.files.map((f) => f.path).sort().join("|") === files.map((f) => f.path).sort().join("|"));
    if (dup) throw new HfError("That download is already in the list.", "dup");
    const job = { id: crypto.randomBytes(6).toString("hex"), repo, revision: rev, label: String(req.label || files[0].rel.split("/").pop()).slice(0, 160), createdAt: Date.now(), status: "queued", error: "", note: "", dir, vision: projFiles.length > 0, files };
    for (const f of job.files) { const d = sizeOf(destOf(job, f)); if (d >= 0 && f.size && d === f.size) { f.done = true; f.got = f.size; f.verified = true; } else { const s = sizeOf(partOf(job, f)); f.got = s > 0 ? s : 0; } }
    if (job.files.every((f) => f.done)) throw new HfError("You already have this file in " + dir + ".", "have");
    await checkDisk(job);   // refuse right away instead of failing half way
    jobs.unshift(job); saveJobs(); pump();
    return view(job);
  }

  function pump() {
    let running = jobs.filter((j) => ACTIVE.has(j.status)).length;
    for (const j of jobs.slice().reverse()) {   // oldest first
      if (running >= cfg.maxConcurrent) break;
      if (j.status === "queued" && !rt.has(j.id)) { running++; runJob(j); }
    }
  }
  const activeCount = () => Math.max(1, jobs.filter((j) => j.status === "downloading").length);

  async function runJob(job) {
    const r = { ctl: null, stop: "", speed: 0, samples: [], retries: 0, verifyDone: 0, verifyTotal: 0 };
    rt.set(job.id, r);
    job.status = "downloading"; job.error = ""; job.note = ""; saveJobs();
    try {
      await checkDisk(job);
      fs.mkdirSync(job.dir, { recursive: true });
      for (const f of job.files) {
        if (f.done) continue;
        if (r.stop) break;
        await downloadFile(job, f, r);
      }
      if (r.stop === "pause") { job.status = r.resumeAfter ? "queued" : "paused"; job.note = ""; }
      else if (r.stop === "cancel") { if (r.resumeAfter) job.status = "queued"; }
      else {
        job.status = "done"; job.finishedAt = Date.now(); job.note = "";
        if (cfg.notify && o.notify) { try { o.notify({ title: "Download finished", body: job.label + " is ready in your models folder." }); } catch (e) {} }
      }
    } catch (e) {
      if (r.stop === "pause") job.status = r.resumeAfter ? "queued" : "paused";
      else if (r.stop === "cancel") { if (r.resumeAfter) job.status = "queued"; }
      else { job.status = "error"; job.error = (e && e.message) || "The download failed."; if (cfg.notify && o.notify && e && e.code !== "disk") { try { o.notify({ title: "Download failed", body: job.label + ": " + job.error.slice(0, 140) }); } catch (x) {} } }
    } finally {
      r.speed = 0;
      if (r.stop === "cancel" && job.status === "canceled") removeParts(job);   // the file is closed by now
      if (rt.get(job.id) === r) rt.delete(job.id);
      saveJobs(); pump();
    }
  }

  function note(r, n) {
    const t = Date.now(); r.samples.push([t, n]);
    while (r.samples.length > 1 && t - r.samples[0][0] > 4000) r.samples.shift();
    const a = r.samples[0], dt = (t - a[0]) / 1000;
    r.speed = dt > 0.4 ? r.samples.reduce((s, x) => s + x[1], 0) / Math.max(dt, 1) : r.speed;
  }
  const isFatal = (e) => e && ["auth", "forbidden", "notfound", "disk", "sha", "write"].includes(e.code);

  async function downloadFile(job, f, r) {
    const dest = destOf(job, f), part = partOf(job, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = cfg.endpoint + "/" + encRepo(job.repo) + "/resolve/" + encodeURIComponent(job.revision) + "/" + encPath(f.path);
    let attempt = 0;
    for (;;) {
      if (r.stop) return;
      let have = Math.max(0, sizeOf(part));
      if (f.size && have > f.size) { try { fs.unlinkSync(part); } catch (e) {} have = 0; }
      f.got = have;
      if (!(f.size && have === f.size)) {
        try { await streamInto(job, f, r, url, part, have); }
        catch (e) {
          if (r.stop || isFatal(e)) throw e;
          attempt++; r.retries = attempt;
          if (attempt > o.maxRetries) throw new HfError("The connection kept failing (" + ((e && e.message) || "network error") + "). Check your internet, then press Retry. What was downloaded so far is kept.", "network");
          job.note = "Connection problem, trying again (" + attempt + "/" + o.maxRetries + ")…";
          await sleepMs(o.retryBaseMs * Math.pow(2, Math.min(attempt - 1, 4)));
          job.note = ""; continue;
        }
        if (r.stop) return;
      }
      // complete: check it, then (and only then) give it its real name
      const finalSize = sizeOf(part);
      if (f.size && finalSize !== f.size) { attempt++; if (attempt > o.maxRetries) throw new HfError("The file ended early. Press Retry to continue.", "network"); continue; }
      if (cfg.verify && f.sha256) {
        job.status = "verifying"; r.verifyDone = 0; r.verifyTotal = finalSize;
        const sum = await sha256File(part, (n) => { r.verifyDone = n; }, r);
        job.status = "downloading";
        if (r.stop) return;
        if (sum !== f.sha256.toLowerCase()) { try { fs.unlinkSync(part); } catch (e) {} f.got = 0; throw new HfError("The checksum (SHA-256) of " + f.rel.split("/").pop() + " does not match the one Hugging Face publishes, so the file was discarded. Press Retry to download it again.", "sha"); }
        f.verified = true;
      }
      try { try { fs.unlinkSync(dest); } catch (e) {} fs.renameSync(part, dest); } catch (e) { throw new HfError("Could not finish the file: " + e.message, "write"); }
      f.done = true; f.got = f.size || finalSize; saveJobs();
      return;
    }
  }

  async function sha256File(file, onProgress, r) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash("sha256"), s = fs.createReadStream(file, { highWaterMark: 4 * MB });
      let n = 0;
      s.on("data", (c) => { h.update(c); n += c.length; onProgress(n); if (r && r.stop) { s.destroy(); resolve(""); } });
      s.on("end", () => resolve(h.digest("hex")));
      s.on("error", reject);
    });
  }

  async function streamInto(job, f, r, url, part, have) {
    const ctl = new AbortController(); r.ctl = ctl;
    let stall = null, stalled = false;
    const kick = () => { clearTimeout(stall); stall = setTimeout(() => { stalled = true; ctl.abort(); }, o.stallMs); if (stall.unref) stall.unref(); };
    let fh = null;
    try {
      kick();
      const headers = headersFor(url, have > 0 ? { Range: "bytes=" + have + "-" } : {});
      let res;
      try { res = await fetchFn(url, { headers, signal: ctl.signal, redirect: "follow", cache: "no-store" }); }
      catch (e) { if (r.stop) return; throw new HfError(stalled ? "no data for " + Math.round(o.stallMs / 1000) + " seconds" : "network error", "network"); }
      if (res.status === 416) {   // asked for bytes beyond the end: the part file is already whole, or is wrong
        if (f.size && have >= f.size) return;
        try { fs.unlinkSync(part); } catch (e) {} f.got = 0; throw new HfError("restarting the file", "network");
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) throw explain(res.status, "The file " + f.path);
      if (res.status !== 200 && res.status !== 206) { if (res.status === 429 || res.status >= 500) throw new HfError("server answered " + res.status, "http", res.status); throw explain(res.status, "The file " + f.path); }
      let flag = "a";
      if (res.status === 200 && have > 0) { flag = "w"; have = 0; f.got = 0; }   // the server ignored the Range request: start over
      if (res.status === 206) {
        const cr = /bytes\s+(\d+)-/i.exec(res.headers.get("content-range") || "");
        if (cr && parseInt(cr[1], 10) !== have) { try { fs.unlinkSync(part); } catch (e) {} f.got = 0; throw new HfError("server resumed at the wrong place", "network"); }
      }
      if (!f.size) { const cl = parseInt(res.headers.get("content-length") || "0", 10); if (cl) f.size = cl + have; }
      fh = await fs.promises.open(part, flag);
      const reader = res.body.getReader(), t0 = Date.now();
      let streamed = 0;
      for (;;) {
        if (r.stop) { ctl.abort(); return; }
        let chunk;
        try { chunk = await reader.read(); } catch (e) { if (r.stop) return; throw new HfError(stalled ? "no data for " + Math.round(o.stallMs / 1000) + " seconds" : "the connection dropped", "network"); }
        if (chunk.done) break;
        kick();
        const buf = Buffer.from(chunk.value.buffer, chunk.value.byteOffset, chunk.value.byteLength);
        try { await fh.write(buf); } catch (e) { throw new HfError("Could not write to the disk: " + e.message, e.code === "ENOSPC" ? "disk" : "write"); }
        f.got += buf.length; streamed += buf.length; note(r, buf.length); saveSoon();
        if (cfg.speedLimitMBps > 0) {   // simple limiter: never run ahead of the allowed rate (shared between running downloads)
          const rate = cfg.speedLimitMBps * MB / activeCount(), ahead = streamed / rate * 1000 - (Date.now() - t0);
          if (ahead > 5) await sleepMs(Math.min(ahead, 1000));
        }
      }
    } finally {
      clearTimeout(stall);
      if (fh) { try { await fh.close(); } catch (e) {} }
      r.ctl = null;
    }
  }

  function stopRuntime(id, why) { const r = rt.get(id); if (r) { r.stop = why; try { if (r.ctl) r.ctl.abort(); } catch (e) {} } return !!r; }
  function removeParts(job) { for (const f of job.files) { if (!f.done) { try { fs.unlinkSync(partOf(job, f)); } catch (e) {} f.got = 0; } } }

  function pause(id) {
    const j = find(id); if (!j) throw new HfError("That download is not in the list.", "notfound");
    if (j.status === "queued") { j.status = "paused"; saveJobs(); }
    else if (ACTIVE.has(j.status)) { stopRuntime(id, "pause"); j.status = "paused"; }
    saveJobs(); return view(j);
  }
  function resume(id) {
    const j = find(id); if (!j) throw new HfError("That download is not in the list.", "notfound");
    if (["paused", "error", "canceled"].includes(j.status)) {
      j.status = "queued"; j.error = ""; j.note = "";
      const r = rt.get(id); if (r) r.resumeAfter = true;   // the old run is still winding down; it hands over when it ends
      saveJobs(); pump();
    }
    return view(j);
  }
  const retry = resume;
  function cancel(id) {
    const j = find(id); if (!j) throw new HfError("That download is not in the list.", "notfound");
    if (j.status === "done") return view(j);
    stopRuntime(id, "cancel"); j.status = "canceled"; j.error = ""; j.note = "";
    if (!rt.has(id)) removeParts(j);   // a running download removes its own .part files once it has stopped
    saveJobs(); pump(); return view(j);
  }
  function remove(id) {
    const j = find(id); if (!j) return list();
    if (j.status !== "done" && j.status !== "canceled") cancel(id);
    jobs = jobs.filter((x) => x.id !== id); saveJobs(); return list();
  }
  function clearFinished() { jobs = jobs.filter((j) => !["done", "canceled"].includes(j.status)); saveJobs(); return list(); }
  // App is closing: stop everything, keep the .part files, and remember where each download was.
  function shutdownSync() {
    for (const j of jobs) { if (ACTIVE.has(j.status) || j.status === "queued") { stopRuntime(j.id, "pause"); j.status = "paused"; j.note = "Interrupted when IcyWhite closed. Press Resume to continue."; } }
    saveJobs();
  }

  return { getConfig, setConfig, setToken, whoami, hardware: async () => hwView(await hardware()), search, model, readme, resolve, starters,
    add, list, pause, resume, retry, cancel, remove, clearFinished, shutdownSync, _jobs: () => jobs };
}

module.exports = { createHfManager, HfError, parseRepoInput, parseQuant, quantInfo, buildFileGroups, estimateFit, pickRecommended, STARTERS, DEFAULT_ENDPOINT };
