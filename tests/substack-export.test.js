/* substack-export.test.js — the folded-article → Substack serializers
 * (app/substack-export.js). Pure shaping, no DOM: we hand toMarkdown/toHtml a
 * body-block article + a sources map (opts.sources) exactly like the one the
 * reader folds, and check the bits that make a paste land right in Substack —
 * headings, images from the durable URL, links, lists, blockquotes, and the
 * sourcing carried as superscript links + a Sources list. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const NS = require("../app/substack-export.js");

const SOURCES = {
  s1: { id: "s1", outlet: "Reuters", title: "City budget passes",
        archive_url: "https://web.archive.org/web/2026/https://reuters.com/x", retrieved: "2026-06-01" },
  s2: { id: "s2", outlet: "Gov data", title: "Q2 filings", original_url: "https://example.gov/q2" }
};

const ARTICLE = {
  slug: "city-budget",
  kicker: "Local",
  headline: "City passes budget",
  dek: "After a long debate.",
  byline: "Jane Doe",
  published: "2026-06-20",
  image: { src: "https://web.archive.org/web/2026/banner.jpg", banner: true, caption: "City hall" },
  body: [
    { type: "p", tokens: ["The council met. ", { c: "The budget passed 7-2.", src: ["s1"], id: "c1" }] },
    { type: "h2", text: "What changed" },
    { type: "ul", items: [["Roads funded"], ["Parks ", { c: "got more money.", src: ["s2"], id: "c2" }]] },
    { type: "pull", text: "A historic vote.", attribution: "Mayor" },
    { type: "img", src: "https://web.archive.org/web/2026/chart.png", caption: "The chart" },
    { type: "embed", url: "https://youtube.com/watch?v=abc" },
    { type: "code", text: "let x = 1;" }
  ]
};
const opts = { sources: SOURCES };
const md = (o) => NS.toMarkdown(ARTICLE, Object.assign({}, opts, o));
const html = (o) => NS.toHtml(ARTICLE, Object.assign({}, opts, o));

test("markdown carries the title, subtitle, byline and headings", () => {
  const m = md();
  assert.match(m, /^# City passes budget$/m);
  assert.match(m, /^\*After a long debate\.\*$/m);
  assert.match(m, /By Jane Doe/);
  assert.match(m, /^## What changed$/m);
});

test("the banner is lifted to a hero image with its caption, from the durable URL", () => {
  const m = md();
  assert.match(m, /!\[City hall\]\(https:\/\/web\.archive\.org\/web\/2026\/banner\.jpg\)/);
  // inline images render too
  assert.match(m, /!\[The chart\]\(https:\/\/web\.archive\.org\/web\/2026\/chart\.png\)/);
});

test("a banner block is never also emitted inline (no doubling)", () => {
  const withBannerBlock = {
    ...ARTICLE, image: null,
    body: [{ type: "img", src: "https://web.archive.org/b.jpg", caption: "Lead", banner: true },
           { type: "p", tokens: ["Body."] }]
  };
  const m = NS.toMarkdown(withBannerBlock, opts);
  const hits = m.match(/!\[Lead\]\(https:\/\/web\.archive\.org\/b\.jpg\)/g) || [];
  assert.equal(hits.length, 1, "the lifted banner appears exactly once");
});

test("inline citations are superscript-style links to the snapshot, numbered in first-appearance order", () => {
  const m = md();
  assert.match(m, /The budget passed 7-2\.\[\[1\]\]\(https:\/\/web\.archive\.org\/web\/2026\/https:\/\/reuters\.com\/x\)/);
  assert.match(m, /got more money\.\[\[2\]\]\(https:\/\/example\.gov\/q2\)/);
});

test("toggling citations off drops the inline markers", () => {
  const m = md({ citations: false });
  assert.ok(!/\[\[1\]\]/.test(m), "no inline markers");
  assert.match(m, /The budget passed 7-2\./); // the claim text itself stays
});

test("the Sources list is numbered, labelled outlet — title, and linked", () => {
  const m = md();
  assert.match(m, /## Sources/);
  assert.match(m, /1\. \[Reuters — City budget passes\]\(https:\/\/web\.archive\.org\/web\/2026\/https:\/\/reuters\.com\/x\)/);
  assert.match(m, /2\. \[Gov data — Q2 filings\]\(https:\/\/example\.gov\/q2\)/);
  assert.match(m, /archived 2026-06-01/);
});

test("toggling the Sources list off removes the section", () => {
  assert.ok(!/## Sources/.test(md({ sourcesList: false })));
});

test("lists, pull quotes, embeds and code fences serialize", () => {
  const m = md();
  assert.match(m, /^- Roads funded$/m);
  assert.match(m, /^- Parks got more money\.\[\[2\]\]\(https:\/\/example\.gov\/q2\)$/m);
  assert.match(m, /^> A historic vote\.$/m);
  assert.match(m, /^> — Mayor$/m);
  assert.match(m, /^https:\/\/youtube\.com\/watch\?v=abc$/m); // bare URL → Substack auto-embeds
  assert.match(m, /```\nlet x = 1;\n```/);
});

test("omitTitle drops the title/subtitle block (Substack's own fields) but keeps the body", () => {
  const m = md({ omitTitle: true });
  assert.ok(!/^# City passes budget$/m.test(m), "no H1 title");
  assert.match(m, /## What changed/, "body still present");
});

test("HTML output is paste-ready: real tags, image figure, sup links and a Sources ol", () => {
  const h = html();
  assert.match(h, /<h1>City passes budget<\/h1>/);
  assert.match(h, /<em>After a long debate\.<\/em>/);
  assert.match(h, /<figure><img src="https:\/\/web\.archive\.org\/web\/2026\/banner\.jpg" alt="City hall"><figcaption>City hall<\/figcaption><\/figure>/);
  assert.match(h, /<sup><a href="https:\/\/web\.archive\.org\/web\/2026\/https:\/\/reuters\.com\/x">1<\/a><\/sup>/);
  assert.match(h, /<blockquote><p>A historic vote\.<\/p><p>— Mayor<\/p><\/blockquote>/);
  assert.match(h, /<h2>Sources<\/h2>\n<ol>/);
});

test("HTML escapes angle brackets and ampersands in text", () => {
  const a = { headline: "A & B <tag>", body: [{ type: "p", tokens: ["x < y & z"] }] };
  const h = NS.toHtml(a, opts);
  assert.match(h, /<h1>A &amp; B &lt;tag&gt;<\/h1>/);
  assert.match(h, /<p>x &lt; y &amp; z<\/p>/);
});

test("non-public image URLs (mxc:/blob:) are dropped — Substack can't fetch them", () => {
  const a = { headline: "T", body: [{ type: "img", src: "mxc://hs/abc", caption: "secret" }] };
  assert.ok(!/secret/.test(NS.toMarkdown(a, opts)));
  assert.ok(!/<img/.test(NS.toHtml(a, opts)));
});

test("filename derives from the slug", () => {
  assert.equal(NS.filename(ARTICLE), "city-budget.md");
  assert.equal(NS.filename({ headline: "Hello, World!" }), "hello-world.md");
  assert.equal(NS.filename({}), "article.md");
});

test("a claim with two sources gets both numbers, each linked", () => {
  const a = { headline: "T", body: [{ type: "p", tokens: [{ c: "Both back this.", src: ["s1", "s2"], id: "c" }] }] };
  assert.match(NS.toMarkdown(a, opts), /Both back this\.\[\[1\]\]\([^)]+\)\[\[2\]\]\([^)]+\)/);
  assert.match(NS.toHtml(a, opts), /<sup><a href="[^"]+">1<\/a>,<a href="[^"]+">2<\/a><\/sup>/);
});
