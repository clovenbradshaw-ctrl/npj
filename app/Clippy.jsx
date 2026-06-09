/* NPJ — Clippy, the drafting assistant (tags & structure only).
   Sourcing is MANUAL and span-bound (select text → ⊨ Source), so Clippy never
   touches citations. What he does help with: suggesting tags for the piece (from
   mechanical eoreader3 entity extraction — no model) and recommending which front
   column to file under. Hidden by default; summon with the 📎 launcher. */

const CL_SHEET = (window.CLIPPY_SHEETS || {}).clippyjs || "";
const CL = () => window.CLIPPY_DATA || { anims: {}, mapping: {} };

const CL_SEQ = {
  greet:   ["Show", "Greeting"],
  look:    ["Hearing_1", "Searching", "CheckingSomething"],
  think:   ["Thinking", "Processing"],
  write:   ["Writing", "Explain"],
  point:   ["GestureUp", "Explain"],
  happy:   ["Congratulate"],
  bye:     ["Wave", "GoodBye", "Hide"]
};

function readDraft() {
  const el = document.querySelector(".md-preview, .cmp-body");
  if (!el) return { el: null, text: "", title: "Draft" };
  const titleEl = document.querySelector('textarea[placeholder="Headline"]');
  const h1 = el.querySelector("h1");
  const title = (titleEl && titleEl.value) || (h1 && h1.innerText) || "Draft";
  const text = (el.innerText || "").replace(/\u200b/g, "").trim();
  return { el, text, title };
}
function slugTag(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28); }

const CL_STOP = new Set("the a an and or but for nor so yet of to in on at by with from into over after before about as is are was were be been being this that these those it its their there here they them then than have has had will would could should may might must can not you your our we us he she his her him who what when where which while because during against between among through above below up down out off only just also more most some any each".split(/\s+/));

