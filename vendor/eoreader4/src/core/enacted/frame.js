// A frame — the unit the enacted loop runs over.
//
// A frame is the set of terms the reading has established at a layer, at a point
// in read time. It is NOT the depicted DEF (a clause's classified phasepost cell,
// classify/) — that is content, a perception of what a clause reports. A frame is
// the reading's OWN standing commitment: "as of here, this layer is about these
// terms," against which the next particular is tested. The depicted loop is the
// transformation classified in the text; the frame belongs to the enacted loop,
// the reading's act of establishing its terms (§2).
//
// The frame carries the two things the loop turns on: a running STRAIN
// accumulator (the sum of surprise from EVAs tested against it) and the REC
// THRESHOLD it has not yet crossed. When strain reaches threshold the frame can no
// longer hold its terms and the owning layer RECs it (loop.js) — anomaly
// accumulation to crisis, the protective belt giving way (§1).
//
// The live frame is mutable in exactly one field — `strain` — because strain is
// inherently a running sum over read time. Everything else is fixed at the cursor
// the frame was set. The log records frozen SNAPSHOTS (snapshotFrame); the live
// accumulator lives only inside the loop, and the fold reconstitutes it by replay.

// THE LEAK — strain is a LEAKY integral, not a lifetime sum. Before each EVA
// accrues, the standing strain forgets at `leak` per cursor: ∫ e^{−(t−τ)/λ} s(τ)dτ
// in discrete form. So a frame breaks on a temporal CLUSTER of anomaly — a crisis,
// Kuhn's burst — not on a long document's running total. Without the leak, document
// LENGTH silently sets the break: enough spaced anomalies overwhelm any frame. This
// is the arrow-of-time correction (the same honest decay the field runs on),
// applied to the integral the loop fires on. λ near 1 forgets slowly (a long
// memory, a wide crisis window); lower forgets fast. A measured default, tunable.
export const DEFAULT_STRAIN_LEAK = 0.9;

export const createFrame = ({ layer, cursor, terms = [], threshold, leak = DEFAULT_STRAIN_LEAK }) => ({
  layer,
  cursor,                                 // the read-time point the frame was set at
  terms: Object.freeze([...terms]),       // the terms this layer currently stands on
  threshold,                              // the REC threshold — the size of the belt
  leak,                                   // strain's per-cursor retention (the leaky integrator)
  strain: 0,                              // running leaky Σ surprise from EVAs against it
  strainCursor: cursor,                   // read-time of the last strain update (drives the leak)
  dimStrain: new Map(),                   // per-dimension leaky strain — the axis the frame breaks along
});

// A frozen snapshot for the log — a frame as it stood, without its live mutable
// accumulator. What an enacted DEF or REC event carries; replay reads it back.
export const snapshotFrame = (frame) => Object.freeze({
  layer: frame.layer,
  cursor: frame.cursor,
  terms: frame.terms,
  threshold: frame.threshold,
  leak: frame.leak,                       // carried so the fold leaks exactly as the live run did
});

// Two frames share terms when their term-sets are equal, order-insensitive. Used
// by the thrash detector (§11): a layer whose RECs keep re-installing a term-set it
// just left is oscillating between two frames, not reading — the threshold error
// made visible, never mistaken for genuine turbulence.
export const sameTerms = (a, b) => {
  const sa = new Set(a || []), sb = new Set(b || []);
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
};
