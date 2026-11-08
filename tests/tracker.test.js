import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, expectedPoints, slide, validMap } from '../src/tracker.js';
import { applyH, compose } from '../src/homography.js';
import { makeScene } from './evidence_scene.js';

const T0 = 1000;
// a hand-held camera: height 45-65 deg, side swinging +-20 deg, distance 300 mm, all slowly; `speed` scales how fast
const swayPath = ({ speed = 1, dist = 300, elev0 = 55 } = {}) => (t) => ({ elev: elev0 + 10 * Math.sin((t / 1000) * 0.9 * speed), azim: 100 + 20 * Math.sin((t / 1000) * 1.3 * speed), dist: typeof dist === 'function' ? dist(t) : dist });
// the phone's regime (the 8th report): 70 cm away (0.65 px/mm in a picture 640 px long), the picture swaying in the hand: `sway` px (of 1280) each way at 0.6 Hz
const farPath = (t) => ({ elev: 60 + 12 * Math.sin((t / 1000) * 0.15) + 3 * Math.sin((t / 1000) * 0.5), azim: 100 + 30 * Math.sin((t / 1000) * 0.21), dist: 700 * (1 + 0.15 * Math.sin((t / 1000) * 0.09)) });
const swayShift = (sway) => (t) => ({ x: sway * Math.sin((2 * Math.PI * 0.6 * t) / 1000), y: 0.5 * sway * Math.sin((2 * Math.PI * 0.6 * t) / 1000 + 1) });

// where the map puts the 8 places against where they are: id by id (`sets: false`) or each to the nearest true place of its set (the layout of the row, which
// of the two, is not what is asked)
function placeError(r, tr, f, { group = 0, circle = 1, sets = false } = {}) {
  if (!r.H) return NaN;
  const pts = expectedPoints({ group, circle, mirror: tr.mirror || 1 }), truth = [...f.truth.row, ...f.truth.ring];
  return Math.max(...pts.map((p, j) => {
    const q = applyH(r.H, p.X, p.Y);
    return sets ? Math.min(...(p.set === 'row' ? f.truth.row : f.truth.ring).map((tp) => Math.hypot(q.x - tp.x, q.y - tp.y))) : Math.hypot(q.x - truth[j].x, q.y - truth[j].y);
  }));
}

// runs the tracker on a scene; `found` (what locate.js picks, once per picture in the page) is given when `refound` says so; `stale`: the spots of the set
// that is dark are old (the map N), as PairDiff.find gives them
function run(scene, { frames = 150, fps = 25, jitter = 8, refound = () => true, stale = false, blankFrom = Infinity, blankTo = Infinity, group = 0, circle = 1, seed = 5, sets = false, shift = 0, tracker = null } = {}) {
  const tr = tracker || new Tracker(), out = [];
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < frames; i++) {
    const t = T0 + (1000 * i) / fps + (rnd() - 0.5) * jitter;
    const f = scene.frame(t);
    const blank = i >= blankFrom && i < blankTo;
    const maps = blank ? { green: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)], amber: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)] } : f.maps;
    const r = tr.update({ maps, w: f.w, h: f.h, group, circle, found: refound(i) ? scene.found(t, { stale, shift }) : null, motion: 8, t });
    out.push({ ...r, err: placeError(r, tr, f, { group, circle, sets }), t, i });
  }
  return { out, tr };
}
const share = (out, test, from = 25) => out.filter((o) => o.i >= from).filter(test).length / out.filter((o) => o.i >= from).length;
const pct = (x) => `${(100 * x).toFixed(0)} %`;
const acquisitions = (out) => out.filter((o) => o.state === 'acquire').length;

