// The maps of the pair difference for the DUAL flash (leds_lego.py, GROUP 4 with CIRCLE 2): flash 0 = the front row (even) and the arcs N E S W, flash 1 = the back
// row (even) and the arcs NE SE SW NW, one after the other every HALF_MS. P holds what lights up now (the row AND the ring of the flash that is lit), N what went
// dark in the pictures aged 80 to 320 ms (a streak where the phone moved): both flashes, each at the places it had when it was lit. Drawn straight from the
// geometry of the robot (layout.js) through the camera of the simulated scene (demo.js). Not a test itself.
import { cameraAt, project } from '../src/demo.js';
import { ring, legoPoint } from '../src/layout.js';
import { HALF_MS, BLINK_HZ } from '../src/script.js';
import { rng } from './evidence_scene.js';

const FRAME_W = 1280;

function paint(map, w, h, cx, cy, sigma, amp) {
  const r = Math.ceil(3.5 * sigma);
  for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = Math.round(amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma)));
    if (v > map[y * w + x]) map[y * w + x] = Math.min(255, v);
  }
}

// path(tMs) -> { elev, azim, dist }.  shift(tMs) -> { x, y } (px of the 1280-wide frame): the picture swaying in the hand.
// ringAmp: one strength for the arcs, or [flash 0, flash 1] (the two sets differ: the 16th report had arcs of 95 to 155)
// holes: [{ X, Y, Z, set: 'row' | 'ring', phase, amp }]: a light that comes out of a hole in the side wall (Z below the top plane) with its flash
export function makeDualScene({ w = 640, path, mirror = 1, rowOffset = 0, rowZ = 0, rowAmp = 100, ringAmp = 160, rowGains = null, dropArcs = [], distractors = 3, distractorAmp = 70, seed = 1, shift = null, holes = [] }) {
  const h = Math.round((w * 720) / FRAME_W), k = w / FRAME_W, rnd = rng(seed);
  const camAt = (t) => { const p = path(t); return { cam: cameraAt(p.elev, p.azim, p.dist), dist: p.dist }; };
  const phaseAt = (t) => (((t / 1000) * BLINK_HZ) % 1 < 0.5 ? 0 : 1);
  const toPx = (t, X, Y, Z = 0) => { const { cam } = camAt(t), q = project(cam, [X, Y, Z]), sh = shift ? shift(t) : { x: 0, y: 0 }; return { x: (q.x + sh.x) * k, y: (q.y + sh.y) * k }; };
  // the 16 places: id -> { X, Y, Z, set, phase }, the ids of tracker.js's expectedPoints
  const places = [];
  for (const [name, phase, prefix] of [['front', 0, 'row'], ['back', 1, 'rowb']]) for (let j = 0; j < 4; j++) { const kk = 2 * j, [X, Y] = legoPoint(name, kk); places.push({ id: `${prefix}${kk}`, set: 'row', phase, j, X: (mirror < 0 ? -X : X) + rowOffset, Y, Z: rowZ }); }
  for (let i = 0; i < 8; i++) { const [X, Y] = ring(i); places.push({ id: `arc${i}`, set: 'ring', phase: i % 2, X, Y, Z: 0, arc: i }); }
  const placePx = (t, p) => toPx(t, p.X, p.Y, p.Z);
  const ppmAt = (t) => (1000 / camAt(t).dist) * k;
  function draw(map, t, set, phase) {
    const ppm = ppmAt(t);
    for (const p of places) {
      if (p.set !== set || p.phase !== phase) continue;
      const q = placePx(t, p);
      if (set === 'row') paint(map, w, h, q.x, q.y, Math.max(0.9, 2.2 * ppm), rowAmp * (rowGains ? rowGains[p.j] : 1));
      else if (!dropArcs.includes(p.arc)) paint(map, w, h, q.x, q.y, Math.max(1.2, 4 * ppm), Array.isArray(ringAmp) ? ringAmp[p.phase] : ringAmp);
    }
  }
  function frame(t) {
    const P = { green: new Uint8Array(w * h), amber: new Uint8Array(w * h) }, N = { green: new Uint8Array(w * h), amber: new Uint8Array(w * h) };
    const ph = phaseAt(t);
    draw(P.green, t, 'row', ph); draw(P.amber, t, 'ring', ph);
    for (let age = 80; age <= 320; age += 40) { const o = t - age, po = phaseAt(o); draw(N.green, o, 'row', po); draw(N.amber, o, 'ring', po); }
    for (const hole of holes) {
      const set = hole.set, amp = hole.amp ?? 150;
      if (hole.phase === ph) { const q = toPx(t, hole.X, hole.Y, hole.Z); paint(set === 'row' ? P.green : P.amber, w, h, q.x, q.y, 2.2, amp); }
      for (let age = 80; age <= 320; age += 40) if (hole.phase === phaseAt(t - age)) { const q = toPx(t - age, hole.X, hole.Y, hole.Z); paint(set === 'row' ? N.green : N.amber, w, h, q.x, q.y, 2.2, amp); }
    }
    for (let i = 0; i < distractors; i++) for (const map of [P.green, N.green, P.amber, N.amber]) paint(map, w, h, rnd() * w, rnd() * h, 2, distractorAmp * (0.4 + rnd() * 0.6));
    const truth = {}; for (const p of places) truth[p.id] = placePx(t, p);
    return { maps: { green: [P.green, N.green], amber: [P.amber, N.amber] }, w, h, truth, phase: ph };
  }
  // what locate.js would give for the flash that is lit: the corners of the square of arcs, ordered around on the screen (starting at corner `rot`), and the spots of the row
  // along its line, all of them fresh (the same flash). `replace`: [{ index, x, y }] a corner of the square taken from somewhere else (a hole)
  // rowExtra: [gaps]: spots on the line of the row, that many gaps beyond its last LED (a light from a hole in line with the row); rowDrop: [j]: LEDs of the row not found
  function found(t, { rot = 0, noise = 0.4, replace = [], rowExtra = [], rowDrop = [] } = {}) {
    const ph = phaseAt(t), jig = (q) => ({ x: q.x + (rnd() - 0.5) * 2 * noise, y: q.y + (rnd() - 0.5) * 2 * noise, weight: 100, area: 40 });
    const arcs = places.filter((p) => p.set === 'ring' && p.phase === ph).map((p) => placePx(t, p)), rowP = places.filter((p) => p.set === 'row' && p.phase === ph).map((p) => placePx(t, p));
    const cx = arcs.reduce((a, q) => a + q.x, 0) / 4, cy = arcs.reduce((a, q) => a + q.y, 0) / 4;
    let corners = arcs.map(jig).sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    corners = corners.map((c, i) => { const r = replace.find((q) => q.index === i); return r ? { ...c, x: r.x, y: r.y } : c; });
    const rotated = corners.map((_, i) => corners[(i + rot) % 4]);
    const u = { x: rowP[3].x - rowP[0].x, y: rowP[3].y - rowP[0].y };
    const len = Math.hypot(u.x, u.y), gapPx = len / 3, dir = { x: u.x / len, y: u.y / len };
    const extra = rowExtra.map((g) => ({ x: rowP[3].x + dir.x * g * gapPx + (rnd() - 0.5) * noise, y: rowP[3].y + dir.y * g * gapPx + (rnd() - 0.5) * noise, weight: 100, area: 40 }));
    const row = [...rowP.filter((_, j) => !rowDrop.includes(j)).map(jig), ...extra].sort((a, b) => a.x * u.x + a.y * u.y - (b.x * u.x + b.y * u.y));
    return { rings: [rotated], row };
  }
  return { w, h, frame, found, phaseAt, placePx, places, holes, holePx: (t, hole) => toPx(t, hole.X, hole.Y, hole.Z), HALF_MS };
}
