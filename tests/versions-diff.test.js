/* versions-diff.test.js — the word-level diff behind the edit-history pane
 * (app/record/versions-diff.js).
 *
 * diffWords is an LCS over whitespace-KEEPING tokens, so the danger is where a
 * changed word's flanking spaces get matched and the word itself does not: the
 * edit's whitespace is then stranded OUTSIDE the del/add pair. That is what made
 * a replaced word render as "wasappears" and a struck word as "theMNPD".
 * normalizeDiff (baked into diffWords) repairs it. These tests render the parts
 * to the exact text a reader sees — del→~x~, add→[x], same→x — so a collision
 * here is a collision on screen, and assert word counts (diffStats) stay exact.
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../app/record/versions-diff.js");

const render = (parts) => parts.map(p => p.type === "same" ? p.text : p.type === "add" ? "[" + p.text + "]" : "~" + p.text + "~").join("");
const diff = (a, b) => D.diffWords(a, b);
// the on-screen defect in one predicate: any del run immediately followed by an
// add run (or vice-versa) with no separating space between them
const collides = (parts) => parts.some((p, k) => {
  const q = parts[k + 1];
  return q && ((p.type === "del" && q.type === "add") || (p.type === "add" && q.type === "del"));
});

test("a replaced word keeps a space between the deletion and its insertion", () => {
  // "was" → "appears": the shared spaces flank the pair, so the naive LCS left
  // them touching ("it ~was~[appears] here"). The separator space must appear.
  const parts = diff("it was here", "it appears here");
  assert.equal(render(parts), "it ~was~ [appears] here");
  assert.equal(collides(parts), false);
});

test("consecutive one-word replacements each stay separated (the MNPD case)", () => {
  const parts = diff("the MNPD last had", "MNPD has been");
  const r = render(parts);
  assert.equal(collides(parts), false);
  assert.ok(r.includes("~last~ [has]"), r);
  assert.ok(r.includes("~had~ [been]"), r);
  assert.ok(!r.includes("~last~[has]"), r);
});

test("a deletion never drags a trailing space into its strike (theMNPD → the MNPD)", () => {
  const parts = diff("the MNPD is here", "MNPD is here");
  assert.equal(render(parts), "~the~ MNPD is here");
});

test("a removed leading token reads cleanly (the 'And Park.' case)", () => {
  assert.equal(render(diff("And Park. And that", "Park. And that")), "~And~ Park. And that");
});

test("no del/add run is ever left edged with whitespace", () => {
  const parts = diff("one two three four", "one TWO three FOUR five");
  for (const p of parts)
    if (p.type !== "same") assert.equal(p.text, p.text.trim(), JSON.stringify(p));
  assert.equal(collides(parts), false);
});

test("word counts are unaffected by the whitespace repair", () => {
  assert.deepEqual(D.diffStats(diff("it was here", "it appears here")), { add: 1, del: 1 });
  assert.deepEqual(D.diffStats(diff("a b", "a x y b")), { add: 2, del: 0 });
  assert.deepEqual(D.diffStats(diff("a b c", "a c")), { add: 0, del: 1 });
});

test("identical inputs are a single same run with zero stats", () => {
  const parts = diff("no change at all", "no change at all");
  assert.deepEqual(parts, [{ type: "same", text: "no change at all" }]);
  assert.deepEqual(D.diffStats(parts), { add: 0, del: 0 });
});

test("empty ⇄ text is a clean pure add / pure del", () => {
  assert.equal(render(diff("", "brand new")), "[brand new]");
  assert.equal(render(diff("old text", "")), "~old text~");
});

test("normalizeDiff is idempotent (diffWords already normalizes)", () => {
  const once = diff("it was here now", "it appears here today");
  assert.deepEqual(D.normalizeDiff(once), once);
});
