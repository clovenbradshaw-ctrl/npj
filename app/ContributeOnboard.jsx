/* NPJ — Contribute onboarding.
 *
 * A reader has just written a contribution (a span edit, or a note on the whole
 * article) and we need to know who they are before it can land on the permanent
 * record. This is the fast on-ramp that turns an anonymous reader into a signed,
 * attributable contributor in under a minute — modelled on the guest-invite
 * welcome flow (app/Invite.jsx), but self-serve.
 *
 * Two ways in, both real Matrix identities verified by the homeserver:
 *   create — mint a brand-new account on hyphae.social. Pick a display name (or
 *            roll a random one), keep the handle we propose or hand-pick it, and
 *            we generate a strong password for you to save. No email, no captcha
 *            on an open homeserver — name → account → signed in.
 *   byo    — bring your own Matrix account from any homeserver (@you:server +
 *            password). Unlike the newsroom sign-in, contributing is NOT gated on
 *            an admin allowlist: any verified account can propose.
 *
 * Props:
 *   draft     — the pending contribution {kind, scope, anchor, proposed, rationale}
 *               (used only to remind the reader what they're about to sign; optional)
 *   onAuthed  — (session) => void. Fired once a verified session exists; the caller
 *               adopts the session WITHOUT navigating away and submits `draft`.
 *   onSkip    — () => void (optional). "Post without an account" — the caller keeps
 *               the draft as a local-only proposal (off the permanent record).
 *   onClose   — () => void. Dismiss the sheet, drop the pending draft.
 *
 * Exposes window.ContributeOnboard. Depends on window.MatrixAuth.
 */

const NPJ_CONTRIB_HS = "hyphae.social"; // the house homeserver new accounts are minted on

/* a spinner local to this file (the shared one rides the editor bundle, which
   may not be compiled yet when a reader hits Contribute) */
function ContribSpinner({ size }) {
  const s = size || 12;
  return <span style={{ width: s, height: s, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px" }} />;
}

async function contribCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

/* ---- friendly name + handle generation ----
   The same look-alike-free, vowel-free alphabet matrix-auth uses for its hashids,
   so a coined handle never spells an accidental word and reads cleanly aloud. */
const CONTRIB_ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
function coinSuffix(len) {
  const n = Math.max(1, len || 4), A = CONTRIB_ALPHABET, ceil = 256 - (256 % A.length);
  const bytes = new Uint8Array(n * 2); crypto.getRandomValues(bytes);
  let out = "", bi = 0;
  for (let i = 0; i < n; i++) {
    let b = bytes[bi++];
    while (b >= ceil) { if (bi >= bytes.length) { crypto.getRandomValues(bytes); bi = 0; } b = bytes[bi++]; }
    out += A[b % A.length];
  }
  return out;
}
// Matrix-legal localpart from a free-text name + a short unique suffix, so a
// reader reads as @quiet-lantern-7k2p, not @7k2p.
function handleFromName(name) {
  const slug = String(name || "").toLowerCase()
    .replace(/[^a-z0-9._=\-/]+/g, "-")
    .replace(/[-._/]{2,}/g, "-")
    .replace(/^[-._/]+|[-._/]+$/g, "")
    .slice(0, 18).replace(/[-._/]+$/g, "");
  return (slug || "reader") + "-" + coinSuffix(4);
}
const CONTRIB_ADJ = ["quiet", "open", "civic", "plain", "candid", "patient", "keen", "steady", "frank", "bright", "common", "rooted", "clear", "true", "ample", "earnest"];
const CONTRIB_NOUN = ["lantern", "ledger", "compass", "signal", "archive", "press", "beacon", "thread", "record", "citizen", "courier", "witness", "almanac", "dispatch", "margin", "byline"];
function rollName() {
  const a = CONTRIB_ADJ[Math.floor(Math.random() * CONTRIB_ADJ.length)];
  const n = CONTRIB_NOUN[Math.floor(Math.random() * CONTRIB_NOUN.length)];
  return a.charAt(0).toUpperCase() + a.slice(1) + " " + n.charAt(0).toUpperCase() + n.slice(1);
}
function contribPassword() {
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "A").replace(/\//g, "B").replace(/=+$/, "");
}

/* a one-line reminder of what the reader is about to sign */
function DraftPreview({ draft }) {
  if (!draft) return null;
  const article = draft.scope === "article" || (draft.anchor && draft.anchor.scope === "article");
  const isComment = draft.kind === "comment";
  const label = article ? "Contribution to the whole article" : (isComment ? "Comment on a span" : "Suggested edit");
  const body = article || isComment ? (draft.rationale || "") : (draft.proposed || "");
  return (
    <div style={{ border: "1px solid var(--rule-strong)", background: "var(--paper-2)", borderLeft: "3px solid var(--yellow-deep)", padding: "9px 11px", marginBottom: 18 }}>
      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 9.5, marginBottom: 4 }}>Ready to sign · {label}</div>
      <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.4, color: "var(--ink)", maxHeight: 66, overflow: "hidden" }}>
        {body ? (body.length > 160 ? body.slice(0, 160) + "…" : body) : <span style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>your contribution</span>}
      </div>
    </div>
  );
}

