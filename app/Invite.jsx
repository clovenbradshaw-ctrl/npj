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

/* ---- the recovery file ----
   A guest account is a real account: a federated Matrix identity that only the
   guest holds the password to. So when one is minted we hand over a single
   self-contained, printable HTML file with everything needed to get back in —
   address, homeserver, password, and a one-click sign-in link. It is the only
   copy of that password anyone keeps; the homeserver stores just a hash. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function recoveryFileHtml(info) {
  const d = esc(info.displayName || info.localpart || "your account");
  const created = esc(info.createdAt || new Date().toLocaleString());
  const row = (label, value, mono) => `<tr><th>${esc(label)}</th><td${mono ? ' class="m"' : ""}>${esc(value)}</td></tr>`;
  const rows = [
    row("Display name", info.displayName || "—"),
    row("Your address", info.mxid, true),
    row("Homeserver", info.homeserver, true),
    row("Password", info.password, true),
    info.project ? row("Project", info.project) : "",
    row("Created", created)
  ].join("");
  // Inline everything — this file has to keep working years from now, offline,
  // with no network and no NPJ stylesheet. Colours mirror the NPJ press aesthetic.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NPJ recovery — ${d}</title>
<style>
  :root{--yellow:#ffec01;--ink:#16140d;--ink-soft:#3a362b;--paper:#f6f1e4;--card:#fffdf6;--rule:rgba(22,20,13,.4);--verified:#1f6f4a;--reject:#b23a26}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Newsreader',Georgia,'Times New Roman',serif;line-height:1.5;padding:32px 16px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:560px;margin:0 auto;background:var(--card);border:1.5px solid var(--ink);box-shadow:7px 7px 0 rgba(22,20,13,.12)}
  .top{background:var(--yellow);border-bottom:1.5px solid var(--ink);padding:16px 24px;display:flex;align-items:baseline;justify-content:space-between;gap:12px}
  .brand{font-family:'Anton','Arial Narrow',sans-serif;font-size:26px;letter-spacing:.5px;text-transform:uppercase}
  .kicker{font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase}
  .body{padding:24px}
  h1{font-family:'Anton','Arial Narrow',sans-serif;font-weight:400;font-size:34px;line-height:1.02;margin:0 0 8px}
  p{font-size:15px;color:var(--ink-soft);margin:0 0 16px}
  table{width:100%;border-collapse:collapse;margin:4px 0 18px;border:1.5px solid var(--ink)}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid rgba(22,20,13,.16);vertical-align:top;font-size:14px}
  tr:last-child th,tr:last-child td{border-bottom:0}
  th{width:38%;font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);font-weight:400;background:rgba(22,20,13,.035)}
  td.m{font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:13.5px;word-break:break-all}
  .cta{display:inline-block;background:var(--ink);color:var(--yellow);text-decoration:none;font-family:'Barlow Condensed','Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:15px;padding:10px 18px;border:1.5px solid var(--ink)}
  .note{font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:11px;line-height:1.6;color:var(--ink-soft);border-top:1px dashed var(--rule);margin-top:20px;padding-top:14px}
  .warn{color:var(--reject)}
  @media print{body{padding:0;background:#fff}.sheet{box-shadow:none}.cta{display:none}}
</style></head>
<body><div class="sheet">
  <div class="top"><span class="brand">NPJ</span><span class="kicker">Account recovery</span></div>
  <div class="body">
    <h1>Keep this safe.</h1>
    <p>This is how you sign back in to <strong>People&rsquo;s Journalism</strong>. It holds the only copy of your password &mdash; the server keeps just a one-way hash, so no one can recover it for you. Print it or store it in a password manager.</p>
    <table>${rows}</table>
    ${info.signinUrl ? `<a class="cta" href="${esc(info.signinUrl)}">Open the sign-in page &rarr;</a>` : ""}
    <div class="note">
      To sign in: open People&rsquo;s Journalism, choose <strong>Sign in with Matrix</strong>, and enter your address and password above.<br>
      <span class="warn">Anyone with this file can sign in as you.</span> Treat it like a key.
    </div>
  </div>
</div></body></html>`;
}
function downloadRecovery(info) {
  try {
    const blob = new Blob([recoveryFileHtml(info)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(info.localpart || "account").replace(/[^a-z0-9._-]+/gi, "-");
    a.href = url; a.download = "npj-recovery-" + safe + ".html";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) { return false; }
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
     onInvited — (mxid, name) => void, so the caller can show a pending chip */
function NewAccountInvite({ roomId, roomTitle, ensureRoom, onInvited }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");      // who the inviter thinks this guest is
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
        onInvited && onInvited(acct.mxid, who);
      }
      const url = window.MatrixAuth.buildInviteLink({ v: 1, hs: acct.domain, u: acct.localpart, p: acct.password, r: r || undefined, rt: roomTitle || undefined, n: who, g: 1, by: me.user_id });
      setLink({ url, mxid: acct.mxid, name: who }); setNeedToken(false);
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
            Mints a <strong>guest account</strong> on <strong>{domain || "your homeserver"}</strong> and gives you one link. They click it, confirm their name and set a password — no sign-up. A guest works inside this project only; they can't publish.
          </div>
          <label className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "block", marginBottom: 4, fontSize: 9.5 }}>Who's this guest?</label>
          <input value={name} onChange={e => { setName(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && create()} placeholder="e.g. Sam Rivera (City Hall source)" className="np-mono"
            style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "6px 8px", fontSize: 11.5, outline: "none", marginBottom: 6 }} />
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
            Guest account for <strong>{link.name}</strong> created (<strong>{link.mxid}</strong>){roomId || ensureRoom ? " · invited to this project" : ""}. Send them this link:
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

