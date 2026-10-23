/* ===========================================================
   Oasis — offline speech recognition (Whisper) add-on
   ----------------------------------------------------------
   WHY THIS EXISTS
   Chrome and Edge transcribe the microphone by sending audio to Google's online
   speech service. Electron (what Oasis runs in) is Chromium WITHOUT Google's
   service key, so window.webkitSpeechRecognition exists but every start() fails
   with the error "network". That is why Live chat and Dictate never worked.

   WHAT THIS DOES
   Provides a drop-in replacement for SpeechRecognition that runs entirely on this
   computer:  microphone -> simple voice-activity detection -> Whisper (transformers.js
   in a background worker) -> text.  voice.js uses it automatically in Electron, or
   when the browser's own service fails.

   The speech model (about 40 MB, "Whisper tiny English") is downloaded once from
   Hugging Face the first time you use voice input, then cached. After that it works
   offline. The engine script itself comes from jsDelivr/unpkg, exactly like Kokoro.

   Exposes window.LMChatSTT. Remove this file and voice.js falls back to the browser's
   own recognizer (which only works in real Chrome/Edge).
   =========================================================== */
(function () {
  "use strict";

  const TRANSFORMERS_URLS = [
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js",
    "https://unpkg.com/@huggingface/transformers@3.7.6/dist/transformers.min.js"
  ];
  const MODELS = {
    "whisper-tiny-en": { id: "Xenova/whisper-tiny.en", multi: false, label: "Whisper tiny, English (fast, about 40 MB)" },
    "whisper-base-en": { id: "Xenova/whisper-base.en", multi: false, label: "Whisper base, English (more accurate, about 90 MB)" },
    "whisper-base":    { id: "Xenova/whisper-base",    multi: true,  label: "Whisper base, many languages (about 90 MB)" }
  };
  const DEFAULT_MODEL = "whisper-tiny-en";

  const RATE = 16000;            // Whisper wants 16 kHz mono
  const FRAME = 512;             // samples per analysis frame (32 ms)
  const FRAME_MS = FRAME / RATE * 1000;
  const END_SILENCE_MS = 800;    // this much quiet after speech closes the phrase
  const MIN_SPEECH_MS = 260;     // shorter blips are ignored (clicks, coughs)
  const MAX_SEGMENT_MS = 25000;  // very long phrases are cut here and transcribed anyway
  const PRE_ROLL_FRAMES = 10;    // keep ~320 ms before speech began so first syllables aren't clipped
  const MIN_THRESHOLD = 0.012;   // RMS level (0..1) below which we always call it silence

  const hasAudio = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  const hasWorker = typeof Worker === "function" && typeof Blob === "function";

  /* ---------- status broadcasting (download progress etc.) ---------- */
  const listeners = new Set();
  let lastStatus = { text: "", ready: false };
  function status(text, ready) { lastStatus = { text: text || "", ready: !!ready }; listeners.forEach((f) => { try { f(lastStatus.text, lastStatus.ready); } catch (e) {} }); }

  /* ---------- the Whisper worker (classic worker + dynamic import: also works from file://) ---------- */
  const WORKER_SRC = [
    "const URLS = " + JSON.stringify(TRANSFORMERS_URLS) + ";",
    "let mod = null; const pipes = {};",
    "async function lib() {",
    "  if (mod) return mod; let last = null;",
    "  for (const u of URLS) { try { mod = await import(u); break; } catch (e) { last = e; } }",
    "  if (!mod) throw new Error(\"Couldn't download the speech engine (\" + ((last && last.message) || \"blocked or offline\") + \")\");",
    "  mod.env.allowLocalModels = false;",
    "  return mod;",
    "}",
    "function getPipe(model) {",
    "  if (!pipes[model]) pipes[model] = lib().then((m) => m.pipeline('automatic-speech-recognition', model, { dtype: 'q8', device: 'wasm',",
    "    progress_callback: (p) => postMessage({ t: 'progress', p }) })).catch((e) => { delete pipes[model]; throw e; });",
    "  return pipes[model];",
    "}",
    "let chain = Promise.resolve();",
    "self.onmessage = (ev) => { chain = chain.then(() => run(ev.data)); };",
    "async function run(d) {",
    "  try {",
    "    const pipe = await getPipe(d.model);",
    "    if (d.t === 'load') { postMessage({ t: 'ready', id: d.id }); return; }",
    "    const opts = { chunk_length_s: 30, return_timestamps: false };",
    "    if (d.language) { opts.language = d.language; opts.task = 'transcribe'; }",
    "    const out = await pipe(d.audio, opts);",
    "    postMessage({ t: 'text', id: d.id, text: String((out && out.text) || '') });",
    "  } catch (e) { postMessage({ t: 'error', id: d.id, msg: String((e && e.message) || e) }); }",
    "}"
  ].join("\n");

  const engine = {
    worker: null, seq: 0, waiting: new Map(), files: {}, loaded: new Set(),
    modelKey: DEFAULT_MODEL,
    setModel(key) { if (MODELS[key]) this.modelKey = key; },
    get model() { return MODELS[this.modelKey] || MODELS[DEFAULT_MODEL]; },
    _worker() {
      if (this.worker) return this.worker;
      const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })));
      w.onmessage = ({ data }) => {
        if (data.t === "progress") { this._progress(data.p || {}); return; }
        const slot = this.waiting.get(data.id); if (!slot) return;
        this.waiting.delete(data.id);
        data.t === "error" ? slot.reject(new Error(data.msg)) : slot.resolve(data);
      };
      w.onerror = (e) => {
        const err = new Error("The speech engine couldn't start (" + ((e && e.message) || "the background worker was blocked") + ").");
        this.waiting.forEach((s) => s.reject(err)); this.waiting.clear();
        try { w.terminate(); } catch (x) {} this.worker = null;
      };
      return (this.worker = w);
    },
    _progress(p) {
      if (p.status === "progress" && p.file && p.total) {
        this.files[p.file] = { loaded: p.loaded || 0, total: p.total };
        let l = 0, t = 0; for (const k in this.files) { l += this.files[k].loaded; t += this.files[k].total; }
        status("Downloading the speech model (first time only)… " + Math.round(t ? (l / t) * 100 : 0) + "%");
      } else if (p.status === "initiate" || p.status === "download") status("Downloading the speech model (first time only)…");
      else if (p.status === "ready") status("Loading the speech model…");
    },
    _ask(msg) {
      return new Promise((resolve, reject) => {
        const id = ++this.seq; this.waiting.set(id, { resolve, reject });
        try {
          const transfer = msg.audio ? [msg.audio.buffer] : [];
          this._worker().postMessage(Object.assign({ id }, msg), transfer);
        } catch (e) { this.waiting.delete(id); reject(e); }
      });
    },
    warm() {
      const key = this.modelKey;
      if (this.loaded.has(key)) { status("Offline speech is ready.", true); return Promise.resolve(); }
      status("Loading the speech model…");
      return this._ask({ t: "load", model: this.model.id }).then(
        () => { this.loaded.add(key); status("Offline speech is ready.", true); },
        (e) => { status("Offline speech couldn't start: " + e.message); throw e; }
      );
    },
    // audio: Float32Array at 16 kHz.  Returns the recognised text ("" if nothing).
    async transcribe(audio, lang) {
      await this.warm();
      let language;
      if (this.model.multi) {
        try { language = (new Intl.DisplayNames(["en"], { type: "language" }).of((lang || "en").split("-")[0]) || "english").toLowerCase(); } catch (e) { language = "english"; }
      }
      const r = await this._ask({ t: "run", model: this.model.id, audio, language });
      return r.text;
    }
  };

  /* ---------- clean-up of Whisper's output ---------- */
  function clean(t) {
    t = String(t || "").replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();   // [BLANK_AUDIO], (music), *sighs*
    if (!/[\p{L}\p{N}]/u.test(t)) return "";
    if (/^(you|thank you\.?|thanks for watching[.!]?|bye\.?|\.)$/i.test(t)) return "";                  // classic Whisper hallucinations on near-silence
    return t;
  }

  /* ---------- microphone capture: AudioWorklet (preferred) or ScriptProcessor, as 16 kHz mono frames ---------- */
  const WORKLET_SRC =
    "class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(" + FRAME + ");this.n=0;}" +
    "process(i){const c=i[0]&&i[0][0];if(!c)return true;let k=0;while(k<c.length){const m=Math.min(c.length-k," + FRAME + "-this.n);" +
    "this.b.set(c.subarray(k,k+m),this.n);this.n+=m;k+=m;if(this.n===" + FRAME + "){this.port.postMessage(this.b.slice(0));this.n=0;}}return true;}}" +
    "registerProcessor('oasis-stt',P);";

  async function openMic(onFrame) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try { ctx = new AC({ sampleRate: RATE }); } catch (e) { ctx = new AC(); }
    try { if (ctx.state === "suspended") await ctx.resume(); } catch (e) {}
    const src = ctx.createMediaStreamSource(stream);
    const ratio = ctx.sampleRate / RATE;
    let carry = [];                                              // resampling path, only used if the browser ignored our 16 kHz request
    const feed = (f32) => {
      if (ratio === 1) return onFrame(f32);
      const n = Math.floor(f32.length / ratio), out = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b; j++) s += f32[j]; out[i] = s / Math.max(1, b - a); }
      carry.push(out); let tot = 0; carry.forEach((c) => (tot += c.length));
      while (tot >= FRAME) { const big = new Float32Array(tot); let o = 0; carry.forEach((c) => { big.set(c, o); o += c.length; }); onFrame(big.slice(0, FRAME)); const rest = big.slice(FRAME); carry = rest.length ? [rest] : []; tot = rest.length; }
    };
    let node = null, sink = null;
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, "oasis-stt", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e) => feed(e.data);
    } catch (e) {
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i + FRAME <= d.length; i += FRAME) feed(d.slice(i, i + FRAME)); };
    }
    sink = ctx.createGain(); sink.gain.value = 0;               // keep the graph running without playing the mic through the speakers
    src.connect(node); node.connect(sink); sink.connect(ctx.destination);
    return function close() {
      try { node.disconnect(); src.disconnect(); sink.disconnect(); } catch (e) {}
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      try { ctx.close(); } catch (e) {}
    };
  }

  /* ---------- the SpeechRecognition look-alike ---------- */
  class Recognition {
    constructor() {
      this.lang = navigator.language || "en-US"; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
      this.onstart = this.onresult = this.onerror = this.onend = this.onspeechstart = this.onspeechend = this.onaudiostart = null;
      this.__local = true;
      this._state = "idle";            // idle -> running -> stopping -> done
      this._results = []; this._pending = 0; this._close = null;
      this._queued = null; this.keywordMode = false; this.endSilenceMs = 0; this.maxSegmentMs = 0;
      this._pre = []; this._seg = []; this._speaking = false; this._loud = 0; this._quiet = 0; this._voiced = 0; this._noise = 0.004;
    }
    _fire(name, ev) { const f = this["on" + name]; if (typeof f === "function") { try { f.call(this, ev || { type: name }); } catch (e) { console.error(e); } } }
    _fail(code, message) { this._fire("error", { type: "error", error: code, message: message || "" }); this._finish(); }
    start() {
      if (this._state !== "idle") { const e = new Error("recognition has already started"); e.name = "InvalidStateError"; throw e; }
      this._state = "running";
      if (!hasAudio || !hasWorker) { setTimeout(() => this._fail("audio-capture", "This app can't open the microphone here."), 0); return; }
      engine.warm().catch((e) => { if (this._state === "running" || this._state === "stopping") this._fail("model-load", e.message); });
      openMic((f) => this._frame(f)).then(
        (close) => { if (this._state === "done") { close(); return; } this._close = close; this._fire("start"); this._fire("audiostart"); },
        (e) => this._fail(e && (e.name === "NotFoundError" || e.name === "OverconstrainedError") ? "audio-capture" : "not-allowed", e && e.message)
      );
    }
    stop() {
      if (this._state !== "running") return;
      this._state = "stopping"; this._releaseMic();
      if (this._speaking) this._endSegment(true);
      if (!this._pending) this._finish();
    }
    abort() {
      if (this._state === "done" || this._state === "idle") { this._state = "done"; return; }
      this._pre = []; this._seg = []; this._speaking = false;
      this._finish();
    }
    _releaseMic() { const c = this._close; this._close = null; if (c) c(); }
    _finish() {
      if (this._state === "done") return;
      this._state = "done"; this._releaseMic();
      this._fire("end");
    }
    /* voice-activity detection on 32 ms frames */
    _frame(f) {
      if (this._state !== "running") return;
      let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
      const rms = Math.sqrt(s / f.length);
      const thr = Math.max(MIN_THRESHOLD, this._noise * 3);
      const loud = rms >= thr;
      if (!loud) this._noise = this._noise * 0.95 + rms * 0.05;
      if (!this._speaking) {
        this._pre.push(f); if (this._pre.length > PRE_ROLL_FRAMES) this._pre.shift();
        this._loud = loud ? this._loud + 1 : 0;
        if (this._loud >= 3) {
          this._speaking = true; this._seg = this._pre.slice(); this._pre = []; this._quiet = 0; this._voiced = this._loud; this._loud = 0;
          this._fire("speechstart");
        }
        return;
      }
      this._seg.push(f);
      if (loud) { this._quiet = 0; this._voiced++; } else this._quiet++;
      if (this._quiet * FRAME_MS >= (this.endSilenceMs || END_SILENCE_MS) || this._seg.length * FRAME_MS >= (this.maxSegmentMs || MAX_SEGMENT_MS)) this._endSegment(false);
    }
    _endSegment(flush) {
      const frames = this._seg, voiced = this._voiced;
      this._seg = []; this._speaking = false; this._quiet = 0; this._voiced = 0; this._loud = 0;
      this._fire("speechend");
      if (voiced * FRAME_MS < MIN_SPEECH_MS || !frames.length) return;
      const audio = new Float32Array(frames.length * FRAME);
      frames.forEach((fr, i) => audio.set(fr, i * FRAME));
      // Keyword listening (the "stop" command) uses short pieces; if the engine is still busy, only the newest piece waits its turn.
      if (this.keywordMode && this._pending > 0) { this._queued = audio; return; }
      this._transcribe(audio);
    }
    _transcribe(audio) {
      this._pending++;
      engine.transcribe(audio, this.lang).then(
        (text) => {
          this._pending--;
          if (this._state === "done") return;
          text = clean(text);
          if (text) this._emit(text);
          const q = this._queued; this._queued = null;
          if (q && this._state === "running") this._transcribe(q);
          if (this._state === "stopping" && !this._pending) this._finish();
          else if (!this.continuous && this._state === "running" && text) this.stop();
        },
        (e) => { this._pending--; if (this._state !== "done") this._fail("model-load", e && e.message); }
      );
    }
    _emit(text) {
      const alt = [{ transcript: (this._results.length ? " " : "") + text, confidence: 0.9 }];   // native results continue with a leading space
      alt.isFinal = true;
      this._results.push(alt);
      const resultIndex = this._results.length - 1;
      this._fire("result", { type: "result", resultIndex, results: this._results });
    }
  }

  window.LMChatSTT = {
    Recognition,
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    supported: hasAudio && hasWorker,
    setModel: (k) => engine.setModel(k),
    warm: () => engine.warm(),
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    status: () => lastStatus,
    _engine: engine           // exposed for tests
  };
})();
