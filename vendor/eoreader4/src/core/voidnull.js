// The VOID boundary — a derived, online noise null.
//
// The abstention readers (equivalence.js, motion.js) used to take a CONSTANT
// threshold: `minOverlap` / `nullExtent`, a number the caller computed by hand
// (run many noise instances, take the max) and passed in. A constant is a number
// you invent. This module replaces it with a number the signal computes for you.
//
// The rule is one sentence: a proposed structure must exceed what the void would
// produce on its own, or it is void. The "void" is the field's own non-cohering
// background — the also-ran overlaps, the snow chains, the noise that did not
// cohere. Their scores are samples of what chance produces. The boundary is a
// high quantile of THAT distribution, estimated as the reading proceeds. SYN fires
// when the proposed structure beats the noise null; NUL holds it and VOID asserts
// absence when it does not.
//
// This is the Born rule for the engine. The noise null is the amplitude
// distribution; the quantile is the Born probability; the reading is the
// measurement. The only human input is `alpha`, the tolerated probability of
// mistaking noise for structure — a policy, not an overlap value. The physics
// computes the threshold that delivers it.
//
// Four requirements, each guarding a specific failure (see §4 of the spec):
//
//   • leave-one-out  — estimate a candidate's null from the background EXCLUDING
//     that candidate, so a real shape never has to outrank itself.
//   • extreme-value  — the thing that fools you is the LARGEST chance structure
//     (the longest snow chain), a max over many draws, not a typical draw. The
//     null is the (1-α) bound on the max of N background draws, ≈ μ + z·σ with
//     z = Φ⁻¹((1-α)^(1/N)) — the multiple-comparison / extreme-value correction.
//   • robust to a few real structures — when several real shapes are present they
//     are background to each other and would poison the floor. Fit the null to the
//     BULK (the lower mode), cutting the handful of high outliers at the first gap
//     a noise bulk would almost never produce. A few outliers must not raise the
//     bar for everyone.
//   • causal & adaptive — estimate from the field as read SO FAR, never the whole
//     signal. `createNoiseFloor` accumulates the background as a streaming estimate
//     and the threshold tracks the live noise, drifting as it drifts.
//
// One firing rule, modality-blind, fed a modality-specific score. Audio overlaps
// are bounded fractions (k / partials) — an additive grain, read on a LINEAR scale.
// Video extents are unbounded pixel counts, heavy-tailed under percolation — read
// on a LOG scale so the 35%-snow tail does not defeat the projection. The grain
// (the finest distinction) is DERIVED from each signal's own discretisation — one
// partial out of the query, one pixel of area — never invented.

// ---- math: streaming-friendly moments, robust location, inverse normal CDF ----

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const std  = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const median = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

// Inverse standard-normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
// Turns a Born probability into the number of σ above the mean that delivers it.
const invNormCdf = (p) => {
  if (p <= 0) return -38;
  if (p >= 1) return 38;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};

// The extreme-value z: how many σ above the bulk mean the max of N chance draws
// reaches at the (1-α) level. P(max of N > μ+zσ) = α  ⇒  Φ(z)^N = 1-α.
// This single term carries both the multiplicity (the ln N from "max of many")
// and the tolerance (the ln 1/α from alpha): the snow case is a max-order-statistic
// problem, and z grows with N precisely so the longest-of-many chain sits AT it.
export const extremeValueZ = (N, alpha) => invNormCdf(Math.pow(1 - alpha, 1 / Math.max(2, N)));

// Below this many background samples the noise floor cannot be known: abstain
// (NUL + VOID), never SYN. Cold start approaches the boundary from below — assume
// nothing until the void is measured. A contaminated bulk (almost all real
// structure, little noise) trips the same guard: a thin background is itself a VOID.
export const MIN_SAMPLES = 4;

// A jump larger than GAP·(bulk spacing) marks the edge of the noise bulk: above it
// sit "a handful of genuine high-scoring structures" (the other octaves), which are
// trimmed so they do not poison the floor. A smooth chance tail (snow at any
// density) has no such gap and is kept whole — exactly why the 35% chain, merely
// the longest of many, stays inside its own null and fires VOID.
const GAP = 2.5;

// ---- the derived null ------------------------------------------------------

