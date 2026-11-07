// What the page knows about WHERE the lights are on the robot, to look for one set where the other says it should be, and to
// size everything from the scale measured in the picture instead of from pixel constants (the phone gets closer, farther, or
// zooms: the same row of LEDs is 6 px or 60 px long).
//
// Robot plane, mm, x to the right, y towards the nose (the same world as the simulated scene, src/demo.js). From the user's photo
// of the top lights (721 px wide): LEDs 16 mm apart = 84 px, arcs 102 px either side of the middle of the ring = 26 mm x
// sin 45 degrees: 5.3 px/mm both ways; the middle of the ring is 175 px = 33 mm from the first row of LEDs.
//
//   ring: 8 amber arcs on a circle of radius 26 mm round (0, 26); arc i (N NE E SE S SW W NW) at i x 45 degrees clockwise from N
//   rows: the front row at y = -7, the back row at y = -15; LED k = 0..7 at x = (k - 3.5) x 8
//
// From the row, what can be said about the ring? Along the row, the scale: 16 mm between the LEDs of a group (the smallest gap
// of the 3 or 4 spots found: with 3 of the 4, at least two are neighbours). Across it, nothing exact: the tilt of the robot to the
// camera squashes the distances across the row by a factor between about 0.25 (seen from 15 degrees) and 1. So the window is in
// "row millimetres" (see ringWindowFromRow: with the tilt of the phone it can be bounded).
// From the ring, the same the other way round: the scale from the longest diagonal (52 mm if not squashed), and the row within
// 1.3 x its distance to the farthest LED of the row of the middle of the ring.
//
// Everything is a ratio to the scale, so it holds at any zoom. `inside(p)` tells whether a spot is in the window; `bbox` is
// the rectangle round it (px) for the page to look in that part of the picture only; `outline` is what the page draws.

export const RING = { cx: 0, cy: 26, r: 26 };
export const ROW_Y = { front: -7, back: -15 };
export const SQUARE_SIDE = RING.r * Math.SQRT2;            // 36.8 mm: the side of the square of arcs NE SE SW NW
export const ROW_GAP = 16;                                  // mm between the LEDs of a group (every other LED of a row)
export const ring = (i) => [RING.cx + RING.r * Math.sin((i * Math.PI) / 4), RING.cy + RING.r * Math.cos((i * Math.PI) / 4)];
export const legoPoint = (rowName, k) => [(k - 3.5) * 8, ROW_Y[rowName]];
export const rowName = (group) => (group < 2 ? 'front' : 'back');
export const groupCentreX = (group) => (group % 2 === 0 ? -6 : 6);          // even indices k = 0, 2, 4, 6: x = -28 .. 20; odd: -20 .. 28
export const ringDistance = (group) => RING.cy - ROW_Y[rowName(group)];     // 33 mm to the front row, 41 mm to the back one

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// the scale of a row of 3 or 4 spots ordered along a line: px per mm (the smallest gap is 16 mm)
export function rowScale(spots) {
  if (spots.length < 3) return NaN;
  const gaps = [];
  for (let i = 1; i < spots.length; i++) gaps.push(dist(spots[i], spots[i - 1]));
  return (spots.length === 4 ? gaps.reduce((a, b) => a + b, 0) / 3 : Math.min(...gaps)) / ROW_GAP;
}

// the scale of 4 corners of the square of arcs, ordered around: px per mm along the less squashed direction
export function ringScale(corners) {
  const d02 = dist(corners[0], corners[2]), d13 = dist(corners[1], corners[3]);
  return Math.max(d02, d13) / (2 * RING.r);
}
// ...and the mean side over the side of the square: what the page compares with the scale of the row
export function ringMeanScale(corners) {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += dist(corners[i], corners[(i + 1) % 4]);
  return sum / 4 / SQUARE_SIDE;
}

