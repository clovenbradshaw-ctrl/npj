/* collab.js — the per-article collaboration transport: end-to-end-encrypted
 * chat + Google-Docs-style comments and suggested edits, carried over the
 * project's Matrix room so they reach exactly the people working on the piece.
 *
 * The project room ALREADY gates membership (only invited writers/editors are
 * in it) and already holds the shared draft. This adds two encrypted channels on
 * top of it, every payload sealed by window.NpjE2EE so the homeserver stores
 * only ciphertext:
 *
 *   • Chat — an ordinary Matrix timeline of `press.npj.e2ee.chat` events. We send
 *     with /send and read with /sync long-poll, decrypting each event. It's a
 *     normal room timeline, so it survives, syncs across devices, and orders
 *     itself the way Matrix already orders messages.
 *
 *   • Comments + suggested edits — each is one `press.npj.e2ee.comment` STATE
 *     event keyed by a comment id, so it can be edited in place (reply, resolve,
 *     accept a suggestion) and every member converges on the same view. The body
 *     (the note, the proposed words, the anchor it's pinned to) is encrypted; only
 *     the id is in the clear. Anchoring reuses window.NpjFeedback's relocatable
 *     spans, so a comment keeps pointing at the right words as the draft moves.
 *
 * watch(roomId, handlers) stands up this device's key, loads history, then runs
 * one /sync loop that delivers live chat AND comment changes — and, when a new
 * collaborator publishes a device, re-shares the room key to them so they can
 * read. Everything is best-effort; a homeserver hiccup surfaces via onError and
 * the loop retries with backoff.
 *
 * Exposed as window.NpjCollab. Depends on window.NpjE2EE + window.MatrixAuth.
 */
