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
    loadLocal, saveLocal, loadPublic,
    loadMine, saveMine, hydrateMine, intoLayout,
    accountDisplayName, reflect
  };
})();
