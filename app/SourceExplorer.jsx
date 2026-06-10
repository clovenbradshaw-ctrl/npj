/* NPJ — the source explorer.
   A citation can't stand on a whole page, so this is where you point at the
   exact words. It pulls the source's archived text (NpjArchiveCDN.fetchSourceText),
   lets you SEARCH inside it, READ it, and SELECT one or more passages to cite —
   multiple spots in the same source are fine. Clippy can rank the passages
   against your claim and pre-select the strongest. If the text can't be fetched
   (no snapshot yet, a CORS wall, a JS-only page) it falls back to a paste box,
   and everything else works the same on whatever you paste. */

function SourceExplorer({ sourceKey, claimText, initialQuotes, onPin, onClose }) {
  const rec = (window.NPJ.SOURCES[sourceKey]) || { title: sourceKey, outlet: "" };
  const [status, setStatus] = useState("loading");   // loading | ready | paste
  const [text, setText] = useState("");
  const [via, setVia] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => (Array.isArray(initialQuotes) ? initialQuotes.slice() : []));
  const [pasteVal, setPasteVal] = useState("");
  const [hint, setHint] = useState(null);            // a transient "added"/"ranked" note
  const bodyRef = useRef(null);

  const CDN = window.NpjArchiveCDN || {};
  const passages = React.useMemo(() => (CDN.splitPassages ? CDN.splitPassages(text) : []), [text]);

  // pull the source's text once
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      const got = CDN.fetchSourceText ? await CDN.fetchSourceText(rec).catch(() => null) : null;
      if (!alive) return;
      if (got && got.text) { setText(got.text); setVia(got.via || ""); setStatus("ready"); if (!rec.text) rec.text = got.text; }
      else setStatus("paste");
    })();
    return () => { alive = false; };
  }, [sourceKey]); // eslint-disable-line

  const has = (p) => selected.indexOf(p) >= 0;
  const toggle = (p) => setSelected(list => has(p) ? list.filter(x => x !== p) : [...list, p]);
  const remove = (p) => setSelected(list => list.filter(x => x !== p));
  const flash = (m) => { setHint(m); setTimeout(() => setHint(h => h === m ? null : h), 1600); };

  // add whatever the author has highlighted inside the source body
  const addSelection = () => {
    const s = window.getSelection();
    const t = s ? String(s).replace(/\s+/g, " ").trim() : "";
    if (t.length < 3) { flash("Highlight some words in the source first."); return; }
    if (bodyRef.current && s.anchorNode && !bodyRef.current.contains(s.anchorNode)) { flash("Select inside the source text."); return; }
    setSelected(list => list.indexOf(t) >= 0 ? list : [...list, t]);
    if (s.removeAllRanges) s.removeAllRanges();
    flash("Added that selection.");
  };

  // Clippy ranks the passages against the claim and pre-selects the best
  const askClippy = () => {
    const ranked = CDN.rankPassages ? CDN.rankPassages(claimText, passages, 3) : [];
    if (!ranked.length) { flash("Clippy couldn't find a matching passage — search and pick one."); if (window.__clippy) window.__clippy.sequence && window.__clippy.sequence(["Thinking"]); return; }
    setSelected(list => { const next = list.slice(); ranked.forEach(r => { if (next.indexOf(r.text) < 0) next.push(r.text); }); return next; });
    setQuery("");
    flash("Clippy pre-selected " + ranked.length + " passage" + (ranked.length === 1 ? "" : "s") + " — review and pin.");
  };

  const usePaste = () => {
    const t = pasteVal.trim();
    if (t.length < 3) return;
    rec.text = (rec.text ? rec.text + "\n\n" : "") + t;
    setText(rec.text); setStatus("ready"); setPasteVal("");
  };

  const pin = () => { if (selected.length) { onPin(selected.slice()); } };

  // search: filter passages and highlight the query inside them
  const q = query.trim().toLowerCase();
  const shown = q ? passages.filter(p => p.toLowerCase().includes(q)) : passages;
  const mark = (p) => {
    if (!q) return p;
    const i = p.toLowerCase().indexOf(q);
    if (i < 0) return p;
    return (<React.Fragment>{p.slice(0, i)}<mark style={{ background: "var(--yellow)", color: "var(--ink)" }}>{p.slice(i, i + q.length)}</mark>{p.slice(i + q.length)}</React.Fragment>);
  };

  const C = { panel: "var(--paper)", ink: "var(--ink)", soft: "var(--ink-soft)", line: "var(--ink)", rule: "var(--rule)", field: "var(--paper-2)" };

  return (
    <div className="fade-in" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 5200, background: "rgba(8,7,5,.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 860, maxWidth: "100%", height: "min(86vh, 760px)", background: C.panel, color: C.ink, border: "1.5px solid var(--yellow)", boxShadow: "0 26px 64px rgba(0,0,0,.6)", display: "flex", flexDirection: "column", fontFamily: "var(--serif)" }}>
        {/* header */}
        <div style={{ background: "var(--ink)", color: "var(--paper)", padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--yellow)" }}>⊥</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 18, color: "var(--yellow)" }}>EXPLORE THE SOURCE</span>
          <span className="np-mono" style={{ fontSize: 11, opacity: .75, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.title || sourceKey}{rec.outlet ? " · " + rec.outlet : ""}</span>
          {(rec.archive_url || rec.original_url) && <a href={rec.archive_url || rec.original_url} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 10.5, color: "var(--yellow)", textDecoration: "none", flex: "0 0 auto" }}>open snapshot ↗</a>}
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 17, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* the claim being backed */}
        <div style={{ padding: "9px 14px", borderBottom: "1px solid " + C.rule, background: C.field, display: "flex", gap: 8, alignItems: "baseline" }}>
          <span className="np-eyebrow" style={{ color: C.soft, flex: "0 0 auto" }}>Your claim</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.35, fontStyle: "italic" }}>“{claimText && claimText.length > 220 ? claimText.slice(0, 220) + "…" : (claimText || "—")}”</span>
        </div>

        {/* search + Clippy */}
        <div style={{ padding: "9px 14px", borderBottom: "1px solid " + C.rule, display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, border: "1.5px solid " + C.line, background: "var(--paper)", padding: "0 9px", flex: 1 }}>
            <span className="np-mono" style={{ color: C.soft, fontSize: 13 }}>⌕</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search inside the source…" style={{ flex: 1, border: 0, background: "transparent", padding: "8px 0", fontFamily: "var(--serif)", fontSize: 13.5, outline: "none", color: C.ink }} />
            {q && <span className="np-mono" style={{ fontSize: 10.5, color: C.soft }}>{shown.length} hit{shown.length === 1 ? "" : "s"}</span>}
          </div>
          <button onClick={askClippy} disabled={status !== "ready"} className="np-cond" title="Let Clippy rank the source's passages against your claim"
            style={{ flex: "0 0 auto", background: status === "ready" ? "var(--yellow)" : "var(--paper-2)", color: status === "ready" ? "var(--ink)" : C.soft, border: "1.5px solid " + C.line, padding: "8px 11px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", cursor: status === "ready" ? "pointer" : "default" }}>📎 Clippy: find best</button>
        </div>

        {/* the source body */}
        <div ref={bodyRef} className="np-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 14px", minHeight: 0 }}>
          {status === "loading" && <div className="np-mono" style={{ fontSize: 12, color: C.soft, padding: 16 }}>Pulling the archived source text…</div>}
          {status === "paste" && (
            <div>
              <div className="np-mono" style={{ fontSize: 11.5, color: C.soft, lineHeight: 1.55, marginBottom: 9 }}>
                Couldn't read this source automatically (no snapshot yet, or the page blocks cross-site reads). Paste the source's text below and you can search & select inside it just the same. Tip: snapshot the source first (Archive) so the text is fetchable next time.
              </div>
              <textarea autoFocus value={pasteVal} onChange={e => setPasteVal(e.target.value)} rows={10} placeholder="Paste the source's text here…"
                style={{ width: "100%", resize: "vertical", border: "1.5px solid " + C.line, background: "var(--paper)", color: C.ink, fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.45, padding: "9px 10px", outline: "none", boxSizing: "border-box" }} />
              <button onClick={usePaste} className="np-cond" style={{ marginTop: 8, background: "var(--yellow)", border: "1.5px solid " + C.line, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Load this text</button>
            </div>
          )}
          {status === "ready" && shown.length === 0 && <div className="np-mono" style={{ fontSize: 12, color: C.soft, padding: 16 }}>No passage matches “{query}”. Clear the search to see the whole source.</div>}
          {status === "ready" && shown.map((p, i) => (
            <div key={i} onClick={() => toggle(p)} title={has(p) ? "Click to remove this passage" : "Click to select this passage"}
              style={{ cursor: "pointer", borderLeft: "3px solid " + (has(p) ? "var(--yellow-deep)" : "transparent"), background: has(p) ? "rgba(255,236,1,.16)" : "transparent",
                padding: "6px 9px", marginBottom: 2, fontSize: 14.5, lineHeight: 1.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span className="np-mono" style={{ fontSize: 12, color: has(p) ? "var(--yellow-deep)" : C.rule, flex: "0 0 auto", marginTop: 2 }}>{has(p) ? "☑" : "☐"}</span>
              <span>{mark(p)}</span>
            </div>
          ))}
        </div>

        {/* selection tray + actions */}
        <div style={{ borderTop: "1.5px solid " + C.line, padding: "9px 14px", background: C.field }}>
          {hint && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--verified, #2e7d32)", marginBottom: 6 }}>{hint}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: selected.length ? 8 : 0, flexWrap: "wrap" }}>
            <span className="np-eyebrow" style={{ color: C.soft }}>Citing {selected.length} passage{selected.length === 1 ? "" : "s"}</span>
            {status === "ready" && <button onClick={addSelection} className="np-cond" style={{ background: "transparent", border: "1px solid " + C.line, padding: "3px 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".03em", cursor: "pointer" }}>+ Add highlighted text</button>}
            <span style={{ flex: 1 }} />
          </div>
          {selected.length > 0 && (
            <div className="np-scroll" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 120, overflowY: "auto", marginBottom: 9 }}>
              {selected.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", border: "1px solid " + C.rule, padding: "5px 7px", background: "var(--paper)" }}>
                  <span className="np-mono" style={{ fontSize: 9.5, color: "var(--yellow-deep)", flex: "0 0 auto", marginTop: 2 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.35, borderLeft: "2px solid var(--yellow-deep)", paddingLeft: 7 }}>{p.length > 200 ? p.slice(0, 200) + "…" : p}</span>
                  <button onClick={() => remove(p)} style={{ flex: "0 0 auto", background: "none", border: 0, color: C.soft, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onClose} className="np-cond" style={{ background: "transparent", color: C.ink, border: "1px solid " + C.line, padding: "8px 14px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" }}>Cancel</button>
            <button onClick={pin} disabled={!selected.length} className="np-cond"
              style={{ background: selected.length ? "var(--yellow)" : "var(--paper-2)", color: selected.length ? "var(--ink)" : C.soft, border: "1.5px solid " + (selected.length ? "var(--ink)" : C.rule), padding: "8px 16px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: selected.length ? "pointer" : "default" }}>
              Pin {selected.length || ""} {selected.length === 1 ? "passage" : "passages"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SourceExplorer });
