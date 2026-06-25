/* ============================================================
   GroundingWorkspace.jsx — the grounding workspace (v2 of the sentence table).

   One draft, four pivoting views of its grounding record:
     · Grounding — every sentence as a row: status, citations, stance
     · Citations — the registry of reusable records (pinned spans of sources)
     · Sources   — the documents themselves: read, search, and grab the exact
                   words that back a claim (multi-part spans supported)
     · Prose     — the editor (leaving the workspace); the side panel can show
                   a compact status-shaded preview of the draft at all times

   The main stage shows one view; a side panel shows another, and cross-view
   actions PIVOT the panel: select a sentence → its grounding card; "+ Cite" →
   the cite modal; "In context" → the quote inside its source; "Usage ×n" →
   the sentences a record backs. Citey walks the un-grounded sentences
   ("cite everything") with a center-stage card: pin a quote or own the claim.

   Everything is mechanical — status is read off the draft's own claim spans
   (CiteyBrain), candidate passages are word-overlap ranked (CiteyAssist), and
   a citation is only ever minted from words the AUTHOR selected in the source.

   Mounts: <GroundingWorkspace api={tableApi} NR view setView isMobile />.
   Mutations route through the Newsroom's api → the same DOM + autosave the
   prose editor uses, so the views never diverge. Publishes window.GroundingWorkspace.
   ============================================================ */

