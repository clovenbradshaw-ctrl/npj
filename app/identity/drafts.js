/* drafts.js — durable draft persistence for the Newsroom.
 *
 * The bug we keep hitting: a draft lived only in React state (and at best a
 * single localStorage key), so a refresh — or worse, a browser wipe / device
 * switch — silently erased work in progress. This fixes both layers:
 *
 *   1. localStorage, written on every keystroke (debounced) → a refresh or an
 *      accidental tab close restores instantly, even for a signed-out guest.
 *   2. Matrix account data (server-side, per account) → the authoritative copy.
 *      Wipe the browser or sign in on a new device and the draft comes back
 *      after one login. This mirrors how roles + the room index already recover.
 *
 * On load we read BOTH and keep whichever is newer (by `updated`), so the two
 * layers self-heal instead of clobbering each other. Everything is best-effort:
 * a homeserver hiccup degrades to local-only, it never blocks editing.
 *
 * Exposed as window.NpjDrafts. Depends on window.MatrixAuth (account data).
 */
(function () {
  'use strict';

  const LS_PREFIX = "npj_draft_v1:";
  const ACCOUNT_TYPE = "press.npj.draftstore"; // { v, updated, drafts: { [id]: draft } }
  const SYNC_DEBOUNCE_MS = 1500;
  const MAX_REMOTE_DRAFTS = 50;

  const lsKey = (id) => LS_PREFIX + id;
  const nowIso = () => new Date().toISOString();
  const newer = (a, b) => String((a && a.updated) || "") >= String((b && b.updated) || "");
  const signedIn = () => !!(window.MatrixAuth && window.MatrixAuth.isSignedIn && window.MatrixAuth.isSignedIn());

  /* ---- status fan-out so the editor can show "saved · synced" ---- */
  const status = { state: "idle", id: null, at: 0 }; // idle | localonly | saving | syncing | synced | error
  const listeners = new Set();
  function setStatus(state, id) {
    status.state = state; if (id) status.id = id; status.at = Date.now();
    listeners.forEach(fn => { try { fn({ ...status }); } catch (e) {} });
  }
  function onStatus(fn) { listeners.add(fn); try { fn({ ...status }); } catch (e) {} return () => listeners.delete(fn); }

  /* ---- local layer ---- */
  function loadLocal(id) {
    try { return JSON.parse(localStorage.getItem(lsKey(id)) || "null"); } catch (e) { return null; }
  }
  function saveLocal(id, draft) {
    try { localStorage.setItem(lsKey(id), JSON.stringify(draft)); return true; } catch (e) { return false; }
  }
  function dropLocal(id) { try { localStorage.removeItem(lsKey(id)); } catch (e) {} }

  // Every local draft in this browser, newest first. Synchronous, works signed
  // out — this is what the signed-out Documents page and the locked newsroom
  // use to prove "your work didn't vanish".
  function localList() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) { const d = loadLocal(k.slice(LS_PREFIX.length)); if (d && d.id) out.push(d); }
      }
    } catch (e) {}
    return out.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  }

  /* ---- Matrix (account data) layer ---- */
  async function remoteStore() {
    if (!signedIn() || !window.MatrixAuth.getAccountData) return null;
    const d = await window.MatrixAuth.getAccountData(ACCOUNT_TYPE);
    return (d && typeof d === "object" && d.drafts) ? d : { v: 1, updated: null, drafts: {} };
  }
  async function loadRemote(id) {
    try { const s = await remoteStore(); return s && s.drafts ? (s.drafts[id] || null) : null; }
    catch (e) { return null; }
  }
  function prune(store) {
    const ids = Object.keys(store.drafts);
    if (ids.length > MAX_REMOTE_DRAFTS) {
      ids.sort((a, b) => String(store.drafts[a].updated || "").localeCompare(String(store.drafts[b].updated || "")));
      while (Object.keys(store.drafts).length > MAX_REMOTE_DRAFTS) delete store.drafts[ids.shift()];
    }
  }
  async function pushRemote(id, draft) {
    if (!signedIn() || !window.MatrixAuth.setAccountData) return false;
    const store = (await remoteStore()) || { v: 1, drafts: {} };
    store.drafts = store.drafts || {};
    store.drafts[id] = draft;
    store.updated = nowIso();
    prune(store);
    await window.MatrixAuth.setAccountData(ACCOUNT_TYPE, store);
    return true;
  }

  /* ---- public API ---- */
  const timers = {};

  // Write now (local), schedule a debounced server sync. Returns the stamped draft.
  function save(id, partial) {
    const draft = { ...partial, id, updated: nowIso() };
    saveLocal(id, draft);
    if (signedIn()) {
      setStatus("saving", id);
      clearTimeout(timers[id]);
      timers[id] = setTimeout(() => { flush(id); }, SYNC_DEBOUNCE_MS);
    } else {
      setStatus("localonly", id);
    }
    return draft;
  }

  // Force the pending local copy up to Matrix right now (e.g. just after sign-in).
  async function flush(id) {
    clearTimeout(timers[id]);
    const draft = loadLocal(id);
    if (!draft) return;
    if (!signedIn()) { setStatus("localonly", id); return; }
    try {
      setStatus("syncing", id);
      await pushRemote(id, draft);
      // a draft attached to a project also lives in the shared room, so every
      // invited member loads + edits it — best-effort, never blocks the account sync
      if (draft.room && draft.room.roomId && window.MatrixAuth && window.MatrixAuth.putRoomDoc) {
        try { await window.MatrixAuth.putRoomDoc(draft.room.roomId, id, draft); } catch (e) {}
      }
      setStatus("synced", id);
    }
    catch (e) { setStatus("error", id); }
  }

  // Push EVERY local draft that's newer than its account copy, in one write.
  // Called on sign-in (heal local-only work) and — critically — by signOut()
  // BEFORE the token is invalidated, so the last debounce window of typing
  // can't die with the session. Returns how many drafts were pushed.
  async function flushAll() {
    Object.keys(timers).forEach(id => clearTimeout(timers[id]));
    if (!signedIn()) return 0;
    const locals = localList();
    if (!locals.length) return 0;
    let store;
    try { store = (await remoteStore()) || { v: 1, drafts: {} }; } catch (e) { return 0; }
    store.drafts = store.drafts || {};
    let pushed = 0;
    locals.forEach(d => {
      const r = store.drafts[d.id];
      if (!r || String(d.updated || "") > String(r.updated || "")) { store.drafts[d.id] = d; pushed++; }
    });
    if (!pushed) { setStatus("synced"); return 0; }
    store.updated = nowIso();
    prune(store);
    try { setStatus("syncing"); await window.MatrixAuth.setAccountData(ACCOUNT_TYPE, store); setStatus("synced"); }
    catch (e) { setStatus("error"); return 0; }
    return pushed;
  }

  // Read both layers; keep the newer; heal the stale one. Returns the draft or null.
  async function restore(id) {
    const local = loadLocal(id);
    let remote = null;
    try { remote = await loadRemote(id); } catch (e) {}
    let chosen = local;
    if (remote && (!local || !newer(local, remote))) { chosen = remote; saveLocal(id, remote); }
    else if (local && remote && newer(local, remote) && signedIn()) { flush(id); } // local wins → push it up
    if (chosen) setStatus(signedIn() ? "synced" : "localonly", id);
    return chosen || null;
  }

  // All known drafts (remote ∪ local), newest first — for a "your drafts" recovery
  // list. Each entry carries `where`, so the UI can say truthfully which copy it is:
  //   "synced" — on the account (and usually here too)
  //   "ahead"  — this browser has a NEWER copy than the account (sync pending)
  //   "local"  — this browser only (signed out, never reached an account)
  async function list() {
    const map = {};
    let remote = {};
    try { const s = await remoteStore(); if (s && s.drafts) remote = s.drafts; } catch (e) {}
    Object.keys(remote).forEach(id => { map[id] = { ...remote[id], where: "synced" }; });
    localList().forEach(d => {
      const r = remote[d.id];
      if (!r) map[d.id] = { ...d, where: signedIn() ? "ahead" : "local" };
      else if (String(d.updated || "") > String(r.updated || "")) map[d.id] = { ...d, where: "ahead" };
    });
    return Object.values(map).sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  }

  // Pull a project room's shared documents into the local store so they list +
  // open like any draft. The room is the shared source of truth: for each doc we
  // take the room's copy when it's newer than what's local (last-write-wins) and
  // mirror it locally, so restore() and the editor's existing path just work — and
  // an invited member finally SEES the articles in a project, not an empty room.
  // Best-effort: a homeserver hiccup yields whatever's already local.
  async function pullRoomDocs(roomId, title) {
    if (!signedIn() || !roomId || !window.MatrixAuth || !window.MatrixAuth.getRoomDocs) return [];
    let metas = [];
    try { metas = await window.MatrixAuth.getRoomDocs(roomId); } catch (e) { return []; }
    const out = [];
    for (const meta of metas) {
      const id = meta && meta.id; if (!id) continue;
      const local = loadLocal(id);
      const roomNewer = !local || String(meta.updated || "") > String((local && local.updated) || "");
      if (roomNewer && meta.mxc) {
        let body = null;
        try { body = await window.MatrixAuth.getRoomDocContent(meta.mxc); } catch (e) {}
        if (body && typeof body === "object") {
          body.id = id;
          body.room = (body.room && body.room.roomId) ? body.room : { roomId, title: title || "Your project" };
          if (!body.updated) body.updated = meta.updated || nowIso();
          saveLocal(id, body);
          out.push(body);
          continue;
        }
      }
      if (local) out.push(local);
    }
    // push any local project draft the room is missing or that's newer here, so an
    // author's EXISTING work (and a member's offline edits) reach everyone — not
    // only drafts saved after this first synced. Best-effort; needs write power
    // (new rooms grant it to members; the owner opens it on older rooms).
    const haveMeta = {}; metas.forEach(m => { if (m && m.id) haveMeta[m.id] = m; });
    for (const d of localList()) {
      if (!d || !d.room || d.room.roomId !== roomId) continue;
      const m = haveMeta[d.id];
      if (m && !(String(d.updated || "") > String(m.updated || ""))) continue;
      if (window.MatrixAuth.putRoomDoc) { try { await window.MatrixAuth.putRoomDoc(roomId, d.id, d); } catch (e) {} }
      if (!out.find(x => x.id === d.id)) out.push(d);
    }
    return out;
  }

  function discard(id) { dropLocal(id); clearTimeout(timers[id]); }

  // Delete a draft from BOTH layers (used by the document explorer). Best-effort
  // on the remote side: a homeserver hiccup leaves only the local copy gone.
  async function remove(id) {
    const local = loadLocal(id);
    discard(id);
    // a project document also lives in the shared room — tombstone it there so it
    // leaves every member's view, not just this browser's (best-effort)
    if (local && local.room && local.room.roomId && window.MatrixAuth && window.MatrixAuth.deleteRoomDoc) {
      try { await window.MatrixAuth.deleteRoomDoc(local.room.roomId, id); } catch (e) {}
    }
    if (!signedIn()) return false;
    try {
      const store = await remoteStore();
      if (store && store.drafts && store.drafts[id]) {
        delete store.drafts[id];
        store.updated = nowIso();
        await window.MatrixAuth.setAccountData(ACCOUNT_TYPE, store);
      }
      return true;
    } catch (e) { return false; }
  }

  // React to the session: sign-in heals (pushes local-only work to the account);
  // sign-out cancels doomed sync timers and flips the status pill to the truth
  // immediately — no more "✓ synced" lingering after the token is gone.
  if (window.MatrixAuth && window.MatrixAuth.onChange) {
    window.MatrixAuth.onChange(s => {
      if (s) { flushAll(); }
      else { Object.keys(timers).forEach(id => clearTimeout(timers[id])); setStatus("localonly"); }
    });
  }

  window.NpjDrafts = { save, flush, flushAll, restore, list, localList, loadLocal, discard, remove, pullRoomDocs, onStatus, ACCOUNT_TYPE };
})();
