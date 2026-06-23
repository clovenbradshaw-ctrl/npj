// The conventions ledger — the CORE's learning layer (reshape §5).
//
// This is the home for the language-specific stuff, and it lives in the core, not
// in a sense organ, because the built-in reading knowledge is inherited sediment:
// the SAME substance, format, slot, and defeasible status as what the DEF·EVA·REC
// loop deposits while reading. The parser and the splitter hold NO word-lists of
// their own; they READ from here.
//
// Two origins, one status. An INHERITED prior (the seeds below) and a LEARNED
// convention (a sci-fi text whose dialogue runs on "pinged", a journal whose
// "Inst." is no sentence end) sit in the same store with the same authority. A
// prior is just a convention with strain-history pre-baked — a HEAD START in
// confidence, not an exemption from the loop. So every convention is defeasible:
//
//   DEF   hold a convention (this token marks speech; this term binds kin)
//   EVA   test it against what the stream gives → reinforce (support grows) on a
//         hold, accrue strain on a break
//   REC   revise: when strain overtakes support the convention is DEFEATED, and a
//         learned convention can beat an inherited one. `has()` then answers false.
//
// Nothing is hard-coded true; a prior is whatever the language started as, and a
// convention is whatever the text keeps doing — and either can lose. Three
// guarantees fall out (the falsifiability tests in tests/conventions-emergence):
// readable with priors OFF, a seed can LOSE, and a learned convention occupies
// the SAME slot a later document inherits exactly as it inherited the seeds.
//
// The registers, all the same shape:
//   attribution  verbs that mark speech → SIG          (said, asked, pinged)
//   abbreviation tokens whose '.' is not a boundary    (Mr, Mrs, Dr, St)        → splitter
//   copula       linking verbs → DEF, never a relation (is, am, was, been)      → verb guard
//   modifier     adverbs/intensifiers/auxiliaries to   (much, more, quite, had) → verb guard
//                step over before the head verb        the ReVerb skip-list, by hand
// A consumer asks `is<Register>`; the ledger answers from seed ∪ learned.

export const SEED_SPEECH = Object.freeze([
  'said', 'says', 'say', 'asked', 'asks', 'replied', 'replies', 'told', 'tells',
  'cried', 'cries', 'shouted', 'whispered', 'muttered', 'answered', 'answers',
  'called', 'calls', 'exclaimed', 'declared', 'added', 'continued', 'thought',
  'thinks', 'wondered', 'murmured', 'repeated', 'insisted', 'remarked',
  'observed', 'screamed', 'begged', 'urged', 'warned', 'promised', 'admitted',
  'confessed', 'announced', 'wrote', 'writes',
]);

