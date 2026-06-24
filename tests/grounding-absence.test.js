/* grounding-absence.test.js — the "asserted absence" grounding kind, on the
 * publish side (app/articles.js). An asserted absence grounds a NEGATIVE claim
 * ("X has not been documented appearing elsewhere") not with a citation but with
 * a documented search that found nothing — carried as the owned token's `note`.
 * These assert the published body preserves the stance + the search note through
 * the fold, and that stanceNorm admits it. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");

const ACTOR = "@reporter:hyphae.social";
const CLAIM = "the phrase “FUCK PISSREAL” has not been documented appearing in other places in Nashville than on the community benches";
const SEARCH = "Searched the Nashville Banner, the Tennessean, Metro public records and social media, 2024–2026 — no other occurrence found.";

function publish(body) {
  const line = A.genesisLine({ slug: "benches", headline: "Benches", dek: "", body, authors: [ACTOR], assignees: [ACTOR], published: "2026-06-24", sources: {} }, ACTOR);
  return A.foldLog(line).article;
}

test("an asserted-absence claim publishes as an owned token carrying its search note", () => {
  const art = publish([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "a1", note: SEARCH }] }]);
  const tok = art.body[0].tokens[0];
  assert.equal(tok.stance, "absence");
  assert.equal(tok.note, SEARCH);          // the documented search rides the published token
  assert.equal(tok.c, CLAIM);
});

test("an asserted absence reads as prose — its claim text is in the plain text, the note is not", () => {
  const art = publish([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "a1", note: SEARCH }] }]);
  const plain = A.plainText(art.body);
  assert.ok(plain.includes("has not been documented"));   // the claim reads inline like any sentence
  assert.ok(!plain.includes("Searched the Nashville Banner")); // the search is grounding, not body copy
});

test("an absence with no note still publishes (the search can be filled later)", () => {
  const art = publish([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "a1" }] }]);
  const tok = art.body[0].tokens[0];
  assert.equal(tok.stance, "absence");
  assert.ok(!("note" in tok) || !tok.note);
});

test("the published body round-trips byte-for-byte through a no-op edit (REC)", () => {
  // an asserted absence must survive an ordinary later edit unchanged
  const body = [{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "a1", note: SEARCH }] }];
  const ins = A.genesisLine({ slug: "benches", headline: "Benches", dek: "", body, authors: [ACTOR], assignees: [ACTOR], published: "2026-06-24", sources: {} }, ACTOR);
  const rec = A.editLine("benches", { dek: "A subtitle" }, ACTOR, "add a dek");
  const art = A.foldLog(ins + "\n" + rec).article;
  assert.equal(art.dek, "A subtitle");
  assert.deepEqual(art.body[0].tokens[0], { c: CLAIM, stance: "absence", id: "a1", note: SEARCH });
});
