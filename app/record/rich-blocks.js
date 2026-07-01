/* rich-blocks.js — clean block-type conversion for the prose contenteditable.
 *
 * The problem this solves: document.execCommand("formatBlock", …) is the browser's
 * only built-in block converter, and it is notorious for the mess it leaves —
 * nested <span style>, carried-over heading styles, fragmented <b>…</b><b>…</b>
 * runs, empty class=""/style="" attributes, stray wrapper <div>s. Converting a
 * paragraph to a heading and back a few times can bloat the HTML with cruft that
 * never fully clears, and every one of those artifacts has to be scrubbed again
 * on the way into the record (htmlToBlocks) or it shows up in the reader.
 *
 * The fix is the same one every serious rich-text editor uses: don't ask the
 * browser to reformat a block in place. Build a FRESH element of the target type,
 * move only the block's INLINE children into it (so bold/links/citations are
 * preserved but block-level cruft is dropped), and swap it in. One clean element,
 * no nesting, deterministic. Every block-type button in both editors — ¶, H1/H2/H3,
 * block quote, pull quote, callout, code — routes through this one path, so they
 * can never drift apart or reintroduce the execCommand tail.
 *
 * This module is PURE DOM (no React, no app globals) and degrades safely: any
 * unexpected shape returns false so the caller can fall back to execCommand. It
 * runs in the browser AND module.exports its pure spec/helpers for node tests.
 *
 * UMD: window.NpjRichBlocks in the browser, module.exports in node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjRichBlocks = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  /* Every block type the toolbar can convert to, mapped to the element it becomes.
     `cls` is set on the fresh element; `text` means the block is verbatim text
     (a <pre> — inline formatting is intentionally flattened to a code line). The
     two quote flavours and the callout share nothing structurally with a heading,
     so the button set stays honest: one spec, one element, one class. */
  var SPECS = {
    p:          { tag: "p" },
    h1:         { tag: "h1" },
    h2:         { tag: "h2" },
    h3:         { tag: "h3" },
    blockquote: { tag: "blockquote" },                 // a bordered quoted passage
    pull:       { tag: "blockquote", cls: "np-pull" }, // a large display pull quote
    callout:    { tag: "aside", cls: "np-callout" },   // a highlighted aside / note box
    code:       { tag: "pre", text: true }
  };

  // Blocks we will rebuild. Lists (ul/ol/li), figures, custom elements and
  // anything contenteditable=false are deliberately excluded — they have their
  // own toolbar affordances and rebuilding them would destroy managed content.
  var CONVERTIBLE = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, ASIDE: 1, PRE: 1, DIV: 1 };
  // Inline tags whose empty, attribute-less instances are pure execCommand cruft.
  var UNWRAP_EMPTY = { SPAN: 1, FONT: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, CODE: 1, MARK: 1, SMALL: 1, BIG: 1 };

  function isEl(n) { return !!n && n.nodeType === 1; }
  function tagOf(el) { return isEl(el) ? String(el.tagName || "").toUpperCase() : ""; }

  // A node the converter must never reach into or rebuild: a custom element
  // (image-slot…), an image/embed/widget shell, or anything the editor has locked
  // as contenteditable=false. Citation spans/markers ARE inline content and MUST
  // survive the move, so they are NOT protected here — only structural islands are.
  function isProtectedEl(el) {
    if (!isEl(el)) return false;
    var tag = tagOf(el);
    if (tag.indexOf("-") >= 0) return true;                 // any custom element
    if (tag === "FIGURE" || tag === "IMG") return true;
    if (el.getAttribute && el.getAttribute("contenteditable") === "false") return true;
    return false;
  }
  function containsProtected(el) {
    if (isProtectedEl(el)) return true;
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (isEl(kids[i]) && containsProtected(kids[i])) return true;
    return false;
  }

  // Strip the empty class=""/style="" attributes execCommand leaves behind, and
  // unwrap a bare, attribute-less inline wrapper (<span>x</span> → x). Applied to
  // the moved inline content so a conversion actively CLEANS rather than carries.
  function tidyInline(node) {
    if (!isEl(node)) return;
    if (node.getAttribute && node.getAttribute("class") === "") node.removeAttribute("class");
    if (node.getAttribute && node.getAttribute("style") === "") node.removeAttribute("style");
    var kids = Array.prototype.slice.call(node.childNodes || []);
    for (var i = 0; i < kids.length; i++) tidyInline(kids[i]);
    // a wrapper span/font with nothing left on it is noise — lift its children out
    if (UNWRAP_EMPTY[tagOf(node)] && node.attributes && node.attributes.length === 0 &&
        (tagOf(node) === "SPAN" || tagOf(node) === "FONT") && node.parentNode) {
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.parentNode.removeChild(node);
    }
  }

  // Move the INLINE content of `src` into `dst`. A block-level child (the <p>/<div>
  // the browser wraps each line of a multi-paragraph quote in) is flattened: its
  // own children move up, with a <br> marking the seam so the line break survives.
  function moveInline(src, dst, doc) {
    var kids = Array.prototype.slice.call(src.childNodes || []);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (isEl(c) && !isProtectedEl(c) && CONVERTIBLE[tagOf(c)]) {
        // a nested block (p/div/blockquote/heading) inside this block → flatten it
        if (dst.firstChild) dst.appendChild(doc.createElement("br"));
        moveInline(c, dst, doc);
      } else {
        dst.appendChild(c);   // text node or inline element — move as-is (identity kept)
        tidyInline(dst.lastChild);
      }
    }
  }

  /* Rebuild a single block element `el` as `kind`. Returns the fresh element (now
     in the DOM in `el`'s place), or null if it can't/ shouldn't be converted. */
  function rebuildAs(el, kind, doc) {
    var spec = SPECS[kind];
    if (!spec || !isEl(el) || !el.parentNode) return null;
    if (isProtectedEl(el) || containsProtected(el)) return null;  // never touch a figure/slot island
    doc = doc || (el.ownerDocument) || document;
    var nu = doc.createElement(spec.tag);
    if (spec.cls) nu.className = spec.cls;
    if (spec.text) {
      nu.textContent = String(el.textContent || "");            // <pre> — verbatim line
    } else {
      moveInline(el, nu, doc);
      if (!nu.firstChild) nu.appendChild(doc.createElement("br")); // keep the block selectable
    }
    el.parentNode.replaceChild(nu, el);
    return nu;
  }

  // The child-of-root block that contains `node` (climbing out of a text node or a
  // nested inline). Null if `node` isn't inside a direct block child of `root`.
  function childBlockOfRoot(node, root) {
    var n = isEl(node) ? node : (node ? node.parentNode : null);
    while (n && n.parentNode && n.parentNode !== root) n = n.parentNode;
    return (n && n.parentNode === root) ? n : null;
  }

  // Every convertible top-level block the range touches (in document order). Falls
  // back to the block holding the range start when intersectsNode finds nothing
  // (a collapsed caret). Lists/figures/etc. are simply not CONVERTIBLE, so a
  // selection sitting only in those yields [] and the caller falls back.
  function blocksInRange(root, range) {
    var out = [];
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (!CONVERTIBLE[tagOf(c)]) continue;
      var hit = range && range.intersectsNode ? range.intersectsNode(c) : true;
      if (hit) out.push(c);
    }
    if (!out.length && range) {
      var a = childBlockOfRoot(range.startContainer, root);
      if (a && CONVERTIBLE[tagOf(a)]) out.push(a);
    }
    return out;
  }

  /* The entry point the editors call. Convert every block the current selection
     touches inside `root` to `kind`, then restore the selection over the rebuilt
     blocks. Returns true on success, false if nothing was converted (so the caller
     can fall back to execCommand). Never throws. */
  function setBlockType(root, kind, win) {
    try {
      if (!root || !SPECS[kind]) return false;
      win = win || window;
      var sel = win.getSelection && win.getSelection();
      if (!sel || !sel.rangeCount) return false;
      var range = sel.getRangeAt(0);
      var within = root === range.commonAncestorContainer ||
        (root.contains && root.contains(range.commonAncestorContainer));
      if (!within) return false;
      var collapsed = range.collapsed;
      var blocks = blocksInRange(root, range);
      if (!blocks.length) return false;
      var doc = root.ownerDocument || document;
      var made = [];
      for (var i = 0; i < blocks.length; i++) {
        var nu = rebuildAs(blocks[i], kind, doc);
        if (nu) made.push(nu);
      }
      if (!made.length) return false;
      // restore the selection: a collapsed caret lands at the end of the first new
      // block; a real selection re-spans the first block's start to the last's end.
      var r = doc.createRange();
      r.setStart(made[0], 0);
      var last = made[made.length - 1];
      r.setEnd(last, (last.childNodes ? last.childNodes.length : 0));
      if (collapsed) r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    } catch (e) { return false; }
  }

  return {
    SPECS: SPECS,
    CONVERTIBLE: CONVERTIBLE,
    rebuildAs: rebuildAs,
    blocksInRange: blocksInRange,
    childBlockOfRoot: childBlockOfRoot,
    isProtectedEl: isProtectedEl,
    tidyInline: tidyInline,
    setBlockType: setBlockType
  };
});
