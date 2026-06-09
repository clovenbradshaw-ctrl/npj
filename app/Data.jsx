/* NPJ — Data explorer, archive.org consent modal, and the editor's data picker.
   Patterns adapted from drafteo (sources.js): all-or-nothing archive consent. */

/* ============ archive.org consent modal (Permanence/Privacy/Rights) ============ */
function ArchiveModal({ items, onClose, onDone }) {
  const [consent, setConsent] = useState({ permanence: false, privacy: false, rights: false });
  const [phase, setPhase] = useState("consent"); // consent | running | done
  const [i, setI] = useState(0);
  const all = consent.permanence && consent.privacy && consent.rights;
  const list = items && items.length ? items : [{ name: "this source" }];

  useEffect(() => {
    if (phase !== "running") return;
    if (i >= list.length) { const t = setTimeout(() => setPhase("done"), 400); return () => clearTimeout(t); }
    const t = setTimeout(() => setI(i + 1), 700);
    return () => clearTimeout(t);
  }, [phase, i]);

  const Chk = ({ k, label, children }) => (
    <label style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--rule)", cursor: "pointer", alignItems: "flex-start" }}>
      <input type="checkbox" checked={consent[k]} onChange={(e) => setConsent(c => ({ ...c, [k]: e.target.checked }))} style={{ marginTop: 3 }} />
      <span><span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}. </span>
        <span style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45, color: "var(--ink-soft)" }}>{children}</span></span>
    </label>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.7)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }} className="fade-in">
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px,96vw)", background: "var(--card)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px", borderBottom: "2px solid var(--ink)", background: "var(--yellow)" }}>
          <div>
            <div style={{ fontFamily: "var(--display)", fontSize: 21 }}>Publish to Internet Archive</div>
            <div className="np-mono" style={{ fontSize: 10.5 }}>Permanent · CC-BY-4.0 · all-or-nothing</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 18 }}><I.x /></button>
        </div>

        <div style={{ padding: "18px" }}>
          {phase === "consent" && <React.Fragment>
            <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-soft)", margin: "0 0 14px" }}>
              You're about to archive <strong style={{ color: "var(--ink)" }}>{list.length} source{list.length !== 1 ? "s" : ""}</strong> to <em>archive.org</em>. Each becomes part of the permanent public record, and every citation that points to it will resolve to its archived snapshot.
            </p>
            <div style={{ padding: "10px 12px", background: "color-mix(in srgb, var(--review) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--review) 36%, transparent)", fontFamily: "var(--serif)", fontSize: 13, color: "var(--review)", marginBottom: 8 }}>
              <strong style={{ fontWeight: 700 }}>No redactions. </strong>Archiving is all-or-nothing. If a source contains anything that shouldn't be public, redact the original and re-upload before publishing.
            </div>
            <Chk k="permanence" label="Permanence">This is uploaded permanently to the Internet Archive and cannot be deleted.</Chk>
            <Chk k="privacy" label="Privacy">I have reviewed each file and confirm it contains no private information that should not be public.</Chk>
            <Chk k="rights" label="Rights">I have the right to publish this material under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline" }}>CC-BY-4.0</a>.</Chk>
          </React.Fragment>}

          {phase === "running" && <div style={{ padding: "4px 0" }}>
            {list.map((s, j) => (
              <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: j < list.length - 1 ? "1px solid var(--rule)" : 0, opacity: j > i ? .4 : 1 }}>
                <span style={{ width: 20, textAlign: "center" }}>{j < i ? <I.check style={{ fontSize: 16, color: "var(--verified)" }} /> : j === i ? <span style={{ width: 12, height: 12, border: "2px solid var(--ink)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> : <span className="np-mono" style={{ color: "var(--ink-soft)" }}>↻</span>}</span>
                <span style={{ fontFamily: "var(--serif)", fontSize: 14, flex: 1 }}>{s.name}</span>
                <span className="np-mono" style={{ fontSize: 10, color: j < i ? "var(--verified)" : "var(--ink-soft)" }}>{j < i ? "archived ✓" : "submitting…"}</span>
              </div>
            ))}
          </div>}

          {phase === "done" && <div style={{ textAlign: "center", padding: "10px 0 4px" }} className="fade-in">
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--verified)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}><I.archive style={{ fontSize: 26 }} /></div>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, marginBottom: 4 }}>Archived to the record.</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink-soft)" }}>{list.length} snapshot{list.length !== 1 ? "s" : ""} are now permanent and citeable.</div>
          </div>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderTop: "1.5px solid var(--ink)" }}>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>Webhook: PROVeo · kind=source</span>
          <div style={{ display: "flex", gap: 8 }}>
            {phase === "consent" && <React.Fragment>
              <button className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={!all} onClick={() => setPhase("running")} style={{ opacity: all ? 1 : .45, cursor: all ? "pointer" : "not-allowed" }}>Publish {list.length} to archive.org</button>
            </React.Fragment>}
            {phase === "done" && <button className="btn btn-sm btn-primary" onClick={() => (onDone ? onDone() : onClose())}>Done</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ dataset row + preview ============ */
function dsAccent(type) { return "var(--data)"; }
function DatasetCard({ d, onCite, onArchive, compact }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: compact ? 8 : 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <I.data style={{ fontSize: 22, color: "var(--data)", flex: "0 0 auto" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 17, lineHeight: 1.08 }}>{d.name}</div>
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "var(--data)" }}>◆ {d.project}</span>
            <span>{d.rows.toLocaleString()} rows · {d.cols.length} cols</span>
            <span>updated {d.updated}</span>
            <span>{d.cites} citations</span>
          </div>
        </div>
        {d.archived
          ? <span className="chip chip-accepted" style={{ flex: "0 0 auto" }}><I.archive style={{ fontSize: 12 }} /> Archived</span>
          : <button className="btn btn-sm" onClick={() => onArchive && onArchive(d)} style={{ borderColor: "var(--review)", color: "var(--review)", flex: "0 0 auto" }}>Archive</button>}
        {onCite && <button className="btn btn-sm btn-primary" onClick={() => onCite(d)} style={{ flex: "0 0 auto" }}>Cite</button>}
        <button onClick={() => setOpen(o => !o)} className="btn btn-sm btn-ghost" style={{ flex: "0 0 auto" }}>{open ? "Hide" : "Preview"}</button>
      </div>
      {open && (
        <div className="fade-in" style={{ borderTop: "1px solid var(--rule)", padding: "10px 14px", overflowX: "auto" }}>
          <table className="np-mono" style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
            <thead><tr>{d.cols.map(c => <th key={c} style={{ textAlign: "left", padding: "4px 10px 4px 0", borderBottom: "1.5px solid var(--ink)", textTransform: "uppercase", letterSpacing: ".04em" }}>{c}</th>)}</tr></thead>
            <tbody>{[0, 1, 2].map(r => <tr key={r}>{d.cols.map(c => <td key={c} style={{ padding: "4px 10px 4px 0", borderBottom: "1px solid var(--rule)", color: "var(--ink-soft)" }}>·····</td>)}</tr>)}</tbody>
          </table>
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 6 }}>{d.archived ? <a href={d.archive_url} target="_blank" rel="noopener" style={{ color: "var(--verified)" }}>archived snapshot ↗</a> : "not yet archived — cites won't resolve until you freeze it"}</div>
        </div>
      )}
    </div>
  );
}

