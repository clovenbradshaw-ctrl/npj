/* NPJ Admin Layout Editor — visible ONLY to the verified admin.
   Edits the site chrome (section nav, masthead taglines, utility links, brand)
   live, then publishes the config to GitHub via the n8n webhook. Gating is in
   App (isAdmin comes from a real Matrix whoami), so this component never renders
   for anyone else. Distinct from the design-time Tweaks panel. */

const PUBLISH_CFG_KEY = "npj_publish_cfg_v1";
const DEFAULT_ENDPOINT = "https://n8n.intelechia.com/webhook/site/publish-npj";
function loadPublishCfg() { try { return JSON.parse(localStorage.getItem(PUBLISH_CFG_KEY) || "null") || { endpoint: DEFAULT_ENDPOINT }; } catch (e) { return { endpoint: DEFAULT_ENDPOINT }; } }
function savePublishCfg(c) { try { localStorage.setItem(PUBLISH_CFG_KEY, JSON.stringify(c)); } catch (e) {} }

const AE = { bg: "#16140f", panel: "#1d1b15", line: "rgba(255,255,255,.14)", text: "#e8e2d0", soft: "#9a937f", field: "#14130f" };

function AdminField({ value, onChange, placeholder }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    style={{ flex: 1, minWidth: 0, border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, padding: "7px 9px", outline: "none" }} />;
}
function MiniBtn({ onClick, children, title, danger }) {
  return <button onClick={onClick} title={title} style={{ border: "1px solid " + (danger ? "#a8503a" : AE.line), background: "transparent", color: danger ? "#e09a85" : AE.text, width: 28, height: 30, fontSize: 14, cursor: "pointer", flex: "0 0 auto", lineHeight: 1 }}>{children}</button>;
}

