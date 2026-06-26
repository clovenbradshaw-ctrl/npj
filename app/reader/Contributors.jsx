/* NPJ — Contributors (the public masthead).
   The outward-facing roster: everyone with a role or a published profile, each
   with their display name, role and "About me". Names + bios are read straight
   from the world-readable site/layout.json `contributors` map (folded into
   window.NPJ.PEOPLE at boot) — so this page is a pure read of the public store.
   A contributor edits their own entry from Documents → "Your byline & About me". */

function ContributorsPage({ onHome, onNewsroom }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const SEED = window.SEED_ADMIN;

  // Everyone worth listing: the founder, anyone with a delegated role, and anyone
  // with a published profile. Deduped, founder first, then admins, then the rest.
  const set = {};
  set[SEED] = true;
  Object.keys(layout.roles || {}).forEach(mx => { set[mx] = true; });
  Object.keys(layout.contributors || {}).forEach(mx => { set[mx] = true; });
  const people = Object.keys(set).map(mx => {
    const role = window.roleOf(layout, mx);
    const prof = window.npjPerson ? window.npjPerson(mx) : { mxid: mx, name: mx.replace(/^@/, "").split(":")[0], bio: "", color: "#6b6b6b" };
    return { mxid: mx, role, name: prof.name, bio: prof.bio, color: prof.color, founder: mx === SEED };
  }).sort((a, b) => {
    const rank = (p) => p.founder ? 0 : p.role === "admin" ? 1 : p.role === "editor" ? 2 : 3;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  const RoleBadge = ({ p }) => {
    const label = p.founder ? "Founder · Admin" : p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : "Contributor";
    return <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", border: "1px solid var(--ink-soft)", padding: "2px 7px", textTransform: "uppercase", letterSpacing: ".05em", whiteSpace: "nowrap" }}>{label}</span>;
  };

  return (
    <div className="fade-in">
      <Masthead route="contributors" onHome={onHome} onNewsroom={onNewsroom} />

      <div style={{ background: "var(--ink)", color: "var(--paper)" }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "44px 22px 38px" }}>
          <div className="np-eyebrow" style={{ color: "var(--yellow)", marginBottom: 14 }}>The masthead</div>
          <h1 style={{ fontFamily: "var(--display)", fontSize: 64, lineHeight: .95, margin: "0 0 16px" }}>Contributors</h1>
          <p style={{ fontFamily: "var(--serif)", fontSize: 20, lineHeight: 1.45, maxWidth: "52ch", opacity: .92, margin: 0 }}>
            The people behind the record. Every story is bylined to a contributor, and every contributor stands behind their work in public. Profiles are kept by the contributors themselves.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 920, margin: "0 auto", padding: "34px 22px 70px" }}>
        {people.length === 0 ? (
          <div style={{ fontFamily: "var(--serif)", fontSize: 17, color: "var(--ink-soft)", padding: "30px 0" }}>No contributors listed yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {people.map(p => (
              <div key={p.mxid} style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "14px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: "50%", background: p.color, color: "#fff", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 19, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{(p.name || "?").charAt(0).toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 19, lineHeight: 1.1 }}>{p.name}</div>
                    <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.mxid}</div>
                  </div>
                </div>
                <div><RoleBadge p={p} /></div>
                {p.bio
                  ? <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, margin: 0, color: "var(--ink)" }}>{window.npjRichText ? window.npjRichText(p.bio) : p.bio}</p>
                  : <p className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", margin: 0, fontStyle: "italic" }}>No About me yet.</p>}
              </div>
            ))}
          </div>
        )}

        <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.6, marginTop: 26, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          Are you a contributor? Set your name and About me from <button onClick={() => window.__nav && window.__nav.docs && window.__nav.docs()} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--ink)", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>Documents → “Your byline &amp; About me.”</button>
        </div>
      </main>

      <FrontFooter />
    </div>
  );
}

Object.assign(window, { ContributorsPage });
