// The conventions holon: the learned-rules ledger (REC) and the Pass 0
// induction that fills it before the per-sentence loop runs.

export { createConventions, SEED_SPEECH, SEED_ABBREVIATIONS,
         SEED_COPULA, SEED_MODIFIER, SEED_RELATION_TYPES,
         SEED_PREPOSITION, SEED_AUXILIARY, SEED_ROLE, SEED_FUNCTION, SEED_STARTER,
         SEED_CONJUNCTION, SEED_FIELD_LABEL } from './ledger.js';
export { induceAttributionVerbs }  from './induce.js';
