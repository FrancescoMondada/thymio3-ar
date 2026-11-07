// Test page: can a tablet find the Thymio 3's LEDs in its camera, fast enough for an augmented-reality view?
// It reads the camera, finds the bright spots (detect.js), draws them over the picture and measures what it costs.
// Nothing here estimates a pose yet: this is the first question, "do we see the 16 LEDs, and how quickly".

import { SpotFinder } from './detect.js';
import { Rolling, Rate, fmt } from './stats.js';
import { startCamera, exposureInfo, setExposure } from './camera.js';
import { startDemo } from './demo.js';
import { viewAngleDeg, AngleTable } from './angle.js';
import { LockIn } from './lockin.js';
import { PairDiff } from './pairdiff.js';
import { pickAligned } from './aligned.js';
import { pickSquare } from './square.js';
import { locate } from './locate.js';
import { Timeline } from './timeline.js';
import { ROW_GAP } from './layout.js';
import { HALF_MS, HALF_CHOICES, GROUPS, CIRCLES, hzOf, windowOf, countOf, buildScript } from './script.js';
import ledsLegoScript from './py/leds_lego.py?raw';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

const canvas = $('view');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const finder = new SpotFinder();
const pdiff = new PairDiff({ halfMs: HALF_MS });                   // the default way: the difference of two pictures half a period apart (holds up when the phone moves)
const SEEN_PEAK = 25;                                                 // a response (0..255) under this in both sets: nothing blinks in the picture (the phone points away from the robot)
const timeline = new Timeline();                                     // what happened over the whole test, in slices of 10 s (for the report)
const pdiffAmber = new PairDiff({ halfMs: HALF_MS, measure: 'amber' });    // the same for the amber arcs of the ring
const lock = new LockIn({ hz: hzOf(HALF_MS), windowMs: windowOf(HALF_MS), computeEvery: 90 });    // the sums are done at most every 90 ms: the pictures are all kept

// detect: 'diff' (what turns on or off between two pictures half a period apart: pairdiff.js), 'blink' (what blinks at the
// robot's rhythm over a second: lockin.js, needs a phone that does not move) or 'bright' (the bright spots of each picture)
const state = { cam: null, facing: 'environment', demo: false, detect: ['blink', 'bright'].includes(params.get('detect')) ? params.get('detect') : 'diff', signal: params.get('signal') === 'any' ? 'any' : 'color', ledMode: 'blink', blinkThreshold: 50, ringThreshold: Number(params.get('ringthr')) || 80, threshold: 200, contrast: 20, color: 'all', mask: false, procSize: 480,
  halfMs: HALF_CHOICES.includes(Number(params.get('half'))) ? Number(params.get('half')) : HALF_MS,        // the LEDs blink this long on, this long off
  group: GROUPS.includes(Number(params.get('group'))) && params.has('group') ? Number(params.get('group')) : 0,    // Lego LEDs: 0..3: 4 aligned on one row, 16 mm apart; -1: the 16; -2: none
  circle: CIRCLES.includes(Number(params.get('circle'))) && params.has('circle') ? Number(params.get('circle')) : 1 };    // ring arcs: 1: NE SE SW NW (a square, sides parallel to the row); 0: N E S W; -1: none. With a group they blink in turn
const lineOn = () => state.group !== -2;                               // the Lego LEDs are asked for
const squareOn = () => state.detect === 'diff' && state.circle >= 0;     // the ring arcs, looked for by the difference only (amber)
const expectedLine = () => (state.detect !== 'bright' || robot.on ? (lineOn() ? countOf(state.group) : 0) : 16);
const expected = () => expectedLine() + (squareOn() ? 4 : 0);          // how many points there should be
const blinkHz = () => hzOf(state.halfMs);
const groupLabel = (g) => (g === -2 ? 'pas de LED Lego' : g < 0 ? 'les 16 LED' : `4 LED alignées, rangée ${g < 2 ? 'avant' : 'arrière'} ${g % 2 ? 'B' : 'A'}`);
const alignOn = () => lineOn() && state.group >= 0;                    // 4 LEDs on a line: the line is a filter
const circleLabel = (c) => (c < 0 ? 'pas de cercle' : c === 0 ? 'arcs N E S W' : 'arcs NE SE SW NW');

// what is measured, over the last frames
const win = {
  counts: new Rolling(60), weights: new Rolling(60),
  read: new Rolling(30), find: new Rolling(30), latency: new Rolling(30),
  rateOut: new Rate(30), frames: [],            // [time, presentedFrames] of the last frames the camera gave
  latencyKind: 'n/d', frameW: 0, frameH: 0,
  last: { spots: [], brightest: 0, lit: 0 },
  diag: null,
};
function resetWindows() {
  win.counts = new Rolling(60); win.weights = new Rolling(60);
  win.read = new Rolling(30); win.find = new Rolling(30); win.latency = new Rolling(30);
  win.rateOut = new Rate(30); win.frames = [];
  win.cache = null;                               // the last result of the blink detection (the sums are not done on every picture)
  // what each set does, over the last 60 pictures: candidates found, whether it was picked, whether the other set's prediction saved it, the
  // strongest response, and the scale (px per mm) measured
  win.diag = { rowCand: new Rolling(60), rowOk: new Rolling(60), rowPeak: new Rolling(60), ringCand: new Rolling(60), ringOk: new Rolling(60), ringPeak: new Rolling(60), rescued: new Rolling(60), unseen: new Rolling(60), scale: new Rolling(60), mismatch: new Rolling(60) };
}

// ---- the angle of view -------------------------------------------------------------------------------
// From the tablet's orientation sensor (or, in the simulated scene, from the scene). The table of "how many LEDs
// at which angle" is what answers "are they seen from the side too"; it starts again when a setting that changes
// the count (threshold, analysed width, camera) changes.
let sensor = { beta: NaN, gamma: NaN, seen: false };