// A period after one of these (or a single capital initial, handled at the
// splitter) abbreviates; it is not a sentence end.
export const SEED_ABBREVIATIONS = Object.freeze([
  'mr', 'mrs', 'ms', 'dr', 'st', 'mt', 'messrs', 'mme', 'mlle',
  'prof', 'rev', 'hon', 'capt', 'col', 'gen', 'sgt', 'lt', 'cmdr', 'sr', 'jr',
  'esq', 'co', 'inc', 'ltd', 'no', 'vol', 'pp', 'rd', 'ave', 'fig',
  'vs', 'etc', 'al', 'eg', 'ie', 'cf', 'viz',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

// Copulas link a subject to a predicate — a DEF on one referent, never a relation
// between two. Separated from the transitive case by construction (ClausIE's SVC),
// not swept into it. (eoreader4 had only is/are/was/were/be/been — "am" leaked
// through as a relation verb; here it is named.)
export const SEED_COPULA = Object.freeze([
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
]);

// The skip-list: adverbs, intensifiers, and auxiliaries that sit before the head
// verb. ReVerb's relation-phrase constraint, by hand — step over these to find the
// real predicate, and if what remains is a copula or not verb-headed, emit no edge.
// Includes the intensifiers eoreader4 was missing (much, more, rather, quite, …)
// that let "Much --more--> Caroline" through.
export const SEED_MODIFIER = Object.freeze([
  // adverbs of time/manner/degree
  'then', 'now', 'also', 'just', 'once', 'soon', 'suddenly', 'slowly', 'quietly',
  'gently', 'again', 'still', 'only', 'even', 'simply', 'quickly', 'immediately',
  'finally', 'however', 'never', 'always', 'often', 'already', 'almost', 'nearly',
  'merely', 'truly', 'indeed', 'perhaps', 'really', 'quite', 'rather', 'very',
  'much', 'more', 'most', 'less', 'so', 'too', 'such', 'thus', 'hence',
  // auxiliaries / modals
  'had', 'has', 'have', 'having', 'would', 'could', 'will', 'shall', 'should',
  'did', 'does', 'do', 'not', 'must', 'might', 'may', 'can',
]);

// The relation-type vocabulary (move 3): the open verb on a bond → a small CLOSED
// set of predicate types, the comparable grouping key the graph pivot reads next.
// `speech` is the attribution register (already → SIG), so it is not duplicated here;
// the rest are seeded and, like every register, learnable later. Typing is ADDITIVE:
// a verb outside the table is honestly untyped (relationType → null) and its bond
// still stands — never a drop, so recall is unchanged. The boilerplate the acceptance
// names (`day`, `he`, `probably`) never reaches here: it is stepped over as a modifier
// or fails the recurrence gate before it can be a relation.
export const SEED_RELATION_TYPES = Object.freeze({
  motion: ['crawled', 'crawl', 'crawls', 'crawling', 'ran', 'run', 'runs', 'running',
    'walked', 'walk', 'walks', 'walking', 'jumped', 'jump', 'climbed', 'climb', 'rushed',
    'rush', 'fled', 'flee', 'moved', 'move', 'moves', 'turned', 'turn', 'rose', 'rise',
    'fell', 'fall', 'came', 'come', 'comes', 'went', 'go', 'goes', 'entered', 'enter',
    'left', 'leave', 'leaves', 'approached', 'approach', 'crept', 'creep', 'slipped',
    'slip', 'flew', 'fly', 'dragged', 'drag', 'pushed', 'push', 'pulled', 'pull',
    'rolled', 'roll', 'marched', 'march', 'stepped', 'step', 'hurried', 'hurry',
    'wandered', 'wander', 'followed', 'follow', 'chased', 'chase', 'escaped', 'escape',
    'returned', 'return', 'arrived', 'arrive', 'departed', 'depart'],
  perception: ['saw', 'see', 'sees', 'seeing', 'looked', 'look', 'looks', 'looking',
    'watched', 'watch', 'watches', 'heard', 'hear', 'hears', 'noticed', 'notice',
    'observed', 'observe', 'stared', 'stare', 'glanced', 'glance', 'felt', 'feel',
    'feels', 'smelled', 'smell', 'gazed', 'gaze', 'beheld', 'behold', 'spotted', 'spot',
    'glimpsed', 'glimpse', 'sensed', 'sense'],
  possession: ['held', 'hold', 'holds', 'holding', 'carried', 'carry', 'carries',
    'owned', 'own', 'owns', 'kept', 'keep', 'keeps', 'grasped', 'grasp', 'grabbed',
    'grab', 'seized', 'seize', 'clutched', 'clutch', 'gripped', 'grip', 'took', 'take',
    'takes', 'brought', 'bring', 'wore', 'wear', 'wears', 'possessed', 'possess', 'bore',
    'bears', 'dropped', 'drop'],
  spatial: ['stood', 'stand', 'stands', 'standing', 'sat', 'sit', 'sits', 'sitting',
    'lay', 'lie', 'lies', 'lying', 'hung', 'hang', 'hangs', 'lived', 'live', 'lives',
    'remained', 'remain', 'rested', 'rest', 'perched', 'perch', 'leaned', 'lean',
    'leant', 'filled', 'fill', 'covered', 'cover'],
  affect: ['feared', 'fear', 'fears', 'loved', 'love', 'loves', 'hated', 'hate', 'hates',
    'liked', 'like', 'likes', 'wanted', 'want', 'wants', 'hoped', 'hope', 'hopes',
    'wished', 'wish', 'dreaded', 'dread', 'enjoyed', 'enjoy', 'missed', 'miss', 'trusted',
    'trust', 'admired', 'admire', 'envied', 'envy', 'pitied', 'pity', 'needed', 'need'],
  communication: ['wrote', 'write', 'writes', 'called', 'call', 'calls', 'signalled',
    'signaled', 'signal', 'greeted', 'greet', 'greets', 'nodded', 'nod', 'waved', 'wave',
    'beckoned', 'beckon', 'summoned', 'summon', 'knocked', 'knock'],
  // Kinship / social role bonds (via = the kin noun on a kinship CON or a derived
  // descriptor edge). The fine sibling/parent split stays the read-layer bridge's
  // job; here it is the coarse bucket the graph groups on.
  kinship: ['father', 'mother', 'sister', 'brother', 'son', 'daughter', 'wife',
    'husband', 'parents', 'parent', 'uncle', 'aunt', 'cousin', 'nephew', 'niece',
    'grandfather', 'grandmother', 'sibling', 'child', 'spouse', 'dad', 'mom', 'friend',
    'master', 'servant', 'boss', 'chief', 'partner', 'neighbour', 'neighbor',
    'colleague', 'lover', 'fiance', 'fiancee'],
});

// token → bucket, built once. The attribution register supplies `speech` at lookup
// time (so a document's LEARNED speech verbs type as speech too), so it is not folded
// in here; the first writer wins on any incidental overlap.
const RELATION_TYPE = new Map();
for (const [bucket, toks] of Object.entries(SEED_RELATION_TYPES))
  for (const t of toks) if (!RELATION_TYPE.has(t)) RELATION_TYPE.set(t, bucket);

// Prepositions — a name just after one is the object of the preposition, a
// participant in a proposition ("unto Noah", "to Abraham"). Read by entity
// admission to weigh a sighting's referential gravity. Seeded, learnable.
export const SEED_PREPOSITION = Object.freeze([
  'of', 'in', 'on', 'at', 'to', 'from', 'by', 'with', 'into', 'onto', 'upon', 'over',
  'under', 'through', 'after', 'before', 'between', 'among', 'against', 'about', 'as',
  'unto', 'toward', 'towards', 'for', 'near', 'beside', 'within', 'without', 'beyond',
  'beneath', 'above', 'below', 'behind', 'around', 'past',
]);

// Auxiliaries / copulas as a set — a name immediately before one is the SUBJECT of
// a predication ("Alice is a baker", "Sarah shall bear"). Copulas keep their own
// register (SEED_COPULA); these add the modal/have/do auxiliaries, incl. archaic.
export const SEED_AUXILIARY = Object.freeze([
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'shall', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can',
  'hath', 'hast', 'doth', 'dost', 'art', 'wast', 'wilt', 'shalt',
]);

// Role / kin / naming words that, sitting just before a name, make it an apposition
// bearer or possessed referent ("his son Seth", "named Eve", "Abram's wife Sarah").
export const SEED_ROLE = Object.freeze([
  'son', 'sons', 'daughter', 'daughters', 'father', 'mother', 'brother', 'brethren',
  'sister', 'sisters', 'wife', 'wives', 'husband', 'child', 'children', 'firstborn',
  'seed', 'name', 'named', 'called', 'uncle', 'aunt', 'cousin', 'nephew', 'niece',
  'his', 'her', 'their', 'my', 'thy', 'our', 'your', 'thine',
]);

// Closed-class words that are never a content head — so a name beside one is not
// thereby a verb's argument. The union of the function categories; a word may sit in
// several registers, which is fine — they answer different questions.
export const SEED_FUNCTION = Object.freeze([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'he', 'she', 'it', 'they', 'we', 'i', 'you', 'him', 'them', 'us', 'me', 'thee',
  'thou', 'ye', 'who', 'whom', 'whose', 'which', 'what', 'his', 'her', 'its', 'their',
  'our', 'my', 'your', 'thy', 'thine', 'mine', 'hers', 'ours', 'yours',
  'there', 'then', 'now', 'here', 'very', 'not', 'also', 'thus', 'lo', 'behold',
  'yea', 'nay', 'verily', 'when', 'where', 'why', 'how', 'if', 'because', 'while',
  'though', 'although', 'until', 'unless', 'whether', 'else', 'ever', 'never',
  ...SEED_PREPOSITION, ...SEED_AUXILIARY,
]);

// Sentence-opening words that begin a clause but name no one — stripped from a
// candidate phrase before admission so "Then Alice" admits "Alice". Early-modern
// openers (Behold, Lo, Verily, Hast, Thou) belong here too: they are the KJV
// equivalents of "Then"/"He"/"Can", and without them clause-openers masquerade as
// characters. Seeded; a corpus can teach its own.
export const SEED_STARTER = Object.freeze([
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'then', 'now', 'here', 'there', 'when', 'where', 'why', 'how', 'what', 'who', 'whom', 'which',
  'yes', 'no', 'maybe', 'perhaps', 'otherwise', 'also', 'however', 'indeed', 'still', 'yet',
  'but', 'and', 'so', 'or', 'nor', 'for', 'because', 'although', 'while', 'since', 'as',
  'in', 'on', 'at', 'to', 'from', 'by', 'with', 'of', 'up', 'down', 'over', 'under', 'into', 'out',
  'if', 'unless', 'until', 'once', 'just', 'only', 'even', 'soon', 'again', 'almost', 'nearly',
  'suddenly', 'finally', 'meanwhile', 'nevertheless', 'therefore', 'thus', 'hence', 'anyway',
  'well', 'oh', 'ah', 'eh', 'alas', 'look', 'listen',
  'can', 'could', 'would', 'should', 'shall', 'will', 'may', 'might', 'must', 'let',
  'do', 'does', 'did', 'have', 'has', 'had', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'not', 'never', 'always', 'often', 'sometimes',
  'thou', 'thee', 'thy', 'thine', 'ye', 'behold', 'lo', 'verily', 'yea', 'nay',
  'hast', 'hath', 'doth', 'dost', 'art', 'wast', 'wilt', 'shalt', 'unto',
  // Indefinite determiners / quantifiers — they open a clause but name no one, so a
  // capitalised one at sentence start ("Other travelling salesmen…", "Most of them…",
  // "One morning…") is a stray capital, not a character. Without these the gravity
  // floor admits them on their sentence-initial subject position.
  'one', 'another', 'other', 'some', 'any', 'each', 'every', 'all', 'both',
  'many', 'much', 'more', 'most', 'few', 'fewer', 'several', 'such', 'either', 'neither', 'none',
  // Indefinite pronouns — likewise referential of no one in particular.
  'something', 'nothing', 'anything', 'everything',
  'someone', 'anyone', 'everyone', 'somebody', 'anybody', 'everybody', 'nobody',
  'whatever', 'whoever', 'whenever', 'wherever', 'whichever',
  // Discourse openers, politeness, hedging adverbs.
  'please', 'thanks', 'okay', 'hardly', 'scarcely', 'barely',
  'certainly', 'surely', 'clearly', 'apparently', 'obviously', 'probably', 'possibly',
  'eventually', 'gradually', 'usually', 'normally', 'generally',
  // Cardinals that commonly open a clause ("Two whole days…", "Seven o'clock…").
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'during',
]);

// Front-matter field labels — the token (or short phrase) that, leading a set-off
// line before a colon, introduces a metadata field: "Title:", "Author:", "Release
// date:". This is a STRUCTURAL convention, the same register shape as every other —
// the document's bibliographic header read off its SHAPE, not its words. The colon
// is the mark (as the frame's banner is a mark), the label is the key, the rest of
// the line is the value. Seeded with the labels a human-language document
// conventionally opens with — a book's front matter, an email/memo header, a
// citation block — and LEARNABLE: a text whose header runs on "Composer:" or "DOI:"
// teaches that label exactly as a sci-fi text teaches "pinged" as a speech verb.
// Only the LABELS are conventions and live here; the harvested VALUES are the
// document's own facts (→ doc.metadata, logged as DEF), not a reusable register.
// Stored normalized (lowercase) — the seeding loop sets keys verbatim and `has`
// reads them through `norm`, so seeds must already be normalized, like the others.
// Coordinating conjunctions — the words that JOIN two like constituents into one
// (two subjects onto a shared predicate: "Delgado and Reyes listed…"). A STRICT
// subset of the function words: only the coordinators that yield a plural subject
// ('and' / 'or' / 'nor'), never the adversative/illative connectives ('but' / 'so' /
// 'yet') the broader `function` class also holds — "Delgado but Reyes" is not one
// subject. The comma and the "&" logogram are orthography, read structurally by the
// parser, not seeded here. Seeded for English; a corpus teaches its own exactly as it
// does the speech and copula registers.
export const SEED_CONJUNCTION = Object.freeze([
  'and', 'or', 'nor',
]);

export const SEED_FIELD_LABEL = Object.freeze([
  // bibliographic front matter
  'title', 'subtitle', 'author', 'authors', 'editor', 'translator', 'illustrator',
  'contributor', 'credits', 'produced by', 'publisher', 'publication', 'imprint',
  'edition', 'volume', 'series', 'date', 'release date', 'publication date',
  'published', 'updated', 'last updated', 'most recently updated', 'revised',
  'language', 'source', 'origin', 'subject', 'subjects', 'keywords', 'genre',
  'rights', 'copyright', 'license', 'licence', 'isbn', 'issn', 'doi', 'url',
  // correspondence / memo header
  'from', 'to', 'cc', 'bcc', 're', 'sender', 'recipient',
  // creative-work credits
  'composer', 'director', 'artist', 'performer', 'writer', 'creator',
]);

const SEEDS = {
  'attribution-verb': SEED_SPEECH,
  'abbreviation': SEED_ABBREVIATIONS,
  'copula': SEED_COPULA,
  'modifier': SEED_MODIFIER,
  'preposition': SEED_PREPOSITION,
  'auxiliary': SEED_AUXILIARY,
  'role': SEED_ROLE,
  'function': SEED_FUNCTION,
  'starter': SEED_STARTER,
  'conjunction': SEED_CONJUNCTION,
  'field-label': SEED_FIELD_LABEL,
};

// The pre-baked strain-history a prior carries: a seed is not an axiom, it is a
// convention that has already held a few times. So it takes more breaks to defeat
// a prior than a brand-new learned convention (which starts with support 1) — the
// head start in confidence, made of the same stuff as a reinforcement.
const PRIOR_SUPPORT = 3;

// One ledger, two origins, one status. `createConventions()` seeds the priors;
//   { seeds: false }    constructs with priors OFF (the substrate for TEST 1 —
//                       can the core still read from units alone?)
//   { inherit: [...] }  loads conventions exported by an earlier read as priors —
//                       a learned convention inherited exactly as a seed is (TEST 3)
export const createConventions = ({ seeds = true, inherit = null } = {}) => {
  const rules = [];                 // learned/revised entries, append-only (→ the doc log)
  const reg = {};                   // kind → Map(token → entry)
  // entry = { origin: 'prior'|'learned', weight, support, strain, defeated }
  //   weight   the attribution/learn weight (0 for an unlearned prior), as before
  //   support  strain-history: holds. priors pre-baked to PRIOR_SUPPORT
  //   strain   accrued breaks; when strain > support the convention is defeated
  const ensure = (kind) => (reg[kind] || (reg[kind] = new Map()));
  const norm = (v) => String(v || '').toLowerCase().replace(/\.$/, '');

  // Seed the inherited priors. A prior is a convention with strain-history baked
  // in, so it enters with weight 0 (unlearned), pre-baked support, no strain.
  if (seeds) {
    for (const [kind, seed] of Object.entries(SEEDS)) {
      const m = ensure(kind);
      for (const t of seed)
        m.set(t, { origin: 'prior', weight: 0, support: PRIOR_SUPPORT, strain: 0, defeated: false });
    }
  }
  // Inherited sediment from an earlier read arrives in the SAME slot as a seed —
  // a prior to this document, whatever its origin in the last one (TEST 3).
  if (Array.isArray(inherit)) {
    for (const e of inherit) {
      if (e.defeated) continue;       // a defeated convention is not inherited
      const t = norm(e.token);
      ensure(e.kind).set(t, {
        origin: 'prior',
        weight: e.weight || 0,
        support: e.support || PRIOR_SUPPORT,
        strain: 0,
        defeated: false,
      });
    }
  }

  const entryOf = (kind, v) => (reg[kind] ? reg[kind].get(norm(v)) : undefined);
  const has = (kind, v) => { const e = entryOf(kind, v); return !!e && !e.defeated; };

  // DEF — hold a convention. A freshly held convention is learned sediment; an
  // already-held one (a prior) is reinforced. Recorded as a REC line on the log,
  // exactly as before, so the rules ledger and exportJSONL are byte-identical.
  const learn = (kind, token, weight = 1) => {
    const t = norm(token);
    const m = ensure(kind);
    const e = m.get(t);
    if (e) { e.weight += weight; e.support += weight; e.origin = 'learned'; e.defeated = false; }
    else m.set(t, { origin: 'learned', weight, support: weight, strain: 0, defeated: false });
    rules.push({ op: 'REC', kind, token: t, weight, t: Date.now() });
  };

  // EVA — test a convention against what the stream gives. A hold reinforces
  // (support grows, strain relaxes); a break accrues strain. REC fires
  // automatically when strain overtakes support: the convention is DEFEATED.
  const eva = (kind, token, holds = true) => {
    const t = norm(token);
    const m = ensure(kind);
    let e = m.get(t);
    if (!e) { e = { origin: 'learned', weight: 0, support: 0, strain: 0, defeated: false }; m.set(t, e); }
    if (holds) { e.support += 1; if (e.strain > 0) e.strain -= 1; }
    else { e.strain += 1; }
    if (e.strain > e.support && !e.defeated) {
      e.defeated = true;
      rules.push({ op: 'REC', kind, token: t, defeat: true, t: Date.now() });
    }
    return { defeated: e.defeated, support: e.support, strain: e.strain };
  };

  // REC — revise directly. `defeat` overrides a convention (a discovery beating an
  // inherited prior); `reinstate` clears the defeat; otherwise it reinforces.
  const rec = (kind, token, { defeat = false, reinstate = false } = {}) => {
    const t = norm(token);
    const m = ensure(kind);
    let e = m.get(t);
    if (!e) { e = { origin: 'learned', weight: 0, support: 0, strain: 0, defeated: false }; m.set(t, e); }
    if (defeat) { e.defeated = true; }
    else if (reinstate) { e.defeated = false; e.strain = 0; }
    else { e.support += 1; }
    rules.push({ op: 'REC', kind, token: t, ...(defeat ? { defeat: true } : {}), t: Date.now() });
    return { defeated: e.defeated, support: e.support, strain: e.strain };
  };

  return {
    learn,
    def: learn,                     // DEF — hold (alias; a held convention is learned sediment)
    eva,                            // EVA — test against the stream
    rec,                            // REC — revise / override
    defeat: (kind, token) => rec(kind, token, { defeat: true }),
    reinstate: (kind, token) => rec(kind, token, { reinstate: true }),
    learnAttribution: (token, weight = 1) => learn('attribution-verb', token, weight),
    learnAbbreviation: (token, weight = 1) => learn('abbreviation', token, weight),
    isAttributionVerb: (v) => has('attribution-verb', v),
    isAbbreviation: (v) => has('abbreviation', v),
    isCopula: (v) => has('copula', v),
    isModifier: (v) => has('modifier', v),
    // Registers entity admission reads to weigh a sighting's referential gravity.
    isPreposition: (v) => has('preposition', v),
    isAuxiliary: (v) => has('auxiliary', v) || has('copula', v),
    isRole: (v) => has('role', v),
    isFunction: (v) => has('function', v),
    isStarter: (v) => has('starter', v),
    // A coordinating conjunction joining two like constituents ('and'/'or'/'nor') —
    // read by the relation parser to admit a coordinated subject ("Name and Name …"),
    // seed ∪ learned. NOT the adversative/illative connectives the function class holds.
    isConjunction: (v) => has('conjunction', v),
    // A front-matter field label ("Title", "Author", "Release date") — read by the
    // metadata pass to confirm a labeled line is a bibliographic field, seed ∪ learned.
    isFieldLabel: (v) => has('field-label', v),
    learnFieldLabel: (token, weight = 1) => learn('field-label', token, weight),
    // Convention status — the strain-history a consumer or a test can read.
    isDefeated: (kind, v) => { const e = entryOf(kind, v); return !!e && e.defeated; },
    originOf: (kind, v) => entryOf(kind, v)?.origin ?? null,
    strainOf: (kind, v) => entryOf(kind, v)?.strain ?? 0,
    supportOf: (kind, v) => entryOf(kind, v)?.support ?? 0,
    // Type a relation predicate to its closed-vocab bucket (move 3), or null when it
    // is outside the table — additive, never a drop. Speech is read live from the
    // attribution register so a learned speech verb types as `speech` too.
    relationType: (v) => {
      const t = norm(v);
      if (!t) return null;
      if (has('attribution-verb', t)) return 'speech';
      return RELATION_TYPE.get(t) || null;
    },
    weightOf: (v) => entryOf('attribution-verb', v)?.weight || 0,
    get rules() { return rules; },
    // Back-compat Map views (token → weight). Derived; not load-bearing.
    get attribution() { return new Map([...(reg['attribution-verb'] || [])].map(([t, e]) => [t, e.weight])); },
    get abbreviation() { return new Map([...(reg['abbreviation'] || [])].map(([t, e]) => [t, e.weight])); },
    // The full language spec — conventions.jsonl. A line per convention, DEF for the
    // prior it started from, REC for what the document taught; a defeated one carries
    // the flag. The parser and splitter only read it.
    exportJSONL() {
      const out = [];
      for (const [kind, m] of Object.entries(reg))
        for (const [token, e] of m)
          out.push(JSON.stringify({
            op: e.origin === 'learned' ? 'REC' : 'DEF', kind, token, weight: e.weight,
            ...(e.defeated ? { defeated: true } : {}),
          }));
      return out.join('\n');
    },
    // Structured export for inheritance: the sediment a later read picks up as its
    // priors, the same slot it picks up the seeds (TEST 3 / reshape §5).
    exportLedger() {
      const out = [];
      for (const [kind, m] of Object.entries(reg))
        for (const [token, e] of m)
          out.push({ kind, token, origin: e.origin, weight: e.weight, support: e.support,
                     strain: e.strain, defeated: e.defeated });
      return out;
    },
  };
};
