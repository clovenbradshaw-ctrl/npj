/* NPJ — collaborative composer. Anyone can create content and edit it together.
   Rich text + whitelisted embed widgets + live collaborators + a target feed.

   Durability: this surface used to keep EVERYTHING in React state — headline,
   standfirst, tags and body died on sign-out/refresh, with a "Sign out" button
   sitting right next to the canvas. It now autosaves through NpjDrafts exactly
   like the newsroom (this browser on every change + Matrix account a moment
   later) and restores when you come back. */

const POST_DRAFT_ID = "post"; // the one working post draft; shows under Documents

const EMBEDS = [
  { key: "data-map", label: "Data map", icon: "data", hint: "eviction map, parcel map, choropleth" },
  { key: "chart", label: "Chart", icon: "data", hint: "bar / line / area from a dataset" },
  { key: "table", label: "Data table", icon: "data", hint: "sortable rows, foldable totals" },
  { key: "doc", label: "Document", icon: "doc", hint: "embedded PDF / filing viewer" },
  { key: "video", label: "Video", icon: "mic", hint: "archived clip or stream" },
  { key: "poll", label: "Community poll", icon: "chat", hint: "ask readers a question" }
];

function Composer({ user, session, onSignOut }) {
  const ed = useRef(null);
  const savedRange = useRef(null);
  const [feed, setFeed] = useState("npj");
  const [title, setTitle] = useState("");
  const [dek, setDek] = useState("");
  const [collabs, setCollabs] = useState(() => [user]);
  const [invite, setInvite] = useState(false);
  const [inviteVal, setInviteVal] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [room, setRoom] = useState(null); // { roomId, alias }
  const [tags, setTags] = useState([]);
  const [insertOpen, setInsertOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [wc, setWc] = useState(0);
  const [pickData, setPickData] = useState(false);
  const [cited, setCited] = useState([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const feeds = (window.NPJ.FEEDS || []).map(f => f.id);
  const titleRef = useRef(null);
  const dekRef = useRef(null);

  // let Clippy drop suggested tags straight in
  useEffect(() => {
    window.__draftTags = { add: (t) => setTags(list => list.includes(t) ? list : [...list, t]), get: () => tags };
    return () => { if (window.__draftTags) delete window.__draftTags; };
  });

  // ---- durable draft: restore on open, autosave on every change ----
  const restored = useRef(false); // gate autosave until the first restore lands
  const saveTimer = useRef(null);
  const htmlRef = useRef("");     // last seen body HTML, for the unmount flush

  const persist = useCallback(() => {
    if (!restored.current) return;
    const html = ed.current ? ed.current.innerHTML : htmlRef.current;
    window.NpjDrafts.save(POST_DRAFT_ID, { kind: "post", html, title, dek, tags, feed, room });
    saveTimer.current = null;
  }, [title, dek, tags, feed, room]);
  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; });
  const scheduleSave = useCallback(() => {
    if (!restored.current) return;
    if (ed.current) htmlRef.current = ed.current.innerHTML;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 500);
  }, [persist]);
  // unmounting (sign-out swaps in the gate, or you navigate away) with a save
  // still pending? write it now instead of dropping the last keystrokes
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); try { persistRef.current(); } catch (e) {} }
  }, []);

  const fitArea = (el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };
  useEffect(() => {
    let alive = true;
    (async () => {
      let d = null;
      try { d = await window.NpjDrafts.restore(POST_DRAFT_ID); } catch (e) {}
      if (alive && d) {
        if (ed.current && d.html) { ed.current.innerHTML = d.html; htmlRef.current = d.html; }
        if (d.title) setTitle(d.title);
        if (d.dek) setDek(d.dek);
        if (Array.isArray(d.tags)) setTags(d.tags);
        if (d.feed && feeds.includes(d.feed)) setFeed(d.feed);
        if (d.room) setRoom(d.room);
        const t = ed.current ? ed.current.innerText.trim() : "";
        setWc(t ? t.split(/\s+/).length : 0);
        setTimeout(() => { fitArea(titleRef.current); fitArea(dekRef.current); }, 30);
      }
      restored.current = true;
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { scheduleSave(); }, [title, dek, tags, feed, room, scheduleSave]);
  useEffect(() => { if (session) window.NpjDrafts.flush(POST_DRAFT_ID); }, [session]); // back up local-only work after sign-in

  // real Matrix invite — create the project (a shared room that can hold many
  // documents) on first invite, then invite the collaborator into it.
  const doInvite = async () => {
    const raw = inviteVal.trim(); if (!raw) return;
    if (!session) { setInviteMsg("Sign in with Matrix to invite collaborators."); return; }
    const id = window.MatrixAuth.parseMxid(raw);
    if (!id) { setInviteMsg("Use a full Matrix ID: @name:server"); return; }
    setInviteMsg("Inviting …");
    try {
      let rm = room;
      if (!rm) { rm = await window.MatrixAuth.createDraftRoom(title || "Untitled draft"); setRoom(rm); }
      await window.MatrixAuth.invite(rm.roomId, id.mxid);
      setCollabs(c => c.includes(id.mxid) ? c : [...c, id.mxid]);
      setInviteVal(""); setInviteMsg("Invited " + id.mxid + " into the project — they can work on every document in it.");
    } catch (e) {
      setInviteMsg("Invite failed: " + (e.message || "try again"));
    }
  };

  const saveSel = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && ed.current && ed.current.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange();
  };
  useEffect(() => {
    document.addEventListener("selectionchange", saveSel);
    return () => document.removeEventListener("selectionchange", saveSel);
  }, []);

  const focusEd = () => { ed.current && ed.current.focus(); };
  const restore = () => {
    const sel = window.getSelection();
    if (savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
    else { focusEd(); }
  };
  const exec = (cmd, val) => { focusEd(); restore(); document.execCommand(cmd, false, val); updateWc(); };
  const updateWc = () => { const t = ed.current ? ed.current.innerText.trim() : ""; setWc(t ? t.split(/\s+/).length : 0); scheduleSave(); };

  const insertHTML = (html) => {
    focusEd(); restore();
    document.execCommand("insertHTML", false, html + "<p><br></p>");
    updateWc();
  };
  // pasted text loses its original formatting — rebuilt from text/plain
  const onPaste = (e) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    window.NpjPlainText.insert(text);
    updateWc();
  };
  const insertImage = () => { insertHTML(`<figure contenteditable="false" class="cmp-embed"><image-slot id="img-${Date.now()}" style="width:100%;height:300px" shape="rect" placeholder="Drop a photo"></image-slot><figcaption class="np-mono">photo · drag an image, then add a caption &amp; credit</figcaption></figure>`); setInsertOpen(false); };
  const insertDivider = () => { insertHTML(`<hr class="cmp-hr"/>`); setInsertOpen(false); };
  const insertEmbed = (e) => {
    insertHTML(`<div contenteditable="false" class="cmp-embed cmp-widget"><div class="cmp-widget-h"><span class="np-mono">::embed[${e.key}]</span><span class="cmp-tag">whitelisted widget</span></div><div class="cmp-widget-b"><strong>${e.label}</strong><span>${e.hint}</span></div><div class="np-mono cmp-widget-f">sandboxed · no raw HTML or scripts execute</div></div>`);
    setInsertOpen(false);
  };
  const bindSource = () => {
    focusEd(); restore();
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const span = document.createElement("span");
    span.className = "claim"; span.style.background = "rgba(255,236,1,.5)"; span.style.borderBottom = "1.5px solid var(--ink)";
    try { sel.getRangeAt(0).surroundContents(span); } catch (e) { /* crosses nodes */ }
    sel.removeAllRanges();
    scheduleSave();
  };

  const citeData = (d) => {
    insertHTML(`<span contenteditable="false" class="cmp-cite">◆ ${d.name} <span class="np-mono">::cite[${d.id}]</span></span>&nbsp;`);
    setCited(c => c.find(x => x.id === d.id) ? c : [...c, d]);
    setPickData(false);
  };
  const doSend = () => {
    const unarchived = cited.filter(d => !d.archived);
    if (unarchived.length) setArchiveOpen(true);
    else setSent(true);
  };

  if (sent) return <ComposerSent user={user} feed={feed} title={title} collabs={collabs} />;

  const feedName = (id) => { const f = (window.NPJ.FEEDS || []).find(x => x.id === id); return f ? f.name : "NPJ"; };

  return (
    <div className="fade-in">
      {/* collaboration bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 1600, background: "var(--ink)", color: "var(--paper)", borderBottom: "1.5px solid var(--ink)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "9px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="np-eyebrow" style={{ color: "var(--yellow)" }}>New post</span>
          <DraftStatusPill id={POST_DRAFT_ID} signedIn={!!session} user={user}
            what="headline, standfirst, tags and body" style={{ borderColor: "rgba(255,255,255,.25)" }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="np-mono" style={{ fontSize: 11, opacity: .6 }}>to</span>
            <select value={feed} onChange={(e) => setFeed(e.target.value)} className="np-cond"
              style={{ background: "transparent", color: "var(--paper)", border: "1px solid rgba(255,255,255,.25)", padding: "4px 8px", fontSize: 14, fontWeight: 600 }}>
              {feeds.map(id => <option key={id} value={id} style={{ color: "#000" }}>{feedName(id)}</option>)}
              <option value="new" style={{ color: "#000" }}>+ Start a new feed…</option>
            </select>
          </span>

          <span style={{ flex: 1 }} />

          {/* live presence */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="editing now">
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7fd8a6", boxShadow: "0 0 0 0 rgba(127,216,166,.6)", animation: "pulse 1.6s infinite" }} />
            <span className="np-mono" style={{ fontSize: 11, opacity: .75 }}>{collabs.length} editing</span>
          </span>
          <div style={{ display: "flex" }}>
            {collabs.slice(0, 4).map((c, i) => {
              const p = window.NPJ.PEOPLE[c] || { name: c.replace(/^@/, ""), color: "#b23a26" };
              return <span key={c + i} title={p.name} style={{ width: 26, height: 26, borderRadius: "50%", background: p.color, color: "#fff", border: "2px solid var(--ink)", marginLeft: i ? -8 : 0, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{(p.name || "?")[0].toUpperCase()}</span>;
            })}
          </div>
          <div style={{ position: "relative" }}>
            <button className="np-cond" onClick={() => setInvite(v => !v)} style={{ background: "transparent", color: "var(--paper)", border: "1px solid rgba(255,255,255,.25)", padding: "5px 11px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>Invite</button>
            {invite && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 280, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(22,20,13,.2)", padding: 12, zIndex: 20 }}>
                <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Invite a collaborator</div>
              <div style={{ display: "flex", gap: 6 }}>
                  <input value={inviteVal} onChange={(e) => setInviteVal(e.target.value)} placeholder="@name:server"
                    onKeyDown={(e) => e.key === "Enter" && doInvite()}
                    className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
                  <button className="btn btn-sm btn-primary" onClick={doInvite}>Invite</button>
                </div>
                {inviteMsg && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.4 }}>{inviteMsg}</div>}
                {room && room.alias && <div className="np-mono" style={{ fontSize: 10, color: "var(--verified)", marginTop: 5 }}>project: {room.alias}</div>}
                <div style={{ fontFamily: "var(--serif)", fontSize: 12, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>They're invited into the project's Matrix room and can write alongside you — recoverable from any browser.</div>
              </div>
            )}
          </div>
          <button className="btn btn-sm btn-primary" onClick={doSend} disabled={!title.trim()} style={{ opacity: title.trim() ? 1 : .45, cursor: title.trim() ? "pointer" : "not-allowed" }}>
            {feed === "npj" ? "Send to editors" : "Publish draft"}
          </button>
        </div>
      </div>

      {/* canvas */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "30px 22px 90px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Handle mxid={user} showName /><span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>· drafting</span></span>
          {/* save synchronously first — the pending debounce dies with the unmount otherwise */}
          <button className="btn btn-sm btn-ghost" onClick={() => { try { persistRef.current(); } catch (e) {} onSignOut(); }}
            title="Your draft stays saved — in this browser and on your Matrix account.">Sign out</button>
        </div>

        <textarea ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} rows={1} placeholder="Headline"
          onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
          style={{ width: "100%", border: 0, outline: "none", resize: "none", background: "transparent", fontFamily: "var(--display)", fontSize: 52, lineHeight: .98, marginBottom: 8, overflow: "hidden" }} />
        <textarea ref={dekRef} value={dek} onChange={(e) => setDek(e.target.value)} rows={1} placeholder="Add a standfirst…"
          onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
          style={{ width: "100%", border: 0, outline: "none", resize: "none", background: "transparent", fontFamily: "var(--serif)", fontSize: 21, fontStyle: "italic", lineHeight: 1.35, color: "var(--ink-soft)", marginBottom: 16, overflow: "hidden" }} />

        {/* tags — Clippy suggests; you confirm */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16, paddingBottom: 14, borderBottom: "1.5px solid var(--rule)" }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Tags</span>
          {tags.map(t => (
            <span key={t} className="np-mono" style={{ fontSize: 11.5, border: "1.5px solid var(--ink)", background: "var(--paper-2)", padding: "3px 4px 3px 8px", display: "inline-flex", alignItems: "center", gap: 5 }}>
              #{t}<button onClick={() => setTags(list => list.filter(x => x !== t))} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 12, lineHeight: 1, color: "var(--ink-soft)" }}>×</button>
            </span>
          ))}
          <input placeholder="add a tag…" onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { const t = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); if (t) setTags(list => list.includes(t) ? list : [...list, t]); e.target.value = ""; } }}
            className="np-mono" style={{ border: "1px dashed var(--rule-strong)", background: "transparent", padding: "4px 8px", fontSize: 12, outline: "none", width: 110 }} />
          <button onClick={() => window.__clippy && window.__clippy.suggest()} className="np-cond" style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "4px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>📎 Suggest</button>
        </div>

        {/* toolbar */}
        <div style={{ position: "sticky", top: 46, zIndex: 1500, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
          background: "var(--paper)", border: "1.5px solid var(--ink)", padding: "5px 6px", marginBottom: 18 }}>
          {[["bold", "B", { fontWeight: 800 }], ["italic", "I", { fontStyle: "italic" }]].map(([cmd, lab, st]) => (
            <TBtn key={cmd} onClick={() => exec(cmd)} style={st}>{lab}</TBtn>
          ))}
          <TBtn onClick={() => { const u = prompt("Link URL"); if (u) exec("createLink", u); }}><I.ext style={{ fontSize: 15 }} /></TBtn>
          <Sep />
          <TBtn onClick={() => exec("formatBlock", "<h2>")} style={{ fontFamily: "var(--cond)", fontWeight: 700 }}>H2</TBtn>
          <TBtn onClick={() => exec("formatBlock", "<blockquote>")}>“”</TBtn>
          <TBtn onClick={() => exec("insertUnorderedList")}>• List</TBtn>
          <Sep />
          <TBtn onClick={bindSource} title="Bind selected text to a source — the claim stands on it"><I.source style={{ fontSize: 14 }} /> Source</TBtn>
          <Sep />
          <div style={{ position: "relative" }}>
            <TBtn onClick={() => setInsertOpen(o => !o)} style={{ background: insertOpen ? "var(--ink)" : "transparent", color: insertOpen ? "var(--yellow)" : "var(--ink)" }}><I.plus style={{ fontSize: 14 }} /> Insert</TBtn>
            {insertOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 250, background: "var(--card)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(22,20,13,.18)", zIndex: 30, padding: 6 }}>
                <InsertItem icon={<I.archive style={{ fontSize: 16 }} />} label="Image" onClick={insertImage} />
                <InsertItem icon={<I.arrow style={{ fontSize: 16 }} />} label="Divider" onClick={insertDivider} />
                <div className="np-eyebrow" style={{ color: "var(--ink-soft)", padding: "8px 8px 4px" }}>Embed a widget</div>
                {EMBEDS.map(e => <InsertItem key={e.key} icon={<span className="np-mono" style={{ fontSize: 12 }}>::</span>} label={e.label} hint={e.hint} onClick={() => insertEmbed(e)} />)}
                <div className="np-eyebrow" style={{ color: "var(--ink-soft)", padding: "8px 8px 4px", borderTop: "1px solid var(--rule)", marginTop: 4 }}>Cite evidence</div>
                <InsertItem icon={<I.data style={{ fontSize: 16 }} />} label="Cite a dataset" hint="search data across every project" onClick={() => { setPickData(true); setInsertOpen(false); }} />
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", padding: "0 6px" }}>{wc} words · ~{Math.max(1, Math.round(wc / 200))} min</span>
        </div>

        <div ref={ed} contentEditable suppressContentEditableWarning onInput={updateWc} onPaste={onPaste}
          className="cmp-body" data-ph="Start writing. Select text to format it, or hit Insert to drop in a photo or a data widget…"
          style={{ minHeight: 320, outline: "none", fontFamily: "var(--serif)", fontSize: 18.5, lineHeight: 1.62 }}>
          <p><br/></p>
        </div>

        <div style={{ marginTop: 22, borderTop: "1.5px solid var(--rule)", paddingTop: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <I.shield style={{ fontSize: 18, color: "var(--ink-soft)", flex: "0 0 auto", marginTop: 1 }} />
          <p style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: 0 }}>
            Highlight a fact and hit <strong>⊨ Source</strong> to bind it to evidence. On publish, each bound claim is frozen to an archive.org snapshot — and a claim with no source fails the build.
          </p>
        </div>
      </div>

      {pickData && <DataPicker onPick={citeData} onClose={() => setPickData(false)} />}
      {archiveOpen && <ArchiveModal items={cited.filter(d => !d.archived).map(d => ({ name: d.name }))} onClose={() => setArchiveOpen(false)} onDone={() => { setArchiveOpen(false); setSent(true); }} />}
    </div>
  );
}

function TBtn({ children, onClick, style, title }) {
  return <button onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title} className="np-cond"
    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: 0, padding: "6px 9px", fontSize: 14, fontWeight: 600, color: "var(--ink)", cursor: "pointer", ...style }}>{children}</button>;
}
function Sep() { return <span style={{ width: 1, height: 20, background: "var(--rule)", margin: "0 2px" }} />; }
function InsertItem({ icon, label, hint, onClick }) {
  return (
    <button onMouseDown={(e) => e.preventDefault()} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "transparent", border: 0, padding: "8px 8px", cursor: "pointer" }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--paper-2)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
      <span style={{ width: 22, display: "inline-flex", justifyContent: "center", color: "var(--ink-soft)" }}>{icon}</span>
      <span><span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15 }}>{label}</span>{hint && <span style={{ display: "block", fontFamily: "var(--serif)", fontSize: 11.5, color: "var(--ink-soft)" }}>{hint}</span>}</span>
    </button>
  );
}

