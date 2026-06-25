/* sw.js — caches the app shell + pinned vendor so repeat visits load instantly
 * (and the site still opens offline). Deliberately conservative:
 *
 *   • same-origin GETs (HTML, CSS, app/*.js, app/*.jsx, assets) → stale-while-
 *     revalidate: serve the cached copy at once, refresh it in the background,
 *     so the next load is current. The compiled-JSX cache (see app/boot.js) is
 *     keyed by source hash, so a one-load-stale source can never desync from
 *     its compiled output — a changed file simply recompiles next load.
 *   • the pinned React + Babel bundles (immutable URLs) → cache-first.
 *   • everything else — the GitHub API, raw.githubusercontent article logs, the
 *     publish webhook, fonts, icons, the synthetic /__jsxc__/ cache keys — is
 *     left entirely to the network. Article data MUST stay live; vendor with no
 *     CORS headers would only cache opaquely. So we don't touch them.
 */
var CACHE = "npj-shell-v1";

// pinned, content-addressed vendor — safe to keep forever
var IMMUTABLE = [
  "https://unpkg.com/react@18.3.1/",
  "https://unpkg.com/react-dom@18.3.1/",
  "https://unpkg.com/@babel/standalone@7.29.0/"
];

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    // Prune only OLD shell caches. Never touch the compiled-JSX cache
    // (npj-jsxc-*) — that's owned by app/boot.js and is the whole point of
    // skipping Babel on a warm load; deleting it here would re-download the
    // ~3 MB compiler on the next visit.
    var names = await caches.keys();
    await Promise.all(names
      .filter(function (n) { return n.indexOf("npj-shell-") === 0 && n !== CACHE; })
      .map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

function isImmutable(url) {
  for (var i = 0; i < IMMUTABLE.length; i++) if (url.indexOf(IMMUTABLE[i]) === 0) return true;
  return false;
}

async function cacheFirst(req) {
  var cache = await caches.open(CACHE);
  var hit = await cache.match(req);
  if (hit) return hit;
  var res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) { try { await cache.put(req, res.clone()); } catch (e) {} }
  return res;
}

async function staleWhileRevalidate(req) {
  var cache = await caches.open(CACHE);
  var hit = await cache.match(req);
  var net = fetch(req).then(function (res) {
    if (res && res.ok) { try { cache.put(req, res.clone()); } catch (e) {} }
    return res;
  }).catch(function () { return null; });
  if (hit) { net; return hit; }       // serve cache now, refresh in background
  var res = await net;
  return res || Response.error();
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  if (isImmutable(req.url)) { e.respondWith(cacheFirst(req)); return; }

  // only same-origin assets are owned by the shell cache; the compiled-JSX
  // cache keys (/__jsxc__/) are synthetic and never hit the network
  if (url.origin === self.location.origin && url.pathname.indexOf("/__jsxc__/") !== 0) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  // everything else → straight to the network (GitHub data, webhook, fonts…)
});
