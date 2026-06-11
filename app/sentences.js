/* ============================================================
   sentences.js — derive sentence RECORDS from the live editor. NO MODEL.

   The table view treats every sentence as a record that needs grounding. Rather
   than store wrapper spans in the editor HTML (which would leak into published
   articles), sentences are DERIVED on demand from the contentEditable DOM and
   carry stable, content-hashed ids.

   Sentence boundaries use the SAME regex as articles.js splitClaim, so a row in
   the table lines up with a claim at publish time.

   Plain script — publishes window.NpjSentences.
   ============================================================ */
(function (root) {
  'use strict';

  // djb2 → 7 hex (mirrors articles.js lineSha) — a stable id from the words.
  function djb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return ('0000000' + h.toString(16)).slice(-7);
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  // Sentence splitter — identical family to articles.js splitClaim (~L229).
  function splitOffsets(text) {
    var re = /[.!?…]["')\]]?\s+(?=\S)/g;
    var out = [], last = 0, m;
    while ((m = re.exec(text))) {
      var end = m.index + m[0].length;
      out.push({ start: last, end: end, text: text.slice(last, end) });
      last = end;
    }
    if (last < text.length) out.push({ start: last, end: text.length, text: text.slice(last) });
    return out.filter(function (s) { return s.text.trim(); });
  }

  // Build a Range spanning [start,end] character offsets over a block's text,
  // walking its text nodes so claim spans inside are respected.
  function rangeForBlock(block, start, end, doc) {
    var range = doc.createRange();
    var pos = 0, setStart = false, setEnd = false, node;
    var walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    while ((node = walker.nextNode())) {
      var len = node.nodeValue.length;
      if (!setStart && start <= pos + len) { range.setStart(node, Math.max(0, start - pos)); setStart = true; }
      if (setStart && !setEnd && end <= pos + len) { range.setEnd(node, Math.max(0, end - pos)); setEnd = true; break; }
      pos += len;
    }
    if (!setStart) return null;
    if (!setEnd) range.setEnd(block, block.childNodes.length);
    return range;
  }

  // Walk the editor's block elements and return one record per sentence.
  function segment(rootEl) {
    if (!rootEl) return [];
    var doc = rootEl.ownerDocument || root.document;
    var blocks = Array.prototype.slice.call(rootEl.querySelectorAll('p, li, h2, h3'));
    var rows = [], seen = {};
    blocks.forEach(function (block, bi) {
      if (block.classList && block.classList.contains('nr-dek')) return;          // the dek isn't body prose
      if (block.closest && (block.closest('figure') || block.closest('pre'))) return;
      var text = block.textContent || '';
      if (!text.trim()) return;
      splitOffsets(text).forEach(function (p, si) {
        var range = rangeForBlock(block, p.start, p.end, doc);
        var claimSpans = [], disp = p.text;
        if (range) {
          Array.prototype.slice.call(block.querySelectorAll('.claim-src')).forEach(function (el) {
            try { if (range.intersectsNode(el)) claimSpans.push(el); } catch (e) {}
          });
          // display text without the citation-number markers (sup.md-cite) so the
          // table shows clean prose; the id hashes the clean text so pinning a
          // citation (which adds a marker) doesn't change a sentence's identity
          try {
            var tmp = doc.createElement('div'); tmp.appendChild(range.cloneContents());
            Array.prototype.slice.call(tmp.querySelectorAll('sup.md-cite')).forEach(function (s) { s.remove(); });
            disp = (tmp.textContent || '').trim() || p.text;
          } catch (e) {}
        }
        var sid = 'se-' + djb2(norm(disp));
        if (seen[sid]) { seen[sid]++; sid = sid + '-' + seen[sid]; } else seen[sid] = 1;
        rows.push({
          sid: sid, blockIndex: bi, sentenceIndex: si,
          text: disp.trim(), block: block, start: p.start, end: p.end,
          claimSpans: claimSpans
        });
      });
    });
    return rows;
  }

  // Rebuild a live Range for a row so callers can scroll to / select it.
  function rangeFor(row) {
    if (!row || !row.block) return null;
    var doc = row.block.ownerDocument || root.document;
    return rangeForBlock(row.block, row.start, row.end, doc);
  }

  root.NpjSentences = { segment: segment, rangeFor: rangeFor, djb2: djb2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjSentences;
})(typeof window !== 'undefined' ? window : this);
