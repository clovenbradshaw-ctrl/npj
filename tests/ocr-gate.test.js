/* ocr-gate.test.js — OCR is included in the published record only if the author
 * vouches for it. genesisFromContent withholds an image source's machine-read
 * (OCR) text AND every pinned OCR quote that cites it, unless the author turned
 * the source's reader display on (ocrShow, surfaced by NpjSourceView.
 * citedPassageVisible). A web/text source's selectable text is never touched.
 *
 * No jsdom: htmlToBlocks walks a tree fed through a createElement shim (the html
 * string is ignored; the pre-built childNodes are the truth). `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");
const SV = require("../app/source-view.js");

// ---- minimal faithful DOM: just what htmlToBlocks' walk reads ----
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
const claimSrc = (attrs, text) => enode("span", Object.assign({ class: "claim-src" }, attrs), [tnode(text)]);
const cite = (attrs, label) => enode("sup", Object.assign({ class: "md-cite" }, attrs), [tnode(label)]);

// build the preview article from a hand-built body tree + a source registry
function buildPreview(nodes, sources) {
  const root = { childNodes: nodes, set innerHTML(_) {} };
  const savedDoc = global.document, savedWin = global.window;
  global.document = { createElement: () => root };
  global.window = { NpjSourceView: SV, NPJ: { SOURCES: sources, CITATIONS: {} }, MatrixAuth: { current: () => null } };
  try {
    return A.genesisFromContent(
      { html: "<p>ignored — the shim feeds the real tree</p>", title: "T", tags: [], column: "", sources: {} },
      { slug: "t", headline: "T", preview: true }
    ).operand;
  } finally { global.document = savedDoc; global.window = savedWin; }
}
function bodyQuotes(op) {
  const out = [];
  const scan = (t) => { if (t && t.q) out.push(t.q); };
  (op.body || []).forEach((b) => { (b.tokens || []).forEach(scan); (b.items || []).forEach((it) => (it || []).forEach(scan)); (b.marks || []).forEach(scan); });
  return out;
}

const IMG = { id: "img-1", kind: "image", file_url: "https://store/a.jpg", text: "py oe NR EE DEPARTMENT garbled" };
const WEB = { id: "web-1", type: "data", original_url: "https://example.com/a", text: "real selectable words" };

test("a non-vouched image: OCR text + its pinned quote are both withheld", () => {
  const op = buildPreview([
    enode("p", {}, [claimSrc({ "data-src": "img-1", "data-cid": "c1", "data-quote": "py oe NR garbled" }, "The bench was painted."), cite({ "data-cite": "img-1", "data-cid": "c1", "data-quote": "py oe NR garbled" }, "1")]),
    enode("p", {}, [claimSrc({ "data-src": "web-1", "data-cid": "c2", "data-quote": "a real reported quote" }, "Reported elsewhere."), cite({ "data-cite": "web-1", "data-cid": "c2", "data-quote": "a real reported quote" }, "2")]),
  ], { "img-1": IMG, "web-1": WEB });

  assert.equal(op.sources["img-1"].text, "", "the image source ships without its OCR text");
  const qs = bodyQuotes(op);
  assert.ok(!qs.some((q) => "img-1" in q), "no body quote is keyed to the non-vouched image");
  assert.ok(qs.some((q) => q["web-1"] === "a real reported quote"), "the web source's real quote survives");
  // the claim still cites the image — only the quote is gone, the receipt remains
  const stillCites = (op.body || []).some((b) => (b.tokens || []).some((t) => t && t.src && t.src.includes("img-1")));
  assert.ok(stillCites, "the claim still cites the image source (the picture is the receipt)");
});

test("a vouched image (ocrShow): its OCR text and pinned quote are kept", () => {
  const op = buildPreview([
    enode("p", {}, [claimSrc({ "data-src": "img-9", "data-cid": "c9", "data-quote": "checked, reads true" }, "Per the sign."), cite({ "data-cite": "img-9", "data-cid": "c9", "data-quote": "checked, reads true" }, "1")]),
  ], { "img-9": { id: "img-9", kind: "image", ocrShow: true, file_url: "https://store/s.jpg", text: "checked, reads true" } });

  assert.equal(op.sources["img-9"].text, "checked, reads true", "a vouched image keeps its recognized text");
  assert.ok(bodyQuotes(op).some((q) => q["img-9"] === "checked, reads true"), "and keeps its pinned quote");
});
