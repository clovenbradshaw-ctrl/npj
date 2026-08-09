/* callout-block.test.js — the callout block (a highlighted aside / note box,
 * Substack-style) round-trips through the record layer.
 *
 * A callout is {type:"callout", tokens:[…]} — it carries rich inline content, so
 * bold/links/citations inside it survive exactly like a paragraph's tokens. It
 * lands in the editor HTML as <aside class="np-callout">, and htmlToBlocks keys on
 * that class (not the tag) so a callout folds back whether it rode in as an <aside>
 * or a <div>/<blockquote> a paste happened to leave.
 *
 * Same createElement-shim approach as blockquote-citation.test.js (no jsdom): we
 * feed a real node tree into htmlToBlocks and read the blocks back.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");
const RB = require("../app/record/rich-blocks.js");

const tnode = (s) => ({ nodeType: 3, nodeValue: s, textContent: s });
function enode(tag, attrs, kids) {
  attrs = attrs || {}; kids = kids || [];
  const cls = String(attrs.class || "").split(/\s+/).filter(Boolean);
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: kids,
    get textContent() { return kids.map((k) => k.textContent).join(""); },
    classList: { contains: (c) => cls.includes(c) },
    getAttribute: (k) => (attrs[k] == null ? null : attrs[k]),
    hasAttribute: (k) => attrs[k] != null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
// fold a single top-level node, returning the blocks htmlToBlocks produces
function foldNode(node) {
  const root = { childNodes: [node], set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try { return A.htmlToBlocks("<div>the shim feeds the real tree</div>").blocks; }
  finally { global.document = saved; }
}

test("an <aside class='np-callout'> folds into a callout block with inline tokens", () => {
  const aside = enode("aside", { class: "np-callout" }, [
    tnode("Heads up — "), enode("strong", {}, [tnode("this matters")]), tnode("."),
  ]);
  const blocks = foldNode(aside);
  const callout = blocks.find((b) => b.type === "callout");
  assert.ok(callout, "a callout block is produced");
  assert.ok(Array.isArray(callout.tokens) && callout.tokens.length, "it carries inline tokens");
  const bold = callout.tokens.find((t) => t && t.t === "strong");
  assert.ok(bold, "the inline formatting inside the callout survives the fold");
  assert.equal(bold.text, "this matters");
});

test("a callout is keyed by class, not tag — a <div class='np-callout'> folds too", () => {
  const div = enode("div", { class: "np-callout" }, [tnode("A note in a div wrapper.")]);
  const blocks = foldNode(div);
  const callout = blocks.find((b) => b.type === "callout");
  assert.ok(callout, "the div callout still folds by its np-callout class");
  assert.equal(callout.tokens.map((t) => (typeof t === "string" ? t : t.text || "")).join(""), "A note in a div wrapper.");
});

test("an empty callout folds to nothing (no stray empty block)", () => {
  const aside = enode("aside", { class: "np-callout" }, [tnode("   ")]);
  const blocks = foldNode(aside);
  assert.ok(!blocks.some((b) => b.type === "callout"), "an ink-less callout is dropped");
});

test("blocksToHtml renders a callout as <aside class='np-callout'> with its tokens", () => {
  const html = A.blocksToHtml([{ type: "callout", tokens: ["Note: ", { t: "a", text: "see here", href: "https://x.test" }] }]);
  assert.match(html, /<aside class="np-callout">/, "the callout element is emitted");
  assert.ok(html.includes("Note: "), "the text is kept");
  assert.match(html, /<a href="https:\/\/x\.test">see here<\/a>/, "an inline link inside the callout survives");
});

test("an empty callout round-trips with a <br/> so it stays selectable", () => {
  const html = A.blocksToHtml([{ type: "callout", tokens: [] }]);
  assert.match(html, /<aside class="np-callout"><br\/><\/aside>/);
});

test("callout text counts toward plainText (word count, diffs, excerpts)", () => {
  const txt = A.plainText([{ type: "callout", tokens: ["one two three"] }]);
  assert.equal(txt, "one two three");
});

test("a callout survives a full blocksToHtml → htmlToBlocks round trip", () => {
  const html = A.blocksToHtml([{ type: "callout", tokens: ["Round trip me."] }]);
  // rebuild the same aside node the html describes and fold it back
  const aside = enode("aside", { class: "np-callout" }, [tnode("Round trip me.")]);
  assert.match(html, /np-callout/);
  const blocks = foldNode(aside);
  const callout = blocks.find((b) => b.type === "callout");
  assert.ok(callout);
  assert.equal(callout.tokens.join(""), "Round trip me.");
});

/* ---- an image dropped inside a callout must not be silently discarded ---- */
function figureNode(src, caption) {
  const slot = {
    nodeType: 1, tagName: "IMAGE-SLOT", childNodes: [], textContent: "",
    classList: { contains: () => false },
    getAttribute: (k) => (k === "src" ? src : null),
    hasAttribute: () => false,
  };
  const cap = caption ? { nodeType: 1, tagName: "FIGCAPTION", childNodes: [], textContent: caption, classList: { contains: () => false } } : null;
  const kids = cap ? [slot, cap] : [slot];
  return {
    nodeType: 1, tagName: "FIGURE", childNodes: kids,
    get textContent() { return kids.map((k) => k.textContent).join(""); },
    classList: { contains: () => false },
    getAttribute: () => null, hasAttribute: () => false,
    querySelector: (sel) => {
      if (sel === "image-slot") return slot;
      if (sel.indexOf("figcaption") === 0) return cap || null;
      return null;
    },
    querySelectorAll: () => [],
  };
}

