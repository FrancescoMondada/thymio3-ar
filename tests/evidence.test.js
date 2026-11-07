import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobNear } from '../src/evidence.js';

const W = 120, H = 100;
const blank = () => new Uint8Array(W * H);
function paint(map, cx, cy, sigma, amp) {
  for (let y = Math.floor(cy - 4 * sigma); y <= Math.ceil(cy + 4 * sigma); y++) for (let x = Math.floor(cx - 4 * sigma); x <= Math.ceil(cx + 4 * sigma); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    map[y * W + x] = Math.max(map[y * W + x], Math.round(amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma))));
  }
}

test('the strongest blob near the expected place is found, with its centre to a fraction of a pixel', () => {
  const P = blank(), N = blank();
  paint(P, 60.3, 40.6, 2, 150);
  const b = blobNear([P, N], W, H, 63, 43, 8);
  assert.ok(b);
  assert.ok(Math.hypot(b.x - 60.3, b.y - 40.6) < 0.3, `at ${b.x.toFixed(2)}, ${b.y.toFixed(2)}`);
  assert.ok(b.v >= 140 && b.v <= 150, `peak ${b.v} (150 at the centre, sampled between pixels)`);
  assert.equal(b.map, 0);
});

test('it looks in both maps and says which: what lit up (P) or what went dark (N)', () => {
  const P = blank(), N = blank();
  paint(N, 30, 30, 2, 90);
  const b = blobNear([P, N], W, H, 31, 29, 6);
  assert.equal(b.map, 1);
  paint(P, 32, 31, 2, 120);
  assert.equal(blobNear([P, N], W, H, 31, 29, 6).map, 0, 'the stronger of the two');
});

test('nothing near the place, or only blobs outside the radius: null', () => {
  const P = blank(), N = blank();
  paint(P, 90, 80, 2, 200);
  assert.equal(blobNear([P, N], W, H, 30, 30, 10), null);
  assert.ok(blobNear([P, N], W, H, 85, 75, 10));
  assert.equal(blobNear([P, N], W, H, 85, 55, 10), null, 'a blob just outside the radius is not one');
});

test('a distraction next to the true blob does not take its place: the strongest within the radius wins', () => {
  const P = blank(), N = blank();
  paint(P, 50, 50, 2, 140);
  paint(P, 58, 50, 2, 60);
  const b = blobNear([P, N], W, H, 54, 50, 10);
  assert.ok(Math.abs(b.x - 50) < 0.5, `at ${b.x.toFixed(1)}`);
  assert.equal(b.v, 140);
});

test('a long blob (an arc) is measured whole: its centre is the middle of the blob, not the peak', () => {
  const P = blank(), N = blank();
  for (let t = -10; t <= 10; t++) paint(P, 60 + t, 50 + 0.2 * t, 2.2, 100 - Math.abs(t) * 2);     // 21 px long, a little brighter at the middle
  const b = blobNear([P, N], W, H, 60, 50, 6, { grow: 3.5 });
  assert.ok(Math.abs(b.x - 60) < 1.5 && Math.abs(b.y - 50) < 1, `centre ${b.x.toFixed(1)}, ${b.y.toFixed(1)}`);
  assert.ok(b.area > 60, `area ${b.area}`);
});

test('near the border of the picture: no crash, the part inside is looked at', () => {
  const P = blank(), N = blank();
  paint(P, 3, 3, 2, 100);
  assert.ok(blobNear([P, N], W, H, 0, 0, 8));
  assert.equal(blobNear([P, N], W, H, -50, -50, 8), null);
});
