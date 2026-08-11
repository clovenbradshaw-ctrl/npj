/* blockquote-image.test.js — an image dropped inside a block quote survives Preview.
 *
 * The bug: quoteText() (the plain-text walk a <blockquote> uses to build its
 * `pull.text`) has no branch for a <figure>/<image-slot> — an image node has no
 * text children, so it silently contributed nothing. Two symptoms followed:
 *   - a quote with PROSE + an image kept the text but dropped the photo.
 *   - a quote that was IMAGE-ONLY (no prose) came out with qt === "" and the
 *     `if (qt)` guard around the block push dropped the WHOLE blockquote —
 *     the image simply never appeared in Preview (or the real publish).
 *
 * The fix: also check inlineTokens(node) — which already converts a nested
 * figure via figureToImgToken (the same path callouts use) — for an image
 * token, and let either qt OR an image token justify emitting the pull block,
 * carrying the image on pull.tokens.
 *
 * Same createElement-shim approach as callout-block.test.js (no jsdom).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

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
// fold a single top-level node, returning the blocks htmlToBlocks produces
function foldNode(node) {
  const root = { childNodes: [node], set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try { return A.htmlToBlocks("<blockquote>the shim feeds the real tree</blockquote>").blocks; }
  finally { global.document = saved; }
}

test("a block quote with prose + a nested image keeps BOTH in Preview", () => {
  const bq = enode("blockquote", {}, [
    tnode("As the report states — "),
    figureNode("https://example.test/exhibit.jpg", "Exhibit A"),
  ]);
  const blocks = foldNode(bq);
  const pull = blocks.find((b) => b.type === "pull");
  assert.ok(pull, "a pull block is produced");
  assert.equal(pull.text, "As the report states —", "the quoted text survives");
  assert.ok(Array.isArray(pull.tokens) && pull.tokens.length, "it carries inline tokens");
  const img = pull.tokens.find((t) => t && t.t === "img");
  assert.ok(img, "the nested image survives as a token instead of being discarded");
  assert.equal(img.src, "https://example.test/exhibit.jpg");
  assert.equal(img.caption, "Exhibit A");
});

test("a block quote that is IMAGE-ONLY (no prose) still emits a block instead of vanishing", () => {
  const bq = enode("blockquote", {}, [figureNode("https://example.test/only.jpg")]);
  const blocks = foldNode(bq);
  const pull = blocks.find((b) => b.type === "pull");
  assert.ok(pull, "the blockquote is NOT silently dropped when it has no text");
  const img = pull.tokens && pull.tokens.find((t) => t && t.t === "img");
  assert.ok(img, "the image is present on tokens");
  assert.equal(img.src, "https://example.test/only.jpg");
});

test("a plain text-only block quote is unaffected (no tokens, byte-for-byte as before)", () => {
  const bq = enode("blockquote", {}, [tnode("Just a quote, no image.")]);
  const blocks = foldNode(bq);
  const pull = blocks.find((b) => b.type === "pull");
  assert.ok(pull);
  assert.equal(pull.text, "Just a quote, no image.");
  assert.ok(!pull.tokens, "no tokens are attached when there's no grounding and no image");
});

test("blocksToHtml round-trips a pull's img token back to an editable figure/image-slot", () => {
  const html = A.blocksToHtml([{
    type: "pull", text: "", attribution: "", kind: "block",
    tokens: [{ t: "img", src: "https://example.test/a.jpg", caption: "cap" }],
  }]);
  assert.match(html, /<blockquote[^>]*>/);
  assert.match(html, /<figure[^>]*><image-slot[^>]*src="https:\/\/example\.test\/a\.jpg"/, "the image round-trips as an editable figure");
});
