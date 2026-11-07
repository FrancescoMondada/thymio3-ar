import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, expectedPoints } from '../src/tracker.js';
import { applyH } from '../src/homography.js';
import { makeScene } from './evidence_scene.js';

const T0 = 1000;
// a hand-held camera: height 45-65 deg, side swinging +-20 deg, distance 300 mm, all slowly; `speed` scales how fast
const swayPath = ({ speed = 1, dist = 300, elev0 = 55 } = {}) => (t) => ({ elev: elev0 + 10 * Math.sin((t / 1000) * 0.9 * speed), azim: 100 + 20 * Math.sin((t / 1000) * 1.3 * speed), dist: typeof dist === 'function' ? dist(t) : dist });

// runs the tracker on a scene; `found` (what locate.js picks, once per picture in the page) is given when `refound` says so: here at every picture,
// the tracker only uses it when it has no map
function run(scene, { frames = 150, fps = 25, jitter = 8, refound = () => true, blankFrom = Infinity, blankTo = Infinity, group = 0, circle = 1, seed = 5 } = {}) {
  const tr = new Tracker(), out = [];
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < frames; i++) {
    const t = T0 + (1000 * i) / fps + (rnd() - 0.5) * jitter;
    const f = scene.frame(t);
    const maps = i >= blankFrom && i < blankTo ? { green: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)], amber: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)] } : f.maps;
    const r = tr.update({ maps, w: f.w, h: f.h, group, circle, found: i === 0 || refound(i) ? scene.found(t) : null, motion: 8 });
    // how far the predicted places are from the true ones
    let err = NaN;
    if (r.H) {
      const pts = expectedPoints({ group, circle, mirror: tr.mirror || 1 }), truth = [...f.truth.row, ...f.truth.ring];
      err = Math.max(...pts.map((p, j) => { const q = applyH(r.H, p.X, p.Y); return Math.hypot(q.x - truth[j].x, q.y - truth[j].y); }));
    }
    out.push({ ...r, err, t, i });
  }
  return { out, tr };
}
const share = (out, test, from = 5) => out.filter((o) => o.i >= from).filter(test).length / out.filter((o) => o.i >= from).length;

test('it acquires the map from the square of arcs and the row, whichever corner the square starts at, and the places it predicts are the true ones', () => {
  for (const shift of [0, 1, 2, 3]) {
    const scene = makeScene({ path: swayPath() }), tr = new Tracker();
    const f = scene.frame(T0);
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: scene.found(T0, { shift }), motion: 0 });
    assert.ok(r.tracking, `shift ${shift}`);
    const pts = expectedPoints({ group: 0, circle: 1, mirror: tr.mirror });
    const truth = [...f.truth.row, ...f.truth.ring];
    const err = Math.max(...pts.map((p, j) => { const q = applyH(r.H, p.X, p.Y); return Math.hypot(q.x - truth[j].x, q.y - truth[j].y); }));
    assert.ok(err < 2.5, `shift ${shift}: the worst of the 8 places is ${err.toFixed(1)} px off`);
    assert.equal(r.state, 'acquire');
  }
});

test('the layout of the row (which end is LED 0) is found, and kept: it is a property of the robot', () => {
  for (const mirror of [1, -1]) {
    const scene = makeScene({ path: swayPath(), mirror }), tr = new Tracker();
    const f = scene.frame(T0);
    tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: scene.found(T0), motion: 0 });
    assert.equal(tr.mirror, mirror, `layout ${mirror}`);
    tr.reset();
    assert.equal(tr.mirror, mirror, 'a reset does not forget it');
  }
});

test('tracking through a hand that sways, from one acquisition: all 8 answer in nearly every picture, and the places stay within a few px of the true ones', () => {
  // (the ring lit gives the whole map, the row lit a shift only: between two ring pictures the places drift by up to 4 px, at most 7 here)
  for (const [fps, jitter] of [[25, 8], [12, 20]]) {
    const { out } = run(makeScene({ path: swayPath() }), { fps, jitter, frames: 8 * fps });
    assert.ok(share(out, (o) => o.complete) >= 0.97, `${fps} pictures a second: ${(100 * share(out, (o) => o.complete)).toFixed(0)} % complete`);
    assert.ok(share(out, (o) => o.err < 6) >= 0.93, `${fps}: the places are within 6 px in ${(100 * share(out, (o) => o.err < 6)).toFixed(0)} %`);
    assert.ok(Math.max(...out.map((o) => o.err).filter(Number.isFinite)) < 10, 'never far off');
    assert.ok(out.filter((o) => o.i > 0).every((o) => o.state !== 'acquire'), 'one acquisition only: the map is tracked, not found again');
  }
});

test('a faster hand (one and a half times the speed): tracked, the places a little less exact', () => {
  const { out } = run(makeScene({ path: swayPath({ speed: 1.5 }) }), { frames: 200 });
  assert.ok(share(out, (o) => o.tracking) >= 0.97, `${(100 * share(out, (o) => o.tracking)).toFixed(0)} % tracked`);
  assert.ok(share(out, (o) => o.complete) >= 0.9, `${(100 * share(out, (o) => o.complete)).toFixed(0)} % complete`);
});

