import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAligned } from '../src/aligned.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const spot = (x, y, weight = 100) => ({ x, y, weight, area: 20 });
// four spots on a line at `angleDeg`, gaps `gaps` (px), starting at (x0, y0)
const line = (x0, y0, angleDeg, gaps, weight = 100) => {
  const a = (angleDeg * Math.PI) / 180, out = [spot(x0, y0, weight)];
  let t = 0;
  for (const g of gaps) { t += g; out.push(spot(x0 + t * Math.cos(a), y0 + t * Math.sin(a), weight)); }
  return out;
};
const same = (chosen, expected) => expected.every((e) => chosen.some((c) => c.x === e.x && c.y === e.y)) && chosen.length === expected.length;

test('the 4 on a line are picked out of the random spots that surround them', () => {
  const rnd = rng(3);
  for (let trial = 0; trial < 40; trial++) {
    const four = line(60 + rnd() * 100, 50 + rnd() * 100, rnd() * 180, [30, 30, 30], 150);
    const noise = Array.from({ length: 12 }, () => spot(rnd() * 320, rnd() * 240, 40 + rnd() * 100));
    const r = pickAligned([...noise, ...four]);
    assert.ok(r.full, `trial ${trial}`);
    assert.ok(same(r.chosen, four), `trial ${trial}: the 4 on the line`);
  }
});

test('the line may be at any angle and the gaps may be foreshortened (steadily shrinking or growing)', () => {
  for (const angle of [0, 30, 90, 135, 172]) {
    for (const gaps of [[30, 30, 30], [34, 29, 24], [18, 22, 27], [40, 26, 17]]) {
      const four = line(100, 80, angle, gaps);
      const r = pickAligned([...four, spot(20, 20), spot(300, 200), spot(150, 30)]);
      assert.ok(r.full && same(r.chosen, four), `angle ${angle}, gaps ${gaps}`);
    }
  }
});

test('gaps that grow and shrink again, or differ by more than 3 times, are not an LED line', () => {
  assert.equal(pickAligned(line(100, 80, 20, [30, 10, 30]), { allowFewer: false }).chosen.length, 0, 'long, short, long');
  assert.equal(pickAligned(line(100, 80, 20, [10, 12, 50]), { allowFewer: false }).chosen.length, 0, 'one gap 5 times another');
});

test('a gap twice its neighbour is not perspective: three LEDs and a stray spot further along the same line are not a row', () => {
  const three = line(100, 80, 135, [30, 30]);
  const stray = spot(150, 30);                                           // on the line, 30 and 70 px beyond: gaps 30, 30(ish), 60...
  const r = pickAligned([...three, line(100, 80, 135, [30, 30, 30])[3], stray], { allowFewer: false });
  assert.ok(r.full && r.chosen.length === 4);
  assert.ok(r.chosen.every((p) => p !== stray), 'the stray spot, 70 px past the row, is not in it');
});

test('4 spots that are not on a line are not taken (a square, a slightly bent row)', () => {
  assert.equal(pickAligned([spot(50, 50), spot(100, 50), spot(100, 100), spot(50, 100)], { allowFewer: false }).chosen.length, 0);
  const bent = line(50, 100, 0, [30, 30, 30]);
  bent[1].y += 8; bent[2].y -= 8;                                       // 8 px off a 90 px line: more than 6 % + 1 px
  assert.equal(pickAligned(bent, { allowFewer: false }).chosen.length, 0);
  const nearly = line(50, 100, 0, [30, 30, 30]);
  nearly[1].y += 2; nearly[2].y -= 2;                                   // 2 px: fine
  assert.equal(pickAligned(nearly).chosen.length, 4);
});

test('with a false spot in the middle of the row the real 4 win by weight; with 3 real ones and a stray, 3 are returned as partial', () => {
  const four = line(60, 60, 10, [32, 32, 32], 120);
  const stray = spot(four[1].x + 14 * Math.cos(0.17), four[1].y + 14 * Math.sin(0.17) + 0.5, 30);      // between two of them, very weak
  const r = pickAligned([...four, stray]);
  assert.ok(r.full && same(r.chosen, four));
  const three = four.slice(0, 3);
  const r3 = pickAligned([...three, spot(250, 40), spot(30, 200)]);
  assert.equal(r3.full, false);
  assert.ok(same(r3.chosen, three));
  assert.equal(pickAligned([...three, spot(250, 40)], { allowFewer: false }).chosen.length, 0);
});

test('fewer than 3 spots, or none: nothing', () => {
  assert.equal(pickAligned([]).chosen.length, 0);
  assert.equal(pickAligned([spot(1, 1), spot(50, 50)]).chosen.length, 0);
});

test('the strongest of two possible lines is taken', () => {
  const weak = line(40, 40, 0, [30, 30, 30], 50), strong = line(40, 150, 5, [30, 30, 30], 150);
  assert.ok(same(pickAligned([...weak, ...strong]).chosen, strong));
});

test('the answer says how straight it is, and which way the line points', () => {
  const r = pickAligned(line(100, 100, 40, [30, 30, 30]));
  assert.ok(r.rms < 0.01);
  assert.ok(Math.abs(r.angleDeg - 40) < 0.01);
  assert.equal(r.gaps.length, 3);
});

test('speed with the 24 strongest of 60 spots (reported, loosely bounded)', () => {
  const rnd = rng(9);
  const spots = [...line(100, 100, 25, [30, 30, 30]), ...Array.from({ length: 56 }, () => spot(rnd() * 400, rnd() * 300, 40 + rnd() * 50))];
  const t0 = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i++) pickAligned(spots);
  const ms = (performance.now() - t0) / runs;
  console.log(`  alignment filter, 60 spots: ${ms.toFixed(2)} ms`);
  assert.ok(ms < 50);
});
