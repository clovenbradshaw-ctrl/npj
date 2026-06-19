/* NPJ suggestion rail — EVA deposits against claims */

const STATUS_META = {
  proposed: { cls: "chip-proposed", label: "Proposed", dot: "#6b6b6b" },
  review:   { cls: "chip-review",   label: "Under review", dot: "var(--review)" },
  accepted: { cls: "chip-accepted", label: "Accepted", dot: "var(--verified)" },
  rejected: { cls: "chip-rejected", label: "Rejected", dot: "var(--reject)" }
};

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.proposed;
  return <span className={"chip " + m.cls}><span className="dot" style={{ background: m.dot }} /> {m.label}</span>;
}

/* word-level diff between current claim text and proposed */
function DiffText({ before, after }) {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
  // simple LCS-ish: mark trailing additions; good enough for display
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const common1 = b.slice(0, i).join("");
  const mid = b.slice(i, b.length - j).join("");
  const removed = a.slice(i, a.length - j).join("");
  const common2 = b.slice(b.length - j).join("");
  return (
    <span style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5 }}>
      {common1}
      {removed && <span style={{ background: "#f4dcd6", textDecoration: "line-through", textDecorationColor: "var(--reject)", color: "var(--reject)" }}>{removed}</span>}
      {mid && <span style={{ background: "#d9efe2", color: "var(--verified)", fontWeight: 500 }}>{mid}</span>}
      {common2}
    </span>
  );
}

function EoEvent({ s }) {
  const [open, setOpen] = useState(false);
  const ev = window.NPJ.eoEvent(s);
  const resGlyph = ev.resolves ? window.NPJ.EO.glyph(ev.resolves) : null;
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed var(--rule-strong)", paddingTop: 8 }}>
      <button onClick={() => setOpen(o => !o)} className="np-mono" style={{ background: "none", border: 0, padding: 0,
        fontSize: 10.5, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 5, letterSpacing: ".02em" }}>
        <span style={{ fontSize: 13 }}>⊨</span> {open ? "hide" : "view"} EO event <span style={{ opacity: .6, display: "inline-flex" }}>{open ? <I.caretDown /> : <I.caretRight />}</span>
      </button>
      {open && (
        <pre className="np-mono fade-in" style={{ margin: "8px 0 0", padding: "9px 10px", background: "var(--ink)", color: "#e9e4d4",
          fontSize: 10.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowX: "auto" }}>
<span style={{ color: "var(--yellow)" }}>⊨ EVA</span>  <span style={{ opacity: .6 }}>deposit against a site</span>{"\n"}
<span style={{ opacity: .6 }}>target </span>{ev.target}{"\n"}
<span style={{ opacity: .6 }}>operand</span> {ev.operand}{"\n"}
<span style={{ opacity: .6 }}>by     </span>{s.author}  <span style={{ opacity: .6 }}>ts</span> {s.ts}{"\n"}
<span style={{ opacity: .6 }}>sidecar</span> op_code=EVA target_path={ev.target_path}{ev.resolves ? "\n" : ""}
{ev.resolves && <span><span style={{ opacity: .6 }}>resolve</span> <span style={{ color: ev.resolves === "REC" ? "#7fd8a6" : "#d8b67f" }}>{resGlyph} {ev.resolves}</span> <span style={{ opacity: .6 }}>{ev.resolves === "REC" ? "folds into the frame → accepted" : "non-transformation → claim stands"}</span></span>}
        </pre>
      )}
    </div>
  );
}

