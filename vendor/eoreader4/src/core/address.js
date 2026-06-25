// eoAddressOfEvent — derive the three-fold address from an event at read time.
//
// Nothing is stamped on the event; the log stays the single source of truth.
// For an event with operator OP and grain G:
//   ACT        = (OP.mode,   OP.domain)         — what operation
//   SITE       = (OP.domain, G)  named TERRAIN  — where it lands
//   RESOLUTION = (OP.mode,   G)  named STANCE   — how it resolves
//
// Site and Resolution carry their cube names (terrain, stance) alongside their
// coordinates, so a single event reads off all three faces of the cube. Because
// both faces take their grain from the one event, the address is diagonal by
// construction — coherent() in cube.js holds trivially for it.

import { OPERATORS } from './operators.js';
import { stanceOf, terrainOf } from './cube.js';

const inferGrain = (event) => {
  if (event.grain) return event.grain;
  if (event.op === 'REC' || event.op === 'SYN' || event.op === 'CON') return 'Pattern';
  if (event.op === 'INS' || event.op === 'NUL') return 'Ground';
  return 'Figure';
};

export const eoAddressOfEvent = (event) => {
  const op = OPERATORS[event?.op];
  if (!op) return null;
  const grain = inferGrain(event);
  return Object.freeze({
    operator: op.id,
    act:        Object.freeze({ mode: op.mode,   domain: op.domain }),
    site:       Object.freeze({ domain: op.domain, grain, terrain: terrainOf(op.domain, grain) }),
    resolution: Object.freeze({ mode: op.mode,    grain, stance:  stanceOf(op.mode,   grain) }),
  });
};

export const eoNotation = (event) => {
  const a = eoAddressOfEvent(event);
  if (!a) return '?';
  return `${a.operator}(${a.site.domain.slice(0, 3)},${a.resolution.grain.slice(0, 3)})`;
};
