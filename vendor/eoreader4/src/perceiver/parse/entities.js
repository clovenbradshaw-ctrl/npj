// Entity admission — the ceiling the low places on what the high may claim.
//
// A capitalised span is admitted when it shows the SEMANTIC GRAVITY of a referent
// (see below) — not after an arbitrary number of sightings. Only admitted entities
// can be subjects of relations or be cited as sources for facts.
//
//   - A *multi-word* proper name ("Gregor Samsa", "Project Gutenberg") is
//     referential on its face and admits on first sighting.
//   - A single-token name admits as soon as it occupies an argument position —
//     subject, object, possessor, prepositional object, or apposition bearer —
//     so a name spoken once still anchors its proposition.
//   - Titles ("Mr.", "Mrs.", "Professor") are kept joined to the name and the
//     trailing period normalised, so "Mr. Samsa" is one entity, not a bare "Mr".
//
// The language-specific word-lists this turns on — prepositions, function words,
// role/kin words, clause-openers — are NOT held here. They are conventions
// (conventions.jsonl), seeded and learnable; admission READS them (injected by the
// pipeline, or the seeds as a standalone default). The parse leaf holds mechanism,
// not the language. The admission also remembers, per entity, the sentence indices
// where it was mentioned.

import {
  SEED_STARTER, SEED_FUNCTION, SEED_PREPOSITION, SEED_ROLE, SEED_AUXILIARY,
} from '../../core/conventions/index.js';

const TITLE = String.raw`(?:Mr|Mrs|Ms|Dr|Miss|Mister|Sir|Madam|Madame|Lady|Lord|Professor|Prof|Capt|Captain|Rev|St|Aunt|Uncle)\.?`;
// A lowercase connector (von, of, the) only counts when it sits *between* two
// capitalised words — never trailing, so "Grete the news" is just "Grete".
const CONN  = String.raw`de|von|van|der|del|di|du|la|le|of|the`;
const NAME  = String.raw`[A-Z][a-zA-Z]+(?:\s+(?:${CONN}\s+)?[A-Z][a-zA-Z]+)*`;
const CAP_RE = new RegExp(String.raw`\b(?:${TITLE}\s+)?${NAME}\b`, 'g');

// The default convention predicates, from the seeds — used by the standalone
// scanner and by an admission constructed without a live ledger. The pipeline
// passes its own (seed ∪ learned), so a document's dialect flows straight in.
const lc = (s) => String(s || '').toLowerCase();
const setOf = (seed) => new Set(seed.map(lc));
const DEFAULT_CONVENTIONS = (() => {
  const starter = setOf(SEED_STARTER), fn = setOf(SEED_FUNCTION);
  const prep = setOf(SEED_PREPOSITION), role = setOf(SEED_ROLE), aux = setOf(SEED_AUXILIARY);
  return {
    isStarter:     (w) => starter.has(lc(w)),
    isFunction:    (w) => fn.has(lc(w)),
    isPreposition: (w) => prep.has(lc(w)),
    isRole:        (w) => role.has(lc(w)),
    isAuxiliary:   (w) => aux.has(lc(w)),
  };
})();

const TITLE_WORDS = new Set([
  'Mr','Mrs','Ms','Dr','Miss','Mister','Sir','Madam','Madame','Lady','Lord',
  'Professor','Prof','Capt','Captain','Rev','St','Aunt','Uncle',
]);

const idFor = (label) =>
  label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

// ── Admission by SEMANTIC GRAVITY, not by a sighting count ──────────────────
//
// A referent earns admission the way mass accrues everywhere else in this system:
// by behaving like a referent. The old rule (admit on the second sighting) was a
// cheap proxy that both over- and under-fired — it missed a name spoken once that
// plainly anchors a proposition ("Cainan begat Mahalaleel" — Mahalaleel is real on
// first mention), and it admitted any capitalised token that merely recurred (KJV's
// "Behold,"/"Lo,"/"Hast thou" clause-openers become characters). Gravity fixes both:
//
//   a sighting in an ARGUMENT position has gravity ≥ the floor and admits at once —
//     · a possessor      "Abram's wife"        (it owns something)
//     · a kin/apposition  "his son Seth"        (a role names it)
//     · subject or object "Cainan begat X" / "X walked"  (it acts or is acted on)
//   a bare CLAUSE-OPENER ("Behold, …") has zero gravity, however often it recurs;
//   a bare mid-sentence mention has a little, so genuine list members still accrue
//   across a few sightings (the old recurrence intuition, kept as the weak case).

