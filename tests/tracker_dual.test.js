import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, expectedPoints } from '../src/tracker.js';
import { applyH } from '../src/homography.js';
import { makeDualScene } from './dual_scene.js';
import { pickAligned } from '../src/aligned.js';
import { pickSquare } from '../src/square.js';

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

test('lights in line with the row (a light out of a hole, beyond its end) do not spoil a start: the row is judged on its 3 best spots, and the map is made from the spots that fit', () => {
  const path0 = path();
  for (const extra of [[1], [1.5], [2], [3], [1, 2.2]]) for (let i = 0; i < 12; i++) {
    const t = T0 + i * 173, scene = makeDualScene({ path: path0, seed: i + 1 }), tr = new Tracker(), f = scene.frame(t);
    const r = tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: scene.found(t, { noise: 0.6, rowExtra: extra }), motion: 0, t });
    assert.equal(r.tracking, true, `strays at ${extra} gaps, try ${i}: ${r.acqFail && r.acqFail.reason}`);
    assert.ok(placeError(r, tr, f) < 4, `the 16 places within ${placeError(r, tr, f).toFixed(1)} px (the stray was not used)`);
  }
  // one LED missing and a stray: still three good spots
  const t = T0 + 40, scene = makeDualScene({ path: path0 }), tr = new Tracker(), f = scene.frame(t);
  assert.equal(tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: scene.found(t, { rowDrop: [0], rowExtra: [2] }), motion: 0, t }).tracking, true);
});

test('a distractor in the background (a strong light that blinks, the user\'s 15th report): the best square and the best row are not the right ones, the candidates are tried against each other and the map starts', () => {
  let startedFirst = 0, startedAll = 0, tries = 0;
  for (let i = 0; i < 30; i++) {
    const t = T0 + i * 211, scene = makeDualScene({ path: path(), seed: i + 1 }), f = scene.frame(t), truth = scene.found(t, { noise: 0.6 });
    // the spots a detector finds: the 4 arcs and the 4 LEDs, and strong lights near them, in amber and in green (very bright: they win the choices by weight)
    const cx = truth.rings[0].reduce((a, c) => a + c.x, 0) / 4, cy = truth.rings[0].reduce((a, c) => a + c.y, 0) / 4;
    const ringSpots = [...truth.rings[0].map((c) => ({ ...c, weight: 100 })), { x: cx + 40, y: cy - 30, weight: 900, area: 40 }, { x: cx - 45, y: cy + 38, weight: 800, area: 40 }];
    const u = { x: truth.row[3].x - truth.row[0].x, y: truth.row[3].y - truth.row[0].y }, len = Math.hypot(u.x, u.y);
    const rowSpots = [...truth.row.map((c) => ({ ...c, weight: 100 })), { x: truth.row[3].x + (u.x / len) * len * 0.55, y: truth.row[3].y + (u.y / len) * len * 0.55, weight: 900, area: 40 }, { x: truth.row[0].x - (u.x / len) * len * 0.5, y: truth.row[0].y - (u.y / len) * len * 0.5, weight: 800, area: 40 }];
    const one = (found) => { const tr = new Tracker(); return tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found, motion: 0, t }); };
    const sq1 = pickSquare(ringSpots, { minSide: 8 }), row1 = pickAligned(rowSpots, { minGap: 5 });
    const sqA = pickSquare(ringSpots, { minSide: 8, all: true }), rowA = pickAligned(rowSpots, { minGap: 5, all: true });
    tries++;
    if (one({ rings: sq1.full ? [sq1.chosen] : [], row: row1.chosen }).tracking) startedFirst++;
    const r = one({ rings: sqA.candidates, rows: rowA.candidates });
    if (r.tracking) { startedAll++; const tr2 = new Tracker(); const rr = tr2.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: { rings: sqA.candidates, rows: rowA.candidates }, motion: 0, t }); assert.ok(placeError(rr, tr2, f) < 4, `try ${i}: the 16 places within ${placeError(rr, tr2, f).toFixed(1)} px`); }
  }
  assert.ok(startedAll >= 27, `with the candidates: ${startedAll} of ${tries} started`);
  assert.ok(startedAll > startedFirst, `the first choices alone: ${startedFirst}; with the candidates: ${startedAll}`);
});

