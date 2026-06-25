/* publishable-source.test.js — NpjArticles.publishableSource is the projection
 * that decides what of a source record reaches the permanent, public, committed
 * log. The guarantees this guards:
 *
 *   • a HARD-REDACTED source ships redacted FOR REAL: the scrubbed text survives,
 *     but every pointer to the un-redacted original (file_url / mxc / original_url
 *     / archive_url) is dropped, so the withheld PII can't be fetched back out of
 *     the archive. Only counts (not the offsets/identities) ride in the audit stub.
 *   • the redaction is re-asserted from the recorded ranges, so PII can't ship
 *     even if the live in-place scrub was lost.
 *   • an interview's raw transcript never ships.
 *   • an unredacted source passes through untouched.
 *   • the live working record is never mutated (it stays openable in the newsroom).
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

// Load in node mode (no `window` yet → no browser/primeFront path), THEN expose
// the PII pack on a global `window` the way the browser has it, so the defensive
// re-scrub can run. publishableSource reads `window` at call time, so assigning
// it after require is enough.
const NpjArticles = require("../app/articles.js");
const NpjPII = require("../app/pii.js");
global.window = { NpjPII };

const BLOCK = NpjPII.BLOCK; // █

test("a redacted source ships scrubbed, with no link to the un-redacted original", () => {
  const text = "Call me at 415-555-0199 about the leak.";
  const start = text.indexOf("415-555-0199"), end = start + "415-555-0199".length;
  // emulate Citey: the live record was scrubbed in place AND logged the range
  const live = {
    id: "doc-1", type: "primary", outlet: "uploaded document", title: "tip.txt",
    text: NpjPII.redactText(text, [{ start, end }]),
    file_url: "https://store.example/abc", mxc: "mxc://h/abc",
    original_url: "https://leak.example/doc", archive_url: "https://web.archive.org/web/2/x",
    piiReview: { state: "reviewed", basis: NpjPII.BASIS, redactions: [{ type: "PHONE_NUMBER", start, end, length: end - start }], affirmations: [] }
  };
  const before = JSON.stringify(live);
  const pub = NpjArticles.publishableSource(live);

  // text is redacted; not one phone digit survives into the public copy
  assert.ok(pub.text.includes(BLOCK), "redacted text should carry the █ block");
  assert.ok(!/415|555|0199/.test(pub.text), "no phone digits survive into the public copy");
  // every pointer to the un-redacted original is withheld
  assert.equal(pub.file_url, "");
  assert.equal(pub.mxc, "");
  assert.equal(pub.original_url, "");
  assert.equal(pub.archive_url, "");
  assert.equal(pub.redacted, true);
  // the audit stub is content-free: counts, not the offsets/identities behind them
  assert.equal(pub.piiReview.redactions, 1);
  assert.ok(!Array.isArray(pub.piiReview.redactions), "redaction offsets must not ship");
  // non-mutating: the live record is untouched (still openable in the newsroom)
  assert.equal(JSON.stringify(live), before, "publishableSource must not mutate the live record");
  assert.equal(live.file_url, "https://store.example/abc");
});

test("a redacted PDF ships the burned-in redacted copy, never the original", () => {
  // Citey built a real redacted PDF (boxes burned into rasterized pages) and stored
  // it as redactedFile. That copy is safe to ship — its bytes are already scrubbed —
  // so file_url/mxc point at IT, while every pointer to the un-redacted original goes.
  const text = "SSN 123-45-6789 on the filing.";
  const start = text.indexOf("123-45-6789"), end = start + "123-45-6789".length;
  const live = {
    id: "doc-pdf", type: "primary", outlet: "uploaded document", title: "filing.pdf", mime: "application/pdf",
    text: NpjPII.redactText(text, [{ start, end }]),
    file_url: "https://store.example/original", mxc: "mxc://h/original",
    original_url: "https://leak.example/filing.pdf", archive_url: "https://web.archive.org/web/2/x",
    piiReview: {
      state: "reviewed", basis: NpjPII.BASIS,
      redactions: [{ type: "US_SSN", start, end, length: end - start }],
      affirmations: [],
      pdfBoxes: [{ page: 1, x: 0.2, y: 0.1, w: 0.18, h: 0.02 }],
      redactedFile: { url: "https://store.example/filing-redacted.pdf", mxc: "mxc://h/redacted", name: "filing-redacted.pdf" },
    },
  };
  const before = JSON.stringify(live);
  const pub = NpjArticles.publishableSource(live);

  // the redacted copy is what ships
  assert.equal(pub.file_url, "https://store.example/filing-redacted.pdf");
  assert.equal(pub.mxc, "mxc://h/redacted");
  assert.equal(pub.redactedPdf, true);
  assert.equal(pub.piiReview.redactedPdf, true);
  // pointers to the UN-redacted original are still withheld
  assert.equal(pub.original_url, "");
  assert.equal(pub.archive_url, "");
  assert.notEqual(pub.file_url, "https://store.example/original");
  // text shadow is still scrubbed, and the audit stub stays content-free
  assert.ok(!/123-45-6789/.test(pub.text));
  assert.equal(pub.redacted, true);
  assert.equal(pub.piiReview.redactions, 1);
  // non-mutating
  assert.equal(JSON.stringify(live), before, "publishableSource must not mutate the live record");
});

test("a redacted source with no built copy still withholds the original entirely", () => {
  // same source, but the redacted PDF couldn't be built/stored → fall back to text-only
  const text = "SSN 123-45-6789 on the filing.";
  const start = text.indexOf("123-45-6789"), end = start + "123-45-6789".length;
  const live = {
    id: "doc-pdf2", type: "primary", title: "filing.pdf", mime: "application/pdf",
    text: NpjPII.redactText(text, [{ start, end }]),
    file_url: "https://store.example/original", mxc: "mxc://h/original", original_url: "https://leak/x", archive_url: "https://web.archive.org/y",
    piiReview: { state: "reviewed", redactions: [{ start, end }], affirmations: [] },   // no redactedFile
  };
  const pub = NpjArticles.publishableSource(live);
  assert.equal(pub.file_url, "");
  assert.equal(pub.mxc, "");
  assert.equal(pub.redacted, true);
  assert.equal(pub.redactedPdf, undefined);
  assert.equal(pub.piiReview.redactedPdf, false);
});

test("the projection re-asserts redaction even if the live text scrub was lost", () => {
  const text = "SSN 123-45-6789 is on file.";
  const start = text.indexOf("123-45-6789"), end = start + "123-45-6789".length;
  const live = {
    id: "doc-2", type: "primary", text,   // NOT scrubbed in place — a lost mutation
    file_url: "https://store/x",
    piiReview: { redactions: [{ start, end }] }
  };
  const pub = NpjArticles.publishableSource(live);
  assert.ok(!/123-45-6789/.test(pub.text), "recorded ranges are re-applied so PII never ships");
  assert.equal(pub.file_url, "", "original still withheld");
});

test("a source with no redactions passes through untouched", () => {
  const live = { id: "ia-x", type: "data", outlet: "archive.org", title: "Dataset", text: "public figures only", archive_url: "https://archive.org/details/x" };
  const pub = NpjArticles.publishableSource(live);
  assert.equal(pub, live, "unredacted sources are returned as-is (same reference)");
  assert.equal(pub.archive_url, "https://archive.org/details/x");
  assert.equal(pub.redacted, undefined);
});

test("an interview's raw transcript is stripped from the public record", () => {
  const live = { id: "iv-1", type: "interview", outlet: "phone", title: "A source", text: "off-record notes naming the whistleblower", talk: { date: "2026-06-01" } };
  const pub = NpjArticles.publishableSource(live);
  assert.equal(pub.text, "", "transcript stripped");
  assert.equal(live.text, "off-record notes naming the whistleblower", "live record untouched");
});
