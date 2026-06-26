/* void-kinds.test.js — the six-kind void taxonomy (app/core/void-kinds.js).
 * A void is an asserted absence; the six kinds rank how hard the absence is to
 * stand behind, and split into three groups by what the author can offer a
 * reader: SHOW it, LOCATE it, or only ASSERT it. These guard the shape and the
 * ordering the editor + reader + publish fold all rely on. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const VK = require("../app/core/void-kinds.js");

test("there are exactly six kinds, ordered strongest → weakest", () => {
  assert.deepEqual(VK.ORDER, ["removed", "withheld", "silent", "inaccessible", "unrecorded", "ambient"]);
  // strength descends monotonically down the order (removed strongest, ambient weakest)
  const strengths = VK.ORDER.map(k => VK.KINDS[k].strength);
  assert.deepEqual(strengths, [...strengths].sort((a, b) => b - a));
  assert.equal(strengths[0], 6);
  assert.equal(strengths[strengths.length - 1], 1);
});

test("every kind carries the metadata the UI + reader need", () => {
  VK.ORDER.forEach(k => {
    const d = VK.KINDS[k];
    assert.ok(d.label, k + " has a label");
    assert.ok(d.blurb, k + " has a blurb");
    assert.ok(d.prompt, k + " has an author prompt");
    assert.ok(d.glyph, k + " has a glyph");
    assert.ok(["show", "locate", "assert"].includes(d.group), k + " is in a known group");
  });
});

test("the three groups partition the six kinds: show / locate / assert", () => {
  assert.deepEqual(VK.GROUPS.map(g => g.key), ["show", "locate", "assert"]);
  assert.deepEqual(VK.kindsIn("show"), ["removed", "withheld"]);     // you can point to it
  assert.deepEqual(VK.kindsIn("locate"), ["silent", "inaccessible"]); // describe or locate it
  assert.deepEqual(VK.kindsIn("assert"), ["unrecorded", "ambient"]);  // you can only assert it
  // every kind belongs to exactly one group, and the groups cover all six
  const all = VK.GROUPS.flatMap(g => VK.kindsIn(g.key));
  assert.deepEqual(all.slice().sort(), VK.ORDER.slice().sort());
});

test("the reader split is shown / located / inferred — the heart of the spec", () => {
  // "a reader knows whether you're showing them an absence or inferring one"
  assert.equal(VK.reader("removed"), "shown");
  assert.equal(VK.reader("withheld"), "shown");
  assert.equal(VK.reader("silent"), "located");
  assert.equal(VK.reader("inaccessible"), "located");
  assert.equal(VK.reader("unrecorded"), "inferred");
  assert.equal(VK.reader("ambient"), "inferred");
});

test("norm accepts a known kind (case-insensitive) and rejects anything else", () => {
  assert.equal(VK.norm("removed"), "removed");
  assert.equal(VK.norm("  WITHHELD "), "withheld");
  assert.equal(VK.norm("bogus"), null);
  assert.equal(VK.norm(""), null);
  assert.equal(VK.norm(null), null);
});
