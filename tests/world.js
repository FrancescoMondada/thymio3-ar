// A synthetic scene with the REAL geometry of the robot (src/layout.js), seen from straight above at `s` px per mm, so that the
// same scene can be given at any zoom: the Lego LEDs (green discs 4.8 mm across), the arcs of the ring (amber, 3.2 mm thick, 34
// degrees long, at radius 26 mm), a white body and a dark table. Not a test itself.
import { RING, legoPoint, ring } from '../src/layout.js';

export function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// -> a function frame({ lego: [[rowName, k], ...], arcs: [i, ...], dx, dy, rnd, arcGain, junk, wood })  (RGBA)
export function world({ s = 2.6 } = {}) {
  // the picture holds x in [-50, 50] mm and y in [-35, 75] mm (the robot's top and a margin), whatever the zoom
  const W = Math.round(100 * s + 40), H = Math.round(110 * s + 40), ox = W / 2, oy = 75 * s + 20;
  const px = (X, Y, dx = 0, dy = 0) => [ox + dx + s * X, oy + dy - s * Y];
  function frame({ lego = [], arcs = [], dx = 0, dy = 0, rnd, arcGain = 1, junk = false, wood = false, noise = 5 }) {
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const X = (x - ox - dx) / s, Y = -(y - oy - dy) / s, k = (y * W + x) * 4;
      let r, g, b;
      if (X > -48 && X < 48 && Y > -35 && Y < 72) { r = 228; g = 225; b = 218; }                       // the body
      else if (wood) { const gr = 1 + 0.14 * Math.sin(X * 0.9 + 4 * Math.sin(Y * 0.05)) + 0.05 * Math.sin(Y * 0.3); r = 200 * gr; g = 150 * gr; b = 100 * gr; }
      else { r = 34 + 8 * Math.sin(X * 0.2) * Math.cos(Y * 0.15); g = r; b = r; }
      rgba[k] = r + (rnd() - 0.5) * noise; rgba[k + 1] = g + (rnd() - 0.5) * noise; rgba[k + 2] = b + (rnd() - 0.5) * noise; rgba[k + 3] = 255;
    }
    const blend = (k, c, a) => { for (let ch = 0; ch < 3; ch++) rgba[k + ch] = rgba[k + ch] * (1 - a) + c[ch] * a; };
    const disc = (X, Y, rMm, c) => {
      const [cx, cy] = px(X, Y, dx, dy), r = rMm * s;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) blend((y * W + x) * 4, c, 1 - 0.5 * (d / r) ** 2);
      }
    };
    for (const [row, k] of lego) { const [X, Y] = legoPoint(row, k); disc(X, Y, 2.4, [60, 255, 40]); }
    // the arcs: the points whose distance to the middle of the ring is 26 mm +- 1.6 and whose bearing is that of the arc +- 17 degrees
    for (const i of arcs) {
      const [cx, cy] = px(RING.cx, RING.cy, dx, dy), rr = (RING.r + 3) * s;
      for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const ex = (x + 0.5 - cx) / s, ey = -(y + 0.5 - cy) / s, d = Math.hypot(ex, ey);
        if (Math.abs(d - RING.r) > 1.6) continue;
        const phi = (Math.atan2(ex, ey) * 180) / Math.PI;                      // clockwise from N
        if (Math.abs((((phi - i * 45 + 540) % 360) - 180)) <= 17) blend((y * W + x) * 4, [255 - Math.abs((rnd() - 0.5) * 12), 255 - Math.abs((rnd() - 0.5) * 12), 24], arcGain);
      }
    }
    if (junk) disc(70, 40, 4, [255, 200, 40]);                                 // an amber thing steady on the table, to the right of the robot
    return rgba;
  }
  return { W, H, s, px, frame, arcCentre: (i, dx = 0, dy = 0) => { const [X, Y] = ring(i); const [x, y] = px(X, Y, dx, dy); return { x, y }; }, ledPoint: (row, k, dx = 0, dy = 0) => { const [X, Y] = legoPoint(row, k); const [x, y] = px(X, Y, dx, dy); return { x, y }; } };
}
