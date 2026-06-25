/* ============================================================
   definitions.js — window.NpjDefinitions. No model beyond eoreader4's
   mechanical glossary extraction.

   A DEFINITION binds a TERM (a word, name or acronym a piece leans on) to a
   short explanation. Definitions are not owned by a single article: they accrete
   into a COLLECTIVE GLOSSARY across the published record, so a new piece can
   ADOPT a prior definition or — when the record disagrees with itself — DIVERGE
   from it on purpose. A term may therefore carry CONFLICTING definitions, each
   traced to the article that published it and the day it did.

   Three faces:
     • extract(text)        — eoreader4's glossary surface: the terms a draft
                              leans on, COUNTED RELATIVE TO ITS LENGTH. Mechanical,
                              no model. Returns candidates (no definitions yet).
     • buildPublishedIndex  — fold every released article's `definitions` field
                              into a term → [definitions] map (the collective
                              glossary), flagging the terms the record defines
                              more than one way. Mirrors sources.js backtracking.
     • resolve(terms,index) — attach each draft term's PRIOR published
                              definitions: the alternates a writer adopts,
                              diverges from, or sees conflict among.

   Per-article storage rides the same append-only EO log as tags — a folded
   field `definitions` on the article (see app/articles.js FOLD_FIELDS). Editing
   a definition is an ordinary REC; the collective index re-reads the record, so
   definitions change over time without any of them being thrown away.

   Plain script — publishes window.NpjDefinitions. Requires window.EOReader4
   (app/eoreader4-bridge.js) for extraction and window.NpjArticles for the index.
   Best-effort throughout: a missing engine or a dead fetch degrades, never throws.
   ============================================================ */