test('the map starts from the ring alone, seen in this picture, and the row says which way round it is: from any corner the square starts at, the places end up the true ones', () => {
  for (const shift of [0, 1, 2, 3]) {
    const { out } = run(makeScene({ path: swayPath() }), { frames: 40, shift });
    const first = out.findIndex((o) => o.state === 'acquire');
    assert.ok(first >= 0 && first < 4, `shift ${shift}: acquired at picture ${first} (the first picture in which the ring is lit)`);
    assert.equal(out[first].pending, true, 'the first map is not turned yet: the row has not been seen');
    assert.equal(out[first].expected, 4, 'only the 4 arcs are asked for until the row has said how the map is turned');
    assert.equal(out[first].complete, false, '4 arcs are not a complete set of 8');
    const done = out.findIndex((o, i) => i > first && !o.pending);
    assert.ok(done > first && done < first + 15, `shift ${shift}: decided after ${done - first} pictures`);
    assert.equal(out[done + 1].expected, 8, 'then all 8 are asked for');
    assert.ok(out.slice(done + 2).every((o) => o.err < 8), `shift ${shift}: the worst of the 8 places is ${Math.max(...out.slice(done + 2).map((o) => o.err)).toFixed(1)} px off`);
  }
});

test('the layout of the row (which end is LED 0) is found, and kept: it is a property of the robot', () => {
  for (const mirror of [1, -1]) {
    const { out, tr } = run(makeScene({ path: swayPath(), mirror }), { frames: 60 });
    assert.equal(tr.mirror, mirror, `layout ${mirror}`);
    assert.ok(out.slice(30).every((o) => o.err < 8), 'the places are the true ones with it');
    tr.reset();
    assert.equal(tr.mirror, mirror, 'a reset does not forget it');
  }
});

test('a ring that is not lit in this picture is not a map: the spots of a set that is dark are old (map N), only fresh corners are taken', () => {
  const scene = makeScene({ path: swayPath() }), tr = new Tracker();
  // a picture in which the row is lit (the ring dark): the corners that locate.js would give come from N and the map P of the amber is empty
  let t = T0 + 100;
  while (!scene.lit(t)) t += 20;
  const f = scene.frame(t);
  assert.ok(scene.lit(t));
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: scene.found(t, { stale: true }), motion: 0, t });
  assert.equal(r.tracking, false);
  assert.equal(r.state, 'lost');
});

test('tracking through a hand that sways, from one acquisition: all 8 are confirmed in nearly every picture, and the places stay within a few px of the true ones', () => {
  for (const [fps, jitter] of [[25, 8], [12, 20]]) {
    const { out } = run(makeScene({ path: swayPath() }), { fps, jitter, frames: 8 * fps });
    assert.ok(share(out, (o) => o.complete) >= 0.97, `${fps} pictures a second: ${pct(share(out, (o) => o.complete))} complete`);
    assert.ok(share(out, (o) => o.err < 6) >= 0.93, `${fps}: the places are within 6 px in ${pct(share(out, (o) => o.err < 6))}`);
    assert.ok(Math.max(...out.slice(25).map((o) => o.err).filter(Number.isFinite)) < 10, 'never far off');
    assert.equal(acquisitions(out), 1, 'one acquisition only: the map is tracked, not found again');
  }
});

test('a faster hand (one and a half times the speed): tracked, the places a little less exact', () => {
  const { out } = run(makeScene({ path: swayPath({ speed: 1.5 }) }), { frames: 200 });
  assert.ok(share(out, (o) => o.tracking) >= 0.97, `${pct(share(out, (o) => o.tracking))} tracked`);
  assert.ok(share(out, (o) => o.complete) >= 0.9, `${pct(share(out, (o) => o.complete))} complete`);
});

test('three arcs and the row: tracked all the time, the fourth arc (not visible) is still predicted within a few px of where it is', () => {
  const { out } = run(makeScene({ path: swayPath(), dropArcs: [7] }), { frames: 200 });
  const late = out.filter((o) => o.i >= 25);
  assert.ok(late.filter((o) => o.tracking).length / late.length >= 0.99);
  assert.ok(late.filter((o) => o.ringMatched >= 3 && o.rowConfirmed === 4).length / late.length >= 0.9, 'it does not take a stray blob for the missing arc');
  assert.ok(late.filter((o) => o.err < 8).length / late.length >= 0.95, 'the hidden arc is predicted within 8 px of where it is');
});

