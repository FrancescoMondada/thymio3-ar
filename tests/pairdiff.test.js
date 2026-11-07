import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairDiff } from '../src/pairdiff.js';
import { LockIn } from '../src/lockin.js';
import { SpotFinder } from '../src/detect.js';
import { BLINK_HZ, HALF_MS, windowOf } from '../src/script.js';
import { pickSquare } from '../src/square.js';
import { W, H, LEDS, rng, frame, times } from './scene.js';

const SIZE = { minArea: 3, maxArea: 600 };
const LED_DIAMETER = 7.2;                       // px, in the shared scene
const SWAY_HZ = 0.6;

// The video goes through the pair difference, picture by picture. `sway`: the whole picture moves back and forth
// at 0.6 Hz with that amplitude (px), as a hand-held phone does. -> one entry per picture compared: the spots, which
// of P and N they came from, and where the picture was moved to.
function run({ count = 60, fps = 25, jitter = 2, picture = {}, seed = 7, phase = 0, blink = true, blinkHz = BLINK_HZ, sway = 0, threshold = 50, halfMs = HALF_MS }) {
  const rnd = rng(seed);
  const pd = new PairDiff({ halfMs });
  const out = [];
  for (const t of times(count, { fps, jitter, rnd })) {
    const on = blink ? ((t / 1000) * blinkHz + phase) % 1 < 0.5 : true;
    const ph = 2 * Math.PI * SWAY_HZ * ((t - 1000) / 1000);
    const move = sway ? { dx: sway * Math.sin(ph), dy: 0.5 * sway * Math.sin(ph + 1) }
      : picture.shake ? { dx: Math.round((rnd() - 0.5) * 2 * picture.shake), dy: Math.round((rnd() - 0.5) * 2 * picture.shake) } : { dx: 0, dy: 0 };
    if (pd.push(frame({ on, rnd, ...picture, ...move }), W, H, t)) {
      const r = pd.find(threshold, SIZE);
      out.push({ t, spots: r.spots, source: r.source, ...move });
    }
  }
  return { out, pd };
}

// the LEDs that have a spot near them: where they are in this picture (P), or, for N, anywhere the picture could have
// carried them in the last 0.35 s (peak speed `sway` * 2 pi * 0.6 px a second)
const matched = (e, sway = 0, tolerance = null) => {
  const tol = tolerance ?? (e.source === 'N' ? 1 + sway * 2 * Math.PI * SWAY_HZ * 0.35 : 1.5);
  return LEDS.filter((l) => e.spots.some((s) => Math.hypot(s.x - (l.x + e.dx), s.y - (l.y + e.dy)) <= tol)).length;
};
const share = (out, test, after = 2000) => {
  const late = out.filter((e) => e.t > 1000 + after);
  return late.filter(test).length / late.length;
};
const all16 = (sway = 0) => (e) => matched(e, sway) === 16 && e.spots.length <= 20;

test('blinking LEDs among a steady white body and steady coloured lights: the 16 and only the 16, at any phase', () => {
  for (const phase of [0, 0.13, 0.25, 0.5, 0.8]) {
    const { out } = run({ phase });
    assert.equal(share(out, all16()), 1, `phase ${phase}`);
  }
});

test('both halves of the blink are used: P when the LEDs are on in the picture, N when they were on in the older one', () => {
  const sources = new Set(run({}).out.map((e) => e.source));
  assert.deepEqual([...sources].sort(), ['N', 'P']);
  const rnd = rng(2);
  const pd = new PairDiff({ halfMs: HALF_MS });
  const on = frame({ on: true, rnd, extra: false }), off = frame({ on: false, rnd, extra: false });
  pd.push(off, W, H, 1000);
  assert.ok(pd.push(on, W, H, 1000 + HALF_MS));
  assert.equal(pd.find(50, SIZE).source, 'P');
  pd.push(off, W, H, 1000 + 2 * HALF_MS);
  const r = pd.find(50, SIZE);
  assert.equal(r.source, 'N');
  assert.equal(r.spots.length, 16);
});

