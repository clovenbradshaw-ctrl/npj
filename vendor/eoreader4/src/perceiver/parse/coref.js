// Referent resolution as physics, not decision — now a two-channel field.
//
// A pronoun does not *pick* an antecedent. Each mentioned entity leaves a
// decaying trace — a mass that grows on every sighting and falls off with
// reading distance (the same γ kernel the graph runs on). A pronoun induces a
// FIELD: a weighted distribution over the candidates currently in play. We
// never commit "he = Gregor"; we report the field, and the strongest weight
// becomes the bond's coupling. As evidence accumulates the field concentrates,
// so the weight asymptotically approaches 1 — truth as a limit, not a verdict.
//
// The field is provenance-aware. Each referent tracks two channels:
//
//   grounded       span-witnessed sightings (lexical, geometric readers). The
//                  witness that can clear the commit floor. Mass up to 1.0.
//   conversational talker-witnessed mentions. Warmth and salience, capped at the
//                  model reader's coupling ceiling, never floor-clearing alone.
//
// A model may have an opinion about a referent. It does NOT write that opinion
// into the field: a witness observes, it does not decide. Its influence enters
// as a deposition — `noteConversational` adds tagged, decaying, capped mass that
// the fold can always subtract and re-check (the §8 invariant). `reinforce`,
// once the inert WRONG DOOR (a raw mass write), is now wired as exactly that
// deposition: a talker mention deposits conversational mass, never grounded.

import { CONVERSATIONAL_CAP } from '../../converse/index.js';

