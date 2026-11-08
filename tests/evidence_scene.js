// The maps of the pair difference (P: what lit up, N: what went dark) as a camera that moves would give them, drawn straight from the
// geometry of the robot (layout.js) through the camera model of the simulated scene (demo.js): for the tracker's tests. The row (green) and
// the ring (amber) blink in turn, as the script of the robot makes them. Not a test itself.
import { cameraAt, project } from '../src/demo.js';
import { ring, legoPoint, rowName } from '../src/layout.js';
import { HALF_MS, BLINK_HZ } from '../src/script.js';

export function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const FRAME_W = 1280;                              // the picture the camera model draws (demo.js)

function paint(map, w, h, cx, cy, sigma, amp) {
  const r = Math.ceil(3.5 * sigma);
  for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = Math.round(amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma)));
    if (v > map[y * w + x]) map[y * w + x] = Math.min(255, v);
  }
}

// path(tMs) -> { elev, azim, dist }.  Options: mirror (+1 / -1: the layout of the row), group, circle, gains, arcs that are not drawn, distractors
// ghosts: the real maps are max over several older pictures, so the set that is lit NOW shows in N too, at the place it had in an older picture of the same
// phase (the phone moved in between): both P and N answer for it, with about the same strength. The tracker must take P (fresh) whenever it answers.
// shift(tMs) -> { x, y }: a translation of the whole picture (px of the 1280-wide frame), the way a phone swaying in the hand moves it (demo.js `sway`)
// trail: the maps are drawn as PairDiff gives them: N is the union of the places a set had in the pictures aged 80 to 320 ms (a streak when it moves)
export function makeScene({ w = 480, path, mirror = 1, group = 0, circle = 1, rowAmp = 150, ringAmp = 110, dropArcs = [], dropRow = [], distractors = 3, distractorAmp = 70, ghosts = true, seed = 1, shift = null, trail = false, rowZ = 0, rowGains = null, rowOffset = 0, holes = [] }) {
  // holes: [{ X, Y, Z, set: 'ring' | 'row', amp }]: a hole in the side of the body that lets the light of a set out: a blob that blinks with the set, at a point of the
  // side wall (Z below the top plane), in P while the set is lit and in the trail N after it
  const h = Math.round((w * 720) / FRAME_W), k = w / FRAME_W, rnd = rng(seed);
  const rowSet = [0, 1, 2, 3].map((j) => (group % 2) + 2 * j), arcSet = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i % 2 === circle);
  const camAt = (t) => { const p = path(t); return { cam: cameraAt(p.elev, p.azim, p.dist), dist: p.dist }; };
  let tNow = 0;
  const toPx = (cam, X, Y, Z = 0) => { const q = project(cam, [X, Y, Z]), sh = shift ? shift(tNow) : { x: 0, y: 0 }; return { x: (q.x + sh.x) * k, y: (q.y + sh.y) * k }; };
  const rowMm = (kk) => { const [X, Y] = legoPoint(rowName(group), kk); return [(mirror < 0 ? -X : X) + rowOffset, Y]; };
  const lit = (t) => ((t / 1000) * BLINK_HZ) % 1 < 0.5;                // true: the row is lit, the ring dark (they blink in turn)
  const points = (t) => {
    tNow = t;
    const { cam, dist } = camAt(t), ppm = (1000 / dist) * k;
    return { ppm, row: rowSet.map((kk) => toPx(cam, ...rowMm(kk), rowZ)), ring: arcSet.map((i) => toPx(cam, ...ring(i))), ringIds: arcSet };
  };
  const holePx = (t, hole) => { const { cam } = camAt(t); return toPx(cam, hole.X, hole.Y, hole.Z); };
  function addHoles(t, P, N) {
    for (const hole of holes) {
      const rowSet = hole.set === 'row', litNow = rowSet ? lit(t) : !lit(t), amp = hole.amp ?? 120;
      if (litNow) { const q = holePx(t, hole); paint(rowSet ? P.green : P.amber, w, h, q.x, q.y, 2.2, amp); }
      for (let age = 80; age <= 320; age += 40) { const was = rowSet ? lit(t - age) : !lit(t - age); if (was) { const q = holePx(t - age, hole); paint(rowSet ? N.green : N.amber, w, h, q.x, q.y, 2.2, amp); } }
    }
  }
  function frame(t) {
    const now = points(t), before = points(t - HALF_MS);
    const P = { green: new Uint8Array(w * h), amber: new Uint8Array(w * h) }, N = { green: new Uint8Array(w * h), amber: new Uint8Array(w * h) };
    const drawRow = (map, pts, ppm) => pts.forEach((p, j) => { if (!dropRow.includes(j)) paint(map, w, h, p.x, p.y, Math.max(0.9, 2.2 * ppm), rowAmp * (rowGains ? rowGains[j] : 1)); });
    const drawRing = (map, pts, ppm, ids) => pts.forEach((p, j) => { if (!dropArcs.includes(ids[j])) paint(map, w, h, p.x, p.y, Math.max(1.2, 4 * ppm), ringAmp); });
    const same = points(t - 100);                                                    // an older picture of the same phase (100 ms earlier)
    if (trail) {
      const rowP = lit(t);
      (rowP ? drawRow : drawRing)(rowP ? P.green : P.amber, rowP ? now.row : now.ring, now.ppm, now.ringIds);
      // N: every set, at the place it had in each picture aged 80 to 320 ms in which it was lit
      for (let age = 80; age <= 320; age += 40) {
        const o = points(t - age), rowLit = lit(t - age);
        if (rowLit) drawRow(N.green, o.row, o.ppm); else drawRing(N.amber, o.ring, o.ppm, o.ringIds);
      }
      for (let i = 0; i < distractors; i++) for (const map of [P.green, N.green, P.amber, N.amber]) paint(map, w, h, rnd() * w, rnd() * h, 2, distractorAmp * (0.4 + rnd() * 0.6));
      addHoles(t, P, N);
      return { maps: { green: [P.green, N.green], amber: [P.amber, N.amber] }, w, h, truth: points(t), lit: lit(t) };
    }
    if (lit(t)) {
      drawRow(P.green, now.row, now.ppm);
      if (!lit(t - HALF_MS)) drawRing(N.amber, before.ring, before.ppm, before.ringIds);
      if (ghosts && lit(t - 100)) drawRow(N.green, same.row, same.ppm);
    } else {
      drawRing(P.amber, now.ring, now.ppm, now.ringIds);
      if (lit(t - HALF_MS)) drawRow(N.green, before.row, before.ppm);
      if (ghosts && !lit(t - 100)) drawRing(N.amber, same.ring, same.ppm, same.ringIds);
    }
    for (let i = 0; i < distractors; i++) for (const map of [P.green, N.green, P.amber, N.amber]) paint(map, w, h, rnd() * w, rnd() * h, 2, distractorAmp * (0.4 + rnd() * 0.6));
    addHoles(t, P, N);
    return { maps: { green: [P.green, N.green], amber: [P.amber, N.amber] }, w, h, truth: now, lit: lit(t) };
  }
  // what locate.js would give once it has found both sets: the corners of the square ordered around on the screen (starting at corner `shift`), the spots of the row along its line
  // stale: the way locate.js gets them from PairDiff.find: the set that is lit now at its place now (map P), the set that is dark from the map N, at the
  // place it had 80 to 320 ms ago
  function found(t, { shift = 0, noise = 0.4, stale = false } = {}) {
    const pr = stale && lit(t) ? points(t - 80 - 240 * rnd()) : points(t), pg = stale && !lit(t) ? points(t - 80 - 240 * rnd()) : points(t);       // lit(t): the row is lit, the ring dark
    const p = { ring: pr.ring, row: pg.row }, jig = (q) => ({ x: q.x + (rnd() - 0.5) * 2 * noise, y: q.y + (rnd() - 0.5) * 2 * noise, weight: 100, area: 40 });
    const cx = p.ring.reduce((a, q) => a + q.x, 0) / 4, cy = p.ring.reduce((a, q) => a + q.y, 0) / 4;
    const corners = p.ring.map(jig).sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    const rot = corners.map((_, i) => corners[(i + shift) % 4]);
    const u = { x: p.row[3].x - p.row[0].x, y: p.row[3].y - p.row[0].y };
    const row = p.row.map(jig).sort((a, b) => a.x * u.x + a.y * u.y - (b.x * u.x + b.y * u.y));
    return { ring: rot, row };
  }
  return { w, h, frame, found, points, lit, rowSet, arcSet, holePx };
}
