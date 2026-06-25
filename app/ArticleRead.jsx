/* NPJ article reading experience — the spine.
   Clean Read / Audit Mode + 3 evidence layouts (Ledger / Receipts / Split).
   Articles arrive as folded EO event logs (app/articles.js); the body block
   shapes rendered here are exactly what the log carries. */

// The caption + photo credit under an image. The credit is markdown ([label](url))
// like a contributor bio, rendered through npjRichText so a [outlet](https://…)
// becomes a safe, sanitized link — never raw innerHTML.
function PhotoFigCaption({ caption, credit }) {
  if (!caption && !credit) return null;
  return (
    <figcaption className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.45 }}>
      {caption ? <span>▢ {caption}</span> : null}
      {credit ? (
        <span style={{ display: caption ? "block" : "inline", marginTop: caption ? 2 : 0 }}>
          <span className="np-eyebrow" style={{ fontSize: 9.5, letterSpacing: ".05em", marginRight: 5 }}>Credit</span>
          {window.npjRichText ? window.npjRichText(credit) : credit}
        </span>
      ) : null}
    </figcaption>
  );
}

// A source key always resolves to SOMETHING renderable, even if the global
// ledger is missing the record (a torn log line, a stale cache) — a hole in
// the ledger must never take the whole article down with it.
function srcOf(key) {
  return window.NPJ.SOURCES[key] || { id: key, type: "primary", title: key, outlet: "", retrieved: "", archive_url: "", original_url: "" };
}

/* ---- the transparency lens: colour every grounded span by HOW it's grounded ----
   The reader (and the editor's Preview) can switch on a lens that tints each
   claim by its grounding kind, using the SAME vocabulary as the editor's
   Grounding workspace (app/GroundingWorkspace.jsx — proseShade / pillFor): a
   yellow fill for a grounded/cited claim (⊤, or ⊨ for more than one source),
   violet for a claim the author owns (analysis ⊢ / account ⊨ / position ⊩),
   orange + dashed for one that still needs a source (⊥), red for sources that
   disagree (¬). Colours + glyphs match styles.css (.ground-lens …). */
const GROUND_KINDS = {
  grounded:        { glyph: "⊤", label: "Grounded",              color: "#d8c520", mark: "#9a8500", note: "Pinned to a source passage that backs it." },
  multi:           { glyph: "⊨", label: "Multiple sources",      color: "#d8c520", mark: "#9a8500", note: "Backed by more than one pinned source." },
  "own-analysis":  { glyph: "⊢", label: "The author's analysis", color: "#7C74DE", mark: "#6b5bd6", note: "Owned reasoning — grounded by declaration, not a citation." },
  "own-account":   { glyph: "⊨", label: "The author's account",  color: "#7C74DE", mark: "#6b5bd6", note: "First-hand: the author witnessed this." },
  "own-position":  { glyph: "⊩", label: "The author's position", color: "#7C74DE", mark: "#6b5bd6", note: "The author's stated position." },
  absence:         { glyph: "∅", label: "Documented void",       color: "#4D7EA8", mark: "#3a6488", note: "An absence the author asserts — removed, withheld, silent, inaccessible, unrecorded or ambient. The mark and hover say which kind, and whether it is shown, located, or only inferred." },
  needs:           { glyph: "⊥", label: "Needs a source",        color: "#D8632E", mark: "#b5701b", note: "Bound to a source but no passage pinned — the publish gate flags this." },
  conflict:        { glyph: "¬", label: "Sources disagree",      color: "#D8412C", mark: "#b3261e", note: "Two pinned quotes pull opposite ways." }
};
const GROUND_ORDER = ["grounded", "multi", "own-analysis", "own-account", "own-position", "absence", "needs", "conflict"];
const STANCE_KIND = { analysis: "own-analysis", testimony: "own-account", voice: "own-position", absence: "absence" };
// The grounding kind of a claim token, read the same mechanical way the
// workspace's statusOf does — owned (by its declared stance), else by how many
// of its sources carry a pinned quote (none → needs, one → grounded, more →
// multi). No model, no guess; just the token's own grounding.
function groundKind(claim) {
  if (!claim) return null;
  if (claim.stance) return STANCE_KIND[claim.stance] || "own-analysis";
  const q = claim.q || {};
  const pinned = (claim.src || []).filter(k => q[k] && String(q[k]).trim());
  if (!pinned.length) return "needs";
  return pinned.length > 1 ? "multi" : "grounded";
}

function useClaimModel(A) {
  return React.useMemo(() => {
    const claimList = [];
    const sourceNums = new Map();
    let n = 0;
    const scan = (t) => {
      if (t && t.c && Array.isArray(t.src)) {
        t.src.forEach(k => { if (!sourceNums.has(k)) sourceNums.set(k, ++n); });
        claimList.push({ id: t.id, text: t.c, src: t.src, q: t.q || null, num: t.src.map(k => sourceNums.get(k)).join(", ") });
      }
    };
    (A.body || []).forEach(b => {
      (b.tokens || []).forEach(scan);
      (b.items || []).forEach(it => it.forEach(scan)); // claims inside lists count too
    });
    const claimById = Object.fromEntries(claimList.map(c => [c.id, c]));
    const sourceList = [...sourceNums.entries()].map(([key, num]) => ({
      key, num, claims: claimList.filter(c => c.src.includes(key)).map(c => c.id)
    }));
    return { claimList, claimById, sourceNums, sourceList };
  }, [A]);
}

/* A source's cited passages, as clickable snippets — click one to scroll to
   that exact span in the article and flash it. Reused by the hover card, the
   ledger, the evidence panel and the methods footer. */
function snippet(text, max = 96) {
  const t = String(text || "").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
function CitedSpanList({ claims, onJump, currentId }) {
  if (!claims || !claims.length) return null;
  return (
    <div>
      {claims.map(c => (
        <button key={c.id} className="cite-span" data-current={c.id === currentId ? "1" : "0"}
          onClick={() => onJump(c.id)} title="Jump to this passage in the article">
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)", flex: "0 0 auto" }}>↳</span>
          <span style={{ fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.3, color: "var(--ink)" }}>“{snippet(c.text)}”</span>
        </button>
      ))}
    </div>
  );
}

