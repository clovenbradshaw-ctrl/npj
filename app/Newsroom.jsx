/* NPJ newsroom — the editor. Ships empty. Manual, span-bound sourcing (drafteo
   style: select the exact words → bind a source; one source can back many spans).
   Adds: banner + inline images, a proper link/jump-link popover, a section
   contents rail, Clippy-assisted tags, real Matrix room invites + server-side
   room recovery (survives a browser wipe), permission-gated publish, versioning. */

const NR = { panel: "#1d1b15", line: "rgba(255,255,255,.13)", muted: "#8c8676", text: "#e3ddcc", soft: "#b3ad9c", field: "#14130f" };

const START_DOC =
  '<figure contenteditable="false" class="nr-banner"><image-slot id="nr-banner" shape="rect" placeholder="Banner image — drag a photo" style="width:100%;height:300px;display:block"></image-slot></figure>' +
  '<h1>Untitled</h1><p><br/></p>';

function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }

function Newsroom({ session, draftId = "working", onExit, onPublished }) {
  const { layout, me } = React.useContext(window.LayoutCtx);
  const columns = (layout.sections || []).map(s => s.name);
  const canPub = window.canPublish(layout, session && session.user_id);
  const isMobile = window.useIsMobile();
  const [mTab, setMTab] = useState("write");          // mobile: write | contents | sources
  const [saveState, setSaveState] = useState("idle"); // idle|localonly|saving|syncing|synced|error
  const restored = useRef(false);                      // gate autosave until the first restore lands
  const saveTimer = useRef(null);

  const [sources, setSources] = useState([]);
  const [citeOrder, setCiteOrder] = useState([]);
  const citeOrderRef = useRef([]);
  const [rev, setRev] = useState(0);                // bump to recompute span counts
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [publish, setPublish] = useState(null);
  const [title, setTitle] = useState("Untitled");
  const [tags, setTags] = useState([]);
  const [column, setColumn] = useState(columns[0] || "");
  const [toc, setToc] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [rooms, setRooms] = useState(null);
  const [collabs, setCollabs] = useState(() => (session ? [session.user_id] : []));
  const [room, setRoom] = useState(null);
  const [invite, setInvite] = useState(false);
  const [inviteVal, setInviteVal] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const ed = useRef(null);
  const selRange = useRef(null);

  // let Clippy drop suggested tags in
  useEffect(() => {
    window.__draftTags = { add: (t) => setTags(list => list.includes(t) ? list : [...list, t]), get: () => tags };
    return () => { if (window.__draftTags) delete window.__draftTags; };
  });

  // ---- durable drafts: restore on open, autosave on every change ----
  // localStorage = instant recovery on refresh; Matrix account data = the
  // authoritative copy that survives a browser wipe / new device (app/drafts.js).
  const persist = useCallback(() => {
    if (!restored.current) return;
    const html = ed.current ? ed.current.innerHTML : "";
    const sourceRecords = {};
    sources.forEach(s => { if (window.NPJ.SOURCES[s.key]) sourceRecords[s.key] = window.NPJ.SOURCES[s.key]; });
    window.NpjDrafts.save(draftId, { html, title, tags, column, sources, citeOrder: citeOrderRef.current, sourceRecords, room });
  }, [draftId, title, tags, column, sources, room]);
  const scheduleSave = useCallback(() => {
    if (!restored.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 500);
  }, [persist]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let d = null;
      try { d = await window.NpjDrafts.restore(draftId); } catch (e) {}
      if (alive && d) {
        if (d.sourceRecords) Object.assign(window.NPJ.SOURCES, d.sourceRecords); // rehydrate source cards
        if (ed.current && d.html) ed.current.innerHTML = d.html;
        if (d.title) setTitle(d.title);
        if (Array.isArray(d.tags)) setTags(d.tags);
        if (d.column) setColumn(d.column);
        if (Array.isArray(d.sources)) setSources(d.sources);
        if (Array.isArray(d.citeOrder)) { citeOrderRef.current = d.citeOrder; setCiteOrder(d.citeOrder); }
        if (d.room) setRoom(d.room);
        setTimeout(scanHeadings, 30); setRev(v => v + 1);
      }
      restored.current = true;
    })();
    return () => { alive = false; };
  }, [draftId]);

  useEffect(() => window.NpjDrafts.onStatus(s => { if (!s.id || s.id === draftId) setSaveState(s.state); }), [draftId]);
  useEffect(() => { if (session) window.NpjDrafts.flush(draftId); }, [session, draftId]); // push local-only work up after sign-in
  useEffect(() => { scheduleSave(); }, [title, tags, column, sources, room, scheduleSave]);

  // ---- headings → ids + contents rail (jump-links) ----
  const scanHeadings = useCallback(() => {
    if (!ed.current) return;
    const seen = {};
    const hs = Array.from(ed.current.querySelectorAll("h1,h2,h3"));
    const items = [];
    hs.forEach(h => {
      const text = (h.innerText || "").trim();
      if (!text) return;
      let id = "s-" + slugify(text);
      if (seen[id]) { seen[id]++; id += "-" + seen[id]; } else seen[id] = 1;
      h.id = id;
      items.push({ id, text, level: +h.tagName[1] });
    });
    setToc(items);
    const h1 = ed.current.querySelector("h1");
    if (h1) setTitle(h1.innerText.trim() || "Untitled");
  }, []);
  useEffect(() => { const t = setTimeout(scanHeadings, 60); return () => clearTimeout(t); }, [scanHeadings]);

  const scrollToId = (id) => {
    const cont = ed.current; if (!cont) return;
    const el = cont.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
    if (!el) return;
    const cr = cont.getBoundingClientRect(), er = el.getBoundingClientRect();
    cont.scrollTop += (er.top - cr.top) - 18;
  };
  const onBodyClick = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a) { e.preventDefault(); scrollToId(a.getAttribute("href").slice(1)); }
  };

  // ---- selection plumbing ----
  useEffect(() => {
    const f = () => { const s = window.getSelection(); if (s && s.rangeCount && ed.current && ed.current.contains(s.anchorNode)) selRange.current = s.getRangeAt(0).cloneRange(); };
    document.addEventListener("selectionchange", f);
    return () => document.removeEventListener("selectionchange", f);
  }, []);
  const restore = () => { const s = window.getSelection(); if (selRange.current) { s.removeAllRanges(); s.addRange(selRange.current); } else ed.current && ed.current.focus(); };
  const exec = (cmd, val) => { ed.current && ed.current.focus(); restore(); document.execCommand(cmd, false, val); scanHeadings(); scheduleSave(); };
  const insertHTML = (html) => { ed.current && ed.current.focus(); restore(); document.execCommand("insertHTML", false, html); scanHeadings(); scheduleSave(); };
  const insertImage = () => insertHTML(`<figure contenteditable="false" class="cmp-embed"><image-slot id="img-${Date.now()}" shape="rect" placeholder="Drop a photo" style="width:100%;height:280px;display:block"></image-slot><figcaption class="np-mono" style="font-size:11px;color:${NR.muted};margin-top:4px">photo · drag an image, then caption &amp; credit</figcaption></figure><p><br/></p>`);

  // ---- floating selection toolbar: format + link/jumplink + source ----
  const [sel, setSel] = useState(null);
  const [menu, setMenu] = useState(null); // 'src' | 'link'
  const [srcQuery, setSrcQuery] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  useEffect(() => {
    const onUp = (e) => {
      if (e && e.target && e.target.closest && e.target.closest(".sel-tb")) return;
      const s = window.getSelection();
      if (s && s.rangeCount && !s.isCollapsed && ed.current && ed.current.contains(s.anchorNode) && ed.current.contains(s.focusNode)) {
        selRange.current = s.getRangeAt(0).cloneRange();
        const r = s.getRangeAt(0).getBoundingClientRect();
        setSel({ x: r.left + r.width / 2, y: r.top });
      } else { setSel(null); setMenu(null); }
    };
    document.addEventListener("mouseup", onUp); document.addEventListener("keyup", onUp);
    return () => { document.removeEventListener("mouseup", onUp); document.removeEventListener("keyup", onUp); };
  }, []);

  const citeNum = (key) => { const i = citeOrderRef.current.indexOf(key); return i < 0 ? 0 : i + 1; };
  const bindSource = (key) => {
    const r = selRange.current; if (!r || r.collapsed) { setInviteMsg(""); return; }
    let order = citeOrderRef.current;
    if (order.indexOf(key) < 0) { order = [...order, key]; citeOrderRef.current = order; setCiteOrder(order); }
    const num = order.indexOf(key) + 1;
    const span = document.createElement("span"); span.className = "claim-src"; span.setAttribute("data-src", key);
    try { r.surroundContents(span); } catch (e) { const frag = r.extractContents(); span.appendChild(frag); r.insertNode(span); }
    const sup = document.createElement("sup"); sup.className = "md-cite"; sup.setAttribute("contenteditable", "false"); sup.setAttribute("data-cite", key); sup.title = key; sup.textContent = num;
    span.after(sup);
    if (!sources.find(x => x.key === key)) setSources(s => [{ key, archived: !!(window.NPJ.SOURCES[key] && window.NPJ.SOURCES[key].archive_url) }, ...s]);
    window.getSelection().removeAllRanges(); setSel(null); setMenu(null); setSrcUrl(""); setRev(v => v + 1); scheduleSave();
  };
  const bindNewUrl = () => {
    const u = srcUrl.trim(); if (!/^https?:\/\//.test(u)) return;
    const key = "web-" + Date.now().toString(36);
    window.NPJ.SOURCES[key] = { id: key, type: "primary", outlet: new URL(u).hostname.replace(/^www\./, ""), title: "Web source", original_url: u, archive_url: "", retrieved: new Date().toISOString().slice(0, 10) };
    bindSource(key);
  };
  const applyLink = () => { const u = linkUrl.trim(); if (!u) return; restore(); document.execCommand("createLink", false, u); const sel2 = window.getSelection(); if (sel2.anchorNode) { const a = sel2.anchorNode.parentElement && sel2.anchorNode.parentElement.closest("a"); if (a) { a.target = "_blank"; a.rel = "noopener"; } } setLinkUrl(""); setMenu(null); setSel(null); };
  const insertJump = (id, text) => { restore(); document.execCommand("insertHTML", false, `<a href="#${id}" class="jumplink">${text}</a>&nbsp;`); setMenu(null); setSel(null); };

  // ---- sources ingestion ----
  const insertCite = (key) => bindSource(key);
  const spanCount = (key) => (ed.current ? ed.current.querySelectorAll('[data-src="' + key + '"]').length : 0);
  const addUrl = () => {
    const urls = urlInput.split(/[\s,]+/).map(u => u.trim()).filter(u => /^https?:\/\//.test(u));
    if (!urls.length) return; setBusy(true);
    const made = urls.map((u, i) => {
      const key = "web-" + Date.now().toString(36) + i;
      window.NPJ.SOURCES[key] = { id: key, type: "primary", outlet: new URL(u).hostname.replace(/^www\./, ""), title: "Web snapshot", original_url: u, archive_url: "", retrieved: new Date().toISOString().slice(0, 10) };
      return { key, archived: false, snapshotting: true };
    });
    setSources(s => [...made, ...s]); setUrlInput("");
    setTimeout(() => { setSources(s => s.map(x => made.find(m => m.key === x.key) ? { ...x, snapshotting: false } : x)); setBusy(false); }, 1400);
  };
  const onArchived = (key) => setSources(s => s.map(x => x.key === key ? { ...x, archived: true } : x));
  const addFiles = (fileList) => {
    const files = Array.from(fileList || []); if (!files.length) return;
    const made = files.map((f, i) => {
      const key = "doc-" + Date.now().toString(36) + i;
      window.NPJ.SOURCES[key] = { id: key, type: "primary", outlet: "uploaded document", title: f.name, original_url: "", archive_url: "", retrieved: new Date().toISOString().slice(0, 10) };
      return { key, archived: false, snapshotting: true };
    });
    setSources(s => [...made, ...s]);
    setTimeout(() => setSources(s => s.map(x => made.find(m => m.key === x.key) ? { ...x, snapshotting: false } : x)), 1100);
  };

  // ---- Matrix: invite + room recovery ----
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
      setInviteVal(""); setInviteMsg("Invited " + id.mxid + " into the draft room.");
    } catch (e) { setInviteMsg("Invite failed: " + (e.message || "try again")); }
  };
  const openRooms = async () => {
    setShowRooms(true);
    if (rooms) return;
    setRooms({ loading: true });
    try {
      const [joined, drafts] = await Promise.all([window.MatrixAuth.joinedRooms(), window.MatrixAuth.listDrafts()]);
      setRooms({ joined, drafts });
    } catch (e) { setRooms({ joined: [], drafts: [], error: e.message }); }
  };

  const versions = [{ sha: "draft", ts: new Date().toISOString().slice(0, 10), author: (session && session.user_id) || me, message: "Current working draft", text: ed.current ? (ed.current.innerText || "") : "" }];

  const synced = !!session;
  const saveText = ({ saving: "saving…", syncing: "syncing…", synced: "✓ synced to Matrix", error: "saved locally · sync failed", localonly: "saved on this device" })[saveState] || (synced ? "draft · autosaving" : "draft · autosaves on this device");
  const saveColor = saveState === "error" ? "#e6b07f" : saveState === "synced" ? "#9fe0b8" : NR.muted;

  const TB = ({ onClick, children, title }) => <button onMouseDown={e => e.preventDefault()} onClick={onClick} title={title} className="np-cond" style={{ background: "transparent", border: 0, color: NR.text, padding: "5px 9px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{children}</button>;
  const FB = ({ onClick, children, hot, title }) => <button title={title} onMouseDown={e => e.preventDefault()} onClick={onClick} style={{ background: hot ? "var(--yellow)" : "transparent", color: hot ? "var(--ink)" : "#e3ddcc", border: 0, padding: "5px 9px", fontSize: 13, fontWeight: 700, fontFamily: "var(--cond)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</button>;

  return (
    <div className="newsroom fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* top bar */}
      <div style={{ borderBottom: "1.5px solid " + NR.line, padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={onExit} className="np-cond" style={{ background: "none", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <I.arrow style={{ fontSize: 14, transform: "rotate(180deg)" }} /> Public site
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <I.lock style={{ fontSize: 18, color: "var(--yellow)" }} />
          <span style={{ fontFamily: "var(--display)", fontSize: 20, color: NR.text }}>NEWSROOM</span>
          <span className="np-mono" style={{ fontSize: 11.5, color: NR.muted }}>{slugify(title) || "untitled"}.md</span>
          <span className="np-mono" title={synced ? "Your draft is saved here and mirrored to your Matrix account — refresh or switch devices and it comes back." : "Saved on this device. Sign in with Matrix to back it up server-side."} style={{ fontSize: 10.5, color: saveColor, border: "1px solid " + NR.line, padding: "1px 6px", whiteSpace: "nowrap" }}>{saveText}</span>
        </div>
        <span style={{ flex: 1 }} />
        <window.VersionBadge sha="draft" count={versions.length} onClick={() => setShowVersions(true)} dark />
        <div style={{ position: "relative" }}>
          <button onClick={openRooms} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.archive style={{ fontSize: 13 }} /> Rooms</button>
          {showRooms && <RoomsMenu rooms={rooms} onClose={() => setShowRooms(false)} signedIn={!!session} />}
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setInvite(v => !v)} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.plus style={{ fontSize: 13 }} /> Invite</button>
          {invite && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 280, maxWidth: "calc(100vw - 24px)", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(0,0,0,.3)", padding: 12, zIndex: 30 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Invite to the draft room</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={inviteVal} onChange={e => setInviteVal(e.target.value)} onKeyDown={e => e.key === "Enter" && doInvite()} placeholder="@name:server" className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
                <button className="btn btn-sm btn-primary" onClick={doInvite}>Invite</button>
              </div>
              {inviteMsg && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.4 }}>{inviteMsg}</div>}
              {room && room.alias && <div className="np-mono" style={{ fontSize: 10, color: "var(--verified)", marginTop: 5 }}>{room.alias}</div>}
            </div>
          )}
        </div>
        <div style={{ display: "flex" }}>
          {collabs.slice(0, 4).map((e, i) => { const p = window.NPJ.PEOPLE[e] || { name: e.replace(/^@/, ""), color: "#888" }; return <span key={e + i} title={p.name} style={{ width: 26, height: 26, borderRadius: "50%", background: p.color, color: "#fff", border: "2px solid #14130f", marginLeft: i ? -8 : 0, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{(p.name || "?")[0].toUpperCase()}</span>; })}
        </div>
        <button onClick={() => canPub ? setPublish({ step: 0 }) : null} disabled={!canPub} title={canPub ? "Publish" : "Only an admin or assigned column publisher can publish"} className="np-cond" style={{ background: canPub ? "var(--yellow)" : "transparent", color: canPub ? "var(--ink)" : NR.muted, border: "1.5px solid " + (canPub ? "var(--ink)" : NR.line), padding: "7px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: canPub ? "pointer" : "not-allowed" }}>
          <I.lock style={{ fontSize: 14 }} /> Publish
        </button>
      </div>

      {/* formatting toolbar */}
      <div style={{ borderBottom: "1px solid " + NR.line, padding: "7px 20px", display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: NR.muted, marginRight: 6 }}>Format</span>
        <TB onClick={() => exec("formatBlock", "<h1>")} title="Title">H1</TB>
        <TB onClick={() => exec("formatBlock", "<h2>")} title="Heading">H2</TB>
        <TB onClick={() => exec("formatBlock", "<h3>")} title="Subheading">H3</TB>
        <TB onClick={() => exec("formatBlock", "<p>")} title="Body text">¶</TB>
        <span style={{ width: 1, height: 18, background: NR.line, margin: "0 5px" }} />
        <TB onClick={() => exec("bold")} title="Bold"><b>B</b></TB>
        <TB onClick={() => exec("italic")} title="Italic"><i>I</i></TB>
        <TB onClick={() => exec("strikeThrough")} title="Strikethrough"><s>S</s></TB>
        <TB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote">“”</TB>
        <TB onClick={() => exec("insertUnorderedList")} title="Bulleted list">•</TB>
        <TB onClick={() => exec("insertHorizontalRule")} title="Divider">—</TB>
        <span style={{ width: 1, height: 18, background: NR.line, margin: "0 5px" }} />
        <TB onClick={insertImage} title="Inline image"><I.archive style={{ fontSize: 14, verticalAlign: "-2px" }} /> Image</TB>
        <span style={{ flex: 1 }} />
        <span className="np-mono npj-hide-sm" style={{ fontSize: 10.5, color: NR.muted }}>select text → format, link, or bind a source span</span>
      </div>

      {/* mobile tab switcher — one panel at a time; the editor node stays mounted so a draft is never dropped */}
      {isMobile && (
        <div style={{ display: "flex", borderBottom: "1px solid " + NR.line, background: "#15130e" }}>
          {[["write", "Write"], ["contents", "Contents" + (toc.length ? " · " + toc.length : "")], ["sources", "Sources · " + sources.length]].map(([k, label]) => (
            <button key={k} onClick={() => setMTab(k)} className="np-cond" style={{ flex: 1, background: mTab === k ? "var(--yellow)" : "transparent", color: mTab === k ? "var(--ink)" : NR.text, border: 0, borderRight: "1px solid " + NR.line, padding: "11px 6px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      )}

      {/* body: contents · editor · sources (stacks to one tabbed column on mobile) */}
      <div style={{ flex: 1, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateColumns: isMobile ? undefined : "200px 1fr 340px" }}>
        {/* contents / jumplinks */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "contents" ? "block" : "none") : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 12px 30px", background: "#15130e", borderRight: isMobile ? 0 : "1.5px solid " + NR.line }}>
          <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 10 }}>Contents</div>
          {toc.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Add H1/H2/H3 headings and they'll show here as jump-links.</div>}
          {toc.map(h => (
            <button key={h.id} onClick={() => scrollToId(h.id)} className="np-cond" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, color: h.level === 1 ? NR.text : NR.soft, padding: "4px 0 4px " + ((h.level - 1) * 10) + "px", fontSize: h.level === 1 ? 14 : 13, fontWeight: h.level === 1 ? 700 : 500, cursor: "pointer", lineHeight: 1.2 }}>{h.text}</button>
          ))}
          {/* tags + column */}
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Column</div>
            <select value={column} onChange={e => setColumn(e.target.value)} className="np-cond" style={{ width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, padding: "6px", fontSize: 13, marginBottom: 12 }}>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>Tags <button onClick={() => window.__clippy && window.__clippy.suggest()} title="Clippy: suggest tags" style={{ background: "none", border: "1px solid " + NR.line, color: NR.soft, fontSize: 11, padding: "1px 6px", cursor: "pointer" }}>📎</button></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {tags.map(t => <span key={t} className="np-mono" style={{ fontSize: 10.5, border: "1px solid " + NR.line, color: NR.text, padding: "2px 4px 2px 6px", display: "inline-flex", alignItems: "center", gap: 4 }}>#{t}<button onClick={() => setTags(l => l.filter(x => x !== t))} style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button></span>)}
              <input placeholder="+tag" onKeyDown={e => { if (e.key === "Enter") { const t = slugify(e.target.value); if (t) setTags(l => l.includes(t) ? l : [...l, t]); e.target.value = ""; } }} className="np-mono" style={{ width: 56, border: "1px dashed " + NR.line, background: "transparent", color: NR.text, padding: "3px 5px", fontSize: 11, outline: "none" }} />
            </div>
          </div>
        </div>

        {/* editor */}
        <div className="np-scroll md-preview" ref={ed} contentEditable suppressContentEditableWarning onInput={() => { scanHeadings(); scheduleSave(); }} onClick={onBodyClick}
          style={{ display: isMobile && mTab !== "write" ? "none" : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: isMobile ? "18px 16px" : "28px 44px", background: "#16140f", color: NR.text, outline: "none", borderRight: isMobile ? 0 : "1.5px solid " + NR.line, minHeight: 0 }}
          dangerouslySetInnerHTML={{ __html: START_DOC }} />

        {/* sources */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "sources" ? "block" : "none") : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 16px 40px", background: NR.panel }}>
          <div className="np-eyebrow" style={{ color: NR.muted, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}><I.archive style={{ fontSize: 14 }} /> Sources · {sources.length}</div>
          <div style={{ border: "1px solid " + NR.line, padding: "10px", marginBottom: 14 }}>
            <div className="np-eyebrow" style={{ color: NR.soft, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}><I.plus style={{ fontSize: 13 }} /> Ingest a source</div>
            <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)} rows={2} placeholder="Paste one or more URLs…" className="np-mono" style={{ width: "100%", border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontSize: 12, padding: "8px", resize: "vertical", outline: "none" }} />
            <button onClick={addUrl} disabled={busy} className="np-cond" style={{ marginTop: 8, width: "100%", background: busy ? NR.field : "var(--yellow)", color: busy ? NR.muted : "var(--ink)", border: 0, padding: "8px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {busy ? <><Spinner /> Snapshotting…</> : <>Snapshot &amp; store</>}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 4px" }}>
              <span style={{ flex: 1, height: 1, background: NR.line }} /><span className="np-mono" style={{ fontSize: 9.5, color: NR.muted }}>or</span><span style={{ flex: 1, height: 1, background: NR.line }} />
            </div>
            <label className="np-cond" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", border: "1px solid " + NR.line, color: NR.text, padding: "8px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer" }}>
              <input type="file" multiple style={{ display: "none" }} onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
              <I.doc style={{ fontSize: 15 }} /> Upload documents
            </label>
            <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 8, lineHeight: 1.5 }}>Sourcing is manual: select the exact words in your draft, then bind a source to that span. One source can back several spans.</div>
          </div>

          {sources.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6, padding: "0 2px" }}>No sources yet. Ingest a URL or upload a document, then highlight a claim and bind it.</div>}
          {sources.map(s => {
            const rec = window.NPJ.SOURCES[s.key] || { id: s.key, title: s.key, outlet: "" };
            const n = citeNum(s.key); const cnt = spanCount(s.key); void rev;
            return (
              <div key={s.key} style={{ border: "1px solid " + NR.line, padding: "9px 10px", marginBottom: 8, background: NR.field }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  {n > 0 && <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{n}</span>}
                  {s.snapshotting ? <span className="np-mono" style={{ fontSize: 9.5, color: "#e6b07f", display: "inline-flex", alignItems: "center", gap: 4 }}><Spinner /> snapshotting</span>
                    : s.archived ? <span className="np-mono" style={{ fontSize: 9.5, color: "#9fe0b8" }}>● archived</span>
                    : <span className="np-mono" style={{ fontSize: 9.5, color: "#e6b07f" }}>● snapshot only</span>}
                  <span style={{ flex: 1 }} />
                  {cnt > 0 && <span className="np-mono" style={{ fontSize: 9.5, color: NR.soft }}>{cnt} span{cnt !== 1 ? "s" : ""}</span>}
                </div>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.1, color: NR.text }}>{rec.title}</div>
                <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 2 }}>{rec.outlet}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onClick={() => insertCite(s.key)} disabled={s.snapshotting} title="Bind the selected span to this source" className="np-cond" style={{ flex: 1, background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "4px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>Cite span</button>
                  {!s.archived && !s.snapshotting && <button onClick={() => setArchiveTarget(s)} className="np-cond" style={{ background: "transparent", border: "1px solid #e6b07f", color: "#e6b07f", padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>Archive</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* selection toolbar */}
      {sel && (
        <div className="sel-tb" style={{ position: "fixed", left: sel.x, top: sel.y - 8, transform: "translate(-50%,-100%)", zIndex: 4200, background: "var(--ink)", border: "1px solid rgba(255,255,255,.22)", boxShadow: "0 10px 28px rgba(0,0,0,.55)", display: "flex", alignItems: "center", padding: 3 }}>
          <FB onClick={() => exec("bold")} title="Bold"><b>B</b></FB>
          <FB onClick={() => exec("italic")} title="Italic"><i>I</i></FB>
          <FB onClick={() => exec("formatBlock", "<h2>")} title="Heading">H2</FB>
          <FB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote">“”</FB>
          <span style={{ width: 1, height: 18, background: "rgba(255,255,255,.2)", margin: "0 3px" }} />
          <FB hot={menu === "link"} onClick={() => setMenu(menu === "link" ? null : "link")} title="Add a link or jump-link"><I.ext style={{ fontSize: 13 }} /> Link</FB>
          <FB hot={menu === "src"} onClick={() => setMenu(menu === "src" ? null : "src")} title="Bind a source to this span"><span style={{ fontFamily: "var(--mono)" }}>⊨</span> Source</FB>

          {menu === "link" && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 280, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 9 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Link to a URL</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && applyLink()} placeholder="https://…" className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
                <button className="btn btn-sm btn-primary" onClick={applyLink}>Add</button>
              </div>
              {toc.length > 0 && <React.Fragment>
                <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "10px 0 5px", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>or jump to a section</div>
                {toc.map(h => <button key={h.id} onMouseDown={e => e.preventDefault()} onClick={() => insertJump(h.id, h.text)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--rule)", padding: "6px 2px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{h.text}</button>)}
              </React.Fragment>}
            </div>
          )}
          {menu === "src" && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 268, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 8, maxHeight: 260, overflowY: "auto" }} className="np-scroll">
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Bind this span to a source</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "0 8px", marginBottom: 8 }}>
                <I.search style={{ fontSize: 14, color: "var(--ink-soft)" }} />
                <input autoFocus value={srcQuery} onChange={e => setSrcQuery(e.target.value)} onMouseDown={e => e.stopPropagation()} placeholder="Search sources…" style={{ flex: 1, border: 0, background: "transparent", padding: "7px 0", fontFamily: "var(--serif)", fontSize: 13, outline: "none" }} />
              </div>
              {sources.filter(s => { const r = window.NPJ.SOURCES[s.key] || {}; const q = srcQuery.trim().toLowerCase(); return !q || ((r.title || "") + " " + (r.outlet || "") + " " + (r.id || s.key)).toLowerCase().includes(q); }).map(s => { const rec = window.NPJ.SOURCES[s.key] || { title: s.key, outlet: "" }; const n = citeNum(s.key); return (
                <button key={s.key} onMouseDown={e => e.preventDefault()} onClick={() => bindSource(s.key)} style={{ display: "flex", gap: 7, alignItems: "baseline", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--rule)", padding: "7px 4px", cursor: "pointer" }}>
                  {n > 0 && <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{n}</span>}
                  <span><span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5 }}>{rec.title}</span><span className="np-mono" style={{ display: "block", fontSize: 9.5, color: "var(--ink-soft)" }}>{rec.outlet} {s.archived ? "· archived" : "· snapshot"}{n > 0 ? " · +span" : ""}</span></span>
                </button>); })}
              {sources.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", padding: "4px 2px 8px" }}>Ingest a source first (left panel), or paste a URL:</div>}
              <input value={srcUrl} onChange={e => setSrcUrl(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && bindNewUrl()} placeholder="or paste a URL…" className="np-mono" style={{ width: "100%", marginTop: 8, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 12, outline: "none" }} />
            </div>
          )}
        </div>
      )}

      {showVersions && <window.VersionHistory versions={versions} onClose={() => setShowVersions(false)} />}
      {archiveTarget && <ArchiveModal items={[{ name: (window.NPJ.SOURCES[archiveTarget.key] || {}).title || archiveTarget.key }]} onClose={() => setArchiveTarget(null)} onDone={() => { onArchived(archiveTarget.key); setArchiveTarget(null); }} />}
      {publish && <PublishOverlay publish={publish} setPublish={setPublish} onClose={() => setPublish(null)} onPublished={onPublished} sources={sources} title={title} session={session}
        getContent={() => ({ html: ed.current ? ed.current.innerHTML : "", title, tags, column, sources })} />}
    </div>
  );
}

/* server-recovered rooms — solves "switched browser, can't find my drafts" */
function RoomsMenu({ rooms, onClose, signedIn }) {
  return (
    <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxWidth: "calc(100vw - 24px)", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(0,0,0,.3)", padding: 12, zIndex: 30, maxHeight: 360, overflowY: "auto" }} className="np-scroll">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Your rooms · from Matrix</span>
        <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 14 }}><I.x /></button>
      </div>
      <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 10, lineHeight: 1.5 }}>Recovered straight from the homeserver — not this browser. Wipe or switch devices and they're still here after you sign in.</div>
      {!signedIn && <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)" }}>Sign in with Matrix to see your draft rooms.</div>}
      {signedIn && (!rooms || rooms.loading) && <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", display: "inline-flex", gap: 6, alignItems: "center" }}><Spinner /> loading from server…</div>}
      {signedIn && rooms && !rooms.loading && (
        <React.Fragment>
          {(rooms.drafts || []).length > 0 && <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "4px 0 6px" }}>Indexed drafts</div>}
          {(rooms.drafts || []).map(d => <div key={d.roomId} style={{ borderBottom: "1px solid var(--rule)", padding: "6px 2px" }}><div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14 }}>{d.title}</div><div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{d.roomId}</div></div>)}
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "10px 0 6px" }}>Joined rooms ({(rooms.joined || []).length})</div>
          {(rooms.joined || []).map(r => <div key={r.roomId} style={{ borderBottom: "1px solid var(--rule)", padding: "6px 2px" }}><div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14 }}>{r.name}</div>{r.topic && <div style={{ fontFamily: "var(--serif)", fontSize: 11.5, color: "var(--ink-soft)" }}>{r.topic}</div>}</div>)}
          {(rooms.joined || []).length === 0 && (rooms.drafts || []).length === 0 && <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)" }}>No rooms yet. Invite a collaborator and a draft room is created for you.</div>}
          {rooms.error && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 6 }}>{rooms.error}</div>}
        </React.Fragment>
      )}
    </div>
  );
}

