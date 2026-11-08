import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchThreshold, QUIET_PEAK } from '../src/search.js';

test('the threshold is the one asked while the lights are strong, and follows them down to a floor', () => {
  const strong = [];
  for (const p of [220, 210, 230, 200, 215]) searchThreshold(strong, p, 80, 35);
  assert.equal(searchThreshold(strong, 210, 80, 35).thr, 80, 'arcs at 200: 80, as asked');
  const weak = [];
  for (const p of [90, 85, 95, 82, 88, 90, 86]) searchThreshold(weak, p, 80, 35);
  assert.equal(searchThreshold(weak, 88, 80, 35).thr, 44, 'arcs at 88: half of them (the 16th report: max 82 under the threshold 80)');
  const faint = [];
  for (let i = 0; i < 9; i++) searchThreshold(faint, 50, 80, 35);
  assert.equal(searchThreshold(faint, 50, 80, 35).thr, 35, 'never under the floor');
});

test('the median of the last peaks, not the last peak: a strong flash of light for a picture does not move it', () => {
  const h = [];
  for (const p of [90, 92, 88, 91, 89]) searchThreshold(h, p, 80, 35);
  assert.equal(searchThreshold(h, 255, 80, 35).thr, 46, 'half of the median 91');
});

test('quiet: nothing blinks, nothing is looked for', () => {
  const h = [];
  let r;
  for (let i = 0; i < 9; i++) r = searchThreshold(h, 15, 80, 35);
  assert.equal(r.quiet, true);
  assert.ok(QUIET_PEAK > 15);
  const g = [];
  for (let i = 0; i < 9; i++) r = searchThreshold(g, 60, 80, 35);
  assert.equal(r.quiet, false);
});
