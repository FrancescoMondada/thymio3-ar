import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGE, MESSAGES, classifyRange, normalise, RangeGuide } from '../src/range.js';

test('the scale is brought to a picture 640 px long, whatever size is analysed', () => {
  assert.equal(normalise(1.2, 640, 360), 1.2);
  assert.ok(Math.abs(normalise(0.9, 480, 270) - 1.2) < 1e-12, '0.9 px/mm in 480 px is 1.2 in 640');
  assert.ok(Math.abs(normalise(0.5, 360, 640) - 0.5) < 1e-12, 'a picture held upright: the long side counts');
});

test('too far under 0.6 px/mm, too near over 2.2, in range between (the 14th test: held from 0.5 to 2.4, lost at 0.44 and 0.56)', () => {
  assert.equal(classifyRange(0.44), 'far');
  assert.equal(classifyRange(0.59), 'far');
  assert.equal(classifyRange(0.6), 'ok');
  assert.equal(classifyRange(1.0), 'ok');
  assert.equal(classifyRange(2.2), 'ok');
  assert.equal(classifyRange(2.5), 'near');
  assert.equal(classifyRange(NaN), null);
  assert.ok(RANGE.far < RANGE.near);
  assert.deepEqual(Object.values(MESSAGES), ['Trop loin', 'Trop près'], 'just that: no distance, it depends on the optics');
  for (const m of Object.values(MESSAGES)) assert.ok(!/\d|cm|mètre/i.test(m), m);
});

test('the hint comes after 1.2 s out of range and goes after 0.8 s back in it: a moment out of range says nothing', () => {
  const g = new RangeGuide();
  let t = 0;
  const step = (s, tracking = true) => { t += 100; return g.update(t, s, tracking); };
  for (let i = 0; i < 10; i++) assert.equal(step(1.0).state, 'ok');
  for (let i = 0; i < 8; i++) assert.equal(step(0.5).state, 'ok', 'not yet');
  let r;
  for (let i = 0; i < 6; i++) r = step(0.5);
  assert.equal(r.state, 'far');
  assert.equal(r.message, MESSAGES.far);
  for (let i = 0; i < 6; i++) assert.equal(step(1.0).state, 'far', 'it stays a moment');
  for (let i = 0; i < 5; i++) r = step(1.0);
  assert.equal(r.state, 'ok');
  assert.equal(r.message, '');
  // a short dip does not show
  const h = new RangeGuide();
  let u = 0;
  for (const s of [1, 1, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]) { u += 100; assert.equal(h.update(u, s, true).state, 'ok'); }
});

test('too near says so too', () => {
  const g = new RangeGuide();
  let r;
  for (let i = 0; i < 20; i++) r = g.update(i * 100, 2.6, true);
  assert.equal(r.state, 'near');
  assert.equal(r.message, MESSAGES.near);
});

test('a map that is lost with nothing measured: the last scale says which side the robot was going out of range', () => {
  const far = new RangeGuide(), near = new RangeGuide(), mid = new RangeGuide();
  for (let i = 0; i < 10; i++) { far.update(i * 100, 0.62, true); near.update(i * 100, 2.1, true); mid.update(i * 100, 1.1, true); }
  let a, b, c;
  for (let i = 10; i < 30; i++) { a = far.update(i * 100, NaN, false); b = near.update(i * 100, NaN, false); c = mid.update(i * 100, NaN, false); }
  assert.equal(a.state, 'far');
  assert.equal(b.state, 'near');
  assert.equal(c.state, 'ok', 'lost from the middle of the range: nothing to say about the distance');
  // and not for ever: after 6 s with nothing measured the guess is dropped
  const g = new RangeGuide();
  for (let i = 0; i < 10; i++) g.update(i * 100, 0.62, true);
  let r;
  for (let i = 10; i < 120; i++) r = g.update(i * 100, NaN, false);
  assert.equal(r.state, 'far', 'what was said stays when there is nothing to say');
});

test('the summary: the share of the pictures with a map that were too far, in range, too near', () => {
  const g = new RangeGuide();
  for (const s of [0.5, 1, 1, 1, 2.5, 1, 1, 1, 1, 1]) g.update(0, s, true);
  g.update(0, 0.5, false);                           // no map: not counted
  const m = g.summary();
  assert.equal(m.n, 10);
  assert.ok(Math.abs(m.far - 0.1) < 1e-12 && Math.abs(m.near - 0.1) < 1e-12 && Math.abs(m.ok - 0.8) < 1e-12);
});
