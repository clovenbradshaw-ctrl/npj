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
 *   {type:'h2'|'h3', text} · {type:'pull', text, kind?:'block'|'pull', align?:'center'|'right', attribution?, marks?:[{t:'sup',key,num}]} · {type:'hr'}
 *   {type:'ul'|'ol', items:[tokens[]]} · {type:'img', src, caption?}
 *   {type:'gallery', images:[{src, store?, caption?, credit?, description?, fit?, crop?}], caption?}
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
  const API_TREE = "https://api.github.com/repos/" + OWNER_REPO + "/git/trees/main?recursive=1";
  const BLOB_BASE = "https://github.com/" + OWNER_REPO + "/blob/main"; // human-facing "view the log" link
  // Bump the version suffix whenever the cached meta SHAPE changes — entries are
  // cache-busted by blob sha, so a meta cached under an older code version (e.g.
  // before `excerpt` was folded in) keeps being served for an unchanged article.
  // gh2: added the cover `excerpt` (the story's opening, pulled into the cover).
  // gh4: added `releaseAt` — a scheduled piece's release instant (ISO). The meta
  // carries the raw timestamp, not a baked "scheduled" flag, so the front page
  // re-decides gating against the wall-clock on every paint (a cached meta whose
  // blob sha never changes still goes live the moment its release time passes).
  const IDX_CACHE_KEY = "npj_articles_idx_gh4"; // GitHub model: entries keyed by slug, cache-busted by blob sha
  const FRONT_CACHE_KEY = "npj_front_gh4";       // last front-page line-up, painted instantly on the next visit
  const RECEIPT_KEY = "npj_publish_receipts_v1";
  const DEFAULT_ENDPOINT = "https://n8n.intelechia.com/webhook/site/publish-npj";
  // Open reader feedback rides a SEPARATE, write-only webhook: it can only CREATE
  // an *-eva-*.jsonl file in an article's folder, so any verified Matrix user can
  // submit a suggestion without the role/assignee gate the publish webhook keeps.
  // A merge is still a REC through publish-npj. See backend/npj-suggest.n8n.json.
  const DEFAULT_SUGGEST_ENDPOINT = "https://n8n.intelechia.com/webhook/site/suggest-npj";
  const COMMIT_MS = 120000; // a stalled publish webhook is aborted after this, never left hanging

  /* ---------------- GitHub is the home of the record ----------------
     One append-only file per document — articles/<slug>.jsonl — committed
     through the Matrix-gated /site/publish-npj webhook: it re-verifies the
     token, reads the current file, appends the line, and commits it back to
     GitHub (the per-article assignee gate runs server-side against the genesis
     event). The front page lists articles/*.jsonl in ONE git-tree call; each
     article body reads from the GitHub raw CDN. No archive.org, no separate
     manifest — the repository directory IS the index, and the commit IS the
     record. (Media still freezes to a public host at publish; only the article
     TEXT + line-up live here.) */

  const nowIso = () => new Date().toISOString();
  const today = () => nowIso().slice(0, 10);
  const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

  function publishEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.endpoint) return c.endpoint; } catch (e) {}
    return DEFAULT_ENDPOINT;
  }
  // The open-feedback (suggest) webhook. Overridable beside the publish endpoint;
  // defaults next to it on the same n8n host.
  function suggestEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.suggestEndpoint) return c.suggestEndpoint; } catch (e) {}
    return DEFAULT_SUGGEST_ENDPOINT;
  }
  // one append-only log per document
  const filenameFor = (slug) => DIR + "/" + slug + ".jsonl";
  const rawUrl = (slug) => RAW_BASE + "/" + filenameFor(slug);   // raw CDN — the reader fetches this
  const blobUrl = (slug) => BLOB_BASE + "/" + filenameFor(slug); // GitHub UI — the "view the log" link

  /* djb2 → 7 hex chars. Not crypto — just a stable, human-quotable version id
     derived from the event line itself, so every reader derives the same one. */
  function lineSha(line) {
    let h = 5381;
    for (let i = 0; i < line.length; i++) h = ((h << 5) + h + line.charCodeAt(i)) >>> 0;
    return ("0000000" + h.toString(16)).slice(-7);
  }

  /* ---------------- one event = one new file ----------------
     The genesis (first publish) anchors a slug at articles/<slug>.jsonl. Every
     LATER event — an edit, a status flip, a republish, a reader deposit — is
     written as its OWN brand-new file under articles/<slug>/, never an append to
     or overwrite of a prior file. So every write after the first is a fresh
     create (the GitHub path that actually commits), and the append-only log is
     reconstructed on read by folding the genesis + every event file in filename
     order. The stamp is sortable and carries milliseconds, so two edits in the
     same second still order deterministically and never collide on a path. */
  const eventDir = (slug) => DIR + "/" + slug;
  function eventPath(slug, op, line) {
    const stamp = nowIso().replace(/[-:.]/g, "");           // 2026-06-27T16:05:03.104Z → 20260627T160503104Z
    return eventDir(slug) + "/" + stamp + "-" + String(op || "rec").toLowerCase() + "-" + lineSha(line) + ".jsonl";
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
      if (b.type === "gallery") return (b.images || []).map(im => (im && im.caption) || "").filter(Boolean).concat(b.caption ? [b.caption] : []).join("\n");
      if (b.type === "embed") return b.url || "";
      if (b.type === "code" || b.type === "verse") return b.text || "";
      return "";
    }).filter(Boolean).join("\n\n");
  }
  function readMins(body) {
    const words = (plainText(body).match(/\S+/g) || []).length;
    return Math.max(1, Math.round(words / 220));
  }
  // The opening of the article's prose — the first few body paragraphs, joined
  // (\n\n between them) and capped. Used by the front-page cover to "pull
  // through" the start of the story into the text column beside the photo,
  // filling the space when the headline + standfirst alone are shorter than the
  // image. Only real paragraph prose is taken (no headings, captions, embeds),
  // and the cap is generous on purpose — the cover clips it to the photo's
  // height, so we just need enough to overflow.
  function excerptOf(body, max) {
    max = max || 520;
    if (!Array.isArray(body)) return "";
    const paras = [];
    for (const b of body) {
      if (b && b.type === "p") {
        const t = (b.tokens || []).map(tokenText).join("").replace(/\s+/g, " ").trim();
        if (t) paras.push(t);
      }
      if (paras.join(" ").length >= max) break;
    }
    let s = paras.join("\n\n");
    if (s.length > max) {
      s = s.slice(0, max);
      const cut = s.lastIndexOf(" ");
      if (cut > max * 0.6) s = s.slice(0, cut);
      s = s.replace(/[\s,;:.–—-]+$/, "") + "…";
    }
    return s;
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

  /* ---------------- never split a word across a paragraph break ----
     A paragraph is the unit the author wrote; the reader, the live Preview
     and the Substack export each render it as its own <p>. An accidental
     block split — a stray Enter/paste inside the contentEditable, or an
     older record saved that way — can cut a paragraph mid-WORD: "…public
     bench. B" then a fresh paragraph "ut the incursion…", which prints as
     two paragraphs with a blank line wedged into the middle of "But". The
     seam is unmistakable: the paragraph above ends on a word character with
     NO trailing space and the one below OPENS with a lowercase letter —
     prose never starts a new paragraph lower-case mid-word. Stitch those
     two blocks back into one so the preview shows exactly what was written.

     Conservative by design: it fires ONLY on that lowercase-into-word-char
     seam, so a real paragraph break (the next opens with a capital, or the
     previous ended on a space, punctuation or a hard <br>) is never touched.
     Idempotent and non-mutating — the merged block is a fresh clone, the two
     seam strings are joined with NO separator (it's one word), and the read
     model + export can each run it without corrupting a shared body. */
  function mergeSplitWords(blocks) {
    const src = Array.isArray(blocks) ? blocks : [];
    const isBr = (t) => !!t && typeof t === "object" && t.t === "br";
    const fullText = (b) => (b.tokens || []).map(tokenText).join("");
    const out = [];
    src.forEach(b => {
      const prev = out[out.length - 1];
      const pTok = prev && prev.tokens, bTok = b && b.tokens;
      if (prev && prev.type === "p" && b && b.type === "p" &&
          pTok && pTok.length && bTok && bTok.length &&
          !isBr(pTok[pTok.length - 1]) && !isBr(bTok[0]) &&
          /[A-Za-z0-9]$/.test(fullText(prev)) && /^[a-z]/.test(fullText(b))) {
        const merged = pTok.slice(), add = bTok.slice();
        // join the two seam tokens into one string when both are plain text, so
        // the rebuilt word ("B" + "ut" → "But") is a single token; otherwise the
        // tokens simply sit adjacent (rendering concatenates them all the same).
        if (typeof merged[merged.length - 1] === "string" && typeof add[0] === "string") merged[merged.length - 1] += add.shift();
        out[out.length - 1] = Object.assign({}, prev, { tokens: merged.concat(add) });
        return;
      }
      out.push(b);
    });
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
  const FOLD_FIELDS = ["slug", "headline", "dek", "column", "tags", "authors", "editors", "byline", "assignees", "published", "releaseAt", "body", "status", "composition", "definitions"];

  /* ---------------- scheduled publish ----------------
     A piece can be committed to the record now but held off the front page until
     a chosen instant — its RELEASE. `releaseAt` is that instant as an ISO string;
     `published` is set to its calendar date, so the piece carries its future
     release as its shown date. Gating is decided against the live wall-clock (not
     baked into the cached meta), so a scheduled piece goes live on its own the
     moment the time passes — no re-commit, no rebuild. A releaseAt already in the
     past is just a normal live publish (the helper returns "" and the caller dates
     it today()). */
  function scheduledFuture(releaseAt) {
    if (!releaseAt) return false;
    const t = Date.parse(releaseAt);
    return Number.isFinite(t) && t > Date.now();
  }
  // The calendar date (YYYY-MM-DD) a release instant falls on, in the viewer's
  // own timezone — so the shown release date matches the date the author picked
  // on their datetime field, not a UTC-shifted one.
  function releaseDate(releaseAt) {
    const d = new Date(releaseAt);
    if (isNaN(d.getTime())) return today();
    const p = (n) => (n < 10 ? "0" : "") + n;
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
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
    // failing any standalone photo, the first image of the first carousel still
    // gives the front page a lead thumbnail (it's never lifted into a hero).
    const firstGalleryImg = (() => {
      const g = (Array.isArray(state.body) ? state.body : []).find(b => b && b.type === "gallery" && Array.isArray(b.images) && b.images.some(im => im && im.src));
      return g ? g.images.find(im => im && im.src) : null;
    })();
    const bannerBlock = imgBlocks.find(b => b.banner) || imgBlocks[0] || firstGalleryImg || null;
    const article = {
      slug: state.slug || "untitled",
      kicker: state.column || "Published",
      column: state.column || "",
      headline: state.headline,
      dek: state.dek || "",
      tags: Array.isArray(state.tags) ? state.tags : [],
      // the piece's glossary — terms it leans on, each bound to a short
      // definition (extracted by eoreader4 or written by hand). Drawn into the
      // collective glossary across the published record (app/definitions.js).
      definitions: Array.isArray(state.definitions) ? state.definitions : [],
      authors: Array.isArray(state.authors) ? state.authors : [],
      // editors credited in the byline (optional, separate from the authors line);
      // byline is an optional override string ("Unsigned" suppresses author names)
      editors: Array.isArray(state.editors) ? state.editors : [],
      byline: typeof state.byline === "string" ? state.byline : "",
      assignees: Array.isArray(state.assignees) ? state.assignees : [],
      published: state.published || (versions.length ? String(versions[versions.length - 1].ts).slice(0, 10) : today()),
      // a scheduled release: the instant the piece comes off the front-page gate.
      // `scheduled` is computed against the wall-clock at fold time — but consumers
      // (the front page) re-decide from `releaseAt` on every paint, so a stale-cached
      // fold can never keep a released piece hidden.
      releaseAt: typeof state.releaseAt === "string" ? state.releaseAt : null,
      scheduled: scheduledFuture(state.releaseAt),
      updated: versions.length ? String(versions[0].ts).slice(0, 10) : null,
      base_sha: versions.length ? versions[0].sha : "0000000",
      readMins: readMins(state.body),
      // "unpublished" hides the piece from the site (front page, reader, docs)
      // for everyone but admins; the log itself is never removed — a later
      // REC{status:"published"} brings it back. Absent field → published.
      status: state.status === "unpublished" ? "unpublished" : "published",
      image: bannerBlock ? {
        src: bannerBlock.src, store: bannerBlock.store || "", caption: bannerBlock.caption || "",
        credit: bannerBlock.credit || "", description: bannerBlock.description || "",
        banner: !!bannerBlock.banner, fit: bannerBlock.fit || "", crop: bannerBlock.crop || null,
        // a not-yet-uploaded lead photo (preview only) carries the flag through so
        // the reader's hero can mark it "won't publish yet"
        local: !!bannerBlock.local
      } : null,
      // normalize on read too, so a draft already saved with a stranded marker
      // or a word cut across a paragraph break renders right for every consumer
      // (reader + live Preview + Substack export) without needing a re-save
      body: mergeSplitWords(mergeStrandedFootnotes(Array.isArray(state.body) ? state.body : [])),
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

  /* ===================== GitHub read layer =====================
     Article bodies read from the raw CDN; the front-page line-up is ONE git-tree
     call listing articles/*.jsonl. GitHub is the whole record now — there is no
     archive.org read and no separate manifest. */

  // The cb param busts the raw CDN's ~5 min cache (including cached 404s) so a
  // fresh commit reads back immediately.
  async function fetchRaw(path) {
    try {
      const res = await fetch(RAW_BASE + "/" + path + "?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) { return null; }
  }

  /* One git-tree call lists every document at once (articles/<slug>.jsonl), no
     matter how many there are — one API request, then each body is read (and
     folded) from the raw CDN only when its blob sha is new. */
  // genesis anchor: articles/<slug>.jsonl ·  event file: articles/<slug>/<stamp>-<op>-<hash>.jsonl
  const DOC_RE = /^articles\/([A-Za-z0-9][A-Za-z0-9-]*)\.jsonl$/;
  const EVT_RE = /^articles\/([A-Za-z0-9][A-Za-z0-9-]*)\/[^/]+\.jsonl$/;
  /* ONE git-tree call lists every file at once; we group them by slug into the
     genesis + its event files. Each document is its genesis anchor followed by
     every event file in filename (timestamp) order — the exact order foldLog
     must replay them in. `key` is the combined blob shas, so adding ANY new
     event file changes the key and the slug refolds; an unchanged document is
     served from cache. A slug with event files but no genesis anchor is skipped
     (an orphan can't define a document). */
  async function listDocs(signal) {
    const res = await fetch(API_TREE, { headers: { Accept: "application/vnd.github+json" }, signal });
    if (!res.ok) throw new Error("github " + res.status);
    const tree = ((await res.json()) || {}).tree || [];
    const bySlug = {};
    tree.forEach(e => {
      if (!e || e.type !== "blob") return;
      let m = DOC_RE.exec(e.path);
      if (m) { (bySlug[m[1]] = bySlug[m[1]] || { events: [] }).genesis = { path: e.path, sha: e.sha }; return; }
      m = EVT_RE.exec(e.path);
      if (m) (bySlug[m[1]] = bySlug[m[1]] || { events: [] }).events.push({ path: e.path, sha: e.sha });
    });
    return Object.keys(bySlug).map(slug => {
      const g = bySlug[slug];
      if (!g.genesis) return null;
      const events = g.events.slice().sort((a, b) => String(a.path).localeCompare(String(b.path)));
      const files = [g.genesis].concat(events);
      return { slug, files, key: files.map(f => f.sha).join("·") };
    }).filter(Boolean);
  }

  // Every file that makes up one document's log, genesis first then events in
  // timestamp order — the read-side counterpart of the one-event-one-file write
  // path. Falls back to the genesis alone if the tree can't be listed.
  async function docPaths(slug) {
    const s = slugify(slug) || slug;
    try { const d = (await listDocs()).find(x => x.slug === s); if (d) return d.files.map(f => f.path); } catch (e) {}
    return [filenameFor(s)];
  }
  async function gatherLog(slug) {
    const texts = await Promise.all((await docPaths(slug)).map(p => fetchRaw(p)));
    return texts.filter(t => t != null).join("\n");
  }

  function byNewest(a, b) {
    return String(b.published || "").localeCompare(String(a.published || "")) ||
           String(b.updated || "").localeCompare(String(a.updated || ""));
  }

  /* List + fold every document into the front-page metas. Cached by blob sha, so
     an unchanged doc never refolds; a listing failure (rate limit, offline)
     serves the last cached index so the front page still paints. The front page
     paints from these metas WITHOUT waiting on any article body. */
  async function listArticles() {
    let docs;
    try { docs = await listDocs(); }
    catch (e) {
      const cached = loadIdxCache();
      return Object.values(cached).map(c => c.meta).filter(Boolean).sort(byNewest);
    }
    const cache = loadIdxCache();
    const live = {};
    const metas = await Promise.all(docs.map(async d => {
      // the cache key is the combined blob shas — a new genesis OR a new event
      // file changes the key, so the slug misses the cache and refolds; an
      // unchanged document is served instantly
      const hit = cache[d.slug];
      if (hit && hit.key === d.key && hit.meta) { live[d.slug] = hit; return hit.meta; }
      const texts = await Promise.all(d.files.map(f => fetchRaw(f.path)));
      const text = texts.filter(t => t != null).join("\n");
      if (!text) return null;
      const { article } = foldLog(text);
      if (!article) return null;
      const meta = {
        slug: article.slug || d.slug, headline: article.headline, dek: article.dek, kicker: article.kicker,
        column: article.column, tags: article.tags, published: article.published, releaseAt: article.releaseAt, updated: article.updated,
        authors: article.authors, editors: article.editors, byline: article.byline, assignees: article.assignees, versions: article.versions.length, base_sha: article.base_sha, readMins: article.readMins,
        status: article.status, image: article.image, excerpt: excerptOf(article.body),
        storage: "github", logPath: blobUrl(d.slug)
      };
      live[d.slug] = { key: d.key, meta };
      return meta;
    }));
    saveIdxCache(live); // only live docs — a removed file drops out of the cache
    return metas.filter(Boolean).sort(byNewest);
  }

  // Fill window.NPJ.FRONT from the committed record. Returns the metas. Carries
  // each piece's `status` so the front page + reader can hide an unpublished one.
  async function loadFront() {
    const metas = await listArticles();
    const item = (m) => ({ slug: m.slug, kicker: m.kicker, column: m.column || "", headline: m.headline, dek: m.dek, tags: m.tags || [], authors: m.authors || [], editors: m.editors || [], byline: m.byline || "", assignees: m.assignees || [], published: m.published, releaseAt: m.releaseAt || null, updated: m.updated, versions: m.versions, base_sha: m.base_sha, readMins: m.readMins, status: m.status, image: m.image || null, excerpt: m.excerpt || "" });
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

  // Drop one or more slugs from the in-memory front index right away, so an
  // admin "remove from the record" reflects on the front page without waiting on
  // the rewritten manifest to propagate through archive.org. If the lead is one
  // of the removed pieces, the next surviving piece is promoted to lead.
  // loadFront() reconciles against the live manifest afterwards.
  function dropFromFront(slugs) {
    const F = window.NPJ && window.NPJ.FRONT; if (!F) return;
    const drop = new Set((Array.isArray(slugs) ? slugs : [slugs]).map(s => slugify(s) || s).filter(Boolean));
    if (!drop.size) return;
    let sec = (Array.isArray(F.secondary) ? F.secondary : []).filter(it => it && !drop.has(it.slug));
    let lead = (F.lead && !drop.has(F.lead.slug)) ? F.lead : null;
    if (!lead && sec.length) { lead = sec[0]; sec = sec.slice(1); } // promote the next piece up
    F.lead = lead; F.secondary = sec;
    try { saveFront(F); } catch (e) {}
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

  // Fetch + fold one article from the GitHub raw CDN (articles/<slug>.jsonl).
  // Its sources join the global ledger so hover cards, the source rail and the
  // methods footer all resolve.
  async function loadArticle(slug) {
    const s = slugify(slug) || slug;
    const text = await gatherLog(s);
    if (!text) return null;
    const { article, sources } = foldLog(text);
    if (article) {
      article.storage = "github";
      article.logPath = blobUrl(article.slug || s);
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

  function htmlToBlocks(html, opts) {
    // preview: keep a photo that's still a session data: URL (its upload hasn't
    // landed/failed) so the editor's Preview shows what the author placed. Off for
    // the real publish, so a data: URL never rides into the committed record.
    const preview = !!(opts && opts.preview);
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
      // The READING text of a claim/owned span, with any nested citation/footnote
      // MARKER sups (<sup class="md-cite">) stripped. A marker prints only its
      // number — it is never part of the words. Normally the marker sits AFTER the
      // claim span (a sibling that folds via the md-cite branch below), but when the
      // editor nests it INSIDE the span (a cite-broken artifact), the marker's digits
      // ride along in textContent and surface as a stray "23" in the published prose —
      // in both the preview and the live read, which share this fold. Recursive (not
      // cloneNode/querySelector) so it works on the test shim's minimal node too.
      const isCiteSup = (el) => el && el.nodeType === 1 && el.tagName &&
        el.tagName.toLowerCase() === "sup" && el.classList && el.classList.contains("md-cite");
      const claimText = (n) => {
        if (!n) return "";
        if (n.nodeType === 3) return String(n.nodeValue || "");
        if (n.nodeType !== 1 || isCiteSup(n)) return "";
        let s = ""; (n.childNodes || []).forEach(c => { s += claimText(c); }); return s;
      };
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
              const owned = { c: claimText(c), stance, id: c.getAttribute("data-id") || c.getAttribute("data-cid") || newId() };
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
            // a SOURCED claim span. Two shapes, one rule: the SPAN ITSELF is the
            // claim boundary, so the WHOLE wrapped text becomes the claim token —
            //   eo-claim   — the post-publish edit surface's round-trip shape.
            //   .claim-src — the live editor's wrapper. bindRangeToSource wraps the
            //     author's exact selection (which may be more than one sentence) and
            //     drops the numbered <sup class="md-cite"> as the NEXT sibling.
            // Honouring the span keeps the published/preview claim identical to what
            // the editor and the grounding workspace highlight. (The old path recursed
            // into .claim-src and let the trailing marker run splitClaim, which shrank
            // a multi-sentence selection to just its last sentence — so the
            // transparency lens grounded less than the prose editor showed.) The
            // trailing marker(s) still merge their key + pinned quote onto this token
            // via the md-cite branch below (buf is empty → it folds into prev).
            if (isEo || src.length) {
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
                toks.push({ c: claimText(c), src, id: c.getAttribute("data-id") || c.getAttribute("data-cid") || newId(), q });
              } else buf += claimText(c);
              return;
            }
            // a .claim-src with no source of its own (a transient/owned-forming
            // wrapper) is transparent: recurse so its contents — and any trailing
            // <sup class="md-cite"> — fold the long-standing way.
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

    // A raw <iframe>/<video>/<audio> — pasted into the HTML source view, or in a
    // figure that lost its data-embed-url — becomes an embed block keyed by its
    // src. The resolver re-derives the player on render, so the src is all we
    // store; a panel embed (Drive/Docs/archive) also keeps its pixel height.
    const embedFromMediaEl = (el) => {
      if (!el) return null;
      let src = el.getAttribute("src") || "";
      if (!src) { const s0 = el.querySelector && el.querySelector("source[src]"); if (s0) src = s0.getAttribute("src") || ""; }
      if (!/^https?:\/\//.test(src)) return null;
      const eb = { type: "embed", url: src };
      const r = window.NpjEmbed && window.NpjEmbed.resolve(src);
      if (r && r.panel) {
        const sh = (el.getAttribute("style") || "").match(/height:\s*(\d+)/i);
        const h = sh ? parseInt(sh[1], 10) : parseInt(el.getAttribute("height") || "0", 10);
        if (h > 0) eb.height = h;
      }
      return eb;
    };

    const blocks = [];
    const fnRegionDefs = {};   // key → note text, read from the structured "Footnotes" list
    let headline = "", dek = "";
    // Block-level tags that must never be collapsed into a paragraph. A bare
    // contentEditable <div> wrapping any of these — the browser wraps pasted runs
    // and Enter-split lines in <div>, and an inserted image/embed figure can land
    // inside one — would otherwise be read as a single paragraph, silently
    // DROPPING the nested <figure> from BOTH the preview and the publish build.
    // The live editor still renders the slot, so the photo "shows in the editor
    // but not the preview." Recurse into such a div so its blocks are parsed in
    // place. (A managed component div — the poll .cmp-widget — is handled above
    // and returns before this; an inline-only line has no block child and falls
    // through to the paragraph path below.)
    const BLOCK_TAGS = /^(?:figure|image-slot|iframe|video|audio|h1|h2|h3|h4|h5|h6|blockquote|ul|ol|hr|pre|table|p|div)$/;
    const hasBlockChild = (el) => {
      for (const c of (el.childNodes || [])) {
        if (c.nodeType !== 1) continue;
        if (BLOCK_TAGS.test(c.tagName.toLowerCase())) return true;
        if (hasBlockChild(c)) return true;
      }
      return false;
    };
    const emitNode = (node) => {
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
      if (tag === "blockquote") {
        // A footnote can ride the END of a pull-quote. The quote's text is a plain
        // string (no inline tokens), so lift the marker onto the block as `marks` and
        // keep `text` clean: it renders as a trailing superscript instead of stranding
        // on its own line (the marker references the quote, not the paragraph below).
        const marks = [];
        const quoteText = (n) => {
          let s = "";
          (n.childNodes || []).forEach(c => {
            if (!c) return;
            if (c.nodeType === 3) { s += c.nodeValue || ""; return; }
            if (c.nodeType !== 1) return;
            if (c.tagName && c.tagName.toLowerCase() === "sup" && c.classList && c.classList.contains("md-cite")) {
              // A footnote marker (data-fn) lifts onto `marks` and renders as a
              // trailing superscript. An inline CITATION marker (no data-fn) is
              // source chrome with no home in a pull — the quote text is a plain
              // string, with no claim/source apparatus to merge it onto — so it is
              // dropped from the text entirely. Either way the marker's printed
              // number must never ride into the quote as a stray "…pariatur.86".
              if (c.hasAttribute && c.hasAttribute("data-fn")) {
                const fk = (c.getAttribute("data-cite") || c.textContent || "").trim();
                if (fk) marks.push({ t: "sup", key: fk, text: String(c.textContent || "").trim() });
              }
              return;   // the marker leaves the quote TEXT (a sup is never prose)
            }
            s += quoteText(c);
          });
          return s;
        };
        const qt = quoteText(node).trim();
        // Two quote flavours share the <blockquote> tag: a bordered BLOCK quote
        // (the default, for quoting a passage) and a large display PULL quote
        // (class np-pull, Substack-style). Either can carry a justification —
        // execCommand writes it as inline text-align, on the blockquote itself or
        // on a child block — which we lift onto `align` so the reader honours it.
        const isPull = !!(node.classList && node.classList.contains("np-pull"));
        let align = (node.style && node.style.textAlign) || node.getAttribute("align") || "";
        if (!/^(?:center|right|left)$/.test(align)) {
          const c = node.querySelector("div,p"); const cta = c && c.style && c.style.textAlign;
          align = /^(?:center|right|left)$/.test(cta || "") ? cta : "";
        }
        if (qt) {
          const pull = { type: "pull", text: qt, attribution: "", kind: isPull ? "pull" : "block" };
          if (align && align !== "left") pull.align = align;
          // A quote can be GROUNDED: the author wrapped it (or part of it) in a
          // claim-src / eo-claim span carrying a source + pinned passage, or
          // declared it an owned assertion (a stance / a documented void). The
          // plain `text` above keeps excerpts and exports simple, but we ALSO keep
          // the inline tokens so the reader renders the quote as a live citation —
          // the hover/tap source card, the lens tint, the footnote marker — instead
          // of inert prose (the bug: "no popup or citation even though it's in the
          // code"). inlineTokens already folds a trailing <sup class="md-cite"> onto
          // the claim (a footnote becomes a {t:sup} token; a cite marker merges its
          // key/quote), so when tokens carry the grounding we don't also set `marks`
          // — that would double the footnote. A PLAIN quote keeps the lean
          // text + marks path, byte-for-byte as before.
          const toks = inlineTokens(node);
          const grounded = toks.some(t => t && typeof t === "object" &&
            (t.stance || (Array.isArray(t.src) && t.src.length)));
          if (grounded) pull.tokens = toks;
          else if (marks.length) pull.marks = marks;
          blocks.push(pull);
        }
        return;
      }
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
      // a bare <div> wrapper around block content (an image/embed figure, a
      // heading, a quote) — recurse so each block is parsed in place instead of
      // flattened into one paragraph (which dropped the figure). See BLOCK_TAGS.
      if (tag === "div" && !(node.classList && node.classList.contains("cmp-widget")) && hasBlockChild(node)) {
        Array.from(node.childNodes).forEach(emitNode);
        return;
      }
      if (tag === "figure") {
        const isStore = (u) => !!(u && window.NpjMedia && window.NpjMedia.isStoreUrl(u));
        const isArchive = (u) => !!u && (!window.NpjArchiveCDN || window.NpjArchiveCDN.isMediaUrl(u));
        const okSrc = (u) => !!u && (window.NpjMedia ? window.NpjMedia.isPublishable(u) : isArchive(u));
        // Resolve one image slot (inside `scope`) to a published image object,
        // honouring the same src/store/fit/crop rules a single inline image uses.
        // Shared by the carousel branch below and reused for each slide.
        const slotToImage = (scope) => {
          const sl = scope.querySelector("image-slot");
          if (!sl) return null;
          const cands = [sl.getAttribute("src"), sl.getAttribute("data-alt")].filter(Boolean);
          let archiveU = null, storeU = null, otherU = null;
          cands.forEach(u => { if (isStore(u)) storeU = storeU || u; else if (isArchive(u)) archiveU = archiveU || u; else otherU = otherU || u; });
          let src = archiveU || storeU || (okSrc(otherU) ? otherU : null);
          let local = false;
          if (!src && preview) { const d = cands.find(u => /^data:image\//i.test(u)); if (d) { src = d; local = true; } }
          if (!src) return null;
          const im = { src };
          const c = scope.querySelector("figcaption.cmp-cap, figcaption:not(.cmp-credit):not(.cmp-desc):not(.cmp-carousel-cap)");
          const cr = scope.querySelector(".cmp-credit");
          const ds = scope.querySelector(".cmp-desc");
          const ct = c ? c.textContent.trim() : ""; if (ct) im.caption = ct;
          const crt = cr ? cr.textContent.trim() : ""; if (crt) im.credit = crt;
          const dt = ds ? ds.textContent.trim() : ""; if (dt) im.description = dt;
          if (local) im.local = true;
          if (storeU && storeU !== src) im.store = storeU;
          const fit = (sl.getAttribute("fit") || "").toLowerCase();
          if (fit === "contain" || fit === "fill") im.fit = fit;
          const crop = parseCrop(sl.getAttribute("data-crop"));
          if (crop && crop.ar && (im.fit || crop.s !== 1 || crop.x || crop.y)) im.crop = crop;
          return im;
        };
        // ---- carousel / gallery: a figure holding several image slides, rendered
        // as a swipeable carousel (Splide) + fullscreen lightbox in the reader.
        // Empty slides (a drop target the author never filled) are skipped; an
        // all-empty carousel drops out entirely, like an empty inline image.
        if (node.classList && (node.classList.contains("cmp-carousel") || node.hasAttribute("data-carousel"))) {
          const slideEls = Array.from(node.querySelectorAll(".cmp-slide"));
          const scopes = slideEls.length ? slideEls : [node];
          const images = [];
          scopes.forEach(s => { const im = slotToImage(s); if (im) images.push(im); });
          if (images.length) {
            const block = { type: "gallery", images };
            const gcap = node.querySelector("figcaption.cmp-carousel-cap");
            const gc = gcap ? gcap.textContent.trim() : "";
            if (gc) block.caption = gc;
            blocks.push(block);
          }
          return;
        }
        // Three caption lines now: the caption (first figcaption), the photo
        // credit (.cmp-credit) and the description (.cmp-desc, the alt text).
        // Excluding both classes keeps the caption right whichever order they sit
        // in, and old single-figcaption drafts still match. The credit is markdown
        // ([label](url)) like a profile bio, rendered safely via npjRichText in
        // the reader. The description rides as the image's real `alt`.
        // .cmp-embed-hint is the composer's editor-only label on an embed figure
        // ("host · embedded — …"); it's an affordance, not a caption, so it never
        // rides into the published block.
        const cap = node.querySelector("figcaption:not(.cmp-credit):not(.cmp-desc):not(.cmp-embed-hint)");
        const capText = cap ? cap.textContent.trim() : "";
        const credEl = node.querySelector(".cmp-credit");
        const creditText = credEl ? credEl.textContent.trim() : "";
        const descEl = node.querySelector(".cmp-desc");
        const descText = descEl ? descEl.textContent.trim() : "";
        const slot = node.querySelector("image-slot");
        const plainImg = node.querySelector("img");
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
          if (s) { const block = { type: "img", src: s, caption }; if (creditText) block.credit = creditText; if (descText) block.description = descText; if (isBanner) block.banner = true; blocks.push(block); }
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
          let src = archiveU || storeU || (okSrc(otherU) ? otherU : null);
          // Preview only: no durable URL, but the slot carries the freshly-dropped
          // image as a data: URL (inlined for the preview build) — keep it, flagged
          // `local`, so Preview shows the photo and the reader can mark it as not
          // yet uploaded. Publish never sets preview, so this never ships.
          let local = false;
          if (!src && preview) {
            const dataU = cands.find(u => /^data:image\//i.test(u));
            if (dataU) { src = dataU; local = true; }
          }
          if (src) {
            const block = { type: "img", src, caption };
            if (creditText) block.credit = creditText;
            if (descText) block.description = descText;
            if (local) block.local = true;
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
        if (u) {
          const eb = { type: "embed", url: u, caption: capText };
          const eh = parseInt(node.getAttribute("data-embed-height"), 10);
          if (eh > 0) eb.height = eh;
          blocks.push(eb);
        } else if (!slot && !plainImg) {
          // a figure pasted straight in (no data-embed-url) — lift the embed from
          // the <iframe>/<video>/<audio> it wraps
          const eb = embedFromMediaEl(node.querySelector("iframe, video, audio"));
          if (eb) { if (capText) eb.caption = capText; blocks.push(eb); }
        }
        return;
      }
      // a bare embed pasted as raw HTML — an <iframe>/<video>/<audio> at block
      // level, or alone inside a <p>/<div> — survives into the record as an embed
      if (tag === "iframe" || tag === "video" || tag === "audio") {
        const eb = embedFromMediaEl(node); if (eb) blocks.push(eb); return;
      }
      if ((tag === "p" || tag === "div") && !text) {
        const eb = embedFromMediaEl(node.querySelector("iframe, video, audio"));
        if (eb) { blocks.push(eb); return; }
      }
      const toks = inlineTokens(node);
      if (hasInk(toks)) blocks.push({ type: "p", tokens: toks });
    };
    Array.from(root.childNodes).forEach(emitNode);

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
    // a marker that landed alone in its own paragraph attaches to the text above;
    // a word cut across a paragraph break (a stray Enter/paste) is stitched back
    const kept = mergeSplitWords(mergeStrandedFootnotes(defStripped));
    const fnNum = {}; let fnSeq = 0;   // key → number, in first-reference order
    const numberMarker = (t) => {
      if (!t || t.t !== "sup") return;
      const k = (t.key || t.text || "").trim(); if (!k) return;
      if (!fnNum[k]) fnNum[k] = ++fnSeq;
      t.key = k; t.num = fnNum[k];
    };
    kept.forEach(b => { (b.tokens || []).forEach(numberMarker); (b.marks || []).forEach(numberMarker); (b.items || []).forEach(it => it.forEach(numberMarker)); });
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
      if (b.type === "pull") {
        const cls = b.kind === "pull" ? ' class="np-pull"' : "";
        const sty = (b.align && b.align !== "left") ? ' style="text-align:' + b.align + '"' : "";
        // A grounded quote round-trips its inline tokens (the claim-src spans + cite
        // markers) so re-editing keeps the citation; a plain quote stays text + marks.
        const inner = (b.tokens && b.tokens.length)
          ? tokensToHtml(b.tokens) + tokensToHtml(b.marks || [])
          : esc(b.text) + tokensToHtml(b.marks || []);
        return "<blockquote" + cls + sty + ">" + inner + "</blockquote>";
      }
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
        // caption + credit + description are editable islands inside the
        // non-editable figure (the slot itself stays protected). The credit takes
        // markdown links the same way a contributor bio does — name /
        // [outlet](https://…). The description is the photo's alt text (screen
        // readers + search), surfaced as a line here so it round-trips on re-edit.
        const capHtml = '<figcaption class="cmp-cap np-mono" contenteditable="true" data-ph="Caption — what\'s happening in the photo" style="font-size:11px;margin-top:4px">' + esc(b.caption || "") + '</figcaption>';
        const credHtml = '<figcaption class="cmp-credit np-mono" contenteditable="true" data-ph="Credit — e.g. Jane Doe / [Reuters](https://reuters.com)" style="font-size:11px;margin-top:2px">' + esc(b.credit || "") + '</figcaption>';
        const descHtml = '<figcaption class="cmp-desc np-mono" contenteditable="true" data-ph="Description — alt text for screen readers &amp; search (not shown on the page)" style="font-size:11px;margin-top:2px">' + esc(b.description || "") + '</figcaption>';
        return '<figure contenteditable="false" class="' + cls + '"' + (b.banner ? ' data-banner="1"' : '') + '><image-slot id="' + slotId + '" src="' + esc(primary) + '"' + (alt ? ' data-alt="' + esc(alt) + '"' : '') + fitAttr + cropAttr + conformAttr + ' fitcontrol shape="rect" style="width:100%;height:300px;display:block" placeholder="Drop a photo or an archive.org link"></image-slot>' + capHtml + credHtml + descHtml + "</figure>";
      }
      // carousel / gallery → an editable figure of image slides. Each slide is
      // the SAME editable image-slot a single inline image uses (so a fresh drop
      // still uploads to the media store and freezes to archive.org at publish),
      // wrapped in .cmp-slide with its own caption/credit/description islands. A
      // contenteditable=false "+ Add image" control and a per-slide ✕ are driven
      // by delegated handlers in the Newsroom editor. The reader renders this
      // block as a Splide carousel; blocksToHtml is only the EDIT representation.
      if (b.type === "gallery") {
        const slideCap = (im) =>
          '<figcaption class="cmp-cap np-mono" contenteditable="true" data-ph="Caption — what\'s happening in the photo" style="font-size:11px;margin-top:4px">' + esc(im.caption || "") + '</figcaption>' +
          '<figcaption class="cmp-credit np-mono" contenteditable="true" data-ph="Credit — e.g. Jane Doe / [Reuters](https://reuters.com)" style="font-size:11px;margin-top:2px">' + esc(im.credit || "") + '</figcaption>' +
          '<figcaption class="cmp-desc np-mono" contenteditable="true" data-ph="Description — alt text for screen readers &amp; search (not shown on the page)" style="font-size:11px;margin-top:2px">' + esc(im.description || "") + '</figcaption>';
        const slides = (Array.isArray(b.images) ? b.images : []).map((im, j) => {
          const primary = im.store || im.src || "";
          const alt = (im.store && im.src && im.src !== im.store) ? im.src : "";
          const fitAttr = im.fit ? ' fit="' + esc(im.fit) + '"' : '';
          const cropAttr = (im.crop && im.crop.ar) ? ' data-crop="' + esc([im.crop.s, im.crop.x, im.crop.y, im.crop.ar].join(",")) + '"' : '';
          const sid = "eo-car-" + bi + "-" + j;
          return '<div class="cmp-slide">' +
            '<image-slot id="' + sid + '" src="' + esc(primary) + '"' + (alt ? ' data-alt="' + esc(alt) + '"' : '') + fitAttr + cropAttr +
            ' conform fitcontrol shape="rect" style="width:100%;height:240px;display:block" placeholder="Drop a photo or an archive.org link"></image-slot>' +
            slideCap(im) +
            '<span class="cmp-slide-rm" contenteditable="false" role="button" title="Remove image" aria-label="Remove image">✕</span>' +
            '</div>';
        }).join("");
        const addBtn = '<span class="cmp-carousel-add" contenteditable="false" role="button">+ Add image</span>';
        const galCap = '<figcaption class="cmp-carousel-cap np-mono" contenteditable="true" data-ph="Gallery caption (optional)" style="font-size:11px;margin-top:6px">' + esc(b.caption || "") + '</figcaption>';
        return '<figure contenteditable="false" class="cmp-embed cmp-carousel" data-carousel="1"><div class="cmp-carousel-track">' + slides + '</div>' + addBtn + galCap + "</figure>";
      }
      // rebuild the live player from the stored URL (same resolver the composer
      // and reader use), so re-opening a published piece to edit shows the embed
      // rather than a bare link. data-embed-url stays the original permalink and
      // data-embed-height carries the author's panel height back through.
      if (b.type === "embed") {
        const eInner = window.NpjEmbed ? window.NpjEmbed.innerHtml(b.url, { height: b.height }) : '<a href="' + esc(b.url) + '">' + esc(b.url) + "</a>";
        const eh = b.height ? ' data-embed-height="' + esc(b.height) + '"' : "";
        return '<figure data-embed-url="' + esc(b.url) + '"' + eh + ' contenteditable="false" class="cmp-embed">' + eInner + (b.caption ? '<figcaption class="np-mono" style="font-size:11px;margin-top:4px">' + esc(b.caption) + "</figcaption>" : "") + "</figure>";
      }
      return "";
    }).join("\n");
  }

  /* ---------------- publish + edit (through the same n8n webhook) ---------------- */
  // The publication-safe projection of a source record before it enters the
  // public, committed log — permanent, all-or-nothing, undeletable. Two jobs:
  //
  //   • INTERVIEW: the reporter's raw notes (rec.text) are private — only the
  //     exact words PINNED as citations belong in the public record, and those
  //     ride on the body tokens, not here. So the transcript is stripped.
  //
  //   • HARD-REDACTED SOURCE: a source the author scrubbed PII from (Citey's
  //     review, app/pii.js) has to reach the archive REDACTED FOR REAL. The █
  //     scrub already lives in rec.text — but the ORIGINAL file's own bytes were
  //     never redacted, only its text shadow was, so every pointer back to that
  //     un-redacted original (file_url / mxc / original_url / archive_url) is
  //     DROPPED here. Leaving any one of them would put the withheld data a single
  //     click away inside the published piece. The text is re-asserted from the
  //     recorded ranges (offset-preserving █, idempotent) so the public copy is
  //     redacted even if the live in-place scrub was somehow lost — over-redacting
  //     is the safe direction; under-redacting leaks. What survives is the
  //     redacted text plus a content-free audit stub (counts, not the offsets or
  //     identities behind them).
  //
  //     EXCEPTION — a REDACTED PDF: when Citey built a real redacted copy (pages
  //     rasterized with the boxes burned in, NpjSourceView.buildRedactedPdf, stored
  //     as review.redactedFile), that copy carries nothing under its boxes to fetch
  //     back. So instead of withholding the document, we SHIP the redacted copy:
  //     file_url/mxc point at it, and only the pointers to the un-redacted ORIGINAL
  //     (original_url / archive_url, and any original file_url) are dropped. The
  //     reader shows the scrubbed document instead of "original withheld".
  //
  // Every other source passes through unchanged. Non-mutating: an interview or
  // redacted projection is cloned, so the live working record (still openable in
  // the newsroom) is never altered.
  function publishableSource(rec) {
    if (!rec) return rec;
    const W = (typeof window !== "undefined") ? window : {};
    // OCR rides in the public record only if the author vouches for it. An image
    // source's recognized text is machine-read and often noisy ("OCR spam");
    // unless the author turned its reader display on (ocrShow, surfaced through
    // NpjSourceView.citedPassageVisible), keep that text OUT of the committed
    // record — it never ships as a verbatim quote, and the picture itself stays
    // as the receipt. A CLONE, so the live working record is untouched and the
    // author can still vouch (and republish with the text) later.
    const SV = W.NpjSourceView;
    if (SV && SV.citedPassageVisible && !SV.citedPassageVisible(rec) && ((rec.text && rec.text.trim()) || rec.pull_quote)) {
      rec = Object.assign({}, rec);
      rec.text = "";
      if (rec.pull_quote) rec.pull_quote = "";
    }
    if (W.NpjInterview && W.NpjInterview.redactForPublish) rec = W.NpjInterview.redactForPublish(rec);
    else if (rec.type === "interview") { rec = Object.assign({}, rec); rec.text = ""; }
    const review = rec.piiReview;
    const redactions = (review && review.redactions) || [];
    if (redactions.length) {
      const o = Object.assign({}, rec);
      if (W.NpjPII && W.NpjPII.redactText) o.text = W.NpjPII.redactText(o.text || "", redactions);
      const rf = review && review.redactedFile;
      if (rf && rf.url) {
        // the produced redacted copy IS the document that ships — its bytes are
        // already scrubbed, so it's safe to keep a live pointer to it
        o.file_url = rf.url; o.mxc = rf.mxc || "";
        o.original_url = ""; o.archive_url = "";   // …but never to the un-redacted original
        o.redacted = true; o.redactedPdf = true;
      } else {
        o.file_url = ""; o.mxc = ""; o.original_url = ""; o.archive_url = "";
        o.redacted = true;
      }
      o.piiReview = { state: review.state || "reviewed", basis: review.basis || (W.NpjPII && W.NpjPII.BASIS) || "",
        redactions: redactions.length, affirmations: ((review.affirmations) || []).length, redactedPdf: !!(rf && rf.url) };
      return o;
    }
    return rec;
  }

  // Build the genesis event from the composer's content. Sources: only the
  // records the body actually cites ride in the log — the log must stand alone.
  function genesisFromContent(content, opts) {
    const c = content || {};
    const o = opts || {};
    const { blocks, headline, dek } = htmlToBlocks(c.html || "", { preview: !!o.preview });
    const usedKeys = {};
    blocks.forEach(b => {
      (b.tokens || []).forEach(t => { if (t && t.src) t.src.forEach(k => usedKeys[k] = 1); });
      (b.items || []).forEach(it => it.forEach(t => { if (t && t.src) t.src.forEach(k => usedKeys[k] = 1); }));
    });
    const sources = {};
    Object.keys(usedKeys).forEach(k => { if (window.NPJ.SOURCES[k]) sources[k] = publishableSource(window.NPJ.SOURCES[k]); });
    // OCR is included only if the author vouches for it: for an image source the
    // author hasn't vouched for, drop its pinned quotes from the body too (the
    // source projection above already withheld the source's own OCR text), so no
    // machine-read text rides into the record as a verbatim citation. The claim
    // still cites the source — the picture is the receipt — just without a quote.
    const SV = window.NpjSourceView;
    if (SV && SV.citedPassageVisible) {
      const hideOcr = {};
      Object.keys(usedKeys).forEach(k => { const r = window.NPJ.SOURCES[k]; if (r && !SV.citedPassageVisible(r)) hideOcr[k] = 1; });
      if (Object.keys(hideOcr).length) {
        const scrubQ = (t) => {
          if (!t || !t.q) return;
          Object.keys(t.q).forEach(k => { if (hideOcr[k]) delete t.q[k]; });
          if (!Object.keys(t.q).length) delete t.q;
        };
        blocks.forEach(b => {
          (b.tokens || []).forEach(scrubQ);
          (b.items || []).forEach(it => (it || []).forEach(scrubQ));
          (b.marks || []).forEach(scrubQ);
        });
      }
    }
    const actor = o.actor || null;
    const mxids = (arr) => (Array.isArray(arr) ? arr : []).map(s => String(s || "").trim()).filter(s => /^@[^:]+:[^:]+$/.test(s));
    // Editors are an outward-facing CREDIT, not access control (assignees gate
    // edits). So an editor can be listed by a plain NAME as well as a Matrix id —
    // each entry is just trimmed, collapsed, length-clamped and capped in count.
    // (authors stay mxid-only above, so attribution always resolves to an account.)
    const credits = (arr) => (Array.isArray(arr) ? arr : [])
      .map(s => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 16);
    // Byline: authors default to the publisher; "Unsigned" is an explicit override
    // that ships with NO credited author. Editors are an optional separate credit.
    // Either way the ACTOR stays an assignee, so they can always edit after publish.
    const unsigned = o.byline === "Unsigned" || o.unsigned === true;
    const authors = o.authors != null ? mxids(o.authors) : (actor ? [actor] : []);
    // a scheduled release: the piece commits now but stays off the front page
    // until `releaseAt`. Its shown date is the release date (the day the author
    // picked), not today. A releaseAt already in the past is ignored — that's a
    // normal live publish dated today().
    const scheduleAt = scheduledFuture(o.releaseAt) ? new Date(o.releaseAt).toISOString() : "";
    const operand = {
      slug: o.slug || slugify(headline || o.headline) || "untitled",
      headline: headline || o.headline || "Untitled",
      dek: dek || o.dek || "",
      column: c.column || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      // the piece's glossary entries (term → definition); normalized through the
      // definitions helper when it's loaded, otherwise carried as-is
      definitions: (typeof window !== "undefined" && window.NpjDefinitions && window.NpjDefinitions.normList)
        ? window.NpjDefinitions.normList(c.definitions)
        : (Array.isArray(c.definitions) ? c.definitions : []),
      authors: unsigned ? [] : authors,
      editors: credits(o.editors),
      byline: unsigned ? "Unsigned" : (typeof o.byline === "string" ? o.byline : ""),
      assignees: actor ? [actor] : [], // the publisher can edit after publish; admin always can
      published: scheduleAt ? releaseDate(scheduleAt) : today(),
      body: blocks,
      sources
    };
    // only ride a release instant when the piece is genuinely scheduled ahead —
    // a live publish carries no releaseAt, so the front page never gates it
    if (scheduleAt) operand.releaseAt = scheduleAt;
    // composition provenance rides the genesis when the editor captured it
    // (aggregate counts only — see app/composition.js); harmless when absent
    if (o.composition && typeof o.composition === "object") operand.composition = o.composition;
    const line = genesisLine(operand, actor);
    const folded = foldLog(line);
    return { line, operand, article: folded.article };
  }

  /* ---------------- the write path: GitHub is the home ----------------
     Every event (INS publish, REC edit, EVA feedback, status flip) appends ONE
     line to articles/<slug>.jsonl through the Matrix-gated /site/publish-npj
     webhook: it re-verifies the token, reads the current file, appends the line,
     and commits it back to GitHub (mirror:false — archive.org is not in the
     article path). The webhook owns the read-modify-append, so the per-article
     assignee gate runs server-side against the genesis event (it fires once the
     file exists; creating a brand-new article is open to any editor).

     The commit is BOUNDED: a stalled webhook is aborted after COMMIT_MS and
     surfaces as a normal fetch rejection the gate turns into a retryable
     failure, instead of hanging the "Commit" spinner forever.

     Success is judged on the JSON body, not a bare HTTP 200 — the webhook
     answers a failed GitHub commit honestly with { gh_ok:false, gh_status,
     gh_error }, so the gate can tell a real verdict (don't retry, surface it)
     from a transient gateway blip (retry). NOTE on concurrency: two writers
     appending to one slug in the same instant can race; publishing/editing are
     single-author/admin actions, so this is rare and a lost line is re-sent. */
  function postCommit(bodyObj, token, endpoint) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), COMMIT_MS);
    return fetch(endpoint || publishEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(bodyObj),
      signal: ctrl.signal
    }).finally(() => clearTimeout(timer));
  }
  // Write ONE file (mode:"overwrite"). Every NPJ write targets a path that does
  // not yet exist — the genesis on first publish, a fresh per-event file after —
  // so this is always a clean GitHub create: we NEVER read-modify-append an
  // existing file. mirror:false keeps it on GitHub.
  function commitFile({ filename, line, token, message, endpoint }) {
    return postCommit({
      filename, mode: "overwrite",
      contentRaw: String(line).replace(/\n+$/, "") + "\n",
      message: message || ("update: " + filename), mirror: false
    }, token, endpoint);
  }
  // First publish writes the genesis anchor articles/<slug>.jsonl (a create). A
  // REPUBLISH of an already-anchored slug is itself a NEW event file (a fresh INS
  // that re-seeds state on fold) — so the genesis is written exactly once and
  // never edited.
  async function publishGenesis({ slug, line, token, message, republish }) {
    // The genesis anchor articles/<slug>.jsonl is written EXACTLY ONCE — every
    // later publish of the same slug must land as its OWN new event file, so the
    // history is append-only and the original publish line is never overwritten.
    // The caller's `republish` flag is derived from the in-memory front index,
    // which can be cold/stale when the editor opens straight to a draft — so a
    // republish could be misrouted back onto the genesis (a destructive
    // overwrite, and no new file appears). Guard it against the LIVE git-tree:
    // if the genesis already exists, force the event-file path regardless. We
    // only ever upgrade first-publish → republish (never the reverse), and on any
    // listing failure we trust the caller's flag — a true first publish still
    // needs its genesis even when the tree can't be read.
    let isRepublish = !!republish;
    if (!isRepublish) {
      // Bound the probe the same way the commit is: a stalled git-tree read must
      // never hang the publish — it just times out and we trust the caller's flag.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), COMMIT_MS);
      try {
        const s = slugify(slug) || slug;
        const docs = await listDocs(ctrl.signal);
        if (docs.some(d => d.slug === s)) isRepublish = true;
      } catch (e) { /* tree unreadable/aborted — fall back to the caller's flag */ }
      finally { clearTimeout(timer); }
    }
    const filename = isRepublish ? eventPath(slug, "ins", line) : filenameFor(slug);
    // keep the commit message honest about which it turned out to be (a caller's
    // custom, non-default message is still respected)
    const msg = (message && !/^(?:re)?publish: /.test(message))
      ? message
      : ((isRepublish ? "republish: " : "publish: ") + slug);
    return commitFile({ filename, line, token, message: msg });
  }
  // One REC event → its OWN new file. The current status (published/unpublished)
  // is stamped into the event so each file self-records publication state, and a
  // reader can resolve the live status from the newest file without folding the
  // whole log. A status-flip already carries operand.status; for a content edit,
  // pass `status` so the newest file still declares the piece's current state.
  async function appendEdit({ slug, operand, actor, note, token, message, status }) {
    const op = status ? Object.assign({}, operand, { status }) : (operand || {});
    const line = editLine(slug, op, actor, note);
    const filename = eventPath(slug, "rec", line);
    const res = await commitFile({ filename, line, token, message: message || ("edit: " + slug) });
    return { res, line, sha: lineSha(line), filename };
  }
  /* A generic event writer — writes any EO op as its own new event file. Used by
     the feedback layer (app/feedback.js) to land reader EVA deposits alongside
     the article's own events. `schema` overrides the event's `v` so feedback
     lines self-identify (npj/feedback-eo/1) while still folding harmlessly
     through the article reader (EVA never touches state). */
  async function appendEvent({ slug, op, operand, actor, token, note, extra, message, schema, status }) {
    const opnd = status ? Object.assign({}, operand, { status }) : (operand || {});
    const head = { v: schema || SCHEMA, op, target: "article/" + slug, ts: nowIso(), actor: actor || null, operand: opnd };
    if (note) head.note = note;
    const line = JSON.stringify(Object.assign(head, extra || {}));
    const filename = eventPath(slug, op, line);
    // EVA deposits (open reader feedback) ride the write-only suggest webhook so
    // any verified user can post; everything else stays on the gated publish path.
    const endpoint = String(op).toUpperCase() === "EVA" ? suggestEndpoint() : undefined;
    const res = await commitFile({ filename, line, token, endpoint, message: message || (String(op).toLowerCase() + ": " + slug) });
    return { res, line, sha: lineSha(line), filename };
  }

  /* Every event in the document's log, folded once — the article reader keeps
     only the article, but feedback needs the raw EVA deposits riding alongside
     it. Read from the GitHub raw CDN. Returns { events, base_sha } (base_sha is
     the current article version, used to flag a suggestion made against a
     since-superseded draft as stale). */
  async function fetchEvents(slug) {
    const s = slugify(slug) || slug;
    const text = await gatherLog(s);
    if (!text) return { events: [], base_sha: null };
    const folded = foldLog(text);
    return { events: folded.events || [], base_sha: folded.article ? folded.article.base_sha : null };
  }

  // Unpublish / republish — one REC event appended to the log. Unpublish just
  // takes the piece off the site (the reader + front page hide it); nothing is
  // deleted — the whole append-only log stays in GitHub, and the act of hiding
  // it is itself recorded as one more event. Authorized exactly like any other
  // edit (the webhook re-verifies the Matrix token); the UI restricts it to admins.
  function setArticleStatus({ slug, status, actor, note, token }) {
    const next = status === "unpublished" ? "unpublished" : "published";
    const message = (next === "unpublished" ? "unpublish: " : "republish: ") + slug;
    const finalNote = note || (next === "unpublished"
      ? "Unpublished — hidden from the site (the event log stays in GitHub)"
      : "Republished");
    return appendEdit({ slug, operand: { status: next }, actor, note: finalNote, token, message });
  }

  /* Publish receipts. The webhook returns the post-commit provenance the client
     can't know up front — the GitHub commit_sha of the line it wrote and its
     byte count. The genesis event is serialized BEFORE the commit, so the SHA
     can't live in the event operand; it lives here, keyed by filename, so a
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
    SCHEMA, DIR, RAW_BASE, rawUrl, blobUrl, filenameFor, publishEndpoint, suggestEndpoint,
    foldLog, plainText, readMins, lineSha,
    scheduledFuture, releaseDate,
    META_STANDARD, checkMeta,
    snapshotOperand, revertOperand,
    listArticles, loadFront, patchFrontStatus, dropFromFront, publishedMeta, loadArticle, primeFront, saveFront,
    htmlToBlocks, blocksToHtml, tokensToHtml, mergeSplitWords,
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
