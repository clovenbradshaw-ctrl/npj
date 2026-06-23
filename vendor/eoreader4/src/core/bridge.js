// THE CONNECTIVITY SURPRISE — the modality-agnostic core for structural reveals.
//
// There are two backward objects a significance reading can move on. `surpriseAt`
// (surprise.js) moves on MASS — the γ-decayed profile of what has arrived. This one
// moves on STRUCTURE — the connectivity of the entity bond graph. They are different
// invariants, and a reveal lives in the gap between them: a line that bonds two
// entities ALREADY in the cast (both carry mass, the one new triple is a tiny deposit)
// barely moves the mass KL, yet a human reads it as the turn — because it COLLAPSES a
// separation the reading was holding (the two entities sat in different regions of the
// graph). `surpriseAt` is blind to that; this reads it directly.
//
// Like surprise.js, the ONLY modality-specific thing is the FRONT-END: the operators on
// the log. This core reads CON/SIG bonds (the edges) and SYN merges (identity) — the
// genome's own vocabulary — and knows nothing of text, music, or vision. Any organ that
// emits bonds and merges onto the log gets this channel for free, exactly as it gets the
// mass surprise. A fix that helped only one modality would have leaked; this one cannot,
// it never sees a modality.
//
// CAUSALITY. Read at a cursor, the channel sees only the cursor and before. The bond
// graph G is every CON/SIG edge with sentIdx < cursor; a line's bonds (sentIdx ===
// cursor) are the arrivals. The IDENTITY quotient is the engine's SYN-merge union-find
// (the same one projectGraph computes), but restricted CAUSALLY to merges with sentIdx
// <= cursor — recognizing "Calvert" as the standing Cecil Calvert is part of reading the
// cursor line, never lookahead. Resolving coreference as IDENTITY (one node), not as an
// adjacency edge, is load-bearing: a reveal that refers to a standing entity by a new
// surface form ("Calvert", not "Cecil Calvert") is invisible to a raw-id reading (the
// fresh surface id has no past and sits in its own component), and a re-bond among
// adjacent entities fakes a 2-hop separation through the unmerged surface id. The
// quotient removes both artifacts.

// The geodesic ceiling D∞ — the distance at which a same-component pair reads as
// effectively separate (a full bridge). A CONSTANT, not tuned to any stimulus: the
// dominant signal (different components → 1.0) does not use it at all; D∞ only scales
// the weaker same-component gradient (δ-1)/D∞. Six is the classic "degrees of
// separation" ceiling — large for an entity bond graph.
export const BRIDGE_DINF = 6;

