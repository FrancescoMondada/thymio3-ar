import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figures } from '../src/figures.js';

// [ms, state, cx, cy, scale640, row, ring, motion, angle, W, H]
const row = (ms, st, cx = 0.5, cy = 0.5, sc = 1.2, r = 4, g = 4) => [ms, st, st === 'l' || st === 'i' ? null : cx, st === 'l' || st === 'i' ? null : cy, st === 'l' || st === 'i' ? null : sc, r, g, 0, null, 270, 480];

test('a steady map: the share of pictures with a map, no loss, no jump', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(row(i * 66, i === 0 ? 'a' : 't', 0.5 + 0.001 * i));
  const f = figures(rows, [[0, '- -> a']]);
  assert.equal(f.pictures, 20);
  assert.equal(f.mapPct, 100);
  assert.equal(f.confirmedPct, 100);
  assert.equal(f.losses, 0);
  assert.equal(f.jumps, 0);
  assert.equal(f.firstMapS, 0);
});

test('losses are counted by reason, only when a map was lost (not the start); the longest gap and the first map are measured', () => {
  const rows = [row(0, 'l'), row(66, 'l'), row(132, 'a'), row(198, 't'), row(264, 'l'), row(330, 'l'), row(396, 'l'), row(462, 'a'), row(528, 't')];
  const events = [[0, '- -> l'], [132, 'l -> a'], [264, 't -> l (coast)'], [462, 'l -> a']];
  const f = figures(rows, events);
  assert.equal(f.losses, 1);
  assert.deepEqual(f.lossesBy, { coast: 1 });
  assert.equal(f.acquisitions, 2);
  assert.equal(f.firstMapS, 0.132);
  assert.equal(f.mapPct, 44);
  assert.equal(f.longestNoMapS, 0.2, 'from 264 to 462 ms');
});

test('a map that leaps across the picture is a jump (the circle going off in strange directions); a scale that doubles is a scale jump', () => {
  const rows = [row(0, 't', 0.2, 0.2), row(66, 't', 0.8, 0.7), row(132, 't', 0.8, 0.7, 3.0), row(198, 't', 0.805, 0.7, 3.0)];
  const f = figures(rows);
  assert.equal(f.jumps, 1);
  assert.equal(f.scaleJumps, 1);
  assert.ok(f.maxJumpPx > 300);
  assert.equal(f.jumpShare, 33.3);
});

test('an empty trace says so', () => { assert.deepEqual(figures([]), { pictures: 0 }); });

import { exposureSegments, slice } from '../src/figures.js';

test('the exposure sweep cuts the rows into one slice per step, without the first second after each change', () => {
  const events = [[500, '- -> t'], [1000, 'exposition : auto'], [6000, 'exposition : 1.0 ms demandées'], [10000, 'exposition : 2.0 ms demandées']];
  const seg = exposureSegments(events, 14000);
  assert.deepEqual(seg.map((s) => [s.label, s.from, s.to]), [['auto', 2000, 6000], ['1.0 ms demandées', 7000, 10000], ['2.0 ms demandées', 11000, 14000]]);
  const rows = [];
  for (let ms = 0; ms < 14000; ms += 100) rows.push([ms, 't', 0.5, 0.5, 1, 4, 4, 0, null, 270, 480]);
  assert.equal(slice(rows, seg[0].from, seg[0].to).length, 40);
  assert.equal(slice(rows, 20000, 30000).length, 0);
});