test('faint arcs (half their light, under the 80 that the first detector asked): tracked, because a place is asked, not the whole picture; a third is lost in the noise', () => {
  const half = run(makeScene({ path: swayPath(), ringAmp: 50 }), { frames: 200 }).out;
  assert.ok(share(half, (o) => o.complete) >= 0.9, `${pct(share(half, (o) => o.complete))} complete`);
  assert.ok(share(half, (o) => o.tracking) >= 0.99);
  const third = run(makeScene({ path: swayPath(), ringAmp: 36 }), { frames: 200 }).out;
  assert.ok(share(third, (o) => o.tracking) >= 0.9, 'still tracked, with a map less exact');
});

test('a zoom: the robot twice as near over the sequence, then twice as far: the windows follow the scale, nothing is lost', () => {
  const dist = (t) => 300 - 150 * Math.sin(((t - T0) / 1000) * 0.6);          // 150 to 450 mm
  const { out } = run(makeScene({ path: swayPath({ dist }) }), { frames: 200 });
  assert.ok(share(out, (o) => o.confirmed >= 7) >= 0.93, `${pct(share(out, (o) => o.confirmed >= 7))} with at least 7 confirmed`);
  const scales = out.map((o) => o.scale).filter(Number.isFinite);
  assert.ok(Math.max(...scales) > 1.8 * Math.min(...scales), 'the scale it reports follows the zoom');
});

test('strong blobs elsewhere (stronger than the true ones) do not pull it: only what is at the predicted places counts', () => {
  const { out } = run(makeScene({ path: swayPath(), distractors: 6, distractorAmp: 230 }));
  // (six blobs of 230 on each map, twice the strength of the LEDs: about one picture in ten has the place of one of the 8 taken)
  assert.ok(share(out, (o) => o.complete) >= 0.83, `${pct(share(out, (o) => o.complete))}`);
  assert.ok(share(out, (o) => o.tracking) >= 0.98);
  assert.ok(share(out, (o) => o.err < 10) >= 0.93);
});

test('the lights vanish for a second: the map is kept a few pictures, then lost; given the sets again, it is acquired again, and turned again', () => {
  const { out } = run(makeScene({ path: swayPath() }), { frames: 180, blankFrom: 40, blankTo: 70, refound: (i) => i < 40 || i >= 90 });
  assert.ok(out[41].state === 'coast' || out[41].state === 'lost');
  assert.ok(out.slice(55, 70).every((o) => o.state === 'lost'), 'lost');
  const again = out.findIndex((o, i) => i >= 90 && o.state === 'acquire');
  assert.ok(again >= 90 && again < 96, `acquired again at ${again}`);
  assert.ok(out.slice(again + 15).filter((o) => o.complete).length / out.slice(again + 15).length >= 0.9);
});

test('without the ring, or without the row, there is nothing to track: the row alone is on a line and fixes no map', () => {
  const scene = makeScene({ path: swayPath(), circle: -1 }), tr = new Tracker();
  const f = scene.frame(T0);
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: -1, found: { ring: null, row: [] }, motion: 0 });
  assert.equal(r.state, 'idle');
  assert.equal(r.tracking, false);
});

test('a ring whose row is nowhere to be seen is not taken for the robot for long: the map waits for the row, then is dropped (and never claims 8 places)', () => {
  const scene = makeScene({ path: swayPath(), dropRow: [0, 1, 2, 3] });
  const { out } = run(scene, { frames: 140 });
  assert.ok(out.every((o) => !o.complete), 'never complete');
  assert.ok(out.some((o) => o.lostBy === 'pending'), 'dropped after waiting for the row');
});

