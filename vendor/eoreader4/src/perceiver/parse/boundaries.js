// Boundary induction — the DEF·EVA·REC loop that lets MEANING revise SYNTAX.
//
// Presence is bedrock: that these marks are here, in this order, is not up for
// revision. But where a sentence ENDS is an interpretation — the lowest DEF the
// reader makes — and like every interpretation it is provisional. The segmenter's
// established rule is `boundary = .!?` (sentences.js). For most text that holds. For
// a text that uses the colon as its sentence separator (the KJV), it does not: whole
// genealogies fuse into one unit, and the meaning will not cohere — a patriarch's
// clause welds to the "generations of X" frame and the begat falls to a stray
// referent ("God begat Shem"). That incoherence is not noise; it is a MEASUREMENT on
// the syntax beneath it.
//
// So this runs the SAME enacted DEF·EVA·REC loop the significance engine runs
// (core/enacted/loop.js), pointed down at the boundary convention instead of the figure
// field:
//
//   DEF   the boundary set begins at the floor `.!?` (the seed commitment).
//   EVA   each unit is tested for COHERENCE STRAIN — how many independent
//         propositions it fuses across an ignored mark (`:`/`;`). A coherent
//         one-proposition unit confirms the frame and adds nothing; a run-on
//         strains it. Surprise sourced from "meaning did not emerge here."
//   REC   when the leaky strain accumulates past threshold — a crisis, not a single
//         anomaly, so it stays RARE — the frame breaks: promote the ignored mark
//         that accounts for the most fusion to a boundary, re-segment, and re-run
//         until the reading settles (the spiral converges, or promotes both marks).
//
// The existence floor still binds: the loop may only promote a mark that is ALREADY
// in the text, to fit the tokens that exist — it can move where a unit ends, never
// invent one. The witness deposits, the convention layer decides (it RECs itself).

import { createEnactedLoop } from '../../core/enacted/index.js';
import { segmentSentences } from './sentences.js';

// The marks the reader is allowed to promote — punctuation that, in some dialects,
// separates sentences. Never letters or spaces; presence is bedrock.
const CANDIDATE_MARKS = Object.freeze([':', ';']);

// Subjects that open an independent clause after a mark (a new proposition, not a
// list item): a capitalised word or a pronoun, early-modern included.
const CLAUSE_OPENER = /^\s*(?:and\s+)?(?:[A-Z][a-z]+|he|she|they|it|we|I|you|thou|ye)\b/;

// How many independent propositions a unit FUSES across each still-ignored mark.
// A mark counts only when an independent clause of real length follows it — so a
// colon before a short list item ("sons: Shem, Ham") does not strain, but a colon
// before a clause ("of Shem: Shem was an hundred years old…") does.
const fusionByMark = (unit, ignored) => {
  const counts = {};
  for (const mk of ignored) counts[mk] = 0;
  for (let i = 0; i < unit.length; i++) {
    const ch = unit[i];
    if (!ignored.has(ch)) continue;
    const after = unit.slice(i + 1);
    if (!CLAUSE_OPENER.test(after)) continue;
    const seg = after.split(/[:;.!?]/)[0].trim();
    if (seg.split(/\s+/).filter(Boolean).length >= 4) counts[ch]++;   // a clause, not a fragment
  }
  return counts;
};

// Run the loop to convergence. Returns the learned boundary set (beyond the floor)
// and the REC entries — one per promotion — for the conventions log.
export const induceBoundaries = (text, { isAbbreviation, thresholds, confirmBand } = {}) => {
  const extraBoundaries = new Set();
  const recs = [];

  // At most one promotion per candidate mark; the loop re-runs after each so a
  // second mark is judged against the units the first one already fixed.
  for (let pass = 0; pass <= CANDIDATE_MARKS.length; pass++) {
    const ignored = new Set(CANDIDATE_MARKS.filter((m) => !extraBoundaries.has(m)));
    if (ignored.size === 0) break;

    const units = segmentSentences(text, { isAbbreviation, extraBoundaries });
    if (units.length < 4) break;                       // too thin to fit a convention

    // EVA strain per unit, and the per-mark tally that decides the restructuring.
    const total = { ':': 0, ';': 0 };
    const strain = units.map((u) => {
      const f = fusionByMark(u, ignored);
      let s = 0;
      for (const mk of ignored) { total[mk] += f[mk]; s += f[mk]; }
      return s;
    });

    // The enacted loop is the witness: it decides WHETHER the frame breaks (a rare,
    // accumulated crisis), reading the coherence strain as its surprise.
    const loop = createEnactedLoop({
      layers: ['segmentation'],
      thresholds: { segmentation: thresholds?.segmentation ?? 3 },
      confirmBand: confirmBand ?? 0.4,                 // a unit fusing <1 clause confirms
      impulseThreshold: 1.1,                           // accumulation only — no single-unit shock
      read: (i) => ({ surprise: Math.min(1, strain[i] / 2), terms: [...extraBoundaries] }),
    });
    loop.runTo(units.length - 1);
    if (!loop.events.some((e) => e.op === 'REC')) break;   // the frame held — converged

    // Restructure: promote the ignored mark that accounts for the most fusion.
    const mark = [...ignored].sort((a, b) => total[b] - total[a])[0];
    if (!total[mark]) break;
    extraBoundaries.add(mark);
    recs.push({ op: 'REC', kind: 'boundary', token: mark, fused: total[mark], reader: 'reading' });
  }

  return { extraBoundaries, recs };
};
