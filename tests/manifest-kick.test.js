/* manifest-kick.test.js — the version-bump "kick" + the front-index drop.
 *
 * The site's published line-up is a VALIDATED manifest on archive.org. When the
 * schema version is bumped, a manifest stamped with an older version must be
 * DISTRUSTED on read, so a stale line-up carrying junk/removed pieces stops
 * painting the front page. And once a fresh (possibly empty) manifest is
 * written, the raw archive tag-search must NOT resurface what was dropped — a
 * present manifest is authoritative. These guard the pure pieces. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/record/articles.js");

test("buildManifest stamps the CURRENT schema version", () => {
  const m = A.buildManifest([{ slug: "real", headline: "Real" }]);
  assert.equal(m.v, "npj/site-manifest/2", "the bumped version is what new manifests carry");
});

test("dropFromFront removes a slug and promotes the next piece to lead", () => {
  // dropFromFront reads window.NPJ.FRONT; stand up a minimal global for node.
  const prevWin = globalThis.window;
  globalThis.window = globalThis;
  globalThis.NPJ = { FRONT: {
    lead: { slug: "junk-1", headline: "Junk 1" },
    secondary: [
      { slug: "junk-2", headline: "Junk 2" },
      { slug: "real", headline: "Real piece" }
    ]
  } };
  try {
    A.dropFromFront(["junk-1", "junk-2"]);
    const F = globalThis.NPJ.FRONT;
    assert.equal(F.lead.slug, "real", "the surviving piece is promoted to lead");
    assert.equal(F.secondary.length, 0, "no junk left in the secondary line-up");

    // removing the last piece leaves an empty, junk-free front index
    A.dropFromFront("real");
    assert.equal(globalThis.NPJ.FRONT.lead, null, "lead clears when nothing survives");
    assert.equal(globalThis.NPJ.FRONT.secondary.length, 0);
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
    delete globalThis.NPJ;
  }
});
