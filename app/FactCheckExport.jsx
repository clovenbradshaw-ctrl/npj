/* FactCheckExport.jsx — the "Outstanding fact checks" panel.

   Stripped down by design: a plain bullet list of the bare propositions still
   needing a source, in a form you can copy straight into an email or a text and
   have it read clean. The propositions come from eoreader4 (app/propositions.js),
   assembled by the GroundingWorkspace; the shaping is app/fact-check-export.js
   (window.NpjFactCheck). While the engine parses we show a brief loading state.

   Props: { payload, loading, onClose }. */
function fcClean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

function FactCheckExport({ payload, loading, onClose }) {
  const FC = window.NpjFactCheck;
  const [copied, setCopied] = useState(false);
  const text = React.useMemo(() => (payload && FC) ? FC.toText(payload) : "", [payload, FC]);
  const list = React.useMemo(() => (payload && FC) ? FC.bullets(payload) : [], [payload, FC]);

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  };
  const download = () => { try { if (FC) FC.download(payload); } catch (e) {} };

  const eyebrow = { fontFamily: "var(--mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)" };

  return (
    <div onClick={onClose} className="fade-in" role="dialog" aria-modal="true" aria-label="Outstanding fact checks"
      style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 6100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }}>
      <div onClick={(e) => e.stopPropagation()} className="np-scroll"
        style={{ width: "min(640px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>

        {/* header */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <I.shield style={{ fontSize: 17, color: "var(--yellow)" }} />
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>OUTSTANDING FACT CHECKS</span>
          <span style={{ flex: 1 }} />
          {payload && !loading && <span className="np-mono" style={{ fontSize: 11, color: "var(--paper)", opacity: .8 }}>{list.length + (list.length === 1 ? " claim" : " claims")}</span>}
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        {(!payload || loading) ? (
          <div style={{ padding: "30px 18px", display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
            <span className="boot-spinner" style={{ width: 18, height: 18, border: "3px solid var(--rule, rgba(22,20,13,.16))", borderTopColor: "var(--ink)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
            <span className="np-mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>Reading the draft into propositions…</span>
          </div>
        ) : list.length === 0 ? (
          <div style={{ padding: "22px 18px 26px" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.55, margin: 0 }}>
              <strong>Nothing to verify.</strong> Every claim in this draft is grounded in a source or honestly owned — the publish gate is open.
            </p>
          </div>
        ) : (
          <div style={{ padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, margin: 0, color: "var(--ink-soft)" }}>
              The claims below still need a source. Copy the list into an email or a message and send it to whoever can help check them.
            </p>

            <button onClick={copy} className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, padding: "12px 16px", textTransform: "uppercase", letterSpacing: ".03em" }}>
              <I.copy style={{ fontSize: 17 }} /> {copied ? "Copied — paste it anywhere" : "Copy the list"}
            </button>

            {/* the list, exactly as it copies */}
            <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "12px 16px" }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                Outstanding fact checks{fcClean(payload.title) ? " — " + fcClean(payload.title) : ""}
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55 }}>
                {list.map((t, i) => <li key={i} style={{ marginBottom: 5 }}>{t}</li>)}
              </ul>
            </div>

            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={download} className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <I.doc style={{ fontSize: 14 }} /> Download .txt
              </button>
              <span className="np-mono" style={{ ...eyebrow, textTransform: "none", letterSpacing: 0 }}>Propositions parsed by eoreader4</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.FactCheckExport = FactCheckExport;
