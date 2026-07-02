/* ============================================================
   source-view.js — make an uploaded SOURCE viewable (and citable). NO MODEL.

   The gap this closes: an uploaded source used to capture only extracted text
   (and binary uploads — PDFs, images, scans — captured nothing). The bytes lived
   in transient React state and vanished on reload, so the app could never SHOW
   you the document you cited. This module is the plumbing that lets the viewer
   render any uploaded file and lets the citation surfaces read its words:

     • kindOf(rec)        — image | pdf | text | office | unknown, from the
                            record's mime / filename / url.
     • displayUrl(rec)    — a URL an <img>/<iframe> can actually render. Prefers a
                            live just-uploaded blob (session), then the durable
                            media-store file_url (resolved through NpjMedia so an
                            auth-gated homeserver still renders), then an archive /
                            original URL. Async.
     • extractPdfText     — lazily loads pdf.js (UMD, from the same CDN as React)
                            and pulls the text layer out of a PDF so the existing
                            select-to-cite reader works on PDFs too. Cached.
     • the blob registry  — registerBlob(key, blob) keeps the original File for
                            this session (instant preview + a fallback when the
                            media-store upload is still in flight or failed). We
                            never write a blob: URL onto the record (it would
                            persist dead), so this is the only place they live.

   Plain script — publishes window.NpjSourceView. Best-effort throughout: a dead
   fetch or a CDN miss degrades to "preview unavailable", never throws on load.
   ============================================================ */
