/* authorship.js — per-SPAN "who wrote this" for the Newsroom's Authors mode:
 * color each collaborator's own words and let the author hide/show them.
 *
 * This is a live-DOM, EDITOR-ONLY view. As each person types, the run of
 * characters they actually inserted gets wrapped in
 * <span class="npj-author" data-author="<mxid>" data-author-ts>, using the
 * SAME safe wrap idiom Newsroom.jsx already trusts for citation spans
 * (Range.surroundContents, falling back to extractContents+insertNode) — so
 * an author's span can sit right in the middle of someone else's sentence,
 * or nested inside it, without disturbing the surrounding words, citations or
 * formatting. Adjacent same-author spans merge as you keep typing, so a
 * sitting collapses to one growing span per contiguous run, not one per
 * keystroke.
 *
 * These tags ride inside the draft's own HTML — the same pattern as
 * structure.js's data-sec (Invariant I1) — so they autosave and sync to
 * Matrix and survive a reload, or opening the draft on another
 * collaborator's device, exactly like the words do. But htmlToBlocks
 * (app/record/articles.js) builds every published block from a node's TEXT
 * alone; an unrecognized inline wrapper is transparently unwrapped (its text
 * survives, the element and every attribute on it don't). So none of this —
 * the colors, the tags, who hid whom — ever reaches Preview, the published
 * page, a REC edit, or any export (Substack, the source packet, the
 * .html/.md downloads). tests/authorship-leakage.test.js guards that
 * boundary.
 *
 * RETROACTIVE on an existing draft. A brand-new draft has nothing to color
 * until someone edits it — but a draft several people have already been
 * working on isn't starting from a blank slate: attributionFromSnapshots
 * replays the real save history a shared project room already keeps
 * (MatrixAuth.getRoomDocHistory — every save is a real, server-verified
 * author and timestamp, never a guess), word-diffing each paragraph between
 * consecutive saves (advanceRuns, the same LCS engine the version-history
 * diff already uses) to reconstruct who wrote which RUN of words, not just
 * who last touched the whole paragraph. backfill applies that onto whatever
 * a block hasn't already been tagged live this session. A solo, unshared
 * draft has no such history to mine and simply starts coloring from the
 * next edit.
 *
 * Exposed as window.NpjAuthorship. window.NpjProfiles, if present, supplies
 * the per-person color (the same palette used for avatars elsewhere).
 * window.NpjVersionDiff supplies the word-level LCS diff. Both optional —
 * degrade to a neutral grey / a no-op respectively.
 */
