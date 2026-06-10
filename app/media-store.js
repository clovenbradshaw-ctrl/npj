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
 * Publish has two ways to get an image onto archive.org, tried in order:
 *   1. Download + reupload (preferred): fetch the bytes from the media store
 *      with the author's token and PUT them to archive.org as a real item via
 *      the S3-style API. Works even when the homeserver gates media behind auth,
 *      because WE do the authenticated download. Needs the admin's archive.org
 *      S3 keys (archive.org/account/s3.php), stored locally — set in the admin
 *      panel.
 *   2. Wayback freeze (fallback, no keys): Save Page Now on the media-store URL,
 *      the same path the app already uses to freeze sources. Only reaches the
 *      bytes if the homeserver serves media unauthenticated.
 * If neither confirms, the image keeps its media-store URL (never a silent drop)
 * and the publisher is told.
 *
 * The Matrix upload uses the author's existing session (window.MatrixAuth); the
 * Wayback path uses window.NpjArchiveCDN. Both are optional — absent them the
 * helpers degrade and <image-slot> falls back to a session-only preview.
 *
 * Exposed as window.NpjMedia.
 */
(function () {
  'use strict';

  const MA = () => window.MatrixAuth;
  const CDN = () => window.NpjArchiveCDN;
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
    if (res.status === 413) throw new Error("That image is too large for the media store.");
    if (!res.ok) throw new Error("Media upload failed (HTTP " + res.status + ").");
    let j = null; try { j = await res.json(); } catch (e) {}
    const mxc = j && j.content_uri;
    if (!mxc) throw new Error("The media store returned no URL.");
    return { url: mxcToHttp(mxc, base), mxc };
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
    const base = (window.NpjArticles && window.NpjArticles.publishEndpoint && window.NpjArticles.publishEndpoint()) || "";
    if (base) return base.replace(/\/[^/]+$/, "/media-npj");
    return "https://n8n.intelechia.com/webhook/site/media-npj";
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

  // one image → archive.org: download the bytes (authed) and push them through
  // the backend; if that can't be reached, fall back to a Wayback snapshot.
  async function toArchive(srcUrl, ctx) {
    try {
      const blob = await fetchBytes(srcUrl);
      if (blob) {
        const mediaId = (String(srcUrl).split("/download/")[1] || "").split("/").pop() || ("img-" + Date.now());
        const file = (mediaId.replace(/[^A-Za-z0-9._-]/g, "") || ("img-" + Date.now())) + ".webp";
        return await uploadToArchive(blob, { identifier: ctx.identifier, filename: file, title: ctx.title });
      }
    } catch (e) { /* fall through to Wayback */ }
    return await freeze(srcUrl);
  }

  /* freezeArticleMedia(body, {slug, title}) → Promise<{ frozen, failed, method }>.
     Walks the EO article body blocks and moves every img still on the media
     store onto archive.org, rewriting its src in place. A failure leaves the
     media-store URL untouched (never a silent drop) and is counted. */
  async function freezeArticleMedia(body, opts) {
    const out = { frozen: 0, failed: 0, method: "upload" };
    if (!Array.isArray(body)) return out;
    const o = opts || {};
    const idSlug = String(o.slug || "media").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "media";
    const ctx = { identifier: "npj-" + idSlug, title: o.title || o.slug || "NPJ media" };
    for (const b of body) {
      if (!b || b.type !== "img" || !isStoreUrl(b.src)) continue;
      const arch = await toArchive(b.src, ctx);
      if (arch) { b.src = arch; out.frozen++; } else { out.failed++; }
    }
    return out;
  }

  window.NpjMedia = {
    canUpload, isStoreUrl, isPublishable, mxcToHttp, mediaEndpoint,
    upload, fetchBytes, resolveDisplay, uploadToArchive,
    freeze, freezeArticleMedia
  };
})();
