import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewAngleDeg, trancheOf, trancheLabel, AngleTable } from '../src/angle.js';
import { cameraAt, project, ledPositions, DEMO_W, DEMO_H, FOCAL } from '../src/demo.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

test('rear camera: flat on its back the tablet looks straight down, upright it looks level', () => {
  near(viewAngleDeg(0, 0), 90);
  near(viewAngleDeg(90, 0), 0);
  near(viewAngleDeg(45, 0), 45);
  near(viewAngleDeg(0, 45), 45);
  near(viewAngleDeg(0, -60), 30);          // tilted to the other side: the same
});

test('rear camera: face down it looks up (no angle); the front camera does the opposite', () => {
  assert.ok(Number.isNaN(viewAngleDeg(180, 0)));
  assert.ok(Number.isNaN(viewAngleDeg(0, 0, 'user')));
  near(viewAngleDeg(180, 0, 'user'), 90);
  near(viewAngleDeg(135, 0, 'user'), 45);
});

test('no sensor, no angle', () => {
  assert.ok(Number.isNaN(viewAngleDeg(null, 10)));
  assert.ok(Number.isNaN(viewAngleDeg(undefined, undefined)));
  assert.ok(Number.isNaN(viewAngleDeg(NaN, 0)));
});

test('tranches: 6 of 15 degrees, the edge belongs to the lower one, 0 and 90 are in', () => {
  assert.equal(trancheOf(90), 0);
  assert.equal(trancheOf(80), 0);
  assert.equal(trancheOf(75), 1);
  assert.equal(trancheOf(46), 2);
  assert.equal(trancheOf(45), 3);
  assert.equal(trancheOf(16), 4);
  assert.equal(trancheOf(15), 5);
  assert.equal(trancheOf(0), 5);
  assert.equal(trancheOf(-1), -1);
  assert.equal(trancheOf(91), -1);
  assert.equal(trancheOf(NaN), -1);
  assert.equal(trancheLabel(0), '75–90°');
  assert.equal(trancheLabel(5), '0–15°');
});

test('AngleTable counts the pictures and the LEDs found, tranche by tranche', () => {
  const t = new AngleTable(16);
  t.add(88, 16); t.add(85, 16); t.add(80, 15);
  t.add(20, 9); t.add(25, 12);
  t.add(NaN, 16);                          // no angle: not counted
  const s = t.summary();
  assert.equal(s[0].frames, 3);
  near(s[0].mean, 47 / 3);
  assert.equal(s[0].min, 15);
  assert.equal(s[0].max, 16);
  near(s[0].fullPct, (100 * 2) / 3, 1e-9);
  assert.equal(s[4].frames, 2);
  assert.equal(s[4].max, 12);
  assert.equal(s[4].fullPct, 0);
  assert.equal(s[1].frames, 0);
  assert.ok(Number.isNaN(s[1].mean));
});

test('demo camera: the middle of the robot is in the middle of the picture, from any side', () => {
  for (const [e, a] of [[89.9, 0], [60, 90], [30, 200], [20, 45]]) {
    const p = project(cameraAt(e, a, 380), [0, 0, 0]);
    near(p.x, DEMO_W / 2, 1e-6);
    near(p.y, DEMO_H / 2, 1e-6);
    near(p.z, 380, 1e-6);
  }
});

test('demo camera: the two rows of LEDs are 8 mm * focal / distance apart from above, and half that at 30 degrees', () => {
  const leds = ledPositions();
  const gap = (elev, azim) => {
    const cam = cameraAt(elev, azim, 380);
    const a = project(cam, leds[3]), b = project(cam, leds[8 + 3]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  near(gap(89.9, 90), (8 * FOCAL) / 380, 0.3);
  near(gap(30, 90), (8 * FOCAL) / 380 / 2, 1.0);
  near(gap(30, 270), (8 * FOCAL) / 380 / 2, 1.0);        // from the tail side: foreshortened the same
  // seen from the end of the rows (they run side by side across the picture): no foreshortening at all
  near(gap(30, 0), (8 * FOCAL) / 380, 1.0);
  // seen from the side at 10 degrees, one row lies almost behind the other: a few pixels apart
  near(gap(10, 90), (8 * FOCAL * Math.sin(10 * Math.PI / 180)) / 380, 0.5);
});

test('demo: 16 LEDs, 8 per row at 8 mm', () => {
  const leds = ledPositions();
  assert.equal(leds.length, 16);
  near(leds[1][0] - leds[0][0], 8, 1e-9);
  near(leds[8][1] - leds[0][1], -8, 1e-9);
});
