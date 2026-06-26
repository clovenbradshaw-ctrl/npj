/* ============================================================
   branch-archive.js — batched, throttled archive.org writes for branches.

   A branch's words already live durably on the EVA record. This is the separate,
   independent copy on archive.org: when a PUBLIC branch goes live we hand it to a
   queue that drains ONE archive at a time, spaced out, so a flurry of branches on
   a piece never hammers archive.org (anonymous/keyed saves are rate-limited).

   Structure of the saves (server side, via site/branch-archive-npj):
     archive.org item  npj-branches-<slug>
       <branchId>.json   ← one file per branch; re-PUT overwrites, so it's
                           idempotent and batch-friendly (N branches → 1 item)

   The queue is PERSISTENT (localStorage) so a reload resumes pending saves, it
   COALESCES by (slug, branchId) so re-submitting a branch replaces its job, and
   it BACKS OFF on failure. A fresh Matrix token is read at send time (the webhook
   only needs a valid id, no role). On a confirmed save it emits onResult so the
   caller can write the archiveUrl back onto the record.

   Publishes window.NpjBranchArchive. Depends on window.MatrixAuth (token) and,
   for the endpoint host, window.NpjArticles.publishEndpoint(). No model.
   ============================================================ */
(function (root) {
  'use strict';

  var QKEY = "npj_branch_archive_q_v1";
  var SPACING_MS = 1800;   // minimum gap between archive.org PUTs (rate-limit friendly)
  var MAX_TRIES = 5;       // give up on a job after this many failed attempts
  var listeners = [];
  var draining = false;

  function endpoint() {
    try { var c = JSON.parse(root.localStorage.getItem("npj_publish_cfg_v1") || "null"); if (c && c.branchEndpoint) return c.branchEndpoint; } catch (e) {}
    var base = (root.NpjArticles && root.NpjArticles.publishEndpoint && root.NpjArticles.publishEndpoint()) || "";
    if (base) return base.replace(/\/[^/]+$/, "/branch-archive-npj");
    return "https://n8n.intelechia.com/webhook/site/branch-archive-npj";
  }

  function readQ() { try { return JSON.parse(root.localStorage.getItem(QKEY) || "[]") || []; } catch (e) { return []; } }
  function writeQ(q) { try { root.localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} }

  function token() { return (root.MatrixAuth && root.MatrixAuth.token && root.MatrixAuth.token()) || null; }
  function onResult(fn) { if (typeof fn === "function") listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit(job, url) { listeners.forEach(function (fn) { try { fn({ slug: job.slug, branchId: job.branchId, url: url, author: job.author || null }); } catch (e) {} }); }

  // Queue a PUBLIC branch for archiving. Coalesces by (slug, branchId): a second
  // submit of the same branch replaces the pending job rather than stacking.
  function enqueue(p) {
    if (!p || !p.slug || !p.branchId || !p.branch) return;
    var q = readQ().filter(function (j) { return !(j.slug === p.slug && j.branchId === p.branchId); });
    q.push({ slug: p.slug, branchId: p.branchId, branch: p.branch, title: p.title || null, author: p.author || null, tries: 0 });
    writeQ(q);
    drain();
  }

  function send(job) {
    var tok = token();
    if (!tok) return Promise.resolve({ retry: true }); // no session yet — keep it queued, try later
    return fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify({ slug: job.slug, branchId: job.branchId, branch: job.branch, title: job.title || undefined })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (out) {
        if (res.ok && out && out.ok && out.url) return { url: out.url };
        // 429 / 5xx → transient; 4xx (bad payload / unauth) → permanent
        if (res.status === 429 || res.status >= 500) return { retry: true };
        return { fail: out && out.error ? out.error : ("HTTP " + res.status) };
      });
    }).catch(function () { return { retry: true }; }); // network → transient
  }

  // Drain one job, then schedule the next after SPACING_MS. Persistent across
  // reloads: anything still queued resumes on the next drain() call.
  function drain() {
    if (draining) return;
    var q = readQ();
    if (!q.length) return;
    draining = true;
    var job = q[0];
    send(job).then(function (r) {
      var cur = readQ();
      if (r && r.url) {
        cur = cur.filter(function (j) { return !(j.slug === job.slug && j.branchId === job.branchId); });
        writeQ(cur); emit(job, r.url);
      } else if (r && r.retry) {
        // bump tries; drop after MAX_TRIES so a permanently-stuck job can't wedge the queue
        var idx = cur.findIndex(function (j) { return j.slug === job.slug && j.branchId === job.branchId; });
        if (idx >= 0) { cur[idx].tries = (cur[idx].tries || 0) + 1; if (cur[idx].tries >= MAX_TRIES) cur.splice(idx, 1); else { var d = cur.splice(idx, 1)[0]; cur.push(d); } writeQ(cur); }
      } else {
        // permanent failure → drop it (the EVA record still holds the branch)
        cur = cur.filter(function (j) { return !(j.slug === job.slug && j.branchId === job.branchId); });
        writeQ(cur);
      }
      draining = false;
      if (readQ().length) setTimeout(drain, SPACING_MS);
    });
  }

  // Resume any pending saves left from a previous session (best-effort, deferred
  // so it never competes with first paint).
  function resume() { if (readQ().length) setTimeout(drain, 2500); }

  root.NpjBranchArchive = { endpoint: endpoint, enqueue: enqueue, onResult: onResult, drain: drain, resume: resume };
  if (root.addEventListener) root.addEventListener("load", resume);
})(typeof window !== "undefined" ? window : this);
