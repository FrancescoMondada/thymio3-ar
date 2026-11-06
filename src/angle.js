// How steeply the camera looks down at the table, and how many LEDs were seen at each steepness.
//
// The angle is the one between the camera's line of sight and the table (the robot lies flat on it): 90° is
// straight from above, 0° is level with the table. It comes from the tablet's orientation sensor
// (DeviceOrientationEvent: beta and gamma, in degrees, relative to the horizontal), so it is exact for the
// middle of the picture. A rear camera looks out of the back of the tablet: flat on its back, the tablet looks
// straight down (90°); held upright, it looks level (0°). The front camera looks out of the screen: it looks
// down only when the screen faces the table.

// -> degrees, or NaN when the camera looks up or the sensor gave nothing
export function viewAngleDeg(beta, gamma, facing = 'environment') {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return NaN;
  const rad = Math.PI / 180;
  // vertical component (up) of the axis that points out of the screen of the tablet
  const up = Math.cos(beta * rad) * Math.cos(gamma * rad);
  const down = facing === 'user' ? -up : up;           // component of the camera's line of sight, looking down
  const a = Math.asin(Math.max(-1, Math.min(1, down))) / rad;
  return a >= -0.5 ? Math.max(0, a) : NaN;
}

export const ANGLE_EDGES = [90, 75, 60, 45, 30, 15, 0];

// the tranche of an angle: 0 for 75-90°, ... 5 for 0-15°; -1 outside
export function trancheOf(angle) {
  if (!Number.isFinite(angle) || angle < 0 || angle > 90) return -1;
  for (let i = 0; i < ANGLE_EDGES.length - 1; i++) {
    if (angle > ANGLE_EDGES[i + 1] || (i === ANGLE_EDGES.length - 2 && angle >= 0)) return i;
  }
  return -1;
}

export const trancheLabel = (i) => `${ANGLE_EDGES[i + 1]}–${ANGLE_EDGES[i]}°`;

// For each tranche: how many pictures, and how many LEDs were found in them (mean, lowest, highest, and how
// many pictures had all of them).
export class AngleTable {
  constructor(expected = 16) {
    this.expected = expected;
    this.rows = Array.from({ length: ANGLE_EDGES.length - 1 }, () => ({ frames: 0, sum: 0, min: Infinity, max: 0, full: 0 }));
  }

  add(angle, count) {
    const i = trancheOf(angle);
    if (i < 0) return;
    const r = this.rows[i];
    r.frames++;
    r.sum += count;
    r.min = Math.min(r.min, count);
    r.max = Math.max(r.max, count);
    if (count === this.expected) r.full++;
  }

  summary() {
    return this.rows.map((r, i) => ({
      label: trancheLabel(i),
      frames: r.frames,
      mean: r.frames ? r.sum / r.frames : NaN,
      min: r.frames ? r.min : NaN,
      max: r.frames ? r.max : NaN,
      fullPct: r.frames ? (100 * r.full) / r.frames : NaN,
    }));
  }
}
