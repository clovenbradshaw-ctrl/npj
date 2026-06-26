/* NPJ suggestion rail — span-anchored reader feedback, reviewed like a pull
   request (proposal against a base → read in context → merge or decline), but
   without GitHub's UX. A suggestion carries the exact words it would change; a
   comment is a discussion pinned to a span. Editors MERGE (which commits a real
   REC to the record) or decline; everyone can 👍 and reply. Persistence is
   window.NpjFeedback (EVA events in the article's folder + a local mirror). */

const STATUS_META = {
  proposed: { cls: "chip-proposed", label: "Open", dot: "#6b6b6b" },
  review:   { cls: "chip-review",   label: "Under review", dot: "var(--review)" },
  accepted: { cls: "chip-accepted", label: "Accepted", dot: "var(--verified)" },
  rejected: { cls: "chip-rejected", label: "Declined", dot: "var(--reject)" }
};

function StatusChip({ status, merged }) {
  const m = STATUS_META[status] || STATUS_META.proposed;
  return <span className={"chip " + m.cls}><span className="dot" style={{ background: m.dot }} /> {merged ? "Merged" : m.label}</span>;
}

/* word-level diff between current span text and the proposed text */
function DiffText({ before, after }) {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
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

/* the span this feedback is pinned to — its quote, with a jump-to-text action.
   A whole-article contribution isn't pinned to any words, so it reads as a
   plain "on the whole article" banner instead of a jump-to-span button. */
function AnchorLine({ s, claim, onShow }) {
  if (s.scope === "article") {
    return (
      <div className="np-mono" style={{ display: "flex", gap: 6, alignItems: "center", background: "var(--paper-2)", borderLeft: "3px solid var(--yellow-deep)", padding: "6px 9px", marginBottom: 9, fontSize: 11, color: "var(--ink-soft)" }}>
        <I.doc style={{ fontSize: 13 }} /> On the whole article
      </div>
    );
  }
  const quote = (claim && claim.text) || (s.anchor && s.anchor.quote) || "";
  if (!quote) return null;
  return (
    <button onClick={() => onShow && onShow(s)} title="Show this span in the article"
      className="np-mono" style={{ display: "flex", gap: 6, alignItems: "baseline", width: "100%", textAlign: "left",
        background: "var(--paper-2)", border: 0, borderLeft: "3px solid var(--yellow-deep)", cursor: "pointer",
        padding: "6px 9px", marginBottom: 9, fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.35 }}>
      <span style={{ flexShrink: 0 }}>{claim ? claim.num : "¶"}</span>
      <span style={{ fontFamily: "var(--serif)", fontSize: 12.5, color: "var(--ink)" }}>“{quote.slice(0, 90)}{quote.length > 90 ? "…" : ""}”</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: "var(--data)" }}>show ↗</span>
    </button>
  );
}

