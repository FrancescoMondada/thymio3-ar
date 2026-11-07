import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING, ring, legoPoint, rowName, rowScale, ringScale, ringMeanScale, ringWindowFromRow, rowWindowFromRing, scalesAgree, SQUARE_SIDE, ringDistance } from '../src/layout.js';
import { cameraAt, project, ledPositions } from '../src/demo.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// A camera at any height, side and distance (200 to 800 mm: a zoom of 4) sees the 8 arcs and the LEDs of the 4 groups.
function view(rnd, { minElev = 20, near = 200, far = 800 } = {}) {
  const dist = near + rnd() * (far - near), cam = cameraAt(minElev + rnd() * (90 - minElev), rnd() * 360, dist);
  const img = (P) => { const q = project(cam, [P[0], P[1], 0]); return { x: q.x + (rnd() - 0.5) * 1.2, y: q.y + (rnd() - 0.5) * 1.2, z: q.z }; };
  const rowOf = (g) => {
    const name = rowName(g), pts = [0, 2, 4, 6].map((j) => img(legoPoint(name, j + (g % 2))));
    const u = { x: pts[3].x - pts[0].x, y: pts[3].y - pts[0].y };
    return pts.sort((a, b) => (a.x * u.x + a.y * u.y) - (b.x * u.x + b.y * u.y));         // ordered along the line, as pickAligned gives them
  };
  const ringOf = (diag) => {
    const ids = diag ? [1, 3, 5, 7] : [0, 2, 4, 6];
    const pts = ids.map((i) => img(ring(i)));
    const cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4;
    return pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));        // ordered around, as pickSquare gives them
  };
  return { cam, dist, elev: Math.asin(cam.pos[2] / dist) * 180 / Math.PI, img, rowOf, ringOf };
}

test('the geometry agrees with the photo: arcs, distance from the ring to the rows, the square', () => {
  assert.equal(RING.r, 26);
  assert.ok(Math.abs(SQUARE_SIDE - 36.77) < 0.01);
  assert.equal(ringDistance(0), 33);
  assert.equal(ringDistance(2), 41);
  const [x1, y1] = ring(1), [x7, y7] = ring(7);
  assert.ok(Math.abs(Math.hypot(x1 - x7, y1 - y7) - SQUARE_SIDE) < 1e-9);
  assert.ok(Math.abs(y1 - y7) < 1e-9, 'NE and NW at the same height: a side of the square parallel to the rows');
  // the same world as the simulated scene
  assert.deepEqual(ledPositions().slice(0, 2), [[-28, -7, 0], [-20, -7, 0]]);
  assert.deepEqual(legoPoint('front', 0), [-28, -7]);
});

test('the scale found from a row, and from a square, is the scale of the picture, at any height, side and zoom', () => {
  const rnd = rng(4);
  for (let trial = 0; trial < 120; trial++) {
    const v = view(rnd), ppm = 1000 / v.dist;                      // px per mm at the middle of the picture
    const rs = rowScale(v.rowOf(trial % 4)), qs = ringScale(v.ringOf(true));
    // along the row the scale is squashed by sin(elevation) when the camera looks along it: between sin(20 deg) = 0.34 and 1
    assert.ok(rs > 0.3 * ppm && rs < 1.25 * ppm, `row: ${rs.toFixed(3)} against ${ppm.toFixed(3)} px/mm`);
    assert.ok(qs > 0.6 * ppm && qs < 1.25 * ppm, `ring: ${qs.toFixed(3)} against ${ppm.toFixed(3)} px/mm`);
  }
});

test('three of the four spots of the row give the same scale (at least two are neighbours)', () => {
  const rnd = rng(6), v = view(rnd, { minElev: 60 }), row = v.rowOf(0), full = rowScale(row);
  for (const skip of [0, 1, 2, 3]) {
    const three = row.filter((_, i) => i !== skip);
    assert.ok(Math.abs(rowScale(three) - full) / full < 0.12, `without spot ${skip}`);
  }
  assert.ok(Number.isNaN(rowScale(row.slice(0, 2))));
});

