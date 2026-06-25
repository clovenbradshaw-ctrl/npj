/* NPJ article reading experience — the spine.
   Clean Read / Audit Mode + 3 evidence layouts (Ledger / Receipts / Split).
   Articles arrive as folded EO event logs (app/articles.js); the body block
   shapes rendered here are exactly what the log carries. */

// The caption + photo credit under an image. The credit is markdown ([label](url))
// like a contributor bio, rendered through npjRichText so a [outlet](https://…)
// becomes a safe, sanitized link — never raw innerHTML.
// A photo the author placed that hasn't reached the durable store yet (its upload
// is pending or failed). It shows in Preview so the layout is faithful, but it
// won't ride into the published piece until it uploads — say so plainly instead of
// letting it silently vanish at publish. Only ever set on a preview render.
function NotUploadedNote() {
  return (
    <div className="np-mono" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: "var(--reject, #e67b3c)", display: "flex", alignItems: "baseline", gap: 6 }}>
      <span aria-hidden="true">⚠</span>
      <span>Not uploaded yet — this photo won’t appear in the published piece until its upload finishes.</span>
    </div>
  );
}

function PhotoFigCaption({ caption, credit }) {
  if (!caption && !credit) return null;
  return (
    <figcaption className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.45 }}>
      {caption ? <span>▢ {caption}</span> : null}
      {credit ? (
        <span style={{ display: caption ? "block" : "inline", marginTop: caption ? 2 : 0 }}>
          <span className="np-eyebrow" style={{ fontSize: 9.5, letterSpacing: ".05em", marginRight: 5 }}>Credit</span>
          {window.npjRichText ? window.npjRichText(credit) : credit}
        </span>
      ) : null}
    </figcaption>
  );
}

// A source key always resolves to SOMETHING renderable, even if the global
// ledger is missing the record (a torn log line, a stale cache) — a hole in
// the ledger must never take the whole article down with it.
function srcOf(key) {
  return window.NPJ.SOURCES[key] || { id: key, type: "primary", title: key, outlet: "", retrieved: "", archive_url: "", original_url: "" };
}

/* ---- the transparency lens: colour every grounded span by HOW it's grounded ----
   The reader (and the editor's Preview) can switch on a lens that tints each
   claim by its grounding kind, using the SAME vocabulary as the editor's
   Grounding workspace (app/GroundingWorkspace.jsx — proseShade / pillFor): a
   yellow fill for a grounded/cited claim (⊤, or ⊨ for more than one source),
   violet for a claim the author owns (analysis ⊢ / account ⊨ / position ⊩),
   orange + dashed for one that still needs a source (⊥), red for sources that
   disagree (¬). Colours + glyphs match styles.css (.ground-lens …). */
const GROUND_KINDS = {
  grounded:        { glyph: "⊤", label: "Grounded",              color: "#d8c520", mark: "#9a8500", note: "Pinned to a source passage that backs it." },
  multi:           { glyph: "⊨", label: "Multiple sources",      color: "#d8c520", mark: "#9a8500", note: "Backed by more than one pinned source." },
  "own-analysis":  { glyph: "⊢", label: "The author's analysis", color: "#7C74DE", mark: "#6b5bd6", note: "Owned reasoning — grounded by declaration, not a citation." },
  "own-account":   { glyph: "⊨", label: "The author's account",  color: "#7C74DE", mark: "#6b5bd6", note: "First-hand: the author witnessed this." },
  "own-position":  { glyph: "⊩", label: "The author's position", color: "#7C74DE", mark: "#6b5bd6", note: "The author's stated position." },
  absence:         { glyph: "∅", label: "Documented void",       color: "#4D7EA8", mark: "#3a6488", note: "An absence the author asserts — removed, withheld, silent, inaccessible, unrecorded or ambient. The mark and hover say which kind, and whether it is shown, located, or only inferred." },
  needs:           { glyph: "⊥", label: "Needs a source",        color: "#D8632E", mark: "#b5701b", note: "Bound to a source but no passage pinned — the publish gate flags this." },
  conflict:        { glyph: "¬", label: "Sources disagree",      color: "#D8412C", mark: "#b3261e", note: "Two pinned quotes pull opposite ways." }
};
const GROUND_ORDER = ["grounded", "multi", "own-analysis", "own-account", "own-position", "absence", "needs", "conflict"];
const STANCE_KIND = { analysis: "own-analysis", testimony: "own-account", voice: "own-position", absence: "absence" };
// The grounding kind of a claim token, read the same mechanical way the
// workspace's statusOf does — owned (by its declared stance), else by how many
// of its sources carry a pinned quote (none → needs, one → grounded, more →
// multi). No model, no guess; just the token's own grounding.
function groundKind(claim) {
  if (!claim) return null;
  if (claim.stance) return STANCE_KIND[claim.stance] || "own-analysis";
  const q = claim.q || {};
  const pinned = (claim.src || []).filter(k => q[k] && String(q[k]).trim());
  if (!pinned.length) return "needs";
  return pinned.length > 1 ? "multi" : "grounded";
}

