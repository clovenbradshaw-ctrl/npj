/* NPJ — Document explorer. The contributor's home after sign-in: every draft
   you've started (this browser ∪ your Matrix account), newest first, plus a
   one-click "New document". Opening a card hands its draftId to the Newsroom;
   drafts are durable via app/drafts.js (localStorage + Matrix account data), so
   they survive a refresh, a closed tab, even a new device. Ships empty — there
   are no documents until you write one. */

/* prose-only preview text from a draft's stored html (drops banners/embeds) */
function docPreview(html) {
  if (!html) return "";
  try {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    tmp.querySelectorAll("figure, image-slot, .nr-banner, .cmp-embed, script, style").forEach(n => n.remove());
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
  } catch (e) { return ""; }
}
function docWords(text) { return text ? text.split(/\s+/).filter(Boolean).length : 0; }

/* friendly relative time for a draft's `updated` ISO timestamp */
function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? " min ago" : " mins ago");
  const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? " day ago" : " days ago");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DocCard({ doc, onOpen, onDiscard }) {
  const title = (doc.title && doc.title.trim()) || "Untitled";
  const preview = docPreview(doc.html);
  const wc = docWords(preview);
  const nSources = Array.isArray(doc.sources) ? doc.sources.length : 0;
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  return (
    <div onClick={() => onOpen(doc.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(doc.id); } }}
      className="npj-doc-card" style={{ border: "1.5px solid var(--ink)", background: "var(--card)",
        padding: "14px 16px", marginBottom: 12, cursor: "pointer", boxShadow: "4px 4px 0 rgba(22,20,13,.10)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
        <I.doc style={{ fontSize: 22, color: "var(--ink-soft)", flex: "0 0 auto", marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 21, lineHeight: 1.05, margin: 0 }}>{title}</h3>
            {doc.column && <span className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)" }}>◆ {doc.column}</span>}
          </div>
          {preview && <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45, color: "var(--ink-soft)",
            margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{preview}</p>}
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 9,
            display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><I.clock style={{ fontSize: 12 }} /> {relTime(doc.updated)}</span>
            <span>{wc} word{wc === 1 ? "" : "s"}</span>
            <span>{nSources} source{nSources === 1 ? "" : "s"}</span>
            {tags.slice(0, 3).map(t => <span key={t}>#{t}</span>)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flex: "0 0 auto" }}>
          <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onOpen(doc.id); }}>Open</button>
          <button className="btn btn-sm btn-ghost" title="Discard this document"
            onClick={(e) => { e.stopPropagation(); onDiscard(doc); }} style={{ color: "var(--ink-soft)" }}>Discard</button>
        </div>
      </div>
    </div>
  );
}

function DocsEmpty({ onNew }) {
  return (
    <div style={{ border: "1.5px dashed var(--rule-strong)", background: "var(--card)", padding: "44px 26px", textAlign: "center", marginTop: 6 }}>
      <I.doc style={{ fontSize: 40, color: "var(--ink-soft)" }} />
      <h2 style={{ fontFamily: "var(--display)", fontSize: 34, lineHeight: .95, margin: "12px 0 8px" }}>No documents yet.</h2>
      <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "44ch", margin: "0 auto 20px" }}>
        Start your first piece. It autosaves as you write — to this browser and to your Matrix account — so your work is never lost.
      </p>
      <button className="btn btn-primary" onClick={onNew} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.plus style={{ fontSize: 15 }} /> New document</button>
    </div>
  );
}

function DocumentExplorer({ me, session, onOpen, onNew, onHome, onNewsroom, onSignOut }) {
  const [docs, setDocs] = useState(null); // null = still loading
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    window.NpjDrafts.list()
      .then(list => { if (alive) setDocs(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setDocs([]); });
    return () => { alive = false; };
  }, []);

  const discard = (doc) => {
    const label = (doc.title && doc.title.trim()) || "Untitled";
    if (!window.confirm("Discard “" + label + "”? This removes the local copy and can't be undone.")) return;
    window.NpjDrafts.discard(doc.id);
    setDocs(list => (list || []).filter(d => d.id !== doc.id));
  };

  const shown = (docs || []).filter(d => {
    if (!q.trim()) return true;
    const hay = ((d.title || "") + " " + (d.column || "") + " " + (Array.isArray(d.tags) ? d.tags.join(" ") : "") + " " + docPreview(d.html)).toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  const name = me ? me.split(":")[0].replace(/^@/, "") : "";

  return (
    <div className="fade-in">
      <Masthead route="documents" onHome={onHome} onNewsroom={onNewsroom} />
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 22px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 380px" }}>
            <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 10 }}>Document explorer</div>
            <h1 style={{ fontFamily: "var(--display)", fontSize: 56, lineHeight: .9, margin: "0 0 10px" }}>{name ? "Welcome back, " + name + "." : "Your documents."}</h1>
            <p style={{ fontFamily: "var(--serif)", fontSize: 17, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "56ch", margin: 0 }}>
              Every draft you've started, in one place — durable across a refresh, a closed tab, even a new device. Open one to keep writing, or start something new.
            </p>
          </div>
          <button className="btn btn-primary" onClick={onNew} style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "0 0 auto" }}>
            <I.plus style={{ fontSize: 15 }} /> New document
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "28px 0 18px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "0 12px", flex: "1 1 260px" }}>
            <I.search style={{ fontSize: 16, color: "var(--ink-soft)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your documents…"
              style={{ flex: 1, border: 0, background: "transparent", padding: "11px 0", fontFamily: "var(--serif)", fontSize: 15, outline: "none" }} />
          </div>
          {docs && <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{shown.length} of {docs.length}</span>}
          {session && onSignOut && <button className="btn btn-sm btn-ghost" onClick={onSignOut} style={{ color: "var(--ink-soft)" }}>Sign out</button>}
        </div>

        {docs === null && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink-soft)", fontFamily: "var(--serif)", padding: "20px 2px" }}>
            <Spinner /> Loading your documents…
          </div>
        )}
        {docs !== null && shown.length === 0 && (
          docs.length === 0
            ? <DocsEmpty onNew={onNew} />
            : <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", padding: "10px 2px" }}>No documents match “{q}”.</div>
        )}
        {docs !== null && shown.map(d => <DocCard key={d.id} doc={d} onOpen={onOpen} onDiscard={discard} />)}
      </div>
    </div>
  );
}

Object.assign(window, { DocumentExplorer, DocCard, DocsEmpty });
