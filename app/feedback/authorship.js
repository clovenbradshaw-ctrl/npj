/* authorship.js — per-paragraph "who wrote this" for the Newsroom's Authors
 * mode: color each collaborator's edits and let the author hide/show them.
 *
 * This is a live-DOM, EDITOR-ONLY view. Every block the current user touches
 * gets stamped data-author="<mxid>" (+ data-author-ts) — the same pattern as
 * structure.js's data-sec (Invariant I1): the tag rides inside the draft's own
 * HTML, so it autosaves and syncs to Matrix and survives a reload — or opening
 * the same draft on another collaborator's device — exactly like the words do,
 * but htmlToBlocks (app/record/articles.js) never reads a data-author
 * attribute; it walks known tags/classes and drops anything it doesn't
 * recognize. So none of this — the colors, the tags, who hid whom — ever
 * reaches Preview, the published page, a REC edit, or any export (Substack,
 * the source packet, the .html/.md downloads): they all fold through that same
 * allow-listed builder, which is structure-blind to this the same way it's
 * structure-blind to data-sec.
 *
 * Attribution is coarse by design: a block is colored by whoever last edited
 * IT, not a character-precise blame. Splitting a paragraph with Enter counts
 * as touching the new half even when none of its words are new — an honest
 * tradeoff for something this cheap to keep live on every keystroke.
 *
 * RETROACTIVE on an existing draft. A brand-new draft has nothing to color
 * until someone edits it — but a draft several people have already been
 * working on isn't starting from a blank slate: attributionFromSnapshots +
 * backfill replay the real save history a shared project room already keeps
 * (MatrixAuth.getRoomDocHistory — every save is a real, server-verified
 * author, never a guess) onto whatever's still untagged, so turning Authors
 * mode on for the first time colors the WHOLE document, not just what gets
 * typed from that point forward. A solo, unshared draft has no such history
 * to mine and simply starts coloring from the next edit.
 *
 * Exposed as window.NpjAuthorship. window.NpjProfiles, if present, supplies
 * the per-person color (the same palette used for avatars elsewhere); falls
 * back to a neutral grey. No other dependencies.
 */
