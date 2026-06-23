/* fact-check-export.test.js — the "outstanding fact checks" shaper
 * (app/fact-check-export.js). Pure, no DOM: hand it a payload of {claim, need}
 * items exactly like the GroundingWorkspace assembles, and check the output is a
 * clean plain-text list — a title line and one "• claim → evidence needed" line
 * per claim, nothing else — safe to paste into an email or a text. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const FC = require("../app/fact-check-export.js");

const PAYLOAD = {
  title: "Metro Removes More Benches",
  items: [
    { sid: "sn-1", status: "needs", claim: "Benches were removed from Church Street Park last week.", need: "a dated record of the event" },
    { sid: "sn-2", status: "needs", claim: "Travelers sued NDP for gross negligence over the garage.", need: "an official document (court filing, permit, or ordinance)" },
    { sid: "sn-1b", status: "conflict", claim: "Benches were removed from Church Street Park last week.", need: "a dated record of the event" } // dup claim
  ]
};

test("toText is a plain title line + one '• claim → evidence' line per claim", () => {
  const t = FC.toText(PAYLOAD);
  const ls = t.split("\n");
  assert.equal(ls[0], "Outstanding fact checks — Metro Removes More Benches");
  assert.equal(ls[1], "");
  assert.ok(t.includes("• Benches were removed from Church Street Park last week. → a dated record of the event"));
  assert.ok(t.includes("• Travelers sued NDP for gross negligence over the garage. → an official document (court filing, permit, or ordinance)"));
  // none of the worksheet scaffolding the user rejected
  assert.doesNotMatch(t, /^#/m);
  assert.doesNotMatch(t, /\*\*|Where it sits|Source \(link\)|Verdict|ref `/);
});

test("claims are deduped (same sentence as needs + conflict appears once)", () => {
  assert.equal((FC.toText(PAYLOAD).match(/Church Street Park last week/g) || []).length, 1);
});

test("lines() returns one deduped 'claim → need' per claim, in order", () => {
  assert.deepEqual(FC.lines(PAYLOAD), [
    "Benches were removed from Church Street Park last week. → a dated record of the event",
    "Travelers sued NDP for gross negligence over the garage. → an official document (court filing, permit, or ordinance)"
  ]);
});

test("a missing need falls back to a generic line", () => {
  assert.ok(FC.toText({ items: [{ claim: "A bare claim." }] }).includes("• A bare claim. → a source that confirms this"));
});

test("summary counts the claims", () => {
  assert.deepEqual(FC.summary(PAYLOAD), { claims: 2 });
});

test("an all-grounded draft says there is nothing to verify, with no bullets", () => {
  const t = FC.toText({ title: "Clean", items: [] });
  assert.match(t, /Nothing to verify/);
  assert.doesNotMatch(t, /•/);
});

test("filename slugs the title", () => {
  assert.equal(FC.filename(PAYLOAD, "txt"), "metro-removes-more-benches-fact-checks.txt");
  assert.equal(FC.filename({ title: "" }), "draft-fact-checks.txt");
});
