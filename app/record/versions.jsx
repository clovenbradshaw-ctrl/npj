/* NPJ article versioning — every published piece carries its edit version, all
   versions are viewable, and the diff between any two is obvious.

   Versions come from the publish chain (each commit to GitHub is a version, keyed
   by short SHA). A version is:
     { sha, ts, author, message, headline, dek, text }  // text = body snapshot
   The headline (title) and dek (subtitle) ride alongside the body so an edit to
   either is visible in the diff — otherwise a retitle reads as "+0 / −0".
   The newest version is first. Until a piece has history, the list is just its
   current version. Diffs are word-level (LCS), rendered inline: additions are
   underlined green, deletions struck red. Mechanical, no model. */

/* ---- word-level diff (LCS over tokens, punctuation-aware) ---- */
function diffTokens(s) {
  // keep whitespace as its own tokens so reflow is faithful
  return String(s == null ? "" : s).split(/(\s+)/).filter(t => t.length);
}
function diffWords(aStr, bStr) {
  const a = diffTokens(aStr), b = diffTokens(bStr);
  const n = a.length, m = b.length;
  // LCS table
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  const push = (type, text) => { const last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type, text }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < n) { push("del", a[i]); i++; }
  while (j < m) { push("add", b[j]); j++; }
  return out;
}

function diffStats(parts) {
  let add = 0, del = 0;
  parts.forEach(p => { const w = (p.text.trim().match(/\S+/g) || []).length; if (p.type === "add") add += w; else if (p.type === "del") del += w; });
  return { add, del };
}

/* render a token-diff parts[] inline — additions underlined green, deletions struck red */
function renderInline(parts) {
  return parts.map((p, i) => p.type === "same"
    ? <React.Fragment key={i}>{p.text}</React.Fragment>
    : p.type === "add"
      ? <ins key={i} style={{ textDecoration: "none", background: "color-mix(in srgb, var(--verified,#1f8a5b) 18%, transparent)", borderBottom: "2px solid var(--verified,#1f8a5b)" }}>{p.text}</ins>
      : <del key={i} style={{ background: "color-mix(in srgb, var(--reject,#b23a26) 13%, transparent)", color: "var(--reject,#b23a26)", textDecorationThickness: "1.5px" }}>{p.text}</del>);
}

// a version snapshot is { headline, dek, text }; tolerate a bare body string too
function snapFields(v) {
  if (typeof v === "string") return { headline: "", dek: "", text: v };
  v = v || {};
  return { headline: v.headline || "", dek: v.dek || "", text: v.text || "" };
}

const titleStyle = { fontFamily: "var(--display)", fontSize: 22, lineHeight: 1.15, margin: 0, textWrap: "pretty" };
const dekStyle = { fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, lineHeight: 1.4, margin: 0, color: "var(--ink-soft)", textWrap: "pretty" };
const bodyStyle = { fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.7, margin: 0, textWrap: "pretty" };
const ruleStyle = { borderTop: "1px solid var(--rule)", margin: "12px 0" };
const FieldLabel = ({ children }) => <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 2 }}>{children}</div>;

