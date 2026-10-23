/* Hands-free browser control for BOTH typed chat and Live chat (voice).
 * "go back", "refresh", "scroll down", "new tab", "close this tab", "click the news link", "click the third link",
 * "search the internet for ...", "go to youtube.com" are carried out by the browser itself (no AI involved, so they are
 * instant and cannot be faked). Everything goes through window.oasisTabs.command(), which the browser shell answers.
 * Only works inside the IcyWhite browser (where oasisTabs exists); anywhere else these phrases go to the AI as usual. */
(function (root) {
  "use strict";
  const SEARCH_URL = (q) => "https://duckduckgo.com/?q=" + encodeURIComponent(q);
  async function cmd(req) { const api = root.oasisTabs; if (!api || !api.command) return null; try { return await api.command(req); } catch (e) { return null; } }
  const short = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };

  function isBrowse(c) {
    return !!c && (c.c === "click" || c.c === "search" || c.c === "openurl" || c.c === "scroll" || (c.c === "tab" && c.op !== "closeothers"));
  }

  /* Carries the command out. Returns the sentence to say / show, or null when it should be left to the AI instead. */
  async function exec(c) {
    if (!isBrowse(c)) return null;
    if (c.c === "click") {
      const r = await cmd({ op: "click", q: c.target || "", n: c.n || 0 });
      if (!r) return "I can't reach the browser tabs.";
      if (r.ok) return "Clicked “" + short(r.text) + "”.";
      if (c.soft) return null;   // "open the X link" that isn't on the page: probably meant something else, let the AI handle it
      if (r.error === "no page") return "There's no web page open to click on.";
      const seen = (r.candidates || []).slice(0, 4);
      return "I couldn't find " + (c.target ? "“" + c.target + "”" : "that") + " on the page" + (seen.length ? ". I can see: " + seen.join(", ") : "") + ".";
    }
    if (c.c === "search") {
      const r = await cmd({ op: "open", url: SEARCH_URL(c.q) });
      return r && r.ok ? "Searching for " + c.q + "." : "I couldn't open a tab.";
    }
    if (c.c === "openurl") {
      const r = await cmd({ op: "open", url: c.url });
      return r && r.ok ? "Opening " + host(c.url) + "." : "I couldn't open that address.";
    }
    if (c.c === "scroll") {
      const r = await cmd({ op: "scroll", dir: c.dir });
      return r && r.ok ? ({ down: "Scrolling down.", up: "Scrolling up.", top: "Top of the page.", bottom: "Bottom of the page." })[c.dir] : "There's no page to scroll.";
    }
    if (c.c === "tab") {
      const r = await cmd({ op: c.op === "closecur" ? "closecur" : c.op });
      if (r && r.ok) return ({ new: "New tab.", reload: "Reloading.", back: "Going back.", forward: "Going forward.", closecur: "Closed the tab." })[c.op] || "Done.";
      if (r && r.error === "nowhere") return "There's nowhere to go.";
      if (r && r.error === "no page") return "There's no page open.";
      return "Sorry, that didn't work.";
    }
    return null;
  }

  /* Typed chat: if `text` is one of these commands, do it and return { say }; otherwise null. */
  async function run(text) {
    const Cmd = root.LMChatCmds;
    if (!Cmd || !root.oasisTabs || !root.oasisTabs.command) return null;
    const c = Cmd.parse(text);
    if (!isBrowse(c)) return null;
    const say = await exec(c);
    return say ? { say } : null;
  }

  root.LMChatBrowse = { exec, run, isBrowse };
})(typeof window !== "undefined" ? window : this);
