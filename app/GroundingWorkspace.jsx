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
const STANCE_GLYPH = { voice: "⊩", testimony: "⊨", analysis: "⊢" };
const STANCE_LABEL = { voice: "Your voice", testimony: "Your account", analysis: "Your analysis" };
const STANCE_OPTS = [["voice", "Argue — your voice ⊩"], ["testimony", "Assert — your account ⊨"], ["analysis", "Infer — your analysis ⊢"]];
const DOT = { grounded: "#1F9E76", multi: "#6ea8d8", owned: "#7C74DE", needs: "#D8632E", conflict: "#D8412C" };

// Status pill (solid backgrounds read in both newsroom themes).
function pillFor(st) {
  if (st.key === "conflict") return { glyph: "¬", label: "Sources disagree", fg: "#b3261e", bg: "#fdecea" };
  if (st.key === "multi") return { glyph: "⊨", label: st.nSrc + " sources", fg: "#3a63c4", bg: "#e8eefb" };
  if (st.key === "grounded") return { glyph: "⊤", label: "Grounded", fg: "#1f8a55", bg: "#e7f4ec" };
  if (st.key === "owned") return { glyph: STANCE_GLYPH[st.stance] || "⊩", label: STANCE_LABEL[st.stance] || "Your voice", fg: "#6b5bd6", bg: "#efeafc" };
  return { glyph: "⊥", label: "Needs source", fg: "#b5701b", bg: "#fbf1e3" };
}

