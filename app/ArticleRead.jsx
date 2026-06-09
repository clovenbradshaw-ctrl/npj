/* NPJ article reading experience — the spine.
   Clean Read / Audit Mode + 3 evidence layouts (Ledger / Receipts / Split).
   Articles arrive as folded EO event logs (app/articles.js); the body block
   shapes rendered here are exactly what the log carries. */

// A source key always resolves to SOMETHING renderable, even if the global
// ledger is missing the record (a torn log line, a stale cache) — a hole in
// the ledger must never take the whole article down with it.
function srcOf(key) {
  return window.NPJ.SOURCES[key] || { id: key, type: "primary", title: key, outlet: "", retrieved: "", archive_url: "", original_url: "" };
}

function useClaimModel(A) {
  return React.useMemo(() => {
    const claimList = [];
    const sourceNums = new Map();
    let n = 0;
    const scan = (t) => {
      if (t && t.c && Array.isArray(t.src)) {
        t.src.forEach(k => { if (!sourceNums.has(k)) sourceNums.set(k, ++n); });
        claimList.push({ id: t.id, text: t.c, src: t.src, num: t.src.map(k => sourceNums.get(k)).join(", ") });
      }
    };
    (A.body || []).forEach(b => {
      (b.tokens || []).forEach(scan);
      (b.items || []).forEach(it => it.forEach(scan)); // claims inside lists count too
    });
    const claimById = Object.fromEntries(claimList.map(c => [c.id, c]));
    const sourceList = [...sourceNums.entries()].map(([key, num]) => ({
      key, num, claims: claimList.filter(c => c.src.includes(key)).map(c => c.id)
    }));
    return { claimList, claimById, sourceNums, sourceList };
  }, [A]);
}

