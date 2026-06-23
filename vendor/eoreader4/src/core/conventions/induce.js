// Pass 0 — attribution-verb induction.
//
// Before the per-sentence loop reads a word, it learns how *this* document
// marks speech. A fixed whitelist ("said", "asked") misses a text whose
// dialogue runs on "transmitted", "pinged", "signed". So we look at the verbs
// that sit against quotation marks and let the document teach us its own
// convention. The high (a learned rule) sets the probabilities for the low
// (how the next thousand sentences are classified).
//
// This is induction, not decision: every candidate carries a count that
// becomes a weight. Nothing is hard-coded true; the convention is whatever the
// text keeps doing.

const QUOTE = '["“”“”]';

// verb immediately before an opening quote:  Gregor said, "…"
const PRE  = new RegExp(String.raw`\b([a-z]{2,})\s*[,:]?\s*${QUOTE}`, 'g');
// verb just after a closing quote, before a subject:  …," replied Grete
const POST = new RegExp(String.raw`${QUOTE}\s*,?\s*([a-z]{2,})\s+(?:[A-Z][a-z]+|he|she|they|the)\b`, 'g');

// Tokens that hug quotes but are not attribution verbs.
const NOT_VERB = new Set([
  'the', 'and', 'but', 'that', 'with', 'for', 'his', 'her', 'their', 'this',
  'then', 'when', 'while', 'because', 'about', 'into', 'from',
]);

const verbish = (w) =>
  /(?:ed|s|t)$/.test(w) || ['say', 'ask', 'cry', 'tell', 'add', 'go', 'reply'].includes(w);

export const induceAttributionVerbs = (sentences) => {
  const counts = new Map();
  const bump = (w) => {
    const t = w.toLowerCase();
    if (NOT_VERB.has(t) || !verbish(t)) return;
    counts.set(t, (counts.get(t) || 0) + 1);
  };
  for (const s of sentences) {
    if (!new RegExp(QUOTE).test(s)) continue;
    let m;
    const pre = new RegExp(PRE.source, 'g');
    while ((m = pre.exec(s)) !== null) bump(m[1]);
    const post = new RegExp(POST.source, 'g');
    while ((m = post.exec(s)) !== null) bump(m[1]);
  }
  return [...counts.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count);
};
