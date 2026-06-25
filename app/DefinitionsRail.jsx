/* NPJ Definitions panel — the per-article glossary, opened from the editor's
   Contents rail. The terms a piece leans on that a reader might need defined:
   eoreader4 SUGGESTS them (mechanically, counted relative to the article's
   length), the writer keeps/edits/adds, and each term can ADOPT or DIVERGE from
   the definitions the published record already carries (app/definitions.js).

   A term may hold CONFLICTING definitions across the site; this panel shows the
   alternates inline so a writer chooses with the disagreement in view. State
   lives in the Newsroom (folded field `definitions`, published like tags); this
   component is a controlled editor over it. window.DefinitionsPanel. */

function DefIndexBadge({ state, NR }) {
  const m = state === "loading" ? ["…", "reading the record"]
    : state === "error" ? ["!", "record unavailable"]
    : state === "ok" ? ["✓", "from the published record"]
    : ["·", ""];
  return <span className="np-mono" title={m[1]} style={{ fontSize: 10, color: NR.muted }}>{m[1]}</span>;
}

function AlternateRow({ alt, onAdopt, NR }) {
  return (
    <div style={{ borderLeft: "2px solid " + NR.line, padding: "4px 0 4px 9px", marginTop: 6 }}>
      <div style={{ fontSize: 12.5, color: NR.text, lineHeight: 1.4 }}>{alt.def}</div>
      <div className="np-mono" style={{ fontSize: 10, color: NR.muted, marginTop: 3, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>— {alt.headline || alt.slug}{alt.ts ? " · " + alt.ts : ""}</span>
        <button onClick={onAdopt} style={{ border: "1px solid " + NR.line, background: NR.field, color: NR.text, cursor: "pointer", fontSize: 10, padding: "1px 6px" }}>Adopt</button>
      </div>
    </div>
  );
}

function DefCard({ entry, resolved, onPatch, onRemove, NR, slug }) {
  const [open, setOpen] = useState(false);
  const prior = (resolved && resolved.alternates) || [];
  const conflicting = !!(resolved && resolved.conflicting);
  const ctx = (entry.contexts && entry.contexts[0]) || "";
  const adopt = (alt) => onPatch({ def: alt.def, basedOn: { slug: alt.slug, defId: alt.defId || null } });
  return (
    <div style={{ border: "1px solid " + NR.line, background: NR.panel, padding: "10px 11px", marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input value={entry.term} onChange={e => onPatch({ term: e.target.value })} placeholder="term"
          style={{ flex: 1, border: 0, borderBottom: "1px solid " + NR.line, background: "transparent", color: NR.text, fontWeight: 600, fontSize: 14, padding: "1px 0 3px", outline: "none" }} />
        {entry.acronym && <span className="np-mono" title="acronym" style={{ fontSize: 10, border: "1px solid " + NR.line, color: NR.soft, padding: "1px 5px" }}>{entry.acronym}</span>}
        <span className="np-mono" title={entry.source === "extracted" ? "suggested by eoreader4" : "added by hand"} style={{ fontSize: 9.5, color: NR.muted }}>{entry.source === "extracted" ? "auto" : "manual"}</span>
        <button onClick={onRemove} title="remove term" style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
      </div>
      <textarea value={entry.def} onChange={e => onPatch({ def: e.target.value, basedOn: null })} placeholder={resolved && resolved.canonical ? "Define it — or adopt a published definition below" : "Define this term in a sentence or two"}
        rows={2} style={{ width: "100%", marginTop: 7, border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontSize: 13, lineHeight: 1.45, padding: "6px 7px", outline: "none", resize: "vertical", fontFamily: "var(--serif)" }} />
      {ctx && !entry.def && <div style={{ fontSize: 11.5, color: NR.muted, fontStyle: "italic", marginTop: 4, lineHeight: 1.4 }}>“…{ctx}…”</div>}
      {entry.basedOn && entry.basedOn.slug && entry.basedOn.slug !== slug &&
        <div className="np-mono" style={{ fontSize: 10, color: NR.muted, marginTop: 4 }}>adopted from {entry.basedOn.slug}</div>}
      {prior.length > 0 &&
        <div style={{ marginTop: 7 }}>
          <button onClick={() => setOpen(o => !o)} className="np-mono" style={{ border: 0, background: "none", color: conflicting ? NR.warn : NR.soft, cursor: "pointer", fontSize: 10.5, padding: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
            {conflicting ? "⚠ " : ""}{prior.length} published definition{prior.length > 1 ? "s" : ""}{conflicting ? " — they disagree" : ""} {open ? "▾" : "▸"}
          </button>
          {open && prior.map((alt, i) => <AlternateRow key={i} alt={alt} NR={NR} onAdopt={() => adopt(alt)} />)}
        </div>}
    </div>
  );
}

function DefinitionsPanel({ NR, definitions, onChange, bodyText, slug, isMobile, onClose, actor }) {
  const D = window.NpjDefinitions;
  const list = Array.isArray(definitions) ? definitions : [];
  const words = D ? D.wordsIn(bodyText) : 0;
  const earns = D ? D.sizeFor(words) : 3;

  const [index, setIndex] = useState(D ? D.publishedIndex() : null);
  const [idxState, setIdxState] = useState(D ? D.publishedState() : "idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // the collective glossary — built once, refreshed live as it loads
  useEffect(() => {
    if (!D) return;
    const off = D.onChange(s => { setIndex(s.index); setIdxState(s.state); });
    D.buildPublishedIndex();
    return off;
  }, []);

  // close on Escape (the backdrop closes on click; this matches the viewer)
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const resolved = D ? D.resolve(list, index) : list.map(e => ({ ...e }));
  const byKey = {};
  resolved.forEach(r => { byKey[r.termKey || (D && D.termKey(r.term)) || r.term] = r; });

  const patchAt = (id, patch) => onChange(list.map(e => e.id === id ? Object.assign({}, e, patch) : e));
  const removeAt = (id) => onChange(list.filter(e => e.id !== id));

  function addManual(term) {
    const t = String(term || "").trim();
    if (!t || !D) return;
    const key = D.termKey(t);
    if (list.some(e => (e.termKey || D.termKey(e.term)) === key)) { setNote("“" + t + "” is already in the list"); return; }
    const canonical = index && index.get(key) && index.get(key).canonical;
    onChange(list.concat([D.normEntry({ term: t, def: canonical ? canonical.def : "", source: "manual", basedOn: canonical ? { slug: canonical.slug } : null, ts: "" })]));
    setNote("");
  }

  function suggest() {
    if (!D) return;
    setBusy(true); setNote("");
    Promise.resolve(D.extract(bodyText)).then(res => {
      setBusy(false);
      if (!res.ok) { setNote(res.reason === "engine-unavailable" ? "The reading engine is still loading — try again in a moment." : "Couldn't read the draft for terms."); return; }
      const have = {}; list.forEach(e => { have[e.termKey || D.termKey(e.term)] = 1; });
      const add = [];
      res.terms.forEach(t => {
        if (have[t.termKey]) return;
        have[t.termKey] = 1;
        const canonical = index && index.get(t.termKey) && index.get(t.termKey).canonical;
        add.push(D.normEntry({
          term: t.term, def: canonical ? canonical.def : "", kind: t.kind, acronym: t.acronym,
          source: "extracted", basedOn: canonical ? { slug: canonical.slug } : null
        }));
        // carry a context snippet for the empty-state hint (not persisted past edit)
        add[add.length - 1].contexts = t.contexts || [];
      });
      if (!add.length) { setNote(res.terms.length ? "No new terms — the draft's salient terms are already listed." : "No terms found yet — write a little more, then suggest again."); return; }
      onChange(list.concat(add));
      setNote("Added " + add.length + " term" + (add.length > 1 ? "s" : "") + " eoreader4 surfaced" + (res.size ? " (this length earns ~" + res.size + ")" : "") + ".");
    });
  }

  const card = { position: "fixed", inset: 0, zIndex: 5200, background: "rgba(8,7,5,.86)", display: "flex", alignItems: isMobile ? "stretch" : "center", justifyContent: "center", padding: isMobile ? 0 : 24 };
  const sheet = { background: NR.bg, color: NR.text, border: "1.5px solid " + NR.line, width: isMobile ? "100%" : 640, maxWidth: "100%", maxHeight: isMobile ? "100%" : "88vh", display: "flex", flexDirection: "column", boxShadow: "0 18px 48px rgba(0,0,0,.5)" };

  return (
    <div className="fade-in" style={card} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sheet} role="dialog" aria-label="Definitions">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "14px 16px", borderBottom: "1.5px solid " + NR.line }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 18 }}>Definitions</div>
          <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, flex: 1 }}>{list.length} term{list.length === 1 ? "" : "s"} · this length earns ~{earns}</div>
          <button onClick={onClose} title="close · esc" style={{ border: 0, background: "none", color: NR.soft, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 16px", borderBottom: "1px solid " + NR.line, flexWrap: "wrap" }}>
          <button onClick={suggest} disabled={busy} className="np-cond" style={{ border: "1.5px solid " + NR.text, background: NR.text, color: NR.bg, cursor: busy ? "default" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "5px 11px", opacity: busy ? .6 : 1 }}>
            {busy ? "Reading…" : "Suggest terms"}
          </button>
          <span className="np-mono" style={{ fontSize: 10.5, color: NR.muted }}>eoreader4 · mechanical, no model</span>
          <span style={{ flex: 1 }} />
          <DefIndexBadge state={idxState} NR={NR} />
        </div>

        {note && <div className="np-mono" style={{ fontSize: 11, color: NR.soft, padding: "8px 16px 0" }}>{note}</div>}

        <div className="np-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {list.length === 0 &&
            <div className="np-mono" style={{ fontSize: 12, color: NR.muted, lineHeight: 1.6 }}>
              No terms yet. <b>Suggest terms</b> reads the draft and offers the names, acronyms and concepts it leans on — about one per 130 words — or add your own below. Each can adopt a definition the site has already published, or set its own.
            </div>}
          {list.map(e => <DefCard key={e.id} entry={e} resolved={byKey[e.termKey || (D && D.termKey(e.term)) || e.term]} onPatch={p => patchAt(e.id, p)} onRemove={() => removeAt(e.id)} NR={NR} slug={slug} />)}
        </div>

        <div style={{ padding: "10px 16px", borderTop: "1.5px solid " + NR.line, display: "flex", gap: 7 }}>
          <input placeholder="+ add a term" className="np-cond"
            onKeyDown={e => { if (e.key === "Enter") { addManual(e.target.value); e.target.value = ""; } }}
            style={{ flex: 1, border: "1px dashed " + NR.line, background: "transparent", color: NR.text, padding: "6px 8px", fontSize: 13, outline: "none" }} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DefinitionsPanel, DefCard, AlternateRow });
