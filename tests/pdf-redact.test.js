/* pdf-redact.test.js — the pure offset↔box plumbing behind "redact on a PDF".
 *
 * The pdf.js render and the pdf-lib assemble need a browser, so they aren't
 * exercised here. What IS pure — and is the part that has to be exactly right so
 * a redaction lands on the page AND in the text shadow — is the mapping:
 *
 *   • buildLayout      — joins per-page runs into one string AND records each
 *                        run's [start,end) offset into it (so geometry and the
 *                        offsets a redaction is recorded against never desync).
 *   • rangesToBoxes    — text offsets → the page boxes that cover them (what gets
 *                        burned black on the rasterized page).
 *   • boxesToRanges    — a box drawn on the page → the text runs it overlaps (so
 *                        a hand-drawn box scrubs those words too).
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const SV = require("../app/source-view.js");

// one page, three runs laid left-to-right; coords normalized to the page
const PAGE = {
  page: 1, width: 600, height: 800,
  items: [
    { str: "Call",  x: 0.10, y: 0.10, w: 0.06, h: 0.02 },
    { str: "me",    x: 0.17, y: 0.10, w: 0.04, h: 0.02 },
    { str: "415-555-0199", x: 0.22, y: 0.10, w: 0.18, h: 0.02 },
  ],
};

test("buildLayout joins runs with spaces and records exact offsets", () => {
  const lay = SV.buildLayout([PAGE]);
  assert.equal(lay.text, "Call me 415-555-0199");
  assert.equal(lay.items.length, 3);
  // the phone run's recorded offsets index the phone substring exactly
  const phone = lay.items[2];
  assert.equal(lay.text.slice(phone.start, phone.end), "415-555-0199");
  // page dims are carried through for the builder
  assert.deepEqual(lay.pages, [{ page: 1, width: 600, height: 800 }]);
});

test("buildLayout separates pages with a blank line and keeps offsets contiguous", () => {
  const p2 = { page: 2, width: 600, height: 800, items: [{ str: "SSN", x: 0.1, y: 0.1, w: 0.05, h: 0.02 }] };
  const lay = SV.buildLayout([PAGE, p2]);
  assert.equal(lay.text, "Call me 415-555-0199\n\nSSN");
  const ssn = lay.items[lay.items.length - 1];
  assert.equal(ssn.page, 2);
  assert.equal(lay.text.slice(ssn.start, ssn.end), "SSN");
});

test("rangesToBoxes turns a redaction's text offsets into the page box over it", () => {
  const lay = SV.buildLayout([PAGE]);
  const start = lay.text.indexOf("415-555-0199");
  const boxes = SV.rangesToBoxes(lay.items, [{ start, end: start + "415-555-0199".length }]);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0], { page: 1, x: 0.22, y: 0.10, w: 0.18, h: 0.02 });
});

test("rangesToBoxes redacts the WHOLE run a partial range touches (over-cover is safe)", () => {
  const lay = SV.buildLayout([PAGE]);
  // a range covering just "415" still blacks the entire phone run
  const start = lay.text.indexOf("415-555-0199");
  const boxes = SV.rangesToBoxes(lay.items, [{ start, end: start + 3 }]);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].w, 0.18);
});

test("rangesToBoxes dedupes boxes when ranges land on the same run", () => {
  const lay = SV.buildLayout([PAGE]);
  const s = lay.text.indexOf("415-555-0199");
  const boxes = SV.rangesToBoxes(lay.items, [{ start: s, end: s + 3 }, { start: s + 4, end: s + 7 }]);
  assert.equal(boxes.length, 1, "two ranges on one run collapse to one box");
});

test("boxesToRanges maps a hand-drawn box back to the runs it overlaps", () => {
  const lay = SV.buildLayout([PAGE]);
  // a box over the first two words only
  const ranges = SV.boxesToRanges(lay.items, [{ page: 1, x: 0.09, y: 0.095, w: 0.13, h: 0.03 }]);
  const covered = ranges.map(r => lay.text.slice(r.start, r.end)).sort();
  assert.deepEqual(covered, ["Call", "me"]);
});

test("boxesToRanges ignores boxes on other pages and empty regions", () => {
  const lay = SV.buildLayout([PAGE]);
  assert.deepEqual(SV.boxesToRanges(lay.items, [{ page: 2, x: 0.1, y: 0.1, w: 0.5, h: 0.5 }]), []);
  // a box in the lower half of page 1 (no runs there) maps to nothing
  assert.deepEqual(SV.boxesToRanges(lay.items, [{ page: 1, x: 0.1, y: 0.6, w: 0.2, h: 0.1 }]), []);
});
