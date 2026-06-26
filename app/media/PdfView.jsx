/* ============================================================
   PdfView.jsx — render a PDF as the REAL document, selectably.

   Extracting a PDF to plain text flattens a form (a 990, a filing) into an
   unreadable wall. Instead this renders each page to a <canvas> (the normal-
   looking document) with pdf.js's transparent TEXT LAYER positioned exactly on
   top — so you read the real page AND can drag-select words on it. The selection
   lives in the page, not in a cross-origin iframe, so we can read exactly what
   was grabbed and hand it back as the citation quote.

   SCANNED documents have no text layer — there's nothing to drag-select, which
   is the "I'm trying but it won't grab" trap. So there's a second mode: SELECT
   AREA. Drag a box over the page, we crop that region off the canvas and OCR
   just those words (NpjSourceView.ocrImage, the shared tesseract worker) and
   hand the text back the SAME way a text selection does — onSelectText — so
   every caller works on a scan with no extra wiring. Area mode turns on by
   itself when the first page has no text layer.

   Pages render lazily (IntersectionObserver) so a 50-page filing stays smooth.
   pdf.js loads on demand via NpjSourceView.ensurePdfJs (UMD, same CDN as React).

   Mounts: <PdfView rec height onSelectText={(quote) => …} />.
   onSelectText fires on mouse-up with the selected (or OCR'd) text.
   Publishes window.PdfView.
   ============================================================ */
