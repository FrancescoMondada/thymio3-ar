import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockIn } from '../src/lockin.js';
import { SpotFinder } from '../src/detect.js';
import { BLINK_HZ, HALF_MS, windowOf } from '../src/script.js';

const WINDOW = windowOf(HALF_MS);              // ms: 2.5 periods of the blink

// A synthetic video of the robot seen from above: a dark textured table, a white body under the LEDs (steady and
// bright), the 16 green LEDs in two rows of 8 (blinking, or not), and steady lights of other colours (the ring,
// a blue and a red light). `dx`, `dy`: the whole picture moved by that many pixels (a hand that shakes).
const W = 320, H = 180;
const LEDS = [];
for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) LEDS.push({ x: 160 + (k - 3.5) * 21, y: 90 + (row - 0.5) * 21 });
const EXTRA = [
  { x: 60, y: 40, rgb: [50, 80, 255], r: 5 },      // blue
  { x: 250, y: 150, rgb: [255, 50, 25], r: 7 },    // red glow
  { x: 70, y: 120, rgb: [255, 180, 25], r: 4 }, { x: 90, y: 135, rgb: [255, 180, 25], r: 4 }, { x: 55, y: 135, rgb: [255, 180, 25], r: 4 },
];

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

function frame({ on, extra = true, noise = 6, dx = 0, dy = 0, rnd }) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = x - dx, Y = y - dy;
      let v = 22 + 10 * Math.sin(X * 0.11) * Math.cos(Y * 0.07);                // the table, with some texture
      if (X >= 20 && X < 300 && Y >= 45 && Y < 135) v = 170;                      // the white body (twice as wide as the strip of LEDs), as grey as the phone shows it
      const k = (y * W + x) * 4;
      v += (rnd() - 0.5) * noise;
      rgba[k] = v; rgba[k + 1] = v; rgba[k + 2] = v; rgba[k + 3] = 255;
    }
  }
  // a lit LED replaces the colour under it, more and more towards its middle (the stud turns green: measured on a
  // photo, a stud (152,167,158) goes to (143,251,19)); `rgb` is its colour at the middle
  const spot = ({ x, y, rgb = [150, 255, 40], r = 3.6 }) => {
    for (let j = Math.floor(y + dy - r - 1); j <= Math.ceil(y + dy + r + 1); j++) {
      for (let i = Math.floor(x + dx - r - 1); i <= Math.ceil(x + dx + r + 1); i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const d = Math.hypot(i + 0.5 - (x + dx), j + 0.5 - (y + dy));
        if (d > r) continue;
        const c = 1 - (d / r) ** 2, k = (j * W + i) * 4;
        for (let ch = 0; ch < 3; ch++) rgba[k + ch] = rgba[k + ch] * (1 - c) + rgb[ch] * c;
      }
    }
  };
  if (on) LEDS.forEach(spot);
  if (extra) EXTRA.forEach(spot);
  return rgba;
}

// times (ms) of pictures at `fps`, each late or early by up to `jitter` ms, a share `drop` of them missing
function times(count, { fps = 30, jitter = 0, drop = 0, t0 = 1000, rnd }) {
  const out = [];
  for (let i = 0, k = 0; out.length < count; i++, k++) {
    if (drop && rnd() < drop) continue;
    out.push(t0 + (1000 * i) / fps + (rnd() - 0.5) * 2 * jitter);
  }
  return out;
}

// runs the video through the lock-in and the spot finder; -> the spots found in the last picture, and the finder result
function run({ hz = BLINK_HZ, blinkHz = BLINK_HZ, phase = 0, blink = true, count = 48, threshold = 40, tOpts = {}, picture = {}, seed = 7, windowMs = WINDOW, signal = 'amp' }) {
  const rnd = rng(seed);
  const lock = new LockIn({ hz, windowMs });
  const finder = new SpotFinder();
  let res = null, ready = false;
  for (const t of times(count, { ...tOpts, rnd })) {
    const on = blink ? ((t / 1000) * blinkHz + phase) % 1 < 0.5 : true;
    ready = lock.push(frame({ on, rnd, ...picture, ...(picture.shake ? { dx: Math.round((rnd() - 0.5) * 2 * picture.shake), dy: Math.round((rnd() - 0.5) * 2 * picture.shake) } : {}) }), W, H, t);
    if (ready) res = finder.findFromValues(lock[signal], W, H, threshold, { minArea: 3, maxArea: 600 });
  }
  return { res, ready, lock };
}

