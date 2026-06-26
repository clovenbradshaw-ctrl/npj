/* ============================================================
   void-kinds.js — the six kinds of void, in one place.

   A "void" is an asserted absence: a claim grounded not by a source that
   exists but by the documented fact that something DOESN'T. Not all absences
   are equal — they differ by how hard they are to stand behind. This file is
   the SINGLE SOURCE OF TRUTH for that taxonomy, shared by the newsroom editor
   (Newsroom.jsx, GroundingWorkspace.jsx), the publish fold (articles.js) and
   the reader's transparency lens (ArticleRead.jsx).

   The kinds are ordered strongest-first (easiest to stand behind → hardest),
   and fall into three groups by what the author can actually offer a reader:

     • show   — you can POINT TO the absence (the diff, the redaction). Direct.
     • locate — you can DESCRIBE or LOCATE it (cite the gap, or say where it's
                out of reach). One step removed.
     • assert — you can only ASSERT it (no record exists; you're inferring).

   The split is the point: a citation carries WHICH kind it is, so a reader
   knows whether they're being shown an absence or told to infer one.

   Loads as a plain script (window.NpjVoidKinds) or as a CommonJS module.
   ============================================================ */
(function (root) {
  'use strict';

  // group → how the author backs the absence, and how confident a reader should be.
  // Ordered strongest → weakest; the reader lens shades voids by this.
  const GROUPS = [
    { key: 'show',   verb: 'Point to it',          gloss: 'direct evidence — you can show the absence',  reader: 'shown' },
    { key: 'locate', verb: 'Describe or locate it', gloss: "cite the gap, or say where it's out of reach", reader: 'located' },
    { key: 'assert', verb: 'Assert it',             gloss: "no record — you're inferring it",             reader: 'inferred' }
  ];

  // The six kinds. `strength` 6 (strongest) → 1 (weakest). `prompt` is what the
  // author should write to ground a void of this kind; `blurb` explains it.
  const KINDS = {
    removed: {
      label: 'Removed', group: 'show', glyph: '⊖', strength: 6,
      blurb: "It was there and now it's gone — a deleted page, a retracted statement, a dead link, a reverted edit. The change itself is the proof.",
      prompt: 'Link the archived before-state, or the diff that shows the before and after.'
    },
    withheld: {
      label: 'Withheld', group: 'show', glyph: '⊘', strength: 5,
      blurb: "It's there, but blacked out or refused — a redaction, “no comment,” a sealed record. The refusal is visible, so you can point to it.",
      prompt: 'Point to the refusal — the redaction, the “no comment,” the sealed docket: where, who, when.'
    },
    silent: {
      label: 'Silent', group: 'locate', glyph: '○', strength: 4,
      blurb: "The record exists and simply never mentions the thing — the report that never names the lawsuit. No sign anything is missing.",
      prompt: "Name the record you'd expect it in, and the gap you're flagging — what isn't there."
    },
    inaccessible: {
      label: 'Inaccessible', group: 'locate', glyph: '⦸', strength: 3,
      blurb: "It exists but you can't reach it — a paywall, a classified file, the wrong language, a dead file format. The absence is on your end, not in the record.",
      prompt: 'Say where it is and why it is out of reach — paywall, classification, language, format.'
    },
    unrecorded: {
      label: 'Unrecorded', group: 'assert', glyph: '∅', strength: 2,
      blurb: "Nobody ever wrote it down. No document, no source — you can't cite it, only argue it probably happened. Highest risk.",
      prompt: 'Argue why it probably happened, and why no record of it would exist.'
    },
    ambient: {
      label: 'Ambient', group: 'assert', glyph: '·', strength: 1,
      blurb: "The ordinary unrecorded background of daily life — the stuff no one was ever going to log. Not a gap, just the unwritten normal. Don't treat it as a finding.",
      prompt: 'Note the ordinary background you are leaning on — context, not a finding.'
    }
  };

  // strongest → weakest (the order they read in pickers and legends)
  const ORDER = ['removed', 'withheld', 'silent', 'inaccessible', 'unrecorded', 'ambient'];

  function get(k) { return KINDS[k] || null; }
  // normalize an attribute value to a known kind, else null (unspecified void)
  function norm(k) { k = String(k || '').trim().toLowerCase(); return KINDS[k] ? k : null; }
  function groupOf(k) { return (KINDS[k] || {}).group || null; }
  function groupMeta(g) { return GROUPS.find(x => x.key === g) || null; }
  // the kinds belonging to a group, in ORDER
  function kindsIn(g) { return ORDER.filter(k => KINDS[k].group === g); }

  const API = {
    KINDS, ORDER, GROUPS, get, norm, groupOf, groupMeta, kindsIn,
    label: (k) => (KINDS[k] || {}).label || '',
    glyph: (k) => (KINDS[k] || {}).glyph || '∅',
    // the reader-facing verb for HOW the absence stands: shown | located | inferred
    reader: (k) => { const m = groupMeta((KINDS[k] || {}).group); return m ? m.reader : 'asserted'; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.NpjVoidKinds = API;
})(typeof window !== 'undefined' ? window : this);
