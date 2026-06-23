// The reading holon — reading mode as a predict / evaluate / surprise loop,
// formatted in the EO operator vocabulary.
//
// The three levels of reading are three different kinds of math:
//
//   L1 existence    counting measure — cardinality of presence (set overlap).
//   L2 structure    graph linear algebra — a union-find quotient over a
//                   weighted adjacency, edge weight bilinear in endpoint
//                   log-mass under a γ-decay kernel along the reading line.
//   L3 significance probability + information — a prior distribution over
//                   "who acts next" (the integral fold of γ-mass), an
//                   expectation (prediction), and a SURPRISAL (−log₂p) when
//                   the next line lands (the differential of the fold).
//
// This file is L3. Prediction reads only events *before* the cursor; surprise
// reads events *at* the cursor; the scalar surprise is the mean surprisal in
// bits of what the line did under the prior the reading had built.

import { CONVERSATIONAL_CAP } from '../converse/index.js';
import { surpriseAt, forwardDist, bridgeSurprise, noveltyAmplitude } from '../core/index.js';

const GAMMA = 0.7;     // DEFAULT recency decay, matches DEFAULT_PROJECTION_RULES.decay_gamma
const NOVELTY = 1.0;   // reserved prior mass for an as-yet-unseen figure (the SEED / cold-start)

