/* articles.js — the published record as EO event logs.
 *
 * An article is NOT a markdown file: it is an append-only log of EO events.
 * Each document owns a FOLDER — articles/<slug>/ — holding one file per event,
 * named by a sortable UTC stamp:
 *
 *   articles/<slug>/20260610T231501123Z-ins-x7k2.jsonl   ← the publish (INS)
 *   articles/<slug>/20260611T010203456Z-rec-9bd1.jsonl   ← an edit (REC)
 *
 * Every write CREATES a new file; no commit ever updates an existing one. (The
 * old single-file `append` rode GitHub's update-with-SHA call, which kept
 * rejecting commits; a create can't conflict.) Reading lists the folder and
 * folds the files in filename (= time) order, so the folder IS the document's
 * version history. Uploading the same document again just lands a newer INS
 * file: the fold restarts from it and every earlier version stays on the
 * shelf. Legacy single-file logs (articles/<slug>.jsonl) still fold in, first.
 *
 *   {"v":"npj/article-eo/1","op":"INS","target":"article/<slug>","ts","actor",
 *    "operand":{slug,headline,dek,column,tags,authors,assignees,published,body,sources}}
 *   {"v":"npj/article-eo/1","op":"REC","target":"article/<slug>","ts","actor",
 *    "note":"what changed","operand":{ ...only the fields that changed... }}
 *
 * Reading folds the log: INS seeds the state (a later INS re-seeds it — a
 * fresh upload of the same doc), each REC replaces the fields it carries
 * (sources merge — a later event can add a source without resending them
 * all). Unknown ops (a future EVA deposit, say) are kept in `events` but
 * don't disturb the fold, so the format can grow without breaking old readers.
 *
 * body[] uses the exact block shapes ArticleRead renders:
 *   {type:'p', tokens:[ "text" | {c,src[],id} | {t:'strong'|'em'|'s'|'code'|'a'|'sup'|'br', text, href?} ]}
 *   {type:'h2'|'h3', text} · {type:'pull', text, attribution?} · {type:'hr'}
 *   {type:'ul'|'ol', items:[tokens[]]} · {type:'img', src, caption?}
 *   {type:'embed', url, caption?} · {type:'code'|'verse', text}
 *
 * Exposed as window.NpjArticles. No deps beyond fetch + (optionally) NpjArchiveCDN.
 * Also module.exports the pure fold/revert helpers for node tests. */
