/* propositions.js — bare-proposition extraction via the eoreader4 engine.

   The grounding workspace lists the claims that still need a source. A sentence,
   though, often carries several checkable claims (and the sentence splitter trips
   on quotes and "Mr."). So instead of shipping raw sentences to a fact-checker we
   ask eoreader4 to read the prose into its graph and read the bare propositions
   back out: subject → relation → object, one atomic claim per bullet.

   eoreader4 (https://github.com/clovenbradshaw-ctrl/eoreader4) is a vanilla
   ES-module reading kernel (no compromise.js). We use three pieces of its public
   API:
     · parseText(text)          → a doc carrying an append-only event `log`
     · projectGraph(log)        → { entities, edges, representative, … }
     · (an edge)                → a proposition {substrate, relation, differentia}

   It's loaded lazily (dynamic import, browser-only) the first time an export is
   opened, so normal page load never pays for it. Any failure — offline, the
   module moved, a parse error — resolves to a clean fallback (the sentence
   itself), so the fact-check list always renders. Pin the engine by setting
   window.NPJ_EOREADER4_BASE to a commit-pinned jsDelivr base.

   UMD: window.NpjPropositions in the browser, module.exports in node — the
   surface-rendering (graph → strings) is pure and unit-tested without the engine.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjPropositions = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var DEFAULT_BASE = "https://cdn.jsdelivr.net/gh/clovenbradshaw-ctrl/eoreader4@main/";

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function cap(s) { s = clean(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  // a relation token ("located_in", "GOVERNS") → readable verb phrase ("located in")
  function prettyRel(r) { return clean(String(r == null ? "" : r).replace(/[_\-]+/g, " ")).toLowerCase(); }

  // resolve an edge endpoint (a node id, possibly merged) to its surface text via
  // the projected entities map + representative(); fall back to the id itself.
  function surfaceFor(id, entities, representative) {
    var rid = id;
    try { if (typeof representative === "function") { var r = representative(id); if (r != null) rid = r; } } catch (e) {}
    var ent = null;
    try { ent = entities && (typeof entities.get === "function" ? entities.get(rid) : entities[rid]); } catch (e) {}
    if (ent) return clean(ent.name || ent.surface || ent.label || ent.text || ent.lemma || ent.id || rid);
    return clean(rid);
  }

  // one projected edge → a bare proposition string ("Subject relation object").
  // Mirrors eoreader4's propositionOfEdge slotting (substrate/relation/differentia)
  // and renders a negated tie with "not".
  function renderEdge(edge, entities, representative) {
    if (!edge) return "";
    var subj = surfaceFor(edge.src != null ? edge.src : edge.from, entities, representative);
    var obj = surfaceFor(edge.tgt != null ? edge.tgt : edge.to, entities, representative);
    var rel = prettyRel(edge.via != null ? edge.via : edge.rel);
    var neg = (edge.polarity === "-" || edge.polarity === "negative") ? "not " : "";
    var parts = [subj, clean(neg + rel), obj].filter(Boolean);
    if (parts.length < 3 || !rel) return "";   // need all three slots to be a claim
    return cap(parts.join(" "));
  }

  // a projected graph → deduped list of bare proposition strings (reading order).
  function propositionsFromGraph(graph) {
    if (!graph || !graph.edges || !graph.edges.length) return [];
    var entities = graph.entities, rep = graph.representative;
    var seen = {}, out = [];
    graph.edges.forEach(function (e) {
      var t = renderEdge(e, entities, rep);
      if (!t) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1; out.push(t);
    });
    return out;
  }

  // ---- the engine, loaded once, lazily (browser only) ----
  var _engine = null;     // cached Promise<{parseText, projectGraph} | null>
  function loadEngine() {
    if (typeof window === "undefined") return Promise.resolve(null);
    var base = window.NPJ_EOREADER4_BASE || DEFAULT_BASE;
    if (base.charAt(base.length - 1) !== "/") base += "/";
    // dynamic import keeps eoreader4 (and its whole module graph) off the
    // critical path; jsDelivr serves the repo with CORS + relative imports intact
    return Promise.all([
      import(base + "src/perceiver/parse/index.js"),
      import(base + "src/core/index.js")
    ]).then(function (mods) {
      var parse = mods[0], core = mods[1];
      if (!parse || typeof parse.parseText !== "function") return null;
      if (!core || typeof core.projectGraph !== "function") return null;
      return { parseText: parse.parseText, projectGraph: core.projectGraph };
    }).catch(function () { return null; });
  }
  function engine() { if (!_engine) _engine = loadEngine(); return _engine; }
  function ready() { return !!_engine; }

  // text → bare propositions. Falls back to [the sentence] whenever the engine
  // is unavailable or yields nothing, so the caller always has a bullet.
  function extract(text) {
    var t = clean(text);
    if (!t) return Promise.resolve([]);
    return engine().then(function (mod) {
      if (!mod) return [t];
      try {
        var doc = mod.parseText(t);
        var log = doc && (doc.log || doc.events || doc);
        var graph = mod.projectGraph(log);
        var props = propositionsFromGraph(graph);
        return props.length ? props : [t];
      } catch (e) { return [t]; }
    }).catch(function () { return [t]; });
  }
  function extractMany(texts) { return Promise.all((texts || []).map(extract)); }

  return {
    extract: extract, extractMany: extractMany, ready: ready,
    // pure (testable without the engine)
    propositionsFromGraph: propositionsFromGraph, renderEdge: renderEdge, prettyRel: prettyRel
  };
});
