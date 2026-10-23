/* Writes what happens between the app and the AI server (LM Studio, Ollama or the local llama.cpp engine) into the Debug log,
   in the same style as the LM Studio server log: the request that was sent (long texts shortened), the model's name, how long
   the prompt took, tokens per second while it writes, the timing summary and when it finished.
   It only watches the AI server's own addresses (chat, models, props...). It never changes a request or an answer. */
(function () {
  "use strict";
  if (window.__icyNetLog || !window.fetch || !window.OasisDebug) return;
  window.__icyNetLog = true;
  const orig = window.fetch.bind(window);
  const AI_PATH = /\/(?:v1\/)?(?:chat\/completions|completions|embeddings|models)\/?$|\/api\/v0\/(?:models|chat\/completions)\/?$|\/props$|\/health$|\/api\/(?:tags|chat|generate|show|version)$/;
  const CHAT_PATH = /\/(?:chat\/completions|completions)\/?$|\/api\/(?:chat|generate)$/;
  const PROBE_PATH = /\/props$|\/health$|\/api\/v0\/models|\/api\/(?:tags|show|version)$/;
  const lastSeen = {};

  const L = (level, msg, multi) => { try { window.OasisDebug.log(level, msg, !!multi); } catch (e) {} };
  const cut = (s) => (s.length > 100 ? s.slice(0, 50) + "... <Truncated in logs> ..." + s.slice(-50) : s);
  const pretty = (o) => { try { return JSON.stringify(o, (k, v) => (typeof v === "string" ? cut(v) : v), 2); } catch (e) { return String(o); } };
  const secs = (ms) => (ms / 1000).toFixed(2);
  const rate = (n, ms) => (ms > 0 ? (n / (ms / 1000)).toFixed(2) : "0.00");
  const charsIn = (messages) => (messages || []).reduce((a, m) => {
    const c = m && m.content;
    if (typeof c === "string") return a + c.length;
    if (Array.isArray(c)) return a + c.reduce((b, p) => b + (p && p.type === "text" && typeof p.text === "string" ? p.text.length : 0), 0);
    return a;
  }, 0);

  window.fetch = function (input, init) {
    let u = null;
    try { u = new URL(typeof input === "string" ? input : (input && input.url) || String(input), location.href); } catch (e) {}
    if (!u || !/^https?:$/.test(u.protocol) || !AI_PATH.test(u.pathname)) return orig(input, init);
    try { return traced(u, input, init); } catch (e) { return orig(input, init); }
  };

  async function traced(u, input, init) {
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    let body = null;
    try { if (init && typeof init.body === "string") body = JSON.parse(init.body); } catch (e) {}
    const isChat = method === "POST" && CHAT_PATH.test(u.pathname);
    const stream = !!(body && body.stream);
    const t0 = performance.now();
    let name = (body && body.model) || window.__icyModel || "model";
    const estChars = body ? charsIn(body.messages) : 0, estTokens = Math.round(estChars / 4);

    // The same request again within 30 seconds (the app re-checks the model list when you return to it): say it once.
    let quiet = false;
    if (!isChat) { const k = method + " " + u.pathname; quiet = Date.now() - (lastSeen[k] || 0) < 30000; lastSeen[k] = Date.now(); }

    if (isChat && body) {
      L("info", "Received request: POST to " + u.pathname + " with body  " + pretty(body), true);
      L("info", "[" + name + "] Running chat completion on conversation with " + (Array.isArray(body.messages) ? body.messages.length : 0) + " messages (about " + estTokens + " tokens, " + estChars + " characters).");
      if (stream) L("info", "[" + name + "] Streaming response...");
    } else if (!quiet) L("info", "Received request: " + method + " to " + u.pathname + (body ? " with body  " + pretty(body) : ""), !!body);

    let waitTimer = 0;
    if (isChat && stream) waitTimer = setInterval(() => L("info", "[" + name + "] Prompt processing... " + secs(performance.now() - t0) + " s so far, no tokens yet."), 4000);
    const stopWait = () => { if (waitTimer) { clearInterval(waitTimer); waitTimer = 0; } };

    let r;
    try { r = await orig(input, init); }
    catch (e) {
      stopWait();
      if (e && e.name === "AbortError") L("warn", (isChat ? "[" + name + "] " : "") + "Request to " + u.pathname + " cancelled after " + secs(performance.now() - t0) + " s (stopped by you or the app).");
      else L("error", "Request to " + u.origin + u.pathname + " failed after " + secs(performance.now() - t0) + " s: " + ((e && e.message) || e) + ". Is the server running and is CORS turned on?");
      throw e;
    }

    try {
      if (!r.ok) {
        stopWait();
        const status = r.status;
        r.clone().text().then((t) => {
          const msg = "Server replied HTTP " + status + " to " + method + " " + u.pathname + " after " + secs(performance.now() - t0) + " s" + (t ? ": " + t.replace(/\s+/g, " ").slice(0, 600) : ".");
          if (!isChat && PROBE_PATH.test(u.pathname)) L("info", msg + " (optional address, normal for some servers)");
          else L(isChat ? "error" : "warn", (isChat ? "[" + name + "] " : "") + msg);
        }).catch(() => {});
        return r;
      }
      if (isChat && stream) { monitor(r.clone(), name, t0, estTokens, stopWait); return r; }
      stopWait();
      const ct = String(r.headers.get("content-type") || "");
      if (!/json/i.test(ct)) { if (!quiet) L("info", "Returning HTTP " + r.status + " for " + u.pathname + " (" + secs(performance.now() - t0) + " s)"); return r; }
      r.clone().json().then((j) => {
        if (isChat) {
          const ch = j && j.choices && j.choices[0];
          const us = (j && j.usage) || {};
          if (j && j.model) window.__icyModel = j.model;
          L("info", "[" + ((j && j.model) || name) + "] Finished chat completion in " + secs(performance.now() - t0) + " s" + (us.prompt_tokens != null ? " (prompt " + us.prompt_tokens + " tokens, generated " + us.completion_tokens + " tokens)" : "") + (ch && ch.finish_reason ? ", finish reason: " + ch.finish_reason : "") + ".");
        } else if (/models\/?$/.test(u.pathname) || /\/api\/tags$/.test(u.pathname)) {
          const ids = ((j && (j.data || j.models)) || []).map((m) => m && (m.id || m.name)).filter((id) => id && !/embed/i.test(id));
          if (ids.length && !window.__icyModel) window.__icyModel = ids[0];
          if (!quiet) L("info", "Returning " + pretty(j), true);
        } else if (!quiet) L("info", "Returning HTTP " + r.status + " for " + u.pathname + " (" + secs(performance.now() - t0) + " s): " + cut(JSON.stringify(j)));
      }).catch(() => {});
    } catch (e) { stopWait(); }
    return r;
  }

  // Follows a copy of the streamed answer and reports speed and timing; the app reads the original untouched.
  async function monitor(resp, name, t0, estPrompt, stopWait) {
    let n = 0, tFirst = 0, lastT = 0, lastN = 0, lastTick = 0, usage = null, timings = null, finish = "", model = "";
    try {
      const reader = resp.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const d = t.slice(5).trim();
          if (!d || d === "[DONE]") continue;
          let j; try { j = JSON.parse(d); } catch (e) { continue; }
          if (j.model && !model) { model = j.model; window.__icyModel = model; name = model; }
          if (j.usage) usage = j.usage;
          if (j.timings) timings = j.timings;
          const ch = j.choices && j.choices[0];
          if (!ch) continue;
          const dl = ch.delta || {};
          if (ch.finish_reason) finish = ch.finish_reason;
          if (dl.content || dl.reasoning_content || dl.reasoning) {
            const now = performance.now();
            n++;
            if (!tFirst) {
              tFirst = now; lastT = now; lastTick = now; stopWait();
              L("info", "[" + name + "] Prompt processing done in " + secs(now - t0) + " s (about " + estPrompt + " tokens, ~" + rate(estPrompt, now - t0) + " tokens per second). First token received.");
            } else if (now - lastTick >= 3000) {
              L("info", "[" + name + "] Generating: n_gen = " + n + ", tg = " + rate(n, now - tFirst) + " t/s, tg_3s = " + rate(n - lastN, now - lastT) + " t/s");
              lastTick = now; lastT = now; lastN = n;
            }
          }
        }
      }
    } catch (e) {
      stopWait();
      L("warn", "[" + name + "] Stream stopped after " + secs(performance.now() - t0) + " s with " + n + " tokens received (" + ((e && e.name === "AbortError") ? "stopped by you or the app" : (e && e.message) || "connection closed") + ").");
      return;
    }
    stopWait();
    const end = performance.now();
    const pn = timings && timings.prompt_n != null ? timings.prompt_n : usage && usage.prompt_tokens != null ? usage.prompt_tokens : estPrompt;
    const gn = timings && timings.predicted_n != null ? timings.predicted_n : usage && usage.completion_tokens != null ? usage.completion_tokens : n;
    const exact = !!(timings || usage), tilde = exact ? "" : "~";
    const pms = timings && timings.prompt_ms != null ? timings.prompt_ms : (tFirst ? tFirst - t0 : end - t0);
    const gms = timings && timings.predicted_ms != null ? timings.predicted_ms : (tFirst ? end - tFirst : 0);
    L("info",
      "[" + name + "] Timing" + (exact ? "" : " (token counts estimated from the stream)") + ":\n" +
      "  prompt eval time = " + pms.toFixed(2) + " ms / " + tilde + pn + " tokens (" + (pn ? (pms / pn).toFixed(2) : "0") + " ms per token, " + rate(pn, pms) + " tokens per second)\n" +
      "         eval time = " + gms.toFixed(2) + " ms / " + tilde + gn + " tokens (" + (gn ? (gms / gn).toFixed(2) : "0") + " ms per token, " + rate(gn, gms) + " tokens per second)\n" +
      "        total time = " + (end - t0).toFixed(2) + " ms / " + tilde + (pn + gn) + " tokens", true);
    L("info", "[" + name + "] Finished streaming response" + (finish ? " (finish reason: " + finish + ")" : "") + ".");
  }
})();
