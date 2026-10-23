/* MCP client for IcyWhite (main process; no Electron imports so it can be tested with plain Node).
 *
 * MCP = Model Context Protocol: small programs ("servers") that give the AI tools, e.g. read files in a folder, fetch a web page.
 * This file starts the servers you configured, asks them which tools they have, and runs a tool when the AI asks (the chat asks
 * you first, see js/mcp-tools.js). Two ways to talk to a server:
 *   "stdio"  IcyWhite starts a program on this computer (e.g.  npx -y @modelcontextprotocol/server-filesystem C:\folder )
 *            and talks to it through its input / output, one JSON message per line.
 *   "http"   a server that is already running at a web address ("streamable HTTP"): JSON or an event stream per request.
 * The settings (servers, which tools are always allowed) are kept in mcp-config.json in the app's data folder.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PROTOCOL = "2025-03-26";
const START_TIMEOUT_MS = 90000;   // the first run of `npx` may have to download the server
const CALL_TIMEOUT_MS = 120000;
const MAX_RESULT_CHARS = 20000;
const slug = (s) => String(s || "server").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "server";
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

// "a b 'c d'" -> ["a","b","c d"]
function splitArgs(s) {
  const out = []; let cur = "", q = "", has = false;
  for (const ch of String(s || "")) {
    if (q) { if (ch === q) q = ""; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
// Accepts the {"mcpServers": {...}} format used by Claude Desktop and LM Studio (or just the inner object, or one server).
function parseImport(text) {
  let j; try { j = JSON.parse(String(text || "")); } catch (e) { throw new Error("That is not valid JSON."); }
  let map = j && j.mcpServers ? j.mcpServers : j && j.servers ? j.servers : j;
  if (map && (map.command || map.url) && !Array.isArray(map)) map = { server: map };
  if (!map || typeof map !== "object") throw new Error("No servers found. Expected {\"mcpServers\": {\"name\": {\"command\": ..., \"args\": [...]}}}.");
  const out = [];
  for (const [name, v] of Object.entries(map)) {
    if (!v || typeof v !== "object") continue;
    if (v.command) out.push({ name, transport: "stdio", command: String(v.command), args: Array.isArray(v.args) ? v.args.map(String) : splitArgs(v.args), env: v.env && typeof v.env === "object" ? Object.fromEntries(Object.entries(v.env).map(([k, x]) => [k, String(x)])) : {} });
    else if (v.url) out.push({ name, transport: "http", url: String(v.url), headers: v.headers && typeof v.headers === "object" ? Object.fromEntries(Object.entries(v.headers).map(([k, x]) => [k, String(x)])) : {} });
  }
  if (!out.length) throw new Error("No servers found in that JSON.");
  return out;
}

/* ---------------- stdio transport ---------------- */
class StdioClient {
  constructor(cfg, o, log) { this.cfg = cfg; this.o = o; this.log = log; this.nextId = 1; this.pending = new Map(); this.buf = ""; this.child = null; this.closed = false; this.onNotify = null; }
  start() {
    const env = Object.assign({}, process.env, this.cfg.env || {});
    const isWin = this.o.platform === "win32";
    // On Windows `npx` / `uvx` are .cmd files, which need a shell to start.
    const child = this.o.spawnFn(this.cfg.command, this.cfg.args || [], { env, shell: isWin, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], cwd: this.cfg.cwd || undefined });
    this.child = child;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => this.onData(d));
    child.stderr.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => this.log(l)));
    child.on("error", (e) => this.fail(new Error("Could not start: " + e.message)));
    child.on("exit", (code, sig) => { this.fail(new Error("The server stopped" + (code != null ? " (exit " + code + ")" : sig ? " (" + sig + ")" : ""))); if (this.onExit) this.onExit(code, sig); });
    child.stdin.on("error", () => {});
  }
  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch (e) { this.log(line.slice(0, 300)); continue; }
      this.onMessage(m);
    }
  }
  onMessage(m) {
    if (m && m.id !== undefined && (m.result !== undefined || m.error) && !m.method) {
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(Object.assign(new Error(m.error.message || "MCP error"), { code: m.error.code })); else p.resolve(m.result);
    } else if (m && m.method && m.id !== undefined) {   // the server asks us something
      this.send(m.method === "ping" ? { jsonrpc: "2.0", id: m.id, result: {} } : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Not supported by IcyWhite" } });
    } else if (m && m.method && this.onNotify) this.onNotify(m.method, m.params);
  }
  send(obj) { try { this.child.stdin.write(JSON.stringify(obj) + "\n"); } catch (e) {} }
  request(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("The server is not running."));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("The server did not answer in time (" + method + ").")); }, timeoutMs || CALL_TIMEOUT_MS);
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params: params || {} });
    });
  }
  notify(method, params) { this.send({ jsonrpc: "2.0", method, params: params || {} }); }
  fail(err) { this.closed = true; for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); }
  close() {
    this.closed = true;
    try { this.child && this.child.stdin.end(); } catch (e) {}
    const c = this.child; if (!c) return;
    setTimeout(() => { try { if (!c.killed) c.kill(); } catch (e) {} }, 800).unref();
  }
  killNow() { this.closed = true; try { this.child && this.child.kill(); } catch (e) {} }
}

