/* boot.js — the no-build module loader.
 *
 * The app ships ~30 in-browser .jsx files. The old path loaded ALL of them as
 * <script type="text/babel"> and let @babel/standalone fetch + transpile every
 * one — including the 228 KB Newsroom editor — on EVERY page load, before the
 * boot script (which renders React) could run. A first-time visitor who only
 * wanted to read the front page paid to download Babel (~3 MB) and transpile
 * 1.3 MB of source they'd never use. That's the "Loading the newsroom…" wait.
 *
 * This loader fixes both halves:
 *
 *   1. SPLIT — only the front-page core is compiled before first paint
 *      (layout + shared UI + FrontPage + the app shell). The article reader and
 *      the whole editor are compiled AFTER paint, in the background, and the
 *      router shows a light spinner if you reach one before its code is ready.
 *
 *   2. CACHE — every file's compiled output is stored in the browser (Cache
 *      Storage), keyed by a hash of its source. A returning visitor reuses the
 *      compiled code and NEVER loads Babel or transpiles anything again. When a
 *      source file changes its hash changes, so the cache self-invalidates.
 *
 * Babel is loaded lazily, only when something actually needs compiling (i.e. a
 * cache miss). On a warm cache it is never fetched at all.
 *
 * The compiled code is executed by injecting a classic <script>, exactly as
 * @babel/standalone does, so every file keeps its existing global scope and the
 * window.* registrations all behave identically. The Babel options below mirror
 * @babel/standalone's own defaults for a <script type="text/babel"> tag, so the
 * cached output is byte-for-byte what the in-browser transformer produced.
 */