test('a camera that gives 6 or 10 pictures a second, or 30, still finds them nearly every time', () => {
  for (const [fps, jitter, least] of [[30, 2, 0.95], [10, 8, 0.9], [6, 25, 0.85]]) {
    const { out } = run({ fps, jitter, count: 8 * fps });
    assert.ok(share(out, all16()) >= least, `${fps} pictures a second: ${(100 * share(out, all16())).toFixed(0)} %`);
  }
});

test('a hand-held phone: the picture sways at up to 4 LED diameters a second, the LEDs are found where they are', () => {
  const sway = (4 * LED_DIAMETER) / (2 * Math.PI * SWAY_HZ);                    // amplitude of a sway whose peak speed is 4 diameters a second
  for (const [fps, jitter] of [[25, 2], [10, 8]]) {
    const { out } = run({ fps, jitter, sway, count: 8 * fps });
    const ok = share(out, all16(sway));
    assert.ok(ok >= 0.9, `${fps} pictures a second: ${(100 * ok).toFixed(0)} %`);
  }
});

test('...which the lock-in over a second does not survive (why this module exists)', () => {
  const sway = (4 * LED_DIAMETER) / (2 * Math.PI * SWAY_HZ);
  const rnd = rng(7), lock = new LockIn({ hz: BLINK_HZ, windowMs: windowOf(HALF_MS) }), finder = new SpotFinder();
  let n = 0, good = 0;
  for (const t of times(80, { fps: 10, jitter: 8, rnd })) {
    const ph = 2 * Math.PI * SWAY_HZ * ((t - 1000) / 1000);
    const dx = sway * Math.sin(ph), dy = 0.5 * sway * Math.sin(ph + 1);
    if (lock.push(frame({ on: ((t / 1000) * BLINK_HZ) % 1 < 0.5, rnd, dx, dy }), W, H, t) && t > 3000) {
      n++;
      const spots = finder.findFromValues(lock.chroma, W, H, 50, SIZE).spots;
      if (LEDS.filter((l) => spots.some((s) => Math.hypot(s.x - (l.x + dx), s.y - (l.y + dy)) <= 1.5)).length === 16) good++;
    }
  }
  assert.ok(good / n < 0.2, `the lock-in finds all 16 in ${((100 * good) / n).toFixed(0)} % of the pictures`);
});

test('a hand that shakes by 2 px at every picture: the LEDs are still found, with few false spots', () => {
  // (a spot of N is where the LED was in an older picture, which was itself shaken by up to 2 px: 5 px is generous)
  const { out } = run({ picture: { shake: 2 }, count: 120 });
  assert.ok(share(out, (e) => matched(e, 0, 5) === 16 && e.spots.length <= 20) >= 0.9);
});

test('LEDs that do not blink are not found, nor is anything that stays as it is (body, table, steady lights)', () => {
  const { out } = run({ blink: false });
  assert.equal(share(out, (e) => e.spots.length === 0), 1);
});

test('a light that blinks but is not green (white, blue, red) is not found: only a rise or a fall of greenness counts', () => {
  const rnd = rng(31);
  for (const rgb of [[255, 255, 255], [50, 80, 255], [255, 50, 25]]) {
    const pd = new PairDiff({ halfMs: HALF_MS });
    let seen = 0;
    for (const t of times(60, { rnd, fps: 25 })) {
      const f = frame({ on: false, extra: false, rnd });
      if (((t / 1000) * BLINK_HZ) % 1 < 0.5) { for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const q = ((40 + j) * W + 60 + i) * 4; f[q] = rgb[0]; f[q + 1] = rgb[1]; f[q + 2] = rgb[2]; } }
      if (pd.push(f, W, H, t)) seen += pd.find(50, SIZE).spots.length;
    }
    assert.equal(seen, 0, `colour ${rgb}`);
  }
});

