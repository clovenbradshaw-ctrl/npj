/* fact-check-export.test.js — the "outstanding fact checks" shaper
 * (app/fact-check-export.js). Pure, no DOM: hand it a payload of per-claim
 * propositions exactly like the GroundingWorkspace assembles, and check the
 * output is a clean plain-text bullet list — a title line and bullets, nothing
 * else — safe to paste into an email or a text. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const FC = require("../app/fact-check-export.js");

const PAYLOAD = {
  title: "Metro Removes More Benches",
  items: [
    { status: "needs", props: ["Metro removed benches from Church Street Park", "The NDP manages Church Street Park"] },
    { status: "needs", props: ["The DMC submitted its budget to the Metro Council"] },
    { status: "conflict", props: ["Metro removed benches from Church Street Park"] } // dup across claims
  ]
};

test("toText is a plain title line + bullet list, no markdown scaffolding", () => {
  const t = FC.toText(PAYLOAD);
  const lines = t.split("\n");
  assert.equal(lines[0], "Outstanding fact checks — Metro Removes More Benches");
  assert.equal(lines[1], "");
  assert.ok(lines.includes("• Metro removed benches from Church Street Park"));
  assert.ok(lines.includes("• The DMC submitted its budget to the Metro Council"));
  // none of the worksheet scaffolding the user rejected
  assert.doesNotMatch(t, /^#/m);
  assert.doesNotMatch(t, /\*\*/);
  assert.doesNotMatch(t, /Where it sits|Source \(link\)|Verdict|ref `/);
});

test("propositions are deduped across claims", () => {
  const t = FC.toText(PAYLOAD);
  assert.equal((t.match(/Metro removed benches from Church Street Park/g) || []).length, 1);
});

test("bullets() returns the flat, deduped proposition list in reading order", () => {
  assert.deepEqual(FC.bullets(PAYLOAD), [
    "Metro removed benches from Church Street Park",
    "The NDP manages Church Street Park",
    "The DMC submitted its budget to the Metro Council"
  ]);
});

test("summary counts the propositions and the source claims", () => {
  assert.deepEqual(FC.summary(PAYLOAD), { props: 3, claims: 3 });
});

test("an all-grounded draft says there is nothing to verify, with no bullets", () => {
  const t = FC.toText({ title: "Clean", items: [] });
  assert.match(t, /Nothing to verify/);
  assert.doesNotMatch(t, /•/);
});

test("a title-less payload still opens with a clean header", () => {
  assert.match(FC.toText({ items: [{ props: ["A claim"] }] }), /^Outstanding fact checks\n/);
});

test("filename slugs the title", () => {
  assert.equal(FC.filename(PAYLOAD, "txt"), "metro-removes-more-benches-fact-checks.txt");
  assert.equal(FC.filename({ title: "" }), "draft-fact-checks.txt");
});
