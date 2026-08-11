/* media-store.js — where article images live before they're frozen.
 *
 * The split this enforces:
 *   • While you DRAFT, a dropped photo is uploaded to the Matrix media store
 *     (your homeserver's media repo) and rides a durable https URL — never a
 *     base64 data: URL baked into the draft, and never bytes headed for the
 *     GitHub commit.
 *   • When you PUBLISH, that media-store image is moved onto archive.org and the
 *     committed article hotlinks the archive.org copy. So archive.org is the CMS
 *     for everything that goes public.
 *
 * Publish has three ways to get an image onto archive.org, tried in order:
 *   1. Server-side migration (preferred): hand the media-store mxc + the
 *      author's Matrix token to the n8n archive endpoint (site/media-archive-npj).
 *      n8n pulls the bytes from the homeserver — authenticated, so it works even
 *      when the homeserver gates media behind auth — and PUTs them to archive.org
 *      as a real item via the S3-style API. Optional: that webhook may not be
 *      deployed, in which case this step is skipped.
 *   2. Download + reupload (site/media-npj → site/media-archive-npj): fetch the
 *      media-store bytes with the author's session (works on auth-gated
 *      homeservers), POST them to media-npj — which stores them in the Matrix
 *      media repo server-side and returns a fresh mxc — then migrate that mxc to
 *      archive.org via media-archive-npj. Works even when the AUTHOR's network
 *      can't reach archive.org (n8n does the PUT). The archive.org S3 keys live
 *      server-side, never in the browser.
 *   3. Wayback freeze (fallback, no keys): Save Page Now on the media-store URL,
 *      the same path the app already uses to freeze sources. Only reaches the
 *      bytes if the homeserver serves media unauthenticated.
 * If none confirms, the image keeps its media-store URL (never a silent drop)
 * and the publisher is told.
 *
 * The Matrix upload uses the author's existing session (window.MatrixAuth); the
 * Wayback path uses window.NpjArchiveCDN. Both are optional — absent them the
 * helpers degrade and <image-slot> falls back to a session-only preview.
 *
 * Proactive pre-archiving (prearchiveSlots): the same move, run from the
 * composer BEFORE publish. It walks the draft's live <image-slot>s, uploads any
 * still on the media store to archive.org, and records the durable URL in each
 * slot's data-alt — so publish's freezeArticleMedia finds nothing left to move
 * and the boundary is instant instead of "up to a minute each."
 *
 * Exposed as window.NpjMedia.
 */
