/* SubstackExport.jsx — the reader's "Export for Substack" panel.

   The work is in app/substack-export.js (window.NpjSubstack). This is the
   surface: a one-click rich copy (HTML + markdown on the clipboard, so a paste
   into Substack keeps headings, images, links, blockquotes and the sourcing),
   a .md download, separate Title/Subtitle chips for Substack's own fields, and
   a live markdown preview. Toggles control the footnote markers + the
   "Sources & evidence" footnotes — each source link opens its archive.org
   snapshot on the exact cited passage (a Text Fragment), so the reader lands on
   precisely the evidence.

   Substack mechanics we lean on:
     • Pasted HTML formats; pasted markdown stays literal — so the copy ships
       HTML and the preview/download ship markdown.
     • Substack re-hosts pasted <img> from its public URL — we hand it the
       durable archive.org copy, so photos come across without re-uploading.
     • Title and Subtitle live in their own Substack fields, so the big Copy
       button omits them and we expose them as their own one-click chips. */
/* a labelled checkbox-style toggle (module scope so it never remounts on a
   parent re-render — the panel re-renders on every copy flash) */
function ExportToggle({ on, set, label, hint }) {
  return (
    <button onClick={() => set(!on)} aria-pressed={on} style={{ display: "flex", alignItems: "flex-start", gap: 9, textAlign: "left",
      border: "1.5px solid var(--ink)", background: on ? "var(--yellow)" : "var(--card)", padding: "9px 11px", cursor: "pointer", flex: "1 1 220px" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1, marginTop: 1 }}>{on ? "☑" : "☐"}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 14, display: "block" }}>{label}</span>
        <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>{hint}</span>
      </span>
    </button>
  );
}

