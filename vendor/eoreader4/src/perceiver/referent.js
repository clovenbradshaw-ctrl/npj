// Referential confidence — the reader's own measure of WHO a passage concerns,
// read off the γ-decayed coref posterior at the answer cursor.
//
// The coref field is a proper softmax (parse/coref.js: mass/Z = w, hottest
// first). Its CONCENTRATION is the reader's confidence about the subject: a
// single dominant referent is unambiguous; a near-tie between two figures means
// the passage the answer draws on does not settle who it is about. The fold
// computes this field and the answer route used to read none of it — the
// uncertainty was measured and discarded at the last step. This turns the
// posterior into a reported number the turn carries, and a flag the grounding
// battery can surface when the field is genuinely split.

// The top referent must lead the runner-up by this margin for the field to count
// as concentrated. Below it, two readings are close enough that the answer's
// subject is not settled by the document evidence alone.
export const REFERENT_MARGIN = 0.15;

export const referentialConfidence = (field, { margin = REFERENT_MARGIN } = {}) => {
  const f = Array.isArray(field) ? field : [];
  const top  = f[0] || null;
  const next = f[1] || null;
  const w    = top ? (top.w ?? 0) : 0;
  const gap  = w - (next ? (next.w ?? 0) : 0);
  // 0 candidates → no referent to be confident about; 1 → unambiguous; else the
  // gap to the runner-up decides.
  const concentrated = f.length === 0 ? false
    : f.length === 1 ? true
    : gap >= margin;
  return Object.freeze({
    id: top ? top.id : null,
    w,
    margin: gap,
    concentrated,
  });
};
