/* articles-fold.test.js — the composer-HTML → body-token fold (app/record/articles.js
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
const A = require("../app/record/articles.js");

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

test("a citation marker NESTED inside a sourced claim-src never leaks its number into the prose", () => {
  // the cite-broken shape from the editor: the <sup>23</sup> ends up INSIDE the
  // claim span (not after it), so its digits would ride along in textContent and
  // print as "publication.23" in the published read. The claim text must be clean.
  const inner = enode("span", { class: "claim-src cite-broken", "data-src": "doc-x", "data-cid": "ci" },
    [tnode("A website tallies 53 deaths as of publication.")]);
  const innerSup = cite({ "data-cite": "doc-x", "data-cid": "ci" }, "23");
  const outer = enode("span", { class: "claim-src", "data-src": "web-y", "data-cid": "co", "data-quote": "53 Deaths" },
    [inner, innerSup]);
  const outerSup = cite({ "data-cite": "web-y", "data-cid": "co", "data-quote": "53 Deaths" }, "22");
  const toks = foldParagraph([outer, outerSup]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].c, "A website tallies 53 deaths as of publication.", "no '23' baked into the claim text");
  assert.ok(!toks.some((t) => typeof t === "object" && t.c != null && /23\b/.test(t.c)), "no stray citation number in any claim");
});

test("a citation marker nested inside an OWNED (stance) claim drops its number too", () => {
  const innerSrc = enode("span", { class: "claim-src cite-broken", "data-src": "web-z" }, [tnode("astroturf")]);
  const innerSup = cite({ "data-cite": "web-z" }, "27");
  const outer = enode("span", { class: "claim-src", "data-stance": "analysis" },
    [tnode('attempt to "'), innerSrc, innerSup, tnode('" governance.')]);
  const toks = foldParagraph([outer]);
  const owned = toks.filter((t) => t && typeof t === "object" && t.stance);
  assert.equal(owned.length, 1);
  assert.equal(owned[0].c, 'attempt to "astroturf" governance.', "the nested marker '27' is stripped from owned prose");
});

// fold a whole tree of top-level nodes (not just one paragraph) → the blocks
function foldBlocks(nodes) {
  const root = { childNodes: nodes, set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try { return A.htmlToBlocks("<x>ignored — the shim feeds the real tree</x>").blocks; }
  finally { global.document = saved; }
}
const fnCite = (label, key) => enode("sup", { class: "md-cite", "data-fn": "1", "data-cite": key }, [tnode(label)]);

test("a footnote at the END of a blockquote rides on the pull's `marks`, not the quote text", () => {
  // the marker references the QUOTE; the pull's text is a plain string, so it can't
  // hold the marker inline — keep `text` clean and carry the marker on `marks` so it
  // renders as a trailing superscript instead of gluing a digit onto the quote.
  const blocks = foldBlocks([
    enode("blockquote", {}, [tnode("Utilise the cracks."), fnCite("21", "fn21")]),
    enode("p", {}, [tnode("A city department inverts the term.")]),
  ]);
  const pull = blocks.find((b) => b.type === "pull");
  assert.equal(pull.text, "Utilise the cracks.", "the quote text carries no marker digit");
  assert.ok((pull.marks || []).some((t) => t.t === "sup" && t.key === "fn21"), "the marker is on the quote's marks");
  assert.ok(blocks.some((b) => b.type === "footnotes" && b.notes.some((n) => n.key === "fn21")), "a Notes entry is created for the quote's footnote");
});

test("a blockquote footnote round-trips through blocksToHtml (idempotent, marker stays in the quote)", () => {
  const blocks = foldBlocks([enode("blockquote", {}, [tnode("Utilise the cracks."), fnCite("21", "fn21")])]);
  const pull = blocks.find((b) => b.type === "pull");
  const html = A.blocksToHtml([pull]);
  assert.match(html, /^<blockquote>Utilise the cracks\.<sup class="md-cite"[^>]*data-cite="fn21"[^>]*>\d+<\/sup><\/blockquote>$/, "the marker re-emits inside the blockquote, editable");
});

test("an inline CITATION marker inside a blockquote never glues its number into the quote text", () => {
  // the cite-broken pull shape from the editor: a sourced claim-src inside the
  // quote, trailed by one or more <sup class="md-cite"> citation markers (NO
  // data-fn). The quote text is a plain string with no source apparatus, so the
  // markers' digits used to ride along — surfacing as "…pariatur.86". They must
  // be dropped from the text (and they are NOT footnotes, so never become marks).
  const claim = enode("span", { class: "claim-src", "data-src": "doc-x" },
    [tnode("Quis autem vel eum iure reprehenderit, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur.")]);
  const blocks = foldBlocks([
    enode("blockquote", {}, [enode("span", {}, [claim, cite({ "data-cite": "doc-y" }, "8"), cite({ "data-cite": "doc-x" }, "6")])]),
  ]);
  const pull = blocks.find((b) => b.type === "pull");
  assert.equal(pull.text, "Quis autem vel eum iure reprehenderit, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur.",
    "no citation digits (8/6) leaked into the quote text");
  assert.ok(!/\d/.test(pull.text), "the quote text carries no stray number at all");
  assert.ok(!(pull.marks || []).length, "an inline citation marker is not a footnote — it becomes no `marks` entry");
});

test("a citation marker NESTED inside a sourced claim-src in a <p> never leaks its number (regression for '…doloribus.11')", () => {
  // the torture-test nested shape: inner sourced claim-src, then a <sup>11</sup>
  // INSIDE the outer claim-src, then a sibling <sup>10</sup> outside it.
  const inner = enode("span", { class: "claim-src", "data-src": "doc-lorem09" }, [tnode("Nested claim: ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus.")]);
  const outer = enode("span", { class: "claim-src", "data-src": "web-lorem10" }, [inner, cite({ "data-cite": "doc-lorem09" }, "11")]);
  const toks = foldParagraph([outer, cite({ "data-cite": "web-lorem10" }, "10")]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].c, "Nested claim: ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus.", "no '11' baked into the claim text");
  assert.ok(!toks.some((t) => typeof t === "string" && /\d/.test(t)), "no stray citation number leaked as plain text");
});

test("a marker stranded in a <p> below a blockquote folds onto the quote, leaving no lone line", () => {
  // an older draft saved before the marker was tucked into the quote: <blockquote/>
  // then <p><sup/></p>. It must fold onto the pull above, not the paragraph below.
  const blocks = foldBlocks([
    enode("blockquote", {}, [tnode("Utilise the cracks.")]),
    enode("p", {}, [fnCite("21", "fn21")]),
    enode("p", {}, [tnode("A city department inverts the term.")]),
  ]);
  const pull = blocks.find((b) => b.type === "pull");
  assert.ok((pull.marks || []).some((t) => t.t === "sup" && t.key === "fn21"), "the stranded marker folded onto the quote");
  const para = blocks.find((b) => b.type === "p" && b.tokens.some((t) => typeof t === "string" && /A city department/.test(t)));
  assert.ok(!para.tokens.some((t) => t && t.t === "sup"), "the paragraph below is not footnoted with the quote's note");
  assert.ok(!blocks.some((b) => b.type === "p" && b.tokens.length && b.tokens.every((t) => t && t.t === "sup")), "no lone-marker paragraph survives");
});

test("a plain <blockquote> folds to a BLOCK quote (kind:block, no align)", () => {
  const pull = foldBlocks([enode("blockquote", {}, [tnode("A quoted passage.")])]).find((b) => b.type === "pull");
  assert.equal(pull.kind, "block", "a bare blockquote is the bordered block-quote flavour");
  assert.equal(pull.align, undefined, "no explicit justification");
});

test("a <blockquote class=np-pull align=center> folds to a centred PULL quote", () => {
  const pull = foldBlocks([enode("blockquote", { class: "np-pull", align: "center" }, [tnode("A display callout.")])]).find((b) => b.type === "pull");
  assert.equal(pull.kind, "pull", "np-pull marks the large display flavour");
  assert.equal(pull.align, "center", "the justification rides on `align`");
});

test("kind + align round-trip through blocksToHtml", () => {
  const html = A.blocksToHtml([{ type: "pull", text: "A display callout.", kind: "pull", align: "right" }]);
  assert.match(html, /<blockquote class="np-pull" style="text-align:right">A display callout\.<\/blockquote>/, "the flavour and justification re-emit, editable");
  const plain = A.blocksToHtml([{ type: "pull", text: "Passage.", kind: "block" }]);
  assert.match(plain, /^<blockquote>Passage\.<\/blockquote>$/, "a block quote stays a bare blockquote");
});

test("a bound-but-unpinned stance span publishes as OWNED (the author asserts)", () => {
  // the editor's default after binding a source but before pinning a line:
  // <span class="claim-src" data-stance="analysis" data-src=k>…</span><sup>1</sup>
  // (data-quote still empty, no citation record). It must fold to an owned token —
  // never a sourced "needs a quote" token, and the trailing marker must not crash
  // the fold or graft a source onto the owned claim.
  const toks = foldParagraph([
    claimSrc({ "data-src": "s9", "data-cid": "c9", "data-stance": "analysis", "data-quote": "" }, S2),
    cite({ "data-cite": "s9", "data-cid": "c9", "data-quote": "" }, "1"),
  ]);
  const owned = toks.filter((t) => t && typeof t === "object" && t.stance);
  assert.equal(owned.length, 1, "the stance span is owned, not a dangling sourced claim");
  assert.equal(owned[0].c, S2);
  assert.equal(owned[0].src, undefined, "no source is folded onto the owned claim");
});

test("a pinned line flips a stance span to SOURCED — the source wins", () => {
  const toks = foldParagraph([
    claimSrc({ "data-src": "s8", "data-cid": "c8", "data-stance": "analysis", "data-quote": "Q8" }, S1),
    cite({ "data-cite": "s8", "data-cid": "c8", "data-quote": "Q8" }, "1"),
  ]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.ok(!claims[0].stance, "once a line is pinned the claim ships sourced, not owned");
  assert.deepEqual(claims[0].src, ["s8"]);
  assert.deepEqual(claims[0].q, { s8: "Q8" });
});

test("an unpinned legacy bound span (no stance) still folds sourced and ungrounded", () => {
  // pre-default-owned drafts: <span class="claim-src" data-src=k>…</span> with no
  // pinned words and no stance keeps its old shape — a sourced claim with q
  // undefined, which the publish gate flags as "cites a whole page".
  const toks = foldParagraph([
    claimSrc({ "data-src": "s3", "data-cid": "c3", "data-quote": "" }, S2),
    cite({ "data-cite": "s3", "data-cid": "c3", "data-quote": "" }, "1"),
  ]);
  const claims = toks.filter((t) => t && typeof t === "object" && t.c != null);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].src, ["s3"]);
  assert.equal(claims[0].q, undefined, "still ungrounded — flagged at the publish gate");
});