// bridgeSurprise(log, cursor, { dInf }) → { bridge, pair, axis }
//
//   log     the append-only event log (anything with snapshot() or .events)
//   cursor  the reading cursor (a unit index); the line read is the one AT cursor
//   dInf    the geodesic ceiling (default BRIDGE_DINF)
//
// Returns the SIGNIFICANCE-over-STRUCTURE channel:
//   bridge  MAX over the cursor line's bonds of how much each collapses the prior
//           separation between its (coref-resolved) endpoints — 1 when they were in
//           different components, (δ-1)/D∞ at same-component geodesic δ, 0 when already
//           adjacent (a re-bond confirms, it does not bridge) or when either endpoint is
//           new mass (a fresh entity is the mass channel's job, not a bridge). In [0,1].
//   pair    [rootA, rootB] of the bond that achieved the max (the bridging pair), or null.
//   axis    the labels of `pair` if the log carries INS labels, else the ids — the
//           dimension this surprise fired along, for the trace.
export const bridgeSurprise = (log, cursor, { dInf = BRIDGE_DINF } = {}) => {
  const events = typeof log.snapshot === 'function' ? log.snapshot() : (log.events || []);
  const at = cursor | 0;

  // --- The identity quotient C: the engine's SYN-merge union-find, causal to cursor. --
  // A merge with sentIdx <= cursor collapses two surface ids into one node.
  const parentC = new Map();
  const findC = (x) => { let p = parentC.get(x) ?? x; while (p !== (parentC.get(p) ?? p)) p = parentC.get(p) ?? p; return p; };
  const unionC = (a, b) => { const ra = findC(a), rb = findC(b); if (ra !== rb) parentC.set(ra, rb); };
  for (const e of events) {
    if (e.op === 'SYN' && e.kind === 'merge' && e.from != null && e.to != null && e.sentIdx != null && e.sentIdx <= at) {
      unionC(e.from, e.to);
    }
  }
  const R = (id) => (id == null ? id : findC(id));   // resolve a surface id to its identity root

  const label = new Map();
  const labelOf = (root) => label.get(root) || root;

  // --- firstSeen per identity root: the earliest line the entity appears (INS or bond
  //     endpoint), so "existed before the cursor" is firstSeen < cursor. ---------------
  const firstSeen = new Map();
  const see = (id, s) => {
    if (id == null || s == null) return;
    const r = R(id);
    const p = firstSeen.get(r);
    if (p == null || s < p) firstSeen.set(r, s);
  };

  // --- The connectivity graph G (bonds before the cursor) + this line's arrivals. -----
  // The component test reuses a union-find (the genome's SYN primitive, here over bonds);
  // BFS runs only when two endpoints are same-component.
  const parentG = new Map();
  const findG = (x) => { let p = parentG.get(x) ?? x; while (p !== (parentG.get(p) ?? p)) p = parentG.get(p) ?? p; return p; };
  const unionG = (a, b) => { const ra = findG(a), rb = findG(b); if (ra !== rb) parentG.set(ra, rb); };
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  };

  const arrivals = [];           // [rootA, rootB] bonds delivered at the cursor line
  const sharedObj = new Map();   // cursor-line object root → Set(distinct subject roots)
  for (const e of events) {
    const s = e.sentIdx;
    if (e.op === 'INS') { if (!label.has(R(e.id))) label.set(R(e.id), e.label); see(e.id, s); continue; }
    const isBond = e.op === 'CON' || e.op === 'SIG';
    if (!isBond) continue;       // SYN already consumed by C; only bonds build G/arrivals
    let a = e.src, b = e.tgt;
    if (a == null || b == null || s == null) continue;
    see(a, s); see(b, s);
    a = R(a); b = R(b);          // resolve endpoints to identity roots
    if (s < at) {                // G — the bond graph before the cursor line
      if (a !== b) { unionG(a, b); link(a, b); }
    } else if (s === at) {       // the cursor line's own bonds — the arrivals
      arrivals.push([a, b]);
      if (!sharedObj.has(b)) sharedObj.set(b, new Set());
      sharedObj.get(b).add(a);
    }
  }
  // The shared-object 2-paths: distinct subjects on one object on the cursor line, read
  // as (a — object — b). The weak SVO parse will not draw that convergence as a direct
  // bond, but a shared object already puts two subjects at distance two in the graph.
  for (const subs of sharedObj.values()) {
    const arr = [...subs];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) arrivals.push([arr[i], arr[j]]);
  }

  const existedBefore = (root) => { const f = firstSeen.get(root); return f != null && f < at; };
  const bfs = (src, dst) => {    // geodesic hop count; only called when same-component
    if (src === dst) return 0;
    const seen = new Set([src]); let frontier = [src], d = 0;
    while (frontier.length) {
      d++; const next = [];
      for (const u of frontier) for (const v of (adj.get(u) || [])) {
        if (v === dst) return d;
        if (!seen.has(v)) { seen.add(v); next.push(v); }
      }
      frontier = next;
    }
    return Infinity;
  };
  const collapse = (a, b) => {
    if (a === b) return 0;
    if (findG(a) !== findG(b)) return 1;                         // different components — maximal collapse
    const dist = bfs(a, b);                                      // same component — geodesic
    if (dist <= 1) return 0;                                     // already adjacent — confirmation, not a bridge
    return Math.min(1, Math.max(0, (dist - 1) / dInf));
  };

  let bridge = 0, pair = null;
  for (const [a, b] of arrivals) {
    if (a === b || !existedBefore(a) || !existedBefore(b)) continue;  // a fresh endpoint is new mass, not a bridge
    const c = collapse(a, b);
    if (c > bridge) { bridge = c; pair = [a, b]; }
  }
  const axis = pair ? [labelOf(pair[0]), labelOf(pair[1])] : null;
  return { bridge, pair, axis };
};
