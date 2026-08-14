/* NPJ masthead + front page — revamped layout.
   The masthead is a two-piece chrome: a yellow header band (logo + taglines +
   utility links) and a dark section nav bar. On desktop the whole front page is
   a centered 2/3-width column, and inside it a two-column grid: the cover story
   owns the left 2/3, the next few stories stack as compact briefs in a 1/3 rail
   on the right, and any overflow spills into a full-width grid below. Each piece
   renders through its admin-chosen layout template (FrontCard); the lineup order
   + templates come from layout.front (see app/layout.jsx, app/AdminEditor.jsx). */

// Desktop front-page shell: a centered column 2/3 of the screen wide (capped so
// it never runs away on ultra-wide displays). On phones every container goes
// full-width (handled per-component via useIsMobile + the existing mobile CSS).
const SHELL_W = "min(66.67vw, 1760px)";
// …but 2/3 of a *narrow* desktop window is too tight for the masthead's dark nav
// (Latest + Sources Archive + search + the Submit CTA), which is what made the
// tabs overlap the search field on the front page. The 2/3 shell is a wide-screen
// nicety, so below this width the front page falls back to the full-width chrome
// every other route already uses — which has room to spare.
const SHELL_MIN = 1180;

// Collapse front-page entries that are the same story to a single card, keeping
// the first occurrence (the lineup is newest-first, so the freshest copy wins).
// Identity is the slug, then a normalized headline+dek — so a republish that
// forks the slug (a new auto-generated slug committed beside the original) still
// reads as one article instead of doubling up on the cover and in the feed.
function dedupeArticles(items) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const seen = new Set();
  const out = [];
  for (const a of (items || [])) {
    const slugKey = a && a.slug ? "slug:" + a.slug : null;
    const textKey = a && a.headline ? "text:" + norm(a.headline) + "¦" + norm(a.dek) : null;
    if ((slugKey && seen.has(slugKey)) || (textKey && seen.has(textKey))) continue;
    if (slugKey) seen.add(slugKey);
    if (textKey) seen.add(textKey);
    out.push(a);
  }
  return out;
}

function Placeholder({ label, h = 220, dark = false }) {
  const stroke = dark ? "rgba(255,255,255,.10)" : "rgba(22,20,13,.09)";
  return (
    <div style={{ position: "relative", height: h, border: "1.5px solid var(--ink)",
      background: `repeating-linear-gradient(135deg, transparent, transparent 9px, ${stroke} 9px, ${stroke} 10px), var(--paper-2)`,
      display: "flex", alignItems: "flex-end" }}>
      <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", background: "var(--paper)",
        border: "1px solid var(--rule)", padding: "3px 7px", margin: 8 }}>▢ {label}</span>
    </div>
  );
}

/* ---- "From the creators of" credit ---- */
// The two publications behind NPJ. Each logo links out to its Substack. Two
// responsive forms share one data source:
//   • full (desktop) — names left of a tidy right-aligned column of logos; sits
//     in the masthead's top-right beside the community taglines, wrapping onto
//     its own line below them when the header gets tight.
//   • compact (phones) — just the label + the two logos (names drop to save
//     width), shown to the right of the logo where the taglines/utility hide.
const NPJ_CREATORS = [
  { name: "Jesus Urbanist", href: "https://jesusurbanist.substack.com/",
    img: "https://substackcdn.com/image/fetch/$s_!9pwX!,w_80,h_80,c_fill,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff6a460b9-d19c-4493-8ffc-6f3a72d8f209_650x650.png" },
  { name: "{Rich Text}", href: "https://readrichtext.substack.com/",
    img: "https://substackcdn.com/image/fetch/$s_!nVNQ!,w_176,h_176,c_fill,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8722a66c-f873-4b99-ab10-2486beab6bd0_788x788.png" }
];

