/* SourcesExport.jsx — the "Export sources" panel.

   Opened from the editor's sources rail. The packet is the raw material an
   article stands on: every bound source with its links, its archive.org
   snapshot, the exact pinned passages (with the claim each backs) and the
   extracted text. Shaping is app/export/sources-export.js (NpjSourcesExport);
   this is the surface: a one-click .html packet (self-contained page with its
   own "Copy as Markdown" button — hand the file to a co-writer or an AI and an
   article can be generated from it), plus .md / .json downloads, a clipboard
   copy of the markdown, and a live preview.

   Props: { payload, onClose }.
   payload = { title, byline, items:[{ key, rec, quotes:[{quote, claim}], spans }] } */
function SourcesExport({ payload, onClose }) {
  const SE = window.NpjSourcesExport;
  const [snap] = useState(() => payload || { title: "", items: [] });   // freeze the packet at open
  const [copied, setCopied] = useState(null); // "md" | "html" | "mdfile" | "json"
  const flash = (key) => { setCopied(key); setTimeout(() => setCopied(c => (c === key ? null : c)), 1600); };

  const md = React.useMemo(() => (SE ? SE.toMarkdown(snap) : ""), [SE, snap]);
  const sum = React.useMemo(() => (SE ? SE.summary(snap) : { sources: 0, quotes: 0, archived: 0 }), [SE, snap]);

  if (!SE) return null;

  const copyMd = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(md).then(() => flash("md")).catch(() => {});
    else flash("md");
  };
  const dl = (fn, key) => { try { fn(snap); flash(key); } catch (e) {} };

  const eyebrow = { fontFamily: "var(--mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)" };

  return (
    <div onClick={onClose} className="fade-in" role="dialog" aria-modal="true" aria-label="Export sources"
      style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,.72)", zIndex: 6100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 22px" }}>
      <div onClick={(e) => e.stopPropagation()} className="np-scroll"
        style={{ width: "min(680px,97vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--paper)", color: "var(--ink)", border: "2px solid var(--ink)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>

        {/* header */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--ink)", color: "var(--paper)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <I.source style={{ fontSize: 17, color: "var(--yellow)" }} />
          <span style={{ fontFamily: "var(--display)", fontSize: 21, color: "var(--yellow)" }}>EXPORT SOURCES</span>
          <span style={{ flex: 1 }} />
          <span className="np-mono" style={{ fontSize: 11, color: "var(--paper)", opacity: .8 }}>
            {sum.sources + (sum.sources === 1 ? " source" : " sources")}{sum.quotes ? " · " + sum.quotes + " pinned passage" + (sum.quotes === 1 ? "" : "s") : ""}
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--paper)", fontSize: 18, cursor: "pointer" }}><I.x /></button>
        </div>

        {sum.sources === 0 ? (
          <div style={{ padding: "22px 18px 26px" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.55, margin: 0 }}>
              <strong>No sources yet.</strong> Ingest a URL, upload a document or cite a conversation in the rail — then export the packet from here.
            </p>
          </div>
        ) : (
          <div style={{ padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: 14, lineHeight: 1.5, margin: 0, color: "var(--ink-soft)" }}>
              The raw material this draft stands on: every bound source with its links, its archived snapshot, the exact passages pinned as evidence (and the claim each backs), plus the extracted text. Hand the packet to a co-writer, an editor or an AI — an article can be written from it with the sourcing intact.
            </p>

            {/* the main action: the self-contained .html packet */}
            <button onClick={() => dl(SE.downloadHtml, "html")} className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, padding: "12px 16px", textTransform: "uppercase", letterSpacing: ".03em" }}>
              <I.ext style={{ fontSize: 17 }} /> {copied === "html" ? "Downloaded!" : "Download source packet (.html)"}
            </button>
            <span className="np-mono" style={{ fontSize: 10.5, color: "var(--ink-soft)", lineHeight: 1.4, marginTop: -6 }}>
              A self-contained page — it opens in any browser and carries its own <strong>Copy as Markdown</strong> button. Evidence links open each archive.org snapshot scrolled to the cited words.
            </span>

            {/* other shapes */}
            <div>
              <div style={eyebrow}>Other shapes</div>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginTop: 7 }}>
                <button onClick={copyMd} className="btn" title="Copy the packet as Markdown — pastes clean into a document or an AI prompt"
                  style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <I.copy style={{ fontSize: 14 }} /> {copied === "md" ? "Copied!" : "Copy markdown"}
                </button>
                <button onClick={() => dl(SE.downloadMarkdown, "mdfile")} className="btn" title="The packet as a .md file"
                  style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <I.archive style={{ fontSize: 14 }} /> {copied === "mdfile" ? "Downloaded!" : "Download .md"}
                </button>
                <button onClick={() => dl(SE.downloadJson, "json")} className="btn" title="The packet as structured JSON (npj/source-packet/1) — for a generation pipeline or any tool"
                  style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <I.archive style={{ fontSize: 14 }} /> {copied === "json" ? "Downloaded!" : "Download .json"}
                </button>
              </div>
            </div>

            {/* preview */}
            <div>
              <div style={eyebrow}>Preview (markdown)</div>
              <textarea readOnly value={md} spellCheck={false}
                onFocus={(e) => e.target.select()}
                className="np-mono np-scroll"
                style={{ width: "100%", height: 240, marginTop: 7, resize: "vertical", fontSize: 12, lineHeight: 1.5,
                  border: "1.5px solid var(--ink)", background: "var(--card)", color: "var(--ink)", padding: "10px 12px", boxSizing: "border-box" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.SourcesExport = SourcesExport;
