import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, expectedPoints } from '../src/tracker.js';
import { applyH } from '../src/homography.js';
import { makeDualScene } from './dual_scene.js';

// The dual flash (leds_lego.py GROUP 4, CIRCLE 2): each flash has a row AND a ring set, so each flash alone gives the whole map.
const T0 = 1000;
const GROUP = 4, CIRCLE = 2;
const path = ({ dist = 480 } = {}) => (t) => ({ elev: 55 + 10 * Math.sin((t / 1000) * 0.5) + 3 * Math.sin((t / 1000) * 1.7), azim: 100 + 25 * Math.sin((t / 1000) * 0.7), dist: dist * (1 + 0.1 * Math.sin((t / 1000) * 0.3)) });
const swayShift = (sway) => (t) => ({ x: sway * Math.sin((2 * Math.PI * 0.6 * t) / 1000), y: 0.5 * sway * Math.sin((2 * Math.PI * 0.6 * t) / 1000 + 1) });
const ids = (mirror = 1) => expectedPoints({ group: GROUP, circle: CIRCLE, mirror });

// id by id against where the 16 places really are
function placeError(r, tr, f) {
  if (!r.H) return NaN;
  return Math.max(...ids(tr.mirror || 1).map((p) => { const q = applyH(r.H, p.X, p.Y), t = f.truth[p.id]; return Math.hypot(q.x - t.x, q.y - t.y); }));
}

function run(scene, { frames = 14 * 30, fps = 14, jitter = 30, rotate = false, holeSquare = 0, seed = 5, tracker = null } = {}) {
  const tr = tracker || new Tracker(), out = [];
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < frames; i++) {
    const t = T0 + (1000 * i) / fps + (rnd() - 0.5) * jitter, f = scene.frame(t);
    let replace = [];
    if (holeSquare && rnd() < holeSquare) { const hole = scene.holes.find((q) => q.set === 'ring' && q.phase === scene.phaseAt(t)), hp = scene.holePx(t, hole); replace = [{ index: Math.floor(rnd() * 4), x: hp.x, y: hp.y }]; }
    const found = scene.found(t, { noise: 0.6, rot: rotate ? Math.floor(rnd() * 4) : 0, replace });
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found, motion: 8, t });
    out.push({ ...r, err: placeError(r, tr, f), t, i, truthPhase: f.phase });
  }
  return { out, tr };
}
const share = (out, test, from = 14) => out.filter((o) => o.i >= from).filter(test).length / out.filter((o) => o.i >= from).length;
const pct = (x) => `${(100 * x).toFixed(0)} %`;
const acquisitions = (out) => out.filter((o) => o.state === 'acquire').length;

test('a map from ONE picture: the row and the ring are lit in the same flash, the square says the map up to its turn, the row says which flash, which turn and which layout', () => {
  for (const mirror of [1, -1]) for (const rot of [0, 1, 2, 3]) for (const t0 of [T0, T0 + 205]) {        // (the two flashes: the front row + N E S W, then the back row + NE SE SW NW)
    const scene = makeDualScene({ path: path(), mirror }), tr = new Tracker(), f = scene.frame(t0);
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: scene.found(t0, { rot }), motion: 0, t: t0 });
    assert.equal(r.state, 'acquire', `mirror ${mirror}, turn ${rot}, flash ${f.phase}`);
    assert.equal(r.pending, false, 'nothing to wait for: the row was in the same picture');
    assert.equal(r.phase, f.phase, 'which flash is lit');
    assert.equal(tr.mirror, mirror, 'the layout of the row');
    assert.ok(placeError(r, tr, f) < 3.5, `the 16 places within ${placeError(r, tr, f).toFixed(1)} px, at once`);
  }
});

test('the 16 places are expected: 8 per flash, the rows and the arcs, each with its set and its phase', () => {
  const pts = ids();
  assert.equal(pts.length, 16);
  for (const phase of [0, 1]) {
    const mine = pts.filter((p) => p.phase === phase);
    assert.equal(mine.length, 8);
    assert.equal(mine.filter((p) => p.set === 'row').length, 4);
    assert.equal(mine.filter((p) => p.set === 'ring').length, 4);
  }
  assert.deepEqual(pts.filter((p) => p.phase === 0 && p.set === 'ring').map((p) => p.arc), [0, 2, 4, 6]);
  assert.deepEqual(pts.filter((p) => p.phase === 1 && p.set === 'ring').map((p) => p.arc), [1, 3, 5, 7]);
  assert.ok(pts.filter((p) => p.key === 'rowF').every((p) => p.Y === -7) && pts.filter((p) => p.key === 'rowB').every((p) => p.Y === -15));
  assert.equal(new Set(pts.map((p) => p.id)).size, 16, 'ids are unique');
});

test('tracking through a hand that sways: one acquisition, all the places of the flash that is lit confirmed, the 16 places within a few px, at every flash', () => {
  const { out } = run(makeDualScene({ path: path(), shift: swayShift(50) }));
  assert.equal(acquisitions(out), 1);
  assert.ok(share(out, (o) => o.tracking) >= 0.99, `${pct(share(out, (o) => o.tracking))} tracked`);
  assert.ok(share(out, (o) => o.complete) >= 0.97, `${pct(share(out, (o) => o.complete))} complete`);
  assert.ok(share(out, (o) => o.err < 5) >= 0.95, `within 5 px in ${pct(share(out, (o) => o.err < 5))}`);
  assert.ok(share(out, (o) => o.expected === 8) === 1, 'the counts are those of the 8 points of the flash that is lit');
  assert.ok(share(out, (o) => o.phase === o.truthPhase) >= 0.95, `the flash is known in ${pct(share(out, (o) => o.phase === o.truthPhase))} of the pictures`);
});

