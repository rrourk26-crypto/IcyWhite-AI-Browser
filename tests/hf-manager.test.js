// Tests for hf-manager.js against a stand-in Hugging Face server (no internet needed).  Run: node --test tests/hf-manager.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const hf = require("../hf-manager.js");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const mkbuf = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hf-test-"));
const wait = async (cond, ms = 8000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 15)); } };

// ---- stand-in server ----
async function startServer(repoFiles, behaviour) {
  const b = Object.assign({ dropAfter: 0, ignoreRange: false, chunkDelay: 0, gated: false, searchPage2: false, expand400: false, wrongSha: "" }, behaviour);
  const log = { requests: [], rangeHeaders: [], auth: [], drops: 0 };
  const entries = Object.entries(repoFiles).map(([p, buf]) => ({ type: "file", path: p, size: buf.length, lfs: { oid: b.wrongSha && p === b.wrongSha ? "0".repeat(64) : sha(buf), size: buf.length } }));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    log.requests.push(req.url); log.auth.push(req.headers.authorization || "");
    const json = (o, h) => { res.writeHead(200, Object.assign({ "content-type": "application/json" }, h || {})); res.end(JSON.stringify(o)); };
    if (u.pathname === "/api/models") {
      if (b.expand400 && u.searchParams.has("expand[]")) { res.writeHead(400); return res.end("{}"); }
      if (u.searchParams.get("cursor") === "p2") return json([{ id: "bob/page2-GGUF", downloads: 1, likes: 1 }]);
      const link = b.searchPage2 ? { link: '<http://127.0.0.1:' + server.address().port + '/api/models?cursor=p2>; rel="next"' } : {};
      return json([
        { id: "alice/Tiny-7B-GGUF", author: "alice", downloads: 1234, likes: 56, lastModified: "2026-01-02T00:00:00.000Z", gated: false, tags: ["gguf", "license:apache-2.0"], gguf: { total: 7e9, architecture: "llama", context_length: 8192 } },
        { id: "bob/Vision-3B-GGUF", downloads: 99, likes: 3, gated: "manual", tags: ["gguf", "image-text-to-text", "license:other"], pipeline_tag: "image-text-to-text", gguf: { total: 3e9 } },
        { id: "bob/Big-70B-GGUF", downloads: 5, likes: 0, tags: ["gguf"], gguf: { total: 70e9 } }
      ], link);
    }
    if (u.pathname === "/api/models/alice/Tiny-7B-GGUF") return json({ id: "alice/Tiny-7B-GGUF", author: "alice", downloads: 10, likes: 2, lastModified: "2026-02-03T00:00:00Z", gated: false, sha: "abc123", tags: ["license:apache-2.0"], cardData: { license: "apache-2.0" }, gguf: { total: 7e9 } });
    if (u.pathname === "/api/models/alice/Tiny-7B-GGUF/tree/main") return json(entries);
    if (u.pathname === "/api/whoami-v2") return req.headers.authorization === "Bearer hf_goodtoken123" ? json({ name: "alice" }) : (res.writeHead(401), res.end("{}"));
    if (u.pathname === "/alice/Tiny-7B-GGUF/raw/main/README.md") { res.writeHead(200); return res.end("---\nlicense: apache-2.0\n---\n# Tiny\nHello **world**"); }
    const m = /^\/alice\/Tiny-7B-GGUF\/resolve\/main\/(.+)$/.exec(u.pathname);
    if (m) {
      if (b.gated && !/^Bearer hf_goodtoken123$/.test(req.headers.authorization || "")) { res.writeHead(401); return res.end("gated"); }
      const name = decodeURIComponent(m[1]), buf = repoFiles[name];
      if (!buf) { res.writeHead(404); return res.end(); }
      let start = 0, status = 200;
      const rg = /bytes=(\d+)-/.exec(req.headers.range || "");
      if (req.headers.range) log.rangeHeaders.push(req.headers.range);
      if (rg && !b.ignoreRange) { start = parseInt(rg[1], 10); status = 206; if (start >= buf.length) { res.writeHead(416); return res.end(); } }
      const headers = { "content-length": buf.length - start, "content-type": "application/octet-stream" };
      if (status === 206) headers["content-range"] = "bytes " + start + "-" + (buf.length - 1) + "/" + buf.length;
      res.writeHead(status, headers);
      let pos = start; const CH = 32 * 1024;
      const dropAt = b.dropAfter && log.drops === 0 && status === 200 + 0 || (b.dropAfter && log.drops === 0) ? start + b.dropAfter : 0;
      const tick = () => {
        if (res.destroyed) return;
        if (dropAt && pos >= dropAt) { log.drops++; return res.destroy(); }
        if (pos >= buf.length) return res.end();
        const end = Math.min(buf.length, pos + CH, dropAt || Infinity);
        res.write(buf.subarray(pos, end)); pos = end;
        b.chunkDelay ? setTimeout(tick, b.chunkDelay) : setImmediate(tick);
      };
      return tick();
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, log, url: "http://127.0.0.1:" + server.address().port, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) };
}
function mgr(srv, extra) {
  const userData = tmp(), models = path.join(tmp(), "models");
  const fake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from("ENC:" + Buffer.from(s).reverse().toString("latin1")), decryptString: (b) => Buffer.from(b.toString().slice(4), "latin1").reverse().toString() };
  const notes = [];
  const m = hf.createHfManager(Object.assign({ userDataDir: userData, modelsDir: () => models, safeStorage: fake, notify: (n) => notes.push(n), retryBaseMs: 5, stallMs: 3000,
    hardwareFn: async () => ({ nvidia: { name: "RTX 4070", vramMB: 12288 }, gpus: [{ name: "RTX 4070", vendor: "nvidia" }], ramGB: 32 }) }, extra));
  m.setConfig({ endpoint: srv.url });
  return { m, userData, models, notes, fake };
}