export const createCorefField = ({
  gamma = 0.7, maxDist = 8,
  convGamma = gamma,            // conversational warmth decays at least as fast
  convCap = CONVERSATIONAL_CAP, // and never deposits above the model reader's cap
  descGamma = 0.97,             // standing descriptions decay ~glacially
  descMaxDist = 400,            // a role can be reactivated discourse-wide
  // Whether two role keys conflict on one bearer ("sister" vs "mother"). INJECTED,
  // never hardcoded: coref must not KNOW the algebra, only consult it. The default
  // asserts no conflicts (a leaf claims no knowledge it wasn't handed); the wiring
  // layer — which is allowed to see both holons — passes one backed by the typing
  // bridge's areDisjoint, so the conflict knowledge lives in exactly one place.
  rolesConflict = () => false,
} = {}) => {
  const traces = new Map(); // id → { lastIdx, grounded, conversational }
  // descriptors: roleKey ("sister") → { ownerId|null, lastIdx, mass, bound:id|null }
  // A THIRD channel — standing descriptions. A descriptor ("his sister") is
  // neither a pronoun (fleeting, maxDist:8) nor a name (grounded). It names a
  // ROLE, persists across the whole discourse, and only later (Metamorphosis
  // s189) does the bearer get a proper name (Grete). It must outlive the γ kernel
  // — 8 sentences cannot bridge a 118-sentence epithet→name gap — so descriptors
  // retain on a slow kernel and resolve by ROLE continuity, never by recency.
  // They deposit CONVERSATIONAL mass only: a descriptor witnesses a *role*, not a
  // span; it can warm a bond, never clear the commit floor (§8 subtract-and-check
  // stays intact — descriptor mass lives in the channel the fold strips).
  const descriptors = new Map();

  // Decay both channels to `sentIdx`, then return the trace for a fresh deposit.
  const touch = (id, sentIdx) => {
    const tr = traces.get(id) || { lastIdx: sentIdx, grounded: 0, conversational: 0 };
    const d = Math.max(0, sentIdx - tr.lastIdx);
    tr.grounded      *= Math.pow(gamma, d);
    tr.conversational *= Math.pow(convGamma, d);
    tr.lastIdx = sentIdx;
    traces.set(id, tr);
    return tr;
  };

  // Grounded deposit — a span-witnessed sighting. Adds this sighting's unit mass.
  const note = (id, sentIdx) => { touch(id, sentIdx).grounded += 1; };

  // Conversational deposit — a talker-witnessed mention. Tagged (its own
  // channel), decaying, capped at the coupling ceiling. It adds mass; it does
  // not set mass. Warmth, never witness.
  const noteConversational = (id, sentIdx, w = convCap) => {
    touch(id, sentIdx).conversational += Math.min(convCap, Math.max(0, w));
  };

  // The door, redrawn (was the inert WRONG DOOR). A model nudge does not write
  // mass directly; it deposits a capped, tagged conversational mention. This is
  // the witness-does-not-decide rule holding at the field.
  const reinforce = (id, w, sentIdx) => noteConversational(id, sentIdx ?? 0, w);

  // Is `id` already bound to a role that CONFLICTS with `roleKey` (rolesConflict)?
  // The injected predicate is the only place algebra knowledge enters — coref
  // consults it, never imports it. Used both to guard a unify and to eliminate a
  // candidate in the by-elimination trigger.
  const boundToConflicting = (id, roleKey) => {
    for (const [rk, d] of descriptors)
      if (d.bound === id && rk !== roleKey && rolesConflict(roleKey, rk)) return true;
    return false;
  };

  // --- descriptor channel -------------------------------------------------
  // Record a standing-description sighting: a role term ("sister"/"mother"),
  // optionally with a resolved owner ("Gregor's sister" → ownerId gregor-samsa;
  // "his sister" → ownerId = field(sentIdx)[0] ONLY if it cleared a margin, the
  // caller's Frame-A guard). Mass accumulates on the role's own slow kernel.
  const noteDescriptor = (roleKey, sentIdx, ownerId = null, { named = false } = {}) => {
    const dr = descriptors.get(roleKey)
      || { ownerId: null, ownerNamed: false, lastIdx: sentIdx, mass: 0, bound: null };
    const d = Math.max(0, sentIdx - dr.lastIdx);
    dr.mass = dr.mass * Math.pow(descGamma, d) + 1;
    dr.lastIdx = sentIdx;
    // A NAMED owner ("Gregor's sister") is authoritative and sticky; a pronoun-
    // resolved owner ("his sister") is a guess that fills the slot only while no
    // name has claimed it, and never overwrites a name — regardless of order
    // (the pronoun epithet appears 51 sentences before the named one).
    if (ownerId && (named || !dr.ownerNamed)) {
      dr.ownerId = ownerId;
      if (named) dr.ownerNamed = true;
    }
    descriptors.set(roleKey, dr);
    // Already bound to a name → keep depositing warmth onto that referent so the
    // role's recurrences keep the bearer salient.
    if (dr.bound) noteConversational(dr.bound, sentIdx, convCap * 0.5);
  };

  // Unify a descriptor with a later-introduced NAME by ROLE, not recency. Returns
  // the bond {id, w, via} or null. Guarded against false-merge:
  //  - candidate role/gender must be COMPATIBLE with the role term (caller-decided)
  //  - candidate must be DISTINCT from the descriptor's owner (can't be one's own sister)
  //  - the role must not be STALE beyond descMaxDist (a lapsed epithet does not bind)
  //  - role EXCLUSIVITY: a name already bearing a role this one conflicts with
  //    (rolesConflict) cannot take it — Mrs Samsa, already the 'mother', is refused
  //    'sister'. This is what separates two same-gender referents (the live Grete /
  //    Mrs Samsa case) without any gender channel: role + distinctness suffice.
  //  - binds at conversational tier, defeasible — the fold can subtract and re-check.
  //
  // ASSUMES ONE BEARER PER ROLE: a role already bound to a different name refuses a
  // second. Correct for Metamorphosis (one sister, one mother) but WRONG for a text
  // with two siblings ("his brother" × 2). That is a real limit, left as a caveat,
  // not solved here — a multi-bearer role needs an instance model the field lacks.
  const unifyDescriptor = (roleKey, nameId, sentIdx, { compatible = true } = {}) => {
    const dr = descriptors.get(roleKey);
    if (!dr || !compatible) return null;
    if (dr.ownerId && dr.ownerId === nameId) return null;          // can't be your own sister
    if (sentIdx - dr.lastIdx > descMaxDist) return null;           // role too stale to bind
    if (dr.bound && dr.bound !== nameId) return null;              // one bearer per role (caveat above)
    if (boundToConflicting(nameId, roleKey)) return null;          // role exclusivity, predicate-injected
    dr.bound = nameId;
    const decayed = dr.mass * Math.pow(descGamma, Math.max(0, sentIdx - dr.lastIdx));
    const w = Math.min(convCap, convCap * Math.tanh(decayed / 4));  // accumulated standing → warmth
    noteConversational(nameId, sentIdx, w);
    return { id: nameId, w, via: `descriptor:${roleKey}` };
  };

  // The unify TRIGGER — role-exclusivity BY ELIMINATION, no proximity term. The
  // live data is decisive: binding "sister" to the field-nearest name picks the
  // MOTHER 79/82 and Grete 0/82 — proximity is inverted, because the mother
  // orbits the protagonist's room. So a role binds a name only when (1) the role
  // has an established NAMED owner ("Gregor's sister"), and (2) exactly ONE
  // admitted referent compatible with the role is not already bound to a disjoint
  // role. Mrs Samsa, consumed by `mother`, is eliminated from `sister`; Grete is
  // what remains. If MORE THAN ONE candidate survives, HOLD — abstain, never
  // guess (a two-sister text correctly refuses to fabricate). The candidate set
  // (admitted ids) is supplied by the assembly layer; the fixpoint lets one
  // binding eliminate a candidate and unblock another in the same sweep.
  const bindDescriptorsByElimination = (admittedIds, sentIdx) => {
    const ids = [...new Set(admittedIds)];
    const bonds = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const [roleKey, dr] of descriptors) {
        if (dr.bound || !dr.ownerNamed) continue;                  // needs an established named owner
        const survivors = ids.filter(id => id !== dr.ownerId && !boundToConflicting(id, roleKey));
        if (survivors.length !== 1) continue;                      // 0 or >1 → hold (abstain)
        const bond = unifyDescriptor(roleKey, survivors[0], sentIdx, { compatible: true });
        if (bond) { bonds.push({ ...bond, role: roleKey, owner: dr.ownerId }); changed = true; }
      }
    }
    return bonds;
  };

  // Read the field at a position, weighting each candidate by `pick(g, c)` over
  // its decayed grounded (g) and conversational (c) mass; normalised, hottest
  // first. A pure measurement of the current traces.
  const read = (sentIdx, pick) => {
    const cands = [];
    for (const [id, tr] of traces) {
      const dist = sentIdx - tr.lastIdx;
      if (dist < 0 || dist > maxDist) continue;
      const g = tr.grounded * Math.pow(gamma, dist);
      const c = tr.conversational * Math.pow(convGamma, dist);
      const mass = pick(g, c);
      if (mass > 0) cands.push({ id, mass, grounded: g, conversational: c });
    }
    const Z = cands.reduce((s, x) => s + x.mass, 0) || 1;
    for (const x of cands) x.w = x.mass / Z;
    cands.sort((a, b) => b.w - a.w);
    return cands;
  };

  // Total warmth (grounded + conversational) — the read used for ranking and
  // pronoun resolution. The talker can warm the room, so the total reflects
  // conversational salience. Each candidate also carries its channel split so
  // the audit (and the subtract-and-check) can see how much is echo.
  const field = (sentIdx) =>
    read(sentIdx, (g, c) => g + c).map(({ id, w, grounded, conversational }) =>
      ({ id, w, grounded, conversational }));

  // Grounded mass only — the witness that can clear the commit floor, and the
  // read the fold uses for the subtract-and-check. It is invariant under
  // conversational deposits: talker warmth cannot move this number.
  const fieldGrounded = (sentIdx) =>
    read(sentIdx, (g) => g).map(({ id, w }) => ({ id, w }));

  // Subtract-and-check: would `id` still be the winning reading, clearing
  // `floor`, on grounded mass alone? If a near-floor reading clears only with
  // talker warmth, the conversation has talked itself into it — the caller
  // demotes it to held. The check is cheap because the channels are separate.
  const survivesSubtraction = (id, sentIdx, floor = 0) => {
    const g = fieldGrounded(sentIdx);
    const top = g[0];
    const me = g.find((c) => c.id === id);
    return !!me && !!top && me.id === top.id && me.w >= floor;
  };

  // Read a held descriptor's state (owner, accumulated mass, bound name) — a
  // frozen copy for inspection and for the trigger's by-elimination reasoning.
  const descriptorState = (roleKey) => {
    const d = descriptors.get(roleKey);
    return d ? Object.freeze({ ...d }) : null;
  };

  return {
    note, noteConversational, reinforce,
    noteDescriptor, unifyDescriptor, bindDescriptorsByElimination, descriptorState,
    field, fieldGrounded, survivesSubtraction,
  };
};
