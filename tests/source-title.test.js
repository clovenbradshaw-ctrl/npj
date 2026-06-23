/* source-title.test.js — best-effort source naming (app/source-title.js).
 * Pure, mechanical, no model and no network: a title + outlet guessed from a
 * URL, and read off a page's own <title>/og: tags. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../app/source-title.js");

test("titleFromUrl reads a headline out of the path slug", () => {
  assert.equal(
    T.titleFromUrl("https://www.nashvillescene.com/news/metro-council-rejects-cbid-budget/"),
    "Metro council rejects cbid budget"
  );
  // a dated path: skip the date parts, take the slug
  assert.equal(
    T.titleFromUrl("https://example.com/2026/06/22/the-war-over-benches-continues.html"),
    "The war over benches continues"
  );
});

test("titleFromUrl declines a bare section or a rootless URL", () => {
  assert.equal(T.titleFromUrl("https://nashville.gov/"), "");
  assert.equal(T.titleFromUrl("https://example.com/politics"), "");   // one short word → not a headline
  assert.equal(T.titleFromUrl("not a url"), "");
});

test("prettyOutlet strips boilerplate subdomains, keeps the domain", () => {
  assert.equal(T.prettyOutlet("https://www.nashvillescene.com/x"), "nashvillescene.com");
  assert.equal(T.prettyOutlet("https://m.example.co.uk/a/b"), "example.co.uk");
  assert.equal(T.prettyOutlet("https://amp.thebanner.org/"), "thebanner.org");
});

test("guess returns both a title and an outlet from the URL alone", () => {
  const g = T.guess("https://www.nashvillescene.com/news/metro-council-rejects-cbid-budget");
  assert.equal(g.title, "Metro council rejects cbid budget");
  assert.equal(g.outlet, "nashvillescene.com");
});

test("metaFromHtml prefers og:title and reads og:site_name", () => {
  const html = `<head>
    <meta property="og:title" content="Council rejects CBID budget">
    <meta property="og:site_name" content="Nashville Scene">
    <title>Council rejects CBID budget | Nashville Scene</title>
  </head>`;
  const m = T.metaFromHtml(html);
  assert.equal(m.title, "Council rejects CBID budget");
  assert.equal(m.site, "Nashville Scene");
});

test("metaFromHtml falls back to <title>, then <h1>; decodes entities", () => {
  assert.equal(T.metaFromHtml("<title>Benches &amp; budgets</title>").title, "Benches & budgets");
  assert.equal(T.metaFromHtml("<h1>Just an <em>h1</em> here</h1>").title, "Just an h1 here");
  assert.deepEqual(T.metaFromHtml(""), { title: "", site: "" });
});

test("metaFromHtml handles attributes in either order (content before property)", () => {
  const html = `<meta content="Reversed attrs work" property="og:title">`;
  assert.equal(T.metaFromHtml(html).title, "Reversed attrs work");
});

test("cleanTitle strips a trailing outlet tail", () => {
  assert.equal(T.cleanTitle("Real Headline | Nashville Scene", "Nashville Scene"), "Real Headline");
  assert.equal(T.cleanTitle("Real Headline - The Banner", ""), "Real Headline");    // short tail dropped
  assert.equal(T.cleanTitle("A perfectly fine standalone headline", ""), "A perfectly fine standalone headline");
  assert.equal(T.cleanTitle("Nashville Scene — Real Headline", "Nashville Scene"), "Real Headline");
});