// how fast the phone moves (deg/s, smoothed over about 0.3 s): its gyroscope. The simulated scene knows it. The table tells how
// often the full set of points is found while it is still, moving slowly, or moving fast.
let motion = { rate: NaN, seen: false };
let motionStats = [0, 1, 2].map(() => ({ frames: 0, full: 0 }));
const MOTION_LABELS = ['immobile (< 5 °/s)', 'lent (5 à 30 °/s)', 'rapide (> 30 °/s)'];
const currentMotion = () => (state.cam?.motion ? state.cam.motion() : motion.rate);
const motionClass = (r) => (!Number.isFinite(r) ? -1 : r < 5 ? 0 : r < 30 ? 1 : 2);
addEventListener('devicemotion', (e) => {
  const r = e.rotationRate;
  if (!r) return;
  const v = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
  motion = { rate: Number.isFinite(motion.rate) ? 0.8 * motion.rate + 0.2 * v : v, seen: true };
});
let angles = new AngleTable(16);
const resetAngles = () => { angles = new AngleTable(expected()); motionStats = [0, 1, 2].map(() => ({ frames: 0, full: 0 })); };

const currentAngle = () => {
  if (state.cam?.angle) return state.cam.angle();                       // the simulated scene knows it
  return viewAngleDeg(sensor.beta, sensor.gamma, state.facing);
};

// iOS asks for a permission, from a tap; elsewhere the events just come
async function enableOrientation() {
  try {
    const DOE = window.DeviceOrientationEvent, DME = window.DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === 'function') await DOE.requestPermission();
    if (DME && typeof DME.requestPermission === 'function') await DME.requestPermission();
  } catch { /* refused: the angle stays n/d */ }
}
addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  sensor = { beta: e.beta, gamma: e.gamma, seen: true };
});

// ---- the loop: one pass per camera frame ---------------------------------------------------------------
function schedule(cam) {
  const v = cam.video;
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((now, meta) => tick(cam, now, meta));
  else requestAnimationFrame((now) => tick(cam, now, {}));
}

function tick(cam, now, meta) {
  if (state.cam !== cam) return;                // the camera was changed: this loop ends
  const v = cam.video;
  const vw = v.videoWidth, vh = v.videoHeight;
  if (vw && vh) {
    // the analysed picture is sized by its LONG side: a phone held upright gives 720x1280, four times the pixels of the
    // 640x360 the first measures were made on (the first test on a phone analysed 720x1280: 125 ms a picture, 6 a second)
    const scale = Math.min(1, state.procSize / Math.max(vw, vh));
    const W = Math.max(16, Math.round(vw * scale)), H = Math.max(16, Math.round(vh * scale));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; resetWindows(); }
    win.frameW = vw; win.frameH = vh;

    const a = performance.now();
    ctx.drawImage(v, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const b = performance.now();
    // two ways to find the LEDs: the ones that BLINK at the robot's rhythm (lockin.js: steady lights of any kind are
    // ignored), or the bright spots in each picture (detect.js)
    const blink = state.detect !== 'bright';                       // looking for LEDs that blink: by difference or by lock-in
    const longSide = Math.max(W, H);
    // sizes in pixels follow the picture, not constants: the robot is 6 px or 60 px across, depending on the distance and the zoom
    // (once one set gives the scale, locate() takes its minimum sizes from it)
    const size = { minArea: 2, maxArea: Math.max(50, (W * H) / 150) };
    const arcSize = { minArea: 4, maxArea: Math.max(80, (W * H) / 20), minFill: 0.1, maxAspect: 8 };
    let res, loc = null, peakLine = 0, peakRing = 0;
    const tag = (spots, set) => { for (const sp of spots) sp.set = set; return spots; };
    if (state.detect === 'diff') {
      // two sets can blink: the Lego LEDs (green) and the ring arcs (amber: their own threshold, looser shape limits)
      const t = meta.captureTime != null ? meta.captureTime : now;
      let waiting = false, brightest = 0;
      const spots = [];
      if (lineOn()) {
        if (pdiff.push(img.data, W, H, t)) { const r = pdiff.find(state.blinkThreshold, size); spots.push(...tag(r.spots, 'line')); peakLine = r.peak; brightest = Math.max(brightest, r.peak); }
        else waiting = true;
      }
      if (squareOn()) {
        if (pdiffAmber.push(img.data, W, H, t)) { const r = pdiffAmber.find(state.ringThreshold, arcSize); spots.push(...tag(r.spots, 'ring')); peakRing = r.peak; brightest = Math.max(brightest, r.peak); }
        else waiting = true;
      }
      res = waiting ? { spots: [], brightest: 0, lit: 0, waiting: true } : { spots, brightest, lit: 0 };
      if (!waiting) {
        // each set says where the other must be (layout.js), at the scale measured in this picture; where it must be, a missing set is
        // looked for again with a lower threshold
        loc = locate({
          line: spots.filter((sp) => sp.set === 'line'), ring: spots.filter((sp) => sp.set === 'ring'), group: state.group, wantLine: lineOn(), wantRing: squareOn(),
          elevDeg: currentAngle(), longSide,
          retryRing: squareOn() ? (w) => tag(pdiffAmber.find(Math.max(25, Math.round(state.ringThreshold * 0.45)), arcSize, w).spots, 'ring') : null,
          retryLine: lineOn() ? (w) => tag(pdiff.find(Math.max(20, Math.round(state.blinkThreshold * 0.6)), size, w).spots, 'line') : null,
        });
      }
    } else if (blink) {
      if (lock.push(img.data, W, H, meta.captureTime != null ? meta.captureTime : now)) {
        win.cache = finder.findFromValues(state.signal === 'color' ? lock.chroma : lock.amp, W, H, state.blinkThreshold, size);
      }
      res = win.cache || { spots: [], brightest: 0, lit: 0, waiting: true };
    } else {
      res = finder.find(img.data, W, H, state.threshold, { contrast: state.contrast, radius: Math.max(4, Math.round(W / 80)), ...size });
    }
    const c = performance.now();
    if (state.mask && !res.waiting) {
      if (state.detect !== 'diff') finder.paintMask(img.data);
      else { if (lineOn()) pdiff.paintMask(img.data); if (squareOn()) pdiffAmber.paintMask(img.data); }
      ctx.putImageData(img, 0, 0);
    }
    // the spots that count: all of them, or the green ones (the 16 Lego LEDs; the ring round the pad and the body
    // LEDs are other colours and also bright); a blinking spot has no colour: they all count
    let counted = blink || state.color === 'all' ? res.spots : res.spots.filter((s) => s.color === state.color);
    // 4 LEDs of a row blink: of everything the detector finds, only 3 or 4 spots on a straight line at even gaps are the LEDs;
    // 4 arcs of the ring blink: only 4 spots that are the corners of a convex quadrilateral (a square seen in perspective); each
    // set helps the other (locate.js)
    let aligned = null, square = null;
    if (loc) {
      aligned = loc.aligned; square = loc.square;
      counted = [...(aligned ? aligned.chosen : counted.filter((sp) => sp.set !== 'ring')), ...(square ? square.chosen : [])];
    } else if (alignOn() && !res.waiting) { aligned = pickAligned(counted); counted = aligned.chosen; }
    drawSpots(res.spots, counted, aligned, square, loc?.window);

    win.read.push(b - a);
    win.find.push(c - b);
    win.rateOut.tick(now);
    if (!res.waiting) {
      win.counts.push(counted.length);
      win.weights.push(counted.reduce((s, p) => s + p.weight, 0));
      angles.add(currentAngle(), counted.length);       // zeros count too: "no LED at all from 20°" is the answer, not a gap
      const mc = motionClass(currentMotion());
      if (mc >= 0) { motionStats[mc].frames++; if (counted.length === expected()) motionStats[mc].full++; }
    }
    if (loc) {
      const d = win.diag, lineCand = res.spots.filter((sp) => sp.set === 'line').length, ringCand = res.spots.filter((sp) => sp.set === 'ring').length;
      if (lineOn()) { d.rowCand.push(lineCand); d.rowOk.push(alignOn() ? (aligned?.chosen.length >= 3 ? 1 : 0) : lineCand >= 1 ? 1 : 0); d.rowPeak.push(peakLine); }
      if (squareOn()) { d.ringCand.push(ringCand); d.ringOk.push(square?.full ? 1 : 0); d.ringPeak.push(peakRing); }
      timeline.add(now, {
        row: lineOn() ? (alignOn() ? (aligned?.chosen.length ?? 0) >= 3 : lineCand >= 1) : null, ring: squareOn() ? !!square?.full : null,
        rescued: !!loc.rescued, rowPeak: peakLine, ringPeak: peakRing, motion: currentMotion(), seen: Math.max(peakLine, peakRing) >= SEEN_PEAK,
        cfg: `${state.blinkThreshold}/${state.ringThreshold}/${state.procSize}/${state.group}/${state.circle}/${state.halfMs}`,
      });
      d.unseen.push(Math.max(peakLine, peakRing) < SEEN_PEAK ? 1 : 0);
      d.rescued.push(loc.rescued ? 1 : 0);
      d.mismatch.push(loc.mismatch ? 1 : 0);
      const sc = loc.scales?.row ?? loc.scales?.ringMean;
      if (Number.isFinite(sc)) d.scale.push(sc);
    }
    win.last = { ...res, spots: counted, found: res.spots, aligned, square, loc };
    if (meta.presentedFrames != null) {
      win.frames.push([now, meta.presentedFrames]);
      if (win.frames.length > 30) win.frames.shift();
    }
    if (meta.captureTime != null) { win.latency.push(now - meta.captureTime); win.latencyKind = 'capture'; }
    else if (meta.receiveTime != null) { win.latency.push(now - meta.receiveTime); win.latencyKind = 'réception'; }
  }
  schedule(cam);
}

