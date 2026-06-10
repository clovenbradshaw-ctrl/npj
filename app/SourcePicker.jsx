/* ============================================================
   SourcePicker.jsx — render a source and SELECT the words that back a claim.

   The old pin flow was a blank textarea. This shows the source text itself,
   pre-highlights Citey's best mechanical match (citey-assist.rankSpans, no
   model), and lets the author drag-select the exact span to mint the citation —
   returning the quote AND its char offsets (loc) so the record knows where in
   the source it came from. Falls back to a paste box when no text is on record.

   Mounts: <SourcePicker srcKey claimText onPick={(quote, loc) => …} />
   Publishes window.SourcePicker.
   ============================================================ */
function SourcePicker({ srcKey, claimText, onPick }) {
  const rec = (window.NPJ.SOURCES && window.NPJ.SOURCES[srcKey]) || {};
  const [text, setText] = React.useState(String(rec.text || ""));
  const [paste, setPaste] = React.useState("");
  const ref = React.useRef(null);

  React.useEffect(() => { setText(String(((window.NPJ.SOURCES || {})[srcKey] || {}).text || "")); }, [srcKey]);

  const hits = React.useMemo(() => {
    if (!text.trim() || !window.CiteyAssist) return [];
    try { return window.CiteyAssist.rankSpans(claimText, text) || []; } catch (e) { return []; }
  }, [text, claimText]);
  const top = hits[0];

  const seed = () => {
    const t = paste.trim(); if (!t) return;
    const merged = (text ? text + "\n" : "") + t;
    const live = window.NPJ.SOURCES[srcKey]; if (live) live.text = merged;
    setText(merged); setPaste("");
  };

  // drag-select in the rendered source → capture the exact words + char offsets
  const onMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0), cont = ref.current;
    if (!cont || !cont.contains(r.commonAncestorContainer)) return;
    const quote = r.toString().trim(); if (!quote) return;
    const pre = document.createRange(); pre.setStart(cont, 0); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    onPick(quote, { start: start, end: start + r.toString().length });
  };

  const Y = "var(--yellow)";
  if (!text.trim()) {
    return React.createElement("div", { style: { marginTop: 8 } },
      React.createElement("div", { className: "np-mono", style: { fontSize: 9.5, color: "rgba(255,255,255,.6)", marginBottom: 4 } }, "No source text on record yet — paste a passage and Citey will rank it."),
      React.createElement("textarea", { rows: 3, value: paste, onChange: e => setPaste(e.target.value), placeholder: "Paste the source passage here…",
        style: { width: "100%", resize: "vertical", border: "1px solid rgba(255,255,255,.3)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 12.5, padding: "6px 7px", outline: "none", boxSizing: "border-box" } }),
      React.createElement("button", { onClick: seed, className: "np-cond", style: { marginTop: 5, border: "1px solid " + Y, background: Y, color: "var(--ink)", padding: "4px 9px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" } }, "Load &amp; rank"));
  }

  // body with the best candidate pre-highlighted
  let body;
  if (top && top.loc) {
    const { start, end } = top.loc;
    body = [
      React.createElement("span", { key: "a" }, text.slice(0, start)),
      React.createElement("mark", { key: "b", style: { background: "rgba(255,236,1,.5)", color: "var(--ink)", borderRadius: 2 } }, text.slice(start, end)),
      React.createElement("span", { key: "c" }, text.slice(end))
    ];
  } else body = text;

  return React.createElement("div", { style: { marginTop: 8 } },
    React.createElement("div", { className: "np-mono", style: { fontSize: 9.5, color: Y, marginBottom: 4 } },
      "The source — highlight the words that back your claim" + (top ? " (Citey's best match is shaded)" : "")),
    React.createElement("div", { ref: ref, onMouseUp: onMouseUp,
      style: { maxHeight: 150, overflowY: "auto", whiteSpace: "pre-wrap", background: "var(--paper)", color: "var(--ink)", border: "1px solid rgba(255,255,255,.25)", padding: "8px 9px", fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.5, userSelect: "text", cursor: "text" } }, body),
    hits.length > 0 && React.createElement("div", { style: { marginTop: 6, display: "flex", flexDirection: "column", gap: 4 } },
      React.createElement("div", { className: "np-mono", style: { fontSize: 9, color: "rgba(255,255,255,.55)" } }, "or click a ranked match:"),
      hits.slice(0, 3).map((h, j) => React.createElement("button", {
        key: j, onClick: () => onPick(h.s, h.loc || null), title: "Pin this span",
        style: { textAlign: "left", border: "1px solid rgba(255,255,255,.22)", background: "rgba(255,255,255,.06)", color: "var(--paper)", padding: "5px 8px", cursor: "pointer", fontFamily: "var(--serif)", fontSize: 12, lineHeight: 1.35 }
      }, React.createElement("span", { style: { borderLeft: "3px solid " + Y, paddingLeft: 7, display: "block" } }, "“" + (h.s.length > 160 ? h.s.slice(0, 160) + "…" : h.s) + "”")))));
}
window.SourcePicker = SourcePicker;
