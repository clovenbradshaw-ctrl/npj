/* evidence-needs.test.js — the negative-space classifier (app/grounding/evidence-needs.js).
 * The mechanical read (cues → an evidence type) is pure and tested here; the
 * optional local-LLM rung is exercised through a stub so no model or network is
 * touched. `node --test`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const EV = require("../app/grounding/evidence-needs.js");

test("a verbatim quotation asks for the source of the quoted words", () => {
  assert.equal(EV.classify('It said: "Please Don\'t Blow Up Our Library Again."').type, "quote");
  assert.match(EV.classify('It said: "Please Don\'t Blow Up Our Library Again."').label, /quoted words/);
});

test("suits and allegations ask for the official paper", () => {
  assert.equal(EV.classify("Travelers filed suit against NDP for gross negligence.").type, "legal");
  assert.match(EV.classify("Travelers filed suit against NDP for gross negligence.").label, /official document/);
});

test("votes, budgets and council action ask for the meeting/budget record", () => {
  assert.equal(EV.classify("The NDP budget was approved by the Metro Council.").type, "official");
});

test("a quoted/paraphrased speaker asks for the cited source on the record", () => {
  assert.equal(EV.classify("According to NDOT, the concrete spheres are public art.").type, "attribution");
});

test("bare numbers/counts ask for the underlying figures", () => {
  assert.equal(EV.classify("The agency quietly took 17 benches.").type, "figures");
});

test("a dated happening asks for a dated record", () => {
  assert.equal(EV.classify("Last year, public benches were pulled from the boulevard.").type, "dated");
});

test("a claim with no cues gets a generic 'a source that confirms this'", () => {
  const r = EV.classify("The role of the partnership remains unclear.");
  assert.equal(r.type, "general");
  assert.equal(r.label, "a source that confirms this");
});

test("needMany uses a custom LLM when one is set", async () => {
  EV.setLLM(async (claims) => claims.map((c, i) => "model type " + i));
  assert.deepEqual(await EV.needMany(["a", "b"]), ["model type 0", "model type 1"]);
  EV.setLLM(null);
});

test("needMany falls back to the mechanical read when the LLM yields null or a wrong-length list", async () => {
  EV.setLLM(async () => null);
  assert.match((await EV.needMany(["Travelers filed suit against NDP."]))[0], /official document/);
  EV.setLLM(async () => ["only-one"]);
  const out = await EV.needMany(["The council approved the budget.", "It took 17 benches."]);
  assert.equal(out.length, 2);
  assert.equal(out[0], EV.classify("The council approved the budget.").label);
  EV.setLLM(null);
});

test("a blank LLM answer for one claim falls back to that claim's mechanical read", async () => {
  EV.setLLM(async (claims) => claims.map(() => ""));
  const out = await EV.needMany(["Travelers filed suit against NDP."]);
  assert.match(out[0], /official document/);
  EV.setLLM(null);
});
