/* Models from Hugging Face: the pop-up opened by "Get models from Hugging Face…" (Settings > Local model) and "Get models…" (first-run guide).
 *
 * Talks to hf-manager.js in the main process through window.oasisProject.hf* (only exists inside the IcyWhite app, so in a normal browser
 * this file does nothing). Everything that comes from Hugging Face (names, descriptions, README text) is untrusted: it is only ever put on
 * the page with textContent / DOM nodes, never as HTML. Nothing outside this file's own dialog is changed, except that it clicks the
 * existing "rescan models" button when a download finishes so the new model shows up in the model list.
 */
(function () {
  "use strict";
  const api = window.oasisProject, dlg = document.getElementById("hfDlg");
  if (!api || typeof api.hfSearch !== "function" || !dlg) return;
  const $ = (id) => document.getElementById(id), body = $("hfBody");

  /* ---------- tiny helpers ---------- */
  function h(tag, props) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k === "style") e.style.cssText = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const list = Array.isArray(arguments[i]) ? arguments[i] : [arguments[i]];
      for (const c of list) { if (c == null || c === false) continue; e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); }
    }
    return e;
  }
  async function call(name) {
    const r = await api[name].apply(api, Array.prototype.slice.call(arguments, 1));
    if (r && r.error) { const e = new Error(r.error); e.code = r.code || ""; throw e; }
    return r;
  }
  const GB = 1073741824, MB = 1048576;
  const fmtBytes = (n) => !(n > 0) ? "—" : n >= GB ? (n / GB).toFixed(n >= 10 * GB ? 0 : 1) + " GB" : n >= MB ? Math.round(n / MB) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const fmtNum = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n || 0);
  const fmtParams = (n) => !n ? "" : n >= 1e9 ? (n / 1e9 >= 10 ? Math.round(n / 1e9) : Math.round(n / 1e8) / 10) + "B" : Math.round(n / 1e6) + "M";
  function fmtAgo(s) {
    const t = Date.parse(s); if (!t) return "";
    const d = Math.floor((Date.now() - t) / 86400000);
    return d < 1 ? "today" : d === 1 ? "yesterday" : d < 31 ? d + " days ago" : d < 365 ? Math.floor(d / 30) + (d < 60 ? " month ago" : " months ago") : Math.floor(d / 365) + (d < 730 ? " year ago" : " years ago");
  }
  const fmtEta = (s) => !(s > 0) ? "" : s < 90 ? "about " + s + " sec left" : s < 5400 ? "about " + Math.round(s / 60) + " min left" : "about " + (s / 3600).toFixed(1) + " h left";
  const fmtSpeed = (b) => b > 0 ? (b >= MB ? (b / MB).toFixed(1) + " MB/s" : Math.round(b / 1024) + " KB/s") : "";
  const baseName = (p) => String(p).split("/").pop();
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  function openLink(url) {
    if (!/^https?:\/\//i.test(String(url))) return;
    try { api.openTab(String(url)); toast("Opened in a new tab. Close this window to see it."); } catch (e) {}
  }
  let toastTimer = null;
  function toast(text) {
    let t = dlg.querySelector(".hf-toast");
    if (!t) { t = h("div", { class: "hf-toast", role: "status" }); dlg.querySelector(".hf").appendChild(t); }
    t.textContent = text; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3800);
  }

  /* ---------- state ---------- */
  const S = { view: "browse", back: "browse", searched: false, items: [], next: "", loading: false, error: "", model: null, modelErr: "", modelLoading: "", modelTab: "files",
    readme: null, cfg: null, hw: null, starters: null, jobs: [], status: {}, visionOn: true, proj: "", notice: null, hint: null, tokenMsg: "", setMsg: "" };
  let seq = 0;

  /* ---------- the "will it fit?" badge ---------- */
  const FIT = {
    gpu: { text: "Fits on GPU", cls: "ok", tip: "All of it fits in your graphics memory. This is the fastest way to run it." },
    partial: { text: "Partly on GPU", cls: "mid", tip: "Part of the model runs on your graphics card and the rest on the CPU. It works, but slower." },
    cpu: { text: "CPU only", cls: "cpu", tip: "It fits in your RAM but not on the graphics card, so it runs on the CPU. Slower." },
    toobig: { text: "Too big", cls: "bad", tip: "It does not fit in your graphics memory plus RAM. Pick a smaller file." }
  };
  const fitBadge = (fit, extra) => { const f = FIT[fit] || FIT.toobig; return h("span", { class: "hf-fit " + f.cls, title: f.tip + (extra ? " " + extra : "") }, f.text); };
  const chip = (text, cls, tip) => h("span", { class: "hf-tag" + (cls ? " " + cls : ""), title: tip || null }, text);

  /* ---------- header: PC summary, buttons, badge ---------- */
  function renderHw() {
    const el = $("hfHw"), hw = S.hw; el.textContent = "";
    if (!hw) { el.hidden = true; return; }
    el.hidden = false;
    let text;
    if (hw.vramKnown) text = "Your PC: " + (hw.gpuName || "graphics card") + " · " + hw.vramGB + " GB graphics memory" + (hw.source ? " (" + hw.source + ")" : "") + " · " + hw.ramGB + " GB RAM";
    else if (hw.hasGpu) text = "Your PC: " + (hw.gpuName || "graphics card") + " (graphics memory not detected) · " + hw.ramGB + " GB RAM. The badges below count the CPU only.";
    else text = "Your PC: no graphics card found · " + hw.ramGB + " GB RAM. Models will run on the CPU.";
    el.appendChild(h("span", { text }));
    if (hw.hasGpu && !hw.vramKnown) el.appendChild(h("button", { type: "button", class: "hf-link", onclick: () => go("settings"), text: "Set graphics memory…" }));
  }
  function renderChrome() {
    const active = S.jobs.filter((j) => ["queued", "downloading", "verifying"].includes(j.status)).length, b = $("hfDlBadge");
    b.hidden = !active; b.textContent = String(active);
    $("hfDlBtn").classList.toggle("on", S.view === "downloads"); $("hfSetBtn").classList.toggle("on", S.view === "settings");
    $("hfFilters").hidden = S.view !== "browse";
    $("hfTitle").textContent = S.view === "downloads" ? "Downloads" : S.view === "settings" ? "Hub settings" : "Models from Hugging Face";
    renderHw();
  }
  function go(view) { if (S.view !== view) { if (view !== "browse" && S.view === "browse" || S.view === "model") S.back = S.view; S.view = view; } render(); }
  function goBack() { S.view = S.back && S.back !== S.view ? S.back : "browse"; S.back = "browse"; render(); }

  /* ---------- browse: starter list + search results ---------- */
  const TIERS = [
    ["fast", "Fast", "Answers quickly and is light on memory. Runs on almost any PC."],
    ["balanced", "Balanced", "Good quality and still quick on a decent PC."],
    ["smart", "Smart", "The most capable. Needs a strong PC with plenty of memory."]
  ];
  function card(onclick, kids) { return h("button", { type: "button", class: "hf-card", onclick }, kids); }
  function renderBrowse() {
    const root = h("div", { class: "hf-browse" });
    if (!S.searched) {
      root.appendChild(h("p", { class: "hf-intro" }, "Not sure where to start? Pick one of these popular models. The label says how it feels to use, and the badge says whether it will run on this PC. You can also search above, or paste a Hugging Face link or ", h("code", null, "user/repo"), "."));
      if (!S.starters) root.appendChild(h("p", { class: "hf-empty", text: "Loading the starter list…" }));
      else for (const [tier, label, sub] of TIERS) {
        const items = S.starters.items.filter((x) => x.tier === tier); if (!items.length) continue;
        root.appendChild(h("h3", { class: "hf-tier" }, label, h("small", { text: sub })));
        root.appendChild(h("div", { class: "hf-grid" }, items.map((s) => card(() => openModel(s.repo), [
          h("div", { class: "hf-card-top" }, h("b", { text: s.title }), s.vision ? chip("Sees images", "vis") : null),
          h("p", { class: "hf-blurb", text: s.blurb }),
          h("div", { class: "hf-meta" }, h("span", { text: "about " + s.approxGB + " GB" }), fitBadge(s.fit, "(Estimate for the usual 4-bit file.)"))
        ]))));
      }
      return root;
    }
    root.appendChild(h("div", { class: "hf-resbar" }, h("button", { type: "button", class: "hf-link", onclick: () => { S.searched = false; S.items = []; S.error = ""; render(); }, text: "← Starter list" })));
    if (S.error) root.appendChild(h("div", { class: "hf-note bad", role: "alert" }, S.error, " ", h("button", { type: "button", class: "hf-link", onclick: () => runSearch(false), text: "Try again" })));
    if (!S.items.length && !S.loading && !S.error) root.appendChild(h("p", { class: "hf-empty", text: "No GGUF models matched. Try fewer filters or a different word." }));
    const list = h("div", { class: "hf-results" });
    for (const m of S.items) {
      list.appendChild(card(() => openModel(m.id), [
        h("div", { class: "hf-card-top" }, h("b", { text: m.name }), h("span", { class: "hf-author", text: m.author }),
          m.gated ? chip("🔒 Gated", "gate", "You must accept this model's licence on huggingface.co (and use a token) before you can download it.") : null,
          m.vision ? chip("Vision", "vis", "Can look at pictures") : null, m.license ? chip(m.license, "", "Licence") : null, m.params ? chip(fmtParams(m.params), "", "Parameters") : null),
        h("div", { class: "hf-meta" }, h("span", { title: "Downloads" }, "⬇ " + fmtNum(m.downloads)), h("span", { title: "Likes" }, "♥ " + fmtNum(m.likes)), m.lastModified ? h("span", { text: "Updated " + fmtAgo(m.lastModified) }) : null)
      ]));
    }
    root.appendChild(list);
    if (S.loading) root.appendChild(h("p", { class: "hf-empty", text: "Searching…" }));
    else if (S.next) root.appendChild(h("div", { class: "hf-more" }, h("button", { type: "button", onclick: () => runSearch(true), text: "Load more" })));
    return root;
  }
  function filters() {
    return { query: $("hfQuery").value.trim(), sort: $("hfSort").value, size: $("hfSize").value, language: $("hfLang").value,
      vision: $("hfVision").getAttribute("aria-pressed") === "true", tools: $("hfTools").getAttribute("aria-pressed") === "true", coding: $("hfCoding").getAttribute("aria-pressed") === "true" };
  }
  async function runSearch(more) {
    S.searched = true; S.view = "browse"; S.back = "browse";
    if (!more) { S.items = []; S.next = ""; }
    S.loading = true; S.error = ""; render();
    const f = filters(); if (more) f.cursor = S.next;
    const my = ++seq;
    try { const r = await call("hfSearch", f); if (my !== seq) return; S.items = more ? S.items.concat(r.items) : r.items; S.next = r.next || ""; }
    catch (e) { if (my !== seq) return; S.error = e.message; }
    S.loading = false; render();
  }
  function syncChips() { const t = $("hfTrending"); t.setAttribute("aria-pressed", $("hfSort").value === "trending" ? "true" : "false"); }
  for (const id of ["hfVision", "hfTools", "hfCoding"]) $(id).addEventListener("click", (e) => { const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); runSearch(false); });
  $("hfTrending").addEventListener("click", () => { $("hfSort").value = $("hfSort").value === "trending" ? "downloads" : "trending"; syncChips(); runSearch(false); });
  for (const id of ["hfSort", "hfSize", "hfLang"]) $(id).addEventListener("change", () => { syncChips(); runSearch(false); });
  $("hfForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("hfQuery").value.trim();
    if (!text) { runSearch(false); return; }
    let r = null; try { r = await call("hfResolve", text); } catch (err) {}
    if (r && r.repo) { openModel(r.repo, r.revision, { quant: r.quant, file: r.file }); return; }   // a link or user/repo: straight to the model
    runSearch(false);
  });

  /* ---------- model page ---------- */
  async function openModel(repo, rev, hint) {
    if (S.view !== "model") S.back = S.view;
    S.view = "model"; S.model = null; S.modelErr = ""; S.modelLoading = repo; S.modelTab = "files"; S.readme = null; S.notice = null; S.hint = hint || null; render();
    try {
      const m = await call("hfModel", repo, rev);
      if (S.modelLoading !== repo) return;
      S.model = m; S.hw = m.hardware || S.hw;
      const pref = ["F16", "BF16", "Q8_0", "F32"]; S.proj = m.mmproj.length ? (pref.map((q) => m.mmproj.find((x) => x.quant === q)).find(Boolean) || m.mmproj[0]).path : "";
      S.visionOn = m.mmproj.length > 0;
    } catch (e) { if (S.modelLoading !== repo) return; S.modelErr = e.message; }
    S.modelLoading = ""; render();
    if (S.model && S.hint) { const el = body.querySelector(".hf-row.hint"); if (el) el.scrollIntoView({ block: "center" }); }
  }
  async function loadReadme() {
    if (!S.model || S.readme) return;
    const id = S.model.id; S.readme = { loading: true }; render();
    try { const r = await call("hfReadme", id, S.model.revision); if (!S.model || S.model.id !== id) return; S.readme = { text: r.text || "" }; }
    catch (e) { S.readme = { error: e.message }; }
    render();
  }
  const jobFor = (m, g) => S.jobs.find((j) => j.repo === m.id && ["queued", "downloading", "verifying", "paused", "done"].includes(j.status) && g.paths.every((p) => j.files.some((f) => f.name === baseName(p))));
  async function startDownload(g) {
    const m = S.model; S.notice = null;
    if (m.gated && !(S.cfg && S.cfg.hasToken)) { S.notice = { cls: "warn", text: "This model is gated. Open it on huggingface.co while signed in, accept its licence, then add a Hugging Face token in Hub settings. Without the token the download is refused.", action: ["Open Hub settings", () => go("settings")] }; render(); return; }
    const files = g.paths.slice(); if (m.mmproj.length && S.visionOn && S.proj) files.push(S.proj);
    try { await call("hfDlAdd", { repo: m.id, revision: m.revision, files, label: m.name + (g.quant ? " · " + g.quant : "") }); toast("Added to Downloads."); await refreshJobs(true); }
    catch (e) { S.notice = { cls: "bad", text: e.message, action: e.code === "auth" || e.code === "forbidden" ? ["Open Hub settings", () => go("settings")] : null }; render(); }
  }
  function renderModel() {
    const root = h("div", { class: "hf-model" });
    root.appendChild(h("button", { type: "button", class: "hf-link hf-back", onclick: goBack, text: "← Back" }));
    if (S.modelLoading) { root.appendChild(h("p", { class: "hf-empty", text: "Loading " + S.modelLoading + "…" })); return root; }
    if (S.modelErr) { root.appendChild(h("div", { class: "hf-note bad", role: "alert" }, S.modelErr)); return root; }
    const m = S.model; if (!m) return root;
    const sizes = m.files.map((f) => f.size).filter(Boolean);
    root.appendChild(h("div", { class: "hf-mhead" },
      h("div", null, h("h3", { class: "hf-mname", text: m.name }),
        h("div", { class: "hf-msub" }, "by ", h("button", { type: "button", class: "hf-link", onclick: () => openLink(m.url.replace(/\/[^/]+\/[^/]+$/, "/" + m.author)), text: m.author }), " · ",
          h("button", { type: "button", class: "hf-link", onclick: () => openLink(m.url), text: "View on huggingface.co" }))),
      h("div", { class: "hf-tags" }, m.gated ? chip("🔒 Gated", "gate", "Needs an accepted licence and a token") : null, m.hasVision ? chip("Vision", "vis") : null, m.isPrivate ? chip("Private") : null)));
    root.appendChild(h("dl", { class: "hf-facts" },
      fact("Licence", m.license || "not stated"), fact("Size", sizes.length ? (Math.min.apply(null, sizes) === Math.max.apply(null, sizes) ? fmtBytes(sizes[0]) : fmtBytes(Math.min.apply(null, sizes)) + " – " + fmtBytes(Math.max.apply(null, sizes))) : "—"),
      fact("Downloads", fmtNum(m.downloads)), fact("Likes", fmtNum(m.likes)), fact("Last updated", m.lastModified ? fmtAgo(m.lastModified) + " (" + String(m.lastModified).slice(0, 10) + ")" : "—"),
      m.params ? fact("Parameters", fmtParams(m.params)) : null, m.arch ? fact("Architecture", m.arch) : null, m.contextLength ? fact("Context", fmtNum(m.contextLength) + " tokens") : null));
    if (m.gated) root.appendChild(h("div", { class: "hf-note warn" }, h("b", null, "Gated model. "), "The author asks you to accept a licence before downloading. On huggingface.co, open this model while signed in and accept it, then add a token in Hub settings. ", S.cfg && S.cfg.hasToken ? "A token is saved." : "No token is saved yet. ",
      h("button", { type: "button", class: "hf-link", onclick: () => go("settings"), text: "Hub settings" })));
    if (S.notice) root.appendChild(h("div", { class: "hf-note " + S.notice.cls, role: "alert" }, S.notice.text, " ", S.notice.action ? h("button", { type: "button", class: "hf-link", onclick: S.notice.action[1], text: S.notice.action[0] }) : null));
    root.appendChild(h("div", { class: "hf-tabs", role: "tablist" },
      h("button", { type: "button", role: "tab", "aria-selected": S.modelTab === "files" ? "true" : "false", onclick: () => { S.modelTab = "files"; render(); }, text: "Files (" + m.files.length + ")" }),
      h("button", { type: "button", role: "tab", "aria-selected": S.modelTab === "about" ? "true" : "false", onclick: () => { S.modelTab = "about"; render(); loadReadme(); }, text: "About (README)" })));
    root.appendChild(S.modelTab === "about" ? renderAbout() : renderFiles(m));
    return root;
  }
  const fact = (k, v) => h("div", null, h("dt", { text: k }), h("dd", { text: v }));
  function renderFiles(m) {
    const root = h("div", { class: "hf-files" });
    root.appendChild(h("p", { class: "hf-intro" }, "Pick one file. The name tells you how much it is squeezed: bigger numbers (Q6, Q8, F16) are higher quality but need more memory; ", h("b", null, "Q4_K_M"), " is a good default. The badge says whether the file will run well on this PC."));
    if (m.mmproj.length) {
      const sel = h("select", { "aria-label": "Vision file", onchange: (e) => { S.proj = e.target.value; } }, m.mmproj.map((x) => h("option", { value: x.path, selected: x.path === S.proj }, (x.quant || "vision") + " · " + fmtBytes(x.size) + " · " + x.name)));
      root.appendChild(h("div", { class: "hf-vision" },
        h("label", { class: "hf-check" }, h("input", { type: "checkbox", checked: S.visionOn, onchange: (e) => { S.visionOn = e.target.checked; sel.disabled = !S.visionOn; } }), " Also download the vision file so the model can look at images ", h("small", { text: "(needed for pictures; an extra " + fmtBytes((m.mmproj.find((x) => x.path === S.proj) || m.mmproj[0]).size) + ")" })), sel));
      sel.disabled = !S.visionOn;
    }
    if (!m.files.length) { root.appendChild(h("p", { class: "hf-empty", text: "This repository has no complete GGUF model files." })); return root; }
    const list = h("div", { class: "hf-rows", role: "list" });
    for (const g of m.files) {
      const job = jobFor(m, g), hinted = S.hint && ((S.hint.quant && g.quant === S.hint.quant) || (S.hint.file && g.paths.includes(S.hint.file)));
      let btn;
      if (job && job.status === "done") btn = h("button", { type: "button", disabled: true, class: "hf-have", text: "Downloaded ✓" });
      else if (job) btn = h("button", { type: "button", onclick: () => { go("downloads"); }, text: job.status === "paused" ? "Paused (see Downloads)" : "In Downloads" });
      else btn = h("button", { type: "button", class: "primary", onclick: () => startDownload(g), text: "Download" });
      list.appendChild(h("div", { class: "hf-row" + (hinted ? " hint" : "") + (g.recommended ? " rec" : ""), role: "listitem" },
        h("div", { class: "hf-q" }, h("b", { text: g.quant || "GGUF" }), g.recommended ? chip("Best for your PC", "rec", "The highest quality that runs well on this PC") : null,
          h("small", { text: g.note || "" }), h("small", { class: "hf-fn", text: g.name })),
        h("div", { class: "hf-size" }, h("b", { text: fmtBytes(g.size) }), g.parts > 1 ? h("small", { text: g.parts + " parts, downloaded together" }) : null),
        h("div", { class: "hf-fitc" }, fitBadge(g.fit)), h("div", { class: "hf-act" }, btn)));
    }
    root.appendChild(list);
    root.appendChild(h("p", { class: "hf-foot", text: "Files are saved to your models folder and checked against the SHA-256 that Hugging Face publishes. The fit badge is an estimate: it counts the file plus working memory for a normal-length chat." }));
    return root;
  }
  function renderAbout() {
    const r = S.readme, root = h("div", { class: "hf-about" });
    if (!r || r.loading) root.appendChild(h("p", { class: "hf-empty", text: "Loading the model card…" }));
    else if (r.error) root.appendChild(h("div", { class: "hf-note bad" }, r.error));
    else if (!r.text.trim()) root.appendChild(h("p", { class: "hf-empty", text: "This model has no description." }));
    else root.appendChild(renderMd(r.text));
    return root;
  }

  /* ---------- README (markdown) -> DOM. Only a safe subset; links open in a new IcyWhite tab; images are never loaded. ---------- */
  function inline(text) {
    const out = [], re = /(`[^`\n]+`)|(!?\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*)|(https?:\/\/[^\s<>)\]"]+)/g;
    let last = 0, m;
    const link = (label, url) => h("a", { href: "#", class: "hf-a", title: url, onclick: (e) => { e.preventDefault(); openLink(url); } }, label);
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) out.push(h("code", { text: m[1].slice(1, -1) }));
      else if (m[2]) {
        const mm = /^(!?)\[([^\]]*)\]\(([^)\s]+)/.exec(m[2]);
        if (mm[1]) out.push(mm[2] ? "[image: " + mm[2] + "]" : ""); else out.push(/^https?:\/\//i.test(mm[3]) ? link(mm[2] || mm[3], mm[3]) : mm[2]);
      } else if (m[3]) out.push(h("strong", null, inline(m[3].slice(2, -2))));
      else if (m[4]) out.push(h("em", null, inline(m[4].slice(1, -1))));
      else if (m[5]) out.push(link(m[5], m[5]));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function renderMd(src) {
    const root = h("div", { class: "hf-md" });
    const lines = String(src).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n").split("\n").slice(0, 4000);
    const strip = (t) => t.replace(/<[^>\n]*>/g, "");
    const isBlock = (l) => /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = /^\s*(```|~~~)/.exec(l))) {
        const buf = []; i++;
        while (i < lines.length && !new RegExp("^\\s*" + m[1]).test(lines[i])) buf.push(lines[i++]);
        i++; root.appendChild(h("pre", null, h("code", { text: buf.join("\n") }))); continue;
      }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { root.appendChild(h("h" + Math.min(6, m[1].length + 2), null, inline(strip(m[2])))); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { root.appendChild(h("hr")); i++; continue; }
      if (l.indexOf("|") >= 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") >= 0) rows.push(cells(lines[i++]));
        root.appendChild(h("div", { class: "hf-tablewrap" }, h("table", null, h("thead", null, h("tr", null, head.map((c) => h("th", null, inline(strip(c)))))),
          h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, inline(strip(c))))))))));
        continue;
      }
      if (/^\s*>/.test(l)) {
        const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        root.appendChild(h("blockquote", null, inline(strip(buf.join(" "))))); continue;
      }
      if ((m = /^(\s*)([-*+]|\d+[.)])\s+/.exec(l))) {
        const ordered = /\d/.test(m[2]), list = h(ordered ? "ol" : "ul");
        while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]))) {
          list.appendChild(h("li", { style: m[1].length >= 2 ? "margin-left:" + Math.min(4, Math.floor(m[1].length / 2)) * 16 + "px" : null }, inline(strip(m[3])))); i++;
        }
        root.appendChild(list); continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && (!isBlock(lines[i]) || !buf.length)) buf.push(lines[i++].trim());
      const t = strip(buf.join(" ")).trim();
      if (t) root.appendChild(h("p", null, inline(t)));
    }
    return root;
  }

  /* ---------- downloads ---------- */
  const STATUS = { queued: "Waiting in line", downloading: "Downloading", verifying: "Checking the file (SHA-256)", paused: "Paused", error: "Failed", done: "Done", canceled: "Canceled" };
  const refs = new Map();
  let dlSig = "";
  function jobButtons(j) {
    const b = (text, fn, cls) => h("button", { type: "button", class: cls || null, onclick: fn, text });
    const act = (name) => async () => { try { await call(name, j.id); } catch (e) { toast(e.message); } refreshJobs(true); };
    const out = [];
    if (j.status === "downloading" || j.status === "verifying") out.push(b("Pause", act("hfDlPause")), b("Cancel", () => confirmCancel(j)));
    else if (j.status === "queued") out.push(b("Pause", act("hfDlPause")), b("Cancel", () => confirmCancel(j)));
    else if (j.status === "paused") out.push(b("Resume", act("hfDlResume"), "primary"), b("Cancel", () => confirmCancel(j)));
    else if (j.status === "error") out.push(b("Retry", act("hfDlRetry"), "primary"), b("Cancel", () => confirmCancel(j)));
    else if (j.status === "canceled") out.push(b("Start again", act("hfDlRetry")), b("Remove", act("hfDlRemove")));
    else if (j.status === "done") out.push(b("Use this model", () => useModel(j), "primary"), b("Open folder", async () => { try { await call("hfDlOpen", j.id); } catch (e) { toast(e.message); } }), b("Remove from list", act("hfDlRemove")));
    return out;
  }
  function confirmCancel(j) {
    if (j.bytesDone > 50 * MB && !window.confirm("Cancel this download? The " + fmtBytes(j.bytesDone) + " already downloaded will be deleted.")) return;
    call("hfDlCancel", j.id).catch((e) => toast(e.message)).then(() => refreshJobs(true));
  }
  async function useModel(j) {
    try {
      const first = j.files.find((f) => f.kind === "model") || j.files[0];
      const rl = $("llamaRefresh"); if (rl) { rl.click(); await new Promise((r) => setTimeout(r, 700)); }
      const L = await call("llamaModels"), hit = (L.models || []).find((m) => m.id.endsWith("/" + first.name) || m.id === first.name);
      if (!hit) { toast("The model is in your list under Settings > Local model. Pick it there and press Start & use."); return; }
      dlg.close();
      if (window.oasisLlama && window.oasisLlama.start) window.oasisLlama.start(hit.id);
    } catch (e) { toast("Pick it in Settings > Local model and press Start & use. (" + e.message + ")"); }
  }
  function jobCard(j) {
    const r = {};
    r.status = h("span", { class: "hf-st" }); r.bar = h("div", { class: "hf-bar-fill" }); r.text = h("div", { class: "hf-dltext" }); r.err = h("div", { class: "hf-dlerr", role: "alert" });
    const files = h("div", { class: "hf-dlfiles", text: j.files.length + (j.files.length > 1 ? " files: " : " file: ") + j.files.map((f) => f.name).join(", ") });
    const el = h("div", { class: "hf-job" }, h("div", { class: "hf-jobtop" }, h("div", null, h("b", { text: j.label }), h("small", { text: j.repo })), r.status),
      h("div", { class: "hf-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, r.bar), r.text, r.err, files, h("div", { class: "hf-jobact" }, jobButtons(j)));
    r.el = el; refs.set(j.id, r); return el;
  }
  function updateJob(j) {
    const r = refs.get(j.id); if (!r) return;
    r.status.textContent = j.status === "verifying" ? STATUS.verifying + " " + (j.verifyPct || 0) + "%" : STATUS[j.status] || j.status; r.status.className = "hf-st " + j.status;
    r.bar.style.width = (j.status === "verifying" ? 100 : j.pct) + "%"; r.bar.className = "hf-bar-fill " + j.status; r.el.querySelector(".hf-progress").setAttribute("aria-valuenow", String(Math.round(j.pct)));
    const parts = [fmtBytes(j.bytesDone) + " of " + fmtBytes(j.bytesTotal) + " (" + Math.floor(j.pct) + "%)"];
    if (j.status === "downloading") { if (j.speed) parts.push(fmtSpeed(j.speed)); if (j.etaSec) parts.push(fmtEta(j.etaSec)); if (j.current && j.files.length > 1) parts.push("now: " + j.current); }
    if (j.status === "done") parts.length = 0, parts.push(fmtBytes(j.bytesTotal) + (j.files.every((f) => f.verified) ? " · checksum verified ✓" : "") + " · saved in " + j.dir);
    if (j.note) parts.push(j.note);
    r.text.textContent = parts.join(" · "); r.err.textContent = j.status === "error" ? j.error : "";
  }
  function renderDownloads() {
    const root = h("div", { class: "hf-dls" });
    refs.clear();
    root.appendChild(h("div", { class: "hf-dltop" }, h("button", { type: "button", class: "hf-link hf-back", onclick: goBack, text: "← Back" }),
      h("span", { class: "hf-spacer" }), h("button", { type: "button", onclick: async () => { try { await call("hfDlClear"); } catch (e) {} refreshJobs(true); }, text: "Clear finished" })));
    if (!S.jobs.length) root.appendChild(h("p", { class: "hf-empty", text: "No downloads yet. Pick a model and press Download. Downloads you pause or interrupt (even by closing IcyWhite) continue where they stopped." }));
    for (const j of S.jobs) { root.appendChild(jobCard(j)); updateJob(j); }
    return root;
  }

  /* ---------- Hub settings ---------- */
  function renderSettings() {
    const c = S.cfg || {}, root = h("div", { class: "hf-set" });
    const save = async (patch, label) => { try { S.cfg = await call("hfConfigSet", patch); S.setMsg = (label || "Saved") + "."; S.hw = null; try { S.hw = await call("hfHardware"); } catch (e) {} } catch (e) { S.setMsg = e.message; } render(); };
    const field = (label, input, hint) => h("label", { class: "hf-field" }, h("span", { text: label }), input, hint ? h("small", { text: hint }) : null);
    root.appendChild(h("button", { type: "button", class: "hf-link hf-back", onclick: goBack, text: "← Back" }));
    const tok = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: c.hasToken ? "A token is saved (hidden)" : "hf_…" });
    root.appendChild(h("div", { class: "hf-block" }, h("h3", { text: "Hugging Face access token" }),
      h("p", { class: "hf-intro" }, "Only needed for gated or private models (marked with a lock). Do this once: ", h("b", null, "1)"), " on huggingface.co open the model and accept its licence while signed in. ", h("b", null, "2)"), " create a token with ", h("i", null, "read"), " access. ", h("b", null, "3)"), " paste it here. It is stored encrypted with your system's secure storage (Electron safeStorage), never as plain text, and is only sent to the Hub address below."),
      c.canEncrypt === false ? h("div", { class: "hf-note warn" }, "Secure storage is not available on this computer, so a token cannot be saved safely and will be refused.") : null,
      h("div", { class: "hf-inline" }, tok,
        h("button", { type: "button", class: "primary", onclick: async () => { try { S.cfg = await call("hfTokenSet", tok.value); tok.value = ""; S.tokenMsg = S.cfg.hasToken ? "Token saved (encrypted)." : "Token removed."; } catch (e) { S.tokenMsg = e.message; } render(); }, text: "Save token" }),
        c.hasToken ? h("button", { type: "button", onclick: async () => { try { S.cfg = await call("hfTokenSet", ""); S.tokenMsg = "Token removed."; } catch (e) { S.tokenMsg = e.message; } render(); }, text: "Remove" }) : null,
        c.hasToken ? h("button", { type: "button", onclick: async () => { S.tokenMsg = "Testing…"; render(); try { const w = await call("hfTokenTest"); S.tokenMsg = "Token works. Signed in as " + (w.name || "your account") + "."; } catch (e) { S.tokenMsg = e.message; } render(); }, text: "Test" }) : null,
        h("button", { type: "button", onclick: () => openLink("https://huggingface.co/settings/tokens"), text: "Open huggingface.co/settings/tokens" })),
      h("small", { class: "hf-msg", role: "status", text: S.tokenMsg })));
    const ep = h("input", { value: c.endpoint || "", spellcheck: "false", placeholder: c.defaultEndpoint || "https://huggingface.co" });
    const px = h("input", { value: c.proxy || "", spellcheck: "false", placeholder: "e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:1080 (blank = system settings)" });
    const sp = h("input", { type: "number", min: "0", step: "0.5", value: String(c.speedLimitMBps || 0) });
    const vr = h("input", { type: "number", min: "0", step: "1", value: String(c.vramOverrideGB || 0) });
    const mc = h("select", null, h("option", { value: "1", selected: c.maxConcurrent !== 2 }, "1 (one at a time)"), h("option", { value: "2", selected: c.maxConcurrent === 2 }, "2 at the same time"));
    root.appendChild(h("div", { class: "hf-block" }, h("h3", { text: "Network" }),
      field("Hub address (mirror)", ep, "Leave as the default unless huggingface.co is blocked for you. Use a mirror such as https://hf-mirror.com. Your token is only sent to this address."),
      field("Proxy", px, "Used for the Hugging Face search and downloads only."),
      h("div", { class: "hf-two" }, field("Speed limit (MB/s, 0 = unlimited)", sp, "Shared between running downloads."), field("Downloads at once", mc)),
      h("div", { class: "hf-inline" }, h("button", { type: "button", class: "primary", onclick: () => save({ endpoint: ep.value, proxy: px.value, speedLimitMBps: sp.value, maxConcurrent: mc.value }, "Network settings saved"), text: "Save network settings" }),
        h("button", { type: "button", onclick: () => { ep.value = c.defaultEndpoint || "https://huggingface.co"; }, text: "Use the default address" }))));
    root.appendChild(h("div", { class: "hf-block" }, h("h3", { text: "Downloads and this PC" }),
      h("label", { class: "hf-check" }, h("input", { type: "checkbox", checked: c.verify !== false, onchange: (e) => save({ verify: e.target.checked }) }), " Check every file against the SHA-256 Hugging Face publishes (recommended; a corrupted file is thrown away)"),
      h("label", { class: "hf-check" }, h("input", { type: "checkbox", checked: c.notify !== false, onchange: (e) => save({ notify: e.target.checked }) }), " Show a notification when a download finishes"),
      field("Graphics memory (VRAM) in GB, 0 = detect automatically", vr, "Only needed if the badges say your graphics memory was not detected (some AMD / Intel cards), or to try a different number."),
      h("div", { class: "hf-inline" }, h("button", { type: "button", onclick: () => save({ vramOverrideGB: vr.value }, "Graphics memory saved"), text: "Save graphics memory" }))));
    root.appendChild(h("small", { class: "hf-msg", role: "status", text: S.setMsg }));
    return root;
  }

  /* ---------- render + polling ---------- */
  function render() {
    const keep = body.scrollTop;
    body.textContent = "";
    body.appendChild(S.view === "model" ? renderModel() : S.view === "downloads" ? renderDownloads() : S.view === "settings" ? renderSettings() : renderBrowse());
    body.scrollTop = keep;
    renderChrome();
  }
  async function refreshJobs(force) {
    let r; try { r = await call("hfDlList"); } catch (e) { return; }
    const jobs = r.jobs || [], sig = jobs.map((j) => j.id + ":" + j.status).join("|");
    for (const j of jobs) {
      const prev = S.status[j.id];
      if (prev && prev !== j.status) {
        if (j.status === "done") { toast(j.label + " finished downloading."); const rl = $("llamaRefresh"); if (rl) try { rl.click(); } catch (e) {} }
        else if (j.status === "error") toast(j.label + " failed: " + j.error);
      }
      S.status[j.id] = j.status;
    }
    S.jobs = jobs;
    if (force || sig !== dlSig) { dlSig = sig; if (dlg.open && (S.view === "downloads" || S.view === "model")) render(); else renderChrome(); }
    else if (dlg.open && S.view === "downloads") { jobs.forEach(updateJob); renderChrome(); }
    else if (dlg.open) renderChrome();
  }
  let pollTimer = null;
  function schedule() {
    if (pollTimer) return;
    const active = S.jobs.some((j) => ["queued", "downloading", "verifying"].includes(j.status));
    const delay = dlg.open ? (active ? 800 : 3000) : (active ? 3000 : 0);
    if (delay) pollTimer = setTimeout(async () => { pollTimer = null; await refreshJobs(false); schedule(); }, delay);
  }

  async function openHub() {
    if (!dlg.open) dlg.showModal();
    $("hfQuery").focus();
    render();
    try { S.cfg = await call("hfConfigGet"); } catch (e) {}
    try { const r = await call("hfStarters"); S.starters = r; S.hw = r.hardware; } catch (e) { S.starters = { items: [] }; }
    await refreshJobs(true); schedule();
    render();
  }
  $("hfClose").addEventListener("click", () => dlg.close());
  $("hfDlBtn").addEventListener("click", () => { S.view === "downloads" ? goBack() : go("downloads"); });
  $("hfSetBtn").addEventListener("click", () => { S.setMsg = ""; S.tokenMsg = ""; S.view === "settings" ? goBack() : go("settings"); });
  dlg.addEventListener("close", () => { schedule(); });
  for (const id of ["hfOpen", "wlGetModels"]) { const b = $(id); if (b) b.addEventListener("click", openHub); }
  window.oasisHfHub = { open: openHub };
  refreshJobs(false).then(schedule);   // pick up unfinished downloads from before (they wait paused until you press Resume)
})();