test('the amber ring and other steady lights, carried across the picture by a swaying hand, are not taken for LEDs', () => {
  // amber (255,200,40): G - (R + B) / 2 = 53 but G - max(R, B) = 0, which is why the module uses the second
  const rnd = rng(41), pd = new PairDiff({ halfMs: HALF_MS });
  const sway = (6 * LED_DIAMETER) / (2 * Math.PI * SWAY_HZ);
  let seen = 0, n = 0;
  for (const t of times(100, { rnd, fps: 25 })) {
    const ph = 2 * Math.PI * SWAY_HZ * ((t - 1000) / 1000), dx = sway * Math.sin(ph), dy = 0.5 * sway * Math.sin(ph + 1);
    const f = frame({ on: false, extra: false, rnd, dx, dy });
    for (const [x, y] of [[60, 40], [80, 50], [50, 60], [250, 140]]) {
      for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
        if (Math.hypot(i, j) > 4) continue;
        const q = ((Math.round(y + dy) + j) * W + Math.round(x + dx) + i) * 4;
        f[q] = 255; f[q + 1] = 200; f[q + 2] = 40;
      }
    }
    if (pd.push(f, W, H, t) && t > 2000) { n++; seen += pd.find(50, SIZE).spots.length; }
  }
  assert.ok(n > 40);
  assert.equal(seen, 0);
});

test('the robot clock and the camera clock differ by a few percent: still found', () => {
  for (const f of [0.95, 1.05]) {
    const { out } = run({ blinkHz: BLINK_HZ * f, count: 90 });
    assert.ok(share(out, all16()) >= 0.95, `x${f}`);
  }
});

test('other speeds of the page: a half period of 100 or 400 ms is found as well when the module is told', () => {
  for (const half of [100, 400]) {
    const { out } = run({ halfMs: half, blinkHz: 1000 / (2 * half), count: 150, fps: 25 });
    assert.ok(share(out, all16(), 3000) >= 0.9, `half period ${half} ms`);
  }
});

test('nothing to say before a picture of the right age exists, and a long gap starts again', () => {
  const rnd = rng(3);
  const pd = new PairDiff({ halfMs: HALF_MS });
  const f = frame({ on: true, rnd });
  assert.equal(pd.push(f, W, H, 1000), false, 'the first picture has nothing to be compared with');
  assert.equal(pd.push(f, W, H, 1030), false, '30 ms is less than 0.4 of a half period');
  assert.equal(pd.push(f, W, H, 1100), true);
  assert.equal(pd.push(f, W, H, 1100 + 5000), false, 'after 5 s of nothing');
  assert.equal(pd.ready, false);
});

test('speed of the pair difference (reported, loosely bounded)', () => {
  for (const [w, h] of [[270, 480], [540, 960]]) {
    const pd = new PairDiff({ halfMs: HALF_MS });
    const rgba = new Uint8ClampedArray(w * h * 4).fill(60);
    for (let i = 0; i < 12; i++) pd.push(rgba, w, h, 1000 + i * 40);
    const t0 = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) { pd.push(rgba, w, h, 2000 + i * 40); pd.find(50, SIZE); }
    const ms = (performance.now() - t0) / runs;
    console.log(`  pair difference ${w}x${h}: ${ms.toFixed(1)} ms per picture in Node`);
    assert.ok(ms < 100);
  }
});

// ---- the ring arcs (amber), blinking in turn with a row of 4 Lego LEDs --------------------------------------------------
const RING = { x: 52, y: 90, r: 26 };                                   // px, in the shared scene: left part of the body
const ROW = [0, 2, 4, 6].map((k) => LEDS[k]);                           // front row, every other LED: 4 aligned
const ARC_SIZE = { minArea: 4, maxArea: 800, minFill: 0.1, maxAspect: 8 };
const arcCentre = (i, dx = 0, dy = 0) => ({ x: RING.x + dx + RING.r * Math.sin((i * Math.PI) / 4), y: RING.y + dy - RING.r * Math.cos((i * Math.PI) / 4) });

// amber arcs i (N = 0 up, clockwise, 45 degrees apart): 34 degrees long, 4 px thick, painted into a picture moved by (dx, dy)
function paintArcs(f, ids, dx, dy, rgb = [255, 190, 20]) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ex = x - (RING.x + dx), ey = y - (RING.y + dy), r = Math.hypot(ex, ey);
    if (Math.abs(r - RING.r) > 2) continue;
    const phi = (Math.atan2(ex, -ey) * 180) / Math.PI;
    if (ids.some((i) => Math.abs((((phi - i * 45 + 540) % 360) - 180)) <= 17)) { const k = (y * W + x) * 4; f[k] = rgb[0]; f[k + 1] = rgb[1]; f[k + 2] = rgb[2]; }
  }
}

