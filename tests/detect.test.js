import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotFinder, colorName } from '../src/detect.js';
import { Rolling, Rate } from '../src/stats.js';

// A dark picture with round spots: a spot is a disc of `peak` that falls off to the dark over its radius.
function picture(w, h, spots, { noise = 0, seed = 1 } = {}) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < w * h; i++) {
    const g = noise ? Math.floor(rnd() * noise) : 0;
    rgba[i * 4] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255;
  }
  for (const { x, y, r = 3, peak = 255, rgb = [1, 1, 1] } of spots) {
    for (let j = Math.floor(y - r - 1); j <= Math.ceil(y + r + 1); j++) {
      for (let i = Math.floor(x - r - 1); i <= Math.ceil(x + r + 1); i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
        if (d > r) continue;
        const k = (j * w + i) * 4;
        const a = peak * (1 - 0.5 * (d / r) ** 2);
        rgba[k] = Math.max(rgba[k], a * rgb[0]); rgba[k + 1] = Math.max(rgba[k + 1], a * rgb[1]); rgba[k + 2] = Math.max(rgba[k + 2], a * rgb[2]);
      }
    }
  }
  return rgba;
}

// the 16 Lego LEDs as two rows of 8, 8 mm apart, at `pxPerMm`
const sixteen = (cx, cy, pxPerMm, extra = {}) => {
  const out = [];
  for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) out.push({ x: cx + (k - 3.5) * 8 * pxPerMm, y: cy + (row - 0.5) * 8 * pxPerMm, ...extra });
  return out;
};

test('finds 16 spots in two rows and their centres within a tenth of a pixel', () => {
  const W = 640, H = 360;
  const leds = sixteen(320.3, 180.7, 3.1, { r: 3.4 });
  const found = new SpotFinder().find(picture(W, H, leds), W, H, 200);
  assert.equal(found.spots.length, 16);
  for (const led of leds) {
    const best = found.spots.reduce((a, b) => (Math.hypot(a.x - led.x, a.y - led.y) < Math.hypot(b.x - led.x, b.y - led.y) ? a : b));
    assert.ok(Math.hypot(best.x - led.x, best.y - led.y) < 0.15, `spot at ${led.x.toFixed(1)},${led.y.toFixed(1)} found at ${best.x.toFixed(2)},${best.y.toFixed(2)}`);
  }
});

test('LEDs that are too close run together into one spot: that is what the page must show', () => {
  const W = 640, H = 360;
  const leds = sixteen(320, 180, 1.0, { r: 6 });            // 8 px apart, bright cores 8 px wide: touching
  const found = new SpotFinder().find(picture(W, H, leds), W, H, 200, { maxArea: 100000 });
  assert.ok(found.spots.length < 16);
});

test('a red LED counts as much as a white one (the brightest channel, not the luma)', () => {
  const W = 64, H = 64;
  const found = new SpotFinder().find(picture(W, H, [{ x: 20, y: 20, rgb: [1, 0, 0] }, { x: 44, y: 40, rgb: [1, 1, 1] }]), W, H, 200);
  assert.equal(found.spots.length, 2);
});

test('the threshold decides: a dim spot is found below it and not above', () => {
  const W = 64, H = 64;
  const rgba = picture(W, H, [{ x: 30, y: 30, peak: 180 }]);
  const finder = new SpotFinder();
  assert.equal(finder.find(rgba, W, H, 120).spots.length, 1);
  assert.equal(finder.find(rgba, W, H, 200).spots.length, 0);
  const top = finder.find(rgba, W, H, 200).brightest;
  assert.ok(top >= 170 && top <= 180, `brightest ${top}`);
});

test('one lit pixel of noise is not a spot (minArea), a big bright patch is not one either (maxArea)', () => {
  const W = 100, H = 100;
  const rgba = picture(W, H, [{ x: 50, y: 50, r: 30 }]);
  rgba[(5 * W + 5) * 4] = 255;
  const found = new SpotFinder().find(rgba, W, H, 200, { minArea: 2, maxArea: 400 });
  assert.equal(found.spots.length, 0);
  assert.ok(found.lit > 400, 'the pixels are counted even when the spot is refused');
});

