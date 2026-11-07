import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSize, SIZES } from '../src/autosize.js';

test('LEDs too small (under 11 px apart): a bigger size; too big (over 42 px): a smaller one; between: the same', () => {
  assert.equal(nextSize({ size: 480, gapPx: 8, samples: 30 }), 640);
  assert.equal(nextSize({ size: 640, gapPx: 8, samples: 30 }), 960);
  assert.equal(nextSize({ size: 960, gapPx: 8, samples: 30 }), 960, 'the largest stays');
  assert.equal(nextSize({ size: 960, gapPx: 60, samples: 30 }), 640);
  assert.equal(nextSize({ size: 480, gapPx: 60, samples: 30 }), 480, 'the smallest stays');
  assert.equal(nextSize({ size: 480, gapPx: 27, samples: 30 }), 480);
});

test('no oscillation: applying the rule again and again, with the gap growing and shrinking with the size, settles and never turns back', () => {
  for (const g0 of [4, 6, 8, 10.5, 14, 27, 41, 43, 60, 90, 120]) {              // gap in pixels at 480
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
