/* Run with:   node --test tests/llama-manager.test.js     (Node 18+, Linux/Mac/Windows)
 * Uses a tiny stand-in "llama-server" (a Node script) so no real model is needed. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { createLlamaManager, splitArgs, classifyRuntime, findRuntimes, pickRuntime, parseNvidiaSmi, finishHardware, gpuStartFailure } = require("../llama-manager.js");

const isWin = process.platform === "win32";
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oasis-llama-"));
  const llama = path.join(root, "llama"), models = path.join(root, "models"), data = path.join(root, "data");
  [llama, models, data].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const fake = path.join(llama, "fake.js");
  fs.writeFileSync(fake, `
    const a = process.argv.slice(2), g = (f) => a[a.indexOf(f) + 1];
    if (process.env.FAKE_CRASH || a.includes("--crash")) { console.error("failed to load model: out of memory"); process.exit(1); }
    console.error("ARGS " + JSON.stringify(a));
    const t0 = Date.now();
    require("http").createServer((q, r) => {
      if (q.url === "/health") { r.statusCode = Date.now() - t0 > 400 ? 200 : 503; return r.end("{}"); }
      r.end("{}");
    }).listen(+g("--port"), "127.0.0.1");`);
  const exe = path.join(llama, isWin ? "llama-server.exe" : "llama-server");
  if (isWin) fs.copyFileSync(process.execPath, exe);   // not used on Windows CI; kept simple
  else { fs.writeFileSync(exe, '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/fake.js" "$@"\n'); fs.chmodSync(exe, 0o755); }
  fs.writeFileSync(path.join(models, "tiny-q4.gguf"), "x".repeat(2048));
  fs.writeFileSync(path.join(models, "vis.gguf"), "x");
  fs.writeFileSync(path.join(models, "mmproj-vis.gguf"), "x");
  fs.mkdirSync(path.join(models, "sub"));
  fs.writeFileSync(path.join(models, "sub", "big-00001-of-00002.gguf"), "x".repeat(10));
  fs.writeFileSync(path.join(models, "sub", "big-00002-of-00002.gguf"), "x".repeat(10));
  return { root, mk: (extra) => createLlamaManager(Object.assign({ userDataDir: data, appDir: root, resourcesDir: null, exeDir: null, pollMs: 50 }, extra)) };
}

test("splitArgs handles quotes", () => {
  assert.deepEqual(splitArgs('-fa on --x "a b" \'c d\' ""'), ["-fa", "on", "--x", "a b", "c d", ""]);
});

test("finds the binary and lists models (skips mmproj and split parts, pairs vision)", () => {
  const s = sandbox(), m = s.mk();
  assert.ok(m.findBinary().includes("llama-server"));
  const { models } = m.listModels();
  assert.deepEqual(models.map((x) => x.id), ["sub/big-00001-of-00002.gguf", "tiny-q4.gguf", "vis.gguf"]);
  assert.equal(models.find((x) => x.id === "vis.gguf").mmproj, "mmproj-vis.gguf");
  assert.equal(models.find((x) => x.id.startsWith("sub/")).size, 20);
});

test("starts, becomes ready, passes the right flags, stops", { skip: isWin }, async () => {
  const s = sandbox(), m = s.mk();
  m.setConfig({ ctx: 4096, ngl: 7, extraArgs: "--foo 'a b'", port: 18081 });
  const st = await m.start({ model: "vis.gguf" });
  assert.equal(st.state, "starting");
  const ready = await m.whenSettled();
  assert.equal(ready.state, "ready");
  assert.equal(ready.apiBase, "http://127.0.0.1:18081/v1");
  assert.equal(ready.vision, true);
  const log = ready.log.join("\n");
  assert.match(log, /"-c","4096"/); assert.match(log, /"-ngl","7"/); assert.match(log, /--mmproj/); assert.match(log, /"--foo","a b"/); assert.match(log, /--alias","vis"/);
  const stopped = await m.stop();
  assert.equal(stopped.state, "stopped");
});

test("falls back to another port when the chosen one is busy", { skip: isWin }, async () => {
  const s = sandbox(), m = s.mk();
  const blocker = http.createServer().listen(18082, "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  m.setConfig({ port: 18082 });
  await m.start({ model: "tiny-q4.gguf" });
  const st = await m.whenSettled();
  assert.equal(st.state, "ready"); assert.notEqual(st.port, 18082);
  await m.stop(); blocker.close();
});

test("reports a crash with a helpful hint", { skip: isWin }, async () => {
  const s = sandbox(), m = s.mk();
  m.setConfig({ extraArgs: "--crash" });
  await m.start({ model: "tiny-q4.gguf" });
  const st = await m.whenSettled();
  assert.equal(st.state, "error"); assert.match(st.hint, /GPU memory/);
});

test("rejects missing binary, missing model and paths outside the models folder", async () => {
  const s = sandbox(), m = s.mk({ appDir: path.join(s.root, "nowhere") });
  assert.match((await m.start({ model: "tiny-q4.gguf" })).error, /not found/);
  const s2 = sandbox(), m2 = s2.mk();
  assert.match((await m2.start({ model: "nope.gguf" })).error, /not found/);
  assert.match((await m2.start({ model: "../../etc/passwd.gguf" })).error, /outside/);
  assert.match((await m2.start({ model: "" })).error, /No model/);
});

test("config persists and autoStart only runs when enabled", { skip: isWin }, async () => {
  const s = sandbox(); let m = s.mk();
  assert.equal((await m.autoStart()).state, "stopped");
  m.setConfig({ model: "tiny-q4.gguf", autoStart: true, port: 18083 });
  m = s.mk();   // new instance reads the saved file
  assert.equal(m.getConfig().autoStart, true);
  await m.autoStart();
  assert.equal((await m.whenSettled()).state, "ready");
  await m.stop();
});

/* ---------- v27: server settings, addresses, CORS / API key front door ---------- */
const { optionArgs, OPTION_DEFS } = require("../llama-manager.js");
const { corsFor } = require("../cors-proxy.js");

