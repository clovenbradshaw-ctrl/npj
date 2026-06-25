/* ============================================================
   citations.js — the Citation Registry. NO MODEL.

   A CITATION is a span of a source: a source key + the exact pinned words that
   back a claim. Unlike today's inline `data-quote`, a citation here is a
   FIRST-CLASS REUSABLE RECORD, keyed by id and held in window.NPJ.CITATIONS.
   One citation can back many sentences; deleting a sentence (or detaching it)
   never destroys the record.

   The blast radius is contained by a single rule: the registry is ADDITIVE.
   `data-cite-id` on a .claim-src span points at the citation record(s), and
   projectAttrs() re-derives the OLD attributes (`data-src`, `data-quote`, and
   `data-quotes`) from them — so CiteyBrain, publishGate and articles.js keep
   reading exactly what they always have.

   Plain script — publishes window.NpjCitations. Requires window.NPJ (data.js).
   ============================================================ */
(function (root) {
  'use strict';

  function reg() {
    if (!root.NPJ) return {};
    if (!root.NPJ.CITATIONS) root.NPJ.CITATIONS = {};
    return root.NPJ.CITATIONS;
  }
  function nowIso() { return new Date().toISOString(); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function cmp(s) { return norm(s).toLowerCase(); }   // dedupe key: whitespace- and case-insensitive
  function newId() { return 'ci-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

  // Mint a citation, de-duping on srcKey + normalized quote so the same span of
  // the same source is one record no matter how many times it's pinned.
  // `spans` (optional) carries a MULTI-PART pin — [{ quote, loc }, …] when the
  // support lives in more than one place in the source; the joined quote stays
  // the record's quote so every legacy reader is unchanged.
  function mint(opts) {
    opts = opts || {};
    var srcKey = opts.srcKey || null;
    var raw = String(opts.quote || '');
    var key = cmp(raw);
    if (!key) return null;
    var spans = (opts.spans && opts.spans.length > 1) ? opts.spans : null;
    var R = reg();
    for (var id in R) {
      if (R[id].srcKey === srcKey && cmp(R[id].quote) === key) {
        if (opts.loc && !R[id].loc) R[id].loc = opts.loc;       // enrich with offsets if newly known
        if (spans && !R[id].spans) R[id].spans = spans;
        return id;
      }
    }
    var cid = newId();
    R[cid] = { id: cid, srcKey: srcKey, quote: raw.trim(), loc: opts.loc || null, spans: spans, createdAt: nowIso(), label: raw.trim().slice(0, 48) };
    return cid;
  }

  function get(id) { return reg()[id] || null; }
  function all() { var R = reg(); return Object.keys(R).map(function (k) { return R[k]; }); }
  function forSource(k) { return all().filter(function (c) { return c.srcKey === k; }); }
  function remove(id) { delete reg()[id]; }

  // ---- span <-> citation attribute plumbing ----
  function ids(span) {
    return String((span && span.getAttribute && span.getAttribute('data-cite-id')) || '')
      .split(/\s+/).filter(Boolean);
  }
  function setIds(span, list) {
    if (!span || !span.setAttribute) return;
    var uniq = [];
    list.forEach(function (x) { if (x && uniq.indexOf(x) < 0) uniq.push(x); });
    if (uniq.length) span.setAttribute('data-cite-id', uniq.join(' '));
    else span.removeAttribute('data-cite-id');
  }
  function citationsFor(span) { return ids(span).map(get).filter(Boolean); }

  // THE single writer. Re-derive the legacy attributes from the attached
  // citation records so every downstream reader (CiteyBrain, publishGate,
  // htmlToBlocks) keeps working unchanged. Tolerant of missing ids; never throws.
  function projectAttrs(span) {
    if (!span || !span.setAttribute) return;
    var cites = citationsFor(span);
    if (!cites.length) return;                 // nothing attached — leave legacy attrs alone
    var keys = [], qmap = {};
    cites.forEach(function (c) {
      if (keys.indexOf(c.srcKey) < 0) keys.push(c.srcKey);
      if (c.srcKey && qmap[c.srcKey] == null) qmap[c.srcKey] = c.quote;
    });
    span.setAttribute('data-src', keys.filter(Boolean).join(' '));
    span.setAttribute('data-quote', cites[0].quote || '');         // CiteyBrain truthiness read
    if (keys.length > 1) span.setAttribute('data-quotes', JSON.stringify(qmap));
    else span.removeAttribute('data-quotes');
    if (span.classList) span.classList.remove('needs-quote');
    syncSups(span, qmap);
  }

  // Keep the sibling sup.md-cite markers in sync — the publish path
  // (articles.js htmlToBlocks md-cite branch) reads the quote off the sup.
  function syncSups(span, qmap) {
    var cid = span.getAttribute && span.getAttribute('data-cid');
    var doc = span.ownerDocument || root.document;
    if (!cid || !doc) return;
    var sups = Array.prototype.slice.call(doc.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]'));
    var firstKey = Object.keys(qmap)[0];
    sups.forEach(function (sup) {
      var key = sup.getAttribute('data-cite');
      var q = (key && qmap[key] != null) ? qmap[key] : (firstKey ? qmap[firstKey] : '');
      sup.setAttribute('data-quote', q || '');
      sup.setAttribute('data-cite-id', span.getAttribute('data-cite-id') || '');
    });
  }

  function attach(span, id) {
    if (!span || !id) return;
    setIds(span, ids(span).concat([id]));
    projectAttrs(span);
  }
  function detach(span, id) {
    if (!span) return;
    setIds(span, ids(span).filter(function (x) { return x !== id; }));
    if (ids(span).length) projectAttrs(span);
    else {
      // last citation unlinked — back to an ungrounded (needs-quote) claim, but
      // still bound to its source so the author can re-pin
      span.setAttribute('data-quote', '');
      span.removeAttribute('data-quotes');
      if (span.classList && !span.getAttribute('data-stance')) span.classList.add('needs-quote');
      syncSups(span, {});
    }
  }

  // Which live claim spans currently reference this citation id (for "reused in
  // N sentences" + safe detach). Deleting a sentence never deletes the record.
  function usage(id, rootEl) {
    var r = rootEl || root.document;
    if (!r) return [];
    var out = [];
    Array.prototype.slice.call(r.querySelectorAll('.claim-src[data-cite-id]')).forEach(function (el) {
      if (ids(el).indexOf(id) >= 0) out.push(el);
    });
    return out;
  }

  // Lazy migration of legacy spans: a span with an inline data-quote but no
  // data-cite-id gets a citation minted from it. Idempotent — guarded on an
  // existing data-cite-id so re-opening a migrated draft never double-mints.
  function migrateFromQuote(span) {
    if (!span || !span.getAttribute) return null;
    if (ids(span).length) return null;                    // already has citation records
    if (span.getAttribute('data-stance')) return null;    // owned claim, not a citation
    var quote = norm(span.getAttribute('data-quote'));
    if (!quote) return null;
    var srcKey = (span.getAttribute('data-src') || '').split(/\s+/).filter(Boolean)[0] || null;
    var id = mint({ srcKey: srcKey, quote: span.getAttribute('data-quote') });
    if (id) attach(span, id);
    return id;
  }
  // Walk a root and migrate every legacy span (called on draft restore).
  function migrateRoot(rootEl) {
    if (!rootEl) return 0;
    var n = 0;
    Array.prototype.slice.call(rootEl.querySelectorAll('.claim-src')).forEach(function (el) {
      if (migrateFromQuote(el)) n++;
    });
    return n;
  }

  // ---- context links: sources cited for CONTEXT, not proof ----
  // A second, lighter relation a claim span can carry: prior coverage it BUILDS
  // ON — the context of past articles — rather than a pinned line that proves it.
  // Stored as `data-context` (space-separated source keys), kept deliberately
  // apart from the proof plumbing (data-src / data-quote / data-cite-id) so the
  // publish gate and CiteyBrain — which only read proof — never see it. A sentence
  // can thus be BOTH grounded (proved) AND set in context of prior coverage.
  function contextKeys(span) {
    return String((span && span.getAttribute && span.getAttribute('data-context')) || '')
      .split(/\s+/).filter(Boolean);
  }
  function setContextKeys(span, list) {
    if (!span || !span.setAttribute) return;
    var uniq = [];
    (list || []).forEach(function (x) { if (x && uniq.indexOf(x) < 0) uniq.push(x); });
    if (uniq.length) span.setAttribute('data-context', uniq.join(' '));
    else span.removeAttribute('data-context');
  }
  function addContext(span, key) { if (span && key) setContextKeys(span, contextKeys(span).concat([key])); }
  function removeContext(span, key) { if (span) setContextKeys(span, contextKeys(span).filter(function (x) { return x !== key; })); }
  function hasContext(span) { return contextKeys(span).length > 0; }

  function serialize() { return all(); }
  function hydrate(arr) {
    var R = reg();
    (arr || []).forEach(function (c) { if (c && c.id) R[c.id] = c; });
  }

  root.NpjCitations = {
    mint: mint, get: get, all: all, forSource: forSource, remove: remove,
    ids: ids, citationsFor: citationsFor, projectAttrs: projectAttrs,
    attach: attach, detach: detach, usage: usage,
    contextKeys: contextKeys, addContext: addContext, removeContext: removeContext, hasContext: hasContext,
    migrateFromQuote: migrateFromQuote, migrateRoot: migrateRoot,
    serialize: serialize, hydrate: hydrate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjCitations;
})(typeof window !== 'undefined' ? window : this);
