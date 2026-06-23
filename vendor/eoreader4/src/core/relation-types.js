// The typing bridge. Open-vocabulary extraction (parse/relations.js) emits
// surface descriptor nouns on the `via` of a kinship/social CON edge — sister,
// mother, captain, friend. Those are STRINGS; they carry no algebra. This maps
// each surface noun onto a small CLOSED set of primitive relation types that DO
// carry {inverse, symmetric, functional, disjointWith}. The map is the
// reconciliation: extraction stays open, the algebra operates on the projection.
//
// The gendered-projection discipline is the whole point (the symmetry you'd lose
// by collapsing to <noun>-of): sister|brother → the SYMMETRIC primitive sibling,
// with gender recovered, not baked into a non-symmetric surface label. mother|
// father → the FUNCTIONAL primitive parent, inverse child. So sister-of and
// mother-of are no longer "two unrelated strings" — they are projections of two
// primitives the algebra knows are disjoint.

import { VERDICTS } from './verdicts.js';   // imported DOWN; read stays a leaf

// The closed primitive set. Properties live HERE, keyed on type, never on nouns.
export const PRIMITIVES = Object.freeze({
  sibling: { symmetric: true,  transitive: false, functional: false, inverse: 'sibling',    prior: 0.9 },
  parent:  { symmetric: false, transitive: false, functional: true,  inverse: 'child',      prior: 0.95 },
  child:   { symmetric: false, transitive: false, functional: false, inverse: 'parent',     prior: 0.95 },
  spouse:  { symmetric: true,  transitive: false, functional: true,  inverse: 'spouse',     prior: 0.9 },
  ancestor:{ symmetric: false, transitive: true,  functional: false, inverse: 'descendant', prior: 0.9 },
  // Non-kin primitives — SAME machinery, proving this isn't a family table.
  leads:   { symmetric: false, transitive: false, functional: true,  inverse: 'led-by',     prior: 0.8 },  // captain/leader/head
  authored:{ symmetric: false, transitive: false, functional: false, inverse: 'authored-by',prior: 0.7 },
  located: { symmetric: false, transitive: true,  functional: false, inverse: 'contains',   prior: 0.85 },
  social:  { symmetric: true,  transitive: false, functional: false, inverse: 'social',     prior: 0.5 },  // friend (weak)
});

// Disjointness is stated on PRIMITIVES, not nouns. parent ⟂ sibling, parent ⟂
// child, etc. A gendered conflict (mother vs father) is recovered separately via
// the projection's gender, in areDisjoint below. The table is PARTIAL by design:
// a pair not listed here is not asserted consistent — it is simply not asserted
// disjoint, and the algebra DEFERS. "No conflict" ≠ "consistent."
export const DISJOINT_PRIMITIVES = Object.freeze([
  ['parent', 'sibling'], ['parent', 'child'], ['ancestor', 'child'],
  ['spouse', 'sibling'], ['spouse', 'parent'], ['spouse', 'child'],
].map(Object.freeze));

// The surface→primitive map WITH the gendered projection recovered. Each entry:
// { type, gender }. Extend by adding nouns; the algebra never changes. The keys
// mirror parse/relations.js's KIN list where they overlap, so a kinship CON edge
// the page already logs (via = the kin noun) types without any new extraction.
const SURFACE = Object.freeze({
  sister:  { type: 'sibling', gender: 'F' }, brother: { type: 'sibling', gender: 'M' },
  sibling: { type: 'sibling', gender: null },
  mother:  { type: 'parent',  gender: 'F' }, father:  { type: 'parent',  gender: 'M' },
  parent:  { type: 'parent',  gender: null }, mom: { type: 'parent', gender: 'F' }, dad: { type: 'parent', gender: 'M' },
  son:     { type: 'child',   gender: 'M' }, daughter:{ type: 'child',   gender: 'F' }, child: { type: 'child', gender: null },
  wife:    { type: 'spouse',  gender: 'F' }, husband: { type: 'spouse',  gender: 'M' }, spouse: { type: 'spouse', gender: null },
  grandfather: { type: 'ancestor', gender: 'M' }, grandmother: { type: 'ancestor', gender: 'F' },
  // non-kin
  captain: { type: 'leads', gender: null }, leader: { type: 'leads', gender: null }, head: { type: 'leads', gender: null },
  boss: { type: 'leads', gender: null }, master: { type: 'leads', gender: null },
  author:  { type: 'authored', gender: null }, writer: { type: 'authored', gender: null },
  capital: { type: 'located', gender: null },
  friend:  { type: 'social', gender: null }, neighbour: { type: 'social', gender: null }, neighbor: { type: 'social', gender: null },
});

