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
        const name = (m.guest && m.guestName) ? m.guestName : m.mxid.replace(/^@/, "").split(":")[0];
        const invited = m.membership === "invite";
        const tag = (m.guest ? " · guest" : "") + (invited ? " · invited" : "");
        return (
          <span key={m.mxid} title={m.mxid + (m.guest ? " — guest" : "") + (invited ? " · invited, hasn't joined yet" : m.mxid === me ? " — you" : " — member")}
            className="np-mono" style={{ fontSize: 9.5, padding: "1px 7px", whiteSpace: "nowrap",
              border: invited ? "1px dashed var(--ink-soft)" : "1px solid var(--ink)",
              background: invited ? "transparent" : (m.mxid === me ? "var(--yellow)" : "var(--card)"),
              color: invited ? "var(--ink-soft)" : "var(--ink)" }}>
            {invited ? "◌ " : "● "}{name}{tag}
          </span>
        );
      })}
    </span>
  );
}

/* Permission control: invite a collaborator to a project by Matrix ID. Anyone
   invited gets every article AND every source in the project — that's the whole
   point of bucketing by project, so the copy says it out loud. The homeserver
   enforces who may invite (power levels); we just surface what it returns. */
function InviteControl({ roomId, onInvited }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const send = async () => {
    const raw = val.trim();
    if (!raw || busy) return;
    setBusy(true); setMsg(null);
    try {
      const out = await window.MatrixAuth.invite(roomId, raw);
      setMsg({ ok: true, text: "Invited " + out.invited + " — they'll reach every article and source here once they accept." });
      setVal(""); onInvited && onInvited(out.invited);
    } catch (e) {
      const text = (e && (e.errcode === "M_FORBIDDEN")) ? "You don't have permission to invite to this project."
        : (e && e.code === "badmxid") ? "Use a full Matrix ID — @name:server."
        : (e && e.errcode === "M_USER_IN_USE") ? "They're already in this project."
        : (e && e.message) || "Invite failed.";
      setMsg({ ok: false, text });
    }
    setBusy(false);
  };
  if (!open) return (
    <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
      <I.plus style={{ fontSize: 11 }} /> Invite
    </button>
  );
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
        <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); if (e.key === "Escape") { setOpen(false); setMsg(null); } }}
          placeholder="@name:server" className="np-mono" style={{ width: 168, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "5px 7px", fontSize: 11.5, outline: "none" }} />
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={send} style={{ opacity: busy ? .6 : 1 }}>{busy ? "…" : "Send"}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); setMsg(null); }}><I.x style={{ fontSize: 11 }} /></button>
      </span>
      {msg && <span className="np-mono" style={{ fontSize: 10, lineHeight: 1.4, color: msg.ok ? "var(--verified)" : "var(--reject)", maxWidth: 280 }}>{msg.text}</span>}
    </span>
  );
}

/* Start a project directly (not just as a side effect of a first invite), so the
   bucket exists before there's anything in it. Creates the shared Matrix room. */
function NewProjectControl({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const create = async () => {
    const name = val.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    try {
      const made = await window.MatrixAuth.createDraftRoom(name);
      onCreated && onCreated({ roomId: made.roomId, title: name });
      setVal(""); setOpen(false);
    } catch (e) { setErr((e && e.message) || "Couldn't create the project."); }
    setBusy(false);
  };
  if (!open) return (
    <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <I.plus style={{ fontSize: 12 }} /> New project
    </button>
  );
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") setOpen(false); }}
        placeholder="Project name" style={{ width: 180, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "6px 8px", fontFamily: "var(--serif)", fontSize: 13, outline: "none" }} />
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={create} style={{ opacity: busy ? .6 : 1 }}>{busy ? "…" : "Create"}</button>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}><I.x style={{ fontSize: 11 }} /></button>
      {err && <span className="np-mono" style={{ fontSize: 10, color: "var(--reject)" }}>{err}</span>}
    </span>
  );
}

/* A project's shared SOURCE shelf — every source bound by any article in the
   project, deduped by content SIGNATURE (the same upload, or the same document
   re-uploaded, collapses to one row) and BACKTRACKED to the articles that cite
   it. A row that also lives in other projects flags the synthetic cross-project
   link. NpjSources.draftGroups did the grouping over every draft; we filter to
   the ones this project touches so the cross-project spans survive. */
