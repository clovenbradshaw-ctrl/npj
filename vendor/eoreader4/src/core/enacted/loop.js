// The enacted DEF–EVA–REC loop — the significance engine.
//
// This is the ENACTED loop, not the depicted one. The depicted loop (classify/)
// is content: a clause's phasepost perception, a Figure-grain reading of what a
// clause reports, timeless and recomputable at any cursor. The enacted loop is
// COGNITION: the reading establishing its own terms (DEF), testing its own
// particulars against them (EVA), and restructuring its own frame when the testing
// accumulates past what the frame can hold (REC). It is temporal, ordered, and
// cross-layer. It is the reading thinking. The two are never conflated in the log
// (§2, §10): a clause can report a REC in the story while the reading undergoes
// none, and the reading's frame can break on a clause that reports nothing of the
// kind.
//
// THE ARROW OF TIME is constitutive, not decoration (§5). The loop runs forward,
// one cursor at a time. Every EVA tests the frame as it stood at the cursor —
// never a frame from the future. Cross-layer influence is legal precisely because
// it is cross-layer AND backward in time: the higher frame that conditions a lower
// particular was established earlier in the reading than the particular it
// conditions. Remove the arrow and the loop is a paradox (the document frame
// conditions the proposition reading conditions the document frame, with no ground
// and no termination); keep it and the loop is a spiral that converges, or records
// honestly where it could not (§11).
//
// THE THROTTLE is surprise (§3, §6). Each EVA carries the per-particular
// divergence between what the frame predicted and what the line delivered. A
// confirming EVA (low surprise) holds the frame and adds nothing — assimilation,
// the frame absorbs. A straining EVA accumulates into a LEAKY sum. A frame breaks
// two ways: the running sum crossing threshold — a sustained GRIND, accommodation
// (Leibniz); or a single EVA above an IMPULSE threshold — an overwhelming SHOCK
// that restructures on impact (Newton), the fast path the integral alone cannot
// model. This is the same surprise that warms the activation field; here it drives
// restructuring, and its rate over read time is the reading's effort — a quiet
// stable reading or a turbulent hard one.
//
// THE DISCIPLINE (§7). The cross-layer EVA tests a frame; it does not author one.
// A lower particular can strain the document frame until the document layer fires
// its OWN REC, but the lower layer never reaches up and rewrites the higher frame
// by hand. A layer feeds EVAs upward and receives a frame downward; neither writes
// the other's frame. The owning layer is the one that decides, by RECing its own
// frame when the strain it accumulated breaks it.
//
// THE SKELETON (§11). The rich, meaning-distance surprise that distinguishes a
// frame breaking from a word merely being unusual needs the geometric reader
// (MiniLM). With the embedder degenerate the only honest strain is the mechanical
// γ-mass surprise over the field — real but thin. So this builds the skeleton on
// that cheap surprise: `read(cursor) → { surprise, terms }` is injected (index.js
// defaults it to readingAt's γ-mass surprise). When the meaning reader is live the
// same machinery deepens with no shape change — only a richer `read`.

import { createFrame, snapshotFrame, DEFAULT_STRAIN_LEAK } from './frame.js';

// Higher layers hold harder. A document frame should be harder to break than a
// proposition frame — its threshold is the size of its protective belt (Lakatos,
// §1/§11). These are the skeleton's defaults, a measured threshold per layer, not
// a constant; tune against the worked-example goldens, watching for thrash (too
// low, the frame never holds) and numbness (too high, the frame cannot be
// surprised).
export const DEFAULT_THRESHOLDS = Object.freeze({
  proposition: 1.5,
  document: 4.0,
});

// The assimilation band. Surprise below this is the frame predicting the
// particular — it confirms and contributes no strain (Piaget's assimilation, §1).
// Above it the excess accrues toward accommodation. The knob that sets where
// holding ends and accumulating begins.
export const DEFAULT_CONFIRM_BAND = 0.25;

// THE IMPULSE threshold (Newton, §3/§6). A single EVA above this surprise breaks the
// frame on impact — a fast path distinct from accumulated strain, one anomaly so large
// the frame cannot hold it even once. The integral measures erosion; the impulse
// catches the hammer-blow.
//
// A FIXED 0.95 is a shock gate set on the raw [0,1] range — but the live surprise
// rides a COMPRESSED scale (the γ-mass band clusters under 0.1; the meaning 1−cos
// clusters far below 1, sentence cosines rarely orthogonal), so an absolute 0.95 is
// an off switch in disguise on the very path that matters: it passes any synthetic
// high-surprise test and never fires on real text. So under causal calibration the
// impulse, like the band, is fit to THIS reader's own scale — a high quantile of the
// surprises seen so far (DEFAULT_IMPULSE_QUANTILE). A shock is then "far above what
// this reader normally sees," not "above 0.95," so it fires when a clause is
// genuinely anomalous for this text rather than never. DEFAULT_IMPULSE is the fixed
// fallback: the gate in non-causal mode, and the seed until the causal window is wide
// enough to estimate a tail (or when the distribution is flat and has no shock in
// it). Tunable.
export const DEFAULT_IMPULSE = 0.95;