function useClaimModel(A) {
  return React.useMemo(() => {
    const claimList = [];
    const sourceNums = new Map();
    let n = 0;
    const scan = (t) => {
      if (t && t.c && Array.isArray(t.src)) {
        t.src.forEach(k => { if (!sourceNums.has(k)) sourceNums.set(k, ++n); });
        claimList.push({ id: t.id, text: t.c, src: t.src, q: t.q || null, num: t.src.map(k => sourceNums.get(k)).join(", ") });
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

/* Float a preview card BESIDE the reading column — out in the margin, never over
   the prose — so it never covers what you're reading yet stays a short hop away.
   Given the marker's rect and the article column's rect it pops to the gutter
   nearest the marker (least pointer travel), skips a gutter an open rail has
   already claimed (the ledger, the suggestions or figures rail), shrinks to fit
   and clamps to the viewport. Returns null when neither margin has room (a narrow
   window) — the caller then drops back to anchoring under the marker. */
function besideColumn(mk, col, opts) {
  if (!mk || !col) return null;
  const { vw, vh, gap = 16, blockL, blockR } = opts;
  const leftRoom = col.left;          // clear margin to the left of the prose
  const rightRoom = vw - col.right;   // …and to the right
  // as wide as a full card, shrunk to the roomier gutter, never below a readable
  // measure (a card narrower than this isn't worth pulling out to the side)
  const best = Math.max(blockL ? 0 : leftRoom, blockR ? 0 : rightRoom);
  // a roomier card than a tooltip — wide enough to read a passage and click into
  // without it feeling cramped, still capped so it stays a margin note, not a panel
  const w = Math.min(404, Math.max(300, best - gap - 12));
  const canL = !blockL && leftRoom >= w + gap + 12;
  const canR = !blockR && rightRoom >= w + gap + 12;
  if (!canL && !canR) return null;
  // pop to whichever margin the marker sits closest to; fall to the other if
  // that side is taken, so the card is the shortest reach from the word
  const nearRight = (mk.left + mk.right) / 2 >= (col.left + col.right) / 2;
  const side = (nearRight ? canR : canL) ? (nearRight ? "right" : "left") : (canR ? "right" : "left");
  const left = side === "right" ? col.right + gap : col.left - gap - w;
  // start the card at the marker's line so it reads as a margin note for it, but
  // keep the whole card on-screen (it scrolls within maxHeight if the note is long)
  const top = Math.max(12, Math.min(mk.top - 2, vh - 172));
  return { left, top, width: w, maxHeight: vh - top - 12 };
}

/* ---- source citation card ---- */
// On a pointer device this floats in the margin beside the hovered claim. On a
// phone there's no hover and no room to pin a card to a tapped word, so it opens
// instead as a dismissible bottom sheet (tap the backdrop or ✕ to close) —
// thumb-reachable and full-width, which is how a touch reader opens the receipts.
function HoverCard({ data, onEnter, onLeave, onSuggest, onClose, suggCount, spansForSource, onJump, preview, onExpand }) {
  // Hooks first, before any early return, so the hook order is stable whether
  // or not a claim is being hovered (data toggles null↔set on hover).
  const [tab, setTab] = useState(0);
  const isPhone = window.useIsMobile(760);
  React.useEffect(() => setTab(0), [data && data.claim && data.claim.id]);
  if (!data) return null;
  const { claim, x, y, srcKeys, mk, col, blockL, blockR } = data;
  const vw = window.innerWidth, vh = window.innerHeight;
  // the other passages this same source backs — so you can hop between them
  const spans = spansForSource ? spansForSource(srcKeys[tab]) : [];

  const sheet = isPhone;
  // On a desktop the card lives in the margin beside the column (besideColumn);
  // only when the window's too narrow for a gutter does it anchor under the marker.
  const beside = sheet ? null : besideColumn(mk, col, { vw, vh, blockL, blockR });
  let cardStyle;
  if (sheet) {
    cardStyle = { left: 0, right: 0, bottom: 0, top: "auto", width: "100%", maxHeight: "72vh", overflowY: "auto",
      borderWidth: "1.5px 0 0", boxShadow: "0 -10px 30px rgba(8,7,5,.4)" };
  } else if (beside) {
    cardStyle = { left: beside.left, top: beside.top, width: beside.width, maxHeight: beside.maxHeight, overflowY: "auto" };
  } else {
    // no room either side — anchor under the marker (flip up near the foot)
    const w = Math.min(404, vw - 24);
    const left = Math.min(Math.max(12, x), vw - w - 12);
    const top = y + 8;
    const flip = top > vh - 260;
    cardStyle = { left, top: flip ? "auto" : top, bottom: flip ? vh - y + 14 : "auto", width: w };
  }

  const inner = (
    <div className="srccard np-scroll" role="dialog" aria-label="Citation for this claim"
      style={cardStyle}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave}>
      {sheet && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderBottom: "1.5px solid var(--ink)",
          position: "sticky", top: 0, background: "var(--card)", zIndex: 1 }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)", flex: 1, display: "inline-flex", alignItems: "center", gap: 6 }}><I.source style={{ fontSize: 14 }} /> Citation</span>
          <button onClick={onClose} aria-label="Close citation" style={{ background: "none", border: 0, fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--ink)", padding: "2px 6px" }}><I.x /></button>
        </div>
      )}
      {srcKeys.length > 1 && (
        <div style={{ display: "flex", borderBottom: "1.5px solid var(--ink)" }}>
          {srcKeys.map((k, i) => (
            <button key={k} onClick={() => setTab(i)} className="np-mono" style={{ flex: 1, fontSize: 10, padding: "4px 6px",
              border: 0, borderRight: i < srcKeys.length - 1 ? "1px solid var(--rule)" : 0,
              background: tab === i ? "var(--yellow)" : "var(--card)", fontWeight: 600 }}>{srcOf(k).id}</button>
          ))}
        </div>
      )}
      <SourceCard srcKey={srcKeys[tab]} quote={claim.q && claim.q[srcKeys[tab]]} preview={preview} onExpand={onExpand} />
      {spans.length > 1 && (
        <div style={{ borderTop: "1.5px solid var(--ink)", maxHeight: 124, overflowY: "auto" }} className="np-scroll">
          <div className="np-eyebrow" style={{ color: "var(--ink-soft)", padding: "7px 10px 1px" }}>Backs {spans.length} passages — {sheet ? "tap" : "click"} to jump</div>
          <CitedSpanList claims={spans} onJump={onJump} currentId={claim.id} />
        </div>
      )}
      {/* Suggest-edit is a reader action; preview is a look-only render of the
         draft (no feedback rail behind it), so the card drops the action there
         and shows just the grounding receipts. */}
      {!preview && (
        <div style={{ display: "flex", borderTop: "1.5px solid var(--ink)", position: sheet ? "sticky" : "static", bottom: 0, background: "var(--card)" }}>
          <button onClick={() => onSuggest(claim.id)} className="np-cond" style={{ flex: 1, padding: sheet ? "13px" : "8px", border: 0, background: "var(--card)",
            fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--mono)" }}>⊨</span> Suggest edit{suggCount ? ` · ${suggCount} open` : ""}
          </button>
        </div>
      )}
    </div>
  );

  if (!sheet) return inner;
  return (
    <React.Fragment>
      <div onClick={onClose} aria-hidden="true" className="fade-in"
        style={{ position: "fixed", inset: 0, zIndex: 3990, background: "rgba(8,7,5,.35)" }} />
      {inner}
    </React.Fragment>
  );
}

// The Substack footnote experience: hover a marker on the desktop (or tap it on a
// phone) and the note floats up in the margin beside it, so you read it without
// losing your place. The note text still has its permanent home in the "Notes"
// endnotes — this card is the inline preview, with a link down to it. Mirrors
// HoverCard's positioning (margin card on a desktop; a bottom sheet on a phone).
function FootnotePop({ data, onEnter, onLeave, onClose, onJump, onExpand }) {
  const isPhone = window.useIsMobile(760);
  if (!data) return null;
  const { num, text, x, y, mk, col, blockL, blockR } = data;
  const vw = window.innerWidth, vh = window.innerHeight;
  const sheet = isPhone;
  // Mirrors HoverCard: float in the margin beside the marker, anchoring under it
  // only when there's no gutter to spare.
  const beside = sheet ? null : besideColumn(mk, col, { vw, vh, blockL, blockR });
  let cardStyle;
  if (sheet) {
    cardStyle = { left: 0, right: 0, bottom: 0, top: "auto", width: "100%", maxHeight: "60vh", overflowY: "auto",
      borderWidth: "1.5px 0 0", boxShadow: "0 -10px 30px rgba(8,7,5,.4)" };
  } else if (beside) {
    cardStyle = { left: beside.left, top: beside.top, width: beside.width, maxHeight: beside.maxHeight, overflowY: "auto" };
  } else {
    const w = Math.min(404, vw - 24);
    const left = Math.min(Math.max(12, x - 16), vw - w - 12);
    const top = y + 8;
    const flip = top > vh - 220;
    cardStyle = { left, top: flip ? "auto" : top, bottom: flip ? vh - y + 14 : "auto", width: w };
  }
  const inner = (
    <div className="fnpop np-scroll" role="dialog" aria-label={"Footnote " + num} style={cardStyle}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="fnpop-h">
        <span className="np-mono fnpop-n">{num}</span>
        <span className="np-eyebrow" style={{ flex: 1, color: "var(--ink-soft)" }}>Note</span>
        {onExpand && (
          <button onMouseDown={e => e.preventDefault()} onClick={() => onExpand(data)} aria-label="Open in full" title="Open in full — take the main stage"
            className="np-mono gpop-open" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, lineHeight: 1.4, cursor: "pointer", padding: "2px 7px", border: "1px solid var(--rule)", borderRadius: 4, background: "none", color: "var(--ink-soft)" }}>
            <I.expand style={{ fontSize: 13 }} /> Open
          </button>
        )}
        {sheet && <button onClick={onClose} aria-label="Close note" style={{ background: "none", border: 0, fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--ink)", padding: "0 2px", marginLeft: 4 }}><I.x /></button>}
      </div>
      <div className="fnpop-b">
        {text ? (window.npjRichText ? window.npjRichText(text) : text) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
      </div>
      <button className="fnpop-jump np-mono" onClick={onJump}>See in Notes ↓</button>
    </div>
  );
  if (!sheet) return inner;
  return (
    <React.Fragment>
      <div onClick={onClose} aria-hidden="true" className="fade-in"
        style={{ position: "fixed", inset: 0, zIndex: 3990, background: "rgba(8,7,5,.35)" }} />
      {inner}
    </React.Fragment>
  );
}

// One place that turns an owned/void token into reader-facing grounding copy, so
// the margin card (GroundingPop) and the full main-stage panel (GroundingStage)
// read it the same way. There's no source to cite — that's the point of an owned
// claim — so this copy IS the receipt.
function groundingDetail(tok) {
  const isAbsence = tok.stance === "absence";
  const kind = isAbsence ? "absence" : (STANCE_KIND[tok.stance] || "own-analysis");
  const gm = GROUND_KINDS[kind] || GROUND_KINDS["own-analysis"];
  const VK = window.NpjVoidKinds;
  const vk = (isAbsence && VK) ? VK.norm(tok.vkind) : null;
  const vdef = vk ? VK.get(vk) : null;
  const reader = (isAbsence && VK) ? VK.reader(vk) : null;   // shown | located | inferred
  const standLine = {
    shown: "Shown — you can point to the absence.",
    located: "Located — the author cites the gap, or says where it's out of reach.",
    inferred: "Inferred — no record; the author is arguing it."
  }[reader];
  return {
    isAbsence,
    glyph: vdef ? vdef.glyph : gm.glyph,
    accent: gm.mark,
    // the kicker echoes the two epistemic kinds the reader named — an assertion by
    // the writer, or a void — and the headline says which one.
    kicker: isAbsence ? "Void" : "Assertion",
    headline: isAbsence ? (vdef ? vdef.label : "Unspecified kind") : gm.label,
    ariaLabel: isAbsence ? (vdef ? vdef.label + " void" : "Documented void") : gm.label,
    blurb: isAbsence ? (vdef ? vdef.blurb : gm.note) : gm.note,
    standLine,
    noteLabel: isAbsence ? "What the author searched" : "In the author's words",
    note: tok.note || "",
    prompt: vdef ? vdef.prompt : ""
  };
}

// The Previews twin of the citation card, for grounded things that have no source
// to cite: an assertion the author owns (their analysis / account / position) or a
// documented void (an asserted absence). Hover (desktop) or tap (phone) one and a
// card floats up in the margin saying HOW it's grounded — by the author's own
// declaration, or by a documented absence of a given kind, and whether that absence
// is shown, located or only inferred (void-kinds.js). Mirrors FootnotePop's
// positioning: a margin card on a desktop, a dismissible bottom sheet on a phone.
function GroundingPop({ data, onEnter, onLeave, onClose, onExpand }) {
  const isPhone = window.useIsMobile(760);
  if (!data) return null;
  const { tok, x, y, mk, col, blockL, blockR } = data;
  const { isAbsence, glyph, accent, kicker, headline, ariaLabel, blurb, standLine, noteLabel } = groundingDetail(tok);
  const vw = window.innerWidth, vh = window.innerHeight;
  const sheet = isPhone;
  // Mirrors FootnotePop: float in the margin beside the marker, anchoring under it
  // only when there's no gutter to spare.
  const beside = sheet ? null : besideColumn(mk, col, { vw, vh, blockL, blockR });
  let cardStyle;
  if (sheet) {
    cardStyle = { left: 0, right: 0, bottom: 0, top: "auto", width: "100%", maxHeight: "62vh", overflowY: "auto",
      borderWidth: "1.5px 0 0", boxShadow: "0 -10px 30px rgba(8,7,5,.4)" };
  } else if (beside) {
    cardStyle = { left: beside.left, top: beside.top, width: beside.width, maxHeight: beside.maxHeight, overflowY: "auto" };
  } else {
    const w = Math.min(404, vw - 24);
    const left = Math.min(Math.max(12, x - 16), vw - w - 12);
    const top = y + 8;
    const flip = top > vh - 220;
    cardStyle = { left, top: flip ? "auto" : top, bottom: flip ? vh - y + 14 : "auto", width: w };
  }
  const inner = (
    <div className="gpop np-scroll" role="dialog" aria-label={ariaLabel} style={cardStyle}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="gpop-h" style={{ borderLeft: "3px solid " + accent }}>
        <span className="gpop-g np-mono" style={{ color: accent }}>{glyph}</span>
        <span className="np-eyebrow" style={{ flex: 1, color: "var(--ink-soft)" }}>{kicker}</span>
        {onExpand && (
          <button onMouseDown={e => e.preventDefault()} onClick={() => onExpand(tok)} aria-label="Open in full" title="Open in full — take the main stage"
            className="np-mono gpop-open" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, lineHeight: 1.4, cursor: "pointer", padding: "2px 7px", border: "1px solid var(--rule)", borderRadius: 4, background: "none", color: "var(--ink-soft)" }}>
            <I.expand style={{ fontSize: 13 }} /> Open
          </button>
        )}
        {sheet && <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--ink)", padding: "0 2px", marginLeft: 4 }}><I.x /></button>}
      </div>
      <div className="gpop-b">
        <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 16, lineHeight: 1.12 }}>{headline}</div>
        {standLine && <div className="np-mono" style={{ fontSize: 10.5, color: accent, marginTop: 4, letterSpacing: ".02em" }}>{standLine}</div>}
        <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{blurb}</p>
        {tok.note ? (
          <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px solid var(--rule)" }}>
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 4 }}>{noteLabel}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{window.npjRichText ? window.npjRichText(tok.note) : tok.note}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
  if (!sheet) return inner;
  return (
    <React.Fragment>
      <div onClick={onClose} aria-hidden="true" className="fade-in"
        style={{ position: "fixed", inset: 0, zIndex: 3990, background: "rgba(8,7,5,.35)" }} />
      {inner}
    </React.Fragment>
  );
}

// A margin card, promoted to the MAIN STAGE: the glance becomes the read. The
// same grounding (a void / an assertion) or footnote a small card previews, blown
// up to a centered, dimmed-backdrop panel you can sit in and study — the reading
// counterpart to the source document explorer (SourceLightbox) a citation opens.
// ✕ / Esc / a click on the margin exits; the article underneath is untouched.
// `stage` is { kind:"ground", tok } or { kind:"note", num, text, key }.
function MainStage({ stage, onClose, onJumpNote }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (!stage) return null;
  const isNote = stage.kind === "note";
  const d = isNote ? null : groundingDetail(stage.tok);
  const accent = isNote ? "var(--data)" : d.accent;
  const glyph = isNote ? "※" : d.glyph;
  const kicker = isNote ? "Footnote" : d.kicker;
  const headline = isNote ? ("Note " + (stage.num != null ? stage.num : "")) : d.headline;
  return (
    <div className="fade-in" onClick={onClose} role="presentation"
      style={{ position: "fixed", inset: 0, zIndex: 6500, background: "rgba(8,7,5,.58)", display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 16px", WebkitOverflowScrolling: "touch" }}>
      <div role="dialog" aria-modal="true" aria-label={headline} onClick={e => e.stopPropagation()} className="np-scroll"
        style={{ width: "min(720px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "var(--card)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 26px 80px rgba(8,7,5,.5)" }}>
        <div style={{ position: "sticky", top: 0, background: "var(--card)", borderBottom: "2px solid var(--ink)", borderLeft: "6px solid " + accent, display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
          <span className="np-mono" style={{ fontSize: 22, lineHeight: 1, color: accent }}>{glyph}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>{kicker}</div>
            <div style={{ fontFamily: "var(--display)", fontSize: 26, lineHeight: 1.04 }}>{headline}</div>
          </div>
          <button onClick={onClose} className="btn btn-sm" title="Close (Esc)">✕ Close</button>
        </div>
        <div style={{ padding: "20px 24px 26px" }}>
          {isNote ? (
            <React.Fragment>
              <div style={{ fontFamily: "var(--serif)", fontSize: 17.5, lineHeight: 1.62, color: "var(--ink)" }}>
                {stage.text ? (window.npjRichText ? window.npjRichText(stage.text) : stage.text) : <span style={{ color: "var(--ink-soft)" }}>— (no note text)</span>}
              </div>
              {onJumpNote && stage.key && (
                <button className="btn btn-sm" style={{ marginTop: 18 }} onClick={() => { onClose(); onJumpNote(stage.key); }}>See in Notes ↓</button>
              )}
            </React.Fragment>
          ) : (
            <React.Fragment>
              {d.standLine && <div className="np-mono" style={{ fontSize: 12, color: accent, letterSpacing: ".02em", marginBottom: 10 }}>{d.standLine}</div>}
              <p style={{ fontFamily: "var(--serif)", fontSize: 17.5, lineHeight: 1.6, margin: "0 0 4px", color: "var(--ink)" }}>{d.blurb}</p>
              {d.note ? (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1.5px solid var(--ink)" }}>
                  <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 6 }}>{d.noteLabel}</div>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.6, color: "var(--ink)" }}>{window.npjRichText ? window.npjRichText(d.note) : d.note}</div>
                </div>
              ) : (
                <div className="np-mono" style={{ marginTop: 16, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
                  {d.isAbsence ? "The author recorded no search behind this void." : "The author added no note beyond the stance above."}
                  {d.prompt ? <div style={{ marginTop: 6, fontStyle: "italic" }}>{d.isAbsence ? "A void of this kind is best backed by: " + d.prompt : ""}</div> : null}
                </div>
              )}
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

// MediaImg / CropFrame / imageCandidates moved to app/shared.jsx (eager): the
// front page renders cover photos through window.MediaImg before the reader
// bundle loads, so the image components must exist in the always-loaded core.
// They are referenced below as globals (same names), unchanged in behaviour.

// An embedded media block: the EO log only stores the URL, so the reader
// rebuilds the player from it — a YouTube/Vimeo iframe, a native <video> or
// <audio> for direct media files, or (for anything we don't recognize) the
// link card, since the committed artifact is always the URL itself.
function EmbedFigure({ url, caption, height, reload }) {
  const u = String(url || "");
  let host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
  // one resolver (window.NpjEmbed) maps the stored permalink to a player, the
  // same one the composer used — YouTube/Vimeo (16:9), Google Drive/Docs &
  // archive.org files (a fixed-height frame), or a direct <video>/<audio>.
  const E = window.NpjEmbed;
  const r = E && E.resolve(u);
  let media = null;
  if (r && r.frame) {
    const style = r.panel
      ? { width: "100%", height: (height || (E && E.DEFAULT_HEIGHT) || 600), border: 0, display: "block" }
      : { width: "100%", aspectRatio: r.aspect || "16 / 9", border: 0, display: "block" };
    // `reload` is the preview's refresh counter. When non-zero we hang it on the
    // src as a throwaway param so the browser re-fetches the frame instead of
    // serving the cached (or transiently failed) first load. The stored block keeps
    // the clean URL; the reader passes no reload, so its src is untouched.
    const src = reload ? r.src + (r.src.indexOf("?") >= 0 ? "&" : "?") + "npjcb=" + reload : r.src;
    media = <iframe src={src} title={caption || "embedded media"} style={style} allow={r.allow || undefined} allowFullScreen={!!r.fullscreen} loading="lazy" />;
  }
  else if (r && r.kind === "video") media = <video controls preload="metadata" src={u} style={{ width: "100%", maxHeight: 460, background: "#000", display: "block" }} />;
  else if (r && r.kind === "audio") media = <audio controls preload="metadata" src={u} style={{ width: "100%" }} />;
  if (media) return (
    <figure style={{ margin: "26px 0" }}>
      <div style={{ border: "1.5px solid var(--ink)", background: "#000", lineHeight: 0 }}>{media}</div>
      {caption && <figcaption className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7, lineHeight: 1.45 }}>{r && r.panel ? "▣" : "▶"} {caption}</figcaption>}
    </figure>
  );
  return (
    <figure style={{ margin: "24px 0", border: "1.5px solid var(--ink)", background: "var(--card)", padding: "12px 14px" }}>
      <a href={u} target="_blank" rel="noopener" className="np-mono" style={{ fontSize: 12.5, color: "var(--data)", textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>↗ {host || u}</a>
      {caption && <figcaption className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 5 }}>{caption}</figcaption>}
    </figure>
  );
}

function ArticleRead(props) {
  const { audit, setAudit, showSugg, setShowSugg,
          suggestions = [], onVote, onResolve, onReply, onMerge, onAddSuggestion, filter, setFilter,
          me, onHome, onNewsroom, onEdited,
          // Preview mode: render a draft EXACTLY as the public reader will, from a
          // prebuilt article object (the editor's live content folded through the
          // very same publish pipeline). Same Header + Body the reader uses, just
          // dropped on the paper page with a Close affordance — no masthead,
          // control bar, evidence rails or modals.
          preview, previewArticle, onClose, onRefresh } = props;
  const { entityData, entityOpen, setEntityOpen, activeEntity, setActiveEntity } = props;
  const A = preview ? (previewArticle || { body: [] }) : window.NPJ.ARTICLE;
  const { isAdmin } = React.useContext(window.LayoutCtx);
  const { claimList, claimById, sourceNums, sourceList } = useClaimModel(A);
  // the transparency lens — colour each claim by how it's grounded. Local to this
  // reader instance, so the live page and the editor's Preview each carry their
  // own. Off by default: a clean read.
  const [transparency, setTransparency] = useState(false);
  // Preview's "Refresh" bumps this. It re-keys every embed (forcing a brand-new
  // iframe element) and rides along as a throwaway cache-buster on the frame src,
  // so an embed that failed or got cached on its first load is fetched fresh —
  // the way to tell a real rendering bug from a stale frame. Stays 0 in the reader.
  const [reloadTick, setReloadTick] = useState(0);
  // a count per grounding kind, for the lens legend
  const groundTally = React.useMemo(() => {
    const tally = {};
    const bump = (k) => { if (k) tally[k] = (tally[k] || 0) + 1; };
    const scan = (t) => {
      if (!t || t.c == null) return;
      if (t.stance) bump(STANCE_KIND[t.stance] || "own-analysis");
      else if (Array.isArray(t.src) && t.src.length) bump(groundKind({ src: t.src, q: t.q }));
    };
    (A.body || []).forEach(b => { (b.tokens || []).forEach(scan); (b.items || []).forEach(it => it.forEach(scan)); });
    return tally;
  }, [A]);
  const [hover, setHover] = useState(null);
  const [activeSrc, setActiveSrc] = useState(null);
  // a source document, expanded to fill the screen (in-app, never a new tab).
  // Holds { keys, start } — an ordered slice of source keys and where to open —
  // so the lightbox can tab through them; null when closed. Opening it also
  // dismisses the floating hover card so nothing lingers behind the lightbox.
  const [lightbox, setLightbox] = useState(null);
  // a citation card's "View document" opens just that one source (no nav)
  const openLightbox = useCallback((key) => { setLightbox({ keys: [key], start: 0 }); setHover(null); setActiveSrc(null); }, []);
  // the Sources explorer opens a set of sources (whatever the reader has filtered
  // to) at the one they clicked, so they read it full-size IN THE APP and tab
  // through that exact set with ‹ › / ← → — never navigated off the page.
  const openSourceGallery = useCallback((keys, i) => {
    const list = (Array.isArray(keys) ? keys : sourceList.map(x => x.key)).filter(Boolean);
    if (!list.length) return;
    setLightbox({ keys: list, start: Math.max(0, Math.min(list.length - 1, i || 0)) });
    setHover(null); setActiveSrc(null);
  }, [sourceList]);
  // footnotes, keyed for the inline hover/tap preview (the Substack feel)
  const [fnPop, setFnPop] = useState(null);
  const fnLeaveTimer = useRef(null);
  // an owned claim or a void — the author's own analysis/account/position, or a
  // documented absence — previews the same way a citation does: hover (desktop)
  // or tap (phone) floats up a card explaining HOW it's grounded. There's no
  // source to cite (that's the point), so it carries its own light card (GroundingPop).
  const [groundPop, setGroundPop] = useState(null);
  const groundLeaveTimer = useRef(null);
  // a popup promoted to the main stage — a void/assertion or a note, blown up to a
  // centered reading panel. Holds { kind:"ground", tok } or { kind:"note", … }.
  // Opening it dismisses the floating cards so nothing lingers behind the panel.
  const [stage, setStage] = useState(null);
  const openStage = useCallback((s) => { setStage(s); setGroundPop(null); setFnPop(null); setHover(null); }, []);
  // Source & note previews — the margin cards that float up when you hover a claim
  // or a footnote. On by default (that's the point of a grounded read), but a
  // reader who wants nothing popping up can switch them off, and the choice sticks.
  const [previews, setPreviews] = useState(() => {
    try { return localStorage.getItem("npj.previews") !== "0"; } catch (e) { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("npj.previews", previews ? "1" : "0"); } catch (e) {}
    // turning them off dismisses anything currently floating
    if (!previews) { setHover(null); setFnPop(null); setGroundPop(null); setActiveSrc(null); }
  }, [previews]);
  const footnoteByKey = React.useMemo(() => {
    const m = {};
    (A.body || []).forEach(b => { if (b.type === "footnotes") (b.notes || []).forEach(n => { if (n && n.key) m[n.key] = n; }); });
    return m;
  }, [A.body]);
  // span feedback: a compose draft pinned to a span ({ quote, anchor, kind }),
  // and the floating select-to-suggest bubble ({ x, y, range, claimId })
  const [compose, setCompose] = useState(null);
  const [bubble, setBubble] = useState(null);
  const bodyRef = useRef(null);
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [editing, setEditing] = useState(false);
  // the Contents outline is a disclosure: collapsed by default, expand to jump
  const [tocOpen, setTocOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState(null);
  const [reverting, setReverting] = useState(null);   // sha being restored | "undo" | null
  const [revertErr, setRevertErr] = useState(null);
  // below this width the source rail stacks under the article instead of
  // squeezing the reading column
  const isNarrow = window.useIsMobile(900);
  // a true phone: the side rails overlay the page (rather than pushing the
  // reading column off-screen), and tapping a claim opens its citation as a
  // bottom sheet, since there's no hover on touch
  const isPhone = window.useIsMobile(760);
  // edit-after-publish: the admin always; otherwise only the article's
  // assignees (the publisher is one by default — see genesisFromContent)
  const canEditArticle = isAdmin || (Array.isArray(A.assignees) && A.assignees.includes(me));
  const leaveTimer = useRef(null);
  // which margin an open rail has claimed, so a preview card dodges to the other
  // side (in Preview there are no rails, so both margins are free)
  const railBlockR = !preview && (audit || showSugg);
  const railBlockL = !preview && entityOpen;
  const artSlug = (s) => "h-" + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const headings = (A.body || []).filter(b => b.type === "h2" || b.type === "h3").map(b => ({ id: artSlug(b.text), text: b.text, level: b.type === "h2" ? 2 : 3 }));
  // the Sources footer is a section too — list it at the foot of Contents so a
  // reader can jump straight to the receipts (#article-sources anchors the footer).
  const tocItems = sourceList.length
    ? [...headings, { id: "article-sources", text: "Sources", level: 2 }]
    : headings;
  // scrollIntoView walks to the element's actual scroll container — the window
  // in the live read, but the fixed overlay in Preview — so it moves the page
  // the reader is looking at, not whatever's behind it. The headings carry
  // scrollMarginTop: 90, so block:"start" leaves room under the masthead.
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const artVersions = A.versions && A.versions.length ? A.versions : [{ sha: A.base_sha || "v1", ts: A.published, author: (A.authors || [])[0], message: "Published", headline: A.headline || "", dek: A.dek || "", text: window.NPJ.articlePlainText() }];

  const showMarkers = audit;
  const openByClaim = {};
  suggestions.forEach(s => { if (s.status === "proposed" || s.status === "review") openByClaim[s.claimId] = (openByClaim[s.claimId] || 0) + 1; });

  const enterClaim = useCallback((e, claim) => {
    if (!previews) return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const c = bodyRef.current && bodyRef.current.getBoundingClientRect();
    setHover({ claim, x: r.left, y: r.bottom, srcKeys: claim.src,
      mk: { top: r.top, left: r.left, right: r.right }, col: c && { left: c.left, right: c.right },
      blockL: railBlockL, blockR: railBlockR });
    setActiveSrc(claim.src[0]);
  }, [previews, railBlockL, railBlockR]);
  // a generous grace period — the card sits out in the margin and is a real
  // surface to read and click into (expand to the full document, hop between
  // passages), so it lingers well after the pointer leaves and only fades once
  // you've clearly moved on. Moving onto the card cancels the timer entirely.
  const scheduleLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => { setHover(null); setActiveSrc(null); }, 600);
  }, []);
  const cancelLeave = useCallback(() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  // footnote preview: hover (desktop) or tap (phone) a marker → the note floats
  // up next to it; leaving hides it after a beat so a slide into the card keeps
  // it open. A click still jumps down to the note's home in the endnotes.
  const enterFn = useCallback((e, key) => {
    if (!previews) return;
    const n = footnoteByKey[key]; if (!n) return;
    if (fnLeaveTimer.current) clearTimeout(fnLeaveTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const c = bodyRef.current && bodyRef.current.getBoundingClientRect();
    setFnPop({ key, num: n.num, text: n.text, x: r.left, y: r.bottom,
      mk: { top: r.top, left: r.left, right: r.right }, col: c && { left: c.left, right: c.right },
      blockL: railBlockL, blockR: railBlockR });
  }, [footnoteByKey, previews, railBlockL, railBlockR]);
  const scheduleFnLeave = useCallback(() => {
    if (fnLeaveTimer.current) clearTimeout(fnLeaveTimer.current);
    fnLeaveTimer.current = setTimeout(() => setFnPop(null), 600);
  }, []);
  const cancelFnLeave = useCallback(() => { if (fnLeaveTimer.current) clearTimeout(fnLeaveTimer.current); }, []);
  const jumpToFn = useCallback((key) => {
    setFnPop(null);
    const el = document.getElementById("fn-" + key);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // owned-claim / void preview — mirrors enterFn: hover (desktop) or tap (phone)
  // an assertion the author owns (analysis/account/position) or a documented void,
  // and a card explaining HOW it's grounded floats up beside it; leaving hides it
  // after a beat so a slide onto the card keeps it open. Gated on Previews, exactly
  // like the citation and footnote cards.
  const enterGround = useCallback((e, tok) => {
    if (!previews || !tok) return;
    if (groundLeaveTimer.current) clearTimeout(groundLeaveTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const c = bodyRef.current && bodyRef.current.getBoundingClientRect();
    setGroundPop({ tok, x: r.left, y: r.bottom,
      mk: { top: r.top, left: r.left, right: r.right }, col: c && { left: c.left, right: c.right },
      blockL: railBlockL, blockR: railBlockR });
  }, [previews, railBlockL, railBlockR]);
  const scheduleGroundLeave = useCallback(() => {
    if (groundLeaveTimer.current) clearTimeout(groundLeaveTimer.current);
    groundLeaveTimer.current = setTimeout(() => setGroundPop(null), 600);
  }, []);
  const cancelGroundLeave = useCallback(() => { if (groundLeaveTimer.current) clearTimeout(groundLeaveTimer.current); }, []);

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
  // the passages a source backs, rendered inside the in-app viewer — clicking one
  // closes the sheet and jumps to that exact span in the story (it stays on the
  // page; nothing opens a new tab)
  const renderCitedForSource = useCallback((key) => {
    const spans = spansForSource(key);
    if (!spans || !spans.length) return null;
    return (
      <React.Fragment>
        <div className="np-eyebrow" style={{ color: "var(--ink-soft)", margin: "0 0 5px" }}>
          Backs {spans.length} passage{spans.length !== 1 ? "s" : ""} in the story — click to jump
        </div>
        <CitedSpanList claims={spans} onJump={(id) => { setLightbox(null); jumpToClaim(id); }} />
      </React.Fragment>
    );
  }, [spansForSource, jumpToClaim]);

  // Open the composer pinned to a bound claim (from the hover card) — the whole
  // claim span is the anchor, by its stable id.
  const startCompose = (claimId, kind) => {
    const claim = claimById[claimId];
    if (!claim) return;
    setCompose({ quote: claim.text, anchor: window.NpjFeedback.anchorFromClaim(claim), kind: kind || "suggestion" });
    setShowSugg(true); setHover(null); setBubble(null);
  };

  // ---- select-to-suggest: pick any words in the story → a floating bubble ----
  const closestClaimId = (node) => {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    el = el && el.closest ? el.closest(".claim") : null;
    return el && el.id && el.id.indexOf("claim-") === 0 ? el.id.slice(6) : null;
  };
  const refreshBubble = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !bodyRef.current) { setBubble(null); return; }
    const r = sel.getRangeAt(0);
    if (!bodyRef.current.contains(r.commonAncestorContainer) || r.toString().trim().length < 2) { setBubble(null); return; }
    const rect = r.getBoundingClientRect();
    setBubble({ x: rect.left + rect.width / 2, y: rect.top, range: r.cloneRange(), claimId: closestClaimId(r.commonAncestorContainer) });
  }, [claimById]);
  const openComposeFromBubble = (kind) => {
    if (!bubble) return;
    const anchor = window.NpjFeedback.makeAnchor(bodyRef.current, bubble.range, bubble.claimId);
    if (!anchor) { setBubble(null); return; }
    setCompose({ quote: bubble.range.toString(), anchor, kind });
    setShowSugg(true); setBubble(null);
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
  };
  // dismiss the bubble on a fresh click elsewhere or on scroll
  useEffect(() => {
    if (!bubble) return;
    const down = (e) => { if (!e.target.closest || !e.target.closest(".fb-bubble")) setBubble(null); };
    window.addEventListener("scroll", () => setBubble(null), { passive: true, once: true });
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [bubble]);

  // paint every open suggestion's span into the prose (Google-Docs feel), and
  // re-locate them whenever the feedback list or the audit DOM changes
  useEffect(() => {
    if (!bodyRef.current || !window.NpjFeedback) return;
    const t = setTimeout(() => {
      const anchors = (suggestions || [])
        .filter(s => (s.status === "proposed" || s.status === "review") && s.anchor)
        .map(s => s.anchor);
      window.NpjFeedback.paintAnchors(bodyRef.current, anchors);
    }, 60);
    return () => { clearTimeout(t); window.NpjFeedback.clearAnchors(); };
  }, [suggestions, audit]);

  // Esc leaves the preview overlay (no-op in the normal reader)
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);

  const showInText = (s) => { if (s && s.anchor && bodyRef.current) window.NpjFeedback.flash(bodyRef.current, s.anchor); };

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
      versions: [{ sha: out.sha, ts, author: me, message: next === "unpublished" ? "Unpublished" : "Republished", headline: A.headline || "", dek: A.dek || "", text: window.NPJ.articlePlainText() }, ...(A.versions || [])]
    };
    setStatusBusy(false);
    if (onEdited) onEdited(updated);
  };

  // editor-only: revert the whole document to an earlier version (or undo a
  // revert — same move, aimed at the version the revert replaced). Append-only:
  // one REC re-asserts that version's folded state, so the piece reads as it did
  // then while the revert itself stays in the log. Mirrors changeStatus — the
  // webhook re-verifies the token; we optimistically refold via onEdited so the
  // reader and front page reflect the restore at once.
  const revertTo = async (version, opts) => {
    opts = opts || {};
    if (!version || !version.snapshot) return;
    setRevertErr(null);
    const token = window.MatrixAuth && window.MatrixAuth.token();
    if (!token) { setRevertErr("Sign in with Matrix to revert — the webhook re-verifies the token server-side."); return; }
    const when = String(version.ts || "").slice(0, 10);
    const note = opts.undo
      ? "Undid revert — restored v." + version.sha
      : "Reverted to v." + version.sha + (when ? " · " + when : "");
    const operand = window.NpjArticles.revertOperand(version.snapshot, { to: version.sha, ts: version.ts, undo: !!opts.undo });
    setReverting(opts.undo ? "undo" : version.sha);
    let out;
    try {
      out = await window.NpjArticles.appendEdit({ slug: A.slug, operand, actor: me, note, token, message: (opts.undo ? "undo-revert: " : "revert: ") + A.slug + " → v." + version.sha });
    } catch (e) {
      setReverting(null);
      setRevertErr("Couldn't reach the publish webhook: " + (e.message || "network error") + ". Nothing changed.");
      return;
    }
    if (out.res.status === 401 || out.res.status === 403) { setReverting(null); setRevertErr("Rejected (" + out.res.status + ") — that Matrix account isn't authorized to edit this article."); return; }
    if (!out.res.ok) { setReverting(null); setRevertErr("The webhook answered HTTP " + out.res.status + " — nothing changed."); return; }
    // Re-derive the restored article through the SAME fold the reader loads with,
    // so image/read-time/body all match a fresh load; then splice the real history
    // back on (foldLog of a lone event only knows its own one version).
    const refolded = window.NpjArticles.foldLog(window.NpjArticles.genesisLine(operand, me));
    const restored = refolded.article || {};
    const ts = new Date().toISOString();
    const head = {
      sha: out.sha, ts, author: me, op: "REC", note, message: note,
      headline: restored.headline || "", dek: restored.dek || "",
      text: window.NpjArticles.plainText(restored.body),
      snapshot: Object.assign({}, version.snapshot),
      revert: { to: version.sha, ts: version.ts, undo: !!opts.undo }
    };
    // the restored body's citations join the live ledger so they resolve at once
    Object.keys(refolded.sources || {}).forEach(k => { window.NPJ.SOURCES[k] = Object.assign(window.NPJ.SOURCES[k] || {}, refolded.sources[k]); });
    const updated = Object.assign({}, A, restored, {
      // a revert restores content + publish-state, never the access list — keep
      // the current assignees so an editor can't revert away their own rights
      assignees: A.assignees,
      sources: Object.assign({}, A.sources || {}, restored.sources || {}),
      base_sha: out.sha, updated: ts.slice(0, 10),
      storage: A.storage, logPath: A.logPath,
      versions: [head].concat(A.versions || [])
    });
    setReverting(null);
    if (onEdited) onEdited(updated);
  };

  // a spoken description of a claim's grounding, for screen readers — the
  // citation card is visual, so the label carries the same promise: what backs
  // this claim, and how to open the receipts.
  const claimAria = (claim) => {
    const names = claim.src.map(k => { const s = srcOf(k); return s.title || s.id || k; });
    const n = names.length;
    return "Sourced claim. Backed by " + n + " " + (n === 1 ? "source" : "sources") + ": " + names.join("; ") + ". Press Enter to view the citation.";
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
      if (t.t === "a") return <a key={i} href={t.href} target="_blank" rel="noopener" style={{ color: "var(--data)", textDecoration: "underline", textDecorationThickness: "1.5px", textUnderlineOffset: 2 }}>{t.text}</a>;
      if (t.t === "sup") {
        // a footnote marker: hover (desktop) or tap (phone) previews the note
        // inline; a click jumps down to its home in the endnotes (and the note
        // links back). Older logs with no number fall back to plain text.
        if (t.num != null) {
          const k = t.key || t.text || "";
          return (
            <sup key={i} id={"fnref-" + k} className="fnmark" style={{ fontSize: 11, lineHeight: 0 }}>
              <a href={"#fn-" + k} aria-label={"Footnote " + t.num} aria-describedby={"fn-" + k}
                onMouseEnter={isPhone ? undefined : (e) => enterFn(e, k)}
                onMouseLeave={isPhone ? undefined : scheduleFnLeave}
                onClick={(e) => { e.preventDefault(); if (isPhone && previews) enterFn({ currentTarget: e.currentTarget }, k); else jumpToFn(k); }}
                style={{ color: "var(--data)", textDecoration: "none", fontWeight: 600, fontFamily: "var(--mono)" }}>{t.num}</a>
            </sup>
          );
        }
        return <sup key={i} className="np-mono" style={{ fontSize: 11 }}>{t.text}</sup>;
      }
      return <React.Fragment key={i}>{t.text || ""}</React.Fragment>;
    }
    // an OWNED claim — the author's analysis/account/position, or a documented
    // void (an asserted absence). It publishes as prose and reads like it; the
    // transparency lens tints it, and — like a citation — Previews floats up a
    // card on hover/tap saying HOW it's grounded. No source card; there's no
    // citation. That's the whole point of an owned claim.
    if (t && t.c != null && t.stance && (!t.src || !t.src.length)) {
      const kind = STANCE_KIND[t.stance] || "own-analysis";
      const gm = GROUND_KINDS[kind];
      // An asserted absence is a distinct epistemic claim and carries WHICH kind it
      // is (removed/withheld/silent/inaccessible/unrecorded/ambient): the kind sets
      // the mark glyph and shades it by whether the absence is shown, located, or
      // only inferred (data-void; see void-kinds.js + styles.css). The lens-on glyph
      // surfaces it visually; the hover card (GroundingPop) reads it out in full.
      const isAbsence = t.stance === "absence";
      const VK = window.NpjVoidKinds;
      const vk = isAbsence && VK ? VK.norm(t.vkind) : null;
      const vdef = vk ? VK.get(vk) : null;
      const glyph = vdef ? vdef.glyph : gm.glyph;
      const oid = t.id || "o" + i;
      // With Previews on, the floating card carries the whole explanation, so the
      // native title would only double it up — keep title as the quiet fallback for
      // a previews-off reader who still has the lens on.
      const title = (previews || !transparency) ? undefined
        : isAbsence
          ? ((vdef ? vdef.label + " void — you can " + ({ shown: "point to it", located: "locate it", inferred: "only assert it" }[VK.reader(vk)]) : gm.label) + (t.note ? " — " + t.note : ""))
          : gm.label;
      // the card needs the token's grounding fields; pass a trim copy with a stable id
      const ownedTok = { id: oid, c: t.c, stance: t.stance, note: t.note, vkind: t.vkind };
      const gAria = isAbsence
        ? ((vdef ? vdef.label : "Unspecified") + " void — an asserted absence" + (vk ? ", " + VK.reader(vk) : "") + ". Press Enter for how it's grounded.")
        : (gm.label + " — " + gm.note + " Press Enter for detail.");
      const popOpen = !!(groundPop && groundPop.tok && groundPop.tok.id === oid);
      // Interactive only while Previews is on. Off → an inert, plain span (the
      // clean read): no card, no focus stop, just the lens's optional tint + title.
      const popProps = previews ? {
        tabIndex: 0, role: "button", "aria-haspopup": "dialog",
        "aria-expanded": popOpen ? "true" : "false", "aria-label": gAria,
        onMouseEnter: isPhone ? undefined : (e) => enterGround(e, ownedTok),
        onMouseLeave: isPhone ? undefined : scheduleGroundLeave,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (popOpen) setGroundPop(null);
            else enterGround({ currentTarget: e.currentTarget }, ownedTok);
          } else if (e.key === "Escape" && groundPop) {
            e.stopPropagation(); setGroundPop(null); e.currentTarget.focus();
          }
        },
        onClick: (e) => { if (isPhone) enterGround({ currentTarget: e.currentTarget }, ownedTok); }
      } : {};
      return (
        <span key={i} id={"claim-" + oid} className="gowned" data-ground={kind} data-void={vk ? VK.reader(vk) : undefined}
          title={title} {...popProps}>
          {ent ? markEntities(t.c, ent, "o" + i) : t.c}
          {transparency && <sup className="gmark" style={{ color: gm.mark }}>{glyph}</sup>}
        </span>
      );
    }
    const claim = claimById[t.id];
    if (!claim) return <React.Fragment key={i}>{t.c || ""}</React.Fragment>;
    const gk = groundKind(claim);
    return (
      <span key={i} id={"claim-" + t.id} className="claim" data-sugg={openByClaim[t.id] ? "1" : "0"}
        data-ground={gk}
        data-active={claim.src.includes(activeSrc) ? "1" : "0"}
        tabIndex={0} role="button" aria-haspopup="dialog"
        aria-expanded={hover && hover.claim.id === t.id ? "true" : "false"}
        aria-label={claimAria(claim)}
        onMouseEnter={isPhone ? undefined : (e) => enterClaim(e, claim)} onMouseLeave={isPhone ? undefined : scheduleLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (hover && hover.claim.id === t.id) { setHover(null); setActiveSrc(null); }
            else enterClaim({ currentTarget: e.currentTarget }, claim);
          } else if (e.key === "Escape" && hover) {
            e.stopPropagation(); setHover(null); setActiveSrc(null); e.currentTarget.focus();
          }
        }}
        onClick={(e) => { if (isPhone) enterClaim({ currentTarget: e.currentTarget }, claim); else setShowSugg(true); }}>
        {ent ? markEntities(t.c, ent, "c" + i) : t.c}
        {showMarkers && <sup className="claim-marker">{claim.num}</sup>}
        {transparency && gk && <sup className="gmark" style={{ color: GROUND_KINDS[gk].mark }}>{GROUND_KINDS[gk].glyph}</sup>}
      </span>
    );
  });

  // Images run wider than the text column — a 15% even bleed into the margins on
  // either side — so a photo carries more presence than the prose measure. This is
  // a READER treatment only: the prose editor keeps images at the column width
  // (styles.css drops the old `.nr-page` bleed). Held to the column on a phone (no
  // room to bleed) and in audit mode (the source rails claim those margins).
  // Embeds (video / link cards) keep the text width.
  const wideMedia = !audit && !isPhone;
  const wideFig = (top, bottom) => wideMedia
    ? { marginTop: top, marginBottom: bottom, marginLeft: "-7.5%", marginRight: "-7.5%", width: "115%" }
    : { marginTop: top, marginBottom: bottom };
  // The topmost image is the WIDEST — a bigger bleed than the inline 15%, centered
  // on the column (margin-left 50% + translateX) and clamped between the inline
  // width and a viewport-bounded max, so it always reads widest yet never spills
  // past the screen edge. With a banner that's the hero (lifted above); without one
  // it's the first inline image (topInlineImgIdx).
  const heroFig = (top, bottom) => wideMedia
    ? { marginTop: top, marginBottom: bottom, width: "min(132%, max(115%, calc(100vw - 24px)))", marginLeft: "50%", transform: "translateX(-50%)" }
    : { marginTop: top, marginBottom: bottom };
  const hasHero = !!((A.image && A.image.src && A.image.banner) || (A.body || []).some(b => b.type === "img" && b.banner));
  const topInlineImgIdx = hasHero ? -1 : (A.body || []).findIndex(b => b.type === "img");

  const Body = (
    <article ref={bodyRef} className={[transparency ? "ground-lens" : "", previews ? "previews-on" : ""].filter(Boolean).join(" ") || undefined} style={{ fontFamily: "var(--serif)" }}
      onMouseUp={() => setTimeout(refreshBubble, 0)} onKeyUp={(e) => { if (e.shiftKey || e.key === "Shift") setTimeout(refreshBubble, 0); }}>
      {A.body.map((b, i) => {
        if (b.type === "h2" || b.type === "h3") {
          const Tag = b.type;
          return <Tag key={i} id={artSlug(b.text)} style={{ fontFamily: "var(--display)", fontSize: b.type === "h2" ? 34 : 25, lineHeight: 1.04, margin: "32px 0 12px", scrollMarginTop: 90 }}>{b.text}</Tag>;
        }
        if (b.type === "pull") return (
          <blockquote key={i} style={{ margin: "30px 0", paddingLeft: 22, borderLeft: "3px solid var(--yellow-deep)",
            fontFamily: "var(--quote)", fontWeight: 300, fontSize: 28, lineHeight: 1.42, letterSpacing: "-.01em" }}>
            {b.text}
            {(b.marks && b.marks.length) ? renderTokens(b.marks) : null}
            {b.attribution ? <footer className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8, fontWeight: 400 }}>{b.attribution}</footer> : null}
          </blockquote>
        );
        if (b.type === "img") {
          if (b.banner) return null; // the banner is lifted into the hero above — never inline
          return (
            <figure key={i} style={(!b.banner && i === topInlineImgIdx) ? heroFig(26, 26) : wideFig(26, 26)}>
              <ZoomImg image={b} alt={b.description || b.caption || ""} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
              {b.local ? <NotUploadedNote /> : null}
              <PhotoFigCaption caption={b.caption} credit={b.credit} />
            </figure>
          );
        }
        if (b.type === "gallery") {
          const imgs = (b.images || []).filter(im => im && (im.src || im.store));
          if (!imgs.length) return null;
          return <Carousel key={i} images={imgs} caption={b.caption} style={wideFig(26, 26)} />;
        }
        if (b.type === "embed") return <EmbedFigure key={i + ":" + reloadTick} url={b.url} caption={b.caption} height={b.height} reload={reloadTick} />;
        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type;
          return (
            <Tag key={i} style={{ fontSize: 18.5, lineHeight: 1.62, margin: "0 0 18px", paddingLeft: 26 }}>
              {(b.items || []).map((it, j) => <li key={j} style={{ marginBottom: 6 }}>{renderTokens(it)}</li>)}
            </Tag>
          );
        }
        if (b.type === "footnotes") {
          const notes = (b.notes || []).filter(n => n && n.key);
          if (!notes.length) return null;
          return (
            <section key={i} aria-label="Footnotes" style={{ margin: "36px 0 8px", paddingTop: 16, borderTop: "2px solid var(--ink)" }}>
              <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>Notes</div>
              <ol style={{ margin: 0, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 10 }}>
                {notes.map(n => (
                  <li key={n.key} id={"fn-" + n.key} value={n.num}
                    style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink)", scrollMarginTop: 90 }}>
                    {n.text ? (window.npjRichText ? window.npjRichText(n.text) : n.text) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
                    {" "}
                    <a href={"#fnref-" + n.key} aria-label="Back to text"
                      onClick={(e) => { e.preventDefault(); const el = document.getElementById("fnref-" + n.key); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      style={{ color: "var(--data)", textDecoration: "none", fontFamily: "var(--mono)", fontSize: 12.5 }}>↩</a>
                  </li>
                ))}
              </ol>
            </section>
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

  // the banner image — lifted into a hero directly under the title/dek. ONLY an
  // explicit banner is lifted (A.image.banner); a first-inline image picked up
  // as the front-page thumbnail stays inline in the body (the body map skips
  // banner blocks, so a lifted banner never doubles up).
  const heroImg = (A.image && A.image.src && A.image.banner)
    ? A.image
    : ((A.body || []).find(b => b.type === "img" && b.banner) || null);
  const Hero = (heroImg && heroImg.src) ? (
    <figure style={heroFig(4, 24)}>
      <ZoomImg image={heroImg} alt={heroImg.description || heroImg.caption || A.headline || ""} style={{ width: "100%", display: "block", border: "1.5px solid var(--ink)" }} />
      {heroImg.local ? <NotUploadedNote /> : null}
      <PhotoFigCaption caption={heroImg.caption} credit={heroImg.credit} />
    </figure>
  ) : null;

  const Header = (
    <header style={{ margin: "0 0 26px" }}>
      <div className="np-eyebrow" style={{ color: "var(--reject)", marginBottom: 12 }}>{A.kicker}</div>
      <h1 className="npj-article-h" style={{ fontFamily: "var(--display)", fontSize: 44, lineHeight: 1, letterSpacing: "-.01em", margin: "0 0 20px" }}>{A.headline}</h1>
      <p style={{ fontFamily: "var(--serif)", fontSize: 22, lineHeight: 1.4, color: "var(--ink)", margin: "0 0 20px", fontStyle: "italic" }}>{A.dek}</p>
      {Hero}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", paddingBottom: 16, borderBottom: "2px solid var(--ink)" }}>
        <window.Byline authors={A.authors} editors={A.editors} byline={A.byline} />
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <window.VersionBadge sha={A.base_sha} count={artVersions.length} onClick={() => setShowVersions(true)} />
          {fmtDate(A.published)}{A.updated && A.updated !== A.published ? " · updated " + fmtDate(A.updated) : ""} · {A.readMins} min
        </span>
      </div>
      <div style={{ paddingTop: 14 }}>
        {/* share link opens the reader; the wayback action targets the
            committed EO log — the document's version folder on GitHub (or the
            raw file, for a legacy single-file log) */}
        <ShareBar url={window.npjArticleUrl(A.slug)} archiveUrl={`https://web.archive.org/web/${window.npjArticleLogUrl(A)}`} title={A.headline} />
      </div>
      {headings.length >= 2 && (
        <nav style={{ marginTop: 18, border: "1.5px solid var(--ink)", background: "var(--card)" }}>
          <button onClick={() => setTocOpen(o => !o)} aria-expanded={tocOpen} aria-controls="article-toc-list"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
              background: "none", border: 0, cursor: "pointer", padding: "12px 14px" }}>
            <span aria-hidden="true" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)" }}>{tocOpen ? "▾" : "▸"}</span>
            <span className="np-eyebrow" style={{ color: "var(--ink-soft)" }}>Contents</span>
            <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{tocItems.length}</span>
          </button>
          {tocOpen && (
            <div id="article-toc-list" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 14px 12px" }}>
              {tocItems.map(h => <button key={h.id} onClick={() => { jump(h.id); setTocOpen(false); }} className="headline-link" style={{ textAlign: "left", background: "none", border: 0, cursor: "pointer", fontFamily: "var(--cond)", fontWeight: h.level === 2 ? 600 : 500, fontSize: h.level === 2 ? 16 : 14, paddingLeft: (h.level - 2) * 14, color: "var(--ink)" }}>{h.text}</button>)}
            </div>
          )}
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
      <SourcesExplorer sourceList={sourceList} spansForSource={spansForSource} onJump={jumpToClaim} onOpen={openSourceGallery} />
    </div>
  );

  // ── Preview ── the reader's own Header + Body + Sources footer, on the paper
  // page, with nothing but a Close bar around them. Because it renders the SAME
  // components from the SAME folded article the publish pipeline produces, what
  // the author sees here is byte-for-byte what ships: paragraph spacing, soft
  // line breaks, images, byline, the sources footer — all of it.
  if (preview) {
    return (
      <div className="fade-in" style={{ position: "fixed", inset: 0, zIndex: 6000, background: "var(--paper)", color: "var(--ink)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", display: "flex", alignItems: "center", gap: 12, padding: isPhone ? "8px 14px" : "10px 22px" }}>
          <span className="np-eyebrow" style={{ color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: "var(--mono)" }}>◉</span> {isPhone ? "Preview" : "Preview · exactly as readers will see it"}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setPreviews(v => !v)} aria-pressed={previews}
            title="Previews — hover a claim or footnote and its citation/note floats up in the margin. On by default; turn off for a clean read."
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: previews ? "var(--ink)" : "var(--card)", color: previews ? "var(--yellow)" : "var(--ink)" }}>
            {previews ? <I.eye style={{ fontSize: 14 }} /> : <I.eyeoff style={{ fontSize: 14 }} />} Previews
          </button>
          <button className="btn btn-sm" onClick={() => setTransparency(v => !v)} aria-pressed={transparency}
            title="Transparency — colour each claim by how it's grounded: cited (⊤/⊨), the author's own (⊢/⊨/⊩), or needs a source (⊥)"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: transparency ? "var(--ink)" : "var(--card)", color: transparency ? "var(--yellow)" : "var(--ink)" }}>
            <I.swatches style={{ fontSize: 14 }} /> Transparency
          </button>
          {/* Re-fold the editor's current content (onRefresh) AND re-key every embed
             with a fresh cache-buster (reloadTick) — so an embed that's in the draft
             but blank in the preview gets a clean re-fetch, ruling out a stale frame. */}
          <button className="btn btn-sm" onClick={() => { setReloadTick(t => t + 1); if (onRefresh) onRefresh(); }}
            title="Refresh — rebuild this preview from the editor and reload every embed, bypassing any cached frame"
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <I.redo style={{ fontSize: 14 }} /> <span className="npj-hide-sm">Refresh</span>
          </button>
          <button className="btn btn-sm" onClick={onClose} title="Back to the editor (Esc)">✕ Close</button>
        </div>
        <div style={{ maxWidth: COL, margin: "0 auto", padding: isPhone ? "18px 16px 80px" : "34px 22px 96px" }}>
          {Main}
        </div>
        {transparency && <GroundingLegend tally={groundTally} onClose={() => setTransparency(false)} />}
        {/* Grounding receipts on hover — the SAME citation card the public reader
           shows. Hover (or tap, on a phone) a claim and its source card floats
           up, so the author can audit the grounding in the preview exactly as a
           reader will. Lives INSIDE the fixed preview overlay so it stacks above
           it. The body already wires enterClaim on each .claim span; the reader
           branch just renders this card off the same hover state. */}
        <HoverCard data={hover} onEnter={cancelLeave} onLeave={scheduleLeave}
          onClose={() => { setHover(null); setActiveSrc(null); }}
          spansForSource={spansForSource} onJump={jumpToClaim} onExpand={openLightbox} preview />
        <FootnotePop data={fnPop} onEnter={cancelFnLeave} onLeave={scheduleFnLeave}
          onClose={() => setFnPop(null)} onJump={() => fnPop && jumpToFn(fnPop.key)}
          onExpand={(d) => openStage({ kind: "note", num: d.num, text: d.text, key: d.key })} />
        <GroundingPop data={groundPop} onEnter={cancelGroundLeave} onLeave={scheduleGroundLeave}
          onClose={() => setGroundPop(null)} onExpand={(tok) => openStage({ kind: "ground", tok })} />
        <MainStage stage={stage} onClose={() => setStage(null)} onJumpNote={jumpToFn} />
        {lightbox && <SourceLightbox key={(lightbox.keys[0] || "") + ":" + lightbox.start} keys={lightbox.keys} start={lightbox.start} renderCited={renderCitedForSource} onClose={() => setLightbox(null)} />}
      </div>
    );
  }

  return (
    <div className="fade-in">
      <Masthead route="article" onHome={onHome} onNewsroom={onNewsroom} />
      <ControlBar {...{ audit, setAudit, transparency, setTransparency, previews, setPreviews, showSugg, setShowSugg,
        suggCount: suggestions.filter(s => s.status === "proposed" || s.status === "review").length,
        entityOpen, setEntityOpen, entityCount: entityData ? entityData.entities.length : null,
        canEdit: canEditArticle, onEdit: () => setEditing(true), onExport: () => setShowExport(true),
        isAdmin, status: A.status, statusBusy, onSetStatus: changeStatus }} />

      <div style={{ maxWidth: hasRail && !stackRail ? COL + 2 * (railW + railGap) : COL, padding: isPhone ? "18px 16px 64px" : "30px 22px 80px",
        marginLeft: (!isPhone && entityOpen) ? 372 : "auto", marginRight: (!isPhone && showSugg) ? 408 : "auto", transition: "margin .28s" }}
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
        onClose={() => { setHover(null); setActiveSrc(null); }}
        suggCount={hover ? openByClaim[hover.claim.id] : 0} spansForSource={spansForSource} onJump={jumpToClaim} onExpand={openLightbox} />

      <FootnotePop data={fnPop} onEnter={cancelFnLeave} onLeave={scheduleFnLeave}
        onClose={() => setFnPop(null)} onJump={() => fnPop && jumpToFn(fnPop.key)}
        onExpand={(d) => openStage({ kind: "note", num: d.num, text: d.text, key: d.key })} />

      <GroundingPop data={groundPop} onEnter={cancelGroundLeave} onLeave={scheduleGroundLeave}
        onClose={() => setGroundPop(null)} onExpand={(tok) => openStage({ kind: "ground", tok })} />

      <MainStage stage={stage} onClose={() => setStage(null)} onJumpNote={jumpToFn} />

      {transparency && <GroundingLegend tally={groundTally} onClose={() => setTransparency(false)} />}

      <EntityRail open={entityOpen} onClose={() => { setEntityOpen(false); setActiveEntity(null); }}
        entityData={entityData} active={activeEntity} setActive={setActiveEntity} />

      {bubble && (
        <div className="fb-bubble" style={{ left: bubble.x, top: bubble.y - 46 }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => openComposeFromBubble("suggestion")}><span style={{ fontFamily: "var(--mono)" }}>✎</span> Suggest edit</button>
          <button onClick={() => openComposeFromBubble("comment")}><span style={{ fontFamily: "var(--mono)" }}>💬</span> Comment</button>
        </div>
      )}

      <SuggestionRail open={showSugg} onClose={() => { setShowSugg(false); setCompose(null); }}
        list={suggestions} claimById={claimById} filter={filter} setFilter={setFilter}
        canReview={canEditArticle} onVote={onVote} onResolve={onResolve} onReply={onReply} onMerge={onMerge} onShow={showInText}
        composeDraft={compose}
        onSubmit={(d) => { onAddSuggestion(d); setCompose(null); }}
        onCancelCompose={() => setCompose(null)} me={me} />
      {showVersions && <window.VersionHistory versions={artVersions} onClose={() => setShowVersions(false)}
        onRevert={revertTo} canRevert={canEditArticle} reverting={reverting} revertErr={revertErr} />}
      {showExport && window.SubstackExport && <window.SubstackExport article={A} onClose={() => setShowExport(false)} />}
      {editing && window.ArticleEdit && (
        <window.ArticleEdit article={A} me={me} isAdmin={isAdmin}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setEditing(false); if (onEdited) onEdited(updated); }} />
      )}

      {/* a source's document, expanded to fill the screen in-app — opened from a
         citation card or the Sources footer (where you can tab through them all);
         ✕ / Esc / backdrop to exit */}
      {lightbox && <SourceLightbox key={(lightbox.keys[0] || "") + ":" + lightbox.start} keys={lightbox.keys} start={lightbox.start} renderCited={renderCitedForSource} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ---- the transparency lens legend ----
   A small fixed key, shown only while the lens is on, that names each grounding
   colour and tallies how many claims carry it. It lists the kinds the piece
   actually uses (a piece with no owned claims doesn't show the owned rows),
   falling back to the two cited kinds when nothing is grounded yet. */
function GroundingLegend({ tally, onClose }) {
  const isPhone = window.useIsMobile(760);
  tally = tally || {};
  const present = GROUND_ORDER.filter(k => (tally[k] || 0) > 0);
  const rows = present.length ? present : GROUND_ORDER.slice(0, 2);
  const total = GROUND_ORDER.reduce((n, k) => n + (tally[k] || 0), 0);
  return (
    <aside className="np-scroll fade-in" aria-label="Transparency lens — how each claim is grounded"
      style={{ position: "fixed", left: isPhone ? 8 : 16, bottom: isPhone ? 8 : 16, zIndex: 3900,
        width: isPhone ? "calc(100% - 16px)" : 264, maxWidth: 264, maxHeight: "62vh", overflowY: "auto",
        background: "var(--card)", border: "1.5px solid var(--ink)", boxShadow: "0 10px 30px rgba(8,7,5,.34)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderBottom: "1.5px solid var(--ink)", position: "sticky", top: 0, background: "var(--card)" }}>
        <I.swatches style={{ fontSize: 14, color: "var(--ink-soft)" }} />
        <span className="np-eyebrow" style={{ flex: 1, color: "var(--ink-soft)" }}>How each claim is grounded</span>
        {onClose && (
          <button onClick={onClose} aria-label="Turn off the transparency lens"
            style={{ background: "none", border: 0, cursor: "pointer", fontSize: 17, lineHeight: 1, color: "var(--ink)", padding: "0 2px" }}><I.x /></button>
        )}
      </div>
      <div style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map(k => {
          const m = GROUND_KINDS[k];
          return (
            <div key={k} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2, width: 16, height: 15, borderRadius: 3,
                background: "color-mix(in srgb, " + m.color + " 20%, transparent)", borderBottom: "2px solid " + m.color }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--cond)", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: "var(--mono)", color: m.color }}>{m.glyph}</span>
                  <span style={{ flex: 1 }}>{m.label}</span>
                  {tally[k] ? <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{tally[k]}</span> : null}
                </div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 11.5, lineHeight: 1.4, color: "var(--ink-soft)", marginTop: 1 }}>{m.note}</div>
              </div>
            </div>
          );
        })}
        <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", borderTop: "1px solid var(--rule)", paddingTop: 7 }}>
          {total ? total + " grounded " + (total === 1 ? "claim" : "claims") + " · unmarked text is uncited prose." : "No grounded claims in this piece yet."}
        </div>
      </div>
    </aside>
  );
}