const matched = (spots, tol = 0.8) => LEDS.filter((l) => spots.some((s) => Math.hypot(s.x - l.x, s.y - l.y) <= tol)).length;

test('blinking LEDs among a steady white body and steady coloured lights: the 16 and only the 16', () => {
  const { res } = run({});
  assert.equal(res.spots.length, 16);
  assert.equal(matched(res.spots), 16, 'each spot is on an LED, to within a pixel');
});

test('what blinks is found at any phase', () => {
  for (const phase of [0, 0.13, 0.25, 0.5, 0.8]) {
    const { res } = run({ phase });
    assert.equal(res.spots.length, 16, `phase ${phase}`);
    assert.equal(matched(res.spots), 16, `phase ${phase}`);
  }
});

test('pictures that are late, early or missing do not matter (the weights use the real times)', () => {
  const { res } = run({ count: 70, tOpts: { jitter: 6, drop: 0.2 }, seed: 11 });
  assert.equal(res.spots.length, 16);
  assert.equal(matched(res.spots), 16);
});

test('a camera at 24 or at 60 pictures a second works as well', () => {
  for (const fps of [24, 60]) {
    const { res } = run({ count: 2 * fps, tOpts: { fps, jitter: 2 } });
    assert.equal(res.spots.length, 16, `${fps} fps`);
  }
});

test('the robot clock and the camera clock differ by a few percent: still found', () => {
  for (const f of [0.96, 1.04]) {
    const { res } = run({ blinkHz: BLINK_HZ * f });
    assert.equal(res.spots.length, 16, `x${f}`);
  }
});

test('LEDs that do not blink are not found (the robot must blink)', () => {
  const { res } = run({ blink: false });
  assert.equal(res.spots.length, 0);
});

test('something that pulses much more slowly (0.5 or 1 Hz) is not found; 2 and 3 Hz are (a window of 1 s tells apart blinkers 0.5 Hz away or more)', () => {
  // measured at 30 pictures a second, 4 LEDs, response of a pixel that blinks at f (100 at the robot's 2.5 Hz): 0.5 Hz 3,
  // 1 Hz 16, 1.5 Hz 17, 2 Hz 50, 3 Hz 67, 3.5 Hz 6, 4 Hz 36, 5 Hz 19. Nothing on the robot blinks once the script has
  // switched the behaviors off: this is about the neighbours of the robot's rhythm, which the window cannot refuse.
  for (const blinkHz of [0.5, 1]) {
    const { res } = run({ blinkHz });
    assert.equal(res.spots.length, 0, `${blinkHz} Hz`);
  }
  for (const blinkHz of [2, 3]) {
    const { res } = run({ blinkHz });
    assert.equal(res.spots.length, 16, `${blinkHz} Hz leaks through`);
  }
});

test('a phone that analyses only 6 or 10 pictures a second (the first test on a phone had 5.9) still finds the LEDs at 2.5 Hz', () => {
  for (const fps of [6, 10]) {
    const { res } = run({ count: 5 * fps, tOpts: { fps, jitter: fps === 6 ? 25 : 8 } });
    assert.equal(res.spots.length, 16, `${fps} pictures a second`);
    assert.equal(matched(res.spots), 16);
  }
});

test('a hand that shakes by a pixel: the LEDs are still all found, with no more than a few false spots', () => {
  const { res } = run({ picture: { shake: 1.2 }, count: 48, threshold: 60 });
  assert.equal(matched(res.spots, 1.6), 16);
  assert.ok(res.spots.length <= 24, `${res.spots.length} spots`);
});

