/* cors-proxy.js — the "front door" of the local model server (main process only, plain Node).
 *
 * llama-server itself has no switches for CORS or for who may use it, so when you choose a CORS rule or an API key in
 * Settings > Local model, llama-server is started on a private port (127.0.0.1 only) and this small proxy listens on the
 * address and port you chose. It
 *   - answers browser "preflight" (OPTIONS) requests itself,
 *   - adds / removes the CORS headers according to the rule: "all" (any website), "origins" (only the list) or "off",
 *   - checks the API key (Authorization: Bearer <key>, or x-api-key) for everybody except requests that come from this
 *     very computer (the IcyWhite app itself), and always lets /health through,
 *   - streams everything else straight through, so chat replies still arrive word by word.
 * With the default settings (no key, CORS for everyone) this file is not used at all.
 */
"use strict";
const http = require("http");

const normOrigin = (o) => String(o || "").trim().replace(/\/+$/, "").toLowerCase();
function parseOrigins(text) {
  return String(text || "").split(/[\s,;]+/).map(normOrigin).filter(Boolean);
}
const isLoopback = (addr) => /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(String(addr || ""));
const PUBLIC_PATHS = new Set(["/health", "/v1/health"]);

// CORS headers for one request under the chosen rule.
function corsFor(mode, origins, origin) {
  if (mode === "off") return {};
  if (mode === "origins") {
    const o = normOrigin(origin);
    if (o && (origins.includes("*") || origins.includes(o))) return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
    return {};
  }
  return { "Access-Control-Allow-Origin": "*" };
}

function createProxy(opts) {
  const o = Object.assign({ host: "127.0.0.1", port: 8080, targetPort: 0, cors: "all", origins: "", apiKey: "", trustLocal: true, onLog: () => {} }, opts);
  const origins = parseOrigins(o.origins);
  let server = null;
  const sockets = new Set();

  const keyOk = (req) => {
    const h = req.headers;
    const bearer = /^Bearer\s+(.+)$/i.exec(String(h.authorization || ""));
    return (bearer && bearer[1].trim() === o.apiKey) || String(h["x-api-key"] || "") === o.apiKey;
  };

  function handle(req, res) {
    const origin = req.headers.origin;
    const cors = corsFor(o.cors, origins, origin);
    const urlPath = String(req.url || "/").split("?")[0];

    if (req.method === "OPTIONS") {
      const h = Object.assign({}, cors, { "Content-Length": "0" });
      if (cors["Access-Control-Allow-Origin"]) {
        h["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
        h["Access-Control-Allow-Headers"] = req.headers["access-control-request-headers"] || "Authorization, Content-Type";
        h["Access-Control-Max-Age"] = "600";
        if (req.headers["access-control-request-private-network"]) h["Access-Control-Allow-Private-Network"] = "true";
      }
      res.writeHead(204, h); return res.end();
    }

    if (o.apiKey && !PUBLIC_PATHS.has(urlPath) && !(o.trustLocal && isLoopback(req.socket.remoteAddress)) && !keyOk(req)) {
      const body = JSON.stringify({ error: { message: "Invalid or missing API key.", type: "authentication_error", code: 401 } });
      res.writeHead(401, Object.assign({}, cors, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }));
      return res.end(body);
    }

    const headers = Object.assign({}, req.headers, { host: "127.0.0.1:" + o.targetPort });
    const up = http.request({ host: "127.0.0.1", port: o.targetPort, method: req.method, path: req.url, headers, agent: false }, (ur) => {
      const h = {};
      for (const k of Object.keys(ur.headers)) if (!/^access-control-/i.test(k)) h[k] = ur.headers[k];
      Object.assign(h, cors);
      res.writeHead(ur.statusCode || 502, h);
      ur.pipe(res);
    });
    up.on("error", (e) => {
      if (!res.headersSent) {
        const body = JSON.stringify({ error: { message: "The model server is not answering: " + e.message, code: 502 } });
        res.writeHead(502, Object.assign({}, cors, { "Content-Type": "application/json" })); res.end(body);
      } else res.destroy();
    });
    res.on("close", () => { if (!res.writableFinished) up.destroy(); });   // client went away: stop generating
    req.pipe(up);
  }

  function listen() {
    return new Promise((resolve, reject) => {
      server = http.createServer(handle);
      server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
      server.once("error", reject);
      server.listen(o.port, o.host === "localhost" ? "127.0.0.1" : o.host, () => { server.removeListener("error", reject); resolve(); });
    });
  }
  function close() {
    const s = server; server = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => { s.close(() => resolve()); sockets.forEach((x) => { try { x.destroy(); } catch (e) {} }); setTimeout(resolve, 1500); });
  }
  return { listen, close };
}

module.exports = { createProxy, corsFor, parseOrigins, isLoopback };
