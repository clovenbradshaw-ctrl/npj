/* NPJ — Standards page + gated Submit flow (account required). */

/* ============================ Standards ============================ */
function StandardsPage({ onHome, onNewsroom, onSubmit }) {
  const principles = [
    [I.archive, "Every claim is bound to a frozen source.", "When we cite a fact, it is linked to an archive.org snapshot taken the moment we pulled it — not a live link that can rot or quietly change. The archived copy is canonical."],
    [I.shield, "Sourcing is enforced, not promised.", "A claim that points to a missing source fails the build. The site literally cannot publish a citation that goes nowhere. Integrity is a machine check, not a vibe."],
    [I.chat, "The record stays open after publication.", "Every published piece is a living document. Anyone with an account can propose an edit against any claim, in public — proposed, then reviewed, then accepted or rejected, all on the record."],
    [I.shield, "One identity, across reading and writing.", "Editors and community contributors share one Matrix identity — bring any account, from any homeserver. Who proposed what, and who resolved it, is always attributable, and you can filter the record to the people you trust."],
    [I.lock, "The newsroom is private until publish.", "Drafting and source-gathering happen in a private room, out of public view. The publish boundary is the moment a piece crosses from private process to open record — deliberately, once."]
  ];
  const steps = [
    ["Anyone can bring a story", "A tip, a document, a pattern you noticed on your street. You submit it with whatever sources you have."],
    ["The newsroom takes it private", "Contributors and editors develop it privately — checking claims, gathering and archiving sources."],
    ["Publish is the boundary", "When it is ready, the piece is committed as an open record and every source is frozen to archive.org. Process ends; the artifact remains."],
    ["The community keeps it honest", "Readers audit each claim against its source and suggest corrections. Good suggestions become part of the record."]
  ];
  const standards = [
    ["We name our evidence.", "No anonymous assertion stands in as fact. If we can't source it, we don't print it as a claim."],
    ["We log every correction.", "Changes after publication are visible, attributed, and dated. We don't quietly edit the past."],
    ["We separate fact from argument.", "Sourced claims are marked and auditable; the reasoning built on them is clearly the writer's."],
    ["We are funded by the community, not advertisers.", "Members and readers keep the lights on, so the work answers to them — not to anyone we cover."]
  ];

  return (
    <div className="fade-in">
      <Masthead route="standards" onHome={onHome} onNewsroom={onNewsroom} />

      {/* hero */}
      <div style={{ background: "var(--ink)", color: "var(--paper)" }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "46px 22px 40px" }}>
          <div className="np-eyebrow" style={{ color: "var(--yellow)", marginBottom: 14 }}>Who we are</div>
          <h1 style={{ fontFamily: "var(--display)", fontSize: 72, lineHeight: .9, margin: "0 0 18px" }}>Our process.<br/>Our standards.</h1>
          <p style={{ fontFamily: "var(--serif)", fontSize: 21, lineHeight: 1.45, maxWidth: "44ch", color: "var(--paper)", opacity: .92, margin: 0 }}>
            Nashville Peoples' Journalism is community-made, community-backed, and built so you never have to take our word for it. Here is exactly how the work happens — and the line we hold while doing it.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 920, margin: "0 auto", padding: "44px 22px 70px" }}>
        {/* principles */}
        <SectionHead n="01" title="What we promise the reader" />
        <div style={{ display: "grid", gap: 0, marginBottom: 50 }}>
          {principles.map(([Ic, t, d], i) => (
            <div key={i} style={{ display: "flex", gap: 18, padding: "20px 0", borderTop: "1.5px solid var(--ink)" }}>
              <Ic style={{ fontSize: 30, flex: "0 0 auto", marginTop: 2 }} />
              <div>
                <h3 style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 23, lineHeight: 1.04, margin: "0 0 5px" }}>{t}</h3>
                <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.5, margin: 0, color: "var(--ink-soft)", maxWidth: "64ch" }}>{d}</p>
              </div>
            </div>
          ))}
        </div>

        {/* process */}
        <SectionHead n="02" title="How a story gets made" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 50, border: "1.5px solid var(--ink)" }}>
          {steps.map(([t, d], i) => (
            <div key={i} style={{ padding: "20px 22px", borderRight: i % 2 === 0 ? "1.5px solid var(--ink)" : 0, borderTop: i > 1 ? "1.5px solid var(--ink)" : 0 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 30, color: "var(--yellow-deep)", lineHeight: 1 }}>{String(i + 1).padStart(2, "0")}</div>
              <h3 style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 20, lineHeight: 1.05, margin: "8px 0 5px" }}>{t}</h3>
              <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.48, margin: 0, color: "var(--ink-soft)" }}>{d}</p>
            </div>
          ))}
        </div>

        {/* standards list */}
        <SectionHead n="03" title="The line we hold" />
        <div style={{ marginBottom: 46 }}>
          {standards.map(([t, d], i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--rule)" }}>
              <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content", marginTop: 4 }}>{i + 1}</span>
              <div>
                <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 19 }}>{t} </span>
                <span style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.5, color: "var(--ink-soft)" }}>{d}</span>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ border: "2.5px solid var(--ink)", background: "var(--yellow)", padding: "26px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--display)", fontSize: 30, lineHeight: .95 }}>You live here. You see things.</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 16, marginTop: 4 }}>Bring us a tip, a document, or a whole story. We'll help you source it.</div>
          </div>
          <button className="btn" onClick={onSubmit} style={{ background: "var(--ink)", color: "var(--yellow)", borderColor: "var(--ink)", fontSize: 16, padding: "12px 20px", display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            Submit a story <I.arrow style={{ fontSize: 16 }} />
          </button>
        </div>
      </main>
    </div>
  );
}

function SectionHead({ n, title }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
      <span className="np-mono" style={{ fontSize: 13, color: "var(--ink-soft)" }}>{n}</span>
      <h2 style={{ fontFamily: "var(--display)", fontSize: 30, margin: 0 }}>{title}</h2>
      <span style={{ flex: 1, height: 2, background: "var(--ink)" }} />
    </div>
  );
}

Object.assign(window, { StandardsPage, SectionHead });
