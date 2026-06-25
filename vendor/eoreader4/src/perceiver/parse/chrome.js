// The degenerate-structure guard.
//
// This is NOT chrome detection by a list of conventions — that is a semantic
// role, and it lives in `read/site.js`, where a unit is DEF'd as a *site*
// (ground/furniture) by its semantic role rather than matched against patterns.
//
// What stays here is only the genuinely degenerate: a line with no content to
// have a role — empty, a bare number or roman numeral, a separator rule. These
// are not conventions; they carry no figure at all, so they are held as NUL at
// parse time. Everything with actual words gets a role decided semantically.

const DEGENERATE = [
  /^\d+\s*$/,                 // a bare number
  /^[ivxlcdm]{1,7}\.?$/i,     // a bare roman numeral: "III", "iv."
  /^\[\d{1,3}\]$/,            // a bracketed footnote marker
  /^[\W_]+$/,                 // only punctuation/symbols — a separator rule
];

export const isDegenerate = (sentence) => {
  const s = String(sentence || '').trim();
  if (s.length < 3) return true;
  return DEGENERATE.some(p => p.test(s));
};

// `hint` is the nudge seam (message: "a mini-LLM is a good way to nudge things
// toward chrome"). A boolean or a number ≥ 1 forces the hold; otherwise the
// line is held only if it is structurally degenerate. The *semantic* role pass
// is the real determinant and runs later, with the embedder.
export const isChrome = (sentence, hint = 0) => {
  const nudge = typeof hint === 'boolean' ? (hint ? 1 : 0) : (Number(hint) || 0);
  return isDegenerate(sentence) || nudge >= 1;
};
