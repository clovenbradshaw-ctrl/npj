/* preview-fold.test.js — the "preview stays in sync with the editor" invariants.
 *
 * The editor's Preview (the reader's renderer in `preview` mode) draws the SAME
 * block model the publish pipeline produces — htmlToBlocks(html, { preview }) — so
 * any drift between the editor and the preview is a fold bug, not a renderer bug.
 * Two such drifts have bitten before; these guard them:
 *
 *   • A not-yet-uploaded photo lives only as a session data: URL on the live
 *     <image-slot>. It MUST survive the fold under { preview:true } (flagged
 *     local, so the preview shows what the author placed and badges it), and MUST
 *     be dropped on the real publish (no preview flag → no data: bytes committed).
 *   • A <figure>/<image-slot> the browser nested inside a bare contentEditable
 *     <div> must survive the fold — the old fold walked only top-level children
 *     and silently dropped it (6 photos in, 4 out).
 *
 * No jsdom — htmlToBlocks parses via document.createElement+innerHTML, so we feed
 * it a tiny faithful node tree through a createElement shim. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

// minimal faithful DOM — just what htmlToBlocks' figure/div walk reads
function el(tag, attrs, kids) {
  attrs = attrs || {}; kids = kids || [];
  const cls = String(attrs.class || "").split(/\s+/).filter(Boolean);
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids,
    classList: { contains: (c) => cls.includes(c) },
    getAttribute: (k) => (attrs[k] == null ? null : attrs[k]),
    hasAttribute: (k) => attrs[k] != null,
    get textContent() { return kids.map((k) => k.textContent || "").join(""); },
  };
  const walk = (n, acc) => { (n.childNodes || []).forEach((c) => { if (c.nodeType === 1) { acc.push(c); walk(c, acc); } }); return acc; };
  node.querySelectorAll = (sel) => {
    const all = walk(node, []);
    if (sel === "image-slot") return all.filter((n) => n.tagName === "IMAGE-SLOT");
    if (sel === ".cmp-slide") return all.filter((n) => n.classList.contains("cmp-slide"));
    return [];
  };
  node.querySelector = (sel) => {
    const all = walk(node, []);
    if (sel.indexOf("image-slot") === 0) return all.find((n) => n.tagName === "IMAGE-SLOT") || null;
    if (sel === "img") return all.find((n) => n.tagName === "IMG") || null;
    return null; // captions/credit/desc not exercised here
  };
  return node;
}
const slot = (src) => el("image-slot", { src });
const figure = (src) => el("figure", {}, [slot(src)]);

function fold(children, opts) {
  const root = { childNodes: children, set innerHTML(_) {} };
  const savedDoc = global.document, savedWin = global.window;
  global.document = { createElement: () => root };
  // archive URLs are publishable; data:/mxc are not — mirrors NpjMedia/ArchiveCDN
  global.window = {
    NpjMedia: { isStoreUrl: (u) => /^mxc:/.test(u), isPublishable: (u) => /^https?:\/\//.test(u) },
    NpjArchiveCDN: { isMediaUrl: (u) => /archive\.org/.test(u) },
  };
  try { return A.htmlToBlocks("<x/>", opts).blocks; }
  finally { global.document = savedDoc; global.window = savedWin; }
}

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const ARCH_URL = "https://archive.org/download/npj-demo/photo.jpg";

test("a pending data: photo is KEPT in preview (flagged local)", () => {
  const blocks = fold([figure(DATA_URL)], { preview: true });
  const imgs = blocks.filter((b) => b.type === "img");
  assert.equal(imgs.length, 1, "the not-yet-uploaded photo shows in the preview");
  assert.equal(imgs[0].src, DATA_URL, "it renders from the live session data: URL");
  assert.equal(imgs[0].local, true, "flagged local so the preview can badge 'won't publish yet'");
});

test("a pending data: photo is DROPPED on the real publish (no preview flag)", () => {
  const blocks = fold([figure(DATA_URL)]); // publish path — no { preview }
  assert.equal(blocks.filter((b) => b.type === "img").length, 0, "no data: bytes ride into the committed record");
});

test("a durable archive photo survives BOTH preview and publish", () => {
  for (const opts of [{ preview: true }, undefined]) {
    const imgs = fold([figure(ARCH_URL)], opts).filter((b) => b.type === "img");
    assert.equal(imgs.length, 1, "the archived photo is always kept");
    assert.equal(imgs[0].src, ARCH_URL);
    assert.ok(!imgs[0].local, "a durable photo is never flagged local");
  }
});

test("a figure nested in a bare <div> survives the fold (no silent drop)", () => {
  // the browser wraps pasted/Enter-split content in a bare <div>; an inserted
  // figure can land inside one. The fold must recurse, not flatten it away.
  const blocks = fold([el("div", {}, [figure(ARCH_URL)])]);
  const imgs = blocks.filter((b) => b.type === "img");
  assert.equal(imgs.length, 1, "the nested figure is parsed in place, not dropped");
  assert.equal(imgs[0].src, ARCH_URL);
});
