/* ============================================================
   feedback.js — span-anchored reader feedback, considered for merge.

   We like the THEORY of a pull request (a change proposed against a base, read
   in context, discussed, then merged or declined) — not its UX. So this is the
   theory without the machinery: a reader selects the exact words they'd change,
   proposes the edit (or just leaves a comment), and an editor reviews it beside
   the live text and MERGES it in one click — which writes a real commit to the
   record, attributed, with the reader's rationale as the edit note.

   Storage rides the article's own EO event log. Each piece of feedback is one
   EVA deposit committed as a brand-new file in the document's folder —
   articles/<slug>/<stamp>-eva-<tail>.jsonl — so it is plaintext, auditable, and
   FOLDS AS A NO-OP for the article reader (EVA never touches article state). The
   merge itself is an ordinary REC edit (app/articles.js appendEdit), so the
   privileged, already-authorized commit path is the only thing that can change
   the published words — a proposal can't.

   Every write is ALSO mirrored to localStorage, so feedback survives a refresh
   and the whole flow is demonstrable before the webhook rule below is live (the
   webhook must accept an `*-eva-*.jsonl` file in articles/<slug>/ from any
   whoami-verified Matrix user — proposing is open; merging stays editor-only
   because it commits a REC).

   Anchoring is robust to edits: a span is pinned by its quote plus a little
   context on each side, and re-LOCATED by searching the rendered text — so a
   suggestion keeps pointing at the right words even after the article moves on
   (and is flagged "stale" when its base version has been superseded).

   Publishes window.NpjFeedback. Depends on window.NpjArticles. No model.
   ============================================================ */
