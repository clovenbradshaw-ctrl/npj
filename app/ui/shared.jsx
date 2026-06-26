/* NPJ shared UI — icons, badges, source card. Exports to window.
   Hooks (useState/useRef/useCallback/useMemo/useEffect) are exposed as globals
   in the host HTML so every babel file can use them bare. */

/* ---------- icons — Phosphor (loaded as a webfont in index.html) ----------
   Each icon renders an <i class="ph ph-NAME">: its size follows font-size and
   its color follows currentColor, so every existing `<I.x style={{fontSize}}/>`
   call site keeps working unchanged. `source` keeps the brand ⊥ ground glyph —
   it's logic notation (a claim standing on its source), not a stock icon.
   Pass weight="bold"|"fill" for a heavier cut. */
function phIcon(name, weight) {
  const wcls = weight === "bold" ? "ph-bold" : weight === "fill" ? "ph-fill" : "ph";
  return function PhIcon(p) {
    p = p || {};
    const { style, className, ...rest } = p;
    return <i aria-hidden="true"
      className={wcls + " ph-" + name + (className ? " " + className : "")}
      style={{ display: "inline-block", lineHeight: 1, verticalAlign: "-0.125em", ...style }} {...rest} />;
  };
}
const I = {
  /* chrome + actions */
  archive: phIcon("archive-box"),
  lock:    phIcon("lock-simple"),
  check:   phIcon("check", "bold"),
  x:       phIcon("x", "bold"),
  ext:     phIcon("arrow-square-out"),
  trash:   phIcon("trash"),
  expand:  phIcon("arrows-out"),
  up:      phIcon("arrow-fat-up", "fill"),
  chat:    phIcon("chat-circle"),
  eye:     phIcon("eye"),
  eyeoff:  phIcon("eye-slash"),
  filter:  phIcon("funnel"),
  doc:     phIcon("file-text"),
  data:    phIcon("database"),
  mic:     phIcon("microphone"),
  search:  phIcon("magnifying-glass"),
  plus:    phIcon("plus", "bold"),
  arrow:   phIcon("arrow-right"),
  shield:  phIcon("shield-check"),
  clock:   phIcon("clock"),
  folder:  phIcon("folder-simple"),
  sun:     phIcon("sun"),
  moon:    phIcon("moon"),
  link:    phIcon("link-simple"),
  copy:    phIcon("copy"),
  /* editor toolbar */
  undo:    phIcon("arrow-counter-clockwise"),
  redo:    phIcon("arrow-clockwise"),
  quote:   phIcon("quotes"),
  listBullets: phIcon("list-bullets"),
  listNumbers: phIcon("list-numbers"),
  divider: phIcon("minus"),
  image:   phIcon("image"),
  images:  phIcon("images"),
  play:    phIcon("play-circle"),
  dots:    phIcon("dots-three-outline"),
  code:    phIcon("code"),
  codeBlock: phIcon("code-block"),
  alignLeft:   phIcon("text-align-left"),
  alignCenter: phIcon("text-align-center"),
  alignRight:  phIcon("text-align-right"),
  highlighter: phIcon("highlighter"),
  palette: phIcon("palette"),
  swatches: phIcon("swatches"),
  asterisk: phIcon("asterisk"),
  poll:    phIcon("chart-bar"),
  penNib:  phIcon("pen-nib"),
  tag:     phIcon("tag"),
  sparkle: phIcon("sparkle"),
  caretDown: phIcon("caret-down"),
  caretRight: phIcon("caret-right"),
  hash:    phIcon("hash"),
  warning: phIcon("warning"),
  info:    phIcon("info"),
  /* the "bottom" / ground glyph (⊥): a claim standing on its source — kept as a
     hand-drawn mark because it is the product's logic notation, not an icon */
  source:  (p) => { p = p || {}; const { style, ...rest } = p; return (<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ verticalAlign: "-0.125em", ...style }} {...rest}><path d="M12 4v15M4 19h16"/></svg>); }
};

const SRC_TYPE = {
  primary:   { label: "Primary",   icon: I.doc,  color: "var(--ink)" },
  data:      { label: "Data",      icon: I.data, color: "var(--data)" },
  reporting: { label: "Reporting", icon: I.mic,  color: "var(--review)" },
  interview: { label: "Interview", icon: I.chat, color: "var(--review)" }
};

/* ---------- plain-text paste ----------
   Text copied in loses its original formatting: every editor rebuilds the
   clipboard's text/plain — blank line = new paragraph, single newline = <br> —
   so fonts, colors and backgrounds never ride in from the source page. */
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
window.NpjPlainText = {
  toHtml(text) {
    return String(text).replace(/\r\n?/g, "\n").split(/\n{2,}/)
      .map(b => "<p>" + (escHtml(b).replace(/\n/g, "<br/>") || "<br/>") + "</p>").join("");
  },
  // insert at the caret; inside a <pre> (code block, verse) the raw text goes
  // in as-is so its newlines survive instead of becoming paragraphs
  insert(text) {
    const sel = window.getSelection();
    const n = sel && sel.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const inPre = !!(el && el.closest && el.closest("pre"));
    if (inPre || String(text).indexOf("\n") < 0) document.execCommand("insertText", false, text);
    else document.execCommand("insertHTML", false, this.toHtml(text));
  }
};

/* ---------- real site URLs ----------
   Where this site actually lives — GitHub Pages, a custom domain, localhost —
   derived from the page URL, never a hardcoded domain. The share link opens the
   formatted reader; the log URL is the committed EO event log itself — the
   durable, archivable artifact. Documents now live as FOLDERS of timestamped
   version files (articles/<slug>/), so the log URL points at the folder on
   GitHub; legacy single-file logs (articles/<slug>.jsonl) keep their raw URL. */