/* ---- inline diff renderer: title, then subtitle, then body ---- */
function DiffView({ from, to }) {
  const A = snapFields(from), B = snapFields(to);
  const head = React.useMemo(() => diffWords(A.headline, B.headline), [A.headline, B.headline]);
  const dek = React.useMemo(() => diffWords(A.dek, B.dek), [A.dek, B.dek]);
  const body = React.useMemo(() => diffWords(A.text, B.text), [A.text, B.text]);
  const { add, del } = [head, dek, body].reduce((s, p) => { const d = diffStats(p); s.add += d.add; s.del += d.del; return s; }, { add: 0, del: 0 });
  const hasHead = !!(A.headline || B.headline), hasDek = !!(A.dek || B.dek);
  const unchanged = add === 0 && del === 0;
  return (
    <div>
      <div className="np-mono" style={{ fontSize: 11, marginBottom: 10, display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ color: "var(--verified, #1f8a5b)" }}>+{add} added</span>
        <span style={{ color: "var(--reject, #b23a26)" }}>−{del} removed</span>
        {unchanged && <span style={{ color: "var(--ink-soft)" }}>· same prose in both versions — a republish or metadata-only change</span>}
      </div>
      {hasHead && <div style={{ marginBottom: 8 }}><FieldLabel>Title</FieldLabel><p style={titleStyle}>{renderInline(head)}</p></div>}
      {hasDek && <div style={{ marginBottom: 8 }}><FieldLabel>Subtitle</FieldLabel><p style={dekStyle}>{renderInline(dek)}</p></div>}
      {(hasHead || hasDek) && <div style={ruleStyle} />}
      <p style={bodyStyle}>{renderInline(body)}</p>
    </div>
  );
}

/* a plain (non-diff) snapshot — used for a lone version or when "from" === "to" */
function Snapshot({ v }) {
  const f = snapFields(v);
  return (
    <div>
      {f.headline && <p style={{ ...titleStyle, marginBottom: 6 }}>{f.headline}</p>}
      {f.dek && <p style={{ ...dekStyle, marginBottom: 6 }}>{f.dek}</p>}
      {(f.headline || f.dek) && <div style={ruleStyle} />}
      <p style={bodyStyle}>{f.text}</p>
    </div>
  );
}

/* ---- a compact version badge: "v.<sha>" that opens the history ---- */
function VersionBadge({ sha, count, onClick, dark }) {
  return (
    <button onClick={onClick} title="View edit history & diffs" className="np-mono"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1.5px solid " + (dark ? "rgba(255,255,255,.3)" : "var(--ink)"),
        background: dark ? "transparent" : "var(--card)", color: dark ? "#e3ddcc" : "var(--ink)", padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>
      <span style={{ fontFamily: "var(--mono)" }}>⊛</span> v.{sha || "draft"}{count > 1 ? " · " + count + " versions" : ""}
    </button>
  );
}

/* ---- version byline ----
   Each version stores its author's raw mxid, but we resolve it to the
   contributor's PUBLIC display name at render time (window.npjPerson, fed by the
   world-readable site/layout.json `contributors` map on GitHub). That means a
   contributor who changes their display name once — Documents → "Your byline &
   About me", committed to layout.json — re-credits every past version at once,
   and the cramped full handle (@collective_boundary730383:hyphae.social) that
   used to spill past the card's right edge is replaced by a short, wrapping name
   (the full mxid stays available on hover). */
