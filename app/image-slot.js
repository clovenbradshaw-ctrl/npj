// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* BEGIN USAGE */
/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever you want the user to
 * supply an image. You control the slot's shape and size; the user fills it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The host bridge only allows sidecar writes at the project root, so the
 * HTML that uses this component is assumed to live at the project root too
 * (same constraint as design_canvas.jsx).
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          object-fit: cover | contain | fill.       (default 'cover')
 *                With cover (the default) double-clicking the filled slot
 *                enters a reframe mode: the whole image spills past the mask
 *                (translucent outside, opaque inside), drag to reposition,
 *                corner-drag to scale. The crop persists alongside the image
 *                in the sidecar. contain/fill stay static.
 *   position     object-position for fit=contain|fill.     (default '50% 50%')
 *   fitcontrol   Boolean — show a Cover/Contain/Fill toggle in the hover
 *                controls. When set, the chosen fit and the cover crop
 *                (pan/zoom + frame aspect) are also written into light-DOM
 *                attributes (`fit`, `data-crop="s,x,y,ar"`) and reported on the
 *                'image-slot-change' event, so a host that persists the slot's
 *                HTML (NPJ drafts/publish) carries the framing without a sidecar.
 *   conform      Boolean — once filled, size the box to the IMAGE's aspect ratio
 *                instead of the author-declared height, so the slot shows the
 *                whole image (matching what the reader publishes) rather than a
 *                fixed-height letterbox crop. A saved crop's aspect wins over the
 *                image's natural ratio. Empty slots keep the declared height as
 *                the drop target. Used by the NPJ banner and inline article
 *                images; reframe (cover) still zoom-crops within the image's
 *                own ratio.
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. A user drop overrides
 *                it; clearing the drop reveals src again.
 *
 * archive.org links (when window.NpjArchiveCDN is present — app/archive-cdn.js):
 *   Dropping or pasting an archive.org link (details page, download link, or
 *   wayback capture) resolves it to a direct image URL and writes it into the
 *   element's `src` attribute — so the image rides the host document's HTML
 *   (drafts, publish) instead of the sidecar, served by the IA's CDN. The
 *   element marks such srcs with `data-cdn` (Remove clears them) and fires a
 *   bubbling 'image-slot-change' event so hosts that persist HTML can save.
 *
 * media store (when window.NpjMedia is present — app/media-store.js):
 *   Dropping or browsing to a LOCAL file uploads it to the configured media
 *   store (the Matrix homeserver) and writes the returned https URL into `src`
 *   exactly like an archive.org link — so local drops are durable, never base64,
 *   and never ride image bytes into a commit. The NPJ publish step then moves
 *   those media-store images onto archive.org. Without a media store (e.g. a
 *   logged-out standalone embed) a local drop falls back to a session-only
 *   data-URL preview that shows but does not persist or publish.
 *
 * Size and layout come from ordinary CSS on the element — width/height
 * inline or from a parent grid — so it composes with any layout.
 *
 * Usage:
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */
/* END USAGE */

