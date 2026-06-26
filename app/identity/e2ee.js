/* e2ee.js — end-to-end encryption for the per-article collaboration layer.
 *
 * Element/Matrix encrypt rooms with Olm (a Double Ratchet) for 1:1 key delivery
 * and Megolm (a ratcheted group session) for the room itself. That stack needs
 * libolm (a WASM blob) and the matrix-js-sdk — neither of which fits a no-build,
 * in-browser-Babel app that talks to the homeserver with plain fetch. So this is
 * the SAME SHAPE built on the browser's native Web Crypto, with zero dependencies:
 *
 *   • Device identity key — each browser mints an ECDH P-256 keypair once. The
 *     PRIVATE key is non-extractable and never leaves IndexedDB; the PUBLIC key is
 *     published into the room as a `press.npj.e2ee.device` state event so every
 *     other member can address key material to this device.
 *
 *   • Room content key — a single AES-GCM 256 key per room (Megolm's "group
 *     session"), the only thing that can read the room's comments + chat. It is
 *     delivered to each member device by ECDH: derive a shared secret from
 *     (my private, their public), wrap the room key under it, and write the wrap
 *     as a `press.npj.e2ee.keyshare` state event addressed to that device. A new
 *     member who publishes a device is re-shared the key by any online keyholder.
 *
 *   • Rotation — removing someone mints a fresh room key shared only to the
 *     devices that remain, so a departed member's old key can't read new traffic
 *     (backward secrecy, like Megolm rotating on membership change).
 *
 * The homeserver only ever stores ciphertext, public keys, and per-device wraps —
 * it never sees a room key or a plaintext. That is genuine end-to-end encryption:
 * a homeserver admin cannot read collaborators' comments or chat. It is NOT wire-
 * compatible with Element's Olm/Megolm — it's the same threat model, our own
 * primitives. The whole thing is best-effort at the call site: where crypto or
 * the homeserver is unavailable it throws a typed error the UI surfaces plainly.
 *
 * Exposed as window.NpjE2EE. Depends on window.MatrixAuth (base_url + token).
 */
