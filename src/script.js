// The script that runs on the robot (py/leds_lego.py) and what the page must agree with it on.

// How fast the LEDs blink. A phone gives 30 pictures a second at best and the page often analyses fewer, with an
// exposure of a few tens of ms: to see on and off clearly, a half period must last several pictures. The first test on
// a phone (7.46 Hz, 5.9 pictures analysed a second) was under-sampled, so the default is slower: 200 ms on, 200 ms
// off = 2.5 Hz, 6 pictures of a camera at 30 a second for each. The page can ask for others (HALF_CHOICES).
export const HALF_MS = 200;                          // the default = HALF_MS in leds_lego.py (tests/script.test.js compares them)
export const HALF_CHOICES = [400, 200, 100, 67];     // half periods the page offers, in ms
export const hzOf = (halfMs) => 1000 / (2 * halfMs); // how often the LEDs go on (and off): 2.5 Hz for 200 ms
export const BLINK_HZ = hzOf(HALF_MS);
export const MODES = ['on', 'off', 'blink'];

// Which LEDs the script drives. GROUP, for the 16 green Lego LEDs: -2 = none, -1 = the 16, 0..3 = four LEDs ALIGNED on one
// row and 16 mm apart (every other LED of the row, because next to each other, at 8 mm, a phone camera cannot tell
// them apart): 0 front row even indices, 1 front odd, 2 back even, 3 back odd. CIRCLE, for the 8 amber arcs of the ring
// round the touch pad (the firmware names the indices 0..7 N, NE, E, SE, S, SW, W, NW): -1 = none, 0 = N E S W (a
// square turned by 45 degrees), 1 = NE SE SW NW (a square whose sides are parallel to the axes of the robot, so two of
// them to the rows of Lego LEDs, if N points to the nose). Same rules as GROUP and CIRCLE in leds_lego.py. When both a
// group and a ring set are chosen the script makes them blink in turn (alternate).
// -> [{ row: 'front' | 'back' | 'circle', i }]
export const GROUPS = [-2, -1, 0, 1, 2, 3];
export const CIRCLES = [-1, 0, 1];
export const groupMembers = (group) => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    if (group === -1 || (group >= 0 && group < 2 && i % 2 === group)) out.push({ row: 'front', i });
    if (group === -1 || (group >= 2 && i % 2 === group - 2)) out.push({ row: 'back', i });
  }
  return out;
};
export const circleMembers = (circle) => (circle < 0 ? [] : [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i % 2 === circle).map((i) => ({ row: 'circle', i })));
export const countOf = (group, circle = -1) => groupMembers(group).length + circleMembers(circle).length;   // 16, 4, 8, 0...
export const isAlternating = (group, circle) => group !== -2 && circle >= 0;

// the time window the detector looks at for a half period `halfMs`: 2.5 periods, with the mean and the slope taken
// out, so that a steady pixel gives 0 and a pixel that blinks gives its amplitude
export const windowOf = (halfMs) => 5 * halfMs;

// The script with its mode, its groups of LEDs and (for the blink) its half period written in.
export function buildScript(raw, mode, halfMs = HALF_MS, group = -1, circle = -1) {
  if (!MODES.includes(mode)) throw new Error(`unknown LED mode: ${mode}`);
  if (!GROUPS.includes(group)) throw new Error(`unknown group of LEDs: ${group}`);
  if (!CIRCLES.includes(circle)) throw new Error(`unknown set of ring LEDs: ${circle}`);
  if (!Number.isInteger(halfMs) || halfMs < 40 || halfMs > 2000) throw new Error(`unusable half period: ${halfMs} ms`);
  const line = 'MODE = "on"';
  if (!raw.includes(line)) throw new Error('leds_lego.py has no MODE line to write the mode in');
  if (!/^HALF_MS = \d+/m.test(raw)) throw new Error('leds_lego.py has no HALF_MS line to write the half period in');
  if (!/^GROUP = -?\d+/m.test(raw)) throw new Error('leds_lego.py has no GROUP line to write the group in');
  if (!/^CIRCLE = -?\d+/m.test(raw)) throw new Error('leds_lego.py has no CIRCLE line to write the ring set in');
  return raw.replace(line, `MODE = "${mode}"`).replace(/^HALF_MS = \d+/m, `HALF_MS = ${halfMs}`)
    .replace(/^GROUP = -?\d+/m, `GROUP = ${group}`).replace(/^CIRCLE = -?\d+/m, `CIRCLE = ${circle}`);
}
