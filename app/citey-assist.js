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

  // Find the span IN THE SOURCE that backs a claim. Pure mechanics, no model.
  // This is how a citation binds to specific words, not a whole page. The ranker
  // got smarter without changing its contract — every existing caller benefits:
  //   • multi-sentence windows (1–3 sentences) so a claim spanning a boundary matches
  //   • rarer source words weigh more than ubiquitous ones (light TF/IDF flavour)
  //   • light stemming + edit-distance ≤1 so reported/reports/reporting align
  //   • a contiguous-bigram bonus that rewards verbatim phrasing
  // Returns [{ s, hit, score, loc:{start,end} }] — loc are char offsets into
  // sourceText so the picker can pre-highlight the span.
  function keywords(s) {
    return (String(s || '').toLowerCase().match(/\b[a-z0-9][a-z0-9'-]{2,}\b/g) || []).filter(function (w) { return !STOP.has(w); });
  }
  // crude stem: drop a common inflectional suffix so word forms collapse together
  function stem(w) {
    w = String(w || '');
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /(ed|es)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  // bounded edit distance — returns true if Levenshtein(a,b) <= max (cheap; only
  // called on words of similar length that didn't already stem-match)
  function near(a, b, max) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > max) return false;
    var dp = []; for (var i = 0; i <= b.length; i++) dp[i] = i;
    for (var x = 1; x <= a.length; x++) {
      var prev = dp[0]; dp[0] = x; var best = dp[0];
      for (var y = 1; y <= b.length; y++) {
        var tmp = dp[y];
        dp[y] = Math.min(dp[y] + 1, dp[y - 1] + 1, prev + (a[x - 1] === b[y - 1] ? 0 : 1));
        prev = tmp; if (dp[y] < best) best = dp[y];
      }
      if (best > max) return false;   // whole row already exceeds budget
    }
    return dp[b.length] <= max;
  }
  // split source into sentence units carrying their TRIMMED char offsets (so a
  // unit's [start,end] slices back to exactly its text)
  function unit(t, lo, hi) {
    var raw = t.slice(lo, hi);
    var lead = raw.length - raw.replace(/^\s+/, '').length;
    var trail = raw.length - raw.replace(/\s+$/, '').length;
    return { s: raw.trim(), start: lo + lead, end: hi - trail };
  }
  function sourceUnits(sourceText) {
    var t = String(sourceText || ''); var out = [], last = 0, m;
    var re = /[.!?…]["')\]]?\s+(?=\S)/g;
    while ((m = re.exec(t))) { var end = m.index + m[0].length; out.push(unit(t, last, end)); last = end; }
    if (last < t.length) out.push(unit(t, last, t.length));
    return out.filter(function (u) { return u.s.length > 12; });
  }
  function rankSpans(claimText, sourceText) {
    var claimWords = keywords(claimText).map(stem);
    var want = new Set(claimWords);
    if (!want.size) return [];
    var wantArr = Array.from(want);
    var units = sourceUnits(sourceText);
    if (!units.length) return [];

    // document frequency of each wanted word across source units → rarer = heavier
    var df = {}; wantArr.forEach(function (w) { df[w] = 0; });
    var unitStems = units.map(function (u) {
      var st = keywords(u.s).map(stem); var set = new Set(st);
      wantArr.forEach(function (w) { if (set.has(w)) df[w]++; }); return st;
    });
    var idf = {}; wantArr.forEach(function (w) { idf[w] = Math.log(1 + units.length / (1 + df[w])); });
    var totalW = wantArr.reduce(function (a, w) { return a + idf[w]; }, 0) || 1;

    // claim bigrams (consecutive content words) for the verbatim-phrasing bonus
    var cbg = [];
    for (var i = 0; i + 1 < claimWords.length; i++) cbg.push(claimWords[i] + ' ' + claimWords[i + 1]);

    function scoreUnit(stems) {
      var seen = new Set(), w = 0, hit = 0;
      stems.forEach(function (s) {
        var match = want.has(s);
        if (!match) { for (var k = 0; k < wantArr.length; k++) { if (Math.abs(wantArr[k].length - s.length) <= 1 && near(wantArr[k], s, 1)) { s = wantArr[k]; match = true; break; } } }
        if (match && !seen.has(s)) { seen.add(s); w += (idf[s] || 0); hit++; }
      });
      var phrase = stems.join(' '), bonus = 0;
      cbg.forEach(function (bg) { if (phrase.indexOf(bg) >= 0) bonus += 0.15; });
      return { score: (w / totalW) + bonus, hit: hit };
    }

    var cand = [];
    for (var a = 0; a < units.length; a++) {
      for (var win = 1; win <= 3 && a + win <= units.length; win++) {
        var stems = []; for (var b = a; b < a + win; b++) stems = stems.concat(unitStems[b]);
        var r = scoreUnit(stems);
        if (r.hit > 0) {
          var first = units[a], lastU = units[a + win - 1];
          // boundaries are already trimmed, so this slices back to `text` exactly
          var text = String(sourceText).slice(first.start, lastU.end);
          // a longer window must beat a tighter one by enough to justify the extra words
          cand.push({ s: text, hit: r.hit, score: r.score - (win - 1) * 0.04, loc: { start: first.start, end: lastU.end } });
        }
      }
    }
    cand.sort(function (x, y) { return y.score - x.score || x.s.length - y.s.length; });
    // de-dupe overlapping windows, keep the best few
    var out = [];
    cand.forEach(function (c) {
      if (out.length >= 4) return;
      if (out.some(function (o) { return c.loc.start < o.loc.end && o.loc.start < c.loc.end; })) return;
      out.push(c);
    });
    return out;
  }

  function clip(t, n) { n = n || 150; t = String(t || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  root.readDraft = readDraft;   // kept global — existing call sites use it
  root.CiteyAssist = { readDraft: readDraft, suggestTags: suggestTags, rankSpans: rankSpans, clip: clip, slugTag: slugTag };
})(typeof window !== 'undefined' ? window : this);