/* ---- source citation card ---- */
// On a pointer device this floats next to the hovered claim. On a phone there's
// no hover and no room to pin a card to a tapped word, so it opens instead as a
// dismissible bottom sheet (tap the backdrop or ✕ to close) — thumb-reachable
// and full-width, which is how a touch reader actually opens the receipts.
function HoverCard({ data, onEnter, onLeave, onSuggest, onClose, suggCount, spansForSource, onJump, preview, onExpand }) {
  // Hooks first, before any early return, so the hook order is stable whether
  // or not a claim is being hovered (data toggles null↔set on hover).
  const [tab, setTab] = useState(0);
  const isPhone = window.useIsMobile(760);
  React.useEffect(() => setTab(0), [data && data.claim && data.claim.id]);
  if (!data) return null;
  const { claim, x, y, srcKeys } = data;
  const vw = window.innerWidth, vh = window.innerHeight;
  // the other passages this same source backs — so you can hop between them
  const spans = spansForSource ? spansForSource(srcKeys[tab]) : [];

  const sheet = isPhone;
  // never wider than the viewport (340 on a phone overflows the right edge)
  const w = sheet ? "100%" : Math.min(340, vw - 24);
  const left = sheet ? 0 : Math.min(Math.max(12, x), vw - w - 12);
  const top = y + 8;
  const flip = !sheet && top > vh - 260;
  const cardStyle = sheet
    ? { left: 0, right: 0, bottom: 0, top: "auto", width: "100%", maxHeight: "72vh", overflowY: "auto",
        borderWidth: "1.5px 0 0", boxShadow: "0 -10px 30px rgba(8,7,5,.4)" }
    : { left, top: flip ? "auto" : top, bottom: flip ? vh - y + 14 : "auto", width: w };

  const inner = (
    <div className="srccard np-scroll" role="dialog" aria-label="Citation for this claim"
      style={cardStyle}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave}>
      {sheet && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderBottom: "1.5px solid var(--ink)",
          position: "sticky", top: 0, background: "var(--card)", zIndex: 1 }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)", flex: 1, display: "inline-flex", alignItems: "center", gap: 6 }}><I.source style={{ fontSize: 14 }} /> Citation</span>
          <button onClick={onClose} aria-label="Close citation" style={{ background: "none", border: 0, fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--ink)", padding: "2px 6px" }}><I.x /></button>
        </div>
      )}
      {srcKeys.length > 1 && (
        <div style={{ display: "flex", borderBottom: "1.5px solid var(--ink)" }}>
          {srcKeys.map((k, i) => (
            <button key={k} onClick={() => setTab(i)} className="np-mono" style={{ flex: 1, fontSize: 10, padding: "4px 6px",
              border: 0, borderRight: i < srcKeys.length - 1 ? "1px solid var(--rule)" : 0,
              background: tab === i ? "var(--yellow)" : "var(--card)", fontWeight: 600 }}>{srcOf(k).id}</button>
          ))}
        </div>
      )}
      <SourceCard srcKey={srcKeys[tab]} quote={claim.q && claim.q[srcKeys[tab]]} preview={preview} onExpand={onExpand} />
      {spans.length > 1 && (
        <div style={{ borderTop: "1.5px solid var(--ink)", maxHeight: 124, overflowY: "auto" }} className="np-scroll">
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", padding: "7px 10px 1px" }}>Backs {spans.length} passages — {sheet ? "tap" : "click"} to jump</div>
          <CitedSpanList claims={spans} onJump={onJump} currentId={claim.id} />
        </div>
      )}
      {/* Suggest-edit is a reader action; preview is a look-only render of the
         draft (no feedback rail behind it), so the card drops the action there
         and shows just the grounding receipts. */}
      {!preview && (
        <div style={{ display: "flex", borderTop: "1.5px solid var(--ink)", position: sheet ? "sticky" : "static", bottom: 0, background: "var(--card)" }}>
          <button onClick={() => onSuggest(claim.id)} className="np-cond" style={{ flex: 1, padding: sheet ? "13px" : "8px", border: 0, background: "var(--card)",
            fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--mono)" }}>⊨</span> Suggest edit{suggCount ? ` · ${suggCount} open` : ""}
          </button>
        </div>
      )}
    </div>
  );

  if (!sheet) return inner;
  return (
    <React.Fragment>
      <div onClick={onClose} aria-hidden="true" className="fade-in"
        style={{ position: "fixed", inset: 0, zIndex: 3990, background: "rgba(8,7,5,.35)" }} />
      {inner}
    </React.Fragment>
  );
}

// The Substack footnote experience: hover a marker on the desktop (or tap it on a
// phone) and the note pops up right there, so you read it without losing your
// place. The note text still has its permanent home in the "Notes" endnotes —
// this card is the inline preview, with a link down to it. Mirrors HoverCard's
// positioning (anchored under the marker; a bottom sheet on a phone).
function FootnotePop({ data, onEnter, onLeave, onClose, onJump }) {
  const isPhone = window.useIsMobile(760);
  if (!data) return null;
  const { num, text, x, y } = data;
  const vw = window.innerWidth, vh = window.innerHeight;
  const sheet = isPhone;
  const w = sheet ? "100%" : Math.min(340, vw - 24);
  const left = sheet ? 0 : Math.min(Math.max(12, x - 16), vw - (typeof w === "number" ? w : 340) - 12);
  const top = y + 8;
  const flip = !sheet && top > vh - 220;
  const cardStyle = sheet
    ? { left: 0, right: 0, bottom: 0, top: "auto", width: "100%", maxHeight: "60vh", overflowY: "auto",
        borderWidth: "1.5px 0 0", boxShadow: "0 -10px 30px rgba(8,7,5,.4)" }
    : { left, top: flip ? "auto" : top, bottom: flip ? vh - y + 14 : "auto", width: w };
  const inner = (
    <div className="fnpop np-scroll" role="dialog" aria-label={"Footnote " + num} style={cardStyle}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="fnpop-h">
        <span className="np-mono fnpop-n">{num}</span>
        <span className="np-eyebrow" style={{ flex: 1, color: "var(--ink-soft)" }}>Note</span>
        {sheet && <button onClick={onClose} aria-label="Close note" style={{ background: "none", border: 0, fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--ink)", padding: "0 2px" }}><I.x /></button>}
      </div>
      <div className="fnpop-b">
        {text ? (window.npjRichText ? window.npjRichText(text) : text) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
      </div>
      <button className="fnpop-jump np-mono" onClick={onJump}>See in Notes ↓</button>
    </div>
  );
  if (!sheet) return inner;
  return (
    <React.Fragment>
      <div onClick={onClose} aria-hidden="true" className="fade-in"
        style={{ position: "fixed", inset: 0, zIndex: 3990, background: "rgba(8,7,5,.35)" }} />
      {inner}
    </React.Fragment>
  );
}

// MediaImg / CropFrame / imageCandidates moved to app/shared.jsx (eager): the
// front page renders cover photos through window.MediaImg before the reader
// bundle loads, so the image components must exist in the always-loaded core.
// They are referenced below as globals (same names), unchanged in behaviour.

// An embedded media block: the EO log only stores the URL, so the reader
// rebuilds the player from it — a YouTube/Vimeo iframe, a native <video> or
// <audio> for direct media files, or (for anything we don't recognize) the
// link card, since the committed artifact is always the URL itself.
function EmbedFigure({ url, caption }) {
  const u = String(url || "");
  let host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  const vm = u.match(/vimeo\.com\/(\d+)/);
  let media = null;
  if (yt) media = <iframe src={"https://www.youtube-nocookie.com/embed/" + yt[1]} title={caption || "embedded video"} style={{ width: "100%", aspectRatio: "16 / 9", border: 0, display: "block" }} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />;
  else if (vm) media = <iframe src={"https://player.vimeo.com/video/" + vm[1]} title={caption || "embedded video"} style={{ width: "100%", aspectRatio: "16 / 9", border: 0, display: "block" }} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen loading="lazy" />;
  else if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) media = <video controls preload="metadata" src={u} style={{ width: "100%", maxHeight: 460, background: "#000", display: "block" }} />;
  else if (/\.(mp3|ogg|wav|m4a)(\?|$)/i.test(u)) media = <audio controls preload="metadata" src={u} style={{ width: "100%" }} />;
  if (media) return (
    <figure style={{ margin: "26px 0" }}>
      <div style={{ border: "1.5px solid var(--ink)", background: "#000", lineHeight: 0 }}>{media}</div>
      {caption && <figcaption className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.45 }}>▶ {caption}</figcaption>}
    </figure>
  );
  return (
    <figure style={{ margin: "24px 0", border: "1.5px solid var(--ink)", background: "var(--card)", padding: "12px 14px" }}>
      <a href={u} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 12.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>↗ {host || u}</a>
      {caption && <figcaption className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 5 }}>{caption}</figcaption>}
    </figure>
  );
}

