import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSquare } from '../src/square.js';
import { cameraAt, project } from '../src/demo.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// The robot seen by a camera: the 8 arcs of the ring (radius 26 mm round the pad at (0, 26); N points to the nose, +y;
// arc i at i x 45 degrees clockwise from N) and the Lego LEDs of the front row A (x = -28, -12, 4, 20 ... every other one,
// y = -7, 16 mm apart): the same world as the simulated scene (src/demo.js).
const ringPoint = (i) => [26 * Math.sin((i * Math.PI) / 4), 26 + 26 * Math.cos((i * Math.PI) / 4), 0];
const rowPoints = [0, 2, 4, 6].map((k) => [(k - 3.5) * 8, -7, 0]);
const spot = (c, weight = 150) => ({ x: c.x, y: c.y, weight, area: 60 });

function view(elev, azim, rnd, noise = 0.6) {
  const cam = cameraAt(elev, azim, 380);
  const img = (P) => { const q = project(cam, P); return { x: q.x + (rnd() - 0.5) * 2 * noise, y: q.y + (rnd() - 0.5) * 2 * noise }; };
  return { ring: (ids) => ids.map((i) => spot(img(ringPoint(i)))), row: rowPoints.map((p) => spot(img(p))) };
}
const rowLine = (row) => ({ p: row[0], q: row[3] });
const same = (chosen, expected) => chosen.length === 4 && expected.every((e) => chosen.includes(e));

test('the 4 arcs NE SE SW NW are picked out of random spots, from any side and height, and the row is parallel to two sides', () => {
  const rnd = rng(5);
  for (let trial = 0; trial < 60; trial++) {
    const elev = 20 + rnd() * 70, azim = rnd() * 360;
    const v = view(elev, azim, rnd), four = v.ring([1, 3, 5, 7]);
    const noise = Array.from({ length: 8 }, () => ({ x: 100 + rnd() * 1000, y: 60 + rnd() * 600, weight: 40 + rnd() * 80, area: 30 }));
    const r = pickSquare([...noise, ...four], { rowLine: rowLine(v.row) });
    assert.ok(r.full && same(r.chosen, four), `trial ${trial} (elevation ${elev.toFixed(0)}, azimuth ${azim.toFixed(0)})`);
    assert.ok(r.vanishing.residual < 0.05, `trial ${trial}: residual ${r.vanishing.residual.toFixed(4)}`);
  }
});

test('the arcs N E S W make a square turned by 45 degrees to the row: the residual says so', () => {
  const rnd = rng(8);
  let diag = 0, card = 0, n = 0;
  for (let trial = 0; trial < 40; trial++) {
    const v = view(45 + rnd() * 45, rnd() * 360, rnd);
    const d = pickSquare(v.ring([1, 3, 5, 7]), { rowLine: rowLine(v.row) }), c = pickSquare(v.ring([0, 2, 4, 6]), { rowLine: rowLine(v.row) });
    assert.ok(d.full && c.full);
    diag += d.vanishing.residual; card += c.vanishing.residual; n++;
    assert.ok(c.vanishing.residual > 0.15, `trial ${trial}: ${c.vanishing.residual.toFixed(3)}`);
  }
  assert.ok(card / n > 10 * (diag / n), `mean residual: NE SE SW NW ${(diag / n).toFixed(4)}, N E S W ${(card / n).toFixed(3)}`);
});

test('without the row it still finds the quadrilateral, and says nothing about parallelism', () => {
  const rnd = rng(2), v = view(60, 30, rnd);
  const four = v.ring([1, 3, 5, 7]);
  const r = pickSquare(four);
  assert.ok(same(r.chosen, four));
  assert.equal(r.vanishing, null);
  assert.equal(r.sides.length, 4);
});

test('the corners come back in order around the shape', () => {
  const rnd = rng(3), v = view(70, 200, rnd), four = v.ring([1, 3, 5, 7]);
  const r = pickSquare([four[2], four[0], four[3], four[1]]);
  // consecutive corners are neighbours: each side is shorter than the diagonals
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(Math.max(...r.sides) < Math.min(d(r.chosen[0], r.chosen[2]), d(r.chosen[1], r.chosen[3])) * 1.01);
});

test('what is not a square is not taken: a point inside a triangle, almost collinear points, a cluster too small', () => {
  const p = (x, y) => ({ x, y, weight: 100, area: 30 });
  assert.equal(pickSquare([p(100, 100), p(300, 100), p(200, 300), p(200, 160)]).chosen.length, 0, 'not convex');
  assert.equal(pickSquare([p(100, 100), p(200, 104), p(300, 99), p(400, 103)]).chosen.length, 0, 'in a row');
  assert.equal(pickSquare([p(100, 100), p(103, 100), p(103, 103), p(100, 103)]).chosen.length, 0, 'sides under 6 px');
  assert.equal(pickSquare([p(100, 100), p(200, 100), p(150, 150)]).chosen.length, 0, 'three spots');
  assert.equal(pickSquare([p(100, 100), p(400, 100), p(400, 140), p(100, 140)]).chosen.length, 0, 'a long rectangle, sides 300 and 40: a square is never seen that flat');
});