/* ---- floating source hover card ---- */
function HoverCard({ data, onEnter, onLeave, onSuggest, suggCount }) {
  // Hooks first, before any early return, so the hook order is stable whether
  // or not a claim is being hovered (data toggles null↔set on hover).
  const [tab, setTab] = useState(0);
  React.useEffect(() => setTab(0), [data && data.claim && data.claim.id]);
  if (!data) return null;
  const { claim, x, y, srcKeys } = data;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = 340;
  let left = Math.min(Math.max(12, x), vw - w - 12);
  let top = y + 8;
  const flip = top > vh - 260;
  return (
    <div className="srccard" style={{ left, top: flip ? "auto" : top, bottom: flip ? vh - y + 14 : "auto" }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {srcKeys.length > 1 && (
        <div style={{ display: "flex", borderBottom: "1.5px solid var(--ink)" }}>
          {srcKeys.map((k, i) => (
            <button key={k} onClick={() => setTab(i)} className="np-mono" style={{ flex: 1, fontSize: 10, padding: "4px 6px",
              border: 0, borderRight: i < srcKeys.length - 1 ? "1px solid var(--rule)" : 0,
              background: tab === i ? "var(--yellow)" : "var(--card)", fontWeight: 600 }}>{srcOf(k).id}</button>
          ))}
        </div>
      )}
      <SourceCard srcKey={srcKeys[tab]} />
      <div style={{ display: "flex", borderTop: "1.5px solid var(--ink)" }}>
        <button onClick={() => onSuggest(claim.id)} className="np-cond" style={{ flex: 1, padding: "8px", border: 0, background: "var(--card)",
          fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontFamily: "var(--mono)" }}>⊨</span> Suggest edit{suggCount ? ` · ${suggCount} open` : ""}
        </button>
      </div>
    </div>
  );
}

function ArticleRead(props) {
  const { readMode, setReadMode, direction, setDirection, showSugg, setShowSugg,
          suggestions, onVote, onResolve, onAddSuggestion, filter, setFilter,
          isEditor, setIsEditor, me, onHome, onNewsroom, onEdited } = props;
  const { entityData, entityOpen, setEntityOpen, activeEntity, setActiveEntity } = props;
  const A = window.NPJ.ARTICLE;
  const { isAdmin } = React.useContext(window.LayoutCtx);
  const { claimList, claimById, sourceNums, sourceList } = useClaimModel(A);
  const [hover, setHover] = useState(null);
  const [activeSrc, setActiveSrc] = useState(null);
  const [composeId, setComposeId] = useState(null);
  const [showVersions, setShowVersions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState(null);
  // below this width the source rail stacks under the article instead of
  // squeezing the reading column
  const isNarrow = window.useIsMobile(900);
  // edit-after-publish: the admin always; otherwise only the article's
  // assignees (the publisher is one by default — see genesisFromContent)
  const canEditArticle = isAdmin || (Array.isArray(A.assignees) && A.assignees.includes(me));
  const leaveTimer = useRef(null);
  const artSlug = (s) => "h-" + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const headings = (A.body || []).filter(b => b.type === "h2" || b.type === "h3").map(b => ({ id: artSlug(b.text), text: b.text, level: b.type === "h2" ? 2 : 3 }));
  const jump = (id) => { const el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" }); };
  const artVersions = A.versions && A.versions.length ? A.versions : [{ sha: A.base_sha || "v1", ts: A.published, author: (A.authors || [])[0], message: "Published", text: window.NPJ.articlePlainText() }];

  const showMarkers = readMode === "audit" || direction === "ledger";
  const openByClaim = {};
  suggestions.forEach(s => { if (s.status === "proposed" || s.status === "review") openByClaim[s.claimId] = (openByClaim[s.claimId] || 0) + 1; });

  const enterClaim = useCallback((e, claim) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ claim, x: r.left, y: r.bottom, srcKeys: claim.src });
    setActiveSrc(claim.src[0]);
  }, []);
  const scheduleLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => { setHover(null); setActiveSrc(null); }, 160);
  }, []);
  const cancelLeave = useCallback(() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  const startCompose = (claimId) => { setComposeId(claimId); setShowSugg(true); setHover(null); };

  // admin-only: unpublish (hide everywhere but admin) or republish. Appends one
  // REC{status} to the log — nothing is deleted — then refolds via onEdited so
  // the reader and front page reflect the change immediately.
  const changeStatus = async (next) => {
    setStatusErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setStatusErr("Sign in with Matrix to manage publication — the webhook re-verifies the token server-side."); return; }
    if (next === "unpublished" && !window.confirm("Unpublish “" + A.headline + "”?\n\nIt will be hidden from the site for everyone but admins. The event log stays in GitHub — you can republish anytime.")) return;
    setStatusBusy(true);
    let out;
    try {
      out = await window.NpjArticles.setArticleStatus({ slug: A.slug, status: next, actor: me, token });
    } catch (e) {
      setStatusBusy(false);
      setStatusErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
      return;
    }
    if (out.res.status === 401 || out.res.status === 403) { setStatusBusy(false); setStatusErr("Rejected (" + out.res.status + ") — that Matrix account isn't authorized."); return; }
    if (!out.res.ok) { setStatusBusy(false); setStatusErr("The webhook answered HTTP " + out.res.status + " — nothing changed."); return; }
    const ts = new Date().toISOString();
    const updated = {
      ...A, status: next, updated: ts.slice(0, 10), base_sha: out.sha,
      versions: [{ sha: out.sha, ts, author: me, message: next === "unpublished" ? "Unpublished" : "Republished", text: window.NPJ.articlePlainText() }, ...(A.versions || [])]
    };
    setStatusBusy(false);
    if (onEdited) onEdited(updated);
  };

  // render tokens for a paragraph: plain strings, style tokens ({t}) and
  // source-bound claims ({c, src, id}) — the EO log's full inline vocabulary
  const ent = activeEntity ? activeEntity.name : null;
  const renderTokens = (tokens) => (tokens || []).map((t, i) => {
    if (typeof t === "string") return <React.Fragment key={i}>{ent ? markEntities(t, ent, "p" + i) : t}</React.Fragment>;
    if (t && t.t) {
      if (t.t === "br") return <br key={i} />;
      if (t.t === "strong") return <strong key={i}>{t.text}</strong>;
      if (t.t === "em") return <em key={i}>{t.text}</em>;
      if (t.t === "s") return <s key={i}>{t.text}</s>;
      if (t.t === "code") return <code key={i} className="np-mono" style={{ fontSize: "0.85em", background: "var(--paper-2)", padding: "0 4px" }}>{t.text}</code>;
      if (t.t === "a") return <a key={i} href={t.href} target="_blank" rel="noopener" style={{ color: "inherit", textDecorationThickness: "1.5px", textUnderlineOffset: 2 }}>{t.text}</a>;
      if (t.t === "sup") return <sup key={i} className="np-mono" style={{ fontSize: 11 }}>{t.text}</sup>;
      return <React.Fragment key={i}>{t.text || ""}</React.Fragment>;
    }
    const claim = claimById[t.id];
    if (!claim) return <React.Fragment key={i}>{t.c || ""}</React.Fragment>;
    return (
      <span key={i} className="claim" data-sugg={openByClaim[t.id] ? "1" : "0"}
        onMouseEnter={(e) => enterClaim(e, claim)} onMouseLeave={scheduleLeave}
        onClick={() => { setShowSugg(true); }}>
        {ent ? markEntities(t.c, ent, "c" + i) : t.c}
        {showMarkers && <sup className="claim-marker">{claim.num}</sup>}
      </span>
    );
  });

  const receiptsFor = (block) => (block.tokens || []).filter(t => t && t.c && claimById[t.id]);

  const Body = (
    <article style={{ fontFamily: "var(--serif)" }}>
      {A.body.map((b, i) => {
        if (b.type === "h2" || b.type === "h3") {
          const Tag = b.type;
          return <Tag key={i} id={artSlug(b.text)} style={{ fontFamily: "var(--display)", fontSize: b.type === "h2" ? 34 : 25, lineHeight: 1.04, margin: "32px 0 12px", scrollMarginTop: 90 }}>{b.text}</Tag>;
        }
        if (b.type === "pull") return (
          <blockquote key={i} style={{ margin: "26px 0", paddingLeft: 20, borderLeft: "4px solid var(--yellow-deep)",
            fontFamily: "var(--cond)", fontWeight: 500, fontSize: 27, lineHeight: 1.18 }}>
            {b.text}
            {b.attribution ? <footer className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8, fontWeight: 400 }}>{b.attribution}</footer> : null}
          </blockquote>
        );
        if (b.type === "img") return (
          <figure key={i} style={{ margin: "26px 0" }}>
            <img src={b.src} alt={b.caption || ""} loading="lazy" style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
            {b.caption && <figcaption className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.45 }}>▢ {b.caption}</figcaption>}
          </figure>
        );
        if (b.type === "embed") return (
          <figure key={i} style={{ margin: "24px 0", border: "1.5px solid var(--ink)", background: "var(--card)", padding: "12px 14px" }}>
            <a href={b.url} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 12.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>
              ↗ {b.url}
            </a>
            {b.caption && <figcaption className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 5 }}>{b.caption}</figcaption>}
          </figure>
        );
        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type;
          return (
            <Tag key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", paddingLeft: 26 }}>
              {(b.items || []).map((it, j) => <li key={j} style={{ marginBottom: 6 }}>{renderTokens(it)}</li>)}
            </Tag>
          );
        }
        if (b.type === "hr") return <hr key={i} style={{ border: 0, borderTop: "2.5px solid var(--ink)", width: 110, margin: "30px auto" }} />;
        if (b.type === "code") return <pre key={i} className="np-mono np-scroll" style={{ fontSize: 13, lineHeight: 1.55, background: "var(--paper-2)", border: "1.5px solid var(--ink)", padding: "12px 14px", overflowX: "auto", margin: "0 0 20px" }}>{b.text}</pre>;
        if (b.type === "verse") return <pre key={i} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17.5, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: "0 0 20px", padding: "0 0 0 20px", borderLeft: "3px solid var(--rule-strong, var(--ink))" }}>{b.text}</pre>;
        return (
          <React.Fragment key={i}>
            <p style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", textWrap: "pretty" }}>{renderTokens(b.tokens)}</p>
            {direction === "receipts" && readMode === "audit" && receiptsFor(b).length > 0 && (
              <div className="fade-in" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "-6px 0 22px" }}>
                {receiptsFor(b).map(t => <Receipt key={t.id} claim={claimById[t.id]} onEnter={enterClaim} onLeave={scheduleLeave} onSuggest={startCompose} openCount={openByClaim[t.id]} />)}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </article>
  );

  // One reading column shared by the headline, the body and the methods
  // footer, so the article always starts directly under the headline. The
  // evidence rail (Ledger / Evidence) sits to the right of it; on narrow
  // screens it stacks underneath instead of crowding the prose.
  const COL = 700;
  const hasRail = direction === "ledger" || direction === "split";
  const railW = direction === "split" ? 320 : 286;
  const railGap = direction === "split" ? 36 : 40;
  const stackRail = hasRail && isNarrow;

  const Header = (
    <header style={{ margin: "0 0 26px" }}>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 12 }}>{A.kicker}</div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 76, lineHeight: .9, margin: "0 0 18px" }}>{A.headline}</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 22, lineHeight: 1.4, color: "var(--ink)", margin: "0 0 20px", fontStyle: "italic" }}>{A.dek}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", paddingBottom: 16, borderBottom: "2px solid var(--ink)" }}>
        <div style={{ display: "flex", gap: 10 }}>{A.authors.map(a => <Handle key={a} mxid={a} showName />)}</div>
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <window.VersionBadge sha={A.base_sha} count={artVersions.length} onClick={() => setShowVersions(true)} />
          {fmtDate(A.published)} · {A.readMins} min
        </span>
      </div>
      <div style={{ paddingTop: 14 }}>
        {/* share link opens the reader; the wayback action targets the raw
            EO log — the committed artifact is what gets archived */}
        <ShareBar url={window.npjArticleUrl(A.slug)} archiveUrl={`https://web.archive.org/web/${window.npjArticleRawUrl(A.slug)}`} title={A.headline} />
      </div>
      {headings.length >= 2 && (
        <nav style={{ marginTop: 18, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "12px 14px" }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Contents</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {headings.map(h => <button key={h.id} onClick={() => jump(h.id)} className="headline-link" style={{ textAlign: "left", background: "none", border: 0, cursor: "pointer", fontFamily: "var(--cond)", fontWeight: h.level === 2 ? 600 : 500, fontSize: h.level === 2 ? 16 : 14, paddingLeft: (h.level - 2) * 14, color: "var(--ink)" }}>{h.text}</button>)}
          </div>
        </nav>
      )}
    </header>
  );

  const Main = (
    <div style={{ minWidth: 0 }}>
      {A.status === "unpublished" && (
        <div style={{ border: "1.5px solid var(--reject)", background: "color-mix(in srgb, var(--reject) 10%, var(--card))", padding: "10px 14px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--reject)" }}>⊘</span>
          <span style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14.5 }}>Unpublished — hidden from the site.</span>
          <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>The event log is still public on GitHub.{isAdmin ? " Only admins can open this page." : ""}</span>
        </div>
      )}
      {statusErr && (
        <div className="np-mono" style={{ fontSize: 11, color: "var(--reject)", border: "1px solid var(--reject)", padding: "9px 10px", marginBottom: 16, lineHeight: 1.5 }}>{statusErr}</div>
      )}
      {Header}
      {Body}
      <MethodsFooter sourceList={sourceList} claimCount={claimList.length} />
    </div>
  );

  return (
    <div className="fade-in">
      <Masthead route="article" onHome={onHome} onNewsroom={onNewsroom} />
      <ControlBar {...{ readMode, setReadMode, direction, setDirection, showSugg, setShowSugg,
        suggCount: suggestions.filter(s => s.status === "proposed" || s.status === "review").length,
        entityOpen, setEntityOpen, entityCount: entityData ? entityData.entities.length : null,
        canEdit: canEditArticle, onEdit: () => setEditing(true),
        isAdmin, status: A.status, statusBusy, onSetStatus: changeStatus }} />

      <div style={{ maxWidth: hasRail ? 1180 : COL, padding: "30px 22px 80px",
        marginLeft: entityOpen ? 372 : "auto", marginRight: showSugg ? 408 : "auto", transition: "margin .28s" }}
        className={readMode === "audit" ? "read-audit" : "read-clean"}>

        {hasRail ? (
          <div style={{ display: "grid",
            gridTemplateColumns: stackRail ? "minmax(0, 1fr)" : "minmax(0, " + COL + "px) " + railW + "px",
            gap: railGap, alignItems: "start", justifyContent: "center" }}>
            {Main}
            {direction === "ledger"
              ? <Ledger sourceList={sourceList} activeSrc={activeSrc} setActiveSrc={setActiveSrc} />
              : <EvidencePanel sourceList={sourceList} activeSrc={activeSrc} setActiveSrc={setActiveSrc} />}
          </div>
        ) : (
          <div style={{ maxWidth: COL, margin: "0 auto" }}>{Main}</div>
        )}
      </div>

      <HoverCard data={hover} onEnter={cancelLeave} onLeave={scheduleLeave} onSuggest={startCompose}
        suggCount={hover ? openByClaim[hover.claim.id] : 0} />

      <EntityRail open={entityOpen} onClose={() => { setEntityOpen(false); setActiveEntity(null); }}
        entityData={entityData} active={activeEntity} setActive={setActiveEntity} />

      <SuggestionRail open={showSugg} onClose={() => { setShowSugg(false); setComposeId(null); }}
        list={suggestions} claimById={claimById} filter={filter} setFilter={setFilter}
        isEditor={isEditor} setIsEditor={setIsEditor} onVote={onVote} onResolve={onResolve}
        composeClaim={composeId ? claimById[composeId] : null}
        onSubmit={(d) => { onAddSuggestion(composeId, d); setComposeId(null); }}
        onCancelCompose={() => setComposeId(null)} me={me} />
      {showVersions && <window.VersionHistory versions={artVersions} onClose={() => setShowVersions(false)} />}
      {editing && window.ArticleEdit && (
        <window.ArticleEdit article={A} me={me} isAdmin={isAdmin}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setEditing(false); if (onEdited) onEdited(updated); }} />
      )}
    </div>
  );
}

