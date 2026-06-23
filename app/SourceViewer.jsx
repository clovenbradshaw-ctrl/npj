/* ============================================================
   SourceViewer.jsx — render an uploaded SOURCE's actual content, in-app.

   Before this, the app could only show a source's extracted TEXT — so a PDF, a
   scan, or a photo you uploaded to back a claim was invisible: you cited a
   document you couldn't see. This renders the real thing by kind:

     • image  → the picture, contained, on a neutral mat.
     • pdf    → the REAL document via <PdfView>: pages rendered to canvas with a
                selectable text layer on top, so it reads like the original and a
                drag-selection is captured verbatim (onSelectText) — never
                flattened into a wall of text. Falls back to a native <iframe>
                only if the canvas renderer is unavailable.
     • text   → the words (read-only); decodes the stored file if needed.
     • other  → an honest "no in-browser preview" with Open / Download.

   URLs resolve through NpjSourceView.displayUrl, so an auth-gated homeserver's
   media still renders (token-fetched blob: URL) and a just-uploaded file shows
   instantly from the session blob. Self-contained light card (var(--paper) /
   var(--ink)) so it reads on any backdrop — the light explorer or the dark
   newsroom panel.

   Mounts: <SourceViewer srcKey | rec  height onText />. onText(text) fires once
   after a PDF's text is extracted (the host decides whether to seed rec.text).
   Publishes window.SourceViewer.
   ============================================================ */
