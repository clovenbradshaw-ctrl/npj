/* NPJ masthead + front page. The masthead chrome (columns, taglines, utility
   links) is driven by the admin-curated layout config via LayoutCtx. The front
   page filters the line-up by the selected column (article.tags). Ships empty:
   until something is published it shows a clean "no stories yet" state. */

/* striped image placeholder with mono label */
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

/* ---------------- Masthead (global chrome, layout-driven) ---------------- */
function Masthead({ route, onHome, onNewsroom, activeColumn, onColumn }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const sections = (layout.sections || []).map(s => s.name);
  const utility = layout.utility || [];
  const taglines = layout.taglines || [];
  const navBtn = { background: "none", border: 0, color: "var(--paper)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600, fontSize: 12.5, fontFamily: "var(--cond)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 };
  const navFor = (n) => (window.__nav && window.__nav[n]) ? window.__nav[n] : onHome;
  const clickColumn = (name) => { if (onColumn) onColumn(name); else onHome(); };

  return (
    <header>
      {/* utility bar */}
      <div className="npj-utility" style={{ background: "var(--ink)", color: "var(--paper)", display: "flex",
        justifyContent: "space-between", alignItems: "center", padding: "4px 22px", fontFamily: "var(--cond)", fontSize: 12.5, gap: 14 }}>
        <span className="np-mono" style={{ fontSize: 11, opacity: .82, whiteSpace: "nowrap" }}>People's Journalism · community newsroom</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 18, textTransform: "uppercase", letterSpacing: ".08em", whiteSpace: "nowrap", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {utility.map((u, i) => <button key={i} onClick={() => navFor(u.nav)()} style={navBtn}>{u.label}</button>)}
          {(window.__nav && window.__nav.user) && (
            <button onClick={() => window.__nav.docs && window.__nav.docs()} style={navBtn}>
              <I.doc style={{ fontSize: 13 }} /> Documents
            </button>
          )}
          <button onClick={() => window.__nav && window.__nav.account()} style={navBtn}>{(window.__nav && window.__nav.user) ? window.__nav.user.split(":")[0].replace(/^@/, "") : "Sign in"}</button>
          <button onClick={onNewsroom} style={{ ...navBtn, color: "var(--yellow)" }}>
            <I.lock style={{ fontSize: 13 }} /> Newsroom
          </button>
        </span>
      </div>

      {/* wordmark band */}
      <div style={{ background: "var(--yellow)", borderBottom: "3px solid var(--ink)" }}>
        <div className="npj-wordmark" style={{ maxWidth: 1180, margin: "0 auto", padding: "18px 26px", display: "flex",
          alignItems: "center", justifyContent: "space-between", gap: 28 }}>
          <button onClick={onHome} style={{ display: "flex", alignItems: "center", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
            <img className="npj-logo" src="https://storage.googleapis.com/intelechia-content/im/NPD%20wide.png" alt="People's Journalism" style={{ height: 150, display: "block" }} />
          </button>
          {taglines.length > 0 && (
            <div className="npj-taglines" style={{ textAlign: "right", borderRight: "4px solid var(--ink)", paddingRight: 18 }}>
              {taglines.map((w, i) => (
                <div key={i} style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 30, lineHeight: 1.02, letterSpacing: "-.01em", textTransform: "lowercase" }}>
                  <span style={{ fontWeight: 500, color: "var(--ink-soft)" }}>community-</span>{w}.
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* column nav — hidden while reading an article to cut toolbar stacking */}
      {route !== "article" && sections.length > 0 && (
      <nav style={{ background: "var(--paper)", borderBottom: "1.5px solid var(--ink)" }}>
        <div className="npj-colnav" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 22px", display: "flex",
          alignItems: "stretch", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
            {sections.map((s, i) => {
              const on = activeColumn ? activeColumn === s : i === 0;
              return (
                <button key={s + i} className="np-cond" onClick={() => clickColumn(s)} style={{ background: on ? "var(--ink)" : "none",
                  color: on ? "var(--yellow)" : "var(--ink)", border: 0, padding: "9px 16px", fontSize: 15,
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", borderRight: "1px solid var(--rule)", cursor: "pointer" }}>{s}</button>
              );
            })}
          </div>
          <button className="np-cond npj-search" style={{ background: "none", border: 0, padding: "9px 14px", display: "inline-flex",
            alignItems: "center", gap: 6, fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-soft)" }}>
            <I.search style={{ fontSize: 16 }} /> Search records
          </button>
        </div>
      </nav>
      )}
    </header>
  );
}

/* ---------------- Front page ---------------- */
function FrontPage({ onOpen, onNewsroom, onHome }) {
  const { layout, isAdmin } = React.useContext(window.LayoutCtx);
  const F = window.NPJ.FRONT || {};
  const sections = (layout.sections || []).map(s => s.name);
  const [col, setCol] = useState(null);

  // gather every published piece + its tags (empty until something ships)
  const all = [];
  if (F.lead) all.push({ ...F.lead, _lead: true, tags: F.lead.tags || [] });
  (F.secondary || []).forEach(s => all.push({ ...s, tags: s.tags || [] }));
  // unpublished pieces drop off the line-up for everyone but admins, who keep
  // seeing them (badged) so they can reopen and republish
  const visible = all.filter(a => isAdmin || a.status !== "unpublished");
  const shown = col ? visible.filter(a => (a.tags || []).includes(col)) : visible;

  return (
    <div className="fade-in">
      <Masthead route="home" onHome={onHome} onNewsroom={onNewsroom} activeColumn={col} onColumn={(name) => setCol(c => c === name ? null : name)} />

      {/* manifesto strip */}
      <div style={{ background: "var(--ink)", color: "var(--paper)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "11px 22px", display: "flex", gap: 26,
          alignItems: "center", flexWrap: "wrap", fontFamily: "var(--cond)", fontSize: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span className="ground-glyph" aria-hidden="true" /> Hover any claim to audit its archived source.</span>
          <span style={{ opacity: .4 }}>/</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.shield style={{ fontSize: 17 }} /> Toggle Auditability to reveal every source.</span>
          <span style={{ opacity: .4 }}>/</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.chat style={{ fontSize: 17 }} /> Every published piece is open to public suggestion.</span>
        </div>
      </div>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 60px" }}>
        {shown.length === 0
          ? <EmptyFront col={col} sections={sections} onNewsroom={onNewsroom} onSubmit={() => window.__nav && window.__nav.submit()} />
          : <FrontLineup items={shown} onOpen={onOpen} />}
      </main>
    </div>
  );
}

/* clean empty state for the launch */
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

/* line-up renderer (used once pieces exist) — every item carries the slug of
   its committed EO log, and opening it loads + folds that log into the reader */
function UnpubBadge({ small }) {
  return <span className="np-mono" style={{ fontSize: small ? 9 : 10, fontWeight: 600, letterSpacing: ".06em", color: "var(--reject)", border: "1px solid var(--reject)", padding: small ? "1px 5px" : "2px 7px", textTransform: "uppercase" }}>⊘ Unpublished</span>;
}

function FrontLineup({ items, onOpen }) {
  // lead with a live piece so an admin's hidden draft never takes the marquee
  const lead = items.find(a => a.status !== "unpublished") || items[0];
  const rest = items.filter(a => a !== lead);
  const open = (a) => onOpen && onOpen(a.slug);
  return (
    <div className="npj-lineup" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 0 }}>
      <section style={{ paddingRight: 30, borderRight: "1.5px solid var(--ink)" }}>
        <button onClick={() => open(lead)} className="headline-link" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
          <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>{lead.kicker}{lead.status === "unpublished" && <UnpubBadge />}</div>
          <h1 className="npj-lead-h" style={{ fontFamily: "var(--display)", fontSize: 70, lineHeight: .98, margin: "0 0 14px" }}>{lead.headline}</h1>
        </button>
        {lead.image && lead.image.src && window.MediaImg && (
          <button onClick={() => open(lead)} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", margin: "0 0 14px" }}>
            <window.MediaImg srcs={[lead.image.store, lead.image.src]} alt={lead.image.caption || lead.headline || ""} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
          </button>
        )}
        {lead.dek && <p style={{ fontFamily: "var(--serif)", fontSize: 19, lineHeight: 1.42, margin: "0 0 14px", maxWidth: "40ch" }}>{lead.dek}</p>}
        {lead.published && <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 10 }}>{fmtDate(lead.published)}</div>}
        {(lead.tags || []).length > 0 && <TagRow tags={lead.tags} />}
      </section>
      <aside style={{ paddingLeft: 24 }}>
        <div className="np-eyebrow" style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 6, marginBottom: 12 }}>More</div>
        {rest.map((s, i) => (
          <article key={s.slug || i} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
            {s.image && s.image.src && window.MediaImg && (
              <button onClick={() => open(s)} style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", margin: "0 0 8px" }}>
                <window.MediaImg srcs={[s.image.store, s.image.src]} alt={s.image.caption || s.headline || ""} style={{ width: "100%", height: 130, objectFit: "cover", display: "block", border: "1.5px solid var(--ink)" }} />
              </button>
            )}
            <h3 onClick={() => open(s)} className="headline-link" style={{ fontFamily: "var(--display)", fontSize: 22, lineHeight: .98, margin: "0 0 6px", cursor: "pointer" }}>{s.headline}</h3>
            {s.status === "unpublished" && <div style={{ marginBottom: 6 }}><UnpubBadge small /></div>}
            {s.dek && <p style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.35, color: "var(--ink-soft)", margin: "0 0 6px" }}>{s.dek}</p>}
            {s.published && <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginBottom: 4 }}>{shortDate(s.published)}</div>}
            {(s.tags || []).length > 0 && <TagRow tags={s.tags} small />}
          </article>
        ))}
      </aside>
    </div>
  );
}

function TagRow({ tags, small }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {tags.map(t => <span key={t} className="np-mono" style={{ fontSize: small ? 9.5 : 11, border: "1px solid var(--ink)", padding: "2px 7px", background: "var(--paper-2)" }}>#{t}</span>)}
    </div>
  );
}

Object.assign(window, { Masthead, FrontPage, Placeholder, TagRow });
