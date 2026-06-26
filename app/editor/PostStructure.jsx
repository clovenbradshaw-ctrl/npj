/* PostStructure.jsx — the editing-only structure rail + blank-page type picker.
 *
 * The ONLY UI for the post-structure layer (app/record/structure.js). The Newsroom owns
 * the event log, the fold and the DOM section-span reflow, and hands this an
 * `api`; this renders:
 *   · the blank page — "Start a post": pick a post type (lay down its labeled,
 *     prompt-filled slots) or start blank / just headings;
 *   · the two-level outline — slots (labeled containers showing their prompt when
 *     empty) and orphan sections, draggable within/between slots and across the
 *     slot/orphan boundary; slots drag to reorder;
 *   · apply-a-type-later, remove-type (lossless), and save-as-type.
 *
 * Slots and prompts NEVER render to a reader — this is all editing chrome.
 * Exposes window.StructureRail.
 */
(function () {
  const S = () => window.NpjStructure;

  // ---- the blank page: choose a post type, or start organic ----
  function TypePicker({ api, NR }) {
    const types = api.types || [];
    return (
      <div style={{ padding: "4px 2px" }}>
        <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 6 }}>Start a post</div>
        <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5, marginBottom: 12 }}>
          Pick a type to lay down labeled section stubs to write into — or start blank and let sections grow from your headings.
        </div>
        {types.map(t => (
          <button key={t.id} onClick={() => api.applyType(t.id)} className="np-cond"
            style={{ display: "block", width: "100%", textAlign: "left", background: NR.field, border: "1px solid " + NR.line, color: NR.text, padding: "9px 10px", marginBottom: 8, cursor: "pointer", lineHeight: 1.3 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</span>
              {!t.builtin && <span className="np-mono" style={{ fontSize: 9, color: NR.muted, border: "1px solid " + NR.line, padding: "1px 4px" }}>yours</span>}
            </div>
            {t.description && <div style={{ fontSize: 11, color: NR.soft, marginTop: 3 }}>{t.description}</div>}
            <div style={{ fontSize: 10, color: NR.muted, marginTop: 5 }}>{(t.slots || []).map(s => s.label).join("  ·  ")}</div>
          </button>
        ))}
        <button onClick={() => api.startBlank && api.startBlank()} className="np-cond"
          style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "1px dashed " + NR.line, color: NR.soft, padding: "9px 10px", cursor: "pointer", fontSize: 12.5 }}>
          Blank / just headings
          <div style={{ fontSize: 10, color: NR.muted, marginTop: 2 }}>No template — sections appear as you write H2/H3 headings.</div>
        </button>
      </div>
    );
  }

  // ---- a single section row (draggable; click the label to jump) ----
  function SectionRow({ sec, api, NR, depth, drag, activeId }) {
    const text = (sec.heading && sec.heading.trim()) || "Untitled section";
    const slug = sec.body && sec.body.headingSlug;
    const isStub = sec.body && sec.body.kind === "stubOnly";
    const isDragging = drag.dragId === sec.id;
    const active = !!(slug && slug === activeId);
    const hint = drag.hint && drag.hint.kind === "section" && drag.hint.id === sec.id ? drag.hint.edge : null;
    return (
      <div
        draggable
        onDragStart={e => { drag.start(e, sec.id); }}
        onDragEnd={drag.end}
        onDragOver={e => drag.overSection(e, sec)}
        onDrop={e => drag.dropSection(e, sec)}
        style={{ position: "relative", opacity: isDragging ? 0.4 : 1,
          borderTop: hint === "before" ? "2px solid var(--yellow)" : "2px solid transparent",
          borderBottom: hint === "after" ? "2px solid var(--yellow)" : "2px solid transparent" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px 3px " + (depth * 12 + 4) + "px",
          background: active ? "rgba(255,236,1,.09)" : "transparent",
          borderLeft: active ? "2px solid var(--yellow)" : "2px solid transparent" }}>
          <span title="Drag to reorder or move into a section" style={{ cursor: "grab", color: NR.muted, fontSize: 12, lineHeight: 1, userSelect: "none" }}>⠿</span>
          <button onClick={() => slug && api.jumpTo(slug)} className="np-cond"
            title={isStub ? "Empty — write under this heading" : "Jump to this section"}
            style={{ flex: 1, textAlign: "left", background: "none", border: 0, color: active ? NR.text : (isStub ? NR.muted : NR.soft), padding: "1px 0", fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: slug ? "pointer" : "default", lineHeight: 1.25, fontStyle: isStub ? "italic" : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {text}
          </button>
          <button onClick={() => api.deleteSection(sec.id)} title="Remove from the outline (the heading & prose stay in the document)"
            style={{ background: "none", border: 0, color: NR.muted, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px", opacity: 0.7 }}>✕</button>
        </div>
      </div>
    );
  }

  // ---- a slot: a labeled container; shows its prompt when empty ----
  function SlotBlock({ slot, children, api, NR, drag }) {
    const empty = children.length === 0;
    const isDrop = drag.hint && drag.hint.kind === "slot" && drag.hint.id === slot.id;
    const isSlotDragging = drag.dragSlot === slot.id;
    return (
      <div
        onDragOver={e => drag.overSlot(e, slot)}
        onDrop={e => drag.dropSlot(e, slot)}
        style={{ marginBottom: 8, border: "1px solid " + (isDrop ? "var(--yellow)" : NR.line), background: isDrop ? "rgba(127,216,166,.06)" : "transparent", opacity: isSlotDragging ? 0.4 : 1 }}>
        <div
          draggable
          onDragStart={e => drag.startSlot(e, slot.id)}
          onDragEnd={drag.end}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 6px", background: NR.field, cursor: "grab" }}>
          <span style={{ color: NR.muted, fontSize: 11, lineHeight: 1, userSelect: "none" }}>⠿</span>
          <span className="np-eyebrow" style={{ flex: 1, color: NR.text, fontSize: 11, letterSpacing: ".02em" }}>{slot.label}</span>
          {slot.repeatable && <button onClick={() => api.addSlot(slot.id)} title={'Add another "' + slot.label + '" section'}
            style={{ background: "none", border: "1px solid " + NR.line, color: NR.soft, cursor: "pointer", fontSize: 11, lineHeight: 1, padding: "1px 5px" }}>+</button>}
        </div>
        <div style={{ padding: "4px 6px" }}>
          {empty
            ? <div style={{ padding: "2px 0 2px 12px" }}>
                <div className="np-mono" style={{ fontSize: 10, color: NR.muted, lineHeight: 1.45, fontStyle: "italic", marginBottom: 5 }}>{slot.prompt || "Drag a section here, or write under this heading."}</div>
                {api.startSlot &&
                  <button onClick={() => api.startSlot(slot.id)} className="np-cond" title="Add this section to the document and start writing — its prompt guides you in the page"
                    style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "2px 9px", fontSize: 11, fontWeight: 700, letterSpacing: ".03em", cursor: "pointer" }}>Start →</button>}
              </div>
            : children}
        </div>
      </div>
    );
  }

  function StructureRail({ api, NR, isMobile, mode, setMode, graphText, onSelectSentence, onExpand, activeId }) {
    const lib = S();
    const [menu, setMenu] = useState(null);          // "apply" | null
    const [dragId, setDragId] = useState(null);      // section being dragged
    const [dragSlot, setDragSlot] = useState(null);  // slot being dragged
    const [hint, setHint] = useState(null);          // live drop indicator
    if (!lib) return null;
    const state = api.state;
    const hasType = !!(state && state.appliedTypeId);

    // swap the rail's representation: the nested outline (holonic) ⇄ the actual
    // proposition graph. The full Graph view (⤢) is the big interactive canvas.
    const canGraph = !!(mode != null && setMode && window.GraphView);
    const modeBtn = (k, label, title) => (
      <button onClick={() => setMode(k)} className="np-cond" title={title}
        style={{ flex: 1, background: mode === k ? "var(--yellow)" : "transparent", color: mode === k ? "var(--ink)" : NR.soft, border: "1px solid " + NR.line, padding: "3px 6px", fontSize: 11, fontWeight: 700, letterSpacing: ".02em", cursor: "pointer" }}>{label}</button>
    );
    const modeBar = canGraph ? (
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
        {modeBtn("nested", "Outline", "Nested outline (holonic nesting)")}
        {modeBtn("graph", "Graph", "The document's propositions as a graph")}
        {mode === "graph" && onExpand &&
          <button onClick={onExpand} title="Open the full Graph view" style={{ background: "transparent", color: NR.soft, border: "1px solid " + NR.line, padding: "3px 7px", fontSize: 12, lineHeight: 1, cursor: "pointer" }}>⤢</button>}
      </div>
    ) : null;

    if (mode === "graph") {
      return (
        <div style={{ padding: "2px 2px 16px" }}>
          {modeBar}
          <div style={{ height: 300, border: "1px solid " + NR.line, background: NR.bg, overflow: "hidden" }}>
            {window.GraphView ? <window.GraphView text={graphText} onSelectSentence={onSelectSentence} NR={NR} isMobile={isMobile} bar={false} /> : null}
          </div>
          <div className="np-mono" style={{ fontSize: 10, color: NR.muted, marginTop: 8, lineHeight: 1.5 }}>
            Entities and the relations between them, read from the prose. Click a node to jump to it; ⤢ opens the full view.
          </div>
        </div>
      );
    }

    // blank page → the picker
    if (!api.hasContent && !hasType) {
      return <div style={{ padding: "2px 2px 20px" }}>{modeBar}<TypePicker api={api} NR={NR} /></div>;
    }

    // ---- drag plumbing (shared by rows + slots) ----
    const clear = () => { setDragId(null); setDragSlot(null); setHint(null); };
    const drag = {
      dragId, dragSlot, hint,
      start: (e, id) => { setDragId(id); setDragSlot(null); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); } catch (x) {} },
      startSlot: (e, id) => { setDragSlot(id); setDragId(null); try { e.dataTransfer.effectAllowed = "move"; } catch (x) {} },
      end: clear,
      overSection: (e, sec) => {
        if (!dragId || dragId === sec.id) return;
        e.preventDefault(); e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const edge = (e.clientY - r.top) < r.height / 2 ? "before" : "after";
        setHint({ kind: "section", id: sec.id, edge, parent: sec.parentSlotId == null ? null : sec.parentSlotId });
      },
      dropSection: (e, sec) => {
        if (!dragId || dragId === sec.id) return;
        e.preventDefault(); e.stopPropagation();
        // same drop math the in-document block drag uses (app/record/structure.js) — the
        // rail and the page can never disagree about where a section lands.
        const m = lib.sectionDropIndex(state, dragId, sec.id, (hint && hint.edge) || "before");
        if (m) api.moveSection(dragId, m.parentSlotId, m.index);
        clear();
      },
      overSlot: (e, slot) => { if (!dragId) return; e.preventDefault(); setHint({ kind: "slot", id: slot.id }); },
      dropSlot: (e, slot) => {
        if (!dragId) return; e.preventDefault(); e.stopPropagation();
        api.moveSection(dragId, slot.id, lib.childRefs(state, slot.id).length);
        clear();
      },
      // drop onto the top-level "unsorted" zone → make orphan at the end
      overTop: (e) => { if (!dragId) return; e.preventDefault(); setHint({ kind: "top" }); },
      dropTop: (e) => { if (!dragId) return; e.preventDefault(); api.moveSection(dragId, null, 1e6); clear(); },
      // drop a dragged slot onto another slot → reorder slots
      reorderSlotOnto: (e, slot) => {
        if (!dragSlot || dragSlot === slot.id) return;
        e.preventDefault(); e.stopPropagation();
        const order = lib.topRefs(state).filter(r => r.kind === "slot").map(r => r.id);
        let idx = order.indexOf(slot.id); if (idx < 0) idx = order.length;
        api.reorderSlot(dragSlot, idx); clear();
      }
    };

    const refs = lib.topRefs(state);
    const orphanCount = state.sections.filter(s => s.parentSlotId == null).length;

    return (
      <div style={{ padding: "2px 2px 16px" }}>
        {modeBar}
        {/* type bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, position: "relative" }}>
          {hasType ? (
            <React.Fragment>
              <span className="np-eyebrow" style={{ flex: 1, color: NR.text }}>{(api.appliedType && api.appliedType.name) || "Structure"}</span>
              <button onClick={() => { const n = window.prompt("Save this structure as a reusable post type. Name it:", (api.appliedType && api.appliedType.name) ? api.appliedType.name + " (mine)" : "My structure"); if (n) api.saveType(n); }}
                title="Save the current slot arc as your own reusable type (structure only)"
                style={{ background: "none", border: "1px solid " + NR.line, color: NR.soft, cursor: "pointer", fontSize: 11, padding: "3px 6px" }}>Save type</button>
              <button onClick={() => { if (window.confirm("Remove the post type? Slots dissolve and every section becomes a top-level section. Nothing is lost.")) api.removeType(); }}
                title="Remove the type — dissolve slots, keep all content (lossless)"
                style={{ background: "none", border: "1px solid " + NR.line, color: NR.warn, cursor: "pointer", fontSize: 11, padding: "3px 6px" }}>Remove</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span className="np-eyebrow" style={{ flex: 1, color: NR.muted }}>Outline · {orphanCount}</span>
              <button onClick={() => setMenu(menu === "apply" ? null : "apply")}
                title="Apply a post type to this draft — its slots append; your sections become children to drag in"
                style={{ background: "none", border: "1px solid " + NR.line, color: NR.soft, cursor: "pointer", fontSize: 11, padding: "3px 6px" }}>+ Add structure ▾</button>
              {menu === "apply" && (
                <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 30, background: NR.panel, border: "1px solid " + NR.line, padding: 6, width: 220, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}>
                  <div className="np-eyebrow" style={{ color: NR.muted, marginBottom: 5 }}>Apply a type</div>
                  {(api.types || []).map(t => (
                    <button key={t.id} onClick={() => { setMenu(null); api.applyType(t.id); }} className="np-cond"
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, color: NR.text, padding: "5px 4px", cursor: "pointer", fontSize: 12.5 }}>
                      {t.name}<div style={{ fontSize: 9.5, color: NR.muted }}>{(t.slots || []).map(s => s.label).join(" · ")}</div>
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          )}
        </div>

        {/* the outline */}
        {refs.length === 0 && (
          <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, lineHeight: 1.5 }}>Write an H2/H3 heading and it shows here as a section you can drag.</div>
        )}
        {refs.map(r => {
          if (r.kind === "slot") {
            const kids = lib.childRefs(state, r.id).map(sec => <SectionRow key={sec.id} sec={sec} api={api} NR={NR} depth={1} drag={drag} activeId={activeId} />);
            return (
              <div key={r.id} onDragOver={e => dragSlot ? drag.reorderSlotOnto(e, r.ref) : null} onDrop={e => dragSlot ? drag.reorderSlotOnto(e, r.ref) : null}>
                <SlotBlock slot={r.ref} api={api} NR={NR} drag={drag}>{kids}</SlotBlock>
              </div>
            );
          }
          return <SectionRow key={r.id} sec={r.ref} api={api} NR={NR} depth={0} drag={drag} activeId={activeId} />;
        })}

        {/* a place to drop a section back to the top level (only with a type applied) */}
        {hasType && dragId && (
          <div onDragOver={drag.overTop} onDrop={drag.dropTop}
            style={{ marginTop: 8, padding: "8px", border: "1px dashed " + (hint && hint.kind === "top" ? "var(--yellow)" : NR.line), color: NR.muted, fontSize: 10.5, textAlign: "center" }} className="np-mono">
            drop here to make it a top-level section
          </div>
        )}
      </div>
    );
  }

  window.StructureRail = StructureRail;
})();