// The causal impulse quantile — the shock sits at the top of the reader's OWN
// surprise distribution. 0.98 ≈ where the static 0.95 sat as a quantile of the
// γ-mass tail (measured on the worked corpus), so the shock stays the rare Newton
// hammer-blow above the grind, not a second accumulation path. Tunable, per reader.
export const DEFAULT_IMPULSE_QUANTILE = 0.98;

// The causal window must be at least this wide before a tail quantile is trustworthy;
// under it the impulse holds at the fixed fallback (an opening cannot shock).
const IMPULSE_MIN_SAMPLES = 16;

// THE REFRACTORY PERIOD (hysteresis, §11). After a frame restructures it cannot
// break again for this many cursors. A bare threshold-with-reset is the textbook
// setup for a limit cycle: the surprise that broke the frame is still arriving, so
// the fresh frame re-breaks immediately and the loop oscillates (the thrash
// loopStats only DETECTED, never prevented). The refractory window is the
// hysteresis that prevents it — a just-restructured frame holds through the
// residual, and only a crisis that outlasts the window breaks it again. Tunable.
export const DEFAULT_REFRACTORY = 3;

// Calibrate the confirm band and the layer thresholds to THIS reader's scale.
//
// The skeleton's defaults (0.25 band, 1.5/4.0 thresholds) were measured on the
// SURPRISAL scale. The loop now rides Bayesian surprise (docs/bayesian-surprise.md),
// which clusters far below it — most lines under 0.1 — so on `bayes` the frame goes
// numb: strain never accumulates, no REC ever fires. The fix is the move the meaning
// reader already makes — fit the scale to the text:
//
//   band      = median surprise            (half the lines confirm, half strain)
//   step      = mean excess over the band  (the typical accommodation per line)
//   threshold = { proposition: 3·step, document: 8·step }
//
// Adaptive, scale-free, per reader. The 8:3 ratio preserves "the higher layer holds
// harder" (document RECs ~3× rarer) under any rescaling — the same ratio as the
// static 4.0:1.5 defaults. Falls back to the static defaults when the distribution
// is too thin to fit (fewer than a handful of lines, or no excess to measure).
export const calibrateReader = (surprises, {
  layers = ['proposition', 'document'],
  perLayerSteps = { proposition: 3, document: 8 },
  defaults = DEFAULT_THRESHOLDS,
  defaultBand = DEFAULT_CONFIRM_BAND,
} = {}) => {
  const xs = (surprises || []).filter(x => Number.isFinite(x));
  if (xs.length < 4) return { confirmBand: defaultBand, thresholds: { ...defaults }, fitted: false };

  const band = medianOf(xs);
  const excess = xs.map(x => Math.max(0, x - band)).filter(e => e > 0);
  const step = excess.length ? excess.reduce((s, e) => s + e, 0) / excess.length : 0;
  if (step <= 0) return { confirmBand: defaultBand, thresholds: { ...defaults }, fitted: false };

  const thresholds = {};
  for (const layer of layers) {
    const k = perLayerSteps[layer] ?? perLayerSteps.proposition ?? 3;
    thresholds[layer] = k * step;
  }
  return { confirmBand: band, thresholds, fitted: true, band: round(band), step: round(step) };
};

const medianOf = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// A high quantile by nearest-rank — the tail statistic the causal impulse rides. The
// band uses the interpolated median (calibrateReader); the shock gate wants the top of
// the distribution, where nearest-rank is the honest "this many of the past sit below."
const quantileOf = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
};