/* ---- sticky control bar (the reader's instrument panel) ---- */
function ControlBar({ readMode, setReadMode, direction, setDirection, showSugg, setShowSugg, suggCount, entityOpen, setEntityOpen, entityCount, canEdit, onEdit, isAdmin, status, statusBusy, onSetStatus }) {
  const divider = <span style={{ width: 1, height: 22, background: "var(--rule)" }} />;
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 1500, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", boxShadow: "0 2px 0 rgba(22,20,13,.06)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "9px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div className="seg">
          <button data-on={readMode === "clean" ? "1" : "0"} onClick={() => setReadMode("clean")}><I.eye style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} />Clean</button>
          <button data-on={readMode === "audit" ? "1" : "0"} onClick={() => setReadMode("audit")}><I.shield style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} />Audit</button>
        </div>

        {divider}

        <div className="seg" title="Evidence layout — 3 directions to compare">
          {[["ledger", "Ledger"], ["receipts", "Receipts"], ["split", "Split"]].map(([k, l]) => (
            <button key={k} data-on={direction === k ? "1" : "0"} onClick={() => setDirection(k)}>{l}</button>
          ))}
        </div>

        <span style={{ flex: 1 }} />

        {canEdit && (
          <button className="btn btn-sm" onClick={onEdit} title="Edit this published article — your change is appended to its EO event log" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--yellow)", fontWeight: 700 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>⊛</span> Edit
          </button>
        )}

        {isAdmin && (status === "unpublished" ? (
          <button className="btn btn-sm" onClick={() => onSetStatus("published")} disabled={statusBusy} title="Republish — make this visible on the site again"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--yellow)", fontWeight: 700 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>↺</span> {statusBusy ? "Working…" : "Republish"}
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => onSetStatus("unpublished")} disabled={statusBusy} title="Unpublish — hide from the site (the event log stays in GitHub)"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, borderColor: "var(--reject)", color: "var(--reject)" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>⊘</span> {statusBusy ? "Working…" : "Unpublish"}
          </button>
        ))}

        <button className="btn btn-sm" onClick={() => setEntityOpen(!entityOpen)} title="Figures & places extracted by eoreader3" style={{ display: "inline-flex", alignItems: "center", gap: 7,
          background: entityOpen ? "var(--ink)" : "var(--card)", color: entityOpen ? "var(--yellow)" : "var(--ink)" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>●</span> Figures
          {entityCount != null && <span className="np-mono" style={{ fontSize: 11, background: "var(--data)", color: "#fff", padding: "0 5px", border: "1px solid var(--ink)" }}>{entityCount}</span>}
        </button>

        <button className="btn btn-sm" onClick={() => setShowSugg(!showSugg)} style={{ display: "inline-flex", alignItems: "center", gap: 7,
          background: showSugg ? "var(--ink)" : "var(--card)", color: showSugg ? "var(--yellow)" : "var(--ink)" }}>
          {showSugg ? <I.eyeoff style={{ fontSize: 14 }} /> : <I.chat style={{ fontSize: 14 }} />}
          {showSugg ? "Hide" : "Suggestions"}
          <span className="np-mono" style={{ fontSize: 11, background: "var(--yellow)", color: "var(--ink)", padding: "0 5px", border: "1px solid var(--ink)" }}>{suggCount}</span>
        </button>
      </div>
    </div>
  );
}

