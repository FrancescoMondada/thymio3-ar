// The state of what is seen is ONE thing: the homography H from the plane of the robot (mm) to the picture (px) (homography.js), and how fast it moves in
// the picture (v, px/s). With H, the 4 LEDs of the row and the 4 arcs of the ring each have a predicted place in the picture, whatever the zoom and the
// tilt; what the tracker does with each picture is predict (H moved by v x the time since the last picture), look where the lit set really is, and
// correct. No threshold on the whole picture, no list of candidates to choose from.
//
//   acquire  there is no H: the 4 arcs, seen in THIS picture (the map P of the amber answers at their corners: the spots of a set that is dark come from
//            the map N and are 0.1 to 0.3 s old, and a hand at 100 px/s has moved 30 px in that time), give H up to a quarter turn of the plane about the
//            middle of the ring (the four arcs are alike). The map is `pending`: only the arcs are asked for, until the row is lit.
//   resolve  the row, when it is lit, falls on its places for one of the four quarter turns (and one of the two layouts of the row, `mirror`, kept
//            once known: it is a property of the robot) only: the pattern of its places is slid over the fresh map of the green (slide), the way with
//            3 of 4 on responses, and clearly better than the other quarter turns, wins.
//   track    each picture: (1) H is moved by v x dt; (2) SNAP: the pattern of the places of the set that is lit now (row or ring) is slid over its fresh
//            map P, within a reach that grows with the speed and the time since the last correction: the shift at which most places answer (the
//            pattern, not the nearest blob of each place: the LEDs of the row are alike and 10 px apart at 70 cm); (3) each place is looked up (evidence.js)
//            and those that answer correct H: the ring (4 fresh arcs: RANSAC homography; 3: affine), the row (3 or 4 on a line: a shift only);
//            (4) v follows what the picture said about the movement (alpha-beta).
//   coast    too few fresh answers to correct H: it is kept, moved by v (slowing down); after 8 pictures like that, or 2 s without a fit by the ring,
//            it is lost. A map that has had only 3 arcs for a second (an affine correction cannot repair the shape of the map) is started again from a
//            full fresh square of arcs (`refreshed`).
//
// A place is `confirmed` when it answered fresh within the last 0.45 s: the sets blink in turn, so in each picture one answers fresh (the lit set, map P)
// and the other answered a moment ago (the map N holds it as a streak of the places it had in the last 0.3 s, too blurred to count).
//
// The maps P and N of pairdiff.js: P (what lit up since an older picture) is where a set is NOW, N (what went dark) is where it was 0.1 to 0.3 s ago.
import { fitHomography, ransacHomography, reprojection, applyH, scaleAt, compose } from './homography.js';
import { blobNear } from './evidence.js';
import { ring, legoPoint, rowName, ROW_GAP, SQUARE_SIDE } from './layout.js';

export const FLOOR = 20;                        // a response under this is noise (0..255)
export const HI_SHARE = 4;                      // a response above this many times the usual strength of its colour is not a LED (a light out of a hole in the side of the body, a reflection)
export const TAU_SHARE = 0.2;                   // a place answers when its response is this share of the usual strength of its set (LEDs of a row differ a lot)
export const TUNE = { beta: 0.7, reachK: 0.8 };   // beta: how much of what a picture says about the speed of the map is taken (alpha-beta filter); reachK: the share of speed x time the search reach carries
export const OLD_AGE = 0.2;                     // s: the answers of the map N are 0.08 to 0.32 s old (pairdiff.js: references aged 0.4 to 1.6 half periods)
export const REFRESH_MS = 1000;                 // the ring has not given a full fit (4 arcs) for this long: a full fresh square, if locate.js sees one, replaces the map
export const PENDING_MS = 2000;                 // a map found from the ring alone must be given its turn (the row says which way round) within this long, or it is dropped
export const CONFIRM_MS = 450;                  // a place is confirmed if it answered fresh within this long (the sets blink in turn: the one that is dark answered 0.2 s ago)
export const ZONE_MEMORY_S = 6;                 // after a loss the robot is looked for round where it was for this long; then everywhere
export const OUTSIDE_PICTURES = 6;               // the middle of the ring has been outside the picture for this many pictures in a row: the robot is gone, the map is dropped
export const RING_LOST_MS = 2000;               // ... and for this long: the map is lost (the row alone keeps a map alive by shifts, but cannot say how it is turned)
export const STRUGGLE_MS = 500;                 // the dual flash: no full fit (6 of the 8 lit places agreeing) for this long: the map is struggling, a start from the picture is tried against it
export const RETRY_MS = 250;                    // ... at most this often
export const MIN_SCALE = 0.25;                  // px/mm for a picture 640 px long: a map smaller than this is not the robot (the 17th report: maps of 0.07 to 0.17 held for seconds, all the places on one blob)

// the places of the LEDs of the group and of the arcs of the set, in the plane of the robot, for a layout of the row (mirror = +1 or -1).
// Each place has `set` ('row' | 'ring': what it is), `key` (the set it belongs to) and `phase` (which flash lights it).
//   the first script (a group and a ring set that alternate): the row is the phase 0, the ring the phase 1 (they are lit in turn);
//   the DUAL flash (group 4 with circle 2, leds_lego.py): the phase 0 is the front row (even) and the arcs N E S W, the phase 1 the back row (even) and the arcs NE SE SW NW.
export const isDualMode = (group, circle) => group === 4 && circle === 2;
export function expectedPoints({ group, circle, mirror = 1 }) {
  const pts = [];
  const row = (name, par, key, phase) => {
    for (let j = 0; j < 4; j++) { const k = par + 2 * j, [X, Y] = legoPoint(name, k); pts.push({ id: `${name === 'front' ? 'row' : 'rowb'}${k}`, set: 'row', key, phase, colour: 'green', X: mirror < 0 ? -X : X, Y }); }
  };
  const arcs = (par, key, phase) => {
    for (let i = 0; i < 8; i++) if (i % 2 === par) { const [X, Y] = ring(i); pts.push({ id: `arc${i}`, set: 'ring', key, phase, colour: 'amber', X, Y, arc: i }); }
  };
  if (isDualMode(group, circle)) { row('front', 0, 'rowF', 0); arcs(0, 'ringA', 0); row('back', 0, 'rowB', 1); arcs(1, 'ringB', 1); return pts; }
  if (group >= 0) row(rowName(group), group % 2, 'row', 0);
  if (circle >= 0) arcs(circle, 'ring', 1);
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

// Is H the map of a table seen from above? Finite, in front of the camera at every probe place, the places not absurdly far from the picture, a scale that is
// not absurd and varies by less than 8 across the robot. A map that fails is never kept: the 10th-12th reports had pictures where the places flew far outside the
// image and the page froze; nothing here may loop on such a map.
export function validMap(H, w, h) {
  if (!H || H.length !== 9 || !H.every(Number.isFinite)) return false;
  const L = Math.max(w, h), scales = [];
  for (const [X, Y] of [[0, 26], [-28, -7], [28, -7], [0, 52], [26, 26], [-26, 26], [0, 0]]) {
    if (!(H[6] * X + H[7] * Y + H[8] > 1e-9)) return false;
    const q = applyH(H, X, Y), sc = scaleAt(H, X, Y);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(sc)) return false;
    if (q.x < -0.6 * w || q.x > 1.6 * w || q.y < -0.6 * h || q.y > 1.6 * h) return false;
    scales.push(sc);
  }
  const mid = scales[0];
  if (!(mid * 640 / L > MIN_SCALE && mid < 0.1 * L)) return false;
  return scales.every((sc) => sc > mid / 8 && sc < mid * 8);
}