function versionAuthorName(mxid) {
  if (!mxid) return "—";
  if (window.npjPerson) { const n = window.npjPerson(mxid).name; if (n) return n; }
  return String(mxid).replace(/^@/, "").split(":")[0] || "—";
}
// compact, human timestamp — tolerates a full ISO instant or a date-only string
function versionTime(ts) {
  if (!ts) return "";
  const s = String(ts).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? s + "T00:00:00" : s);
  if (isNaN(d.getTime())) return s;
  return dateOnly
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function VersionMeta({ v, size = 9.5 }) {
  return (
    <div style={{ marginTop: 2, minWidth: 0 }}>
      <div className="np-mono" title={v.author || ""} style={{ fontSize: size, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>{versionAuthorName(v.author)}</div>
      {v.ts ? <div className="np-mono" style={{ fontSize: size, color: "var(--ink-soft)", opacity: .85, overflowWrap: "anywhere" }}>{versionTime(v.ts)}</div> : null}
    </div>
  );
}

/* ---- the human-readable changelog ----
   Each version is also a row in a plain-language edit log: a few chips that name
   what changed from the version before it — "title", "body +42 −7", "republished",
   "↩ revert" — read mechanically by diffing the two folded snapshots. No model.
   The chips complement the word-level diff in the right pane: the diff is the
   what-exactly, the chips are the at-a-glance. */
const chNorm = (s) => String(s == null ? "" : s).trim();
function leadImageSrc(body) {
  if (!Array.isArray(body)) return "";
  const imgs = body.filter(b => b && b.type === "img" && b.src);
  const lead = imgs.find(b => b.banner) || imgs[0];
  return lead ? lead.src : "";
}
// the comparable fields of a version — from its full snapshot when foldLog gave
// one, falling back to the flat fields a lighter version object carries
function versionFields(v) {
  const s = (v && v.snapshot) || null;
  return {
    headline: s ? (s.headline || "") : (v && v.headline) || "",
    dek: s ? (s.dek || "") : (v && v.dek) || "",
    text: (v && v.text) || "",
    column: s ? (s.column || "") : "",
    tags: s && Array.isArray(s.tags) ? s.tags : [],
    authors: s && Array.isArray(s.authors) ? s.authors : [],
    editors: s && Array.isArray(s.editors) ? s.editors : [],
    byline: s ? (s.byline || "") : "",
    status: s && s.status === "unpublished" ? "unpublished" : "published",
    image: leadImageSrc(s && s.body)
  };
}
function changeChips(prev, cur) {
  const chips = [];
  if (cur && cur.revert) chips.push({ tone: "revert", label: cur.revert.undo ? "↺ undo revert" : "↩ revert" });
  if (!prev) { chips.push({ tone: "add", label: "created" }); return chips; }
  const A = versionFields(prev), B = versionFields(cur);
  // a fresh whole-document upload (a second INS, not an in-place REC edit): the
  // author re-published the piece from the composer. Name it explicitly so the
  // entry reads as a deliberate republish rather than a mystifying "no textual
  // change" when the prose happens to be untouched. A status flip (hidden →
  // live) already says "republished" below, so don't double up.
  const reupload = cur && cur.op === "INS";
  if (reupload && A.status === B.status && B.status !== "unpublished") chips.push({ tone: "pub", label: "republished" });
  if (A.status !== B.status) chips.push(B.status === "unpublished" ? { tone: "unpub", label: "unpublished" } : { tone: "pub", label: "republished" });
  if (chNorm(A.headline) !== chNorm(B.headline)) chips.push({ tone: "neutral", label: "title" });
  if (chNorm(A.dek) !== chNorm(B.dek)) chips.push({ tone: "neutral", label: "subtitle" });
  if (A.text !== B.text) {
    const { add, del } = diffStats(diffWords(A.text, B.text));
    if (add || del) chips.push({ tone: add && !del ? "add" : del && !add ? "del" : "neutral", label: "body " + [add ? "+" + add : "", del ? "−" + del : ""].filter(Boolean).join(" ") });
    else chips.push({ tone: "neutral", label: "body" });
  }
  if (chNorm(A.column) !== chNorm(B.column)) chips.push({ tone: "neutral", label: "section" });
  if (JSON.stringify(A.tags) !== JSON.stringify(B.tags)) chips.push({ tone: "neutral", label: "tags" });
  if (chNorm(A.byline) !== chNorm(B.byline) || JSON.stringify(A.authors) !== JSON.stringify(B.authors) || JSON.stringify(A.editors) !== JSON.stringify(B.editors)) chips.push({ tone: "neutral", label: "byline" });
  if (chNorm(A.image) !== chNorm(B.image)) chips.push({ tone: "neutral", label: A.image && B.image ? "photo" : B.image ? "photo added" : "photo removed" });
  if (!chips.length) chips.push({ tone: "neutral", label: "no textual change" });
  return chips;
}
function Chip({ tone, children }) {
  const map = {
    add:     { fg: "var(--verified,#1f8a5b)", bd: "var(--verified,#1f8a5b)", bg: "transparent" },
    del:     { fg: "var(--reject,#b23a26)",   bd: "var(--reject,#b23a26)",   bg: "transparent" },
    pub:     { fg: "var(--verified,#1f8a5b)", bd: "var(--verified,#1f8a5b)", bg: "transparent" },
    unpub:   { fg: "var(--reject,#b23a26)",   bd: "var(--reject,#b23a26)",   bg: "transparent" },
    revert:  { fg: "var(--ink)",              bd: "var(--ink)",              bg: "var(--yellow)" },
    neutral: { fg: "var(--ink-soft)",         bd: "var(--rule)",             bg: "transparent" }
  };
  const c = map[tone] || map.neutral;
  return <span className="np-mono" style={{ fontSize: 9.5, lineHeight: 1.25, padding: "1.5px 5px", border: "1px solid " + c.bd, color: c.fg, background: c.bg, whiteSpace: "nowrap" }}>{children}</span>;
}
// a two-tap revert/undo button: tap arms it, tap "Confirm" commits — so restoring
// the document to an older state is never a single stray click
function RevertControl({ label, title, busy, onConfirm }) {
  const [armed, setArmed] = useState(false);
  if (busy) return <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>working…</span>;
  if (!armed) return (
    <button onClick={() => setArmed(true)} title={title} className="np-cond"
      style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid var(--ink)", background: "transparent", color: "var(--ink)", cursor: "pointer", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</button>
  );
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      <button onClick={() => { setArmed(false); onConfirm(); }} className="np-cond" style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--yellow)", cursor: "pointer", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700 }}>Confirm</button>
      <button onClick={() => setArmed(false)} className="np-mono" style={{ fontSize: 10, background: "none", border: 0, color: "var(--ink-soft)", cursor: "pointer" }}>cancel</button>
    </span>
  );
}

