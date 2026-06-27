/* editor-credit.test.js — the "Edited by" byline credit (app/record/articles.js
 * genesisFromContent → operand.editors).
 *
 * Editors are an outward-facing CREDIT, not access control (assignees gate who
 * may edit). So unlike authors — which stay Matrix-id-only so attribution always
 * resolves to an account — an editor may be listed by a plain NAME for someone
 * with no Matrix account, OR by a Matrix id. genesisFromContent normalises the
 * list: trim + collapse whitespace, drop empties, clamp each to 80 chars, cap the
 * count. This test pins that behaviour so a typed name survives onto the record.
 *
 * htmlToBlocks parses via document.createElement+innerHTML; an empty document
 * shim is enough since we pass no body. No jsdom — matches npj's zero-dep ethos.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

// Build a genesis from empty content with the given options, returning its operand.
function genesisOperand(opts) {
  const savedDoc = global.document, savedWin = global.window;
  global.document = { createElement: () => ({ set innerHTML(_) {}, childNodes: [] }) };
  global.window = { NPJ: { SOURCES: {} } };
  try { return A.genesisFromContent({ html: "" }, opts).operand; }
  finally { global.document = savedDoc; global.window = savedWin; }
}

test("an editor listed by a plain NAME survives onto the record", () => {
  const op = genesisOperand({ actor: "@me:server", editors: ["Jane Doe"] });
  assert.deepEqual(op.editors, ["Jane Doe"], "the typed name is kept verbatim — no mxid filter drops it");
});

test("editors accept a mix of plain names and Matrix ids, in order", () => {
  const op = genesisOperand({ actor: "@me:server", editors: ["Jane Doe", "@ed:server", "John Smith"] });
  assert.deepEqual(op.editors, ["Jane Doe", "@ed:server", "John Smith"]);
});

test("editor credits are trimmed, whitespace-collapsed, and emptied entries dropped", () => {
  const op = genesisOperand({ actor: "@me:server", editors: ["  Jane   Doe  ", "", "   ", "\tJohn Smith"] });
  assert.deepEqual(op.editors, ["Jane Doe", "John Smith"]);
});

test("each editor credit is clamped to 80 chars and the list is capped at 16", () => {
  const long = "x".repeat(200);
  const many = Array.from({ length: 30 }, (_, i) => "Editor " + i);
  assert.equal(genesisOperand({ actor: "@me:server", editors: [long] }).editors[0].length, 80);
  assert.equal(genesisOperand({ actor: "@me:server", editors: many }).editors.length, 16);
});

test("authors stay Matrix-id-only — a plain name is NOT accepted as an author", () => {
  const op = genesisOperand({ actor: "@me:server", authors: ["Jane Doe", "@real:server"] });
  assert.deepEqual(op.authors, ["@real:server"], "only the valid mxid survives as a credited author");
});