test('a slow steady drift of the whole picture (the hand moves): the LEDs are found where they have gone, nothing else', () => {
  // 3 px a second to the right: the edges of the body and of the table slide across the pixels
  const rnd = rng(9);
  const lock = new LockIn({ hz: BLINK_HZ, windowMs: WINDOW });
  const finder = new SpotFinder();
  let res = null, dx = 0;
  for (const t of times(48, { fps: 30, jitter: 3, rnd })) {
    dx = Math.round(((t - 1000) / 1000) * 3);
    const ready = lock.push(frame({ on: ((t / 1000) * BLINK_HZ) % 1 < 0.5, rnd, dx }), W, H, t);
    if (ready) res = finder.findFromValues(lock.amp, W, H, 40, { minArea: 3, maxArea: 600 });
  }
  const moved = LEDS.map((l) => ({ x: l.x + dx, y: l.y }));
  const found = moved.filter((l) => res.spots.some((s) => Math.hypot(s.x - l.x, s.y - l.y) <= 3)).length;
  assert.ok(found >= 15, `${found} of 16 LEDs found after a drift of ${dx} px`);
  assert.ok(res.spots.length <= 19, `${res.spots.length} spots`);
});

test('a sliding edge alone (no blink at all, the picture drifts at 4 px a second) is not taken for a blink by the colour signal', () => {
  // (the total signal answers about 55 of 255 to an edge that slides at 2 to 16 px a second, at the 2.5 Hz of the robot:
  // that is why the page uses the colour signal, which gives 0 there)
  const rnd = rng(4);
  const lock = new LockIn({ hz: BLINK_HZ, windowMs: WINDOW });
  const finder = new SpotFinder();
  let res = null;
  for (const t of times(48, { fps: 30, jitter: 3, rnd })) {
    const ready = lock.push(frame({ on: false, rnd, dx: Math.round(((t - 1000) / 1000) * 4) }), W, H, t);
    if (ready) res = finder.findFromValues(lock.chroma, W, H, 40, { minArea: 3, maxArea: 600 });
  }
  assert.equal(res.spots.length, 0);
});

test('the green signal: the 16 LEDs among steady lights, at any phase', () => {
  for (const phase of [0, 0.3, 0.7]) {
    const { res } = run({ signal: 'chroma', phase });
    assert.equal(res.spots.length, 16, `phase ${phase}`);
    assert.equal(matched(res.spots), 16);
  }
});

test('the green signal keeps the shaking outline of the body from being taken for LEDs, which the total signal does not', () => {
  const total = run({ picture: { shake: 2 }, count: 48, threshold: 40 });
  const green = run({ signal: 'chroma', picture: { shake: 2 }, count: 48, threshold: 40 });
  assert.ok(green.res.spots.length <= 18, `green: ${green.res.spots.length} spots`);
  assert.equal(matched(green.res.spots, 2.5), 16, 'and the 16 LEDs are all there');
  assert.ok(total.res.spots.length > green.res.spots.length, `total: ${total.res.spots.length} spots, green: ${green.res.spots.length}`);
});

test('the colour signal ignores a change of brightness alone (a white light that blinks), the total signal does not', () => {
  // the 16 LEDs steady and green; a white patch blinks
  const rnd = rng(21);
  const lock = new LockIn({ hz: BLINK_HZ, windowMs: WINDOW });
  const finder = new SpotFinder();
  let g = null, tot = null;
  for (const t of times(40, { rnd })) {
    const on = ((t / 1000) * BLINK_HZ) % 1 < 0.5;
    const f = frame({ on: true, extra: false, rnd });
    if (on) { const k = (40 * W + 60) * 4; for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const q = k + (j * W + i) * 4; f[q] = f[q + 1] = f[q + 2] = 255; } }
    if (lock.push(f, W, H, t)) {
      g = finder.findFromValues(lock.chroma, W, H, 40, { minArea: 3, maxArea: 600 }).spots.length;
      tot = finder.findFromValues(lock.amp, W, H, 40, { minArea: 3, maxArea: 600 }).spots.length;
    }
  }
  assert.equal(g, 0);
  assert.ok(tot >= 1);
});