// Where the ring can be, from the 3 or 4 spots of the row (ordered along its line) -> { s, inside, bbox, outline, minSide, minGap } or null.
//
// The scale measured along the row is exact only if the camera looks across the row: looking along it, the gaps are squashed by
// sin(elevation), while the distances across the row are not. So a distance across the row, counted in "row millimetres" (pixels over
// the scale of the row), can be up to 1 / sin(elevation) times the true one. `elevDeg` is the angle of the line of sight over the table
// (the phone's tilt: the page has it); it is not exact (the robot is not always in the middle of the picture), so 12 degrees are taken off
// it, and with no elevation at all 15 degrees are assumed. The window is a capsule round the row: within D of the segment
// that goes 38 mm either side of its middle, D = 1.1 x 59 mm / sin(elevation) + 6 mm (59 mm: the farthest the ring reaches
// from the front row, 41 + 26 mm for the back one: 67, so the larger is used). Which side is the nose is not known from the row alone: both are allowed.
export function ringWindowFromRow(row, group, { elevDeg = NaN, halfAlongMm = 38 } = {}) {
  const s = rowScale(row);
  if (!(s > 0)) return null;
  const m = { x: row.reduce((a, p) => a + p.x, 0) / row.length, y: row.reduce((a, p) => a + p.y, 0) / row.length };
  const first = row[0], last = row[row.length - 1];
  const len = dist(first, last);
  if (len < 1e-6) return null;
  const u = { x: (last.x - first.x) / len, y: (last.y - first.y) / len }, n = { x: -u.y, y: u.x };
  const eLo = Number.isFinite(elevDeg) ? Math.min(90, Math.max(12, elevDeg - 12)) : 15;
  const farthest = ringDistance(group) + RING.r;                       // 59 mm (front row), 67 mm (back row)
  const D = (1.1 * farthest) / Math.sin((eLo * Math.PI) / 180) + 6;    // row mm
  const A = { x: m.x - u.x * halfAlongMm * s, y: m.y - u.y * halfAlongMm * s }, B = { x: m.x + u.x * halfAlongMm * s, y: m.y + u.y * halfAlongMm * s };
  const Dpx = D * s, abx = B.x - A.x, aby = B.y - A.y, ab2 = abx * abx + aby * aby;
  const inside = (p) => {
    const t = Math.max(0, Math.min(1, ((p.x - A.x) * abx + (p.y - A.y) * aby) / ab2));
    return Math.hypot(p.x - (A.x + t * abx), p.y - (A.y + t * aby)) <= Dpx;
  };
  const outline = [];
  const ang = Math.atan2(u.y, u.x);
  for (let i = 0; i <= 12; i++) { const a = ang - Math.PI / 2 - (i * Math.PI) / 12; outline.push({ x: B.x + Dpx * Math.cos(a), y: B.y + Dpx * Math.sin(a) }); }
  for (let i = 0; i <= 12; i++) { const a = ang + Math.PI / 2 - (i * Math.PI) / 12; outline.push({ x: A.x + Dpx * Math.cos(a), y: A.y + Dpx * Math.sin(a) }); }
  return { kind: 'ring-from-row', s, inside, bbox: boxOf(outline), outline, minSide: 0.2 * SQUARE_SIDE * s, minGap: 0.25 * ROW_GAP * s, elevDeg, D };
}

// Where the row can be, from the 4 corners of the square of arcs (ordered around) -> the same
export function rowWindowFromRing(corners, group) {
  const s = ringScale(corners);
  if (!(s > 0)) return null;
  const c = { x: corners.reduce((a, p) => a + p.x, 0) / 4, y: corners.reduce((a, p) => a + p.y, 0) / 4 };
  const dY = ringDistance(group);
  const farthest = Math.hypot(dY + 8, 34);                    // mm from the middle of the ring to the farthest LED of a group, with a margin
  const radius = 1.3 * farthest * s;
  const inside = (p) => Math.hypot(p.x - c.x, p.y - c.y) <= radius;
  const outline = Array.from({ length: 16 }, (_, i) => ({ x: c.x + radius * Math.cos((i * Math.PI) / 8), y: c.y + radius * Math.sin((i * Math.PI) / 8) }));
  return { kind: 'row-from-ring', s, inside, bbox: boxOf(outline), outline, minSide: 0.2 * SQUARE_SIDE * s, minGap: 0.25 * ROW_GAP * s };
}

function boxOf(pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// do the two scales agree (same plane, same camera)? the ratio of the row's to the ring's mean is within [0.4, 2.5] unless one of
// them is not what we think it is
export function scalesAgree(rowS, ringMeanS, { lo = 0.4, hi = 2.5 } = {}) {
  if (!(rowS > 0) || !(ringMeanS > 0)) return null;
  const r = rowS / ringMeanS;
  return { ratio: r, ok: r >= lo && r <= hi };
}