(function (G) {
  "use strict";

  // the same block-level selector Newsroom.jsx already uses for footnote/
  // structure bookkeeping — a "paragraph" for authorship purposes
  var BLOCK = "p,li,h1,h2,h3,blockquote,aside,figcaption";

  function colorFor(mxid) {
    return (G.NpjProfiles && G.NpjProfiles.colorFor) ? G.NpjProfiles.colorFor(mxid) : "#6b6b6b";
  }

  // Stamp the block the caret currently sits in as authored by `mxid`. Call on
  // every prose input event — it only ever touches the one block being typed
  // into, so it's cheap enough to run on every keystroke. Returns the block
  // touched, or null (no selection, or the caret isn't in an editable block).
  function tagEdit(root, mxid) {
    if (!root || !mxid) return null;
    var sel = G.getSelection ? G.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var node = sel.getRangeAt(0).startContainer;
    var start = node && (node.nodeType === 1 ? node : node.parentElement);
    var blk = start && start.closest ? start.closest(BLOCK) : null;
    if (!blk || !root.contains(blk) || (blk.closest && blk.closest("ol.nr-fnotes"))) return null;
    blk.setAttribute("data-author", mxid);
    blk.setAttribute("data-author-ts", String(Date.now()));
    try { blk.style.setProperty("--author-c", colorFor(mxid)); } catch (e) {}
    return blk;
  }

  // Refresh --author-c on every already-tagged block — for tags written in a
  // past session (before this browser knew the palette) or while Authors mode
  // was off. Call once when the mode is switched on.
  function paint(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll("[data-author]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      try { el.style.setProperty("--author-c", colorFor(el.getAttribute("data-author"))); } catch (e) {}
    }
  }

  // The reading text of every block in `root`, in document order — the same
  // linear sequence tagEdit/list address by position. Used both on the live
  // editor and on a detached snapshot parsed from a past revision's HTML.
  function blockTexts(root) {
    if (!root || !root.querySelectorAll) return [];
    var els = root.querySelectorAll(BLOCK);
    var out = [];
    for (var i = 0; i < els.length; i++) out.push((els[i].textContent || "").replace(/\s+/g, " ").trim());
    return out;
  }

  // Retroactive backfill: reconstruct "who last touched each block" from a
  // sequence of past whole-document snapshots — e.g. the room's own history of
  // a shared draft (see MatrixAuth.getRoomDocHistory), each save a real,
  // server-verified author and timestamp, never a guess.
  //
  // `snapshots` must be OLDEST FIRST: [{ author, ts, html }, …]. Walking
  // forward in time, a block is (re)credited to a snapshot's author whenever
  // its text at that position differs from the position's text one snapshot
  // earlier — the same "last edited it" rule tagEdit applies live, just
  // replayed over history instead of over keystrokes.
  //
  // Aligns blocks by POSITION, not content: inserting or reordering a
  // paragraph earlier in the document's history can occasionally misattribute
  // a block that only shifted position and was never actually touched. An
  // honest tradeoff — this still gets the common cases (typing, edits done in
  // place, paragraphs appended) right without a full content-aware realign.
  //
  // Returns an array of { author, ts } (or undefined where nothing is known
  // yet) indexed to the LAST snapshot's block layout.
  function attributionFromSnapshots(snapshots) {
    var owners = [];
    var prevTexts = null;
    (snapshots || []).forEach(function (snap) {
      if (!snap || typeof snap.html !== "string") return;
      var container = (typeof document !== "undefined") ? document.createElement("div") : null;
      if (!container) return;
      container.innerHTML = snap.html;
      var texts = blockTexts(container);
      texts.forEach(function (t, i) {
        if (!prevTexts || prevTexts[i] !== t) owners[i] = { author: snap.author, ts: snap.ts || 0 };
      });
      prevTexts = texts;
    });
    return owners;
  }

  // Apply a retroactive attribution array (from attributionFromSnapshots) onto
  // the LIVE editor — but only to blocks that carry no data-author yet, so a
  // live edit (this session, or an earlier Authors-mode backfill already
  // saved with the draft) always outranks a coarse historical reconstruction.
  // Returns how many blocks were newly tagged.
  function backfill(root, owners) {
    if (!root || !root.querySelectorAll || !owners || !owners.length) return 0;
    var els = root.querySelectorAll(BLOCK);
    var n = 0;
    for (var i = 0; i < els.length && i < owners.length; i++) {
      var el = els[i], o = owners[i];
      if (!o || !o.author || el.hasAttribute("data-author")) continue;
      el.setAttribute("data-author", o.author);
      if (o.ts) el.setAttribute("data-author-ts", String(o.ts));
      try { el.style.setProperty("--author-c", colorFor(o.author)); } catch (e) {}
      n++;
    }
    return n;
  }

  // Every distinct author currently in the doc, in first-appearance order,
  // with how many blocks and the most recent touch — for the legend.
  function list(root) {
    if (!root || !root.querySelectorAll) return [];
    var order = [], by = {};
    var els = root.querySelectorAll("[data-author]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var a = el.getAttribute("data-author"); if (!a) continue;
      if (!by[a]) { by[a] = { author: a, blocks: 0, lastTs: 0 }; order.push(a); }
      by[a].blocks += 1;
      var ts = parseInt(el.getAttribute("data-author-ts") || "0", 10);
      if (ts > by[a].lastTs) by[a].lastTs = ts;
    }
    return order.map(function (a) { return by[a]; });
  }

  G.NpjAuthorship = {
    BLOCK: BLOCK, colorFor: colorFor, tagEdit: tagEdit, paint: paint, list: list,
    blockTexts: blockTexts, attributionFromSnapshots: attributionFromSnapshots, backfill: backfill
  };
  if (typeof module !== "undefined" && module.exports) module.exports = G.NpjAuthorship;
})(typeof window !== "undefined" ? window : this);