function SubstackExport({ article, onClose }) {
  const NS = window.NpjSubstack;
  const [citations, setCitations] = useState(true);
  const [sourcesList, setSourcesList] = useState(true);
  const [copied, setCopied] = useState(null); // "rich" | "text" | "title" | "subtitle" | "md" | "file"
  // hooks run unconditionally (before any early return) — guard inside instead
  const preview = React.useMemo(
    () => (article && NS) ? NS.toMarkdown(article, { citations, sourcesList }) : "",
    [article, NS, citations, sourcesList]);
  const sourceCount = React.useMemo(
    () => (article && NS) ? NS.indexSources(article.body, (window.NPJ && window.NPJ.SOURCES) || {}).ordered.length : 0,
    [article, NS]);
  const flash = (key) => { setCopied(key); setTimeout(() => setCopied(c => (c === key ? null : c)), 1600); };

  if (!article || !NS) return null;
  const opts = { citations, sourcesList };

  const copyText = (text, key) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash(key)).catch(() => {});
    else flash(key);
  };
  const copyForSubstack = async () => {
    const how = await NS.copyForSubstack(article, opts);
    flash(how === "text" ? "text" : how === "rich" ? "rich" : "fail");
  };
  const downloadMd = () => { try { NS.download(article, opts); flash("file"); } catch (e) {} };
  const downloadHtmlFile = () => { try { NS.downloadHtml(article, opts); flash("html"); } catch (e) {} };

  const eyebrow = { fontFamily: "var(--mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)" };
  const fieldBox = { display: "flex", alignItems: "center", gap: 8, border: "1.5px solid var(--ink)", background: "var(--card)", padding: "8px 10px" };
  const chipBtn = { fontFamily: "var(--cond)", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em",
    border: "1.5px solid var(--ink)", background: "var(--paper)", padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap", flex: "0 0 auto" };

  return (
    <div onClick={onClose} className="fade-in" role="dialog" aria-modal="true" aria-label="Export for Substack"
      style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 5200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }}>
      <div onClick={(e) => e.stopPropagation()} className="np-scroll"
        style={{ width: "min(720px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>

        {/* header */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <I.ext style={{ fontSize: 17, color: "var(--yellow)" }} />
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EXPORT FOR SUBSTACK</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        <div style={{ padding: "16px 18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontFamily: "var(--serif)", fontSize: 14.5, lineHeight: 1.5, color: "var(--ink)", margin: 0 }}>
            <strong>Copy the article</strong>, then paste it into a new Substack post. Headings, bold, links, lists, blockquotes and the photos all come across formatted — Substack pulls each image straight from its archive.org URL, so there's nothing to re-upload. Prefer a file? <strong>Download&nbsp;.html</strong> below — open it and click <em>Copy&nbsp;article</em> for the same perfect paste, offline.
          </p>

          {/* the main action */}
          <button onClick={copyForSubstack} className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, padding: "13px 16px", textTransform: "uppercase", letterSpacing: ".03em" }}>
            <I.copy style={{ fontSize: 17 }} />
            {copied === "rich" ? "Copied — paste into Substack" : copied === "text" ? "Copied as text" : copied === "fail" ? "Couldn't copy — select the preview below" : "Copy article for Substack"}
          </button>

          {/* Substack's own fields */}
          <div>
            <div style={eyebrow}>Substack fills these from its own fields — copy them across the top</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 7 }}>
              <div style={fieldBox}>
                <span style={{ ...eyebrow, flex: "0 0 56px" }}>Title</span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--display)", fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.headline || "—"}</span>
                <button style={chipBtn} onClick={() => copyText(article.headline || "", "title")}>{copied === "title" ? "Copied!" : "Copy"}</button>
              </div>
              {article.dek ? (
                <div style={fieldBox}>
                  <span style={{ ...eyebrow, flex: "0 0 56px" }}>Subtitle</span>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.dek}</span>
                  <button style={chipBtn} onClick={() => copyText(article.dek || "", "subtitle")}>{copied === "subtitle" ? "Copied!" : "Copy"}</button>
                </div>
              ) : null}
            </div>
          </div>

          {/* what rides along */}
          <div>
            <div style={eyebrow}>Sourcing {sourceCount ? "· " + sourceCount + " archived source" + (sourceCount === 1 ? "" : "s") : ""}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
              <ExportToggle on={citations} set={setCitations} label="Footnote markers" hint="A superscript after each sourced claim — it opens the archive.org snapshot on the exact words cited." />
              <ExportToggle on={sourcesList} set={setSourcesList} label="Sources & evidence" hint="Footnotes at the end: every source with the passage it backs, quoted and linked to its snapshot." />
            </div>
            <span className="np-mono" style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
              Every source link opens its archive.org snapshot scrolled to — and highlighting — the precise passage that backs the claim, so a reader sees exactly what the evidence is.
            </span>
          </div>

          {/* save a file */}
          <div>
            <div style={eyebrow}>Save a file</div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginTop: 7 }}>
              <button onClick={downloadHtmlFile} className="btn"
                title="A self-contained web page — open it in any browser and click “Copy article” to paste perfectly into Substack. Works offline; nothing to re-upload."
                style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--yellow)", fontWeight: 700 }}>
                <I.ext style={{ fontSize: 14 }} /> {copied === "html" ? "Downloaded!" : "Download .html"}
              </button>
              <button onClick={downloadMd} className="btn" title="Plain-text markdown — the archival record (title &amp; subtitle included)."
                style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <I.archive style={{ fontSize: 14 }} /> {copied === "file" ? "Downloaded!" : "Download .md"}
              </button>
              <button onClick={() => copyText(preview, "md")} className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <I.copy style={{ fontSize: 14 }} /> {copied === "md" ? "Copied!" : "Copy markdown"}
              </button>
            </div>
            <span className="np-mono" style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>
              <strong>.html</strong> is the file that copies perfectly — open it, hit <em>Copy article</em>, paste into Substack (images, headings &amp; sourcing intact). <strong>.md</strong> is the plain-text record; pasted markdown stays literal in Substack.
            </span>
          </div>

          {/* preview */}
          <div>
            <div style={eyebrow}>Markdown preview</div>
            <textarea readOnly value={preview} spellCheck={false}
              onFocus={(e) => e.target.select()}
              className="np-mono np-scroll"
              style={{ width: "100%", height: 220, marginTop: 7, resize: "vertical", fontSize: 12, lineHeight: 1.5,
                border: "1.5px solid var(--ink)", background: "var(--card)", color: "var(--ink)", padding: "10px 12px", boxSizing: "border-box" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

window.SubstackExport = SubstackExport;