test('pickAligned and pickSquare give their best few different candidates on request, the best first, and the same result as before otherwise', () => {
  const row = [0, 1, 2, 3].map((j) => ({ x: 100 + 20 * j, y: 50 + j, weight: 100, area: 20 })), stray = { x: 160, y: 54, weight: 300, area: 20 };
  const plain = pickAligned([...row, stray], { minGap: 5 }), many = pickAligned([...row, stray], { minGap: 5, all: true });
  assert.deepEqual(many.chosen, plain.chosen, 'the first is the same');
  assert.ok(many.candidates.length >= 2 && many.candidates.length <= 6);
  assert.deepEqual(many.candidates[0], plain.chosen);
  assert.ok(many.candidates.some((c) => c.length === 4 && row.every((p) => c.includes(p))), 'the true row is among them');
  assert.equal(pickAligned([], { all: true }).candidates.length, 0);
  assert.equal(pickAligned([]).candidates, undefined);
});

test('the arcs of the two flashes differ in strength (155 and 95: the 16th report) and the exposure changes: the usual strength follows, no arc is refused for being strong, no weak one pulls the others', () => {
  const { out, tr } = run(makeDualScene({ path: path(), shift: swayShift(40), ringAmp: [160, 95] }), { frames: 14 * 40 });
  assert.equal(acquisitions(out), 1);
  assert.ok(share(out, (o) => o.ringConfirmed === 4) >= 0.97, `all 4 arcs of the lit flash confirmed in ${pct(share(out, (o) => o.ringConfirmed === 4))}`);
  assert.ok(tr.signal.amber >= 85 && tr.signal.amber <= 170, `usual strength of the arcs ${tr.signal.amber.toFixed(0)}`);
  // the lights get dimmer by half, then brighter again: the strength follows, nothing is lost
  const dim = makeDualScene({ path: path(), shift: swayShift(40), ringAmp: [70, 45], rowAmp: 45 }), bright = makeDualScene({ path: path(), shift: swayShift(40), ringAmp: [200, 150] });
  const t0 = out[out.length - 1].t + 60, step = (scene, from, n) => { const o = []; for (let i = 0; i < n; i++) { const t = from + i * 70, f = scene.frame(t); o.push(tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: scene.found(t), motion: 8, t })); } return o; };
  const d = step(dim, t0, 14 * 12), b = step(bright, t0 + 14 * 12 * 70, 14 * 12);
  assert.ok(d.slice(20).every((r) => r.tracking), 'followed through the dimming');
  assert.ok(tr.signal.amber > 120, 'and back up');
  assert.ok(b.slice(20).filter((r) => r.ringConfirmed === 4).length / b.slice(20).length >= 0.95, 'every arc of the bright lights is confirmed (none refused as too strong)');
});

test('a row with ONE arc does not determine the map: no joint fit is made of it (the 16th report: 72 absurd maps), the map is kept and corrected by what it can', () => {
  const full = makeDualScene({ path: path(), shift: swayShift(30) }), poor = makeDualScene({ path: path(), shift: swayShift(30), dropArcs: [2, 4, 6, 3, 5, 7] }), tr = new Tracker();
  const a = run(full, { frames: 30, tracker: tr });
  assert.equal(acquisitions(a.out), 1);
  const out = [];
  for (let i = 0; i < 40; i++) {
    const t = a.out[29].t + 70 * (i + 1), f = poor.frame(t);
    out.push(tr.update({ maps: f.maps, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: null, motion: 8, t }));
  }
  assert.equal(out[out.length - 1].invalid, 0, 'no absurd map was made');
  assert.ok(out.slice(0, 8).every((r) => r.tracking), 'kept while it lasts');
});

