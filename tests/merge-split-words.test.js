/* merge-split-words.test.js — the fold/read-model repair that stitches a word
 * cut across a paragraph break (app/articles.js mergeSplitWords).
 *
 * An accidental block split inside the contentEditable (a stray Enter/paste) or
 * an older record saved that way can cut a paragraph mid-WORD: "…public bench.
 * B" then a fresh paragraph "ut the incursion…". The reader, the live Preview
 * and the Substack export each render a <p> per block, so the word "But" prints
 * with a blank line wedged through it. mergeSplitWords stitches the two blocks
 * back into one so the preview shows exactly what was written — and ONLY on that
 * unmistakable seam (prev ends on a word char, next opens lowercase). `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");
const merge = A.mergeSplitWords;

const txt = (b) => (b.tokens || []).map((t) => (typeof t === "string" ? t : (t.c != null ? t.c : (t.text || "")))).join("");

test("stitches a word split across two paragraphs (the bench case)", () => {
  const out = merge([
    { type: "p", tokens: ["It is difficult to imagine … more apolitical than a public bench. B"] },
    { type: "p", tokens: ["ut the incursion of Metro's Department of Law …"] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(txt(out[0]), "It is difficult to imagine … more apolitical than a public bench. But the incursion of Metro's Department of Law …");
  // the two seam strings collapse into a single token — one rebuilt word
  assert.equal(out[0].tokens.length, 1);
});

test("leaves a genuine paragraph break alone (next opens with a capital)", () => {
  const blocks = [
    { type: "p", tokens: ["…and that was the end of it."] },
    { type: "p", tokens: ["But the next morning brought news."] },
  ];
  assert.deepEqual(merge(blocks), blocks);
});

test("leaves a break alone when the paragraph above ends on punctuation/space", () => {
  const blocks = [
    { type: "p", tokens: ["A complete sentence."] },
    { type: "p", tokens: ["and a deliberately lowercase next line"] },
  ];
  // prev ends on "." (not a word char), so the lowercase next line is NOT a word split
  assert.deepEqual(merge(blocks), blocks);
});

test("does not stitch across a hard line break (<br> at the seam)", () => {
  const blocks = [
    { type: "p", tokens: ["line one", { t: "br" }] },
    { type: "p", tokens: ["under the break"] },
  ];
  assert.deepEqual(merge(blocks), blocks);
});

test("does not stitch across a non-paragraph block (an <hr> between)", () => {
  const blocks = [
    { type: "p", tokens: ["the section ends here. B"] },
    { type: "hr" },
    { type: "p", tokens: ["ut a divider is a real boundary"] },
  ];
  assert.deepEqual(merge(blocks), blocks);
});

test("preserves a styled/claim seam token (object first in the next block)", () => {
  const out = merge([
    { type: "p", tokens: ["The mayor said the program was a B"] },
    { type: "p", tokens: [{ c: "ust", src: ["k1"], id: "x" }, " of activity."] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(txt(out[0]), "The mayor said the program was a Bust of activity.");
  // a string + claim object can't fuse into one string — they ride adjacent
  assert.equal(out[0].tokens.length, 3);
  assert.equal(out[0].tokens[1].c, "ust");
});

test("stitches a chain of fragments (B | u | st)", () => {
  const out = merge([
    { type: "p", tokens: ["a quick B"] },
    { type: "p", tokens: ["u"] },
    { type: "p", tokens: ["st of growth"] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(txt(out[0]), "a quick Bust of growth");
});

test("idempotent — a second pass is a no-op", () => {
  const once = merge([
    { type: "p", tokens: ["public bench. B"] },
    { type: "p", tokens: ["ut the incursion…"] },
  ]);
  assert.deepEqual(merge(once), once);
});

test("does not mutate the input blocks", () => {
  const input = [
    { type: "p", tokens: ["public bench. B"] },
    { type: "p", tokens: ["ut the incursion…"] },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  merge(input);
  assert.deepEqual(input, snapshot);
});
