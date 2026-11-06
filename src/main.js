// Test page: can a tablet find the Thymio 3's LEDs in its camera, fast enough for an augmented-reality view?
// It reads the camera, finds the bright spots (detect.js), draws them over the picture and measures what it costs.
// Nothing here estimates a pose yet: this is the first question, "do we see the 16 LEDs, and how quickly".

import { SpotFinder } from './detect.js';
import { Rolling, Rate, fmt } from './stats.js';
import { startCamera, exposureInfo, setExposure } from './camera.js';
import { startDemo } from './demo.js';
import { viewAngleDeg, AngleTable } from './angle.js';
import ledsOnScript from './py/leds_on.py?raw';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

const canvas = $('view');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const finder = new SpotFinder();

const state = { cam: null, facing: 'environment', demo: false, threshold: 200, contrast: 20, color: 'all', mask: false, procWidth: 640 };

// what is measured, over the last frames
const win = {
  counts: new Rolling(60), weights: new Rolling(60),
  read: new Rolling(30), find: new Rolling(30), latency: new Rolling(30),
  rateOut: new Rate(30), frames: [],            // [time, presentedFrames] of the last frames the camera gave
  latencyKind: 'n/d', frameW: 0, frameH: 0,
  last: { spots: [], brightest: 0, lit: 0 },
};
function resetWindows() {
  win.counts = new Rolling(60); win.weights = new Rolling(60);
  win.read = new Rolling(30); win.find = new Rolling(30); win.latency = new Rolling(30);
  win.rateOut = new Rate(30); win.frames = [];
}

// ---- the angle of view -------------------------------------------------------------------------------
// From the tablet's orientation sensor (or, in the simulated scene, from the scene). The table of "how many LEDs
// at which angle" is what answers "are they seen from the side too"; it starts again when a setting that changes
// the count (threshold, analysed width, camera) changes.
let sensor = { beta: NaN, gamma: NaN, seen: false };
let angles = new AngleTable(16);
const resetAngles = () => { angles = new AngleTable(16); };

const currentAngle = () => {
  if (state.cam?.angle) return state.cam.angle();                       // the simulated scene knows it
  return viewAngleDeg(sensor.beta, sensor.gamma, state.facing);
};