function get(port, urlPath, headers, method) {
  return new Promise((resolve, reject) => {
    const q = http.request({ host: "127.0.0.1", port, path: urlPath, method: method || "GET", headers: headers || {} }, (r) => {
      let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: b }));
    });
    q.on("error", reject); q.end();
  });
}

test("option settings become llama-server flags; empty or invalid means Default", () => {
  assert.deepEqual(optionArgs({}), ["--jinja"]);   // jinja stays on by default, as before
  const a = optionArgs({ batch: "1024", flashAttn: "on", cacheTypeK: "q8_0", mlock: "on", mmap: "off", webui: "off", thinking: "off", jinja: "off", temp: "0.7", tensorSplit: "3,1" });
  assert.deepEqual(a, ["--no-webui", "--no-jinja", "--reasoning-budget", "0", "-b", "1024", "-fa", "on", "-ctk", "q8_0", "--mlock", "--no-mmap", "-ts", "3,1", "--temp", "0.7"].sort((x, y) => a.indexOf(x) - a.indexOf(y)));
  assert.ok(a.includes("-b") && a[a.indexOf("-b") + 1] === "1024");
  // out of range / junk is dropped instead of breaking the command line
  assert.deepEqual(optionArgs({ batch: "-5", flashAttn: "maybe", mlock: "yes", tensorSplit: "3;rm", chatTemplate: 'a"b' }), ["--jinja"]);
  assert.ok(OPTION_DEFS.every((d) => d.type === "toggle" || d.internal || d.flag));
});

test("setConfig keeps only valid server settings, and reset restores the defaults", () => {
  const s = sandbox(), m = s.mk();
  m.setConfig({ host: "0.0.0.0", cors: "origins", corsOrigins: "http://a.com", apiKey: "sk-1\n", opts: { batch: "512", bogus: "1", flashAttn: "zzz" } });
  const c = m.getConfig();
  assert.equal(c.host, "0.0.0.0"); assert.equal(c.cors, "origins"); assert.equal(c.apiKey, "sk-1");
  assert.deepEqual(c.opts, { batch: "512" });
  m.setConfig({ host: "bad host!", cors: "weird" });
  assert.equal(m.getConfig().host, "127.0.0.1"); assert.equal(m.getConfig().cors, "all");
  m.setConfig({ model: "tiny-q4.gguf" }); m.setConfig({ reset: true });
  assert.equal(m.getConfig().host, "127.0.0.1"); assert.equal(m.getConfig().apiKey, ""); assert.equal(m.getConfig().model, "tiny-q4.gguf");
});

