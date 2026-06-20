/* structure-dom.test.js — the DOM bridge (S.dom.collect/reflow/reconcile), the
 * code that keeps the editor's contenteditable and the structure log in step.
 * Uses a tiny, faithful DOM mock (real appendChild move semantics) so CI needs
 * no jsdom — matching npj's no-build, zero-dep ethos.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/structure.js");

// ---- minimal DOM: element nodes with an ordered children list ----
class N {
  constructor(tag, attrs, text) {
    this.tagName = tag ? tag.toUpperCase() : null;
    this.children = [];
    this.parent = null;
    this._attrs = Object.assign({}, attrs || {});
    this.textContent = text || "";
  }
  get innerText() { return this.textContent; }
  get id() { return this._attrs.id; }
  set id(v) { this._attrs.id = v; }
  getAttribute(k) { const v = k === "id" ? this._attrs.id : this._attrs[k]; return v == null ? null : v; }
  setAttribute(k, v) { this._attrs[k] = v; }
  appendChild(node) { // move semantics: detach from old parent, push to end
    if (node.parent) { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1); }
    node.parent = this; this.children.push(node); return node;
  }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) { this.children.splice(i, 1); node.parent = null; } return node; }
  querySelectorAll(sel) {
    const tags = sel.toUpperCase().split(",").map((s) => s.trim());
    const out = []; const walk = (n) => n.children.forEach((c) => { if (tags.includes(c.tagName)) out.push(c); walk(c); });
    walk(this); return out;
  }
}
const el = (tag, attrs, text) => new N(tag, attrs, text);
function root(children) { const r = new N("div"); children.forEach((c) => r.appendChild(c)); return r; }
const heading = (slug, sec, text) => el("h2", { id: slug, "data-sec": sec }, text);

test("dom.collect reads section-spans in order; lead nodes are excluded", () => {
  const r = root([
    el("figure", { class: "nr-banner" }), el("h1", {}, "Title"), el("p", { class: "nr-dek" }, "dek"),
    heading("s-a", "a", "A"), el("p", {}, "a1"), el("p", {}, "a2"),
    heading("s-b", "b", "B"), el("p", {}, "b1")
  ]);
  const { spans, order } = S.dom.collect(r);
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(spans.a.length, 3); // heading + 2 paragraphs
  assert.equal(spans.b.length, 2);
});

test("dom.reflow reorders spans to the target; lead stays; no-op when already ordered", () => {
  const mk = () => root([
    el("h1", {}, "Title"), el("p", { class: "nr-dek" }, "dek"),
    heading("s-a", "a", "A"), el("p", {}, "a1"),
    heading("s-b", "b", "B"), el("p", {}, "b1"), el("p", {}, "b2"),
    heading("s-c", "c", "C"), el("p", {}, "c1")
  ]);
  const r = mk();
  const changed = S.dom.reflow(r, ["c", "a", "b"]);
  assert.equal(changed, true);
  // lead (h1, dek) stays first; then c-span (1¶), a-span (1¶), b-span (2¶)
  assert.deepEqual(r.children.map((c) => c.tagName), ["H1", "P", "H2", "P", "H2", "P", "H2", "P", "P"]);
  assert.deepEqual(r.children.filter((c) => c.tagName === "H2").map((c) => c._attrs["data-sec"]), ["c", "a", "b"]);
  assert.equal(r.children[0].tagName, "H1"); // lead untouched
  assert.equal(r.children[1]._attrs.class, "nr-dek");
  // and each section kept its own body blocks adjacent
  const { spans } = S.dom.collect(r);
  assert.equal(spans.b.length, 3); // B + 2 paragraphs travelled together
  // already-ordered reflow is a no-op
  assert.equal(S.dom.reflow(r, ["c", "a", "b"]), false);
});

test("dom.reconcile: new headings → fromHeader events, stamped + idempotent", () => {
  const r = root([el("h1", {}, "Title"), el("h2", { id: "s-a" }, "Alpha"), el("h2", { id: "s-b" }, "Beta")]);
  const evs = S.dom.reconcile(r, [], { slugFor: (h) => h.id });
  assert.equal(evs.filter((e) => e.t === "section.fromHeader").length, 2);
  // data-sec got stamped onto the brand-new headings
  const stamped = r.querySelectorAll("h2").map((h) => h.getAttribute("data-sec"));
  assert.ok(stamped.every(Boolean), "every new heading carries a data-sec");
  const state = S.fold(evs);
  assert.deepEqual(S.flatten(state).map((x) => x.heading), ["Alpha", "Beta"]);
  // re-running with the now-stamped DOM emits nothing
  assert.deepEqual(S.dom.reconcile(r, evs, { slugFor: (h) => h.id }), []);
});

test("dom.reconcile: a renamed heading keeps its identity (and slot)", () => {
  // start: one section already inside a slot
  let log = S.ops.applyType(S.fold([]), S.BUILTIN_TYPES.find((t) => t.id === "investigation"));
  const slot0 = S.topRefs(S.fold(log)).find((r) => r.kind === "slot").id;
  log = log.concat(S.ops.fromHeader("s-a", { id: "sec-a", heading: "Old name", parentSlotId: slot0 }));
  const r = root([el("h1", {}, "Title"), heading("s-a-renamed", "sec-a", "New name")]);
  const evs = S.dom.reconcile(r, log, { slugFor: (h) => h.id });
  assert.ok(evs.some((e) => e.t === "section.set_heading" && e.id === "sec-a"));
  assert.ok(evs.some((e) => e.t === "section.set_body" && e.body.headingSlug === "s-a-renamed"));
  assert.ok(!evs.some((e) => e.t === "section.delete"), "a rename is not a delete");
  const after = S.fold(log.concat(evs));
  assert.equal(S.sectionById(after, "sec-a").parentSlotId, slot0, "section keeps its slot across a rename");
  assert.equal(S.sectionById(after, "sec-a").heading, "New name");
});

test("dom.reconcile: a vanished heading drops its annotation (I3); prose untouched", () => {
  const log = [].concat(
    S.ops.fromHeader("s-a", { id: "a", heading: "A" }),
    S.ops.fromHeader("s-b", { id: "b", heading: "B" })
  );
  // only A remains in the DOM
  const r = root([el("h1", {}, "Title"), heading("s-a", "a", "A")]);
  const evs = S.dom.reconcile(r, log, { slugFor: (h) => h.id });
  assert.deepEqual(evs, [{ t: "section.delete", id: "b" }]);
});

test("dom.reconcile: a new heading is born under the slot of the section above it (open Q4)", () => {
  let log = S.ops.applyType(S.fold([]), S.BUILTIN_TYPES.find((t) => t.id === "news-report"));
  const slot0 = S.topRefs(S.fold(log)).find((r) => r.kind === "slot").id;
  log = log.concat(S.ops.fromHeader("s-a", { id: "sec-a", heading: "Up top", parentSlotId: slot0 }));
  // DOM: the slotted heading, then a brand-new heading right beneath it
  const r = root([el("h1", {}, "Title"), heading("s-a", "sec-a", "Up top"), el("h2", { id: "s-new" }, "Just typed")]);
  const evs = S.dom.reconcile(r, log, { slugFor: (h) => h.id });
  const born = evs.find((e) => e.t === "section.fromHeader");
  assert.equal(born.parentSlotId, slot0, "inherits the slot of the section it was typed under");
  const after = S.fold(log.concat(evs));
  // both sit in the same slot, in document order
  assert.deepEqual(S.childRefs(after, slot0).map((s) => s.heading), ["Up top", "Just typed"]);
});

test("dom.reconcile: a duplicated heading (copy/paste of data-sec) becomes its own section", () => {
  const log = S.ops.fromHeader("s-a", { id: "a", heading: "A" });
  // two headings carry the same data-sec — a clone
  const r = root([el("h1", {}, "Title"), heading("s-a", "a", "A"), heading("s-a", "a", "A copy")]);
  const evs = S.dom.reconcile(r, log, { slugFor: (h) => h.id });
  assert.ok(evs.some((e) => e.t === "section.fromHeader"), "the clone gets a fresh section");
  const after = S.fold(log.concat(evs));
  assert.equal(after.sections.length, 2, "two distinct sections");
});
