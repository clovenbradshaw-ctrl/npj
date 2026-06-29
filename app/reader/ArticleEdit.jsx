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
  // byline — the name readers see, editable by anyone who can edit the piece.
  // It's a plain name now: seed it from the stored byline string, else the
  // resolved name of the first credited author. The author's userid stays in
  // A.authors and rides through every edit untouched (the backend keeps it).
  // Seed from a stored byline string; failing that, ONLY from a committed
  // contributor profile (window.NPJ.PEOPLE) for the first credited author. With no
  // profile the field stays empty (a "Author name" placeholder) so an edit never
  // silently re-credits the piece to the raw Matrix handle.
  const initialName = (() => {
    const bl = (A.byline || "").trim();
    if (bl && bl.toLowerCase() !== "unsigned") return bl;
    const first = (A.authors || []).filter(Boolean)[0];
    if (first && window.NPJ && window.NPJ.PEOPLE && window.NPJ.PEOPLE[first] && window.NPJ.PEOPLE[first].name) return window.NPJ.PEOPLE[first].name;
    return "";
  })();
  const [nameInput, setNameInput] = useState(initialName);
  const [editorsInput, setEditorsInput] = useState((A.editors || []).join(", "));
  const [unsigned, setUnsigned] = useState((A.byline || "").trim().toLowerCase() === "unsigned");
  // the userid kept on the record — the original author(s), or (only if the piece
  // had none) the editor making it signed. The displayed name never rewrites it.
  const recordedId = (A.authors || []).filter(Boolean)[0] || (me && /^@[^:]+:[^:]+$/.test(me) ? me : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const bodyRef = useRef(null);
  // Clean-text view: hide every citation/sourcing marker (the dotted claim
  // underlines, the ⊥ source glyphs) so the body reads as plain prose. Purely
  // visual — the <span class="eo-claim" data-src> spans stay in the DOM, so the
  // bindings round-trip through htmlToBlocks on save exactly as before.
  const [cleanView, setCleanView] = useState(false);
  const seedHtml = useMemo(() => window.NpjArticles.blocksToHtml(A.body), [A]);
  const signedIn = !!(window.MatrixAuth && window.MatrixAuth.token && window.MatrixAuth.token());

  const cmd = (c, v) => { document.execCommand(c, false, v || null); if (bodyRef.current) bodyRef.current.focus(); };
  const addLink = () => { const u = prompt("Link URL"); if (u) cmd("createLink", u); };
  // A block quote (a bordered passage) and a pull quote (a large display callout,
  // class np-pull) share the <blockquote> tag; justification rides as inline
  // text-align. Both round-trip through htmlToBlocks. See app/record/articles.js.
  const quoteAs = (kind) => {
    const root = bodyRef.current; if (!root) return;
    root.focus(); document.execCommand("formatBlock", false, "blockquote");
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    root.querySelectorAll("blockquote").forEach(bq => {
      if (range && range.intersectsNode && !range.intersectsNode(bq)) return;
      if (kind === "pull") bq.classList.add("np-pull"); else bq.classList.remove("np-pull");
    });
  };

  // ---- images: same media path as the newsroom (drop → media store → archive.org on save) ----
  // caption + credit + description are editable lines under the (non-editable)
  // figure. The credit carries a markdown hyperlink like a contributor bio —
  // name / [outlet](https://…) — rendered safely via npjRichText in the reader.
  // The description is the photo's alt text (screen readers + search); it rides
  // as the image's real `alt`, not a visible caption line.
  const figCaps =
    '<figcaption class="cmp-cap np-mono" contenteditable="true" data-ph="Caption — what\'s happening in the photo" style="font-size:11px;margin-top:4px"></figcaption>' +
    '<figcaption class="cmp-credit np-mono" contenteditable="true" data-ph="Credit — e.g. Jane Doe / [Reuters](https://reuters.com)" style="font-size:11px;margin-top:2px"></figcaption>' +
    '<figcaption class="cmp-desc np-mono" contenteditable="true" data-ph="Description — alt text for screen readers &amp; search (not shown on the page)" style="font-size:11px;margin-top:2px"></figcaption>';
  const imageFigure = (id, banner) =>
    '<figure contenteditable="false" class="cmp-embed"' + (banner ? ' data-banner="1"' : '') + '><image-slot id="' + id + '" conform fitcontrol shape="rect" placeholder="' +
    (banner ? "Banner — drop a photo or an archive.org link" : "Drop a photo or an archive.org link") +
    '" style="width:100%;height:' + (banner ? 300 : 260) + 'px;display:block"></image-slot>' +
    figCaps + '</figure><p><br/></p>';
  // WebKit doesn't upgrade custom elements inserted through execCommand /
  // insertAdjacentHTML: a freshly-inserted <image-slot> never runs its
  // connectedCallback, so its drag/drop + paste listeners stay unbound and a
  // photo dropped onto it does nothing until a reload re-parses the HTML. Force
  // the upgrade so the slot is live at once (no-op where the engine already
  // upgrades, and skips already-upgraded nodes).
  const upgradeSlots = () => { try { const r = bodyRef.current; if (r && window.customElements && customElements.upgrade) customElements.upgrade(r); } catch (e) {} };
  // Insert an inline image at the caret. When focus was last in the Headline /
  // Subtitle field (or nowhere), the body has no live caret and execCommand would
  // drop the figure at offset 0, above the existing copy — so fall back to the end
  // of the body. Read the selection BEFORE focusing: focus() can synthesize an
  // offset-0 range that we'd otherwise mistake for a placed caret.
  const insertImage = () => {
    const root = bodyRef.current; if (!root) return;
    const s = window.getSelection();
    const inBody = !!(s && s.rangeCount && root.contains(s.getRangeAt(0).startContainer));
    root.focus();
    if (!inBody && s) { const r = document.createRange(); r.selectNodeContents(root); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    document.execCommand("insertHTML", false, imageFigure("eo-img-" + Date.now().toString(36), false));
    upgradeSlots();
  };
  const addBanner = () => { if (bodyRef.current) { bodyRef.current.insertAdjacentHTML("afterbegin", imageFigure("eo-banner-" + Date.now().toString(36), true)); upgradeSlots(); } };

  // ---- embeds: paste a URL → a live player (same resolver the composer + reader
  // use). YouTube/Vimeo keep 16:9; a Google Drive / Docs / archive.org file
  // takes a fixed height. data-embed-url keeps the original permalink so the
  // edit round-trips through htmlToBlocks like any other embed block. ----
  const addEmbed = () => {
    const raw = prompt("Embed URL — YouTube, Vimeo, a Google Drive or archive.org file, .mp4/.mp3 …");
    const url = (raw || "").trim(); if (!/^https?:\/\//.test(url)) return;
    const esc = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
    const r = window.NpjEmbed && window.NpjEmbed.resolve(url);
    let height = null;
    if (r && r.panel) {
      const def = (window.NpjEmbed && window.NpjEmbed.DEFAULT_HEIGHT) || 600;
      height = parseInt(prompt("Frame height in pixels", String(def)), 10) || def;
    }
    const inner = window.NpjEmbed ? window.NpjEmbed.innerHtml(url, { height }) : '<a href="' + esc + '">' + (host || esc) + "</a>";
    const heightAttr = (r && r.panel && height) ? ' data-embed-height="' + height + '"' : "";
    const root = bodyRef.current; if (!root) return;
    const s = window.getSelection();
    const inBody = !!(s && s.rangeCount && root.contains(s.getRangeAt(0).startContainer));
    root.focus();
    if (!inBody && s) { const rg = document.createRange(); rg.selectNodeContents(root); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); }
    document.execCommand("insertHTML", false, '<figure contenteditable="false" class="cmp-embed" data-embed-url="' + esc + '"' + heightAttr + ">" + inner + "</figure><p><br/></p>");
  };

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
    try { r.surroundContents(span); } catch (e) { const f = r.extractContents(); span.appendChild(f); r.insertNode(span); if (span.parentNode) span.parentNode.normalize(); }
    sel.removeAllRanges();
  };

  const parseMx = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(x => /^@[^:]+:[^:]+$/.test(x));
  const parseAssignees = () => parseMx(assignees);
  // Editors are a display credit (not access control), so an entry can be a plain
  // NAME (multi-word) or a Matrix id — split on commas/newlines, never on spaces.
  const parseEditors = (s) => String(s || "").split(/[\n,]+/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
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
    const pub = (window.NpjArticles && window.NpjArticles.publishableSource) || ((r) => r);
    Object.keys(usedKeys).forEach(k => { const rec = (window.NPJ.SOURCES && window.NPJ.SOURCES[k]) || (A.sources && A.sources[k]); if (rec) sources[k] = pub(rec); });

    // the REC operand carries ONLY what changed (plus body, which is the edit)
    const operand = { body: blocks };
    if (Object.keys(sources).length) operand.sources = sources;
    if (headline.trim() && headline.trim() !== A.headline) operand.headline = headline.trim();
    if (dek.trim() !== (A.dek || "")) operand.dek = dek.trim();
    const nextAssignees = parseAssignees();
    if (isAdmin && nextAssignees.join(",") !== (A.assignees || []).join(",")) operand.assignees = nextAssignees;
    // byline diff — only the fields that actually changed ride the REC. The
    // displayed credit is the typed name (stored in `byline`); the userid(s)
    // stay in `authors` so the backend keeps the real identity. Editing the name
    // never rewrites who the record credits — we preserve the original author id,
    // falling back to the editor's own id only when the piece had no author yet.
    const origAuthors = (A.authors || []).filter(Boolean);
    const nextAuthors = unsigned ? [] : (origAuthors.length ? origAuthors : (me && /^@[^:]+:[^:]+$/.test(me) ? [me] : []));
    const nextEditors = parseEditors(editorsInput);
    // keep the rich chip only when the typed name matches the credited author's
    // COMMITTED profile name (window.NPJ.PEOPLE) — then the byline resolves live
    // from the recorded id. With no profile that "name" is only the Matrix
    // localpart, which readers must never see, so store the typed name verbatim.
    const profileName = (recordedId && window.NPJ && window.NPJ.PEOPLE && window.NPJ.PEOPLE[recordedId] && window.NPJ.PEOPLE[recordedId].name) || "";
    const typedName = nameInput.trim();
    const nextByline = unsigned ? "Unsigned" : (typedName && typedName !== profileName ? typedName : "");
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
      versions: [{ sha: out.sha, ts, author: me, message: note.trim() || "Edited", headline: operand.headline != null ? operand.headline : (A.headline || ""), dek: operand.dek != null ? operand.dek : (A.dek || ""), text: window.NpjArticles.plainText(blocks) }, ...(A.versions || [])]
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
        .eo-edit-body.eo-clean .eo-claim { border-bottom: 0; background: transparent; }
        .eo-edit-body.eo-clean .eo-claim::after { content: ""; padding-left: 0; }
        .eo-edit-body figure[data-eo-img] img { max-width: 100%; border: 1.5px solid var(--ink); }
        .eo-edit-body figure { margin: 14px 0; }
        .eo-edit-body image-slot { max-width: 100%; }
        .eo-edit-body figcaption { font-family: var(--mono); font-size: 11px; color: var(--ink-soft); }
        .eo-edit-body h2, .eo-edit-body h3 { font-family: var(--display); line-height: 1.05; }
        .eo-edit-body blockquote { border-left: 4px solid var(--yellow-deep); margin: 16px 0; padding-left: 14px; font-family: var(--quote); font-weight: 300; font-size: 19px; line-height: 1.5; }
        .eo-edit-body blockquote.np-pull { border-left: 0; padding: 10px 0; border-top: 2px solid var(--yellow-deep); border-bottom: 2px solid var(--yellow-deep); font-size: 25px; line-height: 1.28; text-align: center; }
      `}</style>
      <div className="np-scroll" style={{ width: "min(880px, 97vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--paper)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--yellow)" }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EDIT THE RECORD</span>
          <span className="np-mono" style={{ fontSize: 10.5, opacity: .75 }}>appends one REC event to articles/{A.slug}.jsonl in GitHub</span>
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
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => quoteAs("block")}>“ Quote</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => quoteAs("pull")} title="Pull quote — a large display callout">“ Pull</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("formatBlock", "p")}>¶</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("justifyLeft")} title="Align left">⬱</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("justifyCenter")} title="Center">≡</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={() => cmd("justifyRight")} title="Align right">⬲</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={addLink}>Link</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={insertImage}>▣ Image</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={addBanner}>▤ Banner</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={addEmbed}>▶ Embed</button>
            <button style={tb} onMouseDown={e => e.preventDefault()} onClick={bindSourceUrl}>⊥ Source</button>
            <button style={{ ...tb, ...(cleanView ? { background: "var(--ink)", color: "var(--paper)" } : null) }} onMouseDown={e => e.preventDefault()} onClick={() => setCleanView(v => !v)} title="Hide every citation and source marker; the body reads as clean text. Bindings are untouched.">{cleanView ? "⊥ Show sourcing" : "◻ Clean text"}</button>
            <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", alignSelf: "center" }}>{cleanView ? "sourcing hidden — clean-text view; bindings are intact and still save" : "select text → ⊥ Source to cite it · drop a photo to add an image · dotted spans are existing claims"}</span>
          </div>
          <div ref={bodyRef} className={"eo-edit-body np-scroll" + (cleanView ? " eo-clean" : "")} contentEditable suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: seedHtml }}
            style={{ minHeight: 320, maxHeight: "46vh", overflowY: "auto", border: "1.5px solid var(--ink)", background: "var(--card)",
              padding: "16px 18px", fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.6, outline: "none" }} />

          {/* Byline — the name readers see. Editable by anyone who can edit.
              The userid (recordedId) stays on the record; only the name changes. */}
          <div className="np-eyebrow" style={{ margin: "16px 0 6px" }}>Byline · how the piece is credited</div>
          <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
            {unsigned || (!nameInput.trim() && !recordedId) ? "Unsigned" : "By " + (nameInput.trim() || nameOfMx(recordedId))}
            {parseEditors(editorsInput).length ? <span style={{ color: "var(--ink-soft)" }}>{"  ·  Edited by " + parseEditors(editorsInput).map(nameOfMx).join(", ")}</span> : null}
          </div>
          {!unsigned && (
            <React.Fragment>
              <input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Author name" style={{ ...field, fontSize: 14 }} />
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "4px 0 8px" }}>The name readers see.{recordedId ? " Recorded on the record as " + recordedId + "." : ""}</div>
            </React.Fragment>
          )}
          <input value={editorsInput} onChange={e => setEditorsInput(e.target.value)} placeholder="Editor name, or @editor:hyphae.social  (optional)" className="np-mono" style={{ ...field, fontSize: 12.5 }} />
          <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", margin: "4px 0 0" }}>Edited by · optional, shown as a separate credit line. A plain name or a Matrix id; separate several with commas.</div>
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