(function (root) {
  'use strict';

  const MA = () => root.MatrixAuth;
  const CDN = () => root.NpjArchiveCDN;
  const sess = () => { const m = MA(); return (m && m.current && m.current()) || null; };
  const encPath = (n) => String(n).split("/").map(encodeURIComponent).join("/");

  // A signed-in Matrix session is all it takes to upload to that homeserver's
  // media repo (the client-server media API is CORS-open like the rest of it).
  function canUpload() {
    const m = MA();
    return !!(m && m.isSignedIn && m.isSignedIn() && m.token && m.token());
  }

  // Host-agnostic: ANY Matrix media download/thumbnail URL (v3, legacy r0, or
  // the authenticated client/v1 form). Used to tell "still on the media store,
  // needs freezing" from "already an archive.org URL" at publish time.
  const STORE_RE = /\/_matrix\/(?:media\/(?:v3|r0)|client\/v1\/media)\/(?:download|thumbnail)\//;
  function isStoreUrl(u) { return STORE_RE.test(String(u || "")); }

  // What may ride into a published article body as an <img src>: an archive.org
  // URL (the durable CMS) or a media-store URL (which publish will move).
  function isPublishable(u) {
    const c = CDN();
    return (!!c && c.isMediaUrl(u)) || isStoreUrl(u);
  }

  // mxc://server/id → the plain https download URL on the author's homeserver.
  function mxcToHttp(mxc, base) {
    const m = String(mxc || "").match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!m) return mxc;
    const b = base || (sess() && sess().base_url) || "";
    return b + "/_matrix/media/v3/download/" + m[1] + "/" + encodeURIComponent(m[2]);
  }

  // Reverse of mxcToHttp: a media-store download/thumbnail URL → mxc://server/id.
  // Lets publish hand the backend the mxc for server-side archival, working back
  // from the https src that rides the draft.
  function httpToMxc(url) {
    const m = String(url || "").match(/\/_matrix\/(?:media\/(?:v3|r0)|client\/v1\/media)\/(?:download|thumbnail)\/([^/]+)\/([^/?#]+)/);
    return m ? ("mxc://" + m[1] + "/" + decodeURIComponent(m[2])) : null;
  }

  /* ---- upload a drop to the media store ----
     POSTs raw bytes to /_matrix/media/v3/upload (NOT through MatrixAuth.api,
     which is JSON-only). Returns the durable https URL to drop into the slot. */
  async function upload(blob, filename) {
    const m = MA();
    if (!canUpload()) throw new Error("Sign in with Matrix to upload images.");
    const s = m.current(); const base = s && s.base_url; const token = m.token();
    if (!base) throw new Error("No homeserver for this session.");
    const name = filename || (blob && blob.name) || ("image-" + Date.now() + ".webp");
    let res;
    try {
      res = await fetch(base + "/_matrix/media/v3/upload?filename=" + encodeURIComponent(name), {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": (blob && blob.type) || "application/octet-stream" },
        body: blob
      });
    } catch (e) {
      // The direct browser → media-repo POST couldn't even connect — almost
      // always CORS (the homeserver's media endpoint isn't open to the app
      // origin). Fall back to the server-side media-npj endpoint, which does
      // the same Matrix upload from n8n (no browser CORS) and hands back the mxc.
      try { return await uploadViaBackend(blob, name); }
      catch (e2) { throw new Error((e2 && e2.message) || "Couldn't reach the media store."); }
    }
    // Size rejections are tagged (err.tooLarge) so the caller can shrink-and-retry
    // a tall document instead of just surfacing a dead end. Both the standard 413
    // and a 200-shaped homeserver error with errcode M_TOO_LARGE are honoured.
    if (res.status === 413) { const e = new Error("That image is too large for the media store."); e.tooLarge = true; throw e; }
    if (!res.ok) {
      let eb = null; try { eb = await res.json(); } catch (e) {}
      if (eb && eb.errcode === "M_TOO_LARGE") { const e = new Error(eb.error || "That image is too large for the media store."); e.tooLarge = true; throw e; }
      throw new Error("Media upload failed (HTTP " + res.status + ")." + (eb && eb.error ? " " + eb.error : ""));
    }
    let j = null; try { j = await res.json(); } catch (e) {}
    const mxc = j && j.content_uri;
    if (!mxc) throw new Error("The media store returned no URL.");
    return { url: mxcToHttp(mxc, base), mxc };
  }

  /* uploadViaBackend(blob, filename) → Promise<{url, mxc}>. The server-side draft
     upload: POST the bytes (base64) + the author's Matrix token to the n8n
     media-npj endpoint, which stores them in the homeserver's media repo and
     answers { ok, mxc, filename }. Used when the browser can't PUT to the media
     repo directly (CORS) — n8n does the upload, so the app never touches the
     media API cross-origin. Returns the durable https URL + the mxc. */
  async function uploadViaBackend(blob, filename) {
    const m = MA();
    const token = m && m.token && m.token();
    if (!token) throw new Error("Sign in with Matrix to upload images.");
    const name = filename || (blob && blob.name) || ("image-" + Date.now() + ".webp");
    const b64 = await blobToBase64(blob);
    let res;
    try {
      res = await fetchT(mediaEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          filename: name, mimetype: (blob && blob.type) || "image/webp",
          title: name, contentBase64: b64
        })
      }, 120000);
    } catch (e) {
      throw new Error(e && e.name === "AbortError"
        ? "Media upload timed out — the media service took too long."
        : "Couldn't reach the media store.");
    }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok || !j.mxc) throw new Error((j && j.error) || ("Media upload failed (HTTP " + res.status + ")."));
    const base = (sess() && sess().base_url) || "";
    return { url: mxcToHttp(j.mxc, base), mxc: j.mxc };
  }

  /* uploadLimit() → Promise<number|null>. The homeserver's max upload size in
     bytes (m.upload.size from /_matrix/media/v3/config), so a drop can shrink to
     fit BEFORE it bounces off a 413. Best-effort + cached for the session; null
     when the homeserver doesn't advertise one (then the caller falls back to
     reacting to a 413). */
  let _uploadLimit; // undefined = unfetched · null = unknown · number = bytes
  async function uploadLimit() {
    if (_uploadLimit !== undefined) return _uploadLimit;
    _uploadLimit = null;
    const m = MA(); const s = sess(); const base = s && s.base_url;
    if (!base) { _uploadLimit = undefined; return null; } // not signed in yet — let a later call retry
    try {
      const headers = (m && m.token && m.token()) ? { "Authorization": "Bearer " + m.token() } : {};
      const r = await fetch(base + "/_matrix/media/v3/config", { headers });
      if (r.ok) { const j = await r.json(); const n = j && j["m.upload.size"]; if (typeof n === "number" && n > 0) _uploadLimit = n; }
    } catch (e) {}
    return _uploadLimit;
  }

  /* fetch with a hard timeout. A bare fetch() never resolves if the peer accepts
     the connection then stalls — at the publish boundary that hangs the whole
     commit on a spinner with no way out. Abort after `ms` so every network leg of
     archiving is bounded; an AbortError surfaces as a normal fetch failure that
     the caller already handles (fall through / warn). */
  async function fetchT(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); }
    finally { clearTimeout(timer); }
  }

  /* fetchBytes(url) → Promise<Blob|null>. Authenticated download from the media
     store (the v1 endpoint works on locked-down homeservers; plain v3 is the
     fallback). This is the "download" half of download-and-reupload, and also
     backs resolveDisplay. */
  async function fetchBytes(url) {
    const m = MA();
    const tries = [];
    if (isStoreUrl(url) && canUpload()) {
      const authUrl = String(url).replace("/_matrix/media/v3/download/", "/_matrix/client/v1/media/download/");
      tries.push([authUrl, { "Authorization": "Bearer " + m.token() }]);
    }
    tries.push([url, {}]);
    for (const [u, headers] of tries) {
      try { const r = await fetchT(u, { headers }, 60000); if (r.ok) return await r.blob(); } catch (e) {}
    }
    return null;
  }

  /* ---- display-blob cache ----
     resolveDisplay gets called again and again for the SAME image — a list
     re-renders, a lightbox opens, an <image-slot> remounts, the front page and
     the reader both paint the cover. Each call used to re-download the FULL
     authenticated bytes, so clicking to load an image felt slow every single
     time and several components showing the same image each fired their own
     download. Cache the fetched Blob by URL (Matrix media is content-addressed
     and immutable, so a given store URL always yields the same bytes) and dedupe
     concurrent fetches. Callers still mint — and revoke — their OWN object URL
     from the shared blob, so the existing ownership contract is untouched;
     minting a URL from an in-memory blob is instant. A modest byte-capped LRU
     keeps memory bounded. */
  const _blobCache = new Map();    // url -> Blob (insertion order = LRU)
  const _blobInflight = new Map(); // url -> Promise<Blob|null>
  let _blobCacheBytes = 0;
  const BLOB_CACHE_MAX = 48 * 1024 * 1024; // ~48 MB of source bytes
  function _cacheBlob(url, blob) {
    if (!blob) return;
    if (_blobCache.has(url)) { _blobCacheBytes -= (_blobCache.get(url).size || 0); _blobCache.delete(url); }
    _blobCache.set(url, blob);
    _blobCacheBytes += blob.size || 0;
    while (_blobCacheBytes > BLOB_CACHE_MAX && _blobCache.size > 1) {
      const oldest = _blobCache.keys().next().value;
      const b = _blobCache.get(oldest);
      _blobCache.delete(oldest);
      _blobCacheBytes -= (b && b.size) || 0;
    }
  }
  async function fetchBytesCached(url) {
    if (_blobCache.has(url)) {
      const b = _blobCache.get(url);
      _blobCache.delete(url); _blobCache.set(url, b); // refresh LRU position
      return b;
    }
    if (_blobInflight.has(url)) return _blobInflight.get(url);
    const p = (async () => { const b = await fetchBytes(url); if (b) _cacheBlob(url, b); return b; })();
    _blobInflight.set(url, p);
    try { return await p; } finally { _blobInflight.delete(url); }
  }

  /* resolveDisplay(url) → a URL the <img> can actually render.
     Homeservers running authenticated media (Matrix 1.11+) refuse an
     unauthenticated <img> GET, so when display is needed we fetch the bytes
     with the session token and hand back a blob: URL. Signed-out or non-store
     URLs pass straight through. Best-effort — returns the original on failure.
     The bytes come from a per-URL cache (see above) so repeat displays of the
     same image are instant; each caller still owns the object URL it mints. */
  async function resolveDisplay(url) {
    if (!isStoreUrl(url) || !canUpload()) return url;
    const b = await fetchBytesCached(url);
    return b ? URL.createObjectURL(b) : url;
  }

  /* ---- archive.org upload via the n8n backend ----
     A browser PUT to archive.org's S3 endpoint is unreliable (CORS) and would
     expose the IA keys, so the bytes are handed to the publish backend instead:
     n8n uploads them server-side (keys live in n8n env), verifies, and answers
     { ok, url }. The endpoint mirrors the publish webhook's host. */
  function mediaEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.mediaEndpoint) return c.mediaEndpoint; } catch (e) {}
    const base = (root.NpjArticles && root.NpjArticles.publishEndpoint && root.NpjArticles.publishEndpoint()) || "";
    if (base) return base.replace(/\/[^/]+$/, "/media-npj");
    return "https://n8n.intelechia.com/webhook/site/media-npj";
  }

  // Publish-time archive endpoint (site/media-archive-npj): n8n migrates a
  // media-store mxc onto archive.org server-side. Same host derivation as
  // mediaEndpoint — it mirrors the publish webhook's host.
  function archiveEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.archiveEndpoint) return c.archiveEndpoint; } catch (e) {}
    const base = (root.NpjArticles && root.NpjArticles.publishEndpoint && root.NpjArticles.publishEndpoint()) || "";
    if (base) return base.replace(/\/[^/]+$/, "/media-archive-npj");
    return "https://n8n.intelechia.com/webhook/site/media-archive-npj";
  }

  // chunked so a multi-hundred-KB image doesn't blow the call stack on apply().
  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  }

  /* uploadToArchive(blob, {identifier, filename, title}) → Promise<archive.org URL>.
     The bytes path to archive.org, in two server-side hops that match the
     deployed n8n endpoints:
       1. media-npj stores the bytes in the homeserver's media repo and returns
          an mxc (it is a Matrix uploader, NOT an archive.org uploader).
       2. media-archive-npj migrates that mxc onto archive.org and returns the
          durable url.
     Used when the caller has the bytes but no usable mxc to migrate directly
     (e.g. the src wasn't a recognizable media-store URL). Rejects loudly so the
     caller can fall back or warn. */
  async function uploadToArchive(blob, opts) {
    const stored = await uploadViaBackend(blob, opts.filename);
    return await migrateToArchive(stored.mxc, {
      identifier: opts.identifier, filename: opts.filename,
      mimetype: (blob && blob.type) || "image/webp", title: opts.title || ""
    });
  }

  /* migrateToArchive(mxc, {identifier, filename, mimetype, title}) → Promise<archive.org URL>.
     The publish-time path: hand the media-store mxc + the author's Matrix token
     to the n8n archive endpoint; n8n pulls the bytes from the homeserver
     server-side and PUTs them to archive.org, answering { ok, url } (or
     { ok:false, error }). Rejects loudly so the caller can fall back or warn. */
  async function migrateToArchive(mxc, opts) {
    const m = MA();
    const token = m && m.token && m.token();
    if (!token) throw new Error("Sign in to upload to archive.org.");
    // The backend pulls the bytes from the homeserver and PUTs them to
    // archive.org within the request — that round-trip can take up to a minute,
    // so give it generous headroom before aborting (vs. the browser default).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    let res;
    try {
      res = await fetch(archiveEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          mxc, identifier: opts.identifier, filename: opts.filename,
          mimetype: opts.mimetype || "image/webp", title: opts.title || ""
        }),
        signal: ctrl.signal
      });
    } catch (e) {
      throw new Error(e && e.name === "AbortError"
        ? "archive.org upload timed out — the media archive service took too long."
        : "Couldn't reach the media archive service.");
    } finally { clearTimeout(timer); }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok || !j.url) throw new Error((j && j.error) || ("archive.org migration failed (HTTP " + res.status + ")."));
    return j.url;
  }

  /* Source-document archive endpoint (site/source-npj): the dedicated webhook
     that puts an uploaded SOURCE DOCUMENT on archive.org server-side (redaction-
     gated, consent-ledgered), answering { success, archive: { identifier, url, … } }.
     Same host derivation as mediaEndpoint — it mirrors the publish webhook's host. */
  function sourceArchiveEndpoint() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.sourceArchiveEndpoint) return c.sourceArchiveEndpoint; } catch (e) {}
    const base = (root.NpjArticles && root.NpjArticles.publishEndpoint && root.NpjArticles.publishEndpoint()) || "";
    if (base) return base.replace(/\/[^/]+$/, "/source-npj");
    return "https://n8n.intelechia.com/webhook/site/source-npj";
  }

  /* archiveSource(blob, opts) → Promise<{ identifier, url, filename, mime, size_bytes }>.
     The real archive.org upload for an uploaded source document: multipart-POST the
     bytes + metadata to the site/source-npj webhook, which validates, records the
     consent ledger, and PUTs the item to archive.org server-side (the IA keys never
     touch the browser). The bytes MUST already be the redacted copy when the source
     carries redactions (see NpjSourceView.archiveBytesFor) — the server freezes what
     it's handed; it does not re-redact.

     opts: { filename, mime, title, description, license, tags, kind, research_id,
             parent_identifier, consent_acknowledged: [] }.
     Rejects loudly with the backend's message so the caller can warn the author. */
  async function archiveSource(blob, opts) {
    const o = opts || {};
    const m = MA();
    const token = m && m.token && m.token();
    if (!token) throw new Error("Sign in with Matrix to upload to archive.org.");
    if (!blob) throw new Error("Nothing to archive — the source's bytes couldn't be read.");
    const name = o.filename || (blob.name) || "document";
    const fd = new FormData();
    fd.append("file", blob, name);
    fd.append("kind", o.kind || "source");
    fd.append("filename", name);
    fd.append("title", o.title || "Archived source document");
    fd.append("description", o.description || "");
    fd.append("license", o.license || "CC-BY-4.0");
    fd.append("tags", o.tags || "");
    fd.append("mime", o.mime || (blob.type) || "application/octet-stream");
    if (o.research_id) fd.append("research_id", String(o.research_id));
    if (o.parent_identifier) fd.append("parent_identifier", String(o.parent_identifier));
    const ack = (o.consent_acknowledged && o.consent_acknowledged.length)
      ? o.consent_acknowledged : ["permanence", "privacy", "rights"];
    ack.forEach(x => fd.append("consent_acknowledged", String(x)));
    // The upload includes the author's Matrix token for Matrix-auth + the roles
    // check, and the backend's round-trip (validate → archive.org PUT) can take up
    // to a minute — generous headroom before aborting, like migrateToArchive.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    let res;
    try {
      res = await fetch(sourceArchiveEndpoint(), {
        method: "POST",
        headers: { "Authorization": "Bearer " + token },   // Content-Type is set by the browser for FormData
        body: fd,
        signal: ctrl.signal
      });
    } catch (e) {
      throw new Error(e && e.name === "AbortError"
        ? "archive.org upload timed out — the archive service took too long."
        : "Couldn't reach the archive service.");
    } finally { clearTimeout(timer); }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!j || !j.success || !j.archive) {
      const msg = (j && j.error) || (j && Array.isArray(j.errors) && j.errors.join("; ")) || ("archive.org upload failed (HTTP " + res.status + ").");
      throw new Error(msg);
    }
    return j.archive;
  }

  /* freeze(url) → Promise<archive.org URL | null>. The no-keys fallback: Save
     Page Now + verify (NpjArchiveCDN.ensureSnapshot), then rewrite to the raw
     image (im_) form so an <img> gets the bytes, not the Wayback page. */
  async function freeze(url) {
    const c = CDN();
    if (!c || !c.ensureSnapshot) return null;
    const snap = await c.ensureSnapshot(url).catch(() => null);
    if (!snap) return null;
    return (c.waybackRaw && c.waybackRaw(snap)) || snap;
  }

  const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

  // one image → archive.org, tried in order:
  //   1. server-side mxc migration (site/media-archive-npj): the backend pulls
  //      the bytes from the homeserver and PUTs them to archive.org — no byte
  //      download in the browser. Best, but optional: that webhook may not be
  //      deployed.
  //   2. download + reupload the bytes (site/media-npj → site/media-archive-npj):
  //      fetch the media-store bytes with the author's session (works even on
  //      auth-gated homeservers), POST them to media-npj to get a fresh mxc, then
  //      migrate that mxc to archive.org. Works even when the author's own network
  //      can't reach archive.org (n8n does the PUT).
  //   3. keyless Wayback snapshot of the media-store URL.
  async function toArchive(srcUrl, ctx) {
    const mxc = httpToMxc(srcUrl);
    const base = (((mxc && mxc.split("/").pop()) || ("img-" + Date.now())).replace(/[^A-Za-z0-9._-]/g, "")) || ("img-" + Date.now());
    // 1. server-side migration (no byte download)
    if (mxc) {
      try { return await migrateToArchive(mxc, { identifier: ctx.identifier, filename: base + ".webp", title: ctx.title }); }
      catch (e) { /* endpoint absent/unreachable — fall through */ }
    }
    // 2. download (authenticated) + reupload the bytes via the deployed endpoint
    try {
      const blob = await fetchBytes(srcUrl);
      if (blob) {
        const ext = EXT_BY_MIME[String(blob.type || "").toLowerCase()] || "webp";
        return await uploadToArchive(blob, { identifier: ctx.identifier, filename: base + "." + ext, title: ctx.title });
      }
    } catch (e) { /* fall through to Wayback */ }
    // 3. keyless Wayback snapshot
    return await freeze(srcUrl);
  }

  /* ---- proactive pre-archiving (composer, before publish) ----
     freezeArticleMedia runs at the publish boundary, on the EO body blocks, and
     can stall the commit ("up to a minute each"). These helpers do the same move
     EARLY, on the draft's live <image-slot> elements, so the author can pay that
     cost while they keep writing and publish stays instant.

     A draft slot carries TWO urls (see articles.js htmlToBlocks): the live
     media-store copy rides `src` (matrix-first, fast in the editor) and the
     durable archive.org copy rides `data-alt`. Pre-archiving fills that data-alt.
     At publish, htmlToBlocks promotes the data-alt to the block's canonical src
     and freezeArticleMedia's freezeOne skips it (its src is no longer a store
     URL) — nothing left to move. */

  // Does this slot still owe an archive.org upload? True only when its `src` is a
  // media-store URL AND it doesn't already carry an archive.org copy in data-alt.
  // Empty, external, or already-archived slots return false — never re-uploaded.
  function slotNeedsArchive(slot) {
    if (!slot || !slot.getAttribute) return false;
    if (!isStoreUrl(slot.getAttribute("src"))) return false;
    const alt = slot.getAttribute("data-alt");
    const c = CDN();
    return !(alt && c && c.isMediaUrl(alt));
  }

  /* prearchiveCensus(rootEl) → { total, pending, archived }. Cheap, DOM-only:
     counts the draft's filled image-slots, how many still owe an archive.org
     upload (pending), and how many already have a durable copy (archived). Backs
     the composer's "Pre-archive media" affordance without uploading anything. */
  function prearchiveCensus(rootEl) {
    const out = { total: 0, pending: 0, archived: 0 };
    if (!rootEl || !rootEl.querySelectorAll) return out;
    const c = CDN();
    Array.from(rootEl.querySelectorAll("image-slot")).forEach(slot => {
      const src = slot.getAttribute("src");
      if (!src) return;
      out.total++;
      if (slotNeedsArchive(slot)) out.pending++;
      else if ((c && c.isMediaUrl(src)) || (c && c.isMediaUrl(slot.getAttribute("data-alt")))) out.archived++;
    });
    return out;
  }

  /* prearchiveSlots(rootEl, {slug, title, onProgress}) → Promise<{total, archived, failed, failReasons}>.
     Walks the draft's image-slots and moves every one still on the media store
     onto archive.org, writing the durable URL into data-alt (the live media-store
     src is left untouched, so the editor keeps rendering the fast copy). Only the
     pending slots are touched; external / already-archived ones are skipped.
     onProgress(done, total) fires after each slot for a live count. Never throws
     for a single failed image — it records the reason and moves on, so one
     unreachable photo can't sink the rest. */
  async function prearchiveSlots(rootEl, opts) {
    const o = opts || {};
    const out = { total: 0, archived: 0, failed: 0, failReasons: [] };
    if (!rootEl || !rootEl.querySelectorAll) return out;
    const idSlug = String(o.slug || "media").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "media";
    const ctx = { identifier: "npj-" + idSlug, title: o.title || o.slug || "NPJ media" };
    const slots = Array.from(rootEl.querySelectorAll("image-slot")).filter(slotNeedsArchive);
    out.total = slots.length;
    let done = 0;
    for (const slot of slots) {
      let arch = null, reason = null;
      try {
        arch = await toArchive(slot.getAttribute("src"), ctx);
        if (!arch) reason = "archive.org upload returned no URL (n8n endpoint unreachable or IA keys missing)";
      } catch (e) { reason = (e && e.message) || "unknown error"; }
      if (arch) { slot.setAttribute("data-alt", arch); out.archived++; }
      else { out.failed++; if (reason && out.failReasons.indexOf(reason) < 0) out.failReasons.push(reason); }
      done++;
      if (typeof o.onProgress === "function") { try { o.onProgress(done, out.total, slot); } catch (e) {} }
    }
    return out;
  }

  /* freezeArticleMedia(body, {slug, title}) → Promise<{ frozen, failed, failReasons, method }>.
     Walks the EO article body blocks and moves every img still on the media
     store onto archive.org, rewriting its src in place. On failure the block
     is left untouched and a reason string is pushed to failReasons — the
     caller must treat failed > 0 as a hard error (Matrix URLs must not land
     in the committed record). */
  async function freezeArticleMedia(body, opts) {
    const out = { frozen: 0, failed: 0, failReasons: [], method: "upload" };
    if (!Array.isArray(body)) return out;
    const o = opts || {};
    const idSlug = String(o.slug || "media").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "media";
    const ctx = { identifier: "npj-" + idSlug, title: o.title || o.slug || "NPJ media" };
    // Freeze ONE image-bearing object ({src, store?}) in place: move a media-store
    // src onto archive.org and keep the live copy as `store`. A non-store src
    // (already archived, or empty) is a no-op. Shared by single inline images and
    // every slide of a carousel, so a gallery freezes exactly like a lone photo.
    const freezeOne = async (im) => {
      if (!im || !isStoreUrl(im.src)) return;
      const matrixUrl = im.src;
      let arch = null, reason = null;
      try {
        arch = await toArchive(im.src, ctx);
        if (!arch) reason = "archive.org upload returned no URL (n8n endpoint unreachable or IA keys missing)";
      } catch (e) { reason = e.message || "unknown error"; }
      if (arch) {
        // keep the live media-store URL as `store` so viewers can try it first
        // and fall back to the durable archive.org `src`.
        im.store = matrixUrl; im.src = arch; out.frozen++;
      } else {
        out.failed++;
        if (reason && out.failReasons.indexOf(reason) < 0) out.failReasons.push(reason);
      }
    };
    for (const b of body) {
      if (!b) continue;
      if (b.type === "img") await freezeOne(b);
      else if (b.type === "gallery" && Array.isArray(b.images)) {
        for (const im of b.images) await freezeOne(im);
      }
    }
    return out;
  }

  root.NpjMedia = {
    canUpload, isStoreUrl, isPublishable, mxcToHttp, httpToMxc, mediaEndpoint, archiveEndpoint, sourceArchiveEndpoint,
    upload, uploadViaBackend, uploadLimit, fetchBytes, resolveDisplay, uploadToArchive, migrateToArchive, archiveSource,
    freeze, freezeArticleMedia, slotNeedsArchive, prearchiveCensus, prearchiveSlots
  };

  // node tests require() the pure DOM helpers (slotNeedsArchive / prearchiveCensus);
  // the browser path is unchanged (root === window). No DOM/network runs at load.
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjMedia;
})(typeof window !== "undefined" ? window : globalThis);
