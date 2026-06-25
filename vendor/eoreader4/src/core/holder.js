// core/holder.js — the holder root and the nested-belief type. (SPEC §1, §9, §20)
//
// Update 4 finished the §1 move. §1 stopped eliding the READER root on a Site; this
// module carries the root that was elided one level further up: every belief the
// system reports about ANY other holder carries a second, OUTER root that is always
// the INSTRUMENT, because the instrument is the only thing that witnesses and writes.
//
//   The system never holds another holder's belief. It holds its belief ABOUT
//   another's belief, and the outer "its belief about" is the provenance that keeps
//   the inference from becoming a fact. (§20g)
//
// So the honest address of a character's belief is NESTED (§20):
//
//   instrument · models( grete · gregor.loc = room )
//        ^outer root, ALWAYS the instrument        ^inner root, the believer
//
// And it recurses — higher-order theory of mind is one more model inside (§20b):
//
//   instrument · models( grete · models( mother · gregor.loc = room ) )
//
// WHY THE OUTER ROOT IS LOAD-BEARING (§20a, §20f). The missing outer root is the
// witness TYPE. A value truly in another holder's fold, could it reach the system,
// would be exafferent (witnessed). But `instrument · models( X · … )` is AUTHORED by
// the instrument — it is reafferent, an inference. By the type law (core/provenance.js)
// reafference cannot witness, anchor, or certify. Drop the outer root and the
// inference about a holder reads as a FACT about that holder — the §9 laundering
// failure, now at the theory-of-mind grain. So the §9 honesty rule (inferred beliefs
// stay void) is NOT a rule here: it is a CONSEQUENCE the address forces. We do not
// assert it; we read it off `canWitness` exactly as the witness reads it everywhere
// else.
//
// THE ONE EXCEPTION (§20c). The system has one fold first-class, with no outer model:
// its OWN. `instrument · gregor.loc`, where the instrument directly read the text, is
// genuine exafference (or reafference) at the instrument's own root — not a model of
// someone else. Me-ness is the one place the outer and inner root COINCIDE, which is
// precisely why it is the one place the system is entitled to first-person standing.

import { fromEnactor, canWitness } from './provenance.js';

// ── Holders ──────────────────────────────────────────────────────────────────
// A holder is anything that has a world relative to it (§20d): Grete, an election,
// a market, a telescope, a quantum observer. It is an opaque id; two are reserved.
//
//   INSTRUMENT — the computing fold (§20c). The one fold held first-class, and the
//                OUTER root of every model of every other holder. The only id whose
//                fold the system holds directly.
//   READER     — the single-holder root §1 elides. The §3–§8 single-holder forms are
//                the case where holder = reader and is dropped from the address.
export const INSTRUMENT = 'instrument';
export const READER     = 'reader';

// isSelf — is this holder the instrument's own fold? The §20c asymmetry turns on it:
// the self-fold has one root (directly held); every other holder has two at minimum
// (the inner one modeled, the outer one always the instrument).
export const isSelf = (holder) => holder === INSTRUMENT;

// holderOf — read the holder root off a Site, defaulting to the elided READER (§1).
export const holderOf = (site) => site?.holder ?? READER;

// ── Attribution status (§9, §20e) ─────────────────────────────────────────────
// A belief the source STATES in the believer's own terms (a character's verbalized
// line, an institution's issued certification) is a firm attribution — but firm about
// the RECORD, not about the holder's mind or the world: the system firmly read that
// Grete SAID it, which is a fact about the text. A belief the engine INFERS is the
// default — reafferent, surfaced as a guess, never as the mind's fact. Either way the
// value carries `modeledBy: instrument` and cannot witness the holder's actual mind.
export const STATUS = Object.freeze({ INFERRED: 'inferred', STATED: 'stated' });
const isStatus = (s) => s === STATUS.INFERRED || s === STATUS.STATED;

