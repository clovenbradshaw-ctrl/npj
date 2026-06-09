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
  async function pushRemote(id, draft) {
    if (!signedIn() || !window.MatrixAuth.setAccountData) return false;
    const store = (await remoteStore()) || { v: 1, drafts: {} };
    store.drafts = store.drafts || {};
    store.drafts[id] = draft;
    store.updated = nowIso();
    const ids = Object.keys(store.drafts);
    if (ids.length > MAX_REMOTE_DRAFTS) {
      ids.sort((a, b) => String(store.drafts[a].updated || "").localeCompare(String(store.drafts[b].updated || "")));
      while (Object.keys(store.drafts).length > MAX_REMOTE_DRAFTS) delete store.drafts[ids.shift()];
    }
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
    try { setStatus("syncing", id); await pushRemote(id, draft); setStatus("synced", id); }
    catch (e) { setStatus("error", id); }
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

  // All known drafts (remote ∪ local), newest first — for a "your drafts" recovery list.
  async function list() {
    const map = {};
    try { const s = await remoteStore(); if (s && s.drafts) Object.assign(map, s.drafts); } catch (e) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) { const d = loadLocal(k.slice(LS_PREFIX.length)); if (d && (!map[d.id] || newer(d, map[d.id]))) map[d.id] = d; }
      }
    } catch (e) {}
    return Object.values(map).sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  }

  function discard(id) { dropLocal(id); clearTimeout(timers[id]); }

  // Permanently delete a draft from BOTH layers. Local goes immediately; the
  // remote (account-data) copy is removed too, so a deleted doc can't resurface
  // on the next sync / device. Best-effort on the server side.
  async function remove(id) {
    dropLocal(id);
    clearTimeout(timers[id]);
    if (!signedIn() || !window.MatrixAuth.setAccountData) return;
    try {
      const store = await remoteStore();
      if (store && store.drafts && Object.prototype.hasOwnProperty.call(store.drafts, id)) {
        delete store.drafts[id];
        store.updated = nowIso();
        await window.MatrixAuth.setAccountData(ACCOUNT_TYPE, store);
      }
    } catch (e) { /* leave local removed; server prune retries on next change */ }
  }

  window.NpjDrafts = { save, flush, restore, list, loadLocal, discard, remove, onStatus, ACCOUNT_TYPE };
})();
