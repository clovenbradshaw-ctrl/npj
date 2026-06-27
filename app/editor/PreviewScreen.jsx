/* PreviewScreen.jsx — the editor's standalone "exactly as it will publish" preview.
 *
 * Rebuilt from scratch, decoupled from the reader (ArticleRead). It takes the
 * folded draft article the publish pipeline produces — Newsroom calls
 * NpjArticles.genesisFromContent(content, { preview:true }) and hands us
 * `.article` — and renders it on the paper page.
 *
 * Two invariants this rebuild exists to hold (every past preview bug broke one):
 *
 *   1) ONE FOLD, ONE TRUTH. We render the block model AS GIVEN. We never read the
 *      editor DOM or re-extract text — the fold (htmlToBlocks) already produced
 *      clean blocks, identical to what publish commits (minus the preview flag
 *      that keeps not-yet-uploaded photos visible as `local` blocks). So preview
 *      and publish can't drift, and a citation marker's NUMBER can never leak
 *      into prose: the fold stripped it, and we only ever paint a number as an
 *      explicit chip, gated behind the grounding toggle (off by default).
 *
 *   2) MEDIA FROM MATRIX. Photos draw straight from the Matrix media-store via
 *      the shared ZoomImg/Carousel → MediaImg → resolveDisplay path (it auth-
 *      fetches the mxc bytes to a blob: URL). No archive.org round-trip — what
 *      the author placed on Matrix is what shows, including pending uploads
 *      (badged "won't publish yet").
 *
 * Exposed as window.NpjPreview. Props: { article, onClose, onRefresh, me }.
 */

// Grounding vocabulary — the SAME glyphs/colours the reader and the editor's
// Grounding workspace use (kept in sync with ArticleRead's GROUND_KINDS). Inlined
// so the preview stands alone and never depends on the reader being loaded first.
const PV_GROUND = {
  grounded:       { glyph: "⊤", label: "Grounded",              mark: "#9a8500" },
  multi:          { glyph: "⊨", label: "Multiple sources",      mark: "#9a8500" },
  "own-analysis": { glyph: "⊢", label: "The author's analysis", mark: "#6b5bd6" },
  "own-account":  { glyph: "⊨", label: "The author's account",  mark: "#6b5bd6" },
  "own-position": { glyph: "⊩", label: "The author's position", mark: "#6b5bd6" },
  absence:        { glyph: "∅", label: "Documented void",       mark: "#3a6488" },
  needs:          { glyph: "⊥", label: "Needs a source",        mark: "#b5701b" },
  conflict:       { glyph: "¬", label: "Sources disagree",      mark: "#b3261e" }
};
const PV_STANCE = { analysis: "own-analysis", testimony: "own-account", voice: "own-position", absence: "absence" };
function pvGroundKind(claim) {
  if (!claim) return null;
  if (claim.stance) return PV_STANCE[claim.stance] || "own-analysis";
  const q = claim.q || {};
  const pinned = (claim.src || []).filter(k => q[k] && String(q[k]).trim());
  if (!pinned.length) return "needs";
  return pinned.length > 1 ? "multi" : "grounded";
}