export class Tracker {
  hi(colour) { return this.known[colour] ? HI_SHARE * this.signal[colour] : Infinity; }

  constructor() {
    this.mirror = 0;                            // 0: not known yet, +1 / -1 once an acquisition has chosen
    this.stats = {};                            // per place, over the whole session: see below (the report)
    // how strong the lights answer in this view (0..255): the MEDIAN of the last 80 fresh answers of each colour. It belongs to the lights and the exposure, not to a map,
    // so a new map keeps it. (An average pulled by weak strays, or a decay with a ceiling at a multiple of it, drifted down in the 16th test to 52 for arcs of 95 to 155: the
    // ceiling then refused the stronger arcs, which cannot pull it back.)
    this.signal = { green: 120, amber: 90 };
    this.known = { green: false, amber: false };
    this.vals = { green: [], amber: [] };
    this.lastMap = null;                        // where the robot was in the picture the last time the map held (relative to the picture: it survives a change of size)
    this.reset();
  }

  reset() {
    this.H = null;
    this.coast = 0;
    this.rotation = null;
    this.v = { x: 0, y: 0 };                    // how fast the map moves in the picture (px/s): the places are predicted with it
    this.t = null;                              // time of the last picture (ms)
    this.ringT = null;                          // time of the last picture in which the ring corrected the map
    this.fixT = null;                           // time of the last picture that corrected the map at all
    this.ringFullT = null;                      // time of the last picture in which the 4 arcs gave a full fit
    this.seen = {};                             // place id -> time of its last fresh answer
    this.dt = 0;
    this.outside = 0;                           // pictures in a row in which the middle of the ring is outside the picture
    this.pending = null;                        // a map found from the ring alone: which way round it is (the row says) is not known yet
    this.fullT = null;                          // time of the last picture in which 6 or more of the 8 places of the lit flash agreed in one fit (dual flash)
    this.tryT = null;                           // time of the last start tried against a map that was struggling
    this.lostBy = null;
  }

  // The map has not been confirmed by a full fit for a while (a jump of the zoom, a hand in front, a stray that holds it): worth a start from the picture, if it is
  // not tried too often. Only with the dual flash, where the picture alone gives a whole map.
  struggling(t) {
    return !!this.dual && !!this.H && t != null && this.fullT != null && t - this.fullT > STRUGGLE_MS && (this.tryT == null || t - this.tryT >= RETRY_MS);
  }

  // how many of the 8 places of the flash `par` have a response under them in the fresh map (the same question for two maps: which one explains the picture better)
  supportOf(H, mirror, par, { maps, w, h }, signal = this.signal) {
    let n = 0;
    for (const p of expectedPoints({ group: 4, circle: 2, mirror })) {
      if (p.phase !== par) continue;
      const q = applyH(H, p.X, p.Y), s = scaleAt(H, p.X, p.Y), tau = Math.max(FLOOR, TAU_SHARE * signal[p.colour]);
      if (peakNear(maps[p.colour][0], w, h, q.x, q.y, Math.max(2, Math.ceil((p.set === 'row' ? 0.25 * ROW_GAP : 0.25 * SQUARE_SIDE) * s))) >= tau) n++;       // (a whole number of pixels: it bounds a loop over the picture)
    }
    return n;
  }

  // The robot is where it was: a map that is lost does not mean the robot went away, the phone moved a little. Where to look for it (the spots of the whole picture are
  // what a light in the background, a lamp, a reflection spoils): a disc round the last place of the middle of the ring, as big as the top of the robot (60 mm each way) with
  // a margin, growing with the time since the map was lost (a hand moves the picture by about 120 px a second, at 640 px), carried a little by the speed the map had. Null:
  // look everywhere (never mapped, a map now, lost for more than 6 s, or the disc has grown to half the picture). -> { cx, cy, r } in px of the picture w x h
  searchZone(t, w, h) {
    const m = this.lastMap;
    if (!m || this.H || t == null || m.t == null) return null;
    const dt = (t - m.t) / 1000;
    if (dt < 0 || dt > ZONE_MEMORY_S) return null;
    const L = Math.max(w, h), drift = Math.min(dt, 0.6), r = m.r * L + 0.06 * L + 0.19 * L * dt;
    if (!(r < 0.5 * L)) return null;
    return { cx: (m.cx + m.vx * drift) * w, cy: (m.cy + m.vy * drift) * h, r };
  }

