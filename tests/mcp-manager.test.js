// Tests for mcp-manager.js with a fake stdio MCP server and a fake HTTP one.  Run: node --test tests/mcp-manager.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createMcpManager, splitArgs, parseImport } = require("../mcp-manager.js");

const FAKE = path.join(__dirname, "fixtures", "fake-mcp-server.js");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
const fakeCfg = (name) => ({ name: name || "Files", transport: "stdio", command: process.execPath, args: [FAKE] });
const wait = async (cond, ms = 5000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); } };

test("splitArgs and parseImport", () => {
  assert.deepStrictEqual(splitArgs('-y @x/server "C:\\My Docs" \'a b\''), ["-y", "@x/server", "C:\\My Docs", "a b"]);
  const l = parseImport(JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "srv", "/tmp"], env: { K: 1 } }, web: { url: "http://localhost:9/mcp", headers: { A: "b" } } } }));
  assert.deepStrictEqual(l.map((x) => [x.name, x.transport]), [["fs", "stdio"], ["web", "http"]]); assert.strictEqual(l[0].env.K, "1");
  assert.strictEqual(parseImport('{"command":"node","args":["x.js"]}')[0].command, "node");
  assert.throws(() => parseImport("nope"), /not valid JSON/); assert.throws(() => parseImport("{}"), /No servers/);
});
test("stdio server: start, list tools (namespaced), call, error results, always-allow", async () => {
  const m = createMcpManager({ userDataDir: tmp() });
  await m.setGlobal({ enabled: true });
  const v = await m.saveServer(fakeCfg("My Files!")); const id = v.servers[0].id;
  await wait(() => m.view().servers[0].status === "ready");
  assert.deepStrictEqual(m.view().servers[0].tools.map((t) => t.name), ["echo", "boom", "exit"]);
  assert.ok(m.view().servers[0].log.some((l) => /booting/.test(l)));
  const t = await m.tools();
  assert.strictEqual(t.enabled, true); assert.deepStrictEqual(t.tools.map((x) => x.function.name), ["my_files__echo", "my_files__boom", "my_files__exit"]);
  assert.strictEqual(t.tools[0].type, "function"); assert.strictEqual(t.tools[0].function.parameters.required[0], "text");
  assert.strictEqual(t.names.my_files__echo.auto, false);
  const r = await m.call("my_files__echo", { text: "hi" }); assert.deepStrictEqual([r.ok, r.isError, r.text], [true, false, "echo: hi"]);
  const b = await m.call("my_files__boom", {}); assert.strictEqual(b.isError, true); assert.strictEqual(b.text, "it broke");
  assert.match((await m.call("nope__x", {})).text, /Unknown tool/);
  m.setAlways(id, "echo", true); assert.strictEqual((await m.tools()).names.my_files__echo.auto, true);
  m.setAlways(id, "echo", false); assert.strictEqual((await m.tools()).names.my_files__echo.auto, false);
  m.shutdownSync();
});
test("disabled globally -> no tools; settings persist across a restart", async () => {
  const dir = tmp(); const m = createMcpManager({ userDataDir: dir });
  await m.saveServer(fakeCfg()); assert.deepStrictEqual((await m.tools()).tools, []);
  m.setGlobal({ askEach: false });
  const m2 = createMcpManager({ userDataDir: dir }); assert.strictEqual(m2.view().servers.length, 1); assert.strictEqual(m2.view().askEach, false); assert.strictEqual(m2.view().enabled, false);
});
test("a server that crashes is reported, and a bad command gives a clear error", async () => {
  const m = createMcpManager({ userDataDir: tmp() }); await m.setGlobal({ enabled: true });
  await m.saveServer(fakeCfg()); await wait(() => m.view().servers[0].status === "ready");
  const r = await m.call("files__exit", {}); assert.strictEqual(r.ok, false); assert.match(r.text, /failed|stopped/);
  await wait(() => m.view().servers[0].status === "error"); assert.match(m.view().servers[0].error, /stopped/);
  assert.match((await m.call("files__echo", { text: "x" })).text, /Unknown tool|not running/);
  const bad = await m.saveServer({ name: "Bad", transport: "stdio", command: "/definitely/not/a/program-xyz", args: [] });
  const id = bad.servers.find((s) => s.name === "Bad").id;
  await wait(() => m.view().servers.find((s) => s.id === id).status === "error"); assert.match(m.view().servers.find((s) => s.id === id).error, /Could not start|stopped/);
  await assert.rejects(() => m.saveServer({ name: "x", transport: "stdio", command: "" }), /command/); await assert.rejects(() => m.saveServer({ name: "x", transport: "http", url: "ftp://x" }), /web address/);
  m.shutdownSync();
});
test("stop / restart / remove", async () => {
  const m = createMcpManager({ userDataDir: tmp() }); await m.setGlobal({ enabled: true });
  const id = (await m.saveServer(fakeCfg())).servers[0].id; await wait(() => m.view().servers[0].status === "ready");
  await m.stop(id); assert.strictEqual(m.view().servers[0].status, "stopped"); assert.deepStrictEqual((await m.tools()).tools.length >= 0, true);
  await m.start(id); assert.strictEqual(m.view().servers[0].status, "ready");
  await m.removeServer(id); assert.strictEqual(m.view().servers.length, 0); m.shutdownSync();
});
test("http server: JSON answers, event-stream answers, session id is sent back", async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const m = JSON.parse(body); seen.push([m.method, req.headers["mcp-session-id"] || "", req.headers["x-key"] || ""]);
      if (m.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      if (m.method === "initialize") { res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "S1" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "h" } } })); }
      if (m.method === "tools/list") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] } })); }
      if (m.method === "tools/call") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} }) + "\n\n"); return res.end("event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "pong" }] } }) + "\n\n"); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const m = createMcpManager({ userDataDir: tmp() }); await m.setGlobal({ enabled: true });
  await m.saveServer({ name: "Web", transport: "http", url: "http://127.0.0.1:" + srv.address().port + "/mcp", headers: { "x-key": "K" } });
  await wait(() => m.view().servers[0].status === "ready");
  const r = await m.call("web__ping", {}); assert.strictEqual(r.text, "pong");
  assert.ok(seen.some((s) => s[0] === "tools/list" && s[1] === "S1" && s[2] === "K"), JSON.stringify(seen));
  m.shutdownSync(); await new Promise((r) => srv.close(r));
});
test("long results are cut", async () => {
  const m = createMcpManager({ userDataDir: tmp(), spawnFn: null }); // no spawn needed: use http fake
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const q = JSON.parse(b); if (!q.id) { res.writeHead(202); return res.end(); } res.writeHead(200, { "content-type": "application/json" });
    const result = q.method === "initialize" ? { protocolVersion: "2025-03-26" } : q.method === "tools/list" ? { tools: [{ name: "big" }] } : { content: [{ type: "text", text: "x".repeat(50000) }] };
    res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); await m.setGlobal({ enabled: true });
  await m.saveServer({ name: "B", transport: "http", url: "http://127.0.0.1:" + srv.address().port }); await wait(() => m.view().servers[0].status === "ready");
  const r = await m.call("b__big", {}); assert.ok(r.text.length < 20300 && /cut/.test(r.text)); m.shutdownSync(); await new Promise((x) => srv.close(x));
});
