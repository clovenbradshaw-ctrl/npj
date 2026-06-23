// The parse holon: text → events on a fresh log + a forward token index.
//
// Two entry points:
//   parseText(text, opts)        — one-shot, fresh parser each call.
//   createParser(opts).parse(text, ...) — long-lived parser owning state.

export { parseText, createParser } from './pipeline.js';
export { tok, tokSet, isStop }     from './tokenize.js';
export { segmentSentences }        from './sentences.js';
export { parseRelations, headVerb } from './relations.js';
export { fuzzCeiling, editWithin, fuzzyMatches } from './fuzzy.js';
export { induceBoundaries }        from './boundaries.js';
export { segmentClauses, SEED_CLAUSE_BOUNDARY } from './clauses.js';
export { isChrome, isDegenerate }  from './chrome.js';
export { frameSpan, isBanner }     from './frame.js';
export { extractMetadata, splitFields } from './metadata.js';
export { argumentSpanSeg, positionElements, argumentSpansHold,
         SVO_EXTRACTOR, SVO_CONFIDENCE } from './proposition.js';
