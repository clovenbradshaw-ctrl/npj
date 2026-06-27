/* publish-timeout.test.js — the article commit POST is bounded.
 *
 * Regression guard for the "PUBLISH BOUNDARY keeps getting stuck on 'Commit the
 * EO event log'" report. The publish webhook (the deployed
 * https://n8n.intelechia.com/webhook/site/publish-npj) does a read-modify-append
 * on archive.org; if it accepts the connection then stalls, a BARE fetch() never
 * resolves and the commit step spins on its <Spinner/> forever with no way out.
 *
 * postArticle (behind publishGenesis) now wraps every leg — the primary
 * article-npj POST AND the legacy publish-npj fallback — in an AbortController
 * that fires after a fixed budget, so a stalled webhook surfaces as a normal
 * fetch rejection the gate already turns into a retryable failure. These tests
 * stub fetch + setTimeout so the abort path runs instantly. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

// A fetch that never answers on its own — it only ever settles when the caller
// aborts its signal (i.e. when the timeout fires). That models a webhook that
// accepts the connection then hangs. Records how many times it was called and
// whether each call carried an AbortSignal.
function stallingFetch() {
  const calls = [];
  globalThis.fetch = (url, opts) => {
    const signal = opts && opts.signal;
    calls.push({ url, hadSignal: !!signal });
    return new Promise((_resolve, reject) => {
      if (!signal) return; // no signal → would hang forever (the bug)
      if (signal.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  };
  return calls;
}

// Make the 120s abort timer fire immediately so the test doesn't actually wait.
function instantAbortTimer() {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { Promise.resolve().then(fn); return 0; };
  return () => { globalThis.setTimeout = real; };
}

const PAYLOAD = { slug: "demo-article", line: '{"op":"INS"}', token: "tok", message: "publish: demo-article" };

test("a stalled webhook is aborted, not hung — publishGenesis rejects", async () => {
  const restore = instantAbortTimer();
  const calls = stallingFetch();
  try {
    await assert.rejects(A.publishGenesis(PAYLOAD), (e) => {
      assert.equal(e.name, "AbortError", "the hang is broken by an abort, not left pending");
      return true;
    });
    // both the primary article-npj POST and the legacy publish-npj fallback ran,
    // and BOTH carried an abort signal (the fallback used to be unbounded).
    assert.ok(calls.length >= 1, "at least the primary POST was attempted");
    assert.ok(calls.every((c) => c.hadSignal), "every commit leg is bounded by an AbortSignal");
  } finally {
    restore();
    delete globalThis.fetch;
  }
});

test("a webhook that answers normally is NOT aborted (the timer is cleared)", async () => {
  // The happy path must still return the response untouched — the timeout only
  // bites a genuine stall.
  const real = globalThis.setTimeout;
  let aborts = 0;
  globalThis.setTimeout = () => { aborts++; return 0; }; // never auto-fires
  globalThis.fetch = async (url, opts) => {
    assert.ok(opts && opts.signal, "the bounded fetch still passes a signal");
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const res = await A.publishGenesis(PAYLOAD);
    assert.equal(res.status, 200);
  } finally {
    globalThis.setTimeout = real;
    delete globalThis.fetch;
  }
});
