/* fact-check-export.js — the ungrounded claims as a plain "outstanding fact
   checks" bullet list.

   Stripped down on purpose: the output is plain text you can paste straight into
   an email or a text message and have it still read clean — a title line and a
   flat list of bullets, nothing else (no headings, no fields, no markdown
   scaffolding). Each bullet is a bare proposition (extracted upstream by
   eoreader4 via app/propositions.js); a sentence that yielded several claims
   contributes several bullets.

   Pure shaping, no DOM — unit-tested in node. UMD: window.NpjFactCheck in the
   browser, module.exports in node.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjFactCheck = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var BULLET = "• ";

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // flatten the per-claim propositions into one deduped, reading-order list
  function bullets(payload) {
    var items = (payload && payload.items) || [];
    var seen = {}, out = [];
    items.forEach(function (it) {
      (it.props || []).forEach(function (p) {
        var t = clean(p);
        if (!t) return;
        var k = t.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1; out.push(t);
      });
    });
    return out;
  }

  function summary(payload) {
    var items = (payload && payload.items) || [];
    return { props: bullets(payload).length, claims: items.length };
  }

  // the deliverable: a plain-text bullet list, safe to paste anywhere
  function toText(payload) {
    payload = payload || {};
    var title = clean(payload.title);
    var head = "Outstanding fact checks" + (title ? " — " + title : "");
    var list = bullets(payload);
    if (!list.length) return head + "\n\nNothing to verify — every claim is grounded or owned.\n";
    var lines = [head, ""];
    list.forEach(function (t) { lines.push(BULLET + t); });
    lines.push("");
    return lines.join("\n");
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

  return { toText: toText, bullets: bullets, summary: summary, filename: filename, download: download };
});