function CreatorCredits({ compact }) {
  const sz = compact ? 30 : 40;
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: compact ? 6 : 9, flexShrink: 0 }}>
      <div className="np-mono" style={{ fontSize: compact ? 8.5 : 10.5, lineHeight: 1.15, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-soft)", textAlign: "right", maxWidth: compact ? 96 : undefined, whiteSpace: compact ? "normal" : "nowrap" }}>
        From the creators of
      </div>
      <div style={{ display: "flex", flexDirection: compact ? "row" : "column", alignItems: compact ? "center" : "flex-end", gap: compact ? 7 : 8 }}>
        {NPJ_CREATORS.map((c) => (
          <a key={c.href} className="npj-creator" href={c.href} target="_blank" rel="noopener noreferrer" title={c.name}
            style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
            {!compact && <span className="npj-creator-name" style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15.5, lineHeight: 1, color: "var(--ink)", whiteSpace: "nowrap" }}>{c.name}</span>}
            <img src={c.img} alt={c.name} width={sz} height={sz} loading="lazy"
              style={{ width: sz, height: sz, objectFit: "cover", border: "1.5px solid var(--ink)", background: "var(--paper-2)", display: "block", flexShrink: 0 }} />
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---- Masthead ---- */
// `narrow` (front page only) centers the chrome inside the 2/3 shell column so
// the header lines up with the lineup below it. Every other route leaves it
// off → unchanged full-width masthead.
function Masthead({ route, onHome, onNewsroom, activeColumn, onColumn, narrow }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const mobile = window.useIsMobile();
  // the 2/3 column is only safe on a genuinely wide desktop; narrower than that
  // and the centered chrome goes full-width so the nav stops overlapping itself
  const wide = !window.useIsMobile(SHELL_MIN);
  const tight = narrow && wide;
  const sections = (layout.sections || []).map(s => s.name);
  const utility = layout.utility || [];
  const taglines = layout.taglines || [];
  const navFor = (n) => (window.__nav && window.__nav[n]) ? window.__nav[n] : onHome;
  const clickColumn = (name) => { if (onColumn) onColumn(name); else onHome(); };
  const displayTaglines = taglines.length > 0 ? taglines : ["created", "backed", "edited"];

  return (
    <header>
      {/* yellow masthead band */}
      <div className="npj-masthead" style={{ background: "var(--yellow)", padding: tight ? "22px 0 26px" : "22px 72px 26px" }}>
        <div style={{ width: tight ? SHELL_W : undefined, maxWidth: 1760, margin: "0 auto", display: "flex", alignItems: "center", gap: 32 }}>
          <button onClick={onHome} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", margin: "-8px 0 -10px -14px", flexShrink: 0 }}>
            <img className="npj-logo" src="assets/npj-logo-wide.png" alt="Nashville Peoples' Journal" style={{ height: 168, display: "block" }} />
          </button>
          <div style={{ flex: 1 }} />
          <div className="npj-hide-sm" style={{ display: "flex", alignItems: "stretch", justifyContent: "flex-end", flexWrap: "wrap", gap: 28 }}>
            <div style={{ width: 2.5, background: "var(--ink)" }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 2 }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 34, lineHeight: 1.04, textAlign: "right" }}>
                {displayTaglines.map((t, i) => (
                  <div key={i}><span style={{ fontWeight: 500, color: "var(--ink-soft)" }}>community-</span>{t}.</div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 12, fontFamily: "var(--mono)", fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase" }}>
                {utility.length > 0
                  ? utility.map((u, i) => (
                      <button key={i} onClick={() => navFor(u.nav)()} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}>{u.label}</button>
                    ))
                  : <button onClick={() => navFor("standards")()} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}>Our Standards</button>
                }
                <button onClick={onNewsroom} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--ink)", fontWeight: 600, fontFamily: "var(--mono)", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}>⊠ Newsroom log in</button>
              </div>
            </div>
            <CreatorCredits />
          </div>
          {/* phones: the taglines/utility cluster hides, so the credit shows here
              in its compact form (logos only) to the right of the logo */}
          {mobile && <CreatorCredits compact />}
        </div>
      </div>

      {/* dark section nav — hidden inside the article reader to avoid toolbar stacking */}
      {route !== "article" && (
        <nav style={{ background: "var(--ink)", color: "var(--paper)" }}>
          <div className="npj-nav-inner" style={{ width: tight ? SHELL_W : undefined, maxWidth: 1760, margin: "0 auto", padding: tight ? "0" : "0 72px", display: "flex", alignItems: "stretch", height: 58 }}>
            {/* Two fixed tabs: the Latest feed and the Sources Archive (the
                deduped, archive.org-backed record of every cited source). On
                phones this strip scrolls sideways on its own (swipeable) so it
                never widens the page past the viewport. */}
            <div className="npj-nav-cols" style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
              {[
                { label: "Latest", active: route === "home", go: onHome },
                { label: "Sources Archive", active: route === "explore", go: () => (window.__nav && window.__nav.explore ? window.__nav.explore() : onHome()) }
              ].map((t) => (
                <button key={t.label} onClick={t.go} style={{
                  flexShrink: 0, display: "flex", alignItems: "center", padding: "0 26px",
                  background: t.active ? "var(--yellow)" : "none",
                  color: t.active ? "var(--ink)" : "var(--paper)",
                  border: 0, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 17,
                  letterSpacing: ".1em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap"
                }}>{t.label}</button>
              ))}
            </div>
            <div className="npj-nav-spacer" style={{ flex: 1 }} />
            <div className="npj-search" style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 30, flex: "0 1 240px", minWidth: 0 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 14, color: "#8c8676" }}>⌕</span>
              <input type="text" placeholder="Search records, snapshots…" style={{ width: "100%", minWidth: 0, border: 0, borderBottom: "1px solid rgba(255,255,255,.35)", background: "transparent", fontFamily: "var(--mono)", fontSize: 13, color: "var(--paper)", outline: "none", padding: "4px 0" }} />
            </div>
            <button onClick={() => window.__nav && window.__nav.submit && window.__nav.submit()} style={{
              display: "flex", alignItems: "center", alignSelf: "center", flexShrink: 0, whiteSpace: "nowrap",
              background: "var(--yellow)", color: "var(--ink)", padding: "9px 20px",
              fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, letterSpacing: ".1em",
              textTransform: "uppercase", border: 0, cursor: "pointer"
            }}>{mobile ? "Submit" : "Submit a story"}</button>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ---- Front Page ---- */
/* Universal tag filters — a wrapping row of toggle chips under the masthead.
   Each chip filters the lineup in place (it is NOT a nav route); the active chip
   reads as filled ink, the rest as outlined. Curated by the admin (layout.filters). */
function FrontFilters({ tags, active, onToggle, wide, mobile }) {
  return (
    <div style={{ width: wide ? SHELL_W : undefined, maxWidth: 1760, margin: "0 auto", padding: wide ? "18px 0 0" : (mobile ? "16px 16px 0" : "18px 72px 0") }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingBottom: 16, borderBottom: "1px solid var(--rule)" }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", marginRight: 4, flex: "0 0 auto" }}>Filter</span>
        {tags.map(({ tag, count }) => {
          const on = active === tag;
          return (
            <button key={tag} onClick={() => onToggle(tag)} aria-pressed={on}
              className="np-mono"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                background: on ? "var(--ink)" : "transparent", color: on ? "var(--paper)" : "var(--ink)",
                border: "1.5px solid var(--ink)", borderRadius: 999, padding: "5px 12px",
                fontSize: 11.5, letterSpacing: ".02em", lineHeight: 1, transition: "background .12s, color .12s" }}>
              {tag}
              <span style={{ opacity: .6, fontSize: 10 }}>{count}</span>
            </button>
          );
        })}
        {active && tags.some(t => t.tag === active) && (
          <button onClick={() => onToggle(active)} className="np-mono"
            style={{ background: "none", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 11, textDecoration: "underline", textUnderlineOffset: 2, padding: "5px 4px", flex: "0 0 auto" }}>
            clear
          </button>
        )}
      </div>
    </div>
  );
}

