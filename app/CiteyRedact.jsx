/* ============================================================
   CiteyRedact.jsx — Citey's PII review + hard-redaction surface. NO MODEL.

   Citey's FIRST REAL JOB. On the way to archive.org — permanent, all-or-nothing,
   undeletable — a source has to pass through Citey's review so the author can
   redact anything that would identify a source or expose private data. They
   don't have to do it the instant they upload (they can defer), but a source
   can't be archived until they've BEEN through this and either redacted each
   flagged span or consciously AFFIRMED it (kept it public on purpose).

   Two layers, the same split as the rest of Citey:
     • the DECISION is mechanical — window.NpjPII (the pii-v2 recognizer pack)
       surfaces candidate spans and scores them. No language model. The pack is
       data-shaped (phones, SSNs, cards, addresses…) and does NOT guess names —
       redacting a name is a drag-select here, not a recognizer's call.
     • this is the SURFACE — it renders the document, lets Citey edit it broadly
       (redact a flagged span, redact any selection, or free-edit the whole text),
       and writes the review onto the source record.

   A redaction here is HARD: window.NpjPII.redactText destroys the characters in
   rec.text (offset-preserving █ block) — what gets archived no longer contains
   them. Each redaction/affirmation is logged on rec.piiReview with its `basis`,
   so the act is auditable without un-withholding what was withheld.

   Mounts: <window.CiteyRedactModal srcKey="doc-…" onClose onDone />
   Loads via in-browser Babel after Data.jsx. Publishes window.CiteyRedactModal.
   ============================================================ */

// Neutral, templated review lines — mechanical recognizers, no model.
const RX_SAY = {
  some: (n) => "Scanned. " + n + " span" + (n === 1 ? "" : "s") + " could identify someone or expose private data — redact what shouldn't be public, or keep it on purpose.",
  clean: "Scanned — nothing obvious found. Read it over, then mark it reviewed. This is a first pass, not a guarantee.",
  binary: "This file type can't be read inside the browser. Paste its text to scan it, or check it yourself and affirm there's no PII.",
  reviewed: "Reviewed. This can go to the archive now.",
};

function rxNowIso() { return new Date().toISOString(); }
function rxMe() { try { const s = window.MatrixAuth && window.MatrixAuth.current && window.MatrixAuth.current(); return (s && s.user_id) || null; } catch (e) { return null; } }
function rxClip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); n = n || 64; return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// Is this source one we couldn't read text out of (a binary/opaque upload)?
function rxIsOpaque(rec) {
  return !String(rec && rec.text || "").trim() && !!(rec && rec.binary);
}

