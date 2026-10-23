/* llama-multi.js — run MORE THAN ONE local model at the same time (main process only).
 *
 * The main model (llama-manager.js, the one started with "Start & use") is left exactly as it was. Every extra model
 * is its own llama-server, run by its own llama-manager instance on its own port (8081, 8082, ...). An extra model
 * copies the main model's server settings (runtime, models folder, network, CORS, API key, performance flags) and
 * has its own model file, context size and GPU layers.
 *
 * Plain Node, no Electron imports:  node --test tests/llama-multi.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const MAX_SLOTS = 8;
const SHARED = ["modelsDir", "binPath", "runtime", "runtimesDir", "host", "cors", "corsOrigins", "apiKey", "extraArgs", "opts"];

function createMultiLlama(o) {
  if (!o || !o.primary || typeof o.makeManager !== "function" || !o.userDataDir) throw new Error("primary, makeManager and userDataDir are required");
  const primary = o.primary;
  const file = path.join(o.userDataDir, "llama-extra.json");
  let data = { max: 3, slots: [] };   // slots: [{ id, model, ctx, ngl, port, autoStart }]
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j && typeof j === "object") data = Object.assign(data, j); } catch (e) {}
  if (!Array.isArray(data.slots)) data.slots = [];
  const mgrs = new Map();   // id -> llama-manager instance
  let busy = new Set();

  const save = () => { try { fs.mkdirSync(o.userDataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {} };
  const slot = (id) => data.slots.find((s) => s.id === id);
  const mgr = (s) => {
    if (!mgrs.has(s.id)) mgrs.set(s.id, o.makeManager("llama-slot-" + s.id + ".json"));
    return mgrs.get(s.id);
  };
  const running = (m) => { const st = m.getStatus().state; return st === "starting" || st === "ready"; };
  const countRunning = () => (["starting", "ready"].includes(primary.getStatus().state) ? 1 : 0) + data.slots.filter((s) => mgrs.has(s.id) && running(mgrs.get(s.id))).length;
  const usedPorts = () => { const p = new Set([primary.getStatus().port, primary.getConfig().port]); data.slots.forEach((s) => { p.add(s.port); if (mgrs.has(s.id)) p.add(mgrs.get(s.id).getStatus().port); }); return p; };
  function nextPort(skipId) {
    const used = usedPorts(); data.slots.forEach((s) => { if (s.id === skipId) used.delete(s.port); });
    let p = (primary.getConfig().port || 8080) + 1;
    while (used.has(p) && p < 65535) p++;
    return p;
  }

  function view(s) {
    const m = mgrs.get(s.id), st = m ? m.getStatus() : null;
    return {
      id: s.id, model: s.model, ctx: s.ctx, ngl: s.ngl, port: s.port, autoStart: !!s.autoStart,
      state: st ? st.state : "stopped", apiBase: st ? st.apiBase : "", addresses: st ? st.addresses : [], vision: st ? st.vision : false,
      error: st ? st.error : "", hint: st ? st.hint : "", startedAt: st ? st.startedAt : 0, runtime: st ? st.runtime : null,
      keyed: st ? st.keyed : false, notice: st ? st.notice : "", note: s.note || "", log: st ? st.log.slice(-25) : []
    };
  }
  function list() { return { max: data.max, running: countRunning(), slots: data.slots.map(view), ports: data.slots.map((s) => (mgrs.has(s.id) ? mgrs.get(s.id).getStatus().port : 0)).filter(Boolean) }; }

  async function launch(s) {
    const m = mgr(s), p = primary.getConfig(), cfg = {};
    SHARED.forEach((k) => { cfg[k] = p[k]; });
    cfg.ctx = s.ctx; cfg.ngl = s.ngl; cfg.port = s.port; cfg.autoStart = false;
    m.setConfig(cfg);
    const st = await m.start({ model: s.model });
    const real = m.getStatus().port; if (real && real !== s.port) { s.port = real; save(); }
    return st;
  }
  const guard = (id, fn) => async (...a) => {
    if (busy.has(id)) return { error: "Please wait: this model is busy." };
    busy.add(id); try { return await fn(...a); } finally { busy.delete(id); }
  };

  async function add(req) {
    req = req || {};
    const model = String(req.model || "").trim();
    if (!model) return { error: "Pick a model first." };
    if (data.slots.length >= MAX_SLOTS) return { error: "That is the most extra models you can keep in the list (" + MAX_SLOTS + "). Remove one first." };
    if (countRunning() >= data.max) return { error: "You already have " + countRunning() + " model(s) running, the limit in \"Most models at once\". Stop one or raise the limit." };
    const p = primary.getConfig();
    const s = { id: "m" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36), model, ctx: Math.max(512, parseInt(req.ctx, 10) || p.ctx || 8192),
      ngl: req.ngl != null ? Math.max(0, parseInt(req.ngl, 10) || 0) : (p.ngl != null ? p.ngl : 99), port: nextPort(), autoStart: true };
    data.slots.push(s); save();
    await guard(s.id, () => launch(s))();
    return list();
  }
  async function update(id, patch) {
    const s = slot(id); if (!s) return { error: "Unknown model." };
    patch = patch || {};
    if (patch.model) s.model = String(patch.model);
    if (patch.ctx != null) s.ctx = Math.max(512, Math.min(2000000, parseInt(patch.ctx, 10) || s.ctx));
    if (patch.ngl != null) s.ngl = Math.max(0, Math.min(999, parseInt(patch.ngl, 10) || 0));
    save();
    return list();
  }
  async function reload(id, patch) {
    const s = slot(id); if (!s) return { error: "Unknown model." };
    await update(id, patch);
    const m = mgrs.get(id);
    if (!(m && running(m)) && countRunning() >= data.max) return { error: "You already have " + countRunning() + " model(s) running, the limit in \"Most models at once\". Stop one or raise the limit." };
    s.autoStart = true; s.note = ""; save();
    await guard(id, () => launch(s))();
    return list();
  }
  async function stop(id) {
    const s = slot(id); if (!s) return { error: "Unknown model." };
    s.autoStart = false; save();
    const m = mgrs.get(id); if (m) await guard(id, () => m.stop())();
    return list();
  }
  async function remove(id) {
    const s = slot(id); if (!s) return list();
    const m = mgrs.get(id); if (m) { try { await m.stop(); } catch (e) {} mgrs.delete(id); }
    data.slots = data.slots.filter((x) => x.id !== id); save();
    try { fs.unlinkSync(path.join(o.userDataDir, "llama-slot-" + id + ".json")); } catch (e) {}
    if (o.logDir) ["", ".1", ".2"].forEach((x) => { try { fs.unlinkSync(path.join(o.logDir, "llama-slot-" + id + ".log" + x)); } catch (e) {} });
    return list();
  }
  async function stopAll() {
    for (const s of data.slots) { s.autoStart = false; const m = mgrs.get(s.id); if (m) { try { await m.stop(); } catch (e) {} } }
    save(); return list();
  }
  function setMax(n) { data.max = Math.max(1, Math.min(MAX_SLOTS + 1, parseInt(n, 10) || data.max)); save(); return list(); }
  // At app start: bring back the extra models that were running (only when "Start automatically" is on for the main model).
  // One at a time: each model is given time to finish loading before the next one starts, and a model that clearly will not
  // fit in the memory that is free at that moment is skipped (it stays in the list, stopped, with a note) instead of freezing the PC.
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
  async function autoStart() {
    if (!primary.getConfig().autoStart) return list();
    for (const s of data.slots) {
      if (!s.autoStart) continue;
      if (countRunning() >= data.max) { s.note = "Not started at launch: the limit of " + data.max + " models at once was reached."; continue; }
      try { await primary.whenSettled(); } catch (e) {}                      // the main model finishes loading first
      if (typeof primary.estimate === "function") {
        let est = null; try { est = await primary.estimate(s.model, { ctx: s.ctx, ngl: s.ngl }); } catch (e) {}
        if (est && est.level === "too_big") { s.note = "Not started at launch: " + est.message; continue; }
      }
      s.note = "";
      try { await launch(s); await mgr(s).whenSettled(); } catch (e) {}
      await sleep(o.staggerMs != null ? o.staggerMs : 1500);
    }
    return list();
  }
  function shutdownSync() { mgrs.forEach((m) => { try { m.shutdownSync(); } catch (e) {} }); }

  return { list, add, update, reload, stop, remove, stopAll, setMax, autoStart, shutdownSync };
}

module.exports = { createMultiLlama };