function ArticleRead(props) {
  const { audit, setAudit, showSugg, setShowSugg,
          suggestions = [], onVote, onResolve, onReply, onMerge, onAddSuggestion, filter, setFilter,
          me, onHome, onNewsroom, onEdited,
          // Preview mode: render a draft EXACTLY as the public reader will, from a
          // prebuilt article object (the editor's live content folded through the
          // very same publish pipeline). Same Header + Body the reader uses, just
          // dropped on the paper page with a Close affordance — no masthead,
          // control bar, evidence rails or modals.
          preview, previewArticle, onClose } = props;
  const { entityData, entityOpen, setEntityOpen, activeEntity, setActiveEntity } = props;
  const A = preview ? (previewArticle || { body: [] }) : window.NPJ.ARTICLE;
  const { isAdmin } = React.useContext(window.LayoutCtx);
  const { claimList, claimById, sourceNums, sourceList } = useClaimModel(A);
  // the transparency lens — colour each claim by how it's grounded. Local to this
  // reader instance, so the live page and the editor's Preview each carry their
  // own. Off by default: a clean read.
  const [transparency, setTransparency] = useState(false);
  // a count per grounding kind, for the lens legend
  const groundTally = React.useMemo(() => {
    const tally = {};
    const bump = (k) => { if (k) tally[k] = (tally[k] || 0) + 1; };
    const scan = (t) => {
      if (!t || t.c == null) return;
      if (t.stance) bump(STANCE_KIND[t.stance] || "own-analysis");
      else if (Array.isArray(t.src) && t.src.length) bump(groundKind({ src: t.src, q: t.q }));
    };
    (A.body || []).forEach(b => { (b.tokens || []).forEach(scan); (b.items || []).forEach(it => it.forEach(scan)); });
    return tally;
  }, [A]);
  const [hover, setHover] = useState(null);
  const [activeSrc, setActiveSrc] = useState(null);
  // a source document, expanded to fill the screen (in-app, never a new tab).
  // Holds the source key being viewed; null when closed. Opening it also dismisses
  // the floating hover card so there's nothing lingering behind the lightbox.
  const [lightbox, setLightbox] = useState(null);
  const openLightbox = useCallback((key) => { setLightbox(key); setHover(null); setActiveSrc(null); }, []);
  // footnotes, keyed for the inline hover/tap preview (the Substack feel)
  const [fnPop, setFnPop] = useState(null);
  const fnLeaveTimer = useRef(null);
  const footnoteByKey = React.useMemo(() => {
    const m = {};
    (A.body || []).forEach(b => { if (b.type === "footnotes") (b.notes || []).forEach(n => { if (n && n.key) m[n.key] = n; }); });
    return m;
  }, [A.body]);
  // span feedback: a compose draft pinned to a span ({ quote, anchor, kind }),
  // and the floating select-to-suggest bubble ({ x, y, range, claimId })
  const [compose, setCompose] = useState(null);
  const [bubble, setBubble] = useState(null);
  const bodyRef = useRef(null);
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [editing, setEditing] = useState(false);
  // the Contents outline is a disclosure: collapsed by default, expand to jump
  const [tocOpen, setTocOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState(null);
  const [reverting, setReverting] = useState(null);   // sha being restored | "undo" | null
  const [revertErr, setRevertErr] = useState(null);
  // below this width the source rail stacks under the article instead of
  // squeezing the reading column
  const isNarrow = window.useIsMobile(900);
  // a true phone: the side rails overlay the page (rather than pushing the
  // reading column off-screen), and tapping a claim opens its citation as a
  // bottom sheet, since there's no hover on touch
  const isPhone = window.useIsMobile(760);
  // edit-after-publish: the admin always; otherwise only the article's
  // assignees (the publisher is one by default — see genesisFromContent)
  const canEditArticle = isAdmin || (Array.isArray(A.assignees) && A.assignees.includes(me));
  const leaveTimer = useRef(null);
  const artSlug = (s) => "h-" + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const headings = (A.body || []).filter(b => b.type === "h2" || b.type === "h3").map(b => ({ id: artSlug(b.text), text: b.text, level: b.type === "h2" ? 2 : 3 }));
  // scrollIntoView walks to the element's actual scroll container — the window
  // in the live read, but the fixed overlay in Preview — so it moves the page
  // the reader is looking at, not whatever's behind it. The headings carry
  // scrollMarginTop: 90, so block:"start" leaves room under the masthead.
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const artVersions = A.versions && A.versions.length ? A.versions : [{ sha: A.base_sha || "v1", ts: A.published, author: (A.authors || [])[0], message: "Published", headline: A.headline || "", dek: A.dek || "", text: window.NPJ.articlePlainText() }];

  const showMarkers = audit;
  const openByClaim = {};
  suggestions.forEach(s => { if (s.status === "proposed" || s.status === "review") openByClaim[s.claimId] = (openByClaim[s.claimId] || 0) + 1; });

  const enterClaim = useCallback((e, claim) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ claim, x: r.left, y: r.bottom, srcKeys: claim.src });
    setActiveSrc(claim.src[0]);
  }, []);
  const scheduleLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => { setHover(null); setActiveSrc(null); }, 160);
  }, []);
  const cancelLeave = useCallback(() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  // footnote preview: hover (desktop) or tap (phone) a marker → the note floats
  // up next to it; leaving hides it after a beat so a slide into the card keeps
  // it open. A click still jumps down to the note's home in the endnotes.
  const enterFn = useCallback((e, key) => {
    const n = footnoteByKey[key]; if (!n) return;
    if (fnLeaveTimer.current) clearTimeout(fnLeaveTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    setFnPop({ key, num: n.num, text: n.text, x: r.left, y: r.bottom });
  }, [footnoteByKey]);
  const scheduleFnLeave = useCallback(() => {
    if (fnLeaveTimer.current) clearTimeout(fnLeaveTimer.current);
    fnLeaveTimer.current = setTimeout(() => setFnPop(null), 160);
  }, []);
  const cancelFnLeave = useCallback(() => { if (fnLeaveTimer.current) clearTimeout(fnLeaveTimer.current); }, []);
  const jumpToFn = useCallback((key) => {
    setFnPop(null);
    const el = document.getElementById("fn-" + key);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // every passage a given source backs (newest model: sourceList carries the
  // claim ids; claimById carries each span's text) — drives the click-to-jump
  // lists in the hover card, ledger, evidence panel and methods footer
  const spansForSource = useCallback((key) => {
    const e = sourceList.find(s => s.key === key);
    return e ? e.claims.map(id => claimById[id]).filter(Boolean) : [];
  }, [sourceList, claimById]);
  // scroll to a claim span in the body and flash it
  const jumpToClaim = useCallback((id) => {
    setHover(null); setActiveSrc(null);
    const el = document.getElementById("claim-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("claim-flash"); void el.offsetWidth; el.classList.add("claim-flash");
    setTimeout(() => el.classList.remove("claim-flash"), 1800);
  }, []);

  // Open the composer pinned to a bound claim (from the hover card) — the whole
  // claim span is the anchor, by its stable id.
  const startCompose = (claimId, kind) => {
    const claim = claimById[claimId];
    if (!claim) return;
    setCompose({ quote: claim.text, anchor: window.NpjFeedback.anchorFromClaim(claim), kind: kind || "suggestion" });
    setShowSugg(true); setHover(null); setBubble(null);
  };

  // ---- select-to-suggest: pick any words in the story → a floating bubble ----
  const closestClaimId = (node) => {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    el = el && el.closest ? el.closest(".claim") : null;
    return el && el.id && el.id.indexOf("claim-") === 0 ? el.id.slice(6) : null;
  };
  const refreshBubble = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !bodyRef.current) { setBubble(null); return; }
    const r = sel.getRangeAt(0);
    if (!bodyRef.current.contains(r.commonAncestorContainer) || r.toString().trim().length < 2) { setBubble(null); return; }
    const rect = r.getBoundingClientRect();
    setBubble({ x: rect.left + rect.width / 2, y: rect.top, range: r.cloneRange(), claimId: closestClaimId(r.commonAncestorContainer) });
  }, [claimById]);
  const openComposeFromBubble = (kind) => {
    if (!bubble) return;
    const anchor = window.NpjFeedback.makeAnchor(bodyRef.current, bubble.range, bubble.claimId);
    if (!anchor) { setBubble(null); return; }
    setCompose({ quote: bubble.range.toString(), anchor, kind });
    setShowSugg(true); setBubble(null);
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
  };
  // dismiss the bubble on a fresh click elsewhere or on scroll
  useEffect(() => {
    if (!bubble) return;
    const down = (e) => { if (!e.target.closest || !e.target.closest(".fb-bubble")) setBubble(null); };
    window.addEventListener("scroll", () => setBubble(null), { passive: true, once: true });
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [bubble]);

  // paint every open suggestion's span into the prose (Google-Docs feel), and
  // re-locate them whenever the feedback list or the audit DOM changes
  useEffect(() => {
    if (!bodyRef.current || !window.NpjFeedback) return;
    const t = setTimeout(() => {
      const anchors = (suggestions || [])
        .filter(s => (s.status === "proposed" || s.status === "review") && s.anchor)
        .map(s => s.anchor);
      window.NpjFeedback.paintAnchors(bodyRef.current, anchors);
    }, 60);
    return () => { clearTimeout(t); window.NpjFeedback.clearAnchors(); };
  }, [suggestions, audit]);

  // Esc leaves the preview overlay (no-op in the normal reader)
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);

  const showInText = (s) => { if (s && s.anchor && bodyRef.current) window.NpjFeedback.flash(bodyRef.current, s.anchor); };

  // admin-only: unpublish (hide everywhere but admin) or republish. Appends one
  // REC{status} to the log — nothing is deleted — then refolds via onEdited so
  // the reader and front page reflect the change immediately.
  const changeStatus = async (next) => {
    setStatusErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setStatusErr("Sign in with Matrix to manage publication — the webhook re-verifies the token server-side."); return; }
    if (next === "unpublished" && !window.confirm("Unpublish “" + A.headline + "”?\n\nIt will be hidden from the site for everyone but admins. The event log stays in GitHub — you can republish anytime.")) return;
    setStatusBusy(true);
    let out;
    try {
      out = await window.NpjArticles.setArticleStatus({ slug: A.slug, status: next, actor: me, token });
    } catch (e) {
      setStatusBusy(false);
      setStatusErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
      return;
    }
    if (out.res.status === 401 || out.res.status === 403) { setStatusBusy(false); setStatusErr("Rejected (" + out.res.status + ") — that Matrix account isn't authorized."); return; }
    if (!out.res.ok) { setStatusBusy(false); setStatusErr("The webhook answered HTTP " + out.res.status + " — nothing changed."); return; }
    const ts = new Date().toISOString();
    const updated = {
      ...A, status: next, updated: ts.slice(0, 10), base_sha: out.sha,
      versions: [{ sha: out.sha, ts, author: me, message: next === "unpublished" ? "Unpublished" : "Republished", headline: A.headline || "", dek: A.dek || "", text: window.NPJ.articlePlainText() }, ...(A.versions || [])]
    };
    setStatusBusy(false);
    if (onEdited) onEdited(updated);
  };

  // editor-only: revert the whole document to an earlier version (or undo a
  // revert — same move, aimed at the version the revert replaced). Append-only:
  // one REC re-asserts that version's folded state, so the piece reads as it did
  // then while the revert itself stays in the log. Mirrors changeStatus — the
  // webhook re-verifies the token; we optimistically refold via onEdited so the
  // reader and front page reflect the restore at once.
  const revertTo = async (version, opts) => {
    opts = opts || {};
    if (!version || !version.snapshot) return;
    setRevertErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setRevertErr("Sign in with Matrix to revert — the webhook re-verifies the token server-side."); return; }
    const when = String(version.ts || "").slice(0, 10);
    const note = opts.undo
      ? "Undid revert — restored v." + version.sha
      : "Reverted to v." + version.sha + (when ? " · " + when : "");
    const operand = window.NpjArticles.revertOperand(version.snapshot, { to: version.sha, ts: version.ts, undo: !!opts.undo });
    setReverting(opts.undo ? "undo" : version.sha);
    let out;
    try {
      out = await window.NpjArticles.appendEdit({ slug: A.slug, operand, actor: me, note, token, message: (opts.undo ? "undo-revert: " : "revert: ") + A.slug + " → v." + version.sha });
    } catch (e) {
      setReverting(null);
      setRevertErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
      return;
    }
    if (out.res.status === 401 || out.res.status === 403) { setReverting(null); setRevertErr("Rejected (" + out.res.status + ") — that Matrix account isn't authorized to edit this article."); return; }
    if (!out.res.ok) { setReverting(null); setRevertErr("The webhook answered HTTP " + out.res.status + " — nothing changed."); return; }
    // Re-derive the restored article through the SAME fold the reader loads with,
    // so image/read-time/body all match a fresh load; then splice the real history
    // back on (foldLog of a lone event only knows its own one version).
    const refolded = window.NpjArticles.foldLog(window.NpjArticles.genesisLine(operand, me));
    const restored = refolded.article || {};
    const ts = new Date().toISOString();
    const head = {
      sha: out.sha, ts, author: me, op: "REC", note, message: note,
      headline: restored.headline || "", dek: restored.dek || "",
      text: window.NpjArticles.plainText(restored.body),
      snapshot: Object.assign({}, version.snapshot),
      revert: { to: version.sha, ts: version.ts, undo: !!opts.undo }
    };
    // the restored body's citations join the live ledger so they resolve at once
    Object.keys(refolded.sources || {}).forEach(k => { window.NPJ.SOURCES[k] = Object.assign(window.NPJ.SOURCES[k] || {}, refolded.sources[k]); });
    const updated = Object.assign({}, A, restored, {
      // a revert restores content + publish-state, never the access list — keep
      // the current assignees so an editor can't revert away their own rights
      assignees: A.assignees,
      sources: Object.assign({}, A.sources || {}, restored.sources || {}),
      base_sha: out.sha, updated: ts.slice(0, 10),
      storage: A.storage, logPath: A.logPath,
      versions: [head].concat(A.versions || [])
    });
    setReverting(null);
    if (onEdited) onEdited(updated);
  };

  // a spoken description of a claim's grounding, for screen readers — the
  // citation card is visual, so the label carries the same promise: what backs
  // this claim, and how to open the receipts.
  const claimAria = (claim) => {
    const names = claim.src.map(k => { const s = srcOf(k); return s.title || s.id || k; });
    const n = names.length;
    return "Sourced claim. Backed by " + n + " " + (n === 1 ? "source" : "sources") + ": " + names.join("; ") + ". Press Enter to view the citation.";
  };

  // render tokens for a paragraph: plain strings, style tokens ({t}) and
  // source-bound claims ({c, src, id}) — the EO log's full inline vocabulary
  const ent = activeEntity ? activeEntity.name : null;
  const renderTokens = (tokens) => (tokens || []).map((t, i) => {
    if (typeof t === "string") return <React.Fragment key={i}>{ent ? markEntities(t, ent, "p" + i) : t}</React.Fragment>;
    if (t && t.t) {
      if (t.t === "br") return <br key={i} />;
      if (t.t === "strong") return <strong key={i}>{t.text}</strong>;
      if (t.t === "em") return <em key={i}>{t.text}</em>;
      if (t.t === "s") return <s key={i}>{t.text}</s>;
      if (t.t === "code") return <code key={i} className="np-mono" style={{ fontSize: "0.85em", background: "var(--paper-2)", padding: "0 4px" }}>{t.text}</code>;
      if (t.t === "a") return <a key={i} href={t.href} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline", textDecorationThickness: "1.5px", textUnderlineOffset: 2 }}>{t.text}</a>;
      if (t.t === "sup") {
        // a footnote marker: hover (desktop) or tap (phone) previews the note
        // inline; a click jumps down to its home in the endnotes (and the note
        // links back). Older logs with no number fall back to plain text.
        if (t.num != null) {
          const k = t.key || t.text || "";
          return (
            <sup key={i} id={"fnref-" + k} className="fnmark" style={{ fontSize: 11, lineHeight: 0 }}>
              <a href={"#fn-" + k} aria-label={"Footnote " + t.num} aria-describedby={"fn-" + k}
                onMouseEnter={isPhone ? undefined : (e) => enterFn(e, k)}
                onMouseLeave={isPhone ? undefined : scheduleFnLeave}
                onClick={(e) => { e.preventDefault(); if (isPhone) enterFn({ currentTarget: e.currentTarget }, k); else jumpToFn(k); }}
                style={{ color: "var(--data)", textDecoration: "none", fontWeight: 600, fontFamily: "var(--mono)" }}>{t.num}</a>
            </sup>
          );
        }
        return <sup key={i} className="np-mono" style={{ fontSize: 11 }}>{t.text}</sup>;
      }
      return <React.Fragment key={i}>{t.text || ""}</React.Fragment>;
    }
    // an OWNED claim — the author's analysis/account/position. It publishes as
    // prose and reads like it; the transparency lens is the only thing that tints
    // it (and names the stance on hover). No source card — there's no citation.
    if (t && t.c != null && t.stance && (!t.src || !t.src.length)) {
      const kind = STANCE_KIND[t.stance] || "own-analysis";
      const gm = GROUND_KINDS[kind];
      // an asserted absence names its grounding on hover, and shows its mark even
      // with the lens off — it's a distinct epistemic claim. A void also carries
      // WHICH kind it is (removed/withheld/silent/inaccessible/unrecorded/ambient):
      // the kind sets the mark glyph and shades it by whether the absence is shown,
      // located, or only inferred (data-void; see app/void-kinds.js + styles.css).
      const isAbsence = t.stance === "absence";
      const VK = window.NpjVoidKinds;
      const vk = isAbsence && VK ? VK.norm(t.vkind) : null;
      const vdef = vk ? VK.get(vk) : null;
      const glyph = vdef ? vdef.glyph : gm.glyph;
      const title = isAbsence
        ? ((vdef ? vdef.label + " void — you can " + ({ shown: "point to it", located: "locate it", inferred: "only assert it" }[VK.reader(vk)]) : gm.label) + (t.note ? " — " + t.note : ""))
        : (transparency ? gm.label : undefined);
      return (
        <span key={i} id={"claim-" + (t.id || "o" + i)} className="gowned" data-ground={kind} data-void={vk ? VK.reader(vk) : undefined} title={title}>
          {ent ? markEntities(t.c, ent, "o" + i) : t.c}
          {(transparency || isAbsence) && <sup className="gmark" style={{ color: gm.mark }}>{glyph}</sup>}
        </span>
      );
    }
    const claim = claimById[t.id];
    if (!claim) return <React.Fragment key={i}>{t.c || ""}</React.Fragment>;
    const gk = groundKind(claim);
    return (
      <span key={i} id={"claim-" + t.id} className="claim" data-sugg={openByClaim[t.id] ? "1" : "0"}
        data-ground={gk}
        data-active={claim.src.includes(activeSrc) ? "1" : "0"}
        tabIndex={0} role="button" aria-haspopup="dialog"
        aria-expanded={hover && hover.claim.id === t.id ? "true" : "false"}
        aria-label={claimAria(claim)}
        onMouseEnter={isPhone ? undefined : (e) => enterClaim(e, claim)} onMouseLeave={isPhone ? undefined : scheduleLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (hover && hover.claim.id === t.id) { setHover(null); setActiveSrc(null); }
            else enterClaim({ currentTarget: e.currentTarget }, claim);
          } else if (e.key === "Escape" && hover) {
            e.stopPropagation(); setHover(null); setActiveSrc(null); e.currentTarget.focus();
          }
        }}
        onClick={(e) => { if (isPhone) enterClaim({ currentTarget: e.currentTarget }, claim); else setShowSugg(true); }}>
        {ent ? markEntities(t.c, ent, "c" + i) : t.c}
        {showMarkers && <sup className="claim-marker">{claim.num}</sup>}
        {transparency && gk && <sup className="gmark" style={{ color: GROUND_KINDS[gk].mark }}>{GROUND_KINDS[gk].glyph}</sup>}
      </span>
    );
  });

  const Body = (
    <article ref={bodyRef} className={transparency ? "ground-lens" : undefined} style={{ fontFamily: "var(--serif)" }}
      onMouseUp={() => setTimeout(refreshBubble, 0)} onKeyUp={(e) => { if (e.shiftKey || e.key === "Shift") setTimeout(refreshBubble, 0); }}>
      {A.body.map((b, i) => {
        if (b.type === "h2" || b.type === "h3") {
          const Tag = b.type;
          return <Tag key={i} id={artSlug(b.text)} style={{ fontFamily: "var(--display)", fontSize: b.type === "h2" ? 34 : 25, lineHeight: 1.04, margin: "32px 0 12px", scrollMarginTop: 90 }}>{b.text}</Tag>;
        }
        if (b.type === "pull") return (
          <blockquote key={i} style={{ margin: "26px 0", paddingLeft: 20, borderLeft: "4px solid var(--yellow-deep)",
            fontFamily: "var(--cond)", fontWeight: 500, fontSize: 27, lineHeight: 1.18 }}>
            {b.text}
            {b.attribution ? <footer className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8, fontWeight: 400 }}>{b.attribution}</footer> : null}
          </blockquote>
        );
        if (b.type === "img") {
          if (b.banner) return null; // the banner is lifted into the hero above — never inline
          return (
            <figure key={i} style={{ margin: "26px 0" }}>
              <MediaImg srcs={[b.store, b.src]} alt={b.caption || ""} fit={b.fit} crop={b.crop} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
              <PhotoFigCaption caption={b.caption} credit={b.credit} />
            </figure>
          );
        }
        if (b.type === "embed") return <EmbedFigure key={i} url={b.url} caption={b.caption} />;
        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type;
          return (
            <Tag key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", paddingLeft: 26 }}>
              {(b.items || []).map((it, j) => <li key={j} style={{ marginBottom: 6 }}>{renderTokens(it)}</li>)}
            </Tag>
          );
        }
        if (b.type === "footnotes") {
          const notes = (b.notes || []).filter(n => n && n.key);
          if (!notes.length) return null;
          return (
            <section key={i} aria-label="Footnotes" style={{ margin: "36px 0 8px", paddingTop: 16, borderTop: "2px solid var(--ink)" }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>Notes</div>
              <ol style={{ margin: 0, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 10 }}>
                {notes.map(n => (
                  <li key={n.key} id={"fn-" + n.key} value={n.num}
                    style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink)", scrollMarginTop: 90 }}>
                    {n.text ? (window.npjRichText ? window.npjRichText(n.text) : n.text) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
                    {" "}
                    <a href={"#fnref-" + n.key} aria-label="Back to text"
                      onClick={(e) => { e.preventDefault(); const el = document.getElementById("fnref-" + n.key); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      style={{ color: "var(--data)", textDecoration: "none", fontFamily: "var(--mono)", fontSize: 12.5 }}>↩</a>
                  </li>
                ))}
              </ol>
            </section>
          );
        }
        if (b.type === "hr") return <hr key={i} style={{ border: 0, borderTop: "2.5px solid var(--ink)", width: 110, margin: "30px auto" }} />;
        if (b.type === "code") return <pre key={i} className="np-mono np-scroll" style={{ fontSize: 13, lineHeight: 1.55, background: "var(--paper-2)", border: "1.5px solid var(--ink)", padding: "12px 14px", overflowX: "auto", margin: "0 0 20px" }}>{b.text}</pre>;
        if (b.type === "verse") return <pre key={i} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17.5, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: "0 0 20px", padding: "0 0 0 20px", borderLeft: "3px solid var(--rule-strong, var(--ink))" }}>{b.text}</pre>;
        return <p key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", textWrap: "pretty" }}>{renderTokens(b.tokens)}</p>;
      })}
    </article>
  );

  // One reading column shared by the headline, the body and the methods
  // footer, so the article always starts directly under the headline. With
  // auditability on, the source ledger rides to the right of it (and stacks
  // underneath on narrow screens); off, it's a single clean column. The
  // reading column stays put either way — turning auditability on only
  // reveals the ledger on the right, it never shoves the article sideways.
  const COL = 700;
  const hasRail = audit;
  const railW = 286;
  const railGap = 40;
  const stackRail = hasRail && isNarrow;

  // the banner image — lifted into a hero directly under the title/dek. ONLY an
  // explicit banner is lifted (A.image.banner); a first-inline image picked up
  // as the front-page thumbnail stays inline in the body (the body map skips
  // banner blocks, so a lifted banner never doubles up).
  const heroImg = (A.image && A.image.src && A.image.banner)
    ? A.image
    : ((A.body || []).find(b => b.type === "img" && b.banner) || null);
  const Hero = (heroImg && heroImg.src) ? (
    <figure style={{ margin: "4px 0 24px" }}>
      <MediaImg srcs={[heroImg.store, heroImg.src]} alt={heroImg.caption || A.headline || ""} fit={heroImg.fit} crop={heroImg.crop} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
      <PhotoFigCaption caption={heroImg.caption} credit={heroImg.credit} />
    </figure>
  ) : null;

  const Header = (
    <header style={{ margin: "0 0 26px" }}>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 12 }}>{A.kicker}</div>
      <h1 className="npj-article-h" style={{ fontFamily: "var(--display)", fontSize: 44, lineHeight: 1, letterSpacing: "-.01em", margin: "0 0 20px" }}>{A.headline}</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 22, lineHeight: 1.4, color: "var(--ink)", margin: "0 0 20px", fontStyle: "italic" }}>{A.dek}</p>
      {Hero}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", paddingBottom: 16, borderBottom: "2px solid var(--ink)" }}>
        <window.Byline authors={A.authors} editors={A.editors} byline={A.byline} />
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <window.VersionBadge sha={A.base_sha} count={artVersions.length} onClick={() => setShowVersions(true)} />
          {fmtDate(A.published)}{A.updated && A.updated !== A.published ? " · updated " + fmtDate(A.updated) : ""} · {A.readMins} min
        </span>
      </div>
      <div style={{ paddingTop: 14 }}>
        {/* share link opens the reader; the wayback action targets the
            committed EO log — the document's version folder on GitHub (or the
            raw file, for a legacy single-file log) */}
        <ShareBar url={window.npjArticleUrl(A.slug)} archiveUrl={`https://web.archive.org/web/${window.npjArticleLogUrl(A)}`} title={A.headline} />
      </div>
      {headings.length >= 2 && (
        <nav style={{ marginTop: 18, border: "1.5px solid var(--ink)", background: "var(--card)" }}>
          <button onClick={() => setTocOpen(o => !o)} aria-expanded={tocOpen} aria-controls="article-toc-list"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
              background: "none", border: 0, cursor: "pointer", padding: "12px 14px" }}>
            <span aria-hidden="true" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)" }}>{tocOpen ? "▾" : "▸"}</span>
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Contents</span>
            <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{headings.length}</span>
          </button>
          {tocOpen && (
            <div id="article-toc-list" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 14px 12px" }}>
              {headings.map(h => <button key={h.id} onClick={() => { jump(h.id); setTocOpen(false); }} className="headline-link" style={{ textAlign: "left", background: "none", border: 0, cursor: "pointer", fontFamily: "var(--cond)", fontWeight: h.level === 2 ? 600 : 500, fontSize: h.level === 2 ? 16 : 14, paddingLeft: (h.level - 2) * 14, color: "var(--ink)" }}>{h.text}</button>)}
            </div>
          )}
        </nav>
      )}
    </header>
  );

  const Main = (
    <div style={{ minWidth: 0 }}>
      {A.status === "unpublished" && (
        <div style={{ border: "1.5px solid var(--reject)", background: "color-mix(in srgb, var(--reject) 10%, var(--card))", padding: "10px 14px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--reject)" }}>⊘</span>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5 }}>Unpublished — hidden from the site.</span>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>The event log is still public on GitHub.{isAdmin ? " Only admins can open this page." : ""}</span>
        </div>
      )}
      {statusErr && (
        <div className="np-mono" style={{ fontSize: 11, color: "var(--reject)", border: "1px solid var(--reject)", padding: "9px 10px", marginBottom: 16, lineHeight: 1.5 }}>{statusErr}</div>
      )}
      {Header}
      {Body}
      <MethodsFooter sourceList={sourceList} claimCount={claimList.length} spansForSource={spansForSource} onJump={jumpToClaim} />
      <CompositionFooter composition={A.composition} />
    </div>
  );

  // ── Preview ── the reader's own Header + Body + MethodsFooter, on the paper
  // page, with nothing but a Close bar around them. Because it renders the SAME
  // components from the SAME folded article the publish pipeline produces, what
  // the author sees here is byte-for-byte what ships: paragraph spacing, soft
  // line breaks, images, byline, the sources footer — all of it.
  if (preview) {
    return (
      <div className="fade-in" style={{ position: "fixed", inset: 0, zIndex: 6000, background: "var(--paper)", color: "var(--ink)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", display: "flex", alignItems: "center", gap: 12, padding: isPhone ? "8px 14px" : "10px 22px" }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: "var(--mono)" }}>◉</span> {isPhone ? "Preview" : "Preview · exactly as readers will see it"}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setTransparency(v => !v)} aria-pressed={transparency}
            title="Transparency — colour each claim by how it's grounded: cited (⊤/⊨), the author's own (⊢/⊨/⊩), or needs a source (⊥)"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: transparency ? "var(--ink)" : "var(--card)", color: transparency ? "var(--yellow)" : "var(--ink)" }}>
            <I.swatches style={{ fontSize: 14 }} /> Transparency
          </button>
          <button className="btn btn-sm" onClick={onClose} title="Back to the editor (Esc)">✕ Close</button>
        </div>
        <div style={{ maxWidth: COL, margin: "0 auto", padding: isPhone ? "18px 16px 80px" : "34px 22px 96px" }}>
          {Main}
        </div>
        {transparency && <GroundingLegend tally={groundTally} onClose={() => setTransparency(false)} />}
        {/* Grounding receipts on hover — the SAME citation card the public reader
           shows. Hover (or tap, on a phone) a claim and its source card floats
           up, so the author can audit the grounding in the preview exactly as a
           reader will. Lives INSIDE the fixed preview overlay so it stacks above
           it. The body already wires enterClaim on each .claim span; the reader
           branch just renders this card off the same hover state. */}
        <HoverCard data={hover} onEnter={cancelLeave} onLeave={scheduleLeave}
          onClose={() => { setHover(null); setActiveSrc(null); }}
          spansForSource={spansForSource} onJump={jumpToClaim} onExpand={openLightbox} preview />
        <FootnotePop data={fnPop} onEnter={cancelFnLeave} onLeave={scheduleFnLeave}
          onClose={() => setFnPop(null)} onJump={() => fnPop && jumpToFn(fnPop.key)} />
        {lightbox && <SourceLightbox srcKey={lightbox} onClose={() => setLightbox(null)} />}
      </div>
    );
  }

  return (
    <div className="fade-in">
      <Masthead route="article" onHome={onHome} onNewsroom={onNewsroom} />
      <ControlBar {...{ audit, setAudit, transparency, setTransparency, showSugg, setShowSugg,
        suggCount: suggestions.filter(s => s.status === "proposed" || s.status === "review").length,
        entityOpen, setEntityOpen, entityCount: entityData ? entityData.entities.length : null,
        canEdit: canEditArticle, onEdit: () => setEditing(true), onExport: () => setShowExport(true),
        isAdmin, status: A.status, statusBusy, onSetStatus: changeStatus }} />

      <div style={{ maxWidth: hasRail && !stackRail ? COL + 2 * (railW + railGap) : COL, padding: isPhone ? "18px 16px 64px" : "30px 22px 80px",
        marginLeft: (!isPhone && entityOpen) ? 372 : "auto", marginRight: (!isPhone && showSugg) ? 408 : "auto", transition: "margin .28s" }}
        className={audit ? "read-audit" : "read-clean"}>

        {hasRail ? (
          <div style={{ display: "grid",
            // an empty left gutter mirrors the ledger's width, so the reading
            // column lands in the exact same place as the clean read — audit
            // on just paints the ledger into the right margin
            gridTemplateColumns: stackRail ? "minmax(0, 1fr)" : "minmax(0, " + railW + "px) minmax(0, " + COL + "px) " + railW + "px",
            gap: railGap, alignItems: "start", justifyContent: "center" }}>
            {!stackRail && <div aria-hidden="true" />}
            {Main}
            <Ledger sourceList={sourceList} activeSrc={activeSrc} setActiveSrc={setActiveSrc} spansForSource={spansForSource} onJump={jumpToClaim} />
          </div>
        ) : (
          <div style={{ maxWidth: COL, margin: "0 auto" }}>{Main}</div>
        )}
      </div>

      <HoverCard data={hover} onEnter={cancelLeave} onLeave={scheduleLeave} onSuggest={startCompose}
        onClose={() => { setHover(null); setActiveSrc(null); }}
        suggCount={hover ? openByClaim[hover.claim.id] : 0} spansForSource={spansForSource} onJump={jumpToClaim} onExpand={openLightbox} />

      <FootnotePop data={fnPop} onEnter={cancelFnLeave} onLeave={scheduleFnLeave}
        onClose={() => setFnPop(null)} onJump={() => fnPop && jumpToFn(fnPop.key)} />

      {transparency && <GroundingLegend tally={groundTally} onClose={() => setTransparency(false)} />}

      <EntityRail open={entityOpen} onClose={() => { setEntityOpen(false); setActiveEntity(null); }}
        entityData={entityData} active={activeEntity} setActive={setActiveEntity} />

      {bubble && (
        <div className="fb-bubble" style={{ left: bubble.x, top: bubble.y - 46 }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => openComposeFromBubble("suggestion")}><span style={{ fontFamily: "var(--mono)" }}>✎</span> Suggest edit</button>
          <button onClick={() => openComposeFromBubble("comment")}><span style={{ fontFamily: "var(--mono)" }}>💬</span> Comment</button>
        </div>
      )}

      <SuggestionRail open={showSugg} onClose={() => { setShowSugg(false); setCompose(null); }}
        list={suggestions} claimById={claimById} filter={filter} setFilter={setFilter}
        canReview={canEditArticle} onVote={onVote} onResolve={onResolve} onReply={onReply} onMerge={onMerge} onShow={showInText}
        composeDraft={compose}
        onSubmit={(d) => { onAddSuggestion(d); setCompose(null); }}
        onCancelCompose={() => setCompose(null)} me={me} />
      {showVersions && <window.VersionHistory versions={artVersions} onClose={() => setShowVersions(false)}
        onRevert={revertTo} canRevert={canEditArticle} reverting={reverting} revertErr={revertErr} />}
      {showExport && window.SubstackExport && <window.SubstackExport article={A} onClose={() => setShowExport(false)} />}
      {editing && window.ArticleEdit && (
        <window.ArticleEdit article={A} me={me} isAdmin={isAdmin}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setEditing(false); if (onEdited) onEdited(updated); }} />
      )}

      {/* a source's document, expanded to fill the screen in-app — click a
         document in any citation card to open it; ✕ / Esc / backdrop to exit */}
      {lightbox && <SourceLightbox srcKey={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ---- the transparency lens legend ----
   A small fixed key, shown only while the lens is on, that names each grounding
   colour and tallies how many claims carry it. It lists the kinds the piece
   actually uses (a piece with no owned claims doesn't show the owned rows),
   falling back to the two cited kinds when nothing is grounded yet. */
function GroundingLegend({ tally, onClose }) {
  const isPhone = window.useIsMobile(760);
  tally = tally || {};
  const present = GROUND_ORDER.filter(k => (tally[k] || 0) > 0);
  const rows = present.length ? present : GROUND_ORDER.slice(0, 2);
  const total = GROUND_ORDER.reduce((n, k) => n + (tally[k] || 0), 0);
  return (
    <aside className="np-scroll fade-in" aria-label="Transparency lens — how each claim is grounded"
      style={{ position: "fixed", left: isPhone ? 8 : 16, bottom: isPhone ? 8 : 16, zIndex: 3900,
        width: isPhone ? "calc(100% - 16px)" : 264, maxWidth: 264, maxHeight: "62vh", overflowY: "auto",
        background: "var(--card)", border: "1.5px solid var(--ink)", boxShadow: "0 10px 30px rgba(8,7,5,.34)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderBottom: "1.5px solid var(--ink)", position: "sticky", top: 0, background: "var(--card)" }}>
        <I.swatches style={{ fontSize: 14, color: "var(--ink-soft)" }} />
        <span className="np-eyebrow" style={{ flex: 1, color: "var(--ink-soft)" }}>How each claim is grounded</span>
        {onClose && (
          <button onClick={onClose} aria-label="Turn off the transparency lens"
            style={{ background: "none", border: 0, cursor: "pointer", fontSize: 17, lineHeight: 1, color: "var(--ink)", padding: "0 2px" }}><I.x /></button>
        )}
      </div>
      <div style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map(k => {
          const m = GROUND_KINDS[k];
          return (
            <div key={k} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2, width: 16, height: 15, borderRadius: 3,
                background: "color-mix(in srgb, " + m.color + " 20%, transparent)", borderBottom: "2px solid " + m.color }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: "var(--mono)", color: m.color }}>{m.glyph}</span>
                  <span style={{ flex: 1 }}>{m.label}</span>
                  {tally[k] ? <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{tally[k]}</span> : null}
                </div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 11.5, lineHeight: 1.4, color: "var(--ink-soft)", marginTop: 1 }}>{m.note}</div>
              </div>
            </div>
          );
        })}
        <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", borderTop: "1px solid var(--rule)", paddingTop: 7 }}>
          {total ? total + " grounded " + (total === 1 ? "claim" : "claims") + " · unmarked text is uncited prose." : "No grounded claims in this piece yet."}
        </div>
      </div>
    </aside>
  );
}

