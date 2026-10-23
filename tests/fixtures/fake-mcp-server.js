// A tiny MCP server over stdio for tests: tools "echo" and "boom"; prints a non-JSON line and a stderr line first.
process.stderr.write("fake server booting\n"); process.stdout.write("not json banner\n");
let buf = "";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
    else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo", description: "Echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }, { name: "boom", description: "Always fails", inputSchema: { type: "object", properties: {} } }, { name: "exit", description: "Crash", inputSchema: { type: "object" } }] } });
    else if (m.method === "tools/call") {
      const n = m.params.name;
      if (n === "echo") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "echo: " + m.params.arguments.text }] } });
      else if (n === "boom") send({ jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "it broke" }] } });
      else if (n === "exit") process.exit(3);
      else send({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "unknown tool" } });
    } else if (m.method === "ping") send({ jsonrpc: "2.0", id: m.id, result: {} });
  }
});
