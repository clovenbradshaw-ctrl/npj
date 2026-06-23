// Structural frame detection — the document's own shape, read embedder-free.
//
// A framed document — a licence header, a title block, credits, a boilerplate footer —
// brackets its body between SET-OFF banner lines: the self-evident "start" and "stop".
// We do not read the banners' WORDS (there is no "Project Gutenberg" list here); we read
// their SHAPE. A run of asterisks is a separator mark, not a sentence — narrative prose
// never contains one. The body is the largest span BETWEEN two banners — the contiguous
// mass the reader's cursor lives inside — and whatever lies outside it is frame.
//
// This is the layer the existing two were missing. `parse/chrome.js` holds only the
// genuinely degenerate line (a bare number, a rule); `read/site.js` reads a per-unit
// semantic role and needs the embedder. Neither catches a contiguous block of licence
// PROSE — full grammatical sentences that happen to be boilerplate (the donation
// paragraphs in a Gutenberg footer read as narrative to any per-line test). The bracket
// does: everything past the closing banner is frame, however prose-like it reads.
//
// Conservative by construction. It acts only when the body is bracketed by a banner on
// BOTH sides and is a clear majority of the document — so a lone "***" scene-break inside
// a story (one banner, or a near-even split) is never mistaken for a frame. With no such
// structure it holds NOTHING and the document parses exactly as before. It can only ever
// hold the head and tail OUTSIDE a body that is itself the bulk of the text.

const MIN_SENTENCES = 40;     // below this a document is too small to carry a frame structure
const BODY_MAJORITY = 0.5;    // the bracketed body must be the bulk, or we abstain

// A banner: a set-off separator line. An asterisk run is the canonical one — a structural
// mark, not a word, so it does not occur inside narrative prose.
export const isBanner = (s) => /\*{3,}/.test(String(s || ''));

// The frame of a sentence array — the head and tail to hold, plus the body bounds. Empty
// (holds nothing) unless the shape is unambiguous: two-or-more banners, the body bracketed
// on both sides, the body a majority of the document.
export const frameSpan = (sentences = []) => {
  const n = sentences.length;
  const empty = { head: [], tail: [], all: new Set(), start: 0, end: n - 1 };
  if (n < MIN_SENTENCES) return empty;

  const banners = [];
  for (let i = 0; i < n; i++) if (isBanner(sentences[i])) banners.push(i);
  if (banners.length < 2) return empty;       // a body needs an opening AND a closing banner

  // The largest gap between two CONSECUTIVE banners — the body, bracketed on both sides.
  let lo = -1, hi = -1, span = -1;
  for (let k = 1; k < banners.length; k++) {
    const gap = banners[k] - banners[k - 1];
    if (gap > span) { span = gap; lo = banners[k - 1]; hi = banners[k]; }
  }
  const start = lo + 1, end = hi - 1;          // the body, inclusive
  if (start > end) return empty;
  if (end - start + 1 < n * BODY_MAJORITY) return empty;   // no clear majority body → abstain

  const head = []; for (let i = 0; i <= lo; i++)       head.push(i);   // front matter + opening banner
  const tail = []; for (let i = hi; i < n; i++)        tail.push(i);   // closing banner + back matter
  return { head, tail, all: new Set([...head, ...tail]), start, end };
};
