// Proposition addressing — the argument-span reading and the element positioning.
//
// TWO SENSES OF SPAN (§1). A *retrieval* span is a whole sentence pulled by the
// retriever at question time, scored by cosine, fed to the prompt — downstream. An
// *argument* span is the subject-stretch or object-stretch inside a clause, the
// agent and the patient — parse-time, upstream, the thing that feeds the structural
// positioning. They are not the same span and do not live at the same place. This
// module is the argument span.
//
// THE LOGGED CLAUSE SEG (§3). The v1 emitter resolved subject and object inside the
// SVO emitter and emitted only the resulting CON, so the log showed the bond but
// not the parse that produced its endpoints. verify-before-build confirmed eoreader4
// does the same — the argument spans were computed and thrown away. So we add the
// event: a clause-level SEG, written *before* the CON, recording that this stretch
// was read as the subject, this as the object, here is the verb, with offsets back
// into the sentence. This completes the witness chain — raw text → sentence cut →
// argument-span cut → bond — so a CON edge can be walked back to the text its
// endpoints were read from. The argument-span SEG is a READING, not a fact: the
// clause has no true subject-span in the world; it has the verbatim text (Given)
// and the spans a reader cut from it (Meant). So it is tagged a perception,
// witnessed by the extractor that produced it (`reader`), at the sentence (the
// cursor), carrying that extractor's confidence — defeasible, re-perceivable.
//
// THE SKELETON (§9). The accurate span-tagging layer (a GLiNER-style tagger) is not
// a confident pick — browser-runnable taggers are a thin, shifting niche, to be
// searched, tested, and size/latency-measured before committing — so eoreader4
// runs only the cheap structural sweep (the regex SVO of relations.js) today. And
// cell-naming is meaning-only: the cell within each position is a centroid argmax
// in MiniLM space (classify/), no-commit under the hash organ. What is payable now
// is the structural and logging half: extract the spans, log them walkable, and
// fill the three positions by grammar — holding the cells at no-commit.

// The extractor of record for the cheap layer — the regex SVO sweep. A second,
// accurate layer (real span tagging) would deposit under its own reader id, and the
// fold would weigh the two, discounting where they share evidence (§2, §6). That
// layer is research-gated (§9); today there is one witness.
export const SVO_EXTRACTOR  = 'svo-regex';
export const SVO_CONFIDENCE = 0.6;   // moderate fidelity: a tagger, not a parser (§2)

// argumentSpanSeg — the logged clause SEG (§3). `args` is { subject, verb, object,
// op } from the SVO emitter; `op` is the bond it precedes (CON or SIG), kept so a
// downstream geometric namer argmaxes the right band.
export const argumentSpanSeg = (args, sentIdx, {
  extractor = SVO_EXTRACTOR, confidence = SVO_CONFIDENCE,
} = {}) => Object.freeze({
  op: 'SEG',
  kind: 'argspan',           // the cut that read S/V/O — distinct from a retract SEG
  reader: extractor,         // witnessed by the extractor — a perception, not a fact
  confidence,
  sentIdx,                   // the sentence cut below it — the text the spans were read from
  depicts: args.op || 'CON', // the bond this argument-span cut feeds
  subject: args.subject,
  verb: args.verb,
  object: args.object,
});

// positionElements — §4 Step C, the structural half. Assign the elements to the
// Ground / Figure / Pattern positions by an INFORMATION-STRUCTURE reading of the
// clause (§4C), not by measurement: the SUBJECT is the given — it sets the terms the
// clause is predicated of — so it is the Ground; the OBJECT is the new element picked
// out and tested against those terms, so it is the Figure; the VERB is the relation
// that binds them, the recurring type, so it is the Pattern. Each position then points
// at one verbatim span of the line.
//
// THE TWO AXES (§5). These role positions are NOT the operator-grain bands the
// classifier measures the 27 cells in (Ground = NUL/INS, Figure = SEG/DEF/SIG/EVA,
// Pattern = CON/SYN/REC; classify/bands). They share three names over two different
// axes — a role reading (given / new / relation) projected onto grammar, over the
// grain axis (how zoomed-in a referent is). They coincide at Ground (the subject is
// an INS existent) and at Pattern for a bond verb (a relating verb is a CON); they
// part company at Figure — the object is an existent, not an act. That divergence is
// the grain caveat, kept as an honest seam, not smoothed over. The cell within each
// position is still named by GEOMETRY, meaning-only, held at no-commit today.
//
// THE LANE (§5, §8). Structure assigns the position; geometry only names the cell
// and breaks ties. Geometry never reassigns a position that the grammar set — if the
// grammar says the verb is the pattern, the embedder names *which* pattern cell; it
// does not move the verb to the ground because it scored higher there. This function
// delivers the positions filled by elements and never names a cell, so the lane
// cannot be crossed here: there is no geometry in it to overrule grammar.
export const positionElements = (args) => {
  const held = (position) => ({
    position,
    cell: null,                                      // named by geometry when live
    reason: 'meaning-only — held at no-commit (§5, §9)',
  });
  // Ground ← subject (the given), Figure ← object (the new): the resolved existents
  // in their information-structure roles. Pattern ← verb (the relation), a span with
  // no referent id of its own.
  const given = [args?.subject].filter((e) => e && e.id);
  const newer = [args?.object].filter((e) => e && e.id);
  const verb  = [args?.verb].filter(Boolean);
  return Object.freeze({
    ground:  Object.freeze({ ...held('Ground'),  elements: Object.freeze(given) }),
    figure:  Object.freeze({ ...held('Figure'),  elements: Object.freeze(newer) }),
    pattern: Object.freeze({ ...held('Pattern'), elements: Object.freeze(verb) }),
    assigned_by: 'information-structure',   // role under given/new/relation, not grain
  });
};

// Walk a logged argument-span SEG back to the verbatim text its spans were read
// from, given the sentence string. Returns true only if every recorded span still
// slices to its stored text — the witness chain holding (§3). The audit/log uses
// this to prove a bond is walkable; a false here is a parse the offsets no longer fit.
export const argumentSpansHold = (seg, sentence) => {
  if (!seg || seg.kind !== 'argspan' || typeof sentence !== 'string') return false;
  const ok = (sp) => !sp || sentence.slice(sp.start, sp.end) === sp.text;
  return ok(seg.subject) && ok(seg.verb) && ok(seg.object);
};
