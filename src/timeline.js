// What happened over the whole test, in slices of 10 s: the report of the phone gives the last 60 pictures only (a few seconds), which
// cannot say whether the detection is steady, or comes and goes, or fails at the end. Per slice: how many pictures, in how many the
// row was found, the ring, both, how many were saved by the prediction, the strongest response of each set, the mean movement of the
// phone, and the settings in force (a change of settings shows as a new line).
//
// `seen`: whether anything responded in the picture at all (the strongest response of either set above a floor). When the phone
// is pointed away from the robot (to read the settings, say) nothing blinks in the picture: those pictures are counted apart, and the
// shares are given both over all the pictures and over those where something responds, i.e. "when the robot is aimed at".
export class Timeline {
  constructor({ binMs = 10000, maxBins = 18 } = {}) {
    this.binMs = binMs;
    this.maxBins = maxBins;
    this.t0 = null;
    this.list = [];
  }

  reset() {
    this.t0 = null;
    this.list = [];
  }

  // one picture, at time tMs (ms, any origin): row / ring: found (true), not found (false) or not asked for (null);
  // rescued: the prediction of the other set found it; peaks: the strongest response of each set in this picture
  add(tMs, { row = null, ring = null, rescued = false, rowPeak = 0, ringPeak = 0, motion = NaN, cfg = '', seen = true } = {}) {
    if (this.t0 === null) this.t0 = tMs;
    const index = Math.floor((tMs - this.t0) / this.binMs);
    let bin = this.list[this.list.length - 1];
    if (!bin || bin.index !== index || bin.cfg !== cfg) {
      bin = { index, cfg, start: tMs - this.t0, frames: 0, row: 0, rowAsked: 0, ring: 0, ringAsked: 0, both: 0, bothAsked: 0, rescued: 0, rowPeak: 0, ringPeak: 0, motionSum: 0, motionN: 0, end: tMs - this.t0, unseen: 0, rowS: 0, rowSAsked: 0, ringS: 0, ringSAsked: 0, bothS: 0, bothSAsked: 0 };
      this.list.push(bin);
      while (this.list.length > this.maxBins) this.list.shift();
    }
    bin.frames++;
    bin.end = tMs - this.t0;
    if (row !== null) { bin.rowAsked++; if (row) bin.row++; }
    if (ring !== null) { bin.ringAsked++; if (ring) bin.ring++; }
    if (row !== null && ring !== null) { bin.bothAsked++; if (row && ring) bin.both++; }
    if (rescued) bin.rescued++;
    if (!seen) bin.unseen++;
    else {                                                    // the same, over the pictures where something responds
      if (row !== null) { bin.rowSAsked++; if (row) bin.rowS++; }
      if (ring !== null) { bin.ringSAsked++; if (ring) bin.ringS++; }
      if (row !== null && ring !== null) { bin.bothSAsked++; if (row && ring) bin.bothS++; }
    }
    bin.rowPeak = Math.max(bin.rowPeak, rowPeak);
    bin.ringPeak = Math.max(bin.ringPeak, ringPeak);
    if (Number.isFinite(motion)) { bin.motionSum += motion; bin.motionN++; }
  }

  bins() {
    return this.list.map((b) => ({
      ...b,
      rowPct: b.rowAsked ? (100 * b.row) / b.rowAsked : NaN,
      ringPct: b.ringAsked ? (100 * b.ring) / b.ringAsked : NaN,
      bothPct: b.bothAsked ? (100 * b.both) / b.bothAsked : NaN,
      rescuedPct: b.frames ? (100 * b.rescued) / b.frames : NaN,
      unseenPct: b.frames ? (100 * b.unseen) / b.frames : NaN,
      rowSeenPct: b.rowSAsked ? (100 * b.rowS) / b.rowSAsked : NaN,
      ringSeenPct: b.ringSAsked ? (100 * b.ringS) / b.ringSAsked : NaN,
      bothSeenPct: b.bothSAsked ? (100 * b.bothS) / b.bothSAsked : NaN,
      motion: b.motionN ? b.motionSum / b.motionN : NaN,
    }));
  }

  // all the slices kept together
  totals() {
    const t = { frames: 0, row: 0, rowAsked: 0, ring: 0, ringAsked: 0, both: 0, bothAsked: 0, rescued: 0, unseen: 0, rowS: 0, rowSAsked: 0, ringS: 0, ringSAsked: 0, bothS: 0, bothSAsked: 0 };
    for (const b of this.list) for (const k of Object.keys(t)) t[k] += b[k];
    return { ...t, rowPct: t.rowAsked ? (100 * t.row) / t.rowAsked : NaN, ringPct: t.ringAsked ? (100 * t.ring) / t.ringAsked : NaN, bothPct: t.bothAsked ? (100 * t.both) / t.bothAsked : NaN, rescuedPct: t.frames ? (100 * t.rescued) / t.frames : NaN,
      unseenPct: t.frames ? (100 * t.unseen) / t.frames : NaN, rowSeenPct: t.rowSAsked ? (100 * t.rowS) / t.rowSAsked : NaN, ringSeenPct: t.ringSAsked ? (100 * t.ringS) / t.ringSAsked : NaN, bothSeenPct: t.bothSAsked ? (100 * t.bothS) / t.bothSAsked : NaN };
  }
}
