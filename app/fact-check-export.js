/* fact-check-export.js — the ungrounded claims as a plain "outstanding fact
   checks" list, one line per claim.

   Stripped down on purpose: plain text you can paste straight into an email or a
   text and have it read clean — a title line, then one bullet per unsourced
   claim, each naming the *type of evidence* that would ground it:

       • <the claim> → <what evidence is needed>

   The claim text comes from the draft; the evidence type comes from
   app/evidence-needs.js (mechanical by default, optionally sharpened by a local
   LLM). This module only shapes — no DOM, unit-tested in node. UMD:
   window.NpjFactCheck in the browser, module.exports in node.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjFactCheck = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var BULLET = "• ";
  var ARROW = " → ";

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // one line per claim, deduped by claim text (reading order preserved)
  function lines(payload) {
    var items = (payload && payload.items) || [];
    var seen = {}, out = [];
    items.forEach(function (it) {
      var claim = clean(it.claim);
      if (!claim) return;
      var k = claim.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      var need = clean(it.need) || "a source that confirms this";
      out.push(claim + ARROW + need);
    });
    return out;
  }

  function summary(payload) { return { claims: lines(payload).length }; }

  // the deliverable: a plain-text list, safe to paste anywhere
  function toText(payload) {
    payload = payload || {};
    var title = clean(payload.title);
    var head = "Outstanding fact checks" + (title ? " — " + title : "");
    var ls = lines(payload);
    if (!ls.length) return head + "\n\nNothing to verify — every claim is grounded or owned.\n";
    return head + "\n\n" + ls.map(function (l) { return BULLET + l; }).join("\n") + "\n";
  }

  function slug(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "draft";
  }
  function filename(payload, ext) { return slug(payload && payload.title) + "-fact-checks." + (ext || "txt"); }

  function saveBlob(text, name, mime) {
    if (typeof document === "undefined") return name;
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
    return name;
  }
  function download(payload) { return saveBlob(toText(payload), filename(payload, "txt"), "text/plain;charset=utf-8"); }

  return { toText: toText, lines: lines, summary: summary, filename: filename, download: download };
});
