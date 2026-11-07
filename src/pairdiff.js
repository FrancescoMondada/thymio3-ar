// Which pixels turn on or off at the robot's rhythm, found by DIFFERENCE between two pictures half a period apart
// (the idea of the user: a picture with the LEDs off, one with them on, and subtract). Unlike the lock-in
// (lockin.js), which needs a pixel to stay where it is for a whole second, this one holds up when the phone moves:
// an LED that is lit in one picture and not in the other shows in the difference WHEREVER it is in the picture, and
// the body, the table and the steady lights of the robot (they have the same colour in both) are gone.
//
// (With `measure: 'amber'` the same is done for the amber arcs of the ring round the touch pad, with the amber excess
// R >= G ? max(0, G - B) : 0: on the photo of the robot with 6 of the 8 arcs lit it finds exactly those 6, and none of
// the wooden table, the magenta and cyan glows, the red glow or the green LEDs.)
//
// For each picture the green excess gp = max(0, G - max(R, B)) of every pixel is kept. A lit LED of the robot gives
// 170 to 210 on the user's photos (stud (152,167,158) -> lit rim (143,251,19); its white-hot core gives less, the rim
// stays); anything that is not green gives 0 or close: the grey body and table (a few units), a white reflection, an
// edge that moves, and the amber ring, the blue and red lights, the cyan and magenta body LEDs (their green never beats
// their red or blue). (G - (R + B) / 2 was tried first: it gives about 50 to the amber ring, which showed up as false
// spots as soon as the picture moved.) A new picture at
// time t is compared with every kept picture whose age is between `lo` and `hi` half periods (0.4 to 1.6 by default,
// so that at least one of them is from the other half of the blink, whatever the phase and the rate of the camera):
//
//   P = the most the greenness has gone UP since one of them     -> the LEDs that are on now, where they are now
//   N = the most the greenness has gone DOWN since one of them   -> the LEDs that were on then, where they were then
//
// Which of the two the page shows is the one with more spots (P when equal): half the time the LEDs are on and P has
// them, the other half N has them, a few tenths of a second old. Neither needs to know the phase of the blink.
//
// Measured on a synthetic scene with the picture swaying back and forth (peak speed in LED diameters a second): the 4 LEDs
// are found in all the pictures up to 4 diameters a second at 10 pictures a second, 94 % at 6 pictures a second, where
// the lock-in over a second finds none from 2 or 4 diameters a second.
import { SpotFinder } from './detect.js';

export class PairDiff {
  // measure: 'green' (the 16 Lego LEDs: G - max(R, B)) or 'amber' (the ring arcs: min(R, G) - B where R >= 0.75 G, else 0);
  // 'amber0' is the first amber measure (G - B where R >= G), kept for the tests that show why it was replaced.
  // smooth: 1 blurs P and N with a 3 x 3 mean before the spots are looked for: the speckle of a compressed video (a saturated
  // yellow arc, R = G = 255 give or take the noise) no longer breaks a big blob into pieces; for blobs of 10 px or more only.
  constructor({ halfMs, lo = 0.4, hi = 1.6, cap = 24, measure = 'green', smooth = 0 } = {}) {
    this.measure = measure;
    this.smooth = smooth;
    this.halfMs = halfMs;
    this.lo = lo;
    this.hi = hi;
    this.cap = cap;                       // how many pictures are kept (a camera at 30 a second gives 10 in 1.6 x 200 ms)
    this.w = 0;
    this.h = 0;
    this.ring = new Array(cap).fill(null);
    this.times = new Array(cap).fill(0);
    this.head = 0;
    this.count = 0;
    this.refs = 0;                        // how many pictures the last one was compared with
    this.ready = false;
    this.P = null;
    this.N = null;
    this.source = null;                   // 'P' or 'N': which one the last find() used
    this.pf = new SpotFinder();
    this.nf = new SpotFinder();
    this.pf2 = new SpotFinder();           // for the look inside a window: the others keep what the mask shows
    this.nf2 = new SpotFinder();
    this.Pm = null;
    this.Nm = null;
    this.active = this.pf;
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.ring = new Array(this.cap).fill(null);
    this.P = new Uint8Array(w * h);
    this.N = new Uint8Array(w * h);
    this.tmp = new Uint16Array(w * h);
    this.Pm = null;
    this.Nm = null;
    this.reset();
  }

  reset() {
    this.head = 0;
    this.count = 0;
    this.refs = 0;
    this.ready = false;
  }