test('every flash gives a full fit of the map (row and ring together), not a shift as the row alone did', () => {
  const { out } = run(makeDualScene({ path: path(), shift: swayShift(50) }));
  for (const phase of [0, 1]) {
    const mine = out.filter((o) => o.i >= 14 && o.truthPhase === phase);
    assert.ok(mine.filter((o) => o.diag && o.diag.how === 'fit').length / mine.length >= 0.9, `flash ${phase}: ${pct(mine.filter((o) => o.diag && o.diag.how === 'fit').length / mine.length)} full fits`);
  }
});

test('70 cm away, the hand about 100 px a second, 14 pictures a second: one acquisition, never lost, the places within 6 px', () => {
  const { out } = run(makeDualScene({ path: path({ dist: 700 }), shift: swayShift(80), rowAmp: 60, ringAmp: 200, mirror: -1 }), { frames: 14 * 40 });
  assert.equal(acquisitions(out), 1, `${acquisitions(out)} acquisitions`);
  assert.ok(share(out, (o) => o.tracking) >= 0.99);
  assert.ok(share(out, (o) => o.err < 6) >= 0.95, `within 6 px in ${pct(share(out, (o) => o.err < 6))}`);
});

test('lights out of holes in the side of the body, brighter than the LEDs, and squares found with a hole for a corner: the map is not taken, one acquisition', () => {
  const holes = [0, 1].flatMap((phase) => [{ X: 52, Y: 42, Z: -12, set: 'ring', phase, amp: 255 }, { X: 53, Y: -4, Z: -12, set: 'row', phase, amp: 255 }]);
  const scene = makeDualScene({ path: path(), shift: swayShift(50), holes });
  const { out } = run(scene, { frames: 14 * 40, holeSquare: 0.7 });
  assert.equal(acquisitions(out), 1, `${acquisitions(out)} acquisitions`);
  assert.ok(share(out, (o) => o.tracking) >= 0.99);
  assert.ok(share(out, (o) => o.err < 8) >= 0.95, `within 8 px in ${pct(share(out, (o) => o.err < 8))}`);
  assert.ok(share(out, (o) => o.complete) >= 0.9, `${pct(share(out, (o) => o.complete))} complete`);
});

test('two LEDs of the row much dimmer than the others: still one map, the ring all the time', () => {
  const { out } = run(makeDualScene({ path: path({ dist: 330 }), shift: swayShift(50), rowAmp: 90, ringAmp: 180, rowGains: [1, 0.3, 1, 0.3] }));
  assert.equal(acquisitions(out), 1);
  assert.ok(share(out, (o) => o.tracking) >= 0.99);
  assert.ok(share(out, (o) => o.ringConfirmed === 4) >= 0.97);
  assert.ok(share(out, (o) => o.err < 8) >= 0.95, `within 8 px in ${pct(share(out, (o) => o.err < 8))}`);
});

test('a square whose row is nowhere near any of the predicted rows is refused: a row that does not fit, no map', () => {
  const scene = makeDualScene({ path: path() }), tr = new Tracker(), f = scene.frame(T0), found = scene.found(T0);
  found.row = found.row.map((p) => ({ ...p, x: p.x + 90, y: p.y - 70 }));
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found, motion: 0, t: T0 });
  assert.equal(r.tracking, false);
  const none = tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: { rings: found.rings, row: null }, motion: 0, t: T0 + 40 });
  assert.equal(none.tracking, false, 'no row seen: nothing to say which flash, which turn');
});

test('a refused start says why: no square, no row, a row that does not fit', () => {
  const scene = makeDualScene({ path: path() }), f = scene.frame(T0), found = scene.found(T0), mk = () => new Tracker();
  const go = (tr, fd) => tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: fd, motion: 0, t: T0 });
  assert.equal(go(mk(), { rings: [], row: found.row }).acqFail.reason, 'sans carré');
  assert.equal(go(mk(), { rings: found.rings, row: [found.row[0]] }).acqFail.reason, 'sans rangée');
  const far = found.row.map((p) => ({ ...p, x: p.x + 90, y: p.y - 70 }));
  const bad = go(mk(), { rings: found.rings, row: far }).acqFail;
  assert.equal(bad.reason, 'rangée incompatible');
  assert.ok(bad.err > 0.35);
  const empty = go(mk(), { rings: found.rings, row: found.row });          // (a good start: no reason)
  assert.equal(empty.acqFail, null);
  assert.equal(empty.tracking, true);
});

test('the whole picture is searched only for a map that is missing or struggling', () => {
  const scene = makeDualScene({ path: path(), shift: swayShift(40) }), tr = new Tracker();
  assert.equal(tr.wantsFound(T0), true);
  const { out, tr: t2 } = run(scene, { frames: 40, tracker: tr });
  assert.equal(t2.wantsFound(out[out.length - 1].t), false, 'a healthy map: no, even long after the last full fit (the next flash gives one)');
  t2.coast = 3;
  assert.equal(t2.wantsFound(out[out.length - 1].t), true);
});
