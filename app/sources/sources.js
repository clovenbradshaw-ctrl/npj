/* ============================================================
   sources.js — source provenance: synthetic dedup + backtracking. NO MODEL.

   A SOURCE is a document uploaded to back the claims in an ARTICLE. The same
   document gets uploaded again and again — to one article, to one project, or
   across different projects. We do NOT merge or delete those copies. Instead
   every source record gets a content SIGNATURE, and copies that share a
   signature are LINKED — a synthetic dedup that spans project boundaries
   without ever throwing a copy away. (Mirrors how citations.js dedupes a pinned
   span: collapse on content, keep the record.)

   And the inverse of "read the source": BACKTRACKING. The grounding graph
   already points article → source (a claim cites a span of a source). This
   walks it the other way: given a source, trace every article that links to
   it — across projects, drafts and the published record alike.

   Two carriers feed the index:
     • drafts   — each draft's bound `sources` (the project it lives in is its
                  bucket); read synchronously off NpjDrafts.list() entries.
     • published — each released article's cited source keys, folded out of its
                  committed EO log (NpjArticles.loadArticle → body tokens).

   Plain script — publishes window.NpjSources. Requires window.NPJ (data.js).
   Best-effort throughout: a missing record or a dead fetch degrades, never throws.
   ============================================================ */