(function () {
  "use strict";

  // —— vendored transformer (loaded only on a cache miss) ————————————————————
  var BABEL_URL = "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js";
  var BABEL_SRI = "sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y";
  // bump when the Babel options below change so stale compiled output is dropped
  var COMPILE_CACHE = "npj-jsxc-v3";

  // —— the module manifest, in dependency order ————————————————————————————
  // EAGER: compiled before first paint — the absolute minimum to render the
  // front page (and the app shell that mounts it). Everything the front page
  // touches lives here: the layout context, the shared UI kit (incl. MediaImg
  // for cover photos), and FrontPage itself.
  var EAGER = ["tweaks-panel.jsx", "app/layout.jsx", "app/shared.jsx", "app/FrontPage.jsx"];

  // READ: the article reader + every non-editor page. Compiled right after the
  // front page paints. Gated behind window.__npjReady.read.
  var READ = [
    "app/PdfView.jsx", "app/SourceViewer.jsx", "app/SourceExplorer.jsx",
    "app/versions.jsx", "app/Entities.jsx", "app/SuggestionRail.jsx",
    "app/SubstackExport.jsx", "app/FactCheckExport.jsx", "app/ArticleRead.jsx",
    "app/ArticleEdit.jsx", "app/SourcePicker.jsx", "app/InterviewSource.jsx",
    "app/Standards.jsx", "app/Contributors.jsx", "app/Submit.jsx",
    "app/Data.jsx", "app/Documents.jsx", "app/Invite.jsx", "app/AdminEditor.jsx"
  ];

  // EDITOR: the newsroom + its heavy companions. Compiled last (after READ).
  // Gated behind window.__npjReady.all.
  var EDITOR = [
    "app/GroundingWorkspace.jsx", "app/PostStructure.jsx", "app/GraphView.jsx",
    "app/Newsroom.jsx", "app/Citey.jsx", "app/CiteyRedact.jsx"
  ];

  // The app shell (the <App/> component + the React mount) lives in an inline
  // <script type="text/npj"> in index.html so the EDITMODE tweak block keeps its
  // home there. It is the LAST eager unit: running it boots React.
  var INLINE_APP = "npj-app";

  // —— readiness flags the router reads ————————————————————————————————————
  window.__npjReady = window.__npjReady || { core: false, read: false, all: false };
  function markReady(level) {
    window.__npjReady[level] = true;
    try { window.dispatchEvent(new CustomEvent("npj:modules-ready", { detail: { level: level } })); } catch (e) {}
  }

  // —— source hashing (djb2 → 8 hex) — stable across loads, fast ———————————
  function hashSource(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // —— lazy Babel ————————————————————————————————————————————————————————
  var babelPromise = null;
  function ensureBabel() {
    if (window.Babel) return Promise.resolve(window.Babel);
    if (babelPromise) return babelPromise;
    babelPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = BABEL_URL;
      s.integrity = BABEL_SRI;
      s.crossOrigin = "anonymous";
      s.onload = function () { resolve(window.Babel); };
      s.onerror = function () { reject(new Error("could not load the JSX compiler")); };
      document.head.appendChild(s);
    });
    return babelPromise;
  }

  // Mirror @babel/standalone's buildBabelOptions() for a classic text/babel tag
  // (presets ["react","env"], the three default proposal plugins). sourceMaps is
  // off — the inline map only bloats the cache and never affects execution.
  function babelOptions(filename) {
    return {
      filename: filename,
      presets: ["react", "env"],
      plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
      sourceMaps: false,
      ast: false
    };
  }

  // —— compiled-output cache (Cache Storage) ————————————————————————————————
  // One entry per file, under a hash-free key, so a fresh compile simply
  // OVERWRITES it (no listing/pruning, which added write contention during the
  // cold burst and could drop a put). The source hash rides in a header: a HIT
  // is a key match whose stored hash equals the current source's, so a changed
  // file misses and recompiles. A failed put retries once — a single stale entry
  // would otherwise force the whole 3 MB Babel download on the next visit.
  function cacheKey(path) { return "/__jsxc__/" + encodeURIComponent(path) + "?v=" + COMPILE_CACHE; }

  async function compile(path, source) {
    var hash = hashSource(source);
    var key = cacheKey(path);
    var cache = null;
    try { if (window.caches) cache = await caches.open(COMPILE_CACHE); } catch (e) { cache = null; }

    if (cache) {
      try {
        var hit = await cache.match(key);
        if (hit && hit.headers.get("X-Src-Hash") === hash) return await hit.text();
      } catch (e) { /* fall through to compile */ }
    }

    await ensureBabel();
    var code = window.Babel.transform(source, babelOptions(path)).code;

    if (cache) {
      var headers = { "Content-Type": "application/javascript; charset=utf-8", "X-Src-Hash": hash };
      try { await cache.put(key, new Response(code, { headers: headers })); }
      catch (e) { try { await cache.put(key, new Response(code, { headers: headers })); } catch (e2) { /* best-effort */ } }
    }
    return code;
  }

  // run compiled code in global scope, exactly like @babel/standalone does
  function runCode(code, label) {
    var s = document.createElement("script");
    s.text = code + "\n//# sourceURL=npj:" + label;
    document.head.appendChild(s);
  }

  // —— a single unit: src file or the inline app shell ————————————————————
  async function fetchSource(path) {
    var res = await fetch(path, { credentials: "same-origin" });
    if (!res.ok) throw new Error("fetch " + path + " → " + res.status);
    return await res.text();
  }

  var loaded = Object.create(null);   // path → Promise, so a unit is compiled once
  function loadUnit(path) {
    if (loaded[path]) return loaded[path];
    loaded[path] = (async function () {
      var source, label = path;
      if (path === INLINE_APP) {
        var el = document.getElementById(INLINE_APP);
        if (!el) throw new Error("missing inline app shell #" + INLINE_APP);
        source = el.textContent;
        label = "app-shell";
      } else {
        source = await fetchSource(path);
      }
      var code = await compile(label, source);
      runCode(code, label);
    })().catch(function (err) {
      // one bad unit must not wedge the rest — log and continue
      try { console.error("[npj] failed to load " + path, err); } catch (e) {}
    });
    return loaded[path];
  }

  async function loadSeq(list) {
    for (var i = 0; i < list.length; i++) {
      await loadUnit(list[i]);
      // yield so a long background pass never blocks paint/interaction
      await new Promise(function (r) { setTimeout(r, 0); });
    }
  }

  // Let the router pull a bundle forward on demand (e.g. a #newsroom deep link
  // shouldn't wait for the idle pass). Safe to call repeatedly.
  function ensure(level) {
    if (level === "all") return loadSeq(READ).then(function () { markReady("read"); }).then(function () { return loadSeq(EDITOR); }).then(function () { markReady("all"); });
    return loadSeq(READ).then(function () { markReady("read"); });
  }
  window.NpjLoader = {
    ready: function (level) { return !!window.__npjReady[level || "all"]; },
    ensure: ensure
  };

  // —— service worker: cache the shell + vendor for instant repeat loads ————
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // register after load so it never competes with the first paint's resources
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  // —— go ————————————————————————————————————————————————————————————————
  (async function start() {
    registerServiceWorker();

    // drop superseded compiled-output caches (a bumped COMPILE_CACHE) so an old
    // version's blobs don't linger; the current one is kept. Best-effort.
    try {
      if (window.caches) caches.keys().then(function (names) {
        names.filter(function (n) { return n.indexOf("npj-jsxc-") === 0 && n !== COMPILE_CACHE; })
             .forEach(function (n) { caches.delete(n); });
      }).catch(function () {});
    } catch (e) {}

    // <App/> always mounts AdminEditor; stub it so the very first render can't
    // hit an undefined component. The real one loads in the READ pass and a
    // modules-ready re-render swaps it in (it renders nothing for non-admins).
    if (!window.AdminEditor) window.AdminEditor = function NpjAdminEditorStub() { return null; };

    // 1) front-page core + app shell → React mounts and paints the front page
    await loadSeq(EAGER);
    await loadUnit(INLINE_APP);
    markReady("core");

    // 2) after paint, fill in the reader + pages, then the editor — in the
    //    background, yielding between files. The router gates each route on the
    //    matching readiness flag, so this is a smooth fill-in, never a blocker.
    var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 200); };
    idle(async function () {
      await loadSeq(READ);
      markReady("read");
      await loadSeq(EDITOR);
      markReady("all");
    });
  })();
})();
