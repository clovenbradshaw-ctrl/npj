/* NPJ — Data explorer, archive.org consent modal, and the editor's data picker.
   Patterns adapted from drafteo (sources.js): all-or-nothing archive consent.
   The explorer + picker render live archive.org items: app/archive-sources.js
   pulls everything tagged `npj-source` into window.NPJ.DATASETS and fires
   "npj:datasets" — useArchiveData() below re-renders on that event. */

/* ============ archive.org consent modal (Permanence/Privacy/Rights) ============ */
function ArchiveModal({ items, onClose, onDone, srcKey }) {
  const [consent, setConsent] = useState({ permanence: false, privacy: false, rights: false });
  const [phase, setPhase] = useState("consent"); // consent | running | done
  const [i, setI] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [, bumpReview] = useState(0);
  const PII = window.NpjPII;
  const rec = srcKey ? (window.NPJ.SOURCES && window.NPJ.SOURCES[srcKey]) : null;
  // A source Citey can act on (an upload, or anything with text / opaque bytes)
  // is gated behind his PII review — the Privacy consent is SATISFIED BY that
  // review, not a self-check box. Other items keep the manual affirmation.
  const gateable = !!(rec && PII && (/^doc-/.test(srcKey) || rec.binary || String(rec.text || "").trim()));
  const reviewed = gateable ? PII.gateClear(rec) : false;
  const privacyOk = gateable ? reviewed : consent.privacy;
  const all = consent.permanence && privacyOk && consent.rights;
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
    <React.Fragment>
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
              <strong style={{ fontWeight: 700 }}>Permanent &amp; public. </strong>An archived source can't be edited or deleted later. Each upload is reviewed for PII first and <strong>hard-redacts</strong> anything you don't want public — there's no taking it back once it's on archive.org.
            </div>
            <Chk k="permanence" label="Permanence">This is uploaded permanently to the Internet Archive and cannot be deleted.</Chk>
            {gateable ? (
              <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--rule)", alignItems: "flex-start" }}>
                <span style={{ marginTop: 1, color: reviewed ? "var(--verified)" : "var(--review)", fontSize: 16, width: 16, textAlign: "center", flex: "0 0 auto" }}>{reviewed ? <I.check /> : "⚑"}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em" }}>Privacy — PII review. </span>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45, color: "var(--ink-soft)" }}>
                    {reviewed
                      ? <React.Fragment>Reviewed — {(rec.piiReview.redactions || []).length} redacted, {(rec.piiReview.affirmations || []).length} kept on purpose.</React.Fragment>
                      : "This has to be scanned, and each flagged span redacted or affirmed, before it can be archived."}
                  </span>
                  <div style={{ marginTop: 6 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => setReviewOpen(true)} style={reviewed ? { background: "transparent", color: "var(--ink)", borderColor: "var(--ink)" } : {}}>{reviewed ? "Re-open review" : "Review for PII"}</button>
                  </div>
                </div>
              </div>
            ) : (
              <Chk k="privacy" label="Privacy">I have reviewed this source and confirm it contains no private information that should not be public.</Chk>
            )}
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
    {reviewOpen && window.CiteyRedactModal && <window.CiteyRedactModal srcKey={srcKey}
      onClose={() => { setReviewOpen(false); bumpReview(v => v + 1); }}
      onDone={() => { setReviewOpen(false); bumpReview(v => v + 1); }} />}
    </React.Fragment>
  );
}

/* ============ live data: archive.org items land in window.NPJ.DATASETS ============ */
function useArchiveData() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    window.addEventListener("npj:datasets", bump);
    return () => window.removeEventListener("npj:datasets", bump);
  }, []);
  return window.NPJ.DATASETS || [];
}
function dsHaystack(d) {
  return [d.name, d.project, (d.cols || []).join(" "), d.description || "", (d.subjects || []).join(" ")].join(" ").toLowerCase();
}
function TagCode({ children }) {
  return <code className="np-mono" style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", padding: "1px 6px", fontSize: 12, whiteSpace: "nowrap" }}>{children}</code>;
}

