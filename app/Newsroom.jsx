/* NPJ newsroom — the editor. Ships empty. Manual, span-bound sourcing (drafteo
   style: select the exact words → bind a source; one source can back many spans).
   Adds: banner + inline images, a proper link/jump-link popover, a section
   contents rail, Citey-assisted grounding + tags, real Matrix room invites + server-side
   room recovery (survives a browser wipe), permission-gated publish, versioning. */

/* themeable palette — resolved by the --nr-* vars on .newsroom / .newsroom.nr-light
   (app/styles.css), so every piece of chrome follows the light/dark toggle */
const NR = {
  bg: "var(--nr-bg)", rail: "var(--nr-rail)", panel: "var(--nr-panel)", field: "var(--nr-field)",
  line: "var(--nr-line)", muted: "var(--nr-muted)", text: "var(--nr-text)", soft: "var(--nr-soft)",
  ok: "var(--nr-ok)", warn: "var(--nr-warn)"
};

const THEME_KEY = "npj_nr_theme";
function nrTheme() { try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; } }

// clean-read preference (the toolbar's Citations eye). Default ON — highlights,
// marker chips and footnotes are shown. "0" means the author chose a clean read:
// not only is the citation chrome hidden, the citation INTERACTIONS step aside too
// (no source-pin popover on click, no hover-to-remove ×, no Source/Void in the
// selection toolbar) so the canvas behaves like a plain prose editor you can just
// type into. Survives reloads instead of snapping back on every refresh.
const CITEHL_KEY = "npj_nr_citehl";
function nrCiteHl() { try { return localStorage.getItem(CITEHL_KEY) !== "0"; } catch (e) { return true; } }

// A source the file explorer/viewer should open: an uploaded document, or any
// source whose content the app can render inline (image / pdf / text). Web-link
// snapshots are excluded — they keep their "open ↗".
function nrIsFileSrc(rec) {
  if (rec && rec.type === "interview") return false;   // a conversation isn't a file to open
  const SV = window.NpjSourceView;
  return !!(SV && rec && (/^doc-/.test(rec.id || "") || SV.isViewable(rec)));
}

const DEK_PH = "Subtitle — one line under the headline";
// Editable caption + credit + description lines, shared by the banner and inline
// image figures. The credit takes a markdown hyperlink like a contributor bio
// (name / [outlet](https://…)), rendered safely via npjRichText in the reader.
// The description is the photo's alt text — read aloud by screen readers and
// indexed by search engines; it rides as the image's real `alt`, not a visible
// caption line.
const FIG_CAPS =
  '<figcaption class="cmp-cap np-mono" contenteditable="true" data-ph="Caption — what\'s happening in the photo" style="font-size:11px;color:var(--nr-muted);margin-top:4px"></figcaption>' +
  '<figcaption class="cmp-credit np-mono" contenteditable="true" data-ph="Credit — e.g. Jane Doe / [Reuters](https://reuters.com)" style="font-size:11px;color:var(--nr-muted);margin-top:2px"></figcaption>' +
  '<figcaption class="cmp-desc np-mono" contenteditable="true" data-ph="Description — alt text for screen readers &amp; search (not shown on the page)" style="font-size:11px;color:var(--nr-muted);margin-top:2px"></figcaption>';

// One carousel slide: the SAME editable image-slot a single inline image uses
// (so a drop still uploads to the media store and freezes to archive.org at
// publish), plus the shared caption lines and a ✕ to drop the slide. The reader
// renders the whole figure as a swipeable gallery (Splide) + fullscreen viewer;
// blocksToHtml (app/articles.js) emits this very shape on re-edit.
const CAROUSEL_SLIDE = (id) =>
  '<div class="cmp-slide"><image-slot id="' + id + '" conform fitcontrol shape="rect" placeholder="Drop a photo or an archive.org link" style="width:100%;height:240px;display:block"></image-slot>' +
  FIG_CAPS +
  '<span class="cmp-slide-rm" contenteditable="false" role="button" title="Remove this image" aria-label="Remove this image">✕</span></div>';
// contenteditable=false chips inside the (non-editable) figure — the caret never
// lands on them; a delegated click handler in the editor runs add/remove.
const CAROUSEL_ADD = '<span class="cmp-carousel-add np-mono" contenteditable="false" role="button">+ Add image</span>';
const CAROUSEL_CAP = '<figcaption class="cmp-carousel-cap np-mono" contenteditable="true" data-ph="Gallery caption (optional)" style="font-size:11px;color:var(--nr-muted);margin-top:6px"></figcaption>';
// The headline + dek live in the body as <h1>/.nr-dek so the whole publish,
// restore and reader pipeline is unchanged — but they're driven by the explicit
// Title/Subtitle fields above the sheet (and hidden in-canvas via .nr-fielded),
// so the author fills in fields, not loose formatted prose.
const START_DOC =
  '<figure contenteditable="false" class="nr-banner"><image-slot id="nr-banner" fitcontrol conform shape="rect" placeholder="Banner image — drag a photo or an archive.org link" style="width:100%;height:300px;display:block"></image-slot>' + FIG_CAPS + '</figure>' +
  '<h1></h1>' +
  '<p class="nr-dek" data-ph="' + DEK_PH + '"><br/></p>' +
  '<p><br/></p>';

// ============================ HTML source mode ============================
// The prose editor is a contentEditable, and execCommand + pasted markup leave
// a long tail of damage no toolbar button can reach: a contenteditable=false
// figure with no caret to backspace, a heading style carried onto a paragraph,
// fragmented <b>…</b><b>…</b> runs, stranded markers, bare wrapper <span>s. The
// source view is the general escape hatch — read the document as HTML, fix it by
// hand or with one Tidy pass, and apply it back through the SAME reconcile the
// draft-restore path runs, so an edited document lands as well-formed as a
// reopened one (image-slots re-upgraded, citations/footnotes renumbered).
var NR_INLINE = { A: 1, B: 1, STRONG: 1, I: 1, EM: 1, S: 1, STRIKE: 1, U: 1, SUP: 1, SUB: 1, CODE: 1, SPAN: 1, MARK: 1, FONT: 1, SMALL: 1, BIG: 1, ABBR: 1, CITE: 1, TIME: 1, Q: 1, WBR: 1, BR: 1 };
var NR_VOID = { HR: 1, BR: 1, IMG: 1, INPUT: 1, WBR: 1, COL: 1, AREA: 1, SOURCE: 1, EMBED: 1, TRACK: 1 };
var NR_VERBATIM = { PRE: 1, TEXTAREA: 1, SCRIPT: 1, STYLE: 1 };
function nrEscText(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function nrOpenTag(el) {
  var s = "<" + el.tagName.toLowerCase(), at = el.attributes;
  for (var i = 0; i < at.length; i++) s += " " + at[i].name + '="' + String(at[i].value).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"';
  return s + ">";
}
function nrHasBlockChild(el) {
  var k = el.children;
  for (var i = 0; i < k.length; i++) if (!NR_INLINE[k[i].tagName]) return true;
  return false;
}
// DOM → readable, round-trip-safe HTML. One block per line so it's editable;
// inline runs stay intact on their block's line so parsing it back adds no stray
// spaces; <pre> is preserved verbatim; whitespace-only text between blocks is
// dropped, so reopening the view never accumulates blank lines.
function nrSerializeHtml(root) {
  var out = [];
  function pad(d) { return new Array(d + 1).join("  "); }
  function walk(el, depth) {
    var tag = el.tagName.toLowerCase();
    if (NR_VOID[el.tagName]) { out.push(pad(depth) + nrOpenTag(el)); return; }
    if (NR_VERBATIM[el.tagName]) { out.push(pad(depth) + nrOpenTag(el) + el.innerHTML + "</" + tag + ">"); return; }
    if (!nrHasBlockChild(el)) { out.push(pad(depth) + nrOpenTag(el) + el.innerHTML + "</" + tag + ">"); return; }
    out.push(pad(depth) + nrOpenTag(el));
    var ch = el.childNodes;
    for (var i = 0; i < ch.length; i++) {
      var c = ch[i];
      if (c.nodeType === 1) walk(c, depth + 1);
      else if (c.nodeType === 3) { var t = c.nodeValue.replace(/\s+/g, " ").trim(); if (t) out.push(pad(depth + 1) + nrEscText(t)); }
    }
    out.push(pad(depth) + "</" + tag + ">");
  }
  var top = root.childNodes;
  for (var i = 0; i < top.length; i++) {
    var c = top[i];
    if (c.nodeType === 1) walk(c, 0);
    else if (c.nodeType === 3) { var t = c.nodeValue.replace(/\s+/g, " ").trim(); if (t) out.push(nrEscText(t)); }
  }
  return out.join("\n");
}
// An element the cleaner must never reach into: a custom element (image-slot…),
// an image/embed/widget shell, anything contenteditable=false, or a node that
// carries pipeline data (citation spans/markers, footnotes, the dek, the banner).
function nrProtectedEl(el) {
  if (!el || el.nodeType !== 1) return false;
  var tag = el.tagName;
  if (tag.indexOf("-") >= 0) return true;
  if (tag === "FIGURE") return true;
  if (el.getAttribute("contenteditable") === "false") return true;
  return /\b(md-cite|claim-src|nr-fnote|nr-fnotes|nr-dek|nr-banner)\b/.test(el.getAttribute("class") || "");
}
function nrInProtected(el) { for (var n = el; n && n.nodeType === 1; n = n.parentElement) if (nrProtectedEl(n)) return true; return false; }
function nrUnwrap(el) { var p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }
function nrNoAttrs(el) { return el.attributes.length === 0; }
// One conservative cleanup pass over a DETACHED copy. Only touches the cruft the
// composer is known to accumulate; never reaches into a protected node. Returns
// the tidied, pretty-printed HTML and a count of fixes (non-destructive — the
// author still reviews and applies it).
function nrTidyHtml(html) {
  var doc = document.createElement("div");
  doc.innerHTML = html;
  var fixes = 0, list, i;
  // <font> → a span carrying its color (keep the intent), or unwrap if bare
  list = doc.querySelectorAll("font");
  for (i = 0; i < list.length; i++) {
    var f = list[i]; if (nrInProtected(f)) continue;
    var color = f.getAttribute("color");
    if (color) { var sp = document.createElement("span"); sp.style.color = color; while (f.firstChild) sp.appendChild(f.firstChild); f.parentNode.replaceChild(sp, f); }
    else nrUnwrap(f);
    fixes++;
  }
  // bare wrapper <span> with no attributes → unwrap
  list = doc.querySelectorAll("span");
  for (i = 0; i < list.length; i++) { var s = list[i]; if (!nrInProtected(s) && nrNoAttrs(s)) { nrUnwrap(s); fixes++; } }
  // collapse nested identical inline tags: <b><b>x</b></b> → <b>x</b>
  list = doc.querySelectorAll("b>b, strong>strong, i>i, em>em, u>u, s>s, strike>strike, code>code");
  for (i = 0; i < list.length; i++) { var n0 = list[i]; if (!nrInProtected(n0)) { nrUnwrap(n0); fixes++; } }
  // merge adjacent identical attribute-less inline tags: <b>x</b><b>y</b> → <b>xy</b>
  var MERGE = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, CODE: 1, MARK: 1 };
  (function mergeRun(parent) {
    var c = parent.firstChild;
    while (c) {
      var next = c.nextSibling;
      if (c.nodeType === 1 && next && next.nodeType === 1 && c.tagName === next.tagName && MERGE[c.tagName] && nrNoAttrs(c) && nrNoAttrs(next) && !nrProtectedEl(c)) {
        while (next.firstChild) c.appendChild(next.firstChild);
        next.parentNode.removeChild(next); fixes++;
        continue;                                          // re-test c against its new next sibling
      }
      if (c.nodeType === 1 && !nrProtectedEl(c)) mergeRun(c);
      c = next;
    }
  })(doc);
  // empty inline elements (no text, no media) → drop
  list = doc.querySelectorAll("b, strong, i, em, u, s, strike, span, a, mark, sub, sup, code, small, big");
  for (i = 0; i < list.length; i++) {
    var e = list[i];
    if (nrInProtected(e)) continue;
    if (e.querySelector("img, br, image-slot, [contenteditable='false']")) continue;
    if ((e.textContent || "").trim() === "" && e.parentNode) { e.parentNode.removeChild(e); fixes++; }
  }
  // truly-empty paragraphs/divs → drop; a <p><br></p> blank line and the .nr-dek
  // are intentional spacers and are kept
  list = doc.querySelectorAll("p, div");
  for (i = 0; i < list.length; i++) {
    var b = list[i];
    if (nrInProtected(b)) continue;
    if (b.querySelector("br, img, image-slot, figure, [contenteditable='false']")) continue;
    if ((b.textContent || "").trim() === "" && b.children.length === 0 && b.parentNode) { b.parentNode.removeChild(b); fixes++; }
  }
  // empty class="" / style="" attributes execCommand leaves behind
  list = doc.querySelectorAll("[class], [style]");
  for (i = 0; i < list.length; i++) {
    var a = list[i];
    if (a.getAttribute("class") === "") { a.removeAttribute("class"); fixes++; }
    if (a.getAttribute("style") === "") { a.removeAttribute("style"); fixes++; }
  }
  return { html: nrSerializeHtml(doc), fixes: fixes };
}

// Raw media the author typed/pasted into the HTML source view — a bare <iframe>,
// <video> or <audio> (e.g. a Google Drive or archive.org embed snippet) — is
// lifted into a REAL embed block: a contenteditable=false <figure class="cmp-embed"
// data-embed-url> the composer treats as a void block and htmlToBlocks round-trips
// into the published record. Without this the <iframe> shows in the editor but the
// text-only htmlToBlocks drops it, so it never reaches preview or publish. Media
// already inside a managed embed figure is left untouched. Returns how many it
// normalized. Self-contained (module scope) so it runs over a detached tree too.
function nrNormalizeEmbeds(root) {
  if (!root) return 0;
  var E = window.NpjEmbed, n = 0;
  var med = root.querySelectorAll("iframe, video, audio");
  for (var i = 0; i < med.length; i++) {
    var el = med[i];
    if (el.closest && el.closest("figure[data-embed-url]")) continue;   // already a managed embed
    var src = el.getAttribute("src") || "";
    if (!src) { var s0 = el.querySelector && el.querySelector("source[src]"); if (s0) src = s0.getAttribute("src") || ""; }
    if (!/^https?:\/\//.test(src)) continue;
    var r = E && E.resolve(src), height = 0;
    if (r && r.panel) {
      var sh = (el.getAttribute("style") || "").match(/height:\s*(\d+)/i);
      height = sh ? parseInt(sh[1], 10) : parseInt(el.getAttribute("height") || "0", 10);
    }
    var fig = document.createElement("figure");
    fig.className = "cmp-embed"; fig.setAttribute("contenteditable", "false"); fig.setAttribute("data-embed-url", src);
    if (r && r.panel && height > 0) fig.setAttribute("data-embed-height", String(height));
    fig.innerHTML = E ? E.innerHtml(src, { height: height }) : "";
    var host = ""; try { host = new URL(src).hostname.replace(/^www\./, ""); } catch (e) {}
    var cap = document.createElement("figcaption");
    cap.className = "np-mono cmp-embed-hint"; cap.setAttribute("style", "font-size:11px;margin-top:4px;color:var(--ink-soft)");
    cap.textContent = (host || "media") + " · embedded — the published article keeps the link";
    fig.appendChild(cap);
    // swap the media element — or a wrapper the author pasted around it (a lone
    // <p>/<div>, or a <figure> with no data-embed-url) — for our figure, so we
    // never nest figures, and make sure an editable paragraph follows so the
    // caret has somewhere to land
    var target = el, p = el.parentElement;
    if (p && p.tagName === "FIGURE") target = p;
    else if (p && (p.tagName === "P" || p.tagName === "DIV") && p.children.length === 1 && !(p.textContent || "").trim()) target = p;
    if (!target.parentNode) continue;
    target.parentNode.replaceChild(fig, target);
    if (!fig.nextElementSibling || fig.nextElementSibling.tagName === "FIGURE") {
      var np = document.createElement("p"); np.innerHTML = "<br/>"; fig.parentNode.insertBefore(np, fig.nextSibling);
    }
    n++;
  }
  return n;
}

// edge-dashes stripped AFTER the length cap — a cap that lands mid-word used
// to leave filenames like "…-and-the-people-.md"
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, ""); }

// Show an image that may still live on the Matrix media store. A bare <img>
// can't load such a URL on an authenticated-media homeserver (Matrix 1.11+):
// the unauthenticated GET is refused, so a freshly dropped/uploaded photo that
// hasn't been frozen to archive.org yet renders broken — the media census
// thumbnail and the lightbox used to show exactly that. Resolve it the same way
// the reader (MediaImg) and <image-slot> do — fetch the bytes with the session
// token and hand back a blob: URL — before display; non-store URLs (archive.org,
// author src, data:) pass straight through.
function NrMediaImg({ url, alt, style, ...rest }) {
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    let alive = true, made = null;
    setResolved(null);
    if (!url) return;
    const media = window.NpjMedia;
    if (media && media.isStoreUrl && media.isStoreUrl(url) && media.resolveDisplay) {
      media.resolveDisplay(url).then(u => {
        if (!alive) { if (u && u !== url && u.indexOf("blob:") === 0) URL.revokeObjectURL(u); return; }
        if (u && u !== url && u.indexOf("blob:") === 0) made = u;
        setResolved(u || url);
      }).catch(() => { if (alive) setResolved(url); });
    } else {
      setResolved(url);
    }
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  // hold a neutral box while an authenticated store fetch is in flight rather
  // than flashing a doomed unauthenticated <img> GET
  if (resolved == null) return <div aria-hidden="true" style={{ ...style, background: NR.field }} {...rest} />;
  return <img src={resolved} alt={alt || ""} style={style} {...rest} />;
}

// A small, clickable PREVIEW of an uploaded file on its source card — the
// screenshot/scan you cited, shown inline so you can see the content (and click
// into the full viewer) instead of guessing from a filename. Images render as a
// thumbnail; a PDF shows a labelled tile. The image URL resolves the same way
// the reader does (session blob → token-fetched media-store blob → archive /
// original), via NrMediaImg. Returns null for kinds with no useful thumbnail.
function NrSourceThumb({ srcKey, rec, onOpen }) {
  const SV = window.NpjSourceView;
  if (!SV) return null;
  const key = (rec && (rec.id || rec.key)) || srcKey || "";
  const kind = SV.kindOf(rec);
  if (kind === "image") {
    const url = SV.blobUrl(key) || rec.file_url || rec.archive_url || rec.original_url || "";
    if (!url) return null;
    return (
      <button onClick={onOpen} title="Open this image" style={{ display: "block", width: "100%", padding: 0, border: "1px solid " + NR.line, background: NR.bg, cursor: "pointer", position: "relative", overflow: "hidden", lineHeight: 0 }}>
        <NrMediaImg url={url} alt={rec.title || "uploaded image"} style={{ width: "100%", height: 132, objectFit: "cover", display: "block" }} />
        <span className="np-mono" style={{ position: "absolute", right: 5, bottom: 5, fontSize: 8.5, color: "#fff", background: "rgba(8,7,5,.66)", padding: "1px 5px", display: "inline-flex", alignItems: "center", gap: 3, pointerEvents: "none", lineHeight: 1.4 }}><I.eye style={{ fontSize: 10 }} /> view</span>
      </button>
    );
  }
  if (kind === "pdf") {
    return (
      <button onClick={onOpen} title="Open this PDF" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: "1px solid " + NR.line, background: NR.bg, color: NR.text, cursor: "pointer", padding: "10px 11px", textAlign: "left" }}>
        <I.doc style={{ fontSize: 22, color: NR.warn, flex: "0 0 auto" }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.filename || rec.title || "PDF document"}</span>
          <span className="np-mono" style={{ fontSize: 9, color: NR.muted }}>PDF · click to read &amp; cite</span>
        </span>
      </button>
    );
  }
  return null;
}

// Where a selection-toolbar dropdown should open so it never spills past a screen
// edge. The toolbar is fixed ABOVE the selection (its bottom sits at selY-8), and a
// menu drops from there. With a hardcoded height a menu opened low in the viewport
// runs its footer (the "New source" / Add row) off the bottom, out of reach. Given
// the selection's viewport-Y this returns the side to open toward (down when it's
// roomier, else up) and a maxHeight clamped to that gutter, so the menu's own
// scrollbar — not the window — carries any overflow and the footer stays reachable.
function tbMenuBox(selY, desiredMax) {
  var vh = (typeof window !== "undefined" && window.innerHeight) || 800;
  var barH = 44, gap = 6, margin = 14;
  var below = vh - selY - margin;          // gutter from the selection top to the foot
  var above = selY - barH - gap - margin;  // gutter above the toolbar
  var down = below >= above;
  var room = Math.max(160, down ? below : above);
  var box = { maxHeight: Math.min(desiredMax, room), overflowY: "auto" };
  if (down) box.top = "calc(100% + " + gap + "px)"; else box.bottom = "calc(100% + " + gap + "px)";
  return box;
}