/* ---------------- streamable HTTP transport ---------------- */
class HttpClient {
  constructor(cfg, o, log) { this.cfg = cfg; this.o = o; this.log = log; this.nextId = 1; this.session = ""; this.closed = false; this.onNotify = null; this.ctls = new Set(); }
  start() {}
  async post(body, timeoutMs, expectId) {
    const ctl = new AbortController(); this.ctls.add(ctl);
    const timer = setTimeout(() => ctl.abort(), timeoutMs || CALL_TIMEOUT_MS);
    try {
      const headers = Object.assign({ "content-type": "application/json", accept: "application/json, text/event-stream" }, this.cfg.headers || {});
      if (this.session) headers["mcp-session-id"] = this.session;
      if (this.protocol) headers["mcp-protocol-version"] = this.protocol;
      let res;
      try { res = await this.o.fetchFn(this.cfg.url, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal }); }
      catch (e) { throw new Error(ctl.signal.aborted ? "The server did not answer in time." : "Could not reach " + this.cfg.url + " (" + (e && e.message || "network error") + ")"); }
      const sid = res.headers.get("mcp-session-id"); if (sid) this.session = sid;
      if (res.status === 202 || res.status === 204) { try { await res.text(); } catch (e) {} return null; }
      if (!res.ok) { let t = ""; try { t = (await res.text()).slice(0, 200); } catch (e) {} throw new Error("The server answered " + res.status + (t ? ": " + t : "")); }
      const ct = String(res.headers.get("content-type") || "");
      if (/text\/event-stream/i.test(ct)) return await this.readSse(res, expectId);
      const j = await res.json();
      return Array.isArray(j) ? j.find((x) => x && x.id === expectId) || j[0] : j;
    } finally { clearTimeout(timer); this.ctls.delete(ctl); }
  }
  async readSse(res, expectId) {
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let m; try { m = JSON.parse(data); } catch (e) { continue; }
        if (m && m.id === expectId && (m.result !== undefined || m.error)) { try { reader.cancel(); } catch (e) {} return m; }
        if (m && m.method && m.id === undefined && this.onNotify) this.onNotify(m.method, m.params);
      }
    }
    throw new Error("The server ended the answer without a result.");
  }
  async request(method, params, timeoutMs) {
    if (this.closed) throw new Error("The server is not running.");
    const id = this.nextId++;
    const m = await this.post({ jsonrpc: "2.0", id, method, params: params || {} }, timeoutMs, id);
    if (!m) throw new Error("Empty answer from the server.");
    if (m.error) throw Object.assign(new Error(m.error.message || "MCP error"), { code: m.error.code });
    return m.result;
  }
  notify(method, params) { this.post({ jsonrpc: "2.0", method, params: params || {} }, 15000).catch(() => {}); }
  close() { this.closed = true; for (const c of this.ctls) { try { c.abort(); } catch (e) {} } }
  killNow() { this.close(); }
}

