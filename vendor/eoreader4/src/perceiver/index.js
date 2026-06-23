// perceiver — the PERCEIVER faculty (add-on 2 §A): Existence · constitute. It
// brings the reading into being, constituting structure from the unit stream — the
// first of the cognition triad (perceiver → surfer → enactor), the one the surfer
// then navigates. The three levels of reading and the consciousness that folds them.
// Pure on (doc, cursor/spans); no model in the loop.
//
// The dependency runs ONE way: the surfer rides the perceiver's reading, so this
// face exposes only the perceiver's own currency and reaches into no other faculty.
// Surfing, answerability, sequence/motion readings are the surfer's — import them
// from the surfer's face, not here.
//
//   existenceSurface     level 1 — raw text
//   structureSurface     level 2 — the extracted SEG/CON/SIG/SYN graph
//   significanceSurface  level 3 — prediction + surprise (reading mode)
//   consciousness        the integration the enactor reads
//   readingAt            significance at a single cursor (UI reading mode)

export {
  existenceSurface, structureSurface, figureSurface, namedReferents,
  significanceSurface, consciousness, serializeNotes,
  composeGroupedNote, NOTE_GROUPS, plainRel,
} from './surfaces.js';
export { readingAt } from './reading.js';
export { predictNext } from './predict.js';
export { mutualNearestPairs, discoverEquivalences } from './equivalence.js';
export { siteRoles, markSites, siteIndices } from './site.js';
export { referentialConfidence, REFERENT_MARGIN } from './referent.js';
