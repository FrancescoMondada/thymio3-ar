import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitHomography, ransacHomography, applyH, invertH, scaleAt, reprojection } from '../src/homography.js';
import { ring, legoPoint } from '../src/layout.js';
import { cameraAt, project } from '../src/demo.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// the 4 diagonal arcs and the 4 LEDs of group A, in mm, and what a camera at any height, side and distance makes of them
const mm = [...[1, 3, 5, 7].map((i) => ring(i)), ...[0, 2, 4, 6].map((k) => legoPoint('front', k))].map(([x, y]) => ({ x, y }));
const camera = (rnd) => { const cam = cameraAt(15 + rnd() * 75, rnd() * 360, 150 + rnd() * 650); return (p) => { const q = project(cam, [p.x, p.y, 0]); return { x: q.x, y: q.y }; }; };

test('a homography through 4 exact points reproduces them, and all the other points of the plane, at any height, side and distance', () => {
  const rnd = rng(1);
  for (let trial = 0; trial < 100; trial++) {
    const cam = camera(rnd), dst = mm.map(cam);
    const H = fitHomography(mm.slice(0, 4), dst.slice(0, 4));
    assert.ok(H, `trial ${trial}`);
    for (let i = 0; i < mm.length; i++) {
      const q = applyH(H, mm[i].x, mm[i].y);
      assert.ok(Math.hypot(q.x - dst[i].x, q.y - dst[i].y) < 1e-4, `trial ${trial}: point ${i}`);          // the row LEDs, not used in the fit, are on their place
    }
  }
});

test('with noise on 8 points the fit is good to well under the noise, and better than the 4 points alone', () => {
  const rnd = rng(2);
  let e8 = 0, e4 = 0, n = 0;
  for (let trial = 0; trial < 100; trial++) {
    const cam = camera(rnd), truth = mm.map(cam), noisy = truth.map((p) => ({ x: p.x + (rnd() - 0.5) * 2, y: p.y + (rnd() - 0.5) * 2 }));
    const H8 = fitHomography(mm, noisy), H4 = fitHomography(mm.slice(0, 4), noisy.slice(0, 4));
    for (let k = 0; k < 20; k++) {
      const P = { x: (rnd() - 0.5) * 80, y: (rnd() - 0.5) * 80 + 20 }, t = cam(P), a = applyH(H8, P.x, P.y), b = applyH(H4, P.x, P.y);
      e8 += Math.hypot(a.x - t.x, a.y - t.y); e4 += Math.hypot(b.x - t.x, b.y - t.y); n++;
    }
  }
  assert.ok(e8 / n < 1.2, `mean error ${(e8 / n).toFixed(2)} px with 8 points (noise +-1 px)`);
  assert.ok(e8 < e4, '8 points beat 4');
});

test('points on a line (the row alone) or fewer than 4 do not fix a map: null', () => {
  const row = [0, 2, 4, 6].map((k) => legoPoint('front', k)).map(([x, y]) => ({ x, y }));
  assert.equal(fitHomography(row, row.map((p) => ({ x: p.x * 2 + 10, y: p.y * 2 + 5 }))), null);
  assert.equal(fitHomography(mm.slice(0, 3), mm.slice(0, 3)), null);
});

test('the inverse maps the picture back to the plane, and the scale at a point is the px per mm there', () => {
  const rnd = rng(3);
  for (let trial = 0; trial < 50; trial++) {
    const cam = camera(rnd), H = fitHomography(mm.slice(0, 4), mm.slice(0, 4).map(cam)), inv = invertH(H);
    const P = { x: 5, y: 30 }, q = applyH(H, P.x, P.y), back = applyH(inv, q.x, q.y);
    assert.ok(Math.hypot(back.x - P.x, back.y - P.y) < 1e-6);
    // the scale agrees with two points 1 mm apart
    const a = applyH(H, P.x - 0.5, P.y), b = applyH(H, P.x + 0.5, P.y), c = applyH(H, P.x, P.y - 0.5), d = applyH(H, P.x, P.y + 0.5);
    const area = Math.abs((b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x));
    assert.ok(Math.abs(scaleAt(H, P.x, P.y) - Math.sqrt(area)) / Math.sqrt(area) < 0.01);
  }
});

// (two wrong ARCS out of four cannot be told from the right ones with the row beside them: 2 arcs and 4 collinear LEDs fit exactly whichever 2 arcs are
// taken. So the outliers here are one arc and one LED of the row, or one point alone: what a stray blob does.)
test('with outliers: one arc and one LED of eight are wrong by 40 px and the map is still the right one, with the two found', () => {
  const rnd = rng(4);
  for (let trial = 0; trial < 60; trial++) {
    const cam = camera(rnd), truth = mm.map(cam), noisy = truth.map((p) => ({ x: p.x + (rnd() - 0.5), y: p.y + (rnd() - 0.5) }));
    const bad = [trial % 4, 4 + ((trial + 1) % 4)];
    for (const i of bad) { noisy[i].x += 40; noisy[i].y -= 25; }
    const r = ransacHomography(mm, noisy, { tol: 3 });
    assert.ok(r, `trial ${trial}`);
    assert.equal(r.inliers.length, 6, `trial ${trial}`);
    assert.ok(!r.inliers.includes(bad[0]) && !r.inliers.includes(bad[1]));
    assert.ok(r.rms < 1.5);
    const err = reprojection(r.H, mm, truth);
    assert.ok(Math.max(...err) < 4, `trial ${trial}: worst error ${Math.max(...err).toFixed(1)} px`);
  }
  assert.equal(ransacHomography(mm.slice(0, 3), mm.slice(0, 3)), null);
});
