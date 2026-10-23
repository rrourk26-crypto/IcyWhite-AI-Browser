/* Tools (MCP): Settings tab + the small API the chat uses (window.lmchatTools).
 * Only works inside the IcyWhite app (needs window.oasisProject.mcp*). Everything shown comes from servers you added, so it is all set with textContent. */
(function () {
  "use strict";
  const api = window.oasisProject;
  if (!api || !api.mcpGet) return;
  const $ = (id) => document.getElementById(id);
  window.lmchatTools = {
    get: () => api.mcpTools(),
    call: (name, args) => api.mcpCall(name, args),
    always: (serverId, tool, on) => api.mcpAlways(serverId, tool, on),
  };
  const bar = $("setTabs"), pane = $("mcpBlock");
  if (!bar || !pane) return;
  const tabBtn = bar.querySelector('[data-go="tools"]'); if (tabBtn) tabBtn.hidden = false;

  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const btn = (label, fn, cls) => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; return b; };
  let view = { enabled: false, askEach: true, servers: [] }, editing = null, timer = null;

  function parseEnv(t) { const o = {}; String(t || "").split(/\r?\n/).forEach((l) => { const i = l.indexOf("="); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }); return o; }
  function parseHeaders(t) { const o = {}; String(t || "").split(/\r?\n/).forEach((l) => { const i = l.indexOf(":"); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }); return o; }
  const joinKV = (o, sep) => Object.keys(o || {}).map((k) => k + sep + o[k]).join("\n");

  async function refresh() { try { view = await api.mcpGet(); } catch (e) {} render(); }
  function poll() { clearInterval(timer); timer = setInterval(() => { if (!$("settings").open) return clearInterval(timer); if (view.servers.some((s) => s.status === "starting")) refresh(); }, 1000); }

  function serverRow(s) {
    const row = el("div", "mcp-srv");
    const head = el("div", "mcp-head");
    head.append(el("span", "mcp-dot " + s.status), el("b", "", s.name), el("span", "mcp-meta", s.status === "ready" ? s.tools.length + " tools" : s.status === "error" ? "error" : s.status));
    const acts = el("span", "mcp-acts");
    if (s.status === "ready" || s.status === "starting") acts.appendChild(btn("Stop", async () => { await api.mcpStop(s.id); refresh(); }));
    else acts.appendChild(btn("Start", async () => { s.status = "starting"; render(); poll(); view = await api.mcpStart(s.id); render(); }));
    acts.append(btn("Edit", () => { editing = s; renderForm(); }), btn("Remove", async () => { if (confirm("Remove " + s.name + "?")) { view = await api.mcpRemoveServer(s.id); render(); } }));
    head.appendChild(acts); row.appendChild(head);
    if (s.error) row.appendChild(el("div", "mcp-err", s.error));
    if (s.tools.length) {
      const det = el("details", "mcp-tools"); det.appendChild(el("summary", "", "Tools (tick = always allow without asking)"));
      s.tools.forEach((t) => {
        const l = el("label", "mcp-tool"); const c = document.createElement("input"); c.type = "checkbox"; c.checked = s.autoApprove.includes(t.name);
        c.onchange = async () => { await api.mcpAlways(s.id, t.name, c.checked); };
        const sp = el("span", "", t.name); sp.title = t.description; l.append(c, sp); det.appendChild(l);
      });
      row.appendChild(det);
    }
    if (s.log.length) { const d = el("details", "mcp-tools"); d.appendChild(el("summary", "", "Log")); d.appendChild(el("pre", "", s.log.join("\n"))); row.appendChild(d); }
    return row;
  }

  function render() {
    $("mcpOn").checked = !!view.enabled; $("mcpAsk").checked = view.askEach !== false;
    $("mcpAskRow").hidden = !view.enabled;
    const list = $("mcpList"); list.textContent = "";
    if (!view.servers.length) list.appendChild(el("small", "", "No tool servers yet. Add one below."));
    view.servers.forEach((s) => list.appendChild(serverRow(s)));
    $("mcpAdd").hidden = !!editing;
  }

  function renderForm() {
    const f = $("mcpForm"); f.textContent = ""; f.hidden = false; $("mcpAdd").hidden = true;
    const s = editing || { name: "", transport: "stdio", enabled: true, command: "", args: [], env: {}, url: "", headers: {} };
    const field = (label, node) => { const l = el("label", "", label); l.appendChild(node); f.appendChild(l); return node; };
    const inp = (v, ph) => { const i = document.createElement("input"); i.type = "text"; i.value = v || ""; if (ph) i.placeholder = ph; return i; };
    const ta = (v, ph) => { const t = document.createElement("textarea"); t.rows = 2; t.value = v || ""; if (ph) t.placeholder = ph; return t; };
    const name = field("Name", inp(s.name, "My tools"));
    const tr = document.createElement("select"); [["stdio", "Program on this PC (command)"], ["http", "Web address (URL)"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; tr.appendChild(o); }); tr.value = s.transport; field("Type", tr);
    const cmd = field("Command", inp(s.command, "npx")), args = field("Arguments (one line)", inp((s.args || []).map((a) => /\s/.test(a) ? '"' + a + '"' : a).join(" "), "-y @modelcontextprotocol/server-memory"));
    const env = field("Environment variables (NAME=value, one per line)", ta(joinKV(s.env, "="), ""));
    const url = field("URL", inp(s.url, "https://example.com/mcp")), hdr = field("Headers (Name: value, one per line)", ta(joinKV(s.headers, ": "), ""));
    const sync = () => { const h = tr.value === "http"; [cmd, args, env].forEach((n) => n.parentElement.hidden = h); [url, hdr].forEach((n) => n.parentElement.hidden = !h); };
    tr.onchange = sync; sync();
    const row = el("div", "mcp-formact");
    const msg = el("small", "mcp-err");
    row.append(btn("Save", async () => {
      if (!name.value.trim()) { msg.textContent = "Give it a name."; return; }
      const o = { id: s.id, name: name.value.trim(), transport: tr.value, enabled: true, autoApprove: s.autoApprove || [] };
      if (tr.value === "http") { o.url = url.value.trim(); o.headers = parseHeaders(hdr.value); if (!/^https?:\/\//i.test(o.url)) { msg.textContent = "The URL must start with http:// or https://"; return; } }
      else { o.command = cmd.value.trim(); o.args = args.value; o.env = parseEnv(env.value); if (!o.command) { msg.textContent = "Enter the command to run."; return; } }
      try { view = await api.mcpSaveServer(o); } catch (e) { msg.textContent = e.message; return; }
      editing = null; f.hidden = true; render(); poll();
    }, "primary"), btn("Cancel", () => { editing = null; f.hidden = true; render(); }), msg);
    f.appendChild(row);
  }

  async function addPreset(p) {
    let o;
    if (p === "files") { const d = await api.mcpPickDir(); if (!d) return; o = { name: "Files", transport: "stdio", enabled: true, command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", d] }; }
    else if (p === "memory") o = { name: "Memory", transport: "stdio", enabled: true, command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] };
    else o = { name: "Fetch", transport: "stdio", enabled: true, command: "uvx", args: ["mcp-server-fetch", "--ignore-robots-txt"] };
    view = await api.mcpSaveServer(o); if (!view.enabled) view = await api.mcpSetGlobal({ enabled: true }); render(); poll();
  }

  $("mcpOn").onchange = async (e) => { view = await api.mcpSetGlobal({ enabled: e.target.checked }); render(); poll(); };
  $("mcpAsk").onchange = async (e) => { view = await api.mcpSetGlobal({ askEach: e.target.checked }); render(); };
  $("mcpAdd").onclick = () => { editing = null; renderForm(); };
  $("mcpPreFiles").onclick = () => addPreset("files"); $("mcpPreMem").onclick = () => addPreset("memory"); $("mcpPreFetch").onclick = () => addPreset("fetch");
  $("mcpImportGo").onclick = async () => {
    const m = $("mcpImportMsg"); m.textContent = "";
    try { view = await api.mcpImport($("mcpImportText").value); $("mcpImportText").value = ""; m.textContent = "Added."; render(); poll(); } catch (e) { m.textContent = "Could not read that: " + e.message; }
  };
  document.addEventListener("lmchat:settingsOpen", () => { editing = null; $("mcpForm").hidden = true; refresh(); poll(); });
  refresh();
})();
