// The proposition — the floor of MEANING, the first emergent product (reshape §2/§8.0).
//
// A proposition is the triadic minimum: the least structure that is a coherent
// distinction. Three slots and a sign —
//
//   substrate     what the distinction is drawn on        (the subject)
//   relation      the differentiating tie                 (the predicate/via)
//   differentia   what it is drawn against                (the object)
//   polarity      whether the tie holds or is carved void (+ / −)
//
// This is the core's emergent currency. It is NOT handed in by a sense organ —
// the organ emits bare units (`unit.js`); the core DISCOVERS the proposition
// above the unit stream, against the noise null (a structure that does not beat
// the null is hallucination, refused). Output organs (organs/out/*) render this
// currency back into a modality with the gate measuring it at the inner face.
//
// Frozen as the emergent currency: this is the shape every modality reduces to
// in the middle, which is why the core is universal — it discovers the triadic
// minimum from bare units and operates on the triadic minimum with the triadic
// minimum, recurring at every scale.

// The three slots of the triadic minimum, named. A real distinction needs all
// three; fewer is below the floor of meaning (a bare unit, or a half-formed
// pairing that has not yet cleared the null).
export const PROPOSITION_SLOTS = Object.freeze(['substrate', 'relation', 'differentia']);

// Construct a proposition (the emergent currency). Polarity defaults positive ·
// realis; a carved absence (`A --rel--> [void]`) is the negative pole, content
// in its own right. The result is frozen — once emerged, a proposition is a fact
// about what the core found, not a mutable buffer.
export const makeProposition = ({ substrate, relation, differentia, polarity = '+' }) =>
  Object.freeze({ substrate, relation, differentia, polarity });

// Is this the triadic minimum — all three slots present and a polarity? Anything
// missing a slot has not reached the floor of meaning. The membrane test (§7)
// and the emergence gate both ask this of a candidate before committing it.
export const isProposition = (p) =>
  !!p && typeof p === 'object' &&
  p.substrate != null && p.relation != null && p.differentia != null &&
  (p.polarity === '+' || p.polarity === '-');

// Bridge from the log's edge currency (the SIG/CON event: src/via/tgt/polarity)
// to the triadic-minimum contract, so a downstream consumer can read the
// proposition shape off an emergent edge without the core having to store two
// representations. `polarity` on an edge is the verbatim channel; absent → '+'.
export const propositionOfEdge = (e) =>
  makeProposition({
    substrate:   e.src ?? e.from,
    relation:    e.via ?? e.rel,
    differentia: e.tgt ?? e.to,
    polarity:    e.polarity === 'negative' || e.polarity === '-' ? '-' : '+',
  });