// iOS asks for a permission, from a tap; elsewhere the events just come
async function enableOrientation() {
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') await DOE.requestPermission();
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
    const W = Math.min(state.procWidth, vw);
    const H = Math.round((W * vh) / vw);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; resetWindows(); }
    win.frameW = vw; win.frameH = vh;

    const a = performance.now();
    ctx.drawImage(v, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const b = performance.now();
    const res = finder.find(img.data, W, H, state.threshold, {
      contrast: state.contrast, radius: Math.max(4, Math.round(W / 80)), minArea: 2, maxArea: Math.max(50, (W * H) / 150),
    });
    const c = performance.now();
    if (state.mask) { finder.paintMask(img.data); ctx.putImageData(img, 0, 0); }
    // the spots that count: all of them, or the green ones (the 16 Lego LEDs; the ring round the pad and the body
    // LEDs are other colours and also bright)
    const counted = state.color === 'all' ? res.spots : res.spots.filter((s) => s.color === state.color);
    drawSpots(res.spots, counted);

    win.read.push(b - a);
    win.find.push(c - b);
    win.counts.push(counted.length);
    win.weights.push(counted.reduce((s, p) => s + p.weight, 0));
    angles.add(currentAngle(), counted.length);         // zeros count too: "no LED at all from 20°" is the answer, not a gap
    win.rateOut.tick(now);
    win.last = { ...res, spots: counted, found: res.spots };
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
function drawSpots(spots, counted) {
  const k = canvas.width / Math.max(1, canvas.clientWidth);        // canvas pixels per screen pixel
  ctx.lineWidth = 1.5 * k;
  const keep = new Set(counted);
  for (const s of spots) {
    const r = Math.max(6 * k, Math.sqrt(s.area / Math.PI) * 1.5 + 3 * k);
    ctx.strokeStyle = keep.has(s) ? '#3ddc97' : '#8a93b3';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
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
  const steady = counts.count >= 10 && counts.min === 16 && counts.max === 16;
  const big = $('count');
  big.className = `big ${!state.cam ? 'dim' : steady ? 'ok' : n === 0 ? 'dim' : 'warn'}`;
  big.innerHTML = state.cam ? `${n}<small>sur 16</small>` : '–';
  $('countNote').textContent = !state.cam ? 'Il doit y en avoir 16 (2 rangées de 8).'
    : `Sur les ${counts.count} dernières images : de ${counts.min} à ${counts.max} (points vus : ${colorsText(win.last.found || [])}). ` +
      (steady ? 'Les 16 LED sont vues, image après image.'
        : n === 0 ? 'Rien au-dessus du seuil : LED éteintes ? seuil trop haut ?'
        : n < 16 ? 'Moins de 16 : LED éteintes ou cachées, ou points collés (essayez 960 / 1280 px, ou rapprochez-vous).'
        : 'Plus de 16 : des reflets ? remontez le seuil.');

  const ang = currentAngle();
  $('angle').textContent = state.cam ? (Number.isFinite(ang) ? `${Math.round(ang)}°` : 'n/d') : 'n/d';
  $('angleNote').textContent = state.cam && !state.cam.angle && !sensor.seen
    ? 'Pas de capteur d\'orientation lu par ce navigateur : l\'angle reste n/d (le tableau ne se remplit pas).'
    : 'Angle entre l\'axe de la caméra et la table : 90° = de face au-dessus, 0° = à ras de la table. Inclinez la tablette peu à peu en gardant le robot dans l\'image : le tableau compte les points vus à chaque angle.';
  $('angleTable').innerHTML = '<tr class="dim"><td>angle</td><td>images</td><td>points (moy · max)</td><td>16 vus</td></tr>' +
    angles.summary().map((r) => {
      const cls = !r.frames ? 'dim' : r.fullPct >= 90 ? 'ok' : r.max >= 16 ? 'warn' : 'bad';
      return `<tr class="${cls}"><td>${r.label}</td><td>${r.frames}</td><td>${r.frames ? `${fmt(r.mean, 1)} · ${r.max}` : '–'}</td><td>${r.frames ? fmt(r.fullPct, 0, ' %') : '–'}</td></tr>`;
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
  $('speedNote').textContent = !Number.isFinite(tot) ? ''
    : Number.isFinite(fin) && fout < fin * 0.9 ? `L'analyse (${fmt(tot, 1)} ms) est plus lente que la caméra : des images sont sautées.`
    : `L'analyse prend ${fmt(tot, 1)} ms par image${Number.isFinite(fin) ? `, la caméra en donne une toutes les ${fmt(1000 / fin, 0)} ms` : ''}.`;

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
    `analyse: ${canvas.width}x${canvas.height}, seuil ${state.threshold}, contraste local ${state.contrast}, points comptés: ${state.color === 'all' ? 'toutes couleurs' : state.color}, masque ${state.mask ? 'oui' : 'non'}`,
    `couleurs des points vus maintenant: ${colorsText(win.last.found || [])}`,
    `images reçues/s: ${fmt(cameraFps(), 1)}  analysées/s: ${fmt(win.rateOut.perSecond, 1)}`,
    `retard caméra→page: ${latency.count ? `${fmt(latency.mean, 0)} ms (${win.latencyKind})` : 'n/d'}`,
    `lecture de l'image: moy ${fmt(read.mean, 1)} max ${fmt(read.max, 1)} ms`,
    `recherche des points: moy ${fmt(find.mean, 1)} max ${fmt(find.max, 1)} ms`,
    `points: ${win.last.spots.length} maintenant; sur ${counts.count} images min ${counts.min} max ${counts.max} moy ${fmt(counts.mean, 1)}`,
    `variation de l'éclat total: ${weights.count >= 10 ? fmt(weights.spreadPct, 0, ' %') : 'n/d'}`,
    `angle de vue maintenant: ${Number.isFinite(currentAngle()) ? `${Math.round(currentAngle())}°` : 'n/d'} (capteur d'orientation ${state.cam?.angle ? 'simulé' : sensor.seen ? 'lu' : 'non lu'})`,
    'points selon l\'angle de vue (images · points moyen · max · % d\'images avec les 16):',
    ...angles.summary().map((r) => `  ${r.label}: ${r.frames} · ${fmt(r.mean, 1)} · ${r.frames ? r.max : 'n/d'} · ${fmt(r.fullPct, 0, ' %')}`),
    `plus clair: ${win.last.brightest}`,
    `exposition: ${exposureText()}`,
    `robot: ${robot.text}`,
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
    const cam = state.demo ? await startDemo({ elev }) : await startCamera({ facing: state.facing });
    state.cam = cam;
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
const robot = { api: null, on: false, text: 'non connecté' };
const robotNote = (text, cls = 'dim') => { $('robotNote').textContent = text; $('robotNote').className = `note ${cls}`; robot.text = text; };

async function toggleRobot() {
  const btn = $('robot');
  btn.disabled = true;
  try {
    if (!robot.on) {
      robotNote('Connexion…');
      robot.api = robot.api || (await import('thymio-api'));
      const api = robot.api;
      if (!api.isConnected()) await api.requestAndConnect();
      if (!api.isConnected()) throw new Error('le robot n\'est pas connecté');
      try { await api.stopSensorStreaming?.(); } catch { /* not streaming */ }
      await api.stopScriptExecution();
      await sleep(60);
      robotNote('Envoi du script au robot…');
      await api.sendPythonScript(ledsOnScript);
      await api.executeLoadedScript();
      robot.on = true;
      btn.textContent = 'Éteindre les LED (arrêter le script)';
      btn.classList.add('on');
      robotNote('Script lancé : les 16 LED doivent être allumées (niveau 16, sans scintillement).', 'ok');
    } else {
      await robot.api.stopScriptExecution();
      robotOff('Script arrêté : le firmware reprend ses LED.');
    }
  } catch (err) {
    robotNote(`${err?.name || 'Erreur'} : ${err?.message || err}`, 'bad');
  } finally {
    btn.disabled = !('bluetooth' in navigator);
  }
}

function robotOff(text) {
  robot.on = false;
  $('robot').textContent = 'Connecter le robot et allumer les 16 LED';
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
$('threshold').oninput = (e) => { state.threshold = +e.target.value; $('thresholdValue').textContent = String(state.threshold); resetWindows(); resetAngles(); };
$('contrast').oninput = (e) => { state.contrast = +e.target.value; $('contrastValue').textContent = String(state.contrast); resetWindows(); resetAngles(); };
$('colorFilter').onchange = (e) => { state.color = e.target.value; resetWindows(); resetAngles(); };
$('mask').onchange = (e) => { state.mask = e.target.checked; };
$('procWidth').onchange = (e) => { state.procWidth = +e.target.value; resetWindows(); resetAngles(); };
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

if (!('bluetooth' in navigator)) robotNote('Pas de Web Bluetooth dans ce navigateur (sur iPad : Bluefy). La caméra se teste quand même, avec les LED allumées autrement.');
$('robot').disabled = !('bluetooth' in navigator);       // the robot can be lit with no camera started: to photograph it with another device
setInterval(refreshPanel, 250);
refreshPanel();
if (params.has('demo')) start('demo');