function npjSiteBase() { return location.origin + location.pathname.replace(/index\.html?$/i, "").replace(/\/?$/, "/"); }
function npjArticleUrl(slug) { return npjSiteBase() + "#article;read=" + encodeURIComponent(slug); }
function npjArticleRawUrl(slug) { return npjSiteBase() + "articles/" + slug + ".jsonl"; }
// takes a folded article ({slug, storage, logPath}) or a bare slug (assumed folder)
function npjArticleLogUrl(slugOrArticle) {
  const a = (slugOrArticle && typeof slugOrArticle === "object") ? slugOrArticle : null;
  const slug = a ? a.slug : slugOrArticle;
  if (a && a.storage === "file") return npjArticleRawUrl(slug);
  return "https://github.com/clovenbradshaw-ctrl/npj/tree/main/articles/" + slug;
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- contributor lookup ---------- */
// One resolver for "who is this mxid" — name + bio + a stable color — folding the
// committed contributor profiles (layout.json → window.NPJ.PEOPLE) with a sane
// localpart fallback. Used by the handle, the byline and the masthead.
function npjPerson(mxid) {
  const p = (window.NPJ && window.NPJ.PEOPLE && window.NPJ.PEOPLE[mxid]) || {};
  const color = p.color || (window.NpjProfiles ? window.NpjProfiles.colorFor(mxid) : "#6b6b6b");
  const name = p.name || (mxid ? String(mxid).replace(/^@/, "").split(":")[0] : "");
  return { mxid, name, bio: p.bio || "", color };
}

/* ---------- bio rich text ----------
   Render a contributor's "About me" with safe inline links. Tokenising +
   URL-sanitising is headless in app/profiles.js (linkTokens/safeHref); here we
   only map tokens to React nodes. Labels and plain text are React children, so
   React escapes them; every href already cleared safeHref (http(s)/mailto only)
   and links carry rel="noopener noreferrer nofollow" + target=_blank. There is
   no innerHTML anywhere on this path. Falls back to the raw string if the
   profiles module hasn't loaded. */
function npjRichText(text) {
  const P = window.NpjProfiles;
  const toks = (P && P.linkTokens) ? P.linkTokens(text) : [{ type: "text", text: String(text == null ? "" : text) }];
  return toks.map((t, i) => t.type === "link"
    ? <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow"
         style={{ color: "inherit", textDecorationLine: "underline", textUnderlineOffset: 2 }}>{t.label}</a>
    : <React.Fragment key={i}>{t.text}</React.Fragment>);
}

/* ---------- MXID handle ---------- */
function Handle({ mxid, showName = false, size = 18 }) {
  const p = npjPerson(mxid);
  const initial = (p.name || mxid).replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ width: size, height: size, borderRadius: "50%", background: p.color, color: "#fff",
        fontFamily: "var(--cond)", fontWeight: 700, fontSize: size * 0.56, display: "inline-flex",
        alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{initial}</span>
      <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
        {showName ? p.name : mxid}
      </span>
    </span>
  );
}

/* ---------- byline ----------
   The outward-facing credit under a headline. Reads authors + (optional) editors
   off the article, resolves each to a public profile, and shows the name as a
   chip that expands to the contributor's "About me". An explicit `byline` string
   ("Unsigned") overrides the author names entirely. Editor names are optional —
   the "Edited by" line only appears when there are editors. */
function ContributorChip({ mxid, bold, onOpen, open }) {
  const p = npjPerson(mxid);
  const hasBio = !!(p.bio && p.bio.trim());
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: p.color, color: "#fff",
        fontFamily: "var(--cond)", fontWeight: 700, fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
        {(p.name || "?").charAt(0).toUpperCase()}
      </span>
      {hasBio ? (
        <button onClick={() => onOpen && onOpen(open ? null : mxid)} title={"About " + p.name}
          aria-expanded={!!open}
          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "var(--cond)", fontWeight: bold ? 700 : 600,
            fontSize: 15, color: "var(--ink)", borderBottom: "1px dotted var(--ink-soft)", lineHeight: 1.2 }}>
          {p.name}
        </button>
      ) : (
        <span style={{ fontFamily: "var(--cond)", fontWeight: bold ? 700 : 600, fontSize: 15, color: "var(--ink)" }}>{p.name}</span>
      )}
    </span>
  );
}

function NameList({ list, onOpen, openId }) {
  return list.map((mx, i) => (
    <React.Fragment key={mx}>
      {i > 0 && <span style={{ color: "var(--ink-soft)" }}>{i === list.length - 1 ? " and " : ", "}</span>}
      <ContributorChip mxid={mx} bold onOpen={onOpen} open={openId === mx} />
    </React.Fragment>
  ));
}

