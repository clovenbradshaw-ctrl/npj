// The cube, named in full — the third axis and the two faces that carry it.
//
// core/operators.js fixes each operator's (Mode, Domain) — the Act face. This
// module adds the Object axis (the grain: Ground, Figure, Pattern) and names the
// other two faces that ride it:
//
//   Resolution face = Mode   × Object → the nine STANCES (how an event resolves)
//   Site face       = Domain × Object → the nine TERRAINS (where it lands)
//
// With all three faces named, the 27 Object-DIAGONAL cells become explicit, and
// the master spec's highest-leverage edit — "do not apply a Figure fix to a
// Ground problem", the confabulation guard — is just a lookup: a well-formed
// event lies where the three faces agree on grain, the shared Mode agrees across
// Act and Resolution, and the shared Domain agrees across Act and Site. The other
// 702 triples are contradictions. The registry in data/phasepost-cells.json is a
// projection of exactly these 27 cells; tests/cube.test.js binds the two so a
// drift in either fails loudly.
//
// Domain note: the master spec's Site face says "Significance"; the operator
// vocabulary (core/operators.js) calls that same domain "Interpretation". The
// terrains keyed under Interpretation here — Atmosphere / Lens / Paradigm — are
// the spec's Significance row.

import { OPERATORS, MODES, DOMAINS, GRAINS } from './operators.js';

// ── The Resolution face: Mode × Object → stance ──────────────────────────────
// Clearing dissolves ambient conditions; Dissecting takes a specific thing apart;
// Unraveling deconstructs a regularity. Tending maintains conditions; Binding
// connects specific things; Tracing maps regularities. Cultivating produces the
// conditions for emergence (the emptiest cell); Making builds the specific thing
// (the gravity well, the densest cell); Composing produces regularities.
export const STANCES = Object.freeze({
  Differentiate: Object.freeze({ Ground: 'Clearing',    Figure: 'Dissecting', Pattern: 'Unraveling' }),
  Relate:        Object.freeze({ Ground: 'Tending',     Figure: 'Binding',    Pattern: 'Tracing'    }),
  Generate:      Object.freeze({ Ground: 'Cultivating', Figure: 'Making',     Pattern: 'Composing'  }),
});

// ── The Site face: Domain × Object → terrain ─────────────────────────────────
// The Ground column (Void / Field / Atmosphere) is the ambient medium the reader
// rides; Figure and Pattern are inscribed into it. The Interpretation row is the
// spec's Significance row: Atmosphere (ambient meaning-tone), Lens (a reading
// under a frame), Paradigm (the frame-of-frames).
export const TERRAINS = Object.freeze({
  Existence:      Object.freeze({ Ground: 'Void',       Figure: 'Entity', Pattern: 'Kind'     }),
  Structure:      Object.freeze({ Ground: 'Field',      Figure: 'Link',   Pattern: 'Network'  }),
  Interpretation: Object.freeze({ Ground: 'Atmosphere', Figure: 'Lens',   Pattern: 'Paradigm' }),
});

// The stance at a (mode, grain), or null if either coordinate is off the cube.
export const stanceOf = (mode, grain) => STANCES[mode]?.[grain] ?? null;

// The terrain at a (domain, grain), or null if either coordinate is off the cube.
export const terrainOf = (domain, grain) => TERRAINS[domain]?.[grain] ?? null;

// Reverse lookups — the grain a stance / terrain name names (with the mode /
// domain it belongs to). A name uniquely fixes its row, so the reverse is total.
const STANCE_GRAIN  = new Map(); // stance  → { mode, grain }
const TERRAIN_GRAIN = new Map(); // terrain → { domain, grain }
for (const mode of MODES)
  for (const grain of GRAINS) STANCE_GRAIN.set(STANCES[mode][grain], { mode, grain });
for (const domain of DOMAINS)
  for (const grain of GRAINS) TERRAIN_GRAIN.set(TERRAINS[domain][grain], { domain, grain });

export const grainOfStance  = (stance)  => STANCE_GRAIN.get(stance)?.grain ?? null;
export const grainOfTerrain = (terrain) => TERRAIN_GRAIN.get(terrain)?.grain ?? null;

