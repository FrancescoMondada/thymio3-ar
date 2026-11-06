// Which pixels blink at the robot's rhythm: a lock-in detector.
//
// The robot lights its 16 LEDs on and off at a known frequency (leds_lego.py, `blink`). A pixel that does the same
// follows a sine at that frequency, whatever its phase; a pixel that is steady (the white body, the ring round the
// pad, the blue and red lights, a reflection) does not. For each colour channel of each pixel, over the last K
// pictures:
//
//   I = sum( wc[k] * x[k] )     Q = sum( ws[k] * x[k] )     amplitude = sqrt(I² + Q²)
//
// with wc, ws = cos(2π f t) and sin(2π f t) at the time t of each picture, from which the mean and the slope in time
// over the window are taken out. That makes a steady pixel give exactly 0 whatever the times are (pictures late or
// missing), and a pixel that changes slowly and steadily as well (an edge that slides across it because the hand
// moves). The phase of the blink does not need to be known or kept in step: the amplitude is the same for any phase. The three channels are added as the root of the sum of their squares: a
// green LED on a white stud makes green go up and blue and red go down (measured on a photo of the robot:
// stud (152,167,158) -> lit (143,251,19)), and the brightest channel alone would see little of it.
//
// Two results. `amp`: the three channels added as above, any change at the blink rhythm. `chroma`: the blink of
// G - (R + B) / 2 (the lock-in is linear, so it comes from the same I and Q of the channels), a colour signal: a green
// LED on a grey stud changes the colour as well as the brightness (the stud goes from (152,167,158) to (143,251,19)),
// while an edge that moves with the hand, or a white reflection, changes the brightness only (R, G and B together)
// and gives about 0 there. This is what keeps the shaking outline of the robot from being taken for an LED. It is not
// specific to green: a blue or a red light that blinks changes G - (R + B) / 2 too, the other way.
//
// The results are in the units of a channel (0..255): a pixel that goes from `a` to `b` in a square wave gives
// 0.64 * the root of the sum of the squares of the three differences. The time of a picture is the one the camera
// gives (or the one the page saw it), in ms.

export class LockIn {
  constructor({ hz, frames = 12, detrend = true } = {}) {
    this.hz = hz;
    this.detrend = detrend;
    this.K = frames;
    this.w = 0;
    this.h = 0;
    this.ring = [];                       // the last K pictures, as three planes (R, G, B) of one byte per pixel
    this.times = new Array(frames).fill(0);
    this.head = 0;                        // where the next picture goes
    this.count = 0;
    this.amp = null;                      // the amplitude image, 0..255: any change at the blink rhythm
    this.chroma = null;                   // the same for the greenness G - (R + B) / 2
    this.accI = null;                     // I and Q of the three channels, one plane each
    this.accQ = null;
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.ring = Array.from({ length: this.K }, () => new Uint8Array(3 * w * h));
    this.head = 0;
    this.count = 0;
    this.amp = new Uint8Array(w * h);
    this.chroma = new Uint8Array(w * h);
    this.accI = new Float32Array(3 * w * h);
    this.accQ = new Float32Array(3 * w * h);
  }

  reset() {
    this.count = 0;
    this.head = 0;
  }

  // Adds a picture (RGBA) taken at tMs. -> true when `amp` is up to date (K pictures are in), false before.
  push(rgba, w, h, tMs) {
    this.resize(w, h);
    // a long gap (the page was hidden, the camera stalled) leaves nothing to compare with: start again
    if (this.count > 0) {
      const last = this.times[(this.head + this.K - 1) % this.K];
      if (tMs - last > 1000 || tMs < last) this.count = 0;
    }
    const plane = this.ring[this.head];
    const n = w * h;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      plane[i] = rgba[j];
      plane[n + i] = rgba[j + 1];
      plane[2 * n + i] = rgba[j + 2];
    }
    this.times[this.head] = tMs;
    this.head = (this.head + 1) % this.K;
    if (this.count < this.K) this.count++;
    if (this.count < this.K) return false;
    this.compute();
    return true;
  }

  // The weights of the K pictures in the window, in ring order: cos and sin of the blink, with whatever is steady
  // or a steady slope in time taken out of them (least squares against 1 and t), so that a pixel that is steady, or
  // that changes slowly and steadily (an edge that slides across it because the hand moves), gives exactly 0. They are
  // scaled so that a sine of amplitude `a` at the blink frequency gives I = a cos(phase) and Q = a sin(phase).
  weights() {
    const K = this.K;
    const t = new Float64Array(K);
    let tm = 0;
    for (let k = 0; k < K; k++) { t[k] = this.times[k] / 1000; tm += t[k]; }
    tm /= K;
    let stt = 0;
    for (let k = 0; k < K; k++) { t[k] -= tm; stt += t[k] * t[k]; }
    const raw = (fn) => {
      const w = new Float64Array(K);
      let m = 0;
      for (let k = 0; k < K; k++) { w[k] = fn(2 * Math.PI * this.hz * (this.times[k] / 1000)); m += w[k]; }
      m /= K;
      let sw = 0;
      for (let k = 0; k < K; k++) { w[k] -= m; sw += w[k] * t[k]; }
      const b = this.detrend && stt > 0 ? sw / stt : 0;
      for (let k = 0; k < K; k++) w[k] -= b * t[k];
      return w;
    };
    const wc = raw(Math.cos), ws = raw(Math.sin);
    let nc = 0, ns = 0;
    for (let k = 0; k < K; k++) {
      const theta = 2 * Math.PI * this.hz * (this.times[k] / 1000);
      nc += wc[k] * Math.cos(theta);
      ns += ws[k] * Math.sin(theta);
    }
    const fc = Math.abs(nc) > 1e-9 ? 1 / nc : 0, fs = Math.abs(ns) > 1e-9 ? 1 / ns : 0;
    return { wc: Float32Array.from(wc, (x) => x * fc), ws: Float32Array.from(ws, (x) => x * fs) };
  }

  compute() {
    const { K, ring, accI, accQ, amp, chroma } = this;
    const n = this.w * this.h;
    const { wc, ws } = this.weights();
    accI.fill(0);
    accQ.fill(0);
    for (let c = 0; c < 3; c++) {
      const base = c * n;
      for (let k = 0; k < K; k++) {
        const v = ring[k], wk = wc[k], sk = ws[k];
        for (let i = 0; i < n; i++) {
          const x = v[base + i];
          accI[base + i] += wk * x;
          accQ[base + i] += sk * x;
        }
      }
    }
    const g = n, b = 2 * n;
    for (let i = 0; i < n; i++) {
      const ir = accI[i], ig = accI[g + i], ib = accI[b + i];
      const qr = accQ[i], qg = accQ[g + i], qb = accQ[b + i];
      const a = Math.sqrt(ir * ir + ig * ig + ib * ib + qr * qr + qg * qg + qb * qb);
      const iu = ig - 0.5 * (ir + ib), qu = qg - 0.5 * (qr + qb);
      const u = Math.sqrt(iu * iu + qu * qu);
      amp[i] = a > 255 ? 255 : a;
      chroma[i] = u > 255 ? 255 : u;
    }
  }
}
