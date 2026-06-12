/* NPJ masthead + front page — revamped layout.
   The masthead is now a two-piece chrome: a yellow header band (logo +
   taglines + utility links) and a dark section nav bar. The front page
   drops the manifesto strip and restructures the lineup into a full-bleed
   cover story, a three-column second row, and a compact "More" list. */

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

/* ---- Masthead ---- */
function Masthead({ route, onHome, onNewsroom, activeColumn, onColumn }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const sections = (layout.sections || []).map(s => s.name);
  const utility = layout.utility || [];
  const taglines = layout.taglines || [];
  const navFor = (n) => (window.__nav && window.__nav[n]) ? window.__nav[n] : onHome;
  const clickColumn = (name) => { if (onColumn) onColumn(name); else onHome(); };
  const displayTaglines = taglines.length > 0 ? taglines : ["created", "backed", "edited"];

  return (
    <header>
      {/* yellow masthead band */}
      <div className="npj-masthead" style={{ background: "var(--yellow)", padding: "22px 72px 26px" }}>
        <div style={{ maxWidth: 1760, margin: "0 auto", display: "flex", alignItems: "center", gap: 32 }}>
          <button onClick={onHome} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", margin: "-8px 0 -10px -14px", flexShrink: 0 }}>
            <img className="npj-logo" src="https://storage.googleapis.com/intelechia-content/im/NPD%20wide.png" alt="People's Journalism" style={{ height: 168, display: "block" }} />
          </button>
          <div style={{ flex: 1 }} />
          <div className="npj-hide-sm" style={{ display: "flex", alignItems: "stretch", gap: 28 }}>
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
          </div>
        </div>
      </div>

      {/* dark section nav — hidden inside the article reader to avoid toolbar stacking */}
      {route !== "article" && (
        <nav style={{ background: "var(--ink)", color: "var(--paper)" }}>
          <div className="npj-nav-inner" style={{ maxWidth: 1760, margin: "0 auto", padding: "0 72px", display: "flex", alignItems: "stretch", height: 58 }}>
            {sections.map((s, i) => {
              const on = activeColumn ? activeColumn === s : i === 0;
              return (
                <button key={s + i} onClick={() => clickColumn(s)} style={{
                  flexShrink: 0, display: "flex", alignItems: "center", padding: "0 26px",
                  background: on ? "var(--yellow)" : "none",
                  color: on ? "var(--ink)" : "var(--paper)",
                  border: 0, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 17,
                  letterSpacing: ".1em", textTransform: "uppercase", cursor: "pointer"
                }}>{s}</button>
              );
            })}
            <div style={{ flex: 1 }} />
            <div className="npj-search" style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 30, flex: "0 1 240px", minWidth: 70 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 14, color: "#8c8676" }}>⌕</span>
              <input type="text" placeholder="Search records, snapshots…" style={{ width: "100%", minWidth: 0, border: 0, borderBottom: "1px solid rgba(255,255,255,.35)", background: "transparent", fontFamily: "var(--mono)", fontSize: 13, color: "var(--paper)", outline: "none", padding: "4px 0" }} />
            </div>
            <button onClick={() => window.__nav && window.__nav.submit && window.__nav.submit()} style={{
              display: "flex", alignItems: "center", alignSelf: "center", flexShrink: 0, whiteSpace: "nowrap",
              background: "var(--yellow)", color: "var(--ink)", padding: "9px 20px",
              fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, letterSpacing: ".1em",
              textTransform: "uppercase", border: 0, cursor: "pointer"
            }}>Submit a story</button>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ---- Archive status strip ---- */
function ArchiveStrip() {
  const snaps = (window.NPJ && window.NPJ.SOURCES) ? Object.keys(window.NPJ.SOURCES).length : null;
  if (snaps === 0) return null;
  return (
    <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--rule)" }}>
      <div className="npj-strip-inner" style={{ maxWidth: 1760, margin: "0 auto", padding: "11px 72px", display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-soft)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--reject)", display: "inline-block", flexShrink: 0 }} />
        {snaps !== null
          ? <span><strong style={{ color: "var(--ink)" }}>{snaps}</strong> sources captured</span>
          : <span>Sources archived to web.archive.org</span>
        }
        <span style={{ flex: 1 }} />
        <button onClick={() => window.__nav && window.__nav.explore && window.__nav.explore()} style={{
          background: "none", border: 0, padding: 0, cursor: "pointer",
          color: "var(--ink)", fontFamily: "var(--mono)", fontWeight: 600,
          fontSize: 12, letterSpacing: ".06em", textDecoration: "underline", textUnderlineOffset: 3
        }}>OPEN THE ARCHIVE →</button>
      </div>
    </div>
  );
}

/* ---- Front Page ---- */
function FrontPage({ onOpen, onNewsroom, onHome }) {
  const { layout, isAdmin } = React.useContext(window.LayoutCtx);
  const F = window.NPJ.FRONT || {};
  const sections = (layout.sections || []).map(s => s.name);
  const [col, setCol] = useState(null);

  const all = [];
  if (F.lead) all.push({ ...F.lead, _lead: true, tags: F.lead.tags || [] });
  (F.secondary || []).forEach(s => all.push({ ...s, tags: s.tags || [] }));
  const visible = all.filter(a => isAdmin || a.status !== "unpublished");
  const shown = col ? visible.filter(a => (a.tags || []).includes(col)) : visible;

  return (
    <div className="fade-in">
      <Masthead route="home" onHome={onHome} onNewsroom={onNewsroom}
        activeColumn={col} onColumn={(name) => setCol(c => c === name ? null : name)} />
      <ArchiveStrip />
      <main style={{ maxWidth: 1760, margin: "0 auto", padding: "34px 72px 0" }}>
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
  return (
    <footer style={{ background: "var(--ink)", color: "#e3ddcc", marginTop: 36 }}>
      <div className="npj-footer-inner" style={{ maxWidth: 1760, margin: "0 auto", padding: "24px 72px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ position: "relative", display: "inline-block", width: 15, height: 13, borderBottom: "3px solid var(--yellow)", flexShrink: 0 }}>
          <span style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 3, height: 10, background: "var(--yellow)" }} />
        </span>
        <span style={{ fontStyle: "italic", fontSize: 16.5 }}>Every underlined claim stands on an archived source.</span>
        <span style={{ flex: 1, minWidth: 20 }} />
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
      {sections.length > 0 && (
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

/* ---- Front-page lineup ---- */
function FrontLineup({ items, onOpen }) {
  const lead = items.find(a => a.status !== "unpublished") || items[0];
  const rest = items.filter(a => a !== lead);
  const row2 = rest.slice(0, 3);
  const more = rest.slice(3);
  const open = (a) => onOpen && onOpen(a.slug);

  return (
    <>
      {/* Cover story: title, then the banner directly underneath, then the meta */}
      <section className="npj-cover" style={{ paddingBottom: 44 }}>
        <div className="np-mono" style={{ fontWeight: 600, fontSize: 12.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--reject)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          {lead.kicker || "Cover Story"}
          {lead.status === "unpublished" && <UnpubBadge />}
        </div>
        <button onClick={() => open(lead)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", display: "block", width: "100%" }}>
          <h1 className="npj-cover-h" style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: 47, lineHeight: .94, letterSpacing: ".002em", textTransform: "uppercase", margin: "0 0 16px" }}>{lead.headline}</h1>
        </button>
        {lead.dek && <p style={{ fontSize: 24, lineHeight: 1.5, margin: "0 0 22px", maxWidth: "60ch" }}>{lead.dek}</p>}
        {lead.image && lead.image.src && window.MediaImg
          ? (
              <button onClick={() => open(lead)} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", margin: "0 0 18px" }}>
                <window.MediaImg srcs={[lead.image.store, lead.image.src]} alt={lead.image.caption || lead.headline || ""} fit={lead.image.fit} crop={lead.image.crop} style={{ width: "100%", height: "auto", display: "block", border: "1.5px solid var(--ink)" }} />
              </button>
            )
          : (
              <button onClick={() => open(lead)} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", margin: "0 0 18px" }}>
                <Placeholder label="hero image" h={420} />
              </button>
            )
        }
        {lead.published && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-soft)", marginBottom: 18 }}>
            {fmtDate(lead.published)}{lead.updated && lead.updated !== lead.published ? " · updated " + shortDate(lead.updated) : ""}
          </div>
        )}
        {(lead.tags || []).length > 0 && <TagRow tags={lead.tags} />}
      </section>

      {/* Second row — up to 3 cards in a column grid */}
      {row2.length > 0 && (
        <section className="npj-row2" style={{ borderTop: "2.5px solid var(--ink)", display: "grid", gridTemplateColumns: `repeat(${Math.min(row2.length, 3)}, 1fr)` }}>
          {row2.map((s, i) => {
            const isLast = i === row2.length - 1;
            return (
              <div key={s.slug || i} style={{ padding: "26px " + (isLast ? "0" : "36px") + " 34px " + (i === 0 ? "0" : "36px"), borderRight: isLast ? "none" : "1.5px solid var(--ink)" }}>
                {s.image && s.image.src && window.MediaImg && (
                  <button onClick={() => open(s)} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", marginBottom: 20 }}>
                    <window.MediaImg srcs={[s.image.store, s.image.src]} alt={s.image.caption || s.headline || ""} style={{ width: "100%", height: 270, objectFit: "cover", display: "block", border: "1.5px solid var(--ink)" }} />
                  </button>
                )}
                <div className="np-mono" style={{ fontWeight: 500, fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ink-soft)", marginBottom: 12 }}>
                  {(s.tags || [])[0] || "Latest"}
                </div>
                <h2 onClick={() => open(s)} style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 28, lineHeight: 1.04, textTransform: "uppercase", margin: "0 0 12px", cursor: "pointer", display: "inline" }}>{s.headline}</h2>
                {s.status === "unpublished" && <div style={{ marginTop: 6 }}><UnpubBadge small /></div>}
                {s.dek && <p style={{ fontSize: 17.5, lineHeight: 1.5, margin: "12px 0 16px", color: "var(--ink)" }}>{s.dek}</p>}
                {s.published && <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-soft)" }}>{shortDate(s.published)}</div>}
              </div>
            );
          })}
        </section>
      )}

      {/* More from the newsroom — compact list rows */}
      {more.length > 0 && (
        <section style={{ borderTop: "2.5px solid var(--ink)", padding: "20px 0 12px" }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>More from the newsroom</div>
          {more.map((s, i) => (
            <div key={s.slug || i} className="npj-more-row" style={{ display: "grid", gridTemplateColumns: "150px 1fr 170px", gap: 22, alignItems: "baseline", padding: "15px 0", borderTop: "1px solid var(--rule)" }}>
              <span className="np-mono" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-soft)" }}>{(s.tags || [])[0] || "Latest"}</span>
              <button onClick={() => open(s)} style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 23, lineHeight: 1.05, textTransform: "uppercase", background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}>
                {s.headline}
                {s.status === "unpublished" && <span style={{ marginLeft: 8 }}><UnpubBadge small /></span>}
              </button>
              <span className="np-mono" style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "right" }}>{s.published ? shortDate(s.published) : ""}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

Object.assign(window, { Masthead, FrontPage, Placeholder, TagRow });
