import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HALF_MS, BLINK_HZ, MODES, buildScript } from '../src/script.js';

const raw = readFileSync(new URL('../src/py/leds_lego.py', import.meta.url), 'utf8');

test('the page and the robot script agree on the half period of the blink', () => {
  const m = raw.match(/^HALF_MS = (\d+)/m);
  assert.ok(m, 'HALF_MS in leds_lego.py');
  assert.equal(Number(m[1]), HALF_MS);
  assert.ok(Math.abs(BLINK_HZ - 1000 / (2 * HALF_MS)) < 1e-12);
  assert.ok(BLINK_HZ > 5 && BLINK_HZ < 10, 'a few Hz: well under half the camera rate, well over hand movements');
});

test('buildScript writes the mode into the one MODE line and nothing else', () => {
  for (const mode of MODES) {
    const text = buildScript(raw, mode);
    assert.ok(text.includes(`MODE = "${mode}"`));
    assert.equal(text.split('\n').length, raw.split('\n').length);
    assert.equal(text.replace(`MODE = "${mode}"`, 'MODE = "on"'), raw);
  }
});

test('buildScript refuses an unknown mode, and a script that has no MODE line', () => {
  assert.throws(() => buildScript(raw, 'strobe'), /unknown LED mode/);
  assert.throws(() => buildScript('print(1)', 'on'), /no MODE line/);
});
