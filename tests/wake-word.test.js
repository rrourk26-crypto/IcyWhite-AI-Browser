const test = require("node:test"), assert = require("node:assert");
const W = require("../js/wake-word.js");
test("finds the wake word and returns what came after it", () => {
  assert.strictEqual(W.after("Computer, what time is it?", "computer"), "what time is it?");
  assert.strictEqual(W.after("hey computer tell me a joke", "computer"), "tell me a joke");
  assert.strictEqual(W.after("Computer.", "computer"), "");
  assert.strictEqual(W.after("what is a computer made of", "computer"), "made of");   // said mid-sentence still counts: the app cannot tell
  assert.strictEqual(W.after("the weather is nice", "computer"), null);
  assert.strictEqual(W.after("COMPUTER! Hello", "Computer"), "Hello");
});
test("forgives one wrong letter in longer words, not in short ones", () => {
  assert(W.similar("computer", "computers")); assert(W.similar("computer", "computar")); assert(!W.similar("computer", "commuters"));
  assert(!W.similar("cat", "bat")); assert(!W.similar("jarvis", "service")); assert(W.similar("jarvis", "jarvas"));
});
test("multi-word wake phrases need every word in order", () => {
  assert.strictEqual(W.after("okay hey jarvis open the door", "hey jarvis"), "open the door");
  assert.strictEqual(W.after("hey there jarvis", "hey jarvis"), null);
  assert.strictEqual(W.find("anything", ""), null);
});
test("goodbye phrases", () => {
  ["Goodbye.", "ok bye", "That's all", "that's all for now!", "stop listening", "Thanks, that's all."].forEach((t) => assert(W.isGoodbye(t), t));
  ["goodbye is a long word to say in a song", "tell me about the goodbye song", "bye the way, what time is it"].forEach((t) => assert(!W.isGoodbye(t), t));
});
test("barge-in: steady echo never triggers, a clear louder voice does", () => {
  let d = W.createBargeDetector("normal"), hit = false;
  for (let i = 0; i < 200; i++) if (d.feed(0.05 + 0.015 * Math.sin(i / 3))) hit = true;   // the app's own voice: varies, but around one level
  assert(!hit, "echo alone must not interrupt");
  let at = -1; for (let i = 0; i < 20; i++) if (d.feed(0.2)) { at = i; break; }
  assert(at >= 0 && at <= 9, "voice detected within about 0.4 s, got " + at);
  d = W.createBargeDetector("normal"); hit = false;
  for (let i = 0; i < 100; i++) if (d.feed(0.002)) hit = true;   // quiet room
  assert(!hit);
  for (let i = 0; i < 20; i++) if (d.feed(0.025)) hit = true;    // a soft sound below the minimum
  assert(!hit, "very quiet sounds are ignored");
});
test("barge-in: a short click or bump does not interrupt; sensitivity changes the bar", () => {
  const d = W.createBargeDetector("normal"); let hit = false;
  for (let i = 0; i < 40; i++) d.feed(0.01);
  for (let i = 0; i < 3; i++) if (d.feed(0.3)) hit = true; for (let i = 0; i < 10; i++) if (d.feed(0.01)) hit = true;
  assert(!hit);
  const lo = W.createBargeDetector("low"), hi = W.createBargeDetector("high"); let loHit = false, hiHit = false;
  for (let i = 0; i < 40; i++) { lo.feed(0.03); hi.feed(0.03); }
  for (let i = 0; i < 12; i++) { if (lo.feed(0.07)) loHit = true; if (hi.feed(0.07)) hiHit = true; }
  assert(hiHit && !loHit, "high reacts to a modest voice, low does not");
});
test("voice interrupt: stop words and the wake word, short phrases only", () => {
  ["Stop", "stop.", "Computer", "computer stop", "hold on", "wait a second", "be quiet"].forEach((t) => assert(W.isStopCommand(t, "computer", ""), t));
  ["tell me about the bus stop on the corner today", "the weather is nice", ""].forEach((t) => assert(!W.isStopCommand(t, "computer", ""), t));
  assert(!W.isStopCommand("wait a moment please", "computer", "You should wait a moment before it cools."));   // its own voice
  assert(W.isStopCommand("stop", "computer", "Please stop by later."));                                         // a one-word "stop" still works
});
test("voice interrupt: your 'stop' at the end of a longer piece that also holds its own voice", () => {
  const reply = "Here is how photosynthesis works in plants and why it matters for the air we breathe";
  assert(W.isStopCommand("why it matters for the air we breathe stop", "computer", reply));
  assert(W.isStopCommand("photosynthesis works in plants and why computer stop", "computer", reply));
  assert(!W.isStopCommand("why it matters for the air we breathe", "computer", reply));
  assert(!W.isStopCommand("and why it matters for your computer", "computer", "it matters for your computer"));   // the reply itself ends with the wake word
});

test("end live commands and extra stop words", () => {
  const W = require("../js/wake-word.js");
  ["end live", "stop live", "stop live chat", "Okay, end live chat please.", "turn off live mode", "exit live"].forEach((s) => assert.strictEqual(W.isEndLive(s), true, s));
  ["stop", "I want to live in Spain", "end of the story", "what is live music"].forEach((s) => assert.strictEqual(W.isEndLive(s), false, s));
  ["halt", "freeze", "silence", "that's enough", "stop talking"].forEach((s) => assert.strictEqual(W.isStopCommand(s, "computer", ""), true, s));
});

test("pause listening phrases go back to waiting", () => {
  ["pause listening", "mute the mic", "go to sleep", "stop listening"].forEach((s) => assert.strictEqual(W.isGoodbye(s), true, s));
  assert.strictEqual(W.isGoodbye("mute"), false);
});
