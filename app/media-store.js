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

  /* ---- archive.org S3 credentials (the admin's, stored locally) ----
     From https://archive.org/account/s3.php — access key + secret. Kept in
     localStorage so the static site needs no server to upload. Optional: with
     no keys, publish uses the credential-free Wayback fallback instead. */
  const IA_KEY = "npj_ia_s3_v1";
  function getArchiveCreds() {
    try { const c = JSON.parse(localStorage.getItem(IA_KEY) || "null"); return (c && c.access && c.secret) ? c : null; }
    catch (e) { return null; }
  }
  function setArchiveCreds(access, secret, collection) {
    try {
      if (!access || !secret) { localStorage.removeItem(IA_KEY); return; }
      const c = { access: String(access).trim(), secret: String(secret).trim() };
      const col = (collection || "").trim(); if (col) c.collection = col;
      localStorage.setItem(IA_KEY, JSON.stringify(c));
    } catch (e) {}
  }
  function hasArchiveCreds() { return !!getArchiveCreds(); }

  // header values must be latin1-safe — strip anything fetch would reject.
  const hdrSafe = (s) => String(s || "").replace(/[^\x20-\x7E]/g, "").slice(0, 200);

  /* uploadToArchive(blob, {identifier, filename, title}) → Promise<archive.org URL>.
     PUTs one file into an archive.org item (auto-created on first PUT). The item
     is keyed per article so re-publishing the same piece reuses it. */
  async function uploadToArchive(blob, opts) {
    const creds = getArchiveCreds();
    if (!creds) throw new Error("No archive.org keys set.");
    const id = opts.identifier, file = opts.filename;
    const headers = {
      "authorization": "LOW " + creds.access + ":" + creds.secret,
      "x-amz-auto-make-bucket": "1",
      "x-archive-meta-mediatype": "image",
      "x-archive-meta-subject": "npj-media",
      "Content-Type": (blob && blob.type) || "application/octet-stream"
    };
    // Only pin a collection if the admin set one — an unauthorized collection
    // header makes archive.org reject the PUT; default lets it auto-assign.
    if (creds.collection) headers["x-archive-meta-collection"] = hdrSafe(creds.collection);
    if (opts.title) headers["x-archive-meta-title"] = hdrSafe(opts.title);
    let res;
    try {
      res = await fetch("https://s3.us.archive.org/" + encodeURIComponent(id) + "/" + encPath(file), {
        method: "PUT", headers, body: blob
      });
    } catch (e) { throw new Error("Couldn't reach archive.org."); }
    if (res.status === 401 || res.status === 403) throw new Error("archive.org rejected the keys (HTTP " + res.status + ").");
    if (!res.ok) throw new Error("archive.org upload failed (HTTP " + res.status + ").");
    return "https://archive.org/download/" + encodeURIComponent(id) + "/" + encPath(file);
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

  // one image → archive.org: download+reupload when keys exist, else Wayback.
  async function toArchive(srcUrl, ctx) {
    if (hasArchiveCreds()) {
      try {
        const blob = await fetchBytes(srcUrl);
        if (blob) {
          const mediaId = (String(srcUrl).split("/download/")[1] || "").split("/").pop() || ("img-" + Date.now());
          const file = (mediaId.replace(/[^A-Za-z0-9._-]/g, "") || ("img-" + Date.now())) + ".webp";
          return await uploadToArchive(blob, { identifier: ctx.identifier, filename: file, title: ctx.title });
        }
      } catch (e) { /* fall through to Wayback */ }
    }
    return await freeze(srcUrl);
  }

  /* freezeArticleMedia(body, {slug, title}) → Promise<{ frozen, failed, method }>.
     Walks the EO article body blocks and moves every img still on the media
     store onto archive.org, rewriting its src in place. A failure leaves the
     media-store URL untouched (never a silent drop) and is counted. */
  async function freezeArticleMedia(body, opts) {
    const out = { frozen: 0, failed: 0, method: hasArchiveCreds() ? "upload" : "wayback" };
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
    canUpload, isStoreUrl, isPublishable, mxcToHttp,
    upload, fetchBytes, resolveDisplay,
    getArchiveCreds, setArchiveCreds, hasArchiveCreds, uploadToArchive,
    freeze, freezeArticleMedia
  };
})();
