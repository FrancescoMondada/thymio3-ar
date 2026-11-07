import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSize, SIZES } from '../src/autosize.js';

test('LEDs too small (under 11 px apart): a bigger size; still 15 px apart at the smaller size: the smaller one; between: the same', () => {
  assert.equal(nextSize({ size: 480, gapPx: 8, samples: 30 }), 640);
  assert.equal(nextSize({ size: 640, gapPx: 8, samples: 30 }), 640, 'the automatic ladder stops at 640 (960 was the worst size in the 8th test)');
  assert.equal(nextSize({ size: 640, gapPx: 20, samples: 30 }), 480, '15 px at 480');
  assert.equal(nextSize({ size: 640, gapPx: 19, samples: 30 }), 640);
  assert.equal(nextSize({ size: 480, gapPx: 60, samples: 30 }), 480, 'the smallest stays');
  assert.equal(nextSize({ size: 480, gapPx: 27, samples: 30 }), 480);
  assert.equal(nextSize({ size: 960, gapPx: 8, samples: 30 }), 960, 'a size chosen by hand (960) is left alone');
});

test('no oscillation: applying the rule again and again, with the gap growing and shrinking with the size, settles and never turns back', () => {
  for (const start of [480, 640]) {
    for (const g0 of [4, 6, 8, 10.5, 12, 14, 15, 18, 27, 41, 60, 90]) {            // gap in pixels at 480
      let size = start;
      const seen = [size];
      for (let step = 0; step < 6; step++) {
        const next = nextSize({ size, gapPx: (g0 * size) / 480, samples: 30 });
        if (next === size) break;
        size = next; seen.push(size);
      }
      assert.ok(new Set(seen).size === seen.length, `start ${start}, gap ${g0}: ${seen.join(' -> ')} visits a size twice`);
      assert.equal(nextSize({ size, gapPx: (g0 * size) / 480, samples: 30 }), size, `start ${start}, gap ${g0}: settles at ${size}`);
    }
  }
});

test('no scale yet: a bigger size is tried only when something responds and nothing is found; never past 640', () => {
  assert.equal(nextSize({ size: 480, gapPx: 5, samples: 5 }), 640, 'with no scale and nothing found, a bigger size is tried when something responds');
  assert.equal(nextSize({ size: 640, samples: 0, foundShare: 0, unseenShare: 0 }), 640);
  assert.equal(nextSize({ size: 480, gapPx: NaN, samples: 0, foundShare: 0, unseenShare: 0.9 }), 480, 'the phone points away from the robot: nothing to conclude');
  assert.equal(nextSize({ size: 480, gapPx: NaN, samples: 0, foundShare: 0.5, unseenShare: 0 }), 480, 'it is found: no change');
});

test('a size that is not in the ladder is left alone (the user chose it)', () => {
  assert.equal(nextSize({ size: 320, gapPx: 5, samples: 30 }), 320);
  assert.deepEqual(SIZES, [480, 640]);
});