(function (root) {
  "use strict";

  // ---- term identity: a surface form → a cross-article key --------------
  // "Qualified Immunity" / "qualified immunity" → one key; a leading article is
  // dropped so "the NDP" keys with "NDP". Acronyms are bridged to their
  // spelled-out expansion separately, in buildGroups.
  var LEAD_ARTICLE = /^(the|a|an)\s+/i;
  function termKey(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/['‘’]/g, "")     // drop apostrophes (keep the stem intact)
      .replace(/[^a-z0-9\s-]+/g, " ")       // other punctuation → space
      .replace(LEAD_ARTICLE, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function normText(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
  function newId(prefix) { return (prefix || "def") + "-" + Math.random().toString(36).slice(2, 9); }

  // ---- one definition ENTRY (an article's chosen definition of a term) ---
  function normEntry(e) {
    if (!e || typeof e !== "object") return null;
    var term = String(e.term == null ? "" : e.term).trim();
    if (!term) return null;
    return {
      id: e.id ? String(e.id) : newId("def"),
      term: term,
      termKey: e.termKey ? String(e.termKey) : termKey(term),
      def: String(e.def == null ? "" : e.def).trim(),
      kind: (e.kind === "acronym" || e.kind === "name") ? e.kind : "term",
      acronym: e.acronym ? String(e.acronym).trim() : null,
      source: e.source === "manual" ? "manual" : "extracted",
      // when a writer adopts a prior published definition, remember where from
      basedOn: (e.basedOn && e.basedOn.slug) ? { slug: String(e.basedOn.slug), defId: e.basedOn.defId || null } : null,
      ts: e.ts ? String(e.ts).slice(0, 10) : ""
    };
  }
  // an article carries at most ONE chosen definition per term (first wins)
  function normList(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = {}, out = [];
    arr.forEach(function (e) {
      var n = normEntry(e);
      if (!n || seen[n.termKey]) return;
      seen[n.termKey] = 1; out.push(n);
    });
    return out;
  }

  // ---- sizing: how many terms a piece of this length earns ---------------
  function wordsIn(text) { return (String(text == null ? "" : text).trim().match(/\S+/g) || []).length; }
  function sizeFor(words, opts) {
    if (root.EOReader4 && typeof root.EOReader4.glossarySize === "function") {
      try { return root.EOReader4.glossarySize(words, opts); } catch (e) {}
    }
    var o = opts || {};                                   // fallback mirrors glossarySize
    var per = o.wordsPerTerm || 130, min = o.minTerms || 3, max = o.maxTerms || 24;
    return Math.max(min, Math.min(max, Math.round((Number(words) || 0) / per)));
  }

  // ---- engine readiness (the bridge is a deferred module) ---------------
  function engineReady() { return !!(root.EOReader4 && typeof root.EOReader4.extractGlossary === "function"); }
  function whenEngine(timeoutMs) {
    if (engineReady()) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var done = false, t = null;
      function settle(v) { if (done) return; done = true; try { root.removeEventListener && root.removeEventListener("eoreader4-ready", ok); } catch (e) {} if (t) clearTimeout(t); resolve(v); }
      function ok() { settle(engineReady()); }
      try { root.addEventListener && root.addEventListener("eoreader4-ready", ok); } catch (e) {}
      t = setTimeout(function () { settle(engineReady()); }, timeoutMs || 4000);
      if (engineReady()) settle(true);
    });
  }

  // ---- extract: text → sized glossary CANDIDATES (no definitions yet) ----
  function extract(text, opts) {
    var o = opts || {};
    var words = wordsIn(text);
    return whenEngine(o.timeoutMs).then(function () {
      if (!engineReady()) {
        return { ok: false, reason: "engine-unavailable", words: words, size: sizeFor(words, o), perTerm: (o.wordsPerTerm || 130), terms: [] };
      }
      var g;
      try { g = root.EOReader4.extractGlossary(String(text == null ? "" : text), o); }
      catch (e) { return { ok: false, reason: (e && e.message) || "extract-failed", words: words, size: sizeFor(words, o), perTerm: (o.wordsPerTerm || 130), terms: [] }; }
      var terms = (g.terms || []).map(function (t) {
        return {
          term: t.term,
          termKey: termKey(t.term),
          kind: t.kind || "term",
          acronym: t.acronym || null,
          count: t.count || 0,
          mentions: t.mentions || [],
          contexts: t.contexts || [],
          score: t.score || 0
        };
      });
      return { ok: true, words: g.words, size: g.size, perTerm: g.perTerm, terms: terms };
    });
  }

  // ---- the collective glossary: group published definitions by term -----
  // carriers: [{ slug, headline, author, ts, definitions:[entry] }]
  function buildGroups(carriers) {
    var byKey = {};        // termKey → group
    var aliasKey = {};     // acronym key → the expansion's termKey (bridge "NDP" → its group)
    function group(key, term) {
      if (!byKey[key]) byKey[key] = { termKey: key, term: term, kind: "term", acronym: null, entries: [] };
      return byKey[key];
    }
    (carriers || []).forEach(function (c) {
      (c.definitions || []).forEach(function (d) {
        var n = normEntry(d);
        if (!n) return;
        var key = aliasKey[n.termKey] || n.termKey;     // fold an acronym onto a known expansion
        var grp = group(key, n.term);
        if (n.term.length > grp.term.length) grp.term = n.term;     // keep the richest surface form
        if (n.kind === "acronym") grp.kind = "acronym";
        else if (n.kind === "name" && grp.kind === "term") grp.kind = "name";
        if (n.acronym) { grp.acronym = n.acronym; aliasKey[termKey(n.acronym)] = key; }
        grp.entries.push({
          def: n.def, term: n.term, defId: n.id, kind: n.kind, acronym: n.acronym,
          slug: c.slug, headline: c.headline || c.slug, author: c.author || "",
          ts: n.ts || (c.ts ? String(c.ts).slice(0, 10) : ""), basedOn: n.basedOn
        });
      });
    });
    var list = Object.keys(byKey).map(function (k) {
      var g = byKey[k];
      var defs = g.entries.filter(function (e) { return e.def; });
      var texts = {};
      defs.forEach(function (e) { texts[normText(e.def)] = (texts[normText(e.def)] || 0) + 1; });
      var sorted = defs.slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
      g.variants = Object.keys(texts).length;            // distinct definition texts
      g.conflicting = g.variants > 1;                    // the record disagrees with itself
      g.canonical = sorted.length ? { def: sorted[0].def, slug: sorted[0].slug, headline: sorted[0].headline, ts: sorted[0].ts } : null;
      g.count = g.entries.length;                        // how many articles define it
      return g;
    }).sort(function (a, b) { return b.count - a.count || a.term.localeCompare(b.term); });
    function get(key) { var k = termKey(key); return byKey[k] || (aliasKey[k] ? byKey[aliasKey[k]] : null); }
    return { list: list, byKey: byKey, get: get };
  }

  var _idx = { state: "idle", index: null, sig: null, error: null };
  var subs = new Set();
  function onChange(fn) { subs.add(fn); try { fn(snapshot()); } catch (e) {} return function () { subs.delete(fn); }; }
  function snapshot() { return { state: _idx.state, index: _idx.index, error: _idx.error }; }
  function notify() { subs.forEach(function (fn) { try { fn(snapshot()); } catch (e) {} }); try { root.dispatchEvent(new CustomEvent("npj:definitions", { detail: snapshot() })); } catch (e) {} }

  // Build (or return cached) the collective published-definition index. Loads
  // each released article's folded log once, reads its `definitions`, groups
  // them by term. Re-runs only when the published set changes (sig).
  function buildPublishedIndex(force) {
    if (!root.NpjArticles) { _idx.state = "error"; _idx.error = "articles store unavailable"; notify(); return Promise.resolve(null); }
    return Promise.resolve(root.NpjArticles.listArticles()).then(function (metas) {
      metas = (metas || []).filter(function (m) { return m && m.status !== "unpublished"; });
      var sig = metas.map(function (m) { return m.slug + ":" + (m.updated || m.published || "") + ":" + (m.versions || 1); }).join("|");
      if (!force && _idx.sig === sig && _idx.index) return _idx.index;
      _idx.state = "loading"; _idx.error = null; notify();
      return Promise.all(metas.map(function (m) {
        return Promise.resolve(root.NpjArticles.loadArticle(m.slug)).then(function (a) {
          if (!a) return null;
          return {
            slug: m.slug,
            headline: a.headline || m.headline || m.slug,
            author: (Array.isArray(a.authors) && a.authors[0]) || "",
            ts: a.updated || a.published || "",
            definitions: Array.isArray(a.definitions) ? a.definitions : []
          };
        }).catch(function () { return null; });
      })).then(function (carriers) {
        _idx.index = buildGroups(carriers.filter(Boolean));
        _idx.sig = sig; _idx.state = "ok"; notify();
        return _idx.index;
      });
    }).catch(function (e) {
      _idx.state = "error"; _idx.error = String((e && e.message) || e); notify();
      return _idx.index;
    });
  }

  // Attach, per draft term, the PRIOR published definitions (the alternates a
  // writer adopts or diverges from) + whether the record conflicts. Works on
  // candidate terms OR on chosen entries — anything with a term/termKey.
  function resolve(terms, index) {
    var idx = index || _idx.index;
    return (terms || []).map(function (t) {
      var key = t.termKey || termKey(t.term);
      var grp = idx ? idx.get(key) : null;
      var uniq = [], seen = {};
      if (grp) {
        grp.entries.filter(function (e) { return e.def; })
          .sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); })
          .forEach(function (e) { var k = normText(e.def); if (seen[k]) return; seen[k] = 1; uniq.push(e); });
      }
      return Object.assign({}, t, {
        alternates: uniq,                                // distinct prior definitions, newest first
        priorCount: uniq.length,
        conflicting: !!(grp && grp.conflicting),
        canonical: grp ? grp.canonical : null
      });
    });
  }

  root.NpjDefinitions = {
    termKey: termKey, normText: normText, newId: newId,
    normEntry: normEntry, normList: normList,
    wordsIn: wordsIn, sizeFor: sizeFor,
    engineReady: engineReady, whenEngine: whenEngine, extract: extract,
    buildGroups: buildGroups, buildPublishedIndex: buildPublishedIndex, resolve: resolve,
    publishedIndex: function () { return _idx.index; },
    publishedState: function () { return _idx.state; },
    onChange: onChange
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjDefinitions;
})(typeof window !== "undefined" ? window : this);
