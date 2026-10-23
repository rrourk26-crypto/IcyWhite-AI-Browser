/* node --test tests/llama-memory.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { readGgufMeta, estimateBytes, judge, GB } = require("../llama-memory.js");
const { createLlamaManager } = require("../llama-manager.js");
const { createMultiLlama } = require("../llama-multi.js");

// a tiny valid .gguf header: architecture, layers, width, heads, kv heads, then a big tokenizer array that must not be read
function writeGguf(file, kv) {
  const parts = [Buffer.from("GGUF"), Buffer.alloc(4), Buffer.alloc(8), Buffer.alloc(8)];
  parts[1].writeUInt32LE(3, 0);
  const str = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([l, b]); };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const body = [];
  body.push(str("general.architecture"), u32(8), str("llama"));
  for (const [k, v] of kv) body.push(str(k), u32(4), u32(v));
  body.push(str("tokenizer.ggml.tokens"), u32(9), u32(8), Buffer.alloc(8, 255));   // never parsed
  parts[3].writeBigUInt64LE(BigInt(kv.length + 2));
  fs.writeFileSync(file, Buffer.concat(parts.concat(body)));
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oasis-mem-"));

test("reads the layer / width / head counts from a gguf header", () => {
  const d = tmp(), f = path.join(d, "m.gguf");
  writeGguf(f, [["llama.block_count", 32], ["llama.embedding_length", 4096], ["llama.attention.head_count", 32], ["llama.attention.head_count_kv", 8], ["llama.context_length", 8192]]);
  assert.deepEqual(readGgufMeta(f), { arch: "llama", layers: 32, embd: 4096, heads: 32, headsKv: 8, keyLen: 0, ctxTrain: 8192 });
  assert.equal(readGgufMeta(path.join(d, "nope.gguf")), null);
});

test("context memory grows with context size and shrinks with a quantized cache", () => {
  const meta = { layers: 32, embd: 4096, heads: 32, headsKv: 8, keyLen: 0 };
  const a = estimateBytes({ weightsBytes: 4 * GB, meta, ctx: 8192, ngl: 99 }), b = estimateBytes({ weightsBytes: 4 * GB, meta, ctx: 32768, ngl: 99 });
  assert.ok(Math.abs(a.kv - 1 * GB) < 0.01 * GB, "8K context of this model is about 1 GB");   // 32*8*128*(2+2)*8192
  assert.ok(b.kv > a.kv * 3.9);
  const q = estimateBytes({ weightsBytes: 4 * GB, meta, ctx: 8192, ngl: 99, cacheK: "q8_0", cacheV: "q8_0" });
  assert.ok(q.kv < a.kv * 0.6);
  const cpu = estimateBytes({ weightsBytes: 4 * GB, meta, ctx: 8192, ngl: 0 });
  assert.equal(cpu.gpu, 0); assert.ok(cpu.cpu > 4 * GB);
});

test("judge says ok / tight / too big and suggests fewer GPU layers", () => {
  const meta = { layers: 32, embd: 4096, heads: 32, headsKv: 8, keyLen: 0 };
  const est = estimateBytes({ weightsBytes: 8 * GB, meta, ctx: 8192, ngl: 99 });
  const ram = { ramFree: 32 * GB, ramTotal: 32 * GB };
  assert.equal(judge(est, Object.assign({ gpu: { free: 24 * GB, total: 24 * GB } }, ram)).level, "ok");
  assert.equal(judge(est, Object.assign({ gpu: { free: 10 * GB, total: 24 * GB } }, ram)).level, "tight");
  const bad = judge(est, Object.assign({ gpu: { free: 6 * GB, total: 8 * GB } }, ram));
  assert.equal(bad.level, "too_big"); assert.ok(bad.suggestNgl >= 0 && bad.suggestNgl < 32); assert.match(bad.message, /GPU layers/);
  const cpu = estimateBytes({ weightsBytes: 40 * GB, meta, ctx: 8192, ngl: 0 });
  assert.equal(judge(cpu, { gpu: null, ramFree: 16 * GB, ramTotal: 32 * GB }).level, "too_big");
});

test("the server log is written to a file and rotated", { skip: process.platform === "win32" }, async () => {
  const root = tmp(), llama = path.join(root, "llama"), models = path.join(root, "models"), data = path.join(root, "data"), logs = path.join(root, "logs");
  [llama, models, data].forEach((x) => fs.mkdirSync(x, { recursive: true }));
  fs.writeFileSync(path.join(llama, "fake.js"), 'const a=process.argv.slice(2),g=(f)=>a[a.indexOf(f)+1];for(let i=0;i<200;i++)console.error("line "+i+" "+"x".repeat(80));require("http").createServer((q,r)=>{r.statusCode=200;r.end("{}")}).listen(+g("--port"),"127.0.0.1");');
  const exe = path.join(llama, "llama-server"); fs.writeFileSync(exe, '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/fake.js" "$@"\n'); fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(models, "a.gguf"), "x");
  const m = createLlamaManager({ userDataDir: data, appDir: root, resourcesDir: null, exeDir: null, pollMs: 30, hardwareFn: async () => ({}), logDir: logs, logMaxBytes: 5000 });
  m.setConfig({ port: 18700 });
  for (let i = 0; i < 3; i++) { await m.start({ model: "a.gguf" }); await m.whenSettled(); await new Promise((r) => setTimeout(r, 300)); await m.stop(); m.flushLog(); }
  const files = fs.readdirSync(logs).sort();
  assert.ok(files.includes("llama-server.log"), "log file exists");
  assert.ok(files.includes("llama-server.log.1"), "an older file was kept by rotation");
  assert.ok(files.length <= 3, "at most 3 files");
  assert.match(fs.readFileSync(path.join(logs, "llama-server.log"), "utf8"), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d  /);
});

test("auto-start loads one model at a time and skips one that will not fit", { skip: process.platform === "win32" }, async () => {
  const root = tmp(), llama = path.join(root, "llama"), models = path.join(root, "models"), data = path.join(root, "data");
  [llama, models, data].forEach((x) => fs.mkdirSync(x, { recursive: true }));
  fs.writeFileSync(path.join(llama, "fake.js"), 'const a=process.argv.slice(2),g=(f)=>a[a.indexOf(f)+1];const t0=Date.now();require("http").createServer((q,r)=>{r.statusCode=Date.now()-t0>250?200:503;r.end("{}")}).listen(+g("--port"),"127.0.0.1");');
  const exe = path.join(llama, "llama-server"); fs.writeFileSync(exe, '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/fake.js" "$@"\n'); fs.chmodSync(exe, 0o755);
  ["a.gguf", "b.gguf", "c.gguf"].forEach((n) => fs.writeFileSync(path.join(models, n), "x"));
  const mk = (cfgName) => createLlamaManager({ cfgName, userDataDir: data, appDir: root, resourcesDir: null, exeDir: null, pollMs: 30, hardwareFn: async () => ({}) });
  const main = mk(); main.setConfig({ port: 18800, autoStart: true, model: "a.gguf" });
  const multi = createMultiLlama({ primary: main, makeManager: mk, userDataDir: data, staggerMs: 0 });
  await main.start({ model: "a.gguf" }); await main.whenSettled();
  await multi.add({ model: "b.gguf" }); await multi.add({ model: "c.gguf" });
  await new Promise((r) => setTimeout(r, 600));
  multi.shutdownSync(); main.shutdownSync();
  // restart: pretend c.gguf will not fit
  const main2 = mk(), real = main2.estimate; main2.estimate = async (model) => (model === "c.gguf" ? { level: "too_big", message: "needs 99 GB" } : real(model));
  const multi2 = createMultiLlama({ primary: main2, makeManager: mk, userDataDir: data, staggerMs: 0 });
  await main2.autoStart();
  const t0 = Date.now(); await multi2.autoStart();
  const l = multi2.list().slots;
  assert.equal(l.find((s) => s.model === "b.gguf").state, "ready");
  const c = l.find((s) => s.model === "c.gguf");
  assert.equal(c.state, "stopped"); assert.match(c.note, /Not started at launch: needs 99 GB/);
  multi2.shutdownSync(); main2.shutdownSync();
});
