// The numbers the test page shows: a window of the last values, with their mean, lowest and highest.

export class Rolling {
  constructor(size = 60) {
    this.size = size;
    this.values = [];
  }

  push(x) {
    if (!Number.isFinite(x)) return;
    this.values.push(x);
    if (this.values.length > this.size) this.values.shift();
  }

  get count() { return this.values.length; }
  get min() { return this.values.length ? Math.min(...this.values) : NaN; }
  get max() { return this.values.length ? Math.max(...this.values) : NaN; }
  get mean() { return this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : NaN; }

  // how much the values move: (highest - lowest) / mean, as a percentage
  get spreadPct() {
    const m = this.mean;
    return m > 0 ? (100 * (this.max - this.min)) / m : NaN;
  }
}

// Frames per second from the times (ms) of the last frames.
export class Rate {
  constructor(size = 30) {
    this.size = size;
    this.times = [];
  }

  tick(t) {
    this.times.push(t);
    if (this.times.length > this.size) this.times.shift();
  }

  get perSecond() {
    const t = this.times;
    if (t.length < 2) return NaN;
    const span = t[t.length - 1] - t[0];
    return span > 0 ? (1000 * (t.length - 1)) / span : NaN;
  }
}

export const fmt = (x, digits = 1, unit = '') => (Number.isFinite(x) ? `${x.toFixed(digits)}${unit}` : 'n/d');
