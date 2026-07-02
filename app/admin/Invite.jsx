/* NPJ — Invite a guest who has no Matrix account yet.
 *
 * A guest is a full Matrix login minted by a contributor for one named person,
 * scoped to one project. Two halves of one flow:
 *   NewAccountInvite — the editor-side widget. The signed-in inviter types who
 *     the guest is for, which seeds a recognisable account on their homeserver
 *     (hyphae.social), records the name on the project room, invites the guest
 *     into it, and hands back a single link. The guest lands already inside the
 *     project with access — they can work there, but can't publish.
 *   WelcomeInvite — what that link opens. It logs the guest in with the
 *     one-time password baked into the link, indexes + joins the project so it's
 *     waiting for them, pre-fills their name, then makes them set their own
 *     password. After that the temp password is dead.
 *
 * The credentials only ever travel in the URL fragment (#welcome=…), which the
 * browser never sends to a server, and the password is replaced on first run.
 */

function InviteSpinner({ size }) {
  const s = size || 12;
  return <span style={{ width: s, height: s, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", verticalAlign: "-1px" }} />;
}

/* clipboard with a select-and-copy fallback for insecure contexts / old browsers */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

/* ---- the editor-side widget ----
   Mints an explicit GUEST account: a full Matrix login, but minted by a
   contributor for one named person and scoped to one project. The inviter
   types who the guest is for; that name seeds a recognisable id, is recorded
   on the room for everyone to see, and pre-fills the newcomer's first screen.
   props:
     roomId    — invite the guest into this project room (optional)
     roomTitle — the project's name, carried in the link so the guest lands
                 with a labelled workspace before the room state syncs
     ensureRoom— async () => roomId, used when the room isn't created yet
                 (the Newsroom only spins up a project on first invite)
     onInvited — (mxid, name, role) => void, so the caller can show a pending chip */
function NewAccountInvite({ roomId, roomTitle, ensureRoom, onInvited }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");      // who the inviter thinks this guest is
  const [role, setRole] = useState("editor"); // "editor" (full edit) | "commenter" (comment/suggest only)
  const [needToken, setNeedToken] = useState(false);
  const [token, setToken] = useState("");
  const [link, setLink] = useState(null);   // { url, mxid, name }
  const [copied, setCopied] = useState(false);

  const me = window.MatrixAuth.current();
  const domain = (me && me.user_id && (window.MatrixAuth.parseMxid(me.user_id) || {}).domain) || "";

  const create = async () => {
    const who = name.trim();
    if (busy || !domain) { if (!domain) setErr("Sign in with Matrix first."); return; }
    if (!who) { setErr("Add a name so everyone knows who this guest is."); return; }
    setBusy(true); setErr(""); setLink(null);
    try {
      // seed the id from the name so the guest reads as e.g. @sam-rivera-x3f9
      const acct = await window.MatrixAuth.register({ domain, seed: who, registrationToken: token.trim() || undefined });
      // bring the guest into the project room (best-effort; account already exists)
      let r = roomId || null;
      try { if (!r && ensureRoom) r = await ensureRoom(); } catch (e) { r = null; }
      if (r) {
        try { await window.MatrixAuth.invite(r, acct.mxid); } catch (e) {}
        // record who this guest is for, on the room, for every member to see
        try { await window.MatrixAuth.setGuestName(r, acct.mxid, who, me.user_id); } catch (e) {}
        // apply the chosen tier: a commenter can comment + suggest only; an editor
        // (the default) can edit and draft directly. Only commenters are recorded.
        if (role === "commenter") { try { if (window.MatrixAuth.setCommenter) await window.MatrixAuth.setCommenter(r, acct.mxid, me.user_id); } catch (e) {} }
        onInvited && onInvited(acct.mxid, who, role);
      }
      const url = window.MatrixAuth.buildInviteLink({ v: 1, hs: acct.domain, u: acct.localpart, p: acct.password, r: r || undefined, rt: roomTitle || undefined, n: who, g: 1, by: me.user_id });
      setLink({ url, mxid: acct.mxid, name: who, role }); setNeedToken(false);
    } catch (e) {
      if (e && e.code === "uia" && /registration token/i.test(e.message || "")) { setNeedToken(true); setErr(e.message); }
      else setErr((e && e.message) || "Couldn't create the guest account.");
    }
    setBusy(false);
  };

  const doCopy = async () => { if (link && await copyText(link.url)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } };
  const reset = () => { setLink(null); setErr(""); setCopied(false); setName(""); };

  if (!open) return (
    <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
      <I.link style={{ fontSize: 11 }} /> Invite a guest
    </button>
  );

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--rule-strong)", width: "100%" }}>
      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Invite a guest</span>
        <button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); reset(); }} style={{ padding: 2 }}><I.x style={{ fontSize: 10 }} /></button>
      </div>

      {!link && (
        <>
          <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 8, lineHeight: 1.45 }}>
            Mints a <strong>guest account</strong> on <strong>{domain || "your homeserver"}</strong> and gives you one link. They click it, confirm their name and set a password — no sign-up. Pick what they can do below — you can change it later.
          </div>
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 4, fontSize: 9.5 }}>Who's this guest?</label>
          <input value={name} onChange={e => { setName(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && create()} placeholder="e.g. Sam Rivera (City Hall source)" className="np-mono"
            style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "6px 8px", fontSize: 11.5, outline: "none", marginBottom: 8 }} />
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 4, fontSize: 9.5 }}>What kind of guest?</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {[["editor", "Editor", "Edit and draft directly, comment, and chat."],
              ["commenter", "Commenter", "Comment and suggest edits only — can't change the text."]].map(([val, label, desc]) => (
              <label key={val} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", border: "1.5px solid " + (role === val ? "var(--ink)" : "var(--rule-strong)"), background: role === val ? "color-mix(in srgb, var(--yellow) 35%, transparent)" : "transparent", padding: "5px 7px" }}>
                <input type="radio" name="npj-guest-role" checked={role === val} onChange={() => setRole(val)} style={{ marginTop: 2, accentColor: "var(--ink)", flex: "0 0 auto" }} />
                <span style={{ minWidth: 0 }}>
                  <span className="np-cond" style={{ fontWeight: 700, fontSize: 11.5, display: "block" }}>{label}</span>
                  <span className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", lineHeight: 1.35 }}>{desc}</span>
                </span>
              </label>
            ))}
          </div>
          {needToken && (
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="registration token" className="np-mono"
              style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "6px 8px", fontSize: 11.5, outline: "none", marginBottom: 6 }} />
          )}
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={create} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: busy ? .6 : 1 }}>
            {busy ? <InviteSpinner /> : <I.link style={{ fontSize: 12 }} />}{busy ? "Creating guest…" : "Create guest link"}
          </button>
        </>
      )}

      {link && (
        <>
          <div className="np-mono" style={{ fontSize: 10, color: "var(--verified)", marginBottom: 6, lineHeight: 1.4 }}>
            Guest account for <strong>{link.name}</strong> created (<strong>{link.mxid}</strong>){roomId || ensureRoom ? <> · invited as {link.role === "commenter" ? "a commenter" : "an editor"}</> : ""}. Send them this link:
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
            <input readOnly value={link.url} onFocus={e => e.target.select()} className="np-mono"
              style={{ flex: 1, minWidth: 0, border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "6px 8px", fontSize: 10.5, outline: "none" }} />
            <button className="btn btn-sm btn-primary" onClick={doCopy} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              {copied ? <I.check style={{ fontSize: 12 }} /> : <I.copy style={{ fontSize: 12 }} />}{copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="np-mono" style={{ fontSize: 9, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.4 }}>
            The link carries a one-time password — it stops working once they set their own. Share it privately.
          </div>
          <button className="btn btn-sm btn-ghost" onClick={reset} style={{ marginTop: 6, fontSize: 10.5 }}>Invite another</button>
        </>
      )}

      {err && <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)", marginTop: 7, lineHeight: 1.4 }}>{err}</div>}
    </div>
  );
}