// ---- the phone's regime: far, the hand moving about a gap per picture, spots found that are old --------------------------------
test('70 cm away, the picture swaying 80 px each way (about 100 px a second: the hand of the 8th report), 16 pictures a second, spots found that are old: one acquisition, never lost, the places within 6 px', () => {
  const scene = makeScene({ w: 640, path: farPath, rowAmp: 60, ringAmp: 200, mirror: -1, shift: swayShift(80), trail: true });
  const { out } = run(scene, { frames: 16 * 40, fps: 16, jitter: 30, stale: true, sets: true });
  assert.equal(acquisitions(out), 1, `${acquisitions(out)} acquisitions`);
  assert.ok(share(out, (o) => o.tracking) >= 0.99, `${pct(share(out, (o) => o.tracking))} tracked`);
  assert.ok(share(out, (o) => o.err < 6) >= 0.95, `within 6 px in ${pct(share(out, (o) => o.err < 6))}`);
  assert.ok(share(out, (o) => o.complete) >= 0.95, `${pct(share(out, (o) => o.complete))} confirmed`);
});

test('the same with a hand one and a half times as fast (peak about 250 px a second, 15 px a picture): still one map, the places within 8 px', () => {
  const scene = makeScene({ w: 640, path: farPath, rowAmp: 60, ringAmp: 200, mirror: -1, shift: swayShift(120), trail: true });
  const { out } = run(scene, { frames: 16 * 40, fps: 16, jitter: 30, stale: true, sets: true });
  assert.equal(acquisitions(out), 1, `${acquisitions(out)} acquisitions`);
  assert.ok(share(out, (o) => o.tracking) >= 0.97, `${pct(share(out, (o) => o.tracking))} tracked`);
  assert.ok(share(out, (o) => o.err < 8) >= 0.95, `within 8 px in ${pct(share(out, (o) => o.err < 8))}`);
});

test('a map whose shape went wrong (three arcs for a second) is replaced by a full fresh square of arcs, and keeps the way round it had: the row is not asked again', () => {
  const scene = makeScene({ path: swayPath() }), tr = new Tracker();
  const a = run(scene, { frames: 40, tracker: tr });
  assert.equal(acquisitions(a.out), 1);
  const t40 = a.out[39].t;
  tr.H = compose(tr.H, [1, 0, 0, 0, 1, 0, 0.0009, 0, 1]);           // a perspective that is not there: what one wrong fit with three arcs leaves
  tr.ringFullT = t40 - 1200;
  const out = [];
  for (let i = 0; i < 30; i++) {
    const t = t40 + 40 * (i + 1), f = scene.frame(t);
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: scene.found(t), motion: 8, t });
    out.push({ ...r, err: placeError(r, tr, f) });
  }
  assert.ok(out.some((o) => o.refreshed), 'replaced');
  assert.ok(out.every((o) => !o.pending), 'not turned again: it keeps the way round it had');
  assert.ok(out.slice(10).every((o) => o.err < 8), `the places are right again: ${Math.max(...out.slice(10).map((o) => o.err)).toFixed(1)} px`);
});

test('a row of which two LEDs are much dimmer than the other two (the 10th report: two of four confirmed) is still followed: one map, never lost, the ring all the time', () => {
  const scene = makeScene({ w: 640, path: swayPath({ dist: 330 }), rowAmp: 90, ringAmp: 180, rowGains: [1, 0.3, 1, 0.3], shift: swayShift(50), trail: true });
  const { out } = run(scene, { frames: 12 * 30, fps: 12, jitter: 30, stale: true, sets: true });
  assert.equal(acquisitions(out), 1, `${acquisitions(out)} acquisitions`);
  assert.ok(share(out, (o) => o.tracking) >= 0.99, `${pct(share(out, (o) => o.tracking))} tracked`);
  assert.ok(share(out, (o) => o.ringConfirmed === 4) >= 0.97, 'the ring is confirmed');
  assert.ok(share(out, (o) => o.rowConfirmed >= 2) >= 0.95, `at least the 2 bright LEDs of the row are confirmed: ${pct(share(out, (o) => o.rowConfirmed >= 2))}`);
  assert.ok(share(out, (o) => o.err < 8) >= 0.95, `within 8 px in ${pct(share(out, (o) => o.err < 8))}`);
});

