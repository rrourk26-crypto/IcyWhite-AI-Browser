const test = require("node:test"), assert = require("node:assert");
const C = require("../js/voice-commands.js");
test("volume, mute and speed", () => {
  assert.deepStrictEqual(C.parse("volume up"), { c: "vol", d: 1 });
  assert.deepStrictEqual(C.parse("Turn it up."), { c: "vol", d: 1 });
  assert.deepStrictEqual(C.parse("speak louder please"), { c: "vol", d: 1 });
  assert.deepStrictEqual(C.parse("turn the volume down"), { c: "vol", d: -1 });
  assert.deepStrictEqual(C.parse("quieter"), { c: "vol", d: -1 });
  assert.deepStrictEqual(C.parse("set volume to 40 percent"), { c: "vol", set: 40 });
  assert.deepStrictEqual(C.parse("volume 80"), { c: "vol", set: 80 });
  assert.deepStrictEqual(C.parse("half volume"), { c: "vol", set: 50 });
  assert.deepStrictEqual(C.parse("mute"), { c: "mute" });
  assert.deepStrictEqual(C.parse("unmute"), { c: "unmute" });
  assert.deepStrictEqual(C.parse("speak faster"), { c: "rate", d: 1 });
  assert.deepStrictEqual(C.parse("slow down"), { c: "rate", d: -1 });
  assert.deepStrictEqual(C.parse("normal speed"), { c: "rate", set: 1 });
});
test("replies and chats", () => {
  assert.deepStrictEqual(C.parse("say that again"), { c: "repeat" });
  assert.deepStrictEqual(C.parse("repeat that"), { c: "repeat" });
  assert.deepStrictEqual(C.parse("try again"), { c: "redo" });
  assert.deepStrictEqual(C.parse("regenerate"), { c: "redo" });
  assert.deepStrictEqual(C.parse("new chat"), { c: "newchat" });
  assert.deepStrictEqual(C.parse("start over"), { c: "newchat" });
});
test("tabs, scrolling, reading, windows", () => {
  assert.deepStrictEqual(C.parse("new tab"), { c: "tab", op: "new" });
  assert.deepStrictEqual(C.parse("open a new tab"), { c: "tab", op: "new" });
  assert.deepStrictEqual(C.parse("reload this page"), { c: "tab", op: "reload" });
  assert.deepStrictEqual(C.parse("refresh"), { c: "tab", op: "reload" });
  assert.deepStrictEqual(C.parse("go back"), { c: "tab", op: "back" });
  assert.deepStrictEqual(C.parse("go forward"), { c: "tab", op: "forward" });
  assert.deepStrictEqual(C.parse("close all other tabs"), { c: "tab", op: "closeothers" });
  assert.deepStrictEqual(C.parse("scroll down"), { c: "scroll", dir: "down" });
  assert.deepStrictEqual(C.parse("page up"), { c: "scroll", dir: "up" });
  assert.deepStrictEqual(C.parse("top of the page"), { c: "scroll", dir: "top" });
  assert.deepStrictEqual(C.parse("scroll to the bottom"), { c: "scroll", dir: "bottom" });
  assert.deepStrictEqual(C.parse("read this page"), { c: "readpage" });
  assert.deepStrictEqual(C.parse("summarize this tab"), { c: "readpage" });
  assert.deepStrictEqual(C.parse("open settings"), { c: "settings" });
  assert.deepStrictEqual(C.parse("show chat history"), { c: "history" });
  assert.deepStrictEqual(C.parse("keep listening"), { c: "awake" });
});
test("ordinary sentences are not commands", () => {
  ["open a new tab about cats and dogs", "what is the volume of a sphere", "turn the oven up to 400", "can you say that again in French",
   "go back to the store", "tell me about this page layout idea", "I need a new chat bot for my website", "make the text louder in my css",
   "scroll down the list and find the bug in my code", "close the door", "mute the mic on my zoom call tomorrow"].forEach((s) => assert.strictEqual(C.parse(s), null, s));
});
test("yes and no", () => {
  ["yes", "Yeah.", "do it", "go ahead"].forEach((s) => assert.strictEqual(C.isYes(s), true, s));
  ["no", "cancel", "never mind", "stop"].forEach((s) => assert.strictEqual(C.isNo(s), true, s));
  assert.strictEqual(C.isYes("yes I think so but let me check"), false);
});
test("hands-free browsing: address word, click, search, open a site, close tab", () => {
  assert.deepStrictEqual(C.parse("computer, go back."), { c: "tab", op: "back" });
  assert.deepStrictEqual(C.parse("Computer, refresh the page"), { c: "tab", op: "reload" });
  assert.deepStrictEqual(C.parse("close this tab"), { c: "tab", op: "closecur" });
  assert.deepStrictEqual(C.parse("Click the New\u2019s link."), { c: "click", target: "news" });
  assert.deepStrictEqual(C.parse("click on sign in"), { c: "click", target: "sign in" });
  assert.deepStrictEqual(C.parse("click the third link"), { c: "click", n: 3 });
  assert.deepStrictEqual(C.parse("click link number 2"), { c: "click", n: 2 });
  assert.deepStrictEqual(C.parse("open the news link"), { c: "click", target: "news", soft: true });
  assert.deepStrictEqual(C.parse("search the internet for coast to coast AM"), { c: "search", q: "coast to coast am" });
  assert.deepStrictEqual(C.parse("Search the internet and open coast to coast AM."), { c: "search", q: "coast to coast am" });
  assert.deepStrictEqual(C.parse("do an internet search for LLMs"), { c: "search", q: "llms" });
  assert.deepStrictEqual(C.parse("go to youtube.com"), { c: "openurl", url: "https://youtube.com" });
  assert.deepStrictEqual(C.parse("open youtube dot com"), { c: "openurl", url: "https://youtube.com" });
});
test("ordinary sentences are not taken as browser commands", () => {
  assert.strictEqual(C.parse("click it"), null);
  assert.strictEqual(C.parse("search for a pasta recipe and tell me how to cook it"), null);
  assert.strictEqual(C.parse("open settings.json"), null);
  assert.strictEqual(C.parse("hello how are you"), null);
});