function ProjectSources({ groups, roomId, titleOf, onOpen, onOpenArticle, onOpenFile }) {
  const SV = window.NpjSourceView;
  const isFile = (rec) => !!SV && (/^doc-/.test((rec && rec.id) || "") || SV.isViewable(rec) || (SV.hasFile(rec) && SV.kindOf(rec) !== "unknown"));
  const mine = (groups || []).filter(g => g.carriers.some(c => c.project && c.project.roomId === roomId));
  if (!mine.length) return (
    <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>No sources yet — bind one inside an article and it's shared with every article in this project.</div>
  );
  const openCarrier = (cr) => {
    if (cr.kind === "published" && cr.slug && onOpenArticle) onOpenArticle(cr.slug);
    else if (cr.kind === "draft") onOpen(String(cr.id).replace(/^draft:/, ""));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {mine.map(g => {
        const here = g.carriers.filter(c => c.project && c.project.roomId === roomId);
        const otherProjects = (g.projects || []).filter(p => p.roomId !== roomId);
        const k = g.kind || {};
        const url = g.rec && (g.rec.archive_url || g.rec.original_url);
        return (
          <div key={g.signature} style={{ border: "1px solid var(--rule)", background: "var(--card)", padding: "8px 10px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <I.source style={{ fontSize: 13, color: "var(--data)", flex: "0 0 auto" }} />
              <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.1 }}>{g.title}</span>
              <span className="np-mono" style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".05em", border: "1px solid var(--rule)", padding: "0 5px", color: k.archived ? "var(--verified)" : "var(--ink-soft)" }}>{k.archived ? "archived" : k.label}</span>
              {g.duplicated && <span className="np-mono" title={"Identical content uploaded " + g.uploads + " times — linked, not duplicated"} style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".05em", border: "1px dashed var(--review)", color: "var(--review)", padding: "0 5px" }}>×{g.uploads} linked</span>}
              <span style={{ flex: 1 }} />
              {isFile(g.rec) && onOpenFile && <button onClick={() => onOpenFile(g.rec.id || (g.keys && g.keys[0]) || g.signature)} title="Open and read this file" className="np-mono" style={{ fontSize: 10, color: "var(--data)", background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "inherit" }}><I.eye style={{ fontSize: 12 }} /> view</button>}
              {url && <a href={url} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 10, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2 }}>open ↗</a>}
            </div>
            <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 5, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "var(--ink-soft)" }}>cited by</span>
              {here.map(c => (
                <button key={c.id} onClick={() => openCarrier(c)} title="Open the article that cites this source" style={{ cursor: "pointer", border: "1px solid var(--rule)", background: "var(--paper-2)", padding: "1px 6px", fontSize: 9.5, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <I.doc style={{ fontSize: 10 }} /> {c.title}
                </button>
              ))}
            </div>
            {otherProjects.length > 0 && (
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--review)", marginTop: 4, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <I.link style={{ fontSize: 10 }} /> also used in {otherProjects.map(p => <span key={p.roomId} style={{ border: "1px solid var(--review)", padding: "0 5px" }}>{titleOf(p.roomId) || p.title || "another project"}</span>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---- self-service contributor profile (the byline) ----
   Any signed-in contributor sets their public display name + a ≤250-char
   "About me". The name defaults from their Matrix account. It saves durably to
   their Matrix account (recovers after a wipe) and shows in their byline live.
   An admin's save also commits it to the PUBLIC layout.json (the world-readable
   store); a non-admin's save is durable on their account and goes public when an
   admin next publishes the layout. */

/* The "About me" editor — a small rich field. Links show INLINE as embedded,
   non-editable chips (label shown, URL on hover and stored, never typed); the
   value we keep is the SAME [label](url) markdown the public renderer already
   understands. The DOM is seeded imperatively and only re-seeded on EXTERNAL
   value changes (profile load / "pull"), never on the user's own keystrokes, so
   the caret never jumps. The popover drives it through apiRef. */
function BioEditor({ value, onChange, apiRef, placeholder, maxRaw }) {
  const ref = useRef(null);
  const mine = useRef(null);     // the last markdown WE emitted — to skip self re-seeds
  const range = useRef(null);    // last selection made inside the editor

  const buildChip = (href, label) => {
    const a = document.createElement("a");
    a.href = href; a.setAttribute("data-href", href); a.title = href;
    a.setAttribute("contenteditable", "false"); a.textContent = label;
    a.style.color = "var(--ink)"; a.style.textDecorationLine = "underline";
    a.style.textDecorationColor = "var(--ink-soft)"; a.style.textUnderlineOffset = "2px"; a.style.cursor = "text";
    return a;
  };
  const seed = (md) => {
    const el = ref.current; if (!el) return;
    el.textContent = "";
    const toks = (window.NpjProfiles && window.NpjProfiles.linkTokens) ? window.NpjProfiles.linkTokens(md) : [{ type: "text", text: String(md || "") }];
    toks.forEach(t => el.appendChild(t.type === "link" ? buildChip(t.href, t.label) : document.createTextNode(t.text)));
  };
  const serialize = () => {
    const el = ref.current; if (!el) return "";
    const mk = (window.NpjProfiles && window.NpjProfiles.linkMarkdown) || ((l, u) => "[" + l + "](" + u + ")");
    let out = "";
    (function walk(node) {
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.nodeType === 1) {
          if (n.tagName === "A" && n.getAttribute("data-href")) out += mk(n.textContent || "", n.getAttribute("data-href"));
          else { if (/^(DIV|P|BR)$/.test(n.tagName)) out += " "; walk(n); }
        }
      });
    })(el);
    return out.replace(/\xa0/g, " ").replace(/[ \t]+/g, " ").replace(/^ | $/g, "");
  };
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current && ref.current.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const emit = () => { saveRange(); const md = serialize(); mine.current = md; onChange(md.slice(0, maxRaw || 1500)); };

  useEffect(() => { if (value !== mine.current) seed(value || ""); }, [value]);

  if (apiRef) apiRef.current = {
    // the words the user has highlighted inside the editor (to prefill the label)
    selectionText: () => (range.current && !range.current.collapsed && ref.current && ref.current.contains(range.current.commonAncestorContainer)) ? range.current.toString() : "",
    insertLink: (href, label) => {
      const el = ref.current; if (!el) return;
      el.focus();
      let r = range.current;
      if (!r || !el.contains(r.commonAncestorContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
      r.deleteContents();
      const chip = buildChip(href, label);
      r.insertNode(chip);
      const after = document.createRange(); after.setStartAfter(chip); after.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(after);
      range.current = after.cloneRange();
      emit();
    }
  };

  const onPaste = (e) => {
    e.preventDefault();
    const t = ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\s+/g, " ");
    document.execCommand("insertText", false, t);
  };
  return (
    <div style={{ position: "relative" }}>
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={emit} onKeyUp={saveRange} onMouseUp={saveRange}
        onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} onPaste={onPaste}
        style={{ width: "100%", boxSizing: "border-box", minHeight: 64, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "8px 10px", fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, outline: "none", whiteSpace: "pre-wrap", wordBreak: "break-word" }} />
      {!value && <div aria-hidden="true" style={{ position: "absolute", top: 9, left: 11, right: 11, color: "var(--ink-soft)", fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, pointerEvents: "none", opacity: .75 }}>{placeholder}</div>}
    </div>
  );
}

