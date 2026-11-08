// A filter by ALIGNMENT (the user's idea): the robot blinks 4 LEDs of one row, 16 mm apart, so the 4 spots the page is
// looking for lie on a straight line at about even spacing. Of all the spots a detector finds (the 4, plus whatever else
// changed between two pictures: a ghost of a moving edge, a reflection), keep the 4 that are on a line.
//
// A straight line stays a straight line in the picture whatever the angle (a perspective projection keeps lines), and the
// even spacing stays an ordered one: seen from one end the gaps grow or shrink steadily, they never grow and shrink
// again. So a set of `n` spots is accepted when
//   - every spot is within `lineTol` x (length of the set) + 1 px of the straight line fitted through them,
//   - the gaps along that line are all at least `minGap` px, none more than `maxRatio` times another, and a gap is
//     never more than `maxStep` times its neighbour (perspective changes the gaps gradually: seen at 20 degrees from 20 cm,
//     the neighbouring gaps of a 16 mm row differ by about 1.5 times),
//   - and they are steady in one direction (with a margin of 25 % for the error on the centres).
// Of the accepted sets the best wins: the sum of the spots' weights, less if the line is not straight or the gaps
// are uneven (so that a stray spot on the line's extension does not replace one of the real LEDs).
//
// Cost: the strongest `maxCandidates` spots are tried, C(24, 4) = 10626 sets, about a millisecond.

const GAP_MARGIN = 1.25;

// -> { chosen: [spot, ...] along the line, full: boolean, rms, angleDeg, gaps } or { chosen: [], full: false }
// all: also `candidates`, the best `topK` different sets (of 4, or of 3 when there are fewer than 3 of 4), each as an array of spots along its line: the page that
// starts the map of the dual flash tries them against the square of arcs instead of trusting the first (a light in line with the row is a better "row" than the row)
export function pickAligned(spots, { n = 4, maxCandidates = 24, lineTol = 0.06, maxRatio = 3, maxStep = 1.8, minGap = 4, allowFewer = true, all = false, topK = 6 } = {}) {
  const cand = spots.slice().sort((a, b) => (b.weight ?? b.area ?? 1) - (a.weight ?? a.area ?? 1)).slice(0, maxCandidates);
  const found = [];
  let first = null;
  for (let k = n; k >= (allowFewer ? 3 : n); k--) {
    const best = bestSet(cand, k, { lineTol, maxRatio, maxStep, minGap }, all ? found : null);
    if (best && !first) first = { ...best, full: k === n };
    if (first && (!all || found.length >= 3)) break;
  }
  if (!first) return { chosen: [], full: false, ...(all ? { candidates: [] } : {}) };
  if (!all) return first;
  const seen = new Set(), candidates = [];
  for (const r of found.sort((a, b) => b.score - a.score)) {
    const key = r.chosen.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(r.chosen);
    if (candidates.length >= topK) break;
  }
  return { ...first, candidates };
}

function bestSet(cand, k, opts, collect = null) {
  const m = cand.length;
  if (m < k) return null;
  let best = null;
  const idx = new Array(k).fill(0);
  const rec = (start, depth) => {
    if (depth === k) {
      const r = evaluate(idx.map((i) => cand[i]), opts);
      if (r) { if (collect) collect.push(r); if (!best || r.score > best.score) best = r; }
      return;
    }
    for (let i = start; i <= m - (k - depth); i++) { idx[depth] = i; rec(i + 1, depth + 1); }
  };
  rec(0, 0);
  return best;
}

function evaluate(pts, { lineTol, maxRatio, maxStep, minGap }) {
  const k = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= k; cy /= k;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);              // direction of the line of best fit
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const along = pts.map((p) => ({ p, t: (p.x - cx) * ux + (p.y - cy) * uy, d: -(p.x - cx) * uy + (p.y - cy) * ux }));
  along.sort((a, b) => a.t - b.t);
  const length = along[k - 1].t - along[0].t;
  if (length < (k - 1) * minGap) return null;
  let worst = 0, sq = 0;
  for (const a of along) { worst = Math.max(worst, Math.abs(a.d)); sq += a.d * a.d; }
  const allowed = lineTol * length + 1;
  if (worst > allowed) return null;
  const gaps = [];
  for (let i = 1; i < k; i++) gaps.push(along[i].t - along[i - 1].t);
  if (Math.min(...gaps) < minGap || Math.max(...gaps) > maxRatio * Math.min(...gaps)) return null;
  let up = true, down = true, step = 1;
  for (let i = 1; i < gaps.length; i++) {
    step = Math.max(step, gaps[i] / gaps[i - 1], gaps[i - 1] / gaps[i]);
    if (gaps[i] > maxStep * gaps[i - 1] || gaps[i - 1] > maxStep * gaps[i]) return null;
    if (gaps[i - 1] > gaps[i] * GAP_MARGIN) up = false;       // a gap that shrinks...
    if (gaps[i] > gaps[i - 1] * GAP_MARGIN) down = false;     // ...or grows, by more than the margin
  }
  if (!up && !down) return null;
  const weight = pts.reduce((s, p) => s + (p.weight ?? p.area ?? 1), 0);
  return {
    chosen: along.map((a) => a.p),
    rms: Math.sqrt(sq / k),
    angleDeg: (theta * 180) / Math.PI,
    gaps,
    score: weight * (1 - 0.5 * (worst / allowed)) * (1 - 0.5 * ((step - 1) / (maxStep - 1))),     // straighter and more even is better
  };
}
