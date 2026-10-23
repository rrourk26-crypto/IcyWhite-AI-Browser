/* llama-memory.js — "will this model fit?" before it is loaded (main process, plain Node).
 *
 * Reads the model's .gguf header (layer count, width, attention heads) and estimates how much memory the weights, the
 * context (KV cache) and llama.cpp's working buffers need, then compares that with the free graphics memory (NVIDIA, via
 * nvidia-smi) and free RAM. The numbers are estimates ("about"), meant to catch the obvious "no way this fits" case
 * before a long load that ends in an out-of-memory error.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

const GB = 1073741824;
// bytes per cached value for each KV cache type
const CACHE_BYTES = { f32: 4, f16: 2, bf16: 2, q8_0: 34 / 32, q5_1: 24 / 32, q5_0: 22 / 32, q4_1: 20 / 32, q4_0: 18 / 32, iq4_nl: 18 / 32 };
const FIXED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

class Reader {
  constructor(fd, size) { this.fd = fd; this.size = size; this.pos = 0; this.buf = Buffer.alloc(1 << 20); this.start = 0; this.len = 0; }
  need(n) {
    if (this.pos < this.start || this.pos + n > this.start + this.len) {
      this.len = fs.readSync(this.fd, this.buf, 0, this.buf.length, this.pos); this.start = this.pos;
    }
    if (this.pos + n > this.start + this.len) throw new Error("unexpected end of file");
  }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.pos - this.start); this.pos += 4; return v; }
  u64() { this.need(8); const v = Number(this.buf.readBigUInt64LE(this.pos - this.start)); this.pos += 8; return v; }
  str(max) {
    const n = this.u64();
    if (n > (max || 4096)) { this.pos += n; return ""; }
    this.need(n); const s = this.buf.toString("utf8", this.pos - this.start, this.pos - this.start + n); this.pos += n; return s;
  }
  num(type) {
    const n = FIXED[type]; this.need(n); const o = this.pos - this.start; let v;
    switch (type) {
      case 0: case 7: v = this.buf.readUInt8(o); break; case 1: v = this.buf.readInt8(o); break;
      case 2: v = this.buf.readUInt16LE(o); break; case 3: v = this.buf.readInt16LE(o); break;
      case 4: v = this.buf.readUInt32LE(o); break; case 5: v = this.buf.readInt32LE(o); break;
      case 6: v = this.buf.readFloatLE(o); break; case 12: v = this.buf.readDoubleLE(o); break;
      default: v = Number(type === 10 ? this.buf.readBigUInt64LE(o) : this.buf.readBigInt64LE(o));
    }
    this.pos += n; return v;
  }
  value(type) {
    if (type === 8) return this.str(256);
    if (type === 9) {
      const et = this.u32(), n = this.u64();
      if (FIXED[et]) { if (n <= 512) { const a = []; for (let i = 0; i < n; i++) a.push(this.num(et)); return a; } this.pos += n * FIXED[et]; return null; }
      if (et === 8) { for (let i = 0; i < n; i++) { const l = this.u64(); this.pos += l; } return null; }
      throw new Error("unsupported array");
    }
    if (FIXED[type]) return this.num(type);
    throw new Error("unknown value type " + type);
  }
}

const metaCache = new Map();
// { arch, layers, embd, heads, headsKv, keyLen, ctxTrain } read from a .gguf header (null when it cannot be read)
function readGgufMeta(file) {
  let st; try { st = fs.statSync(file); } catch (e) { return null; }
  const ck = file + "|" + st.mtimeMs + "|" + st.size;
  if (metaCache.has(ck)) return metaCache.get(ck);
  let fd = null, out = null;
  try {
    fd = fs.openSync(file, "r");
    const r = new Reader(fd, st.size);
    if (r.u32() !== 0x46554747) throw new Error("not a gguf file");
    r.u32(); r.u64(); const kvCount = r.u64();
    const m = {};
    for (let i = 0; i < kvCount; i++) {
      const key = r.str(256); if (key.startsWith("tokenizer.")) break;
      const type = r.u32(), v = r.value(type);
      if (key === "general.architecture") m.arch = v;
      else if (key.endsWith(".block_count")) m.layers = v;
      else if (key.endsWith(".embedding_length")) m.embd = v;
      else if (key.endsWith(".attention.head_count")) m.heads = v;
      else if (key.endsWith(".attention.head_count_kv")) m.headsKv = v;
      else if (key.endsWith(".attention.key_length")) m.keyLen = v;
      else if (key.endsWith(".context_length")) m.ctxTrain = v;
    }
    const avg = (x) => (Array.isArray(x) ? (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0) : x);
    if (m.layers && m.embd && m.heads) out = { arch: m.arch || "", layers: m.layers, embd: m.embd, heads: avg(m.heads), headsKv: avg(m.headsKv || m.heads), keyLen: m.keyLen || 0, ctxTrain: m.ctxTrain || 0 };
  } catch (e) { out = null; } finally { if (fd != null) try { fs.closeSync(fd); } catch (e) {} }
  metaCache.set(ck, out);
  return out;
}

/* Bytes needed, split into graphics-card and RAM parts.
 *   weightsBytes   size of the model file(s) (+ vision file)         ctx, ngl   the settings that will be used
 *   cacheK/cacheV  KV cache types (default f16)                       meta       from readGgufMeta (or null)  */
