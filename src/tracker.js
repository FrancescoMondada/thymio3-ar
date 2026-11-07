// The state of what is seen is ONE thing: the homography H from the plane of the robot (mm) to the picture (px) (homography.js). With it, the
// 4 LEDs of the row and the 4 arcs of the ring each have a predicted place in the picture, whatever the zoom and the tilt, and what the
// tracker does with each picture is ask, at each of those 8 places, "is there a response here?" (evidence.js), then fit H again to the
// answers. No threshold on the whole picture, no list of candidates to choose from, no windows with margins for the worst case: the windows
// are small, a few millimetres round a place that was predicted.
//
//   acquire  there is no H yet (or it was lost): `found` (what locate.js picked: the 4 corners of the square of arcs, the spots of the row) gives
//            it: H through the 4 corners; a square looks the same turned by a quarter, so the 4 turns are tried and the one for which the row
//            falls on the spots of the row (or on a response of the green map) is taken; the same for the layout of the row (which end of the
//            row is LED 0: `mirror`, kept once known: it is a property of the robot).
//   track    H of the last picture predicts the places; each is looked up in the maps of the colour of its set; those that answer (more than a
//            floor that follows the strength the set has been answering with) correct H: the FRESH answers (map P: the set that is lit now) by
//            RANSAC so that one stray blob does not pull it (the ring: the whole map; the row, on a line: a shift only). Three arcs and the
//            row are enough.
//   coast    too few fresh answers to correct H: it is kept, as it was; after 8 pictures like that, it is lost.
//
// The positions the maps give: P (what lit up since an older picture) is where a set is NOW, N (what went dark) is where it was 0.1 to 0.3 s ago,
// so the places are searched in both and the radius carries a share for the movement of the phone.
import { fitHomography, ransacHomography, applyH, scaleAt } from './homography.js';
import { blobNear } from './evidence.js';
import { ring, legoPoint, rowName, ROW_GAP } from './layout.js';

export const FLOOR = 20;                        // a response under this is noise (0..255)

// the places of the LEDs of the group and of the arcs of the set, in the plane of the robot, for a layout of the row (mirror = +1 or -1)
export function expectedPoints({ group, circle, mirror = 1 }) {
  const pts = [];
  if (group >= 0) {
    const name = rowName(group), par = group % 2;
    for (let j = 0; j < 4; j++) { const k = par + 2 * j, [X, Y] = legoPoint(name, k); pts.push({ id: `row${k}`, set: 'row', colour: 'green', X: mirror < 0 ? -X : X, Y }); }
  }
  if (circle >= 0) for (let i = 0; i < 8; i++) if (i % 2 === circle) { const [X, Y] = ring(i); pts.push({ id: `arc${i}`, set: 'ring', colour: 'amber', X, Y, arc: i }); }
  return pts;
}
const ringIds = (circle) => [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i % 2 === circle);       // clockwise from N, as pickSquare orders the corners on the screen

// the affine map (a b c / d e f) that takes the points `from` to the points `to` (3 or more, not on a line), least squares; null if they are on a line
function affineCorrection(from, to) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  from.forEach((p, i) => {
    const v = [p.x, p.y, 1];
    for (let a = 0; a < 3; a++) { rx[a] += v[a] * to[i].x; ry[a] += v[a] * to[i].y; for (let b = 0; b < 3; b++) M[a][b] += v[a] * v[b]; }
  });
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), scale = M[0][0] * M[1][1] * M[2][2];
  if (!(Math.abs(D) > 1e-9 * Math.max(1, scale))) return null;
  const cramer = (r) => [0, 1, 2].map((col) => { const m = M.map((row, i) => row.map((v, j) => (j === col ? r[i] : v))); return det(m) / D; });
  return [...cramer(rx), ...cramer(ry)];
}
// H followed by the affine map A = [a b c d e f] of the picture
function corrected(H, A) {
  const [a, b, c, d, e, f] = A;
  return [a * H[0] + b * H[3] + c * H[6], a * H[1] + b * H[4] + c * H[7], a * H[2] + b * H[5] + c * H[8],
    d * H[0] + e * H[3] + f * H[6], d * H[1] + e * H[4] + f * H[7], d * H[2] + e * H[5] + f * H[8], H[6], H[7], H[8]];
}
// H followed by a shift of the picture by (dx, dy) px
function shifted(H, dx, dy) {
  return [H[0] + dx * H[6], H[1] + dx * H[7], H[2] + dx * H[8], H[3] + dy * H[6], H[4] + dy * H[7], H[5] + dy * H[8], H[6], H[7], H[8]];
}

export class Tracker {
  constructor() {
    this.mirror = 0;                            // 0: not known yet, +1 / -1 once an acquisition has chosen
    this.reset();
  }

