const test = require("node:test"), assert = require("node:assert");
const R = require("../js/rag.js");
test("chunkText splits long text with overlap and keeps short text whole", () => {
  assert.deepStrictEqual(R.chunkText("Hello there.\n\nSecond paragraph."), ["Hello there.\n\nSecond paragraph."]);
  const long = Array.from({ length: 60 }, (_, i) => "Sentence number " + i + " is here.").join(" ");
  const c = R.chunkText(long, 300, 60); assert(c.length >= 5); c.forEach((x) => assert(x.length <= 420, "len " + x.length));
  assert(c.join(" ").includes("Sentence number 59"));
  assert.deepStrictEqual(R.chunkText("   "), []);
  const huge = R.chunkText("x".repeat(5000), 1000, 100); assert(huge.length >= 5);
});
test("bm25 ranks the passage with the rare matching words first", () => {
  const ch = [{ text: "The cat sat on the mat." }, { text: "Quarterly revenue grew twelve percent in Germany." }, { text: "Dogs and cats are pets." }];
  const r = R.bm25(ch, "revenue in Germany", 3); assert.strictEqual(r[0].i, 1); assert.strictEqual(R.bm25(ch, "zzzz", 3).length, 0);
  assert.strictEqual(R.bm25(ch, "cats", 3).length, 2);   // "cat" and "cats" share a stem
});
test("vectors and fusion", () => {
  assert(Math.abs(R.cosine([1, 0], [1, 0]) - 1) < 1e-9); assert.strictEqual(R.cosine([1, 0], [0, 1]), 0);
  const ch = [{ vec: [1, 0] }, { vec: [0, 1] }, { vec: [0.9, 0.1] }]; assert.deepStrictEqual(R.byVector(ch, [1, 0], 3).map((x) => x.i), [0, 2, 1]);
  const f = R.fuse([[{ i: 1 }, { i: 2 }], [{ i: 2 }, { i: 3 }]], 3); assert.strictEqual(f[0].i, 2);
});