function Replies({ s, me, onReply }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState((s.replies || []).length > 0);
  const n = (s.replies || []).length;
  return (
    <div style={{ marginTop: 9 }}>
      <button onClick={() => setOpen(o => !o)} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer",
        fontSize: 10.5, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 5 }}>
        <I.chat style={{ fontSize: 12 }} /> {n ? n + (n === 1 ? " reply" : " replies") : "reply"} <span style={{ opacity: .6 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="fade-in" style={{ marginTop: 7, paddingLeft: 9, borderLeft: "1px solid var(--rule)" }}>
          {(s.replies || []).map((r, i) => (
            <div key={i} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Handle mxid={r.author} size={14} showName />
                <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>{r.ts}</span>
              </div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.4, marginTop: 2 }}>{r.text}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder={"Reply as " + me}
              onKeyDown={e => { if (e.key === "Enter" && text.trim()) { onReply(s.id, text.trim()); setText(""); } }}
              style={{ flex: 1, minWidth: 0, border: "1px solid var(--rule-strong)", background: "var(--paper)", fontFamily: "var(--serif)", fontSize: 12.5, padding: "5px 7px", outline: "none" }} />
            <button className="btn btn-sm" disabled={!text.trim()} style={{ opacity: text.trim() ? 1 : .5 }}
              onClick={() => { if (text.trim()) { onReply(s.id, text.trim()); setText(""); } }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s, claim, canReview, onVote, onReply, onResolve, onMerge, onShow, onPreviewBranch, canPreview, me }) {
  const [busy, setBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState(null);
  const before = (claim && claim.text) || (s.anchor && s.anchor.quote) || "";
  const open = s.status === "proposed" || s.status === "review";
  // a mergeable BRANCH: a span suggestion (proposed words) or a whole-article fork
  // (an edited copy). Comments and note-only article contributions aren't branches.
  const isFork = s.scope === "article" && s.forkBody && s.forkBody.length;
  const isBranch = (s.scope !== "article" && s.kind === "suggestion") || isFork;
  const doMerge = async () => {
    setBusy(true); setMergeErr(null);
    const r = (await onMerge(s)) || {};
    setBusy(false);
    if (r.ok) return;
    if (r.conflict) setMergeErr("Can't merge cleanly — these exact words aren't in the current version anymore (the base moved). Open Edit and apply it by hand, or ignore.");
    else if (r.status === 401 || r.status === 403) setMergeErr("Rejected (" + r.status + ") — your Matrix account can't commit edits to this article.");
    else setMergeErr("Couldn't commit the merge: " + (r.error || ("HTTP " + (r.status || "?"))) + ". Nothing changed.");
  };
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 12,
      opacity: s.stale && open ? .94 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderBottom: "1px solid var(--rule)", flexWrap: "wrap" }}>
        <span className="chip" style={{ background: isFork ? "var(--data)" : s.scope === "article" ? "var(--paper-2)" : s.kind === "comment" ? "var(--paper-2)" : "var(--yellow)", color: isFork ? "#fff" : undefined, borderColor: "var(--ink)" }}>
          {isFork ? "⑂ Fork" : s.scope === "article" ? "📄 On the article" : s.kind === "comment" ? "💬 Comment" : "✎ Branch"}
        </span>
        <StatusChip status={s.status} merged={s.merged} />
        <span className="chip" title={s.visibility === "private" ? "Private — only the article's authors can see this branch" : "Public — anyone can preview this branch"}
          style={{ background: "transparent", borderColor: "var(--rule-strong)", color: "var(--ink-soft)" }}>
          {s.visibility === "private" ? "🔒 Private" : "🌐 Public"}
        </span>
        {s.stale && <span className="chip chip-stale" title={"Proposed against v." + s.base_sha + " — the article has since advanced"}>⚠ Stale</span>}
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{shortDate(s.ts)}</span>
      </div>

      <div style={{ padding: "10px 11px" }}>
        <AnchorLine s={s} claim={claim} onShow={onShow} />

        {s.kind === "suggestion" && s.scope !== "article" && <DiffText before={before} after={s.proposed} />}
        {isFork && <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.4 }}>An edited copy of the whole article — toggle it on to read the fork before it's merged.</div>}

        {s.rationale && (
          <div style={{ marginTop: 10, paddingLeft: 9, borderLeft: "2px solid var(--rule)", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>{s.scope === "article" ? "Contribution" : s.kind === "comment" ? "Note" : "Rationale"}</span>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", marginTop: 2, color: "var(--ink)" }}>{s.rationale}</div>
          </div>
        )}

        {(s.resolution || s.merged) && (
          <div style={{ marginTop: 8, fontSize: 12, color: s.status === "rejected" ? "var(--reject)" : "var(--verified)", fontFamily: "var(--cond)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontFamily: "var(--mono)" }}>{s.merged ? "⊛" : s.status === "rejected" ? "✕" : "✓"}</span>
            {s.resolution || (s.merged ? "Merged into the record" : "")}{s.resolvedBy ? " · " + s.resolvedBy : ""}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
          <Handle mxid={s.author} showName />
          <button className="vote" data-on={s.voted ? "1" : "0"} onClick={() => onVote(s.id)} title="Back this — weight for the editor">
            <I.up style={{ fontSize: 13 }} /> {s.votes}
          </button>
        </div>

        {(isBranch && canPreview && open) || s.roomId ? (
          <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
            {isBranch && canPreview && open && (
              <button className="btn btn-sm" onClick={() => onPreviewBranch && onPreviewBranch(s)} title="Read the article with this branch applied — before any merge"
                style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--data)", color: "#fff", borderColor: "var(--ink)" }}>
                <I.eye style={{ fontSize: 12 }} /> Toggle branch on
              </button>
            )}
            {s.roomId && (
              <a href={"https://matrix.to/#/" + s.roomId} target="_blank" rel="noopener" className="btn btn-sm"
                title="Open the merge-request discussion room" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
                <I.chat style={{ fontSize: 12 }} /> Discussion
              </a>
            )}
          </div>
        ) : null}

        <Replies s={s} me={me} onReply={onReply} />

        {mergeErr && (
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)", border: "1px solid var(--reject)", padding: "7px 9px", marginTop: 10, lineHeight: 1.45 }}>
            {mergeErr}
          </div>
        )}

        {canReview && open && (
          <div style={{ display: "flex", gap: 7, marginTop: 11, borderTop: "1px solid var(--rule)", paddingTop: 10, flexWrap: "wrap" }}>
            {isBranch
              ? <button className="btn btn-sm" disabled={busy} style={{ flex: 1, minWidth: 130, background: "var(--verified)", color: "#fff", borderColor: "var(--verified)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy ? .7 : 1 }} onClick={doMerge}>
                  {busy ? <span style={{ width: 11, height: 11, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> : <span style={{ fontFamily: "var(--mono)" }}>⊛</span>}
                  {busy ? "Merging…" : "Merge branch"}
                </button>
              : <button className="btn btn-sm" style={{ flex: 1, minWidth: 110, borderColor: "var(--verified)", color: "var(--verified)" }} onClick={() => onResolve(s.id, "accepted")}><I.check style={{ fontSize: 13 }} /> Mark resolved</button>}
            {s.status === "proposed" && isBranch &&
              <button className="btn btn-sm" style={{ borderColor: "var(--review)", color: "var(--review)" }} onClick={() => onResolve(s.id, "review")}>Review</button>}
            <button className="btn btn-sm" style={{ borderColor: "var(--reject)", color: "var(--reject)", display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => onResolve(s.id, "rejected")} title="Ignore this branch — it stays on the record, just declined"><I.x style={{ fontSize: 13 }} /> Ignore</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* compose a new contribution. Two modes:
   - span:    pinned to selected words → a suggested edit (auto-mergeable) or a
              comment on that span.
   - article: a contribution on the whole piece — a written proposal/correction,
              like a PR description, that an editor reads and acts on. */
function Compose({ draft, onSubmit, onCancel, me, signedIn }) {
  const article = draft.scope === "article" || (draft.anchor && draft.anchor.scope === "article");
  const quote = draft.quote || "";
  const [kind, setKind] = useState(article ? "comment" : (draft.kind || "suggestion"));
  const [proposed, setProposed] = useState(quote);
  const [rationale, setRationale] = useState("");
  const [visibility, setVisibility] = useState("public"); // public = anyone can see/toggle the branch; private = only the article's authors
  const isSugg = !article && kind === "suggestion";
  const valid = isSugg
    ? (rationale.trim().length >= 4 && proposed.trim() !== quote.trim() && proposed.trim().length > 0)
    : rationale.trim().length >= (article ? 8 : 2);
  const submit = () => onSubmit({ kind, scope: article ? "article" : "span", anchor: draft.anchor, proposed: isSugg ? proposed.trim() : "", rationale: rationale.trim(), visibility });
  const submitLabel = article ? "Submit contribution" : isSugg ? "Propose edit" : "Post comment";
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 14, boxShadow: "5px 5px 0 rgba(22,20,13,.14)" }}>
      <div style={{ background: article ? "var(--data)" : "var(--yellow)", color: article ? "#fff" : "var(--ink)", borderBottom: "1.5px solid var(--ink)", padding: "8px 11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 16 }}>{article ? "CONTRIBUTE TO THE ARTICLE" : isSugg ? "SUGGEST AN EDIT" : "LEAVE A COMMENT"}</span>
        <button onClick={onCancel} style={{ background: "none", border: 0, fontSize: 15, color: "inherit" }}><I.x /></button>
      </div>
      <div style={{ padding: "11px" }}>
        {!article && (
          <div style={{ display: "flex", gap: 0, marginBottom: 11, border: "1.5px solid var(--ink)" }}>
            {[["suggestion", "✎ Suggest edit"], ["comment", "💬 Comment"]].map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)} className="np-cond" style={{ flex: 1, padding: "6px", border: 0, cursor: "pointer",
                borderRight: k === "suggestion" ? "1.5px solid var(--ink)" : 0, fontWeight: 700, fontSize: 13,
                background: kind === k ? "var(--ink)" : "transparent", color: kind === k ? "var(--yellow)" : "var(--ink)" }}>{l}</button>
            ))}
          </div>
        )}

        {article ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--cond)", fontSize: 13, color: "var(--ink-soft)", padding: "7px 9px", background: "var(--paper-2)", borderLeft: "3px solid var(--yellow-deep)", marginBottom: 11 }}>
            <I.doc style={{ fontSize: 14 }} /> A proposal on the whole article — an editor reviews and applies it.
          </div>
        ) : (<>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 5 }}>On this span</div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, padding: "7px 9px", background: "var(--paper-2)", borderLeft: "3px solid var(--yellow-deep)", marginBottom: 11 }}>{quote || "(the selected words)"}</div>
        </>)}

        {isSugg && (<React.Fragment>
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Proposed text</label>
          <textarea value={proposed} onChange={e => setProposed(e.target.value)} rows={3}
            style={{ width: "100%", marginTop: 4, marginBottom: 11, fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45,
              padding: "8px 9px", border: "1.5px solid var(--ink)", background: "var(--paper)", resize: "vertical", boxSizing: "border-box" }} />
        </React.Fragment>)}

        <label className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>{article ? "Your contribution" : isSugg ? "Rationale" : "Comment"} <span style={{ color: "var(--reject)" }}>· required</span></label>
        <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={article ? 4 : 2}
          placeholder={article ? "What would you change about this piece, and why? Cite a source if you can — corrections, missing context, a framing problem…" : isSugg ? "Why should this change? Cite a source if you can." : "What's off, or what would help?"}
          style={{ width: "100%", marginTop: 4, fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4,
            padding: "8px 9px", border: "1.5px solid var(--ink)", background: "var(--paper)", resize: "vertical", boxSizing: "border-box" }} />

        {!valid && (
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.4 }}>
            {isSugg && proposed.trim() === quote.trim() ? "Edit the proposed text so it differs from the original." : "Add a short reason to deposit."}
          </div>
        )}

        {/* visibility: a public branch anyone can see and toggle on; a private one
            only the article's authors (and you) can see */}
        <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "12px 0 5px" }}>Who can see this branch</div>
        <div style={{ display: "flex", gap: 0, border: "1.5px solid var(--ink)" }}>
          {[["public", "🌐 Public", "anyone can see & toggle it on"], ["private", "🔒 Private", "only the article's authors"]].map(([v, l, d]) => (
            <button key={v} onClick={() => setVisibility(v)} title={d} className="np-cond" style={{ flex: 1, padding: "6px 4px", border: 0, cursor: "pointer",
              borderRight: v === "public" ? "1.5px solid var(--ink)" : 0, fontWeight: 700, fontSize: 12.5,
              background: visibility === v ? "var(--ink)" : "transparent", color: visibility === v ? "var(--yellow)" : "var(--ink)" }}>{l}</button>
          ))}
        </div>
        <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 5, lineHeight: 1.4 }}>
          {visibility === "public" ? "Public — everyone reading can preview this branch before it's merged." : "Private — kept between you and the article's authors until they decide."}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{signedIn ? "as " + me : "you'll sign in next"}</span>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={!valid} style={{ opacity: valid ? 1 : .45, cursor: valid ? "pointer" : "not-allowed" }}
              onClick={submit}>{signedIn ? submitLabel : "Continue →"}</button>
          </div>
        </div>
        <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>
          → kept on the record as an EVA deposit in this article's folder. An editor reviews it{article ? " and applies it by hand." : " for merge."}
        </div>
      </div>
    </div>
  );
}