// the video of the ping-pong: the Lego row is on while the arcs are off and the other way round; the picture sways
function pingPong({ ids = [1, 3, 5, 7], fps = 25, jitter = 2, count = 200, sway = 0, seed = 7, steady = false }) {
  const rnd = rng(seed), green = new PairDiff({ halfMs: HALF_MS }), amber = new PairDiff({ halfMs: HALF_MS, measure: 'amber' });
  const out = [];
  for (const t of times(count, { fps, jitter, rnd })) {
    const ph = 2 * Math.PI * SWAY_HZ * ((t - 1000) / 1000), dx = sway * Math.sin(ph), dy = 0.5 * sway * Math.sin(ph + 1);
    const lit = ((t / 1000) * BLINK_HZ) % 1 < 0.5;
    const f = frame({ on: lit, rnd, dx, dy, leds: ROW });
    paintArcs(f, ids, dx, dy);                                                  // (the ring first: it blinks in turn, see below)
    if (lit) { const g = frame({ on: true, rnd, dx, dy, leds: ROW }); f.set(g); }             // row on, ring off
    else { const g = frame({ on: false, rnd, dx, dy, leds: ROW }); paintArcs(g, ids, dx, dy); f.set(g); }   // row off, ring on
    if (steady) for (const [x, y] of [[250, 150]]) for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { if (Math.hypot(i, j) > 4) continue; const q = ((Math.round(y + dy) + j) * W + Math.round(x + dx) + i) * 4; f[q] = 255; f[q + 1] = 200; f[q + 2] = 40; }
    const a = amber.push(f, W, H, t), g = green.push(f, W, H, t);
    if (a && g) out.push({ t, dx, dy, arcs: amber.find(50, ARC_SIZE), row: green.find(50, SIZE) });
  }
  return out;
}
const arcsFound = (e, ids, tol) => ids.filter((i) => { const c = arcCentre(i, e.dx, e.dy); return e.arcs.spots.some((s) => Math.hypot(s.x - c.x, s.y - c.y) <= tol); }).length;

test('the amber arcs blinking in turn with the row: each set is found by its own colour, and only that set', () => {
  const out = pingPong({}).filter((e) => e.t > 3000);
  const ids = [1, 3, 5, 7];
  assert.ok(out.length > 100);
  assert.ok(out.filter((e) => arcsFound(e, ids, 9) === 4 && e.arcs.spots.length <= 6).length / out.length >= 0.95, 'the 4 arcs');
  assert.ok(out.filter((e) => ROW.every((l) => e.row.spots.some((s) => Math.hypot(s.x - l.x, s.y - l.y) <= 9)) && e.row.spots.length <= 6).length / out.length >= 0.95, 'the 4 Lego LEDs');
  // the green LEDs are not amber (R < G): the arcs' detector does not see the row, and the other way round
  assert.ok(out.every((e) => e.arcs.spots.every((s) => Math.hypot(s.x - RING.x, s.y - RING.y) < RING.r + 10)), 'no arc spot outside the ring');
});

test('the same with a swaying hand, a steady amber light on the table, and the square filter: the 4 arcs and nothing else', () => {
  const sway = (4 * LED_DIAMETER) / (2 * Math.PI * SWAY_HZ);
  for (const [fps, jitter] of [[25, 2], [10, 8]]) {
    const out = pingPong({ sway, fps, jitter, count: 8 * fps, steady: true }).filter((e) => e.t > 3000);
    const ok = out.filter((e) => {
      const sq = pickSquare(e.arcs.spots, { minSide: 8 });
      return sq.full && [1, 3, 5, 7].every((i) => { const c = arcCentre(i, e.dx, e.dy); return sq.chosen.some((s) => Math.hypot(s.x - c.x, s.y - c.y) <= 14); });
    }).length / out.length;
    assert.ok(ok >= 0.85, `${fps} pictures a second: ${(100 * ok).toFixed(0)} % of the pictures have the square`);
  }
});
