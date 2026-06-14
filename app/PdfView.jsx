/* ============================================================
   PdfView.jsx — render a PDF as the REAL document, selectably.

   Extracting a PDF to plain text flattens a form (a 990, a filing) into an
   unreadable wall. Instead this renders each page to a <canvas> (the normal-
   looking document) with pdf.js's transparent TEXT LAYER positioned exactly on
   top — so you read the real page AND can drag-select words on it. The selection
   lives in the page, not in a cross-origin iframe, so we can read exactly what
   was grabbed and hand it back as the citation quote.

   Pages render lazily (IntersectionObserver) so a 50-page filing stays smooth.
   pdf.js loads on demand via NpjSourceView.ensurePdfJs (UMD, same CDN as React).

   Mounts: <PdfView rec height onSelectText={(quote) => …} />.
   onSelectText fires on mouse-up with the selected text (when provided).
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
  const key = (rec && (rec.id || rec.key)) || "";
  const H = height || 460;

  // inject the text-layer CSS once (transparent glyphs over the canvas, with a
  // visible selection highlight) — self-contained, no styles.css coupling
  ensurePdfCss();

  // a fallback link for the error state
  useEffect(() => { let a = true; if (SV) SV.displayUrl(rec).then(u => { if (a) setUrl(u); }).catch(() => {}); return () => { a = false; }; }, [key]); // eslint-disable-line

  // load the document
  useEffect(() => {
    let alive = true;
    setStatus("loading"); setErr(null); setDoc(null);
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

  const onMouseUp = () => {
    if (!onSelectText) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const q = String(sel.toString() || "").replace(/\s+/g, " ").trim();
    if (q.length < 3) return;
    onSelectText(q);
  };

  const Spin = () => <span style={{ width: 13, height: 13, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-2px" }} />;

  return (
    <div>
      {status === "loading" && <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> rendering the document…</div>}
      {status === "error" && (
        <div style={{ border: "1px solid var(--reject)", background: "var(--paper)", color: "var(--reject)", padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.5 }}>
          {err}
          {url && <div style={{ marginTop: 8 }}><a href={url} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline" }}>Open the PDF ↗</a></div>}
        </div>
      )}
      {onSelectText && status === "ready" && <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "0 0 5px" }}>Drag-select the exact words on the page — your highlight is captured verbatim.</div>}
      <div ref={hostRef} onMouseUp={onMouseUp} className="np-scroll npj-pdf-host"
        style={{ maxHeight: H, overflowY: "auto", overflowX: "auto", background: "#3a3a3c", padding: "10px 8px", display: status === "ready" ? "block" : "none" }} />
    </div>
  );
}

// transparent selectable glyphs over the rendered canvas; visible selection
function ensurePdfCss() {
  if (typeof document === "undefined" || document.getElementById("npj-pdf-css")) return;
  const s = document.createElement("style");
  s.id = "npj-pdf-css";
  s.textContent =
    ".npj-pdf-textlayer{position:absolute;overflow:hidden;opacity:1;line-height:1;text-align:initial;}" +
    ".npj-pdf-textlayer span,.npj-pdf-textlayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;}" +
    ".npj-pdf-textlayer ::selection{background:rgba(43,95,138,.45);}" +
    ".npj-pdf-textlayer ::-moz-selection{background:rgba(43,95,138,.45);}" +
    ".npj-pdf-host{scroll-behavior:smooth;}";
  document.head.appendChild(s);
}
window.PdfView = PdfView;
