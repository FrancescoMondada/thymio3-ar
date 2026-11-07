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
import { fitHomography, ransacHomography, applyH, scaleAt, compose } from './homography.js';
import { blobNear } from './evidence.js';
import { ring, legoPoint, rowName, ROW_GAP } from './layout.js';

export const FLOOR = 20;                        // a response under this is noise (0..255)
export const TUNE = { beta: 0.7, reachK: 0.8 };   // beta: how much of what a picture says about the speed of the map is taken (alpha-beta filter); reachK: the share of speed x time the search reach carries
export const OLD_AGE = 0.2;                     // s: the answers of the map N are 0.08 to 0.32 s old (pairdiff.js: references aged 0.4 to 1.6 half periods)
export const REFRESH_MS = 1000;                 // the ring has not given a full fit (4 arcs) for this long: a full fresh square, if locate.js sees one, replaces the map
export const PENDING_MS = 2000;                 // a map found from the ring alone must be given its turn (the row says which way round) within this long, or it is dropped
export const CONFIRM_MS = 450;                  // a place is confirmed if it answered fresh within this long (the sets blink in turn: the one that is dark answered 0.2 s ago)
export const RING_LOST_MS = 2000;               // ... and for this long: the map is lost (the row alone keeps a map alive by shifts, but cannot say how it is turned)

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
    this.v = { x: 0, y: 0 };                    // how fast the map moves in the picture (px/s): the places are predicted with it
    this.t = null;                              // time of the last picture (ms)
    this.ringT = null;                          // time of the last picture in which the ring corrected the map
    this.fixT = null;                           // time of the last picture that corrected the map at all
    this.ringFullT = null;                      // time of the last picture in which the 4 arcs gave a full fit
    this.seen = {};                             // place id -> time of its last fresh answer
    this.dt = 0;
    this.pending = null;                        // a map found from the ring alone: which way round it is (the row says) is not known yet
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
    this.refreshed = false;
    if (circle < 0 || group < 0) { this.reset(); return this.result('idle', [], null); }            // the row alone fixes no map: nothing to track
    // the map moves in the picture as the phone moves: with the speed it had, the places are predicted where they will be NOW, not where they were at the
    // last correction (a correction comes at best every other picture, and at 70 cm the row's LEDs are 10 px apart: a hand at 70 px/s has moved a whole gap)
    let dt = 0;
    if (this.H && t != null && this.t != null) dt = Math.min(0.4, Math.max(0, (t - this.t) / 1000));
    if (t != null) this.t = t;
    this.dt = dt;
    if (this.H && dt > 0) this.H = shifted(this.H, this.v.x * dt, this.v.y * dt);
    if (!this.H) {
      // a map starts from the ring alone, seen in this very picture (the spots of locate.js are as old as the map they came from: up to 0.3 s for the set
      // that is dark, and a hand at 100 px/s moves 30 px in that time): the 4 arcs fix the map up to a quarter turn, and the row, when it is lit, says which
      acquired = this.acquireRing(found, { maps, w, h, circle });
      state = acquired ? 'acquire' : 'lost';
      if (!acquired) return this.result('lost', [], null);
      this.v = { x: 0, y: 0 }; this.ringT = t; this.fixT = t; this.ringFullT = t; this.pending = { t0: t, n: 0 };
    } else if (found && !this.pending && t != null && this.ringFullT != null && t - this.ringFullT > REFRESH_MS) {
      // three arcs have corrected the map for a second (an affine correction cannot repair the shape of the map: one wrong fit once is kept for good): a
      // full square of fresh corners, if there is one, starts the map again, from the ring; the row says again which way round it is
      const v = this.v;
      if (this.acquireRing(found, { maps, w, h, circle, need: 4 })) { this.v = v; this.ringT = t; this.fixT = t; this.ringFullT = t; this.pending = { t0: t, n: 0 }; state = 'acquire'; acquired = true; this.refreshed = true; }
    }
    const before = this.H;
    const since = t != null && this.fixT != null ? Math.min(0.6, Math.max(dt, (t - this.fixT) / 1000)) : dt;       // s without a correction: the uncertainty of the places grows with it
    // the set that is lit now says where the map is: the pattern of its places, slid over the fresh map P, finds the shift at which the most of them answer
    // (the pattern, not the nearest blob of each place: the 4 LEDs of the row are alike and 10 px apart, the nearest blob of a place is often the neighbour's)
    const rows = !this.pending;
    const snap = this.snap({ maps, w, h, group, circle, speed: Math.hypot(this.v.x, this.v.y), since, rows });
    if (snap) this.H = shifted(this.H, snap.dx, snap.dy);
    this.snapInfo = snap;
    const obs = this.match(this.H, this.mirror || 1, { maps, w, h, group, circle, motion, v: this.v, dt: snap ? 0 : since, rows });
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
    let rms = null, updated = false, ringFixed = false;
    const freshRing = fresh.filter((o) => o.set === 'ring');
    // a correction of the map as rich as the fresh answers allow: the whole map (4 points or more, RANSAC), an affine correction (3 points not on a
    // line: the ring with one arc missing), or a shift (the row: 3 or 4 points on a line)
    if (freshRing.length >= 4) {
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
    if (!updated && fresh.length >= 3) {
      let dx = 0, dy = 0;
      for (const o of fresh) { dx += o.blob.x - o.px.x; dy += o.blob.y - o.px.y; }
      dx /= fresh.length; dy /= fresh.length;
      if (Math.hypot(dx, dy) < 12 * s0 + 2) { this.H = shifted(this.H, dx, dy); updated = true; }
    }
    this.diag = { hit: hit.length, fresh: fresh.length, freshRing: freshRing.length, freshRow: fresh.length - freshRing.length, rejected: obs.filter((o) => o.rejected).length, how: updated ? (freshRing.length >= 4 && obs.some((o) => o.inlier) ? 'fit' : freshRing.length >= 3 ? 'affine' : 'shift') : 'none', coast: this.coast, motion };
    if (updated) {
      this.coast = 0;
      if (ringFixed && t != null) this.ringT = t;
      if (t != null) this.fixT = t;
      // what the picture says about the speed: how far the map had to move from where it was predicted (alpha-beta)
      if (dt > 0.005 && !acquired) {
        const a = applyH(before, 0, 26), b = applyH(this.H, 0, 26);
        const vx = this.v.x + (TUNE.beta * (b.x - a.x)) / dt, vy = this.v.y + (TUNE.beta * (b.y - a.y)) / dt, sp = Math.hypot(vx, vy), cap = 12 * w;
        this.v = sp > cap ? { x: (vx * cap) / sp, y: (vy * cap) / sp } : { x: vx, y: vy };
      }
      for (const o of hit) this.signal[o.colour] = Math.min(255, 0.9 * this.signal[o.colour] + 0.1 * o.v);
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
    // confirmed places: the one that answered fresh in this picture, or within the last blink period (the set that is dark now answered 0.2 s ago, and
    // the map has been following the other since: its places are where the map says). Without a clock (tests) a place is confirmed when it answers now.
    for (const o of obs) {
      const answers = o.matched && o.inlier !== false;
      if (answers && o.blob.map === 0 && t != null) this.seen[o.id] = t;
      o.confirmed = t != null ? this.H != null && this.seen[o.id] != null && t - this.seen[o.id] <= CONFIRM_MS : answers;
    }
    // the ring has not corrected the map for too long: the row alone has kept it alive by shifts, but nothing says it is still the right map
    if (this.H && t != null && this.ringT != null && t - this.ringT > RING_LOST_MS) { this.H = null; this.coast = 0; state = 'lost'; this.lostBy = 'ring'; this.pending = null; }
    // lost only after 8 pictures with no correction (a picture or two with too few answers is a coast, not a loss: the map is kept as it was)
    if (this.H && this.coast > 8) { this.H = null; this.coast = 0; state = 'lost'; this.lostBy = 'coast'; this.pending = null; }
    else if (state === 'idle') state = 'coast';
    if (state !== 'lost' && this.coast > 0 && state !== 'acquire') state = 'coast';
    return this.result(state, obs, rms);
  }

  // How far must the map be shifted for the pattern of the places of a set to fall on the responses of the fresh map P? Each shift within the reach of
  // the uncertainty is scored by how many of the places have a response under them (each counted up to the usual strength of the set, so that a stray
  // blob much stronger than the LEDs does not count more than one place), minus a little for the distance (the nearest shift wins a tie). The set that
  // is lit is the one with a good score (the other has nothing in P). -> { set, dx, dy, count, score } | null
  snap({ maps, w, h, group, circle, speed, since, rows = true }) {
    let best = null;
    const pts = expectedPoints({ group, circle, mirror: this.mirror || 1 });
    for (const set of rows ? ['row', 'ring'] : ['ring']) {
      const places = pts.filter((p) => p.set === set).map((p) => ({ ...p, px: applyH(this.H, p.X, p.Y), s: scaleAt(this.H, p.X, p.Y) }));
      if (places.length < 3) continue;
      const s0 = places.reduce((a, p) => a + p.s, 0) / places.length, colour = places[0].colour;
      const tau = Math.max(FLOOR, 0.3 * this.signal[colour]), cap = Math.max(2 * tau, 1.2 * this.signal[colour]);
      const reach = Math.min(set === 'row' ? 1.4 * ROW_GAP * s0 : 33 * s0, ((set === 'row' ? 6 : 10) * s0 + 2) + TUNE.reachK * speed * since);
      const top = slide(maps[colour][0], w, h, places, { tau, cap, reach });
      if (top && top.count >= 3 && (!best || top.score > best.score)) best = { set, ...top };
    }
    return best;
  }

  // The map found from the ring is right up to a quarter turn of the plane about the middle of the ring (the four arcs are alike) and, until it is known,
  // the layout of the row. When the row is lit, each of the eight ways is tried: the places of the row slid over the fresh map of the green; the way
  // whose row falls on responses (3 of 4 at least) is the one, if no other quarter turn does as well (a place's worth less). Of the two layouts, the one
  // that needs the smaller shift. -> true when decided (the map is then turned and shifted)
  resolveRow({ maps, w, h, group, speed, since }) {
    const P = maps.green[0], tau = Math.max(FLOOR, 0.3 * this.signal.green), cap = Math.max(2 * tau, 1.2 * this.signal.green);
    const opts = [];
    for (const mirror of this.mirror ? [this.mirror] : [1, -1]) for (let rot = 0; rot < 4; rot++) {
      const Hk = rot ? compose(this.H, planeRotation(rot)) : this.H;
      const places = expectedPoints({ group, circle: -1, mirror }).map((p) => ({ px: applyH(Hk, p.X, p.Y), s: scaleAt(Hk, p.X, p.Y) }));
      const s0 = places.reduce((a, p) => a + p.s, 0) / places.length;
      const reach = Math.min(1.4 * ROW_GAP * s0, 6 * s0 + 5 + TUNE.reachK * speed * since);
      const top = slide(P, w, h, places, { tau, cap, reach });
      if (top && top.count >= 3) opts.push({ ...top, mirror, rot, H: Hk, d: Math.hypot(top.dx, top.dy) });
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
  match(H, mirror, { maps, w, h, group, circle, motion, v = { x: 0, y: 0 }, dt = 0.08, rows = true }) {
    const obs = [], speed = Math.hypot(v.x, v.y);
    for (const p of expectedPoints({ group, circle, mirror }).filter((q) => rows || q.set !== 'row')) {
      const px = applyH(H, p.X, p.Y), s = scaleAt(H, p.X, p.Y);
      const base = ((p.set === 'row' ? 6 : 10) + 0.05 * motion) * s + 2;
      const r = base + 0.3 * speed * dt, ro = base + 0.15 * speed;
      const tau = Math.max(FLOOR, 0.3 * this.signal[p.colour]);
      // P is where the set IS (fresh), N where it WAS. The real maps are the max over several older pictures, so a set that is lit now shows in N too,
      // at the place it had in an older picture of the same phase, and about as strong: when both answer, the fresh one is taken. A set that has just
      // gone dark answers in N only (P has only strays there, weaker): the stronger one then.
      const fresh = blobNear([maps[p.colour][0]], w, h, px.x, px.y, r), old = blobNear([maps[p.colour][1]], w, h, px.x - OLD_AGE * v.x, px.y - OLD_AGE * v.y, ro);
      let blob = null;
      if (fresh && old) blob = fresh.v >= 0.6 * old.v ? fresh : { ...old, map: 1 };
      else if (fresh) blob = fresh;
      else if (old) blob = { ...old, map: 1 };
      obs.push({ ...p, px, r, blob, matched: !!blob && blob.v >= tau, v: blob ? blob.v : 0 });
    }
    // two places never share an answer: where the radius of an old answer reaches the neighbour (the LEDs of the row are 10 px apart at 70 cm), the
    // blob belongs to the nearer place
    for (const a of obs) for (const b of obs) {
      if (a === b || !a.matched || !b.matched || a.blob.map !== 1 || b.blob.map !== 1) continue;
      if (Math.hypot(a.blob.x - b.blob.x, a.blob.y - b.blob.y) > 1.5) continue;
      const da = Math.hypot(a.blob.x - a.px.x, a.blob.y - a.px.y), db = Math.hypot(b.blob.x - b.px.x, b.blob.y - b.px.y);
      if (da > db || (da === db && a.id > b.id)) a.matched = false;
    }
    return obs;
  }

  result(state, obs, rms) {
    const row = obs.filter((o) => o.set === 'row'), ringPts = obs.filter((o) => o.set === 'ring');
    const ok = (o) => o.matched && o.inlier !== false;
    return {
      state, tracking: !!this.H && state !== 'lost', H: this.H, mirror: this.mirror, rotation: this.rotation, rms, speed: Math.hypot(this.v.x, this.v.y), pending: !!this.pending, refreshed: !!this.refreshed, lostBy: state === 'lost' ? this.lostBy || null : null,
      scale: this.H ? scaleAt(this.H, 0, 26) : NaN, points: obs,
      expected: obs.length, matched: obs.filter(ok).length, rowMatched: row.filter(ok).length, ringMatched: ringPts.filter(ok).length,
      confirmed: obs.filter((o) => o.confirmed).length, rowConfirmed: row.filter((o) => o.confirmed).length, ringConfirmed: ringPts.filter((o) => o.confirmed).length,
      complete: !this.pending && obs.length > 0 && obs.every((o) => o.confirmed), diag: this.diag || null,
    };
  }

  // The first map, from the ring alone. found.rings: the candidate squares, each the 4 corners of the square of arcs ordered around on the screen (one when
  // 4 arcs were found; when only 3 were, one per hypothesis for the fourth: locate.js). The corners must be FRESH: the map P of the amber must answer near
  // at least 3 of them (the spots of a set that is dark come from the map N and are old: they are not used, the next picture will do).
  acquireRing(found, { maps, w, h, circle, need = 3 }) {
    const squares = found && (found.rings || (found.ring ? [found.ring] : [])).filter((q) => q && q.length === 4);
    if (!squares || !squares.length) return false;
    const ids = ringIds(circle), P = maps.amber[0], tau = Math.max(FLOOR, 0.3 * this.signal.amber);
    let best = null;
    for (const square of squares) {
      const fresh = square.filter((c) => peakNear(P, w, h, c.x, c.y, 3) >= tau).length;
      if (fresh < need) continue;
      const H = fitHomography(square.map((_, j) => { const [X, Y] = ring(ids[j]); return { x: X, y: Y }; }), square.map((c) => ({ x: c.x, y: c.y })));
      if (H && (!best || fresh > best.fresh)) best = { H, fresh };
    }
    if (!best) return false;
    this.H = best.H; this.rotation = null; this.coast = 0; this.seen = {};
    return true;
  }
}

// the map slid: the shift (within `reach` px) at which the places have the most under them in the picture P (see Tracker.snap). places: [{ px: {x, y} }]
export function slide(P, w, h, places, { tau, cap, reach }) {
  const R = Math.max(2, Math.ceil(reach));
  const peak = (x, y) => {
    const cx = Math.round(x), cy = Math.round(y);
    let m = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h && P[yy * w + xx] > m) m = P[yy * w + xx];
    return m;
  };
  let top = null;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > reach) continue;
    let score = 0, count = 0;
    for (const p of places) { const v = peak(p.px.x + dx, p.px.y + dy); score += Math.min(v, cap) / cap; if (v >= tau) count++; }
    score -= 0.2 * (d / reach);
    if (!top || score > top.score) top = { dx, dy, count, score };
  }
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
