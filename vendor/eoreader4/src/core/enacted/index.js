// core/enacted — the enacted DEF·EVA·REC loop, the significance engine (the
// pure-engine half of the helix).
//
// It is faculty- and modality-agnostic: a pure forward loop over an injected
// read(cursor) → { surprise, terms }, with no perceiver, surfer, or enact-wiring in
// it (frame.js imports nothing; loop.js imports only frame). Like the derived null
// (voidnull) and the one surprise, the enacted loop is shared significance
// machinery — the perceiver's parse runs it to break a boundary frame, the surfer
// runs it over the reading, the predictor runs it over the move log — so it lives in
// the genome, not in any one faculty.
//
// The perceiver-facing WIRING (enactedReadingTo, which couples this engine to the
// perceiver's reading) stays in the enact/ faculty adapter, which imports this face.
// That keeps the dependency one-way: the engine knows nothing of the faculties; the
// adapter knows both. (Moving it here also dissolved a hidden perceiver⇄enact cycle
// — parse reached up into the loop while the enact wiring reached into the perceiver.)

export {
  createEnactedLoop, calibrateReader,
  DEFAULT_THRESHOLDS, DEFAULT_CONFIRM_BAND, DEFAULT_IMPULSE,
  DEFAULT_IMPULSE_QUANTILE, DEFAULT_REFRACTORY,
} from './loop.js';
export { createFrame, snapshotFrame, sameTerms, DEFAULT_STRAIN_LEAK } from './frame.js';