test('from the row, every arc of both squares is inside the window, for the 4 groups, at 15 to 90 degrees and at 4 zooms', () => {
  const rnd = rng(7);
  for (let trial = 0; trial < 300; trial++) {
    const v = view(rnd, { minElev: 15 }), g = trial % 4;
    // with the phone's tilt, and with none at all
    for (const elevDeg of [v.elev + (rnd() - 0.5) * 20, NaN]) {
      const w = ringWindowFromRow(v.rowOf(g), g, { elevDeg });
      assert.ok(w, `trial ${trial}`);
      for (const diag of [true, false]) for (const p of v.ringOf(diag)) assert.ok(w.inside(p), `trial ${trial} (group ${g}, elevation ${v.elev.toFixed(0)}, tilt ${elevDeg.toFixed?.(0)}, distance ${v.dist.toFixed(0)}): an arc is outside`);
    }
  }
});

test('from the ring, every LED of the 4 groups is inside the window', () => {
  const rnd = rng(8);
  for (let trial = 0; trial < 300; trial++) {
    const v = view(rnd, { minElev: 15 }), diag = trial % 2 === 0;
    for (let g = 0; g < 4; g++) {
      const w = rowWindowFromRing(v.ringOf(diag), g);
      assert.ok(w);
      for (const p of v.rowOf(g)) assert.ok(w.inside(p), `trial ${trial}, group ${g}, distance ${v.dist.toFixed(0)}: an LED is outside`);
    }
  }
});

test('the windows are not everywhere when the camera is well above the table (from 50 degrees): a spot anywhere in the picture is accepted less often than a true one (the row window was widened after the 7th phone test: a margin of 30 degrees on the tilt)', () => {
  const rnd = rng(9);
  let fromRow = 0, fromRing = 0, n = 0;
  for (let trial = 0; trial < 200; trial++) {
    const v = view(rnd, { minElev: 50, near: 250, far: 700 }), g = trial % 4;
    const wr = ringWindowFromRow(v.rowOf(g), g, { elevDeg: v.elev }), wq = rowWindowFromRing(v.ringOf(true), g);
    for (let k = 0; k < 40; k++) {
      const p = { x: rnd() * 1280, y: rnd() * 720 };
      n++; if (wr.inside(p)) fromRow++; if (wq.inside(p)) fromRing++;
    }
  }
  assert.ok(fromRow / n < 0.6, `from the row: ${(100 * fromRow / n).toFixed(0)} % of random spots accepted`);
  assert.ok(fromRing / n < 0.3, `from the ring: ${(100 * fromRing / n).toFixed(0)} % of random spots accepted`);
});

test('the scale of the row and the scale of the ring agree within 0.4 to 2.5 whenever the camera is above 20 degrees', () => {
  const rnd = rng(10);
  let bad = 0;
  for (let trial = 0; trial < 300; trial++) {
    const v = view(rnd, { minElev: 20 }), g = trial % 4;
    const a = scalesAgree(rowScale(v.rowOf(g)), ringMeanScale(v.ringOf(true)));
    if (!a.ok) bad++;
  }
  assert.ok(bad <= 3, `${bad} of 300 views disagree`);
  assert.equal(scalesAgree(NaN, 1), null);
  assert.equal(scalesAgree(1, 10).ok, false, 'a ring ten times too small for the row is not the same robot');
});

test('the windows come with what the page needs: a box round them, an outline to draw, sizes in px from the scale', () => {
  const rnd = rng(11), v = view(rnd, { minElev: 40, near: 300, far: 300 });
  const w = ringWindowFromRow(v.rowOf(0), 0), q = rowWindowFromRing(v.ringOf(true), 0);
  for (const win of [w, q]) {
    assert.ok(win.outline.length >= 4);
    assert.ok(win.bbox.x1 > win.bbox.x0 && win.bbox.y1 > win.bbox.y0);
    for (const p of win.outline) assert.ok(p.x >= win.bbox.x0 - 1e-6 && p.x <= win.bbox.x1 + 1e-6);
    assert.ok(win.minSide > 0 && win.minGap > 0);
    assert.ok(Math.abs(win.minSide - 0.2 * SQUARE_SIDE * win.s) < 1e-9);
  }
  // twice as far: the same window, twice as small
  const far = view(rng(11), { minElev: 40, near: 600, far: 600 });
  assert.ok(ringWindowFromRow(far.rowOf(0), 0).s < 0.7 * w.s);
});

// ---- the geometry of the windows themselves (a bug here went unseen for 6 tests: the outline and the box round it were wrong) ------------------
import { discWindow } from '../src/layout.js';