/* ============ dataset row + preview ============ */
function dsAccent(type) { return "var(--data)"; }
function DatasetCard({ d, onCite, onArchive, compact }) {
  const [open, setOpen] = useState(false);
  const cols = d.cols || [];
  const hasTable = cols.length > 0;
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: compact ? 8 : 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <I.data style={{ fontSize: 22, color: "var(--data)", flex: "0 0 auto" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 17, lineHeight: 1.08 }}>{d.name}</div>
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "var(--data)" }}>◆ {d.project}</span>
            {typeof d.rows === "number"
              ? <span>{d.rows.toLocaleString()} rows · {cols.length} cols</span>
              : d.sizeLabel ? <span>{d.sizeLabel}{d.mediatype ? " · " + d.mediatype : ""}</span> : null}
            {d.updated && <span>updated {d.updated}</span>}
            {d.origin === "archive.org"
              ? <span>{(d.downloads || 0).toLocaleString()} downloads</span>
              : <span>{d.cites} citations</span>}
          </div>
        </div>
        {d.archived
          ? (d.archive_url
            ? <a href={d.archive_url} target="_blank" rel="noopener" className="chip chip-accepted" style={{ flex: "0 0 auto", textDecoration: "none" }}><I.archive style={{ fontSize: 12 }} /> Archived</a>
            : <span className="chip chip-accepted" style={{ flex: "0 0 auto" }}><I.archive style={{ fontSize: 12 }} /> Archived</span>)
          : <button className="btn btn-sm" onClick={() => onArchive && onArchive(d)} style={{ borderColor: "var(--review)", color: "var(--review)", flex: "0 0 auto" }}>Archive</button>}
        {onCite && <button className="btn btn-sm btn-primary" onClick={() => onCite(d)} style={{ flex: "0 0 auto" }}>Cite</button>}
        <button onClick={() => setOpen(o => !o)} className="btn btn-sm btn-ghost" style={{ flex: "0 0 auto" }}>{open ? "Hide" : "Preview"}</button>
      </div>
      {open && (
        <div className="fade-in" style={{ borderTop: "1px solid var(--rule)", padding: "10px 14px", overflowX: "auto" }}>
          {hasTable && <table className="np-mono" style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
            <thead><tr>{cols.map(c => <th key={c} style={{ textAlign: "left", padding: "4px 10px 4px 0", borderBottom: "1.5px solid var(--ink)", textTransform: "uppercase", letterSpacing: ".04em" }}>{c}</th>)}</tr></thead>
            <tbody>{[0, 1, 2].map(r => <tr key={r}>{cols.map(c => <td key={c} style={{ padding: "4px 10px 4px 0", borderBottom: "1px solid var(--rule)", color: "var(--ink-soft)" }}>·····</td>)}</tr>)}</tbody>
          </table>}
          {!hasTable && <React.Fragment>
            {d.description
              ? <p style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 8px" }}>{d.description.length > 320 ? d.description.slice(0, 320) + "…" : d.description}</p>
              : <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: "var(--ink-soft)", margin: "0 0 8px" }}>No description on the archive item.</p>}
            {(d.subjects || []).length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
              {d.subjects.map(s => <span key={s} className="np-mono" style={{ fontSize: 10, border: "1px solid var(--rule)", padding: "1px 7px", color: "var(--ink-soft)" }}>{s}</span>)}
            </div>}
          </React.Fragment>}
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 6 }}>{d.archived ? <a href={d.archive_url} target="_blank" rel="noopener" style={{ color: "var(--verified)" }}>archived snapshot ↗</a> : "not yet archived — cites won't resolve until you freeze it"}</div>
        </div>
      )}
    </div>
  );
}

