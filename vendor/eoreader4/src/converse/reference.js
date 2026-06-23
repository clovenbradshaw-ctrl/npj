// Reference by reading — resolve a follow-up's referent by reading the conversation
// as the tail of the reading line, not by matching its surface form.
// (docs/reference-by-reading.md)
//
// A pronoun ("what is his name?"), a definite description ("the musician", "the
// other one"), and a correction ("no the musician") are not three cases needing
// three detectors. They are one operation: read the warmest figure the conversation
// holds, and let retrieval nominate a referent from the document to warm beside it.
// The old path (converse/focus.js) classified the surface form — a PRONOUN regex, a
// CORRECTION regex, an ATTRIBUTE wordlist, a needsContext ladder. This reads the cast.
//
// The resolution rule, validated end to end by scripts/reference-measure.mjs over the
// audit's five turns (all five resolve, including the correction, no regex):
//
//   prefer the RETRIEVAL NOMINEE the conversation has also warmed   ← the correction
//     ("no the musician" re-nominates the musician, who is conv-warm, over the
//      talker's just-committed wrong answer — §4, read not detected),
//   else the conversation's WARMEST figure                          ← the pronoun
//     ("his name" binds to the referent the prior turn warmed, where retrieval would
//      mislead to a same-surface distractor),
//   else the RETRIEVAL NOMINEE                                      ← the description
//     (a definite description the conversation has not yet named — embedding points
//      the line at it; no CON edge or descriptor binding is required, P0).
//
// The warmth is CONVERSATION-SCOPED on purpose (P0): a referent is warm because the
// conversation named it, never because the document's tail happened to mention it. A
// γ-prior over the whole line would let the document's most-recent figure swamp a
// first follow-up; scoping warmth to the conversation cast is what makes the read
// robust to a question asked right after the document.

import { parseText } from '../perceiver/parse/pipeline.js';
import { namedReferents, figureSurface } from '../perceiver/index.js';
import { projectGraph } from '../core/index.js';

const GAMMA = 0.7;   // recency decay along the reading line — matches reading.js

const norm = (s) => String(s || '').trim().toLowerCase();

// The figures the CONVERSATION named, warmest first. The history (USER and TALKER
// turns alike — the talker's reply is a unit on the line too, §4) and the current
// question are read through the same parse the document ran through; each named
// figure's γ-mass is folded over its mentions, decayed to the question cursor (the
// last unit). The talker's words enter only to warm WHICH referent is in focus — the
// cast, never the answer's content (the grounded prompt still withholds the talker's
// prior answers), so this carries no poisoning channel.
export const conversationCast = (history = [], question = '') => {
  const turns = [
    ...(Array.isArray(history) ? history : []).filter(m => m && m.content).map(m => String(m.content)),
    String(question || ''),
  ].map(s => s.trim()).filter(Boolean);
  if (turns.length === 0) return [];

  const doc = parseText(turns.join('\n\n'));
  const units = doc.units || doc.sentences || [];
  const at = units.length - 1;                 // the question cursor — the line's tail
  if (at < 0) return [];

  const events = doc.log.snapshot ? doc.log.snapshot() : doc.log.events;
  // Pool every surface form onto its appearance CLASS — the projection's union-find
  // root, not the raw id the mention happened to mint. A referent renamed within the
  // conversation ("Gregor Samsa" … then bare "Samsa") is ONE warm figure, never two,
  // and its warmth is the sum over its mentions, not split across aliases and ranked by
  // whichever form came last. The earliest-INS label leads, so the canonical name shows.
  const rep = projectGraph(doc.log).representative || ((id) => id);
  const label = new Map();
  const mass  = new Map();
  for (const e of events) {
    if (e.op !== 'INS') continue;
    const id = rep(e.id);
    if (!label.has(id)) label.set(id, e.label);
    // Prior mass only: a figure named AT the cursor (the question's own line) does not
    // count as already-warm — the same before-the-cursor discipline readingAt keeps.
    if (e.sentIdx != null && e.sentIdx < at) mass.set(id, (mass.get(id) || 0) + Math.pow(GAMMA, at - 1 - e.sentIdx));
  }
  return [...mass.entries()]
    .map(([id, m]) => ({ id, label: label.get(id) || id, mass: m }))
    .sort((a, b) => b.mass - a.mass);
};

