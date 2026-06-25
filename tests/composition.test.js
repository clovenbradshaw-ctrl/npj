/* composition.test.js — the writing-process ledger (app/composition.js). It
 * records the SHAPE of a drafting session — typed vs. pasted characters, paste
 * sizes, deletions, timeline — as plain counts so the preview/published footer
 * can show how a piece came together, WITHOUT ever keeping the words. These
 * tests pin the deterministic accounting: the length-diff typing counter, paste
 * booking, the mute() guard that stops a programmatic paste being double-counted
 * as typing, deletion magnitude, and the reader-facing summary thresholds.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/composition.js");

test("typing is counted by positive length delta; deletion by negative", () => {
  const id = "t-type";
  C.reset(id);
  C.attach(id, 0);                       // empty editor baseline
  C.onInput(id, 5, "insertText");        // typed "hello"
  C.onInput(id, 11, "insertText");       // typed " world"
  C.onInput(id, 8, "deleteContentBackward"); // deleted 3 chars
  const s = C.serialize(id);
  assert.equal(s.typed, 11);
  assert.equal(s.deleted, 3);
  assert.equal(s.pasted, 0);
  assert.equal(s.pasteCount, 0);
});

test("recordPaste books size, max and the large-paste tally — never any text", () => {
  const id = "t-paste";
  C.reset(id);
  C.attach(id, 0);
  C.recordPaste(id, 40, { kind: "paste" });
  C.recordPaste(id, 600, { kind: "paste" });   // a large block
  const s = C.serialize(id);
  assert.equal(s.pasted, 640);
  assert.equal(s.pasteCount, 2);
  assert.equal(s.maxPaste, 600);
  assert.equal(s.largePasteCount, 1);          // only the 600 clears LARGE_PASTE
  // the size log carries counts + timestamps + a kind label, and nothing else
  assert.ok(Array.isArray(s.pastes) && s.pastes.length === 2);
  assert.deepEqual(Object.keys(s.pastes[0]).sort(), ["at", "kind", "n"]);
});

test("mute() stops OUR programmatic paste insertion being recounted as typing", () => {
  const id = "t-mute";
  C.reset(id);
  C.attach(id, 10);                       // editor already has 10 chars
  C.recordPaste(id, 300, { kind: "paste" });
  C.mute(id);
  C.onInput(id, 310, "insertText");       // synthetic input from execCommand insert
  C.unmute(id);
  C.onInput(id, 315, "insertText");       // a real keystroke afterwards
  const s = C.serialize(id);
  assert.equal(s.pasted, 300);            // booked once, by recordPaste
  assert.equal(s.typed, 5);               // only the post-paste keystroke counts
});

test("a native paste that escapes onPaste is still booked as pasted, not typed", () => {
  const id = "t-native";
  C.reset(id);
  C.attach(id, 0);
  C.onInput(id, 250, "insertFromPaste");  // browser-native paste, not intercepted
  const s = C.serialize(id);
  assert.equal(s.pasted, 250);
  assert.equal(s.typed, 0);
});

test("summary: a hand-typed piece reads calm and 'Typed by hand'", () => {
  const sum = C.summary({ typed: 2000, pasted: 60, deleted: 100, pasteCount: 1, maxPaste: 60, days: { "2026-06-01": 3 } });
  assert.equal(sum.label, "Typed by hand");
  assert.equal(sum.tone, "calm");
  assert.equal(Math.round(sum.pastedPct * 100), 3);
  assert.equal(sum.dominantPaste, false);
});

test("summary: a mostly-pasted piece warns and flags the dominant block", () => {
  const sum = C.summary({ typed: 50, pasted: 900, deleted: 0, pasteCount: 1, maxPaste: 900, largePasteCount: 1 });
  assert.equal(sum.label, "Largely pasted in");
  assert.equal(sum.tone, "warn");
  assert.equal(sum.dominantPaste, true);  // one big block is a real share of the piece
});

test("summary refuses to characterize a too-short scrap", () => {
  assert.equal(C.summary({ typed: 10, pasted: 5 }), null);
  assert.equal(C.summary(null), null);
});

test("publishable() is aggregates only — no per-paste log leaves the editor", () => {
  const id = "t-pub";
  C.reset(id);
  C.attach(id, 0);
  C.onInput(id, 500, "insertText");
  C.recordPaste(id, 200, { kind: "paste" });
  const p = C.publishable(id);
  assert.equal(p.typed, 500);
  assert.equal(p.pasted, 200);
  assert.equal(typeof p.dayCount, "number");
  assert.ok(!("pastes" in p));            // the size log never ships with the article
});
