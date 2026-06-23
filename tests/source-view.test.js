/* source-view.test.js — the pure bits of the source viewer/OCR plumbing that
 * run with no DOM: kind detection (so the right renderer + the right extractor
 * fire) and cleanOcrText (the tidy applied to raw OCR output before it becomes
 * citable text). The OCR itself needs a browser worker, so it isn't exercised
 * here — only the deterministic helpers around it, like the rest of the suite.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const SV = require("../app/source-view.js");

test("kindOf detects an uploaded screenshot as an image (→ OCR path)", () => {
  assert.equal(SV.kindOf({ id: "doc-1", mime: "image/png", filename: "Screenshot 2026-06-22 at 11.26.43 PM.png" }), "image");
  assert.equal(SV.kindOf({ id: "doc-2", filename: "scan.jpeg" }), "image");
  // a PDF still routes to the pdf extractor, not OCR
  assert.equal(SV.kindOf({ id: "doc-3", mime: "application/pdf" }), "pdf");
});

test("cleanOcrText collapses the whitespace noise OCR leaves behind", () => {
  const raw = "Hello   world  \nThis  is\ta line   \n\n\n\nNext block\f Page two";
  const out = SV.cleanOcrText(raw);
  assert.equal(out, "Hello world\nThis is a line\n\nNext block\n\nPage two");
});

test("cleanOcrText is total — null/undefined/empty never throw", () => {
  assert.equal(SV.cleanOcrText(null), "");
  assert.equal(SV.cleanOcrText(undefined), "");
  assert.equal(SV.cleanOcrText("   \n  "), "");
});
