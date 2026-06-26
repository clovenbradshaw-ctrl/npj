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
 *   2. Download + reupload (site/media-npj): fetch the media-store bytes with the
 *      author's session (works on auth-gated homeservers) and POST them to the
 *      media endpoint, which PUTs to archive.org. This endpoint ships with
 *      publish, and works even when the AUTHOR's network can't reach archive.org
 *      (n8n does the PUT). The archive.org S3 keys live server-side, never in the
 *      browser.
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
    } catch (e) { throw new Error("Couldn't reach the media store."); }
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
      try { const r = await fetch(u, { headers }); if (r.ok) return await r.blob(); } catch (e) {}
    }
    return null;
  }

  /* resolveDisplay(url) → a URL the <img> can actually render.
     Homeservers running authenticated media (Matrix 1.11+) refuse an
     unauthenticated <img> GET, so when display is needed we fetch the bytes
     with the session token and hand back a blob: URL. Signed-out or non-store
     URLs pass straight through. Best-effort — returns the original on failure. */
  async function resolveDisplay(url) {
    if (!isStoreUrl(url) || !canUpload()) return url;
    const b = await fetchBytes(url);
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
     POSTs the bytes (base64) + the author's Matrix token to the n8n media
     endpoint; n8n PUTs to archive.org and answers { ok, url } (or { ok:false,
     error }). Rejects loudly so the caller can fall back or warn. */
  async function uploadToArchive(blob, opts) {
    const m = MA();
    const token = m && m.token && m.token();
    if (!token) throw new Error("Sign in to upload to archive.org.");
    const b64 = await blobToBase64(blob);
    let res;
    try {
      res = await fetch(mediaEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          identifier: opts.identifier, filename: opts.filename,
          mimetype: (blob && blob.type) || "image/webp",
          title: opts.title || "", contentBase64: b64
        })
      });
    } catch (e) { throw new Error("Couldn't reach the media upload service."); }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok || !j.url) throw new Error((j && j.error) || ("archive.org upload failed (HTTP " + res.status + ")."));
    return j.url;
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
  //   2. download + reupload the bytes (site/media-npj): fetch the media-store
  //      bytes with the author's session (works even on auth-gated homeservers)
  //      and POST them to the media endpoint that PUTs to archive.org. This is
  //      the endpoint that always ships with publish, and it works even when the
  //      author's own network can't reach archive.org (n8n does the PUT).
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
    canUpload, isStoreUrl, isPublishable, mxcToHttp, httpToMxc, mediaEndpoint, archiveEndpoint,
    upload, uploadLimit, fetchBytes, resolveDisplay, uploadToArchive, migrateToArchive,
    freeze, freezeArticleMedia, slotNeedsArchive, prearchiveCensus, prearchiveSlots
  };

  // node tests require() the pure DOM helpers (slotNeedsArchive / prearchiveCensus);
  // the browser path is unchanged (root === window). No DOM/network runs at load.
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjMedia;
})(typeof window !== "undefined" ? window : globalThis);