test('the tracker keeps statistics per place: how often it answers when its set is lit, and how far from where it was predicted', () => {
  const { tr } = run(makeScene({ path: swayPath() }), { frames: 120 });
  const ids = Object.keys(tr.stats);
  assert.equal(ids.length, 8);
  for (const id of ids) assert.ok(tr.stats[id].lit > 20 && tr.stats[id].hit / tr.stats[id].lit > 0.9, `${id}: ${tr.stats[id].hit}/${tr.stats[id].lit}`);
});

test('a light that comes out of a hole in the side of the body (brighter than the arcs, a few px from one of them in the picture) is not taken for an arc, nor for a LED of the row', () => {
  const farPath2 = (t) => ({ elev: 50 + 10 * Math.sin((t / 1000) * 0.5) + 3 * Math.sin((t / 1000) * 1.7), azim: 100 + 25 * Math.sin((t / 1000) * 0.7), dist: 480 * (1 + 0.1 * Math.sin((t / 1000) * 0.3)) });
  const scene = makeScene({ w: 640, path: farPath2, rowAmp: 90, ringAmp: 150, shift: swayShift(50), trail: true, holes: [{ X: 52, Y: 42, Z: -12, set: 'ring', amp: 255 }, { X: 53, Y: -4, Z: -12, set: 'row', amp: 255 }] });
  const { out } = run(scene, { frames: 14 * 40, fps: 14, jitter: 30, stale: true, sets: true });
  assert.ok(share(out, (o) => o.tracking) >= 0.97, `${pct(share(out, (o) => o.tracking))} tracked`);
  assert.ok(share(out, (o) => o.err < 12) >= 0.95, `the places within 12 px in ${pct(share(out, (o) => o.err < 12))}`);
  assert.ok(share(out, (o) => o.complete) >= 0.9, `${pct(share(out, (o) => o.complete))} complete`);
});

test('the whole picture is searched only when the map needs it: no map, a map waiting for its row, one that struggles, one without a full fit of the ring for a while', () => {
  const scene = makeScene({ path: swayPath() }), tr = new Tracker();
  assert.equal(tr.wantsFound(T0), true, 'no map');
  const { out, tr: t2 } = run(scene, { frames: 60, tracker: tr });
  const last = out[out.length - 1].t;
  assert.equal(t2.wantsFound(last), false, 'a healthy map');
  assert.equal(t2.wantsFound(last + 600), true, 'no full ring fit for 0.6 s');
  t2.coast = 3;
  assert.equal(t2.wantsFound(last), true, 'struggling');
  t2.coast = 0; t2.pending = { t0: last, n: 0 };
  assert.equal(t2.wantsFound(last), true, 'waiting for the row');
});

test('the speed of the map is learned from the pictures, and predicts where the places are: at 100 px a second the predicted places are within 3 px at every picture', () => {
  const scene = makeScene({ w: 640, path: (t) => ({ elev: 60, azim: 100, dist: 700 }), rowAmp: 60, ringAmp: 200, shift: (t) => ({ x: 200 * ((t - T0) / 1000), y: 0 }), trail: true });   // 100 px a second at 640
  const { out } = run(scene, { frames: 16 * 3, fps: 16, jitter: 0, sets: true });
  const late = out.filter((o) => o.i >= 20);
  const speeds = late.map((o) => o.speed);
  assert.ok(Math.min(...speeds) > 70 && Math.max(...speeds) < 130, `speed ${Math.min(...speeds).toFixed(0)} to ${Math.max(...speeds).toFixed(0)} px/s`);
  assert.ok(late.every((o) => o.err < 3), `worst place ${Math.max(...late.map((o) => o.err)).toFixed(1)} px`);
});

