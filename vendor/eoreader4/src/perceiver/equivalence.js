// Emergent equivalence — note categories with no threshold, no a priori.
//
// The frequency reader MEASURES harmonic relatedness (overtone overlap) but
// leaves every tone its own entity. To turn that measurement into a category —
// "these are the same note" — the obvious move is a threshold: merge any pair
// over 0.4. But a threshold is a chosen number, a small a priori smuggled back
// in, and the whole point was to keep the structure in the signal.
//
// So there is no threshold here. The only relation used is RANK: a tone's
// nearest neighbour is whatever it overlaps most. Two tones merge iff each is
// the OTHER's nearest — mutual nearest neighbour, the parameter-free grouping
// (Gestalt proximity, relationally). The merges compose by the engine's own
// union-find (SYN), so equivalence is transitive: 110↔220, 220↔440, 440↔880
// collapse into one note. A fifth is never the tonic's strongest match, so it
// never joins. The single non-relational condition is "shares at least one
// overtone" — related vs unrelated, 0 vs not, which is not a magnitude anyone
// picked. The category is the output of the operation, not an input to it.

import { createNoiseFloor } from '../core/index.js';

// The lexical retriever is INJECTED, not imported (add-on: probe fix). Discovering
// equivalences needs a similarity ranking over the doc's units, but ranking/search
// is the retrieve faculty's job, downstream of perception — so the perceiver must
// not reach sideways into retrieve. The caller (who has both) passes retrieveLexical
// in; equivalence stays pure on the injected ranker, the way the enacted loop is pure
// on an injected read. A missing retriever is a wiring error, surfaced loudly.
const needRetrieve = (retrieve) => {
  if (typeof retrieve !== 'function') {
    throw new TypeError('discoverEquivalences/mutualNearestPairs need an injected `retrieve` (e.g. retrieveLexical)');
  }
  return retrieve;
};

// The set of a tone's strongest matches (a set, so exact ties — the two octaves
// of a tone are equally near — are both kept). Empty when it shares nothing.
//
// `minOverlap` is the one principled place a threshold belongs. At 0 (the default)
// the rule is pure rank — right for RECOVERY, where any real structure should be
// found without an arbitrary cut. But pure rank cannot ABSTAIN: it always merges
// the argmax, however weak, so on noise it hallucinates equivalences (every grain
// has a nearest grain). Abstention needs a null: pass the noise null's overlap as
// `minOverlap` and a pair must clear what chance produces before it can merge.
const nearestSet = (doc, i, minOverlap, retrieve) => {
  const res = retrieve(doc, doc.spectrumQuery(i), doc.units.length + 1)
    .filter(r => r.idx !== i && r.score > minOverlap);
  if (!res.length) return { best: 0, set: new Set() };
  const best = res[0].score;
  return { best, set: new Set(res.filter(r => Math.abs(r.score - best) < 1e-9).map(r => r.idx)) };
};

// The mutual-nearest pairs: i and j where each is among the other's strongest.
export const mutualNearestPairs = (doc, { minOverlap = 0, retrieve } = {}) => {
  const rank = needRetrieve(retrieve);
  const n = doc.units.length;
  const near = Array.from({ length: n }, (_, i) => nearestSet(doc, i, minOverlap, rank));
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (const j of near[i].set) {
      if (j > i && near[j].set.has(i)) pairs.push({ i, j, score: near[i].best });
    }
  }
  return pairs;
};

// The overlap quantum: one shared partial out of the query's partials. The finest
// distinction the overlap reading can draw, hits/qLen, and so the grain the derived
// null floors on — read from the signal's own front-end, never chosen.
const overlapGrain = (doc) => 1 / (doc.partialTokens?.[0]?.length || 16);

// The VOID boundary for overlaps, DERIVED from the signal's own noise. Feed the
// streaming floor every pairwise overlap, in reading order (causal accumulation):
// these are the also-ran overlaps, the field's samples of what chance produces. A
// proposed equivalence must beat the max-of-background null those samples imply.
// The octave overlaps are fed too; leave-one-out plus the bulk fit keep them from
// poisoning the floor they must clear.
const overlapFloor = (doc, alpha, retrieve) => {
  const n = doc.units.length;
  const floor = createNoiseFloor({ scale: 'linear', alpha, grain: overlapGrain(doc), N: n });
  for (let i = 0; i < n; i++) {
    for (const r of retrieve(doc, doc.spectrumQuery(i), n + 1)) {
      if (r.idx !== i) floor.observe(r.score);
    }
  }
  return floor;
};

// Discover the equivalence classes and (by default) commit them: append a SYN
// merge per mutual-nearest pair to the log, so the engine's projection collapses
// them itself. Returns the pairs and the classes (each an array of unit indices).
//
// The VOID boundary is set one of three ways, in priority order:
//   • `minOverlap` — an explicit constant (a caller-supplied null; back-compat).
//   • `alpha` — DERIVE the null online from the signal's own non-cohering overlaps,
//     at the tolerated false-positive rate `alpha`. The boundary is no longer a
//     number you set; it is a readout the physics computes (see voidnull.js).
//   • neither — 0, pure rank: merge the argmax. Right for RECOVERY, and the
//     cold-start fallback before any null is known.
export const discoverEquivalences = (doc, { emit = true, minOverlap = null, alpha = null, retrieve } = {}) => {
  const rank = needRetrieve(retrieve);
  // What the overlap field PROPOSES, by rank alone — the recovery rule.
  const candidates = mutualNearestPairs(doc, { minOverlap: 0, retrieve: rank });

  // The per-candidate boundary. Constant when given; derived (leave-one-out,
  // extreme-value, robust, streaming) when `alpha` is set; 0 otherwise.
  const floor = (minOverlap == null && alpha != null) ? overlapFloor(doc, alpha, rank) : null;
  const boundary = (c) =>
    minOverlap != null ? minOverlap
      : floor ? floor.threshold({ leaveOut: c.score })
        : 0;

  const parent = new Map();
  const find = (x) => { let p = parent.get(x) ?? x; while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p; return p; };
  const union = (a, b) => { parent.set(find(a), find(b)); };

  const merged = [];   // cleared the null → SYN, a real equivalence
  const held = [];     // proposed but did not clear the null → NUL, held not structured
  for (const c of candidates) {
    if (c.score > boundary(c)) {
      if (emit) doc.log.append({ op: 'SYN', kind: 'merge', from: `n${c.i}`, to: `n${c.j}`, sentIdx: c.j });
      union(c.i, c.j);
      merged.push(c);
    } else {
      // NUL is non-transformation: the field proposed this pair, but it did not
      // clear the noise null, so it is HELD as-is — read, recorded, not merged.
      if (emit) doc.log.append({ op: 'NUL', kind: 'held-equivalence', src: `n${c.i}`, tgt: `n${c.j}`, overlap: c.score, sentIdx: c.j });
      held.push(c);
    }
  }

  const byRoot = new Map();
  for (let i = 0; i < doc.units.length; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(i);
  }

  // When nothing merged, assert the ABSENCE — a DEF to VOID on the identity slot.
  // Not silence: content the audit (and the projection's `voids`) can read back.
  const voided = merged.length === 0;
  if (emit && voided) {
    doc.log.append({ op: 'DEF', kind: 'void', node: 'identity', rel: 'same-as', sentIdx: 0, note: 'no equivalence clears the null' });
  }

  return { pairs: merged, held, classes: [...byRoot.values()], voided };
};