(() => {
const VIEWS = [["prose", "Prose"], ["grounding", "Grounding"], ["citations", "Citations"], ["sources", "Sources"]];
const STANCE_GLYPH = { voice: "⊩", testimony: "⊨", analysis: "⊢", context: "⊪", absence: "∅" };
const STANCE_LABEL = { voice: "Your voice", testimony: "Your account", analysis: "Your analysis", context: "In context", absence: "A documented void" };
const STANCE_OPTS = [["voice", "Argue — your voice ⊩"], ["testimony", "Assert — your account ⊨"], ["analysis", "Infer — your analysis ⊢"], ["context", "Continue — in context ⊪"]];
const DOT = { grounded: "#1F9E76", multi: "#6ea8d8", owned: "#7C74DE", needs: "#D8632E", conflict: "#D8412C" };
const CONTEXT_TEAL = "#2E8B86";

// The source adapter (treat-as-image + OCR on/off/edit) lives in its own READ-tier
// file, window.SourceAdapter (app/SourceAdapter.jsx), so the file explorer can use
// it too. It supersedes the old in-file OcrEditor. Rendered under the reader below.

// Status pill (solid backgrounds read in both newsroom themes).
function pillFor(st) {
  if (st.key === "conflict") return { glyph: "¬", label: "Sources disagree", fg: "#b3261e", bg: "#fdecea" };
  if (st.key === "multi") return { glyph: "⊨", label: st.nSrc + " sources", fg: "#3a63c4", bg: "#e8eefb" };
  if (st.key === "grounded") return { glyph: "⊤", label: "Grounded", fg: "#1f8a55", bg: "#e7f4ec" };
  if (st.key === "owned" && st.stance === "context") return { glyph: "⊪", label: "In context", fg: "#1f7d78", bg: "#e6f4f3" };
  if (st.key === "owned" && st.stance === "absence") { const VK = window.NpjVoidKinds; const vk = VK ? VK.norm(st.vkind) : null; return { glyph: vk ? VK.glyph(vk) : "∅", label: vk ? VK.label(vk) + " void" : "A documented void", fg: "#8a6a1f", bg: "#f3ecda" }; }
  if (st.key === "owned") return { glyph: STANCE_GLYPH[st.stance] || "⊩", label: STANCE_LABEL[st.stance] || "Your voice", fg: "#6b5bd6", bg: "#efeafc" };
  return { glyph: "⊥", label: "Needs source", fg: "#b5701b", bg: "#fbf1e3" };
}

// Aggregate a sentence's grounding status off its live claim spans — mechanical,
// same read as the publish gate (CiteyBrain), no model.
function statusOf(row) {
  const Brain = window.CiteyBrain;
  const spans = row.claimSpans || [];
  let stance = null, conflict = false, needs = false, vkind = null; const keys = {}; const ctx = {};
  spans.forEach(s => {
    (window.NpjCitations ? window.NpjCitations.contextKeys(s) : []).forEach(k => { ctx[k] = 1; });
    let v = { state: "falsum" };
    try { v = Brain.citeyStateForSpan({ el: s }); } catch (e) {}
    if (v.state === "asserted" || v.state === "testimony" || v.state === "voice" || v.state === "context" || v.state === "absence") { stance = s.getAttribute("data-stance") || "analysis"; if (v.state === "absence") vkind = s.getAttribute("data-void-kind") || vkind; }
    else if (v.state === "verum" || v.state === "entails") String(v.srcKey || s.getAttribute("data-src") || "").split(/\s+/).filter(Boolean).forEach(k => { keys[k] = 1; });
    else if (v.state === "negation") conflict = true;
    else needs = true;
  });
  const n = Object.keys(keys).length;
  const context = Object.keys(ctx);
  let out;
  if (conflict) out = { key: "conflict", spans };
  else if (stance && !n && !needs) out = { key: "owned", stance, spans, vkind };
  else if (n && !needs) out = { key: n > 1 ? "multi" : "grounded", nSrc: n, spans };
  else out = { key: "needs", spans };
  out.context = context;
  return out;
}

// Best mechanical match between a claim and a candidate quote (CiteyAssist; 0 when unavailable).
function matchScore(claim, quote) {
  if (!window.CiteyAssist) return 0;
  try { const h = window.CiteyAssist.rankSpans(claim, quote); return h.length ? h[0].score : 0; } catch (e) { return 0; }
}
function clip(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }

// the sentence's stable identity, drawn small. The id (sn-…) follows the
// sentence through edits/moves/reloads; the tooltip spells out its provenance.
function shortId(sid) { return String(sid || "").replace(/^(sn|se)-/, "").slice(0, 8); }
function provTip(row) {
  const p = (row && row.provenance) || {};
  const d = (ms) => { try { return ms ? new Date(ms).toLocaleString() : "—"; } catch (e) { return "—"; } };
  const lines = ["Stable id " + (row.sid || "?") + " — follows this sentence through edits, moves and reloads, carrying its citations and stance."];
  lines.push("First imported: " + d(p.firstSeen));
  lines.push(p.groundedAt ? "First grounded: " + d(p.groundedAt) : "Not yet grounded");
  if (p.citeIds && p.citeIds.length) lines.push(p.citeIds.length + " citation record" + (p.citeIds.length > 1 ? "s" : "") + " linked");
  if (p.stance) lines.push("Owned as: " + p.stance);
  return lines.join("\n");
}
function HashChip({ row, NR }) {
  return (
    <span className="np-mono" title={provTip(row)}
      style={{ fontSize: 8.5, letterSpacing: ".03em", color: NR.muted, border: "1px solid " + NR.line, borderRadius: 4, padding: "1px 5px", cursor: "help", display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
      <window.I.hash style={{ fontSize: 9 }} /> {shortId(row.sid)}
    </span>
  );
}

// ---- Citey, drawn: a bent-wire logic operator whose face IS the state ----
// ⊥ falsum (worried, orange) · ⊢ turnstile (guiding, purple) · ⊤ verum (starry, green)
// Citey, the drawn mascot, is retired for now: the grounding bar, walk stage and
// cite modal keep their copy and actions, just without the character. This stub
// returns null so the sprite vanishes everywhere it was rendered. The original
// drawing is kept (unused) below for an easy restore.
function drawCitey() { return null; }
function drawCiteyRetired(stateName, width, opts) {
  opts = opts || {};
  const star = (x, y) => (
    <path d="M0 -7.5 L1.9 -2.4 L7.2 -2.3 L3 0.9 L4.5 6 L0 2.9 L-4.5 6 L-3 0.9 L-7.2 -2.3 L-1.9 -2.4 Z"
      transform={"translate(" + x + " " + y + ")"} fill="var(--yellow)" stroke="#16140d" strokeWidth={1} />
  );
  const P = {
    bot: ["M30 150 L120 150", "M75 150 L75 52"],
    top: ["M30 52 L120 52", "M75 52 L75 150"],
    turn: ["M48 40 L48 152", "M48 96 L118 96"]
  };
  const cfg = stateName === "verum"
    ? { paths: P.top, color: "#1F9E76", eyes: [[57, 98], [93, 98]], mode: "star" }
    : stateName === "turnstile"
      ? { paths: P.turn, color: "#7C74DE", eyes: [[76, 64], [110, 64]], mode: "up" }
      : { paths: P.bot, color: "#D8632E", eyes: [[57, 86], [93, 86]], mode: "worry" };
  const kids = [];
  cfg.paths.forEach((d, i) => {
    const path = <path key={"pp" + i} d={d} stroke={cfg.color} strokeWidth={14} strokeLinecap="round" fill="none" />;
    // the ⊢ arm waves while Citey guides you
    if (opts.wave && stateName === "turnstile" && i === 1) {
      kids.push(<g key={"p" + i} style={{ animation: "citey-wave 1.5s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "left center" }}>{path}</g>);
    } else kids.push(<g key={"p" + i}>{path}</g>);
  });
  cfg.eyes.forEach((xy, i) => {
    const x = xy[0], y = xy[1];
    if (cfg.mode === "star") {
      kids.push(<g key={"e" + i} style={{ animation: "star-spin 7s linear infinite", transformBox: "fill-box", transformOrigin: "center" }}>{star(x, y)}</g>);
      return;
    }
    const pupilY = cfg.mode === "up" ? y - 3.5 : y + 1;
    kids.push(
      <g key={"e" + i} style={{ animation: "citey-blink 4.6s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "center" }}>
        <circle cx={x} cy={y} r={11} fill="#fffdf6" stroke="rgba(0,0,0,.35)" strokeWidth={1.5} />
        <g style={{ animation: "citey-wander 7s ease-in-out infinite" }}><circle cx={x} cy={pupilY} r={4.4} fill="#16140d" /></g>
      </g>);
    if (cfg.mode === "worry") {
      const inner = i === 0 ? 3 : 0, outer = i === 0 ? 0 : 3;
      kids.push(<path key={"b" + i} d={"M" + (x - 8) + " " + (y - 17 + inner) + " L" + (x + 8) + " " + (y - 17 + outer)} stroke={cfg.color} strokeWidth={3.5} strokeLinecap="round" fill="none" />);
    }
  });
  const anim = (opts.hop ? "citey-hop .9s ease" : "citey-pop .45s ease") + ", citey-bob 3.8s ease-in-out .5s infinite";
  return (
    <svg viewBox="0 0 150 180" width={width} height={Math.round(width * 1.2)} style={{ display: "block", overflow: "visible", flexShrink: 0 }}>
      <g key={stateName + (opts.hop ? "-hop" + opts.hop : "")} style={{ animation: anim, transformBox: "fill-box", transformOrigin: "center bottom" }}>{kids}</g>
    </svg>
  );
}

function GroundingWorkspace({ api, NR, view, setView, isMobile }) {
  const [, force] = useState(0); const bump = () => force(n => n + 1);
  const defaultPanelFor = (v) => ({ grounding: "prose", citations: "sources", sources: "citations" }[v] || "prose");
  const [panel, setPanel] = useState(defaultPanelFor(view));
  const [selSid, setSelSid] = useState(null);
  const [selSrc, setSelSrc] = useState(null);
  const [selCid, setSelCid] = useState(null);
  const [highlightCid, setHighlightCid] = useState(null);
  const [flashSid, setFlashSid] = useState(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [walk, setWalk] = useState(null);          // { cur, n } — the "cite everything" stepper
  const [modal, setModal] = useState(null);        // { sid } — the cite modal; its sid is the ARMED claim
  const [pending, setPending] = useState(null);    // { spans: [{ quote, loc }] } — staged, author-grabbed
  const [armIdx, setArmIdx] = useState(0);
  const [srcQuery, setSrcQuery] = useState("");
  const [srcFindIdx, setSrcFindIdx] = useState(0);
  const [addSrcOpen, setAddSrcOpen] = useState(false);  // the in-modal "add a source" form (URL / file)
  const [addSrcUrl, setAddSrcUrl] = useState("");
  const [addSrcBusy, setAddSrcBusy] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");   // search the whole registry to reuse a record
  const [browseOpen, setBrowseOpen] = useState(false);
  const [renameKey, setRenameKey] = useState(null);     // the source being renamed in the library
  const [renameText, setRenameText] = useState("");
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false); // the "outstanding fact checks" panel
  const [hop, setHop] = useState(null);            // Citey hops when a claim resolves
  const mainRef = useRef(null);
  const srcRefMain = useRef(null); const srcRefPanel = useRef(null); const srcRefModal = useRef(null);
  const timers = useRef({});

  // ---- live data (derived fresh every render — DOM + registry are the truth) ----
  const rows = api.segment() || []; void api.rev;
  const enriched = rows.map(r => ({ row: r, st: statusOf(r) }));
  const srcList = api.sources() || [];
  const allC = api.allCitations() || [];
  const bySid = {}; enriched.forEach(e => { bySid[e.row.sid] = e; });
  const order = rows.map(r => r.sid);
  const needsSids = enriched.filter(e => e.st.key === "needs").map(e => e.row.sid);
  const blockerSids = enriched.filter(e => e.st.key === "needs" || e.st.key === "conflict").map(e => e.row.sid);
  const counts = { grounded: 0, multi: 0, owned: 0, needs: 0, conflict: 0 };
  enriched.forEach(e => { counts[e.st.key]++; });
  const blockers = counts.needs + counts.conflict;

  // refs mirror state so DOM-time handlers (Esc, walk advance) never act on stale layers
  const layers = useRef({}); layers.current = { pending, modal, walk };

  // keep selections valid as the draft and source list move underneath us
  useEffect(() => { if (panel === view) setPanel(defaultPanelFor(view)); }, [view]); // eslint-disable-line

  // Read a stored text file's words onto the record so the reader can show + cite
  // them — without this an uploaded .txt opens to a "paste the text" box even
  // though the file is in hand. (PDFs are pulled by the inline SourceViewer.)
  useEffect(() => {
    const SV = window.NpjSourceView;
    if (!SV || !selSrc || !SV.ensureText) return;
    const rec = api.sourceRec(selSrc);
    if (!rec || String(rec.text || "").trim() || SV.kindOf(rec) !== "text" || !SV.hasFile(rec)) return;
    let alive = true;
    SV.ensureText(rec).then(t => { if (alive && t && t.trim()) { api.seedSourceText(selSrc, t); bump(); } }).catch(() => {});
    return () => { alive = false; };
  }, [selSrc]); // eslint-disable-line
  if (srcList.length && (!selSrc || !srcList.find(s => s.key === selSrc))) setSelSrc(srcList[0].key);
  const selRow = (selSid && bySid[selSid]) ? bySid[selSid] : null;

  // ---- chrome helpers ----
  const say = (msg) => {
    setToast(msg);
    clearTimeout(timers.current.toast);
    timers.current.toast = setTimeout(() => setToast(null), 4200);
  };
  const flash = (sid) => {
    setFlashSid(sid);
    clearTimeout(timers.current.flash);
    timers.current.flash = setTimeout(() => setFlashSid(s => (s === sid ? null : s)), 1700);
  };
  const bounce = () => {
    setHop(Date.now());
    clearTimeout(timers.current.hop);
    timers.current.hop = setTimeout(() => setHop(null), 950);
  };
  const pivot = (v) => { if (v !== view) setPanel(v); };
  const scrollToSid = (sid) => {
    setTimeout(() => {
      const main = mainRef.current; if (!main) return;
      const el = main.querySelector('[data-sid="' + (window.CSS && CSS.escape ? CSS.escape(sid) : sid) + '"]');
      if (!el) return;
      const mr = main.getBoundingClientRect(), rr = el.getBoundingClientRect();
      main.scrollTo({ top: main.scrollTop + (rr.top - mr.top) - 140, behavior: "smooth" });
    }, 70);
  };
  const selectSentence = (sid, pivotTo) => { setSelSid(sid); if (pivotTo) pivot(pivotTo); };

  // ---- walk: Citey steps through the sentences that still need a source ----
  // Status is recomputed from the live DOM at each step, so resolving a claim
  // (cite or own) by ANY path advances the walk truthfully.
  const startWalk = () => {
    if (!needsSids.length) return;
    setWalk({ cur: needsSids[0], n: needsSids.length });
    setSelSid(needsSids[0]); pivot("grounding"); scrollToSid(needsSids[0]);
  };
  const nextWalk = () => {
    const w = layers.current.walk; if (!w) return;
    const fresh = api.segment() || [];
    const needs = fresh.filter(r => statusOf(r).key === "needs").map(r => r.sid);
    if (!needs.length) {
      const conf = fresh.filter(r => statusOf(r).key === "conflict").length;
      setWalk(null);
      say("⊤ Every sentence is grounded or owned." + (conf ? " Resolve the conflict and the gate opens." : ""));
      return;
    }
    const ord = fresh.map(r => r.sid);
    const ci = ord.indexOf(w.cur);
    const nx = needs.find(sid => ord.indexOf(sid) > ci) || needs[0];
    setWalk({ cur: nx, n: w.n }); setSelSid(nx); pivot("grounding"); scrollToSid(nx);
  };
  const endWalk = () => setWalk(null);
  // a claim just resolved — celebrate, and if Citey had the floor, move him on
  const afterResolve = (sid) => {
    flash(sid); bounce(); pivot("grounding");
    const w = layers.current.walk;
    if (w && w.cur === sid) {
      clearTimeout(timers.current.walk);
      timers.current.walk = setTimeout(() => { const ww = layers.current.walk; if (ww && ww.cur === sid) nextWalk(); }, 600);
    }
  };

  // ---- Esc peels the layers: staged spans → cite modal → walkthrough ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const L = layers.current;
      if (L.pending && L.pending.spans && L.pending.spans.length) setPending(null);
      else if (L.modal) closeCite();
      else if (L.walk) setWalk(null);
    };
    window.addEventListener("keydown", onKey);
    const t = timers.current;
    return () => { window.removeEventListener("keydown", onKey); Object.keys(t).forEach(k => clearTimeout(t[k])); };
  }, []); // eslint-disable-line

  // ---- keep the table live with the prose ----
  // Sentences are DERIVED from the editor's contentEditable DOM, which React
  // can't pass as a prop — so observe the editor node directly and re-segment on
  // any change. This auto-imports every prose sentence the instant it lands, and
  // closes the load race where a saved draft's text restores AFTER this view has
  // already mounted (the table used to sit empty until the next unrelated render).
  useEffect(() => {
    const el = api.editorEl && api.editorEl();
    if (!el) return;
    bump(); // segment whatever prose is already in the editor at mount
    if (typeof MutationObserver === "undefined") return;
    let raf = 0;
    const obs = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; bump(); });
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []); // eslint-disable-line

  // Name every still-generic web source from its URL the moment this view opens,
  // so a draft loaded before titling existed reads cleanly (no network — the slug
  // + host guess; the per-source "Guess" button fetches the real <title>).
  useEffect(() => {
    if (api.autoTitleSources && api.autoTitleSources()) bump();
  }, []); // eslint-disable-line

  // ---- mutations (all route through the Newsroom api → same DOM + autosave) ----
  const attachExisting = (row, citeId) => {
    api.attachExisting(row, citeId);
    setModal(null); setPending(null); setSelSid(row.sid);
    afterResolve(row.sid); bump();
  };
  const detach = (span, citeId) => { api.detach(span, citeId); bump(); };
  const setStance = (row, st, stance, note, kind) => {
    if (!stance) { (st.spans || []).filter(s => s.getAttribute("data-stance")).forEach(s => api.unown(s)); }
    else { api.own(row, stance, note, kind); afterResolve(row.sid); }
    bump();
  };

  // ---- the cite modal: the claim + the document, hero ----
  const [citeMode, setCiteMode] = useState("source"); // source | own | void — the three ways to ground a claim
  const [voidNote, setVoidNote] = useState("");        // the documented search/evidence behind an asserted absence
  const [voidKind, setVoidKind] = useState("");        // which of the six kinds of void (see app/void-kinds.js)
  const [reuseOpen, setReuseOpen] = useState(false);   // the "reuse a pinned quote" drawer (collapsed by default)
  const srcText = (key) => String((api.sourceRec(key) || {}).text || "");
  const openCite = (sid, srcKey) => {
    const e = bySid[sid]; if (!e) return;
    let best = srcKey || null;
    if (!best) {
      // open on the source Citey scents strongest — mechanical overlap, not an answer
      let bestScore = -1;
      srcList.forEach(({ key }) => {
        const t = srcText(key); if (!t.trim()) return;
        const h = window.CiteyAssist ? (window.CiteyAssist.rankSpans(e.row.text, t) || []) : [];
        const sc = h.length ? h[0].score : 0;
        if (sc > bestScore) { bestScore = sc; best = key; }
      });
    }
    setModal({ sid }); setSelSid(sid);
    if (best) setSelSrc(best);
    setPending(null); setArmIdx(0); setSrcQuery(""); setSrcFindIdx(0); setBrowseQuery(""); setCiteMode("source"); setReuseOpen(false); setVoidNote(""); setVoidKind("");
  };
  const closeCite = () => { setModal(null); setPending(null); setArmIdx(0); setBrowseQuery(""); };

  // Citey's scent: candidate passages in the armed source — navigation aids only,
  // never a one-click pin. Document order; the author grabs the words.
  const armedRow = modal && bySid[modal.sid] ? bySid[modal.sid].row : null;
  const armHits = (() => {
    if (!armedRow || !window.CiteyAssist) return [];
    const t = srcText(selSrc); if (!t.trim()) return [];
    let hits = [];
    try { hits = (window.CiteyAssist.rankSpans(armedRow.text, t) || []).filter(h => h.hit >= 2 || h.score >= 0.3); } catch (e) {}
    hits = hits.slice(0, 4).map(h => ({ s: h.s, loc: h.loc }));
    hits.sort((a, b) => a.loc.start - b.loc.start);
    return hits;
  })();
  const scrollReaderTo = (attr, j) => {
    setTimeout(() => {
      [srcRefMain, srcRefPanel, srcRefModal].forEach(ref => {
        const c = ref.current; if (!c) return;
        const el = c.querySelector('[' + attr + '="' + j + '"]'); if (!el) return;
        const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
        c.scrollTo({ top: c.scrollTop + (er.top - cr.top) - 70, behavior: "smooth" });
      });
    }, 40);
  };
  const stepHit = (dir) => {
    const n = armHits.length; if (!n) return;
    const j = ((armIdx + dir) % n + n) % n;
    setArmIdx(j); scrollReaderTo("data-hit", j);
  };

  // ---- in-document search: every occurrence, walk between them ----
  const findHits = (() => {
    const q = srcQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const t = srcText(selSrc).toLowerCase();
    const out = []; let i = t.indexOf(q);
    while (i >= 0 && out.length < 200) { out.push({ start: i, end: i + q.length }); i = t.indexOf(q, i + q.length); }
    return out;
  })();
  const stepFind = (dir) => {
    const n = findHits.length; if (!n) return;
    const j = ((srcFindIdx + dir) % n + n) % n;
    setSrcFindIdx(j); scrollReaderTo("data-find", j);
  };
  const setQuery = (v) => {
    setSrcQuery(v); setSrcFindIdx(0);
    clearTimeout(timers.current.query);
    timers.current.query = setTimeout(() => scrollReaderTo("data-find", 0), 250);
  };
  const pickSource = (key) => { setSelSrc(key); setArmIdx(0); setPending(null); setSrcQuery(""); setSrcFindIdx(0); };

  // ---- source library housekeeping: rename + delete ----
  // Renaming a source also opens it in the reader below — you can SEE the document
  // (its words, the screenshot/PDF) while you give it a real name, instead of
  // renaming a row blind.
  const startRename = (key, cur) => { pickSource(key); setRenameKey(key); setRenameText(cur || ""); };
  const cancelRename = () => { setRenameKey(null); setRenameText(""); };
  const commitRename = (key) => {
    const t = renameText.trim();
    if (t && api.renameSource) { api.renameSource(key, t); say("Renamed to “" + clip(t, 40) + "”"); }
    cancelRename(); bump();
  };
  // (re)guess a web source's title + outlet — the mechanical read now, the real
  // <title>/og: tags off the archived page when reachable. Best-effort; honors a
  // manual rename. The promise resolves once the network upgrade (if any) lands.
  const guessTitle = (key) => {
    if (!api.guessSourceTitle) return;
    say("Guessing the title…");
    Promise.resolve(api.guessSourceTitle(key)).then(() => bump());
    bump();
  };
  // delete a source from the draft — confirm first, and spell out the blast
  // radius when sentences are grounded in it (their words stay; the source goes).
  const deleteSource = (key) => {
    const rec = srcRec(key); const title = rec.title || key;
    const used = allC.filter(c => c.srcKey === key).reduce((n, c) => n + api.usageCount(c.id), 0);
    const msg = used > 0
      ? "Delete “" + title + "”?\n\nIt grounds " + used + " sentence" + (used === 1 ? "" : "s") + " in this draft. Deleting unlinks " + (used === 1 ? "it" : "them") + " — the sentence" + (used === 1 ? "" : "s") + " keep the words but lose this source, and its citation records are removed. This can't be undone."
      : "Delete “" + title + "”?\n\nIt isn't cited in the draft yet — this just removes it from the source library.";
    if (typeof window !== "undefined" && window.confirm && !window.confirm(msg)) return;
    if (api.deleteSource) api.deleteSource(key);
    if (renameKey === key) cancelRename();
    if (selSrc === key) setSelSrc(null);
    say("Deleted “" + clip(title, 40) + "”"); bump();
  };

  // ---- drag-select → staged pin: the author finds the words themself ----
  // Captured at the DOCUMENT level (see the effect below), not just the reader's
  // own mouseup, so a drag that RELEASES OUTSIDE the reader box still stages —
  // overshooting a short snapshot, or letting go on the modal's padding, used to
  // drop the grab silently. We stage only when the live selection actually lands
  // inside a reader's citable body ([data-doctext]); a click, or a selection
  // anywhere else, is a no-op. Offsets come off the untrimmed range, then step
  // past any trimmed leading space so loc slices back to exactly the quote (the
  // cited-mark render and conflict checks rely on that).
  const readerRefs = [srcRefModal, srcRefPanel, srcRefMain];
  const stageSelection = () => {
    if (!layers.current.modal) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    let cont = null;
    for (const ref of readerRefs) {
      const outer = ref.current; if (!outer) continue;
      const dt = outer.querySelector("[data-doctext]") || outer;
      if (dt.contains(r.commonAncestorContainer)) { cont = dt; break; }
    }
    if (!cont) return;
    const raw = r.toString();
    const quote = raw.trim();
    if (quote.length < 3) return;
    const lead = raw.length - raw.replace(/^\s+/, "").length;
    const pre = document.createRange();
    pre.setStart(cont, 0); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length + lead;
    sel.removeAllRanges();
    setPending(p => {
      const spans = (p && p.spans) ? p.spans.slice() : [];
      const span = { quote, loc: { start, end: start + quote.length } };
      if (!spans.some(x => x.loc.start < span.loc.end && span.loc.start < x.loc.end)) spans.push(span);
      spans.sort((a, b) => a.loc.start - b.loc.start);
      return { spans };
    });
  };
  // Grabbing works wherever the drag ends: listen at the document so releasing
  // outside the small reader box still stages (a short snapshot's box is only a
  // few lines tall, so the drag overshoots it constantly). The handler no-ops
  // unless the cite modal is armed and the selection lands in a reader, so it's
  // safe to keep mounted for the whole workspace.
  useEffect(() => {
    const onUp = () => stageSelection();
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []); // eslint-disable-line
  // PDF selection → a staged span. PDFs carry no flat-text offsets, so the span
  // is quote-only (loc null); the verbatim words are what get cited.
  const stagePdfQuote = (quote) => {
    if (!modal) return;
    const q = String(quote || "").replace(/\s+/g, " ").trim();
    if (q.length < 3) return;
    setPending(p => {
      const spans = (p && p.spans) ? p.spans.slice() : [];
      if (spans.some(s => s.quote === q)) return { spans };
      spans.push({ quote: q, loc: null });
      return { spans };
    });
  };
  const confirmPin = () => {
    const p = pending, m = modal;
    if (!p || !p.spans || !p.spans.length || !m) return;
    const fresh = (api.segment() || []).find(r => r.sid === m.sid) || (bySid[m.sid] && bySid[m.sid].row);
    if (!fresh) return;
    const quote = p.spans.map(s => s.quote).join(" … ");
    if (!api.groundRow(fresh, selSrc, quote, p.spans[0].loc, p.spans)) return;
    setModal(null); setPending(null); setSelSid(m.sid);
    afterResolve(m.sid); bump();
  };

  // ---- shared bits ----
  const pendSpans = (pending && pending.spans) || [];
  const eyebrow = { fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: NR.muted, fontWeight: 600 };
  const chipBtn = (extra) => Object.assign({ border: "1px solid " + NR.line, background: "transparent", color: NR.text, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 12.5, padding: "3px 9px" }, extra || {});
  const Pill = ({ st }) => {
    const p = pillFor(st);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, background: p.bg, color: p.fg, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{p.glyph}</span>{p.label}
      </span>
    );
  };
  const rowCites = (row) => {
    const out = [];
    (row.claimSpans || []).forEach(s => (api.citationsFor(s) || []).forEach(c => { if (!out.find(x => x.c.id === c.id)) out.push({ c, span: s }); }));
    return out;
  };
  const srcRec = (key) => api.sourceRec(key) || {};
  const srcShort = (key) => { const rec = srcRec(key); return (rec.title && rec.title !== "Web source" && rec.title !== "Web snapshot") ? rec.title : (rec.outlet || key || "source"); };
  const kindOf = (rec) => String(rec.outlet || rec.type || "source").toUpperCase();

  // ---- "outstanding fact checks": each ungrounded claim (⊥ needs source,
  // ¬ conflict) paired with the TYPE of evidence that would ground it — the
  // negative space a second reader can fill. The evidence type is read
  // mechanically here (NpjEvidence.classify, instant); the export panel can then
  // sharpen it through a local LLM. Built fresh at open from the live grounding.
  const buildPayload = () => {
    const need = (t) => (window.NpjEvidence ? window.NpjEvidence.classify(t).label : "a source that confirms this");
    const items = enriched
      .filter(e => e.st.key === "needs" || e.st.key === "conflict")
      .map(e => ({ sid: e.row.sid, status: e.st.key, claim: e.row.text, need: need(e.row.text) }));
    return { title: (api.draftTitle && api.draftTitle()) || "", items };
  };

  // citation chip (used by the table rows and the grounding card)
  const CiteChip = ({ c, span, conflict, compact }) => {
    const u = api.usageCount(c.id);
    return (
      <span title={"“" + clip(c.quote, 180) + "” — click to open in the registry"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 9px", borderRadius: 6, background: conflict ? "#fdecea" : "#e7f4ec", color: conflict ? "#b3261e" : "#1f7a4d", fontFamily: "var(--cond)", fontSize: 12.5, maxWidth: compact ? 200 : 230, outline: highlightCid === c.id ? "2px solid var(--yellow)" : "none" }}>
        <button onClick={() => { setSelCid(c.id); pivot("citations"); }}
          style={{ border: 0, background: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {clip(srcShort(c.srcKey), 26) + (u > 1 ? " ·×" + u : "")}
        </button>
        <button onClick={() => detach(span, c.id)} title="Unlink (the record survives in the registry)"
          style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
      </span>
    );
  };

  // ---- context links: prior coverage a sentence builds on (context, not proof) ----
  const rowContext = (row) => (api.contextFor(row) || []).map(k => ({ key: k, rec: srcRec(k) }));
  const ContextChip = ({ row, ck, compact }) => (
    <span title={"Prior coverage, cited for context — “" + clip(srcShort(ck.key), 90) + "”. Click to open the source."}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 8px", borderRadius: 6, background: "#e6f4f3", color: "#1f7d78", fontFamily: "var(--cond)", fontSize: 12.5, maxWidth: compact ? 190 : 220 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10 }}>⊪</span>
      <button onClick={() => { setSelSrc(ck.key); pivot("sources"); }}
        style={{ border: 0, background: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {clip(srcShort(ck.key), 24)}
      </button>
      <button onClick={() => { api.removeContext(row, ck.key); bump(); }} title="Unlink this context"
        style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
    </span>
  );
  // chips for the prior coverage + a picker to add more. Offered on ANY sentence —
  // a claim can be proved (or owned) AND still be set against prior coverage.
  const ContextStrip = ({ row, compact, label, addable }) => {
    const ctx = rowContext(row);
    if (addable === false && ctx.length === 0) return null;     // read-only + nothing to show
    const linked = ctx.map(c => c.key);
    const avail = (srcList || []).filter(s => linked.indexOf(s.key) < 0);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {label !== false && <div className="np-mono" style={{ fontSize: 9, color: CONTEXT_TEAL, letterSpacing: ".05em" }}>⊪ IN CONTEXT · PRIOR COVERAGE — CITED FOR CONTEXT, NOT PROOF</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {ctx.map(ck => <ContextChip key={ck.key} row={row} ck={ck} compact={compact} />)}
          {addable !== false && ctx.length === 0 && <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12.5, color: NR.muted }}>no prior coverage linked</span>}
          {addable !== false && (avail.length > 0
            ? <select value="" onChange={e => { if (e.target.value) { api.addContext(row, e.target.value); bump(); } }}
                title="Link prior coverage this sentence builds on — as context, not proof"
                style={{ background: NR.field, color: NR.text, border: "1px dashed " + CONTEXT_TEAL, borderRadius: 6, padding: "3px 7px", fontFamily: "var(--cond)", fontSize: 12.5, cursor: "pointer" }}>
                <option value="">+ Prior coverage…</option>
                {avail.map(s => <option key={s.key} value={s.key}>{clip(srcShort(s.key), 40)}</option>)}
              </select>
            : (srcList.length === 0 ? <span className="np-mono" style={{ fontSize: 9.5, color: NR.muted }}>add a source in Prose to cite it as context</span> : null))}
        </div>
      </div>
    );
  };

  // best registry matches for a sentence that still needs grounding
  const candidatesFor = (row, st, max) => {
    if (!row || !(st.key === "needs" || st.key === "conflict")) return [];
    const attached = rowCites(row).map(x => x.c.id);
    return allC.filter(c => attached.indexOf(c.id) < 0)
      .map(c => ({ c, score: matchScore(row.text, c.quote) }))
      .sort((a, b) => b.score - a.score)
      .filter(x => x.score > 0.2).slice(0, max || 3);
  };
  const AttachCands = ({ row, st, max }) => {
    const cands = candidatesFor(row, st, max);
    if (!cands.length) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {cands.map(({ c }) => {
          const u = api.usageCount(c.id);
          return (
            <button key={c.id} onClick={() => attachExisting(row, c.id)} title="Attach this citation to the sentence"
              style={{ textAlign: "left", border: "1px solid " + NR.line, background: NR.field, color: NR.text, borderRadius: 7, padding: "6px 8px", cursor: "pointer", fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.35 }}>
              <span className="np-mono" style={{ display: "block", fontSize: 9, color: "#1f8a55", marginBottom: 1 }}>
                {"⊕ ATTACH · " + clip(srcShort(c.srcKey), 30).toUpperCase() + (u ? " · USED ×" + u : " · UNUSED")}
              </span>
              {"“" + clip(c.quote, 92) + "”"}
            </button>
          );
        })}
      </div>
    );
  };

  // Reuse ANY existing record — searchable, never gated by the match threshold.
  // The mechanical match still orders the list (best first), but every record in
  // the registry is one click from attaching, so a citation you've already
  // pinned never has to be hunted down in its source and re-grabbed.
  const browseFor = (row, max) => {
    const attached = row ? rowCites(row).map(x => x.c.id) : [];
    const q = browseQuery.trim().toLowerCase();
    return allC
      .filter(c => attached.indexOf(c.id) < 0)
      .filter(c => !q || String(c.quote || "").toLowerCase().indexOf(q) >= 0 || srcShort(c.srcKey).toLowerCase().indexOf(q) >= 0)
      .map(c => ({ c, score: row ? matchScore(row.text, c.quote) : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max || 80);
  };
  const AttachBrowser = ({ row, compact }) => {
    const items = browseFor(row, compact ? 40 : 80);
    const totalOther = allC.filter(c => !row || rowCites(row).map(x => x.c.id).indexOf(c.id) < 0).length;
    return (
      <div>
        <input value={browseQuery} onChange={e => setBrowseQuery(e.target.value)} autoFocus={!compact}
          placeholder={"Search " + totalOther + " citation record" + (totalOther === 1 ? "" : "s") + " by quote or source…"} className="np-mono"
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontSize: 11.5, padding: "6px 8px", outline: "none", marginBottom: 7 }} />
        {items.length === 0
          ? <div className="np-mono" style={{ fontSize: 10, color: NR.muted, lineHeight: 1.5 }}>{totalOther === 0 ? "No other records yet — grab a span in a source below to mint the first." : "No record matches — clear the search, or grab the span in the source below."}</div>
          : (
            <div className="np-scroll" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: compact ? 200 : 280, overflowY: "auto", paddingRight: 2 }}>
              {items.map(({ c, score }) => {
                const u = api.usageCount(c.id);
                const strong = score >= 0.3;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "stretch", gap: 6, border: "1px solid " + NR.line, background: NR.field, borderRadius: 7, overflow: "hidden" }}>
                    <button onClick={() => row && attachExisting(row, c.id)} disabled={!row} title={row ? "Attach this record to the sentence" : "Open a sentence to attach"}
                      style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, background: "none", color: NR.text, cursor: row ? "pointer" : "default", padding: "6px 8px", fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.35 }}>
                      <span className="np-mono" style={{ display: "block", fontSize: 9, color: strong ? "#1f8a55" : NR.muted, marginBottom: 1 }}>
                        {(row ? "⊕ ATTACH · " : "") + clip(srcShort(c.srcKey), 26).toUpperCase() + (u ? " · USED ×" + u : " · UNUSED") + (strong ? " · STRONG MATCH" : "")}
                      </span>
                      {"“" + clip(c.quote, 96) + "”"}
                    </button>
                    {c.srcKey && (
                      <button onClick={() => { setSelCid(c.id); pickSource(c.srcKey); }} title="See this quote in its source"
                        style={{ flexShrink: 0, border: 0, borderLeft: "1px solid " + NR.line, background: "transparent", color: NR.soft, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11, padding: "0 9px" }}>↗</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    );
  };

  // ---- the source reader: the document carries its own identity ----
  // Pending spans (staged) > search finds > scent hits / citation marks.
  const readerBody = (refObj, compact) => {
    const rec = srcRec(selSrc);
    const t = srcText(selSrc);
    const armed = !!modal;
    // Where this source actually lives — so a web page is reachable from the reader
    // (open it / its snapshot in a new tab) instead of being a dead title.
    const liveUrl = rec.original_url && /^https?:/i.test(rec.original_url) ? rec.original_url : "";
    const snapUrl = rec.archive_url && /^https?:/i.test(rec.archive_url) ? rec.archive_url : "";
    const prettyUrl = (u) => String(u || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const lhLink = { color: "#2b5f8a", textDecoration: "underline", textUnderlineOffset: 2, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" };
    const letterhead = (
      <div key="lh" style={{ position: "sticky", top: 0, zIndex: 2, background: "#f6f1e4", borderBottom: "2px solid #16140d", padding: compact ? "9px 12px 7px" : "11px 16px 9px", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".08em", background: "#16140d", color: "#f6f1e4", padding: "2px 6px" }}>{kindOf(rec)}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: ".1em", color: rec.archive_url ? "rgba(22,20,13,.55)" : "#b3261e" }}>{rec.archive_url ? "ARCHIVED SOURCE" : "NOT ARCHIVED"}</span>
        </div>
        <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: compact ? 14.5 : 16.5, lineHeight: 1.15, color: "#16140d" }}>{rec.title || selSrc}</div>
        {(liveUrl || snapUrl) && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 5, fontFamily: "var(--mono)", fontSize: 10 }}>
            {liveUrl && <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={lhLink}>↗ Open the page</a>}
            {snapUrl && <a href={snapUrl} target="_blank" rel="noopener noreferrer" style={lhLink}>⌖ Archived snapshot</a>}
            <span style={{ color: "rgba(22,20,13,.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "1 1 120px" }}>{prettyUrl(liveUrl || snapUrl)}</span>
          </div>
        )}
      </div>
    );
    const SV = window.NpjSourceView;
    const fileKind = SV ? SV.kindOf(rec) : "text";
    // An uploaded image is shown as the actual picture — even once OCR has put its
    // words on record. Without this the reader fell straight through to the flat
    // text below and the source you cited was invisible; now you SEE the screenshot
    // (or scan), and its recognized text renders under it as the citable, selectable
    // body. hideOcr suppresses SourceViewer's own text reveal — the doctext is it.
    const imageBanner = (SV && SV.hasFile(rec) && fileKind === "image" && window.SourceViewer) ? (
      <div style={{ padding: compact ? "9px 11px 1px" : "11px 14px 2px", background: "#f6f1e4" }}>
        {/* zoomable + grabbable: drag a box on the scan (Area mode) to OCR the
            exact words and stage them — the recognized text below is the fallback */}
        <window.SourceViewer srcKey={selSrc} rec={rec} height={compact ? 260 : 440} frameless hideOcr onSelectText={armed ? stagePdfQuote : null} />
      </div>
    ) : null;
    // A PDF is shown as the REAL document — rendered pages with a selectable text
    // layer — never flattened into a wall of text. Drag-selecting words on the
    // page stages them as the citation span (quote, verbatim).
    if (SV && SV.hasFile(rec) && fileKind === "pdf" && window.SourceViewer) {
      return (
        <div ref={refObj} className="np-scroll" style={{ background: "#f6f1e4", color: "#16140d", border: "1px solid " + NR.line, maxHeight: compact ? 380 : 580, overflowY: "auto" }}>
          {letterhead}
          <div style={{ padding: "8px 8px 10px" }}>
            <window.SourceViewer srcKey={selSrc} rec={rec} height={compact ? 320 : 500} onSelectText={armed ? stagePdfQuote : null} />
          </div>
        </div>
      );
    }
    if (!t.trim()) {
      // an image you can transcribe to cite, or a text source we don't have the
      // words for yet — show the picture (if any) above a paste box.
      const hasImage = SV && SV.hasFile(rec) && fileKind === "image";
      const isWeb = !!(liveUrl || snapUrl);
      return (
        <div ref={refObj} className="np-scroll" style={{ background: "#f6f1e4", color: "#16140d", border: "1px solid " + NR.line, maxHeight: compact ? 300 : 440, overflowY: "auto" }}>
          {letterhead}
          {hasImage && imageBanner}
          {isWeb && !hasImage && (
            <div style={{ padding: compact ? "12px 12px 0" : "14px 16px 0" }}>
              <div style={{ border: "1px solid rgba(22,20,13,.25)", background: "#fffdf6", padding: "12px 13px" }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, color: "#16140d", marginBottom: 5 }}>This is a web page — its text isn't on record</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(22,20,13,.7)", lineHeight: 1.55, marginBottom: 10 }}>
                  Open it to read the article in a new tab. To search and cite the exact words right here, paste the passage below — it sticks to this source.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {liveUrl && <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="np-cond" style={{ border: "1.5px solid #16140d", background: "var(--yellow)", color: "#16140d", padding: "5px 12px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>↗ Open the page</a>}
                  {snapUrl && <a href={snapUrl} target="_blank" rel="noopener noreferrer" className="np-cond" style={{ border: "1.5px solid #16140d", background: "transparent", color: "#16140d", padding: "5px 12px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>⌖ Snapshot</a>}
                </div>
              </div>
            </div>
          )}
          <SeedBox onSeed={(txt) => { api.seedSourceText(selSrc, txt); bump(); }} />
        </div>
      );
    }
    let items = [];
    if (armed) {
      const hits = armHits.filter(h => !pendSpans.some(p => h.loc.start < p.loc.end && p.loc.start < h.loc.end));
      items = hits.map(h => ({ start: h.loc.start, end: h.loc.end, type: "hit", j: armHits.indexOf(h) }));
      pendSpans.forEach((p, pi) => items.push({ start: p.loc.start, end: p.loc.end, type: "pending", pi }));
    } else {
      allC.filter(c => c.srcKey === selSrc).forEach(c => {
        // pinned offsets when they still slice clean (source text is append-only),
        // else find the words; a quote the text doesn't carry simply isn't marked
        let sp = (c.spans && c.spans.length) ? c.spans : (c.loc ? [{ loc: c.loc, quote: c.quote }] : []);
        sp = sp.filter(s => s.loc && s.loc.end <= t.length && (!s.quote || t.slice(s.loc.start, s.loc.end) === s.quote));
        if (!sp.length) { const i = t.indexOf(c.quote); if (i >= 0) sp = [{ loc: { start: i, end: i + c.quote.length } }]; }
        sp.forEach((s, si) => items.push({ start: s.loc.start, end: s.loc.end, type: "cite", id: c.id, si, nParts: sp.length }));
      });
    }
    // search finds win over scent/citation shading, but never over a staged span
    const finds = findHits
      .map((l, fi) => ({ start: l.start, end: l.end, type: "find", fi }))
      .filter(f => !items.some(it => it.type === "pending" && it.start < f.end && f.start < it.end));
    items = items.filter(it => it.type === "pending" || !finds.some(f => f.start < it.end && it.start < f.end));
    items = items.concat(finds).sort((a, b) => a.start - b.start);
    const kids = []; let pos = 0;
    items.forEach((it, idx) => {
      if (it.start < pos) return;
      kids.push(t.slice(pos, it.start));
      if (it.type === "pending") {
        kids.push(
          <mark key={"pend" + it.pi} style={{ background: "var(--yellow)", color: "#16140d", padding: "0 1px", outline: "1.5px solid #16140d" }}>
            {t.slice(it.start, it.end)}
            {pendSpans.length > 1 && <sup style={{ fontFamily: "var(--mono)", fontSize: 8, fontWeight: 700, marginLeft: 1 }}>{"P" + (it.pi + 1)}</sup>}
          </mark>);
      } else if (it.type === "hit") {
        const active = it.j === armIdx;
        kids.push(
          <mark key={"h" + it.j} data-hit={it.j} title="Likely match — read it; select the words yourself if they back the claim"
            style={{ background: active ? "rgba(255,236,1,.42)" : "rgba(255,236,1,.16)", color: "#16140d", padding: "0 1px", borderBottom: "2px dotted " + (active ? "#9a8500" : "rgba(154,133,0,.55)") }}>
            {t.slice(it.start, it.end)}
          </mark>);
      } else if (it.type === "find") {
        const active = it.fi === srcFindIdx;
        kids.push(
          <mark key={"f" + it.fi} data-find={it.fi} style={{ background: active ? "#2b5f8a" : "rgba(43,95,138,.25)", color: active ? "#fffdf6" : "#16140d", padding: "0 1px" }}>
            {t.slice(it.start, it.end)}
          </mark>);
      } else {
        const active = selCid === it.id;
        kids.push(
          <mark key={it.id + "-" + it.si + "-" + idx} onClick={() => setSelCid(x => x === it.id ? null : it.id)}
            title={"Citation — used in " + api.usageCount(it.id) + " sentence(s). Click to select."}
            style={{ background: active ? "var(--yellow)" : "rgba(255,236,1,.45)", color: "#16140d", padding: "0 1px", cursor: "pointer", outline: active ? "2px solid #16140d" : "none" }}>
            {t.slice(it.start, it.end)}
            {it.nParts > 1 && <sup style={{ fontFamily: "var(--mono)", fontSize: 8, fontWeight: 700, marginLeft: 1 }}>{"P" + (it.si + 1)}</sup>}
          </mark>);
      }
      pos = it.end;
    });
    kids.push(t.slice(pos));
    return (
      <div ref={refObj} className="np-scroll"
        style={{ background: "#f6f1e4", color: "#16140d", border: "1px solid " + NR.line, fontFamily: "var(--serif)", fontSize: compact ? 13 : 14.5, lineHeight: 1.62, userSelect: "text", cursor: modal ? "text" : "default", maxHeight: compact ? 300 : 440, overflowY: "auto", boxShadow: modal ? "inset 0 0 0 2px var(--yellow)" : "none" }}>
        {letterhead}
        {imageBanner}
        <div data-doctext="1" style={{ whiteSpace: "pre-wrap", padding: compact ? "10px 12px 12px" : "12px 16px 16px" }}>{kids}</div>
      </div>
    );
  };

  const searchRow = (placeholder) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "8px 0" }}>
      <input value={srcQuery} onChange={e => setQuery(e.target.value)} placeholder={placeholder || "Search this document…"} className="np-mono"
        style={{ flex: 1, minWidth: 0, border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontSize: 11.5, padding: "6px 8px", outline: "none" }} />
      {findHits.length > 0 && (<React.Fragment>
        <button onClick={() => stepFind(-1)} title="Previous match" style={chipBtn({ padding: "3px 8px" })}>‹</button>
        <span className="np-mono" style={{ fontSize: 10, color: NR.muted, whiteSpace: "nowrap" }}>{((srcFindIdx % findHits.length) + 1) + " / " + findHits.length}</span>
        <button onClick={() => stepFind(1)} title="Next match" style={chipBtn({ padding: "3px 8px" })}>›</button>
      </React.Fragment>)}
      {srcQuery.trim().length >= 2 && findHits.length === 0 && <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>0 matches</span>}
    </div>
  );

  // ---- add a net-new source without leaving the grounding flow ----
  // The cite modal (and the Sources panel) ingest a URL or a file right here,
  // then open the new source's reader so the author grabs the supporting words
  // in one motion — no trip back to the Prose rail. Routes through the same
  // Newsroom ingest the rail uses (snapshot, upload, OCR); degrades to nothing
  // if the api predates these methods.
  const canIngest = !!(api.addUrlSources || api.addFileSources);
  const afterIngest = (keys, label) => {
    setAddSrcBusy(false);
    if (keys && keys.length) {
      pickSource(keys[0]); setAddSrcOpen(false); setAddSrcUrl("");
      say(label || ("Added “" + clip(srcShort(keys[0]), 36) + "” — now select the exact words that back this claim."));
    } else {
      say("Nothing added — paste a full http(s):// URL, or upload a file.");
    }
    bump();
  };
  const ingestUrlHere = () => {
    const raw = addSrcUrl.trim(); if (!raw || !api.addUrlSources) return;
    setAddSrcBusy(true);
    try { afterIngest(api.addUrlSources(raw)); } catch (e) { setAddSrcBusy(false); say("Couldn’t add that URL."); }
  };
  const ingestFilesHere = (fileList) => {
    const files = Array.from(fileList || []); if (!files.length || !api.addFileSources) return;
    setAddSrcBusy(true);
    try { afterIngest(api.addFileSources(files), "Uploaded — Citey is reading the words; grab them once they appear below."); }
    catch (e) { setAddSrcBusy(false); say("Upload failed."); }
  };
  const addSrcDisabled = addSrcBusy || !addSrcUrl.trim();
  const addSourceForm = canIngest ? (
    <div style={{ border: "1px solid " + NR.line, background: NR.field, padding: "9px 10px", margin: "8px 0" }}>
      <div className="np-mono" style={{ fontSize: 9, color: NR.soft, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 600, marginBottom: 7 }}>Add a source — it opens right here</div>
      {api.addUrlSources && (
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <input value={addSrcUrl} onChange={e => setAddSrcUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); ingestUrlHere(); } }}
            placeholder="Paste a URL — it snapshots & stores…" className="np-mono"
            style={{ flex: 1, minWidth: 0, border: "1px solid " + NR.line, background: NR.panel, color: NR.text, fontSize: 11.5, padding: "6px 8px", outline: "none" }} />
          <button onClick={ingestUrlHere} disabled={addSrcDisabled} className="np-cond"
            style={{ border: 0, background: addSrcDisabled ? NR.line : "var(--yellow)", color: addSrcDisabled ? NR.muted : "var(--ink)", padding: "6px 12px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: addSrcDisabled ? "default" : "pointer" }}>
            {addSrcBusy ? "Adding…" : "Snapshot & store"}
          </button>
        </div>
      )}
      {api.addUrlSources && api.addFileSources && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 6px" }}>
          <span style={{ flex: 1, height: 1, background: NR.line }} /><span className="np-mono" style={{ fontSize: 9, color: NR.muted }}>or</span><span style={{ flex: 1, height: 1, background: NR.line }} />
        </div>
      )}
      {api.addFileSources && (
        <label className="np-cond" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", boxSizing: "border-box", border: "1px solid " + NR.line, background: NR.panel, color: NR.text, padding: "7px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          <input type="file" multiple style={{ display: "none" }} onChange={e => { ingestFilesHere(e.target.files); e.target.value = ""; }} />
          ⬆ Upload a document, screenshot or PDF
        </label>
      )}
      <div className="np-mono" style={{ fontSize: 9, color: NR.muted, marginTop: 7, lineHeight: 1.5 }}>Screenshots & PDFs are read for their text automatically; a web page opens for pasting the passage you’re citing.</div>
    </div>
  ) : null;

  const srcTabs = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
      {srcList.map(({ key }) => (
        <button key={key} onClick={() => pickSource(key)}
          style={chipBtn({ background: selSrc === key ? "var(--yellow)" : "transparent", color: selSrc === key ? "var(--ink)" : NR.text, borderColor: selSrc === key ? "var(--yellow)" : NR.line, fontWeight: 700 })}>
          {clip(srcShort(key), 26)}
        </button>
      ))}
      {canIngest && (
        <button onClick={() => setAddSrcOpen(o => !o)} title="Add a new source — a URL or a file — without leaving this claim"
          style={chipBtn({ border: "1px dashed " + (addSrcOpen ? NR.text : NR.line), color: addSrcOpen ? NR.text : NR.soft, background: addSrcOpen ? NR.field : "transparent", fontWeight: 700 })}>
          {addSrcOpen ? "× Close" : "+ Add source"}
        </button>
      )}
    </div>
  );

  const hitNav = armHits.length > 0 && (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
      <span className="np-mono" style={{ flex: 1, fontSize: 10, color: NR.soft, lineHeight: 1.45 }}>
        {armHits.length + " likely passage" + (armHits.length === 1 ? "" : "s") + " — read them, then grab the spans that actually support the claim"}
      </span>
      <button onClick={() => stepHit(-1)} title="Previous scented passage" style={chipBtn({ padding: "3px 8px" })}>‹</button>
      <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>{((armIdx % armHits.length) + 1) + " / " + armHits.length}</span>
      <button onClick={() => stepHit(1)} title="Next scented passage" style={chipBtn({ padding: "3px 8px" })}>›</button>
    </div>
  );

  const pendingBar = pendSpans.length > 0 ? (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, padding: "8px 9px", border: "1.5px solid var(--yellow)", background: "rgba(255,236,1,.07)" }}>
      <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 4 }}>
        {pendSpans.map((p, i) => (
          <span key={"p" + i} className="np-mono" style={{ fontSize: 10, color: NR.text, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(pendSpans.length > 1 ? "Part " + (i + 1) + " · " : "") + "“" + clip(p.quote, 62) + "”" + (p.loc ? " · chars " + p.loc.start + "–" + p.loc.end : "")}
            </span>
            <button onClick={() => setPending(x => { const sp = ((x && x.spans) || []).filter((_, j) => j !== i); return sp.length ? { spans: sp } : null; })}
              title="Remove this part" style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        <span className="np-mono" style={{ fontSize: 9, color: NR.muted }}>Does the support live in more than one place? Grab another span to add it.</span>
      </span>
      <button onClick={() => setPending(null)} style={chipBtn()}>Clear</button>
      <button onClick={confirmPin} className="np-cond"
        style={{ border: "1.5px solid var(--ink)", background: "var(--yellow)", color: "var(--ink)", padding: "6px 13px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        {pendSpans.length > 1 ? "⊕ Cite these " + pendSpans.length + " spans" : "⊕ Cite this span"}
      </button>
    </div>
  ) : null;

  // ============ main stage · GROUNDING (the table) ============
  const shown = needsOnly ? enriched.filter(e => e.st.key === "needs" || e.st.key === "conflict") : enriched;
  const groundingMain = (() => {
    const cols = [
      { key: "status", label: "Status", width: 132, cell: ({ st }) => <Pill st={st} /> },
      { key: "sentence", label: "Sentence", grow: true, cell: ({ row }) => (
        <React.Fragment>
          <button onClick={() => { setSelSid(row.sid); api.jumpTo(row); }} title="Open this sentence in the editor"
            style={{ textAlign: "left", background: "none", border: 0, color: NR.text, font: "inherit", fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.45, cursor: "pointer", padding: 0 }}>{row.text}</button>
          <div style={{ marginTop: 5 }}><HashChip row={row} NR={NR} /></div>
        </React.Fragment>
      ) },
      { key: "citations", label: "Citations", width: "30%", cell: ({ row, st, conf, cites }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {st.key === "owned" && st.stance === "context"
            ? <ContextStrip row={row} compact />
            : st.key === "owned"
              ? <React.Fragment>
                  <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.muted }}>no source needed</span>
                  <ContextStrip row={row} compact addable={false} label={false} />
                </React.Fragment>
              : (
                <React.Fragment>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {cites.map(({ c, span }) => <CiteChip key={c.id} c={c} span={span} conflict={conf} />)}
                    <button onClick={() => openCite(row.sid)} title="Find the words in a source that back this sentence"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, border: "1px dashed " + NR.line, background: "transparent", color: NR.soft, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 12.5 }}>+ Cite</button>
                  </div>
                  <ContextStrip row={row} compact addable={false} label={false} />
                </React.Fragment>
              )}
        </div>
      ) },
      { key: "stance", label: "Stance", width: 168, cell: ({ row, st, conf }) => (
        <React.Fragment>
          {(st.key === "grounded" || st.key === "multi") && <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.muted }}>sourced fact</span>}
          {conf && <span className="np-mono" style={{ fontSize: 10, color: "#b3261e", lineHeight: 1.4 }}>unlink the quote you trust less</span>}
          {(st.key === "needs" || st.key === "owned") && (
            <select value={st.stance || ""} onChange={e => setStance(row, st, e.target.value)}
              style={{ width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, borderRadius: 6, padding: "5px 7px", fontFamily: "var(--cond)", fontSize: 13 }}>
              <option value="">{st.key === "owned" ? "— clear stance —" : "Own as…"}</option>
              {STANCE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </React.Fragment>
      ) },
    ];
    const rows = shown.map(({ row, st }) => {
      const cites = rowCites(row);
      const onWalk = walk && walk.cur === row.sid;
      const sel = selSid === row.sid;
      const hi = highlightCid && cites.some(x => x.c.id === highlightCid);
      const conf = st.key === "conflict";
      return {
        key: row.sid,
        attrs: { "data-sid": row.sid },
        data: { row, st, conf, cites },
        style: {
          background: onWalk ? "rgba(124,116,222,.12)" : st.key === "needs" ? "rgba(216,99,46,.05)" : conf ? "rgba(216,65,44,.05)" : undefined,
          outline: onWalk ? "2px solid #7C74DE" : hi ? "2px solid var(--yellow)" : sel ? "1.5px solid rgba(124,116,222,.45)" : "none",
          outlineOffset: -2,
          animation: flashSid === row.sid ? "rowflash 1.6s ease-out" : "none",
        },
      };
    });
    return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 14, color: NR.text }}>
          <input type="checkbox" checked={needsOnly} onChange={e => setNeedsOnly(e.target.checked)} />
          Blockers only
        </label>
        <span className="np-mono npj-hide-sm" title="Every sentence you write is imported here automatically. Each carries a stable id (the # chip) that follows it through edits and moves, keeping its citations and stance attached." style={{ fontSize: 11, color: NR.muted, cursor: "help", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <window.I.hash style={{ fontSize: 11 }} /> {shown.length + " of " + enriched.length + " sentences · auto-imported"}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setExporting(true)} disabled={blockers === 0}
          title={blockers ? "List the " + blockers + " claim" + (blockers === 1 ? "" : "s") + " that still need grounding, each with the evidence type needed — a list others can help fact-check" : "Nothing needs a source — the gate is open"}
          className="np-cond" style={chipBtn({ fontWeight: 700, borderColor: blockers ? "#7C74DE" : NR.line, color: blockers ? "#7C74DE" : NR.muted, cursor: blockers ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 5 })}>
          <window.I.shield style={{ fontSize: 12 }} /> Export for fact-check
        </button>
      </div>
      {shown.length === 0
        ? <div className="np-mono" style={{ padding: "12px 14px", border: "1px solid " + NR.line, borderRadius: 8, background: NR.field, color: NR.muted, fontSize: 12 }}>
            {needsOnly ? "Nothing blocks publish — every sentence is sourced or owned." : "Write a few sentences in Prose and they'll show here as rows to ground."}
          </div>
        : <DataTable cols={cols} rows={rows} isMobile={isMobile} NR={NR} />}
      <div style={{ margin: "12px 2px 20px", fontFamily: "var(--serif)", fontSize: 12.5, color: NR.muted, lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700, color: NR.text, marginBottom: 2 }}>What the labels mean</div>
        <span style={{ color: "#1f8a55", fontWeight: 700 }}>⊤ Grounded</span> — a pinned quote in an archived source backs the claim &nbsp;·&nbsp;
        <span style={{ color: "#3a63c4", fontWeight: 700 }}>⊨ N sources</span> — backed independently by more than one source &nbsp;·&nbsp;
        <span style={{ color: "#b5701b", fontWeight: 700 }}>⊥ Needs source</span> — nothing pinned yet; blocks the gate &nbsp;·&nbsp;
        <span style={{ color: "#6b5bd6", fontWeight: 700 }}>⊩ Yours</span> — argued, witnessed, or inferred; honestly labelled &nbsp;·&nbsp;
        <span style={{ color: CONTEXT_TEAL, fontWeight: 700 }}>⊪ In context</span> — continuing coverage: the article proves it, set against prior reporting &nbsp;·&nbsp;
        <span style={{ color: "#8a6a1f", fontWeight: 700 }}>∅ A void</span> — an asserted absence, in one of six kinds (removed, withheld, silent, inaccessible, unrecorded, ambient) by how hard it is to stand behind &nbsp;·&nbsp;
        <span style={{ color: "#b3261e", fontWeight: 700 }}>¬ Sources disagree</span> — two pinned quotes conflict; unlink one
      </div>
    </section>
    );
  })();

  // ============ main stage · CITATIONS (the registry) ============
  const registryGroups = (() => {
    const keys = []; allC.forEach(c => { const k = c.srcKey || "__unfiled"; if (keys.indexOf(k) < 0) keys.push(k); });
    return keys.map(k => ({
      key: k,
      kind: k === "__unfiled" ? "UNFILED" : kindOf(srcRec(k)),
      title: k === "__unfiled" ? "Citations without a source record" : (srcRec(k).title || k),
      items: allC.filter(c => (c.srcKey || "__unfiled") === k)
    }));
  })();
  const registryList = (compact) => registryGroups.map(grp => (
    <div key={grp.key} style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".08em", background: NR.text, color: NR.bg, padding: "2px 6px", flexShrink: 0 }}>{grp.kind}</span>
        <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: compact ? 12.5 : 14, color: NR.text, lineHeight: 1.2 }}>{grp.title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {grp.items.map(c => {
          const u = api.usageCount(c.id);
          const active = selCid === c.id;
          const charsMeta = (c.spans && c.spans.length > 1)
            ? " · " + c.spans.length + " PARTS · CHARS " + c.spans.map(s => s.loc.start + "–" + s.loc.end).join(" + ")
            : (c.loc ? " · CHARS " + c.loc.start + "–" + c.loc.end : "");
          return (
            <div key={c.id} style={{ border: "1px solid " + (active ? "var(--yellow)" : highlightCid === c.id ? "rgba(124,116,222,.6)" : NR.line), borderRadius: 8, background: NR.field, padding: "8px 10px" }}>
              <button onClick={() => setSelCid(x => x === c.id ? null : c.id)}
                style={{ textAlign: "left", width: "100%", border: 0, background: "none", color: NR.text, cursor: "pointer", fontFamily: "var(--serif)", fontSize: compact ? 12 : 13, lineHeight: 1.4, padding: 0 }}>
                {"“" + clip(c.quote, compact ? 90 : 110) + "”"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <span className="np-mono" style={{ flex: 1, minWidth: 120, fontSize: 9, color: active ? "var(--yellow-deep)" : NR.muted }}>{(u ? "USED ×" + u : "UNUSED") + charsMeta}</span>
                <button onClick={() => { setSelCid(c.id); if (c.srcKey) { pickSource(c.srcKey); pivot("sources"); } }}
                  title="See this quote in its source" style={chipBtn({ fontSize: 11, padding: "2px 8px" })}>{compact ? "Context" : "In context"}</button>
                <button onClick={() => { setSelCid(c.id); setHighlightCid(x => x === c.id ? null : c.id); pivot("grounding"); }}
                  title="Highlight every sentence this record backs" style={chipBtn({ fontSize: 11, padding: "2px 8px" })}>{"Usage ×" + u}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ));
  const attachTarget = selRow && (selRow.st.key === "needs" || selRow.st.key === "conflict") ? selRow : null;
  const citationsMain = (() => {
    const cols = [
      { key: "quote", label: "Quote", grow: true, cell: ({ c }) => {
        const charsMeta = (c.spans && c.spans.length > 1)
          ? c.spans.length + " parts · chars " + c.spans.map(s => s.loc.start + "–" + s.loc.end).join(" + ")
          : (c.loc ? "chars " + c.loc.start + "–" + c.loc.end : "");
        return (
          <React.Fragment>
            <button onClick={() => setSelCid(x => x === c.id ? null : c.id)} title="Select this record"
              style={{ textAlign: "left", width: "100%", border: 0, background: "none", color: NR.text, cursor: "pointer", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, padding: 0 }}>
              {"“" + clip(c.quote, 140) + "”"}
            </button>
            {charsMeta && <div className="np-mono" style={{ fontSize: 8.5, color: NR.muted, marginTop: 3, letterSpacing: ".03em" }}>{charsMeta.toUpperCase()}</div>}
          </React.Fragment>
        );
      } },
      { key: "source", label: "Source", width: "24%", cell: ({ kind, title }) => (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: ".08em", background: NR.text, color: NR.bg, padding: "1px 5px", flexShrink: 0 }}>{kind}</span>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 12.5, color: NR.text, lineHeight: 1.2 }}>{clip(title, 40)}</span>
        </span>
      ) },
      { key: "used", label: "Used", align: "center", width: 78, cell: ({ c }) => {
        const u = api.usageCount(c.id);
        return <span className="np-mono" style={{ fontSize: 9.5, color: u ? NR.text : NR.muted, whiteSpace: "nowrap" }}>{u ? "USED ×" + u : "UNUSED"}</span>;
      } },
      { key: "actions", label: "", align: "right", width: 1, cell: ({ c }) => {
        const u = api.usageCount(c.id);
        return (
          <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {c.srcKey && <button onClick={() => { setSelCid(c.id); pickSource(c.srcKey); pivot("sources"); }} title="See this quote in its source" style={chipBtn({ fontSize: 11, padding: "2px 8px" })}>In context</button>}
            <button onClick={() => { setSelCid(c.id); setHighlightCid(x => x === c.id ? null : c.id); pivot("grounding"); }} title="Highlight every sentence this record backs" style={chipBtn({ fontSize: 11, padding: "2px 8px" })}>{"Usage ×" + u}</button>
          </span>
        );
      } },
    ];
    const rows = [];
    registryGroups.forEach(grp => grp.items.forEach(c => rows.push({
      key: c.id,
      active: selCid === c.id,
      data: { c, kind: grp.kind, title: grp.title },
      style: highlightCid === c.id ? { outline: "2px solid rgba(124,116,222,.6)", outlineOffset: -2 } : null,
    })));
    return (
      <section>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 17, color: NR.text }}>Citation registry</span>
          <span className="np-mono" style={{ fontSize: 11, color: NR.muted }}>{allC.length + " record" + (allC.length === 1 ? "" : "s")}</span>
        </div>
        <p style={{ fontFamily: "var(--serif)", fontSize: 13, color: NR.soft, lineHeight: 1.55, margin: "0 0 14px", maxWidth: 640 }}>
          A citation is a pinned span of a source — exact words plus character offsets. One record can back many sentences; unlinking a sentence never destroys the record.
        </p>
        {attachTarget && candidatesFor(attachTarget.row, attachTarget.st, 5).length > 0 && (
          <div style={{ border: "1.5px solid rgba(124,116,222,.55)", borderRadius: 8, padding: "10px 12px", marginBottom: 16, background: "rgba(124,116,222,.06)" }}>
            <div className="np-eyebrow" style={{ color: "#6b5bd6", marginBottom: 7 }}>{"Best matches for the selected sentence — “" + clip(attachTarget.row.text, 54) + "”"}</div>
            <AttachCands row={attachTarget.row} st={attachTarget.st} max={5} />
          </div>
        )}
        {allC.length === 0
          ? <div className="np-mono" style={{ fontSize: 11, color: NR.muted, lineHeight: 1.6 }}>No records yet — open a sentence's “+ Cite”, go into a source and grab the words that back it. The pinned span lands here, reusable.</div>
          : <DataTable cols={cols} rows={rows} isMobile={isMobile} NR={NR} />}
      </section>
    );
  })();

  // ============ main stage · SOURCES (the library TABLE + the reader) ============
  // The library is a table: every source a row — where it's from, our best guess
  // at its title, how many citations rest on it, whether it's archived, and the
  // housekeeping (guess the name / rename / delete). Pick a row to read + cite it.
  const rowBtn = (extra) => Object.assign({ border: "1px solid " + NR.line, background: "transparent", color: NR.soft, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 11.5, padding: "3px 8px", whiteSpace: "nowrap" }, extra || {});
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const sourcesMain = (() => {
    const cols = [
      { key: "where", label: "Where from", cell: ({ rec }) => <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".05em", color: NR.muted, whiteSpace: "nowrap" }}>{clip(kindOf(rec), 22)}</span> },
      { key: "source", label: "Source", grow: true, cell: ({ key, rec, active }) => (
        <span title="Click the row to open this source — read it and cite it"
          style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13.5, lineHeight: 1.25, color: NR.text, textDecoration: active ? "underline" : "none", textUnderlineOffset: 3 }}>{rec.title || key}</span>
      ) },
      { key: "cites", label: "Cites", align: "center", width: 56, cell: ({ nC }) => <span className="np-mono" style={{ fontSize: 11, color: nC ? NR.text : NR.muted }}>{nC}</span> },
      { key: "status", label: "Status", cell: ({ rec }) => <span className="np-mono" style={{ fontSize: 9, letterSpacing: ".04em", color: rec.archive_url ? NR.soft : "#c2724a", whiteSpace: "nowrap" }}>{rec.archive_url ? "ARCHIVED" : "NOT ARCHIVED"}</span> },
      { key: "actions", label: "", align: "right", width: 1, cell: ({ key, rec, isWeb }) => (
        <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {isWeb && <button onClick={stop(() => guessTitle(key))} title="Guess the title & outlet from the page" style={rowBtn({})}>⟲ Guess</button>}
          <button onClick={stop(() => startRename(key, rec.title || key))} title="Open this source and rename it" style={rowBtn({})}>✎ Rename</button>
          <button onClick={stop(() => deleteSource(key))} title="Delete this source from the draft" style={rowBtn({ color: "#c2724a" })}>✕</button>
        </span>
      ) },
    ];
    const rows = srcList.map(({ key, rec }) => {
      const active = selSrc === key;
      if (renameKey === key) return { key, custom: () => (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input autoFocus value={renameText} onChange={e => setRenameText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitRename(key); } else if (e.key === "Escape") { e.preventDefault(); cancelRename(); } }}
            placeholder="Source title" className="np-cond"
            style={{ flex: 1, minWidth: 160, boxSizing: "border-box", border: "1px solid " + NR.line, background: NR.bg, color: NR.text, fontSize: 13, padding: "6px 8px", outline: "none" }} />
          <button onClick={() => commitRename(key)} style={chipBtn({ background: "var(--yellow)", color: "var(--ink)", borderColor: "var(--yellow)", fontWeight: 700 })}>Save</button>
          <button onClick={cancelRename} style={chipBtn({})}>Cancel</button>
        </div>
      ) };
      return {
        key, active,
        onClick: () => pickSource(key),
        data: { key, rec, active, isWeb: !!rec.original_url, nC: allC.filter(c => c.srcKey === key).length },
      };
    });
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 2 }}>Source library · {srcList.length}</div>
          <div className="np-mono" style={{ fontSize: 9, color: NR.muted, lineHeight: 1.5, marginBottom: 9 }}>In the order they appear in the draft · click a row to open it below · titles + outlets are our best guess — rename any that's off</div>
          {srcList.length === 0
            ? <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>No sources yet — ingest one in the rail (Prose view) and it shows here to read and cite.</div>
            : <DataTable cols={cols} rows={rows} isMobile={isMobile} NR={NR} />}
        </div>
        {srcList.length > 0 && selSrc && (
          <div>
            {searchRow()}
            {readerBody(srcRefMain, false)}
            {(() => {
              const r = api.sourceRec(selSrc), SVa = window.NpjSourceView;
              return (SVa && SVa.hasFile && SVa.hasFile(r) && window.SourceAdapter)
                ? <window.SourceAdapter rec={r} api={api} NR={NR} nCites={allC.filter(c => c.srcKey === selSrc).length} />
                : null;
            })()}
            <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, lineHeight: 1.5, marginTop: 8 }}>
              {allC.filter(c => c.srcKey === selSrc).length + " citation record" + (allC.filter(c => c.srcKey === selSrc).length === 1 ? "" : "s") + " minted from this source · highlighted spans are cited support · click one to select it"}
            </div>
          </div>
        )}
      </section>
    );
  })();

  // ============ panel · PROSE (compact, status-shaded preview) ============
  const proseShade = (key, stance) => {
    if (key === "conflict") return { background: "rgba(216,65,44,.16)", borderBottom: "1.5px solid #D8412C" };
    if (key === "owned" && stance === "context") return { background: "rgba(46,139,134,.14)", borderBottom: "1.5px solid " + CONTEXT_TEAL };
    if (key === "owned" && stance === "absence") return { background: "rgba(77,126,168,.14)", borderBottom: "1.5px solid #4D7EA8" };
    if (key === "owned") return { background: "rgba(124,116,222,.14)", borderBottom: "1.5px solid #7C74DE" };
    if (key === "needs") return { background: "rgba(216,99,46,.15)", borderBottom: "1.5px dashed #D8632E" };
    return { background: "rgba(255,236,1,.13)", borderBottom: "1.5px solid #d8c520" };
  };
  const proseSup = (st) => {
    const map = { conflict: ["¬", "#b3261e"], needs: ["⚑", "#b5701b"], grounded: ["⊤", "#9a8500"], multi: ["⊨", "#9a8500"] };
    const VK = window.NpjVoidKinds;
    const pair = st.key === "owned"
      ? (st.stance === "context" ? ["⊪", CONTEXT_TEAL]
         : st.stance === "absence" ? [(VK && VK.norm(st.vkind) ? VK.glyph(st.vkind) : "∅"), "#8a6a1f"]
         : [STANCE_GLYPH[st.stance] || "⊩", "#6b5bd6"])
      : map[st.key];
    const ctxMark = (st.context && st.context.length && !(st.key === "owned" && st.stance === "context"))
      ? <sup title="set in context of prior coverage" style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: CONTEXT_TEAL, marginLeft: 1, lineHeight: 0, opacity: .8 }}>⊪</sup>
      : null;
    return <React.Fragment><sup style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: pair[1], marginLeft: 2, lineHeight: 0 }}>{pair[0]}</sup>{ctxMark}</React.Fragment>;
  };
  const prosePanel = (() => {
    const paras = [];
    enriched.forEach(e => {
      if (!paras.length || paras[paras.length - 1].bi !== e.row.blockIndex) paras.push({ bi: e.row.blockIndex, list: [] });
      paras[paras.length - 1].list.push(e);
    });
    return (
      <div>
        <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 8 }}>The draft — click a sentence to select it</div>
        {enriched.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>Nothing written yet.</div>}
        <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.62, color: NR.text }}>
          {paras.map((p, pi) => (
            <p key={pi} style={{ margin: "0 0 12px" }}>
              {p.list.map(({ row, st }) => (
                <React.Fragment key={row.sid}>
                  <span onClick={() => { setSelSid(row.sid); flash(row.sid); if (view === "grounding") scrollToSid(row.sid); }}
                    title="Select — the workspace shows its grounding record"
                    style={Object.assign({ cursor: "pointer", padding: "0 1px", outline: selSid === row.sid ? "1.5px solid rgba(124,116,222,.8)" : "none", outlineOffset: 2, animation: flashSid === row.sid ? "rowflash 1.8s ease-out" : "none" }, proseShade(st.key, st.stance))}>
                    {row.text}{proseSup(st)}
                  </span>{" "}
                </React.Fragment>
              ))}
            </p>
          ))}
        </div>
      </div>
    );
  })();

  // ============ panel · GROUNDING (the selected sentence's card + mini map) ============
  const selIdx = selSid ? order.indexOf(selSid) : -1;
  const groundingPanel = (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <button onClick={() => { if (order.length) setSelSid(order[((selIdx - 1) + order.length) % order.length]); }} style={chipBtn({ padding: "3px 9px" })}>‹</button>
        <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>{selIdx >= 0 ? (selIdx + 1) + " / " + order.length : "—"}</span>
        <button onClick={() => { if (order.length) setSelSid(order[(selIdx + 1) % order.length]); }} style={chipBtn({ padding: "3px 9px" })}>›</button>
        <span style={{ flex: 1 }} />
        {blockerSids.length > 0 && (
          <button onClick={() => {
            const next = blockerSids.find(sid => order.indexOf(sid) > selIdx) || blockerSids[0];
            if (next) { setSelSid(next); flash(next); if (view === "grounding") scrollToSid(next); }
          }} className="np-cond" style={chipBtn({ fontWeight: 700, borderColor: "#7C74DE", color: "#7C74DE" })}>Next blocker →</button>
        )}
      </div>
      {selRow ? (
        <div style={{ border: "1px solid " + NR.line, borderRadius: 8, background: NR.field, padding: "10px 12px" }}>
          <div style={{ marginBottom: 7 }}><Pill st={selRow.st} /></div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: NR.text, marginBottom: 9 }}>{selRow.row.text}</div>
          <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>Citations</div>
          {rowCites(selRow.row).length === 0 && (
            <div className="np-mono" style={{ fontSize: 10, color: NR.muted, marginBottom: 7 }}>
              {selRow.st.key === "owned" ? "none — owned by the author, honestly labelled" : "none pinned yet"}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 9 }}>
            {rowCites(selRow.row).map(({ c, span }) => <CiteChip key={c.id} c={c} span={span} conflict={selRow.st.key === "conflict"} compact />)}
          </div>
          <div style={{ borderTop: "1px dashed " + NR.line, margin: "2px 0 10px", paddingTop: 9 }}>
            <ContextStrip row={selRow.row} />
            <div className="np-mono" style={{ fontSize: 9, color: NR.muted, lineHeight: 1.5, marginTop: 5 }}>
              Context, not proof — the prior coverage this sentence builds on, kept apart from the citations that back the claim.
            </div>
          </div>
          {candidatesFor(selRow.row, selRow.st, 3).length > 0 && (<React.Fragment>
            <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>Best matches in the registry</div>
            <div style={{ marginBottom: 9 }}><AttachCands row={selRow.row} st={selRow.st} max={3} /></div>
          </React.Fragment>)}
          {(selRow.st.key === "needs" || selRow.st.key === "conflict") && allC.length > 0 && (<React.Fragment>
            <button onClick={() => setBrowseOpen(o => !o)} className="np-cond" style={chipBtn({ marginBottom: browseOpen ? 7 : 9, fontWeight: 700, borderColor: "#1f8a55", color: "#1f8a55" })}>
              {browseOpen ? "▾ Hide registry" : "⊕ Reuse an existing citation"}
            </button>
            {browseOpen && <div style={{ marginBottom: 9 }}><AttachBrowser row={selRow.row} compact /></div>}
          </React.Fragment>)}
          {selRow.st.key !== "owned" && srcList.length > 0 && (<React.Fragment>
            <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>Find support in a source</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 9 }}>
              {srcList.map(({ key }) => (
                <button key={key} onClick={() => openCite(selRow.row.sid, key)} title="Open this source and grab the spans that support the claim"
                  style={chipBtn({ fontSize: 12 })}>{clip(srcShort(key), 24)}</button>
              ))}
            </div>
          </React.Fragment>)}
          {(selRow.st.key === "needs" || selRow.st.key === "owned") && (<React.Fragment>
            <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>…or own it — no source required</div>
            <select value={selRow.st.stance || ""} onChange={e => setStance(selRow.row, selRow.st, e.target.value)}
              style={{ width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, borderRadius: 6, padding: "5px 7px", fontFamily: "var(--cond)", fontSize: 13 }}>
              <option value="">{selRow.st.key === "owned" ? "— clear stance —" : "Own as…"}</option>
              {STANCE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button onClick={() => { openCite(selRow.row.sid); setCiteMode("void"); }} className="np-cond"
              style={chipBtn({ marginTop: 7, borderColor: "#8a6a1f", color: "#8a6a1f", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 })}
              title="Ground this in a documented absence — you looked and the record is silent">
              ∅ Cite a void — no record exists
            </button>
          </React.Fragment>)}
          {selRow.st.key === "conflict" && (
            <div className="np-mono" style={{ fontSize: 10, color: "#b3261e", lineHeight: 1.5, marginTop: 7 }}>Two pinned quotes disagree — unlink the one you trust less.</div>
          )}
        </div>
      ) : (
        <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>Select a sentence — in the table, the draft preview, or the mini map below.</div>
      )}
      <div style={Object.assign({}, eyebrow, { margin: "14px 0 6px" })}>All sentences</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {enriched.map(({ row, st }) => {
          const sel = selSid === row.sid;
          const usedByHi = highlightCid && rowCites(row).some(x => x.c.id === highlightCid);
          return (
            <button key={row.sid} onClick={() => { setSelSid(row.sid); if (view === "grounding" || view === "prose") { flash(row.sid); scrollToSid(row.sid); } }}
              style={{ display: "flex", alignItems: "center", gap: 7, textAlign: "left", border: 0, borderLeft: "3px solid " + (walk && walk.cur === row.sid ? "#7C74DE" : sel ? "var(--yellow)" : "transparent"), background: usedByHi ? "rgba(124,116,222,.12)" : sel ? NR.field : "transparent", color: sel ? NR.text : NR.soft, cursor: "pointer", padding: "4px 7px", fontFamily: "var(--cond)", fontSize: 12, lineHeight: 1.3 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOT[st.key], flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clip(row.text, 46)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ============ panel · CITATIONS / SOURCES (compact) ============
  const citationsPanel = (
    <div>
      {attachTarget && candidatesFor(attachTarget.row, attachTarget.st, 3).length > 0 && (
        <div style={{ border: "1.5px solid rgba(124,116,222,.55)", borderRadius: 8, padding: "8px 9px", marginBottom: 12, background: "rgba(124,116,222,.06)" }}>
          <div className="np-eyebrow" style={{ color: "#6b5bd6", marginBottom: 6 }}>{"Attach to: “" + clip(attachTarget.row.text, 44) + "”"}</div>
          <AttachCands row={attachTarget.row} st={attachTarget.st} max={3} />
        </div>
      )}
      <div style={Object.assign({}, eyebrow, { marginBottom: 8 })}>{"All records · " + allC.length}</div>
      {allC.length === 0 && <div className="np-mono" style={{ fontSize: 10, color: NR.muted, lineHeight: 1.6 }}>No records yet — pin a span in a source and it lands here, reusable.</div>}
      {registryList(true)}
    </div>
  );
  const sourcesPanel = (
    <div>
      {srcList.length === 0
        ? (<React.Fragment>
            <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>{addSourceForm ? "No sources yet — add one:" : "No sources yet — ingest one in the rail (Prose view)."}</div>
            {addSourceForm}
          </React.Fragment>)
        : (<React.Fragment>
          {srcTabs}
          {addSrcOpen && addSourceForm}
          {searchRow()}
          {readerBody(srcRefPanel, true)}
        </React.Fragment>)}
    </div>
  );

  // ============ chrome: progress strip + gate ============
  const segs = [["grounded", counts.grounded + counts.multi, "#1F9E76"], ["owned", counts.owned, "#7C74DE"], ["conflict", counts.conflict, "#D8412C"], ["needs", counts.needs, "#D8632E"]].filter(s => s[1] > 0);
  const progressText = (counts.grounded + counts.multi) + " grounded · " + counts.owned + " yours" + (counts.conflict ? " · " + counts.conflict + " conflict" : "") + " · " + counts.needs + " need sources — " + enriched.length + " sentences";
  const gateClick = () => {
    if (blockers > 0) {
      setView("grounding"); setNeedsOnly(true);
      say("⚑ " + blockers + " sentence" + (blockers === 1 ? "" : "s") + " still block publish — pin a source, own the claim, or resolve the conflict.");
    } else say("⊤ Gate passed. Every sentence is grounded in a source or honestly owned — ready to publish.");
  };
  const strip = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderBottom: "1px solid " + NR.line, background: NR.rail, flexWrap: "wrap" }}>
      <span style={eyebrow}>Ground truth</span>
      <div style={{ flex: 1, minWidth: 120, height: 8, display: "flex", borderRadius: 4, overflow: "hidden", background: NR.field }}>
        {segs.map(([k, n, color]) => <div key={k} title={n + " " + k} style={{ flex: n, background: color }} />)}
      </div>
      <span className="np-mono npj-hide-sm" style={{ fontSize: 9.5, color: NR.muted }}>{progressText}</span>
      <button onClick={gateClick} title="Every sentence must be grounded or owned before this draft publishes clean"
        className="np-cond" style={chipBtn({ fontWeight: 700, borderColor: blockers ? "#D8632E" : "#1F9E76", color: blockers ? "#D8632E" : "#1F9E76" })}>
        {blockers ? "⚑ " + blockers + " blocker" + (blockers === 1 ? "" : "s") : "⊤ gate open"}
      </button>
    </div>
  );

  // ============ Citey walk bar (global) + center-stage card ============
  const citeyState = walk ? "turnstile" : blockers > 0 ? "falsum" : "verum";
  const curWalkRow = walk && bySid[walk.cur] ? bySid[walk.cur].row : null;
  const walkSub = walk
    ? "“" + clip(curWalkRow ? curWalkRow.text : "", 70) + "” — pin a quote or own it · " + counts.needs + " left"
    : counts.needs
      ? counts.needs + " sentence" + (counts.needs === 1 ? "" : "s") + " need" + (counts.needs === 1 ? "s" : "") + " a source" + (counts.conflict ? " · " + counts.conflict + " conflict to resolve" : "") + " — walk through them one at a time"
      : counts.conflict
        ? "no missing sources — but " + counts.conflict + " conflict still blocks the gate"
        : "every sentence is grounded or owned — the gate is open";
  const walkBar = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderTop: "1.5px solid " + (walk ? "#7C74DE" : NR.line), background: NR.rail }}>
      {drawCitey(citeyState, walk ? 44 : 36, { wave: !!walk, hop })}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, color: NR.text }}>{walk ? "Walking through claims" : "Cite everything"}</div>
        <div className="np-mono" style={{ fontSize: 10, color: walk ? "#7C74DE" : blockers === 0 ? "#1f8a55" : NR.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{walkSub}</div>
      </div>
      {walk
        ? <button onClick={endWalk} style={chipBtn()}>Stop</button>
        : (<React.Fragment>
            {blockers > 0 && (
              <button onClick={() => setExporting(true)} className="np-cond"
                title="List the unsourced claims with the evidence each needs — a list others can help fact-check without access to the draft"
                style={chipBtn({ fontWeight: 700, borderColor: "#7C74DE", color: "#7C74DE", display: "inline-flex", alignItems: "center", gap: 5 })}>
                <window.I.shield style={{ fontSize: 12 }} /> <span className="npj-hide-sm">Export for </span>fact-check
              </button>
            )}
            <button onClick={startWalk} disabled={!counts.needs} className="np-cond"
              style={{ background: counts.needs ? "#7C74DE" : "transparent", color: counts.needs ? "#fff" : NR.muted, border: "1px solid " + (counts.needs ? "#7C74DE" : NR.line), padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: counts.needs ? "pointer" : "default" }}>Walk me through</button>
          </React.Fragment>)}
    </div>
  );
  const walkStage = walk && !modal && curWalkRow && (
    <div style={{ position: "fixed", inset: 0, zIndex: 5800, background: "rgba(8,7,5,.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 16px 86px" }} onClick={endWalk}>
      <div onClick={e => e.stopPropagation()} className="fade-in"
        style={{ display: "flex", gap: 16, alignItems: "flex-end", maxWidth: 640, width: "100%", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "6px 6px 0 rgba(0,0,0,.4)", padding: "16px 18px", animation: "pop .25s ease" }}>
        {drawCitey("turnstile", 96, { wave: true, hop })}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Cite everything</span>
            <span style={{ flex: 1 }} />
            <span className="np-mono" style={{ fontSize: 9.5, color: "#7C74DE", fontWeight: 700 }}>{counts.needs === 1 ? "LAST ONE" : counts.needs + " TO GO"}</span>
          </div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.45, margin: "7px 0 5px" }}>{"“" + curWalkRow.text + "”"}</div>
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 10 }}>
            No source backs this yet. Did you read it somewhere? Go into the source and grab the supporting spans — or own it honestly as yours.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => openCite(walk.cur)} className="np-cond" style={{ border: "1.5px solid var(--ink)", background: "var(--yellow)", color: "var(--ink)", padding: "5px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>🔍 Find support</button>
            <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>or own it:</span>
            {[["voice", "Argue ⊩", "Your stated position — argument, not fact"], ["testimony", "Assert ⊨", "Your first-hand account — you are the witness"], ["analysis", "Infer ⊢", "Your analysis — follows from the grounded facts"], ["context", "In context ⊪", "Continuing coverage — the article proves it, set against prior reporting"]].map(([v, l, ti]) => (
              <button key={v} onClick={() => curWalkRow && setStance(curWalkRow, statusOf(curWalkRow), v)} title={ti}
                style={{ border: "1px solid var(--ink)", background: "transparent", color: "var(--ink)", padding: "5px 10px", fontSize: 12, fontFamily: "var(--cond)", fontWeight: 600, cursor: "pointer" }}>{l}</button>
            ))}
            <span style={{ flex: 1 }} />
            <button onClick={nextWalk} style={{ border: 0, background: "none", color: "var(--ink-soft)", fontFamily: "var(--cond)", fontSize: 12.5, cursor: "pointer" }}>Skip →</button>
            <button onClick={endWalk} title="Esc also stops the walkthrough" style={{ border: 0, background: "none", color: "var(--ink-soft)", fontFamily: "var(--cond)", fontSize: 12.5, cursor: "pointer" }}>Stop</button>
          </div>
        </div>
      </div>
    </div>
  );

  // ============ the cite modal: claim + document, hero ============
  const citeModal = modal && armedRow && (
    <div style={{ position: "fixed", inset: 0, zIndex: 5900, background: "rgba(8,7,5,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={closeCite}>
      <div onClick={e => e.stopPropagation()} className="fade-in"
        style={{ width: "min(880px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: NR.panel, color: NR.text, border: "1.5px solid " + NR.line, boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid " + NR.line }}>
          {drawCitey("turnstile", 34, { wave: true })}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, color: NR.text }}>Ground this claim</div>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.soft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"“" + armedRow.text + "”"}</div>
          </div>
          <button onClick={closeCite} style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        {/* three ways to ground a claim — pick one; the busywork lives behind the choice */}
        <div style={{ display: "flex", borderBottom: "1px solid " + NR.line }}>
          {[["source", "📎 From a source", "Point to the exact words in a source that back this up"],
            ["own", "✍️ It’s mine", "Argue, assert or infer it — honestly labelled, no source needed"],
            ["void", "∅ A void", "Cite an absence — you looked and the record is silent"]].map(([m, label, desc]) => (
            <button key={m} onClick={() => setCiteMode(m)} title={desc}
              style={{ flex: 1, border: 0, borderRight: m !== "void" ? "1px solid " + NR.line : 0, borderBottom: citeMode === m ? "2px solid var(--yellow)" : "2px solid transparent", background: citeMode === m ? NR.field : "transparent", color: citeMode === m ? NR.text : NR.soft, cursor: "pointer", padding: "9px 8px", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <div className="np-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
          {citeMode === "source" && (srcList.length === 0
            ? (<React.Fragment>
                <div className="np-mono" style={{ fontSize: 11, color: NR.soft, lineHeight: 1.6, marginBottom: addSourceForm ? 4 : 0 }}>
                  {addSourceForm
                    ? <React.Fragment>No sources on this draft yet — <strong style={{ color: NR.text }}>add the one that backs this claim</strong> and grab the words, right here. Or ground it as <button onClick={() => setCiteMode("own")} style={{ border: 0, background: "none", color: "#6b5bd6", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>your own</button> or a <button onClick={() => setCiteMode("void")} style={{ border: 0, background: "none", color: "#8a6a1f", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>void</button>.</React.Fragment>
                    : <React.Fragment>No sources added yet — add one in the Sources rail (Prose view), then come back. Or ground this as <button onClick={() => setCiteMode("own")} style={{ border: 0, background: "none", color: "#6b5bd6", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>your own</button> or a <button onClick={() => setCiteMode("void")} style={{ border: 0, background: "none", color: "#8a6a1f", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>void</button>.</React.Fragment>}
                </div>
                {addSourceForm}
              </React.Fragment>)
            : (<React.Fragment>
                <div className="np-mono" style={{ fontSize: 10.5, color: NR.soft, lineHeight: 1.5, marginBottom: 8 }}>Open the source and <strong style={{ color: NR.text }}>select the exact words</strong> that support the claim — that becomes the citation. Support in two places? Grab them one after another.</div>
                {srcTabs}
                {addSrcOpen && addSourceForm}
                {searchRow("Search this source for the supporting words…")}
                {readerBody(srcRefModal, false)}
                {hitNav}
                {armHits.length === 0 && srcText(selSrc).trim() && (
                  <div className="np-mono" style={{ fontSize: 10, color: NR.soft, lineHeight: 1.45, marginTop: 7 }}>
                    No obvious match in this source — read it; if the support isn’t here, try another source, or ground it as your own / a void.
                  </div>
                )}
                {pendingBar}
                {allC.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px dashed " + NR.line, paddingTop: 10 }}>
                    <button onClick={() => setReuseOpen(o => !o)} className="np-cond" style={chipBtn({ fontWeight: 700 })}>
                      {reuseOpen ? "▾ Hide pinned quotes" : "↺ Reuse a quote you’ve already pinned"}
                    </button>
                    {reuseOpen && <div style={{ marginTop: 8 }}><AttachBrowser row={armedRow} /></div>}
                  </div>
                )}
              </React.Fragment>))}

          {citeMode === "own" && (<React.Fragment>
            <div className="np-mono" style={{ fontSize: 11, color: NR.soft, lineHeight: 1.55, marginBottom: 10 }}>This claim is <strong style={{ color: NR.text }}>yours</strong> — not taken from a source. Say what kind, and it publishes openly labelled as such.</div>
            {[["testimony", "⊨ Assert — your account", "You witnessed this first-hand. You are the source."],
              ["voice", "⊩ Argue — your voice", "Your stated position or argument — not presented as fact."],
              ["analysis", "⊢ Infer — your analysis", "Your reasoning — it follows from facts you’ve already grounded."],
              ["context", "⊪ In context", "Continuing coverage — the article itself substantiates it, set against prior reporting."]].map(([v, label, desc]) => (
              <button key={v} onClick={() => { setStance(armedRow, statusOf(armedRow), v); closeCite(); }}
                style={{ display: "block", width: "100%", textAlign: "left", border: "1px solid " + NR.line, background: NR.field, color: NR.text, cursor: "pointer", padding: "9px 12px", marginBottom: 7 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14 }}>{label}</div>
                <div className="np-mono" style={{ fontSize: 10.5, color: NR.soft, lineHeight: 1.5, marginTop: 3 }}>{desc}</div>
              </button>
            ))}
          </React.Fragment>)}

          {citeMode === "void" && (() => {
            const VK = window.NpjVoidKinds;
            const k = VK ? VK.norm(voidKind) : null;
            const def = k && VK ? VK.get(k) : null;
            const ready = !!voidNote.trim() || k === "ambient";
            return (<React.Fragment>
            <div style={{ display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 12 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 30, color: "#8a6a1f", lineHeight: 1, flex: "0 0 auto" }}>∅</span>
              <div className="np-mono" style={{ fontSize: 11, color: NR.soft, lineHeight: 1.6 }}>
                Some claims rest on an <strong style={{ color: NR.text }}>absence</strong> — something that isn’t in the record. There’s no source to pin, so you ground it by saying which <strong style={{ color: NR.text }}>kind</strong> of void it is and documenting it. The kind tells a reader whether you’re showing an absence or inferring one — it publishes with the claim.
              </div>
            </div>
            {VK ? (<React.Fragment>
              {VK.GROUPS.map(g => (
                <div key={g.key} style={{ marginBottom: 9 }}>
                  <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>{g.verb} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: NR.muted }}>· {g.gloss}</span></div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {VK.kindsIn(g.key).map(kk => { const on = k === kk; const d = VK.get(kk); return (
                      <button key={kk} onClick={() => setVoidKind(kk)} title={d.blurb} className="np-cond"
                        style={{ border: "1.5px solid " + (on ? "var(--ink)" : NR.line), background: on ? "var(--yellow)" : NR.field, color: on ? "var(--ink)" : NR.text, padding: "6px 11px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{d.glyph}</span> {d.label}</button>
                    ); })}
                  </div>
                </div>
              ))}
              {def && (<React.Fragment>
                <div className="np-mono" style={{ fontSize: 11, color: NR.soft, lineHeight: 1.6, margin: "10px 0 6px", borderTop: "1px solid " + NR.line, paddingTop: 10 }}>{def.blurb}</div>
                <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>{def.prompt}</div>
                <textarea value={voidNote} onChange={e => setVoidNote(e.target.value)} autoFocus placeholder={def.prompt}
                  style={{ width: "100%", boxSizing: "border-box", minHeight: 88, border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, padding: "9px 11px", outline: "none", resize: "vertical" }} />
                <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, lineHeight: 1.5, marginTop: 5 }}>{k === "ambient" ? "Ambient is context, not a finding — optional, and the faintest void in the lens." : "Be specific — what you document is what makes the absence trustworthy. It reads in the published piece; the words of the claim stay exactly as written."}</div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button onClick={() => { if (!ready) return; setStance(armedRow, statusOf(armedRow), "absence", voidNote.trim(), k); closeCite(); }} disabled={!ready} className="np-cond"
                    style={{ border: "1.5px solid var(--ink)", background: ready ? "var(--yellow)" : "transparent", color: ready ? "var(--ink)" : NR.muted, padding: "7px 15px", fontSize: 13, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : .55 }}>{def.glyph} Cite this void</button>
                </div>
              </React.Fragment>)}
            </React.Fragment>) : (<React.Fragment>
              <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>Where did you look, and what wasn’t there?</div>
              <textarea value={voidNote} onChange={e => setVoidNote(e.target.value)} autoFocus
                style={{ width: "100%", boxSizing: "border-box", minHeight: 96, border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, padding: "9px 11px", outline: "none", resize: "vertical" }} />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button onClick={() => { const n = voidNote.trim(); if (!n) return; setStance(armedRow, statusOf(armedRow), "absence", n); closeCite(); }} disabled={!voidNote.trim()} className="np-cond"
                  style={{ border: "1.5px solid var(--ink)", background: voidNote.trim() ? "var(--yellow)" : "transparent", color: voidNote.trim() ? "var(--ink)" : NR.muted, padding: "7px 15px", fontSize: 13, fontWeight: 700, cursor: voidNote.trim() ? "pointer" : "not-allowed", opacity: voidNote.trim() ? 1 : .55 }}>∅ Cite this void</button>
              </div>
            </React.Fragment>)}
            </React.Fragment>);
          })()}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: "1px solid " + NR.line }}>
          <span className="np-mono" style={{ flex: 1, fontSize: 9.5, color: NR.muted, lineHeight: 1.4 }}>
            {citeMode === "source" ? "Select the supporting words in the source, then press Cite. Esc clears a staged span, then exits."
              : citeMode === "own" ? "Owning a claim labels it honestly — the publish gate won’t ask it for a source."
              : "A documented void grounds a negative claim with the search behind it — no source required."}
          </span>
          <button onClick={closeCite} style={chipBtn()}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ============ shell ============
  const panelEl = panel === "prose" ? prosePanel : panel === "grounding" ? groundingPanel : panel === "citations" ? citationsPanel : sourcesPanel;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: NR.bg, color: NR.text }}>
      {strip}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <main ref={mainRef} className="np-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 16px 40px" }}>
          {view === "grounding" && groundingMain}
          {view === "citations" && citationsMain}
          {view === "sources" && sourcesMain}
        </main>
        {!isMobile && (
          <aside style={{ width: 310, flexShrink: 0, borderLeft: "1.5px solid " + NR.line, background: NR.rail, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 10px", borderBottom: "1px solid " + NR.line }}>
              <span style={eyebrow}>Panel</span>
              {VIEWS.filter(([v]) => v !== view).map(([v, label]) => (
                <button key={v} onClick={() => setPanel(v)}
                  style={chipBtn({ fontSize: 11.5, padding: "2px 8px", background: panel === v ? "var(--yellow)" : "transparent", color: panel === v ? "var(--ink)" : NR.soft, borderColor: panel === v ? "var(--yellow)" : NR.line, fontWeight: 700 })}>{label}</button>
              ))}
            </div>
            <div className="np-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 12px 30px" }}>
              {panelEl}
            </div>
          </aside>
        )}
      </div>
      {walkBar}
      {walkStage}
      {citeModal}
      {exporting && window.FactCheckExport && (
        <window.FactCheckExport payload={buildPayload()} onClose={() => setExporting(false)} />
      )}
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 6000, maxWidth: "min(560px, calc(100vw - 32px))", background: "var(--ink)", color: "var(--paper)", padding: "10px 16px", fontFamily: "var(--cond)", fontSize: 13.5, lineHeight: 1.4, boxShadow: "0 10px 30px rgba(0,0,0,.4)", animation: "pop .2s ease" }}>{toast}</div>
      )}
    </div>
  );
}

