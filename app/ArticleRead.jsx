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

/* A source's cited passages, as clickable snippets — click one to scroll to
   that exact span in the article and flash it. Reused by the hover card, the
   ledger, the evidence panel and the methods footer. */
function snippet(text, max = 96) {
  const t = String(text || "").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
function CitedSpanList({ claims, onJump, currentId }) {
  if (!claims || !claims.length) return null;
  return (
    <div>
      {claims.map(c => (
        <button key={c.id} className="cite-span" data-current={c.id === currentId ? "1" : "0"}
          onClick={() => onJump(c.id)} title="Jump to this passage in the article">
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)", flex: "0 0 auto" }}>↳</span>
          <span style={{ fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.3, color: "var(--ink)" }}>“{snippet(c.text)}”</span>
        </button>
      ))}
    </div>
  );
}

/* ---- floating source hover card ---- */
function HoverCard({ data, onEnter, onLeave, onSuggest, suggCount, spansForSource, onJump }) {
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
  // the other passages this same source backs — so you can hop between them
  const spans = spansForSource ? spansForSource(srcKeys[tab]) : [];
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
      {spans.length > 1 && (
        <div style={{ borderTop: "1.5px solid var(--ink)", maxHeight: 124, overflowY: "auto" }} className="np-scroll">
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", padding: "7px 10px 1px" }}>Backs {spans.length} passages — click to jump</div>
          <CitedSpanList claims={spans} onJump={onJump} currentId={claim.id} />
        </div>
      )}
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
  const { audit, setAudit, showSugg, setShowSugg,
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

  const showMarkers = audit;
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

  // every passage a given source backs (newest model: sourceList carries the
  // claim ids; claimById carries each span's text) — drives the click-to-jump
  // lists in the hover card, ledger, evidence panel and methods footer
  const spansForSource = useCallback((key) => {
    const e = sourceList.find(s => s.key === key);
    return e ? e.claims.map(id => claimById[id]).filter(Boolean) : [];
  }, [sourceList, claimById]);
  // scroll to a claim span in the body and flash it
  const jumpToClaim = useCallback((id) => {
    setHover(null); setActiveSrc(null);
    const el = document.getElementById("claim-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("claim-flash"); void el.offsetWidth; el.classList.add("claim-flash");
    setTimeout(() => el.classList.remove("claim-flash"), 1800);
  }, []);

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
      <span key={i} id={"claim-" + t.id} className="claim" data-sugg={openByClaim[t.id] ? "1" : "0"}
        data-active={claim.src.includes(activeSrc) ? "1" : "0"}
        onMouseEnter={(e) => enterClaim(e, claim)} onMouseLeave={scheduleLeave}
        onClick={() => { setShowSugg(true); }}>
        {ent ? markEntities(t.c, ent, "c" + i) : t.c}
        {showMarkers && <sup className="claim-marker">{claim.num}</sup>}
      </span>
    );
  });

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
        return <p key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", textWrap: "pretty" }}>{renderTokens(b.tokens)}</p>;
      })}
    </article>
  );

  // One reading column shared by the headline, the body and the methods
  // footer, so the article always starts directly under the headline. With
  // auditability on, the source ledger rides to the right of it (and stacks
  // underneath on narrow screens); off, it's a single clean column. The
  // reading column stays put either way — turning auditability on only
  // reveals the ledger on the right, it never shoves the article sideways.
  const COL = 700;
  const hasRail = audit;
  const railW = 286;
  const railGap = 40;
  const stackRail = hasRail && isNarrow;

  const Header = (
    <header style={{ margin: "0 0 26px" }}>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 12 }}>{A.kicker}</div>
      <h1 className="npj-article-h" style={{ fontFamily: "var(--display)", fontSize: 88, lineHeight: 1, letterSpacing: "-.01em", margin: "0 0 20px" }}>{A.headline}</h1>
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
      <MethodsFooter sourceList={sourceList} claimCount={claimList.length} spansForSource={spansForSource} onJump={jumpToClaim} />
    </div>
  );

  return (
    <div className="fade-in">
      <Masthead route="article" onHome={onHome} onNewsroom={onNewsroom} />
      <ControlBar {...{ audit, setAudit, showSugg, setShowSugg,
        suggCount: suggestions.filter(s => s.status === "proposed" || s.status === "review").length,
        entityOpen, setEntityOpen, entityCount: entityData ? entityData.entities.length : null,
        canEdit: canEditArticle, onEdit: () => setEditing(true),
        isAdmin, status: A.status, statusBusy, onSetStatus: changeStatus }} />

      <div style={{ maxWidth: hasRail && !stackRail ? COL + 2 * (railW + railGap) : COL, padding: "30px 22px 80px",
        marginLeft: entityOpen ? 372 : "auto", marginRight: showSugg ? 408 : "auto", transition: "margin .28s" }}
        className={audit ? "read-audit" : "read-clean"}>

        {hasRail ? (
          <div style={{ display: "grid",
            // an empty left gutter mirrors the ledger's width, so the reading
            // column lands in the exact same place as the clean read — audit
            // on just paints the ledger into the right margin
            gridTemplateColumns: stackRail ? "minmax(0, 1fr)" : "minmax(0, " + railW + "px) minmax(0, " + COL + "px) " + railW + "px",
            gap: railGap, alignItems: "start", justifyContent: "center" }}>
            {!stackRail && <div aria-hidden="true" />}
            {Main}
            <Ledger sourceList={sourceList} activeSrc={activeSrc} setActiveSrc={setActiveSrc} spansForSource={spansForSource} onJump={jumpToClaim} />
          </div>
        ) : (
          <div style={{ maxWidth: COL, margin: "0 auto" }}>{Main}</div>
        )}
      </div>

      <HoverCard data={hover} onEnter={cancelLeave} onLeave={scheduleLeave} onSuggest={startCompose}
        suggCount={hover ? openByClaim[hover.claim.id] : 0} spansForSource={spansForSource} onJump={jumpToClaim} />

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
function ControlBar({ audit, setAudit, showSugg, setShowSugg, suggCount, entityOpen, setEntityOpen, entityCount, canEdit, onEdit, isAdmin, status, statusBusy, onSetStatus }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 1500, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", boxShadow: "0 2px 0 rgba(22,20,13,.06)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "9px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
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

        <button className="btn btn-sm" onClick={() => setAudit(!audit)} aria-pressed={audit}
          title="Auditability — reveal the source ledger, numbered claims and every citation. Off: a clean read."
          style={{ display: "inline-flex", alignItems: "center", gap: 7,
            background: audit ? "var(--ink)" : "var(--card)", color: audit ? "var(--yellow)" : "var(--ink)" }}>
          <I.shield style={{ fontSize: 14 }} /> Auditability
        </button>

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

/* ---- the source ledger (shown when auditability is on) ---- */
function Ledger({ sourceList, activeSrc, setActiveSrc, spansForSource, onJump }) {
  return (
    <aside style={{ position: "sticky", top: 64, borderLeft: "1.5px solid var(--ink)", paddingLeft: 18 }}>
      <div className="np-eyebrow" style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 6, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <I.source style={{ fontSize: 14 }} /> Source ledger
      </div>
      <div className="np-scroll" style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto", paddingRight: 4 }}>
        {sourceList.map(({ key, num }) => {
          const s = srcOf(key); const on = activeSrc === key; const spans = spansForSource(key);
          // hovering the source lights up its exact spans in the body (data-active)
          // and reveals them here as click-to-jump passages
          return (
            <div key={key} onMouseEnter={() => setActiveSrc(key)} onMouseLeave={() => setActiveSrc(null)}
              style={{ marginBottom: 4, background: on ? "var(--yellow)" : "transparent", borderLeft: "3px solid " + (on ? "var(--ink)" : "transparent") }}>
              <div style={{ display: "flex", gap: 7, padding: "8px 8px 6px" }}>
                <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>{num}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 14, lineHeight: 1.08 }}>{s.title}</div>
                  <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginTop: 3 }}>{s.outlet}</div>
                  <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <SourceTag type={s.type} />
                    {spans.length > 0 && <span className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>· {spans.length} passage{spans.length !== 1 ? "s" : ""}</span>}
                    <a href={s.archive_url || s.original_url} target="_blank" rel="noopener" className="np-mono" title="Open the archived snapshot" style={{ fontSize: 9.5, color: "var(--verified)", textDecoration: "none" }}>snapshot ↗</a>
                  </div>
                </div>
              </div>
              {on && spans.length > 0 && <div className="fade-in"><CitedSpanList claims={spans} onJump={onJump} /></div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function MethodsFooter({ sourceList, claimCount, spansForSource, onJump }) {
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginTop: 10 }}>
        {sourceList.map(({ key, num }) => {
          const s = srcOf(key); const spans = spansForSource ? spansForSource(key) : [];
          return (
            <div key={key} style={{ borderBottom: "1px solid var(--rule)", paddingBottom: 6 }}>
              <a href={s.archive_url || s.original_url} target="_blank" rel="noopener" className="headline-link"
                style={{ display: "flex", gap: 8, padding: "6px 6px", textDecoration: "none" }}>
                <span className="claim-marker" style={{ verticalAlign: "baseline", height: "fit-content" }}>{num}</span>
                <span style={{ fontFamily: "var(--serif)", fontSize: 13.5, lineHeight: 1.25 }}>
                  <strong style={{ fontWeight: 600 }}>{s.outlet}.</strong> {s.title}. <span className="np-mono" style={{ fontSize: 10.5, color: "var(--verified)" }}>{s.archive_url ? "archived " + (s.retrieved || "") : "live link"} ↗</span>
                </span>
              </a>
              {/* the exact passages this source grounds — click to jump back up */}
              <CitedSpanList claims={spans} onJump={onJump} />
            </div>
          );
        })}
      </div>
    </footer>
  );
}

Object.assign(window, { ArticleRead });