function AdminEditor() {
  const ctx = React.useContext(window.LayoutCtx);
  const { layout, setLayout, isAdmin, admin } = ctx;
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(loadPublishCfg);
  const [pub, setPub] = useState({ state: "idle", msg: "" }); // idle | busy | ok | err
  const [showCfg, setShowCfg] = useState(false);
  const [newMember, setNewMember] = useState("");
  const [newRole, setNewRole] = useState("editor");
  const [expandCol, setExpandCol] = useState(null);
  const [ia, setIa] = useState(() => (window.NpjMedia && window.NpjMedia.getArchiveCreds()) || { access: "", secret: "" });
  const [iaMsg, setIaMsg] = useState(null);

  // Every hook stays ABOVE this guard. isAdmin flips false→true the moment the
  // admin signs in, so an early return placed before some of the hooks changes
  // the hook count between renders and React throws ("rendered more hooks than
  // during the previous render"). Keeping the order stable fixes that crash.
  // Admin-only, belt and braces: the launcher needs BOTH the layout role AND a
  // live verified Matrix session resolving to admin — never a cached flag alone.
  const liveSession = window.MatrixAuth && window.MatrixAuth.current && window.MatrixAuth.current();
  if (!isAdmin || !liveSession || window.roleOf(layout, liveSession.user_id) !== "admin") return null;

  const patch = (next) => setLayout({ ...layout, ...next });
  const setSections = (sections) => patch({ sections });
  const setTaglines = (taglines) => patch({ taglines });
  const setUtility = (utility) => patch({ utility });
  const setRoles = (roles) => patch({ roles });
  const setBrand = (brand) => patch({ brand: { ...(layout.brand || {}), ...brand } });
  const addRole = () => {
    const id = window.MatrixAuth.parseMxid(newMember);
    if (!id) { setPub({ state: "err", msg: "Contributor needs a full Matrix ID (@name:server)" }); return; }
    if (id.mxid === admin) { setNewMember(""); return; }
    setRoles({ ...(layout.roles || {}), [id.mxid]: newRole }); setNewMember("");
  };

  const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

  const saveIa = () => {
    if (!window.NpjMedia) return;
    window.NpjMedia.setArchiveCreds(ia.access, ia.secret);
    setIaMsg(ia.access && ia.secret ? { ok: true, text: "Keys saved — dropped photos will upload to archive.org at publish." } : { ok: false, text: "Both keys are needed — cleared for now." });
  };
  const clearIa = () => { setIa({ access: "", secret: "" }); if (window.NpjMedia) window.NpjMedia.setArchiveCreds("", ""); setIaMsg({ ok: true, text: "Keys cleared — images freeze via the Wayback Machine instead." }); };

  const doPublish = async () => {
    savePublishCfg(cfg);
    const matrixToken = window.MatrixAuth.token();
    if (!matrixToken) { setPub({ state: "err", msg: "Your Matrix session expired — sign in again." }); return; }
    setPub({ state: "busy", msg: "Committing site/layout.json to GitHub…" });
    // mirror roles into the Matrix control room (authoritative, admin-gated) — best effort
    let permNote = "";
    try { await window.MatrixAuth.writePermissions(layout.roles || {}); permNote = " Roles mirrored to Matrix."; }
    catch (e) { permNote = " (Matrix permission mirror skipped: " + (e.message || "unavailable") + ".)"; }
    try {
      const r = await window.NpjLayout.publishLayout({ endpoint: cfg.endpoint || DEFAULT_ENDPOINT, matrixToken, layout, author: admin });
      setPub({ state: "ok", msg: "Published — committed to clovenbradshaw-ctrl/npj" + (r && r.bytes ? " (" + r.bytes + " bytes)." : ".") + permNote });
    } catch (e) {
      setPub({ state: "err", msg: "Publish failed: " + (e.message || "network error") + ". Changes are still saved locally." });
    }
  };

  const ACCENTS = ["#ffec01", "#ff5a3c", "#23c186", "#3aa0ff"];
  const HEADLINES = ["Anton", "Oswald", "Barlow Condensed"];
  const BODIES = ["Newsreader", "Lora", "Spectral"];
  const brand = layout.brand || {};

  const Section = ({ label, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div className="np-eyebrow" style={{ color: AE.soft, marginBottom: 8, borderBottom: "1px solid " + AE.line, paddingBottom: 5 }}>{label}</div>
      {children}
    </div>
  );

  return (
    <React.Fragment>
      {/* launcher — bottom-left, distinct from Tweaks/Clippy */}
      <button onClick={() => setOpen(o => !o)} title="Admin: edit site layout"
        style={{ position: "fixed", left: 18, bottom: 18, zIndex: 6000, display: "inline-flex", alignItems: "center", gap: 8,
          background: "var(--yellow)", color: "var(--ink)", border: "1.5px solid var(--ink)", boxShadow: "4px 4px 0 rgba(0,0,0,.35)",
          padding: "9px 14px", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13.5, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" }}>
        <span style={{ fontFamily: "var(--mono)" }}>⊛</span> {open ? "Close" : "Edit layout"}
      </button>

      {open && (
        <div className="np-scroll" style={{ position: "fixed", left: 18, bottom: 64, zIndex: 6000, width: 372, maxWidth: "calc(100vw - 36px)", maxHeight: "calc(100vh - 96px)", overflowY: "auto",
          background: AE.bg, border: "1.5px solid var(--yellow)", boxShadow: "0 24px 60px rgba(0,0,0,.55)" }}>
          <div style={{ position: "sticky", top: 0, background: "var(--yellow)", color: "var(--ink)", padding: "11px 14px", display: "flex", alignItems: "center", gap: 9, zIndex: 2 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 16 }}>⊛</span>
            <span style={{ fontFamily: "var(--display)", fontSize: 19 }}>SITE LAYOUT</span>
            <span style={{ flex: 1 }} />
            <span className="np-mono" style={{ fontSize: 9.5 }}>verified admin</span>
          </div>

          <div style={{ padding: "14px" }}>
            <div className="np-mono" style={{ fontSize: 10, color: AE.soft, marginBottom: 14, lineHeight: 1.5, wordBreak: "break-all" }}>
              <span style={{ color: "#9fe0b8" }}>● whoami verified</span> · {admin}
            </div>

            {/* Section nav columns + per-column publishers */}
            <Section label="Front columns &amp; publishers">
              {layout.sections.map((s, i) => {
                const editors = Object.keys(layout.roles || {});
                return (
                  <div key={i} style={{ border: "1px solid " + AE.line, padding: "7px", marginBottom: 7 }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <AdminField value={s.name} onChange={(v) => setSections(layout.sections.map((x, j) => j === i ? { ...x, name: v } : x))} placeholder="Column" />
                      <MiniBtn onClick={() => setSections(move(layout.sections, i, -1))} title="Move up">↑</MiniBtn>
                      <MiniBtn onClick={() => setSections(move(layout.sections, i, 1))} title="Move down">↓</MiniBtn>
                      <MiniBtn danger onClick={() => setSections(layout.sections.filter((_, j) => j !== i))} title="Remove">×</MiniBtn>
                    </div>
                    <button onClick={() => setExpandCol(expandCol === i ? null : i)} style={{ background: "none", border: 0, color: AE.soft, fontFamily: "var(--mono)", fontSize: 10.5, padding: "6px 2px 2px", cursor: "pointer" }}>{expandCol === i ? "▾" : "▸"} who can publish here ({(s.publishers || []).length})</button>
                    {expandCol === i && (
                      <div style={{ paddingTop: 4 }}>
                        <div className="np-mono" style={{ fontSize: 9.5, color: "#9fe0b8", marginBottom: 5 }}>admins publish to every column</div>
                        {editors.length === 0 && <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft }}>Add editors below, then assign them here.</div>}
                        {editors.map(mx => {
                          const on = (s.publishers || []).includes(mx);
                          return (
                            <label key={mx} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", cursor: "pointer" }}>
                              <input type="checkbox" checked={on} onChange={() => setSections(layout.sections.map((x, j) => j === i ? { ...x, publishers: on ? x.publishers.filter(p => p !== mx) : [...(x.publishers || []), mx] } : x))} />
                              <span className="np-mono" style={{ fontSize: 10.5, color: AE.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mx} <span style={{ color: AE.soft }}>({layout.roles[mx]})</span></span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={() => setSections([...layout.sections, { name: "New column", publishers: [] }])} style={addBtn}>+ Add column</button>
            </Section>

            {/* Taglines */}
            <Section label="Masthead taglines">
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, marginBottom: 7 }}>renders as “community-___.”</div>
              {layout.taglines.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 5, marginBottom: 6, alignItems: "center" }}>
                  <span className="np-mono" style={{ fontSize: 11, color: AE.soft }}>community-</span>
                  <AdminField value={t} onChange={(v) => setTaglines(layout.taglines.map((x, j) => j === i ? v : x))} placeholder="word" />
                  <MiniBtn danger onClick={() => setTaglines(layout.taglines.filter((_, j) => j !== i))} title="Remove">×</MiniBtn>
                </div>
              ))}
              {layout.taglines.length < 4 && <button onClick={() => setTaglines([...layout.taglines, "word"])} style={addBtn}>+ Add line</button>}
            </Section>

            {/* Utility links */}
            <Section label="Utility-bar links">
              {layout.utility.map((u, i) => (
                <div key={i} style={{ display: "flex", gap: 5, marginBottom: 6 }}>
                  <AdminField value={u.label} onChange={(v) => setUtility(layout.utility.map((x, j) => j === i ? { ...x, label: v } : x))} placeholder="Label" />
                  <select value={u.nav} onChange={(e) => setUtility(layout.utility.map((x, j) => j === i ? { ...x, nav: e.target.value } : x))}
                    style={{ border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontSize: 13, padding: "0 6px" }}>
                    <option value="explore">→ Data</option><option value="standards">→ Standards</option><option value="submit">→ Submit</option>
                  </select>
                  <MiniBtn danger onClick={() => setUtility(layout.utility.filter((_, j) => j !== i))} title="Remove">×</MiniBtn>
                </div>
              ))}
              <button onClick={() => setUtility([...layout.utility, { label: "Link", nav: "explore" }])} style={addBtn}>+ Add link</button>
            </Section>

            {/* Roles / contributors */}
            <Section label="Contributors &amp; permissions">
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, marginBottom: 8, lineHeight: 1.5 }}>The network starts closed. <b style={{ color: AE.text }}>admin</b> can publish + manage roles; <b style={{ color: AE.text }}>editor</b> can draft &amp; edit. Authority flows from you — invite them to the project too.</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <span className="np-mono" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#9fe0b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{admin}</span>
                <span className="np-mono" style={{ fontSize: 10, color: "#9fe0b8", border: "1px solid #2f5b45", padding: "2px 6px" }}>founder · admin</span>
              </div>
              {Object.keys(layout.roles || {}).map((mx) => (
                <div key={mx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <span className="np-mono" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: AE.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mx}</span>
                  <select value={layout.roles[mx]} onChange={(e) => setRoles({ ...layout.roles, [mx]: e.target.value })}
                    style={{ border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontSize: 12, padding: "3px 5px" }}>
                    <option value="editor">editor</option><option value="admin">admin</option>
                  </select>
                  <MiniBtn danger onClick={() => { const r = { ...layout.roles }; delete r[mx]; setRoles(r); }} title="Remove">×</MiniBtn>
                </div>
              ))}
              <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                <AdminField value={newMember} onChange={setNewMember} placeholder="@name:server" />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontSize: 12, padding: "0 5px" }}>
                  <option value="editor">editor</option><option value="admin">admin</option>
                </select>
                <MiniBtn onClick={addRole} title="Add contributor">+</MiniBtn>
              </div>
            </Section>

            {/* Brand */}
            <Section label="Brand">
              <div className="np-mono" style={{ fontSize: 10, color: AE.soft, marginBottom: 6 }}>Accent</div>
              <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
                {ACCENTS.map(c => (
                  <button key={c} onClick={() => setBrand({ accent: c })} title={c}
                    style={{ width: 30, height: 30, background: c, border: "2px solid " + ((brand.accent || "") === c ? "#fff" : AE.line), cursor: "pointer" }} />
                ))}
                <button onClick={() => patch({ brand: { ...(layout.brand || {}), accent: null } })} style={{ ...addBtn, width: "auto", padding: "0 9px" }}>reset</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="np-mono" style={{ fontSize: 10, color: AE.soft, marginBottom: 4 }}>Headline</div>
                  <select value={brand.headline || ""} onChange={(e) => setBrand({ headline: e.target.value || null })} style={selStyle}>
                    <option value="">(default)</option>{HEADLINES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="np-mono" style={{ fontSize: 10, color: AE.soft, marginBottom: 4 }}>Body</div>
                  <select value={brand.body || ""} onChange={(e) => setBrand({ body: e.target.value || null })} style={selStyle}>
                    <option value="">(default)</option>{BODIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            </Section>

            {/* Media uploads → archive.org */}
            <Section label="Media · archive.org uploads">
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, marginBottom: 8, lineHeight: 1.5 }}>
                Dropped photos upload to the Matrix media store while drafting, then move to <b style={{ color: AE.text }}>archive.org</b> at publish. Add your archive.org S3 keys (<b style={{ color: AE.text }}>archive.org/account/s3.php</b>) to upload directly; without them images are frozen via the Wayback Machine instead. Stored in this browser only.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <AdminField value={ia.access} onChange={(v) => setIa(c => ({ ...c, access: v }))} placeholder="S3 access key" />
                <input type="password" value={ia.secret} onChange={(e) => setIa(c => ({ ...c, secret: e.target.value }))} placeholder="S3 secret key"
                  style={{ flex: 1, minWidth: 0, border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, padding: "7px 9px", outline: "none" }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={saveIa} style={{ ...addBtn, flex: 1 }}>Save keys</button>
                  <button onClick={clearIa} style={{ ...addBtn, width: "auto", padding: "0 12px" }}>Clear</button>
                </div>
              </div>
              {iaMsg && <div className="np-mono" style={{ fontSize: 10, marginTop: 7, lineHeight: 1.5, color: iaMsg.ok ? "#9fe0b8" : "#e09a85" }}>{iaMsg.text}</div>}
            </Section>

            {/* Publish */}
            <div style={{ borderTop: "1px solid " + AE.line, paddingTop: 12 }}>
              <button onClick={doPublish} disabled={pub.state === "busy"}
                style={{ width: "100%", background: "var(--yellow)", color: "var(--ink)", border: "1.5px solid var(--ink)", padding: "10px", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                {pub.state === "busy" ? "Publishing…" : "Publish layout to site"}
              </button>
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, marginTop: 7, lineHeight: 1.5 }}>authorized by your Matrix token — the webhook re-checks whoami on hyphae.social before committing.</div>
              <button onClick={() => setShowCfg(s => !s)} style={{ ...addBtn, marginTop: 7, width: "100%" }}>{showCfg ? "Hide" : "Publish endpoint"}</button>
              {showCfg && (
                <div style={{ marginTop: 8 }}>
                  <AdminField value={cfg.endpoint} onChange={(v) => setCfg(c => ({ ...c, endpoint: v }))} placeholder={DEFAULT_ENDPOINT} />
                </div>
              )}
              {pub.msg && <div className="np-mono" style={{ fontSize: 10.5, marginTop: 9, lineHeight: 1.5, color: pub.state === "ok" ? "#9fe0b8" : pub.state === "err" ? "#e09a85" : AE.soft }}>{pub.msg}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                <button onClick={() => setLayout(window.normalizeLayout(window.LAYOUT_DEFAULTS))} style={{ ...addBtn, width: "auto", padding: "5px 10px" }}>Reset to defaults</button>
                <span className="np-mono" style={{ fontSize: 9.5, color: AE.soft, alignSelf: "center" }}>changes apply live · saved locally</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

const addBtn = { width: "100%", border: "1px dashed rgba(255,255,255,.25)", background: "transparent", color: "#cbc4b0", fontFamily: "var(--cond)", fontWeight: 600, fontSize: 12.5, padding: "6px", textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" };
const selStyle = { width: "100%", border: "1px solid rgba(255,255,255,.14)", background: "#14130f", color: "#e8e2d0", fontFamily: "var(--cond)", fontSize: 13, padding: "7px 6px" };

Object.assign(window, { AdminEditor });