/* ---- sticky control bar (the reader's instrument panel) ---- */
function ControlBar({ audit, setAudit, transparency, setTransparency, previews, setPreviews, showSugg, setShowSugg, suggCount, entityOpen, setEntityOpen, entityCount, canEdit, onEdit, onExport, isAdmin, status, statusBusy, onSetStatus }) {
  const isPhone = window.useIsMobile(760);
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 1500, background: "var(--paper)", borderBottom: "1.5px solid var(--ink)", boxShadow: "0 2px 0 rgba(22,20,13,.06)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: isPhone ? "7px 12px" : "9px 22px", display: "flex", alignItems: "center", gap: isPhone ? 7 : 14, flexWrap: "wrap", justifyContent: isPhone ? "flex-start" : undefined }}>
        {!isPhone && <span style={{ flex: 1 }} />}

        <button className="btn btn-sm" onClick={onExport} title="Export & copy — the whole article as plain text or Markdown, a rich copy for Substack (images + sourcing intact), or a .html/.md/.txt file"
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <I.ext style={{ fontSize: 14 }} /> Export
        </button>

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

        <button className="btn btn-sm" onClick={() => setTransparency(!transparency)} aria-pressed={transparency}
          title="Transparency — colour every claim by how it's grounded: cited (⊤ grounded / ⊨ multiple sources), owned by the author (⊢ analysis / ⊨ account / ⊩ position), or still needs a source (⊥). Off: a clean read."
          style={{ display: "inline-flex", alignItems: "center", gap: 7,
            background: transparency ? "var(--ink)" : "var(--card)", color: transparency ? "var(--yellow)" : "var(--ink)" }}>
          <I.swatches style={{ fontSize: 14 }} /> Transparency
        </button>

        <button className="btn btn-sm" onClick={() => setPreviews(!previews)} aria-pressed={previews}
          title="Previews — hover a claim or a footnote and its citation or note floats up in the margin, beside the text. On by default; turn off for a clean read with nothing popping up."
          style={{ display: "inline-flex", alignItems: "center", gap: 7,
            background: previews ? "var(--ink)" : "var(--card)", color: previews ? "var(--yellow)" : "var(--ink)" }}>
          {previews ? <I.eye style={{ fontSize: 14 }} /> : <I.eyeoff style={{ fontSize: 14 }} />} Previews
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
          const ivLink = window.NpjInterview && window.NpjInterview.isInterview(s);
          const url = s.archive_url || s.original_url;
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
                    {ivLink
                      ? <span className="np-mono" style={{ fontSize: 9.5, color: "var(--review)" }}>{window.NpjInterview.outletLine(s.talk || {})}</span>
                      : s.redacted ? <span className="np-mono" title="Original withheld — this source was redacted before archiving" style={{ fontSize: 9.5, color: "var(--review)" }}>redacted ↯</span>
                      : url ? <a href={url} target="_blank" rel="noopener" className="np-mono" title="Open the archived snapshot" style={{ fontSize: 9.5, color: "var(--verified)", textDecoration: "none" }}>snapshot ↗</a> : null}
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

/* ---- the Sources explorer ----
   The receipts, made browsable. The old "Methods & receipts" preamble and the
   "How this was written" composition strip are gone — what's left is the sources
   themselves, as a tool you can actually use when a piece cites two dozen of them:

     • a one-line read of HOW the piece is sourced (n documents · n web · n …),
     • filter chips by what a source IS — a document you read here, a web page, a
       person, a dataset — each with a live count,
     • a search that matches titles, outlets AND the exact passages quoted,
     • a sort: in reading order, or heaviest-cited first (what it's built on),
     • cards that open the source FULL-SIZE IN THE APP (never a new tab) and, in
       the viewer, tab ‹ ›/← → through exactly the set you've filtered to.

   The chrome only appears when it earns its keep (≥6 sources, ≥2 kinds; search at
   ≥10) — a three-source piece is just the cards. */
const CAT_ORDER = ["document", "web", "interview", "data", "other"];
const CAT_LABEL = { document: "Documents", web: "Web pages", interview: "Interviews", data: "Data", other: "Other" };
// icons resolved at call time (window.I exists by render) — never at module load
function catIcon(k) { return ({ document: I.doc, web: I.link, interview: I.chat, data: I.data, other: I.doc })[k] || I.doc; }
// what a source IS, from the reader's point of view: can I read it here, follow a
// web reference, hear from a person, or dig into data. An uploaded file we can
// render in-app is a "document"; an interview is a person; a dataset is data; a
// captured page/link is "web". This is the facet the chips filter on.
function sourceCategory(s) {
  if (!s) return "other";
  if (window.NpjInterview && window.NpjInterview.isInterview(s)) return "interview";
  const SV = window.NpjSourceView;
  if (SV && SV.isViewable && SV.isViewable(s)) return "document";
  if (s.type === "data") return "data";
  if (s.archive_url || s.original_url) return "web";
  if (SV && SV.hasFile && SV.hasFile(s)) return "document";
  return "other";
}

function SourcesExplorer({ sourceList, spansForSource, onJump, onOpen }) {
  const isPhone = window.useIsMobile(760);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");        // active filter facet
  const [sort, setSort] = useState("order");     // "order" | "cited"
  const [openKey, setOpenKey] = useState(null);  // which card's passages are expanded

  // decorate every source once: record, category, passages, search haystack
  const rows = React.useMemo(() => (sourceList || []).map((e, i) => {
    const s = srcOf(e.key);
    const spans = spansForSource ? spansForSource(e.key) : [];
    const hay = [s.title, s.outlet, s.id].concat(spans.map(sp => sp.text)).filter(Boolean).join(" ").toLowerCase();
    return { key: e.key, num: e.num, order: i, s, spans, category: sourceCategory(s), hay };
  }), [sourceList, spansForSource]);

  const counts = React.useMemo(() => {
    const c = {}; rows.forEach(r => { c[r.category] = (c[r.category] || 0) + 1; }); return c;
  }, [rows]);
  const cats = CAT_ORDER.filter(k => counts[k]);

  const q = query.trim().toLowerCase();
  const view = React.useMemo(() => {
    let v = rows;
    if (cat !== "all") v = v.filter(r => r.category === cat);
    if (q) v = v.filter(r => r.hay.indexOf(q) !== -1);
    if (sort === "cited") v = v.slice().sort((a, b) => b.spans.length - a.spans.length || a.order - b.order);
    return v;
  }, [rows, cat, q, sort]);

  if (!rows.length) return null;
  const viewKeys = view.map(r => r.key);
  const total = rows.length;
  const showControls = total >= 6 && cats.length >= 2;
  const showSearch = total >= 10;
  // the one-line "how this is sourced" read
  const summary = cats.map(k => counts[k] + " " + CAT_LABEL[k].toLowerCase()).join(" · ");

  return (
    <footer id="article-sources" style={{ margin: "44px 0 0", borderTop: "2.5px solid var(--ink)", paddingTop: 18, scrollMarginTop: 90 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 5 }}>
        <h3 style={{ fontFamily: "var(--display)", fontSize: 24, margin: 0 }}>SOURCES</h3>
        <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{total} · {summary}</span>
      </div>
      <p className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", margin: "0 0 14px", lineHeight: 1.5 }}>
        {isPhone ? "Tap" : "Click"} any source to read it full-size, right here{total > 1 ? " — then ← → to move through them" : ""}. Nothing opens a new tab.
      </p>

      {showControls && (
        <div className="srcx-bar">
          {showSearch && (
            <div className="srcx-search">
              <I.search style={{ fontSize: 14, color: "var(--ink-soft)", flex: "0 0 auto" }} />
              <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search sources and quoted passages"
                placeholder="Search sources & quoted passages…" />
              {query && <button type="button" className="srcx-clear" onClick={() => setQuery("")} aria-label="Clear search"><I.x /></button>}
            </div>
          )}
          <div className="srcx-chips" role="group" aria-label="Filter sources by kind">
            <button type="button" className="srcx-chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>All <span className="srcx-n">{total}</span></button>
            {cats.map(k => {
              const Icon = catIcon(k);
              return (
                <button key={k} type="button" className="srcx-chip" aria-pressed={cat === k} onClick={() => setCat(cat === k ? "all" : k)}>
                  <Icon style={{ fontSize: 13 }} /> {CAT_LABEL[k]} <span className="srcx-n">{counts[k]}</span>
                </button>
              );
            })}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="srcx-sort" onClick={() => setSort(sort === "order" ? "cited" : "order")}
            title="Order by appearance in the story, or by how many passages each source backs">
            ⇅ {sort === "order" ? "In order" : "Most cited"}
          </button>
        </div>
      )}

      {view.length === 0 ? (
        <div className="np-mono" style={{ fontSize: 12, color: "var(--ink-soft)", border: "1px dashed var(--rule-strong)", padding: "22px 16px", textAlign: "center", lineHeight: 1.6 }}>
          No sources match {query ? "“" + query + "”" : "this filter"}{cat !== "all" ? " in " + CAT_LABEL[cat].toLowerCase() : ""}.{" "}
          <button type="button" className="srcx-reset" onClick={() => { setQuery(""); setCat("all"); }}>Clear filters</button>
        </div>
      ) : (
        <ol className="srcx-list">
          {view.map((r, i) => {
            const { key, num, s, spans, category } = r;
            const CatIcon = catIcon(category);
            const iv = category === "interview";
            const SV = window.NpjSourceView;
            const kind = SV && SV.kindOf ? SV.kindOf(s) : "unknown";
            const medium = iv ? ((window.NpjInterview && window.NpjInterview.outletLine && window.NpjInterview.outletLine(s.talk || {})) || "Interview")
              : category === "web" ? "Web page"
              : category === "data" ? "Dataset"
              : kind === "pdf" ? "PDF" : kind === "image" ? "Image / scan" : kind === "text" ? "Text" : "Document";
            const prov = iv ? window.NpjInterview.humanDate((s.talk && s.talk.date) || s.retrieved)
              : s.redacted ? "Redacted"
              : s.archive_url ? "Archived " + (s.retrieved || "")
              : s.original_url ? "Reference"
              : "";
            const provColor = (iv || s.redacted) ? "var(--review)" : s.archive_url ? "var(--verified)" : "var(--ink-soft)";
            // the source → spans connection is the point: show the passages it
            // grounds right on the card (capped, with a "+N more"), each a click
            // away from the exact spot in the story it backs
            const cap = 4;
            const overflow = spans.length > cap + 1;
            const expanded = openKey === key;
            const shown = (expanded || !overflow) ? spans : spans.slice(0, cap);
            return (
              <li key={key} className="srcx-card">
                <button type="button" className="srcx-open" onClick={() => onOpen(viewKeys, i)}
                  title="Read this source full-size, here in the app"
                  aria-label={"Open source " + num + ", " + (s.title || s.id || key) + ", full-size in the app"}>
                  <span className="claim-marker srcx-num">{num}</span>
                  <span className="srcx-main">
                    <span className="srcx-title">{s.title || s.id || key}</span>
                    {s.outlet ? <span className="srcx-outlet">{s.outlet}</span> : null}
                    <span className="srcx-meta">
                      <span className="srcx-medium"><CatIcon style={{ fontSize: 12 }} /> {medium}</span>
                      {prov ? <span style={{ color: provColor }}>· {prov}</span> : null}
                    </span>
                  </span>
                  <span className="srcx-view" aria-hidden="true"><I.expand style={{ fontSize: 15 }} /></span>
                </button>
                {spans.length > 0 && (
                  <div className="srcx-foot">
                    <div className="srcx-foot-h">
                      Backs {spans.length} passage{spans.length !== 1 ? "s" : ""} in the story — click one to jump there
                    </div>
                    <CitedSpanList claims={shown} onJump={onJump} />
                    {overflow && (
                      <button type="button" className="srcx-more" aria-expanded={expanded} onClick={() => setOpenKey(expanded ? null : key)}>
                        {expanded ? "Show fewer" : "+ " + (spans.length - cap) + " more passage" + (spans.length - cap !== 1 ? "s" : "")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </footer>
  );
}

Object.assign(window, { ArticleRead });