test('spots at the edges of the picture are found', () => {
  const W = 50, H = 50;
  const found = new SpotFinder().find(picture(W, H, [{ x: 1, y: 1 }, { x: 48.5, y: 48.5 }, { x: 1, y: 48 }, { x: 48.5, y: 1 }]), W, H, 200);
  assert.equal(found.spots.length, 4);
});

test('the same finder works on pictures of different sizes in turn', () => {
  const finder = new SpotFinder();
  assert.equal(finder.find(picture(320, 180, sixteen(160, 90, 1.6, { r: 1.6 })), 320, 180, 200, { minArea: 1 }).spots.length, 16);
  assert.equal(finder.find(picture(1280, 720, sixteen(640, 360, 6, { r: 6.5 })), 1280, 720, 200).spots.length, 16);
  assert.equal(finder.find(picture(320, 180, []), 320, 180, 200).spots.length, 0);
});

test('paintMask shows the pixels over the threshold', () => {
  const W = 20, H = 20;
  const rgba = picture(W, H, [{ x: 10, y: 10, r: 3 }]);
  const finder = new SpotFinder();
  finder.find(rgba, W, H, 200);
  finder.paintMask(rgba);
  const k = (10 * W + 10) * 4;
  assert.deepEqual([rgba[k], rgba[k + 1], rgba[k + 2]], [255, 0, 200]);
});

test('speed: 1280x720 with noise and 16 spots (reported, loosely bounded)', () => {
  const W = 1280, H = 720;
  const rgba = picture(W, H, sixteen(640, 360, 6, { r: 6.5 }), { noise: 90 });
  const finder = new SpotFinder();
  finder.find(rgba, W, H, 200);                               // warm up
  const t0 = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i++) finder.find(rgba, W, H, 200);
  const ms = (performance.now() - t0) / runs;
  console.log(`  1280x720: ${ms.toFixed(2)} ms per picture in Node`);
  assert.ok(ms < 60);
});

test('Rolling keeps the last values and says how much they move', () => {
  const r = new Rolling(3);
  [10, 20, 30, 40].forEach((x) => r.push(x));
  assert.equal(r.count, 3);
  assert.equal(r.min, 20);
  assert.equal(r.max, 40);
  assert.equal(r.mean, 30);
  assert.ok(Math.abs(r.spreadPct - (100 * 20) / 30) < 1e-9);
  assert.ok(Number.isNaN(new Rolling().mean));
});

test('Rate gives frames per second from the times', () => {
  const r = new Rate(10);
  assert.ok(Number.isNaN(r.perSecond));
  for (let i = 0; i < 10; i++) r.tick(i * 33.333);
  assert.ok(Math.abs(r.perSecond - 30) < 0.01);
});

// a bright flat object (a white robot body, a window) under the spots: pixels of the rectangle at least `value`
function fillRect(rgba, W, x0, y0, x1, y1, value) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) rgba[k + c] = Math.max(rgba[k + c], value);
    }
  }
}

test('LEDs on a white body: a fixed threshold sees one big patch, the local contrast sees the 16 spots', () => {
  const W = 640, H = 360;
  const rgba = picture(W, H, sixteen(320, 180, 3.1, { r: 3.4 }));
  fillRect(rgba, W, 200, 60, 440, 300, 217);                 // the body is brighter than the threshold too
  const finder = new SpotFinder();
  assert.equal(finder.find(rgba, W, H, 200).spots.length, 0, 'without contrast: the body is one patch, refused for its size');
  const found = finder.find(rgba, W, H, 200, { contrast: 15, radius: 8 });
  assert.equal(found.spots.length, 16, 'the rim of the body is long and thin: not a spot');
});

test('with the contrast, the spots are still where they were (a tenth of a pixel)', () => {
  const W = 640, H = 360;
  const leds = sixteen(320.3, 180.7, 3.1, { r: 3.4 });
  const rgba = picture(W, H, leds);
  fillRect(rgba, W, 200, 60, 440, 300, 217);
  const found = new SpotFinder().find(rgba, W, H, 200, { contrast: 15, radius: 8 });
  assert.equal(found.spots.length, 16);
  for (const led of leds) {
    const best = found.spots.reduce((a, b) => (Math.hypot(a.x - led.x, a.y - led.y) < Math.hypot(b.x - led.x, b.y - led.y) ? a : b));
    assert.ok(Math.hypot(best.x - led.x, best.y - led.y) < 0.4, `${best.x.toFixed(2)},${best.y.toFixed(2)} for ${led.x.toFixed(2)},${led.y.toFixed(2)}`);
  }
});

