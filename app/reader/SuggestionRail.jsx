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

/* the span this feedback is pinned to — its quote, with a jump-to-text action */
function AnchorLine({ s, claim, onShow }) {
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

function SuggestionCard({ s, claim, canReview, onVote, onReply, onResolve, onMerge, onShow, me }) {
  const [busy, setBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState(null);
  const before = (claim && claim.text) || (s.anchor && s.anchor.quote) || "";
  const open = s.status === "proposed" || s.status === "review";
  const doMerge = async () => {
    setBusy(true); setMergeErr(null);
    const r = (await onMerge(s)) || {};
    setBusy(false);
    if (r.ok) return;
    if (r.conflict) setMergeErr("Can't merge cleanly — these exact words aren't in the current version anymore (the base moved). Open Edit and apply it by hand, or decline.");
    else if (r.status === 401 || r.status === 403) setMergeErr("Rejected (" + r.status + ") — your Matrix account can't commit edits to this article.");
    else setMergeErr("Couldn't commit the merge: " + (r.error || ("HTTP " + (r.status || "?"))) + ". Nothing changed.");
  };
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 12,
      opacity: s.stale && open ? .94 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderBottom: "1px solid var(--rule)", flexWrap: "wrap" }}>
        <span className="chip" style={{ background: s.kind === "comment" ? "var(--paper-2)" : "var(--yellow)", borderColor: "var(--ink)" }}>
          {s.kind === "comment" ? "💬 Comment" : "✎ Suggestion"}
        </span>
        <StatusChip status={s.status} merged={s.merged} />
        {s.stale && <span className="chip chip-stale" title={"Proposed against v." + s.base_sha + " — the article has since advanced"}>⚠ Stale</span>}
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{shortDate(s.ts)}</span>
      </div>

      <div style={{ padding: "10px 11px" }}>
        <AnchorLine s={s} claim={claim} onShow={onShow} />

        {s.kind === "suggestion" && <DiffText before={before} after={s.proposed} />}

        {s.rationale && (
          <div style={{ marginTop: 10, paddingLeft: 9, borderLeft: "2px solid var(--rule)", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>{s.kind === "comment" ? "Note" : "Rationale"}</span>
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

        <Replies s={s} me={me} onReply={onReply} />

        {mergeErr && (
          <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)", border: "1px solid var(--reject)", padding: "7px 9px", marginTop: 10, lineHeight: 1.45 }}>
            {mergeErr}
          </div>
        )}

        {canReview && open && (
          <div style={{ display: "flex", gap: 7, marginTop: 11, borderTop: "1px solid var(--rule)", paddingTop: 10, flexWrap: "wrap" }}>
            {s.kind === "suggestion"
              ? <button className="btn btn-sm" disabled={busy} style={{ flex: 1, minWidth: 130, background: "var(--verified)", color: "#fff", borderColor: "var(--verified)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy ? .7 : 1 }} onClick={doMerge}>
                  {busy ? <span style={{ width: 11, height: 11, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> : <span style={{ fontFamily: "var(--mono)" }}>⊛</span>}
                  {busy ? "Merging…" : "Merge → commit"}
                </button>
              : <button className="btn btn-sm" style={{ flex: 1, minWidth: 110, borderColor: "var(--verified)", color: "var(--verified)" }} onClick={() => onResolve(s.id, "accepted")}><I.check style={{ fontSize: 13 }} /> Mark resolved</button>}
            {s.status === "proposed" && s.kind === "suggestion" &&
              <button className="btn btn-sm" style={{ borderColor: "var(--review)", color: "var(--review)" }} onClick={() => onResolve(s.id, "review")}>Review</button>}
            <button className="btn btn-sm" style={{ borderColor: "var(--reject)", color: "var(--reject)", display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => onResolve(s.id, "rejected")} title="Decline"><I.x style={{ fontSize: 13 }} /> Decline</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* friendly text for a sign-up failure — register()/signUp() throw coded errors
   (closed homeserver, CAPTCHA/email/token-gated, network) with a plain message */
function signupErrorText(e) {
  if (!e) return "Couldn't create the account — please try again.";
  if (e.code === "network") return "Couldn't reach the homeserver. Check your connection and try again.";
  if (e.message) return e.message;
  return "Couldn't create the account — please try again.";
}

/* friendly text for a sign-in failure — login() throws coded errors (bad mxid,
   network) or a homeserver rejection (wrong password → M_FORBIDDEN / 403) */
function signinErrorText(e) {
  if (!e) return "Couldn't sign in — check your details and try again.";
  if (e.code === "network") return "Couldn't reach the homeserver. Check your connection and try again.";
  if (e.code === "badmxid") return e.message;
  if (e.errcode === "M_FORBIDDEN" || e.status === 403) return "That Matrix ID and password don't match.";
  if (e.status === 429) return "Too many attempts — wait a moment, then try again.";
  return e.message || "Couldn't sign in — check your details and try again.";
}

/* The one-time login a freshly-minted reader account gets. The password is
   auto-generated and shown exactly once, so we hand the whole thing over as a
   small text file the reader can keep — their only way back in (on another
   device, or after this browser forgets them) until they set their own. */
function recoveryDocText(rec) {
  return [
    "PEOPLE'S JOURNALISM — YOUR LOGIN",
    "================================",
    "",
    "You created an account to suggest an edit. Keep this file to sign back",
    "in on another device, or if this browser forgets you.",
    "",
    "  Matrix ID     " + rec.mxid,
    rec.displayName ? "  Display name  " + rec.displayName : null,
    "  Password      " + rec.password,
    "  Homeserver    " + rec.homeserver,
    "",
    "TO LOG BACK IN",
    "  Open any article, choose “Suggest edit,” click “I already have an",
    "  account,” and enter the Matrix ID and password above.",
    "",
    "You can change this password once you're signed in.",
    "Anyone with this file can post as you — keep it private."
  ].filter(Boolean).join("\n") + "\n";
}
function downloadRecoveryDoc(rec) {
  const local = (String(rec.mxid || "").replace(/^@/, "").split(":")[0]) || "account";
  const blob = new Blob([recoveryDocText(rec)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "npj-login-" + local + ".txt";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* shown after a one-tap sign-up: surfaces the new credentials once and presses
   the reader to save them, since the auto-minted password lives nowhere else. */
function RecoveryBanner({ rec, onDismiss }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="fade-in" style={{ border: "1.5px solid var(--ink)", background: "var(--yellow)", marginBottom: 14, boxShadow: "5px 5px 0 rgba(22,20,13,.14)" }}>
      <div style={{ padding: "9px 12px", borderBottom: "1.5px solid var(--ink)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}><I.key style={{ fontSize: 16 }} /> SAVE YOUR LOGIN</span>
        <button onClick={onDismiss} title="Dismiss" style={{ background: "none", border: 0, fontSize: 14, cursor: "pointer" }}><I.x /></button>
      </div>
      <div style={{ padding: "11px 12px" }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.45, marginBottom: 9 }}>
          Account created as <b>{rec.mxid}</b>. This password is shown <i>only once</i> — download the file to sign back in later.
        </div>
        <div className="np-mono" style={{ fontSize: 11.5, background: "var(--paper)", border: "1px solid var(--ink)", padding: "8px 9px", lineHeight: 1.6, marginBottom: 10, wordBreak: "break-all" }}>
          <div>{rec.mxid}</div>
          <div>{rec.password}</div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button className="btn btn-sm btn-primary" onClick={() => { downloadRecoveryDoc(rec); setSaved(true); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <I.download style={{ fontSize: 14 }} /> {saved ? "Download again" : "Download login"}
          </button>
          {saved && <button className="btn btn-sm" onClick={onDismiss}>Done</button>}
        </div>
      </div>
    </div>
  );
}

/* compose a new suggestion or comment, pinned to the selected span. Anyone can
   propose: if the reader has no account yet, posting first mints one on the
   site's homeserver (a quick, one-tap hyphae.social sign-up) and signs them in,
   then deposits the suggestion as them. A reader who already has a Matrix account
   can sign in here instead, in place, without minting a new one. */
function Compose({ draft, onSubmit, onCancel, me, signedIn, onSignUp, onSignIn }) {
  const quote = draft.quote || "";
  const [kind, setKind] = useState(draft.kind || "suggestion");
  const [proposed, setProposed] = useState(quote);
  const [rationale, setRationale] = useState("");
  // anonymous reader → quick account: an optional display name (handle auto-mints)
  const [acctName, setAcctName] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctErr, setAcctErr] = useState(null);
  // not signed in → mint a new account ("new") or sign in to an existing one
  // ("existing", which takes a Matrix ID + password)
  const [authMode, setAuthMode] = useState("new");
  const [loginMxid, setLoginMxid] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const isSugg = kind === "suggestion";
  const contentValid = isSugg
    ? (rationale.trim().length >= 4 && proposed.trim() !== quote.trim() && proposed.trim().length > 0)
    : rationale.trim().length >= 2;
  // signing in to an existing account needs both fields; the new-account path
  // needs nothing extra (the display name is optional)
  const authValid = signedIn || authMode === "new" || (loginMxid.trim().length > 0 && loginPw.length > 0);
  const valid = contentValid && authValid;
  const deposit = () => onSubmit({ kind, anchor: draft.anchor, proposed: isSugg ? proposed.trim() : "", rationale: rationale.trim() });
  // signed in → deposit straight away; otherwise sign in (existing) or mint a new
  // account (new), then deposit as that account
  const submit = async () => {
    if (signedIn || (!onSignUp && !onSignIn)) { deposit(); return; }
    setAcctBusy(true); setAcctErr(null);
    try {
      if (authMode === "existing") await onSignIn({ mxid: loginMxid.trim(), password: loginPw });
      else await onSignUp({ displayName: acctName.trim() || undefined });
      deposit();
    } catch (e) {
      setAcctErr(authMode === "existing" ? signinErrorText(e) : signupErrorText(e));
    } finally {
      setAcctBusy(false);
    }
  };
  return (
    <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", marginBottom: 14, boxShadow: "5px 5px 0 rgba(22,20,13,.14)" }}>
      <div style={{ background: "var(--yellow)", borderBottom: "1.5px solid var(--ink)", padding: "8px 11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 16 }}>{isSugg ? "SUGGEST AN EDIT" : "LEAVE A COMMENT"}</span>
        <button onClick={onCancel} style={{ background: "none", border: 0, fontSize: 15 }}><I.x /></button>
      </div>
      <div style={{ padding: "11px" }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 11, border: "1.5px solid var(--ink)" }}>
          {[["suggestion", "✎ Suggest edit"], ["comment", "💬 Comment"]].map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className="np-cond" style={{ flex: 1, padding: "6px", border: 0, cursor: "pointer",
              borderRight: k === "suggestion" ? "1.5px solid var(--ink)" : 0, fontWeight: 700, fontSize: 13,
              background: kind === k ? "var(--ink)" : "transparent", color: kind === k ? "var(--yellow)" : "var(--ink)" }}>{l}</button>
          ))}
        </div>

        <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 5 }}>On this span</div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, padding: "7px 9px", background: "var(--paper-2)", borderLeft: "3px solid var(--yellow-deep)", marginBottom: 11 }}>{quote || "(the selected words)"}</div>

        {isSugg && (<React.Fragment>
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Proposed text</label>
          <textarea value={proposed} onChange={e => setProposed(e.target.value)} rows={3}
            style={{ width: "100%", marginTop: 4, marginBottom: 11, fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45,
              padding: "8px 9px", border: "1.5px solid var(--ink)", background: "var(--paper)", resize: "vertical", boxSizing: "border-box" }} />
        </React.Fragment>)}

        <label className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>{isSugg ? "Rationale" : "Comment"} <span style={{ color: "var(--reject)" }}>· required</span></label>
        <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={2}
          placeholder={isSugg ? "Why should this change? Cite a source if you can." : "What's off, or what would help?"}
          style={{ width: "100%", marginTop: 4, fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4,
            padding: "8px 9px", border: "1.5px solid var(--ink)", background: "var(--paper)", resize: "vertical", boxSizing: "border-box" }} />

        {!contentValid && (
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.4 }}>
            {isSugg && proposed.trim() === quote.trim() ? "Edit the proposed text so it differs from the original." : "Add a short reason to deposit."}
          </div>
        )}

        {!signedIn && (
          <div style={{ marginTop: 12, border: "1.5px solid var(--ink)", background: "var(--paper-2)", padding: "10px 11px" }}>
            <div style={{ display: "flex", gap: 0, marginBottom: 9, border: "1px solid var(--rule-strong)" }}>
              {[["new", "New account"], ["existing", "I have an account"]].map(([k, l]) => (
                <button key={k} onClick={() => { setAuthMode(k); setAcctErr(null); }} className="np-cond" style={{ flex: 1, padding: "5px 4px", border: 0, cursor: "pointer",
                  borderRight: k === "new" ? "1px solid var(--rule-strong)" : 0, fontWeight: 600, fontSize: 12,
                  background: authMode === k ? "var(--ink)" : "transparent", color: authMode === k ? "var(--yellow)" : "var(--ink)" }}>{l}</button>
              ))}
            </div>
            {authMode === "new" ? (<React.Fragment>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.4, margin: "0 0 8px" }}>
                Posting creates a free account on <b>hyphae.social</b> — that's how an editor can credit you and reply. One tap; we'll hand you a login file to keep.
              </div>
              <input value={acctName} onChange={e => setAcctName(e.target.value)} placeholder="Display name (optional)"
                onKeyDown={e => { if (e.key === "Enter" && valid && !acctBusy) submit(); }}
                style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontFamily: "var(--serif)", fontSize: 13, padding: "6px 8px", boxSizing: "border-box", outline: "none" }} />
            </React.Fragment>) : (<React.Fragment>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.4, margin: "0 0 8px" }}>
                Sign in with your Matrix ID and password — for example, from a login file you saved earlier.
              </div>
              <input value={loginMxid} onChange={e => setLoginMxid(e.target.value)} placeholder="@you:hyphae.social"
                autoCapitalize="off" autoCorrect="off" spellCheck={false}
                style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontFamily: "var(--mono)", fontSize: 12.5, padding: "6px 8px", boxSizing: "border-box", outline: "none", marginBottom: 7 }} />
              <input value={loginPw} onChange={e => setLoginPw(e.target.value)} type="password" placeholder="Password"
                onKeyDown={e => { if (e.key === "Enter" && valid && !acctBusy) submit(); }}
                style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontFamily: "var(--serif)", fontSize: 13, padding: "6px 8px", boxSizing: "border-box", outline: "none" }} />
            </React.Fragment>)}
            {acctErr && (
              <div className="np-mono" style={{ fontSize: 10, color: "var(--reject)", border: "1px solid var(--reject)", padding: "6px 8px", marginTop: 8, lineHeight: 1.45 }}>{acctErr}</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", marginTop: 11, gap: 8 }}>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", flex: "1 1 130px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {signedIn ? "as " + me : authMode === "existing" ? "sign in to post" : "new hyphae.social account"}
          </span>
          <div style={{ display: "flex", gap: 7, flexShrink: 0, marginLeft: "auto" }}>
            <button className="btn btn-sm" onClick={onCancel} disabled={acctBusy}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={!valid || acctBusy} style={{ opacity: (valid && !acctBusy) ? 1 : .45, cursor: (valid && !acctBusy) ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={submit}>
              {acctBusy && <span style={{ width: 11, height: 11, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />}
              {acctBusy ? (authMode === "existing" ? "Signing in…" : "Creating account…")
                : signedIn ? (isSugg ? "Propose edit" : "Post comment")
                : authMode === "existing" ? "Sign in & post" : "Create account & post"}
            </button>
          </div>
        </div>
        <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>
          → kept on the record as an EVA deposit in this article's folder. An editor reviews it for merge.
        </div>
      </div>
    </div>
  );
}

function SuggestionRail({ open, onClose, list, claimById, filter, setFilter, canReview,
                         onVote, onReply, onResolve, onMerge, onShow, composeDraft, onSubmit, onCancelCompose, me, signedIn, onSignUp, onSignIn,
                         signupRecovery, onDismissRecovery }) {
  const TRUST_RANK = { editor: 3, preferred: 2, open: 1 };
  const filtered = list.filter(s => {
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
        {signupRecovery && <RecoveryBanner rec={signupRecovery} onDismiss={onDismissRecovery} />}

        {composeDraft && <Compose draft={composeDraft} me={me} signedIn={signedIn} onSignUp={onSignUp} onSignIn={onSignIn} onSubmit={onSubmit} onCancel={onCancelCompose} />}

        {!composeDraft && (
          <div style={{ border: "1.5px dashed var(--rule-strong)", padding: "12px 13px", marginBottom: 16, display: "flex", gap: 11, alignItems: "center" }}>
            <I.plus style={{ fontSize: 22, color: "var(--ink-soft)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, lineHeight: 1.1 }}>See something off?</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Select any words in the story, then “Suggest edit” or “Comment.”</div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 10px" }}>
          <span className="np-eyebrow">Open · {active.length}</span>
          {canReview
            ? <span className="np-mono" style={{ fontSize: 10.5, color: "var(--verified)", display: "inline-flex", alignItems: "center", gap: 5 }}><I.shield style={{ fontSize: 12 }} /> you can merge</span>
            : <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>editors merge</span>}
        </div>

        {active.map(s => (
          <SuggestionCard key={s.id} s={s} claim={claimOf(s)} canReview={canReview}
            onVote={onVote} onReply={onReply} onResolve={onResolve} onMerge={onMerge} onShow={onShow} me={me} />
        ))}
        {active.length === 0 && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)", fontSize: 14, padding: "8px 0 18px" }}>No open suggestions in this view.</div>}

        {resolved.length > 0 && <>
          <div className="np-rule-thin" style={{ margin: "18px 0 12px" }} />
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Resolved · {resolved.length}</span>
          <div style={{ marginTop: 10 }}>
            {resolved.map(s => (
              <SuggestionCard key={s.id} s={s} claim={claimOf(s)} canReview={canReview}
                onVote={onVote} onReply={onReply} onResolve={onResolve} onMerge={onMerge} onShow={onShow} me={me} />
            ))}
          </div>
        </>}
      </div>
    </aside>
  );
}

Object.assign(window, { SuggestionRail, StatusChip, STATUS_META, DiffText });