// green circle: counted; grey circle: a spot of another colour, not counted
function drawSpots(spots, counted, aligned, square, window) {
  const k = canvas.width / Math.max(1, canvas.clientWidth);        // canvas pixels per screen pixel
  ctx.lineWidth = 1.5 * k;
  if (window) {                                                    // where the other set said this one must be (dashed)
    ctx.setLineDash([5 * k, 5 * k]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    window.outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const keep = new Set(counted);
  for (const s of spots) {
    const r = Math.max(6 * k, Math.sqrt(s.area / Math.PI) * 1.5 + 3 * k);
    ctx.strokeStyle = keep.has(s) ? (s.set === 'ring' ? '#ffb454' : '#3ddc97') : '#8a93b3';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (aligned && aligned.chosen.length >= 2) {                      // the line the LEDs are on
    ctx.strokeStyle = 'rgba(61, 220, 151, 0.6)';
    ctx.beginPath();
    ctx.moveTo(aligned.chosen[0].x, aligned.chosen[0].y);
    ctx.lineTo(aligned.chosen[aligned.chosen.length - 1].x, aligned.chosen[aligned.chosen.length - 1].y);
    ctx.stroke();
  }
  if (square && square.chosen.length === 4) {                       // the quadrilateral the arcs make
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.6)';
    ctx.beginPath();
    square.chosen.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
  }
}

const colorsText = (spots) => {
  const by = {};
  for (const s of spots) by[s.color] = (by[s.color] || 0) + 1;
  return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(', ') || 'aucun';
};

// ---- the panel -------------------------------------------------------------------------------------
const cameraFps = () => {
  const f = win.frames;
  if (f.length < 2) return NaN;
  const dt = f[f.length - 1][0] - f[0][0];
  return dt > 0 ? (1000 * (f[f.length - 1][1] - f[0][1])) / dt : NaN;
};

function refreshPanel() {
  const n = win.last.spots.length;
  const { counts } = win;
  const exp = expected();
  const steady = counts.count >= 10 && counts.min === exp && counts.max === exp;
  const big = $('count');
  big.className = `big ${!state.cam ? 'dim' : steady ? 'ok' : n === 0 ? 'dim' : 'warn'}`;
  big.innerHTML = state.cam ? `${n}<small>sur ${exp}</small>` : '–';
  const blink = state.detect !== 'bright';
  $('countNote').textContent = !state.cam ? (exp === 16 ? 'Il doit y en avoir 16 (2 rangées de 8).' : `Il doit y en avoir ${exp} (${[lineOn() ? (alignOn() ? '4 LED alignées d\'une rangée' : 'les 16 LED') : '', squareOn() ? '4 arcs du cercle en carré' : ''].filter(Boolean).join(' + ')}).`)
    : win.last.waiting ? (state.detect === 'blink' ? `Attente de ${(lock.windowMs / 1000).toFixed(1)} s d'images (au moins ${lock.minFrames}) pour mesurer le clignotement…` : 'Attente d\'une image assez ancienne pour la comparer…')
    : `Sur les ${counts.count} dernières images : de ${counts.min} à ${counts.max}${blink ? '' : ` (points vus : ${colorsText(win.last.found || [])})`}. ` +
      (steady ? `Les ${exp} points sont vus, image après image${alignOn() || squareOn() ? `, retenus parmi ${(win.last.found || []).length} points trouvés (alignement, forme)` : ''}.`
        : n === 0 ? (blink ? `Aucun point ne clignote à ${blinkHz().toFixed(1)} Hz : le robot clignote-t-il (bouton Robot, LED clignotantes) ? seuil trop haut ?` : 'Rien au-dessus du seuil : LED éteintes ? seuil trop haut ?')
        : n === 0 && (alignOn() || squareOn()) && (win.last.found || []).length > 0 ? `${win.last.found.length} point(s) trouvé(s), mais ni 3 alignés à intervalles réguliers ni 4 en carré : des parasites, ou les LED sont cachées ou collées.`
        : n < exp ? (blink ? `Moins de ${exp} : LED cachées ou collées, image qui bouge trop, seuil trop haut ; ou le robot ne clignote pas encore.` : `Moins de ${exp} : LED éteintes ou cachées, ou points collés (essayez 960 / 1280 px, ou rapprochez-vous).`)
        : n === exp ? `Le compte est bon à cet instant mais pas stable : ${counts.min} à ${counts.max} (une LED se perd ou un point s'ajoute de temps en temps).`
        : (blink ? `Plus de ${exp} : quelque chose d'autre clignote ou la scène bouge ; remontez le seuil.` : `Plus de ${exp} : des reflets ? remontez le seuil.`));

  if (state.cam && !win.last.waiting && squareOn() && lineOn()) {
    const nl = win.last.spots.filter((sp) => sp.set !== 'ring').length, nr = win.last.spots.length - nl;
    $('countNote').textContent += ` Rangée : ${nl}/${expectedLine()}, carré : ${nr}/4.`;
  }
  const vp = win.last.square?.vanishing;
  $('parallel').textContent = !squareOn() ? '' : vp ? `Parallélisme carré / rangée : écart ${fmt(vp.residual, 3)} (${vp.residual < 0.05 ? 'les côtés sont parallèles à la rangée' : 'pas parallèles : essayez l\'autre jeu d\'arcs'}).` : win.last.square?.full ? 'Parallélisme : il faut au moins 3 LED de la rangée.' : '';
  const dg = win.diag, pct = (r) => fmt(100 * r.mean, 0, ' %');
  const scaleNow = dg && dg.scale.count ? dg.scale.mean : NaN;
  $('diag').textContent = !state.cam || !dg || !dg.rescued.count ? '' : [
    alignOn() && dg.rowOk.count ? `Rangée : 3 ou 4 LED alignées dans ${pct(dg.rowOk)} des images (${fmt(dg.rowCand.mean, 1)} candidats, réponse max ${fmt(dg.rowPeak.mean, 0)}).` : '',
    squareOn() && dg.ringOk.count ? `Arcs : carré trouvé dans ${pct(dg.ringOk)} des images (${fmt(dg.ringCand.mean, 1)} candidats ambre, réponse max ${fmt(dg.ringPeak.mean, 0)}${dg.rescued.mean > 0.005 ? `, ${pct(dg.rescued)} des images sauvées par la prédiction de l'autre jeu` : ''}).` : '',
    Number.isFinite(scaleNow) ? `Échelle : ${fmt(scaleNow, 2)} px/mm, deux LED d'un groupe à ${fmt(ROW_GAP * scaleNow, 0)} px${ROW_GAP * scaleNow < 8 ? ' : très petit, rapprochez-vous ou prenez 640 px' : ROW_GAP * scaleNow > 120 ? ' : très grand, éloignez-vous ou prenez 320 px' : ''}.` : '',
    dg.unseen.mean > 0.2 ? `Rien ne répond dans ${pct(dg.unseen)} des dernières images : le robot est-il dans l'image ? (ces images comptent comme manquées)` : '',
    dg.mismatch.mean > 0.2 ? 'Les échelles de la rangée et du carré ne s\'accordent pas : l\'un des deux n\'est pas ce qu\'on croit.' : '',
  ].filter(Boolean).join(' ');
  $('detectNote').textContent = blink && robot.on && robot.mode !== 'blink' ? 'Le robot ne clignote pas : cette détection ne verra rien (choisissez « LED clignotantes »).'
    : state.detect === 'bright' && robot.on && robot.mode === 'blink' ? 'Les LED clignotent : la détection par luminosité ne les voit qu\'une image sur deux (choisissez « allumées en continu »).'
    : state.detect === 'diff' ? 'Il faut des LED qui clignotent : le bouton Robot plus bas les fait clignoter. Cette détection compare deux images : le téléphone peut bouger.'
    : state.detect === 'blink' ? 'Il faut des LED qui clignotent : le bouton Robot plus bas les fait clignoter. Cette détection regarde une seconde de suite : le téléphone doit rester posé, sinon elle ne voit rien.' : '';
  $('ampMax').textContent = state.cam ? String(win.last.brightest) : '–';
  const ang = currentAngle();
  $('angle').textContent = state.cam ? (Number.isFinite(ang) ? `${Math.round(ang)}°` : 'n/d') : 'n/d';
  $('angleNote').textContent = state.cam && !state.cam.angle && !sensor.seen
    ? 'Pas de capteur d\'orientation lu par ce navigateur : l\'angle reste n/d (le tableau ne se remplit pas).'
    : 'Angle entre l\'axe de la caméra et la table : 90° = de face au-dessus, 0° = à ras de la table. Inclinez la tablette peu à peu en gardant le robot dans l\'image : le tableau compte les points vus à chaque angle.';
  $('angleTable').innerHTML = `<tr class="dim"><td>angle</td><td>images</td><td>points (moy · max)</td><td>${exp} vus</td></tr>` +
    angles.summary().map((r) => {
      const cls = !r.frames ? 'dim' : r.fullPct >= 90 ? 'ok' : r.max >= exp ? 'warn' : 'bad';
      return `<tr class="${cls}"><td>${r.label}</td><td>${r.frames}</td><td>${r.frames ? `${fmt(r.mean, 1)} · ${r.max}` : '–'}</td><td>${r.frames ? fmt(r.fullPct, 0, ' %') : '–'}</td></tr>`;
    }).join('');
  const mr = currentMotion();
  $('motionNow').textContent = Number.isFinite(mr) ? `Téléphone : ${mr < 5 ? 'immobile' : mr < 30 ? 'bouge doucement' : 'bouge vite'} (${fmt(mr, 0)} °/s)` : 'Téléphone : mouvement non lu par ce navigateur';
  $('motionTable').innerHTML = '<tr class="dim"><td>mouvement</td><td>images</td><td>complètes</td></tr>' + motionStats.map((r, i) => {
    const pct = r.frames ? (100 * r.full) / r.frames : NaN;
    return `<tr class="${!r.frames ? 'dim' : pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : 'bad'}"><td>${MOTION_LABELS[i]}</td><td>${r.frames}</td><td>${r.frames ? fmt(pct, 0, ' %') : '–'}</td></tr>`;
  }).join('');

  const fin = cameraFps(), fout = win.rateOut.perSecond;
  const tot = win.read.mean + win.find.mean;
  $('fpsIn').textContent = fmt(fin, 1, ' /s');
  $('fpsOut').textContent = fmt(fout, 1, ' /s');
  $('latency').textContent = win.latency.count ? `${fmt(win.latency.mean, 0, ' ms')} (${win.latencyKind})` : 'n/d';
  $('tRead').textContent = `${fmt(win.read.mean, 1, ' ms')}  (max ${fmt(win.read.max, 1)})`;
  $('tFind').textContent = `${fmt(win.find.mean, 1, ' ms')}  (max ${fmt(win.find.max, 1)})`;
  $('flicker').textContent = win.weights.count >= 10 && win.weights.mean > 0 ? `${fmt(win.weights.spreadPct, 0, ' %')} de variation` : 'n/d';
  $('brightest').textContent = state.cam ? String(win.last.brightest) : '–';
  const perPeriod = (fout * 2 * state.halfMs) / 1000;                  // pictures analysed in one period of the blink
  $('speedNote').textContent = (!Number.isFinite(tot) ? ''
    : Number.isFinite(fin) && fout < fin * 0.9 ? `L'analyse (${fmt(tot, 1)} ms) est plus lente que la caméra : des images sont sautées.`
    : `L'analyse prend ${fmt(tot, 1)} ms par image${Number.isFinite(fin) ? `, la caméra en donne une toutes les ${fmt(1000 / fin, 0)} ms` : ''}.`) +
    (blink && state.cam && Number.isFinite(perPeriod) && perPeriod > 0
      ? ` Images analysées par période de clignotement : ${fmt(perPeriod, 1)} (il en faut au moins 5${perPeriod < 5 ? ` : ralentissez le clignotement ou baissez la taille analysée` : ''}).` : '');

  const cam = state.cam;
  $('camInfo').textContent = cam
    ? `${cam.label || 'caméra'} · ${cam.settings.width || win.frameW}×${cam.settings.height || win.frameH}` +
      `${cam.settings.frameRate ? ` à ${Math.round(cam.settings.frameRate)} /s` : ''} · analysée en ${canvas.width}×${canvas.height}`
    : '–';
  $('report').textContent = report();
}

function exposureText() {
  if (!state.cam) return 'n/d';
  const e = exposureInfo(state.cam);
  return e.modes ? `modes ${e.modes.join('/')}${e.time ? `, temps ${e.time.min}–${e.time.max} (×0,1 ms)` : ''}, actuel ${e.current || '?'}${e.currentTime != null ? ` ${e.currentTime}` : ''}` : 'non réglable par la page';
}

// the whole test in slices of 10 s: the rolling figures of the report cover a few seconds only
function timelineLines() {
  const bins = timeline.bins();
  if (!bins.length) return ['chronologie: n/d'];
  const t = timeline.totals();
  const out = ['chronologie par tranches de 10 s (images · hors robot [rien ne répond] · puis, sur les images où quelque chose répond : rangée trouvée · arcs trouvés · les deux · sauvées par la prédiction · réponse max rangée/arcs · mouvement du téléphone):'];
  let last = null;
  for (const b of bins) {
    if (b.cfg !== last) { out.push(`  réglages ${b.cfg} (seuil rangée/arcs/taille/groupe/cercle/demi-période)`); last = b.cfg; }
    out.push(`  ${Math.round(b.start / 1000)}–${Math.round(b.end / 1000)} s : ${b.frames} · ${fmt(b.unseenPct, 0, ' %')} · ${fmt(b.rowSeenPct, 0, ' %')} · ${fmt(b.ringSeenPct, 0, ' %')} · ${fmt(b.bothSeenPct, 0, ' %')} · ${fmt(b.rescuedPct, 0, ' %')} · ${Math.round(b.rowPeak)}/${Math.round(b.ringPeak)} · ${fmt(b.motion, 0)} °/s`);
  }
  out.push(`  tout : ${t.frames} images, hors robot ${fmt(t.unseenPct, 0, ' %')} ; sur les autres : rangée ${fmt(t.rowSeenPct, 0, ' %')}, arcs ${fmt(t.ringSeenPct, 0, ' %')}, les deux ${fmt(t.bothSeenPct, 0, ' %')} ; sauvées par la prédiction ${fmt(t.rescuedPct, 0, ' %')} (sur toutes les images : rangée ${fmt(t.rowPct, 0, ' %')}, arcs ${fmt(t.ringPct, 0, ' %')}, les deux ${fmt(t.bothPct, 0, ' %')})`);
  return out;
}

function report() {
  const { counts, weights, read, find, latency } = win;
  const d = Math.round(window.devicePixelRatio * 100) / 100;
  return [
    'Thymio · test RA · rapport',
    `date: ${new Date().toISOString()}`,
    `navigateur: ${navigator.userAgent}`,
    `écran: ${innerWidth}x${innerHeight} @${d}`,
    `caméra: ${state.cam ? `${state.cam.label} ${state.cam.settings.width}x${state.cam.settings.height} @${state.cam.settings.frameRate ?? '?'}` : 'non démarrée'}${state.demo ? ' (SCÈNE SIMULÉE)' : ''}`,
    `requestVideoFrameCallback: ${typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'oui' : 'non'}`,
    `Web Bluetooth: ${'bluetooth' in navigator ? 'oui' : 'non'}`,
    `détection: ${state.detect === 'diff' ? `par différence de deux images (écart de 0,4 à 1,6 demi-période, ${blinkHz().toFixed(2)} Hz, ${groupLabel(state.group)} + ${circleLabel(state.circle)}${lineOn() && squareOn() ? ' en alternance' : ''}, seuil ${state.blinkThreshold}, source ${pdiff.source ?? 'n/d'}/${pdiffAmber.source ?? 'n/d'})` : state.detect === 'blink' ? `par clignotement sur ${lock.windowMs} ms (${blinkHz().toFixed(2)} Hz, fenêtre ${lock.windowMs} ms = ${lock.K} images, ${groupLabel(state.group)}, signal ${state.signal === 'color' ? 'couleur' : 'toute variation'}, seuil ${state.blinkThreshold})` : `par luminosité (seuil ${state.threshold}, contraste local ${state.contrast}, couleur ${state.color === 'all' ? 'toutes' : state.color})`}, analyse ${canvas.width}x${canvas.height}, masque ${state.mask ? 'oui' : 'non'}`,
    `couleurs des points vus maintenant: ${colorsText(win.last.found || [])}`,
    `filtre d'alignement: ${alignOn() ? `oui ; ${(win.last.found || []).length} points trouvés, ${win.last.spots.length} retenus${win.last.aligned?.chosen.length ? ` (droite à ${fmt(win.last.aligned.angleDeg, 0)}°, écart à la droite ${fmt(win.last.aligned.rms, 1)} px, intervalles ${win.last.aligned.gaps.map((g) => fmt(g, 0)).join('/')} px)` : ''}` : 'non'}`,
    `carré des arcs: ${squareOn() ? `${win.last.spots.filter((sp) => sp.set === 'ring').length}/4 retenus${win.last.square?.full ? ` (côtés ${win.last.square.sides.map((v) => fmt(v, 0)).join('/')} px${win.last.square.vanishing ? `, parallélisme avec la rangée : écart ${fmt(win.last.square.vanishing.residual, 3)}` : ''})` : ''}` : 'non'}`,
    `diagnostic rangée: ${lineOn() && win.diag?.rowCand.count ? `trouvée dans ${fmt(100 * win.diag.rowOk.mean, 0)} % des images, ${fmt(win.diag.rowCand.mean, 1)} candidats, réponse max ${fmt(win.diag.rowPeak.mean, 0)}` : 'n/d'}`,
    `diagnostic arcs: ${squareOn() && win.diag?.ringCand.count ? `carré trouvé dans ${fmt(100 * win.diag.ringOk.mean, 0)} % des images, ${fmt(win.diag.ringCand.mean, 1)} candidats ambre, réponse max ${fmt(win.diag.ringPeak.mean, 0)}, seuil des arcs ${state.ringThreshold}, ${fmt(100 * win.diag.rescued.mean, 0)} % sauvées par la prédiction` : 'n/d'}`,
    `échelle: ${win.diag?.scale.count ? `${fmt(win.diag.scale.mean, 2)} px/mm (LED d'un groupe à ${fmt(ROW_GAP * win.diag.scale.mean, 0)} px)` : 'n/d'}${win.last.loc?.scales?.row && win.last.loc?.scales?.ringMean ? `; rangée ${fmt(win.last.loc.scales.row, 2)}, carré ${fmt(win.last.loc.scales.ringMean, 2)}, rapport ${fmt(win.last.loc.scales.ratio, 2)}${win.last.loc.mismatch ? ' (INCOHÉRENT)' : ''}` : ''}; prédiction ${win.last.loc?.predicted ?? 'aucune'}${win.last.loc?.rescued ? ` (${win.last.loc.rescued})` : ''}`,
    ...timelineLines(),
    `images reçues/s: ${fmt(cameraFps(), 1)}  analysées/s: ${fmt(win.rateOut.perSecond, 1)}  par période de clignotement: ${fmt((win.rateOut.perSecond * 2 * state.halfMs) / 1000, 1)}`,
    `retard caméra→page: ${latency.count ? `${fmt(latency.mean, 0)} ms (${win.latencyKind})` : 'n/d'}`,
    `lecture de l'image: moy ${fmt(read.mean, 1)} max ${fmt(read.max, 1)} ms`,
    `recherche des points: moy ${fmt(find.mean, 1)} max ${fmt(find.max, 1)} ms`,
    `points: ${win.last.spots.length} maintenant; sur ${counts.count} images min ${counts.min} max ${counts.max} moy ${fmt(counts.mean, 1)}`,
    `variation de l'éclat total: ${weights.count >= 10 ? fmt(weights.spreadPct, 0, ' %') : 'n/d'}`,
    `angle de vue maintenant: ${Number.isFinite(currentAngle()) ? `${Math.round(currentAngle())}°` : 'n/d'} (capteur d'orientation ${state.cam?.angle ? 'simulé' : sensor.seen ? 'lu' : 'non lu'})`,
    `points selon l'angle de vue (images · points moyen · max · % d'images avec les ${expected()}):`,
    ...angles.summary().map((r) => `  ${r.label}: ${r.frames} · ${fmt(r.mean, 1)} · ${r.frames ? r.max : 'n/d'} · ${fmt(r.fullPct, 0, ' %')}`),
    `mouvement du téléphone maintenant: ${Number.isFinite(currentMotion()) ? `${fmt(currentMotion(), 0)} °/s` : 'non lu'} (${state.cam?.motion ? 'simulé' : motion.seen ? 'gyroscope lu' : 'non lu'})`,
    'images complètes selon le mouvement du téléphone (images · % avec tous les points):',
    ...motionStats.map((r, i) => `  ${MOTION_LABELS[i]}: ${r.frames} · ${r.frames ? fmt((100 * r.full) / r.frames, 0, ' %') : 'n/d'}`),
    `plus clair: ${win.last.brightest}`,
    `exposition: ${exposureText()}`,
    `robot: ${robot.text}${robot.on ? ` (LED ${robot.mode})` : ''}`,
  ].join('\n');
}

// ---- camera ------------------------------------------------------------------------------------------
function friendly(err) {
  if (err?.name === 'NoCameraApi') return 'Ce navigateur n\'ouvre pas la caméra : la page doit venir d\'une adresse https (ou localhost).';
  if (err?.name === 'NotAllowedError') return 'L\'accès à la caméra est refusé : à autoriser dans les réglages du navigateur pour ce site.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'Pas de caméra de ce côté.';
  return `${err?.name || 'Erreur'} : ${err?.message || err}`;
}

function stopCamera() {
  state.cam?.stop();
  state.cam = null;
}

async function start(kind) {
  $('err').textContent = '';
  try {
    stopCamera();
    state.demo = kind === 'demo';
    state.facing = kind === 'front' ? 'user' : 'environment';
    if (!state.demo) await enableOrientation();          // from the tap that started the camera
    const elev = params.has('elev') ? Number(params.get('elev')) : null;
    const cam = state.demo
      ? await startDemo({ elev, blink: params.has('blink'), extra: params.has('extra'), shake: Number(params.get('shake') || 0), sway: Number(params.get('sway') || 0), ringGain: params.has('ring') ? Number(params.get('ring')) : 1, halfMs: () => state.halfMs, group: () => state.group, ringSet: () => state.circle })
      : await startCamera({ facing: state.facing });
    state.cam = cam;
    timeline.reset();
    resetWindows();
    resetAngles();
    $('splash').style.display = 'none';
    $('switchCam').disabled = state.demo;
    setupExposure();
    schedule(cam);
  } catch (err) {
    $('err').textContent = friendly(err);
    $('splash').style.display = '';
  }
}

function setupExposure() {
  const e = exposureInfo(state.cam);
  const lock = $('lockExposure'), slider = $('exposureTime');
  lock.disabled = !e.canLock;
  lock.textContent = 'Verrouiller l\'exposition';
  lock.classList.remove('on');
  slider.style.display = $('exposureLabel').style.display = 'none';
  $('exposureNote').textContent = state.demo ? 'Scène simulée : pas d\'exposition.'
    : e.canLock ? 'Verrouillée, l\'image ne s\'éblouit plus quand les LED apparaissent.'
    : 'Cette caméra ne laisse pas la page régler l\'exposition (normal sur iPad : la caméra s\'adapte seule).';
}

async function toggleExposure() {
  const cam = state.cam;
  if (!cam) return;
  const lock = $('lockExposure'), slider = $('exposureTime');
  const locked = lock.classList.contains('on');
  try {
    if (!locked) {
      await setExposure(cam, { mode: 'manual' });
      lock.classList.add('on');
      lock.textContent = 'Exposition verrouillée (cliquer pour libérer)';
      const e = exposureInfo(cam);
      if (e.time) {
        slider.min = e.time.min; slider.max = e.time.max; slider.step = e.time.step || 1;
        slider.value = e.currentTime ?? Math.round((e.time.min + e.time.max) / 4);
        slider.style.display = $('exposureLabel').style.display = '';
        $('exposureValue').textContent = `${(slider.value / 10).toFixed(1)} ms`;
      }
    } else {
      await setExposure(cam, { mode: 'continuous' });
      lock.classList.remove('on');
      lock.textContent = 'Verrouiller l\'exposition';
      slider.style.display = $('exposureLabel').style.display = 'none';
    }
  } catch (err) {
    $('exposureNote').textContent = `Refusé par la caméra : ${err?.message || err}`;
  }
}

// ---- robot -------------------------------------------------------------------------------------------
// The script on the robot (py/leds_lego.py) has three modes for the 16 top LEDs: blinking (what the blink detection
// looks for), on, off. Changing the mode while it runs sends the script again.
const robot = { api: null, on: false, mode: null, busy: false, text: 'non connecté' };
const groupText = (g, c = -1) => [g === -2 ? '' : g < 0 ? 'les 16 LED' : `4 LED alignées (rangée ${g < 2 ? 'avant' : 'arrière'}, une sur deux, ${g % 2 ? 'B' : 'A'})`, c < 0 ? '' : `4 arcs du cercle (${c === 0 ? 'N, E, S, W' : 'NE, SE, SW, NW'})`].filter(Boolean).join(g !== -2 && c >= 0 ? ' et ' : '') || 'aucune LED du dessus';
const robotNote = (text, cls = 'dim') => { $('robotNote').textContent = text; $('robotNote').className = `note ${cls}`; robot.text = text; };
const modeNote = (mode, g, c, halfMs) => ({
  blink: `Script lancé : ${groupText(g, c)} ${g !== -2 && c >= 0 ? 'clignotent à tour de rôle' : 'clignotent'} (${hzOf(halfMs).toFixed(1)} Hz : ${halfMs} ms allumées, ${halfMs} ms éteintes), les autres du dessus restent éteintes.`,
  on: `Script lancé : ${groupText(g, c)} allumées en continu (niveau 16, sans scintillement).`,
  off: 'Script lancé : les 16 LED du dessus sont éteintes (les autres LED du robot ne changent pas).',
})[mode];
const bluetoothOk = () => 'bluetooth' in navigator;

async function launchRobot() {
  const mode = state.ledMode;
  robotNote('Connexion…');
  robot.api = robot.api || (await import('thymio-api'));
  const api = robot.api;
  if (!api.isConnected()) await api.requestAndConnect();
  if (!api.isConnected()) throw new Error('le robot n\'est pas connecté');
  try { await api.stopSensorStreaming?.(); } catch { /* not streaming */ }
  await api.stopScriptExecution();
  await sleep(60);
  robotNote('Envoi du script au robot…');
  await api.sendPythonScript(buildScript(ledsLegoScript, mode, state.halfMs, state.group, state.circle));
  await api.executeLoadedScript();
  robot.on = true;
  robot.mode = mode;
  robot.group = state.group;
  robot.circle = state.circle;
  $('robot').textContent = 'Rendre la main au robot (arrêter le script)';
  $('robot').classList.add('on');
  robotNote(modeNote(mode, state.group, state.circle, state.halfMs), 'ok');
}

async function toggleRobot() {
  if (robot.busy) return;
  robot.busy = true;
  $('robot').disabled = true;
  try {
    if (!robot.on) await launchRobot();
    else {
      await robot.api.stopScriptExecution();
      robotOff('Script arrêté : le firmware reprend ses LED.');
    }
  } catch (err) {
    robotNote(`${err?.name || 'Erreur'} : ${err?.message || err}`, 'bad');
  } finally {
    robot.busy = false;
    $('robot').disabled = !bluetoothOk();
  }
}

function robotOff(text) {
  robot.on = false;
  robot.mode = null;
  $('robot').textContent = 'Connecter le robot et lancer';
  $('robot').classList.remove('on');
  robotNote(text);
}

document.addEventListener('thymio-connected', (e) => { if (!e.detail && robot.on) robotOff('Liaison perdue.'); });
addEventListener('pagehide', () => { if (robot.on) robot.api?.stopScriptExecution?.().catch(() => {}); });

// ---- wiring ------------------------------------------------------------------------------------------
$('startBack').onclick = () => start('back');
$('startFront').onclick = () => start('front');
$('startDemo').onclick = () => start('demo');
$('switchCam').onclick = () => start(state.facing === 'user' ? 'back' : 'front');
$('lockExposure').onclick = toggleExposure;
$('robot').onclick = toggleRobot;
async function resendRobot() {
  if (!robot.on || robot.busy) return;
  robot.busy = true;                                    // the script runs: send it again with the new mode, group or speed
  try { await launchRobot(); } catch (err) { robotNote(`${err?.name || 'Erreur'} : ${err?.message || err}`, 'bad'); } finally { robot.busy = false; }
}
// the detector must look for what the robot does: a new rhythm or a new group starts the measure again
function applyBlink() {
  lock.hz = blinkHz();
  lock.windowMs = windowOf(state.halfMs);
  lock.reset();
  pdiff.halfMs = state.halfMs;
  pdiff.reset();
  pdiffAmber.halfMs = state.halfMs;
  pdiffAmber.reset();
  resetWindows();
  resetAngles();
}
$('ledMode').onchange = (e) => { state.ledMode = e.target.value; resendRobot(); };
$('ledGroup').onchange = (e) => { state.group = Number(e.target.value); applyBlink(); resendRobot(); };
$('circleSet').onchange = (e) => { state.circle = Number(e.target.value); applyBlink(); resendRobot(); };
$('blinkSpeed').onchange = (e) => { state.halfMs = Number(e.target.value); applyBlink(); resendRobot(); };
$('detect').onchange = (e) => { setDetect(e.target.value); };
$('signal').onchange = (e) => { state.signal = e.target.value; resetWindows(); resetAngles(); };
$('blinkThreshold').oninput = (e) => { state.blinkThreshold = +e.target.value; $('blinkThresholdValue').textContent = String(state.blinkThreshold); resetWindows(); resetAngles(); };
$('ringThreshold').oninput = (e) => { state.ringThreshold = +e.target.value; $('ringThresholdValue').textContent = String(state.ringThreshold); resetWindows(); resetAngles(); };
$('threshold').oninput = (e) => { state.threshold = +e.target.value; $('thresholdValue').textContent = String(state.threshold); resetWindows(); resetAngles(); };
$('contrast').oninput = (e) => { state.contrast = +e.target.value; $('contrastValue').textContent = String(state.contrast); resetWindows(); resetAngles(); };
$('colorFilter').onchange = (e) => { state.color = e.target.value; resetWindows(); resetAngles(); };
$('mask').onchange = (e) => { state.mask = e.target.checked; };
$('procSize').onchange = (e) => { state.procSize = +e.target.value; lock.reset(); resetWindows(); resetAngles(); };
$('resetAngles').onclick = resetAngles;
$('exposureTime').oninput = async (e) => {
  $('exposureValue').textContent = `${(e.target.value / 10).toFixed(1)} ms`;
  try { await setExposure(state.cam, { time: +e.target.value }); } catch (err) { $('exposureNote').textContent = String(err?.message || err); }
};
$('copy').onclick = async () => {
  const text = report();
  try { await navigator.clipboard.writeText(text); $('copy').textContent = 'Copié'; }
  catch { const r = document.createRange(); r.selectNodeContents($('report')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copy').textContent = 'Sélectionné : copiez à la main'; }
  setTimeout(() => { $('copy').textContent = 'Copier le rapport'; }, 2000);
};

function setDetect(mode) {
  state.detect = mode;
  $('detect').value = mode;
  $('signal').value = state.signal;
  lock.reset();
  pdiff.reset();
  pdiffAmber.reset();
  resetWindows();
  resetAngles();
  for (const el of document.querySelectorAll('[data-for]')) el.style.display = el.dataset.for.split(' ').includes(mode) ? '' : 'none';
}
$('ringThreshold').value = String(state.ringThreshold);
$('ringThresholdValue').textContent = String(state.ringThreshold);
$('ledGroup').value = String(state.group);
$('circleSet').value = String(state.circle);
$('blinkSpeed').value = String(state.halfMs);
$('procSize').value = String(state.procSize);
lock.hz = blinkHz();
lock.windowMs = windowOf(state.halfMs);
pdiff.halfMs = state.halfMs;
pdiffAmber.halfMs = state.halfMs;
setDetect(state.detect);

if (!('bluetooth' in navigator)) robotNote('Pas de Web Bluetooth dans ce navigateur (sur iPad : Bluefy). La caméra se teste quand même, avec les LED allumées autrement.');
$('robot').disabled = !bluetoothOk();       // the robot can be lit with no camera started: to photograph it with another device
setInterval(refreshPanel, 250);
refreshPanel();
if (params.has('demo')) start('demo');
