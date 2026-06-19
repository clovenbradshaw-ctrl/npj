/* NPJ — archive.org is the media CDN.
   Turns any archive.org link — a details page, a download link, a wayback
   capture — into a direct, hotlinkable image URL served by the Internet
   Archive. <image-slot> uses this to accept link drops/pastes, and the
   Newsroom serializes the resolved URL into the published markdown, so
   article images live on archive.org instead of inside the draft.

   The flow: upload the image at https://archive.org/upload (tag it
   `npj-media` if you want your library greppable, same convention as
   `npj-source`), then drop the item's link onto any image slot. */
(function () {
  // hosts we hotlink from: archive.org itself, its data nodes
  // (ia######.us.archive.org) and the wayback machine — nothing else
  const HOST = /^https:\/\/(?:[a-z0-9-]+\.)*archive\.org\//i;
  // <img> can't run script, so svg is safe to allow here even though
  // <image-slot> refuses it for local file drops
  const IMG_EXT = /\.(png|jpe?g|webp|avif|gif|svg)(\?[^#]*)?(#.*)?$/i;

  function isMediaUrl(u) { return HOST.test(String(u || "").trim()); }

  /* ---- proxy fallback for when archive.org itself is unreachable ----
     A published <img> hotlinks archive.org directly (no CORS needed), but when
     the reader's network can't reach archive.org at all — it's blocked, rate-
     limited, or down — even a plain <img> GET fails. proxied(url) wraps any URL
     as a ?url= request to a same-host proxy that re-fetches the bytes
     server-side; the reader falls back to it when the direct archive.org load
     errors (see MediaImg in ArticleRead.jsx). Configurable via
     npj_publish_cfg_v1.proxyEndpoint; otherwise derived from the publish host
     (.../webhook/feed), then a hard default. The proxy must answer with the raw
     image bytes — a text/xml proxy corrupts binary images. */
  function proxyBase() {
    try { const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.proxyEndpoint) return String(c.proxyEndpoint); } catch (e) {}
    const pub = (window.NpjArticles && window.NpjArticles.publishEndpoint && window.NpjArticles.publishEndpoint()) || "";
    const m = pub.match(/^(https?:\/\/[^/]+\/webhook)\//i);
    if (m) return m[1] + "/feed";
    return "https://n8n.intelechia.com/webhook/feed";
  }
  function proxied(url) {
    const u = String(url || "").trim();
    if (!u) return null;
    const base = proxyBase();
    if (!base) return null;
    if (u.indexOf(base) === 0) return u; // already proxied — never double-wrap
    return base + (base.indexOf("?") < 0 ? "?" : "&") + "url=" + encodeURIComponent(u);
  }

  // wayback capture → the same capture with the im_ flag, which serves the
  // raw image bytes instead of the toolbar-wrapped page
  function waybackRaw(u) {
    const m = u.match(/^(https:\/\/web\.archive\.org\/web\/\d{1,14})(?:[a-z]{2}_)?(\/.+)$/i);
    return m ? m[1] + "im_" + m[2] : null;
  }

  // an item's primary image: originals beat derivatives, bigger beats
  // smaller, and the auto-generated thumbnail never wins
  function pickImage(files) {
    const imgs = (files || []).filter(f =>
      f && f.name && IMG_EXT.test(f.name) &&
      !/(^|\/)__ia_thumb\.jpg$/i.test(f.name) &&
      String(f.format || "").toLowerCase().indexOf("thumb") < 0);
    if (!imgs.length) return null;
    const originals = imgs.filter(f => (f.source || "") === "original");
    const pool = originals.length ? originals : imgs;
    pool.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
    return pool[0].name;
  }

  const encPath = (name) => name.split("/").map(encodeURIComponent).join("/");
  const downloadUrl = (id, name) => "https://archive.org/download/" + encodeURIComponent(id) + "/" + encPath(name);

  /* resolve(link) → Promise<direct image URL>.
     Async because a bare details/download link costs one metadata fetch
     (CORS-open, like the advancedsearch call in archive-sources.js) to find
     the item's image file. Rejects with a human-readable message. */
  async function resolve(raw) {
    const u = String(raw || "").trim();
    if (!isMediaUrl(u)) throw new Error("Use an archive.org link — a details page, download link, or wayback capture.");
    const wb = waybackRaw(u);
    if (wb) return wb;
    // item links first: a details/<id>/<file> URL ends in the file's name but
    // serves the HTML viewer, so it must be rewritten to /download/, never
    // returned as-is
    const m = u.match(/^https:\/\/archive\.org\/(?:details|download)\/([^/?#]+)(?:\/([^?#]+))?/i);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const path = m[2] ? decodeURIComponent(m[2]) : "";
      if (path && IMG_EXT.test(path)) return downloadUrl(id, path);
      // bare item (or a non-image file path) → the item's primary image
      const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(id), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("archive.org metadata lookup failed (HTTP " + res.status + ").");
      const j = await res.json();
      const name = pickImage(j && j.files);
      if (!name) throw new Error("No image file in that archive.org item.");
      return downloadUrl(id, name);
    }
    if (IMG_EXT.test(u)) return u; // a direct file on an IA data node
    throw new Error("That archive.org link isn't an item or an image file.");
  }

  /* ---- real source snapshots (wayback machine) ----
     "Archived" is never painted on hope: a snapshot only counts once the
     CORS-open availability API confirms a capture exists. Saving goes through
     anonymous Save Page Now — that request is opaque to CORS (no-cors), so
     ensureSnapshot() requests, then polls availability for the confirmation. */
  async function waybackAvailable(url) {
    const res = await fetch("https://archive.org/wayback/available?url=" + encodeURIComponent(url), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    const c = j && j.archived_snapshots && j.archived_snapshots.closest;
    return (c && c.available && c.url) ? String(c.url).replace(/^http:/, "https:") : null;
  }
  function requestSnapshot(url) {
    try { fetch("https://web.archive.org/save/" + url, { mode: "no-cors", cache: "no-store" }).catch(() => {}); } catch (e) {}
  }
  async function ensureSnapshot(url, tries = 2, waitMs = 3500) {
    let snap = await waybackAvailable(url).catch(() => null);
    if (snap) return snap;
    requestSnapshot(url);
    for (let i = 0; i < tries; i++) {
      await new Promise(r => setTimeout(r, waitMs));
      snap = await waybackAvailable(url).catch(() => null);
      if (snap) return snap;
    }
    return null; // honestly unconfirmed — SPN can take a while; a later check may find it
  }

  window.NpjArchiveCDN = { isMediaUrl, resolve, proxied, proxyBase, waybackRaw, waybackAvailable, requestSnapshot, ensureSnapshot };
})();