test('three arcs and the row: tracked all the time, the fourth arc (not visible) is still predicted within a few px of where it is', () => {
  const { out } = run(makeScene({ path: swayPath(), dropArcs: [7] }), { frames: 200 });
  const late = out.filter((o) => o.i >= 5);
  assert.ok(late.filter((o) => o.tracking).length / late.length >= 0.99);
  assert.ok(late.filter((o) => o.ringMatched === 3 && o.rowMatched === 4).length / late.length >= 0.9, 'it does not take a stray blob for the missing arc');
  assert.ok(late.filter((o) => o.err < 8).length / late.length >= 0.95, 'the hidden arc is predicted within 8 px of where it is');
});

test('faint arcs (half their light, under the 80 that the first detector asked): tracked, because a place is asked, not the whole picture; a third is lost in the noise', () => {
  const half = run(makeScene({ path: swayPath(), ringAmp: 50 }), { frames: 200 }).out;
  assert.ok(share(half, (o) => o.complete) >= 0.9, `${(100 * share(half, (o) => o.complete)).toFixed(0)} % complete`);
  assert.ok(share(half, (o) => o.tracking) >= 0.99);
  const third = run(makeScene({ path: swayPath(), ringAmp: 36 }), { frames: 200 }).out;
  assert.ok(share(third, (o) => o.tracking) >= 0.95, 'still tracked, with a map less exact');
});

test('a zoom: the robot twice as near over the sequence, then twice as far: the windows follow the scale, nothing is lost', () => {
  const dist = (t) => 300 - 150 * Math.sin(((t - T0) / 1000) * 0.6);          // 150 to 450 mm
  const { out } = run(makeScene({ path: swayPath({ dist }) }), { frames: 200 });
  assert.ok(share(out, (o) => o.matched >= 7) >= 0.93, `${(100 * share(out, (o) => o.matched >= 7)).toFixed(0)} % with at least 7 answering`);
  assert.ok(Math.max(...out.map((o) => o.scale)) > 1.8 * Math.min(...out.filter((o) => o.scale > 0).map((o) => o.scale)), 'the scale it reports follows the zoom');
});

test('strong blobs elsewhere (stronger than the true ones) do not pull it: only what is at the predicted places counts', () => {
  const { out } = run(makeScene({ path: swayPath(), distractors: 6, distractorAmp: 230 }));
  // (six blobs of 230 on each map, twice the strength of the LEDs: about one picture in ten has the place of one of the 8 taken)
  assert.ok(share(out, (o) => o.complete) >= 0.83, `${(100 * share(out, (o) => o.complete)).toFixed(0)} %`);
  assert.ok(share(out, (o) => o.tracking) >= 0.98);
  assert.ok(share(out, (o) => o.err < 10) >= 0.93);
});

test('the lights vanish for a second: the map is kept a few pictures, then lost; given the sets again, it is acquired again', () => {
  const { out } = run(makeScene({ path: swayPath() }), { frames: 160, blankFrom: 40, blankTo: 70, refound: (i) => i === 0 || i === 90 });
  assert.ok(out[41].state === 'coast' || out[41].state === 'lost');
  assert.ok(out.slice(55, 70).every((o) => o.state === 'lost'), 'lost');
  assert.equal(out[90].state, 'acquire', 'acquired again');
  assert.ok(out.slice(95).filter((o) => o.complete).length / out.slice(95).length >= 0.9);
});

test('without the ring, or without the row, there is nothing to track: the row alone is on a line and fixes no map', () => {
  const scene = makeScene({ path: swayPath(), circle: -1 }), tr = new Tracker();
  const f = scene.frame(T0);
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: -1, found: { ring: null, row: [] }, motion: 0 });
  assert.equal(r.state, 'idle');
  assert.equal(r.tracking, false);
});

test('a found square whose row does not fall on the spots seen is not taken for the robot', () => {
  const scene = makeScene({ path: swayPath() }), tr = new Tracker();
  const f = scene.frame(T0), found = scene.found(T0);
  found.row = found.row.map((p) => ({ ...p, x: p.x + 80, y: p.y - 60 }));                // spots of a row that is somewhere else
  const r = tr.update({ maps: { green: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)], amber: f.maps.amber }, w: f.w, h: f.h, group: 0, circle: 1, found, motion: 0 });
  assert.equal(r.tracking, false);
});

// ---- starting from three arcs ---------------------------------------------------------------------------------------------------
import { completeSquare } from '../src/square.js';

test('the map can start from three arcs and the row: the fourth corner is one of the hypotheses of the completion, the pictures say which', () => {
  const scene = makeScene({ path: swayPath(), dropArcs: [7] }), tr = new Tracker();
  const f = scene.frame(T0), full = scene.found(T0);
  const three = full.ring.filter((_, i) => i !== 1);
  const part = completeSquare(three.map((p) => ({ ...p, weight: 100, area: 40 })));
  assert.ok(part, 'a triple of corners');
  const around = (pts) => { const cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4; return pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); };
  const rings = part.hypotheses.map((h) => around([...part.chosen, h.predicted]));
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: { rings, row: full.row }, motion: 0 });
  assert.ok(r.tracking, 'acquired from three arcs');
  const pts = expectedPoints({ group: 0, circle: 1, mirror: tr.mirror }), truth = [...f.truth.row, ...f.truth.ring];
  const err = Math.max(...pts.map((p, j) => { const q = applyH(r.H, p.X, p.Y); return Math.hypot(q.x - truth[j].x, q.y - truth[j].y); }));
  assert.ok(err < 8, `the worst place is ${err.toFixed(1)} px off (the hidden arc was predicted by the completion)`);
  assert.equal(r.ringMatched, 3);
});
