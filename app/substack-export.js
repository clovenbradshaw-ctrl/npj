/* substack-export.js — turn a folded NPJ article into something you can drop
   straight into Substack.

   One source of truth: the read model app/articles.js folds (headline, dek,
   byline + body blocks). Two outputs:

     • toMarkdown(article, opts) → a clean .md file (download / archive).
     • toHtml(article, opts)     → rich HTML for the clipboard — THIS is the
       copy-paste path. Substack's editor (ProseMirror) ignores pasted markdown
       *syntax* but honors pasted HTML: headings, bold/italic, links, lists,
       blockquotes and <img> all survive, and Substack re-hosts each image from
       its public URL. Raw markdown text pasted in stays literal, so the HTML is
       what makes the paste land formatted.

   NPJ's distinctive payload is the sourcing: every cited claim carries the
   archived snapshot that backs it. We keep that auditable on export — each
   claim gets a superscript number linked to its archive.org snapshot, and a
   "Sources" section lists them all. Both are toggleable for a clean copy.

   Images use the durable archive.org URL (a body img's `src`), never the
   auth-gated Matrix media-store copy (`store`) — Substack fetches the URL
   server-side and can't present a session token, so a store: URL would 404.

   UMD: window.NpjSubstack in the browser, module.exports in node (so the
   markdown/HTML shaping is unit-tested without a DOM — npj's no-build ethos).
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjSubstack = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // ---- environment-soft helpers (work in node tests AND the browser) ----
  function sourcesFor(opts) {
    if (opts && opts.sources) return opts.sources;
    return (typeof window !== "undefined" && window.NPJ && window.NPJ.SOURCES) || {};
  }
  function srcUrl(s) { return (s && (s.archive_url || s.original_url)) || ""; }
  // A URL Substack can fetch on its own: an http(s) link. In the browser we
  // defer to the media layer's own publishable check (drops blob:/mxc:/store
  // URLs); in node any http(s) string passes.
  function publicUrl(u) {
    if (!u) return "";
    if (typeof window !== "undefined" && window.NpjMedia && window.NpjMedia.isPublishable)
      return window.NpjMedia.isPublishable(u) ? u : "";
    return /^https?:\/\//i.test(u) ? u : "";
  }
  function personName(id) {
    if (typeof window !== "undefined" && window.npjPerson) { try { return window.npjPerson(id).name; } catch (e) {} }
    return String(id || "").replace(/^@/, "").split(":")[0];
  }
  function bylineText(A) {
    if (A.byline && A.byline.trim()) return A.byline.trim();
    return (A.authors || []).filter(Boolean).map(personName).join(", ");
  }
  function dateText(A) {
    const d = A.published || A.updated || "";
    if (!d) return "";
    if (typeof window !== "undefined" && window.fmtDate) { try { return window.fmtDate(d); } catch (e) {} }
    return String(d).slice(0, 10);
  }
  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  function cleanCaption(c) { return String(c || "").replace(/[\[\]]/g, " ").replace(/\s+/g, " ").trim(); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---- source numbering: first-appearance order across every claim, exactly
  // like the reader's ledger (useClaimModel) so the numbers match the page. ----
  function indexSources(body, sources) {
    const numByKey = new Map();
    let n = 0;
    const visit = (tok) => {
      if (tok && tok.c != null && Array.isArray(tok.src))
        tok.src.forEach(k => { if (k && !numByKey.has(k)) numByKey.set(k, ++n); });
    };
    (body || []).forEach(b => {
      (b.tokens || []).forEach(visit);
      (b.items || []).forEach(it => (it || []).forEach(visit));
    });
    const ordered = [...numByKey.entries()].map(([key, num]) => ({
      key, num, src: sources[key] || { id: key, title: key }
    }));
    return { numByKey, ordered };
  }

  // the lead photo, lifted above the piece (mirrors ArticleRead's hero rule):
  // an explicit banner on A.image, else the first banner block in the body.
  function heroImage(A) {
    if (A.image && A.image.src && A.image.banner) return A.image;
    return (A.body || []).find(b => b.type === "img" && b.banner) || null;
  }

  // ====================================================================
  //  MARKDOWN
  // ====================================================================
  function citeMarksMd(tok, ctx) {
    if (!ctx.citations || !tok.src || !tok.src.length) return "";
    return tok.src.map(k => {
      const num = ctx.numByKey.get(k); if (!num) return "";
      const url = srcUrl(ctx.sources[k]);
      return url ? "[[" + num + "]](" + url + ")" : "[" + num + "]";
    }).join("");
  }
  function tokensToMd(tokens, ctx) {
    return (tokens || []).map(t => {
      if (typeof t === "string") return t;
      if (t.t === "br") return "  \n";
      if (t.t === "strong") return "**" + t.text + "**";
      if (t.t === "em") return "*" + t.text + "*";
      if (t.t === "s") return "~~" + t.text + "~~";
      if (t.t === "code") return "`" + t.text + "`";
      if (t.t === "a") return "[" + t.text + "](" + (t.href || "") + ")";
      if (t.t === "sup") return "[" + t.text + "]"; // a manual footnote marker — keep as text
      if (t.c != null) {                            // a source-bound claim
        const marks = citeMarksMd(t, ctx);
        if (!marks) return t.c;
        const tail = (t.c.match(/\s*$/) || [""])[0];           // keep trailing space
        return t.c.slice(0, t.c.length - tail.length) + marks + tail;
      }
      return t.text || "";
    }).join("");
  }
  function pushImageMd(out, img) {
    const url = publicUrl(img.src); if (!url) return;
    const cap = cleanCaption(img.caption);
    out.push("![" + cap + "](" + url + ")", "");
    if (cap) out.push("*" + cap + "*", "");
  }
  function blockToMd(out, b, ctx) {
    switch (b.type) {
      case "h2": if ((b.text || "").trim()) out.push("## " + b.text.trim(), ""); break;
      case "h3": if ((b.text || "").trim()) out.push("### " + b.text.trim(), ""); break;
      case "pull": {
        out.push("> " + String(b.text || "").trim().replace(/\n/g, "\n> "));
        if (b.attribution) out.push(">", "> — " + b.attribution);
        out.push("");
        break;
      }
      case "ul": (b.items || []).forEach(it => out.push("- " + tokensToMd(it, ctx).trim())); out.push(""); break;
      case "ol": (b.items || []).forEach((it, i) => out.push((i + 1) + ". " + tokensToMd(it, ctx).trim())); out.push(""); break;
      case "hr": out.push("---", ""); break;
      case "code": out.push("```", String(b.text || "").replace(/\n+$/, ""), "```", ""); break;
      case "verse":
        String(b.text || "").replace(/\n+$/, "").split("\n").forEach(l => out.push(l.replace(/\s+$/, "") + "  "));
        out.push("");
        break;
      case "img": if (!b.banner) pushImageMd(out, b); break;       // banner is lifted to the hero
      case "embed":
        if (b.url) { out.push(b.url, ""); if (b.caption) out.push("*" + cleanCaption(b.caption) + "*", ""); }
        break;                                                     // a bare URL on its own line → Substack auto-embeds
      default: { // "p" and anything unknown that carries tokens
        const t = tokensToMd(b.tokens, ctx).trim();
        if (t) out.push(t, "");
      }
    }
  }

  function toMarkdown(article, opts) {
    opts = opts || {};
    const A = article || {};
    const sources = sourcesFor(opts);
    const { numByKey, ordered } = indexSources(A.body, sources);
    const ctx = { citations: opts.citations !== false, numByKey, sources };
    const out = [];

    if (!opts.omitTitle) {
      if (A.kicker) out.push("**" + String(A.kicker).toUpperCase() + "**", "");
      if (A.headline) out.push("# " + A.headline, "");
      if (A.dek) out.push("*" + A.dek + "*", "");
      const by = bylineText(A), date = dateText(A);
      const meta = [by ? "By " + by : "", date].filter(Boolean).join(" · ");
      if (meta) out.push(meta, "");
    }

    const hero = heroImage(A);
    if (hero) pushImageMd(out, hero);

    (A.body || []).forEach(b => blockToMd(out, b, ctx));

    if (opts.sourcesList !== false && ordered.length) {
      out.push("---", "", "## Sources", "");
      ordered.forEach(({ num, src }) => {
        const url = srcUrl(src);
        const label = [src.outlet, src.title].filter(Boolean).join(" — ") || src.id || ("Source " + num);
        let line = num + ". " + (url ? "[" + label + "](" + url + ")" : label);
        if (src.retrieved) line += "  \n   _archived " + src.retrieved + "_";
        out.push(line);
      });
      out.push("");
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ====================================================================
  //  HTML  (the clipboard / paste-into-Substack path)
  // ====================================================================
  function citeMarksHtml(tok, ctx) {
    if (!ctx.citations || !tok.src || !tok.src.length) return "";
    const inner = tok.src.map(k => {
      const num = ctx.numByKey.get(k); if (!num) return "";
      const url = srcUrl(ctx.sources[k]);
      return url ? '<a href="' + esc(url) + '">' + num + "</a>" : String(num);
    }).filter(Boolean).join(",");
    return inner ? "<sup>" + inner + "</sup>" : "";
  }
  function tokensToHtml(tokens, ctx) {
    return (tokens || []).map(t => {
      if (typeof t === "string") return esc(t);
      if (t.t === "br") return "<br>";
      if (t.t === "strong") return "<strong>" + esc(t.text) + "</strong>";
      if (t.t === "em") return "<em>" + esc(t.text) + "</em>";
      if (t.t === "s") return "<s>" + esc(t.text) + "</s>";
      if (t.t === "code") return "<code>" + esc(t.text) + "</code>";
      if (t.t === "a") return '<a href="' + esc(t.href) + '">' + esc(t.text) + "</a>";
      if (t.t === "sup") return "<sup>" + esc(t.text) + "</sup>";
      if (t.c != null) return esc(t.c) + citeMarksHtml(t, ctx);
      return esc(t.text || "");
    }).join("");
  }
  function imgHtml(img) {
    const url = publicUrl(img.src); if (!url) return "";
    const cap = cleanCaption(img.caption);
    return "<figure><img src=\"" + esc(url) + "\" alt=\"" + esc(cap) + "\">" +
      (cap ? "<figcaption>" + esc(cap) + "</figcaption>" : "") + "</figure>";
  }
  function blockToHtml(b, ctx) {
    switch (b.type) {
      case "h2": return (b.text || "").trim() ? "<h2>" + esc(b.text.trim()) + "</h2>" : "";
      case "h3": return (b.text || "").trim() ? "<h3>" + esc(b.text.trim()) + "</h3>" : "";
      case "pull": {
        let q = "<blockquote><p>" + esc(String(b.text || "").trim()) + "</p>";
        if (b.attribution) q += "<p>— " + esc(b.attribution) + "</p>";
        return q + "</blockquote>";
      }
      case "ul": return "<ul>" + (b.items || []).map(it => "<li>" + tokensToHtml(it, ctx) + "</li>").join("") + "</ul>";
      case "ol": return "<ol>" + (b.items || []).map(it => "<li>" + tokensToHtml(it, ctx) + "</li>").join("") + "</ol>";
      case "hr": return "<hr>";
      case "code": return "<pre><code>" + esc(String(b.text || "").replace(/\n+$/, "")) + "</code></pre>";
      case "verse": return "<p><em>" + esc(String(b.text || "").replace(/\n+$/, "")).replace(/\n/g, "<br>") + "</em></p>";
      case "img": return b.banner ? "" : imgHtml(b);
      case "embed": return b.url ? '<p><a href="' + esc(b.url) + '">' + esc(b.url) + "</a></p>" : "";
      default: {
        const inner = tokensToHtml(b.tokens, ctx);
        return inner.trim() ? "<p>" + inner + "</p>" : "";
      }
    }
  }

  function toHtml(article, opts) {
    opts = opts || {};
    const A = article || {};
    const sources = sourcesFor(opts);
    const { numByKey, ordered } = indexSources(A.body, sources);
    const ctx = { citations: opts.citations !== false, numByKey, sources };
    const parts = [];

    if (!opts.omitTitle) {
      if (A.kicker) parts.push("<p><strong>" + esc(String(A.kicker).toUpperCase()) + "</strong></p>");
      if (A.headline) parts.push("<h1>" + esc(A.headline) + "</h1>");
      if (A.dek) parts.push("<p><em>" + esc(A.dek) + "</em></p>");
      const by = bylineText(A), date = dateText(A);
      const meta = [by ? "By " + by : "", date].filter(Boolean).join(" · ");
      if (meta) parts.push("<p>" + esc(meta) + "</p>");
    }

    const hero = heroImage(A);
    if (hero) { const h = imgHtml(hero); if (h) parts.push(h); }

    (A.body || []).forEach(b => { const h = blockToHtml(b, ctx); if (h) parts.push(h); });

    if (opts.sourcesList !== false && ordered.length) {
      parts.push("<hr>", "<h2>Sources</h2>");
      parts.push("<ol>" + ordered.map(({ src }) => {
        const url = srcUrl(src);
        const label = [src.outlet, src.title].filter(Boolean).join(" — ") || src.id;
        const body = url ? '<a href="' + esc(url) + '">' + esc(label) + "</a>" : esc(label);
        return "<li>" + body + (src.retrieved ? ' <em>(archived ' + esc(src.retrieved) + ")</em>" : "") + "</li>";
      }).join("") + "</ol>");
    }

    return parts.join("\n");
  }

  function filename(article) {
    const A = article || {};
    return (A.slug || slugify(A.headline) || "article") + ".md";
  }

  // ---- browser-only: clipboard + download ----
  // Copy rich HTML + a markdown fallback in one clipboard write, so a paste into
  // Substack lands formatted while a paste into a plain editor still reads well.
  async function copyForSubstack(article, opts) {
    const o = Object.assign({ omitTitle: true }, opts); // title/subtitle go in Substack's own fields
    const html = toHtml(article, o);
    const md = toMarkdown(article, o);
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([md], { type: "text/plain" })
        })]);
        return "rich";
      } catch (e) { /* fall through to plain text */ }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try { await navigator.clipboard.writeText(md); return "text"; } catch (e) {}
    }
    return "";
  }

  function download(article, opts) {
    const md = toMarkdown(article, opts);
    const name = filename(article);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    return name;
  }

  return { toMarkdown, toHtml, filename, indexSources, heroImage, copyForSubstack, download };
});
