/* embed.test.js — URL → embeddable player (app/embed.js NpjEmbed) plus the
 * embed block's round trip through app/articles.js (blocksToHtml / htmlToBlocks).
 *
 * Covers the two services the newsroom needs to embed by link — a Google Drive
 * file and an archive.org upload — alongside the existing YouTube / Vimeo /
 * direct-media cases, and the regression that prompted it: a RAW <iframe> pasted
 * into the HTML source view used to be dropped by the text-only htmlToBlocks, so
 * it never reached preview or the published record. It must now fold to an embed.
 *
 * No jsdom — resolve()/innerHtml() are pure, and the htmlToBlocks walk reads a
 * tiny faithful node tree through a createElement shim (the no-build, zero-dep
 * test ethos shared with articles-fold.test.js). `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../app/embed.js");

// ---------------- resolve(): url → descriptor ----------------
test("resolve maps a Google Drive share/preview link to its /preview iframe", () => {
  const want = "https://drive.google.com/file/d/1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0/preview";
  for (const u of [
    "https://drive.google.com/file/d/1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0/preview",
    "https://drive.google.com/file/d/1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0/view?usp=sharing",
    "https://drive.google.com/open?id=1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0",
    "https://drive.google.com/uc?id=1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0&export=download",
  ]) {
    const r = E.resolve(u);
    assert.equal(r.kind, "drive", u);
    assert.equal(r.frame, true);
    assert.equal(r.panel, true, "Drive files size by height, not aspect");
    assert.equal(r.src, want, u);
  }
});

test("resolve maps an archive.org upload (details/embed/download) to /embed", () => {
  const want = "https://archive.org/embed/my-uploaded-item";
  for (const u of [
    "https://archive.org/details/my-uploaded-item",
    "https://archive.org/details/my-uploaded-item/page/n1",
    "https://archive.org/embed/my-uploaded-item",
    "https://archive.org/download/my-uploaded-item/file.pdf",
  ]) {
    const r = E.resolve(u);
    assert.equal(r.kind, "archive", u);
    assert.equal(r.panel, true);
    assert.equal(r.src, want, u);
  }
});

test("resolve keeps YouTube/Vimeo as 16:9 video players (no panel height)", () => {
  const yt = E.resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(yt.kind, "youtube");
  assert.equal(yt.aspect, "16 / 9");
  assert.ok(!yt.panel);
  assert.equal(yt.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  const vm = E.resolve("https://vimeo.com/76979871");
  assert.equal(vm.kind, "vimeo");
  assert.equal(vm.src, "https://player.vimeo.com/video/76979871");
});

test("resolve recognizes Google Docs/Sheets/Slides and direct media; unknown → null", () => {
  assert.equal(E.resolve("https://docs.google.com/document/d/ABC123/edit").src, "https://docs.google.com/document/d/ABC123/preview");
  assert.equal(E.resolve("https://docs.google.com/spreadsheets/d/XYZ/edit#gid=0").src, "https://docs.google.com/spreadsheets/d/XYZ/preview");
  assert.equal(E.resolve("https://cdn.example.com/clip.mp4").kind, "video");
  assert.equal(E.resolve("https://cdn.example.com/song.mp3").kind, "audio");
  assert.equal(E.resolve("https://example.com/an-article"), null);
});

// ---------------- innerHtml(): editor figure markup ----------------
test("innerHtml builds a Drive iframe honouring the author's height", () => {
  const html = E.innerHtml("https://drive.google.com/file/d/FILE/view", { height: 600 });
  assert.match(html, /<iframe /);
  assert.match(html, /src="https:\/\/drive\.google\.com\/file\/d\/FILE\/preview"/);
  assert.match(html, /height:600px/);
  assert.match(html, /allow="autoplay"/);
});

test("innerHtml falls back to a link for an unrecognized URL", () => {
  const html = E.innerHtml("https://example.com/page");
  assert.match(html, /^<a href="https:\/\/example\.com\/page"/);
  assert.match(html, />example\.com</);
});

// ---------------- articles.js round trip ----------------
// blocksToHtml + htmlToBlocks reach for window.NpjEmbed; in Node a bare `window`
// resolves to global.window, so install the real resolver there for the suite.
global.window = global.window || {};
global.window.NpjEmbed = E;
const A = require("../app/articles.js");

test("blocksToHtml renders an embed block as a live iframe figure", () => {
  const html = A.blocksToHtml([{ type: "embed", url: "https://archive.org/details/item", height: 480 }]);
  assert.match(html, /data-embed-url="https:\/\/archive\.org\/details\/item"/);
  assert.match(html, /data-embed-height="480"/);
  assert.match(html, /<iframe [^>]*src="https:\/\/archive\.org\/embed\/item"/);
});

// ---- htmlToBlocks: a RAW pasted <iframe> must fold to an embed block ----
const tnode = (s) => ({ nodeType: 3, nodeValue: s, textContent: s });
function enode(tag, attrs, kids) {
  attrs = attrs || {}; kids = kids || [];
  const cls = String(attrs.class || "").split(/\s+/).filter(Boolean);
  return {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids,
    get textContent() { return kids.map((k) => k.textContent).join(""); },
    classList: { contains: (c) => cls.includes(c) },
    getAttribute: (k) => (attrs[k] == null ? null : attrs[k]),
    hasAttribute: (k) => attrs[k] != null,
    querySelector: () => null, querySelectorAll: () => [],
  };
}
function foldTop(children) {
  const root = { childNodes: children, set innerHTML(_) {} };
  const saved = global.document;
  global.document = { createElement: () => root };
  try { return A.htmlToBlocks("<p>ignored — the shim feeds the real tree</p>").blocks; }
  finally { global.document = saved; }
}

test("htmlToBlocks folds a bare Google Drive <iframe> into an embed block", () => {
  const iframe = enode("iframe", {
    src: "https://drive.google.com/file/d/1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0/preview",
    width: "100%", height: "600", allow: "autoplay",
  }, []);
  const blocks = foldTop([iframe]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "embed");
  assert.equal(blocks[0].url, "https://drive.google.com/file/d/1amnJaRcaBO1Q3K_Exvf5Wyu9j8gGyKp0/preview");
  assert.equal(blocks[0].height, 600, "the iframe's height attribute rides along");
});

test("htmlToBlocks folds a bare archive.org <iframe> into an embed block", () => {
  const iframe = enode("iframe", { src: "https://archive.org/embed/my-item" }, []);
  const blocks = foldTop([iframe]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "embed");
  assert.equal(blocks[0].url, "https://archive.org/embed/my-item");
});
