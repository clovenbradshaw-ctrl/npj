/* NPJ — edit after publish. Opens from the article control bar for the admin
   and the article's assignees. The published piece is NOT a file you rewrite:
   it's an EO event log — a folder of timestamped version files
   (articles/<slug>/), so saving here commits exactly one REC event — the
   change, who made it, when, and why — as a brand-new version file. Nothing
   existing is ever touched (which is why these commits can't be rejected the
   way the old in-place append was), and every version stays readable in the
   folder and in the reader's edit-history overlay.

   Source-bound claims survive the round trip: the body renders into the
   contenteditable with each claim wrapped as <span class="eo-claim" data-src>,
   and htmlToBlocks() turns those spans straight back into claim tokens. Edit
   the words inside a claim freely; delete the span and the binding goes with
   it (that's an editorial decision, and the log records it). */

function ArticleEdit({ article, me, isAdmin, onClose, onSaved }) {
  const A = article;
  const [headline, setHeadline] = useState(A.headline || "");
  const [dek, setDek] = useState(A.dek || "");
  const [note, setNote] = useState("");
  const [assignees, setAssignees] = useState((A.assignees || []).join(", "));
  // byline — outward-facing credit, editable by anyone who can edit the piece
  const [authorsInput, setAuthorsInput] = useState((A.authors || []).join(", "));
  const [editorsInput, setEditorsInput] = useState((A.editors || []).join(", "));
  const [unsigned, setUnsigned] = useState((A.byline || "").trim().toLowerCase() === "unsigned");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const bodyRef = useRef(null);
  const seedHtml = useMemo(() => window.NpjArticles.blocksToHtml(A.body), [A]);
  const signedIn = !!(window.MatrixAuth && window.MatrixAuth.token && window.MatrixAuth.token());

  const cmd = (c, v) => { document.execCommand(c, false, v || null); if (bodyRef.current) bodyRef.current.focus(); };
  const addLink = () => { const u = prompt("Link URL"); if (u) cmd("createLink", u); };

  // ---- images: same media path as the newsroom (drop → media store → archive.org on save) ----
  const imageFigure = (id, banner) =>
    '<figure contenteditable="false" class="cmp-embed"' + (banner ? ' data-banner="1"' : '') + '><image-slot id="' + id + '" fitcontrol shape="rect" placeholder="' +
    (banner ? "Banner — drop a photo or an archive.org link" : "Drop a photo or an archive.org link") +
    '" style="width:100%;height:' + (banner ? 300 : 260) + 'px;display:block"></image-slot>' +
    '<figcaption class="np-mono" style="font-size:11px;margin-top:4px">' + (banner ? "banner" : "photo") +
    ' · drag an image or an archive.org link, then caption</figcaption></figure><p><br/></p>';
  const insertImage = () => { if (bodyRef.current) bodyRef.current.focus(); document.execCommand("insertHTML", false, imageFigure("eo-img-" + Date.now().toString(36), false)); };
  const addBanner = () => { if (bodyRef.current) bodyRef.current.insertAdjacentHTML("afterbegin", imageFigure("eo-banner-" + Date.now().toString(36), true)); };

  // ---- sourcing: bind the selected words to a (new) source, like the newsroom ----
  const bindSourceUrl = () => {
    setErr(null);
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !bodyRef.current || !bodyRef.current.contains(sel.anchorNode)) {
      setErr("Select the words a source backs, then click ⊥ Source."); return;
    }
    const u = prompt("Source URL (an archive.org snapshot, or the original):");
    if (!u || !/^https?:\/\//.test(u)) return;
    let outlet = "source"; try { outlet = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
    const key = "web-" + Date.now().toString(36);
    window.NPJ.SOURCES[key] = { id: key, type: "primary", outlet, title: "Web source", original_url: u, archive_url: /web\.archive\.org/.test(u) ? u : "", retrieved: new Date().toISOString().slice(0, 10) };
    const span = document.createElement("span");
    span.className = "eo-claim"; span.setAttribute("data-src", key); span.setAttribute("data-id", "cl-" + Date.now().toString(36));
    const r = sel.getRangeAt(0);
    try { r.surroundContents(span); } catch (e) { const f = r.extractContents(); span.appendChild(f); r.insertNode(span); }
    sel.removeAllRanges();
  };

  const parseMx = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(x => /^@[^:]+:[^:]+$/.test(x));
  const parseAssignees = () => parseMx(assignees);
  const nameOfMx = (m) => (window.npjPerson ? window.npjPerson(m).name : String(m).replace(/^@/, "").split(":")[0]);

  const save = async () => {
    setErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setErr("Sign in with your Matrix account to edit — the webhook re-verifies the token server-side."); return; }
    const html = bodyRef.current ? bodyRef.current.innerHTML : "";
    const { blocks } = window.NpjArticles.htmlToBlocks(html);
    if (!blocks.length) { setErr("The body is empty — there's nothing to commit."); return; }

    setBusy(true);
    // freshly-dropped images live on the media store — move them to archive.org
    // before the body is committed (mutates the img srcs in place). Published
    // images must live on archive.org, so a failed move is a hard stop: never
    // commit a Matrix media-store URL into the record.
    if (window.NpjMedia && window.NpjMedia.freezeArticleMedia) {
      let froze = null, freezeErr = null;
      try { froze = await window.NpjMedia.freezeArticleMedia(blocks, { slug: A.slug, title: headline || A.headline }); }
      catch (e) { freezeErr = e; }
      if (freezeErr || (froze && froze.failed)) {
        setBusy(false);
        const why = freezeErr ? (freezeErr.message || "") : ((froze.failReasons && froze.failReasons.join("; ")) || "");
        setErr("Couldn't move " + ((froze && froze.failed) || "an") + " image" + ((froze && froze.failed !== 1) ? "s" : "") +
          " to archive.org — nothing was committed. " + (why ? why + " " : "") +
          "Published images must live on archive.org; check the n8n media endpoint (and IA_S3 keys), then retry.");
        return;
      }
    }
    // any sources the body now cites (including new ⊥ Source binds) ride in the REC
    const usedKeys = {};
    blocks.forEach(b => {
      (b.tokens || []).forEach(t => { if (t && t.src) t.src.forEach(k => usedKeys[k] = 1); });
      (b.items || []).forEach(it => it.forEach(t => { if (t && t.src) t.src.forEach(k => usedKeys[k] = 1); }));
    });
    const sources = {};
    Object.keys(usedKeys).forEach(k => { const rec = (window.NPJ.SOURCES && window.NPJ.SOURCES[k]) || (A.sources && A.sources[k]); if (rec) sources[k] = rec; });

    // the REC operand carries ONLY what changed (plus body, which is the edit)
    const operand = { body: blocks };
    if (Object.keys(sources).length) operand.sources = sources;
    if (headline.trim() && headline.trim() !== A.headline) operand.headline = headline.trim();
    if (dek.trim() !== (A.dek || "")) operand.dek = dek.trim();
    const nextAssignees = parseAssignees();
    if (isAdmin && nextAssignees.join(",") !== (A.assignees || []).join(",")) operand.assignees = nextAssignees;
    // byline diff — only the fields that actually changed ride the REC
    const nextAuthors = unsigned ? [] : parseMx(authorsInput);
    const nextEditors = parseMx(editorsInput);
    const nextByline = unsigned ? "Unsigned" : "";
    if (nextAuthors.join(",") !== (A.authors || []).join(",")) operand.authors = nextAuthors;
    if (nextEditors.join(",") !== (A.editors || []).join(",")) operand.editors = nextEditors;
    if (nextByline !== (A.byline || "")) operand.byline = nextByline;

    let out;
    try {
      out = await window.NpjArticles.appendEdit({ slug: A.slug, operand, actor: me, note: note.trim() || undefined, token });
    } catch (e) {
      setBusy(false);
      setErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing was committed.");
      return;
    }
    if (out.res.status === 401) { setBusy(false); setErr("Rejected (401) — that Matrix account isn't authorized to publish edits."); return; }
    if (out.res.status === 403) { setBusy(false); setErr("Rejected (403) — you're not an assignee on this article. Ask the admin to add you."); return; }
    if (!out.res.ok) { setBusy(false); setErr("The webhook answered HTTP " + out.res.status + " — nothing was committed."); return; }

    // fold the new event over the local article so the reader updates instantly
    const ts = new Date().toISOString();
    const updated = {
      ...A, ...operand,
      sources: Object.assign({}, A.sources, sources), // existing bindings carry over; new ones merge in
      updated: ts.slice(0, 10),
      base_sha: out.sha,
      readMins: window.NpjArticles.readMins(blocks),
      versions: [{ sha: out.sha, ts, author: me, message: note.trim() || "Edited", text: window.NpjArticles.plainText(blocks) }, ...(A.versions || [])]
    };
    setBusy(false);
    onSaved(updated);
  };

  const tb = { background: "var(--card)", border: "1.5px solid var(--ink)", padding: "5px 11px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" };
  const field = { width: "100%", border: "1.5px solid var(--ink)", background: "var(--card)", padding: "8px 10px", fontFamily: "var(--serif)", fontSize: 15, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 5100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 18px" }} className="fade-in">
      <style>{`
        .eo-edit-body .eo-claim { border-bottom: 2px dotted var(--yellow-deep); background: color-mix(in srgb, var(--yellow) 16%, transparent); }
        .eo-edit-body .eo-claim::after { content: "⊥"; font-family: var(--mono); font-size: 10px; vertical-align: super; color: var(--yellow-deep); padding-left: 1px; }
        .eo-edit-body figure[data-eo-img] img { max-width: 100%; border: 1.5px solid var(--ink); }
        .eo-edit-body figure { margin: 14px 0; }
        .eo-edit-body image-slot { max-width: 100%; }
        .eo-edit-body figcaption { font-family: var(--mono); font-size: 11px; color: var(--ink-soft); }
        .eo-edit-body h2, .eo-edit-body h3 { font-family: var(--display); line-height: 1.05; }
        .eo-edit-body blockquote { border-left: 4px solid var(--yellow-deep); margin: 16px 0; padding-left: 14px; font-family: var(--cond); font-size: 20px; }
      `}</style>
      <div className="np-scroll" style={{ width: "min(880px, 97vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--paper)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--yellow)" }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EDIT THE RECORD</span>
          <span className="np-mono" style={{ fontSize: 10.5, opacity: .75 }}>commits one REC version file to articles/{A.slug}/</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        <div style={{ padding: "18px 22px 24px" }}>
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.55, marginBottom: 14 }}>
            Editing as {me}{isAdmin ? " · admin" : " · assignee"}. Nothing is rewritten: your change is appended to the article's event log, so every prior version stays in the public record (⊛ v.{A.base_sha}, {A.versions ? A.versions.length : 1} version{(A.versions || []).length === 1 ? "" : "s"} so far).
          </div>

          <div className="np-eyebrow" style={{ marginBottom: 6 }}>Headline</div>
          <input value={headline} onChange={e => setHeadline(e.target.value)} style={{ ...field, fontFamily: "var(--display)", fontSize: 26 }} />

          <div className="np-eyebrow" style={{ margin: "14px 0 6px" }}>Subtitle</div>
          <input value={dek} onChange={e => setDek(e.target.value)} placeholder="standfirst under the headline" style={{ ...field, fontStyle: "italic" }} />

          <div className="np-eyebrow" style={{ margin: "16px 0 6px" }}>Body</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("bold")}><strong>B</strong></button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("italic")}><em>I</em></button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("formatBlock", "h2")}>H2</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("formatBlock", "h3")}>H3</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("formatBlock", "blockquote")}>“ Quote</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("formatBlock", "p")}>¶</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={addLink}>Link</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={insertImage}>▣ Image</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={addBanner}>▤ Banner</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={bindSourceUrl}>⊥ Source</button>
            <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", alignSelf: "center" }}>select text → ⊥ Source to cite it · drop a photo to add an image · dotted spans are existing claims</span>
          </div>
          <div ref={bodyRef} className="eo-edit-body np-scroll" contentEditable suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: seedHtml }}
            style={{ minHeight: 320, maxHeight: "46vh", overflowY: "auto", border: "1.5px solid var(--ink)", background: "var(--card)",
              padding: "16px 18px", fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.6, outline: "none" }} />

          {/* Byline — outward-facing credit. Editable by anyone who can edit. */}
          <div className="np-eyebrow" style={{ margin: "16px 0 6px" }}>Byline · how the piece is credited</div>
          <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
            {unsigned || !parseMx(authorsInput).length ? "Unsigned" : "By " + parseMx(authorsInput).map(nameOfMx).join(", ")}
            {parseMx(editorsInput).length ? <span style={{ color: "var(--ink-soft)" }}>{"  ·  Edited by " + parseMx(editorsInput).map(nameOfMx).join(", ")}</span> : null}
          </div>
          {!unsigned && (
            <React.Fragment>
              <input value={authorsInput} onChange={e => setAuthorsInput(e.target.value)} placeholder="@author:hyphae.social" className="np-mono" style={{ ...field, fontSize: 12.5 }} />
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "4px 0 8px" }}>Authors · comma-separated Matrix IDs. Names come from each contributor's profile.</div>
            </React.Fragment>
          )}
          <input value={editorsInput} onChange={e => setEditorsInput(e.target.value)} placeholder="@editor:hyphae.social  (optional)" className="np-mono" style={{ ...field, fontSize: 12.5 }} />
          <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "4px 0 0" }}>Edited by · optional, shown as a separate credit line.</div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 9, cursor: "pointer" }}>
            <input type="checkbox" checked={unsigned} onChange={e => setUnsigned(e.target.checked)} />
            <span className="np-mono" style={{ fontSize: 11, color: "var(--ink)" }}>Unsigned — no author credit</span>
          </label>

          {isAdmin && (
            <React.Fragment>
              <div className="np-eyebrow" style={{ margin: "16px 0 6px" }}>Assignees · who may edit this article</div>
              <input value={assignees} onChange={e => setAssignees(e.target.value)} placeholder="@reporter:hyphae.social, @editor:hyphae.social" className="np-mono" style={{ ...field, fontSize: 12.5 }} />
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 4 }}>Comma-separated Matrix IDs. The admin can always edit; assignees are recorded in the log with everything else.</div>
            </React.Fragment>
          )}

          <div className="np-eyebrow" style={{ margin: "16px 0 6px" }}>Edit note · why this change</div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="corrected the assessment figure per the 2024 990" style={{ ...field }} />

          {!signedIn && <div className="np-mono" style={{ fontSize: 11, color: "var(--reject)", border: "1px solid var(--reject)", padding: "9px 10px", marginTop: 14, lineHeight: 1.5 }}>You're not signed in — sign in with Matrix (Submit page) before saving. The webhook verifies the token server-side.</div>}
          {err && <div className="np-mono" style={{ fontSize: 11, color: "var(--reject)", border: "1px solid var(--reject)", padding: "9px 10px", marginTop: 14, lineHeight: 1.5 }}>{err}</div>}

          <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onClose} disabled={busy}>Discard</button>
            <button className="btn btn-primary" onClick={save} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              {busy ? <span style={{ width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> : <span style={{ fontFamily: "var(--mono)" }}>⊛</span>}
              {busy ? "Committing the new version…" : "Commit the edit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ArticleEdit });
