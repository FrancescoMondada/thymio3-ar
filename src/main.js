// Test page: can a tablet find the Thymio 3's LEDs in its camera, fast enough for an augmented-reality view?
// It reads the camera, finds the bright spots (detect.js), draws them over the picture and measures what it costs.
// Nothing here estimates a pose yet: this is the first question, "do we see the 16 LEDs, and how quickly".

import { SpotFinder } from './detect.js';
import { Rolling, Rate, fmt } from './stats.js';
import { startCamera, exposureInfo, setExposure } from './camera.js';
import { CameraWatch, pickSettings, capabilitiesText, SHOWN } from './camwatch.js';
import { startDemo } from './demo.js';
import { viewAngleDeg, AngleTable } from './angle.js';
import { LockIn } from './lockin.js';
import { PairDiff } from './pairdiff.js';
import { pickAligned } from './aligned.js';
import { pickSquare } from './square.js';
import { locate } from './locate.js';
import { Timeline } from './timeline.js';
import { nextSize } from './autosize.js';
import { Tracker, FLOOR } from './tracker.js';
import { RangeGuide, RANGE, normalise } from './range.js';
import { searchThreshold } from './search.js';
import { ROW_GAP, discWindow } from './layout.js';
import { HALF_MS, HALF_CHOICES, GROUPS, CIRCLES, hzOf, windowOf, countOf, buildScript, isDual } from './script.js';
import ledsLegoScript from './py/leds_lego.py?raw';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

const canvas = $('view');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const finder = new SpotFinder();
const pdiff = new PairDiff({ halfMs: HALF_MS });                   // the default way: the difference of two pictures half a period apart (holds up when the phone moves)
const tracker = new Tracker();
const rangeGuide = new RangeGuide();                                  // too far / too near the robot: the user is told (range.js)
const camWatch = new CameraWatch();                                  // what the camera and the screen change while the test runs (camwatch.js)
let camSettingsT = -1e9, camNoteTimer = null;
function showCamNote(ev) {
  if (!ev || !SHOWN.has(ev.kind)) return;
  const el = $('camNote'); if (!el) return;
  el.textContent = `Changement : ${ev.text}`; el.style.display = 'block';
  clearTimeout(camNoteTimer); camNoteTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}
const noteChange = (kind, text) => showCamNote(camWatch.note(performance.now(), kind, text));
document.addEventListener('visibilitychange', () => { if (state.cam) noteChange('page', document.hidden ? 'page passée en arrière-plan' : 'page revenue au premier plan'); });
let rangeShown = '';                                       // the map of the robot's plane to the picture, tracked (tracker.js)
const trackLog = { acquisitions: 0, losses: 0, refreshes: 0, lostBy: {}, acqFails: {}, lossScales: [], state: 'idle', rotation: null, recent: [] };       // recent: what the last pictures did (for the console: window.thymioAR)
window.thymioAR = { tracker, trackLog, camWatch, get state() { return state; } };
const SEEN_PEAK = 25;                                                 // a response (0..255) under this in both sets: nothing blinks in the picture (the phone points away from the robot)
const timeline = new Timeline();                                     // what happened over the whole test, in slices of 10 s (for the report)
const pdiffAmber = new PairDiff({ halfMs: HALF_MS, measure: 'amber' });    // the same for the amber arcs of the ring
const lock = new LockIn({ hz: hzOf(HALF_MS), windowMs: windowOf(HALF_MS), computeEvery: 90 });    // the sums are done at most every 90 ms: the pictures are all kept

// detect: 'track' (the default: 'diff' plus a map of the robot's plane to the picture that is tracked: tracker.js), 'diff' (what turns on or off between two pictures half a period apart: pairdiff.js), 'blink' (what blinks at the
// robot's rhythm over a second: lockin.js, needs a phone that does not move) or 'bright' (the bright spots of each picture)
const state = { cam: null, facing: 'environment', demo: false, detect: ['blink', 'bright', 'diff'].includes(params.get('detect')) ? params.get('detect') : 'track', signal: params.get('signal') === 'any' ? 'any' : 'color', ledMode: 'blink', blinkThreshold: 50, ringThreshold: Number(params.get('ringthr')) || 80, threshold: 200, contrast: 20, color: 'all', mask: false, procSize: [320, 480, 640, 960].includes(Number(params.get('size'))) ? Number(params.get('size')) : 480, procAuto: !params.has('size'),
  halfMs: HALF_CHOICES.includes(Number(params.get('half'))) ? Number(params.get('half')) : HALF_MS,        // the LEDs blink this long on, this long off
  group: GROUPS.includes(Number(params.get('group'))) && params.has('group') ? Number(params.get('group')) : 4,    // Lego LEDs: 0..3: 4 aligned on one row, 16 mm apart; -1: the 16; -2: none
  circle: CIRCLES.includes(Number(params.get('circle'))) && params.has('circle') ? Number(params.get('circle')) : 2 };    // ring arcs: 1: NE SE SW NW (a square, sides parallel to the row); 0: N E S W; -1: none. With a group they blink in turn
const lineOn = () => state.group !== -2;                               // the Lego LEDs are asked for
const diffMode = () => state.detect === 'diff' || state.detect === 'track';       // looks at the pair differences
const trackOn = () => state.detect === 'track' && state.group >= 0 && state.circle >= 0;
const squareOn = () => diffMode() && state.circle >= 0;     // the ring arcs, looked for by the difference only (amber)
const expectedLine = () => (state.detect !== 'bright' || robot.on ? (lineOn() ? countOf(state.group) : 0) : 16);
const expected = () => expectedLine() + (squareOn() ? 4 : 0);          // how many points there should be
const blinkHz = () => hzOf(state.halfMs);
const groupLabel = (g) => (g === 4 ? 'rangée avant puis rangée arrière (une LED sur deux)' : g === -2 ? 'pas de LED Lego' : g < 0 ? 'les 16 LED' : `4 LED alignées, rangée ${g < 2 ? 'avant' : 'arrière'} ${g % 2 ? 'B' : 'A'}`);
const alignOn = () => lineOn() && state.group >= 0;                    // 4 LEDs on a line: the line is a filter
const circleLabel = (c) => (c === 2 ? 'arcs N E S W puis NE SE SW NW' : c < 0 ? 'pas de cercle' : c === 0 ? 'arcs N E S W' : 'arcs NE SE SW NW');