(function (root) {
  'use strict';

  var FB_SCHEMA = "npj/feedback-eo/1";
  var LOCAL_PREFIX = "npj_fb_v1_";
  var VOTES_KEY = "npj_fb_votes_v1";
  var CTX = 36; // chars of context kept on each side of an anchored span

  function nowIso() { return new Date().toISOString(); }
  function rnd() { return Math.floor(Math.random() * 1e9).toString(36); }
  function newId(p) { return p + "-" + Date.now().toString(36) + "-" + rnd(); }

  /* ---------------- local mirror ---------------- */
  function localKey(slug) { return LOCAL_PREFIX + slug; }
  function readLocal(slug) { try { return JSON.parse(root.localStorage.getItem(localKey(slug)) || "[]") || []; } catch (e) { return []; } }
  function writeLocal(slug, arr) { try { root.localStorage.setItem(localKey(slug), JSON.stringify(arr)); } catch (e) {} }
  function pushLocal(slug, ev) { var a = readLocal(slug); a.push(ev); writeLocal(slug, a); }
  function readVotes() { try { return JSON.parse(root.localStorage.getItem(VOTES_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function writeVotes(v) { try { root.localStorage.setItem(VOTES_KEY, JSON.stringify(v)); } catch (e) {} }

  /* ---------------- span anchoring (re-locatable spans) ---------------- */
  // plain-text offset of a DOM point within `root` (what the reader actually sees)
  function plainOffset(rootEl, node, off) {
    var r = (rootEl.ownerDocument || document).createRange();
    r.setStart(rootEl, 0);
    try { r.setEnd(node, off); } catch (e) { return -1; }
    return r.toString().length;
  }
  // Build an anchor from a live selection Range. claimId pins it to a bound
  // claim token when the selection sits on one (an exact, edit-proof handle).
  function makeAnchor(rootEl, range, claimId) {
    if (!rootEl || !range) return null;
    var full = rootEl.textContent || "";
    var start = plainOffset(rootEl, range.startContainer, range.startOffset);
    var quote = range.toString();
    if (!quote) return null;
    var end = start + quote.length;
    return {
      quote: quote,
      prefix: start > 0 ? full.slice(Math.max(0, start - CTX), start) : "",
      suffix: full.slice(end, end + CTX),
      claimId: claimId || null
    };
  }
  // An anchor for a whole bound claim (the reader's "Suggest edit" on a citation).
  function anchorFromClaim(claim) {
    if (!claim) return null;
    return { quote: claim.text || claim.c || "", prefix: "", suffix: "", claimId: claim.id || null };
  }
  // Where does this anchor land in the current text? Returns a char offset, or
  // -1 if the words are gone. Tightest match first: prefix+quote+suffix, then
  // prefix+quote, then the quote alone.
  function findOffset(rootEl, anchor) {
    if (!rootEl || !anchor || !anchor.quote) return -1;
    var full = rootEl.textContent || "";
    var q = anchor.quote;
    if (anchor.prefix || anchor.suffix) {
      var probe = (anchor.prefix || "") + q + (anchor.suffix || "");
      var i = full.indexOf(probe);
      if (i >= 0) return i + (anchor.prefix || "").length;
      if (anchor.prefix) { var j = full.indexOf(anchor.prefix + q); if (j >= 0) return j + anchor.prefix.length; }
      if (anchor.suffix) { var k = full.indexOf(q + anchor.suffix); if (k >= 0) return k; }
    }
    return full.indexOf(q);
  }
  // Map a plain-text [start,start+len) back to a DOM Range across text nodes.
  function rangeAtOffset(rootEl, start, len) {
    if (start < 0) return null;
    var doc = rootEl.ownerDocument || document;
    var walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    var pos = 0, end = start + len, sN = null, sO = 0, eN = null, eO = 0, n;
    while ((n = walker.nextNode())) {
      var L = n.nodeValue.length;
      if (sN === null && pos + L > start) { sN = n; sO = start - pos; }
      if (sN !== null && pos + L >= end) { eN = n; eO = end - pos; break; }
      pos += L;
    }
    if (sN === null) return null;
    if (eN === null) { eN = sN; eO = sN.nodeValue.length; }
    var r = doc.createRange();
    try { r.setStart(sN, sO); r.setEnd(eN, eO); } catch (e) { return null; }
    return r;
  }
  function locate(rootEl, anchor) {
    var s = findOffset(rootEl, anchor);
    if (s < 0) return null;
    return rangeAtOffset(rootEl, s, (anchor.quote || "").length);
  }

  /* ---------------- highlight the spans in the doc (Google-Docs feel) ----------------
     Uses the CSS Custom Highlight API so we never mutate React-owned DOM. Silent
     no-op where unsupported — the rail still works, you just don't see the
     marker painted in the prose. */
  function supportsHL() { return !!(root.CSS && root.CSS.highlights && typeof root.Highlight === "function"); }
  // new Highlight(...ranges) with a variadic spread that works on every engine
  function construct(ranges) {
    var H = root.Highlight;
    return new (Function.prototype.bind.apply(H, [null].concat(ranges)))();
  }
  function paintAnchors(rootEl, anchors) {
    if (!supportsHL() || !rootEl) return false;
    var ranges = [];
    (anchors || []).forEach(function (a) { var r = locate(rootEl, a); if (r) ranges.push(r); });
    try {
      if (!ranges.length) { root.CSS.highlights.delete("npj-feedback"); return true; }
      root.CSS.highlights.set("npj-feedback", construct(ranges));
      return true;
    } catch (e) { return false; }
  }
  function clearAnchors() { try { if (supportsHL()) root.CSS.highlights.delete("npj-feedback"); } catch (e) {} }
  // Flash one span and scroll it into view — the rail's "show in text" action.
  function flash(rootEl, anchor) {
    var r = locate(rootEl, anchor);
    if (!r) return false;
    if (supportsHL()) {
      try {
        root.CSS.highlights.set("npj-feedback-flash", construct([r]));
        setTimeout(function () { try { root.CSS.highlights.delete("npj-feedback-flash"); } catch (e) {} }, 1900);
      } catch (e) {}
    }
    try {
      var rect = r.getBoundingClientRect();
      if (rect) root.scrollTo({ top: rect.top + root.scrollY - 130, behavior: "smooth" });
    } catch (e) {}
    return true;
  }

  /* ---------------- fold raw events → reviewable suggestions ----------------
     A proposal is an EVA whose operand carries { id, kind } and no `ref`.
     Actions (vote / reply / resolve) are EVAs whose operand carries `ref` =
     the proposal id. Article INS/REC events have no such operand and are
     skipped, so feedback can share the document's folder. */
  function fold(events, opts) {
    opts = opts || {};
    var by = {}, order = [];
    (events || []).forEach(function (ev) {
      var o = ev && ev.operand;
      if (!o || !o.id) return;
      if (o.ref) {
        var t = by[o.ref];
        if (!t) return;
        if (o.act === "vote") t.votes += (o.dir || 1);
        else if (o.act === "reply") t.replies.push({ author: ev.actor || o.author || "@anon", text: o.text || "", ts: String(ev.ts || o.ts || "").slice(0, 10) });
        else if (o.act === "branch") {
          // the async follow-up that attaches the merge-request room + the
          // archive.org snapshot once they're confirmed (see attachBranch)
          if (o.roomId) t.roomId = o.roomId;
          if (o.archiveUrl) t.archiveUrl = o.archiveUrl;
          if (o.visibility) t.visibility = o.visibility;
        }
        else if (o.act === "resolve") {
          t.status = (o.outcome === "accepted" || o.outcome === "merged") ? "accepted" : (o.outcome === "review" ? "review" : "rejected");
          t.resolution = o.note || "";
          t.commit_sha = o.commit_sha || null;
          t.merged = o.outcome === "merged";
          t.resolvedBy = ev.actor || o.author || null;
        }
        return;
      }
      if (o.kind !== "suggestion" && o.kind !== "comment") return;
      if (by[o.id]) return; // first writer wins (committed dedupe handled by caller)
      by[o.id] = {
        id: o.id,
        kind: o.kind,
        // "span" (pinned to selected words) or "article" (a contribution on the
        // whole piece — read like a PR description, resolved by an editor, never
        // auto-merged since it isn't bound to a quote)
        scope: (o.anchor && o.anchor.scope) || "span",
        claimId: (o.anchor && o.anchor.claimId) || null,
        anchor: o.anchor || null,
        proposed: o.proposed || "",
        rationale: o.rationale || "",
        author: ev.actor || o.author || "@anon",
        trust: o.trust || "open",
        // a contribution is a BRANCH: a fork of these words. visibility gates who
        // may see/toggle it ("public" → everyone; "private" → the contributor +
        // the article's authors only). roomId is its merge-request discussion;
        // archiveUrl is its best-effort archive.org snapshot. The last two are
        // filled in by the async "branch" follow-up after the proposal lands.
        visibility: o.visibility === "private" ? "private" : "public",
        roomId: o.roomId || null,
        archiveUrl: o.archiveUrl || null,
        // a whole-article FORK carries its edited copy of the body (text-level
        // edits to existing blocks) — what the reader paints when the fork is
        // toggled on, and what a merge commits as the new body
        forkBody: Array.isArray(o.forkBody) ? o.forkBody : null,
        base_sha: o.base_sha || "",
        ts: String(ev.ts || o.ts || "").slice(0, 10),
        status: "proposed",
        votes: 0,
        voted: false,
        replies: []
      };
      order.push(o.id);
    });
    var votes = readVotes();
    var list = order.map(function (id) { return by[id]; });
    list.forEach(function (s) {
      if (s.votes < 0) s.votes = 0;
      s.voted = !!votes[s.id];
      if (opts.base_sha && s.base_sha && s.base_sha !== opts.base_sha) s.stale = true;
    });
    return list;
  }

  /* ---------------- load: committed EVA + local pending ---------------- */
  function load(slug, opts) {
    opts = opts || {};
    return Promise.resolve()
      .then(function () { return root.NpjArticles.fetchEvents(slug); })
      .catch(function () { return { events: [], base_sha: null }; })
      .then(function (r) {
        var committed = (r && r.events) || [];
        var base = opts.base_sha || (r && r.base_sha) || null;
        var seen = {};
        committed.forEach(function (ev) { var o = ev && ev.operand; if (o && o.id) seen[o.id] = 1; });
        // keep only local events the committed log hasn't yet caught up to
        var local = readLocal(slug).filter(function (ev) { var o = ev && ev.operand; return o && o.id && !seen[o.id]; });
        return fold(committed.concat(local), { base_sha: base });
      });
  }

  /* ---------------- write ops (local-first, webhook best-effort) ---------------- */
  function commitEva(slug, operand, actor, token, message) {
    pushLocal(slug, { op: "EVA", actor: actor || null, ts: nowIso(), operand: operand });
    if (!token || !root.NpjArticles.appendEvent) return Promise.resolve({ committed: false });
    return root.NpjArticles.appendEvent({ slug: slug, op: "EVA", operand: operand, actor: actor, token: token, schema: FB_SCHEMA, message: message || ("feedback: " + slug) })
      .then(function (out) { return { committed: !!(out && out.res && out.res.ok), sha: out && out.sha }; })
      .catch(function () { return { committed: false }; });
  }

  // Propose a span change (kind:"suggestion") or leave a span comment ("comment")
  // — i.e. open a BRANCH. visibility ("public"|"private") is the submitter's
  // choice and rides the proposal itself (it gates who can see the branch).
  // After it lands we asynchronously open the merge-request room and snapshot
  // the branch to archive.org, attaching both via a "branch" follow-up event.
  function propose(p) {
    var id = newId("fb");
    var operand = {
      id: id, kind: p.kind || "suggestion", anchor: p.anchor || null,
      proposed: p.kind === "comment" ? "" : (p.proposed || ""), rationale: p.rationale || "",
      base_sha: p.base_sha || "", author: p.author || null, trust: p.trust || "open",
      visibility: p.visibility === "private" ? "private" : "public"
    };
    if (Array.isArray(p.forkBody) && p.forkBody.length) operand.forkBody = p.forkBody;
    return commitEva(p.slug, operand, p.author, p.token, "feedback: " + p.slug).then(function (r) {
      // best-effort, never blocks the proposal: open the MR room + archive the branch
      try { attachBranch({ slug: p.slug, id: id, operand: operand, author: p.author, token: p.token, authors: p.authors || [], shareUrl: p.shareUrl || null }); } catch (e) {}
      return { ok: true, id: id, committed: r.committed };
    });
  }

  /* ---------------- a branch's merge-request room + archive.org snapshot ----------------
     Both are enhancements layered on top of the durable EVA record (which already
     holds the branch's words), so neither blocks proposing and a failure of either
     just leaves that field null. The contributor's own account opens the room and
     invites the article's authors; the snapshot rides anonymous Save Page Now. The
     results are written back as a "branch" follow-up EVA so they're on the record
     and every reader folds them in. */
  function attachBranch(p) {
    var token = p.token;
    var jobs = [];
    // 1) the merge-request discussion room (needs a verified session + invitees)
    if (token && root.MatrixAuth && root.MatrixAuth.createMergeRequestRoom) {
      var label = (p.operand && p.operand.scope === "article") ? "whole article" : "a span";
      jobs.push(
        root.MatrixAuth.createMergeRequestRoom({
          slug: p.slug, title: "Merge request · " + label + " · " + p.slug,
          invite: p.authors || [], visibility: p.operand && p.operand.visibility
        }).then(function (r) { return { roomId: r && r.roomId }; }).catch(function () { return {}; })
      );
    } else { jobs.push(Promise.resolve({})); }
    // 2) the archive.org snapshot of the piece this branch forks from (best-effort;
    //    the branch's own words are already on the permanent EO record)
    if (p.shareUrl && root.NpjArchiveCDN && root.NpjArchiveCDN.ensureSnapshot) {
      jobs.push(root.NpjArchiveCDN.ensureSnapshot(p.shareUrl).then(function (u) { return { archiveUrl: u || null }; }).catch(function () { return {}; }));
    } else { jobs.push(Promise.resolve({})); }

    return Promise.all(jobs).then(function (res) {
      var roomId = res[0] && res[0].roomId, archiveUrl = res[1] && res[1].archiveUrl;
      if (!roomId && !archiveUrl) return;
      return commitEva(p.slug, { id: newId("fbb"), ref: p.id, act: "branch", roomId: roomId || null, archiveUrl: archiveUrl || null, author: p.author || null }, p.author, token, "branch: " + p.slug);
    }).catch(function () {});
  }

  /* ---------------- branch visibility + preview ----------------
     canSee: a public branch is visible to everyone; a private one only to its
     author and the article's authors/assignees. previewBranch returns the body
     with the branch's words applied (the fork rendered) — what the reader paints
     when a branch is toggled ON before any merge. Null when it can't apply
     cleanly (a comment, a whole-article proposal, or a moved base). */
  function isOwnerView(viewer, owners) {
    if (!viewer) return false;
    return (owners || []).some(function (o) { return o && viewer && String(o).toLowerCase() === String(viewer).toLowerCase(); });
  }
  function canSee(s, viewer, owners) {
    if (!s) return false;
    if (s.visibility !== "private") return true;
    if (viewer && s.author && String(viewer).toLowerCase() === String(s.author).toLowerCase()) return true;
    return isOwnerView(viewer, owners);
  }
  function previewBranch(body, s) {
    if (!s) return null;
    if (s.scope === "article") return (s.forkBody && s.forkBody.length) ? s.forkBody : null; // the fork's edited copy
    if (s.kind === "comment") return null;
    return applyToBody(body, s); // null on conflict — never a wrong paint
  }
  // Toggle this browser's 👍 on a proposal; returns the new on/off state.
  function vote(p) {
    var votes = readVotes(); var on = !votes[p.ref]; var dir = on ? 1 : -1;
    if (on) votes[p.ref] = 1; else delete votes[p.ref];
    writeVotes(votes);
    commitEva(p.slug, { id: newId("fbv"), ref: p.ref, act: "vote", dir: dir, author: p.author || null }, p.author, p.token);
    return on;
  }
  function reply(p) {
    var operand = { id: newId("fbr"), ref: p.ref, act: "reply", text: p.text || "", author: p.author || null };
    return commitEva(p.slug, operand, p.author, p.token, "feedback reply: " + p.slug).then(function (r) { return { ok: true, committed: r.committed }; });
  }
  // Editor resolution without a body change: accept (stands), review, or reject.
  function resolve(p) {
    var operand = { id: newId("fbr"), ref: p.ref, act: "resolve", outcome: p.outcome, note: p.note || "", commit_sha: p.commit_sha || null, author: p.author || null };
    return commitEva(p.slug, operand, p.author, p.token, "feedback resolve: " + p.slug).then(function (r) { return { ok: true, committed: r.committed }; });
  }

  /* ---------------- merge: a proposal becomes a real edit ----------------
     Apply the proposed words to the article body, then commit them through the
     ordinary edit path (REC), and record the resolution as "merged". Returns the
     new body + the commit sha so the reader can fold the update in place. A
     suggestion whose words can't be found in the current body is a "conflict"
     (the kind a PR shows when the base moved) — never a silent wrong edit. */
  function applyToBody(body, s) {
    var next = JSON.parse(JSON.stringify(body || []));
    var claimId = s.anchor && s.anchor.claimId;
    var quote = (s.anchor && s.anchor.quote) || "";
    var proposed = s.proposed || "";
    var done = false;
    function fixTokens(tokens) {
      return (tokens || []).map(function (t) {
        if (done) return t;
        if (t && typeof t === "object" && t.c != null) {
          if (claimId && t.id === claimId) { done = true; return Object.assign({}, t, { c: proposed }); }
          if (!claimId && quote && t.c.indexOf(quote) >= 0) { done = true; return Object.assign({}, t, { c: t.c.replace(quote, proposed) }); }
        } else if (typeof t === "string") {
          if (!claimId && quote && t.indexOf(quote) >= 0) { done = true; return t.replace(quote, proposed); }
        } else if (t && t.text != null) {
          if (!claimId && quote && t.text.indexOf(quote) >= 0) { done = true; return Object.assign({}, t, { text: t.text.replace(quote, proposed) }); }
        }
        return t;
      });
    }
    for (var i = 0; i < next.length && !done; i++) {
      var b = next[i];
      if (b.type === "p" && b.tokens) b.tokens = fixTokens(b.tokens);
      else if ((b.type === "ul" || b.type === "ol") && b.items) b.items = b.items.map(function (it) { return done ? it : fixTokens(it); });
      else if (!claimId && quote && (b.type === "h2" || b.type === "h3" || b.type === "pull" || b.type === "code" || b.type === "verse") && b.text && b.text.indexOf(quote) >= 0) { b.text = b.text.replace(quote, proposed); done = true; }
    }
    return done ? next : null;
  }
  function merge(p) {
    var s = p.suggestion, A = p.article;
    if (s.kind === "comment") return Promise.resolve({ ok: false, comment: true });
    // a whole-article fork commits its edited copy wholesale; a span branch
    // applies its words to the live body (a conflict if the base has moved)
    var body = (s.scope === "article")
      ? ((s.forkBody && s.forkBody.length) ? JSON.parse(JSON.stringify(s.forkBody)) : null)
      : applyToBody(A.body, s);
    if (!body) return Promise.resolve({ ok: false, conflict: true });
    var note = "Merged a reader suggestion" + (s.author ? " from " + s.author : "") + (s.rationale ? " — " + s.rationale : "");
    return root.NpjArticles.appendEdit({ slug: p.slug, operand: { body: body }, actor: p.actor, note: note, token: p.token })
      .then(function (out) {
        if (!out.res.ok) return { ok: false, status: out.res.status };
        resolve({ slug: p.slug, ref: s.id, outcome: "merged", note: "Merged into v." + out.sha, author: p.actor, token: p.token, commit_sha: out.sha });
        return { ok: true, sha: out.sha, body: body, note: note };
      })
      .catch(function (e) { return { ok: false, error: (e && e.message) || "network error" }; });
  }

  root.NpjFeedback = {
    SCHEMA: FB_SCHEMA,
    makeAnchor: makeAnchor, anchorFromClaim: anchorFromClaim, locate: locate,
    paintAnchors: paintAnchors, clearAnchors: clearAnchors, flash: flash, supportsHighlight: supportsHL,
    load: load, propose: propose, vote: vote, reply: reply, resolve: resolve,
    applyToBody: applyToBody, merge: merge,
    canSee: canSee, previewBranch: previewBranch
  };
})(typeof window !== "undefined" ? window : this);