function PdfView({ rec, height, onSelectText }) {
  const SV = window.NpjSourceView;
  const hostRef = useRef(null);
  const cleanupRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [err, setErr] = useState(null);
  const [url, setUrl] = useState(null);
  const [hasText, setHasText] = useState(null);     // null unknown | true | false (scanned)
  const [mode, setMode] = useState("text");          // text | area
  const [ocr, setOcr] = useState(null);              // {state:'reading'|'done'|'fail', text?}
  const userPicked = useRef(false);                  // did the author choose a mode by hand?
  const key = (rec && (rec.id || rec.key)) || "";
  const H = height || 460;

  // inject the text-layer + area-select CSS once — self-contained, no styles.css coupling
  ensurePdfCss();

  // a fallback link for the error state
  useEffect(() => { let a = true; if (SV) SV.displayUrl(rec).then(u => { if (a) setUrl(u); }).catch(() => {}); return () => { a = false; }; }, [key]); // eslint-disable-line

  // load the document
  useEffect(() => {
    let alive = true;
    setStatus("loading"); setErr(null); setDoc(null); setHasText(null); setOcr(null);
    (async () => {
      try {
        if (!SV || !SV.ensurePdfJs) throw new Error("PDF reader unavailable.");
        const lib = await SV.ensurePdfJs();
        const blob = await SV.bytesFor(rec);
        if (!blob) throw new Error("Could not read the file — re-upload it, or sign in again.");
        const buf = await blob.arrayBuffer();
        const pdf = await lib.getDocument({ data: buf }).promise;
        if (alive) { setDoc(pdf); setStatus("ready"); } else { try { pdf.destroy(); } catch (e) {} }
      } catch (e) { if (alive) { setErr((e && e.message) || "Couldn't open the PDF."); setStatus("error"); } }
    })();
    return () => { alive = false; };
  }, [key, rec && rec.file_url]); // eslint-disable-line

  // lay pages out + render them as they scroll into view
  useEffect(() => {
    if (!doc || !hostRef.current) return;
    const lib = window.pdfjsLib;
    const host = hostRef.current;
    host.innerHTML = "";
    let cancelled = false;
    const done = {};
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = Math.max(280, (host.clientWidth || 620) - 18);

    async function renderPage(n, pageEl, scale) {
      if (cancelled || done[n]) return; done[n] = true;
      try {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.cssText = "width:" + vp.width + "px;height:" + vp.height + "px;display:block;";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        pageEl.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;
        const tl = document.createElement("div");
        tl.className = "npj-pdf-textlayer";
        tl.style.cssText = "position:absolute;left:0;top:0;width:" + vp.width + "px;height:" + vp.height + "px;";
        pageEl.appendChild(tl);
        const tc = await page.getTextContent();
        // how much real text does this page carry? a scanned page has ~none —
        // that's the signal to default into area-select instead of text-select.
        const nChars = (tc.items || []).reduce((a, it) => a + ((it.str || "").trim() ? it.str.length : 0), 0);
        if (nChars > 12) setHasText(true);
        else if (n === 1) setHasText(prev => (prev === true ? true : false));
        try {
          const task = lib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] });
          await (task && task.promise ? task.promise : task);
        } catch (e) {
          // older pdf.js signature
          try { const task2 = lib.renderTextLayer({ textContent: tc, container: tl, viewport: vp, textDivs: [] }); await (task2 && task2.promise ? task2.promise : task2); } catch (e2) {}
        }
      } catch (e) { /* a single bad page shouldn't kill the doc */ }
    }

    (async () => {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            const el = e.target, n = Number(el.dataset.page), sc = Number(el.dataset.scale);
            io.unobserve(el); renderPage(n, el, sc);
          }
        });
      }, { root: host, rootMargin: "400px 0px" });
      cleanupRef.current = () => { try { io.disconnect(); } catch (e) {} };
      const max = Math.min(doc.numPages, 600);
      for (let n = 1; n <= max; n++) {
        if (cancelled) return;
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = cssWidth / base.width;
        const vp = page.getViewport({ scale });
        const pageEl = document.createElement("div");
        pageEl.className = "npj-pdf-page";
        pageEl.dataset.page = String(n); pageEl.dataset.scale = String(scale);
        pageEl.style.cssText = "position:relative;margin:0 auto 10px;width:" + vp.width + "px;height:" + vp.height + "px;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.22);";
        host.appendChild(pageEl);
        io.observe(pageEl);
        if (n === 1) renderPage(1, pageEl, scale); // first page immediately
      }
    })();

    return () => { cancelled = true; if (cleanupRef.current) cleanupRef.current(); try { host.innerHTML = ""; } catch (e) {} };
  }, [doc]); // eslint-disable-line

  // a scanned doc (no text layer) flips to area-select on its own — unless the
  // author has already chosen a mode by hand
  useEffect(() => { if (hasText === false && !userPicked.current && onSelectText) setMode("area"); }, [hasText, onSelectText]);

  // text mode: hand back the drag-selected words verbatim
  const onMouseUp = () => {
    if (mode !== "text" || !onSelectText) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const q = String(sel.toString() || "").replace(/\s+/g, " ").trim();
    if (q.length < 3) return;
    onSelectText(q);
  };

  // area mode: drag a box on a page → crop that region off the canvas → OCR just
  // those words → hand them back like a text selection. DOM-level so the lazy,
  // imperative page host stays the source of truth (React never re-renders pages).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready" || mode !== "area" || !onSelectText) return;
    let drag = null;
    const pageOf = (t) => (t && t.closest) ? t.closest(".npj-pdf-page") : null;
    const onDown = (e) => {
      const pageEl = pageOf(e.target); if (!pageEl) return;
      const canvas = pageEl.querySelector("canvas"); if (!canvas) return;
      e.preventDefault();
      host.querySelectorAll(".npj-pdf-region").forEach(el => el.remove());
      const r = pageEl.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "npj-pdf-region npj-pdf-region-live";
      pageEl.appendChild(box);
      drag = { pageEl, canvas, r, ox: e.clientX - r.left, oy: e.clientY - r.top, box, cur: null };
      sizeBox(e.clientX, e.clientY);
    };
    const sizeBox = (cx, cy) => {
      if (!drag) return;
      const x2 = Math.max(0, Math.min(drag.r.width, cx - drag.r.left));
      const y2 = Math.max(0, Math.min(drag.r.height, cy - drag.r.top));
      const x = Math.min(drag.ox, x2), y = Math.min(drag.oy, y2);
      const w = Math.abs(x2 - drag.ox), h = Math.abs(y2 - drag.oy);
      drag.box.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;";
      drag.cur = { x, y, w, h };
    };
    const onMove = (e) => { if (drag) sizeBox(e.clientX, e.clientY); };
    const onUp = () => {
      if (!drag) return;
      const d = drag; drag = null;
      d.box.classList.remove("npj-pdf-region-live");
      const cur = d.cur;
      if (!cur || cur.w < 6 || cur.h < 6) { d.box.remove(); return; }
      let preview = "";
      try {
        const cssW = parseFloat(d.canvas.style.width) || d.canvas.clientWidth || d.r.width;
        const cssH = parseFloat(d.canvas.style.height) || d.canvas.clientHeight || d.r.height;
        const sx = d.canvas.width / cssW, sy = d.canvas.height / cssH;
        const tmp = document.createElement("canvas");
        tmp.width = Math.max(1, Math.round(cur.w * sx));
        tmp.height = Math.max(1, Math.round(cur.h * sy));
        tmp.getContext("2d").drawImage(d.canvas, cur.x * sx, cur.y * sy, cur.w * sx, cur.h * sy, 0, 0, tmp.width, tmp.height);
        preview = tmp.toDataURL("image/png");
      } catch (e) { /* tainted canvas shouldn't happen — we render locally */ }
      if (!preview || !SV || !SV.ocrImage) { setOcr({ state: "fail" }); return; }
      setOcr({ state: "reading" });
      SV.ocrImage(preview).then(t => {
        const text = String(t || "").replace(/\s+/g, " ").trim();
        if (text) { setOcr({ state: "done", text: text }); onSelectText(text); }
        else setOcr({ state: "fail" });
      }).catch(() => setOcr({ state: "fail" }));
    };
    host.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { host.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [status, mode, onSelectText, doc]); // eslint-disable-line

  const pick = (m) => { userPicked.current = true; setMode(m); setOcr(null); };
  const Spin = () => <span style={{ width: 13, height: 13, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-2px" }} />;
  const TabBtn = ({ m, label, hint }) => (
    <button onMouseDown={e => e.preventDefault()} onClick={() => pick(m)} title={hint}
      className="np-cond" style={{ background: mode === m ? "var(--ink)" : "transparent", color: mode === m ? "var(--paper)" : "var(--ink)", border: "1px solid var(--ink)", padding: "3px 9px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" }}>{label}</button>
  );

  return (
    <div>
      {status === "loading" && <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> rendering the document…</div>}
      {status === "error" && (
        <div style={{ border: "1px solid var(--reject)", background: "var(--paper)", color: "var(--reject)", padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.5 }}>
          {err}
          {url && <div style={{ marginTop: 8 }}><a href={url} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline" }}>Open the PDF ↗</a></div>}
        </div>
      )}
      {onSelectText && status === "ready" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 6px", flexWrap: "wrap" }}>
          <span className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", letterSpacing: ".06em" }}>GRAB BY</span>
          <TabBtn m="text" label="Text" hint="Drag-select the words on the page" />
          <TabBtn m="area" label="Area" hint="Draw a box over the page — its words are read by OCR" />
          <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", flex: 1, minWidth: 120 }}>
            {mode === "area"
              ? (ocr && ocr.state === "reading" ? <span style={{ color: "var(--yellow)" }}><Spin /> reading the area…</span>
                : ocr && ocr.state === "fail" ? <span style={{ color: "var(--reject)" }}>couldn't read text there — try a tighter box, or type it</span>
                : ocr && ocr.state === "done" ? <span style={{ color: "var(--verified,#1f8a5b)" }}>✓ grabbed — “{ocr.text.slice(0, 40)}{ocr.text.length > 40 ? "…" : ""}”</span>
                : "Draw a box around the exact words — even on a scan.")
              : (hasText === false ? "No text layer (a scan) — switch to Area to grab it." : "Drag-select the exact words — captured verbatim.")}
          </span>
        </div>
      )}
      <div ref={hostRef} onMouseUp={onMouseUp} className={"np-scroll npj-pdf-host" + (mode === "area" && onSelectText ? " npj-pdf-area" : "")}
        style={{ maxHeight: H, overflowY: "auto", overflowX: "auto", background: "#3a3a3c", padding: "10px 8px", display: status === "ready" ? "block" : "none" }} />
    </div>
  );
}

// transparent selectable glyphs over the rendered canvas; visible selection; and
// the area-select crosshair + region box for scanned pages
function ensurePdfCss() {
  if (typeof document === "undefined" || document.getElementById("npj-pdf-css")) return;
  const s = document.createElement("style");
  s.id = "npj-pdf-css";
  s.textContent =
    ".npj-pdf-textlayer{position:absolute;overflow:hidden;opacity:1;line-height:1;text-align:initial;}" +
    ".npj-pdf-textlayer span,.npj-pdf-textlayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;}" +
    ".npj-pdf-textlayer ::selection{background:rgba(43,95,138,.45);}" +
    ".npj-pdf-textlayer ::-moz-selection{background:rgba(43,95,138,.45);}" +
    ".npj-pdf-host{scroll-behavior:smooth;}" +
    // area mode: the text layer must not eat the drag, and the page reads as grabbable
    ".npj-pdf-area .npj-pdf-textlayer{pointer-events:none;}" +
    ".npj-pdf-area .npj-pdf-page{cursor:crosshair;}" +
    ".npj-pdf-region{position:absolute;border:2px solid var(--yellow,#ffec01);background:rgba(255,236,1,.18);pointer-events:none;z-index:3;}" +
    ".npj-pdf-region-live{border-style:dashed;}";
  document.head.appendChild(s);
}
window.PdfView = PdfView;