// localeOf — where in the DOCUMENT the referent is established: its strongest incident
// edge's line (figureSurface returns the referent's bonds weight-ranked), else its
// first mention. One hop from the warm referent to where it is grounded (§3): for "his
// name" this lands on the line that NAMES the figure, which the word "name" never
// reaches by similarity. Returns a unit index, or null when the referent has no locus.
export const localeOf = (doc, refId) => {
  if (!doc?.log || refId == null) return null;
  const { relations } = figureSurface(doc, [refId]);
  const edge = relations.find(r => Number.isFinite(r.idx));
  if (edge) return edge.idx;
  // No bond — fall back to the EARLIEST line that instantiated the referent, read over
  // its appearance CLASS, not the connected id. A later coref merge can root a referent
  // on a late-appearing alias (the naming scene folds "his sister" into the late name
  // Grete — pipeline.js:397), so scanning the raw id alone returns the cursor the
  // connection landed at, not the birth. The locus is the earliest appearance; the
  // connection cursor is always later and must never stand in for it.
  const rep = projectGraph(doc.log).representative || ((id) => id);
  const target = rep(refId);
  const events = doc.log.snapshot ? doc.log.snapshot() : doc.log.events;
  let earliest = null;
  for (const e of events) {
    if (e.op === 'INS' && e.sentIdx != null && rep(e.id) === target) {
      if (earliest == null || e.sentIdx < earliest) earliest = e.sentIdx;
    }
  }
  return earliest;
};

// The document referents retrieval points the line at — the cheap nomination channel
// (§3). Each retrieved span's named figures, in span-rank order, deduped to the
// projection representative. This is what surfaces a definite description's referent
// with no CON edge: the span about "the musician" names the figure, so embedding (or,
// under the hash organ, the shared word) carries the reference the parse cannot.
const nominate = (doc, spans = []) => {
  const out = [];
  const seen = new Set();
  for (const s of spans) {
    for (const id of namedReferents(doc, s.text || '')) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
};

// referenceTarget — the turn's DEF target, read off the cast (no regex, no wordlist).
// `spans` are the turn's retrieval hits (the nomination channel). Returns
// { id, label, locale } in the DOCUMENT's id-space, or null when nothing resolves
// (then the caller keeps its existing anchor/focus — a no-op, byte-identical).
export const referenceTarget = (doc, history, question, spans = []) => {
  if (!doc?.log) return null;

  const nominees = nominate(doc, spans);                 // document ids, span-ranked
  const cast     = conversationCast(history, question);  // conv figures, warmest first

  // Map each conversation figure to the document referent it names (by label, the one
  // currency the two parses share), keeping warmth order. A conv-only figure the
  // document never holds drops out — we can only DEF a referent the document grounds.
  const castDocIds = [];
  const castSeen = new Set();
  for (const c of cast) {
    const ids = namedReferents(doc, c.label);
    const id = ids[0];
    if (id != null && !castSeen.has(id)) { castSeen.add(id); castDocIds.push(id); }
  }
  const castSet = new Set(castDocIds);

  // The rule. Prefer the nominee the conversation has also warmed (the correction and
  // the warmed-description case); else the conversation's warmest figure (the pronoun
  // case); else the top nominee (the not-yet-named description).
  const id = nominees.find(n => castSet.has(n)) ?? castDocIds[0] ?? nominees[0] ?? null;
  if (id == null) return null;

  const labelOf = (i) => doc.admission?.labelOf?.(i) || cast.find(c => namedReferents(doc, c.label)[0] === i)?.label || i;
  return { id, label: labelOf(id), locale: localeOf(doc, id) };
};
