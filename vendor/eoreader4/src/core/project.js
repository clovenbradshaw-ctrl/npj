// projectGraph — pure fold over the event log producing the active graph.
//
// Pure on (log, frame). Everything the projection reads — including the
// reading rules (γ, edge weight floor, etc.) — must arrive through
// `frame`. This is the discipline lifted from engine.js:7052, where the
// live projector reads READING_RULES.decay_gamma from module scope and
// silently invalidates any memo not keyed on the rules. Here we take the
// rules in explicitly:
//
//   const frame = {
//     cursor, edgeAffinity,
//     rules: { decay_gamma: 0.7, edge_weight_floor: 0 },
//   };
//   const g = projectGraph(log, frame);
//
// Memoized by (log.length, frameSig). Safe because the log is append-only
// AND the frame (including rules) is fully serialized into the key —
// same key, same result.

export const DEFAULT_PROJECTION_RULES = Object.freeze({
  // Mass decays at γ per sentence distance from the cursor.
  // engine.js READING_RULES.decay_gamma.value.
  decay_gamma: 0.7,
  // Edges below this weight are pruned from the projection. 0 disables.
  edge_weight_floor: 0,
});

const memo = new WeakMap(); // log → { length, frameSig, result }

export const projectGraph = (log, frame = {}) => {
  const rules     = { ...DEFAULT_PROJECTION_RULES, ...(frame.rules || {}) };
  const fullFrame = { ...frame, rules };
  const frameSig  = canonicalFrame(fullFrame);
  const cached    = memo.get(log);
  if (cached && cached.length === log.length && cached.frameSig === frameSig) {
    return cached.result;
  }
  const result = computeProjection(log, fullFrame);
  memo.set(log, { length: log.length, frameSig, result });
  return result;
};

export const projectionStats = (log) => {
  const c = memo.get(log);
  return c
    ? { cached: true, atLength: c.length, frameSig: c.frameSig }
    : { cached: false };
};

const canonicalFrame = (f) => {
  // Deterministic serialization: sorted keys, recursive on plain objects.
  // Rules are a plain object so the inner keys must also be sorted.
  const ser = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + ser(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  };
  return ser(f);
};

