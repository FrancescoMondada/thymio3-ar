// Bright spots in a camera picture: the LEDs of the robot, for the AR test.
//
// The picture is RGBA (what a canvas gives back). A pixel counts as lit when
//   - its brightest channel (HSV's V, not the luma: a red LED, luma 30 %, counts as much as a white one) is at or
//     above `threshold`, and
//   - it is brighter than the neighbourhood by `contrast` (the mean of the (2r+1)² pixels around it): a white
//     robot body, or a bright window, is bright everywhere and is not a spot, an LED on it is. `contrast` 0 turns
//     this off.
// A spot is a group of lit pixels that touch (8 neighbours), of a plausible size and shape: the thin bright rim that
// the contrast test leaves along the edge of a bright object is long and thin, an LED is round.
// The position of a spot is the centre of gravity of its pixels, each weighted by how far it is over the threshold,
// so it moves by a fraction of a pixel and not by whole pixels when the LED changes a little. It is in picture
// pixels, the top left corner of the picture being (0, 0) and the middle of the first pixel (0.5, 0.5).

// The name of a colour: 'blanc' (not coloured), 'rouge', 'jaune' (yellow and amber), 'vert', 'cyan', 'bleu', 'magenta',
// or 'sombre'. The 16 Lego LEDs of the robot are green; the ring round the touch pad is amber; the four body LEDs
// shine through the plastic in whatever colour they are given.
export function colorName(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 40) return 'sombre';
  const d = max - min;
  if (d / max < 0.15) return 'blanc';
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 20 || h >= 340) return 'rouge';
  if (h < 70) return 'jaune';
  if (h < 165) return 'vert';
  if (h < 200) return 'cyan';
  if (h < 260) return 'bleu';
  return 'magenta';
}

export class SpotFinder {
  constructor() {
    this.w = 0;
    this.h = 0;
    this.v = null;        // the brightest channel of each pixel
    this.sum = null;      // integral image of v, (w+1) x (h+1): the sum over any rectangle in four reads
    this.lit = null;      // 0 not lit, 1 lit, 2 lit and already in a spot
    this.stack = null;    // the pixels of the spot being traced
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.v = new Uint8Array(w * h);
    this.sum = new Uint32Array((w + 1) * (h + 1));
    this.lit = new Uint8Array(w * h);
    this.stack = new Int32Array(w * h);
  }