const distToSegment = (p, a, b) => {
  const abx = b.x - a.x, aby = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
};
const convex = (poly) => {
  const signs = new Set();
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const t = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(t) > 1e-9) signs.add(Math.sign(t));
  }
  return signs.size === 1;
};

test('the outline of the window from the row is a stadium: convex, every point at the distance D from the segment, and it bulges beyond the ends of the row', () => {
  const rnd = rng(31);
  for (let trial = 0; trial < 60; trial++) {
    const a = rnd() * 2 * Math.PI, gap = 8 + rnd() * 40, x0 = 100 + rnd() * 400, y0 = 100 + rnd() * 400;
    const row = [0, 1, 2, 3].map((k) => ({ x: x0 + Math.cos(a) * gap * k, y: y0 + Math.sin(a) * gap * k }));
    const w = ringWindowFromRow(row, trial % 4, { elevDeg: 40 + rnd() * 50 });
    const m = { x: x0 + Math.cos(a) * gap * 1.5, y: y0 + Math.sin(a) * gap * 1.5 }, half = 60 * (gap / 16);
    const A = { x: m.x - Math.cos(a) * half, y: m.y - Math.sin(a) * half }, B = { x: m.x + Math.cos(a) * half, y: m.y + Math.sin(a) * half };
    const Dpx = w.D * (gap / 16);
    assert.ok(convex(w.outline), `trial ${trial}: convex`);
    for (const p of w.outline) assert.ok(Math.abs(distToSegment(p, A, B) - Dpx) < 0.01 * Dpx + 0.01, `trial ${trial}: an outline point is ${distToSegment(p, A, B).toFixed(1)} from the segment, D is ${Dpx.toFixed(1)}`);
    // beyond the ends: the box reaches D past each end of the row along it
    const along = (p) => (p.x - m.x) * Math.cos(a) + (p.y - m.y) * Math.sin(a);
    assert.ok(Math.max(...w.outline.map(along)) > half + 0.95 * Dpx, `trial ${trial}: the outline goes D beyond the end B`);
    assert.ok(Math.min(...w.outline.map(along)) < -half - 0.95 * Dpx, `trial ${trial}: and beyond the end A`);
  }
});

test('every point that is inside a window is inside its box (the look with a lower threshold only searches the box): all three windows', () => {
  const rnd = rng(32);
  for (let trial = 0; trial < 40; trial++) {
    const v = view(rnd, { minElev: 20 }), g = trial % 4;
    const windows = [ringWindowFromRow(v.rowOf(g), g, { elevDeg: v.elev }), rowWindowFromRing(v.ringOf(trial % 2 === 0), g), discWindow({ x: 400 + rnd() * 400, y: 200 + rnd() * 300 }, 10 + rnd() * 60)];
    for (const w of windows) {
      let hits = 0;
      for (let k = 0; k < 4000; k++) {
        const p = { x: -400 + rnd() * 2400, y: -400 + rnd() * 1600 };
        if (w.inside(p)) { hits++; assert.ok(p.x >= w.bbox.x0 - 1e-6 && p.x <= w.bbox.x1 + 1e-6 && p.y >= w.bbox.y0 - 1e-6 && p.y <= w.bbox.y1 + 1e-6, `${w.kind}, trial ${trial}: (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) is inside the window but outside its box`); }
      }
      assert.ok(hits > 0 || w.kind === 'disc', `${w.kind}: the sample hit the window`);
    }
  }
});

test('the box of the window from the row is the box of the true stadium, not the band between the ends of the row (top-down, vertical row)', () => {
  const row = [0, 1, 2, 3].map((k) => ({ x: 315, y: 400 + 15 * k }));
  const w = ringWindowFromRow(row, 0, { elevDeg: 82 });
  const Dpx = w.D * 15 / 16, half = 60 * 15 / 16, mid = 422.5;
  assert.ok(Math.abs(w.bbox.x0 - (315 - Dpx)) < 1 && Math.abs(w.bbox.x1 - (315 + Dpx)) < 1);
  assert.ok(Math.abs(w.bbox.y0 - (mid - half - Dpx)) < 1 && Math.abs(w.bbox.y1 - (mid + half + Dpx)) < 1, `y from ${w.bbox.y0.toFixed(0)} to ${w.bbox.y1.toFixed(0)}`);
});
