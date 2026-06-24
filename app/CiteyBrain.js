/* ============================================================
   CiteyBrain.js — the headless brain. THE ONLY LAYER THAT DECIDES.

   In npj the "brain" is not a language model and not a separate parse — it is
   the editor's OWN mechanical grounding state, already computed and already
   deterministic. A claim is a `.claim-src` span the author bound to a source;
   it is grounded only when the author has PINNED the exact supporting words
   (`data-quote`) — until then it carries `needs-quote` and the publish build
   refuses it (see Newsroom.jsx). Citey reads that state; he never invents it.

   This honours the eoreader3 contract wholesale: "the intelligence is
   mechanical; the language model only phrases things." Here the mechanism is
   the DOM grounding model, read live — no model, no network, no autonomy.

   A claim is grounded one of two honest ways:
     • SOURCED  — a pinned line in a source backs it word-for-word  → ⊤ / ⊨
     • OWNED    — the author declares it as theirs (analysis/witness/voice) → ⊢ / ⊨ / ⊩
   The only thing Citey won't rest beside is an UNDECLARED bound claim (⊥),
   and on publish those ship FLAGGED (⚑) — the same gate the editor runs.

   Loads as a plain script. Publishes window.CiteyBrain.
   ============================================================ */
(function (root) {
  'use strict';

  // The drafting surface npj's editor already targets. State lives here, live.
  var EDITOR_SELECTOR = '.md-preview';
  function editorRoot() {
    return (root.document && root.document.querySelector(EDITOR_SELECTOR)) || null;
  }
  function setEditorSelector(sel) { if (sel) EDITOR_SELECTOR = sel; }

  // npj keeps source records on window.NPJ.SOURCES. A PRIMARY snapshot (an
  // archive.org capture) entails the claim more strongly than a bare line —
  // ⊨ vs ⊤. Mirrors the Newsroom flight-check's `archive_url` test.
  function sourceRec(key) {
    try { return (root.NPJ && root.NPJ.SOURCES && root.NPJ.SOURCES[key]) || null; } catch (e) { return null; }
  }
  function isPrimary(key) {
    var r = sourceRec(key);
    return !!(r && r.archive_url);
  }

  // Resolve a cue target to the live `.claim-src` element it concerns.
  function claimEl(span) {
    if (!span) return null;
    var el = span.nodeType === 1 ? span : (span.el || null);
    if (!el) return null;
    if (el.classList && el.classList.contains('claim-src')) return el;
    return (el.closest && el.closest('.claim-src')) || el;
  }

  // npj's grounding is read live from the DOM; there is nothing to parse. ingest
  // is kept for API parity (and to let the host point Citey at a surface) so the
  // scaffold's call sites keep working.
  var _live = true;
  function ingest(_draftTextOrSelector) {
    if (typeof _draftTextOrSelector === 'string' && _draftTextOrSelector.charAt(0) === '.') setEditorSelector(_draftTextOrSelector);
    _live = true;
    return editorRoot();
  }
  function ready() { return _live; }

  // Tier → kept as part of the leash contract. npj's grounding is exact (a quote
  // is pinned or it isn't), so depth changes phrasing/scan breadth, never the
  // verdict. Smarter additionally surfaces cross-claim duplicate sources (¬).
  function depthFor(tier) { return tier === 'smarter' ? 3 : 1; }

  // The author's owned-stance attribute → Citey state. An owned claim is grounded
  // by honest declaration, not a citation. `context` is a fourth declaration:
  // continuing coverage — the article substantiates the claim, set against prior
  // reporting (the past articles ride along as context links, not as proof).
  var STANCE_STATE = { analysis: 'asserted', testimony: 'testimony', voice: 'voice', context: 'context', absence: 'absence' };

  // THE CORE CALL — given a claim span, return Citey's mechanical state, read
  // straight from the editor's grounding attributes. No model. No guess.
  //   { state, receipt?, primary?, quote?, srcKey?, passages, tier }
  function citeyStateForSpan(span, opts) {
    var tier = (opts && opts.tier) || 'smart';
    var el = claimEl(span);

    // Owned (⊢ / ⊨ / ⊩) — the author stood behind it; honest, not a citation.
    var stance = el && el.getAttribute && el.getAttribute('data-stance');
    if (stance && STANCE_STATE[stance]) {
      return { state: STANCE_STATE[stance], owned: stance, passages: [], tier: tier };
    }

    var quote = (el && el.getAttribute && (el.getAttribute('data-quote') || '')).trim ? (el.getAttribute('data-quote') || '').trim() : '';
    var srcKey = el && el.getAttribute && el.getAttribute('data-src');

    // A bound span with a pinned line → the flip. ⊨ if the source is a primary
    // archived snapshot, else ⊤.
    if (quote) {
      var primary = isPrimary(srcKey);
      // Smarter: a duplicate-source clash check across the draft (cheap, mechanical).
      if (tier === 'smarter' && srcKey && contradictsAcrossDraft(el, srcKey)) {
        return { state: 'negation', receipt: 'another span cites the same source for the opposite reading', srcKey: srcKey, passages: passagesFor(quote), tier: tier };
      }
      return { state: primary ? 'entails' : 'verum', primary: primary, quote: quote, srcKey: srcKey, passages: passagesFor(quote), tier: tier };
    }

    // Bound but unpinned, or not yet a claim → ⊥ with the editor's own receipt.
    var receipt = srcKey
      ? 'bound to a source but no line pinned yet — cites a whole page'
      : 'no source holds this up yet';
    return { state: 'falsum', receipt: receipt, srcKey: srcKey || null, passages: [], tier: tier };
  }

  // Smarter-only: two bound spans pinning the SAME source but flagged by the
  // author as opposing would be a contradiction. npj has no per-span polarity
  // yet, so this stays a no-op hook (false) — wired here so the tier is honest
  // and the place to grow the ¬ check is obvious. Read-only over the DOM.
  function contradictsAcrossDraft(_el, _srcKey) { return false; }

  // The pinned line is the ONLY passage the voice layer may ever phrase from.
  function passagesFor(quote) { return quote ? [{ text: quote }] : []; }

  // Assemble the small packet handed to the (leashed, templated) voice. This is
  // the entire world the phrasing layer sees — the verdict + the pinned line.
  function packetFor(span, verdict) {
    return {
      question: questionFor(verdict.state),
      verdict: { status: verdict.state, receipt: verdict.receipt || null },
      passages: (verdict.passages || []).map(function (p, i) { return { tag: 's' + (i + 1), text: p.text || p }; }),
      tier: verdict.tier || 'smart'
    };
  }

  function questionFor(state) {
    switch (state) {
      case 'falsum':    return 'Why isn’t this grounded?';
      case 'negation':  return 'Why do these sources disagree?';
      case 'nequiv':    return 'Why don’t these definitions match?';
      case 'asserted':  return 'What does the author rest this on?';
      case 'testimony': return 'Who witnessed this?';
      case 'voice':     return 'Whose position is this?';
      case 'context':   return 'What prior coverage does this continue?';
      case 'verum':
      case 'entails':   return 'What grounds this?';
      default:          return 'What is the status of this claim?';
    }
  }

  // ---- the grounding contract (CITEY_INTEGRATION.md §3b) ----------------------

  // A citation is a PINNED SPAN, not a URL. After the author pins the supporting
  // line (Newsroom savePin writes data-quote + drops needs-quote), re-read the
  // element and return the flipped verdict — ⊥ → ⊤ / ⊨. Background line / no
  // pin → null so the caller can nudge.
  function resolvePin(span) {
    var v = citeyStateForSpan(span, { tier: 'smart' });
    if (v.state === 'verum' || v.state === 'entails' || v.state === 'negation') return v;
    return null;
  }

  // Not everything wants a citation — own it instead. Records the stance on the
  // span (carried into the draft HTML) and clears the needs-quote flag, so the
  // publish gate treats the claim as grounded by honest declaration.
  //   'analysis'  → ⊢   'testimony' → ⊨   'voice' → ⊩   'context' → ⊪
  //   'analysis'  → ⊢   'testimony' → ⊨   'voice' → ⊩   'context' → ⊪   'absence' → ∅
  // An asserted absence also carries a `note`: the documented search it rests on.
  function assert(span, stance, note) {
    var el = claimEl(span);
    var state = STANCE_STATE[stance] || 'asserted';
    var norm = STANCE_STATE[stance] ? stance : 'analysis';
    if (el && el.setAttribute) {
      el.setAttribute('data-stance', norm);
      if (norm === 'absence' && note != null) el.setAttribute('data-note', String(note));
      if (el.classList) el.classList.remove('needs-quote');
      el.setAttribute('title', norm === 'context'
        ? 'Continuing coverage — the article substantiates this, set against prior reporting'
        : norm === 'absence'
          ? 'Asserted absence — a documented search did not find this' + (note ? '. Searched: ' + note : '')
          : 'Owned by the author — ' + ({ analysis: 'their analysis', testimony: 'their account', voice: 'their stated position' }[norm]));
    }
    return { state: state, owned: norm, el: el };
  }

  // Drop an owned stance (back to a plain/needs-quote claim).
  function unassert(span) {
    var el = claimEl(span);
    if (el && el.removeAttribute) {
      el.removeAttribute('data-stance');
      var srcKey = el.getAttribute('data-src');
      var quote = (el.getAttribute('data-quote') || '').trim();
      if (srcKey && !quote && el.classList) el.classList.add('needs-quote');
    }
    return citeyStateForSpan(el, { tier: 'smart' });
  }

  // ALL content goes through Citey. On publish, every claim must be sourced
  // (pinned) or owned (declared); the rest ship FLAGGED. This is exactly the
  // editor's existing needs-quote rejection, read mechanically off the DOM.
  //   → { clean, flagged: [{ id, text, receipt, el }], counts }
  function publishGate(rootEl) {
    var r = rootEl || editorRoot();
    if (!r) return { clean: true, flagged: [], counts: { bound: 0, pinned: 0, owned: 0, undeclared: 0 } };
    var spans = Array.prototype.slice.call(r.querySelectorAll('.claim-src'));
    var flagged = [], pinned = 0, owned = 0;
    spans.forEach(function (el) {
      var stance = el.getAttribute('data-stance');
      var quote = (el.getAttribute('data-quote') || '').trim();
      if (stance) { owned++; return; }
      if (quote) { pinned++; return; }
      flagged.push({
        id: el.getAttribute('data-cid') || null,
        el: el,
        text: (el.textContent || '').trim(),
        receipt: el.getAttribute('data-src')
          ? 'cites a whole page — pin the line that backs it, or own the claim'
          : 'nothing holds this up — pin a source line, or own the claim'
      });
    });
    return {
      clean: flagged.length === 0,
      flagged: flagged,
      counts: { bound: spans.length, pinned: pinned, owned: owned, undeclared: flagged.length }
    };
  }

  // Definition layer (≢) — npj has no per-term definition ledger yet; left as a
  // documented hook so the one genuinely new check has an obvious home.
  function citeyStateForTerm(/* term, opts */) { return { state: 'falsum', receipt: 'no definition on record', defs: [] }; }

  root.CiteyBrain = {
    ingest: ingest, ready: ready, setEditorSelector: setEditorSelector, editorRoot: editorRoot,
    citeyStateForSpan: citeyStateForSpan, citeyStateForTerm: citeyStateForTerm,
    packetFor: packetFor, questionFor: questionFor, depthFor: depthFor,
    resolvePin: resolvePin, assert: assert, unassert: unassert, publishGate: publishGate,
    isPrimary: isPrimary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CiteyBrain;
})(typeof window !== 'undefined' ? window : this);
