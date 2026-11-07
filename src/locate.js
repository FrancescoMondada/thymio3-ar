// Finds the two sets of lights together, each helping the other: the 3 or 4 spots of the row on a line, the 4 spots of the ring in a
// square. A set that is seen well says where the other one must be (layout.js: the row says where the ring can be, the ring where
// the row can be, in units of the scale measured in the picture, so at any zoom), and that is used three ways:
//
//   1. a set that is missing is found among the candidates INSIDE the window the other one predicts, even if the first choice found
//      nothing (the first choice looks at the whole picture, where a stronger stray square or line may win);
//   2. if there are none, `retryRing` / `retryLine` look again in the window only, with a lower threshold than elsewhere (the page
//      gives them: PairDiff.find(lowerThreshold, size, window));
//   3. when both were found but do not fit together (the ring is not inside the row's window, or the row not inside the ring's),
//      the best pair that fits is taken instead, or the pair is reported as a mismatch.
//
// Sizes: with no scale yet, the smallest side or gap accepted is a fraction of the picture (1.2 % and 0.7 % of its long side); once
// one set gives the scale, the windows carry minimum sizes proportional to it (a fifth of a side of the square, a quarter of the
// gap between LEDs). The scales of the two sets are compared (same plane, same camera) and reported.
import { pickAligned } from './aligned.js';
import { pickSquare, completeSquare } from './square.js';
import { ringWindowFromRow, rowWindowFromRing, rowScale, ringMeanScale, scalesAgree, discWindow } from './layout.js';

// line, ring: the candidate spots of each set. group: 0..3 (four aligned LEDs of a row), -1 (the 16: no filter), -2 (none).
// -> { aligned, square, window, predicted, rescued, scales, mismatch }
//    predicted: null | 'ring-from-row' | 'row-from-ring' | 'both'; rescued: false | 'gate' | 'retry' | 'complete'
//    (square.partial: only 3 arcs were found; square.predicted is where the fourth is expected)
export function locate({ line = [], ring = [], group = 0, wantLine = true, wantRing = true, elevDeg = NaN, longSide = 480, retryLine = null, retryRing = null, gate = true, rowOpts = {}, ringOpts = {} }) {
  const baseGap = Math.max(3, 0.007 * longSide), baseSide = Math.max(5, 0.012 * longSide);
  const useRow = wantLine && group >= 0;
  let aligned = useRow ? pickAligned(line, { minGap: baseGap, ...rowOpts }) : null;
  let square = wantRing ? pickSquare(ring, { minSide: baseSide, ...ringOpts }) : null;
  const rowOk = (a = aligned) => !!(a && a.chosen.length >= 3);
  const ringOk = (q = square) => !!(q && q.full);
  const rowWindow = (a) => ringWindowFromRow(a.chosen, group, { elevDeg });            // where the ring can be, from this row
  const ringWindow = (q) => rowWindowFromRing(q.chosen, group);                        // where the row can be, from this ring
  // a row and a ring that fit: each inside the window the other gives
  const fit = (a, q) => {
    const wr = rowWindow(a), wq = ringWindow(q);
    return !!(wr && wq && q.chosen.every(wr.inside) && a.chosen.every(wq.inside));
  };
  let window = null, predicted = null, rescued = false, mismatch = false;

  if (gate && useRow && wantRing) {
    if (rowOk() && !ringOk()) {
      predicted = 'ring-from-row';
      window = rowWindow(aligned);
      if (window) {
        const inside = pickSquare(ring.filter(window.inside), { minSide: window.minSide, ...ringOpts });
        if (inside.full) { square = inside; rescued = 'gate'; }
        else if (retryRing) {
          const again = pickSquare(retryRing(window), { minSide: window.minSide, ...ringOpts });
          if (again.full) { square = again; rescued = 'retry'; }
        }
      }
    } else if (ringOk() && !rowOk()) {
      predicted = 'row-from-ring';
      window = ringWindow(square);
      if (window) {
        const inside = pickAligned(line.filter(window.inside), { minGap: window.minGap, ...rowOpts });
        if (rowOk(inside)) { aligned = inside; rescued = 'gate'; }
        else if (retryLine) {
          const again = pickAligned(retryLine(window), { minGap: window.minGap, ...rowOpts });
          if (rowOk(again)) { aligned = again; rescued = 'retry'; }
        }
      }
    } else if (rowOk() && ringOk()) {
      predicted = 'both';
      if (!fit(aligned, square)) {
        let best = null;
        const wr = rowWindow(aligned);
        const altRing = wr ? pickSquare(ring.filter(wr.inside), { minSide: wr.minSide, ...ringOpts }) : null;
        if (ringOk(altRing) && fit(aligned, altRing)) best = { aligned, square: altRing, score: aligned.score + altRing.score };
        const wq = ringWindow(square);
        const altRow = wq ? pickAligned(line.filter(wq.inside), { minGap: wq.minGap, ...rowOpts }) : null;
        if (rowOk(altRow) && fit(altRow, square) && (!best || altRow.score + square.score > best.score)) best = { aligned: altRow, square, score: altRow.score + square.score };
        if (best) { aligned = best.aligned; square = best.square; rescued = 'gate'; }
        else mismatch = true;                                          // both were found, and they do not belong together
      }
    }
  }

  // three of the four arcs found: the fourth is about A + C - B; look for it there, with a lower threshold than elsewhere, and only there
  if (wantRing && !ringOk()) {
    const pool = window && window.kind === 'ring-from-row' ? ring.filter(window.inside) : ring;
    const part = completeSquare(pool, { minSide: window?.minSide ?? baseSide });
    if (part) {
      outer: for (const h of part.hypotheses) {                       // which of the three is the middle corner is not known: try each
        const near = discWindow(h.predicted, 0.4 * h.side);
        const known = pool.filter((p) => !part.chosen.includes(p) && near.inside(p));
        const tries = known.length ? known : (retryRing ? retryRing(near).filter((p) => !part.chosen.includes(p)) : []);
        for (const extra of tries.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))) {
          const sq = pickSquare([...part.chosen, extra], { minSide: window?.minSide ?? baseSide, ...ringOpts });
          if (sq.full) { square = sq; rescued = 'complete'; if (!predicted) predicted = 'ring-from-arcs'; break outer; }
        }
      }
      if (!ringOk()) square = { chosen: part.chosen, full: false, partial: true, predicted: part.predicted };
    }
  }

  let scales = null;
  if (rowOk() && ringOk()) {
    scales = { row: rowScale(aligned.chosen), ringMean: ringMeanScale(square.chosen) };
    const agree = scalesAgree(scales.row, scales.ringMean);
    scales.ratio = agree?.ratio ?? NaN;
    if (agree && !agree.ok) mismatch = true;
  } else if (rowOk()) scales = { row: rowScale(aligned.chosen) };
  else if (ringOk()) scales = { ringMean: ringMeanScale(square.chosen) };
  return { aligned, square, window, predicted, rescued, scales, mismatch };
}
