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

  function kindOf(rec) {
    if (!rec) return 'unknown';
    var h = hints(rec), s = h.name + ' ' + h.url;
    if (/^image\//.test(h.mime) || IMG_RE.test(s)) return 'image';
    if (h.mime === 'application/pdf' || PDF_RE.test(s)) return 'pdf';
    if (OFFICE_RE.test(s) || /(msword|officedocument|ms-excel|ms-powerpoint|opendocument)/.test(h.mime)) return 'office';
    if (/^text\//.test(h.mime) || /(json|xml|csv|html|markdown|ya?ml)/.test(h.mime) || TEXT_RE.test(s)) return 'text';
    if (str(rec.text).trim() && !rec.binary) return 'text';   // we read words out of it
    return 'unknown';
  }

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
    if (k === 'image') return await extractImageText(rec);
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
    kindOf: kindOf, kindLabel: kindLabel, isViewable: isViewable, hasFile: hasFile,
    displayUrl: displayUrl, bytesFor: bytesFor,
    ensurePdfJs: ensurePdfJs, extractPdfText: extractPdfText, pdfTextState: pdfTextState,
    ensureTesseract: ensureTesseract, extractImageText: extractImageText, imageTextState: imageTextState, cleanOcrText: cleanOcrText,
    ensureText: ensureText, decodeText: decodeText,
    humanSize: humanSize, download: download
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NpjSourceView;
})(typeof window !== 'undefined' ? window : this);