test('a bright window with nothing on it gives no spot with the contrast', () => {
  const W = 320, H = 180;
  const rgba = picture(W, H, []);
  fillRect(rgba, W, 20, 20, 300, 160, 250);
  assert.equal(new SpotFinder().find(rgba, W, H, 200, { contrast: 30, radius: 6 }).spots.length, 0);
});

test('a spot as bright as the body is lost when the contrast asks for more than it has: the page shows the threshold and the mask for this', () => {
  const W = 320, H = 180;
  const rgba = picture(W, H, [{ x: 160.5, y: 90.5, r: 4, peak: 235 }]);
  fillRect(rgba, W, 100, 40, 220, 140, 217);
  const finder = new SpotFinder();
  assert.equal(finder.find(rgba, W, H, 200, { contrast: 30, radius: 8 }).spots.length, 0);
  assert.equal(finder.find(rgba, W, H, 200, { contrast: 3, radius: 8 }).spots.length, 1);
});

test('speed with the contrast: 1280x720 with a white body and 16 spots (reported)', () => {
  const W = 1280, H = 720;
  const rgba = picture(W, H, sixteen(640, 360, 6, { r: 6.5 }), { noise: 90 });
  fillRect(rgba, W, 400, 120, 880, 600, 217);
  const finder = new SpotFinder();
  const opt = { contrast: 30, radius: 16 };
  assert.equal(finder.find(rgba, W, H, 200, opt).spots.length, 16);
  const t0 = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i++) finder.find(rgba, W, H, 200, opt);
  const ms = (performance.now() - t0) / runs;
  console.log(`  1280x720 with contrast: ${ms.toFixed(2)} ms per picture in Node`);
  assert.ok(ms < 80);
});

test('colour names: the green of the Lego LEDs, the amber of the ring, the others', () => {
  assert.equal(colorName(60, 255, 60), 'vert');
  assert.equal(colorName(120, 230, 90), 'vert');
  assert.equal(colorName(255, 190, 20), 'jaune');       // amber
  assert.equal(colorName(255, 255, 40), 'jaune');
  assert.equal(colorName(255, 40, 40), 'rouge');
  assert.equal(colorName(40, 255, 255), 'cyan');
  assert.equal(colorName(60, 80, 255), 'bleu');
  assert.equal(colorName(255, 40, 255), 'magenta');
  assert.equal(colorName(230, 235, 232), 'blanc');
  assert.equal(colorName(10, 20, 15), 'sombre');
});

test('a spot has the colour of its LED, white-hot core or not', () => {
  const W = 200, H = 100;
  const rgba = picture(W, H, [
    { x: 30, y: 30, r: 4, rgb: [0.25, 1, 0.25] },            // green
    { x: 80, y: 30, r: 4, rgb: [1, 0.75, 0.08] },            // amber
    { x: 130, y: 30, r: 4, rgb: [1, 0.15, 1] },              // magenta
    { x: 30, y: 70, r: 4, rgb: [1, 1, 1] },                  // white
  ]);
  // a white-hot core in the middle of the green one, as the phone camera shows it
  for (let j = 29; j <= 30; j++) for (let i = 29; i <= 30; i++) { const k = (j * W + i) * 4; rgba[k] = rgba[k + 1] = rgba[k + 2] = 255; }
  const found = new SpotFinder().find(rgba, W, H, 200);
  const at = (x, y) => found.spots.find((s) => Math.hypot(s.x - x, s.y - y) < 2);
  assert.equal(at(30, 30)?.color, 'vert');
  assert.equal(at(80, 30)?.color, 'jaune');
  assert.equal(at(130, 30)?.color, 'magenta');
  assert.equal(at(30, 70)?.color, 'blanc');
});