// Estimate the noise null from a background of structure scores.
//
//   background  the also-ran scores (samples of what chance produces)
//   scale       'linear' (bounded scores, e.g. overlaps) | 'log' (heavy-tailed
//               positive scores, e.g. pixel extents under percolation)
//   alpha       tolerated false-positive rate; the quantile is 1-α
//   N           the competition size for the extreme-value correction (how many
//               chance structures the max is taken over). Defaults to the sample count.
//   grain       the finest meaningful difference in the score's own units (derived
//               from the signal's discretisation); floors the projection so a single
//               quantisation step above a flat bulk is not mistaken for structure.
//   leaveOut    a candidate score to exclude (leave-one-out) before estimating.
//
// Returns the threshold a proposed structure must EXCEED to fire SYN. Returns
// Infinity to abstain (cold start / thin background) — the engine then holds NUL
// and asserts VOID rather than forcing a SYN off a null it cannot trust.
export const deriveNull = (background, { scale = 'linear', alpha = 0.01, N, grain = 0, leaveOut = null } = {}) => {
  let xs = background.filter(x => Number.isFinite(x) && (scale !== 'log' || x > 0));
  if (leaveOut != null) {
    const i = xs.findIndex(x => Math.abs(x - leaveOut) < 1e-12);
    if (i >= 0) xs.splice(i, 1);
  }
  if (xs.length < MIN_SAMPLES) return Infinity;          // cold start → abstain

  const n = N || xs.length + 1;
  const z = extremeValueZ(n, alpha);
  const toW   = scale === 'log' ? Math.log : (x) => x;   // work in the modality's natural scale
  const fromW = scale === 'log' ? Math.exp : (x) => x;
  const w = xs.map(toW).sort((a, b) => a - b);

  // Cut the bulk at the first gap a noise bulk would not produce, fitting only the
  // lower mode so a few real structures (the other octaves) do not raise the bar.
  const m = median(w);
  const lowDev = w.filter(x => x <= m).map(x => m - x);   // one-sided spread, immune to upper outliers
  const seedFloor = scale === 'log'
    ? (grain > 0 ? Math.log(1 + grain / Math.max(median(xs), grain)) : 1e-9)
    : grain;
  const seed = Math.max(mean(lowDev) * 1.2533, seedFloor, 1e-9);
  let cut = w.length;
  for (let i = Math.floor(w.length / 2); i < w.length - 1; i++) {
    if (w[i + 1] - w[i] > GAP * seed) { cut = i + 1; break; }
  }
  const bulkW = w.slice(0, Math.max(cut, Math.ceil(w.length / 2)));   // always keep ≥ the lower half
  if (bulkW.length < MIN_SAMPLES) return Infinity;       // contaminated/thin bulk → abstain

  const bulkLin = bulkW.map(fromW);
  // The extreme-value projection on the working scale catches heavy tails (35% snow);
  // the linear-grain projection floors it so a flat low-density bulk is not mistaken
  // for structure yet a faint real shape still clears. The boundary is the max.
  const projection = fromW(mean(bulkW) + z * std(bulkW));
  const grainFloor = mean(bulkLin) + z * grain;
  return Math.max(projection, grainFloor);
};

// ---- the streaming estimator: causal, adaptive, updated each step ----------

// Maintain the background score distribution as a streaming estimate. `observe`
// each non-cohering score as the reading proceeds; `threshold` reads off the
// derived null from the field SO FAR (leaving out the candidate under test). The
// boundary tracks the live noise and drifts as the noise drifts — precision
// adaptation, the engine setting its own gain from its own running sense of normal.
export const createNoiseFloor = ({ scale = 'linear', alpha = 0.01, grain = 0, N = null } = {}) => {
  const samples = [];
  return {
    observe(score) { if (Number.isFinite(score)) samples.push(score); return this; },
    observeAll(scores) { for (const s of scores) this.observe(s); return this; },
    get count() { return samples.length; },
    samples() { return samples.slice(); },
    // The derived boundary at the current cursor. `leaveOut` excludes the proposal
    // under test; `N` overrides the competition size for this read.
    threshold({ leaveOut = null, N: n = N } = {}) {
      return deriveNull(samples, { scale, alpha, N: n, grain, leaveOut });
    },
    // SYN iff the proposed structure beats what the void would produce by chance.
    beats(s, opts = {}) { return s > this.threshold(opts); },
  };
};
