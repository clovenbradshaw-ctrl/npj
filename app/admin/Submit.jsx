/* NPJ — Submit. Two paths: sign in with a real Matrix account (contributor tools,
   gated to allowlisted roles) OR email a tip to anyone, no account needed.
   Identity is verified against the homeserver (whoami); access to the tools is
   then gated on the layout roles, so randos can't draft until the admin adds them. */

const TIP_EMAIL = "peoplesjournalism@protonmail.com";

/* A mailto: link silently does nothing on a device with no mail app configured
   (common on shared/locked-down machines). This is the fallback: copy the
   address to the clipboard so the tipster can paste it into webmail. */
function CopyTipEmail({ style }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TIP_EMAIL);
    } catch (e) {
      // clipboard API blocked (insecure context / old browser) — select-and-copy fallback
      const ta = document.createElement("textarea");
      ta.value = TIP_EMAIL; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" onClick={copy} className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, ...style }}>
      <I.copy style={{ fontSize: 13 }} /> {copied ? "Copied ✓" : "Copy address"}
    </button>
  );
}

function SubmitPage({ session, onSignIn, onSignOut, onHome, onNewsroom, onDocs }) {
  const signedIn = !!session;
  return (
    <div className="fade-in">
      <Masthead route="submit" onHome={onHome} onNewsroom={onNewsroom} />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "52px 22px 80px" }}>
        {signedIn
          ? <SignedInPanel session={session} onDocs={onDocs || onNewsroom} onSignOut={onSignOut} />
          : <AccountGate onSignIn={onSignIn} />}
      </div>
    </div>
  );
}

/* Signing in used to drop you into a free-floating "New post" composer here —
   a writing surface attached to nothing. Sign-in now lands on Documents (the
   workspace); this panel is what Submit shows if you come back while signed
   in: who you are, where your work lives, and the tip inbox. */
function SignedInPanel({ session, onDocs, onSignOut }) {
  const { role } = React.useContext(window.LayoutCtx);
  const mailto = "mailto:" + TIP_EMAIL + "?subject=" + encodeURIComponent("Tip for People's Journalism") +
    "&body=" + encodeURIComponent("What happened:\n\n\nWhere / when:\n\n\nDocuments or links (we archive everything):\n\n\nHow to reach you (optional):\n");
  return (
    <div>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 12 }}>Signed in · {session.user_id}{role ? " · " + role : ""}</div>
      <h1 className="npj-submit-h" style={{ fontFamily: "var(--display)", fontSize: 56, lineHeight: .95, margin: "0 0 14px" }}>You're in.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 18, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "58ch", margin: "0 0 28px" }}>
        Your drafts, projects and the published record all live under <strong style={{ color: "var(--ink)" }}>Documents</strong> — start a new document there and it autosaves to this browser and your Matrix account.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 34 }}>
        <button className="btn btn-primary" onClick={onDocs} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <I.doc style={{ fontSize: 14 }} /> Go to your documents
        </button>
        <button className="btn" onClick={onSignOut} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <I.lock style={{ fontSize: 13 }} /> Sign out
        </button>
      </div>
      <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "6px 6px 0 rgba(22,20,13,.12)", padding: "18px 18px 20px", maxWidth: 420 }}>
        <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Got a tip instead?</div>
        <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 14px" }}>
          Send what you know to the newsroom inbox. Attach documents or links — we archive every source.
        </p>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
          <a href={mailto} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
            <I.arrow style={{ fontSize: 14 }} /> Email {TIP_EMAIL}
          </a>
          <CopyTipEmail />
        </div>
      </div>
    </div>
  );
}