//   a bare CLAUSE-OPENER ("Behold, …") or a stray capital earns nothing, however
//   often it recurs — gravity, not a sighting count.

const GRAVITY_FLOOR = 1.0;

// A content head — an open-class word (`C.isFunction` is false), so a name beside
// it is a verb's argument rather than a function word's neighbour.
const isContent = (w, C) => !!w && /^[a-z][a-z'’]*$/.test(w) && w.length >= 2 && !C.isFunction(w);

// The gravity of one sighting, read off its local context against the live
// conventions `C`. Pure and modelless — position is the witness, the word-classes
// are the ledger's. A sighting earns the floor when it sits in an ARGUMENT
// position; anything else earns nothing (no count backstop, so a recurring
// clause-opener never accrues its way in).
const sightingGravity = (sentence, start, end, C) => {
  const after = sentence.slice(end);
  if (/^['’]s?\b/.test(after)) return 1.0;                            // possessor: "Abram's"
  const before = sentence.slice(0, start);
  const prev = (before.match(/([A-Za-z'’]+)\s*$/) || [])[1];
  const next = (after.match(/^\s*([A-Za-z'’]+)/) || [])[1];
  if (prev && (C.isRole(prev) || C.isPreposition(prev))) return 1.0;  // "his son Seth" / "unto Noah"
  if (isContent(next, C) || isContent(prev, C)) return 1.0;           // subject ("X walked") / object ("begat X")
  if (next && C.isAuxiliary(next)) return 1.0;                        // subject of a copula/aux ("Alice is …")
  return 0.0;                                                         // no referential gravity
};

const cleanLabel = (raw, C = DEFAULT_CONVENTIONS) => {
  let words = raw.trim().split(/\s+/);
  while (words.length > 0 && C.isStarter(words[0])) words.shift();
  if (words.length === 0) return null;
  // Normalise a leading title: drop the trailing period, keep it joined.
  const head = words[0].replace(/\.$/, '');
  if (TITLE_WORDS.has(head)) {
    if (words.length === 1) return null; // a bare title is not an entity
    words = [head, ...words.slice(1)];
  }
  if (words.length === 1 && C.isStarter(words[0])) return null;
  return words.join(' ');
};

// The conventions injected here are the language spec admission reads — the
// pipeline passes its live ledger (seed ∪ what the document taught); a standalone
// caller gets the seeds. Only the predicates admission needs are taken, so any
// conventions object (or a partial stub) works.
export const createEntityAdmission = ({ conventions } = {}) => {
  const C = conventions ? {
    isStarter:     (w) => conventions.isStarter(w),
    isFunction:    (w) => conventions.isFunction(w),
    isPreposition: (w) => conventions.isPreposition(w),
    isRole:        (w) => conventions.isRole(w),
    isAuxiliary:   (w) => conventions.isAuxiliary(w),
  } : DEFAULT_CONVENTIONS;
  const counts    = new Map(); // label → count
  const gravity   = new Map(); // label → Σ referential gravity over its sightings
  const admitted  = new Map(); // label → id (post-admission)
  const sightSent = new Map(); // label → number[] (every sighting's sentIdx)
  const mentions  = new Map(); // id    → number[] (sentence indices, ordered)

  const noteMention = (id, sentIdx) => {
    if (sentIdx == null) return;
    const arr = mentions.get(id) || [];
    arr.push(sentIdx);
    mentions.set(id, arr);
  };

  // Name-containment synthesis (SYN): a single-token name contained in an already-
  // admitted 2–3 word name. The WARRANT is split, because containment is not one
  // thing — this is the mr/mrs-samsa lesson:
  //
  //   'head' — the token is the GIVEN NAME (first word): "Gregor" ⊂ "Gregor Samsa".
  //            A given name individuates, so this is the high-confidence identity
  //            join: the id is unified here, as it always was.
  //   'tail' — the token is the SURNAME (last word): "Samsa" ⊂ "Gregor Samsa".
  //            A surname is SHARED across a family, so the join is THIN. It is NOT
  //            unified here; it carries the rebutter "a distinct agent bears this
  //            surname" and the pipeline commits it defeasibly, overturning it the
  //            moment the surname proves shared (the father acting alone).
  //
  // Returns { id, kind, token } (token = the shared single-token side) or null.
  const aliasOf = (label) => {
    const t = label.split(' ');
    for (const [lab, id] of admitted) {
      const lt = lab.split(' ');
      if (t.length === 1 && lt.length >= 2 && lt.length <= 3) {
        if (lt[0] === t[0])             return { id, kind: 'head', token: t[0] };
        if (lt[lt.length - 1] === t[0]) return { id, kind: 'tail', token: t[0] };
      }
      if (lt.length === 1 && t.length >= 2 && t.length <= 3) {
        if (t[0] === lt[0])             return { id, kind: 'head', token: lt[0] };
        if (t[t.length - 1] === lt[0])  return { id, kind: 'tail', token: lt[0] };
      }
    }
    return null;
  };

  const observe = (sentence, sentIdx = null) => {
    const seenInSentence = new Set();
    const out = [];
    const re = new RegExp(CAP_RE.source, 'g');
    let m;
    while ((m = re.exec(sentence)) !== null) {
      const label = cleanLabel(m[0], C);
      if (!label) continue;
      if (seenInSentence.has(label)) continue;
      seenInSentence.add(label);

      if (sentIdx != null) {
        const s = sightSent.get(label) || [];
        s.push(sentIdx);
        sightSent.set(label, s);
      }

      const c = (counts.get(label) ?? 0) + 1;
      counts.set(label, c);
      const multiword = label.includes(' ');
      // Accrue this sighting's gravity. A multi-word proper name is referential on
      // its face (it is not a clause-opener accident), so it carries the floor.
      const g = (gravity.get(label) || 0)
        + (multiword ? GRAVITY_FLOOR : sightingGravity(sentence, m.index, m.index + m[0].length, C));
      gravity.set(label, g);

      if (admitted.has(label)) {
        const id = admitted.get(label);
        noteMention(id, sentIdx);
        out.push({ status: 'present', id, label });
      } else if (g >= GRAVITY_FLOOR) {
        const rawId = idFor(label);
        const alias = aliasOf(label);
        // A HEAD (given-name) containment unifies the id here, as it always did. A
        // TAIL (surname) containment does NOT: the entity keeps its own id, so the
        // thin merge the pipeline commits can be defeated by a later event without
        // rewriting this admission — the append-only discipline, applied to identity.
        const head = alias && alias.kind === 'head';
        const id = head ? alias.id : rawId;
        admitted.set(label, id);
        // Seed/accumulate mentions under the (possibly shared) referent id;
        // the candidate sighting had no id yet, so the first line is not lost.
        if (!mentions.has(id)) mentions.set(id, []);
        for (const si of (sightSent.get(label) || [])) mentions.get(id).push(si);
        out.push({
          status: 'admit', id, label, rawId,
          aliasOf:   alias ? alias.id : null,
          aliasKind: alias ? alias.kind : null,
          surname:   alias && alias.kind === 'tail' ? String(alias.token).toLowerCase() : null,
        });
      } else {
        out.push({ status: 'candidate', label });
      }
    }
    return out;
  };

  return {
    observe,
    isAdmitted: (label) => admitted.has(label),
    idOf:       (label) => admitted.get(label),
    labelOf:    (id)    => {
      for (const [label, eid] of admitted) if (eid === id) return label;
      return null;
    },
    get counts()   { return counts; },
    get admitted() { return admitted; },
    get mentions() { return mentions; },
  };
};

// Exposed so the relation parser can share the exact same entity scanner.
export const scanEntities = (text) => {
  const re = new RegExp(CAP_RE.source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = cleanLabel(m[0]);
    if (label) out.push({ label, start: m.index, end: m.index + m[0].length });
  }
  return out;
};
