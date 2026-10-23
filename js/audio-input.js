/* Audio input: turns a sound file (mp3, wav, m4a, ogg, flac, webm...) or a microphone recording into a 16 kHz mono WAV,
 * the form llama.cpp's server accepts as an "input_audio" message part for audio-capable models (Qwen2-Audio, Voxtral, Ultravox, Qwen2.5-Omni...).
 * Pure helpers are exported for tests; in the page everything is on window.lmchatAudio. */
(function (root) {
  "use strict";
  const RATE = 16000, MAX_SECONDS = 300;
  const AUDIO_EXT = new Set("mp3 wav ogg oga flac aac m4a opus webm weba aiff aif caf".split(" "));
  const extOf = (n) => (String(n || "").split(".").pop() || "").toLowerCase();
  const isAudioFile = (f) => !!f && (/^audio\//i.test(f.type || "") || (AUDIO_EXT.has(extOf(f.name)) && !/^video\//i.test(f.type || "")));

  function encodeWav(samples, rate) {   // Float32Array (-1..1) -> Uint8Array of a 16-bit PCM mono WAV
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i] || 0)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  function toBase64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")); }

  const api = { encodeWav, toBase64, isAudioFile, RATE, MAX_SECONDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined" || root !== window) return;

  async function decodeToMono16k(arrayBuf) {
    const AC = window.AudioContext || window.webkitAudioContext, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC || !OAC) throw new Error("this browser cannot read audio");
    const ctx = new AC(); let buf;
    try { buf = await ctx.decodeAudioData(arrayBuf.slice(0)); } catch (e) { throw new Error("that audio format could not be decoded"); } finally { try { ctx.close(); } catch (e) {} }
    if (buf.duration > MAX_SECONDS) throw new Error("the clip is " + Math.round(buf.duration) + " seconds long; the limit is " + MAX_SECONDS / 60 + " minutes. Trim it first");
    const off = new OAC(1, Math.max(1, Math.ceil(buf.duration * RATE)), RATE), src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    return { samples: (await off.startRendering()).getChannelData(0), seconds: buf.duration };
  }
  root.lmchatAudio = {
    ...api,
    // File/Blob -> { b64, seconds, bytes }
    async fileToWav(file) {
      const { samples, seconds } = await decodeToMono16k(await file.arrayBuffer());
      const wav = encodeWav(samples, RATE); return { b64: toBase64(wav), seconds, bytes: wav.length };
    },
    b64ToBlobUrl(b64, type) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([u], { type: type || "audio/wav" })); },
    canRecord: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
    async startRecording() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), rec = new MediaRecorder(stream), chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: rec.mimeType || "audio/webm" })); }; });
      rec.start();
      return { stop: () => { try { rec.stop(); } catch (e) {} return done; } };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