/* the credentials hand-off — a coined account has no easy reset, so make the
   reader stash the password before we sign them in (mirrors the guest flow) */
function ContribSecure({ creds, onEnter }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState("");
  const [saved, setSaved] = useState(false);
  const copy = async (k, v) => { if (await contribCopy(v)) { setCopied(k); setTimeout(() => setCopied(c => (c === k ? "" : c)), 1500); } };
  const row = (label, value, secret) => {
    const masked = secret && !reveal;
    const shown = masked ? "•".repeat(Math.min(16, (String(value || "").length) || 12)) : (value || "—");
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule)" }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 9.5, whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, textAlign: "right", wordBreak: "break-all" }}>{shown}</span>
          {secret && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReveal(r => !r)} aria-label={reveal ? "Hide password" : "Show password"} style={{ padding: 3 }}>
              {reveal ? <I.eyeoff style={{ fontSize: 13 }} /> : <I.eye style={{ fontSize: 13 }} />}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(label, value)} aria-label={"Copy " + label} style={{ padding: 3 }}>
            {copied === label ? <I.check style={{ fontSize: 13, color: "var(--verified)" }} /> : <I.copy style={{ fontSize: 13 }} />}
          </button>
        </span>
      </div>
    );
  };
  return (
    <>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>Account created · last step</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 34, lineHeight: 1, margin: "0 0 10px" }}>Save your password.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        This account is yours, on <strong style={{ color: "var(--ink)" }}>{NPJ_CONTRIB_HS}</strong> — but <strong style={{ color: "var(--ink)" }}>there's no reset</strong>. The server keeps only a hash, so save this in a password manager before you go in.
      </p>
      <div style={{ border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "4px 12px", marginBottom: 16 }}>
        {row("Name", creds.displayName, false)}
        {row("Sign-in ID", creds.mxid, false)}
        {row("Password", creds.password, true)}
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", marginBottom: 16 }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flex: "0 0 auto", accentColor: "var(--ink)" }} />
        <span style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.45 }}>
          I've saved my password somewhere safe — I understand it can't be reset for me.
        </span>
      </label>
      <button className="btn btn-primary" disabled={!saved} onClick={onEnter}
        style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saved ? 1 : .5, cursor: saved ? "pointer" : "not-allowed" }}>
        Sign my contribution <I.arrow style={{ fontSize: 13 }} />
      </button>
    </>
  );
}

