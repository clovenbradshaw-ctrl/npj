/* ============================================================
   html-urls.js — pull the outbound URLs out of an imported HTML file. NO MODEL.

   When you import an HTML document as a source (a saved article, a bookmarks
   export, a reading list), every link it carries is a source in its own right —
   one worth capturing before it rots. This pack reads those links off the raw
   HTML, mechanically, so the Newsroom can mint a web source for each and put it
   on archive.org.

     · extractUrls(html)          → the ordered, de-duplicated list of absolute
                                     http(s) URLs the document links to. A
                                     web.archive.org wrapper is unwrapped to the
                                     page it captured, so we archive the source,
                                     not the snapshot.
     · newUrls(html, absorbed)    → the same list, minus anything already
                                     absorbed. `absorbed` is any iterable of URL
                                     strings (a room's existing source URLs); the
                                     comparison is by normalized form, so
                                     http/https, www, a trailing slash, the query
                                     and a wayback wrapper all collapse together.
     · normUrl(u)                 → the normalizer used for that comparison. Kept
                                     in lock-step with NpjSources.normUrl so
                                     "already absorbed" means the same thing here
                                     as it does to the synthetic-dedup index.

   Regex, not DOM: this runs in the browser AND under `node --test` with no jsdom
   (npj's zero-dep ethos). Pulls from href/anchor targets and bare URLs in the
   text — not asset src (images/scripts/styles), which aren't sources to cite.

   Plain script — publishes window.NpjHtmlUrls; also module.exports for tests.
   ============================================================ */
(function (root) {
  'use strict';

  // Normalize a URL so http/https, www, the query/hash, a trailing slash and a
  // wayback wrapper all collapse to the same string. MUST match NpjSources.normUrl
  // (app/sources/sources.js) so a URL this pack calls "new" is a URL the source
  // index would also treat as unseen.
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    var wb = u.match(/web\.archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/i);
    if (wb) u = wb[1];
    return u.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[#?].*$/, '')
      .replace(/\/+$/, '');
  }

  // A wayback capture points at a real page — that page is the source we mean to
  // archive, not the snapshot of it. Unwrap `…/web/<ts>/https://site/…` to the
  // inner URL (stripping the id_/im_/etc. flag wayback appends to the timestamp).
  function unwrapWayback(u) {
    var m = String(u || '').match(/web\.archive\.org\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/i);
    return m ? m[1] : u;
  }

  // bare URLs in prose pick up trailing punctuation from the sentence around them
  // — and a paren/quote the link sits inside. Peel those off the tail.
  function trimTail(u) {
    u = String(u || '').replace(/[)\]}>.,;:!?'"’”]+$/, '');
    // an unbalanced closing paren belongs to the URL (e.g. a wiki "(disambiguation)"
    // path); only strip the one we peeled if there's no opener to match it.
    return u;
  }

  var HREF_RE = /(?:href|data-href)\s*=\s*["']([^"']+)["']/gi;
  var BARE_RE = /\bhttps?:\/\/[^\s"'<>()]+/gi;
  var ABS_RE = /^https?:\/\//i;

  // Every absolute http(s) URL the document links to, in document order, unwrapped
  // from any wayback capture and de-duplicated by normalized form. Relative links,
  // in-page anchors, mailto:/tel:/javascript: and asset src are all skipped.
  function extractUrls(html) {
    html = String(html || '');
    if (!html) return [];
    var out = [], seen = {};
    function take(raw) {
      var u = unwrapWayback(trimTail(String(raw || '').trim()));
      if (!ABS_RE.test(u)) return;                 // absolute web URLs only
      var k = normUrl(u);
      if (!k || seen[k]) return;                   // drop blanks + dupes (by content)
      seen[k] = 1; out.push(u);
    }
    var m;
    while ((m = HREF_RE.exec(html))) take(decodeEntities(m[1]));
    // strip tags so a bare URL sitting in text is caught without re-catching the
    // href attributes we already read above.
    var text = html.replace(/<[^>]+>/g, ' ');
    while ((m = BARE_RE.exec(text))) take(decodeEntities(m[0]));
    return out;
  }

  // the handful of entities that actually show up inside an href (& and its kin)
  function decodeEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&')
      .replace(/&#0?38;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'");
  }

  // The imported document's links MINUS the ones already absorbed. `absorbed` is
  // any iterable of URL strings (a source shelf's original_url + archive_url).
  function newUrls(html, absorbed) {
    var have = {};
    (absorbed == null ? [] : Array.from(absorbed)).forEach(function (u) {
      var k = normUrl(u); if (k) have[k] = 1;
    });
    return extractUrls(html).filter(function (u) { return !have[normUrl(u)]; });
  }

  // Does this look like HTML we should mine for links? (An .html/.htm/.xhtml name
  // or a text/html mime, or content that opens like a document.) Best-effort.
  function isHtml(name, mime, sample) {
    if (/text\/html|application\/xhtml/i.test(String(mime || ''))) return true;
    if (/\.(x?html?|mhtml?)$/i.test(String(name || ''))) return true;
    var s = String(sample || '').slice(0, 400).toLowerCase();
    return /<!doctype html|<html[\s>]|<a\s+[^>]*href=/.test(s);
  }

  var api = { extractUrls: extractUrls, newUrls: newUrls, normUrl: normUrl, unwrapWayback: unwrapWayback, isHtml: isHtml };
  root.NpjHtmlUrls = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