  rememberMap(w, h, t) {
    const c = applyH(this.H, 0, 26), s0 = scaleAt(this.H, 0, 26);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !(s0 > 0)) return;
    this.lastMap = { t, cx: c.x / w, cy: c.y / h, r: (70 * s0) / Math.max(w, h), vx: this.v.x / w, vy: this.v.y / h };
  }

  // Does the page need the spots of the whole picture (locate.js) for this picture? Not while the map is known and healthy: the places are asked where they are
  // predicted, and the whole picture holds lights that are not LEDs (a light that comes out of a hole in the side of the body blinks like one). Yes with no map, a map
  // waiting for its row, one that is struggling (a correction missed), or one that has not had a full fit of the ring for a while (a refresh may be needed).
  wantsFound(t) {
    if (this.dual) return !this.H || this.coast > 2 || this.struggling(t);
    return !this.H || !!this.pending || this.coast > 2 || (t != null && this.ringFullT != null && t - this.ringFullT > 0.4 * REFRESH_MS);
  }

  // the picture is analysed at another size (the same view, more or fewer pixels): the map and the speed are in pixels, they follow
  rescale(sx, sy) {
    if (this.H) this.H = compose([sx, 0, 0, 0, sy, 0, 0, 0, 1], this.H);
    this.v = { x: this.v.x * sx, y: this.v.y * sy };
  }

  // maps: { green: [P, N], amber: [P, N] } (Uint8 pictures w x h);  found: { row: [spots along the line] | null, ring: [4 corners around] | null }
  // motion: the speed of the phone, deg/s;  group, circle: what the robot was asked to light (script.js)
  update({ maps, w, h, group, circle, found = null, motion = 0, t = null }) {
    let state = 'idle', acquired = false;
    const dual = isDualMode(group, circle);
    this.dual = dual;
    this.refreshed = false;
    if (circle < 0 || group < 0) { this.reset(); return this.result('idle', [], null); }            // the row alone fixes no map: nothing to track
    // the map moves in the picture as the phone moves: with the speed it had, the places are predicted where they will be NOW, not where they were at the
    // last correction (a correction comes at best every other picture, and at 70 cm the row's LEDs are 10 px apart: a hand at 70 px/s has moved a whole gap)
    let dt = 0;
    if (this.H && t != null && this.t != null) dt = Math.min(0.4, Math.max(0, (t - this.t) / 1000));
    if (t != null) this.t = t;
    this.dt = dt;
    if (this.H && dt > 0) this.H = shifted(this.H, this.v.x * dt, this.v.y * dt);
    if (this.H && !validMap(this.H, w, h)) { this.H = null; this.coast = 0; this.pending = null; this.lostBy = 'invalide'; this.nInvalid = (this.nInvalid || 0) + 1; }
    this.reacquired = false; this.tried = false;
    const tryAgain = this.struggling(t) && !!found && !!((found.rings && found.rings.length) || found.ring);
    if (!this.H || tryAgain) {
      // a map starts from the ring alone, seen in this very picture (the spots of locate.js are as old as the map they came from: up to 0.3 s for the set
      // that is dark, and a hand at 100 px/s moves 30 px in that time): the 4 arcs fix the map up to a quarter turn, and the row, when it is lit, says which
      // (a map that is struggling: the start is tried from this picture and replaces the map only if it explains more of the 8 lit places; the zoom jumped, and the old map
      // held a half-fit at the wrong scale for as long as the robot stayed in view)
      let keep = null;
      if (tryAgain) {
        this.tryT = t; this.tried = true;
        keep = { H: this.H, mirror: this.mirror, rotation: this.rotation, phase: this.phase, coast: this.coast, seen: this.seen, signal: { ...this.signal }, known: { ...this.known }, vals: { green: this.vals.green.slice(), amber: this.vals.amber.slice() } };
      }
      acquired = dual ? this.acquireDual(found, { maps, w, h }) : this.acquireRing(found, { maps, w, h, circle, group });
      if (tryAgain) {
        const sNew = acquired && validMap(this.H, w, h) ? this.supportOf(this.H, this.mirror, this.phase, { maps, w, h }) : -1, sOld = acquired ? this.supportOf(keep.H, keep.mirror, this.phase, { maps, w, h }, keep.signal) : -1;
        const better = acquired && sNew > sOld;
        this.tryInfo = { sNew, sOld, fail: this.acqFail, squares: ((found.rings || []).length), rows: ((found.rows || []).length), scaleOld: scaleAt(keep.H, 0, 26), scaleNew: acquired ? scaleAt(this.H, 0, 26) : null };
        this.tryWhy = better ? 'ok' : acquired ? 'pas mieux' : (this.acqFail && this.acqFail.reason) || 'refusé';       // (kept for the report: why the starts tried against a struggling map came to nothing)
        if (better) { this.reacquired = true; this.nReacq = (this.nReacq || 0) + 1; }
        else { Object.assign(this, { H: keep.H, mirror: keep.mirror, rotation: keep.rotation, phase: keep.phase, coast: keep.coast, seen: keep.seen, signal: keep.signal, known: keep.known, vals: keep.vals }); acquired = false; }
      } else state = acquired ? 'acquire' : 'lost';
      if (acquired && !validMap(this.H, w, h)) { this.H = null; acquired = false; this.nInvalid = (this.nInvalid || 0) + 1; }
      if (!acquired && !tryAgain) return this.result('lost', [], null);
      if (acquired) {
        if (!tryAgain) this.v = { x: 0, y: 0 };                       // (a map that replaces a struggling one keeps the speed the phone had)
        this.ringT = t; this.fixT = t; this.ringFullT = t; this.fullT = t; this.pending = dual ? null : { t0: t, n: 0 };
      }
    } else if (!dual && found && !this.pending && t != null && this.ringFullT != null && t - this.ringFullT > REFRESH_MS) {
      // three arcs have corrected the map for a second (an affine correction cannot repair the shape of the map: one wrong fit once is kept for good): a
      // full square of fresh corners, if there is one, starts the map again, from the ring; the row says again which way round it is
      const v = this.v, old = this.H, rot0 = this.rotation, seen0 = this.seen;
      // ... a square NEAR the places the map gives (each corner within 0.6 side of a different place of the ring): the refresh repairs the shape of a map, it does not
      // look for the robot again (a light from a hole in the side of the body can make a square with three arcs)
      const sidePx = SQUARE_SIDE * scaleAt(old, 0, 26), ringNow = expectedPoints({ group, circle, mirror: this.mirror || 1 }).filter((q) => q.set === 'ring').map((q) => applyH(old, q.X, q.Y));
      const near = (sq) => { const used = new Set(); return sq.every((c) => { let bi = -1, bd = 0.6 * sidePx; ringNow.forEach((q, i) => { const d = Math.hypot(q.x - c.x, q.y - c.y); if (d < bd && !used.has(i)) { bd = d; bi = i; } }); if (bi < 0) return false; used.add(bi); return true; }); };
      if (this.acquireRing(found, { maps, w, h, circle, need: 4, accept: near, group })) {
        this.rotation = rot0; this.seen = seen0; this.v = v; this.ringT = t; this.fixT = t; this.ringFullT = t; state = 'acquire'; acquired = true; this.refreshed = true;
        if (rot0 !== null) {
          // the quarter turn the map had is kept: the one for which the row falls where the old map put it (the others turn it by 58 mm or more)
          const rowMm = expectedPoints({ group, circle: -1, mirror: this.mirror || 1 }), fresh = this.H;
          let best = null;
          for (let k = 0; k < 4; k++) {
            const Hk = k ? compose(fresh, planeRotation(k)) : fresh;
            const d = rowMm.reduce((a, p) => { const q = applyH(Hk, p.X, p.Y), r = applyH(old, p.X, p.Y); return a + Math.hypot(q.x - r.x, q.y - r.y); }, 0);
            if (!best || d < best.d) best = { d, Hk };
          }
          this.H = best.Hk;
        } else this.pending = { t0: t, n: 0 };
      }
    }
    const before = this.H;
    const since = t != null && this.fixT != null ? Math.min(0.6, Math.max(dt, (t - this.fixT) / 1000)) : dt;       // s without a correction: the uncertainty of the places grows with it
    // the set that is lit now says where the map is: the pattern of its places, slid over the fresh map P, finds the shift at which the most of them answer
    // (the pattern, not the nearest blob of each place: the 4 LEDs of the row are alike and 10 px apart, the nearest blob of a place is often the neighbour's)
    const rows = !this.pending;
    let snap = this.snap({ maps, w, h, group, circle, speed: Math.hypot(this.v.x, this.v.y), since, rows });
    if (snap) { const Hs = shifted(this.H, snap.dx, snap.dy); if (validMap(Hs, w, h)) this.H = Hs; else snap = null; }
    this.snapInfo = snap;
    const obs = this.match(this.H, this.mirror || 1, { maps, w, h, group, circle, motion, v: this.v, dt: snap ? 0 : since, rows, litPhase: dual ? (snap && snap.phase != null ? snap.phase : this.phase ?? null) : null });
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
    if (dual) {
      const f0 = fresh.filter((o) => o.phase === 0).length, f1 = fresh.filter((o) => o.phase === 1).length;
      if (f0 + f1 >= 2) this.phase = f0 >= f1 ? 0 : 1; else if (snap && snap.phase != null) this.phase = snap.phase;
    }
    let rms = null, updated = false, ringFixed = false;
    const freshRing = fresh.filter((o) => o.set === 'ring');
    // a correction of the map as rich as the fresh answers allow: the whole map (4 points or more, RANSAC), an affine correction (3 points not on a
    // line: the ring with one arc missing), or a shift (the row: 3 or 4 points on a line)
    const freshRow = fresh.filter((o) => o.set === 'row');
    // the points must DETERMINE the map: the ring alone (4 arcs), or the row (3 or 4 LEDs, on a line: worth 5 of the 8 numbers of the map) with 2 arcs, or 3 arcs with 2 LEDs.
    // A row with ONE arc is 7 numbers of 8: the fit gives something, and what it gives is absurd (the 16th report: 72 maps refused for it)
    const determined = freshRing.length >= 4 || (freshRow.length >= 3 && freshRing.length >= 2) || (freshRing.length >= 3 && freshRow.length >= 2);
    if (dual && determined && fresh.length >= 5) {
      // the dual flash: the row AND the ring are lit in the same flash, 8 points that are not on a line: the whole map from this one picture, with 4 points more than it needs,
      // so that a stray answer (a light out of a hole in the side of the body) is the one that does not fit
      const src = fresh.map((o) => ({ x: o.X, y: o.Y })), dst = fresh.map((o) => ({ x: o.blob.x, y: o.blob.y }));
      // all of them agree (the usual case): one fit; else the subsets of 4 are tried and the points that fit are kept
      const all = fitHomography(src, dst), err = all ? reprojection(all, src, dst) : null;
      const fit = all && err.every((e) => e <= tol + 1) ? { H: all, inliers: err.map((_, i) => i), rms: Math.sqrt(err.reduce((a, e) => a + e * e, 0) / err.length) } : ransacHomography(src, dst, { tol: tol + 1, minInliers: 5 });
      if (fit) {
        this.H = fit.H; rms = fit.rms; updated = true; ringFixed = true;
        fresh.forEach((o, i) => { o.inlier = fit.inliers.includes(i); });
        if (t != null) { this.ringFullT = t; if (fit.inliers.length >= 6) this.fullT = t; }
      }
    }
    if (!updated && freshRing.length >= 4) {
      // (the ring only: a stray response near a place of the row, which is dark when the ring is lit, must not take the place of an arc in a fit that
      // 4 points always satisfy)
      const fit = ransacHomography(freshRing.map((o) => ({ x: o.X, y: o.Y })), freshRing.map((o) => ({ x: o.blob.x, y: o.blob.y })), { tol, minInliers: 4 });
      if (fit) {
        this.H = fit.H; rms = fit.rms; updated = true; ringFixed = true;
        freshRing.forEach((o, i) => { o.inlier = fit.inliers.includes(i); });
        if (t != null) this.ringFullT = t;
      }
    }
    if (!updated && freshRing.length >= 3) {
      const A = affineCorrection(freshRing.map((o) => o.px), freshRing.map((o) => ({ x: o.blob.x, y: o.blob.y })));
      if (A) { this.H = corrected(this.H, A); updated = true; ringFixed = true; }
    }
    if (!updated && fresh.length >= (snap && snap.set === 'row' ? 2 : 3)) {
      let dx = 0, dy = 0;
      for (const o of fresh) { dx += o.blob.x - o.px.x; dy += o.blob.y - o.px.y; }
      dx /= fresh.length; dy /= fresh.length;
      if (Math.hypot(dx, dy) < 12 * s0 + 2) { this.H = shifted(this.H, dx, dy); updated = true; }
    }
    if (updated && !validMap(this.H, w, h)) { this.H = before; updated = false; rms = null; ringFixed = false; this.nInvalid = (this.nInvalid || 0) + 1; }
    this.diag = { hit: hit.length, fresh: fresh.length, freshRing: freshRing.length, freshRow: fresh.length - freshRing.length, rejected: obs.filter((o) => o.rejected).length, how: updated ? ((freshRing.length >= 4 || (dual && fresh.length >= 5)) && obs.some((o) => o.inlier) ? 'fit' : freshRing.length >= 3 ? 'affine' : 'shift') : 'none', coast: this.coast, motion };
    if (updated) {
      this.coast = 0;
      if (ringFixed && t != null) this.ringT = t;
      if (t != null) this.fixT = t;
      // what the picture says about the speed: how far the map had to move from where it was predicted (alpha-beta)
      if (dt > 0.02 && !acquired) {
        const a = applyH(before, 0, 26), b = applyH(this.H, 0, 26);
        const vx = this.v.x + (TUNE.beta * (b.x - a.x)) / dt, vy = this.v.y + (TUNE.beta * (b.y - a.y)) / dt, sp = Math.hypot(vx, vy), cap = 1.2 * Math.max(w, h);
        this.v = sp > cap ? { x: (vx * cap) / sp, y: (vy * cap) / sp } : { x: vx, y: vy };
      }
      // the usual strength of each colour: the median of its last 80 fresh answers (see the constructor); known after 4 answers
      for (const colour of ['green', 'amber']) {
        const mine = hit.filter((o) => o.colour === colour && o.blob.map === 0 && o.inlier !== false);
        if (!mine.length) continue;
        const list = this.vals[colour];
        for (const o of mine) list.push(o.v);
        if (list.length > 80) list.splice(0, list.length - 80);
        if (list.length >= 4) { const sorted = list.slice().sort((a, b) => a - b); this.signal[colour] = Math.max(FLOOR, sorted[sorted.length >> 1]); this.known[colour] = true; }
      }
      if (state !== 'acquire') state = 'track';
    } else {
      this.coast++;
      const k = Math.pow(0.5, Math.max(dt, 0.05) / 1.0);                      // the speed is forgotten slowly while nothing confirms it (a hand does not stop in a picture)
      this.v = { x: this.v.x * k, y: this.v.y * k };
    }
    // which way round the map is: the row, when it is lit, falls on its places for one of the four quarter turns (and one of the two layouts) only
    if (this.pending && this.H) {
      this.pending.n++;
      if (this.resolveRow({ maps, w, h, group, speed: Math.hypot(this.v.x, this.v.y), since })) { this.pending = null; this.seen = {}; }
      else if (t != null ? t - this.pending.t0 > PENDING_MS : this.pending.n > 50) { this.H = null; this.coast = 0; state = 'lost'; this.lostBy = 'pending'; this.pending = null; }
    }
    // per place: how often it answers fresh when its set is lit (2 or more of its set answered fresh), the strongest response near it (answer or not), and where
    // the answers are against the places that were predicted (px): a LED that is dim, a place that is systematically off (layout of the row, height of the LEDs)
    for (const o of obs) {
      const st = (this.stats[o.id] ||= { lit: 0, hit: 0, vall: 0, dx: 0, dy: 0 });
      if (fresh.filter((q) => q.key === o.key).length < 2) continue;
      st.lit++; st.vall += o.v;
      if (o.matched && o.blob.map === 0 && o.inlier !== false) { st.hit++; st.dx += o.blob.x - o.px.x; st.dy += o.blob.y - o.px.y; }
    }
    // confirmed places: the one that answered fresh in this picture, or within the last blink period (the set that is dark now answered 0.2 s ago, and
    // the map has been following the other since: its places are where the map says). Without a clock (tests) a place is confirmed when it answers now.
    for (const o of obs) {
      const answers = o.matched && o.inlier !== false;
      if (answers && o.blob.map === 0 && t != null) this.seen[o.id] = t;
      o.confirmed = t != null ? this.H != null && this.seen[o.id] != null && t - this.seen[o.id] <= CONFIRM_MS : answers;
    }
    // a map that has left the picture (the places flew off, or the phone was turned away) is not kept: its places and the lines drawn between them would be nowhere
    if (this.H) {
      const c = applyH(this.H, 0, 26);
      this.outside = c.x < -10 || c.x > w + 10 || c.y < -10 || c.y > h + 10 ? this.outside + 1 : 0;
      if (this.outside >= OUTSIDE_PICTURES) { this.H = null; this.coast = 0; state = 'lost'; this.lostBy = 'hors image'; this.pending = null; this.outside = 0; }
    }
    // the ring has not corrected the map for too long: the row alone has kept it alive by shifts, but nothing says it is still the right map
    if (this.H && t != null && this.ringT != null && t - this.ringT > RING_LOST_MS) { this.H = null; this.coast = 0; state = 'lost'; this.lostBy = 'ring'; this.pending = null; }
    // lost only after 8 pictures with no correction (a picture or two with too few answers is a coast, not a loss: the map is kept as it was)
    if (this.H && this.coast > 8) { this.H = null; this.coast = 0; state = 'lost'; this.lostBy = 'coast'; this.pending = null; }
    else if (state === 'idle') state = 'coast';
    if (state !== 'lost' && this.coast > 0 && state !== 'acquire') state = 'coast';
    if (this.H && state !== 'lost' && t != null) this.rememberMap(w, h, t);
    return this.result(state, obs, rms);
  }

  // How far must the map be shifted for the pattern of the places that are lit together (a PHASE) to fall on the responses of the fresh maps P? Each shift within the
  // reach of the uncertainty is scored by how many of the places have a response under them (each counted up to the usual strength of its set, so that a stray blob much
  // stronger than the LEDs does not count more than one place), minus a little for the distance (the nearest shift wins a tie). The phase that is lit is the one with a
  // good score (the other has nothing in P). With the first script a phase is one set (the row, or the ring); with the dual flash it is a row AND a ring set, 8 places in
  // two colours, which a hole or a slip of one pitch along the row cannot satisfy. -> { phase, set, dx, dy, count, byKind, score } | null
  snap({ maps, w, h, group, circle, speed, since, rows = true }) {
    let best = null;
    const pts = expectedPoints({ group, circle, mirror: this.mirror || 1 }).filter((p) => rows || p.set !== 'row');
    for (const phase of [...new Set(pts.map((p) => p.phase))]) {
      const places = pts.filter((p) => p.phase === phase).map((p) => {
        const tau = Math.max(FLOOR, TAU_SHARE * this.signal[p.colour]);
        return { ...p, px: applyH(this.H, p.X, p.Y), s: scaleAt(this.H, p.X, p.Y), P: maps[p.colour][0], tau, cap: Math.max(2 * tau, 1.2 * this.signal[p.colour]), hi: this.hi(p.colour) };
      });
      if (places.length < 3) continue;
      const s0 = places.reduce((a, p) => a + p.s, 0) / places.length;
      if (!Number.isFinite(s0) || s0 <= 0 || s0 > 80) continue;
      const hasRow = places.some((p) => p.set === 'row'), hasRing = places.some((p) => p.set === 'ring');
      // once the map is known the LEDs are near where it says: the reach grows only with the speed of the phone and the time since the last correction (the cap
      // is a neighbour's distance: a LED of the row is 16 mm from the next, an arc 37 mm from the next). A light that comes out of a hole in the side of the body
      // is a blinking spot like a LED, but not near a place.
      const cap = Math.min(hasRow ? 1.4 * ROW_GAP * s0 : Infinity, hasRing && !hasRow ? 0.9 * SQUARE_SIDE * s0 : Infinity);
      const reach = Math.min(cap, ((hasRow ? 6 : 10) * s0 + 2) + TUNE.reachK * speed * since);
      const top = slide(null, w, h, places, { reach });
      if (!top) continue;
      // two LEDs of the row are enough only for a small shift (a dim row); more LEDs, a larger one
      const small = Math.hypot(top.dx, top.dy) <= 0.4 * ROW_GAP * s0, nRow = top.byKind.row || 0, nRing = top.byKind.ring || 0;
      if ((nRing >= 3 || nRow >= 3 || (nRow === 2 && small)) && (!best || top.score > best.score)) best = { phase, set: nRing >= 3 ? 'ring' : 'row', ...top };
    }
    return best;
  }

  // The map found from the ring is right up to a quarter turn of the plane about the middle of the ring (the four arcs are alike) and, until it is known,
  // the layout of the row. When the row is lit, each of the eight ways is tried: the places of the row slid over the fresh map of the green; the way
  // whose row falls on responses (3 of 4 at least) is the one, if no other quarter turn does as well (a place's worth less). Of the two layouts, the one
  // that needs the smaller shift. -> true when decided (the map is then turned and shifted)
  resolveRow({ maps, w, h, group, speed, since }) {
    const P = maps.green[0], tau = Math.max(FLOOR, TAU_SHARE * this.signal.green), cap = Math.max(2 * tau, 1.2 * this.signal.green);
    const opts = [];
    for (const mirror of this.mirror ? [this.mirror] : [1, -1]) for (let rot = 0; rot < 4; rot++) {
      const Hk = rot ? compose(this.H, planeRotation(rot)) : this.H;
      const places = expectedPoints({ group, circle: -1, mirror }).map((p) => ({ px: applyH(Hk, p.X, p.Y), s: scaleAt(Hk, p.X, p.Y) }));
      const s0 = places.reduce((a, p) => a + p.s, 0) / places.length;
      if (!Number.isFinite(s0) || s0 <= 0 || s0 > 80) continue;
      const reach = Math.min(1.4 * ROW_GAP * s0, 6 * s0 + 5 + TUNE.reachK * speed * since);
      const top = slide(P, w, h, places, { tau, cap, reach, hi: this.hi('green') });
      if (top && top.count >= 2) opts.push({ ...top, mirror, rot, H: Hk, d: Math.hypot(top.dx, top.dy) });
    }
    if (!opts.length) return false;
    const byRot = [0, 1, 2, 3].map((rot) => opts.filter((o) => o.rot === rot).sort((a, b) => b.score - a.score)[0]).filter(Boolean).sort((a, b) => b.score - a.score);
    if (byRot.length > 1 && byRot[0].score - byRot[1].score < 0.8) return false;                       // another quarter turn does nearly as well: wait for a clearer picture
    const same = opts.filter((o) => o.rot === byRot[0].rot);
    const pick = same.length > 1 && Math.abs(same[0].score - same[1].score) < 0.5 ? same.sort((a, b) => a.d - b.d)[0] : same.sort((a, b) => b.score - a.score)[0];
    this.H = shifted(pick.H, pick.dx, pick.dy);
    this.mirror = pick.mirror;
    this.rotation = pick.rot;
    return true;
  }

  // the 8 places the map H predicts, and what answers at each (the strongest blob within a radius that follows the scale and the speed of the phone).
  // v (px/s) is the speed the map has: a FRESH answer (map P) is where the set is now, so it is looked for at the predicted place, within a radius that
  // leaves room for the speed having changed since the last picture; an OLD answer (map N) is where the set was about 0.2 s ago (0.08 to 0.32), so it is
  // looked for where the map WAS then, within a radius that carries that uncertainty.
  // litPhase (the dual flash): the places of the other flash are dark, so their fresh map is not looked at (and the old answers of the lit places are not needed when the
  // fresh one is there): half the work
  match(H, mirror, { maps, w, h, group, circle, motion, v = { x: 0, y: 0 }, dt = 0.08, rows = true, litPhase = null }) {
    const obs = [], speed = Math.hypot(v.x, v.y);
    for (const p of expectedPoints({ group, circle, mirror }).filter((q) => rows || q.set !== 'row')) {
      const px = applyH(H, p.X, p.Y), s = scaleAt(H, p.X, p.Y);
      const base = ((p.set === 'row' ? 6 : 10) + 0.05 * motion) * s + 2;
      const rMax = 0.3 * Math.max(w, h), r = Math.min(rMax, base + 0.3 * speed * dt), ro = Math.min(rMax, base + 0.15 * speed);
      const tau = Math.max(FLOOR, TAU_SHARE * this.signal[p.colour]);
      // P is where the set IS (fresh), N where it WAS. The real maps are the max over several older pictures, so a set that is lit now shows in N too,
      // at the place it had in an older picture of the same phase, and about as strong: when both answer, the fresh one is taken. A set that has just
      // gone dark answers in N only (P has only strays there, weaker): the stronger one then.
      const hi = this.hi(p.colour), dark = litPhase != null && p.phase !== litPhase;
      const fresh = dark ? null : blobNear([maps[p.colour][0]], w, h, px.x, px.y, r, { maxV: hi, choose: 'nearest', minV: tau });
      const old = litPhase != null && fresh ? null : blobNear([maps[p.colour][1]], w, h, px.x - OLD_AGE * v.x, px.y - OLD_AGE * v.y, ro, { maxV: hi });       // (the fresh answers fit the map: the NEAREST blob; the old ones only say that the set was there)
      let blob = null;
      if (fresh && old) blob = fresh.v >= 0.6 * old.v ? fresh : { ...old, map: 1 };
      else if (fresh) blob = fresh;
      else if (old) blob = { ...old, map: 1 };
      // nothing above the floor near the place: the strongest response there all the same (below the floor: not an answer, but the report says how weak it is)
      const weak = blob ? null : blobNear([maps[p.colour][0], maps[p.colour][1]], w, h, px.x, px.y, r);
      obs.push({ ...p, px, r, blob, matched: !!blob && blob.v >= tau, v: blob ? blob.v : weak ? weak.v : 0 });
    }
    // two places never share an answer (a big glow between two arcs, the radius of an old answer reaching the neighbour: the LEDs of the row are 10 px apart
    // at 70 cm): the blob belongs to the nearer place. Two places on one blob would make a fit that 4 points satisfy and that is not a map.
    for (const a of obs) for (const b of obs) {
      if (a === b || !a.matched || !b.matched || a.blob.map !== b.blob.map) continue;
      if (Math.hypot(a.blob.x - b.blob.x, a.blob.y - b.blob.y) > 1.5) continue;
      const da = Math.hypot(a.blob.x - a.px.x, a.blob.y - a.px.y), db = Math.hypot(b.blob.x - b.px.x, b.blob.y - b.px.y);
      if (da > db || (da === db && a.id > b.id)) a.matched = false;
    }
    return obs;
  }

  result(state, obs, rms) {
    // with the dual flash the counts are those of the places of the flash that is lit in this picture (8 of the 16), the others being the other flash's
    const scope = this.dual && obs.length ? obs.filter((o) => o.phase === (this.phase ?? 0)) : obs;
    const row = scope.filter((o) => o.set === 'row'), ringPts = scope.filter((o) => o.set === 'ring');
    const ok = (o) => o.matched && o.inlier !== false;
    return {
      state, tracking: !!this.H && state !== 'lost', H: this.H, mirror: this.mirror, rotation: this.rotation, rms, speed: Math.hypot(this.v.x, this.v.y), invalid: this.nInvalid || 0, pending: !!this.pending, refreshed: !!this.refreshed, reacquired: !!this.reacquired, tried: !!this.tried, tryWhy: this.tried ? this.tryWhy : null, reacquisitions: this.nReacq || 0, lostBy: state === 'lost' ? this.lostBy || null : null,
      phase: this.dual ? (this.phase ?? 0) : null, dual: !!this.dual, acqFail: this.H ? null : this.acqFail || null,
      scale: this.H ? scaleAt(this.H, 0, 26) : NaN, points: obs,
      expected: scope.length, matched: scope.filter(ok).length, rowMatched: row.filter(ok).length, ringMatched: ringPts.filter(ok).length,
      confirmed: scope.filter((o) => o.confirmed).length, rowConfirmed: row.filter((o) => o.confirmed).length, ringConfirmed: ringPts.filter((o) => o.confirmed).length,
      complete: !this.pending && scope.length > 0 && scope.every((o) => o.confirmed), diag: this.diag || null,
    };
  }

  // The first map of the dual flash, from ONE picture: the 4 arcs and the 4 LEDs of the row are lit in the same flash, so they are all fresh (found.rings: the candidate
  // squares of arcs; found.row: the 3 or 4 aligned spots). The square gives the map up to which of the two ring sets it is (N E S W or NE SE SW NW: the flash), which
  // quarter turn, and the layout of the row; each of these hypotheses predicts where the row falls, and the spots say which is right: the mean distance of the spots
  // to the nearest predicted LED, in units of the gap between LEDs (0 is perfect), must be small, and the best (set, quarter turn) clearly better than the next.
  acquireDual(found, { maps, w, h }) {
    // why a start is refused is kept (acqFail: { reason, err, margin }) and counted by the page: 'sans carré' (no square of arcs among the spots), 'sans rangée' (no 3 aligned
    // spots), 'coins non frais' (the arcs do not answer in the map P at the corners found), 'rangée incompatible' (the best hypothesis puts the row more than 0.35 gap from the
    // spots seen: err), 'ambigu' (the next hypothesis is nearly as good: margin), 'carte invalide'
    this.acqFail = null;
    const squares = ((found && (found.rings || (found.ring ? [found.ring] : []))) || []).filter((q) => q && q.length === 4);
    // found.rows: several candidate rows (the page gives the best few: a light in line with the row, or a distractor in the background, can be the first); found.row: one
    const rowSets = ((found && (found.rows && found.rows.length ? found.rows : found.row ? [found.row] : [])) || []).filter((r) => r && r.length >= 3);
    if (!squares.length) { this.acqFail = { reason: 'sans carré' }; return false; }
    if (!rowSets.length) { this.acqFail = { reason: 'sans rangée' }; return false; }
    // (the corners found are spots above the search threshold, which follows the lights: here they only must answer a little in the fresh map)
    const P = maps.amber[0], tau = Math.max(FLOOR, 0.15 * this.signal.amber), hyps = [];
    for (const square of squares) {
      const fresh = square.filter((c) => peakNear(P, w, h, c.x, c.y, 3) >= tau).length;
      if (fresh < 3) continue;
      const corners = square.map((c) => ({ x: c.x, y: c.y }));
      for (const par of [0, 1]) {
        const ids = ringIds(par);
        for (let rot = 0; rot < 4; rot++) {
          const H = fitHomography(ids.map((_, j) => { const [X, Y] = ring(ids[(j + rot) % 4]); return { x: X, y: Y }; }), corners);
          if (!H || !validMap(H, w, h)) continue;
          for (const mirror of this.mirror ? [this.mirror] : [1, -1]) for (const spots of rowSets) {
            const rowPl = expectedPoints({ group: 4, circle: 2, mirror }).filter((p) => p.set === 'row' && p.phase === par);
            const pred = rowPl.map((p) => applyH(H, p.X, p.Y)), gap = ROW_GAP * scaleAt(H, 0, rowPl[0].Y);
            if (!(gap > 0)) continue;
            // how well the spots fall on the predicted LEDs: the mean distance of the 3 BEST spots, in gaps. Not of all of them: a light in line with the row (out of a hole in
            // the side of the body, 1.5 gaps beyond its end) is a 4th "aligned" spot that fits no hypothesis, and the 14th report refused 300 starts for it (0.58 gap)
            const errs = spots.map((sp) => Math.min(...pred.map((q) => Math.hypot(q.x - sp.x, q.y - sp.y))) / gap).sort((a, b) => a - b), k = Math.min(3, errs.length);
            const err = errs.slice(0, k).reduce((a, b) => a + b, 0) / k;
            hyps.push({ H, par, rot, mirror, err, square, rowPl, pred, spots });
          }
        }
      }
    }
    if (!hyps.length) { this.acqFail = { reason: 'coins non frais' }; return false; }
    // the best hypothesis of each (set, quarter turn, square): the layout of the row may be either, the others differ by much more
    const byKey = new Map();
    for (const hp of hyps) { const k = `${squares.indexOf(hp.square)}/${hp.par}/${hp.rot}`; if (!byKey.has(k) || hp.err < byKey.get(k).err) byKey.set(k, hp); }
    const ranked = [...byKey.values()].sort((a, b) => a.err - b.err);
    const best = ranked[0];
    const margin = ranked.length > 1 ? ranked[1].err - best.err : Infinity;
    if (best.err > 0.35) { this.acqFail = { reason: 'rangée incompatible', err: best.err, margin }; return false; }
    if (margin < 0.15) { this.acqFail = { reason: 'ambigu', err: best.err, margin }; return false; }
    // all the 8 points at once: the corners and each spot with its nearest predicted LED
    const src = [], dst = [];
    best.square.forEach((c, j) => { const ids = ringIds(best.par), [X, Y] = ring(ids[(j + best.rot) % 4]); src.push({ x: X, y: Y }); dst.push({ x: c.x, y: c.y }); });
    for (const sp of best.spots) {
      let bi = 0, bd = Infinity; best.pred.forEach((q, i) => { const d = Math.hypot(q.x - sp.x, q.y - sp.y); if (d < bd) { bd = d; bi = i; } });
      if (bd < 0.5 * ROW_GAP * scaleAt(best.H, 0, best.rowPl[0].Y)) { src.push({ x: best.rowPl[bi].X, y: best.rowPl[bi].Y }); dst.push({ x: sp.x, y: sp.y }); }
    }
    const H = (src.length > 4 && fitHomography(src, dst)) || best.H;
    if (!validMap(H, w, h)) { this.acqFail = { reason: 'carte invalide' }; return false; }
    const vals = best.square.map((c) => peakNear(P, w, h, c.x, c.y, 3)).sort((a, b) => a - b);
    this.signal.amber = Math.max(FLOOR, (vals[1] + vals[2]) / 2); this.known.amber = true; this.vals.amber.push(...vals);
    this.H = H; this.mirror = best.mirror; this.rotation = best.rot; this.phase = best.par; this.coast = 0; this.seen = {};
    return true;
  }

  // The first map, from the ring alone. found.rings: the candidate squares, each the 4 corners of the square of arcs ordered around on the screen (one when
  // 4 arcs were found; when only 3 were, one per hypothesis for the fourth: locate.js). The corners must be FRESH: the map P of the amber must answer near
  // at least 3 of them (the spots of a set that is dark come from the map N and are old: they are not used, the next picture will do).
  acquireRing(found, { maps, w, h, circle, need = 3, accept = null, group = 0 }) {
    const squares = found && (found.rings || (found.ring ? [found.ring] : [])).filter((q) => q && q.length === 4 && (!accept || accept(q)));
    if (!squares || !squares.length) return false;
    const ids = ringIds(circle), P = maps.amber[0], tau = Math.max(FLOOR, 0.3 * this.signal.amber);
    let best = null;
    for (const square of squares) {
      const fresh = square.filter((c) => peakNear(P, w, h, c.x, c.y, 3) >= tau).length;
      if (fresh < need) continue;
      const H = fitHomography(square.map((_, j) => { const [X, Y] = ring(ids[j]); return { x: X, y: Y }; }), square.map((c) => ({ x: c.x, y: c.y })));
      if (!H || !rowCompatible(H, found && found.row, group, this.mirror || 1)) continue;
      if (!best || fresh > best.fresh) best = { H, fresh, square };
    }
    if (!best) return false;
    const vals = best.square.map((c) => peakNear(P, w, h, c.x, c.y, 3)).sort((a, b) => a - b);
    this.signal.amber = Math.max(FLOOR, (vals[1] + vals[2]) / 2); this.known.amber = true; this.vals.amber.push(...vals);       // the strength of the ring, on this robot, in this view: the middle two of the four
    this.H = best.H; this.rotation = null; this.coast = 0; this.seen = {};
    return true;
  }
}

