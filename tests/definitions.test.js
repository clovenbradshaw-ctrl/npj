/* definitions.test.js — the collective glossary (app/definitions.js).
 *
 * Pure logic only: term identity, the cross-article grouping of published
 * definitions, conflict detection, resolve(), and size-relative counting. The
 * extraction half (extract → eoreader4) needs the browser bridge and is covered
 * by eoreader4's own glossary.test.js. No DOM, no engine here. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../app/definitions.js");

test("termKey folds case, leading articles and punctuation to one key", () => {
  assert.equal(D.termKey("Qualified Immunity"), "qualified immunity");
  assert.equal(D.termKey("qualified immunity"), "qualified immunity");
  assert.equal(D.termKey("The Nashville Downtown Partnership"), "nashville downtown partnership");
  assert.equal(D.termKey("a Consent Decree."), "consent decree");
  assert.equal(D.termKey("council’s"), "councils");   // apostrophe dropped, stem kept
});

test("normList keeps one chosen definition per term per article", () => {
  const out = D.normList([
    { term: "Redlining", def: "first" },
    { term: "redlining", def: "second (dropped — same key)" },
    { term: "Escrow", def: "held funds" },
    { junk: true },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].def, "first");
  assert.ok(out[0].id && /^def-/.test(out[0].id));
});

test("sizeFor scales with length and clamps (engine-free fallback)", () => {
  assert.equal(D.sizeFor(0), 3);
  assert.equal(D.sizeFor(650), 5);
  assert.equal(D.sizeFor(100000), 24);
  assert.equal(D.sizeFor(650, { wordsPerTerm: 65 }), 10);
});

test("buildGroups aggregates a term across articles and flags conflicts", () => {
  const idx = D.buildGroups([
    { slug: "a", headline: "Piece A", ts: "2026-01-01", definitions: [
      { term: "Qualified Immunity", def: "shields officials from suit" },
    ] },
    { slug: "b", headline: "Piece B", ts: "2026-03-01", definitions: [
      { term: "qualified immunity", def: "a doctrine the courts invented" }, // conflicting text
    ] },
    { slug: "c", headline: "Piece C", ts: "2026-02-01", definitions: [
      { term: "Escrow", def: "funds held by a third party" },
    ] },
  ]);
  const qi = idx.get("qualified immunity");
  assert.ok(qi, "term aggregated across articles");
  assert.equal(qi.count, 2, "defined by two articles");
  assert.equal(qi.variants, 2);
  assert.equal(qi.conflicting, true, "two distinct definitions = conflict");
  // canonical = most recently published non-empty definition (Piece B, March)
  assert.equal(qi.canonical.slug, "b");
  // a single-definition term is not conflicting
  assert.equal(idx.get("escrow").conflicting, false);
});

test("buildGroups bridges an acronym to its spelled-out expansion", () => {
  const idx = D.buildGroups([
    { slug: "a", headline: "A", ts: "2026-01-01", definitions: [
      { term: "Nashville Downtown Partnership", def: "a business group", kind: "acronym", acronym: "NDP" },
    ] },
    { slug: "b", headline: "B", ts: "2026-02-01", definitions: [
      { term: "NDP", def: "the downtown partnership" },
    ] },
  ]);
  // both reach the SAME group, via the acronym alias
  const viaExpansion = idx.get("nashville downtown partnership");
  const viaAcronym = idx.get("ndp");
  assert.ok(viaExpansion && viaAcronym);
  assert.equal(viaExpansion.termKey, viaAcronym.termKey);
  assert.equal(viaExpansion.count, 2);
});

test("resolve attaches prior published definitions, newest first", () => {
  const idx = D.buildGroups([
    { slug: "a", headline: "A", ts: "2026-01-01", definitions: [{ term: "Escrow", def: "older take" }] },
    { slug: "b", headline: "B", ts: "2026-05-01", definitions: [{ term: "Escrow", def: "newer take" }] },
  ]);
  const [t] = D.resolve([{ term: "escrow" }], idx);
  assert.equal(t.priorCount, 2);
  assert.equal(t.alternates[0].def, "newer take", "newest alternate first");
  assert.equal(t.conflicting, true);
  // a term the record has never defined resolves cleanly to nothing
  const [u] = D.resolve([{ term: "Habeas Corpus" }], idx);
  assert.equal(u.priorCount, 0);
  assert.equal(u.conflicting, false);
  assert.equal(u.canonical, null);
});
