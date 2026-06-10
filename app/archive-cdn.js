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

  /* ---- read the SOURCE's text, so a citation can search/explore it ----
     A snapshot isn't just a permalink — it's a readable copy. We pull the
     archived HTML (the wayback `id_` flavor serves the raw page, toolbar-free
     and CORS-open) and reduce it to clean blocks of text the Newsroom's source
     explorer can search and select passages from. Fails soft: any block (no
     snapshot, CORS, a JS-only page) returns null and the editor falls back to
     letting the author paste the passage by hand. */
  function waybackId(u) {
    const m = String(u || "").match(/^(https?:\/\/web\.archive\.org\/web\/\d{1,14})(?:[a-z]{2}_)?(\/.+)$/i);
    return m ? (m[1].replace(/^http:/, "https:") + "id_" + m[2]) : null;
  }
  function htmlToReadableText(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
      doc.querySelectorAll("script,style,noscript,nav,header,footer,svg,form,aside,figure,iframe,button").forEach(n => n.remove());
      const main = doc.querySelector("article, main, [role=main], .available-content, .body.markup, .post-content") || doc.body;
      if (!main) return "";
      const blocks = [];
      let last = "";
      main.querySelectorAll("h1,h2,h3,h4,p,li,blockquote").forEach(el => {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 1 && t !== last) { blocks.push(t); last = t; }
      });
      let out = blocks.join("\n\n");
      if (out.length < 80) out = (main.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      return out;
    } catch (e) { return ""; }
  }
  // returns { text, via } or null
  async function fetchSourceText(rec) {
    rec = rec || {};
    if (rec.text && String(rec.text).trim().length > 40) return { text: String(rec.text), via: "pasted" };
    let snap = rec.archive_url || null;
    if (!snap && rec.original_url) snap = await waybackAvailable(rec.original_url).catch(() => null);
    const tryUrls = [];
    const idv = snap && waybackId(snap);
    if (idv) tryUrls.push(idv);
    if (snap) tryUrls.push(String(snap).replace(/^http:/, "https:"));
    if (rec.original_url) tryUrls.push(rec.original_url); // live page — usually CORS-blocked, but cheap to try last
    for (let i = 0; i < tryUrls.length; i++) {
      try {
        const res = await fetch(tryUrls[i], { cache: "no-store" });
        if (!res.ok) continue;
        const text = htmlToReadableText(await res.text());
        if (text && text.length > 80) return { text, via: tryUrls[i] };
      } catch (e) { /* try the next candidate */ }
    }
    return null;
  }

  /* ---- passage tools (shared by the source explorer and Clippy) ---- */
  const STOP = new Set("the a an and or but for nor so of to in on at by with from into over under after before about as is are was were be been being it its their there here they them then than have has had will would could should may might must can not you your our we us this that these those if".split(/\s+/));
  const words = (s) => (String(s || "").toLowerCase().match(/[a-z0-9][a-z0-9'’-]{2,}/g) || []).filter(w => !STOP.has(w));
  // split source text into selectable passages: paragraphs, and long paragraphs
  // further into sentences, so the author can pick something tight
  function splitPassages(text) {
    const out = [];
    String(text || "").split(/\n{2,}|\r?\n/).map(p => p.trim()).filter(p => p.length > 1).forEach(p => {
      out.push(p);
      if (p.length > 240) {
        (p.match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).map(s => s.trim()).filter(s => s.length > 24).forEach(s => { if (s !== p) out.push(s); });
      }
    });
    // de-dupe while keeping order
    const seen = {}; return out.filter(p => (seen[p] ? false : (seen[p] = 1)));
  }
  // rank passages by how much of the claim's vocabulary they carry
  function rankPassages(claimText, passages, limit) {
    const want = new Set(words(claimText));
    if (!want.size) return [];
    return (passages || []).map(p => {
      const seen = new Set(); let hit = 0;
      words(p).forEach(w => { if (want.has(w) && !seen.has(w)) { seen.add(w); hit++; } });
      return { text: p, hit, score: hit / want.size };
    }).filter(x => x.hit > 0).sort((a, b) => b.score - a.score || a.text.length - b.text.length).slice(0, limit || 5);
  }

  window.NpjArchiveCDN = { isMediaUrl, resolve, waybackRaw, waybackAvailable, requestSnapshot, ensureSnapshot, waybackId, fetchSourceText, splitPassages, rankPassages };
})();
