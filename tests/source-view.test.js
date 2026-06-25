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

test("kindOf honors an author's explicit 'treat as image' override", () => {
  // a scan that arrived with no useful mime/extension detects as unknown…
  const rec = { id: "doc-x", mime: "application/octet-stream", filename: "scan", file_url: "https://s/scan" };
  assert.equal(SV.detectKind(rec), "unknown");
  // …until the author pins it. Then it IS an image (viewer + OCR path).
  rec.kind = "image";
  assert.equal(SV.kindOf(rec), "image");
  assert.equal(SV.detectKind(rec), "unknown");   // detection is unchanged underneath
  assert.equal(SV.kindPinned(rec), true);
});

test("kindOf ignores a bogus override and falls back to detection", () => {
  assert.equal(SV.kindOf({ mime: "application/pdf", kind: "banana" }), "pdf");
  assert.equal(SV.kindPinned({ mime: "application/pdf", kind: "banana" }), false);
  assert.equal(SV.kindPinned({ mime: "image/png" }), false);   // detected, not pinned
});

test("ocrEnabled tracks the image kind, a stored file, and the ocrOff flag", () => {
  const img = { id: "doc-i", mime: "image/png", file_url: "https://s/p.png" };
  assert.equal(SV.ocrEligible(img), true);
  assert.equal(SV.ocrEnabled(img), true);
  img.ocrOff = true;                              // author turned OCR off
  assert.equal(SV.ocrEligible(img), true);        // still an image with bytes…
  assert.equal(SV.ocrEnabled(img), false);        // …but OCR won't read it
  // a pdf (even with a file) is never an OCR target here
  assert.equal(SV.ocrEligible({ mime: "application/pdf", file_url: "https://s/d.pdf" }), false);
  // an image with no stored bytes can't be OCR'd
  assert.equal(SV.ocrEligible({ mime: "image/png" }), false);
});

test("a source pinned to image gains OCR eligibility it wouldn't auto-detect", () => {
  const rec = { mime: "application/octet-stream", filename: "shot", file_url: "https://s/shot", kind: "image" };
  assert.equal(SV.ocrEligible(rec), true);
  assert.equal(SV.ocrEnabled(rec), true);
});

test("citedPassageVisible keeps an image's OCR out of the reader until the author vouches", () => {
  // web/pdf/text sources carry real, selectable text — their passage always shows
  assert.equal(SV.citedPassageVisible({ mime: "application/pdf" }), true);
  assert.equal(SV.citedPassageVisible({ original_url: "https://x/a", text: "real article words" }), true);
  // an image's pinned words are machine-read (OCR) — hidden in the reader by default…
  const img = { id: "doc-i", mime: "image/png", file_url: "https://s/p.png" };
  assert.equal(SV.citedPassageVisible(img), false);
  img.ocrShow = true;                              // …until the author flips it on
  assert.equal(SV.citedPassageVisible(img), true);
  // a scan PINNED to image (no useful mime) is gated the same way
  const scan = { mime: "application/octet-stream", filename: "scan", file_url: "https://s/scan", kind: "image" };
  assert.equal(SV.citedPassageVisible(scan), false);
  scan.ocrShow = true;
  assert.equal(SV.citedPassageVisible(scan), true);
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