test('after a loss the robot is looked for round where it was (a light in the background must do nothing): a disc that grows with the time, everywhere again after 6 s or when it is half the picture', () => {
  const scene = makeDualScene({ path: path(), shift: swayShift(20) }), tr = new Tracker();
  assert.equal(tr.searchZone(T0, 640, 360), null, 'never mapped: everywhere');
  const { out } = run(scene, { frames: 40, tracker: tr });
  const last = out[out.length - 1], c = applyH(last.H, 0, 26);
  assert.equal(tr.searchZone(last.t, 640, 360), null, 'a map now: nothing to look for');
  // the lights go out: the map is kept a few pictures, then lost
  let t = last.t, lostAt = null;
  for (let i = 0; i < 20; i++) {
    t += 70;
    const f = scene.frame(t), blank = { green: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)], amber: [new Uint8Array(f.w * f.h), new Uint8Array(f.w * f.h)] };
    const r = tr.update({ maps: blank, w: f.w, h: f.h, group: GROUP, circle: CIRCLE, found: null, motion: 0, t });
    if (r.state === 'lost' && lostAt === null) lostAt = t;
  }
  assert.ok(lostAt !== null, 'lost');
  const z1 = tr.searchZone(t, 640, 360), z2 = tr.searchZone(t + 1500, 640, 360), z3 = tr.searchZone(t + 3500, 640, 360);
  assert.ok(z1 && Math.hypot(z1.cx - c.x, z1.cy - c.y) < 40, `centred near the last place (${z1 && Math.hypot(z1.cx - c.x, z1.cy - c.y).toFixed(0)} px off)`);
  assert.ok(z1.r > 30 && z1.r < 0.5 * 640, `a disc of ${z1.r.toFixed(0)} px`);
  assert.ok(z2 === null || z2.r > z1.r, 'it grows with the time lost');
  assert.equal(tr.searchZone(t + 7000, 640, 360), null, 'after 6 s: everywhere');
  assert.ok(z3 === null || z3.r >= (z2 ? z2.r : 0));
  // the same zone in a picture of another size (a change of the analysed size): the same place, scaled
  const small = tr.searchZone(t, 480, 270);
  assert.ok(Math.abs(small.cx - z1.cx * 0.75) < 1 && Math.abs(small.cy - z1.cy * 0.75) < 1 && Math.abs(small.r - z1.r * 0.75) < 1, 'follows the size');
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

test('the zoom jumps (the 17th report: the camera changed its mode): a map held at the old scale with half of its places answering is replaced by a start from the picture', () => {
  // dist 500 -> 900 mm at 5 s: the robot looks 1.8 times smaller from one picture to the next; before, the map stayed at 0.6 to 0.9 of the right scale for as long as the robot was in view
  for (const [d0, d1] of [[500, 900], [500, 700], [300, 900], [800, 450]]) {
    const base = path({ dist: 1 });
    const scene = makeDualScene({ path: (t) => ({ ...base(t), dist: t >= T0 + 5000 ? d1 : d0 }), shift: swayShift(30) });
    const { out, tr } = run(scene, { frames: 14 * 16, fps: 14 });
    const after = out.filter((o) => o.t >= T0 + 6500);
    const good = after.filter((o) => o.tracking && o.err < 8).length / after.length;
    assert.ok(good >= 0.9, `${d0} -> ${d1} mm: ${pct(good)} of the pictures 1.5 s after the jump have the 16 places within 8 px`);
    if (d1 / d0 > 1.5) assert.ok(tr.nReacq >= 1, `${d0} -> ${d1}: the start from the picture took over`);
  }
});

test('a healthy map is not replaced: no start from the picture while the places answer (far, dim LEDs, a swaying hand)', () => {
  for (const opts of [{ dist: 480 }, { dist: 700, rowGains: [1, 0.25, 1, 0.25] }, { dist: 650 }]) {
    const { out, tr } = run(makeDualScene({ path: path({ dist: opts.dist }), shift: swayShift(50), rowGains: opts.rowGains }), { frames: 14 * 25 });
    assert.equal(tr.nReacq || 0, 0, `${JSON.stringify(opts)}: replaced ${tr.nReacq} times`);
    assert.equal(acquisitions(out), 1);
  }
});
