// The script that runs on the robot (py/leds_lego.py) and what the page must agree with it on.

export const HALF_MS = 67;                           // = HALF_MS in leds_lego.py (tests/script.test.js compares them)
export const BLINK_HZ = 1000 / (2 * HALF_MS);        // how often the LEDs go on (and off): about 7.46 Hz
export const MODES = ['on', 'off', 'blink'];

// The script with its mode written in.
export function buildScript(raw, mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown LED mode: ${mode}`);
  const line = 'MODE = "on"';
  if (!raw.includes(line)) throw new Error('leds_lego.py has no MODE line to write the mode in');
  return raw.replace(line, `MODE = "${mode}"`);
}
