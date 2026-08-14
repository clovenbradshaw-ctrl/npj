/* front-tree.test.js — the GitHub read path's front-page listing.
 *
 * The published record lives in GitHub: one append-only file per document
 * (articles/<slug>.jsonl), and the front-page line-up is ONE git-tree call that
 * lists articles/*.jsonl. There is no archive.org and no separate manifest —
 * the repository directory IS the index. These tests stub fetch so listArticles
 * runs in node, and guard:
 *
 *   • a full EO log (INS + REC) folds to the current article + its history.
 *   • listArticles turns the git-tree + raw bodies into sorted front-page metas.
 *   • a REC status flip folds through to the meta (unpublished survives).
 *   • dropFromFront drops a slug from the in-memory index and promotes the next.
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

function logFor(slug, headline, { dek, status, published } = {}) {
  const ins = A.genesisLine({
    slug, headline, dek: dek || "A subtitle", column: "Investigations",
    tags: ["bench"], authors: ["@a:h"], published: published || "2026-06-01",
    body: [{ type: "p", tokens: ["Lorem ipsum dolor sit amet, the argument begins."] }]
  }, "@a:h");
  let text = ins + "\n";
  if (status) text += A.editLine(slug, { status }, "@a:h", "status flip") + "\n";
  return text;
}

test("a full GitHub log folds to the current article + its versions", () => {
  const text = logFor("demo-article", "Demo headline") +
    A.editLine("demo-article", { dek: "An edited subtitle" }, "@a:h", "tightened the dek") + "\n";
  const { article, versions } = A.foldLog(text);
  assert.ok(article, "should fold to an article");
  assert.equal(article.slug, "demo-article");
  assert.equal(article.dek, "An edited subtitle", "the REC edit wins");
  assert.equal(versions.length, 2, "INS + REC both recorded");
  assert.ok(article.base_sha && article.base_sha !== "0000000", "carries a version id");
});

// Stub a GitHub repo: one git-tree listing + a raw body per document. Each entry
// maps a repo PATH to its raw body; the git-tree lists exactly those paths, so a
// path under articles/<slug>/ models a folder-only document (no flat anchor).
function stubGitHubPaths(byPath) {
  const tree = { tree: Object.keys(byPath).map((path, i) => ({ type: "blob", path, sha: "sha" + i })) };
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (/git\/trees\/main/.test(url)) return { ok: true, status: 200, json: async () => tree };
    const m = /(articles\/.+?\.jsonl)(?:\?|$)/.exec(String(url));
    const path = m && decodeURIComponent(m[1]);
    if (path && byPath[path] != null) return { ok: true, status: 200, text: async () => byPath[path] };
    return { ok: false, status: 404, text: async () => "" };
  };
  return () => { if (prev === undefined) delete globalThis.fetch; else globalThis.fetch = prev; };
}

// The common case: one flat anchor (articles/<slug>.jsonl) per document.
function stubGitHub(bodies) {
  const byPath = {};
  Object.keys(bodies).forEach(slug => { byPath["articles/" + slug + ".jsonl"] = bodies[slug]; });
  return stubGitHubPaths(byPath);
}

test("listArticles folds the git-tree + raw bodies into sorted front-page metas", async () => {
  const restore = stubGitHub({
    "older-piece": logFor("older-piece", "Older piece", { published: "2026-05-01" }),
    "newer-piece": logFor("newer-piece", "Newer piece", { published: "2026-06-20" })
  });
  try {
    const metas = await A.listArticles();
    assert.equal(metas.length, 2, "both documents listed");
    assert.equal(metas[0].slug, "newer-piece", "sorted newest-first by published date");
    assert.equal(metas[0].headline, "Newer piece");
    assert.equal(metas[0].status, "published");
    assert.equal(metas[0].storage, "github");
    assert.match(metas[0].logPath, /github\.com\/.*\/blob\/main\/articles\/newer-piece\.jsonl$/);
  } finally { restore(); }
});

// genesisLine/editLine stamp `ts` with "now"; re-stamp it so a test can pin a
// piece's publish and edit instants and make the ordering deterministic.
function withTs(line, ts) { const e = JSON.parse(line); e.ts = ts; return JSON.stringify(e); }

test("listArticles orders by ORIGINAL publish date — a re-edited older piece does NOT jump the queue", async () => {
  // "edited-old" was published back in May but re-edited on Jul 2; "fresh" was
  // published Jun 20 and never touched since. The front page orders purely by
  // each piece's original publish date, so "fresh" leads — editing (or fully
  // republishing, see the test below) never bumps a piece's place in line.
  const editedOld =
    withTs(A.genesisLine({
      slug: "edited-old", headline: "Edited old piece", dek: "A subtitle", column: "Investigations",
      tags: ["bench"], authors: ["@a:h"], published: "2026-05-01",
      body: [{ type: "p", tokens: ["Lorem ipsum dolor sit amet."] }]
    }, "@a:h"), "2026-05-01T12:00:00.000Z") + "\n" +
    withTs(A.editLine("edited-old", { dek: "A freshly tightened subtitle" }, "@a:h", "re-edit"),
      "2026-07-02T12:00:00.000Z") + "\n";
  const fresh = withTs(A.genesisLine({
    slug: "fresh", headline: "Fresh publish", dek: "A subtitle", column: "Investigations",
    tags: ["bench"], authors: ["@a:h"], published: "2026-06-20",
    body: [{ type: "p", tokens: ["Lorem ipsum dolor sit amet."] }]
  }, "@a:h"), "2026-06-20T12:00:00.000Z") + "\n";
  const restore = stubGitHub({ "edited-old": editedOld, "fresh": fresh });
  try {
    const metas = await A.listArticles();
    assert.equal(metas.length, 2, "both documents listed");
    assert.equal(metas[0].slug, "fresh", "the untouched newer publish takes the hero");
    assert.equal(metas[1].slug, "edited-old", "the re-edited older piece stays behind it");
    assert.equal(metas[1].published, "2026-05-01", "its ORIGINAL publish date survived the edit, unchanged");
    assert.equal(metas[1].updated, "2026-07-02", "the edit still shows up as `updated`, just doesn't reorder");
  } finally { restore(); }
});

test("a full REPUBLISH (a second INS on the same slug) does not change front-page order either", async () => {
  // "republished-old" published in Feb, then republished (a brand-new INS event
  // — see publishGenesis's genesis-is-write-once comment) in Aug. "fresh" only
  // ever published once, in June. The republish's own INS operand stamps
  // `published: today()` same as any publish — foldLog must still recover the
  // ORIGINAL Feb date from the genesis event, not the republish's fresh stamp.
  const republishedOld =
    withTs(A.genesisLine({
      slug: "republished-old", headline: "Republished old piece v1", dek: "A subtitle", column: "Investigations",
      tags: ["bench"], authors: ["@a:h"], published: "2026-02-10",
      body: [{ type: "p", tokens: ["Lorem ipsum dolor sit amet."] }]
    }, "@a:h"), "2026-02-10T09:00:00.000Z") + "\n" +
    withTs(A.genesisLine({
      slug: "republished-old", headline: "Republished old piece v2", dek: "A subtitle", column: "Investigations",
      tags: ["bench"], authors: ["@a:h"], published: "2026-08-14",
      body: [{ type: "p", tokens: ["A rewritten lede, republished months later."] }]
    }, "@a:h"), "2026-08-14T09:00:00.000Z") + "\n";
  const fresh = withTs(A.genesisLine({
    slug: "fresh", headline: "Fresh publish", dek: "A subtitle", column: "Investigations",
    tags: ["bench"], authors: ["@a:h"], published: "2026-06-20",
    body: [{ type: "p", tokens: ["Lorem ipsum dolor sit amet."] }]
  }, "@a:h"), "2026-06-20T12:00:00.000Z") + "\n";
  const restore = stubGitHub({ "republished-old": republishedOld, "fresh": fresh });
  try {
    const metas = await A.listArticles();
    assert.equal(metas.length, 2, "both documents listed");
    assert.equal(metas[0].slug, "fresh", "the piece that only ever published once still leads");
    assert.equal(metas[1].slug, "republished-old");
    assert.equal(metas[1].published, "2026-02-10", "the republish's own `today()` stamp never overwrote the genesis date");
    assert.equal(metas[1].headline, "Republished old piece v2", "the republish still wins on everything ELSE — body, headline, etc.");
  } finally { restore(); }
});

test("a guid folder with no flat anchor renders — its INS event file IS the genesis", async () => {
  // Every article now lives in its own folder named by its guid; the publish
  // lands inside the folder, with no sibling articles/<guid>.jsonl anchor. The
  // folder alone must define a complete, listable document.
  const guid = "4bfd31c9-3e4b-4e77-9d39-ef757bac5cf7";
  const ins = A.genesisLine({
    slug: guid, headline: "Folder-only piece", dek: "lives in its own guid folder",
    column: "Latest", authors: ["@a:h"], byline: "Jane Doe", published: "2026-06-29",
    body: [{ type: "p", tokens: ["The folder is the document."] }]
  }, "@a:h");
  const restore = stubGitHubPaths({
    ["articles/" + guid + "/20260629T194400702Z-ins-4f0bc8e.jsonl"]: ins + "\n"
  });
  try {
    const metas = await A.listArticles();
    assert.equal(metas.length, 1, "the folder-only document is listed");
    assert.equal(metas[0].slug, guid, "keyed by its guid");
    assert.equal(metas[0].headline, "Folder-only piece");
    assert.equal(metas[0].byline, "Jane Doe", "the typed display name rides through");
    assert.match(metas[0].logPath, /\/tree\/main\/articles\/4bfd31c9-[\da-f-]+$/, "log link opens the folder, not a missing file");
  } finally { restore(); }
});

test("a folder of only edits (no INS) is an orphan and is skipped", async () => {
  const guid = "00000000-0000-4000-8000-000000000000";
  const rec = A.editLine(guid, { dek: "edit without a publish" }, "@a:h", "stray edit");
  const restore = stubGitHubPaths({
    ["articles/" + guid + "/20260629T194400702Z-rec-deadbee.jsonl"]: rec + "\n"
  });
  try {
    const metas = await A.listArticles();
    assert.equal(metas.length, 0, "no INS → no genesis → not a document");
  } finally { restore(); }
});

test("a REC status flip folds through to the meta — unpublished survives", async () => {
  const restore = stubGitHub({
    "hidden-piece": logFor("hidden-piece", "Hidden piece", { status: "unpublished" })
  });
  try {
    const metas = await A.listArticles();
    assert.equal(metas.length, 1);
    assert.equal(metas[0].status, "unpublished", "the unpublish REC wins, never published-by-accident");
  } finally { restore(); }
});

test("listArticles falls back to the cached index when the listing is down", async () => {
  // git-tree throws (rate limit / offline) → no cache in node → empty, never throws
  const prev = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const metas = await A.listArticles();
    assert.deepEqual(metas, [], "a listing failure paints nothing rather than crashing");
  } finally { if (prev === undefined) delete globalThis.fetch; else globalThis.fetch = prev; }
});

test("dropFromFront removes a slug and promotes the next piece to lead", () => {
  const prevWin = globalThis.window;
  globalThis.window = globalThis;
  globalThis.NPJ = { FRONT: {
    lead: { slug: "junk-1", headline: "Junk 1" },
    secondary: [
      { slug: "junk-2", headline: "Junk 2" },
      { slug: "real", headline: "Real piece" }
    ]
  } };
  try {
    A.dropFromFront(["junk-1", "junk-2"]);
    const F = globalThis.NPJ.FRONT;
    assert.equal(F.lead.slug, "real", "the surviving piece is promoted to lead");
    assert.equal(F.secondary.length, 0, "no junk left in the secondary line-up");

    A.dropFromFront("real");
    assert.equal(globalThis.NPJ.FRONT.lead, null, "lead clears when nothing survives");
    assert.equal(globalThis.NPJ.FRONT.secondary.length, 0);
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
    delete globalThis.NPJ;
  }
});