/* ============ published sources: the archive behind released stories ============ */
// The Data tab's spine: every source cited by a PUBLISHED article, folded out of
// the committed record (NpjSources.buildPublishedIndex), deduped by content
// signature and backtracked to the stories that link to it.
function usePublishedSources() {
  const [snap, setSnap] = useState(() => ({
    state: window.NpjSources ? window.NpjSources.publishedState() : "idle",
    groups: window.NpjSources ? window.NpjSources.publishedGroups() : null
  }));
  useEffect(() => {
    if (!window.NpjSources) return;
    const off = window.NpjSources.onChange(s => setSnap({ state: s.state, groups: s.groups }));
    window.NpjSources.buildPublishedIndex().catch(() => {});
    return off;
  }, []);
  return snap;
}

// One source, with the trail back to the articles that cite it (the inverse of
// "read the source" — trace who relied on it).
function PublishedSourceCard({ g, onOpenArticle }) {
  const [open, setOpen] = useState(false);
  const k = g.kind || {};
  const url = g.rec && (g.rec.archive_url || g.rec.original_url);
  const pubArticles = g.carriers.filter(c => c.kind === "published");
  const n = pubArticles.length;
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <I.archive style={{ fontSize: 20, color: k.archived ? "var(--verified)" : "var(--data)", flex: "0 0 auto" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 17, lineHeight: 1.08 }}>{g.title}</div>
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "var(--data)" }}>{k.label}</span>
            <span>cited by {n} article{n !== 1 ? "s" : ""}</span>
            {g.duplicated && <span title="Identical content uploaded more than once — linked, not duplicated" style={{ color: "var(--review)" }}>×{g.uploads} uploads linked</span>}
          </div>
        </div>
        {url
          ? <a href={url} target="_blank" rel="noopener" className={k.archived ? "chip chip-accepted" : "btn btn-sm"} style={{ flex: "0 0 auto", textDecoration: "none" }}><I.archive style={{ fontSize: 12 }} /> {k.archived ? "Archived" : "Open"}</a>
          : <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>no snapshot</span>}
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(o => !o)} style={{ flex: "0 0 auto" }}>{open ? "Hide trail" : "Trace ↩"}</button>
      </div>
      {open && (
        <div className="fade-in" style={{ borderTop: "1px solid var(--rule)", padding: "10px 14px" }}>
          <div className="np-eyebrow" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginBottom: 7 }}>Linked from</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pubArticles.map(c => (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <button onClick={() => onOpenArticle && c.slug && onOpenArticle(c.slug)} title="Read this article" style={{ cursor: "pointer", textAlign: "left", border: 0, background: "transparent", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, color: "var(--ink)", textDecoration: "underline", textUnderlineOffset: 2, padding: 0 }}>{c.title}</button>
                {(c.quotes || []).slice(0, 1).map((q, i) => (
                  <span key={i} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12, color: "var(--ink-soft)" }}>“{q.length > 110 ? q.slice(0, 110) + "…" : q}”</span>
                ))}
              </div>
            ))}
            {n === 0 && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>No published article cites this yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ pivot by article: each story with the sources it rests on ============ */
// Invert the deduped source index (source → carriers) into article → sources, so
// the same archive can be read either way. Sources are already one-per-signature,
// so an article never lists the same source twice. Newest-cited (most sources) first.
function articlePivot(groups) {
  const byArticle = new Map();
  (groups || []).forEach(g => {
    (g.carriers || []).filter(c => c.kind === "published").forEach(c => {
      const key = c.slug || c.id;
      let a = byArticle.get(key);
      if (!a) { a = { slug: c.slug, title: c.title, sources: [] }; byArticle.set(key, a); }
      a.sources.push({ g, quotes: c.quotes || [] });
    });
  });
  return Array.from(byArticle.values()).sort((a, b) => b.sources.length - a.sources.length);
}

// One article, with the deduped sources its claims are pinned to — each linked to
// its archived snapshot. The inverse view of PublishedSourceCard.
function ArticleSourcesCard({ a, onOpenArticle }) {
  const open = () => onOpenArticle && a.slug && onOpenArticle(a.slug);
  const n = a.sources.length;
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: n ? "1px solid var(--rule)" : 0 }}>
        <I.doc style={{ fontSize: 20, color: "var(--ink-soft)", flex: "0 0 auto" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={open} title="Read this article" style={{ display: "block", maxWidth: "100%", cursor: "pointer", textAlign: "left", border: 0, background: "transparent", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 17, lineHeight: 1.08, color: "var(--ink)", padding: 0 }}>{a.title}</button>
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 3 }}>{n} source{n !== 1 ? "s" : ""} cited</div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={open} style={{ flex: "0 0 auto" }}>Read ↗</button>
      </div>
      {n > 0 && (
        <div style={{ padding: "2px 14px 8px" }}>
          {a.sources.map(({ g, quotes }) => {
            const k = g.kind || {};
            const url = g.rec && (g.rec.archive_url || g.rec.original_url);
            return (
              <div key={g.signature} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderTop: "1px solid var(--rule)", flexWrap: "wrap" }}>
                <I.archive style={{ fontSize: 14, color: k.archived ? "var(--verified)" : "var(--data)", flex: "0 0 auto", alignSelf: "flex-start", marginTop: 2 }} />
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5 }}>{g.title}</span>
                  <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginLeft: 8 }}>{k.label}</span>
                  {(quotes || []).slice(0, 1).map((qt, i) => (
                    <div key={i} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>“{qt.length > 140 ? qt.slice(0, 140) + "…" : qt}”</div>
                  ))}
                </div>
                {url
                  ? <a href={url} target="_blank" rel="noopener" className={k.archived ? "chip chip-accepted" : "btn btn-sm"} style={{ flex: "0 0 auto", textDecoration: "none", alignSelf: "center" }}><I.archive style={{ fontSize: 12 }} /> {k.archived ? "Archived" : "Open"}</a>
                  : <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", flex: "0 0 auto", alignSelf: "center" }}>no snapshot</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ data explorer page ============ */
function ArchiveTagHowTo({ failed }) {
  const tag = (window.NPJ.ARCHIVE || {}).tag || "npj-source";
  return (
    <div style={{ border: "1.5px dashed var(--ink)", background: "var(--card)", padding: "18px 20px", maxWidth: 640 }}>
      <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
        {failed ? "Couldn't reach archive.org" : "Nothing tagged yet"}
      </div>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-soft)", margin: "0 0 10px" }}>
        This page lists every Internet Archive item carrying the subject tag <TagCode>{tag}</TagCode>. To make an upload show up here:
      </p>
      <ol style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)", margin: "0 0 10px", paddingLeft: 20 }}>
        <li>Upload the file at <a href="https://archive.org/upload" target="_blank" rel="noopener" style={{ color: "var(--data)" }}>archive.org/upload</a> — or open an existing item and hit <strong>Edit metadata</strong>.</li>
        <li>Under <strong>Subject tags</strong>, add <TagCode>{tag}</TagCode>.</li>
        <li>Optionally add <TagCode>npj-project:Your Project</TagCode> to group it under a project filter here.</li>
      </ol>
      <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>
        new tags appear after the archive.org search index refreshes — minutes up to about an hour
      </div>
    </div>
  );
}