(() => {
  const STATE_FILE = '.image-slots.state.json';
  // The LONGEST side a stored image may reach. Generous on purpose: the encode
  // below retinas the slot's *width* and lets the height run up to this cap, so a
  // TALL document — an emailed scan, a long screenshot — stays legible instead of
  // being crushed. A normal photo is bounded by its slot width (2×), never this,
  // so files stay light; only tall/large images approach the cap (a text WebP at
  // q=0.9 is still well under ~1MB even at this size).
  const MAX_DIM = 3000;
  // A touch higher than a photo would need, so screenshot text keeps its edges.
  const WEBP_Q = 0.9;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;

  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        // Merge: sidecar loses to any in-memory change that raced ahead of
        // the fetch (drop or clear) so neither is clobbered by hydration.
        if (j && typeof j === 'object') {
          const merged = Object.assign({}, j, slots);
          // A framing-only write that raced ahead of hydration must not
          // drop a user image that's only on disk — inherit u from the
          // sidecar for any in-memory entry that lacks one.
          for (const k in slots) {
            if (merged[k] && !merged[k].u && j[k]) {
              merged[k].u = typeof j[k] === 'string' ? j[k] : j[k].u;
            }
          }
          for (const id of tombstones) delete merged[id];
          slots = merged;
        }
        tombstones.clear();
      })
      .catch(() => {})
      .then(() => { loaded = true; subs.forEach((fn) => fn()); });
    return loadP;
  }

  // Serialize writes so two near-simultaneous drops on different slots
  // can't reorder at the backend and leave the sidecar with only the
  // first. A save requested mid-flight just marks dirty and re-fires on
  // completion with the then-current slots.
  let saving = false;
  let saveDirty = false;
  function save() {
    if (saving) { saveDirty = true; return; }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_FILE, JSON.stringify(slots)))
      .catch(() => {})
      .then(() => { saving = false; if (saveDirty) { saveDirty = false; save(); } });
  }

  const S_MAX = 5;
  const clampS = (s) => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? { u: v, s: 1, x: 0, y: 0 } : v;
  }

  function setSlot(id, val) {
    if (!id) return;
    if (val) { slots[id] = val; tombstones.delete(id); }
    else { delete slots[id]; if (!loaded) tombstones.add(id); }
    subs.forEach((fn) => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save(); else load().then(save);
  }

  // ── Image downscale ─────────────────────────────────────────────────────
  // Encode through a canvas so the sidecar carries resized bytes, not the raw
  // upload. The scale is driven by the slot's rendered WIDTH (retina = 2×); only
  // the LONGEST side is bounded, by MAX_DIM. Driving off width — not the longest
  // side, as this once did — is what keeps a TALL document legible: a long email
  // scan or screenshot is sized so its width is retina-sharp and its height is
  // free to run to MAX_DIM, instead of the whole image being crushed into a
  // width-sized box (which turned dense text to mush). Never upscales past the
  // original. WebP keeps alpha and is ~10× smaller than PNG, so there's no need
  // for per-image format picking.
  function scaledCanvas(bitmap, targetW) {
    const wantW = Math.max(1, Math.round(targetW * 2)) || MAX_DIM;   // retina the width
    let scale = wantW / bitmap.width;
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest * scale > MAX_DIM) scale = MAX_DIM / longest;        // but cap the long side
    scale = Math.min(1, scale);                                      // never upscale
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return canvas;
  }

  async function toDataUrl(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try { return scaledCanvas(bitmap, targetW).toDataURL('image/webp', WEBP_Q); }
    finally { bitmap.close && bitmap.close(); }
  }

  // Same downscale as toDataUrl, but yields a Blob for upload to a media store —
  // smaller than a data URL, and the bytes go straight onto the wire.
  async function toBlob(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = scaledCanvas(bitmap, targetW);
      return await new Promise((res, rej) =>
        canvas.toBlob((b) => b ? res(b) : rej(new Error('encode failed')), 'image/webp', WEBP_Q));
    } finally { bitmap.close && bitmap.close(); }
  }

  // A pre-encoded blob (e.g. from the photo editor) → data URL, for the no-media
  // fallback where the slot can only persist a data:image/ string in its sidecar.
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('read failed'));
      fr.readAsDataURL(blob);
    });
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet =
    ':host{display:inline-block;position:relative;vertical-align:top;' +
    '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55);width:240px;height:160px}' +
    '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(0,0,0,.04)}' +
    // .frame img (clipped) and .spill (unclipped ghost + handles) share the
    // same left/top/width/height in frame-%, computed by _applyView(), so the
    // inside-mask crop and the outside-mask spill stay pixel-aligned.
    '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' +
    '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
    // Reframe mode (double-click): the full image spills past the mask. The
    // spill layer is sized to the IMAGE bounds so its corners are where the
    // resize handles belong. The ghost <img> inside is translucent; the real
    // clipped <img> underneath shows the opaque in-mask crop.
    '.spill{position:absolute;transform:translate(-50%,-50%);display:none;z-index:1;' +
    '  cursor:grab;touch-action:none}' +
    ':host([data-panning]) .spill{cursor:grabbing}' +
    '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' +
    '  pointer-events:none;-webkit-user-drag:none;user-select:none;' +
    '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' +
    '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' +
    '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' +
    '  transform:translate(-50%,-50%)}' +
    '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' +
    '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' +
    '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' +
    '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' +
    ':host([data-reframe]){z-index:10}' +
    ':host([data-reframe]) .spill{display:block}' +
    ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  cursor:pointer;user-select:none}' +
    '.empty svg{opacity:.45}' +
    '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' +
    '.empty .sub{font-size:11px}' +
    '.empty .sub u{text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.25)}' +
    '.empty:hover .sub u{color:rgba(0,0,0,.75);text-decoration-color:currentColor}' +
    ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' +
    '  background:rgba(201,100,66,.10)}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25);' +
    '  transition:border-color .12s}' +
    ':host([data-over]) .ring{border-color:#c96442}' +
    ':host([data-filled]) .ring{display:none}' +
    // Controls sit BELOW the mask (top:100%), absolutely positioned so the
    // author-declared slot height is unaffected. The gap is padding, not a
    // top offset, so the hover target stays contiguous with the frame.
    '.ctl{position:absolute;top:100%;left:50%;transform:translateX(-50%);padding-top:8px;' +
    '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' +
    '  white-space:nowrap}' +
    ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' +
    '  {opacity:1;pointer-events:auto}' +
    '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' +
    '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' +
    '  backdrop-filter:blur(6px)}' +
    '.ctl button:hover{background:rgba(0,0,0,.8)}' +
    // The Fit toggle (Cover / Contain / Fill) is opt-in: hosts that want it on a
    // slot add the `fitcontrol` attribute (the NPJ banner + article images do).
    // Plain deck slots never show it, so their behaviour is unchanged.
    '.ctl .fitbtn{display:none}' +
    ':host([fitcontrol][data-filled]) .ctl .fitbtn{display:inline-block}' +
    // The Edit (crop + redact) button only appears when the photo editor is loaded
    // and the slot is filled — it opens app/photo-editor.js to bake a cropped /
    // hard-redacted copy and re-upload it.
    '.ctl .editbtn{display:none}' +
    ':host([data-pe][data-filled]) .ctl .editbtn{display:inline-block}' +
    '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' +
    '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}';

  const icon =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="m21 15-5-5L5 21"/></svg>';

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'position', 'placeholder', 'src', 'id', 'fitcontrol', 'conform'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML =
        '<style>' + stylesheet + '</style>' +
        // Holds the dynamic `conform` rule (a :host aspect-ratio sized to the
        // filled image). Kept in the shadow DOM — never an inline style on the
        // host — so the light-DOM HTML the newsroom persists stays pristine.
        '<style class="conform"></style>' +
        '<div class="frame" part="frame">' +
        '  <img part="image" alt="" draggable="false" style="display:none">' +
        '  <div class="empty" part="empty">' + icon +
        '    <div class="cap"></div>' +
        '    <div class="sub">or <u>browse files</u><span class="cdn"> · <u data-act="cdn">use an archive.org link</u></span></div></div>' +
        '  <div class="ring" part="ring"></div>' +
        '</div>' +
        '<div class="spill">' +
        '  <img class="ghost" alt="" draggable="false">' +
        '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' +
        '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' +
        '</div>' +
        '<div class="ctl">' +
        '  <button class="fitbtn" data-act="fit" title="How the image fills the frame — Cover (crop to fill), Contain (fit whole image), or Fill (stretch)">Cover</button>' +
        '  <button class="editbtn" data-act="edit" title="Crop &amp; redact — burned into the photo before it\'s archived">Edit</button>' +
        '  <button data-act="replace" title="Replace image">Replace</button>' +
        '  <button data-act="clear" title="Remove image">Remove</button></div>' +
        '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._ghost = root.querySelector('.ghost');
      this._fitbtn = root.querySelector('.fitbtn');
      this._conformSheet = root.querySelector('style.conform');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      this._triedAuth = null;
      this._triedAlt = null;
      this._fbDone = false;
      this._loadFailed = null;   // the src that exhausted every fallback (so _render shows the affordance, not a dead box)
      this._view = { s: 1, x: 0, y: 0 };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'cdn') {
          const u = window.prompt('archive.org link — details page, download link, or wayback capture:');
          if (u) this._ingestUrl(u);
          return;
        }
        this._input.click();
      });
      root.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'fit') {
          // Cycle the fill mode and persist it. cover ↔ contain ↔ fill — cover
          // is the only one that supports the double-click reframe (crop), so
          // leaving cover drops out of any in-progress reframe first.
          const order = ['cover', 'contain', 'fill'];
          const cur = (this.getAttribute('fit') || 'cover').toLowerCase();
          const next = order[(order.indexOf(cur) + 1) % order.length] || 'cover';
          this._exitReframe(false);
          this.setAttribute('fit', next); // attributeChangedCallback re-renders + re-applies
          this._persistFraming();
          return;
        }
        if (act === 'edit') { this._editPhoto(); }
        if (act === 'replace') { this._exitReframe(true); this._input.click(); }
        if (act === 'clear') {
          this._exitReframe(false);
          this._gen++;
          this._local = null;
          this._dropCdnSrc();
          if (this.id) setSlot(this.id, null); else this._render();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline (and the `conform` box ratio) are computed from real
      // dimensions, not the 100%×100% fallback.
      this._img.addEventListener('load', () => { this._loadFailed = null; this._applyView(); this._applyConform(); });
      // Load resilience: try the primary src; on error fall back to the
      // `data-alt` URL (e.g. the archive.org copy behind a media-store src),
      // then to a token-fetched blob: URL for an auth-gated homeserver.
      this._img.addEventListener('error', () => {
        if (this._fbDone) return;
        const cur = this._img.getAttribute('src') || '';
        const alt = this.getAttribute('data-alt');
        const media = window.NpjMedia;
        if (alt && alt !== cur && this._triedAlt !== alt) {
          this._triedAlt = alt;
          this._img.src = alt; this._ghost.src = alt; return;
        }
        if (media && media.isStoreUrl && media.isStoreUrl(cur) && this._triedAuth !== cur) {
          this._triedAuth = cur;
          media.resolveDisplay(cur).then((u) => { if (u && u !== cur) { this._img.src = u; this._ghost.src = u; } }).catch(() => {});
          return;
        }
        this._fbDone = true;
        // Every source failed. Never leave a silent, blank, un-fixable box: drop
        // back to the placeholder affordance so the author can drop a new image
        // (or paste an archive.org link), and say why. The `src` ATTRIBUTE stays
        // in the light DOM, so the slot still persists and self-heals if the URL
        // becomes reachable on a later load (a fresh element retries from zero).
        // Editable slots only — a read-only/published view keeps its prior look.
        if (cur && this._loadFailed !== cur && this.hasAttribute('data-editable')) {
          this._loadFailed = cur;
          this._render();
          this._setError("That image couldn't be loaded — drop a new one or paste an archive.org link.");
        }
      });
      // Gated on editable + fit=cover so share links and contain/fill slots
      // stay static.
      this.addEventListener('dblclick', (e) => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);
        else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1, fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1, ih = this._img.naturalHeight || 1;
          const base = Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0, h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2, oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0, uy = sy * h0 / diag0;
          move = (ev) => {
            const proj = (ev.clientX - rect.left - ox) * ux +
                         (ev.clientY - rect.top - oy) * uy;
            const s = clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = { px: e.clientX, py: e.clientY, x: this._view.x, y: this._view.y };
          move = (ev) => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try { this._spill.releasePointerCapture(e.pointerId); } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', (e) => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, { passive: false });
    }

    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      subs.add(this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      this._ro = new ResizeObserver(() => this._render());
      this._ro.observe(this);
      load();
      this._render();
    }

    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      this._exitReframe(false);
    }

    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = (e) => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = (e) => { if (e.key === 'Escape') this._exitReframe(true); };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }

    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (commit) this._commitView();
    }

    attributeChangedCallback() { if (this.shadowRoot) this._render(); }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) { this._depth = 0; this.removeAttribute('data-over'); }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const dt = e.dataTransfer;
        const f = dt && dt.files && dt.files[0];
        if (f) { this._ingest(f); return; }
        // no file → maybe a link dragged from another tab (uri-list first;
        // its comment lines start with '#')
        const t = dt && (dt.getData('text/uri-list') || dt.getData('text/plain'));
        const url = String(t || '').split(/[\r\n]+/).find((s) => s && s[0] !== '#');
        if (url) this._ingestUrl(url);
      }
    }

    // Public API for hosts (the newsroom feeds pasted images/links in
    // programmatically): the current effective image URL, and the two
    // ingestion paths.
    get url() {
      return this._userUrl || this.getAttribute('src') || null;
    }
    ingestFile(file) { return this._ingest(file); }
    ingestUrl(url) { return this._ingestUrl(url); }

    // Point the slot at a durable remote URL (an archive.org link or a media
    // store upload): it rides the `src` ATTRIBUTE — light DOM, so hosts that
    // persist innerHTML (drafts, publish) carry it — never the sidecar. data-cdn
    // marks it slot-set so Remove can tell it apart from an author-written src;
    // 'image-slot-change' lets the host save the HTML.
    _setRemoteSrc(url) {
      this._exitReframe(false);
      this._local = null;
      if (this.id) setSlot(this.id, null); // the sidecar copy (if any) yields to the remote src
      this.setAttribute('data-cdn', '');
      // a freshly-set src has no archive fallback yet (publish/save mints it)
      this.removeAttribute('data-alt');
      this._triedAlt = this._triedAuth = null; this._fbDone = false;
      this.setAttribute('src', url); // attributeChangedCallback re-renders
      this._announce(url);
    }

    // An archive.org link drop/paste resolves to a direct image URL, then rides
    // `src` via _setRemoteSrc.
    async _ingestUrl(raw) {
      const cdn = window.NpjArchiveCDN;
      if (!cdn) return;
      this._setError(null);
      if (!cdn.isMediaUrl(raw)) {
        this._setError('Link images from archive.org — a details page, download link, or wayback capture.');
        return;
      }
      const gen = ++this._gen;
      this._cap.textContent = 'Loading from archive.org…';
      try {
        const url = await cdn.resolve(raw);
        if (gen !== this._gen) return;
        this._setRemoteSrc(url);
      } catch (err) {
        if (gen !== this._gen) return;
        this._render(); // restore the placeholder caption
        this._setError((err && err.message) || 'Could not load that archive.org link.');
      }
    }

    _dropCdnSrc() {
      if (!this.hasAttribute('data-cdn')) return;
      this.removeAttribute('data-cdn');
      this.removeAttribute('src');
      this.removeAttribute('data-alt');
      this._announce(null);
    }

    _announce(src) {
      this.dispatchEvent(new CustomEvent('image-slot-change', {
        bubbles: true, composed: true, detail: {
          id: this.id || null, src: src || null,
          fit: (this.getAttribute('fit') || 'cover').toLowerCase(),
          crop: this.getAttribute('data-crop') || null,
        }
      }));
    }

    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // Encoding/upload can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale work bails.
      const gen = ++this._gen;
      const media = window.NpjMedia;
      // Preferred path: upload to the media store and ride the durable https URL
      // in `src` (same as an archive.org link) so it persists in drafts and gets
      // moved onto archive.org at publish — never base64 bytes in the commit.
      if (media && media.canUpload && media.canUpload()) {
        const prevCap = this._cap.textContent;
        this._cap.textContent = 'Uploading…';
        try {
          const w = this.clientWidth || this.offsetWidth || MAX_DIM;
          const blob = await toBlob(file, w);
          if (gen !== this._gen) return;
          const base = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
          const up = await media.upload(blob, base + '.webp');
          if (gen !== this._gen) return;
          this._setRemoteSrc(up.url);
        } catch (err) {
          if (gen !== this._gen) return;
          this._cap.textContent = prevCap;
          this._render();
          this._setError((err && err.message) || 'Upload failed.');
          console.warn('<image-slot> upload failed:', err);
        }
        return;
      }
      // Fallback (no signed-in media store — e.g. a logged-out standalone embed):
      // a session-only data-URL preview. It shows, but it does not publish.
      try {
        const w = this.clientWidth || this.offsetWidth || MAX_DIM;
        const url = await toDataUrl(file, w);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        // a slot-set durable src would otherwise keep publishing the OLD
        // image underneath this local replacement — retire it
        this._dropCdnSrc();
        const val = { u: url, s: 1, x: 0, y: 0 };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) { this._local = val; this._render(); }
        // a local fill changes no attribute, so tell hosts (media rails,
        // autosave) that this slot's content moved
        this._announce(null);
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }

    // ── Edit (crop + hard redact) ───────────────────────────────────────────
    // Open app/photo-editor.js on the slot's CURRENT image, get back a flattened
    // copy (crop + redactions baked into the pixels), and re-upload it the same way
    // a fresh drop is uploaded. Because the edited bytes replace the slot's src,
    // publish's freeze can only ever move the redacted copy onto archive.org — the
    // un-redacted original never reaches the public record.
    async _editPhoto() {
      if (!window.NpjPhotoEditor) return;
      this._exitReframe(false);
      const url = this._userUrl || this.getAttribute('src');
      if (!url) return;
      const media = window.NpjMedia;
      // Prefer raw bytes via the media store (works on auth-gated homeservers and
      // keeps the canvas untainted); otherwise let the editor load the URL itself.
      const getBytes = () => {
        if (media && media.fetchBytes && media.isStoreUrl && media.isStoreUrl(url)) return media.fetchBytes(url);
        return fetch(url).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
      };
      let blob = null;
      try { blob = await window.NpjPhotoEditor.open({ src: url, getBytes, alt: this.getAttribute('data-alt') }); }
      catch (e) { this._setError((e && e.message) || 'Could not open the photo editor.'); return; }
      if (!blob) return; // cancelled
      await this._ingestEditedBlob(blob);
    }

    async _ingestEditedBlob(blob) {
      this._setError(null);
      const gen = ++this._gen;
      const media = window.NpjMedia;
      // The crop/redaction is now in the bytes — any prior cover-crop framing is
      // relative to the OLD image, so drop it and re-center on the new one.
      this.removeAttribute('data-crop');
      this._view = { s: 1, x: 0, y: 0 };
      if (media && media.canUpload && media.canUpload()) {
        const prevCap = this._cap.textContent;
        this._cap.textContent = 'Uploading…';
        try {
          const up = await media.upload(blob, 'edited-' + Date.now().toString(36) + '.webp');
          if (gen !== this._gen) return;
          this._setRemoteSrc(up.url); // announces with the cleared crop, so the host saves it
        } catch (err) {
          if (gen !== this._gen) return;
          this._cap.textContent = prevCap;
          this._render();
          this._setError((err && err.message) || 'Upload of the edited image failed.');
        }
        return;
      }
      // No media store (logged-out embed): a session-only data-URL preview.
      try {
        const url = await blobToDataUrl(blob);
        if (gen !== this._gen) return;
        this._dropCdnSrc();
        const val = { u: url, s: 1, x: 0, y: 0 };
        setSlot(this.id || '', val);
        if (!this.id) { this._local = val; this._render(); }
        this._announce(null);
      } catch (e) {
        if (gen !== this._gen) return;
        this._setError('Could not save the edited image.');
      }
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err'; d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => { if (this._err === d) { d.remove(); this._err = null; } }, 3000);
    }

    // Reframing (pan/resize) is only meaningful for fit=cover — contain/fill
    // keep the old object-fit path and double-click is a no-op.
    _reframes() {
      return this.hasAttribute('data-filled') &&
        (this.getAttribute('fit') || 'cover') === 'cover';
    }

    // Cover-baseline geometry, shared by clamp/apply/resize. Null until the
    // img has loaded (naturalWidth is 0 before that) or when the slot has no
    // layout box — ResizeObserver fires with a 0×0 rect under display:none,
    // and clamping against a degenerate 1×1 frame would silently pull the
    // stored pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth, ih = this._img.naturalHeight;
      const fw = this.clientWidth, fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      return { iw, ih, fw, fh, base: Math.max(fw / iw, fh / ih) };
    }

    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      const mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      const my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }

    _applyView() {
      const g = this._geom();
      const fit = this.getAttribute('fit') || 'cover';
      if (fit !== 'cover' || !g) {
        // Non-cover, or dimensions not known yet (before img load).
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = fit;
        this._img.style.objectPosition = this.getAttribute('position') || '50% 50%';
        return;
      }
      // Cover baseline: img fills the frame on its tighter axis at s=1, so
      // pan works immediately on the overflowing axis without zooming first.
      // Width/height and left/top are all frame-% — depends only on the
      // frame aspect ratio, so a responsive resize keeps the same crop. The
      // spill layer mirrors the same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = (g.iw * k / g.fw * 100) + '%';
      const h = (g.ih * k / g.fh * 100) + '%';
      const l = (50 + this._view.x) + '%';
      const t = (50 + this._view.y) + '%';
      this._img.style.width = w; this._img.style.height = h;
      this._img.style.left = l; this._img.style.top = t;
      this._img.style.objectFit = '';
      this._spill.style.width = w; this._spill.style.height = h;
      this._spill.style.left = l; this._spill.style.top = t;
    }

    // `conform` slots take the IMAGE's shape: once filled, the box's height is
    // driven by an aspect ratio (the saved crop's, else the image's natural
    // ratio) so the editor shows the whole image — what the reader publishes —
    // instead of the fixed author-declared letterbox. Written as a shadow :host
    // rule with !important (which outranks the host's non-important inline
    // height) rather than mutating the host's inline style, so the light-DOM
    // HTML the newsroom persists as a draft is never rewritten. An empty slot
    // (no aspect known) falls back to the declared height as the drop target.
    _applyConform() {
      if (!this._conformSheet) return;
      let ar = 0;
      if (this.hasAttribute('conform') && this.hasAttribute('data-filled')) {
        const crop = this._parseCrop(this.getAttribute('data-crop'));
        if (crop && crop.ar) ar = crop.ar;
        else {
          const iw = this._img.naturalWidth, ih = this._img.naturalHeight;
          if (iw && ih) ar = iw / ih;
        }
      }
      this._conformSheet.textContent = ar
        ? ':host{height:auto!important;aspect-ratio:' + (Math.round(ar * 10000) / 10000) + '!important}'
        : '';
    }

    _commitView() {
      const v = { s: this._view.s, x: this._view.x, y: this._view.y };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);
      else { this._local = v; }
      // Article/banner slots (fitcontrol) also write the crop into a light-DOM
      // attribute so it rides the host's saved HTML — there's no sidecar at
      // publish time, so this is how a crop survives into a committed article.
      if (this.hasAttribute('fitcontrol')) this._persistFraming();
    }

    // crop "s,x,y,ar" → {s,x,y,ar}; the frame aspect (ar) is stored so the
    // front-end reader can reproduce the exact cover crop at any display width.
    _parseCrop(str) {
      if (!str) return null;
      const p = String(str).split(',').map(Number);
      if (!p.length || !Number.isFinite(p[0])) return null;
      return {
        s: p[0],
        x: Number.isFinite(p[1]) ? p[1] : 0,
        y: Number.isFinite(p[2]) ? p[2] : 0,
        ar: Number.isFinite(p[3]) ? p[3] : 0,
      };
    }

    // Write the current fill mode + crop into the light DOM and tell the host
    // to save. The `fit` attribute already lives in the light DOM; data-crop
    // carries the cover pan/zoom plus the frame aspect ratio.
    _persistFraming() {
      const fw = this.clientWidth, fh = this.clientHeight;
      const ar = (fw > 0 && fh > 0) ? fw / fh : 0;
      const v = this._view || { s: 1, x: 0, y: 0 };
      const r3 = (n) => Math.round(n * 1000) / 1000;
      const parts = [r3(v.s || 1), r3(v.x || 0), r3(v.y || 0)];
      if (ar) parts.push(r3(ar));
      this.setAttribute('data-crop', parts.join(','));
      // a cropped cover now has its own aspect — reflect it in a conform box
      this._applyConform();
      this._announce(this.getAttribute('src') || this._userUrl || null);
    }

    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';
      else if (shape === 'pill') radius = '9999px';
      else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      // The archive-CDN runtime (NPJ newsroom) counts as editable too: there a
      // slot persists through the host document's HTML, not the sidecar.
      const cdn = window.NpjArchiveCDN;
      const media = window.NpjMedia;
      const editable = !!(window.omelette && window.omelette.writeFile) || !!cdn ||
        !!(media && media.canUpload && media.canUpload());
      this.toggleAttribute('data-editable', editable);
      // Show the Edit (crop + redact) button only when the photo editor module is
      // present. It's gated separately from `editable` because editing produces a
      // re-upload, which the same media-store/omelette paths handle.
      this.toggleAttribute('data-pe', !!window.NpjPhotoEditor);
      this._sub.style.display = editable ? '' : 'none';
      const cdnLink = this._sub.querySelector('.cdn');
      if (cdnLink) cdnLink.style.display = cdn ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs (or allowlisted archive.org URLs) from it. The `src`
      // attribute is author-controlled (it was written into the HTML) so it
      // passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u) &&
          !(cdn && cdn.isMediaUrl(stored.u)) &&
          !(media && media.isStoreUrl && media.isStoreUrl(stored.u))) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      this._userUrl = (stored && stored.u) || null;
      const url = this._userUrl || srcAttr;
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        // Seed from the sidecar if present; otherwise fall back to a crop
        // persisted in the light DOM (data-crop) — that's how a published or
        // host-saved slot reproduces its crop without a sidecar.
        const fv = stored || this._parseCrop(this.getAttribute('data-crop'));
        this._view = {
          s: fv && Number.isFinite(fv.s) ? clampS(fv.s) : 1,
          x: fv && Number.isFinite(fv.x) ? fv.x : 0,
          y: fv && Number.isFinite(fv.y) ? fv.y : 0,
        };
      }
      // Label the Fit toggle with the current mode.
      if (this._fitbtn) {
        const f = (this.getAttribute('fit') || 'cover').toLowerCase();
        this._fitbtn.textContent = f.charAt(0).toUpperCase() + f.slice(1);
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // A url that already exhausted every load fallback is NOT shown as filled —
      // it would just be a blank box. Treat it as empty so the placeholder
      // affordance returns; the src attribute is untouched, so a fresh element
      // (reload) retries it from scratch.
      const showable = url && this._loadFailed !== url;
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      if (showable) {
        if (this._img.getAttribute('src') !== url) {
          this._triedAlt = this._triedAuth = null; this._fbDone = false;
          this._img.src = url;
          this._ghost.src = url;
        }
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._ghost.removeAttribute('src');
        this._empty.style.display = 'flex';
        this.removeAttribute('data-filled');
      }
      this._applyConform();
    }
  }

  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();
