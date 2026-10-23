/* Voice commands for browser tabs ("switch to the YouTube tab", "next tab", "close this tab", "close tab 3").
 * Pure logic (parse what was said, pick which tab) so it can be tested on its own; js/voice.js runs the result through the browser shell. */
(function (root) {
  "use strict";
  const NUM = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const clean = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1").replace(/\btab (?:number|no|num) /g, "tab ").replace(/\b(?:number|no) (\d+) tab\b/g, "$1 tab")
    .replace(/^(?:(?:hey|ok|okay|please|can you|could you|would you|will you|go ahead and|just)\s+)+/, "").replace(/(?:\s+(?:please|for me|now|thanks|thank you))+$/, "").trim();
  const GO = "(?:go to|go back to|switch to|swap to|change to|jump to|move to|open|show me|show|bring up|take me to|back to|look at)";
  function which(w) { // "second" / "3" / "last" / "next" / "previous" -> command pieces
    if (/^\d+$/.test(w)) return { n: parseInt(w, 10) };
    if (NUM[w]) return { n: NUM[w] };
    if (w === "last" || w === "final") return { last: true };
    if (w === "next") return { rel: 1 };
    if (/^(?:previous|prior)$/.test(w)) return { rel: -1 };
    return null;
  }
  // -> null (not a tab command) or { op: "goto" | "close", n?, last?, rel?, name?, cur? }
  function parse(text) {
    const t = clean(text); if (!t) return null; let m;
    if ((m = t.match(/^(?:switch|swap|change|cycle)(?: to the)? tabs?$/))) return { op: "goto", rel: 1 };
    if ((m = t.match(new RegExp("^(?:" + GO + " )?(?:the )?(next|previous|prior|last|final) tab$")))) return Object.assign({ op: "goto" }, which(m[1]));
    if ((m = t.match(new RegExp("^(?:" + GO + " )?(?:the )?tab (\\d+|one|two|three|four|five|six|seven|eight|nine|ten)$")))) return Object.assign({ op: "goto" }, which(m[1]));
    if ((m = t.match(new RegExp("^(?:" + GO + " )?(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) tab$")))) return Object.assign({ op: "goto" }, which(m[1]));
    if ((m = t.match(new RegExp("^(?:" + GO + " )?(?:the )?(\\d+) tab$")))) return Object.assign({ op: "goto" }, which(m[1]));
    if ((m = t.match(/^(?:close|shut|kill|exit|get rid of) (?:the )?(\d+) tab$/))) return Object.assign({ op: "close" }, which(m[1]));
    if ((m = t.match(new RegExp("^" + GO + " (?:the |my )?(.{2,40}?) tab$")))) return { op: "goto", name: m[1] };
    if ((m = t.match(/^(?:close|shut|kill|exit|get rid of) (?:this|that|the current|the active|the open|the shared|my current) tab$/)) || (m = t.match(/^(?:close|shut) (?:the )?tab$/))) return { op: "close", cur: true };
    if ((m = t.match(/^(?:close|shut|kill|exit|get rid of) (?:the )?tab (\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/))) return Object.assign({ op: "close" }, which(m[1]));
    if ((m = t.match(/^(?:close|shut|kill|exit|get rid of) (?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|next|previous|prior) tab$/))) return Object.assign({ op: "close" }, which(m[1]));
    if ((m = t.match(/^(?:close|shut|kill|exit|get rid of) (?:the |my )?(.{2,40}?) tab$/))) return { op: "close", name: m[1] };
    return null;
  }
  const CHAT_NAMES = /^(?:chat|home|ai|assistant|this|voice chat|live chat|main)$/;
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
  // Which tab does `name` mean? tabs: [{id, index (1-based), title, url, active, chat}]. Returns a tab or null.
  function findByName(tabs, name) {
    const n = clean(name); if (!n) return null;
    if (CHAT_NAMES.test(n)) return tabs.find((t) => t.chat) || null;
    const q = words(n).filter((w) => !["the", "a", "my", "page", "site", "website"].includes(w)); if (!q.length) return null;
    let best = null, bestScore = 0;
    tabs.forEach((t) => {
      let host = ""; try { host = new URL(t.url).hostname.replace(/^www\./, ""); } catch (e) {}
      const hay = words(t.title + " " + host + " " + host.replace(/\.[a-z]+$/, "")), hayStr = hay.join(" ");
      let score = 0;
      q.forEach((w) => { if (hay.includes(w)) score += 3; else if (w.length >= 3 && hayStr.includes(w)) score += 2; });
      if (q.join("") && hayStr.replace(/ /g, "").includes(q.join(""))) score += 2;   // "you tube" ~ "youtube"
      if (t.chat) score -= 0.5;
      if (score > bestScore) { best = t; bestScore = score; }
    });
    return best;
  }
  // Decide the tab for a parsed command. `cur` = what "this tab" means: the active tab, or the last tab you were on if the chat tab is up.
  function pick(tabs, cmd, lastOtherId) {
    if (!tabs.length) return null;
    if (cmd.cur) { const a = tabs.find((t) => t.active && !t.chat); return a || tabs.find((t) => t.id === lastOtherId) || tabs.find((t) => t.active) || null; }
    if (cmd.name) return findByName(tabs, cmd.name);
    if (cmd.last) return tabs[tabs.length - 1];
    if (cmd.n) return tabs[cmd.n - 1] || null;
    if (cmd.rel) { const i = tabs.findIndex((t) => t.active); if (i < 0) return null; return tabs[(i + cmd.rel + tabs.length) % tabs.length]; }
    return null;
  }
  const api = { parse, pick, findByName, clean };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LMChatTabs = api;
})(typeof window !== "undefined" ? window : null);