function Byline({ authors = [], editors = [], byline = "" }) {
  const [openId, setOpenId] = useState(null);
  const auth = (authors || []).filter(Boolean);
  const eds = (editors || []).filter(Boolean);
  const override = (byline || "").trim();
  const openMx = openId;
  const openP = openMx ? npjPerson(openMx) : null;
  const goContributors = () => { if (window.__nav && window.__nav.contributors) window.__nav.contributors(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 11 }}>By</span>
        {override
          ? <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{override}</span>
          : auth.length
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><NameList list={auth} onOpen={setOpenId} openId={openId} /></span>
            : <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>Unsigned</span>}
      </div>
      {eds.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 11 }}>Edited by</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><NameList list={eds} onOpen={setOpenId} openId={openId} /></span>
        </div>
      )}
      {openP && openP.bio && (
        <div className="fade-in" style={{ border: "1px solid var(--ink)", background: "var(--card)", padding: "9px 11px", maxWidth: 460 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14 }}>{openP.name}</span>
            <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{openP.mxid}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setOpenId(null)} aria-label="Close" style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-soft)", fontSize: 13, lineHeight: 1 }}><I.x /></button>
          </div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{npjRichText(openP.bio)}</div>
          <button onClick={goContributors} className="np-mono" style={{ marginTop: 7, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--ink-soft)", fontSize: 10.5, textDecoration: "underline", textUnderlineOffset: 2 }}>About the contributors →</button>
        </div>
      )}
    </div>
  );
}

/* ---------- source type badge ---------- */
function SourceTag({ type }) {
  const t = SRC_TYPE[type] || SRC_TYPE.primary;
  const Icon = t.icon;
  return (
    <span className="np-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: t.color }}>
      <Icon style={{ fontSize: 13 }} /> {t.label}
    </span>
  );
}

/* ---------- inline preview of an uploaded source file ----------
   The card's job is to let you SEE the source, not just name it. When a claim is
   backed by an uploaded document — a scan, a photo, a screenshot, a PDF — the
   bytes are in hand the instant it's dropped (a session blob) and ride a
   media-store URL after that, long BEFORE publish moves them onto archive.org.
   So in a draft PREVIEW, where the archive.org snapshot is still pending, this
   shows the actual file right in the card: the very image that becomes the
   archive.org copy. Best-effort — resolves a renderable URL through
   NpjSourceView.displayUrl; if the bytes can't render in an <img> (or all we
   have is a details page), it falls back to an "open it" link, never a broken
   frame. The point is the SOURCE, so we render the document, not just its name. */
function SourceFilePreview({ rec, onExpand }) {
  const SV = window.NpjSourceView;
  const kind = SV ? SV.kindOf(rec) : "unknown";
  const [url, setUrl] = useState(null);
  const [done, setDone] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null); setDone(false); setBroken(false);
    if (!SV || !SV.displayUrl) { setDone(true); return; }
    SV.displayUrl(rec)
      .then(u => { if (alive) { setUrl(u || null); setDone(true); } })
      .catch(() => { if (alive) setDone(true); });
    return () => { alive = false; };
  }, [rec && (rec.id || rec.key), rec && rec.file_url, rec && rec.archive_url]); // eslint-disable-line

  const archived = !!rec.archive_url;
  const mat = { background: "repeating-conic-gradient(#e9e4d6 0% 25%, #f3eee1 0% 50%) 50% / 18px 18px", border: "1px solid var(--rule)" };
  // Clicking the document EXPANDS it to fill the screen IN the app (onExpand)
  // instead of opening a new tab — so you read the receipt full size without
  // losing your place in the story. Only when no expander is wired do we fall
  // back to the old open-in-a-new-tab link.
  const expandable = typeof onExpand === "function";
  // the access path, in words: expand it in place when we can; otherwise once
  // it's on archive.org the snapshot link is it, and before that the in-hand file.
  const note = expandable
    ? "The document itself — click it to read full size, right here."
    : archived
      ? "The document itself — open the archive.org snapshot to read it full size."
      : "The document itself — uploaded, and moved onto archive.org when this story publishes.";
  // the explicit action for a pdf/text (no inline thumbnail) or a broken image
  const openAction = expandable ? (
    <button type="button" onClick={onExpand} className="np-mono"
      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit",
        fontSize: 10, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2,
        display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5 }}>
      <I.expand style={{ fontSize: 12 }} /> Expand to full screen
    </button>
  ) : url ? (
    <a href={url} target="_blank" rel="noopener" className="np-mono"
      style={{ fontSize: 10, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5 }}>
      <I.ext style={{ fontSize: 12 }} /> Open the document
    </a>
  ) : null;
  const showImg = kind === "image" && url && !broken;
  const imgEl = (
    <img src={url} alt={rec.title || "uploaded source"} onError={() => setBroken(true)}
      style={{ display: "block", width: "100%", maxHeight: 168, objectFit: "contain", margin: "0 auto" }} />
  );

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 9.5, marginBottom: 4 }}>The source — the document itself</div>
      {showImg ? (
        expandable ? (
          <button type="button" onClick={onExpand} title="Expand to full screen" className="srcfile-frame"
            style={{ ...mat, display: "block", width: "100%", padding: 6, lineHeight: 0, cursor: "zoom-in", position: "relative" }}>
            {imgEl}
            <span className="srcfile-expand np-mono"><I.expand style={{ fontSize: 11 }} /> Expand</span>
          </button>
        ) : (
          <a href={url} target="_blank" rel="noopener" title="Open the source document" style={{ display: "block", ...mat, padding: 6, lineHeight: 0 }}>
            {imgEl}
          </a>
        )
      ) : (kind === "image" && !done) ? (
        <div className="np-mono" style={{ ...mat, padding: "22px 12px", textAlign: "center", color: "var(--ink-soft)", fontSize: 10.5 }}>loading the document…</div>
      ) : null}
      <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: showImg ? 5 : 4, lineHeight: 1.45 }}>{note}</div>
      {/* the image is itself the trigger; for a pdf/text (or a broken image) make the action explicit */}
      {!showImg && openAction}
    </div>
  );
}

