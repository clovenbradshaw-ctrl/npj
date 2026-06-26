/* ============================================================
   composition.js — how a draft was ASSEMBLED, not what it says.

   The newsroom can't tell whether a paragraph was hand-typed, lifted from an
   author's own notes, or dropped in whole from some other tool (an AI assistant
   included). We don't try to — and we never keep the words. What we CAN do,
   honestly and locally, is record the SHAPE of the writing session: how much
   text arrived by typing vs. by paste, how big the biggest paste was, how much
   was deleted along the way, and over how long. That metadata rides the draft
   and ships with the article so a reader has context for how the piece came
   together — a signal, never a verdict.

   PRIVACY INVARIANT: only counts, sizes (character lengths) and timestamps are
   ever stored. The raw pasted text, the deleted text, and the prose itself
   never enter this ledger. There is nothing here to reconstruct the words from.

   Plain script — publishes window.NpjComposition. No dependencies.
   ============================================================ */
(function (root) {
  'use strict';

  var SAVE_VERSION = 1;
  var IDLE_GAP_MS = 120000;   // a gap longer than 2 min isn't "active writing" time
  var LARGE_PASTE = 280;      // chars — a paste this big is a passage, not a word or URL
  var MAX_PASTE_LOG = 200;    // cap the per-paste size log (sizes only; no text)

  function now() { return Date.now(); }
  function dayKey(ms) { try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return ''; } }

  function blank() {
    return {
      v: SAVE_VERSION,
      started: 0, updated: 0,   // ms epoch of first / last recorded activity
      typed: 0,                 // characters inserted by typing
      pasted: 0,                // characters inserted by paste / drop
      deleted: 0,               // characters removed (any delete, incl. cut / select-all)
      typedEvents: 0,           // input events that added typed text
      pasteCount: 0,            // number of paste / drop events
      maxPaste: 0,              // largest single paste (chars)
      largePasteCount: 0,       // pastes at or above LARGE_PASTE
      groundedPasted: 0,        // chars that re-landed as our OWN already-cited text
      activeMs: 0,              // summed gaps under IDLE_GAP_MS — rough hands-on time
      days: {},                 // { 'YYYY-MM-DD': eventCount } — distinct sitting days
      pastes: []                // [{ n, at, kind }] — sizes + timestamps, NEVER text
    };
  }

  var trackers = {};            // id -> tracker
  var muted = {};               // id -> true while a programmatic (paste) insert runs
  var prevLen = {};             // id -> editor textContent length at last input
  var lastAt = {};              // id -> ms of last activity (for active-time accrual)

  function get(id) {
    id = id || '_';
    if (!trackers[id]) trackers[id] = blank();
    return trackers[id];
  }

  // advance timeline bookkeeping shared by every kind of activity
  function tick(id, t, at) {
    if (!t.started) t.started = at;
    t.updated = at;
    var dk = dayKey(at); if (dk) t.days[dk] = (t.days[dk] || 0) + 1;
    var prev = lastAt[id];
    if (prev && at > prev && at - prev < IDLE_GAP_MS) t.activeMs += at - prev;
    lastAt[id] = at;
  }

  /* ---- lifecycle ---- */

  // Baseline the tracker to the editor's CURRENT length so neither the seed
  // document nor a restored draft body is mistaken for fresh typing. Call once
  // after mount / hydrate, with the editor's textContent length.
  function attach(id, len) {
    get(id);
    prevLen[id] = typeof len === 'number' ? len : 0;
    lastAt[id] = lastAt[id] || 0;
  }

  function hydrate(id, obj) {
    var t = blank();
    if (obj && typeof obj === 'object') {
      ['started', 'updated', 'typed', 'pasted', 'deleted', 'typedEvents', 'pasteCount',
        'maxPaste', 'largePasteCount', 'groundedPasted', 'activeMs'].forEach(function (k) {
        if (typeof obj[k] === 'number') t[k] = obj[k];
      });
      if (obj.days && typeof obj.days === 'object') t.days = Object.assign({}, obj.days);
      if (Array.isArray(obj.pastes)) t.pastes = obj.pastes.slice(-MAX_PASTE_LOG).map(function (p) {
        return { n: +p.n || 0, at: +p.at || 0, kind: p.kind || 'paste' };
      });
    }
    trackers[id || '_'] = t;
    return t;
  }

  /* ---- suppress double-counting while WE insert pasted text ----
     onPaste prevents the default, then inserts the text itself (execCommand /
     NpjPlainText). That synthetic insertion fires an input event we must NOT
     read as typing — the paste is already booked. Bracket the insertion in
     mute()/unmute(); the input handler advances time but counts nothing. */
  function mute(id) { muted[id || '_'] = true; }
  function unmute(id) { muted[id || '_'] = false; }

  /* ---- the two real signals ---- */

  // A paste or drop landed `n` characters. opts.grounded marks our own
  // already-cited text re-landing (a benign internal move); opts.kind labels it.
  function recordPaste(id, n, opts) {
    n = +n || 0; if (n <= 0) return;
    var t = get(id), at = now(); opts = opts || {};
    tick(id, t, at);
    t.pasted += n;
    t.pasteCount += 1;
    if (n > t.maxPaste) t.maxPaste = n;
    if (n >= LARGE_PASTE) t.largePasteCount += 1;
    if (opts.grounded) t.groundedPasted += n;
    t.pastes.push({ n: n, at: at, kind: opts.kind || (opts.grounded ? 'grounded' : 'paste') });
    if (t.pastes.length > MAX_PASTE_LOG) t.pastes.splice(0, t.pastes.length - MAX_PASTE_LOG);
  }

  // Fired for every editor input event. `len` is the editor's current
  // textContent length; the signed delta against the previous length tells us
  // how much was added (typing) or removed (deletion) — browser-agnostic, and
  // it catches a select-all wipe or a big cut that an inputType alone wouldn't.
  function onInput(id, len, inputType) {
    var t = get(id), at = now();
    len = +len || 0;
    if (typeof prevLen[id] !== 'number') prevLen[id] = len; // first event baselines
    var delta = len - prevLen[id];
    prevLen[id] = len;
    if (muted[id]) { tick(id, t, at); return; }   // our own paste insertion — already booked
    tick(id, t, at);
    if (delta < 0) { t.deleted += -delta; return; }
    if (delta === 0) return;                       // formatting / structural — no characters
    // A native paste/drop that somehow escaped onPaste still shows as an insert —
    // book it as pasted, not typed, so the signal stays honest.
    var it = inputType || '';
    if (it.indexOf('insertFrom') === 0) { recordPasteFromInput(id, t, at, delta); return; }
    t.typed += delta; t.typedEvents += 1;
  }
  function recordPasteFromInput(id, t, at, n) {
    t.pasted += n; t.pasteCount += 1;
    if (n > t.maxPaste) t.maxPaste = n;
    if (n >= LARGE_PASTE) t.largePasteCount += 1;
    t.pastes.push({ n: n, at: at, kind: 'paste' });
    if (t.pastes.length > MAX_PASTE_LOG) t.pastes.splice(0, t.pastes.length - MAX_PASTE_LOG);
  }

  /* ---- serialization ---- */

  // Full copy for the DRAFT (keeps the per-paste size log so it can keep
  // accumulating across reloads).
  function serialize(id) {
    var t = get(id);
    return {
      v: SAVE_VERSION,
      started: t.started, updated: t.updated,
      typed: t.typed, pasted: t.pasted, deleted: t.deleted,
      typedEvents: t.typedEvents, pasteCount: t.pasteCount,
      maxPaste: t.maxPaste, largePasteCount: t.largePasteCount,
      groundedPasted: t.groundedPasted, activeMs: t.activeMs,
      days: Object.assign({}, t.days),
      pastes: t.pastes.slice(-MAX_PASTE_LOG)
    };
  }

  // Lean copy for the PUBLISHED record — aggregates only, no per-paste log.
  // Everything the summary needs, nothing more, so the committed event stays
  // small and carries no incidental detail.
  function publishable(idOrObj) {
    var s = (idOrObj && typeof idOrObj === 'object') ? idOrObj : serialize(idOrObj);
    return {
      v: SAVE_VERSION,
      started: s.started || 0, updated: s.updated || 0,
      typed: s.typed || 0, pasted: s.pasted || 0, deleted: s.deleted || 0,
      pasteCount: s.pasteCount || 0, maxPaste: s.maxPaste || 0,
      largePasteCount: s.largePasteCount || 0, groundedPasted: s.groundedPasted || 0,
      activeMs: s.activeMs || 0, dayCount: Object.keys(s.days || {}).length
    };
  }

  /* ---- the reader-facing summary ----
     Works on either a full serialize() or a publishable() object. Returns plain
     numbers + a neutral label/tone; the UI does the wording. Honest by design:
     pasting is context, not proof, so the harshest label still hedges. */
  function summary(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var typed = +obj.typed || 0, pasted = +obj.pasted || 0, deleted = +obj.deleted || 0;
    var inserted = typed + pasted;
    if (inserted < 40) return null; // too little writing to characterize fairly
    var pastedPct = inserted ? pasted / inserted : 0;
    var typedPct = 1 - pastedPct;
    var maxPaste = +obj.maxPaste || 0;
    var largePasteCount = +obj.largePasteCount || 0;
    var revisedPct = inserted ? deleted / inserted : 0;
    var dayCount = (typeof obj.dayCount === 'number') ? obj.dayCount : Object.keys(obj.days || {}).length;
    var activeMin = Math.round((+obj.activeMs || 0) / 60000);

    // a single paste that is large AND a real share of the piece is the case
    // the author asked us to surface — "a big block arrived whole"
    var dominantPaste = maxPaste >= LARGE_PASTE && inserted > 0 && (maxPaste / inserted) >= 0.25;

    var label, tone;
    if (pastedPct < 0.12) { label = 'Typed by hand'; tone = 'calm'; }
    else if (pastedPct < 0.4) { label = 'Mostly typed'; tone = 'calm'; }
    else if (pastedPct < 0.7) { label = 'Typed and pasted'; tone = 'note'; }
    else { label = 'Largely pasted in'; tone = 'warn'; }

    return {
      typed: typed, pasted: pasted, deleted: deleted, inserted: inserted,
      typedPct: typedPct, pastedPct: pastedPct, revisedPct: revisedPct,
      maxPaste: maxPaste, largePasteCount: largePasteCount, dominantPaste: dominantPaste,
      pasteCount: +obj.pasteCount || 0, groundedPasted: +obj.groundedPasted || 0,
      dayCount: dayCount, activeMin: activeMin,
      started: +obj.started || 0, updated: +obj.updated || 0,
      heavilyRevised: revisedPct >= 0.4 && deleted >= 400,
      label: label, tone: tone
    };
  }

  // discard a tracker (e.g. when a draft is deleted)
  function reset(id) { delete trackers[id || '_']; delete muted[id || '_']; delete prevLen[id || '_']; delete lastAt[id || '_']; }

  root.NpjComposition = {
    attach: attach, hydrate: hydrate, mute: mute, unmute: unmute,
    recordPaste: recordPaste, onInput: onInput,
    serialize: serialize, publishable: publishable, summary: summary, reset: reset,
    LARGE_PASTE: LARGE_PASTE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjComposition;
})(typeof window !== 'undefined' ? window : this);
