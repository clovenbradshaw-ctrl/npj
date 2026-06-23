// Bounded edit distance — the one fuzzy primitive the system speaks.
//
// A query term the document never spells exactly ("greta" for "Grete", a typo, a
// transcription variant) would otherwise score zero everywhere and mis-seed the
// whole turn: the surfer is set down at the top retrieval hit, so a missed term is
// not a soft miss — it is the WRONG anchor, and everything folded downstream reads
// the wrong neighbourhood. So matching is fuzzy at the one seam where a term meets
// the page: a near-miss rescue when the exact token is absent, never an approximate
// index and never a phantom hit.
//
// Levenshtein with a hard ceiling and two cutoffs (the length gap, and a per-row
// minimum), so comparing a term against a vocabulary costs roughly O(vocab) in the
// common case — most candidates are rejected on the length gap before any DP runs.

// The edit ceiling a token of this length earns. Short tokens stay exact: a single
// edit on a three-letter word already reaches too many false friends (cat→car→can).
// Longer tokens tolerate more. Tuned so "greta"→"grete" (1) passes while
// "zebras"→"apples" (5) does not.
export const fuzzCeiling = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

// Bounded Levenshtein. Returns the true distance when it is ≤ maxDist, otherwise
// maxDist + 1 (the exact value past the ceiling is never needed). Early-exits the
// moment a whole row exceeds the ceiling, so a far-apart pair costs one row, not a
// full matrix.
export const editWithin = (a, b, maxDist) => {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (maxDist <= 0) return a === b ? 0 : 1;

  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;   // no cell can recover — stop
    prev = cur;
  }
  return prev[lb];
};

// Every vocabulary token within `t`'s earned ceiling, as { token, dist }. An exact
// token short-circuits to itself at distance 0 (a real word is never fuzzed — that
// keeps common terms precise and free). A token too short to fuzz safely returns
// no matches rather than guessing.
export const fuzzyMatches = (t, vocab) => {
  if (vocab.has(t)) return [{ token: t, dist: 0 }];
  const maxDist = fuzzCeiling(t.length);
  if (maxDist === 0) return [];
  const out = [];
  for (const v of vocab) {
    const d = editWithin(t, v, maxDist);
    if (d <= maxDist) out.push({ token: v, dist: d });
  }
  return out;
};
