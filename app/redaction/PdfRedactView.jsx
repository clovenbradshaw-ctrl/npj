/* ============================================================
   PdfRedactView.jsx — redact ON the real PDF page. NO MODEL.

   PdfView renders a PDF so you can SELECT and cite it. This is its sibling for
   Citey's archive gate: render the same pages and let the author BLACK OUT a
   region by dragging a box over it — over a name, a face, a signature, a stamp,
   a scanned line the recognizers can't read. Each box is reported up (normalized
   to the page, so it survives any zoom/scale) and, when the source is archived,
   burned into a rasterized copy of that page (NpjSourceView.buildRedactedPdf) so
   the withheld pixels are GONE from the document that reaches archive.org.

   It also shows the redactions already on the record — whether drawn here or
   mapped from a text redaction in the review — as solid black boxes, so the
   author always sees exactly what the published PDF will hide.

   Pages render lazily (IntersectionObserver) like PdfView; redaction is a hard,
   permanent act here, matching the rest of Citey's review (there's no un-redact).

   Mounts: <PdfRedactView rec boxes={[{page,x,y,w,h}]} onRedactBox={(box)=>…} height />.
   onRedactBox fires on mouse-up with a normalized box. Publishes window.PdfRedactView.
   ============================================================ */
function PdfRedactView({ rec, boxes, onRedactBox, height }) {
  const SV = window.NpjSourceView;
  const hostRef = useRef(null);
  const ioRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [err, setErr] = useState(null);
  const key = (rec && (rec.id || rec.key)) || "";
  const H = height || 460;
  const liveBoxes = boxes || [];

  // share PdfView's text-layer/area CSS (the region box + crosshair) if it's loaded;
  // otherwise nothing here depends on it — our boxes carry their own inline styles.

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

  // lay pages out + render them as they scroll into view (PdfView's lazy idiom)
  useEffect(() => {
    if (!doc || !hostRef.current) return;
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
        paintBoxes(pageEl, n);   // overlay any redactions already on this page
      } catch (e) { /* a single bad page shouldn't kill the doc */ }
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target, n = Number(el.dataset.page), sc = Number(el.dataset.scale);
          io.unobserve(el); renderPage(n, el, sc);
        }
      });
    }, { root: host, rootMargin: "400px 0px" });
    ioRef.current = io;

    (async () => {
      const max = Math.min(doc.numPages, 600);
      for (let n = 1; n <= max; n++) {
        if (cancelled) return;
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = cssWidth / base.width;
        const vp = page.getViewport({ scale });
        const pageEl = document.createElement("div");
        pageEl.className = "npj-redact-page";
        pageEl.dataset.page = String(n); pageEl.dataset.scale = String(scale);
        pageEl.style.cssText = "position:relative;margin:0 auto 10px;width:" + vp.width + "px;height:" + vp.height + "px;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.22);cursor:crosshair;";
        host.appendChild(pageEl);
        io.observe(pageEl);
        if (n === 1) renderPage(1, pageEl, scale);
      }
    })();

    return () => { cancelled = true; try { io.disconnect(); } catch (e) {} try { host.innerHTML = ""; } catch (e) {} };
  }, [doc]); // eslint-disable-line

  // Paint the committed redaction boxes onto one page element. Percentage-based so
  // it's independent of the render scale. Idempotent — clears its own marks first.
  function paintBoxes(pageEl, n) {
    pageEl.querySelectorAll(".npj-redact-box").forEach(el => el.remove());
    liveBoxes.filter(b => Number(b.page) === Number(n)).forEach(b => {
      const d = document.createElement("div");
      d.className = "npj-redact-box";
      d.style.cssText = "position:absolute;left:" + (b.x * 100) + "%;top:" + (b.y * 100) + "%;width:" + (b.w * 100) + "%;height:" + (b.h * 100) + "%;background:#000;z-index:2;pointer-events:none;";
      pageEl.appendChild(d);
    });
  }

  // Re-paint every rendered page whenever the box set changes (a new draw, or a
  // text redaction mapped to boxes elsewhere in the review).
  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    host.querySelectorAll(".npj-redact-page").forEach(pageEl => {
      if (pageEl.querySelector("canvas")) paintBoxes(pageEl, Number(pageEl.dataset.page));
    });
  }, [boxes]); // eslint-disable-line

  // drag a box on a page → normalized {page,x,y,w,h} → onRedactBox. DOM-level so the
  // lazy, imperative page host stays the source of truth (React never re-lays pages).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready" || !onRedactBox) return;
    let drag = null;
    const pageOf = (t) => (t && t.closest) ? t.closest(".npj-redact-page") : null;
    const onDown = (e) => {
      const pageEl = pageOf(e.target); if (!pageEl || !pageEl.querySelector("canvas")) return;
      e.preventDefault();
      host.querySelectorAll(".npj-redact-live").forEach(el => el.remove());
      const r = pageEl.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "npj-redact-live";
      box.style.cssText = "position:absolute;background:rgba(0,0,0,.55);border:1px dashed #fff;z-index:3;pointer-events:none;";
      pageEl.appendChild(box);
      drag = { pageEl, r, ox: e.clientX - r.left, oy: e.clientY - r.top, box, cur: null };
      sizeBox(e.clientX, e.clientY);
    };
    const sizeBox = (cx, cy) => {
      if (!drag) return;
      const x2 = Math.max(0, Math.min(drag.r.width, cx - drag.r.left));
      const y2 = Math.max(0, Math.min(drag.r.height, cy - drag.r.top));
      const x = Math.min(drag.ox, x2), y = Math.min(drag.oy, y2);
      const w = Math.abs(x2 - drag.ox), h = Math.abs(y2 - drag.oy);
      drag.box.style.left = x + "px"; drag.box.style.top = y + "px";
      drag.box.style.width = w + "px"; drag.box.style.height = h + "px";
      drag.cur = { x, y, w, h };
    };
    const onMove = (e) => { if (drag) sizeBox(e.clientX, e.clientY); };
    const onUp = () => {
      if (!drag) return;
      const d = drag; drag = null;
      const cur = d.cur;
      d.box.remove();
      if (!cur || cur.w < 6 || cur.h < 6) return;   // ignore an accidental click/tiny drag
      const W = d.r.width || 1, Hh = d.r.height || 1;
      onRedactBox({
        page: Number(d.pageEl.dataset.page),
        x: cur.x / W, y: cur.y / Hh, w: cur.w / W, h: cur.h / Hh,
      });
    };
    host.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { host.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [status, onRedactBox, doc]); // eslint-disable-line

  const Spin = () => <span style={{ width: 13, height: 13, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-2px" }} />;
  const url = rec && (rec.file_url || rec.archive_url || rec.original_url);

  return (
    <div>
      {status === "loading" && <div className="np-mono" style={{ padding: "26px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 11.5 }}><Spin /> rendering the document…</div>}
      {status === "error" && (
        <div style={{ border: "1px solid var(--reject)", background: "var(--paper)", color: "var(--reject)", padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.5 }}>
          {err}
          {url && <div style={{ marginTop: 8 }}><a href={url} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline" }}>Open the PDF ↗</a></div>}
        </div>
      )}
      {status === "ready" && onRedactBox && (
        <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "0 0 6px", lineHeight: 1.4 }}>
          Drag a box over anything to black it out — it's burned into the archived copy. Redaction here is permanent.
        </div>
      )}
      <div ref={hostRef} className="np-scroll"
        style={{ maxHeight: H, overflowY: "auto", overflowX: "auto", background: "#3a3a3c", padding: "10px 8px", display: status === "ready" ? "block" : "none" }} />
    </div>
  );
}
window.PdfRedactView = PdfRedactView;
