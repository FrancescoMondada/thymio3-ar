import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairDiff } from '../src/pairdiff.js';
import { discWindow } from '../src/layout.js';

// two LEDs blink together, one in the zone and one far from it (a lamp in the background that blinks, or whatever lights up between two pictures)
function blinkingPair() {
  const w = 120, h = 80, pd = new PairDiff({ halfMs: 200, measure: 'green' });
  const spots = [{ x: 30, y: 40 }, { x: 100, y: 15 }];
  let last = 0;
  for (let t = 0; t <= 1500; t += 33) {
    const on = Math.floor(t / 200) % 2 === 0, rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255;
    if (on) for (const s of spots) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = ((s.y + dy) * w + s.x + dx) * 4; rgba[j] = 0; rgba[j + 1] = 255; rgba[j + 2] = 0; }
    if (pd.push(rgba, w, h, t) && on) last = t;
    if (on && t >= 1000 && t % 400 >= 100) break;               // stop in a flash: the LEDs are on NOW
  }
  return { pd, last };
}

test('the search in a zone only finds what is in the zone, and only what lights up now when asked (P)', () => {
  const { pd } = blinkingPair();
  const size = { minArea: 2, maxArea: 200 };
  const all = pd.find(40, size, null, 'P');
  assert.equal(all.spots.length, 2, 'both, everywhere');
  const zone = pd.find(40, size, discWindow({ x: 32, y: 42 }, 14), 'P');
  assert.equal(zone.spots.length, 1);
  assert.ok(Math.abs(zone.spots[0].x - 30) < 2 && Math.abs(zone.spots[0].y - 40) < 2, 'the one in the zone');
  const elsewhere = pd.find(40, size, discWindow({ x: 60, y: 60 }, 10), 'P');
  assert.equal(elsewhere.spots.length, 0, 'nothing there');
});
