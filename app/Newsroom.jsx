/* NPJ newsroom — the editor. Ships empty. Manual, span-bound sourcing (drafteo
   style: select the exact words → bind a source; one source can back many spans).
   Adds: banner + inline images, a proper link/jump-link popover, a section
   contents rail, Clippy-assisted tags, real Matrix room invites + server-side
   room recovery (survives a browser wipe), permission-gated publish, versioning. */

/* themeable palette — resolved by the --nr-* vars on .newsroom / .newsroom.nr-light
   (app/styles.css), so every piece of chrome follows the light/dark toggle */
const NR = {
  bg: "var(--nr-bg)", rail: "var(--nr-rail)", panel: "var(--nr-panel)", field: "var(--nr-field)",
  line: "var(--nr-line)", muted: "var(--nr-muted)", text: "var(--nr-text)", soft: "var(--nr-soft)",
  ok: "var(--nr-ok)", warn: "var(--nr-warn)"
};

const THEME_KEY = "npj_nr_theme";
function nrTheme() { try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; } }

const DEK_PH = "Subtitle — one line under the headline";
const START_DOC =
  '<figure contenteditable="false" class="nr-banner"><image-slot id="nr-banner" shape="rect" placeholder="Banner image — drag a photo or an archive.org link" style="width:100%;height:300px;display:block"></image-slot></figure>' +
  '<h1>Untitled</h1>' +
  '<p class="nr-dek" data-ph="' + DEK_PH + '"><br/></p>' +
  '<p><br/></p>';

// edge-dashes stripped AFTER the length cap — a cap that lands mid-word used
// to leave filenames like "…-and-the-people-.md"
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, ""); }

