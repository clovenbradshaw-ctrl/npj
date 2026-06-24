/* changelog.test.js — the edit log's revert engine (app/articles.js).
 *
 * A document is an append-only log of EO events; foldLog replays them into the
 * current article + a per-version history. A REVERT is not a delete or a rewrite
 * — it is one more REC event that re-asserts an earlier version's folded snapshot
 * (snapshotOperand / revertOperand). Undo-a-revert is the same move aimed at the
 * version the revert replaced. These tests fold real logs and assert the restore
 * is exact, that publish-state rides along, that the access list never does, and
 * that a revert event carries nothing the leakage gate forbids. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/articles.js");

const ACTOR = "@reporter:hyphae.social";
const FORBIDDEN = ["slots", "sections", "structure", "appliedTypeId", "parentSlotId", "typeSlotKey", "structureLog"];

const P = (t) => ({ type: "p", tokens: [t] });
const join = (...lines) => lines.join("\n");

// a small document with two edits on top of the publish
function baseLog() {
  const v1 = {
    slug: "benches", headline: "First headline", dek: "first dek", column: "Latest",
    tags: ["a"], authors: [ACTOR], assignees: [ACTOR], published: "2026-06-19",
    body: [P("The original sentence."), P("A second sentence.")], sources: {}
  };
  const v2 = { headline: "Second headline", body: [P("The original sentence."), P("A rewritten and longer second sentence here.")] };
  return {
    v1,
    log: join(A.genesisLine(v1, ACTOR), A.editLine("benches", v2, ACTOR, "tighten the lede")),
  };
}

test("foldLog gives each version an op, a snapshot, and a null revert by default", () => {
  const { log } = baseLog();
  const f = A.foldLog(log);
  assert.equal(f.versions.length, 2);
  assert.deepEqual(f.versions.map(v => v.op), ["REC", "INS"]); // newest first
  assert.ok(f.versions[0].snapshot && f.versions[1].snapshot);
  assert.equal(f.versions[0].snapshot.headline, "Second headline");
  assert.equal(f.versions[1].snapshot.headline, "First headline");
  assert.equal(f.versions[0].revert, null);
});

test("snapshotOperand restores content + an explicit status, but never the access list", () => {
  const { log } = baseLog();
  const v1snap = A.foldLog(log).versions[1].snapshot; // the INS
  const o = A.snapshotOperand(v1snap);
  assert.equal(o.headline, "First headline");
  assert.deepEqual(o.body, [P("The original sentence."), P("A second sentence.")]);
  assert.equal(o.status, "published");          // explicit, so a revert can republish
  assert.ok(!("assignees" in o));                // access control is never reverted
  assert.ok(!FORBIDDEN.some(k => k in o));        // nothing the leakage gate forbids
});

test("revert restores an earlier version exactly and marks itself a revert", () => {
  const { v1, log } = baseLog();
  const f = A.foldLog(log);
  const target = f.versions[1];                   // revert to the original publish
  const operand = A.revertOperand(target.snapshot, { to: target.sha, ts: target.ts });
  const f2 = A.foldLog(join(log, A.editLine("benches", operand, ACTOR, "Reverted to v." + target.sha)));

  assert.equal(f2.article.headline, "First headline");
  assert.deepEqual(f2.article.body, v1.body);     // body byte-for-byte restored
  assert.equal(f2.versions.length, 3);
  assert.equal(f2.versions[0].op, "REC");
  assert.equal(f2.versions[0].revert.to, target.sha);
  assert.equal(f2.versions[0].revert.undo, false);
});

test("undo-revert is the same move aimed at the version the revert replaced", () => {
  const { log } = baseLog();
  const f = A.foldLog(log);
  const original = f.versions[1];
  // 1) revert to the original
  const revOp = A.revertOperand(original.snapshot, { to: original.sha, ts: original.ts });
  const log2 = join(log, A.editLine("benches", revOp, ACTOR, "Reverted"));
  const f2 = A.foldLog(log2);
  // the pre-revert state is now versions[1] (the "Second headline" edit)
  const preRevert = f2.versions[1];
  assert.equal(preRevert.snapshot.headline, "Second headline");
  // 2) undo: revert to the pre-revert version
  const undoOp = A.revertOperand(preRevert.snapshot, { to: preRevert.sha, ts: preRevert.ts, undo: true });
  const f3 = A.foldLog(join(log2, A.editLine("benches", undoOp, ACTOR, "Undid revert")));

  assert.equal(f3.article.headline, "Second headline");     // back to where we were
  assert.deepEqual(f3.article.body, A.foldLog(log).article.body);
  assert.equal(f3.versions[0].revert.undo, true);
});

test("reverting to a then-live version republishes a now-hidden document", () => {
  const v1 = { slug: "x", headline: "Live piece", dek: "", body: [P("Body.")], authors: [ACTOR], assignees: [ACTOR], published: "2026-06-19", sources: {} };
  const log = join(
    A.genesisLine(v1, ACTOR),
    A.editLine("x", { status: "unpublished" }, ACTOR, "Unpublished")
  );
  const f = A.foldLog(log);
  assert.equal(f.article.status, "unpublished");
  const live = f.versions[f.versions.length - 1];           // the INS, implicitly published
  const op = A.revertOperand(live.snapshot, { to: live.sha, ts: live.ts });
  const f2 = A.foldLog(join(log, A.editLine("x", op, ACTOR, "Reverted")));
  assert.equal(f2.article.status, "published");             // status rode along
});

test("reverting an edit that added an assignee leaves the access list intact", () => {
  const OTHER = "@editor:hyphae.social";
  const v1 = { slug: "y", headline: "Y", dek: "", body: [P("One.")], authors: [ACTOR], assignees: [ACTOR], published: "2026-06-19", sources: {} };
  const log = join(
    A.genesisLine(v1, ACTOR),
    A.editLine("y", { assignees: [ACTOR, OTHER], body: [P("One. Two.")] }, OTHER, "add editor + extend")
  );
  const f = A.foldLog(log);
  assert.deepEqual(f.article.assignees, [ACTOR, OTHER]);
  const op = A.revertOperand(f.versions[1].snapshot, { to: f.versions[1].sha, ts: f.versions[1].ts });
  const f2 = A.foldLog(join(log, A.editLine("y", op, ACTOR, "Reverted body")));
  assert.deepEqual(f2.article.body, [P("One.")]);            // content reverted
  assert.deepEqual(f2.article.assignees, [ACTOR, OTHER]);    // but the editor keeps access
});