function AccountGate({ onSignIn }) {
  const { layout } = React.useContext(window.LayoutCtx);
  const [mxid, setMxid] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // passkeys saved on this device (WebAuthn PRF), if any — offered as a one-touch
  // way back in. Just metadata here; the encrypted password never leaves the vault.
  const [vaults] = useState(() => (window.PasskeyVault ? window.PasskeyVault.list() : []));
  const m = window.MatrixAuth.parseMxid(mxid);
  const server = m ? m.domain : "";
  const valid = !!m && pw.length >= 1;

  // identity is proven by the homeserver; now gate on the role allowlist (authority
  // flows from the admin). Shared by both the password and passkey sign-in paths.
  const gateAndEnter = async (sess) => {
    let roles = null;
    try { roles = await window.MatrixAuth.readPermissions(); } catch (e) {}
    const merged = roles ? window.normalizeLayout({ ...layout, roles: { ...layout.roles, ...window.normalizeRoles(roles) } }) : layout;
    if (!window.isMember(merged, sess.user_id)) {
      await window.MatrixAuth.logout();
      setErr("You're verified as " + sess.user_id + ", but People's Journalism isn't open to new contributors yet. Email a tip below, or ask the team to add you.");
      return false;
    }
    onSignIn(sess); return true;
  };

  const doSignIn = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const sess = await window.MatrixAuth.login(m.mxid, pw);
      await gateAndEnter(sess);
    } catch (e) {
      setErr(e && e.message ? e.message : "Couldn't sign in. Check your ID and password.");
    }
    setBusy(false);
  };

  const doPasskey = async (id) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const { mxid: who, password } = await window.PasskeyVault.unlock(id);
      const sess = await window.MatrixAuth.login(who, password);
      await gateAndEnter(sess);
    } catch (e) {
      if (e && e.name === "NotAllowedError") setErr("Passkey sign-in was cancelled.");
      else setErr(e && e.message ? e.message : "Couldn't sign in with that passkey. Use your password instead.");
    }
    setBusy(false);
  };

  const mailto = "mailto:" + TIP_EMAIL + "?subject=" + encodeURIComponent("Tip for People's Journalism") +
    "&body=" + encodeURIComponent("What happened:\n\n\nWhere / when:\n\n\nDocuments or links (we archive everything):\n\n\nHow to reach you (optional):\n");

  return (
    <div>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 12 }}>Get involved</div>
      <h1 className="npj-submit-h" style={{ fontFamily: "var(--display)", fontSize: 56, lineHeight: .95, margin: "0 0 14px" }}>Two ways in.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 18, lineHeight: 1.5, color: "var(--ink-soft)", maxWidth: "58ch", margin: "0 0 28px" }}>
        Send us a tip from anywhere — no account needed. Or, if you're a contributor, sign in with <strong style={{ color: "var(--ink)" }}>Matrix</strong> to draft and edit alongside the newsroom.
      </p>

      <div className="npj-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* email path — open to everyone */}
        <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "6px 6px 0 rgba(22,20,13,.12)", padding: "18px 18px 20px" }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Anyone · no account</div>
          <h2 style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 24, margin: "0 0 8px", lineHeight: 1.05 }}>Email a tip</h2>
          <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 14px" }}>
            Send what you know to our newsroom inbox. Attach documents or links — we archive every source.
          </p>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
            <a href={mailto} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
              <I.arrow style={{ fontSize: 14 }} /> Email {TIP_EMAIL}
            </a>
            <CopyTipEmail />
          </div>
          <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 12 }}>opens your mail app · no mail app? copy the address and use webmail</div>
        </div>

        {/* matrix path — contributors */}
        <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "6px 6px 0 rgba(22,20,13,.12)", padding: "18px 18px 20px" }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Contributors</div>
          <h2 style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 24, margin: "0 0 8px", lineHeight: 1.05 }}>Sign in with Matrix</h2>
          {vaults.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {vaults.map(v => (
                <button key={v.mxid} className="btn btn-primary" disabled={busy} onClick={() => doPasskey(v.mxid)}
                  style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 6, opacity: busy ? .6 : 1 }}>
                  {busy ? <Spinner /> : <I.lock style={{ fontSize: 13 }} />}Sign in as {v.label} with a passkey
                </button>
              ))}
              <div className="np-mono" style={{ textAlign: "center", fontSize: 10.5, color: "var(--ink-soft)", margin: "8px 0 2px" }}>— or with your ID and password —</div>
            </div>
          )}
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Matrix ID</label>
          <input value={mxid} onChange={(e) => { setMxid(e.target.value); setErr(""); }} placeholder="@you:matrix.org"
            className="np-mono" style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 14, padding: "10px 11px", outline: "none", marginBottom: 10 }} />
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Password</label>
          <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} placeholder="••••••••"
            onKeyDown={(e) => e.key === "Enter" && doSignIn()}
            style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 14, padding: "10px 11px", fontFamily: "var(--mono)", outline: "none", marginBottom: 12 }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span className="np-mono" style={{ fontSize: 10.5, color: server ? "var(--verified)" : "var(--ink-soft)" }}>{server ? "→ " + server : "homeserver from your ID"}</span>
            <button className="btn btn-primary" disabled={!valid || busy} onClick={doSignIn}
              style={{ fontSize: 14, padding: "10px 18px", opacity: (valid && !busy) ? 1 : .45, cursor: (valid && !busy) ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {busy ? <Spinner /> : <I.lock style={{ fontSize: 13 }} />}{busy ? "Verifying…" : "Sign in"}
            </button>
          </div>
          {err && <div style={{ marginTop: 12, padding: "9px 11px", background: "color-mix(in srgb, var(--reject) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--reject) 36%, transparent)", fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.45, color: "var(--reject)" }}>{err}</div>}
          <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "var(--ink-soft)", marginTop: 12 }}>
            No Matrix account? <a href="https://matrix.org/ecosystem/hosting/" target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2 }}>Pick a homeserver and make one ↗</a>
          </div>
        </div>
      </div>

      <div className="npj-feature-row" style={{ display: "flex", gap: 22, marginTop: 34, paddingTop: 20, borderTop: "1.5px solid var(--rule)" }}>
        {[
          [I.lock, "Your account, your server", "Your password goes straight to your homeserver. We never see it; federated identity means no one platform owns who you are."],
          [I.shield, "One identity, in the open", "The same account drafts, edits and is invited into the Matrix room — every contribution stays attributable."],
          [I.archive, "Evidence over identity", "Use a pseudonym on any homeserver. What gets published is the archived evidence, not you."]
        ].map(([Ic, t, d], i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Ic style={{ fontSize: 20 }} />
            <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 15, lineHeight: 1.1 }}>{t}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.4, color: "var(--ink-soft)" }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { SubmitPage, TIP_EMAIL });