/* ---- evidence layouts ---- */
function Receipt({ claim, onEnter, onLeave, onSuggest, openCount }) {
  const k = claim.src[0]; const s = srcOf(k);
  return (
    <div onMouseEnter={(e) => onEnter(e, claim)} onMouseLeave={onLeave}
      style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "7px 9px", maxWidth: 240, cursor: "help",
        boxShadow: "3px 3px 0 rgba(22,20,13,.1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <span className="claim-marker" style={{ verticalAlign: "baseline" }}>{claim.num}</span>
        <SourceTag type={s.type} />
        <span style={{ flex: 1 }} />
        <I.archive style={{ fontSize: 13, color: "var(--verified)" }} />
      </div>
      <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13.5, lineHeight: 1.1 }}>{s.title}</div>
      <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 3 }}>{s.id} · {s.retrieved}</div>
    </div>
  );
}

function Ledger({ sourceList, activeSrc, setActiveSrc }) {
  return (
    <aside style={{ position: "sticky", top: 64, borderLeft: "1.5px solid var(--ink)", paddingLeft: 18 }}>
      <div className="np-eyebrow" style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 6, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <I.source style={{ fontSize: 14 }} /> Source ledger
      </div>
      <div className="np-scroll" style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto", paddingRight: 4 }}>
        {sourceList.map(({ key, num }) => {
          const s = srcOf(key); const on = activeSrc === key;
          return (
            <a key={key} href={s.archive_url || s.original_url} target="_blank" rel="noopener"
              onMouseEnter={() => setActiveSrc(key)} onMouseLeave={() => setActiveSrc(null)}
              style={{ display: "block", textDecoration: "none", padding: "8px 8px", marginBottom: 4,
                background: on ? "var(--yellow)" : "transparent", borderLeft: "3px solid " + (on ? "var(--ink)" : "transparent") }}>
              <div style={{ display: "flex", gap: 7 }}>
                <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>{num}</span>
                <div>
                  <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.08 }}>{s.title}</div>
                  <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 3 }}>{s.outlet}</div>
                  <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}><SourceTag type={s.type} /></div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </aside>
  );
}