/* ---- the last step: make sure they can actually get back in ----
   A guest account is a real account, and the password they just set is its only
   key — and there's no easy reset (the homeserver keeps just a hash). So rather
   than lock sign-in behind a device passkey, we make the durable thing explicit:
   hand them their exact credentials to copy, and make them confirm they've saved
   them somewhere safe — a password manager ideally — before we let them in. */
function SecureAccountStep({ creds, onEnter, card }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState("");   // which field was last copied
  const [saved, setSaved] = useState(false);  // the "I've saved it" confirmation

  const copy = async (label, value) => { if (await copyText(value)) { setCopied(label); setTimeout(() => setCopied(c => (c === label ? "" : c)), 1500); } };

  const fieldRow = (label, value, secret) => {
    const masked = secret && !reveal;
    const shown = masked ? "•".repeat(Math.min(16, (String(value || "").length) || 12)) : (value || "—");
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule)" }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 9.5, whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, textAlign: "right", wordBreak: "break-all" }}>{shown}</span>
          {secret && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReveal(r => !r)} title={reveal ? "Hide" : "Show"} aria-label={reveal ? "Hide password" : "Show password"} style={{ padding: 3 }}>
              {reveal ? <I.eyeoff style={{ fontSize: 13 }} /> : <I.eye style={{ fontSize: 13 }} />}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(label, value)} title="Copy" aria-label={"Copy " + label} style={{ padding: 3 }}>
            {copied === label ? <I.check style={{ fontSize: 13, color: "var(--verified)" }} /> : <I.copy style={{ fontSize: 13 }} />}
          </button>
        </span>
      </div>
    );
  };

  return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>You&rsquo;re a member now · last step</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: 1, margin: "0 0 10px" }}>Save your password.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        Your account is real and it&rsquo;s yours — but <strong style={{ color: "var(--ink)" }}>there&rsquo;s no easy reset</strong>. The password you just set is the only key, and the server keeps just a hash, so no one can recover it for you. Save it in a <strong style={{ color: "var(--ink)" }}>password manager</strong> (or somewhere safe you&rsquo;ll find again) before you go in.
      </p>
      <div style={{ border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "4px 12px", marginBottom: 16 }}>
        {fieldRow("Name", creds.displayName, false)}
        {fieldRow("Sign-in ID", creds.mxid, false)}
        {fieldRow("Password", creds.password, true)}
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", marginBottom: 16 }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flex: "0 0 auto", accentColor: "var(--ink)" }} />
        <span style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.45 }}>
          I&rsquo;ve saved my password somewhere safe, like a password manager — I understand it can&rsquo;t be reset for me.
        </span>
      </label>
      <button className="btn btn-primary" disabled={!saved} onClick={onEnter}
        style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saved ? 1 : .5, cursor: saved ? "pointer" : "not-allowed" }}>
        Enter the newsroom<I.arrow style={{ fontSize: 13 }} />
      </button>
    </>
  );
}