/* ---- sticky control bar (the reader's instrument panel) ---- */
function ControlBar({ audit, setAudit, transparency, setTransparency, showSugg, setShowSugg, suggCount, entityOpen, setEntityOpen, entityCount, canEdit, onEdit, onExport, isAdmin, status, statusBusy, onSetStatus }) {
  const isPhone = window.useIsMobile(760);
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 1500, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", boxShadow: "0 2px 0 rgba(22,20,13,.06)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: isPhone ? "7px 12px" : "9px 22px", display: "flex", alignItems: "center", gap: isPhone ? 7 : 14, flexWrap: "wrap", justifyContent: isPhone ? "flex-start" : undefined }}>
        {!isPhone && <span style={{ flex: 1 }} />}

        <button className="btn btn-sm" onClick={onExport} title="Export for Substack — copy with images, headings & sourcing intact, or download a .md"
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <I.ext style={{ fontSize: 14 }} /> Export
        </button>

        {canEdit && (
          <button className="btn btn-sm" onClick={onEdit} title="Edit this published article — your change is appended to its EO event log" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--yellow)", fontWeight: 700 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>⊛</span> Edit
          </button>
        )}

        {isAdmin && (status === "unpublished" ? (
          <button className="btn btn-sm" onClick={() => onSetStatus("published")} disabled={statusBusy} title="Republish — make this visible on the site again"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--yellow)", fontWeight: 700 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>↺</span> {statusBusy ? "Working…" : "Republish"}
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => onSetStatus("unpublished")} disabled={statusBusy} title="Unpublish — hide from the site (the event log stays in GitHub)"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, borderColor: "var(--reject)", color: "var(--reject)" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>⊘</span> {statusBusy ? "Working…" : "Unpublish"}
          </button>
        ))}

        <button className="btn btn-sm" onClick={() => setAudit(!audit)} aria-pressed={audit}
          title="Auditability — reveal the source ledger, numbered claims and every citation. Off: a clean read."
          style={{ display: "inline-flex", alignItems: "center", gap: 7,
            background: audit ? "var(--ink)" : "var(--card)", color: audit ? "var(--yellow)" : "var(--ink)" }}>
          <I.shield style={{ fontSize: 14 }} /> Auditability
        </button>

        <button className="btn btn-sm" onClick={() => setTransparency(!transparency)} aria-pressed={transparency}
          title="Transparency — colour every claim by how it's grounded: cited (⊤ grounded / ⊨ multiple sources), owned by the author (⊢ analysis / ⊨ account / ⊩ position), or still needs a source (⊥). Off: a clean read."
          style={{ display: "inline-flex", alignItems: "center", gap: 7,
            background: transparency ? "var(--ink)" : "var(--card)", color: transparency ? "var(--yellow)" : "var(--ink)" }}>
          <I.swatches style={{ fontSize: 14 }} /> Transparency
        </button>

        <button className="btn btn-sm" onClick={() => setEntityOpen(!entityOpen)} title="Figures & places extracted by eoreader3" style={{ display: "inline-flex", alignItems: "center", gap: 7,
          background: entityOpen ? "var(--ink)" : "var(--card)", color: entityOpen ? "var(--yellow)" : "var(--ink)" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>●</span> Figures
          {entityCount != null && <span className="np-mono" style={{ fontSize: 11, background: "var(--data)", color: "#fff", padding: "0 5px", border: "1px solid var(--ink)" }}>{entityCount}</span>}
        </button>

        <button className="btn btn-sm" onClick={() => setShowSugg(!showSugg)} style={{ display: "inline-flex", alignItems: "center", gap: 7,
          background: showSugg ? "var(--ink)" : "var(--card)", color: showSugg ? "var(--yellow)" : "var(--ink)" }}>
          {showSugg ? <I.eyeoff style={{ fontSize: 14 }} /> : <I.chat style={{ fontSize: 14 }} />}
          {showSugg ? "Hide" : "Suggestions"}
          <span className="np-mono" style={{ fontSize: 11, background: "var(--yellow)", color: "var(--ink)", padding: "0 5px", border: "1px solid var(--ink)" }}>{suggCount}</span>
        </button>
      </div>
    </div>
  );
}