(function (root) {
  'use strict';
  var NPJ = root.NPJ || (root.NPJ = {});

  /* ---------------- content signature (the synthetic-dedup key) ---------------- */
  function djb2(s) { var h = 5381, i = String(s || '').length; while (i) h = ((h * 33) ^ String(s).charCodeAt(--i)) >>> 0; return h.toString(36); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  // Normalize a URL so http/https, www, the query/hash, a trailing slash and a
  // wayback wrapper all collapse to the same string.
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    var wb = u.match(/web\.archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/i);
    if (wb) u = wb[1];
    return u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
  }
  // The archive.org item identifier behind a record, however it's keyed.
  function iaIdentifier(rec) {
    if (!rec) return '';
    if (/^ia-/.test(rec.id || '')) return String(rec.id).slice(3);
    var m = String(rec.archive_url || rec.original_url || '').match(/archive\.org\/(?:details|download)\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  }
  // The signature: identical content → identical signature, wherever it lives.
  function signatureOf(rec) {
    if (!rec) return '';
    var ia = iaIdentifier(rec); if (ia) return 'ia:' + ia.toLowerCase();
    var ou = normUrl(rec.original_url); if (ou) return 'url:' + ou;
    var au = normUrl(rec.archive_url); if (au) return 'url:' + au;
    var txt = norm(rec.text), ttl = norm(rec.title);
    if (txt) return 'c:' + djb2(ttl + ' :: ' + txt);   // content hash (title + body text)
    if (ttl) return 't:' + djb2(ttl);                    // title only — weakest link
    return 'k:' + djb2(rec.id || '');
  }

  // A coarse kind for the badge: archive.org snapshot / live web page / uploaded file.
  function srcKind(rec) {
    rec = rec || {};
    if (iaIdentifier(rec) || /archive\.org/i.test(rec.archive_url || '')) return { key: 'archive', label: 'archive.org', archived: true };
    if (/^https?:/i.test(rec.original_url || '')) return { key: 'web', label: 'web source', archived: !!rec.archive_url };
    if (/^doc-/.test(rec.id || '')) return { key: 'doc', label: 'uploaded document', archived: !!rec.archive_url };
    return { key: 'source', label: rec.outlet || 'source', archived: !!rec.archive_url };
  }

  function projId(p) { return p ? (p.roomId || p.id || p.title || '') : ''; }

  /* ---------------- the grouping core ----------------
     carriers: [{ id, title, kind:'draft'|'published', slug?, project?, cites:[{key, rec, quotes:[]}] }]
     → one group per signature, carrying every distinct key (synthetic dedup),
       every carrier that cites it (backtracking) and the projects it spans. */
  function buildGroups(carriers) {
    var groups = {};
    (carriers || []).forEach(function (c) {
      (c.cites || []).forEach(function (cite) {
        if (!cite || !cite.key) return;
        var rec = cite.rec || (NPJ.SOURCES || {})[cite.key] || { id: cite.key, title: cite.key };
        var sig = signatureOf(rec);
        if (!sig) return;
        var g = groups[sig];
        if (!g) g = groups[sig] = { signature: sig, rec: rec, title: rec.title || cite.key, keys: {}, carriers: [], _seen: {}, projects: {} };
        // keep the richest representative record (one with an archived snapshot + a real title)
        var better = (rec.archive_url && !g.rec.archive_url) || (rec.title && (!g.rec.title || g.rec.title === g.rec.id));
        if (better) { g.rec = rec; g.title = rec.title || g.title; }
        g.keys[cite.key] = (g.keys[cite.key] || 0) + 1;
        if (c.project) g.projects[projId(c.project)] = c.project;
        if (!g._seen[c.id]) {
          g._seen[c.id] = 1;
          g.carriers.push({ id: c.id, title: c.title, kind: c.kind, slug: c.slug || null, project: c.project || null, quotes: (cite.quotes || []).slice() });
        } else {
          var ex = g.carriers.find(function (x) { return x.id === c.id; });
          if (ex) (cite.quotes || []).forEach(function (q) { if (ex.quotes.indexOf(q) < 0) ex.quotes.push(q); });
        }
      });
    });
    return Object.keys(groups).map(function (sig) {
      var g = groups[sig];
      var keys = Object.keys(g.keys);
      return {
        signature: sig,
        rec: g.rec,
        title: g.title,
        kind: srcKind(g.rec),
        keys: keys,                                                   // distinct upload keys sharing this content
        uploads: keys.reduce(function (a, k) { return a + g.keys[k]; }, 0),
        duplicated: keys.length > 1,                                  // same content, more than one upload
        carriers: g.carriers.sort(function (a, b) { return (a.kind === b.kind) ? 0 : (a.kind === 'published' ? -1 : 1); }),
        projects: Object.keys(g.projects).map(function (k) { return g.projects[k]; }),
        crossProject: Object.keys(g.projects).length > 1
      };
    }).sort(function (a, b) { return b.carriers.length - a.carriers.length; });
  }

  /* ---------------- draft carriers (synchronous) ---------------- */
  function draftToCarrier(d) {
    return {
      id: 'draft:' + d.id, title: d.title || 'Untitled', kind: 'draft', project: d.room || null,
      cites: (d.sources || []).map(function (s) {
        return { key: s.key, rec: (d.sourceRecords || {})[s.key] || (NPJ.SOURCES || {})[s.key] || null, quotes: [] };
      })
    };
  }
  // Groups over a set of drafts — used for a project's shared source shelf and
  // the cross-project synthetic links the Documents page surfaces.
  function draftGroups(drafts) { return buildGroups((drafts || []).map(draftToCarrier)); }

  // The shared source shelf of one project: every source bound to any document
  // in `roomId`, deduped by content signature (the same upload to two drafts
  // collapses to one) so a NEW article in that project can inherit it and tag
  // claims against it from the first keystroke — no re-uploading the same
  // documents. Returns { sources:[{key,archived}], sourceRecords:{key:rec} },
  // shaped to seed a draft directly. Inheriting an uncited source is free: only
  // CITED sources ride into a published article (the publish build ships the
  // used set alone), so this never bloats the committed record.
  function projectSources(drafts, roomId) {
    var seenKey = {}, seenSig = {}, out = [], records = {};
    (drafts || []).forEach(function (d) {
      if (!d || !d.room || d.room.roomId !== roomId) return;
      (d.sources || []).forEach(function (s) {
        if (!s || !s.key || seenKey[s.key]) return;
        var rec = (d.sourceRecords && d.sourceRecords[s.key]) || (NPJ.SOURCES || {})[s.key] || null;
        var sig = rec ? signatureOf(rec) : '';
        if (sig && seenSig[sig]) return;             // same content, already inherited
        seenKey[s.key] = 1; if (sig) seenSig[sig] = 1;
        out.push({ key: s.key, archived: !!(rec && rec.archive_url) });
        if (rec) records[s.key] = rec;
      });
    });
    return { sources: out, sourceRecords: records };
  }

  /* ---------------- published carriers (async, cached) ---------------- */
  function citesFromArticle(a) {
    var map = {};
    function tok(t) {
      if (!t || typeof t !== 'object' || t.c == null || !Array.isArray(t.src)) return;
      t.src.forEach(function (k) {
        var e = map[k] || (map[k] = { key: k, rec: (a.sources || {})[k] || (NPJ.SOURCES || {})[k] || { id: k, title: k }, quotes: [] });
        var q = t.q && t.q[k];
        if (q && e.quotes.indexOf(q) < 0) e.quotes.push(q);
      });
    }
    (a.body || []).forEach(function (b) {
      if (!b) return;
      (b.tokens || []).forEach(tok);
      (b.items || []).forEach(function (it) { (it || []).forEach(tok); });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  var _pub = { state: 'idle', groups: null, sig: null, error: null };
  var subs = new Set();
  function onChange(fn) { subs.add(fn); try { fn(snapshot()); } catch (e) {} return function () { subs.delete(fn); }; }
  function snapshot() { return { state: _pub.state, groups: _pub.groups, error: _pub.error }; }
  function notify() { subs.forEach(function (fn) { try { fn(snapshot()); } catch (e) {} }); try { root.dispatchEvent(new CustomEvent('npj:sources', { detail: snapshot() })); } catch (e) {} }

  // Build (or return cached) the published-source index. Loads each released
  // article's folded log once, collects the sources its claims actually cite,
  // and groups them. Re-runs only when the published set changes.
  async function buildPublishedIndex(force) {
    if (!root.NpjArticles) { _pub.state = 'error'; _pub.error = 'articles store unavailable'; notify(); return null; }
    var metas;
    try { metas = await root.NpjArticles.listArticles(); }
    catch (e) { _pub.state = 'error'; _pub.error = String((e && e.message) || e); notify(); return _pub.groups; }
    metas = (metas || []).filter(function (m) { return m && m.status !== 'unpublished'; });
    var sig = metas.map(function (m) { return m.slug + ':' + (m.updated || m.published || '') + ':' + (m.versions || 1); }).join('|');
    if (!force && _pub.sig === sig && _pub.groups) return _pub.groups;
    _pub.state = 'loading'; _pub.error = null; notify();
    var carriers = await Promise.all(metas.map(async function (m) {
      try {
        var a = await root.NpjArticles.loadArticle(m.slug);
        if (!a) return null;
        return { id: 'pub:' + m.slug, title: a.headline || m.headline || m.slug, kind: 'published', slug: m.slug, project: null, cites: citesFromArticle(a) };
      } catch (e) { return null; }
    }));
    _pub.groups = buildGroups(carriers.filter(Boolean));
    _pub.sig = sig; _pub.state = 'ok';
    notify();
    return _pub.groups;
  }

  root.NpjSources = {
    signatureOf: signatureOf, srcKind: srcKind, iaIdentifier: iaIdentifier, normUrl: normUrl,
    buildGroups: buildGroups, draftGroups: draftGroups, projectSources: projectSources, citesFromArticle: citesFromArticle,
    buildPublishedIndex: buildPublishedIndex,
    publishedGroups: function () { return _pub.groups; },
    publishedState: function () { return _pub.state; },
    onChange: onChange
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjSources;
})(typeof window !== 'undefined' ? window : this);