test('a square seen very obliquely (15 degrees) is still one', () => {
  const rnd = rng(6);
  for (const azim of [0, 45, 90, 135]) {
    const v = view(15, azim, rnd, 0.3), four = v.ring([1, 3, 5, 7]);
    const r = pickSquare(four);
    assert.ok(r.full, `azimuth ${azim}`);
  }
});

test('preferParallel puts a square whose sides are parallel to the row before a stronger one that is turned 45 degrees; by default it does not', () => {
  const sq = (cx, cy, s, w, turn) => [0, 1, 2, 3].map((k) => { const a = turn + (k * Math.PI) / 2; return { x: cx + s * Math.cos(a), y: cy + s * Math.sin(a), weight: w, area: 40 }; });
  const parallel = sq(200, 300, 40, 100, Math.PI / 4), turned = sq(500, 300, 40, 120, 0);     // sides along the axes / along the diagonals
  const row = { p: { x: 0, y: 100 }, q: { x: 300, y: 100 } };
  assert.ok(same(pickSquare([...parallel, ...turned], { rowLine: row }).chosen, turned), 'the strongest by default');
  const r = pickSquare([...parallel, ...turned], { rowLine: row, preferParallel: true });
  assert.ok(same(r.chosen, parallel));
  assert.ok(r.vanishing.residual < 0.01);
});

test('the strongest of two squares wins', () => {
  const sq = (x, y, s, w) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]].map(([a, b]) => ({ x: a, y: b, weight: w, area: 40 }));
  const weak = sq(100, 100, 60, 50), strong = sq(400, 300, 60, 140);
  assert.ok(same(pickSquare([...weak, ...strong]).chosen, strong));
});

test('speed with 16 candidates (reported, loosely bounded)', () => {
  const rnd = rng(9);
  const spots = Array.from({ length: 40 }, () => ({ x: rnd() * 700, y: rnd() * 500, weight: 40 + rnd() * 100, area: 30 }));
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) pickSquare(spots, { rowLine: { p: { x: 10, y: 10 }, q: { x: 200, y: 40 } } });
  const ms = (performance.now() - t0) / 20;
  console.log(`  square filter, 40 spots (16 tried): ${ms.toFixed(2)} ms`);
  assert.ok(ms < 50);
});

// ---- three of the four corners found -------------------------------------------------------------------------------------
import { completeSquare } from '../src/square.js';
import { discWindow } from '../src/layout.js';

test('with 3 of the 4 arcs found, one of the hypotheses puts the fourth within a third of a side of where it is, from any side and height', () => {
  const rnd = rng(21);
  let first = 0;
  for (let trial = 0; trial < 300; trial++) {
    const v = view(20 + rnd() * 70, rnd() * 360, rnd, 0.5);
    const four = v.ring([1, 3, 5, 7]);
    const missing = trial % 4, three = four.filter((_, i) => i !== missing);
    const noise = Array.from({ length: 6 }, () => ({ x: 100 + rnd() * 1000, y: 60 + rnd() * 600, weight: 30 + rnd() * 60, area: 30 }));
    const r = completeSquare([...noise, ...three]);
    assert.ok(r, `trial ${trial}`);
    assert.ok(three.every((p) => r.chosen.includes(p)), `trial ${trial}: the three that were found`);
    const errs = r.hypotheses.map((h) => Math.hypot(h.predicted.x - four[missing].x, h.predicted.y - four[missing].y) / h.side);
    assert.ok(Math.min(...errs) < 0.35, `trial ${trial}: hypotheses ${errs.map((e) => e.toFixed(2)).join(', ')} sides away`);
    if (errs[0] < 0.35) first++;
  }
  assert.ok(first >= 250, `the likeliest hypothesis is the right one in ${first} of 300 (the page tries them all)`);
});

test('three spots that are not three corners of a square give nothing: in a row, a very flat angle, two sides of very different length, blobs of different sizes', () => {
  const p = (x, y, a = 40) => ({ x, y, weight: 100, area: a });
  assert.equal(completeSquare([p(100, 100), p(200, 102), p(300, 99)]), null, 'in a row');
  assert.equal(completeSquare([p(100, 100), p(200, 100), p(110, 120)]), null, 'a sharp angle');
  assert.equal(completeSquare([p(100, 100), p(110, 100), p(110, 330)]), null, 'one side 23 times the other');
  assert.equal(completeSquare([p(100, 100, 10), p(200, 100, 400), p(200, 200, 10)]), null, 'one blob 40 times the others');
  assert.equal(completeSquare([p(100, 100), p(200, 100)]), null, 'two spots');
});

test('the disc window is where the missing corner is expected: inside, box and outline', () => {
  const w = discWindow({ x: 50, y: 60 }, 10);
  assert.ok(w.inside({ x: 55, y: 64 }));
  assert.ok(!w.inside({ x: 70, y: 60 }));
  assert.deepEqual([w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1].map(Math.round), [40, 50, 60, 70]);
});
