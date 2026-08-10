/* versions-diff.js — the word-level diff behind the edit-history pane.
 *
 * Pulled out of versions.jsx so the pure token math is unit-testable under
 * `node --test` (the .jsx renderer stays browser-only). Exposed as
 * window.NpjVersionDiff for the browser and module.exports for the tests.
 *
 * diffWords is an LCS over whitespace-preserving tokens. Because every run of
 * spaces is its own token — all of them the identical " " — the LCS is free to
 * match the spaces that FLANK a changed word while leaving the word unmatched.
 * That strands the edit's whitespace OUTSIDE the del/add pair, and two visible
 * defects follow:
 *
 *   • a replaced word renders as its deletion butted straight against its
 *     insertion — "was" struck, "appears" added, nothing between → "wasappears";
 *   • a struck or highlighted run keeps an edge space ("the " struck, trailing
 *     space and all), so "the MNPD" reads as "theMNPD".
 *
 * normalizeDiff repairs both WITHOUT touching the LCS: it lifts leading/trailing
 * whitespace out of every del/add into a neutral run, then guarantees a single
 * separating space wherever a deletion abuts the insertion that replaces it. It
 * moves only WHERE the spaces render — word counts (diffStats) are unchanged —
 * and is idempotent, so diffWords can safely bake it into its own output. */
(function (root) {
  "use strict";

  // keep whitespace as its own tokens so reflow is faithful
  function diffTokens(s) {
    return String(s == null ? "" : s).split(/(\s+)/).filter(t => t.length);
  }

  // lift edge whitespace out of every del/add into a neutral run, then keep a
  // deletion and the insertion replacing it one space apart — so a replacement
  // reads "~was~ appears", never "~was~appears". A del/add that was purely
  // whitespace collapses to neutral (a struck lone space helps no one).
  function normalizeDiff(parts) {
    const split = [];
    const pushSame = (text) => {
      if (!text) return;
      const last = split[split.length - 1];
      if (last && last.type === "same") last.text += text; else split.push({ type: "same", text });
    };
    for (const p of parts) {
      if (p.type === "same") { pushSame(p.text); continue; }
      const lead = (p.text.match(/^\s+/) || [""])[0];
      const rest = p.text.slice(lead.length);
      const trail = (rest.match(/\s+$/) || [""])[0];
      const core = trail ? rest.slice(0, rest.length - trail.length) : rest;
      pushSame(lead);
      if (core) split.push({ type: p.type, text: core });
      pushSame(trail);
    }
    const out = [];
    for (const p of split) {
      const prev = out[out.length - 1];
      if (prev && ((prev.type === "del" && p.type === "add") || (prev.type === "add" && p.type === "del")))
        out.push({ type: "same", text: " " });
      out.push(p);
    }
    return out;
  }

  // The raw LCS partition — same/del parts concatenate back to EXACTLY aStr,
  // same/add parts to EXACTLY bStr. No cosmetic touch-ups, so it's the one to
  // reconstruct FROM (e.g. authorship.js's advanceRuns, slicing old runs by
  // these exact offsets); diffWords is the one to RENDER (it inserts a
  // separator normalizeDiff needs for "~was~ appears" to read right, which
  // means it no longer round-trips to either input string byte-for-byte).
  function diffWordsRaw(aStr, bStr) {
    const a = diffTokens(aStr), b = diffTokens(bStr);
    const n = a.length, m = b.length;
    // LCS table
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    const push = (type, text) => { const last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type, text }); };
    while (i < n && j < m) {
      if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
      else { push("add", b[j]); j++; }
    }
    while (i < n) { push("del", a[i]); i++; }
    while (j < m) { push("add", b[j]); j++; }
    return out;
  }

  function diffWords(aStr, bStr) { return normalizeDiff(diffWordsRaw(aStr, bStr)); }

  function diffStats(parts) {
    let add = 0, del = 0;
    parts.forEach(p => { const w = (p.text.trim().match(/\S+/g) || []).length; if (p.type === "add") add += w; else if (p.type === "del") del += w; });
    return { add, del };
  }

  root.NpjVersionDiff = { diffTokens, diffWords, diffWordsRaw, diffStats, normalizeDiff };
  // node tests require() the pure diff; the browser path is unchanged (root === window).
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjVersionDiff;
})(typeof window !== "undefined" ? window : globalThis);