function PvNotUploaded() {
  return (
    <div className="np-mono" style={{ fontSize: 10.5, color: "var(--reject)", display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span aria-hidden="true">⚠</span> Not uploaded yet — this photo won't publish until its upload lands.
    </div>
  );
}
function PvCaption({ caption, credit }) {
  if (!caption && !credit) return null;
  return (
    <figcaption style={{ fontFamily: "var(--cond)", fontSize: 13, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>
      {caption}
      {credit ? <span style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>{window.npjRichText ? window.npjRichText(credit) : credit}</span> : null}
    </figcaption>
  );
}

function NpjPreview(props) {
  const { article, onClose, onRefresh } = props;
  const A = article || { body: [] };
  const body = Array.isArray(A.body) ? A.body : [];

  // Grounding lens — off by default, so the preview opens as a clean read with
  // NO citation-number chips and NO grounding glyphs (exactly the prose). On
  // surfaces the chips + glyphs the way the reader's "full" transparency does.
  const [lens, setLens] = useState(false);
  // re-key embed iframes so Refresh can bust a stale/blank frame
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Number cited sources in first-appearance order (same rule as the reader):
  // a claim's chip is the joined numbers of the sources it cites. Built once per
  // article so the chips are stable; only painted when the lens is on.
  const claimNums = React.useMemo(() => {
    const sourceNums = new Map(); let n = 0; const byId = {};
    const scan = (t) => {
      if (t && t.c != null && t.id && Array.isArray(t.src) && t.src.length) {
        t.src.forEach(k => { if (!sourceNums.has(k)) sourceNums.set(k, ++n); });
        byId[t.id] = t.src.map(k => sourceNums.get(k)).join(", ");
      }
    };
    body.forEach(b => { (b.tokens || []).forEach(scan); (b.items || []).forEach(it => (it || []).forEach(scan)); });
    return byId;
  }, [A]);

  // Token renderer. Mirrors ArticleRead.renderTokens minus all interactivity —
  // text comes CLEAN from the fold, so prose is rendered verbatim; a citation's
  // number is only ever an explicit <sup> chip behind the lens toggle.
  const tok = (tokens) => (tokens || []).map((t, i) => {
    if (typeof t === "string") return <React.Fragment key={i}>{t}</React.Fragment>;
    if (t && t.t) {
      if (t.t === "br") return <br key={i} />;
      if (t.t === "strong") return <strong key={i}>{t.text}</strong>;
      if (t.t === "em") return <em key={i}>{t.text}</em>;
      if (t.t === "s") return <s key={i}>{t.text}</s>;
      if (t.t === "code") return <code key={i} className="np-mono" style={{ fontSize: "0.85em", background: "var(--paper-2)", padding: "0 4px" }}>{t.text}</code>;
      if (t.t === "a") return <a key={i} href={t.href} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline", textDecorationThickness: "1.5px", textUnderlineOffset: 2 }}>{t.text}</a>;
      if (t.t === "sup") {
        // a real footnote marker — its number rides the token (the fold put it
        // there) and links down to the note; this is NOT a citation chip
        const k = t.key || t.text || "";
        if (t.num != null) return (
          <sup key={i} id={"fnref-" + k} className="fnmark" style={{ fontSize: 11, lineHeight: 0 }}>
            <a href={"#fn-" + k} style={{ color: "var(--data)", textDecoration: "none", fontWeight: 600, fontFamily: "var(--mono)" }}>{t.num}</a>
          </sup>
        );
        return <sup key={i} className="np-mono" style={{ fontSize: 11 }}>{t.text}</sup>;
      }
      return <React.Fragment key={i}>{t.text || ""}</React.Fragment>;
    }
    // an OWNED claim (analysis / account / position / documented void): prose,
    // with the grounding glyph only when the lens is on
    if (t && t.c != null && t.stance && (!t.src || !t.src.length)) {
      const kind = PV_STANCE[t.stance] || "own-analysis";
      const VK = window.NpjVoidKinds;
      const vk = t.stance === "absence" && VK ? VK.norm(t.vkind) : null;
      const vdef = vk ? VK.get(vk) : null;
      const gm = PV_GROUND[kind] || PV_GROUND["own-analysis"];
      const glyph = vdef ? vdef.glyph : gm.glyph;
      return (
        <span key={i} id={"claim-" + (t.id || "o" + i)} className="gowned" data-ground={kind} data-void={vk ? VK.reader(vk) : undefined}>
          {t.c}
          {lens && <sup className="gmark" style={{ color: gm.mark }}>{glyph}</sup>}
        </span>
      );
    }
    // a CITED claim: prose, with the citation-number chip + grounding glyph only
    // when the lens is on (default off → clean prose, never a stray number)
    if (t && t.c != null) {
      const gk = pvGroundKind({ src: t.src, q: t.q, stance: t.stance });
      const gm = gk ? PV_GROUND[gk] : null;
      const num = t.id ? claimNums[t.id] : null;
      return (
        <span key={i} id={t.id ? "claim-" + t.id : undefined} className="claim" data-ground={gk || undefined}>
          {t.c}
          {lens && num != null ? <sup className="claim-marker">{num}</sup> : null}
          {lens && gm ? <sup className="gmark" style={{ color: gm.mark }}>{gm.glyph}</sup> : null}
        </span>
      );
    }
    return <React.Fragment key={i}>{(t && (t.c || t.text)) || ""}</React.Fragment>;
  });

  // image figures bleed a touch wider than the text column, like the reader
  const wideFig = (top, bottom) => ({ marginTop: top, marginBottom: bottom, marginLeft: "-7.5%", marginRight: "-7.5%", width: "115%" });
  const hasHero = !!((A.image && A.image.src && A.image.banner) || body.some(b => b.type === "img" && b.banner));
  const topInlineImgIdx = hasHero ? -1 : body.findIndex(b => b.type === "img");
  const firstParaIdx = body.findIndex(b => b.type === "p");

  const ZoomImg = window.ZoomImg, Carousel = window.Carousel, EmbedFigure = window.EmbedFigure;

  const renderImg = (b, i, fig) => (
    <figure key={i} style={fig}>
      {ZoomImg
        ? <ZoomImg image={b} alt={b.description || b.caption || ""} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
        : (window.MediaImg ? <window.MediaImg srcs={[b.store, b.src]} alt={b.description || b.caption || ""} fit={b.fit} crop={b.crop} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} /> : null)}
      {b.local ? <PvNotUploaded /> : null}
      <PvCaption caption={b.caption} credit={b.credit} />
    </figure>
  );

  const renderBlock = (b, i) => {
    if (!b) return null;
    if (b.type === "h2" || b.type === "h3") {
      const Tag = b.type;
      return <Tag key={i} style={{ fontFamily: "var(--display)", fontSize: b.type === "h2" ? 34 : 25, lineHeight: 1.04, margin: "32px 0 12px" }}>{b.text}</Tag>;
    }
    if (b.type === "pull") return (
      <blockquote key={i} style={{ margin: "30px 0", paddingLeft: 22, borderLeft: "3px solid var(--yellow-deep)", fontFamily: "var(--quote)", fontWeight: 300, fontSize: 28, lineHeight: 1.42, letterSpacing: "-.01em" }}>
        {b.text}
        {(b.marks && b.marks.length) ? tok(b.marks) : null}
        {b.attribution ? <footer className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8, fontWeight: 400 }}>{b.attribution}</footer> : null}
      </blockquote>
    );
    if (b.type === "img") {
      if (b.banner) return null; // lifted into the hero above
      return renderImg(b, i, i === topInlineImgIdx ? wideFig(26, 26) : wideFig(26, 26));
    }
    if (b.type === "gallery") {
      const imgs = (b.images || []).filter(im => im && (im.src || im.store));
      if (!imgs.length) return null;
      return Carousel ? <Carousel key={i} images={imgs} caption={b.caption} style={wideFig(26, 26)} /> : null;
    }
    if (b.type === "embed") {
      if (EmbedFigure) return <EmbedFigure key={i + ":" + reloadTick} url={b.url} caption={b.caption} height={b.height} reload={reloadTick} previews />;
      return <p key={i} className="np-mono" style={{ fontSize: 12 }}><a href={b.url} target="_blank" rel="noopener">{b.url}</a></p>;
    }
    if (b.type === "ul" || b.type === "ol") {
      const Tag = b.type;
      return <Tag key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", paddingLeft: 26 }}>{(b.items || []).map((it, j) => <li key={j} style={{ marginBottom: 6 }}>{tok(it)}</li>)}</Tag>;
    }
    if (b.type === "footnotes") {
      const notes = (b.notes || []).filter(n => n && n.key);
      if (!notes.length) return null;
      return (
        <section key={i} aria-label="Footnotes" style={{ margin: "36px 0 8px", paddingTop: 16, borderTop: "2px solid var(--ink)" }}>
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>Notes</div>
          <ol style={{ margin: 0, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 10 }}>
            {notes.map(n => (
              <li key={n.key} id={"fn-" + n.key} value={n.num} style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink)" }}>
                {n.text ? (window.npjRichText ? window.npjRichText(n.text) : n.text) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
                {" "}
                <a href={"#fnref-" + n.key} aria-label="Back to text" onClick={(e) => { e.preventDefault(); const el = document.getElementById("fnref-" + n.key); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }} style={{ color: "var(--data)", textDecoration: "none", fontFamily: "var(--mono)", fontSize: 12.5 }}>↩</a>
              </li>
            ))}
          </ol>
        </section>
      );
    }
    if (b.type === "hr") return <hr key={i} style={{ border: 0, borderTop: "2.5px solid var(--ink)", width: 110, margin: "30px auto" }} />;
    if (b.type === "code") return <pre key={i} className="np-mono np-scroll" style={{ fontSize: 13, lineHeight: 1.55, background: "var(--paper-2)", border: "1.5px solid var(--ink)", padding: "12px 14px", overflowX: "auto", margin: "0 0 20px" }}>{b.text}</pre>;
    if (b.type === "verse") return <pre key={i} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17.5, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: "0 0 20px", padding: "0 0 0 20px", borderLeft: "3px solid var(--rule-strong, var(--ink))" }}>{b.text}</pre>;
    // a paragraph; the lede carries a drop cap on its first character
    if (b.type === "p") {
      const toks = b.tokens || [];
      if (i === firstParaIdx && typeof toks[0] === "string" && toks[0].trim()) {
        const first = toks[0];
        const cap = first.charAt(0);
        const rest = [first.slice(1)].concat(toks.slice(1));
        return (
          <p key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", textWrap: "pretty" }}>
            <span className="np-dropcap-box"><span>{cap}</span></span>{tok(rest)}
          </p>
        );
      }
      return <p key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", textWrap: "pretty" }}>{tok(toks)}</p>;
    }
    return null;
  };

  const heroImg = (A.image && A.image.src && A.image.banner) ? A.image : (body.find(b => b.type === "img" && b.banner) || null);

  // cited sources, numbered the same way the chips are — a compact footer so the
  // author can confirm exactly which sources will ship (only the cited ones do)
  const SRC = (typeof window !== "undefined" && window.NPJ && window.NPJ.SOURCES) || {};
  const usedSources = React.useMemo(() => {
    const order = []; const seen = new Set();
    const scan = (t) => { if (t && Array.isArray(t.src)) t.src.forEach(k => { if (!seen.has(k)) { seen.add(k); order.push(k); } }); };
    body.forEach(b => { (b.tokens || []).forEach(scan); (b.items || []).forEach(it => (it || []).forEach(scan)); (b.marks || []).forEach(scan); });
    return order.map((k, idx) => ({ num: idx + 1, key: k, rec: (A.sources && A.sources[k]) || SRC[k] || { title: k } }));
  }, [A]);

  const isPhone = window.useIsMobile ? window.useIsMobile(760) : false;

  return (
    <div className="fade-in" style={{ position: "fixed", inset: 0, zIndex: 6000, background: "var(--paper)", color: "var(--ink)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", display: "flex", alignItems: "center", gap: 12, padding: isPhone ? "8px 14px" : "10px 22px" }}>
        <span className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontFamily: "var(--mono)" }}>◉</span> {isPhone ? "Preview" : "Preview · exactly as readers will see it"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" aria-pressed={lens} onClick={() => setLens(v => !v)}
          title="Grounding lens — tint each claim by how it's grounded and number its sources. Off shows the clean read."
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: lens ? "var(--yellow)" : undefined, fontWeight: lens ? 700 : undefined }}>
          {window.I && window.I.eye ? <window.I.eye style={{ fontSize: 14 }} /> : null} <span className="npj-hide-sm">Grounding</span>
        </button>
        <button className="btn btn-sm" onClick={() => { setReloadTick(t => t + 1); if (onRefresh) onRefresh(); }}
          title="Refresh — rebuild this preview from the editor and reload every embed, bypassing any cached frame"
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          {window.I && window.I.redo ? <window.I.redo style={{ fontSize: 14 }} /> : null} <span className="npj-hide-sm">Refresh</span>
        </button>
        <button className="btn btn-sm" onClick={onClose} title="Back to the editor (Esc)">✕ Close</button>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: isPhone ? "26px 18px 80px" : "40px 24px 100px" }}>
        <article className={lens ? "ground-lens previews-on" : undefined} style={{ fontFamily: "var(--serif)" }}>
          <header style={{ margin: "0 0 26px" }}>
            {A.kicker ? <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 12 }}>{A.kicker}</div> : null}
            <h1 className="npj-article-h" style={{ fontFamily: "var(--display)", fontSize: 44, lineHeight: 1, letterSpacing: "-.01em", margin: "0 0 20px" }}>{A.headline || "Untitled"}</h1>
            {A.dek ? <p style={{ fontFamily: "var(--serif)", fontSize: 22, lineHeight: 1.4, color: "var(--ink)", margin: "0 0 20px", fontStyle: "italic" }}>{A.dek}</p> : null}
            {(heroImg && heroImg.src) ? (
              <figure style={{ margin: "4px 0 24px" }}>
                {ZoomImg ? <ZoomImg image={heroImg} alt={heroImg.description || heroImg.caption || A.headline || ""} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} /> : null}
                {heroImg.local ? <PvNotUploaded /> : null}
                <PvCaption caption={heroImg.caption} credit={heroImg.credit} />
              </figure>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", paddingBottom: 16, borderBottom: "2px solid var(--ink)" }}>
              {window.Byline ? <window.Byline authors={A.authors} editors={A.editors} byline={A.byline} /> : null}
              <span style={{ flex: 1 }} />
              <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                {window.fmtDate ? window.fmtDate(A.published) : A.published}{A.readMins ? " · " + A.readMins + " min" : ""}
              </span>
            </div>
          </header>

          {body.map(renderBlock)}

          {usedSources.length ? (
            <section aria-label="Sources" style={{ margin: "40px 0 8px", paddingTop: 16, borderTop: "2px solid var(--ink)" }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>Sources</div>
              <ol style={{ margin: 0, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                {usedSources.map(s => {
                  const r = s.rec || {};
                  const label = [r.outlet, r.title || s.key].filter(Boolean).join(" — ");
                  const href = r.archive_url || r.original_url || "";
                  return (
                    <li key={s.key} style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink)" }}>
                      {href ? <a href={href} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline" }}>{label}</a> : label}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </article>
      </div>
    </div>
  );
}

Object.assign(window, { NpjPreview });