test('the picture is analysed at another size: the map is rescaled and carries on, with no new acquisition', () => {
  const path = swayPath(), big = makeScene({ w: 640, path }), small = makeScene({ w: 480, path }), tr = new Tracker();
  const a = run(big, { frames: 40, tracker: tr });
  assert.equal(acquisitions(a.out), 1);
  tr.rescale(480 / 640, 480 / 640);
  const T1 = T0 + 40 * 40;
  const out = [];
  for (let i = 0; i < 40; i++) {
    const t = T1 + i * 40, f = small.frame(t);
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: small.found(t), motion: 8, t });
    out.push({ ...r, err: placeError(r, tr, f) });
  }
  assert.equal(acquisitions(out), 0, 'no new acquisition');
  assert.ok(out.every((o) => o.tracking && o.err < 6), `worst place ${Math.max(...out.map((o) => o.err)).toFixed(1)} px`);
});

test('a map that is not the map of a table seen from above is never kept (the places that flew far outside the picture, then the page froze)', () => {
  const good = [1.2, 0.1, 300, -0.05, 0.9, 200, 0.0002, 0.0003, 1];
  assert.equal(validMap(good, 640, 360), true);
  assert.equal(validMap([...good.slice(0, 6), 0.5, 0.5, 1], 640, 360), false, 'the horizon crosses the robot');
  assert.equal(validMap([1, 0, 1e6, 0, 1, 0, 0, 0, 1], 640, 360), false, 'the robot is a million pixels away');
  assert.equal(validMap([1e5, 0, 300, 0, 1e5, 200, 0, 0, 1], 640, 360), false, '100 000 px per mm');
  assert.equal(validMap([NaN, 0, 0, 0, 1, 0, 0, 0, 1], 640, 360), false);
  assert.equal(validMap(null, 640, 360), false);
  // a tracker that is handed such a map does not loop on it and does not keep it
  const scene = makeScene({ path: swayPath() }), { tr } = run(makeScene({ path: swayPath() }), { frames: 40 });
  tr.H = [1e4, 0, 300, 0, 1e4, 200, 0.5, 0.5, 1];
  const f = scene.frame(T0 + 5000), a = Date.now();
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: null, motion: 8, t: T0 + 5000 });
  assert.ok(Date.now() - a < 300, 'quick');
  assert.equal(r.tracking, false);
  assert.ok(r.invalid >= 1);
});

test('a map whose ring has left the picture is dropped after a few pictures, not kept with its places and its lines drawn nowhere', () => {
  const scene = makeScene({ w: 640, path: swayPath() }), { tr, out } = run(scene, { frames: 40 });
  assert.ok(out[39].tracking);
  const t0 = out[39].t;
  const c0 = applyH(tr.H, 0, 26);
  tr.H = compose([1, 0, -(c0.x + 40), 0, 1, 0, 0, 0, 1], tr.H);               // valid, but the ring is now 40 px to the left of the picture
  const after = [];
  for (let i = 0; i < 12; i++) {
    const t = t0 + 60 * (i + 1), f = scene.frame(t);
    after.push(tr.update({ maps: { green: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)], amber: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)] }, w: f.w, h: f.h, group: 0, circle: 1, found: null, motion: 8, t }));
  }
  const lost = after.findIndex((r) => r.state === 'lost');
  assert.ok(lost >= 0 && lost <= 6, `lost at picture ${lost}`);
  assert.equal(after[lost].lostBy, 'hors image');
});

test('slide is bounded whatever reach it is given (a reach from a map that went wrong)', () => {
  const w = 640, h = 360, P = new Uint8Array(w * h), places = [0, 1, 2, 3].map((j) => ({ px: { x: 300 + 12 * j, y: 200 } }));
  for (const reach of [1e9, Infinity, NaN, -5, 1e5]) {
    const a = Date.now();
    slide(P, w, h, places, { tau: 20, cap: 100, reach });
    assert.ok(Date.now() - a < 200, `reach ${reach}: ${Date.now() - a} ms`);
  }
  assert.equal(slide(P, w, h, [{ px: { x: NaN, y: 3 } }], { tau: 20, cap: 100, reach: 10 }), null);
});