function ProfileCard({ session, me }) {
  const ctx = React.useContext(window.LayoutCtx);
  const { layout, setLayout, isAdmin } = ctx;
  const BIO_MAX = (window.NpjProfiles && window.NpjProfiles.BIO_MAX) || 250;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [msg, setMsg] = useState(null);
  const bioApi = useRef(null);                          // imperative handle into the BioEditor
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkErr, setLinkErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!window.NpjProfiles) { setLoaded(true); return; }
      const p = await window.NpjProfiles.loadMine(session, layout);
      if (!alive) return;
      setName(p.name || ""); setBio(p.bio || ""); setLoaded(true);
    })();
    return () => { alive = false; };
  }, [me]);

  const pullName = async () => {
    if (!window.NpjProfiles) return;
    setPulling(true);
    const dn = await window.NpjProfiles.accountDisplayName(session);
    setPulling(false);
    if (dn) { setName(dn); setMsg({ ok: true, text: "Pulled your display name from your Matrix account." }); }
    else setMsg({ ok: false, text: "Your Matrix account has no display name set — type one here." });
  };

  const save = async () => {
    if (!window.NpjProfiles) return;
    setBusy(true); setMsg(null);
    const prof = { name: name.trim(), bio: bio.trim() };
    const r = await window.NpjProfiles.saveMine(session, prof);
    if (!r.ok) { setBusy(false); setMsg({ ok: false, text: r.error || "Couldn't save your profile." }); return; }
    // reflect into the layout so the byline shows it live in this session
    const nextLayout = window.NpjProfiles.intoLayout(layout, me, r.profile);
    setLayout(nextLayout);
    // an admin can commit it to the public store right now
    if (isAdmin && window.NpjLayout && window.MatrixAuth) {
      const token = window.MatrixAuth.token();
      try {
        await window.NpjLayout.publishLayout({
          matrixToken: token, layout: nextLayout, author: me, message: "update contributor profile: " + me,
          onRetry: ({ attempt }) => setMsg({ ok: true, text: "Saved to your account. The publishing service is busy — retrying the public push (" + attempt + ")…" })
        });
        setMsg({ ok: true, text: "Saved and published to the site — your byline is live." });
      } catch (e) {
        let text;
        if (e && e.transient) {
          // A genuine gateway/network blip — the request never got a verdict.
          text = "Saved to your account, but the public push couldn't reach the site (" + (e.status || "network error") + ") after several tries. Your byline is safe here — press Save & publish to try again.";
        } else if (e && (e.gh_status === 401 || e.gh_status === 403)) {
          // The webhook answered, but its GitHub access was rejected — the most
          // common cause of a sudden every-publish failure (expired credential).
          text = "Saved to your account, but the site publisher's GitHub access was rejected (" + e.gh_status + "), so the public push didn't land. Your byline is safe here — the publishing service's GitHub credential needs renewing, then press Save & publish.";
        } else if (e && e.gh_status) {
          text = "Saved to your account, but GitHub rejected the commit (" + e.gh_status + (e.error ? " — " + e.error : "") + "). Your byline is safe here — press Save & publish to try again.";
        } else {
          text = "Saved to your account, but the public publish failed: " + (e.message || "network error") + ".";
        }
        setMsg({ ok: false, text });
      }
    } else {
      setMsg({ ok: true, text: "Saved to your Matrix account. It shows in your byline here now, and goes public when an admin next publishes the site layout." });
    }
    setBusy(false);
  };

  // ----- the "Link" button: wrap the selected words in an inline link, no
  // markdown to type. The editor inserts an embedded chip and stores the same
  // [label](url) the renderer already understands. -----
  const openLink = () => {
    if (linkOpen) { setLinkOpen(false); return; }
    setLinkLabel(bioApi.current ? bioApi.current.selectionText() : "");
    setLinkUrl(""); setLinkErr(false); setLinkOpen(true);
  };
  const applyLink = () => {
    const safe = window.NpjProfiles && window.NpjProfiles.safeHref;
    const href = safe ? safe(linkUrl) : null;
    if (!href) { setLinkErr(true); return; }
    let label = (linkLabel || "").trim().replace(/[\[\]]/g, "");
    if (!label) { try { label = new URL(href).hostname.replace(/^www\./, ""); } catch (e) { label = "link"; } }
    if (bioApi.current) bioApi.current.insertLink(href, label);
    setLinkOpen(false); setLinkUrl(""); setLinkLabel("");
  };

  const field = { width: "100%", boxSizing: "border-box", border: "1.5px solid var(--ink)", background: "var(--card)", padding: "8px 10px", fontFamily: "var(--serif)", fontSize: 14.5, outline: "none" };
  const PRO = window.NpjProfiles;
  const BIO_RAW_MAX = (PRO && PRO.BIO_RAW_MAX) || 1500;
  const vlen = (PRO && PRO.visibleLength) ? PRO.visibleLength(bio) : (bio || "").length;  // URLs/markup don't count
  const over = vlen > BIO_MAX;

  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--paper-2)", boxShadow: "4px 4px 0 rgba(22,20,13,.10)", marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: "none", border: 0, padding: "11px 14px", cursor: "pointer", textAlign: "left" }}>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: "50%", background: (window.npjPerson ? window.npjPerson(me).color : "#b23a26"), color: "#fff", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{((name || me || "?").replace(/^@/, "")[0] || "?").toUpperCase()}</span>
        <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16 }}>Your byline &amp; About me</span>
        <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>{loaded ? (bio ? "set" : "not set yet") : "…"}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--mono)", color: "var(--ink-soft)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "4px 14px 16px", borderTop: "1px solid var(--rule)" }}>
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.55, margin: "10px 0 12px" }}>
            This is how you appear on every story you're credited on. Public, world-readable. Stored on your Matrix account so it survives a browser wipe.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Display name</div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={pullName} disabled={pulling} style={{ fontSize: 11 }}>{pulling ? "…" : "Pull from my Matrix account"}</button>
          </div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={me ? me.replace(/^@/, "").split(":")[0] : "Your name"} style={field} />

          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "13px 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
            <span>About me</span>
            <span style={{ flex: 1 }} />
            <div style={{ position: "relative" }}>
              <button type="button" className="btn btn-sm btn-ghost" onMouseDown={e => e.preventDefault()} onClick={openLink} title="Turn the selected words into a link" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px" }}>
                <I.link style={{ fontSize: 12 }} /> Link
              </button>
              {linkOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 248, zIndex: 6, background: "var(--card)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(22,20,13,.18)", padding: 9, textAlign: "left" }}>
                  <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Add a link</div>
                  <input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") applyLink(); if (e.key === "Escape") setLinkOpen(false); }} placeholder="Text to show (optional)" style={{ ...field, fontSize: 12.5, padding: "6px 8px", marginBottom: 6 }} />
                  <input autoFocus value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setLinkErr(false); }} onKeyDown={e => { if (e.key === "Enter") applyLink(); if (e.key === "Escape") setLinkOpen(false); }} placeholder="https://…" className="np-mono" style={{ ...field, fontSize: 12, padding: "6px 8px" }} />
                  {linkErr && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 5 }}>Enter a valid http(s) link.</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinkOpen(false)} style={{ fontSize: 11 }}>Cancel</button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={applyLink} style={{ fontSize: 11 }}>Add link</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", lineHeight: 1.5, margin: "0 0 5px" }}>
            Select a word and press <b style={{ color: "var(--ink)" }}>Link</b> — it shows inline; the address is tucked away (hover to see it) and doesn't count toward the limit.
          </div>
          <BioEditor apiRef={bioApi} value={bio} onChange={setBio} maxRaw={BIO_RAW_MAX} placeholder="A sentence or two — your beat, your background, why readers can trust your reporting." />
          <div className="np-mono" style={{ fontSize: 10, color: over ? "var(--reject)" : "var(--ink-soft)", marginTop: 4, textAlign: "right" }}>{vlen} / {BIO_MAX}</div>

          {msg && <div className="np-mono" style={{ fontSize: 11, lineHeight: 1.5, margin: "6px 0 0", color: msg.ok ? "var(--verified)" : "var(--reject)", border: "1px solid " + (msg.ok ? "var(--verified)" : "var(--reject)"), padding: "8px 10px" }}>{msg.text}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy || over} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {busy ? "Saving…" : isAdmin ? "Save & publish" : "Save my profile"}
            </button>
          </div>
        </div>
      )}
    </div>
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
  const [explorer, setExplorer] = useState(null);   // { items, initialKey } — the source file explorer
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
    if (next === "unpublished" && !window.confirm("Unpublish “" + m.headline + "”?\n\nIt comes off the site for everyone but admins. Every version stays on archive.org — you can republish anytime.")) return;
    setStatusBusy(m.slug);
    try {
      const out = await window.NpjArticles.setArticleStatus({ slug: m.slug, status: next, actor: me, token });
      if (!out.res.ok) {
        setStatusErr("Rejected (HTTP " + out.res.status + ") — nothing changed." + (out.res.status === 401 || out.res.status === 403 ? " That Matrix account isn't authorized." : ""));
      } else {
        setPublished(p => p ? { ...p, articles: p.articles.map(x => x.slug === m.slug
          ? { ...x, status: next, versions: (x.versions || 1) + 1, updated: new Date().toISOString().slice(0, 10), storage: "archive", logPath: (window.NpjArticles && window.NpjArticles.articleItemUrl) ? window.NpjArticles.articleItemUrl(m.slug) : ("https://archive.org/details/npj-article-" + m.slug) }
          : x) } : p);
        // flip the slug's status in the validated archive.org manifest so the
        // front page + reader hide/show it right away
        window.NpjArticles.patchManifestStatus(m.slug, next, token);
        // refresh the front index, then force this slug's new status in (the
        // archive listing can lag a fresh write) so home hides/shows it at once
        const reflect = () => window.NpjArticles.patchFrontStatus(m.slug, next);
        window.NpjArticles.loadFront().then(reflect).catch(reflect);
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

  // shared project documents: pull each project room's docs INTO the local store
  // (the room is the shared source of truth), then re-list — so an invited member
  // actually SEES the project's articles instead of an empty room. Also opens the
  // doc event to members on rooms we own, so they can edit, not just read. All
  // best-effort: a hiccup just leaves the per-account view as it was.
  useEffect(() => {
    if (!signedIn || !rooms) return;
    let alive = true;
    (async () => {
      const projs = []; const seen = {};
      (rooms.drafts || []).forEach(d => { if (d.roomId && !seen[d.roomId]) { seen[d.roomId] = 1; projs.push({ roomId: d.roomId, title: d.title }); } });
      (rooms.joined || []).forEach(r => { if (r.kind !== "control" && r.roomId && !seen[r.roomId]) { seen[r.roomId] = 1; projs.push({ roomId: r.roomId, title: r.name }); } });
      let pulled = false;
      for (const p of projs) {
        if (!alive) return;
        try { const docs = await window.NpjDrafts.pullRoomDocs(p.roomId, p.title); if (docs && docs.length) pulled = true; } catch (e) {}
        if (window.MatrixAuth.ensureDocPower) window.MatrixAuth.ensureDocPower(p.roomId).catch(() => {});
      }
      if (alive && pulled) { try { const list = await window.NpjDrafts.list(); setDrafts(list || []); } catch (e) {} }
    })();
    return () => { alive = false; };
  }, [rooms, signedIn]);

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
  // New article that already belongs to a project: pre-seed the draft with the
  // project's room so the Newsroom opens it inside the project (and every save
  // keeps it there), then open it. Same id scheme as newDoc.
  const newDocInProject = (p) => {
    const id = "d" + Date.now().toString(36);
    try { window.NpjDrafts.save(id, { room: { roomId: p.roomId, title: p.title || "Untitled project" }, title: "" }); } catch (e) {}
    onOpen(id);
  };

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
  const titleByRoom = (roomId) => (projects.find(p => p.roomId === roomId) || {}).title || roomId;
  const docsInProject = (roomId) => (drafts || []).filter(d => d.room && d.room.roomId === roomId);
  const soloDrafts = shownDrafts.filter(d => !d.room || !d.room.roomId);

  // Source provenance over EVERY draft: deduped by content signature and
  // backtracked to the articles that cite each source. Computed once here so a
  // project's shelf can also see the cross-project links (NpjSources.draftGroups).
  const allGroups = (window.NpjSources && drafts) ? window.NpjSources.draftGroups(drafts) : [];

  // The file explorer's contents: every source that's an actual file (uploaded
  // doc, image, pdf, text), deduped + backtracked to the articles that cite it.
  // Web-link snapshots stay on their "open ↗" — this is for files you can read.
  const SV = window.NpjSourceView;
  const fileGroups = allGroups.filter(g => SV && g.rec && (/^doc-/.test(g.rec.id || "") || SV.isViewable(g.rec) || (SV.hasFile(g.rec) && SV.kindOf(g.rec) !== "unknown")));
  const explorerItems = fileGroups.map(g => ({
    key: g.rec.id || (g.keys && g.keys[0]) || g.signature,
    rec: g.rec,
    group: (g.projects && g.projects[0]) ? (titleByRoom(g.projects[0].roomId) || g.projects[0].title || "Project") : "Not in a project",
    carriers: (g.carriers || []).map(c => ({
      title: c.title,
      onOpen: () => { setExplorer(null); if (c.kind === "published" && c.slug && onOpenArticle) onOpenArticle(c.slug); else if (c.kind === "draft") onOpen(String(c.id).replace(/^draft:/, "")); }
    }))
  }));
  const openFile = (key) => setExplorer({ items: explorerItems, initialKey: key });

  // optimistic UI: a just-sent invite shows pending immediately; a new project
  // appears without waiting on the next homeserver sync
  const addPendingMember = (roomId, mxid, name) => setMembers(m => {
    const cur = m[roomId] || [];
    if (cur.some(x => x.mxid === mxid)) return m;
    const chip = name ? { mxid, membership: "invite", guest: true, guestName: name } : { mxid, membership: "invite" };
    return { ...m, [roomId]: [...cur, chip] };
  });
  const addProject = ({ roomId, title }) => setRooms(r => {
    const draftsIdx = (r && r.drafts) || [];
    if (draftsIdx.some(d => d.roomId === roomId)) return r;
    return { ...(r || { joined: [], drafts: [] }), drafts: [{ roomId, title, ts: new Date().toISOString() }, ...draftsIdx] };
  });

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
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles…" style={{ border: 0, background: "transparent", padding: "8px 0", width: 150, fontFamily: "var(--serif)", fontSize: 13.5, outline: "none" }} />
                </span>
                <button className="btn btn-primary" onClick={newDoc} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <I.plus style={{ fontSize: 13 }} /> New article
                </button>
              </div>
            </div>

            <ProfileCard session={session} me={me} />

            {/* ---- the explorer, grouped by project ----
                 A project is a shared Matrix room: one set of invitees, any
                 number of documents. Each card shows WHO IS INVITED (live from
                 the homeserver) and the documents inside. */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 0 10px", flexWrap: "wrap" }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 7, margin: 0 }}>
                <I.folder style={{ fontSize: 14 }} /> Projects {rooms ? "· " + projects.length : ""}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {explorerItems.length > 0 && (
                  <button className="btn btn-sm" onClick={() => openFile(explorerItems[0].key)} title="Open the file explorer — read every uploaded source" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <I.eye style={{ fontSize: 12 }} /> Browse files · {explorerItems.length}
                  </button>
                )}
                <NewProjectControl onCreated={addProject} />
              </div>
            </div>
            <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", margin: "0 0 10px", lineHeight: 1.5 }}>A project buckets its <strong>articles</strong> and the <strong>sources</strong> that back them under one set of invitees — everyone invited can open and edit every article and source in it. Recovered from Matrix, not this browser — wipe or switch devices and they're still here after you sign in.</div>
            {(!rooms || !drafts) && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center", marginBottom: 10 }}><DocSpinner /> recovering your workspace (this browser + your Matrix account)…</div>}
            {rooms && drafts && projects.length === 0 && (
              <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)", marginBottom: 8 }}>No projects yet. Start one with <strong>New project</strong> above, or invite a collaborator from an article — a project is created for you.</div>
            )}
            {rooms && drafts && projects.map(p => {
              const docs = docsInProject(p.roomId).filter(match);
              if (query && !docs.length && !(p.title || "").toLowerCase().includes(query)) return null;
              return (
                <div key={p.roomId} style={{ border: "1.5px solid var(--ink)", background: "var(--paper-2)", boxShadow: "4px 4px 0 rgba(22,20,13,.10)", padding: "12px 15px", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 19, display: "inline-flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 15 }} /> {p.title || "Untitled project"}</span>
                    <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{docs.length} article{docs.length !== 1 ? "s" : ""}</span>
                    {p.ts && <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{timeAgo(p.ts)}</span>}
                  </div>
                  {p.topic && <div style={{ fontFamily: "var(--serif)", fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{p.topic}</div>}

                  {/* permission controls: who's invited + invite more. Anyone here
                      reaches every article and source in the project. */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--rule)" }}>
                    <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 10 }}>Invited</span>
                    <MemberChips list={members[p.roomId]} me={me} />
                    <span style={{ flex: 1 }} />
                    <InviteControl roomId={p.roomId} onInvited={(mx) => addPendingMember(p.roomId, mx)} />
                    <NewAccountInvite roomId={p.roomId} roomTitle={p.title} onInvited={(mx, name) => addPendingMember(p.roomId, mx, name)} />
                  </div>
                  <div className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
                    <I.shield style={{ fontSize: 11 }} /> Everyone invited can open and edit every article and source in this project.
                  </div>

                  {/* articles in the project */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "13px 0 6px", flexWrap: "wrap" }}>
                    <div className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 10, display: "flex", alignItems: "center", gap: 6, margin: 0 }}><I.doc style={{ fontSize: 12 }} /> Articles</div>
                    <button className="btn btn-sm btn-primary" onClick={() => newDocInProject(p)} title={"Start a new article in “" + (p.title || "this project") + "” — everyone invited can edit it"} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <I.plus style={{ fontSize: 12 }} /> New article
                    </button>
                  </div>
                  {docs.length === 0 && (
                    query
                      ? <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>no articles match the search</div>
                      : (
                        <button onClick={() => newDocInProject(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "1.5px dashed var(--rule-strong)", background: "transparent", padding: "12px 14px", cursor: "pointer" }}>
                          <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14 }}>No articles yet — start the first one.</span>
                          <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", display: "block", marginTop: 3 }}>It opens in the editor already inside this project.</span>
                        </button>
                      )
                  )}
                  {docs.map(d => draftRow(d, true))}

                  {/* sources shared across every article in the project, deduped +
                      backtracked (NpjSources). Hidden while a search is active so
                      the project view stays focused on the matching articles. */}
                  {!query && (
                    <React.Fragment>
                      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 10, margin: "13px 0 6px", display: "flex", alignItems: "center", gap: 6 }}><I.source style={{ fontSize: 12 }} /> Sources · available to every article here</div>
                      <ProjectSources groups={allGroups} roomId={p.roomId} titleOf={titleByRoom} onOpen={onOpen} onOpenArticle={onOpenArticle} onOpenFile={openFile} />
                    </React.Fragment>
                  )}
                </div>
              );
            })}
            {rooms && rooms.error && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 6 }}>{rooms.error}</div>}

            {/* ---- documents that belong to no project ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.doc style={{ fontSize: 14 }} /> Your articles · not in a project {drafts ? "· " + soloDrafts.length : ""}
            </div>
            {drafts && soloDrafts.length === 0 && (
              <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "22px 20px", textAlign: "center", marginBottom: 8 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 17, marginBottom: 4 }}>{query ? "Nothing matches “" + q.trim() + "”." : "Nothing here."}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>{query ? "Try another search." : "Start an article and it autosaves here — and to your Matrix account. Invite someone and it moves into a project."}</div>
              </div>
            )}
            {drafts && soloDrafts.map(d => draftRow(d, false))}

            {/* ---- the published record: one version folder per document ---- */}
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: 7 }}>
              <I.check style={{ fontSize: 14 }} /> Published · append-only event logs on archive.org
            </div>
            {statusErr && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)", border: "1px solid var(--reject)", padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>{statusErr}</div>}
            {!published && <div className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", gap: 7, alignItems: "center" }}><DocSpinner /> reading the public record…</div>}
            {published && pubArticles.length === 0 && published.legacy.length === 0 && (
              <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>Nothing published yet. When a piece ships, its archive.org item (npj-article-&lt;slug&gt;) is created and listed here.</div>
            )}
            {published && pubArticles.map(m => {
              // the row's status: unpublished (off the site) · updated (edited
              // since publish — newest version file wins) · published
              const badge = m.status === "unpublished"
                ? { label: "⊘ Unpublished", color: "var(--reject)" }
                : (m.versions || 1) > 1
                ? { label: "⊛ Updated" + (m.updated ? " " + m.updated : ""), color: "var(--review)" }
                : { label: "● Published", color: "var(--verified)" };
              // the event log lives on archive.org now — link to the item
              const logHref = m.logPath || (window.NpjArticles && window.NpjArticles.articleItemUrl
                ? window.NpjArticles.articleItemUrl(m.slug)
                : "https://archive.org/details/npj-article-" + m.slug);
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
                    <button className="btn btn-sm" disabled={busy} onClick={() => setDocStatus(m, "unpublished")} title="Unpublish — take it off the site (every version stays on archive.org)"
                      style={{ borderColor: "var(--reject)", color: "var(--reject)", opacity: busy ? .5 : 1 }}>⊘ {busy ? "Working…" : "Unpublish"}</button>
                  ))}
                  <a href={logHref} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 10.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <I.ext style={{ fontSize: 12 }} /> event log
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
        {explorer && window.SourceExplorer && (
          <window.SourceExplorer items={explorer.items} initialKey={explorer.initialKey}
            title="Source files" onClose={() => setExplorer(null)} />
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
