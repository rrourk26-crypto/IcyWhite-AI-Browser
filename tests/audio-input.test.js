const test = require("node:test"), assert = require("node:assert");
const A = require("../js/audio-input.js");
test("encodeWav writes a valid 16-bit mono WAV header and clips samples", () => {
  const w = A.encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16000), v = new DataView(w.buffer);
  assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), "RIFF"); assert.strictEqual(String.fromCharCode(...w.slice(8, 12)), "WAVE");
  assert.strictEqual(v.getUint32(24, true), 16000); assert.strictEqual(v.getUint16(22, true), 1); assert.strictEqual(v.getUint16(34, true), 16);
  assert.strictEqual(v.getUint32(40, true), 12); assert.strictEqual(w.length, 44 + 12);
  assert.strictEqual(v.getInt16(46, true), 32767); assert.strictEqual(v.getInt16(48, true), -32768); assert.strictEqual(v.getInt16(50, true), 32767);
});
test("base64 and file detection", () => {
  assert.strictEqual(A.toBase64(new Uint8Array([104, 105])), "aGk=");
  assert(A.isAudioFile({ name: "a.MP3", type: "" })); assert(A.isAudioFile({ name: "x", type: "audio/ogg" })); assert(!A.isAudioFile({ name: "movie.webm", type: "video/webm" })); assert(!A.isAudioFile({ name: "a.txt", type: "text/plain" }));
  const big = new Uint8Array(100000).fill(65); assert.strictEqual(Buffer.from(A.toBase64(big), "base64").length, 100000);
});
