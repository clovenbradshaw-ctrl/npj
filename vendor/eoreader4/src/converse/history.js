// The session-register fold — feeding the conversation back. (docs/session-fold.md)
//
// The prompt contract always had conversation slots; nothing populated them, so the
// talker answered every turn cold. This fills them. The document fold reads the page;
// the session fold reads the CONVERSATION, and hands the talker the same two registers
// it gets for the document — the recent turns VERBATIM, and a SURFED fold of older
// turns. Mirrors the document surfer: only the turns where the conversation MOVED are
// kept; a turn that merely confirmed or acknowledged is assimilated and folded away.
//
//   recentMessages   the recent verbatim window as {role,content} — for the chat path.
//   pastTurns        the same window, formatted "You: …" / "Me: …" — for the grounded path.
//   notes            a surfed recap of older movers, each tagged with its ABSOLUTE
//                    index (#7 You: …) so an exact earlier wording is recallable.
//   lastReply        the talker's most recent reply.
//   stats            { recent, folded, notesLen } for the audit.

const DEFAULTS = Object.freeze({
  budgetTokens: 600,   // the recent verbatim window's ceiling (the fold engages beyond it)
  minRecent:    4,     // a continuity floor — kept even when one huge turn overflows
  gamma:        0.7,   // vocabulary decay, matches the reading's γ
  maxNoteTurns: 6,     // cap on the recap so a long backlog can't blow the notes budget
  forget:       0.15,  // a token decayed below this is "new" again (content-add, not fraction)
});

export const foldConversation = (history = [], opts = {}) => {
  const cfg = { ...DEFAULTS, ...opts };
  const msgs = (Array.isArray(history) ? history : []).filter(m => m && m.content);
  const empty = { recentMessages: [], pastTurns: [], notes: '', lastReply: '', stats: { recent: 0, folded: 0, notesLen: 0 } };
  if (msgs.length === 0) return empty;

  const lastReply = [...msgs].reverse().find(m => m.role === 'assistant')?.content || '';

  // The recent verbatim window: walk newest → oldest, accumulating an estimated token
  // cost, until the budget is exceeded AND the minRecent floor is already met. The
  // floor guarantees continuity even when a single huge turn would overflow alone.
  let used = 0, recentStart = msgs.length;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const cost = estTokens(msgs[i].content);
    const alreadyKept = msgs.length - 1 - i;
    if (used + cost > cfg.budgetTokens && alreadyKept >= cfg.minRecent) break;
    used += cost;
    recentStart = i;
  }
  const recentMessages = msgs.slice(recentStart);
  const older          = msgs.slice(0, recentStart);   // the fold candidates
  const pastTurns      = recentMessages.map(m => `${label(m.role)} ${m.content}`);

  // The fold engages only beyond the token count — short sessions ride entirely
  // verbatim, no recap.
  if (older.length === 0) {
    return { recentMessages, pastTurns, notes: '', lastReply,
             stats: { recent: recentMessages.length, folded: 0, notesLen: 0 } };
  }

  // Per-turn surprise = content ADDED: the count of new non-stopword tokens against a
  // γ-decayed vocabulary. Content added, not novelty FRACTION — fraction is the
  // TV-snow trap at the token level (a one-word "ok" is 100% novel yet adds nothing).
  // Under MiniLM this same selection would run on meaning-distance, no shape change.
  const vocab = new Map();   // token → decayed weight
  const surprise = older.map((m) => {
    for (const [t, w] of vocab) vocab.set(t, w * cfg.gamma);
    const toks = contentTokens(m.content);
    let added = 0;
    for (const t of toks) if ((vocab.get(t) || 0) < cfg.forget) added++;
    for (const t of toks) vocab.set(t, 1);
    return added;
  });

  // Select the movers: a conversation's per-turn surprise is BIMODAL — inert turns
  // near zero, movers high — so the separating statistic is the MEAN, not the median
  // (the median lands on the movers in a bimodal split and drops them). Keep turns
  // strictly above the mean; cap at maxNoteTurns, strongest winning; a single-peak
  // fallback guards the all-flat case so the recap is never empty when there is
  // older history to recall.
  const mean = surprise.reduce((s, x) => s + x, 0) / surprise.length;
  let idxs = older.map((_, i) => i).filter(i => surprise[i] > mean);
  if (idxs.length === 0) {
    let peak = 0;
    for (let i = 1; i < surprise.length; i++) if (surprise[i] > surprise[peak]) peak = i;
    idxs = [peak];
  }
  idxs.sort((a, b) => surprise[b] - surprise[a]);      // strongest first
  idxs = idxs.slice(0, cfg.maxNoteTurns);
  idxs.sort((a, b) => a - b);                          // back into reading order

  const notes = idxs
    .map(i => `#${i} ${label(older[i].role)} ${condense(older[i].content)}`)
    .join('\n');

  return {
    recentMessages, pastTurns, notes, lastReply,
    stats: { recent: recentMessages.length, folded: idxs.length, notesLen: notes.length },
  };
};

const label = (role) => (role === 'assistant' ? 'Me:' : 'You:');

// A rough token estimate — chars/4, the usual heuristic. Exact accounting is the
// model's; this only has to decide where the verbatim window ends.
const estTokens = (s) => Math.ceil(String(s || '').length / 4);

const STOP = new Set((
  'a an the and or but if then so of to in on at for with as is are was were be been ' +
  'being do does did have has had i you he she it we they me him her them my your our ' +
  'this that these those what which who whom whose how why when where will would can ' +
  'could should may might must not no yes ok okay sure thanks thank please just about'
).split(' '));

const contentTokens = (s) => {
  const out = new Set();
  for (const t of String(s || '').toLowerCase().match(/[a-z0-9']+/g) || []) {
    if (t.length > 1 && !STOP.has(t)) out.add(t);
  }
  return out;
};

// Condense a folded turn to its first clause when long — a recap, not a replay.
const condense = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 140) return t;
  const cut = t.slice(0, 140);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf('; '));
  return (stop > 50 ? cut.slice(0, stop) : cut.replace(/\s+\S*$/, '')) + '…';
};
