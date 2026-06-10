/* ============================================================
   SentenceTable.jsx — the grounding table. Every sentence is a record.

   An alternate view of the SAME draft: one row per sentence (derived live by
   window.NpjSentences from the editor DOM), with its grounding status, the
   reusable citations attached to it, and its stance. Mutations route through the
   Newsroom's tableApi → the same DOM + autosave the prose editor uses, so the
   two views never diverge.

   Author-facing language is plain English (Grounded / Needs source / Your voice
   / N sources; Argue / Assert / Infer). The logic operators (⊤ ⊥ ⊨ ⊢) stay
   internal to CITEY_STATES — this is just what the author sees.

   Mounts: <SentenceTable api={tableApi} NR={NR} />. Publishes window.SentenceTable.
   ============================================================ */
function SentenceTable({ api, NR }) {
  const [, force] = React.useState(0);
  const [needsOnly, setNeedsOnly] = React.useState(false);
  const [addFor, setAddFor] = React.useState(null);     // sid of the row whose "add citation" menu is open
  const [walk, setWalk] = React.useState(null);         // { list:[sid…], pos } — the "cite everything" stepper
  const bump = () => force(n => n + 1);

  // stance vocabulary — author sees plain verbs; the model keeps the operators
  const STANCE = [["voice", "Argue"], ["testimony", "Assert"], ["analysis", "Infer"]];
  const stanceLabel = (s) => (STANCE.find(x => x[0] === s) || [, "—"])[1];

  const Brain = window.CiteyBrain;
  const rows = (api.segment() || []);

  // Aggregate the grounding status of a sentence from its claim spans.
  function statusOf(row) {
    const spans = row.claimSpans || [];
    let owned = null, conflict = false, needs = false; const groundedKeys = {};
    spans.forEach(s => {
      let v = { state: "falsum" };
      try { v = Brain.citeyStateForSpan({ el: s }); } catch (e) {}
      if (v.state === "asserted" || v.state === "testimony" || v.state === "voice") owned = s.getAttribute("data-stance") || "analysis";
      else if (v.state === "verum" || v.state === "entails") String(v.srcKey || s.getAttribute("data-src") || "").split(/\s+/).filter(Boolean).forEach(k => groundedKeys[k] = 1);
      else if (v.state === "negation") conflict = true;
      else needs = true;
    });
    const nKeys = Object.keys(groundedKeys).length;
    if (conflict) return { key: "conflict", label: "Sources disagree", bg: "#fdecea", fg: "#b3261e" };
    if (owned && !nKeys && !needs) return { key: "voice", label: "Your voice", bg: "#efeafc", fg: "#6b5bd6", owned: owned, spans: spans };
    if (nKeys && !needs) return nKeys > 1
      ? { key: "multi", label: nKeys + " sources", bg: "#e8eefb", fg: "#3a63c4", spans: spans }
      : { key: "grounded", label: "Grounded", bg: "#e7f4ec", fg: "#1f8a55", spans: spans };
    return { key: "needs", label: "Needs source", bg: "#fbf1e3", fg: "#b5701b", spans: spans };
  }

  const enriched = rows.map(r => ({ row: r, st: statusOf(r) }));
  const needsCount = enriched.filter(e => e.st.key === "needs").length;
  const shown = needsOnly ? enriched.filter(e => e.st.key === "needs") : enriched;

  // ---- "cite everything": walk the sentences that need a source, in order ----
  const focusRow = (sid) => {
    setAddFor(sid);
    setTimeout(() => { const tr = document.querySelector('tr[data-sid="' + (window.CSS && CSS.escape ? CSS.escape(sid) : sid) + '"]'); if (tr) tr.scrollIntoView({ block: "center", behavior: "smooth" }); }, 20);
  };
  const startWalk = () => {
    const list = enriched.filter(e => e.st.key === "needs").map(e => e.row.sid);
    if (!list.length) return;
    setWalk({ list, pos: 0 }); focusRow(list[0]);
  };
  const nextWalk = () => {
    if (!walk) return;
    const stillNeeds = new Set(enriched.filter(e => e.st.key === "needs").map(e => e.row.sid));
    let pos = walk.pos + 1;
    while (pos < walk.list.length && !stillNeeds.has(walk.list[pos])) pos++;   // skip ones already grounded
    if (pos >= walk.list.length) { setWalk(null); setAddFor(null); return; }
    setWalk({ list: walk.list, pos }); focusRow(walk.list[pos]);
  };
  const endWalk = () => { setWalk(null); setAddFor(null); };

  // ---- per-row actions ----
  const addExisting = (row, c) => { api.attachExisting(row, c.id); setAddFor(null); bump(); };
  const addNew = (row, key) => { api.pinNew(row, key); setAddFor(null); };
  const setStance = (row, st, spans) => {
    if (st === "") { (spans || []).forEach(s => api.unown(s)); }
    else api.own(row, st);
    bump();
  };

  const pill = (st) => React.createElement("span", { style: { display: "inline-block", padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.fg, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" } }, st.label);

  const th = { textAlign: "left", padding: "10px 14px", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: NR.muted, fontWeight: 600 };
  const td = { padding: "12px 14px", borderTop: "1px solid " + NR.line, verticalAlign: "top" };

  return React.createElement("div", { style: { padding: "14px 16px 0", color: NR.text } },
    // ---- header: filter + count ----
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 } },
      React.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 14, color: NR.text } },
        React.createElement("input", { type: "checkbox", checked: needsOnly, onChange: e => setNeedsOnly(e.target.checked) }),
        "Needs grounding only"),
      React.createElement("span", { style: { flex: 1 } }),
      React.createElement("span", { className: "np-mono", style: { fontSize: 11, color: NR.muted } }, (needsOnly ? needsCount : enriched.length) + " of " + enriched.length + " sentences")),

    // ---- the table ----
    React.createElement("div", { style: { border: "1px solid " + NR.line, borderRadius: 10, overflow: "hidden", background: NR.field } },
      React.createElement("table", { style: { width: "100%", borderCollapse: "collapse" } },
        React.createElement("thead", null, React.createElement("tr", null,
          React.createElement("th", { style: Object.assign({ width: 150 }, th) }, "Status"),
          React.createElement("th", { style: th }, "Sentence"),
          React.createElement("th", { style: th }, "Citations"),
          React.createElement("th", { style: Object.assign({ width: 170 }, th) }, "Stance"))),
        React.createElement("tbody", null,
          shown.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: 4, style: Object.assign({ color: NR.muted, fontFamily: "var(--mono)", fontSize: 12 }, td) },
            needsOnly ? "Nothing left to ground — every sentence is sourced or owned." : "Write a few sentences in Prose and they'll show here as rows to ground.")),
          shown.map(({ row, st }) => {
            const cites = (st.spans || []).reduce((acc, s) => acc.concat((api.citationsFor(s) || []).map(c => ({ c, span: s }))), []);
            const onWalk = walk && walk.list[walk.pos] === row.sid;
            return React.createElement("tr", { key: row.sid, "data-sid": row.sid, style: { background: onWalk ? "rgba(124,116,222,.12)" : st.key === "needs" ? "rgba(181,112,27,.05)" : "transparent", outline: onWalk ? "2px solid #7C74DE" : "none" } },
              // status
              React.createElement("td", { style: td }, pill(st)),
              // sentence text (click → jump to editor)
              React.createElement("td", { style: td },
                React.createElement("button", { onClick: () => api.jumpTo(row), title: "Open this sentence in the editor",
                  style: { textAlign: "left", background: "none", border: 0, color: NR.text, font: "inherit", fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.45, cursor: "pointer", padding: 0 } }, row.text)),
              // citations
              React.createElement("td", { style: td },
                st.key === "voice"
                  ? React.createElement("span", { style: { fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.muted } }, "no source needed")
                  : React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" } },
                    cites.map(({ c, span }, i) => {
                      const rec = (window.NPJ.SOURCES || {})[c.srcKey] || {};
                      const reused = api.usageCount(c.id);
                      const name = rec.title && rec.title !== "Web source" && rec.title !== "Web snapshot" ? rec.title : (c.srcKey || "source");
                      return React.createElement("span", { key: c.id + i, title: "“" + (c.quote || "").slice(0, 160) + "”",
                        style: { display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 9px", borderRadius: 6, background: "#e7f4ec", color: "#1f7a4d", fontFamily: "var(--cond)", fontSize: 12.5, maxWidth: 220 } },
                        React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, name + (reused > 1 ? " · reused ×" + reused : "")),
                        React.createElement("button", { onClick: () => { api.detach(span, c.id); bump(); }, title: "Unlink (keeps the citation record)",
                          style: { border: 0, background: "none", color: "#1f7a4d", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 } }, "×"));
                    }),
                    React.createElement("button", { onClick: () => setAddFor(addFor === row.sid ? null : row.sid),
                      style: { display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, border: "1px dashed " + NR.line, background: "transparent", color: NR.soft, cursor: "pointer", fontFamily: "var(--cond)", fontSize: 12.5 } }, "+ Add citation"),
                    addFor === row.sid && React.createElement(AddMenu, { row, api, NR, onExisting: addExisting, onNew: addNew, onClose: () => setAddFor(null) }))),
              // stance
              React.createElement("td", { style: td },
                st.key === "grounded" || st.key === "multi"
                  ? React.createElement("span", { style: { fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: NR.muted } }, "Sourced fact")
                  : React.createElement("select", { value: st.owned || "", onChange: e => setStance(row, e.target.value, st.spans),
                      style: { width: "100%", background: NR.field, color: NR.text, border: "1px solid " + NR.line, borderRadius: 6, padding: "5px 7px", fontFamily: "var(--cond)", fontSize: 13 } },
                      React.createElement("option", { value: "" }, st.key === "voice" ? "— your voice —" : "Own as…"),
                      STANCE.map(([v, l]) => React.createElement("option", { key: v, value: v }, l)))));
          })))),

    // ---- bottom: Citey walkthrough stepper ----
    React.createElement(WalkBar, { needsCount, NR, walk, onStart: startWalk, onNext: nextWalk, onEnd: endWalk }),

    // ---- legend ----
    React.createElement("div", { style: { margin: "12px 2px 20px", fontFamily: "var(--serif)", fontSize: 12.5, color: NR.muted, lineHeight: 1.6 } },
      React.createElement("div", { style: { fontWeight: 700, color: NR.text, marginBottom: 2 } }, "What the labels mean"),
      React.createElement("span", { style: { color: "#1f8a55", fontWeight: 700 } }, "Grounded"), " — at least one source backs the claim · ",
      React.createElement("span", { style: { color: "#b5701b", fontWeight: 700 } }, "Needs source"), " — nothing pinned yet, warns on publish · ",
      React.createElement("span", { style: { color: "#6b5bd6", fontWeight: 700 } }, "Your voice"), " — opinion or analysis, no source required",
      React.createElement("div", { style: { marginTop: 4 } },
        React.createElement("b", { style: { color: NR.text } }, "Stance"), " (for your voice): ",
        React.createElement("i", null, "Argue"), " a position · ", React.createElement("i", null, "Assert"), " as fact · ", React.createElement("i", null, "Infer"), " from evidence")));
}

