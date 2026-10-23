/* Finds and clicks a link / button on the page. Runs INSIDE a web page (it is sent as text with executeJavaScript),
 * so it must not use anything outside itself.  Used by main.js (the shared tab) and browser.html (hands-free control).
 *   mode "list"  -> the links visible on screen: [{ text, href }]
 *   mode "click" -> clicks the best match for `query` (or the `nth` visible link when nth > 0)
 *                   -> { ok: true, text, href } or { ok: false, error, candidates: [...] }
 * Matching is by whole words, so "news" never matches "newsletter". */
function tabLinkScript(mode, query, nth) {
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const flat = (t) => norm(t).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const labelOf = (el) => norm(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || (el.querySelector && el.querySelector("img") && el.querySelector("img").alt) || "").slice(0, 100);
  const vh = window.innerHeight || 800, vw = window.innerWidth || 1200;
  const items = [], seen = new Set();
  document.querySelectorAll('a[href], [role="link"], button, [role="button"], input[type="button"], input[type="submit"]').forEach((el) => {
    let r; try { r = el.getBoundingClientRect(); } catch (e) { return; }
    if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return;
    const text = labelOf(el); if (!text) return;
    const href = el.href || "";
    if (/^javascript:/i.test(href)) return;
    const isLink = el.matches('a[href], [role="link"]');
    const key = text + "|" + href + "|" + (isLink ? "l" : "b"); if (seen.has(key)) return; seen.add(key);
    const names = [text, el.getAttribute("aria-label") || "", el.getAttribute("title") || ""].map(flat).filter(Boolean);
    const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    items.push({ el, text, href, names, isLink, inView });
  });
  if (mode === "list") return items.filter((x) => x.inView && x.isLink).slice(0, 40).map((x) => ({ text: x.text, href: x.href }));

  const visibleLinks = items.filter((x) => x.inView && x.isLink);
  const candidates = (items.filter((x) => x.inView).slice(0, 8)).map((x) => x.text.slice(0, 40));
  let best = null;
  if (Number(nth) > 0) {
    best = visibleLinks[Number(nth) - 1] || null;
    if (!best) return { ok: false, error: "there are only " + visibleLinks.length + " links on screen", candidates };
  } else {
    const STOP = new Set(["the", "a", "an", "on", "link", "links", "button", "tab", "page", "option", "menu", "item", "please", "to"]);
    const q = flat(query);
    let words = q.split(" ").filter((w) => w && !STOP.has(w));
    if (!words.length) words = q.split(" ").filter(Boolean);
    const qs = words.join(" ");
    if (!qs) return { ok: false, error: "no link name given", candidates };
    let bestScore = 0;
    for (const x of items) {
      let sc = 0;
      for (const t of x.names) {
        const padded = " " + t + " ";
        let s = 0;
        if (t === qs) s = 100;
        else if (t.startsWith(qs + " ")) s = 85;
        else if (padded.includes(" " + qs + " ")) s = 70;
        else if (words.every((w) => padded.includes(" " + w + " "))) s = 50;
        sc = Math.max(sc, s);
      }
      if (!sc) continue;
      sc += (x.inView ? 5 : 0) + (x.isLink ? 0 : -3) - Math.min(10, x.names[0].length / 20);
      if (sc > bestScore) { bestScore = sc; best = x; }
    }
    if (!best) return { ok: false, error: "no link called \"" + norm(query) + "\"", candidates };
  }
  try { best.el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
  best.el.click();
  return { ok: true, text: best.text, href: best.href };
}
if (typeof module !== "undefined" && module.exports) module.exports = tabLinkScript;
if (typeof window !== "undefined") window.OasisTabClick = tabLinkScript;
