/* authorship-leakage.test.js — the Newsroom's "Authors" mode (app/feedback/
 * authorship.js) never reaches the published record.
 *
 * data-author / data-author-ts / --author-c ride the draft's own HTML exactly
 * like structure.js's data-sec (Invariant I1) — they're stamped straight onto
 * the live <p>/<h2>/<li>… elements the author is editing. htmlToBlocks builds
 * each block token purely from a node's TEXT (inlineTokens/walk), never from
 * its attributes, so an editor-only tag on the block itself should vanish at
 * the fold without any special-case stripping. These tests prove that stays
 * true — that the mxid, the timestamp and the CSS custom property never turn
 * up anywhere in the folded block model.
 *
 * No jsdom — htmlToBlocks parses via document.createElement+innerHTML, so we
 * feed it a tiny faithful node tree through a createElement shim, matching
 * articles-fold.test.js / preview-fold.test.js. `node --test`.
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
// fold a whole top-level body from these nodes
function foldBody(children) {
  const root = { childNodes: children, set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try { return A.htmlToBlocks("<p>ignored — the shim feeds the real tree</p>"); }
  finally { global.document = saved; }
}

const MXID = "@alice:hyphae.social";

test("a data-author paragraph folds to plain text — no attribute, no mxid, anywhere", () => {
  const out = foldBody([
    enode("p", { "data-author": MXID, "data-author-ts": "1700000000000", style: "--author-c:#b23a26" },
      [tnode("Hello world, this is the draft.")]),
  ]);
  const p = out.blocks.find((b) => b.type === "p");
  assert.ok(p, "the paragraph still folds");
  assert.equal(p.tokens.join(""), "Hello world, this is the draft.");
  const dump = JSON.stringify(out.blocks);
  assert.ok(!dump.includes(MXID), "the author's mxid never rides into the block model");
  assert.ok(!dump.includes("data-author"), "the attribute name itself never rides into the block model");
  assert.ok(!dump.includes("author-c"), "the color custom property never rides into the block model");
});

test("a data-author heading folds the same way", () => {
  const out = foldBody([
    enode("h2", { "data-author": MXID }, [tnode("A section written by someone")]),
  ]);
  const h = out.blocks.find((b) => b.type === "h2");
  assert.ok(h, "the heading still folds");
  assert.equal(h.text, "A section written by someone");
  assert.ok(!JSON.stringify(out.blocks).includes(MXID));
});

test("mixed authors on adjacent paragraphs still fold to plain, attribution-free text", () => {
  const out = foldBody([
    enode("p", { "data-author": "@alice:hyphae.social" }, [tnode("Alice wrote this first paragraph.")]),
    enode("p", { "data-author": "@bob:hyphae.social" }, [tnode("Bob edited this second one.")]),
  ]);
  const paras = out.blocks.filter((b) => b.type === "p");
  assert.equal(paras.length, 2);
  assert.equal(paras[0].tokens.join(""), "Alice wrote this first paragraph.");
  assert.equal(paras[1].tokens.join(""), "Bob edited this second one.");
  const dump = JSON.stringify(out.blocks);
  assert.ok(!dump.includes("alice") && !dump.includes("bob"), "neither collaborator's identity survives the fold");
});
