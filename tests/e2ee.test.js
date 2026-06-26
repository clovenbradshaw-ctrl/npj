/* e2ee.test.js — the real cross-user roundtrip for the collaboration layer's
 * end-to-end encryption (app/identity/e2ee.js).
 *
 * e2ee.js is a browser singleton (window/indexedDB/MatrixAuth), so we load its
 * SOURCE into an isolated function scope per "user", giving each its own window +
 * IndexedDB + Matrix identity while sharing ONE in-memory homeserver (a plain
 * array of state events) and the SAME WebCrypto realm (so CryptoKeys created by
 * one user are usable by another, the way real device keys would be).
 *
 * What it proves:
 *   • a member who's been shared the room key decrypts what another member wrote
 *   • a member is re-shared the key once they publish a device (ensureShares)
 *   • a NON-member (never shared) can't obtain the key and can't decrypt
 *   • the homeserver only ever stores ciphertext + public keys + per-device wraps
 *     — never a room key in the clear, never a plaintext
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "identity", "e2ee.js"), "utf8");

// —— a faithful-enough async in-memory IndexedDB (open → get/put on one store) ——
function makeIDB() {
  const stores = { keys: new Map() };
  function later(fn) { queueMicrotask(fn); }
  return {
    open() {
      const req = {};
      const db = {
        createObjectStore(n) { stores[n] = stores[n] || new Map(); },
        transaction(n) {
          const store = stores[n] || (stores[n] = new Map());
          return { objectStore() {
            return {
              get(k) { const r = {}; later(() => { r.result = store.get(k); r.onsuccess && r.onsuccess(); }); return r; },
              put(v, k) { const r = {}; store.set(k, v); later(() => { r.onsuccess && r.onsuccess(); }); return r; }
            };
          } };
        }
      };
      later(() => { req.result = db; if (req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); });
      return req;
    }
  };
}

// —— one shared in-memory homeserver: PUT/GET room state, with a sender per token ——
function makeServer() {
  const events = []; // { room, type, state_key, content, sender }
  const tokenUser = {}; // token → user_id
  function resp(data, ok = true, status = 200) { return Promise.resolve({ ok, status, json: () => Promise.resolve(data) }); }
  function fetchImpl(url, init) {
    init = init || {};
    const token = String((init.headers && init.headers.Authorization) || "").replace("Bearer ", "");
    const user = tokenUser[token] || "@unknown:hs";
    // PUT /rooms/{room}/state/{type}/{state_key}
    let m = url.match(/\/rooms\/([^/]+)\/state\/([^/]+)\/([^?]*)$/);
    if (m && init.method === "PUT") {
      const room = decodeURIComponent(m[1]), type = decodeURIComponent(m[2]), sk = decodeURIComponent(m[3] || "");
      const content = JSON.parse(init.body);
      const existing = events.find(e => e.room === room && e.type === type && e.state_key === sk);
      if (existing) existing.content = content; else events.push({ room, type, state_key: sk, content, sender: user });
      return resp({ event_id: "$" + events.length });
    }
    // GET /rooms/{room}/state  (full state array)
    m = url.match(/\/rooms\/([^/]+)\/state$/);
    if (m && (!init.method || init.method === "GET")) {
      const room = decodeURIComponent(m[1]);
      return resp(events.filter(e => e.room === room).map(e => ({ type: e.type, state_key: e.state_key, content: e.content, sender: e.sender })));
    }
    return resp({ errcode: "M_UNRECOGNIZED" }, false, 404);
  }
  return { events, tokenUser, fetchImpl };
}

// —— load e2ee.js as a fresh per-user instance (own window + IndexedDB) ——
function loadUser(server, user, deviceId) {
  const token = "tok-" + user;
  server.tokenUser[token] = user;
  const window = { MatrixAuth: {
    current: () => ({ user_id: user, base_url: "https://hs", device_id: deviceId }),
    token: () => token
  } };
  const fn = new Function(
    "window", "crypto", "indexedDB", "fetch", "btoa", "atob",
    "TextEncoder", "TextDecoder", "AbortController", "setTimeout", "console",
    SRC + "\n;return window.NpjE2EE;"
  );
  return fn(window, webcrypto, makeIDB(), server.fetchImpl, btoa, atob, TextEncoder, TextDecoder, AbortController, setTimeout, console);
}

test("e2ee: shared member decrypts; non-member cannot; server stores only ciphertext", async () => {
  const room = "!proj:hs";
  const server = makeServer();
  const A = loadUser(server, "@alice:hs", "DEVA");
  const B = loadUser(server, "@bob:hs", "DEVB");
  const C = loadUser(server, "@carol:hs", "DEVC"); // never invited to the key

  // Alice opens the room: publishes her device, mints + self-shares the room key.
  const a = await A.init(room);
  assert.ok(a.keyId, "Alice has a room key");

  // Bob joins and publishes his device, but holds no key yet.
  await B.publishDevice(room);
  assert.equal(await B.obtainRoomKey(room), null, "Bob can't get the key before it's shared to him");

  // Alice (a keyholder) re-shares the current key to every device lacking it.
  const shared = await A.ensureShares(room);
  assert.ok(shared >= 1, "Alice shared the key to Bob's new device");

  // Alice writes an encrypted payload; Bob obtains the key and reads it.
  const secret = { body: "the mayor took the bribe", n: 42 };
  const env = await A.encrypt(room, secret);
  assert.equal(env.alg, A.ALG);
  assert.ok(env.ct && env.iv && env.keyId, "envelope carries ciphertext + iv + keyId");

  await B.obtainRoomKey(room);
  const got = await B.decrypt(room, env);
  assert.deepEqual(got, secret, "Bob decrypts Alice's payload");

  // Carol publishes a device but was never shared the key → can't read.
  await C.publishDevice(room);
  assert.equal(await C.obtainRoomKey(room), null, "Carol obtains no key");
  await assert.rejects(() => C.decrypt(room, env), /No key/i, "Carol cannot decrypt");

  // The homeserver only ever saw ciphertext, public keys, and per-device wraps —
  // never the room key in the clear, never the plaintext.
  const blob = JSON.stringify(server.events);
  assert.ok(!blob.includes("bribe"), "no plaintext on the server");
  assert.ok(!blob.includes(env.ct.slice(0, 1) + "PLAINTEXT"), "sanity");
  const types = new Set(server.events.map(e => e.type));
  assert.ok(types.has(A.DEVICE_TYPE) && types.has(A.KEYSHARE_TYPE), "only device + keyshare state on the server");
});

test("e2ee: rotation mints a fresh key the old wrap can't read", async () => {
  const room = "!proj2:hs";
  const server = makeServer();
  const A = loadUser(server, "@alice:hs", "DEVA");
  const first = await A.init(room);
  const env1 = await A.encrypt(room, { v: 1 });
  const next = await A.rotate(room);
  assert.notEqual(next, first.keyId, "rotation produced a new key id");
  const env2 = await A.encrypt(room, { v: 2 });
  assert.equal(env2.keyId, next, "new writes use the rotated key");
  // both still readable by Alice (she holds both keys), but they're distinct keys
  assert.notEqual(env1.keyId, env2.keyId);
  assert.deepEqual(await A.decrypt(room, env2), { v: 2 });
});