export const readingAt = (doc, cursor, opts = {}) => {
  const units = doc.units || doc.sentences || [];
  const S = units.length;
  const at = Math.max(0, Math.min(S - 1, cursor | 0));
  // THE HORIZON. The prior is γ-decayed in READING-TIME distance, so γ sets how far
  // back the reading still feels: at 0.7 the prior is effectively the last ~5–6 lines
  // (0.7^8 ≈ 0.06) — a tight recency window; a wider γ keeps distant context alive
  // (0.95^12 ≈ 0.54). It is parametrised so the SAME fixed log can be re-read against a
  // different horizon — the move-1 question of whether `bayes` even moves with the
  // horizon (docs/bayesian-surprise.md). Defaults to GAMMA, so a standard reading is
  // byte-identical; only an explicit opts.gamma shifts the window.
  const γ = Number.isFinite(opts.gamma) ? opts.gamma : GAMMA;
  const events = typeof doc.log.snapshot === 'function' ? doc.log.snapshot() : (doc.log.events || []);

  const label     = new Map(); // id → label
  const firstIns  = new Map(); // id → first INS sentIdx (admission line)
  const priorMass = new Map(); // id → γ-decayed presence before `at`  (the ∫, figure field)
  const priorBond = new Set(); // 'src|tgt' bonded before `at`
  // The PROPOSITION field — the belief state widened past the cast. The reading
  // believes not just who is on stage but what it takes to be the case: the
  // participants (figures AND the referents they act on), the propositions
  // themselves (src|via|tgt triples), and the predicates. γ-decayed like the figure
  // mass, so a recurring proposition confirms and a new event moves belief. This is
  // what the Bayesian-surprise channel reads, so an EVENT on a standing figure (the
  // apple in the back, the disowning) is significant, not only a change of cast.
  const priorProp = new Map(); // atom → γ-decayed presence before `at`
  const firstProp = new Map(); // atom → first sentIdx it appeared (the protention's birth record)
  const bump = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
  // bumpProp also records each atom's FIRST appearance, so the signal-derived reserve
  // (opts.signalReserve) can weigh the recent rate of newcomers. Inert by default.
  const bumpProp = (k, w, sentIdx) => {
    bump(priorProp, k, w);
    if (!firstProp.has(k) || sentIdx < firstProp.get(k)) firstProp.set(k, sentIdx);
  };

  const insAt = [];            // entity ids instantiated at `at`
  const relAt = [];            // { op, src, tgt, via } at `at`
  const defAt = [];            // { id, value } at `at`

  // THE HORIZON's REACH (opts.horizon). Beyond γ (how FAR back), the horizon also
  // selects WHICH events build the prior — the same fixed log read against a different
  // ground. 'recency' (default) admits every figure, so a line is read against the
  // recent mixed window. 'entity' admits only the events of the figures THIS line acts
  // on (its participants), so the disowning is read against Grete's own care arc, not
  // the household's decline — the SELECTIVE horizon no temporal γ can give (a wider γ
  // holds the decline HARDER, not the care, so it damps the rupture; only a figure
  // filter can promote it). The line's own deposit at `at` is never filtered; the
  // prior is. Default leaves the filter open → byte-identical to today.
  const horizon = opts.horizon || 'recency';
  let actors = null;
  if (horizon === 'entity') {
    actors = new Set();
    for (const e of events) {
      if (e.sentIdx !== at) continue;
      if (e.op === 'INS')                          actors.add(e.id);
      else if (e.op === 'CON' || e.op === 'SIG')   { actors.add(e.src); actors.add(e.tgt); }
      else if (e.op === 'DEF' && e.key === 'predicate') actors.add(e.id);
    }
  }
  const inHorizon = (e) => {
    if (!actors) return true;                       // 'recency'/default — every figure admitted
    if (e.op === 'INS')                          return actors.has(e.id);
    if (e.op === 'CON' || e.op === 'SIG')        return actors.has(e.src) || actors.has(e.tgt);
    if (e.op === 'DEF' && e.key === 'predicate') return actors.has(e.id);
    return false;
  };

  for (const e of events) {
    if (e.op === 'INS') {
      if (!label.has(e.id)) label.set(e.id, e.label);
      if (!firstIns.has(e.id)) firstIns.set(e.id, e.sentIdx);
    }
    if (e.sentIdx == null) continue;
    if (e.sentIdx < at) {
      if (!inHorizon(e)) continue;                  // entity horizon: only the line's figures' past
      const w = Math.pow(γ, at - 1 - e.sentIdx);
      if (e.op === 'INS') {
        // ∫ of presence with an exponential (heat) kernel — the running mass.
        priorMass.set(e.id, (priorMass.get(e.id) || 0) + w);
        bumpProp(`f:${e.id}`, w, e.sentIdx);
      } else if (e.op === 'CON' || e.op === 'SIG') {
        priorBond.add(`${e.src}|${e.tgt}`);
        // The bond's participants (incl. an NP referent target) and the proposition
        // itself enter the belief field — the relation is part of what is the case.
        bumpProp(`f:${e.src}`, w, e.sentIdx);
        bumpProp(`f:${e.tgt}`, w, e.sentIdx);
        bumpProp(`p:${e.src}|${e.via || ''}|${e.tgt}`, w, e.sentIdx);
      } else if (e.op === 'DEF' && e.key === 'predicate') {
        bumpProp(`f:${e.id}`, w, e.sentIdx);
        bumpProp(`d:${e.id}|${e.value}`, w, e.sentIdx);
      }
    } else if (e.sentIdx === at) {
      if (e.op === 'INS')                               insAt.push(e.id);
      else if (e.op === 'CON' || e.op === 'SIG')        relAt.push({ op: e.op, src: e.src, tgt: e.tgt, via: e.via });
      else if (e.op === 'DEF' && e.key === 'predicate') defAt.push({ id: e.id, value: e.value });
    }
  }

  const name = (id) => label.get(id) || id;

  // expect — the model-adds-mass-to-the-prior door (§6), redrawn as a
  // DEPOSITION, not the injection it was drafted as. The talker does not write
  // the prior directly; its expectation enters as TAGGED, CAPPED conversational
  // mass, kept separable from the γ-mass prior so the fold can discount the echo
  // (the subtract-and-check, converse holon). It warms the prediction of who
  // acts next; capped at the model reader's ceiling, it can never dominate a
  // grounding reader, and surprise still reads the line against a prior the
  // talker cannot manufacture past that cap.
  const convPrior = new Map();   // id → tagged conversational expectation mass
  let conversationalPrior = 0;
  if (typeof opts.expect === 'function') {
    for (const id of [...priorMass.keys()]) {
      const raw   = Number(opts.expect(id, label.get(id))) || 0;
      const boost = Math.min(CONVERSATIONAL_CAP, Math.max(0, raw));   // capped, never raw
      if (boost > 0) {
        convPrior.set(id, boost);
        conversationalPrior += boost;
        priorMass.set(id, priorMass.get(id) + boost);
      }
    }
  }

  // --- The SIGNAL-DERIVED reserve (opts.signalReserve, the ONTOGENY of the protention).
  // The reserve's amplitude is grown from the signal itself — the γ-decayed rate of recent
  // FIRST-appearances — instead of the constant SEED. Two fields, two reserves: the figure
  // field (the surprisal channel) keyed by each id's first INS, the proposition field (the
  // significance channel) keyed by firstProp. Cold-start falls back to the SEED (NOVELTY) so
  // the opening is never zero-reserve. OFF → reserve = NOVELTY everywhere → byte-identical
  // (the parity gate). Measured aggregate-flat against its controls (exp-0002): NOT promoted.
  const signalReserve = !!opts.signalReserve;
  const figReserve = signalReserve
    ? (noveltyAmplitude([...priorMass.keys()].map(id => firstIns.get(id)), at, γ) || NOVELTY)
    : NOVELTY;
  const propReserve = signalReserve
    ? (noveltyAmplitude([...firstProp.values()], at, γ) || NOVELTY)
    : NOVELTY;

  // --- Prediction (REC): a probability distribution over who acts next. ----
  // P(figure) ∝ γ-mass; a reserve of figReserve holds probability for someone
  // not yet seen. Prediction = the expectation: the top of this distribution.
  const total = [...priorMass.values()].reduce((s, m) => s + m, 0);
  const Z = total + figReserve;
  const pNovel = figReserve / Z;
  const pOf = (id) => (priorMass.get(id) || 0) / Z;

  const ranked = [...priorMass.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const predFigures = ranked.slice(0, 3);
  const predSet = new Set(predFigures);
  const predBonds = [];
  for (const key of priorBond) {
    const [a, b] = key.split('|');
    if (predSet.has(a) && predSet.has(b)) predBonds.push(`${name(a)}—${name(b)}`);
    if (predBonds.length >= 3) break;
  }

  // --- Observation + surprise (EVA): surprisal of the line under the prior. -
  const presentIds = new Set([...insAt, ...relAt.flatMap(r => [r.src, r.tgt]), ...defAt.map(d => d.id)]);
  const confirmed  = predFigures.filter(id => presentIds.has(id));

  const newFigIds = [...new Set(insAt)].filter(id => firstIns.get(id) === at);
  const pNovelEach = newFigIds.length ? pNovel / newFigIds.length : pNovel;

  let bits = 0, n = 0;
  for (const id of presentIds) {
    const isNew = firstIns.get(id) === at;
    const p = isNew ? Math.max(pNovelEach, 1e-6) : Math.max(pOf(id), pNovel * 0.5, 1e-6);
    bits += -Math.log2(p); n++;
  }
  for (const r of relAt) {
    if (priorBond.has(`${r.src}|${r.tgt}`)) continue;
    const ps = Math.max(pOf(r.src), pNovel, 1e-6);
    const pt = Math.max(pOf(r.tgt), pNovel, 1e-6);
    bits += -Math.log2(ps * pt); n++;
  }
  const surprisal = n ? bits / n : 0;          // mean bits per surprising event
  const surprise  = 1 - Math.pow(2, -surprisal); // squashed to [0,1)

  // --- Bayesian surprise (the SIGNIFICANCE channel). -----------------------
  // Surprisal answers "how improbable"; that is the wrong invariant for where a
  // reading's attention goes — TV-snow is maximally improbable yet moves no belief
  // (Itti & Baldi, NIPS 2005). Bayesian surprise answers "how far the reading's
  // belief MOVED": D_KL(posterior ‖ prior) over the PROPOSITION field (priorProp) —
  // the participants, the propositions among them, and the predicates, not just the
  // cast. The posterior is the prior advanced one step — every incumbent decays by
  // γ, every atom delivered at this line deposits γ⁰ = 1 — over the common support
  // plus a fixed reserve atom (NOVELTY) that keeps a newcomer finite (no infinite
  // name-snow shock) and makes the opening fall to exactly zero on its own. So an
  // event on a standing figure moves belief now, not only a change of cast. See
  // docs/bayesian-surprise.md.
  // The deposit at this line — the full proposition delivered: every participant
  // (figures and the referents they act on), every proposition (src|via|tgt), every
  // predicate. So a new bond or predication on a standing figure moves belief.
  const deposit = new Map();
  for (const id of insAt) bump(deposit, `f:${id}`);
  for (const r of relAt) {
    bump(deposit, `f:${r.src}`);
    bump(deposit, `f:${r.tgt}`);
    bump(deposit, `p:${r.src}|${r.via || ''}|${r.tgt}`);
  }
  for (const d of defAt) {
    bump(deposit, `f:${d.id}`);
    bump(deposit, `d:${d.id}|${d.value}`);
  }
  // Render a proposition-field atom to a readable axis label (a figure, a proposition,
  // or a predicate) — the dimension a REC restructures along when this axis strains.
  const axisLabel = (k) => {
    if (k.startsWith('f:')) return name(k.slice(2));
    if (k.startsWith('p:')) { const [s, v, t] = k.slice(2).split('|'); return `${name(s)} ${v || '—'} ${name(t)}`; }
    if (k.startsWith('d:')) { const [i, ...v] = k.slice(2).split('|'); return `${name(i)}: ${v.join('|')}`; }
    return k;
  };
  // THE ONE SURPRISE (Track A, docs/spec-one-surprise.md). D_KL(posterior ‖ prior) over
  // the γ-decayed proposition field `priorProp`, with this line's `deposit` as the arrival.
  // The computation is lifted verbatim into the modality-agnostic `surpriseAt` core, which
  // text/music/phasepost all call — they differ only in the front-end that builds these two
  // maps and the axis renderer. Same operations, same order: the text path stays byte-
  // identical (parity gate: node --test tests/*.test.js).
  const { bayesBits, bayesBy } = surpriseAt(priorProp, deposit, { gamma: γ, novelty: propReserve, axisLabel });
  const bayes = 1 - Math.pow(2, -bayesBits);   // squashed to [0,1)

  // --- EO-tagged surprises: the operator each surprise fired under. ---------
  const surprises = [];
  for (const id of newFigIds) surprises.push({ op: 'INS', text: `${name(id)} enters`, idx: at });
  for (const r of relAt) {
    if (!priorBond.has(`${r.src}|${r.tgt}`)) {
      surprises.push({ op: r.op, text: `${name(r.src)} ${r.via || 'with'} ${name(r.tgt)}`, idx: at });
    }
  }
  for (const d of defAt) surprises.push({ op: 'DEF', text: `${name(d.id)}: ${d.value}`, idx: at });
  const focusShift = predFigures.length > 0 && confirmed.length === 0 && presentIds.size > 0;
  if (focusShift) surprises.push({ op: 'SEG', text: `focus shifts off ${name(predFigures[0])}`, idx: at });

  const held = confirmed.length > 0;
  // "Surprise — …" only when there is a NAMEABLE surprise (a new figure, an unseen
  // bond, a definition, a focus shift). A high bayes score with nothing to name —
  // belief moved but no discrete event carried it — must not render as the empty
  // "Surprise — ."; it falls back to the steady reading, which is the honest one.
  const summary = (surprise >= 0.25 && surprises.length)
    ? `Surprise — ${surprises.map(s => s.text).slice(0, 3).join('; ')}.`
    : (predFigures.length
        ? `As read — ${confirmed.length ? confirmed.map(name).join(', ') + ' stay in focus' : 'steady'}.`
        : 'Opening — no expectations yet.');

  const out = {
    sentIdx: at,
    sentence: units[at],
    chrome: presentIds.size === 0 && surprises.length === 0,
    predicted: { op: 'REC', figures: predFigures.map(name), bonds: predBonds },
    evaluation: { op: 'EVA', held, surprise, bits: round(surprisal) },
    surprises,
    // Two channels (docs/bayesian-surprise.md). `surprise`/`surprisalBits` is the
    // NOVELTY channel (−log p) — the audit/trace, the UI %, the note gate. `bayes`/
    // `bayesBits` is the SIGNIFICANCE channel (D_KL) — what the surfer's cursor and
    // the enacted loop ride. They disagree where it is diagnostic.
    surprise,
    surprisalBits: round(surprisal),
    bayes,
    bayesBits: round(bayesBits),
    bayesBy,                       // per-figure KL contributions — the per-dimension strain (vector)
    held,
    summary,
    // Tagged conversational warmth folded into the prior this turn (0 when the
    // expect door wasn't used). Separable, so the fold can subtract the echo.
    conversationalPrior: round(conversationalPrior),
  };
  // p(next | profile) — the explicit forward distribution, OPT-IN so default reading stays
  // byte-identical (the parity gate). It is the object the generator draws from (Part II)
  // and the honest forward turn of the recognition profile: the γ-decayed proposition field
  // `priorProp` renormalised, with the NOVELTY reserve. Over the full proposition basis
  // (figures + propositions + predicates) — the basis a draw needs, since figures alone are
  // too coarse to generate from (docs/spec-generation.md, Piece 1). Not yet wired into the
  // predictive SCORE; that swap changes the surprisal and ships behind RULES_REV.
  if (opts.forward) out.pNext = forwardDist(priorProp, { novelty: propReserve });
  // The CONNECTIVITY channel (the core's bridgeSurprise) — OPT-IN so default reading
  // stays byte-identical (the parity gate). The mass surprise above moves on what
  // arrived; this moves on how this line's bonds collapse the prior SEPARATION between
  // their (coref-resolved) endpoints — the structural reveal `bayes` is blind to (a bond
  // between two standing entities barely moves the mass KL, yet it can merge two regions
  // of the graph). Reads the same log at the same cursor, causally. Modality-agnostic:
  // it sees only CON/SIG bonds and the SYN-merge identity quotient.
  if (opts.bridge) {
    const { bridge, axis } = bridgeSurprise(doc.log, at);
    out.bridge = round(bridge);
    out.bridgeAxis = axis;       // [labelA, labelB] of the bridging pair, or null
  }
  return out;
};

const round = (x) => Math.round(x * 100) / 100;