/* ---- the history overlay: changelog + diff; reverts when an editor opens it ----
   onRevert(version, { undo }) commits the revert (ArticleRead owns the webhook
   call + refold); canRevert gates the controls; reverting holds the sha (or
   "undo") in flight; revertErr is a one-line failure to surface. All optional —
   the Newsroom opens this as a pure read-only draft viewer and passes none. */
function VersionHistory({ versions, onClose, onRevert, canRevert, reverting, revertErr }) {
  const list = (versions && versions.length) ? versions : [];
  const [a, setA] = useState(list.length > 1 ? 1 : 0); // older (compare-from)
  const [b, setB] = useState(0);                        // newer (compare-to)
  if (!list.length) return null;
  const single = list.length < 2;
  const vA = list[a], vB = list[b];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 5200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }} className="fade-in">
      {/* The panel is a self-contained ink-on-paper reading surface. It can be
          mounted inside the dark newsroom (which sets color: var(--nr-text), a
          light cream), so we pin color here — otherwise the snapshot title and
          body, which inherit, would render light-on-light and be unreadable. */}
      <div onClick={(e) => e.stopPropagation()} className="np-scroll" style={{ width: single ? "min(620px,97vw)" : "min(860px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, color: "var(--yellow)" }}>⊛</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EDIT HISTORY</span>
          <span className="np-mono" style={{ fontSize: 11, opacity: .7 }}>{list.length} version{list.length !== 1 ? "s" : ""}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18 }}><I.x /></button>
        </div>

        {single ? (
          /* one version — no diff to pick. Show the snapshot plainly with a
             single tidy version stamp instead of dead from/to controls. */
          <div style={{ padding: "18px 22px 28px" }}>
            <div style={{ border: "1.5px solid var(--ink)", background: "var(--card)", padding: "11px 13px", marginBottom: 18 }}>
              <div className="np-mono" style={{ fontSize: 12, fontWeight: 600 }}>⊛ v.{vB.sha} · current</div>
              <VersionMeta v={vB} size={10} />
              {vB.message && <div style={{ fontFamily: "var(--serif)", fontSize: 13, marginTop: 5, lineHeight: 1.4 }}>{vB.message}</div>}
            </div>
            <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 12 }}>
              First and only version — no edits since publishing. A diff appears once this piece is revised.
            </div>
            <Snapshot v={vB} />
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "232px 1fr", minHeight: 0 }}>
          {/* timeline */}
          <div style={{ borderRight: "1.5px solid var(--ink)", padding: "12px 12px 24px" }}>
            <div className="np-eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Changelog</div>
            {revertErr && <div className="np-mono" style={{ fontSize: 10, color: "var(--reject,#b23a26)", border: "1px solid var(--reject,#b23a26)", padding: "6px 7px", marginBottom: 8, lineHeight: 1.4 }}>{revertErr}</div>}
            {/* if the newest entry was a revert, offer to undo it — itself just a
                revert aimed at the version the revert replaced (list[1]) */}
            {onRevert && canRevert && list[0] && list[0].revert && list[1] && list[1].snapshot && (
              <div style={{ border: "1.5px solid var(--ink)", background: "var(--yellow)", padding: "8px 9px", marginBottom: 9 }}>
                <div className="np-cond" style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.3, marginBottom: 6 }}>Latest change was a revert.</div>
                <RevertControl label="↺ Undo it" title={"Undo the revert — restore v." + list[1].sha} busy={reverting === "undo"} onConfirm={() => onRevert(list[1], { undo: true })} />
              </div>
            )}
            {list.map((v, i) => {
              const isFrom = i === a, isTo = i === b;
              return (
                <div key={v.sha + i} style={{ border: "1.5px solid " + (isFrom || isTo ? "var(--ink)" : "var(--rule)"), marginBottom: 7, padding: "8px 9px", background: isTo ? "var(--yellow)" : isFrom ? "color-mix(in srgb, var(--yellow) 22%, transparent)" : "var(--card)" }}>
                  <div className="np-mono" style={{ fontSize: 11, fontWeight: 600 }}>⊛ v.{v.sha}{i === 0 ? " · current" : ""}</div>
                  <VersionMeta v={v} />
                  {(v.note || v.op === "INS") && <div style={{ fontFamily: "var(--serif)", fontSize: 12, marginTop: 4, lineHeight: 1.35 }}>{v.note || "Published"}</div>}
                  {/* what changed from the version before this one, in plain words */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {changeChips(list[i + 1], v).map((c, ci) => <Chip key={ci} tone={c.tone}>{c.label}</Chip>)}
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                    <button onClick={() => setA(i)} className="np-cond" style={{ flex: 1, fontSize: 10.5, padding: "3px", textTransform: "uppercase", letterSpacing: ".04em", border: "1px solid var(--ink)", background: isFrom ? "var(--ink)" : "transparent", color: isFrom ? "var(--yellow)" : "var(--ink)", cursor: "pointer" }}>from</button>
                    <button onClick={() => setB(i)} className="np-cond" style={{ flex: 1, fontSize: 10.5, padding: "3px", textTransform: "uppercase", letterSpacing: ".04em", border: "1px solid var(--ink)", background: isTo ? "var(--ink)" : "transparent", color: isTo ? "var(--yellow)" : "var(--ink)", cursor: "pointer" }}>to</button>
                  </div>
                  {/* revert the whole document to this version — an editor-only,
                      append-only REC; the current version has nothing to revert to */}
                  {onRevert && canRevert && i !== 0 && v.snapshot && (
                    <div style={{ marginTop: 6 }}>
                      <RevertControl label="↩ Revert to this" title={"Revert the document to v." + v.sha} busy={reverting === v.sha} onConfirm={() => onRevert(v, {})} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* diff */}
          <div style={{ padding: "16px 20px 28px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <span className="np-mono" style={{ fontSize: 12 }}>v.{vA.sha} → v.{vB.sha}</span>
              {a === b && <span className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>· same version — pick two to compare</span>}
            </div>
            {a === b
              ? <Snapshot v={vB} />
              : <DiffView from={vA} to={vB} />}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { diffWords, diffStats, DiffView, VersionBadge, VersionHistory });
