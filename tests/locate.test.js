import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '../src/locate.js';
import { PairDiff } from '../src/pairdiff.js';
import { ringWindowFromRow } from '../src/layout.js';
import { SQUARE_SIDE } from '../src/layout.js';
import { BLINK_HZ, HALF_MS } from '../src/script.js';
import { world, rng } from './world.js';

const FRONT_A = [['front', 0], ['front', 2], ['front', 4], ['front', 6]];
const DIAG = [1, 3, 5, 7];

// The ping-pong video through the two pair differences and `locate`, at zoom s (px per mm). -> one entry per picture compared.
function run({ s = 2.6, seconds = 5, fps = 25, seed = 3, arcGain = 1, wood = false, junk = false, sway = 0, gate = true, ringThr = 80, retry = true, elevDeg = 90 }) {
  const sc = world({ s }), rnd = rng(seed), { W, H } = sc;
  const green = new PairDiff({ halfMs: HALF_MS }), amber = new PairDiff({ halfMs: HALF_MS, measure: 'amber' });
  const lineSize = { minArea: 2, maxArea: Math.max(50, (W * H) / 150) }, arcSize = { minArea: 4, maxArea: (W * H) / 20, minFill: 0.1, maxAspect: 8 };
  const out = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = 1000 + (1000 * i) / fps + (rnd() - 0.5) * 8;
    const ph = 2 * Math.PI * 0.6 * ((t - 1000) / 1000), dx = sway * s * Math.sin(ph), dy = 0.5 * sway * s * Math.sin(ph + 1);
    const lit = ((t / 1000) * BLINK_HZ) % 1 < 0.5;
    const f = sc.frame({ lego: lit ? FRONT_A : [], arcs: lit ? [] : DIAG, dx, dy, rnd, arcGain, wood, junk });
    const g = green.push(f, W, H, t), a = amber.push(f, W, H, t);
    if (!g || !a || t < 2500) continue;
    const line = green.find(50, lineSize).spots, ring = amber.find(ringThr, arcSize).spots;
    const r = locate({ line, ring, group: 0, elevDeg, longSide: Math.max(W, H), gate,
      retryRing: retry ? (win) => amber.find(35, arcSize, win).spots : null, retryLine: retry ? (win) => green.find(30, lineSize, win).spots : null });
    out.push({ ...r, dx, dy, sc, line: line.length, ring: ring.length });
  }
  return out;
}
// the picked spots are the true LEDs / arcs (within `tol` mm of where they are in the picture, the picture being carried by dx, dy)
const rowRight = (e, tolMm) => e.aligned && e.aligned.chosen.length === 4 && FRONT_A.every(([r, k]) => { const c = e.sc.ledPoint(r, k, e.dx, e.dy); return e.aligned.chosen.some((p) => Math.hypot(p.x - c.x, p.y - c.y) <= tolMm * e.sc.s); });
const ringRight = (e, tolMm) => e.square && e.square.full && DIAG.every((i) => { const c = e.sc.arcCentre(i, e.dx, e.dy); return e.square.chosen.some((p) => Math.hypot(p.x - c.x, p.y - c.y) <= tolMm * e.sc.s); });
const share = (out, test) => out.filter(test).length / out.length;

test('both sets are found at every zoom, from a lens that sees the robot 5 times smaller to one that sees it 5 times bigger', () => {
  for (const s of [1.0, 2.6, 5.0]) {
    const out = run({ s });
    assert.ok(out.length > 60);
    assert.ok(share(out, (e) => rowRight(e, 3) && ringRight(e, 5)) >= 0.95, `zoom ${s} px/mm: ${(100 * share(out, (e) => rowRight(e, 3) && ringRight(e, 5))).toFixed(0)} %`);
    assert.ok(share(out, (e) => !e.mismatch) >= 0.98, `zoom ${s}: scales of the row and the ring agree`);
  }
});

test('the scales found from the row and from the ring agree with the true one', () => {
  const out = run({ s: 2.6 }).filter((e) => e.scales?.row && e.scales?.ringMean);
  assert.ok(out.length > 40);
  for (const e of out) { assert.ok(Math.abs(e.scales.row - 2.6) / 2.6 < 0.15); assert.ok(Math.abs(e.scales.ringMean - 2.6) / 2.6 < 0.25); }
});