function estimateBytes(o) {
  const meta = o.meta, ctx = Math.max(1, o.ctx | 0), ngl = Math.max(0, o.ngl | 0);
  let perToken = 0, layers = meta ? meta.layers : 0;
  if (meta) {
    const headDim = meta.keyLen || meta.embd / meta.heads;
    const kb = CACHE_BYTES[o.cacheK || "f16"] || 2, vb = CACHE_BYTES[o.cacheV || "f16"] || 2;
    perToken = meta.layers * meta.headsKv * headDim * (kb + vb);
  } else perToken = 0.00012 * o.weightsBytes;   // header unreadable: rough rule of thumb
  const kv = perToken * ctx;   // the context is shared between parallel slots, so it is counted once
  const overhead = 0.5 * GB + Math.min(1.5 * GB, ctx * 20000);   // compute buffers grow a little with context
  const frac = layers ? Math.min(1, ngl / layers) : (ngl > 0 ? 1 : 0);
  const gpuWeights = o.weightsBytes * frac, cpuWeights = o.weightsBytes - gpuWeights;
  const kvOnGpu = o.kvOffload === false ? 0 : frac;
  const gpu = frac > 0 ? gpuWeights + kv * kvOnGpu + overhead : 0;
  const cpu = cpuWeights + kv * (1 - kvOnGpu) + (frac > 0 ? 0.3 * GB : overhead);
  return { weights: o.weightsBytes, kv, overhead, gpu, cpu, total: o.weightsBytes + kv + overhead, layers, frac };
}

function runCmd(file, args, timeout) {
  return new Promise((resolve) => { try { execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? "" : String(out))); } catch (e) { resolve(""); } });
}
// Free / total graphics memory in bytes for the card with the most memory (NVIDIA only; null when unknown).
async function gpuMemory(nvidiaSmi) {
  const out = await runCmd(nvidiaSmi || "nvidia-smi", ["--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"], 4000);
  const rows = String(out).split(/\r?\n/).map((l) => l.split(",").map((x) => parseInt(x, 10))).filter((r) => r.length >= 2 && r[1] > 0);
  if (!rows.length) return null;
  rows.sort((a, b) => b[1] - a[1]);
  return { free: rows[0][0] * 1048576, total: rows[0][1] * 1048576 };
}

/* Compare an estimate with what is free. level: ok | tight | too_big | unknown */
function judge(est, mem) {
  const fmt = (b) => (b / GB).toFixed(1) + " GB";
  const parts = "weights " + fmt(est.weights) + " + context " + fmt(est.kv) + " + working memory " + fmt(est.overhead);
  const out = { level: "ok", needGB: +(est.total / GB).toFixed(2), gpuGB: +(est.gpu / GB).toFixed(2), cpuGB: +(est.cpu / GB).toFixed(2), freeGpuGB: mem.gpu ? +(mem.gpu.free / GB).toFixed(2) : null,
    totalGpuGB: mem.gpu ? +(mem.gpu.total / GB).toFixed(2) : null, freeRamGB: +(mem.ramFree / GB).toFixed(2), totalRamGB: +(mem.ramTotal / GB).toFixed(2), suggestNgl: null, message: "", parts };
  const issues = [];
  let worst = 0;   // 0 ok, 1 tight, 2 too big
  const bump = (n) => { if (n > worst) worst = n; };
  if (est.gpu > 0 && mem.gpu) {
    const r = est.gpu / (mem.gpu.free * 0.97);
    if (r > 1) { bump(2); issues.push("needs about " + fmt(est.gpu) + " of graphics memory but only " + fmt(mem.gpu.free) + " is free"); if (est.layers) out.suggestNgl = Math.max(0, Math.min(est.layers, Math.floor(est.layers * Math.max(0, (mem.gpu.free * 0.9 - est.overhead) / Math.max(1, est.weights + est.kv)))));}
    else if (r > 0.85) { bump(1); issues.push("will use most of the free graphics memory (" + fmt(est.gpu) + " of " + fmt(mem.gpu.free) + ")"); }
  }
  if (est.cpu > 0) {
    const r = est.cpu / (mem.ramFree * 0.92);
    if (r > 1) { bump(2); issues.push("needs about " + fmt(est.cpu) + " of RAM but only " + fmt(mem.ramFree) + " is free"); }
    else if (r > 0.85) { bump(1); issues.push("will use most of the free RAM (" + fmt(est.cpu) + " of " + fmt(mem.ramFree) + ")"); }
  }
  if (est.gpu > 0 && !mem.gpu) { out.gpuUnknown = true; }
  out.level = ["ok", "tight", "too_big"][worst];
  out.message = worst ? "This model " + issues.join(", and ") + "." : "Should fit: about " + fmt(est.total) + " (" + parts + ")." + (mem.gpu ? " Graphics memory free: " + fmt(mem.gpu.free) + "." : "");
  if (out.suggestNgl != null && worst === 2) out.message += " Try about " + out.suggestNgl + " GPU layers, a smaller context, or a smaller model.";
  else if (worst === 2) out.message += " Try a smaller context, fewer GPU layers, or a smaller model.";
  return out;
}

module.exports = { readGgufMeta, estimateBytes, gpuMemory, judge, CACHE_BYTES, GB, freeRam: () => ({ ramFree: os.freemem(), ramTotal: os.totalmem() }) };
