/* NPJ — Fork editor. The lightweight "fork the whole article" surface: NOT the
   full newsroom editor, just the ability to edit the EXISTING content's text so a
   reader can propose a revised version of the piece. Every text block becomes an
   editable field; images/embeds show as read-only placeholders for context.

   Working storage: edits autosave to this browser (localStorage) the whole time —
   so an anonymous reader can fork, wander off, and come back before ever signing
   in. When signed in they ALSO sync to the contributor's Matrix account (best-
   effort), so the working fork survives a browser wipe. Nothing is public until
   "Submit fork" — which routes through the same onboarding gate as any
   contribution, then lands the fork as a branch (edited copy → mergeable) or, if
   no text changed, a note on the article.

   Exposes window.ForkEditor. Depends on window.NpjFeedback (forkUnits/applyForkUnits
   /forkChanged) and, for sync, window.MatrixAuth. */

const FORK_LS = "npj_fork_draft_v1_";
function forkKey(slug) { return FORK_LS + (slug || "x"); }
function loadForkDraft(slug) { try { return JSON.parse(localStorage.getItem(forkKey(slug)) || "null"); } catch (e) { return null; } }
function saveForkDraft(slug, d) { try { localStorage.setItem(forkKey(slug), JSON.stringify(d)); } catch (e) {} }
function clearForkDraft(slug) { try { localStorage.removeItem(forkKey(slug)); } catch (e) {} }

/* one editable text block, sized to its content and styled by block type so the
   fork reads like the article while you edit it */
function ForkBlock({ unit, value, onChange }) {
  const t = unit.type;
  const base = { width: "100%", border: "1.5px solid var(--rule)", background: "var(--paper)", padding: "8px 10px",
    boxSizing: "border-box", resize: "vertical", outline: "none", lineHeight: 1.5, marginBottom: 12 };
  const byType = {
    h2: { fontFamily: "var(--display)", fontSize: 26, lineHeight: 1.1 },
    h3: { fontFamily: "var(--cond)", fontWeight: 700, fontSize: 20 },
    pull: { fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, borderLeft: "3px solid var(--yellow-deep)" },
    code: { fontFamily: "var(--mono)", fontSize: 13, background: "var(--paper-2)" },
    verse: { fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16 },
    p: { fontFamily: "var(--serif)", fontSize: 16 },
    ul: { fontFamily: "var(--serif)", fontSize: 15 },
    ol: { fontFamily: "var(--serif)", fontSize: 15 }
  };
  const rows = Math.max(1, Math.min(16, Math.ceil((value || "").length / 60) + (value || "").split("\n").length));
  const isList = t === "ul" || t === "ol";
  return (
    <div>
      {isList && <div className="np-mono" style={{ fontSize: 9.5, color: "var(--ink-soft)", marginBottom: 3 }}>list — one item per line</div>}
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
        style={{ ...base, ...(byType[t] || byType.p) }} />
    </div>
  );
}