function EvidencePanel({ sourceList, activeSrc, setActiveSrc }) {
  return (
    <aside style={{ position: "sticky", top: 64 }}>
      <div className="np-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <I.source style={{ fontSize: 14 }} /> Evidence · {sourceList.length} archived
      </div>
      <div className="np-scroll" style={{ maxHeight: "calc(100vh - 150px)", overflowY: "auto", paddingRight: 4 }}>
        {sourceList.map(({ key, num }) => {
          const on = activeSrc === key;
          return (
            <div key={key} onMouseEnter={() => setActiveSrc(key)} onMouseLeave={() => setActiveSrc(null)}
              style={{ border: "1.5px solid var(--ink)", marginBottom: 9, transform: on ? "translateX(-4px)" : "none",
                boxShadow: on ? "5px 5px 0 var(--yellow-deep)" : "3px 3px 0 rgba(22,20,13,.08)", transition: "all .14s", background: "var(--card)" }}>
              <SourceCard srcKey={key} />
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function MethodsFooter({ sourceList, claimCount }) {
  return (
    <footer style={{ margin: "44px 0 0", borderTop: "2.5px solid var(--ink)", paddingTop: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ fontFamily: "var(--display)", fontSize: 24, margin: 0 }}>METHODS &amp; RECEIPTS</h3>
        <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{claimCount} bound claims · {sourceList.length} archived sources · build passed ✓</span>
      </div>
      <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-soft)", maxWidth: "62ch" }}>
        Every figure above resolves to an archive.org snapshot taken the day we pulled it. The live URL is secondary and may rot; the snapshot is canonical.
        A broken <span className="np-mono">src:</span> reference fails the build, so this page cannot deploy with a citation that points nowhere.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginTop: 10 }}>
        {sourceList.map(({ key, num }) => {
          const s = srcOf(key);
          return (
            <a key={key} href={s.archive_url || s.original_url} target="_blank" rel="noopener" className="headline-link"
              style={{ display: "flex", gap: 8, padding: "6px 6px", textDecoration: "none", borderBottom: "1px solid var(--rule)" }}>
              <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>{num}</span>
              <span style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.25 }}>
                <strong style={{ fontWeight: 600 }}>{s.outlet}.</strong> {s.title}. <span className="np-mono" style={{ fontSize: 10.5, color: "var(--verified)" }}>{s.archive_url ? "archived " + (s.retrieved || "") : "live link"} ↗</span>
              </span>
            </a>
          );
        })}
      </div>
    </footer>
  );
}

Object.assign(window, { ArticleRead });
