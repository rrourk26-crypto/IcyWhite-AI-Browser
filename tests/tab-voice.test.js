const test = require("node:test"), assert = require("node:assert");
const T = require("../js/tab-voice.js");
const tabs = [
  { id: 1, index: 1, title: "Home", url: "file:///x/index.html", active: false, chat: true },
  { id: 2, index: 2, title: "YouTube", url: "https://www.youtube.com/watch?v=1", active: true, chat: false },
  { id: 3, index: 3, title: "Wikipedia - Cats", url: "https://en.wikipedia.org/wiki/Cat", active: false, chat: false },
  { id: 4, index: 4, title: "news.google.com", url: "https://news.google.com/", active: false, chat: false }
];
test("parses switching", () => {
  assert.deepStrictEqual(T.parse("Switch to the YouTube tab."), { op: "goto", name: "youtube" });
  assert.deepStrictEqual(T.parse("next tab"), { op: "goto", rel: 1 });
  assert.deepStrictEqual(T.parse("go to the previous tab please"), { op: "goto", rel: -1 });
  assert.deepStrictEqual(T.parse("go to tab 3"), { op: "goto", n: 3 });
  assert.deepStrictEqual(T.parse("open the second tab"), { op: "goto", n: 2 });
  assert.deepStrictEqual(T.parse("go to the last tab"), { op: "goto", last: true });
  assert.deepStrictEqual(T.parse("switch tabs"), { op: "goto", rel: 1 });
});
test("parses closing", () => {
  assert.deepStrictEqual(T.parse("close this tab"), { op: "close", cur: true });
  assert.deepStrictEqual(T.parse("Close the tab."), { op: "close", cur: true });
  assert.deepStrictEqual(T.parse("close the Wikipedia tab"), { op: "close", name: "wikipedia" });
  assert.deepStrictEqual(T.parse("close tab two"), { op: "close", n: 2 });
  assert.deepStrictEqual(T.parse("close the last tab"), { op: "close", last: true });
});
test("ordinary sentences are not commands", () => {
  ["what is a browser tab", "tell me about the tab key on a keyboard", "go to the store", "close the door", "open a new tab about cats and dogs please", "how do I close a tab"].forEach((s) => assert.strictEqual(T.parse(s), null, s));
});
test("picks the right tab", () => {
  assert.strictEqual(T.pick(tabs, T.parse("switch to the youtube tab")).id, 2);
  assert.strictEqual(T.pick(tabs, T.parse("go to the wikipedia tab")).id, 3);
  assert.strictEqual(T.pick(tabs, T.parse("go to the news tab")).id, 4);
  assert.strictEqual(T.pick(tabs, T.parse("go to the chat tab")).id, 1);
  assert.strictEqual(T.pick(tabs, T.parse("next tab")).id, 3);
  assert.strictEqual(T.pick(tabs, T.parse("previous tab")).id, 1);
  assert.strictEqual(T.pick(tabs, T.parse("last tab")).id, 4);
  assert.strictEqual(T.pick(tabs, T.parse("go to tab 3")).id, 3);
  assert.strictEqual(T.pick(tabs, T.parse("close this tab")).id, 2);
  assert.strictEqual(T.pick(tabs, T.parse("go to the reddit tab")), null);
  const onChat = tabs.map((t) => ({ ...t, active: t.chat }));
  assert.strictEqual(T.pick(onChat, T.parse("close this tab"), 3).id, 3);   // chat tab is up: "this tab" is the one you were just on
});

test("numbers like 3rd and 'tab number 3'", () => {
  assert.deepStrictEqual(T.parse("close the 3rd tab"), { op: "close", n: 3 });
  assert.deepStrictEqual(T.parse("close tab number 3"), { op: "close", n: 3 });
  assert.deepStrictEqual(T.parse("close tab three"), { op: "close", n: 3 });
  assert.deepStrictEqual(T.parse("go to the 2nd tab"), { op: "goto", n: 2 });
  assert.deepStrictEqual(T.parse("switch to tab 4"), { op: "goto", n: 4 });
});