/* ---------------- pure helpers ---------------- */
test("parseRepoInput understands links and user/repo", () => {
  assert.deepStrictEqual(hf.parseRepoInput("bartowski/Llama-3.2-3B-Instruct-GGUF"), { repo: "bartowski/Llama-3.2-3B-Instruct-GGUF", revision: "main", file: "", quant: "" });
  assert.strictEqual(hf.parseRepoInput("https://huggingface.co/unsloth/gemma-3-4b-it-GGUF").repo, "unsloth/gemma-3-4b-it-GGUF");
  const b = hf.parseRepoInput("https://huggingface.co/a/b-GGUF/blob/main/sub/x-Q4_K_M.gguf?download=true");
  assert.strictEqual(b.file, "sub/x-Q4_K_M.gguf"); assert.strictEqual(b.revision, "main");
  assert.strictEqual(hf.parseRepoInput("hf.co/a/b-GGUF:q4_k_m").quant, "Q4_K_M");
  assert.strictEqual(hf.parseRepoInput("https://huggingface.co/a/b/tree/dev").revision, "dev");
  assert.strictEqual(hf.parseRepoInput("https://huggingface.co/datasets/a/b"), null);
  assert.strictEqual(hf.parseRepoInput("https://example.com/a/b"), null);
  assert.strictEqual(hf.parseRepoInput("just words"), null);
  assert.strictEqual(hf.parseRepoInput(""), null);
  assert.strictEqual(hf.parseRepoInput("../../etc/passwd"), null);
  assert.strictEqual(hf.parseRepoInput("my.mirror.local/a/b", ["my.mirror.local"]).repo, "a/b");
});
test("parseQuant finds the quantization in common file names", () => {
  const t = { "Llama-3.2-3B-Instruct-Q4_K_M.gguf": "Q4_K_M", "model.Q5_K_M.gguf": "Q5_K_M", "x-Q8_0.gguf": "Q8_0", "Qwen3-8B-UD-Q4_K_XL.gguf": "UD-Q4_K_XL", "m-IQ4_XS.gguf": "IQ4_XS",
    "m-f16.gguf": "F16", "m-BF16-00001-of-00002.gguf": "BF16", "gpt-oss-20b-MXFP4.gguf": "MXFP4", "q6_k/model.gguf": "Q6_K", "m-Q2_K_L.gguf": "Q2_K_L", "Qwen3-8B.gguf": "", "Qwen2.5-7B-Instruct.gguf": "" };
  for (const [f, q] of Object.entries(t)) assert.strictEqual(hf.parseQuant(f), q, f);
});
test("buildFileGroups joins split parts, separates vision files and ignores incomplete sets", () => {
  const e = (p, s) => ({ type: "file", path: p, size: s });
  const r = hf.buildFileGroups([e("README.md", 5), e("m-Q4_K_M.gguf", 4e9), e("m-Q8_0-00001-of-00002.gguf", 5e9), e("m-Q8_0-00002-of-00002.gguf", 4e9), e("mmproj-F16.gguf", 8e8),
    e("bad-Q6_K-00001-of-00003.gguf", 1), e("bad-Q6_K-00002-of-00003.gguf", 1), e("dir/m-Q5_K_M.gguf", 4.5e9)]);
  assert.deepStrictEqual(r.groups.map((g) => g.quant), ["Q4_K_M", "Q5_K_M", "Q8_0"]);
  const q8 = r.groups.find((g) => g.quant === "Q8_0");
  assert.strictEqual(q8.parts, 2); assert.strictEqual(q8.size, 9e9); assert.strictEqual(q8.name, "m-Q8_0.gguf");
  assert.strictEqual(r.mmproj.length, 1); assert.strictEqual(r.mmproj[0].quant, "F16");
});
test("estimateFit: gpu / partial / cpu / toobig", () => {
  const hw = { vramBytes: 12 * 1073741824, ramBytes: 32 * 1073741824 };
  assert.strictEqual(hf.estimateFit(4e9, hw).fit, "gpu");
  assert.strictEqual(hf.estimateFit(14e9, hw).fit, "partial");
  assert.strictEqual(hf.estimateFit(45e9, hw).fit, "toobig");
  assert.strictEqual(hf.estimateFit(4e9, { vramBytes: 0, ramBytes: 16 * 1073741824 }).fit, "cpu");
  assert.strictEqual(hf.estimateFit(20e9, { vramBytes: 0, ramBytes: 16 * 1073741824 }).fit, "toobig");
  assert.strictEqual(hf.estimateFit(14e9, { vramBytes: 8e9, ramBytes: 32 * 1073741824 }).fit, "partial");
  assert.strictEqual(hf.estimateFit(8e9, { vramBytes: 0.5 * 1073741824, ramBytes: 32 * 1073741824 }).fit, "cpu");   // a tiny GPU does not count
  assert.strictEqual(hf.estimateFit(40e9, { vramBytes: 100 * 1073741824, ramBytes: 8 * 1073741824, unified: true }).fit, "gpu");
});

