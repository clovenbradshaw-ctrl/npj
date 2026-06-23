/* fact-check-export.test.js — the ungrounded-claims → worksheet serializers
 * (app/fact-check-export.js). Pure shaping, no DOM: we hand toMarkdown/toCsv a
 * snapshot of the draft's blockers (⊥ needs a source, ¬ sources disagree)
 * exactly like the one GroundingWorkspace assembles, and check the bits a
 * colleague needs — the claim quoted, its stable ref, the context paragraph,
 * blank fields to fill, the disagreeing pins on a conflict, and the toggles.
 * `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const FC = require("../app/fact-check-export.js");

const PAYLOAD = {
  title: "City budget probe",
  generatedAt: Date.UTC(2026, 5, 23), // 2026-06-23
  items: [
    { sid: "sn-aaa", text: "The mayor took $40,000 in gifts.", status: "needs",
      before: "The council met Tuesday.", after: "He denies wrongdoing." },
    { sid: "sn-bbb", text: "Turnout was 12 percent.", status: "conflict", before: "", after: "",
      cites: [ { source: "County clerk", quote: "Turnout: 12%", url: "https://ex.gov/a" },
               { source: "Local paper", quote: "just 9 percent voted", url: "https://news/b" } ] },
    { sid: "sn-ccc", text: 'She said, "I won\'t run again."', status: "needs", before: "", after: "" }
  ],
  sources: [
    { title: "County clerk", url: "https://ex.gov/a", archived: true },
    { title: "Local paper", url: "https://news/b", archived: false }
  ]
};
const md = (o) => FC.toMarkdown(PAYLOAD, o);
const csv = (o) => FC.toCsv(PAYLOAD, o);

test("markdown carries the title, the export date and a tally", () => {
  const m = md();
  assert.match(m, /^# Fact-check request — City budget probe$/m);
  assert.match(m, /2 claims need a source · 1 where sources disagree/);
  assert.match(m, /exported 2026-06-23/);
});

test("each claim is quoted, headed by its status, and tagged with its stable ref", () => {
  const m = md();
  assert.match(m, /### Claim 1 — ⊥ needs a source {2}· {2}ref `sn-aaa`/);
  assert.match(m, /^> The mayor took \$40,000 in gifts\.$/m);
  assert.match(m, /ref `sn-bbb`/);
  assert.match(m, /ref `sn-ccc`/);
});

test("a needs-a-source claim gets blank Source / It says / Verdict / Notes fields", () => {
  const m = md();
  assert.match(m, /\*\*Source \(link\):\*\*/);
  assert.match(m, /\*\*It says \(quote\):\*\*/);
  assert.match(m, /\*\*Verdict\*\*/);
  assert.match(m, /\*\*Notes:\*\*/);
});

test("the context paragraph frames the claim with «», only when there is context", () => {
  const m = md();
  assert.match(m, /\*\*Where it sits:\*\* …The council met Tuesday\. «The mayor took \$40,000 in gifts\.» He denies wrongdoing\.…/);
  // sn-ccc has no neighbours → no "Where it sits" line is forced for it
  assert.equal((m.match(/Where it sits/g) || []).length, 1);
});

test("a conflict lists the disagreeing pinned sources and asks which is right", () => {
  const m = md();
  assert.match(m, /### Claim 2 — ¬ sources disagree/);
  assert.match(m, /Two sources already pinned to this claim disagree:/);
  assert.match(m, /“Turnout: 12%” — County clerk \(https:\/\/ex\.gov\/a\)/);
  assert.match(m, /“just 9 percent voted” — Local paper \(https:\/\/news\/b\)/);
  assert.match(m, /\*\*Which is right\?\*\*/);
  assert.match(m, /\*\*Tie-breaking source \(link\):\*\*/);
});

test("conflicts:false drops the conflict claims and renumbers with no gaps", () => {
  const m = md({ conflicts: false });
  assert.doesNotMatch(m, /sources disagree/);
  assert.doesNotMatch(m, /sn-bbb/);
  assert.match(m, /### Claim 2 — ⊥ needs a source {2}· {2}ref `sn-ccc`/);
  assert.doesNotMatch(m, /### Claim 3/);
});

test("context:false omits the Where-it-sits line", () => {
  assert.doesNotMatch(md({ context: false }), /Where it sits/);
});

test("the consulted-sources footer lists draft sources with their archive state, and is toggleable", () => {
  const m = md();
  assert.match(m, /## Sources already in this draft/);
  assert.match(m, /1\. County clerk — https:\/\/ex\.gov\/a {2}_\(archived\)_/);
  assert.match(m, /2\. Local paper — https:\/\/news\/b {2}_\(not archived\)_/);
  assert.doesNotMatch(md({ consulted: false }), /Sources already in this draft/);
});

test("an all-grounded draft exports a friendly nothing-to-check note, no crash", () => {
  const m = FC.toMarkdown({ title: "Clean", items: [] });
  assert.match(m, /nothing here to check/);
  assert.doesNotMatch(m, /### Claim/);
});

test("CSV is a header plus one row per claim, with the blanks the checker fills", () => {
  const c = csv();
  const lines = c.split("\r\n").filter(Boolean);
  assert.equal(lines.length, 4); // header + 3 claims
  assert.ok(lines[0].startsWith('"Ref","Status","Claim","Where it sits","Sources already pinned","Source found (link)","It says (quote)","Verdict","Notes"'));
});

test("CSV escapes embedded quotes by doubling them (RFC 4180)", () => {
  assert.ok(csv().includes('"She said, ""I won\'t run again."""'));
});

test("CSV folds a conflict's disagreeing pins into one cell", () => {
  const c = csv();
  assert.ok(c.includes("“Turnout: 12%” — County clerk (https://ex.gov/a) | “just 9 percent voted” — Local paper (https://news/b)"));
});

test("CSV omits the context column when context:false", () => {
  assert.ok(!csv({ context: false }).split("\r\n")[0].includes("Where it sits"));
});

test("summary counts the blockers and honours the conflicts toggle", () => {
  assert.deepEqual(FC.summary(PAYLOAD), { needs: 2, conflict: 1, total: 3 });
  assert.deepEqual(FC.summary(PAYLOAD, { conflicts: false }), { needs: 2, conflict: 0, total: 2 });
});

test("filename slugs the title", () => {
  assert.equal(FC.filename(PAYLOAD, "md"), "city-budget-probe-factcheck.md");
  assert.equal(FC.filename({ title: "" }, "csv"), "draft-factcheck.csv");
});
