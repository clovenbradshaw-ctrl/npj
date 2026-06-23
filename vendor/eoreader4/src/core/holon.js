// Holonic Site addressing — WHICH place an operation lands on (add-on 2 §B/§D).
//
// The Site face names WHERE an operation lands. The cube gives the KIND of place
// (the terrain — Entity / Field / Lens / …, fixed by Domain × grain). This module
// gives the SPECIFIC place: a holonic path that descends containment level by
// level, the way `customers.profiles.pets.name` names one target by walking down
// the holarchy. Each prefix along the path is itself a referent (customers,
// customers.profiles, …), and every referent has a stable hashId — the path is the
// human-readable address, the hashId is the identity of record.
//
//   site = (terrain, holon)        terrain: WHAT KIND (the cube)
//                                  holon:   WHICH ONE (this module)
//
// Grain stays load-bearing: the terrain is grain-typed by the cube, and the
// holonic DEPTH is the holonic level of the target. The two are different axes —
// grain is the operation's resolution band, depth is the target's nesting — so we
// keep them distinct and let the Site carry both. The hashId is FNV-1a over the
// canonical path, the same hash family the rest of the system uses for identity.

const SEP = '.';

// FNV-1a over a string → an 8-hex-digit stable id. Deterministic, zero-warmup;
// the identity of record for a referent, independent of its readable path.
const fnv1a = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

// Canonicalise a holonic path: trim, collapse blank segments, lower-case nothing
// (segment case may be meaningful), but normalise the separator and edges.
const canon = (path) => String(path ?? '')
  .split(SEP).map(s => s.trim()).filter(Boolean).join(SEP);

// The hashId of a referent named by a (canonical) path. All referents have one.
export const holonId = (path) => fnv1a(canon(path));

// Parse a holonic path into the frozen address: its segments, depth (the holonic
// level), the leaf, the parent path, and the hashId of record.
export const parseHolon = (path) => {
  const c = canon(path);
  const segments = c ? c.split(SEP) : [];
  return Object.freeze({
    path: c,
    segments: Object.freeze(segments),
    depth: segments.length,            // the holonic level of the target
    leaf: segments[segments.length - 1] ?? null,
    parent: segments.length > 1 ? segments.slice(0, -1).join(SEP) : null,
    id: holonId(c),
  });
};

// The chain of referents along a path — one entry per holonic level, each with its
// own prefix path and hashId. `customers.profiles.pets` →
//   [ {segment:'customers', path:'customers', depth:1, id}, … ]
// This is how a CON edge can walk UP the holarchy: every level is itself addressed.
export const holonLevels = (path) => {
  const segments = canon(path).split(SEP).filter(Boolean);
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const prefix = segments.slice(0, i + 1).join(SEP);
    out.push(Object.freeze({ segment: segments[i], path: prefix, depth: i + 1, id: holonId(prefix) }));
  }
  return Object.freeze(out);
};

// Holonic depth = holonic level. A bare referent is depth 1; the empty path is 0.
export const depthOf = (path) => canon(path).split(SEP).filter(Boolean).length;

// The parent referent's path (one level up the holarchy), or null at the root.
export const parentOf = (path) => parseHolon(path).parent;

// The leaf referent name (the target the path points at), or null.
export const leafOf = (path) => parseHolon(path).leaf;

// Descend the holarchy: join a child segment (or sub-path) onto a path.
export const joinHolon = (path, child) => canon([canon(path), canon(child)].filter(Boolean).join(SEP));

// Containment: is `ancestor` a holonic ancestor of (or equal to) `descendant`?
// A prefix on the segment boundary, so `customers` contains `customers.profiles`
// but not `customers2.profiles`.
export const containsHolon = (ancestor, descendant) => {
  const a = canon(ancestor), d = canon(descendant);
  if (!a) return true;                 // the root contains everything
  return d === a || d.startsWith(a + SEP);
};
