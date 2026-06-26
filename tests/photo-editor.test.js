/* photo-editor.test.js — the geometry that makes a redaction land on the right
 * pixels and a crop downscale correctly. planBake() is pure (no canvas/DOM), so
 * it runs under node --test with no jsdom, like the rest of the suite.
 *
 * The invariant under test is the one the whole "redact before archive" promise
 * rests on: whatever the author paints over must map to the exact output pixels
 * that bake() fills black.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const PE = require("../app/media/photo-editor.js");

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("a full-frame crop with no scaling keeps natural size", () => {
  const { cropN, out } = PE.planBake({ iw: 800, ih: 600, crop: { x: 0, y: 0, w: 800, h: 600 }, redacts: [], maxDim: 1600 });
  assert.deepEqual(cropN, { x: 0, y: 0, w: 800, h: 600 });
  assert.equal(out.w, 800);
  assert.equal(out.h, 600);
  assert.equal(out.scale, 1);
});

test("crop is clamped inside the image bounds", () => {
  // a crop pushed past the right/bottom edges is trimmed to what's actually there
  const { cropN } = PE.planBake({ iw: 400, ih: 300, crop: { x: 350, y: 280, w: 200, h: 200 }, redacts: [] });
  assert.equal(cropN.x, 350);
  assert.equal(cropN.y, 280);
  assert.equal(cropN.w, 50);  // 400 - 350
  assert.equal(cropN.h, 20);  // 300 - 280
});

test("output is downscaled so the longest side hits maxDim", () => {
  const { out } = PE.planBake({ iw: 4000, ih: 2000, crop: { x: 0, y: 0, w: 4000, h: 2000 }, redacts: [], maxDim: 1600 });
  assert.ok(near(out.scale, 0.4));
  assert.equal(out.w, 1600);
  assert.equal(out.h, 800);
});

test("a redaction translates by the crop origin and scales with the crop", () => {
  // crop a 1000-wide image to the right half, then downscale that 500px crop to 250
  const plan = PE.planBake({
    iw: 1000, ih: 1000,
    crop: { x: 500, y: 0, w: 500, h: 500 },
    redacts: [{ x: 600, y: 100, w: 100, h: 50 }],
    maxDim: 250,
  });
  assert.ok(near(plan.out.scale, 0.5));
  const r = plan.redactsOut[0];
  // (600-500)*0.5 = 50 ; (100-0)*0.5 = 50 ; 100*0.5 = 50 ; 50*0.5 = 25
  assert.ok(near(r.x, 50), "x=" + r.x);
  assert.ok(near(r.y, 50), "y=" + r.y);
  assert.ok(near(r.w, 50), "w=" + r.w);
  assert.ok(near(r.h, 25), "h=" + r.h);
});

test("a redaction covering the whole crop still covers the whole output", () => {
  // the box spills past the crop on every side — its mapped rect must blanket the
  // output canvas (fillRect clips the overhang), i.e. origin <=0 and far edge >= out
  const plan = PE.planBake({
    iw: 600, ih: 600,
    crop: { x: 100, y: 100, w: 200, h: 200 },
    redacts: [{ x: 0, y: 0, w: 600, h: 600 }],
  });
  const r = plan.redactsOut[0];
  assert.ok(r.x <= 0 && r.y <= 0);
  assert.ok(r.x + r.w >= plan.out.w);
  assert.ok(r.y + r.h >= plan.out.h);
});

test("a tiny crop never produces a zero-size canvas", () => {
  const { out } = PE.planBake({ iw: 1000, ih: 1000, crop: { x: 0, y: 0, w: 0, h: 0 }, redacts: [] });
  assert.ok(out.w >= 1 && out.h >= 1);
});