// Is the row the detector sees (3 or 4 spots on a line) compatible with a map made from the ring alone? For one of the four quarter turns of the plane, the line of
// the row has the direction the map gives to the lateral axis of the robot (within 15 degrees) and its LEDs the spacing the map gives to 16 mm (within 40 %). Direction
// and spacing do not depend on where the spots are, so they are not spoilt by the age of the spots (a set that is dark is seen from the map N). A square that has a
// stray light for one corner makes a map whose row is rarely right. No row seen: nothing to check against.
export function rowCompatible(H, row, group, mirror = 1) {
  if (!row || row.length < 3) return true;
  const pts = row.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const first = pts[0], last = pts[pts.length - 1], len = Math.hypot(last.x - first.x, last.y - first.y);
  if (len < 1e-6) return true;
  const gaps = []; for (let i = 1; i < pts.length; i++) gaps.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const gap = pts.length === 4 ? len / 3 : Math.min(...gaps), ang = Math.atan2(last.y - first.y, last.x - first.x);
  const row0 = expectedPoints({ group, circle: -1, mirror }), cx = row0.reduce((a, p) => a + p.X, 0) / row0.length, cy = row0[0].Y;
  for (let k = 0; k < 4; k++) {
    const Hk = k ? compose(H, planeRotation(k)) : H;
    const a = applyH(Hk, cx - ROW_GAP / 2, cy), b = applyH(Hk, cx + ROW_GAP / 2, cy);
    const g = Math.hypot(b.x - a.x, b.y - a.y);
    let d = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - ang) % Math.PI; d = Math.min(d, Math.PI - d);
    if (d <= (15 * Math.PI) / 180 && g > 0 && gap / g > 0.6 && gap / g < 1.6) return true;
  }
  return false;
}