function Newsroom({ session, draftId = "working", onExit, onDocs, onPublished }) {
  const { layout, me } = React.useContext(window.LayoutCtx);
  const columns = (layout.sections || []).map(s => s.name);
  const canPub = window.canPublish(layout, session && session.user_id);
  const isMobile = window.useIsMobile();
  const [mTab, setMTab] = useState("write");          // mobile: write | contents | sources
  const [theme, setTheme] = useState(nrTheme);        // light | dark — persisted
  const toggleTheme = () => setTheme(t => { const next = t === "light" ? "dark" : "light"; try { localStorage.setItem(THEME_KEY, next); } catch (e) {} return next; });
  const restored = useRef(false);                      // gate autosave until the first restore lands
  const saveTimer = useRef(null);
  const htmlRef = useRef("");                          // last seen editor HTML (survives unmount, when ed.current is gone)

  const [sources, setSources] = useState([]);
  const [citeOrder, setCiteOrder] = useState([]);
  const citeOrderRef = useRef([]);
  const [armSrc, setArmSrc] = useState(null);       // source picked first; next selection binds to it
  const [rev, setRev] = useState(0);                // bump to recompute span counts
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [publish, setPublish] = useState(null);
  const [title, setTitle] = useState("Untitled");
  const [fileSlug, setFileSlug] = useState("");      // custom filename; "" = derived from the title
  const [tags, setTags] = useState([]);
  const [column, setColumn] = useState(columns[0] || "");
  const [toc, setToc] = useState([]);
  const [media, setMedia] = useState([]);           // images + embeds in the piece
  const [viewer, setViewer] = useState(null);       // index into the image list — the media viewer
  const [showVersions, setShowVersions] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [rooms, setRooms] = useState(null);
  const [collabs, setCollabs] = useState(() => (session ? [session.user_id] : []));
  const [room, setRoom] = useState(null);            // the project this document belongs to
  const [invite, setInvite] = useState(false);
  const [inviteVal, setInviteVal] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [projects, setProjects] = useState(null);    // existing projects, for the picker
  const [projPick, setProjPick] = useState("");      // "" = start a new project for this doc
  const ed = useRef(null);
  const scroller = useRef(null);                     // the editor scroll container (the page scrolls inside it)
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
    const html = ed.current ? ed.current.innerHTML : htmlRef.current;
    const sourceRecords = {};
    sources.forEach(s => { if (window.NPJ.SOURCES[s.key]) sourceRecords[s.key] = window.NPJ.SOURCES[s.key]; });
    window.NpjDrafts.save(draftId, { html, title, slug: fileSlug, tags, column, sources, citeOrder: citeOrderRef.current, sourceRecords, room });
    saveTimer.current = null;
  }, [draftId, title, fileSlug, tags, column, sources, room]);
  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; });
  const scheduleSave = useCallback(() => {
    if (!restored.current) return;
    if (ed.current) htmlRef.current = ed.current.innerHTML;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 500);
  }, [persist]);
  // leaving the editor (sign-out, route change) with a save still in its
  // debounce window? write it now — those last keystrokes used to be lost
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); try { persistRef.current(); } catch (e) {} }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let d = null;
      try { d = await window.NpjDrafts.restore(draftId); } catch (e) {}
      if (alive && d) {
        if (d.sourceRecords) Object.assign(window.NPJ.SOURCES, d.sourceRecords); // rehydrate source cards
        if (ed.current && d.html) {
          ed.current.innerHTML = d.html;
          // older drafts predate the dek — every article gets the field
          if (!ed.current.querySelector(".nr-dek")) {
            const h1 = ed.current.querySelector("h1");
            if (h1) { const p = document.createElement("p"); p.className = "nr-dek"; p.setAttribute("data-ph", DEK_PH); p.innerHTML = "<br/>"; h1.after(p); }
          }
        }
        if (d.title) setTitle(d.title);
        if (typeof d.slug === "string") setFileSlug(d.slug);
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

  useEffect(() => { if (session) window.NpjDrafts.flush(draftId); }, [session, draftId]); // push local-only work up after sign-in
  useEffect(() => { scheduleSave(); }, [title, fileSlug, tags, column, sources, room, scheduleSave]);

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
    // media census: every figure with a filled image slot or an embed.
    // Figures get a stable data-mid so the rail/viewer can jump to them.
    const found = [];
    Array.from(ed.current.querySelectorAll("figure")).forEach((f, i) => {
      if (!f.dataset.mid) f.dataset.mid = "m" + Date.now().toString(36) + i;
      const slot = f.querySelector("image-slot");
      const url = slot ? (slot.url || slot.getAttribute("src")) : null;
      const embed = f.getAttribute("data-embed-url");
      const cap = f.querySelector("figcaption");
      const caption = cap ? (cap.textContent || "").trim() : (f.classList.contains("nr-banner") ? "banner" : "");
      if (url) found.push({ kind: "image", url, mid: f.dataset.mid, caption });
      else if (embed) found.push({ kind: "embed", url: embed, mid: f.dataset.mid, caption });
    });
    setMedia(found);
  }, []);
  useEffect(() => { const t = setTimeout(scanHeadings, 60); return () => clearTimeout(t); }, [scanHeadings]);

  const scrollToId = (id) => {
    const cont = scroller.current, body = ed.current; if (!cont || !body) return;
    const el = body.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
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
  const imageFigure = (id) => `<figure contenteditable="false" class="cmp-embed"><image-slot id="${id}" shape="rect" placeholder="Drop a photo or an archive.org link" style="width:100%;height:280px;display:block"></image-slot><figcaption class="np-mono" style="font-size:11px;color:${NR.muted};margin-top:4px">photo · drag an image or an archive.org link, then caption &amp; credit</figcaption></figure><p><br/></p>`;
  const insertImage = () => insertHTML(imageFigure("img-" + Date.now()));

  // ---- images come in by paste/drop too ----
  // A figure can't live inside the headline or the dek — if the caret is in
  // one, step the insertion point past that block first.
  const escapeBlock = () => {
    const s = window.getSelection(); const n = s && s.anchorNode; if (!n) return;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const block = el && el.closest && el.closest("h1,h2,h3,.nr-dek,figure");
    if (block && ed.current && ed.current.contains(block) && block !== ed.current) {
      const r = document.createRange(); r.setStartAfter(block); r.collapse(true);
      s.removeAllRanges(); s.addRange(r);
    }
  };
  // Pasted/dropped image files land as regular image figures. When the image
  // was copied off the web WITH an archive.org URL in the html flavor, the
  // durable CDN link wins over the raw bytes.
  const insertImageFiles = (files, archiveUrl) => {
    escapeBlock();
    files.forEach((f, i) => {
      const id = "img-" + Date.now().toString(36) + "-" + i;
      insertHTML(imageFigure(id));
      const el = ed.current && ed.current.querySelector("#" + id);
      if (!el) return;
      if (archiveUrl && files.length === 1) el.ingestUrl(archiveUrl);
      else el.ingestFile(f);
    });
  };

  // ---- text comes in clean ----
  // Paste (and text dragged in from elsewhere) is rebuilt from text/plain via
  // NpjPlainText, so the source page's fonts/colors/backgrounds never land in
  // the draft. Drags that START here keep the browser's native move/copy —
  // the content is already clean.
  const dragFromSelf = useRef(false);
  const onPaste = (e) => {
    const cd = e.clipboardData; if (!cd) return;
    e.preventDefault();
    const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) {
      let archiveUrl = null;
      const html = cd.getData("text/html") || "";
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m && window.NpjArchiveCDN.isMediaUrl(m[1])) archiveUrl = m[1];
      insertImageFiles(files, archiveUrl);
      return;
    }
    const text = cd.getData("text/plain");
    if (!text) return;
    if (/\n/.test(text)) escapeBlock(); // block-level paste never lands inside a headline or the dek
    window.NpjPlainText.insert(text);
    scanHeadings(); scheduleSave();
  };
  const caretToPoint = (e) => {
    let r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); } }
    if (r && ed.current && ed.current.contains(r.startContainer)) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  };
  const onDropText = (e) => {
    if (dragFromSelf.current || !e.dataTransfer) return; // internal rearrange — native handles it
    e.preventDefault(); // never let the browser insert the formatted flavor (or navigate to a dropped file)
    const files = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) { caretToPoint(e); insertImageFiles(files, null); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) return; // non-image files have no home here
    const text = e.dataTransfer.getData("text/plain");
    if (!text) return;
    caretToPoint(e);
    if (/\n/.test(text)) escapeBlock();
    window.NpjPlainText.insert(text);
    scanHeadings(); scheduleSave();
  };

  // image slots mutate themselves (src attribute, local fills) — onInput
  // never fires for that, so re-scan the media census and save on their event
  useEffect(() => {
    const el = ed.current; if (!el) return;
    const f = () => { scanHeadings(); scheduleSave(); };
    el.addEventListener("image-slot-change", f);
    return () => el.removeEventListener("image-slot-change", f);
  }, [scanHeadings, scheduleSave]);

  // media viewer keyboard: esc closes, arrows move
  const mediaImages = media.filter(m => m.kind === "image");
  useEffect(() => {
    if (viewer == null) return;
    const f = (e) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowLeft") setViewer(v => Math.max(0, v - 1));
      else if (e.key === "ArrowRight") setViewer(v => Math.min(mediaImages.length - 1, v + 1));
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [viewer, mediaImages.length]);
  const scrollToFigure = (mid) => {
    const cont = scroller.current, body = ed.current; if (!cont || !body) return;
    const el = body.querySelector('figure[data-mid="' + mid + '"]'); if (!el) return;
    const cr = cont.getBoundingClientRect(), er = el.getBoundingClientRect();
    cont.scrollTop += (er.top - cr.top) - 18;
  };

  // ---- rich formatting (toolbar additions) ----
  const wrapInline = (tag) => {
    const r = selRange.current; if (!r || r.collapsed) return;
    const el = document.createElement(tag);
    try { r.surroundContents(el); } catch (e) { const frag = r.extractContents(); el.appendChild(frag); r.insertNode(el); }
    window.getSelection().removeAllRanges(); setRev(v => v + 1); scheduleSave();
  };
  const applyHighlight = () => {
    ed.current && ed.current.focus(); restore();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    try { document.execCommand("hiliteColor", false, "rgba(255,236,1,.45)"); } catch (e) { document.execCommand("backColor", false, "rgba(255,236,1,.45)"); }
    scheduleSave();
  };
  const applyColor = (c) => {
    ed.current && ed.current.focus(); restore();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    document.execCommand("foreColor", false, c);
    setFmtMenu(null); scheduleSave();
  };
  const insertEmbed = () => {
    const u = embedUrl.trim(); if (!/^https?:\/\//.test(u)) return;
    let host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
    const esc = u.replace(/"/g, "&quot;");
    const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
    const vm = u.match(/vimeo\.com\/(\d+)/);
    let inner;
    if (yt) inner = `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`;
    else if (vm) inner = `<iframe src="https://player.vimeo.com/video/${vm[1]}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`;
    else if (/\.(mp3|ogg|wav|m4a)(\?|$)/i.test(u)) inner = `<audio controls src="${esc}" style="width:100%"></audio>`;
    else if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) inner = `<video controls src="${esc}" style="width:100%;max-height:420px;background:#000"></video>`;
    else inner = `<a href="${esc}" target="_blank" rel="noopener">${host || esc}</a>`;
    insertHTML(`<figure contenteditable="false" class="cmp-embed" data-embed-url="${esc}">${inner}<figcaption class="np-mono" style="font-size:11px;color:${NR.muted};margin-top:4px">${host || "media"} · embedded — the published article keeps the link</figcaption></figure><p><br/></p>`);
    setEmbedUrl(""); setFmtMenu(null);
  };
  // a numbered footnote: marker in the text, a markdown-ready definition at the end
  const insertFootnote = () => {
    const n = (ed.current ? ed.current.querySelectorAll("sup[data-fn]").length : 0) + 1;
    insertHTML(`<sup class="md-cite" data-fn="1" data-cite="fn${n}" contenteditable="false" title="footnote ${n}">fn${n}</sup>&nbsp;`);
    if (ed.current) { const p = document.createElement("p"); p.textContent = `[^fn${n}]: footnote text…`; ed.current.appendChild(p); }
    setFmtMenu(null); scheduleSave();
  };
  const insertVerse = () => { insertHTML(`<pre class="verse">Write the verse here —\nline breaks hold,\nstanzas keep their shape.</pre><p><br/></p>`); setFmtMenu(null); };
  const insertPoll = () => {
    insertHTML(`<div class="cmp-widget" data-widget="poll"><div class="cmp-widget-h"><span class="np-mono">◳ POLL</span><span class="cmp-tag">placeholder · interactive at publish</span></div><div class="cmp-widget-b"><strong>Ask the readers a question…</strong><span>Option one</span><br/><span>Option two</span></div><div class="cmp-widget-f">readers vote on the published page; results stay public</div></div><p><br/></p>`);
    setFmtMenu(null);
  };

  // ---- floating selection toolbar: format + link/jumplink + source ----
  const [sel, setSel] = useState(null);
  const [menu, setMenu] = useState(null); // 'src' | 'link'
  const [srcQuery, setSrcQuery] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fmtMenu, setFmtMenu] = useState(null); // 'color' | 'align' | 'embed' | 'more'
  const [embedUrl, setEmbedUrl] = useState("");
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
  // the span to bind: the live in-editor selection if there is one, else the
  // last one we saved — a collapsed caret is never a span
  const spanRange = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && !s.isCollapsed && ed.current && ed.current.contains(s.anchorNode) && ed.current.contains(s.focusNode)) return s.getRangeAt(0);
    if (selRange.current && !selRange.current.collapsed && ed.current && ed.current.contains(selRange.current.commonAncestorContainer)) return selRange.current;
    return null;
  };
  // Bind a source to a span. With words selected it binds right away. With
  // nothing selected it ARMS the source instead of failing silently: the next
  // selection you make in the page binds to it (see the effect below). So
  // "pick the source, then grab its exact words" works as well as the reverse.
  const bindSource = (key) => {
    const r = spanRange();
    if (!r) { setArmSrc(key); setMenu(null); return; }
    let order = citeOrderRef.current;
    if (order.indexOf(key) < 0) { order = [...order, key]; citeOrderRef.current = order; setCiteOrder(order); }
    const num = order.indexOf(key) + 1;
    const span = document.createElement("span"); span.className = "claim-src"; span.setAttribute("data-src", key);
    try { r.surroundContents(span); } catch (e) { const frag = r.extractContents(); span.appendChild(frag); r.insertNode(span); }
    const sup = document.createElement("sup"); sup.className = "md-cite"; sup.setAttribute("contenteditable", "false"); sup.setAttribute("data-cite", key); sup.title = key; sup.textContent = num;
    span.after(sup);
    if (!sources.find(x => x.key === key)) setSources(s => [{ key, archived: !!(window.NPJ.SOURCES[key] && window.NPJ.SOURCES[key].archive_url) }, ...s]);
    window.getSelection().removeAllRanges(); selRange.current = null; setSel(null); setMenu(null); setSrcUrl(""); setArmSrc(null); setRev(v => v + 1); scheduleSave();
  };
  // armed + a fresh selection just landed → bind it to the armed source
  // (layout effect so it binds before the floating toolbar can paint)
  React.useLayoutEffect(() => { if (armSrc && sel) bindSource(armSrc); }, [sel, armSrc]); // eslint-disable-line
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
      return { key, archived: false, snapshotting: true, url: u };
    });
    setSources(s => [...made, ...s]); setUrlInput("");
    // real snapshots: confirm an existing wayback capture, or request one and
    // wait for the availability API to verify it — "archived" is a fact here
    Promise.all(made.map(async m => {
      const snap = await window.NpjArchiveCDN.ensureSnapshot(m.url).catch(() => null);
      if (snap) window.NPJ.SOURCES[m.key].archive_url = snap;
      setSources(s => s.map(x => x.key === m.key ? { ...x, snapshotting: false, archived: !!snap } : x));
    })).then(() => setBusy(false));
  };
  // the consented archive action (ArchiveModal) — request + verify for real;
  // a source with no original URL (an uploaded file) can't be auto-archived
  const onArchived = async (key) => {
    const rec = window.NPJ.SOURCES[key];
    setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: true } : x));
    const snap = rec && rec.original_url ? await window.NpjArchiveCDN.ensureSnapshot(rec.original_url).catch(() => null) : null;
    if (snap) rec.archive_url = snap;
    setSources(s => s.map(x => x.key === key ? { ...x, snapshotting: false, archived: !!snap } : x));
  };
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

  // ---- Matrix: projects (shared rooms) + invites ----
  // A project is one Matrix room that can hold many documents; everyone invited
  // to the project can work on every document attached to it. A document joins
  // a project on first invite — either a brand-new project or an existing one.
  useEffect(() => {
    if (!invite || !session || projects) return;
    let alive = true;
    (async () => {
      try { const list = await window.MatrixAuth.listDrafts(); if (alive) setProjects(list || []); }
      catch (e) { if (alive) setProjects([]); }
    })();
    return () => { alive = false; };
  }, [invite, session, projects]);

  const doInvite = async () => {
    const raw = inviteVal.trim(); if (!raw) return;
    if (!session) { setInviteMsg("Sign in with Matrix to invite collaborators."); return; }
    const id = window.MatrixAuth.parseMxid(raw);
    if (!id) { setInviteMsg("Use a full Matrix ID: @name:server"); return; }
    setInviteMsg("Inviting …");
    try {
      let rm = room;
      if (!rm) {
        const existing = projPick && (projects || []).find(p => p.roomId === projPick);
        if (existing) rm = { roomId: existing.roomId, title: existing.title || "Untitled project" };
        else { const made = await window.MatrixAuth.createDraftRoom(title || "Untitled draft"); rm = { ...made, title: title || "Untitled draft" }; }
        setRoom(rm);
      }
      await window.MatrixAuth.invite(rm.roomId, id.mxid);
      setCollabs(c => c.includes(id.mxid) ? c : [...c, id.mxid]);
      setInviteVal(""); setInviteMsg("Invited " + id.mxid + " into the project — they can work on every document in it.");
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

  const TB = ({ onClick, children, title }) => <button onMouseDown={e => e.preventDefault()} onClick={onClick} title={title} className="np-cond" style={{ background: "transparent", border: 0, color: NR.text, padding: "5px 9px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{children}</button>;
  const Sep = () => <span style={{ width: 1, height: 18, background: NR.line, margin: "0 5px" }} />;
  const popStyle = { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 8 };
  const popItem = { display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--rule)", padding: "8px 6px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" };
  const FB = ({ onClick, children, hot, title }) => <button title={title} onMouseDown={e => e.preventDefault()} onClick={onClick} style={{ background: hot ? "var(--yellow)" : "transparent", color: hot ? "var(--ink)" : "#e3ddcc", border: 0, padding: "5px 9px", fontSize: 13, fontWeight: 700, fontFamily: "var(--cond)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</button>;

  return (
    <div className={"newsroom fade-in" + (theme === "light" ? " nr-light" : "")} style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* top bar */}
      <div style={{ borderBottom: "1.5px solid " + NR.line, padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={onExit} className="np-cond" style={{ background: "none", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <I.arrow style={{ fontSize: 14, transform: "rotate(180deg)" }} /> Public site
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onDocs || onExit} title="Newsroom home — your document explorer" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10 }}>
            <I.lock style={{ fontSize: 18, color: "var(--yellow)" }} />
            <span style={{ fontFamily: "var(--display)", fontSize: 20, color: NR.text }}>NEWSROOM</span>
          </button>
          <span className="np-mono" title={fileSlug ? "custom filename — set at the publish gate" : "filename follows the headline — rename it at the publish gate"} style={{ fontSize: 11.5, color: NR.muted }}>{fileSlug || slugify(title) || "untitled"}.jsonl</span>
          <DraftStatusPill id={draftId} signedIn={!!session} user={session && session.user_id}
            what="text, title, tags, column and bound sources" style={{ borderColor: NR.line }} />
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={toggleTheme} title={theme === "dark" ? "Switch the newsroom to light mode" : "Switch the newsroom to dark mode"} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {theme === "dark" ? <I.sun style={{ fontSize: 13 }} /> : <I.moon style={{ fontSize: 13 }} />} {theme === "dark" ? "Light" : "Dark"}
        </button>
        <window.VersionBadge sha="draft" count={versions.length} onClick={() => setShowVersions(true)} dark={theme === "dark"} />
        {onDocs && <button onClick={onDocs} title="All your documents" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.doc style={{ fontSize: 13 }} /> Docs</button>}
        <div style={{ position: "relative" }}>
          <button onClick={openRooms} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 13 }} /> Projects</button>
          {showRooms && <ProjectsMenu rooms={rooms} onClose={() => setShowRooms(false)} signedIn={!!session} />}
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setInvite(v => !v)} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 6 }}><I.plus style={{ fontSize: 13 }} /> Invite</button>
          {invite && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300, maxWidth: "calc(100vw - 24px)", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(0,0,0,.3)", padding: 12, zIndex: 30 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Invite to the project</div>
              <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 8, lineHeight: 1.45 }}>A project can hold many documents — everyone invited works on all of them.</div>
              {room
                ? <div className="np-mono" style={{ fontSize: 10.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}><I.folder style={{ fontSize: 12, flex: "0 0 auto" }} /> <span style={{ fontWeight: 600 }}>{room.title || title || "Untitled project"}</span></div>
                : (projects && projects.length > 0 && (
                    <select value={projPick} onChange={e => setProjPick(e.target.value)} className="np-cond" style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", padding: "6px", fontSize: 13, marginBottom: 8 }}>
                      <option value="">New project · “{title || "Untitled"}”</option>
                      {projects.map(p => <option key={p.roomId} value={p.roomId}>Add to: {p.title || p.roomId}</option>)}
                    </select>
                  ))}
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
          {collabs.slice(0, 4).map((e, i) => { const p = window.NPJ.PEOPLE[e] || { name: e.replace(/^@/, ""), color: "#888" }; return <span key={e + i} title={p.name} style={{ width: 26, height: 26, borderRadius: "50%", background: p.color, color: "#fff", border: "2px solid " + NR.bg, marginLeft: i ? -8 : 0, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{(p.name || "?")[0].toUpperCase()}</span>; })}
        </div>
        <button onClick={() => canPub ? setPublish({ step: 0 }) : null} disabled={!canPub} title={canPub ? "Publish" : "Only an admin or assigned column publisher can publish"} className="np-cond" style={{ background: canPub ? "var(--yellow)" : "transparent", color: canPub ? "var(--ink)" : NR.muted, border: "1.5px solid " + (canPub ? "var(--ink)" : NR.line), padding: "7px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: canPub ? "pointer" : "not-allowed" }}>
          <I.lock style={{ fontSize: 14 }} /> Publish
        </button>
      </div>

      {/* formatting toolbar */}
      <div style={{ borderBottom: "1px solid " + NR.line, padding: "7px 20px", display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: NR.muted, marginRight: 6 }}>Format</span>
        <TB onClick={() => exec("undo")} title="Undo">↶</TB>
        <TB onClick={() => exec("redo")} title="Redo">↷</TB>
        <Sep />
        <TB onClick={() => exec("formatBlock", "<h1>")} title="Title">H1</TB>
        <TB onClick={() => exec("formatBlock", "<h2>")} title="Heading">H2</TB>
        <TB onClick={() => exec("formatBlock", "<h3>")} title="Subheading">H3</TB>
        <TB onClick={() => exec("formatBlock", "<p>")} title="Body text">¶</TB>
        <Sep />
        <TB onClick={() => exec("bold")} title="Bold"><b>B</b></TB>
        <TB onClick={() => exec("italic")} title="Italic"><i>I</i></TB>
        <TB onClick={() => exec("strikeThrough")} title="Strikethrough"><s>S</s></TB>
        <TB onClick={() => wrapInline("code")} title="Inline code"><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{"</>"}</span></TB>
        <TB onClick={applyHighlight} title="Highlight"><span style={{ background: "var(--yellow)", color: "var(--ink)", padding: "0 4px", fontWeight: 700 }}>A</span></TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "color" ? null : "color")} title="Text color"><span style={{ borderBottom: "3px solid var(--reject)", fontWeight: 700 }}>A</span> ▾</TB>
          {fmtMenu === "color" && (
            <div style={{ ...popStyle, width: 168 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Text color</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["#b23a26", "#2b5f8a", "#1f6f4a", "#9a6a12", "#e3ddcc"].map(c => (
                  <button key={c} onMouseDown={e => e.preventDefault()} onClick={() => applyColor(c)} title={c}
                    style={{ width: 26, height: 26, background: c, border: "1.5px solid var(--ink)", cursor: "pointer" }} />
                ))}
              </div>
              <button onMouseDown={e => e.preventDefault()} onClick={() => { exec("removeFormat"); setFmtMenu(null); }} className="np-mono" style={{ marginTop: 8, width: "100%", border: "1px dashed var(--rule-strong)", background: "transparent", fontSize: 10.5, padding: "5px", cursor: "pointer" }}>clear color &amp; marks</button>
            </div>
          )}
        </div>
        <Sep />
        <TB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote">“”</TB>
        <TB onClick={() => exec("insertUnorderedList")} title="Bulleted list">•</TB>
        <TB onClick={() => exec("insertOrderedList")} title="Numbered list">1.</TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "align" ? null : "align")} title="Alignment">≡ ▾</TB>
          {fmtMenu === "align" && (
            <div style={{ ...popStyle, width: 150 }}>
              {[["justifyLeft", "Align left"], ["justifyCenter", "Center"], ["justifyRight", "Align right"]].map(([cmd, label]) => (
                <button key={cmd} onMouseDown={e => e.preventDefault()} onClick={() => { exec(cmd); setFmtMenu(null); }} style={popItem}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <TB onClick={() => exec("insertHorizontalRule")} title="Divider">—</TB>
        <Sep />
        <TB onClick={insertImage} title="Inline image"><I.archive style={{ fontSize: 14, verticalAlign: "-2px" }} /> Image</TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "embed" ? null : "embed")} title="Embed video, audio or a link card">▶ Embed</TB>
          {fmtMenu === "embed" && (
            <div style={{ ...popStyle, width: 280 }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>Embed media</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus value={embedUrl} onChange={e => setEmbedUrl(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === "Enter" && insertEmbed()} placeholder="YouTube, Vimeo, .mp3, .mp4, URL…" className="np-mono" style={{ flex: 1, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "7px 8px", fontSize: 11.5, outline: "none" }} />
                <button className="btn btn-sm btn-primary" onClick={insertEmbed}>Add</button>
              </div>
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.4 }}>video &amp; audio play in the draft; the published article keeps the permalink</div>
            </div>
          )}
        </div>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "more" ? null : "more")} title="More blocks">⋯ More ▾</TB>
          {fmtMenu === "more" && (
            <div style={{ ...popStyle, left: "auto", right: 0, width: 190 }}>
              {[
                ["{ }", "Code block", () => { exec("formatBlock", "<pre>"); setFmtMenu(null); }],
                ["—", "Divider", () => { exec("insertHorizontalRule"); setFmtMenu(null); }],
                ["*", "Footnote", insertFootnote],
                ["❝", "Poetry", insertVerse],
                ["◳", "Poll", insertPoll]
              ].map(([g, label, fn]) => (
                <button key={label} onMouseDown={e => e.preventDefault()} onClick={fn} style={popItem}>
                  <span className="np-mono" style={{ width: 22, textAlign: "center", flex: "0 0 auto" }}>{g}</span> {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <span className="np-mono npj-hide-sm" style={{ fontSize: 10.5, color: NR.muted }}>select text → format, link, or bind a source span</span>
      </div>

      {/* mobile tab switcher — one panel at a time; the editor node stays mounted so a draft is never dropped */}
      {isMobile && (
        <div style={{ display: "flex", borderBottom: "1px solid " + NR.line, background: NR.rail }}>
          {[["write", "Write"], ["contents", "Contents" + (toc.length ? " · " + toc.length : "")], ["sources", "⊥ Sources · " + sources.length]].map(([k, label]) => (
            <button key={k} onClick={() => setMTab(k)} className="np-cond" style={{ flex: 1, background: mTab === k ? "var(--yellow)" : "transparent", color: mTab === k ? "var(--ink)" : NR.text, border: 0, borderRight: "1px solid " + NR.line, padding: "11px 6px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      )}

      {/* body: contents · editor · sources (stacks to one tabbed column on mobile) */}
      <div style={{ flex: 1, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateColumns: isMobile ? undefined : "200px 1fr 340px" }}>
        {/* contents / jumplinks */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "contents" ? "block" : "none") : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 12px 30px", background: NR.rail, borderRight: isMobile ? 0 : "1.5px solid " + NR.line }}>
          <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 10 }}>Contents</div>
          {toc.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Add H1/H2/H3 headings and they'll show here as jump-links.</div>}
          {toc.map(h => (
            <button key={h.id} onClick={() => scrollToId(h.id)} className="np-cond" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, color: h.level === 1 ? NR.text : NR.soft, padding: "4px 0 4px " + ((h.level - 1) * 10) + "px", fontSize: h.level === 1 ? 14 : 13, fontWeight: h.level === 1 ? 700 : 500, cursor: "pointer", lineHeight: 1.2 }}>{h.text}</button>
          ))}
          {/* media census — every image/embed in the piece; images open the viewer */}
          <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Media · {media.length}</div>
            {media.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Images and embeds in the piece collect here. Paste an image straight into the page.</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {media.map(m => m.kind === "image"
                ? <button key={m.mid} title={(m.caption || "image") + " — open the viewer"} onClick={() => setViewer(Math.max(0, mediaImages.findIndex(x => x.mid === m.mid)))} style={{ width: 44, height: 44, padding: 0, border: "1px solid " + NR.line, background: NR.field, cursor: "zoom-in", overflow: "hidden" }}>
                    <img src={m.url} alt={m.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </button>
                : <button key={m.mid} title={(m.caption || m.url) + " — show in document"} onClick={() => scrollToFigure(m.mid)} style={{ width: 44, height: 44, border: "1px solid " + NR.line, background: NR.field, color: NR.soft, cursor: "pointer", fontSize: 15 }}>▶</button>)}
            </div>
          </div>
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

        {/* editor — the draft renders as a bordered page on the canvas; the page
            (not the canvas) is the contentEditable, so the document border wraps
            banner, headline and body as one sheet */}
        <div className="np-scroll" ref={scroller} style={{ display: isMobile && mTab !== "write" ? "none" : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: isMobile ? "14px 10px 40px" : "26px 32px 60px", background: NR.bg, borderRight: isMobile ? 0 : "1.5px solid " + NR.line, minHeight: 0 }}>
          <div className={"md-preview nr-page" + (armSrc ? " nr-arming" : "")} ref={ed} contentEditable suppressContentEditableWarning onInput={() => { scanHeadings(); scheduleSave(); }} onClick={onBodyClick}
            onPaste={onPaste} onDrop={onDropText}
            onDragStart={() => { dragFromSelf.current = true; }} onDragEnd={() => { dragFromSelf.current = false; }}
            style={{ color: NR.text, outline: "none" }}
            dangerouslySetInnerHTML={{ __html: START_DOC }} />
        </div>

        {/* sources */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "sources" ? "block" : "none") : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 16px 40px", background: NR.panel }}>
          <div className="np-eyebrow" style={{ color: NR.muted, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}><I.source style={{ fontSize: 14 }} /> Sources · {sources.length}</div>
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
            <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 8, lineHeight: 1.5 }}>Sourcing is manual: select the exact words, then bind a source — or hit <b>Cite span</b> on a source and grab the words next. One source can back several spans.</div>
          </div>

          {sources.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6, padding: "0 2px" }}>No sources yet. Ingest a URL or upload a document, then highlight a claim and bind it.</div>}
          {sources.map(s => {
            const rec = window.NPJ.SOURCES[s.key] || { id: s.key, title: s.key, outlet: "" };
            const n = citeNum(s.key); const cnt = spanCount(s.key); void rev;
            return (
              <div key={s.key} style={{ border: "1px solid " + NR.line, padding: "9px 10px", marginBottom: 8, background: NR.field }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  {n > 0 && <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{n}</span>}
                  {s.snapshotting ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn, display: "inline-flex", alignItems: "center", gap: 4 }}><Spinner /> snapshotting</span>
                    : s.archived ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.ok }}>● archived</span>
                    : <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn }}>● snapshot only</span>}
                  <span style={{ flex: 1 }} />
                  {cnt > 0 && <span className="np-mono" style={{ fontSize: 9.5, color: NR.soft }}>{cnt} span{cnt !== 1 ? "s" : ""}</span>}
                </div>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.1, color: NR.text }}>{rec.title}</div>
                <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 2 }}>{rec.outlet}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onMouseDown={e => e.preventDefault()} onClick={() => bindSource(s.key)} disabled={s.snapshotting}
                    title="Select the words this source backs, then click — or click first and grab the words next"
                    className="np-cond" style={{ flex: 1, background: armSrc === s.key ? "var(--yellow)" : "transparent", border: "1px solid " + (armSrc === s.key ? "var(--yellow)" : NR.line), color: armSrc === s.key ? "var(--ink)" : NR.text, padding: "4px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>{armSrc === s.key ? "Grab the words…" : "Cite span"}</button>
                  {!s.archived && !s.snapshotting && <button onClick={() => setArchiveTarget(s)} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.warn, color: NR.warn, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>Archive</button>}
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
          <FB hot={menu === "src"} onClick={() => setMenu(menu === "src" ? null : "src")} title="Bind a source to this span — the claim stands on it"><I.source style={{ fontSize: 13 }} /> Source</FB>

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
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}><I.source style={{ fontSize: 13 }} /> Bind this span to a source</div>
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

      {/* armed: a source is waiting for you to grab the words it backs */}
      {armSrc && (
        <div className="fade-in" style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 4300, maxWidth: "92vw", background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--yellow)", boxShadow: "0 12px 30px rgba(0,0,0,.5)", display: "flex", alignItems: "center", gap: 12, padding: "9px 12px 9px 15px" }}>
          <span className="np-mono" style={{ fontSize: 11.5, color: "var(--yellow)", flex: "0 0 auto" }}><I.source style={{ fontSize: 13, verticalAlign: "-2px" }} /> Citing</span>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(window.NPJ.SOURCES[armSrc] || {}).title || armSrc}</span>
          <span className="np-mono npj-hide-sm" style={{ fontSize: 11, opacity: .82, flex: "0 0 auto" }}>— select the exact words it backs</span>
          <button onClick={() => setArmSrc(null)} className="np-cond" style={{ flex: "0 0 auto", background: "transparent", color: "var(--paper)", border: "1px solid rgba(255,255,255,.3)", padding: "4px 10px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Cancel</button>
        </div>
      )}

      {/* the media viewer — images full-size, with caption, count and jump-to-figure */}
      {viewer != null && mediaImages[viewer] && (
        <div className="fade-in" onClick={() => setViewer(null)} style={{ position: "fixed", inset: 0, zIndex: 5600, background: "rgba(8,7,5,.93)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 26 }}>
          <img src={mediaImages[viewer].url} alt={mediaImages[viewer].caption || ""} onClick={e => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "76vh", objectFit: "contain", border: "1.5px solid rgba(255,255,255,.25)", background: "#000" }} />
          <div className="np-mono" onClick={e => e.stopPropagation()} style={{ color: "#cfc8b6", fontSize: 11.5, marginTop: 12, maxWidth: 720, textAlign: "center", lineHeight: 1.5 }}>
            {mediaImages[viewer].caption || "untitled image"} · {viewer + 1} / {mediaImages.length}
          </div>
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {[["← Prev", () => setViewer(v => Math.max(0, v - 1)), viewer === 0],
              ["Show in document", () => { scrollToFigure(mediaImages[viewer].mid); setViewer(null); }, false],
              ["Next →", () => setViewer(v => Math.min(mediaImages.length - 1, v + 1)), viewer === mediaImages.length - 1],
              ["Close · esc", () => setViewer(null), false]].map(([label, fn, off]) => (
              <button key={label} onClick={fn} disabled={off} className="np-cond" style={{ background: "transparent", color: off ? "rgba(216,211,196,.35)" : "#e3ddcc", border: "1px solid rgba(255,255,255,.25)", padding: "7px 13px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", cursor: off ? "default" : "pointer" }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {showVersions && <window.VersionHistory versions={versions} onClose={() => setShowVersions(false)} />}
      {archiveTarget && <ArchiveModal items={[{ name: (window.NPJ.SOURCES[archiveTarget.key] || {}).title || archiveTarget.key }]} onClose={() => setArchiveTarget(null)} onDone={() => { onArchived(archiveTarget.key); setArchiveTarget(null); }} />}
      {publish && <PublishOverlay publish={publish} setPublish={setPublish} onClose={() => setPublish(null)} onPublished={onPublished} sources={sources} title={title} session={session}
        customSlug={fileSlug} onSlug={setFileSlug}
        getContent={() => ({ html: ed.current ? ed.current.innerHTML : "", title, tags, column, sources })} />}
    </div>
  );
}

/* server-recovered projects — solves "switched browser, can't find my work".
   A project = one shared Matrix room that can hold many documents; its invitees
   are shared by every document attached to it. */
function ProjectsMenu({ rooms, onClose, signedIn }) {
  const projects = (() => {
    if (!rooms || rooms.loading) return [];
    const seen = {}; const out = [];
    (rooms.drafts || []).forEach(d => { if (!seen[d.roomId]) { seen[d.roomId] = 1; out.push({ roomId: d.roomId, title: d.title, topic: "" }); } });
    (rooms.joined || []).forEach(r => { if (r.kind !== "control" && !seen[r.roomId]) { seen[r.roomId] = 1; out.push({ roomId: r.roomId, title: r.name, topic: r.topic || "" }); } });
    return out;
  })();
  return (
    <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxWidth: "calc(100vw - 24px)", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "5px 5px 0 rgba(0,0,0,.3)", padding: 12, zIndex: 30, maxHeight: 360, overflowY: "auto" }} className="np-scroll">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 5 }}><I.folder style={{ fontSize: 13 }} /> Your projects · from Matrix</span>
        <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 14 }}><I.x /></button>
      </div>
      <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 10, lineHeight: 1.5 }}>A project holds any number of documents and shares one set of invitees. Recovered straight from the homeserver — not this browser — so wipe or switch devices and they're still here after you sign in.</div>
      {!signedIn && <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)" }}>Sign in with Matrix to see your projects.</div>}
      {signedIn && (!rooms || rooms.loading) && <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", display: "inline-flex", gap: 6, alignItems: "center" }}><Spinner /> loading from server…</div>}
      {signedIn && rooms && !rooms.loading && (
        <React.Fragment>
          {projects.map(p => (
            <div key={p.roomId} style={{ borderBottom: "1px solid var(--rule)", padding: "6px 2px" }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><I.folder style={{ fontSize: 12, flex: "0 0 auto", color: "var(--ink-soft)" }} /> {p.title}</div>
              {p.topic && <div style={{ fontFamily: "var(--serif)", fontSize: 11.5, color: "var(--ink-soft)" }}>{p.topic}</div>}
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{p.roomId}</div>
            </div>
          ))}
          {projects.length === 0 && <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)" }}>No projects yet. Invite a collaborator and a project is created for this document.</div>}
          {rooms.error && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", marginTop: 6 }}>{rooms.error}</div>}
        </React.Fragment>
      )}
    </div>
  );
}

function Spinner() { return <span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px" }} />; }

/* The publish boundary is real: nothing fires until the author confirms, every
   step reports what actually happened, and a failed step stops the run — no
   checkmark is ever painted on something that didn't succeed. */
function PublishOverlay({ publish, setPublish, onClose, onPublished, sources, title, session, getContent, customSlug, onSlug }) {
  // the filename is the author's call — it follows the headline until they
  // rename it at the gate, and a custom name sticks with the draft
  const auto = slugify(title) || "untitled";
  const [slugVal, setSlugVal] = useState(customSlug || auto);
  const slug = slugify(slugVal) || "untitled";
  const articleUrl = window.npjArticleUrl(slug);
  const editSlug = (v) => { setSlugVal(v); if (onSlug) { const s = slugify(v); onSlug(!s || s === auto ? "" : s); } };

  // preflight — measured from the actual draft, shown to the author at the gate
  const flight = useMemo(() => {
    const c = (getContent ? getContent() : null) || { html: "", title };
    const root = document.createElement("div"); root.innerHTML = c.html || "";
    const dekEl = root.querySelector(".nr-dek");
    const dek = dekEl ? (dekEl.textContent || "").trim() : "";
    const text = (root.innerText || "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    const cites = Array.from(root.querySelectorAll("sup.md-cite[data-cite]")).filter(n => !n.hasAttribute("data-fn"));
    const missing = [];
    cites.forEach(n => {
      const k = n.getAttribute("data-cite");
      const rec = window.NPJ.SOURCES[k];
      if ((!rec || !(rec.archive_url || rec.original_url)) && missing.indexOf(k) < 0) missing.push(k);
    });
    const archived = (sources || []).filter(s => s.archived || ((window.NPJ.SOURCES[s.key] || {}).archive_url)).length;
    return { content: c, dek, words, spans: cites.length, missing, srcTotal: (sources || []).length, archived };
  }, []);

  const [phase, setPhase] = useState("confirm");          // confirm | run
  const [outcome, setOutcome] = useState(null);           // null | {ok:true} | {ok:false,msg}
  const [steps, setSteps] = useState(() => ([
    { code: "EVA", label: "Pull the finished piece", detail: "draft → EO event (INS — the genesis line)", state: "wait" },
    { code: "SEG", label: "Build: resolve every bound span", detail: flight.spans + " bound span" + (flight.spans === 1 ? "" : "s") + " to check", state: "wait" },
    { code: "INS", label: "Sources archived on archive.org", detail: flight.srcTotal ? flight.archived + " of " + flight.srcTotal + " archived" : "no sources bound", state: "wait", sources: true },
    { code: "DEF", label: "Commit the EO event log to GitHub", detail: "→ clovenbradshaw-ctrl/npj · articles/" + slug + ".jsonl", state: "wait" },
    { code: "REC", label: "Live & open to suggestion", detail: articleUrl, state: "wait" }
  ]));
  const published = useRef(null); // the folded article, for "open it" without re-fetching
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const upd = (i, patch) => { if (alive.current) setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s)); };
  const halt = (i, detail, msg) => { upd(i, { state: "fail", detail }); if (alive.current) setOutcome({ ok: false, msg }); };
  const tick = (ms) => new Promise(r => setTimeout(r, ms));

  const run = async () => {
    setPhase("run");
    // the gate may have renamed the file after the steps were initialized
    upd(3, { detail: "→ clovenbradshaw-ctrl/npj · articles/" + slug + ".jsonl" });
    upd(4, { detail: articleUrl });
    // 1 — pull the piece
    upd(0, { state: "active" }); await tick(400);
    if (!flight.words) return halt(0, "the draft is empty", "Write the piece first — there's no text to publish.");
    upd(0, { state: "done", detail: flight.words + " words → articles/" + slug + ".jsonl" });
    // 2 — build: every bound span must resolve to a source record
    upd(1, { state: "active" }); await tick(400);
    if (flight.missing.length) return halt(1, flight.missing.length + " unresolved · build failed",
      flight.missing.length + " bound span" + (flight.missing.length === 1 ? " has" : "s have") + " no source record (" + flight.missing.slice(0, 3).join(", ") + (flight.missing.length > 3 ? "…" : "") + "). Re-bind or remove them, then publish again.");
    upd(1, { state: "done", detail: flight.spans + " span" + (flight.spans === 1 ? "" : "s") + " · 0 unresolved · build passed ✓" });
    // 3 — archive check, against the wayback machine itself: anything without
    // a recorded snapshot gets a live availability lookup, and upgrades stick
    // so the footnotes below cite the archived copy. Snapshot-only cites fall
    // back to their original URL in the .md — a warning, not a wall.
    upd(2, { state: "active", detail: "checking the wayback machine…" });
    let archivedNow = 0;
    await Promise.all((sources || []).map(async s => {
      const rec = window.NPJ.SOURCES[s.key] || {};
      if (rec.archive_url) { archivedNow++; return; }
      if (!rec.original_url) return;
      const snap = await window.NpjArchiveCDN.waybackAvailable(rec.original_url).catch(() => null);
      if (snap) { rec.archive_url = snap; archivedNow++; }
    }));
    upd(2, { state: "done", detail: !flight.srcTotal ? "no sources bound" : archivedNow === flight.srcTotal ? "all " + flight.srcTotal + " verified on archive.org" : archivedNow + " of " + flight.srcTotal + " verified — the rest cite their original URL" });
    // 4 — the actual commit. The piece is serialized NOW (so claims carry any
    // archive URLs found in step 3) into ONE EO event: the INS genesis line of
    // articles/<slug>.jsonl. Every later edit appends to that same file, which
    // makes the log itself the article's complete change history. Authority is
    // re-verified server-side by the webhook.
    upd(3, { state: "active" });
    const actor = (session && session.user_id) || ((window.MatrixAuth.current() || {}).user_id) || null;
    const gen = window.NpjArticles.genesisFromContent(flight.content, { slug, headline: title, actor });
    published.current = gen.article;
    const token = window.MatrixAuth.token();
    if (!token) return halt(3, "no verified Matrix session", "Sign in with your admin Matrix account to publish.");
    let res;
    try {
      res = await window.NpjArticles.publishGenesis({ slug, line: gen.line, token, message: "publish: " + slug });
    } catch (e) { return halt(3, "webhook unreachable", "Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing was committed."); }
    if (res.status === 401) return halt(3, "rejected — not authorized (401)", "That Matrix account isn't authorized to publish.");
    if (!res.ok) return halt(3, "HTTP " + res.status, "The publish webhook answered " + res.status + " — nothing was committed.");
    upd(3, { state: "done", detail: "committed to clovenbradshaw-ctrl/npj · articles/" + slug + ".jsonl" });
    // 5 — live once Pages redeploys (≈ a minute after the commit)
    upd(4, { state: "active" }); await tick(400);
    upd(4, { state: "done" });
    if (alive.current) setOutcome({ ok: true });
  };

  const srcKeys = (sources || []).map(s => s.key);
  const blocked = !flight.words ? "The draft is empty — there's nothing to publish yet."
    : flight.missing.length ? flight.missing.length + " bound span" + (flight.missing.length === 1 ? " has" : "s have") + " no source record — re-bind or remove them before publishing."
    : null;
  const Row = ({ k, children }) => (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid " + NR.line, alignItems: "baseline" }}>
      <span className="np-eyebrow" style={{ color: NR.muted, flex: "0 0 86px" }}>{k}</span>
      <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5, color: NR.text, minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.86)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} className="fade-in">
      {/* the publish boundary is always the dark room — the extra .newsroom class
          re-declares the dark --nr-* vars even when the editor is in light mode */}
      <div className="newsroom" style={{ width: 560, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "var(--nr-field)", border: "1.5px solid var(--yellow)", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}>
        <div style={{ background: "var(--yellow)", color: "var(--ink)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 18 }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21 }}>PUBLISH BOUNDARY</span>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 11 }}>GitHub + archive.org</span>
        </div>

        {phase === "confirm" && (
          <div style={{ padding: "20px 22px" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, color: NR.text, marginBottom: 4 }}>ONE LAST LOOK</div>
            <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5, marginBottom: 12 }}>Nothing has been published yet. This is what goes out the moment you confirm — committed to the public repo and served on GitHub Pages.</div>
            <Row k="File">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <input value={slugVal} onChange={e => editSlug(e.target.value)} placeholder={auto} title="Name the file anything — it doesn't have to match the headline" className="np-mono" spellCheck={false}
                  style={{ width: "min(300px, 56vw)", border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 12, outline: "none" }} />
                <span className="np-mono" style={{ fontSize: 11 }}>.jsonl</span>
                <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>→ clovenbradshaw-ctrl/npj · articles/{slugVal !== slug ? " · saved as " + slug + ".jsonl" : ""}</span>
              </span>
            </Row>
            <Row k="Live at">{articleUrl}</Row>
            <Row k="Subtitle">{flight.dek || "—"}</Row>
            <Row k="Column">{flight.content.column || "—"}</Row>
            <Row k="Tags">{(flight.content.tags || []).length ? flight.content.tags.map(t => "#" + t).join("  ") : "—"}</Row>
            <Row k="Length">{flight.words} words</Row>
            <Row k="Sources">{flight.srcTotal ? flight.srcTotal + " bound · " + flight.archived + " archived" + (flight.srcTotal - flight.archived ? " · " + (flight.srcTotal - flight.archived) + " snapshot-only" : "") : "none"}</Row>
            <Row k="Spans">{flight.spans} cited span{flight.spans === 1 ? "" : "s"}{flight.missing.length ? " · " + flight.missing.length + " unresolved" : ""}</Row>
            {blocked && <div className="np-mono" style={{ fontSize: 11, color: NR.warn, lineHeight: 1.5, margin: "12px 0 0", border: "1px solid " + NR.warn, padding: "9px 10px" }}>{blocked}</div>}
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "10px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>Not yet — back to editor</button>
              <button onClick={blocked ? undefined : run} disabled={!!blocked} className="np-cond" style={{ background: blocked ? "transparent" : "var(--yellow)", color: blocked ? NR.muted : "var(--ink)", border: "1.5px solid " + (blocked ? NR.line : "var(--ink)"), padding: "10px 18px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: blocked ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> Publish it</button>
            </div>
          </div>
        )}

        {phase === "run" && (
          <div style={{ padding: "20px 22px" }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 13, padding: "10px 0", borderBottom: i < steps.length - 1 ? "1px solid " + NR.line : 0, opacity: s.state === "wait" ? .4 : 1, transition: "opacity .3s" }}>
                <span style={{ flex: "0 0 28px", textAlign: "center" }}>
                  {s.state === "done" ? <I.check style={{ fontSize: 18, color: NR.ok }} />
                    : s.state === "fail" ? <I.x style={{ fontSize: 17, color: NR.warn }} />
                    : s.state === "active" ? <Spinner />
                    : <span style={{ fontFamily: "var(--mono)", color: NR.muted }}>{window.NPJ.EO.glyph(s.code)}</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--cond)", fontSize: 16, color: s.state === "fail" ? NR.warn : NR.text, fontWeight: 600 }}>{s.label}</div>
                  <div className="np-mono" style={{ fontSize: 10.5, color: s.state === "fail" ? NR.warn : NR.muted, marginTop: 2, overflowWrap: "anywhere" }}>{s.detail}</div>
                  {s.sources && s.state !== "wait" && srcKeys.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
                      {srcKeys.map((k) => <span key={k} className="np-mono fade-in" style={{ fontSize: 9, padding: "1px 5px", border: "1px solid " + NR.line, color: s.state === "done" ? NR.ok : NR.soft }}>{s.state === "done" ? "✓ " : "↻ "}{k.slice(0, 12)}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {outcome && (
              <div className="fade-in" style={{ marginTop: 16, textAlign: "center" }}>
                {outcome.ok
                  ? <React.Fragment>
                      <div style={{ fontFamily: "var(--display)", fontSize: 26, color: "var(--yellow)", marginBottom: 4 }}>COMMITTED — GOING LIVE</div>
                      <div className="np-mono" style={{ fontSize: 11, color: NR.muted, marginBottom: 16, lineHeight: 1.5 }}>{"articles/" + slug + ".jsonl is in clovenbradshaw-ctrl/npj — the article's EO event log, line 1. Every future edit appends to it. The front page lists it and the link below opens the formatted reader."}</div>
                      <div style={{ display: "inline-block", textAlign: "left", marginBottom: 18 }}>
                        <ShareBar dark url={articleUrl} archiveUrl={"https://web.archive.org/save/" + window.npjArticleRawUrl(slug)} title={title} />
                      </div>
                    </React.Fragment>
                  : <React.Fragment>
                      <div style={{ fontFamily: "var(--display)", fontSize: 24, color: NR.warn, marginBottom: 6 }}>PUBLISH DIDN'T COMPLETE</div>
                      <div className="np-mono" style={{ fontSize: 11.5, color: NR.soft, lineHeight: 1.5, maxWidth: 440, margin: "0 auto 16px" }}>{outcome.msg} Your draft is safe — it stays saved on this device and synced to your Matrix account.</div>
                    </React.Fragment>}
                <div style={{ display: "flex", gap: 9, justifyContent: "center" }}>
                  {outcome.ok && (
                    <button onClick={() => onPublished && onPublished(published.current || slug)} className="np-cond" style={{ background: "var(--yellow)", color: "var(--ink)", border: "1.5px solid var(--ink)", padding: "10px 18px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <I.arrow style={{ fontSize: 14 }} /> Open the article
                    </button>
                  )}
                  <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "10px 16px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>Back to editor</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* Serialize the contentEditable draft to plaintext markdown. LEGACY: publishing
   now commits an EO event log (app/articles.js → genesisFromContent), not a .md
   file — this serializer stays only for plaintext export/debugging.
   Bound source spans become numbered footnotes whose definitions point at the
   archived (or original) URL — so the markdown keeps every claim auditable. */
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
    if (sup.hasAttribute("data-fn")) return; // manual footnote — its definition is typed in the doc
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
    else if (tag === "pre") {
      if (node.classList.contains("verse")) { String(node.innerText || "").replace(/\n+$/, "").split("\n").forEach(l => lines.push(l.trimEnd() + "  ")); lines.push(""); }
      else lines.push("```", String(node.innerText || "").replace(/\n+$/, ""), "```", "");
    }
    else if (node.classList && node.classList.contains("nr-dek")) {
      const t = inline(node).trim();
      if (t) lines.push("*" + t + "*", ""); // the dek — an italic standfirst right under the headline
    }
    else if (node.classList && node.classList.contains("cmp-widget") && node.getAttribute("data-widget") === "poll") {
      const qEl = node.querySelector(".cmp-widget-b strong");
      lines.push("> **Poll:** " + (qEl ? qEl.textContent.trim() : ""));
      node.querySelectorAll(".cmp-widget-b span").forEach(s => { const t = s.textContent.trim(); if (t) lines.push("> - " + t); });
      lines.push("");
    }
    else if (tag === "figure") {
      const cap = node.querySelector("figcaption");
      const capText = cap ? cap.textContent.trim() : "";
      // an image slot that resolved an archive.org link carries it in `src` —
      // the published .md hotlinks the IA copy (archive.org is the media CDN);
      // local-only drops have no durable URL and stay out of the .md
      const slot = node.querySelector("image-slot");
      const img = slot && slot.getAttribute("src");
      if (img && window.NpjArchiveCDN && window.NpjArchiveCDN.isMediaUrl(img))
        lines.push("![" + capText.replace(/[\[\]\n]/g, " ").trim() + "](" + img + ")", "");
      const u = node.getAttribute("data-embed-url"); if (u) lines.push("<" + u + ">", "");
      if (capText) lines.push("*" + capText + "*", "");
    }
    else { const t = inline(node).trim(); if (t) lines.push(t, ""); }
  });
  let md = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const keys = Object.keys(footnotes);
  if (keys.length) { md += "\n"; keys.forEach(k => { md += "[^" + k + "]: " + footnotes[k] + "\n"; }); }
  return md;
}
window.NpjArticleMarkdown = function (content) {
  const c = content || {};
  const tmp = document.createElement("div"); tmp.innerHTML = c.html || "";
  const dekEl = tmp.querySelector(".nr-dek");
  const dek = dekEl ? (dekEl.textContent || "").trim() : "";
  const meta = "<!-- column: " + (c.column || "") + " · tags: " + ((c.tags || []).join(", ")) + (dek ? " · subtitle: " + dek.replace(/-->/g, "") : "") + " -->\n\n";
  return meta + htmlToMarkdown(c.html);
};

/* Closed-network gate: until the admin adds you, the newsroom is read-only-off. */
function NewsroomLocked({ signedIn, me, onSignIn, onHome }) {
  const localDrafts = (window.NpjDrafts && window.NpjDrafts.localList) ? window.NpjDrafts.localList() : [];
  return (
    <div className="newsroom fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 22px", textAlign: "center" }}>
      <div style={{ maxWidth: 520 }}>
        <I.lock style={{ fontSize: 40, color: "var(--yellow)" }} />
        <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: .95, margin: "16px 0 12px", color: NR.text }}>The newsroom is invite-only</h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.5, color: NR.soft, margin: 0 }}>
          People's Journalism is being built by its founding admin. For now, only the admin and the contributors they've added can draft and edit here — that opens up as the network grows.
        </p>
        {signedIn && <p className="np-mono" style={{ fontSize: 12, color: NR.warn, margin: "12px 0 0", lineHeight: 1.5 }}>You're verified as {me}, but you're not on the contributor allowlist yet. Ask the admin to add you.</p>}
        {!signedIn && localDrafts.length > 0 && (
          <p className="np-mono" style={{ fontSize: 12, color: NR.ok, margin: "12px 0 0", lineHeight: 1.5 }}>
            Nothing was lost: {localDrafts.length} draft{localDrafts.length === 1 ? " is" : "s are"} still saved in this browser. Sign back in to keep editing — they'll re-sync to your account.
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          {!signedIn && <button onClick={onSignIn} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> Sign in with Matrix</button>}
          <button onClick={onHome} className="btn" style={{ background: "transparent", color: NR.text, borderColor: NR.line }}>Back to the public site</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Newsroom, NewsroomLocked });
