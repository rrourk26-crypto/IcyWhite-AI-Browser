/* node --test tests/llama-multi.test.js   (uses a stand-in llama-server, no real model needed) */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { createLlamaManager } = require("../llama-manager.js");
const { createMultiLlama } = require("../llama-multi.js");
const isWin = process.platform === "win32";

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oasis-multi-"));
  const llama = path.join(root, "llama"), models = path.join(root, "models"), data = path.join(root, "data");
  [llama, models, data].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  fs.writeFileSync(path.join(llama, "fake.js"), `
    const a = process.argv.slice(2), g = (f) => a[a.indexOf(f) + 1]; const t0 = Date.now();
    console.error("ARGS " + JSON.stringify(a));
    require("http").createServer((q, r) => { if (q.url === "/health") { r.statusCode = Date.now() - t0 > 200 ? 200 : 503; return r.end("{}"); } r.end("{}"); }).listen(+g("--port"), "127.0.0.1");`);
  const exe = path.join(llama, "llama-server");
  fs.writeFileSync(exe, '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/fake.js" "$@"\n'); fs.chmodSync(exe, 0o755);
  ["a.gguf", "b.gguf", "c.gguf"].forEach((n) => fs.writeFileSync(path.join(models, n), "x"));
  const mk = (cfgName) => createLlamaManager({ cfgName, userDataDir: data, appDir: root, resourcesDir: null, exeDir: null, pollMs: 40, hardwareFn: async () => ({}) });
  return { root, data, mk };
}
const until = async (f) => { for (let i = 0; i < 100; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("timeout"); };

test("runs the main model and extra models at the same time on different ports", { skip: isWin }, async () => {
  const s = sandbox(), main = s.mk();
  main.setConfig({ port: 18300, ctx: 4096, opts: { flashAttn: "on" } });
  const multi = createMultiLlama({ primary: main, makeManager: s.mk, userDataDir: s.data });
  await main.start({ model: "a.gguf" }); await main.whenSettled();
  let r = await multi.add({ model: "b.gguf", ctx: 2048, ngl: 5 });
  assert.equal(r.slots.length, 1);
  await until(() => multi.list().slots[0].state === "ready");
  r = await multi.add({ model: "c.gguf" });
  await until(() => multi.list().slots.every((x) => x.state === "ready"));
  r = multi.list();
  const ports = [main.getStatus().port].concat(r.slots.map((x) => x.port));
  assert.equal(new Set(ports).size, 3, "three different ports");
  assert.equal(r.slots[0].ctx, 2048);
  assert.equal(r.running, 3);
  assert.ok(r.slots[0].log.join("\n").includes('"-fa","on"'), "settings are copied from the main model");
  assert.ok(r.slots[0].log.join("\n").includes('"-c","2048"'));
  await multi.stopAll(); await main.stop();
});

test("respects the limit, can stop, reload with new settings and remove", { skip: isWin }, async () => {
  const s = sandbox(), main = s.mk();
  main.setConfig({ port: 18400 });
  const multi = createMultiLlama({ primary: main, makeManager: s.mk, userDataDir: s.data });
  multi.setMax(2);
  await main.start({ model: "a.gguf" }); await main.whenSettled();
  await multi.add({ model: "b.gguf" }); await until(() => multi.list().slots[0].state === "ready");
  const over = await multi.add({ model: "c.gguf" });
  assert.ok(over.error && /limit/i.test(over.error));
  const id = multi.list().slots[0].id;
  await multi.stop(id); assert.equal(multi.list().slots[0].state, "stopped");
  await multi.reload(id, { ctx: 1024 }); await until(() => multi.list().slots[0].state === "ready");
  assert.equal(multi.list().slots[0].ctx, 1024);
  await multi.remove(id); assert.equal(multi.list().slots.length, 0);
  await main.stop();
});

test("the list survives a restart of the app", { skip: isWin }, async () => {
  const s = sandbox(), main = s.mk(); main.setConfig({ port: 18500, autoStart: true });
  let multi = createMultiLlama({ primary: main, makeManager: s.mk, userDataDir: s.data });
  await main.start({ model: "a.gguf" }); await main.whenSettled();
  await multi.add({ model: "b.gguf" }); await until(() => multi.list().slots[0].state === "ready");
  multi.shutdownSync(); main.shutdownSync();
  const main2 = s.mk(); multi = createMultiLlama({ primary: main2, makeManager: s.mk, userDataDir: s.data });
  assert.equal(multi.list().slots.length, 1); assert.equal(multi.list().slots[0].state, "stopped");
  await main2.autoStart(); await main2.whenSettled(); await multi.autoStart();
  await until(() => multi.list().slots[0].state === "ready");
  multi.shutdownSync(); main2.shutdownSync();
});
