// A drawn scene in place of the camera, to try the page with no camera and no robot: a dark table, the
// robot seen in perspective from a camera that circles it and swings between straight above (90°) and almost
// level with the table (about 20°), and its 16 Lego LEDs (two rows of 8, 8 mm apart: where the stud grid of the
// robot drawn in thymio3-learn puts them, to be checked on the robot).
//
// What it shows is the GEOMETRY only: how far apart the LEDs come out in the picture, and so when they run
// together. It does not know how much light an LED gives out sideways (it draws every LED as bright from
// every side): that is what the test on a real robot is for.
//
// `?demo&elev=30` holds the view at 30° instead of swinging. `&blink` makes the 16 LEDs blink as the robot's script
// does; `&extra` adds steady lights of other colours (a blue one, a red glow, a ring of amber ones), as on the real
// robot; `&shake=2` moves the whole picture by up to 2 px at each frame, like a hand that trembles.

import { fromStream } from './camera.js';
import { HALF_MS } from './script.js';

export const DEMO_W = 1280;
export const DEMO_H = 720;
export const FOCAL = 1000;                 // px, for a picture 1280 wide (about 65° across)
const DEG = Math.PI / 180;

// the camera at `elevDeg` above the table plane, seen from the direction `azimDeg`, `dist` mm from the middle of
// the robot, looking at it. Table plane: z = 0, x to the right of the robot, y towards its nose.
export function cameraAt(elevDeg, azimDeg, dist) {
  const e = elevDeg * DEG, a = azimDeg * DEG;
  const pos = [dist * Math.cos(e) * Math.cos(a), dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e)];
  const f = [-pos[0] / dist, -pos[1] / dist, -pos[2] / dist];
  const r = [-Math.sin(a), Math.cos(a), 0];                          // f x up, which never degenerates this way
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { pos, f, r, u };
}

const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

// -> { x, y, z }: the picture position (px) of a point of the world, and its depth (mm)
export function project(cam, P, focal = FOCAL, cx = DEMO_W / 2, cy = DEMO_H / 2) {
  const p = [P[0] - cam.pos[0], P[1] - cam.pos[1], P[2] - cam.pos[2]];
  const z = dot(p, cam.f);
  return { x: cx + (focal * dot(p, cam.r)) / z, y: cy - (focal * dot(p, cam.u)) / z, z };
}

// where the 16 LEDs are, in the world (mm): rows at y_svg = 7 and 15 of RobotBody.jsx (the nose is at -y), x from -28 to 28
export const ledPositions = () => {
  const out = [];
  for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) out.push([(k - 3.5) * 8, -(7 + 8 * row), 0]);
  return out;
};

// a rounded rectangle, counter-clockwise, as points of the table plane
function roundedRect(w, h, r, cx = 0, cy = 0, perCorner = 8) {
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = (a0 + (90 * i) / perCorner) * DEG;
      pts.push([cx + x + r * Math.cos(a), cy + y + r * Math.sin(a), 0]);
    }
  }
  return pts;
}

const circle = (r, cx, cy, n = 40) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), 0]);

export async function startDemo({ elev = null, blink = false, extra = false, shake = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = DEMO_W;
  canvas.height = DEMO_H;
  const g = canvas.getContext('2d');
  const t0 = performance.now();
  const body = roundedRect(110, 112, 16);
  const pad = circle(24, 0, 26);               // the touch pad, near the nose (y_svg = -26)
  const leds = ledPositions();
  const HEIGHT = 50;                           // mm, the body under the top face
  const view = { elev: 90 };

  const poly = (pts, fill) => {
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };

  // a round light at a projected point: `stops` are the colours at 0, 0.3, 0.65 and 1 of its radius (`mm` wide in the world)
  const glow = (c, mm, stops) => {
    const r = (mm * FOCAL) / c.z;
    const halo = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    [0, 0.3, 0.65, 1].forEach((at, i) => halo.addColorStop(at, stops[i]));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(c.x, c.y, r, 0, 2 * Math.PI);
    g.fill();
  };

  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    view.elev = elev != null ? elev : 55 + 35 * Math.sin((2 * Math.PI * t) / 40);       // 20 .. 90°
    const azim = 90 + 70 * Math.sin((2 * Math.PI * t) / 53);                             // from the nose side, and round towards both sides
    const cam = cameraAt(Math.min(view.elev, 89.9), azim, 380);

    g.fillStyle = '#10141c';
    g.fillRect(0, 0, DEMO_W, DEMO_H);
    g.save();
    if (shake) g.translate(Math.round((Math.random() - 0.5) * 2 * shake), Math.round((Math.random() - 0.5) * 2 * shake));
    // the sides of the body that face the camera
    for (let i = 0; i < body.length; i++) {
      const a = body[i], b = body[(i + 1) % body.length];
      const nx = b[1] - a[1], ny = -(b[0] - a[0]);                                      // outward, the outline being counter-clockwise
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -HEIGHT / 2];
      if (nx * (cam.pos[0] - mid[0]) + ny * (cam.pos[1] - mid[1]) <= 0) continue;
      const shade = 150 + Math.round(40 * (nx / Math.hypot(nx, ny)));
      poly([project(cam, a), project(cam, b), project(cam, [b[0], b[1], -HEIGHT]), project(cam, [a[0], a[1], -HEIGHT])], `rgb(${shade},${shade + 4},${shade + 12})`);
    }
    poly(body.map((p) => project(cam, p)), '#d9dde3');
    poly(pad.map((p) => project(cam, p)), '#b8bec8');
    // the 16 LEDs: green with a white-hot core, about 5 mm across, as seen from every side, steady or blinking
    const lit = !blink || Math.floor((t * 1000) / HALF_MS) % 2 === 0;
    if (lit) for (const p of leds) glow(project(cam, p), 2.6, ['rgb(255,255,255)', 'rgb(190,255,190)', 'rgb(70,255,70)', 'rgba(40,255,40,0)']);
    if (extra) {
      // steady lights that are not the 16: a blue one at the front, a red glow low at the back, the ring round the pad
      glow(project(cam, [0, 54, 0]), 3.5, ['rgb(255,255,255)', 'rgb(120,170,255)', 'rgb(40,80,255)', 'rgba(30,60,255,0)']);
      for (const x of [-45, 45]) glow(project(cam, [x, -50, -HEIGHT]), 6, ['rgb(255,200,180)', 'rgb(255,80,40)', 'rgb(255,40,20)', 'rgba(255,30,10,0)']);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        glow(project(cam, [24 * Math.cos(a), 26 + 24 * Math.sin(a), 0]), 2.2, ['rgb(255,240,160)', 'rgb(255,200,40)', 'rgb(255,170,20)', 'rgba(255,150,0,0)']);
      }
    }
    g.restore();
  };
  draw();
  const timer = setInterval(draw, 1000 / 30);
  const stream = canvas.captureStream(30);
  const cam = await fromStream(stream, { label: 'scène simulée', stopExtra: () => clearInterval(timer) });
  cam.angle = () => view.elev;                 // the page reads the angle here instead of the orientation sensor
  return cam;
}
