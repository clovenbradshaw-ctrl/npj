/* NPJ — Documents. The signed-in document explorer: every draft this account
   can recover (localStorage ∪ Matrix account data, via app/drafts.js), the
   collaborative projects recovered straight from the homeserver, and the
   pieces already committed to GitHub. Gated to a signed-in session — guests
   are pointed at the Matrix sign-in on the Submit page. */

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

function DocumentsPage({ session, onOpen, onOpenPost, onHome, onNewsroom, onSignIn }) {
  const signedIn = !!session;
  const [drafts, setDrafts] = useState(null);       // null = loading
  const [rooms, setRooms] = useState(null);
  const [published, setPublished] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [q, setQ] = useState("");

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

  // published record: the .md files committed to the repo root (best-effort)
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("https://api.github.com/repos/clovenbradshaw-ctrl/npj/contents/?ref=main", { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error("github " + res.status);
        const items = await res.json();
        if (alive) setPublished((items || []).filter(f => f.type === "file" && /\.md$/i.test(f.name) && f.name.toLowerCase() !== "readme.md"));
      } catch (e) { if (alive) setPublished([]); }
    })();
    return () => { alive = false; };
  }, [signedIn]);

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

            {/* ---- drafts ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.doc style={{ fontSize: 14 }} /> Drafts {drafts ? "· " + shownDrafts.length : ""}
            </div>
            {!drafts && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center" }}><DocSpinner /> recovering drafts (this browser + your Matrix account)…</div>}
            {drafts && shownDrafts.length === 0 && (
              <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "26px 20px", textAlign: "center", marginBottom: 8 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 18, marginBottom: 4 }}>{query ? "Nothing matches “" + q.trim() + "”." : "No drafts yet."}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>{query ? "Try another search." : "Start one and it autosaves here — and to your Matrix account."}</div>
              </div>
            )}
            {drafts && shownDrafts.map(d => {
              const words = draftWords(d);
              // per-draft truth from drafts.list(): synced to the account, or only here
              const wb = d.where === "synced"
                ? { color: "var(--verified)", text: "● on your account + this browser" }
                : d.where === "ahead"
                ? { color: "var(--review)", text: "● newest copy in this browser — backing up to your account…" }
                : { color: "var(--review)", text: "● this browser only" };
              return (
                <div key={d.id} style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "4px 4px 0 rgba(22,20,13,.10)", padding: "13px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 20, lineHeight: 1.05 }}>{d.title || "Untitled"}</span>
                      {d.id === "working" && <span className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--ink)", background: "var(--yellow)", padding: "1px 6px" }}>working draft</span>}
                      {d.kind === "post" && <span className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--ink)", background: "var(--paper-2)", padding: "1px 6px" }}>post · from Submit</span>}
                    </div>
                    <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>{timeAgo(d.updated)}</span>
                      <span>{words} word{words === 1 ? "" : "s"}</span>
                      {d.column && <span>→ {d.column}</span>}
                      {d.room && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><I.folder style={{ fontSize: 11 }} /> {projectTitle(d.room)}</span>}
                      <span style={{ color: wb.color }}>{wb.text}</span>
                    </div>
                    {(d.tags || []).length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                        {d.tags.map(t => <span key={t} className="np-mono" style={{ fontSize: 9.5, border: "1px solid var(--rule)", padding: "1px 6px", background: "var(--paper-2)" }}>#{t}</span>)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <button className="btn btn-primary btn-sm" onClick={() => (d.kind === "post" && onOpenPost) ? onOpenPost() : onOpen(d.id)} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
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
            })}

            {/* ---- projects (shared Matrix rooms: many documents, one set of invitees) ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.folder style={{ fontSize: 14 }} /> Projects · from your homeserver
            </div>
            <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", margin: "0 0 10px", lineHeight: 1.5 }}>A project holds any number of documents and shares one set of invitees — everyone in a project can work on all of its documents. Recovered from Matrix, not this browser — wipe or switch devices and they're still here after you sign in.</div>
            {!rooms && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center" }}><DocSpinner /> loading from the homeserver…</div>}
            {rooms && projects.length === 0 && (
              <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>No projects yet. Invite a collaborator from the Newsroom and a project is created for you.</div>
            )}
            {rooms && projects.map(p => {
              const docs = docsInProject(p.roomId);
              return (
                <div key={p.roomId} style={{ border: "1.5px solid var(--rule-strong)", background: "var(--paper-2)", padding: "10px 13px", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 13 }} /> {p.title || "Untitled project"}</span>
                    <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{docs.length} document{docs.length !== 1 ? "s" : ""} · shared invitees</span>
                    {p.ts && <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{timeAgo(p.ts)}</span>}
                  </div>
                  {p.topic && <div style={{ fontFamily: "var(--serif)", fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{p.topic}</div>}
                  <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 2 }}>{p.roomId}</div>
                  {docs.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {docs.map(d => (
                        <button key={d.id} onClick={() => onOpen(d.id)} title="Open this document" className="np-cond" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--ink)", background: "var(--card)", padding: "3px 9px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                          <I.doc style={{ fontSize: 12 }} /> {d.title || "Untitled"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {rooms && rooms.error && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 6 }}>{rooms.error}</div>}

            {/* ---- the published record ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.check style={{ fontSize: 14 }} /> Published · committed to GitHub
            </div>
            {!published && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center" }}><DocSpinner /> reading the public record…</div>}
            {published && published.length === 0 && (
              <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>Nothing published yet. When a piece ships it's committed to the repo and listed here.</div>
            )}
            {published && published.map(f => (
              <div key={f.name} style={{ borderBottom: "1px solid var(--rule)", padding: "8px 2px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="np-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{f.name}</span>
                <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{Math.max(1, Math.round((f.size || 0) / 1024))} KB</span>
                <span style={{ flex: 1 }} />
                <a href={f.html_url} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 10.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <I.ext style={{ fontSize: 12 }} /> view commit history
                </a>
              </div>
            ))}
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
