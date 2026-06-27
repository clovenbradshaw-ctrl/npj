/* archive-manifest.test.js — the archive.org read path's pure helpers.
 *
 * The site reads its content from archive.org, and the front-page line-up is a
 * VALIDATED manifest (only our backend writes it). These tests guard the pure
 * pieces that run in node:
 *
 *   • a full EO event log (the bytes archive.org serves at
 *     npj-article-<slug>/<slug>.jsonl) folds back to the article + its history.
 *   • metaFromArticle projects a folded article to the compact front-page meta,
 *     carrying `ver` (= base_sha) so the body cache can be invalidated on edit.
 *   • buildManifest stamps the schema, sanitizes rows, and normalizes status.
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const NpjArticles = require("../app/record/articles.js");

// one INS publish + one REC edit — exactly what the archive mirror holds for a
// document, joined as one log
function sampleLog() {
  const ins = NpjArticles.genesisLine({
    slug: "demo-article", headline: "Demo headline", dek: "A subtitle",
    column: "Investigations", tags: ["bench"], authors: ["@a:h"],
    published: "2026-06-01",
    body: [{ type: "p", tokens: ["Lorem ipsum dolor sit amet, the argument begins."] }]
  }, "@a:h");
  const rec = NpjArticles.editLine("demo-article", { dek: "An edited subtitle" }, "@a:h", "tightened the dek");
  return ins + "\n" + rec + "\n";
}

test("a full archive log folds to the current article + its versions", () => {
  const { article, versions } = NpjArticles.foldLog(sampleLog());
  assert.ok(article, "should fold to an article");
  assert.equal(article.slug, "demo-article");
  assert.equal(article.headline, "Demo headline");
  assert.equal(article.dek, "An edited subtitle", "the REC edit wins");
  assert.equal(versions.length, 2, "INS + REC both recorded");
  assert.ok(article.base_sha && article.base_sha !== "0000000", "carries a version id");
});

test("metaFromArticle projects the front-page meta and carries the version", () => {
  const { article } = NpjArticles.foldLog(sampleLog());
  const meta = NpjArticles.metaFromArticle(article, "demo-article");
  assert.equal(meta.slug, "demo-article");
  assert.equal(meta.headline, "Demo headline");
  assert.equal(meta.status, "published");
  assert.equal(meta.storage, "archive");
  assert.equal(meta.ver, article.base_sha, "ver = base_sha (used to invalidate the body cache)");
  assert.ok(/\/details\/npj-article-demo-article$/.test(meta.logPath), "logPath points at the IA item");
});

test("buildManifest stamps the schema and sanitizes rows", () => {
  const { article } = NpjArticles.foldLog(sampleLog());
  const meta = NpjArticles.metaFromArticle(article, "demo-article");
  const manifest = NpjArticles.buildManifest([meta, { slug: "", headline: "" }, null]);
  assert.equal(manifest.v, "npj/site-manifest/2");
  assert.ok(manifest.updated, "carries an updated timestamp");
  assert.equal(manifest.articles.length, 1, "drops rows with no slug/headline");
  const row = manifest.articles[0];
  assert.equal(row.slug, "demo-article");
  assert.equal(row.ver, article.base_sha);
  assert.equal(row.status, "published");
  assert.deepEqual(row.tags, ["bench"]);
});

test("buildManifest normalizes an unpublished row and never published-by-accident", () => {
  const manifest = NpjArticles.buildManifest([
    { slug: "hidden", headline: "Hidden", status: "unpublished", ver: "abc1234" },
    { slug: "shown", headline: "Shown", status: "anything-else", ver: "def5678" }
  ]);
  const byslug = Object.fromEntries(manifest.articles.map(a => [a.slug, a]));
  assert.equal(byslug.hidden.status, "unpublished");
  assert.equal(byslug.shown.status, "published", "unknown status defaults to published");
});
