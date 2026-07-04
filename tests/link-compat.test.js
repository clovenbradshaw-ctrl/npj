/* link-compat.test.js — share links: mint with "&", still parse ";".
 *
 * Chat and mail apps stop auto-linking a pasted URL at a semicolon, so the
 * canonical share link moved from #article;read=<slug> to #article&read=<slug>
 * (PR #271). But every link minted before that change is still out in the
 * wild — in chats, emails, bookmarks — and must keep resolving forever.
 *
 * These tests pull the REAL parsing regexes out of index.html (the hash-part
 * splitter and the welcome-token matcher) and the REAL minted-link shape out
 * of app/ui/shared.jsx, then replay the router's own parse over both the old
 * ";" links and the new "&" links. If someone ever drops ";" from the parser,
 * or puts ";" back into a minted link, this suite fails.
 *
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexSrc = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const sharedSrc = fs.readFileSync(path.join(__dirname, "..", "app", "ui", "shared.jsx"), "utf8");

// —— extract the app's own parsing pieces, so the test can't drift from it ——

// const hp = (location.hash.slice(1) || "").split(/[;,&]/).map(...)
const splitLit = (indexSrc.match(/location\.hash\.slice\(1\)[^\n]*?\.split\((\/[^/]+\/)\)/) || [])[1];
assert.ok(splitLit, "index.html still splits location.hash into parts");
const SPLIT_RE = new RegExp(splitLit.slice(1, -1));

// const m = (location.hash || "").match(/(?:^#|[;&])welcome=([^;&]+)/);
const welcomeLit = (indexSrc.match(/\(location\.hash \|\| ""\)\.match\((\/[^\n]+?\/)\)/) || [])[1];
assert.ok(welcomeLit, "index.html still matches a welcome token in the hash");
const WELCOME_RE = new RegExp(welcomeLit.slice(1, -1));

// the route list from: ["newsroom", "article", ...].find(r => hp.includes(r))
const routesLit = (indexSrc.match(/(\[[^\]]+\])\.find\(r => hp\.includes\(r\)\)/) || [])[1];
assert.ok(routesLit, "index.html still resolves the route from hash parts");
const ROUTES = JSON.parse(routesLit);

// function npjArticleUrl(slug) { return npjSiteBase() + "#article&read=" + ... }
const mintedPrefix = (sharedSrc.match(/function npjArticleUrl[^\n]*?"(#[^"]+)"/) || [])[1];
assert.ok(mintedPrefix, "shared.jsx still mints the article share link");

// Replays index.html's mount-time parse (route, pendingRead, draftId, flags).
function parseHash(hash) {
  const hp = (hash.slice(1) || "").split(SPLIT_RE).map(s => s.trim());
  const read = hp.find(p => /^read=/.test(p));
  const doc = hp.find(p => /^doc=/.test(p));
  return {
    route: ROUTES.find(r => hp.includes(r)) || "home",
    read: read ? decodeURIComponent(read.slice(5)) : null,
    doc: doc ? decodeURIComponent(doc.slice(4)) : null,
    audit: hp.includes("audit"),
    sugg: hp.includes("sugg"),
  };
}

test("an old #article;read=<slug> link still opens the article", () => {
  const guid = "560fb6e2-d3a0-4a87-9981-e5ac8b31ee62";
  const old = parseHash("#article;read=" + guid);
  assert.equal(old.route, "article");
  assert.equal(old.read, guid);
});

test("old ';' links and new '&' links parse identically", () => {
  const pairs = [
    ["#article;read=my-piece", "#article&read=my-piece"],
    ["#article;read=my-piece;audit", "#article&read=my-piece&audit"],
    ["#newsroom;doc=draft-7;sugg", "#newsroom&doc=draft-7&sugg"],
  ];
  for (const [oldLink, newLink] of pairs)
    assert.deepEqual(parseHash(oldLink), parseHash(newLink), oldLink + " must equal " + newLink);
});

test("mixed separators (a hand-edited link) still parse", () => {
  const p = parseHash("#article;read=my-piece&audit");
  assert.equal(p.route, "article");
  assert.equal(p.read, "my-piece");
  assert.equal(p.audit, true);
});

test("a percent-encoded slug survives either separator", () => {
  const slug = "café report";
  for (const sep of [";", "&"]) {
    const p = parseHash("#article" + sep + "read=" + encodeURIComponent(slug));
    assert.equal(p.read, slug);
  }
});

test("welcome tokens match after '#', ';' and '&' alike", () => {
  for (const h of ["#welcome=tok123", "#submit;welcome=tok123", "#submit&welcome=tok123"]) {
    const m = h.match(WELCOME_RE);
    assert.ok(m, h + " should carry the welcome token");
    assert.equal(m[1], "tok123");
  }
});

test("minted share links use '&', never ';' (auto-linkers stop at ';')", () => {
  assert.ok(mintedPrefix.startsWith("#article&read="), "share link is #article&read=<slug>, got " + mintedPrefix);
  assert.ok(!mintedPrefix.includes(";"), "no semicolon anywhere in a minted link");
});

test("the hash the app writes back joins parts with '&'", () => {
  // history.replaceState(null, "", "#" + f.join("&")) — the write side of the
  // round-trip: an old ';' link is parsed, then rewritten in the new shape.
  assert.match(indexSrc, /history\.replaceState\(null, "", "#" \+ f\.join\("&"\)\)/,
    "index.html rewrites the hash with '&' between parts");
});
