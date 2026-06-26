/* NPJ — Merge Requests dashboard. The site-wide list of branches across every
   article: one place an editor (or anyone) can scan what's open, sorted and
   filterable, and jump into the piece to preview, merge or ignore. Reads the
   front list for the article set, then folds each article's feedback log via
   window.NpjFeedback.load. Visibility-aware: a private branch only shows to its
   author or the article's authors. Publishes window.MergeDashboard. */

function MergeStat({ label, value, color }) {
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "10px 14px", minWidth: 92 }}>
      <div style={{ fontFamily: "var(--display)", fontSize: 30, lineHeight: 1, color: color || "var(--ink)" }}>{value}</div>
      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function MergeDashboard({ onHome, onNewsroom, onOpenArticle }) {
  const { isAdmin } = React.useContext(window.LayoutCtx);
  const me = (window.MatrixAuth && window.MatrixAuth.current() && window.MatrixAuth.current().user_id) || (window.__nav && window.__nav.user) || "@you:guest";
  const token = () => (window.MatrixAuth && window.MatrixAuth.token && window.MatrixAuth.token()) || null;
  const [rows, setRows] = useState(null);   // null = loading
  const [filter, setFilter] = useState("open"); // open | all | mine
  const [vis, setVis] = useState("all");        // all | public | private
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const F = window.NpjFeedback;
    let metas = [];
    try { metas = (await window.NpjArticles.loadFront()) || []; } catch (e) { metas = []; }
    const out = [];
    await Promise.all(metas.map(async (m) => {
      let list = [];
      try { list = await F.load(m.slug, { base_sha: m.base_sha }); } catch (e) { list = []; }
      const owners = [].concat(m.authors || [], m.assignees || []).filter(Boolean);
      list.forEach((s) => {
        if (!F.canSee(s, me, owners)) return;
        out.push({ ...s, slug: m.slug, headline: m.headline || m.slug, owners });
      });
    }));
    // newest first
    out.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
    setRows(out);
  }, [me]);

  useEffect(() => { load(); }, [load]);

  const kindOf = (s) => (s.scope === "article" && s.forkBody && s.forkBody.length) ? "Fork"
    : s.scope === "article" ? "Note" : s.kind === "comment" ? "Comment" : "Branch";
  const spanOf = (s) => {
    const txt = (s.anchor && s.anchor.quote) || (s.scope === "article" ? "whole article" : (s.proposed || s.rationale || ""));
    return txt.length > 54 ? txt.slice(0, 54) + "…" : txt;
  };
  const isOpen = (s) => s.status === "proposed" || s.status === "review";

  const filtered = (rows || []).filter((s) => {
    if (filter === "open" && !isOpen(s)) return false;
    if (filter === "mine" && String(s.author).toLowerCase() !== String(me).toLowerCase()) return false;
    if (vis !== "all" && (s.visibility || "public") !== vis) return false;
    if (q.trim()) {
      const hay = (s.headline + " " + (s.rationale || "") + " " + (s.proposed || "") + " " + (s.author || "")).toLowerCase();
      if (hay.indexOf(q.trim().toLowerCase()) < 0) return false;
    }
    return true;
  });

  const openCount = (rows || []).filter(isOpen).length;
  const articleCount = new Set((rows || []).map(s => s.slug)).size;
  const forkCount = (rows || []).filter(s => s.scope === "article" && s.forkBody && s.forkBody.length).length;

  const ignore = async (s) => {
    setBusyId(s.id);
    try { await window.NpjFeedback.resolve({ slug: s.slug, ref: s.id, outcome: "rejected", author: me, token: token() }); } catch (e) {}
    setRows(list => (list || []).map(r => (r.id === s.id ? { ...r, status: "rejected" } : r)));
    setBusyId(null);
  };

  return (
    <div className="fade-in">
      <Masthead route="merges" onHome={onHome} onNewsroom={onNewsroom} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 22px 80px" }}>
        <div className="np-eyebrow" style={{ color: "var(--data)", marginBottom: 10 }}>The open record</div>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 54, lineHeight: .9, margin: "0 0 14px" }}>Merge requests</h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: 17, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "62ch", margin: "0 0 24px" }}>
          Every proposed branch across the site — span edits and whole-article forks. Open one to read it in context, toggle it on before merge, then merge or ignore.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
          <MergeStat label="Open" value={openCount} color="var(--data)" />
          <MergeStat label="Forks" value={forkCount} />
          <MergeStat label="Across articles" value={articleCount} />
          <MergeStat label="Total" value={(rows || []).length} />
        </div>

        {/* controls */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "inline-flex", border: "1.5px solid var(--ink)" }}>
            {[["open", "Open"], ["all", "All"], ["mine", "Mine"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className="np-cond" style={{ padding: "5px 12px", border: 0, cursor: "pointer", fontWeight: 700, fontSize: 13,
                borderRight: k !== "mine" ? "1.5px solid var(--ink)" : 0, background: filter === k ? "var(--ink)" : "transparent", color: filter === k ? "var(--yellow)" : "var(--ink)" }}>{l}</button>
            ))}
          </div>
          <div style={{ display: "inline-flex", border: "1.5px solid var(--rule-strong)" }}>
            {[["all", "Any"], ["public", "🌐"], ["private", "🔒"]].map(([k, l]) => (
              <button key={k} onClick={() => setVis(k)} className="np-mono" title={"Visibility: " + k} style={{ padding: "5px 10px", border: 0, cursor: "pointer", fontSize: 12,
                borderRight: k !== "private" ? "1px solid var(--rule-strong)" : 0, background: vis === k ? "var(--ink)" : "transparent", color: vis === k ? "var(--yellow)" : "var(--ink-soft)" }}>{l}</button>
            ))}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1.5px solid var(--rule-strong)", padding: "0 8px", flex: "1 1 200px", minWidth: 160 }}>
            <I.search style={{ fontSize: 14, color: "var(--ink-soft)" }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search branches…" className="np-mono"
              style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", padding: "7px 0", fontSize: 12.5, outline: "none" }} />
          </div>
          <button className="btn btn-sm" onClick={load} title="Reload"><I.redo style={{ fontSize: 13 }} /></button>
        </div>

        {rows === null ? (
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", padding: "30px 0" }}>Loading branches across the record…</div>
        ) : filtered.length === 0 ? (
          <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "30px", textAlign: "center", fontFamily: "var(--serif)", color: "var(--ink-soft)" }}>
            No merge requests {filter === "open" ? "open" : ""} in this view.
          </div>
        ) : (
          <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--ink)", color: "var(--paper)", textAlign: "left" }}>
                  {["Article", "Kind", "What", "From", "See", "Status", "▲", ""].map((h, i) => (
                    <th key={i} className="np-mono" style={{ padding: "8px 10px", fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.slug + ":" + s.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "8px 10px", maxWidth: 220 }}>
                      <button onClick={() => onOpenArticle(s.slug)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, color: "var(--ink)", lineHeight: 1.15 }}>{s.headline}</button>
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <span className="np-mono" style={{ fontSize: 10, padding: "1px 6px", border: "1px solid var(--ink)", background: kindOf(s) === "Fork" ? "var(--data)" : "transparent", color: kindOf(s) === "Fork" ? "#fff" : "var(--ink)" }}>{kindOf(s)}</span>
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "var(--serif)", color: "var(--ink-soft)", maxWidth: 260 }}>{spanOf(s)}</td>
                    <td style={{ padding: "8px 10px" }}><Handle mxid={s.author} size={15} /></td>
                    <td style={{ padding: "8px 10px" }} title={s.visibility === "private" ? "Private" : "Public"}>{s.visibility === "private" ? "🔒" : "🌐"}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}><StatusChip status={s.status} merged={s.merged} /></td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }} className="np-mono">{s.votes}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", textAlign: "right" }}>
                      <button className="btn btn-sm" onClick={() => onOpenArticle(s.slug)} style={{ padding: "3px 9px" }}>Open ↗</button>
                      {isAdmin && isOpen(s) && (
                        <button className="btn btn-sm" disabled={busyId === s.id} onClick={() => ignore(s)} title="Ignore (decline) this branch"
                          style={{ padding: "3px 8px", marginLeft: 5, color: "var(--reject)", borderColor: "var(--reject)" }}><I.x style={{ fontSize: 11 }} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 14, lineHeight: 1.5 }}>
          Merging commits a real edit to the record, so it happens inside the article (Open ↗ → Suggestions → Merge). Public branches are mirrored to archive.org; private ones stay between you and the article's authors.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MergeDashboard });