(function () {
  "use strict";

  var CHAT_TYPE = "press.npj.e2ee.chat";        // timeline event: one encrypted message
  var COMMENT_TYPE = "press.npj.e2ee.comment";  // state event (state_key = comment id)

  function E2EE() { return window.NpjE2EE; }
  function MA() { return window.MatrixAuth; }
  function nowIso() { return new Date().toISOString(); }
  function rid(p) { return (p || "id") + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36); }

  // —— Matrix request against the live session (optional AbortSignal) ————————
  function mreq(path, opts) {
    opts = opts || {};
    var s = MA() && MA().current && MA().current();
    var token = MA() && MA().token && MA().token();
    if (!s || !token) { var e = new Error("Sign in first"); e.code = "noauth"; return Promise.reject(e); }
    var headers = { "Authorization": "Bearer " + token };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(s.base_url + path, { method: opts.method || "GET",
      headers: headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) { var err = new Error((data && (data.error || data.errcode)) || ("HTTP " + res.status)); err.status = res.status; err.errcode = data && data.errcode; throw err; }
          return data || {};
        });
      });
  }
  function me() { var s = MA() && MA().current && MA().current(); return s ? s.user_id : null; }

  // ——————————————————————————— CHAT ———————————————————————————————————————
  function sendChat(roomId, text) {
    var body = String(text || "").trim();
    if (!body) return Promise.resolve(null);
    return E2EE().encrypt(roomId, { body: body, sender: me(), ts: nowIso() }).then(function (env) {
      var txn = rid("m");
      return mreq("/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/send/" +
        encodeURIComponent(CHAT_TYPE) + "/" + encodeURIComponent(txn), { method: "PUT", body: env })
        .then(function (out) { return out && out.event_id; });
    });
  }
  // Decrypt one timeline event → a message, or null if it isn't ours / unreadable.
  function decodeChat(roomId, ev) {
    if (!ev || ev.type !== CHAT_TYPE || !ev.content || !ev.content.ct) return Promise.resolve(null);
    return E2EE().decrypt(roomId, ev.content).then(function (p) {
      return { id: ev.event_id, sender: ev.sender || p.sender || "@unknown", body: (p && p.body) || "",
        ts: ev.origin_server_ts ? new Date(ev.origin_server_ts).toISOString() : (p && p.ts) || nowIso() };
    }).catch(function () {
      return { id: ev.event_id, sender: ev.sender || "@unknown", body: "", ts: ev.origin_server_ts ? new Date(ev.origin_server_ts).toISOString() : nowIso(), undecryptable: true };
    });
  }

  // ————————————————————————— COMMENTS ——————————————————————————————————————
  // A comment/suggestion record (plaintext shape, before encryption):
  //   { id, kind:"comment"|"suggestion", anchor, rationale, proposed, author, ts,
  //     status:"open"|"resolved"|"declined"|"accepted", replies:[{author,text,ts}],
  //     resolvedBy, resolvedTs, deleted }
  function putComment(roomId, comment) {
    var c = Object.assign({}, comment);
    return E2EE().encrypt(roomId, c).then(function (env) {
      return mreq("/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" +
        encodeURIComponent(COMMENT_TYPE) + "/" + encodeURIComponent(c.id), { method: "PUT", body: env })
        .then(function () { return c; });
    });
  }
  function getComment(roomId, id) {
    return mreq("/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" +
      encodeURIComponent(COMMENT_TYPE) + "/" + encodeURIComponent(id))
      .then(function (env) { return E2EE().decrypt(roomId, env); })
      .catch(function () { return null; });
  }
  function listComments(roomId) {
    return mreq("/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state").then(function (st) {
      var envs = (st || []).filter(function (ev) { return ev && ev.type === COMMENT_TYPE && ev.content && ev.content.ct; });
      return Promise.all(envs.map(function (ev) {
        return E2EE().decrypt(roomId, ev.content).then(function (c) { return c; }).catch(function () { return null; });
      })).then(function (list) {
        return list.filter(function (c) { return c && c.id && !c.deleted; })
          .sort(function (a, b) { return String(a.ts || "").localeCompare(String(b.ts || "")); });
      });
    }).catch(function () { return []; });
  }

  // Create a comment or suggestion pinned to an anchor.
  function addComment(roomId, p) {
    var c = {
      id: rid("c"), kind: p.kind === "suggestion" ? "suggestion" : "comment",
      anchor: p.anchor || null, rationale: String(p.rationale || ""),
      proposed: p.kind === "suggestion" ? String(p.proposed || "") : "",
      author: me(), ts: nowIso(), status: "open", replies: [], deleted: false
    };
    return putComment(roomId, c);
  }
  // Read-modify-write helpers (a small newsroom won't race on a single comment).
  function mutate(roomId, id, fn) {
    return getComment(roomId, id).then(function (c) {
      if (!c) return null;
      var next = fn(Object.assign({ replies: [] }, c)) || c;
      return putComment(roomId, next);
    });
  }
  function replyComment(roomId, id, text) {
    var t = String(text || "").trim(); if (!t) return Promise.resolve(null);
    return mutate(roomId, id, function (c) { c.replies = (c.replies || []).concat([{ author: me(), text: t, ts: nowIso() }]); return c; });
  }
  function setStatus(roomId, id, status) {
    return mutate(roomId, id, function (c) { c.status = status; c.resolvedBy = me(); c.resolvedTs = nowIso(); return c; });
  }
  function removeComment(roomId, id) {
    return mutate(roomId, id, function (c) { c.deleted = true; c.resolvedBy = me(); c.resolvedTs = nowIso(); return c; });
  }

  // ————————————————————————— LIVE WATCH ————————————————————————————————————
  // One /sync loop per watched room: initial pull (history + comments) then a
  // long-poll that streams new chat and comment changes, and re-shares the room
  // key to any device that newly appears. handlers: { onChat, onComments,
  // onComment, onReady, onError, onStatus }.
  function watch(roomId, handlers) {
    handlers = handlers || {};
    var stopped = false;
    var ctrl = null;
    var seen = {}; // chat event_ids already delivered

    var filter = {
      presence: { types: [] }, account_data: { types: [] },
      room: {
        rooms: [roomId], ephemeral: { types: [] }, account_data: { types: [] },
        timeline: { types: [CHAT_TYPE], limit: 50 },
        state: { types: [COMMENT_TYPE, (E2EE() && E2EE().DEVICE_TYPE) || "press.npj.e2ee.device"] }
      }
    };
    var fparam = encodeURIComponent(JSON.stringify(filter));

    function emit(name, arg) { try { if (handlers[name]) handlers[name](arg); } catch (e) {} }

    function room(out) { return out && out.rooms && out.rooms.join && out.rooms.join[roomId]; }

    // process state-type events (in either the state or timeline section)
    function handleStateEvents(events) {
      var sawNewDevice = false;
      var pending = [];
      (events || []).forEach(function (ev) {
        if (!ev || ev.state_key == null) return;
        if (ev.type === COMMENT_TYPE && ev.content && ev.content.ct) {
          pending.push(E2EE().decrypt(roomId, ev.content).then(function (c) { if (c && c.id) emit("onComment", c); }).catch(function () {}));
        } else if (E2EE() && ev.type === E2EE().DEVICE_TYPE && ev.sender && ev.sender !== me()) {
          sawNewDevice = true;
        }
      });
      if (sawNewDevice) pending.push(E2EE().ensureShares(roomId).catch(function () {}));
      return Promise.all(pending);
    }

    function handleChat(events, initial) {
      var fresh = (events || []).filter(function (ev) { return ev && ev.type === CHAT_TYPE && ev.event_id && !seen[ev.event_id]; });
      if (!fresh.length) return Promise.resolve();
      return Promise.all(fresh.map(function (ev) { return decodeChat(roomId, ev); })).then(function (msgs) {
        var out = [];
        msgs.forEach(function (m) { if (m && !seen[m.id]) { seen[m.id] = 1; out.push(m); } });
        if (out.length) emit("onChat", { messages: out, initial: !!initial });
      });
    }

    function loop(since) {
      if (stopped) return;
      ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var path = "/_matrix/client/v3/sync?filter=" + fparam + "&set_presence=offline" +
        (since ? "&since=" + encodeURIComponent(since) + "&timeout=30000" : "&timeout=0");
      mreq(path, { signal: ctrl && ctrl.signal }).then(function (out) {
        if (stopped) return;
        var r = room(out);
        var chain = Promise.resolve();
        if (r) {
          var stateEvents = ((r.state && r.state.events) || []).concat((r.timeline && r.timeline.events) || []);
          chain = handleStateEvents(stateEvents).then(function () {
            return handleChat((r.timeline && r.timeline.events) || [], !since);
          });
        }
        chain.then(function () {
          if (!since) emit("onReady", E2EE() ? E2EE().status(roomId) : null);
          loop(out.next_batch);
        });
      }).catch(function (e) {
        if (stopped || (e && e.name === "AbortError")) return;
        emit("onError", e);
        setTimeout(function () { loop(since); }, 4000); // backoff, then resume
      });
    }

    // stand up our device + a room key, push initial comment list, start syncing
    E2EE().init(roomId).then(function () {
      emit("onStatus", E2EE().status(roomId));
      return listComments(roomId);
    }).then(function (list) {
      if (!stopped) emit("onComments", list);
      loop(null);
    }).catch(function (e) {
      emit("onError", e);
      // even if key bootstrap failed, try to sync so we recover once re-shared
      if (!stopped) loop(null);
    });

    return function unwatch() { stopped = true; try { if (ctrl) ctrl.abort(); } catch (e) {} };
  }

  window.NpjCollab = {
    CHAT_TYPE: CHAT_TYPE, COMMENT_TYPE: COMMENT_TYPE,
    sendChat: sendChat, listComments: listComments, getComment: getComment,
    addComment: addComment, replyComment: replyComment, setStatus: setStatus, removeComment: removeComment,
    watch: watch
  };
})();
