/* FactCheckExport.jsx — the grounding workspace's "Export for fact-check" panel.

   The work is in app/fact-check-export.js (window.NpjFactCheck). This is the
   surface: a one-click copy of the worksheet (markdown), a .md and a .csv
   download, toggles for the context paragraph / the conflicts / the
   already-consulted sources, and a live preview.

   The payload is a snapshot the GroundingWorkspace hands us: every claim that
   still blocks the gate (⊥ needs a source, ¬ sources disagree), each with its
   sentence, the surrounding paragraph and its stable ref. Sharing that lets
   someone who CAN'T open the draft still help — they find the source, the author
   pins it. Nothing here grounds a claim or decides a verdict; it just packages
   the open questions. */
function FCToggle({ on, set, label, hint }) {
  return (
    <button onClick={() => set(!on)} aria-pressed={on} style={{ display: "flex", alignItems: "flex-start", gap: 9, textAlign: "left",
      border: "1.5px solid var(--ink)", background: on ? "var(--yellow)" : "var(--card)", padding: "9px 11px", cursor: "pointer", flex: "1 1 200px" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1, marginTop: 1 }}>{on ? "☑" : "☐"}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, display: "block" }}>{label}</span>
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>{hint}</span>
      </span>
    </button>
  );
}

function FactCheckExport({ payload, onClose }) {
  const FC = window.NpjFactCheck;
  const [context, setContext] = useState(true);
  const [conflicts, setConflicts] = useState(true);
  const [consulted, setConsulted] = useState(true);
  const [copied, setCopied] = useState(null); // "md" | "csv" | "file" | "csvfile" | "fail"
  const opts = { context, conflicts, consulted };

  const preview = React.useMemo(
    () => (payload && FC) ? FC.toMarkdown(payload, opts) : "",
    [payload, FC, context, conflicts, consulted]);
  const sum = React.useMemo(
    () => (payload && FC) ? FC.summary(payload, opts) : { needs: 0, conflict: 0, total: 0 },
    [payload, FC, conflicts]);
  const hasConflicts = React.useMemo(
    () => !!(payload && (payload.items || []).some(it => it.status === "conflict")),
    [payload]);

  const flash = (key) => { setCopied(key); setTimeout(() => setCopied(c => (c === key ? null : c)), 1600); };
  if (!payload || !FC) return null;

  const copyText = (text, key) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash(key)).catch(() => flash("fail"));
    else flash("fail");
  };
  const downloadMd = () => { try { FC.download(payload, opts); flash("file"); } catch (e) {} };
  const downloadCsv = () => { try { FC.downloadCsv(payload, opts); flash("csvfile"); } catch (e) {} };

  const eyebrow = { fontFamily: "var(--mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)" };
  const empty = sum.total === 0;
  const tally = empty ? "Nothing to check" :
    (sum.needs + " need a source" + (sum.conflict ? " · " + sum.conflict + " conflict" : ""));

  return (
    <div onClick={onClose} className="fade-in" role="dialog" aria-modal="true" aria-label="Export for fact-check"
      style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 6100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }}>
      <div onClick={(e) => e.stopPropagation()} className="np-scroll"
        style={{ width: "min(720px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>

        {/* header */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <I.shield style={{ fontSize: 17, color: "var(--yellow)" }} />
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EXPORT FOR FACT-CHECK</span>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 11, color: "var(--paper)", opacity: .8 }}>{tally}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        {empty ? (
          <div style={{ padding: "22px 18px 26px" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.55, color: "var(--ink)", margin: 0 }}>
              <strong>Every claim is grounded or owned.</strong> There's nothing here that needs a second pair of eyes — the publish gate is open. Come back if a new sentence lands unsourced.
            </p>
          </div>
        ) : (
          <div style={{ padding: "16px 18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink)", margin: 0 }}>
              Hand this to anyone who can help verify the open claims — they don't need access to the draft. Each claim ships with its sentence, the surrounding paragraph for context, and a stable <strong>ref</strong> so a returned source pins straight back. <strong>Copy the worksheet</strong> into an email or a doc, or share the <strong>.csv</strong> as a sheet a group can split.
            </p>

            {/* the main action */}
            <button onClick={() => copyText(preview, "md")} className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, padding: "13px 16px", textTransform: "uppercase", letterSpacing: ".03em" }}>
              <I.copy style={{ fontSize: 17 }} />
              {copied === "md" ? "Copied — paste it anywhere" : copied === "fail" ? "Couldn't copy — select the preview below" : "Copy the worksheet"}
            </button>

            {/* what rides along */}
            <div>
              <div style={eyebrow}>What to include</div>
              <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                <FCToggle on={context} set={setContext} label="Context paragraph" hint="Show the sentence inside its paragraph so a checker reads the claim in context, not bare." />
                {hasConflicts && <FCToggle on={conflicts} set={setConflicts} label="Conflicts too" hint="Include the claims where two pinned sources disagree — ask which is right." />}
                <FCToggle on={consulted} set={setConsulted} label="Sources already read" hint="List the sources already in the draft, so nobody re-checks what's been read." />
              </div>
            </div>

            {/* save a file */}
            <div>
              <div style={eyebrow}>Save or copy a file</div>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginTop: 7 }}>
                <button onClick={downloadMd} className="btn" title="A markdown worksheet — open it in any editor and reply under each claim."
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--yellow)", fontWeight: 700 }}>
                  <I.doc style={{ fontSize: 14 }} /> {copied === "file" ? "Downloaded!" : "Download .md"}
                </button>
                <button onClick={downloadCsv} className="btn" title="A spreadsheet — one claim per row, blank columns for the verdict, source and quote. Open in Sheets/Excel and split the list."
                  style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <I.data style={{ fontSize: 14 }} /> {copied === "csvfile" ? "Downloaded!" : "Download .csv"}
                </button>
                <button onClick={() => copyText(FC.toCsv(payload, opts), "csv")} className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <I.copy style={{ fontSize: 14 }} /> {copied === "csv" ? "Copied!" : "Copy as CSV"}
                </button>
              </div>
              <span className="np-mono" style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
                When a source comes back, open the claim's <strong>+ Cite</strong>, grab the words in the source, and the ref turns ⊤ grounded. The verdicts are theirs to fill — nothing here decides a claim.
              </span>
            </div>

            {/* preview */}
            <div>
              <div style={eyebrow}>Worksheet preview</div>
              <textarea readOnly value={preview} spellCheck={false}
                onFocus={(e) => e.target.select()}
                className="np-mono np-scroll"
                style={{ width: "100%", height: 240, marginTop: 7, resize: "vertical", fontSize: 12, lineHeight: 1.5,
                  border: "1.5px solid var(--ink)", background: "var(--card)", color: "var(--ink)", padding: "10px 12px", boxSizing: "border-box" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.FactCheckExport = FactCheckExport;
