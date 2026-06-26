/* citations-context.test.js — the context-link span plumbing (app/sources/citations.js).
 * Context links are sources a claim cites for CONTEXT (prior coverage), not proof.
 * They live on a span's `data-context` attribute, deliberately apart from the
 * proof attributes (data-src / data-quote / data-cite-id) so the publish gate and
 * CiteyBrain — which only read proof — never see them. Pure attribute ops, no DOM:
 * we hand the helpers a tiny stub span and check the bytes. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/sources/citations.js");

// a minimal element stub — just the attribute API the helpers use
function stubSpan(attrs) {
  const m = Object.assign({}, attrs || {});
  return {
    getAttribute: (k) => (k in m ? m[k] : null),
    setAttribute: (k, v) => { m[k] = String(v); },
    removeAttribute: (k) => { delete m[k]; },
    _attrs: m
  };
}

test("addContext records a source key on data-context", () => {
  const s = stubSpan();
  C.addContext(s, "web-1");
  assert.deepEqual(C.contextKeys(s), ["web-1"]);
  assert.equal(s.getAttribute("data-context"), "web-1");
  assert.equal(C.hasContext(s), true);
});

test("context links accumulate, de-dupe, and keep order", () => {
  const s = stubSpan();
  C.addContext(s, "web-1");
  C.addContext(s, "web-2");
  C.addContext(s, "web-1");           // duplicate — ignored
  assert.deepEqual(C.contextKeys(s), ["web-1", "web-2"]);
  assert.equal(s.getAttribute("data-context"), "web-1 web-2");
});

test("removeContext drops one key; emptying clears the attribute", () => {
  const s = stubSpan({ "data-context": "a b c" });
  C.removeContext(s, "b");
  assert.deepEqual(C.contextKeys(s), ["a", "c"]);
  C.removeContext(s, "a");
  C.removeContext(s, "c");
  assert.deepEqual(C.contextKeys(s), []);
  assert.equal(s.getAttribute("data-context"), null);   // attribute removed, not blanked
  assert.equal(C.hasContext(s), false);
});

test("context links never touch the proof attributes", () => {
  const s = stubSpan();
  C.addContext(s, "web-1");
  C.removeContext(s, "web-1");
  C.addContext(s, "web-2");
  assert.equal(s.getAttribute("data-src"), null);
  assert.equal(s.getAttribute("data-quote"), null);
  assert.equal(s.getAttribute("data-cite-id"), null);
});

test("helpers are null-safe on a missing span", () => {
  assert.deepEqual(C.contextKeys(null), []);
  assert.equal(C.hasContext(null), false);
  assert.doesNotThrow(() => { C.addContext(null, "x"); C.removeContext(null, "x"); });
});
