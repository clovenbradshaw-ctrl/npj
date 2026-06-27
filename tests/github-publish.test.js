/* github-publish.test.js — the GitHub commit contract.
 *
 * Publishing appends one EO line to articles/<slug>.jsonl through the Matrix-
 * gated /site/publish-npj webhook (mode:append, mirror:false). These guard the
 * exact request shape the webhook expects, and that an edit/status flip ride the
 * same path. The abort-on-stall guarantee is covered by publish-timeout.test.js.
 * `node --test`.
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

test("publishGenesis appends to articles/<slug>.jsonl via the GitHub webhook", async () => {
  const calls = captureFetch();
  try {
    const res = await A.publishGenesis(PAYLOAD);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, "one commit, one webhook call");
    const c = calls[0];
    assert.match(c.url, /\/webhook\/site\/publish-npj$/, "hits the publish-npj webhook");
    assert.equal(c.headers.Authorization, "Bearer tok", "carries the Matrix bearer token");
    assert.equal(c.body.filename, "articles/demo-article.jsonl", "writes the single per-document log");
    assert.equal(c.body.mode, "append", "appends — never overwrites the whole file");
    assert.equal(c.body.mirror, false, "mirror OFF — articles live in GitHub, not archive.org");
    assert.equal(c.body.contentRaw, PAYLOAD.line + "\n", "exactly the genesis line + newline");
    assert.ok(c.hadSignal, "the commit is bounded by an AbortSignal");
  } finally { calls.length, globalThis.fetch.restore(); }
});

test("appendEdit and setArticleStatus ride the same append path", async () => {
  const calls = captureFetch();
  try {
    const edit = await A.appendEdit({ slug: "demo-article", operand: { dek: "new dek" }, actor: "@a:h", note: "tighten", token: "tok" });
    assert.equal(edit.filename, "articles/demo-article.jsonl");
    assert.ok(edit.sha && edit.sha !== "0000000", "returns a version id for the edit");

    await A.setArticleStatus({ slug: "demo-article", status: "unpublished", actor: "@a:h", token: "tok" });

    assert.equal(calls.length, 2, "edit + status flip = two appends");
    calls.forEach(c => {
      assert.equal(c.body.filename, "articles/demo-article.jsonl");
      assert.equal(c.body.mode, "append");
      assert.equal(c.body.mirror, false);
    });
    const statusLine = JSON.parse(calls[1].body.contentRaw.trim());
    assert.equal(statusLine.op, "REC", "a status flip is a REC event");
    assert.equal(statusLine.operand.status, "unpublished");
  } finally { globalThis.fetch.restore(); }
});
