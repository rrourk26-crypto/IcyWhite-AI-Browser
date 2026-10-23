const test = require("node:test"), assert = require("node:assert");
const C = require("../js/voice-commands.js"), A = require("../js/voice-app-commands.js"), T = require("../js/tab-voice.js"), W = require("../js/wake-word.js");

A.setLinks(() => ["Wikipedia", "YouTube"]);
test("every phrase in the voice command list is understood", () => {
  const bad = [];
  A.CATALOG.forEach((g) => g.items.forEach((it) => it.say.forEach((s) => {
    let ok;
    if (it.via === "tabs") ok = !!T.parse(s);
    else if (it.via === "goodbye") ok = W.isGoodbye(s);
    else if (it.via === "endlive") ok = W.isEndLive(s);
    else if (it.via === "stop") ok = W.isStopCommand(s, "computer", "");
    else if (s === "computer") ok = true;               // the wake word itself
    else ok = !!C.parse(s) || !!T.parse(s) || ["yes", "no"].includes(s) && (C.isYes(s) || C.isNo(s));
    if (!ok) bad.push(g.group + ": " + s);
  })));
  assert.deepStrictEqual(bad, []);
});

test("natural alternatives map to the same command", () => {
  const same = (list, expect) => list.forEach((s) => assert.deepStrictEqual(C.parse(s), expect, s));
  same(["dark mode", "turn on dark mode", "switch to dark mode", "Computer, go dark mode please", "turn off light mode", "night mode"], { c: "app", id: "theme", mode: "dark" });
  same(["light mode", "turn off dark mode", "day mode", "switch to the light theme"], { c: "app", id: "theme", mode: "light" });
  same(["turn on web search", "enable web search", "switch on web search", "web search on", "turn web search on", "please turn on the web search"], { c: "app", id: "toggle", key: "webSearch", on: true });
  same(["turn off web search", "disable web search", "stop searching the web", "web search off", "turn web search off"], { c: "app", id: "toggle", key: "webSearch", on: false });
  same(["autopilot on", "start autopilot", "turn on autopilot", "enable autopilot"], { c: "app", id: "toggle", key: "autopilot", on: true });
  same(["allow", "approve", "approve it", "allow that"], { c: "app", id: "approve", scope: "any" });
  same(["apply the changes", "apply all", "apply it", "accept the changes", "apply the files"], { c: "app", id: "approve", scope: "apply" });
  same(["run the command", "run it", "run that command"], { c: "app", id: "approve", scope: "run" });
  same(["deny", "reject it", "skip it", "dont apply the changes", "decline"], { c: "app", id: "decline" });
  same(["keep going", "continue", "keep writing", "go on"], { c: "app", id: "continue" });
  same(["voice settings", "open voice settings", "settings voice", "go to the voice tab"], { c: "app", id: "settingstab", tab: "voice" });
  same(["show the camera", "turn on the webcam", "open camera", "start the camera"], { c: "app", id: "cam", op: "open" });
  same(["share my screen", "share the screen", "start screen sharing"], { c: "app", id: "screen", op: "open" });
  same(["open my last chat", "open the previous chat"], { c: "app", id: "openchat", which: "prev" });
});

test("details are captured", () => {
  assert.deepStrictEqual(C.parse("Rename this chat to Trip Plans"), { c: "app", id: "renamechat", title: "Trip Plans" });
  assert.deepStrictEqual(C.parse("open the chat about pasta"), { c: "app", id: "openchat", name: "pasta" });
  assert.deepStrictEqual(C.parse("open the third chat"), { c: "app", id: "openchat", n: 3 });
  assert.deepStrictEqual(C.parse("open chat number 2"), { c: "app", id: "openchat", n: 2 });
  assert.deepStrictEqual(C.parse("set temperature to 0.7"), { c: "app", id: "temperature", v: 0.7 });
  assert.deepStrictEqual(C.parse("change the wake word to jarvis"), { c: "app", id: "wakeword", word: "jarvis" });
  assert.deepStrictEqual(C.parse("switch to model llama 3"), { c: "app", id: "model", name: "llama 3" });
  assert.deepStrictEqual(C.parse("search hugging face for qwen coder"), { c: "app", id: "hf", op: "search", q: "qwen coder" });
  assert.deepStrictEqual(C.parse("export this chat as json"), { c: "app", id: "exportchat", fmt: "json" });
  assert.deepStrictEqual(C.parse("collapse the sidebar"), { c: "app", id: "rail", want: "close" });
  assert.deepStrictEqual(C.parse("turn off the wake word"), { c: "app", id: "toggle", key: "wake", on: false });
  assert.deepStrictEqual(C.parse("open Wikipedia"), { c: "app", id: "openlink", name: "Wikipedia" });
  assert.deepStrictEqual(C.parse("help with settings"), { c: "app", id: "help", group: "settings" });
});

test("older commands still win over the new ones", () => {
  assert.deepStrictEqual(C.parse("open settings"), { c: "settings" });
  assert.deepStrictEqual(C.parse("new chat"), { c: "newchat" });
  assert.deepStrictEqual(C.parse("click the news link"), { c: "click", target: "news" });
  assert.deepStrictEqual(C.parse("go to youtube.com"), { c: "openurl", url: "https://youtube.com" });
});

test("ordinary sentences are never taken as app commands", () => {
  ["I want to turn on the light in the kitchen", "can you explain how dark mode works in CSS", "tell me about the web search algorithm",
   "continue the story about the dragon where he finds the cave", "allow me to introduce myself", "run the numbers for me on this budget spreadsheet please",
   "what is the best way to rename this chat app", "explain how to apply the changes to my git repo", "open the door", "the weather is nice today",
   "switch to a different topic", "use the second approach you suggested earlier in the conversation", "delete the old files from my project folder",
   "write a poem about the camera", "why does my screen share keep dropping in Zoom", "turn on the memory management section in my essay"].forEach((s) => assert.strictEqual(C.parse(s), null, s));
});
