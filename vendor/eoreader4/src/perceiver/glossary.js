// Glossary surface — the terms a document leans on that a reader might need
// defined. A perceiver-level read over the parsed doc's admitted figures and
// the acronyms the text taught itself: pure, mechanical, no model in the loop.
//
// "The low sets the possibility for the high." A term can only be offered for
// definition if parse admitted it — we never invent a candidate the reading did
// not surface. We rank what admission gave us by four mechanical signals:
//
//   count       how often the document turns on the term (label sightings)
//   spread      how many distinct sentences it touches (mentions under its id)
//   shape       a multi-word proper name is referential on its face
//   gloss       the text itself spelled out an acronym in a parenthetical —
//               the surest sign a thing wants defining
//
// The number of candidates scales with the document's length: a brief earns a
// handful, a feature a page. The sizing is the caller's lever (wordsPerTerm),
// clamped so even a one-line note offers a few and a book does not offer a
// thousand. Nothing here calls a model; the reading is the parse's, surfaced.
//
// Acronyms fold onto their spelled-out expansion ("Nashville Downtown
// Partnership (NDP)" → one entry, alias NDP). The link comes from the parser's
// initialism ledger when it has one AND from the text's own parentheticals, so
// the fold works the same whether the host engine learned acronyms or not.

import { parseText } from './parse/index.js';

export const DEFAULT_GLOSSARY_OPTS = {
  wordsPerTerm: 130,   // one candidate per ~130 words of prose
  minTerms: 3,         // even a short note offers a few
  maxTerms: 24,        // a long feature caps here
  minCount: 1,         // a candidate must be sighted at least this many times
  contexts: 2,         // sentence snippets carried per term (to seed a definition)
};

const wordCount = (text) => (String(text == null ? '' : text).trim().match(/\S+/g) || []).length;

// The reading sequence is modality-neutral: sentences may be plain strings or
// rich records. Resolve the text either way (mirrors the npj prop-graph seam).
const unitText = (doc, i) => {
  const u = ((doc && (doc.sentences || doc.units)) || [])[i];
  if (u == null) return '';
  return typeof u === 'string' ? u : (u.text || u.raw || u.sentence || String(u));
};

const keyFor = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

// How many candidates a document of `words` words is owed, clamped to [min,max].
export const glossarySize = (words, opts = {}) => {
  const o = { ...DEFAULT_GLOSSARY_OPTS, ...opts };
  const raw = Math.round((Number(words) || 0) / o.wordsPerTerm);
  return Math.max(o.minTerms, Math.min(o.maxTerms, raw));
};

// The text's own parenthetical acronym glosses: "Nashville Downtown Partnership
// (NDP)". Conservative — the acronym is accepted only when it is the trailing
// initials of the phrase that precedes it. Independent of the parser's ledger,
// so older host engines (which never learned the acronym) fold the same.
const ACR_RE = /([A-Z][A-Za-z.&'’-]*(?:\s+[A-Za-z.&'’-]+){0,6})\s*\(([A-Z]{2,6})s?\)/g;
export const scanAcronyms = (text) => {
  const s = String(text == null ? '' : text);
  const out = [];
  const re = new RegExp(ACR_RE.source, 'g');
  let m;
  while ((m = re.exec(s)) !== null) {
    const acr = m[2];
    const words = m[1].trim().split(/\s+/);
    if (words.length < acr.length) continue;
    const tail = words.slice(-acr.length);                 // the expansion is the last N words
    const initials = tail.map((w) => (w[0] || '')).join('').toUpperCase();
    if (initials !== acr.toUpperCase()) continue;          // letters must line up
    const expansion = tail.join(' ');
    if (/^[A-Z]/.test(expansion)) out.push({ acronym: acr, expansion });
  }
  return out;
};

// The mechanical salience of one candidate. Acronyms weigh heaviest — a thing
// the writer already paused to spell out is a thing a reader will need spelled
// out — then a parenthetical gloss, then multi-word names, then raw recurrence.
const scoreOf = (cand) =>
  cand.count * 1.0 +
  cand.mentions.length * 0.6 +
  (cand.multiword ? 1.2 : 0) +
  (cand.acronym ? 2.0 : 0) +
  (cand.expansion ? 1.0 : 0);