// Type a surface descriptor noun. Open vocab in, closed primitive out (or null —
// an unmapped noun is honestly untyped and the algebra DEFERS on it, never
// guesses). This is the seam where a learned-ledger noun or a geometric reader
// could later propose a mapping; today it's the declarative table.
export const typeOf = (surfaceNoun) => {
  if (!surfaceNoun) return null;
  const e = SURFACE[String(surfaceNoun).toLowerCase().replace(/-of$/, '')];
  return e ? Object.freeze({ ...e, ...PRIMITIVES[e.type] }) : null;
};

export const isFunctional = (noun) => !!typeOf(noun)?.functional;
export const isSymmetric  = (noun) => !!typeOf(noun)?.symmetric;
// The calibrated typing confidence for a surface noun (1 when untyped — an
// unknown relation is not penalised). Consumed by checkRelationConflict to weigh
// a contradiction's strength and by the factcheck refusal gate; an untyped noun
// never reaches either, so the default is inert.
export const relationPrior = (noun) => typeOf(noun)?.prior ?? 1;

// Are two surface nouns disjoint? Resolve BOTH to primitives, check the
// primitive disjointness table, then the gender rule: same primitive + opposite
// known gender ⇒ disjoint (mother ⟂ father, sister ⟂ brother). Pure, no embedder.
export const areDisjoint = (a, b) => {
  const ta = typeOf(a), tb = typeOf(b);
  if (!ta || !tb) return false;                  // untyped → cannot assert disjoint
  if (ta.type === tb.type)
    return !!(ta.gender && tb.gender && ta.gender !== tb.gender); // same primitive, gender split
  return DISJOINT_PRIMITIVES.some(([x, y]) =>
    (x === ta.type && y === tb.type) || (x === tb.type && y === ta.type));
};

// A functional-slot clash between two surface nouns: the SAME functional primitive
// filled by two DIFFERENT, gender-matched roles. The gender match is what keeps it
// sound — `mother` and `father` are both the functional `parent` primitive, but a
// person has one of EACH, so a clash needs a known, equal gender on both sides
// (mother vs mother, wife vs wife). A genderless filler (the bare word "parent")
// never clashes, so the functional flag can't false-fire across the gender split.
export const functionalClash = (a, b) => {
  const ta = typeOf(a), tb = typeOf(b);
  return !!(ta && tb && ta.functional && ta.type === tb.type
    && ta.gender && tb.gender && ta.gender === tb.gender);
};

// ── The symbolic verdict, embedder-free ────────────────────────────────────
//
// Returns a VERDICTS-tagged result, or null when the claim is outside the algebra
// (so the caller DEFERS to the geometric check, never false-fires). Two catches:
//
//   disjoint-axiom   — the same ordered pair (src→tgt) already carries a relation
//                      disjoint with the claim's (Gregor --sister--> Grete vs a
//                      claimed Gregor --mother--> Grete). Hard contradiction.
//   functional-axiom — a functional, gender-matched slot on src is already filled
//                      by a DIFFERENT target. Requires at least one WITNESSED
//                      filler (`!e.derived`) so two derived guesses never refuse —
//                      the provenance guard.
//
// `e.derived` is honoured if present; the projection does not mint derived edges
// today, so every current edge reads as witnessed — the guard is forward-armed.
export const checkRelationConflict = (graph, claim) => {
  const noun = claim?.via;
  if (!typeOf(noun)) return null;                  // outside the algebra → defer
  const rep = graph?.representative || ((id) => id);
  const src = rep(claim.src), tgt = rep(claim.tgt);
  const fromSrc = (graph?.edges || []).filter(e => rep(e.from) === src);

  for (const e of fromSrc) {
    if (rep(e.to) === tgt && areDisjoint(noun, e.via)) {
      return Object.freeze({
        verdict: VERDICTS.CONTRADICTED, reason: 'disjoint-axiom',
        claimRel: noun, docRel: e.via, witnessed: !e.derived,
        // The likelihood the contradiction is REAL, not a boolean: how confident
        // the typing of BOTH relations is (relationPrior, calibrated per primitive
        // — sibling 0.9, parent 0.95, social 0.5). A clash between two near-certain
        // kin relations is a stronger refusal than one resting on a weakly-typed
        // noun. The downstream gate (factcheck/correspond.js) reads this; the prior
        // is no longer declared-but-unread.
        confidence: relationPrior(noun) * relationPrior(e.via),
        citation: e.sentIdx != null ? `s${e.sentIdx}` : null,
      });
    }
  }
  if (isFunctional(noun)) {
    const filled = fromSrc.find(e => !e.derived && rep(e.to) !== tgt && functionalClash(noun, e.via));
    if (filled) return Object.freeze({
      verdict: VERDICTS.CONTRADICTED, reason: 'functional-axiom',
      claimRel: noun, existing: rep(filled.to),
      confidence: relationPrior(noun) * relationPrior(filled.via),
      citation: filled.sentIdx != null ? `s${filled.sentIdx}` : null,
    });
  }
  return null;
};