function SuggestionCard({ s, claimText, isEditor, onVote, onResolve }) {
  const m = STATUS_META[s.status];
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 12,
      opacity: s.stale && s.status !== "rejected" ? .92 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderBottom: "1px solid var(--rule)", flexWrap: "wrap" }}>
        <StatusChip status={s.status} />
        {s.stale && <span className="chip chip-stale" title={"Made against " + s.base_sha + ", article has since advanced"}>⚠ Stale · {s.base_sha}</span>}
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{shortDate(s.ts)}</span>
      </div>

      <div style={{ padding: "10px 11px" }}>
        <DiffText before={claimText} after={s.proposed} />

        <div style={{ marginTop: 10, paddingLeft: 9, borderLeft: "2px solid var(--rule)", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Rationale</span>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", marginTop: 2 }}>{s.rationale}</div>
        </div>

        {s.resolution && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--reject)", fontFamily: "var(--cond)" }}>
            <I.x style={{ fontSize: 12, verticalAlign: "-1px" }} /> {s.resolution}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
          <Handle mxid={s.author} showName />
          <button className="vote" data-on={s.voted ? "1" : "0"} onClick={() => onVote(s.id)}>
            <I.up style={{ fontSize: 13 }} /> {s.votes}
          </button>
        </div>

        {isEditor && (s.status === "proposed" || s.status === "review") && (
          <div style={{ display: "flex", gap: 7, marginTop: 11, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
            <button className="btn btn-sm" style={{ flex: 1, borderColor: "var(--verified)", color: "var(--verified)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }} onClick={() => onResolve(s.id, "accepted")}><I.check style={{ fontSize: 13 }} /> Accept → commit</button>
            {s.status === "proposed"
              ? <button className="btn btn-sm" style={{ borderColor: "var(--review)", color: "var(--review)" }} onClick={() => onResolve(s.id, "review")}>Review</button>
              : null}
            <button className="btn btn-sm" style={{ borderColor: "var(--reject)", color: "var(--reject)", display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => onResolve(s.id, "rejected")}><I.x style={{ fontSize: 13 }} /></button>
          </div>
        )}

        <EoEvent s={s} />
      </div>
    </div>
  );
}

/* compose a new suggestion against a claim */
function Compose({ claim, onSubmit, onCancel, me }) {
  const [proposed, setProposed] = useState(claim.text);
  const [rationale, setRationale] = useState("");
  const valid = rationale.trim().length >= 8 && proposed.trim() !== claim.text.trim();
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 14, boxShadow: "5px 5px 0 rgba(22,20,13,.14)" }}>
      <div style={{ background: "var(--yellow)", borderBottom: "1.5px solid var(--ink)", padding: "8px 11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 16 }}>SUGGEST AN EDIT</span>
        <button onClick={onCancel} style={{ background: "none", border: 0, fontSize: 15 }}><I.x /></button>
      </div>
      <div style={{ padding: "11px" }}>
        <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 5 }}>Editing this claim</div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, padding: "7px 9px", background: "var(--paper-2)", borderLeft: "3px solid var(--yellow-deep)", marginBottom: 11 }}>{claim.text}</div>

        <label className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Proposed text</label>
        <textarea value={proposed} onChange={e => setProposed(e.target.value)} rows={3}
          style={{ width: "100%", marginTop: 4, marginBottom: 11, fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45,
            padding: "8px 9px", border: "1.5px solid var(--ink)", background: "var(--paper)", resize: "vertical" }} />

        <label className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Rationale <span style={{ color: "var(--reject)" }}>· required</span></label>
        <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={2} placeholder="Why should this change? Cite a source if you can."
          style={{ width: "100%", marginTop: 4, fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4,
            padding: "8px 9px", border: "1.5px solid var(--ink)", background: "var(--paper)", resize: "vertical" }} />

        {!valid && (
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.4 }}>
            {proposed.trim() === claim.text.trim()
              ? "Edit the proposed text above so it differs from the original."
              : "Add a rationale of at least 8 characters to deposit."}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>as {me}</span>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={!valid} style={{ opacity: valid ? 1 : .45, cursor: valid ? "pointer" : "not-allowed" }}
              onClick={() => onSubmit({ proposed: proposed.trim(), rationale: rationale.trim() })}>Deposit suggestion</button>
          </div>
        </div>
        <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>
          → appended to suggestions.jsonl as an EVA event, anchored to base_sha a3f9c1e.
        </div>
      </div>
    </div>
  );
}

