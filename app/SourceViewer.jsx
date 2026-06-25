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
const zBtn = { width: 26, height: 24, border: "1px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", fontSize: 13, fontWeight: 700, cursor: "pointer", lineHeight: 1 };

/* A readable, citable image. A dense screenshot (an emailed scan, say) was
   rendered too small to read and had no way to be grabbed — so it's now zoomable
   (Fit / +/− , scroll to pan) AND, when citing, carries an "Area" grab: drag a
   box over the picture, we crop that exact region off the real bytes (an
   ImageBitmap, so a cross-origin URL never taints the crop) and OCR just those
   words, handing them back through onSelectText exactly like a PDF text drag —
   so the caller needs no new wiring to cite a scan. */
function ImageCite({ rec, url, alt, H, frameless, onSelectText }) {
  const SV = window.NpjSourceView;
  const innerRef = useRef(null);
  const imgRef = useRef(null);
  const bmpRef = useRef(null);                 // ImageBitmap of the real bytes
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [mode, setMode] = useState(onSelectText ? "area" : "view");
  const [ocr, setOcr] = useState(null);        // {state:'reading'|'done'|'fail', text?}

  // decode the real bytes once so an OCR crop is taint-proof
  useEffect(() => {
    let alive = true; bmpRef.current = null;
    if (!onSelectText || !SV || !SV.bytesFor || typeof createImageBitmap === "undefined") return;
    SV.bytesFor(rec).then(b => b && createImageBitmap(b)).then(bm => { if (alive) bmpRef.current = bm || null; }).catch(() => {});
    return () => { alive = false; };
  }, [rec && (rec.id || rec.key), onSelectText]); // eslint-disable-line

  // area grab: a box on the image → crop the matching region off the bitmap → OCR
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || mode !== "area" || !onSelectText) return;
    let drag = null;
    const onDown = (e) => {
      const img = imgRef.current; if (!img) return;
      e.preventDefault();
      inner.querySelectorAll(".npj-img-region").forEach(el => el.remove());
      const r = img.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "npj-img-region npj-pdf-region npj-pdf-region-live";
      inner.appendChild(box);
      drag = { r, ox: e.clientX - r.left, oy: e.clientY - r.top, box, cur: null };
      size(e.clientX, e.clientY);
    };
    const size = (cx, cy) => {
      if (!drag) return;
      const x2 = Math.max(0, Math.min(drag.r.width, cx - drag.r.left));
      const y2 = Math.max(0, Math.min(drag.r.height, cy - drag.r.top));
      const x = Math.min(drag.ox, x2), y = Math.min(drag.oy, y2);
      const w = Math.abs(x2 - drag.ox), h = Math.abs(y2 - drag.oy);
      drag.box.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;";
      drag.cur = { x, y, w, h };
    };
    const onMove = (e) => { if (drag) size(e.clientX, e.clientY); };
    const onUp = () => {
      if (!drag) return;
      const d = drag; drag = null; d.box.classList.remove("npj-pdf-region-live");
      const cur = d.cur;
      if (!cur || cur.w < 6 || cur.h < 6) { d.box.remove(); return; }
      const bmp = bmpRef.current;
      if (!bmp || !SV || !SV.ocrImage) { setOcr({ state: "fail" }); return; }
      let preview = "";
      try {
        const ratio = bmp.width / d.r.width;
        const tmp = document.createElement("canvas");
        tmp.width = Math.max(1, Math.round(cur.w * ratio));
        tmp.height = Math.max(1, Math.round(cur.h * ratio));
        tmp.getContext("2d").drawImage(bmp, cur.x * ratio, cur.y * ratio, cur.w * ratio, cur.h * ratio, 0, 0, tmp.width, tmp.height);
        preview = tmp.toDataURL("image/png");
      } catch (e) {}
      if (!preview) { setOcr({ state: "fail" }); return; }
      setOcr({ state: "reading" });
      SV.ocrImage(preview).then(t => {
        const text = String(t || "").replace(/\s+/g, " ").trim();
        if (text) { setOcr({ state: "done", text }); onSelectText(text); }
        else setOcr({ state: "fail" });
      }).catch(() => setOcr({ state: "fail" }));
    };
    inner.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { inner.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [mode, onSelectText, url]); // eslint-disable-line

  const mat = { background: "repeating-conic-gradient(#e9e4d6 0% 25%, #f3eee1 0% 50%) 50% / 18px 18px", border: frameless ? 0 : "1px solid var(--rule)" };
  const imgW = fit ? "100%" : Math.round(zoom * 100) + "%";
  const setZ = (z) => { setFit(false); setZoom(Math.max(0.5, Math.min(6, z))); };
  const Spin = () => <span style={{ width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-2px" }} />;
  const ModeBtn = ({ m, label }) => <button onMouseDown={e => e.preventDefault()} onClick={() => { setMode(m); setOcr(null); }} className="np-cond" style={{ background: mode === m ? "var(--ink)" : "transparent", color: mode === m ? "var(--paper)" : "var(--ink)", border: "1px solid var(--ink)", padding: "3px 9px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" }}>{label}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 6px", flexWrap: "wrap" }}>
        {onSelectText ? <><span className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", letterSpacing: ".06em" }}>GRAB BY</span><ModeBtn m="area" label="Area" /><ModeBtn m="view" label="Pan" /></> : null}
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)" }}>ZOOM</span>
        <button onClick={() => setZ((fit ? 1 : zoom) - 0.25)} className="np-cond" style={zBtn}>−</button>
        <button onClick={() => { setFit(true); setZoom(1); }} className="np-cond" title="Fit to width" style={{ ...zBtn, width: "auto", padding: "0 7px" }}>{fit ? "Fit" : Math.round(zoom * 100) + "%"}</button>
        <button onClick={() => setZ((fit ? 1 : zoom) + 0.25)} className="np-cond" style={zBtn}>+</button>
      </div>
      {onSelectText && mode === "area" && (
        <div className="np-mono" style={{ fontSize: 9.5, margin: "0 0 5px", lineHeight: 1.4 }}>
          {ocr && ocr.state === "reading" ? <span style={{ color: "var(--yellow)" }}><Spin /> reading the area…</span>
            : ocr && ocr.state === "fail" ? <span style={{ color: "var(--reject)" }}>couldn't read that area — zoom in, draw a tighter box, or type the words below</span>
            : ocr && ocr.state === "done" ? <span style={{ color: "var(--verified,#1f8a5b)" }}>✓ grabbed — “{ocr.text.slice(0, 46)}{ocr.text.length > 46 ? "…" : ""}”</span>
            : <span style={{ color: "var(--ink-soft)" }}>Draw a box around the exact words you're citing — they're read by OCR.</span>}
        </div>
      )}
      <div className="np-scroll" style={{ ...mat, maxHeight: H, minHeight: 120, overflow: "auto", padding: 8, cursor: (onSelectText && mode === "area") ? "crosshair" : "default" }}>
        <div ref={innerRef} style={{ position: "relative", width: imgW, margin: "0 auto", lineHeight: 0 }}>
          <img ref={imgRef} src={url} alt={alt} draggable={false} style={{ width: "100%", display: "block", userSelect: "none" }} />
        </div>
      </div>
    </div>
  );
}