/* ============ data explorer page ============ */
function DataExplorer({ onHome, onNewsroom }) {
  const data = window.NPJ.DATASETS || [];
  const projects = ["All", ...Array.from(new Set(data.map(d => d.project)))];
  const [q, setQ] = useState("");
  const [proj, setProj] = useState("All");
  const [archiveTarget, setArchiveTarget] = useState(null);
  const shown = data.filter(d => (proj === "All" || d.project === proj) && (d.name + d.project + d.cols.join(" ")).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fade-in">
      <Masthead route="explore" onHome={onHome} onNewsroom={onNewsroom} />
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 22px 70px" }}>
        <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 10 }}>Data explorer</div>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 58, lineHeight: .9, margin: "0 0 10px" }}>The evidence, before the story.</h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: 18, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "60ch", margin: "0 0 24px" }}>
          Every dataset any project has gathered, in one place — searchable, previewable, and citeable from any story across any feed. Archived datasets resolve to a permanent snapshot; the rest are a click away from it.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "0 12px", flex: "1 1 260px" }}>
            <I.search style={{ fontSize: 16, color: "var(--ink-soft)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search datasets, columns, projects…"
              style={{ flex: 1, border: 0, background: "transparent", padding: "11px 0", fontFamily: "var(--serif)", fontSize: 15, outline: "none" }} />
          </div>
          <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{shown.length} of {data.length}</span>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 20 }}>
          {projects.map(p => (
            <button key={p} onClick={() => setProj(p)} className="np-cond" style={{ fontSize: 13, padding: "5px 12px", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600,
              border: "1.5px solid var(--ink)", background: proj === p ? "var(--ink)" : "var(--card)", color: proj === p ? "var(--yellow)" : "var(--ink)" }}>{p}</button>
          ))}
        </div>

        {shown.map(d => <DatasetCard key={d.id} d={d} onArchive={setArchiveTarget} />)}
        {shown.length === 0 && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)" }}>No datasets match.</div>}
      </div>
      {archiveTarget && <ArchiveModal items={[{ name: archiveTarget.name }]} onClose={() => setArchiveTarget(null)} onDone={() => setArchiveTarget(null)} />}
    </div>
  );
}

/* ============ data picker (used inside the composer) ============ */
function DataPicker({ onPick, onClose }) {
  const data = window.NPJ.DATASETS || [];
  const [q, setQ] = useState("");
  const shown = data.filter(d => (d.name + d.project + d.cols.join(" ")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.6)", zIndex: 5000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 22px" }} className="fade-in">
      <div onClick={(e) => e.stopPropagation()} className="np-scroll" style={{ width: "min(620px,96vw)", maxHeight: "76vh", overflowY: "auto", background: "var(--paper)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ position: "sticky", top: 0, background: "var(--ink)", color: "var(--paper)", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--display)", fontSize: 19, color: "var(--yellow)" }}>CITE A DATASET</span>
            <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 16 }}><I.x /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.25)", padding: "0 10px" }}>
            <I.search style={{ fontSize: 15, opacity: .7 }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find data across every project…"
              className="np-mono" style={{ flex: 1, border: 0, background: "transparent", color: "var(--paper)", padding: "9px 0", fontSize: 13, outline: "none" }} />
          </div>
        </div>
        <div style={{ padding: "12px 14px" }}>
          {shown.map(d => <DatasetCard key={d.id} d={d} compact onCite={(ds) => onPick(ds)} />)}
          {shown.length === 0 && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", padding: "10px 2px" }}>No datasets match “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ArchiveModal, DataExplorer, DataPicker, DatasetCard });