test('faint arcs (a third of their light) that the ring threshold of 80 misses are found where the row says they are; without the prediction they are not', () => {
  for (const s of [1.2, 2.6, 5.0]) {
    const withPrediction = run({ s, arcGain: 0.3, wood: true });
    const without = run({ s, arcGain: 0.3, wood: true, gate: false });
    const a = share(withPrediction, (e) => rowRight(e, 3) && ringRight(e, 6)), b = share(without, (e) => ringRight(e, 6));
    assert.ok(a >= 0.9, `zoom ${s}: with the prediction ${(100 * a).toFixed(0)} %`);
    assert.ok(b < 0.1, `zoom ${s}: without ${(100 * b).toFixed(0)} %`);
    assert.ok(share(withPrediction, (e) => e.rescued === 'retry') > 0.8, 'it is the look in the window with a lower threshold that does it');
  }
});

test('a hand-held phone: the picture sways at up to 4 LED diameters a second; both sets are found in nearly every picture', () => {
  const sway = (4 * 4.8) / (2 * Math.PI * 0.6);                    // mm of amplitude for a peak speed of 4 LED diameters a second
  for (const fps of [25, 10]) {
    const out = run({ s: 2.6, sway, fps, seconds: 8, junk: true, seed: 5 });
    const tol = (sway * 2 * Math.PI * 0.6 * 0.35) + 4;               // an N spot is up to 0.35 s old
    const ok = share(out, (e) => rowRight(e, tol) && ringRight(e, tol + 3));
    assert.ok(ok >= 0.85, `${fps} pictures a second: ${(100 * ok).toFixed(0)} %`);
  }
});

// ---- spots by hand: the prediction corrects a mistake ----------------------------------------------------------------------
const spot = (p, weight = 100, area = 60) => ({ x: p.x, y: p.y, weight, area });

test('a strong square far from the robot loses to the faint real one, when the row is seen: the prediction corrects the first choice', () => {
  const sc = world({ s: 2.6 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20));
  const real = DIAG.map((i) => spot(sc.arcCentre(i), 60, 400));
  const stray = [[0, 0], [90, 0], [90, 90], [0, 90]].map(([x, y]) => spot({ x: 100 + x, y: -420 + y }, 200, 400));        // 600 px above the row (230 mm at this scale: out of the window), bigger, stronger
  const first = locate({ line: row, ring: [...stray, ...real], group: 0, elevDeg: 90, gate: false });
  assert.ok(stray.every((p) => first.square.chosen.includes(p)), 'without the prediction the strong stray square wins');
  const second = locate({ line: row, ring: [...stray, ...real], group: 0, elevDeg: 90 });
  assert.ok(real.every((p) => second.square.chosen.includes(p)), 'with it the real square does');
  assert.equal(second.rescued, 'gate');
  assert.equal(second.mismatch, false);
});

test('the same the other way round: a strong stray line far from the robot loses to the real row when the ring is seen', () => {
  const sc = world({ s: 2.6 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 60, 20));
  const real = DIAG.map((i) => spot(sc.arcCentre(i), 100, 400));
  const stray = [0, 1, 2, 3].map((k) => spot({ x: 10 + k * 42, y: sc.H - 10 }, 200, 20));         // 4 on a line, 16 mm apart at this scale, far below the robot
  const second = locate({ line: [...stray, ...row], ring: real, group: 0, elevDeg: 90 });
  assert.ok(row.every((p) => second.aligned.chosen.includes(p)));
  assert.ok(real.every((p) => second.square.chosen.includes(p)));
});

test('a ring ten times too big for the row is not the same robot: reported as a mismatch', () => {
  const sc = world({ s: 2.6 }), big = world({ s: 26 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20));
  const ring = DIAG.map((i) => { const c = big.arcCentre(i); return spot({ x: c.x * 0.5, y: c.y * 0.5 + 400 }, 100, 400); });
  const r = locate({ line: row, ring, group: 0, elevDeg: 90 });
  assert.equal(r.mismatch, true);
});

test('with only one set asked for, or with the prediction off, locate just picks (nothing else changes)', () => {
  const sc = world({ s: 2.6 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20)), ring = DIAG.map((i) => spot(sc.arcCentre(i), 100, 400));
  const alone = locate({ line: row, ring: [], group: 0, wantRing: false });
  assert.equal(alone.aligned.chosen.length, 4);
  assert.equal(alone.square, null);
  assert.equal(alone.predicted, null);
  const ringOnly = locate({ line: [], ring, group: -2, wantLine: false });
  assert.ok(ringOnly.square.full);
  const none = locate({ line: row, ring: [], group: 0, gate: false });
  assert.equal(none.square.full, false);
  assert.equal(none.predicted, null);
});