function suggestTags(d, columns) {
  const out = [];
  const seen = new Set();
  const add = (t) => { const s = slugTag(t); if (s && s.length > 2 && !seen.has(s)) { seen.add(s); out.push({ tag: s, label: t }); } };
  const text = (d.text || "") + " ";
  // 1) proper-noun phrases: runs of Capitalized words
  const phrases = text.match(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,2})\b/g) || [];
  const freq = {};
  phrases.forEach(p => { const k = p.trim(); if (k.length > 2 && !CL_STOP.has(k.toLowerCase())) freq[k] = (freq[k] || 0) + 1; });
  Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 6).forEach(add);
  // 2) frequent significant lowercase words
  const words = {};
  (text.toLowerCase().match(/\b[a-z][a-z'-]{4,}\b/g) || []).forEach(w => { if (!CL_STOP.has(w)) words[w] = (words[w] || 0) + 1; });
  Object.keys(words).filter(w => words[w] > 1).sort((a, b) => words[b] - words[a]).slice(0, 4).forEach(add);
  // 3) column hints
  const lower = (text + " " + (d.title || "")).toLowerCase();
  const colMatch = (columns || []).filter(c => lower.includes(c.toLowerCase()));
  return { tags: out.slice(0, 8), column: colMatch[0] || null };
}

function ClippyAgent({ route }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const columns = (layout.sections || []).map(s => s.name);
  const onDraftingSurface = route === "submit" || route === "newsroom";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState("RestPose");
  const spriteRef = useRef(null);
  const sheet = useRef({ w: 3348, h: 3162, z: 1.25 });
  const timer = useRef(null);
  const queue = useRef([]);
  const scroller = useRef(null);

  const paint = useCallback((x, y) => {
    const el = spriteRef.current; if (!el) return;
    const z = sheet.current.z;
    el.style.width = (124 * z) + "px"; el.style.height = (93 * z) + "px";
    el.style.backgroundImage = `url("${CL_SHEET}")`;
    el.style.backgroundSize = `${sheet.current.w * z}px ${sheet.current.h * z}px`;
    if (x == null) { el.style.opacity = "0"; }
    else { el.style.opacity = "1"; el.style.backgroundPosition = `-${x * z}px -${y * z}px`; }
  }, []);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const rest = useCallback(() => { setNow("RestPose"); paint(0, 0); }, [paint]);
  const playNext = useCallback(() => {
    const name = queue.current.shift();
    if (!name) { rest(); return; }
    const a = CL().anims[name];
    if (!a) { playNext(); return; }
    setNow(name);
    let i = 0;
    const step = () => {
      if (i >= a.length) { playNext(); return; }
      const f = a[i]; if (f[0] !== null) paint(f[0], f[1]);
      i++; timer.current = setTimeout(step, Math.max(16, f[2]));
    };
    step();
  }, [paint, rest]);
  const sequence = useCallback((names) => { stop(); queue.current = names.slice(); playNext(); }, [playNext]);

  useEffect(() => {
    if (!CL_SHEET) return;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { sheet.current.w = img.naturalWidth; sheet.current.h = img.naturalHeight; if (spriteRef.current) paint(0, 0); };
    img.src = CL_SHEET;
    return () => stop();
  }, [paint]);

  useEffect(() => {
    if (open && msgs.length === 0) {
      setMsgs([{ from: "clippy", text: "Hi — I help tag and file your piece. Hit “Suggest tags” and I'll read the draft for likely tags and the right column. (Sourcing stays manual — select a span and hit ⊨ Source.)" }]);
      sequence(CL_SEQ.greet);
    }
  }, [open]); // eslint-disable-line
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs, busy]);

  const push = (m) => setMsgs(list => [...list, m]);
  const addTag = (tag) => { if (window.__draftTags && window.__draftTags.add) { window.__draftTags.add(tag); push({ from: "clippy", text: "Added #" + tag + " to the piece." }); sequence(CL_SEQ.happy); } else { push({ from: "clippy", text: "Open a draft with a Tags field and I can drop #" + tag + " in." }); } };

  const doSuggest = async () => {
    if (busy) return; setBusy(true);
    push({ from: "you", text: "Suggest tags" });
    sequence(CL_SEQ.look);
    const d = readDraft();
    const r = await suggestTags(d, columns);
    sequence(CL_SEQ.write);
    if (!r.tags.length) push({ from: "clippy", text: "Write a few sentences first and I'll pull tag ideas from the people, places and orgs you mention." });
    else push({ from: "clippy", text: "Tag ideas from your draft" + (r.column ? " — looks like a fit for the " + r.column + " column:" : ":"), chips: r.tags, column: r.column });
    setBusy(false);
  };

  const send = async (qRaw) => {
    const q = String(qRaw != null ? qRaw : input).trim();
    if (!q || busy) return;
    push({ from: "you", text: q }); setInput(""); setBusy(true);
    const t = q.toLowerCase();
    if (/\b(tag|file|column|categor|topic)\b/.test(t)) { setBusy(false); return doSuggest(); }
    if (/\b(sourc|cite|citation)\b/.test(t)) { sequence(CL_SEQ.point); push({ from: "clippy", text: "Sourcing is all manual here — highlight the exact words that make a claim, then hit ⊨ Source to bind a snapshot to that span. I stay out of citations on purpose." }); setBusy(false); return; }
    sequence(CL_SEQ.point);
    push({ from: "clippy", text: "I'm your tagging helper — try “suggest tags”, or ask which column this belongs in." });
    setBusy(false);
  };

  useEffect(() => {
    window.__clippy = { show: () => setOpen(true), hide: () => setOpen(false), suggest: () => { setOpen(true); setTimeout(doSuggest, 60); }, sequence };
    return () => { if (window.__clippy) delete window.__clippy; };
  });

  if (!onDraftingSurface) return null;

  return (
    <React.Fragment>
      {!open && (
        <button onClick={() => setOpen(true)} title="Ask Clippy to tag your piece"
          style={{ position: "fixed", right: 18, bottom: 18, zIndex: 5800, display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--ink)", color: "var(--yellow)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.3)",
            padding: "9px 14px", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13.5, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>
          📎 Clippy
        </button>
      )}
      {open && (
        <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 5800, width: 340, maxWidth: "calc(100vw - 36px)", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ width: "100%", background: "var(--paper)", border: "1.5px solid var(--ink)", boxShadow: "0 18px 44px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", maxHeight: "min(60vh, 460px)" }}>
            <div style={{ background: "var(--ink)", color: "var(--paper)", padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15 }}>📎</span>
              <span style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--yellow)" }}>CLIPPY</span>
              <span className="np-mono" style={{ fontSize: 9.5, opacity: .7 }}>{(CL().mapping[now] || ["", "idle"])[1]}</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => { sequence(CL_SEQ.bye); setTimeout(() => setOpen(false), 700); }} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 16, cursor: "pointer" }}><I.x /></button>
            </div>
            <div ref={scroller} className="np-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 9, minHeight: 90 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.from === "you" ? "flex-end" : "flex-start", maxWidth: "92%",
                  background: m.from === "you" ? "var(--ink)" : "var(--card)", color: m.from === "you" ? "var(--paper)" : "var(--ink)",
                  border: "1.5px solid var(--ink)", padding: "8px 10px", fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                  {m.text}
                  {m.chips && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                      {m.chips.map(c => <button key={c.tag} onClick={() => addTag(c.tag)} className="np-mono" style={{ fontSize: 11, border: "1px solid var(--ink)", background: "var(--paper-2)", padding: "3px 7px", cursor: "pointer" }}>+ #{c.tag}</button>)}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="np-mono" style={{ alignSelf: "flex-start", fontSize: 11, color: "var(--ink-soft)" }}>Clippy is reading…</div>}
            </div>
            <div style={{ display: "flex", gap: 6, padding: "8px", borderTop: "1.5px solid var(--ink)" }}>
              <button onClick={doSuggest} className="np-cond" title="Suggest tags from the draft" style={{ flex: "0 0 auto", border: "1.5px solid var(--ink)", background: "var(--yellow)", padding: "0 9px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" }}>✦ Tags</button>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask about tags or columns…"
                style={{ flex: 1, minWidth: 0, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "8px 9px", fontFamily: "var(--serif)", fontSize: 13.5, outline: "none" }} />
            </div>
          </div>
          <div style={{ width: 124 * sheet.current.z, height: 93 * sheet.current.z, position: "relative", filter: "drop-shadow(3px 4px 4px rgba(0,0,0,.25))" }}>
            <div ref={spriteRef} style={{ imageRendering: "pixelated", backgroundRepeat: "no-repeat", transition: "opacity .15s" }} />
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

Object.assign(window, { ClippyAgent });
