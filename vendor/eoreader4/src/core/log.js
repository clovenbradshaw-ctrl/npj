// The append-only event log. Single source of truth.
// Append is the only mutation. Retractions are written as SEG events —
// nothing is unwritten. The graph and every projection are folds of this.

import { isOperator } from './operators.js';
import { facesOf } from './faces.js';

let nextLogId = 1;

// Seal the geometry at emit time (add-on 2 §B/§D). Every logged operation is
// recorded as operator(Site, Stance) at a holonic address: the Act (operator), the
// Site (terrain + the holonic address of the target when the event names one), and
// the Stance (the manner). Computed HERE, the single chokepoint every event passes
// through, and frozen with the event — so the address reflects the holarchy at the
// moment of emission and, like everything in the append-only log, is never
// rewritten. A non-addressable event (no grain-coherent face) carries no `eo`.
const sealGeometry = (event) => {
  let f = null;
  try { f = facesOf(event); } catch { f = null; }
  if (!f) return null;
  const holon = f.site.holon || null;
  const siteStr = holon ? `${holon.path}@${f.site.terrain}` : f.site.terrain;
  return Object.freeze({
    notation: `${event.op}(${siteStr}, ${f.stance.stance})`,
    terrain: f.site.terrain,
    stance: f.stance.stance,
    address: holon ? Object.freeze({ path: holon.path, id: holon.id, depth: holon.depth }) : null,
  });
};

export const createLog = ({ docId } = {}) => {
  const id = nextLogId++;
  const events = [];
  const subscribers = new Set();

  const append = (event) => {
    if (!event || !isOperator(event.op)) {
      throw new TypeError(`log.append: invalid event ${JSON.stringify(event)}`);
    }
    const eo = sealGeometry(event);
    const sealed = Object.freeze({
      ...event,
      seq: events.length,
      t: event.t ?? Date.now(),
      ...(eo ? { eo } : {}),
    });
    events.push(sealed);
    for (const fn of subscribers) {
      try { fn(sealed); } catch { /* subscribers are best-effort */ }
    }
    return sealed;
  };

  const retract = (refSeq, reason) =>
    append({ op: 'SEG', kind: 'retract', refSeq, reason });

  const subscribe = (fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  };

  return {
    id,
    docId,
    append,
    retract,
    subscribe,
    get events() { return events; },
    get length() { return events.length; },
    snapshot() { return events.slice(); },
    filter(pred) { return events.filter(pred); },
    last(n = 1) { return events.slice(-n); },
  };
};

export const isLog = (x) =>
  !!x && typeof x.append === 'function' && Array.isArray(x.events);
