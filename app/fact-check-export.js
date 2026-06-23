/* fact-check-export.js — turn the draft's UNGROUNDED claims into a worksheet a
   colleague can help check.

   The grounding workspace knows, mechanically, which sentences still block the
   publish gate: the ones that NEED A SOURCE (⊥ nothing pinned) and the ones
   where two pinned sources DISAGREE (¬ conflict). Those are exactly the claims a
   second pair of eyes can help with — find the source, or break the tie.

   This module takes a plain snapshot of those claims (assembled by
   GroundingWorkspace, which reads the live editor + registry) and shapes it into
   something shareable:

     • toMarkdown(payload, opts) → a readable worksheet: one section per claim,
       its sentence quoted, the surrounding paragraph for context, and blank
       fields for the checker to fill (source link, the words that back it,
       verdict, notes). Each claim carries its stable ref (sn-…) so a returned
       finding matches straight back to the sentence.
     • toCsv(payload, opts) → the same as a spreadsheet (one claim per row), so a
       group can split the list in a shared sheet.

   No DOM, no model — pure shaping, so it's unit-tested in node (npj's no-build
   ethos). The verdicts are the checker's to fill; nothing here decides anything.

   UMD: window.NpjFactCheck in the browser, module.exports in node.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NpjFactCheck = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var STATUS_LABEL = { needs: "needs a source", conflict: "sources disagree" };
  var STATUS_GLYPH = { needs: "⊥", conflict: "¬" };   // ⊥ · ¬

  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function isoDate(ms) {
    if (!ms && ms !== 0) return "";
    try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return ""; }
  }

  // pull the items this export covers, honoring the conflicts toggle and
  // renumbering so the worksheet always reads 1..n with no gaps
  function pickItems(payload, opts) {
    var items = (payload && payload.items) || [];
    if (opts && opts.conflicts === false) items = items.filter(function (it) { return it.status !== "conflict"; });
    return items.map(function (it, i) {
      return {
        n: i + 1,
        sid: it.sid || "",
        text: clean(it.text),
        status: it.status === "conflict" ? "conflict" : "needs",
        before: clean(it.before),
        after: clean(it.after),
        cites: (it.cites || []).map(function (c) { return { source: clean(c.source), quote: clean(c.quote), url: clean(c.url) }; })
      };
    });
  }

  // the claim shown inside its paragraph, the claim itself called out with «»
  function contextLine(it) {
    var parts = [];
    if (it.before) parts.push("…" + it.before);
    parts.push("«" + it.text + "»");
    if (it.after) parts.push(it.after + "…");
    return parts.join(" ");
  }

  function counts(items) {
    var needs = 0, conflict = 0;
    items.forEach(function (it) { if (it.status === "conflict") conflict++; else needs++; });
    return { needs: needs, conflict: conflict, total: items.length };
  }

  // ---- markdown worksheet ----
  function toMarkdown(payload, opts) {
    opts = opts || {};
    payload = payload || {};
    var withContext = opts.context !== false;
    var withConsulted = opts.consulted !== false;
    var items = pickItems(payload, opts);
    var c = counts(items);
    var title = clean(payload.title) || "Untitled draft";
    var L = [];

    L.push("# Fact-check request — " + title);
    L.push("");
    if (!items.length) {
      L.push("Every claim in this draft is already grounded in a source or honestly owned — there's nothing here to check. 🎉");
      return L.join("\n");
    }
    L.push("Someone is asking for help verifying the claims below. Each is a sentence from a draft that doesn't yet have a source. **If you can help with any of them**, fill in what you find right under it:");
    L.push("");
    L.push("- **Source** — a link to where the claim can be verified;");
    L.push("- **It says** — the exact words from that source that back (or contradict) the claim;");
    L.push("- **Verdict** — supported, false, or can't tell;");
    L.push("- **Notes** — caveats, partial support, anything the author should know.");
    L.push("");
    L.push("Keep the **ref** code (`sn-…`) with each answer so the author can match it back to the exact sentence. You don't have to take them all — any one helps.");
    L.push("");
    var tally = c.needs + " claim" + (c.needs === 1 ? "" : "s") + " need a source";
    if (c.conflict) tally += " · " + c.conflict + " where sources disagree";
    var stamp = isoDate(payload.generatedAt);
    L.push("_" + tally + (stamp ? " · exported " + stamp : "") + "._");
    L.push("");

    items.forEach(function (it) {
      L.push("---");
      L.push("");
      L.push("### Claim " + it.n + " — " + STATUS_GLYPH[it.status] + " " + STATUS_LABEL[it.status] + "  ·  ref `" + it.sid + "`");
      L.push("");
      L.push("> " + it.text);
      L.push("");
      if (it.status === "conflict" && it.cites.length) {
        L.push("Two sources already pinned to this claim disagree:");
        L.push("");
        it.cites.forEach(function (ct) {
          var line = "- “" + ct.quote + "” — " + (ct.source || "source");
          if (ct.url) line += " (" + ct.url + ")";
          L.push(line);
        });
        L.push("");
      }
      if (withContext && (it.before || it.after)) {
        L.push("**Where it sits:** " + contextLine(it));
        L.push("");
      }
      if (it.status === "conflict") {
        L.push("- **Which is right?** ");
        L.push("- **Tie-breaking source (link):** ");
        L.push("- **It says (quote):** ");
        L.push("- **Notes:** ");
      } else {
        L.push("- **Source (link):** ");
        L.push("- **It says (quote):** ");
        L.push("- **Verdict** (supported / false / can't tell)**:** ");
        L.push("- **Notes:** ");
      }
      L.push("");
    });

    var sources = (payload.sources || []).filter(function (s) { return clean(s.title) || clean(s.url); });
    if (withConsulted && sources.length) {
      L.push("---");
      L.push("");
      L.push("## Sources already in this draft");
      L.push("");
      L.push("So you don't re-check what's been read. These back other claims; the ones above still need their own.");
      L.push("");
      sources.forEach(function (s, i) {
        var line = (i + 1) + ". " + (clean(s.title) || "Untitled source");
        if (clean(s.url)) line += " — " + clean(s.url);
        line += s.archived ? "  _(archived)_" : "  _(not archived)_";
        L.push(line);
      });
      L.push("");
    }
    return L.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ---- CSV (one claim per row, blanks for the checker) ----
  function csvCell(v) {
    var s = String(v == null ? "" : v).replace(/\r?\n/g, " ");
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function toCsv(payload, opts) {
    opts = opts || {};
    var withContext = (opts.context !== false);
    var items = pickItems(payload, opts);
    var head = ["Ref", "Status", "Claim"];
    if (withContext) head.push("Where it sits");
    head.push("Sources already pinned", "Source found (link)", "It says (quote)", "Verdict", "Notes");
    var rows = [head.map(csvCell).join(",")];
    items.forEach(function (it) {
      var pinned = it.cites.map(function (ct) {
        return "“" + ct.quote + "” — " + (ct.source || "source") + (ct.url ? " (" + ct.url + ")" : "");
      }).join(" | ");
      var row = [it.sid, STATUS_LABEL[it.status], it.text];
      if (withContext) row.push(it.before || it.after ? contextLine(it) : it.text);
      row.push(pinned, "", "", "", "");
      rows.push(row.map(csvCell).join(","));
    });
    return rows.join("\r\n") + "\r\n";
  }

  // summary for the surface (counts after the conflicts toggle is applied)
  function summary(payload, opts) { return counts(pickItems(payload, opts)); }

  function slug(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "draft";
  }
  function filename(payload, ext) { return slug(payload && payload.title) + "-factcheck." + ext; }

  // ---- browser-only file saves (no-op-safe in node) ----
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
  function download(payload, opts) {
    return saveBlob(toMarkdown(payload, opts), filename(payload, "md"), "text/markdown;charset=utf-8");
  }
  function downloadCsv(payload, opts) {
    return saveBlob(toCsv(payload, opts), filename(payload, "csv"), "text/csv;charset=utf-8");
  }

  return { toMarkdown: toMarkdown, toCsv: toCsv, summary: summary, filename: filename, download: download, downloadCsv: downloadCsv };
});
