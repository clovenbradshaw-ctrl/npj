/* FactCheckExport.jsx — the "Outstanding fact checks" panel.

   Plain, paste-anywhere: one line per unsourced claim, each naming the TYPE of
   evidence that would ground it (the negative space), in a form that drops clean
   into an email or a text. The evidence types are mechanical by default
   (app/grounding/evidence-needs.js, instant); a "Sharpen with local model" button upgrades
   them through a local LLM when one is reachable (Ollama / window.NPJ_OLLAMA_*),
   falling back silently to the mechanical read. Shaping is app/export/fact-check-export.js
   (window.NpjFactCheck).

   Props: { payload, onClose }.  payload = { title, items:[{sid,status,claim,need}] } */
function FactCheckExport({ payload, onClose }) {
  const FC = window.NpjFactCheck, EV = window.NpjEvidence;
  const [snap] = useState(() => payload || { title: "", items: [] });   // freeze the claims at open
  const items = snap.items || [];
  const claims = React.useMemo(() => items.map(it => it.claim), [snap]);
  const [needs, setNeeds] = useState(() => items.map(it => it.need || ""));
  const [busy, setBusy] = useState(false);
  const [sharpened, setSharpened] = useState(false);
  const [available, setAvailable] = useState(false);
  const [note, setNote] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { let a = true; if (EV && EV.llmAvailable) EV.llmAvailable().then(v => { if (a) setAvailable(!!v); }).catch(() => {}); return () => { a = false; }; }, []); // eslint-disable-line

  const current = React.useMemo(() => ({ title: snap.title, items: items.map((it, i) => Object.assign({}, it, { need: needs[i] })) }), [snap, needs]);
  const text = (FC && FC.toText) ? FC.toText(current) : "";

  const sharpen = async () => {
    if (!EV || busy) return;
    setBusy(true); setNote(null);
    try {
      const ok = await EV.llmAvailable();
      if (!ok) { setNote("No local model reachable — start Ollama (or set window.NPJ_OLLAMA_URL) and retry. The mechanical read is shown meanwhile."); setBusy(false); return; }
      const ns = await EV.needMany(claims);
      if (ns && ns.length === claims.length) { setNeeds(ns); setSharpened(true); }
    } catch (e) {}
    setBusy(false);
  };
  const copy = () => { if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {}); };
  const download = () => { try { if (FC) FC.download(current); } catch (e) {} };

  const eyebrow = { fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-soft)" };

  return (
    <div onClick={onClose} className="fade-in" role="dialog" aria-modal="true" aria-label="Outstanding fact checks"
      style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 6100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }}>
      <div onClick={(e) => e.stopPropagation()} className="np-scroll"
        style={{ width: "min(680px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>

        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <I.shield style={{ fontSize: 17, color: "var(--yellow)" }} />
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>OUTSTANDING FACT CHECKS</span>
          <span style={{ flex: 1 }} />
          {items.length > 0 && <span className="np-mono" style={{ fontSize: 11, color: "var(--paper)", opacity: .8 }}>{items.length + (items.length === 1 ? " claim" : " claims")}</span>}
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: "22px 18px 26px" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.55, margin: 0 }}>
              <strong>Nothing to verify.</strong> Every claim in this draft is grounded in a source or honestly owned — the publish gate is open.
            </p>
          </div>
        ) : (
          <div style={{ padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, margin: 0, color: "var(--ink-soft)" }}>
              One line per unsourced claim, with the kind of evidence that would settle it. Copy the list into an email or a message and send it to whoever can help.
            </p>

            <button onClick={copy} className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, padding: "12px 16px", textTransform: "uppercase", letterSpacing: ".03em" }}>
              <I.copy style={{ fontSize: 17 }} /> {copied ? "Copied — paste it anywhere" : "Copy the list"}
            </button>

            {/* the list, exactly as it copies */}
            <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "12px 16px" }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                Outstanding fact checks{fcClean(snap.title) ? " — " + fcClean(snap.title) : ""}
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5 }}>
                {items.map((it, i) => (
                  <li key={it.sid || i} style={{ marginBottom: 6 }}>
                    {fcClean(it.claim)}
                    <span style={{ color: "var(--ink-soft)" }}> → {fcClean(needs[i]) || "a source that confirms this"}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={download} className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <I.doc style={{ fontSize: 14 }} /> Download .txt
              </button>
              <button onClick={sharpen} disabled={busy} className="btn btn-ghost" title="Use a local LLM (Ollama) to name a sharper evidence type per claim — falls back to the mechanical read"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: busy ? .7 : 1 }}>
                {busy
                  ? <React.Fragment><span style={{ width: 13, height: 13, border: "2px solid var(--rule, rgba(22,20,13,.2))", borderTopColor: "var(--ink)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} /> Asking the local model…</React.Fragment>
                  : <React.Fragment><I.sparkle style={{ fontSize: 14 }} /> {sharpened ? "Re-sharpen with local model" : "Sharpen with local model"}</React.Fragment>}
              </button>
              <span style={eyebrow}>{sharpened ? "Sharpened by a local model" : available ? "Local model available" : "Mechanical read · no model"}</span>
            </div>
            {note && <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.45, borderLeft: "2px solid var(--ink)", paddingLeft: 9 }}>{note}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function fcClean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

window.FactCheckExport = FactCheckExport;
