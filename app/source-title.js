/* ============================================================
   source-title.js — best-effort SOURCE IDENTITY. NO MODEL.

   A web source lands with a generic title ("Web snapshot") and only its
   hostname for an outlet. This pack does our best to NAME it — the article's
   title and where it's from — mechanically:

     · guess(url)         → { title, outlet } from the URL alone (slug + host).
     · metaFromHtml(html) → { title, site }  read off the page's own <title> /
                            og: / twitter: tags, when we can reach the HTML.
     · cleanTitle(t,site) → strip a trailing " | Outlet" / " - Outlet" tail.

   No network in here (that's archive-cdn.pageMeta, which fetches the CORS-open
   archived HTML and hands it to metaFromHtml). No model — every guess is a
   mechanical read, honest about what it is.

   Plain script — publishes window.NpjSourceTitle; also module.exports for tests.
   ============================================================ */
(function (root) {
  'use strict';

  function collapse(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // strip the boilerplate subdomains nobody means as the outlet
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^(www|m|mobile|amp)\./i, ''); }
    catch (e) { return ''; }
  }
  function prettyOutlet(url) { return hostOf(url); }

  // slug → words: drop a file extension, turn separators into spaces, undo a
  // little percent-encoding, collapse. "metro-council-rejects-budget.html" →
  // "metro council rejects budget".
  function deSlug(seg) {
    return collapse(String(seg || '')
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/%[0-9a-f]{2}/ig, ' '));
  }
  // sentence-case the first letter only — we don't pretend to know proper nouns
  function sentenceCase(s) {
    s = collapse(s);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  // path parts that are clearly not a headline slug
  var SKIP = /^(index|amp|article|articles|story|stories|news|post|posts|p|default|home)$/i;
  function looksDateOrId(seg) {
    return /^\d+$/.test(seg) || /^\d{4}([-/]\d{1,2}){0,2}$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg);
  }
  // A readable title guess from the URL path's slug — the last segment that
  // reads like words. '' when the path is just a section or an id.
  function titleFromUrl(url) {
    var path;
    try { path = new URL(url).pathname; } catch (e) { return ''; }
    var segs = path.split('/').filter(Boolean);
    for (var i = segs.length - 1; i >= 0; i--) {
      var seg; try { seg = decodeURIComponent(segs[i]); } catch (e) { seg = segs[i]; }
      if (SKIP.test(seg) || looksDateOrId(seg)) continue;
      var words = deSlug(seg);
      // a real headline slug has several words (or a long-ish phrase); a bare
      // section ("politics") is skipped so we don't mislabel the source
      if (/[a-z]/i.test(words) && (words.split(' ').length >= 2 || words.length >= 14)) return sentenceCase(words);
    }
    return '';
  }

  function guess(url) {
    return { title: titleFromUrl(url), outlet: prettyOutlet(url) };
  }

  // ---- read identity off the page's own HTML (best-effort, regex, no DOM) ----
  function decodeEntities(s) {
    return collapse(String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;|&#0?34;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
      .replace(/&nbsp;|&#160;/g, ' ').replace(/&#8217;/g, "'").replace(/&#8211;|&#8212;/g, '—')
      .replace(/&#x?[0-9a-f]+;/ig, ' '));
  }
  // pull a <meta> content for a property/name, attributes in either order
  function metaContent(html, prop) {
    var p = prop.replace(/[:]/g, '\\:');
    var re1 = new RegExp('<meta[^>]+(?:property|name)\\s*=\\s*["\']' + p + '["\'][^>]*?content\\s*=\\s*["\']([^"\']*)["\']', 'i');
    var re2 = new RegExp('<meta[^>]+content\\s*=\\s*["\']([^"\']*)["\'][^>]*?(?:property|name)\\s*=\\s*["\']' + p + '["\']', 'i');
    var m = html.match(re1) || html.match(re2);
    return m ? decodeEntities(m[1]) : '';
  }
  function firstTag(html, tag) {
    var m = html.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
    return m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')) : '';
  }
  // { title, site } from a page's own metadata. og:/twitter: first, then
  // <title>, then the first <h1>; site from og:site_name / application-name.
  function metaFromHtml(html) {
    html = String(html || '');
    if (!html) return { title: '', site: '' };
    var title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || firstTag(html, 'title') || firstTag(html, 'h1');
    var site = metaContent(html, 'og:site_name') || metaContent(html, 'application-name');
    return { title: collapse(title), site: collapse(site) };
  }

  // strip a trailing outlet tail from a headline: "Headline | Nashville Scene"
  // → "Headline". Splits on the usual separators; the outlet side is the known
  // site, else the short trailing one.
  function cleanTitle(title, site) {
    title = collapse(title);
    if (!title) return '';
    var parts = title.split(/\s+[|–—·\-]\s+/);
    if (parts.length < 2) return title;
    var first = parts.slice(0, -1).join(' — ');
    var last = parts[parts.length - 1];
    var siteN = collapse(site).toLowerCase();
    if (siteN && last.toLowerCase() === siteN) return first;
    if (siteN && parts[0].toLowerCase() === siteN) return parts.slice(1).join(' — ');
    // no known site: drop a short trailing tail (likely the outlet)
    if (last.length <= first.length && last.length <= 32) return first;
    return title;
  }

  var api = {
    guess: guess, titleFromUrl: titleFromUrl, prettyOutlet: prettyOutlet, hostOf: hostOf,
    metaFromHtml: metaFromHtml, cleanTitle: cleanTitle, deSlug: deSlug, sentenceCase: sentenceCase
  };
  root.NpjSourceTitle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