function FrontPage({ onOpen, onNewsroom, onHome }) {
  const { layout, isAdmin } = React.useContext(window.LayoutCtx);
  const mobile = window.useIsMobile();
  const wide = !window.useIsMobile(SHELL_MIN); // 2/3 shell only on wide desktops
  const F = window.NPJ.FRONT || {};
  const sections = (layout.sections || []).map(s => s.name);
  const [col, setCol] = useState(null);
  // The first column ("Latest") is just the unfiltered, newest-first feed — not
  // a tag filter. Clicking it (or re-clicking the active column) clears the
  // filter and shows everything.
  const isLatest = (name) => name === sections[0] || /^latest$/i.test(name || "");

  const all = [];
  if (F.lead) all.push({ ...F.lead, _lead: true, tags: F.lead.tags || [] });
  (F.secondary || []).forEach(s => all.push({ ...s, tags: s.tags || [] }));
  // Unpublish is the site's soft-delete: an unpublished piece comes off the
  // front page for EVERYONE, admins included — nothing is deleted, and it's
  // listed + republishable from Documents. (Admins still reach it by direct
  // link / from Documents, where the reader shows the Unpublished banner.)
  //
  // A SCHEDULED piece is gated until its release instant: held off the front
  // page for readers until `releaseAt` passes, then it surfaces on its own (the
  // gate is re-decided against the wall-clock here on every paint, so a piece
  // goes live with no re-commit). Admins still see it — flagged with a Scheduled
  // badge — so they can preview and manage the lineup before it drops.
  const isScheduled = (a) => window.NpjArticles && window.NpjArticles.scheduledFuture
    ? window.NpjArticles.scheduledFuture(a.releaseAt)
    : !!(a.releaseAt && Date.parse(a.releaseAt) > Date.now());
  const published = all.filter(a => a.status !== "unpublished" && (isAdmin || !isScheduled(a)))
    .map(a => isScheduled(a) ? { ...a, _scheduled: true } : a);
  // …and never run the same story twice. A republish that forks the slug (e.g. a
  // fresh auto-generated slug committed alongside the original human-readable
  // one) leaves two documents for one article — both would otherwise render, as
  // the cover AND again down the feed. Collapse them by identity, keeping the
  // first (the lineup arrives newest-first, so the newest copy wins). Keyed by
  // slug first; a slug fork still dedupes on a normalized headline+dek.
  const visible = dedupeArticles(published);
  const shown = col ? visible.filter(a => (a.tags || []).includes(col)) : visible;
  // Universal tag filters (admin-curated, layout.filters) → toggle chips that
  // drive the SAME tag filter as the nav columns. Only surface a chip when at
  // least one visible piece carries it, so the row never shows a dead filter.
  const filterTags = (layout.filters || [])
    .map(t => ({ tag: t, count: visible.filter(a => (a.tags || []).includes(t)).length }))
    .filter(f => f.count > 0);

  return (
    <div className="fade-in">
      <Masthead route="home" onHome={onHome} onNewsroom={onNewsroom} narrow
        activeColumn={col} onColumn={(name) => setCol(c => (c === name || isLatest(name)) ? null : name)} />
      {filterTags.length > 0 && (
        <FrontFilters tags={filterTags} active={col} onToggle={(t) => setCol(c => c === t ? null : t)} wide={wide} mobile={mobile} />
      )}
      <main style={{ width: wide ? SHELL_W : undefined, maxWidth: 1760, margin: "0 auto", padding: wide ? "34px 0 0" : (mobile ? "24px 0 0" : "34px 72px 0") }}>
        {shown.length === 0
          ? <EmptyFront col={col} sections={sections} onNewsroom={onNewsroom} onSubmit={() => window.__nav && window.__nav.submit()} />
          : <FrontLineup items={shown} onOpen={onOpen} />}
      </main>
      <FrontFooter />
    </div>
  );
}

