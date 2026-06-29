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
   archived snapshot that backs it AND the exact pinned passage (token.q) — the
   evidence. We keep that auditable on export as footnotes: each claim gets a
   superscript number, and a "Sources" section lists every source with the
   passage(s) it backs quoted in full. Every one of those links points at the
   archive.org snapshot deep-linked to the cited words (a Text Fragment,
   #:~:text=…), so the link opens the archived page showing precisely the
   evidence — not the top of a long article. Both are toggleable for a clean copy.

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

  // ---- evidence deep-links (the "minisite, showing precisely the evidence") ----
  // A source's snapshot is its archive.org page. To open it *on the cited words*
  // rather than at the top, we append a Text Fragment (#:~:text=…): a browser
  // scrolls to and highlights that passage in the archived page. Best-effort —
  // an unmatched fragment is a harmless no-op (the snapshot just opens normally),
  // so a single altered character in the archive never breaks the link.
  function encFrag(s) {
    // encodeURIComponent handles ',' and '&' (the directive separators); '-' is
    // left untouched but marks a prefix/suffix in the grammar, so escape it too.
    return encodeURIComponent(String(s == null ? "" : s)).replace(/-/g, "%2D");
  }
  function textFragment(quote) {
    const q = String(quote || "").replace(/\s+/g, " ").trim();
    if (!q) return "";
    const w = q.split(" ");
    // Long passages are anchored by their first/last words (textStart,textEnd) so
    // the highlight survives small drifts in the middle; the slices never overlap.
    if (w.length >= 11) return ":~:text=" + encFrag(w.slice(0, 6).join(" ")) + "," + encFrag(w.slice(-4).join(" "));
    return ":~:text=" + encFrag(q.length > 300 ? w.slice(0, 12).join(" ") : q);
  }
  // The snapshot URL deep-linked to the cited passage. No quote (or no snapshot)
  // → the bare snapshot URL, unchanged.
  function evidenceUrl(src, quote) {
    const base = srcUrl(src); if (!base) return "";
    const frag = quote ? textFragment(quote) : "";
    return frag ? base.replace(/#.*$/, "") + "#" + frag : base;
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

  // ---- footnote hygiene: a marker references a WORD, so a paragraph holding
  // nothing but markers (and whitespace) is a stranded marker that prints as a
  // lone "1" on its own line. Fold those onto the end of the previous paragraph
  // (or the start of the next, if there's none above). Idempotent — the read
  // model normalizes too (articles.js mergeStrandedFootnotes); this keeps the
  // export right when a body is handed in directly. ----
  function isFnMarker(t) { return !!t && typeof t === "object" && t.t === "sup"; }
  function onlyFnMarkers(tokens) {
    const ts = tokens || [];
    return ts.length > 0 && ts.some(isFnMarker) &&
      ts.every(t => isFnMarker(t) || (typeof t === "string" && !t.trim()));
  }
  // Non-mutating: blocks are cloned (Object.assign) when markers attach, so the
  // caller's article body is never corrupted by a repeat call (e.g. toHtml then
  // toMarkdown on the same article).
  function mergeStrandedFootnotes(blocks) {
    const src = Array.isArray(blocks) ? blocks : [];
    // Keys already carried by a marker that sits AGAINST TEXT — a real reference.
    // A manual footnote key is unique per insertion (Newsroom insertFootnote), so a
    // stranded marker repeating one is an editing artifact (an Enter/paste/drag
    // cloned a trailing marker), not a second reference: DROP it rather than fold it
    // onto the text above, which would footnote that sentence with someone else's note.
    const attached = new Set();
    src.forEach(b => {
      if (b && b.type === "p" && !onlyFnMarkers(b.tokens)) (b.tokens || []).forEach(t => { if (isFnMarker(t) && t.key) attached.add(t.key); });
      // a quote's footnote rides on `marks` (a plain quote) or inline in `tokens` (a
      // grounded quote) — either is a real reference, so its key blocks a later
      // stranded duplicate.
      if (b && b.type === "pull") {
        (b.marks || []).forEach(t => { if (isFnMarker(t) && t.key) attached.add(t.key); });
        (b.tokens || []).forEach(t => { if (isFnMarker(t) && t.key) attached.add(t.key); });
      }
    });
    // keep a stranded marker only while its key is still fresh; claiming the key as
    // we go means two strays of one key fold just once, never twice.
    const fresh = (t) => { if (!isFnMarker(t)) return false; if (t.key && attached.has(t.key)) return false; if (t.key) attached.add(t.key); return true; };
    const out = [];
    let carry = [];   // markers with no paragraph above them yet — attach to the next one
    src.forEach(b => {
      if (b && b.type === "p" && onlyFnMarkers(b.tokens)) {
        const markers = b.tokens.filter(fresh);
        if (!markers.length) return;   // every marker here duplicates a real reference → drop the stranded paragraph
        const prev = out[out.length - 1];
        if (prev && prev.type === "p") out[out.length - 1] = Object.assign({}, prev, { tokens: (prev.tokens || []).concat(markers) });
        // a marker stranded under a blockquote belongs to the QUOTE — fold it onto the
        // pull's `marks` (rendered as a trailing superscript), never onto the next ¶.
        else if (prev && prev.type === "pull") out[out.length - 1] = Object.assign({}, prev, { marks: (prev.marks || []).concat(markers) });
        else carry = carry.concat(markers);
        return;   // drop the stranded paragraph
      }
      if (carry.length && b && b.type === "p") { out.push(Object.assign({}, b, { tokens: carry.concat(b.tokens || []) })); carry = []; return; }
      out.push(b);
    });
    if (carry.length) out.push({ type: "p", tokens: carry });   // nowhere to attach — keep the marker rather than lose it
    return out;
  }

  // ---- source numbering: first-appearance order across every claim, exactly
  // like the reader's ledger (useClaimModel) so the numbers match the page. ----
  function indexSources(body, sources) {
    const numByKey = new Map();
    const quotesByKey = new Map();   // key → [{text, norm}] distinct pinned passages, in order
    let n = 0;
    const visit = (tok) => {
      if (!tok || tok.c == null || !Array.isArray(tok.src)) return;
      tok.src.forEach(k => {
        if (!k) return;
        if (!numByKey.has(k)) numByKey.set(k, ++n);
        const q = tok.q && tok.q[k];
        const norm = String(q || "").replace(/\s+/g, " ").trim();
        if (!norm) return;
        const list = quotesByKey.get(k) || [];
        if (!list.some(x => x.norm === norm)) list.push({ text: String(q).trim(), norm });
        quotesByKey.set(k, list);
      });
    };
    (body || []).forEach(b => {
      (b.tokens || []).forEach(visit);
      (b.items || []).forEach(it => (it || []).forEach(visit));
    });
    const ordered = [...numByKey.entries()].map(([key, num]) => ({
      key, num, src: sources[key] || { id: key, title: key },
      quotes: (quotesByKey.get(key) || []).map(x => x.text)   // the evidence this source backs
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
      const url = evidenceUrl(ctx.sources[k], tok.q && tok.q[k]); // snapshot, on the cited words
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
      if (t.t === "sup") return "[^" + (t.key || t.text) + "]"; // a footnote marker → a real markdown footnote reference
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
    // alt text = the photo's description (screen readers + search), caption as
    // the fallback; the visible italic line below stays the caption.
    const alt = cleanCaption(img.description) || cap;
    out.push("![" + alt + "](" + url + ")", "");
    if (cap) out.push("*" + cap + "*", "");
  }
  function blockToMd(out, b, ctx) {
    switch (b.type) {
      case "h2": if ((b.text || "").trim()) out.push("## " + b.text.trim(), ""); break;
      case "h3": if ((b.text || "").trim()) out.push("### " + b.text.trim(), ""); break;
      case "pull": {
        // a grounded quote renders its tokens so the cited passage keeps its
        // numbered source reference; a plain quote renders its text. A footnote on
        // the quote rides as a trailing reference on the last line.
        const inner = (b.tokens && b.tokens.length)
          ? tokensToMd(b.tokens, ctx).trim() + tokensToMd(b.marks || [], ctx)
          : String(b.text || "").trim().replace(/\n/g, "\n> ") + tokensToMd(b.marks || [], ctx);
        out.push("> " + inner.replace(/\n/g, "\n> "));
        if (b.attribution) out.push(">", "> — " + b.attribution);
        out.push("");
        break;
      }
      case "ul": (b.items || []).forEach(it => out.push("- " + tokensToMd(it, ctx).trim())); out.push(""); break;
      case "ol": (b.items || []).forEach((it, i) => out.push((i + 1) + ". " + tokensToMd(it, ctx).trim())); out.push(""); break;
      case "hr": out.push("---", ""); break;
      case "footnotes": (b.notes || []).forEach(n => out.push("[^" + n.key + "]: " + String(n.text || "").trim())); out.push(""); break;
      case "code": out.push("```", String(b.text || "").replace(/\n+$/, ""), "```", ""); break;
      case "verse":
        String(b.text || "").replace(/\n+$/, "").split("\n").forEach(l => out.push(l.replace(/\s+$/, "") + "  "));
        out.push("");
        break;
      case "img": if (!b.banner) pushImageMd(out, b); break;       // banner is lifted to the hero
      case "gallery":                                              // Substack has no carousel → a clean stack of photos
        (b.images || []).forEach(im => pushImageMd(out, im));
        if (b.caption) out.push("*" + cleanCaption(b.caption) + "*", "");
        break;
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
    const body = mergeStrandedFootnotes(A.body);
    const sources = sourcesFor(opts);
    const { numByKey, ordered } = indexSources(body, sources);
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

    body.forEach(b => blockToMd(out, b, ctx));

    if (opts.sourcesList !== false && ordered.length) {
      out.push("---", "", "## Sources", "");
      ordered.forEach(({ num, src, quotes }) => {
        const has = !!srcUrl(src);
        const label = [src.outlet, src.title].filter(Boolean).join(" — ") || src.id || ("Source " + num);
        let line = num + ". " + (has ? "[" + label + "](" + evidenceUrl(src, quotes[0]) + ")" : label);
        if (src.retrieved) line += "  \n   _archived " + src.retrieved + "_";
        out.push(line);
        // the evidence — the exact words in the source that back the claim, each
        // linking to the snapshot opened on that passage
        quotes.forEach(q => out.push("   - " + (has ? "[“" + q + "”](" + evidenceUrl(src, q) + ")" : "“" + q + "”")));
      });
      out.push("");
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ====================================================================
  //  PLAIN TEXT  (a clean reading copy — the words, no markup)
  // ====================================================================
  // The same article as markdown, but stripped of every mark: links collapse to
  // their words, bold/italic/code lose their syntax, images drop to their
  // captions. A sourced claim keeps its number as a bracketed marker ([1]) so the
  // plain copy still points at the Sources list the way the markdown's superscript
  // link does — dropped when citations are toggled off.
  function citeMarksTxt(tok, ctx) {
    if (!ctx.citations || !tok.src || !tok.src.length) return "";
    return tok.src.map(k => { const num = ctx.numByKey.get(k); return num ? "[" + num + "]" : ""; }).join("");
  }
  function tokensToText(tokens, ctx) {
    return (tokens || []).map(t => {
      if (typeof t === "string") return t;
      if (t.t === "br") return "\n";
      if (t.t === "sup") return "[" + (t.num != null ? t.num : t.text) + "]"; // footnote marker → [n]
      if (t.t) return t.text || "";                  // strong/em/s/code/link → just the words
      if (t.c != null) {                             // a source-bound claim
        const marks = citeMarksTxt(t, ctx);
        if (!marks) return t.c;
        const tail = (t.c.match(/\s*$/) || [""])[0]; // keep the claim's trailing space outside the marker
        return t.c.slice(0, t.c.length - tail.length) + marks + tail;
      }
      return t.text || "";
    }).join("");
  }
  function blockToText(out, b, ctx) {
    switch (b.type) {
      case "h2":
      case "h3": if ((b.text || "").trim()) out.push(b.text.trim(), ""); break;
      case "pull":
        out.push(String(b.text || "").trim() + tokensToText(b.marks || [], ctx).trim());
        if (b.attribution) out.push("— " + b.attribution);
        out.push("");
        break;
      case "ul": (b.items || []).forEach(it => out.push("• " + tokensToText(it, ctx).trim())); out.push(""); break;
      case "ol": (b.items || []).forEach((it, i) => out.push((i + 1) + ". " + tokensToText(it, ctx).trim())); out.push(""); break;
      case "hr": out.push("———", ""); break;
      case "footnotes": (b.notes || []).forEach(n => { const x = String(n.text || "").trim(); if (x) out.push("[" + (n.num != null ? n.num : n.key) + "] " + x); }); out.push(""); break;
      case "code": out.push(String(b.text || "").replace(/\n+$/, ""), ""); break;
      case "verse": out.push(String(b.text || "").replace(/\n+$/, ""), ""); break;
      case "img": { const cap = cleanCaption(b.caption); if (!b.banner && cap) out.push(cap, ""); break; } // banner caption rides the hero
      case "gallery":
        (b.images || []).forEach(im => { const c = cleanCaption(im && im.caption); if (c) out.push(c); });
        { const gc = cleanCaption(b.caption); if (gc) out.push(gc); }
        out.push("");
        break;
      case "embed": if (b.url) { out.push(b.url); const c = cleanCaption(b.caption); if (c) out.push(c); out.push(""); } break;
      default: { const t = tokensToText(b.tokens, ctx).trim(); if (t) out.push(t, ""); } // "p" and anything carrying tokens
    }
  }

  function toPlainText(article, opts) {
    opts = opts || {};
    const A = article || {};
    const body = mergeStrandedFootnotes(A.body);
    const sources = sourcesFor(opts);
    const { numByKey, ordered } = indexSources(body, sources);
    const ctx = { citations: opts.citations !== false, numByKey, sources };
    const out = [];

    if (!opts.omitTitle) {
      if (A.kicker) out.push(String(A.kicker).toUpperCase(), "");
      if (A.headline) out.push(A.headline, "");
      if (A.dek) out.push(A.dek, "");
      const by = bylineText(A), date = dateText(A);
      const meta = [by ? "By " + by : "", date].filter(Boolean).join(" · ");
      if (meta) out.push(meta, "");
    }

    const hero = heroImage(A);
    if (hero) { const c = cleanCaption(hero.caption); if (c) out.push(c, ""); }

    body.forEach(b => blockToText(out, b, ctx));

    if (opts.sourcesList !== false && ordered.length) {
      out.push("———", "", "SOURCES", "");
      ordered.forEach(({ num, src, quotes }) => {
        const label = [src.outlet, src.title].filter(Boolean).join(" — ") || src.id || ("Source " + num);
        out.push(num + ". " + label);
        const url = srcUrl(src); if (url) out.push("   " + url);
        if (src.retrieved) out.push("   archived " + src.retrieved);
        quotes.forEach(q => out.push("   - “" + q + "”"));
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
      const url = evidenceUrl(ctx.sources[k], tok.q && tok.q[k]); // snapshot, on the cited words
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
      if (t.t === "sup") return "<sup>" + esc(t.num != null ? t.num : t.text) + "</sup>"; // footnote marker (the number)
      if (t.c != null) return esc(t.c) + citeMarksHtml(t, ctx);
      return esc(t.text || "");
    }).join("");
  }
  // The photo credit is markdown ([label](url)) like a contributor bio — convert
  // it to safe HTML (escaped text + sanitized <a>) for the exported figcaption.
  function creditHtml(credit) {
    const c = String(credit == null ? "" : credit).trim(); if (!c) return "";
    const P = (typeof window !== "undefined") ? window.NpjProfiles : null;
    const toks = (P && P.linkTokens) ? P.linkTokens(c) : [{ type: "text", text: c }];
    return toks.map(t => t.type === "link"
      ? '<a href="' + esc(t.href) + '">' + esc(t.label) + "</a>"
      : esc(t.text)).join("");
  }
  function imgHtml(img) {
    const url = publicUrl(img.src); if (!url) return "";
    const cap = cleanCaption(img.caption);
    // the photo's description is its alt text (screen readers + search); fall
    // back to the caption when no description was written. The visible figcaption
    // stays caption + credit.
    const alt = cleanCaption(img.description) || cap;
    const credit = creditHtml(img.credit);
    const fig = (cap ? esc(cap) : "") + (credit ? (cap ? " — " : "") + "Credit: " + credit : "");
    return "<figure><img src=\"" + esc(url) + "\" alt=\"" + esc(alt) + "\">" +
      (fig ? "<figcaption>" + fig + "</figcaption>" : "") + "</figure>";
  }
  function blockToHtml(b, ctx) {
    switch (b.type) {
      case "h2": return (b.text || "").trim() ? "<h2>" + esc(b.text.trim()) + "</h2>" : "";
      case "h3": return (b.text || "").trim() ? "<h3>" + esc(b.text.trim()) + "</h3>" : "";
      case "pull": {
        // Substack has no distinct pull-quote on paste, so both flavours land as a
        // blockquote; a pull quote (or any justified quote) carries its alignment
        // as inline text-align, which Substack's importer preserves.
        const align = b.align || (b.kind === "pull" ? "center" : "");
        const sty = (align && align !== "left") ? ' style="text-align:' + align + '"' : "";
        let q = "<blockquote" + sty + "><p>" + esc(String(b.text || "").trim()) + tokensToHtml(b.marks || [], ctx) + "</p>";
        if (b.attribution) q += "<p>— " + esc(b.attribution) + "</p>";
        return q + "</blockquote>";
      }
      case "ul": return "<ul>" + (b.items || []).map(it => "<li>" + tokensToHtml(it, ctx) + "</li>").join("") + "</ul>";
      case "ol": return "<ol>" + (b.items || []).map(it => "<li>" + tokensToHtml(it, ctx) + "</li>").join("") + "</ol>";
      case "hr": return "<hr>";
      case "footnotes": {
        const items = (b.notes || []).map(n => "<li>" + (creditHtml(n.text) || "") + "</li>").join("");
        return items ? "<p><strong>Notes</strong></p><ol>" + items + "</ol>" : "";
      }
      case "code": return "<pre><code>" + esc(String(b.text || "").replace(/\n+$/, "")) + "</code></pre>";
      case "verse": return "<p><em>" + esc(String(b.text || "").replace(/\n+$/, "")).replace(/\n/g, "<br>") + "</em></p>";
      case "img": return b.banner ? "" : imgHtml(b);
      case "gallery": {                                            // a stack of figures — Substack has no carousel
        const imgs = (b.images || []).map(im => imgHtml(im)).filter(Boolean).join("");
        if (!imgs) return "";
        return imgs + (b.caption ? "<p><em>" + esc(cleanCaption(b.caption)) + "</em></p>" : "");
      }
      case "embed": return b.url ? '<p><a href="' + esc(b.url) + '">' + esc(b.url) + "</a></p>" : "";
      default: {
        const inner = tokensToHtml(b.tokens, ctx);
        return inner.trim() ? "<p>" + inner + "</p>" : "";
      }
    }
  }

  // the title block (kicker / headline / dek / byline·date) as HTML parts —
  // shared by toHtml's titled mode and the standalone document's <header>.
  function headerHtml(A) {
    const out = [];
    if (A.kicker) out.push("<p><strong>" + esc(String(A.kicker).toUpperCase()) + "</strong></p>");
    if (A.headline) out.push("<h1>" + esc(A.headline) + "</h1>");
    if (A.dek) out.push("<p><em>" + esc(A.dek) + "</em></p>");
    const by = bylineText(A), date = dateText(A);
    const meta = [by ? "By " + by : "", date].filter(Boolean).join(" · ");
    if (meta) out.push("<p>" + esc(meta) + "</p>");
    return out;
  }

  function toHtml(article, opts) {
    opts = opts || {};
    const A = article || {};
    const body = mergeStrandedFootnotes(A.body);
    const sources = sourcesFor(opts);
    const { numByKey, ordered } = indexSources(body, sources);
    const ctx = { citations: opts.citations !== false, numByKey, sources };
    const parts = [];

    if (!opts.omitTitle) headerHtml(A).forEach(p => parts.push(p));

    const hero = heroImage(A);
    if (hero) { const h = imgHtml(hero); if (h) parts.push(h); }

    body.forEach(b => { const h = blockToHtml(b, ctx); if (h) parts.push(h); });

    if (opts.sourcesList !== false && ordered.length) {
      parts.push("<hr>", "<h2>Sources</h2>");
      parts.push("<ol>" + ordered.map(({ src, quotes }) => {
        const has = !!srcUrl(src);
        const label = [src.outlet, src.title].filter(Boolean).join(" — ") || src.id;
        const head = has ? '<a href="' + esc(evidenceUrl(src, quotes[0])) + '">' + esc(label) + "</a>" : esc(label);
        const arch = src.retrieved ? ' <em>(archived ' + esc(src.retrieved) + ")</em>" : "";
        // the evidence: each cited passage, linking to the snapshot on those words
        const ev = quotes.map(q => has
          ? '<br>“<a href="' + esc(evidenceUrl(src, q)) + '">' + esc(q) + "</a>”"
          : "<br>“" + esc(q) + "”").join("");
        return "<li>" + head + arch + ev + "</li>";
      }).join("") + "</ol>");
    }

    return parts.join("\n");
  }

  // ====================================================================
  //  STANDALONE HTML DOCUMENT  (the file that copies perfectly)
  // ====================================================================
  // A .md file can't paste into Substack formatted — Substack ignores pasted
  // markdown *syntax*. So the durable, foldered "export a file" path is a
  // self-contained .html page: open it in any browser and it renders the whole
  // piece, with a one-click "Copy article" button that puts clean rich HTML on
  // the clipboard (Substack honors pasted HTML). It works offline, survives a
  // wiped clipboard, and — because a browser copies a rendered selection AS rich
  // HTML — a manual select-all + ⌘/Ctrl-C pastes in formatted too. The button's
  // copy targets the body only (#npj-copy); title & subtitle have their own
  // chips, because Substack fills those from its own fields.
  const DOC_CSS = [
    "*{box-sizing:border-box}",
    "html{-webkit-text-size-adjust:100%}",
    "body{margin:0;background:#f6f5f1;color:#1a1a1a;font:18px/1.65 Georgia,'Times New Roman',serif}",
    ".npj-bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:10px;align-items:center;",
      "user-select:none;-webkit-user-select:none;",  // a select-all + copy never grabs the toolbar
      "background:#16140d;color:#fff;padding:12px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}",
    ".npj-bar strong{color:#ffd400;font-size:14px;letter-spacing:.02em}",
    ".npj-bar .hint{flex:1 1 240px;min-width:200px;font-size:12px;line-height:1.4;color:#cfcdc4}",
    ".npj-bar button{font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;",
      "border:0;border-radius:2px;padding:9px 13px;cursor:pointer;background:#ffd400;color:#16140d}",
    ".npj-bar button.ghost{background:transparent;color:#fff;border:1px solid #4a473d}",
    "main{max-width:680px;margin:0 auto;padding:30px 22px 96px}",
    "h1{font-size:2.1rem;line-height:1.12;margin:.1em 0 .35em}",
    "h2{font-size:1.45rem;margin:1.7em 0 .4em}h3{font-size:1.18rem;margin:1.5em 0 .3em}",
    "p{margin:0 0 1.1em}a{color:#0a58ca}",
    "figure{margin:1.6em 0}img{display:block;max-width:100%;height:auto;margin:0 auto}",
    "figcaption{margin-top:.5em;text-align:center;font:italic 14px/1.5 Georgia,serif;color:#666}",
    "blockquote{margin:1.6em 0;padding:.2em 0 .2em 1em;border-left:3px solid #16140d;font-style:italic}",
    "sup{font-size:.7em}sup a{text-decoration:none}",
    "hr{border:0;border-top:1px solid #ccc;margin:2.2em 0}",
    "pre{overflow:auto;background:#f0eee7;padding:14px 16px;border-radius:3px;font-size:15px}",
    "#npj-meta h1{margin-top:0}#npj-meta>p:last-child{color:#666;font-size:15px}"
  ].join("");

  const DOC_SCRIPT =
    "(function(){" +
    "function flash(b,m){var t=b.getAttribute('data-label')||b.textContent;b.textContent=m;" +
      "setTimeout(function(){b.textContent=t;},1800);}" +
    "function selectInto(node,b){var r=document.createRange();r.selectNodeContents(node);" +
      "var s=window.getSelection();s.removeAllRanges();s.addRange(r);var ok=false;" +
      "try{ok=document.execCommand('copy');}catch(e){}" +
      "flash(b,ok?'Copied \\u2014 paste into Substack':'Press \\u2318/Ctrl+C to copy');}" +
    "function copyNode(node,b){var html=node.innerHTML,text=node.innerText||node.textContent||'';" +
      "if(navigator.clipboard&&window.ClipboardItem){navigator.clipboard.write([new ClipboardItem({" +
      "'text/html':new Blob([html],{type:'text/html'})," +
      "'text/plain':new Blob([text],{type:'text/plain'})})])" +
      ".then(function(){flash(b,'Copied \\u2014 paste into Substack');})" +
      ".catch(function(){selectInto(node,b);});}else{selectInto(node,b);}}" +
    "function copyText(txt,b){if(navigator.clipboard&&navigator.clipboard.writeText){" +
      "navigator.clipboard.writeText(txt).then(function(){flash(b,'Copied!');})" +
      ".catch(function(){flash(b,'Copy failed');});}else{flash(b,'Copy failed');}}" +
    "var body=document.getElementById('npj-copy');" +
    "var cb=document.getElementById('npj-copy-body');if(cb)cb.addEventListener('click',function(){copyNode(body,this);});" +
    "[].forEach.call(document.querySelectorAll('[data-copy-text]'),function(b){" +
      "b.addEventListener('click',function(){copyText(this.getAttribute('data-copy-text')||'',this);});});" +
    "})();";

  function toHtmlDocument(article, opts) {
    opts = opts || {};
    const A = article || {};
    const header = headerHtml(A).join("\n");
    const body = toHtml(A, Object.assign({}, opts, { omitTitle: true }));
    const title = esc(A.headline || "Article");

    const chips = [
      '<button id="npj-copy-body" data-label="Copy article">Copy article</button>'
    ];
    if (A.headline) chips.push('<button class="ghost" data-copy-text="' + esc(A.headline) + '" data-label="Copy title">Copy title</button>');
    if (A.dek) chips.push('<button class="ghost" data-copy-text="' + esc(A.dek) + '" data-label="Copy subtitle">Copy subtitle</button>');

    return [
      "<!doctype html>",
      '<html lang="en"><head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>" + title + " — for Substack</title>",
      "<style>" + DOC_CSS + "</style>",
      "</head><body>",
      '<div class="npj-bar">',
      "<strong>Paste into Substack</strong>",
      chips.join(""),
      '<span class="hint">Open in a browser, click <b>Copy article</b>, then paste into a new Substack post. Title &amp; subtitle have their own fields.</span>',
      "</div>",
      "<main>",
      header ? '<div id="npj-meta">' + header + "</div>" : "",
      '<div id="npj-copy">' + body + "</div>",
      "</main>",
      "<script>" + DOC_SCRIPT + "<\/script>",
      "</body></html>"
    ].filter(Boolean).join("\n");
  }

  function filename(article, ext) {
    const A = article || {};
    return (A.slug || slugify(A.headline) || "article") + "." + (ext || "md");
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

  function saveBlob(text, name, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    return name;
  }

  function download(article, opts) {
    return saveBlob(toMarkdown(article, opts), filename(article, "md"), "text/markdown;charset=utf-8");
  }

  function downloadText(article, opts) {
    return saveBlob(toPlainText(article, opts), filename(article, "txt"), "text/plain;charset=utf-8");
  }

  // The "copies perfectly" file: a self-contained page you open and copy from.
  function downloadHtml(article, opts) {
    return saveBlob(toHtmlDocument(article, opts), filename(article, "html"), "text/html;charset=utf-8");
  }

  return { toMarkdown, toPlainText, toHtml, toHtmlDocument, filename, indexSources, mergeStrandedFootnotes, heroImage, evidenceUrl, textFragment, copyForSubstack, download, downloadText, downloadHtml };
});
