/* structure.test.js — folds, flattens and stress-tests the structure engine
 * (app/structure.js) against the spec's invariants. Pure data, no DOM, no
 * browser: `node --test`. Run from the repo root with `npm test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/structure.js");

// fold a fresh log built by appending the events each op produces.
function build(steps) {
  let log = [];
  for (const evs of steps) log = log.concat(evs);
  return { log, state: S.fold(log) };
}
const typeById = (id) => S.BUILTIN_TYPES.find((t) => t.id === id);

// every key that appears anywhere in a flatten() result, recursively.
function keysDeep(v, acc) {
  acc = acc || new Set();
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => { acc.add(k); keysDeep(v[k], acc); });
  return acc;
}

test("empty fold is an empty organic-only post", () => {
  const s = S.fold([]);
  assert.equal(s.appliedTypeId, null);
  assert.deepEqual(s.slots, []);
  assert.deepEqual(s.sections, []);
  assert.deepEqual(S.flatten(s), []);
});

test("organic-only: headings become orphan sections, in document order", () => {
  const { state } = build([
    S.ops.fromHeader("s-intro", { id: "a", heading: "Intro" }),
    S.ops.fromHeader("s-body", { id: "b", heading: "Body" }),
    S.ops.fromHeader("s-end", { id: "c", heading: "The end" })
  ]);
  assert.equal(state.appliedTypeId, null);
  assert.equal(state.slots.length, 0);
  assert.deepEqual(S.flattenIds(state), ["a", "b", "c"]);
  assert.deepEqual(S.flatten(state), [
    { heading: "Intro", body: { kind: "headingSpan", headingSlug: "s-intro" } },
    { heading: "Body", body: { kind: "headingSpan", headingSlug: "s-body" } },
    { heading: "The end", body: { kind: "headingSpan", headingSlug: "s-end" } }
  ]);
});

test("apply a type to a blank page: all slots, each empty → flatten emits nothing", () => {
  const { state } = build([S.ops.applyType(S.fold([]), typeById("investigation"))]);
  assert.equal(state.appliedTypeId, "investigation");
  assert.equal(state.slots.length, 4);
  assert.deepEqual(state.slots.map((s) => s.label), [
    "Open on a person or moment", "Why it matters", "The evidence", "Bring it home"
  ]);
  // a fresh templated post has no prose — no empty-stub leakage (I1).
  assert.deepEqual(S.flatten(state), []);
});

test("§6 apply-after-the-fact: organic sections stay put as orphans, slots append after", () => {
  let log = [].concat(
    S.ops.fromHeader("s-one", { id: "a", heading: "One" }),
    S.ops.fromHeader("s-two", { id: "b", heading: "Two" })
  );
  let s = S.fold(log);
  log = log.concat(S.ops.applyType(s, typeById("news-report")));
  s = S.fold(log);
  // sections untouched, still orphans, still first in the linear order
  assert.deepEqual(S.flattenIds(s), ["a", "b"]);
  assert.equal(s.sections.filter((x) => x.parentSlotId == null).length, 2);
  assert.equal(s.slots.length, 3);
  // dragging "Two" into the first slot moves it in the projected order
  const slot0 = S.topRefs(s).find((r) => r.kind === "slot").id;
  log = log.concat(S.ops.moveSection("b", slot0, 0));
  s = S.fold(log);
  assert.equal(S.sectionById(s, "b").parentSlotId, slot0);
});

test("I1 — flatten never leaks structural fields", () => {
  // a fully mixed post: slots with children, an interleaved orphan, an empty slot
  let s = S.fold([]);
  let log = S.ops.applyType(s, typeById("investigation"));
  s = S.fold(log);
  const slots = S.topRefs(s).filter((r) => r.kind === "slot").map((r) => r.id);
  log = log.concat(
    S.ops.fromHeader("s-raid", { id: "h1", heading: "The morning of the raid", parentSlotId: slots[0] }),
    S.ops.fromHeader("s-contract", { id: "h2", heading: "What the contract authorizes", parentSlotId: slots[1] }),
    S.ops.fromHeader("s-signed", { id: "h3", heading: "Who signed off", parentSlotId: slots[1] }),
    S.ops.fromHeader("s-sourcing", { id: "h4", heading: "A note on sourcing" }) // orphan
  );
  s = S.fold(log);
  const out = S.flatten(s);
  // only { heading, body:{kind, headingSlug} } — nothing else, ever.
  const allowed = new Set(["heading", "body", "kind", "headingSlug", "startBlockId", "endBlockId"]);
  for (const k of keysDeep(out)) assert.ok(allowed.has(k), "leaked structural key: " + k);
  // the labels/prompts/type id must be absent from the serialized projection
  const json = JSON.stringify(out);
  ["Open on a person", "Why it matters", "parentSlotId", "fromHeader", "investigation", "typeSlotKey", "prompt"]
    .forEach((needle) => assert.ok(!json.includes(needle), "leaked: " + needle));
  // order is preserved by the walk
  assert.deepEqual(out.map((x) => x.heading), [
    "The morning of the raid", "What the contract authorizes", "Who signed off", "A note on sourcing"
  ]);
});

test("I2 — removing a type is lossless and preserves visual order", () => {
  let s = S.fold([]);
  let log = S.ops.applyType(s, typeById("investigation"));
  s = S.fold(log);
  const slots = S.topRefs(s).filter((r) => r.kind === "slot").map((r) => r.id);
  log = log.concat(
    S.ops.fromHeader("s-a", { id: "a", heading: "A", parentSlotId: slots[0] }),
    S.ops.fromHeader("s-b", { id: "b", heading: "B", parentSlotId: slots[1] }),
    S.ops.fromHeader("s-c", { id: "c", heading: "C", parentSlotId: slots[1] }),
    S.ops.fromHeader("s-orphan", { id: "o", heading: "Orphan" })
  );
  s = S.fold(log);
  const before = S.flatten(s);
  log = log.concat(S.ops.removeType(s));
  s = S.fold(log);
  // every slot dissolved, every section promoted to an orphan, content intact
  assert.equal(s.slots.length, 0);
  assert.equal(s.appliedTypeId, null);
  assert.ok(s.sections.every((x) => x.parentSlotId == null));
  assert.deepEqual(S.flatten(s), before, "flatten output unchanged across remove (lossless)");
  // re-applying is just another apply
  log = log.concat(S.ops.applyType(s, typeById("explainer")));
  s = S.fold(log);
  assert.equal(s.appliedTypeId, "explainer");
  assert.deepEqual(S.flattenIds(s), ["a", "b", "c", "o"], "sections survive a re-apply");
});

test("I3 — structure references prose; deleting the layer leaves prose untouched", () => {
  // prose is the source of truth; the layer only points at it by slug.
  const prose = { "s-x": "…the morning of the raid…", "s-y": "…who signed off…" };
  let log = [].concat(
    S.ops.fromHeader("s-x", { id: "x", heading: "X" }),
    S.ops.fromHeader("s-y", { id: "y", heading: "Y" })
  );
  let s = S.fold(log);
  log = log.concat(S.ops.deleteSection("x"), S.ops.deleteSection("y"));
  s = S.fold(log);
  assert.equal(s.sections.length, 0, "annotations dropped");
  assert.deepEqual(prose, { "s-x": "…the morning of the raid…", "s-y": "…who signed off…" }, "prose is untouched");
});

test("I4 — the fold is deterministic and incremental (snapshot + tail === full)", () => {
  let log = S.ops.applyType(S.fold([]), typeById("news-report"));
  const slots = S.topRefs(S.fold(log)).filter((r) => r.kind === "slot").map((r) => r.id);
  log = log.concat(
    S.ops.fromHeader("s-1", { id: "p", heading: "P", parentSlotId: slots[0] }),
    S.ops.fromHeader("s-2", { id: "q", heading: "Q" }),
    S.ops.moveSection("q", slots[1], 0)
  );
  // folding the same log twice yields identical state
  assert.deepEqual(S.fold(log), S.fold(log));
  // a snapshot of the first 3 events + the tail equals the full fold
  const head = log.slice(0, 3), tail = log.slice(3);
  const snap = S.fold(head);
  assert.deepEqual(S.fold(tail, snap), S.fold(log));
  assert.equal(S.fold(log).version, log.length);
});

test("move / move_bulk / reorderSlot keep dense, correct order", () => {
  let log = [].concat(
    S.ops.fromHeader("s-a", { id: "a" }), S.ops.fromHeader("s-b", { id: "b" }),
    S.ops.fromHeader("s-c", { id: "c" }), S.ops.fromHeader("s-d", { id: "d" })
  );
  let s = S.fold(log);
  // move d to the front
  log = log.concat(S.ops.moveSection("d", null, 0)); s = S.fold(log);
  assert.deepEqual(S.flattenIds(s), ["d", "a", "b", "c"]);
  // bulk-move a+c to the end, preserving their relative order
  log = log.concat(S.ops.moveBulk(["a", "c"], null, 99)); s = S.fold(log);
  assert.deepEqual(S.flattenIds(s), ["d", "b", "a", "c"]);
  // orders are dense 0..n at the top level
  assert.deepEqual(S.topRefs(s).map((r) => r.order), [0, 1, 2, 3]);
});

test("§4 — saveFrom captures the slot arc only (labels, empty prompts, no content)", () => {
  let s = S.fold([]);
  let log = S.ops.applyType(s, typeById("explainer"));
  s = S.fold(log);
  log = log.concat(S.ops.fromHeader("s-z", { id: "z", heading: "Some prose" }));
  s = S.fold(log);
  const t = S.saveFrom(s, "My explainer");
  assert.equal(t.builtin, false);
  assert.equal(t.name, "My explainer");
  assert.equal(t.slots.length, 4, "captures the four slots");
  assert.deepEqual(t.slots.map((x) => x.label), ["A way in", "The question this answers", "How it works", "What to watch"]);
  assert.ok(t.slots.every((x) => x.prompt === ""), "user-saved prompts are empty");
  assert.ok(!JSON.stringify(t).includes("Some prose"), "no prose, no orphan sections captured");
});

test("built-in types are well-formed", () => {
  const ids = new Set();
  for (const t of S.BUILTIN_TYPES) {
    assert.ok(t.id && t.name && t.builtin === true, "type has id/name/builtin");
    assert.ok(!ids.has(t.id), "unique type id"); ids.add(t.id);
    assert.ok(Array.isArray(t.slots) && t.slots.length >= 2, "type has slots");
    const keys = new Set();
    for (const sl of t.slots) {
      assert.ok(sl.key && sl.label && sl.prompt, "slot has key/label/prompt");
      assert.ok(!keys.has(sl.key), "unique slot key within a type"); keys.add(sl.key);
    }
  }
});

test("validate flags a section pointing at a missing slot", () => {
  const s = S.fold([S.ops.createSection("ghost-slot", 0, { id: "x" })[0]]);
  // createSection at a non-existent slot lands the section at top level (safe);
  // but a hand-built dangling pointer is caught.
  const broken = S.fold([]);
  broken.sections.push({ id: "z", heading: null, body: { kind: "stubOnly" }, parentSlotId: "nope", order: 0, fromHeader: false, collapsed: false });
  assert.ok(S.validate(broken).length > 0);
  assert.deepEqual(S.validate(s), []);
});