/* The Internet Archive's "temple" mark, inlined (no runtime third-party fetch,
   matching the rest of the app) and drawn in currentColor so it takes the
   footer's ink. A plain facade: pediment, lintel, four columns, two base bars. */
function ArchiveOrgMark({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <polygon points="50,6 93,27 7,27" />
      <rect x="14" y="31" width="72" height="9" />
      <rect x="20" y="44" width="9" height="40" rx="1.5" />
      <rect x="37" y="44" width="9" height="40" rx="1.5" />
      <rect x="54" y="44" width="9" height="40" rx="1.5" />
      <rect x="71" y="44" width="9" height="40" rx="1.5" />
      <rect x="13" y="87" width="74" height="6" />
      <rect x="8" y="96" width="84" height="4" />
    </svg>
  );
}

/* The "Powered by Archive.org" explainer. The credit is deliberately not a bare
   outbound link: "powered by" could read as a partnership, so the click opens
   this sheet, which says plainly what the relationship actually is — the Internet
   Archive is the journal's content store, not a sponsor — and only THEN links
   out. Matches the SourceLightbox sheet: scrim + Esc + body-scroll lock. */
function ArchiveCmsModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fade-in" role="dialog" aria-modal="true" aria-label="Powered by Archive.org" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 7000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 22, background: "rgba(8,7,5,0.62)", WebkitBackdropFilter: "blur(2px)", backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "calc(100vh - 44px)", overflow: "auto",
        background: "var(--paper)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "10px 10px 0 rgba(22,20,13,0.22)",
        animation: "pop .14s ease", padding: "26px 28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ArchiveOrgMark size={30} />
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Powered by Archive.org</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, padding: 6, margin: -6, cursor: "pointer", color: "var(--ink-soft)", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <h2 style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: 34, lineHeight: 1.0, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 16px" }}>
          The Internet Archive is our newsroom's CMS.
        </h2>
        <div style={{ fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.55, color: "var(--ink)" }}>
          <p style={{ margin: "0 0 13px" }}>
            Most newsrooms keep their stories in a private database. We don't. Every article we publish — and every source it cites — is written straight to the Internet Archive as a public, timestamped snapshot.
          </p>
          <p style={{ margin: "0 0 13px" }}>
            That snapshot <em>is</em> the page you're reading. There's no separate copy on a server we control that could quietly change or vanish. The record lives at archive.org, where anyone can read it, fetch it, or keep their own copy.
          </p>
          <p style={{ margin: 0 }}>
            So the journal doesn't depend on us staying online. If this site disappeared tomorrow, the stories and their receipts would still be there — public, dated, and verifiable by anyone.
          </p>
        </div>
        <p className="np-mono" style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ink-soft)", margin: "18px 0 0", paddingTop: 16, borderTop: "1px solid var(--rule)" }}>
          The Nashville Peoples' Journal isn't affiliated with or endorsed by the Internet Archive. We build on their public infrastructure, the same as anyone can.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20, flexWrap: "wrap" }}>
          <a className="btn" href="https://archive.org" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}>Visit archive.org ↗</a>
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Footer ---- */
function FrontFooter() {
  const mobile = window.useIsMobile();
  const wide = !window.useIsMobile(SHELL_MIN); // match the front-page shell
  const [cmsOpen, setCmsOpen] = useState(false);
  return (
    <footer style={{ background: "var(--ink)", color: "#e3ddcc", marginTop: 36 }}>
      <div className="npj-footer-inner" style={{ width: wide ? SHELL_W : undefined, maxWidth: 1760, margin: "0 auto", padding: wide ? "24px 0" : (mobile ? "24px 16px" : "24px 72px"), display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ position: "relative", display: "inline-block", width: 15, height: 13, borderBottom: "3px solid var(--yellow)", flexShrink: 0 }}>
          <span style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 3, height: 10, background: "var(--yellow)" }} />
        </span>
        <span style={{ fontStyle: "italic", fontSize: 16.5 }}>Every underlined claim stands on an archived source.</span>
        <span style={{ flex: 1, minWidth: 20 }} />
        <button onClick={() => window.__nav && window.__nav.contributors && window.__nav.contributors()} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#e3ddcc", fontSize: 11, letterSpacing: ".06em", textDecoration: "underline", textUnderlineOffset: 3 }}>Contributors</button>
        <button onClick={() => setCmsOpen(true)} className="np-mono" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: 0, padding: 0, cursor: "pointer", color: "#e3ddcc", fontSize: 11, letterSpacing: ".06em" }}>
          <ArchiveOrgMark />
          <span style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Powered by Archive.org</span>
        </button>
        <span className="np-mono" style={{ fontSize: 11, color: "#8c8676" }}>NPJ · Nashville Peoples' Journalism · text CC BY</span>
      </div>
      {cmsOpen && <ArchiveCmsModal onClose={() => setCmsOpen(false)} />}
    </footer>
  );
}

