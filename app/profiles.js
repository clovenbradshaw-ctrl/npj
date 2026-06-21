/* profiles.js — contributor profiles (the byline): display name + a ≤250-char
 * "About me". window.NpjProfiles.
 *
 * Where a profile lives, in order of durability:
 *   1. PUBLIC  — site/layout.json `contributors` map (world-readable on GitHub,
 *      the requested "variable"). Written by an admin's "Publish layout".
 *   2. DURABLE — the contributor's own Matrix account data (press.npj.profile):
 *      survives a browser wipe / device switch, recovered on next login. This is
 *      how a non-admin keeps their own About me even before an admin publishes it.
 *   3. LOCAL   — this browser's localStorage (instant, offline).
 *
 * The display NAME defaults from the contributor's Matrix account (their
 * homeserver displayname) — "pull from their account info" — so a new
 * contributor's byline is right without typing anything.
 *
 * No model, no secrets: this is plain account data + a public JSON field. */
(function () {
  const LS_KEY = "npj_profiles_v1";        // { "@mxid": { name, bio, updated } }
  const ACCOUNT_DATA_TYPE = "press.npj.profile"; // per-account, server-side, private until published
  const BIO_MAX = 250, NAME_MAX = 80;

  function clamp(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function clean(p) {
    const out = { name: clamp(p && p.name, NAME_MAX), bio: clamp(p && p.bio, BIO_MAX) };
    out.updated = (p && p.updated) || new Date().toISOString();
    return out;
  }

  // A stable, readable color per mxid (so a handle/initial keeps one color across
  // sessions and devices). Deterministic hash → a fixed, AA-legible palette.
  const PALETTE = ["#b23a26", "#1f6f54", "#2b5fa6", "#9a5b16", "#6c3f9e", "#0f7a86", "#a23270", "#3c6b1f"];
  function colorFor(mxid) {
    let h = 0; const s = String(mxid || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /* ---------- bio rich text: safe inline links ----------
     The "About me" is plain text the contributor authors and we render to every
     visitor (public, world-readable), so links are PARSED but never TRUSTED.
     safeHref is the gate: it strips chars a browser ignores mid-scheme (so
     "java\tscript:…" can't sneak past), then accepts a URL only if it parses to
     http(s) — or a validated mailto. The renderer (window.npjRichText, in
     shared.jsx) puts the label/plain text in React text nodes (auto-escaped) and
     only ever sets an href that cleared this function — never innerHTML.
     Syntax: [label](https://example.com); bare https://… and www.… auto-link. */
  function safeHref(raw) {
    let u = String(raw == null ? "" : raw).trim();
    if (!u) return null;
    u = u.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    if (!u) return null;
    if (/^mailto:/i.test(u)) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(u) ? u : null;
    // No scheme → assume https, so [label](example.com) and www.x.com work.
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(u)) u = "https://" + u.replace(/^\/+/, "");
    let parsed;
    try { parsed = new URL(u); } catch (e) { return null; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.hostname.indexOf(".") === -1) return null; // need a dotted host
    return parsed.href;
  }

  // Split a bio into plain-text + link tokens: [{type:'text',text} | {type:'link',href,label}].
  // Pure + headless (no React) so it's unit-testable and reusable. Markdown
  // [label](url) is parsed first; bare http(s)/www URLs in the gaps auto-link.
  // A link whose URL fails safeHref is left as the literal text the user typed —
  // mxids like @a:b.c carry no scheme, so they never become links.
  function linkTokens(text) {
    const src = String(text == null ? "" : text);
    const out = [];
    const AUTO = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/gi;
    function pushPlain(s) {
      if (!s) return;
      let l = 0, m; AUTO.lastIndex = 0;
      while ((m = AUTO.exec(s))) {
        let url = m[0], trail = "";
        const tm = url.match(/[.,;:!?'")]+$/); // don't swallow sentence punctuation into the link
        if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
        if (m.index > l) out.push({ type: "text", text: s.slice(l, m.index) });
        const href = safeHref(url);
        if (href) out.push({ type: "link", href: href, label: url.replace(/^https?:\/\//i, "") });
        else out.push({ type: "text", text: url });
        if (trail) out.push({ type: "text", text: trail });
        l = m.index + m[0].length;
      }
      if (l < s.length) out.push({ type: "text", text: s.slice(l) });
    }
    const MD = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g;
    let last = 0, mm;
    while ((mm = MD.exec(src))) {
      if (mm.index > last) pushPlain(src.slice(last, mm.index));
      const href = safeHref(mm[2]);
      if (href) out.push({ type: "link", href: href, label: mm[1] });
      else out.push({ type: "text", text: mm[0] });
      last = mm.index + mm[0].length;
    }
    if (last < src.length) pushPlain(src.slice(last));
    return out;
  }
  // Does this bio contain at least one renderable link? (drives the editor preview)
  function hasLink(text) { return linkTokens(text).some(function (t) { return t.type === "link"; }); }

  /* ---------- localStorage ---------- */
  function readAllLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function writeAllLocal(map) { try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch (e) {} }
  function loadLocal(mxid) { return (readAllLocal()[mxid]) || null; }
  function saveLocal(mxid, profile) {
    if (!mxid) return; const all = readAllLocal(); all[mxid] = clean(profile); writeAllLocal(all);
  }

  /* ---------- reflect a profile into the live people registry ----------
     so the reader byline + masthead show the new name/bio immediately, without
     waiting for a publish or a reload. */
  function reflect(mxid, profile) {
    if (!mxid || !window.NPJ || !window.NPJ.PEOPLE) return;
    const prev = window.NPJ.PEOPLE[mxid] || {};
    window.NPJ.PEOPLE[mxid] = Object.assign({}, prev, {
      name: (profile && profile.name) || prev.name || mxid.replace(/^@/, "").split(":")[0],
      bio: (profile && profile.bio != null) ? profile.bio : (prev.bio || ""),
      color: prev.color || colorFor(mxid)
    });
  }

  /* ---------- the contributor's Matrix account (durable) ---------- */
  async function fetchAccountData(session) {
    const A = window.MatrixAuth;
    if (!A || !A.getAccountData) return null;
    try { return await A.getAccountData(ACCOUNT_DATA_TYPE); } catch (e) { return null; }
  }
  async function writeAccountData(profile) {
    const A = window.MatrixAuth;
    if (!A || !A.setAccountData) return;
    try { await A.setAccountData(ACCOUNT_DATA_TYPE, clean(profile)); } catch (e) { /* best-effort */ }
  }

  // The contributor's homeserver displayname (their "account info"), used as the
  // default byline name. Public per the Matrix spec — readable for anyone.
  async function accountDisplayName(session) {
    const A = window.MatrixAuth;
    const mxid = session && session.user_id;
    if (!A || !A.getProfile || !mxid) return "";
    try { const p = await A.getProfile(mxid); return (p && p.displayname) ? clamp(p.displayname, NAME_MAX) : ""; }
    catch (e) { return ""; }
  }

  /* ---------- the public store (admins only, via layout.json) ---------- */
  function loadPublic(layout, mxid) {
    const p = ((layout && layout.contributors) || {})[mxid];
    return p ? { name: p.name || "", bio: p.bio || "" } : null;
  }

  /* ---------- load MY profile (durable → public → local → account name) ----------
     Returns { name, bio, source } where source notes where the value came from so
     the editor can hint "synced to your account" vs "from your Matrix name". */
  async function loadMine(session, layout) {
    const mxid = session && session.user_id;
    if (!mxid) return { name: "", bio: "", source: "none" };
    const fromAccount = await fetchAccountData(session);
    if (fromAccount && (fromAccount.name || fromAccount.bio)) {
      const prof = { name: clamp(fromAccount.name, NAME_MAX), bio: clamp(fromAccount.bio, BIO_MAX) };
      saveLocal(mxid, prof); reflect(mxid, prof);
      return Object.assign({ source: "account" }, prof);
    }
    const fromPublic = loadPublic(layout, mxid);
    if (fromPublic && (fromPublic.name || fromPublic.bio)) { reflect(mxid, fromPublic); return Object.assign({ source: "public" }, fromPublic); }
    const fromLocal = loadLocal(mxid);
    if (fromLocal && (fromLocal.name || fromLocal.bio)) { reflect(mxid, fromLocal); return Object.assign({ source: "local" }, fromLocal); }
    // nothing saved yet — seed the NAME from the Matrix account, leave bio blank
    const name = await accountDisplayName(session);
    return { name, bio: "", source: name ? "matrix-name" : "none" };
  }

  /* ---------- save MY profile ----------
     Always writes locally + to my Matrix account (durable). Reflects it into the
     live registry. Returns { ok }. The PUBLIC commit (layout.json) is a separate,
     admin-only step (saveMineToLayout below) — a non-admin's bio is durable on
     their account and goes public when an admin next publishes the layout. */
  async function saveMine(session, profile) {
    const mxid = session && session.user_id;
    if (!mxid) return { ok: false, error: "not signed in" };
    const prof = clean(profile);
    saveLocal(mxid, prof);
    reflect(mxid, prof);
    await writeAccountData(prof);
    return { ok: true, profile: prof, mxid };
  }

  // Merge MY profile into a layout's contributors map (for the admin's publish, or
  // to show it live). Pure — returns a new layout; never mutates the argument.
  function intoLayout(layout, mxid, profile) {
    const prof = clean(profile);
    const contributors = Object.assign({}, (layout && layout.contributors) || {});
    if (!prof.name && !prof.bio) delete contributors[mxid];
    else contributors[mxid] = prof;
    return Object.assign({}, layout, { contributors });
  }

  // Hydrate the people registry from MY durable profile on sign-in, so my own
  // byline reads right even before any layout publish. Best-effort, async.
  async function hydrateMine(session, layout) {
    try { await loadMine(session, layout); } catch (e) {}
  }

  window.NpjProfiles = {
    BIO_MAX, NAME_MAX, ACCOUNT_DATA_TYPE,
    colorFor, clamp,
    safeHref, linkTokens, hasLink,
    loadLocal, saveLocal, loadPublic,
    loadMine, saveMine, hydrateMine, intoLayout,
    accountDisplayName, reflect
  };
})();