export const createEnactedLoop = ({
  layers = ['proposition', 'document'],
  thresholds = DEFAULT_THRESHOLDS,
  confirmBand = DEFAULT_CONFIRM_BAND,
  strainLeak = DEFAULT_STRAIN_LEAK,  // strain's per-cursor retention — the leaky integrator (frame.js)
  impulseThreshold = DEFAULT_IMPULSE,// a single EVA above this breaks the frame on impact (Newton); causal fallback
  impulseQuantile = DEFAULT_IMPULSE_QUANTILE, // causal mode: the shock is this quantile of PAST surprise
  refractoryPeriod = DEFAULT_REFRACTORY, // cursors a just-restructured frame cannot re-break (hysteresis)
  calibrate = null,                  // { mode:'causal', alpha } → band/threshold from PAST surprises only
  read,                              // (cursor) => { surprise ∈ [0,1], terms } — the cheap γ-mass signal
} = {}) => {
  if (typeof read !== 'function') {
    throw new TypeError('createEnactedLoop: `read` must be (cursor) → { surprise, terms }');
  }
  const orderedLayers = [...layers];
  const base = orderedLayers[0];     // the layer particulars originate at (proposition)
  const events = [];                 // the enacted log, in GENERATION ORDER (§8, §10)
  const live = new Map();            // layer → live frame (the only mutable state)
  const sinceSet = new Map();        // layer → [seq] of EVAs since the frame was set
  const lastRec = new Map();         // layer → cursor of the last REC (the refractory clock)
  let lastCursor = -1;               // the arrow of time — strictly increasing

  // CAUSAL SCALE (§5 — the arrow inside the calibrator). The confirm band and the
  // layer thresholds measure "normal surprise" for THIS reader. Measuring that from
  // the WHOLE reading (calibrateReader over every surprise) smuggles the future into
  // the band that judges an early EVA — the one acausal seam in a loop built to
  // police the arrow. In causal mode the SAME fit runs on an expanding window of the
  // surprises seen SO FAR: the band that judges cursor c is fit from surprises
  // strictly before c, refreshed after each verdict. Same statistic (median band,
  // k·mean-excess thresholds), no future. Habituation falls out — "normal" rises in
  // turbulent text. Seeded at the static defaults until enough surprises are seen.
  const causal = calibrate?.mode === 'causal';
  const perLayerSteps = calibrate?.perLayerSteps;            // optional override passed to calibrateReader
  const seen = [];                                          // surprises seen so far — the causal window
  let causalBand = confirmBand;                             // band fit from `seen` (past only)
  let causalThresholds = thresholds;                        // thresholds fit from `seen` (past only)
  let causalImpulse = impulseThreshold;                    // impulse fit from `seen` (past only)
  const recalibrate = () => {
    const cal = calibrateReader(seen, {
      layers: orderedLayers,
      ...(perLayerSteps ? { perLayerSteps } : {}),
      defaults: thresholds, defaultBand: confirmBand,
    });
    causalBand = cal.confirmBand;
    causalThresholds = cal.thresholds;
    // The impulse on the reader's own scale — a high quantile of the surprises seen so
    // far, the band's causal discipline applied to the shock gate (§3/§6). Held at the
    // fixed fallback until the window can estimate a tail, and whenever the quantile is
    // not above the band (a flat reading has no shock to find) — so the fixed gate
    // stays the honest fallback, never a hair-trigger on a degenerate distribution.
    if (seen.length >= IMPULSE_MIN_SAMPLES) {
      const q = quantileOf(seen, impulseQuantile);
      causalImpulse = q > causalBand ? q : impulseThreshold;
    } else {
      causalImpulse = impulseThreshold;
    }
  };
  const bandNow = () => (causal ? causalBand : confirmBand);
  const impulseNow = () => (causal ? causalImpulse : impulseThreshold);

  const emit = (e) => {
    // Every enacted event is tagged with its register and its reader. The reader
    // is the reading itself: an enacted act is witnessed by the reading, the way a
    // depicted perception is witnessed by a measuring organ. The tag is the
    // firewall that keeps the two loops apart in any log they share (register.js).
    const sealed = Object.freeze({ ...e, register: 'enacted', reader: 'reading', seq: events.length });
    events.push(sealed);
    return sealed;
  };

  const thresholdOf = (layer) =>
    causal ? (causalThresholds[layer] ?? DEFAULT_THRESHOLDS[layer] ?? causalThresholds[base] ?? 1.5)
           : (thresholds[layer] ?? DEFAULT_THRESHOLDS[layer] ?? thresholds[base] ?? 1.5);

  // Establish a frame at a layer — an enacted DEF. `producedBy` is 'initial' for
  // the opening frame, or { rec: seq } when a REC installs the new terms (§8: a DEF
  // carries the EVAs or REC that produced it). Resets the EVA accumulator for the
  // layer, because strain is measured against THIS frame from here forward.
  const def = (layer, cursor, terms, producedBy) => {
    const frame = createFrame({ layer, cursor, terms, threshold: thresholdOf(layer), leak: strainLeak });
    live.set(layer, frame);
    sinceSet.set(layer, []);
    emit({ op: 'DEF', layer, cursor, frame: snapshotFrame(frame), producedBy });
    return frame;
  };

  // Test the particular at `cursor` against the frame at `layer` — an enacted EVA.
  // testLayer is where the particular originates (the base layer: every sentence is
  // a proposition-grain particular). `cross` is true when the frame tested sits at
  // a HIGHER layer than the particular — the cross-layer EVA, a lower particular
  // bearing on a higher frame (§4). Its verdict carries BOTH directions of
  // influence: a confirm is the high holding the low (the document frame
  // conditioning a proposition that fits it); a strain is the low bearing on the
  // high (accumulating toward the higher frame's REC).
  const eva = (layer, cursor, surprise, particular, contrib) => {
    const frame = live.get(layer);
    // ARROW OF TIME (§5, §10, §11). An EVA tests the frame as of the cursor, never
    // a future frame. The frame was established at frame.cursor; that must not be
    // after the particular it conditions. This is the guard the whole
    // non-circularity rests on — break it (the likeliest way: a second pass leaking
    // the final frame backward into earlier EVAs) and the reading validates early
    // particulars against a conclusion it has not yet earned.
    if (frame.cursor > cursor) {
      throw new Error(`enacted EVA tested a FUTURE frame: ${layer}@${frame.cursor} vs particular@${cursor} (§5)`);
    }
    // THE LEAK (§5, applied to the integral). Standing strain forgets at `leak` per
    // cursor of read-time BEFORE this EVA accrues — a leaky integrator. The frame
    // therefore breaks on a temporal CLUSTER of anomaly (a crisis), never on the
    // document's lifetime total; spaced anomalies leak away between hits. This is the
    // arrow of time the loop already enforces for frames, now enforced for strain.
    const dt = Math.max(0, cursor - frame.strainCursor);
    frame.strain *= Math.pow(frame.leak, dt);
    frame.strainCursor = cursor;
    const band = bandNow();          // causal: the EWMA of past surprises only (never the future)
    const verdict = surprise < band ? 'confirm' : 'strain';
    const strainDelta = Math.max(0, surprise - band);
    frame.strain = round(frame.strain + strainDelta);
    // VECTOR STRAIN. Attribute this EVA's rectified strain to the DIMENSIONS that
    // drove the surprise (per-figure KL contributions), each leaking on the same
    // kernel. Scalar strain says the frame is breaking; this says along WHICH axis,
    // so the REC can restructure toward the cause, not whatever is merely in view.
    const decay = Math.pow(frame.leak, dt);
    for (const [d, v] of frame.dimStrain) frame.dimStrain.set(d, v * decay);
    if (contrib && strainDelta > 0) {
      let sum = 0; for (const k in contrib) sum += contrib[k];
      if (sum > 0) for (const k in contrib)
        frame.dimStrain.set(k, round((frame.dimStrain.get(k) || 0) + strainDelta * (contrib[k] / sum)));
    }
    const ev = emit({
      op: 'EVA',
      testLayer: base, frameLayer: layer, frameCursor: frame.cursor,
      cross: layer !== base,
      cursor, particular,
      verdict, surprise: round(surprise), strainDelta: round(strainDelta),
    });
    sinceSet.get(layer).push(ev.seq);
    return frame;
  };

  // Restructure the frame at `layer` — an enacted REC. Fires only when accumulated
  // strain has broken the threshold (the caller checks). Records the frame it
  // restructured, the strain sum at firing, and the EVAs that forced it, then
  // installs the new frame via a DEF that cites this REC (§3, §8). The entry
  // mirrors eoreader3's RULES_LEDGER op:'REC' with target/action, extended with the
  // strain sum and the forcing EVAs (§9) — this IS the enacted-REC ledger.
  const rec = (layer, cursor, terms, trigger = 'accumulation') => {
    const old = live.get(layer);
    const forcedBy = sinceSet.get(layer).slice();
    // Restructure ALONG THE STRAINING AXIS: the dimensions that accumulated the most
    // strain ARE the cause of the break, so they become the new frame's terms — not
    // `terms`, which is merely whatever figures were in view at the break cursor. With
    // no per-dimension signal (a scalar `read`) the axis is empty and `terms` stands.
    const axis = [...old.dimStrain.entries()].filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]).map(([d]) => d);
    const installTerms = axis.length ? axis.slice(0, 3) : terms;
    const recEv = emit({
      op: 'REC',
      target: layer, action: 'restructure',   // RULES_LEDGER shape, borrowed (§9)
      layer, cursor,
      trigger,                                 // 'accumulation' (grind) | 'impulse' (shock) — §3/§6
      alongAxis: axis.slice(0, 3),             // the cause of the break (the straining dimensions)
      from: snapshotFrame(old),
      strainSum: round(old.strain),
      forcedBy,
    });
    def(layer, cursor, installTerms, { rec: recEv.seq });   // the REC installs the new frame
    return recEv;
  };

  // One step of the arrow. Advance to `cursor` (strictly forward), read the cheap
  // surprise + terms there, and run the loop across every layer low → high. The
  // base layer tests the particular against its own frame; every higher layer
  // receives the SAME particular as a cross-layer EVA against its frame. Strain
  // accumulates independently per layer; each layer RECs on its own threshold — the
  // higher layer restructures ITSELF, the lower never writes it (§7). A higher
  // threshold means the higher frame absorbs more before it breaks: document RECs
  // are rarer than proposition RECs, which is what a document frame being harder to
  // break than a proposition frame looks like in the log.
  const step = (cursor) => {
    if (cursor <= lastCursor) {
      throw new Error(`enacted loop runs forward only: cursor ${cursor} ≤ last ${lastCursor} (§5)`);
    }
    lastCursor = cursor;
    const r = read(cursor) || {};
    const s = clamp01(Number(r.surprise) || 0);
    const terms = r.terms || [];
    const contrib = r.contrib || null;   // per-dimension surprise (vector strain), when supplied

    for (const layer of orderedLayers) {
      if (!live.has(layer)) { def(layer, cursor, terms, 'initial'); continue; }
      const frame = eva(layer, cursor, s, cursor, contrib);
      // HYSTERESIS (§11). A just-restructured frame is refractory: it cannot break
      // again until `refractoryPeriod` cursors have passed, so the residual surprise
      // still arriving cannot drive an immediate re-break (a limit cycle). Strain
      // keeps accruing through the window; a crisis that genuinely outlasts it breaks
      // the frame again once it clears.
      const last = lastRec.get(layer);
      if (last != null && cursor - last <= refractoryPeriod) continue;
      // Two ways a frame breaks. IMPULSE (Newton): a single surprise so large it
      // restructures on impact — the fast path the integral cannot model, checked
      // first because a shock should not wait on accumulation. ACCUMULATION
      // (Leibniz): the leaky strain sum crossing threshold — a sustained grind. The
      // impulse gate is the CURRENT one (impulseNow): causal mode fits it to the
      // reader's own scale, so a shock is "far above what this reader sees" rather than
      // a fixed 0.95 the compressed live surprise never reaches; fixed mode holds it.
      // STRICTLY above the gate — a shock EXCEEDS the tail, so a surprise merely tying
      // the running max (a saturated γ-mass 1.0, a repeated cluster peak) is not a fresh
      // shock and does not re-fire.
      if (s > impulseNow()) { rec(layer, cursor, terms, 'impulse'); lastRec.set(layer, cursor); }
      // Break against the CURRENT threshold, not the frame's frozen one: in causal
      // mode the scale is still being learned when the opening frame is set, so its
      // belt must track the calibration as it settles (identical to frame.threshold
      // in fixed mode, where thresholdOf is constant).
      else if (frame.strain >= thresholdOf(layer)) { rec(layer, cursor, terms, 'accumulation'); lastRec.set(layer, cursor); }
    }
    // Refresh the causal scale AFTER the verdicts, so the band/thresholds that judged
    // this cursor were fit from surprises strictly before it — the arrow, kept inside
    // the calibrator. (No-op in fixed mode.)
    if (causal) { seen.push(s); recalibrate(); }
    return { cursor, surprise: round(s) };
  };

  // Drive the arrow forward to `cursor`, stepping every intervening position so no
  // particular is skipped. Returns the enacted log (generation order).
  const runTo = (cursor) => {
    for (let c = lastCursor + 1; c <= cursor; c++) step(c);
    return events;
  };

  return {
    step, runTo,
    get events() { return events; },
    get cursor() { return lastCursor; },
    frameAt: (layer) => { const f = live.get(layer); return f ? snapshotFrame(f) : null; },
    strainAt: (layer) => live.get(layer)?.strain ?? 0,
    // The live scale, for callers that report it (e.g. the meaning reader). In causal
    // mode these are the band/impulse AS THEY STAND now — fit from past surprises only;
    // in fixed mode they are the constants the loop was built with.
    get confirmBand() { return bandNow(); },
    get impulse() { return impulseNow(); },
    layers: Object.freeze([...orderedLayers]),
    // The enacted-REC ledger as JSONL — the same shape as the audit trail and
    // eoreader3's conventions.jsonl, so the reading is tuned against the record (§9).
    exportJSONL: () => events.map(e => JSON.stringify(e)).join('\n'),
  };
};

const round = (x) => Math.round(x * 1000) / 1000;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