/* ---- Empty state ---- */
function EmptyFront({ col, sections, onNewsroom, onSubmit }) {
  return (
    <div style={{ maxWidth: 720, margin: "40px auto", textAlign: "center", padding: "10px 0 30px" }}>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 14 }}>{col ? col + " · column" : "The record starts here"}</div>
      <h1 className="npj-empty-h" style={{ fontFamily: "var(--display)", fontSize: 64, lineHeight: .95, margin: "0 0 16px" }}>
        {col ? "Nothing filed under " + col + " yet." : "No stories published yet."}
      </h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 19, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "52ch", margin: "0 auto 26px" }}>
        People's Journalism is community-created, community-backed and community-edited. Every piece is sourced to an archived snapshot and stays open to public suggestion. The first stories are being written now.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={onNewsroom} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> Open the Newsroom</button>
        <button className="btn" onClick={onSubmit} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.arrow style={{ fontSize: 14 }} /> Submit a tip</button>
      </div>
      {sections.length > 1 && (
        <div style={{ marginTop: 34, paddingTop: 20, borderTop: "1.5px solid var(--rule)" }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 10 }}>Columns</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {sections.map(s => <span key={s} className="np-mono" style={{ fontSize: 12, border: "1.5px solid var(--ink)", padding: "5px 11px", background: "var(--card)" }}>{s}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Shared sub-components ---- */
function UnpubBadge({ small }) {
  return <span className="np-mono" style={{ fontSize: small ? 9 : 10, fontWeight: 600, letterSpacing: ".06em", color: "var(--reject)", border: "1px solid var(--reject)", padding: small ? "1px 5px" : "2px 7px", textTransform: "uppercase" }}>⊘ Unpublished</span>;
}

/* Admin-only marker on a piece whose release is still ahead — it's committed to
   the record but held off the public front page until `releaseAt`. Shows the
   release moment so the admin knows when it drops. */
function SchedBadge({ small, when }) {
  const label = (() => {
    const d = new Date(when);
    if (isNaN(d.getTime())) return "Scheduled";
    return "⧖ " + d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  })();
  return <span className="np-mono" title={"Scheduled to publish " + when} style={{ fontSize: small ? 9 : 10, fontWeight: 600, letterSpacing: ".06em", color: "var(--yellow, #b8860b)", border: "1px solid currentColor", padding: small ? "1px 5px" : "2px 7px", textTransform: "uppercase" }}>{label}</span>;
}

function TagRow({ tags, small }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {tags.map(t => <span key={t} className="np-mono" style={{ fontSize: small ? 9.5 : 11, border: "1px solid var(--ink)", padding: "2px 7px", background: "var(--paper-2)" }}>#{t}</span>)}
    </div>
  );
}

/* ---- One front-page card, arranged by its chosen template ----
   `variant` sets the type scale (lead = cover, card = secondary row); `template`
   is a FRONT_CARD_TEMPLATES key (image-top / image-left / overlay / …) that
   decides where the photo sits relative to the title + subtitle. The same card
   renders every placement, so the admin's pick and the public page never drift. */
function FrontCard({ item, template, variant, onOpen, stack }) {
  const mobile = window.useIsMobile();
  const lead = variant === "lead";
  const T = (window.FRONT_CARD_TEMPLATES && window.FRONT_CARD_TEMPLATES[template]) || { img: lead ? "below" : "top" };
  const place = T.img; // below | top | left | right | behind | none
  const open = () => onOpen && onOpen(item.slug);
  const hasPhoto = !!(item.image && item.image.src && window.MediaImg) && place !== "none";
  const kicker = lead ? (item.kicker || "Cover Story") : ((item.tags || [])[0] || item.kicker || "Latest");

  const KickerEl = ({ light }) => (
    <div className="np-mono" style={{ fontWeight: 600, fontSize: lead ? 12.5 : 12, letterSpacing: ".16em", textTransform: "uppercase",
      color: light ? "rgba(255,255,255,.92)" : (lead ? "var(--reject)" : "var(--ink-soft)"), marginBottom: lead ? 14 : 12, display: "flex", alignItems: "center", gap: 8 }}>
      {kicker}
      {item.status === "unpublished" && <UnpubBadge small={!lead} />}
      {item._scheduled && <SchedBadge small={!lead} when={item.releaseAt} />}
    </div>
  );
  const TitleEl = ({ light }) => (
    <h2 onClick={open} className={lead ? "npj-cover-h" : undefined} style={ lead
      ? { fontFamily: "var(--display)", fontWeight: 400, fontSize: 44, lineHeight: .94, letterSpacing: ".002em", textTransform: "uppercase", margin: "0 0 16px", cursor: "pointer", color: light ? "#fff" : "var(--ink)" }
      : { fontFamily: "var(--cond)", fontWeight: 700, fontSize: 28, lineHeight: 1.04, textTransform: "uppercase", margin: "0 0 12px", cursor: "pointer", color: light ? "#fff" : "var(--ink)" } }>
      {item.headline}
    </h2>
  );
  const DekEl = ({ light }) => item.dek ? (
    <p style={{ fontSize: lead ? 22 : 17.5, lineHeight: 1.5, margin: lead ? "0 0 20px" : "12px 0 16px", maxWidth: lead ? "60ch" : undefined,
      color: light ? "rgba(255,255,255,.9)" : "var(--ink)" }}>{item.dek}</p>
  ) : null;
  // The version chip the article header carries (⊛ v.<sha>), pulled through to the
  // cover so the front page leads with the same provenance receipt. It mirrors
  // window.VersionBadge's look, but is inlined here because the front page paints
  // before the versions module (with its diff viewer) lazy-loads; clicking it just
  // opens the article, where the full edit history lives.
  const VersionChip = () => (lead && item.base_sha) ? (
    <button onClick={open} className="np-mono" title="Open the article to see its edit history"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1.5px solid var(--ink)",
        background: "var(--card)", color: "var(--ink)", padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>
      <span style={{ fontFamily: "var(--mono)" }}>⊛</span> v.{item.base_sha}
    </button>
  ) : null;
  // The cover's meta line reads like the article header: the version chip, then the
  // date · read time. Secondary cards keep the plain short date.
  const MetaEl = () => item.published ? (
    lead ? (
      <div className="np-mono" style={{ fontSize: 13, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <VersionChip />
        <span>
          {fmtDate(item.published)}
          {item.updated && item.updated !== item.published ? " · updated " + shortDate(item.updated) : ""}
          {item.readMins ? " · " + item.readMins + " min" : ""}
        </span>
      </div>
    ) : (
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-soft)" }}>
        {shortDate(item.published)}
      </div>
    )
  ) : null;
  // The opening of the story, pulled through into the cover's text column to fill
  // the space beside a tall photo. It's deliberately generous — the column clips
  // it to the photo's height with a fade, so only as much as fits is ever shown.
  const ExcerptEl = () => (lead && item.excerpt) ? (
    <div style={{ margin: "18px 0 0" }}>
      {String(item.excerpt).split(/\n\n+/).map((para, i) => (
        <p key={i} style={{ fontSize: 17, lineHeight: 1.6, margin: i === 0 ? 0 : "12px 0 0", color: "var(--ink)" }}>{para}</p>
      ))}
    </div>
  ) : null;
  const TagsEl = () => (lead && (item.tags || []).length > 0) ? <div style={{ marginTop: 12 }}><TagRow tags={item.tags} /></div> : null;
  const hasByline = ((item.authors || []).length || (item.editors || []).length || (item.byline || "").trim());
  // On the cover the byline hangs like the article header: the avatars sit flush
  // with the headline's left edge and the "Written By" / "Edited by" labels reach
  // out into the left margin. Only on desktop — a phone has no margin to hang into,
  // so it falls back to the inline "By …" form.
  const BylineEl = () => (hasByline && window.Byline) ? (
    <div style={{ margin: lead ? "0 0 16px" : "0 0 12px" }}>
      <window.Byline authors={item.authors} editors={item.editors} byline={item.byline} hang={lead && !mobile} />
    </div>
  ) : null;

  const photoHeight = place === "below" ? (lead ? null : 220)
    : place === "top" ? (lead ? 320 : 270)
    : place === "behind" ? (lead ? 360 : 300)
    : (lead ? 260 : 160); // left / right
  const Photo = ({ h, dark }) => {
    if (!hasPhoto) return h ? <Placeholder label="photo" h={h} dark={dark} /> : null;
    // A fixed-height frame (secondary cards, overlays, the row thumbnails) always
    // fills — zoomed/cropped to cover — so a "show whole image" (contain) photo
    // doesn't strand itself in a letterboxed box. We drop the author's fit/crop
    // in that case and let the plain <img objectFit:cover> path fill the frame.
    // Only the cover story's auto-height photo (h == null) keeps the author's
    // fit/crop and shows the whole frame at its natural ratio.
    const fill = !!h;
    return (
      <button onClick={open} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
        <window.MediaImg srcs={[item.image.store, item.image.src]} alt={item.image.description || item.image.caption || item.headline || ""}
          {...(fill ? {} : { fit: item.image.fit, crop: item.image.crop })}
          style={{ width: "100%", height: h ? h : "auto", objectFit: h ? "cover" : undefined, display: "block", border: "1.5px solid var(--ink)" }} />
      </button>
    );
  };
  // The headline photo's caption + credit, surfaced under the cover image (the
  // same caption the author writes on the banner in the editor and that the
  // article page shows). Only the cover story carries it — secondary thumbnails
  // stay clean — and never under an overlay (place "behind"), where it'd land on
  // the scrim. The credit is markdown ([outlet](url)), rendered safely.
  const PhotoCaption = () => {
    if (!lead || !hasPhoto) return null;
    const cap = item.image.caption, cred = item.image.credit;
    if (!cap && !cred) return null;
    return (
      <figcaption className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.45 }}>
        {cap ? <span>▢ {cap}</span> : null}
        {cred ? (
          <span style={{ display: cap ? "block" : "inline", marginTop: cap ? 2 : 0 }}>
            <span className="np-eyebrow" style={{ fontSize: 9.5, letterSpacing: ".05em", marginRight: 5 }}>Credit</span>
            {window.npjRichText ? window.npjRichText(cred) : cred}
          </span>
        ) : null}
      </figcaption>
    );
  };

  // Title over the photo (with a legibility scrim); meta + tags drop below it.
  if (place === "behind") {
    return (
      <div>
        <div style={{ position: "relative", border: "1.5px solid var(--ink)" }}>
          <Photo h={photoHeight} dark />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end",
            padding: lead ? 28 : 18, background: "linear-gradient(to top, rgba(0,0,0,.82) 8%, rgba(0,0,0,.32) 55%, rgba(0,0,0,0) 85%)" }}>
            <KickerEl light />
            <TitleEl light />
            <DekEl light />
          </div>
        </div>
        <div style={{ marginTop: 12 }}><BylineEl /><MetaEl /><TagsEl /></div>
      </div>
    );
  }

  const Text = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <KickerEl /><BylineEl /><TitleEl /><DekEl /><MetaEl /><TagsEl />
    </div>
  );

  // Photo beside the text — collapses to stacked on phones.
  if (place === "left" || place === "right") {
    return (
      <div style={{ display: "flex", flexDirection: mobile ? "column" : (place === "right" ? "row-reverse" : "row"), gap: lead ? 28 : 18, alignItems: "flex-start" }}>
        <div style={{ flex: mobile ? "none" : ("0 0 " + (lead ? "44%" : "40%")), width: mobile ? "100%" : undefined, marginBottom: mobile ? 16 : 0 }}>
          <Photo h={photoHeight} /><PhotoCaption />
        </div>
        {Text}
      </div>
    );
  }

  // Photo on top of the text.
  if (place === "top") {
    return (
      <div>
        <div style={{ marginBottom: lead ? 18 : 20 }}><Photo h={photoHeight} /><PhotoCaption /></div>
        {Text}
      </div>
    );
  }

  // The cover story, on desktop, reads as two columns: the title + subtitle text
  // in one column and the photo beside it, the text column matched to the photo's
  // height (the photo is the height authority; the text is clipped to it with a
  // fade so an overlong standfirst reads as "continued", not cut off). On phones
  // and in secondary cards the photo stays below the text as before.
  // `stack` (set when the cover shares the row with the 1/3 rail) keeps the cover
  // as a single stacked column — headline, photo, standfirst — instead of splitting
  // text|photo, which would be too tight in the narrower 2/3 lane.
  const useTwoColCover = lead && place === "below" && hasPhoto && !mobile && !stack;
  if (useTwoColCover) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 36, alignItems: "stretch" }}>
        {/* text column — carries no in-flow height of its own (its contents are
            absolutely placed), so the grid row's height is set purely by the
            photo column, and overflow:hidden clips the text to exactly that. */}
        <div style={{ position: "relative", minWidth: 0 }}>
          {/* The text is clipped to the photo's height. We use clip-path rather than
              overflow:hidden so the clip is vertical only (top/right/bottom) and
              LEFT is left open (inset … -120px): that lets the cover's hanging
              "Written By"/"Edited by" labels reach out past the column's left edge
              into the page margin — the headline stays put and the avatars stay
              flush with its left line, exactly like the article header. */}
          <div style={{ position: "absolute", inset: 0, clipPath: "inset(0 0 0 -120px)" }}>
            <KickerEl /><TitleEl /><DekEl /><MetaEl /><BylineEl /><ExcerptEl /><TagsEl />
            {/* the column clips the excerpt to the photo's height; the fade signals
                "continued" and carries a trailing ellipsis at the cut so it reads as
                a truncation, not a sentence that simply stopped. */}
            <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 64,
              background: "linear-gradient(to top, var(--paper) 14%, rgba(246,241,228,0))", pointerEvents: "none",
              display: "flex", alignItems: "flex-end" }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 17, lineHeight: 1, color: "var(--ink)" }}>…</span>
            </div>
          </div>
        </div>
        <div style={{ minWidth: 0 }}><Photo h={null} /><PhotoCaption /></div>
      </div>
    );
  }

  // "below" (title + subtitle, then photo, then meta) and "none" (text only). The
  // cover keeps its date up with the rest of the header text, above the photo;
  // secondary cards keep the date in the footer under the photo.
  return (
    <div>
      <KickerEl />{lead ? <MetaEl /> : null}<BylineEl /><TitleEl /><DekEl />
      {place === "below" && (hasPhoto
        ? <div style={{ margin: lead ? "0 0 18px" : "0 0 14px", maxWidth: lead ? 640 : undefined }}><Photo h={lead ? null : 220} /><PhotoCaption /></div>
        : (lead ? <div style={{ margin: "0 0 18px", maxWidth: 640 }}><Placeholder label="hero image" h={300} /></div> : null))}
      {lead ? null : <MetaEl />}<TagsEl />
    </div>
  );
}

