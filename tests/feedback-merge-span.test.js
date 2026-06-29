/* feedback-merge-span.test.js — a merged reader suggestion changes EXACTLY the
 * selected words, not the whole sentence (app/feedback/feedback.js applyToBody).
 *
 * The reader can drag-select any run of text on the published page and propose
 * an edit. The selection carries a `claimId` only as a locating hint — the merge
 * still swaps the selected sub-span, never the entire claim sentence. A whole-
 * claim anchor (quote === the claim's own text, from the "Suggest edit" on a
 * citation) still replaces the claim outright; a free selection that runs across
 * several tokens is spliced in across them. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const FB = require("../app/feedback/feedback.js").NpjFeedback;
const apply = FB.applyToBody;

const txt = (b) => (b.tokens || []).map((t) => (typeof t === "string" ? t : (t.c != null ? t.c : (t.text || "")))).join("");

test("a sub-span selection inside a claim edits only the selected words", () => {
  const body = [{ type: "p", tokens: [{ c: "The bench was removed on Tuesday.", id: "c1" }] }];
  // reader selected just "Tuesday" and proposed "Wednesday" — claimId pins the sentence
  const out = apply(body, { proposed: "Wednesday", anchor: { quote: "Tuesday", claimId: "c1", prefix: "removed on ", suffix: "." } });
  assert.equal(txt(out[0]), "The bench was removed on Wednesday.");
  // the claim token is preserved (keeps its id), only its text changed
  assert.equal(out[0].tokens[0].id, "c1");
});

test("a whole-claim anchor replaces the entire sentence", () => {
  const body = [{ type: "p", tokens: [{ c: "The bench was removed on Tuesday.", id: "c1" }] }];
  // the "Suggest edit" on a citation: quote IS the whole claim text
  const out = apply(body, { proposed: "The bench was restored Friday.", anchor: { quote: "The bench was removed on Tuesday.", claimId: "c1" } });
  assert.equal(txt(out[0]), "The bench was restored Friday.");
});

test("a free selection in a plain run edits just those words (no claimId)", () => {
  const body = [{ type: "p", tokens: ["Metro removed the benches without notice."] }];
  const out = apply(body, { proposed: "twelve benches", anchor: { quote: "the benches", prefix: "removed ", suffix: " without" } });
  assert.equal(txt(out[0]), "Metro removed twelve benches without notice.");
});

test("the claim handle wins over an identical fragment earlier in the paragraph", () => {
  const body = [{ type: "p", tokens: ["A bench. ", { c: "A bench was removed.", id: "c2" }] }];
  // "A bench" appears in both tokens; claimId must steer the edit to c2
  const out = apply(body, { proposed: "That bench", anchor: { quote: "A bench", claimId: "c2" } });
  assert.equal(txt(out[0]), "A bench. That bench was removed.");
});

test("a selection that runs across two tokens is spliced in across them", () => {
  const body = [{ type: "p", tokens: [{ c: "The bench was removed.", id: "c1" }, " ", { c: "Riders objected.", id: "c2" }] }];
  // a drag from mid-c1 through mid-c2 — quote crosses the token boundary, no single claimId
  const out = apply(body, { proposed: "torn out, and riders", anchor: { quote: "removed. Riders" } });
  assert.equal(txt(out[0]), "The bench was torn out, and riders objected.");
  // the untouched head of the first token keeps its claim id
  assert.equal(out[0].tokens[0].id, "c1");
});

test("a quote that no longer exists is a conflict (null), never a wrong edit", () => {
  const body = [{ type: "p", tokens: [{ c: "The bench was removed.", id: "c1" }] }];
  const out = apply(body, { proposed: "x", anchor: { quote: "the kiosk was painted", claimId: "cZ" } });
  assert.equal(out, null);
});

test("a selection inside a heading edits only those words", () => {
  const body = [{ type: "h2", text: "Benches removed by Metro" }];
  const out = apply(body, { proposed: "torn out", anchor: { quote: "removed" } });
  assert.equal(out[0].text, "Benches torn out by Metro");
});
