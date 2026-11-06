// Runs the page's spot finder on a photo and draws what it finds: to see what the detector does on a real picture
// of the robot, with no tablet and no camera. macOS only (it uses `sips` to read the photo).
//
//   node scripts/detect-photo.mjs photos/robot.jpg [--width 1280] [--threshold 200] [--contrast 20]
//        [--color all|vert] [--out annotated.png] [--mask masked.png] [--tmp DIR]
//   node scripts/detect-photo.mjs photos/on.jpg --off photos/off.jpg [--diff-threshold 80] [--width 1280] ...
//
// With --off: the photo with the LEDs on, and one of the same view with them off (a tripod, or a steady hand); the
// spots are where the two differ (the root of the sum of the squares of the three channel differences) by at least
// --diff-threshold. Steady lights of any colour, the body, reflections: gone. A view that moved between the photos
// leaves a bright outline on every edge.
//
// green circle: a spot that counts; grey circle: a spot of another colour (when --color vert).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpotFinder } from '../src/detect.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
if (!file) { console.error('usage: node scripts/detect-photo.mjs photo.jpg [--width 1280] [--threshold 200] [--contrast 20] [--color all|vert] [--out a.png] [--mask m.png] [--tmp DIR]'); process.exit(2); }

const offFile = opt('off', null), diffThreshold = +opt('diff-threshold', 80);
const width = +opt('width', 1280), threshold = +opt('threshold', 200), contrast = +opt('contrast', 20), color = opt('color', 'all');
const tmp = mkdtempSync(join(opt('tmp', tmpdir()), 'spots-'));

function readBmp(path) {
  const b = readFileSync(path);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  if (b.readUInt32LE(30) !== 0 && b.readUInt32LE(30) !== 3) throw new Error('compressed BMP');
  const h = Math.abs(hRaw), topDown = hRaw < 0, bytes = bpp / 8, stride = Math.ceil((w * bytes) / 4) * 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const s = row + x * bytes, d = (y * w + x) * 4;
      rgba[d] = b[s + 2]; rgba[d + 1] = b[s + 1]; rgba[d + 2] = b[s]; rgba[d + 3] = 255;
    }
  }
  return { w, h, rgba };
}

function writeBmp(path, w, h, rgba) {
  const stride = Math.ceil((w * 3) / 4) * 4, size = 54 + stride * h, b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(-h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = 54 + y * stride + x * 3;
    b[d] = rgba[s + 2]; b[d + 1] = rgba[s + 1]; b[d + 2] = rgba[s];
  }
  writeFileSync(path, b);
}

function circle(rgba, w, h, cx, cy, r, [R, G, B], thick = 2) {
  for (let a = 0; a < 720; a++) {
    const t = (a * Math.PI) / 360;
    for (let k = 0; k < thick; k++) {
      const x = Math.round(cx + (r + k) * Math.cos(t)), y = Math.round(cy + (r + k) * Math.sin(t));
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = (y * w + x) * 4;
      rgba[d] = R; rgba[d + 1] = G; rgba[d + 2] = B;
    }
  }
}

const toPng = (bmp, out) => execFileSync('sips', ['-s', 'format', 'png', bmp, '--out', out], { stdio: 'ignore' });

try {
  const bmp = join(tmp, 'in.bmp');
  execFileSync('sips', ['-s', 'format', 'bmp', '--resampleWidth', String(width), file, '--out', bmp], { stdio: 'ignore' });
  const { w, h, rgba } = readBmp(bmp);
  const finder = new SpotFinder();
  const t0 = performance.now();
  const size = { minArea: 2, maxArea: Math.max(50, (w * h) / 150) };
  let res;
  if (offFile) {
    const bmpOff = join(tmp, 'off.bmp');
    execFileSync('sips', ['-s', 'format', 'bmp', '--resampleWidth', String(width), offFile, '--out', bmpOff], { stdio: 'ignore' });
    const off = readBmp(bmpOff);
    if (off.w !== w || off.h !== h) throw new Error(`the two photos must be the same size (${w}x${h} and ${off.w}x${off.h})`);
    const diff = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < diff.length; i++, j += 4) {
      diff[i] = Math.min(255, Math.hypot(rgba[j] - off.rgba[j], rgba[j + 1] - off.rgba[j + 1], rgba[j + 2] - off.rgba[j + 2]));
    }
    res = finder.findFromValues(diff, w, h, diffThreshold, size);
  } else {
    res = finder.find(rgba, w, h, threshold, { contrast, radius: Math.max(4, Math.round(w / 80)), ...size });
  }
  const ms = performance.now() - t0;
  const counted = color === 'all' ? res.spots : res.spots.filter((s) => s.color === color);
  const by = {};
  for (const s of res.spots) by[s.color] = (by[s.color] || 0) + 1;
  console.log(`${w}x${h}  ${offFile ? `difference with ${offFile}, threshold ${diffThreshold}` : `threshold ${threshold}  contrast ${contrast}`}  brightest ${res.brightest}  lit pixels ${res.lit}  search ${ms.toFixed(1)} ms`);
  console.log(`spots: ${res.spots.length} (${Object.entries(by).map(([c, n]) => `${n} ${c}`).join(', ') || 'none'});  counted (${color}): ${counted.length}`);
  for (const s of counted.slice().sort((a, b) => a.y - b.y).slice(0, 40)) console.log(`  ${s.color.padEnd(7)} x ${s.x.toFixed(1).padStart(7)} y ${s.y.toFixed(1).padStart(7)}  area ${String(s.area).padStart(4)}  ${s.w}x${s.h}  peak ${s.peak}`);

  const out = opt('out', null);
  if (out) {
    const a = new Uint8ClampedArray(rgba);
    const keep = new Set(counted);
    for (const s of res.spots) circle(a, w, h, s.x, s.y, Math.max(7, Math.sqrt(s.area / Math.PI) * 1.5 + 4), keep.has(s) ? [61, 220, 151] : [138, 147, 179]);
    const o = join(tmp, 'out.bmp'); writeBmp(o, w, h, a); toPng(o, out);
    console.log(`annotated picture: ${out}`);
  }
  const mask = opt('mask', null);
  if (mask) {
    const a = new Uint8ClampedArray(rgba);
    finder.paintMask(a);
    const o = join(tmp, 'mask.bmp'); writeBmp(o, w, h, a); toPng(o, mask);
    console.log(`mask picture: ${mask}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
