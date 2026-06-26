/* definitions.test.js — the glossary model (app/grounding/definitions.js).
 *
 * Pure logic only: term identity, npj-side ranking off an eoreader4 doc, the
 * multi-definition + sourced model, the cross-article collective index, conflict
 * detection, and resolve(). The browser halves (archive.org fetches, the engine
 * bridge) are exercised in the app, not here. No DOM, no engine. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../app/grounding/definitions.js");

test("termKey folds case, leading articles and punctuation to one key", () => {
  assert.equal(D.termKey("Qualified Immunity"), "qualified immunity");
  assert.equal(D.termKey("The Nashville Downtown Partnership"), "nashville downtown partnership");
  assert.equal(D.termKey("a Consent Decree."), "consent decree");
});

test("sizeFor scales with length and clamps", () => {
  assert.equal(D.sizeFor(0), 3);
  assert.equal(D.sizeFor(650), 5);
  assert.equal(D.sizeFor(100000), 24);
  assert.equal(D.sizeFor(650, { wordsPerTerm: 65 }), 10);
});

test("rankFromDoc ranks admitted figures off a parsed doc (no engine code)", () => {
  // a minimal eoreader4-shaped doc: admission with Maps, sentences for context
  const doc = {
    text: "Helena Vox leads the council. Helena Vox spoke twice. The council met once.",
    sentences: ["Helena Vox leads the council.", "Helena Vox spoke twice.", "The council met once."],
    admission: {
      admitted: new Map([["Helena Vox", "helena"], ["Council", "council"]]),
      counts: new Map([["Helena Vox", 2], ["Council", 1]]),
      mentions: new Map([["helena", [0, 1]], ["council", [0, 2]]]),
    },
  };
  const r = D.rankFromDoc(doc, doc.text, {});
  const terms = r.terms.map(t => t.term);
  assert.ok(terms.includes("Helena Vox"));
  // Helena Vox is sighted more + multi-word → it outranks Council
  assert.equal(r.terms[0].term, "Helena Vox");
  assert.ok(r.terms[0].count >= 2);
  assert.ok(r.terms[0].contexts.length >= 1, "carries context sentences");
});

test("rankFromDoc folds a parenthetical acronym onto its expansion", () => {
  const text = "The Nashville Downtown Partnership (NDP) filed a plan. The NDP met.";
  const doc = {
    text,
    sentences: text.split(". "),
    admission: {
      admitted: new Map([["Nashville Downtown Partnership", "ndp"], ["NDP", "ndp2"]]),
      counts: new Map([["Nashville Downtown Partnership", 1], ["NDP", 2]]),
      mentions: new Map([["ndp", [0]], ["ndp2", [0, 1]]]),
    },
  };
  const r = D.rankFromDoc(doc, text, {});
  const entry = r.terms.find(t => /Nashville Downtown Partnership/.test(t.term));
  assert.ok(entry, "spelled-out form is the headword");
  assert.equal(entry.acronym, "NDP");
  assert.ok(!r.terms.some(t => t.term === "NDP"), "no duplicate bare-acronym row");
});

test("normEntry accepts a term with MULTIPLE definitions", () => {
  const e = D.normEntry({ term: "Charge", defs: [
    { text: "a formal accusation", sense: "legal" },
    { text: "an amount billed", sense: "financial" },
  ] });
  assert.equal(e.defs.length, 2);
  assert.equal(e.defs[0].sense, "legal");
  assert.ok(e.defs[0].id && /^d-/.test(e.defs[0].id));
});

test("normEntry is back-compatible with the single-def shape", () => {
  const e = D.normEntry({ term: "Escrow", def: "funds held by a third party", source: "manual" });
  assert.equal(e.defs.length, 1);
  assert.equal(e.defs[0].text, "funds held by a third party");
  assert.equal(e.defs[0].origin, "manual");
});

test("a definition can carry an archived source; the preserved date is read from the wayback url", () => {
  const arch = "https://web.archive.org/web/20260625150000id_/https://example.com/p";
  assert.equal(D.snapshotDateOf(arch), "2026-06-25");
  const e = D.normEntry({ term: "Redlining", defs: [
    { text: "denying services by neighborhood", source: { url: "https://example.com/p", archive_url: arch, outlet: "example.com", title: "Redlining explained" } },
  ] });
  const s = e.defs[0].source;
  assert.equal(s.outlet, "example.com");
  assert.equal(s.preserved, "2026-06-25");
  assert.equal(s.status, "archived");
});

test("normSource needs at least a url or an archive url", () => {
  assert.equal(D.normSource({ title: "x" }), null);
  assert.ok(D.normSource({ url: "https://e.com" }));
});

test("buildGroups collects EVERY definition of a term across articles + multi-def entries", () => {
  const idx = D.buildGroups([
    { slug: "a", headline: "A", ts: "2026-01-01", definitions: [
      { term: "Charge", defs: [
        { text: "a formal accusation", sense: "legal" },
        { text: "an amount billed", sense: "financial" },
      ] },
    ] },
    { slug: "b", headline: "B", ts: "2026-03-01", definitions: [
      { term: "charge", defs: [{ text: "to rush forward", sense: "motion" }] },
    ] },
  ]);
  const g = idx.get("charge");
  assert.equal(g.count, 3, "two defs from A + one from B");
  assert.equal(g.variants, 3);
  assert.equal(g.conflicting, true);
  assert.equal(g.canonical.slug, "b", "most recent published definition is canonical");
});

test("resolve attaches prior published definitions, newest first", () => {
  const idx = D.buildGroups([
    { slug: "a", headline: "A", ts: "2026-01-01", definitions: [{ term: "Escrow", defs: [{ text: "older take" }] }] },
    { slug: "b", headline: "B", ts: "2026-05-01", definitions: [{ term: "Escrow", defs: [{ text: "newer take" }] }] },
  ]);
  const [t] = D.resolve([{ term: "escrow" }], idx);
  assert.equal(t.priorCount, 2);
  assert.equal(t.alternates[0].def, "newer take");
  assert.equal(t.conflicting, true);
});