function DataExplorer({ onHome, onNewsroom, onOpenArticle }) {
  const mobile = window.useIsMobile();
  const data = useArchiveData();
  const arc = window.NPJ.ARCHIVE || {};
  const pub = usePublishedSources();
  const projects = ["All", ...Array.from(new Set(data.map(d => d.project)))];
  // The archive of cited sources, pivotable two ways, plus the raw archive.org list:
  //   "source"  (default) — one row per unique source, backtracked to the stories citing it
  //   "article"           — pivoted by article: each story with the deduped sources it rests on
  //   "all"               — every archive.org item carrying the tag, cited or not
  const [mode, setMode] = useState("source");
  const [q, setQ] = useState("");
  const [proj, setProj] = useState("All");
  const [archiveTarget, setArchiveTarget] = useState(null);
  const ql = q.toLowerCase();
  const shown = data.filter(d => (proj === "All" || d.project === proj) && dsHaystack(d).includes(ql));
  const pubGroups = (pub.groups || []).filter(g =>
    !ql || ((g.title || "") + " " + ((g.rec && (g.rec.archive_url || g.rec.original_url)) || "") + " " + g.carriers.map(c => c.title).join(" ")).toLowerCase().includes(ql));
  const articles = articlePivot(pub.groups).filter(a =>
    !ql || ((a.title || "") + " " + a.sources.map(s => s.g.title).join(" ")).toLowerCase().includes(ql));

  return (
    <div className="fade-in">
      <Masthead route="explore" onHome={onHome} onNewsroom={onNewsroom} />
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 22px 70px" }}>
        <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 10 }}>Sources archive</div>
        <h1 style={{ fontFamily: "var(--display)", fontSize: mobile ? 38 : 58, lineHeight: .95, margin: "0 0 10px" }}>Every source, behind every story.</h1>
        <p style={{ fontFamily: "var(--serif)", fontSize: mobile ? 16 : 18, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "62ch", margin: "0 0 16px" }}>
          The archive of record — every source a published article rests on, archived on the Internet Archive and gathered in one place. Pivot it by source or by article; identical material uploaded more than once is linked, not duplicated, even across projects.
        </p>

        {/* pivot the cited-source archive by source or by article, or browse the raw archive.org list */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 0, marginBottom: 18, border: "1.5px solid var(--ink)", width: "fit-content", maxWidth: "100%" }}>
          {[["source", "By source"], ["article", "By article"], ["all", "All on archive.org"]].map(([m, label], i) => (
            <button key={m} onClick={() => setMode(m)} className="np-cond" style={{ fontSize: 13, padding: "7px 16px", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, border: 0, borderRight: i < 2 ? "1.5px solid var(--ink)" : 0, cursor: "pointer",
              background: mode === m ? "var(--ink)" : "var(--card)", color: mode === m ? "var(--yellow)" : "var(--ink)" }}>{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "0 12px", flex: "1 1 260px" }}>
            <I.search style={{ fontSize: 16, color: "var(--ink-soft)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === "all" ? "Search datasets, columns, projects…" : mode === "article" ? "Search articles, or the sources they cite…" : "Search sources, or the stories citing them…"}
              style={{ flex: 1, border: 0, background: "transparent", padding: "11px 0", fontFamily: "var(--serif)", fontSize: 15, outline: "none", minWidth: 0 }} />
          </div>
          <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{mode === "source" ? pubGroups.length + " source" + (pubGroups.length !== 1 ? "s" : "") : mode === "article" ? articles.length + " article" + (articles.length !== 1 ? "s" : "") : shown.length + " of " + data.length}</span>
        </div>

        {mode === "source" ? (
          <React.Fragment>
            <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {pub.state === "loading" && <span><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite", verticalAlign: "-1px", marginRight: 6 }} />reading the published record…</span>}
              {pub.state === "ok" && <span style={{ color: "var(--verified)" }}>● folded from the committed articles — sources deduped + backtracked</span>}
              {pub.state === "error" && <span style={{ color: "var(--reject)" }}>couldn't read the published record</span>}
            </div>
            {pubGroups.map(g => <PublishedSourceCard key={g.signature} g={g} onOpenArticle={onOpenArticle} />)}
            {pubGroups.length === 0 && pub.state !== "loading" && (
              <div style={{ border: "1.5px dashed var(--ink)", background: "var(--card)", padding: "18px 20px", maxWidth: 640 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{q ? "No source matches" : "No published sources yet"}</div>
                <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-soft)", margin: 0 }}>{q ? "Try another search, or switch to All on archive.org." : "When a story ships, every source its claims rest on lands here — with a trail back to the article. Browse everything on archive.org under All on archive.org."}</p>
              </div>
            )}
          </React.Fragment>
        ) : mode === "article" ? (
          <React.Fragment>
            <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {pub.state === "loading" && <span><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite", verticalAlign: "-1px", marginRight: 6 }} />reading the published record…</span>}
              {pub.state === "ok" && <span style={{ color: "var(--verified)" }}>● {articles.length} article{articles.length !== 1 ? "s" : ""} — each with the deduped sources it cites</span>}
              {pub.state === "error" && <span style={{ color: "var(--reject)" }}>couldn't read the published record</span>}
            </div>
            {articles.map(a => <ArticleSourcesCard key={a.slug || a.title} a={a} onOpenArticle={onOpenArticle} />)}
            {articles.length === 0 && pub.state !== "loading" && (
              <div style={{ border: "1.5px dashed var(--ink)", background: "var(--card)", padding: "18px 20px", maxWidth: 640 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{q ? "No article matches" : "No published articles yet"}</div>
                <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-soft)", margin: 0 }}>{q ? "Try another search, or switch to By source." : "When a story ships, it appears here with every source its claims rest on."}</p>
              </div>
            )}
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {arc.state === "loading" && <span>querying archive.org for subject:"{arc.tag}"…</span>}
              {arc.state === "ok" && <span style={{ color: "var(--verified)" }}>● live from archive.org — {data.length} item{data.length !== 1 ? "s" : ""} tagged "{arc.tag}"</span>}
              {arc.state === "error" && <span style={{ color: "var(--reject)" }}>archive.org query failed{arc.error ? " (" + arc.error + ")" : ""}</span>}
              {arc.state !== "loading" && <button onClick={() => window.NPJ.loadArchiveSources && window.NPJ.loadArchiveSources()} className="np-mono" style={{ border: "1px solid var(--rule)", background: "var(--card)", fontSize: 10, padding: "1px 8px", cursor: "pointer", color: "var(--ink-soft)" }}>refresh</button>}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 20 }}>
              {projects.map(p => (
                <button key={p} onClick={() => setProj(p)} className="np-cond" style={{ fontSize: 13, padding: "5px 12px", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600,
                  border: "1.5px solid var(--ink)", background: proj === p ? "var(--ink)" : "var(--card)", color: proj === p ? "var(--yellow)" : "var(--ink)" }}>{p}</button>
              ))}
            </div>
            {shown.map(d => <DatasetCard key={d.id} d={d} onArchive={setArchiveTarget} />)}
            {shown.length === 0 && (data.length === 0 && arc.state !== "loading"
              ? <ArchiveTagHowTo failed={arc.state === "error"} />
              : <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)" }}>{arc.state === "loading" ? "Loading from archive.org…" : "No datasets match."}</div>)}
            {data.length > 0 && (
              <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 18 }}>
                add a source: upload to archive.org with the subject tag <TagCode>{arc.tag || "npj-source"}</TagCode> (+ optional <TagCode>npj-project:Name</TagCode>)
              </div>
            )}
          </React.Fragment>
        )}
      </div>
      {archiveTarget && <ArchiveModal srcKey={archiveTarget.id} items={[{ name: archiveTarget.name }]} onClose={() => setArchiveTarget(null)} onDone={() => setArchiveTarget(null)} />}
    </div>
  );
}

/* ============ data picker (used inside the composer) ============ */
function DataPicker({ onPick, onClose }) {
  const data = useArchiveData();
  const [q, setQ] = useState("");
  const shown = data.filter(d => dsHaystack(d).includes(q.toLowerCase()));
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

Object.assign(window, { ArchiveModal, DataExplorer, DataPicker, DatasetCard, useArchiveData });