test("settings reach the command line; preview matches", { skip: isWin }, async () => {
  const s = sandbox(), m = s.mk();
  m.setConfig({ port: 18090, ctx: 16384, opts: { flashAttn: "on", parallel: "2", mmproj: "off" } });
  assert.match(m.preview("vis.gguf"), /-np 2/);
  await m.start({ model: "vis.gguf" });
  const st = await m.whenSettled();
  const log = st.log.join("\n");
  assert.match(log, /"-np","2"/); assert.match(log, /"-fa","on"/); assert.match(log, /"-c","16384"/);
  assert.doesNotMatch(log, /--mmproj/); assert.equal(st.vision, false);
  assert.equal(st.proxied, false);
  await m.stop();
});

test("serving on the network lists this computer and the network addresses", { skip: isWin }, async () => {
  const s = sandbox(), m = s.mk();
  m.setConfig({ host: "0.0.0.0", port: 18091 });
  await m.start({ model: "tiny-q4.gguf" });
  const st = await m.whenSettled();
  assert.equal(st.apiBase, "http://127.0.0.1:18091/v1");   // the app itself always talks to this computer
  assert.equal(st.addresses[0].url, "http://127.0.0.1:18091/v1");
  assert.match(st.log.join("\n"), /"--host","0.0.0.0"/);
  assert.ok(st.addresses.every((a) => /^http:\/\/[\d.]+:18091\/v1$/.test(a.url)));
  await m.stop();
});

test("corsFor applies the three rules", () => {
  assert.deepEqual(corsFor("all", [], "http://x.com"), { "Access-Control-Allow-Origin": "*" });
  assert.deepEqual(corsFor("off", [], "http://x.com"), {});
  assert.equal(corsFor("origins", ["http://a.com"], "http://a.com")["Access-Control-Allow-Origin"], "http://a.com");
  assert.deepEqual(corsFor("origins", ["http://a.com"], "http://evil.com"), {});
  assert.equal(corsFor("origins", ["*"], "http://evil.com")["Access-Control-Allow-Origin"], "http://evil.com");
});

test("front door: CORS rule, API key (not needed from this computer's own app), streaming, and shutdown", { skip: isWin }, async () => {
  const s = sandbox(), m = s.mk();
  m.setConfig({ port: 18092, cors: "origins", corsOrigins: "http://good.example", apiKey: "secret" });
  await m.start({ model: "tiny-q4.gguf" });
  const st = await m.whenSettled();
  assert.equal(st.state, "ready"); assert.equal(st.proxied, true); assert.equal(st.keyed, true);
  assert.match(st.log.join("\n"), /"--host","127.0.0.1"/);          // llama-server itself is hidden on loopback
  const pre = await get(18092, "/v1/chat/completions", { Origin: "http://good.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" }, "OPTIONS");
  assert.equal(pre.status, 204); assert.equal(pre.headers["access-control-allow-origin"], "http://good.example");
  assert.match(pre.headers["access-control-allow-headers"], /authorization/);
  const bad = await get(18092, "/v1/chat/completions", { Origin: "http://evil.example" }, "OPTIONS");
  assert.equal(bad.headers["access-control-allow-origin"], undefined);
  const h = await get(18092, "/health", { Origin: "http://good.example" });
  assert.equal(h.status, 200); assert.equal(h.headers["access-control-allow-origin"], "http://good.example");
  // requests from this computer (the app itself) work without the key
  assert.equal((await get(18092, "/v1/models")).status, 200);
  await m.stop();
  await assert.rejects(get(18092, "/health"));
});

test("front door rejects a missing/wrong key from other machines (trustLocal off simulates one)", async () => {
  const { createProxy } = require("../cors-proxy.js");
  const up = http.createServer((q, r) => { r.setHeader("Access-Control-Allow-Origin", "http://upstream"); r.end("hi"); }).listen(0, "127.0.0.1");
  await new Promise((r) => up.once("listening", r));
  const px = createProxy({ host: "127.0.0.1", port: 18093, targetPort: up.address().port, cors: "off", apiKey: "k", trustLocal: false });
  await px.listen();
  assert.equal((await get(18093, "/v1/models")).status, 401);
  assert.equal((await get(18093, "/v1/models", { Authorization: "Bearer nope" })).status, 401);
  const ok = await get(18093, "/v1/models", { Authorization: "Bearer k" });
  assert.equal(ok.status, 200); assert.equal(ok.body, "hi");
  assert.equal(ok.headers["access-control-allow-origin"], undefined);   // cors "off" also strips the upstream's header
  assert.equal((await get(18093, "/v1/models", { "x-api-key": "k" })).status, 200);
  assert.equal((await get(18093, "/health")).status, 200);               // health is always open
  await px.close(); up.closeAllConnections(); up.close();
});


