/* articles-fold.test.js — the composer-HTML → body-token fold (app/articles.js
 * htmlToBlocks).
 *
 * Focus: a SOURCED claim span is an explicit boundary. When the author selects
 * a run of text and binds a source, the editor wraps the WHOLE selection in one
 * <span class="claim-src"> and drops the numbered <sup class="md-cite"> right
 * after it. The grounding workspace shades every sentence that span covers, so
 * the published/preview fold must ground the SAME span — not just its trailing
 * sentence. (The old fold recursed into the span and let the marker run
 * splitClaim, which shrank a multi-sentence selection to its last sentence, so
 * the transparency lens grounded less than the prose editor showed.)
 *
 * No jsdom — htmlToBlocks parses via document.createElement+innerHTML, so we
 * hand it a tiny faithful node tree through a createElement shim (the innerHTML
 * string is ignored; the pre-built childNodes are the truth). Matches npj's
 * no-build, zero-dep test ethos. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");

// ---- minimal faithful DOM: just what htmlToBlocks' walk reads ----
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
// fold a paragraph built from these top-level nodes, returning its tokens
function foldParagraph(children) {
  const root = { childNodes: [enode("p", {}, children)], set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try {
    const out = A.htmlToBlocks("<p>ignored — the shim feeds the real tree</p>");
    const p = out.blocks.find((b) => b.type === "p");
    return (p && p.tokens) || [];
  } finally { global.document = saved; }
}
const claimSrc = (attrs, text) => enode("span", Object.assign({ class: "claim-src" }, attrs), [tnode(text)]);
const cite = (attrs, label) => enode("sup", Object.assign({ class: "md-cite" }, attrs), [tnode(label)]);

const S1 = "100% of the DMC's budget goes to NDP, and the DMC is required by law to submit its budget annually to the Metro Council for specific review and approval. ";
const S2 = "Prior to this year, it had not done so for 22 years.";

test("a multi-sentence claim-src folds to ONE claim covering the whole span", () => {
  // the editor's shape: <span class="claim-src" data-src=k>…two sentences…</span><sup>1</sup>
  const toks = foldParagraph([
    claimSrc({ "data-src": "s8", "data-cid": "c8", "data-quote": "Q8" }, S1 + S2),
    cite({ "data-cite": "s8", "data-cid": "c8", "data-quote": "Q8" }, "1"),
  ]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1, "the whole selection is one claim, not a trailing-sentence remnant");
  assert.equal(claims[0].c, S1 + S2, "the claim text is the FULL wrapped span (both sentences)");
  assert.deepEqual(claims[0].src, ["s8"]);
  assert.deepEqual(claims[0].q, { s8: "Q8" }, "the trailing marker's pinned quote merges onto the claim");
  // nothing leaks out as a stray plain-text remnant of the first sentence
  assert.ok(!toks.some((t) => typeof t === "string" && t.includes("100%")), "no orphaned plain text");
});

test("a single-sentence claim-src is unchanged — one grounded claim", () => {
  const toks = foldParagraph([
    claimSrc({ "data-src": "s2", "data-cid": "c2", "data-quote": "Q" }, S2),
    cite({ "data-cite": "s2", "data-cid": "c2", "data-quote": "Q" }, "1"),
  ]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].c, S2);
  assert.deepEqual(claims[0].src, ["s2"]);
});

test("two trailing markers on one claim-src → one claim, two sources", () => {
  const toks = foldParagraph([
    claimSrc({ "data-src": "a", "data-cid": "c" }, S2),
    cite({ "data-cite": "a", "data-cid": "c", "data-quote": "QA" }, "1"),
    cite({ "data-cite": "b", "data-cid": "c", "data-quote": "QB" }, "2"),
  ]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].src, ["a", "b"], "the second marker adds its source to the same claim");
  assert.deepEqual(claims[0].q, { a: "QA", b: "QB" });
});

test("a BARE marker (no claim-src wrapper) still binds only its trailing sentence", () => {
  // the composer's other shape: text typed, then a marker — splitClaim must keep
  // grounding the sentence the marker follows, leaving the rest plain.
  const toks = foldParagraph([
    tnode("Two sentences here. Only the last is cited."),
    cite({ "data-cite": "s1" }, "1"),
  ]);
  assert.deepEqual(toks[0], "Two sentences here. ");
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].c, "Only the last is cited.");
  assert.deepEqual(claims[0].src, ["s1"]);
});

test("an unsourced claim-src wrapper stays transparent (folds to plain prose)", () => {
  // a transient/owned-forming wrapper with no data-src and no data-stance is not
  // a citation — its text rides through as ordinary prose.
  const toks = foldParagraph([claimSrc({ "data-cid": "c" }, "Just some wrapped words.")]);
  assert.deepEqual(toks, ["Just some wrapped words."]);
});
