// The three faces of the cell — Act, Site, Stance (add-on 2 §B).
//
// A cell is (Mode, Domain, Object). It casts three shadows, and each is a face:
//
//   ACT    (Mode × Domain)   the operator   — WHAT is done
//   SITE   (Domain × Object) the terrain    — WHERE it lands
//   STANCE (Mode × Object)   the manner     — HOW it is done
//
//   written:  operator( Site , Stance )
//
// core/operators.js fixes the Act face; core/cube.js fixes the Site (TERRAINS)
// and Stance (STANCES) faces and the coherence guard; core/address.js reads all
// three off an event. This module is the explicit face vocabulary the add-on asks
// for: read an event/cell as operator(Site, Stance), name each face, and resolve a
// cell from a Site and a Stance — always through the coherence guard, so grain
// stays load-bearing and a grain-mixed (off-home) request is rejected, not
// silently shipped. The Site is enriched with the holonic address (holon.js) when
// the event names a specific target, so the Site carries both the KIND of place
// (terrain) and WHICH place (path + hashId).

import { OPERATORS } from './operators.js';
import { cellOf, coherence, grainOfStance, grainOfTerrain, terrainOf, stanceOf } from './cube.js';
import { eoAddressOfEvent } from './address.js';
import { parseHolon } from './holon.js';

// The three faces, named: which two axes each spans and which question it answers.
export const FACES = Object.freeze({
  Act:    Object.freeze({ axes: Object.freeze(['Mode', 'Domain']),   asks: 'what is done',    value: 'operator' }),
  Site:   Object.freeze({ axes: Object.freeze(['Domain', 'Object']), asks: 'where it lands',  value: 'terrain'  }),
  Stance: Object.freeze({ axes: Object.freeze(['Mode', 'Object']),   asks: 'how it is done',  value: 'stance'   }),
});

// Read all three faces off an event. Built on eoAddressOfEvent (the diagonal,
// grain-coherent address), then enriched: the Site carries the holonic address of
// the target when the event names one (`event.holon`, else the node/src/id it
// acts on becomes a depth-1 referent). Returns null for a non-operator event.
export const facesOf = (event) => {
  const addr = eoAddressOfEvent(event);
  if (!addr) return null;
  const targetPath = event.holon ?? event.node ?? event.src ?? event.id ?? null;
  const holon = targetPath != null ? parseHolon(String(targetPath)) : null;
  return Object.freeze({
    act:    addr.act,
    site:   Object.freeze({ ...addr.site, ...(holon ? { holon } : {}) }),
    stance: Object.freeze({ mode: addr.resolution.mode, grain: addr.resolution.grain, stance: addr.resolution.stance }),
  });
};

// Notate an event/cell as operator(Site, Stance) — the add-on's canonical written
// form, with the full terrain and stance names (not the 3-letter eoNotation).
//   CON(Link, Binding) · REC(Paradigm, Composing)
export const notate = (event) => {
  const f = facesOf(event);
  if (!f) return '?';
  return `${f.act ? OPERATORS[event.op ?? event.operator].id : '?'}(${f.site.terrain}, ${f.stance.stance})`;
};

// Notate with the holonic target woven into the Site, when present:
//   CON(customers.profiles.pets@Link, Binding)
export const notateHolon = (event) => {
  const f = facesOf(event);
  if (!f) return '?';
  const op = OPERATORS[event.op ?? event.operator].id;
  const site = f.site.holon ? `${f.site.holon.path}@${f.site.terrain}` : f.site.terrain;
  return `${op}(${site}, ${f.stance.stance})`;
};

// Resolve a cell from an operator and a Site and/or a Stance — the inverse of
// reading: name the where and the how, get the cell. Grain is enforced: the Site
// and Stance must share the operator's diagonal (coherence guard), so a grain-mixed
// request (SIG at Entity but Tending — Figure vs Ground) returns null rather than a
// confabulated cell. This keeps "the full 27" honest: an operator's legal cells are
// its three grain-coherent ones, addressable by either face.
export const cellAt = (op, { site, stance } = {}) => {
  const o = OPERATORS[op?.id ?? op];
  if (!o) return null;
  const probe = { op: o.id, ...(site ? { terrain: site } : {}), ...(stance ? { stance } : {}) };
  const v = coherence(probe);
  if (!v.ok) return null;             // grain-mixed / off-domain → rejected by the guard
  const grain = v.grain
    ?? (site ? grainOfTerrain(site) : null)
    ?? (stance ? grainOfStance(stance) : null);
  return grain ? cellOf(o.id, grain) : null;
};

// The three grain-coherent cells of an operator — its legal Sites and Stances, one
// per grain. This is the operator's full reach within the guard: NOT one home cell,
// but the three the diagonal allows it.
export const cellsOf = (op) => {
  const o = OPERATORS[op?.id ?? op];
  if (!o) return null;
  return Object.freeze(['Ground', 'Figure', 'Pattern'].map(g => cellOf(o.id, g)));
};

// Convenience: the (terrain, stance) pair an operator takes at a given grain — the
// Site and Stance faces of one of its legal cells.
export const siteStanceAt = (op, grain) => {
  const o = OPERATORS[op?.id ?? op];
  if (!o) return null;
  const terrain = terrainOf(o.domain, grain);
  const stance = stanceOf(o.mode, grain);
  return terrain && stance ? Object.freeze({ site: terrain, stance }) : null;
};
