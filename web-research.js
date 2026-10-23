/* web-research.js — lets the local AI look things up on the web and read the pages (main process, plain Node).
 *
 *   search(query)      -> numbered results {title, url, snippet} from DuckDuckGo (HTML, then Lite), or Wikipedia as a last resort
 *   readPage(url)      -> {title, text, published, siteName, finalUrl, ...} for one public web page
 *   research(query)    -> search + opens the top pages, returns everything the chat needs to answer with citations
 *
 * Safety: only public http(s) pages (no localhost / private network addresses, checked again after every redirect), a size
 * limit and a time limit on every request, and no cookies or sign-ins are sent. Page text is plain text only: no scripts run.
 * The fetch function is passed in (Electron's net.fetch in the app, a stub in tests).
 */
"use strict";
const dns = require("dns");
const net = require("net");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 IcyWhite/2.0";
const MAX_BYTES = 2 * 1024 * 1024;

/* ---------- address safety ---------- */
function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::" || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("fc") || x.startsWith("fd")) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}
async function checkPublicUrl(raw, lookup) {
  let u; try { u = new URL(raw); } catch (e) { return { ok: false, why: "not a valid web address" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, why: "only http and https pages can be opened" };
  if (u.username || u.password) return { ok: false, why: "addresses with a user name or password are not opened" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || /^localhost$/i.test(host) || /\.(local|internal|localdomain|lan|home|corp)$/i.test(host)) return { ok: false, why: "that is not a public website" };
  if (net.isIP(host)) return isPrivateIp(host) ? { ok: false, why: "that address is on a private network" } : { ok: true, url: u };
  try {
    const addrs = await (lookup || ((h) => dns.promises.lookup(h, { all: true })))(host);
    const list = Array.isArray(addrs) ? addrs : [addrs];
    if (!list.length || list.some((a) => isPrivateIp(a.address || a))) return { ok: false, why: "that name points to a private network address" };
  } catch (e) { return { ok: false, why: "the website name could not be found" }; }
  return { ok: true, url: u };
}

/* ---------- HTML helpers ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", deg: "°", times: "×", middot: "·", bull: "•", laquo: "«", raquo: "»" };
const decode = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; } catch (x) { return ""; } }
  const v = ENT[e.toLowerCase()]; return v !== undefined ? v : m;
});
const stripTags = (s) => decode(String(s || "").replace(/<\/?(?:b|i|em|strong|span|a|u|mark|code|small|sup|sub|abbr)\b[^>]*>/gi, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function metaContent(html, names) {
  for (const n of names) {
    const re1 = new RegExp("<meta[^>]+(?:property|name|itemprop)\\s*=\\s*[\"']" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"'][^>]*content\\s*=\\s*[\"']([^\"']*)[\"']", "i");
    const re2 = new RegExp("<meta[^>]+content\\s*=\\s*[\"']([^\"']*)[\"'][^>]*(?:property|name|itemprop)\\s*=\\s*[\"']" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"']", "i");
    const m = re1.exec(html) || re2.exec(html);
    if (m && m[1].trim()) return decode(m[1]).trim();
  }
  return "";
}
function normDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && +m[1] > 1990 && +m[1] < 2100 && +m[2] >= 1 && +m[2] <= 12) return m[1] + "-" + m[2] + "-" + m[3];
  const d = new Date(s); if (!isNaN(d) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d.toISOString().slice(0, 10);
  return "";
}
function findPublished(html) {
  const meta = metaContent(html, ["article:published_time", "og:article:published_time", "datePublished", "pubdate", "publishdate", "date", "DC.date.issued", "parsely-pub-date", "sailthru.date"]);
  if (normDate(meta)) return normDate(meta);
  const ld = /"datePublished"\s*:\s*"([^"]+)"/i.exec(html); if (ld && normDate(ld[1])) return normDate(ld[1]);
  const t = /<time[^>]+datetime\s*=\s*["']([^"']+)["']/i.exec(html); if (t && normDate(t[1])) return normDate(t[1]);
  return "";
}
function findModified(html) {
  const meta = metaContent(html, ["article:modified_time", "og:updated_time", "dateModified", "last-modified"]);
  if (normDate(meta)) return normDate(meta);
  const ld = /"dateModified"\s*:\s*"([^"]+)"/i.exec(html); return ld ? normDate(ld[1]) : "";
}

// Readable text of a page: drops scripts, styles, menus and footers, keeps headings, paragraphs, lists and table rows.
function htmlToText(html, maxChars) {
  let h = String(html || "").replace(/<!--[\s\S]*?-->/g, " ");
  h = h.replace(/<(script|style|noscript|svg|iframe|canvas|form|template|select|button|dialog)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(h);
  if (main && stripTags(main[2]).length > 400) h = main[2];
  else h = h.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, b) => "\n\n" + (t === "h1" ? "# " : "## ") + stripTags(b) + "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ").replace(/<(br|hr)\b[^>]*>/gi, "\n").replace(/<\/(p|div|section|tr|table|ul|ol|blockquote|pre|figure|figcaption|dd|dt|dl)>/gi, "\n").replace(/<\/t[dh]>/gi, " | ");
  let t = decode(h.replace(/<[^>]*>/g, " "));
  t = t.replace(/[ \t\f\v\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // drop very short lines that are usually menu or button labels, but keep headings and list items
  t = t.split("\n").filter((l) => l.length > 24 || /^(#|-)/.test(l) || !l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (maxChars && t.length > maxChars) { const cut = t.slice(0, maxChars), k = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". ")); t = (k > maxChars * 0.6 ? cut.slice(0, k + 1) : cut).trim() + " …"; }
  return t;
}

/* ---------- what kind of site is it? (a rough label, NOT a judgement of accuracy) ---------- */
const NEWS = /(^|\.)(reuters|apnews|bbc|npr|nytimes|washingtonpost|theguardian|bloomberg|wsj|cnn|aljazeera|ft|economist|axios|politico|cbsnews|nbcnews|abcnews|usatoday|latimes|forbes|cnbc)\.(com|org|co\.uk|net)$/i;
const SOCIAL = /(^|\.)(reddit|quora|stackoverflow|stackexchange|news\.ycombinator|x|twitter|facebook|instagram|tiktok|youtube|medium|substack|pinterest|tumblr|blogspot|wordpress|fandom)\.(com|org|net)$/i;
const ACADEMIC = /(^|\.)(arxiv\.org|nature\.com|sciencedirect\.com|springer\.com|ieee\.org|acm\.org|jstor\.org|pubmed\.ncbi\.nlm\.nih\.gov|plos\.org|science\.org|cell\.com|thelancet\.com|nejm\.org|bmj\.com)$/i;
function siteType(host) {
  host = String(host || "").toLowerCase().replace(/^www\./, "");
  if (/(^|\.)(gov|mil)$/.test(host) || /\.gov\.[a-z]{2}$/.test(host) || /(^|\.)(europa\.eu|who\.int|un\.org|nasa\.gov|nih\.gov)$/.test(host)) return { id: "official", label: "Government / official" };
  if (/\.edu$/.test(host) || /\.ac\.[a-z]{2}$/.test(host) || ACADEMIC.test(host)) return { id: "academic", label: "Academic / research" };
  if (/(^|\.)(wikipedia\.org|britannica\.com)$/.test(host)) return { id: "encyclopedia", label: "Encyclopedia" };
  if (NEWS.test(host)) return { id: "news", label: "News outlet" };
  if (SOCIAL.test(host)) return { id: "social", label: "Forum / social (unverified)" };
  return { id: "web", label: "Website" };
}
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };

