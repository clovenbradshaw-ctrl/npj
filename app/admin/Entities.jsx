/* NPJ entity layer — powered by the real eoreader3 engine (window.EOEngine).
   projectEntities() → prominence-ranked figures/places/orgs with sentence
   anchors; entityDetail() → mentions + co-occurrence. Mechanical, no model. */

const ENT_META = {
  person: { label: "People", color: "#1f6f4a", tag: "P" },
  place:  { label: "Places", color: "#2b5f8a", tag: "◦" },
  org:    { label: "Organizations", color: "#9a6a12", tag: "▤" }
};

/* split a string, wrapping occurrences of `name` in a highlight mark */
function markEntities(str, name, keyPrefix) {
  if (!name || !str) return str;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(" + esc + ")", "gi");
  const parts = String(str).split(re);
  if (parts.length === 1) return str;
  return parts.map((p, i) => p && p.toLowerCase() === name.toLowerCase()
    ? <mark key={(keyPrefix || "") + "e" + i} className="ent-mark">{p}</mark>
    : <React.Fragment key={(keyPrefix || "") + "t" + i}>{p}</React.Fragment>);
}

function ProminenceBar({ value, max, color }) {
  const pct = Math.max(6, Math.round((value / (max || 1)) * 100));
  return (
    <div style={{ height: 5, background: "var(--paper-2)", border: "1px solid var(--rule)", marginTop: 4 }}>
      <div style={{ width: pct + "%", height: "100%", background: color }} />
    </div>
  );
}

function EntityRow({ e, max, active, onSelect, doc }) {
  const m = ENT_META[e.type] || ENT_META.person;
  return (
    <div className="ent-row" onClick={() => onSelect(active ? null : e)} style={{ cursor: "pointer", padding: "8px 9px", marginBottom: 4,
      border: "1.5px solid " + (active ? "var(--ink)" : "transparent"), background: active ? "var(--card)" : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 18, height: 18, flex: "0 0 auto", background: m.color, color: "#fff", fontFamily: "var(--cond)",
          fontWeight: 700, fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{m.tag}</span>
        <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15.5, lineHeight: 1, flex: 1 }}>{e.name}</span>
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{e.raw}×</span>
      </div>
      <ProminenceBar value={e.mass} max={max} color={m.color} />
      {active && <EntityDossier e={e} doc={doc} />}
    </div>
  );
}

function EntityDossier({ e, doc }) {
  const detail = React.useMemo(() => {
    try { return window.EOEngine.entityDetail(doc, e.name); } catch (x) { return null; }
  }, [doc, e.name]);
  if (!detail) return null;
  return (
    <div className="fade-in" style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--rule)" }}>
      <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginBottom: 6 }}>
        mass {e.mass} · {detail.sentences.length} mention{detail.sentences.length !== 1 ? "s" : ""} · INS anchor in the event log
      </div>
      {detail.sentences.slice(0, 3).map(s => (
        <div key={s.i} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
          <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>s{s.i}</span>
          <span style={{ fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.34, color: "var(--ink-soft)" }}>
            {markEntities(s.t.length > 120 ? "…" + s.t.slice(s.t.toLowerCase().indexOf(e.name.toLowerCase()) - 20).slice(0, 120) + "…" : s.t, e.name, "d" + s.i)}
          </span>
        </div>
      ))}
      {detail.cooc.length > 0 && (
        <div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Appears with</span>
          {detail.cooc.slice(0, 5).map(([n, c]) => (
            <span key={n} className="np-mono" style={{ fontSize: 10, border: "1px solid var(--rule)", padding: "1px 5px", background: "var(--paper-2)" }}>{n}<span style={{ color: "var(--ink-soft)" }}> ×{c}</span></span>
          ))}
        </div>
      )}
    </div>
  );
}

function EntityRail({ open, onClose, entityData, active, setActive }) {
  const loading = !entityData;
  const entities = entityData ? entityData.entities : [];
  const doc = entityData ? entityData.doc : null;
  const max = entities.reduce((m, e) => Math.max(m, e.mass), 1);
  const groups = ["person", "place", "org"];

  return (
    <aside className="np-scroll" style={{ position: "fixed", top: 0, left: 0, height: "100vh", width: 360,
      background: "var(--paper)", borderRight: "2.5px solid var(--ink)", boxShadow: "12px 0 30px rgba(22,20,13,.16)",
      transform: open ? "none" : "translateX(-372px)", transition: "transform .28s cubic-bezier(.4,0,.1,1)",
      zIndex: 3000, overflowY: "auto" }}>
      <div style={{ position: "sticky", top: 0, background: "var(--ink)", color: "var(--paper)", zIndex: 2, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--yellow)" }}>●</span>
            <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>FIGURES &amp; PLACES</span>
            <span className="np-mono" style={{ fontSize: 11, opacity: .7 }}>{entities.length}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18 }}><I.x /></button>
        </div>
        <div className="np-mono" style={{ fontSize: 10, opacity: .62, marginTop: 5, lineHeight: 1.4 }}>extracted by eoreader3 — compromise POS + EO prominence. mechanical, no model.</div>
      </div>

      <div style={{ padding: "12px 14px 40px" }}>
        {loading && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", fontSize: 14, padding: "12px 4px" }}>Reading the article…</div>}
        {!loading && entities.length === 0 && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", fontSize: 14 }}>No figures surfaced.</div>}
        {!loading && groups.map(g => {
          const list = entities.filter(e => e.type === g);
          if (!list.length) return null;
          const m = ENT_META[g];
          return (
            <div key={g} style={{ marginBottom: 16 }}>
              <div className="np-eyebrow" style={{ color: m.color, borderBottom: "1.5px solid " + m.color, paddingBottom: 5, marginBottom: 8 }}>{m.label} · {list.length}</div>
              {list.map(e => <EntityRow key={e.key} e={e} max={max} active={active && active.key === e.key} onSelect={setActive} doc={doc} />)}
            </div>
          );
        })}
        <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--rule)" }} className="np-mono">
          <span style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.5 }}>
            Each figure is an <b style={{ color: "var(--ink)" }}>● INS</b> anchor in the same append-only event log the suggestion layer folds over — sources, claims, figures and edits are all one notation.
          </span>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { markEntities, EntityRail, ENT_META });