// "Add citation" menu — reuse an existing record (ranked) or pin a new one off a source.
function AddMenu({ row, api, NR, onExisting, onNew, onClose }) {
  const all = api.allCitations() || [];
  const ranked = window.CiteyAssist
    ? all.map(c => ({ c, score: ((window.CiteyAssist.rankSpans(row.text, c.quote) || [])[0] || { score: 0 }).score })).sort((a, b) => b.score - a.score).map(x => x.c)
    : all;
  const sources = api.sources() || [];
  return React.createElement("div", { style: { position: "absolute", zIndex: 60, marginTop: 6, width: 320, background: NR.panel, border: "1px solid " + NR.line, borderRadius: 10, boxShadow: "0 16px 40px rgba(0,0,0,.3)", padding: 10 } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", marginBottom: 6 } },
      React.createElement("span", { className: "np-eyebrow", style: { color: NR.muted, flex: 1 } }, "Reuse a citation"),
      React.createElement("button", { onClick: onClose, style: { border: 0, background: "none", color: NR.muted, cursor: "pointer", fontSize: 14 } }, "×")),
    ranked.length === 0 && React.createElement("div", { className: "np-mono", style: { fontSize: 10.5, color: NR.muted, lineHeight: 1.5, marginBottom: 6 } }, "No citations minted yet — pin one from a source below."),
    React.createElement("div", { style: { maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 } },
      ranked.slice(0, 8).map(c => {
        const rec = (window.NPJ.SOURCES || {})[c.srcKey] || {};
        const reused = api.usageCount(c.id);
        return React.createElement("button", { key: c.id, onClick: () => onExisting(row, c), title: "Attach this citation",
          style: { textAlign: "left", border: "1px solid " + NR.line, background: NR.field, color: NR.text, borderRadius: 7, padding: "6px 8px", cursor: "pointer", fontFamily: "var(--serif)", fontSize: 12.5, lineHeight: 1.35 } },
          React.createElement("div", { className: "np-mono", style: { fontSize: 9, color: NR.muted, marginBottom: 1 } }, (rec.title || c.srcKey || "source") + (reused ? " · used ×" + reused : "")),
          "“" + (c.quote || "").slice(0, 90) + ((c.quote || "").length > 90 ? "…" : "") + "”");
      })),
    React.createElement("div", { className: "np-eyebrow", style: { color: NR.muted, margin: "10px 0 5px" } }, "…or pin a new one"),
    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } },
      sources.length === 0 && React.createElement("span", { className: "np-mono", style: { fontSize: 10.5, color: NR.muted } }, "Ingest a source in Prose first."),
      sources.map(({ key, rec }) => React.createElement("button", { key: key, onClick: () => onNew(row, key), title: "Pin the words in this source",
        style: { border: "1px solid " + NR.line, background: "transparent", color: NR.text, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontFamily: "var(--cond)", fontSize: 12 } }, rec.title || key))));
}

