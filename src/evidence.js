// What the pictures say at a PLACE, not everywhere: the tracker predicts where each LED and each arc must be, and asks the maps of the
// pair difference (P: what lit up since an older picture, N: what went dark: pairdiff.js) for the strongest response near that place.
// No threshold on the whole picture, no list of candidates to choose among: one question per expected point.

// The strongest response within `r` px of (cx, cy) in any of the `maps` (Uint8 pictures of w x h), and where its blob is.
// The blob is the pixels that are at least `frac` of the peak and connected to it, within `grow` x r of it: its weighted centre is the
// position (an arc is a long blob: the centre is not the peak).
// -> { x, y, v (the peak), area, map (which of the maps) } or null when everything there is 0
export function blobNear(maps, w, h, cx, cy, r, { frac = 0.4, grow = 2.5 } = {}) {
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
      if (v > pv) { pv = v; px = x; py = y; }
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
      if (seen.has(k) || a[k] < limit || (nx - best.px) ** 2 + (ny - best.py) ** 2 > R2) continue;
      seen.add(k); stack.push([nx, ny]);
    }
  }
  return { x: sx / sw, y: sy / sw, v: best.v, area, map: best.map };
}
