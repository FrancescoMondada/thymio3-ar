// What the camera and the screen do while the test runs. The 17th report came with "the camera changes mode from time to time (zoom? landscape / portrait?)" and the
// page had not noted anything about it: the size of the picture the camera gives (a phone held flat turns its screen, and Chrome turns the frames with it), the size
// of the window, the orientation of the screen, the settings of the camera track (zoom, exposure, ...), a track that stops (mute) or a page that goes to the
// background. Each CHANGE is kept with its time; the report lists them and the page tells the user when one happens. Pure bookkeeping: the page gives the snapshots.

// the settings of the camera track worth noting (Chrome's getSettings keys); numbers are compared to 2 decimals
export const WATCHED = ['width', 'height', 'frameRate', 'zoom', 'exposureMode', 'exposureTime', 'exposureCompensation', 'iso', 'focusMode', 'focusDistance', 'whiteBalanceMode', 'colorTemperature', 'torch', 'resizeMode'];
// the kinds of change the user is told about on the picture (the others, exposure for instance, move on their own and are only counted)
export const SHOWN = new Set(['image', 'écran', 'orientation', 'zoom', 'caméra', 'page', 'carte']);
const LABEL = { frame: 'image', window: 'écran', orientation: 'orientation' };

export const pickSettings = (s) => {
  const out = {};
  for (const k of WATCHED) if (s && s[k] !== undefined && s[k] !== null) out[k] = typeof s[k] === 'number' ? Math.round(s[k] * 100) / 100 : String(s[k]);
  return out;
};

// what the camera can do (the capabilities of the track), in a few words for the report
export function capabilitiesText(caps) {
  if (!caps) return 'n/d';
  const part = (k) => {
    const v = caps[k];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return `${k} ${v.join('/')}`;
    if (typeof v === 'object') return `${k} ${v.min ?? '?'}–${v.max ?? '?'}`;
    return `${k} ${v}`;
  };
  return ['zoom', 'exposureCompensation', 'iso', 'exposureMode', 'focusMode', 'whiteBalanceMode', 'torch'].map(part).filter(Boolean).join(', ') || 'rien sur le zoom, l\'exposition ou la mise au point';
}

export class CameraWatch {
  constructor({ max = 60 } = {}) { this.max = max; this.reset(); }

  reset() {
    this.t0 = null;
    this.prev = {};
    this.events = [];                  // [{ t (s since the first snapshot), kind, text }]: the first `max`
    this.counts = {};                  // kind -> number of changes
  }

  add(t, kind, text) {
    if (this.t0 == null) this.t0 = t;
    const ev = { t: (t - this.t0) / 1000, kind, text };
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    if (this.events.length < this.max) this.events.push(ev);
    return ev;
  }

  // snap: { frame: '720x1280', window: '411x782', orientation: 'portrait-primary', ...pickSettings(...) }, only the keys that are known now (the settings are read about
  // once a second). -> the new events (the first snapshot sets the baseline and gives none)
  observe(t, snap) {
    if (this.t0 == null) this.t0 = t;
    const out = [];
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined || v === null) continue;
      const old = this.prev[k];
      this.prev[k] = v;
      if (old === undefined || old === v) continue;
      const kind = LABEL[k] || (k === 'zoom' ? 'zoom' : 'réglage');
      const name = LABEL[k] ? kind : k;
      out.push(this.add(t, kind, `${name} ${old} → ${v}`));
    }
    return out;
  }

  note(t, kind, text) { return this.add(t, kind, text); }

  total() { return Object.values(this.counts).reduce((a, b) => a + b, 0); }

  // for the report: the number of changes by kind, then the first of them with their time
  line() {
    const n = this.total();
    if (!n) return 'aucun changement de forme de l\'image, d\'orientation de l\'écran, de zoom ou de réglage de la caméra';
    const by = Object.entries(this.counts).map(([k, v]) => `${k} ${v}`).join(', ');
    const list = this.events.map((e) => `${e.t.toFixed(1)} s ${e.text}`).join(' ; ');
    return `${n} changement(s) (${by}) : ${list}${n > this.events.length ? ` ; … (${n - this.events.length} de plus)` : ''}`;
  }
}
