/* node --test tests/web-sources.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const W = require("../js/web-sources.js");

const sources = [{ n: 1 }, { n: 2 }, { n: 3 }];
const texts = {
  1: "The rover collected a sample from Jezero crater on 4 March 2026. The sample weighs 12 grams and scientists expect results next year.",
  2: "A forum thread about gardening tomatoes in raised beds during the summer season.",
  3: "Population of the city was 1,250,000 in the last census according to the statistics office."
};

test("a sentence that matches its source passes; numbers must appear in the page", () => {
  const r = W.verify("**From the web:** The rover collected a sample from Jezero crater [1]. The sample weighs 12 grams [1]. The city has 1,250,000 people [3].", sources, texts);
  assert.equal(r.per[1].cited, 2); assert.equal(r.per[1].ok, 2); assert.equal(r.per[3].ok, 1); assert.equal(r.warnings.length, 0);
  assert.deepEqual(r.uncited, [2]);
});

test("flags claims the cited page does not support, wrong numbers and made-up source numbers", () => {
  const r = W.verify("The rover discovered ancient microbial fossils beneath volcanic glass formations [2]. The sample weighs 40 grams [1]. The mission cost billions [7].", sources, texts);
  const kinds = r.warnings.map((w) => w.kind).sort();
  assert.deepEqual(kinds, ["invalid", "number", "unsupported"]);
  assert.equal(r.per[2].bad, 1); assert.equal(r.per[1].bad, 1);
});

test("understands [1][2], [1, 2], ignores code and thinking, and notices an answer with no citations", () => {
  const ok = W.verify("<think>[9] nonsense</think>The sample weighs 12 grams and scientists expect results next year [1, 2].\n```\n[5]\n```", sources, texts);
  assert.equal(ok.per[1].cited, 1); assert.equal(ok.per[2].cited, 1); assert.equal(ok.warnings.filter((w) => w.kind === "invalid").length, 0);
  const none = W.verify("The rover collected a sample from the crater and scientists expect to publish detailed results during the next year or so.", sources, texts);
  assert.equal(none.none, true);
});

test("research numbers sources across searches, reuses repeated pages and reports a failed search", async () => {
  W.resetTurn("c1");
  const api = { webResearch: async (q) => (q === "bad" ? { error: "offline" } : { engine: "DuckDuckGo", retrievedAt: new Date().toISOString(), sources: [
    { title: "A", url: "https://a.com/x", domain: "a.com", type: { label: "Website" }, opened: true, text: "alpha text here", published: "2026-01-02", snippet: "s" },
    { title: q === "second" ? "B" : "C", url: q === "second" ? "https://b.com/y" : "https://c.com/z", domain: "b.com", type: { label: "Website" }, opened: false, error: "timed out", snippet: "snip" } ] }) };
  const r1 = await W.research(["first"], { id: "c1" }, api);
  assert.equal(r1.count, 2); assert.match(r1.text, /\[1\] A[\s\S]*\[2\] C/); assert.match(r1.text, /Today on the user's computer/);
  const r2 = await W.research(["second", "bad"], { id: "c1" }, api);
  assert.equal(r2.count, 3, "A is reused (same address), B is new");
  assert.match(r2.text, /FAILED: offline/); assert.match(r2.text, /Only the search snippet is available \(timed out\)/);
  const reply = { content: "x" }; W.attach(reply); assert.equal(reply.webSources.length, 3); assert.equal(reply.webSources[0].published, "2026-01-02");
});
