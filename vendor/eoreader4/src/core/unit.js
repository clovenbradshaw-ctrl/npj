// The bare unit — the floor of INGESTION, the input membrane (reshape §1/§2/§8.0).
//
// Two floors, not one. The floor of MEANING is the proposition (the triadic
// minimum); the floor of INGESTION is below it: the bare unit. A unit has only
// the two properties needed to *begin* discovery and nothing else —
//
//   comparable   two units are the same or different      (identity)
//   ordered      there is a next                          (sequence, via `t`)
//
// It carries NO modality, NO origin, NO meaning, NO structure. That is the
// guarantee: the unit is too minimal to leak. A sense organ (organs/in/*)
// ingests its modality into a stream of these — the audio organ windows a
// waveform, the vision organ fields pixels, the text organ marks graphemes —
// and hands the core a stream that betrays nothing of where it came from. The
// core discovers the proposition ABOVE this stream, against the noise null; the
// organ never delivers it. See `proposition.js` for the floor of meaning.
//
//   unit  = { key, t }            key: comparable token · t: order index
//
// Frozen as the input contract: an ingester MAY add nothing to a unit. Anything
// richer than identity-and-order is structure, and structure is the core's
// emergent work, not the organ's.

// Construct a bare unit. `key` is the comparable token (same/different is the
// only question the core may ask of it); `t` is the order index (there is a
// next). The result is frozen — a unit is immutable once ingested.
export const makeUnit = (key, t) => Object.freeze({ key, t });

// Is this a bare unit and nothing more? The membrane test (§7) leans on this:
// an organ that smuggled structure into its units fails here, because a unit
// with extra slots is not a bare unit.
export const isUnit = (u) =>
  !!u && typeof u === 'object' &&
  'key' in u && 't' in u &&
  typeof u.t === 'number' &&
  Object.keys(u).length === 2;

// Comparable: the ONE question the core may ask of two units — same or different.
// No ordering of keys, no distance between keys, no semantics; only identity.
export const sameUnit = (a, b) => isUnit(a) && isUnit(b) && a.key === b.key;

// Ordered: stream-distance, the replacement for "per sentence" everywhere the
// core measures reach (reshape §4/§8.3). The core counts units (and the
// structure it has discovered), never sentences — "sentence" is a learned text
// convention, not a core primitive. Distance is along the order index `t`.
export const streamDistance = (a, b) => Math.abs(a.t - b.t);

// Freeze a raw stream into the input contract: re-key by position so `t` is a
// dense order index, and drop everything but key-and-order. Pass either bare
// keys (strings/numbers) or partial units; the result is a frozen unit stream
// an organ can hand straight to the core.
export const unitStream = (items) =>
  Object.freeze(items.map((it, i) =>
    makeUnit(it && typeof it === 'object' && 'key' in it ? it.key : it, i)));

// A unit stream is ordered iff its order indices strictly increase — there is
// always a next, and never a tie or a step back. The weakest possible coherence
// check on a stream, and the only one the membrane is allowed to enforce.
export const isOrdered = (units) => {
  for (let i = 1; i < units.length; i++)
    if (!(units[i].t > units[i - 1].t)) return false;
  return true;
};
