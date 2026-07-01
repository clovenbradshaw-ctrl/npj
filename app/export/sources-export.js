/* sources-export.js — the draft's bound sources as a portable SOURCE PACKET.

   The inverse of substack-export: not the finished article, but the raw
   material it stands on. From the editor's sources rail this packs every bound
   source — its links, its archive.org snapshot, the exact pinned passages
   (the evidence) with the claim in the draft each one backs, and the source's
   extracted text — into files you can hand to a co-writer, an editor, or an
   AI, so an article can be generated (as HTML or anything else) from sources
   that stay auditable.

   Three outputs off one normalized payload:

     • toMarkdown(payload)     → the packet as clean markdown — reads well
                                 anywhere and pastes straight into an LLM prompt.
     • toJson(payload)         → the machine path: a versioned JSON document
                                 (npj/source-packet/1) for generation pipelines.
     • toHtmlDocument(payload) → a self-contained .html page: open it in any
                                 browser and the whole packet renders, with a
                                 one-click "Copy as Markdown" for the prompt path.

   Every evidence link deep-links the archive.org snapshot to the cited words
   (a Text Fragment, #:~:text=…) — same scheme as substack-export — so a reader
   of the packet lands on precisely the passage, not the top of a long page.

   UMD: window.NpjSourcesExport in the browser, module.exports in node (the
   shaping is unit-tested without a DOM — npj's no-build ethos).
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjSourcesExport = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function slugify(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  // ---- evidence deep-links (same scheme as substack-export.js) ----
  function encFrag(s) {
    return encodeURIComponent(String(s == null ? "" : s)).replace(/-/g, "%2D");
  }
  function textFragment(quote) {
    const q = clean(quote);
    if (!q) return "";
    const w = q.split(" ");
    if (w.length >= 11) return ":~:text=" + encFrag(w.slice(0, 6).join(" ")) + "," + encFrag(w.slice(-4).join(" "));
    return ":~:text=" + encFrag(q.length > 300 ? w.slice(0, 12).join(" ") : q);
  }
  function evidenceUrl(rec, quote) {
    const base = (rec && (rec.archive_url || rec.original_url)) || "";
    if (!base) return "";
    const frag = quote ? textFragment(quote) : "";
    return frag ? base.replace(/#.*$/, "") + "#" + frag : base;
  }

  // A coarse kind label for the packet (mirrors NpjSources.srcKind).
  function kindLabel(rec) {
    rec = rec || {};
    if (rec.type === "interview") return "conversation";
    if (/archive\.org\/(details|download)/i.test(rec.archive_url || rec.original_url || "")) return "archive.org item";
    if (/^https?:/i.test(rec.original_url || "")) return "web source";
    if (/^doc-/.test(rec.id || "") || rec.filename) return "uploaded document";
    return rec.outlet ? clean(rec.outlet) : "source";
  }

  /* ---- normalize: the one shaping pass every output shares ----
     payload = { title, byline, exported?, items: [{ key, rec, quotes:[{quote, claim}], spans }] }
     → { title, byline, exported, items: [{ num, key, title, outlet, kind,
         originalUrl, archiveUrl, retrieved, text, spans,
         quotes: [{ quote, claims: [..] }] }] }
     Quotes dedupe on whitespace/case-insensitive text; the claims each copy
     backs merge onto the one surviving entry, in order. */
  function normalize(payload) {
    payload = payload || {};
    const items = (payload.items || []).map(function (it, i) {
      const rec = (it && it.rec) || {};
      const seen = {}, quotes = [];
      ((it && it.quotes) || []).forEach(function (q) {
        const text = String((q && q.quote) || "").trim();
        const norm = clean(text).toLowerCase();
        if (!norm) return;
        const claim = clean(q && q.claim);
        let e = seen[norm];
        if (!e) { e = seen[norm] = { quote: text, claims: [] }; quotes.push(e); }
        if (claim && e.claims.indexOf(claim) < 0) e.claims.push(claim);
      });
      return {
        num: i + 1,
        key: (it && it.key) || rec.id || "",
        title: clean(rec.title) || (it && it.key) || "Untitled source",
        outlet: clean(rec.outlet),
        kind: kindLabel(rec),
        originalUrl: String(rec.original_url || "").trim(),
        archiveUrl: String(rec.archive_url || "").trim(),
        retrieved: clean(rec.retrieved),
        text: String(rec.text || "").trim(),
        spans: (it && it.spans) || 0,
        quotes: quotes,
        rec: rec
      };
    });
    return {
      title: clean(payload.title),
      byline: clean(payload.byline),
      exported: clean(payload.exported) || new Date().toISOString().slice(0, 10),
      items: items
    };
  }

  function summary(payload) {
    const P = normalize(payload);
    return {
      sources: P.items.length,
      quotes: P.items.reduce(function (a, it) { return a + it.quotes.length; }, 0),
      archived: P.items.filter(function (it) { return !!it.archiveUrl; }).length
    };
  }

  // ====================================================================
  //  MARKDOWN  (reads anywhere; pastes straight into an LLM prompt)
  // ====================================================================
  function toMarkdown(payload) {
    const P = normalize(payload);
    const out = [];
    out.push("# Source packet" + (P.title ? " — " + P.title : ""), "");
    const meta = [P.byline ? "By " + P.byline : "", "exported " + P.exported,
      P.items.length + " source" + (P.items.length === 1 ? "" : "s")].filter(Boolean).join(" · ");
    if (meta) out.push("*" + meta + "*", "");
    out.push("Everything the article stands on: each source with its links, its archived snapshot, the exact passages pinned as evidence (and the claim in the draft each passage backs), plus the source's extracted text. Evidence links open the snapshot scrolled to the cited words.", "");
    P.items.forEach(function (it) {
      out.push("## " + it.num + ". " + it.title + (it.outlet ? " — " + it.outlet : ""), "");
      const facts = [it.kind, it.retrieved ? "retrieved " + it.retrieved : "",
        it.spans ? it.spans + " cited span" + (it.spans === 1 ? "" : "s") : ""].filter(Boolean).join(" · ");
      if (facts) out.push("*" + facts + "*", "");
      if (it.originalUrl) out.push("- Original: <" + it.originalUrl + ">");
      if (it.archiveUrl) out.push("- Archived: <" + it.archiveUrl + ">");
      if (it.originalUrl || it.archiveUrl) out.push("");
      if (it.quotes.length) {
        out.push("**Evidence** (the pinned passages and the claims they back):", "");
        it.quotes.forEach(function (q) {
          const url = evidenceUrl(it.rec, q.quote);
          out.push("- " + (url ? "[“" + clean(q.quote) + "”](" + url + ")" : "“" + clean(q.quote) + "”"));
          q.claims.forEach(function (c) { out.push("  - backs: " + c); });
        });
        out.push("");
      }
      if (it.text) {
        out.push("<details><summary>Extracted text</summary>", "", "```", it.text, "```", "", "</details>", "");
      }
    });
    if (!P.items.length) out.push("_No sources bound to this draft yet._", "");
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ====================================================================
  //  JSON  (the machine path for a generation pipeline)
  // ====================================================================
  function toJson(payload) {
    const P = normalize(payload);
    return JSON.stringify({
      format: "npj/source-packet/1",
      title: P.title,
      byline: P.byline,
      exported: P.exported,
      sources: P.items.map(function (it) {
        return {
          num: it.num, key: it.key, title: it.title, outlet: it.outlet, kind: it.kind,
          original_url: it.originalUrl, archive_url: it.archiveUrl, retrieved: it.retrieved,
          spans: it.spans,
          evidence: it.quotes.map(function (q) {
            return { quote: q.quote, backs: q.claims, url: evidenceUrl(it.rec, q.quote) };
          }),
          text: it.text
        };
      })
    }, null, 2) + "\n";
  }

  // ====================================================================
  //  STANDALONE HTML DOCUMENT  (open anywhere; Copy as Markdown built in)
  // ====================================================================
  const DOC_CSS = [
    "*{box-sizing:border-box}",
    "html{-webkit-text-size-adjust:100%}",
    "body{margin:0;background:#f6f5f1;color:#1a1a1a;font:16px/1.6 Georgia,'Times New Roman',serif}",
    ".npj-bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:10px;align-items:center;",
      "user-select:none;-webkit-user-select:none;",
      "background:#16140d;color:#fff;padding:12px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}",
    ".npj-bar strong{color:#ffd400;font-size:14px;letter-spacing:.02em}",
    ".npj-bar .hint{flex:1 1 240px;min-width:200px;font-size:12px;line-height:1.4;color:#cfcdc4}",
    ".npj-bar button{font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;",
      "border:0;border-radius:2px;padding:9px 13px;cursor:pointer;background:#ffd400;color:#16140d}",
    "main{max-width:760px;margin:0 auto;padding:30px 22px 96px}",
    "h1{font-size:1.8rem;line-height:1.15;margin:.1em 0 .3em}",
    "h2{font-size:1.25rem;margin:1.9em 0 .3em}",
    "p{margin:0 0 1em}a{color:#0a58ca}",
    ".meta{font:12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#666;",
      "text-transform:uppercase;letter-spacing:.05em}",
    "section{border-top:2px solid #16140d;margin-top:1.6em}",
    "ul.links{list-style:none;margin:.6em 0;padding:0;font-size:14px}",
    "ul.links li{margin:2px 0;overflow-wrap:anywhere}",
    "blockquote{margin:1em 0;padding:.2em 0 .2em 1em;border-left:3px solid #ffd400;font-style:italic}",
    "blockquote .backs{display:block;margin-top:.35em;font-style:normal;font-size:13px;color:#555}",
    "details{margin:1em 0}summary{cursor:pointer;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}",
    "pre{overflow:auto;white-space:pre-wrap;background:#f0eee7;padding:14px 16px;border-radius:3px;",
      "font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:60vh}",
    "hr{border:0;border-top:1px solid #ccc;margin:2.2em 0}"
  ].join("");

  // The markdown twin rides inside the page (a text/plain script tag) so the
  // "Copy as Markdown" button can put the prompt-ready packet on the clipboard.
  const DOC_SCRIPT =
    "(function(){" +
    "function flash(b,m){var t=b.getAttribute('data-label')||b.textContent;b.textContent=m;" +
      "setTimeout(function(){b.textContent=t;},1800);}" +
    "var md=document.getElementById('npj-md');" +
    "var b=document.getElementById('npj-copy-md');" +
    "if(b)b.addEventListener('click',function(){var txt=md?md.textContent:'';" +
      "if(navigator.clipboard&&navigator.clipboard.writeText){" +
      "navigator.clipboard.writeText(txt).then(function(){flash(b,'Copied \\u2014 paste it anywhere');})" +
      ".catch(function(){flash(b,'Copy failed \\u2014 select the page instead');});}" +
      "else{flash(b,'Copy failed \\u2014 select the page instead');}});" +
    "})();";

  function toHtmlDocument(payload) {
    const P = normalize(payload);
    const md = toMarkdown(payload);
    const title = esc(P.title || "Source packet");
    const meta = [P.byline ? "By " + P.byline : "", "exported " + P.exported,
      P.items.length + " source" + (P.items.length === 1 ? "" : "s")].filter(Boolean).join(" · ");

    const sections = P.items.map(function (it) {
      const facts = [it.kind, it.retrieved ? "retrieved " + it.retrieved : "",
        it.spans ? it.spans + " cited span" + (it.spans === 1 ? "" : "s") : ""].filter(Boolean).join(" · ");
      const links = [];
      if (it.originalUrl) links.push('<li>Original: <a href="' + esc(it.originalUrl) + '">' + esc(it.originalUrl) + "</a></li>");
      if (it.archiveUrl) links.push('<li>Archived: <a href="' + esc(it.archiveUrl) + '">' + esc(it.archiveUrl) + "</a></li>");
      const evidence = it.quotes.map(function (q) {
        const url = evidenceUrl(it.rec, q.quote);
        const quote = url ? '“<a href="' + esc(url) + '">' + esc(clean(q.quote)) + "</a>”" : "“" + esc(clean(q.quote)) + "”";
        const backs = q.claims.length
          ? '<span class="backs">backs: ' + q.claims.map(esc).join(" · ") + "</span>" : "";
        return "<blockquote>" + quote + backs + "</blockquote>";
      }).join("\n");
      const words = it.text ? clean(it.text).split(" ").length : 0;
      return [
        "<section>",
        "<h2>" + it.num + ". " + esc(it.title) + (it.outlet ? " — " + esc(it.outlet) : "") + "</h2>",
        facts ? '<p class="meta">' + esc(facts) + "</p>" : "",
        links.length ? '<ul class="links">' + links.join("") + "</ul>" : "",
        evidence,
        it.text ? "<details><summary>Extracted text (" + words + " word" + (words === 1 ? "" : "s") + ")</summary><pre>" + esc(it.text) + "</pre></details>" : "",
        "</section>"
      ].filter(Boolean).join("\n");
    }).join("\n");

    return [
      "<!doctype html>",
      '<html lang="en"><head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>" + title + " — source packet</title>",
      "<style>" + DOC_CSS + "</style>",
      "</head><body>",
      '<div class="npj-bar">',
      "<strong>Source packet</strong>",
      '<button id="npj-copy-md" data-label="Copy as Markdown">Copy as Markdown</button>',
      '<span class="hint">Every source this draft stands on — links, snapshots, the pinned evidence and the extracted text. Hand this file (or the Markdown copy) to whoever — or whatever — writes the article.</span>',
      "</div>",
      "<main>",
      "<h1>" + (P.title ? esc(P.title) : "Source packet") + "</h1>",
      meta ? '<p class="meta">' + esc(meta) + "</p>" : "",
      P.items.length
        ? "<p>Evidence links open the archive.org snapshot scrolled to — and highlighting — the cited words.</p>"
        : "<p><em>No sources bound to this draft yet.</em></p>",
      sections,
      "</main>",
      '<script type="text/plain" id="npj-md">' + md.replace(/<\/(script)/gi, "<\\/$1") + "</script>",
      "<script>" + DOC_SCRIPT + "<\/script>",
      "</body></html>"
    ].filter(Boolean).join("\n");
  }

  function filename(payload, ext) {
    const t = clean(payload && payload.title);
    return (slugify(t) || "draft") + "-sources." + (ext || "html");
  }

  // ---- browser-only: downloads ----
  function saveBlob(text, name, mime) {
    if (typeof document === "undefined") return name;
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
    return name;
  }
  function downloadHtml(payload) { return saveBlob(toHtmlDocument(payload), filename(payload, "html"), "text/html;charset=utf-8"); }
  function downloadMarkdown(payload) { return saveBlob(toMarkdown(payload), filename(payload, "md"), "text/markdown;charset=utf-8"); }
  function downloadJson(payload) { return saveBlob(toJson(payload), filename(payload, "json"), "application/json;charset=utf-8"); }

  return { normalize, summary, toMarkdown, toJson, toHtmlDocument, filename,
    evidenceUrl, textFragment, kindLabel,
    downloadHtml, downloadMarkdown, downloadJson };
});
