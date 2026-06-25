// @ds-adherence-ignore -- standalone canvas editor (raw elements/hex/px by design)
/* photo-editor.js — crop + HARD-redact a photo before it's archived.
 *
 * The same discipline as CiteyRedact (app/CiteyRedact.jsx) does for text, but for
 * pixels. On the way to archive.org — permanent, public, undeletable — a photo can
 * carry a face, a licence plate, a screen, an address. This editor lets the author
 * cut the photo down (crop) and paint hard black over anything that shouldn't be
 * public (redact), and then BAKES both into a brand-new image.
 *
 * The guarantee the rest of the app leans on: a redaction here is destructive. The
 * blacked-out pixels are gone from the bytes this returns — not a CSS overlay, not
 * metadata applied at render time. <image-slot> uploads THESE bytes to the media
 * store, so when publish freezes the slot onto archive.org it can only ever copy
 * the redacted copy. The un-redacted original never reaches the public record.
 *
 *   window.NpjPhotoEditor.open({ src, getBytes, alt }) → Promise<Blob|null>
 *     src       the image URL currently in the slot (for a plain/CORS load)
 *     getBytes  optional () => Promise<Blob|null>; the preferred path — raw bytes
 *               (e.g. an authenticated media-store fetch) give an UNTAINTED canvas
 *               so toBlob() can read it back. <image-slot> passes one.
 *     alt       optional fallback URL (e.g. an archive.org copy) if src won't load.
 *   Resolves to a WebP Blob (the edited image) on Save, or null on Cancel.
 *
 * No build step, no deps — plain canvas, same as the rest of npj. The geometry
 * (planBake) is pure and exported for the node test; only bake()/open() touch the
 * DOM, so this file is require()-able in CI without jsdom.
 */
