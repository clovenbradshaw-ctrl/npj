/* sources-export.test.js — the source-packet shaper (app/export/sources-export.js).
 * Pure, no DOM: hand it a payload exactly like the Newsroom sources rail
 * assembles — { title, byline, items:[{ key, rec, quotes:[{quote, claim}], spans }] }
 * — and check the three outputs: markdown (the prompt path), JSON (the machine
 * path) and the self-contained HTML document. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const SE = require("../app/export/sources-export.js");

const PAYLOAD = {
  title: "Metro Removes More Benches",
  byline: "Dana Ryu",
  exported: "2026-07-01",
  items: [
    {
      key: "web-1",
      rec: {
        id: "web-1", title: "City quietly pulls seating from three parks", outlet: "Metro Ledger",
        original_url: "https://metroledger.example/benches", archive_url: "https://web.archive.org/web/2026/https://metroledger.example/benches",
        retrieved: "2026-06-28", text: "The city removed benches from three parks in June."
      },
      quotes: [
        { quote: "benches were removed from three parks", claim: "The city removed park benches last month." },
        { quote: "Benches   were removed from three parks", claim: "Three parks lost their seating." }, // same words, spacing/case differ
        { quote: "no public notice was posted", claim: "Residents got no warning." }
      ],
      spans: 3
    },
    {
      key: "doc-2",
      rec: { id: "doc-2", title: "Parks Dept. work order", filename: "work-order.pdf", retrieved: "2026-06-29" },
      quotes: [],
      spans: 0
    }
  ]
};

test("normalize numbers sources in order and dedupes quotes, merging the claims they back", () => {
  const P = SE.normalize(PAYLOAD);
  assert.equal(P.items.length, 2);
  assert.deepEqual(P.items.map(it => it.num), [1, 2]);
  const q = P.items[0].quotes;
  assert.equal(q.length, 2); // the case/spacing twin collapsed
  assert.deepEqual(q[0].claims, ["The city removed park benches last month.", "Three parks lost their seating."]);
});

test("kind labels: web source vs uploaded document vs conversation", () => {
  const P = SE.normalize(PAYLOAD);
  assert.equal(P.items[0].kind, "web source");
  assert.equal(P.items[1].kind, "uploaded document");
  assert.equal(SE.kindLabel({ type: "interview" }), "conversation");
  assert.equal(SE.kindLabel({ archive_url: "https://archive.org/details/some-item" }), "archive.org item");
});

test("evidenceUrl deep-links the snapshot to the cited words (Text Fragment)", () => {
  const u = SE.evidenceUrl(PAYLOAD.items[0].rec, "no public notice was posted");
  assert.ok(u.startsWith("https://web.archive.org/web/2026/"));
  assert.ok(u.includes("#:~:text="));
});

test("markdown carries the header, every source, its links, evidence and claims", () => {
  const md = SE.toMarkdown(PAYLOAD);
  assert.match(md, /^# Source packet — Metro Removes More Benches/);
  assert.ok(md.includes("By Dana Ryu"));
  assert.ok(md.includes("exported 2026-07-01"));
  assert.ok(md.includes("2 sources"));
  assert.ok(md.includes("## 1. City quietly pulls seating from three parks — Metro Ledger"));
  assert.ok(md.includes("## 2. Parks Dept. work order"));
  assert.ok(md.includes("- Original: <https://metroledger.example/benches>"));
  assert.ok(md.includes("- Archived: <https://web.archive.org/web/2026/https://metroledger.example/benches"));
  assert.ok(md.includes("“benches were removed from three parks”"));
  assert.ok(md.includes("  - backs: The city removed park benches last month."));
  assert.ok(md.includes("  - backs: Three parks lost their seating."));
  // the deduped twin appears once
  assert.equal((md.match(/benches were removed from three parks/gi) || []).length, 1);
  // extracted text rides along
  assert.ok(md.includes("The city removed benches from three parks in June."));
});

test("json is a versioned packet with per-quote evidence links", () => {
  const doc = JSON.parse(SE.toJson(PAYLOAD));
  assert.equal(doc.format, "npj/source-packet/1");
  assert.equal(doc.title, "Metro Removes More Benches");
  assert.equal(doc.sources.length, 2);
  const s1 = doc.sources[0];
  assert.equal(s1.num, 1);
  assert.equal(s1.key, "web-1");
  assert.equal(s1.evidence.length, 2);
  assert.deepEqual(s1.evidence[0].backs, ["The city removed park benches last month.", "Three parks lost their seating."]);
  assert.ok(s1.evidence[0].url.includes("#:~:text="));
  assert.equal(doc.sources[1].evidence.length, 0);
});

test("the html document is self-contained and escapes what it prints", () => {
  const html = SE.toHtmlDocument({
    title: 'A "quoted" <title>',
    exported: "2026-07-01",
    items: [{ key: "k", rec: { id: "k", title: "Src & <co>", original_url: "https://x.example/a?b=1&c=2", text: "body <script> text" }, quotes: [{ quote: "a & b", claim: "c < d" }], spans: 1 }]
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Copy as Markdown"));
  assert.ok(html.includes("Src &amp; &lt;co&gt;"));
  assert.ok(html.includes("https://x.example/a?b=1&amp;c=2"));
  assert.ok(html.includes("backs: c &lt; d"));
  // the raw <script> inside the extracted text never lands unescaped in the
  // VISIBLE document (the markdown twin below is raw text by design)
  const visible = html.split('<script type="text/plain" id="npj-md">')[0];
  assert.ok(!visible.includes("body <script>"));
  assert.ok(visible.includes("body &lt;script&gt; text"));
  // the embedded markdown twin can't close its own script tag early
  const mdBlock = html.split('<script type="text/plain" id="npj-md">')[1].split("</script>")[0];
  assert.ok(!/<\/script/i.test(mdBlock));
  assert.ok(mdBlock.includes("body <script> text")); // the copied markdown stays faithful
});

test("an empty packet still renders honestly", () => {
  const md = SE.toMarkdown({ title: "Bare", exported: "2026-07-01", items: [] });
  assert.ok(md.includes("No sources bound to this draft yet"));
  const html = SE.toHtmlDocument({ title: "Bare", exported: "2026-07-01", items: [] });
  assert.ok(html.includes("No sources bound to this draft yet"));
});

test("summary counts sources, deduped quotes and archived snapshots", () => {
  assert.deepEqual(SE.summary(PAYLOAD), { sources: 2, quotes: 2, archived: 1 });
});

test("filename slugs the draft title", () => {
  assert.equal(SE.filename(PAYLOAD, "html"), "metro-removes-more-benches-sources.html");
  assert.equal(SE.filename({ title: "" }, "json"), "draft-sources.json");
});
