import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSize, SIZES } from '../src/autosize.js';

test('LEDs too small (under 11 px apart): a bigger size; still 15 px apart at the smaller size: the smaller one; between: the same', () => {
  assert.equal(nextSize({ size: 480, gapPx: 8, samples: 30 }), 640);
  assert.equal(nextSize({ size: 640, gapPx: 8, samples: 30 }), 960);
  assert.equal(nextSize({ size: 960, gapPx: 8, samples: 30 }), 960, 'the largest stays');
  assert.equal(nextSize({ size: 960, gapPx: 60, samples: 30 }), 640);
  assert.equal(nextSize({ size: 960, gapPx: 24, samples: 30 }), 640, 'the user\'s 7th test: 24 px at 960 is 16 px at 640');
  assert.equal(nextSize({ size: 960, gapPx: 22.6, samples: 30 }), 640, '15.07 px at 640');
  assert.equal(nextSize({ size: 960, gapPx: 21, samples: 30 }), 960, '14 px at 640 is not enough margin');
  assert.equal(nextSize({ size: 640, gapPx: 20, samples: 30 }), 480, '15 px at 480');
  assert.equal(nextSize({ size: 640, gapPx: 19, samples: 30 }), 640);
  assert.equal(nextSize({ size: 480, gapPx: 60, samples: 30 }), 480, 'the smallest stays');
  assert.equal(nextSize({ size: 480, gapPx: 27, samples: 30 }), 480);
});

test('no oscillation: applying the rule again and again, with the gap growing and shrinking with the size, settles and never turns back', () => {
  for (const g0 of [4, 6, 8, 10.5, 12, 14, 15, 27, 41, 43, 60, 90, 120]) {              // gap in pixels at 480
    let size = 480;
    const seen = [size];
    for (let step = 0; step < 6; step++) {
      const gap = (g0 * size) / 480;
      const next = nextSize({ size, gapPx: gap, samples: 30 });
      if (next === size) break;
      size = next;
      seen.push(size);
    }
    assert.ok(seen.length <= 3, `gap ${g0}: ${seen.join(' -> ')}`);
    const sorted = [...seen].sort((a, b) => a - b);
    assert.ok(JSON.stringify(seen) === JSON.stringify(sorted) || JSON.stringify(seen) === JSON.stringify(sorted.reverse()), `gap ${g0}: ${seen.join(' -> ')} goes one way only`);
    assert.equal(nextSize({ size, gapPx: (g0 * size) / 480, samples: 30 }), size, `gap ${g0}: it settled at ${size}`);
  }
});

test('no scale yet: a few samples only, so nothing is changed on a scale that is not known', () => {
  assert.equal(nextSize({ size: 480, gapPx: 5, samples: 5 }), 640, 'with no scale and nothing found, a bigger size is tried when something responds');
  assert.equal(nextSize({ size: 480, gapPx: NaN, samples: 0, foundShare: 0, unseenShare: 0.9 }), 480, 'the phone points away from the robot: nothing to conclude');
  assert.equal(nextSize({ size: 480, gapPx: NaN, samples: 0, foundShare: 0.5, unseenShare: 0 }), 480, 'it is found: no change');
  assert.equal(nextSize({ size: 960, samples: 0, foundShare: 0, unseenShare: 0 }), 960);
});

test('a size that is not in the ladder is left alone (the user chose it)', () => {
  assert.equal(nextSize({ size: 320, gapPx: 5, samples: 30 }), 320);
  assert.deepEqual(SIZES, [480, 640, 960]);
});

test('starting from the largest size, a scene whose gap is 12 px at 480 settles at 640, never back and forth', () => {
  for (const g0 of [9, 10.5, 12, 14, 20, 40]) {
    let size = 960;
    const seen = [size];
    for (let step = 0; step < 8; step++) {
      const next = nextSize({ size, gapPx: (g0 * size) / 480, samples: 30 });
      if (next === size) break;
      size = next; seen.push(size);
    }
    assert.equal(nextSize({ size, gapPx: (g0 * size) / 480, samples: 30 }), size, `gap ${g0}: settles at ${size} after ${seen.join(' -> ')}`);
    assert.ok(new Set(seen).size === seen.length, `gap ${g0}: ${seen.join(' -> ')} never visits a size twice`);
  }
});