test("an image dropped inside a callout survives htmlToBlocks (previously silently dropped)", () => {
  const aside = enode("aside", { class: "np-callout" }, [
    tnode("Context — "), figureNode("https://example.test/photo.jpg", "the photo"),
  ]);
  const blocks = foldNode(aside);
  const callout = blocks.find((b) => b.type === "callout");
  assert.ok(callout, "a callout block is produced");
  const img = callout.tokens.find((t) => t && t.t === "img");
  assert.ok(img, "the nested image survives as a token instead of being discarded");
  assert.equal(img.src, "https://example.test/photo.jpg");
  assert.equal(img.caption, "the photo");
});

test("blocksToHtml round-trips an img token inside a callout back to a figure/image-slot", () => {
  const html = A.blocksToHtml([{ type: "callout", tokens: ["See: ", { t: "img", src: "https://example.test/a.jpg", caption: "cap" }] }]);
  assert.match(html, /<figure[^>]*><image-slot[^>]*src="https:\/\/example\.test\/a\.jpg"/, "the image round-trips as an editable figure");
});

/* ---- the clean block converter's pure surface (rich-blocks.js) ---- */
test("rich-blocks exposes a spec for every toolbar block type", () => {
  ["p", "h1", "h2", "h3", "blockquote", "pull", "callout", "code"].forEach((k) => {
    assert.ok(RB.SPECS[k], "a spec exists for " + k);
  });
  assert.equal(RB.SPECS.callout.tag, "aside");
  assert.equal(RB.SPECS.callout.cls, "np-callout");
  assert.equal(RB.SPECS.pull.tag, "blockquote");
  assert.equal(RB.SPECS.pull.cls, "np-pull");
  assert.equal(RB.SPECS.blockquote.tag, "blockquote");
  assert.ok(!RB.SPECS.blockquote.cls, "a plain block quote carries no class");
  assert.ok(RB.SPECS.code.text, "code is a verbatim-text block");
});

test("setBlockType is a safe no-op with no selection (falls back cleanly)", () => {
  const fakeRoot = { contains: () => true, ownerDocument: null };
  const ok = RB.setBlockType(fakeRoot, "callout", { getSelection: () => ({ rangeCount: 0 }) });
  assert.equal(ok, false, "no selection → returns false so the caller can fall back");
});

test("setBlockType returns false for an unknown block kind", () => {
  assert.equal(RB.setBlockType({}, "nope", {}), false);
});