(function (G) {
  "use strict";

  // the same block-level selector Newsroom.jsx already uses for footnote/
  // structure bookkeeping — a "paragraph" is the unit we diff within
  var BLOCK = "p,li,h1,h2,h3,blockquote,aside,figcaption";
  var AUTHOR_SEL = "[data-author]";

  function colorFor(mxid) {
    return (G.NpjProfiles && G.NpjProfiles.colorFor) ? G.NpjProfiles.colorFor(mxid) : "#6b6b6b";
  }
  function diffAPI() { return G.NpjVersionDiff || null; }

  // ---- plain-text offset <-> DOM Range, scoped to any element (a live block
  // or a detached snapshot container) — the same TreeWalker technique
  // app/feedback/feedback.js's relocatable-comment anchoring uses, kept local
  // so this file has no hard dependency on it. ----
  function rangeAtOffset(root, start, len) {
    var doc = (root && root.ownerDocument) || (typeof document !== "undefined" ? document : null);
    if (start < 0 || !doc || !doc.createTreeWalker) return null;
    var walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
    var pos = 0, end = start + len, sN = null, sO = 0, eN = null, eO = 0, n;
    while ((n = walker.nextNode())) {
      var L = n.nodeValue.length;
      if (sN === null && pos + L > start) { sN = n; sO = start - pos; }
      if (sN !== null && pos + L >= end) { eN = n; eO = end - pos; break; }
      pos += L;
    }
    if (sN === null) return null;
    if (eN === null) { eN = sN; eO = sN.nodeValue.length; }
    var r = doc.createRange();
    try { r.setStart(sN, sO); r.setEnd(eN, eO); } catch (e) { return null; }
    return r;
  }

  // Fold a freshly wrapped span into an adjacent same-author span, if any, so
  // a typing session collapses into one growing span per contiguous author
  // run instead of a fragment per keystroke. Moves nodes (never clones), the
  // same idiom Newsroom.jsx's healSplitBlocks already relies on to keep a
  // live Selection/Range valid across the merge.
  function mergeAdjacent(span) {
    var a = span.getAttribute("data-author");
    var prev = span.previousSibling;
    if (prev && prev.nodeType === 1 && prev.getAttribute && prev.getAttribute("data-author") === a) {
      while (span.firstChild) prev.appendChild(span.firstChild);
      var pts = span.getAttribute("data-author-ts"); if (pts) prev.setAttribute("data-author-ts", pts);
      if (span.parentNode) span.parentNode.removeChild(span);
      span = prev;
    }
    var next = span.nextSibling;
    if (next && next.nodeType === 1 && next.getAttribute && next.getAttribute("data-author") === a) {
      while (next.firstChild) span.appendChild(next.firstChild);
      if (next.parentNode) next.parentNode.removeChild(next);
    }
    if (span.parentNode && span.parentNode.normalize) span.parentNode.normalize();
    return span;
  }

  // Wrap ONE non-collapsed Range in a data-author span — safely: surroundContents
  // when the range sits cleanly in one text node (the common typing case), else
  // extract+insert (the same fallback bindRangeToSource already trusts for
  // wrapping a citation span around an arbitrary selection).
  function wrapRange(range, mxid, ts) {
    if (!range || range.collapsed) return null;
    var doc = range.startContainer.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;
    var span = doc.createElement("span");
    span.className = "npj-author";
    span.setAttribute("data-author", mxid);
    span.setAttribute("data-author-ts", String(ts || Date.now()));
    try { range.surroundContents(span); }
    catch (e) {
      try { var frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
      catch (e2) { return null; }
    }
    try { span.style.setProperty("--author-c", colorFor(mxid)); } catch (e3) {}
    return mergeAdjacent(span);
  }

  // Unwrap any now-empty author spans a delete/backspace left behind.
  function sweepEmpty(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll(AUTHOR_SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.textContent && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  // per-block "last known text" cache — a block seen for the first time this
  // session is only BASELINED (nothing wrapped), so a freshly loaded draft
  // never gets its whole body mistaken for one giant fresh edit; only what
  // changes AFTER that gets tagged. WeakMap so entries vanish with the block.
  var prevText = (typeof WeakMap !== "undefined") ? new WeakMap() : null;

  // Diff a block's CURRENT text against its cached previous text and wrap
  // whatever's new as `mxid`'s. Bounded by one paragraph's length (not the
  // whole document), so it stays cheap on every keystroke.
  function tagBlock(blk, mxid) {
    if (!blk || !mxid || !prevText) return;
    var D = diffAPI(); if (!D) return;
    var cur = blk.textContent || "";
    if (!prevText.has(blk)) { prevText.set(blk, cur); return; }
    var prev = prevText.get(blk);
    if (prev === cur) return;
    var parts = D.diffWordsRaw(prev, cur);
    var pos = 0, ts = Date.now();
    parts.forEach(function (p) {
      if (p.type === "del") return;
      if (p.type !== "add") { pos += p.text.length; return; }
      var r = rangeAtOffset(blk, pos, p.text.length);
      if (r) wrapRange(r, mxid, ts);
      pos += p.text.length;
    });
    sweepEmpty(blk);
    prevText.set(blk, blk.textContent || "");
  }

  // Find the block the caret currently sits in and tag whatever just changed
  // in it. Call on every prose input event.
  function tagEdit(root, mxid) {
    if (!root || !mxid) return null;
    var sel = G.getSelection ? G.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var node = sel.getRangeAt(0).startContainer;
    var start = node && (node.nodeType === 1 ? node : node.parentElement);
    var blk = start && start.closest ? start.closest(BLOCK) : null;
    if (!blk || !root.contains(blk) || (blk.closest && blk.closest("ol.nr-fnotes"))) return null;
    tagBlock(blk, mxid);
    return blk;
  }

  // Refresh --author-c on every already-tagged span — for tags written in a
  // past session (before this browser knew the palette) or while Authors mode
  // was off. Call once when the mode is switched on.
  function paint(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll(AUTHOR_SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      try { el.style.setProperty("--author-c", colorFor(el.getAttribute("data-author"))); } catch (e) {}
    }
  }

  // The reading text of every block in `root`, in document order. Used both
  // on the live editor and on a detached snapshot parsed from a past
  // revision's HTML.
  function blockTexts(root) {
    if (!root || !root.querySelectorAll) return [];
    var els = root.querySelectorAll(BLOCK);
    var out = [];
    for (var i = 0; i < els.length; i++) out.push(els[i].textContent || "");
    return out;
  }

  // ---- retroactive reconstruction: replay history into per-block "runs" ----
  // A block's authorship is a list of RUNS — [{ text, author, ts }, …] — that
  // concatenate back to its current text, each run the exact words one
  // person contributed. advanceRuns folds one more diff (old block text →
  // new block text) into an existing runs list: an unchanged stretch keeps
  // whoever already had it (sliced out of the old runs); a newly added
  // stretch becomes a fresh run credited to `newAuthor`; a deleted stretch
  // just drops out. Pure — no DOM — so it's unit-testable on its own.
  function advanceRuns(oldRuns, diffParts, newAuthor, newTs) {
    oldRuns = oldRuns || [];
    var newRuns = [];
    var ri = 0, roff = 0; // position within oldRuns: run index + offset consumed
    function pushRun(text, author, ts) {
      if (!text) return;
      var last = newRuns[newRuns.length - 1];
      if (last && last.author === author) { last.text += text; if (ts > last.ts) last.ts = ts; }
      else newRuns.push({ text: text, author: author, ts: ts || 0 });
    }
    function advance(n, keep) {
      while (n > 0 && ri < oldRuns.length) {
        var run = oldRuns[ri];
        var avail = run.text.length - roff;
        var take = Math.min(avail, n);
        if (take > 0 && keep) pushRun(run.text.substr(roff, take), run.author, run.ts);
        roff += take; n -= take;
        if (roff >= run.text.length) { ri++; roff = 0; }
      }
    }
    (diffParts || []).forEach(function (p) {
      if (p.type === "same") advance(p.text.length, true);
      else if (p.type === "del") advance(p.text.length, false);
      else if (p.type === "add") pushRun(p.text, newAuthor, newTs || 0);
    });
    return newRuns;
  }

  // `snapshots` must be OLDEST FIRST: [{ author, ts, html }, …]. Returns an
  // array of per-block RUN LISTS (see advanceRuns) indexed to the LAST
  // snapshot's block layout — one entry per block, each a list of runs.
  //
  // Aligns blocks by POSITION, not content: inserting or reordering a whole
  // paragraph earlier in the document's history can occasionally misattribute
  // a block that only shifted position and was never actually touched. An
  // honest tradeoff — this still gets the common cases (typing, edits done in
  // place, paragraphs appended, words changed mid-sentence) right without a
  // full content-aware realignment across the whole document.
  function attributionFromSnapshots(snapshots) {
    var D = diffAPI(); if (!D) return [];
    var blockRuns = [];
    (snapshots || []).forEach(function (snap) {
      if (!snap || typeof snap.html !== "string" || !snap.author) return;
      var doc = (typeof document !== "undefined") ? document : null; if (!doc) return;
      var container = doc.createElement("div");
      container.innerHTML = snap.html;
      var texts = blockTexts(container);
      texts.forEach(function (t, i) {
        var runs = blockRuns[i] || [];
        var oldText = runs.map(function (r) { return r.text; }).join("");
        if (oldText === t) { blockRuns[i] = runs; return; }
        blockRuns[i] = advanceRuns(runs, D.diffWordsRaw(oldText, t), snap.author, snap.ts || 0);
      });
    });
    return blockRuns;
  }

  // Apply retroactive per-block runs (from attributionFromSnapshots) onto the
  // LIVE editor — but only to blocks that carry NO author span yet, so a live
  // edit (this session, or an earlier Authors-mode backfill already saved
  // with the draft) always outranks a coarse historical reconstruction; a
  // block that's partly tagged already is left alone rather than risk
  // reconciling the two. Returns how many spans were newly wrapped.
  function backfill(root, blockRuns) {
    if (!root || !root.querySelectorAll || !blockRuns || !blockRuns.length) return 0;
    var blocks = root.querySelectorAll(BLOCK);
    var n = 0;
    for (var i = 0; i < blocks.length && i < blockRuns.length; i++) {
      var blk = blocks[i];
      if (blk.closest && blk.closest("ol.nr-fnotes")) continue;
      if (blk.querySelector(AUTHOR_SEL)) continue; // already has tagging — leave it alone
      var pos = 0;
      (blockRuns[i] || []).forEach(function (r) {
        var len = r.text.length;
        if (r.author && len > 0) {
          var range = rangeAtOffset(blk, pos, len);
          if (range) { if (wrapRange(range, r.author, r.ts)) n++; }
        }
        pos += len;
      });
      if (prevText) prevText.set(blk, blk.textContent || ""); // seed the live cache off this, not from scratch
      sweepEmpty(blk);
    }
    return n;
  }

  // Every distinct author currently in the doc, in first-appearance order,
  // with how many words are theirs and the most recent touch — for the legend.
  function list(root) {
    if (!root || !root.querySelectorAll) return [];
    var order = [], by = {};
    var els = root.querySelectorAll(AUTHOR_SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var a = el.getAttribute("data-author"); if (!a) continue;
      if (!by[a]) { by[a] = { author: a, words: 0, lastTs: 0 }; order.push(a); }
      by[a].words += ((el.textContent || "").match(/\S+/g) || []).length;
      var ts = parseInt(el.getAttribute("data-author-ts") || "0", 10);
      if (ts > by[a].lastTs) by[a].lastTs = ts;
    }
    return order.map(function (a) { return by[a]; });
  }

  G.NpjAuthorship = {
    BLOCK: BLOCK, colorFor: colorFor, tagEdit: tagEdit, paint: paint, list: list,
    blockTexts: blockTexts, advanceRuns: advanceRuns,
    attributionFromSnapshots: attributionFromSnapshots, backfill: backfill
  };
  if (typeof module !== "undefined" && module.exports) module.exports = G.NpjAuthorship;
})(typeof window !== "undefined" ? window : this);
