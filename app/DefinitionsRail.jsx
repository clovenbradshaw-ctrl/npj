/* NPJ Definitions view — the per-article glossary, a top-level editor view
   (Prose · Grounding · Citations · Sources · Definitions · Graph).

   The terms a piece leans on that a reader might need defined. eoreader4 (the
   reading core already in npj — no engine code added or copied) SUGGESTS them,
   counted relative to the article's length. Then, per term:
     • MORE THAN ONE definition — a contested word can be defined several ways.
     • Each definition is SOURCED — paste a link, it gets archived to archive.org
       and identified (site title, source org, the date it was preserved).
     • Adopt or diverge from the definitions the published record already carries.

   State lives in the Newsroom (folded field `definitions`, published like tags);
   this is a controlled editor over it. window.DefinitionsView. */

function defSpinner(NR) {
  return <span style={{ display: "inline-block", width: 9, height: 9, border: "1.5px solid " + NR.muted, borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite" }} />;
}

function SourceControl({ source, onSet, onClear, NR }) {
  const D = window.NpjDefinitions;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const archiving = busy || (source && (source.status === "snapshotting"));
  const start = () => {
    const u = url.trim();
    if (!/^https?:\/\//.test(u) || !D) { return; }
    setBusy(true);
    D.archiveSource(u, p => onSet(p)).then(final => { onSet(final); setBusy(false); setUrl(""); }).catch(() => setBusy(false));
  };
  if (source && (source.url || source.archive_url)) {
    const link = source.archive_url || source.url;
    const ok = source.status === "archived";
    return (
      <div style={{ marginTop: 5, border: "1px solid " + NR.line, background: NR.field, padding: "5px 7px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span title={ok ? "preserved on archive.org" : "archiving"} style={{ color: ok ? NR.ok : NR.warn, fontSize: 12 }}>{archiving ? defSpinner(NR) : (ok ? "🔒" : "◌")}</span>
        <a href={link} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 120, color: NR.text, fontSize: 12.5, textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.title || source.url}</a>
        <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>
          {source.outlet ? source.outlet : ""}{source.outlet && source.preserved ? " · " : ""}{source.preserved ? "preserved " + source.preserved : (archiving ? "archiving…" : (source.status === "snapshot-pending" ? "snapshot requested" : "not archived"))}
        </span>
        <button onClick={onClear} title="remove source" style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 5, display: "flex", gap: 5 }}>
      <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") start(); }} placeholder="Source link (https://… — gets archived)"
        className="np-mono" style={{ flex: 1, border: "1px dashed " + NR.line, background: "transparent", color: NR.text, padding: "4px 6px", fontSize: 11, outline: "none" }} />
      <button onClick={start} disabled={!/^https?:\/\//.test(url.trim()) || busy} className="np-cond"
        style={{ border: "1px solid " + NR.line, background: NR.field, color: NR.text, cursor: "pointer", fontSize: 11, padding: "3px 8px", opacity: (/^https?:\/\//.test(url.trim()) && !busy) ? 1 : .5 }}>
        {busy ? "Archiving…" : "Source"}
      </button>
    </div>
  );
}

function DefRow({ def, onPatch, onRemove, canRemove, NR }) {
  return (
    <div style={{ borderLeft: "2px solid " + NR.line, padding: "2px 0 2px 9px", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <textarea value={def.text} onChange={e => onPatch({ text: e.target.value })} placeholder="Define this term — a sentence or two"
          rows={2} style={{ flex: 1, border: "1px solid " + NR.line, background: NR.field, color: NR.text, fontSize: 13, lineHeight: 1.45, padding: "6px 7px", outline: "none", resize: "vertical", fontFamily: "var(--serif)" }} />
        {canRemove && <button onClick={onRemove} title="remove this definition" style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 15, lineHeight: 1, marginTop: 2 }}>×</button>}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
        <input value={def.sense || ""} onChange={e => onPatch({ sense: e.target.value })} placeholder="sense (optional)"
          className="np-mono" style={{ width: 150, border: 0, borderBottom: "1px dotted " + NR.line, background: "transparent", color: NR.soft, padding: "1px 2px", fontSize: 10.5, outline: "none" }} />
        {def.basedOn && def.basedOn.slug && <span className="np-mono" style={{ fontSize: 10, color: NR.muted }}>adopted from {def.basedOn.slug}</span>}
      </div>
      <SourceControl source={def.source} onSet={s => onPatch({ source: s })} onClear={() => onPatch({ source: null })} NR={NR} />
    </div>
  );
}

function DefTermCard({ entry, resolved, onPatch, onRemove, onPatchDef, onRemoveDef, onAddDef, NR, slug }) {
  const [showPrior, setShowPrior] = useState(false);
  const prior = (resolved && resolved.alternates) || [];
  const conflicting = !!(resolved && resolved.conflicting);
  const ctx = (entry.contexts && entry.contexts[0]) || "";
  const defs = entry.defs && entry.defs.length ? entry.defs : [];
  const adopt = (alt) => onAddDef({ text: alt.def, sense: alt.sense || "", source: alt.source || null, origin: "adopted", basedOn: { slug: alt.slug, defId: alt.defId || null } });
  return (
    <div style={{ border: "1px solid " + NR.line, background: NR.panel, padding: "11px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input value={entry.term} onChange={e => onPatch({ term: e.target.value })} placeholder="term"
          style={{ flex: 1, border: 0, borderBottom: "1px solid " + NR.line, background: "transparent", color: NR.text, fontWeight: 700, fontSize: 15, padding: "1px 0 3px", outline: "none" }} />
        {entry.acronym && <span className="np-mono" title="acronym" style={{ fontSize: 10, border: "1px solid " + NR.line, color: NR.soft, padding: "1px 5px" }}>{entry.acronym}</span>}
        {defs.length > 1 && <span className="np-mono" title="this term carries more than one definition" style={{ fontSize: 9.5, color: NR.muted }}>{defs.length} defs</span>}
        <button onClick={onRemove} title="remove term" style={{ border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
      </div>
      {ctx && defs.every(d => !d.text) && <div style={{ fontSize: 11.5, color: NR.muted, fontStyle: "italic", marginTop: 5, lineHeight: 1.4 }}>“…{ctx}…”</div>}

      {defs.map((d, i) => <DefRow key={d.id} def={d} canRemove={defs.length > 1} NR={NR}
        onPatch={p => onPatchDef(d.id, p)} onRemove={() => onRemoveDef(d.id)} />)}

      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => onAddDef({ text: "", source: null, origin: "manual" })} className="np-cond"
          style={{ border: "1px solid " + NR.line, background: "transparent", color: NR.soft, cursor: "pointer", fontSize: 11, padding: "3px 8px" }}>+ another definition</button>
        {prior.length > 0 &&
          <button onClick={() => setShowPrior(o => !o)} className="np-mono" style={{ border: 0, background: "none", color: conflicting ? NR.warn : NR.soft, cursor: "pointer", fontSize: 10.5, padding: 0 }}>
            {conflicting ? "⚠ " : ""}{prior.length} on the record{conflicting ? " — they disagree" : ""} {showPrior ? "▾" : "▸"}
          </button>}
      </div>
      {showPrior && prior.map((alt, i) => (
        <div key={i} style={{ borderLeft: "2px solid " + NR.line, padding: "4px 0 4px 9px", marginTop: 6 }}>
          <div style={{ fontSize: 12.5, color: NR.text, lineHeight: 1.4 }}>{alt.def}</div>
          <div className="np-mono" style={{ fontSize: 10, color: NR.muted, marginTop: 3, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>— {alt.headline || alt.slug}{alt.ts ? " · " + alt.ts : ""}{alt.source && alt.source.outlet ? " · " + alt.source.outlet : ""}</span>
            <button onClick={() => adopt(alt)} style={{ border: "1px solid " + NR.line, background: NR.field, color: NR.text, cursor: "pointer", fontSize: 10, padding: "1px 6px" }}>Adopt</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DefinitionsView({ NR, definitions, onChange, getBodyText, slug, isMobile, actor }) {
  const D = window.NpjDefinitions;
  const list = Array.isArray(definitions) ? definitions : [];
  const [index, setIndex] = useState(D ? D.publishedIndex() : null);
  const [idxState, setIdxState] = useState(D ? D.publishedState() : "idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [earns, setEarns] = useState(3);

  useEffect(() => {
    if (!D) return;
    const off = D.onChange(s => { setIndex(s.index); setIdxState(s.state); });
    D.buildPublishedIndex();
    return off;
  }, []);

  // every term keeps at least one (editable) definition row
  useEffect(() => {
    if (!D) return;
    const fixed = list.map(e => (e.defs && e.defs.length) ? e : Object.assign({}, e, { defs: [{ id: D.newId("d"), text: "", source: null, sense: "", origin: "manual", basedOn: null, author: "", ts: "" }] }));
    if (fixed.some((e, i) => e !== list[i])) onChange(fixed);
  }, [list]);

  // size indicator from the live draft length; auto-suggest once if empty
  useEffect(() => {
    const txt = getBodyText ? getBodyText() : "";
    if (D) setEarns(D.sizeFor(D.wordsIn(txt)));
    if (list.length === 0 && D) suggest(true);
  }, []);

  const resolved = D ? D.resolve(list, index) : list.map(e => ({ ...e }));
  const byKey = {};
  resolved.forEach(r => { byKey[r.termKey || (D && D.termKey(r.term)) || r.term] = r; });

  const patchEntry = (id, p) => onChange(list.map(e => e.id === id ? Object.assign({}, e, p) : e));
  const removeEntry = (id) => onChange(list.filter(e => e.id !== id));
  const patchDef = (eid, did, p) => onChange(list.map(e => e.id === eid ? Object.assign({}, e, { defs: e.defs.map(d => d.id === did ? Object.assign({}, d, p) : d) }) : e));
  const removeDef = (eid, did) => onChange(list.map(e => e.id === eid ? Object.assign({}, e, { defs: e.defs.filter(d => d.id !== did) }) : e));
  const addDef = (eid, defObj) => onChange(list.map(e => {
    if (e.id !== eid) return e;
    const nd = Object.assign({ id: D.newId("d"), text: "", source: null, sense: "", origin: "manual", basedOn: null, author: "", ts: "" }, defObj);
    // if the only def is an untouched blank, replace it (adopt/first write)
    const blanks = e.defs.filter(d => !d.text && !(d.source && (d.source.url || d.source.archive_url)));
    const base = (defObj.text || defObj.source) && e.defs.length === 1 && blanks.length === 1 ? [] : e.defs;
    return Object.assign({}, e, { defs: base.concat([nd]) });
  }));

  // the first definition for a new term — pre-filled from the published record
  // when the site already defines it (adopted, fully editable), so a term the
  // record knows arrives defined; else a blank row for the author to fill.
  function seedDef(keyStr, origin) {
    const grp = (index && index.get) ? index.get(keyStr) : null;
    const canon = grp && grp.canonical;
    if (canon && canon.def) {
      return { id: D.newId("d"), text: canon.def, source: canon.source || null, sense: "", origin: "adopted", basedOn: { slug: canon.slug, defId: null }, author: "", ts: "" };
    }
    return { id: D.newId("d"), text: "", source: null, sense: "", origin: origin || "manual", basedOn: null, author: "", ts: "" };
  }

  function addTerm(term) {
    const t = String(term || "").trim();
    if (!t || !D) return;
    const key = D.termKey(t);
    if (list.some(e => (e.termKey || D.termKey(e.term)) === key)) { setNote("“" + t + "” is already listed"); return; }
    onChange(list.concat([{ id: D.newId("def"), term: t, termKey: key, kind: "term", acronym: null, defs: [seedDef(key, "manual")] }]));
    setNote("");
  }

  function suggest(silent) {
    if (!D) return;
    const txt = getBodyText ? getBodyText() : "";
    if (!silent) { setBusy(true); setNote(""); }
    setEarns(D.sizeFor(D.wordsIn(txt)));
    Promise.resolve(D.extract(txt)).then(res => {
      setBusy(false);
      if (!res.ok) { if (!silent) setNote(res.reason === "engine-unavailable" ? "The reading engine is still loading — try again in a moment." : "Couldn't read the draft for terms."); return; }
      const have = {}; list.forEach(e => { have[e.termKey || D.termKey(e.term)] = 1; });
      const add = [];
      res.terms.forEach(t => {
        if (have[t.termKey]) return;
        have[t.termKey] = 1;
        add.push({ id: D.newId("def"), term: t.term, termKey: t.termKey, kind: t.kind, acronym: t.acronym || null, contexts: t.contexts || [], defs: [seedDef(t.termKey, "extracted")] });
      });
      if (!add.length) { if (!silent) setNote(res.terms.length ? "No new terms — the draft's salient terms are already listed." : "No terms found — write a little more, then suggest again."); return; }
      onChange(list.concat(add));
      if (!silent) setNote("Added " + add.length + " term" + (add.length > 1 ? "s" : "") + " eoreader4 surfaced" + (res.size ? " (this length earns ~" + res.size + ")" : "") + ".");
    });
  }

  const idxLabel = idxState === "loading" ? "reading the record…" : idxState === "ok" ? "drawn from the published record" : idxState === "error" ? "record unavailable" : "";

  return (
    <div className="np-scroll" style={{ height: "100%", overflowY: "auto", background: NR.bg, padding: isMobile ? "12px 12px 60px" : "18px 22px 60px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 22 }}>Definitions</div>
          <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, flex: 1 }}>{list.length} term{list.length === 1 ? "" : "s"} · this length earns ~{earns}</div>
          <button onClick={() => suggest(false)} disabled={busy} className="np-cond" style={{ border: "1.5px solid " + NR.text, background: NR.text, color: NR.bg, cursor: busy ? "default" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "5px 12px", opacity: busy ? .6 : 1 }}>
            {busy ? "Reading…" : (list.length ? "Suggest more" : "Suggest terms")}
          </button>
        </div>
        <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>eoreader4 · mechanical, no model</span>{idxLabel && <span>· {idxLabel}</span>}
        </div>

        {note && <div className="np-mono" style={{ fontSize: 11, color: NR.soft, marginBottom: 10 }}>{note}</div>}

        {list.length === 0 &&
          <div className="np-mono" style={{ fontSize: 12, color: NR.muted, lineHeight: 1.6, marginBottom: 14 }}>
            No terms yet. <b>Suggest terms</b> reads the draft and offers the names, acronyms and concepts it leans on — about one per 130 words. Each term can hold more than one definition, and every definition can carry a source link that gets archived.
          </div>}

        {list.map(e => <DefTermCard key={e.id} entry={e} resolved={byKey[e.termKey || (D && D.termKey(e.term)) || e.term]}
          onPatch={p => patchEntry(e.id, p)} onRemove={() => removeEntry(e.id)}
          onPatchDef={(did, p) => patchDef(e.id, did, p)} onRemoveDef={(did) => removeDef(e.id, did)} onAddDef={(d) => addDef(e.id, d)}
          NR={NR} slug={slug} />)}

        <input placeholder="+ add a term" className="np-cond"
          onKeyDown={e => { if (e.key === "Enter") { addTerm(e.target.value); e.target.value = ""; } }}
          style={{ width: "100%", marginTop: 4, border: "1px dashed " + NR.line, background: "transparent", color: NR.text, padding: "7px 9px", fontSize: 13, outline: "none" }} />
      </div>
    </div>
  );
}

Object.assign(window, { DefinitionsView, DefTermCard, DefRow, SourceControl });
