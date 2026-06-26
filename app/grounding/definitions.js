/* ============================================================
   definitions.js — window.NpjDefinitions.

   A DEFINITION binds a TERM (a word, name or acronym a piece leans on) to a
   short explanation. Three things make this more than a glossary field:

     • MULTIPLE definitions per term. One word can be defined more than one way
       in the same piece — contested terms, rival senses — so a term holds an
       ARRAY of definitions, not one.
     • Each definition is SOURCED. A definition can carry a link that gets
       ARCHIVED (archive.org, via NpjArchiveCDN) and identified — best-effort
       site title, source organisation, and the DATE IT WAS PRESERVED.
     • The record is COLLECTIVE. Definitions accrete across published articles;
       a new piece can ADOPT a prior one or DIVERGE from it, and the index
       flags where the record defines a term more than one way.

   Extraction LEVERAGES THE ENGINE ALREADY IN NPJ — window.EOReader4.ingestText
   (via window.NpjPropGraph), the same model-free reading core the Graph view
   uses. Nothing is added to eoreader4 and nothing is copied in; we read the
   admitted figures off the parsed doc and rank + size them HERE.

   Per-article storage rides the article's append-only EO log as a folded field
   `definitions` (see app/articles.js). Editing is an ordinary REC, so
   definitions change over time without any being discarded.

   Plain script — publishes window.NpjDefinitions. Best-effort throughout.
   ============================================================ */