/* ---------------- runtimes: telling builds apart and picking the right one for this PC ---------------- */
const CUDA_FILES = ["cublas64_12.dll", "cublasLt64_12.dll", "cudart64_12.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu-alderlake.dll", "ggml-cpu-haswell.dll", "ggml-cpu-x64.dll",
  "ggml-cpu-zen4.dll", "ggml-cuda.dll", "ggml-rpc.dll", "libomp.dll", "llama.dll", "llama-common.dll", "llama-server.exe", "llama-server-impl.dll", "mtmd.dll", "start.bat"];
const CPU_FILES = ["start.bat", "ggml.dll", "ggml-base.dll", "ggml-cpu-x64.dll", "libomp.dll", "llama.dll", "llama-common.dll", "llama-server.exe", "llama-server-impl.dll", "mtmd.dll"];
const hwNvidia = (cudaMax) => finishHardware({ gpus: [{ name: "NVIDIA GeForce RTX 4070", vendor: "nvidia" }], nvidia: { name: "NVIDIA GeForce RTX 4070", vramMB: 12282, driver: "560.94", cudaMax } });
const hwNone = () => finishHardware({ gpus: [] });

test("classifyRuntime recognises CUDA, CPU, Vulkan, AMD and Intel builds from their files", () => {
  const c = classifyRuntime(CUDA_FILES, "llama.cpp-GPU-NVIDIA CUDA");
  assert.equal(c.kind, "cuda"); assert.equal(c.cudaMajor, 12); assert.ok(c.cpuVariants >= 3);
  const u = classifyRuntime(CPU_FILES, "llama-cpu-tiny");
  assert.equal(u.kind, "cpu"); assert.equal(u.cpuVariants, 1);
  assert.equal(classifyRuntime(["llama-server.exe", "ggml-vulkan.dll", "ggml-cpu-x64.dll"], "x").kind, "vulkan");
  assert.equal(classifyRuntime(["llama-server.exe", "ggml-hip.dll"], "x").kind, "hip");
  assert.equal(classifyRuntime(["llama-server.exe", "ggml-sycl.dll"], "x").kind, "sycl");
  assert.equal(classifyRuntime(["llama-server.exe"], "llama-b1234-cuda-static").kind, "cuda");   // static build: folder name is the only clue
  assert.equal(classifyRuntime(["llama-server.exe"], "something").kind, "cpu");
});

function runtimeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oasis-rt-"));
  const make = (rel, files) => { const d = path.join(root, ...rel); fs.mkdirSync(d, { recursive: true }); fs.mkdirSync(path.join(d, "models"), { recursive: true }); files.forEach((f) => fs.writeFileSync(path.join(d, f), "x")); return d; };
  // the same folder layout as the one on the Desktop: the CUDA build is nested twice, the CPU build once inside llama-cpu
  const cuda = make(["runtimes", "llama.cpp-GPU-NVIDIA CUDA", "llama.cpp-GPU-NVIDIA CUDA"], CUDA_FILES);
  const cpu = make(["runtimes", "llama-cpu", "llama-cpu-tiny"], CPU_FILES);
  return { root, cuda, cpu, runtimes: path.join(root, "runtimes") };
}

test("findRuntimes finds both folders (nested too), ignores models folders, and reads their kind", () => {
  const t = runtimeTree();
  const list = findRuntimes([{ dir: t.runtimes, depth: 3 }], "llama-server.exe");
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((r) => r.kind).sort(), ["cpu", "cuda"]);
  assert.equal(list.find((r) => r.kind === "cuda").dir, t.cuda);
  assert.equal(list.find((r) => r.kind === "cpu").name, "llama-cpu-tiny");
  assert.deepEqual(findRuntimes([{ dir: path.join(t.root, "nope"), depth: 3 }], "llama-server.exe"), []);
});

