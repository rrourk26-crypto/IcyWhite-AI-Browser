/* Live chat helpers: wake-word matching and "speak over it" (barge-in) detection.
 * Pure logic so it can be tested on its own; js/voice.js uses it through window.LMChatWake. */
(function (root) {
  "use strict";

  const norm = (w) => String(w).toLowerCase().replace(/['’]/g, "");
  function tokens(s) {
    const out = [], re = /[\p{L}\p{N}'’]+/gu; let m;
    while ((m = re.exec(String(s || "")))) out.push({ w: norm(m[0]), s: m.index, e: m.index + m[0].length });
    return out;
  }
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  // Speech recognition often adds or drops a letter, so longer words may differ by one letter (two for very long ones). Short words must match exactly.
  function similar(a, b) {
    if (a === b) return true;
    const n = Math.max(a.length, b.length), lim = n >= 10 ? 2 : n >= 5 ? 1 : 0;
    return lim > 0 && Math.abs(a.length - b.length) <= lim && lev(a, b) <= lim;
  }
  // First place in `text` where the wake word / phrase is spoken: {start, end} (character positions) or null.
  function find(text, wake) {
    const toks = tokens(text), ww = tokens(wake).map((t) => t.w);
    if (!ww.length) return null;
    for (let i = 0; i + ww.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < ww.length; j++) if (!similar(toks[i + j].w, ww[j])) { ok = false; break; }
      if (ok) return { start: toks[i].s, end: toks[i + ww.length - 1].e };
    }
    return null;
  }
  // What was said after the wake word ("Computer, what time is it" -> "what time is it"), or null if the wake word was not said.
  function after(text, wake) {
    const m = find(text, wake); if (!m) return null;
    return String(text).slice(m.end).replace(/^[\s,.:;!?\-–—]+/, "").trim();
  }
  const END_RE = /^(?:(?:ok|okay|alright)[, ]+)?(?:good\s?bye|bye(?:[ -]bye)?|that['’]?s all(?: for now)?|that will be all|stop listening|pause listening|mute (?:the )?(?:mic|microphone)|go to sleep|(?:thanks|thank you)[, ]+(?:that['’]?s all|goodbye|bye))[\s.!,]*$/i;
  const isGoodbye = (text) => END_RE.test(String(text || "").trim());

  /* Interrupting by voice while it talks: a short utterance that is "stop" (or similar) or contains the wake word. Long phrases are ignored,
   * and if the reply itself contains that word, only a very short utterance counts (so its own voice coming back through the speakers rarely fools it). */
  const STOP_WORDS = ["stop", "wait", "pause", "quiet", "enough", "cancel", "shush", "hush", "halt", "freeze", "silence", "abort"];
  const STOP_HEARD = ["stopp", "stap", "stob", "stoppe", "stopped", "stops"];   // common mishearings of "stop"
  const STOP_PHRASE = /\b(hold on|hang on|shut up|be quiet|never mind|thats enough|that is enough|stop talking|stop it|knock it off|cut it out)\b/;
  function isStopCommand(text, wake, spoken) {
    const toks = tokens(text).map((t) => t.w); if (!toks.length) return false;
    const said = tokens(spoken || "").map((t) => t.w), saidSet = new Set(said), saidStr = " " + said.join(" ") + " ";
    const check = (win) => {
      const hasStop = win.some((w) => STOP_WORDS.includes(w)) || STOP_PHRASE.test(win.join(" ")) || (win.length <= 2 && win.some((w) => STOP_HEARD.includes(w)));
      const hasWake = !!(wake && find(win.join(" "), wake));
      if (!hasStop && !hasWake) return false;
      const echo = (hasStop && win.some((w) => STOP_WORDS.includes(w) && saidSet.has(w))) || (hasWake && tokens(wake).some((t) => saidSet.has(t.w)));
      return !echo || win.length <= 2;
    };
    if (toks.length <= 5 && check(toks)) return true;
    // A longer piece is probably its own voice plus yours: look at the last few words only, unless that is just the reply continuing.
    for (const n of [1, 2, 3]) {
      if (toks.length <= n) break;
      const tail = toks.slice(-n);
      if (check(tail) && !saidStr.includes(" " + tail.join(" ") + " ")) return true;
    }
    return false;
  }

  /* "end live", "stop live chat", "turn off live mode"... : leave live chat completely (not just stop the reply). */
  const END_LIVE_RE = /^(?:(?:ok|okay|hey|please|alright)[, ]+)*(?:end|stop|exit|quit|close|leave|turn off|shut off|disable|cancel)\s+(?:the\s+|this\s+)?(?:live|live chat|live mode|live conversation|voice chat|voice mode)(?:\s+(?:please|now))?[\s.!,]*$/i;
  const isEndLive = (text) => END_LIVE_RE.test(String(text || "").replace(/[’']/g, "").trim());

  /* Speaking over the reply. The microphone level is compared with a running average of itself: the app's own voice coming back
   * through the speakers raises that average, so only something clearly louder, for a moment (you talking), counts. */
  const PRESET = { low: { f: 3.2, min: 0.05, n: 10 }, normal: { f: 2.4, min: 0.03, n: 8 }, high: { f: 1.8, min: 0.02, n: 6 } };
  const GRACE_FRAMES = 15;   // about 0.6 s at 40 ms per frame: learn the level before judging
  function createBargeDetector(sens) {
    const P = PRESET[sens] || PRESET.normal; let ema = null, run = 0, frames = 0;
    return {
      feed(rms) {
        frames++; if (ema === null) ema = rms;
        const loud = frames > GRACE_FRAMES && rms > Math.max(P.min, ema * P.f);
        run = loud ? run + 1 : 0;
        if (run < 3) ema += (rms - ema) * (frames < GRACE_FRAMES ? 0.3 : 0.05);
        return run >= P.n;
      },
      reset() { ema = null; run = 0; frames = 0; }
    };
  }

  const api = { tokens, similar, find, after, isGoodbye, isEndLive, isStopCommand, createBargeDetector, PRESET };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LMChatWake = api;
})(typeof window !== "undefined" ? window : null);
