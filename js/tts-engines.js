/* ===========================================================
   LM Studio Chat — neural voice engines add-on
   Adds free, natural-sounding voices to the Voice settings:
     • Kokoro in your browser  (kokoro-js, no server, cached after first download)
     • Kokoro server / any OpenAI-compatible TTS server (e.g. Kokoro-FastAPI)
     • Puter.js  (free cloud voices: OpenAI, Gemini, ElevenLabs, Amazon Polly, xAI)
   voice.js hands each finished sentence to this file when an engine
   other than "Browser voices" is picked, so replies are spoken sentence
   by sentence while they stream, with the next sentence prepared ahead.
   Remove this file and the built-in browser voices keep working.
   =========================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const engSel = $("setEngine"), voiceSel = $("ttsVoice");
  if (!engSel || !voiceSel) return;

  const KEY = "lmchat.tts";
  const cfg = { engine: "browser", url: "http://localhost:8880/v1", key: "", voices: {} };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  if (!cfg.voices || typeof cfg.voices !== "object") cfg.voices = {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const DEFAULT_VOICE = { "kokoro-web": "af_heart", "kokoro-server": "af_heart", puter: "openai|nova" };

  /* ---------- Kokoro voice list (English voices shipped with Kokoro v1.0) ---------- */
  const KOKORO_IDS = ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_nova", "af_alloy", "af_aoede", "af_jessica", "af_kore", "af_river",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"];
  function kokoroVoice(id) {
    const m = /^([a-z])([fm])_(.+)$/.exec(id);
    if (!m) return { value: id, label: id };
    const acc = { a: "American", b: "British" }[m[1]] || m[1].toUpperCase();
    return { value: id, label: m[3][0].toUpperCase() + m[3].slice(1) + " — " + acc + (m[2] === "f" ? " woman" : " man"), group: acc + (m[2] === "f" ? " women" : " men") };
  }

  function errText(e) {
    if (!e) return "unknown error";
    if (typeof e === "string") return e;
    const m = e.message || (e.error && (e.error.message || (typeof e.error === "string" && e.error))) || e.msg;
    if (m) return String(m);
    try { return JSON.stringify(e).slice(0, 160); } catch (x) { return "unknown error"; }
  }

  /* ---------- Status line ---------- */
  const statusEl = $("ttsStatus");
  const status = (t) => { if (statusEl) statusEl.textContent = t || ""; };

  /* ---------- Kokoro in the browser (runs in a worker so the page stays smooth) ---------- */
  // A classic worker that pulls Kokoro in with import(): this also works when index.html is opened
  // straight from disk (file://), where browsers refuse module workers.
  const KOKORO_URLS = ["https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js", "https://unpkg.com/kokoro-js@1.2.1/dist/kokoro.web.js"];
  const WORKER_SRC = [
    'const URLS = ' + JSON.stringify(KOKORO_URLS) + ';',
    'let loading = null;',
    'async function boot() {',
    '  let mod = null, last = null;',
    '  for (const u of URLS) { try { mod = await import(u); break; } catch (e) { last = e; } }',
    '  if (!mod) throw new Error("Couldn\'t download the Kokoro script (" + ((last && last.message) || "blocked or offline") + ")");',
    '  return mod.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm",',
    '    progress_callback: (p) => postMessage({ t: "progress", p }) });',
    '}',
    'const load = () => loading || (loading = boot().catch((e) => { loading = null; throw e; }));',
    'let chain = Promise.resolve();',
    'self.onmessage = (ev) => { chain = chain.then(() => run(ev.data)); };',
    'async function run(d) {',
    '  try {',
    '    const m = await load();',
    '    if (d.t === "warm") { postMessage({ t: "ready", id: d.id }); return; }',
    '    const a = await m.generate(d.text, { voice: d.voice, speed: 1 });',
    '    postMessage({ t: "audio", id: d.id, blob: a.toBlob() });',
    '  } catch (e) { postMessage({ t: "error", id: d.id, msg: String((e && e.message) || e) }); }',
    '}'
  ].join("\n");

  let worker = null, wid = 0;
  const waiting = new Map();
  function kokoroWorker() {
    if (worker) return worker;
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })), undefined);
    worker.onmessage = ({ data }) => {
      if (data.t === "progress") {
        const p = data.p || {};
        if (cfg.engine === "kokoro-web") status(p.status === "progress" && p.progress >= 0 ? "Downloading Kokoro voice model… " + Math.round(p.progress) + "%" : "Loading Kokoro voice model…");
        return;
      }
      const w = waiting.get(data.id); if (!w) return;
      waiting.delete(data.id);
      data.t === "error" ? w.reject(new Error(data.msg)) : w.resolve(data);
    };
    worker.onerror = (e) => {
      const err = new Error("Kokoro couldn't start (" + (e.message || "the browser blocked the background worker") + ").");
      waiting.forEach((w) => w.reject(err)); waiting.clear(); worker = null;
    };
    return worker;
  }
  function askKokoro(msg) {
    return new Promise((resolve, reject) => { const id = ++wid; waiting.set(id, { resolve, reject }); try { kokoroWorker().postMessage(Object.assign({ id }, msg)); } catch (e) { waiting.delete(id); reject(e); } });
  }
  function warmKokoro() {
    status("Loading Kokoro voice model…");
    askKokoro({ t: "warm" }).then(() => { if (cfg.engine === "kokoro-web") status("Kokoro is ready. It runs entirely on this computer."); }, (e) => { if (cfg.engine === "kokoro-web") status(errText(e)); });
  }

  /* ---------- Puter.js (loaded only when you pick it) ---------- */
  let puterP = null;
  const loadPuter = () => window.puter ? Promise.resolve(window.puter) : puterP || (puterP = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://js.puter.com/v2/";
    s.onload = () => { try { if (cfg.puterToken && window.puter && typeof window.puter.setAuthToken === "function") window.puter.setAuthToken(cfg.puterToken); } catch (e) {} res(window.puter); }; s.onerror = () => { puterP = null; rej(new Error("Couldn't load Puter.js. Check your internet connection.")); };
    document.head.appendChild(s);
  }));
  const PUTER_NAMES = { "aws-polly": "Amazon Polly", openai: "OpenAI", elevenlabs: "ElevenLabs", gemini: "Google Gemini", xai: "xAI" };
  const PUTER_FALLBACK = [["openai", "nova"], ["openai", "alloy"], ["openai", "onyx"], ["openai", "shimmer"], ["openai", "fable"], ["openai", "echo"],
    ["gemini", "Puck"], ["gemini", "Charon"], ["gemini", "Kore"], ["gemini", "Aoede"], ["gemini", "Fenrir"],
    ["elevenlabs", "21m00Tcm4TlvDq8ikWAM"], ["aws-polly", "Joanna"], ["aws-polly", "Matthew"], ["aws-polly", "Amy"], ["xai", "eve"]];
  let puterMeta = {};
  function puterVoice(provider, id, name) { return { value: provider + "|" + id, label: name || id, group: PUTER_NAMES[provider] || provider }; }

  async function puterAuthStatus() {
    try {
      const p = await loadPuter();
      if (cfg.puterToken) {   // signed in with a pasted token instead of the sign-in window
        if (typeof p.setAuthToken !== "function") { if (cfg.engine === "puter") status("This version of Puter.js can't use a pasted token. Choose Kokoro in your browser instead."); return; }
        try {
          p.setAuthToken(cfg.puterToken);
          const u = await p.auth.getUser();
          if (cfg.engine === "puter") status("Puter accepted your token" + (u && u.username ? " (signed in as " + u.username + ")" : "") + ". Send a message to hear the voice. If it stays silent, Puter is refusing voice requests from this app: use Kokoro in your browser.");
        } catch (e) { if (cfg.engine === "puter") status("Puter didn't accept the token (" + errText(e) + "). Copy it again from puter.com/dashboard#account, or use Kokoro in your browser."); }
        return;
      }
      const ok = await p.auth.isSignedIn();
      if (cfg.engine !== "puter") return;
      if (ok) { let n = ""; try { n = (await p.auth.getUser()).username; } catch (e) {} status("Signed in to Puter" + (n ? " as " + n : "") + ". The free cloud voices are ready."); }
      else status("Click “Sign in to Puter” once (a free account; it opens a small window). After that the voices work.");
    } catch (e) { if (cfg.engine === "puter") status("Couldn't reach Puter: " + errText(e) + " An ad blocker or firewall may be blocking js.puter.com."); }
  }
  async function puterSignIn() {
    status("Opening the Puter sign-in window…");
    try { const p = await loadPuter(); await p.auth.signIn(); await puterAuthStatus(); }
    catch (e) {
      const why = errText(e);
      if (/unsupported_origin/i.test(why)) status("Puter doesn't allow sign-in from this app (it runs from local files). Paste your Puter token in the box below instead (see the note under it), or choose \u201cKokoro in your browser\u201d: free, natural, and needs no account.");
      else status("Puter sign-in didn't finish (" + why + "). Allow pop-ups for this page and try again.");
    }
  }

  /* ---------- Engines: how to list voices and how to turn a sentence into audio ---------- */
  const trim = (u) => (u || "").trim().replace(/\/+$/, "");
  const engines = {
    "kokoro-web": {
      voices: async () => KOKORO_IDS.map(kokoroVoice),
      synth: async (text, voice) => URL.createObjectURL((await askKokoro({ t: "gen", text, voice })).blob)
    },
    "kokoro-server": {
      voices: async () => {
        try {
          const r = await fetch(trim(cfg.url) + "/audio/voices", { headers: cfg.key ? { Authorization: "Bearer " + cfg.key } : {} });
          if (!r.ok) throw new Error("HTTP " + r.status);
          const j = await r.json(), list = Array.isArray(j) ? j : (j.voices || []);
          const out = list.map((v) => kokoroVoice(typeof v === "string" ? v : (v.id || v.name))).filter((v) => v.value);
          if (!out.length) throw new Error("no voices returned");
          status("Connected. " + out.length + " voices found on the server.");
          return out;
        } catch (e) {
          status("No Kokoro server answered at " + trim(cfg.url) + " (" + errText(e) + "). You don't need one: pick “Kokoro, runs in your browser” instead, or start Kokoro-FastAPI (CORS on). Showing the standard voices meanwhile.");
          return KOKORO_IDS.map(kokoroVoice);
        }
      },
      synth: async (text, voice) => {
        const r = await fetch(trim(cfg.url) + "/audio/speech", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, cfg.key ? { Authorization: "Bearer " + cfg.key } : {}),
          body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "mp3", speed: 1 })
        });
        if (!r.ok) throw new Error("Voice server replied " + r.status);
        return URL.createObjectURL(await r.blob());
      }
    },
    puter: {
      voices: async () => {
        try {
          const p = await loadPuter();
          const all = await p.ai.txt2speech.listVoices();
          const en = (all || []).filter((v) => !v.language || /^en/i.test((v.language.code || "") + ""));
          if (!en.length) throw new Error("empty list");
          puterMeta = {};
          en.forEach((v) => { puterMeta[v.provider + "|" + v.id] = { model: (v.supported_models || [])[0], engine: (v.supported_engines || [])[0] }; });
          return en.map((v) => puterVoice(v.provider, v.id, (v.name || v.id) + (v.language && v.language.name ? " (" + v.language.name + ")" : "")));
        } catch (e) {
          return PUTER_FALLBACK.map(([p, id]) => puterVoice(p, id, id.length > 20 ? "Rachel" : id));
        }
      },
      synth: async (text, voice) => {
        const [provider, id] = voice.split("|"), meta = puterMeta[voice] || {};
        const o = { provider, voice: id };
        if (provider === "openai") o.model = meta.model || "gpt-4o-mini-tts";
        else if (provider === "elevenlabs") o.model = meta.model || "eleven_multilingual_v2";
        else if (provider === "gemini") o.model = meta.model || "gemini-2.5-flash-preview-tts";
        else if (provider === "aws-polly") o.engine = meta.engine || "neural";
        const puter = await loadPuter();
        const a = await puter.ai.txt2speech(text, o);
        if (!a || !a.src) throw new Error("Puter didn't return any audio.");
        return a.src;
      }
    }
  };

  /* ---------- Speaking queue: sentences play in order, the next one is prepared while one plays ---------- */
  const q = [];
  let running = false, epoch = 0, cur = null, curDone = null;
  const revoke = (u) => { if (u && String(u).startsWith("blob:")) { try { URL.revokeObjectURL(u); } catch (e) {} } };
  const voiceId = () => cfg.voices[cfg.engine] || DEFAULT_VOICE[cfg.engine];

  function prepare(i) {
    const it = q[i];
    if (it && !it.p) it.p = engines[it.engine].synth(it.text, it.voice).catch((e) => { it.err = e; return null; });
  }
  function play(url, it) {
    return new Promise((resolve) => {
      const a = new Audio(url); a._url = url; cur = a; curDone = resolve;
      a.playbackRate = it.opts.rate || 1;
      if (typeof it.opts.volume === "number") a.volume = Math.min(1, Math.max(0, it.opts.volume));
      let over = false;
      const finish = (msg) => {
        if (over) return; over = true;
        if (cur === a) { cur = null; curDone = null; }
        revoke(url); resolve();
        if (msg && it.opts.error) it.opts.error(msg);
        if (it.epoch === epoch) it.opts.end();
      };
      a.onplaying = () => { if (it.epoch === epoch && it.opts.start) it.opts.start(); };
      a.onended = () => finish();
      a.onerror = () => finish("The voice audio couldn't be played.");
      a.play().catch((e) => finish(e && e.name === "NotAllowedError" ? "Your browser blocked audio. Click anywhere on the page, then try again." : "The voice audio couldn't be played."));
    });
  }
  async function run() {
    if (running) return; running = true;
    while (q.length) {
      const it = q[0]; prepare(0); prepare(1);
      const url = await it.p;
      if (it.epoch !== epoch) { revoke(url); continue; }   // cancelled while waiting; the queue was already cleared
      q.shift();
      if (!url) { if (it.opts.error) it.opts.error(errText(it.err || "The voice engine failed.")); it.opts.end(); continue; }
      await play(url, it);
    }
    running = false;
  }

  window.LMChatTTS = {
    active() { return cfg.engine !== "browser" && engines[cfg.engine] ? this : null; },
    speak(text, opts) { q.push({ text, opts: opts || {}, epoch, engine: cfg.engine, voice: voiceId(), p: null }); run(); },
    setVolume(v) { if (cur) { try { cur.volume = Math.min(1, Math.max(0, v)); } catch (e) {} } },   // change the voice that is playing right now
    cancel() {
      epoch++;
      q.splice(0).forEach((it) => { if (it.p) it.p.then(revoke); });
      if (cur) { cur.onended = cur.onerror = cur.onplaying = null; try { cur.pause(); } catch (e) {} revoke(cur._url); const d = curDone; cur = null; curDone = null; if (d) d(); }
    }
  };

  /* ---------- Settings controls ---------- */
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? "" : "none"; };
  async function fillVoices() {
    const e = cfg.engine, eng = engines[e];
    if (!eng) return;
    voiceSel.innerHTML = ""; voiceSel.disabled = true;
    const opt = document.createElement("option"); opt.textContent = "Loading voices…"; voiceSel.appendChild(opt);
    const list = await eng.voices();
    if (e !== cfg.engine) return;   // engine changed while loading
    voiceSel.innerHTML = ""; voiceSel.disabled = false;
    const groups = {};
    list.forEach((v) => {
      const o = document.createElement("option"); o.value = v.value; o.textContent = v.label;
      let parent = voiceSel;
      if (v.group) { parent = groups[v.group] || (groups[v.group] = voiceSel.appendChild(Object.assign(document.createElement("optgroup"), { label: v.group }))); }
      parent.appendChild(o);
    });
    const want = voiceId();
    voiceSel.value = list.some((v) => v.value === want) ? want : list[0].value;
    cfg.voices[e] = voiceSel.value; save();
  }
  function refreshUI() {
    const e = cfg.engine, neural = e !== "browser";
    engSel.value = e;
    show("browserVoiceRow", !neural); show("engineBox", neural); show("serverBox", e === "kokoro-server"); show("puterSignIn", e === "puter"); show("puterTokenBox", e === "puter");
    $("ttsUrl").value = cfg.url; $("ttsKey").value = cfg.key;
    status(e === "kokoro-web" ? "First use downloads the Kokoro voice model (about 90 MB) once, then it's cached." : "");
    if (neural) fillVoices().then(() => { if (e === "puter") puterAuthStatus(); });
    if (e === "kokoro-web") warmKokoro();
  }
  engSel.onchange = () => { window.LMChatTTS.cancel(); cfg.engine = engSel.value; save(); refreshUI(); };
  voiceSel.onchange = () => { cfg.voices[cfg.engine] = voiceSel.value; save(); };
  $("ttsRefresh").onclick = () => fillVoices().then(() => { if (cfg.engine === "puter") puterAuthStatus(); });
  $("puterSignIn").onclick = puterSignIn;
  $("puterToken").value = cfg.puterToken || "";
  $("puterToken").onchange = () => {
    const v = $("puterToken").value.trim().replace(/^bearer\s+/i, "");
    if (v) cfg.puterToken = v; else delete cfg.puterToken;
    save(); window.LMChatTTS.cancel();
    if (window.puter && v && typeof window.puter.setAuthToken === "function") { try { window.puter.setAuthToken(v); } catch (e) {} }
    if (cfg.engine === "puter") { status(v ? "Checking your token\u2026" : "Token removed."); if (v) puterAuthStatus(); }
  };
  $("ttsUrl").onchange = () => { cfg.url = $("ttsUrl").value.trim() || "http://localhost:8880/v1"; save(); fillVoices(); };
  $("ttsKey").onchange = () => { cfg.key = $("ttsKey").value.trim(); save(); fillVoices(); };
  if (!engines[cfg.engine]) cfg.engine = "browser";
  refreshUI();
})();