  // -> { spots, brightest, lit }
  //    spots     [{ x, y, area, peak, weight, w, h, color }] the biggest weight first (at most `maxSpots`)
  //    brightest the highest value of any pixel (so that one can see where to put the threshold)
  //    lit       how many pixels are lit, whatever the spot they are in (or none)
  find(rgba, w, h, threshold, opts = {}) {
    this.resize(w, h);
    const v = this.v;
    const n = w * h;
    let brightest = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
      const m = r > g ? (r > b ? r : b) : (g > b ? g : b);
      v[i] = m;
      if (m > brightest) brightest = m;
    }
    return this.trace(rgba, w, h, threshold, opts, brightest);
  }

  // The same on a picture that is already one value per pixel (0..255): the response of the blink detector (lockin.js),
  // the difference of a picture with the LEDs on and one with them off. No colour then: the spots say 'clignotant'.
  findFromValues(values, w, h, threshold, opts = {}) {
    this.resize(w, h);
    const n = w * h;
    this.v.set(values.length === n ? values : values.subarray(0, n));
    let brightest = 0;
    for (let i = 0; i < n; i++) if (this.v[i] > brightest) brightest = this.v[i];
    return this.trace(null, w, h, threshold, opts, brightest);
  }

  trace(rgba, w, h, threshold, { contrast = 0, radius = 8, minArea = 2, maxArea = 5000, maxSpots = 64, minFill = 0.3, maxAspect = 3 } = {}, brightest) {
    const { v, sum, lit, stack } = this;
    const n = w * h;

    // which pixels are lit
    const w1 = w + 1;
    if (contrast > 0) {
      for (let y = 0; y < h; y++) {
        let row = 0;
        const base = y * w, a = y * w1, b = (y + 1) * w1;
        for (let x = 0; x < w; x++) {
          row += v[base + x];
          sum[b + x + 1] = sum[a + x + 1] + row;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (v[i] < threshold) { lit[i] = 0; continue; }
      if (contrast <= 0) { lit[i] = 1; continue; }
      const y = (i / w) | 0, x = i - y * w;
      const x0 = x > radius ? x - radius : 0, x1 = x + radius < w ? x + radius : w - 1;
      const y0 = y > radius ? y - radius : 0, y1 = y + radius < h ? y + radius : h - 1;
      const total = sum[(y1 + 1) * w1 + x1 + 1] - sum[y0 * w1 + x1 + 1] - sum[(y1 + 1) * w1 + x0] + sum[y0 * w1 + x0];
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      lit[i] = v[i] * count - total >= contrast * count ? 1 : 0;
    }

    // the spots: groups of lit pixels
    const spots = [];
    let litCount = 0;
    for (let i = 0; i < n; i++) {
      if (lit[i] !== 1) continue;
      let sp = 0;
      stack[sp++] = i;
      lit[i] = 2;
      let area = 0, sw = 0, sx = 0, sy = 0, peak = 0;
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      let cr = 0, cg = 0, cb = 0, cn = 0;           // the colour: the mean of the pixels that are not white-hot
      while (sp > 0) {
        const p = stack[--sp];
        const y = (p / w) | 0;
        const x = p - y * w;
        const wt = v[p] - threshold + 1;
        if (rgba) {
          const j = p * 4;
          const pr = rgba[j], pg = rgba[j + 1], pb = rgba[j + 2];
          if (Math.min(pr, pg, pb) <= 215) { cr += pr; cg += pg; cb += pb; cn++; }
        }
        area++;
        sw += wt;
        sx += wt * x;
        sy += wt * y;
        if (v[p] > peak) peak = v[p];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        const xl = x > 0, xr = x < w - 1;
        if (y > 0) {
          const q = p - w;
          if (xl && lit[q - 1] === 1) { lit[q - 1] = 2; stack[sp++] = q - 1; }
          if (lit[q] === 1) { lit[q] = 2; stack[sp++] = q; }
          if (xr && lit[q + 1] === 1) { lit[q + 1] = 2; stack[sp++] = q + 1; }
        }
        if (xl && lit[p - 1] === 1) { lit[p - 1] = 2; stack[sp++] = p - 1; }
        if (xr && lit[p + 1] === 1) { lit[p + 1] = 2; stack[sp++] = p + 1; }
        if (y < h - 1) {
          const q = p + w;
          if (xl && lit[q - 1] === 1) { lit[q - 1] = 2; stack[sp++] = q - 1; }
          if (lit[q] === 1) { lit[q] = 2; stack[sp++] = q; }
          if (xr && lit[q + 1] === 1) { lit[q + 1] = 2; stack[sp++] = q + 1; }
        }
      }
      litCount += area;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (area >= minArea && area <= maxArea && area >= minFill * bw * bh && Math.max(bw, bh) <= maxAspect * Math.min(bw, bh)) {
        const color = !rgba ? 'clignotant' : cn ? colorName(cr / cn, cg / cn, cb / cn) : 'blanc';
        spots.push({ x: sx / sw + 0.5, y: sy / sw + 0.5, area, peak, weight: sw, w: bw, h: bh, color });
      }
    }
    spots.sort((a, b) => b.weight - a.weight);
    if (spots.length > maxSpots) spots.length = maxSpots;
    return { spots, brightest, lit: litCount };
  }

  // The lit pixels shown in magenta and the rest darkened, in place: to see what the settings let through.
  // (Call it after find(), with the same picture.)
  paintMask(rgba) {
    const lit = this.lit;
    for (let i = 0, j = 0; i < lit.length; i++, j += 4) {
      if (lit[i] !== 0) {
        rgba[j] = 255; rgba[j + 1] = 0; rgba[j + 2] = 200;
      } else {
        rgba[j] >>= 2; rgba[j + 1] >>= 2; rgba[j + 2] >>= 2;
      }
    }
  }
}