(function (root) {
  "use strict";

  // ---- term identity: a surface form → a cross-article key --------------
  var LEAD_ARTICLE = /^(the|a|an)\s+/i;
  function termKey(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/['‘’]/g, "")
      .replace(/[^a-z0-9\s-]+/g, " ")
      .replace(LEAD_ARTICLE, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function normText(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
  function newId(prefix) { return (prefix || "def") + "-" + Math.random().toString(36).slice(2, 9); }
  function today() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ""; } }

  // ---- sizing: how many terms a piece of this length earns --------------
  function wordsIn(text) { return (String(text == null ? "" : text).trim().match(/\S+/g) || []).length; }
  function sizeFor(words, opts) {
    var o = opts || {};
    var per = o.wordsPerTerm || 130, min = o.minTerms || 3, max = o.maxTerms || 24;
    return Math.max(min, Math.min(max, Math.round((Number(words) || 0) / per)));
  }

  // ========================================================================
  // EXTRACTION — read the engine already in npj, rank + size the terms here
  // ========================================================================

  // The text's own parenthetical acronym glosses ("Nashville Downtown
  // Partnership (NDP)"). Conservative: the acronym must be the trailing initials
  // of the phrase before it. Pure — independent of any engine ledger.
  var ACR_RE = /([A-Z][A-Za-z.&'’-]*(?:\s+[A-Za-z.&'’-]+){0,6})\s*\(([A-Z]{2,6})s?\)/g;
  function scanAcronyms(text) {
    var s = String(text == null ? "" : text), out = [], re = new RegExp(ACR_RE.source, "g"), m;
    while ((m = re.exec(s)) !== null) {
      var acr = m[2], words = m[1].trim().split(/\s+/);
      if (words.length < acr.length) continue;
      var tail = words.slice(-acr.length);
      var initials = tail.map(function (w) { return (w[0] || ""); }).join("").toUpperCase();
      if (initials !== acr.toUpperCase()) continue;
      var expansion = tail.join(" ");
      if (/^[A-Z]/.test(expansion)) out.push({ acronym: acr, expansion: expansion });
    }
    return out;
  }

  function unitText(doc, i) {
    var u = ((doc && (doc.sentences || doc.units)) || [])[i];
    if (u == null) return "";
    return typeof u === "string" ? u : (u.text || u.raw || u.sentence || String(u));
  }
  function k_(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
  function scoreOf(c) {
    return c.count * 1.0 + c.mentions.length * 0.6 + (c.multiword ? 1.2 : 0) + (c.acronym ? 2.0 : 0) + (c.expansion ? 1.0 : 0);
  }

  // Rank the admitted figures of a parsed eoreader4 doc into sized candidates.
  // Pure on (doc, text). No eoreader4 code — just reads doc.admission.
  function rankFromDoc(doc, text, opts) {
    var o = opts || {};
    var words = wordsIn(text);
    var size = sizeFor(words, o);
    var A = doc && doc.admission;
    if (!A || !A.admitted) return { words: words, size: size, terms: [], all: [] };

    var expKeyByAcr = {}, acrByExpKey = {}, expLabelByKey = {};
    function linkAcr(acr, expLabel) {
      if (!acr || !expLabel) return;
      var ak = k_(acr), ek = k_(expLabel);
      if (!ak || !ek || ak === ek) return;
      expKeyByAcr[ak] = ek;
      if (!acrByExpKey[ek]) acrByExpKey[ek] = String(acr);
      if (!expLabelByKey[ek] || String(expLabel).length > expLabelByKey[ek].length) expLabelByKey[ek] = String(expLabel);
    }
    var ledger = A.initialisms;
    if (ledger && typeof ledger.forEach === "function") {
      ledger.forEach(function (expId, acrLabel) {
        var expLabel = (typeof A.labelOf === "function" && A.labelOf(expId)) || null;
        if (expLabel) linkAcr(acrLabel, expLabel);
      });
    }
    scanAcronyms(text).forEach(function (l) { linkAcr(l.acronym, l.expansion); });

    var groups = {};
    A.admitted.forEach(function (id, label) {
      var count = A.counts.get(label) || 0;
      if (count < (o.minCount || 1)) return;
      var lk = k_(label);
      var gkey = expKeyByAcr[lk] || lk;
      var isAcr = !!expKeyByAcr[lk];
      var g = groups[gkey];
      if (!g) {
        var seed = expLabelByKey[gkey] || label;
        g = { term: seed, key: gkey, id: id, count: 0, mentions: {}, multiword: seed.indexOf(" ") >= 0, acronym: acrByExpKey[gkey] || null };
        groups[gkey] = g;
      }
      if (expLabelByKey[gkey]) { g.term = expLabelByKey[gkey]; g.multiword = g.term.indexOf(" ") >= 0; }
      else if (!isAcr && label.length > g.term.length) { g.term = label; g.multiword = label.indexOf(" ") >= 0; g.id = id; }
      if (acrByExpKey[gkey]) g.acronym = acrByExpKey[gkey];
      g.count += count;
      (A.mentions.get(id) || []).forEach(function (si) { g.mentions[si] = 1; });
    });

    var cands = Object.keys(groups).map(function (key) {
      var g = groups[key];
      var mentions = Object.keys(g.mentions).map(Number).sort(function (a, b) { return a - b; });
      var contexts = mentions.slice(0, o.contexts || 2).map(function (i) { return unitText(doc, i); }).filter(Boolean);
      var c = {
        term: g.term, termKey: g.key, id: g.id,
        kind: g.acronym ? "acronym" : (g.multiword ? "name" : "term"),
        count: g.count, mentions: mentions, multiword: g.multiword,
        acronym: g.acronym, expansion: (g.acronym && g.term !== g.acronym) ? g.term : null,
        contexts: contexts
      };
      c.score = Math.round(scoreOf(c) * 1000) / 1000;
      return c;
    }).sort(function (a, b) { return b.score - a.score || b.count - a.count || a.term.localeCompare(b.term); });

    return { words: words, size: size, terms: cands.slice(0, size), all: cands };
  }

  // ---- engine readiness (the bridge is a deferred ES module) -------------
  function engineReady() {
    return !!((root.NpjPropGraph && root.NpjPropGraph.ready && root.NpjPropGraph.ready()) ||
              (root.EOReader4 && typeof root.EOReader4.ingestText === "function"));
  }
  function whenEngine(timeoutMs) {
    if (engineReady()) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var done = false, t = null;
      function settle() { if (done) return; done = true; try { root.removeEventListener && root.removeEventListener("eoreader4-ready", settle); } catch (e) {} if (t) clearTimeout(t); resolve(engineReady()); }
      try { root.addEventListener && root.addEventListener("eoreader4-ready", settle); } catch (e) {}
      t = setTimeout(settle, timeoutMs || 6000);
      if (engineReady()) settle();
    });
  }

  // Parse the draft text with the engine ALREADY in npj and rank the figures.
  // -> { ok, reason?, words, size, terms:[{term,termKey,kind,count,acronym,contexts,...}] }
  function extract(text, opts) {
    var o = opts || {};
    var t = String(text == null ? "" : text);
    var words = wordsIn(t);
    return whenEngine(o.timeoutMs).then(function () {
      var p = null;
      if (root.NpjPropGraph && root.NpjPropGraph.ready && root.NpjPropGraph.ready() && root.NpjPropGraph.docFor) p = root.NpjPropGraph.docFor(t);
      else if (root.EOReader4 && typeof root.EOReader4.ingestText === "function") p = Promise.resolve(root.EOReader4.ingestText(t));
      if (!p) return { ok: false, reason: "engine-unavailable", words: words, size: sizeFor(words, o), terms: [] };
      return Promise.resolve(p).then(function (doc) {
        var r = rankFromDoc(doc, t, o);
        return { ok: true, words: r.words, size: r.size, terms: r.terms };
      }).catch(function (e) {
        return { ok: false, reason: (e && e.message) || "extract-failed", words: words, size: sizeFor(words, o), terms: [] };
      });
    });
  }

  // ========================================================================
  // SOURCING — archive a link and identify it (reuses npj's source pipeline)
  // ========================================================================

  function snapshotDateOf(archiveUrl) {
    var m = String(archiveUrl || "").match(/\/web\/(\d{8})/);
    return m ? (m[1].slice(0, 4) + "-" + m[1].slice(4, 6) + "-" + m[1].slice(6, 8)) : "";
  }
  function normSource(s) {
    if (!s || typeof s !== "object") return null;
    var url = String(s.url || s.original_url || "").trim();
    var archive = String(s.archive_url || "").trim();
    if (!url && !archive) return null;
    return {
      url: url,
      archive_url: archive,
      title: String(s.title || "").trim(),
      outlet: String(s.outlet || s.site || "").trim(),
      retrieved: s.retrieved ? String(s.retrieved).slice(0, 10) : "",
      preserved: s.preserved ? String(s.preserved).slice(0, 10) : snapshotDateOf(archive),
      status: s.status || (archive ? "archived" : "unarchived")
    };
  }

  // url -> Promise<source>. Guesses identity instantly, archives to wayback,
  // then refines title/outlet off the archived page + records the preserved
  // date. onProgress(partial) fires as each stage lands. Always settles.
  function archiveSource(url, onProgress) {
    var u = String(url || "").trim();
    var src = normSource({ url: u, status: "snapshotting", retrieved: today() }) || { url: u, archive_url: "", title: "", outlet: "", retrieved: today(), preserved: "", status: "snapshotting" };
    if (root.NpjSourceTitle && root.NpjSourceTitle.guess) {
      try { var g = root.NpjSourceTitle.guess(u); if (g.title) src.title = g.title; if (g.outlet) src.outlet = g.outlet; } catch (e) {}
    }
    if (onProgress) try { onProgress(Object.assign({}, src)); } catch (e) {}
    var AC = root.NpjArchiveCDN;
    if (!AC || typeof AC.ensureSnapshot !== "function") { src.status = "unarchived"; return Promise.resolve(src); }
    return Promise.resolve(AC.ensureSnapshot(u)).then(function (snap) {
      if (snap) { src.archive_url = snap; src.preserved = snapshotDateOf(snap); src.status = "archived"; }
      else { src.status = "snapshot-pending"; }
      if (onProgress) try { onProgress(Object.assign({}, src)); } catch (e) {}
      if (snap && typeof AC.pageMeta === "function" && root.NpjSourceTitle) {
        return Promise.resolve(AC.pageMeta({ archiveUrl: snap, url: u })).then(function (meta) {
          if (meta && meta.title) {
            var t = root.NpjSourceTitle.cleanTitle ? root.NpjSourceTitle.cleanTitle(meta.title, meta.site || src.outlet) : meta.title;
            if (t) src.title = t;
          }
          if (meta && meta.site) src.outlet = meta.site;
          if (onProgress) try { onProgress(Object.assign({}, src)); } catch (e) {}
          return src;
        }).catch(function () { return src; });
      }
      return src;
    }).catch(function () { src.status = "unarchived"; return src; });
  }

  // ========================================================================
  // PER-ARTICLE MODEL — a term holds an ARRAY of (sourced) definitions
  // ========================================================================

  function normDef(d) {
    if (d == null) return null;
    if (typeof d === "string") d = { text: d };
    if (typeof d !== "object") return null;
    var text = String(d.text == null ? "" : d.text).trim();
    var source = normSource(d.source);
    if (!text && !source) return null;
    return {
      id: d.id ? String(d.id) : newId("d"),
      text: text,
      source: source,
      sense: d.sense ? String(d.sense).trim() : "",
      origin: (d.origin === "manual" || d.origin === "adopted" || d.origin === "extracted") ? d.origin : "manual",
      basedOn: (d.basedOn && d.basedOn.slug) ? { slug: String(d.basedOn.slug), defId: d.basedOn.defId || null } : null,
      author: d.author ? String(d.author) : "",
      ts: d.ts ? String(d.ts).slice(0, 10) : ""
    };
  }

  function normEntry(e) {
    if (!e || typeof e !== "object") return null;
    var term = String(e.term == null ? "" : e.term).trim();
    if (!term) return null;
    var defs = [];
    if (Array.isArray(e.defs)) defs = e.defs.map(normDef).filter(Boolean);
    else if (e.def != null && String(e.def).trim()) {
      // back-compat with the single-definition shape (def string + origin in `source`)
      var d = normDef({ text: e.def, source: (e.source && typeof e.source === "object") ? e.source : null, origin: (typeof e.source === "string") ? e.source : "manual", basedOn: e.basedOn });
      if (d) defs = [d];
    }
    return {
      id: e.id ? String(e.id) : newId("def"),
      term: term,
      termKey: e.termKey ? String(e.termKey) : termKey(term),
      kind: (e.kind === "acronym" || e.kind === "name") ? e.kind : "term",
      acronym: e.acronym ? String(e.acronym).trim() : null,
      defs: defs
    };
  }

  function sameDef(a, b) {
    return normText(a.text) === normText(b.text) && ((a.source && a.source.url) || "") === ((b.source && b.source.url) || "");
  }
  // one entry per term per article; same term twice → merge its definitions
  function normList(arr) {
    if (!Array.isArray(arr)) return [];
    var byKey = {}, out = [];
    arr.forEach(function (e) {
      var n = normEntry(e); if (!n) return;
      var ex = byKey[n.termKey];
      if (ex) {
        n.defs.forEach(function (d) { if (!ex.defs.some(function (x) { return sameDef(x, d); })) ex.defs.push(d); });
        if (!ex.acronym && n.acronym) ex.acronym = n.acronym;
      } else { byKey[n.termKey] = n; out.push(n); }
    });
    return out;
  }

  // ========================================================================
  // COLLECTIVE GLOSSARY — group every published definition by term
  // ========================================================================
  function buildGroups(carriers) {
    var byKey = {}, aliasKey = {};
    function group(key, term) { if (!byKey[key]) byKey[key] = { termKey: key, term: term, kind: "term", acronym: null, entries: [] }; return byKey[key]; }
    (carriers || []).forEach(function (c) {
      (c.definitions || []).forEach(function (raw) {
        var n = normEntry(raw); if (!n) return;
        var key = aliasKey[n.termKey] || n.termKey;
        var grp = group(key, n.term);
        if (n.term.length > grp.term.length) grp.term = n.term;
        if (n.kind === "acronym") grp.kind = "acronym"; else if (n.kind === "name" && grp.kind === "term") grp.kind = "name";
        if (n.acronym) { grp.acronym = n.acronym; aliasKey[termKey(n.acronym)] = key; }
        n.defs.forEach(function (d) {
          if (!d.text) return;
          grp.entries.push({
            def: d.text, source: d.source || null, sense: d.sense || "", term: n.term, defId: d.id,
            slug: c.slug, headline: c.headline || c.slug, author: d.author || c.author || "",
            ts: d.ts || (c.ts ? String(c.ts).slice(0, 10) : ""), basedOn: d.basedOn
          });
        });
      });
    });
    var list = Object.keys(byKey).map(function (k) {
      var g = byKey[k];
      var defs = g.entries.filter(function (e) { return e.def; });
      var texts = {};
      defs.forEach(function (e) { texts[normText(e.def)] = 1; });
      var sorted = defs.slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
      g.variants = Object.keys(texts).length;
      g.conflicting = g.variants > 1;
      g.canonical = sorted.length ? { def: sorted[0].def, source: sorted[0].source || null, slug: sorted[0].slug, headline: sorted[0].headline, ts: sorted[0].ts } : null;
      g.count = g.entries.length;
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
            slug: m.slug, headline: a.headline || m.headline || m.slug,
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

  // attach, per term, the PRIOR published definitions (alternates to adopt or
  // diverge from) + whether the record conflicts
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
        alternates: uniq, priorCount: uniq.length,
        conflicting: !!(grp && grp.conflicting), canonical: grp ? grp.canonical : null
      });
    });
  }

  root.NpjDefinitions = {
    termKey: termKey, normText: normText, newId: newId, today: today,
    wordsIn: wordsIn, sizeFor: sizeFor,
    scanAcronyms: scanAcronyms, rankFromDoc: rankFromDoc,
    engineReady: engineReady, whenEngine: whenEngine, extract: extract,
    snapshotDateOf: snapshotDateOf, normSource: normSource, archiveSource: archiveSource,
    normDef: normDef, normEntry: normEntry, normList: normList,
    buildGroups: buildGroups, buildPublishedIndex: buildPublishedIndex, resolve: resolve,
    publishedIndex: function () { return _idx.index; },
    publishedState: function () { return _idx.state; },
    onChange: onChange
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjDefinitions;
})(typeof window !== "undefined" ? window : this);
