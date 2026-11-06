// Which pixels turn on or off at the robot's rhythm, found by DIFFERENCE between two pictures half a period apart
// (the idea of the user: a picture with the LEDs off, one with them on, and subtract). Unlike the lock-in
// (lockin.js), which needs a pixel to stay where it is for a whole second, this one holds up when the phone moves:
// an LED that is lit in one picture and not in the other shows in the difference WHEREVER it is in the picture, and
// the body, the table and the steady lights of the robot (they have the same colour in both) are gone.
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
  constructor({ halfMs, lo = 0.4, hi = 1.6, cap = 24 } = {}) {
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
    this.active = this.pf;
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.ring = new Array(this.cap).fill(null);
    this.P = new Uint8Array(w * h);
    this.N = new Uint8Array(w * h);
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
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = rgba[j], b = rgba[j + 2], g = rgba[j + 1] - (r > b ? r : b);
      cur[i] = g > 0 ? g : 0;
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
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    this.refs = refs;
    this.ready = refs > 0;
    return this.ready;
  }

  // The spots of the last picture (the SpotFinder result, plus `source`).
  find(threshold, size) {
    const rp = this.pf.findFromValues(this.P, this.w, this.h, threshold, size);
    const rn = this.nf.findFromValues(this.N, this.w, this.h, threshold, size);
    const useP = rp.spots.length >= rn.spots.length;
    this.source = useP ? 'P' : 'N';
    this.active = useP ? this.pf : this.nf;
    return { ...(useP ? rp : rn), source: this.source };
  }

  // Paints what the settings let through (the one that find() used) into a picture.
  paintMask(rgba) {
    this.active.paintMask(rgba);
  }
}
