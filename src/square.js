// A filter by SHAPE for the 4 arcs of the ring that blink together: they are 4 points at 90 degrees on a circle, so in
// the picture they are the corners of a convex quadrilateral (any 4 points in general position are the image of a
// square: the shape alone cannot say more than that), not too skinny, with sides that change only gradually with the
// perspective. Of all the spots found, keep the best 4 that make such a quadrilateral.
//
// A test that DOES say something: when the 4 arcs are chosen so that their square has its sides parallel to the axes of
// the robot (arcs NE, SE, SW, NW), two sides of the square are parallel to the row of Lego LEDs, so the row's line and
// those two sides meet at one point of the picture, the vanishing point of the robot's lateral axis (at infinity, hence
// parallel in the picture, when the camera looks straight down). `rowLine` is that line; the residual of the chosen
// quadrilateral is given back so that the page can say whether the parallelism holds on the robot (it is also what tells
// the arcs N E S W from the arcs NE SE SW NW). With `preferParallel` the quadrilaterals whose opposite sides do not meet
// on the row line are put behind the others: only once the parallelism has been seen on the robot.
//
// residual: in homogeneous coordinates (x and y divided by SCALE), the vanishing point V of a pair of opposite sides and
// the row line L = (a, b, c) with a^2 + b^2 = 1: |L . V| / |V|. For a vanishing point at infinity it is the sine of the
// angle between the row and the sides; for a finite one, about the distance from V to the row divided by the distance
// from V to the origin (in SCALE units).
//
// The 4 blobs must also be about the same size (the same arc seen 4 times: at most `maxSizeRatio` between the largest and the
// smallest), which refuses a quadrilateral made of one arc and three fragments of a halo.
//
// Cost: the strongest `maxCandidates` spots are tried, C(16, 4) = 1820 quadrilaterals.

const SCALE = 500;

const hom = (p) => [p.x / SCALE, p.y / SCALE, 1];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lineOf = (p, q) => cross(hom(p), hom(q));

// residual of a line `L` (3-vector, not normalised) against a point `V` (homogeneous)
function residual(L, V) {
  const nl = Math.hypot(L[0], L[1]), nv = Math.hypot(V[0], V[1], V[2]);
  if (nl < 1e-12 || nv < 1e-12) return Infinity;
  return Math.abs(L[0] * V[0] + L[1] * V[1] + L[2] * V[2]) / (nl * nv);
}

// -> { chosen: [4 spots in order around the shape], full: true, sides, vanishing: { residual, pair } | null, centre } or
//    { chosen: [], full: false }
// all: also `candidates`, the best `topK` different quadrilaterals (each the 4 corners in order around): see pickAligned
export function pickSquare(spots, { maxCandidates = 16, minSide = 6, maxOpposite = 2, maxDiagonal = 4.5, maxSideRatio = 5, minArea = 0.08, maxSizeRatio = 4, diagonalBand = 0.3, rowLine = null, preferParallel = false, all = false, topK = 8 } = {}) {
  const cand = spots.slice().sort((a, b) => (b.weight ?? b.area ?? 1) - (a.weight ?? a.area ?? 1)).slice(0, maxCandidates);
  const m = cand.length;
  let best = null;
  const valid = [];
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) for (let k = j + 1; k < m; k++) for (let l = k + 1; l < m; l++) {
    const r = evaluate([cand[i], cand[j], cand[k], cand[l]], { minSide, maxOpposite, maxDiagonal, maxSideRatio, minArea, maxSizeRatio, diagonalBand, rowLine, preferParallel });
    if (r) { if (all) valid.push(r); if (!best || r.score > best.score) best = r; }
  }
  if (!best) return { chosen: [], full: false, ...(all ? { candidates: [] } : {}) };
  return all ? { ...best, full: true, candidates: valid.sort((a, b) => b.score - a.score).slice(0, topK).map((r) => r.chosen) } : { ...best, full: true };
}

