/* articles.js — the published record as EO event logs.
 *
 * An article is NOT a markdown file: it is an append-only JSONL log of EO
 * events committed to GitHub at articles/<slug>.jsonl. Line 1 is the publish
 * (INS — mint an enduring anchor); every edit after that is one more line
 * (REC — restructure the frame) appended to the SAME file via the publish
 * webhook's `append` mode. Nothing is ever rewritten, so the file itself is
 * the complete, auditable change history of the piece.
 *
 *   {"v":"npj/article-eo/1","op":"INS","target":"article/<slug>","ts","actor",
 *    "operand":{slug,headline,dek,column,tags,authors,assignees,published,body,sources}}
 *   {"v":"npj/article-eo/1","op":"REC","target":"article/<slug>","ts","actor",
 *    "note":"what changed","operand":{ ...only the fields that changed... }}
 *
 * Reading folds the log: INS seeds the state, each REC replaces the fields it
 * carries (sources merge — a later event can add a source without resending
 * them all). Unknown ops (a future EVA deposit, say) are kept in `events` but
 * don't disturb the fold, so the format can grow without breaking old readers.
 *
 * body[] uses the exact block shapes ArticleRead renders:
 *   {type:'p', tokens:[ "text" | {c,src[],id} | {t:'strong'|'em'|'s'|'code'|'a'|'sup'|'br', text, href?} ]}
 *   {type:'h2'|'h3', text} · {type:'pull', text, attribution?} · {type:'hr'}
 *   {type:'ul'|'ol', items:[tokens[]]} · {type:'img', src, caption?}
 *   {type:'embed', url, caption?} · {type:'code'|'verse', text}
 *
 * Exposed as window.NpjArticles. No deps beyond fetch + (optionally) NpjArchiveCDN. */