// The full (domain, grain) a terrain names — the Site-face row and column. The
// diagonal guard uses this to pick an operator in the terrain's OWN domain, so a
// coherence check on a claim's grain at that terrain is decided by grain alone.
export const terrainInfo = (terrain) => TERRAIN_GRAIN.get(terrain) ?? null;

// ── The 27 diagonal cells ────────────────────────────────────────────────────
// The legal events. Each operator (a fixed Mode × Domain) crosses the three
// grains to a stance and a terrain that share that grain — three cells per
// operator, 27 in all. The key is OP_Stance_Terrain, the same key the centroid /
// phasepost registry uses, so a cell here indexes its centroid there.
export const cellOf = (op, grain) => {
  const o = OPERATORS[op?.id ?? op];
  if (!o || !GRAINS.includes(grain)) return null;
  const stance  = stanceOf(o.mode, grain);
  const terrain = terrainOf(o.domain, grain);
  return Object.freeze({
    key: `${o.id}_${stance}_${terrain}`,
    op: o.id, mode: o.mode, domain: o.domain, grain, stance, terrain,
  });
};

export const DIAGONAL_CELLS = Object.freeze((() => {
  const cells = {};
  for (const op of Object.keys(OPERATORS))
    for (const grain of GRAINS) {
      const c = cellOf(op, grain);
      cells[c.key] = c;
    }
  return Object.freeze(cells);
})());

// ── The confabulation guard (master spec, Edit #1) ───────────────────────────
// Validate that an event lies on the Object diagonal: operator-grain, stance-grain
// (Resolution face), and terrain-grain (Site face) all agree, the operator's Mode
// matches the stance's Mode, and its Domain matches the terrain's Domain. The
// event may name any subset of { grain, stance, site/terrain }; whatever it names
// must cohere with the operator and with each other. Naming none is trivially
// coherent (the operator alone fixes Mode and Domain but leaves grain free).
//
// This is the formal statement of "the grain of the move must match the grain of
// the terrain". The Kafka confabulation — a Making (Generate × Figure) at a Void
// (Existence × Ground) — is off-diagonal here: Making's grain is Figure, Void's is
// Ground, they disagree, coherence rejects it before it ships.
export const coherence = (event) => {
  if (!event || typeof event !== 'object') return frozenVerdict(false, 'no-event');
  const o = OPERATORS[event.op ?? event.operator];
  if (!o) return frozenVerdict(false, 'unknown-operator');

  // Gather every grain the event asserts, by whatever face named it.
  const claims = [];
  if (event.grain != null) {
    if (!GRAINS.includes(event.grain)) return frozenVerdict(false, 'unknown-grain');
    claims.push(['grain', event.grain]);
  }
  if (event.stance != null) {
    const s = STANCE_GRAIN.get(event.stance);
    if (!s) return frozenVerdict(false, 'unknown-stance');
    if (s.mode !== o.mode)
      return frozenVerdict(false, `mode-mismatch: ${o.id} is ${o.mode}, stance ${event.stance} is ${s.mode}`);
    claims.push(['stance', s.grain]);
  }
  const terrain = event.terrain ?? event.site;
  if (terrain != null) {
    const t = TERRAIN_GRAIN.get(terrain);
    if (!t) return frozenVerdict(false, 'unknown-terrain');
    if (t.domain !== o.domain)
      return frozenVerdict(false, `domain-mismatch: ${o.id} is ${o.domain}, terrain ${terrain} is ${t.domain}`);
    claims.push(['terrain', t.grain]);
  }

  // Every named grain must be the same grain — that single shared grain is the
  // diagonal the operator's Mode and Domain run through.
  const grains = new Set(claims.map(([, g]) => g));
  if (grains.size > 1)
    return frozenVerdict(false, `grain-mismatch: ${claims.map(([k, g]) => `${k}=${g}`).join(' ')}`);

  const grain = claims.length ? claims[0][1] : null;
  const cell = grain ? cellOf(o.id, grain) : null;
  return Object.freeze({ ok: true, reason: null, operator: o.id, grain, cell });
};