/* a compact MERGE-REQUEST TABLE — the same branches as the cards, one row each.
   "Another view of merge requests": span/kind, who, visibility, status, votes,
   and the same merge/preview actions an editor has on the card. */
function MergeRequestTable({ rows, claimOf, canReview, onMerge, onResolve, onPreviewBranch, canSee }) {
  if (!rows.length) return <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", fontSize: 14, padding: "8px 0 18px" }}>No merge requests in this view.</div>;
  const kindOf = (s) => (s.scope === "article" && s.forkBody && s.forkBody.length) ? "Fork" : s.scope === "article" ? "Note" : s.kind === "comment" ? "Comment" : "Branch";
  const spanOf = (s) => { const c = claimOf(s); const q = (c && c.text) || (s.anchor && s.anchor.quote) || (s.scope === "article" ? "whole article" : ""); return q.length > 38 ? q.slice(0, 38) + "…" : q; };
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", overflowX: "auto" }}>
      <table className="np-mr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
        <thead>
          <tr style={{ background: "var(--ink)", color: "var(--paper)", textAlign: "left" }}>
            {["", "Span", "From", "See", "Status", "▲", ""].map((h, i) => (
              <th key={i} className="np-mono" style={{ padding: "6px 8px", fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(s => {
            const open = s.status === "proposed" || s.status === "review";
            const isBranch = (s.scope !== "article" && s.kind === "suggestion") || (s.scope === "article" && s.forkBody && s.forkBody.length);
            return (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}><span className="np-mono" style={{ fontSize: 10 }}>{kindOf(s)}</span></td>
                <td style={{ padding: "6px 8px", fontFamily: "var(--serif)", color: "var(--ink)", maxWidth: 150 }}>{spanOf(s)}</td>
                <td style={{ padding: "6px 8px" }}><Handle mxid={s.author} size={14} /></td>
                <td style={{ padding: "6px 8px" }} title={s.visibility === "private" ? "Private" : "Public"}>{s.visibility === "private" ? "🔒" : "🌐"}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}><StatusChip status={s.status} merged={s.merged} /></td>
                <td style={{ padding: "6px 8px", textAlign: "right" }} className="np-mono">{s.votes}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap", textAlign: "right" }}>
                  {isBranch && open && canSee(s) && <button className="btn btn-sm btn-ghost" title="Toggle branch on" onClick={() => onPreviewBranch && onPreviewBranch(s)} style={{ padding: "2px 6px" }}><I.eye style={{ fontSize: 12 }} /></button>}
                  {canReview && open && isBranch && <button className="btn btn-sm" title="Merge branch" onClick={() => onMerge(s)} style={{ padding: "2px 6px", marginLeft: 4, color: "var(--verified)", borderColor: "var(--verified)" }}>⊛</button>}
                  {canReview && open && <button className="btn btn-sm" title="Ignore" onClick={() => onResolve(s.id, "rejected")} style={{ padding: "2px 6px", marginLeft: 4, color: "var(--reject)", borderColor: "var(--reject)" }}><I.x style={{ fontSize: 11 }} /></button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuggestionRail({ open, onClose, list, claimById, filter, setFilter, canReview,
                         onVote, onReply, onResolve, onMerge, onShow, onPreviewBranch, owners, composeDraft, onSubmit, onCancelCompose, me,
                         signedIn, onContributeArticle }) {
  const TRUST_RANK = { editor: 3, preferred: 2, open: 1 };
  const [viewMode, setViewMode] = useState("cards"); // cards | table
  // a private branch is hidden from anyone who isn't its author or an article author
  const canSee = (s) => !window.NpjFeedback || !window.NpjFeedback.canSee || window.NpjFeedback.canSee(s, me, owners || []);
  const filtered = list.filter(s => {
    if (!canSee(s)) return false;
    if (filter === "editor") return s.trust === "editor";
    if (filter === "preferred") return TRUST_RANK[s.trust] >= 2;
    return true;
  });
  const active = filtered.filter(s => s.status === "proposed" || s.status === "review");
  const resolved = filtered.filter(s => s.status === "accepted" || s.status === "rejected");
  const claimOf = (s) => s.claimId ? claimById[s.claimId] : null;

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
        {composeDraft && <Compose draft={composeDraft} me={me} signedIn={signedIn} onSubmit={onSubmit} onCancel={onCancelCompose} />}

        {!composeDraft && (
          <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "13px 13px 12px", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
              <I.plus style={{ fontSize: 22, color: "var(--ink-soft)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, lineHeight: 1.1 }}>See something off?</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Select any words in the story, then “Suggest edit” or “Comment.”</div>
              </div>
            </div>
            {onContributeArticle && (
              <button className="btn btn-sm" onClick={onContributeArticle} style={{ width: "100%", marginTop: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "var(--data)", color: "#fff", borderColor: "var(--ink)" }}>
                <span style={{ fontFamily: "var(--mono)" }}>⑂</span> Fork the whole article
              </button>
            )}
            {!signedIn && (
              <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4, textAlign: "center" }}>
                No account needed to start — you'll sign your contribution at the end.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 10px", gap: 8 }}>
          <span className="np-eyebrow">Open · {active.length}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "inline-flex", border: "1px solid var(--rule-strong)" }}>
              {[["cards", I.chat, "Cards"], ["table", I.data, "Table"]].map(([m, Ic, lbl]) => (
                <button key={m} onClick={() => setViewMode(m)} title={lbl + " view"} className="np-mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "3px 7px", border: 0, cursor: "pointer",
                  background: viewMode === m ? "var(--ink)" : "transparent", color: viewMode === m ? "var(--yellow)" : "var(--ink-soft)" }}><Ic style={{ fontSize: 12 }} /> {lbl}</button>
              ))}
            </div>
            {canReview
              ? <span className="np-mono" style={{ fontSize: 10.5, color: "var(--verified)", display: "inline-flex", alignItems: "center", gap: 5 }}><I.shield style={{ fontSize: 12 }} /> you can merge</span>
              : <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>editors merge</span>}
          </div>
        </div>

        {viewMode === "table" ? (
          <MergeRequestTable rows={active.concat(resolved)} claimOf={claimOf} canReview={canReview}
            onMerge={onMerge} onResolve={onResolve} onPreviewBranch={onPreviewBranch} canSee={canSee} />
        ) : (<>
          {active.map(s => (
            <SuggestionCard key={s.id} s={s} claim={claimOf(s)} canReview={canReview}
              onVote={onVote} onReply={onReply} onResolve={onResolve} onMerge={onMerge} onShow={onShow}
              onPreviewBranch={onPreviewBranch} canPreview={canSee(s)} me={me} />
          ))}
          {active.length === 0 && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", fontSize: 14, padding: "8px 0 18px" }}>No open suggestions in this view.</div>}

          {resolved.length > 0 && <>
            <div className="np-rule-thin" style={{ margin: "18px 0 12px" }} />
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Resolved · {resolved.length}</span>
            <div style={{ marginTop: 10 }}>
              {resolved.map(s => (
                <SuggestionCard key={s.id} s={s} claim={claimOf(s)} canReview={canReview}
                  onVote={onVote} onReply={onReply} onResolve={onResolve} onMerge={onMerge} onShow={onShow}
                  onPreviewBranch={onPreviewBranch} canPreview={canSee(s)} me={me} />
              ))}
            </div>
          </>}
        </>)}
      </div>
    </aside>
  );
}

Object.assign(window, { SuggestionRail, StatusChip, STATUS_META });
