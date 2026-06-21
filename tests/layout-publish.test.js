/* layout-publish.test.js — publishLayout's response handling (the byline /
 * "Publish layout" commit). The webhook answers with a JSON contract even on
 * failure, so the client must judge a body-carrying response on its BODY, not on
 * its HTTP status alone: a 502 that says `{ ok:false, gh_status }` is a real
 * GitHub-commit verdict (don't retry, surface it), while a 502 with no JSON body
 * is a gateway hiccup (retry). Regression guard for "publishing shows 'couldn't
 * reach the site (502)' when GitHub actually rejected the commit". `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

// The client is an ES module (window.NpjLayout in the browser); pull it in via
// dynamic import from this CommonJS test. publishLayout reads the global `fetch`
// and `setTimeout` at call time, so stubbing them on globalThis is enough.
let publishLayout;
test.before(async () => {
  ({ publishLayout } = await import("../backend/npj-layout.client.js"));
});

// A fake fetch that returns a queued sequence of responses and counts calls.
function fakeFetch(responses) {
  const calls = { n: 0 };
  globalThis.fetch = async () => {
    const r = responses[Math.min(calls.n, responses.length - 1)];
    calls.n++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => { if (r.throws) throw new Error("not json"); return r.body; },
    };
  };
  return calls;
}

// Make the backoff sleeps instant so retry paths don't actually wait.
function instantTimers() {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  return () => { globalThis.setTimeout = real; };
}

const ARGS = { matrixToken: "tok", layout: { contributors: {} }, author: "@a:b" };

test("a 200 with ok:true resolves to the response body (one call)", async () => {
  const calls = fakeFetch([{ status: 200, body: { ok: true, commit_sha: "abc" } }]);
  const out = await publishLayout(ARGS);
  assert.equal(out.commit_sha, "abc");
  assert.equal(calls.n, 1);
});

test("a 502 carrying { ok:false, gh_status:401 } fails fast — NOT transient", async () => {
  // The README's "github commit failed" case (usually an expired GitHub
  // credential). It must not be retried as a gateway blip, and it must surface
  // the real GitHub status so the admin knows what to fix.
  const calls = fakeFetch([{ status: 502, body: { ok: false, error: "github commit failed", gh_status: 401 } }]);
  await assert.rejects(
    publishLayout({ ...ARGS, retries: 3 }),
    (e) => {
      assert.equal(e.gh_status, 401);
      assert.ok(!e.transient, "a real GitHub verdict must not be flagged transient");
      assert.match(e.message, /401/);
      return true;
    }
  );
  assert.equal(calls.n, 1); // no pointless retries
});

test("a 502 with NO JSON body is a gateway hiccup — retried, then transient", async () => {
  const restore = instantTimers();
  try {
    const calls = fakeFetch([{ status: 502, throws: true }]);
    await assert.rejects(
      publishLayout({ ...ARGS, retries: 2 }),
      (e) => { assert.ok(e.transient, "a bodyless gateway 502 should be transient"); return true; }
    );
    assert.equal(calls.n, 3); // initial + 2 retries
  } finally { restore(); }
});

test("a 409 SHA race is re-POSTed, then surfaced with its gh_status", async () => {
  const restore = instantTimers();
  try {
    const calls = fakeFetch([{ status: 502, body: { ok: false, error: "conflict", gh_status: 409 } }]);
    await assert.rejects(
      publishLayout({ ...ARGS, retries: 2 }),
      (e) => { assert.equal(e.gh_status, 409); return true; }
    );
    assert.equal(calls.n, 3); // a conflict is retried (re-fetches the blob SHA)
  } finally { restore(); }
});

test("a 401 is an authorization verdict — fails fast with a clear message", async () => {
  const calls = fakeFetch([{ status: 401, throws: true }]);
  await assert.rejects(publishLayout({ ...ARGS, retries: 3 }), /unauthorized/);
  assert.equal(calls.n, 1);
});
