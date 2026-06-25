/* grounding-void.test.js — a "void" on the publish side (app/articles.js).
 * A void is an asserted absence (data-stance="absence") that ALSO carries which
 * of the six kinds it is (data-void-kind) — so the published record, and the
 * reader, know whether the absence is shown, located, or only inferred. These
 * assert the kind survives the fold + the editor round-trip, that a void still
 * reads as prose, and that an unknown kind is dropped. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");

const ACTOR = "@reporter:hyphae.social";
const CLAIM = "no permit for the removal was ever filed with Metro";
const SEARCH = "Searched Metro public records, the Banner and the Tennessean (2024–2026) — found no permit or notice.";

function publish(body) {
  const line = A.genesisLine({ slug: "benches", headline: "Benches", dek: "", body, authors: [ACTOR], assignees: [ACTOR], published: "2026-06-24", sources: {} }, ACTOR);
  return A.foldLog(line).article;
}

test("a void publishes as an asserted absence carrying its kind + search note", () => {
  const art = publish([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "v1", note: SEARCH, vkind: "silent" }] }]);
  const tok = art.body[0].tokens[0];
  assert.equal(tok.stance, "absence");
  assert.equal(tok.vkind, "silent");   // WHICH kind of void rides the published token
  assert.equal(tok.note, SEARCH);
  assert.equal(tok.c, CLAIM);
});

test("a void reads as prose — its claim text is in the plain text, the note is not", () => {
  const art = publish([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "v1", note: SEARCH, vkind: "removed" }] }]);
  const plain = A.plainText(art.body);
  assert.ok(plain.includes("no permit"));               // the claim reads inline
  assert.ok(!plain.includes("Searched Metro"));         // the documented search is grounding, not body copy
});

test("the editor round-trip (blocksToHtml) carries the kind on the span", () => {
  const html = A.blocksToHtml([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "v1", note: SEARCH, vkind: "withheld" }] }]);
  assert.ok(/data-stance="absence"/.test(html));
  assert.ok(/data-void-kind="withheld"/.test(html));    // re-editing keeps which kind of void it is
});

test("an unknown void kind is dropped (only the six are valid)", () => {
  const html = A.blocksToHtml([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "v1", vkind: "made-up" }] }]);
  assert.ok(!/data-void-kind/.test(html));
});

test("each of the six kinds round-trips through the editor HTML", () => {
  ["removed", "withheld", "silent", "inaccessible", "unrecorded", "ambient"].forEach(kind => {
    const html = A.blocksToHtml([{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "v1", vkind: kind }] }]);
    assert.ok(new RegExp('data-void-kind="' + kind + '"').test(html), kind + " survives blocksToHtml");
  });
});

test("the published body round-trips byte-for-byte through a no-op edit (REC)", () => {
  const body = [{ type: "p", tokens: [{ c: CLAIM, stance: "absence", id: "v1", note: SEARCH, vkind: "silent" }] }];
  const ins = A.genesisLine({ slug: "benches", headline: "Benches", dek: "", body, authors: [ACTOR], assignees: [ACTOR], published: "2026-06-24", sources: {} }, ACTOR);
  const rec = A.editLine("benches", { dek: "A subtitle" }, ACTOR, "add a dek");
  const art = A.foldLog(ins + "\n" + rec).article;
  assert.equal(art.dek, "A subtitle");
  assert.deepEqual(art.body[0].tokens[0], { c: CLAIM, stance: "absence", id: "v1", note: SEARCH, vkind: "silent" });
});
