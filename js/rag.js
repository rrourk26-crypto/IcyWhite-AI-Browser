/* Document chat (RAG): documents are split into passages and indexed on this computer; for each question the best passages are
 * found and given to the model with numbered labels so it can cite them.
 * Search = keyword ranking (BM25) always, plus meaning-based ranking when an embedding model is set and the server answers /embeddings.
 * Pure helpers are exported for tests (module.exports); in the page everything lives on window.lmchatRag. */
(function (root) {
  "use strict";

  const STOP = new Set("a an and are as at be but by for from has have he her his i in is it its of on or our she that the their them they this to was we were what when where which who will with you your not can do does did how if so than then there these those been being into about over also more most such only other any all".split(" "));
  function tokenize(s) {
    const out = []; const m = String(s || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    for (let w of m) { if (w.length < 2 || STOP.has(w)) continue; if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1); out.push(w); }
    return out;
  }

  // Split text into passages of about `size` characters, breaking at paragraph / sentence ends, with a little overlap.
  function chunkText(text, size, overlap) {
    size = size || 1000; overlap = overlap == null ? 150 : overlap;
    const t = String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!t) return [];
    const pieces = [];
    t.split(/\n{2,}/).forEach((para) => {
      para = para.trim(); if (!para) return;
      if (para.length <= size) { pieces.push(para); return; }
      const sents = para.match(/[^.!?\n]+(?:[.!?]+["')\]]*(?:\s+|$)|\n|$)/g) || [para];
      let cur = "";
      sents.forEach((s0) => {
        let s = s0;
        while (s.length > size) { if (cur) { pieces.push(cur.trim()); cur = ""; } pieces.push(s.slice(0, size)); s = s.slice(size); }
        if ((cur + s).length > size && cur) { pieces.push(cur.trim()); cur = ""; }
        cur += s;
      });
      if (cur.trim()) pieces.push(cur.trim());
    });
    const chunks = []; let cur = "";
    pieces.forEach((p) => {
      if (cur && (cur.length + p.length + 2) > size) {
        chunks.push(cur);
        const tail = overlap > 0 ? cur.slice(-overlap).replace(/^\S*\s/, "") : "";   // start the next passage a little before, cut at a word
        cur = tail ? tail + "\n\n" + p : p;
      } else cur = cur ? cur + "\n\n" + p : p;
    });
    if (cur.trim()) chunks.push(cur);
    return chunks.map((c) => c.trim()).filter(Boolean);
  }

  function bm25(chunks, query, k) {
    const q = Array.from(new Set(tokenize(query))); if (!q.length || !chunks.length) return [];
    const docs = chunks.map((c) => { const tf = new Map(); const tk = c._tk || (c._tk = tokenize(c.text)); tk.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1)); return { tf, len: tk.length }; });
    const N = docs.length, avg = docs.reduce((n, d) => n + d.len, 0) / N || 1, df = new Map();
    q.forEach((w) => { let n = 0; docs.forEach((d) => { if (d.tf.has(w)) n++; }); df.set(w, n); });
    const scores = [];
    docs.forEach((d, i) => {
      let sc = 0;
      q.forEach((w) => { const f = d.tf.get(w); if (!f) return; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); sc += idf * (f * 2.5) / (f + 1.5 * (0.25 + 0.75 * d.len / avg)); });
      if (sc > 0) scores.push({ i, score: sc });
    });
    return scores.sort((a, b) => b.score - a.score).slice(0, k || 20);
  }
  function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
  function byVector(chunks, qv, k) {
    const out = []; chunks.forEach((c, i) => { if (c.vec && c.vec.length === qv.length) out.push({ i, score: cosine(c.vec, qv) }); });
    return out.sort((a, b) => b.score - a.score).slice(0, k || 20);
  }
  // Reciprocal rank fusion: combine two rankings without needing comparable scores.
  function fuse(lists, k) {
    const m = new Map();
    lists.forEach((l) => l.forEach((r, rank) => m.set(r.i, (m.get(r.i) || 0) + 1 / (60 + rank))));
    return Array.from(m, ([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score).slice(0, k);
  }

  const api = { tokenize, chunkText, bm25, cosine, byVector, fuse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined" || root !== window) return;

  /* ---------- storage: IndexedDB (own database) with an in-memory fallback ---------- */
  let dbp = null; const mem = { docs: new Map(), chunks: new Map() };
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      if (typeof indexedDB === "undefined") return res(null);
      try {
        const rq = indexedDB.open("icywhite-rag", 1);
        rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore("docs", { keyPath: "id" }).createIndex("chat", "chatId"); d.createObjectStore("chunks", { keyPath: "id" }).createIndex("chat", "chatId"); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function allBy(store, chatId) {
    const d = await db();
    if (!d) return Array.from(mem[store].values()).filter((x) => x.chatId === chatId);
    return req(d.transaction(store).objectStore(store).index("chat").getAll(chatId));
  }
  async function putMany(store, items) {
    const d = await db();
    if (!d) { items.forEach((x) => mem[store].set(x.id, x)); return; }
    await new Promise((res, rej) => { const tx = d.transaction(store, "readwrite"), os = tx.objectStore(store); items.forEach((x) => os.put(x)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function delMany(store, ids) {
    const d = await db();
    if (!d) { ids.forEach((id) => mem[store].delete(id)); return; }
    await new Promise((res, rej) => { const tx = d.transaction(store, "readwrite"), os = tx.objectStore(store); ids.forEach((id) => os.delete(id)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  const cache = new Map();   // chatId -> chunk list (kept in memory while you chat)
  async function chunksOf(chatId) { if (!cache.has(chatId)) cache.set(chatId, await allBy("chunks", chatId)); return cache.get(chatId); }
  let embedFn = null;   // set by the app: async (texts[]) => number[][]  (throws if the server cannot embed)

  async function embedAll(chunks, onProgress) {
    if (!embedFn) return false;
    try {
      for (let i = 0; i < chunks.length; i += 16) {
        const part = chunks.slice(i, i + 16), vecs = await embedFn(part.map((c) => c.text.slice(0, 2000)));
        part.forEach((c, j) => { c.vec = vecs[j]; });
        if (onProgress) onProgress("Indexing meaning… " + Math.min(i + 16, chunks.length) + "/" + chunks.length);
      }
      return true;
    } catch (e) { chunks.forEach((c) => { delete c.vec; }); return false; }
  }

  root.lmchatRag = {
    ...api,
    setEmbedder(fn) { embedFn = fn; },
    async list(chatId) { return (await allBy("docs", chatId)).sort((a, b) => a.added - b.added); },
    async count(chatId) { return (await allBy("docs", chatId)).length; },
    // text -> indexed document
    async addText(chatId, name, text, onProgress) {
      const parts = chunkText(String(text).slice(0, 4000000));
      if (!parts.length) throw new Error(name + " has no readable text in it.");
      const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const chunks = parts.slice(0, 20000).map((t, i) => ({ id: id + ":" + i, docId: id, chatId, idx: i, text: t }));
      const embedded = await embedAll(chunks, onProgress);
      const doc = { id, chatId, name, chars: text.length, chunks: chunks.length, embedded, added: Date.now() };
      await putMany("chunks", chunks); await putMany("docs", [doc]);
      cache.delete(chatId);
      return doc;
    },
    async remove(chatId, docId) { const cs = (await allBy("chunks", chatId)).filter((c) => c.docId === docId); await delMany("chunks", cs.map((c) => c.id)); await delMany("docs", [docId]); cache.delete(chatId); },
    async clearChat(chatId) { const ds = await allBy("docs", chatId), cs = await allBy("chunks", chatId); await delMany("chunks", cs.map((c) => c.id)); await delMany("docs", ds.map((d) => d.id)); cache.delete(chatId); },
    // -> [{n, name, text, score}]
    async search(chatId, query, k) {
      k = k || 5; const chunks = await chunksOf(chatId); if (!chunks.length) return [];
      const docs = new Map((await allBy("docs", chatId)).map((d) => [d.id, d.name]));
      const lists = [bm25(chunks, query, 20)];
      if (embedFn && chunks.some((c) => c.vec)) { try { const qv = (await embedFn([String(query).slice(0, 2000)]))[0]; if (qv) lists.push(byVector(chunks, qv, 20)); } catch (e) {} }
      const top = lists.length > 1 ? fuse(lists, k) : lists[0].slice(0, k);
      return top.map((r, n) => ({ n: n + 1, name: docs.get(chunks[r.i].docId) || "document", text: chunks[r.i].text, score: r.score }));
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
