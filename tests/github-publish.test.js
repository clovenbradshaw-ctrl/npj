/* github-publish.test.js — the GitHub commit contract.
 *
 * Every write is a CLEAN CREATE through the Matrix-gated /site/publish-npj
 * webhook (mode:overwrite, mirror:false) — NPJ never read-modify-appends an
 * existing file. The first publish writes the genesis anchor articles/<slug>.jsonl;
 * every later event (edit, status flip, republish, feedback) is written as its
 * OWN new file under articles/<slug>/, so editing never has to touch prior
 * GitHub content. These guard that request shape. The abort-on-stall guarantee
 * is covered by publish-timeout.test.js. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

// capture every POST the write path makes, and answer with the webhook's
// success contract ({ gh_ok, commit_sha, bytes }).
function captureFetch() {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, headers: (opts && opts.headers) || {}, body, hadSignal: !!(opts && opts.signal) });
    return { ok: true, status: 200, json: async () => ({ gh_ok: true, commit_sha: "abc1234", bytes: (body && body.contentRaw || "").length }) };
  };
  globalThis.fetch.restore = () => { if (prev === undefined) delete globalThis.fetch; else globalThis.fetch = prev; };
  return calls;
}

const PAYLOAD = { slug: "demo-article", line: '{"op":"INS","operand":{"slug":"demo-article"}}', token: "tok", message: "publish: demo-article" };

test("publishGenesis creates the genesis anchor articles/<slug>.jsonl", async () => {
  const calls = captureFetch();
  try {
    const res = await A.publishGenesis(PAYLOAD);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, "one commit, one webhook call");
    const c = calls[0];
    assert.match(c.url, /\/webhook\/site\/publish-npj$/, "hits the publish-npj webhook");
    assert.equal(c.headers.Authorization, "Bearer tok", "carries the Matrix bearer token");
    assert.equal(c.body.filename, "articles/demo-article.jsonl", "first publish anchors the slug");
    assert.equal(c.body.mode, "overwrite", "a clean create — never read-modify-append");
    assert.equal(c.body.mirror, false, "mirror OFF — articles live in GitHub, not archive.org");
    assert.equal(c.body.contentRaw, PAYLOAD.line + "\n", "exactly the genesis line + newline");
    assert.ok(c.hadSignal, "the commit is bounded by an AbortSignal");
  } finally { globalThis.fetch.restore(); }
});

const EVT = /^articles\/demo-article\/\d{8}T\d{9}Z-[a-z]+-[0-9a-f]{7}\.jsonl$/;

test("a republish writes a NEW event file, never the genesis", async () => {
  const calls = captureFetch();
  try {
    await A.publishGenesis(Object.assign({}, PAYLOAD, { republish: true }));
    const c = calls[0];
    assert.match(c.body.filename, EVT, "republish lands in articles/<slug>/<stamp>-ins-<hash>.jsonl");
    assert.notEqual(c.body.filename, "articles/demo-article.jsonl", "the genesis is never re-edited");
    assert.equal(c.body.mode, "overwrite", "a clean create");
  } finally { globalThis.fetch.restore(); }
});

test("appendEdit and setArticleStatus each write their own new event file", async () => {
  const calls = captureFetch();
  try {
    const edit = await A.appendEdit({ slug: "demo-article", operand: { dek: "new dek" }, actor: "@a:h", note: "tighten", token: "tok", status: "published" });
    assert.match(edit.filename, EVT, "the edit is its own file, not the genesis");
    assert.ok(edit.sha && edit.sha !== "0000000", "returns a version id for the edit");
    const editLine = JSON.parse(calls[0].body.contentRaw.trim());
    assert.equal(editLine.operand.status, "published", "each file self-records publication state");

    await A.setArticleStatus({ slug: "demo-article", status: "unpublished", actor: "@a:h", token: "tok" });

    assert.equal(calls.length, 2, "edit + status flip = two distinct files");
    calls.forEach(c => {
      assert.match(c.body.filename, EVT, "never the genesis, always a fresh per-event file");
      assert.equal(c.body.mode, "overwrite");
      assert.equal(c.body.mirror, false);
    });
    assert.notEqual(calls[0].body.filename, calls[1].body.filename, "two events → two different files");
    const statusLine = JSON.parse(calls[1].body.contentRaw.trim());
    assert.equal(statusLine.op, "REC", "a status flip is a REC event");
    assert.equal(statusLine.operand.status, "unpublished", "the newest file declares the current status");
  } finally { globalThis.fetch.restore(); }
});