// Aggregate a sentence's grounding status off its live claim spans — mechanical,
// same read as the publish gate (CiteyBrain), no model.
function statusOf(row) {
  const Brain = window.CiteyBrain;
  const spans = row.claimSpans || [];
  let stance = null, conflict = false, needs = false; const keys = {};
  spans.forEach(s => {
    let v = { state: "falsum" };
    try { v = Brain.citeyStateForSpan({ el: s }); } catch (e) {}
    if (v.state === "asserted" || v.state === "testimony" || v.state === "voice") stance = s.getAttribute("data-stance") || "analysis";
    else if (v.state === "verum" || v.state === "entails") String(v.srcKey || s.getAttribute("data-src") || "").split(/\s+/).filter(Boolean).forEach(k => { keys[k] = 1; });
    else if (v.state === "negation") conflict = true;
    else needs = true;
  });
  const n = Object.keys(keys).length;
  if (conflict) return { key: "conflict", spans };
  if (stance && !n && !needs) return { key: "owned", stance, spans };
  if (n && !needs) return { key: n > 1 ? "multi" : "grounded", nSrc: n, spans };
  return { key: "needs", spans };
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
function drawCitey(stateName, width, opts) {
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
  const [toast, setToast] = useState(null);
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
      say("⊤ Every sentence is grounded or owned — Citey can rest." + (conf ? " Resolve the conflict and the gate opens." : ""));
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

  // ---- mutations (all route through the Newsroom api → same DOM + autosave) ----
  const attachExisting = (row, citeId) => {
    api.attachExisting(row, citeId);
    setModal(null); setPending(null); setSelSid(row.sid);
    afterResolve(row.sid); bump();
  };
  const detach = (span, citeId) => { api.detach(span, citeId); bump(); };
  const setStance = (row, st, stance) => {
    if (!stance) { (st.spans || []).filter(s => s.getAttribute("data-stance")).forEach(s => api.unown(s)); }
    else { api.own(row, stance); afterResolve(row.sid); }
    bump();
  };

  // ---- the cite modal: the claim + the document, hero ----
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
    setPending(null); setArmIdx(0); setSrcQuery(""); setSrcFindIdx(0);
  };
  const closeCite = () => { setModal(null); setPending(null); setArmIdx(0); };

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

  // ---- drag-select → staged pin: the author finds the words themself ----
  const onSrcMouseUp = (refObj) => {
    if (!modal) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const outer = refObj.current;
    const cont = outer ? (outer.querySelector("[data-doctext]") || outer) : null;
    const r = sel.getRangeAt(0);
    if (!cont || !cont.contains(r.commonAncestorContainer)) return;
    const quote = r.toString().trim();
    if (!quote || quote.length < 3) return;
    const pre = document.createRange();
    pre.setStart(cont, 0); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    const len = r.toString().length;
    sel.removeAllRanges();
    setPending(p => {
      const spans = (p && p.spans) ? p.spans.slice() : [];
      const span = { quote, loc: { start, end: start + len } };
      if (!spans.some(x => x.loc.start < span.loc.end && span.loc.start < x.loc.end)) spans.push(span);
      spans.sort((a, b) => a.loc.start - b.loc.start);
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

  // ---- the source reader: the document carries its own identity ----
  // Pending spans (staged) > search finds > scent hits / citation marks.
  const readerBody = (refObj, compact) => {
    const rec = srcRec(selSrc);
    const t = srcText(selSrc);
    const armed = !!modal;
    const letterhead = (
      <div key="lh" style={{ position: "sticky", top: 0, zIndex: 2, background: "#f6f1e4", borderBottom: "2px solid #16140d", padding: compact ? "9px 12px 7px" : "11px 16px 9px", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".08em", background: "#16140d", color: "#f6f1e4", padding: "2px 6px" }}>{kindOf(rec)}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: ".1em", color: rec.archive_url ? "rgba(22,20,13,.55)" : "#b3261e" }}>{rec.archive_url ? "ARCHIVED SOURCE" : "NOT ARCHIVED"}</span>
        </div>
        <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: compact ? 14.5 : 16.5, lineHeight: 1.15, color: "#16140d" }}>{rec.title || selSrc}</div>
      </div>
    );
    if (!t.trim()) {
      // no text on record yet — the reader can't show what it doesn't have
      return (
        <div ref={refObj} className="np-scroll" style={{ background: "#f6f1e4", color: "#16140d", border: "1px solid " + NR.line, maxHeight: compact ? 300 : 440, overflowY: "auto" }}>
          {letterhead}
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
          <mark key={"h" + it.j} data-hit={it.j} title="Citey scents this passage — read it; select the words yourself if they back the claim"
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
      <div ref={refObj} onMouseUp={() => onSrcMouseUp(refObj)} className="np-scroll"
        style={{ background: "#f6f1e4", color: "#16140d", border: "1px solid " + NR.line, fontFamily: "var(--serif)", fontSize: compact ? 13 : 14.5, lineHeight: 1.62, userSelect: "text", cursor: modal ? "text" : "default", maxHeight: compact ? 300 : 440, overflowY: "auto", boxShadow: modal ? "inset 0 0 0 2px var(--yellow)" : "none" }}>
        {letterhead}
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

  const srcTabs = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {srcList.map(({ key }) => (
        <button key={key} onClick={() => pickSource(key)}
          style={chipBtn({ background: selSrc === key ? "var(--yellow)" : "transparent", color: selSrc === key ? "var(--ink)" : NR.text, borderColor: selSrc === key ? "var(--yellow)" : NR.line, fontWeight: 700 })}>
          {clip(srcShort(key), 26)}
        </button>
      ))}
    </div>
  );

  const hitNav = armHits.length > 0 && (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
      <span className="np-mono" style={{ flex: 1, fontSize: 10, color: NR.soft, lineHeight: 1.45 }}>
        {"Citey scents " + armHits.length + " passage" + (armHits.length === 1 ? "" : "s") + " — read them, then grab the spans that actually support the claim"}
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
              {(pendSpans.length > 1 ? "Part " + (i + 1) + " · " : "") + "“" + clip(p.quote, 62) + "” · chars " + p.loc.start + "–" + p.loc.end}
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
  const groundingMain = (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 14, color: NR.text }}>
          <input type="checkbox" checked={needsOnly} onChange={e => setNeedsOnly(e.target.checked)} />
          Blockers only
        </label>
        <span style={{ flex: 1 }} />
        <span className="np-mono" title="Every sentence you write is imported here automatically. Each carries a stable id (the # chip) that follows it through edits and moves, keeping its citations and stance attached." style={{ fontSize: 11, color: NR.muted, cursor: "help", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <window.I.hash style={{ fontSize: 11 }} /> {shown.length + " of " + enriched.length + " sentences · auto-imported"}
        </span>
      </div>
      <div style={{ border: "1px solid " + NR.line, borderRadius: 10, overflow: "hidden", background: NR.field }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px minmax(200px,1.6fr) minmax(180px,1fr) 168px", padding: "10px 14px", gap: 12 }}>
          {["Status", "Sentence", "Citations", "Stance"].map(h => <div key={h} style={eyebrow}>{h}</div>)}
        </div>
        {shown.length === 0 && (
          <div className="np-mono" style={{ padding: "12px 14px", borderTop: "1px solid " + NR.line, color: NR.muted, fontSize: 12 }}>
            {needsOnly ? "Nothing blocks publish — every sentence is sourced or owned." : "Write a few sentences in Prose and they'll show here as rows to ground."}
          </div>
        )}
        {shown.map(({ row, st }) => {
          const cites = rowCites(row);
          const onWalk = walk && walk.cur === row.sid;
          const sel = selSid === row.sid;
          const hi = highlightCid && cites.some(x => x.c.id === highlightCid);
          const conf = st.key === "conflict";
          return (
            <div key={row.sid} data-sid={row.sid}
              style={{ display: "grid", gridTemplateColumns: "140px minmax(200px,1.6fr) minmax(180px,1fr) 168px", gap: 12, padding: "12px 14px", borderTop: "1px solid " + NR.line, background: onWalk ? "rgba(124,116,222,.12)" : st.key === "needs" ? "rgba(216,99,46,.05)" : conf ? "rgba(216,65,44,.05)" : "transparent", outline: onWalk ? "2px solid #7C74DE" : hi ? "2px solid var(--yellow)" : sel ? "1.5px solid rgba(124,116,222,.45)" : "none", outlineOffset: -2, animation: flashSid === row.sid ? "rowflash 1.6s ease-out" : "none" }}>
              <div><Pill st={st} /></div>
              <div>
                <button onClick={() => { setSelSid(row.sid); api.jumpTo(row); }} title="Open this sentence in the editor"
                  style={{ textAlign: "left", background: "none", border: 0, color: NR.text, font: "inherit", fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.45, cursor: "pointer", padding: 0 }}>{row.text}</button>
                <div style={{ marginTop: 5 }}><HashChip row={row} NR={NR} /></div>
              </div>
              <div>
                {st.key === "owned"
                  ? <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.muted }}>no source needed</span>
                  : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      {cites.map(({ c, span }) => <CiteChip key={c.id} c={c} span={span} conflict={conf} />)}
                      <button onClick={() => openCite(row.sid)} title="Find the words in a source that back this sentence"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, border: "1px dashed " + NR.line, background: "transparent", color: NR.soft, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 12.5 }}>+ Cite</button>
                    </div>
                  )}
              </div>
              <div>
                {(st.key === "grounded" || st.key === "multi") && <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.muted }}>sourced fact</span>}
                {conf && <span className="np-mono" style={{ fontSize: 10, color: "#b3261e", lineHeight: 1.4 }}>unlink the quote you trust less</span>}
                {(st.key === "needs" || st.key === "owned") && (
                  <select value={st.stance || ""} onChange={e => setStance(row, st, e.target.value)}
                    style={{ width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, borderRadius: 6, padding: "5px 7px", fontFamily: "var(--cond)", fontSize: 13 }}>
                    <option value="">{st.key === "owned" ? "— clear stance —" : "Own as…"}</option>
                    {STANCE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ margin: "12px 2px 20px", fontFamily: "var(--serif)", fontSize: 12.5, color: NR.muted, lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700, color: NR.text, marginBottom: 2 }}>What the labels mean</div>
        <span style={{ color: "#1f8a55", fontWeight: 700 }}>⊤ Grounded</span> — a pinned quote in an archived source backs the claim &nbsp;·&nbsp;
        <span style={{ color: "#3a63c4", fontWeight: 700 }}>⊨ N sources</span> — backed independently by more than one source &nbsp;·&nbsp;
        <span style={{ color: "#b5701b", fontWeight: 700 }}>⊥ Needs source</span> — nothing pinned yet; blocks the gate &nbsp;·&nbsp;
        <span style={{ color: "#6b5bd6", fontWeight: 700 }}>⊩ Yours</span> — argued, witnessed, or inferred; honestly labelled &nbsp;·&nbsp;
        <span style={{ color: "#b3261e", fontWeight: 700 }}>¬ Sources disagree</span> — two pinned quotes conflict; unlink one
      </div>
    </section>
  );

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
  const citationsMain = (
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
      {allC.length === 0 && <div className="np-mono" style={{ fontSize: 11, color: NR.muted, lineHeight: 1.6 }}>No records yet — open a sentence's “+ Cite”, go into a source and grab the words that back it. The pinned span lands here, reusable.</div>}
      {registryList(false)}
    </section>
  );

  // ============ main stage · SOURCES (the library + the reader) ============
  const sourcesMain = (
    <section style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="np-eyebrow" style={{ color: NR.muted }}>Source library · {srcList.length}</div>
        {srcList.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>No sources yet — ingest one in the rail (Prose view) and it shows here to read and cite.</div>}
        {srcList.map(({ key, rec }) => {
          const nC = allC.filter(c => c.srcKey === key).length;
          const active = selSrc === key;
          return (
            <button key={key} onClick={() => pickSource(key)}
              style={{ textAlign: "left", border: "1.5px solid " + (active ? "var(--yellow)" : NR.line), background: active ? "rgba(255,236,1,.06)" : NR.field, borderRadius: 8, padding: "9px 11px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".08em", color: NR.muted }}>{kindOf(rec)}</span>
              <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13.5, color: NR.text, lineHeight: 1.2 }}>{rec.title || key}</span>
              <span className="np-mono" style={{ fontSize: 9, color: NR.muted }}>{nC + " CITATION" + (nC === 1 ? "" : "S") + " MINTED" + (rec.archive_url ? " · ARCHIVED" : "")}</span>
            </button>
          );
        })}
      </div>
      {srcList.length > 0 && (
        <div style={{ flex: 1, minWidth: 300 }}>
          {searchRow()}
          {readerBody(srcRefMain, false)}
          <div className="np-mono" style={{ fontSize: 9.5, color: NR.muted, lineHeight: 1.5, marginTop: 8 }}>
            {allC.filter(c => c.srcKey === selSrc).length + " citation record" + (allC.filter(c => c.srcKey === selSrc).length === 1 ? "" : "s") + " minted from this source · highlighted spans are cited support · click one to select it"}
          </div>
        </div>
      )}
    </section>
  );

  // ============ panel · PROSE (compact, status-shaded preview) ============
  const proseShade = (key) => {
    if (key === "conflict") return { background: "rgba(216,65,44,.16)", borderBottom: "1.5px solid #D8412C" };
    if (key === "owned") return { background: "rgba(124,116,222,.14)", borderBottom: "1.5px solid #7C74DE" };
    if (key === "needs") return { background: "rgba(216,99,46,.15)", borderBottom: "1.5px dashed #D8632E" };
    return { background: "rgba(255,236,1,.13)", borderBottom: "1.5px solid #d8c520" };
  };
  const proseSup = (st) => {
    const map = { conflict: ["¬", "#b3261e"], needs: ["⚑", "#b5701b"], grounded: ["⊤", "#9a8500"], multi: ["⊨", "#9a8500"] };
    const pair = st.key === "owned" ? [STANCE_GLYPH[st.stance] || "⊩", "#6b5bd6"] : map[st.key];
    return <sup style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: pair[1], marginLeft: 2, lineHeight: 0 }}>{pair[0]}</sup>;
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
                    style={Object.assign({ cursor: "pointer", padding: "0 1px", outline: selSid === row.sid ? "1.5px solid rgba(124,116,222,.8)" : "none", outlineOffset: 2, animation: flashSid === row.sid ? "rowflash 1.8s ease-out" : "none" }, proseShade(st.key))}>
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
          {candidatesFor(selRow.row, selRow.st, 3).length > 0 && (<React.Fragment>
            <div style={Object.assign({}, eyebrow, { marginBottom: 5 })}>Best matches in the registry</div>
            <div style={{ marginBottom: 9 }}><AttachCands row={selRow.row} st={selRow.st} max={3} /></div>
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
        ? <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>No sources yet — ingest one in the rail (Prose view).</div>
        : (<React.Fragment>
          {srcTabs}
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
      ? counts.needs + " sentence" + (counts.needs === 1 ? "" : "s") + " need" + (counts.needs === 1 ? "s" : "") + " a source" + (counts.conflict ? " · " + counts.conflict + " conflict to resolve" : "") + " — Citey will walk you through them"
      : counts.conflict
        ? "no missing sources — but " + counts.conflict + " conflict still blocks the gate"
        : "every sentence is grounded or owned — the gate is open";
  const walkBar = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderTop: "1.5px solid " + (walk ? "#7C74DE" : NR.line), background: NR.rail }}>
      {drawCitey(citeyState, walk ? 44 : 36, { wave: !!walk, hop })}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, color: NR.text }}>{walk ? "Citey has the floor" : "Citey — cite everything"}</div>
        <div className="np-mono" style={{ fontSize: 10, color: walk ? "#7C74DE" : blockers === 0 ? "#1f8a55" : NR.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{walkSub}</div>
      </div>
      {walk
        ? <button onClick={endWalk} style={chipBtn()}>Stop</button>
        : <button onClick={startWalk} disabled={!counts.needs} className="np-cond"
            style={{ background: counts.needs ? "#7C74DE" : "transparent", color: counts.needs ? "#fff" : NR.muted, border: "1px solid " + (counts.needs ? "#7C74DE" : NR.line), padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: counts.needs ? "pointer" : "default" }}>Walk me through</button>}
    </div>
  );
  const walkStage = walk && !modal && curWalkRow && (
    <div style={{ position: "fixed", inset: 0, zIndex: 5800, background: "rgba(8,7,5,.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 16px 86px" }} onClick={endWalk}>
      <div onClick={e => e.stopPropagation()} className="fade-in"
        style={{ display: "flex", gap: 16, alignItems: "flex-end", maxWidth: 640, width: "100%", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "6px 6px 0 rgba(0,0,0,.4)", padding: "16px 18px", animation: "pop .25s ease" }}>
        {drawCitey("turnstile", 96, { wave: true, hop })}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Citey — cite everything</span>
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
            {[["voice", "Argue ⊩", "Your stated position — argument, not fact"], ["testimony", "Assert ⊨", "Your first-hand account — you are the witness"], ["analysis", "Infer ⊢", "Your analysis — follows from the grounded facts"]].map(([v, l, ti]) => (
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
            <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, color: NR.text }}>Find what supports this claim</div>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.soft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"“" + armedRow.text + "”"}</div>
          </div>
          <button onClick={closeCite} style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div className="np-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
          {candidatesFor(armedRow, statusOf(armedRow), 3).length > 0 && (<React.Fragment>
            <div style={Object.assign({}, eyebrow, { marginBottom: 6 })}>Already in the registry — reuse the record</div>
            <div style={{ marginBottom: 12 }}><AttachCands row={armedRow} st={statusOf(armedRow)} max={3} /></div>
          </React.Fragment>)}
          <div style={Object.assign({}, eyebrow, { marginBottom: 6 })}>…or go into a source and grab the spans that support it</div>
          {srcList.length === 0
            ? <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.6 }}>No sources ingested yet — add one in the rail (Prose view), then come back.</div>
            : (<React.Fragment>
              {srcTabs}
              {searchRow("Search this document — find the part that supports the claim…")}
              {readerBody(srcRefModal, false)}
              {hitNav}
              {armHits.length === 0 && srcText(selSrc).trim() && (
                <div className="np-mono" style={{ fontSize: 10, color: NR.soft, lineHeight: 1.45, marginTop: 7 }}>
                  No strong scent in this source — read it; if the support isn't here, try another source or own the claim.
                </div>
              )}
              {pendingBar}
              {!pendSpans.length && (
                <div className="np-mono" style={{ fontSize: 10, color: NR.muted, lineHeight: 1.5, marginTop: 8 }}>
                  Not the document — the part of the document. Read it and select the exact words; if the claim rests on two parts, select them one after another.
                </div>
              )}
            </React.Fragment>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: "1px solid " + NR.line }}>
          <span className="np-mono" style={{ flex: 1, fontSize: 9, color: NR.muted, lineHeight: 1.4 }}>
            Citing the spans mints a reusable record — the exact supporting words + their offsets. Esc clears staged spans, then exits.
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

window.GroundingWorkspace = GroundingWorkspace;
})();