test('the colour signal is a colour signal, not a green one: a blue light that blinks shows in it too', () => {
  // (so a blinking blue or red light on the robot would be taken for an LED: nothing on the robot blinks once the
  // script has switched the behaviors off)
  const rnd = rng(22);
  const lock = new LockIn({ hz: BLINK_HZ, windowMs: WINDOW });
  const finder = new SpotFinder();
  let g = null;
  for (const t of times(40, { rnd })) {
    const on = ((t / 1000) * BLINK_HZ) % 1 < 0.5;
    const f = frame({ on: false, extra: false, rnd });
    if (on) { const k = (40 * W + 60) * 4; for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const q = k + (j * W + i) * 4; f[q] = 50; f[q + 1] = 80; f[q + 2] = 255; } }
    if (lock.push(f, W, H, t)) g = finder.findFromValues(lock.chroma, W, H, 40, { minArea: 3, maxArea: 600 }).spots.length;
  }
  assert.ok(g >= 1);
});

test('the amplitude is 0.64 of the root of the sum of the squares of the three differences, as the doc says', () => {
  const rnd = rng(5);
  const { lock } = run({ picture: { extra: false, noise: 0 } });
  const on = frame({ on: true, extra: false, noise: 0, rnd }), off = frame({ on: false, extra: false, noise: 0, rnd });
  const i = Math.round(LEDS[0].y) * W + Math.round(LEDS[0].x), k = i * 4;
  const diff = Math.hypot(on[k] - off[k], on[k + 1] - off[k + 1], on[k + 2] - off[k + 2]);
  const a = lock.amp[i];
  assert.ok(Math.abs(a - 0.6366 * diff) <= 0.15 * 0.6366 * diff, `amplitude ${a}, expected about ${(0.6366 * diff).toFixed(0)}`);
});

test('the sums wait for most of a window, a long gap starts again, and computeEvery thins the sums out but keeps every picture', () => {
  const rnd = rng(3);
  const f = frame({ on: true, rnd });
  const lock = new LockIn({ hz: BLINK_HZ, windowMs: WINDOW });
  for (let i = 0; i < 25; i++) assert.equal(lock.push(f, W, H, 1000 + i * 33), false, `picture ${i}: under 80 % of a window`);
  assert.equal(lock.push(f, W, H, 1000 + 25 * 33), true);
  assert.equal(lock.push(f, W, H, 1000 + 26 * 33 + 5000), false, 'after 5 s of nothing');
  assert.equal(lock.ready, false);

  const thin = new LockIn({ hz: BLINK_HZ, windowMs: WINDOW, computeEvery: 90 });
  let sums = 0;
  const finder = new SpotFinder();
  let res = null;
  const r2 = rng(8);
  for (const t of times(90, { rnd: r2 })) {
    if (thin.push(frame({ on: ((t / 1000) * BLINK_HZ) % 1 < 0.5, rnd: r2 }), W, H, t)) { sums++; res = finder.findFromValues(thin.amp, W, H, 40, { minArea: 3, maxArea: 600 }); }
  }
  assert.ok(thin.ready);
  assert.equal(res.spots.length, 16);
  assert.ok(sums >= 12 && sums <= 22, `${sums} sums for 65 pictures after the first window, one every 90 ms or so`);
});

test('speed of the lock-in (reported, loosely bounded)', () => {
  for (const [w, h] of [[640, 360], [1280, 720]]) {
    const lock = new LockIn({ hz: BLINK_HZ, frames: 8 });
    const rgba = new Uint8ClampedArray(w * h * 4).fill(60);
    for (let i = 0; i < 8; i++) lock.push(rgba, w, h, 1000 + i * 33);
    const t0 = performance.now();
    const runs = 15;
    for (let i = 0; i < runs; i++) lock.push(rgba, w, h, 2000 + i * 33);
    const ms = (performance.now() - t0) / runs;
    console.log(`  lock-in ${w}x${h}: ${ms.toFixed(1)} ms per picture in Node`);
    assert.ok(ms < 150);
  }
});