function ForkEditor({ article, me, signedIn, onSubmit, onClose }) {
  const A = article || { body: [] };
  const slug = A.slug || "x";
  const F = window.NpjFeedback;
  const units = React.useMemo(() => (F && F.forkUnits ? F.forkUnits(A.body) : []), [A]);
  const unitByKey = React.useMemo(() => { const m = {}; units.forEach(u => { m[u.key] = u; }); return m; }, [units]);

  const restored = React.useMemo(() => loadForkDraft(slug), [slug]);
  const [edits, setEdits] = useState(() => {
    if (restored && restored.edits) return restored.edits;
    const e = {}; units.forEach(u => { e[u.key] = u.text; }); return e;
  });
  const [rationale, setRationale] = useState(() => (restored && restored.rationale) || "");
  const [visibility, setVisibility] = useState(() => (restored && restored.visibility) || "public");
  const [saved, setSaved] = useState(false);
  const syncTimer = useRef(null);

  // autosave (local always; Matrix best-effort, debounced) on every change
  useEffect(() => {
    saveForkDraft(slug, { edits, rationale, visibility, ts: Date.now() });
    setSaved(true); const t = setTimeout(() => setSaved(false), 1200);
    if (signedIn && window.MatrixAuth && window.MatrixAuth.setAccountData) {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        try { window.MatrixAuth.setAccountData("press.npj.fork." + slug, { edits, rationale, visibility, ts: Date.now() }); } catch (e) {}
      }, 1500);
    }
    return () => clearTimeout(t);
  }, [edits, rationale, visibility, slug, signedIn]);

  const setBlock = (key, val) => setEdits(e => ({ ...e, [key]: val }));
  const changed = F && F.forkChanged ? F.forkChanged(A.body, edits) : false;
  const valid = changed || rationale.trim().length >= 8;

  const submit = () => {
    if (!valid) return;
    // edited text → a real fork (mergeable). No edits but a note → an article comment.
    const draft = changed
      ? { kind: "suggestion", scope: "article", anchor: { scope: "article", quote: "" }, forkBody: F.applyForkUnits(A.body, edits), rationale: rationale.trim(), visibility }
      : { kind: "comment", scope: "article", anchor: { scope: "article", quote: "" }, rationale: rationale.trim(), visibility };
    clearForkDraft(slug);
    onSubmit(draft);
  };

  const changedCount = units.filter(u => String(edits[u.key]) !== u.text).length;

  return (
    <div className="fade-in" style={{ position: "fixed", inset: 0, zIndex: 7000, background: "var(--paper)", color: "var(--ink)", overflowY: "auto" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--data)", color: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "9px 18px", flexWrap: "wrap", boxShadow: "0 2px 0 rgba(22,20,13,.2)" }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 18, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--mono)" }}>⑂</span> FORK THE ARTICLE
        </span>
        <span className="np-mono" style={{ fontSize: 10.5, opacity: .85 }}>{changedCount ? changedCount + " block" + (changedCount === 1 ? "" : "s") + " changed" : "edit any text below"}</span>
        <span style={{ flex: 1 }} />
        <span className="np-mono" style={{ fontSize: 10, opacity: saved ? .95 : .5, transition: "opacity .3s" }}>{saved ? "saved to this device ✓" : "autosaves"}</span>
        <button className="btn btn-sm" onClick={onClose} style={{ background: "var(--paper)", color: "var(--ink)" }}>✕ Close</button>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "26px 20px 140px" }}>
        <div className="np-mono" style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.5, border: "1px dashed var(--rule-strong)", padding: "10px 12px", marginBottom: 20 }}>
          Edit the existing text of <strong style={{ color: "var(--ink)" }}>“{A.headline || slug}”</strong>. This is a lightweight fork — you're revising the words, not the layout. Images and embeds stay as they are. Your fork is saved here as you type; submit it when you're ready and an editor can preview, then merge it.
        </div>

        {A.headline && <div style={{ fontFamily: "var(--display)", fontSize: 34, lineHeight: 1.02, marginBottom: 18, color: "var(--ink-soft)" }}>{A.headline}</div>}

        {(A.body || []).map((b, i) => {
          const u = unitByKey[String(i)];
          if (!u) return (
            <div key={i} className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", background: "var(--paper-2)", border: "1px solid var(--rule)", padding: "8px 10px", marginBottom: 12 }}>
              ▣ {b.type || "block"} — kept as-is (not editable in a fork)
            </div>
          );
          return <ForkBlock key={i} unit={u} value={edits[u.key] != null ? edits[u.key] : u.text} onChange={v => setBlock(u.key, v)} />;
        })}
      </div>

      {/* submit bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 3, background: "var(--card)", borderTop: "1.5px solid var(--ink)", padding: "12px 18px", boxShadow: "0 -3px 0 rgba(22,20,13,.08)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <input value={rationale} onChange={e => setRationale(e.target.value)}
            placeholder="What did you change, and why? (a short note for the editor)"
            style={{ width: "100%", border: "1.5px solid var(--ink)", background: "var(--paper)", fontFamily: "var(--serif)", fontSize: 13.5, padding: "8px 10px", outline: "none", boxSizing: "border-box", marginBottom: 9 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 0, border: "1.5px solid var(--ink)" }}>
              {[["public", "🌐 Public"], ["private", "🔒 Private"]].map(([v, l]) => (
                <button key={v} onClick={() => setVisibility(v)} className="np-cond" style={{ padding: "5px 10px", border: 0, cursor: "pointer",
                  borderRight: v === "public" ? "1.5px solid var(--ink)" : 0, fontWeight: 700, fontSize: 12,
                  background: visibility === v ? "var(--ink)" : "transparent", color: visibility === v ? "var(--yellow)" : "var(--ink)" }}>{l}</button>
              ))}
            </div>
            <span className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>{signedIn ? "as " + me : "you'll sign in next"}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={!valid} style={{ opacity: valid ? 1 : .45, cursor: valid ? "pointer" : "not-allowed" }}
              onClick={submit}>{signedIn ? (changed ? "Submit fork" : "Post note") : "Continue →"}</button>
          </div>
          {!valid && <div className="np-mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 7 }}>Edit some text, or add a note (8+ chars), to submit.</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ForkEditor });