/* ---------------- search / model page ---------------- */
test("search: GGUF filter, sort mapping, normalized results, paging, size filter", async () => {
  const s = await startServer({}, { searchPage2: true }); const { m } = mgr(s);
  const r = await m.search({ query: "tiny", sort: "newest" });
  const u = new URL(s.log.requests[0], "http://x");
  assert.strictEqual(u.searchParams.get("search"), "tiny"); assert.deepStrictEqual(u.searchParams.getAll("filter"), ["gguf"]);
  assert.strictEqual(u.searchParams.get("sort"), "createdAt"); assert.strictEqual(u.searchParams.get("direction"), "-1");
  assert.strictEqual(r.items.length, 3); assert.strictEqual(r.items[0].license, "apache-2.0"); assert.strictEqual(r.items[0].author, "alice");
  assert.strictEqual(r.items[1].gated, "manual"); assert.strictEqual(r.items[1].vision, true); assert.strictEqual(r.items[1].author, "bob");
  assert.ok(r.next);
  const r2 = await m.search({ cursor: r.next }); assert.strictEqual(r2.items[0].id, "bob/page2-GGUF"); assert.strictEqual(r2.next, "");
  assert.deepStrictEqual((await m.search({ size: "small" })).items.map((x) => x.id), ["bob/Vision-3B-GGUF"]);
  assert.deepStrictEqual((await m.search({ size: "large" })).items.map((x) => x.id), ["bob/Big-70B-GGUF"]);
  await m.search({ vision: true, language: "en", sort: "trending" });
  const v = new URL(s.log.requests[s.log.requests.length - 1], "http://x");
  assert.strictEqual(v.searchParams.get("pipeline_tag"), "image-text-to-text"); assert.deepStrictEqual(v.searchParams.getAll("filter"), ["gguf", "en"]); assert.strictEqual(v.searchParams.get("sort"), "trendingScore");
  await assert.rejects(() => m.search({ cursor: "https://evil.example/api/models" }), /not valid/);
  await s.close();
});
test("search falls back when the API rejects expand[]", async () => {
  const s = await startServer({}, { expand400: true }); const { m } = mgr(s);
  assert.strictEqual((await m.search({})).items.length, 3); await s.close();
});
test("model page: details, quant rows with sizes and fit badges, vision files, recommended", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(4000, 1), "Tiny-Q8_0.gguf": mkbuf(8000, 2), "Tiny-F16.gguf": mkbuf(16000, 3), "mmproj-F16.gguf": mkbuf(500, 4), "README.md": mkbuf(10, 5) };
  const s = await startServer(files); const { m } = mgr(s);
  const r = await m.model("alice/Tiny-7B-GGUF");
  assert.strictEqual(r.author, "alice"); assert.strictEqual(r.license, "apache-2.0"); assert.strictEqual(r.gated, false); assert.strictEqual(r.downloads, 10); assert.strictEqual(r.lastModified, "2026-02-03T00:00:00Z");
  assert.deepStrictEqual(r.files.map((f) => [f.quant, f.size, f.fit]), [["Q4_K_M", 4000, "gpu"], ["Q8_0", 8000, "gpu"], ["F16", 16000, "gpu"]]);
  assert.ok(r.files.every((f) => f.verified)); assert.strictEqual(r.files.find((f) => f.recommended).quant, "Q8_0");
  assert.strictEqual(r.mmproj.length, 1); assert.strictEqual(r.hasVision, true); assert.strictEqual(r.hardware.vramGB, 12);
  const rd = await m.readme("alice/Tiny-7B-GGUF"); assert.match(rd.text, /^# Tiny/); assert.strictEqual(rd.license, "apache-2.0");
  await assert.rejects(() => m.model("not a repo"), /not a Hugging Face model name/);
  await s.close();
});
test("starters carry a fit hint for this PC", async () => {
  const s = await startServer({}); const { m } = mgr(s); const r = await m.starters();
  assert.ok(r.items.length >= 8); assert.ok(["fast", "balanced", "smart"].every((t) => r.items.some((x) => x.tier === t)));
  assert.strictEqual(r.items.find((x) => x.approxGB === 0.8).fit, "gpu"); assert.strictEqual(r.items.find((x) => x.approxGB === 42.5).fit, "toobig"); await s.close();
});

