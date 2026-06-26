/* sentences.test.js — the live sentence segmenter (app/sentences.js).
 *
 * Focus: the grounding table shows one row per SENTENCE, but an inline citation
 * marker (<sup class="md-cite">1</sup>) lands in block.textContent between a
 * sentence's end punctuation and the next sentence's leading space — "…Kupin."
 * + "1" + " In…" → "…Kupin.1 In…". Unmasked, the splitter sees "." followed by a
 * digit (not whitespace) and MERGES the two sentences into one row, so a grounded
 * sentence silently swallows the un-grounded sentence after it. segment() masks
 * those marker spans (via markerRanges) so every true sentence stays its own row.
 *
 * Pure logic only — no jsdom, matching npj's no-build, zero-dep test ethos
 * (markerRanges is exercised through a tiny faithful DOM stub). `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/sentences.js");

test("splitOffsets splits a paragraph into one record per sentence", () => {
  const out = S.splitOffsets("First sentence. Second sentence.");
  assert.equal(out.length, 2);
  assert.equal(out[0].text.trim(), "First sentence.");
  assert.equal(out[1].text.trim(), "Second sentence.");
});

test("offsets index the original text — slicing back returns the verbatim sentence", () => {
  const text = "A short one! And another? And a third.";
  const out = S.splitOffsets(text);
  assert.equal(out.length, 3);
  out.forEach((p) => assert.equal(text.slice(p.start, p.end), p.text));
  assert.equal(out[1].text.trim(), "And another?");
});

test("an empty / null mask behaves exactly like no mask", () => {
  const text = "One. Two. Three.";
  const base = S.splitOffsets(text).map((p) => [p.start, p.end]);
  assert.deepEqual(S.splitOffsets(text, null).map((p) => [p.start, p.end]), base);
  assert.deepEqual(S.splitOffsets(text, []).map((p) => [p.start, p.end]), base);
});

test("BUG, unmasked: a citation marker wedged after the period merges two sentences", () => {
  // exactly what block.textContent looks like once sentence 1 is grounded
  const text = "Last year benches were removed by Kupin.1 In a record interview he acknowledged it.";
  assert.equal(S.splitOffsets(text).length, 1); // the "." is followed by "1", not a space → no split
});

test("masking the marker's char range restores the sentence boundary", () => {
  const text = "Last year benches were removed by Kupin.1 In a record interview he acknowledged it.";
  const marker = text.indexOf(".1") + 1; // the "1" sits between the period and the space
  const out = S.splitOffsets(text, [[marker, marker + 1]]);
  assert.equal(out.length, 2);
  // offsets still point at the ORIGINAL characters (marker included on sentence 1,
  // where the grounding lives; the table strips the sup for display separately)
  assert.equal(out[0].text, "Last year benches were removed by Kupin.1 ");
  assert.equal(text.slice(out[1].start, out[1].end), "In a record interview he acknowledged it.");
});

test("a multi-digit marker is masked across its full width, offsets intact", () => {
  const text = "He won.12 Then he lost.";
  const marker = text.indexOf(".12") + 1;
  const out = S.splitOffsets(text, [[marker, marker + 2]]);
  assert.equal(out.length, 2);
  assert.equal(text.slice(out[1].start, out[1].end), "Then he lost.");
});

test("a trailing marker (no following sentence) never invents a split", () => {
  const text = "He won the race.1";
  const marker = text.length - 1;
  assert.equal(S.splitOffsets(text, [[marker, marker + 1]]).length, 1);
});

// ---- markerRanges over a tiny faithful DOM stub (no jsdom) ----
// Only the bits markerRanges walks: firstChild/nextSibling, nodeType/nodeValue,
// tagName/classList.contains, textContent, and block.querySelector('sup.md-cite').
const txt = (s) => ({ nodeType: 3, nodeValue: s, textContent: s, nextSibling: null });
const sup = (s) => ({ nodeType: 1, tagName: "SUP", classList: { contains: (c) => c === "md-cite" }, textContent: s, firstChild: null, nextSibling: null });
const span = (s) => { const t = txt(s); return { nodeType: 1, tagName: "SPAN", classList: { contains: () => false }, firstChild: t, textContent: s, nextSibling: null }; };
function block(children) {
  for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  const sups = children.filter((c) => c.tagName === "SUP" && c.classList.contains("md-cite"));
  return {
    nodeType: 1, tagName: "P", firstChild: children[0] || null,
    classList: { contains: () => false },
    textContent: children.map((c) => c.textContent).join(""),
    querySelector: (sel) => (sel === "sup.md-cite" && sups.length ? sups[0] : null),
  };
}

test("markerRanges finds a sup.md-cite at its textContent offset (recursing through claim spans)", () => {
  const a = "Last year benches were removed by Kupin.";
  const b = " In a record interview he acknowledged it.";
  const el = block([span(a), sup("1"), txt(b)]);
  assert.deepEqual(S.markerRanges(el), [[a.length, a.length + 1]]);
  // and the range, fed back as a mask, is what unmerges the two sentences
  const out = S.splitOffsets(el.textContent, S.markerRanges(el));
  assert.equal(out.length, 2);
});

test("markerRanges returns nothing for a block with no markers", () => {
  assert.deepEqual(S.markerRanges(block([txt("Just plain prose. Two sentences.")])), []);
});

// ---- direct-text windows: a mixed container must not drop its own prose ----
// segment() used to skip ANY div/blockquote that wrapped a nested block, silently
// dropping the container's lead-in/trailing sentences. nestedBlockRanges +
// directRuns isolate a block's OWN text so it's captured while nested blocks are
// segmented on their own pass. Tiny faithful element stub (firstChild/nextSibling/
// nodeType/nodeValue/tagName/textContent) — same no-jsdom ethos as above.
const T = (s) => ({ nodeType: 3, nodeValue: s, textContent: s, nextSibling: null });
function E(tag, kids) {
  kids = (kids || []).map((k) => (typeof k === "string" ? T(k) : k));
  for (let i = 0; i < kids.length; i++) kids[i].nextSibling = kids[i + 1] || null;
  return { nodeType: 1, tagName: tag.toUpperCase(), firstChild: kids[0] || null, textContent: kids.map((k) => k.textContent).join("") };
}

test("a leaf block has no nested-block ranges and one full-width run (old behaviour, unchanged)", () => {
  const p = E("p", ["First sentence. Second sentence."]);
  assert.deepEqual(S.nestedBlockRanges(p), []);
  assert.deepEqual(S.directRuns(p, p.textContent.length), [{ start: 0, end: p.textContent.length }]);
});

test("a mixed container keeps its lead-in prose as a direct-text run", () => {
  // "Intro. " then a <ul><li>x</li></ul> — the list text belongs to the <li> row,
  // the "Intro. " is the container's own prose the old code dropped
  const div = E("div", ["Intro. ", E("ul", [E("li", ["x"])])]);
  assert.deepEqual(S.nestedBlockRanges(div), [[7, 8]]);
  assert.deepEqual(S.directRuns(div, div.textContent.length), [{ start: 0, end: 7 }]);
});

test("a pure wrapper (only nested blocks) yields no direct-text runs", () => {
  const div = E("div", [E("p", ["a"]), E("p", ["b"])]);
  assert.deepEqual(S.nestedBlockRanges(div), [[0, 1], [1, 2]]);
  assert.deepEqual(S.directRuns(div, div.textContent.length), []);
});

test("a container keeps trailing prose after a nested block", () => {
  const div = E("div", [E("ul", [E("li", ["x"])]), "after"]);
  assert.deepEqual(S.directRuns(div, div.textContent.length), [{ start: 1, end: 6 }]);
});

test("hasBareText: bare text or an inline element counts; only-block children do not", () => {
  assert.equal(S.hasBareText(E("div", ["loose ", E("p", ["block"])])), true);
  assert.equal(S.hasBareText(E("div", [E("span", ["inline"])])), true);
  assert.equal(S.hasBareText(E("div", [E("p", ["only a block child"])])), false);
});