// The "cite everything" stepper — walks the sentences that still need a source,
// one at a time, right here in the table (it opens each row's Add-citation menu).
function WalkBar({ needsCount, NR, walk, onStart, onNext, onEnd }) {
  const hidden = window.__citey && window.__citey.hidden && window.__citey.hidden();
  const walking = !!walk;
  const sub = walking
    ? "Walking through " + walk.list.length + " sentence" + (walk.list.length === 1 ? "" : "s") + " that need sources · " + (walk.pos + 1) + " of " + walk.list.length
    : needsCount ? (needsCount + " sentence" + (needsCount === 1 ? "" : "s") + " need sources") : "every sentence is grounded";
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "12px 14px", border: "1px solid " + (walking ? "#7C74DE" : NR.line), borderRadius: 10, background: NR.panel } },
    React.createElement("div", { style: { width: 30, height: 30, borderRadius: 8, background: "#efeafc", color: "#6b5bd6", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: "var(--mono)" } }, needsCount ? "⊥" : "⊤"),
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      React.createElement("div", { style: { fontFamily: "var(--cond)", fontWeight: 700, fontSize: 15, color: NR.text } }, "Citey · cite everything"),
      React.createElement("div", { className: "np-mono", style: { fontSize: 11, color: NR.muted } }, sub)),
    React.createElement("button", { onClick: () => window.__citey && (hidden ? window.__citey.show() : window.__citey.hide()),
      style: { background: "transparent", border: "1px solid " + NR.line, color: NR.text, borderRadius: 8, padding: "7px 13px", cursor: "pointer", fontFamily: "var(--cond)", fontSize: 13.5 } }, hidden ? "Show Citey" : "Hide Citey"),
    walking && React.createElement("button", { onClick: onEnd, style: { background: "transparent", border: "1px solid " + NR.line, color: NR.muted, borderRadius: 8, padding: "7px 11px", cursor: "pointer", fontFamily: "var(--cond)", fontSize: 13.5 } }, "Stop"),
    React.createElement("button", { onClick: walking ? onNext : onStart, disabled: !needsCount,
      style: { background: needsCount ? "#6b5bd6" : NR.line, color: "#fff", border: 0, borderRadius: 8, padding: "7px 15px", cursor: needsCount ? "pointer" : "default", fontFamily: "var(--cond)", fontWeight: 700, fontSize: 13.5 } }, walking ? "Next sentence" : "Walk me through"));
}

window.SentenceTable = SentenceTable;
