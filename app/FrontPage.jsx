/* NPJ masthead + front page — revamped layout.
   The masthead is a two-piece chrome: a yellow header band (logo + taglines +
   utility links) and a dark section nav bar. On desktop the whole front page is
   a centered 2/3-width column: a one-up cover story, a 3-across row, then the
   rest as a single vertical feed. Each piece renders through its admin-chosen
   layout template (FrontCard); the lineup order + templates come from
   layout.front (see app/layout.jsx, app/AdminEditor.jsx). */

// Desktop front-page shell: a centered column 2/3 of the screen wide (capped so
// it never runs away on ultra-wide displays). On phones every container goes
// full-width (handled per-component via useIsMobile + the existing mobile CSS).
const SHELL_W = "min(66.67vw, 1760px)";

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
  const tight = narrow && !mobile; // apply the 2/3 column only on desktop
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
            <div className="npj-search" style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 30, flex: "0 1 240px", minWidth: 70 }}>
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
function FrontPage({ onOpen, onNewsroom, onHome }) {
  const { layout, isAdmin } = React.useContext(window.LayoutCtx);
  const mobile = window.useIsMobile();
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
  const visible = all.filter(a => a.status !== "unpublished");
  const shown = col ? visible.filter(a => (a.tags || []).includes(col)) : visible;

  return (
    <div className="fade-in">
      <Masthead route="home" onHome={onHome} onNewsroom={onNewsroom} narrow
        activeColumn={col} onColumn={(name) => setCol(c => (c === name || isLatest(name)) ? null : name)} />
      <main style={{ width: mobile ? undefined : SHELL_W, maxWidth: 1760, margin: "0 auto", padding: mobile ? "24px 0 0" : "34px 0 0" }}>
        {shown.length === 0
          ? <EmptyFront col={col} sections={sections} onNewsroom={onNewsroom} onSubmit={() => window.__nav && window.__nav.submit()} />
          : <FrontLineup items={shown} onOpen={onOpen} />}
      </main>
      <FrontFooter />
    </div>
  );
}

