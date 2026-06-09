/* matrix-auth.js — real Matrix client-server auth for NPJ.
 *
 * Identity is genuinely verified against the homeserver, not trusted from input:
 *   login(mxid, password) → POST /_matrix/client/v3/login  → access_token + user_id
 *   whoami(token)         → GET  /_matrix/client/v3/account/whoami → authoritative user_id
 * The admin layout controls unlock ONLY when whoami returns ADMIN_MXID — so an
 * attacker can't grant themselves admin by typing the address; they'd need that
 * account's actual credentials, which the homeserver checks.
 *
 * The same session powers Matrix room invites for collaborative drafting:
 *   invite(roomIdOrAlias, mxid) → POST /_matrix/client/v3/rooms/{id}/invite
 *
 * Matrix's client-server API is CORS-open (the spec mandates
 * Access-Control-Allow-Origin: *), so the browser can call hyphae.social directly.
 *
 * Exposed as window.MatrixAuth. The session persists in localStorage so it
 * survives a refresh AND a tab close; the authoritative copies of everything
 * else (roles, draft index, draft documents) live server-side in Matrix
 * (account data + rooms), so even a full browser wipe recovers after one login.
 */
(function () {
  const ADMIN_MXID = "@collective_boundary730383:hyphae.social";
  const CONTROL_ALIAS = "#npj-control:hyphae.social"; // Matrix room that stores permissioning
  const PERM_EVENT = "press.npj.permissions";          // state event type holding { roles }
  const APP_ROOM_TYPE = "press.npj.room";              // state event tagging a room as one of OURS
  const LS_KEY = "npj_matrix_session_v1";               // localStorage → survives tab close & refresh

  let session = null; // { user_id, access_token, base_url, device_id, verified, admin }
  const listeners = new Set();
  function emit() { const s = current(); listeners.forEach(fn => { try { fn(s); } catch (e) {} }); }

  function parseMxid(input) {
    const m = String(input || "").trim().match(/^@?([a-z0-9._=\-/+]+):([a-z0-9.\-]+\.[a-z]{2,})$/i);
    if (!m) return null;
    return { localpart: m[1], domain: m[2], mxid: "@" + m[1] + ":" + m[2] };
  }

  // .well-known delegation → real homeserver base URL, falling back to https://domain
  async function discover(domain) {
    try {
      const r = await fetch(`https://${domain}/.well-known/matrix/client`, { method: "GET" });
      if (r.ok) {
        const j = await r.json();
        const base = j && j["m.homeserver"] && j["m.homeserver"].base_url;
        if (base) return String(base).replace(/\/+$/, "");
      }
    } catch (e) { /* no well-known → use the apex */ }
    return `https://${domain}`;
  }

  async function api(base, path, { method = "GET", token, body } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = "Bearer " + token;
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      const err = new Error("network/cors error reaching the homeserver");
      err.code = "network"; throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.errcode)) || ("request failed (" + res.status + ")"));
      err.status = res.status; err.errcode = data && data.errcode; err.data = data;
      throw err;
    }
    return data || {};
  }

  /* ---- login: password → access token, then whoami to confirm identity ---- */
  async function login(input, password) {
    const id = parseMxid(input);
    if (!id) { const e = new Error("That isn't a valid Matrix ID (expected @name:server)"); e.code = "badmxid"; throw e; }
    const base = await discover(id.domain);
    const out = await api(base, "/_matrix/client/v3/login", {
      method: "POST",
      body: {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: id.localpart },
        password: String(password),
        initial_device_display_name: "People's Journalism (web)"
      }
    });
    // the server may return its own base_url via .well-known in the response
    const respBase = out.well_known && out.well_known["m.homeserver"] && out.well_known["m.homeserver"].base_url;
    const finalBase = (respBase ? String(respBase).replace(/\/+$/, "") : base);
    // whoami is the source of truth for who this token belongs to
    const who = await api(finalBase, "/_matrix/client/v3/account/whoami", { token: out.access_token });
    const user_id = who.user_id || out.user_id;
    session = {
      user_id,
      access_token: out.access_token,
      base_url: finalBase,
      device_id: out.device_id || who.device_id || null,
      verified: true,
      admin: user_id === ADMIN_MXID
    };
    persist(); emit();
    return current();
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(session)); } catch (e) {}
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (s && s.access_token && s.user_id) { session = s; session.admin = s.user_id === ADMIN_MXID; }
    } catch (e) { session = null; }
    if (session) emit(); // boot-restored session counts as a sign-in (drafts re-sync on it)
    return current();
  }
  async function logout() {
    const s = session;
    session = null; persist(); emit();
    if (s && s.access_token) { try { await api(s.base_url, "/_matrix/client/v3/logout", { method: "POST", token: s.access_token }); } catch (e) {} }
  }

  function current() {
    if (!session) return null;
    return { user_id: session.user_id, base_url: session.base_url, verified: !!session.verified, admin: !!session.admin, device_id: session.device_id };
  }
  function token() { return session ? session.access_token : null; }
  function isSignedIn() { return !!session; }
  function isAdmin() { return !!(session && session.admin); }

  /* ---- room membership: resolve an alias, invite a user ---- */
  async function resolveRoom(roomIdOrAlias) {
    const v = String(roomIdOrAlias || "").trim();
    if (!v) return null;
    if (v[0] === "!") return v; // already a room id
    if (v[0] === "#") {
      const out = await api(session.base_url, "/_matrix/client/v3/directory/room/" + encodeURIComponent(v), { token: session.access_token });
      return out.room_id;
    }
    return v;
  }
  async function invite(roomIdOrAlias, userInput) {
    if (!session) { const e = new Error("Sign in with Matrix first"); e.code = "noauth"; throw e; }
    const id = parseMxid(userInput);
    if (!id) { const e = new Error("Invite needs a full Matrix ID (@name:server)"); e.code = "badmxid"; throw e; }
    const roomId = await resolveRoom(roomIdOrAlias);
    if (!roomId) { const e = new Error("No project is set for this document"); e.code = "noroom"; throw e; }
    await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/invite", {
      method: "POST", token: session.access_token, body: { user_id: id.mxid }
    });
    return { invited: id.mxid, roomId };
  }

  /* ---- app-room tagging ----
     A Matrix account has a whole life outside this app, so every room NPJ
     creates carries a press.npj.room state event (set atomically at creation
     via initial_state). That tag — shared room state, visible to every member,
     not per-browser — is how the app tells its own rooms apart from the rest
     of the account, and joinedRooms() ignores anything without it. */
  function appRoomState(kind) {
    return { type: APP_ROOM_TYPE, state_key: "", content: { app: "press.npj", kind: kind || "draft", created: new Date().toISOString() } };
  }
  // Stamp the tag onto an existing room (used to migrate rooms made before tagging).
  async function tagRoom(roomId, kind) {
    if (!session) return;
    await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(APP_ROOM_TYPE) + "/", {
      method: "PUT", token: session.access_token, body: appRoomState(kind).content
    });
  }

  /* ---- permissioning stored IN Matrix (survives any browser wipe) ----
     Roles live as a state event in the control room; only the founding admin
     (and admins they appoint) can write it. The GitHub layout.json is the public
     mirror; this is the authoritative, admin-gated store. Best-effort: failures
     never block the UI, which falls back to the committed layout roles. */
  async function ensureControlRoom() {
    if (!session) return null;
    try { const id = await resolveRoom(CONTROL_ALIAS); if (id) return id; } catch (e) { /* not created yet */ }
    if (session.user_id !== ADMIN_MXID) return null; // only the founder bootstraps it
    const aliasLocalpart = CONTROL_ALIAS.replace(/^#/, "").split(":")[0];
    const out = await api(session.base_url, "/_matrix/client/v3/createRoom", {
      method: "POST", token: session.access_token,
      body: { name: "People's Journalism — control", topic: "Permissioning + publishing authority", visibility: "private",
        room_alias_name: aliasLocalpart, preset: "private_chat", initial_state: [appRoomState("control")] }
    });
    return out.room_id;
  }
  async function readPermissions() {
    if (!session) return null;
    let roomId; try { roomId = await resolveRoom(CONTROL_ALIAS); } catch (e) { return null; }
    if (!roomId) return null;
    try {
      const st = await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(PERM_EVENT) + "/", { token: session.access_token });
      return (st && st.roles) ? st.roles : {};
    } catch (e) { return null; }
  }
  async function writePermissions(roles) {
    if (!session || session.user_id !== ADMIN_MXID) { const e = new Error("only the founding admin can write permissions"); e.code = "forbidden"; throw e; }
    const roomId = await ensureControlRoom();
    if (!roomId) throw new Error("control room unavailable");
    await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(PERM_EVENT) + "/", {
      method: "PUT", token: session.access_token, body: { roles: roles || {}, updated: new Date().toISOString() }
    });
    return { roomId };
  }

  /* ---- recover your workspace FROM THE SERVER, not the browser ----
     The durability bug: drafts were saved into Matrix rooms, but the only pointer
     to those rooms lived in localStorage — wipe/switch the browser and the rooms
     became unreachable. These read membership + a per-account index straight from
     the homeserver, so a fresh browser recovers everything after one login.

     Scope: ONLY rooms tagged press.npj.room. The old version probed every joined
     room on the account (two state GETs each → a console 404 for every room with
     no name/topic, and it dragged the user's unrelated rooms into the app). Now
     one filtered /sync returns just the app tag + name + topic for all joined
     rooms in a single 200, and untagged rooms are ignored. Rooms that predate
     tagging are still recognised via the account's draft index / control alias
     and retro-tagged best-effort so they're self-describing from then on. */
  const ROOM_STATE_TYPES = [APP_ROOM_TYPE, "m.room.name", "m.room.topic"];
  async function joinedRooms() {
    if (!session) return [];
    // Rooms this account already knows are ours (created before tagging existed).
    const legacyIds = new Set();
    try { (await listDrafts()).forEach(d => { if (d && d.roomId) legacyIds.add(d.roomId); }); } catch (e) {}
    let controlId = null;
    try { controlId = await resolveRoom(CONTROL_ALIAS); } catch (e) { /* not created yet */ }
    if (controlId) legacyIds.add(controlId);
    const kindOf = (roomId, marker) => (marker && marker.kind) || (roomId === controlId ? "control" : "draft");
    const collect = (events) => { const c = {}; for (const ev of events) { if (ev && ev.state_key === "") c[ev.type] = ev.content; } return c; };
    const toRoom = (roomId, c) => ({
      roomId,
      name: (c["m.room.name"] && c["m.room.name"].name) || roomId,
      topic: (c["m.room.topic"] && c["m.room.topic"].topic) || "",
      kind: kindOf(roomId, c[APP_ROOM_TYPE])
    });

    // One filtered sync: per joined room, only the three state types we care about.
    const filter = {
      presence: { types: [] }, account_data: { types: [] },
      room: { ephemeral: { types: [] }, account_data: { types: [] },
        state: { types: ROOM_STATE_TYPES }, timeline: { limit: 1, types: ROOM_STATE_TYPES } }
    };
    let joined = null;
    try {
      const out = await api(session.base_url, "/_matrix/client/v3/sync?timeout=0&set_presence=offline&filter=" + encodeURIComponent(JSON.stringify(filter)), { token: session.access_token });
      joined = (out.rooms && out.rooms.join) || {};
    } catch (e) { /* sync unavailable → index-only fallback below */ }

    const rooms = [];
    if (joined) {
      for (const roomId of Object.keys(joined)) {
        const r = joined[roomId] || {};
        // recent state changes ride in the timeline section; merge them over state
        const c = collect(((r.state && r.state.events) || []).concat((r.timeline && r.timeline.events) || []));
        const marker = c[APP_ROOM_TYPE];
        if (!marker && !legacyIds.has(roomId)) continue; // the rest of their Matrix life — not ours to touch
        if (!marker) {
          const kind = kindOf(roomId, null);
          // retro-tag what we have authority over: own drafts always, control only as admin
          if (kind !== "control" || session.admin) tagRoom(roomId, kind).catch(() => {});
        }
        rooms.push(toRoom(roomId, c));
      }
      return rooms;
    }

    // Fallback: read full state for the known app rooms only — still never probes
    // unrelated rooms, and full-state GETs return 200 even with no name/topic.
    let ids = [];
    try { const out = await api(session.base_url, "/_matrix/client/v3/joined_rooms", { token: session.access_token }); ids = out.joined_rooms || []; }
    catch (e) { return []; }
    for (const roomId of ids) {
      if (!legacyIds.has(roomId)) continue;
      try {
        const st = await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state", { token: session.access_token });
        rooms.push(toRoom(roomId, collect(st || [])));
      } catch (e) { /* unreadable → skip */ }
    }
    return rooms;
  }
  // Per-account durable index (server-side, private, survives wipe).
  const DRAFTS_TYPE = "press.npj.drafts";
  async function getAccountData(type) {
    if (!session) return null;
    try { return await api(session.base_url, "/_matrix/client/v3/user/" + encodeURIComponent(session.user_id) + "/account_data/" + encodeURIComponent(type), { token: session.access_token }); }
    catch (e) { return null; }
  }
  async function setAccountData(type, content) {
    if (!session) return;
    await api(session.base_url, "/_matrix/client/v3/user/" + encodeURIComponent(session.user_id) + "/account_data/" + encodeURIComponent(type), { method: "PUT", token: session.access_token, body: content || {} });
  }
  async function listDrafts() {
    const data = await getAccountData(DRAFTS_TYPE);
    return (data && Array.isArray(data.drafts)) ? data.drafts : [];
  }
  async function registerDraft(entry) {
    if (!session || !entry || !entry.roomId) return;
    const drafts = await listDrafts();
    if (!drafts.find(d => d.roomId === entry.roomId)) drafts.unshift({ roomId: entry.roomId, title: entry.title || "Untitled", ts: new Date().toISOString() });
    await setAccountData(DRAFTS_TYPE, { drafts: drafts.slice(0, 100) });
  }
  // Create a collaborative project room WITH a global alias so it's recoverable
  // by name from any browser, and index it on the account. A project can hold
  // any number of documents; its members (invitees) are shared by all of them.
  async function createDraftRoom(title) {
    if (!session) { const e = new Error("Sign in with Matrix first"); e.code = "noauth"; throw e; }
    const slug = String(title || "draft").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "draft";
    const aliasLocalpart = "npj-draft-" + slug + "-" + Math.random().toString(36).slice(2, 6);
    const topic = "People's Journalism project — every document in this project shares these members";
    let out;
    try {
      out = await api(session.base_url, "/_matrix/client/v3/createRoom", {
        method: "POST", token: session.access_token,
        body: { name: title || "Untitled project", topic, visibility: "private", preset: "private_chat", room_alias_name: aliasLocalpart, initial_state: [appRoomState("draft")] }
      });
    } catch (e) {
      // alias clash or restriction → make the room without an alias
      out = await api(session.base_url, "/_matrix/client/v3/createRoom", { method: "POST", token: session.access_token, body: { name: title || "Untitled project", topic, visibility: "private", preset: "private_chat", initial_state: [appRoomState("draft")] } });
    }
    await registerDraft({ roomId: out.room_id, title: title || "Untitled project" });
    return { roomId: out.room_id, alias: out.room_alias || null };
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  window.MatrixAuth = {
    ADMIN_MXID, CONTROL_ALIAS, APP_ROOM_TYPE, parseMxid, discover, login, logout, restore, current, token,
    isSignedIn, isAdmin, resolveRoom, invite, tagRoom, ensureControlRoom, readPermissions, writePermissions,
    // room + workspace recovery (used by the Newsroom; previously omitted from the
    // export, which made "Rooms", invites and draft recovery throw at runtime)
    joinedRooms, listDrafts, registerDraft, createDraftRoom, getAccountData, setAccountData, onChange
  };
})();