(function (root) {
  'use strict';

  const SCHEMA = "npj/article-eo/1";
  const DIR = "articles";
  const OWNER_REPO = "clovenbradshaw-ctrl/npj";
  const RAW_BASE = "https://raw.githubusercontent.com/" + OWNER_REPO + "/main";
  const API_CONTENTS = "https://api.github.com/repos/" + OWNER_REPO + "/contents/" + DIR;
  const API_TREE = "https://api.github.com/repos/" + OWNER_REPO + "/git/trees/main?recursive=1";
  const IDX_CACHE_KEY = "npj_articles_idx_v3"; // v3: per-document folders — entries are keyed by slug, not filename
  const FRONT_CACHE_KEY = "npj_front_v1"; // last front-page line-up, painted instantly on the next visit
  const RECEIPT_KEY = "npj_publish_receipts_v1";
  const DEFAULT_ENDPOINT = "https://n8n.intelechia.com/webhook/site/publish-npj";

  const nowIso = () => new Date().toISOString();
  const today = () => nowIso().slice(0, 10);
  const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

  function publishEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.endpoint) return c.endpoint; } catch (e) {}
    return DEFAULT_ENDPOINT;
  }
  // legacy single-file log — still read, never written to anymore
  const filenameFor = (slug) => DIR + "/" + slug + ".jsonl";
  const rawUrl = (slug) => RAW_BASE + "/" + filenameFor(slug);
  // the document's folder of version files
  const dirFor = (slug) => DIR + "/" + slug;
  /* One event = one NEW file: <UTC stamp>-<op>-<entropy>.jsonl. The stamp makes
     lexical order chronological; the random tail means two writers landing in
     the same millisecond create two files instead of one clobbering the other. */
  // op tag in the filename: ins (publish), rec (edit), eva (reader feedback —
  // a span-anchored suggestion/comment that folds as a no-op for the article
  // state but rides the same auditable folder). Anything else lands as rec.
  const OP_TAGS = { ins: "ins", rec: "rec", eva: "eva" };
  function versionFilenameFor(slug, op) {
    const stamp = nowIso().replace(/[-:.]/g, ""); // 2026-06-10T23:15:01.123Z → 20260610T231501123Z
    const tail = ("000" + Math.floor(Math.random() * 1679616).toString(36)).slice(-4);
    return dirFor(slug) + "/" + stamp + "-" + (OP_TAGS[String(op).toLowerCase()] || "rec") + "-" + tail + ".jsonl";
  }

  /* djb2 → 7 hex chars. Not crypto — just a stable, human-quotable version id
     derived from the event line itself, so every reader derives the same one. */
  function lineSha(line) {
    let h = 5381;
    for (let i = 0; i < line.length; i++) h = ((h << 5) + h + line.charCodeAt(i)) >>> 0;
    return ("0000000" + h.toString(16)).slice(-7);
  }

  /* ---------------- plain text of a body (versions, diffing, engines) ---------------- */
  // A footnote marker ({t:"sup"}) carries no reading text — it's a reference, so
  // it must not leak its "fn1"/number into plaintext, word counts or diffs.
  function tokenText(t) { return typeof t === "string" ? t : (t && (t.c != null ? t.c : (t.t === "sup" ? "" : t.text))) || ""; }
  // Owned-claim stance, normalized to the three the editor records — analysis
  // (⊢), testimony/account (⊨) and voice/position (⊩). Anything else → null
  // (not an owned claim). An owned claim is grounded by the author's honest
  // declaration, not a citation, and rides the published body as a {c, stance}
  // token so the reader's transparency lens can show how it stands.
  function stanceNorm(s) {
    s = String(s || "").trim().toLowerCase();
    // absence = an ASSERTED ABSENCE: the claim is grounded not by a citation but
    // by a documented search that found nothing (its `note` records what/where).
    return (s === "analysis" || s === "testimony" || s === "voice" || s === "absence") ? s : null;
  }
  // The six kinds of void (an asserted absence), strongest → weakest. Kept in
  // sync with app/void-kinds.js (the shared taxonomy the editor + reader use);
  // duplicated here so the publish fold validates a kind without depending on the
  // browser-only module. A void carries WHICH kind it is so the reader knows
  // whether the absence is shown, located, or only inferred.
  const VOID_KINDS = ["removed", "withheld", "silent", "inaccessible", "unrecorded", "ambient"];
  function vkindNorm(k) { k = String(k || "").trim().toLowerCase(); return VOID_KINDS.indexOf(k) >= 0 ? k : null; }
  function plainText(body) {
    if (!Array.isArray(body)) return "";
    return body.map(b => {
      if (!b) return "";
      if (b.type === "p") return (b.tokens || []).map(tokenText).join("");
      if (b.type === "h2" || b.type === "h3") return b.text || "";
      if (b.type === "pull") return (b.text || "") + (b.attribution ? " — " + b.attribution : "");
      if (b.type === "ul" || b.type === "ol") return (b.items || []).map(it => "· " + it.map(tokenText).join("")).join("\n");
      if (b.type === "footnotes") return (b.notes || []).map(n => n && n.text || "").filter(Boolean).join("\n");
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

  /* ---------------- footnote hygiene: never strand a marker on its own line ----
     A footnote marker ({t:"sup"}) references a WORD, so a paragraph holding
     nothing but markers (and whitespace) is a stranded marker — it renders as a
     lone "1" on its own line in every reader and the Substack export. Fold those
     markers onto the END of the previous paragraph (where the marker belongs);
     with no paragraph above, onto the START of the next one. Idempotent, and the
     plaintext is unchanged (a sup carries no reading text — see tokenText). This
     repairs older drafts already saved this way AND backstops the composer's
     anchorFootnoteCaret, so the marker lands against its text everywhere. */
  function isFnMarker(t) { return !!t && typeof t === "object" && t.t === "sup"; }
  function onlyFnMarkers(tokens) {
    const ts = tokens || [];
    return ts.length > 0 && ts.some(isFnMarker) &&
      ts.every(t => isFnMarker(t) || (typeof t === "string" && !t.trim()));
  }
  // Non-mutating: blocks are cloned (Object.assign) when markers attach, so a
  // shared article body is never corrupted by a repeat call (read model + export).
  function mergeStrandedFootnotes(blocks) {
    const src = Array.isArray(blocks) ? blocks : [];
    // Keys already carried by a marker that sits AGAINST TEXT — a real reference.
    // A manual footnote key is unique per insertion (Newsroom insertFootnote), so a
    // stranded marker repeating one is an editing artifact (an Enter/paste/drag
    // cloned a trailing marker), not a second reference: DROP it rather than fold it
    // onto the text above, which would footnote that sentence with someone else's note.
    const attached = new Set();
    src.forEach(b => { if (b && b.type === "p" && !onlyFnMarkers(b.tokens)) (b.tokens || []).forEach(t => { if (isFnMarker(t) && t.key) attached.add(t.key); }); });
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
        else carry = carry.concat(markers);
        return;   // drop the stranded paragraph
      }
      if (carry.length && b && b.type === "p") { out.push(Object.assign({}, b, { tokens: carry.concat(b.tokens || []) })); carry = []; return; }
      out.push(b);
    });
    if (carry.length) out.push({ type: "p", tokens: carry });   // nowhere to attach — keep the marker rather than lose it
    return out;
  }

  /* ---------------- standardized article metadata ----------------
     The fields every published piece should carry so the front page renders
     consistently no matter which layout template it lands in. `required` ones
     gate the "standardized" check the admin lineup editor surfaces; the rest are
     recommended. Mirrors the keys produced by foldLog / listArticles. */
  const META_STANDARD = [
    { key: "headline",  label: "Title",    required: true },
    { key: "dek",       label: "Subtitle", required: true },
    { key: "column",    label: "Column",   required: true },
    { key: "image",     label: "Photo",    required: true },
    { key: "published", label: "Date",     required: true },
    { key: "tags",      label: "Tags",     required: false },
    { key: "authors",   label: "Byline",   required: false }
  ];
  function metaFieldEmpty(key, v) {
    if (v == null) return true;
    if (key === "image") return !(v && (v.src || v.store));
    if (Array.isArray(v)) return v.length === 0;
    return String(v).trim() === "";
  }
  // → { missing:[{key,label,required}], required:[…just the required misses…],
  //     ok:boolean (all required present), score:0–100 }
  function checkMeta(meta) {
    const missing = META_STANDARD.filter(f => metaFieldEmpty(f.key, meta ? meta[f.key] : null));
    const required = missing.filter(f => f.required);
    const have = META_STANDARD.length - missing.length;
    return { missing, required, ok: required.length === 0, score: Math.round((have / META_STANDARD.length) * 100) };
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
  const FOLD_FIELDS = ["slug", "headline", "dek", "column", "tags", "authors", "editors", "byline", "assignees", "published", "body", "status", "composition"];
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
      if (ev.op === "INS") {
        // a later INS restarts the record — someone uploaded the same document
        // again. The new upload is the current version; everything before it
        // stays in `versions`, so nothing is lost.
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
        op: ev.op,
        note: ev.note || "",
        message: ev.note || (ev.op === "INS" ? "Published" : "Edited"),
        headline: state.headline || "", dek: state.dek || "",
        text: plainText(state.body),
        // A full, restorable snapshot of the folded state AT this version, so the
        // changelog can REVERT to it (re-emit it as a REC) without re-reading the
        // log. A shallow clone is exact here: every event REPLACES a field's value
        // wholesale (state[k] = o[k]) rather than mutating it in place, and the
        // accumulating `sources` is copied out so a later add can't leak backward.
        snapshot: Object.assign({}, state, { sources: Object.assign({}, sources) }),
        // The structured revert marker, present iff this event was itself a revert
        // (the changelog's revert/undo writes operand.revert). A non-fold operand
        // key, so it rides the event without disturbing the folded state — it just
        // lets the changelog label the entry and offer a one-click "undo revert".
        revert: (o && o.revert) || null
      });
    });
    if (!state || !state.headline) return { article: null, sources, versions, events: events.map(e => e.ev) };
    // the lead image, lifted out of the body so the reader and the front page
    // can use it without walking the blocks (it still lives in body too). An
    // explicit banner wins; failing that the first inline photo becomes the
    // front-page thumbnail — so an article with any image always shows one on
    // the front page, while only a real banner is lifted into the reader hero.
    const imgBlocks = (Array.isArray(state.body) ? state.body : []).filter(b => b && b.type === "img" && b.src);
    const bannerBlock = imgBlocks.find(b => b.banner) || imgBlocks[0] || null;
    const article = {
      slug: state.slug || "untitled",
      kicker: state.column || "Published",
      column: state.column || "",
      headline: state.headline,
      dek: state.dek || "",
      tags: Array.isArray(state.tags) ? state.tags : [],
      authors: Array.isArray(state.authors) ? state.authors : [],
      // editors credited in the byline (optional, separate from the authors line);
      // byline is an optional override string ("Unsigned" suppresses author names)
      editors: Array.isArray(state.editors) ? state.editors : [],
      byline: typeof state.byline === "string" ? state.byline : "",
      assignees: Array.isArray(state.assignees) ? state.assignees : [],
      published: state.published || (versions.length ? String(versions[versions.length - 1].ts).slice(0, 10) : today()),
      updated: versions.length ? String(versions[0].ts).slice(0, 10) : null,
      base_sha: versions.length ? versions[0].sha : "0000000",
      readMins: readMins(state.body),
      // "unpublished" hides the piece from the site (front page, reader, docs)
      // for everyone but admins; the log itself is never removed — a later
      // REC{status:"published"} brings it back. Absent field → published.
      status: state.status === "unpublished" ? "unpublished" : "published",
      image: bannerBlock ? {
        src: bannerBlock.src, store: bannerBlock.store || "", caption: bannerBlock.caption || "",
        credit: bannerBlock.credit || "",
        banner: !!bannerBlock.banner, fit: bannerBlock.fit || "", crop: bannerBlock.crop || null
      } : null,
      // normalize on read too, so a draft already saved with a stranded marker
      // renders right for every consumer (reader + Substack export) without a re-save
      body: mergeStrandedFootnotes(Array.isArray(state.body) ? state.body : []),
      // how the piece was assembled (typed vs. pasted, paste sizes, timeline) —
      // aggregate counts only, never the words; absent on pieces published before
      // this shipped, so the reader's footer simply omits it for them
      composition: (state.composition && typeof state.composition === "object") ? state.composition : null,
      sources, versions
    };
    return { article, sources, versions, events: events.map(e => e.ev) };
  }

  /* ---------------- revert: restore a prior version, append-only ----------------
     A revert is not a delete and not a rewrite — it is one more REC event that
     re-asserts an earlier version's folded state, so the document reads as it did
     then while the whole history (including the revert itself) stays in GitHub.
     Undo-a-revert is the same move aimed at the pre-revert version, so it needs no
     special path. snapshotOperand turns a version's `snapshot` (see foldLog) back
     into the operand a REC must carry to reproduce it exactly. */
  function snapshotOperand(snapshot) {
    const snap = snapshot || {};
    const o = {};
    FOLD_FIELDS.forEach(k => {
      // status is set explicitly below (so a revert also restores whether the
      // piece was live); assignees are the access-control list, NOT content — a
      // revert must never change who can edit, so it's left to the current state.
      if (k === "status" || k === "assignees") return;
      if (snap[k] != null) o[k] = snap[k];
    });
    o.status = snap.status === "unpublished" ? "unpublished" : "published";
    // Sources MERGE on fold, so re-asserting the snapshot's sources is enough to
    // resolve the restored body's citations. A source introduced by a later (now
    // reverted) edit lingers in the merged ledger but is unreferenced by the
    // restored body — harmless, and never silently dropped from the record.
    if (snap.sources && Object.keys(snap.sources).length) o.sources = snap.sources;
    return o;
  }
  // The same operand, tagged so the event self-identifies as a revert: `to`/`ts`
  // name the version restored; `undo:true` marks an undo-of-a-revert. The marker
  // is a non-fold key (foldLog ignores it), surfaced back on the version object so
  // the changelog can label it and offer "undo revert".
  function revertOperand(snapshot, meta) {
    const o = snapshotOperand(snapshot);
    o.revert = { to: (meta && meta.to) || null, ts: (meta && meta.ts) || null, undo: !!(meta && meta.undo) };
    return o;
  }

  /* ---------------- the published index (drives the front page) ---------------- */
  function loadIdxCache() { try { return JSON.parse(localStorage.getItem(IDX_CACHE_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveIdxCache(c) { try { localStorage.setItem(IDX_CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

  /* The front-page line-up, mirrored to localStorage so a returning visitor sees
     the last-known stories the instant the page paints — without waiting on the
     git-tree API. loadFront() still runs and reconciles against the live record;
     this is purely a stale-while-revalidate head start. */
  function saveFront(front) { try { localStorage.setItem(FRONT_CACHE_KEY, JSON.stringify(front)); } catch (e) {} }
  function primeFront() {
    try {
      if (!window.NPJ || (window.NPJ.FRONT && window.NPJ.FRONT.lead)) return; // don't clobber a live load
      const cached = JSON.parse(localStorage.getItem(FRONT_CACHE_KEY) || "null");
      if (cached && (cached.lead || (cached.secondary && cached.secondary.length))) window.NPJ.FRONT = cached;
    } catch (e) {}
  }

  async function fetchRaw(path) {
    // cb param busts the raw CDN's ~5 min cache (including cached 404s) so a
    // fresh commit reads back immediately
    const res = await fetch(RAW_BASE + "/" + path + "?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  }
  // join event files into one log text; order in = fold order
  function joinParts(texts) {
    const parts = (texts || []).filter(t => t != null && String(t).trim());
    return parts.length ? parts.map(t => String(t).replace(/\n+$/, "")).join("\n") + "\n" : null;
  }

  /* One git-tree call lists every document at once: the folders of version
     files (articles/<slug>/<stamp>-<op>.jsonl) and any legacy single-file logs
     (articles/<slug>.jsonl). One API request no matter how many documents. */
  const LEGACY_RE = /^articles\/([A-Za-z0-9][A-Za-z0-9-]*)\.jsonl$/;
  const VERSION_RE = /^articles\/([A-Za-z0-9][A-Za-z0-9-]*)\/[^\/]+\.jsonl$/;
  async function listDocs() {
    const res = await fetch(API_TREE, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("github " + res.status);
    const tree = ((await res.json()) || {}).tree || [];
    const docs = {};
    const doc = (slug) => docs[slug] || (docs[slug] = { slug, legacy: null, files: [] });
    tree.forEach(e => {
      if (!e || e.type !== "blob") return;
      let m = LEGACY_RE.exec(e.path);
      if (m) { doc(m[1]).legacy = { path: e.path, sha: e.sha }; return; }
      m = VERSION_RE.exec(e.path);
      if (m) doc(m[1]).files.push({ path: e.path, sha: e.sha });
    });
    Object.values(docs).forEach(d => d.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
    return Object.values(docs);
  }

  // the version files inside ONE document's folder ([] when there's no folder)
  async function listDocFiles(slug) {
    const res = await fetch(API_CONTENTS + "/" + slug + "?ref=main", { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error("github " + res.status);
    const list = await res.json();
    return (Array.isArray(list) ? list : [])
      .filter(f => f.type === "file" && /\.jsonl$/i.test(f.name))
      .map(f => ({ path: dirFor(slug) + "/" + f.name, sha: f.sha }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  // a doc's full event text: the legacy log first (it predates the folder),
  // then each version file in stamp order
  async function fetchDocText(d) {
    const paths = (d.legacy ? [d.legacy.path] : []).concat(d.files.map(f => f.path));
    if (!paths.length) return null;
    return joinParts(await Promise.all(paths.map(fetchRaw)));
  }

  // fetch ONE document by slug without the full tree: probe its folder and the
  // legacy file in parallel → { text, storage: "dir"|"file" } or null
  async function fetchLog(slug) {
    const [files, legacyText] = await Promise.all([
      listDocFiles(slug).catch(() => []),
      fetchRaw(filenameFor(slug))
    ]);
    const versionTexts = await Promise.all(files.map(f => fetchRaw(f.path)));
    const text = joinParts([legacyText].concat(versionTexts));
    if (text == null) return null;
    return { text, storage: files.length ? "dir" : "file" };
  }

  async function listArticles() {
    let docs;
    try {
      docs = await listDocs();
    } catch (e) {
      // listing down (rate limit, offline) → serve the cached index so the front page still paints
      const cached = loadIdxCache();
      return Object.values(cached).map(c => c.meta).filter(Boolean).sort(byNewest);
    }
    const cache = loadIdxCache();
    const live = {};
    const metas = await Promise.all(docs.map(async d => {
      // the cache key is every blob sha the doc is made of — any new version
      // file (or a legacy-file change) misses the cache and refolds
      const key = (d.legacy ? d.legacy.sha : "") + "|" + d.files.map(f => f.sha).join(",");
      const hit = cache[d.slug];
      if (hit && hit.key === key && hit.meta) { live[d.slug] = hit; return hit.meta; }
      try {
        const text = await fetchDocText(d);
        const { article } = foldLog(text);
        if (!article) return null;
        const meta = {
          slug: article.slug || d.slug, headline: article.headline, dek: article.dek, kicker: article.kicker,
          column: article.column, tags: article.tags, published: article.published, updated: article.updated,
          authors: article.authors, assignees: article.assignees, versions: article.versions.length, readMins: article.readMins,
          status: article.status, image: article.image,
          storage: d.files.length ? "dir" : "file",
          logPath: d.files.length ? dirFor(d.slug) : filenameFor(d.slug)
        };
        live[d.slug] = { key, meta };
        return meta;
      } catch (e) { return null; }
    }));
    saveIdxCache(live); // only live docs — deleted records drop out of the cache
    return metas.filter(Boolean).sort(byNewest);
  }
  function byNewest(a, b) {
    return String(b.published || "").localeCompare(String(a.published || "")) ||
           String(b.updated || "").localeCompare(String(a.updated || ""));
  }

  // Fill window.NPJ.FRONT from the committed record. Returns the metas.
  async function loadFront() {
    const metas = await listArticles();
    const item = (m) => ({ slug: m.slug, kicker: m.kicker, column: m.column || "", headline: m.headline, dek: m.dek, tags: m.tags || [], authors: m.authors || [], published: m.published, updated: m.updated, versions: m.versions, status: m.status, image: m.image || null });
    window.NPJ.FRONT = { lead: metas.length ? item(metas[0]) : null, secondary: metas.slice(1).map(item), briefs: [] };
    saveFront(window.NPJ.FRONT); // head start for the next visit (stale-while-revalidate)
    return metas;
  }

  // Optimistically patch one slug's status in the in-memory front index, so an
  // unpublish/republish reflects on the front page immediately — without waiting
  // for GitHub's git-tree listing (which lags a freshly committed version file by
  // a second or two). The next loadFront reconciles once the tree catches up.
  function patchFrontStatus(slug, status) {
    const F = window.NPJ && window.NPJ.FRONT; if (!F) return;
    const fix = (it) => (it && it.slug === slug) ? Object.assign({}, it, { status }) : it;
    if (F.lead) F.lead = fix(F.lead);
    if (Array.isArray(F.secondary)) F.secondary = F.secondary.map(fix);
  }

  /* Is this slug already in the committed record? Scans the loaded front index
     (loadFront fills it from listArticles, which lists every document folder —
     published OR unpublished). Returns that document's meta if found, else
     null, so the composer can tell a first publish from a republish/update of a
     piece that's already live without another network round-trip. The meta
     carries `status`, so a caller can also tell live ("published") from a piece
     that exists but is currently hidden ("unpublished"). */
  function publishedMeta(slug) {
    const s = slugify(slug);
    if (!s) return null;
    const F = window.NPJ && window.NPJ.FRONT;
    if (!F) return null;
    const all = [].concat(F.lead ? [F.lead] : [], Array.isArray(F.secondary) ? F.secondary : []);
    return all.find((a) => a && a.slug === s) || null;
  }

  // Fetch + fold one article; its sources join the global ledger so hover
  // cards, the source rail and the methods footer all resolve.
  async function loadArticle(slug) {
    const s = slugify(slug) || slug;
    const log = await fetchLog(s);
    if (log == null) return null;
    const { article, sources } = foldLog(log.text);
    if (article) {
      article.storage = log.storage;
      article.logPath = log.storage === "dir" ? dirFor(article.slug || s) : filenameFor(article.slug || s);
      Object.keys(sources).forEach(k => { window.NPJ.SOURCES[k] = Object.assign(window.NPJ.SOURCES[k] || {}, sources[k]); });
    }
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
  // <image-slot data-crop="s,x,y,ar"> → {s,x,y,ar}. Mirrors image-slot's own
  // parser; ar is the frame aspect at crop time so the cover crop reproduces.
  function parseCrop(str) {
    if (!str) return null;
    const p = String(str).split(",").map(Number);
    if (!p.length || !Number.isFinite(p[0])) return null;
    return {
      s: p[0],
      x: Number.isFinite(p[1]) ? p[1] : 0,
      y: Number.isFinite(p[2]) ? p[2] : 0,
      ar: Number.isFinite(p[3]) ? p[3] : 0,
    };
  }

  function htmlToBlocks(html) {
    const root = document.createElement("div"); root.innerHTML = html || "";
    let idSeq = 0;
    const newId = () => "cl-" + Date.now().toString(36) + "-" + (++idSeq);

    // Resolve a reusable citation record (window.NPJ.CITATIONS) to its quote.
    // data-quote stays synced on every span/sup, so this is a fallback: if a
    // marker lost its inline quote it can still be rebuilt from the registry.
    // Output token shape is unchanged either way.
    function quoteFromCiteIds(el, key) {
      try {
        const ids = String(el.getAttribute("data-cite-id") || "").split(/\s+/).filter(Boolean);
        const REG = (window.NPJ && window.NPJ.CITATIONS) || {};
        for (const id of ids) { const c = REG[id]; if (c && c.srcKey === key && c.quote) return c.quote; }
      } catch (e) {}
      return "";
    }

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
          if (tag === "span" && (c.classList.contains("eo-claim") || c.classList.contains("claim-src"))) {
            const isEo = c.classList.contains("eo-claim");
            const src = String(c.getAttribute("data-src") || "").split(/[\s,]+/).filter(Boolean);
            const stance = stanceNorm(c.getAttribute("data-stance"));
            // an OWNED claim — declared as the author's analysis/account/position
            // (data-stance, never a source). It used to flatten to plain prose at
            // publish; now it carries its stance into the body so the reader's
            // transparency lens can show it's grounded by declaration, not a cite.
            if (stance && !src.length) {
              flush();
              const owned = { c: plain(c), stance, id: c.getAttribute("data-id") || c.getAttribute("data-cid") || newId() };
              // an asserted absence carries the documented search it rests on (what
              // the author looked through, and found nothing) — that note IS its
              // grounding, so it rides the published token like a quote would.
              const aNote = (c.getAttribute("data-note") || "").trim();
              if (aNote) owned.note = aNote;
              // a void also carries WHICH kind of absence it is (removed / withheld /
              // silent / inaccessible / unrecorded / ambient) — that's what tells the
              // reader whether the absence is shown, located, or only inferred.
              if (stance === "absence") { const vk = vkindNorm(c.getAttribute("data-void-kind")); if (vk) owned.vkind = vk; }
              toks.push(owned);
              return;
            }
            // a SOURCED span in the edit surface's round-trip shape (eo-claim).
            if (isEo) {
              flush();
              if (src.length) {
                let q; try { q = JSON.parse(c.getAttribute("data-quotes") || "null") || undefined; } catch (e) {}
                // single-source spans carry the quote inline on data-quote; multi-source
                // spans carry the data-quotes map. Either way, backfill anything still
                // missing from the citation registry so reuse survives the round trip.
                const inlineQ = (c.getAttribute("data-quote") || "").trim();
                if (!q && (inlineQ || c.hasAttribute("data-cite-id"))) {
                  q = {}; src.forEach(k => { const v = (src.length === 1 && inlineQ) ? inlineQ : quoteFromCiteIds(c, k); if (v) q[k] = v; });
                  if (!Object.keys(q).length) q = undefined;
                }
                toks.push({ c: plain(c), src, id: c.getAttribute("data-id") || newId(), q });
              } else buf += plain(c);
              return;
            }
            // a SOURCED .claim-src from the live editor is a transparent wrapper:
            // recurse so its trailing <sup class="md-cite"> builds the citation
            // token — the long-standing path, unchanged.
            walk(c);
            return;
          }
          if (tag === "sup" && c.classList.contains("md-cite")) {
            // a manual footnote marker: its stable key rides on data-cite (the
            // visible text is just the number), and it's numbered + paired with
            // its "[^key]:" definition in the footnote pass below.
            if (c.hasAttribute("data-fn")) { flush(); const fk = (c.getAttribute("data-cite") || plain(c) || "").trim(); toks.push({ t: "sup", key: fk, text: plain(c) }); return; }
            const key = c.getAttribute("data-cite"); if (!key) return;
            // the pinned source-span: the exact words in the source backing this claim
            const quote = (c.getAttribute("data-quote") || "").trim() || quoteFromCiteIds(c, key);
            const prev = toks[toks.length - 1];
            if (!buf.trim() && prev && typeof prev === "object" && prev.c) {
              if (prev.src.indexOf(key) < 0) prev.src.push(key); // text[^a][^b] → one claim, two sources
              if (quote) { prev.q = prev.q || {}; prev.q[key] = quote; }
              return;
            }
            const { head, claim } = splitClaim(buf);
            if (head) toks.push(head);
            if (claim.trim()) toks.push({ c: claim, src: [key], id: newId(), q: quote ? { [key]: quote } : undefined });
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
    const fnRegionDefs = {};   // key → note text, read from the structured "Footnotes" list
    let headline = "", dek = "";
    Array.from(root.childNodes).forEach(node => {
      if (node.nodeType === 3) { const t = node.nodeValue.trim(); if (t) blocks.push({ type: "p", tokens: [t] }); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      const text = String(node.textContent || "").trim();
      // the editor's structured footnotes list (Substack-style) — not prose. Pull
      // each note off its <li data-fn-key> for the footnote pass to pair with the
      // inline markers, and skip it from normal block parsing.
      if ((tag === "ol" || tag === "ul") && node.classList && node.classList.contains("nr-fnotes")) {
        node.querySelectorAll("li[data-fn-key]").forEach(li => {
          const k = (li.getAttribute("data-fn-key") || "").trim();
          if (k && fnRegionDefs[k] == null) fnRegionDefs[k] = String(li.textContent || "").trim();
        });
        return;
      }
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
        // Two caption lines now: the caption (first figcaption) and the photo
        // credit (.cmp-credit). Selecting :not(.cmp-credit) keeps the caption
        // right whichever order they sit in, and old single-figcaption drafts
        // still match. The credit is markdown ([label](url)) like a profile bio,
        // rendered safely via npjRichText in the reader.
        const cap = node.querySelector("figcaption:not(.cmp-credit)");
        const capText = cap ? cap.textContent.trim() : "";
        const credEl = node.querySelector(".cmp-credit");
        const creditText = credEl ? credEl.textContent.trim() : "";
        const slot = node.querySelector("image-slot");
        const plainImg = node.querySelector("img");
        const isStore = (u) => !!(u && window.NpjMedia && window.NpjMedia.isStoreUrl(u));
        const isArchive = (u) => !!u && (!window.NpjArchiveCDN || window.NpjArchiveCDN.isMediaUrl(u));
        const okSrc = (u) => !!u && (window.NpjMedia ? window.NpjMedia.isPublishable(u) : isArchive(u));
        // the lead/banner image: the composer marks it with the nr-banner class
        // (or a data-banner flag / an eo-banner slot id). It rides in the body
        // like any image but carries banner:true, so the reader can lift it into
        // a hero above the piece and the front page can use it as the lead photo.
        const isBanner = !!(node.classList && node.classList.contains("nr-banner")) ||
          node.hasAttribute("data-banner") || (slot && /(^|[-_])banner/i.test(slot.getAttribute("id") || ""));
        // the empty banner figure carries a placeholder caption ("banner · …") — drop it
        const caption = /^banner(\s*·|\s|$)/i.test(capText) ? "" : capText;
        if (node.hasAttribute("data-eo-img")) {
          const s = plainImg && plainImg.getAttribute("src");
          if (s) { const block = { type: "img", src: s, caption }; if (creditText) block.credit = creditText; if (isBanner) block.banner = true; blocks.push(block); }
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
            const block = { type: "img", src, caption };
            if (creditText) block.credit = creditText;
            if (storeU && storeU !== src) block.store = storeU;
            if (isBanner) block.banner = true;
            // fill mode + crop chosen on the slot ride along so the reader and
            // the front page render the same framing the author saw (a banner
            // cropped 'cover', letterboxed 'contain', or stretched 'fill').
            const fit = (slot.getAttribute("fit") || "").toLowerCase();
            if (fit === "contain" || fit === "fill") block.fit = fit;
            const crop = parseCrop(slot.getAttribute("data-crop"));
            // only meaningful when there's an actual pan/zoom or a non-cover fit
            if (crop && crop.ar && (block.fit || crop.s !== 1 || crop.x || crop.y)) block.crop = crop;
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

    /* ---- footnotes: pair inline markers with their notes ----
       The composer drops a <sup data-fn> marker inline and keeps each note in a
       structured "Footnotes" list at the foot of the page (read above into
       fnRegionDefs). Here we number every marker by the order it's first
       referenced (1, 2, 3…) and gather one { type:"footnotes", notes } block the
       reader renders as linked endnotes. For back-compat we also lift any legacy
       "[^key]: text" definition paragraph (older drafts wrote notes as prose). */
    const FN_DEF = /^\s*\[\^([^\]\s]+)\]:\s*([\s\S]*)$/;
    const fnDefs = Object.assign({}, fnRegionDefs);   // key → note text (region wins)
    const defStripped = [];
    blocks.forEach(b => {
      if (b.type === "p") {
        const m = (b.tokens || []).map(tokenText).join("").match(FN_DEF);
        if (m) { const k = m[1].trim(); if (k && fnDefs[k] == null) fnDefs[k] = (m[2] || "").trim(); return; }
      }
      defStripped.push(b);
    });
    // a marker that landed alone in its own paragraph attaches to the text above
    const kept = mergeStrandedFootnotes(defStripped);
    const fnNum = {}; let fnSeq = 0;   // key → number, in first-reference order
    const numberMarker = (t) => {
      if (!t || t.t !== "sup") return;
      const k = (t.key || t.text || "").trim(); if (!k) return;
      if (!fnNum[k]) fnNum[k] = ++fnSeq;
      t.key = k; t.num = fnNum[k];
    };
    kept.forEach(b => { (b.tokens || []).forEach(numberMarker); (b.items || []).forEach(it => it.forEach(numberMarker)); });
    // A note is emitted for every REFERENCED key (a bare "[^key]:" with no marker
    // is dropped, like standard markdown); a referenced key with no definition
    // still gets a slot so its number and jump target exist.
    const notes = Object.keys(fnNum).sort((a, b) => fnNum[a] - fnNum[b])
      .map(k => ({ key: k, num: fnNum[k], text: fnDefs[k] || "" }));
    if (notes.length) kept.push({ type: "footnotes", notes });
    return { blocks: kept, headline, dek };
  }

  /* ---------------- body blocks → HTML (the post-publish edit surface) ---------------- */
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function tokensToHtml(tokens) {
    return (tokens || []).map(t => {
      if (typeof t === "string") return esc(t);
      if (t.c != null) {
        // an owned claim round-trips with its stance (and no source) so the edit
        // surface and the reader's transparency lens keep it; a sourced claim
        // keeps its data-src + quotes exactly as before.
        if (t.stance && (!t.src || !t.src.length))
          return '<span class="eo-claim" data-stance="' + esc(t.stance) + '"' + (t.note ? ' data-note="' + esc(t.note) + '"' : '') + (t.vkind && vkindNorm(t.vkind) ? ' data-void-kind="' + esc(t.vkind) + '"' : '') + ' data-id="' + esc(t.id || "") + '">' + esc(t.c) + "</span>";
        return '<span class="eo-claim" data-src="' + esc((t.src || []).join(" ")) + '" data-id="' + esc(t.id || "") + '"' + (t.q && Object.keys(t.q).length ? ' data-quotes="' + esc(JSON.stringify(t.q)) + '"' : "") + ">" + esc(t.c) + "</span>";
      }
      if (t.t === "br") return "<br/>";
      if (t.t === "strong") return "<strong>" + esc(t.text) + "</strong>";
      if (t.t === "em") return "<em>" + esc(t.text) + "</em>";
      if (t.t === "s") return "<s>" + esc(t.text) + "</s>";
      if (t.t === "code") return "<code>" + esc(t.text) + "</code>";
      if (t.t === "a") return '<a href="' + esc(t.href) + '">' + esc(t.text) + "</a>";
      if (t.t === "sup") { const k = t.key || t.text || ""; const label = (t.num != null ? t.num : t.text); return '<sup class="md-cite" data-fn="1" data-cite="' + esc(k) + '" contenteditable="false">' + esc(label) + "</sup>"; }
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
      // footnotes round-trip back to the composer as the structured "Footnotes"
      // list — one editable <li> per note, keyed so the inline markers (data-fn,
      // data-cite=key) above re-pair with them and renumberFootnotes keeps order.
      if (b.type === "footnotes") {
        const items = (b.notes || []).map(n =>
          '<li class="nr-fnote" data-fn-key="' + esc(n.key) + '" data-ph="Write the note…">' + esc(n.text || "") + "</li>").join("");
        return items ? '<ol class="nr-fnotes" data-fnotes="1">' + items + "</ol>" : "";
      }
      // editable image-slot (not a static <img>) so the edit surface can
      // replace it — a fresh drop uploads to the media store, then publish/save
      // moves it to archive.org. Primary src is the live media-store copy when
      // we have one (matrix-first), with the archive.org URL as data-alt.
      if (b.type === "img") {
        const primary = b.store || b.src || "";
        const alt = (b.store && b.src && b.src !== b.store) ? b.src : "";
        const cls = b.banner ? "cmp-embed nr-banner" : "cmp-embed";
        const slotId = (b.banner ? "eo-banner-" : "eo-img-") + bi;
        // round-trip the chosen fill mode + crop so re-editing keeps the framing
        const fitAttr = b.fit ? ' fit="' + esc(b.fit) + '"' : '';
        const cropAttr = (b.crop && b.crop.ar)
          ? ' data-crop="' + esc([b.crop.s, b.crop.x, b.crop.y, b.crop.ar].join(",")) + '"' : '';
        // every image box conforms to its image's shape in the editor — the
        // whole image, exactly as the reader/published page shows it — rather
        // than a fixed-height letterbox. The declared height below only acts as
        // the drop target while the slot is empty.
        const conformAttr = ' conform';
        // caption + credit are editable islands inside the non-editable figure
        // (the slot itself stays protected). The credit takes markdown links the
        // same way a contributor bio does — name / [outlet](https://…).
        const capHtml = '<figcaption class="cmp-cap np-mono" contenteditable="true" data-ph="Caption — what\'s happening in the photo" style="font-size:11px;margin-top:4px">' + esc(b.caption || "") + '</figcaption>';
        const credHtml = '<figcaption class="cmp-credit np-mono" contenteditable="true" data-ph="Credit — e.g. Jane Doe / [Reuters](https://reuters.com)" style="font-size:11px;margin-top:2px">' + esc(b.credit || "") + '</figcaption>';
        return '<figure contenteditable="false" class="' + cls + '"' + (b.banner ? ' data-banner="1"' : '') + '><image-slot id="' + slotId + '" src="' + esc(primary) + '"' + (alt ? ' data-alt="' + esc(alt) + '"' : '') + fitAttr + cropAttr + conformAttr + ' fitcontrol shape="rect" style="width:100%;height:300px;display:block" placeholder="Drop a photo or an archive.org link"></image-slot>' + capHtml + credHtml + "</figure>";
      }
      if (b.type === "embed") return '<figure data-embed-url="' + esc(b.url) + '" contenteditable="false"><a href="' + esc(b.url) + '">' + esc(b.url) + "</a>" + (b.caption ? "<figcaption>" + esc(b.caption) + "</figcaption>" : "") + "</figure>";
      return "";
    }).join("\n");
  }

  /* ---------------- publish + edit (through the same n8n webhook) ---------------- */
  // The publication-safe projection of a source record before it enters the
  // public, committed log. For an INTERVIEW (a conversation with a named or
  // anonymous source) the reporter's raw notes (rec.text) are private — only the
  // exact words PINNED as citations belong in the public record, and those ride
  // on the body tokens, not here. So we strip the transcript. Every other source
  // type passes through unchanged. Defensive: works even if NpjInterview is the
  // single source of truth for the rule, with a local fallback if it's absent.
  function publishableSource(rec) {
    if (!rec) return rec;
    if (window.NpjInterview && window.NpjInterview.redactForPublish) return window.NpjInterview.redactForPublish(rec);
    if (rec.type === "interview") { const o = Object.assign({}, rec); o.text = ""; return o; }
    return rec;
  }

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
    Object.keys(usedKeys).forEach(k => { if (window.NPJ.SOURCES[k]) sources[k] = publishableSource(window.NPJ.SOURCES[k]); });
    const actor = o.actor || null;
    const mxids = (arr) => (Array.isArray(arr) ? arr : []).map(s => String(s || "").trim()).filter(s => /^@[^:]+:[^:]+$/.test(s));
    // Byline: authors default to the publisher; "Unsigned" is an explicit override
    // that ships with NO credited author. Editors are an optional separate credit.
    // Either way the ACTOR stays an assignee, so they can always edit after publish.
    const unsigned = o.byline === "Unsigned" || o.unsigned === true;
    const authors = o.authors != null ? mxids(o.authors) : (actor ? [actor] : []);
    const operand = {
      slug: o.slug || slugify(headline || o.headline) || "untitled",
      headline: headline || o.headline || "Untitled",
      dek: dek || o.dek || "",
      column: c.column || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      authors: unsigned ? [] : authors,
      editors: mxids(o.editors),
      byline: unsigned ? "Unsigned" : (typeof o.byline === "string" ? o.byline : ""),
      assignees: actor ? [actor] : [], // the publisher can edit after publish; admin always can
      published: today(),
      body: blocks,
      sources
    };
    // composition provenance rides the genesis when the editor captured it
    // (aggregate counts only — see app/composition.js); harmless when absent
    if (o.composition && typeof o.composition === "object") operand.composition = o.composition;
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
  /* Every commit below CREATES a brand-new version file in the document's
     folder — no write ever targets an existing file, so GitHub's
     update-with-SHA path (the one that kept rejecting commits) is never hit.
     `mode:"overwrite"` is kept for webhook compatibility: on a path that
     doesn't exist it is simply a create. Re-publishing a slug lands a newer
     INS file and the fold restarts from it; the old versions stay put. */
  function publishGenesis({ slug, line, token, message, filename }) {
    // `filename` may be pre-generated by the caller so a retry re-POSTs the
    // exact same path instead of minting a second version file
    return post({ filename: filename || versionFilenameFor(slug, "ins"), mode: "overwrite", contentRaw: line + "\n", message: message || ("publish: " + slug) }, token);
  }
  // One REC event in a new version file — the edit-after-publish path.
  async function appendEdit({ slug, operand, actor, note, token, message }) {
    const line = editLine(slug, operand, actor, note);
    const filename = versionFilenameFor(slug, "rec");
    const res = await post({ filename, mode: "overwrite", contentRaw: line + "\n", message: message || ("edit: " + slug) }, token);
    return { res, line, sha: lineSha(line), filename };
  }
  /* A generic event writer — one NEW version file carrying any EO op. Used by
     the feedback layer (app/feedback.js) to land reader EVA deposits in the
     same auditable folder as the article's own events. `schema` overrides the
     event's `v` so feedback lines self-identify (npj/feedback-eo/1) while still
     folding harmlessly through the article reader (EVA never touches state). */
  async function appendEvent({ slug, op, operand, actor, token, note, extra, message, schema }) {
    const head = { v: schema || SCHEMA, op, target: "article/" + slug, ts: nowIso(), actor: actor || null, operand: operand || {} };
    if (note) head.note = note;
    const line = JSON.stringify(Object.assign(head, extra || {}));
    const filename = versionFilenameFor(slug, op);
    const res = await post({ filename, mode: "overwrite", contentRaw: line + "\n", message: message || (String(op).toLowerCase() + ": " + slug) }, token);
    return { res, line, sha: lineSha(line), filename };
  }

  /* Every event in a document's folder, folded once — the article reader keeps
     only the article, but feedback needs the raw EVA deposits riding alongside
     it. Returns { events, base_sha } (base_sha is the current article version,
     used to flag a suggestion made against a since-superseded draft as stale). */
  async function fetchEvents(slug) {
    const s = slugify(slug) || slug;
    const log = await fetchLog(s);
    if (log == null) return { events: [], base_sha: null };
    const folded = foldLog(log.text);
    return { events: folded.events || [], base_sha: folded.article ? folded.article.base_sha : null };
  }

  // Unpublish / republish — one REC version file carrying only the status.
  // Unpublish just takes the piece off the site: nothing is deleted, the whole
  // folder (every prior version) stays in GitHub, and the act of hiding it is
  // itself recorded as one more event in the record. Authorized exactly like
  // any other edit (the webhook re-verifies the Matrix token); the UI
  // restricts the action to admins.
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

  root.NpjArticles = {
    SCHEMA, DIR, RAW_BASE, rawUrl, filenameFor, dirFor, versionFilenameFor, publishEndpoint,
    foldLog, plainText, readMins, lineSha,
    META_STANDARD, checkMeta,
    snapshotOperand, revertOperand,
    listArticles, loadFront, patchFrontStatus, publishedMeta, loadArticle, primeFront, saveFront,
    htmlToBlocks, blocksToHtml, tokensToHtml,
    genesisLine, editLine, genesisFromContent, publishableSource, publishGenesis, appendEdit, appendEvent, fetchEvents, setArticleStatus,
    saveReceipt, getReceipt
  };
  // Paint the front page from the last-known line-up the moment this script
  // runs, so a returning visitor never waits on the git-tree API for first
  // paint. Browser-only; loadFront() reconciles against the live record after.
  if (typeof window !== "undefined") primeFront();

  // node tests require() the pure fold/revert helpers; the browser path is
  // unchanged (root === window). No DOM/network runs at load time.
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjArticles;
})(typeof window !== "undefined" ? window : globalThis);