(function () {
  "use strict";

  var DEVICE_TYPE = "press.npj.e2ee.device";     // state: a member device's public identity key
  var KEYSHARE_TYPE = "press.npj.e2ee.keyshare"; // state: the room key wrapped for one device
  var ALG = "NPJ-E2EE/1";                          // our scheme tag, stamped on every envelope
  var IDB_NAME = "npj-e2ee";
  var IDB_STORE = "keys";

  var subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;

  // —— availability ————————————————————————————————————————————————————————
  function ready() { return !!(subtle && typeof indexedDB !== "undefined"); }
  function MA() { return window.MatrixAuth; }

  // —— base64 (ArrayBuffer ⇄ string), URL-safe-agnostic standard b64 ————————
  function buf2b64(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b642buf(str) {
    var s = atob(String(str || "")), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  function utf8(str) { return new TextEncoder().encode(str); }
  function randHex(n) {
    var a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }

  // —— tiny IndexedDB key/value store (CryptoKey + ArrayBuffer are clonable) ——
  var _db = null;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbGet(key) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var r = d.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function idbPut(key, val) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var r = d.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(val, key);
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  // —— Matrix request (uses the live session's base_url + token) ————————————
  function mreq(path, opts) {
    opts = opts || {};
    var ma = MA();
    var s = ma && ma.current && ma.current();
    var token = ma && ma.token && ma.token();
    if (!s || !token) { var e = new Error("Sign in first"); e.code = "noauth"; return Promise.reject(e); }
    var headers = { "Authorization": "Bearer " + token };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(s.base_url + path, { method: opts.method || "GET", headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) { var err = new Error((data && (data.error || data.errcode)) || ("HTTP " + res.status)); err.status = res.status; err.errcode = data && data.errcode; throw err; }
          return data || {};
        });
      });
  }
  function myId() { var s = MA() && MA().current && MA().current(); return s ? s.user_id : null; }

  function putState(roomId, type, stateKey, content) {
    return mreq("/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state/" +
      encodeURIComponent(type) + "/" + encodeURIComponent(stateKey || ""), { method: "PUT", body: content });
  }
  function getAllState(roomId) {
    return mreq("/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/state");
  }

  // —— device identity ——————————————————————————————————————————————————————
  // One ECDH keypair per browser. The private key is non-extractable (it can
  // derive, but can't be read out of the engine), so it lives in IndexedDB as a
  // CryptoKey we never export. The public key rides into rooms for everyone.
  var _device = null; // { deviceId, priv (CryptoKey), pubJwk }
  function ensureDevice() {
    if (_device) return Promise.resolve(_device);
    return idbGet("device").then(function (rec) {
      if (rec && rec.priv && rec.pubJwk && rec.deviceId) { _device = rec; return rec; }
      // mint: ECDH P-256, private non-extractable, public exportable (public keys
      // always are, even when the keypair is generated non-extractable)
      return subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"])
        .then(function (kp) {
          return subtle.exportKey("jwk", kp.publicKey).then(function (pubJwk) {
            var sess = MA() && MA().current && MA().current();
            var deviceId = (sess && sess.device_id) || ("web-" + randHex(8));
            var dev = { deviceId: deviceId, priv: kp.privateKey, pubJwk: pubJwk };
            return idbPut("device", dev).then(function () { _device = dev; return dev; });
          });
        });
    });
  }
  function importPub(jwk) {
    return subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  }
  // ECDH(my private, their public) → an AES-GCM wrapping key, used to wrap/unwrap
  // the room key for exactly that one device pair.
  function deriveWrap(theirPubJwk) {
    return ensureDevice().then(function (dev) {
      return importPub(theirPubJwk).then(function (pub) {
        return subtle.deriveKey({ name: "ECDH", public: pub }, dev.priv,
          { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
    });
  }

  // —— per-device address used as the keyshare state_key ————————————————————
  function shareKey(user, device, keyId) { return user + "|" + device + "|" + keyId; }
  function deviceKey(user, device) { return user + "|" + device; }

  // —— room key cache (memory + IndexedDB) ——————————————————————————————————
  var roomKeys = {};    // roomId → { keyId → CryptoKey }
  var currentKey = {};  // roomId → keyId we encrypt with
  function cacheKey(roomId, keyId, key) {
    (roomKeys[roomId] = roomKeys[roomId] || {})[keyId] = key;
  }
  function rawToKey(raw) {
    return subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  }
  function loadRoomKeyFromIdb(roomId, keyId) {
    return idbGet("roomkey:" + roomId + ":" + keyId).then(function (raw) {
      if (!raw) return null;
      return rawToKey(raw).then(function (k) { cacheKey(roomId, keyId, k); return k; });
    });
  }
  function getCachedKey(roomId, keyId) {
    var k = roomKeys[roomId] && roomKeys[roomId][keyId];
    if (k) return Promise.resolve(k);
    return loadRoomKeyFromIdb(roomId, keyId);
  }

  // —— publish / read devices ————————————————————————————————————————————————
  function publishDevice(roomId) {
    return ensureDevice().then(function (dev) {
      var user = myId();
      return putState(roomId, DEVICE_TYPE, deviceKey(user, dev.deviceId),
        { user_id: user, device_id: dev.deviceId, alg: ALG, pub: dev.pubJwk, ts: new Date().toISOString() });
    });
  }
  function listDevices(roomId) {
    return getAllState(roomId).then(function (st) {
      return (st || []).filter(function (ev) { return ev && ev.type === DEVICE_TYPE && ev.content && ev.content.pub; })
        .map(function (ev) { return { user_id: ev.content.user_id, device_id: ev.content.device_id, pub: ev.content.pub }; });
    }).catch(function () { return []; });
  }
  function listShares(roomId) {
    return getAllState(roomId).then(function (st) {
      return (st || []).filter(function (ev) { return ev && ev.type === KEYSHARE_TYPE && ev.content && ev.content.ct; })
        .map(function (ev) { return Object.assign({ state_key: ev.state_key }, ev.content); });
    }).catch(function () { return []; });
  }

  // —— mint a fresh room key and deliver it to every known device ————————————
  function createRoomKey(roomId) {
    var keyId = randHex(8);
    return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]).then(function (key) {
      return subtle.exportKey("raw", key).then(function (raw) {
        cacheKey(roomId, keyId, key);
        currentKey[roomId] = keyId;
        return idbPut("roomkey:" + roomId + ":" + keyId, raw)
          .then(function () { return distribute(roomId, keyId, raw); })
          .then(function () { return keyId; });
      });
    });
  }
  // Wrap `raw` under each listed device's ECDH secret and write a keyshare for it.
  function distribute(roomId, keyId, raw, onlyDevices) {
    return (onlyDevices ? Promise.resolve(onlyDevices) : listDevices(roomId)).then(function (devices) {
      var me = myId();
      return ensureDevice().then(function (dev) {
        return Promise.all(devices.map(function (d) {
          return deriveWrap(d.pub).then(function (wrapKey) {
            var iv = crypto.getRandomValues(new Uint8Array(12));
            return subtle.encrypt({ name: "AES-GCM", iv: iv }, wrapKey, raw).then(function (ct) {
              return putState(roomId, KEYSHARE_TYPE, shareKey(d.user_id, d.device_id, keyId), {
                keyId: keyId, alg: ALG, sender: me, sender_device: dev.deviceId, sender_pub: dev.pubJwk,
                iv: buf2b64(iv), ct: buf2b64(ct), ts: new Date().toISOString()
              }).then(function () { return true; }).catch(function () { return false; });
            });
          }).catch(function () { return false; });
        })).then(function (rs) { return rs.filter(Boolean).length; });
      });
    });
  }

  // —— obtain a room key addressed to THIS device (unwrap the newest we can) ——
  function obtainRoomKey(roomId) {
    return ensureDevice().then(function (dev) {
      var me = myId();
      return listShares(roomId).then(function (shares) {
        var mine = shares.filter(function (s) { return s.state_key === shareKey(me, dev.deviceId, s.keyId); });
        mine.sort(function (a, b) { return String(b.ts || "").localeCompare(String(a.ts || "")); });
        // try newest first; the first that unwraps wins and becomes current
        var i = 0;
        function tryNext() {
          if (i >= mine.length) return Promise.resolve(null);
          var sh = mine[i++];
          return getCachedKey(roomId, sh.keyId).then(function (existing) {
            if (existing) { if (!currentKey[roomId]) currentKey[roomId] = sh.keyId; return sh.keyId; }
            return deriveWrap(sh.sender_pub).then(function (wrapKey) {
              return subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(b642buf(sh.iv)) }, wrapKey, b642buf(sh.ct))
                .then(function (raw) {
                  return rawToKey(raw).then(function (key) {
                    cacheKey(roomId, sh.keyId, key);
                    currentKey[roomId] = currentKey[roomId] || sh.keyId;
                    return idbPut("roomkey:" + roomId + ":" + sh.keyId, raw).then(function () { return sh.keyId; });
                  });
                });
            }).catch(function () { return tryNext(); });
          });
        }
        return tryNext();
      });
    });
  }

  // —— ensure there IS a usable room key, creating + sharing one if none ——————
  function ensureKey(roomId) {
    if (currentKey[roomId]) return Promise.resolve(currentKey[roomId]);
    return obtainRoomKey(roomId).then(function (keyId) {
      if (keyId) return keyId;
      // none addressed to us. If shares exist (a key is out there but not for our
      // device yet) we can't mint a rival key — wait to be re-shared. Only mint
      // when the room has NO key at all.
      return listShares(roomId).then(function (shares) {
        if (shares.length) { var e = new Error("Waiting for a collaborator to share the room key with this device."); e.code = "nokey"; throw e; }
        return createRoomKey(roomId);
      });
    });
  }

  // Re-share the CURRENT key to any device that lacks a keyshare for it (e.g. a
  // member who just joined and published their device). No-op when everyone's
  // covered. Requires that we hold the current key.
  function ensureShares(roomId) {
    var keyId = currentKey[roomId];
    if (!keyId) return Promise.resolve(0);
    return getCachedKey(roomId, keyId).then(function (key) {
      if (!key) return 0;
      return subtle.exportKey("raw", key).then(function (raw) {
        return Promise.all([listDevices(roomId), listShares(roomId)]).then(function (r) {
          var devices = r[0], shares = r[1];
          var have = {}; shares.forEach(function (s) { if (s.keyId === keyId) have[s.state_key] = 1; });
          var missing = devices.filter(function (d) { return !have[shareKey(d.user_id, d.device_id, keyId)]; });
          if (!missing.length) return 0;
          return distribute(roomId, keyId, raw, missing);
        });
      });
    });
  }

  // Mint a fresh key and share it ONLY to the currently-listed devices. Use when
  // a member is removed: the new key can't be read with the old wraps.
  function rotate(roomId) { return createRoomKey(roomId); }

  // —— init: stand up this device + a room key, then top up shares ————————————
  function init(roomId) {
    if (!ready()) { var e = new Error("This browser can't do end-to-end encryption (no Web Crypto / IndexedDB)."); e.code = "unsupported"; return Promise.reject(e); }
    return publishDevice(roomId)
      .then(function () { return ensureKey(roomId); })
      .then(function (keyId) { return ensureShares(roomId).then(function () { return { keyId: keyId }; }); });
  }

  // —— encrypt / decrypt an arbitrary JSON payload under the room key ————————
  function encrypt(roomId, obj) {
    return ensureKey(roomId).then(function (keyId) {
      return getCachedKey(roomId, keyId).then(function (key) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var pt = utf8(JSON.stringify(obj));
        var aad = utf8(roomId + "|" + keyId);
        return subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad }, key, pt).then(function (ct) {
          return { v: 1, alg: ALG, keyId: keyId, iv: buf2b64(iv), ct: buf2b64(ct) };
        });
      });
    });
  }
  function decrypt(roomId, env) {
    if (!env || !env.ct || !env.keyId) return Promise.reject(new Error("not an encrypted payload"));
    function withKey(key) {
      if (!key) { var e = new Error("No key for this message yet."); e.code = "nokey"; throw e; }
      var aad = utf8(roomId + "|" + env.keyId);
      return subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(b642buf(env.iv)), additionalData: aad }, key, b642buf(env.ct))
        .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
    }
    return getCachedKey(roomId, env.keyId).then(function (key) {
      if (key) return withKey(key);
      // not cached — maybe a key shared while we were offline; try to obtain it
      return obtainRoomKey(roomId).then(function () { return getCachedKey(roomId, env.keyId).then(withKey); });
    });
  }

  function status(roomId) { return { keyId: currentKey[roomId] || null, hasKey: !!currentKey[roomId], ready: ready() }; }

  window.NpjE2EE = {
    ALG: ALG, DEVICE_TYPE: DEVICE_TYPE, KEYSHARE_TYPE: KEYSHARE_TYPE,
    ready: ready, init: init, publishDevice: publishDevice, listDevices: listDevices,
    obtainRoomKey: obtainRoomKey, createRoomKey: createRoomKey, ensureShares: ensureShares, rotate: rotate,
    encrypt: encrypt, decrypt: decrypt, status: status,
    // exposed for tests / advanced callers
    _b64: { enc: buf2b64, dec: b642buf }
  };
})();
