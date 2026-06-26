/* ============================================================
   SourceExplorer.jsx — a real, two-pane file explorer for uploaded sources.

   The left rail is a navigable, searchable list of every source/file (grouped
   when the caller supplies groups — e.g. by project); the right pane renders the
   SELECTED file's actual content with <SourceViewer>, plus its metadata and the
   articles that cite it. This is the "open the file and read it" surface the app
   was missing: uploaded PDFs, images and documents are now first-class, viewable
   things — not just titles with a dead-end link.

   Reusable. Callers hand it a normalized list:
     items: [{ key, rec, group?, carriers?: [{ title, onOpen }] }]
   and optionally initialKey / title / onClose / onOpenArticle.

   Publishes window.SourceExplorer.
   ============================================================ */
// Light-theme palette for the in-explorer SourceAdapter (the explorer reads on
// paper/ink, not the dark newsroom NR theme the adapter also serves).
const ADAPTER_THEME = { line: "var(--rule)", panel: "var(--paper-2)", field: "var(--paper)", text: "var(--ink)", muted: "var(--ink-soft)", warn: "#c2724a", ok: "var(--verified)" };

function SourceExplorer({ items, initialKey, title, onClose, onRename, onCite, srcApi }) {
  const SV = window.NpjSourceView;
  const list = (items || []).filter(it => it && it.key);
  const [sel, setSel] = useState(initialKey || (list[0] && list[0].key) || null);
  const [q, setQ] = useState("");
  const [, bump] = useState(0);
  // inline rename of the open file — uploaded docs land as "lj73Qxj7.pdf" and
  // web grabs as "Web snapshot"; let the reader fix the name where they read it.
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const commitRename = () => { const t = renameText.trim(); if (t && onRename && sel) onRename(sel, t); setRenaming(false); bump(v => v + 1); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !renaming) onClose && onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, renaming]);
  useEffect(() => { setRenaming(false); }, [sel]);   // switching files cancels an open rename

  const recOf = (it) => it.rec || (window.NPJ.SOURCES && window.NPJ.SOURCES[it.key]) || {};
  const kindIcon = (rec) => {
    const k = SV ? SV.kindOf(rec) : "unknown";
    if (k === "image") return <I.image style={{ fontSize: 14, color: "var(--data)" }} />;
    if (k === "pdf") return <I.doc style={{ fontSize: 14, color: "var(--reject)" }} />;
    if (k === "text") return <I.doc style={{ fontSize: 14, color: "var(--ink-soft)" }} />;
    // a web snapshot (no viewable file, just a URL) reads as a link, not a doc
    if ((rec.original_url || rec.archive_url) && !rec.file_url) return <I.link style={{ fontSize: 14, color: "var(--ink-soft)" }} />;
    return <I.doc style={{ fontSize: 14, color: "var(--ink-soft)" }} />;
  };

  const query = q.trim().toLowerCase();
  const match = (it) => {
    if (!query) return true;
    const r = recOf(it);
    return ((r.title || "") + " " + (r.outlet || "") + " " + (r.filename || "") + " " + (it.group || "") + " " + (it.key || "")).toLowerCase().includes(query);
  };
  const shown = list.filter(match);

  // group into sections (preserve first-seen order) when any item carries a group
  const grouped = (() => {
    const hasGroups = shown.some(it => it.group);
    if (!hasGroups) return [{ name: null, items: shown }];
    const order = [], map = {};
    shown.forEach(it => { const g = it.group || "Other"; if (!map[g]) { map[g] = []; order.push(g); } map[g].push(it); });
    return order.map(name => ({ name, items: map[name] }));
  })();

  const selItem = list.find(it => it.key === sel) || null;
  const selRec = selItem ? recOf(selItem) : null;

  // seed extracted/typed text onto the record so it's citable + persists
  const seedText = (t) => { if (selRec && t && !String(selRec.text || "").trim()) { selRec.text = t; selRec.binary = false; } bump(v => v + 1); };

  const archivedBadge = (rec) => {
    const archived = !!rec.archive_url;
    return <span className="np-mono" style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".05em", border: "1px solid var(--rule)", padding: "0 5px", color: archived ? "var(--verified)" : "var(--ink-soft)" }}>{archived ? "archived" : "not archived"}</span>;
  };

  return (
    <div onClick={onClose} className="fade-in" style={{ position: "fixed", inset: 0, zIndex: 6200, background: "rgba(8,7,5,.74)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(1080px, 97vw)", height: "min(760px, 92vh)", display: "flex", flexDirection: "column", background: "var(--card)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 70px rgba(0,0,0,.5)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "2px solid var(--ink)", background: "var(--yellow)" }}>
          <I.folder style={{ fontSize: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 22, lineHeight: 1 }}>{title || "Source files"}</div>
            <div className="np-mono" style={{ fontSize: 10, color: "rgba(22,20,13,.7)", marginTop: 2 }}>{list.length} file{list.length === 1 ? "" : "s"} · read any source and grab the words that back a claim</div>
          </div>
          <button onClick={onClose} title="Close · esc" style={{ background: "none", border: 0, fontSize: 19, cursor: "pointer", lineHeight: 1 }}><I.x /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* left: the file list */}
          <div style={{ width: 320, flexShrink: 0, borderRight: "1.5px solid var(--ink)", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--paper-2)" }}>
            <div style={{ padding: "9px 10px", borderBottom: "1px solid var(--rule)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "0 8px" }}>
                <I.search style={{ fontSize: 13, color: "var(--ink-soft)" }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search files…" style={{ flex: 1, border: 0, background: "transparent", padding: "7px 0", fontFamily: "var(--serif)", fontSize: 13, outline: "none" }} />
              </span>
            </div>
            <div className="np-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {shown.length === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", padding: "14px 12px", lineHeight: 1.6 }}>{list.length ? "No files match your search." : "No source files here yet. Upload a document in the editor and it shows up here."}</div>}
              {grouped.map((sec, si) => (
                <div key={sec.name || ("g" + si)}>
                  {sec.name && <div className="np-eyebrow" style={{ fontSize: 9.5, color: "var(--ink-soft)", padding: "9px 12px 4px", display: "flex", alignItems: "center", gap: 5, position: "sticky", top: 0, background: "var(--paper-2)" }}><I.folder style={{ fontSize: 11 }} /> {sec.name}</div>}
                  {sec.items.map(it => {
                    const rec = recOf(it);
                    const active = it.key === sel;
                    return (
                      <button key={it.key} onClick={() => setSel(it.key)} style={{ display: "flex", gap: 8, alignItems: "flex-start", width: "100%", textAlign: "left", background: active ? "var(--yellow)" : "transparent", border: 0, borderBottom: "1px solid var(--rule)", borderLeft: "3px solid " + (active ? "var(--ink)" : "transparent"), padding: "9px 11px", cursor: "pointer" }}>
                        <span style={{ marginTop: 2, flex: "0 0 auto" }}>{kindIcon(rec)}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.title || rec.filename || it.key}</span>
                          <span className="np-mono" style={{ display: "block", fontSize: 9, color: active ? "rgba(22,20,13,.7)" : "var(--ink-soft)", marginTop: 2 }}>{(SV ? SV.kindLabel(rec) : "File")}{rec.size ? " · " + SV.humanSize(rec.size) : ""}{rec.outlet ? " · " + rec.outlet : ""}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* right: the viewer */}
          <div className="np-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 18px 22px", background: "var(--card)" }}>
            {!selRec ? (
              <div className="np-mono" style={{ fontSize: 12, color: "var(--ink-soft)", padding: "40px 0", textAlign: "center" }}>Select a file on the left to read it.</div>
            ) : (
              <React.Fragment>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  {renaming ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 220 }}>
                      <input autoFocus value={renameText} onChange={e => setRenameText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); } }}
                        placeholder="Source title"
                        style={{ flex: 1, minWidth: 0, border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 19, padding: "3px 8px", outline: "none" }} />
                      <button onClick={commitRename} className="np-mono" style={{ flex: "0 0 auto", background: "var(--yellow)", border: "1.5px solid var(--ink)", color: "var(--ink)", fontWeight: 700, fontSize: 11, padding: "5px 9px", cursor: "pointer" }}>Save</button>
                      <button onClick={() => setRenaming(false)} className="np-mono" style={{ flex: "0 0 auto", background: "transparent", border: "1.5px solid var(--ink)", color: "var(--ink-soft)", fontSize: 11, padding: "5px 9px", cursor: "pointer" }}>Cancel</button>
                    </span>
                  ) : (
                    <React.Fragment>
                      <h2 style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 21, lineHeight: 1.1, margin: 0 }}>{selRec.title || selRec.filename || selItem.key}</h2>
                      {onRename && <button onClick={() => { setRenameText(selRec.title || selRec.filename || ""); setRenaming(true); }} title="Rename this source" className="np-mono" style={{ background: "transparent", border: "1px solid var(--rule)", color: "var(--ink-soft)", fontSize: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>✎ Rename</button>}
                      <span className="np-mono" style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".05em", border: "1px solid var(--ink)", padding: "0 5px" }}>{SV ? SV.kindLabel(selRec) : "File"}</span>
                      {archivedBadge(selRec)}
                    </React.Fragment>
                  )}
                </div>
                <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {selRec.outlet && <span>{selRec.outlet}</span>}
                  {selRec.filename && <span>{selRec.filename}</span>}
                  {selRec.size ? <span>{SV.humanSize(selRec.size)}</span> : null}
                  <span style={{ opacity: .7 }}>{selItem.key}</span>
                </div>

                {/* opened to bind a span → cite the source you're reading, right here */}
                {onCite && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, padding: "8px 11px", border: "1.5px solid var(--ink)", background: "var(--yellow)" }}>
                    <I.source style={{ fontSize: 15, flex: "0 0 auto" }} />
                    <span className="np-mono" style={{ fontSize: 10.5, lineHeight: 1.45, flex: 1, minWidth: 0 }}>Bind your selected words to this source — then pin the exact passage.</span>
                    <button onClick={() => onCite(selItem.key)} className="np-cond" style={{ flex: "0 0 auto", background: "var(--ink)", color: "var(--paper)", border: 0, padding: "6px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", whiteSpace: "nowrap" }}>Cite this →</button>
                  </div>
                )}

                {window.SourceViewer
                  ? <window.SourceViewer key={selItem.key} srcKey={selItem.key} rec={selRec} height={460} onText={seedText}
                      onEditText={srcApi && srcApi.setSourceText ? (t => { srcApi.setSourceText(selItem.key, t); bump(v => v + 1); }) : undefined} />
                  : <div className="np-mono" style={{ fontSize: 11, color: "var(--reject)" }}>Viewer unavailable.</div>}

                {/* adapt the source: treat-as-image + OCR on/off/edit. Only when the
                    host wired a source api (the newsroom does; read-only browses don't). */}
                {srcApi && window.SourceAdapter && SV && SV.hasFile && SV.hasFile(selRec) &&
                  <window.SourceAdapter rec={selRec} api={srcApi} NR={ADAPTER_THEME} nCites={(selItem.carriers || []).length} />}

                {/* cited by */}
                {selItem.carriers && selItem.carriers.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
                    <div className="np-eyebrow" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginBottom: 6 }}>Cited by</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {selItem.carriers.map((c, i) => (
                        <button key={i} onClick={() => c.onOpen && c.onOpen()} disabled={!c.onOpen} title={c.onOpen ? "Open this article" : ""}
                          style={{ cursor: c.onOpen ? "pointer" : "default", border: "1px solid var(--rule)", background: "var(--paper-2)", padding: "3px 9px", fontSize: 11, fontFamily: "var(--cond)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <I.doc style={{ fontSize: 11 }} /> {c.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </React.Fragment>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
window.SourceExplorer = SourceExplorer;