function ComposerSent({ user, feed, title, collabs }) {
  const f = (window.NPJ.FEEDS || []).find(x => x.id === feed);
  const fname = f ? f.name : "NPJ";
  return (
    <div className="fade-in" style={{ maxWidth: 620, margin: "0 auto", padding: "60px 22px", textAlign: "center" }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--verified)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><I.check style={{ fontSize: 34 }} /></div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 46, lineHeight: .95, margin: "0 0 12px" }}>Draft saved to {fname}.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 17, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "46ch", margin: "0 auto 18px" }}>
        “{title || "Untitled"}” is open for collaborative editing. {collabs.length - 1} collaborator{collabs.length - 1 !== 1 ? "s were" : " was"} notified and can write alongside you. Nothing publishes until a source is bound to every claim.
      </p>
      <p className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", maxWidth: "52ch", margin: "0 auto 18px", lineHeight: 1.5 }}>
        The draft itself is saved in this browser and backed up to your Matrix account — sign out or switch devices and it's under Documents.
      </p>
      <div className="np-mono" style={{ fontSize: 11, background: "var(--ink)", color: "#e9e4d4", display: "inline-block", padding: "8px 12px" }}>
        ● INS draft@{fname.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6)} · by {user} · {collabs.length} editors · open
      </div>
    </div>
  );
}

Object.assign(window, { Composer });
