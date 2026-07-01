/* html-urls.test.js — the imported-HTML link extractor (app/sources/html-urls.js).
 * Pure, mechanical, no model and no network: pull the outbound URLs out of an HTML
 * document, unwrap wayback captures, and drop the ones the room already absorbed.
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../app/sources/html-urls.js");

test("extractUrls reads absolute http(s) links out of anchors, in document order", () => {
  const html = `<a href="https://a.example/one">1</a> then <a href='http://b.example/two'>2</a>`;
  assert.deepEqual(H.extractUrls(html), ["https://a.example/one", "http://b.example/two"]);
});

test("extractUrls also catches bare URLs sitting in the text, once", () => {
  const html = `<p>See https://c.example/story for more.</p><a href="https://c.example/story">dup</a>`;
  // the bare URL and the anchor collapse to one (same normalized form)
  assert.deepEqual(H.extractUrls(html), ["https://c.example/story"]);
});

test("extractUrls skips relative links, in-page anchors, mailto/tel/js and asset src", () => {
  const html = [
    `<a href="/relative/path">rel</a>`,
    `<a href="#section">anchor</a>`,
    `<a href="mailto:x@y.com">mail</a>`,
    `<a href="tel:+1555">tel</a>`,
    `<a href="javascript:void(0)">js</a>`,
    `<img src="https://cdn.example/pic.png">`,      // asset src is not a citable source
    `<script src="https://cdn.example/app.js"></script>`,
    `<a href="https://keep.example/page">keep</a>`,
  ].join("");
  assert.deepEqual(H.extractUrls(html), ["https://keep.example/page"]);
});

test("extractUrls de-duplicates by normalized form (protocol, www, slash, query)", () => {
  const html = [
    `<a href="https://www.dup.example/a/">one</a>`,
    `<a href="http://dup.example/a">two</a>`,
    `<a href="https://dup.example/a?utm=x#frag">three</a>`,
  ].join("");
  assert.deepEqual(H.extractUrls(html), ["https://www.dup.example/a/"]); // first wins
});

test("extractUrls unwraps a wayback capture to the page it archived", () => {
  const html = `<a href="https://web.archive.org/web/20240101000000id_/https://real.example/story">snap</a>`;
  assert.deepEqual(H.extractUrls(html), ["https://real.example/story"]);
});

test("extractUrls decodes &amp; in hrefs and trims trailing sentence punctuation off bare URLs", () => {
  assert.deepEqual(
    H.extractUrls(`<a href="https://q.example/s?a=1&amp;b=2">q</a>`),
    ["https://q.example/s?a=1&b=2"]
  );
  assert.deepEqual(H.extractUrls(`Read https://p.example/x.`), ["https://p.example/x"]);
});

test("newUrls drops URLs the room has already absorbed (by normalized form)", () => {
  const html = [
    `<a href="https://new.example/a">new</a>`,
    `<a href="https://old.example/b">old</a>`,
  ].join("");
  // absorbed carries the old link in a different-but-equivalent shape + a wayback wrap
  const absorbed = ["http://www.old.example/b/", "https://web.archive.org/web/2020/https://also.example/c"];
  assert.deepEqual(H.newUrls(html, absorbed), ["https://new.example/a"]);
});

test("newUrls with nothing absorbed returns every extracted URL; empty/blank HTML is []", () => {
  assert.deepEqual(H.newUrls(`<a href="https://x.example/1">x</a>`, []), ["https://x.example/1"]);
  assert.deepEqual(H.newUrls("", ["https://x.example/1"]), []);
  assert.deepEqual(H.extractUrls(null), []);
});

test("extractUrls works on plain prose text (typed / pasted URLs, no markup)", () => {
  const text = "See https://x.example/a and then https://y.example/b — done.";
  assert.deepEqual(H.extractUrls(text), ["https://x.example/a", "https://y.example/b"]);
});

test("extractUrls reads a data-href target (autolinked anchor) too", () => {
  assert.deepEqual(
    H.extractUrls(`<a data-href="https://z.example/page">z</a>`),
    ["https://z.example/page"]
  );
});

test("isHtml recognizes html by name, mime, or a documentish sample", () => {
  assert.equal(H.isHtml("bookmarks.html", "", ""), true);
  assert.equal(H.isHtml("noext", "text/html", ""), true);
  assert.equal(H.isHtml("noext", "", "<!DOCTYPE html><html>"), true);
  assert.equal(H.isHtml("notes.txt", "text/plain", "just words"), false);
});
