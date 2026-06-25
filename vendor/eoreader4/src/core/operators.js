// The nine operators. The vocabulary the whole system speaks.
//
// ACT face: Identity (mode) × Space (domain)
//
//                 Existence       Structure       Interpretation
// Differentiate   NUL hold        SEG resplit     DEF assert
// Relate          SIG attribute   CON bond        EVA evaluate
// Generate        INS instantiate SYN synthesize  REC learn rule
//
// CON — the binding bond at Relate × Structure — is the central operator.
// It is what makes a citation hold a claim to a source.

export const MODES   = Object.freeze(['Differentiate', 'Relate', 'Generate']);
export const DOMAINS = Object.freeze(['Existence', 'Structure', 'Interpretation']);
export const GRAINS  = Object.freeze(['Ground', 'Figure', 'Pattern']);

// NUL is non-transformation — it holds a thing as-is. It is NOT "clearing":
// voiding a fact is a DEF to VOID (an assertion), never a NUL.
export const OPERATORS = Object.freeze({
  NUL: Object.freeze({ id: 'NUL', mode: 'Differentiate', domain: 'Existence',      label: 'hold (non-transformation)' }),
  SEG: Object.freeze({ id: 'SEG', mode: 'Differentiate', domain: 'Structure',      label: 'resplit' }),
  DEF: Object.freeze({ id: 'DEF', mode: 'Differentiate', domain: 'Interpretation', label: 'assert/define' }),
  SIG: Object.freeze({ id: 'SIG', mode: 'Relate',        domain: 'Existence',      label: 'attribute' }),
  CON: Object.freeze({ id: 'CON', mode: 'Relate',        domain: 'Structure',      label: 'bond' }),
  EVA: Object.freeze({ id: 'EVA', mode: 'Relate',        domain: 'Interpretation', label: 'evaluate' }),
  INS: Object.freeze({ id: 'INS', mode: 'Generate',      domain: 'Existence',      label: 'instantiate' }),
  SYN: Object.freeze({ id: 'SYN', mode: 'Generate',      domain: 'Structure',      label: 'synthesize' }),
  REC: Object.freeze({ id: 'REC', mode: 'Generate',      domain: 'Interpretation', label: 'learn rule' }),
});

export const isOperator = (op) => typeof op === 'string' && op in OPERATORS;

export const operatorsByMode = (mode) =>
  Object.values(OPERATORS).filter(o => o.mode === mode);

export const operatorsByDomain = (domain) =>
  Object.values(OPERATORS).filter(o => o.domain === domain);
