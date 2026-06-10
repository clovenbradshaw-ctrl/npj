/* NPJ — Documents. The signed-in article explorer, grouped by PROJECT: each
   project (a shared Matrix room) is a card that shows who is invited — joined
   members and pending invitees, read live from the homeserver — plus every
   document inside it. Drafts that belong to no project sit in their own group,
   and the published record (per-document folders of timestamped version files
   in articles/<slug>/, plus legacy articles/*.jsonl logs) closes the page —
   each piece badged published / updated / unpublished, with the admin able to
   unpublish (take it off the site) or republish right from its row. Gated to
   a signed-in session — guests are pointed at the Matrix sign-in on Submit. */

function DocSpinner() { return <span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px" }} />; }

function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s) || s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function draftWords(d) {
  const text = String((d && d.html) || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/* who's in a project — joined members render solid, pending invites hollow */
function MemberChips({ list, me }) {
  if (!list) return <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", display: "inline-flex", gap: 5, alignItems: "center" }}><DocSpinner /> members…</span>;
  if (!list.length) return <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>just you</span>;
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
      {list.map(m => {
        const name = m.mxid.replace(/^@/, "").split(":")[0];
        const invited = m.membership === "invite";
        return (
          <span key={m.mxid} title={m.mxid + (invited ? " — invited, hasn't joined yet" : m.mxid === me ? " — you" : " — member")}
            className="np-mono" style={{ fontSize: 9.5, padding: "1px 7px", whiteSpace: "nowrap",
              border: invited ? "1px dashed var(--ink-soft)" : "1px solid var(--ink)",
              background: invited ? "transparent" : (m.mxid === me ? "var(--yellow)" : "var(--card)"),
              color: invited ? "var(--ink-soft)" : "var(--ink)" }}>
            {invited ? "◌ " : "● "}{name}{invited ? " · invited" : ""}
          </span>
        );
      })}
    </span>
  );
}

function DocumentsPage({ session, onOpen, onOpenArticle, onHome, onNewsroom, onSignIn }) {
  const signedIn = !!session;
  const me = session && session.user_id;
  const [drafts, setDrafts] = useState(null);       // null = loading
  const [rooms, setRooms] = useState(null);
  const [members, setMembers] = useState({});       // roomId → [{mxid, membership}]
  const [published, setPublished] = useState(null); // { articles: EO log metas, legacy: root .md files }
  const [confirmId, setConfirmId] = useState(null);
  const [statusBusy, setStatusBusy] = useState(null); // slug with an unpublish/republish in flight
  const [statusErr, setStatusErr] = useState(null);
  const [q, setQ] = useState("");
  const { isAdmin } = React.useContext(window.LayoutCtx);
  // unpublished pieces stay listed for admins (badged, still openable) but
  // drop off the list for everyone else
  const pubArticles = published ? published.articles.filter(m => isAdmin || m.status !== "unpublished") : [];

  // admin-only: take a piece off the site / put it back — one REC version file
  // carrying the status, committed to the document's folder. Nothing deleted.
  const setDocStatus = async (m, next) => {
    setStatusErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setStatusErr("Sign in with Matrix to manage publication — the webhook re-verifies the token server-side."); return; }
    if (next === "unpublished" && !window.confirm("Unpublish “" + m.headline + "”?\n\nIt comes off the site for everyone but admins. Every version stays in GitHub — you can republish anytime.")) return;
    setStatusBusy(m.slug);
    try {
      const out = await window.NpjArticles.setArticleStatus({ slug: m.slug, status: next, actor: me, token });
      if (!out.res.ok) {
        setStatusErr("Rejected (HTTP " + out.res.status + ") — nothing changed." + (out.res.status === 401 || out.res.status === 403 ? " That Matrix account isn't authorized." : ""));
      } else {
        setPublished(p => p ? { ...p, articles: p.articles.map(x => x.slug === m.slug
          ? { ...x, status: next, versions: (x.versions || 1) + 1, updated: new Date().toISOString().slice(0, 10), storage: "dir", logPath: "articles/" + m.slug }
          : x) } : p);
        window.NpjArticles.loadFront().catch(() => {}); // the front page reflects it on next visit
      }
    } catch (e) {
      setStatusErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
    }
    setStatusBusy(null);
  };

  // drafts: both layers, newest first (app/drafts.js heals local vs Matrix).
  // Re-list whenever a background sync lands so "backing up…" flips to
  // "on your account" without a reload.
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const load = async () => {
      try { const list = await window.NpjDrafts.list(); if (alive) setDrafts(list || []); }
      catch (e) { if (alive) setDrafts([]); }
    };
    load();
    const off = window.NpjDrafts.onStatus(s => { if (s.state === "synced") load(); });
    return () => { alive = false; off(); };
  }, [signedIn]);

  // collaboration rooms: recovered from the homeserver, never from this browser
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    (async () => {
      try {
        const [joined, idx] = await Promise.all([window.MatrixAuth.joinedRooms(), window.MatrixAuth.listDrafts()]);
        if (alive) setRooms({ joined: joined || [], drafts: idx || [] });
      } catch (e) { if (alive) setRooms({ joined: [], drafts: [], error: e.message }); }
    })();
    return () => { alive = false; };
  }, [signedIn]);

  // published record: the versioned event logs under articles/ (the real
  // record), plus any legacy .md files still at the repo root (best-effort)
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    (async () => {
      const articles = await window.NpjArticles.listArticles().catch(() => []);
      let legacy = [];
      try {
        const res = await fetch("https://api.github.com/repos/clovenbradshaw-ctrl/npj/contents/?ref=main", { headers: { Accept: "application/vnd.github+json" } });
        if (res.ok) legacy = ((await res.json()) || []).filter(f => f.type === "file" && /\.md$/i.test(f.name) && f.name.toLowerCase() !== "readme.md");
      } catch (e) {}
      if (alive) setPublished({ articles, legacy });
    })();
    return () => { alive = false; };
  }, [signedIn]);

  // who is invited, per project — read from the homeserver after rooms resolve
  useEffect(() => {
    if (!rooms) return;
    let alive = true;
    (async () => {
      const ids = {};
      (rooms.drafts || []).forEach(d => { if (d.roomId) ids[d.roomId] = 1; });
      (rooms.joined || []).forEach(r => { if (r.kind !== "control") ids[r.roomId] = 1; });
      const out = {};
      await Promise.all(Object.keys(ids).map(async id => { out[id] = await window.MatrixAuth.roomMembers(id); }));
      if (alive) setMembers(out);
    })();
    return () => { alive = false; };
  }, [rooms]);

  const removeDraft = async (id) => {
    setConfirmId(null);
    setDrafts(list => (list || []).filter(d => d.id !== id));
    try { await window.NpjDrafts.remove(id); } catch (e) {}
  };

  const newDoc = () => onOpen("d" + Date.now().toString(36));

  const query = q.trim().toLowerCase();
  const match = (d) => !query || ((d.title || "") + " " + (d.column || "") + " " + (d.tags || []).join(" ")).toLowerCase().includes(query);
  const shownDrafts = (drafts || []).filter(match);

  // projects = shared Matrix rooms (indexed ∪ joined, control room excluded).
  // A project can hold several documents and shares one set of invitees.
  const projects = (() => {
    if (!rooms) return [];
    const seen = {}; const out = [];
    (rooms.drafts || []).forEach(d => { if (d.roomId && !seen[d.roomId]) { seen[d.roomId] = 1; out.push({ roomId: d.roomId, title: d.title, ts: d.ts, topic: "" }); } });
    (rooms.joined || []).forEach(r => { if (r.kind !== "control" && !seen[r.roomId]) { seen[r.roomId] = 1; out.push({ roomId: r.roomId, title: r.name, topic: r.topic || "" }); } });
    return out;
  })();
  const projectTitle = (room) => room ? ((projects.find(p => p.roomId === room.roomId) || {}).title || room.title || "project") : null;
  const docsInProject = (roomId) => (drafts || []).filter(d => d.room && d.room.roomId === roomId);
  const soloDrafts = shownDrafts.filter(d => !d.room || !d.room.roomId);

  // one document row — used inside a project card and in the no-project group
  const draftRow = (d, inProject) => {
    const words = draftWords(d);
    // per-draft truth from drafts.list(): synced to the account, or only here
    const wb = d.where === "synced"
      ? { color: "var(--verified)", text: "● on your account + this browser" }
      : d.where === "ahead"
      ? { color: "var(--review)", text: "● newest copy in this browser — backing up to your account…" }
      : { color: "var(--review)", text: "● this browser only" };
    return (
      <div key={d.id} style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: inProject ? "none" : "4px 4px 0 rgba(22,20,13,.10)", padding: inProject ? "10px 13px" : "13px 16px", marginBottom: inProject ? 7 : 10, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: inProject ? 17 : 20, lineHeight: 1.05 }}>{d.title || "Untitled"}</span>
            {d.id === "working" && <span className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--ink)", background: "var(--yellow)", padding: "1px 6px" }}>working draft</span>}
            {d.kind === "post" && <span className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--ink)", background: "var(--paper-2)", padding: "1px 6px" }}>post · from Submit</span>}
          </div>
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{timeAgo(d.updated)}</span>
            <span>{words} word{words === 1 ? "" : "s"}</span>
            {d.column && <span>→ {d.column}</span>}
            {!inProject && d.room && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><I.folder style={{ fontSize: 11 }} /> {projectTitle(d.room)}</span>}
            <span style={{ color: wb.color }}>{wb.text}</span>
          </div>
          {(d.tags || []).length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
              {d.tags.map(t => <span key={t} className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--rule)", padding: "1px 6px", background: "var(--paper-2)" }}>#{t}</span>)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          {/* every draft — including legacy "post" drafts from the old Submit
              composer — opens in the Newsroom editor */}
          <button className="btn btn-primary btn-sm" onClick={() => onOpen(d.id)} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <I.arrow style={{ fontSize: 12 }} /> Open
          </button>
          {confirmId === d.id ? (
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
              <span className="np-mono" style={{ fontSize: 10, color: "var(--reject)" }}>delete?</span>
              <button className="btn btn-sm" onClick={() => removeDraft(d.id)} style={{ borderColor: "var(--reject)", color: "var(--reject)" }}>Yes</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmId(null)}>No</button>
            </span>
          ) : (
            <button className="btn btn-sm btn-ghost" title="Delete this draft everywhere" onClick={() => setConfirmId(d.id)}><I.x style={{ fontSize: 12 }} /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in">
      <Masthead route="docs" onHome={onHome} onNewsroom={onNewsroom} />
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "34px 22px 80px" }}>
        {!signedIn ? (
          <SignedOutDocs onSignIn={onSignIn} />
        ) : (
          <React.Fragment>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", borderBottom: "3px solid var(--ink)", paddingBottom: 14, marginBottom: 18 }}>
              <div>
                <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 8 }}>Signed in · {session.user_id}</div>
                <h1 style={{ fontFamily: "var(--display)", fontSize: 52, lineHeight: .9, margin: 0 }}>Documents</h1>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "0 9px" }}>
                  <I.search style={{ fontSize: 14, color: "var(--ink-soft)" }} />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search drafts…" style={{ border: 0, background: "transparent", padding: "8px 0", width: 150, fontFamily: "var(--serif)", fontSize: 13.5, outline: "none" }} />
                </span>
                <button className="btn btn-primary" onClick={newDoc} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <I.plus style={{ fontSize: 13 }} /> New document
                </button>
              </div>
            </div>

            {/* ---- the explorer, grouped by project ----
                 A project is a shared Matrix room: one set of invitees, any
                 number of documents. Each card shows WHO IS INVITED (live from
                 the homeserver) and the documents inside. */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.folder style={{ fontSize: 14 }} /> Projects {rooms ? "· " + projects.length : ""}
            </div>
            <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", margin: "0 0 10px", lineHeight: 1.5 }}>A project holds any number of documents and shares one set of invitees — everyone listed on a project can work on all of its documents. Recovered from Matrix, not this browser — wipe or switch devices and they're still here after you sign in.</div>
            {(!rooms || !drafts) && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center", marginBottom: 10 }}><DocSpinner /> recovering your workspace (this browser + your Matrix account)…</div>}
            {rooms && drafts && projects.length === 0 && (
              <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)", marginBottom: 8 }}>No projects yet. Invite a collaborator from the Newsroom and a project is created for you.</div>
            )}
            {rooms && drafts && projects.map(p => {
              const docs = docsInProject(p.roomId).filter(match);
              if (query && !docs.length && !(p.title || "").toLowerCase().includes(query)) return null;
              return (
                <div key={p.roomId} style={{ border: "1.5px solid var(--ink)", background: "var(--paper-2)", boxShadow: "4px 4px 0 rgba(22,20,13,.10)", padding: "12px 15px", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 19, display: "inline-flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 15 }} /> {p.title || "Untitled project"}</span>
                    <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
                    {p.ts && <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{timeAgo(p.ts)}</span>}
                  </div>
                  {p.topic && <div style={{ fontFamily: "var(--serif)", fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{p.topic}</div>}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--rule)" }}>
                    <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 10 }}>Invited</span>
                    <MemberChips list={members[p.roomId]} me={me} />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {docs.length === 0 && <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>{query ? "no documents match the search" : "no documents in this project yet"}</div>}
                    {docs.map(d => draftRow(d, true))}
                  </div>
                </div>
              );
            })}
            {rooms && rooms.error && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 6 }}>{rooms.error}</div>}

            {/* ---- documents that belong to no project ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.doc style={{ fontSize: 14 }} /> Your documents · not in a project {drafts ? "· " + soloDrafts.length : ""}
            </div>
            {drafts && soloDrafts.length === 0 && (
              <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "22px 20px", textAlign: "center", marginBottom: 8 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 17, marginBottom: 4 }}>{query ? "Nothing matches “" + q.trim() + "”." : "Nothing here."}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>{query ? "Try another search." : "Start a document and it autosaves here — and to your Matrix account. Invite someone and it moves into a project."}</div>
              </div>
            )}
            {drafts && soloDrafts.map(d => draftRow(d, false))}

            {/* ---- the published record: one version folder per document ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.check style={{ fontSize: 14 }} /> Published · versioned event logs committed to GitHub
            </div>
            {statusErr && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)", border: "1px solid var(--reject)", padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>{statusErr}</div>}
            {!published && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center" }}><DocSpinner /> reading the public record…</div>}
            {published && pubArticles.length === 0 && published.legacy.length === 0 && (
              <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>Nothing published yet. When a piece ships, its version folder lands in articles/ and is listed here.</div>
            )}
            {published && pubArticles.map(m => {
              // the row's status: unpublished (off the site) · updated (edited
              // since publish — newest version file wins) · published
              const badge = m.status === "unpublished"
                ? { label: "⊘ Unpublished", color: "var(--reject)" }
                : (m.versions || 1) > 1
                ? { label: "⊛ Updated" + (m.updated ? " " + m.updated : ""), color: "var(--review)" }
                : { label: "● Published", color: "var(--verified)" };
              // folder docs link to their version folder; legacy single-file
              // logs to the file's commit history
              const logHref = m.storage === "file"
                ? "https://github.com/clovenbradshaw-ctrl/npj/commits/main/" + (m.logPath || ("articles/" + m.slug + ".jsonl"))
                : "https://github.com/clovenbradshaw-ctrl/npj/tree/main/" + (m.logPath || ("articles/" + m.slug));
              const busy = statusBusy === m.slug;
              return (
                <div key={m.slug} style={{ borderBottom: "1px solid var(--rule)", padding: "9px 2px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", opacity: m.status === "unpublished" ? .6 : 1 }}>
                  <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{m.headline}</span>
                  <span className="np-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".06em", color: badge.color, border: "1px solid " + badge.color, padding: "1px 5px", textTransform: "uppercase" }}>{badge.label}</span>
                  <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{m.kicker}{m.published ? " · " + m.published : ""} · {m.versions} version{m.versions !== 1 ? "s" : ""}</span>
                  <span style={{ flex: 1 }} />
                  {onOpenArticle && (
                    <button onClick={() => onOpenArticle(m.slug)} className="btn btn-sm btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <I.arrow style={{ fontSize: 12 }} /> Read
                    </button>
                  )}
                  {isAdmin && (m.status === "unpublished" ? (
                    <button className="btn btn-sm" disabled={busy} onClick={() => setDocStatus(m, "published")} title="Republish — put it back on the site"
                      style={{ background: "var(--yellow)", fontWeight: 700, opacity: busy ? .5 : 1 }}>↺ {busy ? "Working…" : "Republish"}</button>
                  ) : (
                    <button className="btn btn-sm" disabled={busy} onClick={() => setDocStatus(m, "unpublished")} title="Unpublish — take it off the site (every version stays in GitHub)"
                      style={{ borderColor: "var(--reject)", color: "var(--reject)", opacity: busy ? .5 : 1 }}>⊘ {busy ? "Working…" : "Unpublish"}</button>
                  ))}
                  <a href={logHref} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 10.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <I.ext style={{ fontSize: 12 }} /> {m.storage === "file" ? "event log" : "versions"}
                  </a>
                </div>
              );
            })}
            {published && published.legacy.length > 0 && (
              <React.Fragment>
                <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "12px 0 4px" }}>legacy markdown files (pre-EO-log) still at the repo root:</div>
                {published.legacy.map(f => (
                  <div key={f.name} style={{ borderBottom: "1px solid var(--rule)", padding: "7px 2px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="np-mono" style={{ fontSize: 11.5 }}>{f.name}</span>
                    <span style={{ flex: 1 }} />
                    <a href={f.html_url} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 10.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2 }}>view ↗</a>
                  </div>
                ))}
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </main>
    </div>
  );
}

/* Signed out ≠ gone. Drafts autosave to this browser even while signed out, and
   signing out doesn't delete them — so show them, say exactly where they live,
   and make sign-in the way to open them (and re-sync them to the account).
   Before this, the page hid everything behind the sign-in wall and a freshly
   written doc looked like it had been erased. */
function SignedOutDocs({ onSignIn }) {
  const local = (window.NpjDrafts && window.NpjDrafts.localList) ? window.NpjDrafts.localList() : [];
  return (
    <div style={{ maxWidth: 640, margin: "50px auto" }}>
      <div style={{ textAlign: "center" }}>
        <I.doc style={{ fontSize: 38 }} />
        <h1 style={{ fontFamily: "var(--display)", fontSize: 46, lineHeight: .94, margin: "14px 0 12px" }}>
          {local.length ? "Your drafts are still here." : "Your documents live on your account."}
        </h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: 17, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 22px" }}>
          {local.length
            ? "You're signed out, so these drafts are saved in this browser only right now. Sign in and they sync back to your Matrix account — and open for editing."
            : "Drafts autosave to the browser you write in and back up to your Matrix account — sign in and they follow you to any device."}
        </p>
        <button className="btn btn-primary" onClick={onSignIn} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <I.lock style={{ fontSize: 14 }} /> Sign in with Matrix
        </button>
      </div>

      {local.length > 0 && (
        <div style={{ marginTop: 38 }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
            <I.doc style={{ fontSize: 14 }} /> Saved in this browser · {local.length}
          </div>
          {local.map(d => {
            const words = draftWords(d);
            return (
              <div key={d.id} style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "4px 4px 0 rgba(22,20,13,.10)", padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 18, lineHeight: 1.05 }}>{d.title || "Untitled"}</span>
                    {d.kind === "post" && <span className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--ink)", background: "var(--paper-2)", padding: "1px 6px" }}>post · from Submit</span>}
                  </div>
                  <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>{timeAgo(d.updated)}</span>
                    <span>{words} word{words === 1 ? "" : "s"}</span>
                    <span style={{ color: "var(--review)" }}>● this browser only — not on an account</span>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={onSignIn} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <I.lock style={{ fontSize: 11 }} /> Sign in to open
                </button>
              </div>
            );
          })}
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.5, marginTop: 4 }}>
            These survive a refresh and a sign-out, but not a browser wipe or another device — signing in backs them up to your account.
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { DocumentsPage });
