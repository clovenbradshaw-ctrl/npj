/* scheduled-publish.test.js — a scheduled publish: committed now, held off the
 * front page until a chosen instant (`releaseAt`), which also becomes the piece's
 * shown release date.
 *
 * The gate is decided against the wall-clock, not baked into the fold — so a
 * piece whose blob sha never changes still clears its gate the moment the time
 * passes. These guard the fold-side contract: `releaseAt` rides through the EO
 * fold, `published` carries the release date, and `scheduled` flips with the
 * clock. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

const ins = (operand) => JSON.stringify({ v: A.SCHEMA, op: "INS", target: "article/" + operand.slug, ts: "2026-06-29T12:00:00.000Z", actor: "@a:b", operand });

const HOUR = 3600 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

// ---- minimal faithful DOM, enough for htmlToBlocks' walk (no jsdom) ----
const tnode = (s) => ({ nodeType: 3, nodeValue: s, textContent: s });
function enode(tag, kids) {
  kids = kids || [];
  return {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids, style: {},
    get textContent() { return kids.map((k) => k.textContent).join(""); },
    classList: { contains: () => false },
    getAttribute: () => null, hasAttribute: () => false,
    querySelector: () => null, querySelectorAll: () => [],
  };
}
// run genesisFromContent against a hand-built h1 + p tree (the createElement shim
// ignores the HTML string and serves this tree as document.body's children)
function withGenesis(opts) {
  const root = { childNodes: [enode("h1", [tnode("Head")]), enode("p", [tnode("body")])], set innerHTML(_) {} };
  const savedDoc = global.document, savedWin = global.window;
  global.document = { createElement: () => root };
  global.window = { NPJ: { SOURCES: {} } };
  try { return A.genesisFromContent({ html: "<ignored/>" }, opts); }
  finally { global.document = savedDoc; global.window = savedWin; }
}

test("a future releaseAt folds through and marks the piece scheduled", () => {
  const at = iso(48 * HOUR);
  const { article } = A.foldLog(ins({ slug: "soon", headline: "Soon", releaseAt: at, body: [{ type: "p", tokens: ["x"] }] }));
  assert.equal(article.releaseAt, at, "releaseAt rides through the fold");
  assert.equal(article.scheduled, true, "a future release reads as scheduled");
});

test("a past releaseAt is not scheduled — it reads as live", () => {
  const { article } = A.foldLog(ins({ slug: "past", headline: "Past", releaseAt: iso(-HOUR), body: [{ type: "p", tokens: ["x"] }] }));
  assert.equal(article.scheduled, false, "a release already in the past is live, not gated");
});

test("a piece with no releaseAt is an ordinary live publish", () => {
  const { article } = A.foldLog(ins({ slug: "plain", headline: "Plain", body: [{ type: "p", tokens: ["x"] }] }));
  assert.equal(article.releaseAt, null);
  assert.equal(article.scheduled, false);
});

test("genesisFromContent dates a scheduled piece by its release date, not today", () => {
  const at = new Date(Date.now() + 72 * HOUR).toISOString();
  const gen = withGenesis({ slug: "sch", actor: "@a:b", releaseAt: at });
  assert.equal(gen.operand.releaseAt, at, "the release instant rides the genesis operand");
  assert.equal(gen.operand.published, A.releaseDate(at), "published is the release date, not today()");
  assert.equal(gen.article.scheduled, true);
});

test("genesisFromContent ignores a past releaseAt — falls back to a live publish today", () => {
  const past = new Date(Date.now() - 72 * HOUR).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const gen = withGenesis({ slug: "live", actor: "@a:b", releaseAt: past });
  assert.equal(gen.operand.releaseAt, undefined, "a past release never gates the piece");
  assert.equal(gen.operand.published, today, "a live publish is dated today");
});

test("scheduledFuture: true only for a parseable instant ahead of now", () => {
  assert.equal(A.scheduledFuture(iso(HOUR)), true);
  assert.equal(A.scheduledFuture(iso(-HOUR)), false);
  assert.equal(A.scheduledFuture(""), false);
  assert.equal(A.scheduledFuture(null), false);
  assert.equal(A.scheduledFuture("not-a-date"), false);
});
