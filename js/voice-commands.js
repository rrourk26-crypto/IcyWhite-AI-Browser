/* Hands-free voice commands for Live chat ("volume up", "say that again", "new tab", "scroll down", "read this page"...).
 * Pure logic (what was said -> which command) so it can be tested on its own; js/voice.js carries the command out.
 * Only a WHOLE short phrase counts as a command, so normal sentences that happen to contain these words are never taken as commands. */
(function (root) {
  "use strict";
  const clean = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:hey|ok|okay|computer|please|can you|could you|would you|will you|go ahead and|just)\s+)+/, "")
    .replace(/(?:\s+(?:please|for me|now|thanks|thank you))+$/, "").trim();

  const RULES = [
    // volume (of its voice)
    [/^(?:volume up|turn (?:it |the volume |that )?up|turn up (?:the )?volume|(?:raise|increase) (?:the )?volume|(?:speak |talk |be |make it |make that )?louder|(?:a (?:bit|little) )?louder)$/, () => ({ c: "vol", d: 1 })],
    [/^(?:volume down|turn (?:it |the volume |that )?down|turn down (?:the )?volume|(?:lower|decrease|reduce) (?:the )?volume|(?:speak |talk |be |make it |make that )?(?:quieter|softer)|(?:a (?:bit|little) )?(?:quieter|softer))$/, () => ({ c: "vol", d: -1 })],
    [/^(?:set )?(?:the )?volume (?:to |at )?(\d{1,3})(?: percent)?$/, (m) => ({ c: "vol", set: Math.min(100, parseInt(m[1], 10)) })],
    [/^(?:set )?(?:the )?volume (?:to |at )?(?:max|maximum|full)$|^(?:max|full) volume$/, () => ({ c: "vol", set: 100 })],
    [/^(?:set )?(?:the )?volume (?:to |at )?half$|^half volume$/, () => ({ c: "vol", set: 50 })],
    [/^mute(?: (?:the )?(?:voice|volume|sound|yourself|audio))?$/, () => ({ c: "mute" })],
    [/^unmute(?: (?:the )?(?:voice|volume|sound|yourself|audio))?$/, () => ({ c: "unmute" })],
    // speaking speed
    [/^(?:(?:speak|talk|read|go) (?:a (?:bit|little) )?faster|faster|speed up|(?:speak|talk) (?:more )?quickly|(?:speak|talk) fast)$/, () => ({ c: "rate", d: 1 })],
    [/^(?:(?:speak|talk|read|go) (?:a (?:bit|little) )?slower|slower|slow down|(?:speak|talk) (?:more )?slowly)$/, () => ({ c: "rate", d: -1 })],
    [/^(?:(?:normal|regular|default) (?:speed|pace)|(?:speak|talk) normally)$/, () => ({ c: "rate", set: 1 })],
    // replies
    [/^(?:say (?:that|it) again|repeat(?: (?:that|it|yourself))?|what did you say|come again|read (?:that|it) again|say again)$/, () => ({ c: "repeat" })],
    [/^(?:try again|try that again|regenerate|redo (?:that|it)|do (?:that|it) again|give me another (?:answer|reply|one)|another answer)$/, () => ({ c: "redo" })],
    [/^(?:new chat|new conversation|start (?:a )?new (?:chat|conversation)|begin (?:a )?new (?:chat|conversation)|start over)$/, () => ({ c: "newchat" })],
    // browser tabs
    [/^(?:open )?(?:a )?new tab$/, () => ({ c: "tab", op: "new" })],
    [/^(?:reload|refresh)(?: (?:this|the|that))?(?: (?:tab|page|site|website))?$/, () => ({ c: "tab", op: "reload" })],
    [/^(?:go back(?: (?:a|one) page)?|back|previous page)$/, () => ({ c: "tab", op: "back" })],
    [/^(?:go forward(?: (?:a|one) page)?|forward)$/, () => ({ c: "tab", op: "forward" })],
    [/^(?:close (?:all )?(?:the )?other tabs|close everything else)$/, () => ({ c: "tab", op: "closeothers" })],
    [/^close (?:this|the|the current|current|that) (?:tab|page|window)$|^close tab$/, () => ({ c: "tab", op: "closecur" })],
    // scrolling the page you are looking at
    [/^(?:scroll|page) down(?: a (?:bit|little))?$/, () => ({ c: "scroll", dir: "down" })],
    [/^(?:scroll|page) up(?: a (?:bit|little))?$/, () => ({ c: "scroll", dir: "up" })],
    [/^(?:(?:scroll|go|jump|take me) (?:to )?(?:the )?top(?: of (?:the |this )?(?:page|tab))?|top of (?:the |this )?(?:page|tab))$/, () => ({ c: "scroll", dir: "top" })],
    [/^(?:(?:scroll|go|jump|take me) (?:to )?(?:the )?(?:bottom|end)(?: of (?:the |this )?(?:page|tab))?|(?:bottom|end) of (?:the |this )?(?:page|tab))$/, () => ({ c: "scroll", dir: "bottom" })],
    // read the page
    [/^(?:read|summarize|summarise|sum up|tell me about) (?:this|the current|the open|the active) (?:page|tab|site|website|article)$|^summary of (?:this|the current) (?:page|tab|article)$|^what(?:s| is) on (?:this|the) (?:page|tab|screen)$/, () => ({ c: "readpage" })],
    // app windows
    [/^(?:open|show|go to|bring up) (?:the |my )?settings$/, () => ({ c: "settings" })],
    [/^(?:(?:open|show|go to|bring up) (?:the |my )?(?:chat )?history|show (?:my )?(?:old|past|previous) chats)$/, () => ({ c: "history" })],
    // stay on
    [/^(?:keep listening|stay awake|stay on|dont go to sleep|dont stop listening|keep it on)$/, () => ({ c: "awake" })]
  ];
  // -> null (not a command) or { c: "click"|"search"|"openurl"|"vol"|"mute"|"unmute"|"rate"|"repeat"|"redo"|"newchat"|"tab"|"scroll"|"readpage"|"settings"|"history"|"awake", ... }
  /* Commands that carry a name or an address ("click the news link", "search for ...", "go to youtube.com").
     These keep dots and slashes, so they read the lightly cleaned text instead of clean(). */
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const TLD = "com|org|net|io|gov|edu|tv|co|ai|app|dev|info|us|uk|ca|de|fr|me|xyz|news|tech|online|site|gg|fm|ly|to";
  function parseBrowse(text) {
    let raw = String(text || "").toLowerCase().trim().replace(/[’']/g, "").replace(/\s+dot\s+/g, ".").replace(/[?!]+$/, "").replace(/\.$/, "")
      .replace(/^(?:(?:hey|ok|okay|computer|please|can you|could you|would you|will you|go ahead and|just)[,\s]+)+/, "")
      .replace(/(?:[,\s]+(?:please|for me|now|thanks|thank you))+$/, "").trim();
    if (!raw || raw.length > 100) return null;
    let m;
    // go to / open a website address
    if ((m = raw.match(new RegExp("^(?:go to|open|visit|navigate to|take me to|pull up)\\s+(?:the\\s+)?(?:(?:website|site|page|url)\\s+)?(?:at\\s+)?((?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)+(?:" + TLD + ")(?:\\/\\S*)?)$")))) {
      return { c: "openurl", url: /^https?:\/\//.test(m[1]) ? m[1] : "https://" + m[1] };
    }
    // search the internet: opens the results in a new tab
    if ((m = raw.match(/^(?:do (?:an? )?)?(?:(?:internet|web|google|online)\s+)?(?:search|google|look up|lookup)(?:\s+(?:the\s+)?(?:internet|web|google|online))?(?:\s+and\s+(?:open|show me|find))?(?:\s+for)?\s+(.{2,80})$/))
        && !/\b(?:and (?:tell|explain|summari[sz]e|write)|then)\b/.test(m[1])) {
      return { c: "search", q: m[1].trim() };
    }
    // click something on the page
    let soft = false;
    if ((m = raw.match(/^(?:click|press|tap|hit|select|choose)(?:\s+on)?\s+(.{1,60})$/)) || (soft = true, m = raw.match(/^(?:open|follow|go to)\s+(?:the\s+)?(.{1,40}?)\s+link$/))) {
      let tg = m[1].replace(/^(?:the|a|an)\s+/, "").replace(/\s+(?:link|button|tab|option|menu|item|page)$/, "").trim();
      if (!tg || /^(?:it|that|this|here|there|him|her|them)$/.test(tg)) return null;
      let o = tg.match(/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:link|one|result|item))?$/) || tg.match(/^(?:link|result|number)\s+(?:number\s+)?(\d{1,2})$/);
      if (o) { const n = ORD[o[1]] || parseInt(o[1], 10); if (n >= 1 && n <= 40) return soft ? { c: "click", n, soft: true } : { c: "click", n }; }
      return soft ? { c: "click", target: tg, soft: true } : { c: "click", target: tg };
    }
    return null;
  }
  // Commands for every other function of the app (js/voice-app-commands.js): chats, settings, switches, camera, approvals...
  const APP = (typeof require === "function" && typeof module !== "undefined") ? require("./voice-app-commands.js") : (root && root.LMChatAppCmds);
  function parse(text) {
    const t = clean(text);
    if (t && t.length <= 60) { for (const [re, fn] of RULES) { const m = t.match(re); if (m) return fn(m); } }
    const a = APP ? APP.parse(text) : null;   // before the browse rules, so "web search on" is a switch, not a search for "on"
    if (a) return a;
    return parseBrowse(text) || (APP ? APP.parseLink(text) : null);
  }
  const isYes = (text) => /^(?:yes|yeah|yep|yup|sure|ok|okay|confirm|do it|go ahead|affirmative|correct|yes please)$/.test(clean(text));
  const isNo = (text) => /^(?:no|nope|nah|cancel|dont|do not|never mind|nevermind|stop|abort)$/.test(clean(text));
  const api = { parse, isYes, isNo, clean };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LMChatCmds = api;
})(typeof window !== "undefined" ? window : null);