/* ---- the link's landing page ----
   Full-screen, branded, owns the whole viewport while a newcomer onboards.
   props: payload (parsed token), onDone(session) */
function WelcomeInvite({ payload, onDone }) {
  const [phase, setPhase] = useState("signing"); // signing | returning | name | password | secure | finishing | error
  const [err, setErr] = useState("");
  const [name, setName] = useState(payload.n || ""); // pre-filled with who the inviter named
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [returnPw, setReturnPw] = useState("");      // the password they set, for a re-used link
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState(null);          // {mxid,password,displayName} carried into the save-password step
  const sessRef = useRef(null);                      // the live session, surfaced once they secure the account
  const mxid = "@" + payload.u + ":" + payload.hs;

  // Land them INSIDE the project, reliably. Index it on the guest's own account
  // (so the workspace recovers it — and joinedRooms can finish a missed join on
  // the next load), then accept the invite the inviter sent when minting the
  // link. joinRoom retries on rate-limit; both are best-effort so a hiccup never
  // strands the newcomer. Shared by the first sign-in and the returning one.
  const landInProject = async () => {
    if (!payload.r) return;
    try { await window.MatrixAuth.registerDraft({ roomId: payload.r, title: payload.rt || "Your project" }); } catch (e) {}
    try { await window.MatrixAuth.joinRoom(payload.r); } catch (e) {}
  };

  // auto-login with the one-time password from the link
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await window.MatrixAuth.login(mxid, payload.p);
        await landInProject();
        if (alive) setPhase("name");
      } catch (e) {
        if (!alive) return;
        // The link's one-time password dies the moment they set their own — which
        // is exactly what a 403 here means: they've followed this link before. So
        // rather than a dead end, let them in with the password they chose.
        if (e && (e.errcode === "M_FORBIDDEN" || e.status === 403)) setPhase("returning");
        else { setErr((e && e.message) || "We couldn't open this invite."); setPhase("error"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const saveName = async () => {
    if (busy) return;
    const n = name.trim(); if (!n) { setErr("Pick a name people will see."); return; }
    setBusy(true); setErr("");
    try { await window.MatrixAuth.setDisplayName(n); setPhase("password"); }
    catch (e) { setErr((e && e.message) || "Couldn't save that name. Try again."); }
    setBusy(false);
  };

  const savePassword = async () => {
    if (busy) return;
    if (pw.length < 8) { setErr("Use at least 8 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true); setErr("");
    try {
      await window.MatrixAuth.changePassword(payload.p, pw);
      // re-read the live session so the app picks up the verified identity, but
      // hold it until they've confirmed they saved the password — a guest account
      // is a real account with no easy reset, and the password they just set is
      // its only key, so we make them stash it safely before whisking them off.
      sessRef.current = window.MatrixAuth.current();
      setCreds({ mxid, password: pw, displayName: name.trim() || payload.n || "" });
      setBusy(false);
      setPhase("secure");
    } catch (e) { setErr((e && e.message) || "Couldn't set your password. Try again."); setBusy(false); }
  };

  const enterNewsroom = () => { setPhase("finishing"); onDone && onDone(sessRef.current || window.MatrixAuth.current()); };

  // returning through the original link: the temp password is spent, so they sign
  // in with the password they set, then we drop them straight into the project.
  const returnSignIn = async () => {
    if (busy) return;
    if (!returnPw) { setErr("Enter your password."); return; }
    setBusy(true); setErr("");
    try {
      const sess = await window.MatrixAuth.login(mxid, returnPw);
      await landInProject();
      setPhase("finishing");
      onDone && onDone(sess);
    } catch (e) {
      setErr((e && e.message) || "That password didn't match. Try again.");
      setBusy(false);
    }
  };

  const card = (children) => (
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflowY: "auto" }}>
      <div style={{ width: "min(440px, 100%)" }}>
        <div style={{ background: "var(--yellow)", padding: "14px 28px", borderRadius: 4, marginBottom: 24, textAlign: "center", boxShadow: "0 1px 0 rgba(22,20,13,.4)" }}>
          <img src="assets/npj-logo-wide.png" alt="People's Journalism" style={{ width: "min(320px, 70vw)", height: "auto", display: "inline-block" }} />
        </div>
        <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", boxShadow: "6px 6px 0 rgba(22,20,13,.12)", padding: "26px 24px 28px" }}>
          {children}
        </div>
      </div>
    </div>
  );

  const errBox = err ? (
    <div style={{ marginTop: 14, padding: "9px 11px", background: "color-mix(in srgb, var(--reject) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--reject) 36%, transparent)", fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.45, color: "var(--reject)" }}>{err}</div>
  ) : null;

  if (phase === "signing") return card(
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <InviteSpinner size={26} />
      <div style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink-soft)", marginTop: 16 }}>Opening your invite…</div>
    </div>
  );

  if (phase === "returning") return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>Welcome back</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: 1, margin: "0 0 10px" }}>Sign in to continue.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        You&rsquo;ve set this account up already, so the link&rsquo;s one-time password is spent. Enter the password <strong style={{ color: "var(--ink)" }}>you chose</strong> to pick up where you left off.
      </p>
      <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Your password</label>
      <input autoFocus type="password" value={returnPw} onChange={e => { setReturnPw(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && returnSignIn()}
        style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 15, padding: "10px 12px", fontFamily: "var(--mono)", outline: "none" }} />
      {errBox}
      <button className="btn btn-primary" disabled={busy} onClick={returnSignIn} style={{ marginTop: 16, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: busy ? .6 : 1 }}>
        {busy ? <InviteSpinner /> : <I.lock style={{ fontSize: 13 }} />}{busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 14 }}>{mxid}</div>
    </>
  );

  if (phase === "error") return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 10 }}>Something went wrong</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 36, lineHeight: 1, margin: "0 0 12px" }}>We couldn't open this.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 8px" }}>{err}</p>
      <p style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: 0 }}>Ask whoever sent it for a fresh link.</p>
    </>
  );

  if (phase === "secure") return <SecureAccountStep creds={creds} onEnter={enterNewsroom} card={card} />;

  if (phase === "finishing") return card(
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <I.check style={{ fontSize: 34, color: "var(--verified)" }} />
      <div style={{ fontFamily: "var(--display)", fontSize: 30, margin: "12px 0 6px" }}>You're all set.</div>
      <div style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink-soft)" }}>Taking you to the newsroom…</div>
    </div>
  );

  if (phase === "name") return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>Guest welcome · step 1 of 2</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 40, lineHeight: .98, margin: "0 0 10px" }}>What should we call you?</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        You've been invited as a guest{payload.rt ? <> to <strong style={{ color: "var(--ink)" }}>{payload.rt}</strong></> : ""}. This is your display name — the byline people see on what you contribute. You can change it later.
      </p>
      <input autoFocus value={name} onChange={e => { setName(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && saveName()}
        placeholder="e.g. Sam Rivera" style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 16, padding: "11px 12px", fontFamily: "var(--serif)", outline: "none" }} />
      {errBox}
      <button className="btn btn-primary" disabled={busy} onClick={saveName} style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7, opacity: busy ? .6 : 1 }}>
        {busy ? <InviteSpinner /> : <I.arrow style={{ fontSize: 14 }} />}{busy ? "Saving…" : "Continue"}
      </button>
      <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 14 }}>Signed in as {mxid}</div>
    </>
  );

  // phase === "password"
  return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>Welcome · step 2 of 2</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 40, lineHeight: .98, margin: "0 0 10px" }}>Set your password.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        Your invite came with a temporary password. Choose your own now — only you will know it.
      </p>
      <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>New password</label>
      <input autoFocus type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }}
        style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 15, padding: "10px 12px", fontFamily: "var(--mono)", outline: "none", marginBottom: 10 }} />
      <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>Confirm password</label>
      <input type="password" value={pw2} onChange={e => { setPw2(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && savePassword()}
        style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontSize: 15, padding: "10px 12px", fontFamily: "var(--mono)", outline: "none" }} />
      {errBox}
      <button className="btn btn-primary" disabled={busy} onClick={savePassword} style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7, opacity: busy ? .6 : 1 }}>
        {busy ? <InviteSpinner /> : <I.lock style={{ fontSize: 13 }} />}{busy ? "Setting…" : "Finish & enter"}
      </button>
    </>
  );
}

Object.assign(window, { NewAccountInvite, WelcomeInvite });
