/* node --test tests/web-research.test.js   (no network: a stub fetch serves small fixture pages) */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createWebResearch, checkPublicUrl, isPrivateIp, htmlToText, siteType, parseDdgHtml, parseDdgLite, findPublished } = require("../web-research.js");

const PAGE = `<html><head><title>Fallback title</title><meta property="og:title" content="Mars rover finds &amp; names rock"><meta property="article:published_time" content="2026-03-04T10:00:00Z">
<meta property="og:site_name" content="Space Daily"><script>var x = "SECRET_SCRIPT";</script><style>.a{}</style></head>
<body><nav>Home About Contact Login Menu Item Another</nav><article><h1>Rover finds rock</h1><p>The rover collected a sample from Jezero crater on 4 March 2026, the agency said.</p>
<ul><li>Sample weighs 12 grams</li></ul><p>Scientists expect results next year according to the mission team statement.</p><p>${"More detail about the mission. ".repeat(30)}</p></article><footer>Copyright footer links</footer></body></html>`;
const DDG = `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frover&amp;rut=abc">Rover finds <b>rock</b></a>
<a class="result__snippet" href="x">The rover collected a <b>sample</b>.</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.nasa.gov%2Fnews&amp;rut=1">NASA news</a><a class="result__snippet">Official update.</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/y.js?ad_provider=x&u3=https%3A%2F%2Fads.example">Ad</a></div>`;
const res = (body, status = 200, type = "text/html; charset=utf-8", headers = {}) => ({ status, headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : headers[k.toLowerCase()] || null) }, text: async () => body, body: null });
const pub = async () => [{ address: "93.184.216.34" }];

test("blocks private and non-web addresses", async () => {
  assert.ok(isPrivateIp("127.0.0.1") && isPrivateIp("10.1.2.3") && isPrivateIp("192.168.0.9") && isPrivateIp("169.254.1.1") && isPrivateIp("::1") && isPrivateIp("fd00::1"));
  assert.ok(!isPrivateIp("93.184.216.34"));
  for (const u of ["file:///etc/passwd", "ftp://x.com/a", "http://localhost:8080/v1", "http://127.0.0.1:1234", "http://192.168.1.5/admin", "http://user:pw@example.com/", "http://printer.local/", "not a url"]) assert.equal((await checkPublicUrl(u, pub)).ok, false, u);
  assert.equal((await checkPublicUrl("https://example.com/a", pub)).ok, true);
  assert.equal((await checkPublicUrl("https://sneaky.example/", async () => [{ address: "10.0.0.5" }])).ok, false, "a name that points to a private address");
});

test("turns a page into readable text and finds title, date and site", async () => {
  const t = htmlToText(PAGE, 6000);
  assert.match(t, /Jezero crater/); assert.match(t, /- Sample weighs 12 grams/);
  assert.doesNotMatch(t, /SECRET_SCRIPT|Copyright footer|Menu Item/);
  assert.equal(findPublished(PAGE), "2026-03-04");
  const w = createWebResearch({ fetchFn: async () => res(PAGE), lookup: pub });
  const p = await w.readPage("https://news.example.com/mars");
  assert.equal(p.title, "Mars rover finds & names rock"); assert.equal(p.published, "2026-03-04"); assert.equal(p.siteName, "Space Daily");
});

test("parses DuckDuckGo results, skips ads, unwraps links", () => {
  const r = parseDdgHtml(DDG);
  assert.deepEqual(r.map((x) => x.url), ["https://example.com/rover", "https://www.nasa.gov/news"]);
  assert.equal(r[0].title, "Rover finds rock"); assert.equal(r[0].snippet, "The rover collected a sample.");
  const lite = parseDdgLite(`<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.org%2Fx" class='result-link'>A page</a></td></tr><tr><td class='result-snippet'>About <b>A</b></td>`);
  assert.deepEqual(lite, [{ title: "A page", url: "https://a.org/x", snippet: "About A" }]);
});

test("labels the kind of site without judging accuracy", () => {
  assert.equal(siteType("www.nasa.gov").id, "official"); assert.equal(siteType("cs.mit.edu").id, "academic"); assert.equal(siteType("en.wikipedia.org").id, "encyclopedia");
  assert.equal(siteType("www.reuters.com").id, "news"); assert.equal(siteType("old.reddit.com").id, "social"); assert.equal(siteType("random-blog.net").id, "web");
});

test("research: searches, opens the top pages, keeps snippets for the rest, reports failures", async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    if (url.startsWith("https://html.duckduckgo.com/")) return res(DDG);
    if (url === "https://example.com/rover") return res(PAGE);
    if (url === "https://www.nasa.gov/news") return res("nope", 503);
    throw new Error("unexpected " + url);
  };
  const w = createWebResearch({ fetchFn, lookup: pub });
  const r = await w.research("mars rover rock");
  assert.equal(r.engine, "DuckDuckGo"); assert.equal(r.sources.length, 2);
  assert.equal(r.sources[0].opened, true); assert.match(r.sources[0].text, /Jezero/); assert.equal(r.sources[0].published, "2026-03-04");
  assert.equal(r.sources[1].opened, false); assert.match(r.sources[1].error, /503/); assert.equal(r.sources[1].snippet, "Official update.");
  assert.ok(r.retrievedAt);
  await w.research("mars rover rock");   // cached
  assert.equal(seen.filter((u) => u.includes("duckduckgo")).length, 1);
});

test("a redirect to a private address is refused, and Wikipedia is the last resort", async () => {
  const w = createWebResearch({ lookup: pub, fetchFn: async (url) => { if (url === "https://example.com/go") return res("", 302, "text/html", { location: "http://192.168.1.1/admin" }); throw new Error("no network"); } });
  await assert.rejects(() => w.readPage("https://example.com/go"), /private network/);
  const w2 = createWebResearch({ lookup: pub, fetchFn: async (url) => {
    if (url.includes("wikipedia.org/w/api.php")) return res(JSON.stringify({ query: { search: [{ title: "Mars rover", snippet: "A <span>rover</span> on Mars" }] } }), 200, "application/json");
    throw new Error("offline");
  } });
  const s = await w2.search("mars rover");
  assert.match(s.engine, /Wikipedia/); assert.equal(s.results[0].url, "https://en.wikipedia.org/wiki/Mars_rover");
});