test("pickRuntime: NVIDIA card -> CUDA; no GPU -> CPU; old driver -> CPU; AMD with only CUDA/CPU -> CPU", () => {
  const t = runtimeTree(), list = findRuntimes([{ dir: t.runtimes, depth: 3 }], "llama-server.exe");
  let p = pickRuntime(list, hwNvidia(13));
  assert.equal(p.runtime.kind, "cuda"); assert.match(p.reason, /NVIDIA GeForce RTX 4070 found/);
  p = pickRuntime(list, hwNone());
  assert.equal(p.runtime.kind, "cpu"); assert.match(p.reason, /no graphics card/);
  p = pickRuntime(list, hwNvidia(11));   // driver only supports CUDA 11, the build needs 12
  assert.equal(p.runtime.kind, "cpu");
  p = pickRuntime(list, finishHardware({ gpus: [{ name: "AMD Radeon RX 7800 XT", vendor: "amd" }] }));
  assert.equal(p.runtime.kind, "cpu"); assert.match(p.reason, /no matching AMD ROCm/);
  p = pickRuntime(list, finishHardware({ gpus: [{ name: "Intel(R) UHD Graphics 770", vendor: "intel" }] }));
  assert.equal(p.runtime.kind, "cpu");
  p = pickRuntime(list.filter((r) => r.kind === "cuda"), hwNone());   // only a CUDA build exists and there is no NVIDIA card
  assert.equal(p.runtime.kind, "cuda"); assert.match(p.reason, /may not start/);
  assert.equal(pickRuntime([], hwNvidia(13)).runtime, null);
});

test("pickRuntime prefers Vulkan on AMD / Arc, the newest CUDA, and the CPU build that adapts to more CPUs", () => {
  const rt = (name, kind, extra) => Object.assign({ id: name, dir: name, exe: name, name, kind, kindLabel: kind, cudaMajor: 0, cpuVariants: 0 }, extra);
  const amd = finishHardware({ gpus: [{ name: "AMD Radeon RX 7800 XT", vendor: "amd" }] });
  assert.equal(pickRuntime([rt("cpu", "cpu"), rt("vk", "vulkan")], amd).runtime.name, "vk");
  assert.equal(pickRuntime([rt("hip", "hip"), rt("vk", "vulkan")], amd).runtime.name, "hip");
  assert.equal(pickRuntime([rt("c11", "cuda", { cudaMajor: 11 }), rt("c12", "cuda", { cudaMajor: 12 })], hwNvidia(13)).runtime.name, "c12");
  assert.equal(pickRuntime([rt("tiny", "cpu", { cpuVariants: 1 }), rt("full", "cpu", { cpuVariants: 14 })], hwNone()).runtime.name, "full");
  const arc = finishHardware({ gpus: [{ name: "Intel(R) Arc(TM) A770", vendor: "intel" }] });
  assert.equal(pickRuntime([rt("cpu", "cpu"), rt("vk", "vulkan")], arc).runtime.name, "vk");
});

test("parseNvidiaSmi reads the card, memory, driver and the newest CUDA the driver supports", () => {
  const csv = "NVIDIA GeForce RTX 4070, 12282, 560.94\nNVIDIA GeForce GTX 1050, 2048, 560.94\n";
  const plain = "| NVIDIA-SMI 560.94                 Driver Version: 560.94         CUDA Version: 12.6     |";
  const r = parseNvidiaSmi(csv, plain);
  assert.equal(r.name, "NVIDIA GeForce RTX 4070"); assert.equal(r.vramMB, 12282); assert.equal(r.driver, "560.94"); assert.equal(r.cudaMax, 12); assert.equal(r.count, 2);
  assert.equal(parseNvidiaSmi("", ""), null);
});

test("gpuStartFailure: missing DLL / CUDA init errors fall back, running out of memory does not", () => {
  assert.equal(gpuStartFailure(3221225781, ""), true);
  assert.equal(gpuStartFailure(1, "ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected"), true);
  assert.equal(gpuStartFailure(1, "ggml_vulkan: Error: Failed to find a Vulkan device"), true);
  assert.equal(gpuStartFailure(1, "CUDA error: out of memory\ncudaMalloc failed: out of memory"), false);
  assert.equal(gpuStartFailure(1, "unknown model architecture: 'foo'"), false);
});

