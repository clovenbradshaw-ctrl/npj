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

  // Sentence splitter — identical family to articles.js splitClaim (~L526).
  // `mask` (optional) lists [start,end) character ranges to read as TRANSPARENT
  // while finding boundaries: their characters are blanked to spaces for the
  // scan only. Inline citation markers (<sup class="md-cite"> — a "1"/"2"/"•")
  // land in block.textContent BETWEEN a sentence's end punctuation and the next
  // sentence's leading space ("…Kupin." + "1" + " In…"); unmasked, the splitter
  // sees "." followed by a digit (not whitespace) and merges the two sentences
  // into one grounding row. Offsets returned index the ORIGINAL text, so callers
  // still slice the real characters (marker included; display is cleaned later).
  function splitOffsets(text, mask) {
    var scan = text;
    if (mask && mask.length) {
      var a = text.split('');
      mask.forEach(function (m) {
        for (var i = Math.max(0, m[0]); i < Math.min(a.length, m[1]); i++) a[i] = ' ';
      });
      scan = a.join('');
    }
    var re = /[.!?…]["')\]]?\s+(?=\S)/g;
    var out = [], last = 0, m;
    while ((m = re.exec(scan))) {
      var end = m.index + m[0].length;
      out.push({ start: last, end: end, text: text.slice(last, end) });
      last = end;
    }
    if (last < text.length) out.push({ start: last, end: text.length, text: text.slice(last) });
    return out.filter(function (s) { return s.text.trim(); });
  }

  // Character spans (in block.textContent terms) of each line a hard <br> ends.
  // A <br> is 0-width in textContent, so it only marks a boundary; the offsets
  // line up with rangeForBlock's text-node walk. Consecutive breaks yield empty
  // spans the caller skips; a block with no <br> yields one span over the whole.
  function lineSpans(block, total) {
    var breaks = [], pos = 0;
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) pos += c.nodeValue.length;
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') breaks.push(pos);
          else walk(c);
        }
      }
    })(block);
    var bounds = [0].concat(breaks, [total]), out = [];
    for (var i = 0; i + 1 < bounds.length; i++) out.push({ start: bounds[i], end: bounds[i + 1] });
    return out;
  }

  // Character ranges (in block.textContent terms) covered by inline citation
  // markers — <sup class="md-cite">. The reader sees a superscript "1"/"2"/"•",
  // but in textContent the marker's text sits inline and can wedge between a
  // sentence's end punctuation and the next sentence's leading space, hiding the
  // boundary from splitOffsets (a grounded sentence would otherwise swallow the
  // sentence that follows it). segment() hands these to splitOffsets as a mask.
  // Mirrors lineSpans' position accounting: every text node is counted, and a
  // marker's own text is counted once (not recursed into).
  function markerRanges(block) {
    if (!block || !block.querySelector || !block.querySelector('sup.md-cite')) return [];
    var out = [], pos = 0;
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) pos += c.nodeValue.length;
        else if (c.nodeType === 1) {
          if (c.tagName === 'SUP' && c.classList && c.classList.contains('md-cite')) {
            var len = (c.textContent || '').length;
            if (len) out.push([pos, pos + len]);
            pos += len;
          } else walk(c);
        }
      }
    })(block);
    return out;
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

  // Tags whose text belongs to THEIR OWN row (or to no row), never to a
  // containing block's "direct text" — so a wrapper that holds them contributes
  // only its own loose prose and they're each captured on their own pass.
  var SEG_BLOCK = { P: 1, LI: 1, H1: 1, H2: 1, H3: 1, BLOCKQUOTE: 1, DIV: 1, UL: 1, OL: 1, PRE: 1, FIGURE: 1, TABLE: 1 };
  function isSegBlock(el) { return !!(el && el.nodeType === 1 && el.tagName && SEG_BLOCK[el.tagName]); }

  // Character ranges (block.textContent coords) covered by DESCENDANT block-level
  // elements — text that belongs to THOSE blocks' rows. Mirrors markerRanges'
  // position walk: a block element's whole text is one range and we don't recurse
  // into it (anything deeper is already inside that range).
  function nestedBlockRanges(block) {
    var out = [], pos = 0;
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) pos += c.nodeValue.length;
        else if (c.nodeType === 1) {
          if (isSegBlock(c)) { var len = (c.textContent || '').length; if (len) out.push([pos, pos + len]); pos += len; }
          else walk(c);
        }
      }
    })(block);
    return out;
  }

  // A block's OWN direct-text windows: [0,total] minus the ranges its nested block
  // children occupy. A leaf block (no nested block) yields ONE window over the whole
  // text — byte-for-byte the old behaviour. A pure wrapper yields none. A mixed
  // block (lead-in prose, then a pasted list, say) yields its loose prose — which
  // the old "skip any container" rule dropped on the floor, losing those sentences
  // from the grounding table entirely.
  function directRuns(block, total) {
    var br = nestedBlockRanges(block);
    if (!br.length) return [{ start: 0, end: total }];
    br.sort(function (a, b) { return a[0] - b[0]; });
    var runs = [], cur = 0;
    br.forEach(function (r) { if (r[0] > cur) runs.push({ start: cur, end: r[0] }); cur = Math.max(cur, r[1]); });
    if (cur < total) runs.push({ start: cur, end: total });
    return runs;
  }

  // Does an element hold prose directly (a bare text node or an inline element),
  // outside any block child? Loose text typed/pasted at the contentEditable root
  // (wrapped in no <p>) lives here and would otherwise never be segmented.
  function hasBareText(el) {
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 && c.nodeValue && c.nodeValue.trim()) return true;
      if (c.nodeType === 1 && !isSegBlock(c) && (c.textContent || '').trim()) return true;
    }
    return false;
  }

  // Walk the editor's block elements and return one record per sentence.
  // Blocks: p / li / h2 / h3 / blockquote AND div — the composer sets
  // defaultParagraphSeparator=p, so typed paragraphs are <p>s, but pasted markup
  // can still arrive as <div>s or nested containers. These are exactly the blocks
  // the publish walker (articles.js htmlToBlocks) treats as prose, so the table
  // sees the same prose it will ship. A hard <br> inside a block ends a line — and
  // a sentence — even with no trailing space, mirroring the {t:'br'} published
  // tokens. Each block contributes only its OWN direct text (directRuns); nested
  // blocks are captured on their own pass, so a mixed container no longer drops its
  // loose prose, and bare text at the root is picked up too.
  function segment(rootEl) {
    if (!rootEl) return [];
    var doc = rootEl.ownerDocument || root.document;
    var blocks = Array.prototype.slice.call(rootEl.querySelectorAll('p, li, h2, h3, blockquote, div'));
    // the root itself is a candidate when it holds loose prose of its own, so text
    // pasted/typed as bare nodes under the contentEditable (wrapped in no block) is
    // still captured; a normal article's root is all block children, so it adds none.
    if (hasBareText(rootEl)) blocks.unshift(rootEl);
    var rows = [], seen = {};
    blocks.forEach(function (block, bi) {
      if (block.classList && block.classList.contains('nr-dek')) return;          // the dek isn't body prose
      if (block.closest && (block.closest('figure') || block.closest('pre') || block.closest('.cmp-widget'))) return;
      var text = block.textContent || '';
      if (!text.trim()) return;
      var marks = markerRanges(block);                                             // sup.md-cite spans → masked out of boundary detection
      var lines = lineSpans(block, text.length);
      var si = 0;
      directRuns(block, text.length).forEach(function (run) {
        lines.forEach(function (ln) {
          var ls = Math.max(ln.start, run.start), le = Math.min(ln.end, run.end);  // this line, clipped to the direct-text window
          if (le <= ls) return;
          if (!text.slice(ls, le).trim()) return;                                  // empty line (e.g. <br><br>)
          var lineMask = marks.length ? marks.map(function (m) { return [m[0] - ls, m[1] - ls]; }) : null;
          splitOffsets(text.slice(ls, le), lineMask).forEach(function (p) {
            var start = ls + p.start, end = ls + p.end;
            var range = rangeForBlock(block, start, end, doc);
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
            var nm = norm(disp);
            var hsh = djb2(nm);
            var sid = 'se-' + hsh;                      // provisional, content-derived
            if (seen[sid]) { seen[sid]++; sid = sid + '-' + seen[sid]; } else seen[sid] = 1;
            rows.push({
              sid: sid, hash: hsh, norm: nm, blockIndex: bi, sentenceIndex: si++,
              text: disp.trim(), block: block, start: start, end: end,
              claimSpans: claimSpans
            });
          });
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

  /* ============================================================
     Stable sentence identity + provenance ledger.

     A sentence's content hash changes the instant you edit a word, which would
     orphan its grounding the moment the author touches the prose. The ledger
     gives every sentence a STABLE id (sn-…) that FOLLOWS it through edits and
     reordering, carrying its provenance — when it first appeared, when it was
     first grounded, the citation records attached, the owned stance. The id
     rides the draft (serialize/hydrate) so it survives a reload and a device
     switch, exactly like the citation registry it indexes.

     Identity is re-derived on every segmentation by reconciling the live
     sentences against the previous ledger:
       A. exact content-hash match (unchanged text, possibly moved) keeps its id
       B. otherwise the closest surviving sentence by word overlap keeps its id
          (this is the "follows it if it changes" case — an edited sentence)
       C. anything left is genuinely new and mints a fresh id
     Citations themselves already ride the .claim-src spans (data-cid /
     data-cite-id), which physically move with the text; the ledger indexes that
     linkage by a stable per-sentence key so the grounding view never loses the
     thread. NO MODEL — pure set overlap. ============================================================ */
  function tokens(nm) { return nm ? nm.split(' ').filter(Boolean) : []; }
  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var A = {}, B = {}, i;
    for (i = 0; i < a.length; i++) A[a[i]] = 1;
    for (i = 0; i < b.length; i++) B[b[i]] = 1;
    var ka = Object.keys(A), kb = Object.keys(B), inter = 0;
    for (i = 0; i < ka.length; i++) if (B[ka[i]]) inter++;
    var uni = ka.length + kb.length - inter;
    return uni ? inter / uni : 0;
  }
  function citeIdsOf(span) {
    try { return (root.NpjCitations && root.NpjCitations.ids) ? root.NpjCitations.ids(span) : []; }
    catch (e) { return []; }
  }
  function provenanceOf(row) {
    var ids = {}, stance = null;
    (row.claimSpans || []).forEach(function (s) {
      citeIdsOf(s).forEach(function (id) { ids[id] = 1; });
      var st = s.getAttribute && s.getAttribute('data-stance');
      if (st) stance = st;
    });
    return { citeIds: Object.keys(ids), stance: stance };
  }
  var MATCH_THRESHOLD = 0.5;   // word-overlap floor for "this is the same sentence, edited"
  var STALE_MS = 90000;        // keep a vanished sentence's id this long (undo/transient)

  function newLedger() { return { v: 1, seq: 0, entries: {} }; }
  // Reconcile `rows` (from segment) against `ledger` (mutated in place); assigns
  // each row a stable `sid` and a `provenance` object, and returns `rows`.
  function reconcile(rows, ledger) {
    if (!ledger) ledger = newLedger();
    ledger.entries = ledger.entries || {};
    if (typeof ledger.seq !== 'number') ledger.seq = 0;
    var entries = ledger.entries;
    var ids = Object.keys(entries);
    var used = {}, matchOf = new Array(rows.length), now = Date.now();

    // Pass A — exact content hash, in document order, consuming duplicates.
    var byHash = {};
    ids.forEach(function (id) { var h = entries[id].hash; (byHash[h] = byHash[h] || []).push(id); });
    Object.keys(byHash).forEach(function (h) { byHash[h].sort(function (a, b) { return (entries[a].order || 0) - (entries[b].order || 0); }); });
    rows.forEach(function (r, i) {
      var q = byHash[r.hash];
      while (q && q.length) { var id = q.shift(); if (!used[id]) { used[id] = 1; matchOf[i] = id; break; } }
    });

    // Pass B — fuzzy: an edited sentence keeps the id of its closest survivor.
    var freeIds = ids.filter(function (id) { return !used[id]; });
    var unmatched = [];
    rows.forEach(function (r, i) { if (!matchOf[i]) unmatched.push(i); });
    if (unmatched.length && freeIds.length) {
      var pairs = [];
      var rtok = {}; unmatched.forEach(function (i) { rtok[i] = tokens(rows[i].norm); });
      var etok = {}; freeIds.forEach(function (id) { etok[id] = tokens(entries[id].norm); });
      unmatched.forEach(function (i) {
        freeIds.forEach(function (id) {
          var sc = jaccard(rtok[i], etok[id]);
          if (sc >= MATCH_THRESHOLD) pairs.push({ i: i, id: id, sc: sc, dist: Math.abs(i - (entries[id].order || 0)) });
        });
      });
      pairs.sort(function (a, b) { return b.sc - a.sc || a.dist - b.dist; });
      var rowTaken = {};
      pairs.forEach(function (p) {
        if (matchOf[p.i] || used[p.id] || rowTaken[p.i]) return;
        matchOf[p.i] = p.id; used[p.id] = 1; rowTaken[p.i] = 1;
      });
    }

    // Pass C — mint a fresh stable id for anything genuinely new, then update the
    // matched entry with the current text + provenance.
    rows.forEach(function (r, i) {
      var id = matchOf[i];
      if (!id) {
        id = 'sn-' + (++ledger.seq).toString(36) + '-' + djb2(r.norm + '|' + now + '|' + i).slice(0, 4);
        entries[id] = { sid: id, firstSeen: now, groundedAt: null };
      }
      var e = entries[id];
      var prov = provenanceOf(r);
      e.hash = r.hash; e.norm = r.norm; e.order = i; e.updated = now; e.missingSince = 0;
      if (!e.firstSeen) e.firstSeen = now;
      var grounded = prov.citeIds.length > 0 || !!prov.stance;
      if (grounded && !e.groundedAt) e.groundedAt = now;   // sticky: first time it was grounded
      e.citeIds = prov.citeIds; e.stance = prov.stance;
      r.sid = id;
      r.provenance = { firstSeen: e.firstSeen, updated: now, groundedAt: e.groundedAt, citeIds: prov.citeIds, stance: prov.stance };
    });

    // Age out sentences that have vanished; prune only once they're well past
    // the undo window AND the ledger has clearly drifted larger than the prose.
    var liveCount = rows.length;
    ids.forEach(function (id) {
      if (used[id]) return;
      var e = entries[id];
      if (!e.missingSince) e.missingSince = now;
      if (now - e.missingSince > STALE_MS && Object.keys(entries).length > liveCount + 60) delete entries[id];
    });
    return rows;
  }

  // segment + reconcile in one call — the live, stable-id view the grounding
  // workspace renders. Pass the draft's persisted ledger object (mutated here).
  function track(rootEl, ledger) { return reconcile(segment(rootEl), ledger); }

  // Compact, JSON-safe copy for the draft (drops nothing meaningful; transient
  // match scratch is never stored on entries).
  function serializeLedger(ledger) {
    if (!ledger || !ledger.entries) return { v: 1, seq: 0, entries: {} };
    var out = { v: 1, seq: ledger.seq || 0, entries: {} };
    Object.keys(ledger.entries).forEach(function (id) {
      var e = ledger.entries[id];
      out.entries[id] = { sid: e.sid, hash: e.hash, norm: e.norm, order: e.order, firstSeen: e.firstSeen, updated: e.updated, groundedAt: e.groundedAt || null, citeIds: e.citeIds || [], stance: e.stance || null, missingSince: e.missingSince || 0 };
    });
    return out;
  }
  function hydrateLedger(obj) {
    var l = newLedger();
    if (obj && obj.entries) { l.seq = obj.seq || 0; l.entries = obj.entries; }
    return l;
  }

  root.NpjSentences = {
    segment: segment, rangeFor: rangeFor, djb2: djb2,
    splitOffsets: splitOffsets, markerRanges: markerRanges,
    nestedBlockRanges: nestedBlockRanges, directRuns: directRuns, hasBareText: hasBareText,
    track: track, reconcile: reconcile, newLedger: newLedger,
    serializeLedger: serializeLedger, hydrateLedger: hydrateLedger
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjSentences;
})(typeof window !== 'undefined' ? window : this);
