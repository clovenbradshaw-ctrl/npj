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

  /* ---- proxy for archive.org images ----
     A published <img> can hotlink archive.org directly (no CORS needed), but on
     a network that can't reach archive.org — behind a VPN that blocks it, or
     when it's rate-limited/down — that GET just fails. proxied(url) wraps a URL
     as a ?url= request to a same-host proxy that re-fetches the bytes
     server-side (it CAN reach archive.org), so the image still loads.

     Public pages always load archive.org images THROUGH the proxy first and
     keep the direct archive.org URL as the only fallback — that's what makes
     images show on networks that block archive.org, with no failed-request
     flash first (see imageCandidates in ArticleRead).

     Endpoint: npj_publish_cfg_v1.proxyEndpoint, else derived from the publish
     host (.../webhook/img), else a hard default. The proxy MUST return the raw
     image bytes — a text/xml proxy (like the RSS /webhook/feed one) corrupts
     binary images, so a configured /feed endpoint is ignored here; see
     backend/npj-image-proxy.n8n.json for a binary-safe one. */
  function proxyBase() {
    try {
      const c = JSON.parse(localStorage.getItem("npj_publish_cfg_v1") || "null");
      // A configured endpoint wins — unless it's the RSS feed proxy, which
      // re-encodes bytes as text and corrupts images. The /img proxy is binary-safe.
      if (c && c.proxyEndpoint && !/\/feed\/?$/i.test(String(c.proxyEndpoint))) return String(c.proxyEndpoint);
    } catch (e) {}
    const pub = (window.NpjArticles && window.NpjArticles.publishEndpoint && window.NpjArticles.publishEndpoint()) || "";
    const m = pub.match(/^(https?:\/\/[^/]+\/webhook)\//i);
    if (m) return m[1] + "/img";
    return "https://n8n.intelechia.com/webhook/img";
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
  /* A stalled archive.org connection must never hang the caller — that's the
     "snapshotting…" spinner that never stops. Every request below is raced
     against a hard timeout (AbortController): on a slow/blocked network it
     aborts and settles instead of waiting forever. The source is already saved
     and citable by then; the snapshot is a best-effort enhancement on top. */
  function fetchT(url, ms, opts) {
    const o = Object.assign({ cache: "no-store" }, opts || {});
    let ctl = null, timer = null;
    if (typeof AbortController !== "undefined") {
      ctl = new AbortController(); o.signal = ctl.signal;
      timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, ms || 8000);
    }
    const done = () => { if (timer) { clearTimeout(timer); timer = null; } };
    return fetch(url, o).then(r => { done(); return r; }, e => { done(); throw e; });
  }

  async function waybackAvailable(url) {
    const res = await fetchT("https://archive.org/wayback/available?url=" + encodeURIComponent(url), 8000, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    const c = j && j.archived_snapshots && j.archived_snapshots.closest;
    return (c && c.available && c.url) ? String(c.url).replace(/^http:/, "https:") : null;
  }
  function requestSnapshot(url) {
    // Save Page Now is opaque to CORS (no-cors) and fire-and-forget; the timeout
    // just keeps a stalled save from leaking an open connection.
    try { fetchT("https://web.archive.org/save/" + url, 12000, { mode: "no-cors" }).catch(() => {}); } catch (e) {}
  }
  // Confirm (or trigger, then confirm) a wayback capture. ALWAYS settles: every
  // availability probe is time-bounded, so the worst case is a null "unconfirmed"
  // — never a promise that hangs the "snapshotting…" row. SPN can be slow or
  // rate-limited for anonymous saves; the caller degrades to "snapshot only" and
  // the source stays fully usable + citable in the meantime (re-try via Archive).
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

  /* ---- best-effort page identity (the source's real title + outlet) ----
     A web source ships with a generic "Web snapshot" title; this reads the
     page's own <title>/og: tags so the library can name it. The Wayback Machine
     serves archived captures with `Access-Control-Allow-Origin: *`, so the
     archived HTML is fetchable from the browser even when the live site isn't.
     ALWAYS settles: every fetch is time-bounded, parsing is handed to the pure
     NpjSourceTitle pack, and any failure returns {} — never throws. */
  function rawPageUrl(archiveUrl) {
    const m = String(archiveUrl || "").match(/^(https:\/\/web\.archive\.org\/web\/\d{1,14})(?:[a-z]{2}_)?(\/.+)$/i);
    return m ? m[1] + "id_" + m[2] : null;   // id_ = the raw capture, no Wayback toolbar
  }
  async function pageMeta(opts) {
    opts = opts || {};
    const T = window.NpjSourceTitle;
    if (!T) return {};
    const tries = [];
    const raw = opts.archiveUrl ? rawPageUrl(opts.archiveUrl) : null;
    if (raw) tries.push(raw);
    if (opts.archiveUrl) tries.push(opts.archiveUrl);
    if (opts.url) tries.push(opts.url);      // the live page last — often CORS-blocked, but cheap to try
    for (const u of tries) {
      try {
        const res = await fetchT(u, 9000, { headers: { Accept: "text/html,application/xhtml+xml" } });
        if (!res || !res.ok) continue;
        const html = (await res.text()).slice(0, 300000);   // headers/og live up top; cap the read
        const meta = T.metaFromHtml(html);
        if (meta && (meta.title || meta.site)) return meta;
      } catch (e) { /* try the next candidate */ }
    }
    return {};
  }

  window.NpjArchiveCDN = { isMediaUrl, resolve, proxied, proxyBase, waybackRaw, waybackAvailable, requestSnapshot, ensureSnapshot, rawPageUrl, pageMeta };
})();