  // Adds a picture (RGBA) taken at tMs and compares it with the kept ones. -> true when P and N are up to date, false
  // when there is no picture of the right age yet.
  push(rgba, w, h, tMs) {
    this.resize(w, h);
    // a long gap (the page was hidden, the camera stalled) leaves nothing to compare with
    if (this.count > 0) {
      const last = this.times[(this.head + this.cap - 1) % this.cap];
      if (tMs - last > 1000 || tMs < last) this.reset();
    }
    const n = w * h;
    const cur = this.ring[this.head] || (this.ring[this.head] = new Uint8Array(n));
    if (this.measure === 'amber') {
      // the arcs of the ring in the phone's picture are SATURATED YELLOW, (255,255,24), (254,255,23), (253,248,17): R and G are
      // equal give or take the noise, so the measure must not depend on which of them is larger. min(R, G) - B gives 230 for
      // them; the green LEDs (143,251,19) or (54,255,36) have R well under G and are refused by R >= 0.75 G; white, grey: 0; the
      // wooden table (110,90,65): 25, (200,150,100): 50, but steady
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], g = rgba[j + 1], a = r >= 0.75 * g ? (r < g ? r : g) - rgba[j + 2] : 0;
        cur[i] = a > 0 ? a : 0;
      }
    } else if (this.measure === 'amber0') {
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], g = rgba[j + 1], a = r >= g ? g - rgba[j + 2] : 0;
        cur[i] = a > 0 ? a : 0;
      }
    } else {
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], b = rgba[j + 2], g = rgba[j + 1] - (r > b ? r : b);
        cur[i] = g > 0 ? g : 0;
      }
    }
    this.times[this.head] = tMs;
    const { P, N } = this;
    P.fill(0);
    N.fill(0);
    let refs = 0;
    // the kept pictures are the `count` before this one (never the place this one was just written to)
    for (let i = 1; i <= Math.min(this.count, this.cap - 1); i++) {
      const slot = (this.head - i + 2 * this.cap) % this.cap;
      const age = tMs - this.times[slot];
      if (age > this.hi * this.halfMs) break;
      if (age < this.lo * this.halfMs) continue;
      refs++;
      const ref = this.ring[slot];
      for (let k = 0; k < n; k++) {
        const d = cur[k] - ref[k];
        if (d > 0) { if (d > P[k]) P[k] = d; } else if (-d > N[k]) N[k] = -d;
      }
    }
    if (this.smooth && refs) { blur3(P, w, h, this.tmp); blur3(N, w, h, this.tmp); }
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    this.refs = refs;
    this.ready = refs > 0;
    return this.ready;
  }

  // The spots of the last picture (the SpotFinder result, plus `source`, and `peak`: the strongest response of P or N, found or not). With a `window` ({ bbox, inside(p) }: layout.js): only the
  // part of the picture inside it, which is where the page expects this set to be because the OTHER set has been found: the threshold
  // can then be lower than elsewhere (a faint arc next to a row that is seen well), without the noise of the rest of the picture.
  find(threshold, size, window = null) {
    if (window) return this.findIn(threshold, size, window);
    const rp = this.pf.findFromValues(this.P, this.w, this.h, threshold, size);
    const rn = this.nf.findFromValues(this.N, this.w, this.h, threshold, size);
    const useP = rp.spots.length >= rn.spots.length;
    this.source = useP ? 'P' : 'N';
    this.active = useP ? this.pf : this.nf;
    return { ...(useP ? rp : rn), source: this.source, peak: Math.max(rp.brightest, rn.brightest) };
  }

  findIn(threshold, size, window) {
    const { w, h } = this, n = w * h;
    if (!this.Pm) { this.Pm = new Uint8Array(n); this.Nm = new Uint8Array(n); }
    const { Pm, Nm, P, N } = this;
    Pm.fill(0);
    Nm.fill(0);
    const x0 = Math.max(0, Math.floor(window.bbox.x0)), x1 = Math.min(w - 1, Math.ceil(window.bbox.x1));
    const y0 = Math.max(0, Math.floor(window.bbox.y0)), y1 = Math.min(h - 1, Math.ceil(window.bbox.y1));
    const pt = { x: 0, y: 0 };
    for (let y = y0; y <= y1; y++) {
      pt.y = y;
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!P[i] && !N[i]) continue;
        pt.x = x;
        if (window.inside(pt)) { Pm[i] = P[i]; Nm[i] = N[i]; }
      }
    }
    const rp = this.pf2.findFromValues(Pm, w, h, threshold, size);
    const rn = this.nf2.findFromValues(Nm, w, h, threshold, size);
    const useP = rp.spots.length >= rn.spots.length;
    return { ...(useP ? rp : rn), source: useP ? 'P' : 'N', windowed: true, peak: Math.max(rp.brightest, rn.brightest) };
  }

  // Paints what the settings let through (the one that find() used) into a picture.
  paintMask(rgba) {
    this.active.paintMask(rgba);
  }
}

// 3 x 3 mean, in place (the edges are left as they are): the pixels of a blob that the noise had made 0 take the value of
// their neighbours, an isolated pixel of noise is divided by 9
function blur3(a, w, h, tmp) {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) tmp[row + x] = a[row + x - 1] + a[row + x] + a[row + x + 1];
    tmp[row] = 3 * a[row]; tmp[row + w - 1] = 3 * a[row + w - 1];
  }
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) a[row + x] = (tmp[row - w + x] + tmp[row + x] + tmp[row + w + x]) / 9;
  }
}