(function () {
  'use strict';

  const SCHEMA = "npj/article-eo/1";
  const DIR = "articles";
  const OWNER_REPO = "clovenbradshaw-ctrl/npj";
  const RAW_BASE = "https://raw.githubusercontent.com/" + OWNER_REPO + "/main";
  const API_LIST = "https://api.github.com/repos/" + OWNER_REPO + "/contents/" + DIR + "?ref=main";
  const IDX_CACHE_KEY = "npj_articles_idx_v1";
  const RECEIPT_KEY = "npj_publish_receipts_v1";
  const DEFAULT_ENDPOINT = "https://n8n.intelechia.com/webhook/site/publish-npj";

  const nowIso = () => new Date().toISOString();
  const today = () => nowIso().slice(0, 10);
  const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

  function publishEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.endpoint) return c.endpoint; } catch (e) {}
    return DEFAULT_ENDPOINT;
  }
  const filenameFor = (slug) => DIR + "/" + slug + ".jsonl";
  const rawUrl = (slug) => RAW_BASE + "/" + filenameFor(slug);

  /* djb2 → 7 hex chars. Not crypto — just a stable, human-quotable version id
     derived from the event line itself, so every reader derives the same one. */
  function lineSha(line) {
    let h = 5381;
    for (let i = 0; i < line.length; i++) h = ((h << 5) + h + line.charCodeAt(i)) >>> 0;
    return ("0000000" + h.toString(16)).slice(-7);
  }

  /* ---------------- plain text of a body (versions, diffing, engines) ---------------- */
  function tokenText(t) { return typeof t === "string" ? t : (t && (t.c != null ? t.c : t.text)) || ""; }
  function plainText(body) {
    if (!Array.isArray(body)) return "";
    return body.map(b => {
      if (!b) return "";
      if (b.type === "p") return (b.tokens || []).map(tokenText).join("");
      if (b.type === "h2" || b.type === "h3") return b.text || "";
      if (b.type === "pull") return (b.text || "") + (b.attribution ? " — " + b.attribution : "");
      if (b.type === "ul" || b.type === "ol") return (b.items || []).map(it => "· " + it.map(tokenText).join("")).join("\n");
      if (b.type === "img") return b.caption || "";
      if (b.type === "embed") return b.url || "";
      if (b.type === "code" || b.type === "verse") return b.text || "";
      return "";
    }).filter(Boolean).join("\n\n");
  }
  function readMins(body) {
    const words = (plainText(body).match(/\S+/g) || []).length;
    return Math.max(1, Math.round(words / 220));
  }

  /* ---------------- event lines ---------------- */
  function eventLine(op, slug, operand, actor, extra) {
    return JSON.stringify(Object.assign({
      v: SCHEMA, op, target: "article/" + slug, ts: nowIso(), actor: actor || null, operand: operand || {}
    }, extra || {}));
  }
  const genesisLine = (operand, actor) => eventLine("INS", operand.slug, operand, actor);
  const editLine = (slug, operand, actor, note) => eventLine("REC", slug, operand, actor, note ? { note } : {});

  /* ---------------- fold: JSONL text → current article + version history ---------------- */
  const FOLD_FIELDS = ["slug", "headline", "dek", "column", "tags", "authors", "assignees", "published", "body", "status"];
  function foldLog(text) {
    const events = [];
    String(text || "").split(/\r?\n/).forEach(line => {
      const l = line.trim();
      if (!l) return;
      try { const ev = JSON.parse(l); if (ev && ev.op) events.push({ ev, line: l }); } catch (e) { /* a torn line never breaks the fold */ }
    });
    let state = null;
    const sources = {};
    const versions = []; // newest first when returned
    events.forEach(({ ev, line }) => {
      const o = ev.operand || {};
      if (ev.op === "INS" && !state) {
        state = {};
        FOLD_FIELDS.forEach(k => { if (o[k] != null) state[k] = o[k]; });
        Object.assign(sources, o.sources || {});
      } else if (ev.op === "REC" && state) {
        FOLD_FIELDS.forEach(k => { if (o[k] != null) state[k] = o[k]; });
        Object.assign(sources, o.sources || {});
      } else {
        return; // EVA deposits etc. ride in events[] without touching the fold
      }
      versions.unshift({
        sha: lineSha(line), ts: ev.ts || "", author: ev.actor || "",
        message: ev.note || (ev.op === "INS" ? "Published" : "Edited"),
        text: plainText(state.body)
      });
    });
    if (!state || !state.headline) return { article: null, sources, versions, events: events.map(e => e.ev) };
    const article = {
      slug: state.slug || "untitled",
      kicker: state.column || "Published",
      column: state.column || "",
      headline: state.headline,
      dek: state.dek || "",
      tags: Array.isArray(state.tags) ? state.tags : [],
      authors: Array.isArray(state.authors) ? state.authors : [],
      assignees: Array.isArray(state.assignees) ? state.assignees : [],
      published: state.published || (versions.length ? String(versions[versions.length - 1].ts).slice(0, 10) : today()),
      updated: versions.length ? String(versions[0].ts).slice(0, 10) : null,
      base_sha: versions.length ? versions[0].sha : "0000000",
      readMins: readMins(state.body),
      // "unpublished" hides the piece from the site (front page, reader, docs)
      // for everyone but admins; the log itself is never removed — a later
      // REC{status:"published"} brings it back. Absent field → published.
      status: state.status === "unpublished" ? "unpublished" : "published",
      body: Array.isArray(state.body) ? state.body : [],
      sources, versions
    };
    return { article, sources, versions, events: events.map(e => e.ev) };
  }

  /* ---------------- the published index (drives the front page) ---------------- */
  function loadIdxCache() { try { return JSON.parse(localStorage.getItem(IDX_CACHE_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveIdxCache(c) { try { localStorage.setItem(IDX_CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

  async function fetchLog(slug) {
    // cb param busts the raw CDN's ~5 min cache so a fresh publish/edit reads back immediately
    const res = await fetch(rawUrl(slug) + "?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  }

  async function listArticles() {
    let files = [];
    try {
      const res = await fetch(API_LIST, { headers: { Accept: "application/vnd.github+json" } });
      if (res.status === 404) return []; // nothing published yet — the dir doesn't exist
      if (!res.ok) throw new Error("github " + res.status);
      files = (await res.json() || []).filter(f => f.type === "file" && /\.jsonl$/i.test(f.name));
    } catch (e) {
      // listing down (rate limit, offline) → serve the cached index so the front page still paints
      const cached = loadIdxCache();
      return Object.values(cached).map(c => c.meta).filter(Boolean).sort(byNewest);
    }
    const cache = loadIdxCache();
    const metas = await Promise.all(files.map(async f => {
      const hit = cache[f.name];
      if (hit && hit.sha === f.sha && hit.meta) return hit.meta;
      const slug = f.name.replace(/\.jsonl$/i, "");
      try {
        const text = await fetchLog(slug);
        const { article } = foldLog(text);
        if (!article) return null;
        const meta = {
          slug: article.slug || slug, headline: article.headline, dek: article.dek, kicker: article.kicker,
          column: article.column, tags: article.tags, published: article.published, updated: article.updated,
          authors: article.authors, assignees: article.assignees, versions: article.versions.length, readMins: article.readMins,
          status: article.status
        };
        cache[f.name] = { sha: f.sha, meta };
        return meta;
      } catch (e) { return null; }
    }));
    saveIdxCache(cache);
    return metas.filter(Boolean).sort(byNewest);
  }
  function byNewest(a, b) {
    return String(b.published || "").localeCompare(String(a.published || "")) ||
           String(b.updated || "").localeCompare(String(a.updated || ""));
  }

  // Fill window.NPJ.FRONT from the committed record. Returns the metas.
  async function loadFront() {
    const metas = await listArticles();
    const item = (m) => ({ slug: m.slug, kicker: m.kicker, headline: m.headline, dek: m.dek, tags: m.tags || [], published: m.published, status: m.status });
    window.NPJ.FRONT = { lead: metas.length ? item(metas[0]) : null, secondary: metas.slice(1).map(item), briefs: [] };
    return metas;
  }

  // Fetch + fold one article; its sources join the global ledger so hover
  // cards, the source rail and the methods footer all resolve.
  async function loadArticle(slug) {
    const text = await fetchLog(slugify(slug) || slug);
    if (text == null) return null;
    const { article, sources } = foldLog(text);
    if (article) Object.keys(sources).forEach(k => { window.NPJ.SOURCES[k] = Object.assign(window.NPJ.SOURCES[k] || {}, sources[k]); });
    return article;
  }

  /* ---------------- composer HTML → body blocks ----------------
     Mirror of the old htmlToMarkdown, but the output is structure, not prose.
     Two citation forms are understood:
       <sup class="md-cite" data-cite="key">  (the Newsroom composer) — binds the
         sentence it follows; back-to-back markers stack onto the same claim.
       <span class="eo-claim" data-src="k1 k2" data-id="…">text</span>  (the
         post-publish edit surface) — an explicit claim span, used so published
         claims survive a round trip through contentEditable untouched. */
  function htmlToBlocks(html) {
    const root = document.createElement("div"); root.innerHTML = html || "";
    let idSeq = 0;
    const newId = () => "cl-" + Date.now().toString(36) + "-" + (++idSeq);

    // the claim is the trailing sentence of what was typed before the marker
    function splitClaim(buf) {
      const re = /[.!?…]["')\]]?\s+(?=\S)/g;
      let idx = -1, m;
      while ((m = re.exec(buf))) idx = m.index + m[0].length;
      if (idx < 0) return { head: "", claim: buf };
      return { head: buf.slice(0, idx), claim: buf.slice(idx) };
    }

    function inlineTokens(node) {
      const toks = []; let buf = "";
      const flush = () => { if (buf) { toks.push(buf); buf = ""; } };
      const plain = (n) => String(n.textContent || "");
      const walk = (n) => {
        n.childNodes.forEach(c => {
          if (c.nodeType === 3) { buf += c.nodeValue; return; }
          if (c.nodeType !== 1) return;
          const tag = c.tagName.toLowerCase();
          if (tag === "br") { flush(); toks.push({ t: "br" }); return; }
          if (tag === "span" && c.classList.contains("eo-claim")) {
            flush();
            const src = String(c.getAttribute("data-src") || "").split(/[\s,]+/).filter(Boolean);
            if (src.length) toks.push({ c: plain(c), src, id: c.getAttribute("data-id") || newId() });
            else buf += plain(c);
            return;
          }
          if (tag === "sup" && c.classList.contains("md-cite")) {
            if (c.hasAttribute("data-fn")) { flush(); toks.push({ t: "sup", text: plain(c) }); return; } // manual footnote
            const key = c.getAttribute("data-cite"); if (!key) return;
            const prev = toks[toks.length - 1];
            if (!buf.trim() && prev && typeof prev === "object" && prev.c) {
              if (prev.src.indexOf(key) < 0) prev.src.push(key); // text[^a][^b] → one claim, two sources
              return;
            }
            const { head, claim } = splitClaim(buf);
            if (head) toks.push(head);
            if (claim.trim()) toks.push({ c: claim, src: [key], id: newId() });
            else if (head) toks.push(claim);
            buf = "";
            return;
          }
          if (tag === "strong" || tag === "b") { flush(); toks.push({ t: "strong", text: plain(c) }); return; }
          if (tag === "em" || tag === "i") { flush(); toks.push({ t: "em", text: plain(c) }); return; }
          if (tag === "s" || tag === "strike" || tag === "del") { flush(); toks.push({ t: "s", text: plain(c) }); return; }
          if (tag === "code") { flush(); toks.push({ t: "code", text: plain(c) }); return; }
          if (tag === "a") { flush(); toks.push({ t: "a", text: plain(c), href: c.getAttribute("href") || "" }); return; }
          walk(c); // unknown wrapper → recurse through it
        });
      };
      walk(node);
      flush();
      return toks;
    }
    const hasInk = (toks) => toks.some(t => typeof t === "string" ? t.trim() : true);

    const blocks = [];
    let headline = "", dek = "";
    Array.from(root.childNodes).forEach(node => {
      if (node.nodeType === 3) { const t = node.nodeValue.trim(); if (t) blocks.push({ type: "p", tokens: [t] }); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      const text = String(node.textContent || "").trim();
      if (tag === "h1") { if (!headline) headline = text; else blocks.push({ type: "h2", text }); return; }
      if (tag === "h2") { if (text) blocks.push({ type: "h2", text }); return; }
      if (tag === "h3") { if (text) blocks.push({ type: "h3", text }); return; }
      if (node.classList && node.classList.contains("nr-dek")) { if (!dek) dek = text; return; }
      if (tag === "blockquote") { if (text) blocks.push({ type: "pull", text, attribution: "" }); return; }
      if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.querySelectorAll(":scope > li")).map(li => inlineTokens(li)).filter(hasInk);
        if (items.length) blocks.push({ type: tag, items });
        return;
      }
      if (tag === "hr") { blocks.push({ type: "hr" }); return; }
      if (tag === "pre") {
        const body = String(node.textContent || "").replace(/\n+$/, "");
        if (body) blocks.push({ type: node.classList.contains("verse") ? "verse" : "code", text: body });
        return;
      }
      if (node.classList && node.classList.contains("cmp-widget") && node.getAttribute("data-widget") === "poll") {
        const q = node.querySelector(".cmp-widget-b strong");
        const opts = Array.from(node.querySelectorAll(".cmp-widget-b span")).map(s => s.textContent.trim()).filter(Boolean);
        blocks.push({ type: "pull", text: "Poll: " + (q ? q.textContent.trim() : "") + (opts.length ? " — " + opts.join(" / ") : ""), attribution: "readers vote on the published page" });
        return;
      }
      if (tag === "figure") {
        const cap = node.querySelector("figcaption");
        const capText = cap ? cap.textContent.trim() : "";
        const slot = node.querySelector("image-slot");
        const plainImg = node.querySelector("img");
        const isStore = (u) => !!(u && window.NpjMedia && window.NpjMedia.isStoreUrl(u));
        const isArchive = (u) => !!u && (!window.NpjArchiveCDN || window.NpjArchiveCDN.isMediaUrl(u));
        const okSrc = (u) => !!u && (window.NpjMedia ? window.NpjMedia.isPublishable(u) : isArchive(u));
        if (node.hasAttribute("data-eo-img")) {
          const s = plainImg && plainImg.getAttribute("src");
          if (s) blocks.push({ type: "img", src: s, caption: capText });
        } else if (slot) {
          // a slot can carry two URLs (src + data-alt): the archive.org one is
          // the canonical `src`; the media-store one rides as `store` so the
          // viewer can try the live copy first, then fall back to archive.org.
          const cands = [slot.getAttribute("src"), slot.getAttribute("data-alt")].filter(Boolean);
          let archiveU = null, storeU = null, otherU = null;
          cands.forEach(u => {
            if (isStore(u)) storeU = storeU || u;
            else if (isArchive(u)) archiveU = archiveU || u;
            else otherU = otherU || u;
          });
          const src = archiveU || storeU || (okSrc(otherU) ? otherU : null);
          if (src) {
            const block = { type: "img", src, caption: capText };
            if (storeU && storeU !== src) block.store = storeU;
            blocks.push(block);
          }
        }
        const u = node.getAttribute("data-embed-url");
        if (u) blocks.push({ type: "embed", url: u, caption: capText });
        return;
      }
      const toks = inlineTokens(node);
      if (hasInk(toks)) blocks.push({ type: "p", tokens: toks });
    });
    return { blocks, headline, dek };
  }

  /* ---------------- body blocks → HTML (the post-publish edit surface) ---------------- */
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function tokensToHtml(tokens) {
    return (tokens || []).map(t => {
      if (typeof t === "string") return esc(t);
      if (t.c != null) return '<span class="eo-claim" data-src="' + esc((t.src || []).join(" ")) + '" data-id="' + esc(t.id || "") + '">' + esc(t.c) + "</span>";
      if (t.t === "br") return "<br/>";
      if (t.t === "strong") return "<strong>" + esc(t.text) + "</strong>";
      if (t.t === "em") return "<em>" + esc(t.text) + "</em>";
      if (t.t === "s") return "<s>" + esc(t.text) + "</s>";
      if (t.t === "code") return "<code>" + esc(t.text) + "</code>";
      if (t.t === "a") return '<a href="' + esc(t.href) + '">' + esc(t.text) + "</a>";
      if (t.t === "sup") return '<sup class="md-cite" data-fn="1" data-cite="' + esc(t.text) + '" contenteditable="false">' + esc(t.text) + "</sup>";
      return esc(t.text || "");
    }).join("");
  }
  function blocksToHtml(body) {
    return (body || []).map((b, bi) => {
      if (b.type === "p") return "<p>" + (tokensToHtml(b.tokens) || "<br/>") + "</p>";
      if (b.type === "h2" || b.type === "h3") return "<" + b.type + ">" + esc(b.text) + "</" + b.type + ">";
      if (b.type === "pull") return "<blockquote>" + esc(b.text) + "</blockquote>";
      if (b.type === "ul" || b.type === "ol") return "<" + b.type + ">" + (b.items || []).map(it => "<li>" + tokensToHtml(it) + "</li>").join("") + "</" + b.type + ">";
      if (b.type === "hr") return "<hr/>";
      if (b.type === "code") return "<pre>" + esc(b.text) + "</pre>";
      if (b.type === "verse") return '<pre class="verse">' + esc(b.text) + "</pre>";
      // editable image-slot (not a static <img>) so the edit surface can
      // replace it — a fresh drop uploads to the media store, then publish/save
      // moves it to archive.org. Primary src is the live media-store copy when
      // we have one (matrix-first), with the archive.org URL as data-alt.
      if (b.type === "img") {
        const primary = b.store || b.src || "";
        const alt = (b.store && b.src && b.src !== b.store) ? b.src : "";
        return '<figure contenteditable="false" class="cmp-embed"><image-slot id="eo-img-' + bi + '" src="' + esc(primary) + '"' + (alt ? ' data-alt="' + esc(alt) + '"' : '') + ' shape="rect" style="width:100%;height:300px;display:block" placeholder="Drop a photo or an archive.org link"></image-slot>' + (b.caption ? '<figcaption class="np-mono" style="font-size:11px;margin-top:4px">' + esc(b.caption) + "</figcaption>" : "") + "</figure>";
      }
      if (b.type === "embed") return '<figure data-embed-url="' + esc(b.url) + '" contenteditable="false"><a href="' + esc(b.url) + '">' + esc(b.url) + "</a>" + (b.caption ? "<figcaption>" + esc(b.caption) + "</figcaption>" : "") + "</figure>";
      return "";
    }).join("\n");
  }

  /* ---------------- publish + edit (through the same n8n webhook) ---------------- */
  // Build the genesis event from the composer's content. Sources: only the
  // records the body actually cites ride in the log — the log must stand alone.
  function genesisFromContent(content, opts) {
    const c = content || {};
    const o = opts || {};
    const { blocks, headline, dek } = htmlToBlocks(c.html || "");
    const usedKeys = {};
    blocks.forEach(b => {
      (b.tokens || []).forEach(t => { if (t && t.src) t.src.forEach(k => usedKeys[k] = 1); });
      (b.items || []).forEach(it => it.forEach(t => { if (t && t.src) t.src.forEach(k => usedKeys[k] = 1); }));
    });
    const sources = {};
    Object.keys(usedKeys).forEach(k => { if (window.NPJ.SOURCES[k]) sources[k] = window.NPJ.SOURCES[k]; });
    const actor = o.actor || null;
    const operand = {
      slug: o.slug || slugify(headline || o.headline) || "untitled",
      headline: headline || o.headline || "Untitled",
      dek: dek || o.dek || "",
      column: c.column || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      authors: actor ? [actor] : [],
      assignees: actor ? [actor] : [], // the publisher can edit after publish; admin always can
      published: today(),
      body: blocks,
      sources
    };
    const line = genesisLine(operand, actor);
    const folded = foldLog(line);
    return { line, operand, article: folded.article };
  }

  async function post(bodyObj, token) {
    const res = await fetch(publishEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(bodyObj)
    });
    return res;
  }
  // First commit of a log. Overwrite is intentional: re-publishing a slug
  // restarts its record (the old log is still in git history).
  function publishGenesis({ slug, line, token, message }) {
    return post({ filename: filenameFor(slug), mode: "overwrite", contentRaw: line + "\n", message: message || ("publish: " + slug) }, token);
  }
  // One REC line appended to the existing log — the edit-after-publish path.
  async function appendEdit({ slug, operand, actor, note, token, message }) {
    const line = editLine(slug, operand, actor, note);
    const res = await post({ filename: filenameFor(slug), mode: "append", contentRaw: line + "\n", message: message || ("edit: " + slug) }, token);
    return { res, line, sha: lineSha(line) };
  }
  // Unpublish / republish — append a REC carrying only the status. Nothing is
  // deleted: the whole log (every prior version) stays in GitHub, and the act
  // of hiding it is itself recorded as one more event in the record. Authorized
  // exactly like any other append (the webhook re-verifies the Matrix token);
  // the UI restricts the action to admins.
  function setArticleStatus({ slug, status, actor, note, token }) {
    const next = status === "unpublished" ? "unpublished" : "published";
    const message = (next === "unpublished" ? "unpublish: " : "republish: ") + slug;
    const finalNote = note || (next === "unpublished"
      ? "Unpublished — hidden from the site (the event log stays in GitHub)"
      : "Republished");
    return appendEdit({ slug, operand: { status: next }, actor, note: finalNote, token, message });
  }

  /* Publish receipts. The webhook now returns the post-commit provenance the
     client can't know up front — the GitHub commit_sha of the line it wrote and
     its byte count. The genesis event is serialized BEFORE the commit, so the
     SHA can't live in the event operand; it lives here, keyed by filename, so a
     later load can confirm the raw URL is serving the commit we actually made
     rather than a stale CDN copy. Local-only, best-effort: never throws. */
  function saveReceipt(rec) {
    if (!rec || !rec.filename) return rec;
    try {
      const all = JSON.parse(localStorage.getItem(RECEIPT_KEY) || "{}") || {};
      all[rec.filename] = {
        filename: rec.filename,
        commit_sha: rec.commit_sha || null,
        bytes: typeof rec.bytes === "number" ? rec.bytes : null,
        published_at: rec.published_at || nowIso()
      };
      localStorage.setItem(RECEIPT_KEY, JSON.stringify(all));
    } catch (e) {}
    return rec;
  }
  function getReceipt(filename) {
    try { const all = JSON.parse(localStorage.getItem(RECEIPT_KEY) || "{}") || {}; return all[filename] || null; } catch (e) { return null; }
  }

  window.NpjArticles = {
    SCHEMA, DIR, RAW_BASE, rawUrl, filenameFor, publishEndpoint,
    foldLog, plainText, readMins, lineSha,
    listArticles, loadFront, loadArticle,
    htmlToBlocks, blocksToHtml, tokensToHtml,
    genesisLine, editLine, genesisFromContent, publishGenesis, appendEdit, setArticleStatus,
    saveReceipt, getReceipt
  };
})();