/* ---- the source ledger (shown when auditability is on) ---- */
function Ledger({ sourceList, activeSrc, setActiveSrc, spansForSource, onJump }) {
  return (
    <aside style={{ position: "sticky", top: 64, borderLeft: "1.5px solid var(--ink)", paddingLeft: 18 }}>
      <div className="np-eyebrow" style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 6, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <I.source style={{ fontSize: 14 }} /> Source ledger
      </div>
      <div className="np-scroll" style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto", paddingRight: 4 }}>
        {sourceList.map(({ key, num }) => {
          const s = srcOf(key); const on = activeSrc === key; const spans = spansForSource(key);
          const ivLink = window.NpjInterview && window.NpjInterview.isInterview(s);
          const url = s.archive_url || s.original_url;
          // hovering the source lights up its exact spans in the body (data-active)
          // and reveals them here as click-to-jump passages
          return (
            <div key={key} onMouseEnter={() => setActiveSrc(key)} onMouseLeave={() => setActiveSrc(null)}
              style={{ marginBottom: 4, background: on ? "var(--yellow)" : "transparent", borderLeft: "3px solid " + (on ? "var(--ink)" : "transparent") }}>
              <div style={{ display: "flex", gap: 7, padding: "8px 8px 6px" }}>
                <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>{num}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.08 }}>{s.title}</div>
                  <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 3 }}>{s.outlet}</div>
                  <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <SourceTag type={s.type} />
                    {spans.length > 0 && <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>· {spans.length} passage{spans.length !== 1 ? "s" : ""}</span>}
                    {ivLink
                      ? <span className="np-mono" style={{ fontSize: 9.5, color: "var(--review)" }}>{window.NpjInterview.outletLine(s.talk || {})}</span>
                      : url ? <a href={url} target="_blank" rel="noopener" className="np-mono" title="Open the archived snapshot" style={{ fontSize: 9.5, color: "var(--verified)", textDecoration: "none" }}>snapshot ↗</a> : null}
                  </div>
                </div>
              </div>
              {on && spans.length > 0 && <div className="fade-in"><CitedSpanList claims={spans} onJump={onJump} /></div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function MethodsFooter({ sourceList, claimCount, spansForSource, onJump }) {
  const isPhone = window.useIsMobile(760);
  return (
    <footer style={{ margin: "44px 0 0", borderTop: "2.5px solid var(--ink)", paddingTop: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ fontFamily: "var(--display)", fontSize: 24, margin: 0 }}>METHODS &amp; RECEIPTS</h3>
        <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{claimCount} bound claims · {sourceList.length} archived sources · build passed ✓</span>
      </div>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-soft)", maxWidth: "62ch" }}>
        Every figure above resolves to an archive.org snapshot taken the day we pulled it. The live URL is secondary and may rot; the snapshot is canonical.
        A broken <span className="np-mono">src:</span> reference fails the build, so this page cannot deploy with a citation that points nowhere.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr", gap: "12px 24px", marginTop: 10 }}>
        {sourceList.map(({ key, num }) => {
          const s = srcOf(key); const spans = spansForSource ? spansForSource(key) : [];
          // an interview has no snapshot to open — render it as a plain (non-link)
          // reference line carrying its attribution + date instead of a dead link
          const ivLink = window.NpjInterview && window.NpjInterview.isInterview(s);
          const url = s.archive_url || s.original_url;
          const inner = (
            <React.Fragment>
              <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>{num}</span>
              <span style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.25 }}>
                <strong style={{ fontWeight: 600 }}>{s.outlet}.</strong> {s.title}. <span className="np-mono" style={{ fontSize: 10.5, color: ivLink ? "var(--review)" : "var(--verified)" }}>{ivLink ? window.NpjInterview.humanDate((s.talk && s.talk.date) || s.retrieved) : ((s.archive_url ? "archived " + (s.retrieved || "") : "live link") + " ↗")}</span>
              </span>
            </React.Fragment>
          );
          return (
            <div key={key} style={{ borderBottom: "1px solid var(--rule)", paddingBottom: 6 }}>
              {ivLink || !url
                ? <div style={{ display: "flex", gap: 8, padding: "6px 6px" }}>{inner}</div>
                : <a href={url} target="_blank" rel="noopener" className="headline-link" style={{ display: "flex", gap: 8, padding: "6px 6px", textDecoration: "none" }}>{inner}</a>}
              {/* the exact passages this source grounds — click to jump back up */}
              <CitedSpanList claims={spans} onJump={onJump} />
            </div>
          );
        })}
      </div>
    </footer>
  );
}

