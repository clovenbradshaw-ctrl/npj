/* ============================================================
   citey-assist.js — Citey's mechanical drafting helpers. NO MODEL.

   The two jobs Citey does FOR the author, both fully deterministic:
     • suggestTags(draft, columns) — pull tag + column ideas from the people,
       places and orgs named in the draft (frequency-ranked proper nouns).
     • rankSpans(claim, sourceText) — split a source into sentences and rank
       them by how many of the claim's content words each carries, so the
       author can PIN the exact line that backs a claim. Citey proposes; the
       AUTHOR pins. A citation is never a whole page.

   Plain script — publishes window.CiteyAssist and keeps readDraft() global
   (existing call sites use it).
   ============================================================ */
(function (root) {
  'use strict';

  // Read the live draft surface (headline + body text).
  function readDraft() {
    var doc = root.document;
    var el = doc && doc.querySelector('.md-preview, .cmp-body');
    if (!el) return { el: null, text: '', title: 'Draft' };
    var titleEl = doc.querySelector('textarea[placeholder="Headline"]');
    var h1 = el.querySelector('h1');
    var title = (titleEl && titleEl.value) || (h1 && h1.innerText) || 'Draft';
    var text = (el.innerText || '').replace(/​/g, '').trim();
    return { el: el, text: text, title: title };
  }

  function slugTag(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28); }

  var STOP = new Set(('the a an and or but for nor so yet of to in on at by with from into over after before about '
    + 'as is are was were be been being this that these those it its their there here they them then than have has '
    + 'had will would could should may might must can not you your our we us he she his her him who what when where '
    + 'which while because during against between among through above below up down out off only just also more '
    + 'most some any each').split(/\s+/));

  // Tag ideas: frequency-ranked proper-noun phrases + recurring significant words,
  // plus a column hint when the draft names one. Mechanical entity surfacing — no model.
  function suggestTags(d, columns) {
    var out = [], seen = new Set();
    var add = function (t) { var s = slugTag(t); if (s && s.length > 2 && !seen.has(s)) { seen.add(s); out.push({ tag: s, label: t }); } };
    var text = (d.text || '') + ' ';
    var phrases = text.match(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,2})\b/g) || [];
    var freq = {};
    phrases.forEach(function (p) { var k = p.trim(); if (k.length > 2 && !STOP.has(k.toLowerCase())) freq[k] = (freq[k] || 0) + 1; });
    Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 6).forEach(add);
    var words = {};
    (text.toLowerCase().match(/\b[a-z][a-z'-]{4,}\b/g) || []).forEach(function (w) { if (!STOP.has(w)) words[w] = (words[w] || 0) + 1; });
    Object.keys(words).filter(function (w) { return words[w] > 1; }).sort(function (a, b) { return words[b] - words[a]; }).slice(0, 4).forEach(add);
    var lower = (text + ' ' + (d.title || '')).toLowerCase();
    var colMatch = (columns || []).filter(function (c) { return lower.includes(String(c).toLowerCase()); });
    return { tags: out.slice(0, 8), column: colMatch[0] || null };
  }

  // Find the span IN THE SOURCE that backs a claim. Pure mechanics: split the
  // source into sentences, score each by how many of the claim's content words
  // it carries, return the best few. This is how a citation binds to specific
  // words, not a whole page.
  function keywords(s) {
    return (String(s || '').toLowerCase().match(/\b[a-z0-9][a-z0-9'-]{2,}\b/g) || []).filter(function (w) { return !STOP.has(w); });
  }
  function rankSpans(claimText, sourceText) {
    var want = new Set(keywords(claimText));
    if (!want.size) return [];
    var sentences = (String(sourceText || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g) || [])
      .map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 12; });
    var scored = sentences.map(function (s) {
      var seen = new Set(), hit = 0;
      keywords(s).forEach(function (w) { if (want.has(w) && !seen.has(w)) { seen.add(w); hit++; } });
      return { s: s, hit: hit, score: hit / want.size };
    }).filter(function (x) { return x.hit > 0; }).sort(function (a, b) { return b.score - a.score || a.s.length - b.s.length; });
    return scored.slice(0, 3);
  }

  function clip(t, n) { n = n || 150; t = String(t || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  root.readDraft = readDraft;   // kept global — existing call sites use it
  root.CiteyAssist = { readDraft: readDraft, suggestTags: suggestTags, rankSpans: rankSpans, clip: clip, slugTag: slugTag };
})(typeof window !== 'undefined' ? window : this);