function CiteyRedactModal({ srcKey, onClose, onDone }) {
  const PII = window.NpjPII;
  const rec = (window.NPJ.SOURCES && window.NPJ.SOURCES[srcKey]) || null;
  const S = window.CITEY_STATES;

  const [text, setText] = useState(() => String((rec && rec.text) || ""));
  // re-hydrate affirmed-public ranges from the record, so deferring and re-opening
  // doesn't re-prompt spans the author already chose to keep
  const [kept, setKept] = useState(() => (((rec && rec.piiReview && rec.piiReview.affirmations) || []).map(a => ({ start: a.start, end: a.end, type: a.type }))));
  const [editing, setEditing] = useState(false);     // broad free-edit mode
  const [draft, setDraft] = useState("");            // free-edit buffer
  const [paste, setPaste] = useState("");            // paste-to-scan (opaque files)
  const [sel, setSel] = useState(null);              // { start, end, quote } drag selection
  const [showKept, setShowKept] = useState(false);
  const [, bump] = useState(0);
  const bodyRef = useRef(null);
  const SVk = window.NpjSourceView;
  const kind = (SVk && rec) ? SVk.kindOf(rec) : "unknown";
  const isPdf = kind === "pdf";
  // PDF layout (text + per-run geometry) so a text redaction can be burned onto
  // the page as a box, and a box drawn on the page can scrub the words under it.
  const [layout, setLayout] = useState(null);
  // redaction boxes (normalized {page,x,y,w,h}) that will be burned into the
  // archived PDF — re-hydrated from the record so deferring + reopening keeps them.
  const [pdfBoxes, setPdfBoxes] = useState(() => (((rec && rec.piiReview && rec.piiReview.pdfBoxes) || []).slice()));
  const [docLoad, setDocLoad] = useState(null);    // {state:'reading'|'fail', err?} while a binary's text/layout is read
  const [building, setBuilding] = useState(null);  // {state:'building'|'done'|'nostore'|'fail', done, total, err}

  // OCR (or another async seed) can fill rec.text AFTER this modal opened on a
  // binary upload — e.g. a screenshot whose text is still being read. Sync it in
  // so the review flips from paste-to-scan to the real words (and live PII
  // findings) without a reopen. Only adopted while we have none; redactions own
  // the text after that.
  useEffect(() => {
    const live = String((rec && rec.text) || "");
    if (live && !text.trim()) setText(live);
  }, [rec && rec.text]); // eslint-disable-line

  // PROCESS a binary source so Citey can actually scan it (and, for a PDF, redact
  // ON it): pull a PDF's text + layout, OCR an image, or decode a text file. This
  // is the fix that stops a PDF/scan from falling straight to "paste it yourself"
  // — the browser can read it, so it should. Does the work once per open.
  useEffect(() => {
    if (!rec || !SVk) return;
    let alive = true;
    if (isPdf && SVk.extractPdfLayout) {
      setDocLoad({ state: "reading" });
      SVk.extractPdfLayout(rec).then(lay => {
        if (!alive) return;
        setLayout(lay);
        if (lay && lay.text && !String(rec.text || "").trim()) { rec.text = lay.text; setText(lay.text); }
        setDocLoad(null);
      }).catch(e => { if (alive) setDocLoad({ state: "fail", err: (e && e.message) || "Couldn't read the PDF." }); });
    } else if (!String(rec.text || "").trim() && SVk.ensureText && (kind === "image" || kind === "text") && !(kind === "image" && rec.ocrOff)) {
      setDocLoad({ state: "reading" });
      SVk.ensureText(rec).then(t => {
        if (!alive) return;
        if (t && t.trim()) { rec.text = t; if (kind === "image") rec.binary = false; setText(t); }
        setDocLoad(null);
      }).catch(() => { if (alive) setDocLoad(null); });
    }
    return () => { alive = false; };
  }, [srcKey]); // eslint-disable-line

  if (!rec || !PII) return null;

  // Ensure the review envelope exists the moment Citey opens on a source.
  if (!rec.piiReview) rec.piiReview = { state: "pending", basis: PII.BASIS, scannedAt: rxNowIso(), redactions: [], affirmations: [] };

  const reading = !!(docLoad && docLoad.state === "reading");
  const pdfReady = isPdf && !!layout && !!window.PdfRedactView;     // can render + redact on the page
  const pdfFailed = isPdf && !!(docLoad && docLoad.state === "fail");
  // "opaque" = nothing to scan AND nothing to render → the paste-or-affirm fallback.
  // A PDF we could open is never opaque: even a scan (no text layer) gets the page
  // redactor. Only a PDF we genuinely couldn't read falls back here.
  const opaque = pdfFailed || (!isPdf && rxIsOpaque(rec) && !text.trim());

  // PENDING = every live finding not already kept-on-purpose. Recomputed from the
  // (possibly redacted/edited) text each render — a hard redaction is █, so it
  // simply stops being found.
  const findings = useMemo(() => (text.trim() ? (PII.detect(text) || []) : []), [text]);
  const pending = useMemo(() => findings.filter(f => !kept.some(k => f.start < k.end && k.start < f.end)), [findings, kept]);
  const summary = useMemo(() => PII.summarize(pending), [pending]);
  const cleared = !opaque && pending.length === 0;

  const colorFor = (band) => band === "high" ? "var(--reject)" : band === "medium" ? "var(--review)" : "var(--ink-soft)";

  // ---- the mutators: every one writes through to the live source record ----
  function persistReview() { setText(String(rec.text || "")); bump(v => v + 1); }

  // Add boxes to the set burned into the archived PDF (deduped, written through).
  function pushBoxes(newBoxes) {
    if (!isPdf || !newBoxes || !newBoxes.length || !SVk) return;
    const merged = (SVk.dedupeBoxes ? SVk.dedupeBoxes((rec.piiReview.pdfBoxes || []).concat(newBoxes)) : (rec.piiReview.pdfBoxes || []).concat(newBoxes));
    rec.piiReview.pdfBoxes = merged;
    setPdfBoxes(merged);
  }
  function redactRange(start, end, type, basis) {
    if (!(end > start)) return;
    rec.text = PII.redactText(rec.text, [{ start, end }]);
    rec.piiReview.redactions.push({ type: type || "MANUAL", basis: basis || (PII.BASIS + ":manual"), start, end, length: end - start, at: rxNowIso(), by: rxMe() });
    // a PDF text redaction also burns a black box over the run on the page
    if (layout && SVk && SVk.rangesToBoxes) pushBoxes(SVk.rangesToBoxes(layout.items, [{ start, end }]));
    rec.piiReview.state = "pending";  // a fresh redaction re-opens the affirmation, by design
    setSel(null);
    persistReview();
  }
  function redactFinding(f) { redactRange(f.start, f.end, f.type, f.basis); }
  // A box drawn on the page: burn it AND scrub the words under it out of the text
  // shadow (so the gate, the count and the published text agree with the picture).
  // A box over a picture/signature with no text under it logs as a content-free
  // area redaction. Hard + permanent, like the rest of the review.
  function redactBox(box) {
    if (!box || !isPdf) return;
    pushBoxes([box]);
    let ranges = (layout && SVk && SVk.boxesToRanges) ? SVk.boxesToRanges(layout.items, [box]) : [];
    if (ranges.length) {
      rec.text = PII.redactText(rec.text, ranges);
      ranges.forEach(r => rec.piiReview.redactions.push({ type: "AREA", basis: PII.BASIS + ":area", start: r.start, end: r.end, length: r.end - r.start, at: rxNowIso(), by: rxMe() }));
    } else {
      rec.piiReview.redactions.push({ type: "AREA", basis: PII.BASIS + ":area", area: true, at: rxNowIso(), by: rxMe() });
    }
    rec.piiReview.state = "pending";
    persistReview();
  }
  function keepFinding(f) {
    rec.piiReview.affirmations.push({ type: f.type, basis: f.basis, start: f.start, end: f.end, at: rxNowIso(), by: rxMe() });
    setKept(ks => [...ks, { start: f.start, end: f.end, type: f.type }]);
  }
  function redactAllHigh() {
    const hi = pending.filter(f => PII.band(f.score) === "high").sort((a, b) => b.start - a.start);
    if (!hi.length) return;
    hi.forEach(f => { rec.text = PII.redactText(rec.text, [{ start: f.start, end: f.end }]); rec.piiReview.redactions.push({ type: f.type, basis: f.basis, start: f.start, end: f.end, length: f.end - f.start, at: rxNowIso(), by: rxMe() }); });
    if (layout && SVk && SVk.rangesToBoxes) pushBoxes(SVk.rangesToBoxes(layout.items, hi.map(f => ({ start: f.start, end: f.end }))));
    persistReview();
  }
  function keepAll() {
    const at = rxNowIso(), by = rxMe();
    pending.forEach(f => rec.piiReview.affirmations.push({ type: f.type, basis: f.basis, start: f.start, end: f.end, at, by }));
    setKept(ks => [...ks, ...pending.map(f => ({ start: f.start, end: f.end, type: f.type }))]);
  }

  // broad document editing — free-edit the whole text, then re-scan
  function openEdit() { setDraft(rec.text || ""); setEditing(true); }
  function applyEdit() {
    rec.text = String(draft || "");
    rec.piiReview.affirmations = [];          // offsets are stale after a free edit — re-decide
    rec.piiReview.state = "pending";
    setKept([]); setEditing(false); persistReview();
  }

  // paste text into an opaque file so Citey can actually scan it
  function seedText() {
    const t = paste.trim(); if (!t) return;
    rec.text = (rec.text ? rec.text + "\n" : "") + t;
    rec.binary = false; setPaste(""); persistReview();
  }

  function markReviewed() {
    rec.piiReview.state = "reviewed";
    rec.piiReview.reviewedAt = rxNowIso();
    rec.piiReview.by = rxMe();
    rec.piiReview.findingsAtReview = pending.length;
    bump(v => v + 1);
    if (onDone) onDone(rec); else if (onClose) onClose();
  }
  function affirmOpaque() {            // opaque file: no text to scan, human vouches
    rec.piiReview.opaqueAffirmed = true;
    markReviewed();
  }

  // Build the REDACTED PDF (boxes burned into rasterized pages) and store it on the
  // record, so it ships to archive.org IN PLACE OF the un-redacted original. Best-
  // effort: if it can't be built or durably stored (signed out / offline), we say
  // so and fall back to withholding the original (publishableSource handles both).
  async function buildRedactedArtifact() {
    if (!SVk || !SVk.buildRedactedPdf) return false;
    try {
      setBuilding({ state: "building", done: 0, total: (layout && layout.pageCount) || 1 });
      const blob = await SVk.buildRedactedPdf(rec, pdfBoxes, { onProgress: (d, t) => setBuilding({ state: "building", done: d, total: t }) });
      const name = String(rec.filename || rec.title || "document").replace(/\.pdf$/i, "") + "-redacted.pdf";
      let up = null;
      const M = window.NpjMedia;
      if (M && M.canUpload && M.canUpload()) {
        const file = (typeof File !== "undefined") ? new File([blob], name, { type: "application/pdf" }) : blob;
        try { up = await M.upload(file, name); } catch (e) { up = null; }
      }
      if (up && up.url) {
        rec.piiReview.redactedFile = { url: up.url, mxc: up.mxc || "", name, at: rxNowIso(), by: rxMe(), boxes: pdfBoxes.length };
        setBuilding({ state: "done" });
        return true;
      }
      rec.piiReview.redactedFile = null;   // couldn't store it durably → withhold the original
      setBuilding({ state: "nostore" });
      return false;
    } catch (e) {
      rec.piiReview.redactedFile = null;
      setBuilding({ state: "fail", err: (e && e.message) || "Couldn't build the redacted PDF." });
      return false;
    }
  }
  async function buildAndFinish() {
    const ok = await buildRedactedArtifact();
    if (ok) markReviewed();    // on failure, the footer shows Retry / Finish-anyway
  }

  // ---- drag-select in the rendered body → offsets into `text` (SourcePicker idiom) ----
  function onBodyMouseUp() {
    const s = window.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) { return; }
    const r = s.getRangeAt(0), cont = bodyRef.current;
    if (!cont || !cont.contains(r.commonAncestorContainer)) return;
    const quote = r.toString(); if (!quote.trim()) return;
    const pre = document.createRange(); pre.setStart(cont, 0); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    setSel({ start, end: start + quote.length, quote });
  }

  // ---- render the document with pending (orange) + kept (muted) marks ----
  function renderBody() {
    const marks = []
      .concat(pending.map(f => ({ ...f, _k: "p" })))
      .concat(kept.map(k => ({ ...k, _k: "k", label: (PII.PACK.find(p => p.type === k.type) || {}).label || k.type })))
      .sort((a, b) => a.start - b.start);
    const out = []; let cur = 0;
    marks.forEach((m, i) => {
      if (m.start < cur) return;               // safety: skip an overlap we can't render cleanly
      if (m.start > cur) out.push(React.createElement("span", { key: "t" + i }, text.slice(cur, m.start)));
      const isP = m._k === "p";
      out.push(React.createElement("mark", {
        key: "m" + i,
        title: (isP ? "Flagged: " : "Kept public: ") + (m.label || m.type),
        style: {
          background: isP ? "color-mix(in srgb, var(--review) 30%, transparent)" : "transparent",
          color: "var(--ink)", borderBottom: isP ? "2px solid var(--review)" : "1px dotted var(--ink-soft)",
          borderRadius: 2, padding: "0 1px", cursor: "default"
        }
      }, text.slice(m.start, m.end)));
      cur = m.end;
    });
    if (cur < text.length) out.push(React.createElement("span", { key: "tail" }, text.slice(cur)));
    return out;
  }

  const headState = cleared ? "verum" : "suspicious";
  const hd = S ? S.describe(headState) : { glyph: "⊥", color: "var(--review)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.74)", zIndex: 5200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="fade-in">
      {/* color is pinned: the modal mounts inside the newsroom, whose dark mode sets a
          light text color on the whole tree — unreadable on this light card */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px,96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--card)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "2px solid var(--ink)", background: "var(--yellow)" }}>
          <I.shield style={{ fontSize: 24, color: hd.color, flex: "0 0 auto" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 20, lineHeight: 1 }}>Review for PII</div>
            <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.title || srcKey}{rec.outlet ? " · " + rec.outlet : ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        {/* basis line — honest about what Citey is and isn't */}
        <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", padding: "8px 18px 0", lineHeight: 1.5 }}>
          {PII.BASIS} · mechanical recognizers, no model · data-shaped PII only (phones, SSNs, cards, addresses — it won't guess names; drag-select a name to redact it). A first pass, never a guarantee. Archiving to archive.org is permanent and can't be undone.
        </div>

        {/* scrolling content */}
        <div className="np-scroll" style={{ overflowY: "auto", padding: "12px 18px 4px", flex: 1, minHeight: 0 }}>
          {opaque ? (
            /* ---- opaque file: paste-to-scan, or affirm ---- */
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "color-mix(in srgb, var(--review) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--review) 36%, transparent)", marginBottom: 12 }}>
                <I.warning style={{ fontSize: 18, color: "var(--review)", flex: "0 0 auto", marginTop: 1 }} />
                <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-soft)" }}>{RX_SAY.binary}</div>
              </div>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder="Paste the document's text here and it'll be scanned…"
                style={{ width: "100%", resize: "vertical", border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, padding: "9px 10px", outline: "none", boxSizing: "border-box" }} />
              <button className="btn btn-sm btn-primary" onClick={seedText} disabled={!paste.trim()} style={{ marginTop: 8, opacity: paste.trim() ? 1 : .5 }}>Scan pasted text</button>
            </div>
          ) : reading ? (
            /* ---- processing a PDF / scan / text file so Citey can read it ---- */
            <div className="np-mono" style={{ padding: "34px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 12 }}>
              <span style={{ width: 14, height: 14, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-2px", marginRight: 6 }} />
              {isPdf ? "reading the document…" : "reading the file…"}
            </div>
          ) : (
            <React.Fragment>
              {/* Citey's line + summary */}
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, color: "var(--ink)", flex: 1 }}>
                  {cleared
                    ? (rec.piiReview.redactions.length || kept.length ? "all flagged spans handled. read it once more, then mark it reviewed." : (isPdf && !text.trim() ? "No text layer (a scan). Draw a box over anything that should be hidden, then mark it reviewed." : RX_SAY.clean))
                    : RX_SAY.some(pending.length)}
                </div>
              </div>

              {pending.length > 0 && (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
                  {summary.map(s => (
                    <span key={s.type} className="np-mono" style={{ fontSize: 10.5, border: "1px solid var(--rule)", padding: "2px 8px", color: colorFor(PII.band(s.max)) }}>{s.count}× {s.label}</span>
                  ))}
                </div>
              )}

              {/* PDF: redact ON the real page — draw boxes that burn into the archived copy */}
              {isPdf && pdfReady && (
                <window.PdfRedactView rec={rec} boxes={pdfBoxes} onRedactBox={redactBox} height={300} />
              )}
              {isPdf && !pdfReady && (
                <div className="np-mono" style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink-soft)", padding: "12px 14px", fontSize: 11.5, lineHeight: 1.5 }}>
                  Couldn’t render this PDF in the browser, so it can’t be redacted on the page here. Redact any flagged spans below, or open it to check it.
                </div>
              )}

              {/* the document — drag-select to redact anything Citey missed (non-PDF) */}
              {!isPdf && !editing && (
                <div ref={bodyRef} onMouseUp={onBodyMouseUp} className="np-scroll"
                  style={{ maxHeight: 230, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--rule)", padding: "10px 12px", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.6, userSelect: "text", cursor: "text" }}>
                  {text.trim() ? renderBody() : <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>No text on record. Use “Edit document” to add it, or paste a passage.</span>}
                </div>
              )}

              {/* broad free-edit (non-PDF: editing PDF text would desync the page boxes) */}
              {!isPdf && editing && (
                <div>
                  <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 4 }}>Edit the document freely. Saving re-scans for PII; redactions you’ve already applied stay applied.</div>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12}
                    style={{ width: "100%", resize: "vertical", border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.6, padding: "10px 12px", outline: "none", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn btn-sm btn-primary" onClick={applyEdit}>Save &amp; re-scan</button>
                    <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {/* floating: redact the current drag-selection */}
              {!editing && sel && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "7px 9px", border: "1px solid var(--ink)", background: "var(--card)" }}>
                  <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>selection: “{rxClip(sel.quote, 50)}”</span>
                  <button className="btn btn-sm" onClick={() => setSel(null)}>Cancel</button>
                  <button className="btn btn-sm btn-primary" onClick={() => redactRange(sel.start, sel.end, "MANUAL", PII.BASIS + ":manual")} style={{ background: "var(--reject)", borderColor: "var(--reject)", color: "#fff" }}>■ Redact selection</button>
                </div>
              )}

              {/* bulk actions */}
              {!editing && pending.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 6px" }}>
                  {pending.some(f => PII.band(f.score) === "high") && <button className="btn btn-sm" onClick={redactAllHigh} style={{ borderColor: "var(--reject)", color: "var(--reject)" }}>■ Redact all high-confidence</button>}
                  <button className="btn btn-sm" onClick={keepAll}>Keep all public</button>
                  <span style={{ flex: 1 }} />
                  {!isPdf && <button className="btn btn-sm btn-ghost" onClick={openEdit}>✎ Edit document</button>}
                </div>
              )}
              {!editing && !isPdf && pending.length === 0 && (
                <div style={{ display: "flex", gap: 8, margin: "12px 0 6px" }}>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-ghost" onClick={openEdit}>✎ Edit document</button>
                </div>
              )}

              {/* per-finding decisions */}
              {!editing && pending.map((f, i) => (
                <div key={f.type + f.start + "-" + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                  <span className="np-mono" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".04em", color: colorFor(PII.band(f.score)), width: 96, flex: "0 0 auto" }}>{f.label}</span>
                  <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.text}</span>
                  <span className="np-mono" title={"confidence · " + f.basis} style={{ fontSize: 9, color: "var(--ink-soft)", flex: "0 0 auto" }}>{PII.band(f.score)}{f.context ? " · ctx" : ""}</span>
                  <button className="btn btn-sm" onClick={() => keepFinding(f)} title="Keep this public — affirm it doesn’t need redacting" style={{ flex: "0 0 auto" }}>Keep</button>
                  <button className="btn btn-sm btn-primary" onClick={() => redactFinding(f)} title="Hard-redact — destroys it in what gets archived" style={{ flex: "0 0 auto", background: "var(--reject)", borderColor: "var(--reject)", color: "#fff" }}>■ Redact</button>
                </div>
              ))}

              {/* kept (affirmed-public) roll-up */}
              {kept.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--rule)", paddingTop: 8 }}>
                  <button onClick={() => setShowKept(s => !s)} className="np-mono" style={{ background: "none", border: 0, cursor: "pointer", fontSize: 10.5, color: "var(--ink-soft)", padding: 0 }}>
                    {showKept ? "▾" : "▸"} {kept.length} kept public (affirmed)
                  </button>
                  {showKept && kept.map((k, i) => (
                    <div key={i} className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", padding: "3px 0 3px 14px" }}>· {rxClip(text.slice(k.start, k.end), 60)}</div>
                  ))}
                </div>
              )}
            </React.Fragment>
          )}
        </div>

        {/* footer / the gate */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderTop: "1.5px solid var(--ink)" }}>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", flex: 1, minWidth: 0 }}>
            {rec.piiReview.redactions.length}× redacted · {(rec.piiReview.affirmations || []).length}× kept
          </span>
          {opaque ? (
            <React.Fragment>
              <button className="btn btn-sm" onClick={onClose}>Later</button>
              <button className="btn btn-sm btn-primary" onClick={affirmOpaque} title="Vouch that you’ve checked this file and it carries no PII">I’ve checked it — no PII</button>
            </React.Fragment>
          ) : building && building.state === "building" ? (
            <button className="btn btn-sm btn-primary" disabled style={{ opacity: .7, cursor: "wait" }}>
              Building redacted PDF… {building.total ? building.done + "/" + building.total : ""}
            </button>
          ) : building && (building.state === "fail" || building.state === "nostore") ? (
            <React.Fragment>
              <span className="np-mono" style={{ fontSize: 9.5, color: "var(--reject)", flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                {building.state === "fail"
                  ? ((building.err || "Couldn't build the redacted PDF.") + " You can retry, or finish — the original is withheld and only scrubbed text is archived.")
                  : "Sign in to store the redacted PDF. Finish now and the original is withheld; only scrubbed text is archived."}
              </span>
              <button className="btn btn-sm" onClick={buildAndFinish}>Retry</button>
              <button className="btn btn-sm btn-primary" onClick={markReviewed} title="Finish — the un-redacted original is withheld from the archive">Finish anyway</button>
            </React.Fragment>
          ) : isPdf && pdfBoxes.length ? (
            <React.Fragment>
              <button className="btn btn-sm" onClick={onClose} title="Defer — you can review before you archive">Later</button>
              <button className="btn btn-sm btn-primary" onClick={buildAndFinish} disabled={!cleared} title={cleared ? "Burn the redactions into a PDF and clear the gate" : "Redact or keep every flagged span first"} style={{ opacity: cleared ? 1 : .5, cursor: cleared ? "pointer" : "not-allowed" }}>
                {cleared ? "✓ Build redacted PDF & finish" : pending.length + " left to decide"}
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <button className="btn btn-sm" onClick={onClose} title="Defer — you can review before you archive">Later</button>
              <button className="btn btn-sm btn-primary" onClick={markReviewed} disabled={!cleared} title={cleared ? "Clear the archive gate" : "Redact or keep every flagged span first"} style={{ opacity: cleared ? 1 : .5, cursor: cleared ? "pointer" : "not-allowed" }}>
                {cleared ? "✓ Mark reviewed — clears the gate" : pending.length + " left to decide"}
              </button>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

window.CiteyRedactModal = CiteyRedactModal;
if (typeof module !== "undefined" && module.exports) module.exports = { CiteyRedactModal };
