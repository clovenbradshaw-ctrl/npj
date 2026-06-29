/* BlockView.jsx — the BLOCK editor: a third editing surface that sits between
   the Prose (WYSIWYG) canvas and the raw HTML source view. NO MODEL.

   Why it exists. In the free-form contentEditable canvas a citation marker
   (<sup class="md-cite">) and its claim span are inline nodes the browser is
   free to wrap, strand on their own line, or split a word across — the "line
   break glitchiness" around citations. This surface breaks the document into
   discrete, Mailchimp-style building blocks: each block is its own small editor,
   so a stray Enter splits cleanly into a NEW block instead of corrupting a
   marker, line breaks within a block are explicit (Shift+Enter), and every
   citation in a block is shown as an atomic chip you locate or remove
   deliberately. Splitting a block is refused mid-citation, so a marker and its
   words can never be torn across a paragraph break.

   Lossless. Each block carries the real citation markup verbatim; the lead nodes
   (banner / title / subtitle) and the auto-managed Footnotes list are preserved
   untouched. On Apply the parent re-assembles the document and runs the same
   reconcile a restored draft does, so pinned quotes, claim spans and footnotes
   survive exactly as they were. */

(function () {
  var uidN = 0;
  function uid() { uidN += 1; return "blk-" + uidN + "-" + (uidN * 2654435761 % 100000).toString(36); }

  // What kind of building block an element is — drives the card UI. Editable
  // kinds (text / list) get an in-card editor; everything else is preserved
  // verbatim and shown as a labelled, reorderable placeholder card.
  function classifyEl(el) {
    var tag = el.tagName.toLowerCase();
    var cls = el.getAttribute("class") || "";
    if (tag === "ul" || tag === "ol") return { kind: "list", tag: tag };
    if (tag === "p") return { kind: "text", tag: "p" };
    if (tag === "h2") return { kind: "text", tag: "h2" };
    if (tag === "h3") return { kind: "text", tag: "h3" };
    if (tag === "blockquote") return { kind: "text", tag: "blockquote" };
    if (tag === "figure") {
      if (el.querySelector("image-slot, img")) return { kind: "media", label: "Image", icon: "image" };
      if (el.getAttribute("data-embed-url") || el.querySelector("iframe, video, audio")) return { kind: "media", label: "Embed", icon: "play-circle" };
      return { kind: "media", label: "Figure", icon: "image" };
    }
    if (tag === "pre") return { kind: "media", label: cls.indexOf("verse") >= 0 ? "Verse" : "Code block", icon: "code" };
    if (tag === "hr") return { kind: "media", label: "Divider", icon: "minus" };
    if (cls.indexOf("cmp-widget") >= 0) return { kind: "media", label: "Widget", icon: "chart-bar" };
    return { kind: "media", label: tag.toUpperCase(), icon: "square" };
  }

  // Decompose the document HTML into lead nodes (kept verbatim, shown read-only),
  // the body blocks the author rearranges, and the footnotes tail (auto-managed).
  function decompose(html) {
    var root = document.createElement("div");
    root.innerHTML = html || "";
    var lead = [], tail = [], blocks = [];
    Array.prototype.forEach.call(root.childNodes, function (node) {
      if (node.nodeType === 3) {
        var t = (node.nodeValue || "").trim();
        if (t) blocks.push(makeBlock(wrapText(t)));
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      var cls = node.getAttribute("class") || "";
      if (tag === "figure" && /\bnr-banner\b/.test(cls)) { lead.push(node.outerHTML); return; }
      if (tag === "h1") { lead.push(node.outerHTML); return; }
      if (/\bnr-dek\b/.test(cls)) { lead.push(node.outerHTML); return; }
      if (tag === "ol" && /\bnr-fnotes\b/.test(cls)) { tail.push(node.outerHTML); return; }
      blocks.push(makeBlock(node));
    });
    return { lead: lead, tail: tail, blocks: blocks };
  }
  function wrapText(t) { var p = document.createElement("p"); p.textContent = t; return p; }

  function makeBlock(el) {
    var c = classifyEl(el);
    var b = { id: uid(), kind: c.kind, tag: c.tag || el.tagName.toLowerCase() };
    if (c.kind === "media") { b.label = c.label; b.icon = c.icon; b.outerHTML = el.outerHTML; return b; }
    b.className = (el.getAttribute("class") || "").replace(/\bnr-dek\b/g, "").trim();
    b.style = el.getAttribute("style") || "";
    b.html = el.innerHTML;
    return b;
  }

  // Re-assemble the document: lead nodes, then each block (verbatim for media,
  // rebuilt from its live edited HTML for text/list), then the footnotes tail.
  function assemble(model, htmls) {
    var parts = model.lead.slice();
    model.blocks.forEach(function (b) {
      if (b.kind === "media") { parts.push(b.outerHTML); return; }
      var inner = htmls[b.id] != null ? htmls[b.id] : b.html;
      var attrs = "";
      if (b.className) attrs += ' class="' + b.className.replace(/"/g, "&quot;") + '"';
      if (b.style) attrs += ' style="' + b.style.replace(/"/g, "&quot;") + '"';
      if (b.kind === "list") { parts.push("<" + b.tag + ">" + inner + "</" + b.tag + ">"); return; }
      parts.push("<" + b.tag + attrs + ">" + (inner.trim() ? inner : "<br>") + "</" + b.tag + ">");
    });
    return parts.concat(model.tail).join("\n");
  }

  // a short, readable label for a source-backed citation chip
  function sourceLabel(key) {
    var rec = (window.NPJ && window.NPJ.SOURCES && window.NPJ.SOURCES[key]) || {};
    var t = rec.title || rec.original_url || key || "source";
    return t.length > 30 ? t.slice(0, 29) + "…" : t;
  }

  var TYPES = [
    { tag: "p", label: "Paragraph" },
    { tag: "h2", label: "Heading" },
    { tag: "h3", label: "Subheading" },
    { tag: "blockquote", label: "Quote" }
  ];

  // ---- one block card: a labelled, reorderable editor (or media placeholder) --
  function BlockCard(props) {
    var b = props.block, NR = props.NR, htmls = props.htmls;
    var ed = useRef(null);
    var seeded = useRef(false);
    var chipState = useState([]);
    var chips = chipState[0], setChips = chipState[1];

    // recompute the citation chips for this block from its live DOM
    var refreshChips = useCallback(function () {
      var root = ed.current; if (!root) return;
      var out = [];
      root.querySelectorAll("sup.md-cite[data-cite]").forEach(function (sup) {
        out.push({
          node: sup,
          key: sup.getAttribute("data-cite") || "",
          fn: sup.hasAttribute("data-fn"),
          num: (sup.textContent || "").trim(),
          cid: sup.getAttribute("data-cid") || ""
        });
      });
      setChips(out);
    }, [setChips]);

    // seed the editor's HTML ONCE (imperatively, so React never clobbers the
    // caret), reading the latest edited copy so a reorder/split keeps content
    useEffect(function () {
      if (seeded.current || !ed.current || b.kind === "media") return;
      ed.current.innerHTML = htmls.current[b.id] != null ? htmls.current[b.id] : (b.html || "");
      seeded.current = true;
      refreshChips();
    }, [b.id, b.kind, b.html, htmls, refreshChips]);

    var onInput = useCallback(function () {
      if (ed.current) htmls.current[b.id] = ed.current.innerHTML;
      refreshChips();
    }, [b.id, htmls, refreshChips]);

    // the .claim-src / sup.md-cite the caret is sitting inside, if any — split is
    // refused here so a citation can't be torn across the new block boundary
    var caretInCite = function () {
      var s = window.getSelection();
      if (!s || !s.rangeCount) return false;
      var n = s.getRangeAt(0).startContainer;
      var el = n && n.nodeType === 1 ? n : (n && n.parentElement);
      return !!(el && el.closest && el.closest(".claim-src, sup.md-cite") && ed.current && ed.current.contains(el));
    };

    var splitHere = function () {
      var root = ed.current; if (!root) return;
      var s = window.getSelection();
      if (!s || !s.rangeCount || !root.contains(s.getRangeAt(0).startContainer)) return;
      var r = s.getRangeAt(0);
      var before = document.createRange();
      before.setStart(root, 0); before.setEnd(r.startContainer, r.startOffset);
      var after = document.createRange();
      after.setStart(r.endContainer, r.endOffset);
      after.setEnd(root, root.childNodes.length);
      var a = document.createElement("div"); a.appendChild(before.cloneContents());
      var c = document.createElement("div"); c.appendChild(after.cloneContents());
      htmls.current[b.id] = a.innerHTML;
      root.innerHTML = a.innerHTML;
      props.onSplit(b.id, c.innerHTML);
      refreshChips();
    };

    var onKeyDown = function (e) {
      if (b.kind === "list") return;          // lists keep native Enter = new item
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (caretInCite()) { props.flash("Move the caret out of the citation before splitting — a marker can't span two blocks."); return; }
        splitHere();
      } else if (e.key === "Backspace") {
        var s = window.getSelection();
        if (s && s.isCollapsed && s.rangeCount) {
          var r = s.getRangeAt(0);
          var atStart = r.startOffset === 0 && (r.startContainer === ed.current || (ed.current.firstChild && (r.startContainer === ed.current.firstChild)) || !(ed.current.textContent || "").length);
          if (atStart) { e.preventDefault(); props.onMergeUp(b.id); }
        }
      }
    };

    var insertBreak = function () {
      var root = ed.current; if (!root) return;
      root.focus();
      var ok = false;
      try { ok = document.execCommand("insertHTML", false, "<br>"); } catch (x) {}
      if (!ok) root.appendChild(document.createElement("br"));
      onInput();
    };

    var removeCite = function (chip) {
      var root = ed.current; if (!root) return;
      if (chip.cid) root.querySelectorAll('.claim-src[data-cid="' + chip.cid + '"]').forEach(function (span) {
        while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
        span.remove();
      });
      if (chip.node && chip.node.parentNode) chip.node.remove();
      onInput();
    };

    var locate = function (chip) {
      if (!chip.node) return;
      chip.node.classList.add("nr-blk-flash");
      setTimeout(function () { try { chip.node.classList.remove("nr-blk-flash"); } catch (x) {} }, 1100);
      try { chip.node.scrollIntoView({ block: "nearest" }); } catch (x) {}
    };

    var card = { background: NR.field, border: "1px solid " + NR.line, borderRadius: 8, marginBottom: 12, position: "relative" };
    var head = { display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderBottom: "1px solid " + NR.line, flexWrap: "wrap" };
    var iconBtn = { background: "transparent", border: 0, color: NR.muted, cursor: "pointer", padding: "3px 5px", fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center" };

    return (
      <div className="nr-blk-card" style={card}>
        <div style={head}>
          <span style={{ cursor: "grab", color: NR.muted, fontSize: 14, padding: "0 2px" }} title="Block">⠿</span>
          {b.kind === "media"
            ? <span className="np-mono" style={{ fontSize: 11, color: NR.text, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}><i className={"ph ph-" + (b.icon || "square")} aria-hidden="true" /> {b.label}</span>
            : b.kind === "list"
              ? <span className="np-mono" style={{ fontSize: 11, color: NR.text, fontWeight: 700 }}>{b.tag === "ol" ? "Numbered list" : "Bulleted list"}</span>
              : (
                <select value={b.tag} onChange={function (e) { props.onType(b.id, e.target.value); }} className="np-cond"
                  style={{ background: NR.bg, color: NR.text, border: "1px solid " + NR.line, borderRadius: 4, fontSize: 11.5, fontWeight: 700, padding: "2px 6px", cursor: "pointer" }}>
                  {TYPES.map(function (t) { return <option key={t.tag} value={t.tag}>{t.label}</option>; })}
                </select>
              )}
          {b.kind !== "media" && (
            <button type="button" onMouseDown={function (e) { e.preventDefault(); }} onClick={insertBreak} title="Insert a line break inside this block (Shift+Enter)" className="np-cond"
              style={{ background: "transparent", border: "1px solid " + NR.line, color: NR.soft, borderRadius: 4, fontSize: 10.5, fontWeight: 700, padding: "2px 7px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>↵ Break</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" style={iconBtn} title="Move up" onClick={function () { props.onMove(b.id, -1); }} disabled={props.first}><i className="ph ph-arrow-up" aria-hidden="true" /></button>
          <button type="button" style={iconBtn} title="Move down" onClick={function () { props.onMove(b.id, 1); }} disabled={props.last}><i className="ph ph-arrow-down" aria-hidden="true" /></button>
          <button type="button" style={Object.assign({}, iconBtn, { color: NR.warn })} title="Delete this block" onClick={function () { props.onDelete(b.id); }}><i className="ph ph-trash" aria-hidden="true" /></button>
        </div>

        {b.kind === "media"
          ? <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, padding: "12px 12px", lineHeight: 1.5 }}>
              Preserved as-is — reorder or delete it here, edit it in Prose. {b.label === "Image" ? "🖼" : b.label === "Embed" ? "▶" : ""}
            </div>
          : React.createElement(b.kind === "list" ? b.tag : "div", {
              ref: ed,
              contentEditable: true,
              suppressContentEditableWarning: true,
              className: "nr-blk-ed md-preview" + (b.kind === "list" ? " is-list" : " is-" + b.tag),
              spellCheck: true,
              onInput: onInput,
              onKeyDown: onKeyDown,
              style: { color: NR.text, outline: "none", padding: "10px 12px", minHeight: 24 }
            })}

        {chips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 12px 10px", marginTop: -2 }}>
            {chips.map(function (c, i) {
              return (
                <span key={i} className="np-mono nr-blk-chip" title={c.fn ? "footnote · click to locate" : (c.key + " · click to locate")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, background: NR.bg, border: "1px solid " + NR.line, borderRadius: 11, padding: "1px 4px 1px 7px", color: NR.soft }}>
                  <button type="button" onClick={function () { locate(c); }} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", font: "inherit", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <sup style={{ color: "var(--yellow)", fontWeight: 700 }}>{c.num || "•"}</sup>
                    {c.fn ? "note" : sourceLabel(c.key)}
                  </button>
                  <button type="button" onClick={function () { removeCite(c); }} title="Remove this citation from the block" aria-label="Remove citation"
                    style={{ background: "none", border: 0, color: NR.muted, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px" }}>×</button>
                </span>
              );
            })}
          </div>
        )}

        <button type="button" className="nr-blk-add" onClick={function () { props.onAddBelow(b.id); }} title="Add a paragraph below">
          <i className="ph ph-plus ph-bold" aria-hidden="true" /> <span>Add block</span>
        </button>
      </div>
    );
  }

  // ----------------------------- the surface --------------------------------
  function BlockView(props) {
    var NR = props.NR;
    var modelRef = useRef(null);
    if (!modelRef.current) modelRef.current = decompose(props.html);
    var htmls = useRef(null);
    if (!htmls.current) { htmls.current = {}; modelRef.current.blocks.forEach(function (b) { if (b.kind !== "media") htmls.current[b.id] = b.html; }); }

    var blocksState = useState(modelRef.current.blocks);
    var blocks = blocksState[0], setBlocks = blocksState[1];
    var noteState = useState(""); var note = noteState[0], setNote = noteState[1];
    var flash = useCallback(function (m) { setNote(m); setTimeout(function () { setNote(""); }, 3200); }, [setNote]);

    var idx = function (id) { return blocks.findIndex(function (b) { return b.id === id; }); };
    var commit = function (next) { modelRef.current.blocks = next; setBlocks(next); };

    var onMove = function (id, dir) {
      var i = idx(id), j = i + dir; if (i < 0 || j < 0 || j >= blocks.length) return;
      var next = blocks.slice(); var t = next[i]; next[i] = next[j]; next[j] = t; commit(next);
    };
    var onDelete = function (id) {
      var next = blocks.filter(function (b) { return b.id !== id; }); delete htmls.current[id]; commit(next);
    };
    var onType = function (id, tag) {
      var next = blocks.map(function (b) { return b.id === id ? Object.assign({}, b, { tag: tag }) : b; }); commit(next);
    };
    var onAddBelow = function (id) {
      var nb = { id: uid(), kind: "text", tag: "p", className: "", style: "", html: "" };
      htmls.current[nb.id] = "";
      var i = idx(id); var next = blocks.slice(); next.splice(i + 1, 0, nb); commit(next);
    };
    var onSplit = function (id, afterHtml) {
      var nb = { id: uid(), kind: "text", tag: "p", className: "", style: "", html: afterHtml };
      htmls.current[nb.id] = afterHtml;
      var i = idx(id); var next = blocks.slice(); next.splice(i + 1, 0, nb); commit(next);
    };
    var onMergeUp = function (id) {
      var i = idx(id); if (i <= 0) return;
      var prev = blocks[i - 1];
      if (prev.kind !== "text") return;        // only fold a paragraph into a paragraph above
      var merged = (htmls.current[prev.id] || "") + (htmls.current[id] || "");
      // give the merged block a fresh id so its editor remounts and re-seeds with
      // the combined content (a mounted editor seeds its HTML only once)
      var newPrev = Object.assign({}, prev, { id: uid(), html: merged });
      htmls.current[newPrev.id] = merged;
      delete htmls.current[prev.id]; delete htmls.current[id];
      var next = blocks.slice(); next.splice(i - 1, 2, newPrev); commit(next);
    };

    var apply = function () { props.onApply(assemble(modelRef.current, htmls.current)); };

    var bar = { padding: props.isMobile ? "10px 12px" : "12px 18px", borderBottom: "1px solid " + NR.line, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 };
    var btn = { background: "transparent", border: "1px solid " + NR.line, color: NR.text, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" };

    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 30, background: NR.bg, display: "flex", flexDirection: "column" }}>
        <div style={bar}>
          <div style={{ marginRight: "auto", minWidth: 0 }}>
            <div className="np-eyebrow" style={{ color: NR.text }}>Blocks</div>
            <div className="np-mono npj-hide-sm" style={{ fontSize: 10.5, color: NR.muted, marginTop: 2 }}>One building block at a time. Enter splits a block, Shift+Enter adds a line break — citations stay put.</div>
          </div>
          {note && <span className="np-mono" style={{ fontSize: 10.5, color: NR.warn, maxWidth: 320 }}>{note}</span>}
          <button type="button" onMouseDown={function (e) { e.preventDefault(); }} onClick={props.onCancel} title="Discard these edits and return to the editor" className="np-cond" style={Object.assign({}, btn, { color: NR.soft })}>Cancel</button>
          <button type="button" onMouseDown={function (e) { e.preventDefault(); }} onClick={apply} title="Rebuild the document from these blocks, then re-link citations and renumber" className="np-cond"
            style={{ background: "var(--yellow)", border: "1.5px solid var(--ink)", color: "var(--ink)", padding: "6px 14px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i className="ph-bold ph-check" aria-hidden="true" /> Apply
          </button>
        </div>

        <div className="np-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: props.isMobile ? "14px 12px 60px" : "18px 22px 80px" }}>
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            {modelRef.current.lead.length > 0 && (
              <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, border: "1px dashed " + NR.line, borderRadius: 8, padding: "9px 12px", marginBottom: 14, lineHeight: 1.5 }}>
                <b style={{ color: NR.soft }}>Banner, title &amp; subtitle</b> are kept as-is — edit them in the Prose view's fields.
              </div>
            )}
            {blocks.length === 0 && (
              <div className="np-mono" style={{ fontSize: 11, color: NR.muted, padding: "20px 0" }}>No body blocks yet.</div>
            )}
            {blocks.map(function (b, i) {
              return <BlockCard key={b.id} block={b} NR={NR} htmls={htmls} first={i === 0} last={i === blocks.length - 1}
                onMove={onMove} onDelete={onDelete} onType={onType} onAddBelow={onAddBelow} onSplit={onSplit} onMergeUp={onMergeUp} flash={flash} />;
            })}
            {modelRef.current.tail.length > 0 && (
              <div className="np-mono" style={{ fontSize: 10.5, color: NR.muted, border: "1px dashed " + NR.line, borderRadius: 8, padding: "9px 12px", marginTop: 4, lineHeight: 1.5 }}>
                <b style={{ color: NR.soft }}>Footnotes</b> are numbered automatically from the markers above.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  window.BlockView = BlockView;
})();
