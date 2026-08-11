/* source-archive.test.js — the bytes that may actually reach archive.org for an
 * uploaded source, and the multipart upload that carries them there.
 *
 * NpjSourceView.archiveBytesFor is the gate: it must pick the SAME safe bytes the
 * publish-time projection (NpjArticles.publishableSource) would ship, so archiving
 * never leaks what the committed record would withhold:
 *   • a redacted TEXT source archives its scrubbed text — NEVER the un-redacted
 *     media-store bytes behind file_url;
 *   • a redacted OPAQUE file (image / office) with no built copy archives NOTHING;
 *   • an unredacted source archives the original bytes (session blob first);
 *   • a redacted PDF archives the burned-in copy off the media store.
 *
 * NpjMedia.archiveSource POSTs the bytes + the consent ledger to site/source-npj
 * with the author's Matrix token; the consent fields must ride in the multipart
 * body and the response's archive URL must come back verbatim. Rejection (auth /
 * validation / archive.org PUT) surfaces the backend's message.
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

// The modules read their collaborators off `window` AT CALL TIME, and capture it
// as their root at require time — so a fake `window` must exist first. They are
// assigned onto it as each require runs; the explicit assignments below are belt
// and suspenders (and required for MatrixAuth/fetch, which no require installs).
global.window = {};
const NpjPII = require("../app/redaction/pii.js");
const NpjMedia = require("../app/media/media-store.js");
const SV = require("../app/sources/source-view.js");
window.NpjPII = NpjPII;
window.NpjMedia = NpjMedia;

const BLOCK = NpjPII.BLOCK; // █

test("an unredacted source archives its original bytes (session blob)", async () => {
  const rec = { id: "doc-1", title: "tip.txt", filename: "tip.txt", mime: "text/plain" };
  SV.registerBlob("doc-1", new Blob(["Call me after 5."], { type: "text/plain" }));
  const p = await SV.archiveBytesFor(rec);
  assert.ok(p, "a source with bytes ships a blob");
  assert.equal(p.filename, "tip.txt");
  assert.equal(p.mime, "text/plain");
  assert.equal(await p.blob.text(), "Call me after 5.");
});

test("a redacted text source archives its scrubbed text, never the media-store bytes", async () => {
  const text = "Call me at 415-555-0199 about the leak.";
  const start = text.indexOf("415-555-0199"), end = start + "415-555-0199".length;
  const rec = {
    id: "doc-2", title: "tip.txt", filename: "tip.txt", mime: "text/plain",
    text: NpjPII.redactText(text, [{ start, end }]),      // already scrubbed in place, like Citey
    file_url: "https://store/original/tip.txt",           // the UN-redacted media-store bytes
    piiReview: { state: "reviewed", basis: NpjPII.BASIS, redactions: [{ start, end }], affirmations: [] }
  };
  const p = await SV.archiveBytesFor(rec);
  assert.ok(p, "a redacted text source still has shippable bytes");
  assert.equal(p.filename, "tip.txt");
  const out = await p.blob.text();
  assert.ok(out.includes(BLOCK), "the archived text carries the █ block");
  assert.ok(!/415|555|0199/.test(out), "not one phone digit reaches archive.org");
});

test("the scrub is re-asserted from the recorded ranges even if the live text was lost", async () => {
  const rec = {
    id: "doc-3", filename: "n.txt", mime: "text/plain",
    text: "SSN 123-45-6789 is on file.",                  // NOT scrubbed in place
    piiReview: { redactions: [{ start: 4, end: 14 }] }    // ranges survive
  };
  const p = await SV.archiveBytesFor(rec);
  assert.ok(p);
  assert.ok(!/123-45-6789/.test(await p.blob.text()), "recorded ranges are re-applied before the bytes ship");
});

test("a redacted opaque file with no built copy archives NOTHING", async () => {
  const rec = {
    id: "doc-4", filename: "scan.png", mime: "image/png", binary: true,
    file_url: "https://store/scan.png",
    piiReview: { state: "reviewed", redactions: [{ area: true }], affirmations: [] }
  };
  assert.equal(await SV.archiveBytesFor(rec), null, "the original must not be archived when a redacted copy can't be built");
});

test("a redacted PDF archives the burned-in copy off the media store", async () => {
  window.NpjMedia = Object.assign({}, window.NpjMedia, {
    fetchBytes: async (url) => {
      if (url === "https://store/filing-redacted.pdf") return new Blob(["REDACTED-PDF-BYTES"], { type: "application/pdf" });
      throw new Error("unexpected fetch of " + url);
    }
  });
  const rec = {
    id: "doc-pdf", filename: "filing.pdf", mime: "application/pdf",
    file_url: "https://store/original.pdf",               // the un-redacted original
    piiReview: {
      state: "reviewed", redactions: [{ start: 0, end: 3 }], affirmations: [],
      redactedFile: { url: "https://store/filing-redacted.pdf", name: "filing-redacted.pdf" }
    }
  };
  const p = await SV.archiveBytesFor(rec);
  assert.ok(p);
  assert.equal(p.filename, "filing-redacted.pdf", "the redacted copy's name rides in");
  assert.equal(p.mime, "application/pdf");
  assert.equal(await p.blob.text(), "REDACTED-PDF-BYTES", "the archived bytes are the burned-in copy");
});

test("a redacted PDF with an unreachable redacted copy archives NOTHING", async () => {
  window.NpjMedia = Object.assign({}, window.NpjMedia, { fetchBytes: async () => { throw new Error("offline"); } });
  const rec = {
    id: "doc-pdf2", filename: "filing.pdf", mime: "application/pdf",
    piiReview: { redactions: [{ start: 0, end: 3 }], redactedFile: { url: "https://store/away.pdf", name: "away.pdf" } }
  };
  assert.equal(await SV.archiveBytesFor(rec), null, "no fall-through to the un-redacted original");
});

test("archiveSource POSTs the bytes + consent ledger to site/source-npj and returns the archive URL", async () => {
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, headers: opts.headers, body: opts.body };
    return { ok: true, status: 200, json: async () => ({
      success: true, statusCode: 200, redacted: false,
      archive: { identifier: "npj-x1y2", url: "https://archive.org/details/npj-x1y2", filename: "tip.txt", mime: "text/plain", size_bytes: 9 }
    }) };
  };
  window.MatrixAuth = { current: () => ({ base_url: "https://hs.example" }), token: () => "tok123" };
  window.NpjArticles = {};   // no publishEndpoint → default webhook host
  const res = await NpjMedia.archiveSource(new Blob(["Call me."], { type: "text/plain" }), {
    filename: "tip.txt", title: "A tip", consent_acknowledged: ["permanence", "privacy", "rights"]
  });
  assert.equal(res.identifier, "npj-x1y2");
  assert.equal(res.url, "https://archive.org/details/npj-x1y2");
  assert.equal(captured.url, "https://n8n.intelechia.com/webhook/site/source-npj");
  assert.equal(captured.headers.Authorization, "Bearer tok123");
  const flat = [];
  for (const [k, v] of captured.body.entries()) if (typeof v === "string") flat.push(k + "=" + v);
  const s = flat.join(";");
  assert.ok(s.includes("kind=source"), "the source kind rides in the body");
  assert.ok(s.includes("filename=tip.txt"));
  assert.ok(s.includes("consent_acknowledged=permanence"), "permanence consent is sent");
  assert.ok(s.includes("consent_acknowledged=privacy"), "privacy consent is sent");
  assert.ok(s.includes("consent_acknowledged=rights"), "rights consent is sent");
});

test("archiveSource defaults the full consent set when none is passed", async () => {
  let flat = null;
  global.fetch = async (url, opts) => {
    const parts = [];
    for (const [k, v] of opts.body.entries()) if (typeof v === "string") parts.push(k + "=" + v);
    flat = parts.join(";");
    return { ok: true, status: 200, json: async () => ({ success: true, archive: { identifier: "i", url: "https://archive.org/details/i" } }) };
  };
  await NpjMedia.archiveSource(new Blob(["x"], { type: "text/plain" }), { filename: "x.txt" });
  assert.ok(flat.includes("consent_acknowledged=permanence"));
  assert.ok(flat.includes("consent_acknowledged=privacy"));
  assert.ok(flat.includes("consent_acknowledged=rights"));
});

test("archiveSource refuses without a Matrix token", async () => {
  window.MatrixAuth = { current: () => null, token: () => null };
  await assert.rejects(NpjMedia.archiveSource(new Blob(["x"], { type: "text/plain" }), { filename: "x.txt" }), /Sign in with Matrix/);
});

test("archiveSource surfaces the backend's error when the archive.org PUT fails", async () => {
  window.MatrixAuth = { current: () => ({ base_url: "https://hs.example" }), token: () => "tok123" };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: false, statusCode: 502, error: "archive.org PUT failed (503)" }) });
  await assert.rejects(NpjMedia.archiveSource(new Blob(["x"], { type: "text/plain" }), { filename: "x.txt" }), /archive\.org PUT failed/);
});

test("archiveSource surfaces validation errors from the webhook", async () => {
  window.MatrixAuth = { current: () => ({ base_url: "https://hs.example" }), token: () => "tok123" };
  global.fetch = async () => ({ ok: true, status: 400, json: async () => ({ success: false, errors: ["no binary data attached to request", "consent_acknowledged missing: rights"], stage: "validate" }) });
  await assert.rejects(NpjMedia.archiveSource(new Blob(["x"], { type: "text/plain" }), { filename: "x.txt" }), /no binary data attached/);
});