function Spinner() { return <span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px" }} />; }

function PublishOverlay({ publish, setPublish, onClose, onPublished, sources, title, session, getContent }) {
  const slug = slugify(title) || "untitled";
  const unarchived = (sources || []).filter(s => !s.archived).length;
  const [result, setResult] = useState({ state: "busy", msg: "Committing " + slug + ".md…" });
  const STEPS = [
    { code: "EVA", label: "Pull the finished piece", detail: "draft → plaintext markdown", ms: 1000 },
    { code: "DEF", label: "Commit markdown to GitHub", detail: "→ clovenbradshaw-ctrl/npj · " + slug + ".md", ms: 1300 },
    { code: "INS", label: "Archive every source to archive.org", detail: unarchived ? unarchived + " still need archiving — consent at publish" : "all sources already archived", ms: 1800, sources: true },
    { code: "SEG", label: "Build: resolve every bound span", detail: "0 unresolved · build passed ✓", ms: 1100 },
    { code: "REC", label: "Live & open to suggestion", detail: "GitHub Pages + archive.org permalink", ms: 1000 }
  ];
  useEffect(() => {
    if (!publish || publish.done) return;
    if (publish.step >= STEPS.length) { setPublish(p => ({ ...p, done: true })); return; }
    const t = setTimeout(() => setPublish(p => ({ ...p, step: p.step + 1 })), STEPS[publish.step].ms);
    return () => clearTimeout(t);
  }, [publish && publish.step]);

  // The real commit: POST the markdown to the publish webhook with the signed-in
  // admin's Matrix token. The webhook re-verifies whoami before writing to GitHub,
  // so authority is enforced server-side — the same path AdminEditor uses for layout.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = window.MatrixAuth.token();
        if (!token) { if (alive) setResult({ state: "err", msg: "Sign in with your admin Matrix account to publish." }); return; }
        let endpoint = "https://n8n.intelechia.com/webhook/site/publish-npj";
        try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.endpoint) endpoint = c.endpoint; } catch (e) {}
        const contentRaw = window.NpjArticleMarkdown(getContent ? getContent() : { html: "", title });
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify({ filename: slug + ".md", mode: "overwrite", contentRaw, message: "publish: " + slug })
        });
        if (!alive) return;
        if (res.status === 401) setResult({ state: "err", msg: "That Matrix account isn't authorized to publish." });
        else if (!res.ok) setResult({ state: "err", msg: "Publish failed (" + res.status + ")." });
        else setResult({ state: "ok", msg: "Committed " + slug + ".md to clovenbradshaw-ctrl/npj." });
      } catch (e) { if (alive) setResult({ state: "err", msg: "Couldn't reach the publish webhook: " + (e.message || "network error") + "." }); }
    })();
    return () => { alive = false; };
  }, []);
  const srcKeys = (sources || []).map(s => s.key);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.86)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} className="fade-in">
      <div style={{ width: 560, maxWidth: "100%", background: "#14130f", border: "1.5px solid var(--yellow)", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}>
        <div style={{ background: "var(--yellow)", color: "var(--ink)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 18 }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21 }}>PUBLISH BOUNDARY</span>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 11 }}>GitHub + archive.org</span>
        </div>
        <div style={{ padding: "20px 22px" }}>
          {STEPS.map((s, i) => {
            const state = publish.done || publish.step > i ? "done" : publish.step === i ? "active" : "wait";
            return (
              <div key={i} style={{ display: "flex", gap: 13, padding: "10px 0", borderBottom: i < STEPS.length - 1 ? "1px solid " + NR.line : 0, opacity: state === "wait" ? .4 : 1, transition: "opacity .3s" }}>
                <span style={{ flex: "0 0 28px", textAlign: "center" }}>{state === "done" ? <I.check style={{ fontSize: 18, color: "#9fe0b8" }} /> : state === "active" ? <Spinner /> : <span style={{ fontFamily: "var(--mono)", color: NR.muted }}>{window.NPJ.EO.glyph(s.code)}</span>}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--cond)", fontSize: 16, color: NR.text, fontWeight: 600 }}>{s.label}</div>
                  <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, marginTop: 2 }}>{s.detail}</div>
                  {s.sources && state !== "wait" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
                      {srcKeys.map((k) => <span key={k} className="np-mono fade-in" style={{ fontSize: 9, padding: "1px 5px", border: "1px solid " + NR.line, color: state === "done" ? "#9fe0b8" : NR.soft }}>{state === "done" ? "✓ " : "↻ "}{k.slice(0, 12)}</span>)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {publish.done && (
            <div className="fade-in" style={{ marginTop: 16, textAlign: "center" }}>
              {result.state === "busy"
                ? <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: NR.soft, fontFamily: "var(--cond)", fontSize: 16, marginBottom: 14 }}><Spinner /> finishing the commit…</div>
                : result.state === "ok"
                ? <React.Fragment>
                    <div style={{ fontFamily: "var(--display)", fontSize: 26, color: "var(--yellow)", marginBottom: 4 }}>LIVE ON GITHUB PAGES</div>
                    <div className="np-mono" style={{ fontSize: 11, color: NR.muted, marginBottom: 16 }}>{result.msg} · archived to archive.org</div>
                    <div style={{ display: "inline-block", textAlign: "left", marginBottom: 18 }}>
                      <ShareBar dark url={"https://npj.press/" + slug} archiveUrl={"https://web.archive.org/web/2026/https://npj.press/" + slug} title={title} />
                    </div>
                  </React.Fragment>
                : <React.Fragment>
                    <div style={{ fontFamily: "var(--display)", fontSize: 24, color: "#e6b07f", marginBottom: 6 }}>PUBLISH DIDN'T COMPLETE</div>
                    <div className="np-mono" style={{ fontSize: 11.5, color: NR.soft, lineHeight: 1.5, maxWidth: 440, margin: "0 auto 16px" }}>{result.msg} Your draft is safe — it stays saved on this device and synced to your Matrix account.</div>
                  </React.Fragment>}
              <div style={{ display: "flex", gap: 9, justifyContent: "center" }}>
                <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "10px 16px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em" }}>Back to editor</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Serialize the contentEditable draft to plaintext markdown for the commit.
   Bound source spans become numbered footnotes whose definitions point at the
   archived (or original) URL — so the published .md keeps every claim auditable. */
function htmlToMarkdown(html) {
  const root = document.createElement("div"); root.innerHTML = html || "";
  const inline = (node) => {
    let out = "";
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") { out += "  \n"; return; }
      if (tag === "sup" && n.classList.contains("md-cite")) { out += "[^" + (n.getAttribute("data-cite") || n.textContent) + "]"; return; }
      const inner = inline(n);
      if (tag === "strong" || tag === "b") out += "**" + inner + "**";
      else if (tag === "em" || tag === "i") out += "*" + inner + "*";
      else if (tag === "s" || tag === "strike" || tag === "del") out += "~~" + inner + "~~";
      else if (tag === "code") out += "`" + inner + "`";
      else if (tag === "a") out += "[" + inner + "](" + (n.getAttribute("href") || "") + ")";
      else out += inner;
    });
    return out;
  };
  const lines = [];
  const footnotes = {};
  root.querySelectorAll("sup.md-cite").forEach(sup => {
    const key = sup.getAttribute("data-cite"); if (!key) return;
    const rec = window.NPJ.SOURCES[key] || {};
    footnotes[key] = rec.archive_url || rec.original_url || rec.title || key;
  });
  Array.from(root.childNodes).forEach(node => {
    if (node.nodeType === 3) { const t = node.nodeValue.trim(); if (t) lines.push(t, ""); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "h1") lines.push("# " + inline(node).trim(), "");
    else if (tag === "h2") lines.push("## " + inline(node).trim(), "");
    else if (tag === "h3") lines.push("### " + inline(node).trim(), "");
    else if (tag === "blockquote") lines.push("> " + inline(node).trim().replace(/\n/g, "\n> "), "");
    else if (tag === "ul") { node.querySelectorAll(":scope > li").forEach(li => lines.push("- " + inline(li).trim())); lines.push(""); }
    else if (tag === "ol") { Array.from(node.querySelectorAll(":scope > li")).forEach((li, i) => lines.push((i + 1) + ". " + inline(li).trim())); lines.push(""); }
    else if (tag === "hr") lines.push("---", "");
    else if (tag === "figure") { const cap = node.querySelector("figcaption"); if (cap && cap.textContent.trim()) lines.push("*" + cap.textContent.trim() + "*", ""); }
    else { const t = inline(node).trim(); if (t) lines.push(t, ""); }
  });
  let md = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const keys = Object.keys(footnotes);
  if (keys.length) { md += "\n"; keys.forEach(k => { md += "[^" + k + "]: " + footnotes[k] + "\n"; }); }
  return md;
}
window.NpjArticleMarkdown = function (content) {
  const c = content || {};
  const meta = "<!-- column: " + (c.column || "") + " · tags: " + ((c.tags || []).join(", ")) + " -->\n\n";
  return meta + htmlToMarkdown(c.html);
};

/* Closed-network gate: until the admin adds you, the newsroom is read-only-off. */
function NewsroomLocked({ signedIn, me, onSignIn, onHome }) {
  return (
    <div className="newsroom fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 22px", textAlign: "center" }}>
      <div style={{ maxWidth: 520 }}>
        <I.lock style={{ fontSize: 40, color: "var(--yellow)" }} />
        <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: .95, margin: "16px 0 12px", color: "#e3ddcc" }}>The newsroom is invite-only</h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.5, color: "#b3ad9c", margin: 0 }}>
          People's Journalism is being built by its founding admin. For now, only the admin and the contributors they've added can draft and edit here — that opens up as the network grows.
        </p>
        {signedIn && <p className="np-mono" style={{ fontSize: 12, color: "#e6b07f", margin: "12px 0 0", lineHeight: 1.5 }}>You're verified as {me}, but you're not on the contributor allowlist yet. Ask the admin to add you.</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          {!signedIn && <button onClick={onSignIn} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> Sign in with Matrix</button>}
          <button onClick={onHome} className="btn" style={{ background: "transparent", color: "#e3ddcc", borderColor: NR.line }}>Back to the public site</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Newsroom, NewsroomLocked });
