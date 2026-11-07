import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/timeline.js';

test('pictures are counted in slices of 10 s, with the share of pictures where each set was found', () => {
  const tl = new Timeline();
  for (let i = 0; i < 100; i++) tl.add(5000 + i * 100, { row: true, ring: i % 2 === 0, rowPeak: 140, ringPeak: 90 });       // 10 s: row always, ring half
  for (let i = 0; i < 100; i++) tl.add(15000 + i * 100, { row: false, ring: false, rowPeak: 13, ringPeak: 107 });          // the next 10 s: nothing
  const b = tl.bins();
  assert.equal(b.length, 2);
  assert.equal(b[0].frames, 100);
  assert.equal(b[0].rowPct, 100);
  assert.equal(b[0].ringPct, 50);
  assert.equal(b[0].bothPct, 50);
  assert.equal(b[1].rowPct, 0);
  assert.equal(b[1].rowPeak, 13);
  assert.equal(b[1].ringPeak, 107);
  assert.equal(b[0].start, 0);
});

test('a set that is not asked for does not count against it', () => {
  const tl = new Timeline();
  for (let i = 0; i < 20; i++) tl.add(i * 100, { row: i < 10, ring: null });
  const [b] = tl.bins();
  assert.equal(b.rowPct, 50);
  assert.ok(Number.isNaN(b.ringPct));
  assert.ok(Number.isNaN(b.bothPct));
});

test('a change of settings starts a new line, the prediction and the motion are averaged, the old slices go', () => {
  const tl = new Timeline({ maxBins: 3 });
  tl.add(0, { row: true, ring: true, cfg: 'a', rescued: true, motion: 10 });
  tl.add(100, { row: true, ring: false, cfg: 'a', motion: 30 });
  tl.add(200, { row: true, ring: true, cfg: 'b' });
  assert.equal(tl.bins().length, 2);
  assert.equal(tl.bins()[0].rescuedPct, 50);
  assert.equal(tl.bins()[0].motion, 20);
  for (let i = 1; i <= 5; i++) tl.add(i * 10000, { row: true, ring: true, cfg: 'b' });
  assert.equal(tl.bins().length, 3);
  assert.equal(tl.bins()[0].index, 3, 'the oldest were dropped');
  assert.equal(tl.totals().frames, tl.bins().reduce((s, x) => s + x.frames, 0));
});

test('reset forgets everything', () => {
  const tl = new Timeline();
  tl.add(0, { row: true });
  tl.reset();
  assert.equal(tl.bins().length, 0);
  tl.add(99999, { row: true });
  assert.equal(tl.bins()[0].start, 0);
});

test('pictures where nothing responds (the phone points away from the robot) are counted apart, and the shares are also given without them', () => {
  const tl = new Timeline();
  for (let i = 0; i < 60; i++) tl.add(i * 100, { row: true, ring: i % 3 !== 0, seen: true, rowPeak: 140, ringPeak: 100 });          // aimed at the robot: row always, ring 2 times in 3
  for (let i = 60; i < 100; i++) tl.add(i * 100, { row: false, ring: false, seen: false, rowPeak: 13, ringPeak: 9 });             // looking at the settings
  const [b] = tl.bins();
  assert.equal(b.unseenPct, 40);
  assert.equal(b.rowPct, 60);                      // over all the pictures
  assert.equal(b.rowSeenPct, 100);                 // when aimed at the robot
  assert.ok(Math.abs(b.ringSeenPct - 100 * 40 / 60) < 1e-9);
  assert.ok(Math.abs(b.bothSeenPct - 100 * 40 / 60) < 1e-9);
  const t = tl.totals();
  assert.equal(t.unseenPct, 40);
  assert.equal(t.rowSeenPct, 100);
});

test('the gap between two LEDs of a group, in px, is averaged per slice (the distance of the phone)', () => {
  const tl = new Timeline();
  tl.add(0, { row: false, gap: 6 });
  tl.add(100, { row: true, gap: 10 });
  tl.add(200, { row: true });
  assert.equal(tl.bins()[0].gap, 8);
  const tl2 = new Timeline();
  tl2.add(0, { row: true });
  assert.ok(Number.isNaN(tl2.bins()[0].gap));
});

test('the share of pictures where the map was tracked is a column of its own (null: the tracking was not asked for)', () => {
  const tl = new Timeline();
  for (let i = 0; i < 10; i++) tl.add(i * 100, { row: true, ring: true, tracked: i < 7 });
  assert.equal(tl.bins()[0].trackedPct, 70);
  assert.equal(tl.totals().trackedPct, 70);
  const tl2 = new Timeline();
  tl2.add(0, { row: true });
  assert.ok(Number.isNaN(tl2.bins()[0].trackedPct));
});