(function (root) {
  'use strict';

  var doc = root.document;
  function recKey(rec) { return (rec && (rec.id || rec.key)) || ''; }
  function str(x) { return String(x == null ? '' : x); }

  /* ---------------- session blob registry (never persisted) ----------------
     Keyed by source key. Keeps the original File so a just-uploaded source
     previews instantly and survives a media-store upload that's still pending
     or that failed (homeserver hiccup). Cleared only when replaced. */
  var BLOBS = {};
  function registerBlob(key, blob) {
    if (!key || !blob) return null;
    try { if (BLOBS[key] && BLOBS[key].url) URL.revokeObjectURL(BLOBS[key].url); } catch (e) {}
    var url = null;
    try { url = URL.createObjectURL(blob); } catch (e) { url = null; }
    BLOBS[key] = { blob: blob, url: url, type: blob.type || '', name: blob.name || '' };
    return url;
  }
  function blobUrl(key) { return (BLOBS[key] && BLOBS[key].url) || null; }
  function getBlob(key) { return (BLOBS[key] && BLOBS[key].blob) || null; }
  function hasBlob(key) { return !!getBlob(key); }

  /* ---------------- kind detection ---------------- */
  // NB the delimiter accepts whitespace too — hints() joins name + url with a
  // space, so a bare filename like "report.pdf" ends in " " not end-of-string.
  var IMG_RE = /\.(png|jpe?g|webp|avif|gif|bmp|svg|heic|heif|tiff?)(\?|#|\s|$)/i;
  var PDF_RE = /\.pdf(\?|#|\s|$)/i;
  var TEXT_RE = /\.(txt|text|md|markdown|csv|tsv|log|json|xml|html?|rtf|srt|vtt|ini|ya?ml|js|ts|css)(\?|#|\s|$)/i;
  var OFFICE_RE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|pages|numbers|key)(\?|#|\s|$)/i;

  // every string that might carry a type hint for this record
  function hints(rec) {
    rec = rec || {};
    return {
      mime: str(rec.mime || rec.mimetype || (BLOBS[recKey(rec)] && BLOBS[recKey(rec)].type)).toLowerCase(),
      name: str(rec.filename || rec.title || (BLOBS[recKey(rec)] && BLOBS[recKey(rec)].name)),
      url: str(rec.file_url || rec.original_url || rec.archive_url)
    };
  }

  // The kinds an author can pin a source TO, overriding detection. 'unknown' isn't
  // offered — it's the absence of a guess, not a thing you'd choose.
  var ADAPT_KINDS = ['image', 'pdf', 'text', 'office'];
  var ADAPTABLE = { image: 1, pdf: 1, text: 1, office: 1 };

  // What the file LOOKS like from its mime / name / url — the automatic read,
  // before any manual override. (This was kindOf; kindOf now layers the override
  // on top, so existing callers keep their single call.)
  function detectKind(rec) {
    if (!rec) return 'unknown';
    var h = hints(rec), s = h.name + ' ' + h.url;
    if (/^image\//.test(h.mime) || IMG_RE.test(s)) return 'image';
    if (h.mime === 'application/pdf' || PDF_RE.test(s)) return 'pdf';
    if (OFFICE_RE.test(s) || /(msword|officedocument|ms-excel|ms-powerpoint|opendocument)/.test(h.mime)) return 'office';
    if (/^text\//.test(h.mime) || /(json|xml|csv|html|markdown|ya?ml)/.test(h.mime) || TEXT_RE.test(s)) return 'text';
    if (str(rec.text).trim() && !rec.binary) return 'text';   // we read words out of it
    return 'unknown';
  }

  // The kind the app TREATS this source as. Honors an explicit rec.kind the author
  // pinned ("treat this as an image") over detection — that's how a scan that
  // arrived as application/octet-stream, or a file with no extension, gets the
  // image viewer and the OCR path. Falls back to detection when nothing's pinned.
  function kindOf(rec) {
    if (rec && rec.kind && ADAPTABLE[rec.kind]) return rec.kind;
    return detectKind(rec);
  }

  // Did the author pin this source's kind, vs. it being auto-detected? Drives the
  // "treated as X — use detected type instead" affordance in the source adapter.
  function kindPinned(rec) { return !!(rec && rec.kind && ADAPTABLE[rec.kind]); }

  // A coarse, human label for the type badge.
  function kindLabel(rec) {
    switch (kindOf(rec)) {
      case 'image': return 'Image';
      case 'pdf': return 'PDF';
      case 'office': return 'Office doc';
      case 'text': return 'Text';
      default: return 'File';
    }
  }
  // Can the app show the file's content inline (vs. only offer open/download)?
  function isViewable(rec) { var k = kindOf(rec); return k === 'image' || k === 'pdf' || k === 'text'; }
  function hasFile(rec) { return !!(rec && (rec.file_url || hasBlob(recKey(rec)) || rec.archive_url || rec.original_url)); }

  // OCR only makes sense for an image we hold bytes for. ocrOff is the author's
  // explicit "don't read text off this picture" — set when they turn OCR off
  // (which also deletes the recognized text). Auto-OCR and ensureText honor it, so
  // a disabled image stays text-free until OCR is turned back on.
  function ocrEligible(rec) { return kindOf(rec) === 'image' && hasFile(rec); }
  function ocrEnabled(rec) { return ocrEligible(rec) && !(rec && rec.ocrOff); }

  // Whether the READER may show this source's pinned passage as a verbatim quote.
  // An image's pinned words are machine-read (OCR) — noisy, and not something to
  // present as "the cited passage" unless the author vouches for them by turning
  // ocrShow on (the SourceAdapter checkbox). The picture itself is the receipt.
  // Web/PDF/text sources carry real, selectable text, so their passage always
  // shows. Pure — unit-tested in tests/source-view.test.js.
  function citedPassageVisible(rec) { return kindOf(rec) !== 'image' || !!(rec && rec.ocrShow); }

  /* ---------------- human identity of an uploaded file ----------------
     An uploaded document lands titled by its raw filename — the newsroom sees
     things like "2026.6.29_Policing_Public_Safety.pdf": a date jammed against an
     underscore/dot-separated topic and an extension. The card can't tell you WHAT
     the document is or WHEN it's from when that's shown verbatim. docLabel teases
     the pieces apart, mechanically (no model):
       · name — the topic, de-slugged into words ("Policing Public Safety")
       · date — the document's own date, read off the front of the filename
                 ("Jun 29, 2026"), '' when the name carries none
       · kind — the coarse type label ("PDF", "Image", …)
     Pure — unit-tested in tests/source-view.test.js. */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // A leading date token in a filename: 2026.6.29 / 2026-06-29 / 2026_6_29 (a
  // consistent separator), or the compact 20260629. Either way it must be
  // followed by a non-digit (or end), so "2020report" isn't read as a year.
  function leadingDate(base) {
    base = str(base);
    var m = base.match(/^\s*(\d{4})[.\-_](\d{1,2})[.\-_](\d{1,2})(?=\D|$)/)
         || base.match(/^\s*(\d{4})(\d{2})(\d{2})(?=\D|$)/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || !MONTHS[mo - 1]) return null;
    return { raw: m[0], text: MONTHS[mo - 1] + ' ' + d + ', ' + y };
  }
  // separators (dots, dashes, underscores, plus) → spaces; collapse
  function deSlug(s) { return str(s).replace(/[.\-_+]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function docLabel(rec) {
    rec = rec || {};
    var fname = str(rec.filename || rec.title || '');
    var base = fname.replace(/\.[a-z0-9]{1,6}$/i, '');   // drop the extension first
    var dt = leadingDate(base);
    var rest = dt ? base.slice(dt.raw.length) : base;    // the topic, minus any date prefix
    var name = deSlug(rest);
    if (!name) name = dt ? 'Uploaded document' : (deSlug(base) || fname || 'Uploaded document');
    return { name: name, date: dt ? dt.text : '', kind: kindLabel(rec) };
  }

  /* ---------------- a renderable URL ---------------- */
  // Resolve to something an <img>/<iframe> can load right now. Best-effort —
  // returns the raw url on failure rather than throwing.
  async function displayUrl(rec) {
    if (!rec) return null;
    var b = blobUrl(recKey(rec));
    if (b) return b;                                   // live upload — instant, offline
    var u = rec.file_url || '';
    if (u) {
      var M = root.NpjMedia;
      if (M && M.isStoreUrl && M.isStoreUrl(u) && M.resolveDisplay) {
        try { return await M.resolveDisplay(u); } catch (e) { return u; }
      }
      return u;
    }
    return rec.archive_url || rec.original_url || null; // web sources, for completeness
  }

  // The bytes behind a record (for extraction / download): the session blob
  // first, then an authenticated media-store fetch, then a plain fetch.
  async function bytesFor(rec) {
    var b = getBlob(recKey(rec));
    if (b) return b;
    var u = rec.file_url || rec.archive_url || rec.original_url;
    if (!u) return null;
    var M = root.NpjMedia;
    if (M && M.fetchBytes) { try { var bb = await M.fetchBytes(u); if (bb) return bb; } catch (e) {} }
    try { var r = await fetch(u); if (r.ok) return await r.blob(); } catch (e) {}
    return null;
  }

  /* ---------------- pdf.js (lazy, from the CDN) ----------------
     UMD legacy build so it attaches window.pdfjsLib without ESM import — the
     same script-tag style the app already uses for React/Babel. Loaded only
     when a PDF is actually opened. */
  var PDF_VER = '3.11.174';
  var PDF_BASE = 'https://unpkg.com/pdfjs-dist@' + PDF_VER + '/legacy/build/';
  var _pdfPromise = null;
  function ensurePdfJs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (_pdfPromise) return _pdfPromise;
    _pdfPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = PDF_BASE + 'pdf.min.js';
      s.async = true;
      s.onload = function () {
        if (root.pdfjsLib) {
          try { root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'pdf.worker.min.js'; } catch (e) {}
          resolve(root.pdfjsLib);
        } else { _pdfPromise = null; reject(new Error('PDF reader failed to initialise.')); }
      };
      s.onerror = function () { _pdfPromise = null; reject(new Error('Could not load the PDF reader (offline?).')); };
      doc.head.appendChild(s);
    });
    return _pdfPromise;
  }

  /* ---------------- pdf-lib (lazy, from the CDN) ----------------
     The WRITER half of the PDF story: pdf.js renders, pdf-lib assembles. Loaded
     only when a redacted PDF is actually built (buildRedactedPdf). UMD bundle,
     attaches window.PDFLib — same script-tag style as pdf.js / tesseract. */
  var PDFLIB_VER = '1.17.1';
  var PDFLIB_SRC = 'https://unpkg.com/pdf-lib@' + PDFLIB_VER + '/dist/pdf-lib.min.js';
  var _pdfLibPromise = null;
  function ensurePdfLib() {
    if (root.PDFLib) return Promise.resolve(root.PDFLib);
    if (_pdfLibPromise) return _pdfLibPromise;
    _pdfLibPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = PDFLIB_SRC;
      s.async = true;
      s.onload = function () {
        if (root.PDFLib) resolve(root.PDFLib);
        else { _pdfLibPromise = null; reject(new Error('The PDF writer failed to initialise.')); }
      };
      s.onerror = function () { _pdfLibPromise = null; reject(new Error('Could not load the PDF writer (offline?).')); };
      doc.head.appendChild(s);
    });
    return _pdfLibPromise;
  }

  // key -> { state:'extracting'|'done'|'error', text, error }
  var _pdfText = {};
  function pdfTextState(rec) { return _pdfText[recKey(rec)] || { state: 'idle' }; }

  // Extract a PDF's text layer. Cached per source key; returns '' for image-only
  // (scanned) PDFs rather than failing. Does NOT mutate the record — the caller
  // decides whether to seed rec.text (so persistence + PII scanning stay in the
  // host's hands).
  async function extractPdfText(rec, opts) {
    var key = recKey(rec);
    var cached = _pdfText[key];
    if (cached && cached.state === 'done') return cached.text || '';
    if (cached && cached.state === 'extracting' && cached._p) return cached._p;
    var p = (async function () {
      var lib = await ensurePdfJs();
      var blob = await bytesFor(rec);
      if (!blob) throw new Error('Could not read the file — sign in again, or re-upload it.');
      var buf = await blob.arrayBuffer();
      var pdf = await lib.getDocument({ data: buf }).promise;
      var max = Math.min(pdf.numPages, (opts && opts.maxPages) || 300);
      var out = [];
      for (var i = 1; i <= max; i++) {
        var page = await pdf.getPage(i);
        var tc = await page.getTextContent();
        var line = tc.items.map(function (it) { return it.str; }).join(' ').replace(/[ \t]+/g, ' ').trim();
        if (line) out.push(line);
      }
      var text = out.join('\n\n');
      _pdfText[key] = { state: 'done', text: text, pages: pdf.numPages };
      return text;
    })();
    _pdfText[key] = { state: 'extracting', text: '', _p: p };
    try { return await p; }
    catch (e) { _pdfText[key] = { state: 'error', error: (e && e.message) || 'extraction failed' }; throw e; }
  }

  /* ---------------- pdf layout: text + where each run sits ----------------
     extractPdfText gives the WORDS; a redaction expressed against those words
     (Citey's review records {start,end} offsets) has to become BLACK BOXES burned
     onto the page, and a box drawn on the page has to scrub the matching words out
     of the text shadow too. Both need the same thing: the geometry of every text
     run, tied to its offset in the extracted text. That's the layout.

     The layout's `text` is the SAME string the offsets index into — the review
     seeds rec.text from here — so geometry and offsets can never desync. Boxes are
     stored NORMALIZED to each page (0..1 of width/height at scale 1), so they're
     resolution-independent: the builder can rasterize at any scale and the page
     viewer can overlay them with plain percentages. */

  // Pure: assemble { text, items, pages } from per-page items. Exported for tests
  // (no DOM). `pages`: [{ page, width, height, items:[{ str, x, y, w, h }] }] with
  // x/y/w/h already normalized to that page. Each emitted item carries the [start,
  // end) offset of its text in the joined string.
  function buildLayout(pages) {
    var text = '', items = [], dims = [];
    (pages || []).forEach(function (pg, pi) {
      dims.push({ page: pg.page, width: pg.width, height: pg.height });
      if (pi > 0) text += '\n\n';
      var first = true;
      (pg.items || []).forEach(function (it) {
        var s = String(it && it.str || '');
        if (!s) return;
        if (!first) text += ' ';
        first = false;
        var start = text.length;
        text += s;
        items.push({ page: pg.page, start: start, end: text.length, x: it.x, y: it.y, w: it.w, h: it.h });
      });
    });
    return { text: text, items: items, pages: dims };
  }

  // Pure: drop duplicate boxes (same page + rounded rect) so overlapping ranges
  // that map onto the same run don't burn the same black box twice.
  function dedupeBoxes(boxes) {
    var seen = {}, out = [];
    (boxes || []).forEach(function (b) {
      if (!b) return;
      var k = b.page + ':' + Math.round(b.x * 1e4) + ':' + Math.round(b.y * 1e4) + ':' + Math.round(b.w * 1e4) + ':' + Math.round(b.h * 1e4);
      if (seen[k]) return; seen[k] = 1; out.push(b);
    });
    return out;
  }

  // Pure: text ranges (offsets into layout.text) → the page boxes that cover them.
  // A range that touches any part of a run redacts that whole run's box — over-
  // covering is the safe direction, exactly like the text scrub.
  function rangesToBoxes(items, ranges) {
    var out = [];
    (ranges || []).forEach(function (r) {
      if (!r || !(r.end > r.start)) return;
      (items || []).forEach(function (it) {
        if (it.start < r.end && r.start < it.end) out.push({ page: it.page, x: it.x, y: it.y, w: it.w, h: it.h });
      });
    });
    return dedupeBoxes(out);
  }

  // Pure: a page box → the text ranges of every run it overlaps, so a box drawn on
  // the page also scrubs those words from the text shadow (and counts toward the
  // gate). A box over a picture/signature with no text under it maps to nothing.
  function boxesToRanges(items, boxes) {
    var out = [];
    (boxes || []).forEach(function (b) {
      if (!b) return;
      (items || []).forEach(function (it) {
        if (it.page !== b.page) return;
        if (it.x < b.x + b.w && b.x < it.x + it.w && it.y < b.y + b.h && b.y < it.y + it.h)
          out.push({ start: it.start, end: it.end });
      });
    });
    return out;
  }

  // key -> { state:'extracting'|'done'|'error', layout, error }
  var _pdfLayout = {};
  function pdfLayoutState(rec) { return _pdfLayout[recKey(rec)] || { state: 'idle' }; }

  // Extract a PDF's layout (text + per-run geometry). Cached per source key, and
  // keeps extractPdfText's cache in sync so a caller that only wants words agrees
  // with the redaction map. Does NOT mutate the record. Scanned (image-only) pages
  // contribute no runs — the page viewer still lets the author draw boxes on them.
  async function extractPdfLayout(rec, opts) {
    var key = recKey(rec);
    var cached = _pdfLayout[key];
    if (cached && cached.state === 'done') return cached.layout;
    if (cached && cached.state === 'extracting' && cached._p) return cached._p;
    var p = (async function () {
      var lib = await ensurePdfJs();
      var blob = await bytesFor(rec);
      if (!blob) throw new Error('Could not read the file — sign in again, or re-upload it.');
      var buf = await blob.arrayBuffer();
      var pdf = await lib.getDocument({ data: buf }).promise;
      var nPages = pdf.numPages;
      var max = Math.min(nPages, (opts && opts.maxPages) || 300);
      var pages = [];
      for (var i = 1; i <= max; i++) {
        var page = await pdf.getPage(i);
        var vp = page.getViewport({ scale: 1 });
        var tc = await page.getTextContent();
        var runs = (tc.items || []).map(function (it) {
          if (!it || !it.str) return null;
          // device-space box of the run (top-left origin), via the same matrix
          // compose pdf.js uses to place its own text layer
          var tx = lib.Util.transform(vp.transform, it.transform);
          var h = Math.hypot(tx[2], tx[3]) || it.height || 10;
          var w = (it.width || 0) * vp.scale;
          var left = tx[4], top = tx[5] - h;
          return { str: it.str, x: left / vp.width, y: top / vp.height, w: w / vp.width, h: h / vp.height };
        }).filter(Boolean);
        pages.push({ page: i, width: vp.width, height: vp.height, items: runs });
      }
      try { pdf.destroy(); } catch (e) {}
      var layout = buildLayout(pages);
      layout.pageCount = nPages;
      _pdfLayout[key] = { state: 'done', layout: layout };
      _pdfText[key] = { state: 'done', text: layout.text, pages: nPages };
      return layout;
    })();
    _pdfLayout[key] = { state: 'extracting', _p: p };
    try { return await p; }
    catch (e) { _pdfLayout[key] = { state: 'error', error: (e && e.message) || 'layout extraction failed' }; throw e; }
  }

  /* ---------------- build a REDACTED pdf (rasterize + burn boxes) ----------------
     A redaction has to be REAL on the document that reaches archive.org, not just
     on a text shadow. So every page that carries a redaction box is RASTERIZED
     (rendered to a canvas — its selectable text is destroyed) with the boxes burned
     in as solid black; there is nothing left under the box to fetch back out. Pages
     with no box are COPIED THROUGH unchanged (still vector, crisp, small) — they
     hold nothing the author chose to withhold.

     A boxed page that fails to rasterize ABORTS the whole build (it must never fall
     back to copying the un-redacted original through). Returns a Blob. */
  function dataUrlToBytes(dataUrl) {
    var b64 = String(dataUrl).split(',')[1] || '';
    var bin = root.atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  async function buildRedactedPdf(rec, boxes, opts) {
    opts = opts || {};
    var lib = await ensurePdfJs();
    var PDFLib = await ensurePdfLib();
    var blob = await bytesFor(rec);
    if (!blob) throw new Error('Could not read the original to redact it.');
    var buf = await blob.arrayBuffer();

    var byPage = {};
    (boxes || []).forEach(function (b) { if (b && b.page) (byPage[b.page] = byPage[b.page] || []).push(b); });

    // pdf.js and pdf-lib each get their own copy — getDocument may detach the buffer
    var pdf = await lib.getDocument({ data: buf.slice(0) }).promise;
    var out = await PDFLib.PDFDocument.create();
    var src = await PDFLib.PDFDocument.load(buf.slice(0));
    var n = Math.min(pdf.numPages, opts.maxPages || 600);
    var scale = opts.scale || 2;

    for (var i = 1; i <= n; i++) {
      var pageBoxes = byPage[i];
      if (!pageBoxes || !pageBoxes.length) {
        var copied = await out.copyPages(src, [i - 1]);
        out.addPage(copied[0]);
        if (opts.onProgress) opts.onProgress(i, n);
        continue;
      }
      var page = await pdf.getPage(i);
      var vp1 = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: scale });
      var canvas = doc.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      // burn the boxes: normalized → device px, padded a couple px so coverage is total
      ctx.fillStyle = '#000000';
      pageBoxes.forEach(function (b) {
        var x = b.x * canvas.width - 2, y = b.y * canvas.height - 2;
        var w = b.w * canvas.width + 4, h = b.h * canvas.height + 4;
        ctx.fillRect(x, y, w, h);
      });
      var img = await out.embedJpg(dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.85)));
      var op = out.addPage([vp1.width, vp1.height]);
      op.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      if (opts.onProgress) opts.onProgress(i, n);
    }
    try { pdf.destroy(); } catch (e) {}
    var outBytes = await out.save();
    return new Blob([outBytes], { type: 'application/pdf' });
  }

  /* ---------------- OCR (lazy, from the CDN) ----------------
     Screenshots and scans carry no machine-readable text. Tesseract.js (the
     same script-tag, load-on-first-use style as pdf.js above) reads the words
     off an image so an uploaded picture becomes CITABLE (its text flows into
     the select-to-cite reader) and SCANNABLE (the PII review can see what's in
     it). One shared worker is kept warm across images. Best-effort: a CDN miss
     or a worker failure rejects with a friendly message — the caller degrades
     to "transcribe it yourself", never throws on load. */
  var TESS_VER = '5.1.1';
  var TESS_SRC = 'https://unpkg.com/tesseract.js@' + TESS_VER + '/dist/tesseract.min.js';
  var _tessPromise = null;
  function ensureTesseract() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (_tessPromise) return _tessPromise;
    _tessPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = TESS_SRC;
      s.async = true;
      s.onload = function () {
        if (root.Tesseract) resolve(root.Tesseract);
        else { _tessPromise = null; reject(new Error('The OCR engine failed to initialise.')); }
      };
      s.onerror = function () { _tessPromise = null; reject(new Error('Could not load the OCR engine (offline?).')); };
      doc.head.appendChild(s);
    });
    return _tessPromise;
  }

  // One reusable English worker — created once, reused for every image so the
  // ~few-MB core/lang download happens a single time.
  var _tessWorker = null, _tessWorkerP = null;
  async function tessWorker() {
    if (_tessWorker) return _tessWorker;
    if (!_tessWorkerP) {
      _tessWorkerP = (async function () {
        var T = await ensureTesseract();
        return await T.createWorker('eng', 1);   // OEM 1 = LSTM
      })();
    }
    try { _tessWorker = await _tessWorkerP; return _tessWorker; }
    catch (e) { _tessWorkerP = null; throw e; }
  }

  // Tidy raw OCR output: drop carriage returns, turn page-breaks into blank
  // lines, strip trailing spaces and runs of spaces, collapse blank-line runs.
  // Pure — unit-tested in tests/source-view.test.js.
  function cleanOcrText(s) {
    return String(s == null ? '' : s)
      .replace(/\r/g, '')
      .replace(/[ \t]*\f[ \t]*/g, '\n\n')  // page break (+ its padding) → blank line
      .replace(/\t/g, ' ')                 // stray tabs → space
      .replace(/ +\n/g, '\n')              // trailing spaces
      .replace(/ {2,}/g, ' ')              // runs of spaces
      .replace(/\n{3,}/g, '\n\n')          // collapse blank-line runs
      .trim();
  }

  // key -> { state:'extracting'|'done'|'error', text, error }
  var _imgText = {};
  function imageTextState(rec) { return _imgText[recKey(rec)] || { state: 'idle' }; }

  // OCR an image source. Cached per source key; returns '' for an image with no
  // legible text rather than failing. Does NOT mutate the record — the caller
  // decides whether to seed rec.text (so persistence + PII scanning stay in the
  // host's hands), exactly like extractPdfText.
  async function extractImageText(rec) {
    var key = recKey(rec);
    var cached = _imgText[key];
    if (cached && cached.state === 'done') return cached.text || '';
    if (cached && cached.state === 'extracting' && cached._p) return cached._p;
    var p = (async function () {
      var w = await tessWorker();
      var blob = await bytesFor(rec);
      if (!blob) throw new Error('Could not read the image — sign in again, or re-upload it.');
      var res = await w.recognize(blob);
      var text = cleanOcrText(res && res.data && res.data.text);
      _imgText[key] = { state: 'done', text: text };
      return text;
    })();
    _imgText[key] = { state: 'extracting', text: '', _p: p };
    try { return await p; }
    catch (e) { _imgText[key] = { state: 'error', error: (e && e.message) || 'OCR failed' }; throw e; }
  }

  // OCR an arbitrary image — a dataURL string, a Blob, or an <canvas> — with the
  // shared English worker. This is what makes a SCANNED document (no text layer
  // to drag-select) citable: the author drags a box on the page, we crop that
  // region to a canvas and read just those words here. Best-effort by contract —
  // throws only if the engine can't load at all; an unreadable crop returns ''
  // and the author transcribes it. Reuses the same worker as extractImageText,
  // so the multi-MB core/lang download happens once for the whole session.
  async function ocrImage(input) {
    if (!input) return '';
    var w = await tessWorker();
    var res = await w.recognize(input);
    return cleanOcrText(res && res.data && res.data.text);
  }

  // Decode a blob as UTF-8 text (Blob.text where available, else FileReader).
  async function decodeText(blob) {
    if (!blob) return '';
    try { if (blob.text) return await blob.text(); } catch (e) {}
    return await new Promise(function (res) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || '')); };
      r.onerror = function () { res(''); };
      try { r.readAsText(blob); } catch (e) { res(''); }
    });
  }

  // key -> { state, text } for decoded text files (PDFs cache in _pdfText)
  var _txt = {};

  // Make sure a source has readable TEXT — decoding a stored text file, or
  // extracting a PDF's text layer. Returns the text (does NOT mutate the record;
  // the caller seeds it so persistence + PII scanning stay in the host's hands).
  // This is what lets an uploaded .txt / .md / .csv (or a re-opened draft whose
  // text wasn't captured) show its content instead of a "paste the text" box.
  async function ensureText(rec) {
    if (String(rec && rec.text || '').trim()) return rec.text;
    var k = kindOf(rec);
    if (k === 'pdf') return await extractPdfText(rec);
    if (k === 'image') return (rec && rec.ocrOff) ? '' : await extractImageText(rec);   // OCR off → no words read
    if (k === 'text') {
      var key = recKey(rec);
      if (_txt[key] && _txt[key].state === 'done') return _txt[key].text;
      var blob = await bytesFor(rec);
      if (!blob) return '';
      var t = await decodeText(blob);
      _txt[key] = { state: 'done', text: t };
      return t;
    }
    return '';
  }

  /* ---------------- misc ---------------- */
  function humanSize(n) {
    n = Number(n) || 0;
    if (n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  // Force a browser download of the file (uses the resolved/blob URL).
  async function download(rec) {
    var url = await displayUrl(rec);
    if (!url) return false;
    var a = doc.createElement('a');
    a.href = url;
    a.download = str(rec.filename || rec.title || recKey(rec) || 'source');
    a.rel = 'noopener';
    doc.body.appendChild(a); a.click(); a.remove();
    return true;
  }

  root.NpjSourceView = {
    recKey: recKey,
    registerBlob: registerBlob, blobUrl: blobUrl, getBlob: getBlob, hasBlob: hasBlob,
    kindOf: kindOf, detectKind: detectKind, kindPinned: kindPinned, ADAPT_KINDS: ADAPT_KINDS,
    kindLabel: kindLabel, docLabel: docLabel, isViewable: isViewable, hasFile: hasFile,
    ocrEligible: ocrEligible, ocrEnabled: ocrEnabled, citedPassageVisible: citedPassageVisible,
    displayUrl: displayUrl, bytesFor: bytesFor,
    ensurePdfJs: ensurePdfJs, extractPdfText: extractPdfText, pdfTextState: pdfTextState,
    ensurePdfLib: ensurePdfLib, extractPdfLayout: extractPdfLayout, pdfLayoutState: pdfLayoutState,
    buildLayout: buildLayout, rangesToBoxes: rangesToBoxes, boxesToRanges: boxesToRanges, dedupeBoxes: dedupeBoxes,
    buildRedactedPdf: buildRedactedPdf,
    ensureTesseract: ensureTesseract, extractImageText: extractImageText, ocrImage: ocrImage, imageTextState: imageTextState, cleanOcrText: cleanOcrText,
    ensureText: ensureText, decodeText: decodeText,
    humanSize: humanSize, download: download
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjSourceView;
})(typeof window !== 'undefined' ? window : this);