// Read a PARSED doc into ranked, sized glossary candidates. Pure on the doc —
// no parse here, so a caller that already parsed (the npj graph view does) pays
// the parse once and reads as many surfaces as it likes.
export const glossarySurface = (doc, opts = {}) => {
  const o = { ...DEFAULT_GLOSSARY_OPTS, ...opts };
  const A = doc && doc.admission;
  const words = doc && doc.text != null ? wordCount(doc.text) : 0;
  const size = glossarySize(words, o);
  if (!A || !A.admitted) return { words, size, perTerm: o.wordsPerTerm, terms: [], all: [] };

  // --- acronym ↔ expansion links: the parser's ledger (when present) PLUS the
  //     text's own parentheticals. Either source folds the acronym onto the
  //     expansion's group; the ledger wins ties (it ran with full context). ---
  const expKeyByAcr = new Map();    // acronym key   → expansion key
  const acrByExpKey = new Map();    // expansion key → acronym surface
  const expLabelByKey = new Map();  // expansion key → expansion label (richest surface)
  const linkAcr = (acr, expLabel) => {
    if (!acr || !expLabel) return;
    const ak = keyFor(acr), ek = keyFor(expLabel);
    if (!ak || !ek || ak === ek) return;
    expKeyByAcr.set(ak, ek);
    if (!acrByExpKey.has(ek)) acrByExpKey.set(ek, String(acr));
    if (!expLabelByKey.has(ek) || String(expLabel).length > expLabelByKey.get(ek).length) expLabelByKey.set(ek, String(expLabel));
  };
  const initialisms = A.initialisms;
  if (initialisms && typeof initialisms[Symbol.iterator] === 'function') {
    for (const [acrLabel, expId] of initialisms) {
      const expLabel = (typeof A.labelOf === 'function' && A.labelOf(expId)) || null;
      if (expLabel) linkAcr(acrLabel, expLabel);
    }
  }
  for (const link of scanAcronyms(doc && doc.text)) linkAcr(link.acronym, link.expansion);

  // --- gather admitted figures into groups keyed by their canonical (expansion)
  //     form, so an acronym and its spelled-out name become one candidate ----
  const groups = new Map();         // groupKey → accumulating candidate
  const groupKeyOf = (label) => { const k = keyFor(label); return expKeyByAcr.get(k) || k; };
  for (const [label, id] of A.admitted) {
    const count = A.counts.get(label) || 0;
    if (count < o.minCount) continue;
    const gkey = groupKeyOf(label);
    const isAcr = expKeyByAcr.has(keyFor(label));  // this very label is an acronym we linked
    let g = groups.get(gkey);
    if (!g) {
      const seed = expLabelByKey.get(gkey) || label;
      g = { term: seed, key: gkey, id: id, count: 0, mentions: new Set(), multiword: seed.includes(' '), acronym: acrByExpKey.get(gkey) || null };
      groups.set(gkey, g);
    }
    // the displayed headword is the spelled-out expansion when known, else the
    // richest non-acronym surface form seen
    if (expLabelByKey.has(gkey)) { g.term = expLabelByKey.get(gkey); g.multiword = g.term.includes(' '); }
    else if (!isAcr && label.length > g.term.length) { g.term = label; g.multiword = label.includes(' '); g.id = id; }
    if (acrByExpKey.get(gkey)) g.acronym = acrByExpKey.get(gkey);
    g.count += count;
    for (const si of (A.mentions.get(id) || [])) g.mentions.add(si);
  }

  const cands = [...groups.values()].map((g) => {
    const mentions = [...g.mentions].sort((a, b) => a - b);
    const contexts = mentions.slice(0, o.contexts).map((i) => unitText(doc, i)).filter(Boolean);
    return {
      term: g.term,
      termKey: g.key,
      id: g.id,
      kind: g.acronym ? 'acronym' : (g.multiword ? 'name' : 'term'),
      count: g.count,
      mentions,
      multiword: g.multiword,
      acronym: g.acronym,
      expansion: g.acronym && g.term !== g.acronym ? g.term : null,
      contexts,
    };
  });

  const ranked = cands
    .map((c) => ({ ...c, score: Math.round(scoreOf(c) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term));

  return { words, size, perTerm: o.wordsPerTerm, terms: ranked.slice(0, size), all: ranked };
};

// Convenience: raw text → ranked, sized glossary candidates. Parses a fresh doc
// then reads the surface. The npj bridge calls this; tests and scripts can too.
export const extractGlossary = (text, opts = {}) => {
  const doc = parseText(String(text == null ? '' : text), { docId: opts.docId || 'glossary' });
  return glossarySurface(doc, opts);
};