// How this was written — a calm, honest strip under the receipts. It reads the
// `composition` record the editor captured (app/composition.js): typed vs.
// pasted characters, the biggest single paste, how much was revised away, over
// how long. NEVER the words — only counts and timestamps — so it can hint that
// a passage may have arrived whole (from notes, another doc, an AI tool) while
// being upfront that this is context, not proof. Renders in BOTH the preview
// and the published reader (it lives inside <Main>); silently absent on pieces
// published before this shipped, or too short to characterize fairly.
function CompositionFooter({ composition }) {
  const isPhone = window.useIsMobile(760);
  const s = (window.NpjComposition && window.NpjComposition.summary) ? window.NpjComposition.summary(composition) : null;
  if (!s) return null;
  const pct = (x) => Math.round(x * 100);
  const words = (chars) => Math.max(1, Math.round(chars / 5.5));
  const toneColor = ({ calm: "var(--verified)", note: "var(--review)", warn: "var(--reject)" })[s.tone] || "var(--ink-soft)";
  const typedW = Math.max(2, Math.round(s.typedPct * 100));
  const pastedW = Math.max(0, 100 - typedW);
  const span = !s.started ? null
    : s.dayCount > 1 ? ("drafted across " + s.dayCount + " days")
    : s.activeMin >= 1 ? ("drafted in one sitting · ~" + s.activeMin + " min hands-on")
    : "drafted in one sitting";
  // re-landing your OWN already-cited text isn't an outside import — call it out
  const groundedShare = s.pasted ? s.groundedPasted / s.pasted : 0;
  const notes = [];
  if (s.dominantPaste) notes.push("one pasted block of ~" + words(s.maxPaste) + " words");
  if (s.largePasteCount > (s.dominantPaste ? 1 : 0)) notes.push(s.largePasteCount + " large pastes");
  if (s.heavilyRevised) notes.push("substantially revised");
  if (groundedShare >= 0.34 && s.groundedPasted >= 120) notes.push(pct(groundedShare) + "% of pasted text was your own cited writing");

  return (
    <section style={{ margin: "30px 0 0", borderTop: "1.5px solid var(--rule)", paddingTop: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h4 className="np-eyebrow" style={{ margin: 0, color: "var(--ink-soft)" }}>How this was written</h4>
        <span className="np-mono" style={{ fontSize: 11, color: toneColor, border: "1px solid " + toneColor, padding: "1px 7px", borderRadius: 2, fontWeight: 600 }}>{s.label}</span>
        {span && <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{span}</span>}
      </div>
      {/* typed vs. pasted — a single proportional bar, captioned in plain numbers */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: isPhone ? "wrap" : "nowrap" }}>
        <div title={pct(s.typedPct) + "% typed · " + pct(s.pastedPct) + "% pasted"}
          style={{ display: "flex", height: 9, flex: isPhone ? "1 1 100%" : "0 0 220px", width: isPhone ? "100%" : 220, border: "1px solid var(--ink)", overflow: "hidden" }}>
          <span style={{ width: typedW + "%", background: "var(--ink)" }} />
          <span style={{ width: pastedW + "%", background: "var(--yellow)" }} />
        </div>
        <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>
          <strong style={{ color: "var(--ink)" }}>{pct(s.typedPct)}%</strong> typed · <strong style={{ color: "var(--ink)" }}>{pct(s.pastedPct)}%</strong> pasted
          {s.pasteCount ? <span> · {s.pasteCount} paste{s.pasteCount === 1 ? "" : "s"}</span> : null}
        </span>
      </div>
      {notes.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {notes.map((n, i) => (
            <span key={i} className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", background: "var(--card)", border: "1px solid var(--rule)", padding: "2px 8px" }}>{n}</span>
          ))}
        </div>
      )}
      <p className="np-mono" style={{ fontSize: 10, lineHeight: 1.55, color: "var(--ink-soft)", maxWidth: "64ch", margin: "12px 0 0" }}>
        A record of how the draft was assembled — not what it says. Pasting can be a quote, your own notes, or text from another tool; we can't tell which, and the words themselves were never stored. Read it as context, not a verdict.
      </p>
    </section>
  );
}

Object.assign(window, { ArticleRead, CompositionFooter });
