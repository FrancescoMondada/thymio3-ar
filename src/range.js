// How far is the phone from the robot? The scale of the map (px per mm, brought to a picture 640 px long so that the analysis size does not matter) says it:
// 0.6 px/mm is about 75 cm, 2.2 about 21 cm (a camera of about 70 degrees across its long side). In the 14th test the map held at 0.5 to 2.4 px/mm in most
// of the run and was lost for several seconds when the robot was very far (0.44, 0.56 px/mm) or when the phone came very near: there the page cannot do much, the
// user can, and says so.
export const RANGE = { far: 0.6, near: 2.2, idealMin: 0.8, idealMax: 1.5 };
export const MESSAGES = {
  far: 'Trop loin : rapprochez le téléphone du robot (idéal : 30 à 60 cm).',
  near: 'Trop près : éloignez le téléphone du robot (idéal : 30 à 60 cm).',
};

export const classifyRange = (scale640) => (!Number.isFinite(scale640) ? null : scale640 < RANGE.far ? 'far' : scale640 > RANGE.near ? 'near' : 'ok');
// px/mm at the size analysed -> px/mm for a picture 640 px long
export const normalise = (scale, w, h) => scale * 640 / Math.max(w, h);

export class RangeGuide {
  constructor({ showAfterMs = 1200, hideAfterMs = 800, memoryMs = 6000 } = {}) {
    Object.assign(this, { showAfterMs, hideAfterMs, memoryMs });
    this.reset();
  }

  reset() {
    this.state = 'ok';                 // what is shown: 'far', 'near' or 'ok' (nothing)
    this.candidate = null;
    this.since = 0;
    this.last = null;                  // { s, t }: the last scale seen
    this.counts = { far: 0, ok: 0, near: 0 };   // pictures of a tracked map, by class
  }

  // t in ms; scale640: the scale now (the map's, or what the detector measured), NaN when nothing is known; tracking: there is a map
  // -> { state, message }
  update(t, scale640, tracking) {
    let cls = classifyRange(scale640);
    if (cls !== null) this.last = { s: scale640, t };
    if (tracking && cls !== null) this.counts[cls]++;
    if (cls === null && !tracking && this.last && t - this.last.t <= this.memoryMs) {
      // the map is lost and nothing is measured: the last scale says on which side the robot was going out of range (a margin: it was already near the limit)
      cls = this.last.s < RANGE.far + 0.15 ? 'far' : this.last.s > RANGE.near - 0.3 ? 'near' : null;
    }
    if (cls === null) cls = this.state === 'ok' ? 'ok' : this.state;       // nothing to say: what was said stays
    if (cls !== this.state) {
      if (this.candidate !== cls) { this.candidate = cls; this.since = t; }
      else if (t - this.since >= (cls === 'ok' ? this.hideAfterMs : this.showAfterMs)) { this.state = cls; this.candidate = null; }
    } else this.candidate = null;
    return { state: this.state, message: MESSAGES[this.state] || '' };
  }

  // what the report says: the share of the pictures with a map that were too far, in range, too near
  summary() {
    const n = this.counts.far + this.counts.ok + this.counts.near;
    return { ...this.counts, n, far: n ? this.counts.far / n : 0, ok: n ? this.counts.ok / n : 0, near: n ? this.counts.near / n : 0 };
  }
}