test('the window look: only inside the window, and with a lower threshold than the rest of the picture', () => {
  const sc = world({ s: 2.6 }), rnd = rng(2), { W, H } = sc, amber = new PairDiff({ halfMs: HALF_MS, measure: 'amber' });
  const size = { minArea: 4, maxArea: (W * H) / 20, minFill: 0.1, maxAspect: 8 };
  // a faint ring and a faint amber thing far from it, blinking the same way
  const faint = (on) => { const f = sc.frame({ arcs: on ? DIAG : [], rnd, arcGain: 0.3 }); if (on) { for (let y = H - 40; y < H - 20; y++) for (let x = 20; x < 40; x++) { const k = (y * W + x) * 4; f[k] = 236; f[k + 1] = 234; f[k + 2] = 160; } } return f; };
  amber.push(faint(false), W, H, 1000);
  amber.push(faint(true), W, H, 1000 + HALF_MS);
  assert.equal(amber.find(80, size).spots.length, 0, 'at 80 nothing');
  assert.ok(amber.find(35, size).spots.length >= 5, 'at 35 the 4 arcs and the thing, and what the noise adds');
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20));
  const win = ringWindowFromRow(row, 0, { elevDeg: 90 });
  const inWin = amber.find(35, size, win);
  assert.equal(inWin.windowed, true);
  assert.ok(DIAG.every((i) => { const c = sc.arcCentre(i); return inWin.spots.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 8 * sc.s); }), 'the 4 arcs');
  assert.ok(inWin.spots.every((p) => win.inside(p)), 'and nothing outside the window');
});

// ---- three arcs found, the fourth expected where the parallelogram puts it ------------------------------------------------------
test('three arcs found and the fourth missing at the usual threshold: it is looked for where A + C - B puts it, with a lower threshold, and only there', () => {
  const sc = world({ s: 2.6 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20));
  const arcs = DIAG.map((i) => spot(sc.arcCentre(i), 100, 400));
  for (const missing of [0, 1, 2, 3]) {
    const three = arcs.filter((_, i) => i !== missing);
    const asked = [];
    const retryRing = (win) => { asked.push(win); return win.inside(arcs[missing]) ? [{ ...arcs[missing], weight: 30 }] : []; };
    const r = locate({ line: row, ring: three, group: 0, elevDeg: 90, retryRing });
    assert.ok(r.square.full, `arc ${missing} missing`);
    assert.equal(r.rescued, 'complete');
    assert.ok(arcs.every((a) => r.square.chosen.some((p) => p.x === a.x && p.y === a.y)));
    assert.ok(asked.every((w) => w.kind === 'disc' || w.kind === 'ring-from-row'), 'the look was in a window');
    assert.ok(asked.length >= 1);
  }
});

test('three arcs and no fourth anywhere: the square is reported as partial, with where the fourth is expected', () => {
  const sc = world({ s: 2.6 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20));
  const arcs = DIAG.map((i) => spot(sc.arcCentre(i), 100, 400));
  const r = locate({ line: row, ring: arcs.slice(0, 3), group: 0, elevDeg: 90, retryRing: () => [] });
  assert.equal(r.square.full, false);
  assert.equal(r.square.partial, true);
  assert.equal(r.square.chosen.length, 3);
  const dist = Math.hypot(r.square.predicted.x - arcs[3].x, r.square.predicted.y - arcs[3].y);
  assert.ok(dist < 0.2 * 36.8 * 2.6, `the predicted fourth is ${dist.toFixed(1)} px from the missing arc (top-down, no perspective: it should be on it)`);
});

test('a stray spot where the fourth arc is expected, but not a corner of a square, is not taken for it', () => {
  const sc = world({ s: 2.6 });
  const row = FRONT_A.map(([r, k]) => spot(sc.ledPoint(r, k), 100, 20));
  const arcs = DIAG.map((i) => spot(sc.arcCentre(i), 100, 400));
  const stray = spot({ x: arcs[3].x + 70, y: arcs[3].y + 70 }, 100, 400);                    // far from every hypothesis
  const r = locate({ line: row, ring: [...arcs.slice(0, 3), stray], group: 0, elevDeg: 90, retryRing: () => [] });
  assert.equal(r.square.full, false);
});