function evaluate(pts, { minSide, maxOpposite, maxDiagonal, maxSideRatio, minArea, maxSizeRatio, diagonalBand, rowLine, preferParallel }) {
  // the 4 arcs are the same size in the picture, give or take the perspective (on the user's photo, areas 430, 415, 374, 365 px):
  // a fragment next to a whole arc is not one of them
  const areas = pts.map((p) => p.area ?? 1);
  const sizeRatio = Math.max(...areas) / Math.max(1, Math.min(...areas));
  if (sizeRatio > maxSizeRatio) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const P = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // convex: the turns all go the same way
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(turn) < 1e-9) return null;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return null;
  }
  const side = (i) => Math.hypot(P[(i + 1) % 4].x - P[i].x, P[(i + 1) % 4].y - P[i].y);
  const sides = [0, 1, 2, 3].map(side);
  if (Math.min(...sides) < minSide) return null;
  // a square seen from 15 degrees has sides about 4 times apart, never 8; and it is not a sliver (area against the longest side squared)
  if (Math.max(...sides) / Math.min(...sides) > maxSideRatio) return null;
  let area = 0;
  for (let i = 0; i < 4; i++) area += P[i].x * P[(i + 1) % 4].y - P[(i + 1) % 4].x * P[i].y;
  if (Math.abs(area) / 2 < minArea * Math.max(...sides) ** 2) return null;
  const opp1 = Math.max(sides[0], sides[2]) / Math.min(sides[0], sides[2]);
  const opp2 = Math.max(sides[1], sides[3]) / Math.min(sides[1], sides[3]);
  if (opp1 > maxOpposite || opp2 > maxOpposite) return null;
  const d02 = Math.hypot(P[2].x - P[0].x, P[2].y - P[0].y), d13 = Math.hypot(P[3].x - P[1].x, P[3].y - P[1].y);
  if (Math.max(d02, d13) / Math.min(d02, d13) > maxDiagonal) return null;
  // where the diagonals cross: well inside both (the image of the centre of a square)
  const rx = P[2].x - P[0].x, ry = P[2].y - P[0].y, sx = P[3].x - P[1].x, sy = P[3].y - P[1].y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((P[1].x - P[0].x) * sy - (P[1].y - P[0].y) * sx) / den;
  const u = ((P[1].x - P[0].x) * ry - (P[1].y - P[0].y) * rx) / den;
  // the image of the middle of a square is near the middle of each diagonal: exactly at it without perspective, and a camera 15 cm away at 20
  // degrees moves it by about 0.1. Within 0.3 of the ends, then: a quadrilateral that includes a stray spot is rarely this regular
  if (t < diagonalBand || t > 1 - diagonalBand || u < diagonalBand || u > 1 - diagonalBand) return null;

  const weight = pts.reduce((s, p) => s + (p.weight ?? p.area ?? 1), 0);
  let score = weight * (1 - 0.3 * (((opp1 - 1) + (opp2 - 1)) / 2) / (maxOpposite - 1)) * (1 - 0.3 * (Math.abs(t - 0.5) + Math.abs(u - 0.5))) * (1 - 0.3 * (sizeRatio - 1) / (maxSizeRatio - 1));
  let vanishing = null;
  if (rowLine) {
    const L = lineOf(rowLine.p, rowLine.q);
    const v1 = cross(lineOf(P[0], P[1]), lineOf(P[2], P[3])), v2 = cross(lineOf(P[1], P[2]), lineOf(P[3], P[0]));
    const r1 = residual(L, v1), r2 = residual(L, v2);
    vanishing = r1 <= r2 ? { residual: r1, pair: 0 } : { residual: r2, pair: 1 };
    // a soft preference, not a rejection, and OFF by default: it only holds if the arcs are the ones whose square is parallel to
    // the row (and N points to the nose: not checked on the robot). Left on with the wrong arcs it would pick a stray quadrilateral
    // that happens to be parallel over the true square. By default the residual is only measured, for the page to report.
    if (preferParallel) score *= 1 - 0.6 * Math.min(1, vanishing.residual / 0.1);
  }
  return { chosen: P, sides, vanishing, centre: { x: cx, y: cy }, score };
}

// Three of the four corners found: where is the fourth? The corners of a square seen in perspective are the corners of a quadrilateral whose
// diagonals cross near their middles, so for three consecutive corners A, B, C (B the middle one) the fourth is about A + C - B (exact without
// perspective, a tenth of a side off at 45 degrees). Which of the three is the middle one is not known: each gives a hypothesis (sides at least
// `minSide`, the two sides within `maxSideRatio` (3.5: seen from 20 degrees the sides of a square differ by up to 2.9), the angle at B between 25 and 155 degrees),
// the likeliest first (equal sides, a right angle). The best triple is the strongest, of arcs of about the same strength and size.
// -> { chosen: [3 spots], hypotheses: [{ predicted: { x, y }, side, score }, ...], predicted, side } (predicted and side: the first hypothesis) or null
export function completeSquare(spots, { maxCandidates = 12, minSide = 6, maxSideRatio = 3.5, maxSizeRatio = 4, minAngleDeg = 25, maxAngleDeg = 155 } = {}) {
  const cand = spots.slice().sort((a, b) => (b.weight ?? b.area ?? 1) - (a.weight ?? a.area ?? 1)).slice(0, maxCandidates);
  const m = cand.length;
  let best = null;
  const cosMin = Math.cos((maxAngleDeg * Math.PI) / 180), cosMax = Math.cos((minAngleDeg * Math.PI) / 180);
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) for (let k = j + 1; k < m; k++) {
    const trio = [cand[i], cand[j], cand[k]];
    const areas = trio.map((p) => p.area ?? 1);
    const sizeRatio = Math.max(...areas) / Math.max(1, Math.min(...areas));
    if (sizeRatio > maxSizeRatio) continue;
    const ws = trio.map((p) => p.weight ?? p.area ?? 1), weight = ws.reduce((a, b) => a + b, 0);
    const evenness = Math.sqrt(Math.min(...ws) / Math.max(...ws));              // a weak spot among strong ones is not one of the arcs
    const hyp = [];
    for (let b = 0; b < 3; b++) {
      const B = trio[b], A = trio[(b + 1) % 3], C = trio[(b + 2) % 3];
      const ab = { x: A.x - B.x, y: A.y - B.y }, cb = { x: C.x - B.x, y: C.y - B.y };
      const la = Math.hypot(ab.x, ab.y), lc = Math.hypot(cb.x, cb.y);
      if (la < minSide || lc < minSide) continue;
      const ratio = Math.max(la, lc) / Math.min(la, lc);
      if (ratio > maxSideRatio) continue;
      const cos = (ab.x * cb.x + ab.y * cb.y) / (la * lc);
      if (cos < cosMin || cos > cosMax) continue;
      const shape = (1 - 0.4 * (ratio - 1) / (maxSideRatio - 1)) * (1 - 0.4 * Math.abs(cos) / Math.max(Math.abs(cosMin), Math.abs(cosMax)));
      hyp.push({ predicted: { x: A.x + C.x - B.x, y: A.y + C.y - B.y }, side: (la + lc) / 2, score: shape });
    }
    if (!hyp.length) continue;
    hyp.sort((p, q) => q.score - p.score);
    const score = weight * evenness * hyp[0].score * (1 - 0.3 * (sizeRatio - 1) / (maxSizeRatio - 1));
    if (!best || score > best.score) best = { chosen: trio, hypotheses: hyp, predicted: hyp[0].predicted, side: hyp[0].side, score };
  }
  return best;
}
