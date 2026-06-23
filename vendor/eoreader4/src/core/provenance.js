// core/provenance.js — me-ness as a type law, not a flag. (SPEC §8)
//
// Self-generated content is ontogenically different: it carries "me-ness." This
// CANNOT be a written flag — a flag is content, and content is forgeable (a
// fabricated memory carries `mine:true` as easily as a real one; the laundering
// door). Me-ness must be CONSTITUTIVE: a property of HOW the event entered the
// log, set at the moment of entry before any content exists to forge. This is
// corollary discharge — the brain recognizes self-generation by the efference-copy
// prediction match (core/self/index.js, enactor/efference.js), not by a label;
// when the match fails (schizophrenia) self-speech is experienced as external. The
// tag was never IN the signal; it was always in the PROVENANCE.
//
//   Provenance = { door, enactment, reentry? }
//
//   door       'perceiver' (exafference, not-me) | 'enactor' (reafference, me)
//   enactment  WHICH continuous enactment produced it
//   reentry?   set when a prior event is re-read now (the indexical edge, below)
//
// This module is the genome's home for the type law itself — pure, dependency-
// free, modality-blind (both doors operate BELOW the modality membrane, so a
// self-generated melody, image, or sentence is me-tagged by the same edge). The
// enactor door EMITS it at commit (enactor/efference.js); the perceiver door tags
// ingest. The witness READS it as a type (src/write/witness.js, §7), it does not
// run it as a policy.

// ── The two doors ────────────────────────────────────────────────────────────
export const PERCEIVER = 'perceiver';   // exafference — the world, unauthored, can ANCHOR
export const ENACTOR   = 'enactor';     // reafference — me, my own output, can NOT witness
export const DOORS = Object.freeze([PERCEIVER, ENACTOR]);

// ── The classifications the type law produces (§8 table) ─────────────────────
export const EXAFFERENCE  = 'exafference';               // perceiver door, current ingest
export const REAFFERENCE   = 'reafference';              // enactor door, current enactment
export const READ_BACK     = 'read-back-of-prior-self';  // a prior enactment, re-read now

// ── The constructor — set at entry, frozen, never edited ─────────────────────
// `enactment` is the id of the continuous enactment (or ingest) that produced the
// event. For a perceiver event it identifies the ingest run; for an enactor event,
// the writing run. The membrane below the modality holons strips modality, so this
// edge carries none.
export const provenance = ({ door, enactment = null, reentry = null } = {}) => {
  if (door !== PERCEIVER && door !== ENACTOR)
    throw new TypeError(`provenance: unknown door ${door}`);
  return Object.freeze({
    door,
    enactment,
    ...(reentry ? { reentry: Object.freeze({ door: reentry.door, enactment: reentry.enactment ?? null }) } : {}),
  });
};

export const fromPerceiver = (enactment = null) => provenance({ door: PERCEIVER, enactment });
export const fromEnactor   = (enactment = null) => provenance({ door: ENACTOR,   enactment });

// ── The indexical hard edge (§8) ─────────────────────────────────────────────
// Me-ness is DATED and INSTANCE-SCOPED. A prior session's output, reloaded as
// context, arrives through the PERCEIVER door NOW but was ENACTOR-generated THEN.
// If reloaded as bare text it looks like fresh world — the exact path the
// sister/mother error laundered forward. So provenance is PERSISTED with the
// durable event record and RESTORED on reload (never re-derived from the reload
// door): a reloaded prior-self event keeps its original enactor door and gains a
// `reentry` marking the perceiver door it came back through now.
export const reenter = (prior, { door = PERCEIVER, enactment = null } = {}) => {
  const origin = prior && prior.door ? prior : provenance({ door: ENACTOR, enactment: prior?.enactment ?? null });
  return Object.freeze({
    door: origin.door,
    enactment: origin.enactment ?? null,
    reentry: Object.freeze({ door, enactment }),
  });
};

// ── The type law: admissibility is a function of provenance (§8 table) ────────
// classify reads the provenance and returns its kind. The witness consults this;
// it does not store an admissibility field (a stored field is forgeable content).
//
//   origin door         enactment relation              → classification
//   perceiver           current ingest                  → exafference   (anchors)
//   enactor             current enactment               → reafference   (cannot witness)
//   enactor→perceiver   prior enactment, re-read now     → read-back-of-prior-self
export const classify = (prov) => {
  if (!prov || !prov.door) return EXAFFERENCE;           // an untagged event is a plain ingest observation
  // A re-read event carries its ORIGIN door plus a reentry edge. A prior ENACTION
  // re-read now is read-back-of-prior-self; a re-read of a prior PERCEPTION is still
  // world (exafference) — so the origin door, not the reentry door, decides.
  if (prov.reentry) return prov.door === ENACTOR ? READ_BACK : EXAFFERENCE;
  if (prov.door === ENACTOR) return REAFFERENCE;
  return EXAFFERENCE;
};

// CONTINUITY (structure) — every provenance is admissible for continuity: the
// output re-enters, a prior self re-reads, the world arrives. Structure is the
// open question (§8); nothing is barred from organizing the next step.
export const canOrient = (_prov) => true;

// EVIDENCE (the witness) — the TYPE LAW. Reafferent events are NOT OF THE TYPE
// that can witness an exafferent claim — the way a motor command is not the type
// that can be sensory confirmation. ONLY exafference (the perceiver door, current
// ingest) anchors. Reafference and read-back-of-prior-self never witness, and a
// read-back is NEVER silently promoted to either (§8). The witness-does-not-decide
// rule is therefore not enforced as a policy; it is a CONSEQUENCE of the type.
export const canWitness = (prov) => classify(prov) === EXAFFERENCE;

// A read-back is admissible for continuity but inadmissible as evidence, and the
// one classification that must never be silently promoted. Surfaced for the
// witness's audit so the multi-instance self/world line is legible, not implicit.
export const isReadBackOfPriorSelf = (prov) => classify(prov) === READ_BACK;
export const isMine = (prov) => classify(prov) !== EXAFFERENCE;   // reafference OR read-back-of-prior-self

// ── Persist + restore (the durable edge) ─────────────────────────────────────
// Provenance is persisted with the durable event record and restored on reload —
// it is NOT re-derived from the reload door. serialize/restore are the round-trip;
// restoreOnReload applies the indexical edge: a durable enactor event, loaded NOW
// through the perceiver door, comes back classified read-back-of-prior-self, never
// as fresh world. This MUST be nailed before any cross-session memory touches the
// witness (the P6 gate).
export const serializeProvenance = (prov) => (prov ? { ...prov } : null);

export const restoreProvenance = (raw) =>
  raw == null ? null
  : Object.freeze({
      door: raw.door,
      enactment: raw.enactment ?? null,
      ...(raw.reentry ? { reentry: Object.freeze({ door: raw.reentry.door, enactment: raw.reentry.enactment ?? null }) } : {}),
    });

// Load a durable record's provenance back through the CURRENT door. A perceiver
// observation reloads as itself (still world). An enactor (prior-self) record
// reloads carrying a reentry through the current perceiver door — read-back, not
// world. This is the function the reload path calls instead of re-tagging by the
// door it happened to arrive through.
export const restoreOnReload = (raw, { door = PERCEIVER, enactment = null } = {}) => {
  const prior = restoreProvenance(raw);
  if (!prior) return null;
  if (prior.door === ENACTOR && !prior.reentry) return reenter(prior, { door, enactment });
  return prior;
};