function SuggestionRail({ open, onClose, list, claimById, filter, setFilter, isEditor, setIsEditor,
                         onVote, onResolve, composeClaim, onCompose, onSubmit, onCancelCompose, me }) {
  const TRUST_RANK = { editor: 3, preferred: 2, open: 1 };
  const filtered = list.filter(s => {
    if (filter === "editor") return s.trust === "editor";
    if (filter === "preferred") return TRUST_RANK[s.trust] >= 2;
    return true;
  });
  const active = filtered.filter(s => s.status === "proposed" || s.status === "review");
  const resolved = filtered.filter(s => s.status === "accepted" || s.status === "rejected");

  return (
    <aside className="np-scroll" style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: "min(408px, 92vw)",
      background: "var(--paper)", borderLeft: "2.5px solid var(--ink)", boxShadow: "-12px 0 30px rgba(22,20,13,.16)",
      transform: open ? "none" : "translateX(101%)", transition: "transform .28s cubic-bezier(.4,0,.1,1)",
      zIndex: 3000, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "sticky", top: 0, background: "var(--ink)", color: "var(--paper)", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <I.chat style={{ fontSize: 20, color: "var(--yellow)" }} />
            <span style={{ fontFamily: "var(--display)", fontSize: 22, color: "var(--yellow)" }}>SUGGESTIONS</span>
            <span className="np-mono" style={{ fontSize: 12, opacity: .7 }}>{list.length}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18 }}><I.x /></button>
        </div>
        {/* trust filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 12px", flexWrap: "wrap" }}>
          <span className="np-eyebrow" style={{ opacity: .7, display: "inline-flex", alignItems: "center", gap: 5 }}><I.filter style={{ fontSize: 14 }} /> View</span>
          {[["all", "Everyone"], ["preferred", "Preferred +"], ["editor", "Editors only"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className="np-cond" style={{ fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".05em",
              padding: "3px 9px", border: "1px solid " + (filter === k ? "var(--yellow)" : "rgba(255,255,255,.25)"),
              background: filter === k ? "var(--yellow)" : "transparent", color: filter === k ? "var(--ink)" : "var(--paper)", fontWeight: 600 }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 16px 40px", flex: 1 }}>
        {composeClaim && (
          <Compose claim={composeClaim} me={me} onSubmit={onSubmit} onCancel={onCancelCompose} />
        )}

        {!composeClaim && (
          <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "12px 13px", marginBottom: 16, display: "flex", gap: 11, alignItems: "center" }}>
            <I.plus style={{ fontSize: 22, color: "var(--ink-soft)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, lineHeight: 1.1 }}>See something off?</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Click any highlighted claim, then “suggest edit.”</div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 10px" }}>
          <span className="np-eyebrow">Open · {active.length}</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--cond)", fontSize: 12.5, color: "var(--ink-soft)", cursor: "pointer" }}>
            <input type="checkbox" checked={isEditor} onChange={e => setIsEditor(e.target.checked)} />
            editor mode
          </label>
        </div>

        {active.map(s => (
          <div key={s.id}>
            <ClaimContext claim={claimById[s.claimId]} />
            <SuggestionCard s={s} claimText={claimById[s.claimId] ? claimById[s.claimId].text : ""} isEditor={isEditor} onVote={onVote} onResolve={onResolve} />
          </div>
        ))}
        {active.length === 0 && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", fontSize: 14, padding: "8px 0 18px" }}>No open suggestions in this view.</div>}

        {resolved.length > 0 && <>
          <div className="np-rule-thin" style={{ margin: "18px 0 12px" }} />
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Resolved · {resolved.length}</span>
          <div style={{ marginTop: 10 }}>
            {resolved.map(s => (
              <div key={s.id}>
                <ClaimContext claim={claimById[s.claimId]} />
                <SuggestionCard s={s} claimText={claimById[s.claimId] ? claimById[s.claimId].text : ""} isEditor={isEditor} onVote={onVote} onResolve={onResolve} />
              </div>
            ))}
          </div>
        </>}
      </div>
    </aside>
  );
}

function ClaimContext({ claim }) {
  if (!claim) return null;
  return (
    <div className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
      <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{claim.num}</span> on “{claim.text.slice(0, 42)}{claim.text.length > 42 ? "…" : ""}”
    </div>
  );
}

Object.assign(window, { SuggestionRail, StatusChip, STATUS_META });