function SourceViewer({ srcKey, rec, height, onText, onSelectText, frameless, hideOcr, onEditText }) {
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
  const [ocrEdit, setOcrEdit] = useState(null);            // image: editing the OCR text in place (null = viewing)

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
        <ImageCite rec={rec} url={url} alt={rec.title || "uploaded image"} H={H} frameless={frameless} onSelectText={onSelectText} />
        {linkRow}
        {ocr && !hideOcr ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => { setShowOcr(v => !v); setOcrEdit(null); }} className="np-mono" title="Text read from the image by OCR" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--data)", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {showOcr ? "▾" : "▸"} Recognized text (OCR)
              </button>
              {showOcr && onEditText && ocrEdit == null && <button onClick={() => setOcrEdit(String(rec.text || ""))} className="np-mono" title="Fix what the OCR read wrong — the words you cite come from here" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--ink-soft)", fontSize: 10.5 }}>✎ Edit</button>}
            </div>
            {showOcr && (ocrEdit == null
              ? <div className="np-scroll" style={{ maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--rule)", padding: "10px 12px", marginTop: 6, fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.55 }}>{rec.text}</div>
              : <div style={{ marginTop: 6 }}>
                  <textarea autoFocus value={ocrEdit} onChange={e => setOcrEdit(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", minHeight: 140, background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--rule)", padding: "10px 12px", fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.55, outline: "none", resize: "vertical" }}
                    placeholder="The words read from this image. Fix anything OCR got wrong." />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                    <button onClick={() => setOcrEdit(null)} className="np-mono" style={{ background: "none", border: "1px solid var(--rule)", color: "var(--ink-soft)", fontSize: 11, padding: "4px 9px", cursor: "pointer" }}>Cancel</button>
                    <button onClick={() => { onEditText(ocrEdit); if (rec) rec.text = ocrEdit; setOcrEdit(null); }} className="np-mono" style={{ background: "var(--yellow)", border: "1px solid var(--ink)", color: "var(--ink)", fontWeight: 700, fontSize: 11, padding: "4px 9px", cursor: "pointer" }}>Save text</button>
                  </div>
                </div>)}
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

  // a web source (snapshot/link) we hold no file or extracted text for — the
  // "office doc" copy below is wrong for a URL. Offer the snapshot + original to
  // read; that's the honest preview until its words are pulled in.
  if ((rec.original_url || rec.archive_url) && !rec.file_url) {
    return (
      <div style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink)", padding: "20px 16px", textAlign: "center" }}>
        <I.link style={{ fontSize: 28, color: "var(--ink-soft)" }} />
        <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, marginTop: 8 }}>{rec.title || rec.outlet || "Web page"}</div>
        <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.55, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
          A web page — no text is stored here yet. Open the {rec.archive_url ? "captured snapshot" : "page"} to read it, then pin the exact passage you're citing.
        </div>
        <div style={{ display: "inline-flex", gap: 10, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {rec.archive_url && <a href={rec.archive_url} target="_blank" rel="noopener" className="btn btn-sm btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><I.ext style={{ fontSize: 12 }} /> Open snapshot</a>}
          {rec.original_url && <a href={rec.original_url} target="_blank" rel="noopener" className={"btn btn-sm" + (rec.archive_url ? "" : " btn-primary")} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><I.ext style={{ fontSize: 12 }} /> Open original</a>}
        </div>
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