// paste-to-seed: the reader can't show text it doesn't have — the author supplies
// the passage (it sticks to the source record, same as the pin popover's flow)
function SeedBox({ onSeed }) {
  const [paste, setPaste] = useState("");
  return (
    <div style={{ padding: "12px 16px 16px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "rgba(22,20,13,.6)", lineHeight: 1.5, marginBottom: 6 }}>
        No text on record for this source yet — paste the passage (or the whole document) and it sticks to the record for reading, searching and citing.
      </div>
      <textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder="Paste the source text here…"
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid rgba(22,20,13,.4)", background: "#fffdf6", color: "#16140d", fontFamily: "var(--serif)", fontSize: 12.5, padding: "7px 8px", outline: "none" }} />
      <button onClick={() => { if (paste.trim()) { onSeed(paste); setPaste(""); } }} className="np-cond"
        style={{ marginTop: 6, border: "1.5px solid #16140d", background: "var(--yellow)", color: "#16140d", padding: "5px 11px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" }}>Load the text</button>
    </div>
  );
}

// ============================================================================
// DataTable — the standard, responsive table shared by the Grounding, Citations
// and Sources views. Desktop: a real <table> with a header row. Phone (isMobile):
// every row stacks into a labelled card so nothing scrolls sideways off a narrow
// screen — the conventional "responsive table" collapse, done in JS to match the
// rest of the newsroom (which flips layouts on useIsMobile, not via CSS).
//   cols: [{ key, label, align?, width?, grow?, cardHide?, cell(data) }]
//     grow   — the primary column (takes the slack on desktop, full-width + no
//              label on the phone card).
//   rows: [{ key, data, active?, onClick?, style?, attrs?, custom? }]
//     onClick — makes the whole row a click target (e.g. open a source); cells
//               with their own buttons must stopPropagation.
//     custom(colCount) — render a full-width cell instead (the inline rename box).
// ============================================================================
function DataTable({ cols, rows, isMobile, NR }) {
  const th = { textAlign: "left", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".09em", textTransform: "uppercase", color: NR.muted, fontWeight: 600, padding: "9px 10px 7px", whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", borderTop: "1px solid " + NR.line, verticalAlign: "middle", color: NR.text };

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => {
          if (r.custom) return (
            <div key={r.key} style={{ border: "1px solid var(--yellow)", borderRadius: 8, background: NR.field, padding: 10 }}>{r.custom(cols.length)}</div>
          );
          const base = {
            border: "1px solid " + (r.active ? "var(--yellow)" : NR.line),
            borderLeft: "3px solid " + (r.active ? "var(--yellow)" : NR.line),
            borderRadius: 8, background: NR.field, overflow: "hidden",
            cursor: r.onClick ? "pointer" : "default",
          };
          return (
            <div key={r.key} {...(r.attrs || {})} onClick={r.onClick}
              className={r.onClick ? "npj-rrow" : undefined}
              style={Object.assign(base, r.style || {})}>
              {cols.filter(c => !c.cardHide).map(c => {
                const content = c.cell(r.data);
                if (content == null || content === false) return null;
                return (
                  <div key={c.key} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "7px 12px", borderTop: "1px solid " + NR.line }}>
                    {c.label && !c.grow ? <span style={{ flex: "0 0 84px", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: NR.muted, paddingTop: 2 }}>{c.label}</span> : null}
                    <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", border: "1px solid " + NR.line, borderRadius: 8, background: NR.field }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--cond)" }}>
        <thead>
          <tr style={{ background: NR.bg }}>
            {cols.map(c => <th key={c.key} style={Object.assign({}, th, { textAlign: c.align || "left", width: c.grow ? "100%" : c.width })}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            if (r.custom) return (
              <tr key={r.key} style={{ background: "rgba(255,236,1,.06)" }}>
                <td style={td} colSpan={cols.length}>{r.custom(cols.length)}</td>
              </tr>
            );
            return (
              <tr key={r.key} {...(r.attrs || {})} onClick={r.onClick}
                className={r.onClick ? "npj-rrow" : undefined}
                style={Object.assign({ background: r.active ? "rgba(255,236,1,.07)" : "transparent", cursor: r.onClick ? "pointer" : "default" }, r.style || {})}>
                {cols.map((c, ci) => (
                  <td key={c.key} style={Object.assign({}, td, { textAlign: c.align || "left" }, ci === 0 ? { borderLeft: "3px solid " + (r.active ? "var(--yellow)" : "transparent") } : null)}>
                    {c.cell(r.data)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

window.GroundingWorkspace = GroundingWorkspace;
})();