/* ---------- search engines ---------- */
function unwrapDdg(href) {
  href = decode(href);
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return ""; } }
  if (href.startsWith("//")) return "https:" + href;
  return href;
}
function parseDdgHtml(html) {
  const out = [], re = /<a\b[^>]*class\s*=\s*["'][^"']*\bresult__a\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0], href = /href\s*=\s*["']([^"']+)["']/i.exec(tag); if (!href) continue;
    const url = unwrapDdg(href[1]); if (!/^https?:\/\//i.test(url) || /duckduckgo\.com\/y\.js|[?&]ad_/i.test(url)) continue;
    const rest = html.slice(m.index + tag.length, m.index + tag.length + 2500);
    const sn = /class\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td|div)>/i.exec(rest);
    out.push({ title: stripTags(m[1]), url, snippet: sn ? stripTags(sn[1]) : "" });
  }
  return out;
}
function parseDdgLite(html) {
  const out = [], re = /<a\b[^>]*class\s*=\s*['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0]); if (!href) continue;
    const url = unwrapDdg(href[1]); if (!/^https?:\/\//i.test(url)) continue;
    const rest = html.slice(m.index + m[0].length, m.index + m[0].length + 2500);
    const sn = /class\s*=\s*['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(rest);
    out.push({ title: stripTags(m[1]), url, snippet: sn ? stripTags(sn[1]) : "" });
  }
  return out;
}

function createWebResearch(opts) {
  const o = Object.assign({ fetchFn: null, lookup: null, timeoutMs: 10000, maxBytes: MAX_BYTES, cacheMs: 5 * 60 * 1000, now: () => Date.now() }, opts);
  if (typeof o.fetchFn !== "function") throw new Error("fetchFn is required");
  const cache = new Map();

  async function readBody(res, cur, what, timer) {
    try {
      const type = String(res.headers.get("content-type") || "").toLowerCase();
      if (what === "page" && type && !/(text\/|application\/(xhtml|xml|json))/.test(type)) throw new Error("not a text page (" + (type.split(";")[0] || "unknown type") + ")");
      let buf = Buffer.alloc(0);
      if (res.body && typeof res.body.getReader === "function") {
        const rd = res.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; buf = Buffer.concat([buf, Buffer.from(value)]); if (buf.length > o.maxBytes) { try { await rd.cancel(); } catch (e) {} break; } }
      } else buf = Buffer.from(await res.text());
      const cs = /charset\s*=\s*["']?([\w-]+)/i.exec(type), head = buf.slice(0, 2048).toString("latin1"), cs2 = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
      const enc = (cs && cs[1] || cs2 && cs2[1] || "utf-8").toLowerCase(); let text;
      try { text = new TextDecoder(enc, { fatal: false }).decode(buf); } catch (e) { text = buf.toString("utf8"); }
      return { text, type, finalUrl: cur, truncated: buf.length >= o.maxBytes };
    } finally { clearTimeout(timer); }
  }

  async function get(url, init, what) {
    let cur = url;
    for (let hop = 0; hop < 5; hop++) {
      const chk = await checkPublicUrl(cur, o.lookup);
      if (!chk.ok) throw Object.assign(new Error(chk.why), { blocked: true });
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), o.timeoutMs);
      let res;
      try { res = await o.fetchFn(cur, Object.assign({ redirect: "manual", signal: ctl.signal, headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.9" } }, init || {})); }
      catch (e) { clearTimeout(timer); throw new Error(e && e.name === "AbortError" ? "timed out" : "could not connect (" + ((e && e.message) || e) + ")"); }
      if (res && (res.type === "opaqueredirect" || res.status === 0) && !init) {   // this fetch hides redirects: follow them, then check where we ended up
        clearTimeout(timer);
        const ctl2 = new AbortController(), timer2 = setTimeout(() => ctl2.abort(), o.timeoutMs);
        try { res = await o.fetchFn(cur, { redirect: "follow", signal: ctl2.signal, headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } }); }
        catch (e) { clearTimeout(timer2); throw new Error("could not connect"); }
        const end = await checkPublicUrl(res.url || cur, o.lookup);
        if (!end.ok) { clearTimeout(timer2); throw Object.assign(new Error(end.why), { blocked: true }); }
        cur = res.url || cur; return await readBody(res, cur, what, timer2);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { clearTimeout(timer); try { cur = new URL(res.headers.get("location"), cur).href; } catch (e) { throw new Error("bad redirect"); } continue; }
      if (res.status >= 400) { clearTimeout(timer); throw new Error("the website answered with error " + res.status); }
      return await readBody(res, cur, what, timer);
    }
    throw new Error("too many redirects");
  }

  async function searchEngines(query) {
    const errors = [];
    try {
      const r = await get("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), null, "search");
      const list = parseDdgHtml(r.text); if (list.length) return { engine: "DuckDuckGo", results: list };
      errors.push("DuckDuckGo returned no results");
    } catch (e) { errors.push("DuckDuckGo: " + e.message); }
    try {
      const r = await get("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), null, "search");
      const list = parseDdgLite(r.text); if (list.length) return { engine: "DuckDuckGo Lite", results: list };
    } catch (e) { errors.push("DuckDuckGo Lite: " + e.message); }
    try {
      const r = await get("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8&srsearch=" + encodeURIComponent(query), null, "search");
      const j = JSON.parse(r.text), list = ((j.query && j.query.search) || []).map((x) => ({ title: x.title, url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(x.title).replace(/ /g, "_")), snippet: stripTags(x.snippet) }));
      if (list.length) return { engine: "Wikipedia (the web search engines did not answer)", results: list };
    } catch (e) { errors.push("Wikipedia: " + e.message); }
    return { engine: "", results: [], errors };
  }

  async function search(query, n) {
    query = String(query || "").trim().slice(0, 300); if (!query) return { query, engine: "", results: [], errors: ["empty search"] };
    const key = "s|" + query.toLowerCase(), hit = cache.get(key);
    if (hit && o.now() - hit.t < o.cacheMs) return hit.v;
    const r = await searchEngines(query);
    const seen = new Set(), results = [];
    for (const x of r.results) { const d = x.url.replace(/#.*$/, ""); if (seen.has(d)) continue; seen.add(d); results.push(x); if (results.length >= (n || 8)) break; }
    const v = { query, engine: r.engine, results, errors: r.errors || [] };
    if (results.length) cache.set(key, { t: o.now(), v });
    return v;
  }

  async function readPage(url, maxChars) {
    const key = "p|" + url, hit = cache.get(key);
    if (hit && o.now() - hit.t < o.cacheMs) return hit.v;
    const r = await get(url, null, "page");
    const html = r.text, isHtml = /<html|<body|<head|<p[ >]/i.test(html.slice(0, 5000));
    const title = metaContent(html, ["og:title", "twitter:title"]) || stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);
    const v = {
      url, finalUrl: r.finalUrl, domain: domainOf(r.finalUrl), type: siteType(domainOf(r.finalUrl)), title: title.slice(0, 200),
      siteName: metaContent(html, ["og:site_name", "application-name"]), published: isHtml ? findPublished(html) : "", modified: isHtml ? findModified(html) : "",
      text: isHtml ? htmlToText(html, maxChars || 6000) : String(html).replace(/\s+\n/g, "\n").trim().slice(0, maxChars || 6000), truncated: r.truncated
    };
    cache.set(key, { t: o.now(), v });
    return v;
  }

  /* search + open the top pages. Pages that cannot be opened keep their search snippet and say why. */
  async function research(query, opt) {
    opt = Object.assign({ results: 6, open: 3, chars: 3500 }, opt);
    const s = await search(query, opt.results), retrievedAt = new Date(o.now()).toISOString();
    const sources = s.results.map((x) => ({ title: x.title, url: x.url, domain: domainOf(x.url), type: siteType(domainOf(x.url)), snippet: x.snippet, opened: false, text: "", published: "", error: "" }));
    const todo = sources.slice(0, opt.open);
    await Promise.all(todo.map(async (src) => {
      try {
        const p = await readPage(src.url, opt.chars);
        src.opened = p.text.length > 120; src.text = p.text; src.published = p.published; src.modified = p.modified; src.finalUrl = p.finalUrl; src.domain = p.domain || src.domain; src.type = p.type;
        if (p.title) src.pageTitle = p.title; if (!src.opened) src.error = "the page had almost no readable text";
      } catch (e) { src.error = e.message; }
    }));
    return { query: s.query, engine: s.engine, retrievedAt, sources, errors: s.errors };
  }

  return { search, readPage, research, _cache: cache };
}

module.exports = { createWebResearch, checkPublicUrl, isPrivateIp, htmlToText, siteType, parseDdgHtml, parseDdgLite, findPublished, decode, stripTags, domainOf };