  reset() {
    this.H = null;
    this.coast = 0;
    this.rotation = null;
    this.signal = { green: 120, amber: 90 };    // how strong the sets answer: the floor follows
  }

  // maps: { green: [P, N], amber: [P, N] } (Uint8 pictures w x h);  found: { row: [spots along the line] | null, ring: [4 corners around] | null }
  // motion: the speed of the phone, deg/s;  group, circle: what the robot was asked to light (script.js)
  update({ maps, w, h, group, circle, found = null, motion = 0 }) {
    let state = 'idle', acquired = false;
    if (circle < 0 || group < 0) { this.reset(); return this.result('idle', [], null); }            // the row alone fixes no map: nothing to track
    if (!this.H) {
      acquired = this.acquire(found, { maps, w, h, group, circle, motion });
      state = acquired ? 'acquire' : 'lost';
      if (!acquired) return this.result('lost', [], null);
    }
    const obs = this.match(this.H, this.mirror || 1, { maps, w, h, group, circle, motion });
    // Consistency first. With 4 points a map has no redundancy (any 4 points fit exactly): one stray blob in a window would be accepted and
    // would drag the map off. But the answers of a phone that moves between two pictures are all displaced by about the same amount from the
    // places that were predicted: a point whose displacement is not near the middle one is not the LED or the arc, whatever its strength.
    // (An N answer is older, so it is allowed more.)
    const s0 = scaleAt(this.H, 0, 26), tol = 3 + 0.08 * motion * s0;
    const med = (a) => { const v = [...a].sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const freshFirst = obs.filter((o) => o.matched && o.blob.map === 0);
    if (freshFirst.length >= 2) {
      const mx = med(freshFirst.map((o) => o.blob.x - o.px.x)), my = med(freshFirst.map((o) => o.blob.y - o.px.y));
      const cx = freshFirst.reduce((a, o) => a + o.px.x, 0) / freshFirst.length, cy = freshFirst.reduce((a, o) => a + o.px.y, 0) / freshFirst.length;
      for (const o of freshFirst) {
        // a zoom or a turn moves the points of the plane by different amounts: the share allowed grows with the distance to the middle of them
        const gate = 4 + 0.1 * motion * s0 + 0.08 * Math.hypot(o.px.x - cx, o.px.y - cy);
        if (Math.hypot(o.blob.x - o.px.x - mx, o.blob.y - o.px.y - my) > gate) { o.matched = false; o.rejected = true; }
      }
    }
    const hit = obs.filter((o) => o.matched);
    // Which answers are FRESH? What the map P shows is where a set is now; what the map N shows, where it was 0.1 to 0.3 s ago. The two sets blink
    // in turn, so each picture has one fresh set (the one that is lit) and one old (the one that has just gone dark). Fitting H on both would pull
    // it backwards by the movement of the phone in between: the ring lit gives 4 fresh points, enough for the whole map; the row lit gives
    // 4 fresh points on a line, which fix only where the robot is, not how it is turned: the map is shifted by what they say and no more.
    const fresh = hit.filter((o) => o.blob.map === 0);
    let rms = null, updated = false;
    const freshRing = fresh.filter((o) => o.set === 'ring');
    // a correction of the map as rich as the fresh answers allow: the whole map (4 points or more, RANSAC), an affine correction (3 points not on a
    // line: the ring with one arc missing), or a shift (the row: 3 or 4 points on a line)
    if (freshRing.length >= 3 && fresh.length >= 4) {
      const fit = ransacHomography(fresh.map((o) => ({ x: o.X, y: o.Y })), fresh.map((o) => ({ x: o.blob.x, y: o.blob.y })), { tol, minInliers: 4 });
      if (fit) {
        this.H = fit.H; rms = fit.rms; updated = true;
        fresh.forEach((o, i) => { o.inlier = fit.inliers.includes(i); });
      }
    }
    if (!updated && freshRing.length >= 3) {
      const A = affineCorrection(freshRing.map((o) => o.px), freshRing.map((o) => ({ x: o.blob.x, y: o.blob.y })));
      if (A) { this.H = corrected(this.H, A); updated = true; }
    }
    if (!updated && fresh.length >= 3) {
      let dx = 0, dy = 0;
      for (const o of fresh) { dx += o.blob.x - o.px.x; dy += o.blob.y - o.px.y; }
      dx /= fresh.length; dy /= fresh.length;
      if (Math.hypot(dx, dy) < 12 * s0 + 2) { this.H = shifted(this.H, dx, dy); updated = true; }
    }
    if (updated) {
      this.coast = 0;
      for (const o of hit) this.signal[o.colour] = Math.min(255, 0.9 * this.signal[o.colour] + 0.1 * o.v);
      if (state !== 'acquire') state = 'track';
    } else this.coast++;
    // lost only after 8 pictures with no correction (a picture or two with too few answers is a coast, not a loss: the map is kept as it was)
    if (this.coast > 8) { this.H = null; this.coast = 0; state = 'lost'; }
    else if (state === 'idle') state = 'coast';
    if (state !== 'lost' && this.coast > 0 && state !== 'acquire') state = 'coast';
    return this.result(state, obs, rms);
  }

  // the 8 places the map H predicts, and what answers at each (the strongest blob within a radius that follows the scale and the speed of the phone)
  match(H, mirror, { maps, w, h, group, circle, motion }) {
    const obs = [];
    for (const p of expectedPoints({ group, circle, mirror })) {
      const px = applyH(H, p.X, p.Y), s = scaleAt(H, p.X, p.Y);
      const r = ((p.set === 'row' ? 6 : 10) + 0.15 * motion) * s + 2;
      const tau = Math.max(FLOOR, 0.3 * this.signal[p.colour]);
      // P is where the set IS (fresh), N where it WAS. The real maps are the max over several older pictures, so a set that is lit now shows in N too,
      // at the place it had in an older picture of the same phase, and about as strong: when both answer, the fresh one is taken. A set that has just
      // gone dark answers in N only (P has only strays there, weaker): the stronger one then.
      const fresh = blobNear([maps[p.colour][0]], w, h, px.x, px.y, r), old = blobNear([maps[p.colour][1]], w, h, px.x, px.y, r);
      let blob = null;
      if (fresh && old) blob = fresh.v >= 0.6 * old.v ? fresh : { ...old, map: 1 };
      else if (fresh) blob = fresh;
      else if (old) blob = { ...old, map: 1 };
      obs.push({ ...p, px, r, blob, matched: !!blob && blob.v >= tau, v: blob ? blob.v : 0 });
    }
    return obs;
  }

  result(state, obs, rms) {
    const row = obs.filter((o) => o.set === 'row'), ringPts = obs.filter((o) => o.set === 'ring');
    const ok = (o) => o.matched && o.inlier !== false;
    return {
      state, tracking: !!this.H && state !== 'lost', H: this.H, mirror: this.mirror, rotation: this.rotation, rms,
      scale: this.H ? scaleAt(this.H, 0, 26) : NaN, points: obs,
      expected: obs.length, matched: obs.filter(ok).length, rowMatched: row.filter(ok).length, ringMatched: ringPts.filter(ok).length,
      complete: obs.length > 0 && obs.every(ok),
    };
  }

  // the first map. found.rings: the candidate squares, each the 4 corners of the square of arcs ordered around on the screen (one when 4 arcs were found;
  // when only 3 were, one per hypothesis for the fourth: locate.js); found.row: the 3 or 4 spots of the row. found.ring: one square (the same as rings = [ring])
  acquire(found, { maps, w, h, group, circle, motion = 0 }) {
    const squares = found && (found.rings || (found.ring ? [found.ring] : [])).filter((q) => q && q.length === 4);
    if (!squares || !squares.length) return false;
    const ids = ringIds(circle);
    let best = null;
    for (const square of squares) for (const mirror of this.mirror ? [this.mirror] : [1, -1]) {
      const corners = square.map((c) => ({ x: c.x, y: c.y }));
      const arcsMm = (rot) => square.map((_, j) => { const [X, Y] = ring(ids[(j + rot) % 4]); return { x: X, y: Y }; });
      for (let rot = 0; rot < 4; rot++) {
        const H = fitHomography(arcsMm(rot), corners);
        if (!H) continue;
        // does the map explain the pictures? the 8 places asked in the maps: at least 6 must answer (the 4 corners it was made from answer by
        // construction, so the row must, and the ring's other maps too): a square found among strays, with a row that falls elsewhere, is refused
        const answers = this.match(H, mirror, { maps, w, h, group, circle, motion }).filter((o) => o.matched).length;
        if (answers < 6) continue;
        const rowMm = expectedPoints({ group, circle: -1, mirror });
        const s = scaleAt(H, 0, 26);
        let score = answers;
        if (found.row && found.row.length >= 3) {
          // the predicted LEDs of the row against the spots found: each spot to its nearest prediction, the mean distance in units of the gap
          const pred = rowMm.map((p) => applyH(H, p.X, p.Y));
          const d = found.row.map((sp) => Math.min(...pred.map((q) => Math.hypot(q.x - sp.x, q.y - sp.y))));
          const dist = d.reduce((a, b) => a + b, 0) / d.length / Math.max(1e-6, ROW_GAP * s);       // 0 is perfect
          if (dist > 0.4) continue;
          score = answers - dist;
        }
        if (!best || score > best.score) best = { score, H, mirror, rot };
      }
    }
    if (!best) return false;
    this.H = best.H; this.mirror = best.mirror; this.rotation = best.rot; this.coast = 0;
    return true;
  }
}