function SourceViewer({ srcKey, rec, height, onText, onSelectText, frameless, hideOcr }) {
  const SV = window.NpjSourceView;
  rec = rec || (window.NPJ.SOURCES && window.NPJ.SOURCES[srcKey]) || {};
  const key = (rec && (rec.id || rec.key)) || srcKey || "";
  const kind = SV ? SV.kindOf(rec) : "unknown";
  const H = height || 420;

  const [url, setUrl] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [err, setErr] = useState(null);
  const [txt, setTxt] = useState(String(rec.text || ""));  // decoded text-file body
  const [txtLoading, setTxtLoading] = useState(false);
  const [showOcr, setShowOcr] = useState(false);           // image: reveal the recognized (OCR) text

  // resolve a renderable URL (blob → resolved media-store → archive/original)
  useEffect(() => {
    let alive = true;
    setUrl(null); setErr(null); setResolving(true);
    if (!SV || !SV.hasFile(rec)) { setResolving(false); return; }
    SV.displayUrl(rec)
      .then(u => { if (alive) { setUrl(u || null); setResolving(false); if (!u) setErr("This file isn't reachable right now."); } })
      .catch(() => { if (alive) { setResolving(false); setErr("Couldn't load this file."); } });
    return () => { alive = false; };
  }, [key, rec && rec.file_url, rec && rec.archive_url]); // eslint-disable-line

  // Text files: show the words. If they're already on record use them; otherwise
  // decode the stored bytes (and hand them back via onText so the host can seed).
  useEffect(() => {
    if (kind !== "text") return;
    const onRec = String(rec.text || "");
    if (onRec.trim()) { setTxt(onRec); return; }
    if (!SV || !SV.hasFile(rec) || !SV.ensureText) { setTxt(""); return; }
    let alive = true; setTxtLoading(true);
    SV.ensureText(rec)
      .then(t => { if (!alive) return; setTxt(t || ""); setTxtLoading(false); if (t && onText) onText(t); })
      .catch(() => { if (alive) setTxtLoading(false); });
    return () => { alive = false; };
  }, [key, kind]); // eslint-disable-line

  const Spin = () => <span style={{ width: 13, height: 13, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-2px" }} />;
  const mat = { background: "repeating-conic-gradient(#e9e4d6 0% 25%, #f3eee1 0% 50%) 50% / 18px 18px", border: frameless ? 0 : "1px solid var(--rule)" };

  const linkRow = url ? (
    <div className="np-mono" style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10.5, color: "var(--ink-soft)", marginTop: 6 }}>
      <a href={url} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center", gap: 4 }}><I.ext style={{ fontSize: 12 }} /> Open in new tab</a>
      <button onClick={() => SV.download(rec)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, fontFamily: "inherit", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>↓ Download</button>
      {rec.size ? <span>{SV.humanSize(rec.size)}</span> : null}
    </div>
  ) : null;

  // no bytes on record (e.g. a web source with no upload, or a pre-upload
  // draft) — though a text source we already read words out of still renders
  const textOnly = kind === "text" && String(rec.text || "").trim();
  if (!SV || (!SV.hasFile(rec) && !textOnly)) {
    return (
      <div style={{ border: frameless ? 0 : "1px dashed var(--rule-strong)", background: "var(--paper)", color: "var(--ink-soft)", padding: "18px 16px", textAlign: "center" }}>
        <I.doc style={{ fontSize: 26 }} />
        <div className="np-mono" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          No file stored for this source yet.<br />Upload the document and it'll show here for reading and citing.
        </div>
      </div>
    );
  }

  // PDF: render the real pages via its own loader — don't gate on the link
  // resolve (that's a separate fetch only used for the Open/Download row).
  if (kind === "pdf" && window.PdfView) {
    return (
      <div>
        <window.PdfView rec={rec} height={H} onSelectText={onSelectText} />
        {url && linkRow}
      </div>
    );
  }

  if (resolving) return <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> loading the document…</div>;
  if (err && kind !== "text") return (
    <div style={{ border: "1px solid var(--reject)", background: "var(--paper)", color: "var(--reject)", padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.5 }}>
      {err}{linkRow}
    </div>
  );

  if (kind === "image") {
    const ocr = String(rec.text || "").trim();
    return (
      <div>
        <div style={{ ...mat, display: "flex", alignItems: "center", justifyContent: "center", maxHeight: H, minHeight: 120, overflow: "auto", padding: 8 }}>
          <img src={url} alt={rec.title || "uploaded image"} style={{ maxWidth: "100%", maxHeight: H - 16, objectFit: "contain", display: "block" }} />
        </div>
        {linkRow}
        {ocr && !hideOcr ? (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setShowOcr(v => !v)} className="np-mono" title="Text read from the image by OCR" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--data)", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {showOcr ? "▾" : "▸"} Recognized text (OCR)
            </button>
            {showOcr && <div className="np-scroll" style={{ maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--rule)", padding: "10px 12px", marginTop: 6, fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.55 }}>{rec.text}</div>}
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === "pdf") {
    // fallback when the canvas renderer isn't available: the browser's native PDF
    if (!url) return <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> loading the document…</div>;
    return (
      <div>
        <iframe src={url} title={rec.title || "PDF source"} style={{ width: "100%", height: H, border: frameless ? 0 : "1px solid var(--rule)", background: "var(--paper)" }} />
        {linkRow}
      </div>
    );
  }

  if (kind === "text") {
    if (txtLoading && !txt.trim()) return <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> reading the document…</div>;
    if (!txt.trim()) return (
      <div style={{ border: "1px dashed var(--rule-strong)", background: "var(--paper)", color: "var(--ink-soft)", padding: "16px", textAlign: "center" }}>
        <div className="np-mono" style={{ fontSize: 11, lineHeight: 1.5 }}>The file is stored, but no readable text could be pulled from it.{linkRow}</div>
      </div>
    );
    return (
      <div>
        <div className="np-scroll" style={{ maxHeight: H, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper)", color: "var(--ink)", border: frameless ? 0 : "1px solid var(--rule)", padding: "12px 14px", fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.6 }}>{txt}</div>
        {linkRow}
      </div>
    );
  }

  // office / unknown — no faithful in-browser preview without a converter
  return (
    <div style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink)", padding: "20px 16px", textAlign: "center" }}>
      <I.doc style={{ fontSize: 30, color: "var(--ink-soft)" }} />
      <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, marginTop: 8 }}>{rec.filename || rec.title || "Document"}</div>
      <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.55, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
        {SV.kindLabel(rec)} files don't preview in the browser. Open or download it to read it — then paste the passage you're citing into the reader.
      </div>
      <div style={{ display: "inline-flex", gap: 10, marginTop: 12 }}>
        <a href={url} target="_blank" rel="noopener" className="btn btn-sm btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><I.ext style={{ fontSize: 12 }} /> Open</a>
        <button onClick={() => SV.download(rec)} className="btn btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>↓ Download{rec.size ? " · " + SV.humanSize(rec.size) : ""}</button>
      </div>
    </div>
  );
}
window.SourceViewer = SourceViewer;
