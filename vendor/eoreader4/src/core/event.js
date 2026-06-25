// core/event.js — the formal event op(Site, Resolution, Provenance, t). (SPEC §1, §3)
//
// Every entry in the append-only log is an EVENT. The reading side already speaks
// the nine operators (core/operators.js); this is the generation side's formal
// notation for the SAME vocabulary, carrying the two tiers of identity the writer
// reasons over and the provenance edge that draws its self/world line (§8).
//
//   Event = { op, site, res, prov, t, promotes? }
//
// TWO TIERS OF IDENTITY, independent by construction (§1):
//
//   Site / hashId  — the EXISTENCE handle. Opaque, minted ONCE at first appearance
//                    (the INS, INS-by-appearance), stable under learning. It is NOT
//                    content-addressed on mutable properties — those change as you
//                    read and would shatter identity. Coref BINDS to it; it never
//                    MINTS a second one.
//   Resolution     — HOW-DEFINITELY. void … firm, carrying the proper-scorable
//                    probability the log score grades (§10). A referent can hold a
//                    FIRM hash (it appeared, it exists in the discourse) and a VOID
//                    Resolution (we don't know which/what it is): "a man, we never
//                    learn his name" = firm r#7f3, surface "a man", void on the
//                    name-DEF. This is what makes deferred introduction legal
//                    without ever loosening the arity gate (§3).
//
// The provenance edge is typed in core/provenance.js; an event simply carries it,
// set at entry and never edited.

import { isOperator } from './operators.js';
import { signatureOf } from './cube.js';

// ── Resolution — the second tier of identity ─────────────────────────────────
// A band and a probability. The band is the gate the scheduler propagates (§3b);
// the probability is what the strictly-proper log score bites on (§10). Bare
// bands are not proper-scorable, so a Resolution always carries a `p`.
export const BANDS = Object.freeze({ VOID: 'void', FIRM: 'firm' });

// Default probabilities when a caller names only the band: a firm commitment
// asserts (high p), a void one withholds (low p). A caller that has a calibrated
// probability passes it; these are only the bare-band fallbacks.
const DEFAULT_P = Object.freeze({ void: 0.1, firm: 0.9 });

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);

export const makeResolution = (band = BANDS.FIRM, p) => {
  const b = band === BANDS.VOID ? BANDS.VOID : BANDS.FIRM;
  const prob = clamp01(p);
  return Object.freeze({ band: b, p: prob == null ? DEFAULT_P[b] : prob });
};

// Convenience constructors — read at call sites as `firm(0.8)` / `voidRes()`.
export const firm    = (p) => makeResolution(BANDS.FIRM, p);
export const voidRes = (p) => makeResolution(BANDS.VOID, p);

export const isFirm = (res) => resBand(res) === BANDS.FIRM;
export const isVoid = (res) => resBand(res) === BANDS.VOID;

// Read a band off either a Resolution object or a bare band string, so the
// scheduler and the kernels can pass either shape.
const resBand = (res) =>
  res == null ? BANDS.FIRM
  : typeof res === 'string' ? (res === BANDS.VOID ? BANDS.VOID : BANDS.FIRM)
  : (res.band === BANDS.VOID ? BANDS.VOID : BANDS.FIRM);
const resP = (res) =>
  res && typeof res === 'object' && Number.isFinite(res.p) ? res.p : DEFAULT_P[resBand(res)];

// The weaker of two resolutions — VOID DOMINATES (§3b). The probability carried
// forward is the more conservative (the lower p), so propagation never firms a
// commitment up by laundering a high p past a void band.
export const weaker = (a, b) => {
  const band = resBand(a) === BANDS.VOID || resBand(b) === BANDS.VOID ? BANDS.VOID : BANDS.FIRM;
  return makeResolution(band, Math.min(resP(a), resP(b)));
};

// effectiveRes — Resolution propagates along the DAG; void dominates (§3b):
//   effectiveRes(cell) = min over deps (void < firm).
// A SYN over any void-resolved constituent inherits void and must hedge (§3a/§7);
// firming it up is the overclaim the witness flags. Folding `weaker` over the
// dependency resolutions is that min, made mechanical.
export const effectiveRes = (resolutions) => {
  const xs = (resolutions || []).filter(Boolean);
  if (!xs.length) return makeResolution(BANDS.FIRM, DEFAULT_P.firm);
  return xs.reduce((acc, r) => weaker(acc, r), firm(1));
};