const computeProjection = (log, frame) => {
  const events    = log.snapshot();
  const entities  = new Map();
  const edges     = [];
  const voidsRaw  = [];
  const parent    = new Map();
  const retracted = new Set();

  const find = (x) => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    return p;
  };

  // First pass: collect retractions so a SEG can undo a later-replayed event.
  for (const e of events) {
    if (e.op === 'SEG' && e.kind === 'retract' && e.refSeq != null) {
      retracted.add(e.refSeq);
    }
  }

  for (const e of events) {
    if (retracted.has(e.seq)) continue;
    // A carved absence — the document witnessing that a relation slot is VOID
    // (the four VOID emitters; an explicit_void note `A --rel--> [void]`, or a
    // DEF to VOID). It is content, not silence: the edge-grounding veto compares
    // a talker claim against it for the CONTRADICTED verdict, the libel-grade
    // catch (edge-grounding §3/§10). Kept out of the edge/entity passes — a void
    // is the absence of a tie, not a tie. Endpoints canonicalised after merge.
    if (e.kind === 'void') {
      voidsRaw.push({
        node: e.node ?? (e.src && e.src !== '[void]' ? e.src : e.tgt),
        rel: e.rel ?? e.via ?? null,
        sentIdx: e.sentIdx ?? null,
        seq: e.seq,
      });
      continue;
    }
    switch (e.op) {
      case 'INS': {
        const ent = entities.get(e.id) || {
          id: e.id, label: e.label, props: {}, sightings: 0, firstSeen: e.seq,
        };
        ent.sightings++;
        entities.set(e.id, ent);
        break;
      }
      case 'DEF': {
        const ent = entities.get(e.id);
        if (ent) ent.props[e.key] = e.value;
        break;
      }
      case 'SIG':
      case 'CON':
        // SIG and CON are both relation edges, the same way engine.js
        // treats text-layer SYN and CON together as relation edges
        // (engine.js:6855). CON — the binding bond at Relate × Structure
        // — is the 9th operator the eoreader3 README mislabeled as 8.
        edges.push({
          from: e.src, to: e.tgt,
          kind: e.op.toLowerCase(),
          via:  e.via,
          // The polarity/modality channel rides through verbatim when present — a
          // negated or hedged bond ("could not understand", "seemed clear") must
          // keep its sign and mood all the way to the reading, never silently
          // flattened to the positive. Absent on a plain bond (positive · realis).
          ...(e.polarity ? { polarity: e.polarity } : {}),
          ...(e.modality ? { modality: e.modality } : {}),
          seq:  e.seq,
          sentIdx: e.sentIdx,
          // Coupling: a referent resolved by field rather than by name carries
          // a sub-unit weight. The projection measures the field scaled by it;
          // a certain bond has no `w` and couples at 1.
          coupling: e.w == null ? 1 : e.w,
          // Provenance: a derived edge (e.g. the descriptor trigger's inferred
          // kinship hop) is defeasible. The edge-grounding veto reads this flag —
          // a derived filler never satisfies the functional-axiom witness rule.
          derived: !!e.derived,
        });
        break;
      case 'SYN':
        // SYN-merge is the identity join (site-layer in engine.js). The
        // text-layer SYN-as-relation-edge ambiguity in engine.js is
        // disambiguated here: relation edges are CON; SYN is for merges.
        if (e.kind === 'merge') parent.set(find(e.from), find(e.to));
        break;
      // NUL: non-transformation — the thing is held as-is, not turned into
      //   graph structure and not cleared. (Voiding would be a DEF to VOID.)
      // SEG: handled in the first pass.
      // EVA, REC: live in the rules ledger (conventions), not in this projection.
    }
  }

  // Collapse via union-find.
  const merged = new Map();
  for (const [id, ent] of entities) {
    const root = find(id);
    const m = merged.get(root) || { ...ent, id: root, sightings: 0 };
    m.sightings += ent.sightings;
    merged.set(root, m);
  }

  // Edge weight is a field measurement, not a stored fact: bilinear in the
  // endpoint log-mass, scaled by the bond's coupling, falling off with an
  // exponential γ kernel in reading distance from the cursor (engine.js
  // Pass 2.5), gated by a weight floor. Everything is read from frame.rules —
  // the projection touches no module scope.
  const cursor = (frame.cursor == null || !isFinite(frame.cursor)) ? Infinity : frame.cursor;
  const γ      = frame.rules.decay_gamma;
  const floor  = frame.rules.edge_weight_floor;

  const edgesOut = [];
  for (const e of edges) {
    const f = find(e.from), t = find(e.to);
    const fS = merged.get(f)?.sightings || 1;
    const tS = merged.get(t)?.sightings || 1;
    let w = (Math.log(1 + fS) + Math.log(1 + tS)) * (e.coupling ?? 1);
    if (isFinite(cursor) && e.sentIdx != null) {
      const dist = Math.abs(cursor - e.sentIdx);
      w *= Math.pow(γ, dist);
    }
    if (w >= floor) edgesOut.push({ ...e, from: f, to: t, weight: w });
  }

  // Canonicalise void endpoints through the same union-find the edges use, so a
  // carved absence on a merged referent matches a claim about any of its aliases.
  const voids = voidsRaw.map(v => Object.freeze({ ...v, node: find(v.node) }));

  return Object.freeze({
    entities: merged,
    edges: edgesOut,
    voids: Object.freeze(voids),
    // Canonicalise any id to its merged referent — the binding of record the
    // edge-grounding veto resolves a talker claim's endpoints against, so a claim
    // about an alias lands on the same node its edges do (edge-grounding §5).
    representative: (id) => find(id),
    frame: Object.freeze({ ...frame }),
    rev: events.length,
  });
};