// what is measured, over the last frames
const win = {
  counts: new Rolling(60), weights: new Rolling(60),
  read: new Rolling(30), find: new Rolling(30), latency: new Rolling(30),
  rateOut: new Rate(30), frames: [],            // [time, presentedFrames] of the last frames the camera gave
  latencyKind: 'n/d', frameW: 0, frameH: 0,
  last: { spots: [], brightest: 0, lit: 0 },
  diag: null,
};
function resetWindows({ keepMap = false } = {}) {
  win.counts = new Rolling(60); win.weights = new Rolling(60);
  win.read = new Rolling(30); win.find = new Rolling(30); win.latency = new Rolling(30);
  win.rateOut = new Rate(30); win.frames = [];
  win.cache = null;                               // the last result of the blink detection (the sums are not done on every picture)
  if (!keepMap) tracker.reset();                  // (a new size keeps the map, rescaled: see tick)
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

// The threshold of the search for the first map (dual flash): src/search.js
const peakHist = { line: [], ring: [] };
function searchFor(kind, pd, asked, floor, win = null) {
  let m = 0;
  const P = pd.P, w = pd.w;
  if (win) {                                                         // only the plausible zone counts: a light elsewhere does not set the threshold
    const x0 = Math.max(0, Math.floor(win.bbox.x0)), x1 = Math.min(w - 1, Math.ceil(win.bbox.x1)), y0 = Math.max(0, Math.floor(win.bbox.y0)), y1 = Math.min(pd.h - 1, Math.ceil(win.bbox.y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (P[y * w + x] > m) m = P[y * w + x];
  } else for (let i = 0; i < P.length; i++) if (P[i] > m) m = P[i];
  const st = searchThreshold(peakHist[kind], m, asked, floor);
  trackLog[kind === 'ring' ? 'thrRing' : 'thrRow'] = st.thr;
  return { ...st, peak: m };
}

// The search for the first map goes down a ladder of thresholds (the first from the strength of the lights, then 0.7 and 0.5 of it, not under the floor) until what it finds
// holds what it looks for: a square of arcs, three LEDs in line. A strong light in the picture that moves (a lamp in the background) makes the first threshold too high for the
// arcs, which the lower ones find; the candidates and the check against the row then sort the spots out. After a loss it looks only in the zone where the robot was (win).
function ladderFind(kind, pd, asked, floor, size, enough, win = null) {
  const st = searchFor(kind, pd, asked, floor, win);
  if (st.quiet) return { spots: [], peak: st.peak };
  const ladder = [...new Set([st.thr, Math.round(0.7 * st.thr), Math.round(0.5 * st.thr)].map((v) => Math.max(floor, v)))];
  let spots = [];
  for (const thr of ladder) {
    spots = pd.find(thr, size, win, 'P').spots;
    trackLog[kind === 'ring' ? 'thrRing' : 'thrRow'] = thr;
    if (enough(spots)) break;
  }
  return { spots, peak: st.peak };
}

// An exception in one picture must not end the loop (the display would stop, as if the page had frozen): it is counted, kept for the report, the map is dropped,
// and the next picture is waited for.
function tick(cam, now, meta) {
  try { tickBody(cam, now, meta); } catch (err) {
    trackLog.errors = (trackLog.errors || 0) + 1;
    trackLog.lastError = String((err && err.stack) || err).replace(/\s+/g, ' ').slice(0, 400);
    try { tracker.reset(); } catch { /* nothing more to do */ }
    if (state.cam === cam) schedule(cam);
  }
}

function tickBody(cam, now, meta) {
  if (state.cam !== cam) return;                // the camera was changed: this loop ends
  const v = cam.video;
  const vw = v.videoWidth, vh = v.videoHeight;
  if (vw && vh) {
    // the analysed picture is sized by its LONG side: a phone held upright gives 720x1280, four times the pixels of the
    // 640x360 the first measures were made on (the first test on a phone analysed 720x1280: 125 ms a picture, 6 a second)
    const scale = Math.min(1, state.procSize / Math.max(vw, vh));
    const W = Math.max(16, Math.round(vw * scale)), H = Math.max(16, Math.round(vh * scale));
    // what the camera and the screen do: the size of the picture, of the window, the orientation of the screen, and (about once a second) the settings of the track
    const snap = { frame: `${vw}x${vh}`, window: `${innerWidth}x${innerHeight}`, orientation: (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'landscape' : 'portrait') };
    if (now - camSettingsT > 1000) { camSettingsT = now; try { Object.assign(snap, pickSettings(cam.track && cam.track.getSettings && cam.track.getSettings())); } catch { /* the settings are not readable: nothing to note */ } }
    for (const ev of camWatch.observe(now, snap)) showCamNote(ev);
    if (canvas.width !== W || canvas.height !== H) {
      const oldW = canvas.width, oldH = canvas.height, had = !!tracker.H;
      canvas.width = W; canvas.height = H;
      resetWindows({ keepMap: true });
      if (oldW > 300 && oldH > 150 && (W !== oldW || H !== oldH) && Math.abs(W / H - oldW / oldH) < 0.02) tracker.rescale(W / oldW, H / oldH);       // (300 x 150: the default size of a canvas that has not been used yet)
      else {
        tracker.reset(); tracker.lastMap = null;                       // (the picture changed shape: where the robot was, relative to it, means nothing now; the whole picture is searched)
        if (had) { trackLog.sizeResets = (trackLog.sizeResets || 0) + 1; noteChange('carte', `carte effacée : l'image analysée est passée de ${oldW}x${oldH} à ${W}x${H}`); }
      }
    }
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
    let res, loc = null, tr = null, peakLine = 0, peakRing = 0;
    const tag = (spots, set) => { for (const sp of spots) sp.set = set; return spots; };
    if (diffMode()) {
      // two sets can blink: the Lego LEDs (green) and the ring arcs (amber: their own threshold, looser shape limits)
      const t = meta.captureTime != null ? meta.captureTime : now;
      let waiting = false, brightest = 0;
      const spots = [];
      // the map is known and healthy: the spots of the whole picture are not looked for (they cost most of the time of a picture, and a light out of a hole in the side of the
      // body is a spot like a LED): the maps of the pair difference are all the tracker needs, and the strongest response is read off them
      const dualOn = isDual(state.group, state.circle);
      // after a loss the robot is looked for where it was (tracker.searchZone), not in the whole picture
      const zone = dualOn && trackOn() && !tracker.H ? tracker.searchZone(t, W, H) : null, zoneWin = zone ? discWindow({ x: zone.cx, y: zone.cy }, zone.r) : null;
      trackLog.zone = zone;
      if (dualOn && trackOn() && !tracker.H) { trackLog.searches = (trackLog.searches || 0) + 1; if (zone) trackLog.zoned = (trackLog.zoned || 0) + 1; }                // both sets lit in the same flash: what lights up now (P) is all that is looked at
      const lite = trackOn() && !!tracker.H && !tracker.wantsFound(t);
      trackLog.pictures = (trackLog.pictures || 0) + 1; if (lite) trackLog.lite = (trackLog.lite || 0) + 1;
      const mapPeak = (pd) => { let m = 0; const P = pd.P, N = pd.N; for (let i = 0; i < P.length; i++) { if (P[i] > m) m = P[i]; if (N[i] > m) m = N[i]; } return m; };
      if (lineOn()) {
        if (pdiff.push(img.data, W, H, t)) {
          if (lite) { peakLine = mapPeak(pdiff); brightest = Math.max(brightest, peakLine); }
          else if (dualOn) { const st = ladderFind('line', pdiff, state.blinkThreshold, 25, size, (sp) => pickAligned(sp, { minGap: Math.max(3, 0.007 * longSide) }).chosen.length >= 3, zoneWin); peakLine = st.peak; brightest = Math.max(brightest, st.peak); spots.push(...tag(st.spots, 'line')); }
          else { const r = pdiff.find(state.blinkThreshold, size, null, null); spots.push(...tag(r.spots, 'line')); peakLine = r.peak; brightest = Math.max(brightest, r.peak); }
        } else waiting = true;
      }
      if (squareOn()) {
        if (pdiffAmber.push(img.data, W, H, t)) {
          if (lite) { peakRing = mapPeak(pdiffAmber); brightest = Math.max(brightest, peakRing); }
          else if (dualOn) { const st = ladderFind('ring', pdiffAmber, state.ringThreshold, 35, arcSize, (sp) => sp.length >= 4 && pickSquare(sp, { minSide: Math.max(5, 0.012 * longSide), maxCandidates: 20 }).full, zoneWin); peakRing = st.peak; brightest = Math.max(brightest, st.peak); spots.push(...tag(st.spots, 'ring')); }
          else { const r = pdiffAmber.find(state.ringThreshold, arcSize, null, null); spots.push(...tag(r.spots, 'ring')); peakRing = r.peak; brightest = Math.max(brightest, r.peak); }
        } else waiting = true;
      }
      res = waiting ? { spots: [], brightest: 0, lit: 0, waiting: true } : { spots, brightest, lit: 0 };
      if (!waiting) {
        // each set says where the other must be (layout.js), at the scale measured in this picture; where it must be, a missing set is
        // looked for again with a lower threshold
        loc = lite ? { aligned: null, square: null, window: null, predicted: null, rescued: false, scales: null, mismatch: false } : locate({
          line: spots.filter((sp) => sp.set === 'line'), ring: spots.filter((sp) => sp.set === 'ring'), group: dualOn ? 0 : state.group, wantLine: lineOn(), wantRing: squareOn(), gate: !dualOn, rowOpts: dualOn ? { all: true } : {}, ringOpts: dualOn ? { all: true, maxCandidates: 20 } : {},
          elevDeg: currentAngle(), longSide,
          retryRing: squareOn() ? (w) => tag(pdiffAmber.find(Math.max(25, Math.round(state.ringThreshold * 0.45)), arcSize, w).spots, 'ring') : null,
          retryLine: lineOn() ? (w) => tag(pdiff.find(Math.max(20, Math.round(state.blinkThreshold * 0.6)), size, w).spots, 'line') : null,
        });
        // the map of the plane: one place asked for each LED and each arc, the answers fit the map again (tracker.js). locate() above is how it is
        // found the first time, and again when it is lost
        if (trackOn()) {
          const ta = performance.now();
          tr = tracker.update({
            maps: { green: [pdiff.P, pdiff.N], amber: [pdiffAmber.P, pdiffAmber.N] }, w: W, h: H, group: state.group, circle: state.circle, motion: Number.isFinite(currentMotion()) ? currentMotion() : 0, t,
            // the dual flash: the best few squares of arcs and rows, tried against each other (a distractor in the background, a light in line with the row, can be the first)
            found: { rings: dualOn && loc.square && loc.square.candidates && loc.square.candidates.length ? loc.square.candidates : ringsFor(loc.square), row: loc.aligned && loc.aligned.chosen.length >= 3 ? loc.aligned.chosen : null, rows: dualOn && loc.aligned && loc.aligned.candidates ? loc.aligned.candidates : null },
          });
          if (tr.state === 'acquire') trackLog.acquisitions++;
          if (tr.tried) { trackLog.reacqTries = (trackLog.reacqTries || 0) + 1; (trackLog.reacqWhy ||= {})[tr.tryWhy] = (trackLog.reacqWhy[tr.tryWhy] || 0) + 1; }
          if (tr.reacquired) trackLog.reacq = (trackLog.reacq || 0) + 1;
          const tm = performance.now() - ta;
          trackLog.maxUpdate = Math.max(trackLog.maxUpdate || 0, tm);
          if (tm > 120) { trackLog.slowUpdates = (trackLog.slowUpdates || 0) + 1; tracker.reset(); }       // a picture the tracker found too slow: the map is dropped, not worked on again
          if (tr.refreshed) trackLog.refreshes++;
          if (!tr.tracking && tr.acqFail) { trackLog.acqFails[tr.acqFail.reason] = (trackLog.acqFails[tr.acqFail.reason] || 0) + 1; trackLog.lastAcq = tr.acqFail; }
          if (tr.state === 'lost' && trackLog.state !== 'lost' && trackLog.state !== 'idle') { trackLog.lossScales.push(rangeGuide.last ? Number(rangeGuide.last.s.toFixed(2)) : null); if (trackLog.lossScales.length > 8) trackLog.lossScales.shift(); trackLog.losses++; const why = tr.lostBy || 'taille'; trackLog.lostBy[why] = (trackLog.lostBy[why] || 0) + 1; }
          trackLog.state = tr.state; trackLog.rotation = tr.rotation; trackLog.last = tr;
          trackLog.recent.push(`${tr.state[0]}${tr.pending ? 'p' : ''}${tr.rowConfirmed}${tr.ringConfirmed}${tr.points.filter((o) => o.rejected).length ? 'x' : ''}`);
          if (trackLog.recent.length > 80) trackLog.recent.shift();
          (trackLog.detail ||= []).push({ s: tr.state[0], row: tr.rowMatched, ring: tr.ringMatched, ...(tr.diag || {}), sp: Math.round(tr.speed || 0), rs: tr.reseeded ? 1 : 0, lb: tr.lostBy, t: Math.round(now) });
          if (trackLog.detail.length > 16) trackLog.detail.shift();
          if (tr.state === 'lost' && trackLog.prevState !== 'lost') (trackLog.lossLog ||= []).push(trackLog.detail.slice());
          trackLog.prevState = tr.state;
        } else if (state.detect === 'track') { tracker.reset(); trackLog.state = 'idle'; }
        if (trackLog.t0 == null) trackLog.t0 = now;
        if (trackLog.firstSeenT == null && Math.max(peakLine, peakRing) >= SEEN_PEAK) trackLog.firstSeenT = now;
        if (trackLog.firstMapT == null && tr && tr.tracking) trackLog.firstMapT = now;
        // too far / too near: the scale of the map (or, with no map, what the detector measured), brought to 640 px; the hint over the picture
        const sc = tr && tr.tracking ? tr.scale : loc && loc.scales ? (loc.scales.ringMean ?? loc.scales.row) : NaN;
        const guide = rangeGuide.update(now, normalise(sc, W, H), !!(tr && tr.tracking));
        if (guide.message !== rangeShown) { rangeShown = guide.message; const el = $('rangeHint'); el.textContent = guide.message; el.style.display = guide.message ? 'block' : 'none'; }
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
    { const tickMs = c - a; trackLog.maxTick = Math.max(trackLog.maxTick || 0, tickMs); trackLog.sumTick = (trackLog.sumTick || 0) + tickMs; trackLog.nTick = (trackLog.nTick || 0) + 1; if (tickMs > 200) trackLog.slowTicks = (trackLog.slowTicks || 0) + 1; }
    if (state.mask && !res.waiting) {
      if (!diffMode()) finder.paintMask(img.data);
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
    // tracking: what counts is what answers at the places the map predicts (centres of the answers); the windows of locate() are not drawn
    if (tr && tr.tracking) {
      counted = tr.points.filter((o) => o.confirmed && (!tr.dual || o.phase === tr.phase)).map((o) => { const here = o.matched && o.inlier !== false; return { x: here ? o.blob.x : o.px.x, y: here ? o.blob.y : o.px.y, area: here ? o.blob.area : 0, weight: o.v || 1, set: o.set === 'row' ? 'line' : 'ring', color: 'clignotant' }; });
      drawSpots(res.spots, counted, null, null, null, tr);
    } else drawSpots(res.spots, counted, aligned, square, loc?.window);

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
    let sceneScale = NaN;
    if (loc) {
      const sc0 = tr && tr.tracking ? tr.scale : loc.scales?.row ?? loc.scales?.ringMean;
      sceneScale = Number.isFinite(sc0) ? sc0 : NaN;
      const d = win.diag, lineCand = res.spots.filter((sp) => sp.set === 'line').length, ringCand = res.spots.filter((sp) => sp.set === 'ring').length;
      const trk = tr && tr.tracking;                                   // tracking: found = 3 or more of the 4 answer at their places
      const rowFound = trk ? tr.rowConfirmed >= 3 : alignOn() ? (aligned?.chosen.length ?? 0) >= 3 : lineCand >= 1, ringFound = trk ? tr.ringConfirmed >= 3 : !!square?.full;
      if (lineOn()) { d.rowCand.push(lineCand); d.rowOk.push(rowFound ? 1 : 0); d.rowPeak.push(peakLine); }
      if (squareOn()) { d.ringCand.push(ringCand); d.ringOk.push(ringFound ? 1 : 0); d.ringPeak.push(peakRing); }
      timeline.add(now, {
        row: lineOn() ? rowFound : null, ring: squareOn() ? ringFound : null, tracked: state.detect === 'track' ? !!trk : null,
        rescued: !!loc.rescued, rowPeak: peakLine, ringPeak: peakRing, motion: currentMotion(), seen: Math.max(peakLine, peakRing) >= SEEN_PEAK,
        gap: Number.isFinite(sceneScale) ? ROW_GAP * sceneScale : NaN,
        cfg: `${state.blinkThreshold}/${state.ringThreshold}/${state.procSize}${state.procAuto ? 'a' : ''}/${state.group}/${state.circle}/${state.halfMs}/${exposureTag()}`,
      });
      d.unseen.push(Math.max(peakLine, peakRing) < SEEN_PEAK ? 1 : 0);
      d.rescued.push(loc.rescued && !trk ? 1 : 0);
      d.mismatch.push(loc.mismatch ? 1 : 0);
      if (Number.isFinite(sceneScale)) d.scale.push(sceneScale);
    }
    win.last = { ...res, spots: counted, found: res.spots, aligned, square, loc, tracker: tr };
    if (loc) maybeAutoSize(now);
    if (meta.presentedFrames != null) {
      win.frames.push([now, meta.presentedFrames]);
      if (win.frames.length > 30) win.frames.shift();
    }
    if (meta.captureTime != null) { win.latency.push(now - meta.captureTime); win.latencyKind = 'capture'; }
    else if (meta.receiveTime != null) { win.latency.push(now - meta.receiveTime); win.latencyKind = 'réception'; }
  }
  schedule(cam);
}

// the squares the tracker may start from: the 4 corners when 4 arcs were found; when 3 were, one square per hypothesis for the fourth (locate.js), the
// corners ordered around on the screen
function ringsFor(sq) {
  if (!sq) return null;
  if (sq.full) return [sq.chosen];
  if (!sq.partial || !sq.hypotheses) return null;
  return sq.hypotheses.map((h) => {
    const pts = [...sq.chosen, h.predicted], cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4;
    return pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  });
}

// green circle: counted; grey circle: a spot of another colour, not counted
// the analysis size follows the scale measured (autosize.js): the gap between two LEDs of a group (16 mm), in pixels, at the size in use
let lastSizeChange = 0;
function maybeAutoSize(now) {
  const d = win.diag;
  if (!state.procAuto || !diffMode() || !d || d.unseen.count < 40 || now - lastSizeChange < 6000) return;
  const found = Math.max(lineOn() && d.rowOk.count ? d.rowOk.mean : 0, squareOn() && d.ringOk.count ? d.ringOk.mean : 0);
  const size = nextSize({ size: state.procSize, gapPx: d.scale.count ? ROW_GAP * d.scale.mean : NaN, samples: d.scale.count, foundShare: found, unseenShare: d.unseen.mean });
  if (size !== state.procSize) { state.procSize = size; lastSizeChange = now; }
}

function drawSpots(spots, counted, aligned, square, window, tr = null) {
  const k = canvas.width / Math.max(1, canvas.clientWidth);        // canvas pixels per screen pixel
  ctx.lineWidth = 1.5 * k;
  if (tr) {                                                        // the 8 places the map predicts: solid where something answers, dashed where not
    const near = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y) && q.x > -canvas.width && q.x < 2 * canvas.width && q.y > -canvas.height && q.y < 2 * canvas.height;      // (never draw to a point that is nowhere)
    for (const o of tr.points) {
      if (!near(o.px)) continue;
      const ok = !!o.confirmed, here = o.matched && o.inlier !== false, r = Math.max(5 * k, (o.set === 'row' ? 3 : 5) * (tr.scale || 1) + 3 * k);
      ctx.setLineDash(ok ? [] : [3 * k, 3 * k]);
      ctx.strokeStyle = ok ? (o.set === 'ring' ? '#ffb454' : '#3ddc97') : 'rgba(255, 107, 107, 0.9)';
      ctx.beginPath();
      ctx.arc(here ? o.blob.x : o.px.x, here ? o.blob.y : o.px.y, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const key of [...new Set(tr.points.map((o) => o.key))]) {
      const mine = tr.points.filter((o) => o.key === key && near(o.px));
      if (mine.length < 2) continue;
      const isRing = mine[0].set === 'ring', lit = !tr.dual || mine[0].phase === tr.phase;           // (the other flash's sets are drawn fainter)
      ctx.strokeStyle = isRing ? (lit ? 'rgba(255, 180, 84, 0.6)' : 'rgba(255, 180, 84, 0.25)') : (lit ? 'rgba(61, 220, 151, 0.6)' : 'rgba(61, 220, 151, 0.25)');
      ctx.beginPath();
      mine.forEach((o, i) => (i ? ctx.lineTo(o.px.x, o.px.y) : ctx.moveTo(o.px.x, o.px.y)));
      if (isRing) ctx.closePath();
      ctx.stroke();
    }
    return;
  }
  if (trackLog.zone) {                                              // where the robot is looked for after a loss: round where it was (dashed)
    ctx.setLineDash([4 * k, 4 * k]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(trackLog.zone.cx, trackLog.zone.cy, trackLog.zone.r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  if (square && square.partial && square.predicted) {               // 3 arcs found: where the fourth is expected (dashed)
    ctx.setLineDash([3 * k, 3 * k]);
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.9)';
    ctx.beginPath();
    ctx.arc(square.predicted.x, square.predicted.y, 9 * k, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
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
  const ch = changedSettings();
  $('advancedSummary').textContent = ch.length ? `Réglages avancés : MODIFIÉS (${ch.join(', ')})` : 'Réglages avancés (seuils, taille, détection) : les valeurs par défaut sont faites pour marcher';
  $('advancedSummary').className = ch.length ? 'warn' : '';
  $('detectNote').textContent = blink && robot.on && robot.mode !== 'blink' ? 'Le robot ne clignote pas : cette détection ne verra rien (choisissez « LED clignotantes »).'
    : state.detect === 'bright' && robot.on && robot.mode === 'blink' ? 'Les LED clignotent : la détection par luminosité ne les voit qu\'une image sur deux (choisissez « allumées en continu »).'
    : state.detect === 'track' ? 'Il faut des LED qui clignotent : le bouton Robot plus bas les fait clignoter. Cette détection suit une carte du plan du robot : chaque LED et chaque arc est cherché là où la carte le prévoit, la carte est ajustée sur les réponses.'
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
  const out = ['chronologie par tranches de 10 s (images · hors robot [rien ne répond] · carte suivie · puis, sur les images où quelque chose répond : rangée trouvée · arcs trouvés · les deux · sauvées par la prédiction · réponse max rangée/arcs · mouvement du téléphone · écart entre deux LED d\'un groupe en px à la taille analysée):'];
  let last = null;
  for (const b of bins) {
    if (b.cfg !== last) { out.push(`  réglages ${b.cfg} (seuil rangée/arcs/taille/groupe/cercle/demi-période)`); last = b.cfg; }
    out.push(`  ${Math.round(b.start / 1000)}–${Math.round(b.end / 1000)} s : ${b.frames} · ${fmt(b.unseenPct, 0, ' %')} · ${fmt(b.trackedPct, 0, ' %')} · ${fmt(b.rowSeenPct, 0, ' %')} · ${fmt(b.ringSeenPct, 0, ' %')} · ${fmt(b.bothSeenPct, 0, ' %')} · ${fmt(b.rescuedPct, 0, ' %')} · ${Math.round(b.rowPeak)}/${Math.round(b.ringPeak)} · ${fmt(b.motion, 0)} °/s · ${fmt(b.gap, 0)} px`);
  }
  out.push(`  tout : ${t.frames} images, hors robot ${fmt(t.unseenPct, 0, ' %')}, carte suivie ${fmt(t.trackedPct, 0, ' %')} ; sur les autres : rangée ${fmt(t.rowSeenPct, 0, ' %')}, arcs ${fmt(t.ringSeenPct, 0, ' %')}, les deux ${fmt(t.bothSeenPct, 0, ' %')} ; sauvées par la prédiction ${fmt(t.rescuedPct, 0, ' %')} (sur toutes les images : rangée ${fmt(t.rowPct, 0, ' %')}, arcs ${fmt(t.ringPct, 0, ' %')}, les deux ${fmt(t.bothPct, 0, ' %')})`);
  return out;
}

function report() {
  const { counts, weights, read, find, latency } = win;
  const d = Math.round(window.devicePixelRatio * 100) / 100;
  return [
    'Thymio · test RA · rapport',
    `date: ${new Date().toISOString()}`,
    `version de la page: ${typeof __BUILD__ === 'string' ? __BUILD__ : 'inconnue'}`,
    `navigateur: ${navigator.userAgent}`,
    `écran: ${innerWidth}x${innerHeight} @${d}`,
    `caméra: ${state.cam ? `${state.cam.label} ${state.cam.settings.width}x${state.cam.settings.height} @${state.cam.settings.frameRate ?? '?'}` : 'non démarrée'}${state.demo ? ' (SCÈNE SIMULÉE)' : ''}`,
    `changements de la caméra et de l'écran: ${camWatch.line()}`,
    `caméra, capacités: ${capabilitiesText(state.cam && state.cam.capabilities)} ; orientation de l'écran: ${(screen.orientation && screen.orientation.type) || 'n/d'} ; réglages: ${(() => { try { return JSON.stringify(pickSettings(state.cam && state.cam.track && state.cam.track.getSettings && state.cam.track.getSettings())); } catch { return 'n/d'; } })()}`,
    `requestVideoFrameCallback: ${typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'oui' : 'non'}`,
    `Web Bluetooth: ${'bluetooth' in navigator ? 'oui' : 'non'}`,
    `détection: ${state.detect === 'track' ? `par suivi d'une carte du plan (différence de deux images, ${blinkHz().toFixed(2)} Hz, ${groupLabel(state.group)} + ${circleLabel(state.circle)}${isDual(state.group, state.circle) ? ' dans le même flash, les deux flashs en alternance' : lineOn() && squareOn() ? ' en alternance' : ''}, seuils ${state.blinkThreshold}/${state.ringThreshold} pour l'acquisition)` : state.detect === 'diff' ? `par différence de deux images (écart de 0,4 à 1,6 demi-période, ${blinkHz().toFixed(2)} Hz, ${groupLabel(state.group)} + ${circleLabel(state.circle)}${lineOn() && squareOn() ? ' en alternance' : ''}, seuil ${state.blinkThreshold}, source ${pdiff.source ?? 'n/d'}/${pdiffAmber.source ?? 'n/d'})` : state.detect === 'blink' ? `par clignotement sur ${lock.windowMs} ms (${blinkHz().toFixed(2)} Hz, fenêtre ${lock.windowMs} ms = ${lock.K} images, ${groupLabel(state.group)}, signal ${state.signal === 'color' ? 'couleur' : 'toute variation'}, seuil ${state.blinkThreshold})` : `par luminosité (seuil ${state.threshold}, contraste local ${state.contrast}, couleur ${state.color === 'all' ? 'toutes' : state.color})`}, analyse ${canvas.width}x${canvas.height}, masque ${state.mask ? 'oui' : 'non'}`,
    `couleurs des points vus maintenant: ${colorsText(win.last.found || [])}`,
    `filtre d'alignement: ${alignOn() ? `oui ; ${(win.last.found || []).length} points trouvés, ${win.last.spots.length} retenus${win.last.aligned?.chosen.length ? ` (droite à ${fmt(win.last.aligned.angleDeg, 0)}°, écart à la droite ${fmt(win.last.aligned.rms, 1)} px, intervalles ${win.last.aligned.gaps.map((g) => fmt(g, 0)).join('/')} px)` : ''}` : 'non'}`,
    `carré des arcs: ${squareOn() ? `${win.last.spots.filter((sp) => sp.set === 'ring').length}/4 retenus${win.last.square?.full ? ` (côtés ${win.last.square.sides.map((v) => fmt(v, 0)).join('/')} px${win.last.square.vanishing ? `, parallélisme avec la rangée : écart ${fmt(win.last.square.vanishing.residual, 3)}` : ''})` : ''}` : 'non'}`,
    `suivi de la carte: ${state.detect === 'track' ? `état ${trackLog.state}${win.last.tracker?.tracking ? `, échelle ${fmt(win.last.tracker.scale, 2)} px/mm, ${win.last.tracker.confirmed}/${win.last.tracker.expected} confirmés dans la dernière période, ${win.last.tracker.matched} répondent dans cette image (rangée ${win.last.tracker.rowMatched}, arcs ${win.last.tracker.ringMatched}), vitesse ${fmt(win.last.tracker.speed, 0)} px/s${win.last.tracker.rms != null ? `, écart ${fmt(win.last.tracker.rms, 1)} px` : ''}` : ''} ; ${trackLog.acquisitions} acquisition(s) dont ${trackLog.refreshes} reprise(s) depuis l'anneau, ${trackLog.reacq || 0} carte(s) remplacée(s) par un départ depuis l'image (${trackLog.reacqTries || 0} essais, carte en difficulté : ${Object.entries(trackLog.reacqWhy || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'}), ${trackLog.sizeResets || 0} carte(s) effacée(s) par un changement de forme de l'image, ${trackLog.losses} perte(s) (${Object.entries(trackLog.lostBy).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucune'}) ; carré tourné de ${trackLog.rotation ?? '?'} quart(s), rangée ${tracker.mirror > 0 ? 'dans le sens du plan' : tracker.mirror < 0 ? 'en miroir' : 'sens inconnu'}` : 'non'}`,
    ...(state.detect === 'track' ? [`places, quand leur jeu est allumé (réponse fraîche · images · force moyenne de la plus forte réponse proche · écart moyen des réponses aux places prédites en px) : ${Object.entries(tracker.stats).sort(([a], [b]) => a.localeCompare(b)).map(([id, st]) => `${id} ${st.lit ? Math.round((100 * st.hit) / st.lit) : 0} % · ${st.lit} · ${fmt(st.vall / Math.max(1, st.lit), 0)} · ${st.hit ? `${fmt(st.dx / st.hit, 1)},${fmt(st.dy / st.hit, 1)}` : 'n/d'}`).join(' ; ') || 'n/d'} ; force usuelle (rangée/arcs) ${fmt(tracker.signal.green, 0)}/${fmt(tracker.signal.amber, 0)}, seuil plancher ${FLOOR}`] : []),
    ...(trackLog.errors ? [`ERREURS dans le traitement d'une image : ${trackLog.errors}, la dernière : ${trackLog.lastError}`] : []),
    ...(state.detect === 'track' ? [`charge : image traitée en moyenne ${fmt((trackLog.sumTick || 0) / Math.max(1, trackLog.nTick || 0), 0)} ms (max ${fmt(trackLog.maxTick || 0, 0)}), images de plus de 200 ms : ${trackLog.slowTicks || 0}, recherche sur toute l'image évitée dans ${fmt((100 * (trackLog.lite || 0)) / Math.max(1, trackLog.pictures || 0), 0)} % des images ; suivi seul : max ${fmt(trackLog.maxUpdate || 0, 1)} ms, remises à zéro pour lenteur : ${trackLog.slowUpdates || 0}, cartes absurdes écartées : ${win.last.tracker?.invalid ?? 0}`] : []),
    ...(state.detect === 'track' ? [`départ : premier clignotement vu ${trackLog.firstSeenT != null ? `après ${fmt((trackLog.firstSeenT - trackLog.t0) / 1000, 1)} s` : 'jamais'}, première carte ${trackLog.firstMapT != null ? `après ${fmt((trackLog.firstMapT - trackLog.t0) / 1000, 1)} s` : 'jamais'}${trackLog.firstSeenT != null && trackLog.firstMapT != null ? ` (${fmt((trackLog.firstMapT - trackLog.firstSeenT) / 1000, 1)} s après le premier clignotement)` : ''}, depuis le début de l'analyse ; seuils de la dernière recherche de carte : arcs ${trackLog.thrRing ?? 'n/d'}, LED ${trackLog.thrRow ?? 'n/d'} ; recherche limitée à la zone où était le robot dans ${trackLog.searches ? fmt((100 * (trackLog.zoned || 0)) / trackLog.searches, 0) : 0} % des ${trackLog.searches || 0} images de recherche`] : []),
    ...(state.detect === 'track' ? [`distance (échelle de la carte ramenée à 640 px de côté long ; trop loin sous ${RANGE.far}, trop près au-dessus de ${RANGE.near} px/mm) : trop loin ${fmt(100 * rangeGuide.summary().far, 0)} %, bon ${fmt(100 * rangeGuide.summary().ok, 0)} %, trop près ${fmt(100 * rangeGuide.summary().near, 0)} % des images avec carte ; échelle avant les dernières pertes : ${trackLog.lossScales.map((v) => v ?? '?').join(' ') || 'aucune'} ; départs refusés : ${Object.entries(trackLog.acqFails).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'}${trackLog.lastAcq && trackLog.lastAcq.err != null ? ` (dernier : écart de la rangée ${fmt(trackLog.lastAcq.err, 2)} pas, marge ${Number.isFinite(trackLog.lastAcq.margin) ? fmt(trackLog.lastAcq.margin, 2) : 'n/d'})` : ''}`] : []),
    ...(state.detect === 'track' ? [`dernières images du suivi (état a/t/c/l = acquis/suivi/inertie/perdu, p = attend la rangée, puis rangée et arcs confirmés, x = réponse écartée): ${trackLog.recent.slice(-40).join(' ')}`] : []),
    `réglages modifiés: ${changedSettings().join(', ') || 'aucun (valeurs par défaut)'}`,
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
      ? await startDemo({ elev, blink: params.has('blink'), extra: params.has('extra'), shake: Number(params.get('shake') || 0), sway: Number(params.get('sway') || 0), dist: Number(params.get('dist') || 380), jumpEvery: Number((params.get('jump') || '').split(',')[0]) || 0, jumpFactor: Number((params.get('jump') || '').split(',')[1]) || 1, rowGain: params.has('rowgain') ? Number(params.get('rowgain')) : 1, rowShift: Number(params.get('rowmm') || 0), ringGain: params.has('ring') ? Number(params.get('ring')) : 1, dimArc: params.has('arcdim') ? Number(params.get('arcdim')) : -1, dimGain: params.has('dimgain') ? Number(params.get('dimgain')) : 0.12, halfMs: () => state.halfMs, group: () => state.group, ringSet: () => state.circle })
      : await startCamera({ facing: state.facing });
    state.cam = cam;
    camWatch.reset(); camSettingsT = -1e9;
    for (const [type, text] of [['mute', 'flux de la caméra interrompu'], ['unmute', 'flux de la caméra repris'], ['ended', 'flux de la caméra terminé']]) if (cam.track && cam.track.addEventListener) cam.track.addEventListener(type, () => { if (state.cam === cam) noteChange('caméra', text); });
    timeline.reset();
    rangeGuide.reset();
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

// 'A': the camera's own exposure; 'L4.0ms': locked, with the time it was locked at (the timeline notes when it changes)
function exposureTag() {
  const lock = $('lockExposure');
  return lock && lock.classList.contains('on') ? `L${(Number($('exposureTime').value) / 10).toFixed(1)}ms` : 'A';
}

function setupExposure() {
  const e = exposureInfo(state.cam);
  const lock = $('lockExposure'), slider = $('exposureTime');
  lock.disabled = !e.canLock;
  $('shortExposure').disabled = !e.canLock;
  lock.textContent = 'Verrouiller l\'exposition';
  lock.classList.remove('on');
  slider.style.display = $('exposureLabel').style.display = 'none';
  $('exposureNote').textContent = state.demo ? 'Scène simulée : pas d\'exposition.'
    : e.canLock ? 'À essayer, pas encore démontré : « Verrouiller » garde la durée d\'exposition du moment ; « Exposition courte » assombrit l\'image pour que les LED ressortent. Le rapport note le réglage de l\'exposition dans la chronologie.'
    : 'Cette caméra ne laisse pas la page régler l\'exposition (normal sur iPad : la caméra s\'adapte seule).';
}

async function toggleExposure() {
  const cam = state.cam;
  if (!cam) return;
  const lock = $('lockExposure'), slider = $('exposureTime');
  const locked = lock.classList.contains('on');
  try {
    if (!locked) {
      // the exposure the camera had chosen is kept (a manual mode with no time may jump to a default: 20 ms on the phone of the 6th test)
      const before = exposureInfo(cam);
      await setExposure(cam, { mode: 'manual', ...(Number.isFinite(before.currentTime) ? { time: before.currentTime } : {}) });
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
const groupText = (g, c = -1) => (isDual(g, c) ? 'la rangée avant (une LED sur deux) avec les arcs N, E, S, W, puis la rangée arrière (une LED sur deux) avec les arcs NE, SE, SW, NW' : [g === -2 ? '' : g < 0 ? 'les 16 LED' : `4 LED alignées (rangée ${g < 2 ? 'avant' : 'arrière'}, une sur deux, ${g % 2 ? 'B' : 'A'})`, c < 0 ? '' : `4 arcs du cercle (${c === 0 ? 'N, E, S, W' : 'NE, SE, SW, NW'})`].filter(Boolean).join(g !== -2 && c >= 0 ? ' et ' : '') || 'aucune LED du dessus');
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

// ---- settings the user may have touched by accident ----------------------------------------------------------
// (the sliders are under the thumb when the page is scrolled: in the 6th test the threshold of the arcs went from 80 to 155 in the
// middle of the run, which looked like an effect of the exposure lock)
const DEFAULTS = { detect: 'track', procAuto: true, blinkThreshold: 50, ringThreshold: 80, halfMs: HALF_MS, group: 4, circle: 2, signal: 'color' };
function changedSettings() {
  const out = [];
  if (state.detect !== DEFAULTS.detect) out.push(`détection « ${state.detect} »`);
  if (!state.procAuto) out.push(`taille fixée à ${state.procSize} px`);
  if (state.blinkThreshold !== DEFAULTS.blinkThreshold) out.push(`seuil ${state.blinkThreshold} (défaut ${DEFAULTS.blinkThreshold})`);
  if (state.ringThreshold !== DEFAULTS.ringThreshold) out.push(`seuil des arcs ${state.ringThreshold} (défaut ${DEFAULTS.ringThreshold})`);
  if (state.halfMs !== DEFAULTS.halfMs) out.push(`demi-période ${state.halfMs} ms`);
  if (state.group !== DEFAULTS.group) out.push(`LED vertes : groupe ${state.group}`);
  if (state.circle !== DEFAULTS.circle) out.push(`arcs : ${circleLabel(state.circle)}`);
  if (state.signal !== DEFAULTS.signal) out.push('signal « toute variation »');
  return out;
}
function resetDefaults() {
  Object.assign(state, { procAuto: true, blinkThreshold: DEFAULTS.blinkThreshold, ringThreshold: DEFAULTS.ringThreshold, halfMs: DEFAULTS.halfMs, group: DEFAULTS.group, circle: DEFAULTS.circle, signal: DEFAULTS.signal });
  state.procSize = 480;
  for (const [id, v] of [['procSize', 'auto'], ['ledGroup', String(state.group)], ['circleSet', String(state.circle)], ['blinkSpeed', String(state.halfMs)], ['ringThreshold', String(state.ringThreshold)], ['blinkThreshold', String(state.blinkThreshold)], ['signal', state.signal]]) $(id).value = v;
  $('ringThresholdValue').textContent = String(state.ringThreshold);
  $('blinkThresholdValue').textContent = String(state.blinkThreshold);
  setDetect(DEFAULTS.detect);
  applyBlink();
  resendRobot();
}

// ---- wiring ------------------------------------------------------------------------------------------
$('startBack').onclick = () => start('back');
$('startFront').onclick = () => start('front');
$('startDemo').onclick = () => start('demo');
if ($('buildNote')) $('buildNote').textContent = `version de la page : ${typeof __BUILD__ === 'string' ? __BUILD__ : 'inconnue'}`;
$('switchCam').onclick = () => start(state.facing === 'user' ? 'back' : 'front');
$('defaults').onclick = resetDefaults;
$('lockExposure').onclick = toggleExposure;
$('shortExposure').onclick = async () => {
  const cam = state.cam;
  if (!cam) return;
  const e = exposureInfo(cam), slider = $('exposureTime'), lock = $('lockExposure');
  try {
    const t = e.time ? Math.min(e.time.max, Math.max(e.time.min, 40)) : 40;          // 4 ms, in units of 0.1 ms
    await setExposure(cam, { mode: 'manual', time: t });
    lock.classList.add('on');
    lock.textContent = 'Exposition verrouillée (cliquer pour libérer)';
    if (e.time) { slider.min = e.time.min; slider.max = e.time.max; slider.step = e.time.step || 1; slider.value = t; slider.style.display = $('exposureLabel').style.display = ''; $('exposureValue').textContent = `${(t / 10).toFixed(1)} ms`; }
  } catch (err) { $('exposureNote').textContent = `Refusé par la caméra : ${err?.message || err}`; }
};
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
// the dual flash is a row pattern AND a ring pattern: the two selects go together (group 4 with circle 2), and leaving one leaves the other
const syncDual = () => { $('ledGroup').value = String(state.group); $('circleSet').value = String(state.circle); };
$('ledGroup').onchange = (e) => { state.group = Number(e.target.value); if (state.group === 4) state.circle = 2; else if (state.circle === 2) state.circle = 1; syncDual(); applyBlink(); resendRobot(); };
$('circleSet').onchange = (e) => { state.circle = Number(e.target.value); if (state.circle === 2) state.group = 4; else if (state.group === 4) state.group = 0; syncDual(); applyBlink(); resendRobot(); };
$('blinkSpeed').onchange = (e) => { state.halfMs = Number(e.target.value); applyBlink(); resendRobot(); };
$('detect').onchange = (e) => { setDetect(e.target.value); };
$('signal').onchange = (e) => { state.signal = e.target.value; resetWindows(); resetAngles(); };
$('blinkThreshold').oninput = (e) => { state.blinkThreshold = +e.target.value; $('blinkThresholdValue').textContent = String(state.blinkThreshold); resetWindows(); resetAngles(); };
$('ringThreshold').oninput = (e) => { state.ringThreshold = +e.target.value; $('ringThresholdValue').textContent = String(state.ringThreshold); resetWindows(); resetAngles(); };
$('threshold').oninput = (e) => { state.threshold = +e.target.value; $('thresholdValue').textContent = String(state.threshold); resetWindows(); resetAngles(); };
$('contrast').oninput = (e) => { state.contrast = +e.target.value; $('contrastValue').textContent = String(state.contrast); resetWindows(); resetAngles(); };
$('colorFilter').onchange = (e) => { state.color = e.target.value; resetWindows(); resetAngles(); };
$('mask').onchange = (e) => { state.mask = e.target.checked; };
$('procSize').onchange = (e) => {
  state.procAuto = e.target.value === 'auto';
  if (!state.procAuto) state.procSize = +e.target.value;
  lock.reset(); resetWindows(); resetAngles();
};
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
$('procSize').value = state.procAuto ? 'auto' : String(state.procSize);
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
