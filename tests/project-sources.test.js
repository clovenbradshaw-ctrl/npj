/* project-sources.test.js — NpjSources.projectSources is the shared source
 * shelf a project hands to a NEW article: every source bound to any document in
 * the project, deduped by content signature, shaped to seed a fresh draft so its
 * author can tag claims against those documents from the first keystroke.
 *
 * The guarantees this guards:
 *   • only the named project's documents contribute (room scoping).
 *   • the same key bound to two drafts is inherited once (key dedup).
 *   • the same CONTENT uploaded under two different keys collapses to one
 *     (content-signature dedup — the synthetic dedup sources.js is built on).
 *   • the result is shaped { sources:[{key,archived}], sourceRecords } and the
 *     `archived` flag tracks whether the record has a snapshot.
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/sources/sources.js");

const draft = (id, roomId, sources, sourceRecords) => ({
  id, room: roomId ? { roomId } : null, sources, sourceRecords: sourceRecords || {},
});

test("inherits sources only from documents in the named project", () => {
  const drafts = [
    draft("a", "!proj:hs", [{ key: "doc-1" }], { "doc-1": { id: "doc-1", title: "Filing", original_url: "https://court/1" } }),
    draft("b", "!other:hs", [{ key: "doc-2" }], { "doc-2": { id: "doc-2", title: "Elsewhere", original_url: "https://x/2" } }),
    draft("c", null, [{ key: "doc-3" }], { "doc-3": { id: "doc-3", title: "Solo", original_url: "https://y/3" } }),
  ];
  const inh = S.projectSources(drafts, "!proj:hs");
  assert.deepEqual(inh.sources.map(s => s.key), ["doc-1"]);
  assert.ok(inh.sourceRecords["doc-1"]);
  assert.equal(inh.sourceRecords["doc-2"], undefined);
});

test("the same key bound to two project documents is inherited once", () => {
  const rec = { id: "doc-1", title: "Filing", original_url: "https://court/1" };
  const drafts = [
    draft("a", "!proj:hs", [{ key: "doc-1" }], { "doc-1": rec }),
    draft("b", "!proj:hs", [{ key: "doc-1" }], { "doc-1": rec }),
  ];
  const inh = S.projectSources(drafts, "!proj:hs");
  assert.deepEqual(inh.sources.map(s => s.key), ["doc-1"]);
});

test("the same content under two keys collapses by signature", () => {
  // two uploads of the same URL → same signature → one inherited source
  const drafts = [
    draft("a", "!proj:hs", [{ key: "k-1" }], { "k-1": { id: "k-1", title: "Report", original_url: "https://news/report" } }),
    draft("b", "!proj:hs", [{ key: "k-2" }], { "k-2": { id: "k-2", title: "Report", original_url: "http://www.news/report/" } }),
  ];
  const inh = S.projectSources(drafts, "!proj:hs");
  assert.equal(inh.sources.length, 1);
});

test("the archived flag tracks whether the record carries a snapshot", () => {
  const drafts = [
    draft("a", "!proj:hs",
      [{ key: "live" }, { key: "snap" }],
      {
        "live": { id: "live", title: "Live page", original_url: "https://live/page" },
        "snap": { id: "snap", title: "Snapshot", original_url: "https://snap/page", archive_url: "https://web.archive.org/web/2026/https://snap/page" },
      }),
  ];
  const inh = S.projectSources(drafts, "!proj:hs");
  const byKey = Object.fromEntries(inh.sources.map(s => [s.key, s.archived]));
  assert.equal(byKey["live"], false);
  assert.equal(byKey["snap"], true);
});

test("a project with no bound sources yields an empty shelf", () => {
  const inh = S.projectSources([draft("a", "!proj:hs", [])], "!proj:hs");
  assert.deepEqual(inh.sources, []);
  assert.deepEqual(inh.sourceRecords, {});
});