test("the manager picks the runtime from this PC's hardware, honors a manual choice, and finds models beside a runtime", () => {
  const t = runtimeTree(), exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  // the helper tree names the file llama-server.exe; use matching names for this platform
  [t.cuda, t.cpu].forEach((d) => { if (exe !== "llama-server.exe") fs.renameSync(path.join(d, "llama-server.exe"), path.join(d, exe)); });
  fs.writeFileSync(path.join(t.cpu, "models", "beside.gguf"), "x");
  const mk = (hardwareFn, extra) => createLlamaManager(Object.assign({ userDataDir: path.join(t.root, "data"), appDir: t.root, resourcesDir: null, exeDir: null, hardwareFn }, extra));
  return (async () => {
    let m = mk(async () => hwNvidia(13));
    let r = await m.listRuntimes();
    assert.equal(r.runtimes.length, 2); assert.equal(r.current.kind, "cuda"); assert.equal(r.auto, true);
    assert.equal(m.findBinary(), path.join(t.cuda, exe));
    assert.match(r.hardware.summary, /RTX 4070 \(12 GB/);
    m = mk(async () => hwNone());
    r = await m.listRuntimes();
    assert.equal(r.current.kind, "cpu"); assert.equal(m.findBinary(), path.join(t.cpu, exe));
    assert.equal(r.runtimes.find((x) => x.kind === "cuda").usable, false);
    assert.match(r.runtimes.find((x) => x.kind === "cuda").note, /NVIDIA/);
    assert.equal(m.listModels().models[0].id, "beside.gguf");   // models folder inside the runtime folder is used
    m.setConfig({ runtime: t.cuda });                            // chosen by hand wins over the automatic pick
    r = await m.listRuntimes();
    assert.equal(r.current.kind, "cuda"); assert.equal(r.auto, false); assert.equal(m.findBinary(), path.join(t.cuda, exe));
    m.setConfig({ runtime: path.join(t.root, "gone") });         // a choice that no longer exists falls back to automatic
    r = await m.listRuntimes();
    assert.equal(r.auto, true); assert.match(r.note, /not found/);
    m.setConfig({ runtime: "auto", binPath: path.join(t.cpu, exe) });   // a llama-server path set by hand still wins
    assert.equal(m.findBinary(), path.join(t.cpu, exe));
    // a runtimes folder chosen in Settings is searched too
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "oasis-rt2-"));
    fs.mkdirSync(path.join(other, "vk")); fs.writeFileSync(path.join(other, "vk", exe), "x"); fs.writeFileSync(path.join(other, "vk", "ggml-vulkan.dll"), "x");
    m.setConfig({ binPath: "", runtimesDir: other });
    assert.equal((await m.listRuntimes({ rescan: true })).runtimes.some((x) => x.kind === "vulkan"), true);
  })();
});

test("an automatically chosen GPU runtime that cannot start falls back to the CPU runtime once", { skip: isWin }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oasis-fb-"));
  const rt = (name, body) => { const d = path.join(root, "runtimes", name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "llama-server"), body); fs.chmodSync(path.join(d, "llama-server"), 0o755); return d; };
  const gpu = rt("gpu", '#!/bin/sh\necho "ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected" >&2\nexit 1\n');
  fs.writeFileSync(path.join(gpu, "ggml-cuda.dll"), "x"); fs.writeFileSync(path.join(gpu, "cudart64_12.dll"), "x");
  const cpu = rt("cpu", '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/fake.js" "$@"\n');
  fs.writeFileSync(path.join(cpu, "fake.js"), 'const a=process.argv.slice(2),g=(f)=>a[a.indexOf(f)+1];const t0=Date.now();require("http").createServer((q,r)=>{if(q.url==="/health"){r.statusCode=Date.now()-t0>300?200:503;return r.end("{}")}r.end("{}")}).listen(+g("--port"),"127.0.0.1");');
  fs.mkdirSync(path.join(root, "models")); fs.writeFileSync(path.join(root, "models", "m.gguf"), "x");
  const mk = () => createLlamaManager({ userDataDir: path.join(root, "data"), appDir: root, resourcesDir: null, exeDir: null, pollMs: 50, hardwareFn: async () => hwNvidia(13) });

  let m = mk(); m.setConfig({ port: 18191 });
  await m.start({ model: "m.gguf" });
  let st = await m.whenSettled();
  for (let i = 0; i < 100 && st.state !== "ready"; i++) { await new Promise((r) => setTimeout(r, 50)); st = await m.whenSettled(); }
  assert.equal(st.state, "ready", st.error);
  assert.equal(st.runtime.kind, "cpu"); assert.match(st.notice, /switched to the CPU runtime/);
  assert.match(st.log.join("\n"), /could not start, so the CPU runtime/);
  await m.stop();

  m = mk(); m.setConfig({ port: 18192, runtime: gpu });   // you chose the GPU build yourself: no silent switch, you see the problem
  await m.start({ model: "m.gguf" });
  st = await m.whenSettled();
  assert.equal(st.state, "error");
  await m.stop();
});
