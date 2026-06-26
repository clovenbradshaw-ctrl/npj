/* ============================================================
   SourcePicker.jsx — SEE a source and SELECT the words that back a claim.

   The old pin flow was a blank textarea. This shows the source itself and lets
   the author drag-select the exact span to mint the citation — returning the
   quote AND its char offsets (loc) so the record knows where in the source it
   came from. Citey pre-highlights its best mechanical match (citey-assist, no
   model).

   It now also shows the FILE: an uploaded image or PDF renders inline via
   <SourceViewer>, so you cite a document you can actually see. For a PDF the
   viewer pulls the text layer out, which flows into the same select-to-cite
   reader below — so PDFs are citable, not just viewable. Falls back to a paste
   box when there's no text and no viewable file.

   Mounts: <SourcePicker srcKey claimText onPick={(quote, loc) => …} />
   Publishes window.SourcePicker.
   ============================================================ */
function SourcePicker({ srcKey, claimText, onPick }) {
  const rec = (window.NPJ.SOURCES && window.NPJ.SOURCES[srcKey]) || {};
  const [text, setText] = React.useState(String(rec.text || ""));
  const [paste, setPaste] = React.useState("");
  const [extracting, setExtracting] = React.useState(false);   // reading text out of an image/text file
  const ref = React.useRef(null);
  const SV = window.NpjSourceView;
  const kind = SV ? SV.kindOf(rec) : "text";
  const visual = !!(SV && SV.hasFile(rec) && kind === "image");   // images render inline; PDFs use the page renderer below

  React.useEffect(() => { setText(String(((window.NPJ.SOURCES || {})[srcKey] || {}).text || "")); }, [srcKey]);

  // a source with no text on record yet → recover it so the reader shows words
  // to highlight instead of a blank paste box: decode a stored text file, or OCR
  // an uploaded image (a screenshot/scan). PDFs load via the page renderer above.
  React.useEffect(() => {
    const SV = window.NpjSourceView;
    const live = (window.NPJ.SOURCES || {})[srcKey] || {};
    const k = SV && SV.kindOf(live);
    if (!SV || !SV.ensureText || String(live.text || "").trim() || !SV.hasFile(live) || (k !== "text" && k !== "image")) { setExtracting(false); return; }
    let alive = true; setExtracting(true);
    SV.ensureText(live).then(t => {
      if (!alive) return;
      setExtracting(false);
      if (t && t.trim()) { live.text = t; live.binary = false; setText(t); }
    }).catch(() => { if (alive) setExtracting(false); });
    return () => { alive = false; };
  }, [srcKey]);

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

  // PDF: the real document with a selectable text layer — drag-select the words
  // on the page and that exact text becomes the pinned quote.
  if (kind === "pdf" && SV && SV.hasFile(rec) && window.PdfView) {
    return React.createElement("div", { style: { marginTop: 8 } },
      React.createElement(window.PdfView, { rec: rec, height: 300, onSelectText: (q) => onPick(q, null) }));
  }

  // the document itself — an image inline. Drag a box on it (Area mode) to OCR
  // the exact words; that text flows straight into the pinned quote, the same as
  // a PDF text drag — so a scanned screenshot is grabbable, not just transcribed.
  const viewerEl = (visual && window.SourceViewer) ? React.createElement(window.SourceViewer, {
    key: "sv", srcKey: srcKey, rec: rec, height: 300, onSelectText: (q) => onPick(q, null)
  }) : null;

  let inner;
  if (!text.trim()) {
    inner = React.createElement("div", { key: "in" },
      React.createElement("div", { className: "np-mono", style: { fontSize: 9.5, color: extracting ? "var(--yellow)" : "rgba(255,255,255,.6)", marginBottom: 4, marginTop: viewerEl ? 8 : 0 } },
        extracting ? "Reading the text in this image…" : (visual ? "Cite from the image above — its text is read automatically; or type/paste the exact words." : "No source text on record yet — paste a passage and it'll be ranked.")),
      React.createElement("textarea", { rows: 3, value: paste, onChange: e => setPaste(e.target.value), placeholder: "Paste the source passage here…",
        style: { width: "100%", resize: "vertical", border: "1px solid rgba(255,255,255,.3)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 12.5, padding: "6px 7px", outline: "none", boxSizing: "border-box" } }),
      React.createElement("button", { onClick: seed, className: "np-cond", style: { marginTop: 5, border: "1px solid " + Y, background: Y, color: "var(--ink)", padding: "4px 9px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" } }, "Load & rank"));
  } else {
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

    inner = React.createElement("div", { key: "in" },
      React.createElement("div", { className: "np-mono", style: { fontSize: 9.5, color: Y, margin: (viewerEl ? "8px 0 4px" : "0 0 4px") } },
        "The source — highlight the words that back your claim" + (top ? " (best match is shaded)" : "")),
      React.createElement("div", { ref: ref, onMouseUp: onMouseUp,
        style: { maxHeight: 150, overflowY: "auto", whiteSpace: "pre-wrap", background: "var(--paper)", color: "var(--ink)", border: "1px solid rgba(255,255,255,.25)", padding: "8px 9px", fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.5, userSelect: "text", cursor: "text" } }, body),
      hits.length > 0 && React.createElement("div", { style: { marginTop: 6, display: "flex", flexDirection: "column", gap: 4 } },
        React.createElement("div", { className: "np-mono", style: { fontSize: 9, color: "rgba(255,255,255,.55)" } }, "or click a ranked match:"),
        hits.slice(0, 3).map((h, j) => React.createElement("button", {
          key: j, onClick: () => onPick(h.s, h.loc || null), title: "Pin this span",
          style: { textAlign: "left", border: "1px solid rgba(255,255,255,.22)", background: "rgba(255,255,255,.06)", color: "var(--paper)", padding: "5px 8px", cursor: "pointer", fontFamily: "var(--serif)", fontSize: 12, lineHeight: 1.35 }
        }, React.createElement("span", { style: { borderLeft: "3px solid " + Y, paddingLeft: 7, display: "block" } }, "“" + (h.s.length > 160 ? h.s.slice(0, 160) + "…" : h.s) + "”")))));
  }

  return React.createElement("div", { style: { marginTop: 8 } }, viewerEl, inner);
}
window.SourcePicker = SourcePicker;