/* ---- the recovery handoff ----
   The last step before the newsroom: the new account's credentials exist only in
   this browser tab right now, so we push the recovery file at them once on arrival
   and won't let them leave without a clear chance to save it. */
function RecoveryStep({ info, onEnter, card }) {
  const [saved, setSaved] = useState(false);
  const grab = () => { if (downloadRecovery(info)) setSaved(true); };
  // auto-offer the download once — most browsers honour a download from a real
  // user gesture chain (the "Finish" click that landed here), and the button below
  // is the reliable fallback if it's blocked.
  useEffect(() => { grab(); /* eslint-disable-next-line */ }, []);
  const fieldRow = (label, value, mono) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--rule)" }}>
      <span className="np-eyebrow" style={{ color: "var(--ink-soft)", fontSize: 9.5, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--mono)" : "var(--serif)", fontSize: 13, textAlign: "right", wordBreak: "break-all" }}>{value || "—"}</span>
    </div>
  );
  return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--verified)", marginBottom: 10 }}>You&rsquo;re a member now · save your file</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: 1, margin: "0 0 10px" }}>Keep your recovery file.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 16px" }}>
        Your account is real and it&rsquo;s yours. This little file is the only copy of the password you just set — the server keeps just a hash, so no one can recover it for you. Download it and tuck it somewhere safe.
      </p>
      <div style={{ border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "4px 12px", marginBottom: 16 }}>
        {fieldRow("Name", info.displayName, false)}
        {fieldRow("Address", info.mxid, true)}
        {fieldRow("Homeserver", info.homeserver, true)}
      </div>
      <button className="btn btn-primary" onClick={grab} style={{ display: "inline-flex", alignItems: "center", gap: 7, width: "100%", justifyContent: "center" }}>
        {saved ? <I.check style={{ fontSize: 14 }} /> : <I.arrow style={{ fontSize: 14, transform: "rotate(90deg)" }} />}
        {saved ? "Downloaded — get it again" : "Download recovery file"}
      </button>
      <button className="btn btn-ghost" onClick={onEnter} style={{ marginTop: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saved ? 1 : .8 }}>
        {saved ? "Enter the newsroom" : "Skip — enter anyway"}<I.arrow style={{ fontSize: 13 }} />
      </button>
      <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.5 }}>
        Anyone who opens this file can sign in as you — treat it like a key.
      </div>
    </>
  );
}

/* ---- the link's landing page ----
   Full-screen, branded, owns the whole viewport while a newcomer onboards.
   props: payload (parsed token), onDone(session) */
function WelcomeInvite({ payload, onDone }) {
  const [phase, setPhase] = useState("signing"); // signing | name | password | recovery | finishing | used | error
  const [err, setErr] = useState("");
  const [name, setName] = useState(payload.n || ""); // pre-filled with who the inviter named
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(null);  // credentials handed to the new account, for the recovery file
  const sessRef = useRef(null);                      // the live session, surfaced once they save their file
  const mxid = "@" + payload.u + ":" + payload.hs;
  const signinUrl = location.origin + location.pathname + "#submit";

  // auto-login with the one-time password from the link
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await window.MatrixAuth.login(mxid, payload.p);
        // Land them INSIDE the project, reliably. First index it on the guest's
        // own account (so the workspace recovers it — and joinedRooms can finish
        // a missed join on the next load), then accept the invite the inviter
        // sent when minting the link. joinRoom retries on rate-limit; both are
        // best-effort so a hiccup never strands the newcomer on this screen.
        if (payload.r) {
          try { await window.MatrixAuth.registerDraft({ roomId: payload.r, title: payload.rt || "Your project" }); } catch (e) {}
          try { await window.MatrixAuth.joinRoom(payload.r); } catch (e) {}
        }
        if (alive) setPhase("name");
      } catch (e) {
        if (!alive) return;
        // a 403 on a fresh link almost always means it's already been redeemed
        if (e && (e.errcode === "M_FORBIDDEN" || e.status === 403)) setPhase("used");
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
      // hold it until they've saved their recovery file — a guest account is a
      // real account, and this file is the only copy of the password they just set.
      sessRef.current = window.MatrixAuth.current();
      setRecovery({ displayName: name.trim() || payload.n || "", mxid, localpart: payload.u, homeserver: payload.hs, password: pw, project: payload.rt || "", signinUrl, createdAt: new Date().toLocaleString() });
      setBusy(false);
      setPhase("recovery");
    } catch (e) { setErr((e && e.message) || "Couldn't set your password. Try again."); setBusy(false); }
  };

  const enterNewsroom = () => { setPhase("finishing"); onDone && onDone(sessRef.current || window.MatrixAuth.current()); };

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

  if (phase === "used") return card(
    <>
      <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 10 }}>Already set up</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 38, lineHeight: 1, margin: "0 0 12px" }}>This invite is done.</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15.5, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 20px" }}>
        Looks like <strong style={{ color: "var(--ink)" }}>{mxid}</strong> already chose a password. Sign in with it instead.
      </p>
      <button className="btn btn-primary" onClick={() => { location.hash = "submit"; location.reload(); }}>Go to sign in</button>
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

  if (phase === "recovery") return <RecoveryStep info={recovery} onEnter={enterNewsroom} card={card} />;

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
