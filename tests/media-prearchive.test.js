/* media-prearchive.test.js — the proactive pre-archive census + slot test in
 * app/media/media-store.js (prearchiveCensus / slotNeedsArchive).
 *
 * Pre-archiving moves a draft's media-store images onto archive.org BEFORE the
 * publish boundary, recording the durable URL in each <image-slot>'s data-alt.
 * These pure DOM helpers decide which slots still owe an upload — the half worth
 * a regression test, no network involved.
 *
 * No jsdom (npj's zero-dep ethos): a tiny faithful DOM mock + a stubbed
 * NpjArchiveCDN.isMediaUrl on globalThis, the two globals the helpers read.
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

// the helpers read root.NpjArchiveCDN.isMediaUrl (an archive.org / wayback URL)
globalThis.NpjArchiveCDN = { isMediaUrl: (u) => /(?:^|\/\/)(?:[^/]*\.)?archive\.org\//.test(String(u || "")) || /web\.archive\.org\//.test(String(u || "")) };
const M = require("../app/media/media-store.js");

// ---- minimal DOM: image-slot elements with attributes ----
class Slot {
  constructor(attrs) { this.tagName = "IMAGE-SLOT"; this._a = Object.assign({}, attrs || {}); }
  getAttribute(k) { const v = this._a[k]; return v == null ? null : v; }
  setAttribute(k, v) { this._a[k] = v; }
}
function root(slots) {
  return { querySelectorAll: (sel) => (sel === "image-slot" ? slots.slice() : []) };
}

const STORE = "https://hs.example/_matrix/media/v3/download/hs.example/AbC123";
const STORE2 = "https://hs.example/_matrix/media/v3/download/hs.example/XyZ789";
const ARCHIVE = "https://archive.org/download/npj-story/img.webp";
const EXTERNAL = "https://example.com/photo.jpg";

test("slotNeedsArchive: media-store src with no archive copy is pending", () => {
  assert.equal(M.slotNeedsArchive(new Slot({ src: STORE })), true);
});

test("slotNeedsArchive: media-store src already carrying an archive.org data-alt is done", () => {
  assert.equal(M.slotNeedsArchive(new Slot({ src: STORE, "data-alt": ARCHIVE })), false);
});

test("slotNeedsArchive: a store src whose data-alt is NOT archive.org still owes an upload", () => {
  assert.equal(M.slotNeedsArchive(new Slot({ src: STORE, "data-alt": EXTERNAL })), true);
});

test("slotNeedsArchive: an already-archive.org src is never re-uploaded", () => {
  assert.equal(M.slotNeedsArchive(new Slot({ src: ARCHIVE })), false);
});

test("slotNeedsArchive: external / empty slots are skipped", () => {
  assert.equal(M.slotNeedsArchive(new Slot({ src: EXTERNAL })), false);
  assert.equal(M.slotNeedsArchive(new Slot({})), false);
  assert.equal(M.slotNeedsArchive(null), false);
});

test("prearchiveCensus: counts total filled, pending (store), and archived", () => {
  const r = root([
    new Slot({ src: STORE }),                       // pending
    new Slot({ src: STORE2, "data-alt": ARCHIVE }), // archived (store src + archive alt)
    new Slot({ src: ARCHIVE }),                     // archived (archive src)
    new Slot({ src: EXTERNAL }),                    // filled, neither pending nor archived
    new Slot({}),                                   // empty — not counted at all
  ]);
  const c = M.prearchiveCensus(r);
  assert.equal(c.total, 4);     // empty slot excluded
  assert.equal(c.pending, 1);
  assert.equal(c.archived, 2);
});

test("prearchiveCensus: an empty draft is all zeros, never throws", () => {
  assert.deepEqual(M.prearchiveCensus(root([])), { total: 0, pending: 0, archived: 0 });
  assert.deepEqual(M.prearchiveCensus(null), { total: 0, pending: 0, archived: 0 });
});
