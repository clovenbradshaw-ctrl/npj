/* NPJ — archive.org source loader.
   Populates the Data explorer (#explore) and the composer's "Cite a dataset"
   picker straight from the Internet Archive, and registers every item as a
   citable source record (window.NPJ.SOURCES).

   HOW AN UPLOAD SHOWS UP HERE — tag it on archive.org:
     • subject tag `npj-source`            ← required; this is what the query matches
     • subject tag `npj-project:<Name>`    ← optional; groups it under a project filter
   Set tags at upload time (archive.org/upload → "Subject tags") or later via the
   item's "Edit metadata" page. New tags appear once the IA search index
   refreshes — minutes up to about an hour.

   The query itself is configurable below (window.NPJ.ARCHIVE). To pin the page
   to one IA account so strangers can't tag their way in, set
   extraQuery: 'uploader:"you@example.com"'. */
(function () {
  const CFG = (window.NPJ.ARCHIVE = {
    tag: "npj-source",             // subject tag the search matches
    projectPrefix: "npj-project:", // subject prefix → "project" filter on #explore
    rows: 200,                     // max items pulled
    extraQuery: "",                // optional AND-clause, e.g. 'uploader:"you@example.com"'
    state: "loading",              // loading | ok | error
    error: null
  });

  const FIELDS = ["identifier", "title", "description", "subject", "mediatype",
    "publicdate", "item_size", "downloads", "format", "creator"];

  function searchUrl() {
    const q = 'subject:"' + CFG.tag + '"' + (CFG.extraQuery ? " AND " + CFG.extraQuery : "");
    return "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
      "&" + FIELDS.map(f => "fl[]=" + encodeURIComponent(f)).join("&") +
      "&sort[]=" + encodeURIComponent("publicdate desc") +
      "&rows=" + CFG.rows + "&page=1&output=json";
  }

  // ---- helpers ----
  function asList(v) {
    if (Array.isArray(v)) return v.map(String);
    return v == null || v === "" ? [] : [String(v)];
  }
  // subjects can arrive as one "a;b;c" string — normalize to a flat list
  function subjectsOf(doc) {
    return asList(doc.subject).flatMap(s => s.split(";")).map(s => s.trim()).filter(Boolean);
  }
  function fmtSize(b) {
    b = Number(b);
    if (!isFinite(b) || b <= 0) return "";
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (b >= 10 || i === 0 ? Math.round(b) : b.toFixed(1)) + " " + u[i];
  }
  function plainText(v) {
    return asList(v).join(" ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function toDataset(doc) {
    const subjects = subjectsOf(doc);
    const projTag = subjects.find(s => s.toLowerCase().indexOf(CFG.projectPrefix) === 0);
    const title = asList(doc.title).join(" ") || doc.identifier;
    return {
      id: "ia-" + doc.identifier,
      identifier: doc.identifier,
      origin: "archive.org",
      name: title,
      project: projTag ? projTag.slice(CFG.projectPrefix.length).trim() || "Archive" : "Archive",
      description: plainText(doc.description),
      subjects,
      mediatype: doc.mediatype || "",
      formats: asList(doc.format),
      sizeLabel: fmtSize(doc.item_size),
      downloads: Number(doc.downloads) || 0,
      updated: String(doc.publicdate || "").slice(0, 10),
      cites: 0,
      archived: true,
      archive_url: "https://archive.org/details/" + encodeURIComponent(doc.identifier)
    };
  }

  function register(docs) {
    const ds = docs.filter(d => d && d.identifier).map(toDataset);
    const others = (window.NPJ.DATASETS || []).filter(x => x.origin !== "archive.org");
    window.NPJ.DATASETS = ds.concat(others);
    ds.forEach(d => {
      const key = "ia-" + d.identifier;
      if (!window.NPJ.SOURCES[key]) {
        window.NPJ.SOURCES[key] = {
          id: key, type: "data", outlet: "archive.org", title: d.name,
          original_url: d.archive_url, archive_url: d.archive_url, retrieved: d.updated
        };
      }
    });
    return ds.length;
  }

  function notify(count) {
    try { window.dispatchEvent(new CustomEvent("npj:datasets", { detail: { count } })); } catch (e) {}
  }

  // advancedsearch also speaks JSONP — fallback if the CORS fetch is blocked
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "__npjIA" + Date.now().toString(36);
      const s = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject(new Error("archive.org timed out")); }, 15000);
      function cleanup() { clearTimeout(timer); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error("archive.org unreachable")); };
      s.src = url + "&callback=" + cb;
      document.head.appendChild(s);
    });
  }

  async function load() {
    CFG.state = "loading"; CFG.error = null; notify(-1);
    const url = searchUrl();
    let json;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      json = await res.json();
    } catch (e) {
      try { json = await jsonp(url); } catch (e2) {
        CFG.state = "error"; CFG.error = String((e2 && e2.message) || e2);
        notify(0); return;
      }
    }
    const docs = (json && json.response && json.response.docs) || [];
    const n = register(docs);
    CFG.state = "ok";
    notify(n);
  }

  window.NPJ.loadArchiveSources = load;
  load();
})();