function ContributeOnboard({ draft, onAuthed, onSkip, onClose }) {
  // choose | create | byo | creating | secure | finishing | error
  const [phase, setPhase] = useState("choose");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // create-account fields
  const [name, setName] = useState(() => rollName());
  const [editHandle, setEditHandle] = useState(false);
  const [handle, setHandle] = useState("");           // hand-picked localpart (when editHandle)
  const [regToken, setRegToken] = useState("");
  const [needToken, setNeedToken] = useState(false);
  const [creds, setCreds] = useState(null);
  const sessRef = useRef(null);

  // bring-your-own fields
  const [mxid, setMxid] = useState("");
  const [pw, setPw] = useState("");

  // the handle the reader will get: their hand-picked one, or one coined from the
  // display name. Re-coined per name so the preview always reflects the input.
  const autoHandle = React.useMemo(() => handleFromName(name), [name]);
  const shownHandle = (editHandle ? handle : autoHandle) || "reader";
  const previewMxid = "@" + shownHandle + ":" + NPJ_CONTRIB_HS;

  const rerollName = () => { setName(rollName()); setErr(""); };

  // mint the account, log in, set the byline, then hand over the password
  const createAccount = async () => {
    if (busy) return;
    const display = name.trim();
    if (!display) { setErr("Pick a name people will see on your byline."); return; }
    const picked = editHandle ? handle.trim().toLowerCase() : "";
    if (editHandle && !/^[a-z0-9._=\-/]+$/.test(picked)) { setErr("A handle can use letters, numbers and . _ - = / only."); return; }
    setBusy(true); setErr(""); setPhase("creating");
    const password = contribPassword();
    try {
      let acct = null, lastErr = null;
      // a coined handle should always land: regenerate on the rare collision. A
      // hand-picked one surfaces the clash so the reader can choose another.
      const tries = editHandle ? 1 : 6;
      for (let i = 0; i < tries; i++) {
        const username = editHandle ? picked : handleFromName(display);
        try {
          acct = await window.MatrixAuth.register({ domain: NPJ_CONTRIB_HS, username, password, registrationToken: regToken.trim() || undefined });
          break;
        } catch (e) {
          lastErr = e;
          if (!editHandle && e && e.errcode === "M_USER_IN_USE" && i < tries - 1) continue;
          throw e;
        }
      }
      if (!acct) throw lastErr || new Error("Couldn't create the account.");
      const sess = await window.MatrixAuth.login(acct.mxid, password);
      try { await window.MatrixAuth.setDisplayName(display); } catch (e) { /* byline is best-effort */ }
      sessRef.current = sess;
      setCreds({ mxid: acct.mxid, password, displayName: display });
      setBusy(false);
      setPhase("secure");
    } catch (e) {
      setBusy(false);
      if (e && e.code === "uia" && /registration token/i.test(e.message || "")) { setNeedToken(true); setErr(e.message); }
      else if (e && e.errcode === "M_USER_IN_USE") setErr("That handle is taken — try another, or let us pick one.");
      else if (e && e.code === "uia") setErr((e.message || "This homeserver can't create accounts from here.") + " Try bringing your own account instead.");
      else setErr((e && e.message) || "Couldn't create the account. Try again, or bring your own.");
      setPhase("create");
    }
  };

  const enterWithSession = () => { setPhase("finishing"); onAuthed && onAuthed(sessRef.current || window.MatrixAuth.current()); };

  // bring-your-own: verify against the homeserver, then sign the contribution.
  // Open to any real account — contributing isn't gated on the role allowlist.
  const byoSignIn = async () => {
    if (busy) return;
    const id = window.MatrixAuth.parseMxid(mxid);
    if (!id) { setErr("That isn't a valid Matrix ID (expected @name:server)."); return; }
    if (!pw) { setErr("Enter your password."); return; }
    setBusy(true); setErr("");
    try {
      const sess = await window.MatrixAuth.login(id.mxid, pw);
      sessRef.current = sess;
      setPhase("finishing");
      onAuthed && onAuthed(sess);
    } catch (e) {
      setErr((e && e.message) || "Couldn't sign in. Check your ID and password.");
      setBusy(false);
    }
  };

  const card = (children) => (
    // backdrop does NOT dismiss on click — the sheet is holding the reader's
    // unsaved contribution, so leaving is an explicit act (the × button)
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "color-mix(in srgb, var(--ink) 46%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflowY: "auto" }}>
      <div style={{ width: "min(460px, 100%)" }}>
        <div style={{ background: "var(--yellow)", padding: "12px 24px", borderRadius: 4, marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 0 rgba(22,20,13,.4)" }}>
          <img src="assets/npj-logo-wide.png" alt="People's Journalism" style={{ width: "min(240px, 56vw)", height: "auto", display: "inline-block" }} />
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, fontSize: 18, cursor: "pointer", color: "var(--ink)" }}><I.x /></button>
        </div>
        <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "6px 6px 0 rgba(22,20,13,.12)", padding: "24px 22px 26px" }}>
          {children}
        </div>
      </div>
    </div>
  );

  const errBox = err ? (
    <div style={{ marginTop: 14, padding: "9px 11px", background: "color-mix(in srgb, var(--reject) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--reject) 36%, transparent)", fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.45, color: "var(--reject)" }}>{err}</div>
  ) : null;

  if (phase === "creating") return card(
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <ContribSpinner size={26} />
      <div style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink-soft)", marginTop: 16 }}>Creating your account on {NPJ_CONTRIB_HS}…</div>
    </div>
  );

  if (phase === "finishing") return card(
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <I.check style={{ fontSize: 34, color: "var(--verified)" }} />
      <div style={{ fontFamily: "var(--display)", fontSize: 28, margin: "12px 0 6px" }}>Signed.</div>
      <div style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink-soft)" }}>Posting your contribution…</div>
    </div>
  );

  if (phase === "secure") return card(<ContribSecure creds={creds} onEnter={enterWithSession} />);

  if (phase === "byo") return card(
    <>
      <button onClick={() => { setPhase("choose"); setErr(""); }} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 11, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>← back</button>
      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 10 }}>Bring your own account</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 32, lineHeight: 1, margin: "0 0 10px" }}>Sign in with Matrix.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        Any homeserver works. Your password goes straight to your server — we never see it.
      </p>
      <DraftPreview draft={draft} />
      <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Matrix ID</label>
      <input autoFocus value={mxid} onChange={e => { setMxid(e.target.value); setErr(""); }} placeholder="@you:matrix.org" className="np-mono"
        style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 14, padding: "10px 11px", outline: "none", marginBottom: 10 }} />
      <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Password</label>
      <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && byoSignIn()} placeholder="••••••••"
        style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 14, padding: "10px 11px", fontFamily: "var(--mono)", outline: "none" }} />
      {errBox}
      <button className="btn btn-primary" disabled={busy} onClick={byoSignIn} style={{ marginTop: 16, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: busy ? .6 : 1 }}>
        {busy ? <ContribSpinner /> : <I.lock style={{ fontSize: 13 }} />}{busy ? "Verifying…" : "Sign in & contribute"}
      </button>
    </>
  );

  if (phase === "create") return card(
    <>
      <button onClick={() => { setPhase("choose"); setErr(""); }} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 11, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>← back</button>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>New account · {NPJ_CONTRIB_HS}</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 32, lineHeight: 1, margin: "0 0 10px" }}>Pick a name.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        This is your byline — what readers see on what you contribute. Use your own, or roll a pseudonym. You can change it anytime.
      </p>
      <DraftPreview draft={draft} />

      <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Display name</label>
      <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
        <input autoFocus value={name} onChange={e => { setName(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && createAccount()} placeholder="e.g. Sam Rivera"
          style={{ flex: 1, minWidth: 0, border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 16, padding: "11px 12px", fontFamily: "var(--serif)", outline: "none" }} />
        <button type="button" className="btn" onClick={rerollName} title="Roll a random pseudonym" style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <I.sparkle style={{ fontSize: 14 }} /> Surprise me
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: editHandle ? 6 : 0 }}>
        <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", wordBreak: "break-all" }}>
          Your ID: <span style={{ color: "var(--verified)" }}>{previewMxid}</span>
        </span>
        <button type="button" onClick={() => { setEditHandle(v => !v); setHandle(autoHandle); setErr(""); }} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 11, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, whiteSpace: "nowrap" }}>
          {editHandle ? "use suggested" : "customize handle"}
        </button>
      </div>
      {editHandle && (
        <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1.5px solid var(--ink)", marginBottom: 6 }}>
          <span className="np-mono" style={{ fontSize: 13, padding: "0 0 0 9px", color: "var(--ink-soft)" }}>@</span>
          <input value={handle} onChange={e => { setHandle(e.target.value.toLowerCase()); setErr(""); }} placeholder="your-handle" className="np-mono"
            style={{ flex: 1, minWidth: 0, border: 0, background: "var(--paper)", fontSize: 13, padding: "9px 6px", outline: "none" }} />
          <span className="np-mono" style={{ fontSize: 13, padding: "0 9px 0 0", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>:{NPJ_CONTRIB_HS}</span>
        </div>
      )}

      {needToken && (
        <>
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", margin: "10px 0 6px" }}>Registration token</label>
          <input value={regToken} onChange={e => setRegToken(e.target.value)} placeholder="from the newsroom" className="np-mono"
            style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 13, padding: "9px 11px", outline: "none" }} />
        </>
      )}

      {errBox}
      <button className="btn btn-primary" disabled={busy} onClick={createAccount} style={{ marginTop: 16, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: busy ? .6 : 1 }}>
        {busy ? <ContribSpinner /> : <I.arrow style={{ fontSize: 14 }} />}{busy ? "Creating…" : "Create account & continue"}
      </button>
      <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.45, textAlign: "center" }}>
        We generate a strong password for you to save on the next screen.
      </div>
    </>
  );

  // phase === "choose"
  return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 10 }}>One quick step</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 34, lineHeight: .98, margin: "0 0 10px" }}>Sign your contribution.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        Contributions stay on the public record, attributed to whoever made them. Grab a free account — it takes a moment — or bring your own.
      </p>
      <DraftPreview draft={draft} />

      <button className="btn btn-primary" onClick={() => { setPhase("create"); setErr(""); }}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", marginBottom: 10 }}>
        <I.sparkle style={{ fontSize: 22, flex: "0 0 auto" }} />
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16 }}>Create a free account</span>
          <span className="np-mono" style={{ fontSize: 10.5, opacity: .8 }}>on {NPJ_CONTRIB_HS} · pick a name, we do the rest</span>
        </span>
      </button>

      <button className="btn" onClick={() => { setPhase("byo"); setErr(""); }}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", marginBottom: 6 }}>
        <I.lock style={{ fontSize: 20, flex: "0 0 auto" }} />
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16 }}>Use your Matrix account</span>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>any homeserver · @you:server</span>
        </span>
      </button>

      {onSkip && (
        <div style={{ textAlign: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
          <button onClick={onSkip} className="np-mono" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 11.5, color: "var(--ink-soft)", textDecoration: "underline", textUnderlineOffset: 2 }}>
            Post without an account — saved to this device only →
          </button>
          <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 5, lineHeight: 1.4 }}>
            Stays on this browser; it won't reach the public record or an editor.
          </div>
        </div>
      )}
    </>
  );
}

Object.assign(window, { ContributeOnboard });
