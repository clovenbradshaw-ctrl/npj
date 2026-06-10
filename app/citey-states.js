/* ============================================================
   citey-states.js — Citey's logic-operator vocabulary, in one place.

   This is the SINGLE SOURCE OF TRUTH shared by the standalone sprite
   (Citey.dc.html) and the npj-mounted agent (Citey.jsx). Every state Citey
   can be in is a logic operator with: a glyph, a colour, an eye expression,
   and a bent-wire body path. The mascot's whole emotional range IS the
   formalism — see CITEY_INTEGRATION.md §1.

   States are produced MECHANICALLY by the eoreader3 engine (CiteyBrain.js),
   never invented by a language model. This file only describes how each
   mechanical verdict LOOKS.

   Loads as a plain script (window.CITEY_STATES) or as an ES module.
   ============================================================ */
(function (root) {
  'use strict';

  // The operator vocabulary. Keys are Citey's internal state names; each maps a
  // mechanical engine verdict (see CiteyBrain.citeyStateForSpan) to its glyph,
  // colour, and the eye expression that carries the affect.
  // A claim is grounded one of two honest ways: SOURCED (you pin the exact line
  // in a source that backs it) or OWNED (you declare it as your own). Citey rests
  // for either — the only thing he won't rest beside is an UNDECLARED assertion.
  //
  //  SOURCED — needs a pinned quote, not just an attached URL:
  //   falsum (⊥)       default worry — claim is structurally unsupported
  //   suspicious (⊥)   hovered an ungrounded claim — same glyph, sharper face
  //   turnstile (⊢)    reasoning — "this follows from…" (retrieval / graph walk)
  //   verum (⊤)        the flip — a pinned line backs the claim word-for-word
  //   entails (⊨)      stronger — a PRIMARY source (or its telling absence)
  //   negation (¬)     two sources / a draft and the graph disagree
  //   nequiv (≢)       two DEFINITIONS of a term don't match (definition layer)
  //  OWNED — the author stands behind it, honestly labelled (not a citation):
  //   asserted (⊢)     the author's analysis — follows from grounded premises
  //   testimony (⊨)    the author's account — they are the primary witness
  //   voice (⊩)        the author's stated position — argument, not fact
  //  GATE:
  //   flagged (⚑)      published-unverified — the build gate caught an undeclared claim
  const STATES = {
    falsum:     { glyph: '\u22A5', color: '#D8632E', eyes: 'neutral', label: 'undeclared' },
    suspicious: { glyph: '\u22A5', color: '#D8632E', eyes: 'slit',    label: 'wary' },
    turnstile:  { glyph: '\u22A2', color: '#7C74DE', eyes: 'lookUp',  label: 'reasoning' },
    verum:      { glyph: '\u22A4', color: '#1F9E76', eyes: 'star',    label: 'grounded' },
    entails:    { glyph: '\u22A8', color: '#1F9E76', eyes: 'heart',   label: 'primary' },
    negation:   { glyph: '\u00AC', color: '#D8412C', eyes: 'dizzy',   label: 'contradiction' },
    nequiv:     { glyph: '\u2262', color: '#D8412C', eyes: 'dizzy',   label: 'defs differ' },
    asserted:   { glyph: '\u22A2', color: '#7C74DE', eyes: 'lookUp',  label: 'your analysis' },
    testimony:  { glyph: '\u22A8', color: '#1F9E76', eyes: 'heart',   label: 'your account' },
    voice:      { glyph: '\u22A9', color: '#5A6472', eyes: 'look',    label: 'your voice' },
    flagged:    { glyph: '\u2691', color: '#D8412C', eyes: 'slit',    label: 'flagged on publish' }
  };

  // Bent-wire body geometry for each GLYPH, drawn in a 150x180 viewBox. The
  // paperclip-charm look: thick rounded strokes, hand-drawn "boil" applied by
  // the renderer (two displacement-mapped copies alternating every ~260ms).
  const BODY_PATHS = {
    '\u22A5': ['M30 150 L120 150', 'M75 150 L75 52'],            // ⊥  bar bottom, stem up
    '\u22A4': ['M30 52 L120 52',  'M75 52 L75 150'],            // ⊤  bar top, stem down
    '\u22A2': ['M48 40 L48 152',  'M48 96 L118 96'],            // ⊢  upright + right arm
    '\u22A8': ['M40 40 L40 152',  'M64 40 L64 152', 'M64 96 L122 96'], // ⊨  two uprights + arm
    '\u00AC': ['M28 84 L120 84',  'M120 84 L120 116'],          // ¬  top bar + drop hook
    '\u2262': ['M30 70 L120 70',  'M30 96 L120 96', 'M30 122 L120 122', 'M40 56 L110 136'], // ≢  three bars, slashed
    '\u22A9': ['M48 40 L48 152',  'M48 80 L118 80', 'M48 116 L118 116']  // ⊩  upright + two arms (forces / author asserts)
  };

  // Eye sprite-sheet cells (assets/eyes/rXcY.png). Each expression = a [left,right] pair.
  const EYES = {
    neutral:  ['r1c2', 'r1c3'],
    look:     ['r0c0', 'r0c1'],
    lookSide: ['r0c6', 'r0c7'],
    lookUp:   ['r1c0', 'r1c1'],
    lookDown: ['r2c0', 'r2c1'],
    blink:    ['r3c2', 'r3c3'],
    slit:     ['r0c2', 'r0c3'],
    star:     ['r1c4', 'r1c5'],
    heart:    ['r2c6', 'r2c7'],
    dizzy:    ['r0c4', 'r0c5'],
    dollar:   ['r1c6', 'r1c7']
  };

  // Convenience: resolve a state name to its full render descriptor.
  function describe(stateName) {
    const s = STATES[stateName] || STATES.falsum;
    return {
      name: stateName,
      glyph: s.glyph,
      color: s.color,
      label: s.label,
      bodyPath: (BODY_PATHS[s.glyph] || BODY_PATHS['\u22A5']).join(' '),
      eyes: EYES[s.eyes] || EYES.neutral
    };
  }

  const API = { STATES, BODY_PATHS, EYES, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.CITEY_STATES = API;
})(typeof window !== 'undefined' ? window : this);