const frozenVerdict = (ok, reason) => Object.freeze({ ok, reason, cell: null });

// A bare predicate over the same rule, for call sites that only want a boolean.
export const isDiagonal = (event) => coherence(event).ok;

// ── Read/write signatures from Mode (master spec, Edit #2) ────────────────────
// The dependency arrow's read/write declaration follows from the operator's Mode,
// not from a hand-declared field: Differentiating reads-and-voids (subtractive),
// Relating reads-two-writes-a-link (connective), Generating writes-new (additive,
// the only Mode that cannot be checked against something already present — which
// is why the seam, the one Generating step in the loop, earns the gate). This
// makes the Resolution face the literal source of the system's arrow of time; a
// hand-declared signature that disagrees with the Mode is a bug.
export const SIGNATURES = Object.freeze({
  Differentiate: Object.freeze({ mode: 'Differentiate', polarity: 'subtractive', reads: 'one',  writes: 'void', label: 'read-and-void' }),
  Relate:        Object.freeze({ mode: 'Relate',        polarity: 'connective',  reads: 'two',  writes: 'link', label: 'read-two-write-link' }),
  Generate:      Object.freeze({ mode: 'Generate',      polarity: 'additive',    reads: 'none', writes: 'new',  label: 'write-new' }),
});

export const signatureOf = (op) => {
  const o = OPERATORS[op?.id ?? op];
  return o ? SIGNATURES[o.mode] : null;
};

// ── Import-time alias table (master spec, Edit #3) ────────────────────────────
// Map the stale corpus forward to the current vocabulary, at ingestion only. The
// corpus archetype build (2026-04-24) carries the OLD operator names. The mapping
// is fixed by the cube GEOMETRY, not by the spelling of the old name: an operator
// at (Relate, Interpretation) is EVA whatever it was once called. The exemplar
// data settles the direction — SUP's cells (Binding / Tending / Tracing) are all
// Relate-mode, so SUP→EVA; ALT's cells (Dissecting / Clearing / Unraveling) are
// all Differentiate-mode, so ALT→DEF. (This matches the shipped centroid bundle's
// operator_rename {ALT: DEF, SUP: EVA} and the corrected master spec. We map the
// corpus forward; we never rename the system to match the corpus, and we never
// rewrite the record.)
export const OPERATOR_ALIASES = Object.freeze({ ALT: 'DEF', SUP: 'EVA' });

// Old stance names, if any are found in a stale record, map here. The current
// build already carries current stance names, so this is empty until a stale
// stance surfaces — extend it, never rename the system.
export const STANCE_ALIASES = Object.freeze({});

export const aliasOperator = (op) => OPERATOR_ALIASES[op] ?? op;
export const aliasStance   = (stance) => STANCE_ALIASES[stance] ?? stance;

// Map a registry/cell key OP_Stance_Terrain forward — alias the operator prefix
// (and any aliased stance) without touching the terrain.
export const aliasCellKey = (key) => {
  if (typeof key !== 'string') return key;
  const parts = key.split('_');
  if (parts.length < 1) return key;
  parts[0] = aliasOperator(parts[0]);
  if (parts.length >= 2) parts[1] = aliasStance(parts[1]);
  return parts.join('_');
};

// Self-check, in the spirit of core's "exactly nine operators" and the grain-band
// cover: every stance and terrain name is distinct, the diagonal has exactly 27
// cells, and every operator contributes three. A drift would silently admit an
// off-diagonal cell as legal, so it fails loudly at load.
{
  const stanceNames  = MODES.flatMap(m => GRAINS.map(g => STANCES[m][g]));
  const terrainNames = DOMAINS.flatMap(d => GRAINS.map(g => TERRAINS[d][g]));
  const cellCount = Object.keys(DIAGONAL_CELLS).length;
  if (new Set(stanceNames).size !== 9 || new Set(terrainNames).size !== 9 || cellCount !== 27)
    throw new Error('cube self-check failed: stances/terrains/diagonal are not a clean 9/9/27');
}
