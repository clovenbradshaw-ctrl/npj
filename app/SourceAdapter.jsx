/* ============================================================
   SourceAdapter.jsx — take control of how a source is read.

   Two adjustments the app couldn't make before, in one small panel under the
   source reader:

     • Treat as image — pin a source's KIND, overriding the extension/mime guess.
       A scan that arrived as application/octet-stream (or a screenshot saved with
       no extension) was stranded as an "unknown" file with only Open/Download;
       pinning it to image gives it the picture viewer AND the OCR path. Revert to
       the detected type any time.

     • OCR on / off — for an image, turn the optical character recognition on or
       off. OFF deletes the recognized text and stops it being re-read (so a photo
       that's all face, no words, isn't carrying a wall of OCR noise). ON reads the
       picture again and seeds the text so it's citable + scannable.

   No model. All mutation + persistence runs through the host api (setSourceKind,
   setSourceOcr, setSourceText → autosave); this is just the controls. Themed by
   the NR prop, so it reads in both the dark newsroom and the light file explorer.
   Warns when citations rest on the source, since changing the words can unlink a
   pinned quote. Publishes window.SourceAdapter.
   ============================================================ */
function SourceAdapter({ rec, api, NR, nCites }) {
  const SV = window.NpjSourceView;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!SV || !rec || !api || !api.setSourceText) return null;

  const key = (rec && (rec.id || rec.key)) || "";
  const cur = String((rec && rec.text) || "");
  const kind = SV.kindOf(rec);
  const detected = SV.detectKind ? SV.detectKind(rec) : kind;
  const pinned = SV.kindPinned ? SV.kindPinned(rec) : false;
  const isImage = kind === "image";
  const ocrOff = !!(rec && rec.ocrOff);
  const canKind = !!api.setSourceKind;
  const canOcr = !!api.setSourceOcr;
  const KLABEL = { image: "Image", pdf: "PDF", text: "Text", office: "Office doc", unknown: "File" };

  const muted = NR.muted, line = NR.line, text = NR.text;
  const danger = NR.warn || "#c2724a", ok = NR.ok || "#1f8a5b";
  const field = { width: "100%", boxSizing: "border-box", minHeight: 120, border: "1px solid " + line, background: NR.field, color: text, fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.55, padding: "9px 11px", outline: "none", resize: "vertical" };
  const btn = (extra) => Object.assign({ border: "1px solid " + line, background: "transparent", color: text, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 12, padding: "4px 10px" }, extra || {});
  const eyebrow = { fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: muted, fontWeight: 600 };
  const Spin = () => <span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px", marginRight: 5 }} />;

  const begin = () => { setDraft(String((rec && rec.text) || "")); setConfirmOff(false); setOpen(true); };
  const save = () => { api.setSourceText(key, draft); setOpen(false); };
  const adapt = (k) => { if (canKind) { api.setSourceKind(key, k); setOpen(false); setConfirmOff(false); } };
  const runOcr = () => {
    if (!canOcr || busy) return;
    setOpen(false); setConfirmOff(false); setBusy(true);
    Promise.resolve(api.setSourceOcr(key, true)).then(() => setBusy(false), () => setBusy(false));
  };
  const turnOff = () => { if (canOcr) { api.setSourceOcr(key, false); setOpen(false); setConfirmOff(false); } };

  return (
    <div style={{ marginTop: 10, border: "1px solid " + line, background: NR.panel, padding: "9px 11px" }}>
      {/* —— Treat as: pin the kind (or revert to detection) —— */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="np-mono" style={eyebrow}>Treated as</span>
        <span className="np-mono" style={{ fontSize: 11, color: text, fontWeight: 700 }}>{KLABEL[kind] || "File"}</span>
        {pinned && <span className="np-mono" style={{ fontSize: 9, color: muted }}>· you set this</span>}
        <span style={{ flex: 1 }} />
        {canKind && !isImage && <button onClick={() => adapt("image")} title="Open and read this file as an image (enables OCR)" style={btn()}>⤳ Treat as image</button>}
        {canKind && pinned && <button onClick={() => adapt("auto")} title={"Go back to the detected type (" + (KLABEL[detected] || "File") + ")"} style={btn({ color: muted })}>↺ Use detected ({KLABEL[detected] || "File"})</button>}
      </div>

      {/* —— OCR: only meaningful once the source is treated as an image —— */}
      {isImage && (
        <div style={{ marginTop: 9, borderTop: "1px solid " + line, paddingTop: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="np-mono" style={eyebrow}>Recognized text (OCR)</span>
            <span className="np-mono" style={{ fontSize: 9, color: ocrOff ? danger : muted }}>
              {ocrOff ? "off — no text is read from this picture" : "read off the image — edit if it’s wrong, or turn it off"}
            </span>
            <span style={{ flex: 1 }} />
            {busy && <span className="np-mono" style={{ fontSize: 10, color: NR.warn || muted }}><Spin /> reading the image…</span>}
            {!busy && ocrOff && canOcr && <button onClick={runOcr} title="Read the text off this image" style={btn({ borderColor: ok, color: ok })}>⟳ Turn on OCR</button>}
            {!busy && !ocrOff && !open && !confirmOff && <button onClick={begin} style={btn()}>{cur.trim() ? "✎ Edit text" : "✎ Add text"}</button>}
            {!busy && !ocrOff && !open && !confirmOff && canOcr && <button onClick={runOcr} title={cur.trim() ? "Read the image again, replacing the current text" : "Read the text off this image"} style={btn()}>{cur.trim() ? "⟳ Re-read" : "⟳ Read image"}</button>}
            {!busy && !ocrOff && !open && canOcr && (confirmOff
              ? <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <span className="np-mono" style={{ fontSize: 10, color: danger }}>delete the text &amp; turn off?</span>
                  <button onClick={turnOff} style={btn({ borderColor: danger, color: danger })}>Yes</button>
                  <button onClick={() => setConfirmOff(false)} style={btn()}>No</button>
                </span>
              : <button onClick={() => setConfirmOff(true)} title="Turn OCR off and delete the recognized text" style={btn({ color: danger })}>⨯ Turn off OCR</button>)}
          </div>

          {nCites > 0 && !ocrOff && <div className="np-mono" style={{ fontSize: 9.5, color: danger, lineHeight: 1.5, marginTop: 6 }}>{nCites} citation{nCites === 1 ? "" : "s"} rest on this source — changing, deleting or turning off the text can unlink a pinned quote (the claim keeps its words; the highlight may stop showing).</div>}

          {open && (
            <div style={{ marginTop: 8 }}>
              <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} style={field} placeholder="The words read from this image. Fix anything OCR got wrong, or clear it and start over." />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 7 }}>
                <button onClick={() => setOpen(false)} style={btn()}>Cancel</button>
                <button onClick={save} style={btn({ background: "var(--yellow)", color: "var(--ink)", borderColor: "var(--yellow)", fontWeight: 700 })}>Save text</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
window.SourceAdapter = SourceAdapter;
