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

test("an owned claim ({c, stance}) exports as plain prose — no footnote, no Sources entry", () => {
  // Owning a claim grounds it by the author's declaration, not a citation, so it
  // must travel as ordinary text: no superscript marker and nothing added to the
  // Sources list. (The reader's transparency lens is the only surface that tints
  // it.) Guards the new token shape against leaking a phantom citation on export.
  const owned = {
    ...ARTICLE, image: null,
    body: [{ type: "p", tokens: ["The mayor ", { c: "was evasive", stance: "analysis", id: "o1" }, " all night."] }]
  };
  const m = NS.toMarkdown(owned, opts);
  assert.match(m, /The mayor was evasive all night\./, "owned text rides as plain prose");
  assert.ok(!/was evasive\[\[/.test(m), "no inline footnote marker on an owned claim");
  const h = NS.toHtml(owned, opts);
  assert.match(h, /was evasive/, "owned text present in HTML");
  assert.ok(!/<sup/.test(h.split("Sources")[0]), "no superscript marker in the body for an owned claim");
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

test("filename derives from the slug, and takes an extension", () => {
  assert.equal(NS.filename(ARTICLE), "city-budget.md");
  assert.equal(NS.filename(ARTICLE, "html"), "city-budget.html");
  assert.equal(NS.filename({ headline: "Hello, World!" }), "hello-world.md");
  assert.equal(NS.filename({}), "article.md");
});

test("toHtmlDocument is a self-contained page with a copy button and the article", () => {
  const d = NS.toHtmlDocument(ARTICLE, opts);
  assert.match(d, /^<!doctype html>/);
  assert.match(d, /<title>City passes budget — for Substack<\/title>/);
  assert.match(d, /<style>[^]*<\/style>/);                       // styles are inlined (works offline)
  assert.match(d, /id="npj-copy-body"[^>]*>Copy article</);      // the one-click copy
  assert.match(d, /<script>[^]*ClipboardItem[^]*<\/script>/);    // and the script that powers it
});

test("toHtmlDocument keeps the title out of the copy region (Substack's own field)", () => {
  const d = NS.toHtmlDocument(ARTICLE, opts);
  // headline lives in #npj-meta; the body to copy lives in #npj-copy, after it
  const meta = d.indexOf('id="npj-meta"'), copy = d.indexOf('id="npj-copy"');
  assert.ok(meta > -1 && copy > meta, "meta block precedes the copy block");
  assert.match(d, /id="npj-meta">[^]*<h1>City passes budget<\/h1>/);
  // the body's heading + the lifted hero ride in the copy region
  assert.match(d, /id="npj-copy">[^]*<h2>What changed<\/h2>/);
  assert.match(d, /id="npj-copy">[^]*<img src="https:\/\/web\.archive\.org\/web\/2026\/banner\.jpg"/);
  // title & subtitle get their own copy chips
  assert.match(d, /data-copy-text="City passes budget"/);
  assert.match(d, /data-copy-text="After a long debate\."/);
});

test("toHtmlDocument escapes the headline in <title> and the copy-title chip", () => {
  const d = NS.toHtmlDocument({ headline: 'A & B <tag>', body: [] }, opts);
  assert.match(d, /<title>A &amp; B &lt;tag&gt; — for Substack<\/title>/);
  assert.match(d, /data-copy-text="A &amp; B &lt;tag&gt;"/);
});

test("a claim with two sources gets both numbers, each linked", () => {
  const a = { headline: "T", body: [{ type: "p", tokens: [{ c: "Both back this.", src: ["s1", "s2"], id: "c" }] }] };
  assert.match(NS.toMarkdown(a, opts), /Both back this\.\[\[1\]\]\([^)]+\)\[\[2\]\]\([^)]+\)/);
  assert.match(NS.toHtml(a, opts), /<sup><a href="[^"]+">1<\/a>,<a href="[^"]+">2<\/a><\/sup>/);
});

test("footnotes: markers become real markdown refs and a [^key]: definitions block", () => {
  const a = { headline: "T", body: [
    { type: "p", tokens: ["A fact", { t: "sup", key: "fn1", num: 1, text: "1" }, " holds."] },
    { type: "footnotes", notes: [{ key: "fn1", num: 1, text: "See [the report](https://example.org/r)." }] }
  ] };
  const m = NS.toMarkdown(a, opts);
  assert.match(m, /A fact\[\^fn1\] holds\./);                       // inline reference
  assert.match(m, /^\[\^fn1\]: See \[the report\]\(https:\/\/example\.org\/r\)\.$/m); // definition
});

test("footnotes: HTML export keeps the number inline and an escaped Notes list", () => {
  // note text rides through creditHtml (markdown links resolve in the browser via
  // NpjProfiles; here we assert the structure + escaping, env-independent)
  const a = { headline: "T", body: [
    { type: "p", tokens: ["A fact", { t: "sup", key: "fn1", num: 1, text: "1" }, " holds."] },
    { type: "footnotes", notes: [{ key: "fn1", num: 1, text: "Per R&D <2026>." }] }
  ] };
  const h = NS.toHtml(a, opts);
  assert.match(h, /A fact<sup>1<\/sup> holds\./);
  assert.match(h, /<p><strong>Notes<\/strong><\/p><ol><li>Per R&amp;D &lt;2026&gt;\.<\/li><\/ol>/);
});

test("footnotes: a marker stranded in its own paragraph attaches to the text above, not a lone line", () => {
  // the bug: a <sup> alone in a <p> renders as a lone "1" on its own line. The
  // marker references a word, so it must fold onto the END of the paragraph above.
  const a = { headline: "T", body: [
    { type: "p", tokens: ['…in respect to "Tactical Urbanism."'] },
    { type: "p", tokens: [{ t: "sup", key: "fn1", num: 1, text: "1" }] },   // stranded
    { type: "p", tokens: ["None of the community benches…"] },
    { type: "footnotes", notes: [{ key: "fn1", num: 1, text: "Metro Legal correspondence." }] }
  ] };
  const h = NS.toHtml(a, opts);
  assert.match(h, /Tactical Urbanism\.&quot;<sup>1<\/sup><\/p>/, "marker sits inline at the end of the sentence");
  assert.ok(!/<p><sup>1<\/sup><\/p>/.test(h), "no lone-marker paragraph");
  const m = NS.toMarkdown(a, opts);
  assert.match(m, /Tactical Urbanism\.\"\[\^fn1\]/, "markdown reference rides with the sentence");
  assert.ok(!/^\[\^fn1\]$/m.test(m), "the reference is never alone on its own line");
});

test("mergeStrandedFootnotes is non-mutating and idempotent (shared body survives repeat export)", () => {
  const a = { headline: "T", body: [
    { type: "p", tokens: ["A fact."] },
    { type: "p", tokens: [{ t: "sup", key: "fn1", num: 1, text: "1" }] }
  ] };
  const before = JSON.stringify(a.body);
  // export twice on the SAME article — the second pass must not double the marker
  const h1 = NS.toHtml(a, opts), m1 = NS.toMarkdown(a, opts);
  const h2 = NS.toHtml(a, opts), m2 = NS.toMarkdown(a, opts);
  assert.equal(h1, h2); assert.equal(m1, m2);
  assert.ok(!/\[\^fn1\]\[\^fn1\]/.test(m1), "no duplicated reference");
  assert.equal(JSON.stringify(a.body), before, "the article body is never mutated");
});

test("mergeStrandedFootnotes leaves a well-formed body untouched", () => {
  const body = [
    { type: "p", tokens: ["A fact", { t: "sup", key: "fn1", num: 1, text: "1" }, " holds."] },
    { type: "footnotes", notes: [{ key: "fn1", num: 1, text: "n" }] }
  ];
  assert.deepEqual(NS.mergeStrandedFootnotes(body), body);
});

test("a stranded marker that DUPLICATES a real reference is dropped, not folded", () => {
  // the editor can clone a trailing marker onto its own line; that stray points at
  // the SAME note as the real one (a manual footnote key is unique per insertion).
  // Folding it would footnote the sentence above with someone else's note — drop it,
  // and leave the real reference exactly where it sits.
  const body = [
    { type: "p", tokens: ["Twenty-one benches stayed in place."] },
    { type: "p", tokens: [{ t: "sup", key: "fn19", num: 19, text: "19" }] },   // stray clone, alone on a line
    { type: "p", tokens: ["…supposed to have less red tape.", { t: "sup", key: "fn19", num: 19, text: "19" }] }, // real reference
    { type: "footnotes", notes: [{ key: "fn19", num: 19, text: "Metro red-tape note." }] }
  ];
  const merged = NS.mergeStrandedFootnotes(body);
  const benches = merged.find(b => b.type === "p" && b.tokens.some(t => typeof t === "string" && /Twenty-one/.test(t)));
  assert.ok(!benches.tokens.some(t => t && t.t === "sup"), "the sentence above the stray is not footnoted");
  const tape = merged.find(b => b.type === "p" && b.tokens.some(t => typeof t === "string" && /less red tape/.test(t)));
  assert.ok(tape.tokens.some(t => t && t.t === "sup" && t.key === "fn19"), "the real reference stays put");
  const marks = merged.flatMap(b => (b.tokens || []).filter(t => t && t.t === "sup" && t.key === "fn19"));
  assert.equal(marks.length, 1, "exactly one fn19 marker survives");
  // end to end: no lone-marker paragraph survives the export
  const a = { headline: "T", body };
  assert.ok(!/<p><sup>\d+<\/sup><\/p>/.test(NS.toHtml(a, opts)), "no lone-marker paragraph in the HTML");
  assert.ok(!/^\[\^fn19\]$/m.test(NS.toMarkdown(a, opts)), "no lone reference in the markdown");
});

test("two stray clones of one unique key fold just once (never duplicated)", () => {
  // a key never attached to text, cloned onto two lonely lines: keep a single
  // reference (folded onto the text above), drop the rest — the note isn't lost
  // and isn't doubled.
  const body = [
    { type: "p", tokens: ["A sentence that owns the note."] },
    { type: "p", tokens: [{ t: "sup", key: "fnX", num: 3, text: "3" }] },
    { type: "p", tokens: [{ t: "sup", key: "fnX", num: 3, text: "3" }] },
    { type: "footnotes", notes: [{ key: "fnX", num: 3, text: "Only note." }] }
  ];
  const merged = NS.mergeStrandedFootnotes(body);
  const marks = merged.flatMap(b => (b.tokens || []).filter(t => t && t.t === "sup" && t.key === "fnX"));
  assert.equal(marks.length, 1, "the note keeps exactly one reference");
  const owner = merged.find(b => b.type === "p" && b.tokens.some(t => typeof t === "string" && /owns the note/.test(t)));
  assert.ok(owner.tokens.some(t => t && t.t === "sup" && t.key === "fnX"), "the surviving reference folded onto the text above");
});

/* ---- the evidence: sources as footnotes that open the snapshot on the cited
   words (a Text Fragment, #:~:text=…), showing precisely what backs the claim ---- */
const EVID_SOURCES = {
  s1: { id: "s1", outlet: "Reuters", title: "Budget vote",
        archive_url: "https://web.archive.org/web/2026/https://reuters.com/b", retrieved: "2026-06-01" },
  s2: { id: "s2", outlet: "City", title: "Minutes",
        archive_url: "https://web.archive.org/web/2026/https://city.gov/m", retrieved: "2026-06-02" }
};
const EVID = {
  headline: "Budget",
  body: [{ type: "p", tokens: [
    { c: "The budget passed 7-2.", src: ["s1"], id: "c1", q: { s1: "passed seven to two" } }, " ",
    { c: "Parks got more.", src: ["s2"], id: "c2",
      q: { s2: "the parks department received an additional two million dollars in the final vote" } }
  ] }]
};
const eopts = { sources: EVID_SOURCES };

test("textFragment anchors short passages whole, long ones by first/last words, and escapes '-'", () => {
  assert.equal(NS.textFragment("passed seven to two"), ":~:text=passed%20seven%20to%20two");
  assert.equal(NS.textFragment("cost-of-living rose"), ":~:text=cost%2Dof%2Dliving%20rose");
  assert.equal(
    NS.textFragment("the parks department received an additional two million dollars in the final vote"),
    ":~:text=the%20parks%20department%20received%20an%20additional,in%20the%20final%20vote");
});

test("evidenceUrl deep-links a snapshot to the passage; no quote (or no snapshot) → bare/empty", () => {
  const src = { archive_url: "https://web.archive.org/web/2026/https://x.org/a" };
  assert.equal(NS.evidenceUrl(src, "passed seven to two"),
    "https://web.archive.org/web/2026/https://x.org/a#:~:text=passed%20seven%20to%20two");
  assert.equal(NS.evidenceUrl(src, ""), "https://web.archive.org/web/2026/https://x.org/a");
  assert.equal(NS.evidenceUrl({}, "x"), "");
});

test("inline citation markers deep-link to the snapshot on the cited words (HTML + markdown)", () => {
  const h = NS.toHtml(EVID, eopts);
  assert.match(h, /<sup><a href="https:\/\/web\.archive\.org\/web\/2026\/https:\/\/reuters\.com\/b#:~:text=passed%20seven%20to%20two">1<\/a><\/sup>/);
  // a long passage anchors by its ends, so the highlight survives mid-passage drift
  assert.match(h, /https:\/\/city\.gov\/m#:~:text=the%20parks%20department%20received%20an%20additional,in%20the%20final%20vote">2<\/a>/);
  const m = NS.toMarkdown(EVID, eopts);
  assert.match(m, /The budget passed 7-2\.\[\[1\]\]\(https:\/\/web\.archive\.org\/web\/2026\/https:\/\/reuters\.com\/b#:~:text=passed%20seven%20to%20two\)/);
});

test("the Sources footnote quotes each cited passage, each linked to the snapshot on those words", () => {
  const h = NS.toHtml(EVID, eopts);
  assert.match(h, /<li><a href="[^"]*reuters\.com\/b#:~:text=passed%20seven%20to%20two">Reuters — Budget vote<\/a> <em>\(archived 2026-06-01\)<\/em><br>“<a href="[^"]*reuters\.com\/b#:~:text=passed%20seven%20to%20two">passed seven to two<\/a>”<\/li>/);
  const m = NS.toMarkdown(EVID, eopts);
  assert.match(m, /^   - \[“passed seven to two”\]\(https:\/\/web\.archive\.org\/web\/2026\/https:\/\/reuters\.com\/b#:~:text=passed%20seven%20to%20two\)$/m);
});
