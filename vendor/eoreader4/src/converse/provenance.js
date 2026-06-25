// Conversational provenance — the talker's output as a recorded phenomenon.
//
// The talker said this, at this cursor, in this turn. That happened, and it is
// recorded verbatim and append-only like any observation — but it is Given
// about the CONVERSATION, not about the document. The witness arrow points at
// the talker, not at the page. The same string witnessed by a document span is
// a grounded claim; witnessed by the talker's own prior turn it is a record
// that the talker once said it. Two events, two addresses. The second can never
// be promoted to the first.
//
// This makes concrete the phasepost spec's call to wire the model-facing doors
// as depositions and never as injections: the talker writes an event, and the
// field reads it. The model never reaches into the field and sets a number.

export const TALKER = 'talker';
export const SPAN   = 'span';

// The model reader's coupling cap (eoreader3 DEPICTS_EVAL_COUPLING = 0.6),
// reused as the conversational coupling ceiling. The talker is the weakest
// reader in the room: it deposits below the lexical reader and below the
// geometric reader, so it can never outweigh a grounding reader.
export const CONVERSATIONAL_CAP = 0.6;

// The conversational-provenance event. Witnessed by the talker. Foldable at the
// session register (it is part of what has been said, and it orients the next
// turn); uncitable at the document register (its witness is wrong for citation).
// It carries the referents it mentions so the field can read warmth off it — it
// never carries an operator: the talker's mention says "look here," it does not
// say "what is here." Typing the relation stays the geometric reader's job.
export const conversationalEvent = ({ text, cursor = null, turn = null, referents = [] }) =>
  Object.freeze({
    kind: 'conversational',
    witness: TALKER,
    text: String(text ?? ''),
    cursor,
    turn,
    referents: Object.freeze([...new Set(referents)]),
  });

// The witness-type firewall. The citation machinery cites only events whose
// witness is a span; a talker-witnessed event is therefore STRUCTURALLY
// uncitable as document provenance — there is no separate guard to remember and
// no flag to check. An event with no explicit witness is a document/parse
// observation whose provenance is the span it sits on, so it remains citable.
export const witnessOf = (event) => event?.witness ?? SPAN;
export const isCitableAsDocument = (event) => witnessOf(event) === SPAN;

// Deposit a conversational event into a two-channel field: each mentioned
// referent gets tagged, decaying, capped conversational mass. THIS is the door,
// redrawn — the deposition path, not a direct write. Only talker-witnessed
// events warm the conversational channel; anything else is ignored here.
export const depositConversational = (field, event) => {
  if (witnessOf(event) !== TALKER) return [];
  const cursor = event.cursor ?? 0;
  for (const id of event.referents) field.noteConversational(id, cursor);
  return event.referents;
};

// Subtract-and-check, at commit time. A reading near the floor must survive on
// grounded mass alone. If it only clears the floor with talker warmth, the
// conversation has talked itself into it — demote to held. The check is cheap
// because the field already separates the channels; run it on any reading near
// the floor. Returns true if the reading stands without the talker's warmth.
export const commitSurvives = (field, id, cursor, floor = 0) =>
  field.survivesSubtraction(id, cursor, floor);

// A coreference PROPOSAL — the talker's coref strength as a proposer, never a
// resolver. The talker is a strong coref reader: it binds "the trooper," "Sgt.
// Topps," and "he" across long spans better than the document SYN does. That
// capability is real and we want it — but letting the talker RESOLVE the
// endpoints of its own claim is the witness grading its own testimony, so the
// talker may only PROPOSE. The proposal enters talker-witnessed, which makes it
// structurally uncitable AND structurally non-deciding by the same firewall that
// keeps a talker turn out of citations: it carries `referents` so the field
// reads it through the ordinary depositConversational path (capped warmth), and
// a GROUNDING reader must second it on document-side evidence before any merge
// commits. Tip, never originate.
export const corefPerception = ({ a, b, cursor = null, turn = null }) =>
  Object.freeze({
    kind: 'coref-proposal',
    witness: TALKER,
    a: String(a),
    b: String(b),
    referents: Object.freeze([String(a), String(b)]),
    cursor,
    turn,
  });
