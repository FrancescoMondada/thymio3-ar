// Homographies: the map from the plane of the robot (mm, x to the right, y to the nose) to the picture (px). It is the whole state of the
// tracker (tracker.js): with it, every LED and every arc has a predicted place in the picture, at any zoom and any tilt, and the scale is
// not a number measured on the row but a property of the map.
//
// H is an array of 9 numbers, row by row, with H[8] = 1:   [x, y, w]^T = H [X, Y, 1]^T,  picture point = (x / w, y / w).
//
// fitHomography: least squares through 4 points or more (Hartley's normalisation of both sets first, so that millimetres and pixels
// do not spoil the conditioning), null when the points do not fix a map (all on a line, or fewer than 4).
// ransacHomography: the same with outliers: every set of 4 points is tried (at most 8 points are matched here: 70 sets), the one with most
// points within `tol` px wins, and the map is fitted again on all of its inliers.

export const applyH = (H, X, Y) => {
  const w = H[6] * X + H[7] * Y + H[8];
  return { x: (H[0] * X + H[1] * Y + H[2]) / w, y: (H[3] * X + H[4] * Y + H[5]) / w };
};

export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  return inv.map((v) => v / inv[8]);
}

const multiply = (P, Q) => {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += P[r * 3 + k] * Q[k * 3 + c];
  return out;
};

// Hartley: translate to the centroid, scale so that the mean distance to it is sqrt(2)
function normalisation(pts) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n, cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  const k = d > 1e-12 ? Math.SQRT2 / d : 1;
  return { T: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], k, cx, cy };
}

// solves M v = r (n x n, Gauss with partial pivoting); null when singular
function solve(M, r) {
  const n = r.length, A = M.map((row, i) => [...row, r[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(A[row][col]) > Math.abs(A[piv][col])) piv = row;
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let row = col + 1; row < n; row++) {
      const f = A[row][col] / A[col][col];
      for (let k = col; k <= n; k++) A[row][k] -= f * A[col][k];
    }
  }
  const v = new Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let s = A[row][n];
    for (let k = row + 1; k < n; k++) s -= A[row][k] * v[k];
    v[row] = s / A[row][row];
  }
  return v;
}

// src: [{ x, y }] in mm, dst: [{ x, y }] in px, same length >= 4
export function fitHomography(src, dst) {
  const n = src.length;
  if (n < 4 || dst.length !== n) return null;
  const ns = normalisation(src), nd = normalisation(dst);
  const rows = [], rhs = [];
  for (let i = 0; i < n; i++) {
    const X = ns.k * (src[i].x - ns.cx), Y = ns.k * (src[i].y - ns.cy), x = nd.k * (dst[i].x - nd.cx), y = nd.k * (dst[i].y - nd.cy);
    rows.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); rhs.push(x);
    rows.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); rhs.push(y);
  }
  // normal equations (8 x 8)
  const M = Array.from({ length: 8 }, () => new Array(8).fill(0)), r = new Array(8).fill(0);
  for (let i = 0; i < rows.length; i++) for (let a = 0; a < 8; a++) { r[a] += rows[i][a] * rhs[i]; for (let b = 0; b < 8; b++) M[a][b] += rows[i][a] * rows[i][b]; }
  const h = solve(M, r);
  if (!h) return null;
  const Hn = [...h, 1];
  const Tdinv = invertH(nd.T);
  const H = multiply(multiply(Tdinv, Hn), ns.T);
  if (!H.every(Number.isFinite) || Math.abs(H[8]) < 1e-12) return null;
  return H.map((v) => v / H[8]);
}

export const reprojection = (H, src, dst) => src.map((p, i) => { const q = applyH(H, p.x, p.y); return Math.hypot(q.x - dst[i].x, q.y - dst[i].y); });

// -> { H, inliers: [indexes], rms } or null
export function ransacHomography(src, dst, { tol = 3, minInliers = 4 } = {}) {
  const n = src.length;
  if (n < 4) return null;
  let best = null;
  const idx = [0, 1, 2, 3];
  const tryset = (set) => {
    const H = fitHomography(set.map((i) => src[i]), set.map((i) => dst[i]));
    if (!H) return;
    const err = reprojection(H, src, dst), inl = err.map((e, i) => (e <= tol ? i : -1)).filter((i) => i >= 0);
    const score = inl.length * 1000 - err.filter((e, i) => inl.includes(i)).reduce((a, b) => a + b, 0);
    if (inl.length >= minInliers && (!best || score > best.score)) best = { H, inl, score };
  };
  const rec = (start, depth) => {
    if (depth === 4) { tryset(idx.slice()); return; }
    for (let i = start; i <= n - (4 - depth); i++) { idx[depth] = i; rec(i + 1, depth + 1); }
  };
  rec(0, 0);
  if (!best) return null;
  const H = fitHomography(best.inl.map((i) => src[i]), best.inl.map((i) => dst[i])) || best.H;
  const err = reprojection(H, best.inl.map((i) => src[i]), best.inl.map((i) => dst[i]));
  return { H, inliers: best.inl, rms: Math.sqrt(err.reduce((a, b) => a + b * b, 0) / err.length) };
}

// px per mm of the map at the point (X, Y) of the plane: the square root of the area the Jacobian gives to a square millimetre
export function scaleAt(H, X, Y) {
  const w = H[6] * X + H[7] * Y + H[8], x = H[0] * X + H[1] * Y + H[2], y = H[3] * X + H[4] * Y + H[5];
  const dxdX = (H[0] * w - x * H[6]) / (w * w), dxdY = (H[1] * w - x * H[7]) / (w * w);
  const dydX = (H[3] * w - y * H[6]) / (w * w), dydY = (H[4] * w - y * H[7]) / (w * w);
  return Math.sqrt(Math.abs(dxdX * dydY - dxdY * dydX));
}
