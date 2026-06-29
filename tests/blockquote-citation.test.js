/* blockquote-citation.test.js — a GROUNDED block quote keeps its citation.
 *
 * The bug: when an author wrapped a quoted passage in a <blockquote> and bound a
 * source to it (a <span class="claim-src" data-src=… data-quote=…>), the fold
 * (htmlToBlocks) flattened the quote to a plain `text` string and DROPPED the
 * citation — "source chrome with no home in a pull." So in the reader the quote
 * rendered as inert prose: no citation marker, no source card on hover/tap, even
 * though the cite was right there in the editor HTML.
 *
 * The fix: a grounded quote keeps its inline tokens (pull.tokens), so the reader
 * (which already scans b.tokens to build its claim/source model) renders the
 * quote as a live citation. A PLAIN quote is untouched — text + optional marks.
 *
 * Same createElement-shim approach as articles-fold.test.js (no jsdom).
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
// fold a single top-level node, returning the first pull block it produces
function foldPull(node) {
  const root = { childNodes: [node], set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try {
    const out = A.htmlToBlocks("<blockquote>ignored — the shim feeds the real tree</blockquote>");
    return out.blocks.find((b) => b.type === "pull") || null;
  } finally { global.document = saved; }
}
const claimSrc = (attrs, text) => enode("span", Object.assign({ class: "claim-src" }, attrs), [tnode(text)]);
const cite = (attrs, label) => enode("sup", Object.assign({ class: "md-cite" }, attrs), [tnode(label)]);

const QUOTE =
  "I am not aware of any communications you reference. That said, to the extent " +
  "there are such communications between the Department of Law and Metro departments " +
  "or boards, those communications would be confidential and protected by the " +
  "attorney client privilege.";

test("a sourced block quote keeps its citation as a grounded token", () => {
  // <blockquote><span class="claim-src" data-src=doc data-quote=Q>…</span><sup>10</sup></blockquote>
  const bq = enode("blockquote", {}, [
    claimSrc({ "data-src": "doc-x", "data-cid": "cs-q", "data-quote": QUOTE }, QUOTE),
    cite({ "data-cite": "doc-x", "data-cid": "cs-q", "data-quote": QUOTE }, "10"),
  ]);
  const pull = foldPull(bq);
  assert.ok(pull, "a pull block is produced");
  assert.equal(pull.kind, "block");
  assert.equal(pull.text, QUOTE, "the plain text is still there for excerpts/exports");
  assert.ok(Array.isArray(pull.tokens) && pull.tokens.length, "the grounded tokens are kept");
  const claims = pull.tokens.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1, "the quote is one grounded claim");
  assert.equal(claims[0].c, QUOTE);
  assert.deepEqual(claims[0].src, ["doc-x"]);
  assert.deepEqual(claims[0].q, { "doc-x": QUOTE }, "the cited passage rides the token");
  // the citation marker folded onto the claim — it must NOT also strand on `marks`
  // (that would double the footnote / re-print the number)
  assert.ok(!pull.marks || !pull.marks.length, "no stray marks when the cite folded onto the claim");
});

test("a plain block quote is untouched — text only, no tokens", () => {
  const bq = enode("blockquote", {}, [tnode("Just a quoted line, nobody sourced it.")]);
  const pull = foldPull(bq);
  assert.ok(pull);
  assert.equal(pull.text, "Just a quoted line, nobody sourced it.");
  assert.ok(!pull.tokens, "a plain quote stays lean — no tokens");
});

test("an owned/void assertion in a block quote is kept as a grounded token", () => {
  const bq = enode("blockquote", {}, [
    claimSrc(
      { "data-stance": "absence", "data-void-kind": "silent", "data-note": "No answer was given.", "data-cid": "cs-v" },
      "It is unclear why NDOT cannot place the benches itself."
    ),
  ]);
  const pull = foldPull(bq);
  assert.ok(pull);
  assert.ok(Array.isArray(pull.tokens) && pull.tokens.length, "the owned assertion is kept");
  const owned = pull.tokens.find((t) => t && typeof t === "object" && t.stance === "absence");
  assert.ok(owned, "the void's stance survives so the reader can render its glyph + card");
  assert.equal(owned.vkind, "silent");
  assert.equal(owned.note, "No answer was given.");
});

test("a grounded quote round-trips back to editor HTML with its citation", () => {
  const pull = {
    type: "pull", kind: "block", text: QUOTE,
    tokens: [{ c: QUOTE, src: ["doc-x"], id: "cs-q", q: { "doc-x": QUOTE } }],
  };
  const html = A.blocksToHtml([pull]);
  assert.match(html, /<blockquote>/, "still a blockquote");
  assert.match(html, /data-src="doc-x"/, "the source survives the round trip");
  assert.match(html, /data-quotes=/, "the pinned passage survives the round trip");
  assert.ok(html.includes(QUOTE), "the quote text is intact");
});
