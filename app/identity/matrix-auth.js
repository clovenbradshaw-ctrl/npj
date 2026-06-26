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
  const GUEST_STATE = "press.npj.guests";              // state event: { guests: { mxid → {name,by,ts} } }
  const APP_DOC_TYPE = "press.npj.doc";                // state event per shared document: { mxc, title, updated, by, words, deleted }
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
  // Accept an invite / join a room. A newcomer who followed an invite link is
  // already invited to the project; joining is what makes joinedRooms() surface
  // it, so they land inside the project instead of an empty workspace.
  async function joinRoom(roomIdOrAlias) {
    if (!session) { const e = new Error("Sign in first"); e.code = "noauth"; throw e; }
    const v = String(roomIdOrAlias || "").trim(); if (!v) return null;
    // A brand-new account doing register → login → join in quick succession can
    // trip the homeserver's rate limiter (M_LIMIT_EXCEEDED). That used to fail
    // silently and leave a newcomer invited-but-never-joined — so honour the
    // server's retry_after and try again a few times before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await api(session.base_url, "/_matrix/client/v3/join/" + encodeURIComponent(v), { method: "POST", token: session.access_token, body: {} });
        return out.room_id || v;
      } catch (e) {
        const limited = e && (e.errcode === "M_LIMIT_EXCEEDED" || e.status === 429);
        if (!limited || attempt >= 4) throw e;
        const wait = Math.min((e.data && e.data.retry_after_ms) || (500 * Math.pow(2, attempt)), 5000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
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
    let out = null;
    try {
      out = await api(session.base_url, "/_matrix/client/v3/sync?timeout=0&set_presence=offline&filter=" + encodeURIComponent(JSON.stringify(filter)), { token: session.access_token });
    } catch (e) { /* sync unavailable → index-only fallback below */ }
    const joined = out ? ((out.rooms && out.rooms.join) || {}) : null;

    const rooms = [];
    if (joined) {
      // Self-heal: accept any pending invite to a room that's ours — one this
      // account was invited to via a link (known through its own draft index) or
      // any NPJ-tagged room the server shares in the invite's stripped state.
      // THIS is what makes a guest who followed a link actually land INSIDE the
      // project, instead of getting stuck as an invite they never accepted.
      const invited = (out.rooms && out.rooms.invite) || {};
      const accept = [];
      for (const roomId of Object.keys(invited)) {
        const stripped = (invited[roomId] && invited[roomId].invite_state && invited[roomId].invite_state.events) || [];
        if (legacyIds.has(roomId) || stripped.some(ev => ev && ev.type === APP_ROOM_TYPE)) accept.push(roomId);
      }
      for (const roomId of accept) { try { await joinRoom(roomId); } catch (e) {} }

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
      // Rooms we just accepted aren't in this (pre-join) sync — fetch their state
      // so they surface immediately, without waiting for the next workspace load.
      for (const roomId of accept) {
        if (joined[roomId]) continue;
        try {
          const st = await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state", { token: session.access_token });
          rooms.push(toRoom(roomId, collect(st || [])));
        } catch (e) { /* unreadable → skip */ }
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
  // Who is in a project room — joined members AND pending invitees, straight
  // from the homeserver. The document explorer shows this per project so it's
  // always visible who an invite actually went to.
  async function roomMembers(roomId) {
    if (!session) return [];
    try {
      const [out, guests] = await Promise.all([
        api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/members?not_membership=leave", { token: session.access_token }),
        readGuests(roomId)
      ]);
      return ((out && out.chunk) || [])
        .map(ev => ({ mxid: ev.state_key, membership: (ev.content && ev.content.membership) || "join" }))
        .filter(m => m.mxid && (m.membership === "join" || m.membership === "invite"))
        .map(m => guests[m.mxid] ? { ...m, guest: true, guestName: guests[m.mxid].name || "" } : m);
    } catch (e) { return []; }
  }
  /* ---- guests: a project member minted via an invite link ----
     The inviter records WHO a guest is for (a plain name) as room state, so the
     label lives in the project for every member to see — not just in the
     inviter's browser. One state event holds the whole { mxid → {name,by,ts} }
     map (read-modify-write; a small newsroom won't race on it). */
  async function readGuests(roomId) {
    if (!session) return {};
    try {
      const st = await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(GUEST_STATE) + "/", { token: session.access_token });
      return (st && st.guests) || {};
    } catch (e) { return {}; }
  }
  async function setGuestName(roomId, mxid, name, by) {
    if (!session) return;
    const id = parseMxid(mxid); if (!id) return;
    const guests = { ...(await readGuests(roomId)), [id.mxid]: { name: String(name || ""), by: by || session.user_id, ts: new Date().toISOString() } };
    try {
      await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(GUEST_STATE) + "/", { method: "PUT", token: session.access_token, body: { guests } });
    } catch (e) { /* labelling is best-effort; never block the invite on it */ }
  }

  /* ---- public profile (displayname + avatar) ----
     A Matrix profile is world-readable per the spec, so this resolves a byline
     name for ANY mxid (not just the signed-in user) — the "pull from their
     account info" path for contributor profiles. Unauthenticated-friendly:
     falls back to the signed-in session's homeserver when no base is known. */
  async function getProfile(mxidInput) {
    const id = parseMxid(mxidInput);
    if (!id) return null;
    const base = session ? session.base_url : await discover(id.domain);
    try {
      const out = await api(base, "/_matrix/client/v3/profile/" + encodeURIComponent(id.mxid), { token: token() || undefined });
      return { mxid: id.mxid, displayname: out.displayname || "", avatar_url: out.avatar_url || "" };
    } catch (e) { return null; }
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
        body: { name: title || "Untitled project", topic, visibility: "private", preset: "private_chat", room_alias_name: aliasLocalpart, initial_state: [appRoomState("draft")], power_level_content_override: { events: { [APP_DOC_TYPE]: 0 } } }
      });
    } catch (e) {
      // alias clash or restriction → make the room without an alias
      out = await api(session.base_url, "/_matrix/client/v3/createRoom", { method: "POST", token: session.access_token, body: { name: title || "Untitled project", topic, visibility: "private", preset: "private_chat", initial_state: [appRoomState("draft")], power_level_content_override: { events: { [APP_DOC_TYPE]: 0 } } } });
    }
    await registerDraft({ roomId: out.room_id, title: title || "Untitled project" });
    return { roomId: out.room_id, alias: out.room_alias || null };
  }

  /* ---- invite someone who has NO Matrix account yet ----
     The inviter (signed in) mints a brand-new account on the homeserver, then
     hands the newcomer a single link that logs them in, lets them pick a display
     name and set their own password. Three pieces live here; the UI is in
     app/admin/Invite.jsx.

       register()        — create the account (runs in the inviter's browser)
       setDisplayName()  — the newcomer names themselves (step 1 of the link)
       changePassword()  — the newcomer replaces the temp password (step 2)

     register() never touches the inviter's own session: inhibit_login means the
     homeserver brings the account into being but mints NO device or token for it,
     so the inviter stays signed in as themselves. The newcomer logs in fresh with
     the temp password carried in the link, then immediately changes it — so the
     password in the link (URL fragment, never sent to a server) is single-use. */
  // A "hashid"-style code: short, CSPRNG, and built from an alphabet that drops
  // both look-alike glyphs (no 0/O, 1/l/i) AND vowels — so a code never spells an
  // accidental word, reads cleanly aloud, and is hard to mistype. 27 symbols, so
  // five of them is ~14M combinations: collisions are rare, and register() retries
  // the few that do collide, so an auto-minted handle effectively always lands.
  const HASHID_ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
  function hashid(len) {
    const n = Math.max(1, len || 6), A = HASHID_ALPHABET, ceil = 256 - (256 % A.length);
    const bytes = new Uint8Array(n * 2); crypto.getRandomValues(bytes);
    let out = "", bi = 0;
    for (let i = 0; i < n; i++) {
      // rejection-sample so every symbol is equally likely (no modulo bias)
      let b = bytes[bi++];
      while (b >= ceil) { if (bi >= bytes.length) { crypto.getRandomValues(bytes); bi = 0; } b = bytes[bi++]; }
      out += A[b % A.length];
    }
    return out;
  }
  // A human-friendly Matrix localpart: an optional name-slug (so the guest reads as
  // @sam-rivera-x3f9 not @x3f9) plus a hashid suffix that makes it unique. Spaces
  // and punctuation fold to single hyphens; only Matrix-legal characters survive.
  function randomLocalpart(seed) {
    const slug = String(seed || "").toLowerCase()
      .replace(/[^a-z0-9._=\-/]+/g, "-")  // fold anything illegal (incl. spaces) to a hyphen
      .replace(/[-._/]{2,}/g, "-")        // collapse runs of separators
      .replace(/^[-._/]+|[-._/]+$/g, "")  // trim leading/trailing separators
      .slice(0, 16).replace(/[-._/]+$/g, "");
    return (slug || "guest") + "-" + hashid(5);
  }
  function randomPassword() {
    // 18 CSPRNG bytes → ~24 url-safe chars. Strong, and short-lived: the link's
    // first run forces a replacement, so this is never a credential the user keeps.
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, "A").replace(/\//g, "B").replace(/=+$/, "");
  }
  // Matrix registration is user-interactive (UIA): the server answers the first
  // request with the auth "flows" it demands. We satisfy the two stages a browser
  // can complete unaided — m.login.dummy (open registration) and
  // m.login.registration_token (an admin-issued token pasted into the widget).
  // CAPTCHA / email / phone stages can't be automated, so we say so plainly.
  function pickRegisterFlow(flows, hasToken) {
    const can = (s) => s === "m.login.dummy" || (s === "m.login.registration_token" && hasToken);
    const usable = (flows || []).map(f => (f && f.stages) || []).filter(st => st.length && st.every(can));
    usable.sort((a, b) => a.length - b.length);
    return usable[0] || null;
  }
  function registerFlowMessage(flows) {
    const all = new Set(); (flows || []).forEach(f => ((f && f.stages) || []).forEach(s => all.add(s)));
    if (all.has("m.login.registration_token")) return "This homeserver needs a registration token. Paste one (from your Synapse admin) and try again.";
    if (all.has("m.login.recaptcha")) return "This homeserver requires a CAPTCHA to register, which can't be completed from here.";
    if (all.has("m.login.email.identity") || all.has("m.login.msisdn")) return "This homeserver requires email/phone verification to register.";
    return "This homeserver doesn't allow creating accounts from the browser.";
  }
  async function register({ domain, username, password, registrationToken, deviceName, seed } = {}) {
    // accept a bare domain ("hyphae.social") or a full mxid (":server" is split off)
    const raw = String(domain || "").trim();
    const dom = (raw.indexOf(":") >= 0 ? raw.split(":").pop() : raw).replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    if (!dom) { const e = new Error("Need a homeserver to register on"); e.code = "badmxid"; throw e; }
    const base = await discover(dom);
    const explicit = String(username || "").trim();   // a hand-picked handle, or "" to auto-mint
    const pw = password || randomPassword();

    // One full UIA registration attempt for a given localpart. Resolves to the new
    // account, or throws (M_USER_IN_USE included) so the caller can decide to retry.
    async function attempt(localpart) {
      const base_body = { username: localpart, password: pw, inhibit_login: true, initial_device_display_name: deviceName || "People's Journalism (web)" };
      let uiaSession = null;   // the homeserver's UIA session id, echoed back each stage
      let flows = null;        // the auth flows the server last advertised
      let serverDone = [];     // stages the server says are already cleared this session
      for (let i = 0; i < 8; i++) {
        let auth;
        if (uiaSession) {
          const flow = pickRegisterFlow(flows, !!registrationToken);
          if (!flow) { const e = new Error(registerFlowMessage(flows)); e.code = "uia"; e.flows = flows; throw e; }
          // send the first stage the server hasn't cleared yet (the server, not us,
          // is the source of truth for progress); fall back to the last stage so a
          // server that returns no `completed` still gets a satisfying auth dict
          const next = flow.find(s => serverDone.indexOf(s) < 0) || flow[flow.length - 1];
          auth = next === "m.login.registration_token"
            ? { type: "m.login.registration_token", token: registrationToken, session: uiaSession }
            : { type: "m.login.dummy", session: uiaSession };
        }
        let res, data = {};
        try {
          res = await fetch(base + "/_matrix/client/v3/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(auth ? { ...base_body, auth } : base_body)
          });
        } catch (e) { const err = new Error("network/cors error reaching the homeserver"); err.code = "network"; throw err; }
        try { data = await res.json(); } catch (e) { data = {}; }
        if (res.ok) return { mxid: "@" + localpart + ":" + dom, localpart, domain: dom, password: pw, base_url: base, user_id: data.user_id || ("@" + localpart + ":" + dom) };
        if (res.status === 401 && data && Array.isArray(data.flows)) {
          flows = data.flows; uiaSession = data.session; serverDone = data.completed || [];
          if (!pickRegisterFlow(flows, !!registrationToken)) { const e = new Error(registerFlowMessage(flows)); e.code = "uia"; e.flows = flows; throw e; }
          continue;
        }
        const err = new Error((data && (data.error || data.errcode)) || ("registration failed (" + res.status + ")"));
        err.status = res.status; err.errcode = data && data.errcode; err.data = data;
        if (err.errcode === "M_FORBIDDEN") err.message = "This homeserver has registration closed.";
        if (err.errcode === "M_USER_IN_USE") err.message = "That username is taken — try generating again.";
        throw err;
      }
      const e = new Error("Registration didn't complete on this homeserver."); e.code = "uia"; throw e;
    }

    // An auto-minted handle should always succeed: if the hashid happens to collide
    // with an existing account, mint a fresh one and try again. A hand-picked handle
    // surfaces the clash to the user instead — that name was their explicit choice.
    let localpart = explicit || randomLocalpart(seed);
    let lastErr;
    for (let tries = 0; tries < (explicit ? 1 : 6); tries++) {
      try { return await attempt(localpart); }
      catch (e) {
        lastErr = e;
        if (!explicit && e && e.errcode === "M_USER_IN_USE") { localpart = randomLocalpart(seed); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  async function setDisplayName(name) {
    if (!session) { const e = new Error("Sign in first"); e.code = "noauth"; throw e; }
    await api(session.base_url, "/_matrix/client/v3/profile/" + encodeURIComponent(session.user_id) + "/displayname", {
      method: "PUT", token: session.access_token, body: { displayname: String(name || "") }
    });
  }

  // Replace the current password. logout_devices:false keeps THIS token alive, so
  // the newcomer stays signed in straight through the change. UIA again: the first
  // call may 401 with a session id to echo back inside the m.login.password auth.
  async function changePassword(oldPassword, newPassword) {
    if (!session) { const e = new Error("Sign in first"); e.code = "noauth"; throw e; }
    const id = parseMxid(session.user_id);
    const auth = { type: "m.login.password", identifier: { type: "m.id.user", user: id ? id.localpart : session.user_id }, password: String(oldPassword) };
    const body = { new_password: String(newPassword), logout_devices: false, auth };
    try {
      await api(session.base_url, "/_matrix/client/v3/account/password", { method: "POST", token: session.access_token, body });
    } catch (e) {
      if (e.status === 401 && e.data && e.data.session) {
        await api(session.base_url, "/_matrix/client/v3/account/password", {
          method: "POST", token: session.access_token, body: { ...body, auth: { ...auth, session: e.data.session } }
        });
      } else throw e;
    }
  }

  /* ---- the single invite link ----
     Everything the newcomer needs rides in the URL fragment (#welcome=…), which
     browsers never send to a server. The token is base64url(JSON):
       { v, hs: domain, u: localpart, p: tempPassword, r: roomId?, by: inviter } */
  function b64urlEncode(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDecode(str) { return decodeURIComponent(escape(atob(String(str).replace(/-/g, "+").replace(/_/g, "/")))); }
  function buildInviteLink(payload) {
    const token = b64urlEncode(JSON.stringify(payload || {}));
    return location.origin + location.pathname + "#welcome=" + token;
  }
  function parseInviteToken(token) {
    try { const p = JSON.parse(b64urlDecode(token)); if (p && p.u && p.p && p.hs) return p; } catch (e) {}
    return null;
  }

  /* ---- shared project documents: the draft lives IN the room, not just on the
     author's account, so every invited member loads and edits the same article.
     A small press.npj.doc STATE EVENT per document (state_key = draft id) holds
     metadata + an mxc POINTER to the full draft JSON in the room's media — so the
     64KB event cap never bounds an article. createDraftRoom opens this event type
     to all members (power level 0), so invitees can write it, not just read. All
     of this is best-effort at the call site: a hiccup degrades to the per-account
     copy, never blocks editing. ---- */
  async function uploadJson(obj) {
    if (!session) return null;
    const body = new Blob([JSON.stringify(obj || {})], { type: "application/json" });
    const res = await fetch(session.base_url + "/_matrix/media/v3/upload?filename=npj-doc.json", {
      method: "POST", headers: { "Authorization": "Bearer " + session.access_token, "Content-Type": "application/json" }, body
    });
    if (!res.ok) throw new Error("doc upload failed (" + res.status + ")");
    const j = await res.json(); return (j && j.content_uri) || null;
  }
  async function fetchJson(mxc) {
    if (!session || !mxc) return null;
    const m = String(mxc).match(/^mxc:\/\/([^/]+)\/(.+)$/); if (!m) return null;
    const paths = [
      "/_matrix/client/v1/media/download/" + m[1] + "/" + encodeURIComponent(m[2]),  // authenticated media (1.11+)
      "/_matrix/media/v3/download/" + m[1] + "/" + encodeURIComponent(m[2])           // legacy fallback
    ];
    for (const p of paths) {
      try { const r = await fetch(session.base_url + p, { headers: { "Authorization": "Bearer " + session.access_token } }); if (r.ok) return await r.json(); } catch (e) {}
    }
    return null;
  }
  function draftWordCount(draft) {
    const t = String((draft && draft.html) || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
    return t.trim() ? t.trim().split(/\s+/).length : 0;
  }
  // Write/update one document's shared record: upload the JSON, point the room
  // state event at it. Throws on failure so the caller can fall back.
  async function putRoomDoc(roomId, id, draft) {
    if (!session || !roomId || !id) return false;
    const mxc = await uploadJson(draft); if (!mxc) return false;
    const content = { mxc, title: String((draft && draft.title) || ""), slug: String((draft && draft.slug) || ""),
      updated: String((draft && draft.updated) || new Date().toISOString()), by: session.user_id, words: draftWordCount(draft), deleted: false };
    await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(APP_DOC_TYPE) + "/" + encodeURIComponent(id),
      { method: "PUT", token: session.access_token, body: content });
    return true;
  }
  // Tombstone a shared document (Matrix state can't be deleted) — flagged hidden.
  async function deleteRoomDoc(roomId, id) {
    if (!session || !roomId || !id) return;
    try { await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" + encodeURIComponent(APP_DOC_TYPE) + "/" + encodeURIComponent(id),
      { method: "PUT", token: session.access_token, body: { deleted: true, updated: new Date().toISOString(), by: session.user_id } }); } catch (e) {}
  }
  // Every live shared document in a room as lightweight metas (id + pointer +
  // title/updated/words) — the listing reads these; the body downloads on open.
  async function getRoomDocs(roomId) {
    if (!session || !roomId) return [];
    try {
      const st = await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state", { token: session.access_token });
      return (st || []).filter(ev => ev && ev.type === APP_DOC_TYPE && ev.state_key && ev.content && ev.content.mxc && !ev.content.deleted)
        .map(ev => ({ id: ev.state_key, mxc: ev.content.mxc, title: ev.content.title || "", slug: ev.content.slug || "", updated: ev.content.updated || "", by: ev.content.by || "", words: ev.content.words || 0 }));
    } catch (e) { return []; }
  }
  async function getRoomDocContent(mxc) { try { return await fetchJson(mxc); } catch (e) { return null; } }
  // Open this room's press.npj.doc events to every member (power level 0) so
  // invitees can edit, not just read. Additive + owner-only: reads the live power
  // levels, adds only our key, and silently no-ops for anyone who can't edit them
  // (a guest) or when it's already open.
  async function ensureDocPower(roomId) {
    if (!session || !roomId) return;
    try {
      const pl = await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/m.room.power_levels/", { token: session.access_token });
      if (!pl) return;
      const events = pl.events || {};
      if (events[APP_DOC_TYPE] === 0) return;
      const mine = (pl.users && pl.users[session.user_id] != null) ? pl.users[session.user_id] : (pl.users_default || 0);
      const needed = (pl.state_default != null) ? pl.state_default : 50;
      if (mine < needed) return; // not allowed to change power levels — leave it
      await api(session.base_url, "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/m.room.power_levels/",
        { method: "PUT", token: session.access_token, body: { ...pl, events: { ...events, [APP_DOC_TYPE]: 0 } } });
    } catch (e) { /* best-effort */ }
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  window.MatrixAuth = {
    ADMIN_MXID, CONTROL_ALIAS, APP_ROOM_TYPE, parseMxid, discover, login, logout, restore, current, token,
    isSignedIn, isAdmin, resolveRoom, invite, joinRoom, tagRoom, ensureControlRoom, readPermissions, writePermissions, getProfile,
    // invite someone who has no account yet: mint it, name it, re-key it
    register, setDisplayName, changePassword, buildInviteLink, parseInviteToken,
    // room + workspace recovery (used by the Newsroom; previously omitted from the
    // export, which made "Rooms", invites and draft recovery throw at runtime)
    joinedRooms, roomMembers, setGuestName, listDrafts, registerDraft, createDraftRoom, getAccountData, setAccountData, onChange,
    // shared project documents (the draft lives in the room, not just the account)
    putRoomDoc, deleteRoomDoc, getRoomDocs, getRoomDocContent, ensureDocPower
  };
})();
