// The naming-scene discovery — coreference by direct address.
//
// A standing role epithet ("his sister") is a REFERENT that carries its owner's
// relation ("Gregor's sister"); a name ("Grete") is a referent. A reader learns
// they are the SAME not from apposition — Kafka never writes "his sister Grete" —
// nor from proximity — Grete tends the whole family, so she co-occurs with every
// kin word equally — but from the NAMING SCENE: the mother cries the NAME, "Grete!",
// and the narrator attributes the ANSWER to the ROLE, "his sister called". The one
// addressed by name, answering as the role, IS that role's bearer.
//
// THIS MODULE IS A THIN TEXT WITNESS. The engine is universal: it sees only the SYN
// (the identity join) and the null (abstention) — the SAME operation equivalence.js
// runs for audio (two tones merge iff each is the other's nearest, abstaining below
// the noise floor). So the only thing language-specific here is the WITNESS, and its
// word-classes are NOT ours to hold — they are the conventions ledger's, already
// seeded and learnable: the attribution register (isAttributionVerb), the starter /
// interjection register (isStarter), and the kin lexicon (KIN_NOUNS). A Greek or
// audio corpus brings its own ledger; the merge it feeds is unchanged.
//
// The discovery emits a SYN, not a bond: once role referent and name merge,
// projectGraph's union-find carries the owner→role edge onto the name with no
// cascade. The guards are an identity join's: owner-distinctness (no one is their own
// sister), the INJECTED disjointness algebra (a name already the mother cannot also
// be the sister), and STICKY abstention — two names answering one role is the null,
// and the role referent is left UNNAMED rather than guessed.

import { scanVocatives, KIN_NOUNS } from './relations.js';

const REACH = 2;   // a vocative is answered within the next turn or two.

// The one gate the ledger does not yet carry: a free-capital that survives
// sentence-initial capitalisation yet names no person ("God", "Christmas"). This is
// the embedding "feels-like-a-subject" DEF — modality-specific, revisable — kept
// deliberately tiny. Everything else above is read from conventions.
const NONPERSON = new Set(['god', 'christmas', 'heaven', 'hell']);

const prevWord = (s, idx) => (s.slice(0, idx).match(/(\w+)\W*$/) || [])[1];

// Discover name↔role identities from naming scenes. Returns SYN proposals
// { role, ownerId, name } (slug space), already guarded. Pure over the parsed
// sentences + the live admission / coref field / conventions ledger.
export const discoverNamings = (
  sentences,
  { admission, corefField, conventions, rolesConflict = () => false } = {},
) => {
  const isStarter = conventions?.isStarter ?? (() => false);          // interjection class
  const isSpeech  = conventions?.isAttributionVerb ?? (() => false);  // attribution register

  // Owners per kin role, from the standing descriptors — only an ESTABLISHED NAMED
  // owner ("Gregor's sister") anchors a discovery; a bare epithet names no relation.
  const owner = {};
  for (const role of KIN_NOUNS) {
    const d = corefField.descriptorState(role);
    if (d && d.ownerNamed && d.ownerId) owner[role] = d.ownerId;
  }
  if (!Object.keys(owner).length) return [];
  const ROLE_SPEAKER = new RegExp(String.raw`\b(?:his|her|the)\s+(${KIN_NOUNS.join('|')})\b`, 'i');

  // Vocatives (admitted, person-gated, non-interjection) and role-epithet answers
  // (an owned epithet in a sentence the document marks as speech).
  const vocAt = [];   // { i, id }
  const ansAt = [];   // { i, role }
  sentences.forEach((sent, i) => {
    const s = String(sent);
    for (const v of scanVocatives(s)) {
      const prev = prevWord(s, v.index);
      if (prev && isStarter(prev)) continue;                  // interjection (ledger: starter)
      if (NONPERSON.has(v.name.toLowerCase())) continue;      // names no person (embedding DEF)
      if (admission.isAdmitted(v.name)) vocAt.push({ i, id: admission.idOf(v.name) });
    }
    const m = s.match(ROLE_SPEAKER);
    if (m && owner[m[1].toLowerCase()] && s.split(/\W+/).some(isSpeech)) ansAt.push({ i, role: m[1].toLowerCase() });
  });

  // Pair each vocative with the role epithet that ANSWERS it (a later turn, within
  // reach). The caller of the name sits at or before the vocative; the responder —
  // the bearer — is the next role to speak.
  const raw = [];
  for (const v of vocAt) {
    const ans = ansAt.find(a => a.i > v.i && a.i <= v.i + REACH);
    if (!ans) continue;
    if (v.id === owner[ans.role]) continue;             // can't be your own <role>
    raw.push({ role: ans.role, ownerId: owner[ans.role], name: v.id });
  }

  // Guard the SYN: sticky abstention (≥2 distinct names for a role → the null) and
  // the injected disjointness algebra (a name already merged into a disjoint role).
  const byRole = new Map();
  for (const p of raw) {
    if (!byRole.has(p.role)) byRole.set(p.role, new Map());
    byRole.get(p.role).set(p.name, p);
  }
  const merges = [];
  const nameRole = new Map();
  for (const [role, names] of byRole) {
    if (names.size > 1) continue;                       // INDETERMINATE → no SYN (sticky)
    const p = [...names.values()][0];
    const prior = nameRole.get(p.name);
    if (prior && rolesConflict(role, prior)) continue;  // disjoint double-role refused
    nameRole.set(p.name, role);
    merges.push(p);
  }
  return merges;
};