test('one blob is the answer of one place only: a big glow between two arcs does not make a map out of two arcs on one point', () => {
  const scene = makeScene({ path: swayPath() }), { tr } = run(scene, { frames: 40 });
  const t = T0 + 4000, f = scene.frame(t), tr0 = f.truth;
  // the ring lit now: a strong wide blob exactly between two neighbouring arcs, in the fresh map of the amber, and the arcs themselves taken out
  const paint = (cx, cy, sg, a) => { const r = Math.ceil(3 * sg); for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) { if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue; const v = Math.round(a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sg * sg))); if (v > f.maps.amber[0][y * f.w + x]) f.maps.amber[0][y * f.w + x] = v; } };
  const mx = (tr0.ring[0].x + tr0.ring[1].x) / 2, my = (tr0.ring[0].y + tr0.ring[1].y) / 2;
  paint(mx, my, 12, 255);
  const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: null, motion: 8, t });
  const claimed = r.points.filter((o) => o.set === 'ring' && o.matched).map((o) => `${o.blob.x.toFixed(1)},${o.blob.y.toFixed(1)}`);
  assert.equal(new Set(claimed).size, claimed.length, 'no two arcs on the same blob');
});

test('the pattern slides to where the most places answer, the nearest shift winning a tie', () => {
  const w = 60, h = 40, P = new Uint8Array(w * h);
  for (const [x, y] of [[10, 20], [20, 20], [30, 20], [40, 20]]) P[y * w + x] = 100;
  const places = [0, 1, 2, 3].map((j) => ({ px: { x: 13 + 10 * j, y: 22 } }));                 // 3 px right and 2 px below
  const top = slide(P, w, h, places, { tau: 20, cap: 100, reach: 8 });
  assert.ok(Math.abs(top.dx + 3) <= 1 && Math.abs(top.dy + 2) <= 1 && top.count === 4, `${top.dx},${top.dy},${top.count}`);       // (a place counts a response within 1 px)
  // shifted by a whole gap the pattern has 3 of 4 on blobs: 4 of 4 at the true shift wins
  const slipped = [0, 1, 2, 3].map((j) => ({ px: { x: 0 + 10 * j + 10, y: 20 } }));
  const t2 = slide(P, w, h, slipped, { tau: 20, cap: 100, reach: 14 });
  assert.equal(t2.count, 4);
  assert.ok(Math.abs(t2.dx) <= 1, `${t2.dx}`);
});

// ---- starting from three arcs ---------------------------------------------------------------------------------------------------
import { completeSquare } from '../src/square.js';

test('the map can start from three arcs: the fourth corner is one of the hypotheses of the completion, the pictures say which', () => {
  const scene = makeScene({ path: swayPath(), dropArcs: [7] }), tr = new Tracker();
  let first = null;
  const around = (pts) => { const cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4; return pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); };
  const out = [];
  for (let i = 0; i < 60; i++) {
    const t = T0 + 40 * i, f = scene.frame(t), full = scene.found(t);
    const three = full.ring.filter((_, k) => k !== 1);
    const part = completeSquare(three.map((p) => ({ ...p, weight: 100, area: 40 })));
    assert.ok(part, 'a triple of corners');
    const rings = part.hypotheses.map((h) => around([...part.chosen, h.predicted]));
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: 0, circle: 1, found: { rings, row: full.row }, motion: 0, t });
    if (!first && r.tracking) first = i;
    out.push({ ...r, err: placeError(r, tr, f) });
  }
  assert.ok(first !== null && first < 5, 'acquired from three arcs (at least 3 of the 4 corners fresh)');
  const late = out.slice(25);
  // (the hidden arc is the place farthest from the row: while only the row is lit and corrects the map, by a shift, it drifts up to 10 px)
  assert.ok(late.every((o) => o.tracking && o.err < 12), `the worst place is ${Math.max(...late.map((o) => o.err)).toFixed(1)} px off (the hidden arc was predicted by the completion)`);
  assert.ok(late.filter((o) => o.ringMatched >= 3).length / late.length > 0.9);
});
