/* ============================================================
   SourceViewer.jsx — render an uploaded SOURCE's actual content, in-app.

   Before this, the app could only show a source's extracted TEXT — so a PDF, a
   scan, or a photo you uploaded to back a claim was invisible: you cited a
   document you couldn't see. This renders the real thing by kind:

     • image  → the picture, contained, on a neutral mat.
     • pdf    → the document in an <iframe> (the browser's native PDF view) AND,
                when a citation surface asks (onText), pdf.js pulls its text layer
                out so the existing select-to-cite reader works on PDFs too.
     • text   → the words (read-only), for the explorer's preview pane.
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
function SourceViewer({ srcKey, rec, height, onText, frameless }) {
  const SV = window.NpjSourceView;
  rec = rec || (window.NPJ.SOURCES && window.NPJ.SOURCES[srcKey]) || {};
  const key = (rec && (rec.id || rec.key)) || srcKey || "";
  const kind = SV ? SV.kindOf(rec) : "unknown";
  const H = height || 420;

  const [url, setUrl] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [err, setErr] = useState(null);
  const [pdf, setPdf] = useState(null);   // { state, error } for extraction

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

  // PDFs: pull the text layer so the file becomes citable, not just viewable.
  useEffect(() => {
    if (kind !== "pdf" || !SV || !onText) return;
    let alive = true;
    setPdf({ state: "extracting" });
    SV.extractPdfText(rec)
      .then(t => { if (!alive) return; setPdf({ state: "done", empty: !String(t || "").trim() }); if (t) onText(t); })
      .catch(e => { if (alive) setPdf({ state: "error", error: (e && e.message) || "couldn't read the text" }); });
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

  if (resolving) return <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> loading the document…</div>;
  if (err && kind !== "text") return (
    <div style={{ border: "1px solid var(--reject)", background: "var(--paper)", color: "var(--reject)", padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.5 }}>
      {err}{linkRow}
    </div>
  );

  if (kind === "image") {
    return (
      <div>
        <div style={{ ...mat, display: "flex", alignItems: "center", justifyContent: "center", maxHeight: H, minHeight: 120, overflow: "auto", padding: 8 }}>
          <img src={url} alt={rec.title || "uploaded image"} style={{ maxWidth: "100%", maxHeight: H - 16, objectFit: "contain", display: "block" }} />
        </div>
        {linkRow}
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <div>
        <iframe src={url} title={rec.title || "PDF source"} style={{ width: "100%", height: H, border: frameless ? 0 : "1px solid var(--rule)", background: "var(--paper)" }} />
        {onText && pdf && (
          <div className="np-mono" style={{ fontSize: 10, color: pdf.state === "error" ? "var(--reject)" : "var(--ink-soft)", marginTop: 5, display: "flex", alignItems: "center", gap: 6, lineHeight: 1.5 }}>
            {pdf.state === "extracting" && <><Spin /> reading the text so you can cite it…</>}
            {pdf.state === "done" && !pdf.empty && <>✓ text ready — switch to the reader to select the words you're citing</>}
            {pdf.state === "done" && pdf.empty && <>⚠ no selectable text (a scan?) — view it here; type the quote to cite</>}
            {pdf.state === "error" && <>couldn't read the text ({pdf.error}) — view it above, or type the quote to cite</>}
          </div>
        )}
        {linkRow}
      </div>
    );
  }

  if (kind === "text") {
    const t = String(rec.text || "");
    if (!t.trim()) return (
      <div style={{ border: "1px dashed var(--rule-strong)", background: "var(--paper)", color: "var(--ink-soft)", padding: "16px", textAlign: "center" }}>
        <div className="np-mono" style={{ fontSize: 11, lineHeight: 1.5 }}>The file is stored, but no text was read out of it yet.{linkRow}</div>
      </div>
    );
    return (
      <div>
        <div className="np-scroll" style={{ maxHeight: H, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper)", color: "var(--ink)", border: frameless ? 0 : "1px solid var(--rule)", padding: "12px 14px", fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.6 }}>{t}</div>
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
