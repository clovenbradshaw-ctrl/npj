/* gallery-fold.test.js — the carousel/gallery block round-trip in app/articles.js
 * (htmlToBlocks ⇄ blocksToHtml).
 *
 * A carousel is a single <figure class="cmp-carousel"> holding several
 * <div class="cmp-slide"> islands, each with its own editable image-slot +
 * caption/credit/description. The fold collects the filled slides into one
 * {type:'gallery', images:[…]} block; the reader renders it as a Splide
 * carousel + GLightbox. Empty slides (drop targets the author never used) are
 * dropped, and an all-empty carousel disappears entirely — same rule a lone
 * empty inline image follows.
 *
 * No jsdom (npj's zero-dep ethos): htmlToBlocks walks a real node tree, so we
 * feed it a faithful one through a createElement shim + a tiny CSS matcher that
 * covers exactly the selectors the fold uses (tag, .class, :not(.class), comma
 * groups). `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");

// ---- tiny faithful DOM ----------------------------------------------------
function parseGroup(sel) {
  const nots = [];
  sel = sel.replace(/:not\(\.([\w-]+)\)/g, (_, c) => { nots.push(c); return ""; });
  const tagM = sel.match(/^([\w-]+)/);
  const tag = tagM ? tagM[1].toLowerCase() : null;
  const classes = (sel.match(/\.([\w-]+)/g) || []).map((c) => c.slice(1));
  return { tag, classes, nots };
}
function matchGroup(node, g) {
  if (!node || node.nodeType !== 1) return false;
  if (g.tag && node.tagName.toLowerCase() !== g.tag) return false;
  for (const c of g.classes) if (!node.classList.contains(c)) return false;
  for (const c of g.nots) if (node.classList.contains(c)) return false;
  return true;
}
class El {
  constructor(tag, attrs, kids) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this._attrs = Object.assign({}, attrs || {});
    this.childNodes = (kids || []).map((k) => (typeof k === "string" ? { nodeType: 3, nodeValue: k, textContent: k } : k));
    const cls = String(this._attrs.class || "").split(/\s+/).filter(Boolean);
    this.classList = { contains: (c) => cls.includes(c) };
  }
  get textContent() { return this.childNodes.map((k) => (k.nodeType === 3 ? k.nodeValue : k.textContent)).join(""); }
  getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; }
  hasAttribute(k) { return this._attrs[k] != null; }
  _descendants() {
    const out = [];
    const walk = (n) => (n.childNodes || []).forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  querySelectorAll(sel) {
    const groups = sel.split(",").map((s) => parseGroup(s.trim()));
    return this._descendants().filter((n) => groups.some((g) => matchGroup(n, g)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const E = (tag, attrs, kids) => new El(tag, attrs, kids);

// run htmlToBlocks against a hand-built top-level node list, with the browser
// globals the figure fold reads (media-store + archive recognisers) stubbed.
function fold(topNodes) {
  const root = { childNodes: topNodes, set innerHTML(_) {} };
  const savedDoc = global.document, savedWin = global.window;
  global.document = { createElement: () => root };
  global.window = {
    NpjMedia: { isStoreUrl: (u) => /\/_matrix\/media\//.test(String(u || "")), isPublishable: () => true },
    NpjArchiveCDN: { isMediaUrl: (u) => /archive\.org|web\.archive/.test(String(u || "")) },
    NPJ: {},
  };
  try { return A.htmlToBlocks("<div>ignored — the shim feeds the real tree</div>").blocks; }
  finally { global.document = savedDoc; global.window = savedWin; }
}

// build one .cmp-slide island (image-slot + caption lines)
function slide(attrs, cap, credit, desc) {
  return E("div", { class: "cmp-slide" }, [
    E("image-slot", attrs, []),
    E("figcaption", { class: "cmp-cap np-mono" }, cap ? [cap] : []),
    E("figcaption", { class: "cmp-credit np-mono" }, credit ? [credit] : []),
    E("figcaption", { class: "cmp-desc np-mono" }, desc ? [desc] : []),
    E("span", { class: "cmp-slide-rm" }, ["✕"]),
  ]);
}
function carousel(slides, galCap) {
  return E("figure", { class: "cmp-embed cmp-carousel", "data-carousel": "1" }, [
    E("div", { class: "cmp-carousel-track" }, slides),
    E("span", { class: "cmp-carousel-add" }, ["+ Add image"]),
    E("figcaption", { class: "cmp-carousel-cap np-mono" }, galCap ? [galCap] : []),
  ]);
}

const ARCH_A = "https://archive.org/download/npj-x/a.webp";
const ARCH_B = "https://archive.org/download/npj-x/b.webp";
const STORE_C = "https://hs.example/_matrix/media/v3/download/hs/cccc";

test("fold collects filled carousel slides into one gallery block, in order", () => {
  const blocks = fold([carousel([
    slide({ src: ARCH_A }, "Cap A", "Jane Doe", "alt a"),
    slide({ src: ARCH_B }, "Cap B"),
  ], "The gallery caption")]);
  const gal = blocks.find((b) => b.type === "gallery");
  assert.ok(gal, "a gallery block is produced");
  assert.equal(gal.images.length, 2);
  assert.equal(gal.images[0].src, ARCH_A);
  assert.equal(gal.images[0].caption, "Cap A");
  assert.equal(gal.images[0].credit, "Jane Doe");
  assert.equal(gal.images[0].description, "alt a");
  assert.equal(gal.images[1].src, ARCH_B);
  assert.equal(gal.images[1].caption, "Cap B");
  assert.equal(gal.caption, "The gallery caption");
});

test("empty slides are skipped; an all-empty carousel drops out entirely", () => {
  const blocks = fold([carousel([
    slide({ src: ARCH_A }, "Only one"),
    slide({}, "", "", ""),            // never filled — no src
  ])]);
  const gal = blocks.find((b) => b.type === "gallery");
  assert.equal(gal.images.length, 1, "the empty slide is dropped");
  assert.equal(gal.images[0].src, ARCH_A);

  const empty = fold([carousel([slide({}, ""), slide({}, "")])]);
  assert.equal(empty.find((b) => b.type === "gallery"), undefined, "no images → no block");
});

test("a media-store slide keeps the archive src and carries the store URL as a fallback", () => {
  // blocksToHtml writes the live store copy as `src` and the durable archive
  // copy as `data-alt`; the fold must canonicalise archive as src + keep store.
  const blocks = fold([carousel([slide({ src: STORE_C, "data-alt": ARCH_A }, "C")])]);
  const im = blocks.find((b) => b.type === "gallery").images[0];
  assert.equal(im.src, ARCH_A, "archive.org wins as the durable src");
  assert.equal(im.store, STORE_C, "the media-store copy rides along as store");
});

test("blocksToHtml emits an editable carousel figure with one slot per image", () => {
  const html = A.blocksToHtml([{
    type: "gallery",
    images: [
      { src: ARCH_A, caption: "Cap A", credit: "Jane Doe", description: "alt a" },
      { src: ARCH_B },
    ],
    caption: "Gallery cap",
  }]);
  assert.match(html, /class="cmp-embed cmp-carousel"/);
  assert.match(html, /data-carousel="1"/);
  assert.equal((html.match(/<image-slot /g) || []).length, 2, "one slot per image");
  assert.match(html, /id="eo-car-0-0"/);
  assert.match(html, /id="eo-car-0-1"/);
  assert.match(html, /Cap A/);
  assert.match(html, /Jane Doe/);
  assert.match(html, /alt a/);
  assert.match(html, /cmp-carousel-cap[^>]*>Gallery cap</);
  assert.match(html, /cmp-carousel-add/);
});

test("round-trip: serialize a gallery, parse the same shape back, images survive", () => {
  const original = {
    type: "gallery",
    images: [
      { src: ARCH_A, caption: "First", credit: "A. Reporter", description: "a desc" },
      { src: ARCH_B, caption: "Second" },
    ],
    caption: "Trip",
  };
  // mirror blocksToHtml's structure as a faithful tree, then fold it back
  const slides = original.images.map((im) =>
    slide({ src: im.src }, im.caption || "", im.credit || "", im.description || ""));
  const back = fold([carousel(slides, original.caption)]).find((b) => b.type === "gallery");
  assert.deepEqual(back.images.map((i) => i.src), [ARCH_A, ARCH_B]);
  assert.deepEqual(back.images.map((i) => i.caption), ["First", "Second"]);
  assert.equal(back.images[0].credit, "A. Reporter");
  assert.equal(back.images[0].description, "a desc");
  assert.equal(back.caption, "Trip");
});