/* ---------- the source hover/click card ---------- */
function SourceCard({ srcKey, onClose, pinned, quote, preview, onExpand }) {
  const s = window.NPJ.SOURCES[srcKey];
  if (!s) return null;
  // the pinned source-span for THIS claim wins over the source's generic pull
  // quote — it's the exact words in the source that back the passage you hovered
  const cited = (quote && String(quote).trim()) || "";
  // an interview/conversation has no snapshot to link — it attributes to a
  // person (named or anonymous), so its card shows the terms, not archive links
  const NI = window.NpjInterview;
  const iv = !!(NI && NI.isInterview(s));
  const talk = s.talk || {};
  const archived = !!s.archive_url;
  // An uploaded document (scan/photo/screenshot/PDF) carries its own bytes — a
  // session blob the moment it's dropped, a media-store URL after — so in a
  // draft PREVIEW we can SHOW the source itself even though its archive.org
  // snapshot is still pending. Gated to preview: the live reader reaches the
  // archived copy through the snapshot link below, so the card stays unchanged
  // for published stories. We key off the upload signals (a doc- id, a stored
  // file, or a session blob) — never a web/data source that merely has a URL.
  const SV = window.NpjSourceView;
  const isUpload = /^doc-/.test(s.id || "") || !!s.file_url || !!(SV && SV.hasBlob && SV.hasBlob(SV.recKey(s)));
  // A viewable uploaded document can be EXPANDED to fill the screen in-app —
  // wired by the host through onExpand. In a draft preview we also show the file
  // inline (showFile); in the live reader the inline preview stays off, but the
  // "View document" action below still opens that same full-screen view.
  const viewable = !iv && isUpload && !!(SV && SV.isViewable && SV.isViewable(s));
  const canExpand = viewable && typeof onExpand === "function";
  const expand = canExpand ? () => onExpand(srcKey) : undefined;
  const showFile = !!preview && viewable;
  // When the inline preview isn't shown (the live reader), surface an explicit
  // action to open the document full screen — the inline thumbnail is the
  // trigger when it IS shown, so we don't double it up.
  const showViewBtn = canExpand && !showFile;
  // An image's pinned passage is machine-read (OCR) text — noisy, and not the
  // verbatim quote it's presented as. Keep it out of the card unless the author
  // vouched for it (ocrShow); the document itself, shown above or behind "View
  // document", is the receipt. Web/PDF/text passages show exactly as before.
  const showCited = !!cited && (!SV || !SV.citedPassageVisible || SV.citedPassageVisible(s));
  return (
    <div style={{ fontFamily: "var(--serif)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 12px", borderBottom: "1.5px solid var(--ink)", background: "var(--paper-2)" }}>
        <SourceTag type={s.type} />
        {iv ? (
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--review)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <I.chat style={{ fontSize: 13 }} /> {(talk.anonymous ? "ANONYMOUS · " : "") + (NI.attributionLabel(talk.attribution) || "").toUpperCase()}
          </span>
        ) : (
          <span className="np-mono" style={{ fontSize: 10.5, color: archived ? "var(--verified)" : "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <I.archive style={{ fontSize: 13 }} /> {archived ? "ARCHIVED" : "SNAPSHOT PENDING"}
          </span>
        )}
        {pinned && onClose && (
          <button onClick={onClose} className="np-mono" style={{ border: 0, background: "none", fontSize: 14, lineHeight: 1, color: "var(--ink-soft)" }}><I.x /></button>
        )}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginBottom: 4 }}>{s.id}</div>
        <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 16, lineHeight: 1.12, marginBottom: 3 }}>{s.title}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 9 }}>{s.outlet}</div>
        {showFile && <SourceFilePreview rec={s} onExpand={expand} />}
        {showCited ? (
          <div style={{ marginBottom: 10 }}>
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 9.5, marginBottom: 3 }}>The cited passage — in the source</div>
            <div style={{ borderLeft: "3px solid var(--yellow-deep)", paddingLeft: 9, fontStyle: "italic",
              fontSize: 13.5, lineHeight: 1.34, color: "var(--ink)" }}>“{cited}”</div>
          </div>
        ) : s.pull_quote && (
          <div style={{ borderLeft: "3px solid var(--yellow-deep)", paddingLeft: 9, fontStyle: "italic",
            fontSize: 13.5, lineHeight: 1.34, marginBottom: 10, color: "var(--ink)" }}>{s.pull_quote}</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11,
          fontFamily: "var(--mono)", color: "var(--ink-soft)", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>
          {iv
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><I.chat style={{ fontSize: 12 }} /> {NI.metaLine(s)}</span>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><I.clock style={{ fontSize: 12 }} /> retrieved {s.retrieved}</span>}
        </div>
        {iv ? (
          (talk.reason || talk.reporter) && (
            <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 9, lineHeight: 1.5 }}>
              {talk.reason ? <div>Granted anonymity: {talk.reason}</div> : null}
              {talk.reporter ? <div>Spoke with {talk.reporter}</div> : null}
            </div>
          )
        ) : (showViewBtn || archived || s.original_url) ? (
          <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
            {showViewBtn && (
              <button onClick={expand} className="btn btn-primary btn-sm" style={{ flex: 1, minWidth: 132, textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <I.expand style={{ fontSize: 13 }} /> View document
              </button>
            )}
            {archived && (
              <a href={s.archive_url} target="_blank" rel="noopener" className={"btn btn-sm " + (showViewBtn ? "btn-ghost" : "btn-primary")} style={{ flex: showViewBtn ? "0 1 auto" : 1, textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <I.archive style={{ fontSize: 13 }} /> Snapshot
              </a>
            )}
            {s.original_url && (
              <a href={s.original_url} target="_blank" rel="noopener" className="btn btn-ghost btn-sm" style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <I.ext style={{ fontSize: 13 }} /> Live
              </a>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- full-viewport source lightbox ----------
   Click a source document in a citation card and it expands to fill the screen,
   right here in the app — no new tab, no lost place in the story. The real file
   renders through <SourceViewer> (an image you can zoom and pan, a PDF's pages
   with their text layer, the words of a text file), so you read the receipt at
   full size instead of squinting at a thumbnail. Every exit lands you back on
   the article untouched: the ✕, the Esc key, or a click on the dimmed margin.

   Self-contained: holds no app state beyond the source key it was opened with,
   locks the page scroll while open, and restores it on close. SourceViewer lives
   in the READ bundle (loaded before the reader renders), so by the time a reader
   can open this it's present; a stub message covers the vanishingly-rare race. */
function SourceLightbox({ srcKey, rec, onClose, keys, start, renderCited }) {
  // renderCited(key) is an optional host hook returning the passages this source
  // backs, as click-to-jump snippets shown under the document — so a reader can
  // hop back into the story without ever leaving the page (no new tab).
  // Gallery mode: opened with an ordered list of source keys, the sheet lets you
  // tab through every source at full size — the ‹ › buttons, the ← → arrow keys,
  // and an "n / total" counter. Opened with a lone srcKey (a citation card's
  // "View document"), it's a single document with no nav — unchanged from before.
  const list = Array.isArray(keys) ? keys.filter(Boolean) : null;
  const [idx, setIdx] = useState(() => {
    if (!list || !list.length) return 0;
    const want = typeof start === "number" ? start : list.indexOf(srcKey);
    return Math.min(list.length - 1, Math.max(0, want >= 0 ? want : 0));
  });
  const gallery = !!(list && list.length > 1);
  const activeKey = (list && list.length) ? list[Math.min(idx, list.length - 1)] : srcKey;
  const s = (list ? null : rec) || (window.NPJ && window.NPJ.SOURCES && window.NPJ.SOURCES[activeKey]) || null;
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  // step through the gallery, wrapping around at either end so it reads like a
  // slideshow of the receipts
  const go = useCallback((d) => { if (list && list.length) setIdx(i => (i + d + list.length) % list.length); }, [list]);
  useEffect(() => {
    // Esc closes (capture phase + stopPropagation so it beats the reader's own
    // Escape handlers); ← / → walk the gallery (but never while typing in a field
    // the viewer owns, e.g. the OCR editor); the body scroll is frozen so the
    // page behind can't drift.
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose && onClose(); return; }
      if (!gallery) return;
      const t = e.target, tag = (t && t.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    const onResize = () => setVh(window.innerHeight);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, gallery, go]);
  if (!s) return null;
  // the document fills the sheet; leave room for the header and a little air
  const bodyH = Math.max(280, vh - 150);
  return (
    <div className="srclb-scrim fade-in" role="dialog" aria-modal="true"
      aria-label={"Source — " + (s.title || s.id || "document")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="srclb" onMouseDown={(e) => e.stopPropagation()}>
        <header className="srclb-head">
          {gallery && (
            <button onClick={() => go(-1)} className="srclb-nav" title="Previous source (←)" aria-label="Previous source">‹</button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <SourceTag type={s.type} />
              {gallery && <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{idx + 1} / {list.length}</span>}
            </div>
            <div className="np-cond" style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.12, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || s.filename || "Document"}</div>
            <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}{s.outlet ? " · " + s.outlet : ""}</div>
          </div>
          {gallery && (
            <button onClick={() => go(1)} className="srclb-nav" title="Next source (→)" aria-label="Next source">›</button>
          )}
          <button onClick={onClose} className="btn btn-sm" title="Back to the article (Esc)" style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <I.x /> Close
          </button>
        </header>
        <div className="srclb-body np-scroll">
          {window.SourceViewer
            ? <window.SourceViewer key={activeKey || (s.id || s.key)} srcKey={activeKey} rec={s} height={bodyH} />
            : <div className="np-mono" style={{ padding: "48px 16px", textAlign: "center", color: "var(--ink-soft)", fontSize: 12 }}>Loading the document viewer…</div>}
          {(() => { const cited = renderCited ? renderCited(activeKey) : null; return cited ? <div className="srclb-cited">{cited}</div> : null; })()}
        </div>
      </div>
    </div>
  );
}

/* ---------- draft save-status pill (Newsroom) ----------
   One source of truth for "what is being saved, where, right now". Subscribes
   to NpjDrafts status events for this draft id and never claims more than is
   true: signed out (or after logout) it says "this browser only", and the
   hover tooltip spells out exactly which fields autosave and what survives
   a sign-out / browser wipe / device switch. */
function DraftStatusPill({ id, signedIn, user, what = "text, title and tags", style }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!window.NpjDrafts) return;
    return window.NpjDrafts.onStatus(s => { if (!s.id || s.id === id) setState(s.state); });
  }, [id]);
  const text =
    state === "saving" ? "saving…"
    : state === "syncing" ? "backing up to your account…"
    : state === "synced" ? "✓ saved · this browser + your account"
    : state === "error" ? "saved in this browser · account backup failed"
    : state === "localonly" ? "saved in this browser only" + (signedIn ? "" : " — sign in to back it up")
    : (signedIn ? "autosaves · this browser + your account" : "autosaves · this browser only");
  // colors track the newsroom theme via its --nr-* vars (the pill lives inside
  // .newsroom), so the status reads at AA contrast in both light and dark.
  const color = state === "error" ? "var(--nr-warn, #8a5e10)" : state === "synced" ? "var(--nr-ok, #1c6a45)" : "var(--nr-soft, #45402f)";
  const tip = signedIn
    ? "Everything in this draft — " + what + " — autosaves to this browser as you type, then backs up to your Matrix account (" + (user || "signed in") + ") a moment later. Sign out, wipe the browser or switch devices: the account copy survives."
    : "This draft autosaves to this browser as you type (" + what + ") — but it is NOT backed up to an account. Sign in with Matrix and it will be.";
  // Fixed footprint: the status text cycles through very different widths
  // ("saving…" → "backing up to your account…" → "✓ saved · this browser +
  // your account") on every autosave. A reserved width keeps those changes from
  // reflowing — and re-wrapping — the toolbar buttons to its right. Longer edge
  // states ellipsize; the full text always lives in the hover tooltip.
  return (
    <span className="np-mono" role="status" aria-live="polite" title={tip} style={{ display: "inline-block", boxSizing: "border-box", width: 276, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "middle", fontSize: 10.5, color, border: "1px solid var(--nr-line-strong, rgba(22,20,13,.44))", padding: "1px 6px", whiteSpace: "nowrap", cursor: "help", ...style }}>{text}</span>
  );
}

/* ---------- share bar: archive.org permalink + basic socials ---------- */
function ShareBar({ url, title, archiveUrl, dark = false }) {
  const [copied, setCopied] = useState(null);
  const u = encodeURIComponent(url || "");
  const au = encodeURIComponent(archiveUrl || url || "");
  const t = encodeURIComponent(title || "");
  const links = [
    ["X", `https://twitter.com/intent/tweet?url=${u}&text=${t}`],
    ["Bluesky", `https://bsky.app/intent/compose?text=${t}%20${u}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["Reddit", `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ["Email", `mailto:?subject=${t}&body=${au}`]
  ];
  const fg = dark ? "#d8d3c4" : "var(--ink)";
  const line = dark ? "rgba(255,255,255,.18)" : "var(--ink)";
  const copy = (text, key) => { navigator.clipboard && navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1400); };
  const pill = { fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em",
    border: "1.5px solid " + line, color: fg, background: "transparent", padding: "5px 11px", textDecoration: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: dark ? "rgba(216,211,196,.7)" : "var(--ink-soft)" }}>Permanent link</span>
        {/* a real wayback action (view or trigger a capture), not a copied string */}
        <a href={archiveUrl} target="_blank" rel="noopener" title="Open this page on archive.org" style={{ ...pill, background: dark ? "rgba(255,236,1,.12)" : "var(--yellow)", borderColor: dark ? "var(--yellow)" : "var(--ink)", color: dark ? "var(--yellow)" : "var(--ink)" }}>
          <I.archive style={{ fontSize: 14 }} /> archive.org snapshot
        </a>
        <button onClick={() => copy(url, "url")} style={pill}>{copied === "url" ? "Copied!" : <React.Fragment><I.ext style={{ fontSize: 13 }} /> Copy link</React.Fragment>}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: dark ? "rgba(216,211,196,.7)" : "var(--ink-soft)" }}>Share</span>
        {links.map(([label, href]) => (
          <a key={label} href={href} target="_blank" rel="noopener" style={pill}
            onMouseEnter={(e) => { e.currentTarget.style.background = dark ? "rgba(255,255,255,.1)" : "var(--ink)"; e.currentTarget.style.color = dark ? "#fff" : "var(--yellow)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = fg; }}>{label}</a>
        ))}
      </div>
    </div>
  );
}

/* ---------- published-image components (shared by the front page + reader) ----
   MediaImg picks the best URL for a published image (archive.org via the proxy
   first, the media store last) and renders it through CropFrame for a saved
   crop/fit. These live here, in the always-loaded core, because the front page
   paints cover photos through window.MediaImg before the article reader's
   (deferred) bundle has loaded. */
// Two-source image: try the live Matrix media-store copy first, fall back to
// the durable archive.org one (then any further candidates). Both URLs ride in
// the img block — see freezeArticleMedia (app/media-store.js).
//
// A media-store URL can't be loaded by a bare <img>: authenticated-media
// homeservers (Matrix 1.11+) reject an unauthenticated GET, so we resolve it
// through NpjMedia.resolveDisplay first — that fetches the bytes with the
// session token and hands back a blob: URL when signed in, or the original URL
// otherwise. Either way, if the candidate fails to paint, onError advances to
// the next one (the archive.org copy), so the image always loads from the
// media store when it can and from archive.org when it can't.
// A framed, cropped render that reproduces <image-slot>'s cover/contain/fill
// framing on the read side. The frame takes the author's saved aspect ratio
// (crop.ar) so the cover pan/zoom (s,x,y) lands exactly where it did in the
// editor, at any display width. Falls back to a plain object-fit while the
// natural dimensions aren't known yet. "Contain" is special-cased to hug the
// image at its natural ratio (see below) rather than letterboxing it.
function CropFrame({ src, alt, style, fit, crop, onError }) {
  const [nat, setNat] = useState(null);
  React.useEffect(() => { setNat(null); }, [src]);
  const f = fit || "cover";

  // "Contain" means show the WHOLE image. Unless the host pins a fixed height
  // (a front-page thumbnail does; the article hero/inline images don't), let the
  // box hug the image at its natural aspect ratio — centered, never wider than
  // the column — instead of letterboxing it into the editor frame's ratio, which
  // strands a portrait/odd-ratio photo in a wide box with empty side margins. The
  // border rides the image itself, so the frame adjusts to the image's size.
  const fixedH = style && style.height != null && style.height !== "auto" && style.height !== "";
  if (f === "contain" && !fixedH) {
    const { width, height, aspectRatio, objectFit, ...rest } = style || {};
    return (
      <img src={src} alt={alt || ""} loading="lazy"
        style={{ ...rest, display: "block", maxWidth: "100%", height: "auto", margin: "0 auto" }}
        onError={onError} />
    );
  }

  const ar = (crop && crop.ar) || (16 / 9);
  const wrap = { position: "relative", overflow: "hidden", width: "100%", aspectRatio: String(ar), display: "block", ...style };
  let imgStyle;
  if (f === "cover" && nat && nat.w && nat.h) {
    // same geometry as image-slot._applyView, with the frame normalised to
    // fw=ar, fh=1 (only the ratio matters — left/top/width/height are frame-%).
    const iw = nat.w, ih = nat.h, s = (crop && crop.s) || 1;
    const base = Math.max(ar / iw, 1 / ih), k = base * s;
    imgStyle = {
      position: "absolute", maxWidth: "none", transform: "translate(-50%,-50%)",
      width: (iw * k / ar * 100) + "%", height: (ih * k * 100) + "%",
      left: (50 + ((crop && crop.x) || 0)) + "%", top: (50 + ((crop && crop.y) || 0)) + "%",
    };
  } else {
    imgStyle = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: f === "fill" ? "fill" : (f === "contain" ? "contain" : "cover") };
  }
  return (
    <div style={wrap}>
      <img src={src} alt={alt || ""} loading="lazy" style={imgStyle}
        onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
        onError={onError} />
    </div>
  );
}

// Ordered URLs to try for a published image. archive.org is the canonical home
// for published media, and every public page loads it THROUGH the proxy first,
// so images render even on a network that can't reach archive.org directly
// (e.g. behind a VPN that blocks it). The direct archive.org URL is the only
// fallback. The Matrix media-store URL is auth-gated and pins the author's
// homeserver, so it is NEVER requested on a public page — it rides along only
// as a last resort for an image that somehow has no archive.org copy at all
// (publish normally guarantees one), so the slot isn't left blank. De-duped,
// order preserved.
function imageCandidates(srcs) {
  const cdn = window.NpjArchiveCDN;
  const raw = (srcs || []).filter(Boolean);
  const archive = [], rest = [];
  raw.forEach(u => { (cdn && cdn.isMediaUrl && cdn.isMediaUrl(u)) ? archive.push(u) : rest.push(u); });
  const out = [];
  archive.forEach(u => {
    const p = cdn && cdn.proxied && cdn.proxied(u);
    if (p && p !== u) out.push(p); // proxy first — reaches archive.org for the reader
    out.push(u);                   // direct archive.org — the fallback
  });
  if (!out.length) rest.forEach(u => out.push(u)); // no archive.org copy → media-store, last resort
  return out.filter((u, i) => u && out.indexOf(u) === i);
}

function MediaImg({ srcs, alt, style, fit, crop }) {
  const list = imageCandidates(srcs);
  const [i, setI] = useState(0);
  const [resolved, setResolved] = useState(null);
  const idx = Math.min(i, Math.max(0, list.length - 1));
  const cur = list[idx];
  React.useEffect(() => {
    let alive = true, made = null;
    setResolved(null);
    if (!cur) return;
    const isStore = window.NpjMedia && window.NpjMedia.isStoreUrl(cur);
    if (isStore && window.NpjMedia.resolveDisplay) {
      window.NpjMedia.resolveDisplay(cur).then(u => {
        if (!alive) { if (u && u !== cur && u.indexOf("blob:") === 0) URL.revokeObjectURL(u); return; }
        if (u && u !== cur && u.indexOf("blob:") === 0) made = u;
        setResolved(u || cur);
      }).catch(() => { if (alive) setResolved(cur); });
    } else {
      setResolved(cur);
    }
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [cur]);
  if (!list.length) return null;
  // while an authenticated store fetch is in flight, hold a neutral placeholder
  // rather than flashing a doomed unauthenticated <img> request
  if (resolved == null) return <div style={{ ...style, background: "var(--paper-2)" }} aria-hidden="true" />;
  const onError = () => setI(n => (n < list.length - 1 ? n + 1 : n));
  // a saved crop (or a non-cover fit) renders through CropFrame — aspect-locked
  // for cover/fill, hugged to the image's natural ratio for contain
  if ((crop && crop.ar) || fit === "contain" || fit === "fill") {
    return <CropFrame src={resolved} alt={alt} style={style} fit={fit} crop={crop} onError={onError} />;
  }
  return <img src={resolved} alt={alt || ""} loading="lazy" style={style} onError={onError} />;
}

// ── Fullscreen photo viewer (GLightbox) ───────────────────────────────────
// Any published photo opens edge-to-edge and zoomable — which is how a WIDE
// image is actually read: the inline figure shows the whole frame, and a click
// blows it up to full resolution with pinch / scroll zoom. One library
// (window.GLightbox, vendored) instead of a hand-rolled overlay.
//
// The href is the same public candidate the inline <img> resolves to — the
// proxied archive.org copy first (loads even on a network that can't reach
// archive.org directly), the direct archive.org URL next. A markdown credit
// ([label](url)) is flattened to its label for the caption line.
function lightboxHref(im) {
  if (!im) return "";
  const c = imageCandidates([im.src, im.store]);
  return c[0] || im.src || im.store || "";
}
function lightboxCaption(im) {
  if (!im) return "";
  const credit = String(im.credit || "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  return [im.caption, credit && ("— " + credit)].filter(Boolean).join(" ");
}
function openLightbox(images, start) {
  if (!window.GLightbox) return false;
  const elements = (images || []).map((im) => ({
    href: lightboxHref(im), type: "image",
    alt: (im && (im.description || im.caption)) || "",
    description: lightboxCaption(im) || undefined,
  })).filter((e) => e.href);
  if (!elements.length) return false;
  const lb = window.GLightbox({
    elements, startAt: Math.max(0, Math.min(start || 0, elements.length - 1)),
    loop: elements.length > 1, touchNavigation: true, zoomable: true,
    openEffect: "fade", closeEffect: "fade", moreLength: 0,
  });
  // GLightbox fires "close" as it tears down; destroy after the fade so each
  // open doesn't leave a stale instance behind (the modal DOM is already gone).
  lb.on("close", () => { setTimeout(() => { try { lb.destroy(); } catch (e) {} }, 350); });
  lb.open();
  return true;
}

// A single published photo that opens the fullscreen viewer on click/Enter.
// Wraps MediaImg so the inline render (cover/contain/crop) is unchanged; only
// the click-to-zoom affordance is added. Used by the reader's inline images and
// the lifted hero — never the editor, where the live <image-slot> owns clicks.
function ZoomImg({ image, alt, style }) {
  if (!image) return null;
  return (
    <button type="button" className="npj-zoom" aria-label={(alt || image.caption || "Photo") + " — view full size"}
      onClick={() => openLightbox([image], 0)}>
      <MediaImg srcs={[image.store, image.src]} alt={alt} fit={image.fit} crop={image.crop} style={style} />
    </button>
  );
}

// ── In-article carousel (Splide) ──────────────────────────────────────────
// A {type:'gallery'} block → a swipeable, keyboard-navigable carousel. Each
// slide shows the WHOLE photo (object-fit: contain on a uniform stage, so a
// wide panorama and a tall portrait both sit un-cropped) and opens the
// fullscreen viewer on click. Splide owns arrows / dots / drag / touch.
//
// The Splide-managed subtree is isolated behind React.memo (keyed on the slide
// srcs). ArticleRead re-renders on every hover/selection, and React must NOT
// reconcile the DOM Splide owns — the cloned loop slides it never sees, the
// is-active classes and drag transforms it toggles — or it would reset Splide's
// state on each of those renders. So the track mounts once and React leaves it
// be. Clicks are delegated on the root and read data-cidx off the (possibly
// cloned) slide, so the right photo opens even from a loop clone.
const CarouselTrack = React.memo(function CarouselTrack({ imgs }) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || imgs.length < 1) return;
    // splide-core hides .splide until JS initialises it. If the library never
    // loaded (script blocked), reveal the slides as a plain horizontal scroll
    // instead of leaving an invisible block.
    if (!window.Splide) { root.classList.add("npj-carousel--raw"); return; }
    const multi = imgs.length > 1;
    const sp = new window.Splide(root, {
      type: multi ? "loop" : "fade", rewind: !multi, perPage: 1, perMove: 1,
      arrows: multi, pagination: multi, drag: multi, keyboard: "focused",
      speed: 450, slideFocus: true, label: "Image gallery",
    });
    sp.mount();
    return () => { try { sp.destroy(true); } catch (e) {} };
  }, []); // mount once — imgs is stable for this instance (the memo key below)
  const onClick = (e) => {
    const t = e.target.closest && e.target.closest("[data-cidx]");
    if (!t) return;
    e.preventDefault();
    openLightbox(imgs, parseInt(t.getAttribute("data-cidx"), 10) || 0);
  };
  return (
    <div className="splide npj-carousel" ref={ref} onClick={onClick}>
      <div className="splide__track">
        <ul className="splide__list">
          {imgs.map((im, i) => {
            const cap = lightboxCaption(im);
            return (
              <li className="splide__slide" key={i}>
                <button type="button" className="npj-carousel-slide" data-cidx={i}
                  aria-label={(im.description || im.caption || ("Image " + (i + 1))) + " — view full size"}>
                  {/* plain contained <img> (no crop/fit routing) so every slide
                      sits whole on a uniform stage — wide or tall, never cropped */}
                  <MediaImg srcs={[im.store, im.src]} alt={im.description || im.caption || ""}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                </button>
                {cap ? <figcaption className="npj-carousel-slidecap np-mono">{cap}</figcaption> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="npj-carousel-count np-mono" aria-hidden="true">{imgs.length} photos</div>
    </div>
  );
}, (a, b) => a.ckey === b.ckey);

function Carousel({ images, caption, style }) {
  const imgs = (images || []).filter((im) => im && (im.src || im.store));
  if (!imgs.length) return null;
  const ckey = imgs.map((im) => im.src || im.store).join("|");
  return (
    <figure className="npj-carousel-fig" style={style}>
      <CarouselTrack imgs={imgs} ckey={ckey} />
      {caption ? <figcaption className="npj-carousel-cap">{caption}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { I, SRC_TYPE, fmtDate, shortDate, Handle, npjPerson, npjRichText, Byline, ContributorChip, SourceTag, SourceCard, SourceLightbox, ShareBar, DraftStatusPill, npjSiteBase, npjArticleUrl, npjArticleRawUrl, npjArticleLogUrl,
  MediaImg, CropFrame, imageCandidates, Carousel, ZoomImg, openLightbox });
