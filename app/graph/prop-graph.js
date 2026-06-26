/* prop-graph.js — window.NpjPropGraph.
 *
 * Thin adapter between the editor's prose and eoreader4's reading core
 * (window.EOReader4, published by app/graph/eoreader4-bridge.js). Given plain text it
 * returns a parsed `doc` whose `doc.projectGraph(frame)` is the proposition graph
 * (entities + subject-verb-object edges). Parsing is the expensive step, so docs
 * are cached by text; projectGraph itself is already memoized inside the engine.
 *
 * No DOM here — the jump-to-prose mapping lives in the Newsroom (it owns the
 * editor + scroll refs). This only hands back the sentence text for an index.
 */
(function () {
  var cache = new Map(); // textHash -> Promise<doc>

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ":" + h; }
  function ready() { return !!(window.EOReader4 && typeof window.EOReader4.ingestText === "function"); }

  // Parse text -> doc (cached). Rejects if the engine hasn't loaded yet.
  function docFor(text) {
    if (!ready()) return Promise.reject(new Error("eoreader4-not-loaded"));
    var t = String(text == null ? "" : text);
    var k = hash(t);
    var p = cache.get(k);
    if (!p) {
      p = Promise.resolve()
        .then(function () { return window.EOReader4.ingestText(t); })
        .catch(function (e) { cache.delete(k); throw e; });
      cache.set(k, p);
      if (cache.size > 6) cache.delete(cache.keys().next().value); // small LRU-ish bound
    }
    return p;
  }

  // The text of sentence `idx` (engine sentences may be strings or objects).
  function sentenceText(doc, idx) {
    var arr = (doc && (doc.sentences || doc.units)) || [];
    var s = arr[idx];
    if (s == null) return "";
    return typeof s === "string" ? s : (s.text || s.raw || s.str || s.sentence || String(s));
  }

  window.NpjPropGraph = { ready: ready, docFor: docFor, sentenceText: sentenceText, clear: function () { cache.clear(); } };
})();
