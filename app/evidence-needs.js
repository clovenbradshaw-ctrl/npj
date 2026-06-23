/* evidence-needs.js — for each ungrounded claim, the *negative space*: what TYPE
   of evidence would fill the gap.

   Not the proposition, not the sentence — the kind of record a checker would go
   find. Coarse on purpose ("an official filing", "a dated record", "the cited
   source on the record"), never prescriptive ("an email from X on Tuesday").

   Two rungs, same idiom as CiteyVoice's LLM ladder:
     · classify(text)  — MECHANICAL, instant, pure. Reads cues (quotation marks,
       legal/governmental verbs, figures, attribution, dates) and names an
       evidence type. Always available; this is the default the export ships.
     · needMany(texts) — optionally SHARPENED by a local LLM (Ollama by default,
       or any fn set via setLLM). One batched call; on any failure it falls back
       to classify() for every claim, so the list always renders.

   No claim is ever judged here — only what would let someone else judge it.

   UMD: window.NpjEvidence in the browser, module.exports in node (the mechanical
   classifier + the ladder logic are unit-tested without a model or a network).
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjEvidence = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // ---- the mechanical read: cues → an evidence type (priority order) ----
  var RULES = [
    // a verbatim quotation needs its source document/recording
    { type: "quote", test: /["“][^"”]{8,}["”]|\bsaid:?\s*["“]/, label: "a source for the quoted words (the document or recording)" },
    // suits, allegations, permits, statutes → the official paper
    { type: "legal", test: /\b(sued?|suit|lawsuit|alleg\w*|filed|court|defendant|negligen\w*|permit|ordinance|statute|by law|legal opinion|complaint)\b/i, label: "an official document (court filing, permit, or ordinance)" },
    // votes, approvals, budgets, council action → the meeting/budget record
    { type: "official", test: /\b(vote[ds]?|approv\w*|reject\w*|council|committee|budget|hearing|motion|resolution|agenda)\b/i, label: "an official record (the vote, agenda, or budget document)" },
    // someone is quoted/paraphrased → that source, on the record
    { type: "attribution", test: /\b(according to|said|says|stated?|asserts?|acknowledg\w*|reportedly|records?|told|confirmed|claim(s|ed)?|denie[ds]|alleg\w*)\b/i, label: "the cited source, on the record" },
    // numbers, money, percentages, counts → the underlying figures
    { type: "figures", test: /(\$\s?\d|\b\d+(\.\d+)?\s?(%|percent)\b|\b\d{2,}\b|\b(million|billion|thousand)\b)/i, label: "the underlying figures (data, budget, or official count)" },
    // a dated happening → a contemporaneous, dated record
    { type: "dated", test: /\b(last week|last year|yesterday|this year|months? later|days? (after|later)|recently|prior to|in (19|20)\d{2}|\b(19|20)\d{2}\b|on (mon|tue|wed|thu|fri|sat|sun))/i, label: "a dated record of the event" }
  ];
  function classify(text) {
    var t = clean(text);
    for (var i = 0; i < RULES.length; i++) if (RULES[i].test.test(t)) return { type: RULES[i].type, label: RULES[i].label };
    return { type: "general", label: "a source that confirms this" };
  }

  // ---- the optional sharpen rung: a local LLM names the evidence type ----
  // Pluggable: setLLM(fn) where fn(claims, opts) -> Promise<string[] | null>.
  // Default is a best-effort batched Ollama call. Any failure → null → caller
  // falls back to classify(), so the model is never load-bearing.
  var _customLLM = null;
  function setLLM(fn) { _customLLM = (typeof fn === "function") ? fn : null; }

  function ollamaBase() { return (typeof window !== "undefined" && window.NPJ_OLLAMA_URL) || "http://localhost:11434"; }
  function ollamaModel() { return (typeof window !== "undefined" && window.NPJ_OLLAMA_MODEL) || "llama3.2"; }

  var BATCH_PROMPT =
    "You help a fact-checker triage claims. For each NUMBERED claim below, name ONLY the general TYPE " +
    "of source or record that would let someone verify it — a category such as \"court filing\", \"meeting " +
    "minutes\", \"official figures\", \"on-the-record interview\", or \"public-records request\". Do NOT name a " +
    "specific document, person, or date, and do NOT restate the claim. Reply with one short noun phrase per " +
    "claim, each on its own line, prefixed with the claim's number.\n\n";

  function parseNumbered(textOut, n) {
    var byNum = {};
    String(textOut || "").split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*(\d+)\s*[\.\):-]\s*(.+?)\s*$/);
      if (m) byNum[parseInt(m[1], 10)] = clean(m[2]).replace(/^["'“]|["'”.]+$/g, "");
    });
    var out = [];
    for (var i = 1; i <= n; i++) { if (!byNum[i]) return null; out.push(byNum[i]); }
    return out;
  }

  function ollamaBatch(claims, opts) {
    if (typeof fetch === "undefined") return Promise.resolve(null);
    var prompt = BATCH_PROMPT + claims.map(function (c, i) { return (i + 1) + ". " + clean(c); }).join("\n") + "\n\nEvidence types:";
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, (opts && opts.timeout) || 30000) : null;
    return fetch(ollamaBase() + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({ model: ollamaModel(), prompt: prompt, stream: false, options: { temperature: 0.1, num_predict: 24 * claims.length + 64 } })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j ? parseNumbered(j.response, claims.length) : null; })
      .catch(function () { return null; })
      .then(function (v) { if (timer) clearTimeout(timer); return v; });
  }

  // is a local model reachable right now? (drives the "sharpen" affordance)
  function llmAvailable() {
    if (_customLLM) return Promise.resolve(true);
    if (typeof fetch === "undefined") return Promise.resolve(false);
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 1500) : null;
    return fetch(ollamaBase() + "/api/tags", { signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return !!(r && r.ok); }).catch(function () { return false; })
      .then(function (v) { if (timer) clearTimeout(timer); return v; });
  }

  // text[] → evidence-type[]: one LLM batch, mechanical fallback per claim.
  function needMany(texts, opts) {
    var claims = (texts || []).map(clean);
    if (!claims.length) return Promise.resolve([]);
    var llm = _customLLM || ollamaBatch;
    return Promise.resolve().then(function () { return llm(claims, opts); }).catch(function () { return null; })
      .then(function (out) {
        if (Array.isArray(out) && out.length === claims.length)
          return out.map(function (n, i) { return clean(n) || classify(claims[i]).label; });
        return claims.map(function (c) { return classify(c).label; });   // mechanical fallback
      });
  }
  function need(text, opts) { return needMany([text], opts).then(function (a) { return a[0] || classify(text).label; }); }

  return {
    classify: classify, need: need, needMany: needMany,
    llmAvailable: llmAvailable, setLLM: setLLM
  };
});
