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

/* ---------- the source hover/click card ---------- */
function SourceCard({ srcKey, onClose, pinned, quote }) {
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
        {cited ? (
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
        ) : (archived || s.original_url) ? (
          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
            {archived && (
              <a href={s.archive_url} target="_blank" rel="noopener" className="btn btn-primary btn-sm" style={{ flex: 1, textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
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
    : state === "localonly" ? "saved in this browser only"
    : (signedIn ? "autosaves · this browser + your account" : "autosaves · this browser only");
  // colors track the newsroom theme via its --nr-* vars (the pill lives inside
  // .newsroom), so the status reads at AA contrast in both light and dark.
  const color = state === "error" ? "var(--nr-warn, #8a5e10)" : state === "synced" ? "var(--nr-ok, #1c6a45)" : "var(--nr-soft, #45402f)";
  const tip = signedIn
    ? "Everything in this draft — " + what + " — autosaves to this browser as you type, then backs up to your Matrix account (" + (user || "signed in") + ") a moment later. Sign out, wipe the browser or switch devices: the account copy survives."
    : "This draft autosaves to this browser as you type (" + what + ") — but it is NOT backed up to an account. Sign in with Matrix and it will be.";
  return (
    <span className="np-mono" role="status" aria-live="polite" title={tip} style={{ fontSize: 10.5, color, border: "1px solid var(--nr-line-strong, rgba(22,20,13,.44))", padding: "1px 6px", whiteSpace: "nowrap", cursor: "help", ...style }}>{text}</span>
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

Object.assign(window, { I, SRC_TYPE, fmtDate, shortDate, Handle, npjPerson, npjRichText, Byline, ContributorChip, SourceTag, SourceCard, ShareBar, DraftStatusPill, npjSiteBase, npjArticleUrl, npjArticleRawUrl, npjArticleLogUrl });
