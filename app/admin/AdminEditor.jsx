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
  const [expandProfile, setExpandProfile] = useState(null); // mxid whose name/bio is open

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
  // contributor profiles (the public byline) — curated here, committed with the
  // layout. Empty (no name and no bio) entries prune themselves.
  const setContributor = (mx, p) => {
    const c = { ...(layout.contributors || {}) };
    const cur = c[mx] || {};
    const RAW = (window.NpjProfiles && window.NpjProfiles.BIO_RAW_MAX) || 1500; // cap the markdown source, not the 250 visible chars
    const next = { name: ((p.name != null ? p.name : cur.name) || "").trim(), bio: ((p.bio != null ? p.bio : cur.bio) || "").slice(0, RAW) };
    if (!next.name && !next.bio) delete c[mx]; else c[mx] = next;
    patch({ contributors: c });
  };
  // Plain function (NOT a component) so the inputs keep focus across renders.
  const renderProfileFields = (mx) => {
    const cur = (layout.contributors || {})[mx] || {};
    const fld = { width: "100%", boxSizing: "border-box", border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontSize: 12.5, padding: "5px 7px", outline: "none" };
    return (
      <div style={{ margin: "5px 0 4px", paddingLeft: 8, borderLeft: "2px solid " + AE.line }}>
        <input value={cur.name || ""} onChange={(e) => setContributor(mx, { name: e.target.value })} placeholder="Display name" style={{ ...fld, marginBottom: 5 }} />
        <textarea value={cur.bio || ""} onChange={(e) => setContributor(mx, { bio: e.target.value.slice(0, (window.NpjProfiles && window.NpjProfiles.BIO_RAW_MAX) || 1500) })} rows={2} placeholder="About me — ≤250 visible chars; [text](https://…) for links" style={{ ...fld, resize: "vertical" }} />
        <div className="np-mono" style={{ fontSize: 9, color: AE.soft, textAlign: "right", marginTop: 2 }}>{window.NpjProfiles && window.NpjProfiles.visibleLength ? window.NpjProfiles.visibleLength(cur.bio || "") : (cur.bio || "").length} / {(window.NpjProfiles && window.NpjProfiles.BIO_MAX) || 250}</div>
      </div>
    );
  };
  const addRole = () => {
    const id = window.MatrixAuth.parseMxid(newMember);
    if (!id) { setPub({ state: "err", msg: "Contributor needs a full Matrix ID (@name:server)" }); return; }
    if (id.mxid === admin) { setNewMember(""); return; }
    setRoles({ ...(layout.roles || {}), [id.mxid]: newRole }); setNewMember("");
  };

  const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

  // ---- front-page lineup (hotswap order + per-card layout template) ----
  const front = layout.front || { template: "standard", order: [], cards: {} };
  const setFront = (next) => patch({ front: { ...front, ...next } });
  // the published pool the front page draws from (unpublished are off the page)
  const FRONT = (window.NPJ && window.NPJ.FRONT) || {};
  const frontPool = [].concat(FRONT.lead ? [FRONT.lead] : [], Array.isArray(FRONT.secondary) ? FRONT.secondary : [])
    .filter(a => a && a.slug && a.status !== "unpublished");
  const frontOrdered = window.orderFrontItems(frontPool, front);
  const slotLabel = (i) => i === 0 ? "Cover" : i <= 3 ? "Row · " + i : "Feed · " + (i - 3);
  // hotswap: persist the FULL current order with the one move applied
  const reorderFront = (i, d) => setFront({ order: move(frontOrdered.map(x => x.slug), i, d) });
  const setCard = (slug, name) => {
    const cards = { ...(front.cards || {}) };
    if (!name) delete cards[slug]; else cards[slug] = name;
    setFront({ cards });
  };

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
      {/* launcher — bottom-left, distinct from Tweaks/Citey */}
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
                    <button onClick={() => setExpandCol(expandCol === i ? null : i)} style={{ background: "none", border: 0, color: AE.soft, fontFamily: "var(--mono)", fontSize: 10.5, padding: "6px 2px 2px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>{expandCol === i ? <I.caretDown /> : <I.caretRight />} who can publish here ({(s.publishers || []).length})</button>
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

            {/* Front-page lineup — hotswap positions + a layout template per piece */}
            <Section label="Front page lineup">
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, marginBottom: 8, lineHeight: 1.5 }}>
                Reorder to <b style={{ color: AE.text }}>hotswap</b> which piece is the cover, the 3-across row, or the vertical feed. Pick a <b style={{ color: AE.text }}>template</b> to move the photo around the title + subtitle. Empty order ⇒ newest first.
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 9 }}>
                <span className="np-mono" style={{ fontSize: 10, color: AE.soft, flex: "0 0 auto" }}>Template</span>
                <select value={front.template} onChange={(e) => setFront({ template: e.target.value })} style={{ ...selStyle, flex: 1 }}>
                  {Object.keys(window.FRONT_TEMPLATES).map(k => <option key={k} value={k}>{window.FRONT_TEMPLATES[k].label}</option>)}
                </select>
              </div>
              {frontOrdered.length === 0 && (
                <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, lineHeight: 1.5 }}>No published pieces yet — publish from the Newsroom, then arrange them here.</div>
              )}
              {frontOrdered.map((a, i) => {
                const pos = i === 0 ? "lead" : "card";
                const chk = window.NpjArticles.checkMeta(a);
                const override = (front.cards || {})[a.slug] || "";
                const effective = window.cardTemplateFor(layout, a.slug, pos);
                const effLabel = (window.FRONT_CARD_TEMPLATES[effective] || {}).label || effective;
                return (
                  <div key={a.slug} style={{ border: "1px solid " + AE.line, padding: "7px", marginBottom: 7 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className="np-mono" style={{ fontSize: 9, color: i === 0 ? "#16140f" : AE.text, background: i === 0 ? "var(--yellow)" : "transparent", border: "1px solid " + (i === 0 ? "var(--yellow)" : AE.line), padding: "2px 5px", whiteSpace: "nowrap", flex: "0 0 auto" }}>{slotLabel(i)}</span>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, color: AE.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.headline}>{a.headline || a.slug}</span>
                      <MiniBtn onClick={() => reorderFront(i, -1)} title="Move up">↑</MiniBtn>
                      <MiniBtn onClick={() => reorderFront(i, 1)} title="Move down">↓</MiniBtn>
                    </div>
                    <select value={override} onChange={(e) => setCard(a.slug, e.target.value)} style={{ ...selStyle, width: "100%", marginTop: 6, padding: "4px 6px" }}>
                      <option value="">Template default · {effLabel}</option>
                      {Object.keys(window.FRONT_CARD_TEMPLATES).map(k => <option key={k} value={k}>{window.FRONT_CARD_TEMPLATES[k].label}</option>)}
                    </select>
                    <div style={{ marginTop: 6 }}>
                      {chk.ok
                        ? <span className="np-mono" style={{ fontSize: 9, color: "#9fe0b8" }}>● standardized{chk.missing.length ? <span style={{ color: AE.soft }}> · also add {chk.missing.map(f => f.label).join(", ")}</span> : ""}</span>
                        : <span className="np-mono" style={{ fontSize: 9, color: "#e0b585" }}>▲ missing {chk.required.map(f => f.label).join(", ")}</span>}
                    </div>
                  </div>
                );
              })}
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
                    <option value="explore">→ Sources Archive</option><option value="standards">→ Standards</option><option value="submit">→ Submit</option>
                  </select>
                  <MiniBtn danger onClick={() => setUtility(layout.utility.filter((_, j) => j !== i))} title="Remove">×</MiniBtn>
                </div>
              ))}
              <button onClick={() => setUtility([...layout.utility, { label: "Link", nav: "explore" }])} style={addBtn}>+ Add link</button>
            </Section>

            {/* Roles / contributors */}
            <Section label="Contributors &amp; permissions">
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, marginBottom: 8, lineHeight: 1.5 }}>The network starts closed. <b style={{ color: AE.text }}>admin</b> can publish + manage roles; <b style={{ color: AE.text }}>editor</b> can draft &amp; edit. Authority flows from you — invite them to the project too. <b style={{ color: AE.text }}>Profile</b> sets a contributor's public byline name + About me (committed with the layout).</div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="np-mono" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#9fe0b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{admin}</span>
                  <button onClick={() => setExpandProfile(expandProfile === admin ? null : admin)} className="np-mono" style={{ background: "none", border: "1px solid " + AE.line, color: AE.soft, fontSize: 9.5, padding: "2px 6px", cursor: "pointer" }}>profile</button>
                  <span className="np-mono" style={{ fontSize: 10, color: "#9fe0b8", border: "1px solid #2f5b45", padding: "2px 6px" }}>founder · admin</span>
                </div>
                {expandProfile === admin && renderProfileFields(admin)}
              </div>
              {Object.keys(layout.roles || {}).map((mx) => (
                <div key={mx} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className="np-mono" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: AE.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mx}</span>
                    <button onClick={() => setExpandProfile(expandProfile === mx ? null : mx)} className="np-mono" style={{ background: "none", border: "1px solid " + AE.line, color: AE.soft, fontSize: 9.5, padding: "2px 6px", cursor: "pointer" }}>profile</button>
                    <select value={layout.roles[mx]} onChange={(e) => setRoles({ ...layout.roles, [mx]: e.target.value })}
                      style={{ border: "1px solid " + AE.line, background: AE.field, color: AE.text, fontFamily: "var(--cond)", fontSize: 12, padding: "3px 5px" }}>
                      <option value="editor">editor</option><option value="admin">admin</option>
                    </select>
                    <MiniBtn danger onClick={() => { const r = { ...layout.roles }; delete r[mx]; setRoles(r); }} title="Remove">×</MiniBtn>
                  </div>
                  {expandProfile === mx && renderProfileFields(mx)}
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

            {/* Media uploads → archive.org (server-side via n8n) */}
            <Section label="Media · archive.org uploads">
              <div className="np-mono" style={{ fontSize: 9.5, color: AE.soft, lineHeight: 1.5 }}>
                Dropped photos upload to the Matrix media store while drafting, then move to <b style={{ color: AE.text }}>archive.org</b> at publish — through the n8n backend, so the keys stay server-side. Set <b style={{ color: AE.text }}>IA_S3_ACCESS</b> and <b style={{ color: AE.text }}>IA_S3_SECRET</b> (from archive.org/account/s3.php) in your n8n environment; the publish workflow's media branch uses them. Nothing to enter here.
              </div>
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