/* ---------------- downloads ---------------- */
test("download writes .part, verifies SHA-256, renames, notifies; split parts + vision file come together", async () => {
  const files = { "Tiny-Q8_0-00001-of-00002.gguf": mkbuf(300000, 1), "Tiny-Q8_0-00002-of-00002.gguf": mkbuf(200000, 2), "mmproj-F16.gguf": mkbuf(50000, 3), "Tiny-Q4_K_M.gguf": mkbuf(1000, 4) };
  const s = await startServer(files); const { m, models, notes } = mgr(s);
  const j = await m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q8_0-00001-of-00002.gguf", "mmproj-F16.gguf"] });   // only part 1 named: part 2 must be added
  assert.strictEqual(j.files.length, 3);
  const dir = path.join(models, "alice", "Tiny-7B-GGUF");
  await wait(() => m.list().jobs[0].status === "done");
  for (const n of ["Tiny-Q8_0-00001-of-00002.gguf", "Tiny-Q8_0-00002-of-00002.gguf", "mmproj-F16.gguf"]) { assert.ok(fs.readFileSync(path.join(dir, n)).equals(files[n]), n); assert.ok(!fs.existsSync(path.join(dir, n + ".part"))); }
  assert.ok(!fs.existsSync(path.join(dir, "Tiny-Q4_K_M.gguf")));
  assert.strictEqual(notes.length, 1); assert.match(notes[0].title, /finished/i);
  assert.ok(m.list().jobs[0].files.every((f) => f.verified)); assert.strictEqual(m.list().jobs[0].pct, 100);
  await assert.rejects(() => m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] }).then(() => m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] })), /already/);
  await s.close();
});
test("a dropped connection resumes with an HTTP Range request and the file is intact", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(400000, 9) };
  const s = await startServer(files, { dropAfter: 100000 }); const { m, models } = mgr(s);
  await m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  await wait(() => ["done", "error"].includes(m.list().jobs[0].status));
  assert.strictEqual(m.list().jobs[0].status, "done", m.list().jobs[0].error);
  assert.ok(s.log.rangeHeaders.length >= 1 && /^bytes=\d+-$/.test(s.log.rangeHeaders[0]));
  assert.ok(fs.readFileSync(path.join(models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf")).equals(files["Tiny-Q4_K_M.gguf"]));
  await s.close();
});
test("pause keeps the .part file; a new manager (app restart) lists it paused and resumes with Range", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(600000, 7) };
  const s = await startServer(files, { chunkDelay: 8 }); const a = mgr(s);
  const j = await a.m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  await wait(() => a.m.list().jobs[0].bytesDone > 60000);
  a.m.pause(j.id);
  await wait(() => !fs.existsSync(path.join(a.models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf.part")) ? false : true);
  assert.strictEqual(a.m.list().jobs[0].status, "paused");
  const partSize = fs.statSync(path.join(a.models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf.part")).size; assert.ok(partSize > 0 && partSize < 600000);
  assert.ok(!fs.existsSync(path.join(a.models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf")));   // a half-finished file is never a model
  a.m.shutdownSync();
  // "restart": a brand new manager reading the same data folder
  const b = hf.createHfManager({ userDataDir: a.userData, modelsDir: () => a.models, retryBaseMs: 5, hardwareFn: async () => ({}) });
  b.setConfig({ endpoint: s.url });
  assert.strictEqual(b.list().jobs[0].status, "paused"); assert.ok(b.list().jobs[0].bytesDone >= partSize);
  s.log.rangeHeaders.length = 0; s.server.closeAllConnections();
  b.resume(j.id);
  await wait(() => ["done", "error"].includes(b.list().jobs[0].status));
  assert.strictEqual(b.list().jobs[0].status, "done", b.list().jobs[0].error);
  assert.ok(s.log.rangeHeaders.some((h) => h === "bytes=" + partSize + "-" || /^bytes=\d+-$/.test(h)));
  assert.ok(fs.readFileSync(path.join(a.models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf")).equals(files["Tiny-Q4_K_M.gguf"]));
  await s.close();
});
test("a server that ignores Range makes the download start over, still correct", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(200000, 5) };
  const s = await startServer(files, { ignoreRange: true, dropAfter: 50000 }); const { m, models } = mgr(s);
  await m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  await wait(() => ["done", "error"].includes(m.list().jobs[0].status));
  assert.strictEqual(m.list().jobs[0].status, "done", m.list().jobs[0].error);
  assert.ok(fs.readFileSync(path.join(models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf")).equals(files["Tiny-Q4_K_M.gguf"])); await s.close();
});
test("wrong SHA-256: the file is discarded, never renamed, and the job shows an error", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(50000, 5) };
  const s = await startServer(files, { wrongSha: "Tiny-Q4_K_M.gguf" }); const { m, models } = mgr(s);
  await m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  await wait(() => ["done", "error"].includes(m.list().jobs[0].status));
  const j = m.list().jobs[0], dir = path.join(models, "alice", "Tiny-7B-GGUF");
  assert.strictEqual(j.status, "error"); assert.match(j.error, /checksum/i);
  assert.ok(!fs.existsSync(path.join(dir, "Tiny-Q4_K_M.gguf"))); assert.ok(!fs.existsSync(path.join(dir, "Tiny-Q4_K_M.gguf.part")));
  await s.close();
});
test("not enough free disk space is refused before anything is downloaded", async () => {
  const s = await startServer({ "Tiny-Q4_K_M.gguf": mkbuf(1000, 1) }); const { m, models } = mgr(s, { statfs: async () => ({ bavail: 10, bsize: 1024 }) });
  await assert.rejects(() => m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] }), (e) => e.code === "disk" && /free disk space/.test(e.message));
  assert.ok(!s.log.requests.some((r) => r.includes("/resolve/"))); assert.strictEqual(m.list().jobs.length, 0); await s.close();
});
test("gated model: 401 without a token explains what to do; with a saved token it works and the token is stored encrypted", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(20000, 3) };
  const s = await startServer(files, { gated: true }); const { m, userData, fake } = mgr(s);
  await m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  await wait(() => ["done", "error"].includes(m.list().jobs[0].status));
  assert.strictEqual(m.list().jobs[0].status, "error"); assert.match(m.list().jobs[0].error, /token.*licen[cs]e/i);
  assert.throws(() => m.setToken("short"), /does not look like/);
  m.setToken("hf_goodtoken123");
  assert.strictEqual(m.getConfig().hasToken, true); assert.ok(!("token" in m.getConfig()));
  assert.ok(!fs.readFileSync(path.join(userData, "hf-config.json"), "utf8").includes("hf_goodtoken123"));   // not plain text
  assert.strictEqual((await m.whoami()).name, "alice");
  m.retry(m.list().jobs[0].id);
  await wait(() => ["done", "error"].includes(m.list().jobs[0].status));
  assert.strictEqual(m.list().jobs[0].status, "done", m.list().jobs[0].error);
  assert.ok(s.log.auth.includes("Bearer hf_goodtoken123"));
  // without secure storage the token is refused, not stored in plain text
  const m2 = hf.createHfManager({ userDataDir: tmp(), modelsDir: () => tmp(), safeStorage: { isEncryptionAvailable: () => false } });
  assert.throws(() => m2.setToken("hf_goodtoken123"), /NOT saved/);
  await s.close();
});
test("queue: only the allowed number run at once, the rest wait and start on their own", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(150000, 1), "Tiny-Q8_0.gguf": mkbuf(150000, 2), "Tiny-F16.gguf": mkbuf(150000, 3) };
  const s = await startServer(files, { chunkDelay: 6 }); const { m } = mgr(s);
  for (const f of Object.keys(files)) await m.add({ repo: "alice/Tiny-7B-GGUF", files: [f] });
  const st = () => m.list().jobs.map((j) => j.status);
  assert.strictEqual(st().filter((x) => x === "downloading").length, 1); assert.strictEqual(st().filter((x) => x === "queued").length, 2);
  m.setConfig({ maxConcurrent: 2 });
  await wait(() => st().filter((x) => x === "downloading").length === 2 || st().every((x) => x === "done"), 3000).catch(() => {});
  assert.ok(st().filter((x) => x === "downloading").length <= 2);
  await wait(() => st().every((x) => x === "done"), 15000);
  await s.close();
});
test("cancel removes the .part file; remove clears the entry; speed limit slows a download", async () => {
  const files = { "Tiny-Q4_K_M.gguf": mkbuf(400000, 1) };
  const s = await startServer(files, { chunkDelay: 10 }); const { m, models } = mgr(s);
  const j = await m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  const part = path.join(models, "alice", "Tiny-7B-GGUF", "Tiny-Q4_K_M.gguf.part");
  await wait(() => fs.existsSync(part) && fs.statSync(part).size > 0);
  m.cancel(j.id);
  await wait(() => !fs.existsSync(part));
  assert.strictEqual(m.list().jobs[0].status, "canceled");
  m.remove(j.id); assert.strictEqual(m.list().jobs.length, 0);
  await s.close();
  const s2 = await startServer({ "Tiny-Q4_K_M.gguf": mkbuf(300000, 1) }); const x = mgr(s2); x.m.setConfig({ speedLimitMBps: 0.5 });
  const t0 = Date.now(); await x.m.add({ repo: "alice/Tiny-7B-GGUF", files: ["Tiny-Q4_K_M.gguf"] });
  await wait(() => x.m.list().jobs[0].status === "done", 10000);
  assert.ok(Date.now() - t0 > 400, "0.5 MB/s limit should make 300 KB take roughly 0.6 s, took " + (Date.now() - t0)); await s2.close();
});
test("settings: mirror address is normalized, proxy hook is called, concurrency is clamped", async () => {
  const s = await startServer({}); let proxied = null; const { m } = mgr(s, { applyProxy: (p) => { proxied = p; } });
  assert.strictEqual(m.setConfig({ endpoint: "https://hf-mirror.com/" }).endpoint, "https://hf-mirror.com");
  assert.strictEqual(m.setConfig({ endpoint: "not a url" }).endpoint, hf.DEFAULT_ENDPOINT);
  m.setConfig({ proxy: "http://127.0.0.1:7890" }); assert.strictEqual(proxied, "http://127.0.0.1:7890");
  assert.strictEqual(m.setConfig({ maxConcurrent: 9 }).maxConcurrent, 2); assert.strictEqual(m.setConfig({ maxConcurrent: 0 }).maxConcurrent, 1);
  await s.close();
});
