/* NPJ article versioning — every published piece carries its edit version, all
   versions are viewable, and the diff between any two is obvious.

   Versions come from the publish chain (each commit to GitHub is a version, keyed
   by short SHA). A version is:
     { sha, ts, author, message, text }   // text = plaintext snapshot of the body
   The newest version is first. Until a piece has history, the list is just its
   current version. Diffs are word-level (LCS), rendered inline: additions are
   underlined green, deletions struck red. Mechanical, no model. */

/* ---- word-level diff (LCS over tokens, punctuation-aware) ---- */
function diffTokens(s) {
  // keep whitespace as its own tokens so reflow is faithful
  return String(s == null ? "" : s).split(/(\s+)/).filter(t => t.length);
}
function diffWords(aStr, bStr) {
  const a = diffTokens(aStr), b = diffTokens(bStr);
  const n = a.length, m = b.length;
  // LCS table
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  const push = (type, text) => { const last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type, text }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < n) { push("del", a[i]); i++; }
  while (j < m) { push("add", b[j]); j++; }
  return out;
}

function diffStats(parts) {
  let add = 0, del = 0;
  parts.forEach(p => { const w = (p.text.trim().match(/\S+/g) || []).length; if (p.type === "add") add += w; else if (p.type === "del") del += w; });
  return { add, del };
}

/* ---- inline diff renderer ---- */
function DiffView({ from, to }) {
  const parts = React.useMemo(() => diffWords(from, to), [from, to]);
  const { add, del } = diffStats(parts);
  return (
    <div style={{ fontFamily: "var(--serif)" }}>
      <div className="np-mono" style={{ fontSize: 11, marginBottom: 10, display: "flex", gap: 12 }}>
        <span style={{ color: "var(--verified, #1f8a5b)" }}>+{add} added</span>
        <span style={{ color: "var(--reject, #b23a26)" }}>−{del} removed</span>
      </div>
      <p style={{ fontSize: 16.5, lineHeight: 1.7, margin: 0, textWrap: "pretty" }}>
        {parts.map((p, i) => p.type === "same"
          ? <React.Fragment key={i}>{p.text}</React.Fragment>
          : p.type === "add"
            ? <ins key={i} style={{ textDecoration: "none", background: "color-mix(in srgb, var(--verified,#1f8a5b) 18%, transparent)", borderBottom: "2px solid var(--verified,#1f8a5b)" }}>{p.text}</ins>
            : <del key={i} style={{ background: "color-mix(in srgb, var(--reject,#b23a26) 13%, transparent)", color: "var(--reject,#b23a26)", textDecorationThickness: "1.5px" }}>{p.text}</del>)}
      </p>
    </div>
  );
}

/* ---- a compact version badge: "v.<sha>" that opens the history ---- */
function VersionBadge({ sha, count, onClick, dark }) {
  return (
    <button onClick={onClick} title="View edit history & diffs" className="np-mono"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1.5px solid " + (dark ? "rgba(255,255,255,.3)" : "var(--ink)"),
        background: dark ? "transparent" : "var(--card)", color: dark ? "#e3ddcc" : "var(--ink)", padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>
      <span style={{ fontFamily: "var(--mono)" }}>⊛</span> v.{sha || "draft"}{count > 1 ? " · " + count + " versions" : ""}
    </button>
  );
}

/* ---- the history overlay: pick two versions, see the diff ---- */
function VersionHistory({ versions, onClose }) {
  const list = (versions && versions.length) ? versions : [];
  const [a, setA] = useState(list.length > 1 ? 1 : 0); // older (compare-from)
  const [b, setB] = useState(0);                        // newer (compare-to)
  if (!list.length) return null;
  const single = list.length < 2;
  const vA = list[a], vB = list[b];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 5200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }} className="fade-in">
      <div onClick={(e) => e.stopPropagation()} className="np-scroll" style={{ width: single ? "min(620px,97vw)" : "min(860px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--yellow)" }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EDIT HISTORY</span>
          <span className="np-mono" style={{ fontSize: 11, opacity: .7 }}>{list.length} version{list.length !== 1 ? "s" : ""}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18 }}><I.x /></button>
        </div>

        {single ? (
          /* one version — no diff to pick. Show the snapshot plainly with a
             single tidy version stamp instead of dead from/to controls. */
          <div style={{ padding: "18px 22px 28px" }}>
            <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "11px 13px", marginBottom: 18 }}>
              <div className="np-mono" style={{ fontSize: 12, fontWeight: 600 }}>⊛ v.{vB.sha} · current</div>
              <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 3 }}>{vB.author || "—"} · {vB.ts || ""}</div>
              {vB.message && <div style={{ fontFamily: "var(--serif)", fontSize: 13, marginTop: 5, lineHeight: 1.4 }}>{vB.message}</div>}
            </div>
            <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 12 }}>
              First and only version — no edits since publishing. A diff appears once this piece is revised.
            </div>
            <p style={{ fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.7, margin: 0, textWrap: "pretty" }}>{vB.text}</p>
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "232px 1fr", minHeight: 0 }}>
          {/* timeline */}
          <div style={{ borderRight: "1.5px solid var(--ink)", padding: "12px 12px 24px" }}>
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Versions</div>
            {list.map((v, i) => {
              const isFrom = i === a, isTo = i === b;
              return (
                <div key={v.sha + i} style={{ border: "1.5px solid " + (isFrom || isTo ? "var(--ink)" : "var(--rule)"), marginBottom: 7, padding: "8px 9px", background: isTo ? "var(--yellow)" : isFrom ? "color-mix(in srgb, var(--yellow) 22%, transparent)" : "var(--card)" }}>
                  <div className="np-mono" style={{ fontSize: 11, fontWeight: 600 }}>⊛ v.{v.sha}{i === 0 ? " · current" : ""}</div>
                  <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 2 }}>{v.author || "—"} · {v.ts || ""}</div>
                  {v.message && <div style={{ fontFamily: "var(--serif)", fontSize: 12, marginTop: 4, lineHeight: 1.35 }}>{v.message}</div>}
                  <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                    <button onClick={() => setA(i)} className="np-cond" style={{ flex: 1, fontSize: 10.5, padding: "3px", textTransform: "uppercase", letterSpacing: ".04em", border: "1px solid var(--ink)", background: isFrom ? "var(--ink)" : "transparent", color: isFrom ? "var(--yellow)" : "var(--ink)", cursor: "pointer" }}>from</button>
                    <button onClick={() => setB(i)} className="np-cond" style={{ flex: 1, fontSize: 10.5, padding: "3px", textTransform: "uppercase", letterSpacing: ".04em", border: "1px solid var(--ink)", background: isTo ? "var(--ink)" : "transparent", color: isTo ? "var(--yellow)" : "var(--ink)", cursor: "pointer" }}>to</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* diff */}
          <div style={{ padding: "16px 20px 28px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <span className="np-mono" style={{ fontSize: 12 }}>v.{vA.sha} → v.{vB.sha}</span>
              {a === b && <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>· same version — pick two to compare</span>}
            </div>
            {a === b
              ? <p style={{ fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.7, margin: 0 }}>{vB.text}</p>
              : <DiffView from={vA.text} to={vB.text} />}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { diffWords, diffStats, DiffView, VersionBadge, VersionHistory });
