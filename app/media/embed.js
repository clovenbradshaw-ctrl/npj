/* NPJ — embed resolver. One place that turns a pasted URL into an embeddable
   player, shared by the composer (Newsroom), the post-publish edit surface
   (ArticleEdit) and the reader (ArticleRead). The EO log only ever stores the
   original URL on the block ({ type:"embed", url, caption, height }) — this is
   where that URL is RE-resolved into an <iframe>/<video>/<audio> every render,
   so the artifact stays a plain link and the player is always rebuilt from it.

   Recognized: YouTube + Vimeo (video players, 16:9), Google Drive files and
   Google Docs/Sheets/Slides (the /preview surface), archive.org uploads
   (/embed), and direct .mp4/.mp3-style media files. Anything else falls back to
   a link card. Drive / Docs / archive items have no knowable aspect ratio (a
   PDF, a sheet, an audio file, a film all live behind the same URL shape), so
   they size by a fixed `height` the author can set — defaulting to 600. */
(function (root) {
  "use strict";

  var DEFAULT_HEIGHT = 600;

  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function attrEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }

  // Pull a Google Drive file id out of the common share / preview / open forms:
  //   …/file/d/<id>/(view|preview|edit)   …/open?id=<id>   …/uc?id=<id>
  function driveId(u) {
    var m = u.match(/\/file\/d\/([\w-]+)/); if (m) return m[1];
    m = u.match(/[?&]id=([\w-]+)/); if (m) return m[1];
    return null;
  }

  // url → embed descriptor, or null when we don't recognize it (caller shows a
  // link card). `frame` embeds render inside an <iframe>; of those, `panel`
  // ones size by a fixed height (documents / players whose aspect we can't
  // know) while the rest keep their natural 16:9 `aspect`.
  function resolve(url) {
    var u = String(url || "").trim();
    if (!u) return null;

    var yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
    if (yt) return { kind: "youtube", frame: true, src: "https://www.youtube-nocookie.com/embed/" + yt[1], aspect: "16 / 9", allow: "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture", fullscreen: true };

    var vm = u.match(/vimeo\.com\/(\d+)/);
    if (vm) return { kind: "vimeo", frame: true, src: "https://player.vimeo.com/video/" + vm[1], aspect: "16 / 9", allow: "autoplay; fullscreen; picture-in-picture", fullscreen: true };

    // Google Drive file — any share/preview/open link resolves to /preview,
    // which embeds PDFs, images, video and more. Folder links (/drive/folders/…)
    // have no file id and fall through to the link card.
    if (host(u) === "drive.google.com") {
      var id = driveId(u);
      if (id) return { kind: "drive", frame: true, panel: true, src: "https://drive.google.com/file/d/" + id + "/preview", allow: "autoplay", fullscreen: true };
    }

    // Google Docs / Sheets / Slides — same /preview trick, different host/path.
    var gdoc = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/(?:e\/)?([\w-]+)/);
    if (gdoc) return { kind: "gdocs", frame: true, panel: true, src: "https://docs.google.com/" + gdoc[1] + "/d/" + gdoc[2] + "/preview", fullscreen: true };

    // archive.org upload — a details / download / already-embed link all carry
    // the item identifier as the first path segment after the verb.
    var ia = u.match(/archive\.org\/(?:details|embed|download)\/([^/?#]+)/);
    if (ia) return { kind: "archive", frame: true, panel: true, src: "https://archive.org/embed/" + ia[1], allow: "autoplay; fullscreen", fullscreen: true };

    if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return { kind: "video", frame: false };
    if (/\.(mp3|ogg|wav|m4a)(\?|$)/i.test(u)) return { kind: "audio", frame: false };

    return null;
  }

  // The CSS the iframe needs, given its descriptor and a chosen panel height.
  function iframeStyle(r, height) {
    return r.panel
      ? "width:100%;height:" + (height || DEFAULT_HEIGHT) + "px;border:0;display:block;background:#000"
      : "width:100%;aspect-ratio:" + (r.aspect || "16 / 9") + ";border:0;display:block";
  }

  // url → the inner HTML string a <figure class="cmp-embed" data-embed-url> wraps
  // in the edit surfaces (Newsroom insertEmbed + articles.blocksToHtml). The
  // reader builds the equivalent JSX from resolve() directly.
  function innerHtml(url, opts) {
    opts = opts || {};
    var u = String(url || "");
    var r = resolve(u);
    if (r && r.frame) {
      return '<iframe src="' + attrEsc(r.src) + '" style="' + iframeStyle(r, opts.height) + '"' +
        (r.allow ? ' allow="' + r.allow + '"' : "") + (r.fullscreen ? " allowfullscreen" : "") + ' loading="lazy"></iframe>';
    }
    if (r && r.kind === "video") return '<video controls src="' + attrEsc(u) + '" style="width:100%;max-height:420px;background:#000"></video>';
    if (r && r.kind === "audio") return '<audio controls src="' + attrEsc(u) + '" style="width:100%"></audio>';
    return '<a href="' + attrEsc(u) + '" target="_blank" rel="noopener">' + (host(u) || attrEsc(u)) + "</a>";
  }

  root.NpjEmbed = { resolve: resolve, innerHtml: innerHtml, host: host, iframeStyle: iframeStyle, DEFAULT_HEIGHT: DEFAULT_HEIGHT };
  if (typeof module !== "undefined" && module.exports) module.exports = root.NpjEmbed;
})(typeof window !== "undefined" ? window : globalThis);