// ── Site — the holon address holder · r#<id>@<grain> ──────────────────────────
// `grain` is the holon-stack level: 0 at first appearance, +1 each SYN promotion
// (§3a). It is NOT the cube's named Ground/Figure/Pattern triad (that is the
// relative focal grain of §9) — here it is a promotion counter on the referent.
//
// A Site has a HOLDER ROOT (§1, §2): `holder · r#id@grain`. The same proposition is a
// different Site under `narrator.*` than under `grete.*` — same content, different
// root. The single-holder forms used in §3–§8 are the case where holder = reader and
// is elided; so `holder` is attached only when supplied, and a holderless Site is the
// elided-reader Site, byte-for-byte what the pre-holder code minted (core/holder.js
// reads the default with holderOf).
export const makeSite = (hash, grain = 0, holder = null) =>
  Object.freeze(holder
    ? { holder, hash, grain: grain | 0 }
    : { hash, grain: grain | 0 });

// The formal Site notation: `holder · r#a3f@0` (the holder root dropped when elided).
// The audit string; the membrane (§5) asserts it never reaches the model.
export const siteNotation = (site) =>
  site == null ? '' : `${site.holder ? `${site.holder} · ` : ''}${site.hash}@${site.grain ?? 0}`;

// A hashId is opaque base36 under the r# prefix (the mint shape of contract.mjs).
// The membrane test (§5) and the witness rebind (§7) both key on this pattern.
export const HASHID_RE = /r#[0-9a-z]+/;
export const isHashId = (s) => typeof s === 'string' && /^r#[0-9a-z]+$/.test(s);

// mintHash — the EXISTENCE handle, minted once from a monotonic appearance seq.
// Opaque and stable: it does not change as the referent's descriptors accrue. The
// fold owns the seq (appearance order); this is the pure shape of the id so every
// holon mints identically. A content hash over a STABLE anchor (a proper name) MAY
// be computed elsewhere as a coref MERGE HINT, but identity is the mint, never the
// content (§1).
export const mintHash = (seq) => 'r#' + Number(seq >>> 0).toString(36).padStart(3, '0');

// ── The arity law, read off the cube (§3a) ───────────────────────────────────
// A relation has arity; its argument slots cannot be empty. The cube's Resolution
// face already declares this: a Relate-mode operator READS TWO (cube SIGNATURES),
// so its two argument Sites must have appeared. "Subject/object" is the prose name
// for a saturated argument slot; the gate is modality-blind. Generate-mode writes
// new (INS/SYN/REC) and Differentiate-mode reads one — neither carries the
// two-slot arity obligation a CON does.
export const fillsTwoSlots = (op) => signatureOf(op)?.reads === 'two';

// ── The event constructor ────────────────────────────────────────────────────
// op(site, res, prov, t). `site` is one Site or an array (arity is per-operator,
// §3). `prov` is the me-ness edge (core/provenance.js), set at entry and frozen
// with the event — never edited (§8). `promotes` is set by SYN only: the new
// higher-grain figure it mints (§3a).
export const makeEvent = ({ op, site, res, prov = null, t = 0, promotes = null } = {}) => {
  if (!isOperator(op)) throw new TypeError(`makeEvent: not an operator: ${op}`);
  const resolution = res == null ? makeResolution(BANDS.FIRM)
    : (typeof res === 'string' ? makeResolution(res) : makeResolution(res.band, res.p));
  return Object.freeze({
    op,
    site: Array.isArray(site) ? Object.freeze(site.slice()) : site ?? null,
    res: resolution,
    prov,
    t,
    ...(promotes ? { promotes } : {}),
  });
};

// The argument Sites of an event as a flat list (one Site or many), for the arity
// gate and the cursor's multi-Site hand-off (§5).
export const sitesOf = (event) => {
  const s = event?.site;
  if (s == null) return [];
  return Array.isArray(s) ? s.slice() : [s];
};
