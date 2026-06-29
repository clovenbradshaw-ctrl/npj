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

  // Feedback schema version. Bumping the trailing number RETIRES every comment,
  // suggestion, vote and reply written under an older version: fold() drops any
  // feedback event whose `v` names an earlier feedback-eo schema, and the local
  // mirror keys carry the same version so stale pending deposits aren't read back
  // either. The append-only log keeps the old lines in GitHub — they just stop
  // folding into the live rail. (Article INS/REC events are unaffected; only
  // feedback-eo deposits are versioned here.)
  var FB_VERSION = 2;
  var FB_SCHEMA_PREFIX = "npj/feedback-eo/";
  var FB_SCHEMA = FB_SCHEMA_PREFIX + FB_VERSION;
  var LOCAL_PREFIX = "npj_fb_v" + FB_VERSION + "_";
  var VOTES_KEY = "npj_fb_votes_v" + FB_VERSION;
  var CTX = 36; // chars of context kept on each side of an anchored span

  // The feedback-schema version a raw event was written under, or null when the
  // event isn't a feedback-eo deposit at all (an article INS/REC, or a local
  // pending deposit that hasn't been committed and so carries no `v`). Used by
  // fold() to skip superseded feedback while leaving everything else alone.
  function fbVersionOf(ev) {
    var v = ev && ev.v;
    if (typeof v !== "string" || v.indexOf(FB_SCHEMA_PREFIX) !== 0) return null;
    var n = parseInt(v.slice(FB_SCHEMA_PREFIX.length), 10);
    return isFinite(n) ? n : null;
  }

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
      // Drop feedback deposits written under a retired schema version, so a
      // version bump cleanly excludes every old comment/suggestion/vote/reply
      // (committed v.<n> lines still live in the log; they just stop folding).
      var fv = fbVersionOf(ev);
      if (fv !== null && fv < FB_VERSION) return;
      var o = ev && ev.operand;
      if (!o || !o.id) return;
      if (o.ref) {
        var t = by[o.ref];
        if (!t) return;
        if (o.act === "vote") t.votes += (o.dir || 1);
        else if (o.act === "reply") t.replies.push({ author: ev.actor || o.author || "@anon", authorName: o.authorName || "", text: o.text || "", ts: String(ev.ts || o.ts || "").slice(0, 10) });
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
        claimId: (o.anchor && o.anchor.claimId) || null,
        anchor: o.anchor || null,
        proposed: o.proposed || "",
        rationale: o.rationale || "",
        author: ev.actor || o.author || "@anon",
        // legacy field: older records carried a typed byline here. Contributions are
        // now shown anonymously under a pseudonym derived from `author` (the mxid),
        // so this is kept only so old deposits still fold cleanly — it isn't displayed.
        authorName: o.authorName || "",
        trust: o.trust || "open",
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

  // Propose a span change (kind:"suggestion") or leave a span comment ("comment").
  function propose(p) {
    var id = newId("fb");
    var operand = {
      id: id, kind: p.kind || "suggestion", anchor: p.anchor || null,
      proposed: p.kind === "comment" ? "" : (p.proposed || ""), rationale: p.rationale || "",
      base_sha: p.base_sha || "", author: p.author || null, authorName: p.authorName || "", trust: p.trust || "open"
    };
    return commitEva(p.slug, operand, p.author, p.token, "feedback: " + p.slug).then(function (r) { return { ok: true, id: id, committed: r.committed }; });
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
    var operand = { id: newId("fbr"), ref: p.ref, act: "reply", text: p.text || "", author: p.author || null, authorName: p.authorName || "" };
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
     (the kind a PR shows when the base moved) — never a silent wrong edit.

     The anchor is the EXACT selected words (a free drag-selection — see
     makeAnchor), so the merge changes only those words. A `claimId` is just a
     locating hint: it points us at the sentence the selection sits in, but we
     still swap the selected sub-span, never the whole sentence — UNLESS the
     quote IS the whole claim (the "Suggest edit" on a citation, anchorFromClaim),
     where the selection and the sentence are one and the same. A selection that
     runs across several tokens/sentences is handled by replaceAcrossTokens. */
  function tokenText(t) {
    if (t == null) return "";
    if (typeof t === "string") return t;
    if (typeof t === "object") { if (t.c != null) return String(t.c); if (t.text != null) return String(t.text); }
    return "";
  }
  // rebuild a token carrying new text, preserving its shape (string / {c} claim /
  // {text} styled run). A token with no text slot (a <br>/sup) is returned as-is.
  function setTokenText(t, s) {
    if (typeof t === "string") return s;
    if (t && t.c != null) return Object.assign({}, t, { c: s });
    if (t && t.text != null) return Object.assign({}, t, { text: s });
    return t;
  }
  // Replace a quote that spans MORE THAN ONE token in a token run (a selection
  // that crossed sentence/style boundaries). Keep the untouched head of the first
  // token and tail of the last in place (so their styling/citation survives),
  // drop the tokens fully inside the selection, and drop the proposed words in as
  // a plain run between them. Returns the new token array, or null if the quote
  // doesn't sit across this run.
  function replaceAcrossTokens(tokens, quote, proposed) {
    if (!tokens || !quote) return null;
    var texts = tokens.map(tokenText);
    var full = texts.join("");
    var at = full.indexOf(quote);
    if (at < 0) return null;
    var end = at + quote.length;
    var pos = 0, startTok = -1, startOff = 0, endTok = -1, endOff = 0;
    for (var i = 0; i < tokens.length; i++) {
      var L = texts[i].length;
      if (startTok < 0 && pos + L > at) { startTok = i; startOff = at - pos; }
      if (startTok >= 0 && pos + L >= end) { endTok = i; endOff = end - pos; break; }
      pos += L;
    }
    if (startTok < 0 || endTok < 0 || startTok === endTok) return null; // single-token — caller handles it
    var out = tokens.slice(0, startTok);
    var head = texts[startTok].slice(0, startOff);
    var tail = texts[endTok].slice(endOff);
    if (head) out.push(setTokenText(tokens[startTok], head));
    out.push(proposed);
    if (tail) out.push(setTokenText(tokens[endTok], tail));
    for (var j = endTok + 1; j < tokens.length; j++) out.push(tokens[j]);
    return out;
  }
  function applyToBody(body, s) {
    var next = JSON.parse(JSON.stringify(body || []));
    var claimId = s.anchor && s.anchor.claimId;
    var quote = (s.anchor && s.anchor.quote) || "";
    var proposed = s.proposed || "";
    var done = false;
    // swap `quote` for `proposed` inside one token's text — within a sub-span of
    // the sentence, not the whole token. Used for the per-token pass below.
    function swapInToken(t) {
      var text = tokenText(t);
      if (!quote || text.indexOf(quote) < 0) return null;
      done = true;
      return setTokenText(t, text.replace(quote, proposed));
    }
    function fixTokens(tokens) {
      var list = tokens || [];
      // The claim the selection sat in is the surest handle — try it first, so an
      // identical fragment elsewhere in the paragraph can't be edited by mistake.
      // A whole-claim anchor (quote === the claim's own text) replaces the claim
      // outright; a sub-span swaps only the selected words inside it.
      if (claimId) {
        var ci = list.findIndex(function (t) { return t && typeof t === "object" && t.c != null && t.id === claimId; });
        if (ci >= 0) {
          done = true;
          var ct = list[ci];
          var nc = (quote && quote !== ct.c && ct.c.indexOf(quote) >= 0)
            ? Object.assign({}, ct, { c: ct.c.replace(quote, proposed) })
            : Object.assign({}, ct, { c: proposed });
          return list.map(function (t, k) { return k === ci ? nc : t; });
        }
      }
      // no claim handle (a free selection), or the claim is gone — locate by the
      // selected words: within one token, else spliced across several
      var out = list.map(function (t) {
        if (done) return t;
        var swapped = swapInToken(t);
        return swapped == null ? t : swapped;
      });
      if (done) return out;
      var across = replaceAcrossTokens(list, quote, proposed);
      if (across) { done = true; return across; }
      return out;
    }
    for (var i = 0; i < next.length && !done; i++) {
      var b = next[i];
      if (b.type === "p" && b.tokens) b.tokens = fixTokens(b.tokens);
      else if ((b.type === "ul" || b.type === "ol") && b.items) b.items = b.items.map(function (it) { return done ? it : fixTokens(it); });
      else if (quote && (b.type === "h2" || b.type === "h3" || b.type === "pull" || b.type === "code" || b.type === "verse") && b.text && b.text.indexOf(quote) >= 0) { b.text = b.text.replace(quote, proposed); done = true; }
    }
    return done ? next : null;
  }
  function merge(p) {
    var s = p.suggestion, A = p.article;
    if (s.kind === "comment") return Promise.resolve({ ok: false, comment: true });
    var body = applyToBody(A.body, s);
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
    VERSION: FB_VERSION,
    makeAnchor: makeAnchor, anchorFromClaim: anchorFromClaim, locate: locate,
    paintAnchors: paintAnchors, clearAnchors: clearAnchors, flash: flash, supportsHighlight: supportsHL,
    load: load, propose: propose, vote: vote, reply: reply, resolve: resolve,
    applyToBody: applyToBody, merge: merge
  };
})(typeof window !== "undefined" ? window : this);
