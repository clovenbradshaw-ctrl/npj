/* authorship-runs.test.js — app/feedback/authorship.js's advanceRuns: the pure
 * (no-DOM) core of retroactive per-span attribution.
 *
 * A block's authorship is a list of runs [{ text, author, ts }, …] that
 * concatenate back to its current text. advanceRuns folds ONE more diff (old
 * block text -> new block text, from NpjVersionDiff.diffWords) into an
 * existing runs list: unchanged text keeps whoever already had it, sliced out
 * of the old runs; newly added text becomes a fresh run credited to the new
 * author; deleted text just drops. attributionFromSnapshots is nothing more
 * than calling this once per historical save, in order — so if this holds up,
 * the whole retroactive reconstruction does. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { diffWordsRaw } = require("../app/record/versions-diff.js");
const { advanceRuns } = require("../app/feedback/authorship.js");

const text = (runs) => runs.map((r) => r.text).join("");
// fold a whole sequence of { author, ts, text } saves into the final runs list
function replay(saves) {
  let runs = [];
  for (const save of saves) {
    const old = text(runs);
    runs = advanceRuns(runs, diffWordsRaw(old, save.text), save.author, save.ts);
  }
  return runs;
}

test("genesis: the first save's whole text is one run, credited to its author", () => {
  const runs = replay([{ author: "@alice:x", ts: 1, text: "Hello world." }]);
  assert.equal(text(runs), "Hello world.");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].author, "@alice:x");
});

test("a second author's insertion in the MIDDLE of the sentence only credits their words", () => {
  const runs = replay([
    { author: "@alice:x", ts: 1, text: "The MNPD hosted a meeting." },
    { author: "@bob:y", ts: 2, text: "The MNPD [Metro Nashville Police Department] hosted a meeting." },
  ]);
  assert.equal(text(runs), "The MNPD [Metro Nashville Police Department] hosted a meeting.");
  const bobRuns = runs.filter((r) => r.author === "@bob:y");
  const aliceRuns = runs.filter((r) => r.author === "@alice:x");
  assert.ok(bobRuns.length >= 1, "bob has at least one run");
  assert.ok(aliceRuns.length >= 1, "alice's original words are still hers, not reassigned to bob");
  assert.ok(bobRuns.every((r) => r.text.includes("Metro Nashville Police Department") || /^\s*$/.test(r.text)));
  // alice's original sentence words survive under her name, unbroken
  assert.ok(aliceRuns.some((r) => r.text.includes("hosted a meeting")));
});

test("a third save that edits ONLY bob's inserted words re-credits just those, not alice's", () => {
  const runs = replay([
    { author: "@alice:x", ts: 1, text: "The MNPD hosted a meeting." },
    { author: "@bob:y", ts: 2, text: "The MNPD [Metro PD] hosted a meeting." },
    { author: "@carol:z", ts: 3, text: "The MNPD [Metro Nashville Police Dept] hosted a meeting." },
  ]);
  assert.equal(text(runs), "The MNPD [Metro Nashville Police Dept] hosted a meeting.");
  const aliceWords = runs.filter((r) => r.author === "@alice:x").map((r) => r.text).join("");
  assert.ok(aliceWords.includes("hosted a meeting"), "alice's untouched words are still hers");
  assert.ok(!aliceWords.includes("Metro"), "alice is never credited with bob's or carol's bracket");
  const carolWords = runs.filter((r) => r.author === "@carol:z").map((r) => r.text).join("");
  assert.ok(carolWords.includes("Nashville") && carolWords.includes("Police Dept]"), "carol's own new words are hers");
  assert.ok(!carolWords.includes("Metro") && !carolWords.includes("PD"), "carol is never credited with bob's surviving words");
  // the space between "Nashville" and "Police" was already there (part of
  // bob's original "PD] ") and carol never touched it — it stays bob's, a
  // precise LCS call a cruder "whole word changed" heuristic would blur
  const bobWords = runs.filter((r) => r.author === "@bob:y").map((r) => r.text).join("");
  assert.ok(bobWords.includes("Metro"), "bob still gets credit for the part of his insertion carol left alone");
});

test("deleting a whole inserted run removes it — no orphaned run, no leftover credit", () => {
  const runs = replay([
    { author: "@alice:x", ts: 1, text: "The MNPD hosted a meeting." },
    { author: "@bob:y", ts: 2, text: "The MNPD [confusing] hosted a meeting." },
    { author: "@alice:x", ts: 3, text: "The MNPD hosted a meeting." },
  ]);
  assert.equal(text(runs), "The MNPD hosted a meeting.");
  assert.ok(!runs.some((r) => r.text.includes("confusing")));
  assert.ok(runs.every((r) => r.author === "@alice:x"), "the whole sentence reads as alice's again");
});

test("adjacent same-author runs merge — a typing session is one run, not one per keystroke", () => {
  const runs = advanceRuns(
    [{ text: "Hello ", author: "@alice:x", ts: 1 }],
    diffWordsRaw("Hello ", "Hello world"),
    "@alice:x",
    2
  );
  assert.equal(runs.length, 1, "the new words fold into alice's existing run rather than starting a new one");
  assert.equal(text(runs), "Hello world");
});

test("no-op diff (identical text) returns the runs unchanged", () => {
  const base = [{ text: "Same as before.", author: "@alice:x", ts: 1 }];
  const runs = advanceRuns(base, diffWordsRaw("Same as before.", "Same as before."), "@bob:y", 2);
  assert.equal(text(runs), "Same as before.");
  assert.equal(runs[0].author, "@alice:x", "an unchanged stretch keeps its original author even though a later save touched the document");
});
