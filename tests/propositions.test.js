/* propositions.test.js — the pure surface of the eoreader4 adapter
 * (app/propositions.js): turning a projected graph into deduped, bare
 * proposition strings. The engine load itself is browser-only (lazy ESM import);
 * here we feed synthetic graphs shaped like eoreader4's projectGraph output and
 * check the rendering, id→surface resolution, negation and dedup. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../app/propositions.js");

const entities = new Map([
  ["e1", { name: "Metro" }],
  ["e2", { name: "benches" }],
  ["e3", { name: "Church Street Park" }]
]);
const graph = {
  entities,
  representative: (id) => id,
  edges: [
    { from: "e1", to: "e2", via: "remove", kind: "con", polarity: "+" },
    { from: "e2", to: "e3", via: "located_in", kind: "con" },
    { from: "e1", to: "e2", via: "remove", kind: "con" },            // dup
    { from: "e1", to: "e3", via: "manage", kind: "con", polarity: "-" }
  ]
};

test("a projected graph renders deduped bare propositions in order", () => {
  assert.deepEqual(P.propositionsFromGraph(graph), [
    "Metro remove benches",
    "Benches located in Church Street Park",
    "Metro not manage Church Street Park"
  ]);
});

test("renderEdge resolves endpoint ids via the entities map and prettifies the relation", () => {
  assert.equal(P.renderEdge({ from: "e2", to: "e3", via: "located_in" }, entities, (id) => id),
    "Benches located in Church Street Park");
});

test("renderEdge accepts eoreader4's src/tgt/rel alias fields", () => {
  assert.equal(P.renderEdge({ src: "e1", tgt: "e2", rel: "remove" }, entities, null), "Metro remove benches");
});

test("a negated tie reads with 'not'", () => {
  assert.equal(P.renderEdge({ from: "e1", to: "e3", via: "manage", polarity: "-" }, entities, null),
    "Metro not manage Church Street Park");
});

test("entities may be a plain object, and representative() merges aliased ids", () => {
  const ents = { canon: { name: "NDP" }, p: { name: "park" } };
  const g = { entities: ents, representative: (id) => (id === "alias" ? "canon" : id),
    edges: [{ from: "alias", to: "p", via: "manage" }] };
  assert.deepEqual(P.propositionsFromGraph(g), ["NDP manage park"]);
});

test("an edge missing a slot is skipped, never rendered half", () => {
  assert.equal(P.renderEdge({ from: "e1", via: "remove" }, entities, null), ""); // no object
  assert.equal(P.renderEdge({ from: "e1", to: "e2" }, entities, null), "");      // no relation
});

test("prettyRel normalises separators and case", () => {
  assert.equal(P.prettyRel("located_in"), "located in");
  assert.equal(P.prettyRel("GOVERNS"), "governs");
});

test("an unknown id falls back to the id string", () => {
  assert.equal(P.renderEdge({ from: "x9", to: "y8", via: "links" }, entities, null), "X9 links y8");
});

test("an empty or edgeless graph yields no propositions", () => {
  assert.deepEqual(P.propositionsFromGraph(null), []);
  assert.deepEqual(P.propositionsFromGraph({ edges: [] }), []);
});