(function () {
  'use strict';

  // Longest side of the saved image. A crop can only shrink the source, but a big
  // source cropped loosely could still be large — cap it so the archived WebP stays
  // light (same spirit as image-slot's MAX_DIM, a touch larger for full frames).
  const MAX_DIM = 1600;
  // Ignore an accidental click-without-drag (natural px).
  const MIN_NAT = 6;
  const WEBP_Q = 0.85;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ── Pure geometry: the spec of what bake() draws ─────────────────────────────
  // Crop + redactions arrive in NATURAL image pixels. This returns the output
  // canvas size (crop, downscaled to MAX_DIM) and each redaction mapped into that
  // output space. Keeping it pure means the "redaction lands on the right pixels"
  // invariant is unit-testable without a canvas.
  function cropToNatural(crop, iw, ih) {
    const x = clamp(crop.x, 0, iw);
    const y = clamp(crop.y, 0, ih);
    return { x, y, w: clamp(crop.w, 0, iw - x), h: clamp(crop.h, 0, ih - y) };
  }
  function outputSize(cropN, maxDim) {
    const longest = Math.max(cropN.w, cropN.h) || 1;
    const scale = longest > maxDim ? maxDim / longest : 1;
    return { w: Math.max(1, Math.round(cropN.w * scale)), h: Math.max(1, Math.round(cropN.h * scale)), scale };
  }
  function planBake(o) {
    const cropN = cropToNatural(o.crop, o.iw, o.ih);
    const out = outputSize(cropN, o.maxDim || MAX_DIM);
    // A redaction box is translated so the crop's top-left becomes (0,0), then
    // scaled by the same factor as the crop. fillRect clips anything past the
    // canvas edge, so boxes that overhang the crop are handled for free.
    const redactsOut = (o.redacts || []).map((r) => ({
      x: (r.x - cropN.x) * out.scale,
      y: (r.y - cropN.y) * out.scale,
      w: r.w * out.scale,
      h: r.h * out.scale,
    }));
    return { cropN, out, redactsOut };
  }

  // ── The burn: source image + crop + redactions → WebP Blob ───────────────────
  async function bake(img, o) {
    const plan = planBake({ iw: o.iw, ih: o.ih, crop: o.crop, redacts: o.redacts, maxDim: o.maxDim });
    const canvas = document.createElement('canvas');
    canvas.width = plan.out.w;
    canvas.height = plan.out.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, plan.cropN.x, plan.cropN.y, plan.cropN.w, plan.cropN.h, 0, 0, plan.out.w, plan.out.h);
    // Hard black — not a blur or pixelation (those can be partially reversed). The
    // █ block of a text redaction, for pixels.
    ctx.fillStyle = '#000';
    plan.redactsOut.forEach((r) => ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)));
    // toBlob throws SecurityError on a tainted canvas (a cross-origin image with no
    // CORS grant); surface that plainly so the caller can tell the author why.
    return await new Promise((res, rej) => {
      try {
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the edited image.'))), 'image/webp', WEBP_Q);
      } catch (e) {
        rej(new Error("Can't edit this image here — it's served without cross-origin permission. Re-drop the original photo, then edit it before publishing."));
      }
    });
  }

  // ── DOM-only below (guarded so the file require()s clean in node) ─────────────
  function decodeImg(src, crossOrigin) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('decode failed'));
      img.src = src;
    });
  }

  async function loadImage(opts) {
    // Preferred: raw bytes → an object URL is same-origin, so the canvas stays
    // untainted and toBlob() works. <image-slot> hands us an authenticated fetch.
    if (opts.getBytes) {
      try {
        const blob = await opts.getBytes();
        if (blob) {
          const u = URL.createObjectURL(blob);
          try { const img = await decodeImg(u, null); return { img, cleanup: () => URL.revokeObjectURL(u) }; }
          catch (e) { URL.revokeObjectURL(u); }
        }
      } catch (e) { /* fall through to a URL load */ }
    }
    // Fallback: load the URL (or its alt) directly. crossOrigin=anonymous first so
    // a CORS-friendly host (archive.org usually) yields a clean canvas; then a
    // plain load so at least the author can SEE it to crop, even if save can't read
    // it back (bake() will explain).
    const urls = [opts.src, opts.alt].filter(Boolean);
    for (const u of urls) {
      for (const co of ['anonymous', null]) {
        try { const img = await decodeImg(u, co); return { img, cleanup: () => {} }; }
        catch (e) { /* try next */ }
      }
    }
    throw new Error('Could not load this image to edit.');
  }

  const CSS = `
.npj-pe-back{position:fixed;inset:0;z-index:6000;background:rgba(8,7,5,.78);display:flex;
  align-items:center;justify-content:center;padding:18px;animation:npjpeIn .12s ease-out}
@keyframes npjpeIn{from{opacity:0}to{opacity:1}}
.npj-pe{display:flex;flex-direction:column;max-width:min(96vw,1180px);max-height:94vh;
  background:#17150f;color:#f3efe3;border:2px solid #000;box-shadow:0 24px 60px rgba(0,0,0,.55);
  font:13px/1.4 system-ui,-apple-system,sans-serif}
.npj-pe-hd{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid #332f24}
.npj-pe-hd .t{font-weight:700;font-size:16px;letter-spacing:.01em}
.npj-pe-hd .s{font-size:11.5px;color:#b9b29c;margin-top:2px;max-width:62ch;line-height:1.45}
.npj-pe-hd .x{margin-left:auto;background:none;border:0;color:#f3efe3;font-size:18px;cursor:pointer;line-height:1;padding:2px 4px}
.npj-pe-tools{display:flex;align-items:center;gap:8px;padding:9px 16px;border-bottom:1px solid #332f24;flex-wrap:wrap}
.npj-pe-tab{appearance:none;border:1px solid #4a4435;background:#221f17;color:#e9e4d4;
  border-radius:7px;padding:6px 12px;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.npj-pe-tab.on{background:#c96442;border-color:#c96442;color:#fff}
.npj-pe-tools .gap{flex:1}
.npj-pe-tools .hint{font-size:11px;color:#9b937c}
.npj-pe-tools .dim{font:11px/1 ui-monospace,Menlo,monospace;color:#b9b29c}
.npj-pe-ghost{appearance:none;border:1px solid #4a4435;background:transparent;color:#cfc9b6;
  border-radius:7px;padding:6px 11px;font-size:12px;cursor:pointer}
.npj-pe-ghost:hover{border-color:#7a7059;color:#f3efe3}
.npj-pe-stage{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;
  padding:16px;background:repeating-conic-gradient(#1d1a13 0% 25%,#161309 0% 50%) 50%/22px 22px}
.npj-pe-canvas{position:relative;line-height:0;touch-action:none;user-select:none;overflow:hidden;flex:0 0 auto}
.npj-pe-canvas img{display:block;width:100%;height:100%;-webkit-user-drag:none;user-select:none;max-width:none}
.npj-pe-crop{position:absolute;box-sizing:border-box;border:1.5px solid #fff;
  box-shadow:0 0 0 9999px rgba(0,0,0,.55);cursor:move}
.npj-pe-canvas.mode-redact .npj-pe-crop{pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,.32)}
.npj-pe-crop .h{position:absolute;width:12px;height:12px;background:#fff;border:1.5px solid #c96442;
  border-radius:50%;transform:translate(-50%,-50%)}
.npj-pe-canvas.mode-redact .npj-pe-crop .h{display:none}
.npj-pe-crop .h[data-h=nw]{left:0;top:0;cursor:nwse-resize}.npj-pe-crop .h[data-h=n]{left:50%;top:0;cursor:ns-resize}
.npj-pe-crop .h[data-h=ne]{left:100%;top:0;cursor:nesw-resize}.npj-pe-crop .h[data-h=e]{left:100%;top:50%;cursor:ew-resize}
.npj-pe-crop .h[data-h=se]{left:100%;top:100%;cursor:nwse-resize}.npj-pe-crop .h[data-h=s]{left:50%;top:100%;cursor:ns-resize}
.npj-pe-crop .h[data-h=sw]{left:0;top:100%;cursor:nesw-resize}.npj-pe-crop .h[data-h=w]{left:0;top:50%;cursor:ew-resize}
.npj-pe-redact{position:absolute;box-sizing:border-box;background:#000;outline:1px solid rgba(255,255,255,.55);cursor:move}
.npj-pe-canvas.mode-crop .npj-pe-redact{pointer-events:none;outline-color:rgba(255,255,255,.3)}
.npj-pe-redact.sel{outline:2px solid #c96442}
.npj-pe-redact .h{position:absolute;width:11px;height:11px;background:#fff;border:1.5px solid #c96442;
  border-radius:2px;transform:translate(-50%,-50%)}
.npj-pe-canvas.mode-crop .npj-pe-redact .h{display:none}
.npj-pe-redact .h[data-h=nw]{left:0;top:0;cursor:nwse-resize}.npj-pe-redact .h[data-h=ne]{left:100%;top:0;cursor:nesw-resize}
.npj-pe-redact .h[data-h=sw]{left:0;top:100%;cursor:nesw-resize}.npj-pe-redact .h[data-h=se]{left:100%;top:100%;cursor:nwse-resize}
.npj-pe-redact .rm{position:absolute;top:-10px;right:-10px;width:20px;height:20px;border-radius:50%;
  border:0;background:#c96442;color:#fff;font-size:13px;line-height:20px;cursor:pointer;padding:0}
.npj-pe-canvas.mode-crop .npj-pe-redact .rm{display:none}
.npj-pe-ft{display:flex;align-items:center;gap:10px;padding:11px 16px;border-top:1px solid #332f24}
.npj-pe-ft .st{font-size:11px;color:#9b937c;flex:1;min-width:0}
.npj-pe-btn{appearance:none;border:1px solid #4a4435;background:#221f17;color:#e9e4d4;
  border-radius:7px;padding:8px 15px;font-size:13px;cursor:pointer}
.npj-pe-btn.primary{background:#c96442;border-color:#c96442;color:#fff;font-weight:600}
.npj-pe-btn:disabled{opacity:.5;cursor:not-allowed}`;

  function ensureCss() {
    if (document.getElementById('npj-pe-css')) return;
    const s = document.createElement('style');
    s.id = 'npj-pe-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const HANDLES8 = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const HANDLES4 = ['nw', 'ne', 'sw', 'se'];

  // Resize `start` (natural px) by a natural-px delta on the edges named in `hid`,
  // normalizing flips, honouring a min size, and clamping inside `b` (the image).
  function resized(start, hid, dx, dy, b, min) {
    let x = start.x, y = start.y, w = start.w, h = start.h;
    if (hid.indexOf('w') >= 0) { x = start.x + dx; w = start.w - dx; }
    if (hid.indexOf('e') >= 0) { w = start.w + dx; }
    if (hid.indexOf('n') >= 0) { y = start.y + dy; h = start.h - dy; }
    if (hid.indexOf('s') >= 0) { h = start.h + dy; }
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (w < min) w = min;
    if (h < min) h = min;
    x = clamp(x, b.x, b.x + b.w - min);
    y = clamp(y, b.y, b.y + b.h - min);
    if (x + w > b.x + b.w) w = b.x + b.w - x;
    if (y + h > b.y + b.h) h = b.y + b.h - y;
    return { x, y, w, h };
  }
  function moved(start, dx, dy, b) {
    return {
      x: clamp(start.x + dx, b.x, b.x + b.w - start.w),
      y: clamp(start.y + dy, b.y, b.y + b.h - start.h),
      w: start.w, h: start.h,
    };
  }

  function open(opts) {
    ensureCss();
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'npj-pe-back';
      back.innerHTML =
        '<div class="npj-pe" role="dialog" aria-modal="true" aria-label="Edit photo">' +
        '  <div class="npj-pe-hd"><div><div class="t">Edit photo</div>' +
        '    <div class="s">Crop the frame and paint over anything that shouldn\'t be public. ' +
        'Redactions are burned into the photo before it\'s uploaded — once published they can\'t be undone.</div></div>' +
        '    <button class="x" title="Cancel" data-act="cancel">✕</button></div>' +
        '  <div class="npj-pe-tools">' +
        '    <button class="npj-pe-tab on" data-mode="crop">❐ Crop</button>' +
        '    <button class="npj-pe-tab" data-mode="redact">▮ Redact</button>' +
        '    <button class="npj-pe-ghost" data-act="reset">Reset</button>' +
        '    <span class="gap"></span><span class="hint"></span><span class="dim"></span></div>' +
        '  <div class="npj-pe-stage"><div class="npj-pe-canvas mode-crop"></div></div>' +
        '  <div class="npj-pe-ft"><span class="st"></span>' +
        '    <button class="npj-pe-btn" data-act="cancel">Cancel</button>' +
        '    <button class="npj-pe-btn primary" data-act="save" disabled>Save &amp; replace</button></div>' +
        '</div>';
      document.body.appendChild(back);

      const $ = (s) => back.querySelector(s);
      const canvasEl = $('.npj-pe-canvas');
      const hintEl = $('.npj-pe-tools .hint');
      const dimEl = $('.npj-pe-tools .dim');
      const stEl = $('.npj-pe-ft .st');
      const saveBtn = $('[data-act=save]');

      let img = null, cleanup = () => {};
      let iw = 0, ih = 0, ds = 1, displayW = 0, displayH = 0;
      let crop = { x: 0, y: 0, w: 0, h: 0 };          // natural px
      const redacts = [];                              // [{ x,y,w,h, el }] natural px
      let mode = 'crop', dirty = false, busy = false, selected = null, done = false;

      function finish(val) {
        if (done) return; done = true;
        document.removeEventListener('keydown', onKey, true);
        try { cleanup(); } catch (e) {}
        back.remove();
        resolve(val);
      }

      stEl.textContent = 'Loading the image…';
      loadImage(opts).then((r) => {
        img = r.img; cleanup = r.cleanup;
        iw = img.naturalWidth || img.width; ih = img.naturalHeight || img.height;
        if (!iw || !ih) { stEl.textContent = 'That image has no readable dimensions.'; return; }
        // Fit the whole image into the stage so there's no scrolling to fight; small
        // images are upscaled (capped) so they're still workable.
        const maxW = Math.min(window.innerWidth - 90, 1100);
        const maxH = window.innerHeight - 260;
        ds = Math.min(maxW / iw, maxH / ih, 3);
        displayW = Math.max(1, Math.round(iw * ds));
        displayH = Math.max(1, Math.round(ih * ds));
        ds = displayW / iw;                            // exact, after rounding
        canvasEl.style.width = displayW + 'px';
        canvasEl.style.height = displayH + 'px';
        const el = new Image();
        el.src = img.src; el.draggable = false; el.alt = '';
        canvasEl.appendChild(el);
        cropEl = buildCrop();
        canvasEl.appendChild(cropEl);
        crop = { x: 0, y: 0, w: iw, h: ih };
        paint();
        stEl.textContent = '';
      }).catch((e) => { stEl.textContent = (e && e.message) || 'Could not load this image.'; });

      let cropEl = null;
      function buildCrop() {
        const d = document.createElement('div');
        d.className = 'npj-pe-crop';
        HANDLES8.forEach((h) => { const k = document.createElement('div'); k.className = 'h'; k.dataset.h = h; d.appendChild(k); });
        return d;
      }
      function buildRedact(r) {
        const d = document.createElement('div');
        d.className = 'npj-pe-redact';
        HANDLES4.forEach((h) => { const k = document.createElement('div'); k.className = 'h'; k.dataset.h = h; d.appendChild(k); });
        const rm = document.createElement('button'); rm.className = 'rm'; rm.dataset.act = 'rm'; rm.textContent = '✕'; rm.title = 'Remove';
        d.appendChild(rm);
        r.el = d; d.__r = r;
        canvasEl.appendChild(d);
        return d;
      }
      const setBox = (el, r) => {
        el.style.left = (r.x * ds) + 'px'; el.style.top = (r.y * ds) + 'px';
        el.style.width = (r.w * ds) + 'px'; el.style.height = (r.h * ds) + 'px';
      };
      function paint() {
        if (cropEl) setBox(cropEl, crop);
        redacts.forEach((r) => { setBox(r.el, r); r.el.classList.toggle('sel', r === selected); });
        dimEl.textContent = Math.round(crop.w) + ' × ' + Math.round(crop.h) + ' px';
        hintEl.textContent = mode === 'crop'
          ? 'Drag a new box, or pull the handles. Everything outside is trimmed.'
          : (redacts.length ? redacts.length + ' redaction' + (redacts.length === 1 ? '' : 's') + ' · drag to add more' : 'Drag across faces, plates, screens — they’re painted out for good.');
        saveBtn.disabled = busy || !dirty;
      }
      function markDirty() { dirty = true; paint(); }

      const bounds = () => ({ x: 0, y: 0, w: iw, h: ih });
      const toNat = (e) => {
        const r = canvasEl.getBoundingClientRect();
        return { x: clamp((e.clientX - r.left) / (r.width / iw), 0, iw), y: clamp((e.clientY - r.top) / (r.height / ih), 0, ih) };
      };

      function beginDrag(onMove) {
        const move = (ev) => onMove(ev);
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      }

      canvasEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !img) return;
        const t = e.target;
        // Remove a redaction box.
        if (t.dataset && t.dataset.act === 'rm') {
          e.preventDefault();
          const owner = t.closest('.npj-pe-redact');
          const i = redacts.findIndex((r) => r.el === owner);
          if (i >= 0) { redacts[i].el.remove(); redacts.splice(i, 1); selected = null; markDirty(); }
          return;
        }
        const hid = t.dataset && t.dataset.h;
        const ownerCrop = t.closest('.npj-pe-crop');
        const ownerRedact = t.closest('.npj-pe-redact');
        const start = toNat(e);

        // Resize an existing box (crop, or a redaction).
        if (hid && (ownerCrop || ownerRedact)) {
          e.preventDefault(); e.stopPropagation();
          const isCrop = !!ownerCrop;
          const ref = isCrop ? crop : redacts.find((r) => r.el === ownerRedact);
          if (!ref) return;
          const s0 = { x: ref.x, y: ref.y, w: ref.w, h: ref.h };
          selected = isCrop ? selected : ref;
          beginDrag((ev) => {
            const p = toNat(ev);
            const nv = resized(s0, hid, p.x - start.x, p.y - start.y, bounds(), MIN_NAT);
            if (isCrop) crop = nv; else Object.assign(ref, nv);
            markDirty();
          });
          return;
        }
        // Move the crop box (crop mode) or a redaction (redact mode).
        if (ownerCrop && mode === 'crop') {
          e.preventDefault();
          const s0 = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
          beginDrag((ev) => { const p = toNat(ev); crop = moved(s0, p.x - start.x, p.y - start.y, bounds()); markDirty(); });
          return;
        }
        if (ownerRedact && mode === 'redact') {
          e.preventDefault();
          const ref = redacts.find((r) => r.el === ownerRedact);
          selected = ref;
          const s0 = { x: ref.x, y: ref.y, w: ref.w, h: ref.h };
          beginDrag((ev) => { const p = toNat(ev); Object.assign(ref, moved(s0, p.x - start.x, p.y - start.y, bounds())); markDirty(); });
          paint();
          return;
        }
        // Background: draw a new box from the press point.
        e.preventDefault();
        let target = null;
        if (mode === 'redact') { target = { x: start.x, y: start.y, w: 0, h: 0 }; buildRedact(target); redacts.push(target); selected = target; }
        beginDrag((ev) => {
          const p = toNat(ev);
          const nx = Math.min(start.x, p.x), ny = Math.min(start.y, p.y);
          const nw = Math.abs(p.x - start.x), nh = Math.abs(p.y - start.y);
          if (mode === 'crop') crop = { x: nx, y: ny, w: Math.max(MIN_NAT, nw), h: Math.max(MIN_NAT, nh) };
          else { target.x = nx; target.y = ny; target.w = nw; target.h = nh; }
          markDirty();
        });
        // Discard a redaction that was just a click (too small to be intentional).
        const cleanupTiny = () => {
          document.removeEventListener('pointerup', cleanupTiny);
          if (mode === 'redact' && target && (target.w < MIN_NAT || target.h < MIN_NAT)) {
            const i = redacts.indexOf(target); if (i >= 0) { target.el.remove(); redacts.splice(i, 1); selected = null; paint(); }
          }
        };
        document.addEventListener('pointerup', cleanupTiny);
      });

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
          e.preventDefault();
          const i = redacts.indexOf(selected);
          if (i >= 0) { selected.el.remove(); redacts.splice(i, 1); selected = null; markDirty(); }
        }
      }
      document.addEventListener('keydown', onKey, true);

      back.addEventListener('pointerdown', (e) => { if (e.target === back) finish(null); });
      back.addEventListener('click', (e) => {
        const act = e.target.dataset && e.target.dataset.act;
        const m = e.target.dataset && e.target.dataset.mode;
        if (m) {
          mode = m; selected = null;
          back.querySelectorAll('.npj-pe-tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
          canvasEl.classList.toggle('mode-crop', m === 'crop');
          canvasEl.classList.toggle('mode-redact', m === 'redact');
          paint();
          return;
        }
        if (act === 'cancel') { finish(null); return; }
        if (act === 'reset') {
          crop = { x: 0, y: 0, w: iw, h: ih };
          redacts.splice(0).forEach((r) => r.el.remove());
          selected = null; dirty = false; paint();
          return;
        }
        if (act === 'save') { doSave(); return; }
      });

      async function doSave() {
        if (busy || !img) return;
        busy = true; saveBtn.disabled = true; stEl.textContent = 'Burning in the edits…';
        try {
          const blob = await bake(img, { iw, ih, crop, redacts: redacts.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })), maxDim: MAX_DIM });
          finish(blob);
        } catch (e) {
          busy = false; saveBtn.disabled = false;
          stEl.textContent = (e && e.message) || 'Could not save the edited image.';
        }
      }
    });
  }

  const api = { open, planBake, cropToNatural, outputSize, bake };
  if (typeof window !== 'undefined') window.NpjPhotoEditor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