// ── The Belief shape (§20e) ────────────────────────────────────────────────────
//
//   Belief = {
//     believer:  Holder,      // the inner root: Grete, the election, the observer
//     modeledBy: Holder,      // the outer root: for any non-self holder, ALWAYS the
//                             //   instrument, never elided (§20f). For the self-fold
//                             //   it coincides with the believer (§20c).
//     status:    'inferred' | 'stated',
//     content,                // a leaf fact { key, value } (value null = void/unknown),
//                             //   or a nested Belief for higher-order ToM (§20b)
//     prov,                   // the type-law edge: reafferent for a modeled holder
//                             //   (the instrument authored it), pass-through for self
//   }
//
// makeBelief is the general constructor. For a non-self believer it FORCES the outer
// root to the instrument and stamps the belief reafferent — there is no way to mint a
// belief about another holder that the system could then mistake for a fact (§20a).
export const makeBelief = ({ believer, content = null, status = STATUS.INFERRED, modeledBy = null, prov = null } = {}) => {
  if (!believer) throw new TypeError('makeBelief: a belief needs a believer (its inner root)');
  if (!isStatus(status)) throw new TypeError(`makeBelief: unknown status ${status}`);

  if (isSelf(believer)) {
    // The §20c exception: the self-fold has ONE root, directly held. The outer and
    // inner root coincide; provenance passes through (exafferent when the instrument
    // read it from the doc → it may anchor; reafferent when self-generated).
    return Object.freeze({ believer: INSTRUMENT, modeledBy: INSTRUMENT, status, content, prov });
  }
  // A model of another holder. The outer root is the instrument, never elided (§20f);
  // `modeledBy` may be an INNER holder for a nested higher-order node (§20b), but the
  // value is still authored by the instrument, hence reafferent. Defaulting to the
  // instrument keeps the top-level reported belief rooted there.
  return Object.freeze({
    believer,
    modeledBy: modeledBy ?? INSTRUMENT,
    status,
    content,
    // The instrument authored this model → reafference → cannot witness (§20a). The
    // enactment names whose fold is modeled, so the audit trail is legible.
    prov: prov ?? fromEnactor(`model:${believer}`),
  });
};

// selfBelief — the §20c first-person case. The instrument's own fold, directly held,
// one root. Pass the underlying provenance so the type law decides whether it anchors
// (a doc read is exafferent and may; a self-generated draft is reafferent and may not).
export const selfBelief = ({ content = null, status = STATUS.STATED, prov = null } = {}) =>
  makeBelief({ believer: INSTRUMENT, content, status, prov });

export const isBelief = (x) => !!x && typeof x === 'object' && 'believer' in x && 'modeledBy' in x;

// isModeled — is this a belief ABOUT another holder (two roots), as opposed to the
// instrument's own first-class fold (one root)? Exactly the §20c split.
export const isModeled = (belief) => isBelief(belief) && belief.believer !== INSTRUMENT;

// canAnchor — the §20a consequence, read off the SAME type law the witness uses
// everywhere. A modeled holder's belief is reafferent → never anchors. The self-fold
// anchors iff its underlying provenance is exafferent (it read it from the world).
// This is the §9 honesty rule, not asserted but DERIVED.
export const canAnchor = (belief) => isBelief(belief) && canWitness(belief.prov);

// beliefValue — the leaf value of a (possibly nested) belief: the innermost fact's
// value, or null when the chain bottoms out in void (the holder does not know).
export const beliefValue = (belief) => {
  if (!isBelief(belief)) return null;
  return isBelief(belief.content) ? beliefValue(belief.content) : (belief.content?.value ?? null);
};

// ── The nested-address notation (§20, §20b) ───────────────────────────────────
// Renders the honest holder-rooted address, outer root first and never elided:
//   instrument · models( grete · models( mother · loc=hall ) )
// The self-fold drops the models() wrapper — one root, directly held (§20c):
//   instrument · loc=hall
const factStr = (content) =>
  content == null ? '⊥'                                   // void: the holder does not know
  : isBelief(content) ? `models( ${innerExpr(content)} )`  // a nested model (higher-order)
  : typeof content === 'string' ? content
  : content.value == null ? `${content.key}=⊥`
  : `${content.key}=${content.value}`;

// the `<believer> · <rest>` fragment that sits inside a models( … )
const innerExpr = (belief) => `${belief.believer} · ${factStr(belief.content)}`;

export const beliefNotation = (belief) => {
  if (!isBelief(belief)) return '';
  if (!isModeled(belief)) return `${INSTRUMENT} · ${factStr(belief.content)}`;  // §20c self-fold
  return `${INSTRUMENT} · models( ${innerExpr(belief)} )`;                       // §20 nested root
};
