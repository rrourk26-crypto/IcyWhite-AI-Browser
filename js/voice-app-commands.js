/* Hands-free voice commands for EVERY function of the app (chat, history, settings, toggles, camera, screen, approvals, code lab, models...).
 * Pure logic: what was said -> which command. js/voice-actions.js carries the command out; js/voice-commands.js calls parse() here.
 * Only a WHOLE short phrase counts as a command, so normal sentences that merely contain these words are never taken as commands.
 *
 * parse(text) -> null | { c: "app", id: "...", ...details }
 * CATALOG     -> the list of everything you can say, grouped (used by the in-app help window, VOICE-COMMANDS.md and the tests). */
(function (root) {
  "use strict";
  const FILLER_LEAD = /^(?:(?:hey|ok|okay|computer|please|can you|could you|would you|will you|go ahead and|just|i want you to|i want to|i would like to|id like to|lets|let us)[,\s]+)+/i;
  const FILLER_TAIL = /(?:[,\s]+(?:please|for me|now|thanks|thank you|right now|right away))+$/i;
  // `t`: lower case, no punctuation (for matching). `raw`: same cleanup but keeps case and spelling (for names and titles).
  function norm(text) {
    const raw = String(text || "").replace(/[’]/g, "'").trim().replace(/[?!.]+$/, "").replace(FILLER_LEAD, "").replace(FILLER_TAIL, "").trim();
    const t = raw.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9 .]+/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ").replace(/\s+/g, " ").trim();
    return { raw, t };
  }
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const ORDS = Object.keys(ORD).join("|");

  /* ---- On / off switches. kind: "save" = a setting changed in Settings (the app opens it, changes it and saves), "live" = changes right away ---- */
  const TOGGLES = [
    { key: "webSearch", say: "web search", names: ["web search", "searching the web", "internet search", "search the web"], kind: "save", el: "setWebSearch" },
    { key: "webBrowse", say: "web reading with sources", names: ["web reading", "reading the web", "web research", "web browsing", "browsing the web", "web sources", "web citations"], kind: "save", el: "setWebBrowse" },
    { key: "webAuto", say: "checking the web first", names: ["web check", "checking the web", "check the web first", "automatic web check", "auto web check", "fact checking", "fact check"], kind: "save", el: "setWebAuto" },
    { key: "realImages", say: "real photos", names: ["real photos", "real images", "photo search", "stock photos"], kind: "save", el: "setRealImages" },
    { key: "imageGen", say: "image generation", names: ["image generation", "image generator", "generating images", "drawing images", "picture generation"], kind: "save", el: "setImageGen" },
    { key: "memory", say: "memory", names: ["memory", "long term memory", "remembering me", "remembering things"], kind: "save", el: "setMemoryEnabled" },
    { key: "autoApply", say: "auto apply", names: ["auto apply", "autoapply", "automatic apply", "auto applying", "auto apply changes", "automatic file changes"], kind: "save", el: "setAutoApply" },
    { key: "compact", say: "compact mode", names: ["compact mode", "compacting", "auto summarizing", "summarizing old messages", "long chat summaries"], kind: "save", el: "setCompact" },
    { key: "tabClick", say: "clicking links in shared tabs", names: ["tab clicking", "clicking links", "link clicking", "tab click"], kind: "save", el: "setTabClick" },
    { key: "commands", say: "running commands", names: ["running commands", "command running", "command proposals", "commands"], kind: "save", el: "setCommands" },
    { key: "winApps", say: "Windows tools", names: ["windows tools", "windows apps", "pc tools", "windows apps and tools"], kind: "save", el: "setWinApps" },
    { key: "mcp", say: "tools", names: ["ai tools", "mcp tools", "mcp", "tools", "tool use"], kind: "save", el: "mcpOn" },
    { key: "mcpAsk", say: "asking before each tool", names: ["tool confirmation", "tool approval", "asking before tools", "ask before using tools", "ask before tools", "tool permission", "tool permissions"], kind: "save", el: "mcpAsk" },
    { key: "readAloud", say: "reading replies aloud", names: ["read aloud", "reading aloud", "auto read", "read replies aloud", "reading replies", "spoken replies", "read replies", "text to speech"], kind: "live", el: "speakBtn", button: true },
    { key: "autopilot", say: "autopilot", names: ["autopilot", "auto pilot"], kind: "live", el: "autoBtn", button: true },
    { key: "speakUp", say: "speaking up on its own", names: ["speaking up", "speak up", "proactive mode", "proactive", "initiative", "speaking up on its own", "speak up on its own"], kind: "live", el: "talkBtn", button: true },
    { key: "wake", say: "the wake word", names: ["wake word", "the wake word", "wake words", "wake word mode"], kind: "live", el: "setWakeOn" },
    { key: "beep", say: "the wake beep", names: ["wake beep", "beep", "chime", "wake sound", "wake chime"], kind: "live", el: "setWakeBeep" },
    { key: "voiceStop", say: "stopping by voice", names: ["voice stop", "stop word", "stopping by voice", "voice interrupt", "voice interrupts", "interrupting by voice"], kind: "live", el: "setVoiceStop" },
    { key: "barge", say: "speaking over the reply", names: ["barge in", "barge", "interrupting", "speaking over", "talking over", "interruptions"], kind: "live", el: "setBarge" },
    { key: "autoWatch", say: "auto watch", names: ["auto watch", "auto watching", "screen watching", "automatic watching"], kind: "live", el: "visionAutoWatch" }
  ];
  const NAME_TO_TOGGLE = {};
  TOGGLES.forEach((tg) => tg.names.forEach((n) => { NAME_TO_TOGGLE[n] = tg; }));
  const NAME_ALT = Object.keys(NAME_TO_TOGGLE).sort((a, b) => b.length - a.length).map((n) => n.replace(/ /g, "\\s")).join("|");
  const ON_W = "turn on|switch on|enable|activate|start|allow|use|set on", OFF_W = "turn off|switch off|disable|deactivate|stop|disallow|shut off|set off";
  const RE_TG1 = new RegExp("^(" + ON_W + "|" + OFF_W + ") (?:the |my )?(" + NAME_ALT + ")$");
  const RE_TG2 = new RegExp("^(?:turn|switch|set) (?:the |my )?(" + NAME_ALT + ") (on|off)$");
  const RE_TG3 = new RegExp("^(?:the )?(" + NAME_ALT + ") (on|off)$");
  const RE_TG4 = new RegExp("^(?:turn|switch) (on|off) (?:the |my )?(" + NAME_ALT + ")$");
  const isOnWord = (w) => new RegExp("^(?:" + ON_W + ")$").test(w);

  const TABS = "general|connection|local model|local|behavior|behaviour|images and search|images|voice|tools";
  const tabKey = (s) => ({ "local model": "local", behaviour: "behavior", "images and search": "images", images: "images" })[s] || s;

  /* Rules run on `t` (lower case) except those marked raw (they keep capital letters). Each returns the command details or undefined. */
  const RULES = [
    // ----- the reply that is coming or just came -----
    [/^(?:stop|cancel|abort) (?:generating|the reply|that reply|the answer|writing|the response|typing|the generation)$/, () => ({ id: "stop" })],
    [/^(?:continue|continue writing|continue the reply|continue your reply|keep going|keep writing|go on|carry on|finish (?:that|the|your) (?:reply|answer|thought|sentence))$/, () => ({ id: "continue" })],
    [/^copy (?:that|it|this|the reply|the answer|that reply|that answer|the last reply|the last answer|the response|your reply|your answer)$/, () => ({ id: "copy", which: "reply" })],
    [/^copy (?:my )?(?:last|previous) (?:message|prompt|question)$/, () => ({ id: "copy", which: "user" })],
    [/^(?:edit|change|fix|reword) (?:my )?(?:last|previous) (?:message|prompt|question)$/, () => ({ id: "editlast" })],
    [/^delete (?:that|this|the|your|the last|your last|that last) ?(?:last )?(?:reply|answer|response)$/, () => ({ id: "deletelast", which: "reply" })],
    [/^delete (?:my )?(?:last|previous) (?:message|prompt|question)$/, () => ({ id: "deletelast", which: "user" })],
    [/^(?:show |go to |go back to |switch to )?(?:the )?(previous|earlier|older|prior) (?:version|answer|reply|draft)$/, () => ({ id: "version", d: -1 })],
    [/^(?:show |go to |switch to )?(?:the )?(next|newer|later) (?:version|answer|reply|draft)$/, () => ({ id: "version", d: 1 })],
    [/^(?:send|send it|send that|send message|send the message|submit|submit it|press enter|hit send)$/, () => ({ id: "send" })],
    [/^(?:clear|erase|empty|wipe) (?:the |my )?(?:message box|text box|input box|input field|text field|message field|draft|message input|typing box)$/, () => ({ id: "clearinput" })],
    // ----- scrolling the chat itself -----
    [/^(?:scroll|page)(?: the)? (?:chat|messages|conversation) (up|down)$/, (m) => ({ id: "chatscroll", dir: m[1] })],
    [/^(?:go to|jump to|scroll to|show) (?:the )?(?:latest|newest|last|bottom) (?:message|reply)$|^(?:scroll|go|jump) to (?:the )?bottom of (?:the )?(?:chat|conversation)$/, () => ({ id: "chatscroll", dir: "bottom" })],
    [/^(?:go to|jump to|scroll to) (?:the )?(?:first|top|oldest) message$|^(?:scroll|go|jump) to (?:the )?top of (?:the )?(?:chat|conversation)$/, () => ({ id: "chatscroll", dir: "top" })],
    // ----- chats and history -----
    [/^(?:close|hide|dismiss|shut) (?:the |my )?(?:chat )?history$/, () => ({ id: "historyclose" })],
    [/^(?:open|go to|switch to|resume|load|show) (?:the |my )?(oldest|first|latest|most recent|newest|recent|last|previous) (?:chat|conversation)$/, (m) => (/^(?:oldest)$/.test(m[1]) ? { id: "openchat", which: "oldest" } : /^(?:first|latest|most recent|newest|recent)$/.test(m[1]) ? { id: "openchat", which: "newest" } : { id: "openchat", which: "prev" })],
    [/^(?:open|go to|switch to|resume|load|show) (?:the |my )?(?:chat|conversation) (?:number |no )?(\d{1,2})$/, (m) => ({ id: "openchat", n: parseInt(m[1], 10) })],
    [new RegExp("^(?:open|go to|switch to|resume|load|show) (?:the |my )?(" + ORDS + ") (?:chat|conversation)(?: in (?:the )?(?:list|history))?$"), (m) => ({ id: "openchat", n: ORD[m[1]] })],
    [/^(?:open|go to|switch to|resume|load|find|show|continue) (?:the |my )?(?:chat|conversation) (?:called |named |about |on |with |titled |regarding )?(.{2,50})$/, (m) => (/^(?:history|list|settings|tab|window)$/.test(m[1]) ? null : { id: "openchat", name: m[1].trim() })],
    [/^(?:open|go to|switch to|resume|load|find|continue) (?:the |my )?(.{2,40}?) (?:chat|conversation)$/, (m) => (/^(?:new|old|past|previous|last|first|latest|current|this|that|a|the|my|voice|live|oasis|element|group|open)$/.test(m[1]) ? null : { id: "openchat", name: m[1].trim() })],
    [/^delete (?:this|the current|current) (?:chat|conversation)$/, () => ({ id: "deletechat" })],
    [/^(pin|unpin) (?:this|the current|current) (?:chat|conversation)$/, (m) => ({ id: "pinchat", pin: m[1] === "pin" })],
    [/^export (?:this|the current|current) (?:chat|conversation)(?: as| to)?(?: (markdown|json))?$/, (m) => ({ id: "exportchat", fmt: m[1] === "json" ? "json" : "md" })],
    // ----- panels and pages of the app -----
    [/^(collapse|expand|minimi[sz]e|hide|show|open|close|toggle) (?:the )?(?:side ?bar|side menu|menu rail|rail|side panel|left menu)$/, (m) => ({ id: "rail", want: /^(?:expand|show|open)$/.test(m[1]) ? "open" : /^toggle$/.test(m[1]) ? "toggle" : "close" })],
    [/^(hide|show|toggle) (?:the )?(?:tool ?bar|top ?bar)$/, () => ({ id: "toolbar" })],
    [/^(?:open|show|go to|start|launch) (?:the )?code ?lab$/, () => ({ id: "codelab", open: true })],
    [/^(?:close|exit|leave|hide) (?:the )?code ?lab$/, () => ({ id: "codelab", open: false })],
    [/^(?:run|execute) (?:the |my )?(?:code|program|script)$/, () => ({ id: "runcode" })],
    [/^(?:open|show|go to|launch) (?:the )?(?:oasis chat|oasis|element|chat in element|element chat|oasis chat in element)$/, () => ({ id: "element" })],
    [/^(?:edit|change|manage|show|open) (?:my |the )?(?:links|shortcuts|bookmarks|sidebar links)$|^add (?:a |new )?(?:link|shortcut|bookmark)$/, () => ({ id: "editlinks" })],
    [/^save (?:the |my )?(?:links|shortcuts)$/, () => ({ id: "dialog", op: "savelinks" })],
    [/^(?:open|show|go to|launch) (?:the )?(?:welcome|setup|getting started|set up) (?:screen|window|guide|wizard|page)$/, () => ({ id: "welcome" })],
    [/^(?:tell me|read|give me|whats|what is) (?:the |todays |today s )?(?:daily |todays |today s )?fact(?: of the day)?$|^(?:daily|todays|today s) fact$/, () => ({ id: "fact" })],
    [/^(?:tell me more|more) (?:about )?(?:the |that |this )?(?:daily |todays )?fact$/, () => ({ id: "factmore" })],
    // ----- look and feel -----
    [/^turn (on|off) (dark|light|night|day) (?:mode|theme)$/, (m) => ({ id: "theme", mode: (m[1] === "on") === /^(?:dark|night)$/.test(m[2]) ? "dark" : "light" })],
    [/^(?:switch to |go |use |change to |enable |set )?(?:the )?(dark|light|night|day) (?:mode|theme)$/, (m) => ({ id: "theme", mode: /^(?:dark|night)$/.test(m[1]) ? "dark" : "light" })],
    [/^(?:switch|toggle|change|flip) (?:the )?(?:theme|colou?rs?|mode|dark mode|light mode|dark light mode)$/, () => ({ id: "theme", mode: "toggle" })],
    [/^(?:follow |use |switch to )?(?:the )?system (?:theme|mode|colou?rs?)$/, () => ({ id: "theme", mode: "system" })],
    // ----- settings -----
    [/^(?:close|cancel|exit|dismiss|leave|hide) (?:the |my )?settings$/, () => ({ id: "dialog", op: "cancelsettings" })],
    [/^save (?:the |my )?settings$|^save and close(?: settings)?$/, () => ({ id: "dialog", op: "savesettings" })],
    [new RegExp("^(?:open |show |go to |switch to )?(?:the )?(" + TABS + ") (?:settings|tab|options|section)$"), (m) => ({ id: "settingstab", tab: tabKey(m[1]) })],
    [new RegExp("^(?:open |show |go to |switch to )?(?:the )?settings (?:for |tab )?(?:the )?(" + TABS + ")$"), (m) => ({ id: "settingstab", tab: tabKey(m[1]) })],
    [/^(?:search|find|look for|look up) (?:the |in |in the )?settings (?:for )?(.{2,40})$/, (m) => ({ id: "searchsettings", q: m[1].trim() })],
    [/^(?:close|dismiss|hide|exit|cancel) (?:this|the|that|current)? ?(?:window|dialog|dialogue|popup|pop up|panel|box|screen|menu)$/, () => ({ id: "dialog", op: "close" })],
    // ----- connection and models -----
    [/^(?:check (?:the )?connection|(?:is|are) (?:the )?(?:model|server|lm studio|llama|you|it) (?:connected|online|running|up|working|ready)|connection status|(?:test|check) (?:the )?(?:model |server )?connection|hows the connection|whats the connection(?: status)?|are we connected)$/, () => ({ id: "status" })],
    [/^(?:refresh|reload|update|rescan) (?:the )?(?:model )?(?:list|models)$/, () => ({ id: "refreshmodels" })],
    [/^(?:what|which) model (?:is this|are you|am i using|is selected|is loaded|are we using|is it|do i have)$|^(?:current|which|what) model$|^what (?:are )?you running$/, () => ({ id: "whichmodel" })],
    [/^(next|previous) model$/, (m) => ({ id: "model", rel: m[1] === "next" ? 1 : -1 })],
    [/^(?:switch|change|use|select|load|swap) (?:to )?(?:the )?model (?:to |called |named )?(.{1,50})$/, (m) => ({ id: "model", name: m[1].trim() })],
    [/^(?:switch|change|swap) to (?:the )?(.{2,50}?) model$/, (m) => ({ id: "model", name: m[1].trim(), soft: true })],
    [/^(next|previous) (?:persona|character)$/, (m) => ({ id: "persona", rel: m[1] === "next" ? 1 : -1 })],
    [/^(?:use|switch to|change to|activate|load|select|be) (?:the )?(.{2,40}?) (?:persona|character|personality)$/, (m) => ({ id: "persona", name: m[1].trim() })],
    [/^(?:use|switch to|activate|select|load) (?:the )?(?:persona|character) (?:called |named )?(.{2,40})$/, (m) => ({ id: "persona", name: m[1].trim() })],
    [/^(?:set )?(?:the )?temperature (?:to |at )?(\d(?:\.\d{1,2})?|zero|one|two|point \d)$/, (m) => ({ id: "temperature", v: ({ zero: 0, one: 1, two: 2 })[m[1]] !== undefined ? ({ zero: 0, one: 1, two: 2 })[m[1]] : /^point/.test(m[1]) ? parseFloat("0." + m[1].slice(6)) : parseFloat(m[1]) })],
    [/^(?:start|launch|load|turn on|boot) (?:the )?(?:local |built ?in )(?:model|server|ai|llama)$/, () => ({ id: "localmodel", on: true })],
    [/^(?:stop|shut down|unload|turn off|kill) (?:the )?(?:local |built ?in )(?:model|server|ai|llama)$/, () => ({ id: "localmodel", on: false })],
    [/^(?:open|show|go to|launch) (?:the )?(?:hugging ?face|model (?:store|hub|browser|downloads?))$/, () => ({ id: "hf", op: "open" })],
    [/^(?:close|hide|exit) (?:the )?(?:hugging ?face|model (?:store|hub|browser|downloads?))$/, () => ({ id: "hf", op: "close" })],
    [/^(?:search|find|look for|browse) (?:on |in )?(?:hugging ?face|(?:the )?model (?:hub|store)) (?:for )?(.{2,50})$/, (m) => ({ id: "hf", op: "search", q: m[1].trim() })],
    // ----- the buttons around the message box -----
    [/^(?:attach|add|upload|open|pick|choose|browse for|select) (?:a |an |some |the )?(?:new )?(?:file|files|image|images|picture|pictures|photo|photos|document|documents|attachment|pdf)$/, () => ({ id: "attach" })],
    [/^(?:open|choose|pick|select|add) (?:a |the |my )?(?:project )?folder$|^open (?:a |the |my )?project(?: folder)?$/, () => ({ id: "project" })],
    [/^(?:remove|clear|delete|drop|detach) (?:all )?(?:the |my )?(?:attachments|attached files|files|attached)$/, () => ({ id: "clearattach" })],
    [/^(?:show|use|open|turn on|start|switch on|activate) (?:the |my |your )?(?:web ?cam|camera)$/, () => ({ id: "cam", op: "open" })],
    [/^(?:close|stop|turn off|hide|exit|switch off) (?:the |my |your )?(?:web ?cam|camera)$/, () => ({ id: "cam", op: "close" })],
    [/^(?:take|snap|capture|grab) (?:a |the )?(?:picture|photo|shot|snapshot|pic|still)$|^(?:say cheese|snap it)$/, () => ({ id: "snap" })],
    [/^(?:share|show|start sharing|start) (?:my |the |your )?screen(?: share| sharing)?$|^(?:look at|watch) (?:my |the )?screen$/, () => ({ id: "screen", op: "open" })],
    [/^(?:stop|end|quit|cancel) (?:sharing|screen sharing|sharing my screen|the screen share|screen share|the camera share|watching)$|^(?:stop|end) (?:the )?(?:screen|camera|video) (?:share|feed)$/, () => ({ id: "screen", op: "close" })],
    [/^(?:take a screenshot|screenshot|capture (?:the |my )?screen|attach (?:a |the )?(?:still|screenshot|frame)|capture (?:this|it))$/, () => ({ id: "screenshot" })],
    [/^(?:minimi[sz]e|shrink|hide) (?:the )?(?:video |camera |screen )?(?:feed|preview|video)$/, () => ({ id: "feedmin" })],
    // ----- approvals: what the AI asks you to confirm -----
    [/^(?:always allow|allow always)(?: it| that| this| the| tool| that tool| the tool)*$/, () => ({ id: "approve", scope: "tool", always: true })],
    [/^(?:allow|approve|permit|accept)(?: it| that| this| the tool| that tool| the request| the tool call)?$/, () => ({ id: "approve", scope: "any" })],
    [/^(?:yes )?(?:apply|accept)(?: all)?(?: the| that| this| these| those)?(?: file| files| changes| change| edits| edit| patch| update| updates)*$|^(?:apply|accept) (?:it|them|everything)$/, () => ({ id: "approve", scope: "apply" })],
    [/^(?:run|execute|go ahead and run)(?: it| that| this| the command| that command| the proposed command| the commands| them)$/, () => ({ id: "approve", scope: "run" })],
    [/^(?:deny|dont allow|do not allow|reject|refuse|block|decline|dont apply|do not apply|dont run it|do not run it|skip|discard)(?: it| that| this| all| the tool| that tool| the request| the changes| the change| the edits| the command| that command| the commands| them)?$/, () => ({ id: "decline" })],
    [/^(?:stop|cancel|kill|end) (?:the |that |this )?(?:running )?(?:command|process|program)$/, () => ({ id: "stopcmd" })],
    // ----- voice settings -----
    [/^(?:next|another|different|change the|change your|switch the|switch your) voice$|^change voices?$/, () => ({ id: "voice", d: 1 })],
    [/^(?:previous|last|earlier) voice$/, () => ({ id: "voice", d: -1 })],
    [/^(?:test|try|preview|demo) (?:the |your |this )?voice$/, () => ({ id: "voicetest" })],
    [/^(?:change|set|make) (?:the |your )?wake word (?:to |as |into )(.{2,30})$/, (m) => ({ id: "wakeword", word: m[1].trim() })],
    [/^(?:set |change )?(?:the )?(?:interrupt|interruption|barge in|barge) sensitivity (?:to )?(low|normal|high)$/, (m) => ({ id: "bargesens", v: m[1] })],
    // ----- help -----
    [/^(?:close|hide|dismiss|exit) (?:the )?(?:help|commands|command list|voice commands|list of commands)$/, () => ({ id: "helpclose" })],
    [/^(?:help|help me|voice help|voice commands|commands|(?:show|list|open|read) (?:me )?(?:the |all |all the |my )?(?:voice )?commands|what can (?:i|you) (?:say|do)|what (?:are )?(?:the |your )?(?:voice )?commands(?: are there)?|what are my options|how do i use (?:voice|this)|what do i say)$/, () => ({ id: "help" })],
    [/^(?:help|commands|what can i say|voice commands) (?:for |with |about |on )?(?:the )?([a-z ]{3,30})$/, (m) => ({ id: "help", group: m[1].trim() })]
  ];

  function parse(text) {
    const { raw, t } = norm(text);
    if (!t || t.length > 90) return null;
    let m;
    // rename needs the title with its capital letters
    if ((m = raw.match(/^(?:rename|call|name|title) (?:this|the current|current) (?:chat|conversation)(?: to| as)? (.{1,60})$/i))) return { c: "app", id: "renamechat", title: m[1].trim() };
    // on / off switches
    if ((m = t.match(RE_TG1))) { const tg = NAME_TO_TOGGLE[m[2].replace(/\s+/g, " ")]; if (tg) return { c: "app", id: "toggle", key: tg.key, on: isOnWord(m[1]) }; }
    if ((m = t.match(RE_TG2)) || (m = t.match(RE_TG3))) { const tg = NAME_TO_TOGGLE[m[1].replace(/\s+/g, " ")]; if (tg) return { c: "app", id: "toggle", key: tg.key, on: m[2] === "on" }; }
    if ((m = t.match(RE_TG4))) { const tg = NAME_TO_TOGGLE[m[2].replace(/\s+/g, " ")]; if (tg) return { c: "app", id: "toggle", key: tg.key, on: m[1] === "on" }; }
    for (const [re, fn] of RULES) { if ((m = t.match(re))) { const r = fn(m); if (r) return Object.assign({ c: "app" }, r); } }
    // "open <name>": a link in the sidebar (Wikipedia, YouTube...). Not a command if no such link exists: the app then lets the AI answer.
    return null;
  }
  // "open Wikipedia": a link in the sidebar. Only a command when a link with that name really exists (the app supplies the names through setLinks), so "open the door" is left to the AI.
  let linkNames = () => [];
  function parseLink(text) {
    const { t } = norm(text); let m;
    if (!(m = t.match(/^(?:open|launch|go to|show me|take me to|visit) (?:my |the )?([a-z0-9 ]{2,30}?)(?: link| shortcut| site)?$/)) || m[1].split(" ").length > 3) return null;
    const q = m[1].replace(/\s/g, "");
    const hit = linkNames().find((n) => { const k = String(n).toLowerCase().replace(/[^a-z0-9]/g, ""); return k && (k === q || (q.length >= 3 && (k.includes(q) || q.includes(k)))); });
    return hit ? { c: "app", id: "openlink", name: hit } : null;
  }

  /* ================= Everything you can say (shown in Settings > Voice > "Voice commands", and in VOICE-COMMANDS.md) =================
   * Every phrase listed here is tested: it must really be understood. "alt" are other natural ways to say the same thing. */
  const CATALOG = [
    { group: "Live chat basics", items: [
      { say: ["computer"], does: "Wake word: starts a conversation (you can change the word). Then talk normally." },
      { say: ["goodbye", "that's all", "go to sleep", "stop listening"], does: "Ends the conversation. It waits for the wake word again.", via: "goodbye" },
      { say: ["end live", "stop live chat", "turn off live mode"], does: "Leaves live chat completely and turns the microphone off.", via: "endlive" },
      { say: ["stop", "wait", "hold on", "be quiet"], does: "Interrupts the reply while it is thinking or speaking (you can also just talk over it).", via: "stop" },
      { say: ["keep listening", "stay awake", "stay on"], does: "Stops the silence timer from ending live chat." },
      { say: ["help", "what can I say", "voice commands"], does: "Opens the list of voice commands and tells you the main ones." },
      { say: ["help with settings", "help with chats"], does: "Reads the commands of one group." },
      { say: ["close help"], does: "Closes the list." }
    ] },
    { group: "Volume and speed of the voice", items: [
      { say: ["volume up", "louder", "turn it up"], does: "Raises the volume of the AI's voice." },
      { say: ["volume down", "quieter", "softer", "turn it down"], does: "Lowers the volume." },
      { say: ["set volume to 40 percent", "volume 80", "half volume", "max volume"], does: "Sets an exact volume." },
      { say: ["mute", "unmute"], does: "Silences the voice, or brings it back." },
      { say: ["speak faster", "speed up", "faster"], does: "Faster speech." },
      { say: ["speak slower", "slow down", "slower"], does: "Slower speech." },
      { say: ["normal speed", "speak normally"], does: "Back to normal speed." },
      { say: ["next voice", "change the voice", "previous voice"], does: "Cycles through the installed voices." },
      { say: ["test the voice", "preview voice"], does: "Plays a sample sentence." },
      { say: ["turn on read aloud", "turn off reading aloud", "enable spoken replies"], does: "Reads every reply aloud when you type (live chat always does)." }
    ] },
    { group: "Replies", items: [
      { say: ["say that again", "repeat that", "what did you say"], does: "Reads the last reply again." },
      { say: ["try again", "regenerate", "give me another answer"], does: "Writes the last reply again." },
      { say: ["continue", "keep going", "keep writing"], does: "Continues a reply that stopped early." },
      { say: ["stop generating", "stop the reply"], does: "Stops a reply that is being written." },
      { say: ["previous version", "next version"], does: "Flips between versions of a reply." },
      { say: ["copy that", "copy the reply", "copy my last message"], does: "Copies the last reply (or your last message) to the clipboard." },
      { say: ["edit my last message"], does: "Opens your last message for editing." },
      { say: ["delete that reply", "delete my last message"], does: "Deletes it, after you say yes." },
      { say: ["send it", "clear the message box"], does: "Sends, or empties, the text in the message box." },
      { say: ["scroll the chat down", "go to the latest message", "go to the first message"], does: "Moves through the conversation." }
    ] },
    { group: "Chats and history", items: [
      { say: ["new chat", "start over", "start a new conversation"], does: "Starts an empty chat." },
      { say: ["open chat history", "show my old chats"], does: "Opens the list of past chats." },
      { say: ["close history"], does: "Closes the list." },
      { say: ["open the chat about pasta", "resume the chat called taxes"], does: "Opens a past chat by (part of) its title." },
      { say: ["open the third chat", "open chat number 2"], does: "Opens a chat by its place in the list." },
      { say: ["open my last chat", "open the most recent chat", "open the oldest chat"], does: "Opens the chat you were in before, the newest one, or the oldest." },
      { say: ["rename this chat to Trip plans"], does: "Renames the current chat." },
      { say: ["pin this chat", "unpin this chat"], does: "Pins it to the top of the list." },
      { say: ["export this chat as markdown", "export this chat as json"], does: "Saves the chat as a file." },
      { say: ["delete this chat"], does: "Deletes the current chat, after you say yes." }
    ] },
    { group: "Browser tabs and web pages", items: [
      { say: ["new tab", "open a new tab"], does: "Opens a new tab." },
      { say: ["go back", "go forward", "refresh the page"], does: "Navigates the page you are looking at." },
      { say: ["scroll down", "scroll up", "go to the top of the page", "scroll to the bottom"], does: "Scrolls the page." },
      { say: ["next tab", "previous tab", "switch to the YouTube tab", "go to tab 3"], does: "Switches tabs by position or by name.", via: "tabs" },
      { say: ["close this tab", "close the second tab", "close the news tab"], does: "Closes a tab.", via: "tabs" },
      { say: ["close all other tabs"], does: "Closes every other tab, after you say yes." },
      { say: ["click the sign in link", "click the third link", "click link number 2"], does: "Clicks something on the page by its name or its number." },
      { say: ["search the internet for coast to coast", "google best pizza near me"], does: "Opens search results in a new tab." },
      { say: ["go to youtube.com", "open youtube dot com"], does: "Opens a web address." },
      { say: ["open Wikipedia"], does: "Opens one of your sidebar links by its name." },
      { say: ["read this page", "summarize this page"], does: "The AI reads the page you are on and tells you what it says." }
    ] },
    { group: "Windows and panels", items: [
      { say: ["open settings", "close settings", "save settings"], does: "Opens, closes or saves the Settings window." },
      { say: ["voice settings", "connection settings", "behavior settings", "go to the tools settings"], does: "Opens Settings on a certain tab (general, connection, local model, behavior, images, voice, tools)." },
      { say: ["search settings for temperature"], does: "Types into the settings search box." },
      { say: ["close this window", "close the dialog"], does: "Closes whatever window is open." },
      { say: ["expand the sidebar", "collapse the sidebar", "hide the toolbar"], does: "Shows or hides the side menu." },
      { say: ["open code lab", "close code lab", "run the code"], does: "Code Lab: opens, closes, runs the code." },
      { say: ["open element chat"], does: "Opens Oasis Chat in Element." },
      { say: ["edit my links", "add a link", "save links"], does: "Manage the sidebar links." },
      { say: ["open the welcome guide"], does: "Opens the first-run guide." },
      { say: ["dark mode", "light mode", "switch the theme", "follow the system theme"], does: "Changes the colors." },
      { say: ["tell me the daily fact", "tell me more about the fact"], does: "Reads today's fact, or starts a chat about it." }
    ] },
    { group: "Models and connection", items: [
      { say: ["check the connection", "are you connected"], does: "Checks and tells you the connection status." },
      { say: ["refresh the model list"], does: "Reloads the list of models." },
      { say: ["which model are you", "what model is this"], does: "Tells you the model in use." },
      { say: ["next model", "previous model", "switch to model llama"], does: "Changes the model (by position or part of its name)." },
      { say: ["use the coding assistant persona", "next persona"], does: "Switches the persona (system prompt)." },
      { say: ["set temperature to 0.7"], does: "Sets how creative the answers are (0 to 2)." },
      { say: ["start the local model", "stop the local model"], does: "Starts or stops the built-in llama.cpp model." },
      { say: ["open hugging face", "search hugging face for qwen", "close hugging face"], does: "Browses the model store (downloading still needs a click)." }
    ] },
    { group: "Switches (say turn on / turn off / enable / disable)", items: [
      { say: ["turn on autopilot", "turn off autopilot"], does: "Autopilot: the AI keeps working until its plan is done." },
      { say: ["turn on speaking up", "disable proactive mode"], does: "Whether the AI may speak up when you are quiet." },
      { say: ["turn on web search", "disable web search"], does: "Web search." },
      { say: ["enable web reading", "turn off web reading"], does: "Web research with cited sources." },
      { say: ["turn on checking the web", "turn off fact check"], does: "Check the web first for factual questions." },
      { say: ["turn on image generation", "turn off real photos"], does: "Images and photos." },
      { say: ["turn on memory", "turn off memory"], does: "Remembering things across chats." },
      { say: ["turn on auto apply", "turn off auto apply"], does: "Autopilot applies file changes by itself." },
      { say: ["turn on compact mode", "turn off compact mode"], does: "Summarizing old messages in long chats." },
      { say: ["enable running commands", "disable running commands"], does: "Lets the AI propose commands (you still approve each)." },
      { say: ["enable windows tools", "disable windows tools"], does: "Lets the AI open Windows tools." },
      { say: ["enable tab clicking", "disable tab clicking"], does: "Lets the AI click links in a shared tab." },
      { say: ["enable tools", "turn on asking before tools"], does: "AI tools (MCP) and asking before each one runs." },
      { say: ["turn off the wake word", "turn on the wake word", "turn off the beep"], does: "The wake word and its beep." },
      { say: ["change the wake word to jarvis"], does: "Sets a new wake word." },
      { say: ["turn off barge in", "turn on voice stop", "interrupt sensitivity high"], does: "Interrupting by voice." }
    ] },
    { group: "Attach, camera and screen", items: [
      { say: ["attach a file", "add an image"], does: "Opens the file picker (choosing the file still needs the keyboard or mouse)." },
      { say: ["open a project folder"], does: "Opens the folder picker." },
      { say: ["remove the attachments"], does: "Removes files attached to the next message." },
      { say: ["show the camera", "take a picture", "close the camera"], does: "Webcam: open it, snap a still, close it." },
      { say: ["share my screen", "take a screenshot", "stop sharing", "minimize the feed"], does: "Show the AI your screen." }
    ] },
    { group: "Approvals (the cards the AI asks you to confirm)", items: [
      { say: ["allow", "approve", "always allow"], does: "Allows the tool the AI wants to use (or says yes to the pending card)." },
      { say: ["deny", "reject", "skip"], does: "Refuses the pending tool, file change, or command." },
      { say: ["apply the changes", "apply all"], does: "Applies the file changes the AI proposed (old copies are always kept)." },
      { say: ["run the command", "run it"], does: "Runs the command the AI proposed, after you hear it and say yes." },
      { say: ["stop the command"], does: "Stops a command that is running." },
      { say: ["yes", "no"], does: "Answers a question the app just asked you." }
    ] }
  ];

  const api = { parse, parseLink, setLinks: (fn) => { linkNames = fn; }, norm, CATALOG, TOGGLES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LMChatAppCmds = api;
})(typeof window !== "undefined" ? window : null);
