/* NPJ newsroom — the editor. Ships empty. Manual, span-bound sourcing (drafteo
   style: select the exact words → bind a source; one source can back many spans).
   Adds: banner + inline images, a proper link/jump-link popover, a section
   contents rail, Citey-assisted grounding + tags, real Matrix room invites + server-side
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

// A source the file explorer/viewer should open: an uploaded document, or any
// source whose content the app can render inline (image / pdf / text). Web-link
// snapshots are excluded — they keep their "open ↗".
function nrIsFileSrc(rec) {
  const SV = window.NpjSourceView;
  return !!(SV && rec && (/^doc-/.test(rec.id || "") || SV.isViewable(rec)));
}

const DEK_PH = "Subtitle — one line under the headline";
// The headline + dek live in the body as <h1>/.nr-dek so the whole publish,
// restore and reader pipeline is unchanged — but they're driven by the explicit
// Title/Subtitle fields above the sheet (and hidden in-canvas via .nr-fielded),
// so the author fills in fields, not loose formatted prose.
const START_DOC =
  '<figure contenteditable="false" class="nr-banner"><image-slot id="nr-banner" fitcontrol shape="rect" placeholder="Banner image — drag a photo or an archive.org link" style="width:100%;height:300px;display:block"></image-slot></figure>' +
  '<h1></h1>' +
  '<p class="nr-dek" data-ph="' + DEK_PH + '"><br/></p>' +
  '<p><br/></p>';

// edge-dashes stripped AFTER the length cap — a cap that lands mid-word used
// to leave filenames like "…-and-the-people-.md"
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, ""); }

function Newsroom({ session, draftId = "working", onExit, onDocs, onPublished }) {
  const { layout, me, isAdmin } = React.useContext(window.LayoutCtx);
  const columns = (layout.sections || []).map(s => s.name);
  const canPub = window.canPublish(layout, session && session.user_id);
  const isMobile = window.useIsMobile();
  const [mTab, setMTab] = useState("write");          // mobile: write | contents | sources
  const [view, setView] = useState("prose");          // prose editor | grounding workspace (grounding / citations / sources) — same draft
  const [theme, setTheme] = useState(nrTheme);        // light | dark — persisted
  const toggleTheme = () => setTheme(t => { const next = t === "light" ? "dark" : "light"; try { localStorage.setItem(THEME_KEY, next); } catch (e) {} return next; });
  const restored = useRef(false);                      // gate autosave until the first restore lands
  const saveTimer = useRef(null);
  const htmlRef = useRef("");                          // last seen editor HTML (survives unmount, when ed.current is gone)

  const [sources, setSources] = useState([]);
  const [citeOrder, setCiteOrder] = useState([]);
  const citeOrderRef = useRef([]);
  // stable per-sentence identity + provenance (app/sentences.js). Rides the draft
  // so a sentence's grounding follows it through edits, moves, reloads.
  const sentenceLedger = useRef(window.NpjSentences ? window.NpjSentences.newLedger() : { v: 1, seq: 0, entries: {} });
  const [armSrc, setArmSrc] = useState(null);       // source picked first; next selection binds to it
  const [rev, setRev] = useState(0);                // bump to recompute span counts
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [redactTarget, setRedactTarget] = useState(null);   // Citey's PII review, open on a source key
  const [publish, setPublish] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false); // an unpublish in flight
  const [statusErr, setStatusErr] = useState(null);
  const [title, setTitle] = useState("");            // explicit Title field (mirrors the body <h1>)
  const [dek, setDek] = useState("");                // explicit Subtitle field (mirrors .nr-dek)
  const [fileSlug, setFileSlug] = useState("");      // custom filename; "" = derived from the title
  const [tags, setTags] = useState([]);
  const [column, setColumn] = useState(columns[0] || "");
  const [toc, setToc] = useState([]);
  // ---- editing-only post structure (app/structure.js) ----
  // the append-only event log is the source of truth; `structure` is its fold.
  // Stamped onto headings as data-sec (stable identity across renames/reorders),
  // persisted with the draft, NEVER published (stripped at build — Invariant I1).
  const structLog = useRef([]);
  const [structure, setStructure] = useState(() => (window.NpjStructure ? window.NpjStructure.emptyState(draftId) : null));
  const [structTypes, setStructTypes] = useState(() => (window.NpjStructure ? window.NpjStructure.types.all() : []));
  const [blankChosen, setBlankChosen] = useState(false);   // dismissed the start-a-post picker
  const reconcileRef = useRef(null);
  const reconcileTimer = useRef(null);
  const [media, setMedia] = useState([]);           // images + embeds in the piece
  const [viewer, setViewer] = useState(null);       // index into the image list — the media viewer
  const [explorer, setExplorer] = useState(null);   // { key } — the source file explorer, open on a source
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

  // let Citey drop suggested tags in (and read the columns for its column hint)
  useEffect(() => {
    window.__draftTags = { add: (t) => setTags(list => list.includes(t) ? list : [...list, t]), get: () => tags, columns: () => columns };
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
    const citations = window.NpjCitations ? window.NpjCitations.serialize() : [];
    const sentenceLedgerJson = window.NpjSentences ? window.NpjSentences.serializeLedger(sentenceLedger.current) : undefined;
    window.NpjDrafts.save(draftId, { html, title, slug: fileSlug, tags, column, sources, citeOrder: citeOrderRef.current, sourceRecords, citations, sentenceLedger: sentenceLedgerJson, room, structure: structLog.current });
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
    // flush a pending structure reconcile first, so the last heading is in the
    // log before the final save, then write whatever's still in the debounce.
    if (reconcileTimer.current) { clearTimeout(reconcileTimer.current); try { reconcileRef.current && reconcileRef.current(); } catch (e) {} }
    if (saveTimer.current) { clearTimeout(saveTimer.current); try { persistRef.current(); } catch (e) {} }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let d = null;
      try { d = await window.NpjDrafts.restore(draftId); } catch (e) {}
      if (alive && d) {
        if (d.sourceRecords) Object.assign(window.NPJ.SOURCES, d.sourceRecords); // rehydrate source cards
        if (d.citations && window.NpjCitations) window.NpjCitations.hydrate(d.citations); // rehydrate citation records
        if (d.sentenceLedger && window.NpjSentences) sentenceLedger.current = window.NpjSentences.hydrateLedger(d.sentenceLedger); // stable sentence ids survive reload
        if (ed.current && d.html) {
          ed.current.innerHTML = d.html;
          // older drafts predate the dek — every article gets the field
          if (!ed.current.querySelector(".nr-dek")) {
            const h1 = ed.current.querySelector("h1");
            if (h1) { const p = document.createElement("p"); p.className = "nr-dek"; p.setAttribute("data-ph", DEK_PH); p.innerHTML = "<br/>"; h1.after(p); }
          }
          // older drafts predate source-span pinning — backfill a stable cid on
          // each bound span + its marker (so it can be pinned), and flag any span
          // without a pinned quote so the author goes back and points at the
          // exact words in the source (the publish build will hold them to it)
          ed.current.querySelectorAll(".claim-src").forEach((el, i) => {
            let cid = el.getAttribute("data-cid");
            if (!cid) { cid = "cs-legacy-" + Date.now().toString(36) + "-" + i; el.setAttribute("data-cid", cid); }
            const sup = el.nextElementSibling;
            if (sup && sup.classList && sup.classList.contains("md-cite") && !sup.hasAttribute("data-cid")) {
              sup.setAttribute("data-cid", cid);
              if (!sup.hasAttribute("data-quote")) sup.setAttribute("data-quote", el.getAttribute("data-quote") || "");
            }
            if (!(el.getAttribute("data-quote") || "").trim()) el.classList.add("needs-quote");
          });
          // back-fill citation RECORDS from any inline data-quote (idempotent —
          // skips spans that already carry data-cite-id), so legacy drafts gain
          // reusable citations the first time they're opened, with no data loss.
          if (window.NpjCitations) window.NpjCitations.migrateRoot(ed.current);
          // hydrate the explicit Subtitle field from the restored .nr-dek node
          const dekEl0 = ed.current.querySelector(".nr-dek");
          if (dekEl0) setDek((dekEl0.textContent || "").trim());
        }
        if (d.title) setTitle(d.title);
        if (typeof d.slug === "string") setFileSlug(d.slug);
        if (Array.isArray(d.tags)) setTags(d.tags);
        if (d.column) setColumn(d.column);
        if (Array.isArray(d.sources)) setSources(d.sources);
        if (Array.isArray(d.citeOrder)) { citeOrderRef.current = d.citeOrder; setCiteOrder(d.citeOrder); }
        if (d.room) setRoom(d.room);
        // rehydrate the structure log; the post-restore scanHeadings reconciles
        // it with the DOM (legacy drafts with no log fold to organic sections).
        if (Array.isArray(d.structure) && window.NpjStructure) {
          structLog.current = d.structure;
          const s0 = window.NpjStructure.fold(d.structure); s0.articleId = draftId; setStructure(s0);
          if (d.structure.length) setBlankChosen(true);
        }
        setTimeout(scanHeadings, 30); setRev(v => v + 1);
      }
      restored.current = true;
    })();
    return () => { alive = false; };
  }, [draftId]);

  useEffect(() => { if (session) window.NpjDrafts.flush(draftId); }, [session, draftId]); // push local-only work up after sign-in
  useEffect(() => { scheduleSave(); }, [title, fileSlug, tags, column, sources, room, scheduleSave]);
  // entering a grounding view builds/extends the stable-id ledger (track()) — save
  // so those ids persist even if the author switches views without editing
  useEffect(() => { if (view !== "prose") scheduleSave(); }, [view, scheduleSave]);

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
      // the headline is the explicit Title field, not a section jump-link
      if (h.tagName !== "H1") items.push({ id, text, level: +h.tagName[1] });
    });
    setToc(items);
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
    // keep the structure layer in step with the headings — debounced, so a burst
    // of typing coalesces into one reconcile instead of an event per keystroke.
    clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => { if (reconcileRef.current) reconcileRef.current(); }, 350);
  }, []);
  useEffect(() => { const t = setTimeout(scanHeadings, 60); return () => clearTimeout(t); }, [scanHeadings]);

  // ---- structure layer: DOM ⇄ log reconcile, fold, reflow ----
  // refold the append-only log into the live PostStructure.
  const refoldStruct = useCallback(() => {
    if (!window.NpjStructure) return null;
    const s = window.NpjStructure.fold(structLog.current); s.articleId = draftId; setStructure(s); return s;
  }, [draftId]);

  // reorder the document's section-spans to match the structure's flattened
  // order so WYSIWYG === what publishes (lead nodes — banner, title, dek, intro —
  // stay put). Only fires on explicit structural reorders, never mid-typing, so
  // it can't fight the caret. Moving an <image-slot> figure is safe: it reloads
  // its image by id. The span surgery itself lives in (and is tested in) the
  // engine's dom bridge.
  const reflowDOM = useCallback((orderedIds) => {
    if (!window.NpjStructure || !ed.current) return;
    if (window.NpjStructure.dom.reflow(ed.current, orderedIds)) setTimeout(() => { scanHeadings(); scheduleSave(); }, 0);
  }, [scanHeadings, scheduleSave]);

  // append events, refold, optionally reflow the document, persist.
  const dispatchStruct = useCallback((events, opts) => {
    if (!window.NpjStructure || !events || !events.length) return;
    structLog.current = structLog.current.concat(events);
    const s = refoldStruct();
    if (opts && opts.reflow && s) reflowDOM(window.NpjStructure.flattenIds(s));
    scheduleSave();
  }, [refoldStruct, reflowDOM, scheduleSave]);

  // DOM → log: keep the structure in step with the headings the author writes.
  // scanHeadings has already stamped each heading's slug onto h.id, so the engine
  // reads that as the binding slug. Emits nothing when nothing changed.
  const reconcileStructure = () => {
    const lib = window.NpjStructure, root = ed.current;
    if (!lib || !root) return;
    const evs = lib.dom.reconcile(root, structLog.current, { slugFor: h => h.id });
    if (!evs.length) return;
    structLog.current = structLog.current.concat(evs);
    refoldStruct();
    scheduleSave();
  };
  useEffect(() => { reconcileRef.current = reconcileStructure; });

  // pull the author's saved post types in (localStorage + Matrix mirror).
  useEffect(() => {
    if (!window.NpjStructure) return;
    setStructTypes(window.NpjStructure.types.all());
    Promise.resolve(window.NpjStructure.types.sync()).then(() => setStructTypes(window.NpjStructure.types.all())).catch(() => {});
  }, [session]);

  // ---- explicit Title / Subtitle fields ----
  // The fields are the source of truth; each writes through to the hidden body
  // <h1> / .nr-dek so the publish gate, reader, markdown export and front page
  // keep reading exactly what they always have — no pipeline change.
  const onTitleInput = useCallback((v) => {
    setTitle(v);
    const root = ed.current;
    if (root) {
      let h1 = root.querySelector("h1");
      if (!h1) { h1 = document.createElement("h1"); const b = root.querySelector("figure.nr-banner"); if (b) b.after(h1); else root.insertBefore(h1, root.firstChild); }
      h1.textContent = v;
    }
    scheduleSave();
  }, [scheduleSave]);
  const onDekInput = useCallback((v) => {
    setDek(v);
    const root = ed.current;
    if (root) {
      let d = root.querySelector(".nr-dek");
      if (!d) { d = document.createElement("p"); d.className = "nr-dek"; d.setAttribute("data-ph", DEK_PH); const h1 = root.querySelector("h1"); if (h1) h1.after(d); else root.insertBefore(d, root.firstChild); }
      if (v) d.textContent = v; else d.innerHTML = "<br/>";
    }
    scheduleSave();
  }, [scheduleSave]);

  const scrollToId = (id) => {
    const cont = scroller.current, body = ed.current; if (!cont || !body) return;
    const el = body.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
    if (!el) return;
    const cr = cont.getBoundingClientRect(), er = el.getBoundingClientRect();
    cont.scrollTop += (er.top - cr.top) - 18;
  };

  // the api the structure rail (app/PostStructure.jsx) drives. Every mutation
  // goes through dispatchStruct → append-only log → fold → (reflow) → persist.
  const structApi = useMemo(() => {
    const lib = window.NpjStructure; if (!lib) return null;
    const appliedType = (structure && structure.appliedTypeId)
      ? (structTypes.find(t => t.id === structure.appliedTypeId) || lib.types.get(structure.appliedTypeId)) : null;
    return {
      state: structure, types: structTypes, appliedType,
      hasContent: blankChosen || toc.length > 0 || !!(structure && structure.sections.length),
      applyType: (typeId) => { const t = lib.types.get(typeId); if (t) { setBlankChosen(true); dispatchStruct(lib.ops.applyType(structure, t), { reflow: true }); } },
      startBlank: () => { setBlankChosen(true); if (ed.current) ed.current.focus(); },
      removeType: () => dispatchStruct(lib.ops.removeType(), { reflow: true }),
      saveType: (name) => { const t = lib.saveFrom(structure, name); lib.types.save(t); setStructTypes(lib.types.all()); dispatchStruct(lib.ops.saveType(structure, t.id)); },
      addSlot: (slotId) => { const sl = lib.slotById(structure, slotId); if (sl) dispatchStruct(lib.ops.addSlot(structure, sl)); },
      moveSection: (id, parent, order) => dispatchStruct(lib.ops.moveSection(id, parent, order), { reflow: true }),
      moveBulk: (ids, parent, order) => dispatchStruct(lib.ops.moveBulk(ids, parent, order), { reflow: true }),
      reorderSlot: (id, order) => dispatchStruct(lib.ops.reorderSlot(id, order), { reflow: true }),
      deleteSection: (id) => dispatchStruct(lib.ops.deleteSection(id)),
      jumpTo: (slug) => { if (isMobile) setMTab("write"); setTimeout(() => scrollToId(slug), isMobile ? 30 : 0); }
    };
  }, [structure, structTypes, blankChosen, toc.length, dispatchStruct, isMobile]);

  const onBodyClick = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a) { e.preventDefault(); scrollToId(a.getAttribute("href").slice(1)); return; }
    // click a cited span (or its marker) to pin / re-pin the words in the source
    const cs = e.target.closest && e.target.closest(".claim-src, sup.md-cite[data-cid]");
    if (cs && cs.getAttribute("data-cid")) {
      const cid = cs.getAttribute("data-cid");
      const span = ed.current && ed.current.querySelector('.claim-src[data-cid="' + cid + '"]');
      openPin(cid, cs.getAttribute("data-src") || cs.getAttribute("data-cite"), span ? (span.textContent || "").trim() : "");
    }
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
  const imageFigure = (id) => `<figure contenteditable="false" class="cmp-embed"><image-slot id="${id}" fitcontrol shape="rect" placeholder="Drop a photo or an archive.org link" style="width:100%;height:280px;display:block"></image-slot><figcaption class="np-mono" style="font-size:11px;color:${NR.muted};margin-top:4px">photo · drag an image or an archive.org link, then caption &amp; credit</figcaption></figure><p><br/></p>`;
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
  //
  // Binding no longer FINISHES the citation — it opens it. You can't just cite a
  // page: every bound span must then PIN the exact words IN THE SOURCE that back
  // the claim (data-quote). Until it's pinned the span is flagged `needs-quote`
  // and the publish build refuses it, so a claim can never stand on a whole
  // page — only on a specific span of a specific source.
  // Wrap a Range in a fresh claim-src span bound to `key`, drop the numbered
  // marker after it, and register the source. Shared by the toolbar's
  // bindSource and the table's "add citation to this sentence". Returns the cid.
  const bindRangeToSource = (r, key) => {
    let order = citeOrderRef.current;
    if (order.indexOf(key) < 0) { order = [...order, key]; citeOrderRef.current = order; setCiteOrder(order); }
    const num = order.indexOf(key) + 1;
    const cid = "cs-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);
    const span = document.createElement("span"); span.className = "claim-src needs-quote";
    span.setAttribute("data-src", key); span.setAttribute("data-cid", cid); span.setAttribute("data-quote", "");
    try { r.surroundContents(span); } catch (e) { const frag = r.extractContents(); span.appendChild(frag); r.insertNode(span); }
    const sup = document.createElement("sup"); sup.className = "md-cite"; sup.setAttribute("contenteditable", "false");
    sup.setAttribute("data-cite", key); sup.setAttribute("data-cid", cid); sup.setAttribute("data-quote", ""); sup.title = key; sup.textContent = num;
    span.after(sup);
    if (!sources.find(x => x.key === key)) setSources(s => [{ key, archived: !!(window.NPJ.SOURCES[key] && window.NPJ.SOURCES[key].archive_url) }, ...s]);
    return cid;
  };
  const bindSource = (key) => {
    const r = spanRange();
    if (!r) { setArmSrc(key); setMenu(null); return; }
    const claimText = String(r.toString() || "").trim();
    const cid = bindRangeToSource(r, key);
    window.getSelection().removeAllRanges(); selRange.current = null; setSel(null); setMenu(null); setSrcUrl(""); setArmSrc(null); setRev(v => v + 1); scheduleSave();
    // now make the author point at the words in the source — the citation isn't
    // done until that span is pinned
    openPin(cid, key, claimText);
  };

  // ---- pin the source-span: the words IN THE SOURCE that back this claim ----
  const [pinTarget, setPinTarget] = useState(null); // { cid, key, claimText }
  const [pinQuote, setPinQuote] = useState("");
  const pinLoc = useRef(null);                      // char offsets into the source, from the picker
  const openPin = (cid, key, claimText) => {
    // re-opening an existing binding? read back whatever quote is on it
    let existing = "";
    if (ed.current) { const el = ed.current.querySelector('.claim-src[data-cid="' + cid + '"]'); if (el) existing = el.getAttribute("data-quote") || ""; }
    setPinQuote(existing); pinLoc.current = null;
    setPinTarget({ cid, key, claimText });
  };
  const closePin = () => { setPinTarget(null); setPinQuote(""); pinLoc.current = null; };
  const savePin = (loc) => {
    const t = pinTarget; if (!t) return;
    const q = String(pinQuote || "").trim();
    if (!q) return;
    const span = ed.current && ed.current.querySelector('.claim-src[data-cid="' + t.cid + '"]');
    if (window.NpjCitations && span) {
      // mint a reusable citation RECORD and attach it — projectAttrs re-derives
      // data-src / data-quote / data-quotes and syncs the sup marker, so every
      // downstream reader (CiteyBrain, publishGate, htmlToBlocks) is unchanged.
      const id = window.NpjCitations.mint({ srcKey: t.key, quote: q, loc: loc || null });
      window.NpjCitations.attach(span, id);
      span.setAttribute("title", "Cited span — “" + q.slice(0, 140) + (q.length > 140 ? "…" : "") + "”");
    } else if (ed.current) {
      // registry unavailable — fall back to the old inline behaviour
      ed.current.querySelectorAll('[data-cid="' + t.cid + '"]').forEach(el => {
        el.setAttribute("data-quote", q);
        if (el.classList.contains("claim-src")) { el.classList.remove("needs-quote"); el.setAttribute("title", "Cited span — “" + q.slice(0, 140) + (q.length > 140 ? "…" : "") + "”"); }
      });
    }
    // remember the passage on the source record too, so the next claim off the
    // same source can be matched against text we've already pulled
    const rec = window.NPJ.SOURCES[t.key];
    if (rec && (!rec.text || rec.text.indexOf(q) < 0)) rec.text = (rec.text ? rec.text + "\n" : "") + q;
    closePin(); setRev(v => v + 1); scheduleSave();
    // let Citey flip ⊥→⊤ and re-cost the publish gate
    if (window.__citey) { if (span) window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
  };
  // The source-span ranking + paste flow now lives in the SourcePicker component
  // (app/SourcePicker.jsx), rendered inside the pin popover and the table.
  // Citey's grounding bridge — the popover's pin / own / unown act here so React
  // state (rev) and the autosave stay consistent. Owning a claim removes the
  // incomplete citation and records the author's stance; it publishes as prose.
  useEffect(() => {
    window.__npjGround = {
      focused: () => window.__citey && window.__citey.focused ? window.__citey.focused() : null,
      pin: (el) => { if (!el) return; const cid = el.getAttribute("data-cid"); if (!cid) return; openPin(cid, el.getAttribute("data-src") || el.getAttribute("data-cite"), (el.textContent || "").trim()); },
      own: (el, stance) => {
        if (!el) return; const cid = el.getAttribute("data-cid");
        if (cid && ed.current) ed.current.querySelectorAll('sup.md-cite[data-cid="' + cid + '"]').forEach(s => s.remove());
        el.removeAttribute("data-src"); el.removeAttribute("data-cid"); el.removeAttribute("data-quote");
        el.classList.remove("needs-quote");
        const norm = stance === "testimony" ? "testimony" : stance === "voice" ? "voice" : "analysis";
        el.setAttribute("data-stance", norm);
        el.setAttribute("title", "Owned by the author — " + ({ analysis: "their analysis", testimony: "their account", voice: "their stated position" }[norm]));
        setRev(v => v + 1); scheduleSave();
      },
      unown: (el) => { if (!el) return; el.removeAttribute("data-stance"); el.classList.remove("claim-src"); setRev(v => v + 1); scheduleSave(); },
      // attach an EXISTING reusable citation to a span (the many-to-many reuse path)
      attachCitation: (el, citeId) => {
        if (!el || !citeId || !window.NpjCitations) return;
        window.NpjCitations.attach(el, citeId);
        setRev(v => v + 1); scheduleSave();
        if (window.__citey) { window.__citey.evaluateSpan(el); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
      },
      // unlink a citation from a span — the RECORD survives (still reusable elsewhere)
      detachCitation: (el, citeId) => {
        if (!el || !citeId || !window.NpjCitations) return;
        window.NpjCitations.detach(el, citeId);
        setRev(v => v + 1); scheduleSave();
        if (window.__citey) { window.__citey.evaluateSpan(el); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
      },
      gate: () => window.CiteyBrain ? window.CiteyBrain.publishGate(ed.current) : null
    };
    return () => { if (window.__npjGround) delete window.__npjGround; };
  });
  // every bound span still missing its source-span (owned claims are grounded, skip them)
  const needsQuoteCount = () => { void rev; return ed.current ? Array.from(ed.current.querySelectorAll(".claim-src")).filter(el => !el.getAttribute("data-stance") && !(el.getAttribute("data-quote") || "").trim()).length : 0; };

  // ---- table view: the same draft, one row per sentence ----
  // Wrap a sentence (or sub-)range in a bare claim-src span — used when owning a
  // sentence that has no claim yet (own needs an element to mark).
  const wrapPlainClaim = (range) => {
    const cid = "cs-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);
    const span = document.createElement("span"); span.className = "claim-src"; span.setAttribute("data-cid", cid);
    try { range.surroundContents(span); } catch (e) { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
    return span;
  };
  // The claim span a table row acts on: reuse an existing one inside the sentence
  // (sub-sentence safe — never nest), else wrap the whole sentence.
  const rowSpanFor = (row, key, plain) => {
    if (row.claimSpans && row.claimSpans.length) return row.claimSpans[0];
    const range = window.NpjSentences && window.NpjSentences.rangeFor(row);
    if (!range) return null;
    return plain ? wrapPlainClaim(range) : (ed.current && ed.current.querySelector('.claim-src[data-cid="' + bindRangeToSource(range, key) + '"]'));
  };
  const tableApi = {
    // track() = segment + reconcile against the persisted ledger, so every row
    // carries a STABLE sid + provenance that follows the sentence through edits.
    segment: () => (window.NpjSentences && ed.current) ? window.NpjSentences.track(ed.current, sentenceLedger.current) : [],
    // the live editor node — the workspace observes it so the grounding table
    // imports every prose sentence the moment it lands (survives the restore race)
    editorEl: () => ed.current,
    rev,
    toProse: () => setView("prose"),
    // scroll the (hidden) editor to a row and select it, then flip to prose
    jumpTo: (row) => {
      setView("prose");
      setTimeout(() => {
        const range = window.NpjSentences && window.NpjSentences.rangeFor(row); if (!range) return;
        const sel2 = window.getSelection(); sel2.removeAllRanges(); sel2.addRange(range);
        const rect = range.getBoundingClientRect(), cont = scroller.current;
        if (cont) { const cr = cont.getBoundingClientRect(); cont.scrollTop += (rect.top - cr.top) - 80; }
      }, 30);
    },
    // attach an existing reusable citation to this sentence (mints a span if needed)
    attachExisting: (row, citeId) => {
      const c = window.NpjCitations && window.NpjCitations.get(citeId); if (!c) return;
      const span = rowSpanFor(row, c.srcKey, false); if (!span) return;
      window.__npjGround.attachCitation(span, citeId);
    },
    detach: (span, citeId) => window.__npjGround.detachCitation(span, citeId),
    // open the source-span picker to mint a NEW citation off `key` for this sentence
    pinNew: (row, key) => {
      const span = rowSpanFor(row, key, false); if (!span) return;
      openPin(span.getAttribute("data-cid"), key, (span.textContent || "").trim());
    },
    // re-open the picker for an already-bound span
    repin: (span) => { if (span) openPin(span.getAttribute("data-cid"), (span.getAttribute("data-src") || "").split(/\s+/)[0], (span.textContent || "").trim()); },
    own: (row, stance) => {
      const span = rowSpanFor(row, null, true); if (!span) return;
      window.__npjGround.own(span, stance);
      if (window.__citey) { window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
    },
    unown: (span) => { window.__npjGround.unown(span); if (window.__citey && window.__citey.refreshGate) window.__citey.refreshGate(); },
    sources: () => sources.map(s => ({ key: s.key, rec: window.NPJ.SOURCES[s.key] || {} })),
    allCitations: () => window.NpjCitations ? window.NpjCitations.all() : [],
    citationsFor: (span) => window.NpjCitations ? window.NpjCitations.citationsFor(span) : [],
    usageCount: (citeId) => window.NpjCitations ? window.NpjCitations.usage(citeId, ed.current).length : 0,
    // ---- the grounding workspace's direct-mint path (no popover): the author
    // grabbed the exact words in the source reader — mint the reusable record
    // (multi-part spans supported) and attach it to this sentence's claim span.
    groundRow: (row, srcKey, quote, loc, spans) => {
      const q = String(quote || "").trim(); if (!q || !srcKey) return false;
      const span = rowSpanFor(row, srcKey, false); if (!span) return false;
      if (window.NpjCitations) {
        const id = window.NpjCitations.mint({ srcKey, quote: q, loc: loc || null, spans: spans || null });
        window.NpjCitations.attach(span, id);
      } else {
        span.setAttribute("data-quote", q); span.classList.remove("needs-quote");
      }
      span.setAttribute("title", "Cited span — “" + q.slice(0, 140) + (q.length > 140 ? "…" : "") + "”");
      setRev(v => v + 1); scheduleSave();
      if (window.__citey) { window.__citey.evaluateSpan(span); if (window.__citey.refreshGate) window.__citey.refreshGate(); }
      return true;
    },
    sourceRec: (key) => (window.NPJ.SOURCES || {})[key] || {},
    // the reader can't show text it doesn't have — pasted passages stick to the
    // source record (append-only, so existing citation offsets stay valid)
    seedSourceText: (key, text) => {
      const rec = window.NPJ.SOURCES[key]; const t = String(text || "").trim();
      if (!rec || !t) return;
      rec.text = (rec.text ? rec.text + "\n" : "") + t;
      setRev(v => v + 1);
      scheduleSave();   // pasted / PDF-extracted source text sticks to the draft
    }
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
  // ---- PII review (Citey's archive gate) ----
  // Text we can actually read in-browser → Citey scans it. Binary types (pdf,
  // image, docx) carry no extractable text without a build step, so Citey's
  // review offers paste-or-affirm instead (rec.binary flags them).
  const TEXT_RE = /\.(txt|text|md|markdown|csv|tsv|log|json|xml|html?|rtf|srt|vtt|ini|ya?ml)$/i;
  const isTextFile = (f) => (f && /^text\//.test(f.type || "")) || /(json|xml|csv|html|markdown|ya?ml)/.test((f && f.type) || "") || TEXT_RE.test((f && f.name) || "");
  // Stamp a pending review envelope on a source so the gate shows until the
  // author has been through Citey. (The modal recomputes findings live.)
  const scanSource = (key) => {
    const rec = window.NPJ.SOURCES[key]; if (!rec || !window.NpjPII) return;
    const findings = rec.text && rec.text.trim() ? (window.NpjPII.detect(rec.text) || []) : [];
    if (!rec.piiReview) rec.piiReview = { state: "pending", basis: window.NpjPII.BASIS, scannedAt: new Date().toISOString(), redactions: [], affirmations: [] };
    rec.piiReview.findings = findings.length; rec.piiReview.scannedAt = new Date().toISOString();
  };
  // A source bound for archive.org that Citey can act on (an upload, or anything
  // with text/opaque bytes) must clear the review before it's archived.
  const piiGated = (key) => { const rec = window.NPJ.SOURCES[key]; return !!rec && (/^doc-/.test(key) || rec.binary || !!String(rec.text || "").trim()); };
  const needsPiiReview = (key) => piiGated(key) && window.NpjPII && !window.NpjPII.gateClear(window.NPJ.SOURCES[key]);
  const piiReviewState = (key) => window.NpjPII ? window.NpjPII.reviewState(window.NPJ.SOURCES[key]) : "unscanned";
  // Archive: gated behind Citey's PII review. Pending → open the review first,
  // remembering to resume the archive consent once it clears.
  const redactNext = useRef(null);
  const tryArchive = (s) => { if (needsPiiReview(s.key)) { redactNext.current = s; setRedactTarget(s.key); } else setArchiveTarget(s); };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []); if (!files.length) return;
    const canUp = !!(window.NpjMedia && window.NpjMedia.canUpload && window.NpjMedia.canUpload());
    const made = files.map((f, i) => {
      const key = "doc-" + Date.now().toString(36) + i;
      window.NPJ.SOURCES[key] = { id: key, type: "primary", outlet: "uploaded document", title: f.name, filename: f.name, mime: f.type || "", size: f.size || 0, original_url: "", archive_url: "", file_url: "", retrieved: new Date().toISOString().slice(0, 10), text: "", binary: !isTextFile(f) };
      // keep the original bytes for THIS session so the file previews instantly
      // and survives a media-store upload that's still in flight (or failed)
      if (window.NpjSourceView) window.NpjSourceView.registerBlob(key, f);
      return { key, archived: false, snapshotting: false, uploading: canUp, file: f };
    });
    setSources(s => [...made, ...s]);
    // store the bytes durably on the media store (same store the article images
    // ride) so the document survives a reload / device switch and can be VIEWED
    // for citation later — not just this session. Best-effort: a failure leaves
    // the session blob in place and the row says "this browser only".
    if (canUp) made.forEach(async m => {
      try {
        const up = await window.NpjMedia.upload(m.file, m.file.name);
        const rec = window.NPJ.SOURCES[m.key];
        if (rec && up) { rec.file_url = up.url; rec.mxc = up.mxc; }
        setSources(s => s.map(x => x.key === m.key ? { ...x, uploading: false } : x));
        scheduleSave();
      } catch (e) {
        setSources(s => s.map(x => x.key === m.key ? { ...x, uploading: false, uploadErr: (e && e.message) || "upload failed" } : x));
      }
    });
    // read text out of text-like files so Citey can scan them and you can cite
    // them, then stamp a pending PII review and open Citey on the first upload.
    Promise.all(made.map(m => new Promise(resolve => {
      if (!isTextFile(m.file)) return resolve();
      const r = new FileReader();
      r.onload = () => { const rec = window.NPJ.SOURCES[m.key]; if (rec) { rec.text = String(r.result || ""); rec.binary = false; } resolve(); };
      r.onerror = () => resolve();
      try { r.readAsText(m.file); } catch (e) { resolve(); }
    }))).then(() => {
      made.forEach(m => scanSource(m.key));
      setSources(s => [...s]);
      if (made[0]) setRedactTarget(made[0].key);
      scheduleSave();
    });
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

  const versions = [{ sha: "draft", ts: new Date().toISOString().slice(0, 10), author: (session && session.user_id) || me, message: "Current working draft", headline: title || "", dek: dek || "", text: ed.current ? (ed.current.innerText || "") : "" }];

  const TB = ({ onClick, children, title }) => <button onMouseDown={e => e.preventDefault()} onClick={onClick} title={title} aria-label={title} className="np-cond" style={{ background: "transparent", border: 0, color: NR.text, padding: "5px 9px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>{children}</button>;
  const Sep = () => <span style={{ width: 1, height: 18, background: NR.line, margin: "0 5px" }} />;
  const popStyle = { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)", padding: 8 };
  const popItem = { display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--rule)", padding: "8px 6px", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" };
  const FB = ({ onClick, children, hot, title }) => <button title={title} aria-label={title} onMouseDown={e => e.preventDefault()} onClick={onClick} style={{ background: hot ? "var(--yellow)" : "transparent", color: hot ? "var(--ink)" : "#e3ddcc", border: 0, padding: "5px 9px", fontSize: 13, fontWeight: 700, fontFamily: "var(--cond)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</button>;

  // Is this draft's slug already in the committed record? If so the publish
  // control is really a REPUBLISH — the label + gate copy adapt so the editor
  // never claims "nothing has been published yet" about a piece that's already
  // live. Reactive to the title/filename, so it tracks what would actually be
  // committed.
  const liveMeta = (window.NpjArticles && window.NpjArticles.publishedMeta)
    ? window.NpjArticles.publishedMeta(fileSlug || slugify(title)) : null;
  const isRepublish = !!liveMeta;
  const isLive = isRepublish && liveMeta.status !== "unpublished";

  // admin: take an already-live piece off the site. A status-only REC (no
  // content recommit, nothing deleted) — the draft stays here, and "Republish"
  // pushes it back live anytime. Mirrors the reader/Documents unpublish path.
  const unpublish = async () => {
    const slug = fileSlug || slugify(title);
    if (!slug) return;
    setStatusErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setStatusErr("Sign in with Matrix to unpublish — the webhook re-verifies the token server-side."); return; }
    if (!window.confirm("Unpublish “" + (title || slug) + "”?\n\nIt comes off the site for everyone but admins. Every version stays in GitHub — Republish brings it back anytime.")) return;
    setStatusBusy(true);
    try {
      const actor = (session && session.user_id) || me || ((window.MatrixAuth.current() || {}).user_id) || null;
      const out = await window.NpjArticles.setArticleStatus({ slug, status: "unpublished", actor, token });
      if (!out.res.ok) {
        setStatusErr("Rejected (HTTP " + out.res.status + ")" + ((out.res.status === 401 || out.res.status === 403) ? " — that Matrix account isn't authorized to manage publication." : " — nothing changed."));
      } else {
        // refresh the front index, then force this slug's new status in (the
        // git-tree listing lags a fresh commit) and re-render so the button flips
        const reflect = () => { window.NpjArticles.patchFrontStatus(slug, "unpublished"); setRev(r => r + 1); };
        window.NpjArticles.loadFront().then(reflect).catch(reflect);
      }
    } catch (e) {
      setStatusErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
    }
    setStatusBusy(false);
  };

  return (
    <div className={"newsroom fade-in" + (theme === "light" ? " nr-light" : "")} style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* top bar */}
      <div className="nr-chrome" style={{ borderBottom: "1.5px solid " + NR.line, padding: "10px 20px", alignItems: "center",
        ...(isMobile
          ? { display: "flex", flexWrap: "wrap", gap: 14 }
          : { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", columnGap: 14 }) }}>
        {/* LEFT zone: exit + wordmark + document name. The view tabs live in the
            centered middle column, so a longer document name truncates HERE
            instead of shoving the tabs sideways. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <button onClick={onExit} className="np-cond" style={{ background: "none", border: "1px solid " + NR.line, color: NR.text, padding: "5px 11px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
          <I.arrow style={{ fontSize: 14, transform: "rotate(180deg)" }} /> Public site
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={onDocs || onExit} title="Newsroom home — your document explorer" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
            <I.lock style={{ fontSize: 18, color: "var(--yellow)" }} />
            <span style={{ fontFamily: "var(--display)", fontSize: 20, color: NR.text }}>NEWSROOM</span>
          </button>
          {/* clipped so a long headline can't widen the bar and shove the controls */}
          <span className="np-mono" title={fileSlug ? "custom document name — set at the publish gate" : "document name follows the headline — rename it at the publish gate"} style={{ fontSize: 11.5, color: NR.muted, display: "inline-flex", alignItems: "center", maxWidth: 180, flex: "0 1 auto", minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileSlug || slugify(title) || "untitled"}</span>/
          </span>
        </div>
        </div>{/* end LEFT zone */}
        {/* CENTER zone: the four pivoting views — centered in the bar and fixed
            in place, so they never shift when the document name changes. */}
        <div style={{ display: "inline-flex", border: "1px solid " + NR.line, borderRadius: 8, overflow: "hidden", justifySelf: "center" }}>
          {[["prose", "Prose", "The prose editor"],
            ["grounding", "Grounding", "Every sentence as a row to ground"],
            ["citations", "Citations", "The registry of reusable citation records"],
            ["sources", "Sources", "Read the source documents and grab the words that back a claim"]].map(([k, label, ti]) => (
            <button key={k} onClick={() => setView(k)} className="np-cond" title={ti} style={{ background: view === k ? "var(--yellow)" : "transparent", color: view === k ? "var(--ink)" : NR.text, border: 0, padding: "5px 13px", fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
        {/* RIGHT zone: autosave status + tools + publish */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, justifySelf: "end", flexWrap: "wrap", minWidth: 0 }}>
        <DraftStatusPill id={draftId} signedIn={!!session} user={session && session.user_id}
          what="text, title, tags, column and bound sources" />
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
        {statusErr && <span className="np-mono" title={statusErr} style={{ fontSize: 10.5, color: NR.warn, maxWidth: 240, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" }}>{statusErr}</span>}
        {isRepublish && !isLive && <span className="np-mono" title="This piece is currently off the site — Republish brings it back live." style={{ fontSize: 10, color: NR.warn, border: "1px solid " + NR.warn, padding: "2px 7px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ fontFamily: "var(--mono)" }}>⊘</span> Off the site</span>}
        {isAdmin && isLive && (
          <button onClick={unpublish} disabled={statusBusy} title="Unpublish — take this off the site for everyone but admins (the event log stays in GitHub)" className="np-cond" style={{ background: "transparent", color: NR.warn, border: "1.5px solid " + NR.warn, padding: "7px 14px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: statusBusy ? "wait" : "pointer", opacity: statusBusy ? .6 : 1 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>⊘</span> {statusBusy ? "Working…" : "Unpublish"}
          </button>
        )}
        <button onClick={() => canPub ? setPublish({ step: 0 }) : null} disabled={!canPub} title={canPub ? (isRepublish ? (isLive ? "Republish — this piece is already live; committing lands an updated version in its event log" : "Republish — this piece is off the site; committing pushes the draft and brings it back live") : "Publish") : "Only an admin or assigned column publisher can publish"} className="np-cond" style={{ background: canPub ? "var(--yellow)" : "transparent", color: canPub ? "var(--ink)" : NR.muted, border: "1.5px solid " + (canPub ? "var(--ink)" : NR.line), padding: "7px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: canPub ? "pointer" : "not-allowed" }}>
          <I.lock style={{ fontSize: 14 }} /> {isRepublish ? "Republish" : "Publish"}
        </button>
        </div>{/* end RIGHT zone */}
      </div>

      {/* formatting toolbar */}
      <div className="nr-chrome" style={{ borderBottom: "1px solid " + NR.line, padding: "7px 20px", display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <span className="np-eyebrow" style={{ color: NR.muted, marginRight: 6 }}>Format</span>
        <TB onClick={() => exec("undo")} title="Undo"><I.undo /></TB>
        <TB onClick={() => exec("redo")} title="Redo"><I.redo /></TB>
        <Sep />
        <TB onClick={() => exec("formatBlock", "<h1>")} title="Title">H1</TB>
        <TB onClick={() => exec("formatBlock", "<h2>")} title="Heading">H2</TB>
        <TB onClick={() => exec("formatBlock", "<h3>")} title="Subheading">H3</TB>
        <TB onClick={() => exec("formatBlock", "<p>")} title="Body text">¶</TB>
        <Sep />
        <TB onClick={() => exec("bold")} title="Bold"><b>B</b></TB>
        <TB onClick={() => exec("italic")} title="Italic"><i>I</i></TB>
        <TB onClick={() => exec("strikeThrough")} title="Strikethrough"><s>S</s></TB>
        <TB onClick={() => wrapInline("code")} title="Inline code"><I.code /></TB>
        <TB onClick={applyHighlight} title="Highlight"><I.highlighter /></TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "color" ? null : "color")} title="Text color"><span style={{ borderBottom: "3px solid var(--reject)", fontWeight: 700, lineHeight: 1 }}>A</span> <I.caretDown style={{ fontSize: 9 }} /></TB>
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
        <TB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote"><I.quote /></TB>
        <TB onClick={() => exec("insertUnorderedList")} title="Bulleted list"><I.listBullets /></TB>
        <TB onClick={() => exec("insertOrderedList")} title="Numbered list"><I.listNumbers /></TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "align" ? null : "align")} title="Alignment"><I.alignLeft /> <I.caretDown style={{ fontSize: 9 }} /></TB>
          {fmtMenu === "align" && (
            <div style={{ ...popStyle, width: 150 }}>
              {[["justifyLeft", "Align left"], ["justifyCenter", "Center"], ["justifyRight", "Align right"]].map(([cmd, label]) => (
                <button key={cmd} onMouseDown={e => e.preventDefault()} onClick={() => { exec(cmd); setFmtMenu(null); }} style={popItem}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <TB onClick={() => exec("insertHorizontalRule")} title="Divider"><I.divider /></TB>
        <Sep />
        <TB onClick={insertImage} title="Inline image"><I.image style={{ fontSize: 14 }} /> Image</TB>
        <div style={{ position: "relative", display: "inline-block" }}>
          <TB onClick={() => setFmtMenu(fmtMenu === "embed" ? null : "embed")} title="Embed video, audio or a link card"><I.play style={{ fontSize: 14 }} /> Embed</TB>
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
          <TB onClick={() => setFmtMenu(fmtMenu === "more" ? null : "more")} title="More blocks"><I.dots style={{ fontSize: 14 }} /> More <I.caretDown style={{ fontSize: 9 }} /></TB>
          {fmtMenu === "more" && (
            <div style={{ ...popStyle, left: "auto", right: 0, width: 190 }}>
              {[
                [<I.codeBlock />, "Code block", () => { exec("formatBlock", "<pre>"); setFmtMenu(null); }],
                [<I.divider />, "Divider", () => { exec("insertHorizontalRule"); setFmtMenu(null); }],
                [<I.asterisk />, "Footnote", insertFootnote],
                [<I.penNib />, "Poetry", insertVerse],
                [<I.poll />, "Poll", insertPoll]
              ].map(([g, label, fn]) => (
                <button key={label} onMouseDown={e => e.preventDefault()} onClick={fn} style={popItem}>
                  <span style={{ width: 22, textAlign: "center", flex: "0 0 auto", display: "inline-flex", justifyContent: "center" }}>{g}</span> {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <span className="np-mono npj-hide-sm" style={{ fontSize: 10.5, color: NR.muted }}>select text → format, link, or bind a source — then pin the words in the source</span>
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
          {/* the structure rail IS the editor TOC: the top-level Item list — slots
              (labeled containers showing their prompt when empty) + orphan
              sections, draggable. Editing-only; none of it reaches a reader. */}
          {structApi && window.StructureRail
            ? <window.StructureRail api={structApi} NR={NR} isMobile={isMobile} />
            : (toc.length === 0
                ? <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Add H1/H2/H3 headings and they'll show here as jump-links.</div>
                : toc.map(h => <button key={h.id} onClick={() => scrollToId(h.id)} className="np-cond" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, color: h.level === 1 ? NR.text : NR.soft, padding: "4px 0 4px " + ((h.level - 1) * 10) + "px", fontSize: h.level === 1 ? 14 : 13, fontWeight: h.level === 1 ? 700 : 500, cursor: "pointer", lineHeight: 1.2 }}>{h.text}</button>))}
          {/* media census — every image/embed in the piece; images open the viewer */}
          <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Media · {media.length}</div>
            {media.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Images and embeds in the piece collect here. Paste an image straight into the page.</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {media.map(m => m.kind === "image"
                ? <button key={m.mid} title={(m.caption || "image") + " — open the viewer"} onClick={() => setViewer(Math.max(0, mediaImages.findIndex(x => x.mid === m.mid)))} style={{ width: 44, height: 44, padding: 0, border: "1px solid " + NR.line, background: NR.field, cursor: "zoom-in", overflow: "hidden" }}>
                    <img src={m.url} alt={m.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </button>
                : <button key={m.mid} title={(m.caption || m.url) + " — show in document"} onClick={() => scrollToFigure(m.mid)} style={{ width: 44, height: 44, border: "1px solid " + NR.line, background: NR.field, color: NR.soft, cursor: "pointer", fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I.play /></button>)}
            </div>
          </div>
          {/* tags + column */}
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid " + NR.line }}>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>Column</div>
            <select value={column} onChange={e => setColumn(e.target.value)} className="np-cond" style={{ width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, padding: "6px", fontSize: 13, marginBottom: 12 }}>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>Tags <button onClick={() => window.__citey && window.__citey.suggest()} title="Citey: suggest tags" style={{ background: "none", border: "1px solid " + NR.line, color: NR.soft, fontSize: 11, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}><I.sparkle /></button></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {tags.map(t => <span key={t} className="np-mono" style={{ fontSize: 10.5, border: "1px solid " + NR.line, color: NR.text, padding: "2px 4px 2px 6px", display: "inline-flex", alignItems: "center", gap: 4 }}>#{t}<button onClick={() => setTags(l => l.filter(x => x !== t))} style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button></span>)}
              <input placeholder="+tag" onKeyDown={e => { if (e.key === "Enter") { const t = slugify(e.target.value); if (t) setTags(l => l.includes(t) ? l : [...l, t]); e.target.value = ""; } }} className="np-mono" style={{ width: 56, border: "1px dashed " + NR.line, background: "transparent", color: NR.text, padding: "3px 5px", fontSize: 11, outline: "none" }} />
            </div>
          </div>
        </div>

        {/* editor — the draft renders as a bordered page on the canvas; the page
            (not the canvas) is the contentEditable, so the document border wraps
            banner, headline and body as one sheet */}
        {/* the editor stays MOUNTED even in the workspace views (display:none) so its
            DOM, ranges and autosave stay valid — the workspace mutates the same nodes */}
        <div className="np-scroll" ref={scroller} style={{ display: (view !== "prose") || (isMobile && mTab !== "write") ? "none" : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: isMobile ? "14px 10px 40px" : "26px 32px 60px", background: NR.bg, borderRight: isMobile ? 0 : "1.5px solid " + NR.line, minHeight: 0 }}>
          {/* explicit Title + Subtitle fields — not loose prose in the canvas */}
          <div className="nr-fields" style={{ maxWidth: 800, margin: "0 auto 18px" }}>
            <label htmlFor="nr-title-field" className="np-eyebrow" style={{ display: "block", color: NR.muted, marginBottom: 3 }}>Title</label>
            <input id="nr-title-field" value={title} onChange={e => onTitleInput(e.target.value)} placeholder="Untitled headline" spellCheck={true}
              style={{ width: "100%", border: 0, borderBottom: "1px solid " + NR.line, background: "transparent", color: NR.text, fontFamily: "var(--display)", fontSize: isMobile ? 16 : 18, lineHeight: 1.15, padding: "2px 0 8px", outline: "none" }} />
            <label htmlFor="nr-dek-field" className="np-eyebrow" style={{ display: "block", color: NR.muted, margin: "14px 0 3px" }}>Subtitle</label>
            <input id="nr-dek-field" value={dek} onChange={e => onDekInput(e.target.value)} placeholder="One line under the headline" spellCheck={true}
              style={{ width: "100%", border: 0, borderBottom: "1px solid " + NR.line, background: "transparent", color: NR.soft, fontFamily: "var(--serif)", fontStyle: "italic", fontSize: isMobile ? 14 : 15, lineHeight: 1.35, padding: "2px 0 8px", outline: "none" }} />
          </div>
          <div className={"md-preview nr-page nr-fielded" + (armSrc ? " nr-arming" : "")} ref={ed} contentEditable suppressContentEditableWarning onInput={() => { scanHeadings(); scheduleSave(); }} onClick={onBodyClick}
            onPaste={onPaste} onDrop={onDropText}
            onDragStart={() => { dragFromSelf.current = true; }} onDragEnd={() => { dragFromSelf.current = false; }}
            style={{ color: NR.text, outline: "none" }}
            dangerouslySetInnerHTML={{ __html: START_DOC }} />
        </div>
        {view !== "prose" && !(isMobile && mTab !== "write") && (
          <div style={{ flex: isMobile ? 1 : undefined, background: NR.bg, borderRight: isMobile ? 0 : "1.5px solid " + NR.line, minHeight: 0, overflow: "hidden" }}>
            <window.GroundingWorkspace api={tableApi} NR={NR} view={view} setView={setView} isMobile={isMobile} />
          </div>
        )}

        {/* sources */}
        <div className="np-scroll" style={{ display: isMobile ? (mTab === "sources" ? "block" : "none") : "block", flex: isMobile ? 1 : undefined, overflowY: "auto", padding: "16px 16px 40px", background: NR.panel }}>
          <div className="np-eyebrow" style={{ color: NR.muted, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <I.source style={{ fontSize: 14 }} /> Sources · {sources.length}
            <span style={{ flex: 1 }} />
            {sources.some(s => nrIsFileSrc(window.NPJ.SOURCES[s.key])) && (
              <button onClick={() => setExplorer({ key: null })} title="Open the file explorer — read every uploaded source" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><I.folder style={{ fontSize: 12 }} /> Browse files</button>
            )}
          </div>
          {(() => { const nq = needsQuoteCount(); return nq ? (
            <div className="np-mono" style={{ fontSize: 10.5, color: NR.warn, lineHeight: 1.5, border: "1px solid " + NR.warn, padding: "8px 9px", marginBottom: 12 }}>
              ⚑ {nq} cited span{nq === 1 ? "" : "s"} still point at a whole page. Click the flagged span{nq === 1 ? "" : "s"} in the draft and pin the exact words in the source — Citey can find them.
            </div>
          ) : null; })()}
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
            <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 8, lineHeight: 1.5 }}>Sourcing is manual and two-sided: select the exact words in your draft, bind a source, then <b>pin the exact words IN the source</b> that back the claim. You can't cite a whole page. One source can back several spans.</div>
          </div>

          {sources.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6, padding: "0 2px" }}>No sources yet. Ingest a URL or upload a document, then highlight a claim and bind it.</div>}
          {sources.map(s => {
            const rec = window.NPJ.SOURCES[s.key] || { id: s.key, title: s.key, outlet: "" };
            const n = citeNum(s.key); const cnt = spanCount(s.key); void rev;
            const unpinned = ed.current ? Array.from(ed.current.querySelectorAll('.claim-src[data-src="' + s.key + '"]')).filter(el => !(el.getAttribute("data-quote") || "").trim()).length : 0;
            const reviewSt = piiGated(s.key) ? piiReviewState(s.key) : null;
            return (
              <div key={s.key} style={{ border: "1px solid " + NR.line, padding: "9px 10px", marginBottom: 8, background: NR.field }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  {n > 0 && <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{n}</span>}
                  {s.uploading ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn, display: "inline-flex", alignItems: "center", gap: 4 }}><Spinner /> storing file</span>
                    : s.snapshotting ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn, display: "inline-flex", alignItems: "center", gap: 4 }}><Spinner /> snapshotting</span>
                    : s.archived ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.ok }}>● archived</span>
                    : <span className="np-mono" style={{ fontSize: 9.5, color: NR.warn }}>● snapshot only</span>}
                  {nrIsFileSrc(rec) && <span className="np-mono" title={rec.file_url ? "Stored on your account" : "In this browser only — sign-in stores it to your account"} style={{ fontSize: 8.5, color: NR.soft, border: "1px solid " + NR.line, padding: "0 5px", textTransform: "uppercase", letterSpacing: ".04em" }}>{window.NpjSourceView.kindLabel(rec)}{!rec.file_url && !s.uploading ? " · local" : ""}</span>}
                  {s.uploadErr && <span className="np-mono" title={s.uploadErr} style={{ fontSize: 8.5, color: NR.warn, border: "1px solid " + NR.warn, padding: "0 5px" }}>storage failed</span>}
                  {(reviewSt === "pending" || reviewSt === "unscanned") && <button onClick={() => setRedactTarget(s.key)} title="Citey reviews this for PII before it can be archived" className="np-mono" style={{ fontSize: 9, color: NR.warn, border: "1px solid " + NR.warn, background: "transparent", padding: "1px 5px", cursor: "pointer" }}>⚑ PII review</button>}
                  {reviewSt === "reviewed" && <span className="np-mono" style={{ fontSize: 9, color: NR.ok }} title="Citey's PII review is done — cleared to archive">✓ PII reviewed</span>}
                  <span style={{ flex: 1 }} />
                  {cnt > 0 && <span className="np-mono" style={{ fontSize: 9.5, color: unpinned ? NR.warn : NR.soft }}>{cnt} span{cnt !== 1 ? "s" : ""}{unpinned ? " · " + unpinned + " ⚑" : ""}</span>}
                </div>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.1, color: NR.text }}>{rec.title}</div>
                <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, marginTop: 2 }}>{rec.outlet}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onMouseDown={e => e.preventDefault()} onClick={() => bindSource(s.key)} disabled={s.snapshotting}
                    title="Select the words this source backs, then click — or click first and grab the words next"
                    className="np-cond" style={{ flex: 1, background: armSrc === s.key ? "var(--yellow)" : "transparent", border: "1px solid " + (armSrc === s.key ? "var(--yellow)" : NR.line), color: armSrc === s.key ? "var(--ink)" : NR.text, padding: "4px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>{armSrc === s.key ? "Grab the words…" : "Cite span"}</button>
                  {nrIsFileSrc(rec) && <button onClick={() => setExplorer({ key: s.key })} title="Open and read this file" className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><I.eye style={{ fontSize: 12 }} /> View</button>}
                  {!s.archived && !s.snapshotting && <button onClick={() => tryArchive(s)} title={needsPiiReview(s.key) ? "Citey reviews this for PII first, then archives" : "Archive this source to archive.org"} className="np-cond" style={{ background: "transparent", border: "1px solid " + NR.warn, color: NR.warn, padding: "4px 9px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, cursor: "pointer" }}>{needsPiiReview(s.key) ? "Review &amp; archive" : "Archive"}</button>}
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
          <FB onClick={() => exec("formatBlock", "<blockquote>")} title="Quote"><I.quote style={{ fontSize: 13 }} /></FB>
          <span style={{ width: 1, height: 18, background: "rgba(255,255,255,.2)", margin: "0 3px" }} />
          <FB hot={menu === "link"} onClick={() => setMenu(menu === "link" ? null : "link")} title="Add a link or jump-link"><I.link style={{ fontSize: 13 }} /> Link</FB>
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

      {/* pin the source-span: the exact words IN the source that back the claim.
          A page is not a citation — this is what makes it one. */}
      {pinTarget && (() => { const rec = window.NPJ.SOURCES[pinTarget.key] || {}; const ready = !!String(pinQuote || "").trim(); return (
        <div className="fade-in" style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 4400, width: 560, maxWidth: "94vw", background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--yellow)", boxShadow: "0 16px 40px rgba(0,0,0,.55)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="np-mono" style={{ fontSize: 11, color: "var(--yellow)", flex: "0 0 auto" }}><I.source style={{ fontSize: 13, verticalAlign: "-2px" }} /> Pin the source-span</span>
            <span className="np-mono" style={{ fontSize: 10.5, opacity: .7, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.title || pinTarget.key}{rec.outlet ? " · " + rec.outlet : ""}</span>
            <button onClick={closePin} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 15, cursor: "pointer", lineHeight: 1 }}><I.x /></button>
          </div>
          {pinTarget.claimText && (
            <div style={{ fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.4, color: "rgba(255,255,255,.78)", borderLeft: "2px solid var(--yellow)", paddingLeft: 8, marginBottom: 9 }}>
              <span className="np-mono" style={{ fontSize: 9.5, color: "var(--yellow)", display: "block", marginBottom: 2 }}>YOUR CLAIM</span>
              “{pinTarget.claimText.length > 180 ? pinTarget.claimText.slice(0, 180) + "…" : pinTarget.claimText}”
            </div>
          )}
          <div className="np-mono" style={{ fontSize: 10, color: "rgba(255,255,255,.6)", marginBottom: 5 }}>Highlight the exact words in the source below to mint the citation — or type/paste them here.</div>
          <textarea value={pinQuote} onChange={e => { setPinQuote(e.target.value); pinLoc.current = null; }} placeholder="The supporting words, quoted verbatim from the source…"
            style={{ width: "100%", minHeight: 52, resize: "vertical", border: "1px solid rgba(255,255,255,.3)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, padding: "8px 9px", outline: "none", boxSizing: "border-box" }} />
          {/* render the source and select-to-cite (+ Citey's smarter ranking) */}
          {window.SourcePicker && (
            <window.SourcePicker srcKey={pinTarget.key} claimText={pinTarget.claimText}
              onPick={(quote, loc) => { setPinQuote(quote); pinLoc.current = loc || null; }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
            <span style={{ flex: 1 }} />
            <button onClick={closePin} className="np-cond" style={{ flex: "0 0 auto", background: "transparent", color: "var(--paper)", border: "1px solid rgba(255,255,255,.3)", padding: "6px 11px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Later</button>
            <button onClick={() => savePin(pinLoc.current)} disabled={!ready} className="np-cond" style={{ flex: "0 0 auto", background: ready ? "var(--paper)" : "rgba(255,255,255,.15)", color: ready ? "var(--ink)" : "rgba(255,255,255,.5)", border: "1px solid " + (ready ? "var(--paper)" : "rgba(255,255,255,.2)"), padding: "6px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: ready ? "pointer" : "default" }}>Pin span</button>
          </div>
        </div>
      ); })()}

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

      {explorer && window.SourceExplorer && (
        <window.SourceExplorer
          title="Source files — this article"
          initialKey={explorer.key}
          items={sources.filter(s => nrIsFileSrc(window.NPJ.SOURCES[s.key])).map(s => ({ key: s.key, rec: window.NPJ.SOURCES[s.key] || {} }))}
          onClose={() => { setExplorer(null); setSources(x => [...x]); }} />
      )}
      {showVersions && <window.VersionHistory versions={versions} onClose={() => setShowVersions(false)} />}
      {redactTarget && window.CiteyRedactModal && <window.CiteyRedactModal srcKey={redactTarget}
        onClose={() => { redactNext.current = null; setRedactTarget(null); setSources(s => [...s]); }}
        onDone={() => { const s = redactNext.current; redactNext.current = null; setRedactTarget(null); setSources(x => [...x]); if (s && !needsPiiReview(s.key)) setArchiveTarget(s); }} />}
      {archiveTarget && <ArchiveModal srcKey={archiveTarget.key} items={[{ name: (window.NPJ.SOURCES[archiveTarget.key] || {}).title || archiveTarget.key }]} onClose={() => setArchiveTarget(null)} onDone={() => { onArchived(archiveTarget.key); setArchiveTarget(null); }} />}
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

  // Already in the committed record? Then this gate is a REPUBLISH, not a first
  // publish — the copy + step labels + confirm button adapt so it never claims
  // "nothing has been published yet" about a piece that's already live. Reactive
  // to the slug field, so renaming the doc to an existing slug flips the gate.
  const liveMeta = (window.NpjArticles && window.NpjArticles.publishedMeta) ? window.NpjArticles.publishedMeta(slug) : null;
  const isRepublish = !!liveMeta;
  const liveUnpublished = isRepublish && liveMeta.status === "unpublished";

  // ---- byline: who the piece is credited to (outward-facing) ----
  // You type the name readers see (defaults to your own); your account id is what
  // gets stored on the record. Editors are an optional separate "Edited by"
  // credit. "Publish unsigned" ships with no author.
  const meMx = (session && session.user_id) || ((window.MatrixAuth.current() || {}).user_id) || "";
  const parseMx = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(x => /^@[^:]+:[^:]+$/.test(x));
  const nameOfMx = (m) => (window.npjPerson ? window.npjPerson(m).name : String(m).replace(/^@/, "").split(":")[0]);
  const [unsigned, setUnsigned] = useState(false);
  // Byline is a plain name now — type how you want to be credited. It defaults
  // to your profile display name. Whatever name you show, your Matrix id (meMx)
  // is recorded as the author on the committed record, so attribution survives.
  const defaultName = meMx ? nameOfMx(meMx) : "";
  const [nameInput, setNameInput] = useState(defaultName);
  const [editorsInput, setEditorsInput] = useState("");
  const bylineEditors = parseMx(editorsInput);
  // the userid stored on the backend record — you, the signed-in publisher
  const bylineAuthors = meMx ? [meMx] : [];
  // Publishing under your own name keeps the rich contributor chip (the byline
  // resolves from your id); a free-text override is stored only when you type a
  // name different from your own — either way the userid above is what's saved.
  const typedName = nameInput.trim();
  const bylineOverride = typedName && typedName !== defaultName ? typedName : "";

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
    let unpinned = 0;
    cites.forEach(n => {
      const k = n.getAttribute("data-cite");
      const rec = window.NPJ.SOURCES[k];
      if ((!rec || !(rec.archive_url || rec.original_url)) && missing.indexOf(k) < 0) missing.push(k);
      // every bound span must point at the exact words in the source, not just
      // the page — a span with no pinned quote fails the build
      if (!(n.getAttribute("data-quote") || "").trim()) unpinned++;
    });
    const archived = (sources || []).filter(s => s.archived || ((window.NPJ.SOURCES[s.key] || {}).archive_url)).length;
    // images still on the media store get moved onto archive.org at publish
    const onStore = Array.from(root.querySelectorAll("figure image-slot")).filter(slot => {
      const s = slot.getAttribute("src");
      return s && window.NpjMedia && window.NpjMedia.isStoreUrl(s);
    }).length;
    return { content: c, dek, words, spans: cites.length, missing, unpinned, srcTotal: (sources || []).length, archived, mediaToFreeze: onStore };
  }, []);

  const [phase, setPhase] = useState("confirm");          // confirm | run
  const [outcome, setOutcome] = useState(null);           // null | {ok:true} | {ok:false,msg}
  const [steps, setSteps] = useState(() => ([
    { code: "EVA", label: isRepublish ? "Pull the updated piece" : "Pull the finished piece", detail: isRepublish ? "draft → EO event (INS — a new version; the fold restarts from it)" : "draft → EO event (INS — the genesis line)", state: "wait" },
    { code: "SEG", label: "Build: resolve & pin every bound span", detail: flight.spans + " bound span" + (flight.spans === 1 ? "" : "s") + " to check", state: "wait" },
    { code: "INS", label: "Sources archived on archive.org", detail: flight.srcTotal ? flight.archived + " of " + flight.srcTotal + " archived" : "no sources bound", state: "wait", sources: true },
    { code: "DEF", label: "Commit the EO event log to GitHub", detail: "→ clovenbradshaw-ctrl/npj · articles/" + slug + "/", state: "wait" },
    { code: "REC", label: "Live & open to suggestion", detail: articleUrl, state: "wait" }
  ]));
  const published = useRef(null); // the folded article, for "open it" without re-fetching
  const payloadRef = useRef(null); // {slug,line,token,message} — held so "Retry publish" re-POSTs the exact same payload
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const upd = (i, patch) => { if (alive.current) setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s)); };
  const halt = (i, detail, msg) => { upd(i, { state: "fail", detail }); if (alive.current) setOutcome({ ok: false, msg }); };
  const tick = (ms) => new Promise(r => setTimeout(r, ms));

  // verify-after-publish: a 200 means the commit landed, but the raw URL is a
  // CDN — confirm it's serving readable JSONL, not a double-base64'd blob. A
  // 404 / network miss right after the commit is just CDN lag, not a failure,
  // so those return null (no flag). The signal we DO flag: a first line that
  // starts with "eyJ" (base64 of '{') instead of '{' — the workflow encoded the
  // body twice and the article won't parse.
  const verifyRaw = async (filename) => {
    try {
      const url = window.NpjArticles.RAW_BASE + "/" + filename + "?cb=" + Date.now();
      const txt = await fetch(url, { cache: "no-store" }).then(r => r.ok ? r.text() : null);
      if (txt == null) return null;
      const first = (txt.split("\n", 1)[0] || "").trim();
      if (!first) return null;
      if (/^eyJ/.test(first)) return {
        short: "raw file is base64, not JSON — double-encoded",
        msg: "The commit landed, but the published file starts with “eyJ”, not “{” — the workflow base64-encoded the body twice, so the article won't parse. Don't rely on the link until the workflow's encoding is fixed."
      };
      try { if (JSON.parse(first).op) return null; } catch (e) {}
      return {
        short: "raw file's first line isn't the genesis event",
        msg: "The commit landed, but the raw URL's first line didn't parse as the genesis JSONL event. It may be a stale CDN copy — re-check the file before sharing the link."
      };
    } catch (e) { return null; }
  };

  // The commit itself, factored out so "Retry publish" can re-POST the EXACT
  // same payload — including the same pre-generated version filename, so a
  // retry never mints a second file. Every publish CREATES a new file in
  // articles/<slug>/ (nothing is updated in place), which is what retired the
  // GitHub update-rejection failures. Success is the JSON body's `ok` flag —
  // NOT a bare HTTP 200 — because the webhook reports a failed GitHub commit
  // honestly, with the real status and message, instead of a lying 200.
  const commit = async () => {
    const p = payloadRef.current; if (!p) return;
    if (alive.current) setOutcome(null);
    upd(3, { state: "active", detail: "→ clovenbradshaw-ctrl/npj · " + p.filename });
    let res;
    try {
      res = await window.NpjArticles.publishGenesis(p);
    } catch (e) { return halt(3, "webhook unreachable", "Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing was committed."); }
    const data = await res.json().catch(() => null);
    const success = res.status === 200 && data && data.ok === true;
    if (!success) {
      let msg, detail;
      if (res.status === 401) {
        detail = "rejected — session invalid (401)";
        msg = "Your Matrix session isn't valid for publishing — sign in again.";
      } else if (res.status === 403 && data && data.error === "not an assignee on this article") {
        detail = "rejected — not an assignee (403)";
        msg = "You're signed in as " + (data.user || "your account") + " (" + (data.role || "no role") + "), but this article's genesis doesn't list you as an assignee.";
      } else if (data && data.gh_status) {
        detail = "GitHub " + data.gh_status + " — commit rejected";
        msg = "GitHub rejected the commit (" + data.gh_status + "): " + (data.error || "no message") + ". Nothing was written.";
      } else {
        detail = "HTTP " + res.status;
        msg = "The publish webhook answered " + res.status + ((data && data.error) ? " — " + data.error : "") + ". Nothing was committed.";
      }
      // 409/422 is a SHA race, not a dead end — offer a single re-POST.
      const retry = !!(data && (data.gh_status === 409 || data.gh_status === 422));
      upd(3, { state: "fail", detail });
      if (alive.current) setOutcome({ ok: false, msg, retry });
      return;
    }
    // committed for real — persist the receipt (the SHA the webhook just wrote)
    const sha = data.commit_sha || null;
    const filename = data.filename || p.filename;
    try { window.NpjArticles.saveReceipt({ filename, commit_sha: sha, bytes: data.bytes, published_at: new Date().toISOString() }); } catch (e) {}
    const shaTag = sha ? " @ " + sha.slice(0, 7) : "";
    upd(3, { state: "done", detail: "committed to clovenbradshaw-ctrl/npj · " + filename + shaTag });
    // 5 — live once Pages redeploys; confirm the raw file is readable JSONL
    upd(4, { state: "active", detail: articleUrl + (sha ? " · committed @ " + sha.slice(0, 7) : "") });
    await tick(400);
    const warn = await verifyRaw(filename);
    upd(4, { state: warn ? "fail" : "done", detail: warn ? warn.short : articleUrl + (sha ? " · committed @ " + sha.slice(0, 7) : "") });
    if (alive.current) setOutcome({ ok: true, sha, warn: warn ? warn.msg : null });
  };

  const run = async () => {
    setPhase("run");
    // the gate may have renamed the document after the steps were initialized
    upd(3, { detail: "→ clovenbradshaw-ctrl/npj · articles/" + slug + "/" });
    upd(4, { detail: articleUrl });
    // 1 — pull the piece
    upd(0, { state: "active" }); await tick(400);
    if (!flight.words) return halt(0, "the draft is empty", "Write the piece first — there's no text to publish.");
    upd(0, { state: "done", detail: flight.words + " words → articles/" + slug + "/" });
    // 2 — build: every bound span must resolve to a source record AND pin the
    // exact words in that source (you can't cite a whole page)
    upd(1, { state: "active" }); await tick(400);
    // Grounding gaps used to fail the build here. The author asked to be warned,
    // not walled — so unresolved / unpinned spans now pass with a warning and ship.
    const buildNotes = [];
    if (flight.missing.length) buildNotes.push(flight.missing.length + " unresolved");
    if (flight.unpinned) buildNotes.push(flight.unpinned + " unpinned");
    if (buildNotes.length) upd(1, { state: "warn", detail: flight.spans + " span" + (flight.spans === 1 ? "" : "s") + " · " + buildNotes.join(" · ") + " · published ungrounded ⚠" });
    else upd(1, { state: "done", detail: flight.spans + " span" + (flight.spans === 1 ? "" : "s") + " · 0 unresolved · 0 unpinned · build passed ✓" });
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
    // archive URLs found in step 3) into ONE EO event: the INS genesis, written
    // as a brand-new timestamped file in articles/<slug>/. Every later edit
    // lands as another version file in the same folder, so the folder is the
    // article's complete change history — and no commit ever has to update an
    // existing file. Authority is re-verified server-side by the webhook.
    upd(3, { state: "active", detail: flight.mediaToFreeze ? ("moving " + flight.mediaToFreeze + " image" + (flight.mediaToFreeze === 1 ? "" : "s") + " to archive.org — this can take up to a minute each…") : ("→ clovenbradshaw-ctrl/npj · articles/" + slug + "/") });
    const actor = (session && session.user_id) || ((window.MatrixAuth.current() || {}).user_id) || null;
    const gen = window.NpjArticles.genesisFromContent(flight.content, {
      slug, headline: title, actor,
      // authors carries the userid (meMx); byline overrides the shown name only
      // when it was customized away from the contributor's own resolved name
      authors: bylineAuthors, editors: bylineEditors,
      byline: unsigned ? "Unsigned" : bylineOverride
    });
    // move any media-store images onto archive.org (download + reupload, or the
    // Wayback fallback), then rebuild the genesis line from the mutated operand
    // so the committed body hotlinks archive.org — never the media store.
    let line = gen.line, froze = null;
    if (window.NpjMedia && window.NpjMedia.freezeArticleMedia) {
      let freezeErr = null;
      try {
        froze = await window.NpjMedia.freezeArticleMedia(gen.operand.body, { slug, title });
      } catch (e) { freezeErr = e; }
      if (freezeErr || (froze && froze.failed)) {
        const why = freezeErr ? freezeErr.message
          : (froze.failReasons && froze.failReasons.length ? froze.failReasons.join("; ") : "");
        const detail = "image freeze failed" + (why ? ": " + why : "");
        const msg = "Could not move " + (froze ? froze.failed : "an") + " image" + ((froze && froze.failed !== 1) ? "s" : "") +
          " to archive.org — nothing was committed. " +
          (why ? why + " " : "") +
          "Check that the n8n media endpoint is reachable and that IA_S3_ACCESS / IA_S3_SECRET are set, then retry.";
        return halt(3, detail, msg);
      }
      if (froze && froze.frozen) {
        line = window.NpjArticles.genesisLine(gen.operand, actor);
        gen.article = window.NpjArticles.foldLog(line).article;
      }
    }
    published.current = gen.article;
    const token = window.MatrixAuth.token();
    if (!token) return halt(3, "no verified Matrix session", "Sign in with your admin Matrix account to publish.");
    // hold the payload (with any archive.org-frozen image srcs) AND the
    // generated version filename, so a retry re-POSTs the same bytes to the
    // same path instead of creating a second version file
    payloadRef.current = { slug, line, token, message: (isRepublish ? "republish: " : "publish: ") + slug, filename: window.NpjArticles.versionFilenameFor(slug, "ins") };
    upd(3, { detail: "→ clovenbradshaw-ctrl/npj · " + payloadRef.current.filename });
    await commit();
  };

  const srcKeys = (sources || []).map(s => s.key);
  // An empty draft has nothing to ship — that stays a hard wall. Grounding gaps
  // no longer block the gate: they raise a warning and the author publishes anyway.
  const blocked = !flight.words ? "The draft is empty — there's nothing to publish yet." : null;
  const groundWarn = (() => {
    const parts = [];
    if (flight.missing.length) parts.push(flight.missing.length + " bound span" + (flight.missing.length === 1 ? " has" : "s have") + " no source record (" + flight.missing.slice(0, 3).join(", ") + (flight.missing.length > 3 ? "…" : "") + ")");
    if (flight.unpinned) parts.push(flight.unpinned + " bound span" + (flight.unpinned === 1 ? " cites" : "s cite") + " a source without pinning the exact words");
    if (!parts.length) return null;
    return parts.join("; ") + ". You can publish anyway — these claims ship ungrounded, not held back.";
  })();
  // shipping with ungrounded claims is allowed, but it must never look like a
  // clean publish — the primary button turns caution-colored and says so.
  const shipUngrounded = !blocked && !!groundWarn;
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
          <span style={{ fontFamily: "var(--display)", fontSize: 21 }}>{isRepublish ? "REPUBLISH BOUNDARY" : "PUBLISH BOUNDARY"}</span>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 11 }}>GitHub + archive.org</span>
        </div>

        {phase === "confirm" && (
          <div style={{ padding: "20px 22px" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, color: NR.text, marginBottom: 4 }}>ONE LAST LOOK</div>
            <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5, marginBottom: 12 }}>{
              isRepublish
                ? (liveUnpublished
                    ? "This piece is in the record but unpublished. Confirming commits a new version to its event log and returns it to the site — every prior version stays in the public record."
                    : "This piece is already live. Confirming commits an updated version to its event log — it replaces what's on the site the moment you confirm, and every prior version stays in the public record.")
                : "Nothing has been published yet. This is what goes out the moment you confirm — committed to the public repo and served on GitHub Pages."
            }</div>
            <Row k="Folder">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <input value={slugVal} onChange={e => editSlug(e.target.value)} placeholder={auto} title="Name the document anything — it doesn't have to match the headline" className="np-mono" spellCheck={false}
                  style={{ width: "min(300px, 56vw)", border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 12, outline: "none" }} />
                <span className="np-mono" style={{ fontSize: 11 }}>/</span>
                <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>→ clovenbradshaw-ctrl/npj · articles/{slugVal !== slug ? " · saved as " + slug + "/" : ""} — each publish &amp; edit lands as a timestamped version file inside it</span>
              </span>
            </Row>
            <Row k="Live at">{articleUrl}</Row>
            <Row k="Headline">{title || "Untitled"}</Row>
            <Row k="Subtitle">{flight.dek || "—"}</Row>
            <Row k="Column">{flight.content.column || "—"}</Row>
            <Row k="Tags">{(flight.content.tags || []).length ? flight.content.tags.map(t => "#" + t).join("  ") : "—"}</Row>
            {/* Byline — type the name readers see; your account id is recorded
                on the backend either way. Editors optional; can be Unsigned. */}
            <div style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid " + NR.line, alignItems: "baseline" }}>
              <span className="np-eyebrow" style={{ color: NR.muted, flex: "0 0 86px" }}>Byline</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5, color: NR.text }}>
                  {unsigned || (!typedName && !defaultName) ? "Unsigned" : "By " + (typedName || defaultName)}
                  {bylineEditors.length ? <span style={{ color: NR.muted }}>{"  ·  Edited by " + bylineEditors.map(nameOfMx).join(", ")}</span> : null}
                </div>
                {!unsigned && (
                  <React.Fragment>
                    <input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Your name"
                      style={{ width: "100%", boxSizing: "border-box", marginTop: 6, border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 13, fontFamily: "var(--cond)", outline: "none" }} />
                    <div className="np-mono" style={{ fontSize: 9, color: NR.muted, margin: "3px 0 0", lineHeight: 1.5 }}>The name readers see. {meMx ? "Recorded on the record as " + meMx + "." : "Sign in so your account is recorded with the byline."}</div>
                  </React.Fragment>
                )}
                <input value={editorsInput} onChange={e => setEditorsInput(e.target.value)} placeholder="@editor:server  (optional)" className="np-mono" spellCheck={false}
                  style={{ width: "100%", boxSizing: "border-box", marginTop: 6, border: "1px solid " + NR.line, background: NR.field, color: NR.text, padding: "5px 7px", fontSize: 12, outline: "none" }} />
                <div className="np-mono" style={{ fontSize: 9, color: NR.muted, margin: "3px 0 0", lineHeight: 1.5 }}>Edited by · optional, shown as a separate credit line.</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={unsigned} onChange={e => setUnsigned(e.target.checked)} />
                  <span className="np-mono" style={{ fontSize: 10.5, color: NR.text }}>Publish unsigned — no author credit</span>
                </label>
              </div>
            </div>
            <Row k="Length">{flight.words} words</Row>
            <Row k="Sources">{flight.srcTotal ? flight.srcTotal + " bound · " + flight.archived + " archived" + (flight.srcTotal - flight.archived ? " · " + (flight.srcTotal - flight.archived) + " snapshot-only" : "") : "none"}</Row>
            <Row k="Spans">{flight.spans} cited span{flight.spans === 1 ? "" : "s"}{flight.missing.length ? " · " + flight.missing.length + " unresolved" : ""}{flight.unpinned ? " · " + flight.unpinned + " not pinned to source" : ""}</Row>
            {flight.mediaToFreeze > 0 && <Row k="Images">{flight.mediaToFreeze} on the media store · moved to archive.org on publish (Wayback Machine fallback if direct upload is unavailable)</Row>}
            {blocked && <div className="np-mono" style={{ fontSize: 11, color: NR.warn, lineHeight: 1.5, margin: "12px 0 0", border: "1px solid " + NR.warn, padding: "9px 10px" }}>{blocked}</div>}
            {!blocked && groundWarn && <div className="np-mono" style={{ fontSize: 11, color: NR.warn, lineHeight: 1.5, margin: "12px 0 0", border: "1px solid " + NR.warn, padding: "9px 10px", display: "flex", gap: 8 }}><span aria-hidden="true">⚠</span><span>{groundWarn}</span></div>}
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: NR.text, border: "1px solid " + NR.line, padding: "10px 16px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>Not yet — back to editor</button>
              <button onClick={blocked ? undefined : run} disabled={!!blocked} className="np-cond" style={{ background: (blocked || shipUngrounded) ? "transparent" : "var(--yellow)", color: blocked ? NR.muted : shipUngrounded ? NR.warn : "var(--ink)", border: "1.5px solid " + (blocked ? NR.line : shipUngrounded ? NR.warn : "var(--ink)"), padding: "10px 18px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: blocked ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}><I.lock style={{ fontSize: 14 }} /> {shipUngrounded ? (isRepublish ? "Republish ungrounded" : "Publish ungrounded") : (isRepublish ? "Republish it" : "Publish it")}</button>
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
                    : s.state === "warn" ? <span style={{ fontSize: 16, color: NR.warn }}>⚠</span>
                    : s.state === "active" ? <Spinner />
                    : <span style={{ fontFamily: "var(--mono)", color: NR.muted }}>{window.NPJ.EO.glyph(s.code)}</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--cond)", fontSize: 16, color: (s.state === "fail" || s.state === "warn") ? NR.warn : NR.text, fontWeight: 600 }}>{s.label}</div>
                  <div className="np-mono" style={{ fontSize: 10.5, color: (s.state === "fail" || s.state === "warn") ? NR.warn : NR.muted, marginTop: 2, overflowWrap: "anywhere" }}>{s.detail}</div>
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
                      <div style={{ fontFamily: "var(--display)", fontSize: 26, color: outcome.warn ? NR.warn : "var(--yellow)", marginBottom: 4 }}>{outcome.warn ? "COMMITTED — CHECK THE FILE" : "COMMITTED — GOING LIVE"}</div>
                      <div className="np-mono" style={{ fontSize: 11, color: outcome.warn ? NR.warn : NR.muted, marginBottom: outcome.sha ? 8 : 16, lineHeight: 1.5 }}>{outcome.warn || (isRepublish ? ("articles/" + slug + "/ has a new version in clovenbradshaw-ctrl/npj — every prior version stays in that folder. The front page reflects the update and the link below opens the formatted reader.") : ("articles/" + slug + "/ is in clovenbradshaw-ctrl/npj — version 1 of the article's event log. Every future edit lands as another timestamped version file in that folder. The front page lists it and the link below opens the formatted reader."))}</div>
                      {outcome.sha && <div className="np-mono" style={{ fontSize: 10.5, color: NR.soft, marginBottom: 16 }}>committed @ {outcome.sha.slice(0, 7)}</div>}
                      {!outcome.warn && (
                        <div style={{ display: "inline-block", textAlign: "left", marginBottom: 18 }}>
                          <ShareBar dark url={articleUrl} archiveUrl={"https://web.archive.org/save/" + window.npjArticleLogUrl(published.current || slug)} title={title} />
                        </div>
                      )}
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
                  {!outcome.ok && outcome.retry && (
                    <button onClick={commit} className="np-cond" style={{ background: "var(--yellow)", color: "var(--ink)", border: "1.5px solid var(--ink)", padding: "10px 18px", fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <I.lock style={{ fontSize: 14 }} /> Retry publish
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
      const okImg = img && (window.NpjMedia ? window.NpjMedia.isPublishable(img)
        : (window.NpjArchiveCDN && window.NpjArchiveCDN.isMediaUrl(img)));
      if (okImg)
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