function Newsroom({ session, draftId = "working", onExit, onDocs, onPublished }) {
  const { layout, me, isAdmin } = React.useContext(window.LayoutCtx);
  const columns = (layout.sections || []).map(s => s.name);
  const canPub = window.canPublish(layout, session && session.user_id);
  const isMobile = window.useIsMobile();
  const [mTab, setMTab] = useState("write");          // mobile: write | contents | sources
  const [view, setView] = useState("prose");          // prose editor | grounding workspace (grounding / citations / sources) | graph — same draft
  const [graphText, setGraphText] = useState("");      // plain text fed to the eoreader4 proposition graph (refreshed on entering the Graph view)
  const [structMode, setStructMode] = useState("nested"); // CONTENTS rail: nested outline (holonic) | graph
  const [activeId, setActiveId] = useState(null);      // heading the reader is currently scrolled into (outline "you are here")
  const [theme, setTheme] = useState(nrTheme);        // light | dark — persisted
  const toggleTheme = () => setTheme(t => { const next = t === "light" ? "dark" : "light"; try { localStorage.setItem(THEME_KEY, next); } catch (e) {} return next; });
  const restored = useRef(false);                      // gate autosave until the first restore lands
  const saveTimer = useRef(null);
  const htmlRef = useRef("");                          // last seen editor HTML (survives unmount, when ed.current is gone)

  const [sources, setSources] = useState([]);
  const [citeOrder, setCiteOrder] = useState([]);
  const citeOrderRef = useRef([]);
  // stable per-sentence identity + provenance (app/sentences.js). Rides the draft
  // so a sentence's grounding follows it through edits, moves, reloads.
  const sentenceLedger = useRef(window.NpjSentences ? window.NpjSentences.newLedger() : { v: 1, seq: 0, entries: {} });
  const [armSrc, setArmSrc] = useState(null);       // source picked first; next selection binds to it
  const [citeHl, setCiteHl] = useState(nrCiteHl);   // show citation/claim highlights in the prose editor — off = a clean read (remembered across reloads)
  const [rev, setRev] = useState(0);                // bump to recompute span counts
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [interviewOpen, setInterviewOpen] = useState(false); // the "cite a conversation" composer
  const [redactTarget, setRedactTarget] = useState(null);   // Citey's PII review, open on a source key
  const [publish, setPublish] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null); // built article for the live "exactly as published" preview
  const [statusBusy, setStatusBusy] = useState(false); // an unpublish in flight
  const [statusErr, setStatusErr] = useState(null);
  const [title, setTitle] = useState("");            // explicit Title field (mirrors the body <h1>)
  const [dek, setDek] = useState("");                // explicit Subtitle field (mirrors .nr-dek)
  const [fileSlug, setFileSlug] = useState("");      // custom filename; "" = derived from the title
  const [tags, setTags] = useState([]);
  const [column, setColumn] = useState(columns[0] || "");
  const [toc, setToc] = useState([]);
  // the piece's glossary (term → definition); extracted by eoreader4, drawn from
  // the collective published record (app/definitions.js), published like tags.
  const [definitions, setDefinitions] = useState([]);   // edited in the Definitions view (a top-bar tab)
  // ---- editing-only post structure (app/structure.js) ----
  // the append-only event log is the source of truth; `structure` is its fold.
  // Stamped onto headings as data-sec (stable identity across renames/reorders),
  // persisted with the draft, NEVER published (stripped at build — Invariant I1).
  const structLog = useRef([]);
  const [structure, setStructure] = useState(() => (window.NpjStructure ? window.NpjStructure.emptyState(draftId) : null));
  const [structTypes, setStructTypes] = useState(() => (window.NpjStructure ? window.NpjStructure.types.all() : []));
  const [blankChosen, setBlankChosen] = useState(false);   // dismissed the start-a-post picker
  const reconcileRef = useRef(null);
  const reconcileTimer = useRef(null);
  const [media, setMedia] = useState([]);           // images + embeds in the piece
  const [viewer, setViewer] = useState(null);       // index into the image list — the media viewer
  const [archiveStat, setArchiveStat] = useState(null);  // { total, pending, archived } — media-store images vs. pre-archived
  const [prearch, setPrearch] = useState(null);     // null | {done,total} in flight | {result} | {error} — proactive archive.org upload
  const [explorer, setExplorer] = useState(null);   // { key } — the source file explorer, open on a source
  const [showVersions, setShowVersions] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [rooms, setRooms] = useState(null);
  const [collabs, setCollabs] = useState(() => (session ? [session.user_id] : []));
  const [room, setRoom] = useState(null);            // the project this document belongs to
  const [commentsOn, setCommentsOn] = useState(false); // when on, the right panel is the e2ee collaboration rail
  const [invite, setInvite] = useState(false);
  const [inviteVal, setInviteVal] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [projects, setProjects] = useState(null);    // existing projects, for the picker
  const [projPick, setProjPick] = useState("");      // "" = start a new project for this doc
  const ed = useRef(null);
  const scroller = useRef(null);                     // the editor scroll container (the page scrolls inside it)
  const selRange = useRef(null);
  const popoverFileRef = useRef(null);               // the source popover's hidden upload input
  const bindAfterInterview = useRef(false);          // an interview minted from the popover binds to the saved span

  // let Citey drop suggested tags in (and read the columns for its column hint)
  useEffect(() => {
    window.__draftTags = { add: (t) => setTags(list => list.includes(t) ? list : [...list, t]), get: () => tags, columns: () => columns };
    return () => { if (window.__draftTags) delete window.__draftTags; };
  });

  // ---- durable drafts: restore on open, autosave on every change ----
  // localStorage = instant recovery on refresh; Matrix account data = the
  // authoritative copy that survives a browser wipe / new device (app/drafts.js).
  const persist = useCallback(() => {
    if (!restored.current) return;
    const html = ed.current ? ed.current.innerHTML : htmlRef.current;
    const sourceRecords = {};
    sources.forEach(s => { if (window.NPJ.SOURCES[s.key]) sourceRecords[s.key] = window.NPJ.SOURCES[s.key]; });
    const citations = window.NpjCitations ? window.NpjCitations.serialize() : [];
    const sentenceLedgerJson = window.NpjSentences ? window.NpjSentences.serializeLedger(sentenceLedger.current) : undefined;
    const composition = window.NpjComposition ? window.NpjComposition.serialize(draftId) : undefined;
    window.NpjDrafts.save(draftId, { html, title, slug: fileSlug, tags, column, definitions, sources, citeOrder: citeOrderRef.current, sourceRecords, citations, sentenceLedger: sentenceLedgerJson, composition, room, structure: structLog.current });
    saveTimer.current = null;
  }, [draftId, title, fileSlug, tags, column, definitions, sources, room]);
  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; });
  const scheduleSave = useCallback(() => {
    if (!restored.current) return;
    if (ed.current) htmlRef.current = ed.current.innerHTML;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 500);
  }, [persist]);
  // leaving the editor (sign-out, route change) with a save still in its
  // debounce window? write it now — those last keystrokes used to be lost
  useEffect(() => () => {
    // flush a pending structure reconcile first, so the last heading is in the
    // log before the final save, then write whatever's still in the debounce.
    if (reconcileTimer.current) { clearTimeout(reconcileTimer.current); try { reconcileRef.current && reconcileRef.current(); } catch (e) {} }
    if (saveTimer.current) { clearTimeout(saveTimer.current); try { persistRef.current(); } catch (e) {} }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let d = null;
      try { d = await window.NpjDrafts.restore(draftId); } catch (e) {}
      if (alive && d) {
        if (d.sourceRecords) Object.assign(window.NPJ.SOURCES, d.sourceRecords); // rehydrate source cards
        if (d.citations && window.NpjCitations) window.NpjCitations.hydrate(d.citations); // rehydrate citation records
        if (d.sentenceLedger && window.NpjSentences) sentenceLedger.current = window.NpjSentences.hydrateLedger(d.sentenceLedger); // stable sentence ids survive reload
        if (d.composition && window.NpjComposition) window.NpjComposition.hydrate(draftId, d.composition); // carry the typed-vs-pasted record across reloads
        if (ed.current && d.html) {
          ed.current.innerHTML = d.html;
          // older drafts predate the dek — every article gets the field
          if (!ed.current.querySelector(".nr-dek")) {
            const h1 = ed.current.querySelector("h1");
            if (h1) { const p = document.createElement("p"); p.className = "nr-dek"; p.setAttribute("data-ph", DEK_PH); p.innerHTML = "<br/>"; h1.after(p); }
          }
          // older drafts predate source-span pinning — backfill a stable cid on
          // each bound span + its marker (so it can be pinned), and flag any span
          // without a pinned quote so the author goes back and points at the
          // exact words in the source (the publish build will hold them to it)
          ed.current.querySelectorAll(".claim-src").forEach((el, i) => {
            let cid = el.getAttribute("data-cid");
            if (!cid) { cid = "cs-legacy-" + Date.now().toString(36) + "-" + i; el.setAttribute("data-cid", cid); }
            const sup = el.nextElementSibling;
            if (sup && sup.classList && sup.classList.contains("md-cite") && !sup.hasAttribute("data-cid")) {
              sup.setAttribute("data-cid", cid);
              if (!sup.hasAttribute("data-quote")) sup.setAttribute("data-quote", el.getAttribute("data-quote") || "");
            }
            if (!(el.getAttribute("data-quote") || "").trim()) el.classList.add("needs-quote");
          });
          // back-fill citation RECORDS from any inline data-quote (idempotent —
          // skips spans that already carry data-cite-id), so legacy drafts gain
          // reusable citations the first time they're opened, with no data loss.
          if (window.NpjCitations) window.NpjCitations.migrateRoot(ed.current);
          // a draft saved with a footnote marker stranded on its own line (an
          // Enter/paste/drag cloned a trailing marker) shows a stray number until
          // it's touched — fold/drop it now so the page opens clean, then renumber.
          if (destrandFootnotes()) renumberFootnotes();
          // likewise, stitch any word cut across a paragraph break (an old draft
          // saved mid-word) so the editor opens showing exactly what was written.
          healSplitBlocks();
          // hydrate the explicit Subtitle field from the restored .nr-dek node
          const dekEl0 = ed.current.querySelector(".nr-dek");
          if (dekEl0) setDek((dekEl0.textContent || "").trim());
        }
        if (d.title) setTitle(d.title);
        if (typeof d.slug === "string") setFileSlug(d.slug);
        if (Array.isArray(d.tags)) setTags(d.tags);
        if (Array.isArray(d.definitions)) setDefinitions(window.NpjDefinitions ? window.NpjDefinitions.normList(d.definitions) : d.definitions);
        if (d.column) setColumn(d.column);
        // Strip in-flight UI flags that may have been autosaved mid-operation:
        // after a restore nothing is driving that async work, so a persisted
        // snapshotting / uploading / ocr flag would spin its row forever. Re-derive
        // "archived" from whether the rehydrated record actually has a snapshot.
        if (Array.isArray(d.sources)) setSources(d.sources.map(s => {
          const rec = (s && s.key && window.NPJ.SOURCES[s.key]) || null;
          const { snapshotting, uploading, ocr, uploadErr, ...rest } = s || {};
          return { ...rest, archived: !!(rec && rec.archive_url) };
        }));
        if (Array.isArray(d.citeOrder)) { citeOrderRef.current = d.citeOrder; setCiteOrder(d.citeOrder); }
        if (d.room) setRoom(d.room);
        // rehydrate the structure log; the post-restore scanHeadings reconciles
        // it with the DOM (legacy drafts with no log fold to organic sections).
        if (Array.isArray(d.structure) && window.NpjStructure) {
          structLog.current = d.structure;
          const s0 = window.NpjStructure.fold(d.structure); s0.articleId = draftId; setStructure(s0);
          if (d.structure.length) setBlankChosen(true);
        }
        setTimeout(scanHeadings, 30); setRev(v => v + 1);
      }
      // baseline the composition tracker to whatever's now in the editor (seed or
      // restored body) so the first real keystroke — not the load — starts the count
      if (window.NpjComposition) window.NpjComposition.attach(draftId, ed.current ? (ed.current.textContent || "").length : 0);
      restored.current = true;
    })();
    return () => { alive = false; };
  }, [draftId]);

  useEffect(() => { if (session) window.NpjDrafts.flush(draftId); }, [session, draftId]); // push local-only work up after sign-in
  useEffect(() => { scheduleSave(); }, [title, fileSlug, tags, column, sources, room, scheduleSave]);
  // entering a grounding view builds/extends the stable-id ledger (track()) — save
  // so those ids persist even if the author switches views without editing
  useEffect(() => { if (view !== "prose") scheduleSave(); }, [view, scheduleSave]);
  // A plain Return is a paragraph break; pin the browser's block separator to <p>
  // so Return splits into <p> blocks consistently (Chrome/Firefox/Safari differ on
  // the default). The publish pipeline (htmlToBlocks) and the reader then render a
  // Return as a spaced paragraph and a Shift+Return as a tight <br> — see onEditorKeyDown.
  useEffect(() => { try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {} }, []);

  // ---- headings → ids + contents rail (jump-links) ----
  const scanHeadings = useCallback(() => {
    if (!ed.current) return;
    const seen = {};
    const hs = Array.from(ed.current.querySelectorAll("h1,h2,h3"));
    const items = [];
    hs.forEach(h => {
      const text = (h.innerText || "").trim();
      if (!text) return;
      let id = "s-" + slugify(text);
      if (seen[id]) { seen[id]++; id += "-" + seen[id]; } else seen[id] = 1;
      h.id = id;
      // the headline is the explicit Title field, not a section jump-link
      if (h.tagName !== "H1") items.push({ id, text, level: +h.tagName[1] });
    });
    setToc(items);
    // media census: every figure with a filled image slot or an embed.
    // Figures get a stable data-mid so the rail/viewer can jump to them.
    const found = [];
    Array.from(ed.current.querySelectorAll("figure")).forEach((f, i) => {
      if (!f.dataset.mid) f.dataset.mid = "m" + Date.now().toString(36) + i;
      const slot = f.querySelector("image-slot");
      const url = slot ? (slot.url || slot.getAttribute("src")) : null;
      const embed = f.getAttribute("data-embed-url");
      const cap = f.querySelector("figcaption:not(.cmp-credit):not(.cmp-desc):not(.cmp-embed-hint)");
      const caption = cap ? (cap.textContent || "").trim() : (f.classList.contains("nr-banner") ? "banner" : "");
      if (url) found.push({ kind: "image", url, mid: f.dataset.mid, caption });
      else if (embed) found.push({ kind: "embed", url: embed, mid: f.dataset.mid, caption });
    });
    setMedia(found);
    // census the draft's images for the proactive archive.org affordance: how many
    // are still on the media store (and so cost a freeze at publish) vs. already
    // carry a durable archive.org copy.
    if (window.NpjMedia && window.NpjMedia.prearchiveCensus) setArchiveStat(window.NpjMedia.prearchiveCensus(ed.current));
    // keep the structure layer in step with the headings — debounced, so a burst
    // of typing coalesces into one reconcile instead of an event per keystroke.
    clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => { if (reconcileRef.current) reconcileRef.current(); }, 350);
  }, []);
  useEffect(() => { const t = setTimeout(scanHeadings, 60); return () => clearTimeout(t); }, [scanHeadings]);

  // ---- structure layer: DOM ⇄ log reconcile, fold, reflow ----
  // refold the append-only log into the live PostStructure.
  const refoldStruct = useCallback(() => {
    if (!window.NpjStructure) return null;
    const s = window.NpjStructure.fold(structLog.current); s.articleId = draftId; setStructure(s); return s;
  }, [draftId]);

  // reorder the document's section-spans to match the structure's flattened
  // order so WYSIWYG === what publishes (lead nodes — banner, title, dek, intro —
  // stay put). Only fires on explicit structural reorders, never mid-typing, so
  // it can't fight the caret. Moving an <image-slot> figure is safe: it reloads
  // its image by id. The span surgery itself lives in (and is tested in) the
  // engine's dom bridge.
  const reflowDOM = useCallback((orderedIds) => {
    if (!window.NpjStructure || !ed.current) return;
    if (window.NpjStructure.dom.reflow(ed.current, orderedIds)) setTimeout(() => { scanHeadings(); scheduleSave(); }, 0);
  }, [scanHeadings, scheduleSave]);

  // append events, refold, optionally reflow the document, persist.
  const dispatchStruct = useCallback((events, opts) => {
    if (!window.NpjStructure || !events || !events.length) return;
    structLog.current = structLog.current.concat(events);
    const s = refoldStruct();
    if (opts && opts.reflow && s) reflowDOM(window.NpjStructure.flattenIds(s));
    scheduleSave();
  }, [refoldStruct, reflowDOM, scheduleSave]);

  // DOM → log: keep the structure in step with the headings the author writes.
  // scanHeadings has already stamped each heading's slug onto h.id, so the engine
  // reads that as the binding slug. Emits nothing when nothing changed.
  const reconcileStructure = () => {
    const lib = window.NpjStructure, root = ed.current;
    if (!lib || !root) return;
    const evs = lib.dom.reconcile(root, structLog.current, { slugFor: h => h.id });
    if (!evs.length) return;
    structLog.current = structLog.current.concat(evs);
    refoldStruct();
    scheduleSave();
  };
  useEffect(() => { reconcileRef.current = reconcileStructure; });

  // pull the author's saved post types in (localStorage + Matrix mirror).
  useEffect(() => {
    if (!window.NpjStructure) return;
    setStructTypes(window.NpjStructure.types.all());
    Promise.resolve(window.NpjStructure.types.sync()).then(() => setStructTypes(window.NpjStructure.types.all())).catch(() => {});
  }, [session]);

  // ---- explicit Title / Subtitle fields ----
  // The fields are the source of truth; each writes through to the hidden body
  // <h1> / .nr-dek so the publish gate, reader, markdown export and front page
  // keep reading exactly what they always have — no pipeline change.
  const onTitleInput = useCallback((v) => {
    setTitle(v);
    const root = ed.current;
    if (root) {
      let h1 = root.querySelector("h1");
      if (!h1) { h1 = document.createElement("h1"); const b = root.querySelector("figure.nr-banner"); if (b) b.after(h1); else root.insertBefore(h1, root.firstChild); }
      h1.textContent = v;
    }
    scheduleSave();
  }, [scheduleSave]);
  const onDekInput = useCallback((v) => {
    setDek(v);
    const root = ed.current;
    if (root) {
      let d = root.querySelector(".nr-dek");
      if (!d) { d = document.createElement("p"); d.className = "nr-dek"; d.setAttribute("data-ph", DEK_PH); const h1 = root.querySelector("h1"); if (h1) h1.after(d); else root.insertBefore(d, root.firstChild); }
      if (v) d.textContent = v; else d.innerHTML = "<br/>";
    }
    scheduleSave();
  }, [scheduleSave]);

  const scrollToId = (id) => {
    const cont = scroller.current, body = ed.current; if (!cont || !body) return;
    const el = body.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
    if (!el) return;
    const cr = cont.getBoundingClientRect(), er = el.getBoundingClientRect();
    cont.scrollTop += (er.top - cr.top) - 18;
  };

  // Refresh the text the proposition graph reads. The editor is only editable in
  // prose view, so a debounced refresh on input keeps the rail's compact graph
  // live; entering either graph surface (the Graph view, or the rail in graph
  // mode) refreshes at once. docFor() caches by text, so unchanged prose is free.
  const graphTimer = useRef(null);
  const refreshGraphText = useCallback(() => { setGraphText(ed.current ? (ed.current.innerText || "") : ""); }, []);
  const scheduleGraphText = useCallback(() => { clearTimeout(graphTimer.current); graphTimer.current = setTimeout(refreshGraphText, 700); }, [refreshGraphText]);
  useEffect(() => { if (view === "graph" || structMode === "graph") refreshGraphText(); }, [view, structMode, refreshGraphText]);

  // Outline "you are here": track the heading the reader is currently scrolled
  // into (the last heading above the top of the viewport) and highlight its row.
  useEffect(() => {
    const cont = scroller.current; if (!cont || view !== "prose") return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const root = ed.current; if (!root) return;
        const hs = Array.from(root.querySelectorAll("h1,h2,h3")).filter(h => h.id);
        const top = cont.getBoundingClientRect().top + 60;
        let cur = null;
        for (let i = 0; i < hs.length; i++) { if (hs[i].getBoundingClientRect().top <= top) cur = hs[i].id; else break; }
        setActiveId(cur || (hs[0] && hs[0].id) || null);
      });
    };
    cont.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { cont.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [toc, view]);

  // Clicking a node/edge in the graph jumps back to where that proposition sits
  // in the prose: switch to the editor, find the block holding the sentence (or
  // the entity name), scroll to it and flash it.
  const jumpToProse = useCallback((info) => {
    setView("prose");
    setTimeout(() => {
      const root = ed.current, cont = scroller.current; if (!root || !cont) return;
      const needle = String((info && (info.text || info.label)) || "").trim().slice(0, 60).toLowerCase();
      if (!needle) return;
      const blocks = Array.from(root.querySelectorAll("h1,h2,h3,p,li,blockquote"));
      let target = blocks.find(b => (b.innerText || "").toLowerCase().includes(needle));
      if (!target && info && info.label) { const lb = String(info.label).toLowerCase(); target = blocks.find(b => (b.innerText || "").toLowerCase().includes(lb)); }
      if (!target) return;
      const cr = cont.getBoundingClientRect(), er = target.getBoundingClientRect();
      cont.scrollTop += (er.top - cr.top) - 40;
      target.classList.add("nr-jump-flash");
      setTimeout(() => { try { target.classList.remove("nr-jump-flash"); } catch (e) {} }, 1200);
    }, 50);
  }, []);

  // the api the structure rail (app/PostStructure.jsx) drives. Every mutation
  // goes through dispatchStruct → append-only log → fold → (reflow) → persist.
  const structApi = useMemo(() => {
    const lib = window.NpjStructure; if (!lib) return null;
    const appliedType = (structure && structure.appliedTypeId)
      ? (structTypes.find(t => t.id === structure.appliedTypeId) || lib.types.get(structure.appliedTypeId)) : null;
    return {
      state: structure, types: structTypes, appliedType,
      hasContent: blankChosen || toc.length > 0 || !!(structure && structure.sections.length),
      applyType: (typeId) => { const t = lib.types.get(typeId); if (t) { setBlankChosen(true); dispatchStruct(lib.ops.applyType(structure, t), { reflow: true }); } },
      startBlank: () => { setBlankChosen(true); if (ed.current) ed.current.focus(); },
      removeType: () => dispatchStruct(lib.ops.removeType(), { reflow: true }),
      saveType: (name) => { const t = lib.saveFrom(structure, name); lib.types.save(t); setStructTypes(lib.types.all()); dispatchStruct(lib.ops.saveType(structure, t.id)); },
      addSlot: (slotId) => { const sl = lib.slotById(structure, slotId); if (sl) dispatchStruct(lib.ops.addSlot(structure, sl)); },
      // "Start →": lay this slot's section into the page so the prompt guides
      // writing in context. An H2 carrying the slot label (selected, so the first
      // keystroke replaces it) + a ghost prompt paragraph that publishes nothing
      // while empty (the .nr-dek mechanism). The section is created bound to this
      // slot, then reflowed into place; reconcile keeps it bound as you type.
      startSlot: (slotId) => {
        const sl = lib.slotById(structure, slotId); if (!sl || !ed.current) return;
        const label = sl.label || "New section";
        const evs = lib.ops.createSection(slotId, 1e6, { heading: label });
        const secId = evs[0] && evs[0].id; if (!secId) return;
        const h = document.createElement("h2"); h.setAttribute("data-sec", secId); h.textContent = label;
        const p = document.createElement("p"); p.className = "nr-prompt"; if (sl.prompt) p.setAttribute("data-ph", sl.prompt); p.innerHTML = "<br>";
        ed.current.appendChild(h); ed.current.appendChild(p);
        dispatchStruct(evs, { reflow: true });
        setTimeout(() => {
          scanHeadings();
          try { const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(h); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
          if (h.id) scrollToId(h.id);
          if (ed.current) ed.current.focus();
        }, 0);
      },
      moveSection: (id, parent, order) => dispatchStruct(lib.ops.moveSection(id, parent, order), { reflow: true }),
      moveBulk: (ids, parent, order) => dispatchStruct(lib.ops.moveBulk(ids, parent, order), { reflow: true }),
      reorderSlot: (id, order) => dispatchStruct(lib.ops.reorderSlot(id, order), { reflow: true }),
      deleteSection: (id) => dispatchStruct(lib.ops.deleteSection(id)),
      jumpTo: (slug) => { if (isMobile) setMTab("write"); setTimeout(() => scrollToId(slug), isMobile ? 30 : 0); }
    };
  }, [structure, structTypes, blankChosen, toc.length, dispatchStruct, isMobile]);

  // ---- in-document block drag (the Google-Docs/Notion grip) ----------------
  // A grip in the page's left gutter lets the author grab any block — paragraph,
  // image, quote, list — and drop it elsewhere. Grabbing a HEADING moves its
  // whole section, routed through the structure log (lib.sectionDropIndex, the
  // same math the Contents rail uses) so the outline stays in step. Any other
  // block moves in the DOM directly — the structure layer only tracks headings,
  // and a paragraph simply belongs to whichever section's span it now sits in.
  // Desktop only: there's room in the gutter and a real pointer to grab with.
  const blockDrag = useRef(null);    // { el, isHeading, secId } for the duration of a drag
  const dropPlan = useRef(null);     // { refEl|null, indicator } recomputed on each dragover
  const gripRaf = useRef(0);
  const [grip, setGrip] = useState(null);      // { top, left, isHeading, block } — the hover handle
  const [gripHover, setGripHover] = useState(false); // pointer is over the grip → reveal its delete button
  const [dropAt, setDropAt] = useState(null);  // { top, left, width } — the insertion line
  const [dragging, setDragging] = useState(false);

  const isLeadBlock = (b) => !!(b && (b.tagName === "H1" || (b.classList && (b.classList.contains("nr-dek") || (b.tagName === "FIGURE" && b.classList.contains("nr-banner"))))));
  const isMovableBlock = (b) => !!(b && b.nodeType === 1 && b.tagName !== "BR" && !isLeadBlock(b));
  const isHeadingBlock = (b) => !!(b && /^H[2-3]$/.test(b.tagName || ""));
  // a "void" block — one the caret can't simply backspace away: an image, an
  // embed, a widget/poll, anything contenteditable=false, or a wrapper holding
  // one. These get a click-to-delete × in their top-right corner (plain text is
  // already removable with the keyboard / the gutter grip). We match the slot or
  // embed WHEREVER it sits — itself or any descendant, any wrapper tag — so this
  // covers legacy and wrapped image blocks, not just today's <figure>. The banner
  // is a lead node and is never offered the ×.
  const VOID_SEL = "image-slot, iframe, video, [data-embed-url], [data-widget]";
  const isVoidBlock = (b) => {
    if (!b || b.nodeType !== 1 || isLeadBlock(b)) return false;
    if (b.getAttribute && b.getAttribute("contenteditable") === "false") return true;
    if (b.matches && b.matches(VOID_SEL)) return true;
    return !!(b.querySelector && b.querySelector(VOID_SEL));
  };
  // walk up to the direct child of the editor root that holds this node
  const topBlockOf = (node) => {
    const root = ed.current; if (!root) return null;
    let el = node;
    while (el && el !== root && el.parentNode !== root) el = el.parentNode;
    return (el && el.parentNode === root) ? el : null;
  };

  // hover → place the grip beside the block under the cursor. While the pointer
  // sits in the gutter (over the editor itself, not a block) we keep the last
  // grip, so the author can travel out to grab it without it vanishing.
  const onEdMouseMove = (e) => {
    if (isMobile || dragging) return;
    if (gripRaf.current) return;
    const target = e.target;
    gripRaf.current = requestAnimationFrame(() => {
      gripRaf.current = 0;
      const root = ed.current, sc = scroller.current; if (!root || !sc) return;
      const block = topBlockOf(target);
      if (!isMovableBlock(block)) return; // gutter / lead node — leave the grip where it is
      const sRect = sc.getBoundingClientRect(), bRect = block.getBoundingClientRect();
      const top = bRect.top - sRect.top + sc.scrollTop;
      const left = bRect.left - sRect.left + sc.scrollLeft - 26;
      const right = bRect.right - sRect.left + sc.scrollLeft;
      setGrip(prev => (prev && prev.block === block && Math.abs(prev.top - top) < 0.5) ? prev : { top, left, right, isHeading: isHeadingBlock(block), block });
    });
  };
  const clearGrip = () => { if (!dragging) setGrip(null); };

  const onGripDragStart = (e) => {
    const block = grip && grip.block;
    if (!block || !ed.current || !ed.current.contains(block)) { e.preventDefault(); return; }
    const isHeading = isHeadingBlock(block);
    let secId = null;
    if (isHeading) { try { reconcileStructure(); } catch (x) {} secId = block.getAttribute("data-sec"); }
    blockDrag.current = { el: block, isHeading, secId };
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); e.dataTransfer.setDragImage(block, 14, 12); } catch (x) {}
    // Defer the "dragging" visuals by a frame. setDragging re-renders the grip —
    // the drag SOURCE node — and dimming the block mutates it too; doing either
    // synchronously inside dragstart makes Chrome cancel the drag before it
    // begins (the reported "drag does nothing"). One frame on, the drag is live,
    // so hiding the grip + fading the block is safe.
    requestAnimationFrame(() => {
      if (!blockDrag.current || blockDrag.current.el !== block) return;
      setDragging(true);
      block.classList.add("nr-block-dragging");
    });
  };

  // where would a drop land right now? Returns the reference block to insert
  // before (null = end of document) and the geometry of the insertion line.
  const computeBlockDrop = (clientY) => {
    const d = blockDrag.current, root = ed.current, sc = scroller.current;
    if (!d || !root || !sc) return null;
    const kids = Array.prototype.slice.call(root.children).filter(b => b.nodeType === 1);
    let firstBody = 0;
    for (let i = 0; i < kids.length; i++) { if (isLeadBlock(kids[i])) firstBody = i + 1; else break; }
    let k = kids.length;
    for (let i = firstBody; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (clientY < r.top + r.height / 2) { k = i; break; } }
    if (k < firstBody) k = firstBody;
    let refEl = null;
    if (d.isHeading) {
      // sections drop between sections — snap to the next section heading
      for (let i = k; i < kids.length; i++) { const b = kids[i]; if (isHeadingBlock(b) && b !== d.el && b.getAttribute("data-sec")) { refEl = b; break; } }
    } else {
      refEl = kids[k] || null;
    }
    const sRect = sc.getBoundingClientRect();
    const sample = kids[firstBody] || refEl || kids[kids.length - 1];
    if (!sample) return null;
    const smr = sample.getBoundingClientRect();
    const left = smr.left - sRect.left + sc.scrollLeft;
    const width = Math.max(40, smr.width);
    let top;
    if (refEl) { const rr = refEl.getBoundingClientRect(); top = rr.top - sRect.top + sc.scrollTop - 1; }
    else { const last = kids[kids.length - 1]; const rr = last.getBoundingClientRect(); top = rr.bottom - sRect.top + sc.scrollTop - 1; }
    return { refEl, indicator: { top, left, width } };
  };

  const onBlockDragOver = (e) => {
    if (!blockDrag.current) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch (x) {}
    const plan = computeBlockDrop(e.clientY);
    dropPlan.current = plan;
    setDropAt(prev => (plan && prev && Math.abs(prev.top - plan.indicator.top) < 0.5 && prev.left === plan.indicator.left) ? prev : (plan ? plan.indicator : null));
  };

  const performBlockDrop = (d, plan) => {
    const root = ed.current, lib = window.NpjStructure; if (!root) return;
    if (d.isHeading && d.secId && lib) {
      const st = lib.fold(structLog.current); // fold fresh — dragstart may have just reconciled
      if (plan && plan.refEl) {
        const refSec = plan.refEl.getAttribute("data-sec");
        if (!refSec || refSec === d.secId) return;
        const m = lib.sectionDropIndex(st, d.secId, refSec, "before");
        if (m) structApi.moveSection(d.secId, m.parentSlotId, m.index);
      } else {
        const ids = lib.flattenIds(st), lastId = ids[ids.length - 1];
        if (!lastId || lastId === d.secId) return; // already last
        const lastSec = lib.sectionById(st, lastId);
        structApi.moveSection(d.secId, lastSec ? lastSec.parentSlotId : null, 1e6);
      }
    } else {
      const ref = plan ? plan.refEl : null;
      if (ref === d.el || (ref && ref.previousSibling === d.el)) return; // no move
      try { root.insertBefore(d.el, ref); } catch (x) { return; }
      scanHeadings(); scheduleSave();
    }
  };

  const endBlockDrag = () => {
    const d = blockDrag.current;
    if (d && d.el && d.el.classList) d.el.classList.remove("nr-block-dragging");
    blockDrag.current = null; dropPlan.current = null;
    setDragging(false); setDropAt(null); setGrip(null);
  };
  const onBlockDrop = (e) => {
    const d = blockDrag.current; if (!d) return;
    e.preventDefault(); e.stopPropagation();
    performBlockDrop(d, dropPlan.current || computeBlockDrop(e.clientY));
    endBlockDrag();
  };

  // ---- delete a block from the grip ----------------------------------------
  // The only way to remove a non-editable figure (image / embed): the caret
  // can't enter a contenteditable=false block to backspace it away. Works for
  // any movable block the grip offers. A removed heading drops its section
  // annotation on the next reconcile (its prose stays put — I3, structure-dom
  // test). Lead nodes (banner / title / dek) are never offered a grip; guard
  // anyway so this can't strand the headline or subtitle.
  const blockDelLabel = (block) => {
    if (!block) return "Delete this block";
    if (block.querySelector && block.querySelector("image-slot")) return "Delete this image";
    if ((block.getAttribute && block.getAttribute("data-embed-url")) ||
        (block.querySelector && block.querySelector("[data-embed-url], iframe, video"))) return "Delete this embed";
    if (block.matches && block.matches("[data-widget]")) return "Delete this block";
    if (isHeadingBlock(block)) return "Delete this heading";
    return "Delete this block";
  };
  const deleteBlock = (block) => {
    const root = ed.current;
    if (!block || !root || !root.contains(block) || isLeadBlock(block)) return;
    const wasHeading = isHeadingBlock(block);
    try { block.remove(); } catch (x) { return; }
    // never leave the body with no editable line for the caret to land in
    if (!root.querySelector("p, h1, h2, h3, li, blockquote, figcaption")) {
      const p = document.createElement("p"); p.appendChild(document.createElement("br")); root.appendChild(p);
    }
    setGrip(null); setGripHover(false);
    if (wasHeading) { try { reconcileStructure(); } catch (x) {} } // drop the section now, not on the debounce
    scanHeadings(); scheduleSave();
  };

  const onBodyClick = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a) { e.preventDefault(); scrollToId(a.getAttribute("href").slice(1)); return; }
    // clean read = a plain writing surface: a click just places the caret. Don't
    // hijack it with the source-pin popover when the author has the citation layer
    // turned off — that's the "I can't click into my own sentence" frustration.
    if (!citeHl) return;
    // click a cited span (or its marker) to pin / re-pin the words in the source
    const cs = e.target.closest && e.target.closest(".claim-src, sup.md-cite[data-cid]");
    if (cs && cs.getAttribute("data-cid")) {
      const cid = cs.getAttribute("data-cid");
      const span = ed.current && ed.current.querySelector('.claim-src[data-cid="' + cid + '"]');
      // clicking a marker pins THAT source; clicking the span opens its first source
      // (the popover lists the rest, and can add another) — a span can cite several
      const key = cs.classList && cs.classList.contains("md-cite")
        ? cs.getAttribute("data-cite")
        : ((span && span.getAttribute("data-src")) || cs.getAttribute("data-src") || cs.getAttribute("data-cite") || "").split(/\s+/).filter(Boolean)[0] || "";
      openPin(cid, key, span ? (span.textContent || "").trim() : "");
    }
  };

  // ---- selection plumbing ----
  useEffect(() => {
    const f = () => { const s = window.getSelection(); if (s && s.rangeCount && ed.current && ed.current.contains(s.anchorNode)) selRange.current = s.getRangeAt(0).cloneRange(); };
    document.addEventListener("selectionchange", f);
    return () => document.removeEventListener("selectionchange", f);
  }, []);
  const restore = () => { const s = window.getSelection(); if (selRange.current) { s.removeAllRanges(); s.addRange(selRange.current); } else ed.current && ed.current.focus(); };
  // Land a usable caret INSIDE the body before a programmatic insert. Toolbar
  // buttons keep focus on the button (their onMouseDown preventDefaults), so when
  // the author hasn't clicked into the prose yet — they only filled the Title /
  // Subtitle fields, say, or just bound a source (which clears the saved range) —
  // the live selection sits outside the editor and execCommand would drop the
  // node at offset 0, above the non-editable banner figure (the "add image seems
  // broken" report). Prefer a live in-body selection, then the last saved in-body
  // range, else the very end of the document.
  const caretIntoBody = () => {
    const root = ed.current; if (!root) return;
    const s = window.getSelection(); if (!s) return;
    const inBody = (r) => !!(r && r.startContainer && root.contains(r.startContainer));
    // Read the live selection BEFORE focusing: focus() on a contenteditable that
    // was never given a caret can synthesize an offset-0 range (which sits above
    // the banner), and we must not mistake that for a caret the author placed.
    let r = s.rangeCount ? s.getRangeAt(0) : null;
    if (!inBody(r)) r = inBody(selRange.current) ? selRange.current.cloneRange() : null;
    root.focus();
    if (!r) { r = document.createRange(); r.selectNodeContents(root); r.collapse(false); }
    s.removeAllRanges(); s.addRange(r);
  };
  // WebKit doesn't upgrade custom elements inserted through
  // execCommand("insertHTML"): a freshly-dropped-in <image-slot> never runs its
  // connectedCallback, so the slot's drag/drop + paste listeners never attach —
  // dropping a photo onto it does nothing until a reload re-parses the HTML
  // ("had to refresh before the photo drop zone worked"). Force the upgrade so
  // an inserted slot is live at once. No-op where the engine already upgrades
  // (Chromium); skips already-upgraded nodes, so it never re-runs a live slot.
  const upgradeCustomEls = () => { try { const r = ed.current; if (r && window.customElements && customElements.upgrade) customElements.upgrade(r); } catch (e) {} };
  const exec = (cmd, val) => { ed.current && ed.current.focus(); restore(); document.execCommand(cmd, false, val); scanHeadings(); scheduleSave(); };
  // Select the whole draft body so an alignment (or any block command) applies to
  // every paragraph at once — the "select all, then justify the lot" path. We seed
  // selRange too, so the toolbar's exec()/restore() re-applies this full range
  // instead of collapsing back to the last caret.
  const selectAllBody = () => {
    const root = ed.current; if (!root) return;
    root.focus();
    const r = document.createRange(); r.selectNodeContents(root);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    selRange.current = r.cloneRange();
  };
  const insertHTML = (html) => { if (!ed.current) return; caretIntoBody(); document.execCommand("insertHTML", false, html); scanHeadings(); scheduleSave(); };
  // Block-level components (image, embed, verse, poll) can't be nested inside the
  // banner, headline or dek — put the caret in the body, then step past any such
  // block, so the new block always lands in the prose flow rather than splitting a
  // heading or vanishing into the non-editable banner figure.
  const insertBlock = (html) => { caretIntoBody(); escapeBlock(); document.execCommand("insertHTML", false, html); upgradeCustomEls(); scanHeadings(); scheduleSave(); };
  // caption + credit are editable lines under the (non-editable) figure (FIG_CAPS,
  // module scope). The credit carries a hyperlink the same way a contributor bio
  // does — a name and an optional [outlet](https://…), via npjRichText at read.
  const imageFigure = (id) => `<figure contenteditable="false" class="cmp-embed"><image-slot id="${id}" conform fitcontrol shape="rect" placeholder="Drop a photo or an archive.org link" style="width:100%;height:280px;display:block"></image-slot>${FIG_CAPS}</figure><p><br/></p>`;
  const insertImage = () => insertBlock(imageFigure("img-" + Date.now()));
  // A carousel starts with three drop targets; "+ Add image" appends more and a
  // per-slide ✕ removes one (both via the delegated handler below). Empty slots
  // are just drop targets — the publish fold (htmlToBlocks) keeps only filled
  // ones, so an author can leave a spare slot without it shipping.
  const carouselFigure = () => {
    const base = "car-" + Date.now().toString(36);
    const slides = [0, 1, 2].map((k) => CAROUSEL_SLIDE(base + "-" + k)).join("");
    return '<figure contenteditable="false" class="cmp-embed cmp-carousel" data-carousel="1"><div class="cmp-carousel-track">' + slides + '</div>' + CAROUSEL_ADD + CAROUSEL_CAP + '</figure><p><br/></p>';
  };
  const insertCarousel = () => insertBlock(carouselFigure());

  // ---- proactively push the story's media to archive.org, before publish ----
  // Walks the live draft and uploads every image still on the media store to
  // archive.org now, recording the durable URL in each slot's data-alt. The
  // publish boundary then has nothing left to freeze, so the commit is instant
  // instead of "up to a minute per image." A deliberate, outward-facing step:
  // the photos become public on archive.org the moment this runs.
  const prearchiveMedia = useCallback(async () => {
    if (!ed.current || !window.NpjMedia || !window.NpjMedia.prearchiveSlots) return;
    if (prearch && prearch.done != null && prearch.total != null && prearch.done < prearch.total) return; // already running
    if (window.NpjMedia.canUpload && !window.NpjMedia.canUpload()) {
      setPrearch({ error: "Sign in with Matrix to upload to archive.org." });
      return;
    }
    const census = window.NpjMedia.prearchiveCensus(ed.current);
    if (!census.pending) { setPrearch({ result: { total: 0, archived: 0, failed: 0 } }); return; }
    setPrearch({ done: 0, total: census.pending });
    let res = null, err = null;
    try {
      res = await window.NpjMedia.prearchiveSlots(ed.current, {
        slug: fileSlug || slugify(title) || draftId,
        title: title || "NPJ media",
        onProgress: (done, total) => setPrearch({ done, total })
      });
    } catch (e) { err = e; }
    // the data-alt URLs we just wrote live in the editor DOM — refresh the census
    // and persist them into the draft so they survive a reload and ride to publish.
    setArchiveStat(window.NpjMedia.prearchiveCensus(ed.current));
    scheduleSave();
    if (err) setPrearch({ error: (err && err.message) || "archive.org upload failed." });
    else setPrearch({ result: res });
  }, [prearch, fileSlug, title, draftId, scheduleSave]);

  // ---- images come in by paste/drop too ----
  // A figure can't live inside the headline or the dek — if the caret is in
  // one, step the insertion point past that block first.
  const escapeBlock = () => {
    const s = window.getSelection(); const n = s && s.anchorNode; if (!n) return;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const block = el && el.closest && el.closest("h1,h2,h3,.nr-dek,figure");
    if (block && ed.current && ed.current.contains(block) && block !== ed.current) {
      const r = document.createRange(); r.setStartAfter(block); r.collapse(true);
      s.removeAllRanges(); s.addRange(r);
    }
  };
  // Pasted/dropped image files land as regular image figures. When the image
  // was copied off the web WITH an archive.org URL in the html flavor, the
  // durable CDN link wins over the raw bytes.
  const insertImageFiles = (files, archiveUrl) => {
    files.forEach((f, i) => {
      const id = "img-" + Date.now().toString(36) + "-" + i;
      insertBlock(imageFigure(id));
      const el = ed.current && ed.current.querySelector("#" + id);
      if (!el) return;
      if (archiveUrl && files.length === 1) el.ingestUrl(archiveUrl);
      else el.ingestFile(f);
    });
  };

  // ---- text comes in clean ----
  // Paste (and text dragged in from elsewhere) is rebuilt from text/plain via
  // NpjPlainText, so the source page's fonts/colors/backgrounds never land in
  // the draft. Drags that START here keep the browser's native move/copy —
  // the content is already clean.
  const dragFromSelf = useRef(false);
  // Build a clean fragment from pasted HTML that KEEPS npj grounding and nothing
  // else: claim-src spans (data-src / data-cite-id / data-quote / data-stance)
  // and their md-cite markers survive — with fresh, collision-free cids — while
  // foreign tags are unwrapped to their text and only a small inline whitelist is
  // kept. Returns { html, keys }; html is "" when there's no provenance to keep.
  const provenanceHtml = (html) => {
    if (!html || !/claim-src|md-cite/.test(html)) return { html: "", keys: [] };
    const src = document.createElement("div"); src.innerHTML = html;
    if (!src.querySelector(".claim-src, sup.md-cite")) return { html: "", keys: [] };  // our markers only — never reroute a plain external paste
    const newCid = () => "cs-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
    const cidMap = {};
    const remap = (old) => old ? (cidMap[old] || (cidMap[old] = newCid())) : newCid();
    const keys = {};
    const INLINE = { strong: "strong", b: "strong", em: "em", i: "em", s: "s", code: "code", a: "a" };
    const out = document.createElement("div");
    const walk = (parent, node) => {
      node.childNodes.forEach(c => {
        if (c.nodeType === 3) { parent.appendChild(document.createTextNode(c.nodeValue)); return; }
        if (c.nodeType !== 1) return;
        const tag = c.tagName.toLowerCase();
        if (tag === "span" && c.classList.contains("claim-src")) {
          const span = document.createElement("span");
          const st = c.getAttribute("data-stance");
          const dq = c.getAttribute("data-quote");
          span.className = (st || (dq && dq.trim())) ? "claim-src" : "claim-src needs-quote";
          const ds = c.getAttribute("data-src"); if (ds) { span.setAttribute("data-src", ds); ds.split(/\s+/).filter(Boolean).forEach(k => { keys[k] = 1; }); }
          const dci = c.getAttribute("data-cite-id"); if (dci) span.setAttribute("data-cite-id", dci);
          if (dq != null) span.setAttribute("data-quote", dq);
          if (st) span.setAttribute("data-stance", st);
          if (c.hasAttribute("data-cid")) span.setAttribute("data-cid", remap(c.getAttribute("data-cid")));
          const ttl = c.getAttribute("title"); if (ttl) span.setAttribute("title", ttl);
          walk(span, c);
          parent.appendChild(span);
          return;
        }
        if (tag === "sup" && c.classList.contains("md-cite")) {
          const sup = document.createElement("sup");
          sup.className = "md-cite"; sup.setAttribute("contenteditable", "false");
          const dc = c.getAttribute("data-cite"); if (dc) { sup.setAttribute("data-cite", dc); keys[dc] = 1; }
          const dci = c.getAttribute("data-cite-id"); if (dci) sup.setAttribute("data-cite-id", dci);
          const dq = c.getAttribute("data-quote"); if (dq != null) sup.setAttribute("data-quote", dq);
          if (c.hasAttribute("data-fn")) sup.setAttribute("data-fn", "1");
          if (c.hasAttribute("data-cid")) sup.setAttribute("data-cid", remap(c.getAttribute("data-cid")));
          const ttl = c.getAttribute("title"); if (ttl) sup.setAttribute("title", ttl);
          sup.textContent = c.textContent || "";
          parent.appendChild(sup);
          return;
        }
        if (tag === "br") { parent.appendChild(document.createElement("br")); return; }
        if (tag === "p" || tag === "div" || tag === "li") {
          // collapse block wrappers to their text + a soft break, so foreign block
          // styling never rides into the editable surface
          walk(parent, c);
          if (parent.lastChild && parent.lastChild.nodeName !== "BR") parent.appendChild(document.createElement("br"));
          return;
        }
        const keep = INLINE[tag];
        if (keep) {
          const el = document.createElement(keep);
          if (tag === "a") { const href = c.getAttribute("href"); if (href && /^(https?:|mailto:|#)/i.test(href)) { el.setAttribute("href", href); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); } }
          walk(el, c);
          parent.appendChild(el);
          return;
        }
        // any other element: keep only its text/children (drops styles, images…)
        walk(parent, c);
      });
    };
    walk(out, src);
    return { html: out.innerHTML, keys: Object.keys(keys) };
  };
  // ---- composition provenance (app/composition.js) ----
  // Record how the body is assembled — typed vs. pasted, paste sizes, deletions
  // — as plain counts (never the words), so the preview + published footer can
  // show a reader how the piece came together. Guarded behind `restored` so the
  // initial draft load (seed / rehydrate) never counts as fresh writing.
  const recordComposition = (e) => {
    if (!restored.current || !window.NpjComposition || !ed.current) return;
    const len = (ed.current.textContent || "").length;
    const it = (e && e.nativeEvent && e.nativeEvent.inputType) || "";
    window.NpjComposition.onInput(draftId, len, it);
  };
  // bracket OUR programmatic insertion so its synthetic input event isn't read
  // as typing — the paste is booked here, by its known size, exactly once
  const notePaste = (n, opts, insert) => {
    if (window.NpjComposition && n) window.NpjComposition.recordPaste(draftId, n, opts || {});
    if (window.NpjComposition) window.NpjComposition.mute(draftId);
    try { insert(); }
    finally {
      if (window.NpjComposition) {
        window.NpjComposition.unmute(draftId);
        // re-baseline the length counter to the post-insert body, so the next real
        // keystroke measures from here — robust even on browsers that don't fire an
        // input event for our programmatic execCommand insert
        window.NpjComposition.attach(draftId, ed.current ? (ed.current.textContent || "").length : 0);
      }
    }
  };
  const onPaste = (e) => {
    const cd = e.clipboardData; if (!cd) return;
    e.preventDefault();
    const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) {
      let archiveUrl = null;
      const ih = cd.getData("text/html") || "";
      const m = ih.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m && window.NpjArchiveCDN.isMediaUrl(m[1])) archiveUrl = m[1];
      insertImageFiles(files, archiveUrl);
      return;
    }
    const text = cd.getData("text/plain");
    // our own grounded text, copied from anywhere in the session, re-lands cited
    const prov = provenanceHtml(cd.getData("text/html") || "");
    if (prov.html) {
      if (/\n/.test(text)) escapeBlock(); // a multi-line paste never lands inside a headline / the dek
      notePaste((text || "").length, { grounded: true }, () => document.execCommand("insertHTML", false, prov.html));
      // re-register any source the pasted spans cite, so it shows in the library
      if (prov.keys.length) setSources(s => {
        const have = {}; s.forEach(x => { have[x.key] = 1; });
        const add = prov.keys.filter(k => !have[k] && window.NPJ.SOURCES[k]).map(k => ({ key: k, archived: !!(window.NPJ.SOURCES[k] || {}).archive_url }));
        return add.length ? [...s, ...add] : s;
      });
      renumberCites();
      setRev(v => v + 1);
      if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate();
      scanHeadings(); scheduleSave();
      return;
    }
    if (!text) return;
    if (/\n/.test(text)) escapeBlock(); // block-level paste never lands inside a headline or the dek
    notePaste(text.length, { kind: "paste" }, () => window.NpjPlainText.insert(text));
    scanHeadings(); scheduleSave();
  };
  const caretToPoint = (e) => {
    let r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); } }
    if (r && ed.current && ed.current.contains(r.startContainer)) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  };
  const onDropText = (e) => {
    if (blockDrag.current) return; // a block-grip drag — onBlockDrop (on the scroller) owns this
    if (dragFromSelf.current || !e.dataTransfer) return; // internal rearrange — native handles it
    e.preventDefault(); // never let the browser insert the formatted flavor (or navigate to a dropped file)
    const files = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) { caretToPoint(e); insertImageFiles(files, null); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) return; // non-image files have no home here
    const text = e.dataTransfer.getData("text/plain");
    if (!text) return;
    caretToPoint(e);
    if (/\n/.test(text)) escapeBlock();
    notePaste(text.length, { kind: "drop" }, () => window.NpjPlainText.insert(text));
    scanHeadings(); scheduleSave();
  };

  // ---- Return vs Shift+Return ----
  // Return = a paragraph break (a new <p>, which publishes with paragraph
  // spacing). Shift+Return = a soft line break (a <br>, which publishes tight,
  // no extra space). The browser default already gives <br> for Shift+Return,
  // and defaultParagraphSeparator="p" (set on mount/focus) makes Return split
  // into <p> — so the only case worth intercepting is a Return inside a code /
  // verse block, where it must drop a literal newline instead of escaping the
  // block into a paragraph.
  const ensureParaSep = () => { try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {} };
  const onEditorKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const sel = window.getSelection();
    const node = sel && sel.anchorNode;
    const host = node && (node.nodeType === 1 ? node : node.parentElement);
    if (host && host.closest && host.closest("pre")) {
      e.preventDefault();
      document.execCommand("insertText", false, "\n");
      scheduleSave();
    } else if (host && host.closest && host.closest("li.nr-fnote")) {
      // a footnote note is a single item — Enter adds a line break in place, never
      // splits the list (which would strand a numberless, keyless <li>).
      e.preventDefault();
      document.execCommand("insertLineBreak");
      scheduleSave();
    } else if (host && host.closest && host.closest("h1,h2,h3")) {
      // A Return out of a heading must start BODY text — never clone the heading.
      // contentEditable otherwise carries the <h2>/<h3> onto the next line, so the
      // paragraph you type inherits the heading style and lands in the Contents
      // rail. Let the browser split, then coerce the fresh block the caret lands
      // in (empty = the common "next line is body" case) back to a <p>. A split
      // mid-heading keeps its first half a heading; a Return at the very start
      // leaves the heading intact (its text-bearing block is never converted).
      e.preventDefault();
      document.execCommand("insertParagraph");
      const s2 = window.getSelection();
      let n2 = s2 && s2.anchorNode;
      n2 = n2 && (n2.nodeType === 1 ? n2 : n2.parentElement);
      const nb = n2 && n2.closest && n2.closest("h1,h2,h3");
      if (nb && ed.current && ed.current.contains(nb) && !(nb.textContent || "").trim())
        document.execCommand("formatBlock", false, "p");
      scanHeadings(); scheduleSave();
    }
  };

  // ---- live preview: the piece EXACTLY as it will publish ----
  // Fold the editor's current content through the same builder publishing uses
  // (genesisFromContent → the reader's article object), then hand it to the
  // reader's own renderer in preview mode. No round-trip to GitHub, no archive
  // freeze (image URLs render from where they already live) — just the words,
  // laid out as the outside will lay them out.
  const openPreview = () => {
    if (!window.NpjArticles) return;
    // Preview should faithfully show EVERY photo the author placed — including one
    // that's still a session data: URL because its upload hasn't landed (or
    // failed). That image lives on the live <image-slot> (exposed via .url), not in
    // the serialized HTML, so inline it onto a CLONE of the editor for the preview
    // build only. genesisFromContent({preview}) keeps those as flagged `local`
    // blocks; the real publish path never sets preview, so a data: URL is still
    // dropped from the committed record (no base64 into a commit).
    let html = ed.current ? ed.current.innerHTML : (htmlRef.current || "");
    if (ed.current) {
      try {
        const clone = ed.current.cloneNode(true);
        clone.querySelectorAll("image-slot").forEach(cs => {
          const durable = cs.getAttribute("src");
          if (durable && window.NpjMedia && window.NpjMedia.isPublishable(durable)) return;
          const id = cs.id;
          const live = id ? ed.current.querySelector('image-slot[id="' + id + '"]') : null;
          const u = live && live.url;
          if (u && /^data:image\//i.test(u)) cs.setAttribute("src", u);
        });
        html = clone.innerHTML;
      } catch (e) { /* fall back to the plain serialization */ }
    }
    const actor = (session && session.user_id) || ((window.MatrixAuth.current() || {}).user_id) || null;
    try {
      const gen = window.NpjArticles.genesisFromContent(
        { html, title, tags, column, sources },
        { slug: fileSlug || slugify(title), headline: title, actor, preview: true,
          composition: window.NpjComposition ? window.NpjComposition.publishable(draftId) : null }
      );
      setPreviewDoc(gen.article);
    } catch (e) { setPreviewDoc(null); }
  };

  // image slots mutate themselves (src attribute, local fills) — onInput
  // never fires for that, so re-scan the media census and save on their event
  useEffect(() => {
    const el = ed.current; if (!el) return;
    const f = () => { scanHeadings(); scheduleSave(); };
    el.addEventListener("image-slot-change", f);
    return () => el.removeEventListener("image-slot-change", f);
  }, [scanHeadings, scheduleSave]);

  // Carousel add/remove. The "+ Add image" chip and the per-slide ✕ are
  // contenteditable=false islands inside the figure, so the caret can't reach
  // them — a delegated click runs the mutation instead. A freshly appended slot
  // is upgraded at once so its drop zone is live without a reload; removing the
  // last slide removes the whole carousel.
  useEffect(() => {
    const root = ed.current; if (!root) return;
    const onClick = (e) => {
      const add = e.target.closest && e.target.closest(".cmp-carousel-add");
      if (add && root.contains(add)) {
        e.preventDefault();
        const fig = add.closest(".cmp-carousel");
        const track = fig && fig.querySelector(".cmp-carousel-track");
        if (track) {
          const holder = document.createElement("div");
          holder.innerHTML = CAROUSEL_SLIDE("car-" + Date.now().toString(36) + "-" + track.children.length);
          const slide = holder.firstElementChild;
          if (slide) {
            track.appendChild(slide);
            try { if (window.customElements && customElements.upgrade) customElements.upgrade(slide); } catch (x) {}
            scheduleSave();
          }
        }
        return;
      }
      const rm = e.target.closest && e.target.closest(".cmp-slide-rm");
      if (rm && root.contains(rm)) {
        e.preventDefault();
        const fig = rm.closest(".cmp-carousel");
        const slide = rm.closest(".cmp-slide");
        if (fig && slide) {
          const count = fig.querySelectorAll(".cmp-slide").length;
          if (count <= 1) fig.remove(); else slide.remove();
          scheduleSave();
        }
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [scheduleSave]);

  // media viewer keyboard: esc closes, arrows move
  const mediaImages = media.filter(m => m.kind === "image");
  useEffect(() => {
    if (viewer == null) return;
    const f = (e) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowLeft") setViewer(v => Math.max(0, v - 1));
      else if (e.key === "ArrowRight") setViewer(v => Math.min(mediaImages.length - 1, v + 1));
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [viewer, mediaImages.length]);
  const scrollToFigure = (mid) => {
    const cont = scroller.current, body = ed.current; if (!cont || !body) return;
    const el = body.querySelector('figure[data-mid="' + mid + '"]'); if (!el) return;
    const cr = cont.getBoundingClientRect(), er = el.getBoundingClientRect();
    cont.scrollTop += (er.top - cr.top) - 18;
  };

  // ---- rich formatting (toolbar additions) ----
  const wrapInline = (tag) => {
    const r = selRange.current; if (!r || r.collapsed) return;
    const el = document.createElement(tag);
    try { r.surroundContents(el); } catch (e) { const frag = r.extractContents(); el.appendChild(frag); r.insertNode(el); if (el.parentNode) el.parentNode.normalize(); }
    window.getSelection().removeAllRanges(); setRev(v => v + 1); scheduleSave();
  };
  const applyHighlight = () => {
    ed.current && ed.current.focus(); restore();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    try { document.execCommand("hiliteColor", false, "rgba(255,236,1,.45)"); } catch (e) { document.execCommand("backColor", false, "rgba(255,236,1,.45)"); }
    scheduleSave();
  };
  const applyColor = (c) => {
    ed.current && ed.current.focus(); restore();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    document.execCommand("foreColor", false, c);
    setFmtMenu(null); scheduleSave();
  };
  const insertEmbed = () => {
    const u = embedUrl.trim(); if (!/^https?:\/\//.test(u)) return;
    const esc = u.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    let host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
    // one resolver builds the player here, in blocksToHtml and in the reader, so
    // a pasted Google Drive / Docs / archive.org / video link embeds identically
    // everywhere. `panel` embeds (no knowable aspect) take the author's height.
    const r = window.NpjEmbed && window.NpjEmbed.resolve(u);
    const h = parseInt(embedHeight, 10);
    const inner = window.NpjEmbed ? window.NpjEmbed.innerHtml(u, { height: h }) : `<a href="${esc}" target="_blank" rel="noopener">${host || esc}</a>`;
    const heightAttr = (r && r.panel && h) ? ` data-embed-height="${h}"` : "";
    insertBlock(`<figure contenteditable="false" class="cmp-embed" data-embed-url="${esc}"${heightAttr}>${inner}<figcaption class="np-mono cmp-embed-hint" style="font-size:11px;color:${NR.muted};margin-top:4px">${host || "media"} · embedded — the published article keeps the link</figcaption></figure><p><br/></p>`);
    setEmbedUrl(""); setFmtMenu(null);
  };
  // A footnote attaches to a WORD, so the marker must land against text. If the
  // collapsed caret is on an empty line — a trailing/blank <p> you drop into when
  // you click just past the end of a line — or it isn't in a prose block at all,
  // snap it to the very end of the nearest paragraph above that actually has text,
  // so a footnote never ends up as a lone "¹" stranded on its own line. With the
  // caret already in text (end of a line, or mid-sentence) this is a no-op and the
  // marker drops exactly where you put it. Updates the saved range insertHTML restores.
  const anchorFootnoteCaret = () => {
    const root = ed.current; if (!root) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return;                              // a real selection — footnote that exact spot
    const BLOCK = "p,li,h1,h2,h3,blockquote,figcaption";
    const hasText = (el) => !!(el && (el.textContent || "").trim());
    const start = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    let blk = start && start.closest ? start.closest(BLOCK) : null;
    if (blk && blk.closest("ol.nr-fnotes")) blk = null;   // inside a note, not the prose
    if (blk && root.contains(blk) && hasText(blk)) return; // already against text — leave it
    // walk back to the nearest prose block with text (skip empty lines, code, figures, the notes list)
    let prev = blk ? blk.previousElementSibling : root.lastElementChild;
    while (prev && ((prev.matches && prev.matches("ol.nr-fnotes,pre,figure")) || !hasText(prev))) prev = prev.previousElementSibling;
    if (!prev || !root.contains(prev) || !hasText(prev)) return; // nothing better above — leave as-is
    const nr = document.createRange();
    nr.selectNodeContents(prev); nr.collapse(false);      // caret at the very end of that block
    sel.removeAllRanges(); sel.addRange(nr);
    selRange.current = nr.cloneRange();
  };
  // A footnote, Substack-style: drop a numbered marker at the caret and open a
  // real, editable note for it in the "Footnotes" list at the foot of the page —
  // no raw "[^fn1]:" syntax in the prose. The marker carries a stable, unique
  // key on data-cite; the printed number and the note's home are kept in step by
  // renumberFootnotes (below), so adding, moving or deleting a marker renumbers
  // everything live, exactly like Substack.
  const insertFootnote = () => {
    const key = "fn" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    caretIntoBody();                                // bring a real in-body caret live so we can anchor it
    anchorFootnoteCaret();                          // never strand the marker on an empty line
    // the bullet is a placeholder glyph; renumberFootnotes overwrites it with the number
    insertHTML(`<sup class="md-cite" data-fn="1" data-cite="${key}" contenteditable="false" title="footnote">•</sup>&nbsp;`);
    renumberFootnotes();
    // focus the freshly-opened note so the author types it straight away
    const root = ed.current;
    const li = root && root.querySelector('li.nr-fnote[data-fn-key="' + key + '"]');
    if (li) {
      li.scrollIntoView({ block: "center", behavior: "smooth" });
      try {
        const r = document.createRange(); r.selectNodeContents(li); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch (e) {}
    }
    setFmtMenu(null); scheduleSave();
  };
  const insertVerse = () => { insertBlock(`<pre class="verse">Write the verse here —\nline breaks hold,\nstanzas keep their shape.</pre><p><br/></p>`); setFmtMenu(null); };
  const insertPoll = () => {
    insertBlock(`<div class="cmp-widget" data-widget="poll"><div class="cmp-widget-h"><span class="np-mono">◳ POLL</span><span class="cmp-tag">placeholder · interactive at publish</span></div><div class="cmp-widget-b"><strong>Ask the readers a question…</strong><span>Option one</span><br/><span>Option two</span></div><div class="cmp-widget-f">readers vote on the published page; results stay public</div></div><p><br/></p>`);
    setFmtMenu(null);
  };

  // ---- floating selection toolbar: format + link/jumplink + source ----
  const [sel, setSel] = useState(null);
  const [menu, setMenu] = useState(null); // 'src' | 'link'
  const [srcQuery, setSrcQuery] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [srcPreview, setSrcPreview] = useState(null); // bind menu: which source row is expanded to a full preview
  const [linkUrl, setLinkUrl] = useState("");
  const [fmtMenu, setFmtMenu] = useState(null); // 'color' | 'align' | 'embed' | 'more'
  const [embedUrl, setEmbedUrl] = useState("");
  const [embedHeight, setEmbedHeight] = useState(String((window.NpjEmbed && window.NpjEmbed.DEFAULT_HEIGHT) || 600)); // px height for panel embeds (Drive/Docs/archive)
  const [htmlMode, setHtmlMode] = useState(false);  // editing the document's raw HTML in the source view
  const [htmlDraft, setHtmlDraft] = useState("");   // the source-view textarea buffer
  const [htmlMsg, setHtmlMsg] = useState("");       // a transient note (e.g. the Tidy result)
  const [voidSearch, setVoidSearch] = useState(""); // the documented search/evidence behind a prose "cite a void"
  const [voidKind, setVoidKind] = useState("");     // which of the six kinds of void (see app/void-kinds.js)
  useEffect(() => {
    const onUp = (e) => {
      if (e && e.target && e.target.closest && e.target.closest(".sel-tb")) return;
      const s = window.getSelection();
      if (s && s.rangeCount && !s.isCollapsed && ed.current && ed.current.contains(s.anchorNode) && ed.current.contains(s.focusNode)) {
        selRange.current = s.getRangeAt(0).cloneRange();
        const r = s.getRangeAt(0).getBoundingClientRect();
        setSel({ x: r.left + r.width / 2, y: r.top });
      } else { setSel(null); setMenu(null); }
    };
    document.addEventListener("mouseup", onUp); document.addEventListener("keyup", onUp);
    return () => { document.removeEventListener("mouseup", onUp); document.removeEventListener("keyup", onUp); };
  }, []);

  const citeNum = (key) => { const i = citeOrderRef.current.indexOf(key); return i < 0 ? 0 : i + 1; };
  // Sources in the order they FIRST appear in the prose — recomputed live from
  // the document, so as the author moves text around the order tracks the page
  // (the published reader numbers the same way; see ArticleRead useClaimModel).
  // Cited keys come first in document order; a source ingested but not yet cited
  // trails after in the order it was added.
  const docOrderKeys = () => {
    const root = ed.current;
    const order = [];
    if (root) {
      root.querySelectorAll('sup.md-cite[data-cite]:not([data-fn]), .claim-src[data-src]').forEach(el => {
        (el.getAttribute('data-cite') || el.getAttribute('data-src') || '')
          .split(/\s+/).filter(Boolean).forEach(k => { if (order.indexOf(k) < 0) order.push(k); });
      });
    }
    sources.forEach(s => { if (order.indexOf(s.key) < 0) order.push(s.key); });
    return order;
  };
  // Renumber the inline [n] cite markers to match document order and keep
  // citeOrder in step. Display-only and safe: the publish path reads the source
  // KEY off each marker, never the printed number (articles.js htmlToBlocks), and
  // the reader re-numbers by appearance — this just keeps the editor's chips
  // honest as text is added, moved or deleted.
  const renumberCites = () => {
    const root = ed.current; if (!root) return;
    const order = docOrderKeys();
    root.querySelectorAll('sup.md-cite[data-cite]:not([data-fn])').forEach(s => {
      const n = order.indexOf(s.getAttribute('data-cite')) + 1;
      if (n > 0 && s.textContent !== String(n)) s.textContent = String(n);
    });
    const prev = citeOrderRef.current;
    if (order.length !== prev.length || order.some((k, i) => k !== prev[i])) {
      citeOrderRef.current = order; setCiteOrder(order);
    }
  };
  // Keep footnotes in step with their markers — the Substack model. The markers
  // in the prose are the source of truth: we number them by first appearance,
  // keep exactly one editable note per referenced key in the "Footnotes" list at
  // the foot of the page, create a note for any new marker, and DROP the note of
  // a marker that's been deleted. Runs on every input (cheap, idempotent); the
  // publish pass reads keys + note text, never the printed number.
  const renumberFootnotes = () => {
    const root = ed.current; if (!root) return;
    const markers = Array.from(root.querySelectorAll('sup.md-cite[data-fn][data-cite]'));
    // keys in first-reference order (a key reused by two markers shares its number)
    const order = [];
    markers.forEach(s => { const k = (s.getAttribute('data-cite') || '').trim(); if (k && order.indexOf(k) < 0) order.push(k); });
    markers.forEach(s => {
      const n = order.indexOf((s.getAttribute('data-cite') || '').trim()) + 1;
      if (n > 0 && s.textContent !== String(n)) s.textContent = String(n);
    });
    let list = root.querySelector('ol.nr-fnotes');
    if (!order.length) { if (list) list.remove(); return; }   // last footnote gone → no list
    if (!list) {
      list = document.createElement('ol');
      list.className = 'nr-fnotes'; list.setAttribute('data-fnotes', '1');
      root.appendChild(list);
    }
    // index the notes we already have; DROP orphans (marker deleted) and dupes,
    // but FOLD any stray fragment (e.g. a list-split that slipped through) back
    // into the note above it, so an edit never loses a note's words.
    const have = {}; let lastValid = null;
    Array.from(list.childNodes).forEach(node => {
      const isNote = node.nodeType === 1 && node.classList && node.classList.contains('nr-fnote');
      const k = isNote ? (node.getAttribute('data-fn-key') || '').trim() : '';
      if (k && order.indexOf(k) >= 0 && !have[k]) { have[k] = node; lastValid = node; return; }
      if (!k) { const t = (node.textContent || '').trim(); if (t && lastValid) lastValid.append((lastValid.textContent ? ' ' : '') + t); }
      if (node.remove) node.remove(); else if (node.parentNode) node.parentNode.removeChild(node);
    });
    // Reorder/create ONLY when the note order is actually out of step with the
    // markers. Typing inside a note fires input but doesn't change the order, so
    // we must not re-append its <li> then — moving the node would drop the caret.
    const cur = Array.from(list.querySelectorAll(':scope > li.nr-fnote')).map(li => (li.getAttribute('data-fn-key') || '').trim());
    const inSync = order.every(k => have[k]) && cur.length === order.length && order.every((k, i) => k === cur[i]);
    if (!inSync) {
      order.forEach(k => {
        let li = have[k];
        if (!li) {
          li = document.createElement('li');
          li.className = 'nr-fnote'; li.setAttribute('data-fn-key', k);
          li.setAttribute('data-ph', 'Write the note…');
        }
        list.appendChild(li);   // appendChild moves an existing <li> into marker order
      });
    }
  };

  // ---- HTML source mode: open the canvas as editable HTML, fix it, apply ----
  // Bring a freshly-set document back to a publishable shape. This mirrors the
  // draft-restore reconcile (see the restore effect) so HTML typed by hand lands
  // exactly like a reopened draft: the dek is re-seeded, citation spans/markers
  // re-pinned, <image-slot>s re-upgraded so their drop zones work, headings,
  // citations and footnotes renumbered, structure reconciled, fields rehydrated.
  const reconcileAfterReplace = () => {
    const root = ed.current; if (!root) return;
    // lift any raw <iframe>/<video>/<audio> the author wrote in the HTML source
    // view into real embed figures before the rest of the reconcile runs
    nrNormalizeEmbeds(root);
    if (!root.querySelector(".nr-dek")) {
      const h1 = root.querySelector("h1");
      if (h1) { const p = document.createElement("p"); p.className = "nr-dek"; p.setAttribute("data-ph", DEK_PH); p.innerHTML = "<br/>"; h1.after(p); }
    }
    root.querySelectorAll(".claim-src").forEach((el, i) => {
      let cid = el.getAttribute("data-cid");
      if (!cid) { cid = "cs-legacy-" + Date.now().toString(36) + "-" + i; el.setAttribute("data-cid", cid); }
      const sup = el.nextElementSibling;
      if (sup && sup.classList && sup.classList.contains("md-cite") && !sup.hasAttribute("data-cid")) {
        sup.setAttribute("data-cid", cid);
        if (!sup.hasAttribute("data-quote")) sup.setAttribute("data-quote", el.getAttribute("data-quote") || "");
      }
      if (!(el.getAttribute("data-quote") || "").trim()) el.classList.add("needs-quote");
    });
    if (window.NpjCitations) window.NpjCitations.migrateRoot(root);
    upgradeCustomEls();
    const h1b = root.querySelector("h1"); if (h1b) setTitle((h1b.textContent || "").trim());
    const dekEl = root.querySelector(".nr-dek"); if (dekEl) setDek((dekEl.textContent || "").trim());
    // a hand-edited / pasted document can carry a footnote marker stranded on its
    // own line — fold/drop it like the restore path does, then renumber
    scanHeadings(); destrandFootnotes(); renumberCites(); renumberFootnotes();
    try { reconcileRef.current && reconcileRef.current(); } catch (e) {}
    setRev(v => v + 1);
    scheduleSave();
  };
  const openHtmlSource = () => {
    if (!ed.current) return;
    setHtmlDraft(nrSerializeHtml(ed.current));
    setHtmlMsg(""); setFmtMenu(null); setMenu(null);
    if (scroller.current) scroller.current.scrollTop = 0;
    setHtmlMode(true);
  };
  const closeHtmlSource = () => { setHtmlMode(false); setHtmlMsg(""); };
  const tidyHtmlSource = () => {
    const res = nrTidyHtml(htmlDraft);
    setHtmlDraft(res.html);
    setHtmlMsg(res.fixes ? ("Tidied " + res.fixes + " issue" + (res.fixes === 1 ? "" : "s") + " — review, then Apply") : "Nothing to tidy — already clean");
  };
  const applyHtmlSource = () => {
    const root = ed.current; if (!root) return;
    root.innerHTML = htmlDraft;
    reconcileAfterReplace();
    setHtmlMode(false); setHtmlMsg("");
  };
  // leaving prose for a grounding/graph surface drops the source panel so it
  // can't shadow another view; the next open re-snapshots the live document
  useEffect(() => { if (view !== "prose" && htmlMode) setHtmlMode(false); }, [view, htmlMode]);

  // Footnote hygiene in the LIVE editor — the DOM mirror of articles.js
  // mergeStrandedFootnotes. A footnote marker references a WORD, so a marker left
  // alone in its block (an Enter/paste/drag can clone a trailing contenteditable=
  // false <sup> onto a fresh line) renders as a lone number. Fold a fresh marker
  // onto the end of the previous text block so its note is never orphaned; DROP one
  // whose key already rides a text-attached marker — every manual footnote key is
  // unique per insertion (insertFootnote), so that is an accidental clone, not a
  // second reference. Caret-safe: only contenteditable=false markers move, and the
  // blank block a strand leaves behind is removed only when the caret isn't in it.
  const destrandFootnotes = () => {
    const root = ed.current; if (!root) return false;
    const BLOCK = "p,li,h1,h2,h3,blockquote,figcaption";
    const isMark = (n) => !!n && n.nodeType === 1 && n.tagName === "SUP" && n.classList.contains("md-cite") && n.hasAttribute("data-fn");
    // a block's reading text with footnote markers (which carry only a number)
    // excluded — so a block holding nothing but markers reads as empty
    const prose = (el) => {
      let t = "";
      el.childNodes.forEach(n => { if (n.nodeType === 3) t += n.nodeValue || ""; else if (n.nodeType === 1 && !isMark(n)) t += n.textContent || ""; });
      return t.replace(/[\s ]+/g, "");
    };
    const caretIn = (blk) => { try { const s = window.getSelection(); return !!(s && s.rangeCount && blk.contains(s.getRangeAt(0).commonAncestorContainer)); } catch (e) { return false; } };
    const inNotes = (el) => !!(el && el.closest && el.closest("ol.nr-fnotes"));
    const attached = new Set();   // keys carried by a marker that sits against text
    root.querySelectorAll('sup.md-cite[data-fn][data-cite]').forEach(s => {
      const blk = s.closest && s.closest(BLOCK);
      if (blk && !inNotes(blk) && prose(blk)) { const k = (s.getAttribute('data-cite') || '').trim(); if (k) attached.add(k); }
    });
    let changed = false;
    Array.from(root.querySelectorAll(BLOCK)).forEach(blk => {
      if (inNotes(blk)) return;                                          // the notes list, not prose
      const markers = Array.from(blk.childNodes).filter(isMark);
      if (!markers.length || prose(blk)) return;                         // not a marker-only block
      let prev = blk.previousElementSibling;                             // nearest text block above to fold onto
      while (prev && ((prev.matches && prev.matches("ol.nr-fnotes,pre,figure")) || !(prev.textContent || "").replace(/[\s ]+/g, ""))) prev = prev.previousElementSibling;
      markers.forEach(m => {
        const k = (m.getAttribute('data-cite') || '').trim();
        if (k && attached.has(k)) { m.remove(); changed = true; return; }      // duplicate of a real reference → drop
        if (k) attached.add(k);
        if (prev && root.contains(prev)) { prev.appendChild(m); changed = true; } // unique → fold onto the text above
        // nothing above to fold onto → leave the marker where it is (don't orphan its note)
      });
      if (!prose(blk) && !blk.querySelector('img, sup.md-cite') && !caretIn(blk)) { blk.remove(); changed = true; } // the blank line the strand left
    });
    return changed;
  };
  // ---- never let a word split across a paragraph break ----
  // The live-DOM twin of articles.js mergeSplitWords, so the editor IS the source
  // of truth instead of leaving the repair to the fold. Native contentEditable (an
  // Enter or a paste that lands mid-word) or an older draft can leave a paragraph
  // cut in two — "…public bench. B" then a fresh <p> "ut the incursion…" — which the
  // fold would read as two blocks and the reader/Preview/export print with a blank
  // line through "But". Stitch the lower block back onto the one above when the seam
  // is unmistakably mid-word: the block above ends on a word character (no trailing
  // space; footnote markers, which carry only a number, ignored) and the one below
  // opens with a lowercase letter — prose never starts a new paragraph lower-case
  // mid-word. Caret-safe: it leaves a pair alone while the caret is inside the lower
  // block, so it never fights an Enter you're actively typing, and heals once the
  // caret moves on (and on restore, so a saved draft opens clean). <p>→<p> only; a
  // hard <br> at the seam is a real line break and is left untouched.
  const healSplitBlocks = () => {
    const root = ed.current; if (!root) return false;
    const inNotes = (el) => !!(el && el.closest && el.closest("ol.nr-fnotes"));
    const caretIn = (blk) => { try { const s = window.getSelection(); return !!(s && s.rangeCount && blk.contains(s.getRangeAt(0).commonAncestorContainer)); } catch (e) { return false; } };
    // a block's text with footnote markers dropped, so a trailing "1" never reads
    // as the word character that would trigger a merge
    const prose = (blk) => { const c = blk.cloneNode(true); c.querySelectorAll("sup.md-cite").forEach(s => s.remove()); return c.textContent || ""; };
    let changed = false;
    const isField = (el) => !!el && el.classList && el.classList.contains("nr-dek");   // the Subtitle field, not prose
    Array.from(root.querySelectorAll("p")).forEach(blk => {
      if (inNotes(blk) || isField(blk)) return;
      const prev = blk.previousElementSibling;
      if (!prev || prev.tagName !== "P" || inNotes(prev) || isField(prev)) return;      // only stitch body <p> onto body <p>
      if (!/[A-Za-z0-9]$/.test(prose(prev)) || !/^[a-z]/.test(prose(blk))) return;      // not a mid-word seam
      if (prev.lastChild && prev.lastChild.nodeType === 1 && prev.lastChild.tagName === "BR") return; // a hard break is a real boundary
      if (caretIn(blk)) return;                                                         // don't fight an active edit
      while (blk.firstChild) prev.appendChild(blk.firstChild);                          // MOVE (not clone) so a saved range stays valid
      blk.remove(); prev.normalize();                                                   // coalesce the seam text nodes → one word
      changed = true;
    });
    return changed;
  };
  // the span to bind: the live in-editor selection if there is one, else the
  // last one we saved — a collapsed caret is never a span
  const spanRange = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && !s.isCollapsed && ed.current && ed.current.contains(s.anchorNode) && ed.current.contains(s.focusNode)) return s.getRangeAt(0);
    if (selRange.current && !selRange.current.collapsed && ed.current && ed.current.contains(selRange.current.commonAncestorContainer)) return selRange.current;
    return null;
  };
  // Bind a source to a span. With words selected it binds right away. With
  // nothing selected it ARMS the source instead of failing silently: the next
  // selection you make in the page binds to it (see the effect below). So
  // "pick the source, then grab its exact words" works as well as the reverse.
  //
  // Binding no longer FINISHES the citation — it opens it. You can't just cite a
  // page: every bound span must then PIN the exact words IN THE SOURCE that back
  // the claim (data-quote). Until it's pinned the span is flagged `needs-quote`
  // and the publish build refuses it, so a claim can never stand on a whole
  // page — only on a specific span of a specific source.
  // Wrap a Range in a fresh claim-src span bound to `key`, drop the numbered
  // marker after it, and register the source. Shared by the toolbar's
  // bindSource and the table's "add citation to this sentence". Returns the cid.
  const bindRangeToSource = (r, key) => {
    let order = citeOrderRef.current;
    if (order.indexOf(key) < 0) { order = [...order, key]; citeOrderRef.current = order; setCiteOrder(order); }
    const num = order.indexOf(key) + 1;
    const cid = "cs-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);
    const span = document.createElement("span"); span.className = "claim-src needs-quote";
    span.setAttribute("data-src", key); span.setAttribute("data-cid", cid); span.setAttribute("data-quote", "");
    try { r.surroundContents(span); } catch (e) { const frag = r.extractContents(); span.appendChild(frag); r.insertNode(span); if (span.parentNode) span.parentNode.normalize(); }
    const sup = document.createElement("sup"); sup.className = "md-cite"; sup.setAttribute("contenteditable", "false");
    sup.setAttribute("data-cite", key); sup.setAttribute("data-cid", cid); sup.setAttribute("data-quote", ""); sup.title = key; sup.textContent = num;
    span.after(sup);
    if (!sources.find(x => x.key === key)) setSources(s => [{ key, archived: !!(window.NPJ.SOURCES[key] && window.NPJ.SOURCES[key].archive_url) }, ...s]);
    return cid;
  };
  // The .claim-src that a selection sits inside — the span a NEW source should be
  // ADDED to rather than nesting a fresh span within. Owned claims (data-stance,
  // no citation) are left alone; they aren't sourced.
  const claimHostOf = (r) => {
    if (!r) return null;
    const node = r.commonAncestorContainer;
    const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    const host = el && el.closest ? el.closest(".claim-src") : null;
    return (host && ed.current && ed.current.contains(host) && !host.getAttribute("data-stance")) ? host : null;
  };
  // Give a claim span a citation marker for `key` if it doesn't have one yet — so
  // a span backed by several sources carries one numbered sup per source (the
  // publish path reads each sup as another source+quote on the same claim). The
  // sup is created only when a source is actually pinned, never on a bare add.
  const ensureCiteSup = (span, key) => {
    if (!span || !key || !ed.current) return null;
    const cid = span.getAttribute("data-cid"); if (!cid) return null;
    const here = Array.from(ed.current.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]'));
    const found = here.find(s => s.getAttribute("data-cite") === key);
    if (found) return found;
    let order = citeOrderRef.current;
    if (order.indexOf(key) < 0) { order = [...order, key]; citeOrderRef.current = order; setCiteOrder(order); }
    const sup = document.createElement("sup"); sup.className = "md-cite"; sup.setAttribute("contenteditable", "false");
    sup.setAttribute("data-cite", key); sup.setAttribute("data-cid", cid); sup.setAttribute("data-quote", ""); sup.title = key; sup.textContent = String(order.indexOf(key) + 1);
    // sit it right after the span's existing markers, so a claim's cites stay together
    let anchor = span, n = span.nextSibling;
    while (n && n.nodeType === 1 && n.tagName === "SUP" && n.classList.contains("md-cite") && n.getAttribute("data-cid") === cid) { anchor = n; n = n.nextSibling; }
    anchor.after(sup);
    if (!sources.find(x => x.key === key)) setSources(s => [{ key, archived: !!(window.NPJ.SOURCES[key] && window.NPJ.SOURCES[key].archive_url) }, ...s]);
    return sup;
  };
  // Pull back the pinned quote for one specific source on a span (a span can hold
  // several), so re-opening the picker shows the right words — not source #1's.
  const quoteForKey = (span, key) => {
    if (!span) return "";
    if (window.NpjCitations) { const c = (window.NpjCitations.citationsFor(span) || []).find(c => c.srcKey === key); if (c) return c.quote || ""; }
    try { const m = JSON.parse(span.getAttribute("data-quotes") || "null"); if (m && m[key] != null) return m[key]; } catch (e) {}
    return span.getAttribute("data-quote") || "";
  };
  const bindSource = (key) => {
    const r = spanRange();
    // Citing words that are ALREADY inside a sourced claim → add this source to
    // that span (a second citation), don't nest a new claim inside it.
    const host = claimHostOf(r);
    if (host) {
      const cid = host.getAttribute("data-cid");
      window.getSelection().removeAllRanges(); selRange.current = null; setSel(null); setMenu(null); setSrcUrl(""); setSrcPreview(null); setArmSrc(null);
      if (!sources.find(x => x.key === key)) setSources(s => [{ key, archived: !!(window.NPJ.SOURCES[key] && window.NPJ.SOURCES[key].archive_url) }, ...s]);
      openPin(cid, key, (host.textContent || "").trim());
      return;
    }
    if (!r) { setArmSrc(key); setMenu(null); return; }
    const claimText = String(r.toString() || "").trim();
    const cid = bindRangeToSource(r, key);
    window.getSelection().removeAllRanges(); selRange.current = null; setSel(null); setMenu(null); setSrcUrl(""); setSrcPreview(null); setArmSrc(null); setRev(v => v + 1); scheduleSave(); renumberCites();
    // now make the author point at the words in the source — the citation isn't
    // done until that span is pinned
    openPin(cid, key, claimText);
  };

  // ---- pin the source-span: the words IN THE SOURCE that back this claim ----
  const [pinTarget, setPinTarget] = useState(null); // { cid, key, claimText }
  const [pinQuote, setPinQuote] = useState("");
  const pinLoc = useRef(null);                      // char offsets into the source, from the picker
  // hover-to-remove: a floating × that tracks the cited span the pointer is over,
  // so dropping a citation is one click in the prose — no popover, no menu.
  const [citeHover, setCiteHover] = useState(null); // { cid, x, y }
  const citeHideT = useRef(null);
  // inline rename of a source straight from its rail card (the title is often a
  // filename or a guess — fix it where you see it)
  const [renameSrcKey, setRenameSrcKey] = useState(null);
  const [renameSrcText, setRenameSrcText] = useState("");
  const [confirmDelKey, setConfirmDelKey] = useState(null);   // a rail card armed for delete (unbinds its claims)
  const openPin = (cid, key, claimText) => {
    // re-opening an existing binding? read back this source's pinned quote (a span
    // can carry several, so read the one for THIS key, not just source #1)
    let existing = "";
    if (ed.current) { const el = ed.current.querySelector('.claim-src[data-cid="' + cid + '"]'); if (el) existing = quoteForKey(el, key); }
    setPinQuote(existing); pinLoc.current = null;
    setPinTarget({ cid, key, claimText });
  };
  const closePin = () => { setPinTarget(null); setPinQuote(""); pinLoc.current = null; };
  const savePin = (loc) => {
    const t = pinTarget; if (!t) return;
    const q = String(pinQuote || "").trim();
    if (!q) return;
    const span = ed.current && ed.current.querySelector('.claim-src[data-cid="' + t.cid + '"]');
    if (span) ensureCiteSup(span, t.key);   // a source ADDED to an existing span gets its own marker now (on pin, not on add)
    if (window.NpjCitations && span) {
      // mint a reusable citation RECORD and attach it — projectAttrs re-derives
      // data-src / data-quote / data-quotes and syncs every sup marker, so a
      // multi-source span publishes each source+quote and every downstream reader
      // (CiteyBrain, publishGate, htmlToBlocks) is unchanged.
      const id = window.NpjCitations.mint({ srcKey: t.key, quote: q, loc: loc || null });
      window.NpjCitations.attach(span, id);
      span.setAttribute("title", "Cited span — “" + q.slice(0, 140) + (q.length > 140 ? "…" : "") + "”");
    } else if (ed.current) {
      // registry unavailable — fall back to the inline behaviour, but only the
      // marker for THIS source (so other sources on the span keep their quotes)
      if (span) span.classList.remove("needs-quote");
      if (span) span.setAttribute("data-quote", q);
      if (span) span.setAttribute("title", "Cited span — “" + q.slice(0, 140) + (q.length > 140 ? "…" : "") + "”");
      ed.current.querySelectorAll('sup.md-cite[data-cid="' + t.cid + '"]').forEach(el => {
        if (el.getAttribute("data-cite") === t.key) el.setAttribute("data-quote", q);
      });
    }
    // remember the passage on the source record too, so the next claim off the
    // same source can be matched against text we've already pulled
    const rec = window.NPJ.SOURCES[t.key];
    if (rec && (!rec.text || rec.text.indexOf(q) < 0)) rec.text = (rec.text ? rec.text + "\n" : "") + q;
    closePin(); setRev(v => v + 1); scheduleSave();
    // let Citey flip ⊥→⊤ and re-cost the publish gate
    if (window.__citey) { if (span) window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
  };
  // Drop ONE source from a multi-source span: detach its citation record(s) and
  // remove its marker; the span keeps every other source it cites. If it was the
  // last one, NpjCitations.detach flags the span needs-quote (still bound, unpinned).
  const removeSrcFromSpan = (span, key) => {
    if (!span || !key) return;
    if (window.NpjCitations) (window.NpjCitations.citationsFor(span) || []).filter(c => c.srcKey === key).forEach(c => window.NpjCitations.detach(span, c.id));
    const cid = span.getAttribute("data-cid");
    if (cid && ed.current) Array.from(ed.current.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]')).filter(s => s.getAttribute("data-cite") === key).forEach(s => s.remove());
    const left = (span.getAttribute("data-src") || "").split(/\s+/).filter(Boolean);
    setRev(v => v + 1); scheduleSave(); renumberCites();
    if (window.__citey) { window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
    // if the popover was editing the source we just removed, follow it to a survivor
    if (pinTarget && pinTarget.key === key && pinTarget.cid === cid) {
      if (left.length) openPin(cid, left[0], pinTarget.claimText); else closePin();
    }
  };
  // Drop a citation ENTIRELY and hand the sentence back as plain prose: detach
  // every source the span cites, delete its markers, and unwrap the span (the
  // words stay, the binding goes). The reusable citation RECORDS survive in the
  // registry — reusable on other sentences — so this only unbinds THIS span. It
  // also clears an owned-claim stance / context the same way (unwrap drops both).
  const removeCitation = (span) => {
    if (!span) return;
    const cid = span.getAttribute("data-cid");
    if (window.NpjCitations) (window.NpjCitations.citationsFor(span) || []).forEach(c => window.NpjCitations.detach(span, c.id));
    if (cid && ed.current) Array.from(ed.current.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]')).forEach(s => s.remove());
    const parent = span.parentNode;
    if (parent) { while (span.firstChild) parent.insertBefore(span.firstChild, span); parent.removeChild(span); if (parent.normalize) parent.normalize(); }
    if (citeHideT.current) { clearTimeout(citeHideT.current); citeHideT.current = null; }
    setCiteHover(null);
    setRev(v => v + 1); scheduleSave(); renumberCites();
    if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate();
  };
  // a span carries a CITATION (a source binding) when it points at a source or a
  // citation record, or is bound-but-unpinned — but NOT a pure owned-claim stance.
  const spanIsCite = (span) => !!(span && (span.getAttribute("data-cite-id") || (span.getAttribute("data-src") || "").trim() || span.classList.contains("needs-quote")) && !span.getAttribute("data-stance"));
  // track the cited span under the pointer so the floating × can anchor to it.
  // Anchor to the span's last citation marker when it has one (the × sits right
  // by the little superscript), else the end of the span's last line.
  const onBodyOver = (e) => {
    if (!ed.current) return;
    // clean read: no citation chrome means no floating remove-× either — moving the
    // pointer over the prose shouldn't sprout a control to delete a binding you've
    // deliberately hidden. Clear any × left over from before the toggle.
    if (!citeHl) { if (citeHover) setCiteHover(null); return; }
    const cs = e.target.closest && e.target.closest(".claim-src, sup.md-cite[data-cid]");
    const cid = cs && cs.getAttribute("data-cid");
    const span = cid ? ed.current.querySelector('.claim-src[data-cid="' + cid + '"]') : null;
    if (!span || !spanIsCite(span)) { if (citeHover && !citeHideT.current) citeHideT.current = setTimeout(() => setCiteHover(null), 220); return; }
    if (citeHideT.current) { clearTimeout(citeHideT.current); citeHideT.current = null; }
    const marker = Array.from(ed.current.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]')).pop();
    let r;
    if (marker) r = marker.getBoundingClientRect();
    else { const rects = span.getClientRects(); r = rects[rects.length - 1] || span.getBoundingClientRect(); }
    const cy = r.top + r.height / 2;   // vertical center, so the × sits beside the marker, not over the line above
    setCiteHover(prev => (prev && prev.cid === cid && Math.abs(prev.x - r.right) < 1 && Math.abs(prev.y - cy) < 1) ? prev : { cid, x: r.right, y: cy });
  };
  const onBodyLeave = () => { if (citeHideT.current) clearTimeout(citeHideT.current); citeHideT.current = setTimeout(() => setCiteHover(null), 220); };
  // commit / cancel an inline source rename started from a rail card
  const commitSrcRename = (key) => { const t = renameSrcText.trim(); if (t) tableApi.renameSource(key, t); setRenameSrcKey(null); setRenameSrcText(""); };
  // The source-span ranking + paste flow now lives in the SourcePicker component
  // (app/SourcePicker.jsx), rendered inside the pin popover and the table.
  // Citey's grounding bridge — the popover's pin / own / unown act here so React
  // state (rev) and the autosave stay consistent. Owning a claim removes the
  // incomplete citation and records the author's stance; it publishes as prose.
  useEffect(() => {
    window.__npjGround = {
      focused: () => window.__citey && window.__citey.focused ? window.__citey.focused() : null,
      pin: (el) => { if (!el) return; const cid = el.getAttribute("data-cid"); if (!cid) return; openPin(cid, el.getAttribute("data-src") || el.getAttribute("data-cite"), (el.textContent || "").trim()); },
      own: (el, stance, note, kind) => {
        if (!el) return; const cid = el.getAttribute("data-cid");
        if (cid && ed.current) ed.current.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]').forEach(s => s.remove());
        el.removeAttribute("data-src"); el.removeAttribute("data-cid"); el.removeAttribute("data-quote");
        el.classList.remove("needs-quote");
        const norm = stance === "testimony" ? "testimony" : stance === "voice" ? "voice" : stance === "context" ? "context" : stance === "absence" ? "absence" : "analysis";
        el.setAttribute("data-stance", norm);
        // an asserted absence (a "void") records the documented search/evidence it
        // rests on AND which of the six kinds it is — removed / withheld / silent /
        // inaccessible / unrecorded / ambient — so the reader knows whether the
        // absence is shown, located, or only inferred (see app/void-kinds.js).
        const VK = window.NpjVoidKinds;
        const vk = norm === "absence" && VK ? VK.norm(kind) : null;
        if (norm === "absence") {
          if (note != null) el.setAttribute("data-note", String(note)); else el.removeAttribute("data-note");
          if (vk) el.setAttribute("data-void-kind", vk); else el.removeAttribute("data-void-kind");
        } else { el.removeAttribute("data-note"); el.removeAttribute("data-void-kind"); }
        el.setAttribute("title", norm === "context"
          ? "Continuing coverage — the article substantiates this, set against prior reporting"
          : norm === "absence"
            ? ((vk && VK ? VK.label(vk) + " void (you can " + ({ shown: "point to it", located: "locate it", inferred: "only assert it" }[VK.reader(vk)]) + ")" : "A documented void — an asserted absence") + (note ? " — " + note : ""))
            : "Owned by the author — " + ({ analysis: "their analysis", testimony: "their account", voice: "their stated position" }[norm]));
        setRev(v => v + 1); scheduleSave(); renumberCites();
      },
      unown: (el) => { if (!el) return; el.removeAttribute("data-stance"); el.removeAttribute("data-context"); el.classList.remove("claim-src"); setRev(v => v + 1); scheduleSave(); },
      // context links — sources cited as CONTEXT (prior coverage), not proof. They
      // ride a separate attribute so the gate, which only reads proof, is untouched.
      addContext: (el, key) => { if (!el || !key || !window.NpjCitations) return; window.NpjCitations.addContext(el, key); setRev(v => v + 1); scheduleSave(); if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate(); },
      removeContext: (el, key) => { if (!el || !key || !window.NpjCitations) return; window.NpjCitations.removeContext(el, key); setRev(v => v + 1); scheduleSave(); if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate(); },
      // attach an EXISTING reusable citation to a span (the many-to-many reuse path)
      attachCitation: (el, citeId) => {
        if (!el || !citeId || !window.NpjCitations) return;
        window.NpjCitations.attach(el, citeId);
        setRev(v => v + 1); scheduleSave();
        if (window.__citey) { window.__citey.evaluateSpan(el); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
      },
      // unlink a citation from a span — the RECORD survives (still reusable elsewhere)
      detachCitation: (el, citeId) => {
        if (!el || !citeId || !window.NpjCitations) return;
        window.NpjCitations.detach(el, citeId);
        setRev(v => v + 1); scheduleSave();
        if (window.__citey) { window.__citey.evaluateSpan(el); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
      },
      gate: () => window.CiteyBrain ? window.CiteyBrain.publishGate(ed.current) : null
    };
    return () => { if (window.__npjGround) delete window.__npjGround; };
  });
  // every bound span still missing its source-span (owned claims are grounded, skip them)
  const needsQuoteCount = () => { void rev; return ed.current ? Array.from(ed.current.querySelectorAll(".claim-src")).filter(el => !el.getAttribute("data-stance") && !(el.getAttribute("data-quote") || "").trim()).length : 0; };

  // ---- table view: the same draft, one row per sentence ----
  // Wrap a sentence (or sub-)range in a bare claim-src span — used when owning a
  // sentence that has no claim yet (own needs an element to mark).
  const wrapPlainClaim = (range) => {
    const cid = "cs-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);
    const span = document.createElement("span"); span.className = "claim-src"; span.setAttribute("data-cid", cid);
    try { range.surroundContents(span); } catch (e) { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); if (span.parentNode) span.parentNode.normalize(); }
    return span;
  };
  // Cite a VOID straight from the prose: wrap the highlighted words in a claim
  // span (or reuse the one they sit in) and OWN it as an asserted absence of a
  // given KIND — grounded not by a source but by the documented search/evidence
  // in `note`. Every kind but `ambient` (the unwritten normal) must say where it
  // looked; ambient is context, so its note is optional.
  const markVoid = (kind, note) => {
    const k = window.NpjVoidKinds ? window.NpjVoidKinds.norm(kind) : null; if (!k) return;
    const n = String(note || "").trim();
    if (!n && k !== "ambient") return;
    const r = spanRange(); if (!r) { setSel(null); setMenu(null); setVoidKind(""); return; }
    const span = claimHostOf(r) || wrapPlainClaim(r);
    if (window.__npjGround && window.__npjGround.own) window.__npjGround.own(span, "absence", n, k);
    if (window.__citey) { if (window.__citey.evaluateSpan) window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
    window.getSelection().removeAllRanges(); selRange.current = null;
    setSel(null); setMenu(null); setVoidSearch(""); setVoidKind(""); setRev(v => v + 1); scheduleSave(); renumberCites();
  };
  // Self-assert: ground the selected words as an OWNED claim — the author's own
  // analysis, account or stated voice — instead of binding a source. Mirrors
  // markVoid (wrap-or-reuse the claim span, then own it through the same bridge);
  // an owned claim needs no source and publishes as plain prose.
  const markOwn = (stance) => {
    const s = stance === "testimony" ? "testimony" : stance === "voice" ? "voice" : stance === "context" ? "context" : "analysis";
    const r = spanRange(); if (!r) { setSel(null); setMenu(null); return; }
    const span = claimHostOf(r) || wrapPlainClaim(r);
    if (window.__npjGround && window.__npjGround.own) window.__npjGround.own(span, s);
    if (window.__citey) { if (window.__citey.evaluateSpan) window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
    window.getSelection().removeAllRanges(); selRange.current = null;
    setSel(null); setMenu(null); setRev(v => v + 1); scheduleSave(); renumberCites();
  };
  // the three OWNED stances offered in the source popover's "stand behind it
  // yourself" row (glyphs + labels mirror citey-states.js / the grounding table)
  const OWN_STANCES = [
    ["analysis", "⊢", "My analysis", "Follows from grounded premises — your reasoning, not a source"],
    ["testimony", "⊨", "My account", "You are the primary witness — you saw or heard it yourself"],
    ["voice", "⊩", "My voice", "Your stated position — argument, not a claim of fact"],
  ];
  // Mint a brand-new source from the popover's hidden file input and bind the
  // saved span to the first file (skip the auto PII review so the pin reader can
  // open immediately; the rail still flags the review). The saved selection range
  // survives the file dialog, so binding lands on the words the author picked.
  const bindNewUpload = (fileList) => {
    const keys = addFiles(fileList, { quiet: true });
    if (keys && keys[0]) bindSource(keys[0]);
  };
  // The claim span a table row acts on: reuse an existing one inside the sentence
  // (sub-sentence safe — never nest), else wrap the whole sentence.
  const rowSpanFor = (row, key, plain) => {
    if (row.claimSpans && row.claimSpans.length) return row.claimSpans[0];
    const range = window.NpjSentences && window.NpjSentences.rangeFor(row);
    if (!range) return null;
    return plain ? wrapPlainClaim(range) : (ed.current && ed.current.querySelector('.claim-src[data-cid="' + bindRangeToSource(range, key) + '"]'));
  };
  const tableApi = {
    // track() = segment + reconcile against the persisted ledger, so every row
    // carries a STABLE sid + provenance that follows the sentence through edits.
    segment: () => (window.NpjSentences && ed.current) ? window.NpjSentences.track(ed.current, sentenceLedger.current) : [],
    // the live editor node — the workspace observes it so the grounding table
    // imports every prose sentence the moment it lands (survives the restore race)
    editorEl: () => ed.current,
    // the draft's title (the Title field, mirroring the body <h1>) — names the
    // fact-check worksheet export
    draftTitle: () => title,
    rev,
    toProse: () => setView("prose"),
    // scroll the (hidden) editor to a row and select it, then flip to prose
    jumpTo: (row) => {
      setView("prose");
      setTimeout(() => {
        const range = window.NpjSentences && window.NpjSentences.rangeFor(row); if (!range) return;
        const sel2 = window.getSelection(); sel2.removeAllRanges(); sel2.addRange(range);
        const rect = range.getBoundingClientRect(), cont = scroller.current;
        if (cont) { const cr = cont.getBoundingClientRect(); cont.scrollTop += (rect.top - cr.top) - 80; }
      }, 30);
    },
    // attach an existing reusable citation to this sentence (mints a span if
    // needed), or to a SPECIFIC span when a target cid is given (per-span rows)
    attachExisting: (row, citeId, targetCid) => {
      const c = window.NpjCitations && window.NpjCitations.get(citeId); if (!c) return;
      const span = (targetCid && ed.current && ed.current.querySelector('.claim-src[data-cid="' + targetCid + '"]')) || rowSpanFor(row, c.srcKey, false); if (!span) return;
      window.__npjGround.attachCitation(span, citeId);
    },
    detach: (span, citeId) => window.__npjGround.detachCitation(span, citeId),
    // open the source-span picker to mint a NEW citation off `key` for this sentence
    pinNew: (row, key) => {
      const span = rowSpanFor(row, key, false); if (!span) return;
      openPin(span.getAttribute("data-cid"), key, (span.textContent || "").trim());
    },
    // re-open the picker for an already-bound span
    repin: (span) => { if (span) openPin(span.getAttribute("data-cid"), (span.getAttribute("data-src") || "").split(/\s+/)[0], (span.textContent || "").trim()); },
    own: (row, stance, note, kind) => {
      const span = rowSpanFor(row, null, true); if (!span) return;
      window.__npjGround.own(span, stance, note, kind);
      if (window.__citey) { window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
    },
    unown: (span) => { window.__npjGround.unown(span); if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate(); },
    // own a SPECIFIC existing span (per-span grounding rows). The row-level own()
    // resolves to the sentence's first span; this targets the one you clicked on.
    ownSpan: (span, stance, note, kind) => {
      if (!span) return;
      window.__npjGround.own(span, stance, note, kind);
      if (window.__citey) { if (window.__citey.evaluateSpan) window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
    },
    // ---- context links: prior coverage a sentence builds on (context, not proof) ----
    // The source keys this sentence cites for context (across its claim spans).
    contextFor: (row) => {
      const out = [];
      (row.claimSpans || []).forEach(s => (window.NpjCitations ? window.NpjCitations.contextKeys(s) : []).forEach(k => { if (out.indexOf(k) < 0) out.push(k); }));
      return out;
    },
    // Link a source as CONTEXT to this sentence — context, not proof. If the
    // sentence wasn't a claim yet, linking prior coverage also grounds it as
    // continuing coverage ("in context"), so adding context never quietly creates
    // an ungrounded claim that blocks the gate. An already-grounded (or
    // mid-grounding) claim keeps its own status; the context just rides alongside.
    addContext: (row, key) => {
      const had = !!(row.claimSpans && row.claimSpans.length);
      const span = rowSpanFor(row, null, true); if (!span) return;
      if (!had && !span.getAttribute("data-stance") && !(span.getAttribute("data-quote") || "").trim()) {
        window.__npjGround.own(span, "context");
      }
      window.__npjGround.addContext(span, key);
    },
    removeContext: (row, key) => {
      (row.claimSpans || []).forEach(s => window.__npjGround.removeContext(s, key));
    },
    // the same context links, but scoped to ONE span — per-span grounding rows
    // show (and edit) each span's own prior coverage, not the sentence aggregate.
    contextForSpan: (span) => (span && window.NpjCitations) ? window.NpjCitations.contextKeys(span) : [],
    addContextSpan: (span, key) => { if (span && key) window.__npjGround.addContext(span, key); },
    removeContextSpan: (span, key) => { if (span && key) window.__npjGround.removeContext(span, key); },
    // sources in the order they appear in the document (the list tracks the prose)
    sources: () => {
      const ord = docOrderKeys();
      return sources.slice().sort((a, b) => ord.indexOf(a.key) - ord.indexOf(b.key))
        .map(s => ({ key: s.key, rec: window.NPJ.SOURCES[s.key] || {} }));
    },
    allCitations: () => window.NpjCitations ? window.NpjCitations.all() : [],
    citationsFor: (span) => window.NpjCitations ? window.NpjCitations.citationsFor(span) : [],
    usageCount: (citeId) => window.NpjCitations ? window.NpjCitations.usage(citeId, ed.current).length : 0,
    // ---- the grounding workspace's direct-mint path (no popover): the author
    // grabbed the exact words in the source reader — mint the reusable record
    // (multi-part spans supported) and attach it to this sentence's claim span.
    groundRow: (row, srcKey, quote, loc, spans, targetCid) => {
      const q = String(quote || "").trim(); if (!q || !srcKey) return false;
      const span = (targetCid && ed.current && ed.current.querySelector('.claim-src[data-cid="' + targetCid + '"]')) || rowSpanFor(row, srcKey, false); if (!span) return false;
      if (window.NpjCitations) {
        const id = window.NpjCitations.mint({ srcKey, quote: q, loc: loc || null, spans: spans || null });
        window.NpjCitations.attach(span, id);
      } else {
        span.setAttribute("data-quote", q); span.classList.remove("needs-quote");
      }
      span.setAttribute("title", "Cited span — “" + q.slice(0, 140) + (q.length > 140 ? "…" : "") + "”");
      setRev(v => v + 1); scheduleSave();
      if (window.__citey) { window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
      return true;
    },
    sourceRec: (key) => (window.NPJ.SOURCES || {})[key] || {},
    // the reader can't show text it doesn't have — pasted passages stick to the
    // source record (append-only, so existing citation offsets stay valid)
    seedSourceText: (key, text) => {
      const rec = window.NPJ.SOURCES[key]; const t = String(text || "").trim();
      if (!rec || !t) return;
      rec.text = (rec.text ? rec.text + "\n" : "") + t;
      setRev(v => v + 1);
      scheduleSave();   // pasted / PDF-extracted source text sticks to the draft
    },
    // Replace or clear a source's recognized/extracted text — fix or delete OCR
    // that came out wrong on an uploaded photo. Unlike seedSourceText this
    // OVERWRITES. Offsets into the old text may stop slicing clean, but the reader
    // re-finds a quote by content and each bound claim keeps its own data-quote, so
    // a citation is never silently dropped — its highlight just stops showing if the
    // words are gone. Persists through the same autosave.
    setSourceText: (key, text) => {
      const rec = window.NPJ.SOURCES[key]; if (!rec) return;
      rec.text = String(text || "");
      setRev(v => v + 1); scheduleSave();
    },
    // Treat this source AS a given kind — image | pdf | text | office — overriding
    // what its extension/mime auto-detected. Pass "" or "auto" to drop the override
    // and fall back to detection. This is what lets a scan that arrived as
    // octet-stream (or a screenshot with no extension) be opened — and OCR'd — as
    // the image it really is. Persists through the same autosave.
    setSourceKind: (key, kind) => {
      const rec = window.NPJ.SOURCES[key]; if (!rec) return;
      const k = String(kind || "").toLowerCase();
      if (k && k !== "auto") rec.kind = k; else delete rec.kind;
      setRev(v => v + 1); scheduleSave();
    },
    // Turn OCR on or off for an image source. OFF deletes the recognized text and
    // pins ocrOff so it isn't re-read; ON clears that and re-reads the picture
    // (lazy Tesseract), seeding the text. Returns a promise (resolves when the ON
    // read finishes) so the UI can show progress. Persists through autosave.
    setSourceOcr: (key, on) => {
      const rec = window.NPJ.SOURCES[key]; if (!rec) return Promise.resolve(false);
      if (on) {
        delete rec.ocrOff;
        setRev(v => v + 1); scheduleSave();
        return runOcr(key);
      }
      rec.ocrOff = true; rec.text = "";
      scanSource(key);                 // no text now → the PII review has nothing to flag
      setRev(v => v + 1); scheduleSave();
      return Promise.resolve(true);
    },
    // Surface (or hide) an image's recognized (OCR) text as the cited passage in
    // the reader's citation card. OFF by default — machine-read words are noisy
    // and stay hidden until the author vouches for them here. Orthogonal to
    // setSourceOcr (which reads/clears the text itself); this only governs whether
    // the reader sees it. Persists through the same autosave.
    setSourceOcrShow: (key, on) => {
      const rec = window.NPJ.SOURCES[key]; if (!rec) return;
      if (on) rec.ocrShow = true; else delete rec.ocrShow;
      setRev(v => v + 1); scheduleSave();
    },
    // rename a source — its display title across the editor, reader and exports.
    // The citation records and bound spans (keyed by the stable source key) are
    // untouched, so nothing about the grounding changes.
    renameSource: (key, title) => {
      const rec = window.NPJ.SOURCES[key]; const t = String(title || "").trim();
      if (!rec || !t || rec.title === t) return false;
      rec.title = t; rec.titleGuessed = false;   // an author's name is final — never re-guessed over
      setRev(v => v + 1); scheduleSave();
      return true;
    },
    // (re)guess a web source's title + outlet: the mechanical slug/host read right
    // away, then the real <title>/og: tags off the archived page. Honors a manual
    // rename (won't clobber a title the author set). Returns a promise for the UI.
    guessSourceTitle: (key) => {
      const rec = window.NPJ.SOURCES[key];
      if (!rec || !rec.original_url) return Promise.resolve(false);
      if (window.NpjSourceTitle && (rec.titleGuessed || !rec.title || /^web (snapshot|source)$/i.test(rec.title))) {
        const g = window.NpjSourceTitle.guess(rec.original_url);
        if (g.title && g.title !== rec.title) { rec.title = g.title; rec.titleGuessed = true; }
        if (g.outlet && !rec.outlet) rec.outlet = g.outlet;
        setRev(v => v + 1); scheduleSave();
      }
      return refineSourceTitle(key).then(() => true);
    },
    // a cheap, NETWORK-FREE pass: name every still-generic web source from its URL
    // slug/host (so a draft loaded before titling existed gets readable names at
    // once). Author-renamed titles are left alone. Returns how many it touched.
    autoTitleSources: () => {
      if (!window.NpjSourceTitle) return 0;
      let n = 0;
      Object.keys(window.NPJ.SOURCES || {}).forEach(key => {
        const rec = window.NPJ.SOURCES[key];
        if (!rec || !rec.original_url || rec.type === "interview") return;
        if (rec.titleGuessed === false) return;                                 // author-named — keep
        if (rec.title && !/^web (snapshot|source)$/i.test(rec.title)) return;    // already has a real title
        const g = window.NpjSourceTitle.guess(rec.original_url);
        if (g.title) { rec.title = g.title; rec.titleGuessed = true; n++; }
        if (g.outlet && !rec.outlet) rec.outlet = g.outlet;
      });
      if (n) { setRev(v => v + 1); scheduleSave(); }
      return n;
    },
    // delete a source from the draft: unbind every claim that cites it (unwrapping
    // any span left grounding nothing, and dropping its marker), discard the
    // citation records minted from it, then forget the record + library entry. The
    // prose keeps its words; only this source's grounding is removed.
    deleteSource: (key) => {
      const root = ed.current;
      if (root) {
        Array.from(root.querySelectorAll('.claim-src')).forEach(span => {
          const cites = window.NpjCitations ? window.NpjCitations.citationsFor(span) : [];
          const srcs = (span.getAttribute('data-src') || '').split(/\s+/).filter(Boolean);
          if (srcs.indexOf(key) < 0 && !cites.some(c => c.srcKey === key)) return;
          if (window.NpjCitations) cites.forEach(c => { if (c.srcKey === key) window.NpjCitations.detach(span, c.id); });
          const leftCites = window.NpjCitations ? window.NpjCitations.citationsFor(span) : [];
          const leftSrcs = (span.getAttribute('data-src') || '').split(/\s+/).filter(Boolean).filter(k => k !== key);
          if (leftSrcs.length || leftCites.length || span.getAttribute('data-stance')) {
            if (leftSrcs.length) span.setAttribute('data-src', leftSrcs.join(' ')); else span.removeAttribute('data-src');
          } else {
            const cid = span.getAttribute('data-cid');
            if (cid) Array.from(root.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]')).forEach(s => s.remove());
            const p = span.parentNode; while (span.firstChild) p.insertBefore(span.firstChild, span); p.removeChild(span);
          }
        });
        // sweep any leftover markers still pointing at this source
        Array.from(root.querySelectorAll('sup.md-cite[data-cite="' + key + '"]')).forEach(s => {
          const cid = s.getAttribute('data-cid');
          const span = cid && root.querySelector('.claim-src[data-cid="' + cid + '"]');
          if (!span || (span.getAttribute('data-src') || '').split(/\s+/).indexOf(key) < 0) s.remove();
        });
      }
      if (window.NpjCitations) window.NpjCitations.forSource(key).forEach(c => window.NpjCitations.remove(c.id));
      setSources(s => s.filter(x => x.key !== key));
      const ord = citeOrderRef.current.filter(k => k !== key); citeOrderRef.current = ord; setCiteOrder(ord);
      delete window.NPJ.SOURCES[key];
      setRev(v => v + 1); scheduleSave(); renumberCites();
      if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate();
      return true;
    },
    // add net new sources from inside the grounding workspace's cite modal — the
    // same URL-snapshot / file-upload ingest the Prose sources rail uses, so a
    // claim missing its source can pull one in WITHOUT leaving the grounding flow.
    // Each returns the new source keys (the modal opens its reader on the first).
    // Uploads run quiet — the auto-opened PII review sits behind the cite modal,
    // so it's skipped here; the rail still flags the source for review before it
    // can be archived, nothing is lost.
    addUrlSources: (raw) => ingestUrls(raw),
    addFileSources: (fileList) => addFiles(fileList, { quiet: true }),
  };
  // armed + a fresh selection just landed → bind it to the armed source
  // (layout effect so it binds before the floating toolbar can paint)
  React.useLayoutEffect(() => { if (armSrc && sel) bindSource(armSrc); }, [sel, armSrc]); // eslint-disable-line
  // ---- source identity: our best guess at the title + where it's from ----
  // Mechanical first (slug + host, no network, no model), then upgraded from the
  // page's own <title>/og: tags once the archived HTML is reachable. The guess
  // never blocks the bind, and a guessed title is flagged so a manual Rename wins.
  const guessWebRec = (u, key, fallbackTitle) => {
    let host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
    const g = window.NpjSourceTitle ? window.NpjSourceTitle.guess(u) : null;
    return {
      id: key, type: "primary",
      outlet: (g && g.outlet) || host,
      title: (g && g.title) || fallbackTitle,
      titleGuessed: true,
      original_url: u, archive_url: "", retrieved: new Date().toISOString().slice(0, 10)
    };
  };
  // Upgrade a web source's title/outlet from the page's own metadata. Only ever
  // replaces a title we guessed (never one the author renamed). Best-effort: a
  // blocked network or a missing capture just leaves the mechanical guess in place.
  const refineSourceTitle = async (key) => {
    const rec = window.NPJ.SOURCES[key];
    if (!rec || rec.type === "interview" || !rec.original_url) return;
    if (!window.NpjArchiveCDN || !window.NpjArchiveCDN.pageMeta || !window.NpjSourceTitle) return;
    const meta = await window.NpjArchiveCDN.pageMeta({ archiveUrl: rec.archive_url, url: rec.original_url }).catch(() => ({}));
    if (!meta) return;
    let changed = false;
    if (meta.title && rec.titleGuessed) {
      const t = window.NpjSourceTitle.cleanTitle(meta.title, meta.site || rec.outlet);
      if (t && t !== rec.title) { rec.title = t; changed = true; }
    }
    // og:site_name is the outlet's own name for itself — authoritative over the bare host
    if (meta.site && meta.site !== rec.outlet) { rec.outlet = meta.site; changed = true; }
    if (changed) { setRev(v => v + 1); scheduleSave(); }
  };
  const bindNewUrl = () => {
    const u = srcUrl.trim(); if (!/^https?:\/\//.test(u)) return;
    const key = "web-" + Date.now().toString(36);
    window.NPJ.SOURCES[key] = guessWebRec(u, key, "Web source");
    bindSource(key);            // binds the span + opens "pin the source-span"
    refineSourceTitle(key);
    // …and snapshot the URL in the background, so the flow is the one you asked
    // for: add a URL → it snapshots → pin the span. Non-blocking — the pin step
    // opens now; the row flips to "archived" when the wayback capture confirms.
    if (window.NpjArchiveCDN && window.NpjArchiveCDN.ensureSnapshot) {
      setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: true } : x));
      window.NpjArchiveCDN.ensureSnapshot(u).then(snap => {
        if (snap && window.NPJ.SOURCES[key]) window.NPJ.SOURCES[key].archive_url = snap;
        setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: false, archived: !!snap } : x));
        setRev(v => v + 1); scheduleSave();
      }).catch(() => setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: false } : x)));
    }
  };
  const applyLink = () => { const u = linkUrl.trim(); if (!u) return; restore(); document.execCommand("createLink", false, u); const sel2 = window.getSelection(); if (sel2.anchorNode) { const a = sel2.anchorNode.parentElement && sel2.anchorNode.parentElement.closest("a"); if (a) { a.target = "_blank"; a.rel = "noopener"; } } setLinkUrl(""); setMenu(null); setSel(null); };
  const insertJump = (id, text) => { restore(); document.execCommand("insertHTML", false, `<a href="#${id}" class="jumplink">${text}</a>&nbsp;`); setMenu(null); setSel(null); };

  // ---- sources ingestion ----
  const insertCite = (key) => bindSource(key);
  const spanCount = (key) => (ed.current ? ed.current.querySelectorAll('[data-src="' + key + '"]').length : 0);
  // Mint web sources from a blob of pasted URLs, snapshot each in the background,
  // and return the new source keys. Shared by the Prose rail's "Snapshot & store"
  // and the grounding workspace's in-modal "add a source" — a missing source can
  // be pulled in from either place with identical behaviour.
  const ingestUrls = (raw) => {
    const urls = String(raw || "").split(/[\s,]+/).map(u => u.trim()).filter(u => /^https?:\/\//.test(u));
    if (!urls.length) return []; setBusy(true);
    const made = urls.map((u, i) => {
      const key = "web-" + Date.now().toString(36) + i;
      window.NPJ.SOURCES[key] = guessWebRec(u, key, "Web snapshot");
      return { key, archived: false, snapshotting: true, url: u };
    });
    setSources(s => [...made, ...s]);
    // real snapshots: confirm an existing wayback capture, or request one and
    // wait for the availability API to verify it — "archived" is a fact here.
    // Each source is self-contained (try/catch) so one failure can't strand a
    // sibling's row spinning, and the button always clears via finally — the bug
    // where "Snapshotting…" spun forever (the source was already saved, hence
    // "it's there on refresh") was a throw between setSources and setBusy(false).
    Promise.all(made.map(async m => {
      try {
        const snap = await window.NpjArchiveCDN.ensureSnapshot(m.url).catch(() => null);
        if (snap && window.NPJ.SOURCES[m.key]) window.NPJ.SOURCES[m.key].archive_url = snap;
        setSources(s => s.map(x => x.key === m.key ? { ...x, snapshotting: false, archived: !!snap } : x));
        await refineSourceTitle(m.key).catch(() => {});   // titling is best-effort, never blocks the spinner
      } catch (e) {
        setSources(s => s.map(x => x.key === m.key ? { ...x, snapshotting: false } : x));
      }
    })).finally(() => setBusy(false));
    return made.map(m => m.key);
  };
  const addUrl = () => { if (ingestUrls(urlInput).length) setUrlInput(""); };
  // a conversation source (interview, named or anonymous) — built by the
  // composer, registered like any other source so the bind + pin flow works on
  // its notes. No URL to snapshot, so it never enters the archive/PII gate.
  const addInterview = (rec) => {
    if (!rec || !rec.id) return;
    window.NPJ.SOURCES[rec.id] = rec;
    setSources(s => [{ key: rec.id, archived: false, snapshotting: false }, ...s]);
    setInterviewOpen(false);
    setRev(v => v + 1); scheduleSave();
    // minted from the source popover → bind the saved span to it (the composer
    // never touched the prose, so the saved selection range is still good)
    if (bindAfterInterview.current) { bindAfterInterview.current = false; bindSource(rec.id); }
  };
  // the consented archive action (ArchiveModal) — request + verify for real;
  // a source with no original URL (an uploaded file) can't be auto-archived
  const onArchived = async (key) => {
    const rec = window.NPJ.SOURCES[key];
    setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: true } : x));
    const snap = rec && rec.original_url ? await window.NpjArchiveCDN.ensureSnapshot(rec.original_url).catch(() => null) : null;
    if (snap) rec.archive_url = snap;
    setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: false, archived: !!snap } : x));
  };
  // ---- PII review (Citey's archive gate) ----
  // Text we can actually read in-browser → Citey scans it. Binary types (pdf,
  // image, docx) carry no extractable text without a build step, so Citey's
  // review offers paste-or-affirm instead (rec.binary flags them).
  const TEXT_RE = /\.(txt|text|md|markdown|csv|tsv|log|json|xml|html?|rtf|srt|vtt|ini|ya?ml)$/i;
  const isTextFile = (f) => (f && /^text\//.test(f.type || "")) || /(json|xml|csv|html|markdown|ya?ml)/.test((f && f.type) || "") || TEXT_RE.test((f && f.name) || "");
  // Stamp a pending review envelope on a source so the gate shows until the
  // author has been through Citey. (The modal recomputes findings live.)
  const scanSource = (key) => {
    const rec = window.NPJ.SOURCES[key]; if (!rec || !window.NpjPII) return;
    const findings = rec.text && rec.text.trim() ? (window.NpjPII.detect(rec.text) || []) : [];
    if (!rec.piiReview) rec.piiReview = { state: "pending", basis: window.NpjPII.BASIS, scannedAt: new Date().toISOString(), redactions: [], affirmations: [] };
    rec.piiReview.findings = findings.length; rec.piiReview.scannedAt = new Date().toISOString();
  };
  // OCR an image source (lazy Tesseract) and seed its recognized text so it's
  // citable + scannable. Drives the per-row `ocr` spinner, re-scans for PII, and
  // autosaves. Best-effort: a failure clears the spinner and leaves the image as
  // is. Shared by the on-upload pass and the manual "turn on OCR" control.
  const runOcr = (key) => {
    const SVocr = window.NpjSourceView;
    const rec = window.NPJ.SOURCES[key];
    if (!SVocr || !SVocr.extractImageText || !rec || SVocr.kindOf(rec) !== "image") return Promise.resolve(false);
    setSources(s => s.map(x => x.key === key ? { ...x, ocr: true } : x));
    return SVocr.extractImageText(rec).then(t => {
      const live = window.NPJ.SOURCES[key]; let got = false;
      if (live && t && t.trim()) { live.text = t; live.binary = false; scanSource(key); got = true; }
      setSources(s => s.map(x => x.key === key ? { ...x, ocr: false } : x));
      scheduleSave();
      return got;
    }).catch(() => { setSources(s => s.map(x => x.key === key ? { ...x, ocr: false } : x)); return false; });
  };
  // A source bound for archive.org that Citey can act on (an upload, or anything
  // with text/opaque bytes) must clear the review before it's archived.
  const piiGated = (key) => { const rec = window.NPJ.SOURCES[key]; return !!rec && rec.type !== "interview" && (/^doc-/.test(key) || rec.binary || !!String(rec.text || "").trim()); };
  const needsPiiReview = (key) => piiGated(key) && window.NpjPII && !window.NpjPII.gateClear(window.NPJ.SOURCES[key]);
  const piiReviewState = (key) => window.NpjPII ? window.NpjPII.reviewState(window.NPJ.SOURCES[key]) : "unscanned";
  // Archive: gated behind Citey's PII review. Pending → open the review first,
  // remembering to resume the archive consent once it clears.
  const redactNext = useRef(null);
  const tryArchive = (s) => { if (needsPiiReview(s.key)) { redactNext.current = s; setRedactTarget(s.key); } else setArchiveTarget(s); };

  const addFiles = (fileList, opts) => {
    const quiet = !!(opts && opts.quiet);   // skip the auto-opened PII review (it sits behind the cite modal)
    const files = Array.from(fileList || []); if (!files.length) return [];
    const canUp = !!(window.NpjMedia && window.NpjMedia.canUpload && window.NpjMedia.canUpload());
    const made = files.map((f, i) => {
      const key = "doc-" + Date.now().toString(36) + i;
      window.NPJ.SOURCES[key] = { id: key, type: "primary", outlet: "uploaded document", title: f.name, filename: f.name, mime: f.type || "", size: f.size || 0, original_url: "", archive_url: "", file_url: "", retrieved: new Date().toISOString().slice(0, 10), text: "", binary: !isTextFile(f) };
      // keep the original bytes for THIS session so the file previews instantly
      // and survives a media-store upload that's still in flight (or failed)
      if (window.NpjSourceView) window.NpjSourceView.registerBlob(key, f);
      return { key, archived: false, snapshotting: false, uploading: canUp, file: f };
    });
    setSources(s => [...made, ...s]);
    // store the bytes durably on the media store (same store the article images
    // ride) so the document survives a reload / device switch and can be VIEWED
    // for citation later — not just this session. Best-effort: a failure leaves
    // the session blob in place and the row says "this browser only".
    if (canUp) made.forEach(async m => {
      try {
        const up = await window.NpjMedia.upload(m.file, m.file.name);
        const rec = window.NPJ.SOURCES[m.key];
        if (rec && up) { rec.file_url = up.url; rec.mxc = up.mxc; }
        setSources(s => s.map(x => x.key === m.key ? { ...x, uploading: false } : x));
        scheduleSave();
      } catch (e) {
        setSources(s => s.map(x => x.key === m.key ? { ...x, uploading: false, uploadErr: (e && e.message) || "upload failed" } : x));
      }
    });
    // read text out of text-like files so it can be scanned + cited, then stamp a
    // pending PII review and open the review on the first upload.
    Promise.all(made.map(m => new Promise(resolve => {
      if (!isTextFile(m.file)) return resolve();
      const r = new FileReader();
      r.onload = () => { const rec = window.NPJ.SOURCES[m.key]; if (rec) { rec.text = String(r.result || ""); rec.binary = false; } resolve(); };
      r.onerror = () => resolve();
      try { r.readAsText(m.file); } catch (e) { resolve(); }
    }))).then(() => {
      made.forEach(m => scanSource(m.key));
      setSources(s => [...s]);
      if (!quiet && made[0]) setRedactTarget(made[0].key);
      scheduleSave();
    });
    // Screenshots & scans carry no machine-readable text. OCR them (lazy
    // Tesseract) so an uploaded image becomes CITABLE — its words flow into the
    // pin reader — and SCANNABLE — the PII review sees what's in it. Runs off the
    // session blob, so it doesn't wait on the media-store upload. Best-effort: a
    // failure leaves the image as-is (cite it by transcribing).
    const SVocr = window.NpjSourceView;
    if (SVocr && SVocr.extractImageText) {
      made.filter(m => { const r = window.NPJ.SOURCES[m.key]; return SVocr.kindOf(r) === "image" && !(r && r.ocrOff); }).forEach(m => runOcr(m.key));
    }
    return made.map(m => m.key);
  };

  // ---- Matrix: projects (shared rooms) + invites ----
  // A project is one Matrix room that can hold many documents; everyone invited
  // to the project can work on every document attached to it. A document joins
  // a project on first invite — either a brand-new project or an existing one.
  useEffect(() => {
    if (!invite || !session || projects) return;
    let alive = true;
    (async () => {
      try { const list = await window.MatrixAuth.listDrafts(); if (alive) setProjects(list || []); }
      catch (e) { if (alive) setProjects([]); }
    })();
    return () => { alive = false; };
  }, [invite, session, projects]);

  const doInvite = async () => {
    const raw = inviteVal.trim(); if (!raw) return;
    if (!session) { setInviteMsg("Sign in with Matrix to invite collaborators."); return; }
    const id = window.MatrixAuth.parseMxid(raw);
    if (!id) { setInviteMsg("Use a full Matrix ID: @name:server"); return; }
    setInviteMsg("Inviting …");
    try {
      let rm = room;
      if (!rm) {
        const existing = projPick && (projects || []).find(p => p.roomId === projPick);
        if (existing) rm = { roomId: existing.roomId, title: existing.title || "Untitled project" };
        else { const made = await window.MatrixAuth.createDraftRoom(title || "Untitled draft"); rm = { ...made, title: title || "Untitled draft" }; }
        setRoom(rm);
      }
      await window.MatrixAuth.invite(rm.roomId, id.mxid);
      setCollabs(c => c.includes(id.mxid) ? c : [...c, id.mxid]);
      setInviteVal(""); setInviteMsg("Invited " + id.mxid + " into the project — they can work on every document in it.");
    } catch (e) { setInviteMsg("Invite failed: " + (e.message || "try again")); }
  };
  const openRooms = async () => {
    setShowRooms(true);
    if (rooms) return;
    setRooms({ loading: true });
    try {
      const [joined, drafts] = await Promise.all([window.MatrixAuth.joinedRooms(), window.MatrixAuth.listDrafts()]);
      setRooms({ joined, drafts });
    } catch (e) { setRooms({ joined: [], drafts: [], error: e.message }); }
  };

  const versions = [{ sha: "draft", ts: new Date().toISOString().slice(0, 10), author: (session && session.user_id) || me, message: "Current working draft", headline: title || "", dek: dek || "", text: ed.current ? (ed.current.innerText || "") : "" }];

  const TB = ({ onClick, children, title }) => <button onMouseDown={e => e.preventDefault()} onClick={onClick} title={title} aria-label={title} className="np-cond" style={{ background: "transparent", border: 0, color: NR.text, padding: "5px 9px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>{children}</button>;
  const Sep = () => <span style={{ width: 1, height: 18, background: NR.line, margin: "0 5px" }} />;
  const popStyle = { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 8 };
  const popItem = { display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--rule)", padding: "8px 6px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" };
  const FB = ({ onClick, children, hot, title }) => <button title={title} aria-label={title} onMouseDown={e => e.preventDefault()} onClick={onClick} style={{ background: hot ? "var(--yellow)" : "transparent", color: hot ? "var(--ink)" : "#e3ddcc", border: 0, padding: "5px 9px", fontSize: 13, fontWeight: 700, fontFamily: "var(--cond)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</button>;

  // Is this draft's slug already in the committed record? If so the publish
  // control is really a REPUBLISH — the label + gate copy adapt so the editor
  // never claims "nothing has been published yet" about a piece that's already
  // live. Reactive to the title/filename, so it tracks what would actually be
  // committed.
  const liveMeta = (window.NpjArticles && window.NpjArticles.publishedMeta)
    ? window.NpjArticles.publishedMeta(fileSlug || slugify(title)) : null;
  const isRepublish = !!liveMeta;
  const isLive = isRepublish && liveMeta.status !== "unpublished";

  // admin: take an already-live piece off the site. A status-only REC (no
  // content recommit, nothing deleted) — the draft stays here, and "Republish"
  // pushes it back live anytime. Mirrors the reader/Documents unpublish path.
  const unpublish = async () => {
    const slug = fileSlug || slugify(title);
    if (!slug) return;
    setStatusErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setStatusErr("Sign in with Matrix to unpublish — the webhook re-verifies the token server-side."); return; }
    if (!window.confirm("Unpublish “" + (title || slug) + "”?\n\nIt comes off the site for everyone but admins. Every version stays in GitHub — Republish brings it back anytime.")) return;
    setStatusBusy(true);
    try {
      const actor = (session && session.user_id) || me || ((window.MatrixAuth.current() || {}).user_id) || null;
      const out = await window.NpjArticles.setArticleStatus({ slug, status: "unpublished", actor, token });
      if (!out.res.ok) {
        setStatusErr("Rejected (HTTP " + out.res.status + ")" + ((out.res.status === 401 || out.res.status === 403) ? " — that Matrix account isn't authorized to manage publication." : " — nothing changed."));
      } else {
        // refresh the front index, then force this slug's new status in (the
        // git-tree listing lags a fresh commit) and re-render so the button flips
        const reflect = () => { window.NpjArticles.patchFrontStatus(slug, "unpublished"); setRev(r => r + 1); };
        window.NpjArticles.loadFront().then(reflect).catch(reflect);
      }
    } catch (e) {
      setStatusErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
    }
    setStatusBusy(false);
  };

  // Lock the shell to the viewport so the two chrome bars (top bar + format
  // toolbar) stay put and ONLY the body columns scroll. height:100dvh +
  // overflow:hidden caps the container (the old minHeight:100vh was a floor, so
  // a tall draft grew the page and scrolled the whole header away). The body's
  // columns already scroll internally (overflowY:auto, minHeight:0).
  return (
    <div className={"newsroom fade-in" + (theme === "light" ? " nr-light" : "")} style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* top bar — pinned: never shrinks or scrolls with the body */}
      <div className="nr-chrome" style={{ borderBottom: "1.5px solid " + NR.line, padding: "10px 20px", alignItems: "center", flexShrink: 0,
        ...(isMobile
          ? { display: "flex", flexWrap: "wrap", gap: 10 }
          : { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", columnGap: 14 }) }}>
        {/* LEFT zone: exit + wordmark + document name. The view tabs live in the
            centered middle column, so a longer document name truncates HERE
            instead of shoving the tabs sideways. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <button onClick={onExit} className="np-cond" style={{ background: "none", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
          <I.arrow style={{ fontSize: 14, transform: "rotate(180deg)" }} /> <span className="npj-hide-sm">Public site</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={onDocs || onExit} title="Newsroom home — your document explorer" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
            <I.lock style={{ fontSize: 18, color: "var(--yellow)" }} />
            <span style={{ fontFamily: "var(--display)", fontSize: 20, color: NR.text }}>NEWSROOM</span>
          </button>
          {/* clipped so a long headline can't widen the bar and shove the controls */}
          <span className="np-mono npj-hide-sm" title={fileSlug ? "custom document name — set at the publish gate" : "document name follows the headline — rename it at the publish gate"} style={{ fontSize: 11.5, color: NR.muted, display: "inline-flex", alignItems: "center", maxWidth: 180, flex: "0 1 auto", minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileSlug || slugify(title) || "untitled"}</span>/
          </span>
        </div>
        </div>{/* end LEFT zone */}
        {/* CENTER zone: the four pivoting views — centered in the bar and fixed
            in place, so they never shift when the document name changes. */}
        <div style={{ display: isMobile ? "flex" : "inline-flex", width: isMobile ? "100%" : undefined, border: "1px solid " + NR.line, borderRadius: 8, overflow: "hidden", justifySelf: "center" }}>
          {[["prose", "Prose", "The prose editor"],
            ["grounding", "Grounding", "Every sentence as a row to ground"],
            ["citations", "Citations", "The registry of reusable citation records"],
            ["sources", "Sources", "Read the source documents and grab the words that back a claim"],
            ["definitions", "Definitions", "The piece's glossary — terms a reader may need defined, suggested by eoreader4 and sourced"],
            ["graph", "Graph", "The document as a graph of its propositions — entities and the relations between them"]].map(([k, label, ti]) => (
            <button key={k} onClick={() => setView(k)} className="np-cond" title={ti} style={{ flex: isMobile ? 1 : undefined, textAlign: "center", background: view === k ? "var(--yellow)" : "transparent", color: view === k ? "var(--ink)" : NR.text, border: 0, padding: isMobile ? "9px 6px" : "5px 13px", fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
        {/* RIGHT zone: autosave status + tools + publish */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, justifySelf: "end", flexWrap: "wrap", minWidth: 0 }}>
        <span className="npj-hide-sm" style={{ display: "inline-flex" }}>
          <DraftStatusPill id={draftId} signedIn={!!session} user={session && session.user_id}
            what="text, title, tags, column and bound sources" />
        </span>
        <button onClick={toggleTheme} title={theme === "dark" ? "Switch the newsroom to light mode" : "Switch the newsroom to dark mode"} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {theme === "dark" ? <I.sun style={{ fontSize: 13 }} /> : <I.moon style={{ fontSize: 13 }} />} <span className="npj-hide-sm">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
        <window.VersionBadge sha="draft" count={versions.length} onClick={() => setShowVersions(true)} dark={theme === "dark"} />
        {onDocs && <button onClick={onDocs} title="All your documents" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.doc style={{ fontSize: 13 }} /> <span className="npj-hide-sm">Docs</span></button>}
        <div style={{ position: "relative" }}>
          <button onClick={openRooms} title="Your projects" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 13 }} /> <span className="npj-hide-sm">Projects</span></button>
          {showRooms && <ProjectsMenu rooms={rooms} onClose={() => setShowRooms(false)} signedIn={!!session} />}
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setInvite(v => !v)} title="Invite a collaborator" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.plus style={{ fontSize: 13 }} /> <span className="npj-hide-sm">Invite</span></button>
          {invite && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300, maxWidth: "calc(100vw - 24px)", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(0,0,0,.3)", padding: 12, zIndex: 30 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Invite to the project</div>
              <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 8, lineHeight: 1.45 }}>A project can hold many documents — everyone invited works on all of them.</div>
              {room
                ? <div className="np-mono" style={{ fontSize: 10.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}><I.folder style={{ fontSize: 12, flex: "0 0 auto" }} /> <span style={{ fontWeight: 600 }}>{room.title || title || "Untitled project"}</span></div>
                : (projects && projects.length > 0 && (
                    <select value={projPick} onChange={e => setProjPick(e.target.value)} className="np-cond" style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", padding: "6px", fontSize: 13, marginBottom: 8 }}>
                      <option value="">New project · “{title || "Untitled"}”</option>
                      {projects.map(p => <option key={p.roomId} value={p.roomId}>Add to: {p.title || p.roomId}</option>)}
                    </select>
                  ))}
              <div style={{ display: "flex", gap: 6 }}>
                <input value={inviteVal} onChange={e => setInviteVal(e.target.value)} onKeyDown={e => e.key === "Enter" && doInvite()} placeholder="@name:server" className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
                <button className="btn btn-sm btn-primary" onClick={doInvite}>Invite</button>
              </div>
              {inviteMsg && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.4 }}>{inviteMsg}</div>}
              {/* invite someone with no Matrix account — mint one + a single link,
                  and put them in the same project the typed-mxid invite would use */}
              <NewAccountInvite
                roomId={room ? room.roomId : null}
                roomTitle={room ? (room.title || title) : title}
                ensureRoom={async () => {
                  let rm = room;
                  if (!rm) {
                    const existing = projPick && (projects || []).find(p => p.roomId === projPick);
                    if (existing) rm = { roomId: existing.roomId, title: existing.title || "Untitled project" };
                    else { const made = await window.MatrixAuth.createDraftRoom(title || "Untitled draft"); rm = { ...made, title: title || "Untitled draft" }; }
                    setRoom(rm);
                  }
                  return rm.roomId;
                }}
                onInvited={(mx) => setCollabs(c => c.includes(mx) ? c : [...c, mx])} />
              {room && room.alias && <div className="np-mono" style={{ fontSize: 10, color: "var(--verified)", marginTop: 5 }}>{room.alias}</div>}
            </div>
          )}
        </div>
        <div className="npj-hide-sm" style={{ display: "flex" }}>
          {collabs.slice(0, 4).map((e, i) => { const p = window.NPJ.PEOPLE[e] || { name: e.replace(/^@/, ""), color: "#888" }; return <span key={e + i} title={p.name} style={{ width: 26, height: 26, borderRadius: "50%", background: p.color, color: "#fff", border: "2px solid " + NR.bg, marginLeft: i ? -8 : 0, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{(p.name || "?")[0].toUpperCase()}</span>; })}
        </div>
        {statusErr && <span className="np-mono" title={statusErr} style={{ fontSize: 10.5, color: NR.warn, maxWidth: 240, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" }}>{statusErr}</span>}
        {isRepublish && !isLive && <span className="np-mono" title="This piece is currently off the site — Republish brings it back live." style={{ fontSize: 10, color: NR.warn, border: "1px solid " + NR.warn, padding: "2px 7px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ fontFamily: "var(--mono)" }}>⊘</span> Off the site</span>}
        {isAdmin && isLive && (
          <button onClick={unpublish} disabled={statusBusy} title="Unpublish — take this off the site for everyone but admins (the event log stays in GitHub)" className="np-cond" style={{ background: "transparent", color: NR.warn, border: "1.5px solid " + NR.warn, padding: "7px 14px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: statusBusy ? "wait" : "pointer", opacity: statusBusy ? .6 : 1 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>⊘</span> {statusBusy ? "Working…" : "Unpublish"}
          </button>
        )}
        <button onClick={openPreview} title="Preview — see the piece exactly as it will appear once published" className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "7px 13px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <I.eye style={{ fontSize: 14 }} /> <span className="npj-hide-sm">Preview</span>
        </button>
        <button onClick={() => canPub ? setPublish({ step: 0 }) : null} disabled={!canPub} title={canPub ? (isRepublish ? (isLive ? "Republish — this piece is already live; committing lands an updated version in its event log" : "Republish — this piece is off the site; committing pushes the draft and brings it back live") : "Publish") : "Only an admin or assigned column publisher can publish"} className="np-cond" style={{ background: canPub ? "var(--yellow)" : "transparent", color: canPub ? "var(--ink)" : NR.muted, border: "1.5px solid " + (canPub ? "var(--ink)" : NR.line), padding: "7px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: canPub ? "pointer" : "not-allowed" }}>
          <I.lock style={{ fontSize: 14 }} /> {isRepublish ? "Republish" : "Publish"}
        </button>
        </div>{/* end RIGHT zone */}
      </div>

      {/* formatting toolbar — pinned alongside the top bar */}
      <div className="nr-chrome" style={{ borderBottom: "1px solid " + NR.line, padding: isMobile ? "6px 8px" : "7px 20px", display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", flexShrink: 0 }}>
        <span className="np-eyebrow npj-hide-sm" style={{ color: NR.muted, marginRight: 6 }}>Format</span>
        <TB onClick={() => exec("undo")} title="Undo"><I.undo /></TB>
        <TB onClick={() => exec("redo")} title="Redo"><I.redo /></TB>
        <Sep />
        <TB onClick={() => exec("formatBlock", "<h1>")} title="Title">H1</TB>
        <TB onClick={() => exec("formatBlock", "<h2>")} title="Heading">H2</TB>
        <TB onClick={() => exec("formatBlock", "<h3>")} title="Subheading">H3</TB>
        <TB onClick={() => exec("formatBlock", "<p>")} title="Body text">¶</TB>
        <Sep />
        <TB onClick={() => exec("bold")} title="Bold"><b>B</b></TB>
        <TB onClick={() => exec("italic")} title="Italic"><i>I</i></TB>
        <TB onClick={() => exec("strikeThrough")} title="Strikethrough"><s>S</s></TB>
        <TB onClick={() => wrapInline("code")} title="Inline code"><I.code /></TB>
        <TB onClick={applyHighlight} title="Highlight"><I.highlighter /></TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "color" ? null : "color")} title="Text color"><span style={{ borderBottom: "3px solid var(--reject)", fontWeight: 700, lineHeight: 1 }}>A</span> <I.caretDown style={{ fontSize: 9 }} /></TB>
          {fmtMenu === "color" && (
            <div style={{ ...popStyle, width: 168 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Text color</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["#b23a26", "#2b5f8a", "#1f6f4a", "#9a6a12", "#e3ddcc"].map(c => (
                  <button key={c} onMouseDown={e => e.preventDefault()} onClick={() => applyColor(c)} title={c}
                    style={{ width: 26, height: 26, background: c, border: "1.5px solid var(--ink)", cursor: "pointer" }} />
                ))}
              </div>
              <button onMouseDown={e => e.preventDefault()} onClick={() => { exec("removeFormat"); setFmtMenu(null); }} className="np-mono" style={{ marginTop: 8, width: "100%", border: "1px dashed var(--rule-strong)", background: "transparent", fontSize: 10.5, padding: "5px", cursor: "pointer" }}>clear color &amp; marks</button>
            </div>
          )}
        </div>
        <Sep />
        <TB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote"><I.quote /></TB>
        <TB onClick={() => exec("insertUnorderedList")} title="Bulleted list"><I.listBullets /></TB>
        <TB onClick={() => exec("insertOrderedList")} title="Numbered list"><I.listNumbers /></TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "align" ? null : "align")} title="Alignment"><I.alignLeft /> <I.caretDown style={{ fontSize: 9 }} /></TB>
          {fmtMenu === "align" && (
            <div style={{ ...popStyle, width: 168 }}>
              {/* select the whole draft first, then pick an alignment to set it across
                  the entire document at once — the menu stays open after Select all */}
              <button onMouseDown={e => e.preventDefault()} onClick={selectAllBody} style={popItem}>Select all text</button>
              {[["justifyLeft", "Align left"], ["justifyCenter", "Center"], ["justifyRight", "Align right"], ["justifyFull", "Justify"]].map(([cmd, label]) => (
                <button key={cmd} onMouseDown={e => e.preventDefault()} onClick={() => { exec(cmd); setFmtMenu(null); }} style={popItem}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <TB onClick={() => exec("insertHorizontalRule")} title="Divider"><I.divider /></TB>
        <Sep />
        <TB onClick={insertImage} title="Inline image"><I.image style={{ fontSize: 14 }} /> Image</TB>
        <TB onClick={insertCarousel} title="Image carousel — a swipeable gallery of photos"><I.images style={{ fontSize: 14 }} /> Carousel</TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "embed" ? null : "embed")} title="Embed a video, a Google Drive / archive.org file, audio or a link"><I.play style={{ fontSize: 14 }} /> Embed</TB>
          {fmtMenu === "embed" && (() => {
            // a Drive / Docs / archive.org file has no knowable aspect, so it
            // takes a height; YouTube/Vimeo keep their 16:9 and ignore it.
            const er = window.NpjEmbed && window.NpjEmbed.resolve(embedUrl.trim());
            return (
            <div style={{ ...popStyle, width: 300 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Embed media</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus value={embedUrl} onChange={e => setEmbedUrl(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && insertEmbed()} placeholder="YouTube, Vimeo, Google Drive, archive.org, .mp4…" className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 11.5, outline: "none" }} />
                <button className="btn btn-sm btn-primary" onClick={insertEmbed}>Add</button>
              </div>
              {er && er.panel && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
                  <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>Height</span>
                  <input type="number" min="120" step="20" value={embedHeight} onChange={e => setEmbedHeight(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && insertEmbed()} className="np-mono" style={{ width: 64, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "5px 7px", fontSize: 11.5, outline: "none" }} />
                  <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>px · the frame's height</span>
                </label>
              )}
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.4 }}>Drive / Docs / archive.org files &amp; video / audio embed in the draft; the published article keeps the permalink.</div>
            </div>
            );
          })()}
        </div>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "more" ? null : "more")} title="More blocks"><I.dots style={{ fontSize: 14 }} /> More <I.caretDown style={{ fontSize: 9 }} /></TB>
          {fmtMenu === "more" && (
            <div style={{ ...popStyle, left: "auto", right: 0, width: 190 }}>
              {[
                [<I.codeBlock />, "Code block", () => { exec("formatBlock", "<pre>"); setFmtMenu(null); }],
                [<I.divider />, "Divider", () => { exec("insertHorizontalRule"); setFmtMenu(null); }],
                [<I.asterisk />, "Footnote", insertFootnote],
                [<I.penNib />, "Poetry", insertVerse],
                [<I.poll />, "Poll", insertPoll]
              ].map(([g, label, fn]) => (
                <button key={label} onMouseDown={e => e.preventDefault()} onClick={fn} style={popItem}>
                  <span style={{ width: 22, textAlign: "center", flex: "0 0 auto", display: "inline-flex", justifyContent: "center" }}>{g}</span> {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Sep />
        {/* clean-read toggle: hide every citation overlay — the claim highlights
            (tints, underlines, stance glyphs), the inline citation + footnote
            marker chips, and the Footnotes list — AND step the citation interactions
            aside (no pin popover on click, no hover ×, no Source/Void in the
            selection toolbar) so the canvas is a plain prose editor. Doesn't touch
            the words, their sources or the notes. Remembered across reloads
            (localStorage, CITEHL_KEY). Going clean dismisses any open citation UI. */}
        <button onMouseDown={e => e.preventDefault()} onClick={() => setCiteHl(v => { const next = !v; try { localStorage.setItem(CITEHL_KEY, next ? "1" : "0"); } catch (e) {} if (!next) { setMenu(null); setCiteHover(null); closePin(); } return next; })} aria-pressed={!citeHl}
          title={citeHl ? "Citations & footnotes shown — click for a clean read (hides the highlights and marker chips, and turns off the citation popups so you can just type)" : "Clean read — citation layer and its popups hidden, so the canvas edits like plain prose. Click to bring citations back"}
          className="np-cond" style={{ background: "transparent", border: 0, color: citeHl ? NR.text : NR.muted, padding: "5px 9px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {citeHl ? <I.eye style={{ fontSize: 14 }} /> : <I.eyeoff style={{ fontSize: 14 }} />} <span className="npj-hide-sm">Citations</span>
        </button>
        {view === "prose" && <Sep />}
        {view === "prose" && (
          <button onMouseDown={e => e.preventDefault()} onClick={() => (htmlMode ? closeHtmlSource() : openHtmlSource())} aria-pressed={htmlMode}
            title={htmlMode ? "Close the HTML source view" : "Edit the underlying HTML — unstick a block, retag a heading, clear broken markup"}
            className="np-cond" style={{ background: htmlMode ? "var(--yellow)" : "transparent", border: 0, color: htmlMode ? "var(--ink)" : NR.text, padding: "5px 9px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <I.code style={{ fontSize: 14 }} /> <span className="npj-hide-sm">HTML</span>
          </button>
        )}
        <Sep />
        {/* comments + chat: an end-to-end-encrypted collaboration rail, private to
            this project's members. When on, it takes over the right panel. */}
        <button onMouseDown={e => e.preventDefault()} onClick={() => setCommentsOn(v => !v)} aria-pressed={commentsOn}
          title={commentsOn ? "Hide comments & chat" : "Comments & chat — leave Google-Docs-style comments and suggested edits, and chat with the other writers/editors. End-to-end encrypted, private to this project's members."}
          className="np-cond" style={{ background: commentsOn ? "var(--yellow)" : "transparent", border: 0, color: commentsOn ? "var(--ink)" : NR.text, padding: "5px 9px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I.chat style={{ fontSize: 14 }} /> <span className="npj-hide-sm">Comments</span> <I.lock style={{ fontSize: 11 }} />
        </button>
        <span style={{ flex: 1 }} />
        <span className="np-mono npj-hide-sm" style={{ fontSize: 10.5, color: NR.muted }}>select text → format, link, or bind a source — then pin the words in the source</span>
      </div>

      {/* mobile tab switcher — one panel at a time; the editor node stays mounted so a draft is never dropped */}
      {isMobile && (
        <div style={{ display: "flex", borderBottom: "1px solid " + NR.line, background: NR.rail, flexShrink: 0 }}>
          {[["write", "Write"], ["contents", "Contents" + (toc.length ? " · " + toc.length : "")], ["sources", "⊥ Sources · " + sources.length]].concat(commentsOn ? [["comments", "💬 Talk"]] : []).map(([k, label]) => (
            <button key={k} onClick={() => setMTab(k)} className="np-cond" style={{ flex: 1, background: mTab === k ? "var(--yellow)" : "transparent", color: mTab === k ? "var(--ink)" : NR.text, border: 0, borderRight: "1px solid " + NR.line, padding: "11px 6px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      )}

      {/* body: contents · editor · sources (stacks to one tabbed column on mobile) */}
      <div style={{ flex: 1, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateColumns: isMobile ? undefined : "200px 1fr 340px", gridTemplateRows: isMobile ? undefined : "minmax(0, 1fr)" }}>
        {/* contents / jumplinks */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "contents" ? "block" : "none") : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 12px 30px", background: NR.rail, borderRight: isMobile ? 0 : "1.5px solid " + NR.line }}>
          <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 10 }}>Contents</div>
          {/* the structure rail IS the editor TOC: the top-level Item list — slots
              (labeled containers showing their prompt when empty) + orphan
              sections, draggable. Editing-only; none of it reaches a reader. */}
          {structApi && window.StructureRail
            ? <window.StructureRail api={structApi} NR={NR} isMobile={isMobile} mode={structMode} setMode={setStructMode} graphText={graphText} onSelectSentence={jumpToProse} onExpand={() => setView("graph")} activeId={activeId} />
            : (toc.length === 0
                ? <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Add H1/H2/H3 headings and they'll show here as jump-links.</div>
                : toc.map(h => <button key={h.id} onClick={() => scrollToId(h.id)} className="np-cond" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, color: h.level === 1 ? NR.text : NR.soft, padding: "4px 0 4px " + ((h.level - 1) * 10) + "px", fontSize: h.level === 1 ? 14 : 13, fontWeight: h.level === 1 ? 700 : 500, cursor: "pointer", lineHeight: 1.2 }}>{h.text}</button>))}
          {/* media census — every image/embed in the piece; images open the viewer */}
          <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Media · {media.length}</div>
            {media.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Images and embeds in the piece collect here. Click <b>Image</b> in the toolbar to drop an image into the body where you're writing — or paste / drag a photo straight onto the page.</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {media.map(m => m.kind === "image"
                ? <button key={m.mid} title={(m.caption || "image") + " — open the viewer"} onClick={() => setViewer(Math.max(0, mediaImages.findIndex(x => x.mid === m.mid)))} style={{ width: 44, height: 44, padding: 0, border: "1px solid " + NR.line, background: NR.field, cursor: "zoom-in", overflow: "hidden" }}>
                    <NrMediaImg url={m.url} alt={m.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </button>
                : <button key={m.mid} title={(m.caption || m.url) + " — show in document"} onClick={() => scrollToFigure(m.mid)} style={{ width: 44, height: 44, border: "1px solid " + NR.line, background: NR.field, color: NR.soft, cursor: "pointer", fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I.play /></button>)}
            </div>
            {/* proactive archive.org upload — move the story's media-store images
                onto archive.org now, so the publish boundary doesn't have to. */}
            {archiveStat && archiveStat.total > 0 && (() => {
              const running = !!(prearch && prearch.done != null && prearch.total != null);
              const r = prearch && prearch.result;
              const pending = archiveStat.pending;
              return (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed " + NR.line }}>
                  <div className="np-mono" style={{ fontSize: 10, color: pending ? NR.text : NR.muted, lineHeight: 1.5, marginBottom: 6 }}>
                    {pending
                      ? <span><b style={{ color: "var(--yellow)" }}>{pending}</b> of {archiveStat.total} image{archiveStat.total === 1 ? "" : "s"} still on the media store. Save them to archive.org now and publishing won't have to wait.</span>
                      : <span>✓ All {archiveStat.total} image{archiveStat.total === 1 ? "" : "s"} already on archive.org — publishing is instant.</span>}
                  </div>
                  {pending > 0 && (
                    <button onClick={prearchiveMedia} disabled={running} className="np-cond"
                      style={{ width: "100%", background: running ? NR.field : "var(--yellow)", border: "1px solid " + (running ? NR.line : "var(--yellow)"), color: running ? NR.soft : "var(--ink)", padding: "6px 10px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: running ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {running
                        ? <React.Fragment><span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> Saving {prearch.done}/{prearch.total}…</React.Fragment>
                        : <React.Fragment><I.archive style={{ fontSize: 13 }} /> Pre-archive to archive.org</React.Fragment>}
                    </button>
                  )}
                  {!running && r && (r.archived > 0 || r.failed > 0) && (
                    <div className="np-mono" style={{ fontSize: 10, color: r.failed ? "var(--reject)" : "var(--verified, #1f8a5b)", lineHeight: 1.5, marginTop: 6 }}>
                      {r.archived > 0 ? "Saved " + r.archived + " to archive.org. " : ""}
                      {r.failed > 0 ? r.failed + " couldn't be saved — " + ((r.failReasons && r.failReasons.join("; ")) || "they'll be retried at publish.") : ""}
                    </div>
                  )}
                  {!running && prearch && prearch.error && (
                    <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", lineHeight: 1.5, marginTop: 6 }}>{prearch.error}</div>
                  )}
                  {pending > 0 && !running && (
                    <div className="np-mono" style={{ fontSize: 9, color: NR.muted, lineHeight: 1.45, marginTop: 5 }}>Uploads the photo to archive.org publicly, now — the same move publish makes, done early.</div>
                  )}
                </div>
              );
            })()}
          </div>
          {/* tags + column */}
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Column</div>
            <select value={column} onChange={e => setColumn(e.target.value)} className="np-cond" style={{ width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, padding: "6px", fontSize: 13, marginBottom: 12 }}>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Tags</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {tags.map(t => <span key={t} className="np-mono" style={{ fontSize: 10.5, border: "1px solid " + NR.line, color: NR.text, padding: "2px 4px 2px 6px", display: "inline-flex", alignItems: "center", gap: 4 }}>#{t}<button onClick={() => setTags(l => l.filter(x => x !== t))} style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button></span>)}
              <input placeholder="+tag" onKeyDown={e => { if (e.key === "Enter") { const t = slugify(e.target.value); if (t) setTags(l => l.includes(t) ? l : [...l, t]); e.target.value = ""; } }} className="np-mono" style={{ width: 56, border: "1px dashed " + NR.line, background: "transparent", color: NR.text, padding: "3px 5px", fontSize: 11, outline: "none" }} />
            </div>
          </div>
          {/* definitions — the piece's glossary, opened as a panel. eoreader4
              suggests the terms (sized to the article); each draws from the
              collective set of published definitions across the site. */}
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span>Definitions{definitions.length ? " · " + definitions.length : ""}</span>
            </div>
            {definitions.length > 0 &&
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {definitions.slice(0, 8).map(d => <span key={d.id} title={d.def || "no definition yet"} className="np-mono" style={{ fontSize: 10.5, border: "1px solid " + NR.line, color: d.def ? NR.text : NR.muted, padding: "2px 6px" }}>{d.term}</span>)}
                {definitions.length > 8 && <span className="np-mono" style={{ fontSize: 10.5, color: NR.muted }}>+{definitions.length - 8}</span>}
              </div>}
            <button onClick={() => setView("definitions")}
              className="np-cond" style={{ width: "100%", textAlign: "left", border: "1px solid " + NR.line, background: view === "definitions" ? "var(--yellow)" : NR.field, color: view === "definitions" ? "var(--ink)" : NR.text, cursor: "pointer", fontSize: 12, padding: "6px 8px" }}>
              {definitions.length ? "Edit definitions →" : "Define key terms →"}
            </button>
            {definitions.length === 0 &&
              <div className="np-mono" style={{ fontSize: 10, color: NR.muted, lineHeight: 1.5, marginTop: 6 }}>eoreader4 suggests the names &amp; terms a reader may need defined — about one per 130 words.</div>}
          </div>
        </div>

        {/* editor — the draft renders as a bordered page on the canvas; the page
            (not the canvas) is the contentEditable, so the document border wraps
            banner, headline and body as one sheet */}
        {/* the editor stays MOUNTED even in the workspace views (display:none) so its
            DOM, ranges and autosave stay valid — the workspace mutates the same nodes */}
        <div className="np-scroll" ref={scroller} onMouseLeave={clearGrip} onDragOver={onBlockDragOver} onDrop={onBlockDrop} style={{ position: "relative", display: (view !== "prose") || (isMobile && mTab !== "write") ? "none" : "block", flex: isMobile ? 1 : undefined, overflowY: htmlMode ? "hidden" : "auto", padding: isMobile ? "14px 10px 40px" : "26px 32px 60px", background: NR.bg, borderRight: isMobile ? 0 : "1.5px solid " + NR.line, minHeight: 0 }}>
          {/* explicit Title + Subtitle fields — not loose prose in the canvas */}
          <div className="nr-fields" style={{ maxWidth: 800, margin: "0 auto 18px" }}>
            <label htmlFor="nr-title-field" className="np-eyebrow" style={{ display: "block", color: NR.muted, marginBottom: 3 }}>Title</label>
            <input id="nr-title-field" value={title} onChange={e => onTitleInput(e.target.value)} placeholder="Untitled headline" spellCheck={true}
              style={{ width: "100%", border: 0, borderBottom: "1px solid " + NR.line, background: "transparent", color: NR.text, fontFamily: "var(--display)", fontSize: isMobile ? 16 : 18, lineHeight: 1.15, padding: "2px 0 8px", outline: "none" }} />
            <label htmlFor="nr-dek-field" className="np-eyebrow" style={{ display: "block", color: NR.muted, margin: "14px 0 3px" }}>Subtitle</label>
            <input id="nr-dek-field" value={dek} onChange={e => onDekInput(e.target.value)} placeholder="One line under the headline" spellCheck={true}
              style={{ width: "100%", border: 0, borderBottom: "1px solid " + NR.line, background: "transparent", color: NR.soft, fontFamily: "var(--serif)", fontStyle: "italic", fontSize: isMobile ? 14 : 15, lineHeight: 1.35, padding: "2px 0 8px", outline: "none" }} />
          </div>
          <div className={"md-preview nr-page nr-fielded" + (armSrc ? " nr-arming" : "") + (citeHl ? "" : " nr-no-cites")} ref={ed} contentEditable suppressContentEditableWarning onInput={(e) => { recordComposition(e); scanHeadings(); destrandFootnotes(); healSplitBlocks(); renumberCites(); renumberFootnotes(); scheduleSave(); if (view === "graph" || structMode === "graph") scheduleGraphText(); }} onClick={onBodyClick}
            onKeyDown={onEditorKeyDown} onFocus={ensureParaSep}
            onMouseOver={onBodyOver} onMouseLeave={onBodyLeave} onMouseMove={onEdMouseMove}
            onPaste={onPaste} onDrop={onDropText}
            onDragStart={() => { dragFromSelf.current = true; }} onDragEnd={() => { dragFromSelf.current = false; }}
            style={{ color: NR.text, outline: "none", display: htmlMode ? "none" : undefined }}
            dangerouslySetInnerHTML={{ __html: START_DOC }} />
          {/* the Google-Docs grip + the live insertion line. Editing chrome only —
              they live OUTSIDE the contentEditable, so they never serialize. */}
          {!isMobile && grip && !htmlMode && (
            <div className="nr-grip-group"
              onMouseEnter={() => { if (gripRaf.current) { cancelAnimationFrame(gripRaf.current); gripRaf.current = 0; } setGripHover(true); }}
              onMouseLeave={() => setGripHover(false)}
              style={{ top: grip.top, left: grip.left, opacity: dragging ? 0 : undefined, pointerEvents: dragging ? "none" : "auto" }}>
              <div className={"nr-grip" + (dragging ? "" : " show")} draggable
                onDragStart={onGripDragStart} onDragEnd={endBlockDrag}
                title={grip.isHeading ? "Drag to move this whole section" : "Drag to move this block"}>⠿</div>
              {gripHover && !dragging && (
                <button type="button" className="nr-grip-del"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => deleteBlock(grip.block)}
                  title={blockDelLabel(grip.block)} aria-label={blockDelLabel(grip.block)}>
                  <I.trash style={{ fontSize: 13 }} />
                </button>
              )}
            </div>
          )}
          {/* void blocks (image / embed / widget) can't be reached by the caret
              to backspace, so float a click-to-delete × over their top-right
              corner. Editor chrome, OUTSIDE the editable, so it never serializes
              into the saved/published HTML. */}
          {!isMobile && grip && !dragging && !htmlMode && isVoidBlock(grip.block) && (
            <button type="button" className="nr-media-del"
              style={{ top: grip.top + 8, left: grip.right - 36 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteBlock(grip.block); }}
              title={blockDelLabel(grip.block)} aria-label={blockDelLabel(grip.block)}>
              <I.trash style={{ fontSize: 14 }} />
            </button>
          )}
          {!isMobile && dropAt && !htmlMode && (
            <div className="nr-drop-line" style={{ top: dropAt.top, left: dropAt.left, width: dropAt.width }} />
          )}
          {/* HTML source view — the general escape hatch for contentEditable cruft
              the toolbar can't reach. Fills the canvas (the editable is hidden but
              stays mounted so its DOM/autosave survive); Apply re-parses it and
              runs the same reconcile a restored draft does. */}
          {htmlMode && (
            <div style={{ position: "absolute", inset: 0, zIndex: 30, background: NR.bg, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: isMobile ? "10px 12px" : "12px 18px", borderBottom: "1px solid " + NR.line, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
                <div style={{ marginRight: "auto", minWidth: 0 }}>
                  <div className="np-eyebrow" style={{ color: NR.text }}>HTML source</div>
                  <div className="np-mono npj-hide-sm" style={{ fontSize: 10.5, color: NR.muted, marginTop: 2 }}>Unstick a block, retag a heading, clear broken markup — then Apply.</div>
                </div>
                {htmlMsg && <span className="np-mono" style={{ fontSize: 10.5, color: NR.ok }}>{htmlMsg}</span>}
                <button onMouseDown={(e) => e.preventDefault()} onClick={tidyHtmlSource} title="Auto-fix the usual cruft: bare wrapper spans, fragmented bold/italic runs, empty tags and blank paragraphs. Leaves citations, images and embeds untouched." className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><I.sparkle style={{ fontSize: 13 }} /> Tidy</button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={closeHtmlSource} title="Discard these edits and return to the editor" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.soft, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Cancel</button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={applyHtmlSource} title="Replace the document with this HTML, then re-link citations, re-upgrade images and renumber" className="np-cond" style={{ background: "var(--yellow)", border: "1.5px solid var(--ink)", color: "var(--ink)", padding: "6px 14px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><I.check style={{ fontSize: 13 }} /> Apply</button>
              </div>
              <textarea value={htmlDraft} onChange={(e) => setHtmlDraft(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off"
                className="np-mono" style={{ flex: 1, minHeight: 0, width: "100%", resize: "none", border: 0, outline: "none", background: NR.field, color: NR.text, padding: "16px 18px", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre", overflow: "auto" }} />
            </div>
          )}
        </div>
        {view !== "prose" && !(isMobile && mTab !== "write") && (
          <div style={{ flex: isMobile ? 1 : undefined, background: NR.bg, borderRight: isMobile ? 0 : "1.5px solid " + NR.line, minHeight: 0, overflow: "hidden" }}>
            {view === "graph"
              ? (window.GraphView
                  ? <window.GraphView text={graphText} onSelectSentence={jumpToProse} NR={NR} isMobile={isMobile} />
                  : null)
              : view === "definitions"
              ? (window.DefinitionsView
                  ? <window.DefinitionsView NR={NR} definitions={definitions} onChange={setDefinitions}
                      getBodyText={() => ed.current ? (ed.current.innerText || "") : ""}
                      slug={fileSlug || slugify(title)} isMobile={isMobile}
                      actor={(window.MatrixAuth && window.MatrixAuth.current && window.MatrixAuth.current()) ? window.MatrixAuth.current().user_id : null} />
                  : null)
              : <window.GroundingWorkspace api={tableApi} NR={NR} view={view} setView={setView} isMobile={isMobile} />}
          </div>
        )}

        {/* collaboration rail — end-to-end-encrypted comments + chat, private to
            this project's members. On desktop it TAKES OVER the right panel when
            comments are on (so sources hides); on mobile it's its own tab. */}
        {commentsOn && (!isMobile || mTab === "comments") && (
          <div style={{ display: isMobile ? (mTab === "comments" ? "flex" : "none") : "flex", flexDirection: "column", flex: isMobile ? 1 : undefined, minHeight: 0, overflow: "hidden", borderLeft: isMobile ? 0 : "1.5px solid " + NR.line }}>
            {window.CollabRail
              ? <window.CollabRail roomId={room && room.roomId} me={me} getEditorEl={() => ed.current} theme={NR} onClose={() => setCommentsOn(false)} />
              : <div className="np-mono" style={{ fontSize: 11, color: NR.muted, padding: 16 }}>Loading the encrypted collaboration layer…</div>}
          </div>
        )}

        {/* sources */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "sources" ? "block" : "none") : (commentsOn ? "none" : "block"), flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 16px 40px", background: NR.panel }}>
          <div className="np-eyebrow" style={{ color: NR.muted, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <I.source style={{ fontSize: 14 }} /> Sources · {sources.length}
            <span style={{ flex: 1 }} />
            {sources.some(s => nrIsFileSrc(window.NPJ.SOURCES[s.key])) && (
              <button onClick={() => setExplorer({ key: null })} title="Open the file explorer — read every uploaded source" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><I.folder style={{ fontSize: 12 }} /> Browse files</button>
            )}
          </div>
          {(() => { const nq = needsQuoteCount(); return nq ? (
            <div className="np-mono" style={{ fontSize: 10.5, color: NR.warn, lineHeight: 1.5, border: "1px solid " + NR.warn, padding: "8px 9px", marginBottom: 12 }}>
              ⚑ {nq} cited span{nq === 1 ? "" : "s"} still point at a whole page. Click the flagged span{nq === 1 ? "" : "s"} in the draft and pin the exact words in the source — the picker can help you find them.
            </div>
          ) : null; })()}
          <div style={{ border: "1px solid " + NR.line, padding: "10px", marginBottom: 14 }}>
            <div className="np-eyebrow" style={{ color: NR.soft, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}><I.plus style={{ fontSize: 13 }} /> Ingest a source</div>
            <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)} rows={2} placeholder="Paste one or more URLs…" className="np-mono" style={{ width: "100%", border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontSize: 12, padding: "8px", resize: "vertical", outline: "none" }} />
            <button onClick={addUrl} disabled={busy} className="np-cond" style={{ marginTop: 8, width: "100%", background: busy ? NR.field : "var(--yellow)", color: busy ? NR.muted : "var(--ink)", border: 0, padding: "8px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {busy ? <><Spinner /> Snapshotting…</> : <>Snapshot &amp; store</>}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 4px" }}>
              <span style={{ flex: 1, height: 1, background: NR.line }} /><span className="np-mono" style={{ fontSize: 9.5, color: NR.muted }}>or</span><span style={{ flex: 1, height: 1, background: NR.line }} />
            </div>
            <label className="np-cond" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", border: "1px solid " + NR.line, color: NR.text, padding: "8px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer" }}>
              <input type="file" multiple style={{ display: "none" }} onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
              <I.doc style={{ fontSize: 15 }} /> Upload documents
            </label>
            {/* a source that isn't a document or a link: a conversation with a
                person — named, or anonymous. Citable on what they said. */}
            {window.InterviewComposer && (
              <button onClick={() => setInterviewOpen(true)} className="np-cond" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", marginTop: 8, border: "1px solid " + NR.line, background: "transparent", color: NR.text, padding: "8px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer" }}>
                <I.chat style={{ fontSize: 15 }} /> Cite a conversation
              </button>
            )}
            <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 8, lineHeight: 1.5 }}>Sourcing is manual and two-sided: select the exact words in your draft, bind a source, then <b>pin the exact words IN the source</b> that back the claim. You can't cite a whole page. One source can back several spans.</div>
          </div>

          {sources.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6, padding: "0 2px" }}>No sources yet. Ingest a URL or upload a document, then highlight a claim and bind it.</div>}
          {sources.map(s => {
            const rec = window.NPJ.SOURCES[s.key] || { id: s.key, title: s.key, outlet: "" };
            const n = citeNum(s.key); const cnt = spanCount(s.key); void rev;
            const unpinned = ed.current ? Array.from(ed.current.querySelectorAll('.claim-src[data-src="' + s.key + '"]')).filter(el => !(el.getAttribute("data-quote") || "").trim()).length : 0;
            const reviewSt = piiGated(s.key) ? piiReviewState(s.key) : null;
            const iv = !!(window.NpjInterview && window.NpjInterview.isInterview(rec));
            return (
              <div key={s.key} style={{ border: "1px solid " + NR.line, padding: "9px 10px", marginBottom: 8, background: NR.field }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  {n > 0 && <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{n}</span>}
                  {iv ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.ok, display: "inline-flex", alignItems: "center", gap: 4 }} title="A conversation — cited on what the source said">● conversation</span>
                    : s.uploading ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn, display: "inline-flex", alignItems: "center", gap: 4 }}><Spinner /> storing file</span>
                    : s.snapshotting ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn, display: "inline-flex", alignItems: "center", gap: 4 }}><Spinner /> snapshotting</span>
                    : s.archived ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.ok }}>● archived</span>
                    : <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn }}>● snapshot only</span>}
                  {iv && <span className="np-mono" title={(rec.talk && rec.talk.anonymous) ? "Anonymous — identity is never stored in the draft" : "Named, cited source"} style={{ fontSize: 8.5, color: (rec.talk && rec.talk.anonymous) ? NR.warn : NR.soft, border: "1px solid " + ((rec.talk && rec.talk.anonymous) ? NR.warn : NR.line), padding: "0 5px", textTransform: "uppercase", letterSpacing: ".04em" }}>{(rec.talk && rec.talk.anonymous) ? "Anonymous" : "Named"}</span>}
                  {nrIsFileSrc(rec) && <span className="np-mono" title={rec.file_url ? "Stored on your account" : "In this browser only — sign-in stores it to your account"} style={{ fontSize: 8.5, color: NR.soft, border: "1px solid " + NR.line, padding: "0 5px", textTransform: "uppercase", letterSpacing: ".04em" }}>{window.NpjSourceView.kindLabel(rec)}{!rec.file_url && !s.uploading ? " · local" : ""}</span>}
                  {s.uploadErr && <span className="np-mono" title={s.uploadErr} style={{ fontSize: 8.5, color: NR.warn, border: "1px solid " + NR.warn, padding: "0 5px" }}>storage failed</span>}
                  {(reviewSt === "pending" || reviewSt === "unscanned") && <button onClick={() => setRedactTarget(s.key)} title="Review this for PII before it can be archived" className="np-mono" style={{ fontSize: 9, color: NR.warn, border: "1px solid " + NR.warn, background: "transparent", padding: "1px 5px", cursor: "pointer" }}>⚑ PII review</button>}
                  {reviewSt === "reviewed" && <span className="np-mono" style={{ fontSize: 9, color: NR.ok }} title="PII review done — cleared to archive">✓ PII reviewed</span>}
                  <span style={{ flex: 1 }} />
                  {cnt > 0 && <span className="np-mono" style={{ fontSize: 9.5, color: unpinned ? NR.warn : NR.soft }}>{cnt} span{cnt !== 1 ? "s" : ""}{unpinned ? " · " + unpinned + " ⚑" : ""}</span>}
                </div>
                {renameSrcKey === s.key ? (
                  <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <input autoFocus value={renameSrcText} onChange={e => setRenameSrcText(e.target.value)} onMouseDown={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitSrcRename(s.key); } else if (e.key === "Escape") { e.preventDefault(); setRenameSrcKey(null); setRenameSrcText(""); } }}
                      placeholder="Source title" className="np-cond"
                      style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: "1px solid " + NR.line, background: NR.bg, color: NR.text, fontSize: 13.5, padding: "3px 6px", outline: "none" }} />
                    <button onMouseDown={e => e.preventDefault()} onClick={() => commitSrcRename(s.key)} title="Save name" style={{ flex: "0 0 auto", background: "var(--yellow)", border: "1px solid var(--yellow)", color: "var(--ink)", fontWeight: 700, fontSize: 11, padding: "3px 7px", cursor: "pointer" }}>Save</button>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setRenameSrcKey(null); setRenameSrcText(""); }} title="Cancel" style={{ flex: "0 0 auto", background: "transparent", border: "1px solid " + NR.line, color: NR.soft, fontSize: 11, padding: "3px 7px", cursor: "pointer" }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.1, color: NR.text }}>{rec.title}</span>
                    <button onClick={() => { setRenameSrcKey(s.key); setRenameSrcText(rec.title || ""); }} title="Rename this source" style={{ flex: "0 0 auto", background: "transparent", border: 0, color: NR.muted, cursor: "pointer", fontSize: 12, padding: "0 1px", lineHeight: 1 }}>✎</button>
                  </div>
                )}
                <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 2 }}>{rec.outlet}</div>
                {/* a clickable preview of the file itself — the screenshot/scan/PDF you cited */}
                {(() => {
                  const k = window.NpjSourceView ? window.NpjSourceView.kindOf(rec) : "unknown";
                  if (k !== "image" && k !== "pdf") return null;
                  return (
                    <div style={{ marginTop: 8 }}>
                      <NrSourceThumb srcKey={s.key} rec={rec} onOpen={() => setExplorer({ key: s.key })} />
                      {s.ocr
                        ? <div className="np-mono" style={{ fontSize: 9, color: NR.warn, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5 }}><Spinner /> reading the text in this image…</div>
                        : (k === "image" && String(rec.text || "").trim()
                          ? <div className="np-mono" style={{ fontSize: 9, color: NR.ok, marginTop: 4 }}>✓ text recognized — cite it below</div>
                          : null)}
                    </div>
                  );
                })()}
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <button onMouseDown={e => e.preventDefault()} onClick={() => bindSource(s.key)} disabled={s.snapshotting}
                    title="Select the words this source backs, then click — or click first and grab the words next"
                    className="np-cond" style={{ flex: 1, background: armSrc === s.key ? "var(--yellow)" : "transparent", border: "1px solid " + (armSrc === s.key ? "var(--yellow)" : NR.line), color: armSrc === s.key ? "var(--ink)" : NR.text, padding: "4px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>{armSrc === s.key ? "Grab the words…" : "Cite span"}</button>
                  {nrIsFileSrc(rec) && <button onClick={() => setExplorer({ key: s.key })} title="Open and read this file" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><I.eye style={{ fontSize: 12 }} /> View</button>}
                  {!iv && !s.archived && !s.snapshotting && <button onClick={() => tryArchive(s)} title={needsPiiReview(s.key) ? "Review this for PII first, then archive" : "Archive this source to archive.org"} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.warn, color: NR.warn, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>{needsPiiReview(s.key) ? "Review & archive" : "Archive"}</button>}
                  {confirmDelKey === s.key
                    ? <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                        <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn }}>delete?</span>
                        <button onClick={() => { tableApi.deleteSource(s.key); setConfirmDelKey(null); }} title="Delete this source and unbind its claims" className="np-cond" style={{ background: NR.warn, border: "1px solid " + NR.warn, color: "var(--paper)", padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700, cursor: "pointer" }}>Yes</button>
                        <button onClick={() => setConfirmDelKey(null)} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.soft, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>No</button>
                      </span>
                    : <button onClick={() => setConfirmDelKey(s.key)} title="Delete this source — unbinds every claim that cites it (the words stay in the prose)" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.soft, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><I.trash style={{ fontSize: 12 }} /> Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* the hover-to-remove × — floats by the cited span the pointer is over, so
          dropping a citation is one click in the prose (no popover). Rendered
          OUTSIDE the contenteditable, so it never lands in the saved/published HTML. */}
      {citeHl && citeHover && (() => {
        const span = ed.current && ed.current.querySelector('.claim-src[data-cid="' + citeHover.cid + '"]');
        if (!span || !spanIsCite(span)) return null;
        return (
          <button key="cite-x" onMouseDown={e => e.preventDefault()}
            onMouseEnter={() => { if (citeHideT.current) { clearTimeout(citeHideT.current); citeHideT.current = null; } }}
            onMouseLeave={onBodyLeave}
            onClick={() => removeCitation(span)}
            title="Remove this citation — the words stay, the source binding is dropped"
            className="np-mono" style={{ position: "fixed", left: citeHover.x + 3, top: citeHover.y - 8.5, zIndex: 4500, width: 17, height: 17, padding: 0, lineHeight: "15px", textAlign: "center", borderRadius: "50%", border: "1px solid var(--ink)", background: NR.warn, color: "var(--paper)", fontSize: 12, cursor: "pointer", boxShadow: "0 1px 5px rgba(0,0,0,.4)" }}>×</button>
        );
      })()}

      {/* selection toolbar */}
      {sel && (
        <div className="sel-tb" style={{ position: "fixed", left: sel.x, top: sel.y - 8, transform: "translate(-50%,-100%)", zIndex: 4200, background: "var(--ink)", border: "1px solid rgba(255,255,255,.22)", boxShadow: "0 10px 28px rgba(0,0,0,.55)", display: "flex", alignItems: "center", padding: 3 }}>
          <FB onClick={() => exec("bold")} title="Bold"><b>B</b></FB>
          <FB onClick={() => exec("italic")} title="Italic"><i>I</i></FB>
          <FB onClick={() => exec("formatBlock", "<h2>")} title="Heading">H2</FB>
          <FB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote"><I.quote style={{ fontSize: 13 }} /></FB>
          <span style={{ width: 1, height: 18, background: "rgba(255,255,255,.2)", margin: "0 3px" }} />
          <FB hot={menu === "link"} onClick={() => setMenu(menu === "link" ? null : "link")} title="Add a link or jump-link"><I.link style={{ fontSize: 13 }} /> Link</FB>
          {/* citation actions only when the citation layer is on — in a clean read the
             toolbar stays a plain format bar (no Source/Void) to match the hidden layer */}
          {citeHl && <React.Fragment>
            <FB hot={menu === "src"} onClick={() => setMenu(menu === "src" ? null : "src")} title="Bind a source to this span — the claim stands on it"><I.source style={{ fontSize: 13 }} /> Source</FB>
            <FB hot={menu === "void"} onClick={() => setMenu(menu === "void" ? null : "void")} title="Cite a void — ground this in a documented absence (no record exists)"><span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>∅</span> Void</FB>
          </React.Fragment>}

          {menu === "link" && (
            <div className="np-scroll" style={{ position: "absolute", right: 0, width: 280, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 9, ...tbMenuBox(sel.y, 360) }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Link to a URL</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && applyLink()} placeholder="https://…" className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
                <button className="btn btn-sm btn-primary" onClick={applyLink}>Add</button>
              </div>
              {toc.length > 0 && <React.Fragment>
                <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "10px 0 5px", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>or jump to a section</div>
                {toc.map(h => <button key={h.id} onMouseDown={e => e.preventDefault()} onClick={() => insertJump(h.id, h.text)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--rule)", padding: "6px 2px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{h.text}</button>)}
              </React.Fragment>}
            </div>
          )}
          {menu === "src" && (
            <div style={{ position: "absolute", right: 0, width: 332, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 8, ...tbMenuBox(sel.y, 440) }} className="np-scroll">
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}><I.source style={{ fontSize: 13 }} /> Bind this span to a source</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "0 8px", marginBottom: 8 }}>
                <I.search style={{ fontSize: 14, color: "var(--ink-soft)" }} />
                <input autoFocus value={srcQuery} onChange={e => setSrcQuery(e.target.value)} onMouseDown={e => e.stopPropagation()} placeholder="Search sources…" style={{ flex: 1, border: 0, background: "transparent", padding: "7px 0", fontFamily: "var(--serif)", fontSize: 13, outline: "none" }} />
              </div>
              {sources.filter(s => { const r = window.NPJ.SOURCES[s.key] || {}; const q = srcQuery.trim().toLowerCase(); return !q || ((r.title || "") + " " + (r.outlet || "") + " " + (r.id || s.key)).toLowerCase().includes(q); }).map(s => {
                const rec = window.NPJ.SOURCES[s.key] || { title: s.key, outlet: "" };
                const n = citeNum(s.key);
                const SVm = window.NpjSourceView;
                const open = srcPreview === s.key;
                const thumbUrl = (SVm && SVm.kindOf(rec) === "image") ? (SVm.blobUrl(SVm.recKey(rec) || s.key) || rec.file_url || rec.archive_url || rec.original_url || "") : "";
                return (
                <div key={s.key} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", padding: "7px 2px" }}>
                    {n > 0 && <span className="claim-marker" style={{ flex: "0 0 auto", verticalAlign: "baseline" }}>{n}</span>}
                    {thumbUrl && <NrMediaImg url={thumbUrl} alt="" style={{ flex: "0 0 auto", width: 34, height: 34, objectFit: "cover", border: "1px solid var(--rule)" }} />}
                    <button onMouseDown={e => e.preventDefault()} onClick={() => bindSource(s.key)} title="Bind this span to this source" style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: 0, padding: 0, cursor: "pointer" }}>
                      <span style={{ display: "block", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.title}</span>
                      <span className="np-mono" style={{ display: "block", fontSize: 9.5, color: "var(--ink-soft)" }}>{rec.outlet} {rec.type === "interview" ? "" : (s.archived ? "· archived" : "· snapshot")}{n > 0 ? " · +span" : ""}</span>
                    </button>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => setSrcPreview(p => p === s.key ? null : s.key)} title={open ? "Hide preview" : "Preview this source"} className="np-mono" style={{ flex: "0 0 auto", background: open ? "var(--ink)" : "transparent", color: open ? "var(--paper)" : "var(--ink-soft)", border: "1px solid " + (open ? "var(--ink)" : "var(--rule)"), padding: "3px 7px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, lineHeight: 1.4 }}>
                      <I.eye style={{ fontSize: 12 }} /> {open ? "Hide" : "Preview"}
                    </button>
                  </div>
                  {open && (
                    <div onMouseDown={e => e.stopPropagation()} style={{ padding: "0 2px 10px" }}>
                      {window.SourceViewer
                        ? <window.SourceViewer key={s.key} srcKey={s.key} rec={rec} height={230} />
                        : <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)" }}>Preview unavailable.</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center" }}>
                        {window.SourceExplorer && <button onMouseDown={e => e.preventDefault()} onClick={() => setExplorer({ key: s.key, all: true, cite: true })} title="Open this source full-screen — read it and cite from there" className="np-mono" style={{ background: "transparent", border: "1px solid var(--rule)", color: "var(--data)", padding: "3px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10 }}><I.expand style={{ fontSize: 12 }} /> Open full preview</button>}
                        <button onMouseDown={e => e.preventDefault()} onClick={() => bindSource(s.key)} title="Bind this span to this source" className="np-mono" style={{ background: "var(--yellow)", border: "1px solid var(--ink)", color: "var(--ink)", fontWeight: 700, padding: "3px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10 }}><I.source style={{ fontSize: 12 }} /> Cite this</button>
                      </div>
                    </div>
                  )}
                </div>); })}
              {sources.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", padding: "4px 2px 6px", lineHeight: 1.5 }}>No sources yet — make one below, or stand behind the claim yourself.</div>}

              {/* —— mint a NEW source and bind this span to it (URL · file · interview) —— */}
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "10px 0 5px", borderTop: "1px solid var(--rule)", paddingTop: 8, display: "flex", alignItems: "center", gap: 5 }}><I.plus style={{ fontSize: 12 }} /> New source</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={srcUrl} onChange={e => setSrcUrl(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && bindNewUrl()} placeholder="Paste a URL…" className="np-mono" style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
                <button onMouseDown={e => e.preventDefault()} onClick={bindNewUrl} title="Snapshot this URL and bind the span to it" className="np-mono" style={{ flex: "0 0 auto", background: "var(--yellow)", border: "1.5px solid var(--ink)", color: "var(--ink)", fontWeight: 700, padding: "0 11px", cursor: "pointer", fontSize: 11 }}>Add</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onMouseDown={e => e.preventDefault()} onClick={() => popoverFileRef.current && popoverFileRef.current.click()} title="Upload a PDF, image or document and bind this span to it" className="np-mono" style={{ flex: 1, background: "transparent", border: "1px solid var(--ink)", color: "var(--ink)", padding: "6px 9px", cursor: "pointer", fontSize: 10.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}><I.folder style={{ fontSize: 13 }} /> Upload file</button>
                {window.InterviewComposer && <button onMouseDown={e => e.preventDefault()} onClick={() => { bindAfterInterview.current = true; setMenu(null); setInterviewOpen(true); }} title="Log an interview (your own reporting) and bind this span to it" className="np-mono" style={{ flex: 1, background: "transparent", border: "1px solid var(--ink)", color: "var(--ink)", padding: "6px 9px", cursor: "pointer", fontSize: 10.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}><I.mic style={{ fontSize: 13 }} /> Interview</button>}
              </div>
              <input ref={popoverFileRef} type="file" multiple style={{ display: "none" }} onChange={e => { bindNewUpload(e.target.files); e.target.value = ""; }} />

              {/* —— or don't cite at all: OWN the claim, honestly labelled (self-assert) —— */}
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "10px 0 4px", borderTop: "1px solid var(--rule)", paddingTop: 8, display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>⊢</span> Or stand behind it yourself</div>
              <div className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 6 }}>No source — you own the claim, honestly labelled. It publishes as prose.</div>
              <div style={{ display: "flex", gap: 5 }}>
                {OWN_STANCES.map(([v, glyph, label, blurb]) => (
                  <button key={v} onMouseDown={e => e.preventDefault()} onClick={() => markOwn(v)} title={blurb}
                    style={{ flex: 1, border: "1.5px solid var(--rule)", background: "transparent", color: "var(--ink)", padding: "6px 4px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{glyph}</span>
                    <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {menu === "void" && (() => {
            const VK = window.NpjVoidKinds; if (!VK) return null;
            const k = VK.norm(voidKind); const def = k ? VK.get(k) : null;
            const ready = !!voidSearch.trim() || k === "ambient";
            return (
            <div style={{ position: "absolute", right: 0, width: 322, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 10, ...tbMenuBox(sel.y, 392) }} className="np-scroll">
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>∅</span> Cite a void — which kind?</div>
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 8 }}>The claim rests on something that <b style={{ color: "var(--ink)" }}>isn’t there</b>. Pick how hard the absence is to stand behind — the reader sees which.</div>
              {VK.GROUPS.map(g => (
                <div key={g.key} style={{ marginBottom: 7 }}>
                  <div className="np-mono" style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--ink-soft)", marginBottom: 3 }}>{g.verb} <span style={{ opacity: .7, textTransform: "none", letterSpacing: 0 }}>· {g.gloss}</span></div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {VK.kindsIn(g.key).map(kk => { const on = k === kk; const d = VK.get(kk); return (
                      <button key={kk} onMouseDown={e => e.preventDefault()} onClick={() => setVoidKind(kk)} title={d.blurb}
                        style={{ border: "1.5px solid " + (on ? "var(--ink)" : "var(--rule)"), background: on ? "var(--yellow)" : "transparent", color: "var(--ink)", padding: "4px 9px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{d.glyph}</span> {d.label}</button>
                    ); })}
                  </div>
                </div>
              ))}
              {def && (
                <React.Fragment>
                  <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.55, margin: "8px 0 6px", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>{def.blurb}</div>
                  <textarea autoFocus value={voidSearch} onChange={e => setVoidSearch(e.target.value)} onMouseDown={e => e.stopPropagation()}
                    placeholder={def.prompt}
                    style={{ width: "100%", boxSizing: "border-box", minHeight: 62, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12.5, lineHeight: 1.5, outline: "none", resize: "vertical", fontFamily: "var(--serif)" }} />
                  {k === "ambient" && <div className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", marginTop: 4 }}>Ambient is context, not a finding — optional, and it reads as the faintest void.</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
                    <button className="btn btn-sm btn-ghost" onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); setVoidKind(""); }}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onMouseDown={e => e.preventDefault()} disabled={!ready} onClick={() => markVoid(k, voidSearch)} style={{ opacity: ready ? 1 : .55 }}>{def.glyph} Cite this void</button>
                  </div>
                </React.Fragment>
              )}
            </div>
            );
          })()}
        </div>
      )}

      {/* armed: a source is waiting for you to grab the words it backs */}
      {armSrc && (
        <div className="fade-in" style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 4300, maxWidth: "92vw", background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--yellow)", boxShadow: "0 12px 30px rgba(0,0,0,.5)", display: "flex", alignItems: "center", gap: 12, padding: "9px 12px 9px 15px" }}>
          <span className="np-mono" style={{ fontSize: 11.5, color: "var(--yellow)", flex: "0 0 auto" }}><I.source style={{ fontSize: 13, verticalAlign: "-2px" }} /> Citing</span>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(window.NPJ.SOURCES[armSrc] || {}).title || armSrc}</span>
          <span className="np-mono npj-hide-sm" style={{ fontSize: 11, opacity: .82, flex: "0 0 auto" }}>— select the exact words it backs</span>
          <button onClick={() => setArmSrc(null)} className="np-cond" style={{ flex: "0 0 auto", background: "transparent", color: "var(--paper)", border: "1px solid rgba(255,255,255,.3)", padding: "4px 10px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Cancel</button>
        </div>
      )}

      {/* pin the source-span: the exact words IN the source that back the claim.
          A page is not a citation — this is what makes it one. */}
      {pinTarget && (() => {
        const rec = window.NPJ.SOURCES[pinTarget.key] || {};
        const ready = !!String(pinQuote || "").trim();
        const span = ed.current && ed.current.querySelector('.claim-src[data-cid="' + pinTarget.cid + '"]');
        const spanKeys = span ? (span.getAttribute("data-src") || "").split(/\s+/).filter(Boolean) : [];
        const onSpan = spanKeys.indexOf(pinTarget.key) < 0 ? [pinTarget.key, ...spanKeys] : spanKeys;   // include the one being added
        const others = sources.filter(s => s.key !== pinTarget.key && onSpan.indexOf(s.key) < 0);
        const clipT = (s) => { s = String(s || ""); return s.length > 22 ? s.slice(0, 21) + "…" : s; };
        const srcName = (k) => { const r = window.NPJ.SOURCES[k] || {}; return r.title || k; };
        return (
        <div className="fade-in" style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 4400, width: 560, maxWidth: "94vw", background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--yellow)", boxShadow: "0 16px 40px rgba(0,0,0,.55)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="np-mono" style={{ fontSize: 11, color: "var(--yellow)", flex: "0 0 auto" }}><I.source style={{ fontSize: 13, verticalAlign: "-2px" }} /> Pin the source-span</span>
            <span className="np-mono" style={{ fontSize: 10.5, opacity: .7, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.title || pinTarget.key}{rec.outlet ? " · " + rec.outlet : ""}</span>
            <button onClick={closePin} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 15, cursor: "pointer", lineHeight: 1 }}><I.x /></button>
          </div>
          {pinTarget.claimText && (
            <div style={{ fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.4, color: "rgba(255,255,255,.78)", borderLeft: "2px solid var(--yellow)", paddingLeft: 8, marginBottom: 9 }}>
              <span className="np-mono" style={{ fontSize: 9.5, color: "var(--yellow)", display: "block", marginBottom: 2 }}>YOUR CLAIM</span>
              “{pinTarget.claimText.length > 180 ? pinTarget.claimText.slice(0, 180) + "…" : pinTarget.claimText}”
            </div>
          )}
          {/* every source on this span — one claim can rest on several. Click to edit
              that one's pinned words; × drops it. The right-hand picker adds more. */}
          {onSpan.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 9 }}>
              <span className="np-mono" style={{ fontSize: 9, color: "rgba(255,255,255,.5)", letterSpacing: ".08em" }}>ON THIS SPAN</span>
              {onSpan.map(k => {
                const cur = k === pinTarget.key;
                return (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, border: "1px solid " + (cur ? "var(--yellow)" : "rgba(255,255,255,.28)"), background: cur ? "rgba(255,236,1,.14)" : "transparent" }}>
                    <button onClick={() => { if (!cur) openPin(pinTarget.cid, k, pinTarget.claimText); }} title={cur ? "Editing this source's pinned words" : "Edit this source's pinned words"}
                      style={{ background: "none", border: 0, color: "var(--paper)", cursor: cur ? "default" : "pointer", fontFamily: "var(--cond)", fontSize: 12, padding: "2px 4px 2px 9px" }}>{clipT(srcName(k))}</button>
                    <button onClick={() => removeSrcFromSpan(span, k)} title="Remove this source from the span"
                      style={{ background: "none", border: 0, color: "rgba(255,255,255,.6)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 6px 0 3px" }}>×</button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="np-mono" style={{ fontSize: 10, color: "rgba(255,255,255,.6)", marginBottom: 5 }}>Highlight the exact words in the source below to mint the citation — or type/paste them here.</div>
          <textarea value={pinQuote} onChange={e => { setPinQuote(e.target.value); pinLoc.current = null; }} placeholder="The supporting words, quoted verbatim from the source…"
            style={{ width: "100%", minHeight: 52, resize: "vertical", border: "1px solid rgba(255,255,255,.3)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, padding: "8px 9px", outline: "none", boxSizing: "border-box" }} />
          {/* render the source and select-to-cite (+ Citey's smarter ranking) */}
          {window.SourcePicker && (
            <window.SourcePicker srcKey={pinTarget.key} claimText={pinTarget.claimText}
              onPick={(quote, loc) => { setPinQuote(quote); pinLoc.current = loc || null; }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
            {span && <button onClick={() => { removeCitation(span); closePin(); }} title="Remove this citation entirely — keep the words, drop the source binding"
              className="np-cond" style={{ flex: "0 0 auto", background: "transparent", color: NR.warn, border: "1px solid " + NR.warn, padding: "6px 11px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Remove citation</button>}
            {others.length > 0 && (
              <select value="" onChange={e => { const k = e.target.value; if (k) openPin(pinTarget.cid, k, pinTarget.claimText); }}
                title="Add another source to this same span — one claim can rest on several"
                className="np-cond" style={{ flex: "0 0 auto", maxWidth: 190, background: "var(--paper)", color: "var(--ink)", border: "1px solid rgba(255,255,255,.3)", fontSize: 12, padding: "6px 7px", cursor: "pointer" }}>
                <option value="">+ add a source…</option>
                {others.map(s => <option key={s.key} value={s.key}>{clipT(srcName(s.key))}</option>)}
              </select>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={closePin} className="np-cond" style={{ flex: "0 0 auto", background: "transparent", color: "var(--paper)", border: "1px solid rgba(255,255,255,.3)", padding: "6px 11px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Later</button>
            <button onClick={() => savePin(pinLoc.current)} disabled={!ready} className="np-cond" style={{ flex: "0 0 auto", background: ready ? "var(--paper)" : "rgba(255,255,255,.15)", color: ready ? "var(--ink)" : "rgba(255,255,255,.5)", border: "1px solid " + (ready ? "var(--paper)" : "rgba(255,255,255,.2)"), padding: "6px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: ready ? "pointer" : "default" }}>Pin span</button>
          </div>
        </div>
      ); })()}

      {/* the media viewer — images full-size, with caption, count and jump-to-figure */}
      {viewer != null && mediaImages[viewer] && (
        <div className="fade-in" onClick={() => setViewer(null)} style={{ position: "fixed", inset: 0, zIndex: 5600, background: "rgba(8,7,5,.93)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 26 }}>
          <NrMediaImg url={mediaImages[viewer].url} alt={mediaImages[viewer].caption || ""} onClick={e => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "76vh", objectFit: "contain", border: "1.5px solid rgba(255,255,255,.25)", background: "#000" }} />
          <div className="np-mono" onClick={e => e.stopPropagation()} style={{ color: "#cfc8b6", fontSize: 11.5, marginTop: 12, maxWidth: 720, textAlign: "center", lineHeight: 1.5 }}>
            {mediaImages[viewer].caption || "untitled image"} · {viewer + 1} / {mediaImages.length}
          </div>
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {[["← Prev", () => setViewer(v => Math.max(0, v - 1)), viewer === 0],
              ["Show in document", () => { scrollToFigure(mediaImages[viewer].mid); setViewer(null); }, false],
              ["Next →", () => setViewer(v => Math.min(mediaImages.length - 1, v + 1)), viewer === mediaImages.length - 1],
              ["Close · esc", () => setViewer(null), false]].map(([label, fn, off]) => (
              <button key={label} onClick={fn} disabled={off} className="np-cond" style={{ background: "transparent", color: off ? "rgba(216,211,196,.35)" : "#e3ddcc", border: "1px solid rgba(255,255,255,.25)", padding: "7px 13px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", cursor: off ? "default" : "pointer" }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {explorer && window.SourceExplorer && (() => {
        // opened from the bind menu (all+cite) → show EVERY source so any of them
        // can be previewed and cited from one place; otherwise the file explorer
        // keeps its uploaded-files-only scope.
        const all = !!explorer.all;
        const base = all ? sources : sources.filter(s => nrIsFileSrc(window.NPJ.SOURCES[s.key]));
        return (
        <window.SourceExplorer
          title={all ? "Preview sources — this article" : "Source files — this article"}
          initialKey={explorer.key}
          items={base.map(s => ({ key: s.key, rec: window.NPJ.SOURCES[s.key] || {} }))}
          srcApi={tableApi}
          onRename={(key, t) => tableApi.renameSource(key, t)}
          onCite={explorer.cite ? (key => { setExplorer(null); bindSource(key); }) : undefined}
          onClose={() => { setExplorer(null); setSources(x => [...x]); }} />
        );
      })()}
      {showVersions && <window.VersionHistory versions={versions} onClose={() => setShowVersions(false)} />}
      {redactTarget && window.CiteyRedactModal && <window.CiteyRedactModal srcKey={redactTarget}
        onClose={() => { redactNext.current = null; setRedactTarget(null); setSources(s => [...s]); }}
        onDone={() => { const s = redactNext.current; redactNext.current = null; setRedactTarget(null); setSources(x => [...x]); if (s && !needsPiiReview(s.key)) setArchiveTarget(s); }} />}
      {archiveTarget && <ArchiveModal srcKey={archiveTarget.key} items={[{ name: (window.NPJ.SOURCES[archiveTarget.key] || {}).title || archiveTarget.key }]} onClose={() => setArchiveTarget(null)} onDone={() => { onArchived(archiveTarget.key); setArchiveTarget(null); }} />}
      {interviewOpen && window.InterviewComposer && <window.InterviewComposer reporter={(session && session.user_id) || me || ""} onSave={addInterview} onClose={() => { setInterviewOpen(false); bindAfterInterview.current = false; }} />}
      {publish && <PublishOverlay publish={publish} setPublish={setPublish} onClose={() => setPublish(null)} onPublished={onPublished} sources={sources} title={title} session={session}
        customSlug={fileSlug} onSlug={setFileSlug}
        getContent={() => ({ html: ed.current ? ed.current.innerHTML : "", title, tags, column, definitions, sources })} />}
      {previewDoc && window.ArticleRead && (
        <window.ArticleRead preview previewArticle={previewDoc} onClose={() => setPreviewDoc(null)} onRefresh={openPreview} me={session && session.user_id} />
      )}
    </div>
  );
}

/* server-recovered projects — solves "switched browser, can't find my work".
   A project = one shared Matrix room that can hold many documents; its invitees
   are shared by every document attached to it. */
function ProjectsMenu({ rooms, onClose, signedIn }) {
  const projects = (() => {
    if (!rooms || rooms.loading) return [];
    const seen = {}; const out = [];
    (rooms.drafts || []).forEach(d => { if (!seen[d.roomId]) { seen[d.roomId] = 1; out.push({ roomId: d.roomId, title: d.title, topic: "" }); } });
    (rooms.joined || []).forEach(r => { if (r.kind !== "control" && !seen[r.roomId]) { seen[r.roomId] = 1; out.push({ roomId: r.roomId, title: r.name, topic: r.topic || "" }); } });
    return out;
  })();
  return (
    <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxWidth: "calc(100vw - 24px)", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(0,0,0,.3)", padding: 12, zIndex: 30, maxHeight: 360, overflowY: "auto" }} className="np-scroll">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 5 }}><I.folder style={{ fontSize: 13 }} /> Your projects · from Matrix</span>
        <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 14 }}><I.x /></button>
      </div>
      <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 10, lineHeight: 1.5 }}>A project holds any number of documents and shares one set of invitees. Recovered straight from the homeserver — not this browser — so wipe or switch devices and they're still here after you sign in.</div>
      {!signedIn && <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)" }}>Sign in with Matrix to see your projects.</div>}
      {signedIn && (!rooms || rooms.loading) && <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", display: "inline-flex", gap: 6, alignItems: "center" }}><Spinner /> loading from server…</div>}
      {signedIn && rooms && !rooms.loading && (
        <React.Fragment>
          {projects.map(p => (
            <div key={p.roomId} style={{ borderBottom: "1px solid var(--rule)", padding: "6px 2px" }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 12, flex: "0 0 auto", color: "var(--ink-soft)" }} /> {p.title}</div>
              {p.topic && <div style={{ fontFamily: "var(--serif)", fontSize: 11.5, color: "var(--ink-soft)" }}>{p.topic}</div>}
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{p.roomId}</div>
            </div>
          ))}
          {projects.length === 0 && <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)" }}>No projects yet. Invite a collaborator and a project is created for this document.</div>}
          {rooms.error && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 6 }}>{rooms.error}</div>}
        </React.Fragment>
      )}
    </div>
  );
}

function Spinner() { return <span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px" }} />; }

/* The publish boundary is real: nothing fires until the author confirms, every
   step reports what actually happened, and a failed step stops the run — no
   checkmark is ever painted on something that didn't succeed. */
function PublishOverlay({ publish, setPublish, onClose, onPublished, sources, title, session, getContent, customSlug, onSlug }) {
  // the filename is the author's call — it follows the headline until they
  // rename it at the gate, and a custom name sticks with the draft
  const auto = slugify(title) || "untitled";
  const [slugVal, setSlugVal] = useState(customSlug || auto);
  const slug = slugify(slugVal) || "untitled";
  const articleUrl = window.npjArticleUrl(slug);
  const editSlug = (v) => { setSlugVal(v); if (onSlug) { const s = slugify(v); onSlug(!s || s === auto ? "" : s); } };

  // Already in the committed record? Then this gate is a REPUBLISH, not a first
  // publish — the copy + step labels + confirm button adapt so it never claims
  // "nothing has been published yet" about a piece that's already live. Reactive
  // to the slug field, so renaming the doc to an existing slug flips the gate.
  const liveMeta = (window.NpjArticles && window.NpjArticles.publishedMeta) ? window.NpjArticles.publishedMeta(slug) : null;
  const isRepublish = !!liveMeta;
  const liveUnpublished = isRepublish && liveMeta.status === "unpublished";

  // ---- byline: who the piece is credited to (outward-facing) ----
  // You type the name readers see (defaults to your own); your account id is what
  // gets stored on the record. Editors are an optional separate "Edited by"
  // credit. "Publish unsigned" ships with no author.
  const meMx = (session && session.user_id) || ((window.MatrixAuth.current() || {}).user_id) || "";
  const parseMx = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(x => /^@[^:]+:[^:]+$/.test(x));
  const nameOfMx = (m) => (window.npjPerson ? window.npjPerson(m).name : String(m).replace(/^@/, "").split(":")[0]);
  const [unsigned, setUnsigned] = useState(false);
  // Byline is a plain name now — type how you want to be credited. It defaults
  // to your profile display name. Whatever name you show, your Matrix id (meMx)
  // is recorded as the author on the committed record, so attribution survives.
  const defaultName = meMx ? nameOfMx(meMx) : "";
  const [nameInput, setNameInput] = useState(defaultName);
  const [editorsInput, setEditorsInput] = useState("");
  const bylineEditors = parseMx(editorsInput);
  // the userid stored on the backend record — you, the signed-in publisher
  const bylineAuthors = meMx ? [meMx] : [];
  // Publishing under your own name keeps the rich contributor chip (the byline
  // resolves from your id); a free-text override is stored only when you type a
  // name different from your own — either way the userid above is what's saved.
  const typedName = nameInput.trim();
  const bylineOverride = typedName && typedName !== defaultName ? typedName : "";

  // preflight — measured from the actual draft, shown to the author at the gate
  const flight = useMemo(() => {
    const c = (getContent ? getContent() : null) || { html: "", title };
    const root = document.createElement("div"); root.innerHTML = c.html || "";
    const dekEl = root.querySelector(".nr-dek");
    const dek = dekEl ? (dekEl.textContent || "").trim() : "";
    const text = (root.innerText || "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    const cites = Array.from(root.querySelectorAll("sup.md-cite[data-cite]")).filter(n => !n.hasAttribute("data-fn"));
    const missing = [];
    const usedKeys = [];   // the source keys the piece actually CITES, in first-seen order
    let unpinned = 0;
    cites.forEach(n => {
      const k = n.getAttribute("data-cite");
      if (k && usedKeys.indexOf(k) < 0) usedKeys.push(k);
      const rec = window.NPJ.SOURCES[k];
      if ((!rec || !(rec.archive_url || rec.original_url)) && missing.indexOf(k) < 0) missing.push(k);
      // every bound span must point at the exact words in the source, not just
      // the page — a span with no pinned quote fails the build
      if (!(n.getAttribute("data-quote") || "").trim()) unpinned++;
    });
    // Only CITED sources ride in the committed record and get archived to
    // archive.org — an uploaded-but-unused source is never pushed (it stays
    // private). Mirrors genesisFromContent's usedKeys, so the gate's "X of Y
    // archived" counts exactly the sources that actually ship.
    const usedSources = (sources || []).filter(s => usedKeys.indexOf(s.key) >= 0);
    const archived = usedSources.filter(s => s.archived || ((window.NPJ.SOURCES[s.key] || {}).archive_url)).length;
    // images still on the media store get moved onto archive.org at publish
    const onStore = Array.from(root.querySelectorAll("figure image-slot")).filter(slot => {
      const s = slot.getAttribute("src");
      return s && window.NpjMedia && window.NpjMedia.isStoreUrl(s);
    }).length;
    return { content: c, dek, words, spans: cites.length, missing, unpinned, usedKeys, srcTotal: usedSources.length, archived, mediaToFreeze: onStore };
  }, []);

  const [phase, setPhase] = useState("confirm");          // confirm | run
  const [outcome, setOutcome] = useState(null);           // null | {ok:true} | {ok:false,msg}
  const [steps, setSteps] = useState(() => ([
    { code: "EVA", label: isRepublish ? "Pull the updated piece" : "Pull the finished piece", detail: isRepublish ? "draft → EO event (INS — a new version; the fold restarts from it)" : "draft → EO event (INS — the genesis line)", state: "wait" },
    { code: "SEG", label: "Build: resolve & pin every bound span", detail: flight.spans + " bound span" + (flight.spans === 1 ? "" : "s") + " to check", state: "wait" },
    { code: "INS", label: "Sources archived on archive.org", detail: flight.srcTotal ? flight.archived + " of " + flight.srcTotal + " archived" : "no sources bound", state: "wait", sources: true },
    { code: "DEF", label: "Commit the EO event log to GitHub", detail: "→ clovenbradshaw-ctrl/npj · articles/" + slug + "/", state: "wait" },
    { code: "REC", label: "Live & open to suggestion", detail: articleUrl, state: "wait" }
  ]));
  const published = useRef(null); // the folded article, for "open it" without re-fetching
  const payloadRef = useRef(null); // {slug,line,token,message} — held so "Retry publish" re-POSTs the exact same payload
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const upd = (i, patch) => { if (alive.current) setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s)); };
  const halt = (i, detail, msg) => { upd(i, { state: "fail", detail }); if (alive.current) setOutcome({ ok: false, msg }); };
  const tick = (ms) => new Promise(r => setTimeout(r, ms));

  // verify-after-publish: a 200 means the commit landed, but the raw URL is a
  // CDN — confirm it's serving readable JSONL, not a double-base64'd blob. A
  // 404 / network miss right after the commit is just CDN lag, not a failure,
  // so those return null (no flag). The signal we DO flag: a first line that
  // starts with "eyJ" (base64 of '{') instead of '{' — the workflow encoded the
  // body twice and the article won't parse.
  const verifyRaw = async (filename) => {
    try {
      const url = window.NpjArticles.RAW_BASE + "/" + filename + "?cb=" + Date.now();
      const txt = await fetch(url, { cache: "no-store" }).then(r => r.ok ? r.text() : null);
      if (txt == null) return null;
      const first = (txt.split("\n", 1)[0] || "").trim();
      if (!first) return null;
      if (/^eyJ/.test(first)) return {
        short: "raw file is base64, not JSON — double-encoded",
        msg: "The commit landed, but the published file starts with “eyJ”, not “{” — the workflow base64-encoded the body twice, so the article won't parse. Don't rely on the link until the workflow's encoding is fixed."
      };
      try { if (JSON.parse(first).op) return null; } catch (e) {}
      return {
        short: "raw file's first line isn't the genesis event",
        msg: "The commit landed, but the raw URL's first line didn't parse as the genesis JSONL event. It may be a stale CDN copy — re-check the file before sharing the link."
      };
    } catch (e) { return null; }
  };

  // The commit itself, factored out so "Retry publish" can re-POST the EXACT
  // same payload — including the same pre-generated version filename, so a
  // retry never mints a second file. Every publish CREATES a new file in
  // articles/<slug>/ (nothing is updated in place), which is what retired the
  // GitHub update-rejection failures. Success is the JSON body's `ok` flag —
  // NOT a bare HTTP 200 — because the webhook reports a failed GitHub commit
  // honestly, with the real status and message, instead of a lying 200.
  const commit = async () => {
    const p = payloadRef.current; if (!p) return;
    if (alive.current) setOutcome(null);
    upd(3, { state: "active", detail: "→ clovenbradshaw-ctrl/npj · " + p.filename });
    let res;
    try {
      res = await window.NpjArticles.publishGenesis(p);
    } catch (e) { return halt(3, "webhook unreachable", "Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing was committed."); }
    const data = await res.json().catch(() => null);
    const success = res.status === 200 && data && data.ok === true;
    if (!success) {
      let msg, detail;
      if (res.status === 401) {
        detail = "rejected — session invalid (401)";
        msg = "Your Matrix session isn't valid for publishing — sign in again.";
      } else if (res.status === 403 && data && data.error === "not an assignee on this article") {
        detail = "rejected — not an assignee (403)";
        msg = "You're signed in as " + (data.user || "your account") + " (" + (data.role || "no role") + "), but this article's genesis doesn't list you as an assignee.";
      } else if (data && data.gh_status) {
        detail = "GitHub " + data.gh_status + " — commit rejected";
        msg = "GitHub rejected the commit (" + data.gh_status + "): " + (data.error || "no message") + ". Nothing was written.";
      } else {
        detail = "HTTP " + res.status;
        msg = "The publish webhook answered " + res.status + ((data && data.error) ? " — " + data.error : "") + ". Nothing was committed.";
      }
      // 409/422 is a SHA race, not a dead end — offer a single re-POST.
      const retry = !!(data && (data.gh_status === 409 || data.gh_status === 422));
      upd(3, { state: "fail", detail });
      if (alive.current) setOutcome({ ok: false, msg, retry });
      return;
    }
    // committed for real — persist the receipt (the SHA the webhook just wrote)
    const sha = data.commit_sha || null;
    const filename = data.filename || p.filename;
    try { window.NpjArticles.saveReceipt({ filename, commit_sha: sha, bytes: data.bytes, published_at: new Date().toISOString() }); } catch (e) {}
    const shaTag = sha ? " @ " + sha.slice(0, 7) : "";
    upd(3, { state: "done", detail: "committed to clovenbradshaw-ctrl/npj · " + filename + shaTag });
    // 5 — live once Pages redeploys; confirm the raw file is readable JSONL
    upd(4, { state: "active", detail: articleUrl + (sha ? " · committed @ " + sha.slice(0, 7) : "") });
    await tick(400);
    const warn = await verifyRaw(filename);
    upd(4, { state: warn ? "fail" : "done", detail: warn ? warn.short : articleUrl + (sha ? " · committed @ " + sha.slice(0, 7) : "") });
    if (alive.current) setOutcome({ ok: true, sha, warn: warn ? warn.msg : null });
  };

  const run = async () => {
    setPhase("run");
    // the gate may have renamed the document after the steps were initialized
    upd(3, { detail: "→ clovenbradshaw-ctrl/npj · articles/" + slug + "/" });
    upd(4, { detail: articleUrl });
    // 1 — pull the piece
    upd(0, { state: "active" }); await tick(400);
    if (!flight.words) return halt(0, "the draft is empty", "Write the piece first — there's no text to publish.");
    upd(0, { state: "done", detail: flight.words + " words → articles/" + slug + "/" });
    // 2 — build: every bound span must resolve to a source record AND pin the
    // exact words in that source (you can't cite a whole page)
    upd(1, { state: "active" }); await tick(400);
    // Grounding gaps used to fail the build here. The author asked to be warned,
    // not walled — so unresolved / unpinned spans now pass with a warning and ship.
    const buildNotes = [];
    if (flight.missing.length) buildNotes.push(flight.missing.length + " unresolved");
    if (flight.unpinned) buildNotes.push(flight.unpinned + " unpinned");
    if (buildNotes.length) upd(1, { state: "warn", detail: flight.spans + " span" + (flight.spans === 1 ? "" : "s") + " · " + buildNotes.join(" · ") + " · published ungrounded ⚠" });
    else upd(1, { state: "done", detail: flight.spans + " span" + (flight.spans === 1 ? "" : "s") + " · 0 unresolved · 0 unpinned · build passed ✓" });
    // 3 — archive check, against the wayback machine itself: anything without
    // a recorded snapshot gets a live availability lookup, and upgrades stick
    // so the footnotes below cite the archived copy. Snapshot-only cites fall
    // back to their original URL in the .md — a warning, not a wall.
    upd(2, { state: "active", detail: "checking the wayback machine…" });
    let archivedNow = 0;
    // Only the sources the piece cites get archived — never an uploaded-but-unused
    // one (it stays private, off archive.org). Same set genesisFromContent ships.
    const usedSources = (sources || []).filter(s => flight.usedKeys.indexOf(s.key) >= 0);
    await Promise.all(usedSources.map(async s => {
      const rec = window.NPJ.SOURCES[s.key] || {};
      if (rec.archive_url) { archivedNow++; return; }
      if (!rec.original_url) return;
      const snap = await window.NpjArchiveCDN.waybackAvailable(rec.original_url).catch(() => null);
      if (snap) { rec.archive_url = snap; archivedNow++; }
    }));
    upd(2, { state: "done", detail: !flight.srcTotal ? "no sources bound" : archivedNow === flight.srcTotal ? "all " + flight.srcTotal + " verified on archive.org" : archivedNow + " of " + flight.srcTotal + " verified — the rest cite their original URL" });
    // 4 — the actual commit. The piece is serialized NOW (so claims carry any
    // archive URLs found in step 3) into ONE EO event: the INS genesis, written
    // as a brand-new timestamped file in articles/<slug>/. Every later edit
    // lands as another version file in the same folder, so the folder is the
    // article's complete change history — and no commit ever has to update an
    // existing file. Authority is re-verified server-side by the webhook.
    upd(3, { state: "active", detail: flight.mediaToFreeze ? ("moving " + flight.mediaToFreeze + " image" + (flight.mediaToFreeze === 1 ? "" : "s") + " to archive.org — this can take up to a minute each…") : ("→ clovenbradshaw-ctrl/npj · articles/" + slug + "/") });
    const actor = (session && session.user_id) || ((window.MatrixAuth.current() || {}).user_id) || null;
    const gen = window.NpjArticles.genesisFromContent(flight.content, {
      slug, headline: title, actor,
      // authors carries the userid (meMx); byline overrides the shown name only
      // when it was customized away from the contributor's own resolved name
      authors: bylineAuthors, editors: bylineEditors,
      byline: unsigned ? "Unsigned" : bylineOverride,
      // how the draft was assembled (typed vs. pasted, paste sizes, timeline) —
      // aggregate counts only, no words; ships with the piece for the reader's footer
      composition: window.NpjComposition ? window.NpjComposition.publishable(draftId) : null
    });
    // move any media-store images onto archive.org (download + reupload, or the
    // Wayback fallback), then rebuild the genesis line from the mutated operand
    // so the committed body hotlinks archive.org — never the media store.
    let line = gen.line, froze = null;
    if (window.NpjMedia && window.NpjMedia.freezeArticleMedia) {
      let freezeErr = null;
      try {
        froze = await window.NpjMedia.freezeArticleMedia(gen.operand.body, { slug, title });
      } catch (e) { freezeErr = e; }
      if (freezeErr || (froze && froze.failed)) {
        const why = freezeErr ? freezeErr.message
          : (froze.failReasons && froze.failReasons.length ? froze.failReasons.join("; ") : "");
        const detail = "image freeze failed" + (why ? ": " + why : "");
        const msg = "Could not move " + (froze ? froze.failed : "an") + " image" + ((froze && froze.failed !== 1) ? "s" : "") +
          " to archive.org — nothing was committed. " +
          (why ? why + " " : "") +
          "Check that the n8n media endpoint is reachable and that IA_S3_ACCESS / IA_S3_SECRET are set, then retry.";
        return halt(3, detail, msg);
      }
      if (froze && froze.frozen) {
        line = window.NpjArticles.genesisLine(gen.operand, actor);
        gen.article = window.NpjArticles.foldLog(line).article;
      }
    }
    published.current = gen.article;
    const token = window.MatrixAuth.token();
    if (!token) return halt(3, "no verified Matrix session", "Sign in with your admin Matrix account to publish.");
    // hold the payload (with any archive.org-frozen image srcs) AND the
    // generated version filename, so a retry re-POSTs the same bytes to the
    // same path instead of creating a second version file
    payloadRef.current = { slug, line, token, message: (isRepublish ? "republish: " : "publish: ") + slug, filename: window.NpjArticles.versionFilenameFor(slug, "ins") };
    upd(3, { detail: "→ clovenbradshaw-ctrl/npj · " + payloadRef.current.filename });
    await commit();
  };

  const srcKeys = (sources || []).map(s => s.key);
  // An empty draft has nothing to ship — that stays a hard wall. Grounding gaps
  // no longer block the gate: they raise a warning and the author publishes anyway.
  const blocked = !flight.words ? "The draft is empty — there's nothing to publish yet." : null;
  const groundWarn = (() => {
    const parts = [];
    if (flight.missing.length) parts.push(flight.missing.length + " bound span" + (flight.missing.length === 1 ? " has" : "s have") + " no source record (" + flight.missing.slice(0, 3).join(", ") + (flight.missing.length > 3 ? "…" : "") + ")");
    if (flight.unpinned) parts.push(flight.unpinned + " bound span" + (flight.unpinned === 1 ? " cites" : "s cite") + " a source without pinning the exact words");
    if (!parts.length) return null;
    return parts.join("; ") + ". You can publish anyway — these claims ship ungrounded, not held back.";
  })();
  // shipping with ungrounded claims is allowed, but it must never look like a
  // clean publish — the primary button turns caution-colored and says so.
  const shipUngrounded = !blocked && !!groundWarn;
  const Row = ({ k, children }) => (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid " + NR.line, alignItems: "baseline" }}>
      <span className="np-eyebrow" style={{ color: NR.muted, flex: "0 0 86px" }}>{k}</span>
      <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5, color: NR.text, minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.86)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} className="fade-in">
      {/* the publish boundary is always the dark room — the extra .newsroom class
          re-declares the dark --nr-* vars even when the editor is in light mode */}
      <div className="newsroom" style={{ width: 560, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "var(--nr-field)", border: "1.5px solid var(--yellow)", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}>
        <div style={{ background: "var(--yellow)", color: "var(--ink)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 18 }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21 }}>{isRepublish ? "REPUBLISH BOUNDARY" : "PUBLISH BOUNDARY"}</span>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 11 }}>GitHub + archive.org</span>
        </div>

        {phase === "confirm" && (
          <div style={{ padding: "20px 22px" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, color: NR.text, marginBottom: 4 }}>ONE LAST LOOK</div>
            <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5, marginBottom: 12 }}>{
              isRepublish
                ? (liveUnpublished
                    ? "This piece is in the record but unpublished. Confirming commits a new version to its event log and returns it to the site — every prior version stays in the public record."
                    : "This piece is already live. Confirming commits an updated version to its event log — it replaces what's on the site the moment you confirm, and every prior version stays in the public record.")
                : "Nothing has been published yet. This is what goes out the moment you confirm — committed to the public repo and served on GitHub Pages."
            }</div>
            <Row k="Folder">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <input value={slugVal} onChange={e => editSlug(e.target.value)} placeholder={auto} title="Name the document anything — it doesn't have to match the headline" className="np-mono" spellCheck={false}
                  style={{ width: "min(300px, 56vw)", border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 12, outline: "none" }} />
                <span className="np-mono" style={{ fontSize: 11 }}>/</span>
                <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>→ clovenbradshaw-ctrl/npj · articles/{slugVal !== slug ? " · saved as " + slug + "/" : ""} — each publish &amp; edit lands as a timestamped version file inside it</span>
              </span>
            </Row>
            <Row k="Live at">{articleUrl}</Row>
            <Row k="Headline">{title || "Untitled"}</Row>
            <Row k="Subtitle">{flight.dek || "—"}</Row>
            <Row k="Column">{flight.content.column || "—"}</Row>
            <Row k="Tags">{(flight.content.tags || []).length ? flight.content.tags.map(t => "#" + t).join("  ") : "—"}</Row>
            {/* Byline — type the name readers see; your account id is recorded
                on the backend either way. Editors optional; can be Unsigned. */}
            <div style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid " + NR.line, alignItems: "baseline" }}>
              <span className="np-eyebrow" style={{ color: NR.muted, flex: "0 0 86px" }}>Byline</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5, color: NR.text }}>
                  {unsigned || (!typedName && !defaultName) ? "Unsigned" : "By " + (typedName || defaultName)}
                  {bylineEditors.length ? <span style={{ color: NR.muted }}>{"  ·  Edited by " + bylineEditors.map(nameOfMx).join(", ")}</span> : null}
                </div>
                {!unsigned && (
                  <React.Fragment>
                    <input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Your name"
                      style={{ width: "100%", boxSizing: "border-box", marginTop: 6, border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 13, fontFamily: "var(--cond)", outline: "none" }} />
                    <div className="np-mono" style={{ fontSize: 9, color: NR.muted, margin: "3px 0 0", lineHeight: 1.5 }}>The name readers see. {meMx ? "Recorded on the record as " + meMx + "." : "Sign in so your account is recorded with the byline."}</div>
                  </React.Fragment>
                )}
                <input value={editorsInput} onChange={e => setEditorsInput(e.target.value)} placeholder="@editor:server  (optional)" className="np-mono" spellCheck={false}
                  style={{ width: "100%", boxSizing: "border-box", marginTop: 6, border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 12, outline: "none" }} />
                <div className="np-mono" style={{ fontSize: 9, color: NR.muted, margin: "3px 0 0", lineHeight: 1.5 }}>Edited by · optional, shown as a separate credit line.</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={unsigned} onChange={e => setUnsigned(e.target.checked)} />
                  <span className="np-mono" style={{ fontSize: 10.5, color: NR.text }}>Publish unsigned — no author credit</span>
                </label>
              </div>
            </div>
            <Row k="Length">{flight.words} words</Row>
            <Row k="Sources">{flight.srcTotal ? flight.srcTotal + " bound · " + flight.archived + " archived" + (flight.srcTotal - flight.archived ? " · " + (flight.srcTotal - flight.archived) + " snapshot-only" : "") : "none"}</Row>
            <Row k="Spans">{flight.spans} cited span{flight.spans === 1 ? "" : "s"}{flight.missing.length ? " · " + flight.missing.length + " unresolved" : ""}{flight.unpinned ? " · " + flight.unpinned + " not pinned to source" : ""}</Row>
            {flight.mediaToFreeze > 0 && <Row k="Images">{flight.mediaToFreeze} on the media store · moved to archive.org on publish (Wayback Machine fallback if direct upload is unavailable)</Row>}
            {blocked && <div className="np-mono" style={{ fontSize: 11, color: NR.warn, lineHeight: 1.5, margin: "12px 0 0", border: "1px solid " + NR.warn, padding: "9px 10px" }}>{blocked}</div>}
            {!blocked && groundWarn && <div className="np-mono" style={{ fontSize: 11, color: NR.warn, lineHeight: 1.5, margin: "12px 0 0", border: "1px solid " + NR.warn, padding: "9px 10px", display: "flex", gap: 8 }}><span aria-hidden="true">⚠</span><span>{groundWarn}</span></div>}
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "10px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>Not yet — back to editor</button>
              <button onClick={blocked ? undefined : run} disabled={!!blocked} className="np-cond" style={{ background: (blocked || shipUngrounded) ? "transparent" : "var(--yellow)", color: blocked ? NR.muted : shipUngrounded ? NR.warn : "var(--ink)", border: "1.5px solid " + (blocked ? NR.line : shipUngrounded ? NR.warn : "var(--ink)"), padding: "10px 18px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: blocked ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> {shipUngrounded ? (isRepublish ? "Republish ungrounded" : "Publish ungrounded") : (isRepublish ? "Republish it" : "Publish it")}</button>
            </div>
          </div>
        )}

        {phase === "run" && (
          <div style={{ padding: "20px 22px" }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 13, padding: "10px 0", borderBottom: i < steps.length - 1 ? "1px solid " + NR.line : 0, opacity: s.state === "wait" ? .4 : 1, transition: "opacity .3s" }}>
                <span style={{ flex: "0 0 28px", textAlign: "center" }}>
                  {s.state === "done" ? <I.check style={{ fontSize: 18, color: NR.ok }} />
                    : s.state === "fail" ? <I.x style={{ fontSize: 17, color: NR.warn }} />
                    : s.state === "warn" ? <span style={{ fontSize: 16, color: NR.warn }}>⚠</span>
                    : s.state === "active" ? <Spinner />
                    : <span style={{ fontFamily: "var(--mono)", color: NR.muted }}>{window.NPJ.EO.glyph(s.code)}</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--cond)", fontSize: 16, color: (s.state === "fail" || s.state === "warn") ? NR.warn : NR.text, fontWeight: 600 }}>{s.label}</div>
                  <div className="np-mono" style={{ fontSize: 10.5, color: (s.state === "fail" || s.state === "warn") ? NR.warn : NR.muted, marginTop: 2, overflowWrap: "anywhere" }}>{s.detail}</div>
                  {s.sources && s.state !== "wait" && srcKeys.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
                      {srcKeys.map((k) => <span key={k} className="np-mono fade-in" style={{ fontSize: 9, padding: "1px 5px", border: "1px solid " + NR.line, color: s.state === "done" ? NR.ok : NR.soft }}>{s.state === "done" ? "✓ " : "↻ "}{k.slice(0, 12)}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {outcome && (
              <div className="fade-in" style={{ marginTop: 16, textAlign: "center" }}>
                {outcome.ok
                  ? <React.Fragment>
                      <div style={{ fontFamily: "var(--display)", fontSize: 26, color: outcome.warn ? NR.warn : "var(--yellow)", marginBottom: 4 }}>{outcome.warn ? "COMMITTED — CHECK THE FILE" : "COMMITTED — GOING LIVE"}</div>
                      <div className="np-mono" style={{ fontSize: 11, color: outcome.warn ? NR.warn : NR.muted, marginBottom: outcome.sha ? 8 : 16, lineHeight: 1.5 }}>{outcome.warn || (isRepublish ? ("articles/" + slug + "/ has a new version in clovenbradshaw-ctrl/npj — every prior version stays in that folder. The front page reflects the update and the link below opens the formatted reader.") : ("articles/" + slug + "/ is in clovenbradshaw-ctrl/npj — version 1 of the article's event log. Every future edit lands as another timestamped version file in that folder. The front page lists it and the link below opens the formatted reader."))}</div>
                      {outcome.sha && <div className="np-mono" style={{ fontSize: 10.5, color: NR.soft, marginBottom: 16 }}>committed @ {outcome.sha.slice(0, 7)}</div>}
                      {!outcome.warn && (
                        <div style={{ display: "inline-block", textAlign: "left", marginBottom: 18 }}>
                          <ShareBar dark url={articleUrl} archiveUrl={"https://web.archive.org/save/" + window.npjArticleLogUrl(published.current || slug)} title={title} />
                        </div>
                      )}
                    </React.Fragment>
                  : <React.Fragment>
                      <div style={{ fontFamily: "var(--display)", fontSize: 24, color: NR.warn, marginBottom: 6 }}>PUBLISH DIDN'T COMPLETE</div>
                      <div className="np-mono" style={{ fontSize: 11.5, color: NR.soft, lineHeight: 1.5, maxWidth: 440, margin: "0 auto 16px" }}>{outcome.msg} Your draft is safe — it stays saved on this device and synced to your Matrix account.</div>
                    </React.Fragment>}
                <div style={{ display: "flex", gap: 9, justifyContent: "center" }}>
                  {outcome.ok && (
                    <button onClick={() => onPublished && onPublished(published.current || slug)} className="np-cond" style={{ background: "var(--yellow)", color: "var(--ink)", border: "1.5px solid var(--ink)", padding: "10px 18px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <I.arrow style={{ fontSize: 14 }} /> Open the article
                    </button>
                  )}
                  {!outcome.ok && outcome.retry && (
                    <button onClick={commit} className="np-cond" style={{ background: "var(--yellow)", color: "var(--ink)", border: "1.5px solid var(--ink)", padding: "10px 18px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <I.lock style={{ fontSize: 14 }} /> Retry publish
                    </button>
                  )}
                  <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "10px 16px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>Back to editor</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* Serialize the contentEditable draft to plaintext markdown. LEGACY: publishing
   now commits an EO event log (app/articles.js → genesisFromContent), not a .md
   file — this serializer stays only for plaintext export/debugging.
   Bound source spans become numbered footnotes whose definitions point at the
   archived (or original) URL — so the markdown keeps every claim auditable. */
function htmlToMarkdown(html) {
  const root = document.createElement("div"); root.innerHTML = html || "";
  const inline = (node) => {
    let out = "";
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") { out += "  \n"; return; }
      if (tag === "sup" && n.classList.contains("md-cite")) { out += "[^" + (n.getAttribute("data-cite") || n.textContent) + "]"; return; }
      const inner = inline(n);
      if (tag === "strong" || tag === "b") out += "**" + inner + "**";
      else if (tag === "em" || tag === "i") out += "*" + inner + "*";
      else if (tag === "s" || tag === "strike" || tag === "del") out += "~~" + inner + "~~";
      else if (tag === "code") out += "`" + inner + "`";
      else if (tag === "a") out += "[" + inner + "](" + (n.getAttribute("href") || "") + ")";
      else out += inner;
    });
    return out;
  };
  const lines = [];
  const footnotes = {};
  root.querySelectorAll("sup.md-cite").forEach(sup => {
    if (sup.hasAttribute("data-fn")) return; // manual footnote — its note lives in the footnotes list
    const key = sup.getAttribute("data-cite"); if (!key) return;
    const rec = window.NPJ.SOURCES[key] || {};
    footnotes[key] = rec.archive_url || rec.original_url || rec.title || key;
  });
  // manual footnotes: their notes live in the structured "Footnotes" list, not
  // in the prose — read each note straight off its <li data-fn-key>.
  root.querySelectorAll("ol.nr-fnotes > li.nr-fnote[data-fn-key]").forEach(li => {
    const key = (li.getAttribute("data-fn-key") || "").trim(); if (!key) return;
    footnotes[key] = inline(li).trim();
  });
  Array.from(root.childNodes).forEach(node => {
    if (node.nodeType === 3) { const t = node.nodeValue.trim(); if (t) lines.push(t, ""); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "h1") lines.push("# " + inline(node).trim(), "");
    else if (tag === "h2") lines.push("## " + inline(node).trim(), "");
    else if (tag === "h3") lines.push("### " + inline(node).trim(), "");
    else if (tag === "blockquote") lines.push("> " + inline(node).trim().replace(/\n/g, "\n> "), "");
    else if (tag === "ol" && node.classList.contains("nr-fnotes")) { /* the footnotes list — emitted as [^key]: defs below, not as a numbered list */ }
    else if (tag === "ul") { node.querySelectorAll(":scope > li").forEach(li => lines.push("- " + inline(li).trim())); lines.push(""); }
    else if (tag === "ol") { Array.from(node.querySelectorAll(":scope > li")).forEach((li, i) => lines.push((i + 1) + ". " + inline(li).trim())); lines.push(""); }
    else if (tag === "hr") lines.push("---", "");
    else if (tag === "pre") {
      if (node.classList.contains("verse")) { String(node.innerText || "").replace(/\n+$/, "").split("\n").forEach(l => lines.push(l.trimEnd() + "  ")); lines.push(""); }
      else lines.push("```", String(node.innerText || "").replace(/\n+$/, ""), "```", "");
    }
    else if (node.classList && node.classList.contains("nr-dek")) {
      const t = inline(node).trim();
      if (t) lines.push("*" + t + "*", ""); // the dek — an italic standfirst right under the headline
    }
    else if (node.classList && node.classList.contains("cmp-widget") && node.getAttribute("data-widget") === "poll") {
      const qEl = node.querySelector(".cmp-widget-b strong");
      lines.push("> **Poll:** " + (qEl ? qEl.textContent.trim() : ""));
      node.querySelectorAll(".cmp-widget-b span").forEach(s => { const t = s.textContent.trim(); if (t) lines.push("> - " + t); });
      lines.push("");
    }
    else if (tag === "figure") {
      const cap = node.querySelector("figcaption:not(.cmp-credit):not(.cmp-desc)");
      const capText = cap ? cap.textContent.trim() : "";
      const credEl = node.querySelector(".cmp-credit");
      const creditText = credEl ? credEl.textContent.trim() : "";
      const descEl = node.querySelector(".cmp-desc");
      const descText = descEl ? descEl.textContent.trim() : "";
      // an image slot that resolved an archive.org link carries it in `src` —
      // the published .md hotlinks the IA copy (archive.org is the media CDN);
      // local-only drops have no durable URL and stay out of the .md
      const slot = node.querySelector("image-slot");
      const img = slot && slot.getAttribute("src");
      const okImg = img && (window.NpjMedia ? window.NpjMedia.isPublishable(img)
        : (window.NpjArchiveCDN && window.NpjArchiveCDN.isMediaUrl(img)));
      if (okImg)
        lines.push("![" + capText.replace(/[\[\]\n]/g, " ").trim() + "](" + img + ")", "");
      const u = node.getAttribute("data-embed-url"); if (u) lines.push("<" + u + ">", "");
      if (capText) lines.push("*" + capText + "*", "");
      if (creditText) lines.push("*Credit: " + creditText.replace(/\n/g, " ") + "*", "");
      if (descText) lines.push("*Alt: " + descText.replace(/\n/g, " ") + "*", "");
    }
    else { const t = inline(node).trim(); if (t) lines.push(t, ""); }
  });
  let md = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const keys = Object.keys(footnotes);
  if (keys.length) { md += "\n"; keys.forEach(k => { md += "[^" + k + "]: " + footnotes[k] + "\n"; }); }
  return md;
}
window.NpjArticleMarkdown = function (content) {
  const c = content || {};
  const tmp = document.createElement("div"); tmp.innerHTML = c.html || "";
  const dekEl = tmp.querySelector(".nr-dek");
  const dek = dekEl ? (dekEl.textContent || "").trim() : "";
  const meta = "<!-- column: " + (c.column || "") + " · tags: " + ((c.tags || []).join(", ")) + (dek ? " · subtitle: " + dek.replace(/-->/g, "") : "") + " -->\n\n";
  return meta + htmlToMarkdown(c.html);
};

/* Closed-network gate: until the admin adds you, the newsroom is read-only-off. */
function NewsroomLocked({ signedIn, me, onSignIn, onHome }) {
  const localDrafts = (window.NpjDrafts && window.NpjDrafts.localList) ? window.NpjDrafts.localList() : [];
  return (
    <div className="newsroom fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 22px", textAlign: "center" }}>
      <div style={{ maxWidth: 520 }}>
        <I.lock style={{ fontSize: 40, color: "var(--yellow)" }} />
        <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: .95, margin: "16px 0 12px", color: NR.text }}>The newsroom is invite-only</h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.5, color: NR.soft, margin: 0 }}>
          People's Journalism is being built by its founding admin. For now, only the admin and the contributors they've added can draft and edit here — that opens up as the network grows.
        </p>
        {signedIn && <p className="np-mono" style={{ fontSize: 12, color: NR.warn, margin: "12px 0 0", lineHeight: 1.5 }}>You're verified as {me}, but you're not on the contributor allowlist yet. Ask the admin to add you.</p>}
        {!signedIn && localDrafts.length > 0 && (
          <p className="np-mono" style={{ fontSize: 12, color: NR.ok, margin: "12px 0 0", lineHeight: 1.5 }}>
            Nothing was lost: {localDrafts.length} draft{localDrafts.length === 1 ? " is" : "s are"} still saved in this browser. Sign back in to keep editing — they'll re-sync to your account.
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          {!signedIn && <button onClick={onSignIn} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> Sign in with Matrix</button>}
          <button onClick={onHome} className="btn" style={{ background: "transparent", color: NR.text, borderColor: NR.line }}>Back to the public site</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Newsroom, NewsroomLocked });
