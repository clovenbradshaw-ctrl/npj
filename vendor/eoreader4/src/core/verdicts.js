// The four-way verdict vocabulary — a pure enum, the genome's leaf.
//
// It lives in core, not in factcheck, because two holons now read it: the
// edge-grounding fact-checker (factcheck/correspond.js) types a talker claim to
// one of these, and the relation algebra (read/relation-types.js) returns one
// from its embedder-free symbolic check. `read` must stay a leaf — it may import
// *down* into core but never *up* into factcheck — so the shared vocabulary sinks
// to the layer both depend on. Same constants, one home, no cycle.
//
// A boolean is wrong here: absence has more than one cause and the causes are not
// the same verdict (edge-grounding §3). Contradicted is a hard refusal;
// unsupported is a strip-or-flag; indeterminate is held — the no-commit
// discipline at the verdict.
//
// OFF_DIAGONAL is the diagonal guard's verdict (core/cube.js `coherence`), orthogonal
// to the four grounding verdicts above: it does not ask whether a document edge
// witnesses the claim, it asks whether the claim's GRAIN matches the grain of the
// terrain the reading typed at the answer locus. A specific (Figure-grain) claim
// asserted where the reading measured an absence — a figure at a Void — is off the
// Object diagonal: the confabulation shape, "a Figure fix to a Ground problem".
export const VERDICTS = Object.freeze({
  CORROBORATED:  'corroborated',
  UNSUPPORTED:   'unsupported',
  CONTRADICTED:  'contradicted',
  INDETERMINATE: 'indeterminate',
  OFF_DIAGONAL:  'off_diagonal',
});