/* ---- Footer ---- */
function FrontFooter() {
  const mobile = window.useIsMobile();
  return (
    <footer style={{ background: "var(--ink)", color: "#e3ddcc", marginTop: 36 }}>
      <div className="npj-footer-inner" style={{ width: mobile ? undefined : SHELL_W, maxWidth: 1760, margin: "0 auto", padding: mobile ? "24px 16px" : "24px 0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ position: "relative", display: "inline-block", width: 15, height: 13, borderBottom: "3px solid var(--yellow)", flexShrink: 0 }}>
          <span style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 3, height: 10, background: "var(--yellow)" }} />
        </span>
        <span style={{ fontStyle: "italic", fontSize: 16.5 }}>Every underlined claim stands on an archived source.</span>
        <span style={{ flex: 1, minWidth: 20 }} />
        <button onClick={() => window.__nav && window.__nav.contributors && window.__nav.contributors()} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#e3ddcc", fontSize: 11, letterSpacing: ".06em", textDecoration: "underline", textUnderlineOffset: 3 }}>Contributors</button>
        <span className="np-mono" style={{ fontSize: 11, color: "#8c8676" }}>NPJ · Nashville Peoples' Journalism · text CC BY · documents public record</span>
      </div>
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
function FrontCard({ item, template, variant, onOpen }) {
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
  const MetaEl = () => item.published ? (
    <div style={{ fontFamily: "var(--mono)", fontSize: lead ? 13 : 12, color: "var(--ink-soft)" }}>
      {lead ? fmtDate(item.published) : shortDate(item.published)}
      {lead && item.updated && item.updated !== item.published ? " · updated " + shortDate(item.updated) : ""}
    </div>
  ) : null;
  const TagsEl = () => (lead && (item.tags || []).length > 0) ? <div style={{ marginTop: 12 }}><TagRow tags={item.tags} /></div> : null;

  const photoHeight = place === "below" ? (lead ? null : 220)
    : place === "top" ? (lead ? 420 : 270)
    : place === "behind" ? (lead ? 460 : 300)
    : (lead ? 300 : 160); // left / right
  const Photo = ({ h, dark }) => {
    if (!hasPhoto) return h ? <Placeholder label="photo" h={h} dark={dark} /> : null;
    return (
      <button onClick={open} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
        <window.MediaImg srcs={[item.image.store, item.image.src]} alt={item.image.caption || item.headline || ""}
          fit={item.image.fit} crop={item.image.crop}
          style={{ width: "100%", height: h ? h : "auto", objectFit: h ? "cover" : undefined, display: "block", border: "1.5px solid var(--ink)" }} />
      </button>
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
        <div style={{ marginTop: 12 }}><MetaEl /><TagsEl /></div>
      </div>
    );
  }

  const Text = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <KickerEl /><TitleEl /><DekEl /><MetaEl /><TagsEl />
    </div>
  );

  // Photo beside the text — collapses to stacked on phones.
  if (place === "left" || place === "right") {
    return (
      <div style={{ display: "flex", flexDirection: mobile ? "column" : (place === "right" ? "row-reverse" : "row"), gap: lead ? 28 : 18, alignItems: "flex-start" }}>
        <div style={{ flex: mobile ? "none" : ("0 0 " + (lead ? "44%" : "40%")), width: mobile ? "100%" : undefined, marginBottom: mobile ? 16 : 0 }}>
          <Photo h={photoHeight} />
        </div>
        {Text}
      </div>
    );
  }

  // Photo on top of the text.
  if (place === "top") {
    return (
      <div>
        <div style={{ marginBottom: lead ? 18 : 20 }}><Photo h={photoHeight} /></div>
        {Text}
      </div>
    );
  }

  // "below" (title + subtitle, then photo, then meta) and "none" (text only).
  return (
    <div>
      <KickerEl /><TitleEl /><DekEl />
      {place === "below" && (hasPhoto
        ? <div style={{ margin: lead ? "0 0 18px" : "0 0 14px" }}><Photo h={lead ? null : 220} /></div>
        : (lead ? <div style={{ margin: "0 0 18px" }}><Placeholder label="hero image" h={420} /></div> : null))}
      <MetaEl /><TagsEl />
    </div>
  );
}

/* ---- Front-page lineup ---- */
function FrontLineup({ items, onOpen }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const front = layout.front || {};
  // Admin curation: an explicit slug order (the hotswap) wins; otherwise the
  // newest-first order the record came in with.
  const ordered = window.orderFrontItems(items, front);
  const lead = ordered.find(a => a.status !== "unpublished") || ordered[0];
  const rest = ordered.filter(a => a !== lead);
  const row2 = rest.slice(0, 3);   // the 3-across row
  const feed = rest.slice(3);      // everything else — a vertical feed
  const tpl = (slug, pos) => window.cardTemplateFor(layout, slug, pos);
  // Feed rows read best as side-by-side (photo + text) cards; an explicit
  // per-article template override still wins.
  const feedTpl = (slug) => (front.cards && front.cards[slug]) ? front.cards[slug] : "image-left";

  return (
    <>
      {/* Cover story — laid out by its template (admin-chosen or inherited) */}
      {lead && (
        <section className="npj-cover" style={{ paddingBottom: 44 }}>
          <FrontCard item={lead} variant="lead" template={tpl(lead.slug, "lead")} onOpen={onOpen} />
        </section>
      )}

      {/* Second row — up to 3 cards in a column grid */}
      {row2.length > 0 && (
        <section className="npj-row2" style={{ borderTop: "2.5px solid var(--ink)", display: "grid", gridTemplateColumns: `repeat(${Math.min(row2.length, 3)}, 1fr)` }}>
          {row2.map((s, i) => {
            const isLast = i === row2.length - 1;
            return (
              <div key={s.slug || i} style={{ padding: "26px " + (isLast ? "0" : "36px") + " 34px " + (i === 0 ? "0" : "36px"), borderRight: isLast ? "none" : "1.5px solid var(--ink)" }}>
                <FrontCard item={s} variant="card" template={tpl(s.slug, "card")} onOpen={onOpen} />
              </div>
            );
          })}
        </section>
      )}

      {/* The rest — a single vertical feed of side-by-side cards */}
      {feed.length > 0 && (
        <section style={{ borderTop: "2.5px solid var(--ink)", paddingTop: 8 }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "12px 0 2px" }}>More from the newsroom</div>
          {feed.map((s, i) => (
            <div key={s.slug || i} style={{ padding: "22px 0", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
              <FrontCard item={s} variant="card" template={feedTpl(s.slug)} onOpen={onOpen} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

Object.assign(window, { Masthead, FrontPage, FrontCard, Placeholder, TagRow });