/* A compact "brief" for the 1/3 rail beside the cover. Deliberately lighter than
   a full FrontCard — a small photo, a kicker, a tight headline and the date — so
   a handful stack in the rail without competing with the cover story. Clicking
   the photo or the headline opens the piece; badges (unpublished / scheduled)
   carry through so the admin still sees a brief's state at a glance. */
function SideCard({ item, onOpen }) {
  const open = () => onOpen && onOpen(item.slug);
  const hasPhoto = !!(item.image && item.image.src && window.MediaImg);
  const kicker = (item.tags || [])[0] || item.kicker || "Latest";
  return (
    <article>
      {hasPhoto && (
        <button onClick={open} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", marginBottom: 12 }}>
          {/* A brief's photo always fills its frame (zoomed/cropped to cover),
              never letterboxed — so we skip the author's fit/crop and let the
              plain <img objectFit:cover> path do the fill. */}
          <window.MediaImg srcs={[item.image.store, item.image.src]} alt={item.image.description || item.image.caption || item.headline || ""}
            style={{ width: "100%", height: 150, objectFit: "cover", display: "block", border: "1.5px solid var(--ink)" }} />
        </button>
      )}
      <div className="np-mono" style={{ fontWeight: 600, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
        color: "var(--ink-soft)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {kicker}
        {item.status === "unpublished" && <UnpubBadge small />}
        {item._scheduled && <SchedBadge small when={item.releaseAt} />}
      </div>
      <h3 onClick={open} style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 22, lineHeight: 1.05,
        textTransform: "uppercase", margin: "0 0 8px", cursor: "pointer", color: "var(--ink)" }}>
        {item.headline}
      </h3>
      {item.dek && <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.45, margin: "0 0 8px", color: "var(--ink-soft)" }}>{item.dek}</p>}
      {item.published && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{shortDate(item.published)}</div>}
    </article>
  );
}