/* ---------------- manager ---------------- */
function createMcpManager(opts) {
  const o = Object.assign({ platform: process.platform, spawnFn: spawn, fetchFn: (u, i) => fetch(u, i), startTimeoutMs: START_TIMEOUT_MS, callTimeoutMs: CALL_TIMEOUT_MS }, opts);
  if (!o.userDataDir) throw new Error("userDataDir is required");
  const cfgFile = path.join(o.userDataDir, "mcp-config.json");
  let cfg = { enabled: false, askEach: true, servers: [] };
  try { const j = JSON.parse(fs.readFileSync(cfgFile, "utf8")); if (j && typeof j === "object") cfg = Object.assign(cfg, j); } catch (e) {}
  if (!Array.isArray(cfg.servers)) cfg.servers = [];
  const save = () => { try { fs.mkdirSync(o.userDataDir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); } catch (e) {} };
  const rt = new Map();   // server id -> { state, client, tools, error, log[], starting: Promise }

  const clean = (s) => {
    const transport = s.transport === "http" ? "http" : "stdio";
    const out = { id: s.id || crypto.randomBytes(5).toString("hex"), name: String(s.name || "").trim().slice(0, 60) || "server", transport, enabled: s.enabled !== false, autoApprove: Array.isArray(s.autoApprove) ? s.autoApprove.map(String).slice(0, 500) : [] };
    if (transport === "stdio") {
      out.command = String(s.command || "").trim(); out.args = Array.isArray(s.args) ? s.args.map(String) : splitArgs(s.args); out.env = s.env && typeof s.env === "object" ? s.env : {};
      if (!out.command) throw new Error("Enter the command that starts the server.");
    } else {
      out.url = String(s.url || "").trim(); out.headers = s.headers && typeof s.headers === "object" ? s.headers : {};
      if (!/^https?:\/\//i.test(out.url)) throw new Error("Enter the web address of the server (starting with http:// or https://).");
    }
    return out;
  }
  const find = (id) => cfg.servers.find((s) => s.id === id);
  const state = (id) => { let r = rt.get(id); if (!r) { r = { state: "stopped", client: null, tools: [], error: "", log: [], starting: null }; rt.set(id, r); } return r; };
  const addLog = (id, l) => { const r = state(id); r.log.push(String(l).slice(0, 400)); if (r.log.length > 80) r.log.splice(0, r.log.length - 80); if (o.onLog) try { o.onLog(find(id) ? find(id).name : id, l); } catch (e) {} };

  function view() {
    return { enabled: !!cfg.enabled, askEach: cfg.askEach !== false,
      servers: cfg.servers.map((s) => { const r = state(s.id); return { id: s.id, name: s.name, transport: s.transport, enabled: s.enabled, command: s.command || "", args: s.args || [], env: s.env || {}, url: s.url || "", headers: s.headers || {},
        autoApprove: s.autoApprove || [], status: r.state, error: r.error, tools: r.tools.map((t) => ({ name: t.name, description: t.description || "" })), log: r.log.slice(-30) }; }) };
  }
  function setGlobal(p) {
    if (p && "enabled" in p) cfg.enabled = !!p.enabled;
    if (p && "askEach" in p) cfg.askEach = !!p.askEach;
    save();
    if (cfg.enabled) cfg.servers.filter((s) => s.enabled).forEach((s) => start(s.id).catch(() => {}));
    return view();
  }
  async function saveServer(s) {
    const c = clean(s), i = cfg.servers.findIndex((x) => x.id === c.id);
    if (i >= 0) { const wasRunning = state(c.id).state !== "stopped"; await stop(c.id); cfg.servers[i] = c; save(); if (wasRunning && c.enabled) start(c.id).catch(() => {}); }
    else { cfg.servers.push(c); save(); if (cfg.enabled && c.enabled) start(c.id).catch(() => {}); }
    return view();
  }
  async function importServers(text) {
    const list = parseImport(text);
    for (const s of list) { const same = cfg.servers.find((x) => x.name === s.name); if (same) s.id = same.id; await saveServer(s); }
    return view();
  }
  async function removeServer(id) { await stop(id); cfg.servers = cfg.servers.filter((s) => s.id !== id); rt.delete(id); save(); return view(); }

  async function listTools(client) {
    let tools = [], cursor, guard = 0;
    do { const r = await client.request("tools/list", cursor ? { cursor } : {}, 30000); tools = tools.concat((r && r.tools) || []); cursor = r && r.nextCursor; } while (cursor && ++guard < 20);
    return tools.filter((t) => t && typeof t.name === "string");
  }
  function start(id) {
    const s = find(id); if (!s) return Promise.reject(new Error("Unknown server."));
    const r = state(id);
    if (r.state === "ready") return Promise.resolve(view());
    if (r.starting) return r.starting;
    r.state = "starting"; r.error = ""; r.tools = [];
    const client = s.transport === "http" ? new HttpClient(s, o, (l) => addLog(id, l)) : new StdioClient(s, o, (l) => addLog(id, l));
    r.client = client;
    r.starting = (async () => {
      try {
        client.onExit = () => { if (rt.get(id) && rt.get(id).client === client) { const x = state(id); if (x.state !== "stopped") { x.state = "error"; x.error = x.error || "The server stopped."; } } };
        client.onNotify = (m) => { if (m === "notifications/tools/list_changed") listTools(client).then((t) => { state(id).tools = t; }).catch(() => {}); };
        client.start();
        const init = await client.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "IcyWhite", version: o.version || "1" } }, o.startTimeoutMs);
        client.protocol = (init && init.protocolVersion) || PROTOCOL;
        client.notify("notifications/initialized");
        r.serverInfo = init && init.serverInfo;
        r.tools = await listTools(client);
        r.state = "ready"; addLog(id, "Ready: " + r.tools.length + " tool" + (r.tools.length === 1 ? "" : "s"));
        return view();
      } catch (e) {
        r.state = "error"; r.error = (e && e.message) || "Could not start the server.";
        addLog(id, r.error);
        try { client.killNow(); } catch (x) {}
        throw e;
      } finally { r.starting = null; }
    })();
    r.starting.catch(() => {});
    return r.starting;
  }
  async function stop(id) {
    const r = rt.get(id); if (!r) return view();
    const c = r.client; r.state = "stopped"; r.tools = []; r.error = ""; r.client = null;
    if (c) { try { c.close(); } catch (e) {} }
    return view();
  }
  async function startEnabled() { await Promise.all(cfg.servers.filter((s) => s.enabled).map((s) => start(s.id).catch(() => {}))); return view(); }

  // Tool names the model sees: "<server>__<tool>" (letters, digits, _ and - only, at most 64 characters).
  function toolTable() {
    const table = new Map(), defs = [], used = new Set();
    for (const s of cfg.servers) {
      const r = state(s.id); if (r.state !== "ready" || !s.enabled) continue;
      const prefix = slug(s.name);
      for (const t of r.tools) {
        let n = (prefix + "__" + t.name).replace(/[^A-Za-z0-9_-]/g, "_");
        if (n.length > 64) n = n.slice(0, 55) + "_" + crypto.createHash("md5").update(prefix + t.name).digest("hex").slice(0, 8);
        while (used.has(n)) n += "_";
        used.add(n);
        table.set(n, { serverId: s.id, serverName: s.name, tool: t.name });
        defs.push({ type: "function", function: { name: n, description: String(t.description || t.title || t.name).slice(0, 1000), parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} } } });
      }
    }
    return { table, defs };
  }
  // What the chat sends to the model. Starts enabled servers first (waits for them), so the first message after launch has its tools.
  async function tools() {
    if (!cfg.enabled) return { enabled: false, askEach: cfg.askEach !== false, tools: [], names: {} };
    if (cfg.servers.some((s) => s.enabled && state(s.id).state !== "ready" && state(s.id).state !== "error")) await startEnabled();
    const { table, defs } = toolTable();
    const names = {}; for (const [n, v] of table) names[n] = { server: v.serverName, tool: v.tool, serverId: v.serverId, auto: !!(find(v.serverId).autoApprove || []).includes(v.tool) };
    return { enabled: true, askEach: cfg.askEach !== false, tools: defs, names };
  }
  function resultText(r) {
    const parts = [];
    for (const c of (r && r.content) || []) {
      if (!c) continue;
      if (c.type === "text") parts.push(String(c.text || ""));
      else if (c.type === "image") parts.push("[an image was returned; IcyWhite does not show images from tools]");
      else if (c.type === "resource" && c.resource) parts.push(c.resource.text ? String(c.resource.text) : "[resource " + (c.resource.uri || "") + "]");
      else if (c.type === "resource_link") parts.push("[link " + (c.uri || "") + "]");
      else parts.push(JSON.stringify(c).slice(0, 500));
    }
    if (!parts.length && r && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
    let t = parts.join("\n");
    if (t.length > MAX_RESULT_CHARS) t = t.slice(0, MAX_RESULT_CHARS) + "\n…[cut: the result was longer than " + MAX_RESULT_CHARS + " characters]";
    return t;
  }
  async function call(name, args) {
    const { table } = toolTable(), hit = table.get(String(name));
    if (!hit) return { ok: false, isError: true, text: "Unknown tool: " + name + ". It may belong to a server that stopped." };
    const r = state(hit.serverId);
    if (r.state !== "ready" || !r.client) return { ok: false, isError: true, text: "The server \"" + hit.serverName + "\" is not running." };
    try {
      const res = await r.client.request("tools/call", { name: hit.tool, arguments: args && typeof args === "object" ? args : {} }, o.callTimeoutMs);
      return { ok: true, isError: !!(res && res.isError), text: resultText(res) || (res && res.isError ? "The tool reported an error." : "(no output)"), server: hit.serverName, tool: hit.tool };
    } catch (e) { return { ok: false, isError: true, text: "The tool call failed: " + ((e && e.message) || "unknown error"), server: hit.serverName, tool: hit.tool }; }
  }
  function setAlways(serverId, tool, on) {
    const s = find(serverId); if (!s) return view();
    const set = new Set(s.autoApprove || []); if (on) set.add(tool); else set.delete(tool);
    s.autoApprove = [...set]; save(); return view();
  }
  function shutdownSync() { for (const [, r] of rt) { try { if (r.client) r.client.killNow(); } catch (e) {} r.state = "stopped"; } }

  return { view, setGlobal, saveServer, importServers, removeServer, start, stop, startEnabled, tools, call, setAlways, shutdownSync };
}

module.exports = { createMcpManager, splitArgs, parseImport, StdioClient, HttpClient };
