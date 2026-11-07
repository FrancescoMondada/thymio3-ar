// The synthetic video shared by the detector tests (lockin.test.js, pairdiff.test.js). Not a test itself.
// A synthetic video of the robot seen from above: a dark textured table, a white body under the LEDs (steady and
// bright), the 16 green LEDs in two rows of 8 (blinking, or not), and steady lights of other colours (the ring,
// a blue and a red light). `dx`, `dy`: the whole picture moved by that many pixels (a hand that shakes).
export const W = 320, H = 180;
export const LEDS = [];
for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) LEDS.push({ x: 160 + (k - 3.5) * 21, y: 90 + (row - 0.5) * 21 });
export const EXTRA = [
  { x: 60, y: 40, rgb: [50, 80, 255], r: 5 },      // blue
  { x: 250, y: 150, rgb: [255, 50, 25], r: 7 },    // red glow
  { x: 70, y: 120, rgb: [255, 180, 25], r: 4 }, { x: 90, y: 135, rgb: [255, 180, 25], r: 4 }, { x: 55, y: 135, rgb: [255, 180, 25], r: 4 },
];

export function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

export function frame({ on, extra = true, noise = 6, dx = 0, dy = 0, rnd, leds = LEDS }) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = x - dx, Y = y - dy;
      let v = 22 + 10 * Math.sin(X * 0.11) * Math.cos(Y * 0.07);                // the table, with some texture
      if (X >= 20 && X < 300 && Y >= 45 && Y < 135) v = 170;                      // the white body (twice as wide as the strip of LEDs), as grey as the phone shows it
      const k = (y * W + x) * 4;
      v += (rnd() - 0.5) * noise;
      rgba[k] = v; rgba[k + 1] = v; rgba[k + 2] = v; rgba[k + 3] = 255;
    }
  }
  // a lit LED replaces the colour under it, more and more towards its middle (the stud turns green: measured on a
  // photo, a stud (152,167,158) goes to (143,251,19)); `rgb` is its colour at the middle
  const spot = ({ x, y, rgb = [150, 255, 40], r = 3.6 }) => {
    for (let j = Math.floor(y + dy - r - 1); j <= Math.ceil(y + dy + r + 1); j++) {
      for (let i = Math.floor(x + dx - r - 1); i <= Math.ceil(x + dx + r + 1); i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const d = Math.hypot(i + 0.5 - (x + dx), j + 0.5 - (y + dy));
        if (d > r) continue;
        const c = 1 - (d / r) ** 2, k = (j * W + i) * 4;
        for (let ch = 0; ch < 3; ch++) rgba[k + ch] = rgba[k + ch] * (1 - c) + rgb[ch] * c;
      }
    }
  };
  if (on) leds.forEach(spot);
  if (extra) EXTRA.forEach(spot);
  return rgba;
}

// times (ms) of pictures at `fps`, each late or early by up to `jitter` ms, a share `drop` of them missing
export function times(count, { fps = 30, jitter = 0, drop = 0, t0 = 1000, rnd }) {
  const out = [];
  for (let i = 0, k = 0; out.length < count; i++, k++) {
    if (drop && rnd() < drop) continue;
    out.push(t0 + (1000 * i) / fps + (rnd() - 0.5) * 2 * jitter);
  }
  return out;
}