/* ---- Front-page lineup ----
   The page is a two-column masthead-width grid: the cover story owns the left
   2/3, and exactly the next two stories stack in a 1/3 rail on the right — one
   hero, two beside it, always. The rail sizes to its contents and hangs from
   the top, so with only a story or two the empty space beneath it is
   deliberate headroom — room for the lineup to grow, not a gap to fill. Once
   the rail's two slots are full, further stories spill into a full-width list
   of rows below both columns. On phones the whole thing collapses to one
   column: cover, then the two rail briefs, then the overflow list, top to
   bottom. */
function FrontLineup({ items, onOpen }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const mobile = window.useIsMobile();
  const front = layout.front || {};
  // The cover is ALWAYS the most-recently-touched live piece — `items` arrives
  // ordered by last update (see byNewest), so a freshly edited older story takes
  // the cover, and this never depends on admin curation. A scheduled piece is
  // future-dated (it can sort first in that raw order) but isn't live yet,
  // so it can't claim the cover; prefer a released piece and fall back to a
  // scheduled one only when there's nothing else (the admin preview). Without
  // this, a hotswap pin set for an older piece would keep it on the cover
  // forever, even after a genuinely newer story publishes or is updated.
  const lead = items.find(a => a.status !== "unpublished" && !a._scheduled)
    || items.find(a => a.status !== "unpublished") || items[0];
  // Admin curation (the hotswap) still governs how everything ELSE lines up —
  // the rail vs. the overflow feed — just never who's on the cover.
  const ordered = window.orderFrontItems(items, front);
  const rest = ordered.filter(a => a !== lead);
  // The rail holds exactly the next two stories beside the cover — one hero
  // left, two beside it right, so the top of the page reads as a fixed
  // three-story masthead block. Everything past it drops into the overflow list.
  const RAIL_MAX = 2;
  const rail = rest.slice(0, RAIL_MAX);
  const feed = rest.slice(RAIL_MAX);
  const hasRail = rail.length > 0;
  const tpl = (slug, pos) => window.cardTemplateFor(layout, slug, pos);
  // Overflow reads as a single-column list of rows (photo beside the text, not
  // stacked above it — a full-width row is too wide for a top-mounted photo to
  // read well); an explicit per-article template override still wins.
  const feedTpl = (slug) => (front.cards && front.cards[slug]) ? front.cards[slug] : "image-left";

  return (
    <>
      <div className={hasRail ? "npj-front-grid" : undefined}>
        {/* Cover story — the left 2/3. With a rail beside it the cover stacks
            (headline → photo → standfirst) so it holds the lane cleanly; on its
            own it keeps its full-width two-column treatment. Laid out by its
            template (admin-chosen or inherited). */}
        {lead && (
          <section className="npj-cover npj-front-main" style={{ paddingBottom: hasRail ? 0 : 44 }}>
            <FrontCard item={lead} variant="lead" template={tpl(lead.slug, "lead")} stack={hasRail && !mobile} onOpen={onOpen} />
          </section>
        )}

        {/* The 1/3 rail — the next few stories as compact briefs. */}
        {hasRail && (
          <aside className="npj-front-side">
            <div className="np-eyebrow npj-side-head" style={{ color: "var(--ink-soft)" }}>More stories</div>
            {rail.map((s, i) => (
              <div key={s.slug || i} className="npj-side-item">
                <SideCard item={s} onOpen={onOpen} />
              </div>
            ))}
          </aside>
        )}
      </div>

      {/* Overflow — a full-width grid that appears only once the rail is full.
          This is the "when there's more" spillover the front page grows into. */}
      {feed.length > 0 && (
        <section className="npj-feed" style={{ borderTop: "2.5px solid var(--ink)", marginTop: hasRail ? 40 : 0, paddingTop: 8 }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "12px 0 18px" }}>More from the newsroom</div>
          <div className="npj-feed-grid">
            {feed.map((s, i) => (
              <div key={s.slug || i} className="npj-feed-item">
                <FrontCard item={s} variant="card" template={feedTpl(s.slug)} onOpen={onOpen} />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

Object.assign(window, { Masthead, FrontPage, FrontCard, SideCard, Placeholder, TagRow, dedupeArticles });