// the map slid: the shift (within `reach` px) at which the places have the most under them in their pictures (see Tracker.snap). places: [{ px: {x, y}, P?, tau?, cap?, hi?,
// set? }]: a place has its own picture and its own thresholds (the row is green, the arcs amber), or they are given once for all as P, tau, cap, hi.
export function slide(P, w, h, places, { tau = 20, cap = 100, reach, hi = Infinity }) {
  // bounded whatever it is given: a reach from a map that went wrong must not turn into a loop of millions of shifts
  if (!(reach > 0) || !places.length || !places.every((p) => Number.isFinite(p.px.x) && Number.isFinite(p.px.y))) return null;
  reach = Math.min(reach, 0.2 * Math.max(w, h), 80);
  const R = Math.max(2, Math.ceil(reach));
  const peak = (A, x, y, maxV) => {
    const cx = Math.round(x), cy = Math.round(y);
    let m = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h) { const q = A[yy * w + xx]; if (q > m && q <= maxV) m = q; }
    return m;
  };
  let top = null;
  const consider = (dx, dy) => {
    const d = Math.hypot(dx, dy);
    if (d > reach) return;
    let score = 0, count = 0;
    const byKind = {};
    for (const p of places) {
      const c = p.cap ?? cap, v = peak(p.P || P, p.px.x + dx, p.px.y + dy, p.hi ?? hi);
      score += Math.min(v, c) / c;
      if (v >= (p.tau ?? tau)) { count++; if (p.set) byKind[p.set] = (byKind[p.set] || 0) + 1; }
    }
    score -= 0.2 * (d / reach);
    if (!top || score > top.score) top = { dx, dy, count, score, byKind };
  };
  // every other shift first (the window of a place tolerates 1 px), then the neighbours of the best, and the shift 0 (the nearest wins a tie)
  for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) consider(dx, dy);
  consider(0, 0);
  if (top) { const c = top; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) consider(c.dx + ox, c.dy + oy); }
  return top;
}

// the strongest value of the picture within r px of (x, y)
function peakNear(P, w, h, x, y, r) {
  let m = 0;
  for (let yy = Math.max(0, Math.round(y) - r); yy <= Math.min(h - 1, Math.round(y) + r); yy++) for (let xx = Math.max(0, Math.round(x) - r); xx <= Math.min(w - 1, Math.round(x) + r); xx++) if (P[yy * w + xx] > m) m = P[yy * w + xx];
  return m;
}

// the plane turned by k quarter turns about the middle of the ring (the 3 x 3 matrix that is applied to the plane BEFORE the map)
function planeRotation(k) {
  const c = Math.round(Math.cos((k * Math.PI) / 2)), s = Math.round(Math.sin((k * Math.PI) / 2)), cx = 0, cy = 26;
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
}
