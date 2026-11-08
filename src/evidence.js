// What the pictures say at a PLACE, not everywhere: the tracker predicts where each LED and each arc must be, and asks the maps of the
// pair difference (P: what lit up since an older picture, N: what went dark: pairdiff.js) for the strongest response near that place.
// No threshold on the whole picture, no list of candidates to choose among: one question per expected point.

// The strongest response within `r` px of (cx, cy) in any of the `maps` (Uint8 pictures of w x h), and where its blob is.
// The blob is the pixels that are at least `frac` of the peak and connected to it, within `grow` x r of it: its weighted centre is the
// position (an arc is a long blob: the centre is not the peak).
// -> { x, y, v (the peak), area, map (which of the maps) } or null when everything there is 0
// maxV: responses stronger than this are not looked at (a light that comes out of a hole in the side of the body, a reflection: far brighter than a LED)
// choose: 'strongest' (the default) or 'nearest': among the blobs of the window whose peak is at least minV, the one whose centre is nearest to (cx, cy), the strongest
// of two that are as near (within 1 px): the place was predicted, so what is NEAR it is the LED, and a brighter light a few px away (the light that comes out of a
// hole in the side of the body, a reflection) is not
export function blobNear(maps, w, h, cx, cy, r, { frac = 0.4, grow = 2.5, maxV = Infinity, choose = 'strongest', minV = 1 } = {}) {
  if (choose === 'nearest') return nearestBlob(maps, w, h, cx, cy, r, { frac, grow, maxV, minV });
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1) return null;
  let best = null;
  for (let m = 0; m < maps.length; m++) {
    const a = maps[m];
    let pv = 0, px = -1, py = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const v = a[y * w + x];
      if (v > pv && v <= maxV) { pv = v; px = x; py = y; }
    }
    if (pv > 0 && (!best || pv > best.v)) best = { v: pv, px, py, map: m };
  }
  if (!best) return null;
  // the blob of the peak: a flood fill (4 neighbours) over the pixels at least frac x peak, at most grow x r from the peak
  const a = maps[best.map], limit = frac * best.v, R2 = (grow * r) ** 2;
  const seen = new Set([best.py * w + best.px]), stack = [[best.px, best.py]];
  let sw = 0, sx = 0, sy = 0, area = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    const v = a[y * w + x];
    sw += v; sx += v * x; sy += v * y; area++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (seen.has(k) || a[k] < limit || a[k] > maxV || (nx - best.px) ** 2 + (ny - best.py) ** 2 > R2) continue;
      seen.add(k); stack.push([nx, ny]);
    }
  }
  return { x: sx / sw, y: sy / sw, v: best.v, area, map: best.map };
}

function nearestBlob(maps, w, h, cx, cy, r, { frac, grow, maxV, minV }) {
  // the common case first, which costs one scan: the strongest blob is already near the place, so it is the one
  const quick = blobNear(maps, w, h, cx, cy, r, { frac, grow, maxV });
  if (!quick || quick.v < minV) return quick && quick.v >= minV ? quick : null;
  if (Math.hypot(quick.x - cx, quick.y - cy) <= 0.45 * r) return quick;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1) return null;
  let best = null;
  for (let m = 0; m < maps.length; m++) {
    const a = maps[m], used = new Set(), cand = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {          // one scan of the window: the pixels that could be the peak of a blob
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const v = a[y * w + x];
      if (v >= minV && v <= maxV) cand.push(y * w + x);
    }
    cand.sort((p, q) => a[q] - a[p]);
    let blobs = 0;
    for (const k0 of cand) {
      if (used.has(k0)) continue;
      if (++blobs > 5) break;                                                     // at most 5 blobs of a window
      const px = k0 % w, py = (k0 - px) / w, pv = a[k0];
      const limit = frac * pv, R2 = (grow * r) ** 2, seen = new Set([k0]), stack = [[px, py]];
      let sw = 0, sx = 0, sy = 0, area = 0;
      while (stack.length) {
        const [x, y] = stack.pop();
        const v = a[y * w + x];
        sw += v; sx += v * x; sy += v * y; area++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (seen.has(k) || a[k] < limit || a[k] > maxV || (nx - px) ** 2 + (ny - py) ** 2 > R2) continue;
          seen.add(k); stack.push([nx, ny]);
        }
      }
      for (const k of seen) used.add(k);
      const blob = { x: sx / sw, y: sy / sw, v: pv, area, map: m, d: Math.hypot(sx / sw - cx, sy / sw - cy) };
      if (!best || blob.d < best.d - 1 || (Math.abs(blob.d - best.d) <= 1 && blob.v > best.v)) best = blob;
    }
  }
  if (!best) return null;
  const { d, ...blob } = best;
  return blob;
}
